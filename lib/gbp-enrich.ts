/**
 * Bù dữ liệu hồ sơ bằng nguồn phụ, theo TỪNG TRƯỜNG, có ghi nguồn (coverage.field_sources) và chặn chi phí.
 *
 * Thứ tự ưu tiên (nguồn đứng trước thắng; nguồn sau chỉ điền trường còn trống, không ghi đè):
 *   mô tả            : Outscraper -> SearchApi place -> SerpApi place -> DataForSEO
 *   danh mục phụ     : Outscraper subtypes -> SearchApi types -> SerpApi type[] -> DataForSEO
 *   bài đăng + ngày  : Outscraper -> SearchApi place -> SerpApi place -> SerpApi google_maps_posts (posted_at ISO)
 *   giờ mở cửa       : Outscraper -> Places -> SearchApi/SerpApi place
 *   thuộc tính       : Outscraper about -> SearchApi/SerpApi extensions (+ service_options)
 *   review + phản hồi: Outscraper (nếu có trường owner_answer) -> SerpApi google_maps_reviews -> SearchApi google_maps_reviews
 *   chưa xác minh    : Outscraper verified -> unclaimed_listing (SerpApi/SearchApi)
 *   hỏi–đáp nổi bật  : SearchApi/SerpApi place (chỉ lấy kèm, không bao giờ gọi riêng vì Q&A)
 * Thứ tự 2 nguồn place đổi được bằng GBP_ENRICH_PLACE_ORDER (vd "serpapi,searchapi"). Mặc định SearchApi trước vì rẻ hơn.
 *
 * Chặn chi phí:
 *  - Chỉ gọi khi còn trường thiếu. Nguồn place thứ hai chỉ gọi khi còn thiếu trường "lõi" (mô tả, danh mục phụ, bài đăng
 *    hoặc ngày bài đăng) — không trả tiền thêm chỉ vì thiếu thuộc tính/giờ.
 *  - Mỗi engine gọi tối đa 1 lần cho 1 snapshot (ghi trong coverage.enrich.tried). Audit lại trên bản đã lưu không gọi lại.
 *  - Chế độ quick (demo công khai): chỉ 1 lần gọi place, không gọi review/bài đăng.
 *  - Thiếu khóa = bỏ qua nguồn đó. Mọi lỗi đều giữ nguyên snapshot.
 * Lần lấy mới (Outscraper) vẫn do cache 30 phút / hạn mức audit ở route quyết định; file này không tự lấy mới hồ sơ.
 */
import type {
  GbpFieldSource,
  GbpPostItem,
  RunGbpSnapshotInput,
  RunGbpSnapshotResult,
} from '@/lib/gbp-snapshot-types'
import type { ExtraPlace, ExtraProvider, ExtraReviews } from '@/lib/gbp-extra-parse'
import { clean, normPlaceId, postIsDated } from '@/lib/gbp-extra-parse'
import { fetchSerpPlace, fetchSerpPosts, fetchSerpReviews, serpapiConfigured } from '@/lib/gbp-serpapi'
import { fetchSearchApiPlace, fetchSearchApiReviews, searchApiConfigured } from '@/lib/gbp-searchapi'
import { enrichWithDataForSeo } from '@/lib/gbp-dataforseo'
import { computeReviewStats } from '@/lib/gbp-review-stats'

/** Dấu cũ (trước bản này): snapshot đã tra SerpApi/SearchApi. Vẫn tôn trọng để không trả phí lại. */
export const SERP_CHECKED_MARK = 'SerpApi/SearchApi: đã tra, không có thêm dữ liệu để bù.'

const LABEL: Record<ExtraProvider, string> = { serpapi: 'SerpApi', searchapi: 'SearchApi' }

/** Các trường được theo dõi nguồn. */
const TRACKED = [
  'description',
  'primary_category',
  'additional_categories',
  'recent_posts',
  'opening_hours',
  'attributes',
  'action_links',
  'reviews',
  'review_stats',
  'rating_distribution',
  'claim_signal',
  'business_status',
  'questions_answers',
  'phone',
  'website_url',
] as const

export type EnrichNeeds = {
  description: boolean
  categories: boolean
  posts: boolean
  post_dates: boolean
  hours: boolean
  attributes: boolean
  owner_replies: boolean
}

const hasItems = (v: unknown) => Array.isArray(v) && v.length > 0

export function enrichNeeds(s: Partial<RunGbpSnapshotResult>): EnrichNeeds {
  const posts = (s.recent_posts || []) as GbpPostItem[]
  const reviews = s.reviews || []
  const attrTotal = (s.attributes || []).reduce((n, g) => n + (g.items?.length || 0), 0)
  return {
    description: !clean(s.description),
    categories: !(s.coverage?.sections?.categories === 'ok' && Boolean(clean(s.additional_categories))),
    posts: posts.length === 0 && s.coverage?.sections?.updates !== 'empty',
    post_dates: posts.length > 0 && !posts.some(postIsDated),
    hours: !clean(s.opening_hours),
    attributes: attrTotal === 0,
    owner_replies: reviews.length < 5 || s.review_stats?.reply_rate == null,
  }
}

