// Định nghĩa gói + quyền lợi. THUẦN (không đụng DB) để test được; mọi giá tính ở server từ đây.
export type PlanKey = 'free' | 'basic' | 'full' | 'done_for_you'
export type PaidPlan = Exclude<PlanKey, 'free'>
/** Gói khách tự mua (tạo đơn + QR trên /billing). 'done_for_you' (Làm hộ) chỉ bán qua tư vấn: admin tạo đơn. */
export type SelfServePlan = 'basic' | 'full'
export type PeriodMonths = 1 | 3 | 12

export const PERIODS: PeriodMonths[] = [1, 3, 12]

export const PLAN_LABEL: Record<PlanKey, string> = { free: 'Miễn phí', basic: 'Khởi động', full: 'Nâng cao', done_for_you: 'Làm hộ' }

/** Giá 1 tháng (VND). Giá phiên bản đầu (349k/799k) giữ nguyên cho tới khi có dữ liệu thực tế về chuyển đổi, chi phí AI/vận hành và mức sẵn sàng chi trả; đổi ở đây là đủ. */
export const MONTHLY_PRICE_VND: Record<PaidPlan, number> = { basic: 349_000, full: 799_000, done_for_you: 2_490_000 }

/** Trả trước nhiều tháng được giảm: 3 tháng -5%, 12 tháng -15% (làm tròn nghìn). */
export const PERIOD_DISCOUNT: Record<PeriodMonths, number> = { 1: 0, 3: 0.05, 12: 0.15 }

/** Gói Làm hộ chưa có giảm giá theo kỳ (chưa chốt): 2.490.000đ x số tháng. Chốt giảm giá thì đổi ở đây. */
export function periodDiscountFor(plan: PaidPlan, months: PeriodMonths): number {
  return plan === 'done_for_you' ? 0 : PERIOD_DISCOUNT[months]
}

export function priceFor(plan: PaidPlan, months: PeriodMonths): number {
  const raw = MONTHLY_PRICE_VND[plan] * months * (1 - periodDiscountFor(plan, months))
  return Math.round(raw / 1000) * 1000
}

/** Lưới thứ hạng (bản đồ nhiệt). null = gói không có tính năng này. */
export type RankGridEntitlement = {
  /** Cỡ lưới được chọn (cạnh). */
  gridSizes: Array<3 | 5 | 7 | 9>
  defaultGridSize: 3 | 5 | 7 | 9
  maxKeywords: number
  /** Quét định kỳ; 'none' = không tự quét. */
  frequency: 'weekly' | 'biweekly' | 'none'
  /** Lần "Quét ngay" mỗi tháng (giờ VN). */
  manualScansPerMonth: number
  /** Lần quét thử trọn đời của workspace (gói Miễn phí). */
  trialScans: number
  /** Trần điểm quét mỗi tháng của workspace — chốt chặn chi phí cuối cùng (xem rankgrid_reserve_points). */
  monthlyPointCap: number
}

/** Hộp thư review (Review Watch + phản hồi). Xem lib/reviews/* và supabase/migrations/029_review_inbox.sql. */
export type ReviewEntitlement = {
  /** Tự lấy review mới: 'none' = không tự quét (chỉ xem review có sẵn từ lần kiểm tra hồ sơ gần nhất). */
  frequency: 'none' | 'weekly' | 'daily'
  /** Tự soạn nháp AI khi có review mới chưa được phản hồi. */
  autoDraft: boolean
  /** Trần lượt soạn nháp AI mỗi tháng của workspace (tự động + bấm tay + chủ quán xin soạn lại). */
  monthlyDrafts: number
  /** Gửi link duyệt phản hồi không cần đăng nhập cho chủ quán (/r/<token>). */
  ownerLink: boolean
  /** Cho phép đăng phản hồi lên Google qua Make (Business Profile API). Không có thì copy và dán tay. */
  postViaMake: boolean
  /** Số lần bấm "Kiểm tra review ngay" (gọi nguồn dữ liệu trả phí) mỗi tháng. */
  manualChecksPerMonth: number
}

export type Entitlements = {
  /** Số việc trong kế hoạch được mở (null = tất cả). */
  taskLimit: number | null
  /** Số việc "cần làm ngay" của audit được mở. */
  auditActionLimit: number | null
  /** Danh mục phụ gợi ý + mô tả mẫu. */
  advanceAdvice: boolean
  /** Cảnh báo đánh giá xấu, theo dõi thứ hạng (gói Nâng cao). */
  monitoring: boolean
  maxClients: number
  rankGrid: RankGridEntitlement
  reviews: ReviewEntitlement
  /** Gói Làm hộ: nhân viên agency duyệt bài/phản hồi thay khách (khách không phải duyệt) và có báo cáo tháng. */
  staffManaged: boolean
  /** Báo cáo tháng (tóm tắt từ lưới thứ hạng + việc agency đã làm). */
  monthlyReport: boolean
}

