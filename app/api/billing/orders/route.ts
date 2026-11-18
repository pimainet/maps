import { NextResponse } from 'next/server'
import { errorStatus, publicError } from '@/lib/api-error'
import { getCurrentUser, requireActiveWorkspaceAdmin } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { isPaidPlan, isPeriod, priceFor, transferContent } from '@/lib/billing/plans'
import { newOrderCode, readBankInfo, vietQrUrl } from '@/lib/billing/orders'
import { readJsonObject } from '@/lib/request-body'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_PENDING = 5

/** Tạo đơn chờ chuyển khoản. Số tiền do SERVER tính từ gói + kỳ hạn; client chỉ chọn gói và số tháng. */
export async function POST(req: Request) {
  try {
    const workspaceId = await requireActiveWorkspaceAdmin()
    const user = await getCurrentUser()
    const bank = readBankInfo()
    if (!bank) return NextResponse.json({ error: 'Chưa cấu hình tài khoản nhận tiền (BILLING_BANK_ID / BILLING_ACCOUNT_NO / BILLING_ACCOUNT_NAME).' }, { status: 503 })

    const parsed = await readJsonObject(req)
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status })
    const plan = parsed.value.plan
    const months = Number(parsed.value.months)
    if (!isPaidPlan(plan) || !isPeriod(months)) return NextResponse.json({ error: 'Gói hoặc kỳ hạn không hợp lệ.' }, { status: 400 })

    // Chặn spam đơn: quá 5 đơn đang chờ thì huỷ đơn cũ nhất
    const { data: pending } = await supabaseAdmin.from('payments').select('id').eq('workspace_id', workspaceId).eq('status', 'pending').order('created_at', { ascending: true })
    if ((pending?.length || 0) >= MAX_PENDING) {
      const old = pending!.slice(0, pending!.length - MAX_PENDING + 1).map((p: any) => p.id)
      await supabaseAdmin.from('payments').update({ status: 'cancelled' }).in('id', old)
    }

    const amount = priceFor(plan, months)
    for (let attempt = 0; attempt < 5; attempt++) {
      const orderCode = newOrderCode()
      const { data, error } = await supabaseAdmin
        .from('payments')
        .insert({ workspace_id: workspaceId, user_id: user?.id ?? null, order_code: orderCode, provider: 'manual', plan, period_months: months, amount_vnd: amount, status: 'pending' })
        .select('id, order_code, amount_vnd, plan, period_months, created_at')
        .single()
      if (error) {
        if ((error as any).code === '23505') continue // trùng mã đơn: thử mã khác
        throw error
      }
      return NextResponse.json({
        order: data,
        transfer: {
          bank_id: bank.bankId,
          account_no: bank.accountNo,
          account_name: bank.accountName,
          amount,
          content: transferContent(orderCode),
          qr_url: vietQrUrl(bank, amount, orderCode),
        },
      })
    }
    return NextResponse.json({ error: 'Không tạo được mã đơn, thử lại.' }, { status: 500 })
  } catch (error) {
    return NextResponse.json({ error: publicError(error) }, { status: errorStatus(error) })
  }
}

/** Lịch sử đơn của workspace (RLS cũng cho đọc, nhưng đi qua server để trả gọn). */
export async function GET() {
  try {
    const workspaceId = await requireActiveWorkspaceAdmin()
    const { data, error } = await supabaseAdmin
      .from('payments')
      .select('order_code, plan, period_months, amount_vnd, status, created_at, paid_at')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false })
      .limit(20)
    if (error) throw error
    return NextResponse.json({ orders: data })
  } catch (error) {
    return NextResponse.json({ error: publicError(error) }, { status: errorStatus(error) })
  }
}
