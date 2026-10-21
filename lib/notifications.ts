// Email nhắc việc: dựng nội dung, gửi qua Resend (REST, không cần SDK), và ký link hủy đăng ký.
// Phần dựng nội dung là hàm thuần để chạy thử được mà không cần mạng hay database.
import crypto from 'node:crypto'
import type { ProgressSummary } from '@/lib/progress'

// ── Thời gian theo giờ Việt Nam (UTC+7, không có giờ mùa hè) ───────────────
const VN_OFFSET_MS = 7 * 60 * 60 * 1000
const vnShift = (now: Date) => new Date(now.getTime() + VN_OFFSET_MS)
export const vnTodayISO = (now: Date = new Date()) => vnShift(now).toISOString().slice(0, 10)
/** 0 = Chủ nhật, 1 = Thứ hai, ... theo giờ Việt Nam. */
export const vnWeekday = (now: Date = new Date()) => vnShift(now).getUTCDay()

export function appUrl(): string {
  const raw =
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.APP_URL ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : '') ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '')
  return (raw || 'http://localhost:3000').replace(/\/+$/, '')
}

export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// ── Link hủy đăng ký có chữ ký (không cần đăng nhập mới bấm được) ──────────
function signingSecret() {
  return process.env.NOTIFY_SECRET || process.env.CRON_SECRET || ''
}

export function unsubscribeToken(userId: string): string | null {
  const secret = signingSecret()
  if (!secret) return null
  return crypto.createHmac('sha256', secret).update(`unsubscribe:${userId}`).digest('hex')
}

