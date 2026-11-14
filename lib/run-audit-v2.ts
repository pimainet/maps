import { getReviewCountHistory } from '@/lib/db'
import { resolveCompetitorSet } from '@/lib/competitors-store'
import { createSupabaseClassifierStore } from '@/lib/audit-classifier-store'
import {
  checkWebsiteReachable,
  createCachedClassifier,
  createRealAIClassifier,
  runAudit,
  type AuditReport,
} from '@/lib/audit-engine'
import { fallbackNarrative, generateNarrative, type Narrative } from '@/lib/audit-engine/narrative'
import { renderAuditText } from '@/lib/audit-engine/render-text'
import type { GbpSnapshotPayload } from '@/lib/gbp-snapshot-types'

export type AuditV2Output = {
  report: AuditReport
  narrative: Narrative
  /** Văn bản theo khung 7 mục cũ — để lộ trình 30 ngày / trí nhớ khách hàng đọc như trước. */
  text: string
  meta: {
    competitors: { from: 'cache' | 'live' | 'none'; note: string | null; count: number }
    reviewHistoryPoints: number
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
  /** false = bỏ bước AI viết lời (dùng lời dựng bằng code) — chế độ shadow không cần lời nên đỡ tốn. Mặc định true. */
  withNarrative?: boolean
}): Promise<AuditV2Output> {
  const { client, workspaceId, snapshot } = args

  const [websiteReachable, comp, history] = await Promise.all([
    checkWebsiteReachable(snapshot.website_url).catch(() => undefined),
    resolveCompetitorSet({ snapshot, clientId: client.id, workspaceId, declaredArea: client.area, force: args.forceCompetitors }).catch(
      () => ({ set: null, from: 'none' as const, note: 'Lỗi tìm đối thủ' }),
    ),
    getReviewCountHistory(client.id, workspaceId).catch(() => []),
  ])

  const competitors = comp.set?.items.length ? comp.set.items : undefined
  const visibility = comp.set ? { query: comp.set.query, selfRank: comp.set.selfRank, total: comp.set.total } : undefined

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
    },
    ai,
  )

  const narrative =
    args.withNarrative === false
      ? fallbackNarrative(report)
      : await generateNarrative(ai, {
          report,
          business: { name: client.name, industry: client.industry, area: client.area },
          progressContext: args.progressContext,
          outputLanguage: args.outputLanguage,
        })

  return {
    report,
    narrative,
    text: renderAuditText(report, narrative),
    meta: {
      competitors: { from: comp.from, note: comp.note ?? null, count: comp.set?.items.length ?? 0 },
      reviewHistoryPoints: history.length,
      classifier: { hits: ai.stats.hits, misses: ai.stats.misses },
    },
  }
}
