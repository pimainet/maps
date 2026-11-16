/**
 * Dự phòng cho SerpApi: SearchApi.io engine=google_maps_place (place_id) -> cùng dạng SerpInfo.
 * Trường theo tài liệu SearchApi: place_result.description / type (chuỗi) / types (mảng) / posts[{title|snippet, date, post_link…}].
 * Chỉ gọi khi SerpApi không có/không trả được dữ liệu và đã cấu hình SEARCHAPI_API_KEY.
 */
import type { GbpPostItem } from '@/lib/gbp-snapshot-types'
import { GBP_SNAPSHOT_MAX_POSTS } from '@/lib/gbp-snapshot-types'
import { ageDays, relativeVi } from '@/lib/gbp-outscraper'
import type { SerpInfo } from '@/lib/gbp-serpapi'

const ENDPOINT = 'https://www.searchapi.io/api/v1/search'
const TIMEOUT_MS = 30_000

export function searchApiConfigured(): boolean {
  return Boolean(process.env.SEARCHAPI_API_KEY)
}

const clean = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)

export function parseSearchApiInfo(json: any, now = Date.now()): SerpInfo | null {
  const p = json?.place_result
  if (!p || typeof p !== 'object') return null
  const types = [clean(p.type), ...(Array.isArray(p.types) ? p.types.map(clean) : [])].filter((x, i, a): x is string => !!x && a.indexOf(x) === i)
  let posts: GbpPostItem[] | null = null
  if (Array.isArray(p.posts)) {
    posts = p.posts
      .map((x: any): GbpPostItem | null => {
        const text = [clean(x?.title), clean(x?.snippet) ?? clean(x?.description)].filter(Boolean).join(' — ')
        if (!text) return null
        const ms = Date.parse(String(x?.date ?? ''))
        return { text: text.slice(0, 500), approx_date: Number.isNaN(ms) ? null : relativeVi(ageDays(ms, now)) }
      })
      .filter((x: GbpPostItem | null): x is GbpPostItem => !!x)
      .slice(0, GBP_SNAPSHOT_MAX_POSTS)
  }
  return { place_id: clean(p.place_id), description: clean(p.description), types, posts }
}

export async function fetchSearchApiInfo(placeId: string): Promise<{ info: SerpInfo | null; error?: string }> {
  if (!searchApiConfigured()) return { info: null, error: 'Chưa cấu hình SEARCHAPI_API_KEY' }
  try {
    const qs = new URLSearchParams({
      engine: 'google_maps_place',
      place_id: placeId.replace(/^places\//, ''),
      hl: 'vi',
      gl: 'vn',
      api_key: process.env.SEARCHAPI_API_KEY as string,
    })
    const res = await fetch(`${ENDPOINT}?${qs.toString()}`, { signal: AbortSignal.timeout(TIMEOUT_MS) })
    const json: any = await res.json().catch(() => null)
    if (!res.ok || json?.error) {
      const why = typeof json?.error === 'string' ? json.error.slice(0, 120) : `HTTP ${res.status}`
      return { info: null, error: `SearchApi: ${why}` }
    }
    const info = parseSearchApiInfo(json)
    return info ? { info } : { info: null, error: 'SearchApi không có kết quả cho địa điểm này' }
  } catch (e: any) {
    return { info: null, error: `SearchApi lỗi: ${String(e?.message || e).slice(0, 120)}` }
  }
}
