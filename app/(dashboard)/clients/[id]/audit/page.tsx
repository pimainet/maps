'use client'

import { snapshotToAuditFields, mergeGbpBlock } from '@/lib/gbp-audit-fields'
import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { Card } from '@/components/dashboard/shared'
import { useToast } from '@/components/dashboard/toast-context'
import { parseAuditResult } from '@/lib/audit-parse'
import { AuditResultView } from '@/components/dashboard/audit-result-view'

export default function ClientAuditPage() {
  const router = useRouter()
  const { showToast } = useToast()
  const params = useParams<{ id: string }>()
  const clientId = params.id

  const [client, setClient] = useState<any>(null)
  const [loadingClient, setLoadingClient] = useState(true)
  const [running, setRunning] = useState(false)
  const [fetching, setFetching] = useState(false)
  const [fetchDiagnostics, setFetchDiagnostics] = useState<any>(null)
  const [error, setError] = useState('')
  const [result, setResult] = useState<string | null>(null)
  const [form, setForm] = useState({
    output_language: 'Tiếng Việt',
    description: '',
    opening_hours: '',
    primary_category: '',
    additional_categories: '',
    review_count: '',
    rating: '',
    recent_posts: '',
    photos_status: '',
    additional_info: '',
  })

  function update(key: string, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('/api/clients')
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Không tải được dữ liệu')
        const found = (Array.isArray(data) ? data : []).find((c: any) => c.id === clientId)
        if (!found) throw new Error('Không tìm thấy doanh nghiệp này')
        setClient(found)
        setForm((prev) => ({
          ...prev,
          primary_category: found.industry || '',
        }))
      } catch (err: any) {
        setError(err.message || 'Có lỗi xảy ra')
      } finally {
        setLoadingClient(false)
      }
    }
    load()
  }, [clientId])

  async function handleAutoFetch() {
    if (!client) return
    setFetching(true)
    setError('')
    setFetchDiagnostics(null)
    try {
      const res = await fetch('/api/gbp-snapshot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: client.id, force: true }),
      })
      const data = await res.json()
      setFetchDiagnostics(data.diagnostics || null)

      if (!res.ok) throw new Error(data.error || 'Không lấy được dữ liệu')

      const s = data.snapshot || {}
      const f = snapshotToAuditFields(s)
      setForm((prev) => ({
        ...prev,
        description: f.description || prev.description,
        opening_hours: f.opening_hours || '',
        primary_category: f.primary_category || prev.primary_category,
        // chỉ điền khi trang Maps thực sự hiển thị danh mục phụ; không thì giữ nguyên ô đang có
        additional_categories: f.additional_categories || prev.additional_categories,
        review_count: f.review_count ?? prev.review_count,
        rating: f.rating ?? prev.rating,
        recent_posts: f.recent_posts || '',
        photos_status: f.photos_status || '',
        // thay khối dữ liệu Maps cũ (nếu có) thay vì nối thêm -> bấm nhiều lần không bị lặp
        additional_info: f.additional_info ? mergeGbpBlock(prev.additional_info, f.additional_info) : prev.additional_info,
      }))
      showToast(data.message || 'Đã chạy quan sát')
    } catch (err: any) {
      setError(err.message || 'Có lỗi khi lấy dữ liệu Google Maps')
    } finally {
      setFetching(false)
    }
  }

  async function handleRunAudit() {
    if (!client) return
    setError('')
    setRunning(true)
    setResult(null)
    try {
      const res = await fetch('/api/audit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: client.id,
          business_name: client.name,
          industry: client.industry || '',
          area: client.area || '',
          gbp_link: client.gbp_link || '',
          ...form,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Chưa kiểm tra được hồ sơ. Thử lại sau ít phút.')
      setResult(data.audit_result || '')
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

  return (
    <>
      <Card>
        <div className="title-line">
          <h2>Kiểm tra hồ sơ Google</h2>
        </div>
        <p>
          Cho <strong>{client.name}</strong>. Điền thông tin hồ sơ, hoặc để hệ thống tự lấy từ Google Maps.
        </p>
        <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <button className="secondary-button" onClick={handleAutoFetch} disabled={fetching}>
            {fetching && <Loader2 size={14} className="animate-spin" />}
            {fetching ? 'Đang lấy từ Google…' : 'Tự điền từ Google Maps'}
          </button>
          <button className="secondary-button" onClick={() => router.push(`/clients/${client.id}/plan`)}>
            Xem kế hoạch 30 ngày
          </button>
          {fetching && (
            <span style={{ fontSize: 12, color: 'var(--muted-foreground)' }}>
              Đang đọc hồ sơ trên Google Maps. Agent đọc từng tab (tổng quan, giới thiệu, đánh giá, bài đăng, ảnh) nên mất khoảng 1–2 phút, bạn đừng tắt trang.
            </span>
          )}
        </div>

        <div className="form-grid" style={{ marginTop: 16 }}>
          <label className="field">
            <span>Ngôn ngữ kết quả</span>
            <input value={form.output_language} onChange={(e) => update('output_language', e.target.value)} />
          </label>
          <label className="field wide">
            <span>Phần giới thiệu trên Google</span>
            <textarea value={form.description} onChange={(e) => update('description', e.target.value)} rows={3} />
          </label>
          <label className="field wide">
            <span>Giờ mở cửa trên Google Maps</span>
            <textarea value={form.opening_hours} onChange={(e) => update('opening_hours', e.target.value)} rows={2} placeholder="Sẽ được điền khi Google Maps cung cấp dữ liệu" />
          </label>
          <label className="field">
            <span>Danh mục chính</span>
            <input value={form.primary_category} onChange={(e) => update('primary_category', e.target.value)} />
          </label>
          <label className="field">
            <span>Danh mục phụ</span>
            <input value={form.additional_categories} onChange={(e) => update('additional_categories', e.target.value)} />
          </label>
          <label className="field">
            <span>Số đánh giá</span>
            <input value={form.review_count} onChange={(e) => update('review_count', e.target.value)} />
          </label>
          <label className="field">
            <span>Điểm trung bình</span>
            <input value={form.rating} onChange={(e) => update('rating', e.target.value)} />
          </label>
          <label className="field wide">
            <span>Tình trạng bài đăng gần đây</span>
            <textarea value={form.recent_posts} onChange={(e) => update('recent_posts', e.target.value)} rows={4} placeholder="Nội dung bài đăng và thời gian đăng sẽ hiển thị tại đây" />
          </label>
          <label className="field wide">
            <span>Tình trạng hình ảnh</span>
            <input value={form.photos_status} onChange={(e) => update('photos_status', e.target.value)} />
          </label>
          <label className="field wide">
            <span>Thông tin bổ sung</span>
            <textarea value={form.additional_info} onChange={(e) => update('additional_info', e.target.value)} rows={2} />
          </label>
        </div>

        {error && <div style={{ color: 'var(--danger)', background: 'var(--danger-soft)', padding: 12, borderRadius: 8, marginTop: 12 }}>{error}</div>}
        {fetchDiagnostics && (
          <div role="status" style={{ marginTop: 12, padding: 12, borderRadius: 8, background: 'var(--surface-muted, #f5f5f5)', fontSize: 13 }}>
            <strong>Kết quả đọc Google Maps</strong>
            <p style={{ margin: '6px 0' }}>
              Mô tả: {fetchDiagnostics.has_description ? 'đã đọc' : 'chưa đọc được'} · Bài đăng: {fetchDiagnostics.posts_count ?? 0} · Giờ mở cửa: {fetchDiagnostics.hours_strategy || (form.opening_hours ? 'đã đọc' : 'chưa đọc được')}
            </p>
            {fetchDiagnostics.coverage_sections && <p style={{ margin: '6px 0' }}>Các mục: {Object.entries(fetchDiagnostics.coverage_sections).map(([key, value]) => `${key}: ${value}`).join(' · ')}</p>}
            {Array.isArray(fetchDiagnostics.coverage_warnings) && fetchDiagnostics.coverage_warnings.length > 0 && <p style={{ margin: '6px 0' }}>Lưu ý: {fetchDiagnostics.coverage_warnings.join(' · ')}</p>}
          </div>
        )}

        <div style={{ marginTop: 16 }}>
          <button className="primary-button" onClick={handleRunAudit} disabled={running}>
            {running && <Loader2 size={16} className="animate-spin" />}
            {running ? 'Đang kiểm tra… (khoảng 10–20 giây)' : 'Kiểm tra hồ sơ'}
          </button>
        </div>
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
