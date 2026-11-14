'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { ArrowDown, ArrowRight, ArrowUp, Minus } from 'lucide-react'
import { Card, ProgressRing } from '@/components/dashboard/shared'
import { TASK_TYPE_LABEL } from '@/lib/ui-constants'
import type { ProgressSummary } from '@/lib/progress'

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
  progress: ProgressSummary
  content_published: number
  summary: {
    bestThings: string[]
    metricsHighlights: string[]
    newIssue: string | null
    nextFocus: string
    suggestNewCycle: boolean
    suggestReason: string | null
  }
}

function DeltaBadge({ value, suffix = '' }: { value: number | null; suffix?: string }) {
  if (value == null) return <span className="muted-cell">—</span>
  if (value === 0) {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--muted-foreground)' }}>
        <Minus size={14} /> Không đổi
      </span>
    )
  }
  const up = value > 0
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: up ? 'var(--success)' : 'var(--danger)', fontWeight: 600 }}>
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
        if (!res.ok) throw new Error(data.error || 'Không tải được kết quả')
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
        <div className="empty-note">Đang tổng hợp kết quả…</div>
      </Card>
    )
  }

  if (error || !report) {
    return (
      <Card>
        <div className="empty-note error">{error || 'Không có dữ liệu'}</div>
      </Card>
    )
  }

  const p = report.progress
  const hasBaseline = report.baseline_captured_at != null
  const planned = report.cycle.started_at != null

  return (
    <>
      <Card>
        <div className="section-head" style={{ marginBottom: 0 }}>
          <div>
            <p className="overline">Kết quả của kế hoạch</p>
            <h2>{report.client.name}</h2>
            <p>
              {planned
                ? `Kế hoạch bắt đầu ${fmtDate(report.cycle.started_at)}${report.cycle.status === 'active' ? ', đang chạy' : report.cycle.closed_at ? `, đã đóng ${fmtDate(report.cycle.closed_at)}` : ''}`
                : 'Chưa có kế hoạch nào. Hãy tạo kế hoạch 30 ngày trước.'}
            </p>
          </div>
        </div>
      </Card>

      {report.summary && (
        <Card>
          <div className="section-head">
            <div>
              <p className="overline">Báo cáo tái khám</p>
              <h2>Tóm tắt chu kỳ này</h2>
              <p>Những gì đã làm tốt, thay đổi số liệu, và hướng đi tiếp theo.</p>
            </div>
          </div>

          <div style={{ display: 'grid', gap: 16 }}>
            <div>
              <strong style={{ display: 'block', marginBottom: 6 }}>Việc nổi bật đã làm</strong>
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {report.summary.bestThings.map((t, i) => (
                  <li key={i} style={{ marginBottom: 4 }}>{t}</li>
                ))}
              </ul>
            </div>

            <div>
              <strong style={{ display: 'block', marginBottom: 6 }}>Thay đổi số liệu</strong>
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {report.summary.metricsHighlights.map((t, i) => (
                  <li key={i} style={{ marginBottom: 4 }}>{t}</li>
                ))}
              </ul>
            </div>

            {report.summary.newIssue && (
              <div>
                <strong style={{ display: 'block', marginBottom: 6 }}>Vấn đề còn lại</strong>
                <p style={{ margin: 0 }}>{report.summary.newIssue}</p>
              </div>
            )}

            <div>
              <strong style={{ display: 'block', marginBottom: 6 }}>Hướng chu kỳ tiếp theo</strong>
              <p style={{ margin: 0 }}>{report.summary.nextFocus}</p>
            </div>

            {report.summary.suggestNewCycle && report.summary.suggestReason && (
              <div style={{ padding: '12px 14px', background: 'var(--muted)', borderRadius: 8 }}>
                <strong>Gợi ý mở chu kỳ mới</strong>
                <p style={{ margin: '6px 0 0' }}>{report.summary.suggestReason}</p>
                <div style={{ marginTop: 10 }}>
                  <Link href={`/clients/${clientId}/plan`} className="primary-button">
                    Xem kế hoạch <ArrowRight size={16} />
                  </Link>
                </div>
              </div>
            )}
          </div>
        </Card>
      )}

      <Card>
        <div className="section-head">
          <div>
            <h2>Tiến bộ của bạn</h2>
            <p>Số liệu tính từ những việc bạn đã đánh dấu hoàn thành.</p>
          </div>
        </div>

        {p.total === 0 ? (
          <div className="empty-note" style={{ padding: '20px 0 8px', textAlign: 'left' }}>
            Chưa có việc nào trong kế hoạch.
            <div style={{ marginTop: 16 }}>
              <Link href={`/clients/${clientId}/plan`} className="primary-button">
                Tạo kế hoạch 30 ngày <ArrowRight size={18} />
              </Link>
            </div>
          </div>
        ) : (
          <>
            <div className="ring-wrap">
              <ProgressRing percent={p.percent} />
              <div className="ring-text">
                <strong>
                  {p.done} trong {p.total} việc đã xong
                </strong>
                <span>
                  {p.nextMilestone
                    ? `Còn ${p.nextMilestone.remaining} việc nữa là đạt ${p.nextMilestone.target}%.`
                    : 'Bạn đã hoàn thành toàn bộ kế hoạch.'}
                </span>
                {p.doneThisWeek ? <span>Tuần này bạn đã xong {p.doneThisWeek} việc.</span> : null}
              </div>
            </div>

            {p.byType.length > 1 && (
              <ul className="type-progress" aria-label="Tiến độ theo loại việc">
                {p.byType.map((t) => (
                  <li key={t.type}>
                    <span>{TASK_TYPE_LABEL[t.type] || t.type}</span>
                    <div className="progress" aria-hidden="true">
                      <i style={{ width: `${(t.done / t.total) * 100}%` }} />
                    </div>
                    <b>
                      {t.done}/{t.total}
                    </b>
                  </li>
                ))}
              </ul>
            )}

            <div className="stats-strip" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
              <div>
                <strong>{report.content_published}</strong>
                <span>bài đã đăng lên Google</span>
              </div>
              <div>
                <strong>{p.pending}</strong>
                <span>việc còn lại</span>
              </div>
            </div>
          </>
        )}
      </Card>

      <Card>
        <div className="section-head">
          <div>
            <h2>Số liệu trên Google</h2>
            <p>Điểm đánh giá và số lượt đánh giá, so với lúc bắt đầu.</p>
          </div>
        </div>

        {report.has_enough_data ? (
          <>
            <div className="signal-grid two">
              <div>
                <span>Điểm đánh giá</span>
                <strong>
                  {report.metrics.rating.current ?? '—'}
                  {report.metrics.rating.baseline != null && <small> (từ {report.metrics.rating.baseline})</small>}
                </strong>
                <DeltaBadge value={report.metrics.rating.delta} />
              </div>
              <div>
                <span>Số lượt đánh giá</span>
                <strong>
                  {report.metrics.review_count.current ?? '—'}
                  {report.metrics.review_count.baseline != null && <small> (từ {report.metrics.review_count.baseline})</small>}
                </strong>
                <DeltaBadge value={report.metrics.review_count.delta} />
              </div>
            </div>
            <p className="rail-sub" style={{ margin: '16px 0 0' }}>
              So sánh dữ liệu ngày {fmtDate(report.baseline_captured_at)} với ngày {fmtDate(report.current_captured_at)}. Số liệu lấy từ trang Google Maps công khai của
              doanh nghiệp hoặc từ điểm bạn nhập khi kiểm tra hồ sơ, không phải con số ước tính.
            </p>
          </>
        ) : hasBaseline ? (
          <>
            <div className="signal-grid">
              <div>
                <span>Điểm đánh giá lúc bắt đầu</span>
                <strong>{report.metrics.rating.baseline ?? '—'}</strong>
              </div>
              <div>
                <span>Số lượt đánh giá lúc bắt đầu</span>
                <strong>{report.metrics.review_count.baseline ?? '—'}</strong>
              </div>
              <div>
                <span>Ghi nhận ngày</span>
                <strong>{fmtDate(report.baseline_captured_at)}</strong>
              </div>
            </div>
            <p className="rail-sub" style={{ margin: '16px 0 0' }}>
              Đây là mốc ban đầu của bạn. Số liệu Google thay đổi chậm, hãy kiểm tra lại hồ sơ sau 2–4 tuần để thấy khác biệt so với mốc này.
            </p>
            <div style={{ marginTop: 16 }}>
              <Link href={`/clients/${clientId}/audit`} className="secondary-button">
                Kiểm tra hồ sơ lại
              </Link>
            </div>
          </>
        ) : (
          <>
            <p className="rail-sub" style={{ margin: 0 }}>
              Chưa có mốc ban đầu. Khi kiểm tra hồ sơ, hãy điền điểm đánh giá và số lượt đánh giá. Hệ thống sẽ lưu làm mốc để bạn thấy sự thay đổi sau này.
            </p>
            <div style={{ marginTop: 16 }}>
              <Link href={`/clients/${clientId}/audit`} className="primary-button">
                Kiểm tra hồ sơ <ArrowRight size={18} />
              </Link>
            </div>
          </>
        )}
      </Card>
    </>
  )
}
