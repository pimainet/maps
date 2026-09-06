import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET() {
  try {
    const supabase = await createClient()
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('id, workspace_id, full_name, role, avatar_url')
      .eq('id', user.id)
      .single()

    let workspace = null
    if (profile?.workspace_id) {
      const { data: ws } = await supabase
        .from('workspaces')
        .select('id, name, plan')
        .eq('id', profile.workspace_id)
        .single()
      workspace = ws
    }

    return NextResponse.json({
      user: {
        id: user.id,
        email: user.email,
      },
      profile,
      workspace,
    })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
