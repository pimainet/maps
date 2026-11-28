// Gộp nguồn phụ theo từng trường + ghi nguồn + chặn chi phí + nối vào check audit.  npx tsx scripts/test-gbp-enrich.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { applyExtraPlace, applyExtraPosts, applyExtraReviews, enrichNeeds, enrichSnapshot, placeOrder, SERP_CHECKED_MARK } from '../lib/gbp-enrich'
import { parseSerpPlace, parseSerpReviews } from '../lib/gbp-serpapi'
import { parseSearchApiPlace, parseSearchApiReviews } from '../lib/gbp-searchapi'
import { mapOutscraperToPayload } from '../lib/gbp-outscraper'
import { runContentBasicChecks } from '../lib/audit-engine/content'
import { runFoundationChecks } from '../lib/audit-engine/foundation'
import { runTrustChecks } from '../lib/audit-engine/trust'
import { runRelevanceChecks } from '../lib/audit-engine/relevance'
import type { AIClassifier } from '../lib/audit-engine/types'

const NOW = Date.parse('2026-11-16T00:00:00Z')
const PID = 'ChIJ_x1234567'
const raw = (name: string) => readFileSync(join(__dirname, 'fixtures', name), 'utf8')
const fx = (name: string) => JSON.parse(raw(name))

/** Snapshot Outscraper "nghèo": có review nhưng KHÔNG có trường owner_answer, không mô tả/bài đăng/subtypes. */
const base = (): any => ({
  ...mapOutscraperToPayload(
    { place_id: PID, name: 'Điện lạnh Minh', type: 'Cửa hàng điện máy', rating: 4.8, reviews: 126, phone: '0912345678' },
    {
      reviews_data: Array.from({ length: 8 }, (_, i) => ({
        review_rating: 5,
        review_text: `review ${i}`,
        review_datetime_utc: '11/01/2026 10:00:00',
      })),
    },
    { now: NOW, placeIdGiven: true },
  ),
  source_used: 'outscraper',
})

const noAI: AIClassifier = { classify: async () => { throw new Error('AI tắt trong test') } }

