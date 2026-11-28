/**
 * Lấy review mới nhất của 1 doanh nghiệp từ các nguồn, chuẩn hoá về IncomingReview (có tên người viết + id nguồn
 * để khớp review giữa các nguồn — lib/gbp-*.ts bỏ 2 trường này nên không dùng lại được hàm map cũ).
 *
 * Thứ tự (rẻ và đủ nhất trước):
 *   1. Outscraper /maps/reviews-v3, sort newest + cutoff: tính tiền THEO REVIEW (~$3/1.000), có ngày chính xác và
 *      owner_answer (kiểm tra DB thật 28/11/2026: 9/18 review có phản hồi được trả về). Nhận cả place_id lẫn link Maps.
 *   2. SearchApi google_maps_reviews (~$0,004/lần) — cần place_id.
 *   3. SerpApi google_maps_reviews (~$0,015/lần gói Developer) — cần place_id; có tài liệu trường `response`.
 * Nguồn sau chỉ chạy khi nguồn trước lỗi / chưa cấu hình. Mỗi nguồn trả tối đa 20–30 review mới nhất.
 *
 * Business Profile API (qua Make) là nguồn CHÍNH XÁC NHẤT và miễn phí cho hồ sơ mình quản lý — xem parseGbpReviews().
 */
import { fetchOutscraperReviews, outscraperConfigured, parseOutscraperDate } from '@/lib/gbp-outscraper'
import { clean, num, parseAnyDate, relativeVi, ageDays } from '@/lib/gbp-extra-parse'
import type { IncomingReview } from './types'

function iso(ms: number | null | undefined): string | null {
  return ms != null && Number.isFinite(ms) ? new Date(ms).toISOString() : null
}

function first(obj: any, keys: string[]): any {
  for (const k of keys) if (obj && obj[k] !== undefined && obj[k] !== null && obj[k] !== '') return obj[k]
  return undefined
}

function clip(s: string | null | undefined, n: number): string {
  return (s || '').replace(/\s+/g, ' ').trim().slice(0, n)
}

export type SourceResult = {
  source: 'outscraper' | 'serpapi' | 'searchapi'
  items: IncomingReview[]
  /** true = nguồn cho biết chắc review nào chưa có phản hồi (owner_reply null nghĩa là "chưa phản hồi"). */
  replyKnown: boolean
  rating?: number | null
  reviewCount?: number | null
}

// ---------------------------------------------------------------------------
// Hàm thuần: JSON từng nguồn -> IncomingReview[]
// ---------------------------------------------------------------------------

export function parseOutscraperReviewList(rawReviews: unknown, now = Date.now()): { items: IncomingReview[]; replyKnown: boolean } {
  if (!Array.isArray(rawReviews)) return { items: [], replyKnown: false }
  let replyKnown = false
  const items: IncomingReview[] = []
  for (const r of rawReviews as any[]) {
    const rating = num(first(r, ['review_rating', 'rating']))
    if (rating == null || rating < 1 || rating > 5) continue
    const hasReplyField = r && typeof r === 'object' && 'owner_answer' in r
    if (hasReplyField) replyKnown = true
    const ms = parseOutscraperDate(first(r, ['review_datetime_utc', 'datetime_utc']), first(r, ['review_timestamp', 'timestamp']))
    const replyMs = parseOutscraperDate(
      first(r, ['owner_answer_timestamp_datetime_utc', 'owner_answer_datetime_utc']),
      first(r, ['owner_answer_timestamp']),
    )
    const reply = clean(first(r, ['owner_answer', 'owner_response', 'response_from_owner_text']))
    items.push({
      source: 'outscraper',
      source_review_id: clean(first(r, ['review_id'])),
      author_name: clean(first(r, ['author_title', 'autor_name', 'author_name'])),
      rating: Math.round(rating),
      text: clip(first(r, ['review_text', 'text']), 2000),
      reviewed_at: iso(ms),
      reviewed_at_exact: ms != null,
      relative_time: relativeVi(ageDays(ms, now)),
      owner_reply: reply ? clip(reply, 4000) : hasReplyField ? null : undefined,
      owner_reply_at: reply ? iso(replyMs) : null,
    })
  }
  return { items, replyKnown }
}

