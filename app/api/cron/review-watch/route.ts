// Vercel Cron gọi route này mỗi tuần (xem vercel.json): với mỗi doanh nghiệp, lấy review mới từ Outscraper và
// tự tạo việc phản hồi (kèm bản nháp) cho review thấp sao chưa được phản hồi. Xem lib/review-watch.ts.
//
// Bật bằng biến môi trường REVIEW_WATCH_ENABLED=true (mặc định TẮT vì mỗi lần chạy tốn credit Outscraper + Claude).
// Bảo vệ: header "Authorization: Bearer <CRON_SECRET>". Thêm ?dry=1 để xem sẽ tạo bao nhiêu việc mà không ghi gì.
// ?client_id=<uuid> để chạy đúng 1 doanh nghiệp (bỏ qua giới hạn 6 ngày không áp dụng cho dry).
import crypto from 'node:crypto'
import { NextResponse } from 'next/server'
import { outscraperConfigured } from '@/lib/gbp-outscraper'
import { runReviewWatchForClient, type WatchClient, type WatchResult } from '@/lib/review-watch'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

const MAX_CLIENTS_PER_RUN = Number(process.env.REVIEW_WATCH_MAX_CLIENTS || 30)
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
  if (process.env.REVIEW_WATCH_ENABLED !== 'true') {
    return NextResponse.json({ error: 'Review Watch đang tắt (đặt REVIEW_WATCH_ENABLED=true để bật).' }, { status: 503 })
  }
  if (!outscraperConfigured()) {
    return NextResponse.json({ error: 'Thiếu OUTSCRAPER_API_KEY.' }, { status: 503 })
  }

  const url = new URL(req.url)
  const dry = url.searchParams.get('dry') === '1'
  const onlyClient = url.searchParams.get('client_id')
  const startedAt = Date.now()

  const summary = {
    dry,
    clients_checked: 0,
    skipped_recent: 0,
    skipped_no_identity: 0,
    new_reviews: 0,
    negative_tasks: 0,
    positive_tasks: 0,
    failed: 0,
    truncated: false,
    errors: [] as string[],
  }

  try {
    const { supabaseAdmin: admin } = await import('@/lib/supabase/admin')

    let q = admin
      .from('clients')
      .select('id, workspace_id, name, area, gbp_link, place_id')
      .or('place_id.not.is.null,gbp_link.not.is.null')
      .limit(2000)
    if (onlyClient) q = q.eq('id', onlyClient)
    const clientsRes = await q
    if (clientsRes.error) throw clientsRes.error
    const all = (clientsRes.data || []) as WatchClient[]
    if (all.length === 0) return NextResponse.json({ ...summary, message: 'Không có doanh nghiệp nào có link/place_id.' })

    // Ưu tiên doanh nghiệp chưa kiểm tra hoặc kiểm tra lâu nhất
    const statesRes = await admin
      .from('review_watch_state')
      .select('client_id, last_checked_at')
      .in('client_id', all.map((c) => c.id))
    const last = new Map<string, number>(
      (statesRes.data || []).map((s: any) => [s.client_id, s.last_checked_at ? new Date(s.last_checked_at).getTime() : 0]),
    )
    const queue = [...all].sort((a, b) => (last.get(a.id) ?? 0) - (last.get(b.id) ?? 0))

    const picked: WatchClient[] = []
    for (const c of queue) {
      const ts = last.get(c.id) ?? 0
      if (!onlyClient && ts && Date.now() - ts < 6 * 86_400_000) {
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
      else if (r.error) {
        summary.failed += 1
        if (summary.errors.length < 10) summary.errors.push(`${r.client_id}: ${r.error}`)
      }
      summary.new_reviews += r.new_reviews
      summary.negative_tasks += r.negative_tasks
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
          handle(await runReviewWatchForClient(admin, c, { dry }))
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
