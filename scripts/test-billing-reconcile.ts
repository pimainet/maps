// Đối soát chuyển khoản: tách mã đơn, xác thực/chuẩn hoá webhook SePay, dựng email. Không cần mạng/DB.
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { extractOrderCodes } from '../lib/billing/match'
import { verifySePay, normalizeSePay, normalizeSePayApiRow, sepayTimeToIso } from '../lib/billing/sepay'
import { alertKindFor, buildAdminAlertEmail, buildAdminDigestEmail, buildReceiptEmail, buildRenewalEmail, vnDate } from '../lib/billing/emails'

const C = 176000000001
// ---- extractOrderCodes
assert.deepEqual(extractOrderCodes('LGOS176000000001'), { candidates: [C], confidence: 'exact' })
assert.deepEqual(extractOrderCodes('NGUYEN VAN A chuyen tien LGOS176000000001 FT123'), { candidates: [C], confidence: 'exact' })
assert.deepEqual(extractOrderCodes('lgos176000000001 thanh toan goi'), { candidates: [C], confidence: 'exact' })     // chữ thường
assert.deepEqual(extractOrderCodes('Thanh toán LGOS176000000001'), { candidates: [C], confidence: 'exact' })        // có dấu
assert.deepEqual(extractOrderCodes('x', 'LGOS176000000001'), { candidates: [C], confidence: 'exact' })              // mã SePay tách sẵn
assert.deepEqual(extractOrderCodes('LGOS 176000000001'), { candidates: [C], confidence: 'tolerant' })               // chen cách sau tiền tố
assert.deepEqual(extractOrderCodes('LGOS 17600 0000 001'), { candidates: [C], confidence: 'tolerant' })             // chen cách giữa số
assert.deepEqual(extractOrderCodes('LG0S176000000001'), { candidates: [C], confidence: 'tolerant' })               // 0 thay O
assert.deepEqual(extractOrderCodes('LGOS17600000000l'), { candidates: [C], confidence: 'tolerant' })               // l thay 1
assert.deepEqual(extractOrderCodes('chuyen tien 176000000001'), { candidates: [C], confidence: 'tolerant' })       // bỏ tiền tố
assert.deepEqual(extractOrderCodes('chuyen 176-000-000-001'), { candidates: [C], confidence: 'tolerant' })
assert.deepEqual(extractOrderCodes('tien thang 12'), { candidates: [], confidence: 'tolerant' })                    // không có mã
assert.deepEqual(extractOrderCodes('LGOS17600000001'), { candidates: [], confidence: 'tolerant' })                  // thiếu 1 số => KHÔNG đoán
assert.deepEqual(extractOrderCodes('LGOS1760000000011'), { candidates: [], confidence: 'tolerant' })               // dư 1 số => KHÔNG đoán
assert.deepEqual(extractOrderCodes(null), { candidates: [], confidence: 'tolerant' })
assert.deepEqual(extractOrderCodes('LGOS176000000001 LGOS176000000002').candidates, [176000000001, 176000000002]) // 2 mã: thứ tự xuất hiện, SQL lấy mã đầu có thật

// ---- verifySePay
const secret = 'whsec_test'
const body = JSON.stringify({ id: 92704, transferType: 'in', transferAmount: 349000, accountNumber: '1017588888', content: 'LGOS176000000001', referenceCode: 'FT1', gateway: 'Vietcombank', transactionDate: '2026-11-28 10:00:00' })
const now = Date.now()
const ts = String(Math.floor(now / 1000))
const sig = 'sha256=' + crypto.createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex')
const H = (o: Record<string, string>) => ({ get: (k: string) => o[k.toLowerCase()] ?? null })
assert.deepEqual(verifySePay(body, H({ 'x-sepay-signature': sig, 'x-sepay-timestamp': ts }), { SEPAY_WEBHOOK_SECRET: secret }, now), { ok: true, mode: 'hmac' })
assert.equal((verifySePay(body + ' ', H({ 'x-sepay-signature': sig, 'x-sepay-timestamp': ts }), { SEPAY_WEBHOOK_SECRET: secret }, now) as any).reason, 'chữ ký sai')   // body bị sửa
assert.equal((verifySePay(body, H({ 'x-sepay-signature': sig, 'x-sepay-timestamp': ts }), { SEPAY_WEBHOOK_SECRET: 'khac' }, now) as any).ok, false)
assert.equal((verifySePay(body, H({ 'x-sepay-signature': sig, 'x-sepay-timestamp': ts }), { SEPAY_WEBHOOK_SECRET: secret }, now + 301_000) as any).reason, 'timestamp lệch quá 5 phút') // replay
assert.equal((verifySePay(body, H({}), { SEPAY_WEBHOOK_SECRET: secret }, now) as any).status, 401)                        // thiếu header
assert.equal((verifySePay(body, H({}), {}, now) as any).status, 503)                                                      // chưa cấu hình => đóng
assert.deepEqual(verifySePay(body, H({ authorization: 'Apikey k1' }), { SEPAY_WEBHOOK_API_KEY: 'k1' }, now), { ok: true, mode: 'apikey' })
assert.equal((verifySePay(body, H({ authorization: 'Apikey bad' }), { SEPAY_WEBHOOK_API_KEY: 'k1' }, now) as any).ok, false)

// ---- normalizeSePay
const n: any = normalizeSePay(JSON.parse(body), '1017588888')
assert.equal(n.txnId, '92704'); assert.equal(n.amount, 349000); assert.equal(n.transferredAt, '2026-11-28T10:00:00+07:00')
assert.deepEqual(normalizeSePay({ ...JSON.parse(body), transferType: 'out' }, '1017588888'), { skip: 'not_incoming' })
assert.deepEqual(normalizeSePay(JSON.parse(body), '999'), { skip: 'other_account' })
assert.deepEqual(normalizeSePay({ ...JSON.parse(body), transferAmount: -5 }, '1017588888'), { skip: 'bad_amount' })
assert.deepEqual(normalizeSePay({ ...JSON.parse(body), transferAmount: 10.5 }, '1017588888'), { skip: 'bad_amount' })

