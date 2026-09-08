import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireActiveWorkspaceId, requireActiveWorkspaceAdmin } from '@/lib/auth'

function statusFor(error: any) {
  if (error.message?.includes('Unauthorized')) return 401
  if (error.message?.includes('NoWorkspace')) return 409
  if (error.message?.includes('Forbidden')) return 403
  return 500
}

export async function GET() {
  try {
    const workspaceId = await requireActiveWorkspaceId()
    const supabase = await createClient()

    const { data: members, error } = await supabase
      .from('workspace_members')
      .select('id, user_id, role, created_at, profile:profiles(full_name, avatar_url)')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: true })

    if (error) throw error

    // Ghép thêm email (không có trong bảng profiles) qua hàm RPC riêng
    const { data: emails } = await supabase.rpc('list_workspace_member_emails', {
      ws_id: workspaceId,
    })
    const emailByUserId: Record<string, string> = {}
    ;(emails || []).forEach((e: any) => {
      emailByUserId[e.user_id] = e.email
    })

    const result = (members || []).map((m: any) => ({
      id: m.id,
      user_id: m.user_id,
      role: m.role,
      created_at: m.created_at,
      full_name: m.profile?.full_name || null,
      avatar_url: m.profile?.avatar_url || null,
      email: emailByUserId[m.user_id] || null,
    }))

    return NextResponse.json(result)
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: statusFor(error) })
  }
}

// Mời 1 user đã có tài khoản (bằng email) vào workspace đang chọn.
// Chỉ owner/admin của workspace mới được mời.
export async function POST(req: Request) {
  try {
    const workspaceId = await requireActiveWorkspaceAdmin()
    const body = await req.json()
    const email = (body.email || '').trim()
    const role = ['member', 'admin'].includes(body.role) ? body.role : 'member'

    if (!email) {
      return NextResponse.json({ error: 'Thiếu email' }, { status: 400 })
    }

    const supabase = await createClient()

    const { data: userId, error: lookupError } = await supabase.rpc(
      'find_user_id_by_email',
      { p_email: email }
    )
    if (lookupError) throw lookupError

    if (!userId) {
      return NextResponse.json(
        { error: 'Không tìm thấy tài khoản nào với email này. Người dùng cần đăng ký trước khi được mời.' },
        { status: 404 }
      )
    }

    const { data, error } = await supabase
      .from('workspace_members')
      .insert({ workspace_id: workspaceId, user_id: userId, role })
      .select('id, user_id, role, created_at')
      .single()

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json(
          { error: 'Người này đã là thành viên của workspace' },
          { status: 409 }
        )
      }
      throw error
    }

    return NextResponse.json(data)
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: statusFor(error) })
  }
}
