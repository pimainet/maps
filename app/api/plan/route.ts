import { NextResponse } from 'next/server'
import { askClaude } from '@/lib/claude'
import { savePlan, getLatestPlanByClient, getAllPlans } from '@/lib/db'
import { PLAN_30_DAYS_PROMPT } from '@/lib/prompts'

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const clientId = searchParams.get('client_id')
    if (!clientId) {
      const all = await getAllPlans()
      return NextResponse.json(all)
    }
    const data = await getLatestPlanByClient(clientId)
    return NextResponse.json(data)
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
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
    })

    return NextResponse.json({
      plan: saved,
      plan_result,
    })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}