'use client'

import { Suspense, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Sparkles } from 'lucide-react'
import { buildDemoAudit } from '@/lib/demo-audit'
import { AuditResultView } from '@/components/dashboard/audit-result-view'

function DemoInner() {
  const params = useSearchParams()
  const [phone, setPhone] = useState('')
  const [name, setName] = useState(params.get('name') || '')
  const prefilled = Boolean(params.get('business') || params.get('status'))
  const [unlocked, setUnlocked] = useState(prefilled)

  const audit = useMemo(
    () =>
      buildDemoAudit({
        industry: params.get('industry') || 'other',
        city: params.get('city') || params.get('area') || 'Thanh Hóa',
        status: params.get('status') || 'buried',
        business: params.get('business') || '',
        mapsUrl: params.get('maps') || '',
        name,
        phone,
      }),
    [params, name, phone],
  )

  return (
    <div className="auth-page" style={{ alignItems: 'start', paddingTop: 48 }}>
      <div style={{ width: '100%', maxWidth: 920 }}>
        <div className="auth-brand" style={{ marginBottom: 16 }}>
          <div className="brand-mark">
            <Sparkles size={16} />
          </div>
          <span>
            local growth <strong>os</strong>
          </span>
        </div>
        <p className="overline">Bản xem trước khách</p>
        <h1 style={{ margin: '6px 0 8px', fontSize: 28, letterSpacing: '-0.04em' }}>Audit Google Business Profile</h1>
        <p className="auth-sub">Cùng giao diện sản phẩm chính. Chỉ mở điểm, ưu tiên Cao và 3 việc đầu.</p>

        {!unlocked && (
          <section className="panel" style={{ marginBottom: 16 }}>
            <div className="form-grid">
              <label className="field">
                <span>Tên bạn</span>
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nguyễn Minh" />
              </label>
              <label className="field">
                <span>Số Zalo</span>
                <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="09xx xxx xxx" />
              </label>
            </div>
            <div style={{ marginTop: 16 }}>
              <button className="primary-button" onClick={() => setUnlocked(true)} type="button">
                Xem audit sơ bộ
              </button>
            </div>
          </section>
        )}

        {unlocked && <AuditResultView audit={audit} teaser />}
      </div>
    </div>
  )
}

export default function PublicDemoAuditPage() {
  return (
    <Suspense fallback={<div className="auth-page">Đang mở bản xem trước...</div>}>
      <DemoInner />
    </Suspense>
  )
}
