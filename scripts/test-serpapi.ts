import assert from 'node:assert/strict'
import { applySerpInfo, enrichWithSerpApi, needsSerpEnrichment, parseSerpInfo } from '../lib/gbp-serpapi'
import { parseSearchApiInfo } from '../lib/gbp-searchapi'
import { mapOutscraperToPayload } from '../lib/gbp-outscraper'

const NOW = Date.parse('2026-11-16T00:00:00Z')
const base: any = () => ({
  ...mapOutscraperToPayload({ place_id: 'ChIJ_x1234567', name: 'Điện lạnh Minh', type: 'Cửa hàng điện máy', rating: 4.8, reviews: 10 }, null, { now: 0 }),
  source_used: 'outscraper',
})
const json = (over: any = {}) => ({
  place_results: {
    place_id: 'ChIJ_x1234567', description: ' Sửa chữa, vệ sinh điều hòa tại nhà. ', type: ['Cửa hàng điện máy', 'Thợ điện lạnh', 'Dịch vụ sửa chữa'],
    posts: [{ title: 'Khuyến mãi hè', description: 'Vệ sinh điều hòa', date: '2026-11-02' }, { title: '', description: '' }],
    ...over,
  },
})

async function main() {
  const info = parseSerpInfo(json(), NOW)!
  assert.equal(info.description, 'Sửa chữa, vệ sinh điều hòa tại nhà.')
  assert.equal(info.posts!.length, 1, 'bài rỗng bị bỏ')
  assert.equal(info.posts![0].text, 'Khuyến mãi hè — Vệ sinh điều hòa')
  assert.ok(info.posts![0].approx_date, 'ngày ISO đổi được sang "x tuần trước"')
  assert.equal(parseSerpInfo({}, NOW), null)
  assert.equal(parseSerpInfo(json({ posts: undefined }), NOW)!.posts, null, 'không có khóa posts = chưa biết, không phải rỗng')
  assert.equal(parseSerpInfo(json({ posts: [{ title: 'A', date: 'hôm kia lúc nào' }] }), NOW)!.posts![0].approx_date, null, 'ngày lạ không đoán')

  const snap = base()
  assert.equal(needsSerpEnrichment(snap), true)
  const out = applySerpInfo(snap, info, 'ChIJ_x1234567')
  assert.equal(out.description, 'Sửa chữa, vệ sinh điều hòa tại nhà.')
  assert.equal(out.additional_categories, 'Thợ điện lạnh, Dịch vụ sửa chữa', 'loại danh mục chính khỏi danh mục phụ')
  assert.equal(out.primary_category, 'Cửa hàng điện máy', 'không đổi danh mục chính')
  assert.equal(out.recent_posts!.length, 1)
  assert.equal(out.coverage!.sections.about, 'ok')
  assert.equal(out.coverage!.sections.updates, 'ok')
  assert.equal(out.coverage!.sections.categories, 'ok')
  assert.ok(out.coverage!.warnings.some((w) => /SerpApi/.test(w)))
  assert.equal(needsSerpEnrichment(out), false)

  // không ghi đè dữ liệu có sẵn
  assert.equal(applySerpInfo({ ...base(), description: 'Mô tả gốc' }, info, 'ChIJ_x1234567').description, 'Mô tả gốc')
  // sai quán thì bỏ qua
  assert.equal(applySerpInfo(base(), { ...info, place_id: 'ChIJ_other0001' }, 'ChIJ_x1234567').description, null)
  // không có posts khóa -> không tuyên bố "empty"
  const noPosts = applySerpInfo(base(), parseSerpInfo(json({ posts: undefined }), NOW)!, 'ChIJ_x1234567')
  assert.notEqual(noPosts.coverage!.sections.updates, 'ok')
  // nguồn cũng không có gì thêm -> ghi dấu, không tra lại
  const nothing = applySerpInfo(base(), { place_id: 'ChIJ_x1234567', description: null, types: [], posts: null }, 'ChIJ_x1234567')
  assert.equal(needsSerpEnrichment(nothing), false)

  // chưa cấu hình -> không gọi mạng
  delete process.env.SERPAPI_API_KEY
  const s0 = base()
  assert.equal(await enrichWithSerpApi(s0, { placeId: 'ChIJ_x1234567' }), s0)

  // có cấu hình: mock fetch, kiểm tra tham số và xử lý lỗi
  process.env.SERPAPI_API_KEY = 'k'
  const realFetch = globalThis.fetch
  let url = ''
  globalThis.fetch = (async (u: any) => { url = String(u); return new Response(JSON.stringify(json()), { status: 200 }) }) as any
  const got = await enrichWithSerpApi(base(), { placeId: 'places/ChIJ_x1234567' })
  const q = new URL(url).searchParams
  assert.equal(q.get('engine'), 'google_maps'); assert.equal(q.get('type'), 'place'); assert.equal(q.get('place_id'), 'ChIJ_x1234567')
  assert.equal(got.description, 'Sửa chữa, vệ sinh điều hòa tại nhà.')
  globalThis.fetch = (async () => new Response(JSON.stringify({ error: 'Invalid API key' }), { status: 401 })) as any
  const bad = base()
  assert.equal(await enrichWithSerpApi(bad, { placeId: 'ChIJ_x1234567' }), bad, 'lỗi API thì giữ nguyên snapshot')
  globalThis.fetch = (async () => { throw new Error('timeout') }) as any
  assert.equal(await enrichWithSerpApi(bad, { placeId: 'ChIJ_x1234567' }), bad)
  // SerpApi hết hạn mức -> dự phòng SearchApi (khác tên khóa: place_result, type + types, posts[].snippet)
  process.env.SEARCHAPI_API_KEY = 's'
  const seen: string[] = []
  globalThis.fetch = (async (u: any) => {
    seen.push(new URL(String(u)).hostname)
    return String(u).includes('serpapi.com')
      ? new Response(JSON.stringify({ error: 'Your account has run out of searches.' }), { status: 429 })
      : new Response(JSON.stringify({ place_result: { place_id: 'ChIJ_x1234567', description: 'Mô tả từ SearchApi', type: 'Cửa hàng điện máy', types: ['Cửa hàng điện máy', 'Thợ điện lạnh'], posts: [{ snippet: 'Bài mới', date: '2026-11-10' }] } }), { status: 200 })
  }) as any
  const fb = await enrichWithSerpApi(base(), { placeId: 'ChIJ_x1234567' })
  assert.deepEqual(seen, ['serpapi.com', 'www.searchapi.io'])
  assert.equal(fb.description, 'Mô tả từ SearchApi')
  assert.equal(fb.additional_categories, 'Thợ điện lạnh')
  assert.ok(fb.coverage!.warnings.some((w) => /SearchApi/.test(w)))
  const sp = parseSearchApiInfo({ place_result: { place_id: 'x', type: 'A', types: ['A', 'B'], posts: [{ title: 'T', snippet: 'S', date: '2026-11-10' }] } })!
  assert.deepEqual(sp.types, ['A', 'B']); assert.equal(sp.posts![0].text, 'T — S')
  delete process.env.SEARCHAPI_API_KEY
  globalThis.fetch = realFetch
  console.log('OK: SerpApi bù mô tả + danh mục phụ + bài đăng, an toàn khi lỗi / sai quán')
}
main().catch((e) => { console.error(e); process.exit(1) })
