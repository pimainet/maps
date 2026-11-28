import Link from 'next/link'
import { Brand } from '@/components/dashboard/brand'
import { LEGAL_ENTITY, POLICY_UPDATED_AT, CONSENT_VERSION, legalEntityIncomplete } from '@/lib/privacy/policy'

export function LegalPage({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="legal-page">
      <div className="legal-card">
        <Brand className="auth-brand" />
        <nav className="legal-nav" aria-label="Tài liệu pháp lý">
          <Link href="/privacy">Chính sách bảo mật</Link>
          <Link href="/terms">Điều khoản sử dụng</Link>
          <Link href="/signup">Đăng ký</Link>
          <Link href="/login">Đăng nhập</Link>
        </nav>
        <h1>{title}</h1>
        <p className="legal-meta">
          Cập nhật: {POLICY_UPDATED_AT} · Phiên bản {CONSENT_VERSION}
        </p>
        {legalEntityIncomplete() && (
          <div className="alert alert-warn legal-draft">
            Bản nháp: thông tin doanh nghiệp (tên, mã số thuế, địa chỉ, email) chưa được điền. Quản trị viên cần đặt các biến
            NEXT_PUBLIC_LEGAL_* trước khi công bố chính thức.
          </div>
        )}
        {children}
        <footer className="legal-footer">
          <p>
            {LEGAL_ENTITY.name} · MST {LEGAL_ENTITY.taxId} · {LEGAL_ENTITY.address}
          </p>
          <p>
            Liên hệ quyền riêng tư: {LEGAL_ENTITY.email} · {LEGAL_ENTITY.phone}
          </p>
        </footer>
      </div>
    </main>
  )
}

export function EntityBlock() {
  return (
    <ul>
      <li>
        Tên: <strong>{LEGAL_ENTITY.name}</strong>
      </li>
      <li>Mã số thuế: {LEGAL_ENTITY.taxId}</li>
      <li>Địa chỉ: {LEGAL_ENTITY.address}</li>
      <li>Người phụ trách bảo vệ dữ liệu cá nhân: {LEGAL_ENTITY.representative}</li>
      <li>
        Email: {LEGAL_ENTITY.email} · Điện thoại: {LEGAL_ENTITY.phone}
      </li>
    </ul>
  )
}
