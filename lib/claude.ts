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

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504, 529])

function isRetryable(err: any): boolean {
  const status = err?.status ?? err?.error?.status
  const type = err?.error?.type ?? err?.type
  return RETRYABLE_STATUS.has(status) || type === 'overloaded_error' || type === 'api_error'
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function askClaude(prompt: string, options?: AskClaudeOptions) {
  const anthropic = getClient()
  const max_tokens = options?.maxTokens ?? 2000
  const temperature = options?.temperature ?? 0.7

  // Claude API thỉnh thoảng lỗi tạm thời (quá tải, timeout...) — không
  // phải lỗi do prompt/code. Không retry thì 1 lần lỗi vặt cũng làm
  // người dùng mất trắng 1 lượt gọi trong quota vốn đã giới hạn theo
  // tháng (audit) hoặc theo giờ (content/plan). Retry tối đa 2 lần,
  // chờ tăng dần, chỉ với lỗi có vẻ tạm thời — lỗi do input sai (400,
  // 401...) thì fail ngay, retry không giúp được gì.
  const maxAttempts = 3
  let lastErr: any = null

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
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
      lastErr = err
      if (attempt < maxAttempts && isRetryable(err)) {
        await sleep(600 * attempt)
        continue
      }
      break
    }
  }

  const msg =
    lastErr?.error?.message ||
    lastErr?.message ||
    (typeof lastErr === 'string' ? lastErr : 'Lỗi gọi Claude API')
  throw new Error(`Claude API: ${msg}`)
}
