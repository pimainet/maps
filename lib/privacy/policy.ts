/**
 * Chính sách bảo vệ dữ liệu cá nhân (BVDLCN) — nguồn sự thật dùng chung cho trang /privacy, /terms,
 * form đăng ký, API đồng ý, xuất dữ liệu, xoá tài khoản và cron lưu trữ.
 *
 * Căn cứ (xem docs/DATA_PROTECTION.md để có link nguồn):
 *  - Luật Bảo vệ dữ liệu cá nhân số 91/2025/QH15 (hiệu lực 01/01/2026).
 *  - Nghị định 356/2025/NĐ-CP hướng dẫn Luật 91 (thay Nghị định 13/2023/NĐ-CP).
 *  - Nghị định 330/2026/NĐ-CP xử phạt vi phạm hành chính về BVDLCN.
 *  - Luật Thương mại điện tử 122/2025/QH15 Điều 11 (nội dung phải công khai + cơ chế đồng ý trước khi mở tài khoản).
 *  - Luật Kế toán 2015 Điều 41 + Nghị định 174/2016/NĐ-CP Điều 12–13 (lưu chứng từ kế toán 5–10 năm).
 *  - Google Maps Platform Service Specific Terms + Places API policies (place_id lưu lâu dài; lat/lng tối đa 30 ngày).
 *  - Business Profile APIs policies (nội dung API lưu tạm tối đa 30 ngày).
 *
 * Mọi thứ trong file này là thuần (không gọi DB) để test được bằng scripts/test-privacy.ts.
 */

/** Đổi khi nội dung Chính sách bảo mật / Điều khoản thay đổi đáng kể -> người dùng phải đồng ý lại. */
export const CONSENT_VERSION = '2026-11-28'
export const POLICY_UPDATED_AT = '28/11/2026'

/**
 * Thông tin bên kiểm soát dữ liệu. Điền bằng biến môi trường NEXT_PUBLIC_LEGAL_* trên Vercel;
 * chưa điền thì hiện placeholder in đậm để không vô tình công bố thông tin sai.
 */
export const LEGAL_ENTITY = {
  name: process.env.NEXT_PUBLIC_LEGAL_NAME || '[CHƯA ĐIỀN: Tên doanh nghiệp / hộ kinh doanh]',
  taxId: process.env.NEXT_PUBLIC_LEGAL_TAX_ID || '[CHƯA ĐIỀN: Mã số thuế]',
  address: process.env.NEXT_PUBLIC_LEGAL_ADDRESS || '[CHƯA ĐIỀN: Địa chỉ trụ sở]',
  email: process.env.NEXT_PUBLIC_LEGAL_EMAIL || '[CHƯA ĐIỀN: Email liên hệ quyền riêng tư]',
  phone: process.env.NEXT_PUBLIC_LEGAL_PHONE || '[CHƯA ĐIỀN: Số điện thoại]',
  representative: process.env.NEXT_PUBLIC_LEGAL_REPRESENTATIVE || '[CHƯA ĐIỀN: Người đại diện / phụ trách BVDLCN]',
  productName: 'Local Growth OS',
}

export function legalEntityIncomplete(e = LEGAL_ENTITY): boolean {
  return Object.values(e).some((v) => typeof v === 'string' && v.startsWith('[CHƯA ĐIỀN'))
}

export type ConsentPurposeKey = 'service' | 'cross_border' | 'marketing'

export type ConsentPurpose = {
  key: ConsentPurposeKey
  required: boolean
  label: string
  detail: string
}

/** Đồng ý theo TỪNG mục đích (Luật 91 Điều 9; NĐ 356 Điều 6). Mục đích không bắt buộc không được là điều kiện dùng dịch vụ. */
export const CONSENT_PURPOSES: ConsentPurpose[] = [
  {
    key: 'service',
    required: true,
    label: 'Tôi đã đọc và đồng ý Điều khoản sử dụng và Chính sách bảo mật, cho phép xử lý dữ liệu cá nhân để cung cấp dịch vụ.',
    detail:
      'Gồm: họ tên, email, thông tin đăng nhập, dữ liệu doanh nghiệp bạn nhập, nhật ký sử dụng và thanh toán — để tạo tài khoản, phân tích hồ sơ Google, gợi ý việc cần làm, gửi email nhắc việc và xuất biên nhận.',
  },
  {
    key: 'cross_border',
    required: true,
    label: 'Tôi đồng ý chuyển dữ liệu ra nước ngoài cho các nhà cung cấp hạ tầng được liệt kê trong Chính sách bảo mật (máy chủ, AI, email, dữ liệu Google Maps).',
    detail:
      'Dịch vụ chạy trên hạ tầng đặt ngoài Việt Nam (Singapore, Hoa Kỳ, EU). Theo Luật 91/2025/QH15 Điều 20, việc này là chuyển dữ liệu cá nhân ra nước ngoài.',
  },
  {
    key: 'marketing',
    required: false,
    label: 'Không bắt buộc: nhận email giới thiệu tính năng mới và ưu đãi.',
    detail: 'Bạn có thể rút lại bất cứ lúc nào trong Cài đặt → Dữ liệu & quyền riêng tư.',
  },
]

