// Email thanh toán: biên nhận, nhắc gia hạn, báo admin. Hàm thuần (không mạng/DB) để test được; gửi bằng sendEmail (Resend).
import { escapeHtml } from '@/lib/notifications'
import { PLAN_LABEL, normalizePlan, PLAN_GRACE_DAYS } from './plans'

export type BillingEmail = { subject: string; html: string; text: string }

const vnd = (n: number) => `${Math.round(n).toLocaleString('vi-VN')}đ`
/** Ngày theo giờ Việt Nam, dạng dd/mm/yyyy. */
export function vnDate(iso: string | Date): string {
  const d = new Date(new Date(iso).getTime() + 7 * 3_600_000)
  return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`
}

function wrap(title: string, rows: string[], cta?: { href: string; label: string }): string {
  const body = rows.map((r) => `<p style="margin:0 0 10px">${r}</p>`).join('')
  const button = cta
    ? `<p style="margin:18px 0"><a href="${escapeHtml(cta.href)}" style="background:#111827;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">${escapeHtml(cta.label)}</a></p>`
    : ''
  return `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;line-height:1.5;color:#111827;max-width:560px">
<h2 style="font-size:18px;margin:0 0 14px">${escapeHtml(title)}</h2>${body}${button}
<p style="margin:18px 0 0;color:#6b7280;font-size:13px">Local Growth OS</p></div>`
}

export type ReceiptInput = {
  workspaceName: string
  receiptNo: string | null
  orderCode: number
  plan: string
  periodMonths: number
  amountVnd: number
  paidVnd: number
  overpaidVnd: number
  paidAt: string
  result: string | null // activated | extended | scheduled
  periodStart: string | null
  periodEnd: string | null
  billingUrl: string
}

export function buildReceiptEmail(i: ReceiptInput): BillingEmail {
  const plan = PLAN_LABEL[normalizePlan(i.plan)]
  const what =
    i.result === 'scheduled' && i.periodStart
      ? `Gói ${plan} sẽ bắt đầu từ ${vnDate(i.periodStart)} (sau khi kỳ hiện tại kết thúc)`
      : i.result === 'extended'
        ? `Đã gia hạn gói ${plan}`
        : `Đã kích hoạt gói ${plan}`
  const until = i.periodEnd ? `, dùng đến hết ngày ${vnDate(i.periodEnd)}` : ''
  const lines = [
    `Cảm ơn bạn đã thanh toán cho "${i.workspaceName}". ${what}${until}.`,
    `Số biên nhận: ${i.receiptNo || '—'} · Mã đơn: LGOS${i.orderCode}`,
    `Gói: ${plan} · ${i.periodMonths} tháng · Giá: ${vnd(i.amountVnd)}`,
    `Đã nhận: ${vnd(i.paidVnd)} lúc ${vnDate(i.paidAt)}`,
  ]
  if (i.overpaidVnd > 0) lines.push(`Bạn chuyển dư ${vnd(i.overpaidVnd)}. Chúng tôi sẽ hoàn lại phần dư qua chuyển khoản; nếu cần liên hệ, hãy trả lời email này.`)
  lines.push('Đây là biên nhận thanh toán, không phải hoá đơn GTGT.')
  return {
    subject: `Biên nhận thanh toán ${i.receiptNo || `LGOS${i.orderCode}`} — gói ${plan}`,
    html: wrap('Đã nhận thanh toán', lines.map(escapeHtml), { href: i.billingUrl, label: 'Xem gói dịch vụ' }),
    text: [...lines, `Xem gói dịch vụ: ${i.billingUrl}`].join('\n'),
  }
}

export type ReminderKind = 'd14' | 'd7' | 'd3' | 'd1' | 'expired' | 'downgraded'

export function buildRenewalEmail(i: { workspaceName: string; plan: string; periodEnd: string; kind: ReminderKind; renewUrl: string; now?: Date }): BillingEmail {
  const plan = PLAN_LABEL[normalizePlan(i.plan)]
  const end = vnDate(i.periodEnd)
  const graceEnd = vnDate(new Date(new Date(i.periodEnd).getTime() + PLAN_GRACE_DAYS * 86_400_000))
  const days = { d14: 14, d7: 7, d3: 3, d1: 1 } as Record<string, number>
  let subject: string
  let lines: string[]
  if (i.kind === 'expired') {
    subject = `Gói ${plan} của "${i.workspaceName}" đã hết hạn`
    lines = [
      `Gói ${plan} của "${i.workspaceName}" đã hết hạn ngày ${end}.`,
      `Bạn vẫn dùng được đầy đủ tính năng đến hết ngày ${graceEnd}. Sau đó tài khoản về gói Miễn phí (dữ liệu vẫn được giữ).`,
    ]
  } else if (i.kind === 'downgraded') {
    subject = `"${i.workspaceName}" đã chuyển về gói Miễn phí`
    lines = [
      `Gói ${plan} của "${i.workspaceName}" hết hạn ngày ${end} và đã chuyển về gói Miễn phí. Dữ liệu của bạn vẫn được giữ nguyên.`,
      'Gia hạn bất cứ lúc nào để mở lại các tính năng.',
    ]
  } else {
    const d = days[i.kind] ?? 0
    subject = `Gói ${plan} của "${i.workspaceName}" hết hạn sau ${d} ngày (${end})`
    lines = [
      `Gói ${plan} của "${i.workspaceName}" sẽ hết hạn ngày ${end}.`,
      'Gia hạn trước ngày này để không bị gián đoạn. Thời gian mới được cộng nối tiếp, không mất ngày nào.',
    ]
  }
  return {
    subject,
    html: wrap(subject, lines.map(escapeHtml), { href: i.renewUrl, label: 'Gia hạn ngay' }),
    text: [...lines, `Gia hạn: ${i.renewUrl}`].join('\n'),
  }
}

export type AdminAlert = {
  kind: 'overpaid' | 'underpaid' | 'unmatched' | 'needs_review'
  amountVnd: number
  content: string
  orderCode: number | null
  workspaceName?: string | null
  reason?: string | null
  transferredAt?: string | null
  adminUrl: string
}

const ALERT_TITLE: Record<AdminAlert['kind'], string> = {
  overpaid: 'Khách chuyển DƯ tiền — cần hoàn phần dư',
  underpaid: 'Khách chuyển THIẾU tiền — đơn chưa kích hoạt',
  unmatched: 'Tiền vào không khớp đơn nào',
  needs_review: 'Tiền vào cần xem lại',
}

export function buildAdminAlertEmail(a: AdminAlert): BillingEmail {
  const extra = a.reason?.match(/^(?:overpaid|underpaid):(\d+)/)?.[1]
  const lines = [
    `Số tiền: ${vnd(a.amountVnd)}${a.transferredAt ? ` · lúc ${a.transferredAt.replace('T', ' ').slice(0, 16)}` : ''}`,
    `Nội dung CK: ${a.content || '(trống)'}`,
    `Mã đơn: ${a.orderCode ? `LGOS${a.orderCode}` : 'không tìm thấy'}${a.workspaceName ? ` · ${a.workspaceName}` : ''}`,
  ]
  if (a.kind === 'overpaid' && extra) lines.push(`Đơn ĐÃ được kích hoạt. Phần dư cần hoàn tay: ${vnd(Number(extra))}. Hoàn xong bấm "Đã hoàn tiền" trong hàng chờ.`)
  if (a.kind === 'underpaid' && extra) lines.push(`Còn thiếu ${vnd(Number(extra))}. Đơn tự kích hoạt khi khách chuyển nốt; hoặc hoàn tiền / gán tay trong hàng chờ.`)
  if (a.kind === 'unmatched') lines.push('Mở hàng chờ để gán vào đúng đơn (có gợi ý theo số tiền và mã gần giống), hoặc đánh dấu bỏ qua / đã hoàn.')
  if (a.reason && !extra) lines.push(`Lý do: ${a.reason}`)
  const title = ALERT_TITLE[a.kind]
  return {
    subject: `[Thanh toán] ${title} — ${vnd(a.amountVnd)}`,
    html: wrap(title, lines.map(escapeHtml), { href: a.adminUrl, label: 'Mở hàng chờ đối soát' }),
    text: [title, ...lines, a.adminUrl].join('\n'),
  }
}

/** Phân loại kết quả ingest để quyết định có báo admin không. null = không cần báo. */
export function alertKindFor(status: string, reason: string | null | undefined): AdminAlert['kind'] | null {
  if (status === 'unmatched') return 'unmatched'
  if (status === 'partial') return 'underpaid'
  if (status === 'needs_review') return 'needs_review'
  if (status === 'matched' && reason?.startsWith('overpaid:')) return 'overpaid'
  return null
}

export function buildAdminDigestEmail(i: { count: number; totalVnd: number; oldestAt: string | null; adminUrl: string }): BillingEmail {
  const lines = [
    `Hàng chờ đối soát còn ${i.count} khoản (tổng ${vnd(i.totalVnd)}) cần bạn xử lý.`,
    i.oldestAt ? `Khoản cũ nhất nhận lúc ${vnDate(i.oldestAt)}.` : '',
  ].filter(Boolean)
  const subject = `[Thanh toán] ${i.count} khoản tiền vào đang chờ xử lý`
  return { subject, html: wrap(subject, lines.map(escapeHtml), { href: i.adminUrl, label: 'Mở hàng chờ' }), text: [...lines, i.adminUrl].join('\n') }
}
