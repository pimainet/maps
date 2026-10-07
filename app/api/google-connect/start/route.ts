import { NextResponse } from 'next/server'
import { requireActiveWorkspaceId } from '@/lib/auth'
import { getClientById } from '@/lib/db'
import { buildAuthorizationUrl, createOAuthState } from '@/lib/google-oauth'

export const runtime = 'nodejs'

/**
 * GET /api/google-connect/start?client_id=...
 *
 * Bước "Kết nối Google Business Profile" — RIÊNG BIỆT với login thường
 * (/login dùng supabase.auth.signInWithOAuth, chỉ xin email/profile).
 * Chỉ gọi route này khi khách CHỦ ĐỘNG bấm nút kết nối (không phải tự động
 * lúc đăng ký) — đúng nguyên tắc incremental authorization.
 */
export async function GET(req: Request) {
  try {
    const workspaceId = await requireActiveWorkspaceId()
    const { searchParams } = new URL(req.url)
    const clientId = searchParams.get('client_id')
    if (!clientId) {
      return NextResponse.json({ error: 'Thiếu client_id.' }, { status: 400 })
    }

    const client = await getClientById(clientId, workspaceId)
    if (!client) {
      return NextResponse.json({ error: 'Không tìm thấy doanh nghiệp này trong workspace.' }, { status: 404 })
    }

    const state = createOAuthState({ workspaceId, clientId })
    const url = buildAuthorizationUrl(state)
    return NextResponse.redirect(url)
  } catch (error: any) {
    const status = error.message?.includes('Unauthorized') ? 401 : error.message?.includes('NoWorkspace') ? 409 : 500
    return NextResponse.json({ error: error.message || 'Lỗi bắt đầu kết nối Google.' }, { status })
  }
}
