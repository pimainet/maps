// Chạy: npx tsx scripts/test-audit-determinism.ts
// Kiểm chứng: điểm audit v2 lặp lại được, AI không làm điểm dao động, so sánh 2 lần audit công bằng.
import assert from 'node:assert/strict'
import {
  runAudit,
  createCachedClassifier,
  memoryClassifierStore,
  diffAuditReports,
  ENGINE_VERSION,
  type AIClassifier,
  type AuditInput,
  type AuditReport,
  type CheckResult,
} from '../lib/audit-engine'
import { scoreOnSubset, coverageOf } from '../lib/audit-engine/scoring'
import { applyStabilityFlags } from '../lib/audit-engine/stability'
import { parseNarrative, fallbackNarrative, generateNarrative } from '../lib/audit-engine/narrative'
import { renderAuditText } from '../lib/audit-engine/render-text'
import { isSafePublicUrl } from '../lib/audit-engine/check-website'
import { classifierCacheKey } from '../lib/audit-engine/classifier-cache'
import { getAuditEngineMode } from '../lib/audit-mode'
import { parseAuditResult } from '../lib/audit-parse'

const NOW = new Date('2026-11-14T00:00:00Z')

const snapshot: AuditInput['snapshot'] = {
  place_id: 'ChIJ_test',
  business_name: 'Nội Thất Test',
  description: 'Chuyên thiết kế và thi công nội thất trọn gói tại Thanh Hóa, bảo hành 5 năm.',
  primary_category: 'Cửa hàng nội thất',
  additional_categories: 'Nhà thầu nội thất',
  opening_hours: 'Thứ 2–Thứ 7: 8:00–17:30',
  rating: 4.6,
  review_count: 80,
  phone: '0912345678',
  website_url: 'https://example.com',
  address_text: '12 Lê Lợi, Thanh Hóa',
  recent_posts: [
    { text: 'Ưu đãi tháng 11 cho tủ bếp', approx_date: '1 tuần trước' },
    { text: 'Công trình mới hoàn thiện', approx_date: '2 tuần trước' },
    { text: 'Mẫu giường mới về', approx_date: '3 tuần trước' },
  ],
  photos_count_est: 24,
  reviews: [
    { rating: 5, text: 'Làm đẹp, đúng hẹn' },
    { rating: 4, text: 'Giao hàng hơi trễ' },
    { rating: 5, text: 'Tư vấn nhiệt tình' },
    { rating: 3, text: 'Giao hàng trễ lần nữa' },
  ],
  review_stats: {
    loaded: 20, with_text: 18, newest_age_days: 5, oldest_age_days: 120, last_30d: 6, last_90d: 14,
    window_complete: true, replied: 14, reply_rate: 0.7, avg_rating_loaded: 4.5, low_rating_count: 2,
  },
}

const baseInput: AuditInput = {
  snapshot,
  claimedBusinessName: 'Nội Thất Test',
  declaredIndustry: 'Nội thất',
  websiteReachable: true,
  competitors: [
    { name: 'A', reviewCount: 100, rating: 4.5, photoCountEst: 40 },
    { name: 'B', reviewCount: 90, rating: 4.4, photoCountEst: 30 },
    { name: 'C', reviewCount: 120, rating: 4.7, photoCountEst: 50 },
  ],
  visibility: { query: 'Cửa hàng nội thất Thanh Hóa', selfRank: 4, total: 20 },
  now: NOW,
}

/** Classifier "hay thay đổi ý": mỗi lần gọi trả kết quả khác nhau — mô phỏng LLM không tất định. */
function flakyClassifier(): AIClassifier & { calls: number } {
  const c = {
    calls: 0,
    async classify<T>(): Promise<T> {
      c.calls++
      const even = c.calls % 2 === 0
      return {
        matches: !even,
        reason: even ? 'không khớp' : 'khớp',
        specificity: even ? 'low' : 'high', relevance: even ? 'low' : 'high', clarity: even ? 'low' : 'high',
        differentiation: even ? 'low' : 'high', keywordRelevance: even ? 'low' : 'high', summary: 'tóm tắt',
        repetitive: even, hasDuplication: even, hasCTA: !even,
        liked: ['tư vấn'], complained: ['giao trễ'], mentionedServices: [], recurringIssue: even ? 'giao hàng trễ' : null,
      } as unknown as T
    },
  }
  return c
}

