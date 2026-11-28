// Báo cáo tháng của khách gói Làm hộ (chỉ Super Admin).
//  GET  ?client_id=<uuid>&period=YYYY-MM  -> bản đã lưu (nháp/đã gửi) hoặc bản xem trước dựng ngay (chưa lưu) + các kỳ đã có
//  POST { client_id, period, action: 'generate' }              -> tạo/ghi đè bản NHÁP (bản đã gửi thì không đè)
//  POST { report_id, action: 'send', email?: boolean }          -> công bố cho khách + gửi email owner/admin của workspace
import { NextResponse } from 'next/server'
import { supabaseAdmin as admin } from '@/lib/supabase/admin'
import { isUuid } from '@/lib/autopost/secret'
import { agencyError, buildReportForClient, generateReport, isDoneForYouWorkspace, logAgencyAction, sendReport, staffGuard } from '@/lib/agency/server'
import { isPeriod, periodMonthDate, upcomingReportPeriod } from '@/lib/agency/report'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const err = (error: string, status: number, code?: string) => NextResponse.json({ error, code }, { status })

export async function GET(req: Request) {
  const g = await staffGuard()
  if ('res' in g) return g.res
  try {
    const u = new URL(req.url)
    const clientId = u.searchParams.get('client_id')
    if (!isUuid(clientId)) return err('Thiếu doanh nghiệp.', 400)
    const period = u.searchParams.get('period') || upcomingReportPeriod(new Date()).period
    if (!isPeriod(period)) return err('Kỳ báo cáo không hợp lệ (YYYY-MM).', 400)
    const { data: client } = await admin.from('clients').select('id, name, workspace_id').eq('id', clientId).maybeSingle()
    if (!client) return err('Không tìm thấy doanh nghiệp.', 404)
    if (!(await isDoneForYouWorkspace((client as any).workspace_id))) return err('Khách này không còn ở gói Làm hộ.', 409, 'not_done_for_you')

    const [{ data: saved }, { data: all }] = await Promise.all([
      admin.from('agency_monthly_reports').select('id, status, summary, generated_at, sent_at, sent_to').eq('client_id', clientId).eq('period_month', periodMonthDate(period)).maybeSingle(),
      admin.from('agency_monthly_reports').select('id, period_month, status, sent_at').eq('client_id', clientId).order('period_month', { ascending: false }).limit(24),
    ])
    let preview = null
    if (!saved) preview = (await buildReportForClient(admin, clientId, period))?.report ?? null
    return NextResponse.json({ client: { id: clientId, name: (client as any).name }, period, saved: saved ?? null, preview, periods: all ?? [] })
  } catch (e: any) {
    return agencyError(e)
  }
}

export async function POST(req: Request) {
  const g = await staffGuard()
  if ('res' in g) return g.res
  const actor = g.staff.id
  try {
    const body = await req.json().catch(() => null)
    if (body?.action === 'generate') {
      if (!isUuid(body?.client_id) || !isPeriod(body?.period)) return err('Thiếu doanh nghiệp hoặc kỳ báo cáo.', 400)
      const { data: client } = await admin.from('clients').select('workspace_id').eq('id', body.client_id).maybeSingle()
      if (!client) return err('Không tìm thấy doanh nghiệp.', 404)
      if (!(await isDoneForYouWorkspace((client as any).workspace_id))) return err('Khách này không còn ở gói Làm hộ.', 409, 'not_done_for_you')
      const r = await generateReport(admin, body.client_id, body.period, actor)
      if (r.reason === 'already_sent') return err('Báo cáo kỳ này đã gửi cho khách, không tạo lại được.', 409, 'already_sent')
      if (!r.row) return err('Không tạo được báo cáo.', 404)
      await logAgencyAction(admin, { actor, workspaceId: r.row.workspace_id, clientId: r.row.client_id, kind: 'report_generate', refId: r.row.id, data: { period: body.period } })
      return NextResponse.json({ ok: true, report: r.row })
    }
    if (body?.action === 'send') {
      if (!isUuid(body?.report_id)) return err('Thiếu báo cáo.', 400)
      const r = await sendReport(admin, body.report_id, actor, { email: body.email !== false })
      if (!r.ok) return err(r.error, r.status)
      return NextResponse.json(r)
    }
    return err('Hành động không hợp lệ.', 400)
  } catch (e: any) {
    return agencyError(e)
  }
}
