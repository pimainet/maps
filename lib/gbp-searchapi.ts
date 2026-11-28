/**
 * Nguồn phụ: SearchApi.io (https://www.searchapi.io). Rẻ hơn SerpApi ~4–6 lần/lần gọi nên mặc định được thử TRƯỚC
 * cho thông tin hồ sơ. Bật bằng SEARCHAPI_API_KEY; thiếu khóa = bỏ qua. Mọi lỗi đều trả { error } chứ không ném.
 *
 *  - google_maps_place (place_id): place_result.description / type + types / posts[{title, snippet, date}] /
 *    open_hours / extensions[{title, items}] / reviews_histogram / questions_and_answers / data_id / phone / website.
 *  - google_maps_reviews (place_id, sort_by=newest, num ≤ 20): review mới nhất có iso_date.
 *    Tài liệu (đọc 28/11/2026) KHÔNG mô tả trường phản hồi của chủ -> chỉ coi là biết phản hồi khi thấy ít nhất 1 phản hồi.
 *
 * Lưu ý từ tài liệu SearchApi (10/2026): Google Maps hiện "limited view" cho người chưa đăng nhập -> nhiều kết quả
 * thiếu images, popular_times, menu, price và extensions chỉ còn mục Accessibility.
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

const ENDPOINT = 'https://www.searchapi.io/api/v1/search'
const TIMEOUT_MS = 30_000

export function searchApiConfigured(): boolean {
  return Boolean(process.env.SEARCHAPI_API_KEY)
}

export function parseSearchApiPlace(json: any, now = Date.now()): ExtraPlace | null {
  const p = json?.place_result
  if (!p || typeof p !== 'object') return null
  const types = [clean(p.type), ...(Array.isArray(p.types) ? p.types.map(clean) : [])].filter(
    (x, i, a): x is string => !!x && a.indexOf(x) === i,
  )
  let posts: GbpPostItem[] | null = null
  if (Array.isArray(p.posts)) {
    posts = capPosts(
      p.posts
        .map((x: any) => toPost({ title: x?.title, body: x?.snippet ?? x?.description, date: x?.date }, now))
        .filter((x: GbpPostItem | null): x is GbpPostItem => !!x),
    )
  }
  const openState = clean(p.open_state)
  return {
    provider: 'searchapi',
    place_id: normPlaceId(p.place_id),
    data_id: clean(p.data_id),
    title: clean(p.title),
    description: clean(p.description),
    types,
    posts,
    opening_hours: hoursToText(p.open_hours ?? p.hours),
    hours_today: openState,
    attributes: extensionsToGroups(p.extensions, p.service_options),
    action_links: actionLinksFrom(p),
    claim_signal: p.unclaimed_listing === true || p.is_claimed === false ? 'unclaimed' : null,
    business_status: statusFromOpenState(openState),
    rating_distribution: histogramToDist(p.reviews_histogram),
    questions_answers: qaFrom(p.questions_and_answers),
    phone: clean(p.phone),
    website_url: clean(p.website),
    rating: num(p.rating),
    review_count: num(p.reviews),
  }
}

export function parseSearchApiReviews(json: any, now = Date.now()): ExtraReviews | null {
  if (!Array.isArray(json?.reviews)) return null
  let sawReply = false
  const items = json.reviews
    .map((r: any) => {
      const resp = r?.response ?? r?.owner_response ?? r?.owner_answer
      const reply = typeof resp === 'string' ? resp : resp?.text ?? resp?.snippet
      if (clean(reply)) sawReply = true
      return toReview(r, { text: r?.text ?? r?.snippet, reply, replyDate: resp?.date, replyIso: resp?.iso_date }, now)
    })
    .filter(Boolean)
  return {
    provider: 'searchapi',
    place_id: normPlaceId(json?.place_result?.place_id ?? json?.search_parameters?.place_id),
    items: capReviews(items),
    reply_known: sawReply,
  }
}

async function call(params: Record<string, string>): Promise<{ json: any | null; error?: string }> {
  if (!searchApiConfigured()) return { json: null, error: 'Chưa cấu hình SEARCHAPI_API_KEY' }
  try {
    const qs = new URLSearchParams({ ...params, api_key: process.env.SEARCHAPI_API_KEY as string })
    const res = await fetch(`${ENDPOINT}?${qs.toString()}`, { signal: AbortSignal.timeout(TIMEOUT_MS) })
    const json: any = await res.json().catch(() => null)
    if (!res.ok || json?.error) {
      const why = typeof json?.error === 'string' ? json.error.slice(0, 120) : `HTTP ${res.status}`
      return { json: null, error: `SearchApi: ${why}` }
    }
    return { json }
  } catch (e: any) {
    return { json: null, error: `SearchApi lỗi: ${String(e?.message || e).slice(0, 120)}` }
  }
}

export async function fetchSearchApiPlace(placeId: string): Promise<{ info: ExtraPlace | null; error?: string }> {
  const r = await call({ engine: 'google_maps_place', place_id: placeId.replace(/^places\//, ''), hl: 'vi', gl: 'vn' })
  if (!r.json) return { info: null, error: r.error }
  const info = parseSearchApiPlace(r.json)
  return info ? { info } : { info: null, error: 'SearchApi không có kết quả cho địa điểm này' }
}

export async function fetchSearchApiReviews(placeId: string, count = 20): Promise<{ info: ExtraReviews | null; error?: string }> {
  const r = await call({
    engine: 'google_maps_reviews',
    place_id: placeId.replace(/^places\//, ''),
    sort_by: 'newest',
    num: String(Math.min(Math.max(count, 1), 20)),
    hl: 'vi',
    gl: 'vn',
  })
  if (!r.json) return { info: null, error: r.error }
  const info = parseSearchApiReviews(r.json)
  return info ? { info } : { info: null, error: 'SearchApi không trả review' }
}
