/**
 * Schema cố định cho snapshot GBP public.
 * Dùng chung cho nguồn Outscraper / Places, API response, Audit prompt, Audit engine.
 *
 * `coverage` cho biết ĐÃ đọc được phần nào / KHÔNG đọc được phần nào,
 * để audit không nhầm "chưa lấy được" với "hồ sơ thật sự thiếu".
 */

export type GbpPostItem = {
  text: string
  approx_date?: string | null
  raw?: string | null
}

/**
 * 1 review. Hai nguồn:
 *  - Outscraper (reviews-v3, sắp xếp Mới nhất): tối đa ~30 review, CÓ ngày + phản hồi của chủ (nếu Outscraper trả về).
 *  - Places API (New): tối đa ~5 review "liên quan nhất", KHÔNG có phản hồi của chủ.
 * Outscraper ưu tiên; Places chỉ là dự phòng khi Outscraper không lấy được review.
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
  /** Thời điểm đăng (ISO, UTC) — chỉ có với nguồn Outscraper. */
  posted_at?: string | null
  /** Khóa định danh ổn định (hash, không chứa tên người viết) để Review Watch không tạo task trùng. */
  key?: string | null
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

/** 'claimed' = Outscraper báo hồ sơ đã xác minh. 'unclaimed' = thấy nút "Nhận quyền sở hữu". 'unknown' = không thấy, KHÔNG có nghĩa đã được xác minh. */
export type GbpClaimSignal = 'unclaimed' | 'claimed' | 'unknown'

/** Thống kê review tính từ danh sách review đã tải (sắp xếp mới nhất). */
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
   * Lấy từ `subtypes` của Outscraper (chưa xác minh với dữ liệu thật). Danh mục phụ chuẩn chỉ có qua
   * Business Profile API (OAuth). `types` của Places API KHÔNG phải danh mục phụ của hồ sơ nên không được đưa vào đây.
   */
  additional_categories?: string | null
  opening_hours?: string | null
  /** Trạng thái giờ hôm nay (vd "Đang mở cửa ⋅ Đóng cửa lúc 17:30"). Chỉ là bằng chứng hồ sơ CÓ khai giờ khi không đọc được bảng 7 ngày. */
  hours_today?: string | null
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
  /** { '5': 120, '4': 30, ... } phân bố sao của toàn bộ review. */
  rating_distribution?: Record<string, number> | null
  review_stats?: GbpReviewStats | null
  photo_categories?: string[]
  coverage?: GbpCoverage | null
}

export type GbpSnapshotStatus = 'pending' | 'running' | 'ok' | 'partial' | 'failed'

/** TTL cache: không gọi lại nguồn dữ liệu nếu snapshot ok còn hạn (ngày). */
export const GBP_SNAPSHOT_CACHE_DAYS = 7

/** Số bài đăng tối đa lưu trong recent_posts. */
export const GBP_SNAPSHOT_MAX_POSTS = 8

/** Số review tối đa tải ở chế độ deep. */
export const GBP_SNAPSHOT_MAX_REVIEWS = 30

// ---------------------------------------------------------------------------
// Đầu vào / đầu ra của lib/gbp-snapshot.ts
// ---------------------------------------------------------------------------

export type RunGbpSnapshotInput = {
  mapsUrl?: string
  businessName?: string
  area?: string
  placeId?: string | null
  /** 'deep' (mặc định): hồ sơ + review. 'quick': chỉ hồ sơ (không gọi reviews-v3), dùng cho demo công khai. */
  depth?: 'quick' | 'deep'
}

export type GbpSnapshotSource = 'outscraper' | 'places' | 'outscraper+places'

export type RunGbpSnapshotResult = GbpSnapshotPayload & {
  error?: string
  raw?: unknown
  source_used?: GbpSnapshotSource
}
