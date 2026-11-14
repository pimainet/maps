import type { CheckResult } from './types'

/**
 * Check dựa trên dữ liệu thu thập không ổn định giữa các lần lấy (xem README-FINAL: posts và phản hồi chủ
 * "không ổn định"; số ảnh là ƯỚC TÍNH do AI đọc trang; ngày đăng bài là chữ tự do do AI trích).
 * Khai báo tập trung ở đây để mỗi check giữ nguyên logic, và để dễ chỉnh khi đo được nhiễu thật
 * (scripts/measure-audit-noise.ts).
 */
export const VOLATILE_CHECK_IDS: ReadonlySet<string> = new Set(['C01', 'C02', 'C03', 'C04', 'V01', 'T05', 'CV02'])  // CV02 suy ra từ V01

/** Check chỉ để tham khảo, không tính điểm: kết luận đến từ văn bản tự do của AI. */
export const INFORMATIONAL_CHECK_IDS: ReadonlySet<string> = new Set(['T06'])

export function applyStabilityFlags(checks: CheckResult[]): CheckResult[] {
  return checks.map((c) => ({
    ...c,
    ...(VOLATILE_CHECK_IDS.has(c.id) ? { volatile: true } : {}),
    ...(INFORMATIONAL_CHECK_IDS.has(c.id) ? { scored: false } : {}),
  }))
}
