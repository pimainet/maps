'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { Lock, X } from 'lucide-react'

const SNOOZE_KEY = 'lgos_paywall_dismissed_at'
const SNOOZE_MS = 3 * 86_400_000

function readDismissedAt(): number {
  try {
    return Number(localStorage.getItem(SNOOZE_KEY)) || 0
  } catch {
    return 0
  }
}

/** Thẻ khoá hiện NGAY CHỖ nội dung bị khoá: người dùng thấy mình thiếu gì, bấm là sang trang gói. */
export function LockedCard({ title, note, className = '' }: { title: string; note?: string; className?: string }) {
  return (
    <Link href="/billing" className={`locked-card ${className}`}>
      <Lock size={16} aria-hidden />
      <span>
        <strong>{title}</strong>
        {note && <small>{note}</small>}
      </span>
      <span className="locked-cta">Mở khoá</span>
      <style jsx>{`
        .locked-card { display: flex; align-items: center; gap: 12px; padding: 12px 14px; border: 1px dashed var(--border, #d4d4d8); border-radius: 12px; color: inherit; text-decoration: none; font-size: 13px; background: var(--muted, #fafafa); }
        .locked-card strong { display: block; font-weight: 600; }
        .locked-card small { display: block; color: var(--muted-foreground, #71717a); margin-top: 2px; }
        .locked-card span:nth-child(2) { flex: 1; }
        .locked-cta { font-weight: 600; color: var(--primary, #2563eb); white-space: nowrap; }
      `}</style>
    </Link>
  )
}

/** Nhắc nâng cấp sau lần audit đầu / khi có việc bị khoá. Tắt rồi thì ẩn ≥3 ngày. Chỉ hiện cho gói miễn phí. */
export function UpgradeBanner({ show, lockedCount, onIntent }: { show: boolean; lockedCount: number; onIntent?: string }) {
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    setVisible(show && Date.now() - readDismissedAt() > SNOOZE_MS)
  }, [show])
  if (!visible) return null
  return (
    <div className="upgrade-banner" role="status" data-intent={onIntent}>
      <div>
        <strong>Còn {lockedCount} mục đang khoá trong gói miễn phí.</strong>
        <span> Gói Khởi động mở toàn bộ kế hoạch và mô tả mẫu cho quán của bạn.</span>
      </div>
      <Link href="/billing" className="primary-button">Xem gói</Link>
      <button
        type="button"
        aria-label="Để sau"
        onClick={() => {
          try { localStorage.setItem(SNOOZE_KEY, String(Date.now())) } catch { /* bỏ qua */ }
          setVisible(false)
        }}
      >
        <X size={16} />
      </button>
      <style jsx>{`
        .upgrade-banner { display: flex; align-items: center; gap: 12px; padding: 12px 14px; border-radius: 12px; border: 1px solid var(--border, #e4e4e7); background: var(--muted, #fafafa); font-size: 13px; margin: 8px 0; }
        .upgrade-banner > div { flex: 1; }
        .upgrade-banner button { background: none; border: 0; cursor: pointer; color: var(--muted-foreground, #71717a); }
      `}</style>
    </div>
  )
}
