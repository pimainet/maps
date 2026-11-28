// Quét dọn lưới thứ hạng: lấy kết quả điểm đã gửi > 10 phút mà chưa có pingback, gửi lại điểm lỗi gửi (tối đa 3 lần),
// chốt lần quét treo > 3 giờ (hoàn hạn mức điểm lỗi).
// Vercel Hobby chỉ cho cron 1 lần/ngày -> vercel.json để hằng ngày. Muốn 10 phút/lần: Vercel Pro ("*/10 * * * *")
// hoặc Supabase pg_cron + pg_net gọi URL này với header Authorization: Bearer <CRON_SECRET>.
import { NextResponse } from 'next/server'
import { authorizedCron, rankGridFeatureOn } from '@/lib/rankgrid/secret'
import { sweepScans } from '@/lib/rankgrid/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: Request) {
  if (!rankGridFeatureOn()) return NextResponse.json({ skipped: 'RANK_GRID_ENABLED tắt' })
  if (!process.env.CRON_SECRET) return NextResponse.json({ error: 'Chưa đặt CRON_SECRET nên route này đang tắt.' }, { status: 503 })
  if (!authorizedCron(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const started = Date.now()
    const sweep = await sweepScans({ deadline: started + 50_000 })
    return NextResponse.json({ sweep, elapsed_ms: Date.now() - started })
  } catch (e: any) {
    console.error('cron rankgrid-sweep:', e?.message)
    return NextResponse.json({ error: String(e?.message || e).slice(0, 200) }, { status: 500 })
  }
}
