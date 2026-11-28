// Báo cáo tháng của gói Làm hộ (thuần: không DB, không mạng, test được).
// Nguồn dữ liệu do lib/agency/server.ts nạp: lần quét lưới thứ hạng (tháng này + mốc trước đó) và số việc agency đã làm.

export type RankPoint = {
  keyword: string
  solv: number | null // % điểm trong top 3
  arp: number | null // hạng TB ở các điểm có mặt trong top 20 (thấp = tốt)
  atrp: number | null
  top10: number | null // % điểm trong top 10
  centerRank: number | null
  scannedAt: string | null
}

export type KeywordTrend = 'up' | 'down' | 'flat' | 'new' | 'none'

export type KeywordRow = {
  keyword: string
  current: RankPoint | null
  previous: RankPoint | null
  /** Điểm % SoLV tăng (+) / giảm (-) so với mốc trước; null nếu thiếu 1 trong 2. */
  solvDelta: number | null
  /** Hạng TB (ARP) thay đổi: số âm = tốt lên (hạng nhỏ hơn). */
  arpDelta: number | null
  trend: KeywordTrend
}

export type WorkSummary = {
  postsPublished: number
  postsPlanned: number // bài đã duyệt/đang chờ đăng cuối kỳ
  reviewsNew: number // review mới thấy trong tháng
  reviewsReplied: number // phản hồi đã đăng (Make) hoặc đã dán tay trong tháng
  reviewsOpen: number // còn chưa phản hồi cuối kỳ
  tasksDone: number
  tasksOpen: number
}

export type MonthlyReport = {
  version: 1
  period: string // 'YYYY-MM'
  periodLabel: string // 'Tháng 11/2026'
  clientName: string
  generatedAt: string
  /** null = tính năng lưới thứ hạng đang tắt hoặc chưa có lần quét nào. */
  rank: null | {
    keywords: KeywordRow[]
    avgSolv: number | null
    prevAvgSolv: number | null
    avgSolvDelta: number | null
    improved: number
    declined: number
    best: { keyword: string; solv: number } | null
    worst: { keyword: string; solv: number } | null
    scannedAt: string | null
  }
  work: WorkSummary
  highlights: string[]
  nextSteps: string[]
}

export const SOLV_FLAT_BAND = 3 // chênh dưới 3 điểm % coi là đi ngang

const r1 = (n: number) => Math.round(n * 10) / 10
const avg = (xs: number[]) => (xs.length ? r1(xs.reduce((a, b) => a + b, 0) / xs.length) : null)

/** 'YYYY-MM' hợp lệ (tháng 01–12, năm 2000–2099). */
export function isPeriod(v: unknown): v is string {
  return typeof v === 'string' && /^20\d\d-(0[1-9]|1[0-2])$/.test(v) && Number(v.slice(0, 4)) <= 2100
}

export function periodLabel(period: string): string {
  return `Tháng ${period.slice(5, 7)}/${period.slice(0, 4)}`
}

export function addMonths(period: string, delta: number): string {
  const y = Number(period.slice(0, 4))
  const m = Number(period.slice(5, 7)) - 1 + delta
  const yy = y + Math.floor(m / 12)
  const mm = ((m % 12) + 12) % 12
  return `${yy}-${String(mm + 1).padStart(2, '0')}`
}

/** Tháng hiện tại theo giờ VN, dạng 'YYYY-MM'. */
export function vnPeriodOf(now: Date): string {
  return new Date(now.getTime() + 7 * 3_600_000).toISOString().slice(0, 7)
}
export function vnDayOfMonth(now: Date): number {
  return new Date(now.getTime() + 7 * 3_600_000).getUTCDate()
}

/** Thời điểm UTC bắt đầu tháng (00:00 giờ VN ngày 1). */
export function periodStartUtc(period: string): Date {
  return new Date(Date.UTC(Number(period.slice(0, 4)), Number(period.slice(5, 7)) - 1, 1) - 7 * 3_600_000)
}

