/**
 * Tìm doanh nghiệp theo "tên + khu vực" để chủ quán CHỌN thay vì tự dán link/Place ID.
 * Nguồn: Places API (New) searchText nếu có GOOGLE_PLACES_API_KEY (nhanh, rẻ); không thì Outscraper search-v3.
 * Kết quả luôn có place_id + link Maps hợp lệ (đã qua isSupportedGoogleMapsUrl) để ghi thẳng vào hồ sơ.
 */
import { buildMapsSearchUrl, canonicalizePlaceId, isSupportedGoogleMapsUrl } from '@/lib/place-identity'
import { fetchOutscraperSearch, outscraperConfigured } from '@/lib/gbp-outscraper'

export type PlaceCandidate = {
  place_id: string
  name: string
  address: string | null
  category: string | null
  rating: number | null
  review_count: number | null
  maps_url: string
}

export const MAX_CANDIDATES = 5
const PLACE_ID_RE = /^[A-Za-z0-9_-]{10,200}$/

function num(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN
  return Number.isFinite(n) ? n : null
}
function text(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

/** Link dùng để lưu: ưu tiên link nguồn trả về nếu hợp lệ, không thì dựng từ place_id. */
function pickMapsUrl(raw: unknown, placeId: string): string {
  const u = text(raw)
  if (u && isSupportedGoogleMapsUrl(u)) return u
  return buildMapsSearchUrl({ placeId }) as string
}

export function mapPlacesResults(data: any): PlaceCandidate[] {
  const out: PlaceCandidate[] = []
  for (const p of Array.isArray(data?.places) ? data.places : []) {
    const id = canonicalizePlaceId(text(p?.id))
    const name = text(p?.displayName?.text)
    if (!id || !PLACE_ID_RE.test(id) || !name) continue
    out.push({
      place_id: id,
      name,
      address: text(p?.formattedAddress),
      category: text(p?.primaryTypeDisplayName?.text),
      rating: num(p?.rating),
      review_count: num(p?.userRatingCount),
      maps_url: pickMapsUrl(p?.googleMapsUri, id),
    })
  }
  return dedupe(out)
}

export function mapOutscraperResults(rows: any[]): PlaceCandidate[] {
  const out: PlaceCandidate[] = []
  for (const p of Array.isArray(rows) ? rows : []) {
    const id = canonicalizePlaceId(text(p?.place_id))
    const name = text(p?.name)
    if (!id || !PLACE_ID_RE.test(id) || !name) continue
    out.push({
      place_id: id,
      name,
      address: text(p?.full_address ?? p?.address),
      category: text(p?.type ?? p?.category),
      rating: num(p?.rating),
      review_count: num(p?.reviews),
      maps_url: pickMapsUrl(p?.location_link, id),
    })
  }
  return dedupe(out)
}

function dedupe(list: PlaceCandidate[]): PlaceCandidate[] {
  const seen = new Set<string>()
  return list.filter((c) => (seen.has(c.place_id) ? false : (seen.add(c.place_id), true))).slice(0, MAX_CANDIDATES)
}

export function placeSearchConfigured(): boolean {
  return Boolean(process.env.GOOGLE_PLACES_API_KEY) || outscraperConfigured()
}

export async function searchPlaceCandidates(textQuery: string): Promise<PlaceCandidate[]> {
  const key = process.env.GOOGLE_PLACES_API_KEY
  if (key) {
    try {
      const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': key,
          'X-Goog-FieldMask':
            'places.id,places.displayName,places.formattedAddress,places.rating,places.userRatingCount,places.primaryTypeDisplayName,places.googleMapsUri',
        },
        body: JSON.stringify({ textQuery, languageCode: 'vi', regionCode: process.env.OUTSCRAPER_REGION || 'VN', pageSize: MAX_CANDIDATES }),
        signal: AbortSignal.timeout(15_000),
      })
      const data = await res.json().catch(() => null)
      if (res.ok) return mapPlacesResults(data)
      console.error('place-search: Places', res.status, String(data?.error?.message || '').slice(0, 200))
    } catch (e: any) {
      console.error('place-search: Places lỗi', e?.message)
    }
    if (!outscraperConfigured()) throw new Error('Không tìm được lúc này. Vui lòng thử lại sau.')
  }
  if (!outscraperConfigured()) throw new Error('Chưa cấu hình nguồn dữ liệu Google Maps.')
  return mapOutscraperResults(await fetchOutscraperSearch(textQuery, MAX_CANDIDATES, 45_000))
}
