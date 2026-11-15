import assert from 'node:assert/strict'
import { applyDfsInfo, buildDfsKeyword, enrichWithDataForSeo, needsDfsEnrichment, parseDfsInfo } from '../lib/gbp-dataforseo'
import { mapOutscraperToPayload } from '../lib/gbp-outscraper'

const ok = (item: any) => ({ tasks: [{ status_code: 20000, result: [{ items: [item] }] }] })
const base: any = () => ({
  ...mapOutscraperToPayload({ place_id: 'ChIJ_x1234567', name: 'Nha khoa A', type: 'Nha khoa', rating: 4.8, reviews: 10 }, null, { now: 0 }),
  source_used: 'outscraper',
})

async function main() {
  assert.deepEqual(buildDfsKeyword({ placeId: 'places/ChIJabc1234567' }), { keyword: 'place_id:ChIJabc1234567', by: 'place_id' })
  assert.deepEqual(buildDfsKeyword({ mapsUrl: 'https://maps.google.com/?cid=4152651890767782104&g_mp=x' }), { keyword: 'cid:4152651890767782104', by: 'cid' })
  assert.equal(buildDfsKeyword({ businessName: 'A', area: 'Q3' })!.by, 'name')
  assert.equal(buildDfsKeyword({}), null)

  assert.equal(parseDfsInfo({ tasks: [{ status_code: 40501, result: null }] }), null)
  assert.equal(parseDfsInfo(ok(null)), null)
  const info = parseDfsInfo(ok({ place_id: 'ChIJ_x1234567', cid: 123, description: ' Nha khoa tổng quát. ', category: 'Nha khoa', additional_categories: ['Phòng khám răng', null, 'Nha sĩ'] }))!
  assert.equal(info.description, 'Nha khoa tổng quát.')
  assert.deepEqual(info.additional_categories, ['Phòng khám răng', 'Nha sĩ'])

  const snap = base()
  assert.equal(needsDfsEnrichment(snap), true)
  const out = applyDfsInfo(snap, info, 'place_id', 'ChIJ_x1234567')
  assert.equal(out.description, 'Nha khoa tổng quát.')
  assert.equal(out.additional_categories, 'Phòng khám răng, Nha sĩ')
  assert.equal(out.coverage!.sections.about, 'ok')
  assert.equal(out.coverage!.sections.categories, 'ok')
  assert.ok(out.coverage!.warnings.some((w) => /DataForSEO/.test(w)))
  assert.equal(needsDfsEnrichment(out), false)

  // Không ghi đè dữ liệu có sẵn
  const has = { ...base(), description: 'Mô tả gốc' }
  assert.equal(applyDfsInfo(has, info, 'place_id', 'ChIJ_x1234567').description, 'Mô tả gốc')
  // Sai quán (place_id không khớp) / tra bằng tên -> bỏ qua
  assert.equal(applyDfsInfo(base(), { ...info, place_id: 'ChIJ_other0001' }, 'place_id', 'ChIJ_x1234567').description, null)
  assert.equal(applyDfsInfo(base(), info, 'name', null).description, null)
  // Danh mục phụ trùng danh mục chính bị loại
  const dup = applyDfsInfo(base(), { ...info, additional_categories: ['Nha khoa', 'Chỉnh nha'] }, 'place_id', 'ChIJ_x1234567')
  assert.equal(dup.additional_categories, 'Chỉnh nha')

  // Không cấu hình -> không gọi mạng, trả nguyên
  delete process.env.DATAFORSEO_LOGIN
  const s0 = base()
  assert.equal(await enrichWithDataForSeo(s0, {}), s0)
  // Có cấu hình: mock fetch
  process.env.DATAFORSEO_LOGIN = 'u'; process.env.DATAFORSEO_PASSWORD = 'p'
  const realFetch = globalThis.fetch
  let calls = 0, body: any = null, hdr: any = null
  globalThis.fetch = (async (_u: any, init: any) => { calls++; body = JSON.parse(init.body); hdr = init.headers; return new Response(JSON.stringify(ok({ place_id: 'ChIJ_x1234567', description: 'Mô tả từ DFS', additional_categories: ['Nha sĩ'] })), { status: 200 }) }) as any
  const e = await enrichWithDataForSeo(base(), { placeId: 'ChIJ_x1234567' })
  assert.equal(e.description, 'Mô tả từ DFS'); assert.equal(calls, 1)
  assert.equal(body[0].keyword, 'place_id:ChIJ_x1234567'); assert.equal(body[0].location_code, 2704); assert.match(hdr.Authorization, /^Basic /)
  // Đã đủ thì không gọi
  await enrichWithDataForSeo(e, { placeId: 'ChIJ_x1234567' }); assert.equal(calls, 1)
  // Lỗi mạng/HTTP -> giữ nguyên, không ném
  globalThis.fetch = (async () => { throw new Error('boom') }) as any
  assert.equal((await enrichWithDataForSeo(base(), { placeId: 'ChIJ_x1234567' })).description, null)
  globalThis.fetch = (async () => new Response('{}', { status: 401 })) as any
  assert.equal((await enrichWithDataForSeo(base(), { placeId: 'ChIJ_x1234567' })).description, null)
  globalThis.fetch = realFetch
  console.log('OK: DataForSEO bù mô tả + danh mục phụ, an toàn khi lỗi')
}
main().catch((e) => { console.error(e); process.exit(1) })
