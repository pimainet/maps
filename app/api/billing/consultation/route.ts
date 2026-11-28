// Gói Làm hộ không có thanh toán tự phục vụ: khách bấm "Liên hệ tư vấn" -> lưu yêu cầu + email báo admin (Resend).
// Sau tư vấn, admin tạo đơn cho workspace (POST /api/admin/billing/orders) và đơn tự kích hoạt khi tiền về (SePay).
import { NextResponse } from 'next/server'
import { errorStatus, publicError } from '@/lib/api-error'
import { getCurrentUser, requireActiveWorkspaceAdmin } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { DONE_FOR_YOU_ENABLED } from '@/lib/features'
import { readJsonObject } from '@/lib/request-body'
import { appUrl } from '@/lib/notifications'
import { notifyAdmins } from '@/lib/billing/reconcile'
import { parseLead } from '@/lib/agency/lead'
import { buildConsultationAdminEmail } from '@/lib/agency/emails'
import { agencyError } from '@/lib/agency/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_PER_USER_PER_DAY = 5
const OPEN = ['new', 'contacted', 'quoted']

const off = () => NextResponse.json({ error: 'Gói Làm hộ chưa mở.' }, { status: 404 })

/** Yêu cầu tư vấn mới nhất của workspace (để trang /billing hiện "đã gửi"). */
export async function GET() {
  if (!DONE_FOR_YOU_ENABLED) return off()
  try {
    const workspaceId = await requireActiveWorkspaceAdmin()
    const { data, error } = await supabaseAdmin
      .from('consultation_requests')
      .select('id, status, created_at, contact_name, phone')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false })
      .limit(1)
    if (error) throw error
    return NextResponse.json({ request: data?.[0] ?? null, open: !!data?.[0] && OPEN.includes((data[0] as any).status) })
  } catch (error) {
    return agencyError(error)
  }
}

export async function POST(req: Request) {
  if (!DONE_FOR_YOU_ENABLED) return off()
  try {
    const workspaceId = await requireActiveWorkspaceAdmin()
    const user = await getCurrentUser()
    const parsed = await readJsonObject(req)
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status })
    const lead = parseLead(parsed.value)
    if (!lead.ok) return NextResponse.json({ error: lead.error }, { status: 400 })

    // Đã có yêu cầu đang mở: không tạo thêm, báo lại là đã nhận
    const { data: open, error: oErr } = await supabaseAdmin
      .from('consultation_requests')
      .select('id, status, created_at')
      .eq('workspace_id', workspaceId)
      .in('status', OPEN)
      .limit(1)
    if (oErr) throw oErr
    if (open?.length) return NextResponse.json({ ok: true, already: true, request: open[0] })

    if (user?.id) {
      const since = new Date(Date.now() - 86_400_000).toISOString()
      const { count } = await supabaseAdmin.from('consultation_requests').select('id', { count: 'exact', head: true }).eq('user_id', user.id).gte('created_at', since)
      if ((count || 0) >= MAX_PER_USER_PER_DAY) return NextResponse.json({ error: 'Bạn đã gửi quá nhiều yêu cầu hôm nay, vui lòng thử lại ngày mai.' }, { status: 429 })
    }

    const { data: ws } = await supabaseAdmin.from('workspaces').select('name').eq('id', workspaceId).maybeSingle()
    const { data: row, error } = await supabaseAdmin
      .from('consultation_requests')
      .insert({ workspace_id: workspaceId, user_id: user?.id ?? null, ...lead.value, email: lead.value.email ?? user?.email ?? null })
      .select('id, status, created_at')
      .single()
    if (error) {
      if ((error as any).code === '23505') return NextResponse.json({ ok: true, already: true })
      throw error
    }

    // Báo admin qua Resend; lỗi/chưa cấu hình không làm hỏng yêu cầu (đã lưu, hiện ở /agency)
    let notified = 0
    try {
      const mail = buildConsultationAdminEmail({ lead: lead.value, workspaceName: (ws as any)?.name ?? null, userEmail: user?.email, adminUrl: `${appUrl()}/agency?tab=leads` })
      notified = await notifyAdmins(supabaseAdmin, mail)
      if (notified > 0) await supabaseAdmin.from('consultation_requests').update({ notified_at: new Date().toISOString() }).eq('id', (row as any).id)
    } catch (e: any) {
      console.error('consultation admin email failed:', e?.message)
    }
    return NextResponse.json({ ok: true, request: row, notified: notified > 0 })
  } catch (error) {
    const s = errorStatus(error)
    return s === 500 ? agencyError(error) : NextResponse.json({ error: publicError(error) }, { status: s })
  }
}
