/**
 * POST /api/gbp-snapshot
 * Enqueue (hoặc chạy) quan sát GBP public cho 1 client.
 *
 * Body: { client_id: string, force?: boolean }
 *
 * Giai đoạn A — bản đồng bộ có timeout (Pro + maxDuration).
 * Production nên chuyển sang Trigger.dev / Inngest (xem PHASE_A_README).
 *
 * Copy vào: app/api/gbp-snapshot/route.ts
 */

import { NextResponse } from 'next/server'
import { requireActiveWorkspaceId } from '@/lib/auth'
import { getClientById } from '@/lib/db'
import {
  createPendingSnapshot,
  getFreshSnapshotForClient,
  updateSnapshot,
} from '@/lib/gbp-snapshots'
import { runGbpPublicSnapshot } from '@/lib/gbp-browser-snapshot'

export const maxDuration = 300
export const runtime = 'nodejs'

export async function POST(req: Request) {
  try {
    const workspaceId = await requireActiveWorkspaceId()
    const body = await req.json()
    const clientId = body.client_id as string | undefined
    const force = Boolean(body.force)

    if (!clientId) {
      return NextResponse.json({ error: 'Thiếu client_id' }, { status: 400 })
    }

    const client = await getClientById(clientId, workspaceId)
    if (!client) {
      return NextResponse.json({ error: 'Không tìm thấy khách hàng' }, { status: 404 })
    }

    // Cache: đã có snapshot tươi → trả luôn, không chạy browser
    if (!force) {
      const fresh = await getFreshSnapshotForClient(clientId, workspaceId)
      if (fresh) {
        return NextResponse.json({
          snapshot: fresh,
          cached: true,
          message: 'Đã có quan sát còn hạn — không chạy lại browser',
        })
      }
    }

    const mapsUrl =
      client.gbp_link ||
      (client.place_id ? `https://www.google.com/maps/place/?q=place_id:${client.place_id}` : null)

    if (!mapsUrl && !client.name) {
      return NextResponse.json(
        {
          error:
            'Khách hàng thiếu Link Google Maps / Place ID / Tên — không thể quan sát',
        },
        { status: 400 }
      )
    }

    const pending = await createPendingSnapshot({
      workspace_id: workspaceId,
      client_id: clientId,
      place_id: client.place_id || null,
      maps_url: mapsUrl,
      source: 'browser',
    })

    await updateSnapshot(pending.id, workspaceId, { status: 'running' })

    try {
      const result = await runGbpPublicSnapshot({
        mapsUrl: mapsUrl || undefined,
        businessName: client.name,
        area: client.area,
        placeId: client.place_id,
      })

      const hasCore =
        Boolean(result.description) ||
        Boolean(result.posts_signal) ||
        result.rating != null ||
        (result.recent_posts && result.recent_posts.length > 0)

      const status = result.error
        ? hasCore
          ? 'partial'
          : 'failed'
        : hasCore
          ? 'ok'
          : 'partial'

      const saved = await updateSnapshot(pending.id, workspaceId, {
        status,
        error_message: result.error || null,
        captured_at: new Date().toISOString(),
        place_id: result.place_id || client.place_id || null,
        maps_url: result.maps_url || mapsUrl,
        business_name: result.business_name || client.name,
        description: result.description || null,
        primary_category: result.primary_category || null,
        rating: result.rating ?? null,
        review_count: result.review_count ?? null,
        phone: result.phone || null,
        website_url: result.website_url || null,
        address_text: result.address_text || null,
        posts_signal: result.posts_signal || null,
        recent_posts: result.recent_posts || [],
        photos_signal: result.photos_signal || null,
        photos_count_est: result.photos_count_est ?? null,
        raw_json: result.raw || null,
      })

      return NextResponse.json({
        snapshot: saved,
        cached: false,
        message:
          status === 'ok'
            ? 'Đã quan sát GBP thành công'
            : status === 'partial'
              ? 'Quan sát một phần — vẫn dùng được cho Audit'
              : 'Quan sát thất bại',
      })
    } catch (err: any) {
      const failed = await updateSnapshot(pending.id, workspaceId, {
        status: 'failed',
        error_message: err?.message || String(err),
      })
      return NextResponse.json(
        {
          snapshot: failed,
          error: err?.message || 'Lỗi khi quan sát GBP',
        },
        { status: 500 }
      )
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

/** GET ?client_id= — lấy snapshot mới nhất */
export async function GET(req: Request) {
  try {
    const workspaceId = await requireActiveWorkspaceId()
    const { searchParams } = new URL(req.url)
    const clientId = searchParams.get('client_id')
    if (!clientId) {
      return NextResponse.json({ error: 'Thiếu client_id' }, { status: 400 })
    }

    const { getLatestSnapshotForClient } = await import('@/lib/gbp-snapshots')
    const snapshot = await getLatestSnapshotForClient(clientId, workspaceId)
    return NextResponse.json({ snapshot })
  } catch (error: any) {
    const status = error.message?.includes('Unauthorized') ? 401 : 500
    return NextResponse.json({ error: error.message }, { status })
  }
}
