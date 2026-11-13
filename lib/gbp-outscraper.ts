/**
 * Nguồn dữ liệu GBP qua Outscraper API.
 *
 * Hai lời gọi chạy song song:
 *   - GET /maps/search-v3   -> thông tin hồ sơ (tên, giờ, about, subtypes, verified, posts, ảnh, phân bố sao...)
 *   - GET /maps/reviews-v3  -> review mới nhất (có ngày thật + phản hồi của chủ nếu Outscraper trả về)
 *
 * File này tách 2 phần:
 *   - mapOutscraperToPayload(): hàm THUẦN, map JSON Outscraper -> GbpSnapshotPayload. Test được bằng fixture
 *     (scripts/test-outscraper-mapping.ts). Đọc TÊN TRƯỜNG PHÒNG THỦ: tài liệu công khai của Outscraper không liệt kê
 *     hết trường của từng review, nên mỗi trường có vài tên dự phòng và thiếu thì ghi vào coverage, không ném lỗi.
 *   - fetchOutscraperSnapshot(): gọi mạng, xử lý chế độ async (Pending -> poll).
 * Test: scripts/test-outscraper-mapping.ts (hàm thuần) và scripts/test-outscraper-fetch.ts (lớp mạng, fetch giả).
 *
 * Env:
 *   OUTSCRAPER_API_KEY   bắt buộc
 *   OUTSCRAPER_LANGUAGE  mặc định vi
 *   OUTSCRAPER_REGION    mặc định VN
 */

import type {
  GbpSnapshotPayload,
  GbpReviewItem,
  GbpAttributeGroup,
  GbpActionLink,
  GbpCoverage,
  GbpCoverageStatus,
  GbpBusinessStatus,
  GbpPostItem,
} from '@/lib/gbp-snapshot-types'
import { GBP_SNAPSHOT_MAX_POSTS, GBP_SNAPSHOT_MAX_REVIEWS } from '@/lib/gbp-snapshot-types'
import { createHash } from 'node:crypto'
import { computeReviewStats } from '@/lib/gbp-review-stats'

const BASE = 'https://api.app.outscraper.com'

export type OutscraperQueryInput = {
  mapsUrl?: string
  placeId?: string | null
  businessName?: string
  area?: string
}

// ---------------------------------------------------------------------------
// Tiện ích thuần
// ---------------------------------------------------------------------------

function asString(v: unknown): string | null {
  if (v == null) return null
  const s = String(v).replace(/\s+/g, ' ').trim()
  return s ? s : null
}

function asNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string') {
    const n = Number(v.replace(',', '.'))
    return Number.isFinite(n) ? n : null
  }
  return null
}

function first<T = unknown>(obj: any, keys: string[]): T | undefined {
  for (const k of keys) {
    if (obj && obj[k] !== undefined && obj[k] !== null && obj[k] !== '') return obj[k] as T
  }
  return undefined
}

/**
 * Outscraper trả ngày dạng "MM/DD/YYYY HH:mm:ss" (UTC) hoặc ISO; ngoài ra có unix timestamp (giây).
 * Trả về epoch ms, hoặc null nếu không đọc được.
 */
export function parseOutscraperDate(datetime: unknown, unixSeconds?: unknown): number | null {
  const ts = asNumber(unixSeconds)
  if (ts && ts > 1_000_000_000) return ts < 1e12 ? ts * 1000 : ts
  const s = asString(datetime)
  if (!s) return null
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(s)
  if (us) {
    const [, mo, d, y, h = '0', mi = '0', se = '0'] = us
    return Date.UTC(+y, +mo - 1, +d, +h, +mi, +se)
  }
  const t = Date.parse(s)
  return Number.isFinite(t) ? t : null
}

function ageDays(ms: number | null, now: number): number | null {
  if (ms == null) return null
  return Math.max(0, Math.floor((now - ms) / 86_400_000))
}

