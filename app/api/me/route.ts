import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getUserWorkspaces, getActiveWorkspaceId } from '@/lib/auth'
import { getWorkspaceClientLimit } from '@/lib/db'

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
      .select('id, full_name, avatar_url, is_superadmin')
      .eq('id', user.id)
      .single()

    const memberships = await getUserWorkspaces()
    const activeWorkspaceId = await getActiveWorkspaceId()
    const active = memberships.find((m) => m.workspace_id === activeWorkspaceId) || null

    let clientLimit = null
    if (activeWorkspaceId) {
      try {
        clientLimit = await getWorkspaceClientLimit(activeWorkspaceId)
      } catch {
        // Không chặn /api/me nếu truy vấn giới hạn lỗi — frontend coi
        // như chưa biết giới hạn, không ẩn nút (RLS vẫn chặn cứng ở DB)
      }
    }

    return NextResponse.json({
      user: {
        id: user.id,
        email: user.email,
      },
      profile,
      // Danh sách toàn bộ workspace user thuộc về (cho workspace switcher)
      workspaces: memberships.map((m) => ({
        id: m.workspace.id,
        name: m.workspace.name,
        plan: m.workspace.plan,
        role: m.role,
      })),
      // Workspace đang được chọn làm việc cho session này
      activeWorkspace: active?.workspace || null,
      activeRole: active?.role || null,
      // Giới hạn số doanh nghiệp (clients) của workspace đang chọn
      clientLimit,
    })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
