'use client'

import { useEffect, useMemo, useState } from 'react'
import { usePathname } from 'next/navigation'
import { Activity, ArrowUpRight, BarChart3, Bell, BriefcaseBusiness, CalendarDays, Check, ChevronDown, CircleHelp, ClipboardCheck, FileText, Gauge, LayoutDashboard, Menu, MoreHorizontal, Plus, Search, Settings, Sparkles, Target, Users, X } from 'lucide-react'

const clients = [
  { name: 'Nha khoa Tâm An', industry: 'Nha khoa', area: 'Quận 3, TP.HCM', status: 'active', stage: 'Đang chạy plan', update: '12 phút trước', score: 82, initials: 'TA', color: 'bg-primary' },
  { name: 'Lumière Clinic', industry: 'Thẩm mỹ', area: 'Hải Châu, Đà Nẵng', status: 'active', stage: 'Cần duyệt bài', update: '2 giờ trước', score: 74, initials: 'LC', color: 'bg-accent' },
  { name: 'Phòng khám An Khang', industry: 'Phòng khám', area: 'Cầu Giấy, Hà Nội', status: 'paused', stage: 'Cần audit lại', update: '3 ngày trước', score: 68, initials: 'AK', color: 'bg-chart-3' },
]
const contents = [
  { topic: '5 dấu hiệu cần lấy cao răng định kỳ', client: 'Nha khoa Tâm An', date: '18/06/2025', status: 'waiting_approval', goal: 'Tăng lượt gọi' },
  { topic: 'Chăm sóc da sau liệu trình laser', client: 'Lumière Clinic', date: '19/06/2025', status: 'drafted', goal: 'Tăng nhận diện' },
  { topic: 'Khi nào nên khám sức khỏe tổng quát?', client: 'Phòng khám An Khang', date: '21/06/2025', status: 'approved', goal: 'Tăng truy cập' },
]
const tasks = [
  ['Hoàn thiện mô tả dịch vụ niềng răng', 'Nha khoa Tâm An', 'GBP', 'Cao', 'Hôm nay', 'pending'],
  ['Duyệt 3 bài viết tuần 3', 'Lumière Clinic', 'Nội dung', 'Cao', 'Hôm nay', 'pending'],
  ['Cập nhật bộ ảnh phòng khám', 'Phòng khám An Khang', 'Hình ảnh', 'Vừa', '20/06/2025', 'done'],
  ['Kiểm tra danh mục phụ', 'Nha khoa Tâm An', 'Audit', 'Thấp', '22/06/2025', 'skipped'],
]

const statusMap: Record<string, { label: string; className: string }> = {
  active: { label: 'Đang hoạt động', className: 'status-success' }, paused: { label: 'Tạm dừng', className: 'status-warning' }, stopped: { label: 'Đã dừng', className: 'status-muted' }, waiting_approval: { label: 'Chờ duyệt', className: 'status-warning' }, drafted: { label: 'Bản nháp', className: 'status-info' }, approved: { label: 'Đã duyệt', className: 'status-success' }, published: { label: 'Đã đăng', className: 'status-success' }, idea: { label: 'Ý tưởng', className: 'status-muted' }, pending: { label: 'Đang chờ', className: 'status-warning' }, done: { label: 'Hoàn thành', className: 'status-success' }, skipped: { label: 'Bỏ qua', className: 'status-muted' },
}

function Badge({ status }: { status: string }) { const item = statusMap[status] || { label: status, className: 'status-muted' }; return <span className={`status-badge ${item.className}`}><span className="status-dot" />{item.label}</span> }
function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) { return <section className={`panel ${className}`}>{children}</section> }
function Metric({ icon: Icon, label, value, note, tone = 'blue' }: any) { return <Card className="metric"><div className={`metric-icon ${tone}`}><Icon size={18} /></div><div><p className="eyebrow">{label}</p><p className="metric-value">{value}</p><p className="metric-note">{note}</p></div></Card> }

