// Xác thực webhook SePay + chuẩn hoá payload (webhook và API liệt kê giao dịch). Thuần, không DB, để test được.
// Tài liệu: developer.sepay.vn/en/sepay-webhooks/xac-thuc, docs.sepay.vn/tich-hop-webhooks.html, docs.sepay.vn/api-giao-dich.html
import crypto from 'node:crypto'

export const SEPAY_MAX_SKEW_SECONDS = 300

const safeEq = (a: string, b: string) => {
  const x = Buffer.from(a), y = Buffer.from(b)
  return x.length === y.length && crypto.timingSafeEqual(x, y)
}

export type AuthResult = { ok: true; mode: 'hmac' | 'apikey' } | { ok: false; status: 401 | 503; reason: string }

/** Chữ ký SePay: header X-SePay-Signature = "sha256=" + hex(HMAC_SHA256(secret, `${timestamp}.${rawBody}`)), X-SePay-Timestamp = giây Unix. */
export function verifySePay(
  rawBody: string,
  headers: { get(name: string): string | null },
  env: { SEPAY_WEBHOOK_SECRET?: string; SEPAY_WEBHOOK_API_KEY?: string },
  nowMs = Date.now(),
): AuthResult {
  const secret = env.SEPAY_WEBHOOK_SECRET
  const apiKey = env.SEPAY_WEBHOOK_API_KEY
  if (!secret && !apiKey) return { ok: false, status: 503, reason: 'webhook chưa cấu hình xác thực (đóng theo mặc định)' }

  if (secret) {
    const sig = headers.get('x-sepay-signature') || ''
    const ts = headers.get('x-sepay-timestamp') || ''
    if (sig && ts) {
      const t = Number(ts)
      if (!Number.isFinite(t) || Math.abs(nowMs / 1000 - t) > SEPAY_MAX_SKEW_SECONDS) return { ok: false, status: 401, reason: 'timestamp lệch quá 5 phút' }
      const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(`${ts}.${rawBody}`).digest('hex')
      return safeEq(expected, sig) ? { ok: true, mode: 'hmac' } : { ok: false, status: 401, reason: 'chữ ký sai' }
    }
  }
  if (apiKey) {
    const auth = headers.get('authorization') || ''
    return safeEq(`Apikey ${apiKey}`, auth) ? { ok: true, mode: 'apikey' } : { ok: false, status: 401, reason: 'API key sai' }
  }
  return { ok: false, status: 401, reason: 'thiếu chữ ký' }
}

export type SePayPayload = {
  id: number | string; gateway?: string; transactionDate?: string; accountNumber?: string; subAccount?: string | null
  code?: string | null; content?: string | null; transferType?: string; description?: string; transferAmount?: number
  accumulated?: number; referenceCode?: string | null
}

export type Normalized = {
  provider: 'sepay'; txnId: string; amount: number; content: string; bankRef: string | null; account: string | null
  bankName: string | null; providerCode: string | null; transferredAt: string | null
}

/** Trả null nếu không phải tiền vào hợp lệ vào ĐÚNG tài khoản của mình (giao dịch khác/tiền ra/thử nghiệm: bỏ qua, vẫn trả success). */
export function normalizeSePay(p: any, ourAccountNo: string): Normalized | { skip: string } {
  if (!p || typeof p !== 'object') return { skip: 'bad_payload' }
  if (p.transferType !== 'in') return { skip: 'not_incoming' }
  const amount = Number(p.transferAmount)
  if (!Number.isSafeInteger(amount) || amount <= 0) return { skip: 'bad_amount' }
  const id = p.id != null ? String(p.id) : ''
  if (!id) return { skip: 'no_id' }
  const digits = (s: unknown) => String(s ?? '').replace(/\D/g, '')
  if (!ourAccountNo || digits(p.accountNumber) !== digits(ourAccountNo)) return { skip: 'other_account' }
  return {
    provider: 'sepay', txnId: id, amount, content: String(p.content ?? p.description ?? '').slice(0, 500),
    bankRef: p.referenceCode ? String(p.referenceCode) : null, account: digits(p.accountNumber) || null,
    bankName: p.gateway ? String(p.gateway) : null, providerCode: p.code ? String(p.code) : null,
    transferredAt: sepayTimeToIso(p.transactionDate),
  }
}

const digitsOnly = (s: unknown) => String(s ?? '').replace(/\D/g, '')

/** "YYYY-MM-DD HH:mm:ss" của SePay -> ISO giờ Việt Nam (giả định +07:00, chưa kiểm chứng). */
export function sepayTimeToIso(s: unknown): string | null {
  const m = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})$/.exec(String(s ?? ''))
  return m ? `${m[1]}T${m[2]}+07:00` : null
}

/** Một dòng của GET /userapi/transactions/list (đối soát bù). Cùng `id` với webhook => nạp lại là idempotent. */
export function normalizeSePayApiRow(r: any, ourAccountNo: string): Normalized | { skip: string } {
  if (!r || typeof r !== 'object') return { skip: 'bad_payload' }
  const amount = Number(r.amount_in)
  if (!Number.isFinite(amount) || amount <= 0) return { skip: 'not_incoming' }
  if (!Number.isSafeInteger(amount)) return { skip: 'bad_amount' }
  const id = r.id != null ? String(r.id) : ''
  if (!id) return { skip: 'no_id' }
  if (!ourAccountNo || digitsOnly(r.account_number) !== digitsOnly(ourAccountNo)) return { skip: 'other_account' }
  return {
    provider: 'sepay', txnId: id, amount, content: String(r.transaction_content ?? '').slice(0, 500),
    bankRef: r.reference_number ? String(r.reference_number) : null, account: digitsOnly(r.account_number) || null,
    bankName: r.bank_brand_name ? String(r.bank_brand_name) : null, providerCode: r.code ? String(r.code) : null,
    transferredAt: sepayTimeToIso(r.transaction_date),
  }
}
