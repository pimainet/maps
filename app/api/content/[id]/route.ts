import { NextResponse } from 'next/server'
import {
  getContentById,
  updateContentStatus,
  getLatestContentHistory,
  saveContentHistory,
} from '@/lib/db'
import { requireActiveWorkspaceId } from '@/lib/auth'
import { autoWriteContentBatch } from '@/lib/write-content'

export const maxDuration = 300
export const runtime = 'nodejs'

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

      // published = xác nhận đã đăng trên Google → bắt buộc có nội dung
      if (body.status === 'published') {
        const existing = await getContentById(id, workspaceId)
        const latest = await getLatestContentHistory(id, workspaceId)
        const text =
          (typeof body.final_content === 'string' && body.final_content.trim()) ||
          latest?.human_edited_version ||
          latest?.ai_version ||
          ''
        if (!text.trim()) {
          return NextResponse.json(
            {
              error:
                'Chưa có nội dung bài để đánh dấu đã đăng. Hãy lưu/duyệt bài trước khi xác nhận đăng trên Google.',
            },
            { status: 400 }
          )
        }
      }

      updatedStatus = await updateContentStatus(id, body.status, workspaceId)

      if (body.status === 'published' && typeof body.final_content !== 'string') {
        const content = updatedStatus || (await getContentById(id, workspaceId))
        const latest = await getLatestContentHistory(id, workspaceId)
        await saveContentHistory({
          content_id: id,
          client_id: content.client_id,
          ai_version: latest?.ai_version ?? '',
          human_edited_version:
            latest?.human_edited_version || latest?.ai_version || '',
          edit_note: `Xác nhận đã đăng trên Google Maps · ${new Date().toISOString()}`,
          workspace_id: workspaceId,
        })
      }
    }

    if (typeof body.final_content === 'string') {
      const content = updatedStatus || (await getContentById(id, workspaceId))
      const latest = await getLatestContentHistory(id, workspaceId)

      const note =
        body.status === 'published'
          ? `Xác nhận đã đăng trên Google Maps · ${new Date().toISOString()}`
          : body.status === 'approved'
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
    let nextAutoWrite: any = null
    let nextAutoWriteError: string | null = null
    if (body.status === 'approved') {
      try {
        const content = updatedStatus || (await getContentById(id, workspaceId))
        const results = await autoWriteContentBatch(content.client_id, workspaceId, 1)
        nextAutoWrite = results
        const failed = results.find((r: any) => r.reason === 'error')
        if (failed) nextAutoWriteError = failed.error
      } catch (err: any) {
        nextAutoWriteError = err?.message || String(err)
        console.error('Auto write after approve error:', nextAutoWriteError)
      }
    }

    const finalContent = await getContentById(id, workspaceId)
    return NextResponse.json({
      ...finalContent,
      next_auto_write: nextAutoWrite,
      next_auto_write_error: nextAutoWriteError,
    })
  } catch (error: any) {
    const status = error.message?.includes('Unauthorized')
      ? 401
      : error.message?.includes('NoWorkspace')
        ? 409
        : 500
    return NextResponse.json({ error: error.message }, { status })
  }
}
