// Webhook SePay: mỗi khoản tiền vào tài khoản nhận => ghi sổ bank_transactions => khớp mã đơn LGOS… => kích hoạt/gia hạn.
// Xác thực: HMAC-SHA256 (SEPAY_WEBHOOK_SECRET, khuyến nghị) hoặc API Key (SEPAY_WEBHOOK_API_KEY). Không cấu hình => 503 (đóng).
// Trả {"success": true} cho mọi giao dịch đã ghi sổ (kể cả không khớp/trùng) để SePay không gửi lại; chỉ trả lỗi khi DB lỗi
// (SePay tự gửi lại, và cron hằng ngày đối soát bù qua API).
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { normalizeSePay, verifySePay } from '@/lib/billing/sepay'
import { afterIngest, ingestTransaction } from '@/lib/billing/reconcile'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_BODY = 64 * 1024

export async function POST(req: Request) {
  const raw = await req.text()
  if (raw.length > MAX_BODY) return NextResponse.json({ success: false, error: 'payload too large' }, { status: 413 })

  const auth = verifySePay(raw, req.headers, { SEPAY_WEBHOOK_SECRET: process.env.SEPAY_WEBHOOK_SECRET, SEPAY_WEBHOOK_API_KEY: process.env.SEPAY_WEBHOOK_API_KEY })
  if (!auth.ok) {
    if (auth.status === 503) console.error('SePay webhook: chưa đặt SEPAY_WEBHOOK_SECRET / SEPAY_WEBHOOK_API_KEY')
    return NextResponse.json({ success: false, error: auth.status === 503 ? 'not configured' : 'unauthorized' }, { status: auth.status })
  }

  let payload: any
  try {
    payload = JSON.parse(raw)
  } catch {
    return NextResponse.json({ success: false, error: 'bad json' }, { status: 400 })
  }

  const n = normalizeSePay(payload, process.env.BILLING_ACCOUNT_NO?.trim() || '')
  if ('skip' in n) return NextResponse.json({ success: true, skipped: n.skip })

  try {
    const r = await ingestTransaction(supabaseAdmin, n, 'webhook', payload)
    if (r.status !== 'duplicate_webhook') await afterIngest(supabaseAdmin, r, n)
    return NextResponse.json({ success: true, status: r.status })
  } catch (e: any) {
    console.error('SePay webhook ingest failed:', e?.message)
    return NextResponse.json({ success: false, error: 'temporary' }, { status: 500 })
  }
}