function relativeVi(days: number | null): string | null {
  if (days == null) return null
  if (days < 1) return 'hôm nay'
  if (days < 7) return `${days} ngày trước`
  if (days < 30) return `${Math.round(days / 7)} tuần trước`
  if (days < 365) return `${Math.round(days / 30)} tháng trước`
  return `${Math.round(days / 365)} năm trước`
}

const DAY_VI: Record<string, string> = {
  monday: 'Thứ Hai',
  tuesday: 'Thứ Ba',
  wednesday: 'Thứ Tư',
  thursday: 'Thứ Năm',
  friday: 'Thứ Sáu',
  saturday: 'Thứ Bảy',
  sunday: 'Chủ Nhật',
}

function hoursToString(wh: unknown): string | null {
  if (!wh) return null
  if (typeof wh === 'string') return asString(wh)
  if (Array.isArray(wh)) {
    const parts = wh.map((x) => asString(x)).filter(Boolean) as string[]
    return parts.length ? parts.join(' | ') : null
  }
  if (typeof wh === 'object') {
    const parts = Object.entries(wh as Record<string, unknown>)
      .map(([day, val]) => {
        const v = Array.isArray(val) ? val.join(', ') : asString(val)
        if (!v) return null
        return `${DAY_VI[day.toLowerCase()] || day}: ${v}`
      })
      .filter(Boolean) as string[]
    return parts.length ? parts.join(' | ') : null
  }
  return null
}

/** `about` của Outscraper: { "Nhóm": { "Mục": true/false, ... }, ... }. Chỉ lấy mục có giá trị true. */
function aboutToGroups(about: unknown): GbpAttributeGroup[] {
  const groups: GbpAttributeGroup[] = []
  if (!about) return groups
  if (Array.isArray(about)) {
    for (const g of about) {
      const name = asString(first(g, ['name', 'group', 'title', 'id']))
      const rawItems = first<any>(g, ['options', 'items', 'values'])
      if (!name || !rawItems) continue
      const items = Array.isArray(rawItems)
        ? rawItems
            .filter((i: any) => typeof i === 'string' || i?.enabled !== false)
            .map((i: any) => asString(typeof i === 'string' ? i : i?.name))
            .filter(Boolean)
        : Object.entries(rawItems)
            .filter(([, v]) => v === true || v === 'true' || v === 1)
            .map(([k]) => asString(k))
            .filter(Boolean)
      if (items.length) groups.push({ group: name, items: items as string[] })
    }
    return groups
  }
  if (typeof about === 'object') {
    for (const [group, val] of Object.entries(about as Record<string, unknown>)) {
      if (!val || typeof val !== 'object') continue
      const items = Object.entries(val as Record<string, unknown>)
        .filter(([, v]) => v === true || v === 'true' || v === 1)
        .map(([k]) => asString(k))
        .filter(Boolean) as string[]
      if (items.length) groups.push({ group, items })
    }
  }
  return groups
}

