'use client'

// Nhân viên xem lại / tạo nháp / gửi báo cáo tháng cho 1 khách Làm hộ.
import { Suspense, useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Card } from '@/components/dashboard/shared'
import { useToast } from '@/components/dashboard/toast-context'
import { ReportView } from '@/components/agency/report-view'
import { addMonths, periodLabel, type MonthlyReport } from '@/lib/agency/report'

function Inner() {
  const sp = useSearchParams()
  const clientId = sp.get('client_id') || ''
  const { showToast } = useToast()
  const [period, setPeriod] = useState(sp.get('period') || '')
  const [data, setData] = useState<any>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setError('')
    const r = await fetch(`/api/admin/agency/report?client_id=${clientId}${period ? `&period=${period}` : ''}`)
    const d = await r.json().catch(() => ({}))
    if (!r.ok) return setError(d.error || 'Không tải được.')
    setData(d)
    if (!period) setPeriod(d.period)
  }, [clientId, period])
  useEffect(() => { load() }, [load])

  async function post(body: any, ok: (d: any) => string) {
    setBusy(true)
    try {
      const r = await fetch('/api/admin/agency/report', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const d = await r.json().catch(() => ({}))
      showToast(r.ok ? ok(d) : d.error || 'Lỗi')
      await load()
    } finally {
      setBusy(false)
    }
  }

  const saved = data?.saved
  const report: MonthlyReport | null = saved?.summary ?? data?.preview ?? null
  return (
    <>
      <Card>
        <div className="section-head">
          <div><h2>Báo cáo tháng{data ? ` · ${data.client.name}` : ''}</h2><p>Xem lại số liệu rồi bấm “Gửi cho khách”: khách chỉ thấy bản đã gửi.</p></div>
          <Link href="/agency" className="secondary-button">← Hàng đợi</Link>
        </div>
        {period && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <button className="secondary-button" onClick={() => setPeriod(addMonths(period, -1))}>←</button>
            <strong>{periodLabel(period)}</strong>
            <button className="secondary-button" onClick={() => setPeriod(addMonths(period, 1))}>→</button>
            <span style={{ fontSize: 13, color: 'var(--muted-foreground)' }}>
              {saved ? (saved.status === 'sent' ? `Đã gửi ${new Date(saved.sent_at).toLocaleString('vi-VN')}` : 'Bản nháp (khách chưa thấy)') : 'Bản xem trước (chưa lưu)'}
            </span>
          </div>
        )}
        {error && <div className="alert alert-error" style={{ marginTop: 12 }}>{error}</div>}
        {data && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
            {saved?.status !== 'sent' && <button className="secondary-button" disabled={busy} onClick={() => post({ action: 'generate', client_id: clientId, period }, () => 'Đã lưu bản nháp mới nhất.')}>{saved ? 'Tạo lại bản nháp' : 'Lưu thành bản nháp'}</button>}
            {saved?.status === 'draft' && <button className="primary-button" disabled={busy} onClick={() => confirm('Gửi báo cáo này cho khách (hiện trong app và email cho chủ/quản trị)?') && post({ action: 'send', report_id: saved.id }, (d) => (d.emailSkipped ? 'Đã công bố cho khách (chưa cấu hình email nên không gửi thư).' : `Đã gửi: ${d.emailed}/${d.recipients} email.`))}>Gửi cho khách</button>}
          </div>
        )}
      </Card>
      {report ? <ReportView report={report} /> : data && <Card><div className="empty-note">Không dựng được báo cáo cho kỳ này.</div></Card>}
    </>
  )
}

export default function AgencyReportPage() {
  return <Suspense fallback={<Card><div className="empty-note">Đang tải…</div></Card>}><Inner /></Suspense>
}
