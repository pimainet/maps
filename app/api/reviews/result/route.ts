// POST /api/reviews/result — Make báo kết quả PUT .../reviews/{r}/reply.
// Body { reply_id, success, http_status?, reply_state?, error_code?, error_message?, make_execution_id? }
// Thành công -> posted (+ gbp_reply_state, thường là PENDING lúc mới đăng). Lỗi -> approved để lượt sau thử lại; lỗi 400/403/404
// hoặc quá 3 lần -> failed (người dùng copy dán tay hoặc thử lại).
import { NextResponse } from 'next/server'
import { publicError } from '@/lib/api-error'
import { isUuid } from '@/lib/autopost/secret'
import { afterPostResult } from '@/lib/reviews/lifecycle'
import { makeGuard } from '@/lib/reviews/server'
import { closeTasksForReviews } from '@/lib/review-watch'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const str = (v: unknown, n: number) => (v == null ? null : String(v).slice(0, n))

export async function POST(req: Request) {
  const guard = makeGuard(req)
  if (guard) return guard
  try {
    const body = await req.json().catch(() => null)
    if (!isUuid(body?.reply_id)) return NextResponse.json({ error: 'Thiếu reply_id.' }, { status: 400 })
    const success = body?.success === true || body?.success === 'true'
    const http = Number(body?.http_status)
    const httpStatus = Number.isFinite(http) && http > 0 ? http : null
    const { supabaseAdmin: admin } = await import('@/lib/supabase/admin')
    const { data: r, error } = await admin
      .from('client_reviews')
      .select('id, workspace_id, client_id, status, post_attempts')
      .eq('id', body.reply_id)
      .maybeSingle()
    if (error) throw error
    if (!r) return NextResponse.json({ error: 'Không tìm thấy phản hồi.' }, { status: 404 })

    await admin.from('review_reply_log').insert({
      workspace_id: (r as any).workspace_id,
      client_id: (r as any).client_id,
      review_id: (r as any).id,
      success,
      http_status: httpStatus,
      reply_state: str(body?.reply_state, 40),
      error_code: str(body?.error_code, 80),
      error_message: str(body?.error_message, 500),
      make_execution_id: str(body?.make_execution_id, 120),
    })

    if ((r as any).status !== 'posting') {
      // Kết quả đến muộn (bài đã được trả lại hàng đợi / người dùng đã xử lý tay): chỉ ghi log.
      return NextResponse.json({ ok: true, ignored: true, status: (r as any).status })
    }
    const next = afterPostResult(success, (r as any).post_attempts || 0, httpStatus)
    const patch: Record<string, unknown> = { status: next, posting_locked_at: null }
    if (success) {
      patch.posted_at = new Date().toISOString()
      patch.gbp_reply_state = str(body?.reply_state, 40) || 'PENDING'
      patch.post_error = null
    } else {
      patch.post_error = [httpStatus ? `HTTP ${httpStatus}` : null, str(body?.error_code, 80), str(body?.error_message, 300)].filter(Boolean).join(' — ') || 'Lỗi không rõ'
    }
    const { error: uErr } = await admin.from('client_reviews').update(patch).eq('id', (r as any).id).eq('status', 'posting')
    if (uErr) throw uErr
    if (success) await closeTasksForReviews(admin, [(r as any).id])
    return NextResponse.json({ ok: true, status: next })
  } catch (error: any) {
    return NextResponse.json({ error: publicError(error) }, { status: 500 })
  }
}
