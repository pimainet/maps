/**
 * Schema cố định cho snapshot GBP public (Giai đoạn A).
 * Dùng chung cho browser extract, API response, Audit prompt.
 */

export type GbpPostItem = {
  text: string
  approx_date?: string | null
  raw?: string | null
}

export type GbpSnapshotPayload = {
  place_id?: string | null
  maps_url?: string | null
  business_name?: string | null
  description?: string | null
  primary_category?: string | null
  rating?: number | null
  review_count?: number | null
  phone?: string | null
  website_url?: string | null
  address_text?: string | null
  posts_signal?: string | null
  recent_posts?: GbpPostItem[]
  photos_signal?: string | null
  photos_count_est?: number | null
}

export type GbpSnapshotStatus = 'pending' | 'running' | 'ok' | 'partial' | 'failed'

/** TTL cache: không chạy browser lại nếu snapshot ok còn hạn (ngày). */
export const GBP_SNAPSHOT_CACHE_DAYS = 7

/** Số bài đăng tối đa lưu trong recent_posts. */
export const GBP_SNAPSHOT_MAX_POSTS = 5
