/**
 * Test các script chạy trong trang Maps bằng jsdom + DOM giả lập.
 *
 * CHÚ Ý: fixture là DOM do mình dựng theo cấu trúc Maps đã biết (data-item-id, aria-label, data-review-id...),
 * KHÔNG phải trang Maps thật. Test này chỉ chứng minh logic/cú pháp script đúng; selector có khớp Maps thật
 * hay không phải kiểm bằng cách chạy agent trên vài hồ sơ thật (xem coverage trong gbp_snapshots).
 *
 * Chạy:  npm i -D jsdom typescript && node scripts/test-gbp-scripts.mjs
 */
import { JSDOM } from 'jsdom'
import { execSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const out = mkdtempSync(join(tmpdir(), 'gbp-'))
execSync(`npx tsc lib/gbp-maps-scripts.ts lib/gbp-relative-time.ts --outDir ${out} --module commonjs --target es2020 --skipLibCheck`, { stdio: 'inherit' })
const require = createRequire(import.meta.url)
const S = require(join(out, 'gbp-maps-scripts.js'))
const { parseRelativeAgeDays } = require(join(out, 'gbp-relative-time.js'))

const html = `
<div role="main">
  <h1>Nội Thất ABC - Showroom Cầu Giấy</h1>
  <div><span role="img" aria-label="4,6 sao"></span><span aria-label="1.234 bài đánh giá">(1.234)</span></div>
  <button jsaction="pane.rating.category">Cửa hàng nội thất</button>
  <button data-item-id="address" aria-label="Địa chỉ: 12 Trần Thái Tông, Cầu Giấy, Hà Nội">12 Trần Thái Tông</button>
  <button data-item-id="phone:tel:0901234567" aria-label="Điện thoại: 0901 234 567">0901 234 567</button>
  <a data-item-id="authority" href="https://noithatabc.vn/">noithatabc.vn</a>
  <a data-item-id="menu" href="https://noithatabc.vn/bang-gia" aria-label="Bảng giá: noithatabc.vn/bang-gia">Bảng giá</a>
  <a data-item-id="action:4" href="https://book.example/abc" aria-label="Đặt lịch hẹn">Đặt lịch</a>
  <div data-item-id="oh"><span>Đang mở cửa</span>
    <table>
      <tr><td>Thứ Hai</td><td>08:00–17:30</td></tr>
      <tr><td>Thứ Ba</td><td>08:00–17:30</td></tr>
      <tr><td>Thứ Tư</td><td>08:00–17:30</td></tr>
      <tr><td>Thứ Năm</td><td>08:00–17:30</td></tr>
      <tr><td>Thứ Sáu</td><td>08:00–17:30</td></tr>
      <tr><td>Thứ Bảy</td><td>08:00–12:00</td></tr>
      <tr><td>Chủ Nhật</td><td>Đóng cửa</td></tr>
    </table>
  </div>
  <a data-item-id="merchant" href="#">Nhận quyền sở hữu doanh nghiệp này</a>
  <div role="tablist">
    <button role="tab" aria-selected="true" aria-label="Tổng quan">Tổng quan</button>
    <button role="tab" aria-label="Giới thiệu">Giới thiệu</button>
    <button role="tab" aria-label="Bài đánh giá">Bài đánh giá</button>
  </div>
  <h2>Dịch vụ</h2><ul><li aria-label="Giao hàng tận nơi">Giao hàng tận nơi</li><li>Lắp đặt miễn phí</li></ul>
  <h2>Thanh toán</h2><ul><li>Thẻ tín dụng</li><li>Chuyển khoản</li><li>Thẻ tín dụng</li></ul>
  <h2>Trống</h2>
  <table><tr role="img" aria-label="5 sao, 900 bài đánh giá"></tr><tr aria-label="4 sao, 200 bài đánh giá"></tr><tr aria-label="3 sao, 70 bài đánh giá"></tr><tr aria-label="2 sao, 30 bài đánh giá"></tr><tr aria-label="1 sao, 34 bài đánh giá"></tr></table>

  <div data-review-id="r1">
    <div>Nguyễn Văn A</div><div>Local Guide · 12 bài đánh giá</div>
    <span role="img" aria-label="5 sao"></span><span>2 tuần trước</span>
    <div><span>Showroom đẹp, nhân viên tư vấn nhiệt tình, giao hàng đúng hẹn.</span><button aria-label="Xem thêm">Xem thêm</button></div>
    <div><button>Thích</button><button>Chia sẻ</button></div>
    <div><span>Phản hồi từ chủ sở hữu</span><span>1 tuần trước</span><div>Cảm ơn anh A đã tin tưởng ABC!</div></div>
  </div>
  <div data-review-id="r2">
    <div>Trần B</div>
    <span role="img" aria-label="2 sao"></span><span>3 tháng trước</span>
    <div><span>Giao hàng trễ hai tuần, gọi hotline không ai nghe máy.</span></div>
  </div>
  <div data-review-id="r3"><div>C</div><span role="img" aria-label="4 sao"></span><span>một năm trước</span></div>
</div>`

const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://www.google.com/maps/place/x' })
const { window } = dom
// jsdom không có innerText -> polyfill: xuống dòng quanh các thẻ khối (giống trình duyệt thật)
const BLOCK = new Set(['DIV','P','LI','TR','H1','H2','H3','UL','TABLE','BUTTON','A'])
function it(el) {
  let s = ''
  el.childNodes.forEach((n) => {
    if (n.nodeType === 3) s += n.data
    else if (n.nodeType === 1) s += (BLOCK.has(n.tagName) ? '\n' : n.tagName === 'TD' ? '\t' : '') + it(n) + (BLOCK.has(n.tagName) ? '\n' : '')
  })
  return s.replace(/\n\s*\n+/g, '\n').replace(/^\n+/, '')
}
Object.defineProperty(window.HTMLElement.prototype, 'innerText', { get() { return it(this) } })

const run = (src, arg) => window.eval(`(${src})(${JSON.stringify(arg ?? null)})`)
let fail = 0
const ok = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) fail++ }

