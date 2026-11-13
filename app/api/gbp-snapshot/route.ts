/**
 * POST /api/gbp-snapshot
 * Body: { client_id: string, force?: boolean }
 *
 * Trả về thêm diagnostics để debug.
 * Copy vào: app/api/gbp-snapshot/route.ts
 */

import { NextResponse } from 'next/server'
import { publicError } from '@/lib/api-error'
import { requireActiveWorkspaceId } from '@/lib/auth'
import { getClientById } from '@/lib/db'
import {
  createPendingSnapshot,
  getFreshSnapshotForClient,
  updateSnapshot,
} from '@/lib/gbp-snapshots'
import { runGbpPublicSnapshot } from '@/lib/gbp-browser-snapshot'
import { checkAiRateLimit, recordAiUsage } from '@/lib/rate-limit'

export const maxDuration = 300
export const runtime = 'nodejs'

const IS_PROD = process.env.NODE_ENV === 'production'

/** Production không nên trả nguyên văn lỗi nội bộ (message exception,
 * stack...) ra response — chỉ hữu ích lúc dev. Giữ lại các cờ has_*_key
 * (chỉ true/false, không phải bí mật) và dữ liệu của chính client đó
 * (client_name...) vì agency cần thấy để tự debug case của họ. */
function sanitizeDiagnostics(d: Record<string, unknown>) {
  if (!IS_PROD) return d
  const { run_error, ...rest } = d
  return rest
}