export type ConsentChoice = Partial<Record<ConsentPurposeKey, boolean>>

/** Trả về danh sách mục đích bắt buộc còn thiếu (rỗng = hợp lệ). */
export function missingRequiredPurposes(choice: ConsentChoice): ConsentPurposeKey[] {
  return CONSENT_PURPOSES.filter((p) => p.required && choice[p.key] !== true).map((p) => p.key)
}

/** Chuẩn hoá lựa chọn từ client: chỉ nhận true/false tường minh, bỏ khoá lạ. Không bao giờ mặc định true. */
export function normalizeConsentChoice(raw: unknown): ConsentChoice {
  const out: ConsentChoice = {}
  if (!raw || typeof raw !== 'object') return out
  for (const p of CONSENT_PURPOSES) {
    const v = (raw as Record<string, unknown>)[p.key]
    if (v === true || v === false) out[p.key] = v
  }
  return out
}

/** Cookie tạm do trang đăng ký đặt trước khi chuyển sang Supabase/Google, để ghi nhận đồng ý sau khi có tài khoản. */
export const CONSENT_COOKIE = 'lgos_consent'

export function encodeConsentCookie(choice: ConsentChoice, at: Date, version = CONSENT_VERSION): string {
  const flags = CONSENT_PURPOSES.map((p) => (choice[p.key] ? '1' : '0')).join('')
  return `${version}.${flags}.${at.getTime()}`
}

export function parseConsentCookie(
  value: string | null | undefined,
  now: Date = new Date(),
): { version: string; choice: ConsentChoice; at: Date } | null {
  if (!value) return null
  const m = /^(\d{4}-\d{2}-\d{2})\.([01]{3})\.(\d{10,14})$/.exec(value.trim())
  if (!m) return null
  const at = new Date(Number(m[3]))
  // Cookie chỉ có giá trị trong 2 ngày và không được ở tương lai (chống giả mạo thời điểm).
  if (!Number.isFinite(at.getTime()) || at.getTime() > now.getTime() + 5 * 60_000) return null
  if (now.getTime() - at.getTime() > 2 * 86_400_000) return null
  const choice: ConsentChoice = {}
  CONSENT_PURPOSES.forEach((p, i) => (choice[p.key] = m[2][i] === '1'))
  return { version: m[1], choice, at }
}

/** IP người dùng sau proxy Vercel (x-forwarded-for: client, proxy1...). */
export function clientIpFromHeaders(h: Headers): string | null {
  const xff = h.get('x-forwarded-for')
  const first = xff?.split(',')[0]?.trim()
  const ip = first || h.get('x-real-ip')?.trim() || null
  if (!ip) return null
  return /^[0-9a-fA-F:.]{3,45}$/.test(ip) ? ip : null
}

export function truncateUserAgent(ua: string | null | undefined): string | null {
  if (!ua) return null
  return ua.slice(0, 400)
}

// ---------------------------------------------------------------------------
// Yêu cầu của chủ thể dữ liệu — thời hạn theo Nghị định 356/2025/NĐ-CP Điều 5
// ---------------------------------------------------------------------------

export type DataRequestKind = 'export' | 'delete_account' | 'withdraw_consent' | 'correct' | 'restrict' | 'object'

/** Số ngày phải xử lý xong (bên kiểm soát dữ liệu, chưa tính gia hạn). Xác nhận đã nhận trong 2 ngày làm việc. */
export const REQUEST_DEADLINE_DAYS: Record<DataRequestKind, number> = {
  export: 10, // xem / cung cấp: 10 ngày
  correct: 10, // chỉnh sửa: 10 ngày
  delete_account: 20, // xoá: 20 ngày
  withdraw_consent: 15, // rút đồng ý: 15 ngày
  restrict: 15, // hạn chế xử lý: 15 ngày
  object: 15, // phản đối xử lý: 15 ngày
}

/** Thời gian chờ trước khi thực sự xoá (người dùng có thể huỷ), luôn nhỏ hơn hạn 20 ngày. */
export const DELETION_GRACE_DAYS = 7

