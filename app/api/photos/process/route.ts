import { NextResponse } from 'next/server'
import { publicError } from '@/lib/api-error'
import { requireActiveWorkspaceId } from '@/lib/auth'
import { autoPostFeatureOn, isUuid } from '@/lib/autopost/secret'
import { processClientPhoto } from '@/lib/autopost/process-photo'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

async function canProcess(photoId: string, token?: string) {
  const { supabaseAdmin } = await import('@/lib/supabase/admin')
  const { data: photo, error } = await supabaseAdmin
    .from('client_photos')
    .select('id, workspace_id, client_id')
    .eq('id', photoId)
    .maybeSingle()
  if (error) throw error
  if (!photo) throw new Error('Không tìm thấy')

  if (token) {
    const { data: client } = await supabaseAdmin
      .from('clients')
      .select('id')
      .eq('id', photo.client_id)
      .eq('autopost_upload_token', token)
      .maybeSingle()
    if (!client) throw new Error('Không tìm thấy')
    return
  }

  const workspaceId = await requireActiveWorkspaceId()
  if (photo.workspace_id !== workspaceId) throw new Error('Không tìm thấy')
}

export async function POST(req: Request) {
  if (!autoPostFeatureOn()) {
    return NextResponse.json({ error: 'Tính năng kho ảnh đang tắt.' }, { status: 404 })
  }
  try {
    const body = await req.json().catch(() => null)
    const photoId = body?.photo_id
    const token = typeof body?.token === 'string' ? body.token.trim() : ''
    if (!isUuid(photoId)) return NextResponse.json({ error: 'Thiếu mã ảnh.' }, { status: 400 })
    await canProcess(photoId, token || undefined)
    const result = await processClientPhoto(photoId)
    return NextResponse.json(result)
  } catch (error: any) {
    const m = typeof error?.message === 'string' ? error.message : ''
    if (m.includes('Unauthorized')) return NextResponse.json({ error: publicError(error) }, { status: 401 })
    if (m.includes('NoWorkspace')) return NextResponse.json({ error: publicError(error) }, { status: 409 })
    if (m.startsWith('Không tìm thấy')) return NextResponse.json({ error: 'Không tìm thấy ảnh này.' }, { status: 404 })
    return NextResponse.json({ error: publicError(error, 'Không xử lý được ảnh. Vui lòng thử lại.') }, { status: 500 })
  }
}
