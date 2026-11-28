/**
 * Chi tiết 1 lần quét: điểm (hạng + top 20 từng điểm) và bảng đối thủ.
 * Lần quét còn chạy > 10 phút thì "quét dọn lười" riêng lần quét đó (lấy kết quả pingback bị lỡ) — cần trên Vercel Hobby
 * vì sweeper chỉ chạy 1 lần/ngày.
 */
import { NextResponse } from 'next/server'
import { publicError } from '@/lib/api-error'
import { requireActiveWorkspaceId } from '@/lib/auth'
import { isUuid } from '@/lib/autopost/secret'
import { rankGridFeatureOn } from '@/lib/rankgrid/secret'
import { sweepScans } from '@/lib/rankgrid/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: Request) {
  if (!rankGridFeatureOn()) return NextResponse.json({ error: 'Tính năng lưới thứ hạng đang tắt.' }, { status: 404 })
  try {
    const workspaceId = await requireActiveWorkspaceId()
    const id = new URL(req.url).searchParams.get('id')
    if (!isUuid(id)) return NextResponse.json({ error: 'Thiếu lần quét.' }, { status: 400 })
    const { supabaseAdmin } = await import('@/lib/supabase/admin')
    const load = () => supabaseAdmin.from('rank_scans').select('*').eq('id', id).eq('workspace_id', workspaceId).maybeSingle()
    let { data: scan } = await load()
    if (!scan) return NextResponse.json({ error: 'Không tìm thấy lần quét.' }, { status: 404 })
    if (['queued', 'running'].includes((scan as any).status) && Date.now() - new Date((scan as any).created_at).getTime() > 10 * 60_000) {
      await sweepScans({ deadline: Date.now() + 40_000, scanId: id, limit: 120 }).catch((e) => console.error('lazy sweep:', e?.message))
      scan = (await load()).data
    }
    const [{ data: points }, { data: competitors }] = await Promise.all([
      supabaseAdmin.from('rank_scan_points').select('id,idx,row_i,col_i,lat,lng,status,rank,result_count,top_places,last_error').eq('scan_id', id).order('idx'),
      supabaseAdmin
        .from('rank_scan_competitors')
        .select('place_key,place_id,cid,title,category,rating,reviews_count,lat,lng,is_target,appearances,top3_count,best_rank,arp,atrp,solv')
        .eq('scan_id', id)
        .order('solv', { ascending: false, nullsFirst: false })
        .limit(400),
    ])
    return NextResponse.json({ scan, points: points || [], competitors: competitors || [] })
  } catch (error: any) {
    const m = typeof error?.message === 'string' ? error.message : ''
    if (m.includes('Unauthorized')) return NextResponse.json({ error: publicError(error) }, { status: 401 })
    if (m.includes('NoWorkspace')) return NextResponse.json({ error: publicError(error) }, { status: 409 })
    return NextResponse.json({ error: publicError(error) }, { status: 500 })
  }
}
