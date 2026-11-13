// Kiểm tra dựng dữ liệu/prompt audit từ snapshot (hàm thuần).  npx tsx scripts/test-audit-fields.ts
import assert from 'node:assert/strict'
import { snapshotToAuditFields, summarizeSnapshot } from '../lib/gbp-audit-fields'
import { buildAuditPrompt } from '../lib/audit-prompt'

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

// Trường: thiếu thì có câu "không kết luận là thiếu"
let f = snapshotToAuditFields({})
assert.match(f.additional_categories, /không kết luận là thiếu/)
assert.match(f.recent_posts, /không kết luận là thiếu/)
assert.match(f.additional_info, /Giờ mở cửa: chưa đọc được/)
f = snapshotToAuditFields(snap)
assert.equal(f.rating, '4.6')
assert.equal(f.review_count, '120')
assert.match(f.recent_posts, /Ưu đãi tháng này/)

// Giờ: có hours_today thì không bị coi là thiếu
assert.match(snapshotToAuditFields({ hours_today: 'Mở cửa' }).additional_info, /hồ sơ CÓ khai giờ/)

// Prompt: thay một lượt, giá trị chứa {{rating}} giữ nguyên, ưu tiên ngành khách khai
const prompt = buildAuditPrompt({
  snapshot: snap,
  declared: { name: 'Khai báo', industry: 'Nail', area: 'Quận 1', gbp_link: 'https://maps.app/x' },
  progressContext: 'TIẾN ĐỘ',
  note: 'GHI CHÚ RIÊNG',
})
assert.ok(prompt.includes('Mô tả có {{rating}} lạ'), 'không được thay placeholder trong giá trị')
assert.ok(prompt.includes('Tiệm Nail Hoa') && prompt.includes('GHI CHÚ RIÊNG') && prompt.includes('TIẾN ĐỘ'))
assert.ok(!/\{\{(business_name|industry|area|output_language|progress_context|additional_info)\}\}/.test(prompt), 'còn placeholder chưa thay')

// Tóm tắt hiển thị
const sum = summarizeSnapshot(snap)
assert.deepEqual(sum.unread.length, 2)
assert.equal(sum.reviews_loaded, 2)
assert.equal(sum.posts_count, 1)
assert.equal(sum.has_description, true)
assert.equal(summarizeSnapshot(null).posts_count, 0)

console.log('OK: trường audit + prompt + tóm tắt — tất cả kiểm tra đều qua')
