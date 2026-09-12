import { NextResponse } from 'next/server'
import { askClaude } from '@/lib/claude'
import { createTasks, getClientById, getTasks, getActiveCycle, openCycle, updateCycle } from '@/lib/db'
import { TASKS_FROM_PLAN_PROMPT } from '@/lib/prompts'
import { requireActiveWorkspaceId } from '@/lib/auth'
import { autoWriteContentBatch } from '@/lib/write-content'
import {
  getClientProgress,
  filterDuplicateTasks,
} from '@/lib/client-memory'

export const maxDuration = 300
export const runtime = 'nodejs'

type TaskItem = {
  title?: string
  description?: string
  task_type?: string
  priority?: string
  due_date?: string
}

function extractJsonArray(raw: string): string {
  let s = (raw || '').trim()
  if (!s) throw new Error('AI trả về chuỗi rỗng')

  s = s.replace(/^```(?:json|JSON)?\s*/i, '').replace(/\s*```$/i, '').trim()

  const start = s.indexOf('[')
  const end = s.lastIndexOf(']')
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('Không tìm thấy JSON array trong phản hồi AI')
  }
  s = s.slice(start, end + 1)
  s = s.replace(/,\s*([\]}])/g, '$1')
  return s
}

function parseTasksJson(raw: string): TaskItem[] {
  const cleaned = extractJsonArray(raw)
  let parsed: unknown
  try {
    parsed = JSON.parse(cleaned)
  } catch (e: any) {
    throw new Error(`JSON.parse thất bại: ${e?.message || e}`)
  }
  if (!Array.isArray(parsed)) {
    throw new Error('Kết quả AI không phải là danh sách (array)')
  }
  return parsed as TaskItem[]
}

const VALID_TYPES = ['content', 'profile_update', 'photo', 'review', 'other']
const VALID_PRIORITIES = ['low', 'medium', 'high']
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

const AUTO_WRITE_COUNT = 1

const REPAIR_PROMPT = `Bạn nhận được phản hồi sau đây từ một model khác. Hãy CHỈ trả về một JSON array hợp lệ chứa các task, không markdown, không giải thích.

Mỗi phần tử phải có đúng các key: title, description, task_type, priority, due_date.
task_type chỉ được: content | profile_update | photo | review | other
priority chỉ được: low | medium | high
due_date dạng YYYY-MM-DD

Phản hồi gốc:
`

