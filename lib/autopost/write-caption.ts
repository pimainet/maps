import { askClaude } from '@/lib/claude'
import { assertCaptionSafe, isCaptionTooSimilar } from '@/lib/autopost/caption'

export type CaptionContext = {
  name: string
  industry?: string | null
  area?: string | null
  brandVoice?: string | null
  topic?: string | null
  aiDescription?: string | null
  aiTags?: string[] | null
  previousCaptions?: string[]
}

export function buildCaptionPrompt(ctx: CaptionContext, attemptNote?: string): string {
  const previous = (ctx.previousCaptions || []).slice(0, 5)
  return `Viết caption tiếng Việt cho một bài đăng Google Business Profile (topicType STANDARD).
Doanh nghiệp: ${ctx.name}
Ngành: ${ctx.industry || 'chưa rõ'}
Khu vực: ${ctx.area || 'chưa rõ'}
Giọng thương hiệu: ${ctx.brandVoice || 'thân thiện, tự nhiên, không khoa trương'}
Chủ đề bài: ${ctx.topic || 'cập nhật hoạt động'}
Ảnh đang đăng: ${ctx.aiDescription || 'không có mô tả'}
Nhãn ảnh: ${(ctx.aiTags || []).join(', ') || 'không có'}

Yêu cầu:
- 400 đến 900 ký tự, tiếng Việt tự nhiên.
- Mô tả đúng nội dung ảnh, lồng dịch vụ và khu vực (nếu có) một cách tự nhiên.
- Không bịa giá, khuyến mãi, hay thông tin chưa được cung cấp.
- Không chèn số điện thoại, email, hay đường link.
- Không dùng hashtag dày đặc, không emoji quá nhiều.
- Không lặp câu mở đầu hoặc lời kêu gọi của các caption gần đây:
${previous.length ? previous.map((c, i) => `${i + 1}. ${c}`).join('\n') : '(chưa có)'}
${attemptNote || ''}
Chỉ trả về phần caption, không giải thích, không bọc markdown.`
}

export async function generateCaption(ctx: CaptionContext): Promise<string> {
  let note = ''
  let last = ''
  for (let i = 0; i < 3; i++) {
    const raw = (await askClaude(buildCaptionPrompt(ctx, note), { maxTokens: 800, temperature: 0.7 })).trim()
    const text = raw.replace(/^```(?:text)?/i, '').replace(/```$/i, '').trim()
    last = text
    const safe = assertCaptionSafe(text)
    if (!safe.ok) {
      note =
        safe.reason === 'phone'
          ? 'Bản trước có số điện thoại — viết lại, dùng nút gọi thay vì ghi SĐT.'
          : 'Bản trước sai độ dài (cần 400–900 ký tự). Viết lại đúng độ dài.'
      continue
    }
    const clash = (ctx.previousCaptions || []).some((p) => isCaptionTooSimilar(text, p))
    if (clash) {
      note = 'Bản trước quá giống caption cũ. Đổi cách mở bài và lời kêu gọi, giữ đúng nội dung ảnh.'
      continue
    }
    return text
  }
  return last
}
