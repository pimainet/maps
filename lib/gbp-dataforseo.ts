/**
 * Nguồn thứ hai để BÙ những trường Outscraper hay thiếu: mô tả do chủ viết + danh mục phụ (+ danh mục chính).
 * DataForSEO "My Business Info" (live, 1 lần gọi ~ vài phần trăm USD). Chỉ bù trường còn trống, không ghi đè dữ liệu có sẵn.
 * Bật bằng DATAFORSEO_LOGIN + DATAFORSEO_PASSWORD (xem https://app.dataforseo.com/api-access). Mọi lỗi đều không làm hỏng snapshot.
 *
 * Bài đăng (Google Posts) của DataForSEO là API dạng task bất đồng bộ (My Business Updates) — chưa dùng ở đây.
 */
import type { RunGbpSnapshotInput, RunGbpSnapshotResult } from '@/lib/gbp-snapshot-types'

const ENDPOINT = 'https://api.dataforseo.com/v3/business_data/google/my_business_info/live'
const TIMEOUT_MS = 30_000
const VIETNAM_LOCATION_CODE = 2704

export function dataforseoConfigured(): boolean {
  return Boolean(process.env.DATAFORSEO_LOGIN && process.env.DATAFORSEO_PASSWORD)
}

export type DfsInfo = {
  place_id: string | null
  cid: string | null
  description: string | null
  category: string | null
  additional_categories: string[]
}

const clean = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)

