/**
 * Schema cố định cho snapshot GBP public (Giai đoạn A).
 * Dùng chung cho browser extract, API response, Audit prompt.
 */

export type GbpPostItem = {
  text: string
  approx_date?: string | null
  raw?: string | null
}

/**
 * 1 review thật lấy qua Places API (New) field `reviews` — API CHÍNH THỨC
 * của Google, không phải scrape. Giới hạn đã biết của chính API này (không
 * phải do ta thu hẹp): chỉ trả tối đa ~5 review "liên quan nhất" theo thuật
 * toán của Google (không chắc là mới nhất, không phải toàn bộ), và KHÔNG
 * bao gồm nội dung chủ doanh nghiệp đã phản hồi (`reply`) — trường đó chỉ
 * có qua Google Business Profile API (cần OAuth + khách xác minh quyền sở
 * hữu hồ sơ), ngoài phạm vi snapshot public này. Vì vậy `reply` để sẵn
 * trong type cho tương lai nhưng Data Collector hiện tại sẽ luôn để trống.
 */
export type GbpReviewItem = {
  rating: number
  text: string
  relative_time?: string | null
  /** Luôn null ở nguồn Places API — xem ghi chú ở trên. */
  reply?: string | null
}

export type GbpSnapshotPayload = {
  place_id?: string | null
  maps_url?: string | null
  business_name?: string | null
  description?: string | null
  primary_category?: string | null
  additional_categories?: string | null
  opening_hours?: string | null
  rating?: number | null
  review_count?: number | null
  phone?: string | null
  website_url?: string | null
  address_text?: string | null
  posts_signal?: string | null
  recent_posts?: GbpPostItem[]
  photos_signal?: string | null
  photos_count_est?: number | null
  /** Review thật (tối đa ~5, do giới hạn Places API) — xem GbpReviewItem. */
  reviews?: GbpReviewItem[]
}

export type GbpSnapshotStatus = 'pending' | 'running' | 'ok' | 'partial' | 'failed'

/** TTL cache: không chạy browser lại nếu snapshot ok còn hạn (ngày). */
export const GBP_SNAPSHOT_CACHE_DAYS = 7

/** Số bài đăng tối đa lưu trong recent_posts. */
export const GBP_SNAPSHOT_MAX_POSTS = 5