const coreNeed = (n: EnrichNeeds) => n.description || n.categories || n.posts || n.post_dates
const anyPlaceNeed = (n: EnrichNeeds) => coreNeed(n) || n.hours || n.attributes

export function missingList(n: EnrichNeeds): string[] {
  return (Object.keys(n) as Array<keyof EnrichNeeds>).filter((k) => n[k])
}

export function placeOrder(): ExtraProvider[] {
  const raw = (process.env.GBP_ENRICH_PLACE_ORDER || '').toLowerCase()
  const list = raw
    .split(',')
    .map((x) => x.trim())
    .filter((x): x is ExtraProvider => x === 'serpapi' || x === 'searchapi')
  const uniq = [...new Set(list)]
  for (const p of ['searchapi', 'serpapi'] as const) if (!uniq.includes(p)) uniq.push(p)
  return uniq
}

function baseSource(s: any): GbpFieldSource {
  const v = String(s?.source_used || s?.source || '')
  return v === 'places' ? 'places' : 'outscraper'
}

function cloneCoverage(s: RunGbpSnapshotResult) {
  const c = s.coverage
  if (!c) return undefined
  return {
    ...c,
    sections: { ...c.sections },
    warnings: [...c.warnings],
    field_sources: { ...(c.field_sources || {}) },
  }
}

/** Ghi nguồn gốc cho các trường đã có sẵn từ nguồn chính (không đổi dữ liệu). */
export function withFieldSources(snap: RunGbpSnapshotResult): RunGbpSnapshotResult {
  if (!snap.coverage) return snap
  const cov = cloneCoverage(snap)!
  const base = baseSource(snap)
  let changed = false
  for (const k of TRACKED) {
    const v = (snap as any)[k]
    const present = Array.isArray(v) ? v.length > 0 : v != null && v !== '' && v !== 'unknown'
    if (present && !cov.field_sources[k]) {
      cov.field_sources[k] = base
      changed = true
    }
  }
  return changed ? { ...snap, coverage: cov } : snap
}

/**
 * Gộp 1 kết quả place của SerpApi/SearchApi vào snapshot. Chỉ nhận ĐÚNG quán (place_id phải khớp), chỉ điền trường trống
 * (riêng bài đăng: thay bài không có ngày bằng bài có ngày).
 */
export function applyExtraPlace(snap: RunGbpSnapshotResult, info: ExtraPlace, expectedPlaceId?: string | null): RunGbpSnapshotResult {
  const expected = normPlaceId(expectedPlaceId || snap.place_id)
  if (!expected || !info.place_id || info.place_id !== expected) return snap
  const out: RunGbpSnapshotResult = { ...snap }
  const cov = cloneCoverage(out)
  const src = info.provider
  const used: string[] = []
  const mark = (field: string, label: string) => {
    if (cov) cov.field_sources[field] = src
    used.push(label)
  }

  if (!clean(out.description) && info.description) {
    out.description = info.description
    if (cov) cov.sections.about = 'ok'
    mark('description', 'mô tả')
  }

  if (!clean(out.primary_category) && info.types[0]) {
    out.primary_category = info.types[0]
    mark('primary_category', 'danh mục chính')
  }
  const primaryKey = (out.primary_category || info.types[0] || '').toLowerCase()
  const have = new Set((out.additional_categories || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean))
  const extra = info.types.filter((c) => c.toLowerCase() !== primaryKey && !have.has(c.toLowerCase()))
  if (extra.length) {
    out.additional_categories = [out.additional_categories, ...extra].filter(Boolean).join(', ')
    if (cov) cov.sections.categories = 'ok'
    mark('additional_categories', 'danh mục phụ')
  }

  const curPosts = (out.recent_posts || []) as GbpPostItem[]
  const newPosts = info.posts || []
  if (newPosts.length && (curPosts.length === 0 || (!curPosts.some(postIsDated) && newPosts.some(postIsDated)))) {
    out.recent_posts = newPosts
    out.posts_signal = `Thấy ${newPosts.length} bài chủ doanh nghiệp đăng gần đây (${LABEL[src]})`
    if (cov) cov.sections.updates = 'ok'
    mark('recent_posts', curPosts.length ? 'ngày bài đăng' : 'bài đăng')
  }

  if (!clean(out.opening_hours) && info.opening_hours) {
    out.opening_hours = info.opening_hours
    if (cov) cov.sections.hours = 'ok'
    mark('opening_hours', 'giờ mở cửa')
  }
  if (!clean(out.hours_today) && info.hours_today) out.hours_today = info.hours_today

  const attrTotal = (out.attributes || []).reduce((n, g) => n + g.items.length, 0)
  if (attrTotal === 0 && info.attributes && info.attributes.some((g) => g.items.length)) {
    out.attributes = info.attributes
    if (cov) cov.sections.about = 'ok'
    mark('attributes', 'thuộc tính')
  }

  const kinds = new Set((out.action_links || []).map((a) => a.kind))
  const addLinks = info.action_links.filter((a) => !kinds.has(a.kind))
  if (addLinks.length) {
    out.action_links = [...(out.action_links || []), ...addLinks]
    mark('action_links', 'nút hành động')
  }

  if ((!out.claim_signal || out.claim_signal === 'unknown') && info.claim_signal === 'unclaimed') {
    out.claim_signal = 'unclaimed'
    mark('claim_signal', 'dấu hiệu chưa xác minh')
  }
  if ((!out.business_status || out.business_status === 'unknown') && info.business_status) {
    out.business_status = info.business_status
    mark('business_status', 'trạng thái hoạt động')
  }
  if (!out.rating_distribution && info.rating_distribution) {
    out.rating_distribution = info.rating_distribution
    mark('rating_distribution', 'phân bố sao')
  }
  if (!hasItems(out.questions_answers) && info.questions_answers && info.questions_answers.length) {
    out.questions_answers = info.questions_answers
    mark('questions_answers', 'hỏi–đáp')
  }
  if (!clean(out.phone) && info.phone) {
    out.phone = info.phone
    mark('phone', 'số điện thoại')
  }
  if (!clean(out.website_url) && info.website_url) {
    out.website_url = info.website_url
    mark('website_url', 'website')
  }

  if (cov && used.length) cov.warnings.push(`Đã bù ${used.join(', ')} từ ${LABEL[src]}.`)
  if (cov) out.coverage = cov
  return out
}