const state = await run(S.PANEL_STATE)
ok(state.h1?.startsWith('Nội Thất ABC') && state.hasPlaceFacts && state.tabs.length === 3, 'PANEL_STATE: h1, hasPlaceFacts, 3 tab')

const f = await run(S.FACTS)
ok(f.rating === 4.6 && f.review_count === 1234, `FACTS rating/count (${f.rating}, ${f.review_count})`)
ok(f.category === 'Cửa hàng nội thất', 'FACTS category')
ok(f.address === '12 Trần Thái Tông, Cầu Giấy, Hà Nội', `FACTS address (${f.address})`)
ok(f.phone === '0901 234 567', `FACTS phone (${f.phone})`)
ok(f.website === 'https://noithatabc.vn/', 'FACTS website')
ok(f.claim_signal === 'unclaimed', 'FACTS claim_signal unclaimed')
ok(f.action_links.length === 2 && f.action_links.some((l) => l.kind === 'menu') && f.action_links.some((l) => l.kind === 'booking'), `FACTS action_links ${JSON.stringify(f.action_links.map((l) => l.kind))}`)
ok(f.business_status === null, 'FACTS business_status null khi không có banner đóng cửa')

const hr = await run(S.HOURS)
ok(hr.hours && hr.strategy === 'table' && hr.hours.split(' | ').length === 7 && hr.hours.startsWith('Thứ Hai: 08:00–17:30'), `HOURS table 7 ngày (${hr.strategy})`)
ok(hr.today === 'Đang mở cửa', `HOURS today = "${hr.today}"`)

