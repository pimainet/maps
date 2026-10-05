import type { AIClassifier, AuditInput, CheckResult } from './types'

function insufficient(id: string, label: string, severity: CheckResult['severity']): CheckResult {
  return {
    id,
    group: 'trust',
    label,
    severity,
    confidence: 'insufficient',
    passed: null,
    message: 'Chưa đủ dữ liệu để kết luận.',
  }
}

function competitorAvg(input: AuditInput, key: 'reviewCount' | 'rating'): number | undefined {
  const list = input.competitors
  if (!list || list.length === 0) return undefined
  const values = list.map((c) => c[key]).filter((v): v is number => v !== undefined)
  if (values.length === 0) return undefined
  return values.reduce((s, v) => s + v, 0) / values.length
}

/** T01 — Review Volume, so với đối thủ — `competitors` chưa có collector thật, nên thường sẽ insufficient cho tới khi có. */
function checkT01(input: AuditInput): CheckResult {
  const self = input.snapshot.review_count
  const avg = competitorAvg(input, 'reviewCount')
  if (self == null || avg === undefined) {
    return insufficient('T01', 'Review Volume', 'high')
  }
  const ok = avg === 0 ? true : self / avg >= 0.7
  return {
    id: 'T01',
    group: 'trust',
    label: 'Review Volume',
    severity: 'high',
    confidence: 'verified',
    passed: ok,
    message: `${self} review, trung bình nhóm đối thủ ${avg.toFixed(0)}.`,
    action: ok ? undefined : 'Số review đang thấp hơn đáng kể so với đối thủ — xây quy trình xin review sau mỗi lượt khách.',
  }
}

/** T02 — Rating, trong bối cảnh cạnh tranh. */
function checkT02(input: AuditInput): CheckResult {
  const self = input.snapshot.rating
  const avg = competitorAvg(input, 'rating')
  if (self == null || avg === undefined) {
    return insufficient('T02', 'Rating', 'high')
  }
  const ok = self >= avg - 0.1
  return {
    id: 'T02',
    group: 'trust',
    label: 'Rating',
    severity: 'high',
    confidence: 'verified',
    passed: ok,
    message: `Rating ${self.toFixed(1)}, trung bình nhóm đối thủ ${avg.toFixed(1)}.`,
    action: ok ? undefined : 'Rating đang thấp hơn mặt bằng đối thủ.',
  }
}

/**
 * T03 — Review Recency: cần timestamp review gần nhất, snapshot hiện tại
 * KHÔNG thu thập trường này (chỉ có review_count tổng, không có review
 * riêng lẻ kèm ngày).
 */
function checkT03(): CheckResult {
  return insufficient('T03', 'Review Recency', 'high')
}

/** T04 — Review Velocity: dùng lịch sử thật từ bảng gbp_snapshots nếu caller truyền vào (cần ≥2 điểm). */
function checkT04(input: AuditInput): CheckResult {
  const history = input.reviewCountHistory
  if (!history || history.length < 2) {
    return insufficient('T04', 'Review Velocity', 'medium')
  }
  const sorted = [...history].sort((a, b) => new Date(a.capturedAt).getTime() - new Date(b.capturedAt).getTime())
  const first = sorted[0]
  const last = sorted[sorted.length - 1]
  const growing = last.reviewCount >= first.reviewCount
  return {
    id: 'T04',
    group: 'trust',
    label: 'Review Velocity',
    severity: 'medium',
    confidence: 'verified',
    passed: growing,
    message: growing
      ? `Số review tăng từ ${first.reviewCount} lên ${last.reviewCount}.`
      : `Số review giảm từ ${first.reviewCount} xuống ${last.reviewCount} — bất thường, cần kiểm tra.`,
    action: growing ? undefined : 'Kiểm tra vì sao số review giảm — có thể do review bị gỡ hoặc hồ sơ gặp vấn đề (xem F02).',
  }
}

