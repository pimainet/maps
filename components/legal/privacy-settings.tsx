'use client'

// Cài đặt → Dữ liệu & quyền riêng tư: xem/đổi đồng ý, tải dữ liệu về, yêu cầu xoá tài khoản (Luật 91/2025/QH15 Điều 4, 10, 14).
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { CONSENT_PURPOSES, LEGAL_ENTITY } from '@/lib/privacy/policy'

type ConsentInfo = {
  version: string
  setup_required: boolean
  needs_consent: boolean
  current: { version: string; purposes: Record<string, boolean>; at: string } | null
  history: { policy_version: string; purposes: Record<string, boolean>; action: string; source: string; recorded_at: string }[]
}
type DeleteInfo = {
  setup_required: boolean
  request: { id: string; status: string; received_at: string; scheduled_for: string | null; due_at: string } | null
  plan: { delete_workspaces: string[]; leave_workspaces: string[]; blockers: string[] }
  grace_days: number
  confirm_phrase: string
}

const fmt = (iso?: string | null) => (iso ? new Date(iso).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }) : '—')
const SOURCE_LABEL: Record<string, string> = { signup: 'Lúc đăng ký', consent_gate: 'Khi đăng nhập', settings: 'Trong Cài đặt', admin: 'Quản trị' }
const STATUS_LABEL: Record<string, string> = {
  received: 'Đã nhận',
  scheduled: 'Đã lên lịch xoá',
  processing: 'Đang xử lý',
  needs_attention: 'Đang chờ nhân viên xử lý',
}

