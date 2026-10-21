// Các component nhỏ dùng chung giữa nhiều trang trong khu vực dashboard.
// Tách ra khỏi app/page.tsx (trước đây định nghĩa trực tiếp trong 1 file 2200+ dòng).
import { useId } from 'react'
import { Check } from 'lucide-react'
import { statusMap } from '@/lib/ui-constants'

export function Badge({ status }: { status: string }) {
  const item = statusMap[status] || { label: status, className: 'status-muted' }
  return (
    <span className={`status-badge ${item.className}`}>
      <span className="status-dot" />
      {item.label}
    </span>
  )
}

export function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <section className={`panel ${className}`}>{children}</section>
}

export function Metric({ icon: Icon, label, value, note, tone = 'blue' }: any) {
  return (
    <Card className="metric">
      <div className={`metric-icon ${tone}`}>
        <Icon size={18} />
      </div>
      <div>
        <p className="eyebrow">{label}</p>
        <p className="metric-value">{value}</p>
        <p className="metric-note">{note}</p>
      </div>
    </Card>
  )
}

/**
 * Vòng tiến độ. Đường tô chuyển từ tím lam sang sâm panh khi gần xong.
 * Vẽ ra một lần khi mở trang (tắt khi người dùng chọn giảm chuyển động).
 */
export function ProgressRing({ percent, size = 112, stroke = 9 }: { percent: number; size?: number; stroke?: number }) {
  const uid = useId().replace(/:/g, '')
  const safe = Math.max(0, Math.min(100, percent))
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const offset = c * (1 - safe / 100)
  return (
    <div className="ring" style={{ width: size, height: size }} role="img" aria-label={`Đã hoàn thành ${safe}%`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <defs>
          <linearGradient id={`ring-${uid}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#7c8cff" />
            <stop offset="100%" stopColor="#e3c98f" />
          </linearGradient>
        </defs>
        <circle className="ring-track" cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} />
        <circle
          className="ring-fill"
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          stroke={`url(#ring-${uid})`}
          strokeDasharray={c}
          strokeDashoffset={offset}
          style={{ ['--ring-len' as any]: c }}
        />
      </svg>
      <div className="ring-num">
        {safe}
        <small>%</small>
      </div>
    </div>
  )
}

export function Step({ icon: Icon, label, done, active }: any) {
  return (
    <div className={`step ${done ? 'done' : ''} ${active ? 'current' : ''}`}>
      <div className="step-icon">{done ? <Check size={16} /> : <Icon size={16} />}</div>
      <span>{label}</span>
    </div>
  )
}

export function Field({ label, required, placeholder, wide }: any) {
  return (
    <label className={`field ${wide ? 'wide' : ''}`}>
      <span>
        {label}
        {required && <em>*</em>}
      </span>
      <input placeholder={placeholder} />
    </label>
  )
}

export function Timeline({ title, time, icon: Icon }: any) {
  return (
    <div className="timeline-item">
      <div className="timeline-icon">
        <Icon size={15} />
      </div>
      <div>
        <strong>{title}</strong>
        <span>{time}</span>
      </div>
    </div>
  )
}
