import { NextResponse } from 'next/server'
import {
  getContentById,
  updateContentStatus,
  getLatestContentHistory,
  saveContentHistory,
} from '@/lib/db'

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
    // edit_note của các dòng lịch sử "lưu chỉnh sửa" là text mô tả thường,
    // không phải JSON — trường hợp này không có dữ liệu trung gian để hiện.
    return { serp_analysis: '', ai_draft: '', critic_feedback: '' }
  }
}

export async function GET(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const content = await getContentById(params.id)
    const history = await getLatestContentHistory(params.id)

    // Tìm dòng lịch sử GẦN NHẤT có chứa dữ liệu sinh AI (serp_analysis/
    // ai_draft/critic_feedback) để hiển thị, vì dòng mới nhất có thể chỉ
    // là 1 lần "lưu chỉnh sửa" (edit_note dạng text, không có JSON đó).
    const { serp_analysis, ai_draft, critic_feedback } = parseEditNote(history?.edit_note)

    return NextResponse.json({
      ...content,
      ai_content: history?.ai_version || ai_draft,
      final_content: history?.human_edited_version || history?.ai_version || '',
      serp_analysis,
      critic_feedback,
    })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 404 })
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const body = await req.json()

    let updatedStatus = null
    if (body.status !== undefined) {
      if (!ALLOWED_STATUS.includes(body.status)) {
        return NextResponse.json(
          { error: `status không hợp lệ. Chỉ chấp nhận: ${ALLOWED_STATUS.join(', ')}` },
          { status: 400 }
        )
      }
      updatedStatus = await updateContentStatus(params.id, body.status)
    }

    if (typeof body.final_content === 'string') {
      const content = updatedStatus || (await getContentById(params.id))
      const latest = await getLatestContentHistory(params.id)

      const note =
        body.status === 'approved'
          ? 'Chỉnh sửa và duyệt bài'
          : 'Lưu chỉnh sửa thủ công'

      await saveContentHistory({
        content_id: params.id,
        client_id: content.client_id,
        ai_version: latest?.ai_version ?? '',
        human_edited_version: body.final_content,
        edit_note: note,
      })
    }

    if (!updatedStatus && typeof body.final_content !== 'string') {
      return NextResponse.json(
        { error: 'Không có dữ liệu để cập nhật' },
        { status: 400 }
      )
    }

    const finalContent = await getContentById(params.id)
    return NextResponse.json(finalContent)
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
