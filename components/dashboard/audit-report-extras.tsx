import type { ReactNode } from 'react'
import { GROUP_LABEL_VI, checkLabelVi } from '@/lib/audit-engine/labels'
import type { AuditDiff, AuditReport, CheckGroup } from '@/lib/audit-engine'
import type { ScoreOverride } from '@/components/dashboard/audit-result-view'

const GROUP_ORDER: CheckGroup[] = ['foundation', 'relevance', 'trust', 'visual', 'content', 'visibility', 'website', 'conversion']
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

const STATUS_VI = (p: boolean | null) => (p === true ? 'Đạt' : p === false ? 'Chưa đạt' : 'Chưa đủ dữ liệu')

/** Bảng "Cách tính điểm": trọng số gốc và trọng số thực tế của từng mục (chỉ báo cáo scoring v3). */
export function WeightingBlock({ report }: { report: AuditReport }) {
  const w = report.weighting
  if (!w || w.checks.length === 0) return null
  const byId = new Map(report.checks.map((c) => [c.id, c]))
  const rows = [...w.checks].sort((a, b) => b.weight - a.weight)
  const pct = (n: number) => (w.totalWeight > 0 ? Math.round((n / w.totalWeight) * 1000) / 10 : 0)
  return (
    <details className="insight" style={{ marginTop: 8 }}>
      <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Cách tính điểm ({w.coveragePct}% trọng số có dữ liệu)</summary>
      <p style={small}>
        Mỗi mục có trọng số theo mức ảnh hưởng tới việc khách tìm thấy quán (danh mục, đánh giá, hiện ra quanh quán nặng nhất; ảnh và bài
        đăng nhẹ). Mục chưa đủ dữ liệu được bỏ ra, phần của nó chia theo tỉ lệ cho các mục còn lại (cột "Thực tế").
        {report.overallScore == null ? ` Dưới ${w.minCoveragePct}% trọng số có dữ liệu nên chưa chấm điểm tổng.` : ''}
      </p>
      <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ textAlign: 'left' }}>
            <th>Mục</th>
            <th>Trọng số</th>
            <th>Thực tế</th>
            <th>Kết quả</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const c = byId.get(r.id)
            return (
              <tr key={r.id} style={{ borderTop: '1px solid var(--border, #eee)' }}>
                <td>{checkLabelVi(r.id, c?.label ?? r.id)}</td>
                <td>{pct(r.weight)}%</td>
                <td>{r.effectivePct > 0 ? `${r.effectivePct}%` : '–'}</td>
                <td>{STATUS_VI(c?.passed ?? null)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </details>
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
      <WeightingBlock report={report} />
      {comparison && <ComparisonBlock c={comparison} />}
    </>
  )
  const delta =
    comparison && comparison.comparable && (comparison as AuditDiff).comparableScoreDelta != null
      ? to10((comparison as AuditDiff).comparableScoreDelta as number)
      : null
  return {
    delta,
    display: report.overallScore == null ? '–' : String(to10(report.overallScore)),
    groups: GROUP_ORDER.flatMap((g) => {
      const t = report.tierScores.find((x) => x.group === g)
      // Báo cáo v3: bỏ nhóm chỉ hiển thị (trọng số 0) và ghi trọng số cạnh tên nhóm. Báo cáo cũ giữ nguyên.
      if (report.weighting && (!t || !t.weight)) return []
      const share = report.weighting && t?.weight ? ` · ${Math.round((t.weight / report.weighting.totalWeight) * 100)}%` : ''
      return [{ key: g, label: GROUP_LABEL_VI[g] + share, score: t?.score == null ? null : to10(t.score) }]
    }),
    extra,
  }
}