// Chiến lược B: không có bảng, giờ nằm trong aria-label
const mkDom = (inner) => {
  const d = new JSDOM('<div role="main"><h1>X</h1>' + inner + '</div>', { runScripts: 'outside-only' })
  Object.defineProperty(d.window.HTMLElement.prototype, 'innerText', { get() { return it(this) } })
  return (src, arg) => d.window.eval('(' + src + ')(' + JSON.stringify(arg ?? null) + ')')
}
{
  const r2 = mkDom('<div data-item-id="oh" aria-label="Chủ Nhật, 08:00 đến 17:00; Thứ Hai, 08:00 đến 17:00; Thứ Ba, 08:00 đến 17:00; Thứ Tư, Đóng cửa; Ẩn giờ mở cửa trong tuần">Đang mở cửa ⋅ Đóng cửa lúc 17:00</div>')
  const h = await r2(S.HOURS)
  ok(h.strategy === 'aria' && h.hours.startsWith('Chủ Nhật: 08:00–17:00') && h.hours.includes('Thứ Tư: Đóng cửa') && !/Ẩn giờ/.test(h.hours), `HOURS aria-label (${h.strategy}): ${h.hours}`)
  ok(h.today === 'Đang mở cửa ⋅ Đóng cửa lúc 17:00', `HOURS today từ aria case (${h.today})`)
  const en = mkDom('<div data-item-id="oh" aria-label="Monday, 9 AM to 5 PM; Tuesday, 9 AM to 5 PM; Wednesday, Closed; Hide open hours for the week"></div>')
  const he = await en(S.HOURS)
  ok(he.strategy === 'aria' && he.hours === 'Monday: 9 AM–5 PM | Tuesday: 9 AM–5 PM | Wednesday: Closed', `HOURS aria tiếng Anh: ${he.hours}`)
}
// Chiến lược C: dòng chữ
{
  const r3 = mkDom('<div data-item-id="oh"><div>Đóng cửa</div><div>Mở cửa lúc 08:00</div><div>Thứ Hai</div><div>08:00–17:00</div><div>Thứ Ba</div><div>08:00–17:00</div><div>Thứ Tư</div><div>08:00–17:00</div></div>')
  const h = await r3(S.HOURS)
  ok(h.strategy === 'text' && h.hours === 'Thứ Hai: 08:00–17:00 | Thứ Ba: 08:00–17:00 | Thứ Tư: 08:00–17:00', `HOURS text (${h.strategy}): ${h.hours}`)
  ok(h.today === 'Đóng cửa ⋅ Mở cửa lúc 08:00', `HOURS today (${h.today})`)
}
// Không có giờ -> null, không bịa
{
  const r4 = mkDom('<div>Không có gì</div>')
  const h = await r4(S.HOURS)
  ok(h.hours === null && h.today === null, 'HOURS không có dữ liệu -> null')
}
// OPEN_HOURS: bấm khi gập, không bấm khi đã mở
{
  const d = new JSDOM('<div role="main"><h1>X</h1><div data-item-id="oh"><button aria-expanded="false" id="b">Giờ</button></div></div>', { runScripts: 'outside-only' })
  let clicked = 0
  d.window.document.getElementById('b').addEventListener('click', () => { clicked++ })
  const r = (src) => d.window.eval('(' + src + ')(null)')
  const a1 = await r(S.OPEN_HOURS)
  ok(a1 && clicked === 1, 'OPEN_HOURS bấm nút gập')
  d.window.document.getElementById('b').setAttribute('aria-expanded', 'true')
  d.window.document.querySelector('[data-item-id="oh"]').setAttribute('aria-expanded', 'true')
  const a2 = await r(S.OPEN_HOURS)
  ok(clicked === 1 && a2 === null, 'OPEN_HOURS không bấm lại khi đã mở')
}
// ABOUT_DESC
{
  const r5 = mkDom('<div role="tablist"><button role="tab">Tổng quan</button><button role="tab" aria-selected="true">Giới thiệu</button></div><div><div>Chúng tôi chuyên thiết kế và thi công nội thất trọn gói cho căn hộ, văn phòng tại Hà Nội từ năm 2012.</div></div><h2>Dịch vụ</h2><ul><li>Thiết kế một đoạn văn bản rất dài để thử loại trừ danh sách khỏi mô tả chính xác</li></ul>')
  const c = await r5(S.ABOUT_DESC)
  ok(c.length === 1 && c[0].startsWith('Chúng tôi chuyên thiết kế'), `ABOUT_DESC chọn đúng mô tả, loại ul/tab (${c.length})`)
}
// TARGET_SELECTED + MARK fallback ra ngoài main
{
  const d = new JSDOM('<div role="tablist"><button role="tab" aria-selected="false" aria-label="Giới thiệu">Giới thiệu</button></div><div role="main"><h1>X</h1></div>', { runScripts: 'outside-only' })
  const r = (src, arg) => d.window.eval('(' + src + ')(' + JSON.stringify(arg ?? null) + ')')
  const lab = await r(S.MARK, { css: '[role="tab"]', pattern: 'Giới thiệu|About' })
  ok(lab === 'Giới thiệu', 'MARK tìm được tab nằm ngoài div[role=main]')
  ok((await r(S.TARGET_SELECTED)) === 'false', 'TARGET_SELECTED đọc aria-selected')
}

