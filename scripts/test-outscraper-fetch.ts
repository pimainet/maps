// Kiểm tra lớp mạng + điều phối nguồn dữ liệu (Outscraper -> Places) bằng fetch GIẢ, không tốn credit.
//   npx tsx scripts/test-outscraper-fetch.ts
import assert from 'node:assert/strict'
import { fetchOutscraperSnapshot } from '../lib/gbp-outscraper'
import { runGbpPublicSnapshot, hasProfileData } from '../lib/gbp-snapshot'

type Handler = (url: URL) => { status?: number; body: unknown } | null
const realFetch = globalThis.fetch
let calls: string[] = []

function installFetch(handler: Handler) {
  calls = []
  globalThis.fetch = (async (input: any) => {
    const url = new URL(typeof input === 'string' ? input : input.url ?? String(input))
    calls.push(`${url.hostname}${url.pathname}${url.searchParams.get('query') ? `?query=${url.searchParams.get('query')}` : ''}`)
    const out = handler(url)
    if (!out) return new Response(JSON.stringify({ error: 'not mocked' }), { status: 404 })
    return new Response(JSON.stringify(out.body), { status: out.status ?? 200, headers: { 'content-type': 'application/json' } })
  }) as typeof fetch
}

const ok = (data: unknown) => ({ body: { id: 'req-1', status: 'Success', data: [data] } })

const PLACE = {
  name: 'Tiệm Nail Hoa',
  place_id: 'ChIJabc',
  type: 'Tiệm làm móng',
  subtypes: 'Tiệm làm móng, Spa',
  rating: 4.6,
  reviews: 120,
  photos_count: 35,
  working_hours: { Monday: '9AM-8PM' },
  verified: true,
  full_address: '12 Lê Lợi, Quận 1, TP.HCM, Việt Nam',
  posts: [],
}
const REVIEWS = {
  reviews_data: [
    { review_rating: 5, review_text: 'Tuyệt', review_datetime_utc: '10/01/2026 10:00:00', owner_answer: 'Cảm ơn bạn' },
    { review_rating: 2, review_text: 'Tệ', review_datetime_utc: '11/01/2026 10:00:00' },
  ],
}

const outscraperHandler: Handler = (url) => {
  if (url.hostname !== 'api.app.outscraper.com') return null
  if (url.pathname === '/maps/search-v3') return ok([PLACE])
  if (url.pathname === '/maps/reviews-v3') return ok([REVIEWS])
  return null
}

