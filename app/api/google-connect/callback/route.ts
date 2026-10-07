import { NextResponse } from 'next/server'
import { saveGoogleConnection, updateGoogleConnection } from '@/lib/db'
import { encryptToken, exchangeCodeForTokens, verifyOAuthState } from '@/lib/google-oauth'
import { resolveAccountAndLocation } from '@/lib/gbp-business-api'

export const runtime = 'nodejs'

// Khách quay lại trang task/client sau khi kết nối xong (thành công hay lỗi
// đều quay về đây, kèm query param để UI hiện thông báo phù hợp).
function redirectTo(clientId: string, status: 'connected' | 'error', message?: string) {
  const url = new URL(`/clients/${clientId}/plan`, process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000')
  url.searchParams.set('google_connect', status)
  if (message) url.searchParams.set('message', message)
  return NextResponse.redirect(url)
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const code = searchParams.get('code')
  const state = searchParams.get('state')
  const errorParam = searchParams.get('error') // khách bấm "Từ chối" trên màn hình Google

  if (!state) {
    return NextResponse.json({ error: 'Thiếu state — không xác định được yêu cầu kết nối nào.' }, { status: 400 })
  }

  const verified = verifyOAuthState(state)
  if (!verified) {
    return NextResponse.json(
      { error: 'State không hợp lệ hoặc đã hết hạn (quá 10 phút) — thử kết nối lại.' },
      { status: 400 },
    )
  }

  if (errorParam) {
    return redirectTo(verified.clientId, 'error', 'Bạn đã từ chối cấp quyền trên Google.')
  }
  if (!code) {
    return redirectTo(verified.clientId, 'error', 'Thiếu mã xác thực từ Google.')
  }

  try {
    const tokens = await exchangeCodeForTokens(code)
    if (!tokens.refresh_token) {
      // Xảy ra nếu khách đã từng cấp quyền trước đó và Google không hỏi lại
      // prompt=consent vì lý do nào đó — không có refresh_token thì không
      // dùng được lâu dài, phải bắt kết nối lại.
      return redirectTo(
        verified.clientId,
        'error',
        'Không nhận được quyền truy cập lâu dài — thử ngắt kết nối trong Cài đặt tài khoản Google rồi kết nối lại.',
      )
    }

    const saved = await saveGoogleConnection({
      workspace_id: verified.workspaceId,
      client_id: verified.clientId,
      access_token_encrypted: encryptToken(tokens.access_token),
      refresh_token_encrypted: encryptToken(tokens.refresh_token),
      scope: tokens.scope,
      expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
    })

    // Lấy luôn location resource — best-effort, không chặn: nếu lỗi, khách
    // vẫn coi như "connected", có thể thử lại lúc thực thi task đầu tiên.
    try {
      const { accountResource, locationResource } = await resolveAccountAndLocation(tokens.access_token)
      await updateGoogleConnection(saved.id, {
        gbp_account_resource: accountResource,
        gbp_location_resource: locationResource,
      })
    } catch (resolveErr: any) {
      await updateGoogleConnection(saved.id, { last_error: `Chưa xác định được địa điểm: ${resolveErr.message}` })
    }

    return redirectTo(verified.clientId, 'connected')
  } catch (err: any) {
    return redirectTo(verified.clientId, 'error', err.message || 'Lỗi không xác định khi kết nối Google.')
  }
}
