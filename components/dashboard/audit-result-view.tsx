import type { ReactNode } from 'react'
import { Lock } from 'lucide-react'
import type { DemoAudit } from '@/lib/demo-audit'
import { Card } from '@/components/dashboard/shared'

/**
 * Thay số điểm/nhóm điểm lấy từ việc đọc chữ (audit v1) bằng số do engine v2 tính sẵn.
 * score = null nghĩa là nhóm đó chưa đủ dữ liệu (hiện chữ, không vẽ thanh).
 */
export type ScoreOverride = {
  display: string
  groups: Array<{ key: string; label: string; score: number | null }>
  /** Khối hiện thêm dưới phần giải thích (độ phủ dữ liệu, so sánh với lần trước...). */
  extra?: ReactNode
}

export function AuditResultView({
  audit,
  teaser = false,
  rawFallback,
  scoreOverride,
  recommendations,
}: {
  audit: DemoAudit
  teaser?: boolean
  rawFallback?: string
  scoreOverride?: ScoreOverride
  /** Khối đặt đầu phần "Đề nghị" (vd thẻ tư vấn danh mục + mô tả). Chỉ dùng ở bản đầy đủ. */
  recommendations?: ReactNode
}) {
  const groups = scoreOverride?.groups ?? audit.groups
  const full = !teaser

  const scoreCard = (
      <Card className="result-panel">
        <div className="result-top">
          <div>
            <p className="overline">Kết quả Audit</p>
            <h2>{audit.businessName}</h2>
            <p>
              {[audit.industryLabel, audit.area].filter(Boolean).join(' · ') || 'Google Business Profile'}
              {teaser ? ' · bản xem trước khách' : ' · đã lưu vào hệ thống'}
            </p>
          </div>
          <div className="score-ring">
            <strong>{scoreOverride?.display ?? audit.overall}</strong>
            <span>/10</span>
          </div>
        </div>
        <p style={{ margin: '0 0 18px', color: 'var(--muted-foreground)', fontSize: 13, lineHeight: 1.55 }}>{audit.overallNote}</p>
        <div className="score-bars">
          {groups.map((g) => (
            <div className="score-row" key={g.key}>
              <div>
                <span>{g.label}</span>
                <strong>{g.score == null ? 'Chưa đủ dữ liệu' : g.score}</strong>
              </div>
              <div className="progress">
                <i style={{ width: `${g.score == null ? 0 : Math.min(100, g.score * 10)}%` }} />
              </div>
            </div>
          ))}
        </div>
        {audit.strengths.length > 0 && (
          <div className="insight">
            <h3>Điểm mạnh</h3>
            {audit.strengths.map((s) => (
              <p key={s} style={{ marginTop: 6 }}>
                {s}
              </p>
            ))}
          </div>
        )}
        {audit.weaknesses.filter((w) => w.priority === 'high').length > 0 && (
          <div className="insight warning">
            <h3>Ưu tiên Cao</h3>
            {audit.weaknesses
              .filter((w) => w.priority === 'high')
              .map((w) => (
                <p key={w.text} style={{ marginTop: 6 }}>
                  {w.text}
                </p>
              ))}
          </div>
        )}
      </Card>
  )

  const actionsCard = (
      <Card>
        <div className="section-head">
          <div>
            <h2>Việc cần làm ngay (7–14 ngày)</h2>
            <p>Đủ để chốt hướng — chưa phải toàn bộ lộ trình</p>
          </div>
        </div>
        <ol style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 10, fontSize: 13, lineHeight: 1.55 }}>
          {audit.actions.slice(0, 3).map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ol>
        {audit.actions.length > 3 && (
          <details style={{ marginTop: 10, fontSize: 13 }}>
            <summary style={{ cursor: 'pointer', color: 'var(--muted-foreground)' }}>Xem thêm {audit.actions.length - 3} việc</summary>
            <ol start={4} style={{ margin: '8px 0 0', paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 10, lineHeight: 1.55 }}>
              {audit.actions.slice(3).map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ol>
          </details>
        )}
      </Card>
  )

  return (
    <>
      {full ? (
        <>
          <PartTitle id="de-nghi" title="Đề nghị cho quán" note="Việc nên làm để Google đưa quán tới đúng khách" />
          {recommendations}
          {actionsCard}

          <PartTitle id="danh-gia-maps" title="Đánh giá Google Maps" note="Điểm hiện tại của hồ sơ và các nhóm chính" />
          {scoreCard}
          <details className="detail-fold">
            <summary>Xem chi tiết đánh giá</summary>
            <div className="detail-fold-body">
              {scoreOverride?.extra}
              {rawFallback && <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.65, fontSize: 14 }}>{rawFallback}</div>}
            </div>
          </details>
          <style>{FOLD_CSS}</style>
        </>
      ) : (
        <>
          {scoreCard}
          {actionsCard}
        </>
      )}

      {teaser && (
        <div className="metrics-grid">
          {audit.lockedHints.map((h) => (
            <Card key={h.title}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <Lock size={14} />
                <h2 style={{ margin: 0 }}>{h.title}</h2>
              </div>
              <p style={{ filter: 'blur(3px)', userSelect: 'none', color: 'var(--muted-foreground)', fontSize: 12 }}>{h.teaser}</p>
              <p style={{ marginTop: 10, fontSize: 12, fontWeight: 700, color: 'var(--primary)' }}>Mở khi chạy audit đầy đủ trong OS</p>
            </Card>
          ))}
        </div>
      )}

    </>
  )
}

function PartTitle({ id, title, note }: { id: string; title: string; note: string }) {
  return (
    <div id={id} className="part-title">
      <h2>{title}</h2>
      <p>{note}</p>
    </div>
  )
}

const FOLD_CSS = `
.part-title { margin:28px 0 -4px; padding-left:12px; border-left:3px solid var(--primary, #7c8cff); scroll-margin-top:16px; }
.part-title h2 { margin:0; font-size:19px; font-weight:650; letter-spacing:-.01em; }
.part-title p { margin:2px 0 0; font-size:13px; color:var(--muted-foreground); }
.detail-fold { border:1px solid var(--border-strong); border-radius:14px; background:var(--card); overflow:hidden; }
.detail-fold > summary { cursor:pointer; list-style:none; padding:14px 18px; font-size:14px; font-weight:600; display:flex; align-items:center; justify-content:space-between; }
.detail-fold > summary::-webkit-details-marker { display:none; }
.detail-fold > summary::after { content:'Mở ▾'; font-size:12.5px; font-weight:500; color:var(--muted-foreground); }
.detail-fold[open] > summary::after { content:'Thu gọn ▴'; }
.detail-fold > summary:focus-visible { outline:2px solid var(--primary, #7c8cff); outline-offset:-2px; }
.detail-fold-body { padding:4px 18px 18px; display:grid; gap:14px; border-top:1px solid var(--border); }
`
