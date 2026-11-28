// Đối soát chuyển khoản (chỉ chạy ở server, dùng service role): nạp giao dịch vào sổ, gửi biên nhận, báo admin,
// đối soát bù qua API SePay, nhắc gia hạn. Logic khớp/kích hoạt nằm trong SQL (migration 030) để nguyên tử + idempotent.
import type { SupabaseClient } from '@supabase/supabase-js'
import { appUrl, sendEmail } from '@/lib/notifications'
import { extractOrderCodes } from './match'
import { normalizeSePayApiRow, type Normalized } from './sepay'
import { alertKindFor, buildAdminAlertEmail, buildAdminDigestEmail, buildReceiptEmail, buildRenewalEmail, type ReminderKind } from './emails'

export type IngestResult = {
  status: 'matched' | 'partial' | 'unmatched' | 'needs_review' | 'duplicate' | 'duplicate_webhook' | 'invalid'
  result?: string
  tx_id?: string
  order_code?: number
  workspace_id?: string
}

export const billingAdminUrl = () => `${appUrl()}/billing/admin`

/** Nạp 1 khoản tiền vào (đã chuẩn hoá) qua hàm SQL ingest_bank_transaction. Ném lỗi nếu DB lỗi (để nhà cung cấp gửi lại). */
export async function ingestTransaction(admin: SupabaseClient, n: Normalized, source: 'webhook' | 'poll', raw: unknown): Promise<IngestResult> {
  const { candidates, confidence } = extractOrderCodes(n.content, n.providerCode)
  const { data, error } = await admin.rpc('ingest_bank_transaction', {
    p_provider: n.provider,
    p_txn_id: n.txnId,
    p_amount: n.amount,
    p_content: n.content,
    p_candidates: candidates,
    p_confidence: confidence,
    p_bank_ref: n.bankRef,
    p_account: n.account,
    p_bank_name: n.bankName,
    p_provider_code: n.providerCode,
    p_transferred_at: n.transferredAt,
    p_source: source,
    p_raw: raw ?? null,
  })
  if (error) throw new Error(`ingest_bank_transaction: ${error.message}`)
  return data as IngestResult
}

/** Việc hậu kỳ sau khi nạp: biên nhận cho khách (nếu đã trả đủ) + email báo admin (thiếu/dư/không khớp). Không ném lỗi. */
export async function afterIngest(admin: SupabaseClient, r: IngestResult, n: Normalized): Promise<void> {
  try {
    if (r.status === 'matched' && r.order_code) await sendReceipt(admin, r.order_code)
    if (!r.tx_id) return
    const { data: tx } = await admin.from('bank_transactions').select('status, reason, order_code, needs_attention').eq('id', r.tx_id).maybeSingle()
    if (!tx?.needs_attention) return
    const kind = alertKindFor(tx.status === 'matched' ? 'matched' : r.status, tx.reason)
    if (!kind) return
    let workspaceName: string | null = null
    if (r.workspace_id) {
      const { data: ws } = await admin.from('workspaces').select('name').eq('id', r.workspace_id).maybeSingle()
      workspaceName = ws?.name ?? null
    }
    await notifyAdmins(
      admin,
      buildAdminAlertEmail({
        kind,
        amountVnd: n.amount,
        content: n.content,
        orderCode: tx.order_code ?? null,
        workspaceName,
        reason: tx.reason,
        transferredAt: n.transferredAt,
        adminUrl: billingAdminUrl(),
      })
    )
  } catch (e: any) {
    console.error('billing afterIngest failed:', e?.message)
  }
}

/** Danh sách email admin: BILLING_ADMIN_EMAIL (phẩy ngăn cách), nếu trống thì email các Super Admin. */
export async function adminEmails(admin: SupabaseClient): Promise<string[]> {
  const fromEnv = (process.env.BILLING_ADMIN_EMAIL || '').split(',').map((s) => s.trim()).filter((s) => s.includes('@'))
  if (fromEnv.length) return fromEnv
  const { data } = await admin.from('profiles').select('id').eq('is_superadmin', true).limit(5)
  const out: string[] = []
  for (const p of data || []) {
    const { data: u } = await admin.auth.admin.getUserById(p.id)
    if (u?.user?.email) out.push(u.user.email)
  }
  return out
}

