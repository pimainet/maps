// Chạy: npx tsx scripts/test-review-watch.ts  (Supabase + Outscraper giả lập, không gọi mạng, không gọi AI)
import assert from 'node:assert/strict'
import { cutoffFor, dueForCheck, runReviewWatchForClient, importFromLatestSnapshot } from '../lib/review-watch'
import { REVIEW_LIMITS } from '../lib/billing/plans'
import { fakeSupabase } from './fake-supabase'

process.env.OUTSCRAPER_API_KEY = 'test'
delete process.env.SEARCHAPI_API_KEY
delete process.env.SERPAPI_API_KEY
delete process.env.ANTHROPIC_API_KEY // không soạn nháp AI trong test này

const NOW = new Date('2026-11-13T02:00:00Z')
const DAY = 86_400_000
let reviewsData: any[] = []
let lastUrl = ''
let fetchCalls = 0
globalThis.fetch = (async (url: any) => {
  fetchCalls += 1
  lastUrl = String(url)
  return new Response(JSON.stringify({ status: 'Success', data: [[{ rating: 4.5, reviews: 100, reviews_data: reviewsData }]] }), { status: 200 })
}) as any

const UNIQ = { uniques: { client_reviews: [['client_id', 'review_key']] } }
const client = { id: 'c1', workspace_id: 'w1', name: 'Tiệm Nail Hoa', place_id: 'ChIJxyz' }
const mk = (rating: number, text: string, author: string, reply: string | null, date = '11/12/2026 08:00:00', id?: string) => ({
  review_id: id ?? `os-${author}`, review_rating: rating, review_text: text, author_title: author, review_datetime_utc: date, owner_answer: reply,
})

