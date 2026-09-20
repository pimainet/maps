import { Lock } from 'lucide-react'
import type { DemoAudit } from '@/lib/demo-audit'
import { Card } from '@/components/dashboard/shared'

export function AuditResultView({
  audit,
  teaser = false,
  rawFallback,
}: {
  audit: DemoAudit
  teaser?: boolean
  rawFallback?: string
}) {
  return (
    <>
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
            <strong>{audit.overall}</strong>
            <span>/10</span>
          </div>
        </div>
        <p style={{ margin: '0 0 18px', color: '#6b7280', fontSize: 13, lineHeight: 1.55 }}>{audit.overallNote}</p>
        <div className="score-bars">
          {audit.groups.map((g) => (
            <div className="score-row" key={g.key}>
              <div>
                <span>{g.label}</span>
                <strong>{g.score}</strong>
              </div>
              <div className="progress">
                <i style={{ width: `${Math.min(100, g.score * 10)}%` }} />
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

      <Card>
        <div className="section-head">
          <div>
            <h2>Việc cần làm ngay (7–14 ngày)</h2>
            <p>Đủ để chốt hướng — chưa phải toàn bộ lộ trình</p>
          </div>
        </div>
        <ol style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 10, fontSize: 13, lineHeight: 1.55 }}>
          {audit.actions.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ol>
      </Card>

      {teaser && (
        <div className="metrics-grid">
          {audit.lockedHints.map((h) => (
            <Card key={h.title}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <Lock size={14} />
                <h2 style={{ margin: 0 }}>{h.title}</h2>
              </div>
              <p style={{ filter: 'blur(3px)', userSelect: 'none', color: '#6b7280', fontSize: 12 }}>{h.teaser}</p>
              <p style={{ marginTop: 10, fontSize: 12, fontWeight: 700, color: 'var(--primary)' }}>Mở khi chạy audit đầy đủ trong OS</p>
            </Card>
          ))}
        </div>
      )}

      {!teaser && rawFallback && (
        <Card>
          <div className="section-head">
            <div>
              <h2>Bản ghi đầy đủ</h2>
              <p>Giữ nguyên output audit để lập lộ trình 30 ngày</p>
            </div>
          </div>
          <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6, fontSize: 14 }}>{rawFallback}</div>
        </Card>
      )}
    </>
  )
}
