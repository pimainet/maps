// Cron hằng ngày (Vercel Hobby chỉ cho chạy 1 lần/ngày): đối soát bù giao dịch SePay 3 ngày gần nhất, chuyển kỳ đã xếp lịch,
// hạ gói về miễn phí sau 3 ngày ân hạn, hết hạn đơn chờ > 7 ngày, gửi bù biên nhận, nhắc gia hạn, tóm tắt hàng chờ cho admin.
// Bảo vệ bằng CRON_SECRET như các cron khác. Mỗi bước độc lập: một bước lỗi không chặn bước sau.
import crypto from 'node:crypto'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { pollSePay, runRenewalReminders, sendAdminDigest, sendPendingReceipts } from '@/lib/billing/reconcile'
import { PLAN_GRACE_DAYS } from '@/lib/billing/plans'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  const a = Buffer.from(req.headers.get('authorization') || '')
  const b = Buffer.from(`Bearer ${secret}`)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

async function step<T>(out: Record<string, unknown>, name: string, fn: () => Promise<T>) {
  try {
    out[name] = await fn()
  } catch (e: any) {
    console.error(`billing cron ${name} failed:`, e?.message)
    out[name] = { error: String(e?.message || e).slice(0, 200) }
  }
}

export async function GET(req: Request) {
  if (!process.env.CRON_SECRET) return NextResponse.json({ error: 'Chưa đặt CRON_SECRET nên route này đang tắt.' }, { status: 503 })
  if (!authorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const out: Record<string, unknown> = {}
  // 1) Bù giao dịch webhook bị lỡ TRƯỚC khi hạ gói, để người đã trả không bị hạ oan
  await step(out, 'poll', () => pollSePay(supabaseAdmin))
  await step(out, 'roll', async () => {
    const { data, error } = await supabaseAdmin.rpc('roll_subscriptions', { p_grace_days: PLAN_GRACE_DAYS })
    if (error) throw new Error(error.message)
    return data
  })
  await step(out, 'expired_orders', async () => {
    const { data, error } = await supabaseAdmin.rpc('expire_stale_orders')
    if (error) throw new Error(error.message)
    return data
  })
  await step(out, 'receipts', () => sendPendingReceipts(supabaseAdmin))
  await step(out, 'reminders', () => runRenewalReminders(supabaseAdmin))
  await step(out, 'admin_digest', () => sendAdminDigest(supabaseAdmin))

  const failed = Object.values(out).some((v: any) => v && typeof v === 'object' && 'error' in v)
  return NextResponse.json({ ok: !failed, ...out }, { status: failed ? 500 : 200 })
}
