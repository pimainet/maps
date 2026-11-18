// Mỗi ngày: chuyển kỳ đã xếp lịch lên, hạ gói về miễn phí khi quá hạn + 3 ngày ân hạn. Bảo vệ bằng CRON_SECRET như các cron khác.
import crypto from 'node:crypto'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  const a = Buffer.from(req.headers.get('authorization') || '')
  const b = Buffer.from(`Bearer ${secret}`)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

export async function GET(req: Request) {
  if (!process.env.CRON_SECRET) return NextResponse.json({ error: 'Chưa đặt CRON_SECRET nên route này đang tắt.' }, { status: 503 })
  if (!authorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { data, error } = await supabaseAdmin.rpc('roll_subscriptions', { p_grace_days: 3 })
  if (error) {
    console.error('roll_subscriptions failed:', error.message)
    return NextResponse.json({ error: 'roll_subscriptions failed' }, { status: 500 })
  }
  return NextResponse.json({ ok: true, result: data })
}
