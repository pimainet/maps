import type { CheckGroup } from './types'

/** Tên nhóm hiển thị cho chủ cửa hàng (không dùng thuật ngữ SEO). */
export const GROUP_LABEL_VI: Record<CheckGroup, string> = {
  foundation: 'Nền tảng hồ sơ',
  relevance: 'Đúng ngành & dịch vụ',
  trust: 'Uy tín & đánh giá',
  visual: 'Hình ảnh',
  content: 'Bài đăng & nội dung',
  visibility: 'Hiện ra khi khách tìm',
  conversion: 'Khách liên hệ dễ dàng',
}

/** Tên check bằng tiếng thường. Check chưa có trong bảng thì dùng label gốc của engine. */
export const CHECK_LABEL_VI: Record<string, string> = {
  F01: 'Hồ sơ Google tồn tại',
  F02: 'Trạng thái hồ sơ',
  F03: 'Tên doanh nghiệp',
  F04: 'Địa chỉ',
  F05: 'Số điện thoại',
  F06: 'Website',
  F07: 'Giờ mở cửa',
  R01: 'Danh mục chính',
  R02: 'Danh mục phụ',
  R03: 'Dịch vụ / sản phẩm',
  R04: 'Mô tả doanh nghiệp',
  R05: 'Tiện ích & thuộc tính',
  T01: 'Số lượng đánh giá so với đối thủ',
  T02: 'Điểm sao so với đối thủ',
  T03: 'Đánh giá mới gần đây',
  T04: 'Đà tăng đánh giá',
  T05: 'Chủ phản hồi đánh giá',
  T06: 'Khách khen / chê điều gì',
  V01: 'Số lượng ảnh',
  V02: 'Ảnh mới gần đây',
  V03: 'Ảnh đa dạng',
  V04: 'Chất lượng ảnh',
  C01: 'Có đăng bài',
  C02: 'Bài đăng mới gần đây',
  C03: 'Bài đăng đa dạng',
  C04: 'Chất lượng bài đăng',
  VY01: 'Thứ hạng khi khách tìm',
  VY02: 'Độ phủ từ khóa',
  VY03: 'So với đối thủ cùng khu vực',
  VY04: 'Hiện ở các khu vực xung quanh',
  CV01: 'Thông tin đầy đủ để khách quyết định',
  CV02: 'Hồ sơ tạo được niềm tin',
  CV03: 'Dịch vụ nói rõ ràng',
  CV04: 'Khách gọi / chỉ đường dễ',
}

export const checkLabelVi = (id: string, fallback: string): string => CHECK_LABEL_VI[id] || fallback
