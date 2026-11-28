/**
 * Chỉ số lưới thứ hạng (thuần). Trùng logic với rankgrid_finalize_scan() trong migration 027 — test ở scripts/test-rankgrid.ts.
 *   ARP  = hạng trung bình ở các điểm có mặt trong top 20.
 *   ATRP = hạng trung bình trên mọi điểm (không có / > 20 => 21).
 *   SoLV = % điểm nằm trong top 3.
 */
import { SECTOR_LABEL, sectorOf, type Sector } from './geometry'

export const NOT_FOUND_RANK = 21
export const TOP_N = 20

export type PointRank = { rank: number | null }

export type GridMetrics = {
  points: number
  arp: number | null
  atrp: number | null
  solv: number | null
  top10Pct: number | null
  foundPct: number | null
  foundCount: number
}

const r2 = (n: number) => Math.round(n * 100) / 100
const eff = (rank: number | null | undefined) => (rank != null && rank >= 1 && rank <= TOP_N ? rank : NOT_FOUND_RANK)

export function computeMetrics(points: PointRank[]): GridMetrics {
  const n = points.length
  if (!n) return { points: 0, arp: null, atrp: null, solv: null, top10Pct: null, foundPct: null, foundCount: 0 }
  const found = points.map((p) => eff(p.rank)).filter((r) => r <= TOP_N)
  const all = points.map((p) => eff(p.rank))
  return {
    points: n,
    arp: found.length ? r2(found.reduce((a, b) => a + b, 0) / found.length) : null,
    atrp: r2(all.reduce((a, b) => a + b, 0) / n),
    solv: r2((100 * all.filter((r) => r <= 3).length) / n),
    top10Pct: r2((100 * all.filter((r) => r <= 10).length) / n),
    foundPct: r2((100 * found.length) / n),
    foundCount: found.length,
  }
}

export type PlaceMetrics = {
  placeKey: string
  appearances: number
  top3: number
  bestRank: number
  arp: number
  atrp: number
  solv: number
}

/** Chỉ số cho mọi địa điểm từ danh sách top_places của từng điểm (thứ tự = hạng). */
export function computePlaceMetrics(topPlacesPerPoint: string[][]): PlaceMetrics[] {
  const n = topPlacesPerPoint.length
  if (!n) return []
  const acc = new Map<string, { app: number; t3: number; best: number; sum: number }>()
  for (const list of topPlacesPerPoint) {
    const seen = new Set<string>()
    list.slice(0, TOP_N).forEach((key, i) => {
      if (!key || seen.has(key)) return
      seen.add(key)
      const rank = i + 1
      const a = acc.get(key) || { app: 0, t3: 0, best: NOT_FOUND_RANK, sum: 0 }
      a.app++
      if (rank <= 3) a.t3++
      a.best = Math.min(a.best, rank)
      a.sum += rank
      acc.set(key, a)
    })
  }
  return [...acc.entries()]
    .map(([placeKey, a]) => ({
      placeKey,
      appearances: a.app,
      top3: a.t3,
      bestRank: a.best,
      arp: r2(a.sum / a.app),
      atrp: r2((a.sum + NOT_FOUND_RANK * (n - a.app)) / n),
      solv: r2((100 * a.t3) / n),
    }))
    .sort((x, y) => y.solv - x.solv || x.atrp - y.atrp)
}

export type SectorPoint = PointRank & { dxM: number; dyM: number }

/** SoLV theo 4 hướng — để viết nhận định "phía Bắc gần như không thấy quán". */
export function sectorSolv(points: SectorPoint[]): Record<Sector, { points: number; solv: number | null }> {
  const out = { N: [], E: [], S: [], W: [] } as Record<Sector, PointRank[]>
  for (const p of points) {
    const s = sectorOf(p.dxM, p.dyM)
    if (s) out[s].push(p)
  }
  const res = {} as Record<Sector, { points: number; solv: number | null }>
  for (const k of Object.keys(out) as Sector[]) res[k] = { points: out[k].length, solv: computeMetrics(out[k]).solv }
  return res
}

export function weakestSector(points: SectorPoint[]): { sector: Sector; label: string; solv: number } | null {
  const s = sectorSolv(points)
  let best: { sector: Sector; label: string; solv: number } | null = null
  for (const k of Object.keys(s) as Sector[]) {
    const v = s[k]
    if (v.points < 2 || v.solv == null) continue
    if (!best || v.solv < best.solv) best = { sector: k, label: SECTOR_LABEL[k], solv: v.solv }
  }
  return best
}

/** Màu ghim: top 3 xanh, 4–10 vàng, 11–20 đỏ, ngoài top 20 xám. */
export function rankTone(rank: number | null | undefined): 'top3' | 'top10' | 'top20' | 'out' {
  const r = eff(rank)
  if (r <= 3) return 'top3'
  if (r <= 10) return 'top10'
  if (r <= TOP_N) return 'top20'
  return 'out'
}
