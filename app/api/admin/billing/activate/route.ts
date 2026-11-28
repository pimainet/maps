import { NextResponse } from 'next/server'
import { errorStatus, publicError } from '@/lib/api-error'
import { getCurrentUser, requireSuperAdmin } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { readJsonObject } from '@/lib/request-body'
import { sendReceipt } from '@/lib/billing/reconcile'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Danh sách đơn đang chờ (chỉ superadmin). */
export async function GET() {
  try {
    await requireSuperAdmin()
    const { data, error } = await supabaseAdmin
      .from('payments')
      .select('order_code, workspace_id, plan, period_months, amount_vnd, paid_amount_vnd, status, created_at, workspace:workspaces(name)')
      .in('status', ['pending', 'partial', 'amount_mismatch'])
      .order('created_at', { ascending: false })
      .limit(50)
    if (error) throw error
    return NextResponse.json({ orders: data })
  } catch (error) {
    return NextResponse.json({ error: publicError(error) }, { status: errorStatus(error) === 500 ? 403 : errorStatus(error) })
  }
}

/**
 * Kích hoạt thủ công sau khi bạn ĐÃ thấy tiền vào tài khoản mà webhook/đối soát bù không bắt được.
 * Phải nhập số tiền thực nhận: thiếu thì đơn ở trạng thái 'partial' (chưa kích hoạt), dư thì kích hoạt + vào hàng chờ hoàn phần dư.
 * Đi qua sổ bank_transactions + nhật ký billing_events (migration 030).
 */
export async function POST(req: Request) {
  try {
    await requireSuperAdmin()
    const parsed = await readJsonObject(req)
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status })
    const orderCode = Number(parsed.value.order_code)
    const paid = Number(parsed.value.paid_amount)
    if (!Number.isSafeInteger(orderCode) || !Number.isInteger(paid) || paid <= 0) {
      return NextResponse.json({ error: 'Cần order_code và paid_amount (số tiền thực nhận, VND).' }, { status: 400 })
    }
    const { data, error } = await supabaseAdmin.rpc('apply_payment', {
      p_order_code: orderCode,
      p_provider: 'manual',
      p_txn_id: `manual-${orderCode}`,
      p_paid_amount: paid,
      p_raw: { by: 'superadmin', admin_id: (await getCurrentUser())?.id ?? null, at: new Date().toISOString() },
    })
    if (error) throw error
    if (['activated', 'extended', 'scheduled'].includes(String(data))) {
      await sendReceipt(supabaseAdmin, orderCode).catch((e) => console.error('receipt after manual activate failed:', e?.message))
    }
    return NextResponse.json({ result: data })
  } catch (error) {
    return NextResponse.json({ error: publicError(error) }, { status: errorStatus(error) === 500 ? 403 : errorStatus(error) })
  }
}
