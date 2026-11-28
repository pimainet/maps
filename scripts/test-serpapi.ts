// Mapping SerpApi / SearchApi -> dạng chuẩn (hàm thuần, dùng response mẫu trong scripts/fixtures).  npx tsx scripts/test-serpapi.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseSerpPlace, parseSerpPosts, parseSerpReviews } from '../lib/gbp-serpapi'
import { parseSearchApiPlace, parseSearchApiReviews } from '../lib/gbp-searchapi'
import { parseAbsoluteDate, parseAnyDate, statusFromOpenState, extensionsToGroups, postIsDated } from '../lib/gbp-extra-parse'

const NOW = Date.parse('2026-11-16T00:00:00Z')
const fx = (name: string) => JSON.parse(readFileSync(join(__dirname, 'fixtures', name), 'utf8'))

// ---- ngày ----
assert.equal(new Date(parseAbsoluteDate('2025-01-14T19:45:18Z', NOW)!).toISOString(), '2025-01-14T19:45:18.000Z')
assert.equal(new Date(parseAbsoluteDate('Jan 14, 2025', NOW)!).toISOString().slice(0, 10), '2025-01-14')
assert.equal(new Date(parseAbsoluteDate('14 thg 9, 2026', NOW)!).toISOString().slice(0, 10), '2026-09-14')
assert.equal(new Date(parseAbsoluteDate('14 tháng 9, 2026', NOW)!).toISOString().slice(0, 10), '2026-09-14')
assert.equal(new Date(parseAbsoluteDate('05/11/2026', NOW)!).toISOString().slice(0, 10), '2026-11-05', 'ngày/tháng/năm kiểu VN')
assert.equal(new Date(parseAbsoluteDate('Dec 20', NOW)!).toISOString().slice(0, 10), '2025-12-20', 'thiếu năm, không được ở tương lai')
assert.equal(parseAbsoluteDate('4 days ago', NOW), null)
assert.equal(parseAnyDate('4 ngày trước', NOW)!.exact, false)
assert.equal(Math.round((NOW - parseAnyDate('a week ago', NOW)!.ms) / 86_400_000), 7)
assert.equal(parseAnyDate('hôm kia lúc nào', NOW), null, 'không đoán')

// ---- SerpApi place ----
const sp = parseSerpPlace(fx('serpapi-place.json'), NOW)!
assert.equal(sp.provider, 'serpapi')
assert.equal(sp.place_id, 'ChIJ_x1234567')
assert.equal(sp.data_id, '0x3136b1:0x9a1b2c')
assert.equal(sp.description, 'Sửa chữa, vệ sinh điều hòa tại nhà ở Sầm Sơn.')
assert.deepEqual(sp.types, ['Cửa hàng điện máy', 'Thợ điện lạnh', 'Dịch vụ sửa chữa thiết bị'])
assert.equal(sp.posts!.length, 2, 'bài rỗng bị bỏ')
assert.equal(sp.posts![0].text, 'Khuyến mãi vệ sinh điều hòa — Giảm 20% đến hết tháng 11.')
assert.equal(sp.posts![0].approx_date, '2 tuần trước', 'ngày tương đối giữ dạng tương đối')
assert.equal(sp.posts![0].posted_at, null, 'ngày tương đối không bịa ISO')
assert.equal(sp.posts![1].posted_at!.slice(0, 10), '2026-09-14', 'ngày tiếng Việt "14 thg 9, 2026" đọc được')
assert.ok(sp.posts!.every(postIsDated))
assert.match(sp.opening_hours!, /^Thứ Hai: 07:30–17:30; Thứ Ba: 07:30–17:30; Chủ Nhật: Đóng cửa$/)
assert.equal(sp.business_status, 'operational')
assert.equal(sp.claim_signal, null, 'không có unclaimed_listing = không có tín hiệu')
const groups = Object.fromEntries(sp.attributes!.map((g) => [g.group, g.items]))
assert.deepEqual(groups['Thanh toán'], ['Thẻ ghi nợ', 'Thanh toán di động qua NFC'], 'unsupported_extensions (Thẻ tín dụng) bị bỏ')
assert.deepEqual(groups['Tuỳ chọn dịch vụ'], ['Dịch vụ tại chỗ', 'Hẹn trực tuyến'], 'chỉ lấy service_options = true')
assert.deepEqual(sp.rating_distribution, { '1': 3, '2': 1, '3': 4, '4': 18, '5': 100 })
assert.deepEqual(sp.action_links.map((a) => a.kind), ['menu', 'booking'])
assert.equal(sp.questions_answers![0].question, 'Có làm chủ nhật không?')
assert.equal(sp.questions_answers![0].question_age_days, 150)
assert.equal(parseSerpPlace({}, NOW), null)
const noKeys = parseSerpPlace({ place_results: { place_id: 'x', unclaimed_listing: true, open_state: 'Đóng cửa vĩnh viễn' } }, NOW)!
assert.equal(noKeys.posts, null, 'không có khóa posts = chưa biết')
assert.equal(noKeys.attributes, null)
assert.equal(noKeys.questions_answers, null)
assert.equal(noKeys.claim_signal, 'unclaimed')
assert.equal(noKeys.business_status, 'permanently_closed')
assert.equal(statusFromOpenState('Temporarily closed'), 'temporarily_closed')
assert.equal(statusFromOpenState(''), null)
assert.equal(extensionsToGroups(undefined, undefined), null)

