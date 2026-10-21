'use client'

import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { Card } from '@/components/dashboard/shared'
import { ROLE_LABEL } from '@/lib/ui-constants'

export default function SettingsPage() {
  const [tab, setTab] = useState<'workspace' | 'members' | 'reminders'>('workspace')
  const [activeWorkspace, setActiveWorkspace] = useState<any>(null)
  const [activeRole, setActiveRole] = useState<string>('member')
  const [members, setMembers] = useState<any[]>([])
  const [loadingMembers, setLoadingMembers] = useState(true)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState('member')
  const [inviting, setInviting] = useState(false)
  const [error, setError] = useState('')
  const [updatingId, setUpdatingId] = useState<string | null>(null)

  const isAdmin = activeRole === 'owner' || activeRole === 'admin'

  // Nhắc việc qua email
  type ReminderPrefs = { email: string; email_enabled: boolean; provider_ready: boolean; setup_required: boolean }
  const [prefs, setPrefs] = useState<ReminderPrefs | null>(null)
  const [loadingPrefs, setLoadingPrefs] = useState(false)
  const [savingPrefs, setSavingPrefs] = useState(false)
  const [testing, setTesting] = useState(false)
  const [prefsError, setPrefsError] = useState('')
  const [prefsNotice, setPrefsNotice] = useState('')

  useEffect(() => {
    fetch('/api/me')
      .then((r) => r.json())
      .then((data) => {
        setActiveWorkspace(data.activeWorkspace || null)
        setActiveRole(data.activeRole || 'member')
      })
      .catch(() => {})
  }, [])

  function loadMembers() {
    setLoadingMembers(true)
    fetch('/api/workspace-members')
      .then((r) => r.json())
      .then((data) => setMembers(Array.isArray(data) ? data : []))
      .catch(() => {})
      .finally(() => setLoadingMembers(false))
  }

  useEffect(() => {
    if (tab === 'members') loadMembers()
    if (tab === 'reminders' && !prefs) {
      setLoadingPrefs(true)
      fetch('/api/notifications/prefs')
        .then(async (r) => {
          const data = await r.json()
          if (!r.ok) throw new Error(data.error || 'Không tải được cài đặt nhắc việc')
          setPrefs(data)
        })
        .catch((err) => setPrefsError(err.message || 'Có lỗi xảy ra'))
        .finally(() => setLoadingPrefs(false))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab])

  async function toggleReminders(next: boolean) {
    if (!prefs) return
    const previous = prefs.email_enabled
    setPrefs({ ...prefs, email_enabled: next })
    setSavingPrefs(true)
    setPrefsError('')
    setPrefsNotice('')
    try {
      const res = await fetch('/api/notifications/prefs', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email_enabled: next }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Chưa lưu được')
      setPrefsNotice(next ? 'Đã bật email nhắc việc.' : 'Đã tắt email nhắc việc.')
    } catch (err: any) {
      setPrefs((p) => (p ? { ...p, email_enabled: previous } : p))
      setPrefsError(err.message || 'Có lỗi xảy ra')
    } finally {
      setSavingPrefs(false)
    }
  }

  async function sendTestReminder() {
    setTesting(true)
    setPrefsError('')
    setPrefsNotice('')
    try {
      const res = await fetch('/api/notifications/test', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Chưa gửi thử được')
      setPrefsNotice(`Đã gửi email thử tới ${data.to}. Nếu chưa thấy, hãy kiểm tra thư mục spam.`)
    } catch (err: any) {
      setPrefsError(err.message || 'Có lỗi xảy ra')
    } finally {
      setTesting(false)
    }
  }

  async function handleInvite() {
    if (!inviteEmail.trim()) return
    setInviting(true)
    setError('')
    try {
      const res = await fetch('/api/workspace-members', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: inviteEmail.trim(), role: inviteRole }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Mời thất bại')
      setInviteEmail('')
      loadMembers()
    } catch (err: any) {
      setError(err.message || 'Có lỗi xảy ra')
    } finally {
      setInviting(false)
    }
  }

  async function handleRoleChange(memberId: string, role: string) {
    setUpdatingId(memberId)
    try {
      const res = await fetch(`/api/workspace-members/${memberId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Cập nhật thất bại')
      loadMembers()
    } catch (err: any) {
      setError(err.message || 'Có lỗi xảy ra')
    } finally {
      setUpdatingId(null)
    }
  }

  async function handleRemove(memberId: string) {
    setUpdatingId(memberId)
    try {
      const res = await fetch(`/api/workspace-members/${memberId}`, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Xoá thất bại')
      loadMembers()
    } catch (err: any) {
      setError(err.message || 'Có lỗi xảy ra')
    } finally {
      setUpdatingId(null)
    }
  }

  return (
    <div className="settings-layout">
      <Card className="settings-nav">
        <button className={tab === 'workspace' ? 'active' : ''} onClick={() => setTab('workspace')}>
          Không gian làm việc
        </button>
        <button className={tab === 'members' ? 'active' : ''} onClick={() => setTab('members')}>
          Thành viên
        </button>
        <button className={tab === 'reminders' ? 'active' : ''} onClick={() => setTab('reminders')}>
          Nhắc việc
        </button>
      </Card>

      {tab === 'workspace' && (
        <Card className="settings-content">
          <div className="section-head">
            <div>
              <h2>Không gian làm việc</h2>
              <p>Nơi chứa doanh nghiệp, kế hoạch và bài viết của bạn và đội ngũ.</p>
            </div>
          </div>
          <div className="signal-grid">
            <div>
              <span>Tên</span>
              <strong>{activeWorkspace?.name || '—'}</strong>
            </div>
            <div>
              <span>Gói đang dùng</span>
              <strong>{activeWorkspace?.plan || '—'}</strong>
            </div>
            <div>
              <span>Vai trò của bạn</span>
              <strong>{ROLE_LABEL[activeRole] || activeRole}</strong>
            </div>
          </div>
        </Card>
      )}

      {tab === 'reminders' && (
        <Card className="settings-content">
          <div className="section-head">
            <div>
              <h2>Nhắc việc</h2>
              <p>Mỗi sáng, hệ thống gửi email nếu bạn có việc đến hạn hoặc đã quá hạn. Không có việc thì không gửi.</p>
            </div>
          </div>

          {loadingPrefs && <div className="empty-note">Đang tải…</div>}
          {prefsError && <div className="alert alert-error" style={{ marginBottom: 16 }}>{prefsError}</div>}

          {prefs && (
            <>
              {prefs.setup_required && (
                <div className="alert alert-warn" style={{ marginBottom: 16 }}>
                  Chưa bật được nhắc việc vì database còn thiếu một bước thiết lập. Hãy nhờ người quản trị hệ thống chạy bản cập nhật 014.
                </div>
              )}
              {!prefs.provider_ready && (
                <div className="alert alert-warn" style={{ marginBottom: 16 }}>
                  Hệ thống chưa được cấu hình dịch vụ gửi email, nên email nhắc việc chưa được gửi đi. Hãy nhờ người quản trị thiết lập.
                </div>
              )}

              <label className="switch">
                <span>
                  <strong>Email nhắc việc mỗi sáng</strong>
                  <small>Gửi tới {prefs.email}, khoảng 8 giờ sáng.</small>
                </span>
                <input
                  type="checkbox"
                  role="switch"
                  checked={prefs.email_enabled}
                  disabled={savingPrefs || prefs.setup_required}
                  onChange={(e) => toggleReminders(e.target.checked)}
                />
              </label>

              <div style={{ marginTop: 20, display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
                <button className="secondary-button" onClick={sendTestReminder} disabled={testing || !prefs.provider_ready}>
                  {testing ? 'Đang gửi…' : 'Gửi thử cho tôi'}
                </button>
                <span className="rail-sub" style={{ margin: 0 }}>Nhận ngay một email mẫu bằng việc thật của bạn.</span>
              </div>

              {prefsNotice && <div className="alert alert-ok" style={{ marginTop: 16 }}>{prefsNotice}</div>}
            </>
          )}
        </Card>
      )}

      {tab === 'members' && (
        <Card className="settings-content">
          <div className="section-head">
            <div>
              <h2>Thành viên</h2>
              <p>Quản lý những người được dùng không gian làm việc này.</p>
            </div>
          </div>

          {isAdmin && (
            <div className="toolbar">
              <div className="search-field" style={{ flex: 2 }}>
                <input
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="Email người bạn muốn mời (họ cần có tài khoản trước)" aria-label="Email người được mời"
                />
              </div>
              <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value)}>
                <option value="member">Thành viên</option>
                <option value="admin">Quản trị viên</option>
              </select>
              <button className="primary-button" onClick={handleInvite} disabled={inviting}>
                {inviting ? 'Đang mời...' : 'Mời thành viên'}
              </button>
            </div>
          )}

          {error && <div style={{ color: 'var(--danger)', background: 'var(--danger-soft)', padding: 12, borderRadius: 8, marginBottom: 16 }}>{error}</div>}

          {loadingMembers && <div className="empty-note">Đang tải…</div>}

          {!loadingMembers && members.length > 0 && (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Thành viên</th>
                    <th>Vai trò</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {members.map((m) => (
                    <tr key={m.id}>
                      <td>
                        <strong>{m.full_name || m.email || 'Chưa đặt tên'}</strong>
                        {m.email && <small>{m.email}</small>}
                      </td>
                      <td>
                        {isAdmin ? (
                          <select value={m.role} disabled={updatingId === m.id} onChange={(e) => handleRoleChange(m.id, e.target.value)}>
                            <option value="owner">Chủ sở hữu</option>
                            <option value="admin">Quản trị viên</option>
                            <option value="member">Thành viên</option>
                          </select>
                        ) : (
                          <span className="type-label">{ROLE_LABEL[m.role] || m.role}</span>
                        )}
                      </td>
                      <td>
                        {isAdmin && (
                          <button className="icon-button" disabled={updatingId === m.id} onClick={() => handleRemove(m.id)} title="Xoá khỏi không gian làm việc" aria-label="Xoá khỏi không gian làm việc">
                            <X size={16} />
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
      )}
    </div>
  )
}
