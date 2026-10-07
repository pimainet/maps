import { runFoundationChecks } from './foundation'
import { runRelevanceChecks } from './relevance'
import { runTrustChecks } from './trust'
import { runContentBasicChecks, runContentAdvancedChecks } from './content'
import { runVisualChecks } from './visual'
import { runVisibilityChecks } from './visibility'
import { runConversionChecks } from './conversion'
import { scoreAllTiers, scoreOverall } from './scoring'
import { pickTopOpportunities } from './priority'
import type { AIClassifier, AuditInput, AuditReport } from './types'

export * from './types'
export { createRealAIClassifier } from './ai-client'
export { checkWebsiteReachable } from './check-website'
export { diffAuditReports } from './diff'
export type { AuditDiff, AuditDiffEntry } from './diff'

/**
 * Audit Engine — 34/34 checks, hoạt động trên ĐÚNG dữ liệu hệ thống thật sự
 * thu thập được hôm nay (GbpSnapshotPayload). Nhiều check sẽ trả
 * "insufficient" KHÔNG phải vì logic sai, mà vì Data Collector hiện tại
 * (gbp-browser-snapshot.ts) chưa thu thập trường đó — đây là input có giá
 * trị cho việc ưu tiên nâng cấp collector tiếp theo (xem check nào insufficient
 * nhiều nhất).
 *
 * Hàm này KHÔNG tự gọi network ngoài AI (không tự fetch website, không tự
 * query Supabase) — mọi dữ liệu phụ (websiteReachable, reviewCountHistory,
 * competitors) do caller thu thập trước và truyền vào qua `AuditInput`,
 * giữ hàm audit thuần và dễ test.
 */
export async function runAudit(input: AuditInput, ai: AIClassifier): Promise<AuditReport> {
  const [foundation, relevance, contentAdvanced, trust] = await Promise.all([
    Promise.resolve(runFoundationChecks(input)),
    runRelevanceChecks(input, ai),
    runContentAdvancedChecks(input, ai),
    runTrustChecks(input, ai),
  ])
  const contentBasic = runContentBasicChecks(input)
  const visual = runVisualChecks(input)
  const visibility = runVisibilityChecks()

  const checksSoFar = [...foundation, ...relevance, ...trust, ...contentBasic, ...contentAdvanced, ...visual, ...visibility]
  const conversion = runConversionChecks(checksSoFar)

  const checks = [...checksSoFar, ...conversion]
  const tierScores = scoreAllTiers(checks)
  const overallScore = scoreOverall(tierScores)
  const topOpportunities = pickTopOpportunities(checks)

  return { checks, tierScores, overallScore, topOpportunities, generatedAt: new Date().toISOString() }
}
