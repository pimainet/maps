/**
 * Feature flags dùng chung cho cả client lẫn server.
 *
 * AUTO_POST_ENABLED = false  -> ẩn toàn bộ tính năng kho ảnh, link upload,
 * API xử lý/đăng bài (bot tự đăng lên Google Maps) và khối kết nối Google
 * Business Profile. Các việc nội dung chuyển sang dạng hướng dẫn thủ công.
 * Muốn bật lại: đổi thành true, đặt AUTOPOST_SECRET, rồi redeploy.
 */
export const AUTO_POST_ENABLED = false
