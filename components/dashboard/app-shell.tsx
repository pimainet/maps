'use client'

// Khung sidebar + topbar dùng chung cho toàn bộ khu vực dashboard.
//
// TRƯỚC ĐÂY: khung này (và toàn bộ nội dung từng trang) nằm chung trong
// app/page.tsx (2200+ dòng), điều hướng bằng router giả tự chế
// (window.history.pushState + tự parse pathname). Vấn đề: router giả đó
// chỉ hoạt động khi bấm nút trong app — F5 hoặc mở thẳng 1 link (vd
// /clients/abc) sẽ khiến Next.js render đúng file route thật ở app/,
// vốn là bản nháp cũ không có sidebar này.
//
// BÂY GIỜ: đây là layout thật của route group (dashboard), Next.js tự
// điều hướng đúng theo URL, không còn 2 hệ thống router chồng nhau nữa.
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import {
  Bell,
  CircleHelp,
  ClipboardCheck,
  FileText,
  LayoutDashboard,
  Menu,
  MoreHorizontal,
  Plus,
  Search,
  Settings,
  Sparkles,
  Users,
  X,
} from 'lucide-react'
import { ToastProvider } from './toast-context'

function NavItem({ icon: Icon, label, active, href, count, onNavigate }: any) {
  return (
    <Link href={href} className={`nav-item ${active ? 'active' : ''}`} onClick={onNavigate}>
      <Icon size={18} />
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

function pageTitle(pathname: string, clientName: string) {
  if (pathname.startsWith('/clients/new')) return 'Thêm khách hàng'
  if (pathname.startsWith('/clients/')) {
    if (pathname.includes('/audit')) return 'Audit Google Business Profile'
    if (pathname.includes('/plan')) return 'Lộ trình 30 ngày'
    return clientName || 'Chi tiết khách hàng'
  }
  if (pathname.startsWith('/clients')) return 'Khách hàng'
  if (pathname.startsWith('/tasks')) return 'Công việc'
  if (pathname.startsWith('/contents')) return 'Nội dung'
  if (pathname.startsWith('/workspaces/new')) return 'Tạo workspace'
  if (pathname.startsWith('/workspaces')) return 'Workspace của bạn'
  if (pathname.startsWith('/settings')) return 'Cài đặt'
  return 'Tổng quan'
}

function AppShellInner({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false)
  const [clientName, setClientName] = useState('')
  const [pendingCount, setPendingCount] = useState<number | null>(null)
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null)

  useEffect(() => {
    setMobileOpen(false)
    setMobileSearchOpen(false)
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
        const name = data.profile.full_name || data.user?.email || 'User'
        const initials =
          name
            .split(' ')
            .filter(Boolean)
            .slice(0, 2)
            .map((w: string) => w[0]?.toUpperCase() || '')
            .join('') || 'U'
        setCurrentUser({
          fullName: name,
          role: data.activeRole || 'member',
          initials,
          workspaceName: data.activeWorkspace?.name || 'Chưa có workspace',
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
    if (!id) return
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

  const today = new Date().toLocaleDateString('vi-VN', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  })

  const title = pageTitle(pathname, clientName)
  const isDashboard = pathname === '/'
  const isClients = pathname.startsWith('/clients') && !pathname.startsWith('/clients/')
  const showAddClient = isDashboard || isClients
  const canAddMore = currentUser?.clientLimit?.canAddMore

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileOpen ? 'open' : ''}`}>
        <div className="brand">
          <div className="brand-mark">
            <Sparkles size={16} />
          </div>
          <span>
            local growth <strong>os</strong>
          </span>
          <button className="close-mobile" onClick={() => setMobileOpen(false)}>
            <X size={18} />
          </button>
        </div>
        <Link href="/workspaces" className="workspace" style={{ cursor: 'pointer' }}>
          <div className="workspace-avatar">{(currentUser?.workspaceName || 'LG').slice(0, 2).toUpperCase()}</div>
          <div>
            <p className="workspace-name">{currentUser?.workspaceName || 'Workspace'}</p>
            <p className="workspace-plan">Agency workspace</p>
          </div>
        </Link>
        <nav>
          <p className="nav-label">Làm việc hôm nay</p>
          <NavItem icon={LayoutDashboard} label="Tổng quan" active={pathname === '/'} href="/" onNavigate={() => setMobileOpen(false)} />
          <NavItem
            icon={Users}
            label="Khách hàng"
            active={pathname.startsWith('/clients')}
            href="/clients"
            onNavigate={() => setMobileOpen(false)}
          />
          <NavItem icon={ClipboardCheck} label="Việc cần làm" active={pathname.startsWith('/tasks')} href="/tasks" onNavigate={() => setMobileOpen(false)} />
          <NavItem
            icon={FileText}
            label="Nội dung"
            active={pathname.startsWith('/contents')}
            count={pendingCount ? String(pendingCount) : undefined}
            href="/contents"
            onNavigate={() => setMobileOpen(false)}
          />
          <p className="nav-label secondary">Hệ thống</p>
          <NavItem icon={Settings} label="Cài đặt" active={pathname.startsWith('/settings')} href="/settings" onNavigate={() => setMobileOpen(false)} />
        </nav>
        <div className="sidebar-footer">
          <div className="help-card">
            <CircleHelp size={17} />
            <div>
              <strong>Cần trợ giúp?</strong>
              <span>Xem hướng dẫn sử dụng</span>
            </div>
          </div>
          <div className="user-row" style={{ cursor: 'pointer' }} onClick={handleLogout} title="Đăng xuất">
            <div className="user-avatar">{currentUser?.initials || 'U'}</div>
            <div>
              <strong>{currentUser?.fullName || 'User'}</strong>
              <span>{currentUser?.role || 'member'} · Đăng xuất</span>
            </div>
            <MoreHorizontal size={17} />
          </div>
        </div>
      </aside>
      {mobileOpen && <div className="mobile-overlay" onClick={() => setMobileOpen(false)} />}
      <main className="main">
        <header className="topbar">
          <button className="mobile-menu" onClick={() => setMobileOpen(true)} aria-label="Mở menu">
            <Menu size={20} />
          </button>
          <div className="breadcrumbs">
            <span>Workspace</span>
            <span>/</span>
            <strong>{title}</strong>
          </div>
          <div className="mobile-title">{title}</div>
          <div className="top-actions">
            <div className="top-search">
              <Search size={16} />
              <input placeholder="Tìm kiếm..." />
              <kbd>⌘ K</kbd>
            </div>
            <button
              className="icon-button mobile-search-toggle"
              aria-label="Tìm kiếm"
              onClick={() => setMobileSearchOpen((v) => !v)}
            >
              <Search size={18} />
            </button>
            <button className="icon-button" aria-label="Thông báo">
              <Bell size={18} />
              <i />
            </button>
            <div className="mini-avatar">{currentUser?.initials || 'U'}</div>
          </div>
        </header>
        {mobileSearchOpen && (
          <div className="mobile-search-bar">
            <Search size={16} />
            <input autoFocus placeholder="Tìm khách hàng, việc, nội dung..." />
          </div>
        )}
        <div className="content">
          <div className="page-heading">
            <div>
              <p className="overline">{today}</p>
              <h1>{title}</h1>
              <p className="subheading">Theo dõi và điều phối toàn bộ chu kỳ Local SEO của bạn.</p>
            </div>
            {showAddClient && canAddMore !== false && (
              <Link href="/clients/new" className="primary-button">
                <Plus size={17} />
                Thêm khách hàng
              </Link>
            )}
            {showAddClient && currentUser?.clientLimit && !currentUser.clientLimit.canAddMore && (
              <button
                className="secondary-button"
                disabled
                title="Liên hệ nâng cấp gói để thêm doanh nghiệp mới"
              >
                <Plus size={17} />
                Đã đạt giới hạn ({currentUser.clientLimit.maxClients})
              </button>
            )}
          </div>
          {children}
        </div>
      </main>
      <nav className="bottom-nav" aria-label="Điều hướng điện thoại">
        <Link href="/" className={pathname === '/' ? 'active' : ''}>
          <LayoutDashboard size={20} />
          <span>Tổng quan</span>
        </Link>
        <Link href="/clients" className={pathname.startsWith('/clients') ? 'active' : ''}>
          <Users size={20} />
          <span>Khách</span>
        </Link>
        <Link href="/tasks" className={pathname.startsWith('/tasks') ? 'active' : ''}>
          <ClipboardCheck size={20} />
          <span>Việc</span>
        </Link>
        <Link href="/contents" className={pathname.startsWith('/contents') ? 'active' : ''}>
          <FileText size={20} />
          <span>Nội dung</span>
          {pendingCount ? <b>{pendingCount}</b> : null}
        </Link>
        <button type="button" className={mobileOpen ? 'active' : ''} onClick={() => setMobileOpen(true)}>
          <Menu size={20} />
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