export default function Page() {
  const routerPath = usePathname(); const [pathname, setPathname] = useState(routerPath); const [mobileOpen, setMobileOpen] = useState(false); const [toast, setToast] = useState(''); const [query, setQuery] = useState('');
  useEffect(() => { setPathname(routerPath) }, [routerPath]);
  const navigate = (path: string) => { window.history.pushState({}, '', path); setPathname(path); setMobileOpen(false) }
  const page = pathname.startsWith('/clients/new') ? 'new-client' : pathname.startsWith('/clients/') ? pathname.includes('/audit') ? 'audit' : pathname.includes('/plan') ? 'plan' : 'client-detail' : pathname.startsWith('/clients') ? 'clients' : pathname.startsWith('/tasks') ? 'tasks' : pathname.startsWith('/contents/') ? 'content-detail' : pathname.startsWith('/contents') ? 'contents' : pathname.startsWith('/settings') ? 'settings' : 'dashboard'
  const title = page === 'dashboard' ? 'Tổng quan' : page === 'clients' ? 'Khách hàng' : page === 'tasks' ? 'Công việc' : page === 'contents' ? 'Nội dung' : page === 'settings' ? 'Cài đặt' : page === 'new-client' ? 'Thêm khách hàng' : page === 'client-detail' ? 'Nha khoa Tâm An' : page === 'audit' ? 'Audit Google Business Profile' : page === 'plan' ? 'Lộ trình 30 ngày' : 'Duyệt nội dung'
  return <div className="app-shell"><aside className={`sidebar ${mobileOpen ? 'open' : ''}`}><div className="brand"><div className="brand-mark"><Sparkles size={16} /></div><span>local growth <strong>os</strong></span><button className="close-mobile" onClick={() => setMobileOpen(false)}><X size={18} /></button></div><div className="workspace"><div className="workspace-avatar">LG</div><div><p className="workspace-name">Growth Studio</p><p className="workspace-plan">Agency workspace</p></div><ChevronDown size={15} /></div><nav><p className="nav-label">Làm việc hôm nay</p><NavItem icon={LayoutDashboard} label="Tổng quan" active={page === 'dashboard'} onClick={() => navigate('/')} /><NavItem icon={Users} label="Khách hàng" active={['clients','new-client','client-detail','audit','plan'].includes(page)} onClick={() => navigate('/clients')} /><NavItem icon={ClipboardCheck} label="Việc cần làm" active={page === 'tasks'} onClick={() => navigate('/tasks')} /><NavItem icon={FileText} label="Nội dung" active={['contents','content-detail'].includes(page)} count="3" onClick={() => navigate('/contents')} /><p className="nav-label secondary">Hệ thống</p><NavItem icon={Settings} label="Cài đặt" active={page === 'settings'} onClick={() => navigate('/settings')} /></nav><div className="sidebar-footer"><div className="help-card"><CircleHelp size={17} /><div><strong>Cần trợ giúp?</strong><span>Xem hướng dẫn sử dụng</span></div></div><div className="user-row"><div className="user-avatar">HN</div><div><strong>Hải Nguyễn</strong><span>Admin</span></div><MoreHorizontal size={17} /></div></div></aside>{mobileOpen && <div className="mobile-overlay" onClick={() => setMobileOpen(false)} />}
    <main className="main"><header className="topbar"><button className="mobile-menu" onClick={() => setMobileOpen(true)}><Menu size={20} /></button><div className="breadcrumbs"><span>Workspace</span><span>/</span><strong>{title}</strong></div><div className="top-actions"><div className="top-search"><Search size={16} /><input placeholder="Tìm kiếm..." /><kbd>⌘ K</kbd></div><button className="icon-button" aria-label="Thông báo"><Bell size={18} /><i /></button><div className="mini-avatar">HN</div></div></header><div className="content"><div className="page-heading"><div><p className="overline">Thứ Tư, 18 tháng 6, 2025</p><h1>{title}</h1><p className="subheading">Theo dõi và điều phối toàn bộ chu kỳ Local SEO của bạn.</p></div>{page === 'dashboard' && <button className="primary-button" onClick={() => navigate('/clients/new')}><Plus size={17} />Thêm khách hàng</button>}{page === 'clients' && <button className="primary-button" onClick={() => navigate('/clients/new')}><Plus size={17} />Thêm khách hàng</button>}{page === 'contents' && <button className="primary-button" onClick={() => setToast('Đã tạo lịch nội dung từ lộ trình')}><Sparkles size={17} />Tạo từ lộ trình</button>}</div>{page === 'dashboard' && <Dashboard navigate={navigate} setToast={setToast} />}{page === 'clients' && <Clients navigate={navigate} query={query} setQuery={setQuery} />}{page === 'new-client' && <NewClient navigate={navigate} setToast={setToast} />}{page === 'client-detail' && <ClientDetailAction navigate={navigate} setToast={setToast} />}{page === 'audit' && <Audit navigate={navigate} setToast={setToast} />}{page === 'plan' && <Plan setToast={setToast} />}{page === 'tasks' && <Tasks />}{page === 'contents' && <Contents navigate={navigate} />}{page === 'content-detail' && <ContentDetail setToast={setToast} />}{page === 'settings' && <SettingsView />}</div>{toast && <div className="toast"><Check size={16} />{toast}<button onClick={() => setToast('')}><X size={14} /></button></div>}</main></div>
}
function NavItem({ icon: Icon, label, active, onClick, count }: any) { return <button className={`nav-item ${active ? 'active' : ''}`} onClick={onClick}><Icon size={18} /><span>{label}</span>{count && <b>{count}</b>}</button> }
function Dashboard({ navigate, setToast }: any) { return <><div className="metrics-grid"><Metric icon={Users} label="Tổng khách hàng" value="12" note="↑ 2 khách hàng tháng này" /><Metric icon={Activity} label="Đang chạy lộ trình" value="8" note="66,7% tổng khách hàng" tone="green" /><Metric icon={FileText} label="Bài viết chờ duyệt" value="7" note="Cần xử lý trong tuần này" tone="orange" /><Metric icon={CalendarDays} label="Cần audit lại" value="2" note="Chu kỳ đã hoàn tất" tone="red" /></div><div className="grid-2"><Card><div className="section-head"><div><h2>Khách hàng gần đây</h2><p>Trạng thái hoạt động mới nhất</p></div><button className="text-button" onClick={() => navigate('/clients')}>Xem tất cả <ArrowUpRight size={15} /></button></div><div className="client-list">{clients.map(c => <button className="client-row" key={c.name} onClick={() => navigate('/clients/1')}><div className={`client-avatar ${c.color}`}>{c.initials}</div><div className="row-main"><strong>{c.name}</strong><span>{c.industry} · {c.area}</span></div><Badge status={c.status} /><span className="row-time">{c.update}</span><ArrowUpRight size={15} /></button>)}</div></Card><Card><div className="section-head"><div><h2>Cần duyệt nội dung</h2><p>Những bài viết cần bạn xem qua</p></div><button className="text-button" onClick={() => navigate('/contents')}>Xem tất cả <ArrowUpRight size={15} /></button></div><div className="approval-list">{contents.slice(0, 3).map(c => <button className="approval-row" key={c.topic} onClick={() => navigate('/contents/1')}><div className="doc-icon"><FileText size={16} /></div><div className="row-main"><strong>{c.topic}</strong><span>{c.client} · {c.date}</span></div><Badge status={c.status} /></button>)}</div></Card></div><Card className="workflow-card"><div className="section-head"><div><h2>Chu kỳ Local SEO</h2><p>Quy trình rõ ràng, kết quả đo được</p></div><button className="secondary-button" onClick={() => setToast('Đã mở hướng dẫn quy trình')}><CircleHelp size={16} />Tìm hiểu quy trình</button></div><div className="workflow"><Step icon={ClipboardCheck} label="Audit GBP" done /><Step icon={Target} label="Lộ trình 30 ngày" done /><Step icon={Sparkles} label="Sinh nội dung" active /><Step icon={Check} label="Duyệt & đăng" /><Step icon={BarChart3} label="Đo lường & audit lại" /></div></Card></> }
function Step({ icon: Icon, label, done, active }: any) { return <div className={`step ${done ? 'done' : ''} ${active ? 'current' : ''}`}><div className="step-icon">{done ? <Check size={16} /> : <Icon size={16} />}</div><span>{label}</span></div> }
function Clients({ navigate, query, setQuery }: any) {
  const [realClients, setRealClients] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('/api/clients')
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Không tải được danh sách')
        setRealClients(Array.isArray(data) ? data : [])
      } catch (err: any) {
        setError(err.message || 'Có lỗi xảy ra')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const filtered = realClients.filter((c: any) =>
    (c.name || '').toLowerCase().includes((query || '').toLowerCase())
  )

  return (
    <Card>
      <div className="toolbar">
        <div className="search-field">
          <Search size={16} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Tìm theo tên doanh nghiệp..."
          />
        </div>
        <select>
          <option>Tất cả trạng thái</option>
          <option>Đang hoạt động</option>
          <option>Tạm dừng</option>
        </select>
        <button className="secondary-button">
          <MoreHorizontal size={16} /> Bộ lọc khác
        </button>
      </div>

      {loading && (
        <div style={{ padding: 40, textAlign: 'center', color: '#6b7280' }}>
          Đang tải danh sách khách hàng...
        </div>
      )}

      {error && (
        <div style={{ padding: 20, color: '#b91c1c', background: '#fef2f2', margin: 16, borderRadius: 8 }}>
          {error}
        </div>
      )}

      {!loading && !error && filtered.length === 0 && (
        <div style={{ padding: 40, textAlign: 'center', color: '#6b7280' }}>
          Chưa có khách hàng nào. Hãy thêm khách hàng mới.
        </div>
      )}

      {!loading && filtered.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Tên doanh nghiệp</th>
                <th>Ngành / Khu vực</th>
                <th>Số điện thoại</th>
                <th>Người liên hệ</th>
                <th>Cập nhật</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filtered.map((c: any) => (
                <tr key={c.id} onClick={() => navigate(`/clients/${c.id}`)}>
                  <td>
                    <div className="table-client">
                      <div className="client-avatar small bg-primary">
                        {(c.name || '?').substring(0, 2).toUpperCase()}
                      </div>
                      <strong>{c.name}</strong>
                    </div>
                  </td>
                  <td>
                    <span>{c.industry || '—'}</span>
                    <small>{c.area || ''}</small>
                  </td>
                  <td className="muted-cell">{c.phone || '—'}</td>
                  <td className="muted-cell">{c.contact_name || '—'}</td>
                  <td className="muted-cell">
                    {c.created_at
                      ? new Date(c.created_at).toLocaleDateString('vi-VN')
                      : '—'}
                  </td>
                  <td>
                    <button className="icon-button">
                      <MoreHorizontal size={17} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}
function NewClient({ navigate, setToast }: any) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState({
    name: '',
    industry: '',
    area: '',
    phone: '',
    contact_name: '',
    brand_voice: 'chuyên nghiệp, gần gũi',
    gbp_link: '',
    website_url: '',
    notes: '',
  })

  function update(key: string, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  async function handleSubmit() {
    if (!form.name.trim()) {
      setError('Tên doanh nghiệp là bắt buộc')
      return
    }
    setError('')
    setLoading(true)

    try {
      const res = await fetch('/api/clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || 'Không tạo được khách hàng')
      }

      setToast('Đã lưu khách hàng mới')
      navigate(`/clients/${data.id}`)
    } catch (err: any) {
      setError(err.message || 'Có lỗi xảy ra')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card className="form-card">
      <div className="form-intro">
        <div className="large-icon"><Users size={21} /></div>
        <div>
          <h2>Thông tin doanh nghiệp</h2>
          <p>Bắt đầu bằng những thông tin cơ bản để thiết lập chu kỳ Local SEO.</p>
        </div>
      </div>

      <div className="form-grid">
        <label className="field">
          <span>Tên doanh nghiệp <em>*</em></span>
          <input
            value={form.name}
            onChange={(e) => update('name', e.target.value)}
            placeholder="Ví dụ: Nha khoa Tâm An"
          />
        </label>
        <label className="field">
          <span>Ngành nghề</span>
          <input
            value={form.industry}
            onChange={(e) => update('industry', e.target.value)}
            placeholder="Ví dụ: Nha khoa"
          />
        </label>
        <label className="field">
          <span>Khu vực</span>
          <input
            value={form.area}
            onChange={(e) => update('area', e.target.value)}
            placeholder="Ví dụ: Quận 3, TP.HCM"
          />
        </label>
        <label className="field">
          <span>Số điện thoại</span>
          <input
            value={form.phone}
            onChange={(e) => update('phone', e.target.value)}
            placeholder="0901 234 567"
          />
        </label>
        <label className="field">
          <span>Người liên hệ</span>
          <input
            value={form.contact_name}
            onChange={(e) => update('contact_name', e.target.value)}
            placeholder="Tên người phụ trách"
          />
        </label>
        <label className="field">
          <span>Giọng văn thương hiệu</span>
          <input
            value={form.brand_voice}
            onChange={(e) => update('brand_voice', e.target.value)}
            placeholder="Thân thiện, chuyên gia..."
          />
        </label>
        <label className="field wide">
          <span>Link Google Business Profile</span>
          <input
            value={form.gbp_link}
            onChange={(e) => update('gbp_link', e.target.value)}
            placeholder="https://maps.google.com/..."
          />
        </label>
        <label className="field wide">
          <span>Website (không bắt buộc)</span>
          <input
            value={form.website_url}
            onChange={(e) => update('website_url', e.target.value)}
            placeholder="https://"
          />
        </label>
        <label className="field wide">
          <span>Ghi chú</span>
          <textarea
            value={form.notes}
            onChange={(e) => update('notes', e.target.value)}
            placeholder="Thêm thông tin hữu ích về doanh nghiệp..."
          />
        </label>
      </div>

      {error && (
        <div style={{ color: '#b91c1c', background: '#fef2f2', padding: 12, borderRadius: 8, marginBottom: 16 }}>
          {error}
        </div>
      )}

      <div className="form-actions">
        <button className="secondary-button" onClick={() => navigate('/clients')} disabled={loading}>
          Huỷ
        </button>
        <button className="primary-button" onClick={handleSubmit} disabled={loading}>
          {loading ? 'Đang lưu...' : (<><Check size={17} /> Lưu khách hàng</>)}
        </button>
      </div>
    </Card>
  )
}