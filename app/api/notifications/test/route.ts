// "Gửi thử cho tôi": gửi email nhắc thật (dùng việc thật của chính người dùng) tới email đăng nhập của họ.
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getUserWorkspaces } from '@/lib/auth'
import { emailProviderReady, sendEmail, unsubscribeUrl } from '@/lib/notifications'
import { buildEmailForUser, loadWorkspaceData } from '@/lib/reminders'

export const runtime = 'nodejs'
export const maxDuration = 30

const MIN_SECONDS_BETWEEN_TESTS = 60

export async function POST() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user || !user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!emailProviderReady()) {
    return NextResponse.json(
      { error: 'Hệ thống chưa được cấu hình dịch vụ gửi email nên chưa gửi được. Hãy nhờ người quản trị thiết lập.' },
      { status: 503 },
    )
  }

  // Chặn bấm liên tục (mỗi lần gửi đều tốn hạn mức email). Bỏ qua nếu chưa có cột/bảng.
  const { data: prefs } = await supabase.from('notification_prefs').select('last_test_at').eq('user_id', user.id).maybeSingle()
  if (prefs?.last_test_at && Date.now() - new Date(prefs.last_test_at).getTime() < MIN_SECONDS_BETWEEN_TESTS * 1000) {
    return NextResponse.json({ error: 'Bạn vừa gửi thử xong. Đợi khoảng 1 phút rồi thử lại.' }, { status: 429 })
  }

  try {
    const memberships = await getUserWorkspaces()
    const workspaceIds = memberships.map((m) => m.workspace_id)
    const { supabaseAdmin: admin } = await import('@/lib/supabase/admin')
    const data = await loadWorkspaceData(admin, workspaceIds)
    const { data: profile } = await supabase.from('profiles').select('full_name').eq('id', user.id).maybeSingle()

    const email = buildEmailForUser({ userId: user.id, fullName: profile?.full_name, workspaceIds, data, force: true })
    if (!email) return NextResponse.json({ error: 'Không dựng được email thử.' }, { status: 500 })

    const sent = await sendEmail({ to: user.email, subject: email.subject, html: email.html, text: email.text, unsubscribeUrl: unsubscribeUrl(user.id) })
    if (!sent.ok) return NextResponse.json({ error: sent.error || 'Không gửi được email. Kiểm tra cấu hình dịch vụ gửi email.' }, { status: 502 })

    await supabase.from('notification_prefs').upsert({ user_id: user.id, last_test_at: new Date().toISOString(), updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
    return NextResponse.json({ ok: true, to: user.email })
  } catch (e: any) {
    console.error('notifications test:', e?.message)
    return NextResponse.json({ error: 'Không gửi thử được. Thử lại sau ít phút.' }, { status: 500 })
  }
}
