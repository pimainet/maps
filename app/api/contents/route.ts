import { NextResponse } from 'next/server'
import { askClaude } from '@/lib/claude'
import { saveContent } from '@/lib/db'
import {
  SERP_AWARE_PROMPT,
  WRITER_PROMPT,
  CRITIC_PROMPT,
  REFINER_PROMPT,
} from '@/lib/prompts'

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
      .replaceAll('{{serp_analysis}}', serp_analysis)

    const ai_content = await askClaude(writerPrompt)

    // 3. Critic
    const criticPrompt = CRITIC_PROMPT.replaceAll('{{ai_content}}', ai_content)
    const critic_feedback = await askClaude(criticPrompt)

    // 4. Refiner
    const refinerPrompt = REFINER_PROMPT
      .replaceAll('{{ai_content}}', ai_content)
      .replaceAll('{{critic_feedback}}', critic_feedback)

    const final_content = await askClaude(refinerPrompt)

    // 5. Save
    const saved = await saveContent({
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
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}