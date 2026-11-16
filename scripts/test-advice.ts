// Lời khuyên danh mục / mô tả mẫu: chạy bằng dữ liệu và code, KHÔNG AI. Mọi kết luận phải kèm số đếm được.
import assert from 'node:assert/strict'
import {
  assessDescription, buildAdvice, displayCore, parseMatches, writeDescriptionWithAI, buildDescriptionDrafts, categoryCore, computeCategoryEvidence, computeSecondary, decidePrimary,
  inventedNumbers, validateDraft,
} from '../lib/audit-engine/advice'
import type { AIClassifier, AuditInput } from '../lib/audit-engine'

async function main() {
const comps = (rows: Array<[string, string[]]>) => rows.map(([category, subcategories], i) => ({ name: `Q${i}`, category, subcategories }))
const TOP = comps([
  ['Dịch vụ sửa điều hòa', ['Thợ điện lạnh', 'Dịch vụ vệ sinh điều hòa']],
  ['Dịch vụ sửa điều hòa', ['Thợ điện lạnh']],
  ['Dịch vụ sửa điều hòa', ['Thợ điện lạnh', 'Dịch vụ vệ sinh điều hòa']],
  ['Cửa hàng điện máy', ['Thợ điện lạnh']],
  ['Dịch vụ sửa chữa', ['Dịch vụ vệ sinh điều hòa']],
])
const rv = (text: string) => ({ rating: 5, text })
const REVIEWS = [
  'Anh thợ sửa điều hòa đến nhanh, làm sạch sẽ',
  'Sửa điều hòa không lạnh, bơm gas xong mát ngay',
  'Gọi sửa điều hòa buổi tối vẫn có người đến',
  'Đã vệ sinh điều hòa cho cả nhà, giá hợp lý',
  'Nhân viên nhiệt tình, sẽ ủng hộ tiếp nhé',
  'Quán làm việc rất chuyên nghiệp, hài lòng',
].map(rv)
const snap = (extra: any = {}): any => ({ business_name: 'Điện lạnh Minh', primary_category: 'Cửa hàng điện máy', additional_categories: '', description: null, reviews: REVIEWS, ...extra })
const input = (extra: any = {}, competitors: any = TOP): AuditInput => ({ snapshot: snap(extra), competitors })

// — lõi danh mục: bỏ từ chung, không dấu —
assert.deepEqual(categoryCore('Dịch vụ sửa điều hòa'), ['sua', 'dieu', 'hoa'])
assert.deepEqual(categoryCore('Cửa hàng điện máy'), ['dien', 'may'])
assert.deepEqual(categoryCore('Cửa sắt'), ['cua', 'sat'], '"cửa" (door) không bị coi là từ chung "cửa hàng"')

assert.equal(displayCore('Dịch vụ sửa điều hòa'), 'sửa điều hòa', 'hiển thị giữ dấu')
assert.equal(displayCore('Cửa hàng điện máy'), 'điện máy')
assert.equal(displayCore('Cửa sắt'), 'cửa sắt')

// — bằng chứng danh mục —
const ev = computeCategoryEvidence('Cửa hàng điện máy', TOP)
assert.equal(ev.total, 5)
assert.equal(ev.primaries[0].name, 'Dịch vụ sửa điều hòa')
assert.equal(ev.ownPrimaryCount, 1)

// — khuyên đổi: cần CẢ quán top lẫn khách nhắc tới —
const p1 = decidePrimary(input(), ev)
assert.equal(p1.verdict, 'consider')
assert.equal(p1.suggested, 'Dịch vụ sửa điều hòa')
assert.match(p1.reason, /3\/5 quán top/)
assert.match(p1.reason, /"sửa điều hòa" trong 3\/6 đánh giá, so với 0 đánh giá nhắc tới "điện máy"/, 'đếm đúng 3 trong 6 đánh giá, hiển thị có dấu')
assert.ok(p1.caution && /dao động/.test(p1.caution))

// phổ biến ở quán top nhưng khách không nhắc -> KHÔNG khuyên đổi
const p2 = decidePrimary(input({ reviews: ['Quán làm việc rất chuyên nghiệp, hài lòng'.repeat(1), 'Nhân viên nhiệt tình, sẽ ủng hộ tiếp nhé', 'Giá cả hợp lý, phục vụ tốt lắm', 'Rất hài lòng với dịch vụ của quán', 'Sẽ quay lại lần sau nhé quán ơi'].map(rv) }), ev)
assert.equal(p2.verdict, 'keep')
assert.match(p2.reason, /khách chưa nhắc/)
// quá ít đánh giá -> không kết luận
const p3 = decidePrimary(input({ reviews: REVIEWS.slice(0, 2) }), ev)
assert.equal(p3.verdict, 'keep')
assert.match(p3.reason, /chưa đủ để kết luận/)
// danh mục hiện tại đã khớp khách nhất -> giữ
assert.equal(decidePrimary(input({ primary_category: 'Dịch vụ sửa điều hòa' }), computeCategoryEvidence('Dịch vụ sửa điều hòa', TOP)).verdict, 'keep')
// < 3 quán top -> chưa đủ dữ liệu
const few = TOP.slice(0, 2)
assert.equal(decidePrimary(input({}, few), computeCategoryEvidence('Cửa hàng điện máy', few)).verdict, 'unknown')

// — danh mục phụ: có dấu hiệu thật thì lên trước —
const sec = computeSecondary(input())
assert.deepEqual(sec.suggested.map((s) => [s.name, s.supported]), [['Dịch vụ vệ sinh điều hòa', true], ['Thợ điện lạnh', false]])
assert.equal(sec.suggested[0].reviews, 1)
assert.equal(computeSecondary(input({ coverage: { sections: { categories: 'error' } } })).suggested.length, 0, 'không đọc được danh mục phụ -> không khuyên')
assert.equal(computeSecondary(input({}, few)).suggested.length, 0)

// — mô tả hiện có: không đọc được ≠ thiếu —
assert.equal(assessDescription(null).state, 'unreadable')
assert.equal(assessDescription('Sửa điều hòa').state, 'short')
assert.equal(assessDescription('Xem thêm tại www.dienlanh.vn. ' + 'a'.repeat(200)).state, 'risky')
assert.equal(assessDescription('Giảm giá 20% cho khách mới. ' + 'a'.repeat(200)).state, 'risky')
assert.equal(assessDescription('a'.repeat(800)).state, 'long')
assert.equal(assessDescription('Chúng tôi sửa chữa và vệ sinh điều hòa tại nhà cho các hộ gia đình ở Thanh Hóa. '.repeat(3)).state, 'ok')

// — mô tả mẫu: chỉ ghép từ dữ kiện —
const drafts = buildDescriptionDrafts({ name: 'Điện lạnh Minh', area: 'Thanh Hóa', primaryCategory: 'Cửa hàng điện máy', services: ['Dịch vụ vệ sinh điều hòa', 'Thợ điện lạnh', 'Cửa hàng điện máy'] })
assert.equal(drafts.length, 2)
assert.match(drafts[0].text, /^Điện lạnh Minh là cửa hàng điện máy tại Thanh Hóa\./)
assert.match(drafts[0].text, /dịch vụ vệ sinh điều hòa và thợ điện lạnh/)
assert.ok(!/cửa hàng điện máy\.? Quán cung cấp[^.]*cửa hàng điện máy/.test(drafts[0].text), 'không lặp danh mục chính trong danh sách dịch vụ')
for (const d of drafts) assert.ok(d.text.length >= 100 && d.text.length <= 750)
assert.deepEqual(buildDescriptionDrafts({ name: 'X', primaryCategory: null, services: [] }), [], 'thiếu danh mục -> không soạn')
assert.equal(buildDescriptionDrafts({ name: 'Điện lạnh Minh', primaryCategory: 'Cửa hàng điện máy', services: [] })[0].text.includes(' tại '), false, 'thiếu khu vực -> bỏ phần "tại …"')
const facts = 'Điện lạnh Minh | Thanh Hóa'
assert.deepEqual(inventedNumbers('Hơn 10 năm kinh nghiệm', facts), ['10'])
for (const bad of ['Giảm giá 20%', 'Tốt nhất Thanh Hóa', 'Xem tại dienlanh.vn', 'Gọi 0912 345 678', 'Hơn 10 năm kinh nghiệm']) {
  assert.equal(validateDraft(drafts[0].text + ' ' + bad, facts + ' ' + drafts[0].text).ok, false, bad)
}

// — tổng hợp —
const adv = await buildAdvice({ input: input(), area: 'Thanh Hóa' })
assert.equal(adv.primary.verdict, 'consider')
assert.equal(adv.description.state, 'unreadable')
assert.equal(adv.drafts.length, 2, 'mô tả chưa đọc được -> kèm mẫu')
assert.ok(adv.drafts[0].text.includes('dịch vụ vệ sinh điều hòa'), 'dịch vụ có dấu hiệu thật được đưa vào mẫu')
assert.ok(!adv.drafts[0].text.includes('thợ điện lạnh'), 'dịch vụ chưa có dấu hiệu thật KHÔNG đưa vào mẫu')
const okDesc = 'Chúng tôi sửa chữa và vệ sinh điều hòa tại nhà cho các hộ gia đình ở Thanh Hóa. '.repeat(3)
assert.equal((await buildAdvice({ input: input({ description: okDesc }), area: 'Thanh Hóa' })).drafts.length, 0, 'mô tả đã ổn thì không soạn lại')
assert.equal((await buildAdvice({ input: { snapshot: {} as any } })).primary.verdict, 'unknown', 'dữ liệu rỗng không làm hỏng audit')


// ───────── AI hỗ trợ nhưng bị code kiểm ─────────
const fakeAI = (map: (system: string) => unknown) => {
  const calls: string[] = []
  const ai: AIClassifier = {
    async classify<T>(i: { system: string }): Promise<T> {
      calls.push(i.system.slice(0, 20))
      const v = map(i.system)
      if (v instanceof Error) throw v
      return v as T
    },
  }
  return { ai, calls }
}
// khách nói "máy lạnh" thay vì "điều hòa": từ khóa không bắt được, AI hiểu
const synonymReviews = ['Thợ sửa máy lạnh nhà mình rất nhanh', 'Máy lạnh không mát, gọi là có người đến ngay', 'Bơm gas máy lạnh xong mát hẳn, cảm ơn quán', 'Nhân viên nhiệt tình, sẽ ủng hộ tiếp nhé', 'Quán làm việc rất chuyên nghiệp, hài lòng'].map(rv)
const inSyn = input({ reviews: synonymReviews })
assert.equal(decidePrimary(inSyn, ev).verdict, 'keep', 'chỉ đếm từ khóa thì không thấy "máy lạnh" = "điều hòa"')
{
  const { ai, calls } = fakeAI((sys) =>
    sys.startsWith('Bạn đọc đánh giá')
      ? { matches: [{ category: 'Dịch vụ sửa điều hòa', reviews: [1, 2, 3, 3, 99, 0, 'x'] }, { category: 'Danh mục bịa', reviews: [1] }] }
      : { drafts: [{ label: 'Mẫu AI', text: 'Điện lạnh Minh là cửa hàng điện máy tại Thanh Hóa, nhận sửa chữa và bơm gas cho các loại máy lạnh trong gia đình. Khách thường khen quán đến nhanh và làm gọn gàng. Bạn có thể nhắn tin hoặc ghé trực tiếp theo địa chỉ trên bản đồ để được tư vấn.' }] },
  )
  const a = await buildAdvice({ input: inSyn, area: 'Thanh Hóa', ai })
  assert.equal(a.primary.verdict, 'consider', 'AI hiểu từ đồng nghĩa, mốc ngưỡng vẫn do code chốt')
  assert.match(a.primary.reason, /3\/5 đánh giá/, 'số thứ tự sai (99, 0, "x") và trùng bị loại, còn đúng 3')
  assert.equal(a.primary.quotes.length, 2)
  assert.ok(a.primary.quotes[0].includes('máy lạnh'), 'trích nguyên văn đánh giá làm bằng chứng')
  assert.equal(a.drafts[0].by, 'ai')
  assert.equal(a.ai, true)
  assert.equal(calls.length, 2)
}
// AI soạn mô tả có con số tự thêm / khuyến mãi -> bị loại, dùng mẫu ghép
{
  const { ai } = fakeAI((sys) => sys.startsWith('Bạn đọc đánh giá') ? { matches: [] } : { drafts: [{ label: 'x', text: 'Điện lạnh Minh có hơn 10 năm kinh nghiệm sửa điều hòa tại Thanh Hóa, giảm giá 20% cho khách mới, liên hệ ngay để được tư vấn nhanh chóng và chu đáo nhất.' }] })
  const a = await buildAdvice({ input: input(), area: 'Thanh Hóa', ai })
  assert.ok(a.drafts.length > 0 && a.drafts.every((d) => d.by === 'template'), 'AI vi phạm -> rơi về mẫu ghép')
}
// AI lỗi hoàn toàn: audit vẫn có kết quả
{
  const { ai } = fakeAI(() => new Error('AI down'))
  const a = await buildAdvice({ input: input(), area: 'Thanh Hóa', ai })
  assert.equal(a.primary.verdict, 'consider', 'rơi về đếm từ khóa vẫn khuyên được')
  assert.ok(a.drafts.length > 0)
  assert.equal(a.ai, false)
}
// AI không được bịa đánh giá hay danh mục
assert.equal(parseMatches({ matches: [{ category: 'Không có', reviews: [1] }] }, ['A'], 5).size, 0)
assert.deepEqual([...parseMatches({ matches: [{ category: 'a', reviews: [2, 2, 7] }] }, ['A'], 5).get('a')!], [2])
assert.deepEqual(await writeDescriptionWithAI({ ai: fakeAI(() => ({ drafts: [] })).ai, name: 'X', primaryCategory: 'Y', services: [], reviews: [] }), [])

console.log('test-advice: OK')

}
main().catch((e) => { console.error(e); process.exit(1) })
