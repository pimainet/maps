// Tạo mã đơn + thông tin chuyển khoản (thuần, test được).
import { transferContent } from './plans'

/** Mã đơn số nguyên 12 chữ số: giây hiện tại (10) + 2 số ngẫu nhiên. Duy nhất nhờ UNIQUE trong DB; trùng thì tạo lại. */
export function newOrderCode(now = Date.now(), rnd = Math.random()): number {
  return Math.floor(now / 1000) * 100 + Math.floor(rnd * 100)
}

export type BankInfo = { bankId: string; accountNo: string; accountName: string }

export function readBankInfo(env: Record<string, string | undefined> = process.env): BankInfo | null {
  const bankId = env.BILLING_BANK_ID?.trim()
  const accountNo = env.BILLING_ACCOUNT_NO?.trim()
  const accountName = env.BILLING_ACCOUNT_NAME?.trim()
  if (!bankId || !accountNo || !accountName) return null
  return { bankId, accountNo, accountName }
}

/** Ảnh QR chuyển khoản của VietQR (điền sẵn số tiền + nội dung). Định dạng URL theo tài liệu công khai của VietQR, cần thử thật 1 lần. */
export function vietQrUrl(bank: BankInfo, amount: number, orderCode: number): string {
  const q = new URLSearchParams({ amount: String(amount), addInfo: transferContent(orderCode), accountName: bank.accountName })
  return `https://img.vietqr.io/image/${encodeURIComponent(bank.bankId)}-${encodeURIComponent(bank.accountNo)}-compact2.png?${q.toString()}`
}
