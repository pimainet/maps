// GET /api/agency/reports?client_id=<uuid>[&period=YYYY-MM] — khách xem báo cáo tháng ĐÃ GỬI của doanh nghiệp mình
// (workspace đang chọn). Bản nháp không bao giờ lộ ra ở đây.
import { NextResponse } from 'next/server'
import { errorStatus, publicError } from '@/lib/api-error'
import { requireActiveWorkspaceId } from '@/lib/auth'
import { isUuid } from '@/lib/autopost/secret'
import { DONE_FOR_YOU_ENABLED } from '@/lib/features'
import { isPeriod, periodMonthDate } from '@/lib/agency/report'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  if (!DONE_FOR_YOU_ENABLED) return NextResponse.json({ error: 'Chưa có báo cáo.' }, { status: 404 })
  try {
    const workspaceId = await requireActiveWorkspaceId()
    const u = new URL(req.url)
    const clientId = u.searchParams.get('client_id')
    if (!isUuid(clientId)) return NextResponse.json({ error: 'Thiếu doanh nghiệp.' }, { status: 400 })
    const period = u.searchParams.get('period')
    if (period && !isPeriod(period)) return NextResponse.json({ error: 'Kỳ báo cáo không hợp lệ.' }, { status: 400 })
    const { supabaseAdmin: admin } = await import('@/lib/supabase/admin')
    const { data: client } = await admin.from('clients').select('id, name').eq('id', clientId).eq('workspace_id', workspaceId).maybeSingle()
    if (!client) return NextResponse.json({ error: 'Không tìm thấy doanh nghiệp này.' }, { status: 404 })
    const { data, error } = await admin
      .from('agency_monthly_reports')
      .select('id, period_month, summary, sent_at')
      .eq('client_id', clientId)
      .eq('workspace_id', workspaceId)
      .eq('status', 'sent')
      .order('period_month', { ascending: false })
      .limit(24)
    if (error) {
      if (error.code === '42P01') return NextResponse.json({ client: { id: clientId, name: (client as any).name }, reports: [], selected: null })
      throw error
    }
    const reports = (data || []) as any[]
    const selected = period ? reports.find((r) => String(r.period_month).slice(0, 7) === period) ?? null : reports[0] ?? null
    return NextResponse.json({
      client: { id: clientId, name: (client as any).name },
      periods: reports.map((r) => ({ period: String(r.period_month).slice(0, 7), sent_at: r.sent_at })),
      selected: selected ? { period: String(selected.period_month).slice(0, 7), sent_at: selected.sent_at, report: selected.summary } : null,
    })
  } catch (error) {
    return NextResponse.json({ error: publicError(error) }, { status: errorStatus(error) })
  }
}
