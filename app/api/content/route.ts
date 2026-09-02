import { NextResponse } from 'next/server'
import { askClaude } from '@/lib/claude'
import { saveContent, updateContent, getContents } from '@/lib/db'
import {
  SERP_AWARE_PROMPT,
  WRITER_PROMPT,
  CRITIC_PROMPT,
  REFINER_PROMPT,
} from '@/lib/prompts'

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const clientId = searchParams.get('client_id') || undefined
    const data = await getContents(clientId)
    return NextResponse.json(data)
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json()

    // 1. SERP-Aware
    const serpPrompt = SERP_AWARE_PROMPT
      .replaceAll('{{industry}}', body.industry || '')
      .replaceAll('{{area}}', body.area || '')
      .replaceAll('{{topic}}', body.topic || '')
      .replaceAll('{{goal}}', body.goal || '')
      .replaceAll('{{business_name}}', body.business_name || '')

    const serp_analysis = await askClaude(serpPrompt)

    // 2. Writer
    const writerPrompt = WRITER_PROMPT
      .replaceAll('{{business_name}}', body.business_name || '')
      .replaceAll('{{industry}}', body.industry || '')
      .replaceAll('{{area}}', body.area || '')
      .replaceAll('{{topic}}', body.topic || '')
      .replaceAll('{{goal}}', body.goal || '')
      .replaceAll('{{brand_voice}}', body.brand_voice || 'chuyên nghiệp, gần gũi')
      .replaceAll('{{phone}}', body.phone || '')
      .replaceAll('{{extra_info}}', body.extra_info || '')
      .replaceAll('{{serp_analysis}}', serp_analysis)

    const ai_content = await askClaude(writerPrompt)

    // 3. Critic
    const criticPrompt = CRITIC_PROMPT.replaceAll('{{ai_content}}', ai_content)
    const critic_feedback = await askClaude(criticPrompt)

    // 4. Refiner
    const refinerPrompt = REFINER_PROMPT
      .replaceAll('{{ai_content}}', ai_content)
      .replaceAll('{{critic_feedback}}', critic_feedback)
      .replaceAll('{{business_name}}', body.business_name || '')
      .replaceAll('{{industry}}', body.industry || '')
      .replaceAll('{{area}}', body.area || '')
      .replaceAll('{{phone}}', body.phone || '')
      .replaceAll('{{extra_info}}', body.extra_info || '')

    const final_content = await askClaude(refinerPrompt)

    // 5. Lưu — nếu có content_id (bài viết đang ở trạng thái 'idea' từ lịch
    // nội dung sinh sẵn) thì cập nhật đúng bản ghi đó, tránh tạo trùng.
    const saved = body.content_id
      ? await updateContent(body.content_id, {
          topic: body.topic,
          goal: body.goal,
          serp_analysis,
          ai_content,
          critic_feedback,
          final_content,
          status: 'waiting_approval',
        })
      : await saveContent({
          client_id: body.client_id,
          plan_id: body.plan_id,
          topic: body.topic,
          goal: body.goal,
          serp_analysis,
          ai_content,
          critic_feedback,
          final_content,
          scheduled_date: body.scheduled_date,
          status: 'waiting_approval',
        })

    return NextResponse.json({
      content: saved,
      serp_analysis,
      ai_content,
      critic_feedback,
      final_content,
    })
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Unknown error' },
      { status: 500 }
    )
  }
}