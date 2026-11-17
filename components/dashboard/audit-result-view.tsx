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
  /** Chênh điểm tổng (thang 10) so với lần audit trước trên cùng các mục đã kiểm tra; null = không so sánh được. */
  delta?: number | null
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

  const overallNum = Number(scoreOverride?.display ?? audit.overall)
  const hasOverall = Number.isFinite(overallNum)
  const delta = scoreOverride?.delta ?? null

  const heroCard = (
    <Card className="hero-card">
      <div className="hero-ring" role="img" aria-label={hasOverall ? `Điểm Google Maps ${overallNum} trên 10` : 'Chưa có điểm tổng'}>
        <svg viewBox="0 0 120 120" width="120" height="120" aria-hidden="true">
          <circle cx="60" cy="60" r="52" className="hero-ring-bg" />
          <circle
            cx="60"
            cy="60"
            r="52"
            className="hero-ring-fg"
            strokeDasharray={`${hasOverall ? Math.max(0, Math.min(1, overallNum / 10)) * 326.7 : 0} 326.7`}
          />
        </svg>
        <div className="hero-ring-num">
          <strong>{scoreOverride?.display ?? audit.overall}</strong>
          <span>/10</span>
        </div>
      </div>
      <div className="hero-body">
        <h2>{audit.businessName}</h2>
        <p className="hero-meta">{[audit.industryLabel, audit.area].filter(Boolean).join(' · ') || 'Google Business Profile'}</p>
        {delta != null && delta !== 0 && (
          <span className={`hero-delta ${delta > 0 ? 'up' : 'down'}`}>
            {delta > 0 ? '▲ +' : '▼ '}
            {delta} điểm so với lần trước
          </span>
        )}
        <p className="hero-note">{audit.overallNote}</p>
        <div className="hero-jump">
          <a href="#de-nghi">Đề nghị cho quán</a>
          <a href="#danh-gia-maps">Điểm chi tiết</a>
        </div>
      </div>
    </Card>
  )

  const tilesCard = (
    <>
      <div className="tile-grid">
        {groups.map((g) => {
          const tone = g.score == null ? 'idle' : g.score >= 7 ? 'ok' : g.score >= 4 ? 'mid' : 'low'
          return (
            <div className={`tile tile-${tone}`} key={g.key}>
              <span className="tile-label">{g.label}</span>
              {g.score == null ? (
                <strong className="tile-none">Chưa đủ dữ liệu</strong>
              ) : (
                <strong className="tile-score">
                  {g.score}
                  <small>/10</small>
                </strong>
              )}
              <div className="tile-bar" aria-hidden="true">
                <i style={{ width: `${g.score == null ? 0 : Math.min(100, g.score * 10)}%` }} />
              </div>
            </div>
          )
        })}
      </div>
      {(audit.strengths.length > 0 || audit.weaknesses.some((w) => w.priority === 'high')) && (
        <div className="insight-pair">
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
          {audit.weaknesses.some((w) => w.priority === 'high') && (
            <div className="insight warning">
              <h3>Ưu tiên cao</h3>
              {audit.weaknesses
                .filter((w) => w.priority === 'high')
                .map((w) => (
                  <p key={w.text} style={{ marginTop: 6 }}>
                    {w.text}
                  </p>
                ))}
            </div>
          )}
        </div>
      )}
    </>
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
          {heroCard}
          <PartTitle id="de-nghi" title="Đề nghị cho quán" note="Việc nên làm để Google đưa quán tới đúng khách" />
          {recommendations}
          {actionsCard}

          <PartTitle id="danh-gia-maps" title="Đánh giá Google Maps" note="Điểm hiện tại của hồ sơ và các nhóm chính" />
          {tilesCard}
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
.hero-card { display:flex; gap:24px; align-items:center; }
.hero-ring { position:relative; flex:none; width:120px; height:120px; }
.hero-ring svg { transform:rotate(-90deg); display:block; }
.hero-ring circle { fill:none; stroke-width:9; }
.hero-ring-bg { stroke:color-mix(in srgb, var(--border-strong) 70%, transparent); }
.hero-ring-fg { stroke:var(--primary, #7c8cff); stroke-linecap:round; transition:stroke-dasharray .9s cubic-bezier(.2,.8,.2,1); }
.hero-ring-num { position:absolute; inset:0; display:flex; align-items:baseline; justify-content:center; gap:2px; padding-top:38px; }
.hero-ring-num strong { font-size:34px; font-weight:700; letter-spacing:-.03em; font-variant-numeric:tabular-nums; }
.hero-ring-num span { font-size:13px; color:var(--muted-foreground); }
.hero-body { min-width:0; display:grid; gap:6px; }
.hero-body h2 { margin:0; font-size:22px; letter-spacing:-.015em; overflow-wrap:anywhere; }
.hero-meta { margin:0; font-size:13px; color:var(--muted-foreground); }
.hero-note { margin:2px 0 0; font-size:13.5px; line-height:1.55; color:var(--muted-foreground); max-width:62ch; }
.hero-delta { justify-self:start; font-size:12.5px; font-weight:600; padding:3px 10px; border-radius:999px; border:1px solid currentColor; }
.hero-delta.up { color:var(--success, #4fbf93); }
.hero-delta.down { color:var(--warning, #e3a53f); }
.hero-jump { display:flex; gap:14px; flex-wrap:wrap; margin-top:4px; }
.hero-jump a { font-size:13px; font-weight:600; color:var(--primary, #7c8cff); text-decoration:none; }
.hero-jump a:hover { text-decoration:underline; text-underline-offset:3px; }
.tile-grid { display:grid; gap:12px; grid-template-columns:repeat(2, minmax(0,1fr)); }
@media (min-width: 720px) { .tile-grid { grid-template-columns:repeat(4, minmax(0,1fr)); } }
.tile { display:grid; gap:6px; align-content:start; padding:14px 14px 12px; border-radius:14px; border:1px solid var(--border-strong); background:var(--card); }
.tile-label { font-size:12.5px; color:var(--muted-foreground); line-height:1.35; }
.tile-score { font-size:26px; font-weight:700; letter-spacing:-.02em; font-variant-numeric:tabular-nums; }
.tile-score small { font-size:12px; font-weight:500; color:var(--muted-foreground); margin-left:2px; }
.tile-none { font-size:13px; font-weight:500; color:var(--muted-foreground); line-height:1.4; padding:5px 0; }
.tile-bar { height:5px; border-radius:3px; background:color-mix(in srgb, var(--border-strong) 60%, transparent); overflow:hidden; }
.tile-bar i { display:block; height:100%; border-radius:3px; background:var(--muted-foreground); }
.tile-ok .tile-bar i { background:var(--success, #4fbf93); }
.tile-mid .tile-bar i { background:var(--primary, #7c8cff); }
.tile-low .tile-bar i { background:var(--warning, #e3a53f); }
.insight-pair { display:grid; gap:12px; grid-template-columns:minmax(0,1fr); }
@media (min-width: 720px) { .insight-pair { grid-template-columns:repeat(2, minmax(0,1fr)); } }
@media (max-width: 520px) { .hero-card { flex-direction:column; align-items:flex-start; gap:16px; } }
.detail-fold-body { padding:4px 18px 18px; display:grid; gap:14px; border-top:1px solid var(--border); }
`
