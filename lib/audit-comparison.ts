import { diffAuditReports, type AuditReport } from '@/lib/audit-engine'
import { isAuditReportShape } from '@/lib/audit-legacy'

export type PreviousAuditRow = {
  id?: string
  created_at?: string
  checks_json?: unknown
  raw_input?: { place_key?: string } | null
} | null

/**
 * So audit vừa chấm với lần trước (THUẦN, test được).
 *  - lần trước đã đổi sang doanh nghiệp/link Maps khác => không so sánh;
 *  - lần trước là audit kiểu cũ (không có checks_json) => không so sánh trực tiếp, báo rõ lý do;
 *  - còn lại => diff theo từng mục (chỉ trên các mục cùng đủ dữ liệu ở cả hai lần).
 */
export function buildAuditComparison(args: {
  previous: PreviousAuditRow
  hasLegacyOnly: boolean
  placeKey: string
  report: AuditReport
}): Record<string, unknown> | null {
  const { previous, hasLegacyOnly, placeKey, report } = args
  const prevHasReport = !!previous && isAuditReportShape(previous.checks_json)
  const prevKey = previous?.raw_input?.place_key
  if (prevHasReport && prevKey && prevKey !== placeKey) {
    return {
      comparable: false,
      reason: 'Hồ sơ đã đổi sang doanh nghiệp/link Google Maps khác kể từ lần kiểm tra trước nên không so sánh điểm được.',
    }
  }
  if (prevHasReport && previous) {
    return {
      ...diffAuditReports(previous.checks_json as AuditReport, report),
      previous_audit_id: previous.id,
      previous_date: previous.created_at,
    }
  }
  if (hasLegacyOnly) {
    return {
      comparable: false,
      reason: 'Lần kiểm tra trước dùng thang điểm cũ nên không so sánh trực tiếp được. Từ lần này trở đi sẽ so sánh với nhau.',
    }
  }
  return null
}
