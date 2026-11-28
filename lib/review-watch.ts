/**
 * Review Watch — "người canh hồ sơ" (bản 2, dùng hộp thư review client_reviews của migration 029).
 *
 * Mỗi lượt cron (hàng ngày 09:00 giờ VN; tần suất thật theo gói: Nâng cao hàng ngày, Khởi động hàng tuần, Miễn phí không quét):
 *   1. Lấy review MỚI từ lần kiểm tra trước (Outscraper sort newest + cutoff, tính tiền theo review; dự phòng SearchApi/SerpApi).
 *      Mỗi 7 ngày quét rộng hơn: từ review CÒN MỞ cũ nhất (tối đa 30 ngày) để bắt phản hồi chủ đã làm thẳng trên Google.
 *      Hồ sơ đã được Make đồng bộ từ Business Profile API trong 48 giờ qua thì bỏ qua bước này (dữ liệu GBP chính xác và miễn phí).
 *   2. Ghi vào client_reviews (khớp review giữa các nguồn, không trùng), phân loại cảm xúc / mức khẩn bằng luật.
 *   3. Gói có autoDraft: soạn nháp AI cho review mới chưa phản hồi (khẩn trước), trong trần nháp tháng.
 *   4. Review ≤3★ hoặc khẩn -> 1 việc ưu tiên cao / review; review 4–5★ chưa phản hồi -> gộp 1 việc "cảm ơn" mức thấp.
 *      Việc trỏ về trang /clients/<id>/reviews để duyệt, sửa, copy hoặc đăng. Review được xử lý xong -> việc tự đóng.
 * Chỉ chạy ở server bằng admin client (cron / API đã kiểm tra quyền), KHÔNG gọi từ trình duyệt.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { vnTodayISO } from '@/lib/notifications'
import type { ReviewEntitlement } from '@/lib/billing/plans'
import { fetchLatestReviews } from '@/lib/reviews/sources'
import { applyIngest, type IngestOutcome } from '@/lib/reviews/ingest'

type InsertedReview = IngestOutcome['inserted'][number]
import { draftReview } from '@/lib/reviews/draft'
import { closesTask } from '@/lib/reviews/lifecycle'
import type { IncomingReview, ReviewStatus } from '@/lib/reviews/types'

export const NEGATIVE_MAX_RATING = 3
const MAX_NEGATIVE_TASKS_PER_RUN = 5
export const MAX_AUTO_DRAFTS_PER_CLIENT_RUN = 6
export const FIRST_RUN_LOOKBACK_DAYS = 30
/** Review cũ hơn mốc này (vd lần chạy đầu kéo về) chỉ lưu, không tạo việc / không tự soạn nháp. */
export const ACTIONABLE_MAX_AGE_DAYS = 30
export const REFRESH_EVERY_DAYS = 7
export const GBP_FRESH_HOURS = 48
const REVIEWS_PER_FETCH = 30
const DAY = 86_400_000

export type WatchClient = {
  id: string
  workspace_id: string
  name: string
  area?: string | null
  industry?: string | null
  brand_voice?: string | null
  gbp_link?: string | null
  place_id?: string | null
}

export type WatchState = {
  last_checked_at: string | null
  last_refresh_at?: string | null
  gbp_synced_at?: string | null
  checks_count?: number | null
  reviews_fetched_total?: number | null
} | null

export type WatchResult = {
  client_id: string
  skipped?: 'recent' | 'no_identity' | 'plan' | 'gbp_fresh'
  error?: string
  source?: string
  fetched: number
  new_reviews: number
  drafts: number
  negative_tasks: number
  positive_task: boolean
  closed_tasks: number
  refresh: boolean
}

/** Đã tới lượt kiểm tra chưa theo tần suất của gói. */
export function dueForCheck(freq: ReviewEntitlement['frequency'], lastCheckedAt: string | null | undefined, now: Date): boolean {
  if (freq === 'none') return false
  if (!lastCheckedAt) return true
  const days = (now.getTime() - Date.parse(lastCheckedAt)) / DAY
  return freq === 'daily' ? days >= 0.8 : days >= 6
}

/**
 * Mốc cutoff gửi Outscraper (giây). Lần đầu: 30 ngày. Bình thường: từ lần trước (lùi 1 ngày cho chắc).
 * Quét rộng (refresh, mỗi 7 ngày): từ review còn mở cũ nhất, nhưng không xa hơn 30 ngày — để bắt phản hồi làm ngoài hệ thống.
 */
