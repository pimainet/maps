import { NextResponse } from 'next/server'
import { askClaude } from '@/lib/claude'
import { savePlan } from '@/lib/db'
import { PLAN_30_DAYS_PROMPT } from '@/lib/prompts'

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