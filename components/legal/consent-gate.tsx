'use client'

// Chặn dùng ứng dụng cho tới khi người dùng đã đồng ý phiên bản chính sách hiện tại (Luật 91/2025/QH15 Điều 9, 11).
// 1) Vừa đăng ký: ghi nhận lựa chọn đã tick ở trang đăng ký (cookie / metadata) — không hỏi lại.
// 2) Người dùng cũ / chính sách đổi phiên bản / đăng nhập Google lần đầu từ trang Đăng nhập: hiện hộp đồng ý.
// Chưa chạy migration 033 (setup_required) thì không chặn.
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { ConsentChecklist } from './consent-checklist'
import { missingRequiredPurposes, type ConsentChoice } from '@/lib/privacy/policy'

export function ConsentGate() {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState<string | null>(null)
  const [choice, setChoice] = useState<ConsentChoice>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const r = await fetch('/api/consent', { cache: 'no-store' })
        if (!r.ok) return
        const s = await r.json()
        if (!s.needs_consent || cancelled) return
        if (s.reason === 'none') {
          const signup = await fetch('/api/consent', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ source: 'signup' }),
          })
          if (signup.ok || cancelled) return
        }
        if (s.current?.purposes?.marketing === true) setChoice({ marketing: true })
        setReason(s.reason)
        setOpen(true)
      } catch {
        // Lỗi mạng: không chặn, lần tải sau sẽ hỏi lại.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  async function submit() {
    if (missingRequiredPurposes(choice).length) {
      setError('Vui lòng đánh dấu các mục bắt buộc để tiếp tục dùng dịch vụ.')
      return
    }
    setSaving(true)
    setError('')
    try {
      const r = await fetch('/api/consent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: 'consent_gate', purposes: choice }),
      })
      const data = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(data.error || 'Chưa lưu được, vui lòng thử lại.')
      setOpen(false)
    } catch (e: any) {
      setError(e.message || 'Có lỗi xảy ra')
    } finally {
      setSaving(false)
    }
  }

  async function signOut() {
    await createClient().auth.signOut()
    window.location.href = '/login'
  }

  // Trang Cài đặt luôn mở được để người không đồng ý vẫn tải dữ liệu về / yêu cầu xoá tài khoản.
  if (!open || pathname.startsWith('/settings')) return null
  return (
    <div className="consent-overlay" role="dialog" aria-modal="true" aria-labelledby="consent-title">
      <div className="consent-modal">
        <h2 id="consent-title">{reason === 'outdated' ? 'Chính sách bảo mật đã cập nhật' : 'Xác nhận đồng ý xử lý dữ liệu'}</h2>
        <p>
          Theo Luật Bảo vệ dữ liệu cá nhân 2025, chúng tôi cần sự đồng ý rõ ràng của bạn cho từng mục đích trước khi tiếp tục xử
          lý dữ liệu.
        </p>
        <ConsentChecklist value={choice} onChange={setChoice} disabled={saving} />
        {error && <div className="alert alert-error">{error}</div>}
        <div className="consent-actions">
          <button className="primary-button" onClick={submit} disabled={saving || missingRequiredPurposes(choice).length > 0}>
            {saving ? 'Đang lưu…' : 'Đồng ý và tiếp tục'}
          </button>
          <button className="secondary-button" onClick={signOut} disabled={saving}>
            Không đồng ý — đăng xuất
          </button>
        </div>
        <small>
          Không đồng ý thì bạn không dùng được dịch vụ. Bạn vẫn có thể{' '}
          <Link href="/settings?tab=privacy">tải dữ liệu về hoặc yêu cầu xoá tài khoản</Link>.
        </small>
      </div>
    </div>
  )
}
