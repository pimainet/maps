'use client'

// Khung thanh bên + điều hướng dùng chung cho toàn bộ khu vực dashboard.
// Đây là layout thật của route group (dashboard): Next.js tự điều hướng theo URL.
//
// Nguyên tắc ngôn ngữ: viết cho chủ doanh nghiệp, không dùng thuật ngữ của agency
// (workspace, audit, chu kỳ...). Chỉ hiện những điều khiển thực sự hoạt động.
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { ChevronsUpDown, ClipboardCheck, FileText, House, LogOut, Menu, Plus, Settings, Store, X } from 'lucide-react'
import { ToastProvider } from './toast-context'
import { Brand } from './brand'
import { ROLE_LABEL } from '@/lib/ui-constants'

function NavItem({ icon: Icon, label, active, href, count, onNavigate }: any) {
  return (
    <Link href={href} className={`nav-item ${active ? 'active' : ''}`} onClick={onNavigate} aria-current={active ? 'page' : undefined}>
      <Icon size={19} />
      <span>{label}</span>
      {count && <b>{count}</b>}
    </Link>
  )
}

type CurrentUser = {
  fullName: string
  role: string
  initials: string
  workspaceName: string
  clientLimit: { maxClients: number; clientCount: number; canAddMore: boolean } | null
}

type PageInfo = { title: string; subtitle: string }

function pageInfo(pathname: string, clientName: string): PageInfo {
  if (pathname.startsWith('/clients/new'))
    return { title: 'Thêm doanh nghiệp', subtitle: 'Vài thông tin cơ bản là đủ để bắt đầu.' }
  if (pathname.startsWith('/clients/')) {
    if (pathname.includes('/audit'))
      return { title: 'Kiểm tra hồ sơ Google', subtitle: 'Xem hồ sơ của bạn đang mạnh ở đâu và cần sửa gì.' }
    if (pathname.includes('/plan'))
      return { title: 'Kế hoạch 30 ngày', subtitle: 'Từng bước để khách tìm thấy bạn nhiều hơn trên Google Maps.' }
    if (pathname.includes('/report'))
      return { title: 'Kết quả', subtitle: 'So sánh trước và sau để thấy kế hoạch có hiệu quả không.' }
    return { title: clientName || 'Doanh nghiệp', subtitle: 'Tình hình và những việc cần làm của doanh nghiệp này.' }
  }
  if (pathname.startsWith('/clients'))
    return { title: 'Doanh nghiệp', subtitle: 'Chọn một doanh nghiệp để xem việc cần làm và kế hoạch.' }
  if (pathname.startsWith('/tasks'))
    return { title: 'Việc cần làm', subtitle: 'Làm từng việc một. Bấm “Xem hướng dẫn” để được chỉ từng bước.' }
  if (pathname.startsWith('/contents'))
    return { title: 'Bài viết', subtitle: 'Đọc, chỉnh sửa và duyệt bài trước khi đăng lên Google.' }
  if (pathname.startsWith('/workspaces/new'))
    return { title: 'Tạo không gian làm việc', subtitle: '' }
  if (pathname.startsWith('/workspaces'))
    return { title: 'Không gian làm việc', subtitle: 'Chuyển giữa các không gian làm việc của bạn.' }
  if (pathname.startsWith('/settings'))
    return { title: 'Cài đặt', subtitle: 'Thông tin tài khoản và những người cùng sử dụng.' }
  return { title: 'Trang chủ', subtitle: '' }
}

