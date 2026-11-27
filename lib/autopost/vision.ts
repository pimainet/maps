import Anthropic from '@anthropic-ai/sdk'
import sharp from 'sharp'

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504, 529])

export const TAGS_BY_INDUSTRY: Record<string, string[]> = {
  'nhà hàng': ['mon_an', 'hai_san', 'do_uong', 'khong_gian', 'mat_tien', 'nhan_vien', 'su_kien', 'menu'],
  'khách sạn': ['phong', 'view_bien', 'ho_boi', 'sanh', 'an_sang', 'mat_tien', 'nhan_vien'],
  spa: ['phong_tri_lieu', 'lieu_trinh', 'san_pham', 'nhan_vien', 'khong_gian', 'mat_tien'],
}

export const DEFAULT_TAGS = [
  'mat_tien',
  'khong_gian',
  'san_pham',
  'nhan_vien',
  'su_kien',
  'menu',
]

const GBP_CATEGORIES = [
  'COVER',
  'PROFILE',
  'LOGO',
  'EXTERIOR',
  'INTERIOR',
  'PRODUCT',
  'AT_WORK',
  'FOOD_AND_DRINK',
  'MENU',
  'COMMON_AREA',
  'ROOMS',
  'TEAMS',
  'ADDITIONAL',
] as const

export type VisionResult = {
  description: string
  tags: string[]
  gbp_category: (typeof GBP_CATEGORIES)[number]
  quality: number
  reject_reason: string | null
}

function allowedTags(industry?: string | null): string[] {
  const key = (industry || '').trim().toLowerCase()
  if (!key) return DEFAULT_TAGS
  for (const [name, tags] of Object.entries(TAGS_BY_INDUSTRY)) {
    if (key.includes(name)) return tags
  }
  return DEFAULT_TAGS
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function tagPhotoWithClaude(opts: {
  jpeg: Buffer
  industry?: string | null
  name?: string | null
  area?: string | null
}): Promise<VisionResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('Thiếu ANTHROPIC_API_KEY')

  const tags = allowedTags(opts.industry)
  const context = [opts.name, opts.industry, opts.area].filter(Boolean).join(' — ')
  const prompt = `Bạn đang gắn nhãn ảnh cho hồ sơ Google Business của doanh nghiệp Việt Nam${context ? `: ${context}` : ''}.
Chỉ trả về JSON, không markdown, đúng các khoá:
{
  "description": "1-2 câu tiếng Việt mô tả đúng những gì thấy trong ảnh",
  "tags": ["..."],
  "gbp_category": "FOOD_AND_DRINK",
  "quality": 0.0,
  "reject_reason": null
}
tags chỉ lấy từ danh sách: ${tags.join(', ')}.
gbp_category chỉ một trong: ${GBP_CATEGORIES.join(', ')}.
quality từ 0 đến 1 (nét, đủ sáng, bố cục, không phải ảnh chụp màn hình).
Nếu ảnh mờ, có chữ/số điện thoại dán lên, watermark, ảnh mạng, hoặc người lạ rõ mặt chưa phù hợp để đăng, ghi reject_reason tiếng Việt; nếu ổn thì reject_reason = null.`

  const thumb = await sharp(opts.jpeg)
    .resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 80 })
    .toBuffer()
  const base64 = thumb.toString('base64')

  const anthropic = new Anthropic({ apiKey })
  let lastErr: any = null
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const message = await anthropic.messages.create({
        model: 'claude-sonnet-4-5',
        max_tokens: 600,
        temperature: 0.2,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: { type: 'base64', media_type: 'image/jpeg', data: base64 },
              },
              { type: 'text', text: prompt },
            ],
          },
        ],
      })
      const text = message.content[0]?.type === 'text' ? message.content[0].text : ''
      return parseVision(text, tags)
    } catch (err: any) {
      lastErr = err
      const status = err?.status ?? err?.error?.status
      const type = err?.error?.type ?? err?.type
      if (attempt < 3 && (RETRYABLE_STATUS.has(status) || type === 'overloaded_error' || type === 'api_error')) {
        await sleep(600 * attempt)
        continue
      }
      break
    }
  }
  throw new Error(`Claude API: ${lastErr?.error?.message || lastErr?.message || 'lỗi vision'}`)
}

export function parseVision(raw: string, allowed: string[]): VisionResult {
  const jsonText = raw.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim()
  const start = jsonText.indexOf('{')
  const end = jsonText.lastIndexOf('}')
  if (start < 0 || end < start) {
    return {
      description: '',
      tags: [],
      gbp_category: 'ADDITIONAL',
      quality: 0,
      reject_reason: 'Không đọc được kết quả gắn nhãn',
    }
  }
  let data: any = {}
  try {
    data = JSON.parse(jsonText.slice(start, end + 1))
  } catch {
    return {
      description: '',
      tags: [],
      gbp_category: 'ADDITIONAL',
      quality: 0,
      reject_reason: 'Không đọc được kết quả gắn nhãn',
    }
  }
  const tags = Array.isArray(data.tags)
    ? data.tags.filter((t: unknown) => typeof t === 'string' && allowed.includes(t))
    : []
  const cat = GBP_CATEGORIES.includes(data.gbp_category) ? data.gbp_category : 'ADDITIONAL'
  const quality = Math.min(1, Math.max(0, Number(data.quality) || 0))
  const reject =
    typeof data.reject_reason === 'string' && data.reject_reason.trim()
      ? data.reject_reason.trim()
      : null
  return {
    description: typeof data.description === 'string' ? data.description.trim().slice(0, 500) : '',
    tags,
    gbp_category: cat,
    quality,
    reject_reason: reject,
  }
}
