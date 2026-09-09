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

/**
 * Viết 1 bài GBP cho 1 task content và đưa vào trạng thái waiting_approval.
 * Nếu task đã có content rồi thì bỏ qua (không viết trùng).
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
    return { skipped: true, reason: 'already_has_content', content: existing }
  }

  // Lấy thông tin khách nếu chưa truyền vào
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

  const contentRow = await createContentForTask({
    ...task,
    workspace_id: workspaceId,
  })

  // 1. SERP-Aware
  const serpPrompt = SERP_AWARE_PROMPT
    .replaceAll('{{industry}}', info?.industry || '')
    .replaceAll('{{area}}', info?.area || '')
    .replaceAll('{{topic}}', topic || '')
    .replaceAll('{{goal}}', goal || '')
    .replaceAll('{{business_name}}', info?.name || '')

  const serp_analysis = await askClaude(serpPrompt)

  // 2. Writer
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

  // 3. Critic
  const criticPrompt = CRITIC_PROMPT.replaceAll('{{ai_content}}', ai_content)
  const critic_feedback = await askClaude(criticPrompt)

  // 4. Refiner
  const refinerPrompt = REFINER_PROMPT
    .replaceAll('{{ai_content}}', ai_content)
    .replaceAll('{{critic_feedback}}', critic_feedback)
    .replaceAll('{{business_name}}', info?.name || '')
    .replaceAll('{{industry}}', info?.industry || '')
    .replaceAll('{{area}}', info?.area || '')
    .replaceAll('{{phone}}', info?.phone || '')
    .replaceAll('{{extra_info}}', info?.notes || '')

  const final_content = await askClaude(refinerPrompt)

  // 5. Lưu
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
 * Lấy danh sách task content của 1 khách hàng chưa có bài viết.
 */
export async function getUnwrittenContentTasks(
  clientId: string,
  workspaceId: string
) {
  const [tasks, contents] = await Promise.all([
    getTasks({ clientId, workspaceId }),
    getContents(clientId, workspaceId),
  ])

  const writtenTaskIds = new Set(
    (contents || [])
      .filter((c: any) => c.task_id)
      .map((c: any) => c.task_id)
  )

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
      results.push({ task_id: task.id, ...result })
    } catch (err: any) {
      results.push({
        task_id: task.id,
        skipped: true,
        reason: 'error',
        error: err.message,
      })
    }
  }

  return results
}
