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
    <main className="main"><header className="topbar"><button className="mobile-menu" onClick={() => setMobileOpen(true)}><Menu size={20} /></button><div className="breadcrumbs"><span>Workspace</span><span>/</span><strong>{title}</strong></div><div className="top-actions"><div className="top-search"><Search size={16} /><input placeholder="Tìm kiếm..." /><kbd>⌘ K</kbd></div><button className="icon-button" aria-label="Thông báo"><Bell size={18} /><i /></button><div className="mini-avatar">HN</div></div></header><div className="content"><div className="page-heading"><div><p className="overline">Thứ Tư, 18 tháng 6, 2025</p><h1>{title}</h1><p className="subheading">Theo dõi và điều phối toàn bộ chu kỳ Local SEO của bạn.</p></div>{page === 'dashboard' && <button className="primary-button" onClick={() => navigate('/clients/new')}><Plus size={17} />Thêm khách hàng</button>}{page === 'clients' && <button className="primary-button" onClick={() => navigate('/clients/new')}><Plus size={17} />Thêm khách hàng</button>}</div>{page === 'dashboard' && <Dashboard navigate={navigate} setToast={setToast} />}{page === 'clients' && <Clients navigate={navigate} query={query} setQuery={setQuery} />}{page === 'new-client' && <NewClient navigate={navigate} setToast={setToast} />}{page === 'client-detail' && <ClientDetailAction navigate={navigate} setToast={setToast} />}{page === 'audit' && <Audit navigate={navigate} setToast={setToast} />}{page === 'plan' && <Plan setToast={setToast} />}{page === 'tasks' && <Tasks />}{page === 'contents' && <Contents navigate={navigate} setToast={setToast} />}{page === 'content-detail' && <ContentDetail setToast={setToast} />}{page === 'settings' && <SettingsView />}</div>{toast && <div className="toast"><Check size={16} />{toast}<button onClick={() => setToast('')}><X size={14} /></button></div>}</main></div>
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
function Field({ label, required, placeholder, wide }: any) { return <label className={`field ${wide ? 'wide' : ''}`}><span>{label}{required && <em>*</em>}</span><input placeholder={placeholder} /></label> }
function ClientDetailAction({ navigate, setToast }: any) {
  const [client, setClient] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [done, setDone] = useState<string[]>([])

  useEffect(() => {
    async function load() {
      try {
        const path = window.location.pathname
        const id = path.split('/clients/')[1]?.split('/')[0]
        if (!id) throw new Error('Không tìm thấy ID khách hàng')

        const res = await fetch('/api/clients')
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Không tải được dữ liệu')

        const found = (Array.isArray(data) ? data : []).find((c: any) => c.id === id)
        if (!found) throw new Error('Không tìm thấy khách hàng')

        setClient(found)
      } catch (err: any) {
        setError(err.message || 'Có lỗi xảy ra')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const toggleTask = (task: string) => {
    setDone((current) =>
      current.includes(task) ? current.filter((item) => item !== task) : [...current, task]
    )
    setToast(done.includes(task) ? 'Đã mở lại công việc' : 'Đã hoàn thành công việc')
  }

  if (loading) {
    return (
      <Card>
        <div style={{ padding: 40, textAlign: 'center', color: '#6b7280' }}>
          Đang tải thông tin khách hàng...
        </div>
      </Card>
    )
  }

  if (error || !client) {
    return (
      <Card>
        <div style={{ padding: 40, textAlign: 'center', color: '#b91c1c' }}>
          {error || 'Không tìm thấy khách hàng'}
        </div>
      </Card>
    )
  }

  const initials = (client.name || '?').substring(0, 2).toUpperCase()

  return (
    <>
      <Card className="client-action-hero">
        <div className="client-hero-title">
          <div className="client-avatar hero bg-primary">{initials}</div>
          <div>
            <div className="title-line">
              <h2>{client.name}</h2>
              <Badge status="active" />
            </div>
            <p>
              {[client.industry, client.area].filter(Boolean).join(' · ') || 'Chưa có ngành / khu vực'}
            </p>
          </div>
        </div>
        <div className="hero-actions">
          <button
            className="secondary-button"
            onClick={() => setToast('Đã gửi yêu cầu cập nhật thông tin GBP')}
          >
            <Sparkles size={16} /> Cập nhật GBP
          </button>
          <button
            className="secondary-button"
            onClick={() => navigate(`/clients/${client.id}/audit`)}
          >
            <ClipboardCheck size={16} /> Chạy Audit
          </button>
          <button
            className="primary-button"
            onClick={() => navigate(`/clients/${client.id}/plan`)}
          >
            <Target size={16} /> Tiếp tục lộ trình
          </button>
        </div>
      </Card>

      <div className="action-grid">
        <Card className="next-action-card">
          <div className="section-head">
            <div>
              <p className="overline">Việc tiếp theo</p>
              <h2>Hoàn thiện tuần 3</h2>
              <p>3 việc đang chờ để giữ đúng nhịp tăng trưởng.</p>
            </div>
            <span className="action-count">
              {3 - done.length}
              <small>còn lại</small>
            </span>
          </div>
          <div className="task-checklist">
            {['Duyệt 3 bài GBP tuần 3', 'Bổ sung ảnh dịch vụ niềng răng', 'Phản hồi 6 đánh giá mới'].map(
              (task, index) => (
                <button
                  className={`check-task ${done.includes(task) ? 'completed' : ''}`}
                  key={task}
                  onClick={() => toggleTask(task)}
                >
                  <span className="check-box">{done.includes(task) && <Check size={13} />}</span>
                  <span>
                    <strong>{task}</strong>
                    <small>
                      {index === 0
                        ? 'Nội dung · Hạn hôm nay'
                        : index === 1
                        ? 'GBP · Hạn ngày mai'
                        : 'Tương tác · Hạn 20/06'}
                    </small>
                  </span>
                  <ArrowUpRight size={15} />
                </button>
              )
            )}
          </div>
          <button className="primary-button full" onClick={() => navigate('/tasks')}>
            <ClipboardCheck size={16} /> Mở tất cả công việc
          </button>
        </Card>

        <Card className="quick-actions-card">
          <div className="section-head">
            <div>
              <p className="overline">Điều phối nhanh</p>
              <h2>Chọn một hành động</h2>
            </div>
          </div>
          <div className="quick-actions">
            <button onClick={() => navigate('/contents')}>
              <FileText size={18} />
              <span>
                <strong>Duyệt nội dung</strong>
                <small>Xem bài đang chờ</small>
              </span>
              <ArrowUpRight size={15} />
            </button>
            <button onClick={() => setToast('Đã mở biểu mẫu ghi chú cuộc gọi')}>
              <BriefcaseBusiness size={18} />
              <span>
                <strong>Ghi chú cuộc gọi</strong>
                <small>Cập nhật thông tin khách hàng</small>
              </span>
              <ArrowUpRight size={15} />
            </button>
            <button onClick={() => setToast('Đã tạo báo cáo tháng')}>
              <BarChart3 size={18} />
              <span>
                <strong>Tạo báo cáo tháng</strong>
                <small>Xuất kết quả</small>
              </span>
              <ArrowUpRight size={15} />
            </button>
          </div>
        </Card>
      </div>

      <Card>
        <div className="section-head">
          <div>
            <h2>Thông tin khách hàng</h2>
            <p>Dữ liệu đang lưu trong hệ thống</p>
          </div>
        </div>
        <div className="signal-grid">
          <div>
            <span>Số điện thoại</span>
            <strong>{client.phone || '—'}</strong>
          </div>
          <div>
            <span>Người liên hệ</span>
            <strong>{client.contact_name || '—'}</strong>
          </div>
          <div>
            <span>Giọng văn</span>
            <strong>{client.brand_voice || '—'}</strong>
          </div>
          <div>
            <span>Website</span>
            <strong>{client.website_url || '—'}</strong>
          </div>
        </div>
        {client.gbp_link && (
          <div style={{ marginTop: 16 }}>
            <span style={{ color: '#6b7280', fontSize: 13 }}>Link GBP: </span>
            <a href={client.gbp_link} target="_blank" rel="noreferrer" style={{ color: '#2563eb' }}>
              {client.gbp_link}
            </a>
          </div>
        )}
        {client.notes && (
          <div style={{ marginTop: 12, color: '#6b7280', fontSize: 14 }}>
            <strong>Ghi chú:</strong> {client.notes}
          </div>
        )}
      </Card>
    </>
  )
}

function ClientDetail({ navigate }: any) { return <><Card className="client-hero"><div className="client-hero-title"><div className="client-avatar hero bg-primary">TA</div><div><div className="title-line"><h2>Nha khoa Tâm An</h2><Badge status="active" /></div><p>Nha khoa · Quận 3, TP.HCM · Đã tham gia 4 tháng</p></div></div><div className="hero-actions"><button className="secondary-button" onClick={() => navigate('/clients/1/audit')}><ClipboardCheck size={16} />Chạy Audit</button><button className="secondary-button" onClick={() => navigate('/clients/1/plan')}><Target size={16} />Xem lộ trình</button><button className="primary-button" onClick={() => navigate('/contents')}><FileText size={16} />Xem nội dung</button></div></Card><div className="detail-grid"><Card><div className="section-head"><div><h2>Chu kỳ hiện tại</h2><p>Ngày 01/06 — 30/06/2025</p></div><Badge status="active" /></div><div className="progress-row"><div><span>Tiến độ task</span><strong>18 / 24</strong></div><div className="progress"><i style={{ width: '75%' }} /></div></div><div className="stats-strip"><div><strong>82</strong><span>Điểm audit</span></div><div><strong>18</strong><span>Task hoàn thành</span></div><div><strong>12</strong><span>Bài đã tạo</span></div><div><strong>7</strong><span>Chờ duyệt</span></div></div></Card><Card><div className="section-head"><div><h2>Việc ưu tiên</h2><p>Cần hoàn thành sớm</p></div><ArrowUpRight size={16} /></div><div className="priority-item"><div className="priority-dot" /><div><strong>Duyệt 3 bài GBP tuần 3</strong><span>Hạn hôm nay · Ưu tiên cao</span></div></div><div className="priority-item"><div className="priority-dot blue" /><div><strong>Bổ sung ảnh dịch vụ</strong><span>Hạn 20/06 · Ưu tiên vừa</span></div></div></Card></div><Card><div className="section-head"><div><h2>Hoạt động gần đây</h2><p>Lịch sử thay đổi trên hồ sơ</p></div></div><div className="timeline"><Timeline title="Đã hoàn thành audit lần 2" time="Hôm nay, 09:42" icon={ClipboardCheck} /><Timeline title="Tạo 4 bài viết từ lộ trình tuần 3" time="Hôm qua, 16:20" icon={Sparkles} /><Timeline title="Duyệt lộ trình 30 ngày" time="12/06/2025, 10:15" icon={Check} /></div></Card></> }
function Timeline({ title, time, icon: Icon }: any) { return <div className="timeline-item"><div className="timeline-icon"><Icon size={15} /></div><div><strong>{title}</strong><span>{time}</span></div></div> }
function Audit({ navigate, setToast }: any) {
  const [client, setClient] = useState<any>(null)
  const [loadingClient, setLoadingClient] = useState(true)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<string | null>(null)

  const [form, setForm] = useState({
    description: '',
    primary_category: '',
    additional_categories: '',
    review_count: '',
    rating: '',
    recent_posts: 'Đăng đều hàng tuần',
    photos_status: 'Có ảnh mới trong 3 tháng',
    additional_info: '',
  })

  function update(key: string, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  useEffect(() => {
    async function load() {
      try {
        const path = window.location.pathname
        const id = path.split('/clients/')[1]?.split('/')[0]
        if (!id) throw new Error('Không tìm thấy ID khách hàng')

        const res = await fetch('/api/clients')
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Không tải được dữ liệu')

        const found = (Array.isArray(data) ? data : []).find((c: any) => c.id === id)
        if (!found) throw new Error('Không tìm thấy khách hàng')

        setClient(found)
        setForm((prev) => ({
          ...prev,
          primary_category: found.industry || '',
        }))
      } catch (err: any) {
        setError(err.message || 'Có lỗi xảy ra')
      } finally {
        setLoadingClient(false)
      }
    }
    load()
  }, [])

  async function handleRunAudit() {
    if (!client) return
    setError('')
    setRunning(true)
    setResult(null)

    try {
      const res = await fetch('/api/audit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: client.id,
          business_name: client.name,
          industry: client.industry || '',
          area: client.area || '',
          gbp_link: client.gbp_link || '',
          ...form,
        }),
      })
      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || 'Audit thất bại')
      }

      setResult(data.audit_result || 'Không có kết quả')
      setToast('Đã chạy audit thành công')
    } catch (err: any) {
      setError(err.message || 'Có lỗi xảy ra')
    } finally {
      setRunning(false)
    }
  }

  if (loadingClient) {
    return (
      <Card>
        <div style={{ padding: 40, textAlign: 'center', color: '#6b7280' }}>
          Đang tải thông tin khách hàng...
        </div>
      </Card>
    )
  }

  if (!client) {
    return (
      <Card>
        <div style={{ padding: 40, textAlign: 'center', color: '#b91c1c' }}>
          {error || 'Không tìm thấy khách hàng'}
        </div>
      </Card>
    )
  }

  return (
    <div className="audit-layout">
      <Card className="audit-form">
        <div className="section-head">
          <div>
            <h2>Dữ liệu audit — {client.name}</h2>
            <p>Điền thêm thông tin GBP để AI phân tích chính xác hơn.</p>
          </div>
        </div>

        <label className="field">
          <span>Mô tả hiện tại trên GBP</span>
          <textarea
            value={form.description}
            onChange={(e) => update('description', e.target.value)}
            placeholder="Mô tả đang hiển thị trên hồ sơ..."
          />
        </label>

        <div className="form-grid compact">
          <label className="field">
            <span>Danh mục chính</span>
            <input
              value={form.primary_category}
              onChange={(e) => update('primary_category', e.target.value)}
              placeholder="Nha khoa"
            />
          </label>
          <label className="field">
            <span>Danh mục phụ</span>
            <input
              value={form.additional_categories}
              onChange={(e) => update('additional_categories', e.target.value)}
              placeholder="Phòng khám nha khoa"
            />
          </label>
          <label className="field">
            <span>Số đánh giá</span>
            <input
              value={form.review_count}
              onChange={(e) => update('review_count', e.target.value)}
              placeholder="128"
            />
          </label>
          <label className="field">
            <span>Điểm trung bình</span>
            <input
              value={form.rating}
              onChange={(e) => update('rating', e.target.value)}
              placeholder="4.8"
            />
          </label>
        </div>

        <label className="field">
          <span>Tình trạng bài đăng gần đây</span>
          <select
            value={form.recent_posts}
            onChange={(e) => update('recent_posts', e.target.value)}
          >
            <option>Đăng đều hàng tuần</option>
            <option>Đăng thưa thớt</option>
            <option>Không đăng trong 30 ngày</option>
          </select>
        </label>

        <label className="field">
          <span>Tình trạng hình ảnh</span>
          <select
            value={form.photos_status}
            onChange={(e) => update('photos_status', e.target.value)}
          >
            <option>Có ảnh mới trong 3 tháng</option>
            <option>Ảnh cũ hơn 6 tháng</option>
            <option>Chưa cập nhật</option>
          </select>
        </label>

        <label className="field">
          <span>Thông tin thêm (nếu có)</span>
          <textarea
            value={form.additional_info}
            onChange={(e) => update('additional_info', e.target.value)}
            placeholder="Ví dụ: có dịch vụ niềng răng, phòng khám mới..."
          />
        </label>

        {error && (
          <div style={{ color: '#b91c1c', background: '#fef2f2', padding: 12, borderRadius: 8, marginBottom: 12 }}>
            {error}
          </div>
        )}

        <button
          className="primary-button full"
          onClick={handleRunAudit}
          disabled={running}
        >
          {running ? 'Đang chạy audit...' : (<><Sparkles size={17} /> Chạy Audit</>)}
        </button>
      </Card>

      <Card className="result-panel">
        <div className="result-top">
          <div>
            <p className="overline">Kết quả phân tích</p>
            <h2>Audit tổng quan</h2>
          </div>
        </div>

        {!result && !running && (
          <div style={{ padding: 32, textAlign: 'center', color: '#6b7280' }}>
            Điền thông tin bên trái rồi bấm “Chạy Audit” để xem kết quả.
          </div>
        )}

        {running && (
          <div style={{ padding: 32, textAlign: 'center', color: '#6b7280' }}>
            AI đang phân tích... vui lòng đợi.
          </div>
        )}

        {result && (
          <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6, fontSize: 14 }}>
            {result}
          </div>
        )}

        {result && (
          <button
            className="secondary-button full"
            style={{ marginTop: 20 }}
            onClick={() => navigate(`/clients/${client.id}/plan`)}
          >
            <Target size={16} /> Tạo lộ trình 30 ngày
          </button>
        )}
      </Card>
    </div>
  )
}
function Score({ label, value }: any) { return <div className="score-row"><div><span>{label}</span><strong>{value}/100</strong></div><div className="progress"><i style={{ width: `${value}%` }} /></div></div> }
function Plan({ setToast }: any) {
  const [client, setClient] = useState<any>(null)
  const [loadingClient, setLoadingClient] = useState(true)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<string | null>(null)
  const [savedPlan, setSavedPlan] = useState<any>(null)

  const [auditRecord, setAuditRecord] = useState<any>(null)
  const [loadingAudit, setLoadingAudit] = useState(true)
  const [auditResult, setAuditResult] = useState('')

  const [generatingTopics, setGeneratingTopics] = useState(false)
  const [topicsCreated, setTopicsCreated] = useState<any[] | null>(null)
  const [topicsError, setTopicsError] = useState('')

  useEffect(() => {
    async function load() {
      try {
        const path = window.location.pathname
        const id = path.split('/clients/')[1]?.split('/')[0]
        if (!id) throw new Error('Không tìm thấy ID khách hàng')

        const res = await fetch('/api/clients')
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Không tải được dữ liệu')

        const found = (Array.isArray(data) ? data : []).find((c: any) => c.id === id)
        if (!found) throw new Error('Không tìm thấy khách hàng')

        setClient(found)

        // Tự động lấy audit gần nhất của khách hàng này, đúng nguyên tắc
        // "Không viết bài mù" — lộ trình phải bám audit thật, không dán tay.
        try {
          const auditRes = await fetch(`/api/audit?client_id=${id}`)
          const auditData = await auditRes.json()
          if (auditRes.ok && auditData) {
            setAuditRecord(auditData)
            setAuditResult(auditData.audit_result || '')
          }
        } catch {
          // Không có audit nào — vẫn cho phép tạo lộ trình, người dùng sẽ thấy cảnh báo
        } finally {
          setLoadingAudit(false)
        }
      } catch (err: any) {
        setError(err.message || 'Có lỗi xảy ra')
        setLoadingAudit(false)
      } finally {
        setLoadingClient(false)
      }
    }
    load()
  }, [])

  async function handleCreatePlan() {
    if (!client) return
    setError('')
    setRunning(true)
    setResult(null)
    setSavedPlan(null)
    setTopicsCreated(null)
    setTopicsError('')

    try {
      const today = new Date()
      const end = new Date(today)
      end.setDate(end.getDate() + 30)

      const res = await fetch('/api/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: client.id,
          audit_id: auditRecord?.id,
          business_name: client.name,
          industry: client.industry || '',
          area: client.area || '',
          audit_result: auditResult || '',
          start_date: today.toISOString().slice(0, 10),
          end_date: end.toISOString().slice(0, 10),
        }),
      })
      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || 'Tạo lộ trình thất bại')
      }

      setResult(data.plan_result || 'Không có kết quả')
      setSavedPlan(data.plan || null)
      setToast('Đã tạo lộ trình 30 ngày')
    } catch (err: any) {
      setError(err.message || 'Có lỗi xảy ra')
    } finally {
      setRunning(false)
    }
  }

  async function handleGenerateTopics() {
    if (!client || !result) return
    setGeneratingTopics(true)
    setTopicsError('')
    setTopicsCreated(null)

    try {
      const res = await fetch('/api/content/generate-topics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: client.id,
          plan_id: savedPlan?.id,
          business_name: client.name,
          industry: client.industry || '',
          area: client.area || '',
          plan_result: result,
          start_date: savedPlan?.start_date || new Date().toISOString().slice(0, 10),
        }),
      })
      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || 'Sinh lịch nội dung thất bại')
      }

      setTopicsCreated(data.items || [])
      setToast(`Đã tạo ${data.items?.length || 0} chủ đề nội dung từ lộ trình`)
    } catch (err: any) {
      setTopicsError(err.message || 'Có lỗi xảy ra')
    } finally {
      setGeneratingTopics(false)
    }
  }

  if (loadingClient) {
    return (
      <Card>
        <div style={{ padding: 40, textAlign: 'center', color: '#6b7280' }}>
          Đang tải thông tin khách hàng...
        </div>
      </Card>
    )
  }

  if (!client) {
    return (
      <Card>
        <div style={{ padding: 40, textAlign: 'center', color: '#b91c1c' }}>
          {error || 'Không tìm thấy khách hàng'}
        </div>
      </Card>
    )
  }

  return (
    <>
      <Card className="plan-summary">
        <div>
          <p className="overline">Lộ trình 30 ngày</p>
          <div className="title-line">
            <h2>Lộ trình tăng trưởng Local SEO</h2>
          </div>
          <p>
            Doanh nghiệp: <strong>{client.name}</strong>
            {client.industry || client.area
              ? ` · ${[client.industry, client.area].filter(Boolean).join(' · ')}`
              : ''}
          </p>
        </div>

        <div style={{ marginTop: 16 }}>
          <label className="field">
            <span>
              {loadingAudit
                ? 'Đang tải audit gần nhất...'
                : auditRecord
                ? `Audit gần nhất (tự động lấy · ${new Date(auditRecord.created_at).toLocaleDateString('vi-VN')})`
                : 'Chưa có audit nào — nên chạy Audit trước khi lập lộ trình'}
            </span>
            <textarea
              value={auditResult}
              onChange={(e) => setAuditResult(e.target.value)}
              placeholder="Chưa có audit đã lưu cho khách hàng này. Hãy chạy Audit trước, hoặc dán kết quả audit vào đây."
              rows={5}
            />
          </label>
        </div>

        {error && (
          <div style={{ color: '#b91c1c', background: '#fef2f2', padding: 12, borderRadius: 8, marginTop: 12 }}>
            {error}
          </div>
        )}

        <div className="plan-actions" style={{ marginTop: 16 }}>
          <button
            className="primary-button"
            onClick={handleCreatePlan}
            disabled={running}
          >
            {running ? 'Đang tạo lộ trình...' : (<><Sparkles size={16} /> Tạo lộ trình 30 ngày</>)}
          </button>
        </div>
      </Card>

      {running && (
        <Card>
          <div style={{ padding: 40, textAlign: 'center', color: '#6b7280' }}>
            AI đang xây dựng lộ trình 30 ngày... vui lòng đợi.
          </div>
        </Card>
      )}

      {result && (
        <Card>
          <div className="section-head">
            <div>
              <h2>Lộ trình đã tạo</h2>
              <p>Kết quả từ AI</p>
            </div>
          </div>
          <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6, fontSize: 14 }}>
            {result}
          </div>
        </Card>
      )}

      {result && (
        <Card>
          <div className="section-head">
            <div>
              <h2>Sinh lịch nội dung từ lộ trình</h2>
              <p>Tạo sẵn danh sách chủ đề bài viết theo đúng lộ trình vừa lập</p>
            </div>
            <button
              className="secondary-button"
              onClick={handleGenerateTopics}
              disabled={generatingTopics}
            >
              {generatingTopics ? 'Đang sinh lịch...' : (<><Sparkles size={15} />Sinh lịch nội dung</>)}
            </button>
          </div>

          {topicsError && (
            <div style={{ color: '#b91c1c', background: '#fef2f2', padding: 12, borderRadius: 8 }}>
              {topicsError}
            </div>
          )}

          {topicsCreated && topicsCreated.length > 0 && (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>Ngày dự kiến</th><th>Chủ đề</th><th>Mục tiêu</th></tr>
                </thead>
                <tbody>
                  {topicsCreated.map((t: any) => (
                    <tr key={t.id}>
                      <td className="muted-cell">{t.scheduled_date || '—'}</td>
                      <td><strong>{t.topic}</strong></td>
                      <td>{t.goal || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p style={{ marginTop: 12, fontSize: 13, color: '#6b7280' }}>
                Vào mục "Nội dung" → tab "Ý tưởng" để cho AI viết bài từng chủ đề.
              </p>
            </div>
          )}
        </Card>
      )}
    </>
  )
}
function Tasks() { return <Card><div className="toolbar"><select><option>Tất cả khách hàng</option><option>Nha khoa Tâm An</option></select><select><option>Tất cả trạng thái</option><option>Đang chờ</option><option>Hoàn thành</option></select><select><option>Tất cả ưu tiên</option><option>Cao</option></select></div><div className="table-wrap"><table><thead><tr><th>Việc cần làm</th><th>Khách hàng</th><th>Loại việc</th><th>Ưu tiên</th><th>Hạn</th><th>Trạng thái</th></tr></thead><tbody>{tasks.map(t => <tr key={t[0]}><td><strong>{t[0]}</strong></td><td>{t[1]}</td><td><span className="type-label">{t[2]}</span></td><td><span className={`priority ${t[3] === 'Cao' ? 'high' : ''}`}>{t[3]}</span></td><td className="muted-cell">{t[4]}</td><td><Badge status={t[5]} /></td></tr>)}</tbody></table></div></Card> }
function Contents({ navigate, setToast }: any) {
  const [items, setItems] = useState<any[]>([])
  const [clients, setClients] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState('waiting_approval')
  const [writingId, setWritingId] = useState<string | null>(null)

  async function loadItems() {
    try {
      const res = await fetch('/api/content')
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Không tải được nội dung')
      setItems(Array.isArray(data) ? data : [])
    } catch (err: any) {
      setError(err.message || 'Có lỗi xảy ra')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    async function loadAll() {
      await loadItems()
      try {
        const res = await fetch('/api/clients')
        const data = await res.json()
        if (res.ok) setClients(Array.isArray(data) ? data : [])
      } catch {
        // Không chặn trang nội dung nếu tải danh sách khách hàng lỗi
      }
    }
    loadAll()
  }, [])

  const clientMap = useMemo(() => {
    const map: Record<string, any> = {}
    clients.forEach((c) => { map[c.id] = c })
    return map
  }, [clients])

  const pending = items.filter(
    (c) => filter === 'all' || c.status === filter
  )

  async function handleWriteContent(item: any) {
    const client = clientMap[item.client_id]
    if (!client) {
      setToast('Không tìm thấy thông tin khách hàng cho ý tưởng này')
      return
    }
    setWritingId(item.id)
    try {
      const res = await fetch('/api/content', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content_id: item.id,
          client_id: item.client_id,
          plan_id: item.plan_id,
          topic: item.topic,
          goal: item.goal,
          business_name: client.name,
          industry: client.industry || '',
          area: client.area || '',
          brand_voice: client.brand_voice || 'chuyên nghiệp, gần gũi',
          phone: client.phone || '',
          extra_info: client.notes || '',
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Viết bài thất bại')

      setToast('Đã viết bài bằng AI, sẵn sàng để duyệt')
      await loadItems()
      navigate(`/contents/${item.id}`)
    } catch (err: any) {
      setToast(err.message || 'Có lỗi xảy ra')
    } finally {
      setWritingId(null)
    }
  }

  return (
    <>
      <div className="approval-summary">
        <div>
          <p className="overline">Nội dung thật từ hệ thống</p>
          <h2>
            {loading
              ? 'Đang tải...'
              : `${pending.length} bài viết ${filter === 'waiting_approval' ? 'đang chờ duyệt' : ''}`}
          </h2>
          <p>Danh sách bài viết đã được AI tạo và lưu trong database.</p>
        </div>
      </div>

      <Card>
        <div className="approval-tabs">
          <button
            className={filter === 'idea' ? 'active' : ''}
            onClick={() => setFilter('idea')}
          >
            Ý tưởng
          </button>
          <button
            className={filter === 'waiting_approval' ? 'active' : ''}
            onClick={() => setFilter('waiting_approval')}
          >
            Chờ duyệt
          </button>
          <button
            className={filter === 'all' ? 'active' : ''}
            onClick={() => setFilter('all')}
          >
            Tất cả
          </button>
          <button
            className={filter === 'approved' ? 'active' : ''}
            onClick={() => setFilter('approved')}
          >
            Đã duyệt
          </button>
        </div>

        {loading && (
          <div style={{ padding: 40, textAlign: 'center', color: '#6b7280' }}>
            Đang tải danh sách bài viết...
          </div>
        )}

        {error && (
          <div style={{ padding: 20, color: '#b91c1c' }}>{error}</div>
        )}

        {!loading && !error && pending.length === 0 && (
          <div style={{ padding: 40, textAlign: 'center', color: '#6b7280' }}>
            {filter === 'idea'
              ? 'Chưa có ý tưởng nào. Vào trang Lộ trình của một khách hàng và bấm "Sinh lịch nội dung".'
              : 'Chưa có bài viết nào. Hãy dùng trang test hoặc form viết bài để tạo.'}
          </div>
        )}

        {!loading && pending.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Chủ đề</th>
                  <th>Khách hàng</th>
                  <th>Trạng thái</th>
                  <th>Ngày tạo</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {pending.map((c) => (
                  <tr key={c.id} onClick={() => c.status !== 'idea' && navigate(`/contents/${c.id}`)}>
                    <td>
                      <strong>{c.topic || 'Không có tiêu đề'}</strong>
                      <small>Mục tiêu: {c.goal || '—'}</small>
                    </td>
                    <td className="muted-cell">{clientMap[c.client_id]?.name || '—'}</td>
                    <td>
                      <Badge status={c.status || 'drafted'} />
                    </td>
                    <td className="muted-cell">
                      {c.created_at
                        ? new Date(c.created_at).toLocaleDateString('vi-VN')
                        : '—'}
                    </td>
                    <td>
                      {c.status === 'idea' ? (
                        <button
                          className="secondary-button"
                          disabled={writingId === c.id}
                          onClick={(e) => { e.stopPropagation(); handleWriteContent(c) }}
                        >
                          {writingId === c.id ? 'Đang viết...' : (<><Sparkles size={14} />Viết bài bằng AI</>)}
                        </button>
                      ) : (
                        <button className="icon-button">
                          <ArrowUpRight size={16} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  )
}
function ContentDetail({ setToast }: any) {
  const [content, setContentData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [finalText, setFinalText] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    async function load() {
      try {
        const path = window.location.pathname
        const id = path.split('/contents/')[1]?.split('/')[0]
        if (!id) throw new Error('Không tìm thấy ID bài viết')

        const res = await fetch(`/api/content/${id}`)
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Không tải được bài viết')

        setContentData(data)
        setFinalText(data.final_content || data.ai_content || '')
      } catch (err: any) {
        setError(err.message || 'Có lỗi xảy ra')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  async function patch(body: any, successMsg: string) {
    if (!content) return
    setSaving(true)
    try {
      const res = await fetch(`/api/content/${content.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Cập nhật thất bại')
      setContentData(data)
      setToast(successMsg)
    } catch (err: any) {
      setToast(err.message || 'Có lỗi xảy ra')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <Card>
        <div style={{ padding: 40, textAlign: 'center', color: '#6b7280' }}>
          Đang tải bài viết...
        </div>
      </Card>
    )
  }

  if (error || !content) {
    return (
      <Card>
        <div style={{ padding: 40, textAlign: 'center', color: '#b91c1c' }}>
          {error || 'Không tìm thấy bài viết'}
        </div>
      </Card>
    )
  }

  return (
    <>
      <Card className="content-meta">
        <div>
          <div className="title-line">
            <div className="doc-icon large"><FileText size={19} /></div>
            <div>
              <p className="overline">GBP POST{content.goal ? ` · ${content.goal}` : ''}</p>
              <h2>{content.topic || 'Không có tiêu đề'}</h2>
            </div>
          </div>
        </div>
        <Badge status={content.status || 'drafted'} />
      </Card>

      <div className="content-review">
        {content.critic_feedback && (
          <Card className="critic-card">
            <div className="section-head">
              <div><h2>Nhận xét Critic</h2><p>Kiểm tra chất lượng trước khi xuất bản</p></div>
            </div>
            <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6, fontSize: 14 }}>{content.critic_feedback}</div>
          </Card>
        )}

        {content.serp_analysis && (
          <Card>
            <div className="section-head">
              <div><h2>Phân tích SERP-Aware</h2><p>Góc nhìn từ AI trước khi viết</p></div>
              <Sparkles size={18} />
            </div>
            <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6, fontSize: 14 }}>{content.serp_analysis}</div>
          </Card>
        )}

        {content.ai_content && (
          <Card>
            <div className="section-head">
              <div><h2>Bản nháp</h2><p>AI Writer v1</p></div>
            </div>
            <div className="draft-box">{content.ai_content}</div>
          </Card>
        )}

        <Card>
          <div className="section-head">
            <div><h2>Bản cuối</h2><p>Chỉnh sửa nội dung trước khi duyệt</p></div>
          </div>
          <textarea
            className="final-editor"
            value={finalText}
            onChange={(e) => setFinalText(e.target.value)}
          />
          <div className="editor-actions">
            <button
              className="secondary-button"
              disabled={saving}
              onClick={() => patch({ final_content: finalText }, 'Đã lưu chỉnh sửa')}
            >
              <Check size={16} />Lưu chỉnh sửa
            </button>
            <button
              className="primary-button"
              disabled={saving}
              onClick={() => patch({ final_content: finalText, status: 'approved' }, 'Đã duyệt bài viết')}
            >
              <Check size={16} />Duyệt bài
            </button>
            <button
              className="secondary-button"
              disabled={saving}
              onClick={() => patch({ status: 'published' }, 'Đã đánh dấu nội dung đã đăng')}
            >
              <Check size={16} />Đánh dấu đã đăng
            </button>
          </div>
        </Card>
      </div>
    </>
  )
}
function SettingsView() { return <div className="settings-layout"><Card className="settings-nav"><button className="active">Hồ sơ workspace</button><button>API & tích hợp</button><button>Thông báo</button><button>Ngôn ngữ</button></Card><Card className="settings-content"><div className="section-head"><div><h2>Hồ sơ workspace</h2><p>Quản lý thông tin hiển thị của workspace.</p></div></div><div className="form-grid"><Field label="Tên workspace" placeholder="Growth Studio" /><Field label="Email liên hệ" placeholder="hello@growthstudio.vn" /><Field label="Tên người dùng" placeholder="Hải Nguyễn" /></div><button className="primary-button">Lưu thay đổi</button></Card></div> }

