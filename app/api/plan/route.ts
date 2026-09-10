import { NextResponse } from 'next/server'
import { askClaude } from '@/lib/claude'
import { savePlan, getLatestPlanByClient, getAllPlans } from '@/lib/db'
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
    const data = await getLatestPlanByClient(clientId, workspaceId)
    return NextResponse.json(data)
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

    let progress_context = ''
    if (body.client_id) {
      try {
        const progress = await getClientProgress(body.client_id, workspaceId)
        progress_context = progress.summary_text
      } catch (e: any) {
        console.error('getClientProgress plan:', e?.message)
        progress_context =
          '### Tiến độ đã ghi nhận trong hệ thống\n- Không lấy được tiến độ (bỏ qua).'
      }
    }

    const prompt = PLAN_30_DAYS_PROMPT.replaceAll(
      '{{business_name}}',
      body.business_name || ''
    )
      .replaceAll('{{industry}}', body.industry || '')
      .replaceAll('{{area}}', body.area || '')
      .replaceAll('{{audit_result}}', body.audit_result || '')
      .replaceAll('{{progress_context}}', progress_context)

    const plan_result = await askClaude(prompt, { maxTokens: 3000, temperature: 0.4 })

    const saved = await savePlan({
      client_id: body.client_id,
      audit_id: body.audit_id,
      plan_result,
      start_date: body.start_date,
      end_date: body.end_date,
      workspace_id: workspaceId,
    })

    return NextResponse.json({
      plan: saved,
      plan_result,
      used_progress: !!body.client_id,
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
