import { NextResponse } from 'next/server'
import { askClaude } from '@/lib/claude'
import { createTasks, getClientById } from '@/lib/db'
import { TASKS_FROM_PLAN_PROMPT } from '@/lib/prompts'
import { requireActiveWorkspaceId } from '@/lib/auth'
import { autoWriteContentBatch } from '@/lib/write-content'

// Vercel: cho phép chạy lâu hơn (Pro tối đa 300s). Hobby thường ~10–60s.
export const maxDuration = 300
export const runtime = 'nodejs'

function parseTasksJson(raw: string) {
  const cleaned = raw
    .trim()
    .replace(/^```json/i, '')
    .replace(/^```/, '')
    .replace(/```$/, '')
    .trim()

  const parsed = JSON.parse(cleaned)
  if (!Array.isArray(parsed)) {
    throw new Error('Kết quả AI không phải là danh sách hợp lệ')
  }
  return parsed as Array<{
    title?: string
    description?: string
    task_type?: string
    priority?: string
    due_date?: string
  }>
}

const VALID_TYPES = ['content', 'profile_update', 'photo', 'review', 'other']
const VALID_PRIORITIES = ['low', 'medium', 'high']
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

// Mỗi bài = 4 lần gọi Claude. Trên Vercel nên giữ 1 để tránh timeout;
// sau khi duyệt bài, hệ thống sẽ tự viết thêm 1 bài tiếp theo.
const AUTO_WRITE_COUNT = 1

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

    const raw = await askClaude(prompt)

    let tasks: Array<{
      title?: string
      description?: string
      task_type?: string
      priority?: string
      due_date?: string
    }>
    try {
      tasks = parseTasksJson(raw)
    } catch {
      return NextResponse.json(
        {
          error: 'AI trả về dữ liệu không đúng định dạng JSON, không thể tạo danh sách việc tự động.',
          raw_output: raw,
        },
        { status: 502 }
      )
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
        { error: 'AI không sinh ra việc nào hợp lệ' },
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

    // ===== TỰ ĐỘNG VIẾT BÀI ĐẦU TIÊN =====
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
      // Task đã tạo — không fail cả request, nhưng trả lỗi để UI biết
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
