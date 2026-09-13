'use client'

import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { Card, Field } from '@/components/dashboard/shared'

export default function SettingsPage() {
  const [tab, setTab] = useState<'workspace' | 'members'>('workspace')
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
  }, [tab])

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
          Hồ sơ workspace
        </button>
        <button className={tab === 'members' ? 'active' : ''} onClick={() => setTab('members')}>
          Thành viên
        </button>
      </Card>

      {tab === 'workspace' && (
        <Card className="settings-content">
          <div className="section-head">
            <div>
              <h2>Hồ sơ workspace</h2>
              <p>Thông tin workspace đang làm việc.</p>
            </div>
          </div>
          <div className="form-grid">
            <Field label="Tên workspace" placeholder={activeWorkspace?.name || '—'} />
            <Field label="Gói" placeholder={activeWorkspace?.plan || '—'} />
            <Field label="Vai trò của bạn" placeholder={activeRole} />
          </div>
        </Card>
      )}

      {tab === 'members' && (
        <Card className="settings-content">
          <div className="section-head">
            <div>
              <h2>Thành viên</h2>
              <p>Quản lý ai được truy cập workspace này.</p>
            </div>
          </div>

          {isAdmin && (
            <div className="toolbar">
              <div className="search-field" style={{ flex: 2 }}>
                <input
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="Email người muốn mời (phải đã có tài khoản)"
                />
              </div>
              <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value)}>
                <option value="member">Member</option>
                <option value="admin">Admin</option>
              </select>
              <button className="primary-button" onClick={handleInvite} disabled={inviting}>
                {inviting ? 'Đang mời...' : 'Mời thành viên'}
              </button>
            </div>
          )}

          {error && <div style={{ color: '#b91c1c', background: '#fef2f2', padding: 12, borderRadius: 8, marginBottom: 16 }}>{error}</div>}

          {loadingMembers && <div style={{ padding: 40, textAlign: 'center', color: '#6b7280' }}>Đang tải...</div>}

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
                            <option value="owner">Owner</option>
                            <option value="admin">Admin</option>
                            <option value="member">Member</option>
                          </select>
                        ) : (
                          <span className="type-label">{m.role}</span>
                        )}
                      </td>
                      <td>
                        {isAdmin && (
                          <button className="icon-button" disabled={updatingId === m.id} onClick={() => handleRemove(m.id)} title="Xoá khỏi workspace">
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