/** Ngày 1 của tháng (cột period_month của agency_monthly_reports). */
export const periodMonthDate = (period: string) => `${period}-01`

/**
 * Kỳ báo cáo "sắp tới" để nhân viên làm: những ngày đầu tháng (1–7 giờ VN) là báo cáo của tháng vừa qua (cần gửi),
 * còn lại là báo cáo của tháng đang chạy (hạn gửi: ngày 3 tháng sau).
 */
export function upcomingReportPeriod(now: Date): { period: string; dueDate: string; closing: boolean } {
  const cur = vnPeriodOf(now)
  const closing = vnDayOfMonth(now) <= 7
  const period = closing ? addMonths(cur, -1) : cur
  return { period, dueDate: `${addMonths(period, 1)}-03`, closing }
}

export function trendOf(current: RankPoint | null, previous: RankPoint | null): { trend: KeywordTrend; solvDelta: number | null; arpDelta: number | null } {
  if (!current || current.solv == null) return { trend: 'none', solvDelta: null, arpDelta: null }
  if (!previous || previous.solv == null) return { trend: 'new', solvDelta: null, arpDelta: null }
  const solvDelta = r1(current.solv - previous.solv)
  const arpDelta = current.arp != null && previous.arp != null ? r1(current.arp - previous.arp) : null
  const trend: KeywordTrend = solvDelta >= SOLV_FLAT_BAND ? 'up' : solvDelta <= -SOLV_FLAT_BAND ? 'down' : 'flat'
  return { trend, solvDelta, arpDelta }
}

const sign = (n: number) => (n > 0 ? `+${n}` : String(n))

export type ReportInput = {
  period: string
  clientName: string
  now?: Date
  /** undefined/null = lưới thứ hạng tắt hoặc chưa cấu hình. [] = có cấu hình nhưng chưa quét. */
  rank?: { keyword: string; current: RankPoint | null; previous: RankPoint | null }[] | null
  work: WorkSummary
}

