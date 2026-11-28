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

/** Trung vị (không dùng trung bình: 1 chuỗi lớn vài nghìn review sẽ kéo lệch cả nhóm). Tên hàm giữ nguyên để khỏi sửa chỗ gọi. */
function competitorAvg(input: AuditInput, key: 'reviewCount' | 'rating'): number | undefined {
  const list = input.competitors
  if (!list || list.length === 0) return undefined
  const values = list.map((c) => c[key]).filter((v): v is number => v !== undefined).sort((a, b) => a - b)
  if (values.length === 0) return undefined
  const mid = Math.floor(values.length / 2)
  return values.length % 2 ? values[mid] : (values[mid - 1] + values[mid]) / 2
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
    confidence: 'estimated',
    passed: ok,
    message: `${self} review, trung vị nhóm đối thủ ${avg.toFixed(0)}.`,
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
    confidence: 'estimated',
    passed: ok,
    message: `Rating ${self.toFixed(1)}, trung vị nhóm đối thủ ${avg.toFixed(1)}.`,
    action: ok ? undefined : 'Rating đang thấp hơn mặt bằng đối thủ.',
  }
}

/**
 * T03 — Review Recency: dựa trên review_stats tính từ danh sách review đã tải
 * (tuổi review mới nhất). Không có review_stats (vd chỉ có Places) -> insufficient.
 */
export const T03_MAX_NEWEST_AGE_DAYS = 21
function checkT03(input: AuditInput): CheckResult {
  const st = input.snapshot.review_stats
  if (!st || st.newest_age_days == null) return insufficient('T03', 'Review Recency', 'high')
  // ~3 tuần: Sterling Sky ghi nhận thứ hạng tụt khi quá ~18 ngày không có review mới; 21 ngày để chừa sai số nguồn dữ liệu.
  const ok = st.newest_age_days <= T03_MAX_NEWEST_AGE_DAYS
  return {
    id: 'T03',
    group: 'trust',
    label: 'Review Recency',
    severity: 'high',
    confidence: 'estimated',
    passed: ok,
    message: `Review mới nhất cách đây khoảng ${st.newest_age_days} ngày${
      st.last_90d != null ? `; ${st.window_complete ? '' : 'ít nhất '}${st.last_90d} review trong 90 ngày gần đây` : ''
    }.`,
    action: ok ? undefined : `Đã hơn ${T03_MAX_NEWEST_AGE_DAYS} ngày chưa có review mới — đặt quy trình xin review đều đặn sau mỗi lượt phục vụ (mục tiêu: có review mới ít nhất mỗi 2–3 tuần).`,
  }
}

/**
 * T07 — Tốc độ review mới so với 3 đối thủ đứng đầu: số review trong 90 ngày của hồ sơ so với trung vị của đối thủ (cùng giới
 * hạn đếm tối đa `limit` review/quán cho cả hai bên để so công bằng). Đạt khi ≥ 50% trung vị. Cần ≥ 2 đối thủ có số liệu và
 * số review 90 ngày của hồ sơ phải đếm được (tải đủ cửa sổ 90 ngày hoặc đã chạm giới hạn).
 */
export const T07_MIN_RATIO = 0.5
function checkT07(input: AuditInput): CheckResult {
  const base = insufficient('T07', 'Review velocity vs competitors', 'high')
  const v = input.competitorVelocity
  const st = input.snapshot.review_stats
  const comps = (v?.items ?? []).filter((x) => Number.isFinite(x.last90))
  if (!v || comps.length < 2) return { ...base, message: 'Chưa có số review gần đây của ít nhất 2 đối thủ đứng đầu để so.' }
  if (!st || st.last_90d == null) return { ...base, message: 'Chưa đếm được số review gần đây của hồ sơ.' }
  const limit = v.limit
  const ownCapped = Math.min(st.last_90d, limit)
  // Chưa tải đủ 90 ngày và cũng chưa chạm giới hạn đếm => số của hồ sơ chưa chắc chắn.
  if (!st.window_complete && st.last_90d < limit) return { ...base, message: 'Danh sách review đã tải chưa phủ đủ 90 ngày để đếm chính xác.' }
  const sorted = comps.map((c) => Math.min(c.last90, limit)).sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
  const passed = median === 0 || ownCapped >= median * T07_MIN_RATIO
  const plus = (n: number, capped: boolean) => (capped ? `≥${n}` : String(n))
  const compText = comps.map((c) => `${c.name}: ${plus(Math.min(c.last90, limit), c.capped || c.last90 >= limit)}`).join('; ')
  const newestComp = comps.map((c) => c.newestAgeDays).filter((x): x is number => x != null)
  const perMonth = Math.max(1, Math.ceil((median * T07_MIN_RATIO) / 3))
  return {
    id: 'T07',
    group: 'trust',
    label: 'Review velocity vs competitors',
    severity: 'high',
    confidence: 'estimated',
    passed,
    message:
      `90 ngày gần đây: hồ sơ có ${plus(ownCapped, st.last_90d >= limit)} review, trung vị ${comps.length} đối thủ đứng đầu ${median} (${compText})` +
      (st.last_30d != null ? `; 30 ngày: hồ sơ ${st.last_30d}, đối thủ ${comps.map((c) => c.last30).join('/')}` : '') +
      (newestComp.length ? `; review mới nhất của đối thủ cách đây ${Math.min(...newestComp)} ngày` : '') +
      '.',
    action: passed
      ? undefined
      : `Đối thủ đứng đầu nhận khoảng ${median} review mỗi 90 ngày — đặt mục tiêu ít nhất ${perMonth} review mới mỗi tháng bằng cách xin review sau mỗi lượt phục vụ (không mua, không đổi quà lấy review).`,
  }
}

