import { NextResponse } from 'next/server'
import { requireActiveWorkspaceId } from '@/lib/auth'
import { checkAiRateLimit, recordAiUsage } from '@/lib/rate-limit'
import { getClientById } from '@/lib/db'
import { getFreshSnapshotForClient } from '@/lib/gbp-snapshots'
import { runGbpPublicSnapshot } from '@/lib/gbp-browser-snapshot'
import { runAudit, createRealAIClassifier, checkWebsiteReachable } from '@/lib/audit-engine'
import type { GbpSnapshotPayload } from '@/lib/gbp-snapshot-types'

export const maxDuration = 300
export const runtime = 'nodejs'

/**
 * Route NỘI BỘ, KHÔNG dùng cho khách hàng — dùng để so sánh Audit Engine
 * (34 checks Rule+AI riêng biệt, lib/audit-engine/) với AUDIT_PROMPT hiện
 * tại (1 lệnh gọi Claude tự do) TRƯỚC KHI quyết định có cutover route thật
 * `/api/audit` hay không.
 *
 * KHÔNG ghi gì vào bảng `audits` — chỉ trả JSON để xem/so sánh. KHÔNG tính
 * vào enforceClientAuditQuota (quota audit thật của khách hàng) — dùng
 * bucket rate-limit riêng 'audit-v2-preview' (xem lib/rate-limit.ts).
 *
 * Yêu cầu đăng nhập + thuộc workspace — không public như /api/public/demo-audit.
 *
 * Body:
 *  - { client_id: string, forceRefresh?: boolean }
 *      Dùng client đã có trong workspace. Mặc định dùng lại snapshot còn
 *      trong TTL cache (gbp_snapshots) nếu có — forceRefresh=true để bắt
 *      chạy observe lại (tốn thêm 1 lượt Browserbase/Places + Claude extract).
 *  - { business_name?: string, maps_url?: string, area?: string, industry?: string }
 *      Chạy thử nhanh, không cần client có sẵn trong workspace (giống cách
 *      /api/public/demo-audit nhận input) — không lưu gì vào gbp_snapshots.
 */
export async function POST(req: Request) {
  try {
    const workspaceId = await requireActiveWorkspaceId()
    const { userId } = await checkAiRateLimit(workspaceId, 'audit-v2-preview')
    const body = await req.json()

    let snapshot: GbpSnapshotPayload
    let claimedBusinessName: string | undefined
    let declaredIndustry: string | undefined
    let snapshotSource: string

    if (body.client_id) {
      const client = await getClientById(body.client_id, workspaceId)
      if (!client) {
        return NextResponse.json(
          { error: 'Không tìm thấy doanh nghiệp này trong workspace.' },
          { status: 404 },
        )
      }
      claimedBusinessName = client.name || undefined
      declaredIndustry = client.industry || undefined

      const stored = body.forceRefresh ? null : await getFreshSnapshotForClient(body.client_id, workspaceId)
      if (stored) {
        snapshot = stored
        snapshotSource = `cache (gbp_snapshots, captured_at=${stored.captured_at})`
      } else {
        const fresh = await runGbpPublicSnapshot({
          mapsUrl: client.gbp_link || undefined,
          businessName: client.name || undefined,
          area: client.area || undefined,
          placeId: client.place_id || null,
        })
        snapshot = fresh
        snapshotSource = `live (${fresh.source_used || 'unknown'})`
      }
    } else {
      const business = String(body.business_name || body.business || '').trim()
      const mapsUrl = String(body.maps_url || body.mapsUrl || '').trim()
      const area = String(body.area || body.city || '').trim()
      if (!mapsUrl && business.length < 3) {
        return NextResponse.json(
          { error: 'Cần client_id, hoặc link Maps/tên doanh nghiệp để chạy thử.' },
          { status: 400 },
        )
      }
      claimedBusinessName = business || undefined
      declaredIndustry = String(body.industry || body.industryLabel || '').trim() || undefined
      const fresh = await runGbpPublicSnapshot({
        mapsUrl: mapsUrl || undefined,
        businessName: business || undefined,
        area: area || undefined,
      })
      snapshot = fresh
      snapshotSource = `live (${fresh.source_used || 'unknown'})`
    }

    const hasProfile = Boolean(
      snapshot.business_name || snapshot.rating != null || snapshot.review_count != null || snapshot.address_text || snapshot.place_id,
    )
    if (!hasProfile) {
      return NextResponse.json(
        {
          error: (snapshot as any).error || 'Không đọc được hồ sơ Google Maps cho input này.',
          snapshot,
        },
        { status: 422 },
      )
    }

    // Kiểm tra website sống thật — request HTTP tới chính website khách, không phải scrape Google.
    const websiteReachable = await checkWebsiteReachable(snapshot.website_url)

    const ai = createRealAIClassifier()
    const report = await runAudit({ snapshot, claimedBusinessName, declaredIndustry, websiteReachable }, ai)

    // Chỉ ghi nhận usage SAU KHI chạy xong thành công — đúng pattern đã có ở rate-limit.ts.
    await recordAiUsage(workspaceId, 'audit-v2-preview', userId)

    return NextResponse.json({
      ok: true,
      preview: true,
      snapshotSource,
      snapshot,
      report,
    })
  } catch (error: any) {
    console.error('audit v2-preview:', error)
    const status = error.message?.includes('Unauthorized')
      ? 401
      : error.message?.includes('NoWorkspace')
        ? 409
        : error.message?.includes('RateLimited')
          ? 429
          : 500
    return NextResponse.json({ error: error.message || 'Lỗi chạy audit v2 preview.' }, { status })
  }
}