export function cutoffFor(state: WatchState, oldestOpenAt: string | null, now: Date): { cutoffSec: number; refresh: boolean } {
  const floor = now.getTime() - FIRST_RUN_LOOKBACK_DAYS * DAY
  if (!state?.last_checked_at) return { cutoffSec: Math.floor(floor / 1000), refresh: true }
  let since = Date.parse(state.last_checked_at) - DAY
  const refresh = !state.last_refresh_at || now.getTime() - Date.parse(state.last_refresh_at) >= REFRESH_EVERY_DAYS * DAY
  if (refresh && oldestOpenAt) since = Math.min(since, Math.max(Date.parse(oldestOpenAt) - DAY, floor))
  return { cutoffSec: Math.floor(Math.max(since, floor) / 1000), refresh }
}

function addDaysISO(days: number): string {
  const base = new Date(vnTodayISO() + 'T00:00:00Z')
  base.setUTCDate(base.getUTCDate() + days)
  return base.toISOString().slice(0, 10)
}

function clip(s: string, n: number) {
  return s.replace(/\s+/g, ' ').trim().slice(0, n)
}

export function isActionable(r: { reviewed_at: string | null }, now: Date): boolean {
  if (!r.reviewed_at) return true
  return now.getTime() - Date.parse(r.reviewed_at) <= ACTIONABLE_MAX_AGE_DAYS * DAY
}

/** Đóng việc của các review vừa được xử lý xong (đã đăng, dán tay, bỏ qua, chủ tự phản hồi). */
export async function closeTasksForReviews(admin: SupabaseClient, reviewIds: string[]): Promise<number> {
  if (!reviewIds.length) return 0
  const { data } = await admin.from('client_reviews').select('id, task_id, status').in('id', reviewIds)
  const taskIds = [...new Set((data || []).filter((r: any) => r.task_id && closesTask(r.status as ReviewStatus)).map((r: any) => r.task_id))]
  if (!taskIds.length) return 0
  // Việc "cảm ơn" gộp nhiều review: chỉ đóng khi mọi review gắn với việc đó đều xong.
  const { data: siblings } = await admin.from('client_reviews').select('task_id, status').in('task_id', taskIds)
  const stillOpen = new Set((siblings || []).filter((s: any) => !closesTask(s.status)).map((s: any) => s.task_id))
  const toClose = taskIds.filter((t) => !stillOpen.has(t))
  if (!toClose.length) return 0
  await admin.from('tasks').update({ status: 'done', completed_at: new Date().toISOString() }).in('id', toClose).neq('status', 'done')
  return toClose.length
}

