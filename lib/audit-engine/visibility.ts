import type { AuditInput, CheckResult } from './types'

/**
 * VY01–VY04 — Visibility.
 *
 * Nguồn dữ liệu: kết quả tìm kiếm "<danh mục> <khu vực>" qua Outscraper (xem lib/competitors.ts). Đây vẫn là dữ liệu
 * thu thập từ kết quả Google Maps bởi bên thứ ba, KHÔNG phải API chính thức của Google, và KHÔNG cá nhân hoá theo vị trí
 * người tìm -> mọi kết luận ở đây là 'estimated', không bao giờ 'verified'.
 *
 *  - VY01 Keyword Visibility: thứ hạng của hồ sơ khi tìm đúng truy vấn đó.
 *  - VY03 Competitor Benchmark: so review / sao / ảnh với TRUNG VỊ nhóm đối thủ (trung vị, không phải trung bình,
 *    để chuỗi lớn vài nghìn review không kéo lệch).
 *  - VY02 Keyword Coverage và VY04 Geographic Visibility dùng LƯỚI THỨ HẠNG (lib/rankgrid, input.rankGrid) khi tính năng
 *    bật và có lần quét ≤ 14 ngày; không có thì vẫn trả insufficient. Vẫn là 'estimated' (dữ liệu bên thứ ba, không cá nhân hoá).
 */
import { VY02_MIN_KEYWORDS, VY02_SOLV_PASS, VY04_SOLV_PASS } from '@/lib/rankgrid/insights'

const MIN_COMPETITORS = 3

function insufficient(id: string, label: string, message?: string): CheckResult {
  return {
    id,
    group: 'visibility',
    label,
    severity: 'high',
    confidence: 'insufficient',
    passed: null,
    message: message || 'Chưa có dữ liệu xếp hạng — cần danh mục chính và khu vực để tìm đối thủ.',
  }
}

function checkVY01(input: AuditInput): CheckResult {
  const v = input.visibility
  if (!v) return insufficient('VY01', 'Keyword Visibility')
  if (v.selfRank == null) {
    return {
      id: 'VY01',
      group: 'visibility',
      label: 'Keyword Visibility',
      severity: 'high',
      confidence: 'estimated',
      passed: false,
      message: `Khi tìm "${v.query}", hồ sơ không nằm trong ${v.total} kết quả đầu.`,
      action:
        'Hồ sơ gần như vô hình với khách tìm theo từ khoá này: ưu tiên danh mục chính đúng ngành, mô tả có từ khoá + khu vực, và tăng số review thật.',
    }
  }
  const ok = v.selfRank <= 3
  return {
    id: 'VY01',
    group: 'visibility',
    label: 'Keyword Visibility',
    severity: 'high',
    confidence: 'estimated',
    passed: ok,
    message: `Khi tìm "${v.query}", hồ sơ đứng khoảng #${v.selfRank}/${v.total} (ước lượng, không cá nhân hoá theo vị trí).`,
    action: ok
      ? undefined
      : `Đang ngoài top 3 ở từ khoá chính. So với nhóm dẫn đầu, tập trung vào review mới đều đặn, ảnh thật và bài đăng định kỳ.`,
  }
}

function checkVY03(input: AuditInput): CheckResult {
  const comps = input.competitors ?? []
  const s = input.snapshot
  if (comps.length < MIN_COMPETITORS || s.review_count == null) {
    return insufficient('VY03', 'Competitor Benchmark', 'Chưa đủ đối thủ cùng ngành, cùng khu vực để so sánh (cần ít nhất 3).')
  }
  const nums = (key: 'reviewCount' | 'rating' | 'photoCountEst') =>
    comps.map((c) => c[key]).filter((x): x is number => typeof x === 'number')
  const medReviews = medianOf(nums('reviewCount'))
  const medRating = medianOf(nums('rating'))
  const medPhotos = medianOf(nums('photoCountEst'))

  const gaps: string[] = []
  const actions: string[] = []

  if (medReviews !== undefined && medReviews > 0 && s.review_count < medReviews * 0.5) {
    const need = Math.ceil(medReviews * 0.5 - s.review_count)
    gaps.push(`review ${s.review_count} (trung vị đối thủ ${Math.round(medReviews)})`)
    actions.push(`cần thêm khoảng ${need} review để đạt nửa mức trung vị`)
  }
  if (medRating !== undefined && s.rating != null && s.rating < medRating - 0.2) {
    gaps.push(`sao ${s.rating.toFixed(1)} (trung vị ${medRating.toFixed(1)})`)
    actions.push('xử lý review thấp sao và xin review từ khách hài lòng')
  }
  if (medPhotos !== undefined && medPhotos > 0 && s.photos_count_est != null && s.photos_count_est < medPhotos * 0.5) {
    gaps.push(`ảnh ${s.photos_count_est} (trung vị ${Math.round(medPhotos)})`)
    actions.push('bổ sung ảnh thật của cơ sở, sản phẩm, dịch vụ')
  }

  const passed = gaps.length === 0
  return {
    id: 'VY03',
    group: 'visibility',
    label: 'Competitor Benchmark',
    severity: 'high',
    confidence: 'estimated',
    passed,
    message: passed
      ? `Ngang hoặc hơn trung vị ${comps.length} đối thủ cùng ngành, cùng khu vực.`
      : `Thua trung vị ${comps.length} đối thủ ở: ${gaps.join('; ')}.`,
    action: passed ? undefined : `So với đối thủ: ${actions.join('; ')}.`,
  }
}

