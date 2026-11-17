'use client'

import { useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { Card } from '@/components/dashboard/shared'
import { useToast } from '@/components/dashboard/toast-context'
import { CATEGORY_SHARE_THRESHOLD, DESCRIPTION_MAX, type AuditAdvice } from '@/lib/audit-engine/advice'

/**
 * Thẻ tư vấn đặt đầu bản audit. Mọi con số đều đếm từ dữ liệu thật (các quán top cùng truy vấn, đánh giá của khách),
 * không có bước nào cần chủ quán nhập hay xác nhận. Thao tác duy nhất: sao chép.
 * Điểm nhớ của thẻ: thanh phân bố danh mục của các quán top, có vạch ngưỡng 40% và đánh dấu quán bạn đứng ở đâu.
 */

const VERDICT: Record<string, { label: string; tone: 'ok' | 'warn' | 'idle' }> = {
  keep: { label: 'Giữ nguyên', tone: 'ok' },
  consider: { label: 'Cân nhắc đổi', tone: 'warn' },
  unknown: { label: 'Chưa đủ dữ liệu', tone: 'idle' },
}

const DESC_STATE: Record<string, { label: string; tone: 'ok' | 'warn' | 'idle' }> = {
  ok: { label: 'Ổn', tone: 'ok' },
  short: { label: 'Còn ngắn', tone: 'warn' },
  long: { label: 'Quá dài', tone: 'warn' },
  risky: { label: 'Có nội dung không được phép', tone: 'warn' },
  unreadable: { label: 'Chưa đọc được', tone: 'idle' },
}

export function AdviceCard({ advice }: { advice: AuditAdvice; clientId?: string }) {
  const { showToast } = useToast()
  const [copied, setCopied] = useState<string | null>(null)
  const [draftIdx, setDraftIdx] = useState(0)

  const p = advice.primary
  const v = VERDICT[p.verdict] ?? VERDICT.unknown
  const total = p.evidence.total
  const drafts = advice.drafts ?? []
  const draft = drafts[Math.min(draftIdx, Math.max(0, drafts.length - 1))]
  const ds = DESC_STATE[advice.description.state] ?? DESC_STATE.unreadable
  const supported = advice.secondary.suggested.filter((s) => s.supported)
  const others = advice.secondary.suggested.filter((s) => !s.supported)

  // Các dòng của thanh: 5 danh mục chính phổ biến nhất + dòng "quán bạn" nếu chưa nằm trong đó.
  const ownKey = (p.evidence.ownPrimary || '').toLowerCase()
  const rows = p.evidence.primaries.slice(0, 5).map((r) => ({
    name: r.name,
    count: r.count,
    own: r.name.toLowerCase() === ownKey,
    suggested: !!p.suggested && r.name.toLowerCase() === p.suggested.toLowerCase(),
  }))
  if (p.evidence.ownPrimary && !rows.some((r) => r.own)) {
    rows.push({ name: p.evidence.ownPrimary, count: p.evidence.ownPrimaryCount, own: true, suggested: false })
  }

  async function copy(key: string, text: string) {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(key)
      showToast('Đã sao chép')
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 1600)
    } catch {
      showToast('Không sao chép được, bạn bôi đen và copy thủ công nhé')
    }
  }

  return (
    <div className="ad-root ad-grid">
      <style>{CSS}</style>
      <Card className="ad-card ad-wide">
        <header className="ad-head">
          <div>
            <h2 className="ad-title">Lĩnh vực chính</h2>
            <p className="ad-sub">Yếu tố ảnh hưởng nhất tới việc Google đưa quán cho khách nào</p>
          </div>
          <span className={`ad-chip ad-${v.tone}`}>{v.label}</span>
        </header>

        <p className="ad-verdict">
          {p.verdict === 'keep' && <>Nên giữ <b>{p.current}</b></>}
          {p.verdict === 'consider' && <>Cân nhắc đổi sang <b>{p.suggested}</b></>}
          {p.verdict === 'unknown' && <>Chưa đủ quán top để so sánh</>}
        </p>
        <p className="ad-reason">{p.reason}</p>
        {p.quotes?.length > 0 && (
          <ul className="ad-quotes" aria-label="Khách nói">
            {p.quotes.map((q) => (
              <li key={q}>“{q}”</li>
            ))}
          </ul>
        )}
        {p.caution && <p className="ad-caution">{p.caution}</p>}

        {rows.length > 0 && total > 0 && (
          <div className="ad-bars" role="img" aria-label="Tỉ lệ các quán top dùng từng danh mục chính">
            <div className="ad-bars-axis" style={{ left: `${CATEGORY_SHARE_THRESHOLD * 100}%` }}>
              <span>ngưỡng phổ biến {Math.round(CATEGORY_SHARE_THRESHOLD * 100)}%</span>
            </div>
            {rows.map((r, i) => {
              const pct = Math.round((r.count / total) * 100)
              return (
                <div className={`ad-row${r.own ? ' ad-own' : ''}${r.suggested ? ' ad-sug' : ''}`} key={r.name}>
                  <div className="ad-row-label">
                    <span className="ad-name">{r.name}</span>
                    {r.own && <span className="ad-tag">quán bạn</span>}
                    {r.suggested && <span className="ad-tag ad-tag-sug">gợi ý</span>}
                    <span className="ad-count">{r.count}/{total}</span>
                  </div>
                  <div className="ad-track">
                    <div className="ad-fill" style={{ width: `${Math.max(pct, r.count ? 3 : 0)}%`, animationDelay: `${i * 70}ms` }} />
                  </div>
                </div>
              )
            })}
          </div>
        )}

      </Card>

      {(supported.length > 0 || others.length > 0) && (
        <Card className="ad-card">
          <section className="ad-block">
            <div className="ad-block-head">
              <h3>Danh mục phụ nên thêm</h3>
              {supported.length > 0 && (
                <button className="ad-copy" onClick={() => copy('sec', supported.map((s) => s.name).join('\n'))}>
                  {copied === 'sec' ? <Check size={14} /> : <Copy size={14} />} Sao chép
                </button>
              )}
            </div>
            {supported.length > 0 && (
              <div className="ad-chips">
                {supported.map((s) => (
                  <span className="ad-chip-sec" key={s.name} title={s.reviews ? `${s.reviews} đánh giá của khách nhắc tới` : 'Có trong dịch vụ/mô tả của hồ sơ'}>
                    {s.name}
                    <i>{s.count}/{s.total} quán top</i>
                  </span>
                ))}
              </div>
            )}
            {others.length > 0 && (
              <p className="ad-muted">
                Đối thủ còn dùng: {others.map((s) => `${s.name} (${s.count}/${s.total})`).join(', ')}. Chỉ thêm nếu quán thật sự làm dịch vụ này; chưa thấy dấu hiệu trong hồ sơ hoặc đánh giá.
              </p>
            )}
          </section>
        </Card>
      )}

      <Card className={`ad-card${supported.length > 0 || others.length > 0 ? ' ad-desc' : ' ad-wide'}`}>
        <section className="ad-block">
          <div className="ad-block-head">
            <h3>Mô tả</h3>
            <span className={`ad-chip ad-${ds.tone}`}>{ds.label}</span>
          </div>
          {advice.description.state === 'unreadable' && (
            <p className="ad-muted">Chưa đọc được mô tả hiện tại từ dữ liệu công khai. Nếu bạn đã có mô tả, so với mẫu bên dưới trước khi thay.</p>
          )}
          {advice.description.issues.length > 0 && (
            <ul className="ad-issues">
              {advice.description.issues.map((i) => (
                <li key={i}>{i}</li>
              ))}
            </ul>
          )}
          {advice.description.state === 'ok' && <p className="ad-muted">Độ dài và nội dung ổn, chưa cần viết lại.</p>}

          {draft && (
            <div className="ad-draft">
              {drafts.length > 1 && (
                <div className="ad-seg" role="tablist" aria-label="Chọn mẫu mô tả">
                  {drafts.map((d, i) => (
                    <button key={d.label} role="tab" aria-selected={i === draftIdx} className={i === draftIdx ? 'on' : ''} onClick={() => setDraftIdx(i)}>
                      {d.label}
                    </button>
                  ))}
                </div>
              )}
              <p className="ad-draft-text">{draft.text}</p>
              <div className="ad-draft-foot">
                <div className="ad-meter" aria-label={`${draft.text.length} trên ${DESCRIPTION_MAX} ký tự`}>
                  <div style={{ width: `${Math.min(100, (draft.text.length / DESCRIPTION_MAX) * 100)}%` }} />
                </div>
                <span className="ad-count">{draft.text.length}/{DESCRIPTION_MAX}</span>
                <button className="ad-copy ad-copy-main" onClick={() => copy('draft', draft.text)}>
                  {copied === 'draft' ? <Check size={14} /> : <Copy size={14} />} Sao chép mô tả
                </button>
              </div>
              <p className="ad-muted">
                {draft.by === 'ai'
                  ? 'AI soạn từ dữ kiện hồ sơ và ý chính trong đánh giá của khách, đã loại link, khuyến mãi và con số không có trong dữ kiện.'
                  : 'Mẫu ghép từ tên, danh mục và khu vực của hồ sơ.'}{' '}
                Thêm điểm khác biệt có thật của quán (số năm, chứng nhận…) trước khi dán.
              </p>
            </div>
          )}
        </section>
      </Card>
    </div>
  )
}

