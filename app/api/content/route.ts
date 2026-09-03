import { NextResponse } from 'next/server'
import { askClaude } from '@/lib/claude'
import {
  getContents,
  getTaskById,
  createContentForTask,
  createAdHocContent,
  getContentByTaskId,
  updateContentStatus,
  saveContentHistory,
} from '@/lib/db'
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

// POST: chạy pipeline AI viết 1 bài GBP post.
// Có 2 cách gọi:
// 1) { task_id, business_name, industry, area, brand_voice, phone, extra_info }
//    -> viết bài cho 1 task loại "content" đã có sẵn (từ lịch việc sinh từ lộ trình).
//    Nếu task đó chưa có content liên kết thì tự tạo mới, tránh tạo trùng
//    nếu gọi lại nhiều lần.
// 2) { client_id, plan_id?, topic, ...client info } -> viết bài ad-hoc,
//    không gắn task (dùng cho trang /test hoặc viết nhanh không qua lộ trình).
export async function POST(req: Request) {
  try {
    const body = await req.json()

    let contentRow: any
    let topic = body.topic
    let goal = body.goal

    if (body.task_id) {
      const task = await getTaskById(body.task_id)
      if (task.task_type !== 'content') {
        return NextResponse.json(
          { error: 'Task này không phải loại "content", không thể viết bài AI cho việc này' },
          { status: 400 }
        )
      }
      topic = task.title
      goal = task.description

      const existing = await getContentByTaskId(task.id)
      contentRow = existing || (await createContentForTask(task))
    } else {
      if (!body.client_id || !topic) {
        return NextResponse.json(
          { error: 'Thiếu client_id hoặc topic' },
          { status: 400 }
        )
      }
      contentRow = await createAdHocContent({
        client_id: body.client_id,
        plan_id: body.plan_id,
        topic,
      })
    }

    // 1. SERP-Aware
    const serpPrompt = SERP_AWARE_PROMPT
      .replaceAll('{{industry}}', body.industry || '')
      .replaceAll('{{area}}', body.area || '')
      .replaceAll('{{topic}}', topic || '')
      .replaceAll('{{goal}}', goal || '')
      .replaceAll('{{business_name}}', body.business_name || '')

    const serp_analysis = await askClaude(serpPrompt)

    // 2. Writer
    const writerPrompt = WRITER_PROMPT
      .replaceAll('{{business_name}}', body.business_name || '')
      .replaceAll('{{industry}}', body.industry || '')
      .replaceAll('{{area}}', body.area || '')
      .replaceAll('{{topic}}', topic || '')
      .replaceAll('{{goal}}', goal || '')
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

    // 5. Lưu: contents.status = waiting_approval; toàn bộ văn bản AI lưu
    // vào 1 dòng content_history mới (ai_version = bản cuối AI, edit_note
    // giữ serp_analysis + bản nháp + critic_feedback dạng JSON).
    const updatedContent = await updateContentStatus(contentRow.id, 'waiting_approval')

    await saveContentHistory({
      content_id: contentRow.id,
      client_id: contentRow.client_id,
      ai_version: final_content,
      edit_note: JSON.stringify({ serp_analysis, ai_draft: ai_content, critic_feedback }),
    })

    return NextResponse.json({
      content: updatedContent,
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
