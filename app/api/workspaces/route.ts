import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getUserWorkspaces, getCurrentUser, setActiveWorkspaceId } from '@/lib/auth'
import { readJsonObject } from '@/lib/request-body'

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

// Tạo workspace bằng user session để trigger on_workspace_created có auth.uid().
// Migration 016 cho phép tạo workspace free và chặn client tự gán gói trả phí.
export async function POST(req: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsedBody = await readJsonObject(req)
    if (!parsedBody.ok) {
      return NextResponse.json({ error: parsedBody.error }, { status: parsedBody.status })
    }
    const rawName = parsedBody.value.name
    if (typeof rawName !== 'string') {
      return NextResponse.json({ error: 'Tên workspace không hợp lệ.' }, { status: 400 })
    }
    const name = rawName.trim()
    if (!name) {
      return NextResponse.json({ error: 'Tên workspace là bắt buộc' }, { status: 400 })
    }
    if (name.length > 120) {
      return NextResponse.json({ error: 'Tên workspace không được vượt quá 120 ký tự.' }, { status: 400 })
    }

    const supabase = await createClient()
    const { data, error } = await supabase
      .from('workspaces')
      // Keep plan assignment server-controlled; the database default is free.
      .insert({ name })
      .select('id, name, plan')
      .single()

    if (error) throw error

    // Chuyển luôn sang workspace vừa tạo làm workspace đang làm việc
    await setActiveWorkspaceId(data.id)

    return NextResponse.json(data)
  } catch (error: any) {
    console.error('workspace create failed:', error?.message || error)
    if (error?.code === '42501') {
      return NextResponse.json(
        { error: 'Database chưa cấp quyền tạo workspace. Hãy nhờ quản trị viên kiểm tra policy.' },
        { status: 503 },
      )
    }
    return NextResponse.json({ error: 'Không tạo được workspace lúc này.' }, { status: 500 })
  }
}
