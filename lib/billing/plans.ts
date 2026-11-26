// Định nghĩa gói + quyền lợi. THUẦN (không đụng DB) để test được; mọi giá tính ở server từ đây.
export type PlanKey = 'free' | 'basic' | 'full'
export type PaidPlan = Exclude<PlanKey, 'free'>
export type PeriodMonths = 1 | 3 | 12

export const PERIODS: PeriodMonths[] = [1, 3, 12]

export const PLAN_LABEL: Record<PlanKey, string> = { free: 'Miễn phí', basic: 'Khởi động', full: 'Nâng cao' }

/** Giá 1 tháng (VND). Giá phiên bản đầu (349k/799k) giữ nguyên cho tới khi có dữ liệu thực tế về chuyển đổi, chi phí AI/vận hành và mức sẵn sàng chi trả; đổi ở đây là đủ. */
export const MONTHLY_PRICE_VND: Record<PaidPlan, number> = { basic: 349_000, full: 799_000 }

/** Trả trước nhiều tháng được giảm: 3 tháng -5%, 12 tháng -15% (làm tròn nghìn). */
export const PERIOD_DISCOUNT: Record<PeriodMonths, number> = { 1: 0, 3: 0.05, 12: 0.15 }

export function priceFor(plan: PaidPlan, months: PeriodMonths): number {
  const raw = MONTHLY_PRICE_VND[plan] * months * (1 - PERIOD_DISCOUNT[months])
  return Math.round(raw / 1000) * 1000
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
}

export const ENTITLEMENTS: Record<PlanKey, Entitlements> = {
  free: { taskLimit: 3, auditActionLimit: 3, advanceAdvice: false, monitoring: false, maxClients: 1 },
  basic: { taskLimit: null, auditActionLimit: null, advanceAdvice: true, monitoring: false, maxClients: 1 },
  full: { taskLimit: null, auditActionLimit: null, advanceAdvice: true, monitoring: true, maxClients: 1 },
}

export function normalizePlan(v: unknown): PlanKey {
  return v === 'basic' || v === 'full' ? v : 'free'
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
  if (plan === 'free' && wsPlan && !['free', 'basic', 'full'].includes(String(wsPlan))) plan = 'full'
  return plan
}

export function isPaidPlan(v: unknown): v is PaidPlan {
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
