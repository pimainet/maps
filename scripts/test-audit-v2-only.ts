// Chạy: npx tsx scripts/test-audit-v2-only.ts
// Engine chấm điểm duy nhất (v2): đường đi đầy đủ với fixture + AI giả, văn bản cho lộ trình 30 ngày, cắt theo gói,
// so sánh với lần trước (kể cả audit kiểu cũ), hiển thị audit kiểu cũ, và chốt chặn: không còn dấu vết engine cũ trong code.
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import {
  runAudit, createCachedClassifier, memoryClassifierStore, ENGINE_VERSION,
  type AIClassifier, type AuditInput,
} from '../lib/audit-engine'
import { fallbackNarrative, generateNarrative } from '../lib/audit-engine/narrative'
import { renderAuditText } from '../lib/audit-engine/render-text'
import { parseAuditResult } from '../lib/audit-parse'
import { buildScoreOverride } from '../components/dashboard/audit-report-extras'
import { shapeAuditPayload, shapeAuditRow } from '../lib/billing/shape'
import { ENTITLEMENTS } from '../lib/billing/plans'
import { PLAN_30_DAYS_PROMPT } from '../lib/prompts'
import { buildAuditComparison } from '../lib/audit-comparison'
import { storedAuditKind, legacyAuditNotice } from '../lib/audit-legacy'

const NOW = new Date('2026-11-28T00:00:00Z')
const snapshot: AuditInput['snapshot'] = {
  place_id: 'ChIJ_v2only', business_name: 'Hải Sản Sầm Sơn Test',
  description: 'Nhà hàng hải sản tươi sống ngay bãi biển Sầm Sơn, phục vụ nhóm đông, có phòng riêng.',
  primary_category: 'Nhà hàng hải sản', additional_categories: 'Quán ăn', opening_hours: 'Hằng ngày: 9:00–22:00',
  rating: 4.4, review_count: 210, phone: '0912345678', website_url: 'https://example.com',
  address_text: '1 Hồ Xuân Hương, Sầm Sơn, Thanh Hóa',
  recent_posts: [{ text: 'Cua hoàng đế về hàng', approx_date: '1 tuần trước' }, { text: 'Menu mùa hè', approx_date: '3 tuần trước' }],
  photos_count_est: 40,
  reviews: [{ rating: 5, text: 'Hải sản tươi, giá ổn' }, { rating: 2, text: 'Chờ món lâu' }],
  review_stats: { loaded: 20, with_text: 18, newest_age_days: 3, oldest_age_days: 100, last_30d: 9, last_90d: 20, window_complete: true, replied: 4, reply_rate: 0.2, avg_rating_loaded: 4.3, low_rating_count: 4 },
}
const baseInput: AuditInput = {
  snapshot, claimedBusinessName: 'Hải Sản Sầm Sơn Test', declaredIndustry: 'Nhà hàng hải sản', websiteReachable: true,
  competitors: [{ name: 'A', reviewCount: 300, rating: 4.5, photoCountEst: 80 }, { name: 'B', reviewCount: 250, rating: 4.6, photoCountEst: 60 }, { name: 'C', reviewCount: 400, rating: 4.4, photoCountEst: 90 }],
  visibility: { query: 'Nhà hàng hải sản Sầm Sơn', selfRank: 6, total: 20 },
  now: NOW,
}

function countingAI(): AIClassifier & { calls: number } {
  const c = {
    calls: 0,
    async classify<T>(): Promise<T> {
      c.calls++
      return { matches: true, reason: 'khớp', specificity: 'medium', relevance: 'high', clarity: 'medium', differentiation: 'low', keywordRelevance: 'high',
        summary: 'Hồ sơ khá ổn, thiếu phản hồi review', repetitive: false, hasDuplication: false, hasCTA: false,
        liked: ['hải sản tươi'], complained: ['chờ món lâu'], mentionedServices: [], recurringIssue: 'chờ món lâu' } as unknown as T
    },
  }
  return c
}

function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    if (['node_modules', '.next', '.git', 'supabase', 'legal'].includes(n)) continue
    const p = join(dir, n)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(ts|tsx|md|json|css)$/.test(n) && !n.endsWith('.tsbuildinfo')) out.push(p)
  }
  return out
}

