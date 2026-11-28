/**
 * Nguồn phụ: SerpApi (https://serpapi.com). Đọc giao diện Google Maps nên có những thứ Places API/Outscraper hay thiếu.
 * Bật bằng SERPAPI_API_KEY; thiếu khóa = bỏ qua nguồn này. Mọi lỗi đều trả { error } chứ không ném.
 *
 * 3 engine được dùng (mỗi lần gọi = 1 search, cache 1 giờ phía SerpApi là miễn phí):
 *  - google_maps (type=place, place_id): mô tả, danh mục (type[]), bài đăng mới nhất (posts), giờ (hours),
 *    thuộc tính (extensions + service_options), unclaimed_listing, open_state, rating_summary, questions_and_answers,
 *    menu/order/booking link, data_id.
 *  - google_maps_reviews (place_id, sort_by=newestFirst): review mới nhất KÈM phản hồi của chủ (response.snippet + iso_date).
 *  - google_maps_posts (data_id): danh sách bài đăng đầy đủ với posted_at (ISO) — chỉ gọi khi bài đăng còn thiếu ngày.
 * Tài liệu: serpapi.com/maps-place-results, /google-maps-reviews-api, /google-maps-posts-api (đọc 28/11/2026).
 */
import type { ExtraPlace, ExtraReviews } from '@/lib/gbp-extra-parse'
import {
  actionLinksFrom,
  capPosts,
  capReviews,
  clean,
  extensionsToGroups,
  histogramToDist,
  hoursToText,
  normPlaceId,
  num,
  qaFrom,
  statusFromOpenState,
  toPost,
  toReview,
} from '@/lib/gbp-extra-parse'
import type { GbpPostItem } from '@/lib/gbp-snapshot-types'

const ENDPOINT = 'https://serpapi.com/search.json'
const TIMEOUT_MS = 30_000

export function serpapiConfigured(): boolean {
  return Boolean(process.env.SERPAPI_API_KEY)
}

/** Phần thuần: JSON google_maps (place) -> ExtraPlace (null nếu không có place_results). */
export function parseSerpPlace(json: any, now = Date.now()): ExtraPlace | null {
  const p = json?.place_results
  if (!p || typeof p !== 'object') return null
  const types = (Array.isArray(p.type) ? p.type : [p.type]).map(clean).filter((x: string | null): x is string => !!x)
  let posts: GbpPostItem[] | null = null
  if (Array.isArray(p.posts)) {
    posts = capPosts(
      p.posts
        .map((x: any) => toPost({ title: x?.title, body: x?.description ?? x?.snippet, date: x?.date }, now))
        .filter((x: GbpPostItem | null): x is GbpPostItem => !!x),
    )
  }
  const openState = clean(p.open_state)
  return {
    provider: 'serpapi',
    place_id: normPlaceId(p.place_id),
    data_id: clean(p.data_id),
    title: clean(p.title),
    description: clean(p.description),
    types: [...new Set(types)] as string[],
    posts,
    opening_hours: hoursToText(p.hours),
    hours_today: openState,
    attributes: extensionsToGroups(p.extensions, p.service_options),
    action_links: actionLinksFrom(p),
    claim_signal: p.unclaimed_listing === true ? 'unclaimed' : null,
    business_status: statusFromOpenState(openState),
    rating_distribution: histogramToDist(p.rating_summary),
    questions_answers: qaFrom(p.questions_and_answers),
    phone: clean(p.phone),
    website_url: clean(p.website),
    rating: num(p.rating),
    review_count: num(p.reviews),
  }
}

/** Phần thuần: JSON google_maps_reviews -> ExtraReviews. SerpApi có tài liệu trường `response` => reply_known = true. */
export function parseSerpReviews(json: any, now = Date.now()): ExtraReviews | null {
  if (!Array.isArray(json?.reviews)) return null
  const items = json.reviews
    .map((r: any) =>
      toReview(r, { text: r?.snippet ?? r?.extracted_snippet?.original, reply: r?.response?.snippet ?? r?.response?.extracted_snippet?.original, replyDate: r?.response?.date, replyIso: r?.response?.iso_date }, now),
    )
    .filter(Boolean)
  return {
    provider: 'serpapi',
    place_id: normPlaceId(json?.place_info?.place_id ?? json?.search_parameters?.place_id),
    items: capReviews(items),
    reply_known: true,
  }
}

/** Phần thuần: JSON google_maps_posts -> bài đăng có posted_at ISO. null nếu không có khóa posts. */
export function parseSerpPosts(json: any, now = Date.now()): GbpPostItem[] | null {
  if (!Array.isArray(json?.posts)) return null
  return capPosts(
    json.posts
      .map((x: any) => toPost({ title: x?.title, body: x?.description ?? x?.snippet, date: x?.posted_at_text ?? x?.date, postedAt: x?.posted_at }, now))
      .filter((x: GbpPostItem | null): x is GbpPostItem => !!x),
  )
}

async function call(params: Record<string, string>): Promise<{ json: any | null; error?: string }> {
  if (!serpapiConfigured()) return { json: null, error: 'Chưa cấu hình SERPAPI_API_KEY' }
  try {
    const qs = new URLSearchParams({ ...params, api_key: process.env.SERPAPI_API_KEY as string })
    const res = await fetch(`${ENDPOINT}?${qs.toString()}`, { signal: AbortSignal.timeout(TIMEOUT_MS) })
    const json: any = await res.json().catch(() => null)
    if (!res.ok || json?.error) {
      const why = typeof json?.error === 'string' ? json.error.slice(0, 120) : `HTTP ${res.status}`
      return { json: null, error: `SerpApi: ${why}` }
    }
    return { json }
  } catch (e: any) {
    return { json: null, error: `SerpApi lỗi: ${String(e?.message || e).slice(0, 120)}` }
  }
}

export async function fetchSerpPlace(placeId: string): Promise<{ info: ExtraPlace | null; error?: string }> {
  const r = await call({ engine: 'google_maps', type: 'place', place_id: placeId.replace(/^places\//, ''), hl: 'vi', gl: 'vn' })
  if (!r.json) return { info: null, error: r.error }
  const info = parseSerpPlace(r.json)
  return info ? { info } : { info: null, error: 'SerpApi không có kết quả cho địa điểm này' }
}

export async function fetchSerpReviews(placeId: string, count = 20): Promise<{ info: ExtraReviews | null; error?: string }> {
  const r = await call({
    engine: 'google_maps_reviews',
    place_id: placeId.replace(/^places\//, ''),
    sort_by: 'newestFirst',
    num: String(Math.min(Math.max(count, 1), 20)),
    hl: 'vi',
  })
  if (!r.json) return { info: null, error: r.error }
  const info = parseSerpReviews(r.json)
  return info ? { info } : { info: null, error: 'SerpApi không trả review' }
}

export async function fetchSerpPosts(dataId: string): Promise<{ posts: GbpPostItem[] | null; error?: string }> {
  const r = await call({ engine: 'google_maps_posts', data_id: dataId, hl: 'vi' })
  if (!r.json) return { posts: null, error: r.error }
  return { posts: parseSerpPosts(r.json) }
}