/** Bài đăng từ SerpApi google_maps_posts (có posted_at ISO). [] = engine trả rỗng -> coi là "không có bài" (updates = empty). */
export function applyExtraPosts(snap: RunGbpSnapshotResult, posts: GbpPostItem[] | null): RunGbpSnapshotResult {
  if (posts == null) return snap
  const cur = (snap.recent_posts || []) as GbpPostItem[]
  const out: RunGbpSnapshotResult = { ...snap }
  const cov = cloneCoverage(out)
  if (posts.length === 0) {
    if (cur.length) return snap
    if (cov) {
      cov.sections.updates = 'empty'
      cov.warnings.push('SerpApi (Google Maps Posts) không thấy bài đăng nào của chủ doanh nghiệp.')
      cov.field_sources.recent_posts = 'serpapi'
      out.coverage = cov
    }
    out.recent_posts = []
    out.posts_signal = 'Không thấy bài đăng nào (SerpApi Google Maps Posts)'
    return out
  }
  if (cur.length && cur.some(postIsDated) && !posts.some((p) => p.posted_at)) return snap
  out.recent_posts = posts
  out.posts_signal = `Thấy ${posts.length} bài chủ doanh nghiệp đăng (SerpApi Google Maps Posts, có ngày đăng)`
  if (cov) {
    cov.sections.updates = 'ok'
    cov.field_sources.recent_posts = 'serpapi'
    cov.warnings.push('Đã lấy bài đăng kèm ngày đăng từ SerpApi (Google Maps Posts).')
    out.coverage = cov
  }
  return out
}

/**
 * Review mới nhất kèm phản hồi của chủ. Chỉ thay khi bản hiện có không dùng được cho tỉ lệ phản hồi
 * (ít hơn 5 review, hoặc nguồn chính không trả trường phản hồi) VÀ bản mới tốt hơn.
 */
export function applyExtraReviews(snap: RunGbpSnapshotResult, info: ExtraReviews, expectedPlaceId?: string | null): RunGbpSnapshotResult {
  const expected = normPlaceId(expectedPlaceId || snap.place_id)
  if (info.place_id && expected && info.place_id !== expected) return snap
  const cur = snap.reviews || []
  const curReplyKnown = snap.review_stats?.reply_rate != null && cur.length >= 5
  if (curReplyKnown) return snap
  const better = info.reply_known ? info.items.length >= Math.min(5, Math.max(cur.length, 1)) : info.items.length > cur.length
  if (!better || info.items.length === 0) return snap
  const stats = computeReviewStats(info.items)
  if (stats && !info.reply_known) {
    stats.replied = 0
    stats.reply_rate = null
  }
  const out: RunGbpSnapshotResult = { ...snap, reviews: info.items, review_stats: stats }
  const cov = cloneCoverage(out)
  if (cov) {
    cov.sections.reviews = 'ok'
    cov.reviews_loaded = info.items.length
    cov.field_sources.reviews = info.provider
    cov.field_sources.review_stats = info.provider
    cov.warnings.push(
      info.reply_known
        ? `Đã lấy ${info.items.length} review mới nhất kèm phản hồi của chủ từ ${LABEL[info.provider]}.`
        : `Đã lấy ${info.items.length} review mới nhất từ ${LABEL[info.provider]} (nguồn này không cho biết phản hồi của chủ).`,
    )
    out.coverage = cov
  }
  return out
}

