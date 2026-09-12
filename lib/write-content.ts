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
import { titlesSimilar } from '@/lib/client-memory'
import { WRITER_COMPACT_PROMPT, REFINE_LIGHT_PROMPT } from '@/lib/prompts'

type ClientInfo = {
  name?: string
  industry?: string
  area?: string
  brand_voice?: string
  phone?: string
  notes?: string
}

/**
 * Pipeline Tuần 3: tối đa 2 lần gọi Claude.
 * 1) Writer compact (SERP-lite nằm trong prompt)
 * 2) Refine nhẹ (trung thực + CTA + độ dài)
 */
async function runAiPipeline(
  topic: string,
  goal: string,
  info: ClientInfo | undefined
) {
  const writerPrompt = WRITER_COMPACT_PROMPT.replaceAll(
    '{{business_name}}',
    info?.name || ''
  )
    .replaceAll('{{industry}}', info?.industry || '')
    .replaceAll('{{area}}', info?.area || '')
    .replaceAll('{{topic}}', topic || '')
    .replaceAll('{{goal}}', goal || '')
    .replaceAll('{{brand_voice}}', info?.brand_voice || 'chuyên nghiệp, gần gũi')
    .replaceAll('{{phone}}', info?.phone || '')
    .replaceAll('{{extra_info}}', info?.notes || '')

  const ai_content = await askClaude(writerPrompt, {
    maxTokens: 1200,
    temperature: 0.65,
  })

  const refinePrompt = REFINE_LIGHT_PROMPT.replaceAll(
    '{{ai_content}}',
    ai_content
  )
    .replaceAll('{{business_name}}', info?.name || '')
    .replaceAll('{{industry}}', info?.industry || '')
    .replaceAll('{{area}}', info?.area || '')
    .replaceAll('{{phone}}', info?.phone || '')
    .replaceAll('{{extra_info}}', info?.notes || '')

  const final_content = await askClaude(refinePrompt, {
    maxTokens: 1200,
    temperature: 0.4,
  })

  return {
    serp_analysis: '',
    ai_content,
    critic_feedback: '',
    final_content,
  }
}

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

    if (
      hasText ||
      existing.status === 'waiting_approval' ||
      existing.status === 'approved' ||
      existing.status === 'published'
    ) {
      return { skipped: true, reason: 'already_has_content', content: existing }
    }

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

  try {
    const existingContents = (await getContents(task.client_id, workspaceId)) || []
    for (const c of existingContents) {
      if (!['waiting_approval', 'approved', 'published'].includes(c.status)) continue
      if (c.topic && titlesSimilar(c.topic, topic)) {
        return {
          skipped: true,
          reason: 'similar_topic_exists',
          content: c,
        }
      }
    }
  } catch {
    /* ignore */
  }

  const { serp_analysis, ai_content, critic_feedback, final_content } =
    await runAiPipeline(topic, goal, info)

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
      pipeline: 'compact_v1',
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
    try {
      const history = await getLatestContentHistory(c.id, workspaceId)
      const hasText =
        !!(history?.ai_version && history.ai_version.trim()) ||
        !!(history?.human_edited_version && history.human_edited_version.trim())
      if (hasText) writtenTaskIds.add(c.task_id)
    } catch {
      /* ignore */
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
