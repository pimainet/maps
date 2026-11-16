import { NextResponse } from 'next/server'
import { errorStatus, publicError } from '@/lib/api-error'
import { requireActiveWorkspaceId } from '@/lib/auth'
import { getClientById } from '@/lib/db'
import { checkAiRateLimit, recordAiUsage } from '@/lib/rate-limit'
import { auditQuotaPlaceKey } from '@/lib/audit-quota-key'
import { createCachedClassifier, createRealAIClassifier } from '@/lib/audit-engine'
import { generateDescriptionDrafts, parseProfile } from '@/lib/audit-engine/advice'
import { createSupabaseClassifierStore } from '@/lib/audit-classifier-store'
import { getBusinessProfile, saveBusinessProfile, saveDescriptionDrafts } from '@/lib/business-profile-store'

export const runtime = 'nodejs'
export const maxDuration = 60

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const workspaceId = await requireActiveWorkspaceId()
    const { id } = await params
    const client = await getClientById(id, workspaceId)
    if (!client) return NextResponse.json({ error: 'Không tìm thấy doanh nghiệp này.' }, { status: 404 })
    const profile = await getBusinessProfile(id, workspaceId, auditQuotaPlaceKey(client as any))
    return NextResponse.json({ profile })
  } catch (error: any) {
    return NextResponse.json({ error: publicError(error) }, { status: errorStatus(error) })
  }
}

/**
 * POST { summary, main_service, services[], confidence?, edited? }
 * Chủ quán bấm "Đúng rồi" (hoặc sửa rồi xác nhận): lưu hồ sơ đã xác nhận rồi viết 1–2 mô tả mẫu từ CHÍNH hồ sơ đó.
 * Mô tả mẫu chỉ dùng dữ kiện này; mẫu có con số lạ / link / khuyến mãi / từ so sánh tuyệt đối bị loại (xem advice.ts).
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const workspaceId = await requireActiveWorkspaceId()
    const { id } = await params
    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Dữ liệu gửi lên không hợp lệ.' }, { status: 400 })
    const client = await getClientById(id, workspaceId)
    if (!client) return NextResponse.json({ error: 'Không tìm thấy doanh nghiệp này.' }, { status: 404 })

    const parsed = parseProfile({
      summary: body.summary,
      main_service: body.main_service,
      services: body.services,
      confidence: 'high', // chủ quán đã xác nhận
    })
    if (!parsed) return NextResponse.json({ error: 'Cần ghi rõ dịch vụ chính của quán.' }, { status: 400 })
    if (body.edited === true) {
      // Chủ quán tự sửa: dựng lại câu tóm tắt từ chính chữ họ nhập để câu hiển thị và dữ kiện luôn khớp nhau.
      parsed.summary = `Quán ${client.name}: dịch vụ chính là ${parsed.mainService}` + (parsed.services.length ? `, ngoài ra có ${parsed.services.join(', ')}.` : '.')
    }

    const { userId } = await checkAiRateLimit(workspaceId, 'business-profile')
    const placeKey = auditQuotaPlaceKey(client as any)
    // Đo độ đúng của phần AI đoán: tỉ lệ chủ quán phải sửa (xem log Vercel). Không chứa nội dung riêng tư.
    console.info('business-profile confirm', JSON.stringify({ edited: body.edited === true }))
    await saveBusinessProfile({ clientId: id, workspaceId, placeKey, profile: parsed, confirmed: true })

    const ai = createCachedClassifier(createRealAIClassifier(), createSupabaseClassifierStore())
    const drafts = await generateDescriptionDrafts({
      ai,
      name: client.name,
      area: client.area,
      profile: parsed,
      primaryCategory: client.industry,
    })
    await recordAiUsage(workspaceId, 'business-profile', userId)
    if (drafts.length) await saveDescriptionDrafts(id, workspaceId, drafts).catch((e) => console.error('save drafts:', e?.message))

    return NextResponse.json({ ok: true, profile: { ...parsed, confirmed: true }, drafts })
  } catch (error: any) {
    return NextResponse.json({ error: publicError(error) }, { status: errorStatus(error) })
  }
}
