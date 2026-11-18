import { NextResponse } from 'next/server'
import { publicError } from '@/lib/api-error'
import { getTaskById, updateTaskStatus } from '@/lib/db'
import { requireActiveWorkspaceId } from '@/lib/auth'
import { isTaskUnlocked, LOCKED_RESPONSE } from '@/lib/billing/server'

const ALLOWED_STATUS = ['pending', 'done', 'skipped']

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const workspaceId = await requireActiveWorkspaceId()
    const { id } = await params
    const data = await getTaskById(id, workspaceId)
    if (data && !(await isTaskUnlocked(workspaceId, data as any))) return NextResponse.json(LOCKED_RESPONSE, { status: 402 })
    return NextResponse.json(data)
  } catch (error: any) {
    const status = error.message?.includes('Unauthorized') ? 401 : error.message?.includes('NoWorkspace') ? 409 : 404
    return NextResponse.json({ error: publicError(error) }, { status })
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const workspaceId = await requireActiveWorkspaceId()
    const { id } = await params
    const body = await req.json()
    if (!ALLOWED_STATUS.includes(body.status)) {
      return NextResponse.json(
        { error: `status không hợp lệ. Chỉ chấp nhận: ${ALLOWED_STATUS.join(', ')}` },
        { status: 400 }
      )
    }

    const existing = await getTaskById(id, workspaceId)
    if (existing && !(await isTaskUnlocked(workspaceId, existing as any))) return NextResponse.json(LOCKED_RESPONSE, { status: 402 })
    const updated = await updateTaskStatus(id, body.status, workspaceId)
    return NextResponse.json(updated)
  } catch (error: any) {
    const status = error.message?.includes('Unauthorized') ? 401 : error.message?.includes('NoWorkspace') ? 409 : 500
    return NextResponse.json(
      {
        error: publicError(error, 'Không cập nhật được trạng thái công việc.'),
      },
      { status }
    )
  }
}
