'use client'

// Trang duyệt phản hồi review cho chủ quán — mở bằng link /r/<token>, không cần đăng nhập.
import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { Check, Sparkles, Star, X } from 'lucide-react'
import { Brand } from '@/components/dashboard/brand'
import { REVIEW_INBOX_ENABLED } from '@/lib/features'

type R = {
  id: string
  author_name: string | null
  rating: number
  review_text: string | null
  relative_time: string | null
  urgency: string
  ai_summary: string | null
  draft_reply: string | null
  draft_warnings: string[]
  final_reply: string | null
  status: string
}

export default function OwnerReviewApprovalPage() {
  const { token } = useParams<{ token: string }>()
  const [business, setBusiness] = useState('')
  const [items, setItems] = useState<R[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState('')

  const load = useCallback(async () => {
    const res = await fetch(`/api/public/reviews?token=${encodeURIComponent(token)}`)
    const json = await res.json()
    if (!res.ok) throw new Error(json.error || 'Không mở được link')
    setBusiness(json.business)
    setItems(json.reviews || [])
  }, [token])

  useEffect(() => {
    if (!REVIEW_INBOX_ENABLED) {
      setLoading(false)
      return
    }
    load()
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [load])

  async function act(id: string, action: string, text?: string) {
    setMsg('')
    const res = await fetch('/api/public/reviews', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, review_id: id, action, text }),
    })
    const json = await res.json()
    if (!res.ok) {
      setMsg(json.error || 'Không thực hiện được')
      return
    }
    setMsg(json.warnings?.[0] || (action === 'approve' ? 'Đã duyệt. Cảm ơn anh/chị!' : 'Đã cập nhật'))
    if (action === 'ignore' || action === 'approve') setItems((xs) => xs.map((x) => (x.id === id ? { ...x, ...json.review } : x)))
    else if (json.review) setItems((xs) => xs.map((x) => (x.id === id ? json.review : x)))
  }

  if (!REVIEW_INBOX_ENABLED) {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <Brand className="auth-brand" />
          <p className="auth-sub">Tính năng duyệt phản hồi đang tắt.</p>
        </div>
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '24px 16px' }}>
      <Brand />
      <h1 style={{ fontSize: 22, margin: '16px 0 4px' }}>Duyệt phản hồi review{business ? ` — ${business}` : ''}</h1>
      <p style={{ color: '#6b7280', marginBottom: 16 }}>Đọc bản nháp, sửa nếu cần rồi bấm Duyệt. Phản hồi sẽ hiện công khai trên Google Maps.</p>
      {loading ? <p>Đang tải…</p> : null}
      {error ? <p style={{ color: '#b91c1c' }}>{error}</p> : null}
      {msg ? <p style={{ background: '#eff6ff', padding: 10, borderRadius: 8 }}>{msg}</p> : null}
      {!loading && !error && items.length === 0 ? <p>Không có review nào đang chờ duyệt.</p> : null}
      <div style={{ display: 'grid', gap: 12 }}>
        {items.map((r) => (
          <OwnerCard key={r.id} r={r} onAct={act} />
        ))}
      </div>
    </div>
  )
}

function OwnerCard({ r, onAct }: { r: R; onAct: (id: string, action: string, text?: string) => Promise<void> }) {
  const [text, setText] = useState(r.final_reply ?? r.draft_reply ?? '')
  const [busy, setBusy] = useState(false)
  useEffect(() => setText(r.final_reply ?? r.draft_reply ?? ''), [r.final_reply, r.draft_reply])
  const done = r.status === 'approved' || r.status === 'ignored'
  const run = async (a: string, t?: string) => {
    setBusy(true)
    await onAct(r.id, a, t)
    setBusy(false)
  }
  return (
    <div style={{ border: '1px solid #e5e7eb', borderRadius: 12, padding: 14, opacity: done ? 0.75 : 1 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span>
          {[1, 2, 3, 4, 5].map((i) => (
            <Star key={i} size={14} fill={i <= r.rating ? '#f59e0b' : 'none'} color={i <= r.rating ? '#f59e0b' : '#d1d5db'} />
          ))}
        </span>
        <strong>{r.author_name || 'Khách'}</strong>
        <span style={{ color: '#6b7280', fontSize: 13 }}>{r.relative_time || ''}</span>
        {r.urgency === 'high' ? <span style={{ color: '#b91c1c', fontSize: 12 }}>Khẩn</span> : null}
        {r.status === 'approved' ? <span style={{ color: '#166534', fontSize: 12 }}>Đã duyệt</span> : null}
      </div>
      <p style={{ whiteSpace: 'pre-wrap', margin: '8px 0' }}>{r.review_text || <em>Khách chỉ chấm sao.</em>}</p>
      {r.draft_warnings?.length ? <p style={{ fontSize: 13, color: '#92400e' }}>{r.draft_warnings.join(' ')}</p> : null}
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={4}
        placeholder="Chưa có bản nháp — bấm Soạn giúp hoặc tự viết"
        style={{ width: '100%', padding: 10, borderRadius: 8, border: '1px solid #d1d5db', fontSize: 15, fontFamily: 'inherit' }}
      />
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
        <button className="primary-button" disabled={busy || !text.trim()} onClick={() => run('approve', text)}>
          <Check size={16} /> Duyệt
        </button>
        <button className="secondary-button" disabled={busy} onClick={() => run('redraft')}>
          <Sparkles size={16} /> Soạn giúp
        </button>
        {r.status !== 'ignored' ? (
          <button className="secondary-button" disabled={busy} onClick={() => run('ignore')}>
            <X size={16} /> Không phản hồi
          </button>
        ) : null}
      </div>
    </div>
  )
}