/** keyword theo thứ tự tin cậy: place_id > cid (trong link ?cid=...) > tên + khu vực. */
export function buildDfsKeyword(input: Pick<RunGbpSnapshotInput, 'placeId' | 'mapsUrl' | 'businessName' | 'area'>): { keyword: string; by: 'place_id' | 'cid' | 'name' } | null {
  const pid = clean(input.placeId)?.replace(/^places\//, '')
  if (pid) return { keyword: `place_id:${pid}`, by: 'place_id' }
  const cid = input.mapsUrl?.match(/[?&]cid=(\d{5,25})/)?.[1]
  if (cid) return { keyword: `cid:${cid}`, by: 'cid' }
  const name = [clean(input.businessName), clean(input.area)].filter(Boolean).join(' ')
  return name ? { keyword: name.slice(0, 700), by: 'name' } : null
}

/** Phần thuần: đọc JSON DataForSEO -> DfsInfo (null nếu không có kết quả hợp lệ). */
export function parseDfsInfo(json: any): DfsInfo | null {
  const task = json?.tasks?.[0]
  if (!task || task.status_code !== 20000) return null
  const item = task.result?.[0]?.items?.[0]
  if (!item || typeof item !== 'object') return null
  const add = Array.isArray(item.additional_categories) ? item.additional_categories.map(clean).filter(Boolean) : []
  return {
    place_id: clean(item.place_id),
    cid: item.cid != null ? String(item.cid) : null,
    description: clean(item.description),
    category: clean(item.category),
    additional_categories: add as string[],
  }
}

export async function fetchDataForSeoInfo(input: RunGbpSnapshotInput): Promise<{ info: DfsInfo | null; by: string | null; error?: string }> {
  if (!dataforseoConfigured()) return { info: null, by: null, error: 'Chưa cấu hình DATAFORSEO_LOGIN/DATAFORSEO_PASSWORD' }
  const k = buildDfsKeyword(input)
  if (!k) return { info: null, by: null, error: 'Thiếu place_id/cid/tên để tra DataForSEO' }
  try {
    const auth = Buffer.from(`${process.env.DATAFORSEO_LOGIN}:${process.env.DATAFORSEO_PASSWORD}`).toString('base64')
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
      body: JSON.stringify([{ keyword: k.keyword, location_code: VIETNAM_LOCATION_CODE, language_code: 'vi' }]),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    const json = await res.json().catch(() => null)
    if (!res.ok) return { info: null, by: k.by, error: `DataForSEO HTTP ${res.status}` }
    const info = parseDfsInfo(json)
    if (!info) return { info: null, by: k.by, error: `DataForSEO không có kết quả (${json?.tasks?.[0]?.status_message || 'rỗng'})` }
    return { info, by: k.by }
  } catch (e: any) {
    return { info: null, by: k.by, error: `DataForSEO lỗi: ${String(e?.message || e).slice(0, 120)}` }
  }
}

/** Trường nào của snapshot còn thiếu và DataForSEO có thể bù? */
export const DFS_CHECKED_MARK = 'DataForSEO: đã tra, không có thêm dữ liệu để bù.'

export function needsDfsEnrichment(s: Partial<RunGbpSnapshotResult>): boolean {
  if (s.coverage?.warnings?.includes(DFS_CHECKED_MARK)) return false // đã tra rồi mà nguồn cũng không có: không trả phí lại mỗi lần audit
  const catsOk = s.coverage?.sections?.categories === 'ok' && Boolean(s.additional_categories)
  return !clean(s.description) || !catsOk
}

/**
 * Bù mô tả + danh mục phụ vào snapshot. Chỉ nhận kết quả đúng doanh nghiệp:
 *  - tra bằng place_id: place_id trả về phải khớp;
 *  - tra bằng tên: bỏ qua (dễ nhầm quán khác).
 */
export function applyDfsInfo(snap: RunGbpSnapshotResult, info: DfsInfo, by: string, givenPlaceId?: string | null): RunGbpSnapshotResult {
  if (by === 'name') return snap
  const expected = (givenPlaceId || snap.place_id || '').replace(/^places\//, '')
  if (by === 'place_id' && expected && info.place_id && info.place_id !== expected) return snap

  const out: RunGbpSnapshotResult = { ...snap }
  const cov = out.coverage
    ? { ...out.coverage, sections: { ...out.coverage.sections }, warnings: [...out.coverage.warnings], field_sources: { ...(out.coverage.field_sources || {}) } }
    : undefined
  const used: string[] = []

  if (!clean(out.description) && info.description) {
    out.description = info.description
    if (cov) cov.sections.about = 'ok'
    if (cov) cov.field_sources.description = 'dataforseo'
    used.push('mô tả')
  }
  if (!clean(out.primary_category) && info.category) {
    out.primary_category = info.category
    if (cov) cov.field_sources.primary_category = 'dataforseo'
    used.push('danh mục chính')
  }
  // DataForSEO trả additional_categories (mảng, có thể rỗng) => đã đọc được; so với danh mục chính để loại trùng.
  const primaryKey = (out.primary_category || '').toLowerCase()
  const have = new Set((out.additional_categories || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean))
  const extra = info.additional_categories.filter((c) => c.toLowerCase() !== primaryKey && !have.has(c.toLowerCase()))
  if (extra.length) {
    out.additional_categories = [out.additional_categories, ...extra].filter(Boolean).join(', ')
    if (cov) cov.field_sources.additional_categories = 'dataforseo'
    used.push('danh mục phụ')
  }
  if (cov && (extra.length || have.size || Array.isArray(info.additional_categories))) cov.sections.categories = 'ok'
  if (cov && used.length) cov.warnings.push(`Đã bù ${used.join(', ')} từ DataForSEO.`)
  else if (cov && !cov.warnings.includes(DFS_CHECKED_MARK)) cov.warnings.push(DFS_CHECKED_MARK)
  if (cov) out.coverage = cov
  return out
}

export async function enrichWithDataForSeo(snap: RunGbpSnapshotResult, input: RunGbpSnapshotInput): Promise<RunGbpSnapshotResult> {
  if (!needsDfsEnrichment(snap)) return snap
  if (!dataforseoConfigured()) {
    console.warn('dataforseo enrich: bỏ qua — thiếu DATAFORSEO_LOGIN/DATAFORSEO_PASSWORD trên môi trường chạy (đã Redeploy chưa?)')
    return snap
  }
  const placeId = input.placeId || snap.place_id
  const r = await fetchDataForSeoInfo({ ...input, placeId })
  if (!r.info) {
    if (r.error) console.warn('dataforseo enrich:', r.error)
    return snap
  }
  return applyDfsInfo(snap, r.info, r.by || 'name', placeId)
}
