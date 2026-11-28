// POST /api/reviews/action { review_id, action: save|approve|unapprove|copied|ignore|reopen|redraft, text?, instruction? }
import { NextResponse } from 'next/server'
import { getCurrentUser, requireActiveWorkspaceId } from '@/lib/auth'
import { isUuid } from '@/lib/autopost/secret'
import { getReviewEntitlement } from '@/lib/billing/server'
import { isActionName } from '@/lib/reviews/lifecycle'
import { applyReviewAction } from '@/lib/reviews/actions'
import { inboxOff, REVIEW_COLUMNS, routeError } from '@/lib/reviews/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(req: Request) {
  const off = inboxOff()
  if (off) return off
  try {
    const workspaceId = await requireActiveWorkspaceId()
    const user = await getCurrentUser()
    const body = await req.json().catch(() => null)
    if (!isUuid(body?.review_id)) return NextResponse.json({ error: 'Thiếu review.' }, { status: 400 })
    if (!isActionName(body?.action)) return NextResponse.json({ error: 'Hành động không hợp lệ.' }, { status: 400 })
    if (body?.text != null && (typeof body.text !== 'string' || body.text.length > 5000)) {
      return NextResponse.json({ error: 'Nội dung phản hồi không hợp lệ.' }, { status: 400 })
    }
    const { supabaseAdmin: admin } = await import('@/lib/supabase/admin')
    const { data: review, error } = await admin
      .from('client_reviews')
      .select(REVIEW_COLUMNS)
      .eq('id', body.review_id)
      .eq('workspace_id', workspaceId)
      .maybeSingle()
    if (error) throw error
    if (!review) return NextResponse.json({ error: 'Không tìm thấy review.' }, { status: 404 })
    const { data: client } = await admin
      .from('clients')
      .select('id, workspace_id, name, industry, area, brand_voice')
      .eq('id', (review as any).client_id)
      .eq('workspace_id', workspaceId)
      .maybeSingle()
    if (!client) return NextResponse.json({ error: 'Không tìm thấy doanh nghiệp.' }, { status: 404 })

    const { reviews: ent } = await getReviewEntitlement(workspaceId)
    const res = await applyReviewAction(admin, review as any, client as any, ent, {
      action: body.action,
      text: body.text ?? null,
      instruction: body.instruction ?? null,
      userId: user?.id ?? null,
      via: 'dashboard',
    })
    if (!res.ok) return NextResponse.json({ error: res.error, code: res.code }, { status: res.status })
    const { data: updated } = await admin.from('client_reviews').select(REVIEW_COLUMNS).eq('id', body.review_id).maybeSingle()
    return NextResponse.json({ ok: true, status: res.status, warnings: res.warnings, review: updated })
  } catch (error: any) {
    return routeError(error)
  }
}
