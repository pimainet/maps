'use client'

// Báo cáo hằng tháng của gói Làm hộ (khách chỉ thấy các bản nhân viên ĐÃ gửi).
import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { Card } from '@/components/dashboard/shared'
import { ReportView } from '@/components/agency/report-view'
import { DONE_FOR_YOU_ENABLED } from '@/lib/features'
import { periodLabel, type MonthlyReport } from '@/lib/agency/report'

type Data = { client: { id: string; name: string }; periods: { period: string; sent_at: string }[]; selected: { period: string; sent_at: string; report: MonthlyReport } | null }

export default function MonthlyReportPage() {
  const { id } = useParams<{ id: string }>()
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState('')
  const [period, setPeriod] = useState<string | null>(null)

  useEffect(() => {
    if (!DONE_FOR_YOU_ENABLED) return
    setError('')
    const wanted = period ?? new URLSearchParams(window.location.search).get('period')
    fetch(`/api/agency/reports?client_id=${id}${wanted ? `&period=${wanted}` : ''}`)
      .then(async (r) => {
        const d = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(d.error || 'Không tải được báo cáo.')
        setData(d)
      })
      .catch((e) => setError(e.message))
  }, [id, period])

  if (!DONE_FOR_YOU_ENABLED) return <Card><div className="empty-note">Tính năng này chưa mở.</div></Card>
  if (error) return <Card><div className="alert alert-error">{error}</div></Card>
  if (!data) return <Card><div className="empty-note">Đang tải…</div></Card>

  return (
    <>
      <Card>
        <div className="section-head">
          <div><h2>Báo cáo hằng tháng</h2><p>Báo cáo được đội ngũ của chúng tôi gửi đầu mỗi tháng (gói Làm hộ).</p></div>
          <Link href={`/clients/${id}`} className="secondary-button">← Doanh nghiệp</Link>
        </div>
        {data.periods.length > 0 && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {data.periods.map((p) => (
              <button key={p.period} className={data.selected?.period === p.period ? 'primary-button' : 'secondary-button'} onClick={() => setPeriod(p.period)}>{periodLabel(p.period)}</button>
            ))}
          </div>
        )}
      </Card>
      {data.selected ? <ReportView report={data.selected.report} /> : <Card><div className="empty-note">Chưa có báo cáo nào được gửi. Báo cáo đầu tiên sẽ có vào đầu tháng sau.</div></Card>}
    </>
  )
}
