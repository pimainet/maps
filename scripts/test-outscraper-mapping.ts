// Chạy: npx tsx scripts/test-outscraper-mapping.ts
// Fixture mô phỏng response Outscraper. TÊN TRƯỜNG ĐÃ XÁC MINH từ tài liệu công khai: name, type, subtypes, rating, reviews,
// phone, website, address, business_status, working_hours, about, description, verified, photos_count, reviews_per_score_N,
// reservation_links, menu_link, review_text, review_rating, review_datetime_utc.
// CHƯA xác minh (suy đoán, mapper có tên dự phòng): owner_answer*, posts, review_timestamp, author_title.
// => Khi có API key thật, chạy 1 request và so lại fixture này.
import assert from 'node:assert/strict'
import { mapOutscraperToPayload, parseOutscraperDate, mapReviews } from '../lib/gbp-outscraper'

const NOW = Date.UTC(2026, 10, 13, 0, 0, 0)
const place = {
  name: 'Tiệm Nail Hoa',
  place_id: 'ChIJxyz',
  type: 'Tiệm làm móng',
  subtypes: 'Tiệm làm móng, Spa chăm sóc da, Tiệm làm tóc',
  rating: 4.6,
  reviews: 128,
  phone: '+84 90 123 4567',
  website: 'https://nailhoa.vn',
  address: '12 Lê Lợi, Q1, TP.HCM',
  business_status: 'OPERATIONAL',
  verified: true,
  photos_count: 54,
  working_hours: { Monday: '9AM-7PM', Tuesday: '9AM-7PM', Sunday: 'Closed' },
  about: { 'Tùy chọn dịch vụ': { 'Đặt lịch hẹn': true, 'Giao hàng': false }, 'Thanh toán': { 'Thẻ tín dụng': true } },
  description: 'Tiệm nail chăm sóc tận tâm.',
  reviews_per_score_1: 3, reviews_per_score_2: 2, reviews_per_score_3: 5, reviews_per_score_4: 18, reviews_per_score_5: 100,
  booking_appointment_link: 'https://nailhoa.vn/book',
  location_link: 'https://www.google.com/maps/place/?q=place_id:ChIJxyz',
}
const reviewsPlace = {
  reviews_data: [
    { review_rating: 5, review_text: 'Rất đẹp', review_datetime_utc: '11/10/2026 08:00:00', author_title: 'A', owner_answer: 'Cảm ơn bạn' },
    { review_rating: 2, review_text: 'Chờ lâu quá', review_datetime_utc: '11/12/2026 08:00:00', author_title: 'B', owner_answer: null },
    { review_rating: 4, review_text: '', review_datetime_utc: '08/01/2026 08:00:00', author_title: 'C', owner_answer: null },
  ],
}

// 1) Mapping đầy đủ
const m = mapOutscraperToPayload(place, reviewsPlace, { claimedName: 'Nail Hoa', now: NOW })
assert.equal(m.business_name, 'Tiệm Nail Hoa')
assert.equal(m.primary_category, 'Tiệm làm móng')
assert.equal(m.additional_categories, 'Spa chăm sóc da, Tiệm làm tóc') // trừ danh mục chính
assert.equal(m.claim_signal, 'claimed')
assert.equal(m.opening_hours, 'Thứ Hai: 9AM-7PM | Thứ Ba: 9AM-7PM | Chủ Nhật: Closed')
assert.deepEqual(m.attributes, [
  { group: 'Tùy chọn dịch vụ', items: ['Đặt lịch hẹn'] },
  { group: 'Thanh toán', items: ['Thẻ tín dụng'] },
])
assert.deepEqual(m.rating_distribution, { '1': 3, '2': 2, '3': 5, '4': 18, '5': 100 })
assert.equal(m.photos_count_est, 54)
assert.ok(m.action_links?.some((l) => l.kind === 'booking'))
assert.equal(m.coverage?.identity, 'matched')
assert.equal(m.coverage?.sections.updates, 'not_found') // không có trường posts
assert.match(m.posts_signal || '', /không kết luận/i)
assert.equal(m.coverage?.sections.services, 'skipped')

// 2) Review: ngày thật, tuổi, reply, key ổn định
const r = m.reviews!
assert.equal(r.length, 3)
assert.equal(r[1].age_days_est, 0)
assert.equal(r[1].relative_time, 'hôm nay')
assert.equal(r[0].age_days_est, 2)
assert.equal(r[0].relative_time, '2 ngày trước')
assert.equal(r[2].relative_time, '3 tháng trước')
assert.equal(r[1].reply, null)
assert.equal(r[0].reply, 'Cảm ơn bạn')
assert.ok(r[0].key && r[0].key.length === 24)
assert.notEqual(r[0].key, r[1].key)
const again = mapReviews(reviewsPlace.reviews_data, NOW + 86_400_000 * 5).items
assert.equal(again[0].key, r[0].key) // key không đổi theo thời điểm chạy
assert.equal(m.review_stats?.replied, 1)
assert.equal(m.review_stats?.loaded, 3)

// 3) Không có trường owner_answer -> cảnh báo, không bịa tỉ lệ phản hồi
const noReply = mapOutscraperToPayload(place, {
  reviews_data: [{ review_rating: 3, review_text: 'ok', review_datetime_utc: '11/12/2026 08:00:00' }],
}, { now: NOW })
assert.equal(noReply.reply_field_present, false)
assert.ok(noReply.coverage?.warnings.some((w) => /owner_answer/.test(w)))

// 4) verified=false -> unclaimed; thiếu verified -> unknown
assert.equal(mapOutscraperToPayload({ ...place, verified: false }, null, { now: NOW }).claim_signal, 'unclaimed')
const { verified, ...noVerified } = place
assert.equal(mapOutscraperToPayload(noVerified, null, { now: NOW }).claim_signal, 'unknown')

// 5) Tên khác hẳn -> ambiguous
assert.equal(mapOutscraperToPayload(place, null, { claimedName: 'Quán phở Bắc', now: NOW }).coverage?.identity, 'ambiguous')

// 6) Place rỗng không ném lỗi
assert.doesNotThrow(() => mapOutscraperToPayload({}, null, { now: NOW }))

// 7) posts dạng object
const withPosts = mapOutscraperToPayload({ ...place, posts: [{ text: 'Khuyến mãi tháng 11', datetime_utc: '11/01/2026 00:00:00' }, 'Bài chuỗi'] }, null, { now: NOW })
assert.equal(withPosts.recent_posts?.length, 2)
assert.equal(withPosts.coverage?.sections.updates, 'ok')

// 8) Parse ngày
assert.equal(parseOutscraperDate('11/12/2026 08:00:00'), Date.UTC(2026, 10, 12, 8, 0, 0))
assert.equal(parseOutscraperDate(null, 1760000000), 1760000000 * 1000)
assert.equal(parseOutscraperDate('garbage'), null)

console.log('OK: tất cả kiểm tra mapping Outscraper đều qua')
