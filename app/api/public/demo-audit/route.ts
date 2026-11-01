import { buildGbpObservationBlock } from '@/lib/gbp-audit-fields'
import { NextResponse } from 'next/server'
import { askClaude } from '@/lib/claude'
import { AUDIT_PROMPT } from '@/lib/prompts'
import { runGbpPublicSnapshot } from '@/lib/gbp-browser-snapshot'
import { parseAuditResult } from '@/lib/audit-parse'
import { extractPlaceIdFromUrl } from '@/lib/place-identity'
import type { DemoAudit } from '@/lib/demo-audit'
import { clientIp, clientIpHash, publicCorsHeaders, requestText } from '@/lib/public-request-safety'

export const maxDuration = 300
export const runtime = 'nodejs'

const MAX_BODY_BYTES = 16 * 1024

export async function OPTIONS(req: Request) {
  return new NextResponse(null, { status: 204, headers: publicCorsHeaders(req.headers.get('origin')) })
}

export async function POST(req: Request) {
  const headers = publicCorsHeaders(req.headers.get('origin'))
  let reservationId: string | null = null
  let admin: any = null
  try {
    const declaredLength = Number(req.headers.get('content-length') || 0)
    if (declaredLength > MAX_BODY_BYTES) {
      return NextResponse.json({ error: 'Dữ liệu gửi lên quá lớn.' }, { status: 413, headers })
    }
    const rawBody = await req.text()
    if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
      return NextResponse.json({ error: 'Dữ liệu gửi lên quá lớn.' }, { status: 413, headers })
    }
    let body: any
    try {
      body = JSON.parse(rawBody)
    } catch {
      return NextResponse.json({ error: 'Dữ liệu JSON không hợp lệ.' }, { status: 400, headers })
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'Dữ liệu JSON không hợp lệ.' }, { status: 400, headers })
    }
    const phone = requestText(body.phone, 40).replace(/[\s.\-()]/g, '')
    const business = requestText(body.business || body.business_name, 160)
    const mapsUrl = requestText(body.mapsUrl || body.gbp_link, 2048)
    const city = requestText(body.city || body.area, 160)
    const industryLabel = requestText(body.industryLabel || body.industry, 100)
    const name = requestText(body.name, 80)

    if (!/^0\d{9}$/.test(phone)) {
      return NextResponse.json({ error: 'Số Zalo không hợp lệ' }, { status: 400, headers })
    }
    if (!mapsUrl && business.length < 3) {
      return NextResponse.json(
        { error: 'Cần link Google Maps hoặc tên cửa hàng để đọc hồ sơ thật.' },
        { status: 400, headers },
      )
    }

    try {
      const mod = await import('@/lib/supabase/admin')
      admin = mod.supabaseAdmin
    } catch {
      return NextResponse.json({ error: 'Dịch vụ demo tạm thời chưa sẵn sàng.' }, { status: 503, headers })
    }

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    const ip = clientIp(req)
    const ipHash = clientIpHash(ip)
    const [phoneQuota, ipQuota, legacyIpQuota] = await Promise.all([
      admin.from('demo_leads').select('id', { count: 'exact', head: true }).eq('phone', phone).gte('created_at', since),
      admin.from('demo_leads').select('id', { count: 'exact', head: true }).in('source', ['landing-demo-pending', 'landing-demo-live']).contains('raw', { ip_hash: ipHash }).gte('created_at', since),
      admin.from('demo_leads').select('id', { count: 'exact', head: true }).in('source', ['landing-demo-pending', 'landing-demo-live']).contains('raw', { ip }).gte('created_at', since),
    ])
    if (phoneQuota.error || ipQuota.error || legacyIpQuota.error) {
      console.error('public demo quota check failed:', phoneQuota.error?.message || ipQuota.error?.message || legacyIpQuota.error?.message)
      return NextResponse.json({ error: 'Không thể xác nhận giới hạn demo lúc này. Vui lòng thử lại sau.' }, { status: 503, headers })
    }
    if ((phoneQuota.count || 0) >= 3) {
      return NextResponse.json(
        { error: 'Số này đã chạy audit demo 3 lần trong 24 giờ. Nhắn Zalo để xem bản đầy đủ.' },
        { status: 429, headers },
      )
    }
    // Count legacy raw-IP rows through their 24-hour lifetime during rollout.
    if ((ipQuota.count || 0) + (legacyIpQuota.count || 0) >= 5) {
      return NextResponse.json(
        { error: 'Đã đạt giới hạn audit demo trong 24 giờ. Vui lòng thử lại sau.' },
        { status: 429, headers },
      )
    }

    const reservation = await admin.from('demo_leads').insert({
      name: name.slice(0, 80),
      phone,
      business_name: business || null,
      industry: industryLabel || null,
      area: city || null,
      gbp_link: mapsUrl || null,
      source: 'landing-demo-pending',
      raw: { ip_hash: ipHash },
    }).select('id').single()
    if (reservation.error || !reservation.data?.id) {
      console.error('public demo quota reservation failed:', reservation.error?.message)
      return NextResponse.json({ error: 'Không thể bắt đầu audit demo lúc này. Vui lòng thử lại sau.' }, { status: 503, headers })
    }
    reservationId = reservation.data.id

    const placeId = extractPlaceIdFromUrl(mapsUrl)
    const snapshot = await runGbpPublicSnapshot({
      mapsUrl: mapsUrl || undefined,
      businessName: business || undefined,
      area: city || undefined,
      placeId,
      // demo công khai: đọc nhanh (tổng quan + giờ + giới thiệu), không chạy đủ tab để giữ thời gian/chi phí
      depth: 'quick',
    })

    const hasProfile = Boolean(
      snapshot.business_name ||
        snapshot.rating != null ||
        snapshot.review_count != null ||
        snapshot.address_text ||
        snapshot.place_id,
    )

    if (!hasProfile) {
      return NextResponse.json(
        {
          error:
            snapshot.error ||
            'Không đọc được hồ sơ Google Maps. Kiểm tra lại link hoặc tên cửa hàng + khu vực.',
          snapshot,
        },
        { status: 422, headers },
      )
    }

    const additional = [
      snapshot.address_text ? `Địa chỉ (Maps): ${snapshot.address_text}` : '',
      snapshot.phone ? `SĐT (Maps): ${snapshot.phone}` : '',
      snapshot.website_url ? `Website: ${snapshot.website_url}` : '',
      snapshot.opening_hours
        ? `Giờ mở cửa (Maps, ĐÃ CÓ): ${snapshot.opening_hours}`
        : 'Giờ mở cửa: Chưa đọc được trên lần quan sát này — không kết luận là thiếu.',
      snapshot.additional_categories
        ? `Danh mục phụ (Maps, ĐÃ CÓ): ${snapshot.additional_categories}`
        : 'Danh mục phụ: Chưa đọc được trên lần quan sát này — không kết luận là thiếu.',
      Array.isArray(snapshot.recent_posts) && snapshot.recent_posts.length
        ? 'Bài đăng:\n' +
          snapshot.recent_posts
            .map((p: any, i: number) => `${i + 1}. ${String(p.text || '').slice(0, 160)}`)
            .join('\n')
        : '',
      snapshot.source_used ? `Nguồn quan sát: ${snapshot.source_used}` : '',
      buildGbpObservationBlock(snapshot),
    ]
      .filter(Boolean)
      .join('\n')

    const prompt = AUDIT_PROMPT.replaceAll('{{output_language}}', 'Tiếng Việt')
      .replaceAll('{{business_name}}', snapshot.business_name || business)
      .replaceAll('{{industry}}', snapshot.primary_category || industryLabel)
      .replaceAll('{{area}}', snapshot.address_text || city)
      .replaceAll('{{gbp_link}}', snapshot.maps_url || mapsUrl)
      .replaceAll('{{description}}', snapshot.description || '')
      .replaceAll('{{primary_category}}', snapshot.primary_category || '')
      .replaceAll(
        '{{additional_categories}}',
        snapshot.additional_categories || 'Chưa đọc được trên lần quan sát này — không kết luận là thiếu',
      )
      .replaceAll('{{review_count}}', snapshot.review_count != null ? String(snapshot.review_count) : '')
      .replaceAll('{{rating}}', snapshot.rating != null ? String(snapshot.rating) : '')
      .replaceAll('{{recent_posts}}', snapshot.posts_signal || '')
      .replaceAll('{{photos_status}}', snapshot.photos_signal || '')
      .replaceAll('{{additional_info}}', additional)
      .replaceAll(
        '{{progress_context}}',
        '### Tiến độ đã ghi nhận trong hệ thống\n- Audit demo công khai từ landing — chưa có lịch sử chu kỳ.',
      )

    const auditText = await askClaude(prompt, { maxTokens: 2200, temperature: 0.3 })
    const parsed = parseAuditResult(auditText, {
      name: snapshot.business_name || business,
      industry: snapshot.primary_category || industryLabel,
      area: city || snapshot.address_text || '',
      mapsUrl: snapshot.maps_url || mapsUrl,
    })

    const audit: DemoAudit & {
      source?: string
      snapshot?: Record<string, unknown>
    } = {
      ...parsed,
      businessName: snapshot.business_name || parsed.businessName,
      industryLabel: snapshot.primary_category || parsed.industryLabel,
      area: city || snapshot.address_text || parsed.area,
      mapsUrl: snapshot.maps_url || mapsUrl,
      lockedHints: [
        {
          title: 'Lộ trình 30 ngày',
          teaser: 'Tuần 1 xử lý ưu tiên Cao · Tuần 2 củng cố hồ sơ · Tuần 3 nội dung · Tuần 4 đo tín hiệu',
        },
        {
          title: 'Hạng quanh cửa · 2 km',
          teaser: 'Lưới ô theo từ khóa khách hay tìm — chỉ mở khi audit đủ trong OS.',
        },
        {
          title: 'Tín hiệu gọi / chỉ đường',
          teaser: 'Số liệu trước–sau theo chu kỳ. Demo không bịa số này.',
        },
      ],
      source: snapshot.source_used,
      snapshot: {
        rating: snapshot.rating,
        review_count: snapshot.review_count,
        category: snapshot.primary_category,
        address: snapshot.address_text,
        phone: snapshot.phone,
        photos_signal: snapshot.photos_signal,
        posts_signal: snapshot.posts_signal,
        place_id: snapshot.place_id,
        maps_url: snapshot.maps_url,
      },
    }

    if (admin && reservationId) {
      const { error: updateError } = await admin.from('demo_leads').update({
        business_name: audit.businessName,
        industry: audit.industryLabel,
        area: audit.area,
        gbp_link: audit.mapsUrl || null,
        status: body.status || null,
        overall_score: audit.overall,
        source: 'landing-demo-live',
        raw: {
          ip_hash: ipHash,
          snapshot: audit.snapshot,
          source_used: snapshot.source_used,
          audit_preview: {
            overall: audit.overall,
            actions: audit.actions,
          },
        },
      }).eq('id', reservationId)
      if (updateError) console.error('public demo result update failed:', updateError.message)
    }

    return NextResponse.json(
      {
        ok: true,
        live: true,
        audit,
      },
      { headers },
    )
  } catch (error: any) {
    console.error('public demo-audit:', error)
    return NextResponse.json(
      { error: 'Không chạy được audit trên hồ sơ Maps. Vui lòng thử lại sau.' },
      { status: 500, headers },
    )
  }
}
