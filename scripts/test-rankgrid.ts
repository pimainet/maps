/**
 * Test thuần cho lưới thứ hạng: hình học lưới (tròn, tắt điểm trên mặt nước), chỉ số ARP/ATRP/SoLV, đọc kết quả DataForSEO,
 * khoá kỳ, chuẩn hoá từ khoá, VY02/VY04 và hạn mức theo gói. Không gọi mạng.
 */
import assert from 'node:assert/strict'
import {
  applyWaterMask,
  buildGrid,
  centerIndex,
  countActive,
  distanceM,
  emptyLandMask,
  inCircle,
  normalizeLandMask,
  radiusM,
  sectorOf,
  type GridGeometry,
} from '../lib/rankgrid/geometry'
import { computeMetrics, computePlaceMetrics, rankTone, sectorSolv, weakestSector } from '../lib/rankgrid/metrics'
import { cidFromGoogleId, cidFromMapsUrl, findTargetRank, parseDfsMapsTask, placeKeyOf } from '../lib/rankgrid/parse'
import { nextRunAt, periodKey, usagePeriodStart } from '../lib/rankgrid/period'
import { cleanKeyword, normalizeKeyword, suggestKeywords } from '../lib/rankgrid/keywords'
import { classifyReverse } from '../lib/rankgrid/water'
import { checkVY02, checkVY04 } from '../lib/audit-engine/visibility'
import { ENTITLEMENTS, RANK_GRID_LIMITS } from '../lib/billing/plans'
import type { AuditInput } from '../lib/audit-engine/types'

let passed = 0
async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn()
    passed++
  } catch (e) {
    console.error(`FAIL: ${name}`)
    throw e
  }
}

const near = (a: number, b: number, tol: number, msg?: string) => assert.ok(Math.abs(a - b) <= tol, msg ?? `${a} ≈ ${b} (±${tol})`)

const geo = (size: 3 | 5 | 7 | 9, shape: 'circle' | 'square' = 'circle', spacingM = 700): GridGeometry => ({
  centerLat: 19.7357,
  centerLng: 105.9036,
  size,
  spacingM,
  shape,
})