/**
 * T05 — Review Response: cần nội dung PHẢN HỒI của chủ doanh nghiệp.
 * Places API (New) — nguồn chính thức duy nhất đang dùng — KHÔNG trả
 * trường này (xem ghi chú trong gbp-snapshot-types.ts). Muốn làm thật cần
 * Google Business Profile API (OAuth + khách xác minh quyền sở hữu hồ sơ) —
 * ngoài phạm vi snapshot public hiện tại. Giữ insufficient, KHÔNG suy diễn.
 */
function checkT05(): CheckResult {
  return {
    ...insufficient('T05', 'Review Response', 'high'),
    message:
      'Cần nội dung phản hồi của chủ doanh nghiệp — Places API (nguồn hiện tại) không cung cấp trường này. ' +
      'Cần tích hợp Google Business Profile API (OAuth, khách phải xác minh quyền sở hữu hồ sơ) để làm thật.',
  }
}

interface ReviewInsight {
  liked: string[]
  complained: string[]
  mentionedServices: string[]
  recurringIssue: string | null
}

/**
 * T06 — Review Insight: AI đọc review tìm điểm thích/phàn nàn/USP — đây là
 * INSIGHT, không phải điểm số nhị phân. Cần tối thiểu 3 review mới rút ra
 * pattern có ý nghĩa (Places API chỉ trả tối đa ~5 review "liên quan nhất",
 * không phải toàn bộ — ngưỡng đặt thấp hơn bản gốc l.zip vì nguồn dữ liệu
 * eo hẹp hơn nhiều so với giả định ban đầu).
 */
async function checkT06(input: AuditInput, ai: AIClassifier): Promise<CheckResult> {
  const reviews = input.snapshot.reviews
  if (!reviews || reviews.length < 3) {
    return {
      ...insufficient('T06', 'Review Insight', 'medium'),
      message: `Chỉ có ${reviews?.length ?? 0} review (Places API giới hạn ~5 review/lượt) — chưa đủ để rút pattern đáng tin.`,
    }
  }

  let insight: ReviewInsight
  try {
    insight = await ai.classify<ReviewInsight>({
      system:
        'Đọc các review khách hàng trên Google Maps, tìm pattern lặp lại. ' +
        'Chỉ trả JSON thuần: {"liked": string[], "complained": string[], "mentionedServices": string[], "recurringIssue": string|null}. ' +
        'Mỗi mảng tối đa 3 mục, ngắn gọn tiếng Việt. recurringIssue=null nếu không có vấn đề lặp lại rõ ràng. ' +
        `CHỈ dựa trên nội dung ${reviews.length} review thật dưới đây, không suy diễn thêm. ` +
        'Lưu ý: đây chỉ là mẫu nhỏ (Places API giới hạn số review trả về, không phải toàn bộ review thật của doanh nghiệp) — không khái quát hoá quá mức.',
      user: reviews.map((r, i) => `Review ${i + 1} (${r.rating} sao): "${r.text}"`).join('\n'),
    })
  } catch (err) {
    return { ...insufficient('T06', 'Review Insight', 'medium'), message: `Lỗi gọi AI Engine: ${(err as Error).message}` }
  }

  const hasRecurringIssue = !!insight.recurringIssue
  const summary = [
    insight.liked.length ? `Khách khen: ${insight.liked.join(', ')}.` : '',
    insight.complained.length ? `Khách phàn nàn: ${insight.complained.join(', ')}.` : '',
    insight.recurringIssue ? `Vấn đề lặp lại: ${insight.recurringIssue}.` : '',
  ]
    .filter(Boolean)
    .join(' ')

  return {
    id: 'T06',
    group: 'trust',
    label: 'Review Insight',
    severity: 'medium',
    confidence: 'estimated',
    passed: !hasRecurringIssue,
    message: (summary || 'Chưa rút ra được pattern rõ ràng từ review hiện có.') + ` (dựa trên mẫu ${reviews.length} review)`,
    action: hasRecurringIssue
      ? `Xử lý vấn đề lặp lại trước khi đẩy mạnh quảng bá: ${insight.recurringIssue}.`
      : undefined,
  }
}

export async function runTrustChecks(input: AuditInput, ai: AIClassifier): Promise<CheckResult[]> {
  const t06 = await checkT06(input, ai)
  return [checkT01(input), checkT02(input), checkT03(), checkT04(input), checkT05(), t06]
}
