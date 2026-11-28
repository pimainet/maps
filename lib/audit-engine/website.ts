import type { AuditInput, CheckResult, WebsiteSignals } from './types'

/**
 * W01–W04 — tín hiệu địa phương của website (dữ liệu do lib/website-signals.ts lấy trực tiếp từ website của khách).
 * Không lấy được trang (không có website, robots.txt chặn, trang mạng xã hội, lỗi) => "chưa đủ dữ liệu", không trừ điểm;
 * website chết đã được F06 tính, không trừ lần nữa ở đây.
 */
const LABELS: Record<string, string> = {
  W01: 'Website NAP matches profile',
  W02: 'City/district in title or H1',
  W03: 'LocalBusiness schema',
  W04: 'HTTPS + mobile viewport',
}

const STATUS_MSG: Record<Exclude<WebsiteSignals['status'], 'ok'>, string> = {
  robots_disallowed: 'Website chặn bot kiểm tra theo robots.txt nên không đọc trang — không kết luận.',
  robots_error: 'Không đọc được robots.txt của website (lỗi máy chủ) nên chưa lấy trang — không kết luận.',
  unreachable: 'Chưa tải được website lần này (mục "Website" đã ghi nhận) — không kết luận thêm.',
  unsafe: 'Địa chỉ website không an toàn để kiểm tra tự động (trỏ vào mạng nội bộ hoặc cổng lạ) — không kết luận.',
  not_html: 'Link website không trả về trang web (HTML) — không kết luận.',
  http_error: 'Website trả lỗi khi tải — không kết luận.',
  social: 'Link "website" trên hồ sơ là trang mạng xã hội/sàn, không phải website riêng — không chấm các mục website.',
}

function insufficient(id: string, severity: CheckResult['severity'], message: string): CheckResult {
  return { id, group: 'website', label: LABELS[id], severity, confidence: 'insufficient', passed: null, message }
}

function result(id: string, severity: CheckResult['severity'], passed: boolean, message: string, action?: string): CheckResult {
  return { id, group: 'website', label: LABELS[id], severity, confidence: 'verified', passed, message, action: passed ? undefined : action }
}

export function runWebsiteChecks(input: AuditInput): CheckResult[] {
  const w = input.website
  const sev: Record<string, CheckResult['severity']> = { W01: 'high', W02: 'medium', W03: 'medium', W04: 'low' }
  if (!input.snapshot.website_url) {
    return ['W01', 'W02', 'W03', 'W04'].map((id) => insufficient(id, sev[id], 'Hồ sơ chưa có website (mục "Website" đã ghi nhận) — không chấm các mục website.'))
  }
  if (!w) return ['W01', 'W02', 'W03', 'W04'].map((id) => insufficient(id, sev[id], 'Chưa kiểm tra được website lần này.'))
  if (w.status !== 'ok') {
    const msg = STATUS_MSG[w.status] + (w.detail && w.status === 'http_error' ? ` (${w.detail})` : '')
    return ['W01', 'W02', 'W03', 'W04'].map((id) => insufficient(id, sev[id], msg))
  }

  // W01 — NAP: số điện thoại và địa chỉ hồ sơ có trên website (trang chủ hoặc schema).
  let w01: CheckResult
  const known = [w.phoneOnPage, w.addressOnPage].filter((x) => x !== null && x !== undefined)
  if (known.length === 0) {
    w01 = insufficient('W01', 'high', 'Hồ sơ thiếu số điện thoại/địa chỉ để so với website.')
  } else {
    const parts = [
      w.phoneOnPage == null ? null : w.phoneOnPage ? 'số điện thoại khớp' : 'không thấy số điện thoại của hồ sơ',
      w.addressOnPage == null ? null : w.addressOnPage ? 'địa chỉ khớp' : 'không thấy địa chỉ (số nhà + đường) của hồ sơ',
      w.nameOnPage == null ? null : w.nameOnPage ? 'có tên doanh nghiệp' : 'không thấy đúng tên doanh nghiệp',
    ].filter(Boolean)
    const passed = known.every(Boolean)
    w01 = result(
      'W01', 'high', passed,
      `Trang chủ website: ${parts.join(', ')}.`,
      'Ghi đúng tên, địa chỉ, số điện thoại như trên hồ sơ Google ở trang chủ website (chân trang hoặc mục Liên hệ), viết giống hệt nhau.',
    )
  }

  // W02 — quận/huyện hoặc tỉnh/thành trong title/H1.
  const head = [w.title ? `title "${w.title.slice(0, 80)}"` : 'không có title', w.h1?.length ? `H1 "${w.h1[0].slice(0, 80)}"` : 'không có H1'].join(', ')
  const terms = (w.placeTerms ?? []).join(', ')
  const w02 =
    w.cityInTitleOrH1 == null
      ? insufficient('W02', 'medium', 'Chưa xác định được quận/thành phố từ địa chỉ hồ sơ để so.')
      : result(
          'W02', 'medium', w.cityInTitleOrH1,
          w.cityInTitleOrH1 ? `Title/H1 có nhắc khu vực (${head}).` : `Title/H1 chưa nhắc khu vực (${terms}): ${head}.`,
          `Đưa dịch vụ chính + khu vực vào title và H1 trang chủ (vd "${(input.snapshot.primary_category || 'Dịch vụ')} ${w.placeTerms?.[0] ?? ''}").`.replace(/\s+"\)/, '")'),
        )

  // W03 — schema LocalBusiness (JSON-LD hoặc microdata).
  const types = (w.schemaTypes ?? []).slice(0, 5).join(', ')
  const w03 = result(
    'W03', 'medium', !!w.localBusinessSchema,
    w.localBusinessSchema ? `Có schema doanh nghiệp địa phương (${types}).` : types ? `Có schema nhưng không phải loại doanh nghiệp địa phương (${types}).` : 'Không thấy schema (JSON-LD) doanh nghiệp địa phương.',
    'Thêm JSON-LD LocalBusiness (hoặc loại cụ thể như Restaurant, Dentist) với tên, địa chỉ, số điện thoại, giờ mở cửa khớp hồ sơ Google.',
  )

  // W04 — HTTPS + viewport di động.
  const w04ok = !!w.https && !!w.hasViewport
  const w04 = result(
    'W04', 'low', w04ok,
    `${w.https ? 'Có HTTPS' : 'Không dùng HTTPS'}; ${w.hasViewport ? 'có cấu hình hiển thị điện thoại' : 'thiếu thẻ viewport cho điện thoại'}.`,
    'Bật HTTPS và thêm thẻ <meta name="viewport"> để website hiển thị tốt trên điện thoại.',
  )

  return [w01, w02, w03, w04]
}
