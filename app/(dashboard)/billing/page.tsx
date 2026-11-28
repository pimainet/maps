'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Card } from '@/components/dashboard/shared'
import { useToast } from '@/components/dashboard/toast-context'
import { ConsultCard } from '@/components/agency/consult-card'

type Catalog = { plan: 'basic' | 'full'; label: string; monthly: number; entitlements: any; prices: { months: number; amount: number }[] }
type PlanInfo = { plan: string; label: string; period_end: string | null; scheduled: { plan: string; start: string } | null; catalog: Catalog[]; done_for_you?: { label: string; monthly: number } | null }
type Transfer = { bank_id: string; account_no: string; account_name: string; amount: number; content: string; qr_url: string }
type Order = { order_code: number; plan: string; period_months: number; amount_vnd: number; paid_amount_vnd?: number | null; status: string; created_at: string; paid_at: string | null; expires_at?: string; receipt_no?: string | null; transfer?: Transfer }

const vnd = (n: number) => n.toLocaleString('vi-VN') + 'đ'
const PLAN_NAME: Record<string, string> = { basic: 'Khởi động', full: 'Nâng cao', done_for_you: 'Làm hộ' }
const date = (s: string | null) => (s ? new Date(s).toLocaleDateString('vi-VN') : '')

// Tính năng đang bật theo cờ (bản dựng nào tắt thì không quảng cáo)
const REVIEW_INBOX_ON = process.env.NEXT_PUBLIC_REVIEW_INBOX_ENABLED === 'true'
const RANK_GRID_ON = process.env.NEXT_PUBLIC_RANK_GRID_ENABLED === 'true'

// Khớp REVIEW_LIMITS / RANK_GRID_LIMITS trong lib/billing/plans.ts
const FEATURES: Record<'basic' | 'full', string[]> = {
  basic: [
    'Phân tích tình trạng Google Maps của doanh nghiệp',
    'Xác định điểm đang làm tốt và điểm cần cải thiện',
    'Kế hoạch tối ưu cá nhân hóa trong 30 ngày',
    'Hướng dẫn chi tiết từng công việc cần thực hiện',
    'Toàn bộ danh sách nhiệm vụ và theo dõi tiến độ',
    'AI hỗ trợ tư vấn và tạo nội dung',
    'Gợi ý danh mục phụ và mô tả có căn cứ',
    ...(REVIEW_INBOX_ON ? ['Hộp thư đánh giá: quét đánh giá mới hàng tuần, AI soạn sẵn phản hồi (40 bản nháp/tháng)'] : []),
    ...(RANK_GRID_ON ? ['Bản đồ thứ hạng 5x5 cho 5 từ khoá, 2 tuần/lần'] : []),
    '1 doanh nghiệp',
  ],
  full: [
    'Bao gồm toàn bộ gói Khởi động, cộng thêm:',
    ...(REVIEW_INBOX_ON
      ? ['Quét đánh giá mới hàng ngày, báo ngay khi có đánh giá thấp sao', 'AI soạn phản hồi đánh giá (150 bản nháp/tháng)']
      : ['Theo dõi đánh giá mới và nhắc khi có đánh giá thấp sao']),
    ...(RANK_GRID_ON ? ['Bản đồ thứ hạng tới 9x9 cho 10 từ khoá, quét hàng tuần'] : ['Theo dõi thứ hạng Google Maps']),
    'Chủ động phát hiện biến động và vấn đề cần xử lý',
    'Hỗ trợ quản lý sự hiện diện trực tuyến một cách liên tục',
  ],
}

const STATUS_LABEL: Record<string, string> = {
  pending: 'Chờ chuyển khoản',
  partial: 'Đã nhận một phần',
  paid: 'Đã thanh toán',
  amount_mismatch: 'Lệch số tiền',
  expired: 'Hết hạn',
  cancelled: 'Đã huỷ',
  refunded: 'Đã hoàn tiền',
}

