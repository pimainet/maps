// Gói Làm hộ: gói/giá/quyền lợi, đơn do admin tạo, yêu cầu tư vấn, báo cáo tháng, email. Thuần logic, không DB/mạng.
import assert from 'node:assert/strict'
import {
  ENTITLEMENTS, MONTHLY_PRICE_VND, PLAN_LABEL, RANK_GRID_LIMITS, REVIEW_LIMITS, isPaidPlan, isSelfServePlan, isStaffManaged,
  normalizePlan, periodDiscountFor, priceFor, resolveEffectivePlan,
} from '../lib/billing/plans'
import { DEFAULT_EXPIRES_DAYS, buildPaymentMessage, parseAdminOrder } from '../lib/agency/order'
import { normalizePhone, parseLead } from '../lib/agency/lead'
import {
  addMonths, buildMonthlyReport, isPeriod, periodLabel, periodMonthDate, trendOf, upcomingReportPeriod, vnDayOfMonth, vnPeriodOf,
  type RankPoint, type WorkSummary,
} from '../lib/agency/report'
import { agencyDigestHasWork, buildAgencyDigestEmail, buildConsultationAdminEmail, buildMonthlyReportEmail } from '../lib/agency/emails'

// ── Gói ─────────────────────────────────────────────────────────────────────
assert.equal(MONTHLY_PRICE_VND.done_for_you, 2_490_000)
assert.equal(PLAN_LABEL.done_for_you, 'Làm hộ')
assert.equal(priceFor('done_for_you', 1), 2_490_000)
assert.equal(priceFor('done_for_you', 3), 7_470_000) // không giảm theo kỳ hạn
assert.equal(priceFor('done_for_you', 12), 29_880_000)
assert.equal(periodDiscountFor('done_for_you', 12), 0)
assert.ok(periodDiscountFor('full', 12) > 0)
assert.equal(priceFor('full', 3), 2_277_000) // không đổi các gói cũ
assert.ok(isPaidPlan('done_for_you') && !isSelfServePlan('done_for_you') && isSelfServePlan('full') && isSelfServePlan('basic'))
assert.ok(isStaffManaged('done_for_you') && !isStaffManaged('full') && !isStaffManaged('free') && !isStaffManaged('lạ'))
assert.equal(normalizePlan('done_for_you'), 'done_for_you')

// quyền lợi >= Nâng cao
const dfy = ENTITLEMENTS.done_for_you
const full = ENTITLEMENTS.full
assert.ok(dfy.staffManaged && dfy.monthlyReport && !full.staffManaged && !full.monthlyReport && !ENTITLEMENTS.free.monthlyReport)
const rg = RANK_GRID_LIMITS.done_for_you, rf = RANK_GRID_LIMITS.full
assert.equal(rg.defaultGridSize, 7)
assert.ok(rg.gridSizes.includes(7) && rg.gridSizes.length >= rf.gridSizes.length)
assert.equal(rg.maxKeywords, 10)
assert.equal(rg.frequency, 'weekly')
assert.ok(rg.manualScansPerMonth >= rf.manualScansPerMonth && rg.monthlyPointCap >= rf.monthlyPointCap)
const rv = REVIEW_LIMITS.done_for_you, rvf = REVIEW_LIMITS.full
assert.equal(rv.frequency, 'daily')
assert.ok(rv.autoDraft && rv.postViaMake)
assert.ok(rv.monthlyDrafts >= rvf.monthlyDrafts * 2, 'trần soạn nháp đủ cao để trả lời mọi review')
assert.equal(rv.ownerLink, false, 'khách không duyệt: không có link duyệt cho chủ')
assert.ok(dfy.monitoring && dfy.advanceAdvice && dfy.taskLimit === null && dfy.auditActionLimit === null)

