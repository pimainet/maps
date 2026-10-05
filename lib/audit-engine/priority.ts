import type { CheckResult, Opportunity } from './types'

const SEVERITY_RANK: Record<CheckResult['severity'], number> = { critical: 0, high: 1, medium: 2, low: 3 }
const CONFIDENCE_RANK: Record<CheckResult['confidence'], number> = { verified: 0, estimated: 1, insufficient: 2 }

const CONVERSION_DEPENDENCIES: Record<string, string[]> = {
  CV01: ['F04', 'F05', 'F06', 'F07'],
  CV02: ['T02', 'V01'],
  CV03: ['R01', 'R04'],
  CV04: ['F05', 'F06'],
}

export function pickTopOpportunities(checks: CheckResult[], limit = 5): Opportunity[] {
  const failing = checks.filter((c): c is CheckResult & { action: string } => c.passed === false && !!c.action)

  const sorted = [...failing].sort((a, b) => {
    const sev = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]
    if (sev !== 0) return sev
    return CONFIDENCE_RANK[a.confidence] - CONFIDENCE_RANK[b.confidence]
  })

  const suppressed = new Set<string>()
  for (const c of sorted) {
    const deps = CONVERSION_DEPENDENCIES[c.id]
    if (deps) deps.forEach((id) => suppressed.add(id))
  }

  const result: Opportunity[] = []
  for (const c of sorted) {
    if (suppressed.has(c.id)) continue
    result.push({ checkId: c.id, label: c.label, severity: c.severity, confidence: c.confidence, action: c.action })
    if (result.length >= limit) break
  }
  return result
}
