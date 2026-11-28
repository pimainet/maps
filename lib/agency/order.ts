// Đơn gói Làm hộ do admin tạo (thuần: chuẩn hoá đầu vào + soạn tin để gửi khách; test được).
import { isPaidPlan, isPeriod, priceFor, PLAN_LABEL, transferContent, type PaidPlan, type PeriodMonths } from '@/lib/billing/plans'

export const MIN_CUSTOM_AMOUNT_VND = 1_000
export const MAX_CUSTOM_AMOUNT_VND = 100_000_000
export const DEFAULT_EXPIRES_DAYS = 14

export type AdminOrderInput = { plan: PaidPlan; months: PeriodMonths; amount: number; customAmount: boolean; expiresDays: number }

export function parseAdminOrder(body: unknown): { ok: true; value: AdminOrderInput } | { ok: false; error: string } {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
  const plan = b.plan ?? 'done_for_you'
  const months = Number(b.months ?? 1)
  if (!isPaidPlan(plan) || !isPeriod(months)) return { ok: false, error: 'Gói hoặc kỳ hạn không hợp lệ (kỳ hạn 1, 3 hoặc 12 tháng).' }
  let amount = priceFor(plan, months)
  let customAmount = false
  if (b.amount_vnd != null && b.amount_vnd !== '') {
    const n = Number(b.amount_vnd)
    if (!Number.isInteger(n) || n < MIN_CUSTOM_AMOUNT_VND || n > MAX_CUSTOM_AMOUNT_VND) {
      return { ok: false, error: `Số tiền tuỳ chỉnh phải là số nguyên từ ${MIN_CUSTOM_AMOUNT_VND.toLocaleString('vi-VN')} đến ${MAX_CUSTOM_AMOUNT_VND.toLocaleString('vi-VN')}đ.` }
    }
    customAmount = n !== amount
    amount = n
  }
  const d = b.expires_days == null || b.expires_days === '' ? DEFAULT_EXPIRES_DAYS : Number(b.expires_days)
  if (!Number.isInteger(d) || d < 1 || d > 60) return { ok: false, error: 'Hạn đơn phải từ 1 đến 60 ngày.' }
  return { ok: true, value: { plan, months, amount, customAmount, expiresDays: d } }
}

const vnd = (n: number) => `${Math.round(n).toLocaleString('vi-VN')}đ`

/** Tin nhắn nhân viên gửi khách (Zalo/SMS) kèm thông tin chuyển khoản. */
export function buildPaymentMessage(i: { workspaceName: string; plan: PaidPlan; months: number; amount: number; bankId: string; accountNo: string; accountName: string; orderCode: number; expiresAt: string; qrUrl: string }): string {
  const exp = new Date(new Date(i.expiresAt).getTime() + 7 * 3_600_000)
  const d = `${String(exp.getUTCDate()).padStart(2, '0')}/${String(exp.getUTCMonth() + 1).padStart(2, '0')}/${exp.getUTCFullYear()}`
  return [
    `Chào anh/chị, thông tin thanh toán gói ${PLAN_LABEL[i.plan]} (${i.months} tháng) cho "${i.workspaceName}":`,
    `- Số tiền: ${vnd(i.amount)}`,
    `- Ngân hàng: ${i.bankId} · STK: ${i.accountNo} · ${i.accountName}`,
    `- Nội dung chuyển khoản (giữ nguyên): ${transferContent(i.orderCode)}`,
    `- Mã QR: ${i.qrUrl}`,
    `Đơn có hiệu lực đến ${d}. Gói tự kích hoạt sau khi tiền về, biên nhận gửi qua email.`,
  ].join('\n')
}
