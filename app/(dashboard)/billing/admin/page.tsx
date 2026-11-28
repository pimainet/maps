'use client'

// Đối soát thanh toán (chỉ Super Admin; API tự chặn người khác).
// Hàng chờ = khoản tiền vào cần người xem: không khớp mã đơn, thiếu tiền, dư tiền (cần hoàn phần dư), trả cho đơn đã trả...
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Card } from '@/components/dashboard/shared'
import { useToast } from '@/components/dashboard/toast-context'

const vnd = (n: number | null | undefined) => `${Number(n || 0).toLocaleString('vi-VN')}đ`
const time = (s: string | null) => (s ? new Date(s).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }) : '')

function reasonLabel(t: any): string {
  const r: string = t.reason || ''
  if (r.startsWith('overpaid:')) return r.endsWith(':refunded') ? `Dư ${vnd(Number(r.split(':')[1]))} — đã hoàn` : `Dư ${vnd(Number(r.split(':')[1]))} — đơn đã kích hoạt, cần hoàn phần dư`
  if (r.startsWith('underpaid:')) return `Thiếu ${vnd(Number(r.split(':')[1]))} — đơn chưa kích hoạt`
  return (
    {
      no_code: 'Không có mã đơn trong nội dung',
      code_not_found: 'Mã đơn không tồn tại',
      tolerant_code_amount_mismatch: 'Mã đoán gần đúng nhưng số tiền khác đơn',
      order_already_paid: 'Đơn này đã trả trước đó (chuyển trùng?)',
      order_refunded: 'Đơn đã hoàn tiền',
      workspace_deleted: 'Workspace của đơn đã bị xoá',
      same_bank_ref_other_provider: 'Trùng giao dịch từ nhà cung cấp khác',
    } as Record<string, string>
  )[r] || r || t.status
}

const STATUS: Record<string, string> = {
  matched: 'Đã khớp', partial: 'Thiếu tiền', unmatched: 'Chưa khớp', needs_review: 'Cần xem', duplicate: 'Trùng',
  ignored: 'Bỏ qua', refunded: 'Đã hoàn', received: 'Mới nhận',
}

