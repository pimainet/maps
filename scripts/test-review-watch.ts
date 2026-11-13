// Chạy: npx tsx scripts/test-review-watch.ts  (Supabase + Outscraper được giả lập, không gọi mạng)
import assert from 'node:assert/strict'
import { runReviewWatchForClient } from '../lib/review-watch'

process.env.OUTSCRAPER_API_KEY = 'test'
delete process.env.ANTHROPIC_API_KEY // draftReply -> null, việc vẫn được tạo

const NOW = new Date('2026-11-13T02:00:00Z')
let reviewsData: any[] = []
globalThis.fetch = (async () =>
  new Response(JSON.stringify({ status: 'Success', data: [[{ rating: 4.5, reviews: 100, reviews_data: reviewsData }]] }), { status: 200 })) as any

function fakeAdmin() {
  const db: Record<string, any[]> = { review_watch_state: [], review_alerts: [], tasks: [] }
  const from = (table: string) => {
    let filters: Array<(r: any) => boolean> = []
    const api: any = {
      select: () => api,
      eq: (k: string, v: any) => (filters.push((r) => r[k] === v), api),
      in: (k: string, vs: any[]) => (filters.push((r) => vs.includes(r[k])), api),
      maybeSingle: async () => ({ data: db[table].find((r) => filters.every((f) => f(r))) ?? null, error: null }),
      then: (res: any) => res({ data: db[table].filter((r) => filters.every((f) => f(r))), error: null }),
      insert: (row: any) => {
        const rec = { id: `${table}-${db[table].length + 1}`, ...row }
        if (table === 'review_alerts' && db[table].some((r) => r.client_id === row.client_id && r.review_key === row.review_key)) {
          throw new Error('duplicate review_key')
        }
        db[table].push(rec)
        const chain: any = { select: () => chain, single: async () => ({ data: rec, error: null }), then: (res: any) => res({ error: null }) }
        return chain
      },
      upsert: async (row: any) => {
        const i = db[table].findIndex((r) => r.client_id === row.client_id)
        if (i >= 0) db[table][i] = { ...db[table][i], ...row }
        else db[table].push(row)
        return { error: null }
      },
    }
    return api
  }
  return { db, admin: { from } as any }
}

const client = { id: 'c1', workspace_id: 'w1', name: 'Tiệm Nail Hoa', place_id: 'ChIJxyz' }
const mk = (rating: number, text: string, author: string, reply: string | null, date = '11/12/2026 08:00:00') => ({
  review_rating: rating, review_text: text, author_title: author, review_datetime_utc: date, owner_answer: reply,
})

async function main() {
// Lần 1: 2 review thấp chưa trả lời, 1 thấp đã trả lời, 2 tốt chưa trả lời, 1 tốt đã trả lời
reviewsData = [
  mk(1, 'Tệ', 'A', null), mk(2, 'Chờ lâu', 'B', null), mk(2, 'Hơi chậm', 'C', 'Xin lỗi bạn'),
  mk(5, 'Tuyệt', 'D', null), mk(4, 'Ổn', 'E', null), mk(5, 'Đẹp', 'F', 'Cảm ơn'),
]
{
  const { db, admin } = fakeAdmin()
  const r1 = await runReviewWatchForClient(admin, client, { now: NOW })
  assert.equal(r1.new_reviews, 6)
  assert.equal(r1.negative_tasks, 2)
  assert.equal(r1.positive_task, true)
  assert.equal(db.tasks.length, 3)
  assert.equal(db.tasks.filter((t) => t.priority === 'high').length, 2)
  assert.ok(db.tasks.every((t) => t.task_type === 'review' && t.status === 'pending' && t.workspace_id === 'w1'))
  assert.equal(db.review_alerts.length, 6) // mọi review đều được đánh dấu đã thấy
  assert.equal(db.review_watch_state[0].last_review_count, 100)

  // Lần 2 ngay sau đó: bị chặn bởi giới hạn 6 ngày
  const r2 = await runReviewWatchForClient(admin, client, { now: new Date(NOW.getTime() + 86_400_000) })
  assert.equal(r2.skipped, 'recent')
  assert.equal(db.tasks.length, 3)

  // Sau 8 ngày: cùng dữ liệu cũ + 1 review thấp mới -> chỉ tạo task cho review mới
  reviewsData = [...reviewsData, mk(1, 'Rất tệ', 'G', null, '11/20/2026 08:00:00')]
  const r3 = await runReviewWatchForClient(admin, client, { now: new Date(NOW.getTime() + 8 * 86_400_000) })
  assert.equal(r3.new_reviews, 1)
  assert.equal(r3.negative_tasks, 1)
  assert.equal(db.tasks.length, 4)
}

// Không có owner_answer trong dữ liệu -> vẫn tạo task cho review thấp nhưng KHÔNG tạo task "cảm ơn"
reviewsData = [
  { review_rating: 2, review_text: 'Chậm', author_title: 'X', review_datetime_utc: '11/12/2026 08:00:00' },
  { review_rating: 5, review_text: 'Tốt', author_title: 'Y', review_datetime_utc: '11/12/2026 08:00:00' },
]
{
  const { db, admin } = fakeAdmin()
  const r = await runReviewWatchForClient(admin, client, { now: NOW })
  assert.equal(r.reply_field_present, false)
  assert.equal(r.negative_tasks, 1)
  assert.equal(r.positive_task, false)
  assert.match(db.tasks[0].description, /chưa xác định được đã phản hồi/)
}

// Dry-run không ghi gì
{
  const { db, admin } = fakeAdmin()
  reviewsData = [mk(1, 'Tệ', 'A', null)]
  const r = await runReviewWatchForClient(admin, client, { now: NOW, dry: true })
  assert.equal(r.negative_tasks, 1)
  assert.equal(db.tasks.length + db.review_alerts.length + db.review_watch_state.length, 0)
}

// Lỗi Outscraper -> ghi last_error, không tạo task, không ném
{
  const { db, admin } = fakeAdmin()
  globalThis.fetch = (async () => new Response(JSON.stringify({ error: 'quota' }), { status: 402 })) as any
  const r = await runReviewWatchForClient(admin, client, { now: NOW })
  assert.match(r.error || '', /quota/)
  assert.equal(db.tasks.length, 0)
  assert.match(db.review_watch_state[0].last_error, /quota/)
}
console.log('OK: Review Watch — tất cả kiểm tra đều qua')
}
main().catch((e) => { console.error(e); process.exit(1) })
