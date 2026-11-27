import { NextResponse } from 'next/server'
import { publicError } from '@/lib/api-error'
import { requireActiveWorkspaceId } from '@/lib/auth'
import { getClientById } from '@/lib/db'
import { autoPostFeatureOn, isUuid, newUploadToken } from '@/lib/autopost/secret'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  if (!autoPostFeatureOn()) {
    return NextResponse.json({ error: 'Tính năng kho ảnh đang tắt.' }, { status: 404 })
  }
  try {
    const workspaceId = await requireActiveWorkspaceId()
    const body = await req.json().catch(() => null)
    const clientId = body?.client_id
    if (!isUuid(clientId)) return NextResponse.json({ error: 'Thiếu doanh nghiệp.' }, { status: 400 })
    const client = await getClientById(clientId, workspaceId)
    if (!client) return NextResponse.json({ error: 'Không tìm thấy doanh nghiệp này.' }, { status: 404 })

    const { supabaseAdmin } = await import('@/lib/supabase/admin')
    let token = (client as any).autopost_upload_token as string | null
    if (!token || body?.rotate === true) {
      token = newUploadToken()
      const { error } = await supabaseAdmin.from('clients').update({ autopost_upload_token: token }).eq('id', clientId)
      if (error) throw error
    }
    return NextResponse.json({ token, path: `/u/${token}` })
  } catch (error: any) {
    const m = typeof error?.message === 'string' ? error.message : ''
    if (m.includes('Unauthorized')) return NextResponse.json({ error: publicError(error) }, { status: 401 })
    if (m.includes('NoWorkspace')) return NextResponse.json({ error: publicError(error) }, { status: 409 })
    return NextResponse.json({ error: publicError(error) }, { status: 500 })
  }
}
