// Kiểm tra tóm tắt snapshot hiển thị sau audit (hàm thuần).  npx tsx scripts/test-audit-fields.ts
import assert from 'node:assert/strict'
import { summarizeSnapshot } from '../lib/gbp-audit-fields'

const snap = {
  business_name: 'Tiệm Nail Hoa',
  description: 'Mô tả có {{rating}} lạ',
  primary_category: 'Tiệm làm móng',
  rating: 4.6,
  review_count: 120,
  recent_posts: [{ text: 'Ưu đãi tháng này', approx_date: '2 tuần trước' }],
  coverage: { reviews_loaded: 2, sections: { reviews: 'ok', posts: 'error', hours: 'skipped' }, warnings: ['cảnh báo'] },
  reviews: [{}, {}],
}

// Tóm tắt hiển thị
const sum = summarizeSnapshot(snap)
assert.deepEqual(sum.unread.length, 2)
assert.equal(sum.reviews_loaded, 2)
assert.equal(sum.posts_count, 1)
assert.equal(sum.has_description, true)
assert.equal(summarizeSnapshot(null).posts_count, 0)

console.log('OK: tóm tắt snapshot — tất cả kiểm tra đều qua')
