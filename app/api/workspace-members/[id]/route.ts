import { NextResponse } from 'next/server'
import { publicError } from '@/lib/api-error'
import { createClient } from '@/lib/supabase/server'
import { getActiveWorkspaceRole, isSuperAdmin, requireActiveWorkspaceAdmin } from '@/lib/auth'
import { readJsonObject } from '@/lib/request-body'

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
    const parsedBody = await readJsonObject(req)
    if (!parsedBody.ok) {
      return NextResponse.json({ error: parsedBody.error }, { status: parsedBody.status })
    }
    const body = parsedBody.value

    if (typeof body.role !== 'string' || !ALLOWED_ROLES.includes(body.role)) {
      return NextResponse.json(
        { error: `role không hợp lệ. Chỉ chấp nhận: ${ALLOWED_ROLES.join(', ')}` },
        { status: 400 }
      )
    }

    const actorRole = await getActiveWorkspaceRole()
    const canManageOwners = actorRole === 'owner' || await isSuperAdmin()
    const supabase = await createClient()
    const { data: target, error: targetError } = await supabase
      .from('workspace_members')
      .select('id, role')
      .eq('id', id)
      .eq('workspace_id', workspaceId)
      .maybeSingle()

    if (targetError) throw targetError
    if (!target) return NextResponse.json({ error: 'Không tìm thấy thành viên trong workspace.' }, { status: 404 })
    if (!canManageOwners && (target.role === 'owner' || body.role === 'owner')) {
      return NextResponse.json({ error: 'Chỉ owner mới được thay đổi vai trò owner.' }, { status: 403 })
    }
    if (target.role === 'owner' && body.role !== 'owner') {
      const { count, error: countError } = await supabase
        .from('workspace_members')
        .select('id', { count: 'exact', head: true })
        .eq('workspace_id', workspaceId)
        .eq('role', 'owner')
      if (countError) throw countError
      if ((count ?? 0) <= 1) {
        return NextResponse.json({ error: 'Không thể hạ vai trò owner duy nhất của workspace.' }, { status: 409 })
      }
    }

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
    return NextResponse.json({ error: publicError(error) }, { status: statusFor(error) })
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
    const actorRole = await getActiveWorkspaceRole()
    const canManageOwners = actorRole === 'owner' || await isSuperAdmin()

    // Không cho xoá owner cuối cùng của workspace (tránh workspace mồ côi)
    const { data: target, error: targetError } = await supabase
      .from('workspace_members')
      .select('id, role')
      .eq('id', id)
      .eq('workspace_id', workspaceId)
      .maybeSingle()

    if (targetError) throw targetError
    if (!target) return NextResponse.json({ error: 'Không tìm thấy thành viên trong workspace.' }, { status: 404 })
    if (target.role === 'owner' && !canManageOwners) {
      return NextResponse.json({ error: 'Chỉ owner mới được xóa thành viên có vai trò owner.' }, { status: 403 })
    }

    if (target?.role === 'owner') {
      const { count, error: countError } = await supabase
        .from('workspace_members')
        .select('id', { count: 'exact', head: true })
        .eq('workspace_id', workspaceId)
        .eq('role', 'owner')

      if (countError) throw countError
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
    return NextResponse.json({ error: publicError(error) }, { status: statusFor(error) })
  }
}
