'use client'

import Link from 'next/link'
import { CONSENT_PURPOSES, type ConsentChoice } from '@/lib/privacy/policy'

/** Các ô đồng ý theo từng mục đích. Không ô nào được đánh dấu sẵn (NĐ 356/2025 Điều 6; Luật 91/2025 Điều 9: im lặng ≠ đồng ý). */
export function ConsentChecklist({
  value,
  onChange,
  disabled,
}: {
  value: ConsentChoice
  onChange: (next: ConsentChoice) => void
  disabled?: boolean
}) {
  return (
    <fieldset className="consent-list" disabled={disabled}>
      <legend>Đồng ý xử lý dữ liệu cá nhân</legend>
      {CONSENT_PURPOSES.map((p) => (
        <label key={p.key} className="consent-check">
          <input
            type="checkbox"
            checked={value[p.key] === true}
            onChange={(e) => onChange({ ...value, [p.key]: e.target.checked })}
            aria-describedby={`consent-${p.key}-detail`}
          />
          <span>
            {p.required && <b className="consent-required">Bắt buộc · </b>}
            {p.key === 'service' ? (
              <>
                Tôi đã đọc và đồng ý <Link href="/terms" target="_blank">Điều khoản sử dụng</Link> và{' '}
                <Link href="/privacy" target="_blank">Chính sách bảo mật</Link>, cho phép xử lý dữ liệu cá nhân để cung cấp dịch vụ.
              </>
            ) : (
              p.label
            )}
            <small id={`consent-${p.key}-detail`}>{p.detail}</small>
          </span>
        </label>
      ))}
    </fieldset>
  )
}