export async function POST(req: Request) {
  try {
    const workspaceId = await requireActiveWorkspaceId()
    const body = await req.json()
    const {
      client_id,
      plan_id,
      business_name,
      industry,
      area,
      plan_result,
      start_date,
    } = body

    if (!client_id || !plan_result) {
      return NextResponse.json(
        { error: 'Thiếu client_id hoặc plan_result' },
        { status: 400 }
      )
    }

    const forceNewCycle = !!body.force_new_cycle
    let cycle = await getActiveCycle(client_id, workspaceId)
    if (!cycle) {
      // Lần đầu: mở cycle gắn plan hiện tại
      cycle = await openCycle({
        client_id,
        workspace_id: workspaceId,
        plan_id: plan_id || null,
      })
    } else if (plan_id && cycle.plan_id && cycle.plan_id !== plan_id && !forceNewCycle) {
      // Sinh task từ plan khác trong khi cycle đang gắn plan cũ
      return NextResponse.json(
        {
          error:
            'Đang có chu kỳ active gắn lộ trình khác. Dùng lộ trình của chu kỳ hiện tại, hoặc mở chu kỳ mới (force_new_cycle) trước.',
          code: 'CYCLE_PLAN_MISMATCH',
          active_cycle: cycle,
        },
        { status: 409 }
      )
    }

    const effectiveStartDate =
      start_date || new Date().toISOString().slice(0, 10)

    // Bộ nhớ vận hành
    let progress_context = ''
    let progress: Awaited<ReturnType<typeof getClientProgress>> | null = null
    try {
      progress = await getClientProgress(client_id, workspaceId)
      progress_context = progress.summary_text
    } catch (e: any) {
      console.error('getClientProgress tasks:', e?.message)
      progress_context =
        '### Tiến độ đã ghi nhận trong hệ thống\n- Không lấy được tiến độ.'
    }

    const prompt = TASKS_FROM_PLAN_PROMPT.replaceAll(
      '{{business_name}}',
      business_name || ''
    )
      .replaceAll('{{industry}}', industry || '')
      .replaceAll('{{area}}', area || '')
      .replaceAll('{{start_date}}', effectiveStartDate)
      .replaceAll('{{plan_result}}', plan_result)
      .replaceAll('{{progress_context}}', progress_context)

    let raw = await askClaude(prompt, { maxTokens: 4096, temperature: 0.2 })

    let tasks: TaskItem[]
    let parseError: string | null = null
    try {
      tasks = parseTasksJson(raw)
    } catch (err: any) {
      parseError = err?.message || String(err)
      try {
        const repaired = await askClaude(REPAIR_PROMPT + raw, {
          maxTokens: 4096,
          temperature: 0,
        })
        raw = repaired
        tasks = parseTasksJson(repaired)
        parseError = null
      } catch (err2: any) {
        return NextResponse.json(
          {
            error:
              'AI trả về dữ liệu không đúng định dạng JSON, không thể tạo danh sách việc tự động.',
            detail: parseError,
            repair_error: err2?.message || String(err2),
            raw_output: raw,
          },
          { status: 502 }
        )
      }
    }

    const normalized = tasks
      .filter((t) => t && typeof t.title === 'string' && t.title.trim())
      .map((t) => ({
        title: t.title!.trim(),
        description: t.description?.trim(),
        task_type: VALID_TYPES.includes(t.task_type || '')
          ? t.task_type!
          : 'other',
        priority: VALID_PRIORITIES.includes(t.priority || '')
          ? t.priority!
          : 'medium',
        due_date: DATE_RE.test(t.due_date || '') ? t.due_date : undefined,
      }))

    // Dedup với task đã có trong DB (mọi status)
    const existingTasks = (await getTasks({ clientId: client_id, workspaceId })) || []
    const existingForDedup = existingTasks.map((t: any) => ({
      title: t.title || '',
      task_type: t.task_type,
      status: t.status,
    }))
    // Cũng coi chủ đề content đã có như "đã có việc content"
    if (progress?.contents_done?.length) {
      for (const c of progress.contents_done) {
        existingForDedup.push({
          title: c.topic,
          task_type: 'content',
          status: c.status,
        })
      }
    }

    const { kept, skipped } = filterDuplicateTasks(normalized, existingForDedup)

    if (kept.length === 0) {
      return NextResponse.json({
        items: [],
        skipped_duplicates: skipped.length,
        auto_written: 0,
        message:
          skipped.length > 0
            ? `AI đề xuất ${skipped.length} việc nhưng tất cả đều trùng việc/bài đã có — không tạo thêm.`
            : 'AI không sinh ra việc nào hợp lệ',
        error:
          skipped.length === 0
            ? 'AI không sinh ra việc nào hợp lệ'
            : undefined,
      }, { status: skipped.length > 0 ? 200 : 502 })
    }

    const created = await createTasks(
      kept.map((t) => ({
        client_id,
        plan_id,
        title: t.title,
        description: t.description,
        task_type: t.task_type,
        priority: t.priority,
        due_date: t.due_date,
        workspace_id: workspaceId,
      }))
    )

    let autoWritten: any[] = []
    let autoWriteError: string | null = null
    try {
      const client = await getClientById(client_id, workspaceId)
      const clientInfo = {
        name: client?.name || business_name,
        industry: client?.industry || industry,
        area: client?.area || area,
        brand_voice: client?.brand_voice,
        phone: client?.phone,
        notes: client?.notes,
      }

      autoWritten = await autoWriteContentBatch(
        client_id,
        workspaceId,
        AUTO_WRITE_COUNT,
        clientInfo
      )
    } catch (err: any) {
      autoWriteError = err?.message || String(err)
      console.error('Auto write content error:', autoWriteError)
    }

    const writtenCount = autoWritten.filter((r) => !r.skipped).length
    const writeErrors = autoWritten
      .filter((r) => r.reason === 'error')
      .map((r) => ({ task_id: r.task_id, title: r.title, error: r.error }))

    if (writeErrors.length && !autoWriteError) {
      autoWriteError = writeErrors.map((e) => e.error).join('; ')
    }

    const parts = [`Đã tạo ${created.length} việc mới`]
    if (skipped.length > 0) {
      parts.push(`bỏ qua ${skipped.length} việc trùng lịch sử`)
    }
    if (writtenCount > 0) {
      parts.push(`tự viết ${writtenCount} bài vào Chờ duyệt`)
    } else if (autoWriteError) {
      parts.push(`tự viết bài lỗi: ${autoWriteError}`)
    }

    if (cycle?.id && plan_id) {
      try {
        await updateCycle(cycle.id, workspaceId, { plan_id })
      } catch {
        /* ignore */
      }
    }

    return NextResponse.json({
      items: created,
      skipped_duplicates: skipped.length,
      skipped_titles: skipped.map((s) => s.title),
      auto_written: writtenCount,
      auto_write_error: autoWriteError,
      auto_write_details: autoWritten,
      cycle,
      message: parts.join('; '),
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
