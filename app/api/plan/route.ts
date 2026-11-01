import { NextResponse } from 'next/server'
import { askClaude } from '@/lib/claude'
import {
  savePlan,
  findClientInWorkspace,
  findAuditInWorkspace,
  getLatestPlanByClient,
  getAllPlans,
  getTasks,
  getContents,
  getActiveCycle,
  openCycle,
  rotateCycle,
  updateCycle,
  getCycleHistory,
} from '@/lib/db'
import { PLAN_30_DAYS_PROMPT } from '@/lib/prompts'
import { requireActiveWorkspaceId } from '@/lib/auth'
import { cycleStrategy, getClientProgress } from '@/lib/client-memory'
import { checkAiRateLimit, recordAiUsage } from '@/lib/rate-limit'
import { isValidIsoDate, readJsonObject } from '@/lib/request-body'

export const maxDuration = 300
export const runtime = 'nodejs'

type PlanRequestBody = {
  client_id: string
  audit_id?: string | null
  business_name?: string
  industry?: string
  area?: string
  audit_result: string
  start_date?: string
  end_date?: string
  force_new_cycle?: boolean
}

export async function GET(req: Request) {
  try {
    const workspaceId = await requireActiveWorkspaceId()
    const { searchParams } = new URL(req.url)
    const clientId = searchParams.get('client_id')
    if (!clientId) {
      const all = await getAllPlans(workspaceId)
      return NextResponse.json(all)
    }
    const [data, cycle] = await Promise.all([
      getLatestPlanByClient(clientId, workspaceId),
      getActiveCycle(clientId, workspaceId),
    ])
    return NextResponse.json({ ...(data || {}), active_cycle: cycle })
  } catch (error: any) {
    const status = error.message?.includes('Unauthorized')
      ? 401
      : error.message?.includes('NoWorkspace')
        ? 409
        : error.message?.includes('RateLimited')
          ? 429
          : 500
    return NextResponse.json({ error: error.message }, { status })
  }
}

