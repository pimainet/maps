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
        if (!found) throw new Error('Không tìm thấy doanh nghiệp này')

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
        <div className="empty-note">Đang tải thông tin doanh nghiệp…</div>
      </Card>
    )
  }

  if (error || !client) {
    return (
      <Card>
        <div className="empty-note error">{error || 'Không tìm thấy doanh nghiệp này'}</div>
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
            <p>{[client.industry, client.area].filter(Boolean).join(', ') || 'Chưa có ngành nghề và khu vực'}</p>
          </div>
        </div>
        <div className="hero-actions">
          <button className="secondary-button" onClick={() => router.push(`/clients/${client.id}/audit`)}>
            <ClipboardCheck size={18} /> Kiểm tra hồ sơ
          </button>
          <button className="secondary-button" onClick={() => router.push(`/clients/${client.id}/report`)}>
            <BarChart3 size={18} /> Xem kết quả
          </button>
          <button className="primary-button" onClick={() => router.push(`/clients/${client.id}/plan`)}>
            <Target size={18} /> Kế hoạch 30 ngày
          </button>
        </div>
      </Card>

      <div className="action-grid">
        <Card className="next-action-card">
          <div className="section-head">
            <div>
              <h2>Việc đang chờ</h2>
              <p>Những việc bạn cần làm cho doanh nghiệp này.</p>
            </div>
            <span className="action-count">
              {pendingTasks.length}
              <small>còn lại</small>
            </span>
          </div>
          <div className="task-checklist">
            {pendingTasks.length === 0 && (
              <div style={{ padding: 16, textAlign: 'center', color: 'var(--muted-foreground)' }}>
                Không còn việc nào đang chờ. Vào Kế hoạch 30 ngày để tạo thêm việc mới.
              </div>
            )}
            {pendingTasks.slice(0, 5).map((task) => (
              <div className="check-task" key={task.id}>
                <button
                  className="check-box"
                  disabled={updatingId === task.id}
                  onClick={() => markDone(task.id)}
                  aria-label={`Đánh dấu đã xong: ${task.title}`}
                  title="Đánh dấu đã xong"
                />
                <button className="task-open" onClick={() => router.push('/tasks')}>
                  <span className="task-text">
                    <strong>{task.title}</strong>
                    <small>
                      {TASK_TYPE_LABEL[task.task_type] || task.task_type}, ưu tiên {(PRIORITY_LABEL[task.priority] || task.priority || '').toLowerCase()}
                      {task.due_date ? `, hạn ${new Date(`${String(task.due_date).slice(0, 10)}T00:00:00`).toLocaleDateString('vi-VN')}` : ''}
                    </small>
                  </span>
                  <ArrowUpRight size={16} style={{ color: 'var(--faint)' }} />
                </button>
              </div>
            ))}
          </div>
          <button className="primary-button full" onClick={() => router.push('/tasks')}>
            <ClipboardCheck size={18} /> Xem tất cả việc
          </button>
        </Card>

        <Card className="quick-actions-card">
          <div className="section-head">
            <div>
              <h2>Lối tắt</h2>
            </div>
          </div>
          <div className="quick-actions">
            <button onClick={() => router.push('/contents')}>
              <FileText size={18} />
              <span>
                <strong>Duyệt bài viết</strong>
                <small>Xem những bài đang chờ bạn</small>
              </span>
              <ArrowUpRight size={15} />
            </button>
          </div>
        </Card>
      </div>

      <Card>
        <div className="section-head">
          <div>
            <h2>Thông tin doanh nghiệp</h2>
            <p>Dùng để viết bài đúng với doanh nghiệp của bạn.</p>
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
            <span style={{ color: 'var(--muted-foreground)', fontSize: 13 }}>Hồ sơ Google: </span>
            <a href={client.gbp_link} target="_blank" rel="noreferrer" style={{ color: 'var(--primary)' }}>
              {client.gbp_link}
            </a>
          </div>
        )}
        {client.notes && (
          <div style={{ marginTop: 12, color: 'var(--muted-foreground)', fontSize: 14 }}>
            <strong>Ghi chú:</strong> {client.notes}
          </div>
        )}
      </Card>
    </>
  )
}
