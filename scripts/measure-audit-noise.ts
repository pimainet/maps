// Đo độ dao động của điểm audit trên 1 doanh nghiệp THẬT — để biết check nào nên đánh dấu "nhiễu" (lib/audit-engine/stability.ts).
//
// Cần OUTSCRAPER_API_KEY (+ ANTHROPIC_API_KEY cho phần AI). Mỗi lần lấy snapshot mới tốn credit Outscraper.
//   npx tsx --env-file=.env.local scripts/measure-audit-noise.ts --url "https://maps.app.goo.gl/..." --area "Thanh Hóa" --runs 5
//   npx tsx --env-file=.env.local scripts/measure-audit-noise.ts --name "Tên quán" --area "Quận 1" --mode ai --runs 8
//
// --mode ai    : lấy 1 snapshot, chạy phân loại AI N lần KHÔNG cache  => đo nhiễu do AI (rẻ: chỉ tốn lượt Claude).
// --mode data  : lấy N snapshot mới, AI có cache                      => đo nhiễu do dữ liệu thu thập (tốn credit Outscraper).
// --mode both  : cả hai (mặc định).
import { runGbpPublicSnapshot, hasProfileData } from '../lib/gbp-snapshot'
import { buildCompetitorQuery, areaFromAddress, fetchCompetitorSet } from '../lib/competitors'
import {
  runAudit, createRealAIClassifier, createCachedClassifier, memoryClassifierStore, checkWebsiteReachable,
  type AuditInput, type AuditReport,
} from '../lib/audit-engine'

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : def
}

const url = arg('url')
const name = arg('name')
const area = arg('area')
const runs = Math.max(2, Number(arg('runs', '5')))
const mode = (arg('mode', 'both') as 'ai' | 'data' | 'both')
if (!url && !name) {
  console.error('Cần --url <link Maps> hoặc --name <tên> (kèm --area).')
  process.exit(1)
}

const sym = (c: { passed: boolean | null }) => (c.passed === null ? '–' : c.passed ? '✓' : '✗')

function table(title: string, reports: AuditReport[]) {
  console.log(`\n=== ${title} (${reports.length} lần) ===`)
  console.log('Điểm tổng:', reports.map((r) => r.overallScore ?? '–').join('  '))
  const scores = reports.map((r) => r.overallScore).filter((x): x is number => x != null)
  if (scores.length) console.log(`Biên độ: ${Math.max(...scores) - Math.min(...scores)} điểm (trên 100)`)
  const ids = [...new Set(reports.flatMap((r) => r.checks.map((c) => c.id)))].sort()
  const flipped: string[] = []
  console.log('\nCheck  Các lần chạy      Đổi trạng thái?')
  for (const id of ids) {
    const states = reports.map((r) => r.checks.find((c) => c.id === id)).map((c) => (c ? sym(c) : ' '))
    const flips = states.includes('✓') && states.includes('✗')
    const flaky = new Set(states).size > 1
    if (flips) flipped.push(id)
    if (flaky) console.log(`${id.padEnd(5)}  ${states.join(' ').padEnd(16)}  ${flips ? 'ĐẠT↔KHÔNG ĐẠT  <- nên coi là nhiễu' : 'đổi giữa có/không đủ dữ liệu'}`)
  }
  if (!flipped.length) console.log('(không check nào đổi đạt↔không đạt)')
  console.log('Gợi ý thêm vào VOLATILE_CHECK_IDS:', flipped.length ? flipped.join(', ') : 'không có')
}

async function inputFrom(snapshot: any, extra: Partial<AuditInput> = {}): Promise<AuditInput> {
  const websiteReachable = await checkWebsiteReachable(snapshot.website_url).catch(() => undefined)
  let competitors: AuditInput['competitors']
  let visibility: AuditInput['visibility']
  try {
    const q = buildCompetitorQuery(snapshot.primary_category, area || areaFromAddress(snapshot.address_text))
    if (q) {
      const set = await fetchCompetitorSet({ category: snapshot.primary_category, area: area || areaFromAddress(snapshot.address_text), placeId: snapshot.place_id, name: snapshot.business_name })
      if (set?.items.length) { competitors = set.items; visibility = { query: set.query, selfRank: set.selfRank, total: set.total } }
    }
  } catch { /* thiếu đối thủ => check tương ứng insufficient */ }
  return { snapshot, claimedBusinessName: name, websiteReachable, competitors, visibility, ...extra }
}

async function snap() {
  const s = await runGbpPublicSnapshot({ mapsUrl: url, businessName: name, area })
  if (!hasProfileData(s)) throw new Error(`Không đọc được hồ sơ: ${(s as any).error || 'không rõ'}`)
  return s
}

async function main() {
  if (mode === 'ai' || mode === 'both') {
    console.log('Lấy 1 snapshot, chạy phân loại AI nhiều lần KHÔNG cache…')
    const input = await inputFrom(await snap())
    const reports: AuditReport[] = []
    for (let i = 0; i < runs; i++) reports.push(await runAudit(input, createRealAIClassifier()))
    table('Nhiễu do AI (không cache)', reports)
    const cached = createCachedClassifier(createRealAIClassifier(), memoryClassifierStore())
    const reportsCached: AuditReport[] = []
    for (let i = 0; i < runs; i++) reportsCached.push(await runAudit(input, cached))
    table('Cùng dữ liệu, CÓ cache (kỳ vọng: không đổi)', reportsCached)
  }
  if (mode === 'data' || mode === 'both') {
    console.log('\nLấy nhiều snapshot mới (tốn credit Outscraper)…')
    const cached = createCachedClassifier(createRealAIClassifier(), memoryClassifierStore())
    const reports: AuditReport[] = []
    for (let i = 0; i < runs; i++) reports.push(await runAudit(await inputFrom(await snap()), cached))
    table('Nhiễu do dữ liệu thu thập (AI có cache)', reports)
  }
}
main().catch((e) => { console.error(e?.message || e); process.exit(1) })
