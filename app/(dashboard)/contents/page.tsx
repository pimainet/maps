'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowUpRight, Loader2, Sparkles } from 'lucide-react'
import { Badge, Card } from '@/components/dashboard/shared'
import { useToast } from '@/components/dashboard/toast-context'

export default function ContentsPage() {
  const router = useRouter()
  const { showToast } = useToast()
  const [contentItems, setContentItems] = useState<any[]>([])
  const [contentTasks, setContentTasks] = useState<any[]>([])
  const [clients, setClients] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState('waiting_approval')
  const [writingId, setWritingId] = useState<string | null>(null)

  async function loadAll() {
    try {
      const [contentRes, taskRes, clientRes] = await Promise.all([fetch('/api/content'), fetch('/api/tasks'), fetch('/api/clients')])
      const contentData = await contentRes.json()
      const taskData = await taskRes.json()
      const clientData = await clientRes.json()

      if (!contentRes.ok) throw new Error(contentData.error || 'Không tải được nội dung')

      setContentItems(Array.isArray(contentData) ? contentData : [])
      setContentTasks(
        taskRes.ok
          ? (Array.isArray(taskData) ? taskData : []).filter(
              (t: any) => t.task_type === 'content' || t.task_type === 'description_update'
            )
          : []
      )
      if (clientRes.ok) setClients(Array.isArray(clientData) ? clientData : [])
    } catch (err: any) {
      setError(err.message || 'Có lỗi xảy ra')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadAll()
  }, [])

  const clientMap = useMemo(() => {
    const map: Record<string, any> = {}
    clients.forEach((c) => {
      map[c.id] = c
    })
    return map
  }, [clients])

  // Ghép: mỗi task loại "content" đã có bài viết (contents.task_id) thì
  // hiển thị bài viết thật; task nào chưa có bài viết thì hiển thị như
  // 1 "ý tưởng" chưa viết, cho phép bấm "Viết bài bằng AI".
  const combined = useMemo(() => {
    const contentByTaskId: Record<string, any> = {}
    contentItems.forEach((c) => {
      if (c.task_id) contentByTaskId[c.task_id] = c
    })

    const fromTasks = contentTasks.map((t) => {
      const linked = contentByTaskId[t.id]
      if (linked) return linked
      return {
        id: `task-${t.id}`,
        task_id: t.id,
        client_id: t.client_id,
        topic: t.title,
        goal: t.description,
        status: 'idea',
        created_at: t.created_at,
        isTaskOnly: true,
        isDescription: t.task_type === 'description_update',
      }
    })

    // Nội dung ad-hoc (không gắn task) vẫn hiển thị bình thường
    const adhoc = contentItems.filter((c) => !c.task_id)

    return [...fromTasks, ...adhoc].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
  }, [contentItems, contentTasks])

  const pending = combined.filter((c) => filter === 'all' || c.status === filter)

  async function handleWriteContent(item: any) {
    const client = clientMap[item.client_id]
    if (!client) {
      showToast('Không tìm thấy thông tin khách hàng cho ý tưởng này')
      return
    }
    setWritingId(item.id)
    try {
      const res = await fetch('/api/content', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          task_id: item.task_id,
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

      showToast('Đã viết bài bằng AI, sẵn sàng để duyệt')
      await loadAll()
      router.push(`/contents/${data.content.id}`)
    } catch (err: any) {
      showToast(err.message || 'Có lỗi xảy ra')
    } finally {
      setWritingId(null)
    }
  }

  return (
    <>
      <div className="approval-summary">
        <div>
          <p className="overline">Nội dung thật từ hệ thống</p>
          <h2>{loading ? 'Đang tải...' : `${pending.length} bài viết ${filter === 'waiting_approval' ? 'đang chờ duyệt' : ''}`}</h2>
          <p>Danh sách bài viết đã được AI tạo và lưu trong database.</p>
        </div>
      </div>

      <Card>
        <div className="approval-tabs">
          <button className={filter === 'idea' ? 'active' : ''} onClick={() => setFilter('idea')}>
            Ý tưởng
          </button>
          <button className={filter === 'waiting_approval' ? 'active' : ''} onClick={() => setFilter('waiting_approval')}>
            Chờ duyệt
          </button>
          <button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>
            Tất cả
          </button>
          <button className={filter === 'approved' ? 'active' : ''} onClick={() => setFilter('approved')}>
            Đã duyệt
          </button>
        </div>

        {loading && <div style={{ padding: 40, textAlign: 'center', color: '#6b7280' }}>Đang tải danh sách bài viết...</div>}

        {error && <div style={{ padding: 20, color: '#b91c1c' }}>{error}</div>}

        {!loading && !error && pending.length === 0 && (
          <div style={{ padding: 40, textAlign: 'center', color: '#6b7280' }}>
            {filter === 'idea'
              ? 'Chưa có ý tưởng nào. Vào trang Lộ trình của một khách hàng và bấm "Sinh lịch việc".'
              : 'Chưa có bài viết nào ở trạng thái này.'}
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
                  <tr key={c.id} onClick={() => !c.isTaskOnly && router.push(`/contents/${c.id}`)}>
                    <td>
                      <strong>{c.topic || 'Không có tiêu đề'}</strong>
                      {c.isDescription && <span className="type-label" style={{ marginLeft: 8 }}>Mô tả hồ sơ</span>}
                      {c.goal && <small>{c.goal}</small>}
                    </td>
                    <td className="muted-cell">{clientMap[c.client_id]?.name || '—'}</td>
                    <td>
                      <Badge status={c.status || 'drafted'} />
                    </td>
                    <td className="muted-cell">{c.created_at ? new Date(c.created_at).toLocaleDateString('vi-VN') : '—'}</td>
                    <td>
                      {c.isTaskOnly ? (
                        <button
                          className="secondary-button"
                          disabled={writingId === c.id}
                          onClick={(e) => {
                            e.stopPropagation()
                            handleWriteContent(c)
                          }}
                        >
                          {writingId === c.id ? (
                            <>
                              <Loader2 size={14} className="animate-spin" />
                              Đang viết...
                            </>
                          ) : (
                            <>
                              <Sparkles size={14} />
                              {c.isDescription ? 'Viết mô tả bằng AI' : 'Viết bài bằng AI'}
                            </>
                          )}
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