export function verifyUnsubscribeToken(userId: string, token: string | null | undefined): boolean {
  const expected = unsubscribeToken(userId)
  if (!expected || !token) return false
  const a = Buffer.from(expected)
  const b = Buffer.from(token)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

export function unsubscribeUrl(userId: string): string | null {
  const token = unsubscribeToken(userId)
  if (!token) return null
  return `${appUrl()}/api/notifications/unsubscribe?u=${encodeURIComponent(userId)}&t=${token}`
}

// ── Dựng nội dung email ─────────────────────────────────────────────────────
export type ReminderTask = {
  id: string
  title: string
  client_name?: string | null
  due_date?: string | null
}

export type ReminderInput = {
  name?: string | null
  today: string // YYYY-MM-DD theo giờ Việt Nam
  isMonday: boolean
  /** Việc đang chờ của người nhận (đã bỏ việc xong/bỏ qua). */
  pendingTasks: ReminderTask[]
  waitingApproval: number
  progress: ProgressSummary
  appUrl: string
  unsubscribeUrl: string | null
  /** Gửi thử: luôn tạo email dù hôm nay không có việc đến hạn. */
  force?: boolean
}

export type ReminderEmail = { subject: string; html: string; text: string }

const dateKey = (d?: string | null) => (d ? String(d).slice(0, 10) : '')
const ddmm = (key: string) => `${key.slice(8, 10)}/${key.slice(5, 7)}`

function dueLabel(task: ReminderTask, today: string) {
  const key = dateKey(task.due_date)
  if (!key) return ''
  if (key < today) return `Quá hạn từ ${ddmm(key)}`
  if (key === today) return 'Hạn hôm nay'
  return `Hạn ${ddmm(key)}`
}

function givenName(fullName?: string | null) {
  const parts = (fullName || '').trim().split(/\s+/).filter(Boolean)
  return parts[parts.length - 1] || ''
}

const MAX_LISTED = 5

/** Trả về null nếu hôm nay không có gì đáng để làm phiền người nhận. */
export function buildReminderEmail(input: ReminderInput): ReminderEmail | null {
  const { today, progress } = input
  const overdue = input.pendingTasks.filter((t) => dateKey(t.due_date) && dateKey(t.due_date) < today)
  const dueToday = input.pendingTasks.filter((t) => dateKey(t.due_date) === today)
  const dueNow = overdue.length + dueToday.length
  const weeklyNudge = dueNow === 0 && input.isMonday && input.pendingTasks.length > 0

  if (dueNow === 0 && !weeklyNudge && !input.force) return null

  // Việc đưa vào danh sách: quá hạn trước, rồi hôm nay; nếu chỉ nhắc đầu tuần/gửi thử thì lấy việc gần hạn nhất.
  const byDue = (a: ReminderTask, b: ReminderTask) => (dateKey(a.due_date) || '9999-12-31').localeCompare(dateKey(b.due_date) || '9999-12-31')
  const listed = (dueNow > 0 ? [...overdue, ...dueToday] : [...input.pendingTasks]).sort(byDue).slice(0, MAX_LISTED)
  const hidden = (dueNow > 0 ? dueNow : input.pendingTasks.length) - listed.length

  let subject: string
  let summary: string
  if (dueNow > 0) {
    subject = `Hôm nay bạn có ${dueNow} việc cần làm`
    if (dueToday.length > 0 && overdue.length > 0) summary = `Hôm nay bạn có ${dueToday.length} việc đến hạn và ${overdue.length} việc quá hạn.`
    else if (dueToday.length > 0) summary = `Hôm nay bạn có ${dueToday.length} việc đến hạn.`
    else summary = `Bạn có ${overdue.length} việc đã quá hạn. Làm từng việc một là được.`
  } else if (weeklyNudge) {
    subject = `Tuần mới: bạn còn ${input.pendingTasks.length} việc trong kế hoạch`
    summary = `Tuần mới bắt đầu. Bạn còn ${input.pendingTasks.length} việc trong kế hoạch.`
  } else {
    subject = 'Nhắc việc từ Local Growth OS'
    summary = `Đây là email gửi thử. Hiện bạn còn ${input.pendingTasks.length} việc trong kế hoạch.`
  }
  if (input.force) subject = `[Gửi thử] ${subject}`

  // Dòng tiến bộ: chỉ số thật, bỏ qua nếu chưa có việc nào
  const progressLines: string[] = []
  if (progress.total > 0) {
    progressLines.push(`Bạn đã xong ${progress.done}/${progress.total} việc (${progress.percent}%).`)
    if (progress.doneThisWeek) progressLines.push(`Tuần qua bạn đã xong ${progress.doneThisWeek} việc.`)
    if (progress.nextMilestone) progressLines.push(`Còn ${progress.nextMilestone.remaining} việc nữa là đạt ${progress.nextMilestone.target}%.`)
  }
  const approvalLine = input.waitingApproval > 0 ? `Có ${input.waitingApproval} bài đang chờ bạn duyệt.` : ''

  const hello = givenName(input.name) ? `Chào ${givenName(input.name)},` : 'Xin chào,'
  const tasksUrl = `${input.appUrl}/tasks`
  const contentsUrl = `${input.appUrl}/contents`
  const settingsUrl = `${input.appUrl}/settings`

  // ── Bản chữ thường ──
  const textParts = [
    hello,
    '',
    summary,
    '',
    ...listed.map((t) => `- ${t.title}${t.client_name ? ` (${t.client_name})` : ''}${dueLabel(t, today) ? `: ${dueLabel(t, today)}` : ''}`),
    ...(hidden > 0 ? [`... và ${hidden} việc nữa.`] : []),
    '',
    ...(approvalLine ? [approvalLine, contentsUrl, ''] : []),
    `Bắt đầu làm: ${tasksUrl}`,
    '',
    ...(progressLines.length ? [...progressLines, ''] : []),
    '---',
    'Bạn nhận email này vì đang dùng Local Growth OS.',
    input.unsubscribeUrl ? `Tắt email nhắc việc: ${input.unsubscribeUrl}` : `Tắt nhắc việc trong Cài đặt: ${settingsUrl}`,
  ]

  // ── Bản HTML (bảng + style nội tuyến để hiển thị ổn định trên các ứng dụng email) ──
  const font = "-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"
  const taskRows = listed
    .map((t) => {
      const label = dueLabel(t, today)
      const late = dateKey(t.due_date) && dateKey(t.due_date) < today
      return `<tr><td style="padding:12px 0;border-bottom:1px solid #e8eaf2;">
        <div style="font-size:16px;font-weight:600;color:#10142a;line-height:1.4;">${escapeHtml(t.title)}</div>
        <div style="margin-top:4px;font-size:13.5px;color:#5b6280;">${escapeHtml(t.client_name || '')}${t.client_name && label ? ' &nbsp;' : ''}${
          label ? `<span style="color:${late ? '#b4232a' : '#5b6280'};font-weight:${late ? 600 : 400};">${escapeHtml(label)}</span>` : ''
        }</div>
      </td></tr>`
    })
    .join('')

  const bar = progress.total > 0 ? Math.max(2, Math.min(100, progress.percent)) : 0
  const progressBlock =
    progress.total > 0
      ? `<tr><td style="padding:24px 0 0;">
          <div style="font-size:14px;color:#10142a;font-weight:600;">${escapeHtml(progressLines[0])}</div>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:8px;"><tr>
            <td width="${bar}%" style="background:#5b6cf0;height:8px;border-radius:4px;font-size:0;line-height:0;">&nbsp;</td>
            <td style="background:#e8eaf2;height:8px;border-radius:4px;font-size:0;line-height:0;">&nbsp;</td>
          </tr></table>
          ${progressLines
            .slice(1)
            .map((l) => `<div style="margin-top:6px;font-size:13.5px;color:#5b6280;">${escapeHtml(l)}</div>`)
            .join('')}
        </td></tr>`
      : ''

  const html = `<!doctype html>
<html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:#f3f4f9;font-family:${font};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f9;"><tr><td align="center" style="padding:24px 12px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">
    <tr><td style="background:#0b0f1a;border-radius:16px 16px 0 0;padding:20px 28px;font-size:16px;font-weight:600;color:#e8ecf8;letter-spacing:-0.01em;">Local Growth <span style="color:#e3c98f;font-size:12px;letter-spacing:0.12em;">OS</span></td></tr>
    <tr><td style="background:#ffffff;border-radius:0 0 16px 16px;padding:28px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr><td style="font-size:16px;color:#10142a;line-height:1.6;">${escapeHtml(hello)}<br>${escapeHtml(summary)}</td></tr>
        <tr><td style="padding-top:12px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${taskRows}</table>${
          hidden > 0 ? `<div style="padding-top:10px;font-size:13.5px;color:#5b6280;">và ${hidden} việc nữa.</div>` : ''
        }</td></tr>
        ${
          approvalLine
            ? `<tr><td style="padding-top:16px;font-size:14.5px;color:#10142a;">${escapeHtml(approvalLine)} <a href="${escapeHtml(contentsUrl)}" style="color:#4c5ce0;">Xem bài viết</a></td></tr>`
            : ''
        }
        <tr><td style="padding-top:24px;"><a href="${escapeHtml(tasksUrl)}" style="display:inline-block;background:#5b6cf0;color:#ffffff;text-decoration:none;font-weight:600;font-size:16px;padding:13px 26px;border-radius:12px;">Bắt đầu làm</a></td></tr>
        ${progressBlock}
      </table>
    </td></tr>
    <tr><td style="padding:18px 8px;font-size:12.5px;line-height:1.6;color:#7a8099;text-align:center;">
      Bạn nhận email này vì đang dùng Local Growth OS.<br>
      ${
        input.unsubscribeUrl
          ? `<a href="${escapeHtml(input.unsubscribeUrl)}" style="color:#7a8099;">Tắt email nhắc việc</a>`
          : `<a href="${escapeHtml(settingsUrl)}" style="color:#7a8099;">Tắt nhắc việc trong Cài đặt</a>`
      }
    </td></tr>
  </table>
</td></tr></table>
</body></html>`

  return { subject, html, text: textParts.join('\n') }
}

// ── Gửi email qua Resend ────────────────────────────────────────────────────
export type SendResult = { ok: boolean; id?: string; skipped?: 'no_provider' | 'no_from'; error?: string }

export function emailProviderReady(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.REMINDER_FROM_EMAIL)
}

export async function sendEmail(msg: {
  to: string
  subject: string
  html: string
  text: string
  unsubscribeUrl?: string | null
}): Promise<SendResult> {
  const key = process.env.RESEND_API_KEY
  const from = process.env.REMINDER_FROM_EMAIL
  if (!key) return { ok: false, skipped: 'no_provider' }
  if (!from) return { ok: false, skipped: 'no_from' }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from,
        to: [msg.to],
        subject: msg.subject,
        html: msg.html,
        text: msg.text,
        ...(msg.unsubscribeUrl
          ? { headers: { 'List-Unsubscribe': `<${msg.unsubscribeUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } }
          : {}),
      }),
      signal: AbortSignal.timeout(15000),
    })
    const body: any = await res.json().catch(() => ({}))
    if (!res.ok) return { ok: false, error: body?.message || `Dịch vụ gửi email trả lỗi ${res.status}` }
    return { ok: true, id: body?.id }
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Không gửi được email' }
  }
}
