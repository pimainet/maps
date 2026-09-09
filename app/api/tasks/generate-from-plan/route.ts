import { NextResponse } from 'next/server'
import { askClaude } from '@/lib/claude'
import { createTasks, getClientById } from '@/lib/db'
import { TASKS_FROM_PLAN_PROMPT } from '@/lib/prompts'
import { requireActiveWorkspaceId } from '@/lib/auth'
import { autoWriteContentBatch } from '@/lib/write-content'

export const maxDuration = 300
export const runtime = 'nodejs'

type TaskItem = {
  title?: string
  description?: string
  task_type?: string
  priority?: string
  due_date?: string
}

/** Lấy JSON array từ raw text dù AI có thêm markdown / giải thích. */
function extractJsonArray(raw: string): string {
  let s = (raw || '').trim()
  if (!s) throw new Error('AI trả về chuỗi rỗng')

  // Bỏ code fence ```json ... ```
  s = s.replace(/^```(?:json|JSON)?\s*/i, '').replace(/\s*```$/i, '').trim()

  // Nếu còn text thừa, cắt từ [ đầu tiên đến ] cuối cùng
  const start = s.indexOf('[')
  const end = s.lastIndexOf(']')
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('Không tìm thấy JSON array trong phản hồi AI')
  }
  s = s.slice(start, end + 1)

  // Sửa lỗi thường gặp: trailing comma trước ] hoặc }
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

// Mỗi bài = 4 lần Claude. Giữ 1 bài để tránh timeout trên Vercel.
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
    const { client_id, plan_id, business_name, industry, area, plan_result, start_date } = body

    if (!client_id || !plan_result) {
      return NextResponse.json(
        { error: 'Thiếu client_id hoặc plan_result' },
        { status: 400 }
      )
    }

    const effectiveStartDate = start_date || new Date().toISOString().slice(0, 10)

    const prompt = TASKS_FROM_PLAN_PROMPT.replaceAll('{{business_name}}', business_name || '')
      .replaceAll('{{industry}}', industry || '')
      .replaceAll('{{area}}', area || '')
      .replaceAll('{{start_date}}', effectiveStartDate)
      .replaceAll('{{plan_result}}', plan_result)

    // JSON structured → temperature thấp + token cao hơn (8–15 task dễ cắt ở 2000)
    let raw = await askClaude(prompt, { maxTokens: 4096, temperature: 0.2 })

    let tasks: TaskItem[]
    let parseError: string | null = null
    try {
      tasks = parseTasksJson(raw)
    } catch (err: any) {
      parseError = err?.message || String(err)
      // Retry 1 lần: nhờ model sửa thành JSON thuần
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

    const validTasks = tasks
      .filter((t) => t && typeof t.title === 'string' && t.title.trim())
      .map((t) => ({
        title: t.title!.trim(),
        description: t.description?.trim(),
        task_type: VALID_TYPES.includes(t.task_type || '') ? t.task_type! : 'other',
        priority: VALID_PRIORITIES.includes(t.priority || '') ? t.priority! : 'medium',
        due_date: DATE_RE.test(t.due_date || '') ? t.due_date : undefined,
      }))

    if (validTasks.length === 0) {
      return NextResponse.json(
        { error: 'AI không sinh ra việc nào hợp lệ', raw_output: raw },
        { status: 502 }
      )
    }

    const created = await createTasks(
      validTasks.map((t) => ({
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

    let message: string
    if (writtenCount > 0) {
      message = `Đã tạo ${created.length} việc và tự viết ${writtenCount} bài đưa vào Chờ duyệt`
    } else if (autoWriteError) {
      message = `Đã tạo ${created.length} việc, nhưng tự viết bài thất bại: ${autoWriteError}`
    } else {
      message = `Đã tạo ${created.length} việc`
    }

    return NextResponse.json({
      items: created,
      auto_written: writtenCount,
      auto_write_error: autoWriteError,
      auto_write_details: autoWritten,
      message,
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
