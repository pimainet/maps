// Chạy: npx tsx scripts/test-audit-weighting.ts
// Kiểm chứng cách tính điểm v3: trọng số theo từng check, chuẩn hoá minh bạch, không đếm trùng nhóm Chuyển đổi.
import assert from 'node:assert/strict'
import { CHECK_WEIGHTS, WEIGHT_BUCKETS, weightOf, MIN_WEIGHT_COVERAGE_PCT } from '../lib/audit-engine/weights'
import { scoreChecks, scoreAllTiers, weightingOf, isScored } from '../lib/audit-engine/scoring'
import { pickTopOpportunities } from '../lib/audit-engine/priority'
import { runConversionChecks } from '../lib/audit-engine/conversion'
import type { CheckResult } from '../lib/audit-engine/types'

const mk = (id: string, group: CheckResult['group'], passed: boolean | null, extra: Partial<CheckResult> = {}): CheckResult => ({
  id, group, label: id, severity: 'medium', confidence: passed === null ? 'insufficient' : 'verified', passed, message: id, action: `Sửa ${id}`, ...extra,
})

// 0) Bảng trọng số: các nhóm trong bảng cộng lại đúng như tài liệu; mục suy ra / insight = 0.
const sumIds = (ids: string[]) => ids.reduce((s, id) => s + weightOf(id), 0)
const bucket = Object.fromEntries(WEIGHT_BUCKETS.map((b) => [b.key, sumIds(b.ids)]))
assert.equal(bucket.relevance, 25)
assert.equal(bucket.reviews, 25)
assert.equal(bucket.visibility, 20)
assert.equal(bucket.foundation, 15)
assert.equal(bucket.media, 5)
assert.equal(bucket.website, 10)
assert.equal(Object.values(CHECK_WEIGHTS).reduce((a, b) => a + b, 0), 100, 'tổng trọng số 100')
for (const id of ['CV01', 'CV02', 'CV03', 'CV04', 'T06', 'C03', 'C04', 'V02', 'V03', 'V04']) assert.equal(CHECK_WEIGHTS[id], 0, id)
// mọi id có trọng số > 0 đều nằm trong đúng 1 nhóm của bảng (bảng in ra tài liệu/giao diện không sót mục)
const listed = WEIGHT_BUCKETS.flatMap((b) => b.ids)
for (const [id, w] of Object.entries(CHECK_WEIGHTS)) if (w > 0) assert.equal(listed.filter((x) => x === id).length, 1, id)

// 1) Một mục đơn lẻ không còn chiếm 1/7 điểm: hồ sơ đạt ảnh + bài đăng nhưng trượt sao và danh mục.
const real = [
  mk('R01', 'relevance', false), mk('T01', 'trust', false), mk('T02', 'trust', false),
  mk('V01', 'visual', true), mk('C01', 'content', true), mk('C02', 'content', null),
  mk('F01', 'foundation', true), mk('F02', 'foundation', true),
]
const s = scoreChecks(real)!
const knownW = sumIds(['R01', 'T01', 'T02', 'V01', 'C01', 'F01', 'F02'])
const passW = sumIds(['V01', 'C01', 'F01', 'F02'])
assert.equal(s, Math.round((passW / knownW) * 100))
assert.ok(s < 40, 'trượt danh mục + sao thì điểm thấp dù đạt ảnh và bài đăng')
const w = weightingOf(real)
assert.equal(w.knownWeight, knownW)
assert.equal(w.totalWeight, knownW + weightOf('C02'))
const v01 = w.checks.find((c) => c.id === 'V01')!.effectivePct
assert.equal(v01, Math.round((weightOf('V01') / knownW) * 1000) / 10)
assert.ok(v01 < 10, 'ảnh: dưới 10% thực tế, không phải 14,3% như v2')
assert.equal(w.checks.find((c) => c.id === 'C02')!.effectivePct, 0, 'mục thiếu dữ liệu: 0% thực tế')
const effSum = w.checks.reduce((a, c) => a + c.effectivePct, 0)
assert.ok(Math.abs(effSum - 100) < 0.5, 'trọng số thực tế cộng lại ~100%')

// 2) Nhóm điểm: theo trọng số trong nhóm; nhóm chỉ hiển thị có weight 0.
const tiers = scoreAllTiers([...real, ...runConversionChecks(real)])
assert.equal(tiers.find((t) => t.group === 'foundation')!.score, 100)
assert.equal(tiers.find((t) => t.group === 'content')!.weight, 3)
assert.equal(tiers.find((t) => t.group === 'conversion')!.weight, 0)
assert.equal(tiers.find((t) => t.group === 'conversion')!.score, null)

// 3) Không đếm trùng: website hỏng (F06) chỉ bị trừ đúng trọng số của F06, các mục CV suy ra không kéo điểm thêm.
const base = [mk('F04', 'foundation', true), mk('F05', 'foundation', true), mk('F06', 'foundation', true), mk('F07', 'foundation', true), mk('T02', 'trust', true), mk('V01', 'visual', true), mk('R01', 'relevance', true), mk('R04', 'relevance', true)]
const broken = base.map((c) => (c.id === 'F06' ? { ...c, passed: false } : c))
const withCv = (cs: CheckResult[]) => [...cs, ...runConversionChecks(cs)]
const known = sumIds(base.map((c) => c.id))
assert.equal(scoreChecks(withCv(base)), 100)
assert.equal(scoreChecks(withCv(broken)), Math.round(((known - weightOf('F06')) / known) * 100))
assert.ok(runConversionChecks(broken).some((c) => c.passed === false), 'CV vẫn hiện để giải thích')
assert.ok(runConversionChecks(broken).every((c) => !isScored(c)))

// 4) Quá ít dữ liệu (< 30% trọng số) -> không chấm điểm tổng.
const thin = [mk('C01', 'content', true), mk('R01', 'relevance', null), mk('T01', 'trust', null), mk('T02', 'trust', null), mk('VY04', 'visibility', null)]
assert.equal(scoreChecks(thin), null)
assert.ok(weightingOf(thin).coveragePct < MIN_WEIGHT_COVERAGE_PCT)

// 5) Ưu tiên việc theo trọng số; lỗi nghiêm trọng luôn đứng đầu; mục suy ra không lặp lại.
const top = pickTopOpportunities([
  mk('C01', 'content', false, { severity: 'high' }),
  mk('R01', 'relevance', false, { severity: 'high' }),
  mk('F02', 'foundation', false, { severity: 'critical' }),
  mk('T05', 'trust', false),
  mk('CV04', 'conversion', false, { severity: 'high', scored: false }),
])
assert.deepEqual(top.map((o) => o.checkId), ['F02', 'R01', 'T05', 'C01'])

console.log('OK: cách tính điểm v3 (trọng số) — tất cả kiểm tra đều qua')
