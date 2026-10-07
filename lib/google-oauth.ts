import crypto from 'crypto'

/**
 * Luồng OAuth2 RIÊNG để xin quyền `business.manage` — tách biệt hoàn toàn
 * khỏi Supabase Auth (app/login dùng supabase.auth.signInWithOAuth chỉ xin
 * email/profile cơ bản). Lý do tách riêng:
 *  1. Incremental authorization — khách login bình thường trước, chỉ khi
 *     bấm "Kết nối Google Business Profile" (1 bước RIÊNG, sau này, có giải
 *     thích rõ) mới bị hỏi quyền nhạy cảm này — đỡ ma sát + đỡ nghi ngại lúc
 *     đăng ký lần đầu.
 *  2. Supabase Auth không tự lưu lâu dài provider refresh token cho ta dùng
 *     ở backend về sau — phải tự quản lý vòng đời token, nên tách thành
 *     luồng OAuth2 thuần (authorization code + refresh token) tự viết.
 *
 * CÓ THỂ DÙNG CHUNG OAuth Client ID/Secret đã cấu hình cho Supabase Google
 * Login (Google Cloud Console) — chỉ cần thêm redirect URI của route
 * callback bên dưới vào danh sách "Authorized redirect URIs" của client đó.
 * Không bắt buộc phải tạo OAuth Client mới.
 *
 * Biến môi trường cần có:
 *   GOOGLE_OAUTH_CLIENT_ID
 *   GOOGLE_OAUTH_CLIENT_SECRET
 *   GOOGLE_OAUTH_REDIRECT_URI   (vd: https://app.yourdomain.vn/api/google-connect/callback)
 *   TOKEN_ENCRYPTION_KEY        (32 byte, base64 — tạo bằng: openssl rand -base64 32)
 */

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
export const GBP_SCOPE = 'https://www.googleapis.com/auth/business.manage'

function requiredEnv(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`Thiếu biến môi trường ${name} — cấu hình trước khi dùng google-oauth.`)
  return v
}

/**
 * state param chống CSRF — mã hoá workspaceId+clientId+nonce vào trong,
 * ký bằng HMAC để callback verify được mà KHÔNG cần lưu state vào DB/session
 * riêng (route handler stateless, dễ test).
 */
export function createOAuthState(params: { workspaceId: string; clientId: string }): string {
  const nonce = crypto.randomBytes(12).toString('hex')
  const payload = JSON.stringify({ ...params, nonce, ts: Date.now() })
  const payloadB64 = Buffer.from(payload).toString('base64url')
  const sig = signState(payloadB64)
  return `${payloadB64}.${sig}`
}

export function verifyOAuthState(
  state: string,
  maxAgeMs = 10 * 60 * 1000,
): { workspaceId: string; clientId: string } | null {
  const [payloadB64, sig] = state.split('.')
  if (!payloadB64 || !sig) return null
  if (sig !== signState(payloadB64)) return null // chữ ký sai -> state bị giả mạo hoặc hỏng
  try {
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'))
    if (Date.now() - payload.ts > maxAgeMs) return null // hết hạn -> bắt bấm kết nối lại
    return { workspaceId: payload.workspaceId, clientId: payload.clientId }
  } catch {
    return null
  }
}

function signState(payloadB64: string): string {
  const key = requiredEnv('TOKEN_ENCRYPTION_KEY')
  return crypto.createHmac('sha256', key).update(payloadB64).digest('base64url')
}

export function buildAuthorizationUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: requiredEnv('GOOGLE_OAUTH_CLIENT_ID'),
    redirect_uri: requiredEnv('GOOGLE_OAUTH_REDIRECT_URI'),
    response_type: 'code',
    scope: GBP_SCOPE,
    access_type: 'offline', // bắt buộc để nhận refresh_token
    prompt: 'consent', // bắt buộc để LUÔN nhận refresh_token (không chỉ lần đầu)
    state,
  })
  return `${GOOGLE_AUTH_URL}?${params.toString()}`
}

export interface GoogleTokenResponse {
  access_token: string
  refresh_token?: string // chỉ có ở lần cấp quyền đầu (hoặc khi prompt=consent)
  expires_in: number
  scope: string
  token_type: string
}

export async function exchangeCodeForTokens(code: string): Promise<GoogleTokenResponse> {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: requiredEnv('GOOGLE_OAUTH_CLIENT_ID'),
      client_secret: requiredEnv('GOOGLE_OAUTH_CLIENT_SECRET'),
      redirect_uri: requiredEnv('GOOGLE_OAUTH_REDIRECT_URI'),
      grant_type: 'authorization_code',
    }),
  })
  if (!res.ok) {
    throw new Error(`Đổi code lấy token thất bại (${res.status}): ${await res.text()}`)
  }
  return res.json()
}

export async function refreshAccessToken(refreshToken: string): Promise<GoogleTokenResponse> {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: requiredEnv('GOOGLE_OAUTH_CLIENT_ID'),
      client_secret: requiredEnv('GOOGLE_OAUTH_CLIENT_SECRET'),
      grant_type: 'refresh_token',
    }),
  })
  if (!res.ok) {
    // Refresh token có thể đã bị khách tự thu hồi quyền bên phía Google —
    // caller cần bắt lỗi này và đổi status connection sang 'revoked', yêu
    // cầu kết nối lại, KHÔNG được retry vô hạn.
    throw new Error(`Làm mới token thất bại (${res.status}): ${await res.text()}`)
  }
  return res.json()
}

// ---- Mã hoá token tại application layer (AES-256-GCM) ----

function getEncryptionKey(): Buffer {
  const b64 = requiredEnv('TOKEN_ENCRYPTION_KEY')
  const key = Buffer.from(b64, 'base64')
  if (key.length !== 32) {
    throw new Error('TOKEN_ENCRYPTION_KEY phải là 32 byte sau khi decode base64 (tạo bằng: openssl rand -base64 32).')
  }
  return key
}

/** Trả về 1 chuỗi base64 duy nhất gồm iv + authTag + ciphertext — tiện lưu thẳng vào 1 cột text. */
export function encryptToken(plaintext: string): string {
  const key = getEncryptionKey()
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return Buffer.concat([iv, authTag, encrypted]).toString('base64')
}

export function decryptToken(ciphertextB64: string): string {
  const key = getEncryptionKey()
  const buf = Buffer.from(ciphertextB64, 'base64')
  const iv = buf.subarray(0, 12)
  const authTag = buf.subarray(12, 28)
  const encrypted = buf.subarray(28)
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(authTag)
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8')
}
