import { NextResponse } from 'next/server'
import { askClaude } from '@/lib/claude'
import { AUDIT_PROMPT } from '@/lib/prompts'
import { runGbpPublicSnapshot } from '@/lib/gbp-browser-snapshot'
import { parseAuditResult } from '@/lib/audit-parse'
import { extractPlaceIdFromUrl } from '@/lib/place-identity'
import type { DemoAudit } from '@/lib/demo-audit'

export const maxDuration = 300
export const runtime = 'nodejs'

const ALLOWED = [
  'https://maps.bgs.com.vn',
  'https://bgs.com.vn',
  'https://www.bgs.com.vn',
  process.env.LANDING_ORIGIN || '',
].filter(Boolean)

function corsHeaders(origin: string | null) {
  const extra = process.env.LANDING_ORIGIN
  const allow =
    origin &&
    (ALLOWED.includes(origin) ||
      origin.endsWith('.bgs.com.vn') ||
      (extra && origin === extra) ||
      origin.startsWith('http://localhost'))
      ? origin
      : ALLOWED[0] || '*'
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  }
}

function clientIp(req: Request) {
  const fwd = req.headers.get('x-forwarded-for') || ''
  return fwd.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'unknown'
}

export async function OPTIONS(req: Request) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req.headers.get('origin')) })
}

export async function POST(req: Request) {
  const headers = corsHeaders(req.headers.get('origin'))
  try {
    const body = await req.json()
    const phone = String(body.phone || '').replace(/[\s.\-()]/g, '')
    const business = String(body.business || body.business_name || '').trim()
    const mapsUrl = String(body.mapsUrl || body.gbp_link || '').trim()
    const city = String(body.city || body.area || '').trim()
    const industryLabel = String(body.industryLabel || body.industry || '').trim()
    const name = String(body.name || '').trim()

    if (!/^0\d{9}$/.test(phone)) {
      return NextResponse.json({ error: 'Số Zalo không hợp lệ' }, { status: 400, headers })
    }
    if (!mapsUrl && business.length < 3) {
      return NextResponse.json(
        { error: 'Cần link Google Maps hoặc tên cửa hàng để đọc hồ sơ thật.' },
        { status: 400, headers },
      )
    }

    let admin: any = null
    try {
      const mod = await import('@/lib/supabase/admin')
      admin = mod.supabaseAdmin
    } catch {
      admin = null
    }

    if (admin) {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
      const { count } = await admin
        .from('demo_leads')
        .select('id', { count: 'exact', head: true })
        .eq('phone', phone)
        .gte('created_at', since)
      if ((count || 0) >= 3) {
        return NextResponse.json(
          { error: 'Số này đã chạy audit demo 3 lần trong 24 giờ. Nhắn Zalo để xem bản đầy đủ.' },
          { status: 429, headers },
        )
      }
    }

    const placeId = extractPlaceIdFromUrl(mapsUrl)
    const snapshot = await runGbpPublicSnapshot({
      mapsUrl: mapsUrl || undefined,
      businessName: business || undefined,
      area: city || undefined,
      placeId,
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
      Array.isArray(snapshot.recent_posts) && snapshot.recent_posts.length
        ? 'Bài đăng:\n' +
          snapshot.recent_posts
            .map((p: any, i: number) => `${i + 1}. ${String(p.text || '').slice(0, 160)}`)
            .join('\n')
        : '',
      snapshot.source_used ? `Nguồn quan sát: ${snapshot.source_used}` : '',
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
      .replaceAll('{{additional_categories}}', '')
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

    if (admin) {
      await admin.from('demo_leads').insert({
        name: name.slice(0, 80),
        phone,
        business_name: audit.businessName,
        industry: audit.industryLabel,
        area: audit.area,
        gbp_link: audit.mapsUrl || null,
        status: body.status || null,
        overall_score: audit.overall,
        source: 'landing-demo-live',
        raw: {
          ip: clientIp(req),
          snapshot: audit.snapshot,
          source_used: snapshot.source_used,
          audit_preview: {
            overall: audit.overall,
            actions: audit.actions,
          },
        },
      })
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
      { error: error.message || 'Không chạy được audit trên hồ sơ Maps.' },
      { status: 500, headers },
    )
  }
}
