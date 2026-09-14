'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { ArrowDown, ArrowUp, CalendarClock, CheckCircle2, FileText, Minus, Star } from 'lucide-react'
import { Card, Metric } from '@/components/dashboard/shared'

type Report = {
  client: { id: string; name: string }
  cycle: { id: string | null; status: 'active' | 'closed' | null; started_at: string | null; closed_at: string | null }
  metrics: {
    rating: { baseline: number | null; current: number | null; delta: number | null }
    review_count: { baseline: number | null; current: number | null; delta: number | null }
  }
  baseline_captured_at: string | null
  current_captured_at: string | null
  has_enough_data: boolean
  tasks: { total: number; done: number; percent: number }
  content_published: number
}

function DeltaBadge({ value, suffix = '' }: { value: number | null; suffix?: string }) {
  if (value == null) return <span className="muted-cell">—</span>
  if (value === 0) {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: '#6b7280' }}>
        <Minus size={14} /> Không đổi
      </span>
    )
  }
  const up = value > 0
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: up ? '#059669' : '#dc2626', fontWeight: 600 }}>
      {up ? <ArrowUp size={14} /> : <ArrowDown size={14} />}
      {up ? '+' : ''}
      {value}
      {suffix}
    </span>
  )
}

function fmtDate(s: string | null) {
  if (!s) return '—'
  return new Date(s).toLocaleDateString('vi-VN')
}

export default function ClientReportPage() {
  const params = useParams<{ id: string }>()
  const clientId = params.id
  const [report, setReport] = useState<Report | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/clients/${clientId}/report`)
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Không tải được báo cáo')
        setReport(data)
      } catch (err: any) {
        setError(err.message || 'Có lỗi xảy ra')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [clientId])

  if (loading) {
    return (
      <Card>
        <div style={{ padding: 40, textAlign: 'center', color: '#6b7280' }}>Đang tổng hợp báo cáo...</div>
      </Card>
    )
  }

  if (error || !report) {
    return (
      <Card>
        <div style={{ padding: 40, textAlign: 'center', color: '#b91c1c' }}>{error || 'Không có dữ liệu'}</div>
      </Card>
    )
  }

  return (
    <>
      <Card className="plan-summary">
        <div>
          <p className="overline">Báo cáo chu kỳ</p>
          <div className="title-line">
            <h2>{report.client.name}</h2>
          </div>
          <p>
            {report.cycle.started_at
              ? `Chu kỳ bắt đầu ${fmtDate(report.cycle.started_at)}${report.cycle.status === 'active' ? ' · đang chạy' : report.cycle.closed_at ? ` · đã đóng ${fmtDate(report.cycle.closed_at)}` : ''}`
              : 'Chưa có chu kỳ nào — hãy tạo lộ trình 30 ngày trước.'}
          </p>
        </div>

        {!report.has_enough_data && (
          <div style={{ marginTop: 12, padding: 12, background: '#fffbeb', borderRadius: 8, fontSize: 13, color: '#92400e' }}>
            Chưa đủ dữ liệu để so sánh trước/sau — cần ít nhất 2 lần lấy dữ liệu Google Maps (nút "Tự điền từ Google Maps" ở trang Audit)
            cách nhau theo thời gian. Hiện tại mới có {report.baseline_captured_at ? '1' : '0'} lần ghi nhận.
          </div>
        )}
      </Card>

      <div className="metrics-grid">
        <Metric
          icon={Star}
          label="Điểm đánh giá (rating)"
          value={
            <>
              {report.metrics.rating.current ?? '—'}
              {report.metrics.rating.baseline != null && (
                <span style={{ fontSize: 14, color: '#9ca3af', fontWeight: 400 }}> (từ {report.metrics.rating.baseline})</span>
              )}
            </>
          }
          note={<DeltaBadge value={report.metrics.rating.delta} />}
          tone="orange"
        />
        <Metric
          icon={CheckCircle2}
          label="Số lượng đánh giá (reviews)"
          value={
            <>
              {report.metrics.review_count.current ?? '—'}
              {report.metrics.review_count.baseline != null && (
                <span style={{ fontSize: 14, color: '#9ca3af', fontWeight: 400 }}> (từ {report.metrics.review_count.baseline})</span>
              )}
            </>
          }
          note={<DeltaBadge value={report.metrics.review_count.delta} />}
          tone="green"
        />
        <Metric
          icon={CalendarClock}
          label="Việc đã hoàn thành"
          value={`${report.tasks.done}/${report.tasks.total}`}
          note={`${report.tasks.percent}% trong chu kỳ này`}
        />
        <Metric icon={FileText} label="Bài đã đăng lên Google" value={String(report.content_published)} note="Trong chu kỳ này" />
      </div>

      <Card>
        <div className="section-head">
          <div>
            <h2>Nguồn dữ liệu</h2>
            <p>Để agency/khách hàng có thể kiểm chứng con số ở trên</p>
          </div>
        </div>
        <div className="signal-grid">
          <div>
            <span>Ảnh chụp "trước"</span>
            <strong>{fmtDate(report.baseline_captured_at)}</strong>
          </div>
          <div>
            <span>Ảnh chụp "hiện tại"</span>
            <strong>{fmtDate(report.current_captured_at)}</strong>
          </div>
        </div>
        <p style={{ marginTop: 12, fontSize: 13, color: '#6b7280' }}>
          Số liệu lấy từ Google Maps công khai của doanh nghiệp (qua nút "Tự điền từ Google Maps" ở trang Audit) — không phải AI ước
          tính.
        </p>
      </Card>
    </>
  )
}
