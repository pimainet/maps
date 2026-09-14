'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { ArrowUpRight, BarChart3, ClipboardCheck, FileText, Target } from 'lucide-react'
import { Card } from '@/components/dashboard/shared'
import { TASK_TYPE_LABEL, PRIORITY_LABEL } from '@/lib/ui-constants'
import { useToast } from '@/components/dashboard/toast-context'

export default function ClientDetailPage() {
  const router = useRouter()
  const { showToast } = useToast()
  const params = useParams<{ id: string }>()
  const clientId = params.id

  const [client, setClient] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [pendingTasks, setPendingTasks] = useState<any[]>([])
  const [updatingId, setUpdatingId] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('/api/clients')
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Không tải được dữ liệu')

        const found = (Array.isArray(data) ? data : []).find((c: any) => c.id === clientId)
        if (!found) throw new Error('Không tìm thấy khách hàng')

        setClient(found)

        try {
          const taskRes = await fetch(`/api/tasks?client_id=${clientId}`)
          const taskData = await taskRes.json()
          if (taskRes.ok) {
            setPendingTasks((Array.isArray(taskData) ? taskData : []).filter((t: any) => (t.status || 'pending') === 'pending'))
          }
        } catch {
          // Không chặn trang chi tiết nếu tải việc lỗi
        }
      } catch (err: any) {
        setError(err.message || 'Có lỗi xảy ra')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [clientId])

  async function markDone(taskId: string) {
    setUpdatingId(taskId)
    try {
      const res = await fetch(`/api/tasks/${taskId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'done' }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Cập nhật thất bại')
      setPendingTasks((prev) => prev.filter((t) => t.id !== taskId))
      showToast('Đã hoàn thành công việc')
    } catch (err: any) {
      showToast(err.message || 'Có lỗi xảy ra')
    } finally {
      setUpdatingId(null)
    }
  }

  if (loading) {
    return (
      <Card>
        <div style={{ padding: 40, textAlign: 'center', color: '#6b7280' }}>Đang tải thông tin khách hàng...</div>
      </Card>
    )
  }

  if (error || !client) {
    return (
      <Card>
        <div style={{ padding: 40, textAlign: 'center', color: '#b91c1c' }}>{error || 'Không tìm thấy khách hàng'}</div>
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
            </div>
            <p>{[client.industry, client.area].filter(Boolean).join(' · ') || 'Chưa có ngành / khu vực'}</p>
          </div>
        </div>
        <div className="hero-actions">
          <button className="secondary-button" onClick={() => router.push(`/clients/${client.id}/audit`)}>
            <ClipboardCheck size={16} /> Chạy Audit
          </button>
          <button className="secondary-button" onClick={() => router.push(`/clients/${client.id}/report`)}>
            <BarChart3 size={16} /> Xem báo cáo
          </button>
          <button className="primary-button" onClick={() => router.push(`/clients/${client.id}/plan`)}>
            <Target size={16} /> Tiếp tục lộ trình
          </button>
        </div>
      </Card>

      <div className="action-grid">
        <Card className="next-action-card">
          <div className="section-head">
            <div>
              <p className="overline">Việc tiếp theo</p>
              <h2>Việc đang chờ</h2>
              <p>Các việc chưa hoàn thành của khách hàng này.</p>
            </div>
            <span className="action-count">
              {pendingTasks.length}
              <small>còn lại</small>
            </span>
          </div>
          <div className="task-checklist">
            {pendingTasks.length === 0 && (
              <div style={{ padding: 16, textAlign: 'center', color: '#6b7280' }}>
                Không còn việc nào đang chờ. Vào trang Lộ trình để sinh thêm việc mới.
              </div>
            )}
            {pendingTasks.slice(0, 5).map((task) => (
              <button className="check-task" key={task.id} disabled={updatingId === task.id} onClick={() => markDone(task.id)}>
                <span className="check-box" />
                <span>
                  <strong>{task.title}</strong>
                  <small>
                    {TASK_TYPE_LABEL[task.task_type] || task.task_type} · Ưu tiên {PRIORITY_LABEL[task.priority] || task.priority}
                    {task.due_date ? ` · Hạn ${task.due_date}` : ''}
                  </small>
                </span>
                <ArrowUpRight size={15} />
              </button>
            ))}
          </div>
          <button className="primary-button full" onClick={() => router.push('/tasks')}>
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
            <button onClick={() => router.push('/contents')}>
              <FileText size={18} />
              <span>
                <strong>Duyệt nội dung</strong>
                <small>Xem bài đang chờ</small>
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
        {client.place_id && (
          <div style={{ marginBottom: 8, fontSize: 13, color: '#6b7280' }}>
            Place ID: <code>{client.place_id}</code>
          </div>
        )}
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
