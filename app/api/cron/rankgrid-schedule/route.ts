// Vercel Cron (hằng ngày, xem vercel.json): tạo các lần quét lưới định kỳ đến hạn (hàng tuần / 2 tuần theo gói).
// Bảo vệ: Authorization: Bearer <CRON_SECRET>. ?dry=1 để xem sẽ quét gì mà không gửi task.
// Kèm dọn dữ liệu nặng (top_places > 180 ngày) và 1 lượt quét dọn.
import { NextResponse } from 'next/server'
import { authorizedCron, rankGridFeatureOn } from '@/lib/rankgrid/secret'
import { pruneOldPoints, runSchedule, sweepScans } from '@/lib/rankgrid/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: Request) {
  if (!rankGridFeatureOn()) return NextResponse.json({ skipped: 'RANK_GRID_ENABLED tắt' })
  if (!process.env.CRON_SECRET) return NextResponse.json({ error: 'Chưa đặt CRON_SECRET nên route này đang tắt.' }, { status: 503 })
  if (!authorizedCron(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const dry = new URL(req.url).searchParams.get('dry') === '1'
  const started = Date.now()
  try {
    const schedule = await runSchedule({ deadline: started + 40_000, dry })
    const sweep = dry ? null : await sweepScans({ deadline: started + 52_000 })
    if (!dry) await pruneOldPoints().catch(() => {})
    return NextResponse.json({ dry, schedule, sweep, elapsed_ms: Date.now() - started })
  } catch (e: any) {
    console.error('cron rankgrid-schedule:', e?.message)
    return NextResponse.json({ error: String(e?.message || e).slice(0, 200) }, { status: 500 })
  }
}
