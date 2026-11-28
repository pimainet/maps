/**
 * Phần thuần dùng chung cho 2 nguồn phụ đọc giao diện Google Maps: SerpApi (lib/gbp-serpapi.ts) và SearchApi
 * (lib/gbp-searchapi.ts). Cả hai được chuẩn hoá về cùng 1 dạng `ExtraPlace` / `ExtraReviews` để lib/gbp-enrich.ts
 * gộp theo từng trường, có ghi nguồn.
 *
 * Nguyên tắc: không đoán. Ngày không đọc được -> null; khóa vắng mặt -> null ("chưa biết"), khác với mảng rỗng.
 */
import { createHash } from 'node:crypto'
import type {
  GbpActionLink,
  GbpAttributeGroup,
  GbpBusinessStatus,
  GbpPostItem,
  GbpQaItem,
  GbpReviewItem,
} from '@/lib/gbp-snapshot-types'
import { GBP_SNAPSHOT_MAX_POSTS, GBP_SNAPSHOT_MAX_REVIEWS } from '@/lib/gbp-snapshot-types'
import { parseRelativeAgeDays } from '@/lib/gbp-relative-time'

export type ExtraProvider = 'serpapi' | 'searchapi'

/** Thông tin hồ sơ đọc từ 1 lần gọi "place" của SerpApi/SearchApi. Trường null = nguồn không trả (chưa biết). */
export type ExtraPlace = {
  provider: ExtraProvider
  place_id: string | null
  /** data_id dạng 0x..:0x.. — cần cho SerpApi google_maps_posts. */
  data_id: string | null
  title: string | null
  description: string | null
  /** Danh mục, phần tử đầu là danh mục chính. */
  types: string[]
  /** null = nguồn không trả khóa posts; [] = trả rỗng. */
  posts: GbpPostItem[] | null
  opening_hours: string | null
  hours_today: string | null
  /** null = không trả khóa extensions. */
  attributes: GbpAttributeGroup[] | null
  action_links: GbpActionLink[]
  /** 'unclaimed' khi nguồn báo unclaimed_listing; null = không có tín hiệu (KHÔNG có nghĩa đã xác minh). */
  claim_signal: 'unclaimed' | null
  business_status: GbpBusinessStatus | null
  rating_distribution: Record<string, number> | null
  questions_answers: GbpQaItem[] | null
  phone: string | null
  website_url: string | null
  rating: number | null
  review_count: number | null
}

export type ExtraReviews = {
  provider: ExtraProvider
  place_id: string | null
  items: GbpReviewItem[]
  /**
   * true = có thể kết luận review nào CHƯA được chủ phản hồi (nguồn có tài liệu trường phản hồi, hoặc thấy ít nhất 1 phản hồi).
   * false = không phân biệt được "chưa phản hồi" với "nguồn không trả trường phản hồi" -> không tính tỉ lệ phản hồi.
   */
  reply_known: boolean
}

export const clean = (v: unknown): string | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return String(v)
  if (typeof v !== 'string') return null
  const s = v.replace(/\s+/g, ' ').trim()
  return s ? s : null
}

export const num = (v: unknown): number | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim()) {
    const n = Number(v.replace(/[^\d.,-]/g, '').replace(',', '.'))
    return Number.isFinite(n) ? n : null
  }
  return null
}

