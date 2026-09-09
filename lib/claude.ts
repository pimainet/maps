import Anthropic from '@anthropic-ai/sdk'

function getClient() {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    throw new Error(
      'Thiếu ANTHROPIC_API_KEY. Thêm biến môi trường trên Vercel (Settings → Environment Variables) rồi redeploy.'
    )
  }
  return new Anthropic({ apiKey })
}

export type AskClaudeOptions = {
  maxTokens?: number
  temperature?: number
}

export async function askClaude(prompt: string, options?: AskClaudeOptions) {
  const anthropic = getClient()
  const max_tokens = options?.maxTokens ?? 2000
  const temperature = options?.temperature ?? 0.7

  try {
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens,
      temperature,
      messages: [{ role: 'user', content: prompt }],
    })

    const content = message.content[0]
    return content.type === 'text' ? content.text : ''
  } catch (err: any) {
    const msg =
      err?.error?.message ||
      err?.message ||
      (typeof err === 'string' ? err : 'Lỗi gọi Claude API')
    throw new Error(`Claude API: ${msg}`)
  }
}
