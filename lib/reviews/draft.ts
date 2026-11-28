/**
 * Soạn nháp phản hồi bằng AI (Anthropic, cùng ANTHROPIC_API_KEY với phần còn lại) + chặn chi phí theo gói.
 * Mỗi lượt soạn thành công ghi 1 dòng review_draft_events; trần = ReviewEntitlement.monthlyDrafts / tháng (giờ VN).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { askClaude } from '@/lib/claude'
import { buildDraftPrompt, checkReply, parseDraftOutput, type DraftResult } from './reply-rules'
import { maxUrgency } from './triage'
import { WARN_REPLY_UNKNOWN } from './ingest'
import type { ReviewRow, Urgency } from './types'

/** Mốc đầu tháng theo giờ Việt Nam (UTC+7), dạng ISO UTC. */
export function vnMonthStartISO(now = new Date()): string {
  const vn = new Date(now.getTime() + 7 * 3_600_000)
  return new Date(Date.UTC(vn.getUTCFullYear(), vn.getUTCMonth(), 1) - 7 * 3_600_000).toISOString()
}

export async function draftsUsedThisMonth(admin: SupabaseClient, workspaceId: string, now = new Date()): Promise<number> {
  const { count, error } = await admin
    .from('review_draft_events')
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', workspaceId)
    .gte('created_at', vnMonthStartISO(now))
  if (error) throw error
  return count || 0
}

export type DraftClient = {
  id: string
  workspace_id: string
  name: string
  industry?: string | null
  area?: string | null
  brand_voice?: string | null
}

async function contextFor(admin: SupabaseClient, client: DraftClient): Promise<{ services: string[]; recentReplies: string[] }> {
  const [prof, recent] = await Promise.all([
    // Bảng client_business_profiles có trên DB thật nhưng không còn trong repo -> đọc nếu có, lỗi thì bỏ qua.
    admin.from('client_business_profiles').select('main_service, services').eq('client_id', client.id).maybeSingle().then(
      (r: any) => r,
      () => ({ data: null }),
    ),
    admin
      .from('client_reviews')
      .select('final_reply, draft_reply')
      .eq('client_id', client.id)
      .in('status', ['posted', 'manual_copied', 'approved', 'drafted'])
      .order('updated_at', { ascending: false })
      .limit(5),
  ])
  const p: any = (prof as any)?.data
  const services: string[] = []
  if (p?.main_service) services.push(String(p.main_service))
  if (Array.isArray(p?.services)) for (const s of p.services) services.push(typeof s === 'string' ? s : String(s?.name || s?.title || ''))
  const recentReplies = ((recent as any)?.data || []).map((r: any) => r.final_reply || r.draft_reply).filter(Boolean)
  return { services: services.filter(Boolean).slice(0, 8), recentReplies }
}

export type DraftOutcome =
  | { ok: true; draft: string; warnings: string[] }
  | { ok: false; reason: 'quota' | 'no_ai' | 'ai_error' | 'empty' | 'not_found'; message: string }

/** Gọi AI tối đa 2 lần (lần 2 khi bản đầu có lỗi chặn hoặc không đọc được). Thuần phần kiểm tra, không đụng DB. */
export async function generateDraft(
  ctx: Parameters<typeof buildDraftPrompt>[0] & { authorName?: string | null },
  ask: (prompt: string) => Promise<string> = (p) => askClaude(p, { maxTokens: 700, temperature: 0.5 }),
): Promise<{ result: DraftResult; warnings: string[] } | null> {
  let note = ''
  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = await ask(buildDraftPrompt({ ...ctx, instruction: [ctx.instruction, note].filter(Boolean).join(' ') || null }))
    const parsed = parseDraftOutput(raw)
    if (!parsed) {
      note = 'Lần trước trả sai định dạng: chỉ trả về đúng 1 đối tượng JSON.'
      continue
    }
    const checked = checkReply(parsed.reply, { authorName: ctx.authorName, rating: ctx.rating })
    if (checked.blocking.length) {
      note = `Lần trước bị lỗi: ${checked.blocking.join(' ')} Viết lại ngắn hơn.`
      continue
    }
    return { result: { ...parsed, reply: checked.text }, warnings: checked.warnings }
  }
  return null
}

export async function draftReview(
  admin: SupabaseClient,
  review: Pick<ReviewRow, 'id' | 'rating' | 'review_text' | 'author_name' | 'status' | 'urgency' | 'draft_warnings'>,
  client: DraftClient,
  opts: { kind: 'auto' | 'manual' | 'owner'; monthlyDrafts: number; instruction?: string | null; now?: Date },
): Promise<DraftOutcome> {
  if (!process.env.ANTHROPIC_API_KEY) return { ok: false, reason: 'no_ai', message: 'Chưa cấu hình ANTHROPIC_API_KEY.' }
  const used = await draftsUsedThisMonth(admin, client.workspace_id, opts.now)
  if (used >= opts.monthlyDrafts) {
    return { ok: false, reason: 'quota', message: `Đã dùng hết ${opts.monthlyDrafts} lượt soạn nháp AI tháng này của gói hiện tại.` }
  }
  const ctx = await contextFor(admin, client)
  let gen: Awaited<ReturnType<typeof generateDraft>> = null
  try {
    gen = await generateDraft({
      businessName: client.name,
      industry: client.industry,
      area: client.area,
      brandVoice: client.brand_voice,
      services: ctx.services,
      recentReplies: ctx.recentReplies,
      rating: review.rating,
      text: review.review_text || '',
      instruction: opts.instruction ?? null,
      authorName: review.author_name,
    })
  } catch (e: any) {
    return { ok: false, reason: 'ai_error', message: String(e?.message || e).slice(0, 200) }
  }
  if (!gen) return { ok: false, reason: 'empty', message: 'AI không soạn được bản nháp hợp lệ, hãy thử lại hoặc tự viết.' }

  await admin.from('review_draft_events').insert({ workspace_id: client.workspace_id, client_id: client.id, review_id: review.id, kind: opts.kind })

  // Giữ cảnh báo về dữ liệu (chưa chắc đã phản hồi); bỏ cảnh báo của bản nháp cũ và "khách đã sửa review" (vừa soạn theo nội dung mới).
  const keep = (review.draft_warnings || []).filter((w) => w === WARN_REPLY_UNKNOWN)
  const { data: cur } = await admin.from('client_reviews').select('draft_count').eq('id', review.id).maybeSingle()
  const patch: Record<string, unknown> = {
    draft_reply: gen.result.reply,
    final_reply: null,
    draft_warnings: [...keep, ...gen.warnings],
    drafted_at: (opts.now ?? new Date()).toISOString(),
    draft_count: ((cur as any)?.draft_count ?? 0) + 1,
    urgency: maxUrgency(review.urgency as Urgency, gen.result.urgency),
  }
  if (gen.result.sentiment) patch.sentiment = gen.result.sentiment
  if (gen.result.topics.length) patch.topics = gen.result.topics
  if (gen.result.summary) patch.ai_summary = gen.result.summary
  if (['new', 'drafted', 'approved', 'failed'].includes(review.status)) patch.status = 'drafted'
  const { error } = await admin.from('client_reviews').update(patch).eq('id', review.id)
  if (error) throw error
  return { ok: true, draft: gen.result.reply, warnings: gen.warnings }
}
