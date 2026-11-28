/**
 * Hình học lưới thứ hạng (thuần, không gọi mạng — có test trong scripts/test-rankgrid.ts).
 *
 * Quy ước: hàng 0 ở phía Bắc, cột 0 ở phía Tây; idx = row * size + col; điểm giữa = (size*size - 1) / 2.
 * Lưới tròn giữ các điểm có khoảng cách tới tâm <= (r + 0.5) * spacing (r = (size-1)/2):
 *   5x5 -> 21 điểm, 7x7 -> 37 điểm, 9x9 -> 69 điểm.
 */

export type GridSize = 3 | 5 | 7 | 9
export type GridShape = 'square' | 'circle'

export const GRID_SIZES: GridSize[] = [3, 5, 7, 9]
export const MIN_SPACING_M = 200
export const MAX_SPACING_M = 5000

export type GridGeometry = {
  centerLat: number
  centerLng: number
  size: GridSize
  spacingM: number
  shape: GridShape
}

export type GridPoint = {
  idx: number
  row: number
  col: number
  lat: number
  lng: number
  /** Toạ độ so với tâm, mét (x: Đông +, y: Bắc +). */
  dxM: number
  dyM: number
  distM: number
  /** Nằm trong hình lưới (tròn/vuông). */
  inShape: boolean
  /** Bị tắt (người dùng tắt hoặc kiểm tra là mặt nước). */
  disabled: boolean
}

const M_PER_DEG_LAT = 111_320

export function isGridSize(v: unknown): v is GridSize {
  return v === 3 || v === 5 || v === 7 || v === 9
}

export function centerIndex(size: number): number {
  return (size * size - 1) / 2
}

export function offsetLatLng(lat: number, lng: number, dxM: number, dyM: number): { lat: number; lng: number } {
  const dLat = dyM / M_PER_DEG_LAT
  const dLng = dxM / (M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180))
  return { lat: round7(lat + dLat), lng: round7(lng + dLng) }
}

/** Khoảng cách xấp xỉ (equirectangular), đủ chính xác ở phạm vi vài chục km. */
export function distanceM(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const x = ((bLng - aLng) * Math.PI) / 180 * Math.cos((((aLat + bLat) / 2) * Math.PI) / 180)
  const y = ((bLat - aLat) * Math.PI) / 180
  return Math.sqrt(x * x + y * y) * 6_371_000
}

function round7(n: number): number {
  return Math.round(n * 1e7) / 1e7
}

export function inCircle(row: number, col: number, size: number): boolean {
  const r = (size - 1) / 2
  const di = row - r
  const dj = col - r
  return di * di + dj * dj <= (r + 0.5) * (r + 0.5) + 1e-9
}

export function radiusM(size: number, spacingM: number): number {
  return ((size - 1) / 2) * spacingM
}

/** Tạo toàn bộ điểm (kể cả điểm ngoài hình / bị tắt — dùng `activePoints` để lấy điểm sẽ quét). */
export function buildGrid(g: GridGeometry, disabled: Iterable<number> = []): GridPoint[] {
  const off = new Set(disabled)
  const r = (g.size - 1) / 2
  const out: GridPoint[] = []
  for (let row = 0; row < g.size; row++) {
    for (let col = 0; col < g.size; col++) {
      const idx = row * g.size + col
      const dxM = (col - r) * g.spacingM
      const dyM = (r - row) * g.spacingM
      const { lat, lng } = offsetLatLng(g.centerLat, g.centerLng, dxM, dyM)
      const inShape = g.shape === 'square' ? true : inCircle(row, col, g.size)
      out.push({
        idx,
        row,
        col,
        lat,
        lng,
        dxM,
        dyM,
        distM: Math.round(Math.sqrt(dxM * dxM + dyM * dyM)),
        inShape,
        // Điểm giữa (chính quán) không bao giờ bị tắt.
        disabled: idx !== centerIndex(g.size) && off.has(idx),
      })
    }
  }
  return out
}

export function activePoints(points: GridPoint[]): GridPoint[] {
  return points.filter((p) => p.inShape && !p.disabled)
}

