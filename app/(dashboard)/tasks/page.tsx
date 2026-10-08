'use client'

import { useEffect, useMemo, useState } from 'react'
import { Bot, ChevronDown, ChevronUp, ExternalLink, Loader2 } from 'lucide-react'
import { Badge, Card } from '@/components/dashboard/shared'
import { TASK_TYPE_LABEL, PRIORITY_LABEL } from '@/lib/ui-constants'

// Khớp đúng lib/task-action.ts (server) — chỉ dùng để quyết hiện nút nào,
// không tự ý thêm/bớt loại ở đây để tránh lệch với logic thật phía server.
const AUTO_TASK_TYPES = new Set(['content', 'description_update'])

type ExecuteResult = {
  ok?: boolean
  executed?: boolean
  actionType?: 'auto_post' | 'manual_guided' | 'needs_connection'
  whyManual?: string
  steps?: string[]
  message?: string
  error?: string
  code?: string
}

export default function TasksPage() {
  const [items, setItems] = useState<any[]>([])
  const [clients, setClients] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [clientFilter, setClientFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [priorityFilter, setPriorityFilter] = useState('all')
  const [updatingId, setUpdatingId] = useState<string | null>(null)

  // Kết quả thực thi/hướng dẫn theo từng task, hiện inline ngay dưới dòng đó.
  const [executingId, setExecutingId] = useState<string | null>(null)
  const [results, setResults] = useState<Record<string, ExecuteResult>>({})
  const [expandedId, setExpandedId] = useState<string | null>(null)

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

  // "Đăng ngay" cho task tự động hoá được — gọi bot thật, cập nhật lại trạng thái từ response thật.
  async function handleAutoExecute(task: any) {
    setExecutingId(task.id)
    setResults((prev) => ({ ...prev, [task.id]: {} }))
    try {
      const res = await fetch(`/api/tasks/${task.id}/execute`, { method: 'POST' })
      const data: ExecuteResult = await res.json()
      setResults((prev) => ({ ...prev, [task.id]: { ...data, ok: res.ok } }))
      if (res.ok && data.executed) {
        setItems((prev) => prev.map((t) => (t.id === task.id ? { ...t, status: 'done' } : t)))
      }
    } catch (err: any) {
      setResults((prev) => ({ ...prev, [task.id]: { error: err.message || 'Lỗi không xác định' } }))
    } finally {
      setExecutingId(null)
    }
  }

  // "Xem hướng dẫn" cho task cần làm thủ công — gọi cùng endpoint, server trả
  // guidance (không thực thi gì), mở rộng dòng để hiện lý do + các bước.
  async function handleShowGuidance(task: any) {
    if (expandedId === task.id) {
      setExpandedId(null)
      return
    }
    setExpandedId(task.id)
    if (results[task.id]?.steps) return // đã có rồi, khỏi gọi lại
    setExecutingId(task.id)
    try {
      const res = await fetch(`/api/tasks/${task.id}/execute`, { method: 'POST' })
      const data: ExecuteResult = await res.json()
      setResults((prev) => ({ ...prev, [task.id]: { ...data, ok: res.ok } }))
    } catch (err: any) {
      setResults((prev) => ({ ...prev, [task.id]: { error: err.message || 'Lỗi không xác định' } }))
    } finally {
      setExecutingId(null)
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
                <th>Hành động</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((t) => {
                const isAuto = AUTO_TASK_TYPES.has(t.task_type)
                const isDone = t.status === 'done'
                const result = results[t.id]
                const isBusy = executingId === t.id
                const isExpanded = expandedId === t.id

                return (
                  <>
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
                      <td>
                        {isDone ? (
                          <span style={{ fontSize: 13, color: '#6b7280' }}>Đã xong</span>
                        ) : isAuto ? (
                          <button
                            className="secondary-button"
                            disabled={isBusy}
                            onClick={() => handleAutoExecute(t)}
                            title="Bot tự động đăng bài này lên Google Maps"
                          >
                            {isBusy ? <Loader2 size={14} className="animate-spin" /> : <Bot size={14} />}
                            {isBusy ? 'Đang đăng...' : 'Đăng ngay'}
                          </button>
                        ) : (
                          <button className="secondary-button" onClick={() => handleShowGuidance(t)}>
                            {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                            Xem hướng dẫn
                          </button>
                        )}
                      </td>
                    </tr>

                    {/* Kết quả "Đăng ngay": thành công / cần kết nối Google / lỗi — hiện ngay dưới dòng, không cần rời trang */}
                    {result && isAuto && (result.error || result.actionType) && (
                      <tr>
                        <td colSpan={7} style={{ padding: '8px 16px', background: '#f9fafb' }}>
                          {result.executed && (
                            <span style={{ color: '#059669', fontSize: 13 }}>
                              ✓ Đã đăng lên Google Maps thành công.
                            </span>
                          )}
                          {result.actionType === 'needs_connection' && (
                            <span style={{ fontSize: 13, color: '#b45309', display: 'flex', alignItems: 'center', gap: 8 }}>
                              Chưa kết nối Google Business Profile cho khách này.
                              <a
                                className="secondary-button"
                                href={`/api/google-connect/start?client_id=${t.client_id}`}
                                style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
                              >
                                Kết nối ngay <ExternalLink size={12} />
                              </a>
                            </span>
                          )}
                          {result.error && !result.actionType && (
                            <span style={{ color: '#b91c1c', fontSize: 13 }}>{result.error}</span>
                          )}
                        </td>
                      </tr>
                    )}

                    {/* Hướng dẫn thủ công — mở rộng khi bấm "Xem hướng dẫn" */}
                    {isExpanded && !isAuto && (
                      <tr>
                        <td colSpan={7} style={{ padding: '12px 16px', background: '#f9fafb' }}>
                          {isBusy && !result?.steps ? (
                            <span style={{ fontSize: 13, color: '#6b7280' }}>Đang tải hướng dẫn...</span>
                          ) : result?.error ? (
                            <span style={{ color: '#b91c1c', fontSize: 13 }}>{result.error}</span>
                          ) : (
                            <>
                              {result?.whyManual && (
                                <p style={{ fontSize: 13, color: '#374151', marginBottom: 10 }}>
                                  <strong>Vì sao cần tự làm:</strong> {result.whyManual}
                                </p>
                              )}
                              {result?.steps && (
                                <ol style={{ fontSize: 13, color: '#374151', paddingLeft: 20, marginBottom: 10 }}>
                                  {result.steps.map((s, i) => (
                                    <li key={i} style={{ marginBottom: 4 }}>
                                      {s}
                                    </li>
                                  ))}
                                </ol>
                              )}
                              <button className="secondary-button" disabled={updatingId === t.id} onClick={() => toggleStatus(t)}>
                                Đã làm xong, đánh dấu hoàn thành
                              </button>
                            </>
                          )}
                        </td>
                      </tr>
                    )}
                  </>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}