const AUDIENCE: Record<'basic' | 'full', string> = {
  basic: 'Dành cho chủ doanh nghiệp muốn cải thiện Google Maps nhưng chưa biết bắt đầu từ đâu.',
  full: 'Dành cho chủ doanh nghiệp muốn chủ động theo dõi tình hình và quản lý uy tín trên Google Maps.',
}

const FIT: Record<'basic' | 'full', string> = {
  basic: 'Phù hợp nếu: Bạn muốn tự cải thiện Google Maps, có hướng dẫn rõ ràng và không phải thuê chuyên gia SEO ngay từ đầu.',
  full: 'Phù hợp nếu: Google Maps là một kênh quan trọng giúp khách hàng tìm đến doanh nghiệp và bạn muốn theo dõi tình hình thường xuyên thay vì kiểm tra thủ công.',
}

export default function BillingPage() {
  const { showToast } = useToast()
  const [info, setInfo] = useState<PlanInfo | null>(null)
  const [error, setError] = useState('')
  const [plan, setPlan] = useState<'basic' | 'full'>('basic')
  const [months, setMonths] = useState(1)
  const [busy, setBusy] = useState(false)
  const [transfer, setTransfer] = useState<Transfer | null>(null)
  const [orders, setOrders] = useState<Order[]>([])
  const [isAdmin, setIsAdmin] = useState(false)
  const [activeOrder, setActiveOrder] = useState<number | null>(null)
  const preselected = useRef(false)

  async function loadOrders(): Promise<Order[]> {
    const r = await fetch('/api/billing/orders')
    if (!r.ok) return []
    const list: Order[] = (await r.json().catch(() => ({}))).orders || []
    setOrders(list)
    return list
  }

  async function load() {
    const res = await fetch('/api/billing/plan')
    const data = await res.json().catch(() => ({}))
    if (!res.ok) return setError(data.error || 'Không tải được thông tin gói.')
    setInfo(data)
    // Link "Gia hạn" trong email: chọn sẵn gói đang dùng
    if (!preselected.current && typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('renew') && (data.plan === 'basic' || data.plan === 'full')) {
      setPlan(data.plan)
      preselected.current = true
    }
    loadOrders()
    fetch('/api/admin/billing/activate').then((a) => setIsAdmin(a.ok)).catch(() => {})
  }
  useEffect(() => { load() }, [])

  // Đang chờ tiền: tự kiểm tra lại mỗi 15 giây (tối đa 20 phút) để báo ngay khi webhook kích hoạt
  useEffect(() => {
    if (!activeOrder) return
    let n = 0
    const t = setInterval(async () => {
      n++
      const list = await loadOrders()
      const o = list.find((x) => x.order_code === activeOrder)
      if (o?.status === 'paid') {
        clearInterval(t)
        setTransfer(null)
        setActiveOrder(null)
        showToast('Đã nhận thanh toán. Gói đã được kích hoạt, biên nhận đã gửi qua email.')
        load()
      } else if (n >= 80) clearInterval(t)
    }, 15000)
    return () => clearInterval(t)
  }, [activeOrder])

  async function createOrder() {
    setBusy(true)
    setError('')
    try {
      const res = await fetch('/api/billing/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ plan, months }) })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Không tạo được đơn.')
      setTransfer(data.transfer)
      setActiveOrder(data.order?.order_code ?? null)
      loadOrders()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
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
        <div className="section-head"><div><h2>Chọn gói</h2><p>Mỗi gói dùng cho 1 doanh nghiệp. Đổi sang gói khác sẽ áp dụng từ kỳ sau, không tính lại tiền giữa kỳ.</p></div></div>
        <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))' }}>
          {info.catalog.map((c) => (
            <button key={c.plan} type="button" onClick={() => setPlan(c.plan)} aria-pressed={plan === c.plan}
              style={{ textAlign: 'left', padding: 16, borderRadius: 14, border: plan === c.plan ? '2px solid var(--primary, #2563eb)' : '1px solid var(--border, #e4e4e7)', background: 'transparent', cursor: 'pointer', color: 'inherit' }}>
              <strong style={{ fontSize: 16 }}>{c.label}</strong>
              <div style={{ fontSize: 22, fontWeight: 700, margin: '6px 0' }}>{vnd(c.monthly)}<small style={{ fontSize: 13, fontWeight: 400 }}> / tháng</small></div>
              <p style={{ fontSize: 13, margin: '0 0 8px' }}>{AUDIENCE[c.plan]}</p>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.6 }}>{FEATURES[c.plan].map((f) => <li key={f}>{f}</li>)}</ul>
              <p style={{ fontSize: 12, margin: '8px 0 0', color: 'var(--muted-foreground)' }}>{FIT[c.plan]}</p>
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
          Trả trước bằng chuyển khoản, không tự động trừ tiền. Tặng kèm khi đăng ký gói trả phí: bảng QR hướng khách hàng đến trang đánh giá Google của doanh nghiệp và bộ mẫu tin nhắn xin đánh giá khách hàng.
        </p>
        <button className="primary-button" onClick={createOrder} disabled={busy}>{busy ? 'Đang tạo…' : `Lấy mã chuyển khoản ${vnd(price)}`}</button>
        {error && <div className="alert alert-error" style={{ marginTop: 12 }}>{error}</div>}
      </Card>

      {info.done_for_you && <ConsultCard monthly={info.done_for_you.monthly} currentPlan={info.plan} periodEnd={info.period_end} />}

      {transfer && (
        <Card>
          <div className="section-head"><div><h2>Chuyển khoản</h2><p>Quét mã QR bằng app ngân hàng (đã điền sẵn số tiền và nội dung). Gói tự bật sau khi tiền vào tài khoản, thường trong 1–2 phút; biên nhận gửi qua email. Giữ nguyên nội dung chuyển khoản để hệ thống nhận ra đơn của bạn.</p></div></div>
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
          <p style={{ fontSize: 13, color: 'var(--muted-foreground)', margin: '12px 0 0' }}>
            {activeOrder ? 'Trang này tự kiểm tra và báo ngay khi nhận được tiền. ' : ''}
            Mã chuyển khoản có hiệu lực 7 ngày. Lỡ chuyển thiếu, dư hoặc sai nội dung: tiền không mất — chúng tôi đối chiếu và xử lý trong ngày làm việc.
          </p>
        </Card>
      )}

      {orders.length > 0 && (
        <Card>
          <div className="section-head">
            <div><h2>Lịch sử thanh toán</h2><p>Đơn còn chờ có thể mở lại mã QR. Biên nhận được gửi qua email sau khi thanh toán.</p></div>
            {isAdmin && <Link href="/billing/admin" className="secondary-button">Đối soát (admin)</Link>}
          </div>
          {orders.map((o) => (
            <div key={o.order_code} className="client-row" style={{ gap: 12, flexWrap: 'wrap' }}>
              <div className="row-main">
                <strong>{PLAN_NAME[o.plan] || o.plan} · {o.period_months} tháng · {vnd(o.amount_vnd)}</strong>
                <span>
                  LGOS{o.order_code} · {STATUS_LABEL[o.status] || o.status}
                  {o.status === 'partial' && o.paid_amount_vnd ? ` (đã nhận ${vnd(o.paid_amount_vnd)}, còn thiếu ${vnd(o.amount_vnd - o.paid_amount_vnd)})` : ''}
                  {o.status === 'paid' && o.paid_at ? ` · ${date(o.paid_at)}` : ` · tạo ${date(o.created_at)}`}
                  {o.receipt_no ? ` · biên nhận ${o.receipt_no}` : ''}
                </span>
              </div>
              {o.transfer && (
                <button className="secondary-button" onClick={() => { setTransfer(o.transfer!); setActiveOrder(o.order_code) }}>
                  {o.status === 'partial' ? 'Chuyển nốt' : 'Mở mã QR'}
                </button>
              )}
            </div>
          ))}
        </Card>
      )}
      {orders.length === 0 && isAdmin && (
        <Card><Link href="/billing/admin" className="secondary-button">Đối soát thanh toán (admin)</Link></Card>
      )}
    </>
  )
}