const CSS = `
.ad-root { --ad-line: var(--border-strong, rgb(128 140 180 / .28)); --ad-dim: var(--muted-foreground, #8a93b2); --ad-ok: var(--success, #4fbf93); --ad-warn: var(--warning, #e3a53f); --ad-acc: var(--primary, #6f7dff); }
.ad-root .ad-head { display:flex; justify-content:space-between; align-items:flex-start; gap:12px; }
.ad-root .ad-title { margin:0; font-size:18px; font-weight:650; letter-spacing:-.01em; }
.ad-root .ad-sub { margin:2px 0 0; font-size:13px; color:var(--ad-dim); }
.ad-root .ad-chip { flex:none; font-size:12.5px; font-weight:600; padding:4px 11px; border-radius:999px; border:1px solid currentColor; }
.ad-root .ad-ok { color:var(--ad-ok); background:color-mix(in srgb, var(--ad-ok) 12%, transparent); }
.ad-root .ad-warn { color:var(--ad-warn); background:color-mix(in srgb, var(--ad-warn) 14%, transparent); }
.ad-root .ad-idle { color:var(--ad-dim); background:transparent; }
.ad-root .ad-verdict { margin:16px 0 4px; font-size:20px; line-height:1.3; letter-spacing:-.01em; }
.ad-root .ad-verdict b { font-weight:700; }
.ad-root .ad-reason { margin:0; font-size:14px; line-height:1.65; color:var(--ad-dim); max-width:68ch; }
.ad-root .ad-quotes { margin:10px 0 0; padding:0; list-style:none; display:grid; gap:6px; max-width:68ch; }
.ad-root .ad-quotes li { font-size:13px; line-height:1.55; padding-left:12px; border-left:2px solid var(--ad-line); color:var(--ad-dim); font-style:italic; }
.ad-root .ad-caution { margin:10px 0 0; padding:10px 12px; font-size:13px; line-height:1.55; border-left:3px solid var(--ad-warn); background:color-mix(in srgb, var(--ad-warn) 10%, transparent); border-radius:0 8px 8px 0; max-width:68ch; }

.ad-root .ad-bars { position:relative; margin-top:20px; padding-top:20px; display:grid; gap:11px; }
.ad-root .ad-bars-axis { position:absolute; top:0; bottom:0; width:0; border-left:1px dashed var(--ad-line); pointer-events:none; }
.ad-root .ad-bars-axis span { position:absolute; top:-1px; left:6px; font-size:11px; color:var(--ad-dim); white-space:nowrap; }
.ad-root .ad-row-label { display:flex; align-items:baseline; gap:8px; margin-bottom:5px; font-size:13.5px; }
.ad-root .ad-name { font-weight:500; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.ad-root .ad-count { margin-left:auto; font-variant-numeric:tabular-nums; font-size:12.5px; color:var(--ad-dim); }
.ad-root .ad-tag { font-size:11.5px; padding:1px 8px; border-radius:6px; border:1px solid var(--ad-acc); color:var(--ad-acc); white-space:nowrap; }
.ad-root .ad-tag-sug { border-color:var(--ad-warn); color:var(--ad-warn); }
.ad-root .ad-track { height:9px; border-radius:5px; background:color-mix(in srgb, var(--ad-line) 45%, transparent); overflow:hidden; }
.ad-root .ad-fill { height:100%; border-radius:5px; background:color-mix(in srgb, var(--ad-dim) 55%, transparent); transform-origin:left; animation:ad-grow .7s cubic-bezier(.2,.8,.2,1) both; }
.ad-root .ad-own .ad-fill { background:var(--ad-acc); }
.ad-root .ad-sug .ad-fill { background:var(--ad-warn); }
@keyframes ad-grow { from { transform:scaleX(0); } to { transform:scaleX(1); } }

.ad-root.ad-grid { display:grid; gap:14px; grid-template-columns:minmax(0,1fr); }
.ad-root .ad-wide { grid-column:1 / -1; }
.ad-root .ad-card { align-self:start; }
@media (min-width: 960px) { .ad-root.ad-grid { grid-template-columns:minmax(0,1fr) minmax(0,1.5fr); } }
.ad-root .ad-block { margin:0; padding:0; border:0; }
.ad-root .ad-block-head { display:flex; align-items:center; justify-content:space-between; gap:10px; margin-bottom:10px; }
.ad-root .ad-block-head h3 { margin:0; font-size:15px; font-weight:650; }
.ad-root .ad-chips { display:flex; flex-wrap:wrap; gap:8px; }
.ad-root .ad-chip-sec { display:inline-flex; align-items:baseline; gap:8px; padding:6px 12px; border-radius:10px; font-size:13.5px; font-weight:550; background:color-mix(in srgb, var(--ad-acc) 14%, transparent); border:1px solid color-mix(in srgb, var(--ad-acc) 40%, transparent); }
.ad-root .ad-chip-sec i { font-style:normal; font-size:11.5px; font-weight:400; color:var(--ad-dim); font-variant-numeric:tabular-nums; }
.ad-root .ad-muted { margin:10px 0 0; font-size:12.5px; line-height:1.6; color:var(--ad-dim); max-width:68ch; }
.ad-root .ad-issues { margin:0 0 4px; padding-left:18px; font-size:13.5px; line-height:1.6; color:var(--ad-warn); }

.ad-root .ad-draft { margin-top:6px; }
.ad-root .ad-seg { display:inline-flex; gap:4px; padding:3px; border-radius:10px; border:1px solid var(--ad-line); margin-bottom:10px; }
.ad-root .ad-seg button { border:0; background:transparent; color:var(--ad-dim); font:inherit; font-size:13px; padding:5px 12px; border-radius:7px; cursor:pointer; }
.ad-root .ad-seg button.on { background:var(--ad-acc); color:#fff; }
.ad-root .ad-seg button:focus-visible, .ad-root .ad-copy:focus-visible { outline:2px solid var(--ad-acc); outline-offset:2px; }
.ad-root .ad-draft-text { margin:0; padding:14px 16px; font-size:14.5px; line-height:1.7; border-radius:12px; border:1px solid var(--ad-line); background:color-mix(in srgb, var(--ad-line) 18%, transparent); max-width:68ch; }
.ad-root .ad-draft-foot { display:flex; align-items:center; gap:12px; margin-top:10px; flex-wrap:wrap; }
.ad-root .ad-meter { flex:1 1 120px; height:5px; border-radius:3px; background:color-mix(in srgb, var(--ad-line) 45%, transparent); overflow:hidden; }
.ad-root .ad-meter div { height:100%; background:var(--ad-ok); }
.ad-root .ad-copy { white-space:nowrap; flex:none; display:inline-flex; align-items:center; gap:6px; font:inherit; font-size:13px; padding:6px 12px; border-radius:9px; border:1px solid var(--ad-line); background:transparent; color:inherit; cursor:pointer; }
.ad-root .ad-copy:hover { border-color:var(--ad-acc); }
.ad-root .ad-copy-main { background:var(--ad-acc); border-color:var(--ad-acc); color:#fff; font-weight:600; }
@media (max-width: 520px) { .ad-root .ad-verdict { font-size:18px; } .ad-root .ad-head { flex-direction:column; } }
`