function fromSerpLike(r: any, provider: 'serpapi' | 'searchapi', text: unknown, resp: any, now: number, replyKnown: boolean): IncomingReview | null {
  const rating = num(r?.rating)
  if (rating == null || rating < 1 || rating > 5) return null
  const d = parseAnyDate(r?.iso_date, now) ?? parseAnyDate(r?.date, now)
  const replyText = clean(typeof resp === 'string' ? resp : resp?.snippet ?? resp?.text ?? resp?.extracted_snippet?.original)
  const rd = resp && typeof resp === 'object' ? parseAnyDate(resp.iso_date ?? resp.date, now) : null
  return {
    source: provider,
    source_review_id: clean(r?.review_id),
    author_name: clean(r?.user?.name ?? r?.author?.name),
    rating: Math.round(rating),
    text: clip(clean(text) || '', 2000),
    reviewed_at: d ? iso(d.ms) : null,
    reviewed_at_exact: Boolean(d?.exact),
    relative_time: d ? relativeVi(ageDays(d.ms, now)) : clean(r?.date),
    owner_reply: replyText ? clip(replyText, 4000) : replyKnown ? null : undefined,
    owner_reply_at: replyText && rd ? iso(rd.ms) : null,
  }
}

/** SerpApi google_maps_reviews: có tài liệu trường `response` -> biết chắc "chưa phản hồi". */
export function parseSerpReviewList(json: any, now = Date.now()): { items: IncomingReview[]; replyKnown: boolean } | null {
  if (!Array.isArray(json?.reviews)) return null
  const items = json.reviews
    .map((r: any) => fromSerpLike(r, 'serpapi', r?.snippet ?? r?.extracted_snippet?.original, r?.response, now, true))
    .filter(Boolean) as IncomingReview[]
  return { items, replyKnown: true }
}

/** SearchApi google_maps_reviews: tên trường phản hồi chưa có tài liệu chắc -> chỉ "biết chắc" khi thấy ít nhất 1 phản hồi. */
export function parseSearchApiReviewList(json: any, now = Date.now()): { items: IncomingReview[]; replyKnown: boolean } | null {
  if (!Array.isArray(json?.reviews)) return null
  const respOf = (r: any) => r?.response ?? r?.owner_response ?? r?.owner_answer
  const sawReply = json.reviews.some((r: any) => {
    const x = respOf(r)
    return Boolean(clean(typeof x === 'string' ? x : x?.text ?? x?.snippet))
  })
  const items = json.reviews
    .map((r: any) => fromSerpLike(r, 'searchapi', r?.text ?? r?.snippet, respOf(r), now, sawReply))
    .filter(Boolean) as IncomingReview[]
  return { items, replyKnown: sawReply }
}

const STARS: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 }

/** Tài nguyên location dạng accounts/{a}/locations/{l} (bắt buộc cho API v4 reviews). */
export function isV4LocationResource(s: unknown): s is string {
  return typeof s === 'string' && /^accounts\/[^/\s]+\/locations\/[^/\s]+$/.test(s)
}

/**
 * Business Profile API v4 accounts.locations.reviews.list -> IncomingReview[] (source 'gbp').
 * Review có reviewReply = đã phản hồi (kèm trạng thái kiểm duyệt PENDING/REJECTED/APPROVED nếu có).
 * Chỉ nhận review thuộc đúng location (name bắt đầu bằng `${location}/reviews/`).
 */
export function parseGbpReviews(
  json: any,
  locationResource: string,
): { items: Array<IncomingReview & { reply_state: string | null }>; averageRating: number | null; total: number | null } {
  const list = Array.isArray(json?.reviews) ? json.reviews : []
  const prefix = `${locationResource}/reviews/`
  const items: Array<IncomingReview & { reply_state: string | null }> = []
  for (const r of list) {
    const name = clean(r?.name)
    if (!name || !name.startsWith(prefix)) continue
    const rating = STARS[String(r?.starRating || '').toUpperCase()]
    if (!rating) continue
    const created = clean(r?.createTime)
    const ms = created ? Date.parse(created) : NaN
    const reply = r?.reviewReply && typeof r.reviewReply === 'object' ? r.reviewReply : null
    const anon = r?.reviewer?.isAnonymous === true
    items.push({
      source: 'gbp',
      source_review_id: clean(r?.reviewId),
      gbp_review_name: name,
      author_name: anon ? null : clean(r?.reviewer?.displayName),
      rating,
      text: clip(clean(r?.comment) || '', 4000),
      reviewed_at: Number.isFinite(ms) ? new Date(ms).toISOString() : null,
      reviewed_at_exact: Number.isFinite(ms),
      owner_reply: clean(reply?.comment) ? clip(reply.comment, 4096) : null, // GBP luôn biết chắc
      owner_reply_at: clean(reply?.updateTime),
      reply_state: clean(reply?.reviewReplyState),
    })
  }
  return { items, averageRating: num(json?.averageRating), total: num(json?.totalReviewCount) }
}

