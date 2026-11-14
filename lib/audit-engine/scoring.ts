import type { AuditCoverage, CheckGroup, CheckResult, TierScore } from './types'

const SEVERITY_WEIGHT: Record<CheckResult['severity'], number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
}

const GROUPS: CheckGroup[] = ['foundation', 'relevance', 'trust', 'visual', 'content', 'visibility', 'conversion']

/** Check có được tính vào điểm không (insight như T06 thì không). */
export const isScored = (c: CheckResult): boolean => c.scored !== false

export function scoreTier(group: CheckGroup, checks: CheckResult[]): TierScore {
  const groupChecks = checks.filter((c) => c.group === group && isScored(c))
  const known = groupChecks.filter((c) => c.passed !== null)
  const insufficientCount = groupChecks.length - known.length
  if (known.length === 0) {
    return { group, score: null, checkedCount: 0, insufficientCount }
  }
  const totalWeight = known.reduce((sum, c) => sum + SEVERITY_WEIGHT[c.severity], 0)
  const passedWeight = known.filter((c) => c.passed === true).reduce((sum, c) => sum + SEVERITY_WEIGHT[c.severity], 0)
  return { group, score: Math.round((passedWeight / totalWeight) * 100), checkedCount: known.length, insufficientCount }
}

export function scoreAllTiers(checks: CheckResult[]): TierScore[] {
  return GROUPS.map((group) => scoreTier(group, checks))
}

export function scoreOverall(tierScores: TierScore[]): number | null {
  const known = tierScores.filter((t): t is TierScore & { score: number } => t.score !== null)
  if (known.length === 0) return null
  return Math.round(known.reduce((sum, t) => sum + t.score, 0) / known.length)
}

export function coverageOf(checks: CheckResult[]): AuditCoverage {
  const scoredChecks = checks.filter(isScored)
  const insufficient = scoredChecks.filter((c) => c.passed === null).length
  return {
    scored: scoredChecks.length - insufficient,
    insufficient,
    informational: checks.length - scoredChecks.length,
    total: checks.length,
  }
}

/**
 * Điểm "cùng điều kiện" của 1 danh sách check, chỉ tính trên tập check cho trước (xem diff.ts).
 * Cùng công thức với scoreAllTiers + scoreOverall nên 2 lần chạy so sánh trên đúng cùng một tập check.
 */
export function scoreOnSubset(checks: CheckResult[]): number | null {
  return scoreOverall(scoreAllTiers(checks))
}
