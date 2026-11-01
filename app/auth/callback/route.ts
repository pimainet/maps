import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { safeInternalPath } from '@/lib/safe-redirect'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = safeInternalPath(searchParams.get('next'), origin)

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      return NextResponse.redirect(new URL(next, origin))
    }
  }

  // Lỗi → về trang login
  return NextResponse.redirect(`${origin}/login?error=auth_callback_error`)
}
