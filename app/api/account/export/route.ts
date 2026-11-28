// Tải về dữ liệu của tôi (JSON). Quyền xem / được cung cấp dữ liệu — Luật 91/2025/QH15 Điều 4; hạn 10 ngày (NĐ 356 Điều 5) -> trả ngay.
import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { publicError } from '@/lib/api-error'
import { buildUserExport } from '@/lib/privacy/export'
import { requestDueAt } from '@/lib/privacy/policy'
import { isMissingRelationError } from '@/lib/privacy/db-compat'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET() {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { supabaseAdmin } = await import('@/lib/supabase/admin')

    // Giới hạn 5 lần / 24 giờ (bản xuất có thể lớn). Chưa có bảng data_requests thì vẫn cho xuất.
    const since = new Date(Date.now() - 86_400_000).toISOString()
    const recent = await supabaseAdmin
      .from('data_requests')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('kind', 'export')
      .gte('received_at', since)
    if (!recent.error && (recent.count || 0) >= 5) {
      return NextResponse.json({ error: 'Bạn đã tải dữ liệu 5 lần trong 24 giờ, vui lòng thử lại sau.' }, { status: 429 })
    }

    const payload = await buildUserExport(supabaseAdmin, user)
    const now = new Date()
    const log = await supabaseAdmin.from('data_requests').insert({
      user_id: user.id,
      kind: 'export',
      status: 'done',
      acknowledged_at: now.toISOString(),
      due_at: requestDueAt('export', now).toISOString(),
      completed_at: now.toISOString(),
    })
    if (log.error && !isMissingRelationError(log.error)) console.error('export log failed:', log.error.message)

    const day = now.toISOString().slice(0, 10)
    return new NextResponse(JSON.stringify(payload, null, 2), {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="local-growth-os-du-lieu-${day}.json"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    return NextResponse.json({ error: publicError(error) }, { status: 500 })
  }
}
