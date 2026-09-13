'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { BriefcaseBusiness, Check } from 'lucide-react'
import { Card } from '@/components/dashboard/shared'
import { useToast } from '@/components/dashboard/toast-context'

export default function NewWorkspacePage() {
  const router = useRouter()
  const { showToast } = useToast()
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleCreate() {
    if (!name.trim()) {
      setError('Tên workspace là bắt buộc')
      return
    }
    setError('')
    setLoading(true)
    try {
      const res = await fetch('/api/workspaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Tạo workspace thất bại')
      showToast('Đã tạo workspace mới')
      window.location.href = '/clients/new'
    } catch (err: any) {
      setError(err.message || 'Có lỗi xảy ra')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card className="form-card">
      <div className="form-intro">
        <div className="large-icon">
          <BriefcaseBusiness size={21} />
        </div>
        <div>
          <h2>Tạo workspace mới</h2>
          <p>Workspace là nơi chứa toàn bộ khách hàng, lộ trình và nội dung của một đội nhóm. Bạn sẽ là owner.</p>
        </div>
      </div>

      <label className="field wide">
        <span>
          Tên workspace <em>*</em>
        </span>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ví dụ: Growth Studio" />
      </label>

      {error && <div style={{ color: '#b91c1c', background: '#fef2f2', padding: 12, borderRadius: 8, marginTop: 16 }}>{error}</div>}

      <div className="form-actions">
        <button className="secondary-button" onClick={() => router.push('/workspaces')} disabled={loading}>
          Huỷ
        </button>
        <button className="primary-button" onClick={handleCreate} disabled={loading}>
          {loading ? (
            'Đang tạo...'
          ) : (
            <>
              <Check size={17} /> Tạo workspace
            </>
          )}
        </button>
      </div>
    </Card>
  )
}
