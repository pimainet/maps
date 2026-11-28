'use client'

// Thẻ gói "Làm hộ" trên /billing: mô tả phạm vi + nút "Liên hệ tư vấn" (không thanh toán tự phục vụ).
import { useEffect, useState } from 'react'
import { Card } from '@/components/dashboard/shared'
import { useToast } from '@/components/dashboard/toast-context'

const vnd = (n: number) => n.toLocaleString('vi-VN') + 'đ'

export const DONE_FOR_YOU_SCOPE = [
  'Chúng tôi đăng bài kèm ảnh lên Google Maps đều đặn cho bạn',
  'Trả lời tất cả đánh giá của khách (kể cả đánh giá tốt)',
  'Tối ưu hồ sơ Google theo kết quả kiểm tra, từng việc một',
  'Báo cáo thứ hạng trên bản đồ hằng tháng gửi qua email',
  'Bạn không cần duyệt: đội ngũ của chúng tôi duyệt và đăng thay bạn',
  'Có sẵn mọi tính năng của gói Nâng cao (bản đồ thứ hạng 7x7, 10 từ khoá, quét hàng tuần)',
]

type Req = { id: string; status: string; created_at: string } | null

export function ConsultCard({ monthly, currentPlan, periodEnd }: { monthly: number; currentPlan: string; periodEnd: string | null }) {
  const { showToast } = useToast()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [existing, setExisting] = useState<Req>(null)
  const [form, setForm] = useState({ contact_name: '', phone: '', email: '', business_name: '', message: '' })
  const mine = currentPlan === 'done_for_you'

  useEffect(() => {
    fetch('/api/billing/consultation')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d?.open && setExisting(d.request))
      .catch(() => {})
  }, [])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const res = await fetch('/api/billing/consultation', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d.error || 'Không gửi được yêu cầu.')
      setExisting(d.request || { id: 'x', status: 'new', created_at: new Date().toISOString() })
      setOpen(false)
      showToast(d.already ? 'Chúng tôi đã nhận yêu cầu của bạn trước đó và sẽ liên hệ sớm.' : 'Đã gửi yêu cầu. Chúng tôi sẽ liên hệ bạn sớm.')
    } catch (err: any) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm((f) => ({ ...f, [k]: e.target.value }))

  return (
    <Card>
      <div className="section-head">
        <div>
          <h2>Gói Làm hộ · {vnd(monthly)} / tháng</h2>
          <p>Bạn không phải tự làm: đội ngũ của chúng tôi vận hành Google Maps cho doanh nghiệp của bạn.</p>
        </div>
      </div>
      <ul style={{ margin: '0 0 12px', paddingLeft: 18, fontSize: 14, lineHeight: 1.7 }}>
        {DONE_FOR_YOU_SCOPE.map((f) => <li key={f}>{f}</li>)}
      </ul>
      {mine && <p style={{ fontSize: 13, margin: '0 0 12px' }}>Bạn đang dùng gói Làm hộ{periodEnd ? `, đến ${new Date(periodEnd).toLocaleDateString('vi-VN')}` : ''}. Muốn gia hạn, hãy liên hệ để chúng tôi tạo đơn thanh toán cho bạn.</p>}
      {existing && !open ? (
        <div className="alert" style={{ marginBottom: 0 }}>
          Chúng tôi đã nhận yêu cầu tư vấn của bạn ({new Date(existing.created_at).toLocaleDateString('vi-VN')}) và sẽ liên hệ sớm. Khi chốt, chúng tôi gửi đơn thanh toán (mã QR) cho bạn và hiện ở mục “Lịch sử thanh toán” bên dưới.
        </div>
      ) : !open ? (
        <button className="primary-button" onClick={() => setOpen(true)}>{mine ? 'Liên hệ gia hạn' : 'Liên hệ tư vấn'}</button>
      ) : (
        <form onSubmit={submit} style={{ display: 'grid', gap: 10, maxWidth: 460 }}>
          <label className="field">Tên người liên hệ *<input required maxLength={120} value={form.contact_name} onChange={set('contact_name')} style={{ width: '100%' }} /></label>
          <label className="field">Số điện thoại / Zalo *<input required inputMode="tel" placeholder="0901234567" value={form.phone} onChange={set('phone')} style={{ width: '100%' }} /></label>
          <label className="field">Email<input type="email" maxLength={200} value={form.email} onChange={set('email')} style={{ width: '100%' }} /></label>
          <label className="field">Tên doanh nghiệp<input maxLength={200} value={form.business_name} onChange={set('business_name')} style={{ width: '100%' }} /></label>
          <label className="field">Bạn muốn được hỗ trợ gì?<textarea rows={3} maxLength={2000} value={form.message} onChange={set('message')} style={{ width: '100%' }} /></label>
          {error && <div className="alert alert-error">{error}</div>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="primary-button" disabled={busy}>{busy ? 'Đang gửi…' : 'Gửi yêu cầu'}</button>
            <button type="button" className="secondary-button" onClick={() => setOpen(false)}>Đóng</button>
          </div>
          <p style={{ fontSize: 12, color: 'var(--muted-foreground)', margin: 0 }}>Chúng tôi liên hệ tư vấn trước, sau đó mới gửi thông tin thanh toán. Bạn chưa bị tính phí khi gửi yêu cầu này.</p>
        </form>
      )}
    </Card>
  )
}