export function buildMonthlyReport(input: ReportInput): MonthlyReport {
  const now = input.now ?? new Date()
  const hl: string[] = []
  const next: string[] = []

  let rank: MonthlyReport['rank'] = null
  const scanned = (input.rank || []).filter((k) => k.current && k.current.solv != null)
  if (input.rank && scanned.length > 0) {
    const rows: KeywordRow[] = input.rank.map((k) => ({ keyword: k.keyword, current: k.current, previous: k.previous, ...trendOf(k.current, k.previous) }))
    const withSolv = rows.filter((r) => r.current?.solv != null)
    const avgSolv = avg(withSolv.map((r) => r.current!.solv as number))
    // So sánh công bằng: chỉ tính các từ khoá có cả 2 mốc
    const both = withSolv.filter((r) => r.previous?.solv != null)
    const curBoth = avg(both.map((r) => r.current!.solv as number))
    const prevAvg = avg(both.map((r) => r.previous!.solv as number))
    const avgSolvDelta = curBoth != null && prevAvg != null ? r1(curBoth - prevAvg) : null
    const sorted = [...withSolv].sort((a, b) => (b.current!.solv as number) - (a.current!.solv as number))
    const best = sorted[0] ? { keyword: sorted[0].keyword, solv: sorted[0].current!.solv as number } : null
    const worstRow = sorted.length > 1 ? sorted[sorted.length - 1] : null
    const worst = worstRow ? { keyword: worstRow.keyword, solv: worstRow.current!.solv as number } : null
    const improved = rows.filter((r) => r.trend === 'up').length
    const declined = rows.filter((r) => r.trend === 'down').length
    const scannedAt = withSolv.map((r) => r.current!.scannedAt).filter(Boolean).sort().pop() ?? null
    rank = { keywords: rows, avgSolv, prevAvgSolv: prevAvg, avgSolvDelta, improved, declined, best, worst, scannedAt }

    if (avgSolv != null) {
      hl.push(
        avgSolvDelta == null
          ? `Tỷ lệ hiện diện top 3 trên bản đồ (SoLV) trung bình đạt ${avgSolv}% trên ${withSolv.length} từ khoá (đây là mốc đầu tiên để so sánh).`
          : `Tỷ lệ hiện diện top 3 trên bản đồ (SoLV) trung bình ${avgSolv}%, ${avgSolvDelta > 0 ? 'tăng' : avgSolvDelta < 0 ? 'giảm' : 'giữ nguyên'}${avgSolvDelta === 0 ? '' : ` ${Math.abs(avgSolvDelta)} điểm %`} so với mốc trước (${prevAvg}%).`,
      )
    }
    if (improved > 0) hl.push(`${improved}/${rows.length} từ khoá tốt lên rõ rệt (tăng từ ${SOLV_FLAT_BAND} điểm % trở lên).`)
    if (declined > 0) hl.push(`${declined}/${rows.length} từ khoá giảm từ ${SOLV_FLAT_BAND} điểm % trở lên — đã đưa vào việc cần xử lý tháng tới.`)
    if (best) hl.push(`Từ khoá mạnh nhất: "${best.keyword}" (${best.solv}% điểm trong top 3).`)
    const weak = sorted.filter((r) => (r.current!.solv as number) < 30).slice(-2).reverse()
    for (const w of weak) next.push(`Tập trung tối ưu cho từ khoá "${w.keyword}" (hiện chỉ ${w.current!.solv}% điểm trong top 3): bổ sung từ khoá vào mô tả/dịch vụ, thêm ảnh và bài đăng liên quan.`)
    for (const d of rows.filter((r) => r.trend === 'down').slice(0, 2)) next.push(`Kiểm tra nguyên nhân từ khoá "${d.keyword}" giảm ${Math.abs(d.solvDelta as number)} điểm % (đối thủ mới, thay đổi danh mục hay thiếu hoạt động).`)
  }

  const w = input.work
  if (w.postsPublished > 0) hl.push(`Đã đăng ${w.postsPublished} bài kèm ảnh lên Google Maps.`)
  else next.push('Chưa có bài nào được đăng trong tháng: bổ sung ảnh vào kho ảnh để đăng đều đặn.')
  if (w.reviewsReplied > 0) hl.push(`Đã phản hồi ${w.reviewsReplied} đánh giá.`)
  if (w.reviewsNew > 0) hl.push(`Có ${w.reviewsNew} đánh giá mới trong tháng.`)
  if (w.reviewsOpen > 0) next.push(`Còn ${w.reviewsOpen} đánh giá chưa phản hồi — ưu tiên xử lý đầu tháng sau.`)
  if (w.tasksDone > 0) hl.push(`Hoàn thành ${w.tasksDone} việc tối ưu hồ sơ theo kết quả kiểm tra.`)
  if (w.tasksOpen > 0) next.push(`Còn ${w.tasksOpen} việc tối ưu hồ sơ trong kế hoạch, sẽ tiếp tục thực hiện.`)
  if (w.postsPlanned > 0) next.push(`${w.postsPlanned} bài đã duyệt sẽ được đăng trong những ngày tới.`)
  if (!rank) next.push('Bản đồ thứ hạng chưa có dữ liệu cho kỳ này; sẽ cập nhật ngay khi có lần quét đầu tiên.')
  if (hl.length === 0) hl.push('Tháng này chưa ghi nhận hoạt động nổi bật; chúng tôi sẽ tăng nhịp độ trong tháng tới.')

  return {
    version: 1,
    period: input.period,
    periodLabel: periodLabel(input.period),
    clientName: input.clientName,
    generatedAt: now.toISOString(),
    rank,
    work: w,
    highlights: hl,
    nextSteps: next.slice(0, 6),
  }
}

/** Mô tả ngắn một mức đổi (dùng ở email/giao diện). */
export function deltaText(d: number | null, unit = ' điểm %'): string {
  if (d == null) return '—'
  if (d === 0) return 'không đổi'
  return `${sign(d)}${unit}`
}
