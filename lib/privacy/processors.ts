/**
 * Danh sách bên xử lý / bên thứ ba nhận dữ liệu (hiển thị ở /privacy và docs/DATA_PROTECTION.md).
 * "Quốc gia" = nơi pháp nhân đăng ký / vùng xử lý theo cấu hình hiện tại — kiểm lại khi đổi cấu hình.
 * Các điểm đánh dấu "(cần kiểm tra)" chưa xác minh được từ nguồn chính thức tại thời điểm viết (28/11/2026).
 */
export type Processor = {
  name: string
  entity: string
  country: string
  purpose: string
  data: string
  retention: string
}

export const PROCESSORS: Processor[] = [
  {
    name: 'Supabase',
    entity: 'Supabase Inc. (Hoa Kỳ)',
    country: 'Singapore (máy chủ AWS ap-southeast-1)',
    purpose: 'Cơ sở dữ liệu, xác thực đăng nhập, lưu ảnh',
    data: 'Toàn bộ dữ liệu tài khoản và dữ liệu doanh nghiệp trong ứng dụng',
    retention: 'Theo thời hạn của từng loại dữ liệu ở mục 6',
  },
  {
    name: 'Vercel',
    entity: 'Vercel Inc. (Hoa Kỳ)',
    country: 'Hoa Kỳ (vùng chạy mặc định; cần kiểm tra cấu hình dự án)',
    purpose: 'Chạy ứng dụng web, nhật ký truy cập kỹ thuật',
    data: 'Địa chỉ IP, trình duyệt, đường dẫn truy cập; dữ liệu đi qua khi xử lý yêu cầu',
    retention: 'Nhật ký theo chính sách của Vercel (ngắn hạn)',
  },
  {
    name: 'Anthropic (Claude)',
    entity: 'Anthropic PBC (Hoa Kỳ)',
    country: 'Hoa Kỳ',
    purpose: 'AI phân tích hồ sơ, viết nội dung, soạn trả lời review',
    data: 'Thông tin doanh nghiệp, nội dung review công khai (không gửi email/mật khẩu người dùng)',
    retention: 'Theo chính sách API của Anthropic; chúng tôi không dùng để huấn luyện mô hình',
  },
  {
    name: 'Resend',
    entity: 'Resend (Plus Five Five, Inc., Hoa Kỳ)',
    country: 'Hoa Kỳ',
    purpose: 'Gửi email nhắc việc, biên nhận, thông báo',
    data: 'Email, tên, nội dung email',
    retention: 'Nhật ký gửi theo chính sách Resend',
  },
  {
    name: 'Google (Places API, Business Profile API, đăng nhập Google)',
    entity: 'Google LLC (Hoa Kỳ)',
    country: 'Hoa Kỳ / toàn cầu',
    purpose: 'Đọc hồ sơ doanh nghiệp, đăng bài/ trả lời review khi bạn kết nối, đăng nhập bằng Google',
    data: 'place_id, tên doanh nghiệp, mã truy cập Google (đã mã hoá), email tài khoản Google đã kết nối',
    retention: 'place_id lưu lâu dài; toạ độ từ Places tối đa 30 ngày; nội dung Google khác không lưu lâu',
  },
  {
    name: 'Outscraper',
    entity: 'Outscraper (Bee Cave, Texas, Hoa Kỳ)',
    country: 'Hoa Kỳ',
    purpose: 'Đọc dữ liệu công khai trên Google Maps của doanh nghiệp (thông tin, review)',
    data: 'Link/tên doanh nghiệp gửi đi; nhận về dữ liệu công khai gồm review',
    retention: 'Payload thô không lưu; review tóm tắt 30 ngày',
  },
  {
    name: 'SerpApi',
    entity: 'SerpApi, LLC (Austin, Texas, Hoa Kỳ)',
    country: 'Hoa Kỳ',
    purpose: 'Đọc bài đăng, hỏi–đáp, review công khai trên Google Maps',
    data: 'place_id / tên doanh nghiệp gửi đi',
    retention: 'Payload thô không lưu',
  },
  {
    name: 'SearchApi',
    entity: 'SearchApi, LLC (New York, Hoa Kỳ)',
    country: 'Hoa Kỳ',
    purpose: 'Nguồn dự phòng đọc dữ liệu công khai Google Maps',
    data: 'place_id / tên doanh nghiệp gửi đi',
    retention: 'Payload thô không lưu',
  },
  {
    name: 'DataForSEO',
    entity: 'DataForSEO OÜ (Estonia, EU)',
    country: 'Estonia (EU); đội vận hành tại Ukraine',
    purpose: 'Đo thứ hạng Google Maps theo lưới vị trí, bù mã CID',
    data: 'Từ khoá, toạ độ doanh nghiệp, tên doanh nghiệp',
    retention: 'Kết quả thứ hạng lưu trong ứng dụng đến khi xoá doanh nghiệp',
  },
  {
    name: 'SePay',
    entity: 'SePay (Việt Nam; cần kiểm tra tên pháp nhân trên hợp đồng)',
    country: 'Việt Nam',
    purpose: 'Nhận thông báo chuyển khoản ngân hàng để kích hoạt gói',
    data: 'Số tiền, nội dung chuyển khoản, tên/số tài khoản người chuyển (nếu ngân hàng cung cấp)',
    retention: '10 năm (chứng từ kế toán)',
  },
  {
    name: 'Make',
    entity: 'Make (Celonis), Cộng hoà Séc',
    country: 'EU hoặc Hoa Kỳ tuỳ vùng tài khoản (cần kiểm tra)',
    purpose: 'Tự động đăng bài và đăng trả lời review lên Google Business Profile',
    data: 'Nội dung bài/ảnh/trả lời, mã định danh hồ sơ Google',
    retention: 'Nhật ký chạy theo chính sách Make',
  },
]
