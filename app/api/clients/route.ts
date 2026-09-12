import { NextResponse } from 'next/server'
import {
  getClients,
  createClient,
  getWorkspaceClientLimit,
  findDuplicateClient,
} from '@/lib/db'
import { requireActiveWorkspaceId } from '@/lib/auth'
import {
  canonicalizePlaceId,
  extractPlaceIdFromUrl,
  normalizeGbpLink,
} from '@/lib/place-identity'

export async function GET() {
  try {
    const workspaceId = await requireActiveWorkspaceId()
    const data = await getClients(workspaceId)
    return NextResponse.json(data)
  } catch (error: any) {
    const status = error.message?.includes('Unauthorized')
      ? 401
      : error.message?.includes('NoWorkspace')
        ? 409
        : 500
    return NextResponse.json({ error: error.message }, { status })
  }
}

export async function POST(req: Request) {
  try {
    const workspaceId = await requireActiveWorkspaceId()

    const limit = await getWorkspaceClientLimit(workspaceId)
    if (!limit.canAddMore) {
      return NextResponse.json(
        {
          error: `Workspace của bạn đã đạt giới hạn ${limit.maxClients} doanh nghiệp. Liên hệ nâng cấp gói để thêm doanh nghiệp mới.`,
        },
        { status: 403 }
      )
    }

    const body = await req.json()
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (!name) {
      return NextResponse.json({ error: 'Thiếu tên doanh nghiệp' }, { status: 400 })
    }

    const gbp_link =
      typeof body.gbp_link === 'string' && body.gbp_link.trim()
        ? body.gbp_link.trim()
        : null

    let place_id = canonicalizePlaceId(body.place_id) || extractPlaceIdFromUrl(gbp_link)
    const gbp_link_normalized = normalizeGbpLink(gbp_link)

    // Chống trùng trong workspace
    const dup = await findDuplicateClient({
      workspaceId,
      placeId: place_id,
      gbpLinkNormalized: gbp_link_normalized,
    })

    if (dup) {
      return NextResponse.json(
        {
          error: `Link/Place Google Maps này đã gắn với doanh nghiệp「${dup.client.name}」trong workspace. Không thể tạo trùng.`,
          code: 'DUPLICATE_PLACE',
          match_by: dup.match_by,
          existing_client: {
            id: dup.client.id,
            name: dup.client.name,
            place_id: dup.client.place_id,
            gbp_link: dup.client.gbp_link,
          },
        },
        { status: 409 }
      )
    }

    try {
      const data = await createClient({
        name,
        industry: body.industry || undefined,
        area: body.area || undefined,
        phone: body.phone || undefined,
        contact_name: body.contact_name || undefined,
        brand_voice: body.brand_voice || undefined,
        gbp_link: gbp_link || undefined,
        gbp_link_normalized,
        place_id,
        website_url: body.website_url || undefined,
        notes: body.notes || undefined,
        workspace_id: workspaceId,
      })
      return NextResponse.json(data)
    } catch (err: any) {
      // Race: unique index DB
      const msg = err?.message || String(err)
      if (/duplicate|unique|uq_clients/i.test(msg)) {
        return NextResponse.json(
          {
            error:
              'Doanh nghiệp với Place/Link Google Maps này đã tồn tại trong workspace (ràng buộc DB).',
            code: 'DUPLICATE_PLACE',
          },
          { status: 409 }
        )
      }
      throw err
    }
  } catch (error: any) {
    const status = error.message?.includes('Unauthorized')
      ? 401
      : error.message?.includes('NoWorkspace')
        ? 409
        : 500
    return NextResponse.json({ error: error.message }, { status })
  }
}
