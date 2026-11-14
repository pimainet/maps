import type { ReactNode } from 'react'
import { GROUP_LABEL_VI } from '@/lib/audit-engine/labels'
import type { AuditDiff, AuditReport, CheckGroup } from '@/lib/audit-engine'
import type { ScoreOverride } from '@/components/dashboard/audit-result-view'

const GROUP_ORDER: CheckGroup[] = ['foundation', 'relevance', 'trust', 'visual', 'content', 'visibility', 'conversion']
const to10 = (score100: number) => Math.round(score100) / 10

export type AuditComparison =
  | (AuditDiff & { previous_date?: string; previous_audit_id?: string })
  | { comparable: false; reason?: string }

const small: React.CSSProperties = { margin: '6px 0', fontSize: 13, lineHeight: 1.55, color: 'var(--muted-foreground)' }

function ComparisonBlock({ c }: { c: AuditComparison }) {
  if (!c.comparable) {
    return (
      <div className="insight" style={{ background: 'var(--surface-muted, #f5f5f5)' }}>
        <h3>So với lần trước</h3>
        <p style={small}>{'reason' in c && c.reason ? c.reason : 'Chưa so sánh được với lần trước.'}</p>
      </div>
    )
  }
  const d = c as AuditDiff & { previous_date?: string }
  const when = d.previous_date ? new Date(d.previous_date).toLocaleDateString('vi-VN') : 'lần trước'
  return (
    <div className="insight">
      <h3>So với lần kiểm tra {when}</h3>
      {d.hasRealChange ? (
        <>
          {d.improved.length > 0 && (
            <p style={{ marginTop: 6 }}>
              <strong>Đã cải thiện ({d.improved.length}):</strong> {d.improved.map((x) => x.label).join(', ')}
            </p>
          )}
          {d.regressed.length > 0 && (
            <p style={{ marginTop: 6 }}>
              <strong>Cần xem lại ({d.regressed.length}):</strong> {d.regressed.map((x) => x.label).join(', ')}
            </p>
          )}
          {d.comparableScoreDelta != null && d.comparableScoreDelta !== 0 && (
            <p style={small}>
              Điểm trên cùng các mục đã kiểm tra ở cả hai lần: {d.comparableScoreDelta > 0 ? '+' : ''}
              {to10(d.comparableScoreDelta)} ({d.comparableChecks} mục).
            </p>
          )}
        </>
      ) : (
        <p style={{ marginTop: 6 }}>Chưa có mục nào đổi trạng thái so với lần trước. Điểm không đổi là bình thường.</p>
      )}
      {d.unconfirmed.length > 0 && (
        <p style={small}>
          Cần kiểm tra lại (dữ liệu loại này đọc chưa ổn định giữa các lần, chưa tính là xấu đi): {d.unconfirmed.map((x) => x.label).join(', ')}.
        </p>
      )}
      {d.newlyVerified.length > 0 && (
        <p style={small}>Lần này đọc được thêm {d.newlyVerified.length} mục mà lần trước chưa đủ dữ liệu.</p>
      )}
    </div>
  )
}

/** Dựng phần thay thế điểm cho AuditResultView từ kết quả engine v2. */
export function buildScoreOverride(report: AuditReport, comparison: AuditComparison | null): ScoreOverride {
  const cov = report.coverage
  const extra: ReactNode = (
    <>
      {cov && (
        <p style={small}>
          Đã kiểm tra {cov.scored} mục
          {cov.insufficient > 0 ? `; ${cov.insufficient} mục chưa đủ dữ liệu để kết luận (không bị trừ điểm)` : ''}.
        </p>
      )}
      {comparison && <ComparisonBlock c={comparison} />}
    </>
  )
  return {
    display: report.overallScore == null ? '–' : String(to10(report.overallScore)),
    groups: GROUP_ORDER.map((g) => {
      const t = report.tierScores.find((x) => x.group === g)
      return { key: g, label: GROUP_LABEL_VI[g], score: t?.score == null ? null : to10(t.score) }
    }),
    extra,
  }
}
