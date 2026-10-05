import type { CheckGroup, CheckResult, TierScore } from './types'

const SEVERITY_WEIGHT: Record<CheckResult['severity'], number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
}

const GROUPS: CheckGroup[] = ['foundation', 'relevance', 'trust', 'visual', 'content', 'visibility', 'conversion']

export function scoreTier(group: CheckGroup, checks: CheckResult[]): TierScore {
  const groupChecks = checks.filter((c) => c.group === group)
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
