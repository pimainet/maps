// Link duyệt phản hồi cho chủ quán (không đăng nhập): /r/<token>.
// GET  ?token=...                         -> tên doanh nghiệp + review đang chờ (mới / có nháp / đã duyệt)
// POST { token, review_id, action, text?, instruction? }  action: save | approve | ignore | redraft
// Token 24 byte ngẫu nhiên (clients.review_link_token), đổi được trên dashboard. Chỉ thao tác trên review của đúng doanh nghiệp đó.
import { NextResponse } from 'next/server'
import { isUuid } from '@/lib/autopost/secret'
import { getReviewEntitlement } from '@/lib/billing/server'
import { applyReviewAction } from '@/lib/reviews/actions'
import { inboxOff, isToken, PUBLIC_REVIEW_COLUMNS, REVIEW_COLUMNS, routeError } from '@/lib/reviews/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const OWNER_ACTIONS = new Set(['save', 'approve', 'ignore', 'redraft'])

async function clientByToken(token: string) {
  const { supabaseAdmin: admin } = await import('@/lib/supabase/admin')
  const { data, error } = await admin
    .from('clients')
    .select('id, workspace_id, name, industry, area, brand_voice')
    .eq('review_link_token', token)
    .maybeSingle()
  if (error) throw error
  return { admin, client: data as any }
}

export async function GET(req: Request) {
  const off = inboxOff()
  if (off) return off
  try {
    const token = new URL(req.url).searchParams.get('token')
    if (!isToken(token)) return NextResponse.json({ error: 'Link không hợp lệ.' }, { status: 400 })
    const { admin, client } = await clientByToken(token)
    if (!client) return NextResponse.json({ error: 'Link đã hết hiệu lực.' }, { status: 404 })
    const { reviews: ent } = await getReviewEntitlement(client.workspace_id)
    if (!ent.ownerLink) return NextResponse.json({ error: 'Link duyệt đang tạm tắt.' }, { status: 403 })
    const { data, error } = await admin
      .from('client_reviews')
      .select(PUBLIC_REVIEW_COLUMNS)
      .eq('client_id', client.id)
      .in('status', ['new', 'drafted', 'approved'])
      .order('reviewed_at', { ascending: false, nullsFirst: false })
      .limit(50)
    if (error) throw error
    return NextResponse.json({ business: client.name, reviews: data || [] })
  } catch (error: any) {
    return routeError(error)
  }
}

export async function POST(req: Request) {
  const off = inboxOff()
  if (off) return off
  try {
    const body = await req.json().catch(() => null)
    if (!isToken(body?.token)) return NextResponse.json({ error: 'Link không hợp lệ.' }, { status: 400 })
    if (!isUuid(body?.review_id)) return NextResponse.json({ error: 'Thiếu review.' }, { status: 400 })
    if (!OWNER_ACTIONS.has(body?.action)) return NextResponse.json({ error: 'Hành động không hợp lệ.' }, { status: 400 })
    if (body?.text != null && (typeof body.text !== 'string' || body.text.length > 5000)) {
      return NextResponse.json({ error: 'Nội dung phản hồi không hợp lệ.' }, { status: 400 })
    }
    const { admin, client } = await clientByToken(body.token)
    if (!client) return NextResponse.json({ error: 'Link đã hết hiệu lực.' }, { status: 404 })
    const { reviews: ent } = await getReviewEntitlement(client.workspace_id)
    if (!ent.ownerLink) return NextResponse.json({ error: 'Link duyệt đang tạm tắt.' }, { status: 403 })
    const { data: review, error } = await admin
      .from('client_reviews')
      .select(REVIEW_COLUMNS)
      .eq('id', body.review_id)
      .eq('client_id', client.id)
      .maybeSingle()
    if (error) throw error
    if (!review) return NextResponse.json({ error: 'Không tìm thấy review.' }, { status: 404 })
    const res = await applyReviewAction(admin, review as any, client, ent, {
      action: body.action,
      text: body.text ?? null,
      instruction: body.instruction ?? null,
      via: 'owner_link',
    })
    if (!res.ok) return NextResponse.json({ error: res.error, code: res.code }, { status: res.status })
    const { data: updated } = await admin.from('client_reviews').select(PUBLIC_REVIEW_COLUMNS).eq('id', body.review_id).maybeSingle()
    return NextResponse.json({ ok: true, status: res.status, warnings: res.warnings, review: updated })
  } catch (error: any) {
    return routeError(error)
  }
}
