'use client'

// Công việc Làm hộ (chỉ Super Admin / nhân viên): hàng đợi duyệt bài + phản hồi review + việc tối ưu hồ sơ + báo cáo tháng,
// cùng yêu cầu tư vấn và tạo đơn. Nhân viên duyệt THAY khách; mọi thao tác được ghi vào nhật ký (agency_actions).
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Card } from '@/components/dashboard/shared'
import { useToast } from '@/components/dashboard/toast-context'
import { periodLabel } from '@/lib/agency/report'
import { DONE_FOR_YOU_ENABLED } from '@/lib/features'

const vnd = (n: number | null | undefined) => `${Number(n || 0).toLocaleString('vi-VN')}đ`
const day = (s: string | null | undefined) => (s ? new Date(s).toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }) : '—')

async function call(url: string, body?: unknown) {
  const res = await fetch(url, body === undefined ? undefined : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const d = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(d.error || 'Có lỗi xảy ra')
  return d
}

function Chip({ children, tone }: { children: React.ReactNode; tone?: 'warn' | 'ok' }) {
  return <span className={`status-badge ${tone === 'warn' ? 'status-warning' : tone === 'ok' ? 'status-success' : 'status-muted'}`} style={{ marginRight: 6 }}>{children}</span>
}

// ── Hàng đợi ────────────────────────────────────────────────────────────────
function PostItem({ p, onDone }: { p: any; onDone: () => void }) {
  const { showToast } = useToast()
  const [caption, setCaption] = useState<string>(p.caption || '')
  const [busy, setBusy] = useState(false)
  async function act(kind: 'post_approve' | 'post_reject', extra: any = {}) {
    setBusy(true)
    try {
      await call('/api/admin/agency/action', { kind, queue_id: p.queue_id, ...extra })
      showToast(kind === 'post_approve' ? 'Đã duyệt: bài sẽ đăng ở lượt 9:00 / 19:00.' : 'Đã từ chối bài.')
      onDone()
    } catch (e: any) {
      showToast(e.message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="client-row" style={{ alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
      {p.photo_url && <img src={p.photo_url} alt="" width={96} height={96} style={{ objectFit: 'cover', borderRadius: 8 }} />}
      <div style={{ flex: 1, minWidth: 240 }}>
        <textarea value={caption} onChange={(e) => setCaption(e.target.value)} rows={4} maxLength={1500} style={{ width: '100%' }} aria-label="Nội dung bài" />
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
          <button className="primary-button" disabled={busy} onClick={() => act('post_approve', { caption: caption !== p.caption ? caption : undefined })}>Duyệt đăng</button>
          <button className="secondary-button" disabled={busy} onClick={() => confirm('Từ chối bài này? Ảnh sẽ trở lại kho để chọn lại.') && act('post_reject')}>Từ chối</button>
        </div>
      </div>
    </div>
  )
}

function ReviewItem({ r, makeReady, onDone }: { r: any; makeReady: boolean; onDone: () => void }) {
  const { showToast } = useToast()
  const [text, setText] = useState<string>(r.final_reply || r.draft_reply || '')
  const [busy, setBusy] = useState(false)
  async function act(action: string) {
    setBusy(true)
    try {
      const d = await call('/api/admin/agency/action', { kind: 'review', review_id: r.id, action, text: ['approve', 'save', 'copied'].includes(action) ? text : undefined })
      if (action === 'redraft' && d.review) setText(d.review.final_reply || d.review.draft_reply || '')
      showToast(d.warnings?.length ? `Xong. Lưu ý: ${d.warnings.join(' ')}` : 'Đã cập nhật.')
      onDone()
    } catch (e: any) {
      showToast(e.message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="client-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
      <div className="row-main">
        <strong>{'★'.repeat(r.rating || 0)}{'☆'.repeat(5 - (r.rating || 0))} · {r.author_name || 'Khách'}{r.urgency === 'high' ? ' · khẩn' : ''}</strong>
        <span>{r.review_text || '(không có nội dung)'}</span>
        {r.ai_summary && <span style={{ color: 'var(--muted-foreground)' }}>{r.ai_summary}</span>}
        {r.status === 'failed' && <span style={{ color: 'var(--danger)' }}>Đăng lỗi: {r.post_error || 'không rõ'}</span>}
      </div>
      {r.status !== 'new' && <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} aria-label="Phản hồi" style={{ width: '100%' }} />}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {r.status === 'new' && <button className="primary-button" disabled={busy} onClick={() => act('redraft')}>Soạn nháp (AI)</button>}
        {(r.status === 'drafted' || r.status === 'failed') && <button className="primary-button" disabled={busy || !text.trim()} onClick={() => act('approve')}>{makeReady ? 'Duyệt & đăng' : 'Duyệt'}</button>}
        {(r.status === 'drafted' || r.status === 'failed' || (r.status === 'approved' && !makeReady)) && <button className="secondary-button" disabled={busy || !text.trim()} onClick={() => act('copied')}>Đã dán tay lên Google</button>}
        {r.status !== 'new' && <button className="secondary-button" disabled={busy} onClick={() => act('redraft')}>Soạn lại</button>}
        <button className="secondary-button" disabled={busy} onClick={() => act('ignore')}>Bỏ qua</button>
      </div>
    </div>
  )
}

function ClientBlock({ c, onDone, flags }: { c: any; onDone: () => void; flags: Record<string, boolean> }) {
  const { showToast } = useToast()
  const [open, setOpen] = useState(c.posts.pending.length + c.reviews.pending.length > 0)
  const counts = c.reviews.counts
  async function task(id: string, status: string) {
    try {
      await call('/api/admin/agency/action', { kind: 'task', task_id: id, status })
      onDone()
    } catch (e: any) {
      showToast(e.message)
    }
  }
  const rep = c.report
  return (
    <div style={{ borderTop: '1px solid var(--border)', padding: '12px 0' }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'space-between' }}>
        <div>
          <strong>{c.name}</strong>
          <div style={{ marginTop: 4 }}>
            {flags.autopost && <Chip tone={c.posts.pending.length ? 'warn' : undefined}>{c.posts.pending.length} bài chờ duyệt</Chip>}
            {flags.autopost && <Chip>{c.posts.waiting} bài chờ đăng · {c.posts.published_30d} đã đăng/30 ngày</Chip>}
            {flags.reviews && <Chip tone={counts.to_approve + counts.to_draft ? 'warn' : undefined}>{counts.to_draft} review cần soạn · {counts.to_approve} cần duyệt{counts.urgent ? ` · ${counts.urgent} khẩn` : ''}</Chip>}
            <Chip tone={c.tasks.overdue ? 'warn' : undefined}>{c.tasks.open} việc hồ sơ{c.tasks.overdue ? ` (${c.tasks.overdue} quá hạn)` : ''}</Chip>
            <Chip tone={rep.status === 'sent' ? 'ok' : rep.closing ? 'warn' : undefined}>Báo cáo {periodLabel(rep.period)}: {rep.status === 'sent' ? 'đã gửi' : rep.status === 'draft' ? 'nháp' : 'chưa tạo'}</Chip>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Link className="secondary-button" href={`/agency/report?client_id=${c.client_id}&period=${rep.period}`}>Báo cáo tháng</Link>
          <button className="secondary-button" onClick={() => setOpen(!open)}>{open ? 'Thu gọn' : 'Mở việc'}</button>
        </div>
      </div>
      {open && (
        <div style={{ marginTop: 8 }}>
          {flags.autopost && c.posts.pending.map((p: any) => <PostItem key={p.queue_id} p={p} onDone={onDone} />)}
          {flags.reviews && c.reviews.pending.map((r: any) => <ReviewItem key={r.id} r={r} makeReady={c.reviews.make_ready} onDone={onDone} />)}
          {c.tasks.pending.map((t: any) => (
            <div key={t.id} className="client-row" style={{ gap: 12, flexWrap: 'wrap' }}>
              <div className="row-main" style={{ flex: 1 }}>
                <strong>{t.title}</strong>
                <span>{t.due_date ? `Hạn ${day(t.due_date)}` : 'Không có hạn'}{t.priority ? ` · ưu tiên ${t.priority}` : ''}</span>
              </div>
              <button className="primary-button" onClick={() => task(t.id, 'done')}>Xong</button>
              <button className="secondary-button" onClick={() => task(t.id, 'skipped')}>Bỏ qua</button>
            </div>
          ))}
          {!c.posts.pending.length && !c.reviews.pending.length && !c.tasks.pending.length && <div className="empty-note">Không có việc nào đang chờ.</div>}
        </div>
      )}
    </div>
  )
}

function QueueTab() {
  const [data, setData] = useState<any>(null)
  const [error, setError] = useState('')
  const load = useCallback(async () => {
    try {
      setData(await call('/api/admin/agency/queue'))
      setError('')
    } catch (e: any) {
      setError(e.message)
    }
  }, [])
  useEffect(() => { load() }, [load])
  if (error) return <Card><div className="alert alert-error">{error}</div></Card>
  if (!data) return <Card><div className="empty-note">Đang tải…</div></Card>
  const t = data.totals
  return (
    <>
      <Card>
        <div className="section-head"><div><h2>Việc đang chờ</h2><p>Bạn duyệt thay khách. Bài duyệt xong sẽ đăng ở lượt 9:00 và 19:00; phản hồi review duyệt xong tự đăng qua Make (nếu chưa nối thì bấm “Đã dán tay”).</p></div></div>
        <div>
          <Chip tone={t.posts ? 'warn' : undefined}>{t.posts} bài chờ duyệt</Chip>
          <Chip tone={t.reviews ? 'warn' : undefined}>{t.reviews} review chờ xử lý{t.urgentReviews ? ` (${t.urgentReviews} khẩn)` : ''}</Chip>
          <Chip tone={t.tasksOverdue ? 'warn' : undefined}>{t.tasks} việc hồ sơ ({t.tasksOverdue} quá hạn)</Chip>
          <Chip tone={t.reportsDue ? 'warn' : undefined}>{t.reportsDue} báo cáo cần gửi</Chip>
        </div>
        {!data.flags.autopost && <div className="alert alert-warn" style={{ marginTop: 10 }}>Tính năng tự đăng bài đang tắt trong bản triển khai này nên mục bài viết bị ẩn.</div>}
        {!data.flags.reviews && <div className="alert alert-warn" style={{ marginTop: 10 }}>Hộp thư review đang tắt nên mục review bị ẩn.</div>}
      </Card>
      {data.workspaces.length === 0 && <Card><div className="empty-note">Chưa có khách nào ở gói Làm hộ. Khi có yêu cầu tư vấn, vào tab “Yêu cầu tư vấn” → tạo đơn.</div></Card>}
      {data.workspaces.map((w: any) => (
        <Card key={w.workspace_id}>
          <div className="section-head"><div><h2>{w.name}</h2><p>Gói Làm hộ{w.period_end ? ` · đến ${day(w.period_end)}` : ''}</p></div></div>
          {w.clients.length === 0 && <div className="empty-note">Chưa có doanh nghiệp nào trong workspace này.</div>}
          {w.clients.map((c: any) => <ClientBlock key={c.client_id} c={c} onDone={load} flags={data.flags} />)}
        </Card>
      ))}
    </>
  )
}

// ── Yêu cầu tư vấn + tạo đơn ────────────────────────────────────────────────
const LEAD_STATUS: Record<string, string> = { new: 'Mới', contacted: 'Đã liên hệ', quoted: 'Đã báo giá', won: 'Chốt', lost: 'Không chốt' }

function LeadsTab() {
  const { showToast } = useToast()
  const [view, setView] = useState<'open' | 'all'>('open')
  const [leads, setLeads] = useState<any[] | null>(null)
  const [error, setError] = useState('')
  const [note, setNote] = useState<Record<string, string>>({})
  const [order, setOrder] = useState<any>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setLeads((await call(`/api/admin/agency/leads?view=${view}`)).leads)
      setError('')
    } catch (e: any) {
      setLeads([])
      setError(e.message)
    }
  }, [view])
  useEffect(() => { load() }, [load])

  async function update(id: string, patch: any) {
    setBusy(id)
    try {
      await call('/api/admin/agency/leads', { id, ...patch })
      await load()
    } catch (e: any) {
      showToast(e.message)
    } finally {
      setBusy(null)
    }
  }
  async function createOrder(l: any) {
    if (!confirm(`Tạo đơn Làm hộ ${vnd(2_490_000)} / 1 tháng cho "${l.workspace_name}"?`)) return
    setBusy(l.id)
    try {
      setOrder({ lead: l, ...(await call('/api/admin/billing/orders', { workspace_id: l.workspace_id, plan: 'done_for_you', months: 1, lead_id: l.id })) })
      await load()
    } catch (e: any) {
      showToast(e.message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <Card>
        <div className="section-head"><div><h2>Yêu cầu tư vấn</h2><p>Liên hệ khách → chốt → “Tạo đơn”: hệ thống sinh mã chuyển khoản (LGOS…) và tự kích hoạt gói khi tiền về. Có thể tạo đơn thêm cho workspace bất kỳ ở tab “Tạo đơn”.</p></div></div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className={view === 'open' ? 'primary-button' : 'secondary-button'} onClick={() => setView('open')}>Đang mở</button>
          <button className={view === 'all' ? 'primary-button' : 'secondary-button'} onClick={() => setView('all')}>Tất cả</button>
        </div>
        {error && <div className="alert alert-error" style={{ marginTop: 12 }}>{error}</div>}
      </Card>
      {order && <OrderResult o={order} onClose={() => setOrder(null)} />}
      <Card>
        {leads === null && <div className="empty-note">Đang tải…</div>}
        {leads?.length === 0 && !error && <div className="empty-note">Không có yêu cầu nào.</div>}
        {leads?.map((l) => (
          <div key={l.id} className="client-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
            <div className="row-main">
              <strong>{l.contact_name} · {l.phone} · {LEAD_STATUS[l.status] || l.status}</strong>
              <span>{l.workspace_name || '—'}{l.business_name ? ` · ${l.business_name}` : ''}{l.email ? ` · ${l.email}` : ''} · {day(l.created_at)}{l.workspace_plan ? ` · gói hiện tại: ${l.workspace_plan}` : ''}</span>
              {l.message && <span>“{l.message}”</span>}
              {l.order_code && <span>Đơn LGOS{l.order_code}</span>}
              {l.admin_note && <span>Ghi chú: {l.admin_note}</span>}
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              {['new', 'contacted', 'quoted'].includes(l.status) && (
                <>
                  {l.status === 'new' && <button className="secondary-button" disabled={busy === l.id} onClick={() => update(l.id, { status: 'contacted' })}>Đã liên hệ</button>}
                  <button className="primary-button" disabled={busy === l.id || !l.workspace_id} onClick={() => createOrder(l)}>Tạo đơn 2.490.000đ</button>
                  <button className="secondary-button" disabled={busy === l.id} onClick={() => confirm('Đánh dấu không chốt?') && update(l.id, { status: 'lost' })}>Không chốt</button>
                </>
              )}
              {l.status === 'quoted' && <button className="secondary-button" disabled={busy === l.id} onClick={() => update(l.id, { status: 'won' })}>Đã chốt</button>}
              <input placeholder="Ghi chú nội bộ" value={note[l.id] ?? ''} onChange={(e) => setNote({ ...note, [l.id]: e.target.value })} aria-label="Ghi chú" style={{ minWidth: 200 }} />
              <button className="secondary-button" disabled={busy === l.id || !(note[l.id] || '').trim()} onClick={() => update(l.id, { admin_note: note[l.id] })}>Lưu ghi chú</button>
            </div>
          </div>
        ))}
      </Card>
    </>
  )
}

function OrderResult({ o, onClose }: { o: any; onClose: () => void }) {
  const { showToast } = useToast()
  return (
    <Card>
      <div className="section-head"><div><h2>Đã tạo đơn LGOS{o.order.order_code}</h2><p>{vnd(o.order.amount_vnd)} · hạn {day(o.order.expires_at)}. Khách cũng thấy đơn (và mã QR) trong “Lịch sử thanh toán” ở trang Gói dịch vụ.</p></div></div>
      {o.warnings?.map((w: string) => <div key={w} className="alert alert-warn" style={{ marginBottom: 8 }}>{w}</div>)}
      <textarea readOnly rows={8} value={o.message} style={{ width: '100%' }} aria-label="Tin nhắn gửi khách" />
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <button className="primary-button" onClick={() => navigator.clipboard.writeText(o.message).then(() => showToast('Đã chép tin nhắn.'))}>Chép tin nhắn gửi khách</button>
        <a className="secondary-button" href={o.transfer.qr_url} target="_blank" rel="noreferrer">Mở mã QR</a>
        <button className="secondary-button" onClick={onClose}>Đóng</button>
      </div>
    </Card>
  )
}

function OrdersTab() {
  const { showToast } = useToast()
  const [data, setData] = useState<any>(null)
  const [error, setError] = useState('')
  const [ws, setWs] = useState('')
  const [months, setMonths] = useState(1)
  const [amount, setAmount] = useState('')
  const [result, setResult] = useState<any>(null)
  const [busy, setBusy] = useState(false)
  const [q, setQ] = useState('')
  const load = useCallback(async () => {
    try {
      setData(await call('/api/admin/billing/orders'))
      setError('')
    } catch (e: any) {
      setError(e.message)
    }
  }, [])
  useEffect(() => { load() }, [load])
  const list = useMemo(() => (data?.workspaces || []).filter((w: any) => !q || w.name.toLowerCase().includes(q.toLowerCase())).slice(0, 50), [data, q])

  async function create() {
    setBusy(true)
    try {
      setResult(await call('/api/admin/billing/orders', { workspace_id: ws, plan: 'done_for_you', months, amount_vnd: amount ? Number(amount) : undefined }))
      await load()
    } catch (e: any) {
      showToast(e.message)
    } finally {
      setBusy(false)
    }
  }
  if (error) return <Card><div className="alert alert-error">{error}</div></Card>
  if (!data) return <Card><div className="empty-note">Đang tải…</div></Card>
  return (
    <>
      <Card>
        <div className="section-head"><div><h2>Tạo đơn Làm hộ</h2><p>Đơn tự kích hoạt khi tiền về đúng mã chuyển khoản; cũng có thể kích hoạt tay ở <Link href="/billing/admin">Đối soát</Link>. Bỏ trống số tiền = giá niêm yết ({vnd(2_490_000)} × số tháng).</p></div></div>
        {!data.bank_ready && <div className="alert alert-error" style={{ marginBottom: 10 }}>Chưa cấu hình tài khoản nhận tiền (BILLING_BANK_ID / BILLING_ACCOUNT_NO / BILLING_ACCOUNT_NAME).</div>}
        <div style={{ display: 'grid', gap: 10, maxWidth: 520 }}>
          <input placeholder="Tìm workspace…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Tìm workspace" />
          <select value={ws} onChange={(e) => setWs(e.target.value)} aria-label="Workspace">
            <option value="">— Chọn workspace —</option>
            {list.map((w: any) => <option key={w.id} value={w.id}>{w.name} ({w.plan})</option>)}
          </select>
          <select value={months} onChange={(e) => setMonths(Number(e.target.value))} aria-label="Kỳ hạn">
            <option value={1}>1 tháng</option><option value={3}>3 tháng</option><option value={12}>12 tháng</option>
          </select>
          <input placeholder="Số tiền tuỳ chỉnh (đ, tuỳ chọn)" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ''))} aria-label="Số tiền" />
          <button className="primary-button" disabled={busy || !ws || !data.bank_ready} onClick={create}>{busy ? 'Đang tạo…' : 'Tạo đơn'}</button>
        </div>
      </Card>
      {result && <OrderResult o={result} onClose={() => setResult(null)} />}
      <Card>
        <div className="section-head"><div><h2>Đơn Làm hộ gần đây</h2></div></div>
        {data.orders.length === 0 && <div className="empty-note">Chưa có đơn.</div>}
        {data.orders.map((o: any) => (
          <div key={o.order_code} className="client-row">
            <div className="row-main">
              <strong>LGOS{o.order_code} · {o.workspace_name || '—'} · {vnd(o.amount_vnd)} · {o.period_months} tháng</strong>
              <span>{o.status}{o.paid_amount_vnd ? ` · đã nhận ${vnd(o.paid_amount_vnd)}` : ''} · tạo {day(o.created_at)}{o.status === 'pending' ? ` · hạn ${day(o.expires_at)}` : ''}</span>
            </div>
          </div>
        ))}
      </Card>
    </>
  )
}

function Inner() {
  const sp = useSearchParams()
  const [tab, setTab] = useState<'queue' | 'leads' | 'orders'>((['queue', 'leads', 'orders'].includes(sp.get('tab') || '') ? sp.get('tab') : 'queue') as any)
  if (!DONE_FOR_YOU_ENABLED) return <Card><div className="empty-note">Gói Làm hộ chưa được bật (NEXT_PUBLIC_DONE_FOR_YOU_ENABLED).</div></Card>
  return (
    <>
      <Card>
        <div role="tablist" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {([['queue', 'Hàng đợi công việc'], ['leads', 'Yêu cầu tư vấn'], ['orders', 'Tạo đơn']] as const).map(([k, label]) => (
            <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'primary-button' : 'secondary-button'} onClick={() => setTab(k)}>{label}</button>
          ))}
        </div>
      </Card>
      {tab === 'queue' && <QueueTab />}
      {tab === 'leads' && <LeadsTab />}
      {tab === 'orders' && <OrdersTab />}
    </>
  )
}

export default function AgencyPage() {
  return <Suspense fallback={<Card><div className="empty-note">Đang tải…</div></Card>}><Inner /></Suspense>
}