export function requestDueAt(kind: DataRequestKind, from: Date): Date {
  return new Date(from.getTime() + REQUEST_DEADLINE_DAYS[kind] * 86_400_000)
}

export function deletionScheduledFor(from: Date): Date {
  return new Date(from.getTime() + DELETION_GRACE_DAYS * 86_400_000)
}

/** Câu người dùng phải gõ để xác nhận xoá tài khoản. */
export const DELETE_CONFIRM_PHRASE = 'XOA TAI KHOAN'

export function normalizeConfirmPhrase(s: unknown): string {
  return typeof s === 'string'
    ? s
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/đ/gi, 'd')
        .trim()
        .replace(/\s+/g, ' ')
        .toUpperCase()
    : ''
}

export type Membership = { workspace_id: string; role: string; member_count: number; owner_count: number }

/**
 * Trước khi xoá tài khoản: workspace mà user là CHỦ SỞ HỮU DUY NHẤT nhưng còn người khác dùng
 * thì không được xoá (sẽ xoá dữ liệu của người khác) -> phải chuyển quyền chủ sở hữu trước.
 * Trả về: workspace sẽ bị xoá cùng tài khoản và workspace đang chặn.
 */
export function planAccountDeletion(memberships: Membership[]): { deleteWorkspaces: string[]; blockers: string[]; leaveWorkspaces: string[] } {
  const deleteWorkspaces: string[] = []
  const blockers: string[] = []
  const leaveWorkspaces: string[] = []
  for (const m of memberships) {
    if (m.member_count <= 1) deleteWorkspaces.push(m.workspace_id)
    else if (m.role === 'owner' && m.owner_count <= 1) blockers.push(m.workspace_id)
    else leaveWorkspaces.push(m.workspace_id)
  }
  return { deleteWorkspaces, blockers, leaveWorkspaces }
}

// ---------------------------------------------------------------------------
// Lưu trữ / tối thiểu hoá
// ---------------------------------------------------------------------------

/** Thời hạn lưu trữ (ngày). SQL `run_privacy_retention()` (migration 033) dùng đúng các con số này. */
export const RETENTION_DAYS = {
  /** Places API: lat/lng tối đa 30 ngày liên tục (GMP Service Specific Terms). */
  placesLatLng: 30,
  /** Nội dung review/ảnh hồ sơ trong snapshot (dữ liệu bên thứ ba + giới hạn cache của Google). */
  snapshotReviews: 30,
  /** Snapshot cũ không phải bản mới nhất của doanh nghiệp. */
  snapshotHistory: 90,
  /** Tên người viết review (client_reviews.author_name) sau khi đã xử lý xong. */
  reviewAuthorName: 90,
  /** IP thô trong demo_leads.raw. */
  leadIp: 30,
  /** Lead demo / yêu cầu tư vấn đã đóng. */
  leads: 730,
  /** Cache phân loại AI. */
  aiCache: 30,
  /** Nhật ký kỹ thuật (autopost_log, review_reply_log, ai_usage_events, audit_quota_events, review_draft_events). */
  techLogs: 365,
  /** Bằng chứng đồng ý & yêu cầu đã xử lý (nghĩa vụ chứng minh — NĐ 356 Điều 6). Lựa chọn của chúng tôi, không phải số luật định. */
  consentEvidence: 365 * 5,
  /** Chứng từ thanh toán: Luật Kế toán + NĐ 174/2016 Điều 13 (≥10 năm). KHÔNG tự xoá. */
  accounting: 365 * 10,
} as const

/** Khoá được giữ lại trong gbp_snapshots.raw_json: chỉ siêu dữ liệu + bản sao trường "sâu" đã chuẩn hoá. */
const RAW_KEEP_KEYS = ['source', 'source_used', 'coverage', 'reply_field_present', 'raw_review_count', 'deep', 'minimized'] as const

/**
 * Bỏ toàn bộ payload thô của nhà cung cấp (Places/Outscraper/SerpApi/SearchApi/DataForSEO) khỏi raw_json trước khi lưu.
 * Payload thô có tên, ảnh đại diện, link hồ sơ người viết review và nội dung Google không được phép lưu lâu.
 */
export function minimizeSnapshotRaw(raw: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const k of RAW_KEEP_KEYS) {
      const v = (raw as Record<string, unknown>)[k]
      if (v !== undefined) out[k] = v
    }
  }
  out.minimized = true
  return out
}

export type LatLngSource = 'places' | 'outscraper' | 'manual' | 'saved'
