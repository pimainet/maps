// Đồng ý xử lý dữ liệu cá nhân theo từng mục đích (Luật 91/2025/QH15 Điều 9; NĐ 356/2025/NĐ-CP Điều 6).
// GET: trạng thái + lịch sử của chính người dùng. POST: ghi 1 bản đồng ý (kèm phiên bản, thời điểm, IP, trình duyệt).
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { getCurrentUser } from '@/lib/auth'
import { publicError } from '@/lib/api-error'
import { readJsonObject } from '@/lib/request-body'
import {
  CONSENT_COOKIE,
  CONSENT_VERSION,
  clientIpFromHeaders,
  missingRequiredPurposes,
  normalizeConsentChoice,
  parseConsentCookie,
  truncateUserAgent,
  type ConsentChoice,
} from '@/lib/privacy/policy'
import { currentConsent, recordConsent } from '@/lib/privacy/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { supabaseAdmin } = await import('@/lib/supabase/admin')
    const s = await currentConsent(supabaseAdmin, user.id)
    return NextResponse.json({
      version: CONSENT_VERSION,
      setup_required: s.setupRequired,
      // Chưa chạy migration 033 thì không chặn người dùng (không có chỗ lưu bằng chứng).
      needs_consent: !s.setupRequired && s.needsConsent,
      reason: s.reason,
      current: s.current,
      history: s.history.slice(0, 20),
    })
  } catch (error) {
    return NextResponse.json({ error: publicError(error) }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const body = await readJsonObject(request, 4 * 1024)
    if (!body.ok) return NextResponse.json({ error: body.error }, { status: body.status })

    const source = body.value.source === 'signup' ? 'signup' : body.value.source === 'settings' ? 'settings' : 'consent_gate'
    const { supabaseAdmin } = await import('@/lib/supabase/admin')
    const state = await currentConsent(supabaseAdmin, user.id)
    if (state.setupRequired) return NextResponse.json({ error: 'Hệ thống chưa sẵn sàng lưu đồng ý (thiếu migration 033).', setup_required: true }, { status: 503 })
    if (state.history.length >= 30 && Date.now() - Date.parse(state.history[0].recorded_at) < 60_000) {
      return NextResponse.json({ error: 'Thao tác quá nhanh, vui lòng thử lại sau.' }, { status: 429 })
    }

    let purposes: ConsentChoice
    let consentedAt = new Date()
    let version = CONSENT_VERSION
    const jar = await cookies()

    if (source === 'signup') {
      // Lựa chọn đã tick trên trang đăng ký: cookie (cùng trình duyệt) hoặc metadata lúc signUp (xác nhận email ở máy khác).
      const fromCookie = parseConsentCookie(jar.get(CONSENT_COOKIE)?.value)
      let picked: { version: string; choice: ConsentChoice; at: Date } | null = fromCookie
      if (!picked) {
        const { data } = await supabaseAdmin.auth.admin.getUserById(user.id)
        const meta = (data?.user?.user_metadata || {}) as Record<string, unknown>
        const at = typeof meta.consent_at === 'string' ? new Date(meta.consent_at) : null
        if (typeof meta.consent_version === 'string' && at && Number.isFinite(at.getTime())) {
          picked = { version: meta.consent_version, choice: normalizeConsentChoice(meta.consent_purposes), at }
        }
      }
      if (!picked) return NextResponse.json({ error: 'Không tìm thấy lựa chọn đồng ý lúc đăng ký.', needs_form: true }, { status: 404 })
      if (picked.version !== CONSENT_VERSION || missingRequiredPurposes(picked.choice).length) {
        jar.delete(CONSENT_COOKIE)
        return NextResponse.json({ error: 'Chính sách đã cập nhật, vui lòng xác nhận lại.', needs_form: true }, { status: 409 })
      }
      purposes = picked.choice
      consentedAt = picked.at
      version = picked.version
    } else {
      purposes = normalizeConsentChoice(body.value.purposes)
      const missing = missingRequiredPurposes(purposes)
      if (missing.length) {
        return NextResponse.json(
          { error: 'Cần đồng ý các mục bắt buộc để dùng dịch vụ. Nếu muốn rút lại đồng ý bắt buộc, hãy yêu cầu xoá tài khoản.', missing },
          { status: 400 },
        )
      }
    }

    await recordConsent(supabaseAdmin, {
      userId: user.id,
      purposes,
      action: state.current ? 'update' : 'grant',
      source,
      consentedAt,
      version,
      ip: clientIpFromHeaders(request.headers),
      userAgent: truncateUserAgent(request.headers.get('user-agent')),
    })
    jar.delete(CONSENT_COOKIE)
    return NextResponse.json({ ok: true, version, purposes })
  } catch (error) {
    return NextResponse.json({ error: publicError(error) }, { status: 500 })
  }
}
