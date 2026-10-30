/**
 * Schema cố định cho snapshot GBP public.
 * Dùng chung cho browser extract, API response, Audit prompt, Audit engine.
 *
 * v2 (agent đọc sâu): thêm services, attributes, action_links, review_stats,
 * rating_distribution, business_status, claim_signal, photo_categories và
 * `coverage` — bản đồ cho biết agent ĐÃ đọc được phần nào / KHÔNG đọc được phần nào,
 * để audit không nhầm "agent chưa lấy được" với "hồ sơ thật sự thiếu".
 */

export type GbpPostItem = {
  text: string
  approx_date?: string | null
  raw?: string | null
}

/**
 * 1 review. Hai nguồn:
 *  - Browser (tab Bài đánh giá, sắp xếp Mới nhất): tối đa ~30 review, CÓ ngày + CÓ phản hồi của chủ.
 *  - Places API (New): tối đa ~5 review "liên quan nhất", KHÔNG có phản hồi của chủ.
 * Browser ưu tiên; Places chỉ là fallback khi browser không lấy được review.
 */
export type GbpReviewItem = {
  rating: number
  text: string
  relative_time?: string | null
  /** Tuổi review tính theo ngày, suy từ relative_time (tháng = 30 ngày, năm = 365). null nếu không parse được. */
  age_days_est?: number | null
  /** Nội dung chủ doanh nghiệp phản hồi. null = không thấy phản hồi (với nguồn Places: luôn null, không có nghĩa là chưa phản hồi). */
  reply?: string | null
  reply_relative_time?: string | null
}

export type GbpAttributeGroup = { group: string; items: string[] }

export type GbpActionLink = {
  /** vd: website, menu, booking, order, appointment, other */
  kind: string
  label?: string | null
  url?: string | null
}

export type GbpBusinessStatus =
  | 'operational'
  | 'temporarily_closed'
  | 'permanently_closed'
  | 'unknown'

/** 'unclaimed' = thấy nút "Nhận quyền sở hữu". 'unknown' = không thấy, KHÔNG có nghĩa đã được xác minh. */
export type GbpClaimSignal = 'unclaimed' | 'unknown'

/** Thống kê review tính từ danh sách review browser đã tải (sắp xếp mới nhất). */
export type GbpReviewStats = {
  loaded: number
  with_text: number
  newest_age_days: number | null
  oldest_age_days: number | null
  /** Số review trong 30 / 90 ngày gần nhất NẾU window_complete = true; ngược lại là cận dưới. */
  last_30d: number | null
  last_90d: number | null
  /** true khi review cũ nhất đã tải còn cũ hơn 90 ngày -> đếm 30d/90d là đủ, không bị cắt cụt. */
  window_complete: boolean
  replied: number
  reply_rate: number | null
  avg_rating_loaded: number | null
  low_rating_count: number
}

export type GbpCoverageStatus = 'ok' | 'empty' | 'not_found' | 'error' | 'skipped'

export type GbpCoverage = {
  /** overview | hours | about | services | reviews | updates | photos */
  sections: Record<string, GbpCoverageStatus>
  tabs_found: string[]
  reviews_loaded: number
  photos_counted?: number | null
  photos_capped?: boolean
  identity?: 'matched' | 'ambiguous' | 'unverified'
  warnings: string[]
  elapsed_ms: number
  depth: 'quick' | 'deep'
}

export type GbpSnapshotPayload = {
  place_id?: string | null
  maps_url?: string | null
  business_name?: string | null
  description?: string | null
  primary_category?: string | null
  /**
   * Chỉ điền khi trang Maps HIỂN THỊ danh mục phụ. Giao diện công khai của Maps thường chỉ
   * hiện danh mục chính; danh mục phụ chuẩn chỉ có qua Business Profile API (OAuth).
   * `types` của Places API KHÔNG phải danh mục phụ của hồ sơ nên không được đưa vào đây.
   */
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
  reviews?: GbpReviewItem[]

  // ---- v2 ----
  services?: string[]
  attributes?: GbpAttributeGroup[]
  action_links?: GbpActionLink[]
  business_status?: GbpBusinessStatus | null
  claim_signal?: GbpClaimSignal | null
  /** { '5': 120, '4': 30, ... } lấy từ biểu đồ phân bố sao ở tab Bài đánh giá. */
  rating_distribution?: Record<string, number> | null
  review_stats?: GbpReviewStats | null
  photo_categories?: string[]
  coverage?: GbpCoverage | null
}

export type GbpSnapshotStatus = 'pending' | 'running' | 'ok' | 'partial' | 'failed'

/** TTL cache: không chạy browser lại nếu snapshot ok còn hạn (ngày). */
export const GBP_SNAPSHOT_CACHE_DAYS = 7

/** Số bài đăng tối đa lưu trong recent_posts. */
export const GBP_SNAPSHOT_MAX_POSTS = 8

/** Số review tối đa agent tải ở chế độ deep. */
export const GBP_SNAPSHOT_MAX_REVIEWS = 30
