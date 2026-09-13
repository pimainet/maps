'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowUpRight, Plus } from 'lucide-react'
import { Badge, Card } from '@/components/dashboard/shared'
import { useToast } from '@/components/dashboard/toast-context'

export default function WorkspacesPage() {
  const router = useRouter()
  const { showToast } = useToast()
  const [items, setItems] = useState<any[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [switching, setSwitching] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    try {
      const [wsRes, activeRes] = await Promise.all([fetch('/api/workspaces'), fetch('/api/workspaces/active')])
      const wsData = await wsRes.json()
      const activeData = await activeRes.json()
      setItems(Array.isArray(wsData) ? wsData : [])
      setActiveId(activeData?.activeWorkspaceId || null)
    } catch {
      // im lặng — trang vẫn hiện được danh sách rỗng
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  async function handleSwitch(id: string) {
    setSwitching(id)
    try {
      const res = await fetch('/api/workspaces/active', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspace_id: id }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Chuyển workspace thất bại')
      }
      showToast('Đã chuyển workspace')
      window.location.href = '/'
    } catch (err: any) {
      showToast(err.message || 'Có lỗi xảy ra')
    } finally {
      setSwitching(null)
    }
  }

  return (
    <Card>
      <div className="section-head">
        <div>
          <h2>Workspace của bạn</h2>
          <p>Bấm để chuyển sang làm việc trong workspace khác.</p>
        </div>
        <button className="primary-button" onClick={() => router.push('/workspaces/new')}>
          <Plus size={16} /> Tạo workspace mới
        </button>
      </div>

      {loading && <div style={{ padding: 40, textAlign: 'center', color: '#6b7280' }}>Đang tải...</div>}

      {!loading && items.length === 0 && (
        <div style={{ padding: 40, textAlign: 'center', color: '#6b7280' }}>
          Bạn chưa thuộc workspace nào.{' '}
          <button className="text-button" onClick={() => router.push('/workspaces/new')}>
            Tạo workspace đầu tiên
          </button>
        </div>
      )}

      <div className="client-list">
        {items.map((w) => (
          <button className="client-row" key={w.id} disabled={switching === w.id} onClick={() => w.id !== activeId && handleSwitch(w.id)}>
            <div className="client-avatar bg-primary">{(w.name || '?').substring(0, 2).toUpperCase()}</div>
            <div className="row-main">
              <strong>{w.name}</strong>
              <span>
                Vai trò của bạn: {w.role} · Gói {w.plan}
              </span>
            </div>
            {w.id === activeId ? (
              <Badge status="active" />
            ) : switching === w.id ? (
              <span className="muted-cell">Đang chuyển...</span>
            ) : (
              <ArrowUpRight size={15} />
            )}
          </button>
        ))}
      </div>
    </Card>
  )
}