async function main() {
  // --- Tần suất / cutoff (thuần)
  assert.equal(dueForCheck('none', null, NOW), false)
  assert.equal(dueForCheck('weekly', null, NOW), true)
  assert.equal(dueForCheck('weekly', new Date(NOW.getTime() - 5 * DAY).toISOString(), NOW), false)
  assert.equal(dueForCheck('weekly', new Date(NOW.getTime() - 6.1 * DAY).toISOString(), NOW), true)
  assert.equal(dueForCheck('daily', new Date(NOW.getTime() - 0.5 * DAY).toISOString(), NOW), false)
  assert.equal(dueForCheck('daily', new Date(NOW.getTime() - 0.9 * DAY).toISOString(), NOW), true)
  {
    const first = cutoffFor(null, null, NOW)
    assert.equal(first.refresh, true)
    assert.equal(first.cutoffSec, Math.floor((NOW.getTime() - 30 * DAY) / 1000))
    const lastChecked = new Date(NOW.getTime() - 2 * DAY).toISOString()
    const normal = cutoffFor({ last_checked_at: lastChecked, last_refresh_at: new Date(NOW.getTime() - DAY).toISOString() }, new Date(NOW.getTime() - 20 * DAY).toISOString(), NOW)
    assert.equal(normal.refresh, false)
    assert.equal(normal.cutoffSec, Math.floor((NOW.getTime() - 3 * DAY) / 1000)) // lùi 1 ngày
    const refresh = cutoffFor({ last_checked_at: lastChecked, last_refresh_at: new Date(NOW.getTime() - 8 * DAY).toISOString() }, new Date(NOW.getTime() - 20 * DAY).toISOString(), NOW)
    assert.equal(refresh.refresh, true)
    assert.equal(refresh.cutoffSec, Math.floor((NOW.getTime() - 21 * DAY) / 1000)) // từ review còn mở cũ nhất
    const capped = cutoffFor({ last_checked_at: lastChecked, last_refresh_at: null }, new Date(NOW.getTime() - 90 * DAY).toISOString(), NOW)
    assert.equal(capped.cutoffSec, Math.floor((NOW.getTime() - 30 * DAY) / 1000)) // không xa hơn 30 ngày
  }

  // --- Lần 1 (gói Khởi động): 2 thấp chưa trả lời, 1 thấp đã trả lời, 2 tốt chưa trả lời, 1 tốt đã trả lời
  reviewsData = [
    mk(1, 'Tệ, chờ cả tiếng không ai tiếp', 'An Nguyen', null), mk(2, 'Chờ lâu quá', 'Binh', null), mk(2, 'Hơi chậm', 'Cuong', 'Xin lỗi bạn'),
    mk(5, 'Tuyệt vời, làm móng rất đẹp', 'Dung', null), mk(4, 'Ổn, giá hợp lý', 'Em', null), mk(5, 'Đẹp', 'Phuong', 'Cảm ơn'),
  ]
  const { db, admin } = fakeSupabase({}, UNIQ)
  const ent = REVIEW_LIMITS.basic
  const r1 = await runReviewWatchForClient(admin, client, { ent, now: NOW, appUrl: 'https://app.test' })
  assert.equal(r1.source, 'outscraper')
  assert.equal(r1.new_reviews, 6)
  assert.equal(r1.negative_tasks, 2)
  assert.equal(r1.positive_task, true)
  assert.equal(r1.drafts, 0) // không có ANTHROPIC_API_KEY
  assert.match(lastUrl, /cutoff=/)
  assert.match(lastUrl, /sort=newest/)
  assert.equal(db.client_reviews.length, 6)
  assert.equal(db.client_reviews.filter((r) => r.status === 'replied_elsewhere').length, 2)
  assert.equal(db.client_reviews.filter((r) => r.status === 'new').length, 4)
  assert.equal(db.tasks.length, 3)
  assert.equal(db.tasks.filter((t) => t.priority === 'high').length, 2)
  assert.ok(db.tasks.every((t) => t.task_type === 'review' && t.status === 'pending' && t.workspace_id === 'w1'))
  assert.ok(db.tasks[0].description.includes('https://app.test/clients/c1/reviews'))
  const low1 = db.client_reviews.find((r) => r.rating === 1)!
  assert.equal(low1.urgency, 'high')
  assert.equal(low1.author_name, 'An Nguyen')
  assert.ok(low1.task_id)
  // việc "cảm ơn" gắn với cả 2 review tốt
  const thanksTask = db.tasks.find((t) => t.priority === 'low')!
  assert.equal(db.client_reviews.filter((r) => r.task_id === thanksTask.id).length, 2)
  assert.equal(db.review_watch_state[0].last_review_count, 100)
  assert.equal(db.review_watch_state[0].last_source, 'outscraper')
  assert.equal(db.review_watch_state[0].checks_count, 1)

  // Lần 2 ngay sau đó: gói hàng tuần -> chưa tới lượt
  const r2 = await runReviewWatchForClient(admin, client, { ent, now: new Date(NOW.getTime() + DAY) })
  assert.equal(r2.skipped, 'recent')
  assert.equal(db.tasks.length, 3)

  // Sau 8 ngày: 1 review thấp mới + chủ đã tự trả lời review 1★ trên Google -> chỉ 1 việc mới, việc cũ tự đóng
  reviewsData = [
    mk(1, 'Tệ, chờ cả tiếng không ai tiếp', 'An Nguyen', 'Chúng tôi xin lỗi anh'),
    ...reviewsData.slice(1),
    mk(1, 'Rất tệ, nhân viên thái độ', 'Giang', null, '11/20/2026 08:00:00'),
  ]
  const r3 = await runReviewWatchForClient(admin, client, { ent, now: new Date(NOW.getTime() + 8 * DAY) })
  assert.equal(r3.new_reviews, 1)
  assert.equal(r3.negative_tasks, 1)
  assert.equal(r3.closed_tasks, 1)
  assert.equal(db.tasks.length, 4)
  assert.equal(db.client_reviews.find((r) => r.author_name === 'An Nguyen')!.status, 'replied_elsewhere')
  assert.equal(db.tasks.find((t) => t.id === low1.task_id)!.status, 'done')
  assert.equal(db.client_reviews.length, 7)

  // Gói Miễn phí: không quét
  const free = await runReviewWatchForClient(admin, client, { ent: REVIEW_LIMITS.free, now: new Date(NOW.getTime() + 30 * DAY) })
  assert.equal(free.skipped, 'plan')

  // Dữ liệu GBP (Make) mới đồng bộ < 48h -> không gọi Outscraper
  db.review_watch_state[0].gbp_synced_at = new Date(NOW.getTime() + 19 * DAY).toISOString()
  const before = fetchCalls
  const g = await runReviewWatchForClient(admin, client, { ent: REVIEW_LIMITS.full, now: new Date(NOW.getTime() + 20 * DAY) })
  assert.equal(g.skipped, 'gbp_fresh')
  assert.equal(fetchCalls, before)
}