export async function runReviewWatchForClient(
  admin: SupabaseClient,
  client: WatchClient,
  opts: { ent: ReviewEntitlement; dry?: boolean; force?: boolean; now?: Date; appUrl?: string } ,
): Promise<WatchResult> {
  const now = opts.now ?? new Date()
  const base: WatchResult = {
    client_id: client.id,
    fetched: 0,
    new_reviews: 0,
    drafts: 0,
    negative_tasks: 0,
    positive_task: false,
    closed_tasks: 0,
    refresh: false,
  }
  if (!client.place_id && !client.gbp_link && !client.name) return { ...base, skipped: 'no_identity' }
  if (opts.ent.frequency === 'none' && !opts.force) return { ...base, skipped: 'plan' }

  const stateRes = await admin.from('review_watch_state').select('*').eq('client_id', client.id).maybeSingle()
  if (stateRes.error) throw stateRes.error
  const state = stateRes.data as WatchState

  if (!opts.force && !dueForCheck(opts.ent.frequency, state?.last_checked_at, now)) return { ...base, skipped: 'recent' }
  if (state?.gbp_synced_at && now.getTime() - Date.parse(state.gbp_synced_at) < GBP_FRESH_HOURS * 3_600_000) {
    // Dữ liệu GBP (qua Make) mới hơn và miễn phí: không gọi nguồn trả phí, chỉ soạn nháp cho review mới nếu còn thiếu.
    const drafts = opts.dry ? 0 : await autoDraftPending(admin, client, opts.ent, now)
    return { ...base, skipped: 'gbp_fresh', drafts }
  }

  const { data: oldestOpen } = await admin
    .from('client_reviews')
    .select('reviewed_at')
    .eq('client_id', client.id)
    .in('status', ['new', 'drafted', 'approved', 'failed'])
    .not('reviewed_at', 'is', null)
    .order('reviewed_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  const { cutoffSec, refresh } = cutoffFor(state, (oldestOpen as any)?.reviewed_at ?? null, now)

  const { result, errors } = await fetchLatestReviews(
    { placeId: client.place_id, mapsUrl: client.gbp_link, name: client.name, area: client.area, cutoffSec, limit: REVIEWS_PER_FETCH },
    now.getTime(),
  )
  if (!result) {
    const message = errors.join(' | ').slice(0, 300) || 'Không lấy được review'
    if (!opts.dry) {
      await admin.from('review_watch_state').upsert({
        client_id: client.id,
        workspace_id: client.workspace_id,
        last_error: message,
        updated_at: now.toISOString(),
        ...(state?.last_checked_at ? { last_checked_at: state.last_checked_at } : {}),
      })
    }
    return { ...base, error: message }
  }

  const out: WatchResult = { ...base, source: result.source, fetched: result.items.length, refresh }
  if (opts.dry) {
    out.new_reviews = result.items.length
    return out
  }

  const ingest = await applyIngest(admin, client, result.items, { replyKnown: result.replyKnown, now })
  out.new_reviews = ingest.inserted.length
  out.closed_tasks += await closeTasksForReviews(admin, ingest.repliedElsewhereIds)

  if (opts.ent.autoDraft) out.drafts = await autoDraftPending(admin, client, opts.ent, now)

  const t = await createTasksForNew(admin, client, ingest.inserted, result.replyKnown, now, opts.appUrl)
  out.negative_tasks = t.negative_tasks
  out.positive_task = t.positive_task

  await admin.from('review_watch_state').upsert({
    client_id: client.id,
    workspace_id: client.workspace_id,
    last_checked_at: now.toISOString(),
    ...(refresh ? { last_refresh_at: now.toISOString() } : state?.last_refresh_at ? { last_refresh_at: state.last_refresh_at } : {}),
    last_rating: typeof result.rating === 'number' ? result.rating : null,
    last_review_count: typeof result.reviewCount === 'number' ? result.reviewCount : null,
    last_new_reviews: ingest.inserted.length,
    last_source: result.source,
    last_error: errors.length ? errors.join(' | ').slice(0, 300) : null,
    checks_count: (state?.checks_count ?? 0) + 1,
    reviews_fetched_total: (state?.reviews_fetched_total ?? 0) + result.items.length,
    updated_at: now.toISOString(),
  })

  return out
}

/**
 * Tạo việc cho review mới cần xử lý: ≤3★ hoặc khẩn -> 1 việc ưu tiên cao / review (tối đa 5 / lượt);
 * 4–5★ chưa phản hồi (chỉ khi nguồn biết chắc) -> gộp 1 việc "cảm ơn" mức thấp. Review cũ (> 30 ngày) không tạo việc.
 */
export async function createTasksForNew(
  admin: SupabaseClient,
  client: WatchClient,
  inserted: InsertedReview[],
  replyKnown: boolean,
  now: Date,
  appUrl?: string,
): Promise<{ negative_tasks: number; positive_task: boolean }> {
  const res = { negative_tasks: 0, positive_task: false }
  const fresh = inserted.filter((r) => r.status === 'new' && isActionable(r, now))
  const link = `${appUrl || ''}/clients/${client.id}/reviews`
  const negatives = fresh
    .filter((r) => r.rating <= NEGATIVE_MAX_RATING || r.urgency === 'high')
    .sort((a, b) => a.rating - b.rating)
    .slice(0, MAX_NEGATIVE_TASKS_PER_RUN)
  for (const r of negatives) {
    const description = [
      `Có review ${r.rating}★ mới${r.relative_time ? ` (${r.relative_time})` : ''} trên Google Maps của ${client.name}.`,
      r.review_text ? `Khách viết: "${clip(r.review_text, 300)}"` : 'Khách chỉ chấm sao, không viết nội dung.',
      r.urgency === 'high' ? 'Mức độ: KHẨN — nên phản hồi trong 24 giờ.' : '',
      r.draft_warnings.length ? r.draft_warnings[0] : 'Chủ doanh nghiệp chưa phản hồi.',
      `\nXem bản nháp, sửa và duyệt phản hồi tại: ${link}`,
    ]
      .filter(Boolean)
      .join('\n')
    const taskRes = await admin
      .from('tasks')
      .insert({
        client_id: client.id,
        workspace_id: client.workspace_id,
        module_key: 'maps_seo',
        title: `Phản hồi review ${r.rating}★ mới của ${client.name}`,
        description,
        task_type: 'review',
        priority: 'high',
        due_date: addDaysISO(r.urgency === 'high' ? 1 : 2),
        status: 'pending',
      })
      .select('id')
      .single()
    if (taskRes.error) throw taskRes.error
    await admin.from('client_reviews').update({ task_id: taskRes.data.id }).eq('id', r.id)
    res.negative_tasks += 1
  }

  const positives = replyKnown ? fresh.filter((r) => r.rating > NEGATIVE_MAX_RATING && r.urgency !== 'high') : []
  if (positives.length) {
    const lines = positives.slice(0, 10).map((r) => `- ${r.rating}★${r.review_text ? `: "${clip(r.review_text, 100)}"` : ''}`)
    const taskRes = await admin
      .from('tasks')
      .insert({
        client_id: client.id,
        workspace_id: client.workspace_id,
        module_key: 'maps_seo',
        title: `Cảm ơn ${positives.length} review tốt mới của ${client.name}`,
        description: `Có ${positives.length} review 4–5★ mới chưa được phản hồi:\n${lines.join('\n')}\n\nMột lời cảm ơn ngắn, nhắc đúng điều khách khen, giúp hồ sơ trông được chăm chút.\n\nDuyệt phản hồi tại: ${link}`,
        task_type: 'review',
        priority: 'low',
        due_date: addDaysISO(5),
        status: 'pending',
      })
      .select('id')
      .single()
    if (taskRes.error) throw taskRes.error
    await admin.from('client_reviews').update({ task_id: taskRes.data.id }).in('id', positives.map((r) => r.id))
    res.positive_task = true
  }

  return res
}

/** Soạn nháp cho review 'new' gần đây chưa có nháp (khẩn và ít sao trước), trong trần nháp tháng. */
export async function autoDraftPending(admin: SupabaseClient, client: WatchClient, ent: ReviewEntitlement, now: Date): Promise<number> {
  if (!ent.autoDraft || !process.env.ANTHROPIC_API_KEY) return 0
  const since = new Date(now.getTime() - ACTIONABLE_MAX_AGE_DAYS * DAY).toISOString()
  const { data } = await admin
    .from('client_reviews')
    .select('id, rating, review_text, author_name, status, urgency, draft_warnings, reviewed_at')
    .eq('client_id', client.id)
    .eq('status', 'new')
    .is('draft_reply', null)
    .or(`reviewed_at.gte.${since},reviewed_at.is.null`)
    .order('rating', { ascending: true })
    .limit(MAX_AUTO_DRAFTS_PER_CLIENT_RUN * 2)
  const rank = (u: string) => (u === 'high' ? 0 : u === 'normal' ? 1 : 2)
  const queue = ((data || []) as any[]).sort((a, b) => rank(a.urgency) - rank(b.urgency) || a.rating - b.rating).slice(0, MAX_AUTO_DRAFTS_PER_CLIENT_RUN)
  let n = 0
  for (const r of queue) {
    const res = await draftReview(admin, r, client, { kind: 'auto', monthlyDrafts: ent.monthlyDrafts, now })
    if (res.ok) n += 1
    else if (res.reason === 'quota' || res.reason === 'no_ai') break
  }
  return n
}

/**
 * Nhập review có sẵn trong bản chụp hồ sơ gần nhất (gbp_snapshots.reviews, lấy lúc "Kiểm tra hồ sơ") — KHÔNG tốn credit.
 * Dùng cho gói Miễn phí và để hộp thư có dữ liệu ngay khi mới bật. Bản chụp không có tên người viết -> khớp theo nội dung.
 */
export async function importFromLatestSnapshot(admin: SupabaseClient, client: WatchClient, now = new Date()): Promise<{ imported: number; snapshotAt: string | null }> {
  const { data: snap } = await admin
    .from('gbp_snapshots')
    .select('reviews, source, captured_at')
    .eq('client_id', client.id)
    .in('status', ['ok', 'partial'])
    .order('captured_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  const list = Array.isArray((snap as any)?.reviews) ? ((snap as any).reviews as any[]) : []
  if (!list.length) return { imported: 0, snapshotAt: (snap as any)?.captured_at ?? null }
  const replyKnown = (snap as any).source === 'outscraper' || list.some((r) => r?.reply)
  const items: IncomingReview[] = list
    .filter((r) => typeof r?.rating === 'number' && r.rating >= 1 && r.rating <= 5)
    .map((r) => ({
      source: 'snapshot',
      source_review_id: null,
      author_name: null,
      rating: Math.round(r.rating),
      text: String(r.text || '').slice(0, 2000),
      reviewed_at: r.posted_at || null,
      reviewed_at_exact: Boolean(r.posted_at),
      relative_time: r.relative_time || null,
      owner_reply: r.reply ? String(r.reply) : replyKnown ? null : undefined,
      owner_reply_at: null,
    }))
  const res = await applyIngest(admin, client, items, { replyKnown, now })
  return { imported: res.inserted.length, snapshotAt: (snap as any).captured_at }
}
