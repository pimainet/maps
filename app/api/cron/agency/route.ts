// Cron hằng ngày (Vercel Hobby: 1 lần/ngày) cho gói Làm hộ:
//  1) Ngày 1–7 hằng tháng (giờ VN): tạo BẢN NHÁP báo cáo tháng vừa qua cho từng khách Làm hộ chưa có báo cáo.
//     Nhân viên xem lại rồi bấm "Gửi cho khách" ở /agency (không tự gửi email cho khách).
//  2) Email tóm tắt việc đang chờ cho admin (bài/phản hồi chờ duyệt, việc quá hạn, báo cáo cần gửi, yêu cầu tư vấn) — chỉ gửi khi có việc.
//     Tắt bằng AGENCY_DIGEST_DISABLED=true.
// Bật bằng NEXT_PUBLIC_DONE_FOR_YOU_ENABLED=true. Bảo vệ bằng CRON_SECRET như các cron khác.
import crypto from 'node:crypto'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { DONE_FOR_YOU_ENABLED } from '@/lib/features'
import { appUrl } from '@/lib/notifications'
import { notifyAdmins } from '@/lib/billing/reconcile'
import { addMonths, periodMonthDate, vnDayOfMonth, vnPeriodOf } from '@/lib/agency/report'
import { agencyDigestHasWork, buildAgencyDigestEmail } from '@/lib/agency/emails'
import { doneForYouWorkspaces, generateReport, loadQueue } from '@/lib/agency/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  const a = Buffer.from(req.headers.get('authorization') || '')
  const b = Buffer.from(`Bearer ${secret}`)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

export async function GET(req: Request) {
  if (!process.env.CRON_SECRET) return NextResponse.json({ error: 'Chưa đặt CRON_SECRET nên route này đang tắt.' }, { status: 503 })
  if (!authorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!DONE_FOR_YOU_ENABLED) return NextResponse.json({ skipped: 'DONE_FOR_YOU_ENABLED tắt' })

  const out: Record<string, unknown> = {}
  const now = new Date()
  const deadline = Date.now() + 100_000

  try {
    // 1) Bản nháp báo cáo tháng vừa qua
    if (vnDayOfMonth(now) <= 7) {
      const period = addMonths(vnPeriodOf(now), -1)
      const wss = await doneForYouWorkspaces(supabaseAdmin)
      const { data: clients } = wss.length ? await supabaseAdmin.from('clients').select('id').in('workspace_id', wss.map((w) => w.id)).limit(500) : { data: [] as any[] }
      const ids = (clients || []).map((c: any) => c.id as string)
      const { data: have } = ids.length ? await supabaseAdmin.from('agency_monthly_reports').select('client_id').in('client_id', ids).eq('period_month', periodMonthDate(period)) : { data: [] as any[] }
      const done = new Set((have || []).map((r: any) => r.client_id))
      let created = 0
      const errors: string[] = []
      for (const id of ids) {
        if (done.has(id)) continue
        if (Date.now() > deadline) break
        try {
          const r = await generateReport(supabaseAdmin, id, period, null, now)
          if (r.row) created++
        } catch (e: any) {
          if (errors.length < 5) errors.push(`${id}: ${String(e?.message || e).slice(0, 120)}`)
        }
      }
      out.reports = { period, clients: ids.length, created, errors }
    } else {
      out.reports = { skipped: 'ngoài ngày 1–7' }
    }

    // 2) Tóm tắt cho nhân viên
    if (process.env.AGENCY_DIGEST_DISABLED === 'true') {
      out.digest = { skipped: 'AGENCY_DIGEST_DISABLED' }
    } else {
      const q = await loadQueue(supabaseAdmin, now)
      const { count: leads } = await supabaseAdmin.from('consultation_requests').select('id', { count: 'exact', head: true }).in('status', ['new', 'contacted', 'quoted'])
      const digest = { posts: q.totals.posts, reviews: q.totals.reviews, urgentReviews: q.totals.urgentReviews, tasks: q.totals.tasksOverdue, reportsDue: q.totals.reportsDue, leads: leads || 0 }
      out.digest = { ...digest, sent: 0 }
      if (agencyDigestHasWork(digest)) (out.digest as any).sent = await notifyAdmins(supabaseAdmin, buildAgencyDigestEmail(digest, `${appUrl()}/agency`))
    }
    return NextResponse.json({ ok: true, ...out })
  } catch (e: any) {
    console.error('agency cron failed:', e?.message || e)
    return NextResponse.json({ ok: false, ...out, error: 'Lỗi khi chạy cron Làm hộ.' }, { status: 500 })
  }
}
