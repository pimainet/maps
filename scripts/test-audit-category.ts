// Chạy: npx tsx scripts/test-audit-category.ts
// R06: danh mục chính so với 3–5 quán đứng đầu (dữ liệu Outscraper đã thu); R02 khoảng trống danh mục phụ.
import assert from 'node:assert/strict'
import { runRelevanceChecks } from '../lib/audit-engine/relevance'
import { buildCompetitorSet } from '../lib/competitors'
import type { AIClassifier, AuditInput } from '../lib/audit-engine/types'

const fakeAI: AIClassifier = { async classify<T>(): Promise<T> { return { matches: true, reason: 'ok', specificity: 'high', relevance: 'high', clarity: 'high', differentiation: 'high', keywordRelevance: 'high', summary: 'ok' } as T } }

// Dữ liệu thô dạng Outscraper (fixture): hồ sơ của mình đứng #4.
const rows = [
  { name: 'Phở Thìn', place_id: 'p1', type: 'Nhà hàng phở', subtypes: 'Nhà hàng phở, Nhà hàng Việt Nam, Quán ăn sáng', rating: 4.5, reviews: 900 },
  { name: 'Phở Lý Quốc Sư', place_id: 'p2', type: 'Nhà hàng phở', subtypes: 'Nhà hàng phở, Nhà hàng Việt Nam', rating: 4.3, reviews: 700 },
  { name: 'Phở Bát Đàn', place_id: 'p3', type: 'Nhà hàng Việt Nam', subtypes: 'Nhà hàng Việt Nam, Nhà hàng phở, Quán ăn sáng', rating: 4.4, reviews: 1200 },
  { name: 'Quán Của Tôi', place_id: 'self', type: 'Nhà hàng', subtypes: 'Nhà hàng', rating: 4.6, reviews: 120 },
  { name: 'Phở 10', place_id: 'p5', type: 'Nhà hàng phở', subtypes: 'Nhà hàng phở', rating: 4.2, reviews: 500 },
  { name: 'Bún chả X', place_id: 'p6', type: 'Nhà hàng bún chả', subtypes: 'Nhà hàng bún chả', rating: 4.1, reviews: 300 },
  { name: 'Chay Y', place_id: 'p7', type: 'Nhà hàng chay', subtypes: 'Nhà hàng chay', rating: 4.0, reviews: 90 },
]
const set = buildCompetitorSet(rows, { placeId: 'self' }, 'Nhà hàng Hoàn Kiếm', new Date('2026-11-28T00:00:00Z'))
assert.equal(set.selfRank, 4)

const snapshot = (primary: string | null, additional: string | null = null) =>
  ({ status: 'ok', primary_category: primary, additional_categories: additional, coverage: { sections: { categories: 'ok' } } }) as unknown as AuditInput['snapshot']
const run = async (s: AuditInput['snapshot'], competitors = set.items) =>
  (await runRelevanceChecks({ snapshot: s, declaredIndustry: 'Phở', competitors }, fakeAI))

async function main() {
// 1) Danh mục chính lệch so với top -> chưa đạt, gợi ý danh mục phổ biến nhất (dữ liệu thật, không bịa).
let checks = await run(snapshot('Nhà hàng'))
let r06 = checks.find((c) => c.id === 'R06')!
assert.equal(r06.passed, false)
assert.match(r06.message, /Nhà hàng phở 3\/5/)
assert.match(r06.action!, /"Nhà hàng phở"/)
assert.equal(checks[1].id, 'R06', 'R06 đứng ngay sau R01')

// 2) Trùng danh mục phổ biến (bỏ dấu/hoa thường vẫn khớp) -> đạt.
r06 = (await run(snapshot('nha hang PHO'))).find((c) => c.id === 'R06')!
assert.equal(r06.passed, true)
// Trùng quán #1 dù không phải phổ biến nhất -> đạt.
const altTop = set.items.map((c, i) => (i === 0 ? { ...c, category: 'Nhà hàng Việt Nam' } : c))
assert.equal((await run(snapshot('Nhà hàng Việt Nam'), altTop)).find((c) => c.id === 'R06')!.passed, true)

// 3) Chỉ xét 5 đối thủ đứng đầu theo rank (không tính hồ sơ của mình): quán #7 (chay) bị bỏ.
assert.doesNotMatch((await run(snapshot('Nhà hàng'))).find((c) => c.id === 'R06')!.message, /chay/)
assert.equal((await run(snapshot('Nhà hàng'), [...set.items].reverse())).find((c) => c.id === 'R06')!.passed, false, 'xếp theo rank, không theo thứ tự mảng')

// 4) Thiếu dữ liệu -> chưa đủ dữ liệu, không kết luận.
assert.equal((await run(snapshot(null))).find((c) => c.id === 'R06')!.passed, null)
assert.equal((await run(snapshot('Nhà hàng'), set.items.slice(0, 2))).find((c) => c.id === 'R06')!.passed, null)
assert.equal((await run(snapshot('Nhà hàng'), [])).find((c) => c.id === 'R06')!.passed, null)
assert.equal((await run(snapshot('Nhà hàng'), set.items.map((c) => ({ ...c, category: null })))).find((c) => c.id === 'R06')!.passed, null)

// 5) R02: khoảng trống danh mục phụ dựa trên cùng dữ liệu.
const r02 = (await run(snapshot('Nhà hàng phở', 'Nhà hàng Việt Nam'))).find((c) => c.id === 'R02')!
assert.equal(r02.passed, false)
assert.match(r02.message, /Quán ăn sáng/)

console.log('OK: danh mục chính so với quán top (R06) + danh mục phụ (R02) — tất cả kiểm tra đều qua')
}

main().catch((e) => { console.error(e); process.exit(1) })
