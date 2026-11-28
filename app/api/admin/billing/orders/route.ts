// Admin tạo đơn cho 1 workspace (chủ yếu gói Làm hộ, bán qua tư vấn).
// Đơn là 'manual' + 'pending' như đơn khách tự tạo => SePay/đối soát (migration 030) tự kích hoạt khi tiền về đúng mã LGOS...,
// hoặc kích hoạt tay ở /billing/admin. Khách thấy đơn (kèm mã QR) trong "Lịch sử thanh toán" của /billing.
//  GET  -> danh sách workspace (chọn khi tạo đơn) + các đơn Làm hộ gần đây
//  POST { workspace_id, plan?='done_for_you', months?=1|3|12, amount_vnd?, expires_days?, lead_id?, force? }
import { NextResponse } from 'next/server'
import { supabaseAdmin as admin } from '@/lib/supabase/admin'
import { isUuid } from '@/lib/autopost/secret'
import { PLAN_LABEL, transferContent } from '@/lib/billing/plans'
import { newOrderCode, readBankInfo, vietQrUrl } from '@/lib/billing/orders'
import { vnDate } from '@/lib/billing/emails'
import { buildPaymentMessage, parseAdminOrder } from '@/lib/agency/order'
import { agencyError, logAgencyAction, staffGuard } from '@/lib/agency/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const g = await staffGuard()
  if ('res' in g) return g.res
  try {
    const [{ data: ws, error: wErr }, { data: orders, error: oErr }] = await Promise.all([
      admin.from('workspaces').select('id, name, plan').order('created_at', { ascending: false }).limit(500),
      admin.from('payments').select('order_code, workspace_id, plan, period_months, amount_vnd, paid_amount_vnd, status, created_at, expires_at').eq('plan', 'done_for_you').order('created_at', { ascending: false }).limit(30),
    ])
    if (wErr) throw wErr
    if (oErr) throw oErr
    const names = new Map((ws || []).map((w: any) => [w.id, w.name]))
    return NextResponse.json({
      workspaces: ws || [],
      orders: (orders || []).map((o: any) => ({ ...o, workspace_name: names.get(o.workspace_id) ?? null })),
      bank_ready: !!readBankInfo(),
    })
  } catch (e: any) {
    return agencyError(e)
  }
}

export async function POST(req: Request) {
  const g = await staffGuard()
  if ('res' in g) return g.res
  const actor = g.staff.id
  try {
    const bank = readBankInfo()
    if (!bank) return NextResponse.json({ error: 'Chưa cấu hình tài khoản nhận tiền (BILLING_BANK_ID / BILLING_ACCOUNT_NO / BILLING_ACCOUNT_NAME).' }, { status: 503 })
    const body = await req.json().catch(() => null)
    if (!isUuid(body?.workspace_id)) return NextResponse.json({ error: 'Thiếu workspace.' }, { status: 400 })
    const parsed = parseAdminOrder(body)
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })
    const { plan, months, amount, customAmount, expiresDays } = parsed.value

    const { data: ws } = await admin.from('workspaces').select('id, name, plan').eq('id', body.workspace_id).maybeSingle()
    if (!ws) return NextResponse.json({ error: 'Không tìm thấy workspace.' }, { status: 404 })

    // Đã có đơn mở cùng gói: trả lại đơn đó thay vì sinh thêm đơn (tránh khách chuyển nhầm mã); force=true để tạo mới
    if (body.force !== true) {
      const { data: open } = await admin.from('payments').select('order_code, amount_vnd, expires_at, status').eq('workspace_id', ws.id).eq('plan', plan).in('status', ['pending', 'partial']).order('created_at', { ascending: false }).limit(1)
      if (open?.length) {
        const o: any = open[0]
        return NextResponse.json({ error: `Workspace này đã có đơn ${PLAN_LABEL[plan]} đang chờ (LGOS${o.order_code}, ${Number(o.amount_vnd).toLocaleString('vi-VN')}đ). Huỷ đơn đó hoặc gửi force=true để tạo đơn mới.`, code: 'open_order_exists', order_code: o.order_code }, { status: 409 })
      }
    }

    // Đổi gói chỉ áp dụng từ kỳ sau (quy tắc billing): cảnh báo nếu khách đang trong kỳ gói khác
    const { data: subs } = await admin.from('subscriptions').select('plan, status, current_period_end').eq('workspace_id', ws.id).in('status', ['active', 'scheduled']).order('current_period_end', { ascending: false }).limit(1)
    const last: any = subs?.[0]
    const warnings: string[] = []
    if (last && last.plan !== plan && new Date(last.current_period_end).getTime() > Date.now()) {
      warnings.push(`Khách đang dùng gói ${PLAN_LABEL[last.plan as keyof typeof PLAN_LABEL] ?? last.plan} đến ${vnDate(last.current_period_end)}: gói ${PLAN_LABEL[plan]} sẽ bắt đầu từ ngày đó (không tính lại tiền giữa kỳ). Nếu cần bắt đầu ngay, hãy xử lý thủ công trước khi tạo đơn.`)
    }

    const expiresAt = new Date(Date.now() + expiresDays * 86_400_000).toISOString()
    for (let attempt = 0; attempt < 5; attempt++) {
      const orderCode = newOrderCode()
      const { data, error } = await admin
        .from('payments')
        .insert({ workspace_id: ws.id, user_id: actor, order_code: orderCode, provider: 'manual', plan, period_months: months, amount_vnd: amount, status: 'pending', expires_at: expiresAt })
        .select('id, order_code, amount_vnd, plan, period_months, created_at, expires_at')
        .single()
      if (error) {
        if ((error as any).code === '23505') continue
        throw error
      }
      await admin.rpc('_billing_log', { p_actor: `admin:${actor ?? 'unknown'}`, p_event: 'order_created_by_admin', p_ws: ws.id, p_order: orderCode, p_pay: (data as any).id, p_tx: null, p_data: { plan, months, amount, custom_amount: customAmount, lead_id: isUuid(body.lead_id) ? body.lead_id : null } })
      await logAgencyAction(admin, { actor, workspaceId: ws.id, kind: 'order_create', refId: String(orderCode), data: { plan, months, amount, customAmount } })
      if (isUuid(body.lead_id)) {
        await admin.from('consultation_requests').update({ status: 'quoted', order_code: orderCode, handled_by: actor, handled_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', body.lead_id).in('status', ['new', 'contacted', 'quoted'])
      }
      const qr = vietQrUrl(bank, amount, orderCode)
      return NextResponse.json({
        order: data,
        warnings,
        transfer: { bank_id: bank.bankId, account_no: bank.accountNo, account_name: bank.accountName, amount, content: transferContent(orderCode), qr_url: qr },
        message: buildPaymentMessage({ workspaceName: ws.name, plan, months, amount, bankId: bank.bankId, accountNo: bank.accountNo, accountName: bank.accountName, orderCode, expiresAt, qrUrl: qr }),
      })
    }
    return NextResponse.json({ error: 'Không tạo được mã đơn, thử lại.' }, { status: 500 })
  } catch (e: any) {
    return agencyError(e)
  }
}
