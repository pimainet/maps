/**
 * Danh mục loại công việc (task_type) DUY NHẤT của hệ thống.
 * Prompt AI, API chuẩn hóa, giao diện và bộ thực thi đều phải khớp danh sách này.
 * Thêm loại mới: sửa ở đây + TASK_TYPE_LABEL (lib/ui-constants.ts) + GUIDANCE (lib/task-action.ts)
 * + mô tả trong prompt tạo việc (lib/prompts.ts). scripts/test-task-types.ts sẽ báo nếu lệch.
 */
export const TASK_TYPES = [
  'content',
  'description_update',
  'profile_update',
  'photo',
  'review',
  'other',
] as const

export type TaskType = (typeof TASK_TYPES)[number]

export function isTaskType(v: unknown): v is TaskType {
  return typeof v === 'string' && (TASK_TYPES as readonly string[]).includes(v)
}

/** Chuẩn hóa giá trị AI trả về; không nhận ra thì coi là 'other'. Chịu được hoa/thường và khoảng trắng thừa. */
export function normalizeTaskType(v: unknown): TaskType {
  const s = typeof v === 'string' ? v.trim().toLowerCase() : ''
  return isTaskType(s) ? s : 'other'
}

/** Loại công việc cần AI soạn nội dung (bài đăng hoặc mô tả doanh nghiệp). */
export function isContentTaskType(v: unknown): boolean {
  return v === 'content' || v === 'description_update'
}