export const normPlaceId = (v: unknown): string | null => clean(v)?.replace(/^places\//, '') ?? null

export function ageDays(ms: number | null, now: number): number | null {
  if (ms == null) return null
  return Math.max(0, Math.floor((now - ms) / 86_400_000))
}

export function relativeVi(days: number | null): string | null {
  if (days == null) return null
  if (days < 1) return 'hôm nay'
  if (days < 7) return `${days} ngày trước`
  if (days < 30) return `${Math.round(days / 7)} tuần trước`
  if (days < 365) return `${Math.round(days / 30)} tháng trước`
  return `${Math.round(days / 365)} năm trước`
}

const EN_MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

/**
 * Ngày TUYỆT ĐỐI -> epoch ms. Nhận: ISO ("2025-01-14T19:45:18Z", "2026-11-02"), "Jan 14, 2025", "14 Jan 2025",
 * tiếng Việt "14 thg 1, 2025" / "14 tháng 1, 2025", "14/01/2025". Thiếu năm ("Jan 14") -> năm gần nhất không vượt quá hôm nay.
 * Không đọc được -> null. KHÔNG xử lý chuỗi tương đối (xem parseAnyDate).
 */
export function parseAbsoluteDate(raw: unknown, now = Date.now()): number | null {
  const s = clean(raw)
  if (!s) return null
  const t = s.toLowerCase()
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) {
    const ms = Date.parse(s)
    return Number.isFinite(ms) ? ms : null
  }
  const vi = /(\d{1,2})\s*(?:thg|tháng)\s*(\d{1,2})(?:\s*,?\s*(?:năm\s*)?(\d{4}))?/.exec(t)
  if (vi) return withYear(+vi[3] || null, +vi[2] - 1, +vi[1], now)
  const dmy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t)
  if (dmy) return withYear(+dmy[3], +dmy[2] - 1, +dmy[1], now) // Google VN dùng ngày/tháng/năm
  const en1 = /\b([a-z]{3})[a-z]*\.?\s+(\d{1,2})(?:,?\s+(\d{4}))?\b/.exec(t)
  if (en1 && EN_MONTHS.includes(en1[1])) return withYear(+en1[3] || null, EN_MONTHS.indexOf(en1[1]), +en1[2], now)
  const en2 = /\b(\d{1,2})\s+([a-z]{3})[a-z]*\.?(?:,?\s+(\d{4}))?\b/.exec(t)
  if (en2 && EN_MONTHS.includes(en2[2])) return withYear(+en2[3] || null, EN_MONTHS.indexOf(en2[2]), +en2[1], now)
  return null
}

function withYear(year: number | null, month: number, day: number, now: number): number | null {
  if (month < 0 || month > 11 || day < 1 || day > 31) return null
  if (year) return Date.UTC(year, month, day)
  const y = new Date(now).getUTCFullYear()
  const ms = Date.UTC(y, month, day)
  return ms > now + 86_400_000 ? Date.UTC(y - 1, month, day) : ms
}

/** Ngày tuyệt đối hoặc tương đối ("4 ngày trước", "a week ago") -> { ms, exact }. exact=false với chuỗi tương đối. */
export function parseAnyDate(raw: unknown, now = Date.now()): { ms: number; exact: boolean } | null {
  const abs = parseAbsoluteDate(raw, now)
  if (abs != null) return { ms: abs, exact: true }
  const days = parseRelativeAgeDays(clean(raw))
  return days == null ? null : { ms: now - days * 86_400_000, exact: false }
}

/** 1 bài đăng (Google Posts / "Từ chủ sở hữu") -> GbpPostItem; bài không có chữ bị bỏ. */
export function toPost(
  parts: { title?: unknown; body?: unknown; date?: unknown; postedAt?: unknown },
  now: number,
): GbpPostItem | null {
  const title = clean(parts.title)
  const body = clean(parts.body)
  const text = [title, body && body !== title ? body : null].filter(Boolean).join(' — ')
  if (!text) return null
  const exact = parts.postedAt != null ? parseAbsoluteDate(parts.postedAt, now) : null
  const d = exact != null ? { ms: exact, exact: true } : parseAnyDate(parts.date, now)
  return {
    text: text.slice(0, 500),
    approx_date: d ? relativeVi(ageDays(d.ms, now)) : null,
    posted_at: d && d.exact ? new Date(d.ms).toISOString() : null,
  }
}

export function capPosts(posts: GbpPostItem[]): GbpPostItem[] {
  return posts.slice(0, GBP_SNAPSHOT_MAX_POSTS)
}

/** Bài có ngày đọc được (tuyệt đối hoặc tương đối). */
export function postIsDated(p: GbpPostItem): boolean {
  return Boolean(p.posted_at || parseRelativeAgeDays(p.approx_date))
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

/** Giờ mở cửa: SerpApi `hours` = [{monday: "..."}...]; SearchApi `open_hours` = {monday: "..."}. -> "Thứ Hai: ...; ..." */
export function hoursToText(raw: unknown): string | null {
  const pairs: Array<[string, string]> = []
  const push = (k: string, v: unknown) => {
    const val = clean(v)
    if (val) pairs.push([DAY_VI[k.toLowerCase()] || k, val])
  }
  if (Array.isArray(raw)) {
    for (const o of raw) if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) push(k, v)
  } else if (raw && typeof raw === 'object') {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) push(k, v)
  }
  return pairs.length ? pairs.map(([d, h]) => `${d}: ${h}`).join('; ') : null
}