// ---- SerpApi reviews ----
const sr = parseSerpReviews(fx('serpapi-reviews.json'), NOW)!
assert.equal(sr.reply_known, true)
assert.equal(sr.place_id, 'ChIJ_x1234567')
assert.equal(sr.items.length, 6, 'review không có sao bị bỏ')
assert.equal(sr.items.filter((r) => r.reply).length, 3)
assert.equal(sr.items[0].reply, 'Cảm ơn anh đã tin tưởng!')
assert.equal(sr.items[0].reply_relative_time, '1 ngày trước')
assert.equal(sr.items[0].posted_at, '2026-11-13T02:00:00.000Z')
assert.equal(sr.items[0].age_days_est, 2)
assert.ok(sr.items[0].key && sr.items[0].key !== sr.items[1].key)
assert.equal(sr.items[4].reply_relative_time, null, 'phản hồi không có ngày -> không bịa ngày')

// ---- SerpApi posts engine ----
const posts = parseSerpPosts(fx('serpapi-posts.json'), NOW)!
assert.equal(posts.length, 2)
assert.equal(posts[0].posted_at, '2026-11-02T08:15:00.000Z')
assert.equal(posts[0].approx_date, '2 tuần trước')
assert.equal(parseSerpPosts({}, NOW), null)
assert.deepEqual(parseSerpPosts({ posts: [] }, NOW), [])

// ---- SearchApi place ----
const sa = parseSearchApiPlace(fx('searchapi-place.json'), NOW)!
assert.equal(sa.provider, 'searchapi')
assert.equal(sa.description, 'Mô tả từ SearchApi')
assert.deepEqual(sa.types, ['Cửa hàng điện máy', 'Thợ điện lạnh'])
assert.equal(sa.posts![0].text, 'Khuyến mãi vệ sinh điều hòa — Giảm 20% đến hết tháng 11.')
assert.equal(sa.posts![0].approx_date, '4 ngày trước', '"4 ngày trước" đọc được (bản cũ dùng Date.parse nên mất ngày)')
assert.match(sa.opening_hours!, /Thứ Hai: 07:30–17:30/)
assert.deepEqual(sa.attributes, [{ group: 'Hỗ trợ tiếp cận', items: ['Có lối vào cho người dùng xe lăn'] }])
assert.deepEqual(sa.rating_distribution, { '1': 3, '2': 1, '3': 4, '4': 18, '5': 100 })
assert.equal(sa.questions_answers!.length, 1, 'Q&A dạng object (không phải mảng) vẫn đọc được')
assert.equal(sa.data_id, '0x3136b1:0x9a1b2c')

// ---- SearchApi reviews ----
const sar = parseSearchApiReviews(fx('searchapi-reviews.json'), NOW)!
assert.equal(sar.items.length, 6)
assert.equal(sar.reply_known, false, 'không thấy phản hồi nào -> không kết luận "chưa phản hồi"')
const sar2 = parseSearchApiReviews({ reviews: [{ rating: 5, text: 'x', iso_date: '2026-11-10T00:00:00Z', response: { text: 'cảm ơn' } }] }, NOW)!
assert.equal(sar2.reply_known, true)
assert.equal(sar2.items[0].reply, 'cảm ơn')

console.log('OK: SerpApi/SearchApi mapping (place, reviews + phản hồi, posts, ngày VN/EN, thuộc tính, Q&A)')