// hết hạn quá ân hạn (3 ngày) -> về free; còn hạn / trong ân hạn giữ nguyên
const NOW = Date.UTC(2026, 10, 28)
const day = 86_400_000
assert.equal(resolveEffectivePlan('done_for_you', { current_period_end: new Date(NOW + day).toISOString() }, NOW), 'done_for_you')
assert.equal(resolveEffectivePlan('done_for_you', { current_period_end: new Date(NOW - 2 * day).toISOString() }, NOW), 'done_for_you')
assert.equal(resolveEffectivePlan('done_for_you', { current_period_end: new Date(NOW - 4 * day).toISOString() }, NOW), 'free')

// ── Đơn admin tạo ───────────────────────────────────────────────────────────
const o = parseAdminOrder({ workspace_id: 'x' })
assert.ok(o.ok && o.value.plan === 'done_for_you' && o.value.months === 1 && o.value.amount === 2_490_000 && !o.value.customAmount && o.value.expiresDays === DEFAULT_EXPIRES_DAYS)
const o3 = parseAdminOrder({ months: 3 })
assert.ok(o3.ok && o3.value.amount === 7_470_000)
const oc = parseAdminOrder({ amount_vnd: 2_000_000 })
assert.ok(oc.ok && oc.value.amount === 2_000_000 && oc.value.customAmount)
assert.ok(parseAdminOrder({ amount_vnd: 2_490_000 }).ok && !(parseAdminOrder({ amount_vnd: 2_490_000 }) as any).value.customAmount)
for (const bad of [{ plan: 'free' }, { plan: 'agency' }, { months: 2 }, { months: 'abc' }, { amount_vnd: 0 }, { amount_vnd: -5 }, { amount_vnd: 12.5 }, { amount_vnd: 999_999_999 }, { amount_vnd: 'x' }, { expires_days: 0 }, { expires_days: 61 }]) {
  assert.equal(parseAdminOrder(bad).ok, false, JSON.stringify(bad))
}
assert.equal(parseAdminOrder(null).ok, true) // mặc định hợp lệ: gói Làm hộ 1 tháng
const msg = buildPaymentMessage({ workspaceName: 'Quán A', plan: 'done_for_you', months: 1, amount: 2_490_000, bankId: 'ACB', accountNo: '123', accountName: 'NGUYEN VAN A', orderCode: 170000000042, expiresAt: '2026-12-12T00:00:00.000Z', qrUrl: 'https://qr/x.png' })
for (const part of ['Làm hộ', 'Quán A', '2.490.000', 'ACB', '123', 'NGUYEN VAN A', 'LGOS170000000042', 'https://qr/x.png', '12/12/2026']) assert.ok(msg.includes(part), part)

// ── Yêu cầu tư vấn ──────────────────────────────────────────────────────────
assert.equal(normalizePhone('0901 234 567'), '0901234567')
assert.equal(normalizePhone('+84901234567'), '0901234567')
assert.equal(normalizePhone('84901234567'), '0901234567')
assert.equal(normalizePhone('0901.234.567'), '0901234567')
assert.equal(normalizePhone('12345'), null)
assert.equal(normalizePhone('abc'), null)
assert.equal(normalizePhone(123), null)
const lead = parseLead({ contact_name: '  Lan  ', phone: '090 123 4567', email: ' a@b.co ', business_name: 'Quán A', message: 'Cần hỗ trợ' })
assert.ok(lead.ok && lead.value.contact_name === 'Lan' && lead.value.phone === '0901234567' && lead.value.email === 'a@b.co')
const minimal = parseLead({ contact_name: 'Lan', phone: '0901234567' })
assert.ok(minimal.ok && minimal.value.email === null && minimal.value.message === null && minimal.value.business_name === null)
assert.equal(parseLead({ phone: '0901234567' }).ok, false)
assert.equal(parseLead({ contact_name: 'Lan', phone: '1' }).ok, false)
assert.equal(parseLead({ contact_name: 'Lan', phone: '0901234567', email: 'khong-hop-le' }).ok, false)
assert.equal(parseLead(null).ok, false)
const long = parseLead({ contact_name: 'L'.repeat(500), phone: '0901234567', message: 'm'.repeat(5000) })
assert.ok(long.ok && long.value.contact_name.length <= 120 && (long.value.message || '').length <= 2000)

