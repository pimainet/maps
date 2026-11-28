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
