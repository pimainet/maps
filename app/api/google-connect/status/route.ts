import { NextResponse } from 'next/server'
import { requireActiveWorkspaceId } from '@/lib/auth'
import { getGoogleConnection } from '@/lib/db'

export const runtime = 'nodejs'

/** GET /api/google-connect/status?client_id=... — chỉ trả trạng thái, KHÔNG trả token. */
export async function GET(req: Request) {
  try {
    const workspaceId = await requireActiveWorkspaceId()
    const { searchParams } = new URL(req.url)
    const clientId = searchParams.get('client_id')
    if (!clientId) {
      return NextResponse.json({ error: 'Thiếu client_id.' }, { status: 400 })
    }
    const conn = await getGoogleConnection(clientId, workspaceId)
    return NextResponse.json({
      connected: conn?.status === 'connected',
      status: conn?.status ?? 'not_connected',
      google_account_email: conn?.google_account_email ?? null,
      last_error: conn?.last_error ?? null,
    })
  } catch (error: any) {
    const status = error.message?.includes('Unauthorized') ? 401 : error.message?.includes('NoWorkspace') ? 409 : 500
    return NextResponse.json({ error: error.message || 'Lỗi kiểm tra kết nối.' }, { status })
  }
}
