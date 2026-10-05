import type { AuditInput, CheckResult } from './types'

function insufficient(id: string, label: string, severity: CheckResult['severity']): CheckResult {
  return {
    id,
    group: 'foundation',
    label,
    severity,
    confidence: 'insufficient',
    passed: null,
    message: 'Chưa đủ dữ liệu để kết luận — lần quan sát này chưa đọc được trường này.',
  }
}

/** F01 — Profile tồn tại: cùng tiêu chí `hasProfile` route demo-audit đang dùng. */
function checkF01(input: AuditInput): CheckResult {
  const s = input.snapshot
  const resolved = Boolean(s.business_name || s.rating != null || s.review_count != null || s.address_text || s.place_id)
  return {
    id: 'F01',
    group: 'foundation',
    label: 'Profile tồn tại',
    severity: 'critical',
    confidence: 'verified',
    passed: resolved,
    message: resolved
      ? 'Đọc được hồ sơ Google Maps từ lần quan sát này.'
      : 'Không đọc được hồ sơ Google Maps — kiểm tra lại link/tên + khu vực.',
    action: resolved ? undefined : 'Kiểm tra lại link Maps, hoặc tạo hồ sơ Google Business nếu thực sự chưa có.',
  }
}

/**
 * F02 — Trạng thái profile. Hệ thống hiện CHƯA thu thập observedFlags (dấu hiệu
 * hạn chế/bị từ chối nội dung...) — đúng nguyên tắc, trả insufficient thay vì suy diễn.
 */
function checkF02(): CheckResult {
  return insufficient('F02', 'Trạng thái profile', 'critical')
}

/** F03 — Tên doanh nghiệp: so khớp tên khách tự khai với tên thật đọc được trên Maps. */
function checkF03(input: AuditInput): CheckResult {
  const onProfile = input.snapshot.business_name?.trim()
  const claimed = input.claimedBusinessName?.trim()
  if (!onProfile || !claimed) {
    return insufficient('F03', 'Tên doanh nghiệp', 'high')
  }
  const a = onProfile.toLowerCase()
  const b = claimed.toLowerCase()
  const matches = a.includes(b) || b.includes(a)
  return {
    id: 'F03',
    group: 'foundation',
    label: 'Tên doanh nghiệp',
    severity: 'high',
    confidence: 'verified',
    passed: matches,
    message: matches
      ? 'Tên trên hồ sơ khớp với tên doanh nghiệp đã khai.'
      : `Tên trên hồ sơ ("${onProfile}") khác đáng kể với tên đã khai ("${claimed}").`,
    action: matches ? undefined : 'Kiểm tra lại tên trên hồ sơ — có thể bị chèn từ khoá hoặc sai lệch với tên pháp lý.',
  }
}

/** F04 — Địa chỉ / vị trí. */
function checkF04(input: AuditInput): CheckResult {
  const address = input.snapshot.address_text
  return {
    id: 'F04',
    group: 'foundation',
    label: 'Địa chỉ / vị trí',
    severity: 'high',
    confidence: 'verified',
    passed: Boolean(address),
    message: address ? `Địa chỉ trên hồ sơ: ${address}.` : 'Chưa đọc được địa chỉ trên hồ sơ.',
    action: address ? undefined : 'Bổ sung địa chỉ đầy đủ và ghim đúng vị trí trên bản đồ.',
  }
}

/** F05 — Số điện thoại. */
function checkF05(input: AuditInput): CheckResult {
  const phone = input.snapshot.phone?.trim()
  if (!phone) {
    return {
      id: 'F05',
      group: 'foundation',
      label: 'Số điện thoại',
      severity: 'high',
      confidence: 'verified',
      passed: false,
      message: 'Hồ sơ chưa có số điện thoại hiển thị công khai.',
      action: 'Thêm số điện thoại để khách có thể bấm gọi trực tiếp từ Maps.',
    }
  }
  const validFormat = /^(0|\+84)\d{9,10}$/.test(phone.replace(/[\s.\-()]/g, ''))
  return {
    id: 'F05',
    group: 'foundation',
    label: 'Số điện thoại',
    severity: 'high',
    confidence: 'verified',
    passed: validFormat,
    message: validFormat ? 'Số điện thoại hiển thị đúng định dạng.' : `Số điện thoại "${phone}" có định dạng bất thường.`,
    action: validFormat ? undefined : 'Kiểm tra lại định dạng số điện thoại trên hồ sơ.',
  }
}

/** F06 — Website: có + (nếu caller đã kiểm tra) link có sống. */
function checkF06(input: AuditInput): CheckResult {
  const website = input.snapshot.website_url
  if (!website) {
    return {
      id: 'F06',
      group: 'foundation',
      label: 'Website',
      severity: 'medium',
      confidence: 'verified',
      passed: false,
      message: 'Hồ sơ chưa gắn website.',
      action: 'Nếu đã có website, gắn vào hồ sơ. Nếu chưa có, đây không phải ưu tiên cao.',
    }
  }
  if (input.websiteReachable === undefined) {
    return {
      id: 'F06',
      group: 'foundation',
      label: 'Website',
      severity: 'medium',
      confidence: 'estimated',
      passed: null,
      message: `Hồ sơ có gắn website (${website}) nhưng chưa kiểm tra link có còn hoạt động không.`,
    }
  }
  return {
    id: 'F06',
    group: 'foundation',
    label: 'Website',
    severity: 'medium',
    confidence: 'verified',
    passed: input.websiteReachable,
    message: input.websiteReachable
      ? 'Website gắn trên hồ sơ hoạt động bình thường.'
      : `Website gắn trên hồ sơ (${website}) không truy cập được.`,
    action: input.websiteReachable ? undefined : 'Sửa hoặc gỡ link website lỗi khỏi hồ sơ.',
  }
}

/**
 * F07 — Giờ mở cửa. `opening_hours` là 1 chuỗi text gộp (không có cấu trúc
 * theo ngày) — chỉ kiểm tra có/không, không phân tích được chi tiết hơn.
 *
 * QUAN TRỌNG: khi trống, KHÔNG được kết luận "passed: false" một cách chắc
 * chắn (confidence 'verified') — đúng nguyên tắc đã có sẵn trong AUDIT_PROMPT
 * ("Giờ mở cửa: Chưa đọc được trên lần quan sát này — không kết luận là
 * thiếu"), vì Browser Agent/Claude extract có thể chỉ trích xuất trượt lần
 * này, không hẳn hồ sơ thật sự thiếu. Trả 'insufficient' khi trống, chỉ
 * 'verified' khi THẬT SỰ đọc được giá trị.
 */
function checkF07(input: AuditInput): CheckResult {
  const hours = input.snapshot.opening_hours
  if (!hours) {
    return {
      ...insufficient('F07', 'Giờ mở cửa', 'medium'),
      message: 'Chưa đọc được giờ mở cửa trên lần quan sát này — không kết luận là hồ sơ thiếu.',
    }
  }
  return {
    id: 'F07',
    group: 'foundation',
    label: 'Giờ mở cửa',
    severity: 'medium',
    confidence: 'verified',
    passed: true,
    message: 'Hồ sơ có khai giờ mở cửa.',
  }
}

export function runFoundationChecks(input: AuditInput): CheckResult[] {
  return [checkF01(input), checkF02(), checkF03(input), checkF04(input), checkF05(input), checkF06(input), checkF07(input)]
}
