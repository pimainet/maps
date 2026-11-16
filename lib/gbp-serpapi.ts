/**
 * Nguồn bù thứ ba: SerpApi "Google Maps Place Results" (engine=google_maps, type=place, place_id=…).
 * Đọc giao diện Maps nên lấy được thứ Places API không có: MÔ TẢ do chủ viết, danh mục (type[]) và bài đăng "From the owner" (posts, các bài gần nhất).
 * Chỉ bù trường còn trống, không ghi đè dữ liệu có sẵn. Bật bằng SERPAPI_API_KEY. Mọi lỗi đều không làm hỏng snapshot.
 * Mỗi lần gọi tốn 1 search của SerpApi; đã tra mà không có thêm gì thì ghi dấu để không tra lại mỗi lần audit.
 */
import type { GbpPostItem, RunGbpSnapshotInput, RunGbpSnapshotResult } from '@/lib/gbp-snapshot-types'
import { GBP_SNAPSHOT_MAX_POSTS } from '@/lib/gbp-snapshot-types'
import { ageDays, relativeVi } from '@/lib/gbp-outscraper'
import { fetchSearchApiInfo, searchApiConfigured } from '@/lib/gbp-searchapi'

const ENDPOINT = 'https://serpapi.com/search.json'
const TIMEOUT_MS = 30_000

export function serpapiConfigured(): boolean {
  return Boolean(process.env.SERPAPI_API_KEY)
}

export type SerpInfo = {
  place_id: string | null
  description: string | null
  types: string[]
  /** null = SerpApi không trả khóa posts (không biết có bài hay không); [] = trả rỗng. */
  posts: GbpPostItem[] | null
}

const clean = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)

function parsePostDate(raw: unknown, now: number): string | null {
  const s = clean(raw)
  if (!s) return null
  const ms = Date.parse(s)
  if (Number.isNaN(ms)) return null // định dạng lạ: không đoán, check Post Recency sẽ tự coi là chưa đủ dữ liệu
  return relativeVi(ageDays(ms, now))
}

/** Phần thuần: JSON SerpApi -> SerpInfo (null nếu không có place_results hợp lệ). */
export function parseSerpInfo(json: any, now = Date.now()): SerpInfo | null {
  const p = json?.place_results
  if (!p || typeof p !== 'object') return null
  const types = Array.isArray(p.type) ? p.type.map(clean).filter((x: string | null): x is string => !!x) : []
  let posts: GbpPostItem[] | null = null
  if (Array.isArray(p.posts)) {
    posts = p.posts
      .map((x: any): GbpPostItem | null => {
        const text = [clean(x?.title), clean(x?.description)].filter(Boolean).join(' — ')
        if (!text) return null
        return { text: text.slice(0, 500), approx_date: parsePostDate(x?.date, now) }
      })
      .filter((x: GbpPostItem | null): x is GbpPostItem => !!x)
      .slice(0, GBP_SNAPSHOT_MAX_POSTS)
  }
  return { place_id: clean(p.place_id), description: clean(p.description), types, posts }
}

