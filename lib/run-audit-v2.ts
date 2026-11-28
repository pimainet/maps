import { getReviewCountHistory } from '@/lib/db'
import { buildAdvice } from '@/lib/audit-engine/advice'
import { resolveCompetitorSet } from '@/lib/competitors-store'
import { loadRankGridAuditInput } from '@/lib/rankgrid/audit-input'
import { collectWebsiteSignals } from '@/lib/website-signals'
import { collectCompetitorVelocity } from '@/lib/competitor-velocity'
import { defaultMiniGridDeps, runMiniGrid } from '@/lib/rankgrid/mini-grid'
import { createSupabaseClassifierStore } from '@/lib/audit-classifier-store'
import {
  checkWebsiteReachable,
  createCachedClassifier,
  createRealAIClassifier,
  runAudit,
  type AuditReport,
} from '@/lib/audit-engine'
import { generateNarrative, type Narrative } from '@/lib/audit-engine/narrative'
import { renderAuditText } from '@/lib/audit-engine/render-text'
import type { GbpSnapshotPayload } from '@/lib/gbp-snapshot-types'

export type AuditV2Output = {
  report: AuditReport
  narrative: Narrative
  /** Văn bản theo khung 7 mục (### 1. … ### 7.) — lộ trình 30 ngày / trí nhớ khách hàng / giao diện đọc văn bản này. */
  text: string
  meta: {
    competitors: { from: 'cache' | 'live' | 'none'; note: string | null; count: number }
    reviewHistoryPoints: number
    website: { from: 'cache' | 'live' | 'none'; status: string | null }
    competitorVelocity: { from: 'cache' | 'live' | 'none'; count: number; note: string | null }
    miniGrid: { from: 'scan' | 'cache' | 'live' | 'none'; note: string | null; costUsd: number }
    classifier: { hits: number; misses: number }
  }
}

/**
 * Chạy Audit Engine v2 trên 1 snapshot đã có: kiểm tra website, lấy nhóm đối thủ + thứ hạng, lịch sử review, chạy engine
 * (rule quyết điểm, AI chỉ phân loại — temperature 0 + cache theo nội dung), rồi để AI viết lời. Điểm KHÔNG phụ thuộc
 * bước viết lời: AI lỗi thì dùng lời dựng bằng code.
 * Mỗi nguồn phụ (đối thủ, lịch sử review, website) lỗi đều chỉ làm check tương ứng "chưa đủ dữ liệu", không làm hỏng audit.
 */
export async function runAuditV2(args: {
  client: { id: string; name?: string | null; industry?: string | null; area?: string | null }
  workspaceId: string
  snapshot: GbpSnapshotPayload
  progressContext?: string
  outputLanguage?: string
  forceCompetitors?: boolean
}): Promise<AuditV2Output> {
  const { client, workspaceId, snapshot } = args

  const [websiteReachable, comp, history, scanGrid, web] = await Promise.all([
    checkWebsiteReachable(snapshot.website_url).catch(() => undefined),
    resolveCompetitorSet({ snapshot, clientId: client.id, workspaceId, declaredArea: client.area, force: args.forceCompetitors }).catch(
      () => ({ set: null, from: 'none' as const, note: 'Lỗi tìm đối thủ' }),
    ),
    getReviewCountHistory(client.id, workspaceId).catch(() => []),
    loadRankGridAuditInput(client.id, workspaceId).catch(() => undefined),
    // Tín hiệu địa phương của website (W01–W04): GET an toàn + robots.txt, cache 7 ngày.
    collectWebsiteSignals({
      url: snapshot.website_url,
      profile: { name: snapshot.business_name || client.name, phone: snapshot.phone, address: snapshot.address_text, area: client.area },
      clientId: client.id,
      workspaceId,
    }).catch(() => ({ signals: undefined, from: 'none' as const })),
  ])

  const competitors = comp.set?.items.length ? comp.set.items : undefined
  const visibility = comp.set ? { query: comp.set.query, selfRank: comp.set.selfRank, total: comp.set.total } : undefined

  // T07: review gần đây của 3 đối thủ đứng đầu (Outscraper, giới hạn chi phí + cache 14 ngày). Lỗi => T07 "chưa đủ dữ liệu".
  // VY04: chưa có lần quét lưới ≤ 14 ngày thì chạy lưới mini 5×5 (cờ AUDIT_MINI_GRID_ENABLED, hạn mức workspace, cache 14 ngày).
  const [vel, mini] = await Promise.all([
    collectCompetitorVelocity({ competitors, clientId: client.id, workspaceId }).catch((e: any) => ({
      velocity: undefined,
      from: 'none' as const,
      note: String(e?.message || e).slice(0, 120),
    })),
    scanGrid
      ? Promise.resolve({ input: scanGrid, from: 'scan' as const, note: undefined, costUsd: 0 })
      : defaultMiniGridDeps(client.id, workspaceId, { name: client.name, area: client.area })
          .then((deps) =>
            runMiniGrid(
              {
                clientId: client.id,
                workspaceId,
                primaryCategory: snapshot.primary_category,
                additionalCategories: snapshot.additional_categories,
                industry: client.industry,
                area: client.area,
                snapshotPlaceId: snapshot.place_id,
              },
              deps,
            ),
          )
          .catch((e: any) => ({ input: undefined, from: 'none' as const, note: String(e?.message || e).slice(0, 120), costUsd: 0 })),
  ])
  const rankGrid = mini.input

  const ai = createCachedClassifier(createRealAIClassifier(), createSupabaseClassifierStore())
  const report = await runAudit(
    {
      snapshot,
      claimedBusinessName: client.name || undefined,
      declaredIndustry: client.industry || undefined,
      websiteReachable,
      competitors,
      visibility,
      reviewCountHistory: history.length ? history : undefined,
      rankGrid,
      website: web.signals,
      competitorVelocity: vel.velocity,
    },
    ai,
  )

  // Lời khuyên danh mục + mô tả mẫu: AI hỗ trợ nhưng bám dữ liệu và bị code kiểm lại (xem advice.ts); không tham gia chấm điểm.
  // Chạy song song với phần viết nhận xét để không kéo dài thời gian audit; lỗi thì bỏ qua.
  const advicePromise = buildAdvice({
    input: { snapshot, declaredIndustry: client.industry || undefined, claimedBusinessName: client.name || undefined, competitors },
    area: client.area,
    ai,
  }).catch((e: any) => {
    console.error('audit advice failed (non-fatal):', e?.message)
    return undefined
  })

  const narrative = await generateNarrative(ai, {
    report,
    business: { name: client.name, industry: client.industry, area: client.area },
    progressContext: args.progressContext,
    outputLanguage: args.outputLanguage,
  })

  const advice = await advicePromise
  if (advice) report.advice = advice

  return {
    report,
    narrative,
    text: renderAuditText(report, narrative),
    meta: {
      competitors: { from: comp.from, note: comp.note ?? null, count: comp.set?.items.length ?? 0 },
      reviewHistoryPoints: history.length,
      website: { from: web.from, status: web.signals?.status ?? null },
      competitorVelocity: { from: vel.from, count: vel.velocity?.items.length ?? 0, note: vel.note ?? null },
      miniGrid: { from: mini.from, note: mini.note ?? null, costUsd: mini.costUsd },
      classifier: { hits: ai.stats.hits, misses: ai.stats.misses },
    },
  }
}
