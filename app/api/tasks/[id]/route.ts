import { NextResponse } from 'next/server'
import { getTaskById, updateTaskStatus } from '@/lib/db'
import { requireActiveWorkspaceId } from '@/lib/auth'

const ALLOWED_STATUS = ['pending', 'done', 'skipped']

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const workspaceId = await requireActiveWorkspaceId()
    const { id } = await params
    const data = await getTaskById(id, workspaceId)
    return NextResponse.json(data)
  } catch (error: any) {
    const status = error.message?.includes('Unauthorized') ? 401 : error.message?.includes('NoWorkspace') ? 409 : 404
    return NextResponse.json({ error: error.message }, { status })
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

    const updated = await updateTaskStatus(id, body.status, workspaceId)
    return NextResponse.json(updated)
  } catch (error: any) {
    const status = error.message?.includes('Unauthorized') ? 401 : error.message?.includes('NoWorkspace') ? 409 : 500
    return NextResponse.json(
      {
        error: `${error.message} (kiểm tra đã chạy migration thêm cột status vào bảng tasks chưa)`,
      },
      { status }
    )
  }
}
