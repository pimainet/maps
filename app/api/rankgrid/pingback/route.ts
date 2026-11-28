/**
 * DataForSEO gọi GET tới đây khi 1 task (1 điểm lưới) xong: ?p=<point_id>&s=<HMAC>&id=<task_id>.
 * Xác thực bằng HMAC theo RANKGRID_PINGBACK_SECRET (không cần đăng nhập — đã mở trong proxy.ts).
 * Idempotent: gọi lại nhiều lần cho cùng điểm chỉ xử lý 1 lần. Luôn trả 200 khi chữ ký đúng để DataForSEO không gọi lại vô hạn.
 */
import { NextResponse } from 'next/server'
import { isUuid } from '@/lib/autopost/secret'
import { rankGridFeatureOn, verifyPingbackSig } from '@/lib/rankgrid/secret'
import { handlePointResult } from '@/lib/rankgrid/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function GET(req: Request) {
  if (!rankGridFeatureOn()) return NextResponse.json({ ok: false, error: 'disabled' }, { status: 404 })
  const u = new URL(req.url)
  const pointId = u.searchParams.get('p')
  const taskId = u.searchParams.get('id')
  if (!isUuid(pointId) || !verifyPingbackSig(pointId, u.searchParams.get('s'))) {
    return NextResponse.json({ ok: false }, { status: 401 })
  }
  if (!taskId || taskId === '$id' || !/^[\w-]{6,64}$/.test(taskId)) return NextResponse.json({ ok: false, error: 'bad task id' }, { status: 400 })
  try {
    const r = await handlePointResult(pointId, taskId)
    return NextResponse.json({ ok: true, status: r.status })
  } catch (e: any) {
    console.error('rankgrid pingback:', e?.message)
    // 500 -> DataForSEO có thể gọi lại; sweeper cũng sẽ lấy lại sau.
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}
