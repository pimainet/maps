import { NextResponse } from 'next/server'
import { askClaude } from '@/lib/claude'
import { saveAudit, getLatestAuditByClient } from '@/lib/db'
import { AUDIT_PROMPT } from '@/lib/prompts'

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const clientId = searchParams.get('client_id')
    if (!clientId) {
      return NextResponse.json({ error: 'Thiếu client_id' }, { status: 400 })
    }
    const data = await getLatestAuditByClient(clientId)
    return NextResponse.json(data)
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json()

    const prompt = AUDIT_PROMPT
      .replaceAll('{{business_name}}', body.business_name || '')
      .replaceAll('{{industry}}', body.industry || '')
      .replaceAll('{{area}}', body.area || '')
      .replaceAll('{{gbp_link}}', body.gbp_link || '')
      .replaceAll('{{description}}', body.description || '')
      .replaceAll('{{primary_category}}', body.primary_category || '')
      .replaceAll('{{additional_categories}}', body.additional_categories || '')
      .replaceAll('{{review_count}}', body.review_count || '')
      .replaceAll('{{rating}}', body.rating || '')
      .replaceAll('{{recent_posts}}', body.recent_posts || '')
      .replaceAll('{{photos_status}}', body.photos_status || '')
      .replaceAll('{{additional_info}}', body.additional_info || '')

    const audit_result = await askClaude(prompt)

    const saved = await saveAudit({
      client_id: body.client_id,
      audit_result,
      raw_input: body,
    })

    return NextResponse.json({
      audit: saved,
      audit_result,
    })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}