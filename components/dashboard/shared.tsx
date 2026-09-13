// Các component nhỏ dùng chung giữa nhiều trang trong khu vực dashboard.
// Tách ra khỏi app/page.tsx (trước đây định nghĩa trực tiếp trong 1 file 2200+ dòng).
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
