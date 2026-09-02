import { NextResponse } from 'next/server'
import { askClaude } from '@/lib/claude'
import { createContentIdeas } from '@/lib/db'
import { CONTENT_CALENDAR_PROMPT } from '@/lib/prompts'

function parseTopicsJson(raw: string) {
  // AI đôi khi vẫn bọc kết quả trong ```json ... ``` dù đã dặn không làm vậy.
  const cleaned = raw
    .trim()
    .replace(/^```json/i, '')
    .replace(/^```/, '')
    .replace(/```$/, '')
    .trim()

  const parsed = JSON.parse(cleaned)
  if (!Array.isArray(parsed)) {
    throw new Error('Kết quả AI không phải là danh sách hợp lệ')
  }
  return parsed as Array<{ scheduled_date?: string; topic: string; goal?: string }>
}

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const {
      client_id,
      plan_id,
      business_name,
      industry,
      area,
      plan_result,
      start_date,
    } = body

    if (!client_id || !plan_result) {
      return NextResponse.json(
        { error: 'Thiếu client_id hoặc plan_result' },
        { status: 400 }
      )
    }

    const prompt = CONTENT_CALENDAR_PROMPT.replaceAll('{{business_name}}', business_name || '')
      .replaceAll('{{industry}}', industry || '')
      .replaceAll('{{area}}', area || '')
      .replaceAll('{{start_date}}', start_date || new Date().toISOString().slice(0, 10))
      .replaceAll('{{plan_result}}', plan_result)

    const raw = await askClaude(prompt)

    let topics: Array<{ scheduled_date?: string; topic: string; goal?: string }>
    try {
      topics = parseTopicsJson(raw)
    } catch (parseError: any) {
      return NextResponse.json(
        {
          error: 'AI trả về dữ liệu không đúng định dạng JSON, không thể tạo lịch nội dung tự động.',
          raw_output: raw,
        },
        { status: 502 }
      )
    }

    const validTopics = topics.filter((t) => t && typeof t.topic === 'string' && t.topic.trim())
    if (validTopics.length === 0) {
      return NextResponse.json(
        { error: 'AI không sinh ra chủ đề nào hợp lệ' },
        { status: 502 }
      )
    }

    const created = await createContentIdeas(
      validTopics.map((t) => ({
        client_id,
        plan_id,
        topic: t.topic.trim(),
        goal: t.goal?.trim(),
        scheduled_date: t.scheduled_date,
      }))
    )

    return NextResponse.json({ items: created })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
