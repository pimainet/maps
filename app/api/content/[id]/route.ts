import { NextResponse } from 'next/server'
import { getContentById, updateContent, saveContentHistory } from '@/lib/db'

const ALLOWED_STATUS = ['idea', 'drafted', 'waiting_approval', 'approved', 'published']

export async function GET(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const data = await getContentById(params.id)
    return NextResponse.json(data)
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
    const patch: { final_content?: string; status?: string } = {}

    if (typeof body.final_content === 'string') {
      patch.final_content = body.final_content
    }

    if (body.status !== undefined) {
      if (!ALLOWED_STATUS.includes(body.status)) {
        return NextResponse.json(
          { error: `status không hợp lệ. Chỉ chấp nhận: ${ALLOWED_STATUS.join(', ')}` },
          { status: 400 }
        )
      }
      patch.status = body.status
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json(
        { error: 'Không có dữ liệu để cập nhật' },
        { status: 400 }
      )
    }

    // Lấy bản ghi trước khi cập nhật để biết bản AI gốc, phục vụ ghi lịch sử
    const before = await getContentById(params.id)

    const updated = await updateContent(params.id, patch)

    // Chỉ ghi content_history khi thực sự có thay đổi nội dung final_content
    // (không ghi khi chỉ đổi status, ví dụ "Đánh dấu đã đăng")
    if (patch.final_content !== undefined) {
      const note =
        patch.status === 'approved'
          ? 'Chỉnh sửa và duyệt bài'
          : 'Lưu chỉnh sửa thủ công'

      await saveContentHistory({
        content_id: params.id,
        client_id: updated.client_id,
        ai_version: before.ai_content ?? '',
        human_edited_version: patch.final_content,
        edit_note: note,
      })
    }

    return NextResponse.json(updated)
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
