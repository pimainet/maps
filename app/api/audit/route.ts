import { NextResponse } from 'next/server'
import { askClaude } from '@/lib/claude'
import { saveAudit, getLatestAuditByClient, getAllAudits } from '@/lib/db'
import { AUDIT_PROMPT } from '@/lib/prompts'
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
      const all = await getAllAudits(workspaceId)
      return NextResponse.json(all)
    }
    const data = await getLatestAuditByClient(clientId, workspaceId)
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
        console.error('getClientProgress audit:', e?.message)
        progress_context =
          '### Tiến độ đã ghi nhận trong hệ thống\n- Không lấy được tiến độ (bỏ qua).'
      }
    } else {
      progress_context =
        '### Tiến độ đã ghi nhận trong hệ thống\n- Chưa gắn client_id — không có lịch sử.'
    }

    const prompt = AUDIT_PROMPT.replaceAll(
      '{{output_language}}',
      body.output_language || 'Tiếng Việt'
    )
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
      .replaceAll('{{progress_context}}', progress_context)

    const audit_result = await askClaude(prompt, { maxTokens: 3000, temperature: 0.4 })

    const saved = await saveAudit({
      client_id: body.client_id,
      audit_result,
      raw_input: body,
      workspace_id: workspaceId,
    })

    return NextResponse.json({
      audit: saved,
      audit_result,
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
