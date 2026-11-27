import { NextResponse } from 'next/server'
import { publicError } from '@/lib/api-error'
import { requireActiveWorkspaceId } from '@/lib/auth'
import { getClientById } from '@/lib/db'
import { autoPostFeatureOn, isUuid } from '@/lib/autopost/secret'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const BUCKET = 'client-photos'
const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'])
const MAX_BYTES = 20 * 1024 * 1024

async function resolveClient(body: any) {
  const token = typeof body?.token === 'string' ? body.token.trim() : ''
  if (token) {
    const { supabaseAdmin } = await import('@/lib/supabase/admin')
    const { data, error } = await supabaseAdmin
      .from('clients')
      .select('id, workspace_id, name')
      .eq('autopost_upload_token', token)
      .maybeSingle()
    if (error) throw error
    if (!data) throw new Error('Không tìm thấy')
    return data as { id: string; workspace_id: string; name: string | null }
  }

  const workspaceId = await requireActiveWorkspaceId()
  const clientId = body?.client_id
  if (!isUuid(clientId)) throw new Error('Không tìm thấy')
  const client = await getClientById(clientId, workspaceId)
  if (!client) throw new Error('Không tìm thấy')
  return { id: client.id, workspace_id: client.workspace_id, name: client.name }
}

export async function POST(req: Request) {
  if (!autoPostFeatureOn()) {
    return NextResponse.json({ error: 'Tính năng kho ảnh đang tắt.' }, { status: 404 })
  }
  try {
    const body = await req.json().catch(() => null)
    const client = await resolveClient(body)
    const contentType = typeof body?.content_type === 'string' ? body.content_type.toLowerCase() : ''
    const filename = typeof body?.filename === 'string' ? body.filename : 'anh.jpg'
    const bytes = Number(body?.bytes)
    if (!ALLOWED.has(contentType)) {
      return NextResponse.json({ error: 'Chỉ nhận ảnh JPEG, PNG, WEBP hoặc HEIC.' }, { status: 400 })
    }
    if (Number.isFinite(bytes) && bytes > MAX_BYTES) {
      return NextResponse.json({ error: 'Ảnh vượt quá 20MB.' }, { status: 400 })
    }

    const { supabaseAdmin } = await import('@/lib/supabase/admin')
    const ext = contentType === 'image/png' ? 'png' : contentType === 'image/webp' ? 'webp' : contentType.includes('heic') || contentType.includes('heif') ? 'heic' : 'jpg'
    const photoId = crypto.randomUUID()
    const originalPath = `${client.workspace_id}/${client.id}/${photoId}/original.${ext}`

    const { error: insErr } = await supabaseAdmin.from('client_photos').insert({
      id: photoId,
      workspace_id: client.workspace_id,
      client_id: client.id,
      original_path: originalPath,
      storage_bucket: BUCKET,
      source: body?.token ? 'upload_link' : 'web',
      original_filename: filename.slice(0, 200),
      mime_type: contentType,
      file_size_bytes: Number.isFinite(bytes) ? bytes : null,
      status: 'uploaded',
    })
    if (insErr) throw insErr

    const { data: signed, error: signErr } = await supabaseAdmin.storage
      .from(BUCKET)
      .createSignedUploadUrl(originalPath)
    if (signErr || !signed?.signedUrl) throw signErr || new Error('Không tạo được link tải lên')

    return NextResponse.json({
      photo_id: photoId,
      path: originalPath,
      signedUrl: signed.signedUrl,
      token: signed.token,
    })
  } catch (error: any) {
    const m = typeof error?.message === 'string' ? error.message : ''
    if (m.includes('Unauthorized')) return NextResponse.json({ error: publicError(error) }, { status: 401 })
    if (m.includes('NoWorkspace')) return NextResponse.json({ error: publicError(error) }, { status: 409 })
    if (m.startsWith('Không tìm thấy')) return NextResponse.json({ error: 'Không tìm thấy doanh nghiệp này.' }, { status: 404 })
    return NextResponse.json({ error: publicError(error) }, { status: 500 })
  }
}
