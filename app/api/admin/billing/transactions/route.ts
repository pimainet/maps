// Hàng chờ đối soát (chỉ Super Admin): xem các khoản tiền vào, gợi ý đơn, gán / bỏ qua / đã hoàn / đã xem.
import { NextResponse } from 'next/server'
import { errorStatus, publicError } from '@/lib/api-error'
import { getCurrentUser, requireSuperAdmin } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { readJsonObject } from '@/lib/request-body'
import { sendReceipt } from '@/lib/billing/reconcile'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const COLS =
  'id, provider, provider_txn_id, bank_ref, bank_name, amount_vnd, content, transferred_at, received_at, source, order_code, match_confidence, status, reason, needs_attention, payment_id, reviewed_at, note'
const ACTIONS = new Set(['assign', 'ignore', 'refund', 'ack'])

const deny = (error: unknown) => NextResponse.json({ error: publicError(error) }, { status: errorStatus(error) === 500 ? 403 : errorStatus(error) })

/** ?view=attention (mặc định: cần xử lý) | recent (100 khoản gần nhất). Kèm gợi ý đơn cho khoản chưa gán. */
export async function GET(req: Request) {
  try {
    await requireSuperAdmin()
  } catch (error) {
    return deny(error)
  }
  try {
    const view = new URL(req.url).searchParams.get('view') === 'recent' ? 'recent' : 'attention'
    let q = supabaseAdmin.from('bank_transactions').select(COLS).order('received_at', { ascending: false }).limit(100)
    if (view === 'attention') q = q.eq('needs_attention', true)
    const { data, error } = await q
    if (error) throw error
    const rows = data || []

    const payIds = [...new Set(rows.map((r: any) => r.payment_id).filter(Boolean))]
    const pays = new Map<string, any>()
    if (payIds.length) {
      const { data: p } = await supabaseAdmin
        .from('payments')
        .select('id, order_code, plan, period_months, amount_vnd, paid_amount_vnd, overpaid_vnd, status, workspace:workspaces(name)')
        .in('id', payIds)
      for (const x of p || []) pays.set(x.id, x)
    }
    const items = await Promise.all(
      rows.map(async (r: any) => {
        let suggestions: any[] = []
        if (view === 'attention' && !r.payment_id && ['unmatched', 'needs_review'].includes(r.status)) {
          const { data: s } = await supabaseAdmin.rpc('suggest_orders_for_transaction', { p_tx: r.id })
          suggestions = (s as any[]) || []
        }
        return { ...r, payment: r.payment_id ? pays.get(r.payment_id) ?? null : null, suggestions }
      })
    )
    return NextResponse.json({ view, items })
  } catch (error) {
    return NextResponse.json({ error: publicError(error) }, { status: 500 })
  }
}

/** Body: { tx_id, action: assign|ignore|refund|ack, order_code? (khi assign), note? } */
export async function POST(req: Request) {
  try {
    await requireSuperAdmin()
  } catch (error) {
    return deny(error)
  }
  try {
    const user = await getCurrentUser()
    const parsed = await readJsonObject(req)
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status })
    const txId = String(parsed.value.tx_id || '')
    const action = String(parsed.value.action || '')
    const note = typeof parsed.value.note === 'string' ? parsed.value.note.trim().slice(0, 500) || null : null
    const orderRaw = String(parsed.value.order_code ?? '').replace(/\D/g, '')
    const orderCode = orderRaw ? Number(orderRaw) : null
    if (!/^[0-9a-f-]{36}$/i.test(txId) || !ACTIONS.has(action)) return NextResponse.json({ error: 'tx_id hoặc action không hợp lệ.' }, { status: 400 })
    if (action === 'assign' && (!orderCode || !Number.isSafeInteger(orderCode))) return NextResponse.json({ error: 'Cần mã đơn (12 chữ số) để gán.' }, { status: 400 })

    const { data, error } = await supabaseAdmin.rpc('admin_resolve_transaction', {
      p_tx: txId,
      p_action: action,
      p_order_code: action === 'assign' ? orderCode : null,
      p_admin: user?.id ?? null,
      p_note: note,
    })
    if (error) throw error
    const result = String(data)
    if (action === 'assign' && ['activated', 'extended', 'scheduled'].includes(result) && orderCode) {
      await sendReceipt(supabaseAdmin, orderCode).catch((e) => console.error('receipt after assign failed:', e?.message))
    }
    return NextResponse.json({ result })
  } catch (error) {
    return NextResponse.json({ error: publicError(error) }, { status: 500 })
  }
}
