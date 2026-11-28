/**
 * Áp 1 hành động lên 1 review (dùng chung cho dashboard và link duyệt của chủ quán).
 * Kiểm tra vòng đời (lifecycle.ts) + làm sạch nội dung (reply-rules.ts) + đóng việc khi xong.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { canApply, closesTask, nextStatus, type ReviewAction } from './lifecycle'
import { checkReply } from './reply-rules'
import { draftReview } from './draft'
import { closeTasksForReviews } from '@/lib/review-watch'
import type { ReviewEntitlement } from '@/lib/billing/plans'
import type { ReviewRow, ReviewStatus } from './types'

export type ActionInput = {
  action: ReviewAction
  text?: string | null
  instruction?: string | null
  userId?: string | null
  via: 'dashboard' | 'owner_link'
}

export type ActionResult =
  | { ok: true; status: ReviewStatus; warnings: string[] }
  | { ok: false; status: number; error: string; code?: string }

export async function applyReviewAction(
  admin: SupabaseClient,
  review: Pick<ReviewRow, 'id' | 'status' | 'rating' | 'review_text' | 'author_name' | 'urgency' | 'draft_warnings' | 'draft_reply' | 'final_reply'>,
  client: { id: string; workspace_id: string; name: string; industry?: string | null; area?: string | null; brand_voice?: string | null },
  ent: ReviewEntitlement,
  input: ActionInput,
): Promise<ActionResult> {
  const from = review.status
  if (!canApply(input.action, from)) {
    return { ok: false, status: 409, error: `Không thể "${input.action}" khi review đang ở trạng thái "${from}".`, code: 'bad_transition' }
  }

  if (input.action === 'redraft') {
    const res = await draftReview(admin, review, client, {
      kind: input.via === 'owner_link' ? 'owner' : 'manual',
      monthlyDrafts: ent.monthlyDrafts,
      instruction: input.instruction ? String(input.instruction).slice(0, 300) : null,
    })
    if (!res.ok) return { ok: false, status: res.reason === 'quota' ? 429 : 503, error: res.message, code: res.reason }
    return { ok: true, status: 'drafted', warnings: res.warnings }
  }

  const supplied = typeof input.text === 'string' ? input.text : null
  const current = supplied ?? review.final_reply ?? review.draft_reply ?? ''
  const patch: Record<string, unknown> = {}
  let warnings: string[] = []

  if (input.action === 'save' || input.action === 'approve' || input.action === 'copied') {
    const checked = checkReply(current, { authorName: review.author_name, rating: review.rating })
    if (input.action !== 'save' || current.trim()) {
      if (checked.blocking.length) return { ok: false, status: 400, error: checked.blocking.join(' '), code: 'invalid_reply' }
    }
    warnings = checked.warnings
    patch.final_reply = checked.text || null
    patch.draft_warnings = checked.warnings
  }

  const status = nextStatus(input.action, from, Boolean(current.trim()))
  patch.status = status
  if (input.action === 'approve') {
    patch.approved_at = new Date().toISOString()
    patch.approved_by = input.userId ?? null
    patch.approved_via = input.via
    patch.post_error = null
    patch.post_attempts = 0
  }
  if (input.action === 'unapprove' || input.action === 'reopen') {
    patch.approved_at = null
    patch.approved_by = null
    patch.approved_via = null
  }

  // Cập nhật có điều kiện theo trạng thái cũ: 2 người bấm cùng lúc / Make vừa nhận bài -> 1 bên thua, không ghi đè.
  const { data, error } = await admin.from('client_reviews').update(patch).eq('id', review.id).eq('status', from).select('id')
  if (error) throw error
  if (!data || data.length === 0) return { ok: false, status: 409, error: 'Review vừa được cập nhật ở nơi khác, hãy tải lại.', code: 'conflict' }
  if (closesTask(status)) await closeTasksForReviews(admin, [review.id])
  return { ok: true, status, warnings }
}
