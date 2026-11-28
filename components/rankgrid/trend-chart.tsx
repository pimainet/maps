'use client'

/** Biểu đồ xu hướng SoLV (%) và ATRP (hạng TB toàn lưới, trục đảo: 1 ở trên) theo thời gian — SVG tự vẽ, không thêm thư viện. */

export type TrendPoint = { date: string; solv: number | null; atrp: number | null }

export function TrendChart({ data }: { data: TrendPoint[] }) {
  const pts = data.filter((d) => d.solv != null || d.atrp != null)
  if (pts.length < 2) return <div className="empty-note">Cần ít nhất 2 lần quét cùng từ khoá để vẽ xu hướng.</div>
  const W = 640
  const H = 180
  const pad = { l: 36, r: 36, t: 12, b: 26 }
  const x = (i: number) => pad.l + (i * (W - pad.l - pad.r)) / Math.max(1, pts.length - 1)
  const ySolv = (v: number) => pad.t + ((100 - v) * (H - pad.t - pad.b)) / 100
  const yAtrp = (v: number) => pad.t + ((v - 1) * (H - pad.t - pad.b)) / 20
  const line = (f: (d: TrendPoint) => number | null, y: (v: number) => number) =>
    pts
      .map((d, i) => (f(d) == null ? null : `${x(i)},${y(f(d) as number)}`))
      .filter(Boolean)
      .join(' ')
  const fmt = (s: string) => new Date(s).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', timeZone: 'Asia/Ho_Chi_Minh' })
  return (
    <div className="rg-trend">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Xu hướng SoLV và ATRP">
        {[0, 50, 100].map((v) => (
          <g key={v}>
            <line x1={pad.l} x2={W - pad.r} y1={ySolv(v)} y2={ySolv(v)} className="rg-grid-line" />
            <text x={pad.l - 6} y={ySolv(v) + 4} textAnchor="end" className="rg-axis">{v}%</text>
          </g>
        ))}
        {[1, 11, 21].map((v) => (
          <text key={v} x={W - pad.r + 6} y={yAtrp(v) + 4} className="rg-axis">{v === 21 ? '20+' : v}</text>
        ))}
        <polyline points={line((d) => d.solv, ySolv)} className="rg-line-solv" />
        <polyline points={line((d) => d.atrp, yAtrp)} className="rg-line-atrp" />
        {pts.map((d, i) => (
          <g key={i}>
            {d.solv != null && <circle cx={x(i)} cy={ySolv(d.solv)} r={3} className="rg-dot-solv" />}
            <text x={x(i)} y={H - 6} textAnchor="middle" className="rg-axis">{fmt(d.date)}</text>
          </g>
        ))}
      </svg>
      <div className="rg-legend">
        <span><i className="rg-swatch rg-solv" /> SoLV (% khu vực trong top 3, càng cao càng tốt)</span>
        <span><i className="rg-swatch rg-atrp" /> ATRP (hạng TB toàn lưới, trục phải, càng thấp càng tốt)</span>
      </div>
    </div>
  )
}
