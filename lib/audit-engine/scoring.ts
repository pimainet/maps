import type { AuditCoverage, AuditWeighting, CheckGroup, CheckResult, TierScore } from './types'
import { MIN_WEIGHT_COVERAGE_PCT, SCORING_VERSION, weightOf } from './weights'

export const GROUPS: CheckGroup[] = ['foundation', 'relevance', 'trust', 'visual', 'content', 'visibility', 'website', 'conversion']

/** Check có được tính vào điểm không: không phải insight (scored=false) và có trọng số > 0. */
export const isScored = (c: CheckResult): boolean => c.scored !== false && weightOf(c.id) > 0

const round1 = (n: number) => Math.round(n * 10) / 10

export function scoreTier(group: CheckGroup, checks: CheckResult[]): TierScore {
  const groupChecks = checks.filter((c) => c.group === group && isScored(c))
  const known = groupChecks.filter((c) => c.passed !== null)
  const weight = groupChecks.reduce((s, c) => s + weightOf(c.id), 0)
  const knownWeight = known.reduce((s, c) => s + weightOf(c.id), 0)
  const insufficientCount = groupChecks.length - known.length
  if (known.length === 0 || knownWeight === 0) {
    return { group, score: null, checkedCount: 0, insufficientCount, weight, knownWeight: 0 }
  }
  const passedWeight = known.filter((c) => c.passed === true).reduce((s, c) => s + weightOf(c.id), 0)
  return { group, score: Math.round((passedWeight / knownWeight) * 100), checkedCount: known.length, insufficientCount, weight, knownWeight }
}

export function scoreAllTiers(checks: CheckResult[]): TierScore[] {
  return GROUPS.map((group) => scoreTier(group, checks))
}

/**
 * Cách tính điểm, minh bạch: trọng số gốc của từng check, phần trọng số có dữ liệu, và trọng số THỰC TẾ sau khi
 * chuẩn hoá lại (mục thiếu dữ liệu bị loại, phần của nó chia đều theo tỉ lệ cho các mục còn lại — theo từng check,
 * nên 1 mục đơn lẻ không thể chiếm cả phần của một nhóm).
 */
export function weightingOf(checks: CheckResult[]): AuditWeighting {
  const scored = checks.filter(isScored)
  const totalWeight = scored.reduce((s, c) => s + weightOf(c.id), 0)
  const knownWeight = scored.filter((c) => c.passed !== null).reduce((s, c) => s + weightOf(c.id), 0)
  const coveragePct = totalWeight > 0 ? round1((knownWeight / totalWeight) * 100) : 0
  return {
    scoringVersion: SCORING_VERSION,
    totalWeight,
    knownWeight,
    coveragePct,
    minCoveragePct: MIN_WEIGHT_COVERAGE_PCT,
    checks: scored.map((c) => ({
      id: c.id,
      weight: weightOf(c.id),
      effectivePct: c.passed !== null && knownWeight > 0 ? round1((weightOf(c.id) / knownWeight) * 100) : 0,
    })),
  }
}

/** Điểm tổng 0–100 theo trọng số từng check; null khi phần trọng số có dữ liệu < MIN_WEIGHT_COVERAGE_PCT. */
export function scoreChecks(checks: CheckResult[], opts?: { minCoveragePct?: number }): number | null {
  const scored = checks.filter(isScored)
  const totalWeight = scored.reduce((s, c) => s + weightOf(c.id), 0)
  const known = scored.filter((c) => c.passed !== null)
  const knownWeight = known.reduce((s, c) => s + weightOf(c.id), 0)
  if (knownWeight === 0 || totalWeight === 0) return null
  const min = opts?.minCoveragePct ?? MIN_WEIGHT_COVERAGE_PCT
  if ((knownWeight / totalWeight) * 100 < min) return null
  const passedWeight = known.filter((c) => c.passed === true).reduce((s, c) => s + weightOf(c.id), 0)
  return Math.round((passedWeight / knownWeight) * 100)
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
 * Điểm "cùng điều kiện" của 1 danh sách check, chỉ tính trên tập check cho trước (xem diff.ts). Tập này đã là các check
 * có dữ liệu ở cả 2 lần nên không áp ngưỡng độ phủ.
 */
export function scoreOnSubset(checks: CheckResult[]): number | null {
  return scoreChecks(checks, { minCoveragePct: 0 })
}