async function noReplyField() {
  // Không có owner_answer -> vẫn tạo việc cho review thấp (kèm cảnh báo) nhưng KHÔNG tạo việc "cảm ơn"
  reviewsData = [
    { review_rating: 2, review_text: 'Bàn bẩn', author_title: 'H', review_datetime_utc: '11/12/2026 08:00:00' },
    { review_rating: 5, review_text: 'Ngon', author_title: 'I', review_datetime_utc: '11/12/2026 08:00:00' },
  ]
  const { db, admin } = fakeSupabase({}, UNIQ)
  const r = await runReviewWatchForClient(admin, client, { ent: REVIEW_LIMITS.full, now: NOW })
  assert.equal(r.negative_tasks, 1)
  assert.equal(r.positive_task, false)
  const low = db.client_reviews.find((x) => x.rating === 2)!
  assert.equal(low.status, 'new')
  assert.ok(low.draft_warnings[0].includes('không cho biết'))
  assert.ok(db.tasks[0].description.includes('không cho biết'))
}

async function dryRun() {
  reviewsData = [mk(1, 'Tệ', 'A', null)]
  const { db, admin } = fakeSupabase({}, UNIQ)
  const r = await runReviewWatchForClient(admin, client, { ent: REVIEW_LIMITS.basic, now: NOW, dry: true })
  assert.equal(r.new_reviews, 1)
  assert.equal((db.client_reviews || []).length, 0)
  assert.equal((db.tasks || []).length, 0)
}

async function outscraperFails() {
  const saved = globalThis.fetch
  globalThis.fetch = (async () => new Response(JSON.stringify({ error: 'quota' }), { status: 402 })) as any
  const { db, admin } = fakeSupabase({}, UNIQ)
  const r = await runReviewWatchForClient(admin, { ...client, place_id: null, gbp_link: 'https://maps.app.goo.gl/x' }, { ent: REVIEW_LIMITS.basic, now: NOW })
  assert.ok(r.error && r.error.includes('Outscraper'))
  assert.ok(db.review_watch_state[0].last_error)
  assert.equal(db.review_watch_state[0].last_checked_at, undefined) // giữ nguyên để lần sau thử lại
  globalThis.fetch = saved
}

async function snapshotImport() {
  const { db, admin } = fakeSupabase(
    {
      gbp_snapshots: [
        {
          client_id: 'c1', status: 'ok', source: 'outscraper', captured_at: '2026-11-10T00:00:00Z',
          reviews: [
            { rating: 5, text: 'Phục vụ chu đáo, sẽ quay lại', posted_at: '2026-11-01T00:00:00Z', reply: null, key: 'old1' },
            { rating: 2, text: 'Đồ uống nhạt, chờ lâu', posted_at: '2026-11-02T00:00:00Z', reply: 'Xin lỗi', key: 'old2' },
          ],
        },
      ],
    },
    UNIQ,
  )
  const res = await importFromLatestSnapshot(admin, client, NOW)
  assert.equal(res.imported, 2)
  assert.equal(db.client_reviews.find((r) => r.rating === 2)!.status, 'replied_elsewhere')
  // Nhập lại không trùng
  assert.equal((await importFromLatestSnapshot(admin, client, NOW)).imported, 0)
  // Outscraper sau đó trả cùng review (có tên người viết) -> khớp theo nội dung, không tạo bản ghi mới
  reviewsData = [mk(5, 'Phục vụ chu đáo, sẽ quay lại', 'Khanh', null, '11/01/2026 00:00:00')]
  await runReviewWatchForClient(admin, client, { ent: REVIEW_LIMITS.basic, now: NOW })
  assert.equal(db.client_reviews.length, 2)
  const merged = db.client_reviews.find((r) => r.rating === 5)!
  assert.equal(merged.author_name, 'Khanh')
  assert.equal(merged.source, 'outscraper')
}

main()
  .then(noReplyField)
  .then(dryRun)
  .then(outscraperFails)
  .then(snapshotImport)
  .then(() => console.log('test-review-watch: OK'))
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
