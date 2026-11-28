// POST /api/reviews/prepare — Make gọi (Authorization: Bearer AUTOPOST_SECRET hoặc REVIEWS_MAKE_SECRET).
// Body { phase: 'sync' | 'post', limit? }
//  - phase 'sync': danh sách location cần đồng bộ review từ Business Profile API (để lấy tên review GBP và trạng thái phản hồi):
//      hồ sơ có phản hồi đã duyệt mà chưa ghép được tên review GBP, hoặc lâu chưa đồng bộ (REVIEWS_GBP_SYNC_EVERY_HOURS, mặc định 168).
//      Mỗi item: { client_id, location_resource, path } -> Make GET {domain}{path} rồi gửi kết quả về /api/reviews/sync.
//  - phase 'post': nhận (khoá) các phản hồi đã duyệt + đã ghép tên review -> Make PUT {path} với body_json,
//      rồi báo /api/reviews/result. Bài khoá quá 60 phút không có kết quả được trả lại hàng đợi.
// Chỉ hồ sơ thuộc gói có postViaMake và có clients.gbp_location_resource dạng accounts/{a}/locations/{l}.
import { NextResponse } from 'next/server'
import { publicError } from '@/lib/api-error'
import { effectivePlansFor } from '@/lib/billing/server'
import { reviewEntitlement } from '@/lib/billing/plans'
import { isV4LocationResource } from '@/lib/reviews/sources'
import { listReviewsPath, replyItem, GBP_DOMAIN } from '@/lib/reviews/make'
import { makeGuard } from '@/lib/reviews/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const STALE_MINUTES = 60
const MAX_ATTEMPTS = 3

export async function POST(req: Request) {
  const guard = makeGuard(req)
  if (guard) return guard
  try {
    const body = await req.json().catch(() => ({}))
    const phase = body?.phase === 'post' ? 'post' : 'sync'
    const limit = Math.min(50, Math.max(1, Number(body?.limit) || 20))
    const { supabaseAdmin: admin } = await import('@/lib/supabase/admin')

    const { data: clients, error: cErr } = await admin
      .from('clients')
      .select('id, workspace_id, name, gbp_location_resource')
      .not('gbp_location_resource', 'is', null)
      .limit(2000)
    if (cErr) throw cErr
    const withLoc = (clients || []).filter((c: any) => isV4LocationResource(c.gbp_location_resource))
    const plans = await effectivePlansFor(withLoc.map((c: any) => c.workspace_id))
    const allowed = withLoc.filter((c: any) => reviewEntitlement(plans.get(c.workspace_id) ?? 'free').postViaMake)
    const byId = new Map<string, any>(allowed.map((c: any) => [c.id, c]))
    if (!allowed.length) return NextResponse.json({ phase, domain: GBP_DOMAIN, items: [] })

    if (phase === 'sync') {
      const everyH = Math.max(1, Number(process.env.REVIEWS_GBP_SYNC_EVERY_HOURS || 168) || 168)
      const [{ data: unmatched }, { data: states }] = await Promise.all([
        admin.from('client_reviews').select('client_id').in('client_id', [...byId.keys()]).eq('status', 'approved').is('gbp_review_name', null).limit(1000),
        admin.from('review_watch_state').select('client_id, gbp_synced_at').in('client_id', [...byId.keys()]),
      ])
      const need = new Set<string>((unmatched || []).map((r: any) => r.client_id))
      const synced = new Map<string, string | null>((states || []).map((s: any) => [s.client_id, s.gbp_synced_at]))
      const now = Date.now()
      for (const c of allowed) {
        const t = synced.get(c.id)
        if (!t || now - Date.parse(t) >= everyH * 3_600_000) need.add(c.id)
      }
      const items = [...need]
        .map((id) => byId.get(id))
        .filter(Boolean)
        .slice(0, limit)
        .map((c: any) => ({ client_id: c.id, client_name: c.name, location_resource: c.gbp_location_resource, method: 'GET', path: listReviewsPath(c.gbp_location_resource) }))
      return NextResponse.json({ phase, domain: GBP_DOMAIN, items })
    }

    // phase 'post'
    const staleBefore = new Date(Date.now() - STALE_MINUTES * 60_000).toISOString()
    await admin.from('client_reviews').update({ status: 'approved', posting_locked_at: null }).eq('status', 'posting').lt('posting_locked_at', staleBefore)

    const { data: ready, error: rErr } = await admin
      .from('client_reviews')
      .select('id, client_id, gbp_review_name, final_reply, post_attempts')
      .in('client_id', [...byId.keys()])
      .eq('status', 'approved')
      .not('gbp_review_name', 'is', null)
      .not('final_reply', 'is', null)
      .lt('post_attempts', MAX_ATTEMPTS)
      .order('approved_at', { ascending: true })
      .limit(limit)
    if (rErr) throw rErr

    const items: any[] = []
    const lockedAt = new Date().toISOString()
    for (const r of ready || []) {
      const item = replyItem(r as any, byId.get((r as any).client_id)?.name || '')
      if (!item) continue
      // Khoá có điều kiện: chỉ nhận nếu vẫn 'approved' (người dùng có thể vừa bỏ duyệt).
      const { data: claimed } = await admin
        .from('client_reviews')
        .update({ status: 'posting', posting_locked_at: lockedAt, post_attempts: ((r as any).post_attempts || 0) + 1 })
        .eq('id', (r as any).id)
        .eq('status', 'approved')
        .select('id')
      if (claimed && claimed.length) items.push(item)
    }
    return NextResponse.json({ phase, domain: GBP_DOMAIN, items })
  } catch (error: any) {
    return NextResponse.json({ error: publicError(error) }, { status: 500 })
  }
}