async function main() {
  // 1) Cùng đầu vào + classifier tất định => báo cáo y hệt.
  const fixed: AIClassifier = {
    async classify<T>(): Promise<T> {
      return { matches: true, reason: 'khớp', specificity: 'high', relevance: 'high', clarity: 'high', differentiation: 'medium',
        keywordRelevance: 'high', summary: 'ok', repetitive: false, hasDuplication: false, hasCTA: true,
        liked: [], complained: [], mentionedServices: [], recurringIssue: null } as unknown as T
    },
  }
  const r1 = await runAudit(baseInput, fixed)
  const r2 = await runAudit(baseInput, fixed)
  assert.deepEqual(r1, r2)
  assert.equal(r1.engineVersion, ENGINE_VERSION)
  assert.ok(r1.overallScore != null)

  // 2) Classifier thất thường: KHÔNG cache => điểm dao động; CÓ cache => 2 lần chạy cho cùng điểm.
  const flakyNoCache = flakyClassifier()
  const a = await runAudit(baseInput, flakyNoCache)
  const b = await runAudit(baseInput, flakyNoCache)
  assert.notEqual(a.overallScore, b.overallScore, 'giả định của test: không cache thì điểm dao động')

  const store = memoryClassifierStore()
  const inner = flakyClassifier()
  const cached1 = createCachedClassifier(inner, store)
  const c1 = await runAudit(baseInput, cached1)
  const callsAfterFirst = inner.calls
  const cached2 = createCachedClassifier(inner, store)
  const c2 = await runAudit(baseInput, cached2)
  assert.equal(c1.overallScore, c2.overallScore, 'cache => điểm lặp lại được')
  assert.deepEqual(c1.checks, c2.checks)
  assert.equal(inner.calls, callsAfterFirst, 'lần 2 không gọi AI thêm')
  assert.equal(cached2.stats.misses, 0)
  assert.ok(cached2.stats.hits > 0)

  // Đổi dữ liệu (mô tả mới) => phải phân loại lại, không dùng nhầm kết quả cũ.
  const changed = { ...baseInput, snapshot: { ...snapshot, description: 'Mô tả hoàn toàn khác, rất ngắn.' } }
  const cached3 = createCachedClassifier(inner, store)
  await runAudit(changed, cached3)
  assert.ok(cached3.stats.misses > 0)
  assert.notEqual(classifierCacheKey({ system: 's', user: 'a' }), classifierCacheKey({ system: 's', user: 'b' }))

  // Lỗi AI không bị cache, và cache hỏng không làm hỏng audit.
  const broken = createCachedClassifier(
    { async classify() { throw new Error('boom') } },
    { async get() { throw new Error('db down') }, async set() { throw new Error('db down') } },
  )
  const rBroken = await runAudit(baseInput, broken)
  assert.ok(rBroken.checks.find((c) => c.id === 'R01')?.passed === null, 'AI lỗi => insufficient, không bịa')

  // 3) T06 là insight: không tính vào điểm, kể cả khi AI báo có vấn đề lặp lại.
  const withIssue: AIClassifier = { async classify<T>(i: any): Promise<T> {
    const out = await fixed.classify<any>(i); return { ...out, recurringIssue: 'giao trễ' } as T } }
  const noIssue = fixed
  const rIssue = await runAudit(baseInput, withIssue)
  const rClean = await runAudit(baseInput, noIssue)
  assert.equal(rIssue.checks.find((c) => c.id === 'T06')?.scored, false)
  assert.equal(rIssue.checks.find((c) => c.id === 'T06')?.passed, false)
  assert.equal(rIssue.overallScore, rClean.overallScore)
  assert.equal(rClean.coverage!.informational, 1)

  // Check nhiễu được gắn cờ volatile.
  for (const id of ['C01', 'C02', 'V01', 'T05']) assert.equal(r1.checks.find((c) => c.id === id)?.volatile, true, id)
  assert.equal(r1.checks.find((c) => c.id === 'F05')?.volatile, undefined)

  // 4) Thiếu dữ liệu không bị trừ điểm.
  const sparse = await runAudit({ ...baseInput, competitors: undefined, visibility: undefined }, fixed)
  assert.ok(sparse.coverage!.insufficient > r1.coverage!.insufficient)
  assert.ok(sparse.overallScore != null)

  // 5) So sánh cùng điều kiện.
  const mk = (id: string, group: CheckResult['group'], passed: boolean | null, extra: Partial<CheckResult> = {}): CheckResult => ({
    id, group, label: id, severity: 'high', confidence: passed === null ? 'insufficient' : 'verified', passed, message: id, ...extra,
  })
  const report = (checks: CheckResult[], version: string | undefined = ENGINE_VERSION): AuditReport => {
    const flagged = applyStabilityFlags(checks)
    const tiers = [...new Set(flagged.map((c) => c.group))].map((g) => ({ group: g, score: scoreOnSubset(flagged.filter((c) => c.group === g)), checkedCount: 0, insufficientCount: 0 }))
    return { checks: flagged, tierScores: tiers as any, overallScore: scoreOnSubset(flagged), topOpportunities: [], generatedAt: '', engineVersion: version, coverage: coverageOf(flagged) }
  }

  // (a) lần 2 đọc được thêm dữ liệu (nhóm mới) -> điểm tổng thô nhảy, nhưng điểm cùng điều kiện = 0 và không có thay đổi thật
  const prev = report([mk('F05', 'foundation', true), mk('F06', 'foundation', false), mk('T01', 'trust', null)])
  const last = report([mk('F05', 'foundation', true), mk('F06', 'foundation', false), mk('T01', 'trust', false), mk('T02', 'trust', false)])
  const d1 = diffAuditReports(prev, last)
  assert.notEqual(d1.overallScoreDelta, 0, 'điểm thô lệch do độ phủ khác nhau')
  assert.equal(d1.comparableScoreDelta, 0)
  assert.equal(d1.hasRealChange, false)
  assert.equal(d1.comparableChecks, 2)
  assert.equal(d1.newlyVerified.length, 1)

  // (b) khách sửa website: cải thiện thật
  const d2 = diffAuditReports(prev, report([mk('F05', 'foundation', true), mk('F06', 'foundation', true), mk('T01', 'trust', null)]))
  assert.deepEqual(d2.improved.map((x) => x.id), ['F06'])
  assert.ok(d2.comparableScoreDelta! > 0)
  assert.equal(d2.hasRealChange, true)

  // (c) check nhiễu rớt đạt -> không đạt: chưa tính là xấu đi, không kéo điểm
  const pN = report([mk('F05', 'foundation', true), mk('C01', 'content', true)])
  const lN = report([mk('F05', 'foundation', true), mk('C01', 'content', false)])
  const d3 = diffAuditReports(pN, lN)
  assert.deepEqual(d3.unconfirmed.map((x) => x.id), ['C01'])
  assert.equal(d3.regressed.length, 0)
  assert.equal(d3.comparableScoreDelta, 0)
  // check ổn định rớt => regressed thật
  const d4 = diffAuditReports(report([mk('F05', 'foundation', true)]), report([mk('F05', 'foundation', false)]))
  assert.deepEqual(d4.regressed.map((x) => x.id), ['F05'])
  assert.ok(d4.comparableScoreDelta! < 0)

  // (d) T06 (insight) đổi trạng thái không phải "thay đổi"
  const d5 = diffAuditReports(report([mk('F05', 'foundation', true), mk('T06', 'trust', true)]), report([mk('F05', 'foundation', true), mk('T06', 'trust', false)]))
  assert.equal(d5.hasRealChange, false)

  // (e) khác major version -> không so; báo cáo cũ không có engineVersion coi như major 2
  const d6 = diffAuditReports(report([mk('F05', 'foundation', true)], '1.0.0'), report([mk('F05', 'foundation', false)]))
  assert.equal(d6.comparable, false)
  assert.equal(d6.regressed.length, 0)
  const d7 = diffAuditReports(report([mk('F05', 'foundation', true)], undefined), report([mk('F05', 'foundation', true)]))
  assert.equal(d7.comparable, true)

  // 6) Lời AI không được tự đưa điểm; checkId lạ bị bỏ; AI lỗi => lời dựng bằng code.
  assert.equal(parseNarrative({ summary: 'Hồ sơ đạt 8/10 rất tốt' }, new Set()), null)
  assert.equal(parseNarrative({ summary: 'Điểm tổng: 7 nên ổn' }, new Set()), null)
  const pn = parseNarrative(
    { summary: '**Hồ sơ khá ổn**', strengths: ['Có website', 'Đạt 9/10 về ảnh'], opportunities: [{ checkId: 'F06', text: 'Thêm website' }, { checkId: 'ZZ', text: 'bịa' }] },
    new Set(['F06']),
  )
  assert.ok(pn)
  assert.equal(pn!.summary, 'Hồ sơ khá ổn')
  assert.deepEqual(pn!.strengths, ['Có website'])
  assert.deepEqual(Object.keys(pn!.opportunities), ['F06'])
  const failing: AIClassifier = { async classify() { throw new Error('down') } }
  const nar = await generateNarrative(failing, { report: r1, business: { name: 'X' } })
  assert.equal(nar.source, 'fallback')
  const narBad = await generateNarrative({ async classify<T>(): Promise<T> { return { nonsense: true } as unknown as T } }, { report: r1, business: {} })
  assert.equal(narBad.source, 'fallback')

  // 7) Văn bản dựng theo khung cũ: parseAuditResult đọc đúng số do code tính; lộ trình 30 ngày dùng được.
  const text = renderAuditText(r1, fallbackNarrative(r1))
  for (const h of ['### 1.', '### 2.', '### 3.', '### 4.', '### 5.', '### 6.', '### 7.']) assert.ok(text.includes(h), h)
  const parsed = parseAuditResult(text)
  assert.equal(parsed.overall, Math.round(r1.overallScore!) / 10)
  assert.ok(parsed.strengths.length > 0)
  assert.equal(renderAuditText(r1, fallbackNarrative(r1)), text, 'dựng chữ cũng tất định')
  const textSparse = renderAuditText(sparse, fallbackNarrative(sparse))
  assert.ok(textSparse.includes('### 8.'), 'liệt kê mục chưa đủ dữ liệu để lộ trình không coi là "thiếu"')

  // 8) T04: cần ≥7 ngày; dao động nhỏ không phải "giảm bất thường".
  const t04 = async (history: AuditInput['reviewCountHistory']) =>
    (await runAudit({ ...baseInput, reviewCountHistory: history }, fixed)).checks.find((c) => c.id === 'T04')!
  assert.equal((await t04([{ capturedAt: '2026-11-13T00:00:00Z', reviewCount: 80 }, { capturedAt: '2026-11-14T00:00:00Z', reviewCount: 81 }])).passed, null)
  assert.equal((await t04([{ capturedAt: '2026-10-01T00:00:00Z', reviewCount: 80 }, { capturedAt: '2026-11-14T00:00:00Z', reviewCount: 79 }])).passed, true)
  assert.equal((await t04([{ capturedAt: '2026-10-01T00:00:00Z', reviewCount: 80 }, { capturedAt: '2026-11-14T00:00:00Z', reviewCount: 60 }])).passed, false)
  assert.equal((await t04([{ capturedAt: '2026-10-01T00:00:00Z', reviewCount: 60 }, { capturedAt: '2026-11-14T00:00:00Z', reviewCount: 80 }])).passed, true)

  // 9) Chống SSRF khi kiểm tra website của khách (URL do bên thứ ba kiểm soát).
  for (const bad of ['http://localhost/x', 'http://127.0.0.1', 'http://10.0.0.5', 'http://169.254.169.254/latest/meta-data', 'http://192.168.1.1',
    'http://172.20.0.1', 'http://[::1]/', 'http://metadata.internal', 'http://intranet', 'file:///etc/passwd', 'ftp://example.com', 'http://user:pw@example.com', 'not a url'])
    assert.equal(isSafePublicUrl(bad), false, bad)
  for (const good of ['https://example.com', 'http://khachhang.vn/trang', 'https://sub.domain.co.uk:8443/a?b=1'])
    assert.equal(isSafePublicUrl(good), true, good)

  // 10) Công tắc engine: mặc định v1, giá trị lạ => v1.
  assert.equal(getAuditEngineMode(undefined), 'v1')
  assert.equal(getAuditEngineMode(''), 'v1')
  assert.equal(getAuditEngineMode('V2'), 'v2')
  assert.equal(getAuditEngineMode(' shadow '), 'shadow')
  assert.equal(getAuditEngineMode('bật'), 'v1')

  console.log('OK: audit v2 tất định + cache + so sánh cùng điều kiện + chống SSRF — tất cả kiểm tra đều qua')
}

main().catch((e) => { console.error(e); process.exit(1) })