async function main() {
  // ---------- Hình học ----------
  await test('lưới tròn có 21 / 37 / 69 điểm (5x5 / 7x7 / 9x9), vuông đủ n²', () => {
    assert.equal(countActive(geo(5)), 21)
    assert.equal(countActive(geo(7)), 37)
    assert.equal(countActive(geo(9)), 69)
    assert.equal(countActive(geo(3)), 9)
    assert.equal(countActive(geo(5, 'square')), 25)
    assert.equal(countActive(geo(7, 'square')), 49)
    assert.equal(buildGrid(geo(9)).length, 81, 'buildGrid trả đủ n² ô, ô ngoài hình có inShape=false')
  })

  await test('góc lưới nằm ngoài hình tròn, tâm và trục nằm trong', () => {
    assert.equal(inCircle(0, 0, 5), false)
    assert.equal(inCircle(2, 2, 5), true)
    assert.equal(inCircle(0, 2, 5), true)
    assert.equal(inCircle(2, 0, 5), true)
    assert.equal(inCircle(0, 1, 5), true)
  })

  await test('điểm giữa đúng toạ độ tâm, không bao giờ bị tắt', () => {
    const g = geo(7)
    const c = centerIndex(7)
    assert.equal(c, 24)
    const pts = buildGrid(g, [c, 0, 1])
    assert.equal(pts[c].disabled, false)
    near(pts[c].lat, g.centerLat, 1e-9)
    near(pts[c].lng, g.centerLng, 1e-9)
    assert.equal(pts[1].disabled, true)
  })

  await test('khoảng cách giữa 2 điểm kề ≈ spacing, hàng 0 ở phía Bắc', () => {
    const pts = buildGrid(geo(5, 'square', 700))
    near(distanceM(pts[12].lat, pts[12].lng, pts[13].lat, pts[13].lng), 700, 3)
    near(distanceM(pts[12].lat, pts[12].lng, pts[7].lat, pts[7].lng), 700, 3)
    assert.ok(pts[2].lat > pts[12].lat, 'hàng 0 ở phía Bắc')
    assert.ok(pts[14].lng > pts[12].lng, 'cột tăng về phía Đông')
    assert.equal(radiusM(5, 700), 1400)
    assert.equal(sectorOf(0, 1000), 'N')
    assert.equal(sectorOf(-1000, 0), 'W')
    assert.equal(sectorOf(0, 0), null)
  })

  await test('tắt điểm trên mặt nước: hook tester, giới hạn số lần kiểm, có giãn cách, giữ điểm khi tester lỗi/null', async () => {
    const g = geo(5)
    // Giả lập biển ở phía Đông: mọi điểm có lng lớn hơn tâm + 0.01 là nước; điểm hàng 0 lỗi mạng.
    const calls: Array<[number, number]> = []
    const tester = async (lat: number, lng: number) => {
      calls.push([lat, lng])
      if (lat > g.centerLat + 0.012) throw new Error('timeout')
      return lng > g.centerLng + 0.01 ? true : lng < g.centerLng - 0.01 ? false : null
    }
    const sleeps: number[] = []
    const sleep = async (ms: number) => {
      sleeps.push(ms)
    }
    let mask = emptyLandMask(g)
    const r1 = await applyWaterMask(g, mask, tester, { maxChecks: 8, delayMs: 1100, sleep })
    assert.equal(calls.length, 8)
    assert.equal(sleeps.length, 7, 'giãn cách giữa các lần gọi (không trước lần đầu)')
    assert.ok(sleeps.every((s) => s === 1100))
    assert.equal(r1.remaining, 20 - 8, '21 điểm trong hình trừ điểm giữa = 20 cần kiểm')
    mask = r1.mask
    const r2 = await applyWaterMask(g, mask, tester, { maxChecks: 40, sleep })
    assert.equal(r2.remaining, 0)
    assert.equal(r2.mask.checked.length, 20)
    assert.ok(!r2.mask.checked.includes(centerIndex(5)), 'không kiểm điểm giữa')
    const water = r2.mask.water
    assert.ok(water.length > 0)
    const pts = buildGrid(g, water)
    for (const w of water) assert.ok(pts[w].lng > g.centerLng + 0.01 && pts[w].lat <= g.centerLat + 0.012)
    assert.equal(countActive(g, water), 21 - water.length)
    // Kiểm lại không gọi tester nữa
    const before = calls.length
    const r3 = await applyWaterMask(g, r2.mask, tester, { maxChecks: 40, sleep })
    assert.equal(calls.length, before)
    assert.equal(r3.remaining, 0)
  })

  await test('mask bị reset khi đổi hình học lưới', () => {
    const g = geo(5)
    const m = { ...emptyLandMask(g), checked: [1, 2], water: [2] }
    assert.deepEqual(normalizeLandMask(m, g).water, [2])
    assert.deepEqual(normalizeLandMask(m, { ...g, spacingM: 900 }).water, [])
    assert.deepEqual(normalizeLandMask(m, geo(7)).checked, [])
    assert.deepEqual(normalizeLandMask(null, g).checked, [])
  })

  await test('classifyReverse: biển/sông = nước, có địa chỉ = đất, không rõ = null', () => {
    assert.equal(classifyReverse({ error: 'Unable to geocode' }), true)
    assert.equal(classifyReverse({ category: 'natural', type: 'water', address: { country: 'VN' } }), true)
    assert.equal(classifyReverse({ category: 'natural', type: 'bay' }), true)
    assert.equal(classifyReverse({ category: 'waterway', type: 'river' }), true)
    assert.equal(classifyReverse({ category: 'highway', type: 'residential', address: { road: 'Hồ Xuân Hương' } }), false)
    assert.equal(classifyReverse(null), null)
    assert.equal(classifyReverse({ error: 'rate limited' }), null)
  })

  // ---------- Chỉ số ----------
  await test('ARP / ATRP / SoLV khớp ví dụ đã chạy với rankgrid_finalize_scan (SQL)', () => {
    // 8 điểm có kết quả: hạng 2,5,(không có),3,1,3,3,3
    const m = computeMetrics([2, 5, null, 3, 1, 3, 3, 3].map((rank) => ({ rank })))
    assert.equal(m.arp, 2.86)
    assert.equal(m.atrp, 5.13)
    assert.equal(m.solv, 75)
    assert.equal(m.top10Pct, 87.5)
    assert.equal(m.foundPct, 87.5)
    assert.equal(m.foundCount, 7)
  })

  await test('chỉ số biên: không có điểm, không xuất hiện ở đâu, hạng > 20 coi như 21', () => {
    assert.equal(computeMetrics([]).solv, null)
    const none = computeMetrics([{ rank: null }, { rank: null }])
    assert.equal(none.arp, null)
    assert.equal(none.atrp, 21)
    assert.equal(none.solv, 0)
    const m = computeMetrics([{ rank: 25 }, { rank: 1 }])
    assert.equal(m.atrp, 11)
    assert.equal(m.arp, 1)
    assert.equal(m.solv, 50)
  })

  await test('chỉ số đối thủ từ top_places (khớp SQL)', () => {
    const lists = [
      ['C1', 'P0', 'C2'],
      ['C1', 'C2', 'C3', 'C4', 'P0'],
      ['C1', 'C2', 'C3'],
      ['C2', 'C1', 'P0'],
      ['P0', 'C1', 'C2'],
      ['C2', 'C1', 'P0'],
      ['C2', 'C1', 'P0'],
      ['C2', 'C1', 'P0'],
    ]
    const pm = computePlaceMetrics(lists)
    const by = new Map(pm.map((p) => [p.placeKey, p]))
    assert.equal(by.get('C1')!.solv, 100)
    assert.equal(by.get('C2')!.solv, 100)
    assert.equal(by.get('P0')!.solv, 75)
    assert.equal(by.get('P0')!.arp, 2.86)
    assert.equal(by.get('P0')!.atrp, 5.13)
    assert.equal(by.get('C4')!.appearances, 1)
    assert.equal(by.get('C4')!.bestRank, 4)
    assert.equal(pm[pm.length - 1].solv <= pm[0].solv, true, 'sắp theo SoLV giảm dần')
  })

  await test('SoLV theo hướng và hướng yếu nhất', () => {
    const pts = [
      { rank: 1, dxM: 0, dyM: 1000 },
      { rank: 2, dxM: 0, dyM: 700 },
      { rank: 15, dxM: 1000, dyM: 0 },
      { rank: null, dxM: 700, dyM: 100 },
      { rank: 3, dxM: 0, dyM: -900 },
      { rank: 8, dxM: -900, dyM: 0 },
      { rank: 1, dxM: 0, dyM: 0 },
    ]
    const s = sectorSolv(pts)
    assert.equal(s.N.solv, 100)
    assert.equal(s.E.solv, 0)
    const w = weakestSector(pts)
    assert.ok(w && (w.sector === 'E' || w.sector === 'W'))
    assert.equal(w!.solv, 0)
    assert.equal(rankTone(2), 'top3')
    assert.equal(rankTone(7), 'top10')
    assert.equal(rankTone(19), 'top20')
    assert.equal(rankTone(null), 'out')
  })

  // ---------- Đọc kết quả DataForSEO ----------
  await test('parse: bỏ quảng cáo, khớp place_id rồi CID (không khớp theo tên)', () => {
    const task = {
      status_code: 20000,
      result: [
        {
          items: [
            { type: 'maps_paid_item', rank_group: 1, place_id: 'ADS', title: 'Spa Sầm Sơn' },
            { type: 'maps_search', rank_group: 2, place_id: 'P2', cid: '222', title: 'Đối thủ B' },
            { type: 'maps_search', rank_group: 1, place_id: 'P1', cid: '111', title: 'Đối thủ A', rating: { value: 4.8, votes_count: 120 } },
            { type: 'maps_search', rank_group: 3, cid: '333', title: 'Spa Sầm Sơn' },
            { type: 'maps_search', rank_group: 4, place_id: 'P2', title: 'trùng' },
          ],
        },
      ],
    }
    const r = parseDfsMapsTask(task)
    assert.ok(r.ok)
    if (!r.ok) return
    assert.deepEqual(r.places.map((p) => p.placeKey), ['P1', 'P2', 'cid:333'])
    assert.equal(r.places[0].reviewsCount, 120)
    assert.equal(findTargetRank(r.places, { placeId: 'P2', cid: null }), 2)
    assert.equal(findTargetRank(r.places, { placeId: 'places/P2', cid: null }), 2)
    assert.equal(findTargetRank(r.places, { placeId: 'XX', cid: '333' }), 3)
    assert.equal(findTargetRank(r.places, { placeId: 'ADS', cid: null }), null, 'quảng cáo không tính hạng')
    assert.equal(findTargetRank(r.places, { placeId: null, cid: null }), null)
    assert.equal(placeKeyOf(null, '9'), 'cid:9')
  })

  await test('parse: lỗi tham số không thử lại, lỗi hệ thống thử lại', () => {
    const bad = parseDfsMapsTask({ status_code: 40501, status_message: 'Invalid Field' })
    assert.equal(bad.ok, false)
    if (!bad.ok) assert.equal(bad.retryable, false)
    const sys = parseDfsMapsTask({ status_code: 50000, status_message: 'Internal' })
    if (!sys.ok) assert.equal(sys.retryable, true)
    const empty = parseDfsMapsTask({ status_code: 20000, result: [{ items: null }] })
    assert.ok(empty.ok && empty.places.length === 0)
  })

  await test('CID từ google_id và link Maps', () => {
    assert.equal(cidFromGoogleId('0x3136f7e4d0b0b0b1:0x1a2b'), String(0x1a2b))
    assert.equal(cidFromGoogleId('0x31:0xffffffffffffffff'), '18446744073709551615')
    assert.equal(cidFromGoogleId('abc'), null)
    assert.equal(cidFromMapsUrl('https://maps.google.com/?cid=123456789012'), '123456789012')
    assert.equal(cidFromMapsUrl('https://maps.google.com/'), null)
  })

  // ---------- Kỳ, từ khoá ----------
  await test('khoá kỳ theo giờ VN', () => {
    // 23:30 UTC Chủ nhật 29/11/2026 = 06:30 thứ Hai 30/11 giờ VN -> tuần 49
    assert.equal(periodKey('weekly', new Date('2026-11-29T23:30:00Z')), 'w:2026-W49')
    assert.equal(periodKey('weekly', new Date('2026-11-29T16:00:00Z')), 'w:2026-W48')
    assert.equal(periodKey('monthly', new Date('2026-11-30T18:00:00Z')), 'm:2026-12')
    const a = periodKey('biweekly', new Date('2026-11-30T03:00:00Z'))
    const b = periodKey('biweekly', new Date('2026-12-06T03:00:00Z'))
    const c = periodKey('biweekly', new Date('2026-12-14T03:00:00Z'))
    assert.ok(a && b && c)
    assert.notEqual(a, c)
    assert.equal(periodKey('manual', new Date()), null)
    assert.equal(usagePeriodStart(new Date('2026-11-30T18:00:00Z')), '2026-12-01')
    const n = nextRunAt('weekly', new Date('2026-11-28T03:00:00Z'))!
    assert.equal(n.toISOString(), '2026-12-05T00:00:00.000Z', '07:00 giờ VN')
  })

  await test('chuẩn hoá và gợi ý từ khoá', () => {
    assert.equal(normalizeKeyword('  Spa   SẦM Sơn '), normalizeKeyword('spa sầm sơn'))
    assert.equal(cleanKeyword('   '), null)
    assert.ok((cleanKeyword('a'.repeat(200)) ?? '').length <= 80)
    const s = suggestKeywords({ primaryCategory: 'Spa', industry: 'spa', area: 'Sầm Sơn, Thanh Hóa', limit: 6 })
    assert.ok(s.length > 0 && s.length <= 6)
    assert.equal(new Set(s.map(normalizeKeyword)).size, s.length, 'không trùng')
  })

  // ---------- Audit hook ----------
  await test('VY04 / VY02: thiếu dữ liệu -> insufficient; có dữ liệu -> chấm điểm', () => {
    assert.equal(checkVY04(undefined).confidence, 'insufficient')
    assert.equal(checkVY02({} as AuditInput).confidence, 'insufficient')
    const base = { keyword: 'spa sầm sơn', atrp: 4, arp: 3, foundPct: 90, points: 21 }
    const good = checkVY04({ rankGrid: { scannedAt: '2026-11-27', primary: { ...base, solv: 60, centerRank: 1 }, keywords: [] } } as unknown as AuditInput)
    assert.equal(good.passed, true)
    assert.equal(good.confidence, 'estimated')
    const weak = checkVY04({ rankGrid: { scannedAt: '2026-11-27', primary: { ...base, solv: 20, centerRank: 4 }, keywords: [] } } as unknown as AuditInput)
    assert.equal(weak.passed, false)
    const kws = [
      { keyword: 'a', solv: 50, foundPct: 100 },
      { keyword: 'b', solv: 35, foundPct: 90 },
      { keyword: 'c', solv: 0, foundPct: 5 },
    ]
    const v2 = checkVY02({ rankGrid: { scannedAt: '2026-11-27', primary: { ...base, solv: 50, centerRank: 1 }, keywords: kws } } as unknown as AuditInput)
    assert.equal(v2.passed, true)
    assert.match(v2.message, /"c"/)
    const v2b = checkVY02({ rankGrid: { scannedAt: '2026-11-27', primary: { ...base, solv: 50, centerRank: 1 }, keywords: kws.slice(0, 2) } } as unknown as AuditInput)
    assert.equal(v2b.confidence, 'insufficient')
  })

  // ---------- Hạn mức theo gói ----------
  await test('hạn mức gói: Free 1 lần quét thử 5x5, 349k 5x5/5 từ khoá/2 tuần, 799k 7x7(9x9)/10 từ khoá/tuần', () => {
    const f = RANK_GRID_LIMITS.free
    assert.deepEqual(f.gridSizes, [5])
    assert.equal(f.maxKeywords, 1)
    assert.equal(f.frequency, 'none')
    assert.equal(f.manualScansPerMonth, 0)
    assert.equal(f.trialScans, 1)
    assert.ok(f.monthlyPointCap >= 21)
    const b = RANK_GRID_LIMITS.basic
    assert.deepEqual(b.gridSizes, [5])
    assert.equal(b.maxKeywords, 5)
    assert.equal(b.frequency, 'biweekly')
    assert.equal(b.manualScansPerMonth, 2)
    // 5 từ khoá × 21 điểm × tối đa 3 kỳ 2 tuần/tháng + 2 lần tay
    assert.ok(b.monthlyPointCap >= 5 * 21 * 3 + 2 * 21)
    const p = RANK_GRID_LIMITS.full
    assert.deepEqual(p.gridSizes, [5, 7, 9])
    assert.equal(p.defaultGridSize, 7)
    assert.equal(p.maxKeywords, 10)
    assert.equal(p.frequency, 'weekly')
    assert.equal(p.manualScansPerMonth, 8)
    // 10 từ khoá × 69 điểm (9x9 tròn) × 5 tuần + 8 lần tay 9x9
    assert.ok(p.monthlyPointCap >= 10 * 69 * 5 + 8 * 69)
    for (const k of Object.keys(ENTITLEMENTS) as Array<keyof typeof ENTITLEMENTS>) assert.ok(ENTITLEMENTS[k].rankGrid)
  })

  console.log(`test-rankgrid: ${passed} nhóm test OK`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