const attrs = await run(S.ATTRIBUTES)
const pay = attrs.find((g) => g.group === 'Thanh toán')
ok(attrs.length === 2 && pay && pay.items.length === 2, `ATTRIBUTES 2 nhóm, khử trùng lặp, bỏ nhóm rỗng (${JSON.stringify(attrs.map((g) => g.group + ':' + g.items.length))})`)

const dist = await run(S.RATING_DIST)
ok(dist && dist['5'] === 900 && dist['1'] === 34, 'RATING_DIST')

const mk = await run(S.MARK, { css: '[role="tab"]', pattern: 'Bài đánh giá|Reviews' })
ok(mk === 'Bài đánh giá' && window.document.querySelector('[data-gbp-target="1"]').textContent.trim() === 'Bài đánh giá', 'MARK tab Bài đánh giá')
ok((await run(S.MARK, { css: '[role="tab"]', pattern: '^(Cập nhật|Updates)' })) === null, 'MARK trả null khi không có tab Cập nhật')

const exp = await run(S.EXPAND_MORE, { scopeCss: 'div[data-review-id]' })
ok(exp === 1, `EXPAND_MORE bấm ${exp} nút`)

const rv = await run(S.REVIEWS, { max: 30 })
ok(rv.length === 3, `REVIEWS đọc ${rv.length} review, không nhân đôi do wrapper lồng`)
ok(rv[0].rating === 5 && rv[0].relative_time === '2 tuần trước', `REVIEWS[0] sao + ngày (${rv[0].rating}, ${rv[0].relative_time})`)
ok(rv[0].text.startsWith('Showroom đẹp'), `REVIEWS[0] text đúng, không lẫn tên/"Xem thêm" (${rv[0].text})`)
ok(rv[0].reply === 'Cảm ơn anh A đã tin tưởng ABC!' && rv[0].reply_relative_time === '1 tuần trước', `REVIEWS[0] phản hồi chủ tách riêng (${rv[0].reply})`)
ok(rv[1].rating === 2 && rv[1].reply === null && rv[1].text.startsWith('Giao hàng trễ'), 'REVIEWS[1] review thấp sao, chưa có phản hồi')
ok(rv[2].rating === 4 && rv[2].text === '' && rv[2].relative_time === 'một năm trước', 'REVIEWS[2] chỉ có sao, không chữ')

const ph = await run(S.PHOTOS_INFO)
ok(Array.isArray(ph.chips), 'PHOTOS_INFO không lỗi')

// Thời gian tương đối
const cases = [['2 tuần trước', 14], ['3 tháng trước', 90], ['một năm trước', 365], ['a month ago', 30], ['Đã chỉnh sửa 3 tuần trước', 21], ['hôm qua', 1], ['5 giờ trước', 0], ['abc', null]]
for (const [t, exp2] of cases) ok(parseRelativeAgeDays(t) === exp2, `parseRelativeAgeDays("${t}") = ${parseRelativeAgeDays(t)}`)

console.log(fail ? `\n${fail} test FAIL` : '\nTất cả PASS')
process.exit(fail ? 1 : 0)
