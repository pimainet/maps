// POST /api/reviews/link { client_id, rotate? } — link duyệt phản hồi không cần đăng nhập cho chủ quán (/r/<token>).
// rotate=true: tạo link mới, link cũ hết hiệu lực ngay. Chỉ gói có ownerLink.
import { NextResponse } from 'next/server'
import { requireActiveWorkspaceId } from '@/lib/auth'
import { getClientById } from '@/lib/db'
import { isUuid } from '@/lib/autopost/secret'
import { getReviewEntitlement } from '@/lib/billing/server'
import { inboxOff, newReviewLinkToken, routeError } from '@/lib/reviews/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const off = inboxOff()
  if (off) return off
  try {
    const workspaceId = await requireActiveWorkspaceId()
    const body = await req.json().catch(() => null)
    if (!isUuid(body?.client_id)) return NextResponse.json({ error: 'Thiếu doanh nghiệp.' }, { status: 400 })
    const client = await getClientById(body.client_id, workspaceId)
    if (!client) return NextResponse.json({ error: 'Không tìm thấy doanh nghiệp này.' }, { status: 404 })
    const { reviews: ent } = await getReviewEntitlement(workspaceId)
    if (!ent.ownerLink) return NextResponse.json({ error: 'Link duyệt cho chủ quán thuộc gói trả phí.', code: 'plan' }, { status: 403 })
    const { supabaseAdmin: admin } = await import('@/lib/supabase/admin')
    let token = (client as any).review_link_token as string | null
    if (!token || body?.rotate === true) {
      token = newReviewLinkToken()
      const { error } = await admin.from('clients').update({ review_link_token: token }).eq('id', client.id).eq('workspace_id', workspaceId)
      if (error) throw error
    }
    return NextResponse.json({ path: `/r/${token}` })
  } catch (error: any) {
    return routeError(error)
  }
}
