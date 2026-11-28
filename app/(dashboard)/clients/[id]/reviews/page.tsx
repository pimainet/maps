'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { Check, Copy, ExternalLink, Link2, MessageSquareReply, RefreshCw, Sparkles, Star, Undo2, X } from 'lucide-react'
import { Card } from '@/components/dashboard/shared'
import { useToast } from '@/components/dashboard/toast-context'
import { DONE_FOR_YOU_ENABLED, REVIEW_INBOX_ENABLED } from '@/lib/features'

type Review = {
  id: string
  source: string
  gbp_review_name: string | null
  author_name: string | null
  rating: number
  review_text: string | null
  reviewed_at: string | null
  relative_time: string | null
  owner_reply: string | null
  sentiment: string | null
  urgency: 'high' | 'normal' | 'low'
  topics: string[]
  ai_summary: string | null
  draft_reply: string | null
  draft_warnings: string[]
  final_reply: string | null
  approved_via: string | null
  status: string
  posted_at: string | null
  gbp_reply_state: string | null
  post_error: string | null
}

type Inbox = {
  reviews: Review[]
  counts: Record<string, number>
  urgent_open: number
  state: { last_checked_at: string | null; last_source: string | null; last_error: string | null; gbp_synced_at: string | null } | null
  plan: string
  entitlement: { frequency: string; autoDraft: boolean; monthlyDrafts: number; ownerLink: boolean; postViaMake: boolean; manualChecksPerMonth: number }
  drafts_used: number
  manual_checks_used: number
  make_ready: boolean
  owner_link_path: string | null
  client_name: string
  maps_link: string | null
}

const STATUS_LABEL: Record<string, string> = {
  new: 'Mới',
  drafted: 'Có bản nháp',
  approved: 'Đã duyệt',
  posting: 'Đang đăng',
  posted: 'Đã đăng lên Google',
  manual_copied: 'Đã dán tay',
  ignored: 'Bỏ qua',
  replied_elsewhere: 'Chủ đã tự phản hồi',
  failed: 'Đăng lỗi',
}
const FREQ_LABEL: Record<string, string> = { none: 'không tự kiểm tra', weekly: 'kiểm tra hàng tuần', daily: 'kiểm tra hàng ngày' }
const URGENCY: Record<string, { label: string; color: string }> = {
  high: { label: 'Khẩn', color: '#b91c1c' },
  normal: { label: 'Bình thường', color: '#92400e' },
  low: { label: 'Thấp', color: '#166534' },
}

const fmt = (s: string | null) => (s ? new Date(s).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }) : '')

function Stars({ n }: { n: number }) {
  return (
    <span aria-label={`${n} sao`} style={{ display: 'inline-flex', gap: 1 }}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star key={i} size={14} fill={i <= n ? '#f59e0b' : 'none'} color={i <= n ? '#f59e0b' : '#d1d5db'} />
      ))}
    </span>
  )
}

