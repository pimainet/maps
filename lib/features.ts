/**
 * Feature flags dùng chung cho cả client lẫn server.
 *
 * AUTO_POST_ENABLED = false  -> ẩn toàn bộ tính năng kho ảnh, link upload,
 * API xử lý/đăng bài (bot tự đăng lên Google Maps) và khối kết nối Google
 * Business Profile. Các việc nội dung chuyển sang dạng hướng dẫn thủ công.
 * Muốn bật lại: đổi thành true, đặt AUTOPOST_SECRET, rồi redeploy.
 */
export const AUTO_POST_ENABLED = false

/**
 * RANK_GRID_ENABLED (mặc định TẮT) -> lưới thứ hạng + bản đồ nhiệt (trang /clients/[id]/rank, API /api/rankgrid*,
 * cron rankgrid-*, VY02/VY04 trong audit). Bật bằng biến môi trường NEXT_PUBLIC_RANK_GRID_ENABLED=true trên Vercel
 * rồi redeploy (biến NEXT_PUBLIC_ được nhúng lúc build nên dùng được cả ở trình duyệt lẫn server).
 * Trước khi bật: chạy migration 027 và đặt DATAFORSEO_LOGIN/DATAFORSEO_PASSWORD + RANKGRID_PINGBACK_SECRET.
 */
export const RANK_GRID_ENABLED = process.env.NEXT_PUBLIC_RANK_GRID_ENABLED === 'true'

/**
 * REVIEW_INBOX_ENABLED (mặc định TẮT) -> hộp thư review: trang /clients/[id]/reviews, link duyệt /r/<token>,
 * API /api/reviews/* và /api/public/reviews. Bật bằng NEXT_PUBLIC_REVIEW_INBOX_ENABLED=true rồi redeploy.
 * Trước khi bật: chạy migration 029_review_inbox.sql (và có ANTHROPIC_API_KEY để soạn nháp).
 * Cron tự lấy review (tốn credit) cần THÊM REVIEW_WATCH_ENABLED=true (chỉ đọc ở server).
 */
export const REVIEW_INBOX_ENABLED = process.env.NEXT_PUBLIC_REVIEW_INBOX_ENABLED === 'true'

export function reviewWatchCronOn(): boolean {
  return REVIEW_INBOX_ENABLED && process.env.REVIEW_WATCH_ENABLED === 'true'
}

/**
 * DONE_FOR_YOU_ENABLED (mặc định TẮT) -> gói "Làm hộ" (2.490.000đ/tháng): thẻ gói + form "Liên hệ tư vấn" trên /billing,
 * hàng đợi công việc của nhân viên (/agency), tạo đơn cho khách (/api/admin/billing/orders), báo cáo tháng.
 * Bật bằng NEXT_PUBLIC_DONE_FOR_YOU_ENABLED=true rồi redeploy. Trước khi bật: chạy migration 032_done_for_you.sql.
 * Từng phần của hàng đợi vẫn theo cờ riêng: bài tự đăng cần AUTO_POST_ENABLED, phản hồi review cần REVIEW_INBOX_ENABLED,
 * báo cáo thứ hạng cần RANK_GRID_ENABLED.
 */
export const DONE_FOR_YOU_ENABLED = process.env.NEXT_PUBLIC_DONE_FOR_YOU_ENABLED === 'true'
