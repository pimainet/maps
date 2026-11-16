// Lời khuyên danh mục / hồ sơ quán / mô tả mẫu: AI chỉ đề xuất, code kiểm tra và chốt.
import assert from 'node:assert/strict'
import {
  assessDescription, buildAdvice, computeCategoryEvidence, decidePrimary, inventedNumbers, parseCategoryChoice,
  parseDrafts, parseProfile, validateDraft,
} from '../lib/audit-engine/advice'
import type { AIClassifier, AuditInput } from '../lib/audit-engine'

const comps = (rows: Array<[string, string[]]>) => rows.map(([category, subcategories], i) => ({ name: `Q${i}`, category, subcategories, rank: i + 1 }))
const TOP = comps([
  ['Dịch vụ sửa điều hòa', ['Thợ điện lạnh', 'Dịch vụ vệ sinh điều hòa']],
  ['Dịch vụ sửa điều hòa', ['Thợ điện lạnh']],
  ['Dịch vụ sửa điều hòa', ['Thợ điện lạnh', 'Dịch vụ vệ sinh điều hòa']],
  ['Cửa hàng điện máy', ['Thợ điện lạnh']],
  ['Dịch vụ sửa chữa', ['Dịch vụ vệ sinh điều hòa']],
])

function fakeAI(map: (system: string) => unknown) {
  const calls: string[] = []
  const ai: AIClassifier = {
    async classify<T>(i: { system: string }): Promise<T> {
      calls.push(i.system.slice(0, 30))
      const v = map(i.system)
      if (v instanceof Error) throw v
      return v as T
    },
  }
  return { ai, calls }
}
const snapshot = (extra: any = {}): any => ({
  business_name: 'Điện lạnh Minh', primary_category: 'Cửa hàng điện máy', additional_categories: '', description: null, reviews: [
    { rating: 5, text: 'Anh thợ đến vệ sinh điều hòa nhanh, làm sạch sẽ' }, { rating: 5, text: 'Sửa điều hòa không lạnh, bơm gas ngay trong ngày' },
  ], ...extra,
})

