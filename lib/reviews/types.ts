// Kiểu dữ liệu dùng chung của hộp thư review. Thuần (không đụng DB/mạng).

export const REVIEW_STATUSES = [
  'new', // mới thấy, chưa có bản nháp
  'drafted', // đã có bản nháp (AI hoặc người sửa), chờ duyệt
  'approved', // đã duyệt nội dung; chờ Make đăng (nếu nối Make) hoặc chờ copy dán
  'posting', // Make đang đăng (đã khoá)
  'posted', // đã đăng lên Google qua API
  'manual_copied', // người dùng báo đã copy và dán tay trên Google
  'ignored', // bỏ qua, không phản hồi
  'replied_elsewhere', // nguồn dữ liệu thấy chủ đã phản hồi ngoài hệ thống
  'failed', // Make đăng lỗi quá số lần thử
] as const
export type ReviewStatus = (typeof REVIEW_STATUSES)[number]

export const OPEN_STATUSES: ReviewStatus[] = ['new', 'drafted', 'approved', 'posting', 'failed']
export const DONE_STATUSES: ReviewStatus[] = ['posted', 'manual_copied', 'ignored', 'replied_elsewhere']

export type ReviewSource = 'outscraper' | 'serpapi' | 'searchapi' | 'gbp' | 'snapshot' | 'legacy'
export type Sentiment = 'positive' | 'neutral' | 'negative' | 'mixed'
export type Urgency = 'high' | 'normal' | 'low'

/** 1 review lấy từ 1 nguồn, đã chuẩn hoá — đầu vào cho bước ghi (lib/reviews/ingest.ts). */
export type IncomingReview = {
  source: ReviewSource
  source_review_id: string | null
  gbp_review_name?: string | null
  author_name: string | null
  rating: number
  text: string
  reviewed_at: string | null
  reviewed_at_exact: boolean
  relative_time?: string | null
  /** Phản hồi của chủ đang hiện. undefined = nguồn không cho biết; null = nguồn khẳng định chưa có phản hồi. */
  owner_reply?: string | null
  owner_reply_at?: string | null
}

/** Bản ghi client_reviews (các cột code dùng). */
export type ReviewRow = {
  id: string
  workspace_id: string
  client_id: string
  review_key: string
  source: ReviewSource
  source_review_id: string | null
  gbp_review_name: string | null
  author_name: string | null
  rating: number
  review_text: string | null
  reviewed_at: string | null
  reviewed_at_exact: boolean
  relative_time: string | null
  owner_reply: string | null
  owner_reply_at: string | null
  reply_source: string | null
  sentiment: Sentiment | null
  urgency: Urgency
  topics: string[]
  ai_summary: string | null
  draft_reply: string | null
  draft_warnings: string[]
  drafted_at: string | null
  draft_count: number
  final_reply: string | null
  approved_at: string | null
  approved_via: 'dashboard' | 'owner_link' | 'agency' | null
  status: ReviewStatus
  status_changed_at: string
  post_attempts: number
  posting_locked_at: string | null
  posted_at: string | null
  gbp_reply_state: string | null
  post_error: string | null
  task_id: string | null
  first_seen_at: string
  last_seen_at: string
}
