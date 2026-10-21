// Đọc / đổi tùy chọn nhắc việc của chính người đang đăng nhập.
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { emailProviderReady } from '@/lib/notifications'

const TABLE_MISSING = '42P01'

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase.from('notification_prefs').select('email_enabled').eq('user_id', user.id).maybeSingle()
  // Chưa chạy migration 014: vẫn trả mặc định để trang Cài đặt hiện được, kèm cờ để báo người quản trị.
  const setupRequired = Boolean(error && (error.code === TABLE_MISSING || /notification_prefs/.test(error.message || '')))
  if (error && !setupRequired) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({
    email: user.email,
    email_enabled: data?.email_enabled ?? true,
    provider_ready: emailProviderReady(),
    setup_required: setupRequired,
  })
}

export async function PUT(req: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null)
  if (!body || typeof body.email_enabled !== 'boolean') {
    return NextResponse.json({ error: 'email_enabled phải là true hoặc false.' }, { status: 400 })
  }

  const { error } = await supabase
    .from('notification_prefs')
    .upsert({ user_id: user.id, email_enabled: body.email_enabled, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })

  if (error) {
    const missing = error.code === TABLE_MISSING || /notification_prefs/.test(error.message || '')
    return NextResponse.json(
      { error: missing ? 'Chưa bật được nhắc việc: cần chạy migration 014 trên database.' : error.message },
      { status: missing ? 503 : 500 },
    )
  }
  return NextResponse.json({ email_enabled: body.email_enabled })
}
