'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { Card } from '@/components/dashboard/shared'
import { useToast } from '@/components/dashboard/toast-context'
import { parseAuditResult } from '@/lib/audit-parse'
import { AuditResultView } from '@/components/dashboard/audit-result-view'
import type { SnapshotSummary } from '@/lib/gbp-audit-fields'

type DataInfo = {
  origin: 'cache' | 'live' | 'stored_after_failure'
  captured_at: string | null
  summary: SnapshotSummary
}

const ORIGIN_NOTE: Record<DataInfo['origin'], string> = {
  live: 'Vừa lấy từ Google Maps',
  cache: 'Dùng lại dữ liệu vừa lấy ít phút trước',
  stored_after_failure: 'Lần lấy mới thất bại — đang dùng dữ liệu đã lưu, có thể đã cũ',
}

export default function ClientAuditPage() {
  const router = useRouter()
  const { showToast } = useToast()
  const params = useParams<{ id: string }>()
  const clientId = params.id

  const [client, setClient] = useState<any>(null)
  const [loadingClient, setLoadingClient] = useState(true)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<string | null>(null)
  const [dataInfo, setDataInfo] = useState<DataInfo | null>(null)
  const [outputLanguage, setOutputLanguage] = useState('Tiếng Việt')
  const [note, setNote] = useState('')

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('/api/clients')
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Không tải được dữ liệu')
        const found = (Array.isArray(data) ? data : []).find((c: any) => c.id === clientId)
        if (!found) throw new Error('Không tìm thấy doanh nghiệp này')
        setClient(found)
      } catch (err: any) {
        setError(err.message || 'Có lỗi xảy ra')
      } finally {
        setLoadingClient(false)
      }
    }
    load()
  }, [clientId])

  async function handleRunAudit() {
    if (!client) return
    setError('')
    setRunning(true)
    setResult(null)
    setDataInfo(null)
    try {
      const res = await fetch('/api/audit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: client.id, output_language: outputLanguage, additional_info: note }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        const reason = data?.data?.source_error ? ` Chi tiết: ${data.data.source_error}` : ''
        throw new Error((data.error || 'Chưa kiểm tra được hồ sơ. Thử lại sau ít phút.') + reason)
      }
      setResult(data.audit_result || '')
      setDataInfo(data.data || null)
      showToast('Đã kiểm tra xong hồ sơ')
    } catch (err: any) {
      setError(err.message || 'Có lỗi xảy ra')
    } finally {
      setRunning(false)
    }
  }

  if (loadingClient) {
    return (
      <Card>
        <div className="empty-note">Đang tải…</div>
      </Card>
    )
  }
  if (!client) {
    return (
      <Card>
        <div className="empty-note error">{error || 'Không tìm thấy doanh nghiệp này'}</div>
      </Card>
    )
  }

  const summary = dataInfo?.summary

  return (
    <>
      <Card>
        <div className="title-line">
          <h2>Kiểm tra hồ sơ Google</h2>
        </div>
        <p>
          Cho <strong>{client.name}</strong>. Hệ thống tự lấy hồ sơ hiện tại trên Google Maps (qua Outscraper) rồi mới kiểm
          tra — bạn không cần nhập số liệu.
        </p>

        <div className="form-grid" style={{ marginTop: 16 }}>
          <label className="field">
            <span>Ngôn ngữ kết quả</span>
            <input value={outputLanguage} onChange={(e) => setOutputLanguage(e.target.value)} />
          </label>
          <label className="field wide">
            <span>Ghi chú thêm (không bắt buộc)</span>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              maxLength={2000}
              placeholder="Điều Google Maps không cho thấy, ví dụ: vừa đổi địa chỉ, đang chạy khuyến mãi…"
            />
          </label>
        </div>

        {error && (
          <div style={{ color: 'var(--danger)', background: 'var(--danger-soft)', padding: 12, borderRadius: 8, marginTop: 12 }}>
            {error}
          </div>
        )}

        <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <button className="primary-button" onClick={handleRunAudit} disabled={running}>
            {running && <Loader2 size={16} className="animate-spin" />}
            {running ? 'Đang lấy dữ liệu và kiểm tra…' : 'Kiểm tra hồ sơ'}
          </button>
          <button className="secondary-button" onClick={() => router.push(`/clients/${client.id}/plan`)}>
            Xem kế hoạch 30 ngày
          </button>
          {running && (
            <span style={{ fontSize: 12, color: 'var(--muted-foreground)' }}>
              Lấy hồ sơ và review từ Google Maps rồi chấm điểm, thường mất 30–90 giây. Bạn đừng tắt trang.
            </span>
          )}
        </div>

        {summary && dataInfo && (
          <div role="status" style={{ marginTop: 16, padding: 12, borderRadius: 8, background: 'var(--surface-muted, #f5f5f5)', fontSize: 13 }}>
            <strong>Dữ liệu Google Maps đã dùng</strong>
            <p style={{ margin: '6px 0' }}>
              {ORIGIN_NOTE[dataInfo.origin]}
              {dataInfo.captured_at ? ` · ${new Date(dataInfo.captured_at).toLocaleString('vi-VN')}` : ''}
            </p>
            <p style={{ margin: '6px 0' }}>
              {summary.rating != null ? `${summary.rating}★` : 'Chưa có sao'} · {summary.review_count ?? 0} đánh giá (đọc{' '}
              {summary.reviews_loaded} mới nhất) · Bài đăng: {summary.posts_count} · Mô tả:{' '}
              {summary.has_description ? 'có' : 'chưa đọc được'} · Giờ mở cửa: {summary.has_hours ? 'có' : 'chưa đọc được'}
            </p>
            {summary.unread.length > 0 && <p style={{ margin: '6px 0' }}>Chưa lấy được: {summary.unread.join(', ')}</p>}
            {summary.warnings.length > 0 && <p style={{ margin: '6px 0' }}>Lưu ý: {summary.warnings.join(' · ')}</p>}
          </div>
        )}
      </Card>

      {result && (
        <>
          <div className="section-head" style={{ marginTop: 8 }}>
            <div />
            <button className="primary-button" onClick={() => router.push(`/clients/${client.id}/plan`)}>
              Tạo kế hoạch 30 ngày
            </button>
          </div>
          <AuditResultView
            audit={parseAuditResult(result, {
              name: client.name,
              industry: client.industry,
              area: client.area,
              mapsUrl: client.gbp_link,
            })}
            rawFallback={result}
          />
        </>
      )}
    </>
  )
}
