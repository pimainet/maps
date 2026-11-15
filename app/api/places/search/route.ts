import { NextResponse } from 'next/server'
import { errorStatus, publicError } from '@/lib/api-error'
import { requireActiveWorkspaceId } from '@/lib/auth'
import { checkAiRateLimit, recordAiUsage } from '@/lib/rate-limit'
import { placeSearchConfigured, searchPlaceCandidates } from '@/lib/place-search'

export const runtime = 'nodejs'
export const maxDuration = 60

/** POST { query } — "Tên doanh nghiệp + khu vực" -> tối đa 5 doanh nghiệp trên Google Maps để chủ quán chọn. */
export async function POST(req: Request) {
  try {
    const workspaceId = await requireActiveWorkspaceId()
    const { userId } = await checkAiRateLimit(workspaceId, 'place-search')
    const body = await req.json().catch(() => null)
    const query = typeof body?.query === 'string' ? body.query.trim().replace(/\s+/g, ' ') : ''

    if (query.length < 3) return NextResponse.json({ error: 'Hãy gõ tên doanh nghiệp (và khu vực), ít nhất 3 ký tự.' }, { status: 400 })
    if (query.length > 120) return NextResponse.json({ error: 'Nội dung tìm quá dài.' }, { status: 400 })
    if (/^https?:\/\//i.test(query) || /^(www\.)?(google|maps|goo\.gl|share\.google)/i.test(query)) {
      return NextResponse.json(
        { error: 'Ô này tìm theo tên. Hãy gõ tên doanh nghiệp và khu vực, ví dụ “Nha khoa Tâm An Quận 3”.' },
        { status: 400 },
      )
    }
    if (!placeSearchConfigured()) {
      return NextResponse.json({ error: 'Tính năng tìm doanh nghiệp chưa được cấu hình.' }, { status: 503 })
    }

    await recordAiUsage(workspaceId, 'place-search', userId) // ghi nhận trước: lượt gọi tốn tiền dù có kết quả hay không
    const results = await searchPlaceCandidates(query)
    return NextResponse.json({ results })
  } catch (error: any) {
    return NextResponse.json({ error: publicError(error) }, { status: errorStatus(error) })
  }
}
