/**
 * Tóm tắt snapshot GBP (payload hoặc dòng DB) để hiện cho người dùng sau khi audit ("dữ liệu Google Maps đã dùng").
 * File THUẦN (không import server) nên test được bằng fixture (scripts/test-audit-fields.ts).
 * (Phần dựng prompt cho engine cũ v1 đã bị gỡ — engine v2 đọc thẳng snapshot có cấu trúc.)
 */

const SECTION_LABEL: Record<string, string> = {
  overview: 'Tổng quan',
  hours: 'Giờ mở cửa',
  about: 'Giới thiệu',
  services: 'Dịch vụ/Menu',
  reviews: 'Bài đánh giá',
  updates: 'Cập nhật/bài đăng',
  photos: 'Ảnh',
}

function clip(s: unknown, n: number): string {
  return String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n)
}

export type SnapshotSummary = {
  business_name: string | null
  rating: number | null
  review_count: number | null
  reviews_loaded: number
  posts_count: number
  has_description: boolean
  has_hours: boolean
  /** Các mục KHÔNG đọc được (nhãn tiếng Việt) — để người dùng biết đâu là "chưa lấy được" chứ không phải "hồ sơ thiếu". */
  unread: string[]
  warnings: string[]
}

/** Tóm tắt ngắn những gì đã lấy được, hiển thị cho người dùng sau khi audit. */
export function summarizeSnapshot(snapshot: any): SnapshotSummary {
  const s = snapshot || {}
  const sections: Record<string, string> = s.coverage?.sections || {}
  return {
    business_name: s.business_name || null,
    rating: s.rating != null ? Number(s.rating) : null,
    review_count: s.review_count != null ? Number(s.review_count) : null,
    reviews_loaded: s.coverage?.reviews_loaded ?? (Array.isArray(s.reviews) ? s.reviews.length : 0),
    posts_count: Array.isArray(s.recent_posts) ? s.recent_posts.length : 0,
    has_description: Boolean(s.description),
    has_hours: Boolean(s.opening_hours || s.hours_today),
    unread: Object.keys(sections)
      .filter((k) => sections[k] === 'error' || sections[k] === 'skipped')
      .map((k) => SECTION_LABEL[k] || k),
    warnings: Array.isArray(s.coverage?.warnings) ? s.coverage.warnings.slice(0, 4).map((w: any) => clip(w, 200)) : [],
  }
}