export async function fetchSerpApiInfo(placeId: string): Promise<{ info: SerpInfo | null; error?: string }> {
  if (!serpapiConfigured()) return { info: null, error: 'Chưa cấu hình SERPAPI_API_KEY' }
  try {
    const qs = new URLSearchParams({
      engine: 'google_maps',
      type: 'place',
      place_id: placeId.replace(/^places\//, ''),
      hl: 'vi',
      gl: 'vn',
      api_key: process.env.SERPAPI_API_KEY as string,
    })
    const res = await fetch(`${ENDPOINT}?${qs.toString()}`, { signal: AbortSignal.timeout(TIMEOUT_MS) })
    const json: any = await res.json().catch(() => null)
    if (!res.ok || json?.error) {
      const why = typeof json?.error === 'string' ? json.error.slice(0, 120) : `HTTP ${res.status}`
      return { info: null, error: `SerpApi: ${why}` }
    }
    const info = parseSerpInfo(json)
    return info ? { info } : { info: null, error: 'SerpApi không có kết quả cho địa điểm này' }
  } catch (e: any) {
    return { info: null, error: `SerpApi lỗi: ${String(e?.message || e).slice(0, 120)}` }
  }
}

export const SERP_CHECKED_MARK = 'SerpApi/SearchApi: đã tra, không có thêm dữ liệu để bù.'

export function needsSerpEnrichment(s: Partial<RunGbpSnapshotResult>): boolean {
  if (s.coverage?.warnings?.includes(SERP_CHECKED_MARK)) return false
  const noPosts = !(s.recent_posts && s.recent_posts.length) && s.coverage?.sections?.updates !== 'empty'
  const catsOk = s.coverage?.sections?.categories === 'ok' && Boolean(s.additional_categories)
  return !clean(s.description) || noPosts || !catsOk
}

/** Chỉ nhận kết quả ĐÚNG quán: place_id trả về phải khớp place_id đã biết. */
export function applySerpInfo(snap: RunGbpSnapshotResult, info: SerpInfo, expectedPlaceId?: string | null, label = 'SerpApi'): RunGbpSnapshotResult {
  const expected = (expectedPlaceId || snap.place_id || '').replace(/^places\//, '')
  if (!expected || !info.place_id || info.place_id !== expected) return snap

  const out: RunGbpSnapshotResult = { ...snap }
  const cov = out.coverage ? { ...out.coverage, sections: { ...out.coverage.sections }, warnings: [...out.coverage.warnings] } : undefined
  const used: string[] = []

  if (!clean(out.description) && info.description) {
    out.description = info.description
    if (cov) cov.sections.about = 'ok'
    used.push('mô tả')
  }

  // type[] = danh mục của quán (đầu tiên là danh mục chính). Chỉ BỔ SUNG danh mục phụ còn thiếu, không đổi danh mục chính.
  const primaryKey = (out.primary_category || info.types[0] || '').toLowerCase()
  const have = new Set((out.additional_categories || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean))
  const extra = info.types.filter((c) => c.toLowerCase() !== primaryKey && !have.has(c.toLowerCase()))
  if (extra.length) {
    out.additional_categories = [out.additional_categories, ...extra].filter(Boolean).join(', ')
    if (cov) cov.sections.categories = 'ok'
    used.push('danh mục phụ')
  }

  if (!(out.recent_posts && out.recent_posts.length) && info.posts && info.posts.length) {
    out.recent_posts = info.posts
    out.posts_signal = `Thấy ${info.posts.length} bài chủ quán đăng gần đây (${label})`
    if (cov) cov.sections.updates = 'ok'
    used.push('bài đăng')
  }

  if (cov && used.length) cov.warnings.push(`Đã bù ${used.join(', ')} từ ${label}.`)
  else if (cov && !cov.warnings.includes(SERP_CHECKED_MARK)) cov.warnings.push(SERP_CHECKED_MARK)
  if (cov) out.coverage = cov
  return out
}

export async function enrichWithSerpApi(snap: RunGbpSnapshotResult, input: Pick<RunGbpSnapshotInput, 'placeId'>): Promise<RunGbpSnapshotResult> {
  if (!needsSerpEnrichment(snap)) return snap
  const placeId = input.placeId || snap.place_id
  if (!placeId) return snap
  // SerpApi trước; không có kết quả (hết hạn mức, lỗi, không thấy quán) thì thử SearchApi nếu đã cấu hình.
  if (serpapiConfigured()) {
    const r = await fetchSerpApiInfo(placeId)
    if (r.info) return applySerpInfo(snap, r.info, placeId, 'SerpApi')
    if (r.error) console.warn('serpapi enrich:', r.error)
  }
  if (searchApiConfigured()) {
    const r = await fetchSearchApiInfo(placeId)
    if (r.info) return applySerpInfo(snap, r.info, placeId, 'SearchApi')
    if (r.error) console.warn('searchapi enrich:', r.error)
  }
  return snap
}