function medianOf(values: number[]): number | undefined {
  const v = [...values].sort((a, b) => a - b)
  if (!v.length) return undefined
  const mid = Math.floor(v.length / 2)
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2
}

const pctTxt = (n: number | null | undefined) => (n == null ? '—' : `${Math.round(n)}%`)

export function checkVY04(input?: AuditInput): CheckResult {
  const g = input?.rankGrid?.primary
  if (!g || g.solv == null) {
    return insufficient('VY04', 'Geographic Visibility', 'Cần xếp hạng theo lưới vị trí — chưa có lần quét lưới thứ hạng gần đây.')
  }
  const passed = g.solv >= VY04_SOLV_PASS && g.centerRank != null && g.centerRank <= 3
  const where = g.weakSector ? ` Yếu nhất ở ${g.weakSector.label} (top 3 ở ${pctTxt(g.weakSector.solv)} số điểm).` : ''
  const leader = g.leader ? ` Đối thủ dẫn đầu: ${g.leader.title} (top 3 ở ${pctTxt(g.leader.solv)} khu vực).` : ''
  return {
    id: 'VY04',
    group: 'visibility',
    label: 'Geographic Visibility',
    severity: 'high',
    confidence: 'estimated',
    passed,
    message: `Từ khoá "${g.keyword}": top 3 ở ${pctTxt(g.solv)} khu vực quanh quán (${g.points} điểm), hạng tại quán ${g.centerRank ?? 'ngoài top 20'}.${where}${leader}`,
    action: passed
      ? undefined
      : 'Mở rộng vùng hiển thị: danh mục phụ/dịch vụ đúng từ khoá, mô tả nhắc địa danh thật ở khu vực yếu, ảnh và bài đăng đều đặn, xin đánh giá thật nhắc dịch vụ.',
  }
}

export function checkVY02(input?: AuditInput): CheckResult {
  const kws = (input?.rankGrid?.keywords ?? []).filter((k) => k.solv != null)
  if (kws.length < VY02_MIN_KEYWORDS) {
    return insufficient(
      'VY02',
      'Keyword Coverage',
      `Cần xếp hạng nhiều từ khoá — cần ít nhất ${VY02_MIN_KEYWORDS} từ khoá đã quét lưới (hiện có ${kws.length}).`,
    )
  }
  const strong = kws.filter((k) => (k.solv ?? 0) >= VY02_SOLV_PASS)
  const need = Math.ceil((kws.length * 2) / 3)
  const passed = strong.length >= need
  const invisible = kws.filter((k) => (k.foundPct ?? 0) < 20).map((k) => `"${k.keyword}"`)
  return {
    id: 'VY02',
    group: 'visibility',
    label: 'Keyword Coverage',
    severity: 'high',
    confidence: 'estimated',
    passed,
    message: `${strong.length}/${kws.length} từ khoá có top 3 ở ≥ ${VY02_SOLV_PASS}% khu vực.${invisible.length ? ` Gần như vô hình: ${invisible.join(', ')}.` : ''}`,
    action: passed
      ? undefined
      : 'Với từ khoá yếu: thêm danh mục phụ/dịch vụ tương ứng, viết mô tả và bài đăng về đúng dịch vụ đó, xin đánh giá nhắc tên dịch vụ. Không nhồi từ khoá vào tên.',
  }
}

export function runVisibilityChecks(input?: AuditInput): CheckResult[] {
  return [
    input ? checkVY01(input) : insufficient('VY01', 'Keyword Visibility'),
    checkVY02(input),
    input ? checkVY03(input) : insufficient('VY03', 'Competitor Benchmark'),
    checkVY04(input),
  ]
}
