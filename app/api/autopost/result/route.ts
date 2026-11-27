import { NextResponse } from 'next/server'
import { publicError } from '@/lib/api-error'
import { autoPostFeatureOn, authorizedAutopost, isUuid } from '@/lib/autopost/secret'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  if (!autoPostFeatureOn()) {
    return NextResponse.json({ error: 'Tính năng tự đăng bài đang tắt.' }, { status: 404 })
  }
  if (!process.env.AUTOPOST_SECRET) {
    return NextResponse.json({ error: 'Chưa đặt AUTOPOST_SECRET nên route này đang tắt.' }, { status: 503 })
  }
  if (!authorizedAutopost(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await req.json().catch(() => null)
    const queueId = body?.queue_id
    if (!isUuid(queueId)) return NextResponse.json({ error: 'Thiếu queue_id.' }, { status: 400 })
    const success = body?.success === true
    const { supabaseAdmin } = await import('@/lib/supabase/admin')
    const { error } = await supabaseAdmin.rpc('report_post_result', {
      p_queue_id: queueId,
      p_success: success,
      p_gbp_post_name: body?.gbp_post_name ?? null,
      p_search_url: body?.search_url ?? null,
      p_http_status: body?.http_status ?? null,
      p_error_code: body?.error_code ?? null,
      p_error_message: body?.error_message ?? null,
      p_make_execution_id: body?.make_execution_id ?? null,
    })
    if (error) throw error
    return NextResponse.json({ ok: true })
  } catch (error: any) {
    return NextResponse.json({ error: publicError(error) }, { status: 500 })
  }
}
