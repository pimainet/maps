import { GROUP_LABEL_VI, checkLabelVi } from './labels'
import { isScored } from './scoring'
import type { Narrative } from './narrative'
import type { AuditReport, CheckGroup, CheckResult } from './types'

/**
 * Dựng văn bản audit theo ĐÚNG khung 7 mục của prompt cũ (### 1. … ### 7.), để các nơi đang đọc `audit_result` dạng
 * chữ — lộ trình 30 ngày (api/plan), trí nhớ khách hàng (client-memory), parseAuditResult — chạy không cần sửa.
 * Mọi con số trong văn bản này do code tính từ AuditReport; AI không tham gia.
 */
const GROUP_ORDER: CheckGroup[] = ['foundation', 'relevance', 'trust', 'visual', 'content', 'visibility', 'conversion']

const to10 = (score100: number) => (Math.round(score100) / 10).toFixed(1)

function priorityOf(c: CheckResult): 'high' | 'medium' | 'low' {
  return c.severity === 'critical' || c.severity === 'high' ? 'high' : c.severity === 'medium' ? 'medium' : 'low'
}

export function renderAuditText(report: AuditReport, narrative: Narrative): string {
  const lines: string[] = []

  lines.push('### 1. Điểm tổng quan (thang 10)')
  lines.push(`- Điểm: ${report.overallScore == null ? 'Chưa đủ dữ liệu để chấm' : to10(report.overallScore)}`)
  lines.push(`- Giải thích ngắn gọn: ${narrative.summary}`)
  if (report.coverage) {
    lines.push(
      `- Phạm vi: đã kiểm tra ${report.coverage.scored} mục, ${report.coverage.insufficient} mục chưa đủ dữ liệu` +
        (report.engineVersion ? ` (thang điểm ${report.engineVersion})` : ''),
    )
  }
  lines.push('')

  lines.push('### 2. Điểm theo từng nhóm (thang 10)')
  for (const g of GROUP_ORDER) {
    const t = report.tierScores.find((x) => x.group === g)
    lines.push(`- ${GROUP_LABEL_VI[g]}: ${t?.score == null ? 'Chưa đủ dữ liệu' : to10(t.score)}`)
  }
  lines.push('')

  const failing = report.checks.filter((c) => isScored(c) && c.passed === false)
  const passing = report.checks
    .filter((c) => isScored(c) && c.passed === true)
    .sort((a, b) => ['critical', 'high', 'medium', 'low'].indexOf(a.severity) - ['critical', 'high', 'medium', 'low'].indexOf(b.severity))

  lines.push('### 3. Điểm mạnh')
  const strengths = narrative.strengths.length ? narrative.strengths : passing.slice(0, 4).map((c) => `${checkLabelVi(c.id, c.label)}: đã ổn.`)
  if (strengths.length === 0) lines.push('- Chưa có mục nào đủ dữ liệu để khẳng định là điểm mạnh.')
  for (const s of strengths) lines.push(`- ${s}`)
  lines.push('')

  lines.push('### 4. Điểm yếu theo mức ưu tiên')
  const textFor = (c: CheckResult) =>
    narrative.opportunities[c.id] || `${checkLabelVi(c.id, c.label)}: ${c.message}`
  for (const [key, title] of [['high', 'Ưu tiên Cao'], ['medium', 'Ưu tiên Trung bình'], ['low', 'Ưu tiên Thấp']] as const) {
    lines.push(`- ${title}:`)
    const items = failing.filter((c) => priorityOf(c) === key)
    if (items.length === 0) lines.push('  - Không có mục nào.')
    for (const c of items) lines.push(`  - ${textFor(c)}`)
  }
  lines.push('')

  lines.push('### 5. Việc cần làm ngay (7–14 ngày tới)')
  const actions = report.topOpportunities.slice(0, 5)
  if (actions.length === 0) lines.push('- Chưa có việc cấp bách; duy trì và theo dõi.')
  for (const o of actions) lines.push(`- ${narrative.opportunities[o.checkId] || o.action}`)
  lines.push('')

  lines.push('### 6. Định hướng 30 ngày tiếp theo')
  lines.push(narrative.focus30 || (actions.length ? `Tập trung xử lý: ${actions.slice(0, 3).map((o) => checkLabelVi(o.checkId, o.label)).join('; ')}.` : 'Duy trì hồ sơ và bổ sung nội dung mới đều đặn.'))
  lines.push('')

  lines.push('### 7. Nhận định nhanh về độ khó')
  lines.push(narrative.competitionNote || 'Chưa đủ dữ liệu đối thủ để đánh giá mức cạnh tranh.')

  const unknown = report.checks.filter((c) => isScored(c) && c.passed === null)
  if (unknown.length > 0) {
    lines.push('')
    lines.push('### 8. Mục chưa đủ dữ liệu (không kết luận là thiếu)')
    for (const c of unknown) lines.push(`- ${checkLabelVi(c.id, c.label)}`)
  }
  return lines.join('\n')
}