export async function POST(req: Request) {
  const diagnostics: Record<string, unknown> = {
    has_outscraper_key: Boolean(process.env.OUTSCRAPER_API_KEY),
    gbp_provider: process.env.GBP_PROVIDER || 'auto',
    has_browserbase_key: Boolean(process.env.BROWSERBASE_API_KEY),
    has_browserbase_project: Boolean(process.env.BROWSERBASE_PROJECT_ID),
    has_places_key: Boolean(process.env.GOOGLE_PLACES_API_KEY),
    has_anthropic_key: Boolean(process.env.ANTHROPIC_API_KEY),
  }

  try {
    const workspaceId = await requireActiveWorkspaceId()
    // Endpoint này còn gọi Browserbase + Google Places (cũng tốn phí),
    // không chỉ Claude — cũng cần chặn spam như các endpoint AI khác.
    const { userId } = await checkAiRateLimit(workspaceId, 'gbp-snapshot')
    const body = await req.json()
    const clientId = body.client_id as string | undefined
    const force = Boolean(body.force)

    if (!clientId) {
      return NextResponse.json(
        { error: 'Thiếu client_id', diagnostics: sanitizeDiagnostics(diagnostics) },
        { status: 400 }
      )
    }

    const client = await getClientById(clientId, workspaceId)
    if (!client) {
      return NextResponse.json(
        { error: 'Không tìm thấy khách hàng', diagnostics: sanitizeDiagnostics(diagnostics) },
        { status: 404 }
      )
    }

    diagnostics.client_name = client.name
    diagnostics.client_place_id = client.place_id || null
    diagnostics.client_gbp_link = client.gbp_link || null

    if (!force) {
      const fresh = await getFreshSnapshotForClient(clientId, workspaceId)
      if (fresh) {
        return NextResponse.json({
          snapshot: fresh,
          cached: true,
          message: 'Đã có quan sát còn hạn — không chạy lại',
          diagnostics: sanitizeDiagnostics({
            ...diagnostics,
            source_used: fresh.raw_json ? 'cached' : 'cached',
            cached: true,
          }),
        })
      }
    }

    const mapsUrl =
      client.gbp_link ||
      (client.place_id
        ? `https://www.google.com/maps/place/?q=place_id:${client.place_id}`
        : null)

    if (!mapsUrl && !client.name) {
      return NextResponse.json(
        {
          error: 'Khách hàng thiếu Link Google Maps / Place ID / Tên',
          diagnostics: sanitizeDiagnostics(diagnostics),
        },
        { status: 400 }
      )
    }

    const pending = await createPendingSnapshot({
      workspace_id: workspaceId,
      client_id: clientId,
      place_id: client.place_id || null,
      maps_url: mapsUrl,
      source: process.env.OUTSCRAPER_API_KEY && process.env.GBP_PROVIDER !== 'browser' ? 'outscraper' : 'browser',
    })

    await updateSnapshot(pending.id, workspaceId, { status: 'running' })

    try {
      const result = await runGbpPublicSnapshot({
        mapsUrl: mapsUrl || undefined,
        businessName: client.name,
        area: client.area,
        placeId: client.place_id,
        depth: 'deep',
      })
      // Chạy tới đây nghĩa là đã tốn phí Browserbase/Places/Claude thật
      // (dù kết quả là 'ok', 'partial' hay 'failed') — khác với lỗi
      // ngoại lệ ở catch bên dưới (network crash...) thì không tính.
      await recordAiUsage(workspaceId, 'gbp-snapshot', userId)

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
        reviews: result.reviews || [],
        // `deep` = bản sao các trường mới trong raw_json để dùng được cả khi chưa chạy migration 015
        raw_json: {
          ...(result.raw && typeof result.raw === 'object' ? (result.raw as object) : {}),
          deep: {
            agent_version: result.source_used?.startsWith('outscraper') ? 3 : 2,
            opening_hours: result.opening_hours || null,
            hours_today: result.hours_today || null,
            additional_categories: result.additional_categories || null,
            services: result.services || [],
            attributes: result.attributes || [],
            action_links: result.action_links || [],
            photo_categories: result.photo_categories || [],
            business_status: result.business_status || null,
            claim_signal: result.claim_signal || null,
            rating_distribution: result.rating_distribution || null,
            review_stats: result.review_stats || null,
            coverage: result.coverage || null,
          },
        },
        // v2 — cần migration 015 (chưa chạy thì updateSnapshot tự bỏ qua các cột này)
        opening_hours: result.opening_hours || null,
        additional_categories: result.additional_categories || null,
        services: result.services || [],
        attributes: result.attributes || [],
        action_links: result.action_links || [],
        photo_categories: result.photo_categories || [],
        business_status: result.business_status || null,
        claim_signal: result.claim_signal || null,
        rating_distribution: result.rating_distribution || null,
        review_stats: result.review_stats || null,
        coverage: result.coverage || null,
      })

      const cov = result.coverage
      const unread = cov
        ? Object.keys(cov.sections).filter((k) => cov.sections[k] === 'error' || cov.sections[k] === 'skipped')
        : []
      const detail = cov
        ? ` — đọc ${cov.reviews_loaded} review, ${result.services?.length || 0} dịch vụ, ${result.attributes?.length || 0} nhóm thuộc tính${
            unread.length ? `; chưa đọc được: ${unread.join(', ')}` : ''
          }`
        : ''

      return NextResponse.json({
        snapshot: saved,
        cached: false,
        message:
          status === 'ok'
            ? `Đã quan sát thành công${detail}`
            : status === 'partial'
              ? `Quan sát một phần${detail}`
              : 'Quan sát thất bại',
        diagnostics: sanitizeDiagnostics({
          ...diagnostics,
          source_used: result.source_used || null,
          run_error: result.error || null,
          has_description: Boolean(result.description),
          description_len: result.description?.length || 0,
          posts_count: result.recent_posts?.length || 0,
          posts_signal: result.posts_signal || null,
          photos_signal: result.photos_signal || null,
          rating: result.rating ?? null,
          reviews_loaded: cov?.reviews_loaded ?? 0,
          coverage_sections: cov?.sections || null,
          coverage_warnings: cov?.warnings || [],
          identity: cov?.identity || null,
          elapsed_ms: cov?.elapsed_ms || null,
          hours_strategy: (result.raw as any)?.browser?.hours_strategy ?? null,
          description_source: (result.raw as any)?.browser?.description_source ?? null,
          debug: (result.raw as any)?.browser?.debug ?? null,
        }),
      })
    } catch (err: any) {
      const failed = await updateSnapshot(pending.id, workspaceId, {
        status: 'failed',
        error_message: 'Không đọc được hồ sơ Google Maps lần này.',
      })
      console.error('gbp-snapshot run failed:', err?.message || err)
      return NextResponse.json(
        {
          snapshot: failed,
          error: 'Lỗi khi quan sát GBP. Vui lòng thử lại sau.',
          diagnostics: sanitizeDiagnostics({
            ...diagnostics,
            run_error: err?.message || String(err),
          }),
        },
        { status: 500 }
      )
    }
  } catch (error: any) {
    const status = error.message?.includes('Unauthorized')
      ? 401
      : error.message?.includes('NoWorkspace')
        ? 409
        : error.message?.includes('RateLimited')
          ? 429
          : 500
    return NextResponse.json(
      { error: publicError(error), diagnostics: sanitizeDiagnostics(diagnostics) },
      { status }
    )
  }
}

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
    return NextResponse.json({ error: publicError(error) }, { status })
  }
}