// ── Kỳ báo cáo (giờ VN) ─────────────────────────────────────────────────────
assert.ok(isPeriod('2026-11') && !isPeriod('2026-13') && !isPeriod('2026-1') && !isPeriod('1999-05') && !isPeriod(202611) && !isPeriod('2026-11-01'))
assert.equal(periodLabel('2026-03'), 'Tháng 03/2026')
assert.equal(addMonths('2026-11', 1), '2026-12')
assert.equal(addMonths('2026-12', 1), '2027-01')
assert.equal(addMonths('2026-01', -1), '2025-12')
assert.equal(addMonths('2026-01', -13), '2024-12')
assert.equal(periodMonthDate('2026-11'), '2026-11-01')
// 31/12 18:00 UTC = 01/01 01:00 giờ VN
const edge = new Date(Date.UTC(2026, 11, 31, 18, 0))
assert.equal(vnPeriodOf(edge), '2027-01')
assert.equal(vnDayOfMonth(edge), 1)
assert.deepEqual(upcomingReportPeriod(edge), { period: '2026-12', dueDate: '2027-01-03', closing: true })
const mid = new Date(Date.UTC(2026, 10, 28, 3, 0))
assert.deepEqual(upcomingReportPeriod(mid), { period: '2026-11', dueDate: '2026-12-03', closing: false })
assert.equal(upcomingReportPeriod(new Date(Date.UTC(2026, 10, 7, 16, 0))).closing, true) // 7/11 23:00 giờ VN vẫn là ngày 7
assert.equal(upcomingReportPeriod(new Date(Date.UTC(2026, 10, 7, 17, 0))).closing, false) // 8/11 00:00 giờ VN

// ── Xu hướng + báo cáo ──────────────────────────────────────────────────────
const pt = (keyword: string, solv: number | null, arp: number | null = null): RankPoint => ({ keyword, solv, arp, atrp: null, top10: solv == null ? null : Math.min(100, solv + 20), centerRank: 3, scannedAt: '2026-11-20T00:00:00.000Z' })
assert.equal(trendOf(null, null).trend, 'none')
assert.equal(trendOf(pt('a', null), pt('a', 10)).trend, 'none')
assert.equal(trendOf(pt('a', 30), null).trend, 'new')
assert.deepEqual(trendOf(pt('a', 30, 5), pt('a', 20, 7)), { trend: 'up', solvDelta: 10, arpDelta: -2 })
assert.equal(trendOf(pt('a', 20), pt('a', 31)).trend, 'down')
assert.equal(trendOf(pt('a', 21), pt('a', 20)).trend, 'flat') // dưới 3 điểm % = đi ngang
assert.equal(trendOf(pt('a', 23), pt('a', 20)).trend, 'up') // đúng ngưỡng 3

