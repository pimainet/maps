/** Phần thuần: suy ra trạng thái đồng ý hiện tại từ lịch sử consent_records (mới nhất trước). */
import { CONSENT_VERSION, missingRequiredPurposes, normalizeConsentChoice, type ConsentChoice } from './policy'

export type ConsentRow = {
  policy_version: string
  purposes: unknown
  action: 'grant' | 'withdraw' | 'update'
  recorded_at: string
  consented_at?: string | null
  source?: string | null
}

export type ConsentState = {
  current: { version: string; purposes: ConsentChoice; at: string } | null
  needsConsent: boolean
  reason: 'none' | 'outdated' | 'withdrawn' | 'missing_required' | null
}

export function consentState(rows: ConsentRow[], version = CONSENT_VERSION): ConsentState {
  const sorted = [...rows].sort((a, b) => (a.recorded_at < b.recorded_at ? 1 : a.recorded_at > b.recorded_at ? -1 : 0))
  const latest = sorted[0]
  if (!latest) return { current: null, needsConsent: true, reason: 'none' }
  const purposes = normalizeConsentChoice(latest.purposes)
  const current = { version: latest.policy_version, purposes, at: latest.consented_at || latest.recorded_at }
  if (latest.action === 'withdraw') return { current, needsConsent: true, reason: 'withdrawn' }
  if (latest.policy_version !== version) return { current, needsConsent: true, reason: 'outdated' }
  if (missingRequiredPurposes(purposes).length) return { current, needsConsent: true, reason: 'missing_required' }
  return { current, needsConsent: false, reason: null }
}
