/**
 * Đối thủ + thứ hạng tìm kiếm cho Audit Engine (VY01, VY03, T01, T02).
 *
 * Cách làm: tìm "<danh mục chính> <khu vực>" qua Outscraper (kết quả theo thứ tự Google trả về), lấy tối đa N địa điểm.
 *   - Vị trí của chính doanh nghiệp trong danh sách = thứ hạng ƯỚC LƯỢNG (kết quả không cá nhân hoá theo vị trí người tìm,
 *     nên engine ghi confidence 'estimated', không phải 'verified').
 *   - Các địa điểm còn lại (trừ chính doanh nghiệp) = nhóm đối thủ để so sánh số review, điểm sao, số ảnh.
 *
 * Kết quả cache trong cột gbp_snapshots.competitors (đã có từ migration 009) 14 ngày để không tốn credit mỗi lần audit.
 * File này chỉ chứa hàm thuần (buildCompetitorSet, median...) + 1 hàm gọi mạng (fetchCompetitorSet).
 */

import { fetchOutscraperSearch, outscraperConfigured } from '@/lib/gbp-outscraper'

export const COMPETITOR_CACHE_DAYS = 14

export type CompetitorItem = {
  name: string
  placeId?: string | null
  rating?: number
  reviewCount?: number
  photoCountEst?: number
  category?: string | null
  /** Vị trí trong kết quả tìm kiếm (1 = đầu tiên). */
  rank: number
}

export type CompetitorSet = {
  query: string
  fetchedAt: string
  /** Vị trí của chính doanh nghiệp trong kết quả (1-based), null = không nằm trong top `total`. */
  selfRank: number | null
  total: number
  items: CompetitorItem[]
  source: 'outscraper'
}

const num = (v: unknown): number | undefined => {
  const n = typeof v === 'string' ? Number(v.replace(',', '.')) : (v as number)
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined
}

function norm(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function sameName(a: string, b: string): boolean {
  const x = norm(a)
  const y = norm(b)
  if (!x || !y) return false
  if (x === y) return true
  const ta = x.split(' ')
  const tb = new Set(y.split(' '))
  const hit = ta.filter((t) => tb.has(t)).length
  return hit / Math.max(ta.length, tb.size) >= 0.8
}

export function median(values: number[]): number | undefined {
  const v = values.filter((n) => Number.isFinite(n)).sort((a, b) => a - b)
  if (!v.length) return undefined
  const mid = Math.floor(v.length / 2)
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2
}

/** Truy vấn tìm kiếm: danh mục chính + khu vực. Trả null nếu thiếu 1 trong 2 (không đoán). */
export function buildCompetitorQuery(category?: string | null, area?: string | null): string | null {
  const c = (category || '').trim()
  const a = (area || '').trim()
  if (!c || !a) return null
  return `${c} ${a}`.slice(0, 160)
}

/** Lấy khu vực từ địa chỉ khi khách chưa khai: 2 phần cuối của địa chỉ (vd "Quận 1, TP.HCM"). */
export function areaFromAddress(address?: string | null): string | null {
  if (!address) return null
  const parts = address.split(',').map((p) => p.trim()).filter(Boolean)
  if (parts.length < 2) return null
  return parts.slice(-3, -1).join(', ') || null // bỏ phần cuối (thường là tên nước)
}

/** Hàm thuần: danh sách địa điểm thô từ Outscraper -> CompetitorSet. */
export function buildCompetitorSet(
  rows: any[],
  self: { placeId?: string | null; name?: string | null },
  query: string,
  now = new Date(),
): CompetitorSet {
  const items: CompetitorItem[] = []
  let selfRank: number | null = null
  rows.forEach((r, i) => {
    const name = String(r?.name ?? '').trim()
    if (!name) return
    const rank = i + 1
    const pid = r?.place_id ? String(r.place_id) : null
    const isSelf =
      (self.placeId && pid && self.placeId.replace(/^places\//, '') === pid) ||
      (!self.placeId && self.name && sameName(self.name, name))
    if (isSelf) {
      if (selfRank == null) selfRank = rank
      return
    }
    items.push({
      name,
      placeId: pid,
      rating: num(r?.rating),
      reviewCount: num(r?.reviews),
      photoCountEst: num(r?.photos_count),
      category: r?.type ? String(r.type) : null,
      rank,
    })
  })
  return { query, fetchedAt: now.toISOString(), selfRank, total: rows.length, items, source: 'outscraper' }
}

export async function fetchCompetitorSet(args: {
  category?: string | null
  area?: string | null
  placeId?: string | null
  name?: string | null
  limit?: number
}): Promise<CompetitorSet | null> {
  if (!outscraperConfigured()) return null
  const query = buildCompetitorQuery(args.category, args.area)
  if (!query) return null
  const limit = args.limit ?? Number(process.env.COMPETITOR_SEARCH_LIMIT || 20)
  const rows = await fetchOutscraperSearch(query, limit)
  if (!rows.length) return null
  return buildCompetitorSet(rows, { placeId: args.placeId, name: args.name }, query)
}

/** Cache còn hạn và đúng truy vấn? (cột competitors của snapshot, hình dạng do ta ghi). */
export function usableCachedSet(cached: unknown, query: string | null, now = Date.now()): CompetitorSet | null {
  const c = cached as Partial<CompetitorSet> | null
  if (!c || typeof c !== 'object' || !query) return null
  if (c.source !== 'outscraper' || c.query !== query || !Array.isArray(c.items) || !c.fetchedAt) return null
  const age = now - new Date(c.fetchedAt).getTime()
  return age >= 0 && age <= COMPETITOR_CACHE_DAYS * 86_400_000 ? (c as CompetitorSet) : null
}
