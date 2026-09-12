import { NextResponse } from 'next/server'
import { askClaude } from '@/lib/claude'
import {
  savePlan,
  getLatestPlanByClient,
  getAllPlans,
  getTasks,
  getContents,
  getActiveCycle,
  openCycle,
  rotateCycle,
  updateCycle,
} from '@/lib/db'
import { PLAN_30_DAYS_PROMPT } from '@/lib/prompts'
import { requireActiveWorkspaceId } from '@/lib/auth'
import { getClientProgress } from '@/lib/client-memory'

export const maxDuration = 300
export const runtime = 'nodejs'

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
        : 500
    return NextResponse.json({ error: error.message }, { status })
  }
}

export async function POST(req: Request) {
  try {
    const workspaceId = await requireActiveWorkspaceId()
    const body = await req.json()
    const forceNewCycle = !!body.force_new_cycle

    if (!body.client_id) {
      return NextResponse.json({ error: 'Thiếu client_id' }, { status: 400 })
    }
    if (!body.audit_result) {
      return NextResponse.json({ error: 'Thiếu audit_result' }, { status: 400 })
    }

    const active = await getActiveCycle(body.client_id, workspaceId)

    // Đang có chu kỳ active + chưa force → không tạo lộ trình “chu kỳ mới” ngầm
    if (active && !forceNewCycle) {
      const [tasks, contents] = await Promise.all([
        getTasks({ clientId: body.client_id, workspaceId }),
        getContents(body.client_id, workspaceId),
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
      const progress = await getClientProgress(body.client_id, workspaceId)
      progress_context = progress.summary_text
    } catch (e: any) {
      console.error('getClientProgress plan:', e?.message)
      progress_context =
        '### Tiến độ đã ghi nhận trong hệ thống\n- Không lấy được tiến độ (bỏ qua).'
    }

    const prompt = PLAN_30_DAYS_PROMPT.replaceAll(
      '{{business_name}}',
      body.business_name || ''
    )
      .replaceAll('{{industry}}', body.industry || '')
      .replaceAll('{{area}}', body.area || '')
      .replaceAll('{{audit_result}}', body.audit_result || '')
      .replaceAll('{{progress_context}}', progress_context)

    const plan_result = await askClaude(prompt, {
      maxTokens: 3000,
      temperature: 0.4,
    })

    const saved = await savePlan({
      client_id: body.client_id,
      audit_id: body.audit_id,
      plan_result,
      start_date: body.start_date,
      end_date: body.end_date,
      workspace_id: workspaceId,
    })

    // Gắn / xoay chu kỳ
    let cycle
    if (forceNewCycle && active) {
      const tasks = (await getTasks({ clientId: body.client_id, workspaceId })) || []
      const done = tasks.filter((t: any) => t.status === 'done').length
      const open = tasks.filter(
        (t: any) => !['done', 'skipped'].includes(t.status || 'pending')
      ).length
      cycle = await rotateCycle({
        client_id: body.client_id,
        workspace_id: workspaceId,
        opening_audit_id: body.audit_id || null,
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
        client_id: body.client_id,
        workspace_id: workspaceId,
        opening_audit_id: body.audit_id || null,
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
        : 500
    return NextResponse.json({ error: error.message }, { status })
  }
}
