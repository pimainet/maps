// Dữ liệu CHƯA ĐỌC ĐƯỢC không được biến thành kết luận "thiếu"; R02 so với danh mục phụ của quán top.
import assert from 'node:assert/strict'
import { runAudit, type AIClassifier, type AuditInput } from '../lib/audit-engine'
import { parseSubcategories, buildCompetitorSet, usableCachedSet } from '../lib/competitors'
import { mapOutscraperToPayload } from '../lib/gbp-outscraper'

const ai: AIClassifier = {
  async classify<T>(): Promise<T> {
    return { matches: true, reason: 'ok', specificity: 'high', relevance: 'high', clarity: 'high', differentiation: 'high',
      keywordRelevance: 'high', summary: 'ok', repetitive: false, hasDuplication: false, hasCTA: true,
      liked: [], complained: [], mentionedServices: [], recurringIssue: null } as unknown as T
  },
}
const NOW = new Date('2026-11-15T00:00:00Z')
const byId = (r: any, id: string) => r.checks.find((c: any) => c.id === id)

const raw = (extra: any = {}): any => ({
  place_id: 'ChIJ_x1234567', name: 'Nha khoa Tâm An', type: 'Nha khoa', subtypes: 'Nha khoa, Phòng khám răng, Nha sĩ',
  rating: 4.8, reviews: 100, photos_count: 41, full_address: 'Q3', ...extra,
})

async function main() {
  // Outscraper không trả description và posts -> các check này phải "insufficient", KHÔNG failed
  const snap = mapOutscraperToPayload(raw(), null, { now: NOW.getTime() })
  assert.equal(snap.coverage?.sections.categories, 'ok')
  assert.equal(snap.additional_categories, 'Phòng khám răng, Nha sĩ')
  const rep = await runAudit({ snapshot: snap as any, declaredIndustry: 'Nha khoa', now: NOW }, ai)
  assert.equal(byId(rep, 'R04').passed, null, 'thiếu mô tả = chưa đọc được')
  assert.equal(byId(rep, 'R04').confidence, 'insufficient')
  assert.equal(byId(rep, 'C01').passed, null, 'thiếu bài đăng = chưa đọc được')
  assert.match(byId(rep, 'C01').message, /không kết luận/)

  // Source trả posts: [] tường minh -> được kết luận "không có bài" (estimated)
  const snapEmpty = mapOutscraperToPayload(raw({ posts: [] }), null, { now: NOW.getTime() })
  const repEmpty = await runAudit({ snapshot: snapEmpty as any, declaredIndustry: 'Nha khoa', now: NOW }, ai)
  assert.equal(byId(repEmpty, 'C01').passed, false)

  // Có mô tả: vẫn chấm như cũ
  const snapDesc = mapOutscraperToPayload(raw({ description: 'Nha khoa tổng quát, niềng răng, implant tại Quận 3.' }), null, { now: NOW.getTime() })
  const repDesc = await runAudit({ snapshot: snapDesc as any, declaredIndustry: 'Nha khoa', now: NOW }, ai)
  assert.notEqual(byId(repDesc, 'R04').passed, null)

  // R02: không có subtypes -> chưa đọc được
  const snapNoSub = mapOutscraperToPayload(raw({ subtypes: undefined }), null, { now: NOW.getTime() })
  assert.equal(snapNoSub.coverage?.sections.categories, 'not_found')
  const comps = (rows: string[][]) => rows.map((subs, i) => ({ name: `Q${i}`, category: 'Nha khoa', subcategories: subs, rank: i + 1 }))
  const repNoSub = await runAudit({ snapshot: snapNoSub as any, competitors: comps([['A'], ['A'], ['A']]), now: NOW }, ai)
  assert.equal(byId(repNoSub, 'R02').passed, null)

  // R02: quán top dùng "Phòng khám nha khoa" & "Bác sĩ chỉnh nha", hồ sơ thiếu
  const top = comps([
    ['Phòng khám răng', 'Bác sĩ chỉnh nha', 'Phòng khám nha khoa'],
    ['Bác sĩ chỉnh nha', 'Phòng khám nha khoa'],
    ['Phòng khám nha khoa'],
    ['Bác sĩ chỉnh nha', 'Nha sĩ'],
    ['Cơ sở cấy ghép răng'],
  ])
  const r02 = byId(await runAudit({ snapshot: snap as any, competitors: top, now: NOW }, ai), 'R02')
  assert.equal(r02.passed, false)
  assert.match(r02.message, /Bác sĩ chỉnh nha \(3\/5/)
  assert.match(r02.message, /Phòng khám nha khoa \(3\/5/)
  assert.ok(!/Phòng khám răng \(/.test(r02.message), 'danh mục đã có không bị nêu là thiếu (so khớp bỏ dấu/hoa thường)')
  assert.ok(!/Cơ sở cấy ghép/.test(r02.message), 'danh mục hiếm (1/5) không nêu')

  // R02 đạt khi đã có đủ phần phổ biến
  const full = { ...snap, additional_categories: 'Phòng khám răng, Bác sĩ chỉnh nha, Phòng khám nha khoa' }
  assert.equal(byId(await runAudit({ snapshot: full as any, competitors: top, now: NOW }, ai), 'R02').passed, true)
  // Chưa có danh mục phụ nào (nhưng đọc được) -> fail
  const none = { ...snap, additional_categories: null, coverage: { ...snap.coverage!, sections: { ...snap.coverage!.sections, categories: 'ok' as const } } }
  assert.equal(byId(await runAudit({ snapshot: none as any, competitors: top, now: NOW }, ai), 'R02').passed, false)
  // Ít hơn 3 quán có dữ liệu -> chưa kết luận
  assert.equal(byId(await runAudit({ snapshot: snap as any, competitors: comps([['A'], ['B']]), now: NOW }, ai), 'R02').passed, null)

  // Tiện ích thu thập
  assert.deepEqual(parseSubcategories('Nha khoa, Nha Sĩ, nha sĩ, ', 'Nha khoa'), ['Nha Sĩ'])
  assert.deepEqual(parseSubcategories(['A', 'B'], 'a'), ['B'])
  const set = buildCompetitorSet([raw(), { place_id: 'ChIJ_other0001', name: 'Khác', type: 'Nha khoa', subtypes: 'Nha khoa, Chỉnh nha' }], { placeId: 'ChIJ_x1234567' }, 'q', NOW)
  assert.deepEqual(set.items[0].subcategories, ['Chỉnh nha'])
  // Cache cũ (chưa có subcategories) bị bỏ để lấy lại
  const old = { source: 'outscraper', query: 'q', fetchedAt: NOW.toISOString(), selfRank: 1, total: 1, items: [{ name: 'a', rank: 1 }] }
  assert.equal(usableCachedSet(old, 'q', NOW.getTime()), null)
  assert.ok(usableCachedSet(set, 'q', NOW.getTime()))
  console.log('OK: dữ liệu chưa đọc được không bị coi là thiếu; R02 so với quán top')
}
main().catch((e) => { console.error(e); process.exit(1) })
