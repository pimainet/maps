import { NextResponse } from 'next/server'
import { requireActiveWorkspaceId } from '@/lib/auth'
import {
  getTaskById,
  getContentByTaskId,
  getLatestContentHistory,
  getGoogleConnection,
  updateTaskStatus,
  updateContentStatus,
} from '@/lib/db'
import { getTaskGuidance } from '@/lib/task-action'
import { getValidAccessToken, createLocalPost, GbpApiError } from '@/lib/gbp-business-api'

export const maxDuration = 60
export const runtime = 'nodejs'

/**
 * POST /api/tasks/:id/execute
 *
 * Khách bấm vào 1 task trên UI gọi route này:
 *  - task_type='content' (có bản nháp đã duyệt) -> bot tự đăng lên Google
 *    Maps thật, cập nhật status task + content.
 *  - Các task_type khác -> KHÔNG thực thi gì, trả về hướng dẫn thủ công +
 *    lý do vì sao không tự động (lib/task-action.ts) để UI hiển thị.
 *
 * Quan trọng: route này KHÔNG tự chuyển task sang 'done' cho việc thủ công
 * — khách phải tự đánh dấu hoàn thành sau khi thực sự làm xong ở Google
 * (route này chỉ đưa hướng dẫn, không biết khách đã làm thật chưa).
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const workspaceId = await requireActiveWorkspaceId()
    const { id: taskId } = await params

    const task = await getTaskById(taskId, workspaceId)
    if (!task) {
      return NextResponse.json({ error: 'Không tìm thấy công việc này.' }, { status: 404 })
    }

    const guidance = getTaskGuidance(task.task_type)

    if (guidance.actionType === 'manual_guided') {
      return NextResponse.json({
        ok: true,
        executed: false,
        actionType: 'manual_guided',
        whyManual: guidance.whyManual,
        steps: guidance.steps,
      })
    }

    // ---- actionType === 'auto_post' ----

    const content = await getContentByTaskId(taskId, workspaceId)
    if (!content) {
      return NextResponse.json(
        { error: 'Công việc này chưa có bản nháp nội dung để đăng — thử lại sau khi hệ thống viết xong bản nháp.' },
        { status: 409 },
      )
    }
    if (!['approved', 'waiting_approval'].includes(content.status)) {
      return NextResponse.json(
        {
          error:
            content.status === 'published'
              ? 'Bài này đã được đăng trước đó rồi.'
              : 'Bản nháp chưa được duyệt — xem lại nội dung trước khi đăng.',
        },
        { status: 409 },
      )
    }

    const history = await getLatestContentHistory(content.id, workspaceId)
    const textToPost: string | undefined = history?.human_edited_version || history?.ai_version
    if (!textToPost) {
      return NextResponse.json({ error: 'Không tìm thấy nội dung bản nháp để đăng.' }, { status: 409 })
    }

    const conn = await getGoogleConnection(task.client_id, workspaceId)
    if (!conn || conn.status !== 'connected') {
      return NextResponse.json(
        {
          ok: true,
          executed: false,
          actionType: 'needs_connection',
          message: 'Chưa kết nối Google Business Profile — kết nối trước để bot tự đăng được.',
        },
        { status: 200 },
      )
    }
    if (!conn.gbp_location_resource) {
      return NextResponse.json(
        { error: 'Chưa xác định được địa điểm Google Business Profile của bạn — thử ngắt kết nối rồi kết nối lại.' },
        { status: 409 },
      )
    }

    const accessToken = await getValidAccessToken(conn)
    const posted = await createLocalPost(conn.gbp_location_resource, accessToken, textToPost)

    await updateContentStatus(content.id, 'published', workspaceId)
    await updateTaskStatus(taskId, 'done', workspaceId)

    return NextResponse.json({
      ok: true,
      executed: true,
      actionType: 'auto_post',
      postedTo: posted.name,
    })
  } catch (error: any) {
    if (error instanceof GbpApiError) {
      // Lỗi đã được phân loại rõ (not_verified/posts_disabled/token_revoked) —
      // trả thẳng message tiếng Việt đã viết sẵn cho khách đọc được, không
      // phải lỗi kỹ thuật mù mờ.
      return NextResponse.json({ error: error.message, code: error.code }, { status: 422 })
    }
    const status = error.message?.includes('Unauthorized') ? 401 : error.message?.includes('NoWorkspace') ? 409 : 500
    return NextResponse.json({ error: error.message || 'Lỗi thực thi công việc.' }, { status })
  }
}