function toLinkList(v: unknown): string[] {
  if (!v) return []
  if (Array.isArray(v)) return v.map((x) => asString(typeof x === 'string' ? x : x?.url ?? x?.link)).filter(Boolean) as string[]
  const s = asString(v)
  return s ? s.split(/[,\s]+/).filter((x) => /^https?:\/\//.test(x)) : []
}

function actionLinks(place: any): GbpActionLink[] {
  const out: GbpActionLink[] = []
  const add = (kind: string, label: string, v: unknown) => {
    for (const url of toLinkList(v)) out.push({ kind, label, url })
  }
  add('website', 'Trang web', place.website ?? place.site)
  add('booking', 'Đặt lịch hẹn', place.booking_appointment_link)
  add('reservation', 'Đặt chỗ', place.reservation_links)
  add('menu', 'Thực đơn', place.menu_link)
  add('order', 'Đặt món', place.order_links)
  return out
}

function businessStatus(s: unknown): GbpBusinessStatus | null {
  const v = String(s ?? '').toUpperCase()
  if (v === 'OPERATIONAL') return 'operational'
  if (v === 'CLOSED_TEMPORARILY') return 'temporarily_closed'
  if (v === 'CLOSED_PERMANENTLY') return 'permanently_closed'
  return null
}

function parsePosts(raw: unknown, now: number): GbpPostItem[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((p: any): GbpPostItem | null => {
      if (typeof p === 'string') return { text: p.slice(0, 500) }
      const text = asString(first(p, ['text', 'description', 'snippet', 'title', 'content']))
      if (!text) return null
      const ms = parseOutscraperDate(first(p, ['datetime_utc', 'date', 'published_at']), first(p, ['timestamp']))
      return { text: text.slice(0, 500), approx_date: relativeVi(ageDays(ms, now)) }
    })
    .filter((p): p is GbpPostItem => !!p)
    .slice(0, GBP_SNAPSHOT_MAX_POSTS)
}

/** Danh mục chính chuẩn hoá để so với subtypes. */
function normCat(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .toLowerCase()
    .trim()
}

export type OutscraperReviewRaw = Record<string, any>

export function mapReviews(rawReviews: unknown, now = Date.now()): { items: GbpReviewItem[]; replyFieldPresent: boolean } {
  if (!Array.isArray(rawReviews)) return { items: [], replyFieldPresent: false }
  let replyFieldPresent = false
  const items: GbpReviewItem[] = []
  for (const r of rawReviews as OutscraperReviewRaw[]) {
    const rating = asNumber(first(r, ['review_rating', 'rating']))
    if (rating == null) continue
    if ('owner_answer' in r) replyFieldPresent = true
    const ms = parseOutscraperDate(
      first(r, ['review_datetime_utc', 'datetime_utc']),
      first(r, ['review_timestamp', 'timestamp']),
    )
    const days = ageDays(ms, now)
    const replyMs = parseOutscraperDate(
      first(r, ['owner_answer_timestamp_datetime_utc', 'owner_answer_datetime_utc']),
      first(r, ['owner_answer_timestamp']),
    )
    const reply = asString(first(r, ['owner_answer', 'owner_response', 'response_from_owner_text']))
    const text = (asString(first(r, ['review_text', 'text'])) || '').slice(0, 800)
    const author = asString(first(r, ['author_title', 'autor_name', 'author_name'])) || ''
    const rid = asString(first(r, ['review_id', 'google_id'])) || ''
    const key = createHash('sha1')
      .update([rid, author, ms ?? '', rating, text.slice(0, 120)].join('|'))
      .digest('hex')
      .slice(0, 24)
    items.push({
      rating,
      posted_at: ms != null ? new Date(ms).toISOString() : null,
      key,
      text,
      relative_time: relativeVi(days),
      age_days_est: days,
      reply: reply ? reply.slice(0, 800) : null,
      reply_relative_time: reply ? relativeVi(ageDays(replyMs, now)) : null,
    })
  }
  return { items, replyFieldPresent }
}

// ---------------------------------------------------------------------------
// Mapping chính (hàm thuần)
// ---------------------------------------------------------------------------

export type OutscraperMapped = GbpSnapshotPayload & {
  /** Outscraper có trả trường owner_answer ở ít nhất 1 review không (nếu không thì "chưa phản hồi" là chưa rõ). */
  reply_field_present: boolean
  raw_review_count: number
}

export function mapOutscraperToPayload(
  place: any,
  reviewsPlace: any | null,
  opts: { claimedName?: string; placeIdGiven?: boolean; now?: number } = {},
): OutscraperMapped {
  const now = opts.now ?? Date.now()
  const warnings: string[] = []
  const sections: Record<string, GbpCoverageStatus> = {}

  const name = asString(place?.name)
  const primary = asString(first(place, ['type', 'category']))

  // Danh mục phụ: subtypes ("A, B, C") trừ danh mục chính
  const subtypes = asString(place?.subtypes)
  let additional: string | null = null
  if (subtypes && primary) {
    const p = normCat(primary)
    const rest = subtypes
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s && normCat(s) !== p)
    additional = rest.length ? rest.join(', ') : null
  } else if (subtypes) additional = subtypes

  // Phân bố sao
  let dist: Record<string, number> | null = null
  const perScore = place?.reviews_per_score
  if (perScore && typeof perScore === 'object') {
    dist = {}
    for (const k of ['1', '2', '3', '4', '5']) {
      const n = asNumber((perScore as any)[k])
      if (n != null) dist[k] = n
    }
  } else {
    const d: Record<string, number> = {}
    for (const k of [1, 2, 3, 4, 5]) {
      const n = asNumber(place?.[`reviews_per_score_${k}`])
      if (n != null) d[String(k)] = n
    }
    if (Object.keys(d).length) dist = d
  }
  if (dist && !Object.keys(dist).length) dist = null

  // Review (ưu tiên lời gọi reviews-v3, nếu không có thì reviews_data kèm search)
  const rawReviews = reviewsPlace?.reviews_data ?? place?.reviews_data
  const { items: reviews, replyFieldPresent } = mapReviews(rawReviews, now)
  const reviewStats = computeReviewStats(reviews)

  const hours = hoursToString(place?.working_hours)
  const attributes = aboutToGroups(place?.about)
  const posts = parsePosts(place?.posts, now)
  const photosCount = asNumber(place?.photos_count)
  const verified = place?.verified
  const links = actionLinks(place)

  sections.overview = name ? 'ok' : 'empty'
  sections.hours = hours ? 'ok' : 'empty'
  sections.about = attributes.length || place?.description ? 'ok' : 'empty'
  sections.services = 'skipped' // Outscraper không có danh sách dịch vụ chi tiết, chỉ có menu_link
  sections.reviews = reviews.length ? 'ok' : reviewsPlace || place?.reviews_data ? 'empty' : 'skipped'
  sections.updates = posts.length ? 'ok' : Array.isArray(place?.posts) ? 'empty' : 'not_found'
  sections.photos = photosCount != null ? 'ok' : 'empty'

  if (reviews.length && !replyFieldPresent) {
    warnings.push('Outscraper không trả trường phản hồi của chủ (owner_answer) — không kết luận tỉ lệ phản hồi review.')
  }
  if (additional) {
    warnings.push('Danh mục phụ lấy từ trường subtypes của Outscraper — nên đối chiếu với hồ sơ thật.')
  }

  let identity: GbpCoverage['identity'] = 'unverified'
  if (opts.placeIdGiven) identity = 'matched'
  else if (opts.claimedName && name) {
    const a = normCat(opts.claimedName).split(/\s+/).filter(Boolean)
    const b = new Set(normCat(name).split(/\s+/).filter(Boolean))
    const score = a.length ? a.filter((t) => b.has(t)).length / a.length : 0
    identity = score >= 0.5 ? 'matched' : 'ambiguous'
    if (score < 0.5) warnings.push(`Tên trên Maps ("${name}") khác nhiều với tên khai báo ("${opts.claimedName}").`)
  }

  const coverage: GbpCoverage = {
    sections,
    tabs_found: [],
    reviews_loaded: reviews.length,
    photos_counted: photosCount,
    photos_capped: false,
    identity,
    warnings,
    elapsed_ms: 0,
    depth: 'deep',
  }

  const claim: GbpSnapshotPayload['claim_signal'] =
    verified === false ? 'unclaimed' : verified === true ? 'claimed' : 'unknown'

  return {
    place_id: asString(place?.place_id),
    maps_url: asString(first(place, ['location_link', 'reviews_link'])),
    business_name: name,
    description: asString(place?.description),
    primary_category: primary,
    additional_categories: additional,
    opening_hours: hours,
    hours_today: null,
    rating: asNumber(place?.rating),
    review_count: asNumber(place?.reviews),
    phone: asString(place?.phone),
    website_url: asString(first(place, ['website', 'site'])),
    address_text: asString(place?.address ?? place?.full_address),
    business_status: businessStatus(place?.business_status),
    claim_signal: claim,
    action_links: links,
    services: [],
    attributes,
    rating_distribution: dist,
    photo_categories: [],
    reviews,
    review_stats: reviewStats,
    posts_signal: posts.length
      ? `Thấy ${posts.length} bài trên listing`
      : Array.isArray(place?.posts)
        ? 'Không thấy bài đăng công khai trên hồ sơ'
        : 'Outscraper không trả dữ liệu bài đăng cho hồ sơ này — không kết luận là chưa từng đăng bài.',
    recent_posts: posts,
    photos_signal: photosCount != null ? `Hồ sơ có ${photosCount} ảnh` : null,
    photos_count_est: photosCount,
    coverage,
    reply_field_present: replyFieldPresent,
    raw_review_count: Array.isArray(rawReviews) ? rawReviews.length : 0,
  }
}