/**
 * Hạn mức lưới thứ hạng (chốt 28/11/2026). Chi phí dữ liệu DataForSEO ~16đ/điểm (Standard), ~32đ/điểm (Priority):
 *  - Miễn phí: 1 lần quét thử 5x5, 1 từ khoá, không quét định kỳ (~800đ trọn đời).
 *  - Khởi động: 5x5, 5 từ khoá, 2 tuần/lần, 2 lần quét tay/tháng (tối đa ~7.000đ/tháng).
 *  - Nâng cao: 7x7 (cho chọn 9x9), 10 từ khoá, hàng tuần, 8 lần quét tay/tháng (tối đa ~77.000đ/tháng).
 * monthlyPointCap = trường hợp xấu nhất (5 tuần trong tháng / 3 kỳ 2 tuần) + quét tay, làm tròn lên.
 */
export const RANK_GRID_LIMITS: Record<PlanKey, RankGridEntitlement> = {
  free: { gridSizes: [5], defaultGridSize: 5, maxKeywords: 1, frequency: 'none', manualScansPerMonth: 0, trialScans: 1, monthlyPointCap: 25 },
  basic: { gridSizes: [5], defaultGridSize: 5, maxKeywords: 5, frequency: 'biweekly', manualScansPerMonth: 2, trialScans: 0, monthlyPointCap: 450 },
  full: { gridSizes: [5, 7, 9], defaultGridSize: 7, maxKeywords: 10, frequency: 'weekly', manualScansPerMonth: 8, trialScans: 0, monthlyPointCap: 4_700 },
  // Làm hộ (chốt 28/11/2026): >= Nâng cao. 7x7 mặc định (cho chọn 9x9), 10 từ khoá, hàng tuần + báo cáo tháng.
  // 12 lần quét tay/tháng để nhân viên quét lại sau khi tối ưu; trần 5.500 điểm = 5 tuần x 10 từ khoá x 81 điểm + 12 x 81 (xấu nhất, 9x9) ~ 5.000, dư chút.
  done_for_you: { gridSizes: [5, 7, 9], defaultGridSize: 7, maxKeywords: 10, frequency: 'weekly', manualScansPerMonth: 12, trialScans: 0, monthlyPointCap: 5_500 },
}

/**
 * Hạn mức hộp thư review (chốt mặc định 28/11/2026, đổi ở đây là đủ).
 * Chi phí (ước tính, 26.800đ/USD): Outscraper ~$3/1.000 review (500 review đầu mỗi 30 ngày miễn phí cho cả tài khoản),
 * Claude Sonnet ~170đ/bản nháp. Hồ sơ nhỏ ở VN thường có 5–30 review mới/tháng.
 *  - Miễn phí: không tự quét; xem review lấy được từ lần kiểm tra hồ sơ gần nhất, 5 bản nháp AI bấm tay/tháng, copy và dán.
 *  - Khởi động: quét hàng tuần, tự soạn nháp, 40 nháp/tháng, link duyệt cho chủ quán, đăng qua Make, 2 lần quét tay/tháng.
 *  - Nâng cao: quét hàng ngày, tự soạn nháp, 150 nháp/tháng, link duyệt, đăng qua Make, 8 lần quét tay/tháng.
 * Có thể ghi đè trần nháp bằng env REVIEW_DRAFTS_FREE / REVIEW_DRAFTS_BASIC / REVIEW_DRAFTS_FULL (xem reviewEntitlement()).
 */
export const REVIEW_LIMITS: Record<PlanKey, ReviewEntitlement> = {
  free: { frequency: 'none', autoDraft: false, monthlyDrafts: 5, ownerLink: false, postViaMake: false, manualChecksPerMonth: 0 },
  basic: { frequency: 'weekly', autoDraft: true, monthlyDrafts: 40, ownerLink: true, postViaMake: true, manualChecksPerMonth: 2 },
  full: { frequency: 'daily', autoDraft: true, monthlyDrafts: 150, ownerLink: true, postViaMake: true, manualChecksPerMonth: 8 },
  // Làm hộ: trả lời MỌI review (hàng ngày, soạn nháp tự động, trần nháp cao). Không gửi link duyệt cho chủ quán: nhân viên duyệt thay.
  done_for_you: { frequency: 'daily', autoDraft: true, monthlyDrafts: 400, ownerLink: false, postViaMake: true, manualChecksPerMonth: 30 },
}