export async function notifyAdmins(admin: SupabaseClient, msg: { subject: string; html: string; text: string }): Promise<number> {
  let sent = 0
  for (const to of await adminEmails(admin)) {
    const r = await sendEmail({ to, ...msg })
    if (r.ok) sent++
    else if (!r.skipped) console.error('billing admin email failed:', r.error)
  }
  return sent
}

/** Gửi biên nhận cho owner/admin của workspace, đánh dấu receipt_sent_at (gửi 1 lần). Trả true nếu đã gửi. */
export async function sendReceipt(admin: SupabaseClient, orderCode: number): Promise<boolean> {
  const { data: pay } = await admin
    .from('payments')
    .select('id, workspace_id, order_code, plan, period_months, amount_vnd, paid_amount_vnd, overpaid_vnd, paid_at, receipt_no, receipt_sent_at, status')
    .eq('order_code', orderCode)
    .maybeSingle()
  if (!pay || pay.status !== 'paid' || pay.receipt_sent_at || !pay.workspace_id) return false

  const [{ data: ws }, { data: subs }, { data: ev }, { data: recipients }] = await Promise.all([
    admin.from('workspaces').select('name').eq('id', pay.workspace_id).maybeSingle(),
    admin
      .from('subscriptions')
      .select('plan, status, current_period_start, current_period_end')
      .eq('workspace_id', pay.workspace_id)
      .in('status', ['active', 'scheduled'])
      .order('current_period_end', { ascending: false }),
    admin.from('billing_events').select('data').eq('payment_id', pay.id).eq('event', 'order_paid').order('at', { ascending: false }).limit(1),
    admin.rpc('billing_recipients', { p_ws: pay.workspace_id }),
  ])
  const result: string | null = (ev?.[0]?.data as any)?.result ?? null
  const period = (subs || []).find((s: any) => s.plan === pay.plan) || null
  const email = buildReceiptEmail({
    workspaceName: ws?.name || 'Workspace',
    receiptNo: pay.receipt_no,
    orderCode: Number(pay.order_code),
    plan: pay.plan,
    periodMonths: pay.period_months,
    amountVnd: pay.amount_vnd,
    paidVnd: pay.paid_amount_vnd ?? pay.amount_vnd,
    overpaidVnd: pay.overpaid_vnd || 0,
    paidAt: pay.paid_at || new Date().toISOString(),
    result,
    periodStart: period?.current_period_start ?? null,
    periodEnd: period?.current_period_end ?? null,
    billingUrl: `${appUrl()}/billing`,
  })
  let sent = 0
  for (const r of (recipients as any[]) || []) {
    const res = await sendEmail({ to: r.email, ...email })
    if (res.ok) sent++
    else if (res.skipped) return false // chưa cấu hình Resend: để cron thử lại sau
  }
  if (sent > 0 || !(recipients as any[])?.length) {
    await admin.from('payments').update({ receipt_sent_at: new Date().toISOString() }).eq('id', pay.id).is('receipt_sent_at', null)
  }
  return sent > 0
}

/** Gửi bù biên nhận cho các đơn đã trả mà chưa gửi (vd Resend lỗi lúc webhook). */
export async function sendPendingReceipts(admin: SupabaseClient, limit = 20): Promise<number> {
  const { data } = await admin
    .from('payments')
    .select('order_code')
    .eq('status', 'paid')
    .is('receipt_sent_at', null)
    .gt('paid_at', new Date(Date.now() - 14 * 86_400_000).toISOString())
    .limit(limit)
  let n = 0
  for (const p of data || []) if (await sendReceipt(admin, Number(p.order_code))) n++
  return n
}