// ---------------------------------------------------------------------------
// Gọi mạng
// ---------------------------------------------------------------------------

export function outscraperConfigured(): boolean {
  return Boolean(process.env.OUTSCRAPER_API_KEY)
}

/** Query cho Outscraper: ưu tiên place_id, rồi link Maps, rồi tên + khu vực. */
export function buildOutscraperQuery(input: OutscraperQueryInput): string | null {
  if (input.placeId) return String(input.placeId).replace(/^places\//, '')
  if (input.mapsUrl) return input.mapsUrl
  if (input.businessName) return [input.businessName, input.area].filter(Boolean).join(' ')
  return null
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function osFetchRows(path: string, params: Record<string, string | number | undefined>, budgetMs: number): Promise<any[]> {
  const key = process.env.OUTSCRAPER_API_KEY
  if (!key) throw new Error('Thiếu OUTSCRAPER_API_KEY')
  const url = new URL(path, BASE)
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') url.searchParams.set(k, String(v))
  const t0 = Date.now()
  const res = await fetch(url, { headers: { 'X-API-KEY': key }, signal: AbortSignal.timeout(Math.min(budgetMs, 90_000)) })
  let body: any = null
  try {
    body = await res.json()
  } catch {
    /* body rỗng */
  }
  if (!res.ok) throw new Error(`Outscraper ${path}: ${body?.error || body?.errorMessage || res.status}`)

  // Chế độ async: status Pending + id -> hỏi lại /requests/{id}
  let cur = body
  while (cur && cur.status === 'Pending' && cur.id && Date.now() - t0 < budgetMs) {
    await sleep(2000)
    const r = await fetch(new URL(`/requests/${cur.id}`, BASE), {
      headers: { 'X-API-KEY': key },
      signal: AbortSignal.timeout(20_000),
    })
    cur = await r.json().catch(() => null)
  }
  if (!cur || cur.status === 'Pending') throw new Error(`Outscraper ${path}: quá thời gian chờ`)
  if (cur.status && cur.status !== 'Success') throw new Error(`Outscraper ${path}: ${cur.status}`)
  // data = [ [ {place}, ... ] ] (mỗi query 1 mảng)
  const data = cur.data
  const row = Array.isArray(data) ? (Array.isArray(data[0]) ? data[0] : data) : []
  return row
}

async function osFetch(path: string, params: Record<string, string | number | undefined>, budgetMs: number): Promise<any> {
  return (await osFetchRows(path, params, budgetMs))[0] ?? null
}

export type FetchOutscraperOptions = OutscraperQueryInput & {
  reviewsLimit?: number
  /** Unix giây: chỉ lấy review từ mốc này (dùng cho Review Watch). */
  cutoff?: number
  budgetMs?: number
}

const lang = () => process.env.OUTSCRAPER_LANGUAGE || 'vi'
const region = () => process.env.OUTSCRAPER_REGION || 'VN'

export async function fetchOutscraperReviews(opts: FetchOutscraperOptions): Promise<any | null> {
  const query = buildOutscraperQuery(opts)
  if (!query) return null
  return osFetch(
    '/maps/reviews-v3',
    {
      query,
      reviewsLimit: opts.reviewsLimit ?? GBP_SNAPSHOT_MAX_REVIEWS,
      limit: 1,
      sort: 'newest',
      cutoff: opts.cutoff,
      language: lang(),
      region: region(),
      async: 'false',
    },
    opts.budgetMs ?? 120_000,
  )
}

export async function fetchOutscraperPlace(opts: FetchOutscraperOptions): Promise<any | null> {
  const query = buildOutscraperQuery(opts)
  if (!query) return null
  return osFetch(
    '/maps/search-v3',
    { query, limit: 1, language: lang(), region: region(), async: 'false' },
    opts.budgetMs ?? 120_000,
  )
}

export async function fetchOutscraperSnapshot(
  opts: FetchOutscraperOptions & { depth?: 'quick' | 'deep' },
): Promise<OutscraperMapped> {
  const t0 = Date.now()
  const deep = (opts.depth ?? 'deep') === 'deep'
  const fetchPair = (o: FetchOutscraperOptions) =>
    Promise.all([
      fetchOutscraperPlace(o),
      deep ? fetchOutscraperReviews(o).catch(() => null) : Promise.resolve(null), // review lỗi không làm hỏng cả snapshot
    ])

  let [place, reviewsPlace] = await fetchPair(opts)

  // Link/place_id không ra kết quả (vd link rút gọn Outscraper không đọc được) -> thử lại theo tên + khu vực.
  // Kết quả theo tên có thể là doanh nghiệp khác nên KHÔNG coi là "matched" và có cảnh báo.
  let usedNameFallback = false
  if (!place && (opts.placeId || opts.mapsUrl) && opts.businessName) {
    const byName = { businessName: opts.businessName, area: opts.area, budgetMs: opts.budgetMs, reviewsLimit: opts.reviewsLimit }
    ;[place, reviewsPlace] = await fetchPair(byName)
    usedNameFallback = Boolean(place)
  }
  if (!place) throw new Error('Outscraper: không tìm thấy địa điểm')

  const mapped = mapOutscraperToPayload(place, reviewsPlace, {
    claimedName: opts.businessName,
    placeIdGiven: Boolean(opts.placeId) && !usedNameFallback,
  })
  const cov = mapped.coverage
  if (cov) {
    if (!deep) cov.depth = 'quick'
    if (deep && !reviewsPlace) {
      cov.warnings.push('Không lấy được review từ Outscraper lần này.')
      cov.sections.reviews = 'error'
    }
    if (usedNameFallback) {
      cov.warnings.push('Không tìm thấy bằng link/place_id nên đã tìm theo tên + khu vực — kiểm tra lại đúng doanh nghiệp.')
    }
    cov.elapsed_ms = Date.now() - t0
  }
  return mapped
}

/**
 * Tìm nhiều địa điểm theo 1 truy vấn ("Tiệm làm móng Quận 1"). Trả về danh sách theo THỨ TỰ Google trả (thứ hạng ước lượng).
 * Mỗi địa điểm tính 1 bản ghi khi Outscraper tính phí, nên giữ `limit` vừa phải.
 */
export async function fetchOutscraperSearch(query: string, limit = 20, budgetMs = 120_000): Promise<any[]> {
  const rows = await osFetchRows(
    '/maps/search-v3',
    { query, limit, language: lang(), region: region(), async: 'false' },
    budgetMs,
  )
  return Array.isArray(rows) ? rows : []
}
