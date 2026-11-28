// Email của gói Làm hộ: báo admin có yêu cầu tư vấn, gửi báo cáo tháng cho khách, tóm tắt việc cho nhân viên.
// Hàm thuần (không mạng/DB); gửi bằng sendEmail (Resend) ở nơi gọi.
import { escapeHtml } from '@/lib/notifications'
import { deltaText, type MonthlyReport } from './report'
import type { LeadInput } from './lead'

export type AgencyEmail = { subject: string; html: string; text: string }

function wrap(title: string, bodyHtml: string, cta?: { href: string; label: string }): string {
  const button = cta
    ? `<p style="margin:18px 0"><a href="${escapeHtml(cta.href)}" style="background:#111827;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">${escapeHtml(cta.label)}</a></p>`
    : ''
  return `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;line-height:1.5;color:#111827;max-width:600px">
<h2 style="font-size:18px;margin:0 0 14px">${escapeHtml(title)}</h2>${bodyHtml}${button}
<p style="margin:18px 0 0;color:#6b7280;font-size:13px">Local Growth OS</p></div>`
}

const p = (s: string) => `<p style="margin:0 0 10px">${escapeHtml(s)}</p>`
const li = (xs: string[]) => `<ul style="margin:0 0 12px;padding-left:20px">${xs.map((x) => `<li>${escapeHtml(x)}</li>`).join('')}</ul>`

export function buildConsultationAdminEmail(i: { lead: LeadInput; workspaceName: string | null; userEmail?: string | null; adminUrl: string }): AgencyEmail {
  const l = i.lead
  const rows: [string, string][] = [
    ['Tên', l.contact_name],
    ['Điện thoại', l.phone],
    ['Email', l.email || i.userEmail || '—'],
    ['Doanh nghiệp', l.business_name || '—'],
    ['Workspace', i.workspaceName || '—'],
    ['Lời nhắn', l.message || '—'],
  ]
  const subject = `Yêu cầu tư vấn gói Làm hộ: ${l.contact_name} · ${l.phone}`
  return {
    subject,
    html: wrap(
      'Có khách muốn tư vấn gói Làm hộ',
      `<table style="border-collapse:collapse;margin:0 0 8px">${rows
        .map(([k, v]) => `<tr><td style="padding:4px 14px 4px 0;color:#6b7280;vertical-align:top">${escapeHtml(k)}</td><td style="padding:4px 0">${escapeHtml(v)}</td></tr>`)
        .join('')}</table>`,
      { href: i.adminUrl, label: 'Mở danh sách tư vấn' },
    ),
    text: [...rows.map(([k, v]) => `${k}: ${v}`), `Mở: ${i.adminUrl}`].join('\n'),
  }
}

export function buildMonthlyReportEmail(r: MonthlyReport, reportUrl: string): AgencyEmail {
  const subject = `Báo cáo ${r.periodLabel.toLowerCase()} — ${r.clientName}`
  let html = p(`Dưới đây là tóm tắt ${r.periodLabel.toLowerCase()} của "${r.clientName}" trên Google Maps.`)
  const text: string[] = [`Tóm tắt ${r.periodLabel.toLowerCase()} của "${r.clientName}" trên Google Maps.`, '']

  html += `<h3 style="font-size:15px;margin:14px 0 6px">Điểm nổi bật</h3>${li(r.highlights)}`
  text.push('ĐIỂM NỔI BẬT', ...r.highlights.map((h) => `- ${h}`), '')

  if (r.rank) {
    const head = '<tr><th align="left">Từ khoá</th><th align="right">Top 3 (SoLV)</th><th align="right">Thay đổi</th><th align="right">Hạng TB</th></tr>'
    const body = r.rank.keywords
      .map((k) => {
        const solv = k.current?.solv != null ? `${k.current.solv}%` : '—'
        const d = k.trend === 'new' ? 'mốc đầu' : deltaText(k.solvDelta)
        const arp = k.current?.arp != null ? String(k.current.arp) : '—'
        return `<tr><td style="padding:3px 10px 3px 0">${escapeHtml(k.keyword)}</td><td align="right" style="padding:3px 10px">${solv}</td><td align="right" style="padding:3px 10px">${escapeHtml(d)}</td><td align="right" style="padding:3px 0">${arp}</td></tr>`
      })
      .join('')
    html += `<h3 style="font-size:15px;margin:14px 0 6px">Thứ hạng trên bản đồ</h3><table style="border-collapse:collapse;font-size:14px">${head}${body}</table>`
    text.push('THỨ HẠNG TRÊN BẢN ĐỒ')
    for (const k of r.rank.keywords) text.push(`- ${k.keyword}: ${k.current?.solv != null ? `${k.current.solv}%` : '—'} (${k.trend === 'new' ? 'mốc đầu' : deltaText(k.solvDelta)})`)
    text.push('')
  }
  if (r.nextSteps.length) {
    html += `<h3 style="font-size:15px;margin:14px 0 6px">Việc tiếp theo</h3>${li(r.nextSteps)}`
    text.push('VIỆC TIẾP THEO', ...r.nextSteps.map((h) => `- ${h}`), '')
  }
  text.push(`Xem báo cáo đầy đủ: ${reportUrl}`)
  return { subject, html: wrap(`Báo cáo ${r.periodLabel.toLowerCase()}`, html, { href: reportUrl, label: 'Xem báo cáo đầy đủ' }), text: text.join('\n') }
}

export type AgencyDigest = { posts: number; reviews: number; urgentReviews: number; tasks: number; reportsDue: number; leads: number }

export function agencyDigestHasWork(d: AgencyDigest): boolean {
  return d.posts + d.reviews + d.tasks + d.reportsDue + d.leads > 0
}

export function buildAgencyDigestEmail(d: AgencyDigest, queueUrl: string): AgencyEmail {
  const lines = [
    d.posts ? `${d.posts} bài tự đăng chờ duyệt` : null,
    d.reviews ? `${d.reviews} phản hồi review chờ duyệt${d.urgentReviews ? ` (${d.urgentReviews} khẩn)` : ''}` : null,
    d.tasks ? `${d.tasks} việc tối ưu hồ sơ quá hạn hoặc đến hạn` : null,
    d.reportsDue ? `${d.reportsDue} báo cáo tháng cần gửi` : null,
    d.leads ? `${d.leads} yêu cầu tư vấn chưa xử lý` : null,
  ].filter(Boolean) as string[]
  const subject = `Gói Làm hộ: ${lines.length} nhóm việc đang chờ`
  return { subject, html: wrap('Việc của khách gói Làm hộ đang chờ', li(lines), { href: queueUrl, label: 'Mở hàng đợi' }), text: [...lines.map((l) => `- ${l}`), `Mở: ${queueUrl}`].join('\n') }
}
