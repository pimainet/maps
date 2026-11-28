/**
 * Đọc kết quả DataForSEO Google Maps SERP (advanced) -> danh sách địa điểm theo hạng (thuần, có test).
 * Khớp chính quán bằng place_id, sau đó CID. KHÔNG khớp theo tên.
 */
import { TOP_N } from './metrics'

export type RankedPlace = {
  placeKey: string
  placeId: string | null
  cid: string | null
  title: string | null
  category: string | null
  rating: number | null
  reviewsCount: number | null
  lat: number | null
  lng: number | null
  phone: string | null
}

export type ParsedTask = { ok: true; places: RankedPlace[]; resultCount: number } | { ok: false; error: string; retryable: boolean }

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : typeof v === 'number' ? String(v) : null)
const num = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v) : v
  return typeof n === 'number' && Number.isFinite(n) ? n : null
}

export function canonPlaceId(v: unknown): string | null {
  const s = str(v)
  return s ? s.replace(/^places\//, '') : null
}

export function placeKeyOf(placeId: string | null, cid: string | null): string | null {
  if (placeId) return placeId
  if (cid) return `cid:${cid}`
  return null
}

/** Phần tử DataForSEO -> RankedPlace (null nếu không có định danh). */
export function toRankedPlace(item: any): RankedPlace | null {
  const placeId = canonPlaceId(item?.place_id)
  const cid = str(item?.cid)
  const placeKey = placeKeyOf(placeId, cid)
  if (!placeKey) return null
  return {
    placeKey,
    placeId,
    cid,
    title: str(item?.title),
    category: str(item?.category),
    rating: num(item?.rating?.value),
    reviewsCount: num(item?.rating?.votes_count),
    lat: num(item?.latitude),
    lng: num(item?.longitude),
    phone: str(item?.phone),
  }
}

/** Trạng thái DataForSEO: 20000 OK; 40xxx lỗi tham số (không thử lại); 50xxx lỗi hệ thống (thử lại). */
export function parseDfsMapsTask(task: any): ParsedTask {
  if (!task) return { ok: false, error: 'Không có task trong phản hồi', retryable: true }
  const code = Number(task.status_code)
  if (code !== 20000) {
    const retryable = !(code >= 40000 && code < 50000) || code === 40601 || code === 40602 // 406xx: task chưa xong / đang xử lý
    return { ok: false, error: `${code} ${String(task.status_message || '').slice(0, 160)}`, retryable }
  }
  const result = Array.isArray(task.result) ? task.result[0] : null
  const items: any[] = Array.isArray(result?.items) ? result.items : []
  // Bỏ quảng cáo (maps_paid_item) và phần tử không phải kết quả tìm kiếm thường.
  const organic = items
    .filter((it) => it && (it.type === 'maps_search' || it.type == null))
    .sort((a, b) => (num(a.rank_group) ?? 999) - (num(b.rank_group) ?? 999))
  const places: RankedPlace[] = []
  const seen = new Set<string>()
  for (const it of organic) {
    const p = toRankedPlace(it)
    if (!p || seen.has(p.placeKey)) continue
    seen.add(p.placeKey)
    places.push(p)
    if (places.length >= TOP_N) break
  }
  return { ok: true, places, resultCount: places.length }
}

export type TargetIdentity = { placeId: string | null; cid: string | null }

/** Hạng 1-based của chính quán trong danh sách (null = không có). Khớp place_id trước, rồi CID. */
export function findTargetRank(places: RankedPlace[], target: TargetIdentity): number | null {
  const pid = canonPlaceId(target.placeId)
  const cid = str(target.cid)
  if (!pid && !cid) return null
  for (let i = 0; i < places.length; i++) {
    const p = places[i]
    if (pid && p.placeId === pid) return i + 1
    if (cid && p.cid === cid) return i + 1
  }
  return null
}

/** CID (thập phân) từ Outscraper google_id dạng "0x...:0x..." (phần sau dấu hai chấm). */
export function cidFromGoogleId(googleId: unknown): string | null {
  const s = str(googleId)
  const m = s?.match(/^0x[0-9a-f]+:(0x[0-9a-f]+)$/i)
  if (!m) return null
  try {
    return BigInt(m[1]).toString()
  } catch {
    return null
  }
}

export function cidFromMapsUrl(url: unknown): string | null {
  return str(url)?.match(/[?&]cid=(\d{5,25})/)?.[1] ?? null
}