/** open_state ("Đóng cửa vĩnh viễn", "Permanently closed", "Temporarily closed"...) -> trạng thái; không rõ -> null. */
export function statusFromOpenState(raw: unknown): GbpBusinessStatus | null {
  const t = (clean(raw) || '').toLowerCase()
  if (!t) return null
  if (/permanently closed|đóng cửa vĩnh viễn|vĩnh viễn/.test(t)) return 'permanently_closed'
  if (/temporarily closed|tạm thời đóng cửa|tạm đóng cửa/.test(t)) return 'temporarily_closed'
  if (/open|closes|opens|mở cửa|đóng cửa lúc|mở cả ngày/.test(t)) return 'operational'
  return null
}

/** Nhãn nhóm thuộc tính (khóa extensions của SerpApi) -> tiếng Việt dễ đọc. */
const GROUP_VI: Record<string, string> = {
  service_options: 'Tuỳ chọn dịch vụ',
  highlights: 'Điểm nổi bật',
  popular_for: 'Phổ biến cho',
  accessibility: 'Hỗ trợ tiếp cận',
  offerings: 'Sản phẩm/dịch vụ',
  dining_options: 'Lựa chọn ăn uống',
  amenities: 'Tiện nghi',
  atmosphere: 'Bầu không khí',
  crowd: 'Khách hàng',
  planning: 'Lập kế hoạch',
  payments: 'Thanh toán',
  children: 'Trẻ em',
  parking: 'Bãi đỗ xe',
  pets: 'Thú cưng',
  from_the_business: 'Thông tin từ doanh nghiệp',
}

const prettyGroup = (k: string) => GROUP_VI[k] || k.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())

/**
 * SerpApi `extensions`: [{ highlights: ["..."] }, { accessibility: [...] }] (+ service_options {dine_in: true}).
 * SearchApi `extensions`: [{ title: "Accessibility", items: [{ title, value }] }].
 * `unsupported_extensions` (thuộc tính bị gạch = KHÔNG có) cố ý bỏ qua.
 * null = không có khóa nào (chưa biết); [] = có khóa nhưng rỗng.
 */
export function extensionsToGroups(extensions: unknown, serviceOptions?: unknown): GbpAttributeGroup[] | null {
  if (extensions == null && serviceOptions == null) return null
  const groups: GbpAttributeGroup[] = []
  const add = (group: string, items: string[]) => {
    const uniq = [...new Set(items.map((x) => x.trim()).filter(Boolean))]
    if (!uniq.length) return
    const ex = groups.find((g) => g.group === group)
    if (ex) ex.items = [...new Set([...ex.items, ...uniq])]
    else groups.push({ group, items: uniq })
  }
  if (Array.isArray(extensions)) {
    for (const e of extensions) {
      if (!e || typeof e !== 'object') continue
      if ('title' in e && Array.isArray((e as any).items)) {
        add(
          clean((e as any).title) || 'Khác',
          (e as any).items.map((it: any) => (typeof it === 'string' ? it : clean(it?.value) || clean(it?.title) || '')).filter(Boolean),
        )
        continue
      }
      for (const [k, v] of Object.entries(e as Record<string, unknown>)) {
        if (Array.isArray(v)) add(prettyGroup(k), v.map((x) => clean(x) || '').filter(Boolean))
      }
    }
  }
  if (serviceOptions && typeof serviceOptions === 'object') {
    const LABEL: Record<string, string> = {
      dine_in: 'Ăn tại chỗ',
      takeout: 'Mua mang đi',
      delivery: 'Giao hàng',
      curbside_pickup: 'Nhận hàng tại lề đường',
      in_store_pickup: 'Nhận tại cửa hàng',
      in_store_shopping: 'Mua tại cửa hàng',
      onsite_services: 'Dịch vụ tại chỗ',
      online_appointments: 'Hẹn trực tuyến',
      no_contact_delivery: 'Giao hàng không tiếp xúc',
    }
    const items = Object.entries(serviceOptions as Record<string, unknown>)
      .filter(([, v]) => v === true)
      .map(([k]) => LABEL[k] || k.replace(/_/g, ' '))
    add(GROUP_VI.service_options, items)
  }
  return groups
}

