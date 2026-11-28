// GET /api/reviews?client_id=<uuid>&view=open|done|all — hộp thư review của 1 doanh nghiệp (đăng nhập, cùng workspace).
// Lần đầu mở (chưa có review nào) tự nhập review có sẵn trong bản chụp hồ sơ gần nhất — không tốn credit.
import { NextResponse } from 'next/server'
import { requireActiveWorkspaceId } from '@/lib/auth'
import { getClientById } from '@/lib/db'
import { isUuid } from '@/lib/autopost/secret'
import { getReviewEntitlement } from '@/lib/billing/server'
import { draftsUsedThisMonth } from '@/lib/reviews/draft'
import { importFromLatestSnapshot } from '@/lib/review-watch'
import { isV4LocationResource } from '@/lib/reviews/sources'
import { inboxOff, REVIEW_COLUMNS, routeError, vnMonthKey } from '@/lib/reviews/server'
import { DONE_STATUSES, OPEN_STATUSES } from '@/lib/reviews/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const off = inboxOff()
  if (off) return off
  try {
    const workspaceId = await requireActiveWorkspaceId()
    const url = new URL(req.url)
    const clientId = url.searchParams.get('client_id')
    const view = url.searchParams.get('view') || 'open'
    if (!isUuid(clientId)) return NextResponse.json({ error: 'Thiếu doanh nghiệp.' }, { status: 400 })
    const client = await getClientById(clientId, workspaceId)
    if (!client) return NextResponse.json({ error: 'Không tìm thấy doanh nghiệp này.' }, { status: 404 })
    const { supabaseAdmin: admin } = await import('@/lib/supabase/admin')

    const { count } = await admin.from('client_reviews').select('id', { count: 'exact', head: true }).eq('client_id', clientId)
    if (!count) {
      const { error } = await admin.from('client_reviews').select('id').limit(1)
      if (error) throw error // bảng chưa có -> routeError báo thiếu migration
      await importFromLatestSnapshot(admin, client as any)
    }

    let q = admin.from('client_reviews').select(REVIEW_COLUMNS).eq('client_id', clientId).eq('workspace_id', workspaceId)
    if (view === 'open') q = q.in('status', OPEN_STATUSES)
    else if (view === 'done') q = q.in('status', DONE_STATUSES)
    const { data, error } = await q.order('reviewed_at', { ascending: false, nullsFirst: false }).limit(200)
    if (error) throw error

    const [{ plan, reviews: ent }, used, stateRes, countsRes] = await Promise.all([
      getReviewEntitlement(workspaceId),
      draftsUsedThisMonth(admin, workspaceId),
      admin.from('review_watch_state').select('last_checked_at, last_source, last_error, gbp_synced_at, gbp_sync_error, last_rating, last_review_count, manual_checks_month, manual_checks_count').eq('client_id', clientId).maybeSingle(),
      admin.from('client_reviews').select('status, urgency').eq('client_id', clientId).limit(2000),
    ])
    const counts: Record<string, number> = {}
    let urgentOpen = 0
    for (const r of (countsRes.data || []) as any[]) {
      counts[r.status] = (counts[r.status] || 0) + 1
      if (r.urgency === 'high' && OPEN_STATUSES.includes(r.status)) urgentOpen += 1
    }
    const st: any = stateRes.data
    const manualUsed = st?.manual_checks_month === vnMonthKey() ? st.manual_checks_count : 0
    return NextResponse.json({
      reviews: data || [],
      counts,
      urgent_open: urgentOpen,
      state: st || null,
      plan,
      entitlement: ent,
      drafts_used: used,
      manual_checks_used: manualUsed,
      client_name: (client as any).name,
      maps_link: (client as any).gbp_link || ((client as any).place_id ? `https://www.google.com/maps/place/?q=place_id:${(client as any).place_id}` : null),
      make_ready: isV4LocationResource((client as any).gbp_location_resource),
      owner_link_path: ent.ownerLink && (client as any).review_link_token ? `/r/${(client as any).review_link_token}` : null,
    })
  } catch (error: any) {
    return routeError(error)
  }
}
