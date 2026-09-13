// Hằng số dùng chung cho các trang trong khu vực dashboard.
// Tách ra khỏi app/page.tsx (trước đây định nghĩa trực tiếp trong 1 file 2200+ dòng).

export const statusMap: Record<string, { label: string; className: string }> = {
  active: { label: 'Đang hoạt động', className: 'status-success' },
  paused: { label: 'Tạm dừng', className: 'status-warning' },
  stopped: { label: 'Đã dừng', className: 'status-muted' },
  waiting_approval: { label: 'Chờ duyệt', className: 'status-warning' },
  drafted: { label: 'Bản nháp', className: 'status-info' },
  approved: { label: 'Đã duyệt', className: 'status-success' },
  published: { label: 'Đã đăng', className: 'status-success' },
  idea: { label: 'Ý tưởng', className: 'status-muted' },
  pending: { label: 'Đang chờ', className: 'status-warning' },
  done: { label: 'Hoàn thành', className: 'status-success' },
  skipped: { label: 'Bỏ qua', className: 'status-muted' },
}

export const PRESET_LANGUAGES = ['Tiếng Việt', 'English', '日本語', '한국어', 'ภาษาไทย', 'Bahasa Indonesia', '中文']

export const TASK_TYPE_LABEL: Record<string, string> = {
  content: 'Nội dung',
  profile_update: 'Hồ sơ GBP',
  photo: 'Hình ảnh',
  review: 'Đánh giá',
  other: 'Khác',
}

export const PRIORITY_LABEL: Record<string, string> = {
  high: 'Cao',
  medium: 'Trung bình',
  low: 'Thấp',
}