/**
 * Đối soát bù: lấy giao dịch 3 ngày gần nhất từ API SePay và nạp lại (trùng thì SQL bỏ qua).
 * Bắt được giao dịch mà webhook bị lỡ. Cần SEPAY_API_TOKEN; thiếu thì bỏ qua.
 */
export async function pollSePay(admin: SupabaseClient, now = new Date()): Promise<{ skipped?: string; seen: number; ingested: number; errors: number }> {
  const token = process.env.SEPAY_API_TOKEN
  const account = process.env.BILLING_ACCOUNT_NO?.trim()
  if (!token) return { skipped: 'no_SEPAY_API_TOKEN', seen: 0, ingested: 0, errors: 0 }
  if (!account) return { skipped: 'no_BILLING_ACCOUNT_NO', seen: 0, ingested: 0, errors: 0 }
  const since = new Date(now.getTime() + 7 * 3_600_000 - 3 * 86_400_000).toISOString().slice(0, 10) // giờ VN
  const url = `https://my.sepay.vn/userapi/transactions/list?account_number=${encodeURIComponent(account)}&transaction_date_min=${since}%2000:00:00&limit=500`
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(20000) })
  if (!res.ok) throw new Error(`SePay API ${res.status}`)
  const body: any = await res.json()
  const rows: any[] = Array.isArray(body?.transactions) ? body.transactions : []
  let ingested = 0
  let errors = 0
  for (const row of rows) {
    const n = normalizeSePayApiRow(row, account)
    if ('skip' in n) continue
    try {
      const r = await ingestTransaction(admin, n, 'poll', { poll: row })
      if (r.status !== 'duplicate_webhook') {
        ingested++
        await afterIngest(admin, r, n)
      }
    } catch (e: any) {
      errors++
      console.error('billing poll ingest failed:', e?.message)
    }
  }
  return { seen: rows.length, ingested, errors }
}

/** Gửi email nhắc gia hạn đến hạn (d14/d7/d3/d1/hết hạn/đã hạ gói); mỗi kỳ + loại chỉ gửi 1 lần. */
export async function runRenewalReminders(admin: SupabaseClient, now = new Date()): Promise<{ due: number; sent: number }> {
  const { data, error } = await admin.rpc('billing_reminders_due', { p_now: now.toISOString(), p_grace_days: 3 })
  if (error) throw new Error(`billing_reminders_due: ${error.message}`)
  let sent = 0
  const rows = (data as any[]) || []
  for (const r of rows) {
    const { data: recipients } = await admin.rpc('billing_recipients', { p_ws: r.workspace_id })
    const email = buildRenewalEmail({
      workspaceName: r.workspace_name,
      plan: r.plan,
      periodEnd: r.period_end,
      kind: r.kind as ReminderKind,
      renewUrl: `${appUrl()}/billing?renew=1`,
      now,
    })
    let ok = 0
    let notConfigured = false
    for (const to of (recipients as any[]) || []) {
      const res = await sendEmail({ to: to.email, ...email })
      if (res.ok) ok++
      else if (res.skipped) notConfigured = true
    }
    if (notConfigured) break // chưa cấu hình Resend: không đánh dấu, lần sau gửi
    await admin.rpc('billing_reminder_mark', { p_sub: r.subscription_id, p_kind: r.kind, p_period_end: r.period_end })
    if (ok) sent++
  }
  return { due: rows.length, sent }
}

/** Email tóm tắt hàng chờ cho admin (mỗi ngày, chỉ khi còn khoản chưa xử lý). */
export async function sendAdminDigest(admin: SupabaseClient): Promise<number> {
  const { data } = await admin.from('bank_transactions').select('amount_vnd, received_at').eq('needs_attention', true).order('received_at', { ascending: true }).limit(500)
  const rows = data || []
  if (!rows.length) return 0
  const total = rows.reduce((s: number, r: any) => s + Number(r.amount_vnd || 0), 0)
  return notifyAdmins(admin, buildAdminDigestEmail({ count: rows.length, totalVnd: total, oldestAt: rows[0].received_at, adminUrl: billingAdminUrl() }))
}
