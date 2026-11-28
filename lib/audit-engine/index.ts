import { runFoundationChecks } from './foundation'
import { runRelevanceChecks } from './relevance'
import { runTrustChecks } from './trust'
import { runContentBasicChecks, runContentAdvancedChecks } from './content'
import { runVisualChecks } from './visual'
import { runVisibilityChecks } from './visibility'
import { runConversionChecks } from './conversion'
import { coverageOf, scoreAllTiers, scoreChecks, weightingOf } from './scoring'
import { SCORING_VERSION, weightOf } from './weights'
import { applyStabilityFlags } from './stability'
import { pickTopOpportunities } from './priority'
import { ENGINE_VERSION, type AIClassifier, type AuditInput, type AuditReport } from './types'

export * from './types'
export { createRealAIClassifier } from './ai-client'
export { checkWebsiteReachable } from './check-website'
export { diffAuditReports } from './diff'
export type { AuditDiff, AuditDiffEntry } from './diff'
export { createCachedClassifier, memoryClassifierStore } from './classifier-cache'
export type { ClassifierStore } from './classifier-cache'
export { CHECK_WEIGHTS, SCORING_VERSION, MIN_WEIGHT_COVERAGE_PCT, WEIGHT_BUCKETS, weightOf } from './weights'
export { isScored, scoreChecks, weightingOf } from './scoring'
export { applyStabilityFlags, VOLATILE_CHECK_IDS, INFORMATIONAL_CHECK_IDS } from './stability'

/**
 * Audit Engine — 34/34 checks, hoạt động trên ĐÚNG dữ liệu hệ thống thật sự
 * thu thập được hôm nay (GbpSnapshotPayload). Nhiều check sẽ trả
 * "insufficient" KHÔNG phải vì logic sai, mà vì Data Collector hiện tại
 * (lib/gbp-snapshot.ts: Outscraper + Places) chưa thu thập trường đó — đây là input có giá
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
  const visibility = runVisibilityChecks(input)

  const checksSoFar = [...foundation, ...relevance, ...trust, ...contentBasic, ...contentAdvanced, ...visual, ...visibility]
  const conversion = runConversionChecks(checksSoFar)

  // Trọng số 0 (insight, mục suy ra, mục chưa thu thập) -> ghi rõ scored=false trong báo cáo đã lưu.
  const checks = applyStabilityFlags([...checksSoFar, ...conversion]).map((c) => (weightOf(c.id) > 0 ? c : { ...c, scored: false }))
  const tierScores = scoreAllTiers(checks)
  const overallScore = scoreChecks(checks)
  const topOpportunities = pickTopOpportunities(checks)

  return {
    checks,
    tierScores,
    overallScore,
    topOpportunities,
    generatedAt: (input.now ?? new Date()).toISOString(),
    engineVersion: ENGINE_VERSION,
    scoringVersion: SCORING_VERSION,
    weighting: weightingOf(checks),
    coverage: coverageOf(checks),
  }
}
