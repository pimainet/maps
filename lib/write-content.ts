import { askClaude } from '@/lib/claude'
import {
  getTaskById,
  getContentByTaskId,
  createContentForTask,
  updateContentStatus,
  saveContentHistory,
  getTasks,
  getContents,
  getClientById,
  getLatestContentHistory,
  deleteContentById,
} from '@/lib/db'
import {
  SERP_AWARE_PROMPT,
  WRITER_PROMPT,
  CRITIC_PROMPT,
  REFINER_PROMPT,
} from '@/lib/prompts'

type ClientInfo = {
  name?: string
  industry?: string
  area?: string
  brand_voice?: string
  phone?: string
  notes?: string
}

async function runAiPipeline(
  topic: string,
  goal: string,
  info: ClientInfo | undefined
) {
  const serpPrompt = SERP_AWARE_PROMPT
    .replaceAll('{{industry}}', info?.industry || '')
    .replaceAll('{{area}}', info?.area || '')
    .replaceAll('{{topic}}', topic || '')
    .replaceAll('{{goal}}', goal || '')
    .replaceAll('{{business_name}}', info?.name || '')

  const serp_analysis = await askClaude(serpPrompt)

  const writerPrompt = WRITER_PROMPT
    .replaceAll('{{business_name}}', info?.name || '')
    .replaceAll('{{industry}}', info?.industry || '')
    .replaceAll('{{area}}', info?.area || '')
    .replaceAll('{{topic}}', topic || '')
    .replaceAll('{{goal}}', goal || '')
    .replaceAll('{{brand_voice}}', info?.brand_voice || 'chuyên nghiệp, gần gũi')
    .replaceAll('{{phone}}', info?.phone || '')
    .replaceAll('{{extra_info}}', info?.notes || '')
    .replaceAll('{{serp_analysis}}', serp_analysis)

  const ai_content = await askClaude(writerPrompt)

  const criticPrompt = CRITIC_PROMPT.replaceAll('{{ai_content}}', ai_content)
  const critic_feedback = await askClaude(criticPrompt)

  const refinerPrompt = REFINER_PROMPT
    .replaceAll('{{ai_content}}', ai_content)
    .replaceAll('{{critic_feedback}}', critic_feedback)
    .replaceAll('{{business_name}}', info?.name || '')
    .replaceAll('{{industry}}', info?.industry || '')
    .replaceAll('{{area}}', info?.area || '')
    .replaceAll('{{phone}}', info?.phone || '')
    .replaceAll('{{extra_info}}', info?.notes || '')

  const final_content = await askClaude(refinerPrompt)

  return { serp_analysis, ai_content, critic_feedback, final_content }
}

/**
 * Viết 1 bài GBP cho 1 task content và đưa vào trạng thái waiting_approval.
 * - Chạy AI xong mới tạo/cập nhật content (tránh kẹt drafted trống khi Claude lỗi).
 * - Nếu đã có content + history hợp lệ thì bỏ qua.
 * - Nếu chỉ có bản drafted trống (lỗi lần trước) thì xóa và viết lại.
 */
export async function writeContentForTask(
  taskId: string,
  workspaceId: string,
  clientInfo?: ClientInfo
) {
  const task = await getTaskById(taskId, workspaceId)
  if (task.task_type !== 'content') {
    return { skipped: true, reason: 'not_content_task' }
  }

  const existing = await getContentByTaskId(task.id, workspaceId)
  if (existing) {
    const history = await getLatestContentHistory(existing.id, workspaceId)
    const hasText =
      !!(history?.ai_version && history.ai_version.trim()) ||
      !!(history?.human_edited_version && history.human_edited_version.trim())

    if (hasText || existing.status === 'waiting_approval' || existing.status === 'approved' || existing.status === 'published') {
      return { skipped: true, reason: 'already_has_content', content: existing }
    }

    // Bản drafted trống từ lần fail trước → xóa để viết lại
    await deleteContentById(existing.id, workspaceId)
  }

  let info = clientInfo
  if (!info) {
    const client = await getClientById(task.client_id, workspaceId)
    info = {
      name: client?.name,
      industry: client?.industry,
      area: client?.area,
      brand_voice: client?.brand_voice,
      phone: client?.phone,
      notes: client?.notes,
    }
  }

  const topic = task.title
  const goal = task.description || ''

  // 1–4. AI pipeline TRƯỚC khi ghi DB
  const { serp_analysis, ai_content, critic_feedback, final_content } =
    await runAiPipeline(topic, goal, info)

  // 5. Lưu DB sau khi AI thành công
  const contentRow = await createContentForTask({
    ...task,
    workspace_id: workspaceId,
  })

  const updatedContent = await updateContentStatus(
    contentRow.id,
    'waiting_approval',
    workspaceId
  )

  await saveContentHistory({
    content_id: contentRow.id,
    client_id: contentRow.client_id,
    ai_version: final_content,
    edit_note: JSON.stringify({
      serp_analysis,
      ai_draft: ai_content,
      critic_feedback,
    }),
    workspace_id: workspaceId,
  })

  return {
    skipped: false,
    content: updatedContent,
    final_content,
  }
}

/**
 * Lấy danh sách task content của 1 khách hàng chưa có bài viết hợp lệ.
 * Bỏ qua task đã có content có text / đang chờ duyệt / đã duyệt / đã đăng.
 * Task chỉ có drafted trống vẫn được coi là chưa viết.
 */
export async function getUnwrittenContentTasks(
  clientId: string,
  workspaceId: string
) {
  const [tasks, contents] = await Promise.all([
    getTasks({ clientId, workspaceId }),
    getContents(clientId, workspaceId),
  ])

  const contentTasks = (contents || []).filter((c: any) => c.task_id)
  const writtenTaskIds = new Set<string>()

  for (const c of contentTasks) {
    if (
      c.status === 'waiting_approval' ||
      c.status === 'approved' ||
      c.status === 'published'
    ) {
      writtenTaskIds.add(c.task_id)
      continue
    }
    // drafted / khác: chỉ coi là đã viết nếu có history có text
    try {
      const history = await getLatestContentHistory(c.id, workspaceId)
      const hasText =
        !!(history?.ai_version && history.ai_version.trim()) ||
        !!(history?.human_edited_version && history.human_edited_version.trim())
      if (hasText) writtenTaskIds.add(c.task_id)
    } catch {
      // không có history → vẫn coi là chưa viết
    }
  }

  return (tasks || [])
    .filter(
      (t: any) => t.task_type === 'content' && !writtenTaskIds.has(t.id)
    )
    .sort(
      (a: any, b: any) =>
        new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    )
}

/**
 * Tự viết N bài đầu tiên cho các task content chưa viết.
 * Mỗi bài lỗi được ghi lại, không dừng cả batch.
 */
export async function autoWriteContentBatch(
  clientId: string,
  workspaceId: string,
  count: number,
  clientInfo?: ClientInfo
) {
  const unwritten = await getUnwrittenContentTasks(clientId, workspaceId)
  const toWrite = unwritten.slice(0, count)

  const results = []
  for (const task of toWrite) {
    try {
      const result = await writeContentForTask(task.id, workspaceId, clientInfo)
      results.push({ task_id: task.id, title: task.title, ...result })
    } catch (err: any) {
      results.push({
        task_id: task.id,
        title: task.title,
        skipped: true,
        reason: 'error',
        error: err?.message || String(err),
      })
    }
  }

  return results
}
