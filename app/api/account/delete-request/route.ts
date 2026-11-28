// Yêu cầu xoá tài khoản (quyền xoá dữ liệu — Luật 91/2025/QH15 Điều 14; NĐ 356 Điều 5: 20 ngày).
// GET: xem yêu cầu đang mở + những gì sẽ bị xoá. POST: tạo yêu cầu (gõ câu xác nhận). DELETE: huỷ trong thời gian chờ.
// Cron /api/cron/billing thực hiện sau DELETION_GRACE_DAYS ngày (lib/privacy/server.ts executeDueDeletions).
import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { publicError } from '@/lib/api-error'
import { readJsonObject } from '@/lib/request-body'
import {
  DELETE_CONFIRM_PHRASE,
  DELETION_GRACE_DAYS,
  deletionScheduledFor,
  normalizeConfirmPhrase,
  planAccountDeletion,
  requestDueAt,
} from '@/lib/privacy/policy'
import { loadMemberships } from '@/lib/privacy/server'
import { isMissingRelationError } from '@/lib/privacy/db-compat'

export const dynamic = 'force-dynamic'

const OPEN = ['received', 'scheduled', 'processing', 'needs_attention']

async function context(userId: string) {
  const { supabaseAdmin } = await import('@/lib/supabase/admin')
  const memberships = await loadMemberships(supabaseAdmin, userId)
  const plan = planAccountDeletion(memberships)
  const name = (id: string) => memberships.find((m) => m.workspace_id === id)?.name || id
  const open = await supabaseAdmin
    .from('data_requests')
    .select('id, status, received_at, scheduled_for, due_at')
    .eq('user_id', userId)
    .eq('kind', 'delete_account')
    .in('status', OPEN)
    .order('received_at', { ascending: false })
    .limit(1)
  return {
    supabaseAdmin,
    setupRequired: Boolean(open.error && isMissingRelationError(open.error)),
    openError: open.error && !isMissingRelationError(open.error) ? open.error : null,
    request: open.data?.[0] || null,
    plan: {
      delete_workspaces: plan.deleteWorkspaces.map(name),
      leave_workspaces: plan.leaveWorkspaces.map(name),
      blockers: plan.blockers.map(name),
    },
  }
}

export async function GET() {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const c = await context(user.id)
    if (c.openError) throw new Error(c.openError.message)
    return NextResponse.json({
      setup_required: c.setupRequired,
      request: c.request,
      plan: c.plan,
      grace_days: DELETION_GRACE_DAYS,
      confirm_phrase: DELETE_CONFIRM_PHRASE,
    })
  } catch (error) {
    return NextResponse.json({ error: publicError(error) }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const body = await readJsonObject(request, 4 * 1024)
    if (!body.ok) return NextResponse.json({ error: body.error }, { status: body.status })
    if (normalizeConfirmPhrase(body.value.confirm) !== DELETE_CONFIRM_PHRASE) {
      return NextResponse.json({ error: `Hãy gõ đúng "${DELETE_CONFIRM_PHRASE}" để xác nhận.` }, { status: 400 })
    }
    const c = await context(user.id)
    if (c.setupRequired) return NextResponse.json({ error: 'Hệ thống chưa sẵn sàng nhận yêu cầu xoá tự động. Vui lòng gửi email cho chúng tôi.' }, { status: 503 })
    if (c.openError) throw new Error(c.openError.message)
    if (c.request) return NextResponse.json({ ok: true, request: c.request, already: true })
    if (c.plan.blockers.length) {
      return NextResponse.json(
        {
          error: `Bạn là chủ sở hữu duy nhất của: ${c.plan.blockers.join(', ')}. Hãy chuyển quyền chủ sở hữu cho thành viên khác hoặc xoá các thành viên trước, để không xoá nhầm dữ liệu của người khác.`,
          blockers: c.plan.blockers,
        },
        { status: 409 },
      )
    }
    const now = new Date()
    const { data, error } = await c.supabaseAdmin
      .from('data_requests')
      .insert({
        user_id: user.id,
        kind: 'delete_account',
        status: 'scheduled',
        acknowledged_at: now.toISOString(),
        due_at: requestDueAt('delete_account', now).toISOString(),
        scheduled_for: deletionScheduledFor(now).toISOString(),
        detail: { plan: c.plan, reason: typeof body.value.reason === 'string' ? body.value.reason.slice(0, 500) : null },
      })
      .select('id, status, received_at, scheduled_for, due_at')
      .single()
    if (error) throw new Error(error.message)
    return NextResponse.json({ ok: true, request: data })
  } catch (error) {
    return NextResponse.json({ error: publicError(error) }, { status: 500 })
  }
}

export async function DELETE() {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { supabaseAdmin } = await import('@/lib/supabase/admin')
    const { data, error } = await supabaseAdmin
      .from('data_requests')
      .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
      .eq('user_id', user.id)
      .eq('kind', 'delete_account')
      .in('status', ['received', 'scheduled'])
      .select('id')
    if (error) {
      if (isMissingRelationError(error)) return NextResponse.json({ ok: true, cancelled: 0 })
      throw new Error(error.message)
    }
    if (!data?.length) return NextResponse.json({ error: 'Không có yêu cầu xoá nào còn huỷ được (có thể đang được xử lý).' }, { status: 409 })
    return NextResponse.json({ ok: true, cancelled: data.length })
  } catch (error) {
    return NextResponse.json({ error: publicError(error) }, { status: 500 })
  }
}
