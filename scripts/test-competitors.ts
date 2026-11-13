// Chạy: npx tsx scripts/test-competitors.ts
import assert from 'node:assert/strict'
import { buildCompetitorSet, buildCompetitorQuery, areaFromAddress, usableCachedSet, median } from '../lib/competitors'
import { runVisibilityChecks } from '../lib/audit-engine/visibility'
import type { AuditInput } from '../lib/audit-engine/types'

const rows = [
  { name: 'Nail A', place_id: 'p1', rating: 4.9, reviews: 400, photos_count: 300, type: 'Tiệm làm móng' },
  { name: 'Nail B', place_id: 'p2', rating: 4.7, reviews: 220, photos_count: 150 },
  { name: 'Tiệm Nail Hoa', place_id: 'me', rating: 4.5, reviews: 60, photos_count: 20 },
  { name: 'Nail C', place_id: 'p3', rating: 4.8, reviews: 5000, photos_count: 900 }, // chuỗi lớn, ngoại lai
  { name: 'Nail D', place_id: 'p4', rating: 4.6, reviews: 180, photos_count: 90 },
]

// query + area
assert.equal(buildCompetitorQuery('Tiệm làm móng', 'Quận 1'), 'Tiệm làm móng Quận 1')
assert.equal(buildCompetitorQuery('Tiệm làm móng', ''), null)
assert.equal(buildCompetitorQuery(null, 'Quận 1'), null)
assert.equal(areaFromAddress('12 Lê Lợi, Quận 1, TP.HCM, Việt Nam'), 'Quận 1, TP.HCM')
assert.equal(areaFromAddress('Hà Nội'), null)

// thứ hạng: khớp theo place_id, loại bản thân khỏi nhóm đối thủ
const set = buildCompetitorSet(rows, { placeId: 'me', name: 'x' }, 'q', new Date('2026-11-13'))
assert.equal(set.selfRank, 3)
assert.equal(set.total, 5)
assert.equal(set.items.length, 4)
assert.ok(!set.items.some((i) => i.placeId === 'me'))
assert.equal(set.items[2].rank, 4) // Nail C giữ nguyên vị trí gốc

// không có place_id -> khớp theo tên; không có -> selfRank null
assert.equal(buildCompetitorSet(rows, { name: 'Tiệm Nail Hoa' }, 'q').selfRank, 3)
assert.equal(buildCompetitorSet(rows, { placeId: 'zzz' }, 'q').selfRank, null)

assert.equal(median([1, 9, 3]), 3)
assert.equal(median([1, 3, 5, 100]), 4)

// cache: đúng query + còn hạn
const now = Date.parse('2026-11-20')
assert.ok(usableCachedSet(set, 'q', now))
assert.equal(usableCachedSet(set, 'other', now), null)
assert.equal(usableCachedSet(set, 'q', Date.parse('2026-12-20')), null) // quá 14 ngày
assert.equal(usableCachedSet({ junk: 1 }, 'q', now), null)

// Visibility checks
const base = { snapshot: { review_count: 60, rating: 4.5, photos_count_est: 20 } } as unknown as AuditInput
const byId = (input?: AuditInput) => Object.fromEntries(runVisibilityChecks(input).map((c) => [c.id, c]))

let v = byId(base)
assert.equal(v.VY01.confidence, 'insufficient')
assert.equal(v.VY03.confidence, 'insufficient')
assert.equal(v.VY02.confidence, 'insufficient')
assert.equal(v.VY04.confidence, 'insufficient')

v = byId({ ...base, visibility: { query: 'q', selfRank: 3, total: 20 }, competitors: set.items })
assert.equal(v.VY01.passed, true)
assert.equal(v.VY01.confidence, 'estimated')
// trung vị review đối thủ = (220+400)/2 = 310 -> 60 < 155 => thua; trung vị ảnh 225 -> 20 < 112 => thua; sao ok (trung vị 4.75, 4.5 < 4.55 => thua)
assert.equal(v.VY03.passed, false)
assert.match(v.VY03.message, /review 60/)
assert.match(v.VY03.action || '', /95 review/) // ceil(310*0.5 - 60) = 95
assert.doesNotMatch(v.VY03.message, /5000/) // ngoại lai không kéo lệch

v = byId({ ...base, visibility: { query: 'q', selfRank: 9, total: 20 } })
assert.equal(v.VY01.passed, false)
v = byId({ ...base, visibility: { query: 'q', selfRank: null, total: 20 } })
assert.equal(v.VY01.passed, false)
assert.match(v.VY01.message, /không nằm trong 20/)

// hồ sơ mạnh -> VY03 đạt
const strong = { snapshot: { review_count: 500, rating: 4.9, photos_count_est: 400 } } as unknown as AuditInput
v = byId({ ...strong, competitors: set.items })
assert.equal(v.VY03.passed, true)

// < 3 đối thủ -> insufficient (không kết luận trên mẫu nhỏ)
v = byId({ ...base, competitors: set.items.slice(0, 2) })
assert.equal(v.VY03.confidence, 'insufficient')

console.log('OK: đối thủ + visibility — tất cả kiểm tra đều qua')