const work = (o: Partial<WorkSummary> = {}): WorkSummary => ({ postsPublished: 0, postsPlanned: 0, reviewsNew: 0, reviewsReplied: 0, reviewsOpen: 0, tasksDone: 0, tasksOpen: 0, ...o })
const NOWD = new Date(Date.UTC(2026, 11, 2, 3, 0))
const rep = buildMonthlyReport({
  period: '2026-11', clientName: 'Quán A', now: NOWD,
  rank: [
    { keyword: 'cafe quận 1', current: pt('cafe quận 1', 40, 4), previous: pt('cafe quận 1', 30, 6) },
    { keyword: 'cafe sách', current: pt('cafe sách', 10, 9), previous: pt('cafe sách', 25, 6) },
    { keyword: 'cafe mới', current: pt('cafe mới', 20, 8), previous: null },
    { keyword: 'chưa quét', current: null, previous: null },
  ],
  work: work({ postsPublished: 8, reviewsNew: 12, reviewsReplied: 11, reviewsOpen: 1, tasksDone: 4, tasksOpen: 2, postsPlanned: 3 }),
})
assert.equal(rep.version, 1)
assert.equal(rep.periodLabel, 'Tháng 11/2026')
assert.ok(rep.rank)
assert.equal(rep.rank!.keywords.length, 4)
assert.equal(rep.rank!.improved, 1)
assert.equal(rep.rank!.declined, 1)
assert.deepEqual(rep.rank!.best, { keyword: 'cafe quận 1', solv: 40 })
assert.deepEqual(rep.rank!.worst, { keyword: 'cafe sách', solv: 10 })
assert.equal(rep.rank!.avgSolv, 23.3) // (40+10+20)/3
const hl = rep.highlights.join('\n')
assert.ok(hl.includes('8 bài') && hl.includes('11 đánh giá') && hl.includes('4 việc'), hl)
const nx = rep.nextSteps.join('\n')
assert.ok(nx.includes('cafe sách') && nx.includes('1 đánh giá') && nx.includes('2 việc') && nx.includes('3 bài'), nx)
assert.ok(rep.nextSteps.length <= 6)

// không có lưới thứ hạng / chưa quét / tháng trống: không vỡ, có lời nhắn
const noRank = buildMonthlyReport({ period: '2026-11', clientName: 'B', now: NOWD, rank: null, work: work() })
assert.equal(noRank.rank, null)
assert.ok(noRank.highlights.length >= 1 && noRank.nextSteps.length >= 1)
const unscanned = buildMonthlyReport({ period: '2026-11', clientName: 'B', now: NOWD, rank: [], work: work({ postsPublished: 1 }) })
assert.equal(unscanned.rank === null || unscanned.rank.keywords.length === 0, true)

// ── Email ───────────────────────────────────────────────────────────────────
const mail = buildMonthlyReportEmail(rep, 'https://app.example/clients/1/monthly-report?period=2026-11')
assert.ok(mail.subject.includes('11/2026') && mail.html.includes('Quán A') && mail.text.includes('https://app.example/clients/1/monthly-report'))
assert.ok(mail.text.includes('cafe quận 1'))
const evil = buildMonthlyReport({ period: '2026-11', clientName: '<script>alert(1)</script>', now: NOWD, rank: null, work: work() })
assert.ok(!buildMonthlyReportEmail(evil, 'https://x/y').html.includes('<script>'), 'tên khách phải được escape trong HTML')
const cm = buildConsultationAdminEmail({ lead: lead.ok ? lead.value : (undefined as never), workspaceName: 'WS <b>x</b>', userEmail: 'u@x.co', adminUrl: 'https://app.example/agency?tab=leads' })
assert.ok(cm.subject.length > 0 && cm.text.includes('0901234567') && cm.text.includes('https://app.example/agency?tab=leads'))
assert.ok(!cm.html.includes('<b>x</b>'), 'tên workspace phải được escape')
assert.equal(agencyDigestHasWork({ posts: 0, reviews: 0, urgentReviews: 0, tasks: 0, reportsDue: 0, leads: 0 }), false)
assert.equal(agencyDigestHasWork({ posts: 0, reviews: 0, urgentReviews: 0, tasks: 0, reportsDue: 0, leads: 1 }), true)
const dg = buildAgencyDigestEmail({ posts: 2, reviews: 3, urgentReviews: 1, tasks: 0, reportsDue: 1, leads: 1 }, 'https://app.example/agency')
assert.ok(dg.text.includes('2 bài') && dg.text.includes('3 phản hồi') && dg.text.includes('1 khẩn') && dg.text.includes('báo cáo') && dg.text.includes('https://app.example/agency'))
assert.ok(!dg.text.includes('việc tối ưu'), 'không liệt kê nhóm việc rỗng')

console.log('done-for-you: OK')