export async function POST(req: Request) {
  try {
    const workspaceId = await requireActiveWorkspaceId()
    const { userId } = await checkAiRateLimit(workspaceId, 'plan')
    const parsedBody = await readJsonObject(req)
    if (!parsedBody.ok) {
      return NextResponse.json({ error: parsedBody.error }, { status: parsedBody.status })
    }
    const body = parsedBody.value
    const forceNewCycle = body.force_new_cycle === true

    if (body.force_new_cycle !== undefined && typeof body.force_new_cycle !== 'boolean') {
      return NextResponse.json({ error: 'force_new_cycle phải là boolean.' }, { status: 400 })
    }

    if (typeof body.client_id !== 'string' || !body.client_id.trim()) {
      return NextResponse.json({ error: 'Thiếu client_id' }, { status: 400 })
    }
    if (typeof body.audit_result !== 'string' || !body.audit_result.trim()) {
      return NextResponse.json({ error: 'Thiếu audit_result' }, { status: 400 })
    }
    if (body.audit_result.length > 60_000) {
      return NextResponse.json({ error: 'Nội dung audit quá dài.' }, { status: 400 })
    }
    if (body.audit_id !== undefined && body.audit_id !== null && typeof body.audit_id !== 'string') {
      return NextResponse.json({ error: 'audit_id không hợp lệ.' }, { status: 400 })
    }
    for (const field of ['business_name', 'industry', 'area'] as const) {
      if (body[field] !== undefined && typeof body[field] !== 'string') {
        return NextResponse.json({ error: `${field} không hợp lệ.` }, { status: 400 })
      }
    }
    for (const field of ['start_date', 'end_date'] as const) {
      if (body[field] !== undefined && !isValidIsoDate(body[field])) {
        return NextResponse.json({ error: `${field} không hợp lệ.` }, { status: 400 })
      }
    }
    const input = body as unknown as PlanRequestBody

    const client = await findClientInWorkspace(input.client_id, workspaceId)
    if (!client) {
      return NextResponse.json({ error: 'Không tìm thấy khách hàng trong workspace hiện tại.' }, { status: 404 })
    }
    if (input.audit_id) {
      const audit = await findAuditInWorkspace(input.audit_id, input.client_id, workspaceId)
      if (!audit) {
        return NextResponse.json({ error: 'Không tìm thấy audit của khách hàng trong workspace hiện tại.' }, { status: 404 })
      }
    }

    const active = await getActiveCycle(input.client_id, workspaceId)
    const cycleHistory = await getCycleHistory(input.client_id, workspaceId)
    const nextCycleNumber = (cycleHistory || []).length + 1

    // Đang có chu kỳ active + chưa force → không tạo lộ trình “chu kỳ mới” ngầm
    if (active && !forceNewCycle) {
      const [tasks, contents] = await Promise.all([
        getTasks({ clientId: input.client_id, workspaceId }),
        getContents(input.client_id, workspaceId),
      ])
      const openTasks = (tasks || []).filter(
        (t: any) => !['done', 'skipped'].includes(t.status || 'pending')
      )
      return NextResponse.json(
        {
          error:
            'Khách hàng đang có chu kỳ 30 ngày đang mở. Hãy tiếp tục việc còn lại, hoặc bật「Mở chu kỳ mới」nếu cố ý bắt đầu vòng 30 ngày mới.',
          code: 'ACTIVE_CYCLE_EXISTS',
          active_cycle: active,
          open_tasks_count: openTasks.length,
          contents_count: (contents || []).length,
          hint: 'Gửi lại với force_new_cycle: true để đóng chu kỳ cũ và tạo lộ trình mới.',
        },
        { status: 409 }
      )
    }

    let progress_context = ''
    try {
      const progress = await getClientProgress(input.client_id, workspaceId)
      progress_context = progress.summary_text
    } catch (e: any) {
      console.error('getClientProgress plan:', e?.message)
      progress_context =
        '### Tiến độ đã ghi nhận trong hệ thống\n- Không lấy được tiến độ (bỏ qua).'
    }

    const prompt = PLAN_30_DAYS_PROMPT.replaceAll(
      '{{business_name}}',
      input.business_name || ''
    )
      .replaceAll('{{industry}}', input.industry || '')
      .replaceAll('{{area}}', input.area || '')
      .replaceAll('{{audit_result}}', input.audit_result)
      .replaceAll('{{progress_context}}', progress_context)
      .replaceAll(
        '{{cycle_strategy_context}}',
        `### Chiến lược cho chu kỳ ${nextCycleNumber}\n${cycleStrategy(nextCycleNumber)}\nĐây là bước phát triển kế tiếp, không phải cam kết rằng thứ hạng sẽ tăng. Ưu tiên khoảng trống còn tồn tại trong audit mới; đo kết quả và giữ/đổi chiến thuật dựa trên dữ liệu.`
      )

    const plan_result = await askClaude(prompt, {
      maxTokens: 3000,
      temperature: 0.4,
    })
    await recordAiUsage(workspaceId, 'plan', userId)

    const saved = await savePlan({
      client_id: input.client_id,
      audit_id: input.audit_id || undefined,
      plan_result,
      start_date: input.start_date,
      end_date: input.end_date,
      workspace_id: workspaceId,
    })

    // Gắn / xoay chu kỳ
    let cycle
    if (forceNewCycle && active) {
      const tasks = (await getTasks({ clientId: input.client_id, workspaceId })) || []
      const done = tasks.filter((t: any) => t.status === 'done').length
      const open = tasks.filter(
        (t: any) => !['done', 'skipped'].includes(t.status || 'pending')
      ).length
      cycle = await rotateCycle({
        client_id: input.client_id,
        workspace_id: workspaceId,
        opening_audit_id: input.audit_id || null,
        plan_id: saved.id,
        close_snapshot: {
          closed_reason: 'force_new_cycle',
          tasks_done: done,
          tasks_open: open,
          closed_at_plan_id: active.plan_id,
        },
      })
    } else if (!active) {
      cycle = await openCycle({
        client_id: input.client_id,
        workspace_id: workspaceId,
        opening_audit_id: input.audit_id || null,
        plan_id: saved.id,
      })
    } else {
      // Không tới nhánh này vì active && !force đã return 409
      cycle = active
    }

    if (cycle?.id && saved?.id) {
      try {
        await updateCycle(cycle.id, workspaceId, { plan_id: saved.id })
      } catch {
        /* ignore */
      }
    }

    return NextResponse.json({
      plan: saved,
      plan_result,
      cycle,
      force_new_cycle: forceNewCycle,
      used_progress: true,
    })
  } catch (error: any) {
    const status = error.message?.includes('Unauthorized')
      ? 401
      : error.message?.includes('NoWorkspace')
        ? 409
        : error.message?.includes('RateLimited')
          ? 429
          : 500
    return NextResponse.json({ error: error.message }, { status })
  }
}