async function main() {
  // 1) Đường đi đầy đủ: engine -> lời (AI) -> văn bản 7 mục -> đọc lại cho giao diện / lộ trình.
  const ai = countingAI()
  const cached = createCachedClassifier(ai, memoryClassifierStore())
  const report = await runAudit(baseInput, cached)
  assert.equal(report.engineVersion, ENGINE_VERSION)
  assert.ok(report.overallScore != null && report.overallScore >= 0 && report.overallScore <= 100)
  assert.ok(report.checks.length >= 30, 'đủ bộ kiểm tra')
  const firstCalls = ai.calls
  assert.ok(firstCalls >= 1 && firstCalls <= 6, `số lần gọi AI phân loại hợp lý (${firstCalls})`)
  await runAudit(baseInput, cached)
  assert.equal(ai.calls, firstCalls, 'chạy lại cùng dữ liệu: 0 lần gọi AI thêm (cache theo nội dung)')

  const narrative = await generateNarrative(ai, { report, business: { name: 'Hải Sản Sầm Sơn Test', industry: 'Nhà hàng', area: 'Sầm Sơn' } })
  const text = renderAuditText(report, narrative)
  for (const h of ['### 1.', '### 2.', '### 3.', '### 4.', '### 5.', '### 6.', '### 7.']) assert.ok(text.includes(h), h)
  const parsed = parseAuditResult(text, { name: 'Hải Sản Sầm Sơn Test' })
  assert.equal(parsed.overall, Math.round(report.overallScore!) / 10, 'giao diện đọc đúng điểm do code tính')
  const so = buildScoreOverride(report, null)
  assert.ok(so, 'giao diện dựng được phần điểm từ báo cáo')

  // 2) Lộ trình 30 ngày: prompt nhận đúng văn bản audit mới (khung ### + "Ưu tiên Cao/Trung bình").
  assert.ok(PLAN_30_DAYS_PROMPT.includes('{{audit_result}}'))
  const planPrompt = PLAN_30_DAYS_PROMPT.replaceAll('{{audit_result}}', text)
  assert.ok(planPrompt.includes('Ưu tiên Cao') && planPrompt.includes('### 5. Việc cần làm ngay'))

  // 3) Cắt theo gói chạy trên văn bản + báo cáo mới; dòng DB v2 giữ nguyên cấu trúc sau khi cắt.
  const free = shapeAuditPayload({ audit_result: text, report }, ENTITLEMENTS.free, 'free')
  assert.ok(free.audit_result.includes('### 5.') && free.audit_result.includes('### 6.'))
  assert.ok(free.report.topOpportunities.length <= (ENTITLEMENTS.free.auditActionLimit ?? 99))
  const rowShaped = shapeAuditRow({ audit_result: text, checks_json: report }, ENTITLEMENTS.full, 'full').row!
  assert.equal(storedAuditKind(rowShaped), 'v2')

  // 4) Thiếu nguồn dữ liệu / AI sập: audit vẫn ra điểm, mục thiếu là "chưa đủ dữ liệu" (không đoán mò).
  const down: AIClassifier = { async classify() { throw new Error('anthropic down') } }
  const degraded = await runAudit({ ...baseInput, competitors: undefined, visibility: undefined, websiteReachable: undefined, rankGrid: undefined }, down)
  assert.ok(degraded.coverage && degraded.coverage.insufficient > 0, 'có mục chưa đủ dữ liệu')
  const nar = await generateNarrative(down, { report: degraded, business: { name: 'X' } })
  assert.equal(nar.source, 'fallback', 'AI sập => lời dựng bằng code')
  assert.ok(renderAuditText(degraded, nar).includes('### 8.'), 'liệt kê mục chưa đủ dữ liệu cho lộ trình')
  for (const id of ['VY01', 'VY03', 'T01', 'T02']) {
    const c = degraded.checks.find((x) => x.id === id)!
    assert.equal(c.passed, null, `${id} không có đối thủ => chưa đủ dữ liệu, không kết luận`)
  }

  // 5) So sánh với lần trước: audit kiểu cũ / đổi doanh nghiệp / cùng doanh nghiệp.
  const placeKey = 'place:ChIJ_v2only'
  assert.equal(buildAuditComparison({ previous: null, hasLegacyOnly: false, placeKey, report }), null)
  const legacyCmp = buildAuditComparison({ previous: null, hasLegacyOnly: true, placeKey, report })
  assert.equal(legacyCmp?.comparable, false)
  assert.match(String(legacyCmp?.reason), /thang điểm cũ/)
  const prev = { id: 'a1', created_at: '2026-11-19T00:00:00Z', checks_json: report, raw_input: { place_key: placeKey } }
  const sameCmp = buildAuditComparison({ previous: prev, hasLegacyOnly: false, placeKey, report }) as any
  assert.equal(sameCmp.comparable, true)
  assert.equal(sameCmp.previous_audit_id, 'a1')
  const otherCmp = buildAuditComparison({ previous: { ...prev, raw_input: { place_key: 'place:khac' } }, hasLegacyOnly: false, placeKey, report }) as any
  assert.equal(otherCmp.comparable, false)

  // 6) Audit kiểu cũ đã lưu (checks_json rỗng): xem được, đọc điểm thang 10 từ văn bản, có ghi chú; không bị coi là v2.
  const legacyText = ['### 1. Điểm tổng quan (thang 10)', '- Điểm: 6.5', '- Giải thích ngắn gọn: Hồ sơ cần bổ sung ảnh và bài đăng.', '',
    '### 3. Điểm mạnh', '- Có đủ giờ mở cửa và số điện thoại rõ ràng', '', '### 4. Điểm yếu theo mức ưu tiên', '- Ưu tiên Cao:', '  - Chưa trả lời các review thấp sao gần đây',
    '### 5. Việc cần làm ngay (7–14 ngày tới)', '- Trả lời toàn bộ review dưới 3 sao trong tuần này'].join('\n')
  const legacyRow = { audit_result: legacyText, checks_json: null, module_key: 'maps_seo', score_overview: null }
  assert.equal(storedAuditKind(legacyRow), 'legacy')
  assert.equal(storedAuditKind({ checks_json: {} }), 'legacy', 'checks_json không đúng dạng báo cáo => kiểu cũ')
  assert.equal(storedAuditKind(null), null)
  const legacyParsed = parseAuditResult(legacyText)
  assert.equal(legacyParsed.overall, 6.5)
  assert.ok(legacyParsed.actions.length > 0)
  assert.match(legacyAuditNotice('2026-11-16T23:37:48Z'), /kiểu cũ \(ngày 1[67]\/11\/2026\)/)
  const legacyShaped = shapeAuditRow(legacyRow as any, ENTITLEMENTS.free, 'free').row as any
  assert.equal(legacyShaped.checks_json, null, 'cắt theo gói không làm hỏng dòng kiểu cũ')
  assert.equal(PLAN_30_DAYS_PROMPT.replaceAll('{{audit_result}}', legacyText).includes('Ưu tiên Cao'), true, 'lộ trình vẫn đọc được audit cũ')

  // 7) Chốt chặn: không còn công tắc / prompt / hàm của engine cũ trong code, docs, scripts.
  const banned = /AUDIT_ENGINE_MODE|getAuditEngineMode|buildAuditPrompt|AUDIT_PROMPT|saveAuditV2|getAuditV2History|audit-v2-preview/
  const allowed = new Set(['scripts/test-audit-v2-only.ts', 'README-FINAL.md', 'docs/AUDIT_V1_REMOVAL.md'])
  const root = join(__dirname, '..')
  for (const dir of ['app', 'lib', 'components', 'scripts', 'docs']) {
    for (const f of walk(join(root, dir))) {
      const rel = f.slice(root.length + 1).replaceAll('\\', '/')
      if (allowed.has(rel)) continue
      assert.ok(!banned.test(readFileSync(f, 'utf8')), `còn dấu vết engine cũ trong ${rel}`)
    }
  }
  const readme = readFileSync(join(root, 'README-FINAL.md'), 'utf8')
  assert.ok(!/AUDIT_ENGINE_MODE=v1/.test(readme), 'env mẫu không còn đặt AUDIT_ENGINE_MODE=v1')

  console.log(`OK: audit chỉ còn engine v2 (${firstCalls} lần gọi AI phân loại lần đầu, 0 lần khi lặp lại) — tất cả kiểm tra đều qua`)
}

main().catch((e) => { console.error(e); process.exit(1) })