export default function ClientReviewsPage() {
  const { showToast } = useToast()
  const params = useParams<{ id: string }>()
  const clientId = params.id
  const [view, setView] = useState<'open' | 'done' | 'all'>('open')
  const [data, setData] = useState<Inbox | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [onlyUrgent, setOnlyUrgent] = useState(false)
  const [ownerLink, setOwnerLink] = useState('')

  const load = useCallback(async () => {
    const res = await fetch(`/api/reviews?client_id=${clientId}&view=${view}`)
    const json = await res.json()
    if (!res.ok) throw new Error(json.error || 'Không tải được hộp thư review')
    setData(json)
    if (json.owner_link_path) setOwnerLink(`${window.location.origin}${json.owner_link_path}`)
  }, [clientId, view])

  useEffect(() => {
    if (!REVIEW_INBOX_ENABLED) {
      setLoading(false)
      return
    }
    setLoading(true)
    load()
      .then(() => setError(''))
      .catch((e) => setError(e.message || 'Có lỗi xảy ra'))
      .finally(() => setLoading(false))
  }, [load])

  const list = useMemo(() => (data?.reviews || []).filter((r) => !onlyUrgent || r.urgency === 'high'), [data, onlyUrgent])

  async function refresh(fetchNow: boolean) {
    setBusy(fetchNow ? 'fetch' : 'import')
    try {
      const res = await fetch('/api/reviews/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: clientId, fetch: fetchNow }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Không cập nhật được')
      const n = (json.new_reviews ?? 0) + (json.imported ?? 0)
      showToast(n ? `Có ${n} review mới` : 'Không có review mới')
      await load()
    } catch (e: any) {
      showToast(e.message || 'Có lỗi xảy ra')
    } finally {
      setBusy(null)
    }
  }

  async function getOwnerLink(rotate: boolean) {
    setBusy('link')
    try {
      const res = await fetch('/api/reviews/link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: clientId, rotate }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Không tạo được link')
      const url = `${window.location.origin}${json.path}`
      setOwnerLink(url)
      await navigator.clipboard.writeText(url).catch(() => {})
      showToast(rotate ? 'Đã tạo link mới (link cũ hết hiệu lực) và sao chép' : 'Đã sao chép link duyệt')
    } catch (e: any) {
      showToast(e.message || 'Có lỗi xảy ra')
    } finally {
      setBusy(null)
    }
  }

  async function act(review: Review, action: string, extra: { text?: string; instruction?: string } = {}) {
    setBusy(review.id + action)
    try {
      const res = await fetch('/api/reviews/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ review_id: review.id, action, ...extra }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Không thực hiện được')
      if (json.warnings?.length) showToast(json.warnings[0])
      else showToast('Đã cập nhật')
      setData((d) => (d ? { ...d, reviews: d.reviews.map((r) => (r.id === review.id && json.review ? json.review : r)) } : d))
      return true
    } catch (e: any) {
      showToast(e.message || 'Có lỗi xảy ra')
      return false
    } finally {
      setBusy(null)
    }
  }

  if (!REVIEW_INBOX_ENABLED) {
    return (
      <Card>
        <div className="empty-note">Hộp thư review đang tắt.</div>
      </Card>
    )
  }
  if (loading && !data) {
    return (
      <Card>
        <div className="empty-note">Đang tải hộp thư review…</div>
      </Card>
    )
  }
  if (error) {
    return (
      <Card>
        <div className="empty-note error">{error}</div>
      </Card>
    )
  }
  if (!data) return null

  const ent = data.entitlement
  const openCount = ['new', 'drafted', 'approved', 'posting', 'failed'].reduce((s, k) => s + (data.counts[k] || 0), 0)
  const autoPost = ent.postViaMake && data.make_ready

  return (
    <>
      <Card>
        <div className="section-head">
          <div>
            <h2>Hộp thư review</h2>
            <p>
              {openCount} review cần xử lý{data.urgent_open ? `, ${data.urgent_open} khẩn` : ''}. Gói hiện tại: {FREQ_LABEL[ent.frequency] || ent.frequency}
              {ent.autoDraft ? ', tự soạn nháp' : ''}. Đã dùng {data.drafts_used}/{ent.monthlyDrafts} lượt soạn nháp AI tháng này.
            </p>
            {data.state?.last_checked_at ? (
              <p className="empty-note">
                Lần kiểm tra gần nhất: {fmt(data.state.last_checked_at)} ({data.state.last_source || 'không rõ nguồn'})
                {data.state.gbp_synced_at ? ` · đồng bộ Google Business: ${fmt(data.state.gbp_synced_at)}` : ''}
              </p>
            ) : null}
            {data.state?.last_error ? <p className="empty-note error">Lỗi lần trước: {data.state.last_error}</p> : null}
          </div>
          <Link href={`/clients/${clientId}`} className="secondary-button">
            Về doanh nghiệp
          </Link>
        </div>

        <div className="hero-actions" style={{ marginTop: 12, flexWrap: 'wrap' }}>
          <button className="secondary-button" disabled={!!busy} onClick={() => refresh(false)}>
            <RefreshCw size={16} /> {busy === 'import' ? 'Đang cập nhật…' : 'Lấy review từ lần kiểm tra hồ sơ'}
          </button>
          {ent.manualChecksPerMonth > 0 ? (
            <button className="primary-button" disabled={!!busy || data.manual_checks_used >= ent.manualChecksPerMonth} onClick={() => refresh(true)}>
              <RefreshCw size={16} /> {busy === 'fetch' ? 'Đang kiểm tra…' : `Kiểm tra review ngay (còn ${Math.max(0, ent.manualChecksPerMonth - data.manual_checks_used)} lần)`}
            </button>
          ) : null}
          {data.maps_link ? (
            <a className="secondary-button" href={data.maps_link} target="_blank" rel="noreferrer">
              <ExternalLink size={16} /> Mở hồ sơ Google Maps
            </a>
          ) : null}
        </div>

        <p className="empty-note" style={{ marginTop: 12 }}>
          {autoPost
            ? 'Phản hồi đã duyệt sẽ được đăng lên Google tự động qua Make (thường trong ngày). Google có thể kiểm duyệt phản hồi vài phút đến vài giờ.'
            : 'Phản hồi đã duyệt: bấm "Sao chép" rồi dán vào ô trả lời review trên Google Maps / Google Business Profile, sau đó bấm "Đã dán".'}
        </p>

        {ent.ownerLink ? (
          <div style={{ marginTop: 12 }}>
            <h3 style={{ fontSize: 15, marginBottom: 6 }}>Link duyệt cho chủ quán (không cần đăng nhập)</h3>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <input readOnly value={ownerLink} placeholder="Chưa tạo link" style={{ flex: 1, minWidth: 200, padding: '8px 10px', borderRadius: 8, border: '1px solid #d1d5db' }} />
              <button className="secondary-button" disabled={!!busy} onClick={() => getOwnerLink(false)}>
                <Copy size={16} /> {ownerLink ? 'Sao chép' : 'Tạo link'}
              </button>
              {ownerLink ? (
                <button className="secondary-button" disabled={!!busy} onClick={() => getOwnerLink(true)}>
                  <Link2 size={16} /> Đổi link
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
      </Card>

      <Card>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
          {(['open', 'done', 'all'] as const).map((v) => (
            <button key={v} className={view === v ? 'primary-button' : 'secondary-button'} onClick={() => setView(v)}>
              {v === 'open' ? 'Cần xử lý' : v === 'done' ? 'Đã xong' : 'Tất cả'}
            </button>
          ))}
          <label style={{ display: 'flex', gap: 6, alignItems: 'center', marginLeft: 'auto', fontSize: 14 }}>
            <input type="checkbox" checked={onlyUrgent} onChange={(e) => setOnlyUrgent(e.target.checked)} /> Chỉ review khẩn
          </label>
        </div>
        {list.length === 0 ? (
          <div className="empty-note">
            {view === 'open' ? 'Không có review nào cần xử lý.' : 'Chưa có review.'} Review được lấy từ lần "Kiểm tra hồ sơ" gần nhất
            {ent.frequency !== 'none' ? ' và được kiểm tra tự động theo gói.' : '.'}
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 12 }}>
            {list.map((r) => (
              <ReviewCard key={r.id} r={r} busy={busy} autoPost={autoPost} canDraft={data.drafts_used < ent.monthlyDrafts} managed={DONE_FOR_YOU_ENABLED && data.plan === 'done_for_you'} onAct={act} />
            ))}
          </div>
        )}
      </Card>
    </>
  )
}

function ReviewCard({
  r,
  busy,
  autoPost,
  canDraft,
  managed,
  onAct,
}: {
  r: Review
  busy: string | null
  autoPost: boolean
  canDraft: boolean
  managed: boolean
  onAct: (r: Review, action: string, extra?: { text?: string; instruction?: string }) => Promise<boolean>
}) {
  const { showToast } = useToast()
  const initial = r.final_reply ?? r.draft_reply ?? ''
  const [text, setText] = useState(initial)
  const [instruction, setInstruction] = useState('')
  const [copied, setCopied] = useState(false)
  useEffect(() => setText(r.final_reply ?? r.draft_reply ?? ''), [r.final_reply, r.draft_reply])
  const open = ['new', 'drafted', 'approved', 'failed'].includes(r.status)
  const dirty = text !== initial
  const u = URGENCY[r.urgency] || URGENCY.normal
  const isBusy = (a: string) => busy === r.id + a

  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      showToast('Đã sao chép. Dán vào ô trả lời review trên Google rồi bấm "Đã dán".')
    } catch {
      showToast('Không sao chép được, hãy chọn và copy bằng tay')
    }
  }

  return (
    <div style={{ border: '1px solid #e5e7eb', borderLeft: `4px solid ${u.color}`, borderRadius: 10, padding: 14 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <Stars n={r.rating} />
        <strong>{r.author_name || 'Khách'}</strong>
        <span style={{ color: '#6b7280', fontSize: 13 }}>{r.relative_time || (r.reviewed_at ? fmt(r.reviewed_at) : '')}</span>
        <span style={{ fontSize: 12, color: u.color, border: `1px solid ${u.color}`, borderRadius: 999, padding: '1px 8px' }}>{u.label}</span>
        <span style={{ fontSize: 12, background: '#f3f4f6', borderRadius: 999, padding: '1px 8px' }}>{STATUS_LABEL[r.status] || r.status}</span>
        {r.topics?.length ? <span style={{ fontSize: 12, color: '#6b7280' }}>{r.topics.join(' · ')}</span> : null}
      </div>
      <p style={{ margin: '8px 0', whiteSpace: 'pre-wrap' }}>{r.review_text || <em style={{ color: '#6b7280' }}>Khách chỉ chấm sao, không viết nội dung.</em>}</p>
      {r.ai_summary ? <p style={{ fontSize: 13, color: '#6b7280', margin: '0 0 8px' }}>Tóm tắt: {r.ai_summary}</p> : null}

      {r.owner_reply ? (
        <div style={{ background: '#f0fdf4', borderRadius: 8, padding: 10, fontSize: 14, marginBottom: 8 }}>
          <strong>Phản hồi đang hiện trên Google:</strong> {r.owner_reply}
          {r.gbp_reply_state && r.gbp_reply_state !== 'APPROVED' ? ` (Google: ${r.gbp_reply_state})` : ''}
        </div>
      ) : null}
      {r.status === 'posted' && !r.owner_reply ? (
        <p style={{ fontSize: 13, color: '#166534' }}>Đã đăng {r.posted_at ? fmt(r.posted_at) : ''}{r.gbp_reply_state ? ` — Google: ${r.gbp_reply_state}` : ''}</p>
      ) : null}
      {r.post_error ? <p className="empty-note error">Lỗi đăng: {r.post_error}</p> : null}
      {r.draft_warnings?.length ? (
        <ul style={{ margin: '0 0 8px', paddingLeft: 18, fontSize: 13, color: '#92400e' }}>
          {r.draft_warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      ) : null}

      {open || r.status === 'manual_copied' || r.status === 'posted' ? (
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          readOnly={!open || managed}
          rows={Math.min(8, Math.max(3, Math.ceil(text.length / 90)))}
          placeholder={open ? 'Chưa có bản nháp. Bấm "Soạn bằng AI" hoặc tự viết phản hồi…' : ''}
          style={{ width: '100%', padding: 10, borderRadius: 8, border: '1px solid #d1d5db', fontSize: 14, fontFamily: 'inherit' }}
        />
      ) : null}
      {open && !managed ? (
        <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
          <input
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            maxLength={300}
            placeholder="Ghi chú cho AI khi soạn lại (không bắt buộc), vd: nhắc đã thay nhân viên ca tối"
            style={{ flex: 1, padding: '6px 10px', borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 13 }}
          />
        </div>
      ) : null}

      {managed ? (
        <p style={{ fontSize: 13, color: '#6b7280', marginTop: 8 }}>Gói Làm hộ: đội ngũ của chúng tôi soạn, duyệt và đăng phản hồi này thay bạn, bạn không cần làm gì.</p>
      ) : null}
      <div style={{ display: managed ? 'none' : 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
        {open ? (
          <>
            <button
              className="secondary-button"
              disabled={!!busy || !canDraft}
              title={canDraft ? '' : 'Đã hết lượt soạn nháp AI tháng này'}
              onClick={() => onAct(r, 'redraft', { instruction: instruction || undefined })}
            >
              <Sparkles size={16} /> {isBusy('redraft') ? 'Đang soạn…' : r.draft_reply ? 'Soạn lại' : 'Soạn bằng AI'}
            </button>
            {dirty ? (
              <button className="secondary-button" disabled={!!busy} onClick={() => onAct(r, 'save', { text })}>
                Lưu nháp
              </button>
            ) : null}
            {r.status !== 'approved' ? (
              <button className="primary-button" disabled={!!busy || !text.trim()} onClick={() => onAct(r, 'approve', { text })}>
                <Check size={16} /> Duyệt
              </button>
            ) : (
              <>
                {dirty ? (
                  <button className="primary-button" disabled={!!busy || !text.trim()} onClick={() => onAct(r, 'approve', { text })}>
                    <Check size={16} /> Duyệt bản đã sửa
                  </button>
                ) : null}
                <button className="secondary-button" disabled={!!busy} onClick={() => onAct(r, 'unapprove')}>
                  <Undo2 size={16} /> Bỏ duyệt
                </button>
              </>
            )}
            <button className="secondary-button" disabled={!text.trim()} onClick={copy}>
              <Copy size={16} /> Sao chép
            </button>
            {copied || (r.status === 'approved' && !autoPost) ? (
              <button className="secondary-button" disabled={!!busy || !text.trim()} onClick={() => onAct(r, 'copied', { text })}>
                <MessageSquareReply size={16} /> Đã dán lên Google
              </button>
            ) : null}
            <button className="secondary-button" disabled={!!busy} onClick={() => onAct(r, 'ignore')}>
              <X size={16} /> Bỏ qua
            </button>
          </>
        ) : r.status !== 'posting' ? (
          <button className="secondary-button" disabled={!!busy} onClick={() => onAct(r, 'reopen')}>
            <Undo2 size={16} /> Mở lại
          </button>
        ) : null}
      </div>
      {r.status === 'approved' && autoPost && !r.gbp_review_name ? (
        <p style={{ fontSize: 12, color: '#6b7280', marginTop: 6 }}>Đang chờ Make ghép review với Google Business Profile. Nếu quá 1 ngày chưa đăng, hãy sao chép và dán tay.</p>
      ) : null}
    </div>
  )
}
