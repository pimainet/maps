/**
 * Xác định danh tính + toạ độ ghim GBP của khách cho lưới thứ hạng (place_id, CID, lat/lng).
 * Trên DB thật nhiều khách chưa có lat/lng/place_id, nên bước này chạy trước khi tạo lưới.
 * Thứ tự: dữ liệu sẵn có (place_id / link ?cid=) -> Places API Details (nếu có GOOGLE_PLACES_API_KEY)
 *   -> Outscraper search-v3 (place_id/link, cuối cùng tên + khu vực) -> DataForSEO My Business Info (chỉ để bù CID).
 * Kết quả tìm theo TÊN có thể là quán khác -> needsConfirm = true để người dùng xác nhận trên giao diện.
 */
import { extractPlaceIdFromUrl } from '@/lib/place-identity'
import { fetchOutscraperPlace, outscraperConfigured } from '@/lib/gbp-outscraper'
import { dataforseoConfigured, fetchDataForSeoInfo } from '@/lib/gbp-dataforseo'
import { canonPlaceId, cidFromGoogleId, cidFromMapsUrl } from './parse'

export type ClientIdentityInput = {
  name?: string | null
  area?: string | null
  gbp_link?: string | null
  place_id?: string | null
  gbp_cid?: string | null
  latitude?: number | null
  longitude?: number | null
}

export type ResolvedIdentity = {
  placeId: string | null
  cid: string | null
  lat: number | null
  lng: number | null
  name: string | null
  sources: string[]
  needsConfirm: boolean
  errors: string[]
}

const num = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v) : v
  return typeof n === 'number' && Number.isFinite(n) ? n : null
}
const validLatLng = (lat: number | null, lng: number | null) =>
  lat != null && lng != null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0)

/** Phần thuần: đọc 1 địa điểm Outscraper. */
export function fromOutscraperPlace(p: any): { placeId: string | null; cid: string | null; lat: number | null; lng: number | null; name: string | null } {
  return {
    placeId: canonPlaceId(p?.place_id),
    cid: (p?.cid != null && /^\d{5,25}$/.test(String(p.cid)) ? String(p.cid) : null) || cidFromGoogleId(p?.google_id),
    lat: num(p?.latitude),
    lng: num(p?.longitude),
    name: typeof p?.name === 'string' ? p.name : null,
  }
}

async function placesDetails(placeId: string): Promise<{ lat: number | null; lng: number | null; cid: string | null; name: string | null } | null> {
  const key = process.env.GOOGLE_PLACES_API_KEY
  if (!key) return null
  const res = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`, {
    headers: { 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': 'id,displayName,location,googleMapsUri' },
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) throw new Error(`Places HTTP ${res.status}`)
  const d: any = await res.json()
  return {
    lat: num(d?.location?.latitude),
    lng: num(d?.location?.longitude),
    cid: cidFromMapsUrl(d?.googleMapsUri),
    name: typeof d?.displayName?.text === 'string' ? d.displayName.text : null,
  }
}

export async function resolveClientIdentity(c: ClientIdentityInput): Promise<ResolvedIdentity> {
  const out: ResolvedIdentity = {
    placeId: canonPlaceId(c.place_id) || extractPlaceIdFromUrl(c.gbp_link),
    cid: c.gbp_cid || cidFromMapsUrl(c.gbp_link),
    lat: num(c.latitude),
    lng: num(c.longitude),
    name: c.name ?? null,
    sources: [],
    needsConfirm: false,
    errors: [],
  }
  const done = () => Boolean(out.placeId && out.cid && validLatLng(out.lat, out.lng))
  if (done()) return { ...out, sources: ['saved'] }

  if (out.placeId && !validLatLng(out.lat, out.lng)) {
    try {
      const d = await placesDetails(out.placeId)
      if (d) {
        if (validLatLng(d.lat, d.lng)) ((out.lat = d.lat), (out.lng = d.lng))
        out.cid = out.cid || d.cid
        out.name = d.name || out.name
        out.sources.push('places')
      }
    } catch (e: any) {
      out.errors.push(String(e?.message || e).slice(0, 120))
    }
  }

  if (!done() && outscraperConfigured()) {
    try {
      const p = await fetchOutscraperPlace({
        placeId: out.placeId,
        mapsUrl: out.placeId ? undefined : c.gbp_link || undefined,
        businessName: out.placeId || c.gbp_link ? undefined : c.name || undefined,
        area: c.area || undefined,
        budgetMs: 45_000,
      })
      if (p) {
        const o = fromOutscraperPlace(p)
        const byName = !out.placeId && !c.gbp_link
        if (out.placeId && o.placeId && o.placeId !== out.placeId) {
          out.errors.push('Outscraper trả về địa điểm khác place_id đã lưu — bỏ qua.')
        } else {
          out.placeId = out.placeId || o.placeId
          out.cid = out.cid || o.cid
          if (!validLatLng(out.lat, out.lng) && validLatLng(o.lat, o.lng)) ((out.lat = o.lat), (out.lng = o.lng))
          out.name = o.name || out.name
          out.sources.push('outscraper')
          if (byName) out.needsConfirm = true
        }
      }
    } catch (e: any) {
      out.errors.push(String(e?.message || e).slice(0, 120))
    }
  }

  if (!out.cid && (out.placeId || c.gbp_link) && dataforseoConfigured()) {
    const r = await fetchDataForSeoInfo({ placeId: out.placeId, mapsUrl: c.gbp_link || undefined, businessName: c.name || undefined, area: c.area || undefined })
    if (r.info) {
      if (!out.placeId || !r.info.place_id || r.info.place_id === out.placeId) {
        out.cid = r.info.cid || out.cid
        out.placeId = out.placeId || r.info.place_id
        out.sources.push('dataforseo')
      }
    } else if (r.error) out.errors.push(r.error)
  }

  if (!validLatLng(out.lat, out.lng)) ((out.lat = null), (out.lng = null))
  return out
}
