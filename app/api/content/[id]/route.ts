import { NextResponse } from 'next/server'
import {
  getContentById,
  updateContentStatus,
  getLatestContentHistory,
  saveContentHistory,
} from '@/lib/db'
import { requireActiveWorkspaceId } from '@/lib/auth'
import { autoWriteContentBatch } from '@/lib/write-content'

const ALLOWED_STATUS = ['drafted', 'waiting_approval', 'approved', 'published']

function parseEditNote(editNote: string | null | undefined) {
  if (!editNote) return { serp_analysis: '', ai_draft: '', critic_feedback: '' }
  try {
    const parsed = JSON.parse(editNote)
    return {
      serp_analysis: parsed.serp_analysis || '',
      ai_draft: parsed.ai_draft || '',
      critic_feedback: parsed.critic_feedback || '',
    }
  } catch {
    return { serp_analysis: '', ai_draft: '', critic_feedback: '' }
  }
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const workspaceId = await requireActiveWorkspaceId()
    const { id } = await params
    const content = await getContentById(id, workspaceId)
    const history = await getLatestContentHistory(id, workspaceId)

    const { serp_analysis, ai_draft, critic_feedback } = parseEditNote(history?.edit_note)

    return NextResponse.json({
      ...content,
      ai_content: history?.ai_version || ai_draft,
      final_content: history?.human_edited_version || history?.ai_version || '',
      serp_analysis,
      critic_feedback,
    })
  } catch (error: any) {
    const status = error.message?.includes('Unauthorized')
      ? 401
      : error.message?.includes('NoWorkspace')
        ? 409
        : 404
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

    let updatedStatus = null
    if (body.status !== undefined) {
      if (!ALLOWED_STATUS.includes(body.status)) {
        return NextResponse.json(
          { error: `status không hợp lệ. Chỉ chấp nhận: ${ALLOWED_STATUS.join(', ')}` },
          { status: 400 }
        )
      }
      updatedStatus = await updateContentStatus(id, body.status, workspaceId)
    }

    if (typeof body.final_content === 'string') {
      const content = updatedStatus || (await getContentById(id, workspaceId))
      const latest = await getLatestContentHistory(id, workspaceId)

      const note =
        body.status === 'approved'
          ? 'Chỉnh sửa và duyệt bài'
          : 'Lưu chỉnh sửa thủ công'

      await saveContentHistory({
        content_id: id,
        client_id: content.client_id,
        ai_version: latest?.ai_version ?? '',
        human_edited_version: body.final_content,
        edit_note: note,
        workspace_id: workspaceId,
      })
    }

    if (!updatedStatus && typeof body.final_content !== 'string') {
      return NextResponse.json(
        { error: 'Không có dữ liệu để cập nhật' },
        { status: 400 }
      )
    }

    // ===== KHI DUYỆT BÀI → TỰ VIẾT THÊM 1 BÀI MỚI =====
    if (body.status === 'approved') {
      try {
        const content = updatedStatus || (await getContentById(id, workspaceId))
        // Viết đúng 1 bài mới cho cùng khách hàng (nếu còn task content chưa viết)
        await autoWriteContentBatch(content.client_id, workspaceId, 1)
      } catch (err: any) {
        // Không làm fail request duyệt nếu viết bài mới lỗi
        console.error('Auto write after approve error:', err.message)
      }
    }

    const finalContent = await getContentById(id, workspaceId)
    return NextResponse.json(finalContent)
  } catch (error: any) {
    const status = error.message?.includes('Unauthorized')
      ? 401
      : error.message?.includes('NoWorkspace')
        ? 409
        : 500
    return NextResponse.json({ error: error.message }, { status })
  }
}
