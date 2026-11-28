// POST /api/reviews/sync — Make gửi kết quả GET /v4/{location}/reviews (Business Profile API).
// Body { client_id, location_resource, response }  (response: object hoặc chuỗi JSON; có thể là { body: ... }).
// Tác dụng: ghi/khớp review (nguồn 'gbp', chính xác nhất), gắn gbp_review_name cho review đã có để đăng phản hồi,
// cập nhật trạng thái kiểm duyệt phản hồi (PENDING/APPROVED/REJECTED), phát hiện chủ đã phản hồi ngoài hệ thống,
// soạn nháp + tạo việc cho review mới (theo gói).
import { NextResponse } from 'next/server'
import { publicError } from '@/lib/api-error'
import { isUuid } from '@/lib/autopost/secret'
import { getReviewEntitlement } from '@/lib/billing/server'
import { applyIngest } from '@/lib/reviews/ingest'
import { matchGbpReview } from '@/lib/reviews/normalize'
import { parseGbpReviews, isV4LocationResource } from '@/lib/reviews/sources'
import { coerceGbpPayload } from '@/lib/reviews/make'
import { makeGuard } from '@/lib/reviews/server'
import { autoDraftPending, closeTasksForReviews, createTasksForNew } from '@/lib/review-watch'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function POST(req: Request) {
  const guard = makeGuard(req)
  if (guard) return guard
  try {
    const body = await req.json().catch(() => null)
    if (!isUuid(body?.client_id)) return NextResponse.json({ error: 'Thiếu client_id.' }, { status: 400 })
    const { supabaseAdmin: admin } = await import('@/lib/supabase/admin')
    const { data: client, error: cErr } = await admin
      .from('clients')
      .select('id, workspace_id, name, area, industry, brand_voice, gbp_link, place_id, gbp_location_resource')
      .eq('id', body.client_id)
      .maybeSingle()
    if (cErr) throw cErr
    if (!client) return NextResponse.json({ error: 'Không tìm thấy doanh nghiệp.' }, { status: 404 })
    const loc = (client as any).gbp_location_resource
    if (!isV4LocationResource(loc) || (body?.location_resource && body.location_resource !== loc)) {
      return NextResponse.json({ error: 'location_resource không khớp với doanh nghiệp.' }, { status: 400 })
    }
    const now = new Date()
    const payload = coerceGbpPayload(body?.response)
    if (!payload) {
      await admin.from('review_watch_state').upsert({ client_id: client.id, workspace_id: client.workspace_id, gbp_sync_error: 'Make gửi response không đọc được', updated_at: now.toISOString() })
      return NextResponse.json({ error: 'response không phải JSON hợp lệ.' }, { status: 400 })
    }
    if (payload.error) {
      const msg = String(payload.error?.message || payload.error).slice(0, 300)
      await admin.from('review_watch_state').upsert({ client_id: client.id, workspace_id: client.workspace_id, gbp_sync_error: msg, updated_at: now.toISOString() })
      return NextResponse.json({ ok: false, error: msg })
    }

    const parsed = parseGbpReviews(payload, loc)
    const ingest = await applyIngest(admin, client as any, parsed.items, { replyKnown: true, now, matcher: (pool, inc) => matchGbpReview(pool, inc) })

    // Trạng thái kiểm duyệt phản hồi của Google cho các phản hồi đã đăng
    let moderated = 0
    for (const g of parsed.items) {
      if (!g.reply_state || !g.gbp_review_name) continue
      const { data } = await admin
        .from('client_reviews')
        .update({ gbp_reply_state: g.reply_state })
        .eq('gbp_review_name', g.gbp_review_name)
        .eq('status', 'posted')
        .neq('gbp_reply_state', g.reply_state)
        .select('id')
      moderated += data?.length || 0
    }
    const closed = await closeTasksForReviews(admin, ingest.repliedElsewhereIds)

    const { reviews: ent } = await getReviewEntitlement(client.workspace_id)
    const drafts = ent.autoDraft ? await autoDraftPending(admin, client as any, ent, now) : 0
    const appUrl = (process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/$/, '')
    const tasks = await createTasksForNew(admin, client as any, ingest.inserted, true, now, appUrl)

    const { data: st } = await admin.from('review_watch_state').select('client_id').eq('client_id', client.id).maybeSingle()
    const statePatch = {
      gbp_synced_at: now.toISOString(),
      gbp_sync_error: null,
      ...(parsed.averageRating != null ? { last_rating: parsed.averageRating } : {}),
      ...(parsed.total != null ? { last_review_count: parsed.total } : {}),
      updated_at: now.toISOString(),
    }
    if (st) await admin.from('review_watch_state').update(statePatch).eq('client_id', client.id)
    else await admin.from('review_watch_state').insert({ client_id: client.id, workspace_id: client.workspace_id, ...statePatch })

    const { count: unmatched } = await admin
      .from('client_reviews')
      .select('id', { count: 'exact', head: true })
      .eq('client_id', client.id)
      .eq('status', 'approved')
      .is('gbp_review_name', null)
    return NextResponse.json({
      ok: true,
      received: parsed.items.length,
      inserted: ingest.inserted.length,
      updated: ingest.updated,
      moderated,
      closed_tasks: closed,
      drafts,
      ...tasks,
      // Phản hồi đã duyệt vẫn chưa ghép được review GBP (review cũ hơn 50 review mới nhất, hoặc khác nội dung) -> copy dán tay.
      approved_unmatched: unmatched || 0,
    })
  } catch (error: any) {
    return NextResponse.json({ error: publicError(error) }, { status: 500 })
  }
}
