import { NextResponse } from 'next/server'
import { getContents } from '@/lib/db'
import { requireActiveWorkspaceId } from '@/lib/auth'
import { writeContentForTask, writeAdHocContent } from '@/lib/write-content'

export const maxDuration = 300
export const runtime = 'nodejs'

export async function GET(req: Request) {
  try {
    const workspaceId = await requireActiveWorkspaceId()
    const { searchParams } = new URL(req.url)
    const clientId = searchParams.get('client_id') || undefined
    const data = await getContents(clientId, workspaceId)
    return NextResponse.json(data)
  } catch (error: any) {
    const status = error.message?.includes('Unauthorized') ? 401 : error.message?.includes('NoWorkspace') ? 409 : 500
    return NextResponse.json({ error: error.message }, { status })
  }
}

// POST: chạy pipeline AI viết 1 bài GBP post.
// AI chạy xong mới ghi DB — tránh kẹt drafted trống khi Claude lỗi / timeout.
//
// LƯU Ý: logic viết bài THẬT nằm ở lib/write-content.ts (writeContentForTask /
// writeAdHocContent), dùng CHUNG với đường auto-write khi duyệt bài
// (app/api/content/[id]/route.ts PATCH) và đường sinh lịch việc
// (app/api/tasks/generate-from-plan). Route này chỉ nhận request, gọi
// đúng 1 trong 2 hàm đó — KHÔNG tự viết lại prompt/pipeline ở đây, để
// tránh 2 nơi lặp code rồi lệch nhau (rate limit, critic... đã từng bị
// thiếu ở 1 trong 2 chỗ vì lý do này).
export async function POST(req: Request) {
  try {
    const workspaceId = await requireActiveWorkspaceId()
    const body = await req.json()

    const clientInfo = {
      name: body.business_name || '',
      industry: body.industry || '',
      area: body.area || '',
      brand_voice: body.brand_voice || 'chuyên nghiệp, gần gũi',
      phone: body.phone || '',
      notes: body.extra_info || '',
    }

    if (body.task_id) {
      const result = await writeContentForTask(body.task_id, workspaceId, clientInfo)

      if (result.skipped) {
        return NextResponse.json({ error: 'Task này đã có bài viết', content: (result as any).content }, { status: 409 })
      }

      return NextResponse.json({
        content: result.content,
        serp_analysis: result.serp_analysis,
        ai_content: result.ai_content,
        critic_feedback: result.critic_feedback,
        final_content: result.final_content,
      })
    }

    if (!body.client_id || !body.topic) {
      return NextResponse.json({ error: 'Thiếu client_id hoặc topic' }, { status: 400 })
    }

    const result = await writeAdHocContent({
      clientId: body.client_id,
      planId: body.plan_id,
      topic: body.topic,
      goal: body.goal,
      workspaceId,
      clientInfo,
    })

    return NextResponse.json({
      content: result.content,
      serp_analysis: result.serp_analysis,
      ai_content: result.ai_content,
      critic_feedback: result.critic_feedback,
      final_content: result.final_content,
    })
  } catch (error: any) {
    const status = error.message?.includes('Unauthorized')
      ? 401
      : error.message?.includes('NoWorkspace')
        ? 409
        : error.message?.includes('RateLimited')
          ? 429
          : 500
    return NextResponse.json(
      { error: error.message || 'Unknown error' },
      { status }
    )
  }
}