export default function BillingAdminPage() {
  const { showToast } = useToast()
  const [view, setView] = useState<'attention' | 'recent'>('attention')
  const [items, setItems] = useState<any[] | null>(null)
  const [orders, setOrders] = useState<any[]>([])
  const [error, setError] = useState('')
  const [code, setCode] = useState<Record<string, string>>({})
  const [note, setNote] = useState<Record<string, string>>({})
  const [paid, setPaid] = useState<Record<number, string>>({})
  const [busy, setBusy] = useState<string | null>(null)

  async function load(v = view) {
    setError('')
    const [t, o] = await Promise.all([fetch(`/api/admin/billing/transactions?view=${v}`), fetch('/api/admin/billing/activate')])
    const td = await t.json().catch(() => ({}))
    if (!t.ok) {
      setItems([])
      return setError(td.error || 'Không tải được (cần quyền Super Admin, và migration 030 đã áp dụng).')
    }
    setItems(td.items || [])
    if (o.ok) setOrders((await o.json()).orders || [])
  }
  useEffect(() => { load(view) }, [view])

  async function act(t: any, action: 'assign' | 'ignore' | 'refund' | 'ack', orderCode?: string) {
    if (action === 'ignore' && !confirm('Đánh dấu khoản này KHÔNG phải tiền của dịch vụ?')) return
    if (action === 'refund' && !confirm('Xác nhận bạn ĐÃ chuyển hoàn tiền cho khách?')) return
    setBusy(t.id)
    try {
      const res = await fetch('/api/admin/billing/transactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tx_id: t.id, action, order_code: orderCode ?? code[t.id], note: note[t.id] }),
      })
      const d = await res.json().catch(() => ({}))
      showToast(res.ok ? `Kết quả: ${d.result}` : d.error || 'Lỗi')
      load()
    } finally {
      setBusy(null)
    }
  }

  async function activate(orderCode: number, fallback: number) {
    const amount = Number(paid[orderCode] || fallback)
    if (!confirm(`Ghi nhận đã nhận ${vnd(amount)} cho LGOS${orderCode}? Chỉ dùng khi tiền đã vào mà hệ thống không tự bắt được.`)) return
    const res = await fetch('/api/admin/billing/activate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ order_code: orderCode, paid_amount: amount }) })
    const d = await res.json().catch(() => ({}))
    showToast(res.ok ? `Kết quả: ${d.result}` : d.error || 'Lỗi')
    load()
  }

  return (
    <>
      <Card>
        <div className="section-head">
          <div>
            <h2>Đối soát thanh toán</h2>
            <p>Tiền vào được ghi sổ và tự khớp theo mã LGOS… Khoản nào máy không chắc sẽ nằm ở đây. Không bao giờ tự gán đơn chỉ dựa vào số tiền.</p>
          </div>
          <Link href="/billing" className="secondary-button">← Gói dịch vụ</Link>
        </div>
        <div role="tablist" style={{ display: 'flex', gap: 8 }}>
          <button role="tab" aria-selected={view === 'attention'} className={view === 'attention' ? 'primary-button' : 'secondary-button'} onClick={() => setView('attention')}>Cần xử lý</button>
          <button role="tab" aria-selected={view === 'recent'} className={view === 'recent' ? 'primary-button' : 'secondary-button'} onClick={() => setView('recent')}>100 khoản gần nhất</button>
        </div>
        {error && <div className="alert alert-error" style={{ marginTop: 12 }}>{error}</div>}
      </Card>

      <Card>
        {items === null && <div className="empty-note">Đang tải…</div>}
        {items?.length === 0 && !error && <div className="empty-note">{view === 'attention' ? 'Không có khoản nào cần xử lý.' : 'Chưa có giao dịch.'}</div>}
        {items?.map((t) => (
          <div key={t.id} className="client-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
            <div className="row-main">
              <strong>{vnd(t.amount_vnd)} · {STATUS[t.status] || t.status}{t.needs_attention ? ' · cần xử lý' : ''}</strong>
              <span>{time(t.transferred_at || t.received_at)} · {t.bank_name || t.provider} · {t.source === 'poll' ? 'đối soát bù' : t.source}</span>
              <span>Nội dung: <code>{t.content || '(trống)'}</code></span>
              <span>{reasonLabel(t)}</span>
              {t.payment && (
                <span>
                  Đơn LGOS{t.payment.order_code} · {t.payment.workspace?.name || '—'} · {t.payment.plan} {t.payment.period_months} tháng · giá {vnd(t.payment.amount_vnd)} · {t.payment.status}
                  {t.payment.paid_amount_vnd ? ` · đã nhận ${vnd(t.payment.paid_amount_vnd)}` : ''}
                </span>
              )}
              {t.note && <span>Ghi chú: {t.note}</span>}
            </div>
            {t.suggestions?.length > 0 && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', fontSize: 13 }}>
                Gợi ý:
                {t.suggestions.map((s: any) => (
                  <button key={s.order_code} className="secondary-button" disabled={busy === t.id}
                    onClick={() => confirm(`Gán vào LGOS${s.order_code} (${s.workspace_name}, ${vnd(s.amount_vnd)})?`) && act(t, 'assign', String(s.order_code))}>
                    LGOS{s.order_code} · {s.workspace_name} · {vnd(s.amount_vnd)} · {s.why || `điểm ${s.score}`}
                  </button>
                ))}
              </div>
            )}
            {t.needs_attention && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                {!t.payment_id && ['unmatched', 'needs_review'].includes(t.status) && (
                  <>
                    <input placeholder="Mã đơn 12 số" inputMode="numeric" value={code[t.id] ?? ''} onChange={(e) => setCode({ ...code, [t.id]: e.target.value })} style={{ width: 150 }} aria-label="Mã đơn" />
                    <button className="primary-button" disabled={busy === t.id || !code[t.id]} onClick={() => act(t, 'assign')}>Gán vào đơn</button>
                  </>
                )}
                <input placeholder="Ghi chú (tuỳ chọn)" value={note[t.id] ?? ''} onChange={(e) => setNote({ ...note, [t.id]: e.target.value })} style={{ minWidth: 180 }} aria-label="Ghi chú" />
                <button className="secondary-button" disabled={busy === t.id} onClick={() => act(t, 'refund')}>
                  {String(t.reason || '').startsWith('overpaid:') ? 'Đã hoàn phần dư' : 'Đã hoàn tiền'}
                </button>
                {t.status !== 'matched' && <button className="secondary-button" disabled={busy === t.id} onClick={() => act(t, 'ignore')}>Không phải tiền dịch vụ</button>}
                <button className="secondary-button" disabled={busy === t.id} onClick={() => act(t, 'ack')}>Đã xem, giữ nguyên</button>
              </div>
            )}
          </div>
        ))}
      </Card>

      <Card>
        <div className="section-head"><div><h2>Đơn đang chờ</h2><p>Kích hoạt tay chỉ khi tiền đã vào mà hệ thống không bắt được (vd giao dịch không qua SePay). Nhập số tiền thực nhận: thiếu thì đơn chờ nốt, dư thì vào hàng chờ hoàn phần dư.</p></div></div>
        {orders.length === 0 && <div className="empty-note">Không có đơn chờ.</div>}
        {orders.map((o) => (
          <div key={o.order_code} className="client-row" style={{ gap: 12, flexWrap: 'wrap' }}>
            <div className="row-main">
              <strong>{o.workspace?.name || o.workspace_id} · {o.plan} {o.period_months} tháng</strong>
              <span>LGOS{o.order_code} · {vnd(o.amount_vnd)} · {o.status}{o.paid_amount_vnd ? ` · đã nhận ${vnd(o.paid_amount_vnd)}` : ''} · tạo {time(o.created_at)}</span>
            </div>
            <input inputMode="numeric" placeholder={String(o.amount_vnd - (o.paid_amount_vnd || 0))} value={paid[o.order_code] ?? ''} onChange={(e) => setPaid({ ...paid, [o.order_code]: e.target.value })} style={{ width: 120 }} aria-label="Số tiền thực nhận" />
            <button className="primary-button" onClick={() => activate(o.order_code, o.amount_vnd - (o.paid_amount_vnd || 0))}>Đã nhận tiền</button>
          </div>
        ))}
      </Card>
    </>
  )
}
