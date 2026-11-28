/**
 * Ghi review lấy về vào client_reviews: khớp với bản ghi đã có (lib/reviews/normalize.ts findMatch), cập nhật phản hồi
 * của chủ, phát hiện khách sửa review, và trả về danh sách review MỚI để bước sau soạn nháp / tạo việc.
 * planIngest() THUẦN (test được); applyIngest() ghi DB bằng service role.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { findMatch, reviewFingerprint, textPrefix } from './normalize'
import { baseTriage } from './triage'
import type { IncomingReview, ReviewRow, ReviewStatus } from './types'

export type ExistingLite = Pick<
  ReviewRow,
  | 'id'
  | 'review_key'
  | 'source'
  | 'source_review_id'
  | 'gbp_review_name'
  | 'author_name'
  | 'rating'
  | 'review_text'
  | 'reviewed_at'
  | 'reviewed_at_exact'
  | 'status'
  | 'owner_reply'
  | 'draft_reply'
  | 'final_reply'
  | 'draft_warnings'
>

export const EXISTING_COLUMNS =
  'id, review_key, source, source_review_id, gbp_review_name, author_name, rating, review_text, reviewed_at, reviewed_at_exact, status, owner_reply, draft_reply, final_reply, draft_warnings'

export const WARN_REPLY_UNKNOWN = 'Nguồn dữ liệu không cho biết chủ đã phản hồi hay chưa — kiểm tra trên Google Maps trước khi dán.'
export const WARN_EDITED = 'Khách đã sửa review sau khi có bản nháp — hãy đọc lại và sửa phản hồi cho khớp.'

export type InsertRow = {
  review_key: string
  source: IncomingReview['source']
  source_review_id: string | null
  gbp_review_name: string | null
  author_name: string | null
  rating: number
  review_text: string | null
  reviewed_at: string | null
  reviewed_at_exact: boolean
  relative_time: string | null
  owner_reply: string | null
  owner_reply_at: string | null
  reply_source: string | null
  sentiment: string
  urgency: string
  status: ReviewStatus
  draft_warnings: string[]
}

export type IngestPlan = {
  inserts: InsertRow[]
  updates: Array<{ id: string; patch: Record<string, unknown>; becameRepliedElsewhere: boolean }>
  /** Số review lấy về trùng bản ghi đã có (không đổi gì ngoài last_seen_at). */
  unchanged: number
}

const OPEN_FOR_REPLY: ReviewStatus[] = ['new', 'drafted', 'approved', 'failed']

export type Matcher = (pool: ExistingLite[], inc: IncomingReview, key: string) => ExistingLite | null