/**
 * T04 — Review Velocity: dùng lịch sử thật từ bảng gbp_snapshots nếu caller truyền vào.
 * Cần ≥2 điểm cách nhau ≥ 7 ngày (2 lần lấy sát nhau không nói lên xu hướng). Số review dao động nhỏ do nguồn dữ liệu
 * (±3 hoặc ±3%) không bị coi là "giảm bất thường".
 */
const T04_MIN_SPAN_DAYS = 7
function checkT04(input: AuditInput): CheckResult {
  const history = input.reviewCountHistory
  if (!history || history.length < 2) {
    return insufficient('T04', 'Review Velocity', 'medium')
  }
  const sorted = [...history].sort((a, b) => new Date(a.capturedAt).getTime() - new Date(b.capturedAt).getTime())
  const first = sorted[0]
  const last = sorted[sorted.length - 1]
  const spanDays = (new Date(last.capturedAt).getTime() - new Date(first.capturedAt).getTime()) / 86_400_000
  if (!(spanDays >= T04_MIN_SPAN_DAYS)) {
    return {
      ...insufficient('T04', 'Review Velocity', 'medium'),
      message: 'Các lần đo số review còn quá sát nhau (cần cách ≥ 7 ngày) để kết luận xu hướng.',
    }
  }
  const drop = first.reviewCount - last.reviewCount
  const tolerance = Math.max(3, Math.round(first.reviewCount * 0.03))
  const shrinking = drop > tolerance
  const growing = last.reviewCount > first.reviewCount
  return {
    id: 'T04',
    group: 'trust',
    label: 'Review Velocity',
    severity: 'medium',
    confidence: 'verified',
    passed: !shrinking,
    message: shrinking
      ? `Số review giảm từ ${first.reviewCount} xuống ${last.reviewCount} — bất thường, cần kiểm tra.`
      : growing
        ? `Số review tăng từ ${first.reviewCount} lên ${last.reviewCount}.`
        : `Số review gần như không đổi (${first.reviewCount} → ${last.reviewCount}) trong ${Math.round(spanDays)} ngày.`,
    action: shrinking ? 'Kiểm tra vì sao số review giảm — có thể do review bị gỡ hoặc hồ sơ gặp vấn đề (xem F02).' : undefined,
  }
}

/**
 * T05 — Review Response: tỉ lệ review (trong số đã tải) có phản hồi của chủ.
 * Cần ≥5 review từ Outscraper; Places API không có phản hồi nên không dùng được cho check này.
 */
function checkT05(input: AuditInput): CheckResult {
  const st = input.snapshot.review_stats
  if (!st || st.loaded < 5 || st.reply_rate == null) {
    return {
      ...insufficient('T05', 'Review Response', 'high'),
      message: 'Chưa đọc đủ review (cần ≥5 review từ Outscraper) để tính tỉ lệ chủ phản hồi.',
    }
  }
  const ok = st.reply_rate >= 0.5
  return {
    id: 'T05',
    group: 'trust',
    label: 'Review Response',
    severity: 'high',
    confidence: 'estimated',
    passed: ok,
    message: `Chủ phản hồi ${st.replied}/${st.loaded} review gần nhất (${Math.round(st.reply_rate * 100)}%).`,
    action: ok
      ? undefined
      : 'Tỉ lệ phản hồi review còn thấp — trả lời mọi review, ưu tiên review thấp sao trước, giọng chuyên nghiệp.',
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
      message: `Chỉ có ${reviews?.length ?? 0} review (Places API chỉ trả ~5 review; chưa lấy được review từ Outscraper) — chưa đủ để rút pattern đáng tin.`,
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
  return [checkT01(input), checkT02(input), checkT03(input), checkT07(input), checkT04(input), checkT05(input), t06]
}
