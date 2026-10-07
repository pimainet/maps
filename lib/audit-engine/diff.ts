import type { AuditReport } from './types'

export interface AuditDiffEntry {
  id: string
  label: string
}

export interface AuditDiff {
  overallScoreDelta: number | null
  improved: AuditDiffEntry[]
  regressed: AuditDiffEntry[]
  /** Check trước đó 'insufficient', nay đã có đủ dữ liệu để kết luận (không tính là cải thiện/xấu đi). */
  newlyVerified: AuditDiffEntry[]
}

/**
 * So sánh 2 lần chạy Audit Engine — trả lời câu hỏi 4 của framework gốc
 * ("có cải thiện không") bằng dữ liệu có cấu trúc, không cần đọc lại text
 * bằng mắt. Chỉ so sánh những check CÓ Ở CẢ 2 LẦN — check mới xuất hiện
 * hoặc biến mất (do thay đổi phạm vi audit-engine qua các version) không
 * được tính, tránh kết luận sai.
 */
export function diffAuditReports(previous: AuditReport, latest: AuditReport): AuditDiff {
  const prevById = new Map(previous.checks.map((c) => [c.id, c]))

  const improved: AuditDiffEntry[] = []
  const regressed: AuditDiffEntry[] = []
  const newlyVerified: AuditDiffEntry[] = []

  for (const c of latest.checks) {
    const prev = prevById.get(c.id)
    if (!prev) continue
    if (prev.passed === false && c.passed === true) improved.push({ id: c.id, label: c.label })
    if (prev.passed === true && c.passed === false) regressed.push({ id: c.id, label: c.label })
    if (prev.confidence === 'insufficient' && c.confidence !== 'insufficient') {
      newlyVerified.push({ id: c.id, label: c.label })
    }
  }

  return {
    overallScoreDelta:
      latest.overallScore != null && previous.overallScore != null
        ? latest.overallScore - previous.overallScore
        : null,
    improved,
    regressed,
    newlyVerified,
  }
}