async function main() {
  process.env.OUTSCRAPER_API_KEY = 'test-key'
  delete process.env.GOOGLE_PLACES_API_KEY

  // 1) Đường chính: hồ sơ + review
  installFetch(outscraperHandler)
  let snap = await fetchOutscraperSnapshot({ businessName: 'Tiệm Nail Hoa', area: 'Quận 1' })
  assert.equal(snap.business_name, 'Tiệm Nail Hoa')
  assert.equal(snap.reviews?.length, 2)
  assert.equal(snap.coverage?.reviews_loaded, 2)
  assert.equal(snap.coverage?.sections.reviews, 'ok')
  assert.equal(snap.reply_field_present, true)
  assert.equal(snap.additional_categories, 'Spa')
  assert.ok(calls.some((c) => c.includes('/maps/search-v3')) && calls.some((c) => c.includes('/maps/reviews-v3')))

  // 2) depth quick: KHÔNG gọi reviews-v3
  installFetch(outscraperHandler)
  snap = await fetchOutscraperSnapshot({ businessName: 'Tiệm Nail Hoa', depth: 'quick' })
  assert.ok(!calls.some((c) => c.includes('reviews-v3')), 'quick không được gọi reviews-v3')
  assert.equal(snap.coverage?.depth, 'quick')

  // 3) Review lỗi (500) -> vẫn có hồ sơ, đánh dấu coverage.reviews = error
  installFetch((url) => (url.pathname === '/maps/reviews-v3' ? { status: 500, body: { error: 'boom' } } : outscraperHandler(url)))
  snap = await fetchOutscraperSnapshot({ businessName: 'Tiệm Nail Hoa' })
  assert.equal(snap.business_name, 'Tiệm Nail Hoa')
  assert.equal(snap.coverage?.sections.reviews, 'error')
  assert.ok(snap.coverage?.warnings.some((w) => w.includes('review')))

  // 4) Link/place_id không ra kết quả -> thử theo tên + khu vực, KHÔNG coi là matched + có cảnh báo
  installFetch((url) => {
    const q = url.searchParams.get('query') || ''
    if (url.pathname === '/maps/search-v3' && (q.startsWith('https://') || q.startsWith('ChIJ'))) return ok([])
    if (url.pathname === '/maps/reviews-v3' && (q.startsWith('https://') || q.startsWith('ChIJ'))) return ok([])
    return outscraperHandler(url)
  })
  snap = await fetchOutscraperSnapshot({ mapsUrl: 'https://maps.app.goo.gl/abc', placeId: 'ChIJxxx', businessName: 'Tiệm Nail Hoa', area: 'Quận 1' })
  assert.equal(snap.business_name, 'Tiệm Nail Hoa')
  // identity chỉ dựa trên so tên khi không có place_id hợp lệ; điều quan trọng là có cảnh báo
  assert.ok(snap.coverage?.warnings.some((w) => w.includes('theo tên')))

  // 5) Không tìm thấy gì -> ném lỗi rõ ràng
  installFetch(() => ok([]))
  await assert.rejects(() => fetchOutscraperSnapshot({ businessName: 'Không tồn tại' }), /không tìm thấy địa điểm/)

  // 6) Chế độ async: Pending -> hỏi lại /requests/{id}
  let polled = 0
  installFetch((url) => {
    if (url.pathname === '/maps/search-v3') return { body: { id: 'job-9', status: 'Pending' } }
    if (url.pathname === '/requests/job-9') {
      polled++
      return ok([PLACE])
    }
    if (url.pathname === '/maps/reviews-v3') return ok([REVIEWS])
    return null
  })
  snap = await fetchOutscraperSnapshot({ businessName: 'Tiệm Nail Hoa' })
  assert.equal(polled, 1)
  assert.equal(snap.business_name, 'Tiệm Nail Hoa')

  // ---- Điều phối nguồn: runGbpPublicSnapshot ----
  const placesBody = {
    id: 'ChIJabc',
    displayName: { text: 'Tiệm Nail Hoa' },
    formattedAddress: '12 Lê Lợi, Quận 1',
    rating: 4.6,
    userRatingCount: 118,
    primaryTypeDisplayName: { text: 'Tiệm làm móng' },
  }
  const placesHandler: Handler = (url) => {
    if (url.hostname !== 'places.googleapis.com') return null
    if (url.pathname === '/v1/places:searchText') return { body: { places: [{ id: 'ChIJabc' }] } }
    return { body: placesBody }
  }
  process.env.GOOGLE_PLACES_API_KEY = 'places-key'

  // 7) Outscraper + Places đều ổn -> gộp
  installFetch((u) => outscraperHandler(u) ?? placesHandler(u))
  let r = await runGbpPublicSnapshot({ businessName: 'Tiệm Nail Hoa', area: 'Quận 1' })
  assert.equal(r.source_used, 'outscraper+places')
  assert.equal(r.review_count, 120) // số liệu Outscraper được ưu tiên
  assert.equal(r.reviews?.length, 2) // review Outscraper (có phản hồi chủ), không bị Places ghi đè
  assert.ok(r.review_stats && r.review_stats.replied === 1)

  // 8) Places lỗi -> vẫn trả dữ liệu Outscraper
  installFetch((u) => outscraperHandler(u) ?? (u.hostname === 'places.googleapis.com' ? { status: 500, body: { error: { message: 'x' } } } : null))
  r = await runGbpPublicSnapshot({ businessName: 'Tiệm Nail Hoa' })
  assert.equal(r.source_used, 'outscraper')
  assert.equal(r.business_name, 'Tiệm Nail Hoa')

  // 9) Outscraper lỗi -> dự phòng Places, có ghi lỗi
  installFetch((u) => (u.hostname === 'api.app.outscraper.com' ? { status: 500, body: { error: 'down' } } : placesHandler(u)))
  r = await runGbpPublicSnapshot({ businessName: 'Tiệm Nail Hoa' })
  assert.equal(r.source_used, 'places')
  assert.match(r.error || '', /Outscraper lỗi/)
  assert.equal(hasProfileData(r), true)

  // 10) Cả hai lỗi -> không ném, hasProfileData = false
  installFetch(() => ({ status: 500, body: { error: 'down' } }))
  r = await runGbpPublicSnapshot({ businessName: 'Tiệm Nail Hoa' })
  assert.equal(hasProfileData(r), false)
  assert.ok(r.error)

  // 11) Places ném lỗi mạng -> vẫn không ném ra ngoài
  globalThis.fetch = (async (input: any) => {
    const host = new URL(typeof input === 'string' ? input : input.url ?? String(input)).hostname
    if (host === 'places.googleapis.com') throw new TypeError('network down')
    return outscraperHandler(new URL(typeof input === 'string' ? input : input.url ?? String(input)))
      ? new Response(JSON.stringify(outscraperHandler(new URL(typeof input === 'string' ? input : input.url ?? String(input)))!.body), { status: 200 })
      : new Response('{}', { status: 404 })
  }) as typeof fetch
  r = await runGbpPublicSnapshot({ businessName: 'Tiệm Nail Hoa' })
  assert.equal(r.source_used, 'outscraper')

  // 12) Không có key Outscraper -> chỉ Places
  delete process.env.OUTSCRAPER_API_KEY
  installFetch(placesHandler)
  r = await runGbpPublicSnapshot({ businessName: 'Tiệm Nail Hoa' })
  assert.equal(r.source_used, 'places')
  assert.ok(!calls.some((c) => c.includes('outscraper')))

  // 13) Link không hợp lệ / thiếu thông tin -> lỗi sớm, không gọi mạng
  process.env.OUTSCRAPER_API_KEY = 'test-key'
  installFetch(() => null)
  r = await runGbpPublicSnapshot({ mapsUrl: 'http://evil.example.com/x' })
  assert.match(r.error || '', /Link không hợp lệ/)
  r = await runGbpPublicSnapshot({})
  assert.match(r.error || '', /Thiếu/)
  assert.equal(calls.length, 0)

  console.log('OK: lớp mạng Outscraper + điều phối nguồn dữ liệu — tất cả kiểm tra đều qua')
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => {
    globalThis.fetch = realFetch
  })
