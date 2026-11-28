/**
 * Dấu vân tay review DÙNG CHUNG MỌI NGUỒN (Outscraper, SerpApi, SearchApi, Business Profile API).
 *
 * Mỗi nguồn có review_id riêng (Outscraper/SerpApi trả id dạng "ChZDSUhN..." của Maps; GBP API trả reviewId mã hoá khác hẳn),
 * và ngày có nguồn chỉ cho "2 tuần trước". Vì vậy khoá chính = hash(tên người viết chuẩn hoá | số sao | 80 ký tự đầu nội dung
 * chuẩn hoá). Review không có chữ và không có tên (ẩn danh) thì thêm ngày (yyyy-mm-dd) nếu biết chính xác.
 * Khi khoá không trùng (khách sửa review, nguồn dịch máy...), findMatch() so mềm thêm: id nguồn, tên + ngày gần, nội dung.
 */
import { createHash } from 'node:crypto'
import type { IncomingReview } from './types'

/** Bỏ phần dịch máy của Google: "(Translated by Google) ... (Original) ..." -> giữ bản gốc. */
export function stripGoogleTranslation(text: string): string {
  const t = text || ''
  const orig = /\((?:Original|Bản gốc)\)\s*([\s\S]*)$/i.exec(t)
  if (orig) return orig[1].trim()
  return t.replace(/^\((?:Translated by Google|Google dịch|Được Google dịch)\)\s*/i, '').trim()
}

/** Chữ thường, bỏ dấu tiếng Việt, bỏ ký tự không phải chữ/số, gộp khoảng trắng. */
export function normText(s: string | null | undefined): string {
  return (s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

const ANON = new Set(['', 'a google user', 'nguoi dung google', 'google user', 'anonymous'])

export function normAuthor(s: string | null | undefined): string {
  const n = normText(s)
  return ANON.has(n) ? '' : n
}

export function textPrefix(text: string | null | undefined, n = 80): string {
  return normText(stripGoogleTranslation(text || '')).slice(0, n)
}

export function reviewFingerprint(r: Pick<IncomingReview, 'author_name' | 'rating' | 'text' | 'reviewed_at' | 'reviewed_at_exact'>): string {
  const author = normAuthor(r.author_name)
  const body = textPrefix(r.text)
  const parts = [author, String(Math.round(r.rating)), body]
  if (!author && !body) parts.push(r.reviewed_at && r.reviewed_at_exact ? r.reviewed_at.slice(0, 10) : 'nodate')
  return 'v2:' + createHash('sha1').update(parts.join('|')).digest('hex').slice(0, 32)
}

type Comparable = {
  review_key: string
  source_review_id?: string | null
  gbp_review_name?: string | null
  author_name: string | null
  rating: number
  review_text?: string | null
  reviewed_at: string | null
}

const DAY = 86_400_000

function daysApart(a: string | null, b: string | null): number | null {
  if (!a || !b) return null
  const x = Date.parse(a)
  const y = Date.parse(b)
  return Number.isFinite(x) && Number.isFinite(y) ? Math.abs(x - y) / DAY : null
}

/**
 * Tìm bản ghi đã có ứng với 1 review mới lấy về. Thứ tự:
 *   1. trùng review_key (dấu vân tay)            2. trùng gbp_review_name / source_review_id
 *   3. cùng tên người viết (không ẩn danh) + ngày cách ≤ 3 ngày (khách sửa nội dung / đổi sao)
 *   4. cùng số sao + cùng 60 ký tự đầu nội dung (≥ 20 ký tự) + tên trùng hoặc 1 bên thiếu tên (bản ghi 'legacy' của 018)
 * Trả về null nếu không chắc — thà tạo bản ghi mới còn hơn gộp nhầm 2 khách.
 */
export function findMatch<T extends Comparable>(existing: T[], inc: IncomingReview, key = reviewFingerprint(inc)): T | null {
  const byKey = existing.find((e) => e.review_key === key)
  if (byKey) return byKey
  if (inc.gbp_review_name) {
    const g = existing.find((e) => e.gbp_review_name === inc.gbp_review_name)
    if (g) return g
  }
  if (inc.source_review_id) {
    const s = existing.find((e) => e.source_review_id && e.source_review_id === inc.source_review_id)
    if (s) return s
  }
  const a = normAuthor(inc.author_name)
  if (a) {
    const near = existing.filter((e) => normAuthor(e.author_name) === a).filter((e) => {
      const d = daysApart(e.reviewed_at, inc.reviewed_at)
      return d != null && d <= 3
    })
    if (near.length === 1) return near[0]
  }
  const p = textPrefix(inc.text, 60)
  if (p.length >= 20) {
    const same = existing.filter((e) => {
      if (Math.round(e.rating) !== Math.round(inc.rating)) return false
      if (textPrefix(e.review_text || '', 60) !== p) return false
      const ea = normAuthor(e.author_name)
      return !ea || !a || ea === a
    })
    if (same.length === 1) return same[0]
  }
  return null
}

/**
 * Ghép 1 review của Business Profile API với bản ghi đã có (để lấy gbp_review_name đăng phản hồi).
 * Chặt hơn findMatch: bắt buộc cùng số sao; rồi cần (nội dung trùng 40 ký tự đầu) hoặc (tên trùng + ngày ≤ 2 ngày)
 * hoặc (cả hai không có chữ + tên trùng). Có >1 ứng viên thì không ghép.
 */
export function matchGbpReview<T extends Comparable>(existing: T[], g: IncomingReview): T | null {
  if (g.gbp_review_name) {
    const hit = existing.find((e) => e.gbp_review_name === g.gbp_review_name)
    if (hit) return hit
  }
  const key = reviewFingerprint(g)
  const byKey = existing.filter((e) => e.review_key === key)
  if (byKey.length === 1) return byKey[0]
  const a = normAuthor(g.author_name)
  const p = textPrefix(g.text, 40)
  const cands = existing.filter((e) => {
    if (e.gbp_review_name && e.gbp_review_name !== g.gbp_review_name) return false
    if (Math.round(e.rating) !== Math.round(g.rating)) return false
    const ea = normAuthor(e.author_name)
    const ep = textPrefix(e.review_text || '', 40)
    const d = daysApart(e.reviewed_at, g.reviewed_at)
    if (p.length >= 15 && ep === p) return !ea || !a || ea === a
    if (a && ea === a && d != null && d <= 2) return true
    if (!p && !ep && a && ea === a) return true
    return false
  })
  return cands.length === 1 ? cands[0] : null
}
