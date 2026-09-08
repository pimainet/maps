import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireActiveWorkspaceAdmin } from '@/lib/auth'

function statusFor(error: any) {
  if (error.message?.includes('Unauthorized')) return 401
  if (error.message?.includes('NoWorkspace')) return 409
  if (error.message?.includes('Forbidden')) return 403
  return 500
}

const ALLOWED_ROLES = ['owner', 'admin', 'member']

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const workspaceId = await requireActiveWorkspaceAdmin()
    const { id } = await params
    const body = await req.json()

    if (!ALLOWED_ROLES.includes(body.role)) {
      return NextResponse.json(
        { error: `role không hợp lệ. Chỉ chấp nhận: ${ALLOWED_ROLES.join(', ')}` },
        { status: 400 }
      )
    }

    const supabase = await createClient()
    const { data, error } = await supabase
      .from('workspace_members')
      .update({ role: body.role })
      .eq('id', id)
      .eq('workspace_id', workspaceId)
      .select('id, user_id, role')
      .single()

    if (error) throw error
    return NextResponse.json(data)
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: statusFor(error) })
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const workspaceId = await requireActiveWorkspaceAdmin()
    const { id } = await params

    const supabase = await createClient()

    // Không cho xoá owner cuối cùng của workspace (tránh workspace mồ côi)
    const { data: target } = await supabase
      .from('workspace_members')
      .select('id, role')
      .eq('id', id)
      .eq('workspace_id', workspaceId)
      .single()

    if (target?.role === 'owner') {
      const { count } = await supabase
        .from('workspace_members')
        .select('id', { count: 'exact', head: true })
        .eq('workspace_id', workspaceId)
        .eq('role', 'owner')

      if ((count ?? 0) <= 1) {
        return NextResponse.json(
          { error: 'Không thể xoá owner duy nhất của workspace' },
          { status: 400 }
        )
      }
    }

    const { error } = await supabase
      .from('workspace_members')
      .delete()
      .eq('id', id)
      .eq('workspace_id', workspaceId)

    if (error) throw error
    return NextResponse.json({ ok: true })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: statusFor(error) })
  }
}
