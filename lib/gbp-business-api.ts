import { decryptToken, encryptToken, refreshAccessToken } from '@/lib/google-oauth'
import { updateGoogleConnection } from '@/lib/db'

const ACCOUNT_MGMT_BASE = 'https://mybusinessaccountmanagement.googleapis.com/v1'
const BUSINESS_INFO_BASE = 'https://mybusinessbusinessinformation.googleapis.com/v1'
const MY_BUSINESS_V4_BASE = 'https://mybusiness.googleapis.com/v4'

export class GbpApiError extends Error {
  constructor(
    message: string,
    public code: 'not_verified' | 'posts_disabled' | 'token_revoked' | 'api_error',
  ) {
    super(message)
  }
}

interface GoogleConnectionRow {
  id: string
  access_token_encrypted: string
  refresh_token_encrypted: string
  expires_at: string
  gbp_account_resource: string | null
  gbp_location_resource: string | null
}

/**
 * Trả access token còn hiệu lực — tự refresh (và lưu lại DB) nếu đã hết hạn
 * hoặc sắp hết hạn (< 2 phút). Nếu refresh thất bại (khách đã thu hồi quyền
 * bên phía Google), đánh dấu connection 'revoked' và throw lỗi rõ ràng thay
 * vì để lỗi 401 mù mờ từ Google lan ra ngoài.
 */
export async function getValidAccessToken(conn: GoogleConnectionRow): Promise<string> {
  const expiresAt = new Date(conn.expires_at).getTime()
  const nearExpiry = Date.now() > expiresAt - 2 * 60 * 1000

  if (!nearExpiry) {
    return decryptToken(conn.access_token_encrypted)
  }

  try {
    const refreshToken = decryptToken(conn.refresh_token_encrypted)
    const refreshed = await refreshAccessToken(refreshToken)
    await updateGoogleConnection(conn.id, {
      access_token_encrypted: encryptToken(refreshed.access_token),
      expires_at: new Date(Date.now() + refreshed.expires_in * 1000).toISOString(),
      status: 'connected',
      last_error: null,
    })
    return refreshed.access_token
  } catch (err: any) {
    await updateGoogleConnection(conn.id, {
      status: 'revoked',
      last_error: `Refresh token thất bại: ${err.message}`,
    })
    throw new GbpApiError(
      'Kết nối Google đã hết hiệu lực (có thể bạn đã thu hồi quyền truy cập bên phía Google) — cần kết nối lại.',
      'token_revoked',
    )
  }
}

/**
 * Lấy location resource (accounts/{id}/locations/{id}) lần đầu sau khi kết
 * nối — gọi 1 lần rồi cache vào DB (gbp_location_resource), không gọi lại
 * mỗi lần đăng bài. Business Profile API hiện KHÔNG có cách tra location
 * theo place_id trực tiếp — phải liệt kê accounts rồi locations, nên chỉ
 * khả thi nếu khách chỉ quản lý 1-vài địa điểm trong tài khoản Google đó
 * (đúng kịch bản self-serve chủ doanh nghiệp nhỏ, không phải agency quản
 * nhiều chi nhánh trên cùng 1 tài khoản).
 */
export async function resolveAccountAndLocation(
  accessToken: string,
): Promise<{ accountResource: string; locationResource: string; locationName: string }> {
  const accountsRes = await fetch(`${ACCOUNT_MGMT_BASE}/accounts`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!accountsRes.ok) {
    throw new GbpApiError(`Không lấy được danh sách account Google Business (${accountsRes.status}).`, 'api_error')
  }
  const accountsData = await accountsRes.json()
  const account = accountsData.accounts?.[0]
  if (!account) {
    throw new GbpApiError('Tài khoản Google này chưa quản lý Business Profile nào.', 'api_error')
  }

  const locationsRes = await fetch(
    `${BUSINESS_INFO_BASE}/${account.name}/locations?readMask=name,title,metadata`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  )
  if (!locationsRes.ok) {
    throw new GbpApiError(`Không lấy được danh sách địa điểm (${locationsRes.status}).`, 'api_error')
  }
  const locationsData = await locationsRes.json()
  const location = locationsData.locations?.[0]
  if (!location) {
    throw new GbpApiError('Không tìm thấy địa điểm nào gắn với tài khoản Google này.', 'api_error')
  }

  return { accountResource: account.name, locationResource: location.name, locationName: location.title }
}

/**
 * Kiểm tra location đã verified + chưa bị khoá đăng bài TRƯỚC khi gọi
 * localPosts.create — Google chặn cứng việc đăng bài cho location chưa
 * verified (đang chờ bưu thiếp, mới bị gắn cờ...), lỗi trả về mù mờ (403)
 * nếu không check trước. Kiểm tra trước giúp báo đúng lý do cho khách thay
 * vì để lỗi 403 chung chung.
 */
export async function assertLocationCanPost(locationResource: string, accessToken: string): Promise<void> {
  const res = await fetch(
    `${BUSINESS_INFO_BASE}/${locationResource}?readMask=metadata`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  )
  if (!res.ok) {
    throw new GbpApiError(`Không đọc được trạng thái địa điểm (${res.status}).`, 'api_error')
  }
  const data = await res.json()
  const isVerified = data?.metadata?.hasVoiceOfMerchant ?? data?.metadata?.isVerified
  if (isVerified === false) {
    throw new GbpApiError(
      'Hồ sơ Google Maps của bạn CHƯA được xác minh (verified) — Google không cho đăng bài tự động tới khi xác minh xong (thường qua bưu thiếp hoặc gọi điện). Việc này bạn cần tự hoàn tất với Google trước.',
      'not_verified',
    )
  }
  if (data?.metadata?.canHavePosts === false) {
    throw new GbpApiError(
      'Loại hồ sơ này hiện không hỗ trợ đăng bài (Google giới hạn theo từng loại danh mục doanh nghiệp).',
      'posts_disabled',
    )
  }
}

export interface CreateLocalPostResult {
  name: string
  searchUrl?: string
}

/**
 * Đăng 1 bài local post dạng STANDARD (chỉ text) — loại đơn giản/an toàn
 * nhất. topicType OFFER/EVENT cần thêm field riêng (couponCode, event
 * dates...) — để sau, không đoán thêm field chưa chắc đúng.
 */
export async function createLocalPost(
  locationResource: string,
  accessToken: string,
  summary: string,
): Promise<CreateLocalPostResult> {
  await assertLocationCanPost(locationResource, accessToken)

  const res = await fetch(`${MY_BUSINESS_V4_BASE}/${locationResource}/localPosts`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      languageCode: 'vi',
      summary,
      topicType: 'STANDARD',
    }),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new GbpApiError(`Đăng bài thất bại (${res.status}): ${body}`, 'api_error')
  }

  const data = await res.json()
  return { name: data.name, searchUrl: data.searchUrl }
}