async function main() {
  // Outscraper không trả owner_answer -> reply_rate = null (trước đây = 0 => T05 kết luận sai "0% phản hồi")
  const b = base()
  assert.equal(b.reviews.length, 8)
  assert.equal(b.review_stats.reply_rate, null)
  const t05Before = (await runTrustChecks({ snapshot: b, now: new Date(NOW) }, noAI)).find((c) => c.id === 'T05')!
  assert.equal(t05Before.confidence, 'insufficient')
  const n0 = enrichNeeds(b)
  assert.deepEqual(
    { d: n0.description, c: n0.categories, p: n0.posts, r: n0.owner_replies },
    { d: true, c: true, p: true, r: true },
  )

  // ---- applyExtraPlace: chỉ điền chỗ trống, ghi nguồn ----
  const sp = parseSerpPlace(fx('serpapi-place.json'), NOW)!
  const a = applyExtraPlace(b, sp, PID)
  assert.equal(a.description, 'Sửa chữa, vệ sinh điều hòa tại nhà ở Sầm Sơn.')
  assert.equal(a.additional_categories, 'Thợ điện lạnh, Dịch vụ sửa chữa thiết bị')
  assert.equal(a.primary_category, 'Cửa hàng điện máy')
  assert.equal(a.recent_posts!.length, 2)
  assert.ok(a.attributes!.length >= 3)
  assert.equal(a.coverage!.field_sources!.description, 'serpapi')
  assert.equal(a.coverage!.field_sources!.recent_posts, 'serpapi')
  assert.equal(a.coverage!.field_sources!.attributes, 'serpapi')
  assert.equal(a.phone, b.phone, 'không ghi đè số điện thoại có sẵn')
  assert.equal(a.coverage!.field_sources!.phone, undefined)
  assert.ok(a.coverage!.warnings.some((w: string) => /Đã bù .*mô tả.* từ SerpApi/.test(w)))
  assert.equal(applyExtraPlace({ ...b, description: 'Gốc' }, sp, PID).description, 'Gốc', 'không ghi đè')
  assert.equal(applyExtraPlace(b, { ...sp, place_id: 'ChIJ_other' }, PID), b, 'sai quán -> bỏ qua hoàn toàn')
  // bài không có ngày được thay bằng bài có ngày
  const undated = { ...b, recent_posts: [{ text: 'Bài cũ', approx_date: null }] }
  assert.equal(applyExtraPlace(undated, sp, PID).recent_posts![0].approx_date, '2 tuần trước')
  // nguồn sau không ghi đè nguồn trước
  const sa = parseSearchApiPlace(fx('searchapi-place.json'), NOW)!
  const ab = applyExtraPlace(applyExtraPlace(b, sa, PID), sp, PID)
  assert.equal(ab.description, 'Mô tả từ SearchApi')
  assert.equal(ab.coverage!.field_sources!.description, 'searchapi')
  assert.equal(ab.additional_categories, 'Thợ điện lạnh, Dịch vụ sửa chữa thiết bị', 'danh mục phụ được BỔ SUNG từ nguồn sau')

  // ---- posts engine ----
  const withPosts = applyExtraPosts(b, [{ text: 'KM', approx_date: '2 tuần trước', posted_at: '2026-11-02T08:15:00.000Z' }])
  assert.equal(withPosts.coverage!.sections.updates, 'ok')
  const empty = applyExtraPosts(b, [])
  assert.equal(empty.coverage!.sections.updates, 'empty', 'engine bài đăng trả rỗng -> có thể kết luận chưa đăng')
  assert.equal(applyExtraPosts(b, null), b)

  // ---- reviews ----
  const sr = parseSerpReviews(fx('serpapi-reviews.json'), NOW)!
  const r = applyExtraReviews(b, sr, PID)
  assert.equal(r.reviews!.length, 6)
  assert.equal(r.review_stats!.replied, 3)
  assert.equal(r.review_stats!.reply_rate, 0.5)
  assert.equal(r.coverage!.field_sources!.reviews, 'serpapi')
  const sar = parseSearchApiReviews(fx('searchapi-reviews.json'), NOW)!
  assert.equal(applyExtraReviews(b, sar, PID), b, 'SearchApi không biết phản hồi + ít review hơn -> giữ Outscraper')
  const placesOnly = { ...b, reviews: b.reviews.slice(0, 3), review_stats: null }
  const pr = applyExtraReviews(placesOnly, sar, PID)
  assert.equal(pr.reviews!.length, 6, 'ít review (Places) -> lấy review SearchApi để tính độ mới')
  assert.equal(pr.review_stats!.reply_rate, null, '...nhưng không tính tỉ lệ phản hồi')
  const known = { ...b, review_stats: { ...b.review_stats, reply_rate: 0.4, replied: 3 } }
  assert.equal(applyExtraReviews(known, sr, PID), known, 'đã có tỉ lệ phản hồi từ nguồn chính -> không thay')

  // ---- enrichSnapshot: thứ tự, chặn chi phí, lỗi ----
  delete process.env.SERPAPI_API_KEY
  delete process.env.SEARCHAPI_API_KEY
  delete process.env.DATAFORSEO_LOGIN
  delete process.env.GBP_ENRICH_PLACE_ORDER
  const s0 = base()
  assert.equal(await enrichSnapshot(s0, { placeId: PID }), s0, 'không có khóa -> không gọi mạng, trả nguyên object')
  assert.deepEqual(placeOrder(), ['searchapi', 'serpapi'])
  process.env.GBP_ENRICH_PLACE_ORDER = 'serpapi'
  assert.deepEqual(placeOrder(), ['serpapi', 'searchapi'])
  delete process.env.GBP_ENRICH_PLACE_ORDER

  process.env.SERPAPI_API_KEY = 'k1'
  process.env.SEARCHAPI_API_KEY = 'k2'
  const realFetch = globalThis.fetch
  const calls: string[] = []
  const respond = (body: any, status = 200) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status })
  const router = (over: Record<string, () => Response> = {}) =>
    (async (u: any) => {
      const url = new URL(String(u))
      const engine = url.searchParams.get('engine')!
      const key = `${url.hostname.includes('serpapi') ? 'serpapi' : 'searchapi'}:${engine}`
      calls.push(key)
      assert.ok(url.searchParams.get('api_key'), 'gửi api_key')
      if (over[key]) return over[key]()
      if (key === 'searchapi:google_maps_place') return respond(raw('searchapi-place.json'))
      if (key === 'serpapi:google_maps') {
        assert.equal(url.searchParams.get('type'), 'place')
        assert.equal(url.searchParams.get('place_id'), PID)
        return respond(raw('serpapi-place.json'))
      }
      if (key === 'serpapi:google_maps_posts') return respond(raw('serpapi-posts.json'))
      if (key === 'serpapi:google_maps_reviews') {
        assert.equal(url.searchParams.get('sort_by'), 'newestFirst')
        return respond(raw('serpapi-reviews.json'))
      }
      if (key === 'searchapi:google_maps_reviews') return respond(raw('searchapi-reviews.json'))
      return respond({ error: 'unexpected' }, 400)
    }) as any

  // SearchApi place (rẻ) đã đủ mô tả + danh mục phụ + bài có ngày -> không gọi SerpApi place/posts; review kèm phản hồi từ SerpApi
  globalThis.fetch = router()
  const full = await enrichSnapshot(base(), { placeId: PID })
  assert.deepEqual(calls, ['searchapi:google_maps_place', 'serpapi:google_maps_reviews'], 'không gọi SerpApi place / posts khi trường lõi đã đủ')
  assert.equal(full.description, 'Mô tả từ SearchApi')
  assert.equal(full.review_stats!.reply_rate, 0.5)
  assert.equal(full.coverage!.field_sources!.description, 'searchapi')
  assert.equal(full.coverage!.field_sources!.reviews, 'serpapi')
  assert.equal(full.coverage!.field_sources!.rating_distribution, 'searchapi', 'Outscraper mẫu không có phân bố sao')
  assert.equal(full.coverage!.field_sources!.phone, 'outscraper', 'trường có sẵn được ghi nguồn chính')
  assert.deepEqual(full.coverage!.enrich!.tried.sort(), ['searchapi:place', 'serpapi:reviews'])
  assert.equal(full.coverage!.enrich!.data_id, '0x3136b1:0x9a1b2c')
  assert.equal((full as any).questions_answers.length, 1)

  // Audit lại trên bản đã bù: không gọi gì thêm
  calls.length = 0
  const again = await enrichSnapshot(full, { placeId: PID })
  assert.deepEqual(calls, [], 'cùng snapshot không gọi lại engine đã thử')
  assert.equal(again, full)

  // SearchApi không có mô tả + bài không ngày -> SerpApi place, rồi posts engine (data_id) cho ngày chính xác
  calls.length = 0
  globalThis.fetch = router({
    'searchapi:google_maps_place': () => respond({ place_result: { place_id: PID, data_id: '0x3136b1:0x9a1b2c', types: ['Cửa hàng điện máy'], posts: [{ snippet: 'Bài', date: '???' }] } }),
    'serpapi:google_maps': () => respond({ place_results: { place_id: PID, description: 'Mô tả SerpApi', type: ['Cửa hàng điện máy', 'Thợ điện lạnh'], posts: [{ description: 'Bài', date: 'không rõ' }] } }),
  })
  const deep = await enrichSnapshot(base(), { placeId: PID })
  assert.deepEqual(calls, ['searchapi:google_maps_place', 'serpapi:google_maps', 'serpapi:google_maps_posts', 'serpapi:google_maps_reviews'])
  assert.equal(deep.description, 'Mô tả SerpApi')
  assert.equal(deep.recent_posts![0].posted_at, '2026-11-02T08:15:00.000Z')
  assert.equal(deep.coverage!.field_sources!.recent_posts, 'serpapi')

  // quick (demo công khai): 1 lần place, không review/posts
  calls.length = 0
  globalThis.fetch = router({ 'searchapi:google_maps_place': () => respond({ place_result: { place_id: PID } }) })
  await enrichSnapshot(base(), { placeId: PID, depth: 'quick' })
  assert.deepEqual(calls, ['searchapi:google_maps_place'])

  // SerpApi hết lượt -> SearchApi dự phòng cho review; lỗi mạng không làm hỏng snapshot
  calls.length = 0
  globalThis.fetch = router({
    'searchapi:google_maps_place': () => { throw new Error('timeout') },
    'serpapi:google_maps': () => respond({ error: 'Your account has run out of searches.' }, 429),
    'serpapi:google_maps_reviews': () => respond({ error: 'Your account has run out of searches.' }, 429),
  })
  const fb = await enrichSnapshot(base(), { placeId: PID })
  assert.deepEqual(calls, ['searchapi:google_maps_place', 'serpapi:google_maps', 'serpapi:google_maps_reviews', 'searchapi:google_maps_reviews'])
  assert.equal(fb.description, null)
  assert.equal(fb.reviews!.length, 8, 'SearchApi không biết phản hồi -> giữ review Outscraper')
  assert.ok(fb.coverage!.enrich!.still_missing.includes('description'))
  assert.ok(fb.coverage!.enrich!.still_missing.includes('owner_replies'))

  // Dấu cũ (bản trước) -> không trả phí place lại
  calls.length = 0
  globalThis.fetch = router()
  const legacy = base()
  legacy.coverage.warnings.push(SERP_CHECKED_MARK)
  legacy.review_stats = { ...legacy.review_stats, reply_rate: 0.5 }
  assert.equal(await enrichSnapshot(legacy, { placeId: PID }), legacy)
  assert.deepEqual(calls, [])

  // Không có place_id -> không gọi
  calls.length = 0
  const noId = { ...base(), place_id: null }
  await enrichSnapshot(noId, {})
  assert.deepEqual(calls, [])

  globalThis.fetch = realFetch
  delete process.env.SERPAPI_API_KEY
  delete process.env.SEARCHAPI_API_KEY

  // ---- nối vào check audit: các check trước đây "chưa đủ dữ liệu" nay có kết luận ----
  const auditIn = { snapshot: deep, now: new Date(NOW) }
  const c = Object.fromEntries(runContentBasicChecks(auditIn).map((x) => [x.id, x]))
  assert.equal(c.C01.passed, true)
  assert.equal(c.C02.passed, true)
  assert.equal(c.C02.confidence, 'verified', 'có posted_at ISO -> ngày đăng chắc chắn')
  assert.match(c.C02.message, /13 ngày/)
  const before = Object.fromEntries(runContentBasicChecks({ snapshot: base(), now: new Date(NOW) }).map((x) => [x.id, x]))
  assert.equal(before.C01.confidence, 'insufficient')
  assert.equal(before.C02.confidence, 'insufficient')
  const t05 = (await runTrustChecks({ snapshot: full, now: new Date(NOW) }, noAI)).find((x) => x.id === 'T05')!
  assert.equal(t05.passed, true)
  assert.match(t05.message, /3\/6/)
  const rel = Object.fromEntries((await runRelevanceChecks({ snapshot: applyExtraPlace(base(), sp, PID) }, noAI)).map((x) => [x.id, x]))
  assert.equal(rel.R05.passed, true, 'thuộc tính từ extensions')
  assert.equal(rel.R03.confidence, 'insufficient', 'danh sách dịch vụ: chưa có nguồn công khai -> vẫn không kết luận')
  const unclaimed = applyExtraPlace(base(), { ...sp, claim_signal: 'unclaimed' }, PID)
  // base Outscraper không có trường verified -> claim unknown -> nhận tín hiệu unclaimed
  const f02 = runFoundationChecks({ snapshot: unclaimed }).find((x) => x.id === 'F02')!
  assert.equal(f02.passed, false)
  const f07 = runFoundationChecks({ snapshot: applyExtraPlace(base(), sp, PID) }).find((x) => x.id === 'F07')!
  assert.equal(f07.passed, true)

  console.log('OK: gộp SearchApi/SerpApi theo trường, ghi nguồn, chặn chi phí, lỗi an toàn, check C01/C02/T05/R05/F02/F07 có dữ liệu thật')
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})
