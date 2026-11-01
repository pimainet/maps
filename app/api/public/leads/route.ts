import { NextResponse } from 'next/server'
import { clientIp, clientIpHash, publicCorsHeaders, requestText } from '@/lib/public-request-safety'

export const runtime = 'nodejs'

const MAX_BODY_BYTES = 16 * 1024

export async function OPTIONS(req: Request) {
  return new NextResponse(null, { status: 204, headers: publicCorsHeaders(req.headers.get('origin')) })
}

export async function POST(req: Request) {
  const headers = publicCorsHeaders(req.headers.get('origin'))
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
    if (!/^0\d{9}$/.test(phone)) {
      return NextResponse.json({ error: 'Số Zalo không hợp lệ' }, { status: 400, headers })
    }

    try {
      const { supabaseAdmin } = await import('@/lib/supabase/admin')
      const ip = clientIp(req)
      const ipHash = clientIpHash(ip)
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
      const [phoneQuota, ipQuota, legacyIpQuota] = await Promise.all([
        supabaseAdmin.from('demo_leads').select('id', { count: 'exact', head: true }).eq('phone', phone).gte('created_at', since),
        supabaseAdmin.from('demo_leads').select('id', { count: 'exact', head: true }).contains('raw', { ip_hash: ipHash }).gte('created_at', since),
        supabaseAdmin.from('demo_leads').select('id', { count: 'exact', head: true }).contains('raw', { ip }).gte('created_at', since),
      ])
      if (phoneQuota.error || ipQuota.error || legacyIpQuota.error) {
        console.error('demo lead quota check failed:', phoneQuota.error?.message || ipQuota.error?.message || legacyIpQuota.error?.message)
        return NextResponse.json({ error: 'Không thể nhận thông tin lúc này. Vui lòng thử lại sau.' }, { status: 503, headers })
      }
      // Count legacy raw-IP rows through their 24-hour lifetime during rollout.
      if ((phoneQuota.count || 0) >= 3 || (ipQuota.count || 0) + (legacyIpQuota.count || 0) >= 10) {
        return NextResponse.json({ error: 'Đã đạt giới hạn gửi thông tin trong 24 giờ.' }, { status: 429, headers })
      }
      const { error } = await supabaseAdmin.from('demo_leads').insert({
        name: requestText(body.name, 80),
        phone,
        business_name: requestText(body.business || body.business_name, 160) || null,
        industry: requestText(body.industryLabel || body.industry, 100) || null,
        area: requestText(body.city || body.area, 160) || null,
        gbp_link: requestText(body.mapsUrl || body.gbp_link, 2048) || null,
        status: requestText(body.status, 80) || null,
        overall_score: null,
        source: 'landing-lead',
        raw: { ip_hash: ipHash },
      })
      if (error) throw error
    } catch (e: any) {
      console.error('demo_leads write:', e?.message)
      return NextResponse.json({ error: 'Không thể nhận thông tin lúc này. Vui lòng thử lại sau.' }, { status: 503, headers })
    }

    return NextResponse.json({ ok: true }, { headers })
  } catch (error: any) {
    console.error('public lead request failed:', error?.message)
    return NextResponse.json({ error: 'Không nhận được thông tin. Vui lòng thử lại sau.' }, { status: 500, headers })
  }
}
