import { NextResponse } from 'next/server'
import { askClaude } from '@/lib/claude'
import {
  getContents,
  getTaskById,
  createContentForTask,
  createAdHocContent,
  getContentByTaskId,
  updateContentStatus,
  saveContentHistory,
  getLatestContentHistory,
  deleteContentById,
} from '@/lib/db'
import {
  WRITER_COMPACT_PROMPT,
  REFINE_LIGHT_PROMPT,
} from '@/lib/prompts'
import { requireActiveWorkspaceId } from '@/lib/auth'

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
export async function POST(req: Request) {
  try {
    const workspaceId = await requireActiveWorkspaceId()
    const body = await req.json()

    let topic = body.topic
    let goal = body.goal
    let task: any = null
    let existingContent: any = null

    if (body.task_id) {
      task = await getTaskById(body.task_id, workspaceId)
      if (task.task_type !== 'content') {
        return NextResponse.json(
          { error: 'Task này không phải loại "content", không thể viết bài AI cho việc này' },
          { status: 400 }
        )
      }
      topic = task.title
      goal = task.description

      existingContent = await getContentByTaskId(task.id, workspaceId)
      if (existingContent) {
        const history = await getLatestContentHistory(existingContent.id, workspaceId)
        const hasText =
          !!(history?.ai_version && history.ai_version.trim()) ||
          !!(history?.human_edited_version && history.human_edited_version.trim())

        if (
          hasText ||
          existingContent.status === 'waiting_approval' ||
          existingContent.status === 'approved' ||
          existingContent.status === 'published'
        ) {
          return NextResponse.json(
            {
              error: 'Task này đã có bài viết',
              content: existingContent,
            },
            { status: 409 }
          )
        }
        // drafted trống → xóa để viết lại
        await deleteContentById(existingContent.id, workspaceId)
        existingContent = null
      }
    } else {
      if (!body.client_id || !topic) {
        return NextResponse.json(
          { error: 'Thiếu client_id hoặc topic' },
          { status: 400 }
        )
      }
    }

    // Pipeline compact: 2 lần Claude (writer + refine nhẹ)
    const writerPrompt = WRITER_COMPACT_PROMPT
      .replaceAll('{{business_name}}', body.business_name || '')
      .replaceAll('{{industry}}', body.industry || '')
      .replaceAll('{{area}}', body.area || '')
      .replaceAll('{{topic}}', topic || '')
      .replaceAll('{{goal}}', goal || '')
      .replaceAll('{{brand_voice}}', body.brand_voice || 'chuyên nghiệp, gần gũi')
      .replaceAll('{{phone}}', body.phone || '')
      .replaceAll('{{extra_info}}', body.extra_info || '')

    const ai_content = await askClaude(writerPrompt, { maxTokens: 1200, temperature: 0.65 })

    const refinePrompt = REFINE_LIGHT_PROMPT
      .replaceAll('{{ai_content}}', ai_content)
      .replaceAll('{{business_name}}', body.business_name || '')
      .replaceAll('{{industry}}', body.industry || '')
      .replaceAll('{{area}}', body.area || '')
      .replaceAll('{{phone}}', body.phone || '')
      .replaceAll('{{extra_info}}', body.extra_info || '')

    const final_content = await askClaude(refinePrompt, { maxTokens: 1200, temperature: 0.4 })
    const serp_analysis = ''
    const critic_feedback = ''

    // 5. Lưu DB sau khi AI thành công
    let contentRow: any
    if (task) {
      contentRow = await createContentForTask({
        ...task,
        workspace_id: workspaceId,
      })
    } else {
      contentRow = await createAdHocContent({
        client_id: body.client_id,
        plan_id: body.plan_id,
        topic,
        workspace_id: workspaceId,
      })
    }

    const updatedContent = await updateContentStatus(contentRow.id, 'waiting_approval', workspaceId)

    await saveContentHistory({
      content_id: contentRow.id,
      client_id: contentRow.client_id,
      ai_version: final_content,
      edit_note: JSON.stringify({ pipeline: 'compact_v1', serp_analysis, ai_draft: ai_content, critic_feedback }),
      workspace_id: workspaceId,
    })

    return NextResponse.json({
      content: updatedContent,
      serp_analysis,
      ai_content,
      critic_feedback,
      final_content,
    })
  } catch (error: any) {
    const status = error.message?.includes('Unauthorized') ? 401 : error.message?.includes('NoWorkspace') ? 409 : 500
    return NextResponse.json(
      { error: error.message || 'Unknown error' },
      { status }
    )
  }
}
