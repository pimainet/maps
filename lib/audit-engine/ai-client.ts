import { askClaude } from '@/lib/claude'
import type { AIClassifier, AIClassifyInput } from './types'

function parseJsonLoose(raw: string): unknown {
  const cleaned = raw
    .trim()
    .replace(/^```json/i, '')
    .replace(/^```/, '')
    .replace(/```$/, '')
    .trim()
  return JSON.parse(cleaned)
}

/**
 * Classifier THẬT — dùng đúng `askClaude()` sẵn có của hệ thống (đã có
 * retry cho lỗi tạm thời, đã cấu hình model 'claude-sonnet-4-5'). Không
 * tạo client Anthropic song song — tránh 2 nơi cấu hình key/model khác nhau.
 */
export function createRealAIClassifier(): AIClassifier {
  return {
    async classify<T>(input: AIClassifyInput): Promise<T> {
      const prompt = `${input.system}\n\n${input.user}\n\nChỉ trả JSON thuần, không markdown, không giải thích.`
      const raw = await askClaude(prompt, { maxTokens: 1024, temperature: 0.2 })
      try {
        return parseJsonLoose(raw) as T
      } catch {
        throw new Error(`AI trả về không phải JSON hợp lệ: ${raw.slice(0, 200)}`)
      }
    },
  }
}
