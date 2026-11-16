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

/** Chuẩn hoá tên danh mục để so khớp (bỏ dấu, hoa/thường, ký tự lạ). */
function normCategory(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const R02_MIN_COMPETITORS = 3

/**
 * R02 — Secondary Categories: so danh mục phụ của hồ sơ với danh mục phụ mà các quán đứng top cùng truy vấn
 * (danh mục chính + khu vực) đang dùng. Chỉ nêu danh mục xuất hiện ở ≥ 40% (tối thiểu 2) quán top — dữ liệu thật,
 * AI không tự bịa danh sách. Không có dữ liệu danh mục phụ của chính hồ sơ => "chưa kết luận", không phải "thiếu".
 */
function checkR02(input: AuditInput): CheckResult {
  const s = input.snapshot
  const base = insufficient('R02', 'Secondary Categories', 'medium')
  if (s.coverage?.sections && s.coverage.sections.categories && s.coverage.sections.categories !== 'ok') {
    return { ...base, message: 'Chưa đọc được danh mục phụ của hồ sơ lần này — không kết luận là thiếu.' }
  }
  const own = (s.additional_categories || '').split(',').map((x) => x.trim()).filter(Boolean)
  const comps = (input.competitors ?? []).filter((c) => Array.isArray(c.subcategories) && c.subcategories.length > 0)
  if (comps.length < R02_MIN_COMPETITORS) {
    return { ...base, message: 'Chưa đủ dữ liệu danh mục của các quán top cùng truy vấn để so sánh (cần ít nhất 3).' }
  }
  const ownKeys = new Set([...own, s.primary_category || ''].filter(Boolean).map(normCategory))
  const counts = new Map<string, { label: string; n: number }>()
  for (const c of comps) {
    for (const sub of new Set(c.subcategories!.map((x) => x.trim()).filter(Boolean))) {
      const k = normCategory(sub)
      if (!k || ownKeys.has(k)) continue
      const cur = counts.get(k)
      if (cur) cur.n++
      else counts.set(k, { label: sub, n: 1 })
    }
  }
  const need = Math.max(2, Math.ceil(comps.length * 0.4))
  const gaps = [...counts.values()]
    .filter((g) => g.n >= need)
    .sort((a, b) => b.n - a.n || a.label.localeCompare(b.label))
    .slice(0, 5)
  const passed = own.length > 0 && gaps.length === 0
  const gapText = gaps.map((g) => `${g.label} (${g.n}/${comps.length} quán top)`).join('; ')
  return {
    id: 'R02',
    group: 'relevance',
    label: 'Secondary Categories',
    severity: 'medium',
    confidence: 'estimated',
    passed,
    message: passed
      ? `Hồ sơ có ${own.length} danh mục phụ (${own.slice(0, 4).join(', ')}), không thấy danh mục phụ phổ biến nào còn thiếu so với ${comps.length} quán top.`
      : own.length === 0
        ? `Hồ sơ chưa có danh mục phụ.${gaps.length ? ` Các quán top thường dùng: ${gapText}.` : ''}`
        : `Hồ sơ có ${own.length} danh mục phụ nhưng các quán top còn dùng thêm: ${gapText}.`,
    action: passed
      ? undefined
      : `Cân nhắc thêm danh mục phụ${gaps.length ? ` (${gaps.map((g) => g.label).join(', ')})` : ''} — chỉ thêm khi đúng với dịch vụ doanh nghiệp thực sự cung cấp.`,
  }
}

/** R03 — Services: trường `services` KHÔNG có trong GbpSnapshotPayload hiện tại. */
function checkR03(input: AuditInput): CheckResult {
  const services = input.snapshot.services
  if (!services || services.length === 0) {
    // Nhiều ngành không hiển thị dịch vụ công khai -> rỗng KHÔNG đồng nghĩa với thiếu
    return insufficient('R03', 'Services', 'medium')
  }
  const ok = services.length >= 3
  return {
    id: 'R03',
    group: 'relevance',
    label: 'Services',
    severity: 'medium',
    confidence: 'estimated',
    passed: ok,
    message: `Hồ sơ liệt kê ${services.length} dịch vụ/sản phẩm: ${services.slice(0, 6).join(', ')}${services.length > 6 ? '…' : ''}.`,
    action: ok ? undefined : 'Mới liệt kê rất ít dịch vụ — thêm đủ các dịch vụ chính, kèm mô tả ngắn, theo cách khách hay tìm.',
  }
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
    // Nguồn công khai (Outscraper/Places) không phải lúc nào cũng trả mô tả do chủ viết: rỗng = CHƯA ĐỌC ĐƯỢC,
    // không phải "hồ sơ chưa có mô tả". Chỉ kết luận được khi đọc trực tiếp từ tài khoản chủ hồ sơ.
    return {
      ...insufficient('R04', 'Business Description', 'medium'),
      message:
        'Chưa đọc được mô tả doanh nghiệp từ dữ liệu công khai — không kết luận là chưa có. Kết nối tài khoản Google Business của chủ hồ sơ để kiểm tra chính xác.',
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
function checkR05(input: AuditInput): CheckResult {
  const groups = input.snapshot.attributes
  const total = (groups || []).reduce((n, g) => n + g.items.length, 0)
  if (!groups || total === 0) return insufficient('R05', 'Attributes', 'low')
  const ok = total >= 3
  return {
    id: 'R05',
    group: 'relevance',
    label: 'Attributes',
    severity: 'low',
    confidence: 'estimated',
    passed: ok,
    message: `Hồ sơ có ${total} thuộc tính/tiện ích (${groups.map((g) => g.group).slice(0, 4).join(', ')}).`,
    action: ok ? undefined : 'Bổ sung thêm thuộc tính phù hợp (thanh toán, tiện ích, đối tượng phục vụ…).',
  }
}

export async function runRelevanceChecks(input: AuditInput, ai: AIClassifier): Promise<CheckResult[]> {
  const [r01, r04] = await Promise.all([checkR01(input, ai), checkR04(input, ai)])
  return [r01, checkR02(input), checkR03(input), r04, checkR05(input)]
}
