// Chạy: npx tsx scripts/test-mini-grid.ts
// Lưới mini 5×5 kèm audit (VY04): cờ bật/tắt, toạ độ, cache, trần ngân sách, hạn mức workspace, điểm lỗi, fake DataForSEO.
import assert from 'node:assert/strict'
import { runMiniGrid, miniGridWorkspacePoints, MINI_GRID_COST_PER_POINT_USD, type MiniGridDeps } from '../lib/rankgrid/mini-grid'
import { checkVY04, checkVY02 } from '../lib/audit-engine/visibility'
import type { ParsedTask, RankedPlace } from '../lib/rankgrid/parse'
import type { MapsQuery } from '../lib/rankgrid/dataforseo'
import type { RankGridAuditInput } from '../lib/audit-engine/types'

const place = (key: string, title: string, reviews = 100): RankedPlace => ({ placeKey: key, placeId: key, cid: null, title, category: null, rating: 4.5, reviewsCount: reviews, lat: null, lng: null, phone: null })
const CENTER = { lat: 21.0285, lng: 105.8542 }

function makeDeps(over: Partial<MiniGridDeps> = {}, opts: { rankAt?: (q: MapsQuery) => number | null; failAt?: (i: number) => boolean } = {}) {
  const log = { queries: [] as MapsQuery[], reserved: [] as Array<[number, number, number]>, released: [] as Array<[number, number]>, cached: [] as string[] }
  let i = 0
  const deps: MiniGridDeps = {
    enabled: () => true,
    loadContext: async () => ({ lat: CENTER.lat, lng: CENTER.lng, placeId: 'me', cid: null, keyword: null, zoom: null, spacingM: null }),
    readCache: async () => null,
    writeCache: async (k) => void log.cached.push(k),
    globalSpendUsd: async () => 10,
    monthlyBudgetUsd: () => 50,
    reserve: async (p, l, c) => (log.reserved.push([p, l, c]), true),
    release: async (p, c) => void log.released.push([p, c]),
    query: async (q): Promise<ParsedTask> => {
      const idx = i++
      log.queries.push(q)
      if (opts.failAt?.(idx)) return { ok: false, error: 'boom', retryable: true }
      const r = opts.rankAt ? opts.rankAt(q) : 1
      const list = [place('lead', 'Đối thủ Dẫn Đầu', 900), place('x2', 'X2'), place('x3', 'X3'), place('x4', 'X4')]
      if (r != null) list.splice(r - 1, 0, place('me', 'Quán Của Tôi'))
      return { ok: true, places: list, resultCount: list.length }
    },
    ...over,
  }
  return { deps, log }
}
const args = { clientId: 'c1', workspaceId: 'w1', primaryCategory: 'Nhà hàng phở', area: 'Hoàn Kiếm, Hà Nội', industry: 'Nhà hàng' }

