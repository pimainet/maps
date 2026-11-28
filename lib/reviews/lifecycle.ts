/**
 * Vòng đời phản hồi review (thuần, test được):
 *
 *   new ──soạn nháp──> drafted ──duyệt──> approved ──Make nhận──> posting ──OK──> posted
 *    │                   │  ▲               │   │                    └─lỗi──> approved (thử lại) / failed (quá số lần)
 *    │                   │  └──bỏ duyệt─────┘   └──đã dán tay──> manual_copied
 *    └──bỏ qua──> ignored <────────────────────── (new/drafted/approved/failed)
 *   Bất kỳ trạng thái mở nào ──nguồn thấy chủ đã phản hồi──> replied_elsewhere
 *   ignored / manual_copied / replied_elsewhere / failed ──mở lại──> drafted (nếu có nháp) hoặc new
 */
import type { ReviewStatus } from './types'

export type ReviewAction = 'save' | 'approve' | 'unapprove' | 'copied' | 'ignore' | 'reopen' | 'redraft'

const ALLOWED: Record<ReviewAction, ReviewStatus[]> = {
  save: ['new', 'drafted', 'approved', 'failed'],
  approve: ['new', 'drafted', 'failed', 'approved'],
  unapprove: ['approved', 'failed'],
  copied: ['new', 'drafted', 'approved', 'failed'],
  ignore: ['new', 'drafted', 'approved', 'failed'],
  reopen: ['ignored', 'manual_copied', 'replied_elsewhere', 'failed', 'posted'],
  redraft: ['new', 'drafted', 'approved', 'failed'],
}

export function canApply(action: ReviewAction, from: ReviewStatus): boolean {
  return (ALLOWED[action] || []).includes(from)
}

/** Trạng thái sau hành động (không áp cho redraft: redraft -> drafted sau khi AI trả kết quả). */
export function nextStatus(action: ReviewAction, from: ReviewStatus, hasText: boolean): ReviewStatus {
  switch (action) {
    case 'save':
      return from === 'approved' ? 'approved' : hasText ? 'drafted' : from === 'failed' ? 'failed' : 'new'
    case 'approve':
      return 'approved'
    case 'unapprove':
      return hasText ? 'drafted' : 'new'
    case 'copied':
      return 'manual_copied'
    case 'ignore':
      return 'ignored'
    case 'reopen':
      return hasText ? 'drafted' : 'new'
    case 'redraft':
      return 'drafted'
  }
}

export const isActionName = (v: unknown): v is ReviewAction =>
  typeof v === 'string' && ['save', 'approve', 'unapprove', 'copied', 'ignore', 'reopen', 'redraft'].includes(v)

/** Trạng thái được coi là "đã xử lý xong" -> đóng việc (task) liên quan. */
export function closesTask(s: ReviewStatus): boolean {
  return s === 'posted' || s === 'manual_copied' || s === 'ignored' || s === 'replied_elsewhere'
}

/** Kết quả Make: thành công -> posted; lỗi -> về approved để lượt sau thử lại, quá maxAttempts -> failed. Lỗi 4xx vĩnh viễn -> failed ngay. */
export function afterPostResult(success: boolean, attempts: number, httpStatus: number | null, maxAttempts = 3): ReviewStatus {
  if (success) return 'posted'
  const permanent = httpStatus != null && [400, 403, 404].includes(httpStatus)
  return permanent || attempts >= maxAttempts ? 'failed' : 'approved'
}