export function histogramToDist(raw: unknown): Record<string, number> | null {
  const out: Record<string, number> = {}
  if (Array.isArray(raw)) {
    for (const r of raw) {
      const s = num((r as any)?.stars)
      const a = num((r as any)?.amount)
      if (s != null && a != null && s >= 1 && s <= 5) out[String(s)] = a
    }
  } else if (raw && typeof raw === 'object') {
    for (const k of ['1', '2', '3', '4', '5']) {
      const n = num((raw as any)[k])
      if (n != null) out[k] = n
    }
  }
  return Object.keys(out).length ? out : null
}

export function qaFrom(raw: unknown): GbpQaItem[] | null {
  if (raw == null) return null
  const list = Array.isArray(raw) ? raw : [raw]
  const out: GbpQaItem[] = []
  for (const x of list) {
    const q = clean((x as any)?.question?.text)
    if (!q) continue
    out.push({
      question: q.slice(0, 300),
      answer: clean((x as any)?.answer?.text)?.slice(0, 500) ?? null,
      question_age_days: parseRelativeAgeDays(clean((x as any)?.question?.date)),
      total_answers: num((x as any)?.total_answers),
    })
  }
  return out
}

/** Khóa ổn định của review (không chứa tên người viết dạng rõ) — cùng ý tưởng với lib/gbp-outscraper.ts mapReviews. */
export function reviewKey(parts: Array<string | number | null | undefined>): string {
  return createHash('sha1').update(parts.map((p) => p ?? '').join('|')).digest('hex').slice(0, 24)
}

/** 1 review của SerpApi/SearchApi -> GbpReviewItem. */
export function toReview(
  r: any,
  opts: { text: unknown; reply: unknown; replyDate: unknown; replyIso: unknown },
  now: number,
): GbpReviewItem | null {
  const rating = num(r?.rating)
  if (rating == null) return null
  const d = parseAnyDate(r?.iso_date, now) ?? parseAnyDate(r?.date, now)
  const days = d ? ageDays(d.ms, now) : null
  const text = (clean(opts.text) || '').slice(0, 800)
  const reply = clean(opts.reply)
  const rd = parseAnyDate(opts.replyIso ?? opts.replyDate, now)
  return {
    rating,
    text,
    relative_time: relativeVi(days),
    age_days_est: days,
    posted_at: d && d.exact ? new Date(d.ms).toISOString() : null,
    reply: reply ? reply.slice(0, 800) : null,
    reply_relative_time: reply && rd ? relativeVi(ageDays(rd.ms, now)) : null,
    key: reviewKey([clean(r?.review_id), clean(r?.user?.name), d?.ms ?? '', rating, text.slice(0, 120)]),
  }
}

export function capReviews(items: GbpReviewItem[]): GbpReviewItem[] {
  return items.slice(0, GBP_SNAPSHOT_MAX_REVIEWS)
}

/** Link hành động (menu/đặt lịch/đặt món) từ place result. */
export function actionLinksFrom(p: any): GbpActionLink[] {
  const out: GbpActionLink[] = []
  const add = (kind: string, label: string, url: unknown) => {
    const u = clean(url)
    if (u && /^https?:\/\//i.test(u) && !out.some((x) => x.kind === kind)) out.push({ kind, label, url: u })
  }
  add('menu', 'Thực đơn', p?.menu?.link ?? p?.menu_link ?? (typeof p?.menu === 'string' ? p.menu : null))
  add('order', 'Đặt món', p?.order_online_link ?? p?.order_online)
  add('booking', 'Đặt lịch hẹn', p?.book_online ?? p?.booking_link ?? p?.reservations_link ?? p?.reservation_link)
  return out
}