export function planIngest(
  existing: ExistingLite[],
  incoming: IncomingReview[],
  opts: { replyKnown: boolean; now: Date; matcher?: Matcher },
): IngestPlan {
  const match: Matcher = opts.matcher ?? ((pool, inc, key) => findMatch(pool, inc, key))
  const nowIso = opts.now.toISOString()
  const plan: IngestPlan = { inserts: [], updates: [], unchanged: 0 }
  const pool: ExistingLite[] = [...existing]
  const seenKeys = new Set<string>()

  for (const inc of incoming) {
    const key = reviewFingerprint(inc)
    if (seenKeys.has(key)) continue
    seenKeys.add(key)
    const hit = match(pool, inc, key)
    const reply = typeof inc.owner_reply === 'string' && inc.owner_reply.trim() ? inc.owner_reply.trim() : null
    const replyKnownHere = inc.owner_reply !== undefined || opts.replyKnown

    if (!hit) {
      const tri = baseTriage(inc.rating, inc.text)
      const row: InsertRow = {
        review_key: key,
        source: inc.source,
        source_review_id: inc.source_review_id,
        gbp_review_name: inc.gbp_review_name ?? null,
        author_name: inc.author_name,
        rating: inc.rating,
        review_text: inc.text || null,
        reviewed_at: inc.reviewed_at,
        reviewed_at_exact: inc.reviewed_at_exact,
        relative_time: inc.relative_time ?? null,
        owner_reply: reply,
        owner_reply_at: reply ? inc.owner_reply_at ?? null : null,
        reply_source: reply ? inc.source : null,
        sentiment: tri.sentiment,
        urgency: tri.urgency,
        status: reply ? 'replied_elsewhere' : 'new',
        draft_warnings: !reply && !replyKnownHere ? [WARN_REPLY_UNKNOWN] : [],
      }
      plan.inserts.push(row)
      pool.push({
        id: `new:${key}`,
        review_key: key,
        source: inc.source,
        source_review_id: row.source_review_id,
        gbp_review_name: row.gbp_review_name,
        author_name: row.author_name,
        rating: row.rating,
        review_text: row.review_text,
        reviewed_at: row.reviewed_at,
        reviewed_at_exact: row.reviewed_at_exact,
        status: row.status,
        owner_reply: row.owner_reply,
        draft_reply: null,
        final_reply: null,
        draft_warnings: row.draft_warnings,
      })
      continue
    }
    if (hit.id.startsWith('new:')) continue

    const patch: Record<string, unknown> = {}
    let becameRepliedElsewhere = false
    if (!hit.author_name && inc.author_name) patch.author_name = inc.author_name
    if (!hit.source_review_id && inc.source_review_id && inc.source === hit.source) patch.source_review_id = inc.source_review_id
    if (inc.gbp_review_name && hit.gbp_review_name !== inc.gbp_review_name) patch.gbp_review_name = inc.gbp_review_name
    if (inc.reviewed_at && inc.reviewed_at_exact && !hit.reviewed_at_exact) {
      patch.reviewed_at = inc.reviewed_at
      patch.reviewed_at_exact = true
    }
    if ((hit.source === 'legacy' || hit.source === 'snapshot') && inc.source !== 'snapshot') patch.source = inc.source

    // Khách sửa nội dung / đổi sao
    const edited = Math.round(hit.rating) !== Math.round(inc.rating) || (inc.text && textPrefix(inc.text, 200) !== textPrefix(hit.review_text || '', 200))
    if (edited && (inc.text || Math.round(hit.rating) !== Math.round(inc.rating))) {
      patch.rating = inc.rating
      patch.review_text = inc.text || hit.review_text
      const tri = baseTriage(inc.rating, inc.text)
      patch.urgency = tri.urgency
      patch.sentiment = tri.sentiment
      if (hit.draft_reply || hit.final_reply) {
        patch.draft_warnings = Array.from(new Set([...(hit.draft_warnings || []), WARN_EDITED]))
        if (hit.status === 'approved') patch.status = 'drafted'
      }
    }

    // Phản hồi của chủ
    if (reply) {
      if (reply !== hit.owner_reply) {
        patch.owner_reply = reply
        patch.owner_reply_at = inc.owner_reply_at ?? null
        patch.reply_source = inc.source
      }
      if (OPEN_FOR_REPLY.includes(hit.status)) {
        patch.status = 'replied_elsewhere'
        becameRepliedElsewhere = true
      }
      if ((hit.draft_warnings || []).includes(WARN_REPLY_UNKNOWN)) {
        patch.draft_warnings = ((patch.draft_warnings as string[]) || hit.draft_warnings).filter((w) => w !== WARN_REPLY_UNKNOWN)
      }
    } else if (inc.owner_reply === null) {
      if ((hit.draft_warnings || []).includes(WARN_REPLY_UNKNOWN)) {
        patch.draft_warnings = ((patch.draft_warnings as string[]) || hit.draft_warnings).filter((w) => w !== WARN_REPLY_UNKNOWN)
      }
      // Phản hồi đã bị xoá trên Google -> mở lại
      if (hit.owner_reply && hit.status === 'replied_elsewhere') {
        patch.owner_reply = null
        patch.owner_reply_at = null
        patch.status = hit.draft_reply || hit.final_reply ? 'drafted' : 'new'
      }
    }

    if (Object.keys(patch).length === 0) {
      plan.unchanged += 1
      plan.updates.push({ id: hit.id, patch: { last_seen_at: nowIso }, becameRepliedElsewhere: false })
    } else {
      plan.updates.push({ id: hit.id, patch: { ...patch, last_seen_at: nowIso }, becameRepliedElsewhere })
    }
  }
  return plan
}

export type IngestOutcome = {
  inserted: Array<{ id: string } & InsertRow>
  updated: number
  repliedElsewhereIds: string[]
}

export async function loadExisting(admin: SupabaseClient, clientId: string): Promise<ExistingLite[]> {
  const { data, error } = await admin
    .from('client_reviews')
    .select(EXISTING_COLUMNS)
    .eq('client_id', clientId)
    .order('reviewed_at', { ascending: false, nullsFirst: false })
    .limit(1000)
  if (error) throw error
  return (data || []) as unknown as ExistingLite[]
}

export async function applyIngest(
  admin: SupabaseClient,
  client: { id: string; workspace_id: string },
  incoming: IncomingReview[],
  opts: { replyKnown: boolean; now: Date; matcher?: Matcher },
): Promise<IngestOutcome> {
  const existing = await loadExisting(admin, client.id)
  const plan = planIngest(existing, incoming, opts)
  const out: IngestOutcome = { inserted: [], updated: 0, repliedElsewhereIds: [] }
  const nowIso = opts.now.toISOString()

  if (plan.inserts.length) {
    const rows = plan.inserts.map((r) => ({ ...r, workspace_id: client.workspace_id, client_id: client.id, first_seen_at: nowIso, last_seen_at: nowIso }))
    // ON CONFLICT DO NOTHING: chạy song song 2 lần (cron + bấm tay) không tạo trùng.
    const { data, error } = await admin
      .from('client_reviews')
      .upsert(rows, { onConflict: 'client_id,review_key', ignoreDuplicates: true })
      .select('id, review_key')
    if (error) throw error
    const idByKey = new Map<string, string>((data || []).map((d: any) => [d.review_key, d.id]))
    for (const r of plan.inserts) {
      const id = idByKey.get(r.review_key)
      if (id) out.inserted.push({ id, ...r })
    }
  }
  for (const u of plan.updates) {
    const { error } = await admin.from('client_reviews').update(u.patch).eq('id', u.id)
    if (error) throw error
    if (Object.keys(u.patch).length > 1) out.updated += 1
    if (u.becameRepliedElsewhere) out.repliedElsewhereIds.push(u.id)
  }
  return out
}
