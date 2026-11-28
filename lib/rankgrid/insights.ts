/**
 * Nối lưới thứ hạng vào audit (VY02/VY04) và kế hoạch 30 ngày. Phần thuần (có test).
 */
import type { RankGridAuditInput } from '@/lib/audit-engine/types'

export const VY04_SOLV_PASS = 40
export const VY02_SOLV_PASS = 30
export const VY02_MIN_KEYWORDS = 3

const pct = (n: number | null | undefined) => (n == null ? '—' : `${Math.round(n)}%`)

/** Văn bản đưa vào prompt kế hoạch 30 ngày (khối "tiến độ"), để AI sinh việc bám dữ liệu lưới. */
export function buildRankGridPlanContext(input: RankGridAuditInput | undefined): string {
  if (!input) return ''
  const p = input.primary
  const lines = [
    '### Lưới thứ hạng Google Maps (đo tại nhiều điểm quanh quán, ước lượng tại thời điểm quét)',
    `- Từ khoá chính "${p.keyword}": top 3 ở ${pct(p.solv)} khu vực, xuất hiện trong top 20 ở ${pct(p.foundPct)}; hạng tại quán: ${p.centerRank ?? 'ngoài top 20'}.`,
  ]
  if (p.weakSector) lines.push(`- Khu vực yếu nhất: ${p.weakSector.label} (top 3 ở ${pct(p.weakSector.solv)} số điểm).`)
  if (p.leader) lines.push(`- Đối thủ dẫn đầu: ${p.leader.title} (top 3 ở ${pct(p.leader.solv)} khu vực${p.leader.reviews != null ? `, ${p.leader.reviews} đánh giá` : ''}).`)
  const weakKw = input.keywords.filter((k) => (k.solv ?? 0) < VY02_SOLV_PASS).map((k) => `"${k.keyword}" (${pct(k.solv)})`)
  if (weakKw.length) lines.push(`- Từ khoá còn yếu: ${weakKw.join(', ')}.`)
  lines.push(
    '- Gợi ý ưu tiên: bổ sung danh mục phụ/dịch vụ đúng với từ khoá yếu, mô tả nhắc dịch vụ + địa danh thật ở khu vực yếu, bài đăng về dịch vụ đó, xin đánh giá thật nhắc tên dịch vụ. Không nhồi từ khoá vào tên doanh nghiệp (vi phạm chính sách Google).',
  )
  return lines.join('\n')
}
