// Chạy: npx tsx scripts/test-review-velocity.ts
// T07 tốc độ review so với đối thủ + T03 ngưỡng 21 ngày + giới hạn chi phí lấy review đối thủ (fake Outscraper).
import assert from 'node:assert/strict'
import { fetchCompetitorVelocity, pickVelocitySample, summariseVelocity, velocityLimit, velocitySample } from '../lib/competitor-velocity'
import { runTrustChecks } from '../lib/audit-engine/trust'
import type { AIClassifier, AuditInput, CompetitorVelocity } from '../lib/audit-engine/types'

const NOW = new Date('2026-11-28T00:00:00Z')
const ai: AIClassifier = { async classify<T>(): Promise<T> { return { recurringIssue: null, summary: '' } as T } }
const day = 86_400

async function main() {
  // 1) Giới hạn chi phí qua env.
  delete process.env.COMPETITOR_REVIEW_SAMPLE
  delete process.env.COMPETITOR_REVIEW_LIMIT
  assert.equal(velocitySample(), 3)
  assert.equal(velocityLimit(), 20)
  process.env.COMPETITOR_REVIEW_SAMPLE = '9'
  process.env.COMPETITOR_REVIEW_LIMIT = '500'
  assert.equal(velocitySample(), 5, 'tối đa 5 đối thủ')
  assert.equal(velocityLimit(), 30, 'tối đa 30 review/quán')
  process.env.COMPETITOR_REVIEW_SAMPLE = '0'
  assert.equal(velocitySample(), 0, '0 = tắt')
  delete process.env.COMPETITOR_REVIEW_SAMPLE
  delete process.env.COMPETITOR_REVIEW_LIMIT

  // 2) Chọn mẫu theo rank, bỏ quán không có place_id.
  const comps = [
    { name: 'C', placeId: 'pc', rank: 5 }, { name: 'A', placeId: 'pa', rank: 1 }, { name: 'X', placeId: null, rank: 2 },
    { name: 'B', placeId: 'pb', rank: 3 }, { name: 'D', placeId: 'pd', rank: 6 },
  ]
  assert.deepEqual(pickVelocitySample(comps, 3).map((s) => s.name), ['A', 'B', 'C'])

  // 3) Gọi Outscraper với cutoff 90 ngày + giới hạn review; một đối thủ lỗi không làm hỏng cả nhóm.
  const calls: any[] = []
  const reviewsAt = (agesDays: number[]) => agesDays.map((a) => ({ review_rating: 5, review_timestamp: Math.floor(NOW.getTime() / 1000) - a * day, review_text: 'ok' }))
  const fake = async (o: any) => {
    calls.push(o)
    if (o.placeId === 'pc') throw new Error('timeout')
    if (o.placeId === 'pa') return { reviews_data: reviewsAt([2, 5, 9, 15, 20, 28, 40, 60, 75, 88]) }
    return { reviews_data: reviewsAt([1, 3, 4, 6, 8, 10, 12, 14, 16, 18, 22, 25, 27, 29, 33, 40, 44, 50, 55, 60]) } // chạm giới hạn 20
  }
  const vel = await fetchCompetitorVelocity(pickVelocitySample(comps, 3), 20, { fetchReviews: fake as any, now: NOW })
  assert.equal(calls.length, 3)
  for (const c of calls) {
    assert.equal(c.reviewsLimit, 20)
    assert.equal(c.cutoff, Math.floor(NOW.getTime() / 1000) - 90 * day, 'chỉ lấy (và trả tiền) review trong 90 ngày')
  }
  assert.equal(vel.items.length, 2)
  const a = vel.items.find((i) => i.name === 'A')!
  assert.deepEqual([a.newestAgeDays, a.last30, a.last90, a.capped], [2, 6, 10, false])
  const b = vel.items.find((i) => i.name === 'B')!
  assert.deepEqual([b.last90, b.capped], [20, true])
  assert.equal(summariseVelocity('Z', 'pz', [], 20).newestAgeDays, null)

  // 4) T07.
  const stats = (o: Partial<NonNullable<AuditInput['snapshot']['review_stats']>>) =>
    ({ loaded: 30, with_text: 30, newest_age_days: 3, oldest_age_days: 200, last_30d: 2, last_90d: 6, window_complete: true, replied: 0, reply_rate: 0, avg_rating_loaded: 4.5, low_rating_count: 0, ...o })
  const run = async (st: any, v: CompetitorVelocity | undefined) => {
    const checks = await runTrustChecks({ snapshot: { review_stats: st } as any, competitorVelocity: v }, ai)
    return Object.fromEntries(checks.map((c) => [c.id, c]))
  }
  // trung vị đối thủ = (10 + 20) / 2 = 15; cần ≥ 7,5
  let t = await run(stats({ last_90d: 6 }), vel)
  assert.equal(t.T07.passed, false)
  assert.match(t.T07.message, /trung vị 2 đối thủ đứng đầu 15/)
  assert.match(t.T07.message, /B: ≥20/)
  assert.match(t.T07.action!, /ít nhất 3 review mới mỗi tháng/)
  t = await run(stats({ last_90d: 8 }), vel)
  assert.equal(t.T07.passed, true)
  // cả hai bên cùng đếm tối đa `limit`: hồ sơ chạm giới hạn (cửa sổ chưa đủ 90 ngày) vẫn so được
  t = await run(stats({ last_90d: 30, window_complete: false }), vel)
  assert.equal(t.T07.passed, true)
  // hồ sơ chưa tải đủ 90 ngày và chưa chạm giới hạn -> chưa đủ dữ liệu
  t = await run(stats({ last_90d: 4, window_complete: false }), vel)
  assert.equal(t.T07.passed, null)
  // thiếu đối thủ / thiếu số liệu hồ sơ -> chưa đủ dữ liệu
  assert.equal((await run(stats({}), { ...vel, items: vel.items.slice(0, 1) })).T07.passed, null)
  assert.equal((await run(stats({}), undefined)).T07.passed, null)
  assert.equal((await run(null, vel)).T07.passed, null)
  // đối thủ cũng không có review mới -> không phạt
  assert.equal((await run(stats({ last_90d: 0 }), { ...vel, items: vel.items.map((i) => ({ ...i, last90: 0, last30: 0 })) })).T07.passed, true)

  // 5) T03: ngưỡng 21 ngày.
  assert.equal((await run(stats({ newest_age_days: 21 }), vel)).T03.passed, true)
  assert.equal((await run(stats({ newest_age_days: 22 }), vel)).T03.passed, false)
  assert.match((await run(stats({ newest_age_days: 30 }), vel)).T03.action!, /21 ngày/)

  console.log('OK: tốc độ review so với đối thủ (T07) + T03 21 ngày + giới hạn chi phí — tất cả kiểm tra đều qua')
}

main().catch((e) => { console.error(e); process.exit(1) })