/** Hạn mức review sau khi áp env ghi đè (số không hợp lệ thì bỏ qua). Thuần, test được (truyền env giả). */
export function reviewEntitlement(plan: PlanKey, env: Record<string, string | undefined> = process.env): ReviewEntitlement {
  const base = REVIEW_LIMITS[plan]
  const raw = env[`REVIEW_DRAFTS_${plan.toUpperCase()}`]
  const n = raw != null && raw !== '' ? Number(raw) : NaN
  return Number.isInteger(n) && n >= 0 && n <= 10_000 ? { ...base, monthlyDrafts: n } : base
}

export const ENTITLEMENTS: Record<PlanKey, Entitlements> = {
  free: { taskLimit: 3, auditActionLimit: 3, advanceAdvice: false, monitoring: false, maxClients: 1, rankGrid: RANK_GRID_LIMITS.free, reviews: REVIEW_LIMITS.free, staffManaged: false, monthlyReport: false },
  basic: { taskLimit: null, auditActionLimit: null, advanceAdvice: true, monitoring: false, maxClients: 1, rankGrid: RANK_GRID_LIMITS.basic, reviews: REVIEW_LIMITS.basic, staffManaged: false, monthlyReport: false },
  full: { taskLimit: null, auditActionLimit: null, advanceAdvice: true, monitoring: true, maxClients: 1, rankGrid: RANK_GRID_LIMITS.full, reviews: REVIEW_LIMITS.full, staffManaged: false, monthlyReport: false },
  done_for_you: { taskLimit: null, auditActionLimit: null, advanceAdvice: true, monitoring: true, maxClients: 1, rankGrid: RANK_GRID_LIMITS.done_for_you, reviews: REVIEW_LIMITS.done_for_you, staffManaged: true, monthlyReport: true },
}

export function normalizePlan(v: unknown): PlanKey {
  return v === 'basic' || v === 'full' || v === 'done_for_you' ? v : 'free'
}

/** Gói do nhân viên agency vận hành (duyệt thay khách). */
export function isStaffManaged(plan: unknown): boolean {
  return ENTITLEMENTS[normalizePlan(plan)].staffManaged
}

/** Quá hạn bao nhiêu ngày (sau khi kỳ hết) thì hạ về gói miễn phí nếu cron chưa kịp hạ. */
export const PLAN_GRACE_DAYS = 3

/**
 * Gói hiệu lực của workspace: `workspaces.plan`, nhưng nếu kỳ đang hoạt động đã hết hạn quá ân hạn
 * mà cron chưa kịp hạ thì vẫn tính là miễn phí. Gói thủ công do superadmin đặt (vd 'agency') không có kỳ
 * và được coi là gói đầy đủ. Thuần logic, dùng chung cho getPlanState và cron.
 */
export function resolveEffectivePlan(
  wsPlan: unknown,
  active: { current_period_end: string } | null | undefined,
  now: number = Date.now()
): PlanKey {
  let plan = normalizePlan(wsPlan)
  if (plan !== 'free' && active) {
    if (new Date(active.current_period_end).getTime() + PLAN_GRACE_DAYS * 86_400_000 < now) plan = 'free'
  }
  if (plan === 'free' && wsPlan && !['free', 'basic', 'full', 'done_for_you'].includes(String(wsPlan))) plan = 'full'
  return plan
}

export function isPaidPlan(v: unknown): v is PaidPlan {
  return v === 'basic' || v === 'full' || v === 'done_for_you'
}
/** Gói khách tự mua trên /billing (không gồm Làm hộ: chỉ admin tạo đơn sau tư vấn). */
export function isSelfServePlan(v: unknown): v is SelfServePlan {
  return v === 'basic' || v === 'full'
}
export function isPeriod(v: unknown): v is PeriodMonths {
  return v === 1 || v === 3 || v === 12
}

/** Mã chuyển khoản: ngắn, không dấu, ngân hàng nào cũng giữ nguyên. */
export function transferContent(orderCode: number): string {
  return `LGOS${orderCode}`
}

/** Số đơn nhập từ nội dung chuyển khoản (chịu được khoảng trắng/chữ thường). */
export function parseOrderCode(content: string): number | null {
  const m = /LGOS\s*(\d{6,12})/i.exec(content || '')
  return m ? Number(m[1]) : null
}
