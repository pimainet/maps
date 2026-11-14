import { ENGINE_VERSION, engineMajor } from './types'
import type { AuditReport, CheckResult } from './types'
import { isScored, scoreOnSubset } from './scoring'

export interface AuditDiffEntry {
  id: string
  label: string
}

export interface AuditDiff {
  /**
   * false = 2 lần audit dùng thang điểm khác nhau (engine khác major version) -> KHÔNG kết luận gì về
   * cải thiện/xấu đi; các trường dưới đây để rỗng/null.
   */
  comparable: boolean
  /** Lý do khi comparable = false. */
  reason?: string
  /**
   * Thay đổi điểm tổng tính TRÊN CÙNG TẬP CHECK có kết luận ở cả 2 lần (và đã loại các check nhiễu chưa xác nhận).
   * Khác `overallScoreDelta`, con số này không nhảy chỉ vì lần này thu thập được nhiều/ít dữ liệu hơn lần trước.
   * null nếu không đủ check chung để so.
   */
  comparableScoreDelta: number | null
  /** Số check chung được dùng để tính comparableScoreDelta. */
  comparableChecks: number
  /** Hiệu 2 điểm tổng thô (giữ để tương thích). Có thể lệch do độ phủ dữ liệu khác nhau — ưu tiên comparableScoreDelta. */
  overallScoreDelta: number | null
  /** Check từng không đạt, nay đạt. */
  improved: AuditDiffEntry[]
  /** Check từng đạt, nay không đạt (đã loại check nhiễu chưa xác nhận). */
  regressed: AuditDiffEntry[]
  /**
   * Check "nhiễu" (bài đăng, ảnh ước tính, phản hồi review...) chuyển đạt -> không đạt. Chưa kết luận là xấu đi:
   * có thể do lần lấy dữ liệu này thiếu. Hiển thị là "cần xem lại" và không tính vào điểm so sánh.
   */
  unconfirmed: AuditDiffEntry[]
  /** Check trước đó 'insufficient', nay đã có đủ dữ liệu để kết luận (không tính là cải thiện/xấu đi). */
  newlyVerified: AuditDiffEntry[]
  /** Có ít nhất 1 check đổi trạng thái đạt/không đạt thật sự. Chỉ khi true mới nên nhấn mạnh con số chênh lệch. */
  hasRealChange: boolean
}

const entry = (c: CheckResult): AuditDiffEntry => ({ id: c.id, label: c.label })

/**
 * So sánh 2 lần chạy Audit Engine — trả lời "có cải thiện không" bằng dữ liệu có cấu trúc.
 *
 * Nguyên tắc để kết quả đáng tin:
 *  1. Chỉ so các check CÓ Ở CẢ 2 LẦN, được tính điểm, và có kết luận (passed != null) ở cả 2 lần.
 *  2. Điểm chênh lệch tính lại trên đúng tập check chung đó (comparableScoreDelta).
 *  3. Check nhiễu chuyển đạt -> không đạt được tách ra `unconfirmed`, không kéo điểm xuống.
 *  4. Khác major version của engine thì không so (comparable = false).
 */
export function diffAuditReports(previous: AuditReport, latest: AuditReport): AuditDiff {
  const empty: AuditDiff = {
    comparable: true,
    comparableScoreDelta: null,
    comparableChecks: 0,
    overallScoreDelta: null,
    improved: [],
    regressed: [],
    unconfirmed: [],
    newlyVerified: [],
    hasRealChange: false,
  }

  // Báo cáo trước khi có đánh số phiên bản (v2 preview 2.0) coi như major 2.
  const prevMajor = engineMajor(previous.engineVersion) ?? '2'
  const lastMajor = engineMajor(latest.engineVersion) ?? engineMajor(ENGINE_VERSION)
  if (prevMajor !== lastMajor) {
    return {
      ...empty,
      comparable: false,
      reason: 'Lần kiểm tra trước dùng thang điểm khác, không so sánh trực tiếp được. Từ lần này trở đi sẽ so sánh với nhau.',
    }
  }

  const prevById = new Map(previous.checks.map((c) => [c.id, c]))
  const improved: AuditDiffEntry[] = []
  const regressed: AuditDiffEntry[] = []
  const unconfirmed: AuditDiffEntry[] = []
  const newlyVerified: AuditDiffEntry[] = []
  const prevSubset: CheckResult[] = []
  const lastSubset: CheckResult[] = []

  for (const c of latest.checks) {
    const prev = prevById.get(c.id)
    if (!prev) continue
    if (prev.confidence === 'insufficient' && c.confidence !== 'insufficient') newlyVerified.push(entry(c))
    if (!isScored(c) || !isScored(prev)) continue
    if (prev.passed === null || c.passed === null) continue

    const droppedOnNoisyCheck = prev.passed === true && c.passed === false && (c.volatile || prev.volatile)
    if (droppedOnNoisyCheck) {
      unconfirmed.push(entry(c))
      continue // loại khỏi tập so sánh điểm
    }
    if (prev.passed === false && c.passed === true) improved.push(entry(c))
    if (prev.passed === true && c.passed === false) regressed.push(entry(c))
    prevSubset.push(prev)
    lastSubset.push(c)
  }

  const prevScore = scoreOnSubset(prevSubset)
  const lastScore = scoreOnSubset(lastSubset)

  return {
    comparable: true,
    comparableScoreDelta: prevScore != null && lastScore != null ? lastScore - prevScore : null,
    comparableChecks: lastSubset.length,
    overallScoreDelta:
      latest.overallScore != null && previous.overallScore != null ? latest.overallScore - previous.overallScore : null,
    improved,
    regressed,
    unconfirmed,
    newlyVerified,
    hasRealChange: improved.length + regressed.length > 0,
  }
}
