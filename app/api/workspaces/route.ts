import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getUserWorkspaces, getCurrentUser, setActiveWorkspaceId } from '@/lib/auth'

export async function GET() {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const memberships = await getUserWorkspaces()
    return NextResponse.json(
      memberships.map((m) => ({
        id: m.workspace.id,
        name: m.workspace.name,
        plan: m.workspace.plan,
        role: m.role,
      }))
    )
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// Tạo workspace mới. RLS cho phép mọi user đã đăng nhập insert vào
// `workspaces` (with_check true); trigger `on_workspace_created` ở DB
// tự động thêm người tạo vào workspace_members với role 'owner' —
// giải quyết vấn đề "chưa là admin thì không tự thêm mình vào member
// được" (xem migration 003, phần 5).
export async function POST(req: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const name = (body.name || '').trim()
    if (!name) {
      return NextResponse.json({ error: 'Tên workspace là bắt buộc' }, { status: 400 })
    }

    const supabase = await createClient()
    const { data, error } = await supabase
      .from('workspaces')
      .insert({ name, plan: body.plan || 'free' })
      .select('id, name, plan')
      .single()

    if (error) throw error

    // Chuyển luôn sang workspace vừa tạo làm workspace đang làm việc
    await setActiveWorkspaceId(data.id)

    return NextResponse.json(data)
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
