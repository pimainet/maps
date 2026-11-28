// POST /api/admin/agency/action — nhân viên (Super Admin) duyệt thay khách trên khách gói Làm hộ.
// Body { kind: 'post_approve' | 'post_reject' | 'review' | 'task', ... } — xem từng nhánh bên dưới.
import { NextResponse } from 'next/server'
import { supabaseAdmin as admin } from '@/lib/supabase/admin'
import { isUuid } from '@/lib/autopost/secret'
import { getReviewEntitlement } from '@/lib/billing/server'
import { AUTO_POST_ENABLED, REVIEW_INBOX_ENABLED } from '@/lib/features'
import { isActionName } from '@/lib/reviews/lifecycle'
import { applyReviewAction } from '@/lib/reviews/actions'
import { REVIEW_COLUMNS } from '@/lib/reviews/server'
import { agencyError, isDoneForYouWorkspace, logAgencyAction, staffGuard } from '@/lib/agency/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const err = (error: string, status: number, code?: string) => NextResponse.json({ error, code }, { status })
const notDfy = () => err('Khách này không còn ở gói Làm hộ.', 409, 'not_done_for_you')

export async function POST(req: Request) {
  const g = await staffGuard()
  if ('res' in g) return g.res
  const actor = g.staff.id
  try {
    const body = await req.json().catch(() => null)
    const kind = body?.kind

    if (kind === 'post_approve' || kind === 'post_reject') {
      if (!AUTO_POST_ENABLED) return err('Tính năng tự đăng bài đang tắt.', 404)
      if (!isUuid(body?.queue_id)) return err('Thiếu bài.', 400)
      const { data: q } = await admin.from('autopost_queue').select('id, workspace_id, client_id').eq('id', body.queue_id).maybeSingle()
      if (!q) return err('Không tìm thấy bài.', 404)
      if (!(await isDoneForYouWorkspace((q as any).workspace_id))) return notDfy()

      if (kind === 'post_approve') {
        const caption = body.caption == null ? null : String(body.caption)
        if (caption != null && caption.length > 1500) return err('Caption quá dài (tối đa 1500 ký tự).', 400)
        const { data, error } = await admin.rpc('agency_approve_autopost', { p_queue_id: q.id, p_caption: caption, p_by: actor })
        if (error) throw error
        const r: any = data
        if (!r?.ok) {
          if (r?.reason === 'length') return err('Caption cần từ 40 đến 1500 ký tự.', 400, 'length')
          return err('Bài không còn ở trạng thái chờ duyệt, hãy tải lại.', 409, r?.reason)
        }
        await logAgencyAction(admin, { actor, workspaceId: (q as any).workspace_id, clientId: (q as any).client_id, kind: 'post_approve', refId: q.id, data: { edited: caption != null } })
        return NextResponse.json({ ok: true })
      }

      const { data, error } = await admin.rpc('agency_reject_autopost', {
        p_queue_id: q.id,
        p_by: actor,
        p_reason: typeof body.reason === 'string' ? body.reason.slice(0, 200) : null,
        p_archive_photo: body.archive_photo === true,
      })
      if (error) throw error
      const r: any = data
      if (!r?.ok) return err('Bài không còn ở trạng thái chờ duyệt, hãy tải lại.', 409, r?.reason)
      await logAgencyAction(admin, { actor, workspaceId: (q as any).workspace_id, clientId: (q as any).client_id, kind: 'post_reject', refId: q.id, data: { archive_photo: body.archive_photo === true, reason: body.reason ?? null } })
      return NextResponse.json({ ok: true })
    }

    if (kind === 'review') {
      if (!REVIEW_INBOX_ENABLED) return err('Hộp thư review đang tắt.', 404)
      if (!isUuid(body?.review_id)) return err('Thiếu review.', 400)
      if (!isActionName(body?.action)) return err('Hành động không hợp lệ.', 400)
      if (body?.text != null && (typeof body.text !== 'string' || body.text.length > 5000)) return err('Nội dung phản hồi không hợp lệ.', 400)
      const { data: review } = await admin.from('client_reviews').select(REVIEW_COLUMNS).eq('id', body.review_id).maybeSingle()
      if (!review) return err('Không tìm thấy review.', 404)
      const wsId = (review as any).workspace_id as string
      if (!(await isDoneForYouWorkspace(wsId))) return notDfy()
      const { data: client } = await admin.from('clients').select('id, workspace_id, name, industry, area, brand_voice').eq('id', (review as any).client_id).maybeSingle()
      if (!client) return err('Không tìm thấy doanh nghiệp.', 404)
      const { reviews: ent } = await getReviewEntitlement(wsId)
      const res = await applyReviewAction(admin, review as any, client as any, ent, {
        action: body.action,
        text: body.text ?? null,
        instruction: body.instruction ?? null,
        userId: actor,
        via: 'agency',
      })
      if (!res.ok) return err(res.error, res.status, res.code)
      await logAgencyAction(admin, { actor, workspaceId: wsId, clientId: (review as any).client_id, kind: `review_${body.action}`, refId: body.review_id, data: { status: res.status } })
      const { data: updated } = await admin.from('client_reviews').select(REVIEW_COLUMNS).eq('id', body.review_id).maybeSingle()
      return NextResponse.json({ ok: true, status: res.status, warnings: res.warnings, review: updated })
    }

    if (kind === 'task') {
      if (!isUuid(body?.task_id)) return err('Thiếu việc.', 400)
      if (!['done', 'skipped', 'pending'].includes(body?.status)) return err('Trạng thái không hợp lệ.', 400)
      const { data: t } = await admin.from('tasks').select('id, workspace_id, client_id, status').eq('id', body.task_id).maybeSingle()
      if (!t) return err('Không tìm thấy việc.', 404)
      if (!(await isDoneForYouWorkspace((t as any).workspace_id))) return notDfy()
      const patch: Record<string, unknown> = { status: body.status, completed_at: body.status === 'done' ? new Date().toISOString() : null }
      let { error } = await admin.from('tasks').update(patch).eq('id', t.id)
      if (error && (error.code === 'PGRST204' || error.code === '42703')) ({ error } = await admin.from('tasks').update({ status: body.status }).eq('id', t.id))
      if (error) throw error
      await logAgencyAction(admin, { actor, workspaceId: (t as any).workspace_id, clientId: (t as any).client_id, kind: body.status === 'done' ? 'task_done' : body.status === 'skipped' ? 'task_skip' : 'task_reopen', refId: t.id })
      return NextResponse.json({ ok: true })
    }

    return err('Hành động không hợp lệ.', 400)
  } catch (e: any) {
    return agencyError(e)
  }
}