// ---- normalizeSePayApiRow (đối soát bù qua API)
const row = { id: '48673', transaction_date: '2026-11-28 11:59:47', account_number: '1017588888', amount_in: '349000.00', amount_out: '0.00', code: null, transaction_content: 'LGOS176000000001', reference_number: '731086.281126.120001', bank_brand_name: 'Vietcombank' }
const nr: any = normalizeSePayApiRow(row, '1017588888')
assert.equal(nr.txnId, '48673'); assert.equal(nr.amount, 349000); assert.equal(nr.bankRef, '731086.281126.120001'); assert.equal(nr.transferredAt, '2026-11-28T11:59:47+07:00')
assert.deepEqual(normalizeSePayApiRow({ ...row, amount_in: '0.00', amount_out: '5000.00' }, '1017588888'), { skip: 'not_incoming' })
assert.deepEqual(normalizeSePayApiRow({ ...row, amount_in: '349000.50' }, '1017588888'), { skip: 'bad_amount' })
assert.deepEqual(normalizeSePayApiRow(row, '0000'), { skip: 'other_account' })
assert.equal(sepayTimeToIso('bad'), null)
// webhook và API cùng id => SQL coi là một (UNIQUE provider + provider_txn_id)
assert.equal((normalizeSePay({ ...JSON.parse(body), id: 48673 }, '1017588888') as any).txnId, nr.txnId)

// ---- alertKindFor
assert.equal(alertKindFor('matched', null), null)
assert.equal(alertKindFor('matched', 'overpaid:51000'), 'overpaid')
assert.equal(alertKindFor('partial', 'underpaid:150000'), 'underpaid')
assert.equal(alertKindFor('unmatched', 'no_code'), 'unmatched')
assert.equal(alertKindFor('needs_review', 'order_already_paid'), 'needs_review')
assert.equal(alertKindFor('duplicate_webhook', null), null)

// ---- emails
assert.equal(vnDate('2026-11-28T18:30:00Z'), '29/11/2026') // 01:30 giờ VN hôm sau
const rc = buildReceiptEmail({ workspaceName: 'Tiệm <A>', receiptNo: 'BN2026000001', orderCode: C, plan: 'basic', periodMonths: 1, amountVnd: 349000, paidVnd: 400000, overpaidVnd: 51000, paidAt: '2026-11-28T03:00:00Z', result: 'activated', periodStart: '2026-11-28T03:00:00Z', periodEnd: '2026-12-28T03:00:00Z', billingUrl: 'https://x/billing' })
assert.match(rc.subject, /BN2026000001/)
assert.match(rc.text, /Đã kích hoạt gói Khởi động, dùng đến hết ngày 28\/12\/2026/)
assert.match(rc.text, /chuyển dư 51\.000đ/)
assert.ok(rc.html.includes('Tiệm &lt;A&gt;') && !rc.html.includes('<A>'), 'tên workspace phải được escape')
const sc = buildReceiptEmail({ workspaceName: 'B', receiptNo: null, orderCode: C, plan: 'full', periodMonths: 3, amountVnd: 2277150, paidVnd: 2277150, overpaidVnd: 0, paidAt: '2026-11-28T03:00:00Z', result: 'scheduled', periodStart: '2026-12-20T00:00:00Z', periodEnd: '2027-03-20T00:00:00Z', billingUrl: 'https://x/billing' })
assert.match(sc.text, /Gói Nâng cao sẽ bắt đầu từ 20\/12\/2026/)
assert.ok(!/chuyển dư/.test(sc.text))
const r7 = buildRenewalEmail({ workspaceName: 'A', plan: 'basic', periodEnd: '2026-12-05T03:00:00Z', kind: 'd7', renewUrl: 'https://x/billing?renew=1' })
assert.match(r7.subject, /hết hạn sau 7 ngày \(05\/12\/2026\)/)
const rx = buildRenewalEmail({ workspaceName: 'A', plan: 'full', periodEnd: '2026-12-05T03:00:00Z', kind: 'expired', renewUrl: 'u' })
assert.match(rx.text, /đến hết ngày 08\/12\/2026/) // + 3 ngày ân hạn
assert.match(buildRenewalEmail({ workspaceName: 'A', plan: 'full', periodEnd: '2026-12-05T03:00:00Z', kind: 'downgraded', renewUrl: 'u' }).subject, /Miễn phí/)
const ao = buildAdminAlertEmail({ kind: 'overpaid', amountVnd: 400000, content: 'LGOS176000000001', orderCode: C, reason: 'overpaid:51000', adminUrl: 'https://x/billing/admin' })
assert.match(ao.text, /Phần dư cần hoàn tay: 51\.000đ/)
assert.match(buildAdminAlertEmail({ kind: 'underpaid', amountVnd: 200000, content: 'x', orderCode: C, reason: 'underpaid:149000', adminUrl: 'u' }).text, /Còn thiếu 149\.000đ/)
assert.match(buildAdminAlertEmail({ kind: 'unmatched', amountVnd: 5000, content: '', orderCode: null, reason: 'no_code', adminUrl: 'u' }).text, /không tìm thấy[\s\S]*Lý do: no_code/)
assert.match(buildAdminDigestEmail({ count: 2, totalVnd: 405000, oldestAt: '2026-11-27T03:00:00Z', adminUrl: 'u' }).subject, /2 khoản/)

console.log('billing reconcile (match/sepay/emails): ALL OK')