export function PrivacySettings() {
  const [consent, setConsent] = useState<ConsentInfo | null>(null)
  const [del, setDel] = useState<DeleteInfo | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState('')

  async function load() {
    setError('')
    try {
      const [c, d] = await Promise.all([fetch('/api/consent', { cache: 'no-store' }), fetch('/api/account/delete-request', { cache: 'no-store' })])
      const cj = await c.json()
      const dj = await d.json()
      if (!c.ok) throw new Error(cj.error || 'Không tải được thông tin đồng ý')
      if (!d.ok) throw new Error(dj.error || 'Không tải được thông tin xoá tài khoản')
      setConsent(cj)
      setDel(dj)
    } catch (e: any) {
      setError(e.message || 'Có lỗi xảy ra')
    }
  }
  useEffect(() => {
    load()
  }, [])

  async function setMarketing(next: boolean) {
    if (!consent?.current) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const r = await fetch('/api/consent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: 'settings', purposes: { ...consent.current.purposes, service: true, cross_border: true, marketing: next } }),
      })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error || 'Chưa lưu được')
      setNotice(next ? 'Đã bật nhận email ưu đãi.' : 'Đã rút lại đồng ý nhận email ưu đãi.')
      await load()
    } catch (e: any) {
      setError(e.message || 'Có lỗi xảy ra')
    } finally {
      setBusy(false)
    }
  }

  async function requestDelete() {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const r = await fetch('/api/account/delete-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm }),
      })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error || 'Chưa gửi được yêu cầu')
      setNotice(`Đã nhận yêu cầu xoá tài khoản. Tài khoản sẽ bị xoá vào khoảng ${fmt(data.request?.scheduled_for)}; trước thời điểm đó bạn có thể huỷ.`)
      setConfirm('')
      await load()
    } catch (e: any) {
      setError(e.message || 'Có lỗi xảy ra')
    } finally {
      setBusy(false)
    }
  }

  async function cancelDelete() {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const r = await fetch('/api/account/delete-request', { method: 'DELETE' })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error || 'Chưa huỷ được')
      setNotice('Đã huỷ yêu cầu xoá tài khoản.')
      await load()
    } catch (e: any) {
      setError(e.message || 'Có lỗi xảy ra')
    } finally {
      setBusy(false)
    }
  }

  const marketing = consent?.current?.purposes?.marketing === true

  return (
    <>
      <div className="section-head">
        <div>
          <h2>Dữ liệu &amp; quyền riêng tư</h2>
          <p>
            Quyền của bạn theo Luật Bảo vệ dữ liệu cá nhân 2025. Xem <Link href="/privacy">Chính sách bảo mật</Link>.
          </p>
        </div>
      </div>
      {error && <div className="alert alert-error" style={{ marginBottom: 16 }}>{error}</div>}
      {notice && <div className="alert alert-ok" style={{ marginBottom: 16 }}>{notice}</div>}
      {!consent && !error && <div className="empty-note">Đang tải…</div>}

      {consent && (
        <section className="privacy-block">
          <h3>Sự đồng ý của bạn</h3>
          {consent.setup_required ? (
            <p className="rail-sub">Hệ thống chưa bật lưu đồng ý (thiếu bản cập nhật cơ sở dữ liệu 033).</p>
          ) : consent.current ? (
            <>
              <ul className="privacy-list">
                {CONSENT_PURPOSES.map((p) => (
                  <li key={p.key}>
                    {consent.current!.purposes[p.key] ? '✓' : '✗'} {p.required ? 'Bắt buộc' : 'Không bắt buộc'}: {p.label.replace(/^Không bắt buộc: /, '')}
                  </li>
                ))}
              </ul>
              <p className="rail-sub">
                Phiên bản {consent.current.version}, ghi nhận lúc {fmt(consent.current.at)}.
              </p>
              <label className="switch">
                <span>
                  <strong>Nhận email giới thiệu tính năng và ưu đãi</strong>
                  <small>Không bắt buộc. Rút lại có hiệu lực ngay.</small>
                </span>
                <input type="checkbox" role="switch" checked={marketing} disabled={busy} onChange={(e) => setMarketing(e.target.checked)} />
              </label>
              <p className="rail-sub">
                Các mục bắt buộc là điều kiện để cung cấp dịch vụ. Muốn rút lại, hãy yêu cầu xoá tài khoản ở dưới hoặc gửi
                email tới {LEGAL_ENTITY.email}.
              </p>
              {consent.history.length > 1 && (
                <details>
                  <summary>Lịch sử đồng ý ({consent.history.length})</summary>
                  <ul className="privacy-list">
                    {consent.history.map((h, i) => (
                      <li key={i}>
                        {fmt(h.recorded_at)} · {SOURCE_LABEL[h.source] || h.source} · phiên bản {h.policy_version} · ưu đãi:{' '}
                        {h.purposes?.marketing ? 'có' : 'không'}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </>
          ) : (
            <p className="rail-sub">Chưa có bản ghi đồng ý.</p>
          )}
        </section>
      )}

      <section className="privacy-block">
        <h3>Tải dữ liệu của tôi</h3>
        <p className="rail-sub">
          Tệp JSON gồm tài khoản, lịch sử đồng ý, thanh toán và dữ liệu của các không gian làm việc bạn là chủ sở hữu / quản trị.
          Không gồm mã bí mật và nội dung Google Maps mà Google không cho xuất lại.
        </p>
        <a className="secondary-button" href="/api/account/export" download>
          Tải về (JSON)
        </a>
      </section>

      {del && (
        <section className="privacy-block privacy-danger">
          <h3>Xoá tài khoản</h3>
          {del.setup_required ? (
            <p className="rail-sub">Gửi email tới {LEGAL_ENTITY.email} để yêu cầu xoá tài khoản (xử lý trong 20 ngày).</p>
          ) : del.request ? (
            <>
              <p>
                Trạng thái: <strong>{STATUS_LABEL[del.request.status] || del.request.status}</strong> · gửi lúc {fmt(del.request.received_at)}
                {del.request.scheduled_for && <> · dự kiến xoá {fmt(del.request.scheduled_for)}</>} · hạn chót {fmt(del.request.due_at)}
              </p>
              {['received', 'scheduled'].includes(del.request.status) && (
                <button className="secondary-button" onClick={cancelDelete} disabled={busy}>
                  Huỷ yêu cầu xoá
                </button>
              )}
            </>
          ) : (
            <>
              <ul className="privacy-list">
                {del.plan.delete_workspaces.length > 0 && (
                  <li>Xoá vĩnh viễn không gian làm việc: {del.plan.delete_workspaces.join(', ')} (doanh nghiệp, kế hoạch, nội dung, review, ảnh, kết nối Google).</li>
                )}
                {del.plan.leave_workspaces.length > 0 && <li>Rời khỏi (không xoá dữ liệu của người khác): {del.plan.leave_workspaces.join(', ')}.</li>}
                <li>Xoá tài khoản đăng nhập và hồ sơ của bạn sau {del.grace_days} ngày; trong thời gian đó bạn có thể huỷ.</li>
                <li>
                  Giữ lại theo luật: đơn hàng, thanh toán, biên nhận (10 năm, Luật Kế toán) — được tách khỏi tài khoản; bằng chứng
                  đồng ý (5 năm, không còn IP / trình duyệt).
                </li>
              </ul>
              {del.plan.blockers.length > 0 ? (
                <div className="alert alert-warn">
                  Bạn là chủ sở hữu duy nhất của {del.plan.blockers.join(', ')} — nơi còn thành viên khác. Hãy chuyển quyền chủ sở hữu
                  hoặc xoá các thành viên ở tab Thành viên trước.
                </div>
              ) : (
                <div className="privacy-confirm">
                  <label>
                    <span>
                      Gõ <b>{del.confirm_phrase}</b> để xác nhận
                    </span>
                    <input value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder={del.confirm_phrase} aria-label="Câu xác nhận xoá tài khoản" />
                  </label>
                  <button className="danger-button" onClick={requestDelete} disabled={busy || !confirm.trim()}>
                    Yêu cầu xoá tài khoản
                  </button>
                </div>
              )}
            </>
          )}
        </section>
      )}
    </>
  )
}
