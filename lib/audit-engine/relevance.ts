import type { AIClassifier, AuditInput, CheckResult } from './types'

function insufficient(id: string, label: string, severity: CheckResult['severity']): CheckResult {
  return {
    id,
    group: 'relevance',
    label,
    severity,
    confidence: 'insufficient',
    passed: null,
    message: 'Chưa đủ dữ liệu để kết luận.',
  }
}

interface CategoryMatchResult {
  matches: boolean
  reason: string
}

/** R01 — Primary Category có phản ánh đúng hoạt động cốt lõi? */
async function checkR01(input: AuditInput, ai: AIClassifier): Promise<CheckResult> {
  const category = input.snapshot.primary_category
  if (!category || (!input.declaredIndustry && !input.snapshot.description)) {
    return insufficient('R01', 'Primary Category', 'high')
  }
  let result: CategoryMatchResult
  try {
    result = await ai.classify<CategoryMatchResult>({
      system:
        'Bạn là chuyên gia phân loại ngành nghề cho Google Maps Business Profile. ' +
        'Trả schema: {"matches": boolean, "reason": string}. matches=true nếu category chính phản ánh đúng hoạt động cốt lõi.',
      user: [
        `Category chính trên hồ sơ: "${category}"`,
        input.declaredIndustry ? `Ngành khách tự khai: "${input.declaredIndustry}"` : '',
        input.snapshot.description ? `Mô tả doanh nghiệp: "${input.snapshot.description}"` : '',
      ]
        .filter(Boolean)
        .join('\n'),
    })
  } catch (err) {
    return { ...insufficient('R01', 'Primary Category', 'high'), message: `Lỗi gọi AI: ${(err as Error).message}` }
  }
  return {
    id: 'R01',
    group: 'relevance',
    label: 'Primary Category',
    severity: 'high',
    confidence: 'estimated',
    passed: result.matches,
    message: result.reason,
    action: result.matches ? undefined : `Cân nhắc đổi category chính — "${category}" chưa phản ánh đúng hoạt động cốt lõi.`,
  }
}

/**
 * R02 — Secondary Categories: cần benchmark category phổ biến cùng ngành
 * (nguồn dữ liệu thật, không phải AI tự bịa danh sách ngành) — hệ thống
 * hiện chưa có nguồn này.
 */
function checkR02(): CheckResult {
  return insufficient('R02', 'Secondary Categories', 'medium')
}

/** R03 — Services: trường `services` KHÔNG có trong GbpSnapshotPayload hiện tại. */
function checkR03(): CheckResult {
  return insufficient('R03', 'Services', 'medium')
}

interface DescriptionAssessment {
  specificity: 'high' | 'medium' | 'low'
  relevance: 'high' | 'medium' | 'low'
  clarity: 'high' | 'medium' | 'low'
  differentiation: 'high' | 'medium' | 'low'
  keywordRelevance: 'high' | 'medium' | 'low'
  summary: string
}

/** R04 — Business Description: dùng snapshot.description thật. */
async function checkR04(input: AuditInput, ai: AIClassifier): Promise<CheckResult> {
  const desc = input.snapshot.description
  if (!desc || desc.trim().length === 0) {
    return {
      id: 'R04',
      group: 'relevance',
      label: 'Business Description',
      severity: 'medium',
      confidence: 'verified',
      passed: false,
      message: 'Hồ sơ chưa có mô tả doanh nghiệp.',
      action: 'Viết mô tả doanh nghiệp: cụ thể, đúng ngành, có điểm khác biệt — không cần "văn hay".',
    }
  }
  let result: DescriptionAssessment
  try {
    result = await ai.classify<DescriptionAssessment>({
      system:
        'Chấm mô tả doanh nghiệp trên Google Maps theo 5 tiêu chí: specificity, relevance, clarity, ' +
        "differentiation, keywordRelevance — mỗi tiêu chí chỉ 'high'|'medium'|'low'. Không chấm văn phong hay/dở. " +
        'Trả schema: {"specificity":"high|medium|low","relevance":"high|medium|low","clarity":"high|medium|low",' +
        '"differentiation":"high|medium|low","keywordRelevance":"high|medium|low","summary":"1 câu tiếng Việt"}',
      user: [`Mô tả doanh nghiệp: "${desc}"`, input.declaredIndustry ? `Ngành: ${input.declaredIndustry}` : ''].filter(Boolean).join('\n'),
    })
  } catch (err) {
    return { ...insufficient('R04', 'Business Description', 'medium'), message: `Lỗi gọi AI: ${(err as Error).message}` }
  }
  const lowCount = [result.specificity, result.relevance, result.clarity, result.differentiation, result.keywordRelevance].filter(
    (s) => s === 'low',
  ).length
  const passed = lowCount <= 1
  return {
    id: 'R04',
    group: 'relevance',
    label: 'Business Description',
    severity: 'medium',
    confidence: 'estimated',
    passed,
    message: result.summary,
    action: passed ? undefined : 'Viết lại mô tả: cụ thể hơn về dịch vụ chính, nhấn điểm khác biệt.',
  }
}

/** R05 — Attributes: trường `attributes` KHÔNG có trong GbpSnapshotPayload hiện tại. */
function checkR05(): CheckResult {
  return insufficient('R05', 'Attributes', 'low')
}

export async function runRelevanceChecks(input: AuditInput, ai: AIClassifier): Promise<CheckResult[]> {
  const [r01, r04] = await Promise.all([checkR01(input, ai), checkR04(input, ai)])
  return [r01, checkR02(), checkR03(), r04, checkR05()]
}
