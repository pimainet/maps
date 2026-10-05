import type { AIClassifier, AuditInput, CheckResult } from './types'

function insufficient(id: string, label: string, severity: CheckResult['severity']): CheckResult {
  return {
    id,
    group: 'content',
    label,
    severity,
    confidence: 'insufficient',
    passed: null,
    message: 'Chưa đủ dữ liệu để kết luận.',
  }
}

/**
 * approx_date do Claude trích xuất là tiếng Việt tự do (vd "2 tuần trước",
 * "hôm qua") — KHÔNG phải ISO date chuẩn. Parse best-effort; không parse
 * được thì trả null (không suy đoán ngày chính xác từ text mơ hồ).
 */
export function parseApproxDateToDays(text: string | null | undefined): number | null {
  if (!text) return null
  const t = text.trim().toLowerCase()
  if (/hôm nay/.test(t)) return 0
  if (/hôm qua/.test(t)) return 1
  const m = t.match(/(\d+)\s*(ngày|tuần|tháng|năm)/)
  if (!m) return null
  const n = parseInt(m[1], 10)
  if (!Number.isFinite(n)) return null
  const unit = m[2]
  if (unit === 'ngày') return n
  if (unit === 'tuần') return n * 7
  if (unit === 'tháng') return n * 30
  if (unit === 'năm') return n * 365
  return null
}

/** C01 — Post Activity: có bài đăng quan sát được không. */
function checkC01(input: AuditInput): CheckResult {
  const posts = input.snapshot.recent_posts
  if (posts === undefined) {
    return insufficient('C01', 'Post Activity', 'medium')
  }
  const hasPosts = posts.length > 0
  return {
    id: 'C01',
    group: 'content',
    label: 'Post Activity',
    severity: 'medium',
    // recent_posts chỉ lấy tối đa 5 bài mẫu, không phải tổng số thật -> estimated.
    confidence: 'estimated',
    passed: hasPosts,
    message: hasPosts
      ? `Quan sát được ${posts.length} bài đăng gần đây.`
      : (input.snapshot.posts_signal ?? 'Không thấy bài đăng nào trong lần quan sát này.'),
    action: hasPosts ? undefined : 'Google Posts là kênh miễn phí đang bị bỏ trống — bắt đầu đăng tối thiểu 1 bài/tuần.',
  }
}

/** C02 — Post Recency: dựa trên approx_date của bài mới nhất parse được. */
function checkC02(input: AuditInput): CheckResult {
  const posts = input.snapshot.recent_posts ?? []
  if (posts.length === 0) {
    return insufficient('C02', 'Post Recency', 'medium')
  }
  const ages = posts.map((p) => parseApproxDateToDays(p.approx_date)).filter((d): d is number => d !== null)
  if (ages.length === 0) {
    return insufficient('C02', 'Post Recency', 'medium')
  }
  const minAge = Math.min(...ages)
  const fresh = minAge <= 30
  return {
    id: 'C02',
    group: 'content',
    label: 'Post Recency',
    severity: 'medium',
    confidence: 'estimated',
    passed: fresh,
    message: fresh
      ? `Bài gần nhất khoảng ${minAge} ngày trước.`
      : `Bài gần nhất khoảng ${minAge} ngày trước — khá lâu, nên cập nhật.`,
    action: fresh ? undefined : 'Duy trì tối thiểu 1 bài/tuần để hồ sơ trông đang hoạt động.',
  }
}

interface DiversityAssessment {
  repetitive: boolean
  reason: string
}

/** C03 — Content Diversity: cần ≥3 bài có text mới đánh giá được. */
async function checkC03(input: AuditInput, ai: AIClassifier): Promise<CheckResult> {
  const posts = (input.snapshot.recent_posts ?? []).filter((p) => p.text)
  if (posts.length < 3) {
    return insufficient('C03', 'Content Diversity', 'low')
  }
  let result: DiversityAssessment
  try {
    result = await ai.classify<DiversityAssessment>({
      system:
        'Xem các bài đăng (Google Posts) của một doanh nghiệp. Xác định có đang lặp lại cùng một khuôn mẫu ' +
        '(vd chỉ toàn "hãy đến với chúng tôi") hay có đa dạng chủ đề. Trả schema: {"repetitive": boolean, "reason": string}.',
      user: posts.map((p, i) => `Bài ${i + 1}: "${p.text}"`).join('\n'),
    })
  } catch (err) {
    return { ...insufficient('C03', 'Content Diversity', 'low'), message: `Lỗi gọi AI: ${(err as Error).message}` }
  }
  return {
    id: 'C03',
    group: 'content',
    label: 'Content Diversity',
    severity: 'low',
    confidence: 'estimated',
    passed: !result.repetitive,
    message: result.reason,
    action: result.repetitive
      ? 'Đa dạng hoá nội dung bài đăng: ưu đãi, dịch vụ mới, khoảnh khắc thật tại cửa hàng.'
      : undefined,
  }
}

interface QualityAssessment {
  relevance: 'high' | 'medium' | 'low'
  usefulness: 'high' | 'medium' | 'low'
  specificity: 'high' | 'medium' | 'low'
  hasDuplication: boolean
  hasCTA: boolean
  summary: string
}

/** C04 — Content Quality. */
async function checkC04(input: AuditInput, ai: AIClassifier): Promise<CheckResult> {
  const posts = (input.snapshot.recent_posts ?? []).filter((p) => p.text)
  if (posts.length === 0) {
    return insufficient('C04', 'Content Quality', 'low')
  }
  let result: QualityAssessment
  try {
    result = await ai.classify<QualityAssessment>({
      system:
        'Chấm chất lượng các bài đăng (Google Posts) theo relevance, usefulness, specificity ' +
        "(mỗi tiêu chí 'high'|'medium'|'low'), hasDuplication, hasCTA. Trả schema: " +
        '{"relevance":"high|medium|low","usefulness":"high|medium|low","specificity":"high|medium|low",' +
        '"hasDuplication":boolean,"hasCTA":boolean,"summary":"1 câu tiếng Việt"}',
      user: posts.map((p, i) => `Bài ${i + 1}: "${p.text}"`).join('\n'),
    })
  } catch (err) {
    return { ...insufficient('C04', 'Content Quality', 'low'), message: `Lỗi gọi AI: ${(err as Error).message}` }
  }
  const lowCount = [result.relevance, result.usefulness, result.specificity].filter((s) => s === 'low').length
  const passed = lowCount === 0 && !result.hasDuplication && result.hasCTA
  const issues: string[] = []
  if (lowCount > 0) issues.push('nội dung còn chung chung')
  if (result.hasDuplication) issues.push('có bài trùng lặp')
  if (!result.hasCTA) issues.push('thiếu lời kêu gọi hành động (CTA)')
  return {
    id: 'C04',
    group: 'content',
    label: 'Content Quality',
    severity: 'low',
    confidence: 'estimated',
    passed,
    message: result.summary,
    action: passed ? undefined : `Cải thiện: ${issues.join(', ')}.`,
  }
}

export function runContentBasicChecks(input: AuditInput): CheckResult[] {
  return [checkC01(input), checkC02(input)]
}

export async function runContentAdvancedChecks(input: AuditInput, ai: AIClassifier): Promise<CheckResult[]> {
  const [c03, c04] = await Promise.all([checkC03(input, ai), checkC04(input, ai)])
  return [c03, c04]
}
