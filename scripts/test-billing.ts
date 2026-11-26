// Gói, giá, cắt nội dung theo gói, mã đơn: thuần logic, không DB.
import assert from 'node:assert/strict'
import { ENTITLEMENTS, resolveEffectivePlan, parseOrderCode, priceFor, transferContent, isPaidPlan, isPeriod } from '../lib/billing/plans'
import { limitActionsInText, limitPlanText, shapeAuditPayload, shapeReport } from '../lib/billing/shape'
import { newOrderCode, readBankInfo, vietQrUrl } from '../lib/billing/orders'

// giá: server tính, làm tròn nghìn
assert.equal(priceFor('basic', 1), 349_000)
assert.equal(priceFor('full', 1), 799_000)
assert.equal(priceFor('full', 3), 2_277_000)   // 799k*3*0.95 = 2,277,150 -> 2,277,000
assert.equal(priceFor('full', 12), 8_150_000)  // 799k*12*0.85 = 8,149,800 -> 8,150,000
assert.ok(isPaidPlan('basic') && !isPaidPlan('free') && !isPaidPlan('x'))
assert.ok(isPeriod(3) && !isPeriod(2))

// mã đơn + nội dung chuyển khoản
const code = newOrderCode(1_700_000_000_000, 0.42)
assert.equal(code, 170000000042)
assert.equal(transferContent(code), 'LGOS170000000042')
assert.equal(parseOrderCode('chuyen tien lgos 170000000042 cam on'), 170000000042)
assert.equal(parseOrderCode('khong co ma'), null)

// ngân hàng + QR
assert.equal(readBankInfo({}), null)
const bank = readBankInfo({ BILLING_BANK_ID: 'ACB', BILLING_ACCOUNT_NO: '123', BILLING_ACCOUNT_NAME: 'NGUYEN VAN A' })!
const url = vietQrUrl(bank, 349000, code)
assert.ok(url.includes('/ACB-123-compact2.png') && url.includes('amount=349000') && url.includes('LGOS170000000042'))

// cắt việc trong audit
const text = ['### 4. x', '- a', '### 5. Việc cần làm ngay (7–14 ngày tới)', '- v1', '- v2', '- v3', '- v4', '- v5', '', '### 6. Định hướng', '- giữ nguyên'].join('\n')
const l = limitActionsInText(text, 3)
assert.equal(l.locked, 2)
assert.ok(l.text.includes('- v3') && !l.text.includes('- v4') && l.text.includes('- giữ nguyên') && l.text.includes('- a'))
assert.equal(limitActionsInText(text, null).text, text)

// cắt lời khuyên: free mất secondary + drafts nhưng giữ primary
const report: any = { topOpportunities: [1, 2, 3, 4, 5], advice: { primary: { verdict: 'consider' }, secondary: { current: ['x'], suggested: [{}, {}] }, drafts: [{}], description: {} } }
const s = shapeReport(report, ENTITLEMENTS.free)
assert.equal(s.report!.advice.secondary.suggested.length, 0)
assert.equal(s.report!.advice.drafts.length, 0)
assert.equal(s.report!.advice.primary.verdict, 'consider')
assert.equal(s.report!.topOpportunities.length, 3)
assert.deepEqual(s.locked, { secondary: 2, drafts: 1 })
assert.equal(shapeReport(report, ENTITLEMENTS.basic).report!.advice.drafts.length, 1)
assert.equal(report.advice.drafts.length, 1) // không sửa bản gốc

const p = shapeAuditPayload({ audit_result: text, report }, ENTITLEMENTS.free, 'free')
assert.deepEqual(p.locks, { plan: 'free', locked_actions: 2, locked_secondary: 2, locked_drafts: 1 })

// kế hoạch 30 ngày
const plan = '### 1. Mục tiêu\nA\n**Tuần 1 – x:**\n- a\n**Tuần 2 – y:**\n- b\n**Tuần 3**'
const lp = limitPlanText(plan, ENTITLEMENTS.free)
assert.ok(lp.locked && lp.text.includes('Tuần 1') && !lp.text.includes('Tuần 2') && !lp.text.includes('- b'))
assert.equal(limitPlanText(plan, ENTITLEMENTS.full).text, plan)

// gói hiệu lực (dùng cho getPlanState và cron review-watch)
{
  const now = Date.parse('2026-11-20T00:00:00Z')
  const end = (iso: string) => ({ current_period_end: iso })
  assert.equal(resolveEffectivePlan('free', null, now), 'free')
  assert.equal(resolveEffectivePlan('full', end('2026-12-01T00:00:00Z'), now), 'full')       // còn hạn
  assert.equal(resolveEffectivePlan('full', end('2026-11-18T00:00:00Z'), now), 'full')       // hết hạn 2 ngày: còn trong ân hạn 3 ngày
  assert.equal(resolveEffectivePlan('full', end('2026-11-10T00:00:00Z'), now), 'free')       // quá ân hạn mà cron chưa hạ
  assert.equal(resolveEffectivePlan('basic', null, now), 'basic')                            // không có kỳ active: giữ nguyên
  assert.equal(resolveEffectivePlan('agency', null, now), 'full')                            // gói thủ công = đầy đủ
  assert.equal(resolveEffectivePlan(undefined, null, now), 'free')
  assert.equal(resolveEffectivePlan(null, end('2020-01-01T00:00:00Z'), now), 'free')
  // chỉ gói Nâng cao có monitoring
  assert.equal(ENTITLEMENTS[resolveEffectivePlan('free', null, now)].monitoring, false)
  assert.equal(ENTITLEMENTS[resolveEffectivePlan('basic', null, now)].monitoring, false)
  assert.equal(ENTITLEMENTS[resolveEffectivePlan('full', end('2026-12-01T00:00:00Z'), now)].monitoring, true)
}

console.log('billing: OK')
