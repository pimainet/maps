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
      setError('Hãy nhập tên cho không gian làm việc')
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
      if (!res.ok) throw new Error(data.error || 'Không tạo được không gian làm việc')
      showToast('Đã tạo không gian làm việc mới')
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
          <h2>Tạo không gian làm việc</h2>
          <p>Đây là nơi chứa doanh nghiệp, kế hoạch và bài viết của bạn và đội ngũ. Bạn sẽ là chủ sở hữu.</p>
        </div>
      </div>

      <label className="field wide">
        <span>
          Tên không gian làm việc <em>*</em>
        </span>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ví dụ: Công ty Tâm An" />
      </label>

      {error && <div style={{ color: 'var(--danger)', background: 'var(--danger-soft)', padding: 12, borderRadius: 8, marginTop: 16 }}>{error}</div>}

      <div className="form-actions">
        <button className="secondary-button" onClick={() => router.push('/workspaces')} disabled={loading}>
          Huỷ
        </button>
        <button className="primary-button" onClick={handleCreate} disabled={loading}>
          {loading ? (
            'Đang tạo…'
          ) : (
            <>
              <Check size={18} /> Tạo không gian
            </>
          )}
        </button>
      </div>
    </Card>
  )
}
