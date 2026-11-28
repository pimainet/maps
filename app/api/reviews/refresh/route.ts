// POST /api/reviews/refresh { client_id, fetch?: boolean }
//  - Luôn: nhập review mới có trong bản chụp hồ sơ gần nhất (miễn phí).
//  - fetch=true: gọi nguồn dữ liệu trả phí ngay ("Kiểm tra review ngay") nếu gói còn lượt (manualChecksPerMonth),
//    cách lần trước ≥ 1 giờ, và đã có OUTSCRAPER_API_KEY / SEARCHAPI_API_KEY / SERPAPI_API_KEY.
import { NextResponse } from 'next/server'
import { requireActiveWorkspaceId } from '@/lib/auth'
import { getClientById } from '@/lib/db'
import { isUuid } from '@/lib/autopost/secret'
import { getReviewEntitlement } from '@/lib/billing/server'
import { autoDraftPending, importFromLatestSnapshot, runReviewWatchForClient } from '@/lib/review-watch'
import { inboxOff, routeError, vnMonthKey } from '@/lib/reviews/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

const COOLDOWN_MS = 60 * 60 * 1000

export async function POST(req: Request) {
  const off = inboxOff()
  if (off) return off
  try {
    const workspaceId = await requireActiveWorkspaceId()
    const body = await req.json().catch(() => null)
    if (!isUuid(body?.client_id)) return NextResponse.json({ error: 'Thiếu doanh nghiệp.' }, { status: 400 })
    const client = await getClientById(body.client_id, workspaceId)
    if (!client) return NextResponse.json({ error: 'Không tìm thấy doanh nghiệp này.' }, { status: 404 })
    const { supabaseAdmin: admin } = await import('@/lib/supabase/admin')
    const { reviews: ent } = await getReviewEntitlement(workspaceId)
    const now = new Date()

    const snap = await importFromLatestSnapshot(admin, client as any, now)
    if (body?.fetch !== true) {
      const drafts = ent.autoDraft ? await autoDraftPending(admin, client as any, ent, now) : 0
      return NextResponse.json({ ok: true, imported: snap.imported, snapshot_at: snap.snapshotAt, drafts })
    }

    if (ent.manualChecksPerMonth <= 0) {
      return NextResponse.json({ error: 'Gói hiện tại chưa có "Kiểm tra review ngay". Review được lấy từ lần kiểm tra hồ sơ gần nhất.', code: 'plan' }, { status: 403 })
    }
    if (!process.env.OUTSCRAPER_API_KEY && !process.env.SEARCHAPI_API_KEY && !process.env.SERPAPI_API_KEY) {
      return NextResponse.json({ error: 'Chưa cấu hình nguồn dữ liệu review.', code: 'no_source' }, { status: 503 })
    }
    const { data: st } = await admin
      .from('review_watch_state')
      .select('last_checked_at, manual_checks_month, manual_checks_count')
      .eq('client_id', client.id)
      .maybeSingle()
    const month = vnMonthKey(now)
    const used = (st as any)?.manual_checks_month === month ? (st as any).manual_checks_count : 0
    if (used >= ent.manualChecksPerMonth) {
      return NextResponse.json({ error: `Đã dùng hết ${ent.manualChecksPerMonth} lần kiểm tra ngay trong tháng.`, code: 'quota' }, { status: 429 })
    }
    if ((st as any)?.last_checked_at && now.getTime() - Date.parse((st as any).last_checked_at) < COOLDOWN_MS) {
      return NextResponse.json({ error: 'Vừa kiểm tra xong, hãy thử lại sau 1 giờ.', code: 'cooldown' }, { status: 429 })
    }

    const appUrl = (process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/$/, '')
    const r = await runReviewWatchForClient(admin, client as any, { ent, force: true, now, appUrl })
    if (!r.error) {
      await admin.from('review_watch_state').update({ manual_checks_month: month, manual_checks_count: used + 1 }).eq('client_id', client.id)
    }
    if (r.error) return NextResponse.json({ error: `Không lấy được review: ${r.error}` }, { status: 502 })
    return NextResponse.json({ ok: true, imported: snap.imported, ...r, manual_checks_left: ent.manualChecksPerMonth - used - 1 })
  } catch (error: any) {
    return routeError(error)
  }
}
