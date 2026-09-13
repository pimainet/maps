'use client'

import { useEffect, useMemo, useState } from 'react'
import { Badge, Card } from '@/components/dashboard/shared'
import { TASK_TYPE_LABEL, PRIORITY_LABEL } from '@/lib/ui-constants'

export default function TasksPage() {
  const [items, setItems] = useState<any[]>([])
  const [clients, setClients] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [clientFilter, setClientFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [priorityFilter, setPriorityFilter] = useState('all')
  const [updatingId, setUpdatingId] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      try {
        const [taskRes, clientRes] = await Promise.all([fetch('/api/tasks'), fetch('/api/clients')])
        const taskData = await taskRes.json()
        const clientData = await clientRes.json()
        if (!taskRes.ok) throw new Error(taskData.error || 'Không tải được danh sách việc')
        setItems(Array.isArray(taskData) ? taskData : [])
        if (clientRes.ok) setClients(Array.isArray(clientData) ? clientData : [])
      } catch (err: any) {
        setError(err.message || 'Có lỗi xảy ra')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const clientMap = useMemo(() => {
    const map: Record<string, any> = {}
    clients.forEach((c) => {
      map[c.id] = c
    })
    return map
  }, [clients])

  const filtered = items.filter((t) => {
    if (clientFilter !== 'all' && t.client_id !== clientFilter) return false
    if (statusFilter !== 'all' && (t.status || 'pending') !== statusFilter) return false
    if (priorityFilter !== 'all' && t.priority !== priorityFilter) return false
    return true
  })

  async function toggleStatus(task: any) {
    const next = task.status === 'done' ? 'pending' : 'done'
    setUpdatingId(task.id)
    try {
      const res = await fetch(`/api/tasks/${task.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: next }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Cập nhật thất bại')
      setItems((prev) => prev.map((t) => (t.id === task.id ? data : t)))
    } catch (err: any) {
      setError(err.message || 'Cập nhật thất bại')
    } finally {
      setUpdatingId(null)
    }
  }

  return (
    <Card>
      <div className="toolbar">
        <select value={clientFilter} onChange={(e) => setClientFilter(e.target.value)}>
          <option value="all">Tất cả khách hàng</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="all">Tất cả trạng thái</option>
          <option value="pending">Đang chờ</option>
          <option value="done">Hoàn thành</option>
          <option value="skipped">Bỏ qua</option>
        </select>
        <select value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value)}>
          <option value="all">Tất cả ưu tiên</option>
          <option value="high">Cao</option>
          <option value="medium">Trung bình</option>
          <option value="low">Thấp</option>
        </select>
      </div>

      {loading && <div style={{ padding: 40, textAlign: 'center', color: '#6b7280' }}>Đang tải danh sách việc...</div>}
      {error && <div style={{ padding: 20, color: '#b91c1c' }}>{error}</div>}

      {!loading && !error && filtered.length === 0 && (
        <div style={{ padding: 40, textAlign: 'center', color: '#6b7280' }}>
          Chưa có việc nào. Vào trang Lộ trình của một khách hàng và bấm "Sinh lịch việc".
        </div>
      )}

      {!loading && filtered.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Việc cần làm</th>
                <th>Khách hàng</th>
                <th>Loại việc</th>
                <th>Ưu tiên</th>
                <th>Hạn</th>
                <th>Trạng thái</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((t) => (
                <tr key={t.id}>
                  <td>
                    <strong>{t.title}</strong>
                    {t.description && <small style={{ display: 'block', color: '#6b7280' }}>{t.description}</small>}
                  </td>
                  <td>{clientMap[t.client_id]?.name || '—'}</td>
                  <td>
                    <span className="type-label">{TASK_TYPE_LABEL[t.task_type] || t.task_type}</span>
                  </td>
                  <td>
                    <span className={`priority ${t.priority === 'high' ? 'high' : ''}`}>{PRIORITY_LABEL[t.priority] || t.priority}</span>
                  </td>
                  <td className="muted-cell">{t.due_date || '—'}</td>
                  <td>
                    <button
                      className="icon-button"
                      disabled={updatingId === t.id}
                      onClick={() => toggleStatus(t)}
                      title="Bấm để đổi trạng thái hoàn thành"
                    >
                      <Badge status={t.status || 'pending'} />
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
