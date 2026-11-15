'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Pencil } from 'lucide-react'
import { Card } from '@/components/dashboard/shared'
import { useToast } from '@/components/dashboard/toast-context'
import { PlacePicker } from '@/components/dashboard/place-picker'

const FIELDS = ['name', 'industry', 'area', 'phone', 'contact_name', 'brand_voice', 'website_url', 'gbp_link', 'place_id', 'notes'] as const
type Form = Record<(typeof FIELDS)[number], string>

function toForm(c: any): Form {
  const f = {} as Form
  for (const k of FIELDS) f[k] = (c?.[k] ?? '') as string
  return f
}

/** Thẻ "Thông tin doanh nghiệp": xem + sửa. Chỉ gửi những trường thực sự đã đổi. */
export function ClientInfoCard({ client, onSaved }: { client: any; onSaved: (c: any) => void }) {
  const router = useRouter()
  const { showToast } = useToast()
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState<Form>(() => toForm(client))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [fieldError, setFieldError] = useState('')
  const [dupId, setDupId] = useState<string | null>(null)
  const [needConfirm, setNeedConfirm] = useState(false)
  const [picked, setPicked] = useState(false) // true: link/place_id đến từ danh sách chọn (đáng tin), false: người dùng tự gõ link

  const original = toForm(client)
  const changed = FIELDS.filter((k) => form[k].trim() !== original[k].trim())
  const linkChanged = changed.includes('gbp_link') || changed.includes('place_id')

  function startEdit() {
    setForm(toForm(client))
    setError('')
    setFieldError('')
    setDupId(null)
    setNeedConfirm(false)
    setPicked(false)
    setEditing(true)
  }

  function update(k: keyof Form, v: string) {
    setForm((f) => ({ ...f, [k]: v }))
    setNeedConfirm(false)
  }

  async function save(confirmPlaceChange = false) {
    setSaving(true)
    setError('')
    setFieldError('')
    setDupId(null)
    try {
      const body: Record<string, unknown> = {}
      for (const k of changed) body[k] = form[k].trim()
      // Link đổi mà không chọn quán từ danh sách: không gửi place_id cũ đi kèm (server tự suy ra từ link mới).
      // Chọn từ danh sách: luôn gửi kèm place_id của quán đã chọn (kể cả khi trùng quán hiện tại, để không bị coi là đổi quán).
      if (picked && form.place_id.trim()) body.place_id = form.place_id.trim()
      else delete body.place_id
      if (confirmPlaceChange) body.confirm_place_change = true
      const res = await fetch(`/api/clients/${client.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (res.status === 409 && data.code === 'PLACE_CHANGE_NEEDS_CONFIRM') {
        setNeedConfirm(true)
        return
      }
      if (!res.ok) {
        if (data.code === 'DUPLICATE_PLACE' && data.existing_client?.id) setDupId(data.existing_client.id)
        if (data.field) setFieldError(data.field)
        throw new Error(data.error || 'Không lưu được. Vui lòng thử lại.')
      }
      onSaved(data.client)
      setEditing(false)
      setNeedConfirm(false)
      showToast(
        data.changed_place
          ? 'Đã đổi sang doanh nghiệp mới. Dữ liệu Google Maps của hồ sơ cũ sẽ không còn dùng nữa — hãy chạy audit mới.'
          : 'Đã lưu thông tin doanh nghiệp.',
      )
    } catch (e: any) {
      setError(e.message || 'Không lưu được. Vui lòng thử lại.')
    } finally {
      setSaving(false)
    }
  }

  function onSubmit() {
    if (changed.length === 0) {
      setEditing(false)
      return
    }
    if (linkChanged && !needConfirm) {
      // Chưa biết có đổi "quán" hay chỉ sửa cách viết link: để server quyết định, nó sẽ đòi xác nhận nếu cần.
      save(false)
      return
    }
    save(needConfirm)
  }

  if (!editing) {
    return (
      <Card>
        <div className="section-head">
          <div>
            <h2>Thông tin doanh nghiệp</h2>
            <p>Dùng để viết bài đúng với doanh nghiệp của bạn.</p>
          </div>
          <button className="secondary-button" onClick={startEdit}>
            <Pencil size={14} /> Sửa thông tin
          </button>
        </div>
        <div className="signal-grid">
          <div><span>Ngành nghề</span><strong>{client.industry || '—'}</strong></div>
          <div><span>Khu vực</span><strong>{client.area || '—'}</strong></div>
          <div><span>Số điện thoại</span><strong>{client.phone || '—'}</strong></div>
          <div><span>Người liên hệ</span><strong>{client.contact_name || '—'}</strong></div>
          <div><span>Giọng văn</span><strong>{client.brand_voice || '—'}</strong></div>
          <div><span>Website</span><strong>{client.website_url || '—'}</strong></div>
        </div>
        {client.gbp_link && (
          <div style={{ marginTop: 16 }}>
            <span style={{ color: 'var(--muted-foreground)', fontSize: 13 }}>Hồ sơ Google: </span>
            <a href={client.gbp_link} target="_blank" rel="noreferrer" style={{ color: 'var(--primary)' }}>
              {client.gbp_link}
            </a>
          </div>
        )}
        {client.notes && (
          <div style={{ marginTop: 12, color: 'var(--muted-foreground)', fontSize: 14 }}>
            <strong>Ghi chú:</strong> {client.notes}
          </div>
        )}
      </Card>
    )
  }

  const bad = (k: string) => (fieldError === k ? { borderColor: 'var(--danger)' } : undefined)
  return (
    <Card>
      <div className="section-head">
        <div>
          <h2>Sửa thông tin doanh nghiệp</h2>
          <p>Điền nhầm hay có thay đổi đều sửa được. Chỉ phần bạn đổi mới được lưu.</p>
        </div>
      </div>
      <div className="form-grid">
        <label className="field">
          <span>Tên doanh nghiệp <em>*</em></span>
          <input value={form.name} style={bad('name')} onChange={(e) => update('name', e.target.value)} />
        </label>
        <label className="field">
          <span>Ngành nghề</span>
          <input value={form.industry} style={bad('industry')} onChange={(e) => update('industry', e.target.value)} />
        </label>
        <label className="field">
          <span>Khu vực</span>
          <input value={form.area} style={bad('area')} onChange={(e) => update('area', e.target.value)} />
        </label>
        <label className="field">
          <span>Số điện thoại</span>
          <input value={form.phone} style={bad('phone')} onChange={(e) => update('phone', e.target.value)} />
        </label>
        <label className="field">
          <span>Người liên hệ</span>
          <input value={form.contact_name} style={bad('contact_name')} onChange={(e) => update('contact_name', e.target.value)} />
        </label>
        <label className="field">
          <span>Website</span>
          <input value={form.website_url} style={bad('website_url')} onChange={(e) => update('website_url', e.target.value)} placeholder="https://" />
        </label>
        <PlacePicker
          initialQuery={[client.name, client.area].filter(Boolean).join(' ')}
          selected={{ name: client.name, address: client.area }}
          onSelect={(c) => {
            setForm((f) => ({ ...f, gbp_link: c.maps_url, place_id: c.place_id }))
            setPicked(true)
            setNeedConfirm(false)
          }}
        />
        <details className="field wide">
          <summary style={{ cursor: 'pointer' }}>Nâng cao: dán link Google Maps</summary>
          <label className="field wide">
            <span>Link Google Maps</span>
            <input value={form.gbp_link} style={bad('gbp_link')} onChange={(e) => {
              setPicked(false)
              setForm((f) => ({ ...f, gbp_link: e.target.value, place_id: client.place_id ?? '' }))
            }} placeholder="https://maps.app.goo.gl/…" />
          </label>
        </details>
        <label className="field wide">
          <span>Giọng văn thương hiệu</span>
          <textarea value={form.brand_voice} style={bad('brand_voice')} onChange={(e) => update('brand_voice', e.target.value)} />
        </label>
        <label className="field wide">
          <span>Ghi chú</span>
          <textarea value={form.notes} style={bad('notes')} onChange={(e) => update('notes', e.target.value)} />
        </label>
      </div>

      {linkChanged && !needConfirm && (
        <div style={{ color: 'var(--muted-foreground)', fontSize: 13, marginBottom: 12 }}>
          Nếu link mới trỏ tới một doanh nghiệp khác trên Google Maps, bạn sẽ được hỏi xác nhận trước khi lưu.
        </div>
      )}
      {needConfirm && (
        <div style={{ background: 'var(--warning-soft, #fff7e6)', padding: 12, borderRadius: 8, marginBottom: 16, fontSize: 14 }}>
          <strong>Link này trỏ tới một doanh nghiệp khác trên Google Maps.</strong>
          <ul style={{ margin: '8px 0 0 18px' }}>
            <li>Dữ liệu Maps đã lưu của hồ sơ cũ (đối thủ, lịch sử review) sẽ không còn dùng cho hồ sơ này.</li>
            <li>Audit cũ vẫn được giữ nhưng không so sánh điểm với audit mới.</li>
            <li>Hạn mức audit tính theo từng doanh nghiệp Google Maps nên không được làm mới khi đổi link.</li>
            <li>Mỗi hồ sơ chỉ đổi được tối đa 2 lần/30 ngày. Nếu chỉ lỡ nhập sai link, hãy sửa ngay bây giờ.</li>
          </ul>
        </div>
      )}
      {error && (
        <div style={{ color: 'var(--danger)', background: 'var(--danger-soft)', padding: 12, borderRadius: 8, marginBottom: 16 }}>
          {error}
          {dupId && (
            <div style={{ marginTop: 8 }}>
              <button type="button" className="secondary-button" onClick={() => router.push(`/clients/${dupId}`)}>
                Mở hồ sơ đã có
              </button>
            </div>
          )}
        </div>
      )}
      <div className="form-actions">
        <button className="secondary-button" onClick={() => setEditing(false)} disabled={saving}>Hủy</button>
        <button className="primary-button" onClick={onSubmit} disabled={saving || changed.length === 0}>
          {saving ? 'Đang lưu…' : needConfirm ? 'Xác nhận đổi & lưu' : 'Lưu thay đổi'}
        </button>
      </div>
    </Card>
  )
}
