/**
 * Phân loại 1 task thành "bot tự làm được" hay "cần khách tự làm, có hướng
 * dẫn". Dựa trên taxonomy `task_type` đã có sẵn trong hệ thống
 * (content | profile_update | photo | review | other — xem
 * app/api/tasks/generate-from-plan/route.ts).
 *
 * Nguyên tắc chọn: CHỈ tự động hoá việc có thể HOÀN TÁC DỄ DÀNG và ÍT RỦI
 * RO nếu AI hiểu sai ý (đăng 1 bài marketing xoá được, sửa category/địa chỉ
 * sai thì ảnh hưởng tìm kiếm thật và trông bất thường với Google nếu bot tự
 * đổi liên tục) — không phải giới hạn kỹ thuật của Business Profile API
 * (API thực ra CÓ hỗ trợ sửa category/giờ/địa chỉ qua Business Information
 * API). Đây là lựa chọn sản phẩm có chủ đích, có thể mở rộng dần sau.
 */

export type TaskActionType = 'auto_post' | 'manual_guided'

export interface TaskGuidance {
  actionType: TaskActionType
  /** Vì sao KHÔNG tự động — chỉ có khi actionType = 'manual_guided'. Hiện cho khách thấy khi họ hỏi "sao không tự làm luôn". */
  whyManual?: string
  /** Các bước hướng dẫn, hiện khi khách bấm vào task loại manual_guided. */
  steps?: string[]
}

const GUIDANCE: Record<string, TaskGuidance> = {
  content: {
    actionType: 'auto_post',
  },
  profile_update: {
    actionType: 'manual_guided',
    whyManual:
      'Đây là thông tin định danh doanh nghiệp (tên, địa chỉ, danh mục...). Để đảm bảo đúng với thực tế và tránh Google đánh dấu bất thường nếu bị sửa tự động nhiều lần, chúng tôi để bạn tự xác nhận thay đổi này.',
    steps: [
      'Mở Google Maps hoặc Google Business Profile trên điện thoại/máy tính.',
      'Vào mục "Sửa hồ sơ" (Edit profile) ở doanh nghiệp của bạn.',
      'Tìm đúng mục cần sửa theo mô tả công việc này và cập nhật.',
      'Lưu lại — thay đổi thường hiện ngay, một số mục Google có thể duyệt lại trong vài ngày.',
    ],
  },
  photo: {
    actionType: 'manual_guided',
    whyManual:
      'Ảnh cần đúng người, đúng không gian thật của bạn — hệ thống chưa tự tải ảnh thay bạn được. Việc này cũng dễ làm trực tiếp trên điện thoại khi bạn đang ở cửa hàng.',
    steps: [
      'Mở app Google Maps trên điện thoại, vào hồ sơ doanh nghiệp của bạn.',
      'Bấm biểu tượng camera / "Thêm ảnh".',
      'Chọn đúng loại ảnh theo gợi ý trong mô tả công việc (mặt tiền, không gian trong, sản phẩm, đội ngũ...).',
      'Đăng — ảnh thường hiện công khai sau vài phút tới vài giờ.',
    ],
  },
  review: {
    actionType: 'manual_guided',
    whyManual:
      'Hệ thống hiện chỉ nhắc bạn có review cần phản hồi, chưa tự soạn + gửi câu trả lời thay bạn — vì phản hồi cần đúng giọng điệu và ngữ cảnh riêng của bạn với từng khách.',
    steps: [
      'Mở Google Maps hoặc Google Business Profile, vào mục "Đánh giá" (Reviews).',
      'Tìm review được nhắc trong mô tả công việc này.',
      'Bấm "Trả lời" (Reply) và viết phản hồi — lịch sự, cụ thể, có hướng giải quyết nếu là review tiêu cực.',
    ],
  },
  description_update: {
    actionType: 'auto_post',
  },
  other: {
    actionType: 'manual_guided',
    whyManual: 'Việc này cần bạn tự xem xét và quyết định cách làm phù hợp nhất với tình hình thực tế của doanh nghiệp.',
    steps: ['Đọc kỹ mô tả công việc.', 'Thực hiện trực tiếp trên Google Maps/Business Profile nếu liên quan tới hồ sơ.'],
  },
}

const DEFAULT_GUIDANCE: TaskGuidance = GUIDANCE.other

export function getTaskGuidance(taskType: string): TaskGuidance {
  return GUIDANCE[taskType] ?? DEFAULT_GUIDANCE
}

export function isAutoExecutable(taskType: string): boolean {
  return getTaskGuidance(taskType).actionType === 'auto_post'
}
