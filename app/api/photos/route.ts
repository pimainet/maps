import { NextResponse } from 'next/server'
import { publicError } from '@/lib/api-error'
import { requireActiveWorkspaceId } from '@/lib/auth'
import { getClientById } from '@/lib/db'
import { autoPostFeatureOn, isUuid } from '@/lib/autopost/secret'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  if (!autoPostFeatureOn()) {
    return NextResponse.json({ error: 'Tính năng kho ảnh đang tắt.' }, { status: 404 })
  }
  try {
    const workspaceId = await requireActiveWorkspaceId()
    const clientId = new URL(req.url).searchParams.get('client_id')
    if (!isUuid(clientId)) return NextResponse.json({ error: 'Thiếu doanh nghiệp.' }, { status: 400 })
    const client = await getClientById(clientId, workspaceId)
    if (!client) return NextResponse.json({ error: 'Không tìm thấy doanh nghiệp này.' }, { status: 404 })

    const { supabaseAdmin } = await import('@/lib/supabase/admin')
    const { data, error } = await supabaseAdmin
      .from('client_photos')
      .select(
        'id, status, original_filename, width, height, geotagged, ai_description, ai_tags, quality_score, reject_reason, used_count, last_posted_at, created_at, storage_path',
      )
      .eq('client_id', clientId)
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false })
      .limit(200)
    if (error) throw error
    return NextResponse.json({ photos: data || [] })
  } catch (error: any) {
    const m = typeof error?.message === 'string' ? error.message : ''
    if (m.includes('Unauthorized')) return NextResponse.json({ error: publicError(error) }, { status: 401 })
    if (m.includes('NoWorkspace')) return NextResponse.json({ error: publicError(error) }, { status: 409 })
    return NextResponse.json({ error: publicError(error) }, { status: 500 })
  }
}
