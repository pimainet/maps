'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Users } from 'lucide-react'
import { Card } from '@/components/dashboard/shared'
import { useToast } from '@/components/dashboard/toast-context'

export default function NewClientPage() {
  const router = useRouter()
  const { showToast } = useToast()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [dupClientId, setDupClientId] = useState<string | null>(null)
  const [form, setForm] = useState({
    name: '',
    industry: '',
    area: '',
    phone: '',
    contact_name: '',
    brand_voice: 'chuyên nghiệp, gần gũi',
    gbp_link: '',
    place_id: '',
    website_url: '',
    notes: '',
  })

  function update(key: string, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  async function handleSubmit() {
    if (!form.name.trim()) {
      setError('Tên doanh nghiệp là bắt buộc')
      return
    }
    setError('')
    setLoading(true)

    try {
      const res = await fetch('/api/clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const data = await res.json()

      if (!res.ok) {
        if (res.status === 409 && data.existing_client?.id) {
          setError((data.error || 'Doanh nghiệp này đã tồn tại trong workspace.') + ' Bấm「Mở hồ sơ đã có」bên dưới.')
          setDupClientId(data.existing_client.id)
          throw new Error(data.error || 'Trùng Place/Link')
        }
        throw new Error(data.error || 'Không tạo được khách hàng')
      }

      showToast('Đã lưu khách hàng mới')
      router.push(`/clients/${data.id}`)
    } catch (err: any) {
      setError(err.message || 'Có lỗi xảy ra')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card className="form-card">
      <div className="form-intro">
        <div className="large-icon">
          <Users size={21} />
        </div>
        <div>
          <h2>Thông tin doanh nghiệp</h2>
          <p>Bắt đầu bằng những thông tin cơ bản để thiết lập chu kỳ Local SEO.</p>
        </div>
      </div>

      <div className="form-grid">
        <label className="field">
          <span>
            Tên doanh nghiệp <em>*</em>
          </span>
          <input value={form.name} onChange={(e) => update('name', e.target.value)} placeholder="Ví dụ: Nha khoa Tâm An" />
        </label>
        <label className="field">
          <span>Ngành nghề</span>
          <input value={form.industry} onChange={(e) => update('industry', e.target.value)} placeholder="Ví dụ: Nha khoa" />
        </label>
        <label className="field">
          <span>Khu vực</span>
          <input value={form.area} onChange={(e) => update('area', e.target.value)} placeholder="Ví dụ: Quận 3, TP.HCM" />
        </label>
        <label className="field">
          <span>Số điện thoại</span>
          <input value={form.phone} onChange={(e) => update('phone', e.target.value)} placeholder="0901 234 567" />
        </label>
        <label className="field">
          <span>Người liên hệ</span>
          <input value={form.contact_name} onChange={(e) => update('contact_name', e.target.value)} placeholder="Tên người phụ trách" />
        </label>
        <label className="field">
          <span>Giọng văn thương hiệu</span>
          <input value={form.brand_voice} onChange={(e) => update('brand_voice', e.target.value)} placeholder="Thân thiện, chuyên gia..." />
        </label>
        <label className="field wide">
          <span>Link Google Business Profile</span>
          <input value={form.gbp_link} onChange={(e) => update('gbp_link', e.target.value)} placeholder="https://maps.google.com/..." />
        </label>
        <label className="field wide">
          <span>Website (không bắt buộc)</span>
          <input value={form.website_url} onChange={(e) => update('website_url', e.target.value)} placeholder="https://" />
        </label>
        <label className="field wide">
          <span>Ghi chú</span>
          <textarea value={form.notes} onChange={(e) => update('notes', e.target.value)} placeholder="Thêm thông tin hữu ích về doanh nghiệp..." />
        </label>
      </div>

      {error && (
        <div style={{ color: '#b91c1c', background: '#fef2f2', padding: 12, borderRadius: 8, marginBottom: 16 }}>
          {error}
          {dupClientId && (
            <div style={{ marginTop: 8 }}>
              <button type="button" className="secondary-button" onClick={() => router.push(`/clients/${dupClientId}`)}>
                Mở hồ sơ đã có
              </button>
            </div>
          )}
        </div>
      )}

      <div className="form-actions">
        <button className="secondary-button" onClick={() => router.push('/clients')} disabled={loading}>
          Huỷ
        </button>
        <button className="primary-button" onClick={handleSubmit} disabled={loading}>
          {loading ? (
            'Đang lưu...'
          ) : (
            <>
              <Check size={17} /> Lưu khách hàng
            </>
          )}
        </button>
      </div>
    </Card>
  )
}
