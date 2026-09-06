import { NextResponse } from 'next/server'
import { askClaude } from '@/lib/claude'
import { savePlan, getLatestPlanByClient, getAllPlans } from '@/lib/db'
import { PLAN_30_DAYS_PROMPT } from '@/lib/prompts'
import { requireWorkspaceId } from '@/lib/auth'

export async function GET(req: Request) {
  try {
    const workspaceId = await requireWorkspaceId()
    const { searchParams } = new URL(req.url)
    const clientId = searchParams.get('client_id')
    if (!clientId) {
      const all = await getAllPlans(workspaceId)
      return NextResponse.json(all)
    }
    const data = await getLatestPlanByClient(clientId, workspaceId)
    return NextResponse.json(data)
  } catch (error: any) {
    const status = error.message?.includes('Unauthorized') ? 401 : 500
    return NextResponse.json({ error: error.message }, { status })
  }
}

export async function POST(req: Request) {
  try {
    const workspaceId = await requireWorkspaceId()
    const body = await req.json()

    const prompt = PLAN_30_DAYS_PROMPT
      .replaceAll('{{business_name}}', body.business_name || '')
      .replaceAll('{{industry}}', body.industry || '')
      .replaceAll('{{area}}', body.area || '')
      .replaceAll('{{audit_result}}', body.audit_result || '')

    const plan_result = await askClaude(prompt)

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
    })
  } catch (error: any) {
    const status = error.message?.includes('Unauthorized') ? 401 : 500
    return NextResponse.json({ error: error.message }, { status })
  }
}