function AppShellInner({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [clientName, setClientName] = useState('')
  const [pendingCount, setPendingCount] = useState<number | null>(null)
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null)

  useEffect(() => {
    setMobileOpen(false)
  }, [pathname])

  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = mobileOpen ? 'hidden' : prev
    return () => {
      document.body.style.overflow = prev
    }
  }, [mobileOpen])

  useEffect(() => {
    fetch('/api/me')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data?.profile) return
        const name = data.profile.full_name || data.user?.email || 'Bạn'
        const initials =
          name
            .split(' ')
            .filter(Boolean)
            .slice(-2)
            .map((w: string) => w[0]?.toUpperCase() || '')
            .join('') || 'B'
        setCurrentUser({
          fullName: name,
          role: data.activeRole || 'member',
          initials,
          workspaceName: data.activeWorkspace?.name || 'Chưa có không gian làm việc',
          clientLimit: data.clientLimit || null,
        })
        if (Array.isArray(data.workspaces) && data.workspaces.length === 0) {
          router.push('/workspaces/new')
        }
      })
      .catch(() => {})
  }, [router])

  useEffect(() => {
    const isClientRoute = /^\/clients\/[^/]+/.test(pathname)
    if (!isClientRoute) return
    const id = pathname.split('/clients/')[1]?.split('/')[0]
    if (!id || id === 'new') return
    fetch('/api/clients')
      .then((r) => r.json())
      .then((data) => {
        const found = (Array.isArray(data) ? data : []).find((c: any) => c.id === id)
        setClientName(found?.name || '')
      })
      .catch(() => {})
  }, [pathname])

  useEffect(() => {
    fetch('/api/content')
      .then((r) => r.json())
      .then((data) => {
        const list = Array.isArray(data) ? data : []
        setPendingCount(list.filter((c: any) => c.status === 'waiting_approval').length)
      })
      .catch(() => setPendingCount(null))
  }, [pathname])

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' })
    window.location.href = '/login'
  }

  const { title, subtitle } = pageInfo(pathname, clientName)
  const isHome = pathname === '/'
  const isClients = pathname === '/clients'
  const canAddMore = currentUser?.clientLimit?.canAddMore
  const roleLabel = ROLE_LABEL[currentUser?.role || ''] || 'Thành viên'
  const closeMenu = () => setMobileOpen(false)

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileOpen ? 'open' : ''}`} aria-label="Menu chính">
        <div className="brand">
          <Brand className="brand-inner" />
          <button className="close-mobile" onClick={closeMenu} aria-label="Đóng menu">
            <X size={20} />
          </button>
        </div>

        <Link href="/workspaces" className="workspace" onClick={closeMenu} title="Đổi không gian làm việc">
          <div className="workspace-avatar">{(currentUser?.workspaceName || 'LG').slice(0, 2).toUpperCase()}</div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <p className="workspace-name">{currentUser?.workspaceName || 'Đang tải…'}</p>
            <p className="workspace-plan">{roleLabel}</p>
          </div>
          <ChevronsUpDown size={16} style={{ color: 'var(--muted-foreground)', flex: '0 0 auto' }} />
        </Link>

        <nav>
          <NavItem icon={House} label="Trang chủ" active={isHome} href="/" onNavigate={closeMenu} />
          <NavItem icon={Store} label="Doanh nghiệp" active={pathname.startsWith('/clients')} href="/clients" onNavigate={closeMenu} />
          <NavItem icon={ClipboardCheck} label="Việc cần làm" active={pathname.startsWith('/tasks')} href="/tasks" onNavigate={closeMenu} />
          <NavItem
            icon={FileText}
            label="Bài viết"
            active={pathname.startsWith('/contents')}
            count={pendingCount ? String(pendingCount) : undefined}
            href="/contents"
            onNavigate={closeMenu}
          />
          <div className="nav-gap" />
          <NavItem icon={Settings} label="Cài đặt" active={pathname.startsWith('/settings')} href="/settings" onNavigate={closeMenu} />
        </nav>

        <div className="sidebar-footer">
          <div className="user-row">
            <div className="user-avatar">{currentUser?.initials || 'B'}</div>
            <div>
              <strong>{currentUser?.fullName || 'Bạn'}</strong>
              <span>{roleLabel}</span>
            </div>
            <button className="icon-button" onClick={handleLogout} title="Đăng xuất" aria-label="Đăng xuất">
              <LogOut size={18} />
            </button>
          </div>
        </div>
      </aside>

      {mobileOpen && <div className="mobile-overlay" onClick={closeMenu} />}

      <main className="main">
        <header className="topbar">
          <button className="mobile-menu" onClick={() => setMobileOpen(true)} aria-label="Mở menu">
            <Menu size={22} />
          </button>
          <Brand />
        </header>

        <div className="content">
          {!isHome && (
            <div className="page-heading">
              <div>
                <h1>{title}</h1>
                {subtitle && <p className="subheading">{subtitle}</p>}
              </div>
              {isClients && canAddMore !== false && (
                <Link href="/clients/new" className="primary-button">
                  <Plus size={18} />
                  Thêm doanh nghiệp
                </Link>
              )}
              {isClients && currentUser?.clientLimit && !currentUser.clientLimit.canAddMore && (
                <button className="secondary-button" disabled title="Liên hệ để nâng gói và thêm doanh nghiệp mới">
                  <Plus size={18} />
                  Đã đạt giới hạn ({currentUser.clientLimit.maxClients})
                </button>
              )}
            </div>
          )}
          {children}
        </div>
      </main>

      <nav className="bottom-nav" aria-label="Điều hướng điện thoại">
        <Link href="/" className={isHome ? 'active' : ''}>
          <House size={22} />
          <span>Trang chủ</span>
        </Link>
        <Link href="/clients" className={pathname.startsWith('/clients') ? 'active' : ''}>
          <Store size={22} />
          <span>Doanh nghiệp</span>
        </Link>
        <Link href="/tasks" className={pathname.startsWith('/tasks') ? 'active' : ''}>
          <ClipboardCheck size={22} />
          <span>Việc</span>
        </Link>
        <Link href="/contents" className={pathname.startsWith('/contents') ? 'active' : ''}>
          <FileText size={22} />
          <span>Bài viết</span>
          {pendingCount ? <b>{pendingCount}</b> : null}
        </Link>
        <button type="button" className={mobileOpen ? 'active' : ''} onClick={() => setMobileOpen(true)}>
          <Menu size={22} />
          <span>Menu</span>
        </button>
      </nav>
    </div>
  )
}

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <ToastProvider>
      <AppShellInner>{children}</AppShellInner>
    </ToastProvider>
  )
}
