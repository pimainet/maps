'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function NewClientPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState({
    name: '',
    industry: '',
    area: '',
    phone: '',
    contact_name: '',
    brand_voice: 'chuyên nghiệp, gần gũi',
    gbp_link: '',
    website_url: '',
    notes: '',
  })

  function update(key: string, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
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
        throw new Error(data.error || 'Không tạo được khách hàng')
      }

      // Chuyển sang trang chi tiết khách
      router.push(`/clients/${data.id}`)
    } catch (err: any) {
      setError(err.message || 'Có lỗi xảy ra')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: 24 }}>
      <h1 style={{ fontSize: 28, marginBottom: 8 }}>Thêm khách hàng</h1>
      <p style={{ color: '#666', marginBottom: 24 }}>
        Nhập thông tin doanh nghiệp để bắt đầu chu kỳ Local SEO.
      </p>

      <form onSubmit={handleSubmit} style={{ display: 'grid', gap: 16 }}>
        <label>
          <div style={{ marginBottom: 6, fontWeight: 600 }}>Tên doanh nghiệp *</div>
          <input
            required
            value={form.name}
            onChange={(e) => update('name', e.target.value)}
            placeholder="Ví dụ: Nha Khoa Tâm An"
            style={inputStyle}
          />
        </label>

        <label>
          <div style={{ marginBottom: 6, fontWeight: 600 }}>Ngành nghề</div>
          <input
            value={form.industry}
            onChange={(e) => update('industry', e.target.value)}
            placeholder="Ví dụ: Nha khoa"
            style={inputStyle}
          />
        </label>

        <label>
          <div style={{ marginBottom: 6, fontWeight: 600 }}>Khu vực</div>
          <input
            value={form.area}
            onChange={(e) => update('area', e.target.value)}
            placeholder="Ví dụ: Quận 3, TP.HCM"
            style={inputStyle}
          />
        </label>

        <label>
          <div style={{ marginBottom: 6, fontWeight: 600 }}>Số điện thoại</div>
          <input
            value={form.phone}
            onChange={(e) => update('phone', e.target.value)}
            placeholder="Ví dụ: 0901234567"
            style={inputStyle}
          />
        </label>

        <label>
          <div style={{ marginBottom: 6, fontWeight: 600 }}>Người liên hệ</div>
          <input
            value={form.contact_name}
            onChange={(e) => update('contact_name', e.target.value)}
            placeholder="Tên người phụ trách"
            style={inputStyle}
          />
        </label>

        <label>
          <div style={{ marginBottom: 6, fontWeight: 600 }}>Giọng văn thương hiệu</div>
          <input
            value={form.brand_voice}
            onChange={(e) => update('brand_voice', e.target.value)}
            placeholder="chuyên nghiệp, gần gũi"
            style={inputStyle}
          />
        </label>

        <label>
          <div style={{ marginBottom: 6, fontWeight: 600 }}>Link Google Business Profile</div>
          <input
            value={form.gbp_link}
            onChange={(e) => update('gbp_link', e.target.value)}
            placeholder="https://maps.google.com/..."
            style={inputStyle}
          />
        </label>

        <label>
          <div style={{ marginBottom: 6, fontWeight: 600 }}>Website</div>
          <input
            value={form.website_url}
            onChange={(e) => update('website_url', e.target.value)}
            placeholder="https://..."
            style={inputStyle}
          />
        </label>

        <label>
          <div style={{ marginBottom: 6, fontWeight: 600 }}>Ghi chú</div>
          <textarea
            value={form.notes}
            onChange={(e) => update('notes', e.target.value)}
            placeholder="Ghi chú thêm về khách hàng"
            rows={4}
            style={{ ...inputStyle, resize: 'vertical' }}
          />
        </label>

        {error ? (
          <div style={{ color: '#b91c1c', background: '#fef2f2', padding: 12, borderRadius: 8 }}>
            {error}
          </div>
        ) : null}

        <button
          type="submit"
          disabled={loading}
          style={{
            background: loading ? '#93c5fd' : '#2563eb',
            color: 'white',
            border: 'none',
            borderRadius: 8,
            padding: '12px 16px',
            fontWeight: 600,
            cursor: loading ? 'not-allowed' : 'pointer',
          }}
        >
          {loading ? 'Đang lưu...' : 'Lưu khách hàng'}
        </button>
      </form>
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  border: '1px solid #d1d5db',
  borderRadius: 8,
  fontSize: 14,
}