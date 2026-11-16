'use client'

import { useEffect, useState } from 'react'
import { Check, Copy, Loader2 } from 'lucide-react'
import { Card } from '@/components/dashboard/shared'
import { useToast } from '@/components/dashboard/toast-context'
import type { AuditAdvice, DescriptionDraft } from '@/lib/audit-engine/advice'

const DESC_NOTE: Record<string, string> = {
  unreadable: 'Chưa đọc được mô tả hiện tại từ dữ liệu công khai. Nếu bạn đã có mô tả, so với mẫu bên dưới; chưa có thì dùng mẫu.',
  short: 'Mô tả hiện tại còn ngắn.',
  long: 'Mô tả hiện tại vượt giới hạn của Google.',
  risky: 'Mô tả hiện tại có nội dung Google không cho phép.',
}

/**
 * Lời khuyên ngắn, đặt đầu bản audit: (1) danh mục chính — yếu tố ảnh hưởng nhất tới xếp hạng, (2) hiểu quán + mô tả mẫu.
 * Mô tả chỉ viết sau khi chủ quán xác nhận "Mình hiểu quán bạn là…". Mô tả giúp khách chọn quán chứ không phải mẹo lên top.
 */
export function AdviceCard({ clientId, advice, onChanged }: { clientId: string; advice: AuditAdvice; onChanged?: () => void }) {
  const { showToast } = useToast()
  const p = advice.primary
  const profile = advice.profile
  const [confirmed, setConfirmed] = useState(profile?.state === 'confirmed')
  const [editing, setEditing] = useState(false)
  const [main, setMain] = useState(profile?.mainService ?? '')
  const [others, setOthers] = useState((profile?.services ?? []).join(', '))
  const [busy, setBusy] = useState(false)
  const [drafts, setDrafts] = useState<DescriptionDraft[]>([])
  const [err, setErr] = useState('')
  const [copied, setCopied] = useState<number | null>(null)

  async function confirm(edited: boolean) {
    if (!profile) return
    setBusy(true)
    setErr('')
    try {
      const res = await fetch(`/api/clients/${clientId}/profile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          summary: profile.summary,
          main_service: edited ? main : profile.mainService,
          services: edited ? others.split(',').map((s) => s.trim()).filter(Boolean) : profile.services,
          edited,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Chưa lưu được. Thử lại sau ít phút.')
      setConfirmed(true)
      setEditing(false)
      setDrafts(data.drafts || [])
      if (!(data.drafts || []).length) setErr('Chưa viết được mô tả mẫu phù hợp. Bạn thử bấm lại hoặc sửa dịch vụ cho rõ hơn.')
      onChanged?.()
    } catch (e: any) {
      setErr(e.message || 'Có lỗi xảy ra')
    } finally {
      setBusy(false)
    }
  }

  async function copy(i: number, text: string) {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(i)
      showToast('Đã sao chép mô tả')
      setTimeout(() => setCopied(null), 1500)
    } catch {
      showToast('Không sao chép được, bạn bôi đen và copy thủ công nhé')
    }
  }

  // Hồ sơ đã xác nhận từ lần trước: nạp lại mô tả mẫu đã lưu (audit không trả kèm).
  useEffect(() => {
    if (profile?.state !== 'confirmed') return
    let cancelled = false
    fetch(`/api/clients/${clientId}/profile`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled && d?.profile?.drafts?.length) setDrafts(d.profile.drafts)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [clientId, profile?.state])

  const needMore = advice.description.state !== 'ok'

  return (
    <Card>
      <div className="section-head">
        <div>
          <h2>Lĩnh vực chính (danh mục)</h2>
          <p>Yếu tố ảnh hưởng nhiều nhất tới việc Google đưa quán cho khách nào</p>
        </div>
      </div>

      <div className={`insight${p.verdict === 'consider' ? ' warning' : ''}`} style={{ marginTop: 0 }}>
        <h3>
          {p.verdict === 'keep' && `Nên giữ nguyên: ${p.current ?? ''}`}
          {p.verdict === 'consider' && `Cân nhắc đổi sang: ${p.suggested}`}
          {p.verdict === 'unknown' && 'Chưa đủ dữ liệu để khuyên'}
        </h3>
        <p>{p.reason}</p>
        {p.caution && <p style={{ marginTop: 6 }}>⚠ {p.caution}</p>}
        {p.verdict === 'consider' && profile && !confirmed && (
          <p style={{ marginTop: 6 }}>Gợi ý này dựa trên cách mình hiểu về quán ở bên dưới. Hãy xác nhận cho đúng trước khi đổi.</p>
        )}
      </div>

      {advice.secondary.suggested.length > 0 && (
        <div className="insight" style={{ background: 'var(--surface-muted, rgb(255 255 255 / .04))' }}>
          <h3>Nên thêm danh mục phụ</h3>
          <p>
            {advice.secondary.suggested.map((s) => `${s.name} (${s.count}/${s.total} quán top dùng)`).join('; ')}. Chỉ thêm khi đúng dịch vụ quán đang làm.
          </p>
        </div>
      )}

      {profile && (
        <div className="insight" style={{ background: 'var(--primary-soft, rgb(124 140 255 / .12))' }}>
          <h3>{confirmed ? 'Hồ sơ quán đã xác nhận' : 'Mình đoán quán bạn như sau, đúng không?'}</h3>
          <p>{profile.summary}</p>
          {profile.evidence && !confirmed && (
            <p style={{ marginTop: 4, fontSize: 12.5, color: 'var(--muted-foreground)' }}>
              Dựa trên: tên quán{profile.evidence.category ? `, danh mục "${profile.evidence.category}"` : ''}, {profile.evidence.reviewsRead} đánh giá đã đọc
              {profile.evidence.reviewsRead > 0 ? ` (${profile.evidence.mentionsMain} nhắc tới dịch vụ chính)` : ''}.
            </p>
          )}
          {!confirmed && profile.confidence === 'low' && profile.question && (
            <p style={{ marginTop: 6 }}>Mình chưa chắc lắm. {profile.question} Bạn sửa giúp ở nút bên dưới.</p>
          )}

          {!confirmed && !editing && (
            <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
              <button className="primary-button" disabled={busy || profile.confidence === 'low'} onClick={() => confirm(false)}>
                {busy && <Loader2 size={16} className="animate-spin" />}
                Đúng rồi
              </button>
              <button className="secondary-button" disabled={busy} onClick={() => setEditing(true)}>
                Chưa đúng, sửa lại
              </button>
            </div>
          )}

          {!confirmed && editing && (
            <div className="form-grid" style={{ marginTop: 12 }}>
              <label className="field">
                <span>Dịch vụ chính</span>
                <input value={main} onChange={(e) => setMain(e.target.value)} maxLength={120} />
              </label>
              <label className="field wide">
                <span>Các dịch vụ khác (cách nhau bằng dấu phẩy)</span>
                <input value={others} onChange={(e) => setOthers(e.target.value)} maxLength={400} />
              </label>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="primary-button" disabled={busy || !main.trim()} onClick={() => confirm(true)}>
                  {busy && <Loader2 size={16} className="animate-spin" />}
                  Lưu và viết mô tả
                </button>
                <button className="secondary-button" disabled={busy} onClick={() => setEditing(false)}>
                  Hủy
                </button>
              </div>
            </div>
          )}
          {err && <p style={{ marginTop: 8, color: 'var(--danger)' }}>{err}</p>}
        </div>
      )}

      {confirmed && needMore && drafts.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <h3 style={{ margin: '0 0 4px', fontSize: 15 }}>Mô tả mẫu cho hồ sơ</h3>
          <p style={{ margin: '0 0 10px', fontSize: 13, color: 'var(--muted-foreground)' }}>
            {DESC_NOTE[advice.description.state] ? `${DESC_NOTE[advice.description.state]} ` : ''}
            Đây là bản nháp, bạn đọc lại và sửa cho đúng thực tế (số năm, chứng nhận… bạn tự thêm nếu có). Mô tả giúp khách hiểu và chọn quán, không phải mẹo lên top.
          </p>
          {drafts.map((d, i) => (
            <div key={d.text} style={{ border: '1px solid var(--border-strong)', borderRadius: 12, padding: 12, marginBottom: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <strong style={{ fontSize: 13 }}>{d.label}</strong>
                <button className="secondary-button" onClick={() => copy(i, d.text)}>
                  {copied === i ? <Check size={14} /> : <Copy size={14} />} Sao chép
                </button>
              </div>
              <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6 }}>{d.text}</p>
              <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--faint, #6f7899)' }}>{d.text.length}/750 ký tự</p>
            </div>
          ))}
        </div>
      )}
      {confirmed && !needMore && <p style={{ margin: '12px 0 0', fontSize: 13, color: 'var(--muted-foreground)' }}>Mô tả hiện tại đã ổn về độ dài và quy định, chưa cần viết lại.</p>}
    </Card>
  )
}
