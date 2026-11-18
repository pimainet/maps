'use client'

import { useEffect, useState } from 'react'
import { Card } from '@/components/dashboard/shared'
import { useToast } from '@/components/dashboard/toast-context'

type Catalog = { plan: 'basic' | 'full'; label: string; monthly: number; entitlements: any; prices: { months: number; amount: number }[] }
type PlanInfo = { plan: string; label: string; period_end: string | null; scheduled: { plan: string; start: string } | null; catalog: Catalog[] }
type Transfer = { bank_id: string; account_no: string; account_name: string; amount: number; content: string; qr_url: string }

const vnd = (n: number) => n.toLocaleString('vi-VN') + 'đ'
const date = (s: string | null) => (s ? new Date(s).toLocaleDateString('vi-VN') : '')

const FEATURES: Record<'basic' | 'full', string[]> = {
  basic: ['Kế hoạch 30 ngày đầy đủ và danh sách việc', 'Mô tả mẫu + danh mục phụ có bằng chứng', 'Theo dõi tiến độ từng việc', '1 quán'],
  full: ['Mọi thứ của gói Cơ bản', 'Cảnh báo khi có đánh giá thấp sao', 'Theo dõi thứ hạng trên Google Maps', '1 quán'],
}

export default function BillingPage() {
  const { showToast } = useToast()
  const [info, setInfo] = useState<PlanInfo | null>(null)
  const [error, setError] = useState('')
  const [plan, setPlan] = useState<'basic' | 'full'>('basic')
  const [months, setMonths] = useState(1)
  const [busy, setBusy] = useState(false)
  const [transfer, setTransfer] = useState<Transfer | null>(null)
  const [admin, setAdmin] = useState<any[] | null>(null)
  const [paid, setPaid] = useState<Record<number, string>>({})

  async function load() {
    const res = await fetch('/api/billing/plan')
    const data = await res.json().catch(() => ({}))
    if (!res.ok) return setError(data.error || 'Không tải được thông tin gói.')
    setInfo(data)
    const a = await fetch('/api/admin/billing/activate')
    if (a.ok) setAdmin((await a.json()).orders || [])
  }
  useEffect(() => { load() }, [])

  async function createOrder() {
    setBusy(true)
    setError('')
    try {
      const res = await fetch('/api/billing/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ plan, months }) })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Không tạo được đơn.')
      setTransfer(data.transfer)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  async function activate(orderCode: number, fallback: number) {
    const amount = Number(paid[orderCode] || fallback)
    const res = await fetch('/api/admin/billing/activate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ order_code: orderCode, paid_amount: amount }) })
    const data = await res.json().catch(() => ({}))
    showToast(res.ok ? `Kết quả: ${data.result}` : data.error || 'Lỗi')
    load()
  }

  if (!info) return <Card><div className="empty-note">{error || 'Đang tải…'}</div></Card>
  const chosen = info.catalog.find((c) => c.plan === plan)!
  const price = chosen.prices.find((p) => p.months === months)!.amount

  return (
    <>
      <Card>
        <div className="section-head">
          <div>
            <h2>Gói của bạn: {info.label}</h2>
            <p>
              {info.period_end ? `Dùng đến ${date(info.period_end)}.` : 'Gói miễn phí: xem kết quả kiểm tra và 3 việc đầu tiên.'}
              {info.scheduled ? ` Gói mới áp dụng từ ${date(info.scheduled.start)}.` : ''}
            </p>
          </div>
        </div>
      </Card>

      <Card>
        <div className="section-head"><div><h2>Chọn gói</h2><p>Mỗi gói dùng cho 1 quán. Đổi sang gói khác sẽ áp dụng từ kỳ sau, không tính lại tiền giữa kỳ.</p></div></div>
        <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))' }}>
          {info.catalog.map((c) => (
            <button key={c.plan} type="button" onClick={() => setPlan(c.plan)} aria-pressed={plan === c.plan}
              style={{ textAlign: 'left', padding: 16, borderRadius: 14, border: plan === c.plan ? '2px solid var(--primary, #2563eb)' : '1px solid var(--border, #e4e4e7)', background: 'transparent', cursor: 'pointer', color: 'inherit' }}>
              <strong style={{ fontSize: 16 }}>{c.label}</strong>
              <div style={{ fontSize: 22, fontWeight: 700, margin: '6px 0' }}>{vnd(c.monthly)}<small style={{ fontSize: 13, fontWeight: 400 }}> / tháng</small></div>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.6 }}>{FEATURES[c.plan].map((f) => <li key={f}>{f}</li>)}</ul>
            </button>
          ))}
        </div>

        <div role="radiogroup" aria-label="Kỳ hạn" style={{ display: 'flex', gap: 8, margin: '16px 0', flexWrap: 'wrap' }}>
          {chosen.prices.map((p) => (
            <button key={p.months} type="button" role="radio" aria-checked={months === p.months} onClick={() => setMonths(p.months)}
              className={months === p.months ? 'primary-button' : 'secondary-button'}>
              {p.months} tháng · {vnd(p.amount)}
            </button>
          ))}
        </div>
        <p style={{ fontSize: 13, color: 'var(--muted-foreground)', margin: '0 0 12px' }}>
          Trả trước bằng chuyển khoản, không tự động trừ tiền. Tặng kèm: bảng QR đánh giá bằng gỗ (khách quét là vào thẳng trang đánh giá của quán) và bộ mẫu tin nhắn xin đánh giá.
        </p>
        <button className="primary-button" onClick={createOrder} disabled={busy}>{busy ? 'Đang tạo…' : `Lấy mã chuyển khoản ${vnd(price)}`}</button>
        {error && <div className="alert alert-error" style={{ marginTop: 12 }}>{error}</div>}
      </Card>

      {transfer && (
        <Card>
          <div className="section-head"><div><h2>Chuyển khoản</h2><p>Gói được bật sau khi mình xác nhận đã nhận tiền (thường trong ngày). Chuyển đúng số tiền và đúng nội dung.</p></div></div>
          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'flex-start' }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={transfer.qr_url} alt="Mã QR chuyển khoản" width={220} height={220} style={{ borderRadius: 12, border: '1px solid var(--border,#e4e4e7)' }} />
            <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '6px 14px', fontSize: 14 }}>
              <dt>Ngân hàng</dt><dd>{transfer.bank_id}</dd>
              <dt>Số tài khoản</dt><dd>{transfer.account_no}</dd>
              <dt>Chủ tài khoản</dt><dd>{transfer.account_name}</dd>
              <dt>Số tiền</dt><dd><strong>{vnd(transfer.amount)}</strong></dd>
              <dt>Nội dung</dt><dd><strong>{transfer.content}</strong></dd>
            </dl>
          </div>
        </Card>
      )}

      {admin && (
        <Card>
          <div className="section-head"><div><h2>Đơn chờ xác nhận (chỉ bạn thấy)</h2><p>Chỉ bấm sau khi đã thấy tiền vào tài khoản. Nhập số tiền thực nhận; lệch số tiền đơn thì hệ thống không kích hoạt.</p></div></div>
          {admin.length === 0 && <div className="empty-note">Không có đơn chờ.</div>}
          {admin.map((o) => (
            <div key={o.order_code} className="client-row" style={{ gap: 12, flexWrap: 'wrap' }}>
              <div className="row-main">
                <strong>{o.workspace?.name || o.workspace_id} · {o.plan} {o.period_months} tháng</strong>
                <span>LGOS{o.order_code} · {vnd(o.amount_vnd)} · {o.status}</span>
              </div>
              <input inputMode="numeric" placeholder={String(o.amount_vnd)} value={paid[o.order_code] ?? ''} onChange={(e) => setPaid({ ...paid, [o.order_code]: e.target.value })} style={{ width: 120 }} aria-label="Số tiền thực nhận" />
              <button className="primary-button" onClick={() => activate(o.order_code, o.amount_vnd)}>Đã nhận tiền</button>
            </div>
          ))}
        </Card>
      )}
    </>
  )
}
