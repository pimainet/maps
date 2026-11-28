/**
 * Audit đã lưu trong DB có 2 loại (THUẦN, test được):
 *  - 'v2'     : do engine hiện tại chấm (có `checks_json` = AuditReport, điểm 0–100, lặp lại được).
 *  - 'legacy' : audit cũ chấm tự do bằng 1 prompt AI (không có `checks_json`, điểm thang 10 đọc từ văn bản).
 *               Engine cũ đã bị gỡ khỏi code; các dòng này chỉ còn để XEM (chỉ đọc), không bao giờ bị sửa/xoá và không so sánh điểm
 *               trực tiếp với v2 được. Lộ trình 30 ngày / trí nhớ khách hàng vẫn đọc văn bản `audit_result` của chúng như trước.
 */
export type StoredAuditKind = 'v2' | 'legacy'

export function isAuditReportShape(v: unknown): boolean {
  return !!v && typeof v === 'object' && Array.isArray((v as { checks?: unknown }).checks)
}

export function storedAuditKind(row: { checks_json?: unknown } | null | undefined): StoredAuditKind | null {
  if (!row) return null
  return isAuditReportShape(row.checks_json) ? 'v2' : 'legacy'
}

export function formatAuditDate(createdAt?: string | null): string {
  if (!createdAt) return ''
  const d = new Date(createdAt)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })
}

export function legacyAuditNotice(createdAt?: string | null): string {
  const when = formatAuditDate(createdAt)
  return (
    `Đây là kết quả kiểm tra kiểu cũ${when ? ` (ngày ${when})` : ''}: AI chấm tự do, thang 10, không có chi tiết từng mục. ` +
    'Chỉ để xem lại; không so sánh điểm trực tiếp với thang điểm mới. Bấm "Kiểm tra hồ sơ" để chạy bản mới.'
  )
}