async function main() {
  // — bằng chứng danh mục —
  const ev = computeCategoryEvidence('Cửa hàng điện máy', TOP)
  assert.equal(ev.total, 5)
  assert.equal(ev.primaries[0].name, 'Dịch vụ sửa điều hòa')
  assert.equal(ev.primaries[0].count, 3)
  assert.equal(ev.ownPrimaryCount, 1)

  // — chỉ nhận danh mục có thật trong tập quan sát —
  const allowed = ev.primaries.map((p) => p.name)
  assert.equal(parseCategoryChoice({ suggested_primary: 'Trung tâm bảo hành siêu cấp', fit: 'high' }, allowed, []).suggestedPrimary, null, 'AI bịa danh mục bị loại')
  assert.equal(parseCategoryChoice({ suggested_primary: 'dich vu sua dieu hoa', fit: 'high' }, allowed, []).suggestedPrimary, 'Dịch vụ sửa điều hòa', 'khớp không dấu/hoa thường')

  // — chốt "cân nhắc đổi" bằng code —
  const choice = (o: any) => parseCategoryChoice({ reason: 'Quán chủ yếu sửa điều hòa.', ...o }, allowed, [])
  const consider = decidePrimary({ evidence: ev, choice: choice({ suggested_primary: 'Dịch vụ sửa điều hòa', fit: 'high' }) })
  assert.equal(consider.verdict, 'consider')
  assert.match(consider.reason, /3\/5 quán top/)
  assert.ok(consider.caution && /dao động/.test(consider.caution), 'đổi danh mục chính luôn kèm cảnh báo')
  assert.equal(decidePrimary({ evidence: ev, choice: choice({ suggested_primary: 'Dịch vụ sửa điều hòa', fit: 'medium' }) }).verdict, 'keep', 'khớp vừa thì không khuyên đổi')
  assert.equal(decidePrimary({ evidence: ev, choice: choice({ suggested_primary: 'Dịch vụ sửa chữa', fit: 'high' }) }).verdict, 'keep', 'dưới 40% quán top thì không khuyên đổi')
  assert.equal(decidePrimary({ evidence: ev, choice: null }).verdict, 'keep')
  assert.equal(decidePrimary({ evidence: computeCategoryEvidence('X', TOP.slice(0, 2)), choice: null }).verdict, 'unknown', 'ít hơn 3 quán thì chưa đủ dữ liệu')

  // — mô tả hiện có: không đọc được ≠ thiếu —
  assert.equal(assessDescription(null).state, 'unreadable')
  assert.equal(assessDescription('Sửa điều hòa').state, 'short')
  assert.equal(assessDescription('Xem thêm tại www.dienlanh.vn. ' + 'a'.repeat(200)).state, 'risky')
  assert.equal(assessDescription('Giảm giá 20% cho khách mới. ' + 'a'.repeat(200)).state, 'risky')
  assert.equal(assessDescription('a'.repeat(800)).state, 'long')
  assert.equal(assessDescription('Chúng tôi sửa chữa và vệ sinh điều hòa tại nhà cho các hộ gia đình ở Thanh Hóa. '.repeat(3)).state, 'ok')

  // — hồ sơ: confidence thấp luôn có câu hỏi, thiếu dịch vụ chính thì bỏ —
  assert.equal(parseProfile({ summary: 'Mình hiểu quán bạn là tiệm sửa điều hòa.', main_service: '', services: [] }), null)
  const low = parseProfile({ summary: 'Mình hiểu quán bạn là…', main_service: 'sửa điều hòa', confidence: 'low' })!
  assert.ok(low.question)
  assert.equal(parseProfile({ summary: 's', main_service: 'm', confidence: 'high' })!.question, null)

  // — bằng chứng đếm bằng code, hạ độ tự tin của AI —
  const { withEvidence } = await import('../lib/audit-engine/advice')
  const prof = { summary: 's', mainService: 'vệ sinh điều hòa', services: [], confidence: 'high' as const, question: null }
  const rv = (t: string) => ({ rating: 5, text: t })
  const many = { snapshot: snapshot({ reviews: [rv('Anh thợ vệ sinh điều hòa rất sạch sẽ'), rv('Vệ sinh điều hòa nhanh, giá hợp lý'), rv('Đã vệ sinh điều hòa cho nhà mình, ok'), rv('Cảm ơn quán nhé, làm việc tốt')] }) } as AuditInput
  assert.equal(withEvidence(prof, many).confidence, 'high')
  assert.equal(withEvidence(prof, many).evidence!.mentionsMain, 3)
  assert.equal(withEvidence(prof, { snapshot: snapshot({ reviews: [rv('Quán sửa nhanh và gọn gàng lắm')] }) } as AuditInput).confidence, 'low', 'AI nói high nhưng không review nào nhắc -> hạ xuống low')
  assert.ok(withEvidence(prof, { snapshot: snapshot({ reviews: [] }) } as AuditInput).question, 'low luôn có câu hỏi')
  assert.equal(withEvidence({ ...prof, confidence: 'low' }, many).confidence, 'low', 'không bao giờ nâng độ tự tin')

  // — mô tả mẫu: con số / link / khuyến mãi / tuyệt đối bị loại —
  const facts = 'Điện lạnh Minh | Thanh Hóa | sửa điều hòa | vệ sinh điều hòa'
  const good = 'Điện lạnh Minh chuyên sửa chữa và vệ sinh điều hòa tại nhà ở Thanh Hóa. Thợ đến đúng hẹn, báo giá rõ ràng trước khi làm, bảo hành sau sửa chữa. Quý khách cần xử lý máy lạnh kém mát, chảy nước hay có mùi, hãy liên hệ để được tư vấn.'
  assert.equal(validateDraft(good, facts).ok, true)
  assert.deepEqual(inventedNumbers('Hơn 10 năm kinh nghiệm', facts), ['10'])
  assert.equal(validateDraft(good.replace('Thợ đến', 'Hơn 10 năm kinh nghiệm, thợ đến'), facts).ok, false, 'tự thêm số năm bị loại')
  assert.equal(validateDraft(good + ' Giảm giá 20%.', facts).ok, false)
  assert.equal(validateDraft(good + ' Dịch vụ tốt nhất Thanh Hóa.', facts).ok, false)
  assert.equal(validateDraft(good + ' Xem tại dienlanhminh.vn', facts).ok, false)
  assert.equal(parseDrafts({ drafts: [{ label: 'A', text: good }, { label: 'B', text: 'ngắn' }, { label: 'C', text: good + ' Gọi 0912 345 678' }] }, facts).length, 1)

  // — tổng hợp: chưa xác nhận thì AI đoán; đã xác nhận thì KHÔNG đoán lại —
  const mk = () =>
    fakeAI((system) =>
      system.startsWith('Bạn giúp hiểu')
        ? { summary: 'Mình hiểu quán bạn là tiệm sửa điều hòa tại nhà.', main_service: 'sửa điều hòa', services: ['vệ sinh điều hòa'], confidence: 'high' }
        : { suggested_primary: 'Dịch vụ sửa điều hòa', fit: 'high', reason: 'Quán chủ yếu sửa điều hòa.', secondary_fit: ['Thợ điện lạnh', 'Danh mục bịa'] },
    )
  const input: AuditInput = { snapshot: snapshot(), declaredIndustry: 'Điện lạnh', competitors: TOP }
  const a = mk()
  const adv = await buildAdvice({ input, ai: a.ai, area: 'Thanh Hóa' })
  assert.equal(a.calls.length, 2)
  assert.equal(adv.profile?.state, 'needs_confirm')
  assert.equal(adv.primary.verdict, 'consider')
  assert.deepEqual(adv.secondary.suggested.map((s) => s.name), ['Thợ điện lạnh'], 'danh mục phụ do AI bịa bị loại')
  assert.equal(adv.description.state, 'unreadable')

  const b = mk()
  const confirmed = { summary: 'x', mainService: 'sửa điều hòa', services: [], confidence: 'high' as const, question: null }
  const adv2 = await buildAdvice({ input, ai: b.ai, confirmedProfile: confirmed })
  assert.equal(b.calls.length, 1, 'hồ sơ đã xác nhận thì không đoán lại')
  assert.equal(adv2.profile?.state, 'confirmed')

  // — AI lỗi: audit không hỏng, danh mục chính "giữ nguyên", không bịa —
  const c = fakeAI(() => new Error('AI down'))
  const adv3 = await buildAdvice({ input, ai: c.ai })
  assert.equal(adv3.profile, null)
  assert.equal(adv3.primary.verdict, 'keep')
  assert.ok(adv3.secondary.suggested.length >= 0)

  // — không đủ quán top: không khuyên danh mục —
  const d = mk()
  const adv4 = await buildAdvice({ input: { ...input, competitors: TOP.slice(0, 2) }, ai: d.ai })
  assert.equal(adv4.primary.verdict, 'unknown')
  assert.equal(adv4.secondary.suggested.length, 0)

  console.log('test-advice: OK')
}
main().catch((e) => { console.error(e); process.exit(1) })