const configured = (p: ExtraProvider) => (p === 'serpapi' ? serpapiConfigured() : searchApiConfigured())
const fetchPlace = (p: ExtraProvider, id: string) => (p === 'serpapi' ? fetchSerpPlace(id) : fetchSearchApiPlace(id))
const fetchReviews = (p: ExtraProvider, id: string) => (p === 'serpapi' ? fetchSerpReviews(id) : fetchSearchApiReviews(id))

/**
 * Điểm vào: bù snapshot bằng SearchApi/SerpApi rồi DataForSEO. Không ném lỗi.
 * Trả về đúng object cũ nếu không gọi nguồn nào và không đổi gì (nơi gọi dùng để biết có cần lưu lại hay không).
 */
export async function enrichSnapshot(snap: RunGbpSnapshotResult, input: RunGbpSnapshotInput): Promise<RunGbpSnapshotResult> {
  let cur = snap
  const prevEnrich = snap.coverage?.enrich
  const tried = new Set<string>(prevEnrich?.tried || [])
  if (snap.coverage?.warnings?.includes(SERP_CHECKED_MARK)) {
    tried.add('serpapi:place')
    tried.add('searchapi:place')
  }
  const triedBefore = tried.size
  const depth = input.depth || snap.coverage?.depth || 'deep'
  const quick = depth === 'quick'
  const placeId = normPlaceId(input.placeId || snap.place_id)
  let dataId: string | null = prevEnrich?.data_id || null

  try {
    if (placeId) {
      // 1) Thông tin hồ sơ (place): nguồn thứ nhất khi còn thiếu bất kỳ trường nào; nguồn thứ hai chỉ khi còn thiếu trường lõi.
      let placeCalls = 0
      for (const prov of placeOrder()) {
        const n = enrichNeeds(cur)
        const need = placeCalls === 0 ? anyPlaceNeed(n) : coreNeed(n)
        if (!need || (quick && placeCalls > 0)) break
        const key = `${prov}:place`
        if (tried.has(key) || !configured(prov)) continue
        tried.add(key)
        placeCalls++
        const r = await fetchPlace(prov, placeId)
        if (r.info) {
          dataId = dataId || r.info.data_id
          cur = applyExtraPlace(cur, r.info, placeId)
        } else if (r.error) console.warn(`${prov} place enrich:`, r.error)
      }

      // 2) Bài đăng có ngày chính xác (chỉ SerpApi có engine riêng; cần data_id).
      const n2 = enrichNeeds(cur)
      if (!quick && (n2.posts || n2.post_dates) && dataId && serpapiConfigured() && !tried.has('serpapi:posts')) {
        tried.add('serpapi:posts')
        const r = await fetchSerpPosts(dataId)
        if (r.posts) cur = applyExtraPosts(cur, r.posts)
        else if (r.error) console.warn('serpapi posts enrich:', r.error)
      }

      // 3) Review + phản hồi của chủ: SerpApi trước (có tài liệu trường phản hồi), SearchApi dự phòng.
      if (!quick) {
        for (const prov of ['serpapi', 'searchapi'] as const) {
          if (!enrichNeeds(cur).owner_replies) break
          const key = `${prov}:reviews`
          if (tried.has(key) || !configured(prov)) continue
          tried.add(key)
          const r = await fetchReviews(prov, placeId)
          if (r.info) cur = applyExtraReviews(cur, r.info, placeId)
          else if (r.error) console.warn(`${prov} reviews enrich:`, r.error)
        }
      }
    }
  } catch (e: any) {
    console.warn('extra enrich failed (non-fatal):', e?.message)
  }

  // 4) DataForSEO: chỉ còn thiếu mô tả/danh mục phụ mới gọi (logic + dấu "đã tra" riêng trong lib/gbp-dataforseo.ts).
  try {
    cur = await enrichWithDataForSeo(cur, input)
  } catch (e: any) {
    console.warn('dataforseo enrich failed (non-fatal):', e?.message)
  }

  if (cur === snap && tried.size === triedBefore) return snap
  cur = withFieldSources(cur)
  if (cur.coverage && tried.size !== triedBefore) {
    cur = {
      ...cur,
      coverage: {
        ...cur.coverage,
        enrich: { at: new Date().toISOString(), tried: [...tried], still_missing: missingList(enrichNeeds(cur)), data_id: dataId },
      },
    }
  }
  return cur
}
