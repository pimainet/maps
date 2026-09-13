import { askClaude } from '@/lib/claude'
import {
  getTaskById,
  getContentByTaskId,
  createContentForTask,
  createAdHocContent,
  updateContentStatus,
  saveContentHistory,
  getTasks,
  getContents,
  getClientById,
  getLatestContentHistory,
  deleteContentById,
} from '@/lib/db'
import { titlesSimilar } from '@/lib/client-memory'
import { WRITER_COMPACT_PROMPT, REFINE_LIGHT_PROMPT, CRITIC_COMPACT_PROMPT } from '@/lib/prompts'
import { checkAiRateLimit, recordAiUsage } from '@/lib/rate-limit'

type ClientInfo = {
  name?: string
  industry?: string
  area?: string
  brand_voice?: string
  phone?: string
  notes?: string
}

function parseCriticJson(raw: string): { score: number | null; verdict: string; honesty_flag: boolean; honesty_note: string; note: string } | null {
  try {
    let s = (raw || '').trim()
    s = s.replace(/^```(?:json|JSON)?\s*/i, '').replace(/\s*```$/i, '').trim()
    const start = s.indexOf('{')
    const end = s.lastIndexOf('}')
    if (start === -1 || end === -1 || end <= start) return null
    s = s.slice(start, end + 1)
    const parsed = JSON.parse(s)
    return {
      score: typeof parsed.score === 'number' ? parsed.score : null,
      verdict: parsed.verdict || '',
      honesty_flag: !!parsed.honesty_flag,
      honesty_note: parsed.honesty_note || '',
      note: parsed.note || '',
    }
  } catch {
    return null
  }
}

const VERDICT_LABEL: Record<string, string> = {
  dat: 'Đạt',
  can_chinh_sua_nhe: 'Cần chỉnh sửa nhẹ',
  can_viet_lai: 'Cần viết lại đáng kể',
}

function formatCriticFeedback(raw: string): string {
  const parsed = parseCriticJson(raw)
  // Parse lỗi (AI trả về sai format) — vẫn lưu nguyên văn, còn hơn mất trắng.
  if (!parsed) return raw || ''

  const lines: string[] = []
  const scoreText = parsed.score != null ? `${parsed.score}/10` : '—'
  const verdictText = VERDICT_LABEL[parsed.verdict] || parsed.verdict || '—'
  lines.push(`Điểm chất lượng: ${scoreText} · ${verdictText}`)
  if (parsed.honesty_flag) {
    lines.push(`⚠️ Có dấu hiệu thông tin không đúng thật: ${parsed.honesty_note || '(AI không nêu chi tiết)'} — kiểm tra kỹ trước khi duyệt.`)
  }
  if (parsed.note) lines.push(parsed.note)
  return lines.join('\n')
}

/**
 * Pipeline viết content: tối đa 3 lần gọi Claude.
 * 1) Writer compact (SERP-lite nằm trong prompt)
 * 2) Refine nhẹ (trung thực + CTA + độ dài)
 * 3) Critic rút gọn — CHỈ chấm điểm + cảnh báo bịa thông tin, KHÔNG viết
 *    lại lần nữa (khác CRITIC_PROMPT/REFINER_PROMPT cũ, tốn thêm 1 lượt
 *    gọi nữa để tự sửa — ở đây để con người tự quyết định sau khi thấy
 *    điểm, thay vì AI âm thầm sửa hộ).
 *
 * ĐÂY LÀ CỬA DUY NHẤT gọi AI để viết content trong toàn bộ hệ thống —
 * rate limit được kiểm tra + ghi nhận ngay tại đây (checkAiRateLimit/
 * từ /api/content (viết tay 1 bài), từ auto-write khi duyệt bài, hay từ
 * sinh lịch việc, đều không thể né được giới hạn.
 */
async function runAiPipeline(
  topic: string,
  goal: string,
  info: ClientInfo | undefined,
  workspaceId: string
) {
  const { userId } = await checkAiRateLimit(workspaceId, 'content')

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

  // Đến đây writer + refine đã thành công (có bài dùng được) — ghi
  // nhận lượt gọi này vào quota NGAY, trước khi chạy bước critic (nếu
  // critic lỗi thì không nên ảnh hưởng tới việc quota có được tính hay
  // không — bài đã viết ra rồi, người dùng đã "dùng" 1 lượt thật sự).
  await recordAiUsage(workspaceId, 'content', userId)

  let critic_feedback = ''
  try {
    const criticPrompt = CRITIC_COMPACT_PROMPT.replaceAll('{{final_content}}', final_content)
      .replaceAll('{{business_name}}', info?.name || '')
      .replaceAll('{{phone}}', info?.phone || '')
      .replaceAll('{{extra_info}}', info?.notes || '')
    const rawCritic = await askClaude(criticPrompt, { maxTokens: 400, temperature: 0.2 })
    critic_feedback = formatCriticFeedback(rawCritic)
  } catch (e: any) {
    // Critic lỗi (vd Claude quá tải) không nên làm hỏng cả bài đã viết
    // xong — vẫn lưu bài, chỉ là không có điểm đánh giá lần này.
    console.error('Critic step lỗi:', e?.message)
    critic_feedback = ''
  }

  return {
    serp_analysis: '',
    ai_content,
    critic_feedback,
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
    await runAiPipeline(topic, goal, info, workspaceId)

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
    ai_content,
    critic_feedback,
    serp_analysis,
    final_content,
  }
}

/**
 * Viết 1 bài content KHÔNG gắn với task có sẵn (ad-hoc — người dùng tự
 * nhập chủ đề, không qua lộ trình). Dùng chung pipeline + rate limit
 * với writeContentForTask, chỉ khác bước tạo record đầu vào.
 */
export async function writeAdHocContent(input: {
  clientId: string
  planId?: string
  topic: string
  goal?: string
  workspaceId: string
  clientInfo: ClientInfo
}) {
  const { clientId, planId, topic, goal, workspaceId, clientInfo } = input

  const { serp_analysis, ai_content, critic_feedback, final_content } = await runAiPipeline(
    topic,
    goal || '',
    clientInfo,
    workspaceId
  )

  const contentRow = await createAdHocContent({
    client_id: clientId,
    plan_id: planId,
    topic,
    workspace_id: workspaceId,
  })

  const updatedContent = await updateContentStatus(contentRow.id, 'waiting_approval', workspaceId)

  await saveContentHistory({
    content_id: contentRow.id,
    client_id: contentRow.client_id,
    ai_version: final_content,
    edit_note: JSON.stringify({ pipeline: 'compact_v1', serp_analysis, ai_draft: ai_content, critic_feedback }),
    workspace_id: workspaceId,
  })

  return {
    content: updatedContent,
    ai_content,
    critic_feedback,
    final_content,
    serp_analysis,
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