// ---------------------------------------------------------------------------
// Gọi mạng
// ---------------------------------------------------------------------------

async function getJson(url: string, timeoutMs = 30_000): Promise<{ json: any | null; error?: string }> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
    const json: any = await res.json().catch(() => null)
    if (!res.ok || json?.error) {
      const why = typeof json?.error === 'string' ? json.error.slice(0, 120) : `HTTP ${res.status}`
      return { json: null, error: why }
    }
    return { json }
  } catch (e: any) {
    return { json: null, error: String(e?.message || e).slice(0, 120) }
  }
}

export type FetchReviewsInput = {
  placeId?: string | null
  mapsUrl?: string | null
  name: string
  area?: string | null
  /** Unix giây: chỉ lấy review từ mốc này (Outscraper). Nguồn khác lấy 20 mới nhất rồi lọc phía mình. */
  cutoffSec: number
  limit: number
}

export async function fetchLatestReviews(
  input: FetchReviewsInput,
  now = Date.now(),
): Promise<{ result: SourceResult | null; errors: string[] }> {
  const errors: string[] = []
  const sinceMs = input.cutoffSec * 1000
  const keepFresh = (items: IncomingReview[]) =>
    items.filter((r) => !r.reviewed_at || !r.reviewed_at_exact || Date.parse(r.reviewed_at) >= sinceMs - 86_400_000)

  if (outscraperConfigured()) {
    try {
      const place = await fetchOutscraperReviews({
        placeId: input.placeId,
        mapsUrl: input.mapsUrl || undefined,
        businessName: input.name,
        area: input.area || undefined,
        reviewsLimit: input.limit,
        cutoff: input.cutoffSec,
        budgetMs: 100_000,
      })
      if (place) {
        const { items, replyKnown } = parseOutscraperReviewList(place.reviews_data, now)
        return {
          result: {
            source: 'outscraper',
            items: keepFresh(items),
            replyKnown,
            rating: num(place.rating),
            reviewCount: num(place.reviews),
          },
          errors,
        }
      }
      errors.push('Outscraper không trả dữ liệu')
    } catch (e: any) {
      errors.push(`Outscraper: ${String(e?.message || e).slice(0, 160)}`)
    }
  }

  const pid = input.placeId ? String(input.placeId).replace(/^places\//, '') : null
  if (!pid) {
    if (!outscraperConfigured()) errors.push('Chưa cấu hình OUTSCRAPER_API_KEY và doanh nghiệp chưa có place_id cho SearchApi/SerpApi')
    return { result: null, errors }
  }

  if (process.env.SEARCHAPI_API_KEY) {
    const qs = new URLSearchParams({ engine: 'google_maps_reviews', place_id: pid, sort_by: 'newest', hl: 'vi', gl: 'vn', api_key: process.env.SEARCHAPI_API_KEY })
    const r = await getJson(`https://www.searchapi.io/api/v1/search?${qs}`)
    const parsed = r.json ? parseSearchApiReviewList(r.json, now) : null
    if (parsed) return { result: { source: 'searchapi', items: keepFresh(parsed.items).slice(0, input.limit), replyKnown: parsed.replyKnown }, errors }
    errors.push(`SearchApi: ${r.error || 'không trả review'}`)
  }

  if (process.env.SERPAPI_API_KEY) {
    const qs = new URLSearchParams({ engine: 'google_maps_reviews', place_id: pid, sort_by: 'newestFirst', hl: 'vi', api_key: process.env.SERPAPI_API_KEY })
    const r = await getJson(`https://serpapi.com/search.json?${qs}`)
    const parsed = r.json ? parseSerpReviewList(r.json, now) : null
    if (parsed) return { result: { source: 'serpapi', items: keepFresh(parsed.items).slice(0, input.limit), replyKnown: parsed.replyKnown }, errors }
    errors.push(`SerpApi: ${r.error || 'không trả review'}`)
  }

  return { result: null, errors }
}
