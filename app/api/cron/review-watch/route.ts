// Vercel Cron gọi route này MỖI NGÀY 09:00 giờ VN (xem vercel.json). Tần suất thật theo gói (lib/billing/plans.ts REVIEW_LIMITS):
// Nâng cao hàng ngày, Khởi động hàng tuần, Miễn phí không quét. Xem lib/review-watch.ts.
//
// Bật bằng NEXT_PUBLIC_REVIEW_INBOX_ENABLED=true + REVIEW_WATCH_ENABLED=true (mặc định TẮT vì mỗi lần chạy tốn credit Outscraper/SearchApi/SerpApi + Claude).
// Cần đã chạy migration 029_review_inbox.sql.
// Bảo vệ: header "Authorization: Bearer <CRON_SECRET>". ?dry=1 xem sẽ lấy bao nhiêu review mà không ghi gì (vẫn gọi nguồn dữ liệu).
// ?client_id=<uuid> chạy đúng 1 doanh nghiệp, bỏ qua giới hạn tần suất (vẫn theo gói).
// Chặn chi phí: REVIEW_WATCH_MAX_CLIENTS (mặc định 30) doanh nghiệp / lượt, ưu tiên doanh nghiệp lâu chưa kiểm tra nhất.
import crypto from 'node:crypto'
import { NextResponse } from 'next/server'
import { effectivePlansFor } from '@/lib/billing/server'
import { reviewEntitlement } from '@/lib/billing/plans'
import { dueForCheck, runReviewWatchForClient, type WatchClient, type WatchResult } from '@/lib/review-watch'
import { reviewWatchCronOn } from '@/lib/features'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

const MAX_CLIENTS_PER_RUN = Math.max(1, Math.min(500, Number(process.env.REVIEW_WATCH_MAX_CLIENTS || 30) || 30))
const CONCURRENCY = 3
const TIME_BUDGET_MS = 240_000

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  const a = Buffer.from(req.headers.get('authorization') || '')
  const b = Buffer.from(`Bearer ${secret}`)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

export async function GET(req: Request) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Chưa đặt CRON_SECRET nên route này đang tắt.' }, { status: 503 })
  }
  if (!authorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!reviewWatchCronOn()) {
    return NextResponse.json({ error: 'Review Watch đang tắt (cần NEXT_PUBLIC_REVIEW_INBOX_ENABLED=true và REVIEW_WATCH_ENABLED=true).' }, { status: 503 })
  }
  if (!process.env.OUTSCRAPER_API_KEY && !process.env.SEARCHAPI_API_KEY && !process.env.SERPAPI_API_KEY) {
    return NextResponse.json({ error: 'Thiếu OUTSCRAPER_API_KEY (hoặc SEARCHAPI_API_KEY / SERPAPI_API_KEY).' }, { status: 503 })
  }

  const url = new URL(req.url)
  const dry = url.searchParams.get('dry') === '1'
  const onlyClient = url.searchParams.get('client_id')
  const startedAt = Date.now()
  const now = new Date()
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/$/, '')

  const summary = {
    dry,
    max_clients: MAX_CLIENTS_PER_RUN,
    clients_checked: 0,
    skipped_recent: 0,
    skipped_no_identity: 0,
    skipped_plan: 0,
    skipped_gbp_fresh: 0,
    fetched: 0,
    new_reviews: 0,
    drafts: 0,
    negative_tasks: 0,
    positive_tasks: 0,
    closed_tasks: 0,
    failed: 0,
    truncated: false,
    errors: [] as string[],
  }

  try {
    const { supabaseAdmin: admin } = await import('@/lib/supabase/admin')

    let q = admin
      .from('clients')
      .select('id, workspace_id, name, area, industry, brand_voice, gbp_link, place_id')
      .or('place_id.not.is.null,gbp_link.not.is.null')
      .limit(2000)
    if (onlyClient) q = q.eq('id', onlyClient)
    const clientsRes = await q
    if (clientsRes.error) throw clientsRes.error
    const candidates = (clientsRes.data || []) as WatchClient[]
    if (candidates.length === 0) return NextResponse.json({ ...summary, message: 'Không có doanh nghiệp nào có link/place_id.' })

    const plans = await effectivePlansFor(candidates.map((c) => c.workspace_id))
    const entOf = (c: WatchClient) => reviewEntitlement(plans.get(c.workspace_id) ?? 'free')
    const eligible = candidates.filter((c) => entOf(c).frequency !== 'none')
    summary.skipped_plan = candidates.length - eligible.length
    if (eligible.length === 0) return NextResponse.json({ ...summary, message: 'Không có doanh nghiệp nào thuộc gói có theo dõi review.' })

    const statesRes = await admin
      .from('review_watch_state')
      .select('client_id, last_checked_at')
      .in('client_id', eligible.map((c) => c.id))
    if (statesRes.error) throw statesRes.error
    const last = new Map<string, string | null>((statesRes.data || []).map((s: any) => [s.client_id, s.last_checked_at]))
    const ts = (id: string) => (last.get(id) ? Date.parse(last.get(id) as string) : 0)
    const queue = [...eligible].sort((a, b) => ts(a.id) - ts(b.id))

    const picked: WatchClient[] = []
    for (const c of queue) {
      if (!onlyClient && !dueForCheck(entOf(c).frequency, last.get(c.id), now)) {
        summary.skipped_recent += 1
        continue
      }
      if (picked.length >= MAX_CLIENTS_PER_RUN) {
        summary.truncated = true
        break
      }
      picked.push(c)
    }

    const handle = (r: WatchResult) => {
      summary.clients_checked += 1
      if (r.skipped === 'recent') summary.skipped_recent += 1
      else if (r.skipped === 'no_identity') summary.skipped_no_identity += 1
      else if (r.skipped === 'plan') summary.skipped_plan += 1
      else if (r.skipped === 'gbp_fresh') summary.skipped_gbp_fresh += 1
      else if (r.error) {
        summary.failed += 1
        if (summary.errors.length < 10) summary.errors.push(`${r.client_id}: ${r.error}`)
      }
      summary.fetched += r.fetched
      summary.new_reviews += r.new_reviews
      summary.drafts += r.drafts
      summary.negative_tasks += r.negative_tasks
      summary.closed_tasks += r.closed_tasks
      if (r.positive_task) summary.positive_tasks += 1
    }

    let idx = 0
    const worker = async () => {
      while (idx < picked.length) {
        if (Date.now() - startedAt > TIME_BUDGET_MS) {
          summary.truncated = true
          return
        }
        const c = picked[idx++]
        try {
          handle(await runReviewWatchForClient(admin, c, { ent: entOf(c), dry, force: Boolean(onlyClient), now, appUrl }))
        } catch (e: any) {
          summary.failed += 1
          if (summary.errors.length < 10) summary.errors.push(`${c.id}: ${String(e?.message || e).slice(0, 160)}`)
        }
      }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, worker))

    return NextResponse.json(summary)
  } catch (e: any) {
    console.error('review-watch cron failed:', e?.message || e)
    return NextResponse.json({ ...summary, error: 'Lỗi khi chạy Review Watch.' }, { status: 500 })
  }
}
