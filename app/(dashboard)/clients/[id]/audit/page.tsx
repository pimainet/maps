'use client'

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
  const [error, setError] = useState('')
  const [result, setResult] = useState<string | null>(null)
  const [form, setForm] = useState({
    output_language: 'Tiếng Việt',
    description: '',
    primary_category: '',
    additional_categories: '',
    review_count: '',
    rating: '',
    recent_posts: 'Đăng đều hàng tuần',
    photos_status: 'Có ảnh mới trong 3 tháng',
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
        if (!found) throw new Error('Không tìm thấy khách hàng')
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
    try {
      const res = await fetch('/api/gbp-snapshot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: client.id, force: true }),
      })
      const data = await res.json()

      if (!res.ok) throw new Error(data.error || 'Không lấy được dữ liệu')

      const s = data.snapshot || {}
      setForm((prev) => ({
        ...prev,
        description: s.description || prev.description,
        primary_category: s.primary_category || prev.primary_category,
        review_count: s.review_count != null && s.review_count !== '' ? String(s.review_count) : prev.review_count,
        rating: s.rating != null && s.rating !== '' ? String(s.rating) : prev.rating,
        recent_posts: s.posts_signal || prev.recent_posts,
        photos_status: s.photos_signal || prev.photos_status,
        additional_info: [
          prev.additional_info,
          s.address_text ? `Địa chỉ (Maps): ${s.address_text}` : '',
          s.phone ? `SĐT (Maps): ${s.phone}` : '',
          Array.isArray(s.recent_posts) && s.recent_posts.length
            ? 'Bài đăng:\n' + s.recent_posts.map((p: any, i: number) => `${i + 1}. ${(p.text || '').slice(0, 120)}`).join('\n')
            : '',
        ]
          .filter(Boolean)
          .join('\n'),
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
      if (!res.ok) throw new Error(data.error || 'Audit thất bại')
      setResult(data.audit_result || '')
      showToast('Đã chạy Audit thành công')
    } catch (err: any) {
      setError(err.message || 'Có lỗi xảy ra')
    } finally {
      setRunning(false)
    }
  }

  if (loadingClient) {
    return (
      <Card>
        <div style={{ padding: 40, textAlign: 'center', color: '#6b7280' }}>Đang tải...</div>
      </Card>
    )
  }
  if (!client) {
    return (
      <Card>
        <div style={{ padding: 40, textAlign: 'center', color: '#b91c1c' }}>{error || 'Không tìm thấy khách hàng'}</div>
      </Card>
    )
  }

  return (
    <>
      <Card>
        <div className="title-line">
          <h2>Audit Google Business Profile</h2>
        </div>
        <p>
          Doanh nghiệp: <strong>{client.name}</strong>
          {client.place_id ? (
            <>
              {' '}
              · Place ID: <code>{client.place_id}</code>
            </>
          ) : null}
        </p>
        <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <button className="secondary-button" onClick={handleAutoFetch} disabled={fetching}>
            {fetching && <Loader2 size={14} className="animate-spin" />}
            {fetching ? 'Đang lấy từ Google...' : 'Tự điền từ Google Maps'}
          </button>
          <button className="secondary-button" onClick={() => router.push(`/clients/${client.id}/plan`)}>
            Sang lộ trình 30 ngày
          </button>
          {fetching && (
            <span style={{ fontSize: 12, color: '#6b7280' }}>
              Đang mở trình duyệt thật để đọc hồ sơ Google Maps — có thể mất 20–40 giây, đừng tắt trang.
            </span>
          )}
        </div>

        <div className="form-grid" style={{ marginTop: 16 }}>
          <label className="field">
            <span>Ngôn ngữ đầu ra</span>
            <input value={form.output_language} onChange={(e) => update('output_language', e.target.value)} />
          </label>
          <label className="field wide">
            <span>Mô tả trên GBP</span>
            <textarea value={form.description} onChange={(e) => update('description', e.target.value)} rows={3} />
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
            <input value={form.recent_posts} onChange={(e) => update('recent_posts', e.target.value)} />
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

        {error && <div style={{ color: '#b91c1c', background: '#fef2f2', padding: 12, borderRadius: 8, marginTop: 12 }}>{error}</div>}

        <div style={{ marginTop: 16 }}>
          <button className="primary-button" onClick={handleRunAudit} disabled={running}>
            {running && <Loader2 size={16} className="animate-spin" />}
            {running ? 'Đang audit... (khoảng 10-20 giây)' : 'Chạy Audit'}
          </button>
        </div>
      </Card>

      {result && (
        <>
          <div className="section-head" style={{ marginTop: 8 }}>
            <div />
            <button className="primary-button" onClick={() => router.push(`/clients/${client.id}/plan`)}>
              Lập lộ trình 30 ngày
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
