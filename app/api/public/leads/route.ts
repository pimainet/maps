import { NextResponse } from 'next/server'
import { buildDemoAudit } from '@/lib/demo-audit'

export const runtime = 'nodejs'

const ALLOWED = [
  'https://maps.bgs.com.vn',
  'https://bgs.com.vn',
  'https://www.bgs.com.vn',
  process.env.LANDING_ORIGIN || '',
].filter(Boolean)

function corsHeaders(origin: string | null) {
  const allow = origin && ALLOWED.some((o) => origin === o || origin.endsWith('.bgs.com.vn')) ? origin : ALLOWED[0]
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  }
}

export async function OPTIONS(req: Request) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req.headers.get('origin')) })
}

export async function POST(req: Request) {
  const headers = corsHeaders(req.headers.get('origin'))
  try {
    const body = await req.json()
    const phone = String(body.phone || '').replace(/[\s.\-()]/g, '')
    if (!/^0\d{9}$/.test(phone)) {
      return NextResponse.json({ error: 'Số Zalo không hợp lệ' }, { status: 400, headers })
    }

    const audit = buildDemoAudit({
      industry: body.industry || 'other',
      industryLabel: body.industryLabel,
      city: body.city || body.area || '',
      status: body.status || 'unknown',
      business: body.business || body.business_name || '',
      mapsUrl: body.mapsUrl || body.gbp_link || '',
      name: body.name || '',
      phone,
    })

    try {
      const { supabaseAdmin } = await import('@/lib/supabase/admin')
      await supabaseAdmin.from('demo_leads').insert({
        name: String(body.name || '').slice(0, 80),
        phone,
        business_name: audit.businessName,
        industry: audit.industryLabel,
        area: audit.area,
        gbp_link: audit.mapsUrl || null,
        status: body.status || null,
        overall_score: audit.overall,
        source: body.source || 'landing-demo',
        raw: body,
      })
    } catch (e: any) {
      console.error('demo_leads insert:', e?.message)
    }

    return NextResponse.json({ ok: true, audit }, { headers })
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Không nhận được lead' }, { status: 500, headers })
  }
}
