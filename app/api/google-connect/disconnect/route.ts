import { NextResponse } from 'next/server'
import { requireActiveWorkspaceId } from '@/lib/auth'
import { deleteGoogleConnection } from '@/lib/db'

export const runtime = 'nodejs'

/**
 * POST /api/google-connect/disconnect  { "client_id": "..." }
 *
 * Chỉ xoá connection ở PHÍA TA — không tự thu hồi quyền bên phía Google
 * (Google không có API thu hồi thay người dùng). Nói rõ cho khách trong UI:
 * muốn thu hồi hẳn, vào https://myaccount.google.com/permissions tự gỡ.
 */
export async function POST(req: Request) {
  try {
    const workspaceId = await requireActiveWorkspaceId()
    const body = await req.json()
    if (!body.client_id) {
      return NextResponse.json({ error: 'Thiếu client_id.' }, { status: 400 })
    }
    await deleteGoogleConnection(body.client_id, workspaceId)
    return NextResponse.json({
      ok: true,
      note: 'Đã ngắt kết nối phía ứng dụng. Muốn thu hồi hẳn quyền truy cập, vào myaccount.google.com/permissions để gỡ thủ công.',
    })
  } catch (error: any) {
    const status = error.message?.includes('Unauthorized') ? 401 : error.message?.includes('NoWorkspace') ? 409 : 500
    return NextResponse.json({ error: error.message || 'Lỗi ngắt kết nối.' }, { status })
  }
}