/** Số điểm sẽ quét = số điểm tính tiền cho 1 từ khoá. */
export function countActive(g: GridGeometry, disabled: Iterable<number> = []): number {
  return activePoints(buildGrid(g, disabled)).length
}

/** Khoá hình học: đổi tâm/cỡ/khoảng cách/hình thì kết quả kiểm tra mặt nước cũ hết hiệu lực. */
export function geometryKey(g: GridGeometry): string {
  return [g.centerLat.toFixed(5), g.centerLng.toFixed(5), g.size, g.spacingM, g.shape].join('|')
}

/** Hook kiểm tra mặt nước: trả true = điểm nằm trên biển/sông/hồ (tắt), false = đất liền, null = không rõ (giữ nguyên). */
export type WaterTester = (lat: number, lng: number) => Promise<boolean | null>

export type LandMask = { geom: string; checked: number[]; water: number[] }

export function emptyLandMask(g: GridGeometry): LandMask {
  return { geom: geometryKey(g), checked: [], water: [] }
}

export function normalizeLandMask(raw: unknown, g: GridGeometry): LandMask {
  const m = raw as Partial<LandMask> | null
  if (!m || m.geom !== geometryKey(g)) return emptyLandMask(g)
  const ints = (a: unknown) => (Array.isArray(a) ? a.filter((x): x is number => Number.isInteger(x)) : [])
  return { geom: m.geom, checked: ints(m.checked), water: ints(m.water) }
}

/**
 * Kiểm tra mặt nước cho tối đa `maxChecks` điểm chưa kiểm (trong hình, trừ điểm giữa), gọi `tester` tuần tự.
 * Trả về mask mới + còn bao nhiêu điểm chưa kiểm. Không ném lỗi: tester lỗi -> coi như null (giữ điểm).
 */
export async function applyWaterMask(
  g: GridGeometry,
  mask: LandMask,
  tester: WaterTester,
  opts: { maxChecks: number; delayMs?: number; sleep?: (ms: number) => Promise<void> },
): Promise<{ mask: LandMask; remaining: number; newlyWater: number[] }> {
  const checked = new Set(mask.checked)
  const water = new Set(mask.water)
  const todo = buildGrid(g).filter((p) => p.inShape && p.idx !== centerIndex(g.size) && !checked.has(p.idx))
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const newlyWater: number[] = []
  let n = 0
  for (const p of todo) {
    if (n >= opts.maxChecks) break
    if (n > 0 && opts.delayMs) await sleep(opts.delayMs)
    n++
    let res: boolean | null = null
    try {
      res = await tester(p.lat, p.lng)
    } catch {
      res = null
    }
    checked.add(p.idx)
    if (res === true) {
      water.add(p.idx)
      newlyWater.push(p.idx)
    }
  }
  return {
    mask: { geom: mask.geom, checked: [...checked].sort((a, b) => a - b), water: [...water].sort((a, b) => a - b) },
    remaining: todo.length - n,
    newlyWater,
  }
}

export type Sector = 'N' | 'E' | 'S' | 'W'
export const SECTOR_LABEL: Record<Sector, string> = { N: 'phía Bắc', E: 'phía Đông', S: 'phía Nam', W: 'phía Tây' }

/** Góc phần tư theo hướng chiếm ưu thế (điểm giữa không thuộc hướng nào). */
export function sectorOf(dxM: number, dyM: number): Sector | null {
  if (dxM === 0 && dyM === 0) return null
  if (Math.abs(dyM) >= Math.abs(dxM)) return dyM > 0 ? 'N' : 'S'
  return dxM > 0 ? 'E' : 'W'
}

/** Gợi ý khoảng cách điểm theo ngành (xem DESIGN.md mục 3). */
export function suggestSpacingM(industry: string | null | undefined, area?: string | null): number {
  const s = `${industry || ''} ${area || ''}`.toLowerCase()
  const has = (...k: string[]) => k.some((x) => s.includes(x))
  if (has('showroom', 'ô tô', 'oto', 'xe máy', 'nội thất', 'vật liệu')) return 1500
  if (has('nha khoa', 'răng', 'phòng khám', 'bệnh viện', 'clinic', 'dental')) return 1000
  if (has('sầm sơn', 'sam son')) return 500
  return 700
}
