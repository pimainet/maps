import { NextResponse } from 'next/server'
import { getCurrentUser, setActiveWorkspaceId, getActiveWorkspaceId } from '@/lib/auth'

export async function GET() {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const activeWorkspaceId = await getActiveWorkspaceId()
    return NextResponse.json({ activeWorkspaceId })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const workspaceId = body.workspace_id
    if (!workspaceId) {
      return NextResponse.json({ error: 'Thiếu workspace_id' }, { status: 400 })
    }

    const ok = await setActiveWorkspaceId(workspaceId)
    if (!ok) {
      return NextResponse.json(
        { error: 'Bạn không phải thành viên của workspace này' },
        { status: 403 }
      )
    }

    return NextResponse.json({ ok: true, activeWorkspaceId: workspaceId })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