async function main() {
  // 1) Tắt -> không gọi gì, VY04 "chưa đủ dữ liệu".
  let { deps, log } = makeDeps({ enabled: () => false })
  let r = await runMiniGrid(args, deps)
  assert.equal(r.input, undefined)
  assert.equal(log.queries.length + log.reserved.length, 0)
  assert.equal(checkVY04({ snapshot: {} as any, rankGrid: r.input }).passed, null)

  // 2) Chạy thật (fake): 25 điểm, từ khoá = danh mục chính (không kèm địa danh), giữ chỗ 25 điểm, ghi cache.
  //    Quán top 1 ở tâm và phía Bắc/Đông, top 5 ở phía Nam/Tây.
  ;({ deps, log } = makeDeps({}, { rankAt: (q) => (q.lat >= CENTER.lat - 1e-9 && q.lng >= CENTER.lng - 1e-9 ? 1 : 5) }))
  r = await runMiniGrid(args, deps)
  assert.equal(r.from, 'live')
  assert.equal(log.queries.length, 25)
  assert.ok(log.queries.every((q) => q.keyword === 'nhà hàng phở' && q.device === 'mobile' && q.languageCode === 'vi'))
  assert.deepEqual(log.reserved, [[25, miniGridWorkspacePoints(), 25 * MINI_GRID_COST_PER_POINT_USD]])
  assert.equal(log.cached.length, 1)
  assert.equal(r.costUsd, 0.05)
  const g = r.input!
  assert.equal(g.source, 'audit_mini')
  assert.equal(g.primary.points, 25)
  assert.equal(g.primary.centerRank, 1)
  assert.equal(g.primary.solv, 36, '9/25 điểm top 3')
  assert.equal(g.primary.leader?.title, 'Đối thủ Dẫn Đầu')
  assert.ok(g.primary.weakSector)
  const vy04 = checkVY04({ snapshot: {} as any, rankGrid: g })
  assert.equal(vy04.passed, false, 'solv 36 < 40')
  assert.match(vy04.message, /Lưới mini 5×5/)
  assert.equal(checkVY02({ snapshot: {} as any, rankGrid: g }).passed, null, '1 từ khoá: VY02 vẫn chưa đủ dữ liệu (trung thực)')
  ;({ deps } = makeDeps({}, { rankAt: () => 2 }))
  assert.equal(checkVY04({ snapshot: {} as any, rankGrid: (await runMiniGrid(args, deps)).input }).passed, true)

  // 3) Cache còn hạn -> không tốn tiền.
  ;({ deps, log } = makeDeps({ readCache: async () => g as RankGridAuditInput }))
  r = await runMiniGrid(args, deps)
  assert.equal(r.from, 'cache')
  assert.equal(log.queries.length + log.reserved.length, 0)

  // 4) Trần ngân sách hệ thống -> không giữ chỗ, không gọi.
  ;({ deps, log } = makeDeps({ globalSpendUsd: async () => 49.99 }))
  r = await runMiniGrid(args, deps)
  assert.equal(r.input, undefined)
  assert.match(r.note!, /trần ngân sách/)
  assert.equal(log.reserved.length + log.queries.length, 0)
  // không đọc được chi tiêu -> coi như vượt (an toàn)
  ;({ deps, log } = makeDeps({ globalSpendUsd: async () => { throw new Error('db') } }))
  assert.equal((await runMiniGrid(args, deps)).input, undefined)
  assert.equal(log.queries.length, 0)

  // 5) Hết hạn mức workspace / chưa áp migration 034 -> không gọi DataForSEO.
  ;({ deps, log } = makeDeps({ reserve: async () => false }))
  r = await runMiniGrid(args, deps)
  assert.equal(r.input, undefined)
  assert.match(r.note!, /hạn mức/)
  assert.equal(log.queries.length, 0)
  ;({ deps, log } = makeDeps({ reserve: async () => { throw new Error('function audit_minigrid_reserve does not exist') } }))
  assert.equal((await runMiniGrid(args, deps)).input, undefined)
  assert.equal(log.queries.length, 0)

  // 6) Điểm lỗi: trả lại hạn mức; lỗi quá nhiều -> chưa đủ dữ liệu.
  ;({ deps, log } = makeDeps({}, { failAt: (i) => i < 3 }))
  r = await runMiniGrid(args, deps)
  assert.equal(r.input!.primary.points, 22)
  assert.deepEqual(log.released, [[3, 3 * MINI_GRID_COST_PER_POINT_USD]])
  ;({ deps, log } = makeDeps({}, { failAt: (i) => i < 10 }))
  r = await runMiniGrid(args, deps)
  assert.equal(r.input, undefined)
  assert.equal(log.released[0][0], 10)
  assert.equal(log.cached.length, 0, 'không cache kết quả thiếu')

  // 7) Thiếu toạ độ: thử resolveIdentity; vẫn không có -> chưa đủ dữ liệu.
  const noCoords = { loadContext: async () => ({ lat: null, lng: null, placeId: 'me', cid: null, keyword: 'phở', zoom: null, spacingM: null }) }
  ;({ deps, log } = makeDeps({ ...noCoords, resolveIdentity: async () => ({ lat: CENTER.lat, lng: CENTER.lng, placeId: 'me', cid: null }) }))
  r = await runMiniGrid(args, deps)
  assert.equal(r.from, 'live')
  assert.ok(log.queries.every((q) => q.keyword === 'phở'), 'từ khoá chính đã cấu hình được ưu tiên')
  ;({ deps, log } = makeDeps({ ...noCoords }))
  r = await runMiniGrid(args, deps)
  assert.equal(r.input, undefined)
  assert.match(r.note!, /toạ độ/)
  assert.equal(log.reserved.length, 0)

  // 8) Hạn mức qua env.
  process.env.AUDIT_MINI_GRID_WORKSPACE_POINTS = '50'
  assert.equal(miniGridWorkspacePoints(), 50)
  delete process.env.AUDIT_MINI_GRID_WORKSPACE_POINTS
  assert.equal(miniGridWorkspacePoints(), 125)

  console.log('OK: lưới mini 5×5 kèm audit (VY04) + chốt chi phí — tất cả kiểm tra đều qua')
}

main().catch((e) => { console.error(e); process.exit(1) })
