import { NextResponse } from 'next/server'
import { askClaude } from '@/lib/claude'
import { createTasks, getClientById } from '@/lib/db'
import { TASKS_FROM_PLAN_PROMPT } from '@/lib/prompts'
import { requireActiveWorkspaceId } from '@/lib/auth'
import { autoWriteContentBatch } from '@/lib/write-content'

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

// Số bài tự viết ngay sau khi sinh lịch việc
const AUTO_WRITE_COUNT = 3

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

    // ===== TỰ ĐỘNG VIẾT 3 BÀI ĐẦU TIÊN =====
    let autoWritten: any[] = []
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
      // Không làm fail cả request nếu viết bài lỗi — task vẫn đã tạo
      console.error('Auto write content error:', err.message)
    }

    const writtenCount = autoWritten.filter((r) => !r.skipped).length

    return NextResponse.json({
      items: created,
      auto_written: writtenCount,
      message:
        writtenCount > 0
          ? `Đã tạo ${created.length} việc và tự viết ${writtenCount} bài đưa vào Chờ duyệt`
          : `Đã tạo ${created.length} việc`,
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
