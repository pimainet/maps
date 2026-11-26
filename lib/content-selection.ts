// Chọn công việc cần AI soạn nội dung. Thuần logic (không DB) để kiểm thử được.
import { isContentTaskType } from './task-types'

export type SelectableTask = {
  id: string
  task_type?: string | null
  plan_id?: string | null
  created_at: string
}

/**
 * Lọc việc cần soạn nội dung CỦA ĐÚNG MỘT KẾ HOẠCH.
 * `planId` bắt buộc truyền (string hoặc null) để người gọi luôn phải quyết định phạm vi:
 *  - string: chỉ việc thuộc kế hoạch đó;
 *  - null: chỉ việc không gắn kế hoạch nào (dữ liệu cũ).
 * `onlyTaskIds` (tùy chọn): giới hạn thêm vào đúng các việc này (vd. các việc vừa tạo),
 * để việc tồn đọng cũ không bị viết thay.
 * Không bao giờ lấy việc của kế hoạch khác.
 */
export function pickUnwrittenContentTasks<T extends SelectableTask>(
  tasks: T[],
  writtenTaskIds: ReadonlySet<string>,
  planId: string | null,
  onlyTaskIds?: ReadonlySet<string>
): T[] {
  const scope = planId ?? null
  return tasks
    .filter(
      (t) =>
        isContentTaskType(t.task_type) &&
        !writtenTaskIds.has(t.id) &&
        (t.plan_id ?? null) === scope &&
        (!onlyTaskIds || onlyTaskIds.has(t.id))
    )
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
}
