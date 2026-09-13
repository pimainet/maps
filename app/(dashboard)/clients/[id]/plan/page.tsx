'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { Card } from '@/components/dashboard/shared'
import { useToast } from '@/components/dashboard/toast-context'

export default function ClientPlanPage() {
  const { showToast } = useToast()
  const params = useParams<{ id: string }>()
  const clientId = params.id

  const [client, setClient] = useState<any>(null)
  const [loadingClient, setLoadingClient] = useState(true)
  const [running, setRunning] = useState(false)
  const [generatingTasks, setGeneratingTasks] = useState(false)
  const [error, setError] = useState('')
  const [tasksError, setTasksError] = useState('')
  const [result, setResult] = useState<string | null>(null)
  const [auditResult, setAuditResult] = useState('')
  const [auditRecord, setAuditRecord] = useState<any>(null)
  const [loadingAudit, setLoadingAudit] = useState(true)
  const [savedPlan, setSavedPlan] = useState<any>(null)
  const [tasksCreated, setTasksCreated] = useState<any[] | null>(null)
  const [forceNewCycle, setForceNewCycle] = useState(false)
  const [cycleInfo, setCycleInfo] = useState<any>(null)

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('/api/clients')
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Không tải được dữ liệu')
        const found = (Array.isArray(data) ? data : []).find((c: any) => c.id === clientId)
        if (!found) throw new Error('Không tìm thấy khách hàng')
        setClient(found)

        setLoadingAudit(true)
        const auditRes = await fetch(`/api/audit?client_id=${clientId}`)
        const auditData = await auditRes.json()
        if (auditRes.ok && auditData?.audit_result) {
          setAuditRecord(auditData)
          setAuditResult(auditData.audit_result)
        }

        const planRes = await fetch(`/api/plan?client_id=${clientId}`)
        const planData = await planRes.json()
        if (planRes.ok && planData) {
          if (planData.plan_result) {
            setResult(planData.plan_result)
            setSavedPlan(planData)
          }
          if (planData.active_cycle) setCycleInfo({ active_cycle: planData.active_cycle })
        }
      } catch (err: any) {
        setError(err.message || 'Có lỗi xảy ra')
      } finally {
        setLoadingClient(false)
        setLoadingAudit(false)
      }
    }
    load()
  }, [clientId])

  async function handleCreatePlan() {
    if (!client) return
    setError('')
    setRunning(true)
    try {
      const today = new Date()
      const end = new Date(today)
      end.setDate(end.getDate() + 30)
      const res = await fetch('/api/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: client.id,
          audit_id: auditRecord?.id,
          business_name: client.name,
          industry: client.industry || '',
          area: client.area || '',
          audit_result: auditResult || '',
          start_date: today.toISOString().slice(0, 10),
          end_date: end.toISOString().slice(0, 10),
          force_new_cycle: forceNewCycle,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        if (res.status === 409 && data.code === 'ACTIVE_CYCLE_EXISTS') {
          setCycleInfo(data)
          throw new Error(data.error || 'Đang có chu kỳ active. Bật「Mở chu kỳ mới」nếu muốn bắt đầu vòng mới.')
        }
        throw new Error(data.error || 'Tạo lộ trình thất bại')
      }
      setResult(data.plan_result || 'Không có kết quả')
      setSavedPlan(data.plan || null)
      setCycleInfo(data.cycle ? { active_cycle: data.cycle } : null)
      setForceNewCycle(false)
      showToast(data.force_new_cycle ? 'Đã đóng chu kỳ cũ và tạo lộ trình chu kỳ mới' : 'Đã tạo lộ trình 30 ngày (chu kỳ đang mở)')
    } catch (err: any) {
      setError(err.message || 'Có lỗi xảy ra')
    } finally {
      setRunning(false)
    }
  }

  async function handleGenerateTasks() {
    if (!client || !result) return
    setGeneratingTasks(true)
    setTasksError('')
    setTasksCreated(null)
    try {
      const res = await fetch('/api/tasks/generate-from-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: client.id,
          plan_id: savedPlan?.id,
          business_name: client.name,
          industry: client.industry || '',
          area: client.area || '',
          plan_result: result,
          start_date: savedPlan?.start_date || new Date().toISOString().slice(0, 10),
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Sinh danh sách việc thất bại')
      setTasksCreated(data.items || [])
      const written = data.auto_written || 0
      if (written > 0) {
        showToast(data.message || `Đã tạo ${data.items?.length || 0} việc và tự viết ${written} bài`)
      } else if (data.auto_write_error) {
        setTasksError(`Đã tạo việc nhưng tự viết bài lỗi: ${data.auto_write_error}`)
        showToast(data.message || 'Đã tạo việc (tự viết bài thất bại)')
      } else {
        showToast(data.message || `Đã tạo ${data.items?.length || 0} việc`)
      }
    } catch (err: any) {
      setTasksError(err.message || 'Có lỗi xảy ra')
    } finally {
      setGeneratingTasks(false)
    }
  }

  if (loadingClient) {
    return (
      <Card>
        <div style={{ padding: 40, textAlign: 'center', color: '#6b7280' }}>Đang tải...</div>
      </Card>
    )
  }
  if (!client) {
    return (
      <Card>
        <div style={{ padding: 40, textAlign: 'center', color: '#b91c1c' }}>{error || 'Không tìm thấy khách hàng'}</div>
      </Card>
    )
  }

  return (
    <>
      <Card className="plan-summary">
        <div>
          <p className="overline">Lộ trình 30 ngày</p>
          <div className="title-line">
            <h2>Lộ trình tăng trưởng Local SEO</h2>
          </div>
          <p>
            Doanh nghiệp: <strong>{client.name}</strong>
            {client.industry || client.area ? ` · ${[client.industry, client.area].filter(Boolean).join(' · ')}` : ''}
          </p>
          {cycleInfo?.active_cycle && (
            <p style={{ fontSize: 13, color: '#059669', marginTop: 8 }}>
              Đang có chu kỳ active · bắt đầu{' '}
              {cycleInfo.active_cycle.started_at ? new Date(cycleInfo.active_cycle.started_at).toLocaleDateString('vi-VN') : '—'}
            </p>
          )}
        </div>

        <div style={{ marginTop: 16 }}>
          <label className="field">
            <span>
              {loadingAudit
                ? 'Đang tải audit gần nhất...'
                : auditRecord
                  ? `Audit gần nhất (${new Date(auditRecord.created_at).toLocaleDateString('vi-VN')})`
                  : 'Chưa có audit — nên chạy Audit trước'}
            </span>
            <textarea
              value={auditResult}
              onChange={(e) => setAuditResult(e.target.value)}
              placeholder="Dán kết quả audit hoặc chạy Audit trước."
              rows={5}
            />
          </label>
        </div>

        <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginTop: 12, fontSize: 13, color: '#374151' }}>
          <input type="checkbox" checked={forceNewCycle} onChange={(e) => setForceNewCycle(e.target.checked)} style={{ marginTop: 3 }} />
          <span>
            <strong>Mở chu kỳ mới</strong> — đóng chu kỳ 30 ngày đang chạy và bắt đầu vòng mới. Chỉ bật khi đã xong việc kỳ trước hoặc đổi
            chiến lược.
          </span>
        </label>

        {cycleInfo?.open_tasks_count != null && (
          <p style={{ fontSize: 12, color: '#b45309', marginTop: 8 }}>
            Chu kỳ hiện tại còn ~{cycleInfo.open_tasks_count} việc chưa xong
            {cycleInfo.contents_count != null ? `, ${cycleInfo.contents_count} bài trong hệ thống` : ''}.
          </p>
        )}

        {error && <div style={{ color: '#b91c1c', background: '#fef2f2', padding: 12, borderRadius: 8, marginTop: 12 }}>{error}</div>}

        <div className="plan-actions" style={{ marginTop: 16 }}>
          <button className="primary-button" onClick={handleCreatePlan} disabled={running}>
            {running ? 'Đang tạo lộ trình...' : 'Tạo lộ trình 30 ngày'}
          </button>
        </div>
      </Card>

      {running && (
        <Card>
          <div style={{ padding: 40, textAlign: 'center', color: '#6b7280' }}>AI đang xây dựng lộ trình 30 ngày...</div>
        </Card>
      )}

      {result && (
        <Card>
          <div className="section-head">
            <div>
              <h2>Lộ trình đã tạo</h2>
              <p>Kết quả từ AI</p>
            </div>
          </div>
          <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6, fontSize: 14 }}>{result}</div>
        </Card>
      )}

      {result && (
        <Card>
          <div className="section-head">
            <div>
              <h2>Sinh lịch việc từ lộ trình</h2>
              <p>Tạo task (có chống trùng với việc/bài đã có)</p>
            </div>
            <button className="secondary-button" onClick={handleGenerateTasks} disabled={generatingTasks}>
              {generatingTasks ? 'Đang sinh lịch...' : 'Sinh lịch việc'}
            </button>
          </div>
          {tasksError && <div style={{ color: '#b91c1c', background: '#fef2f2', padding: 12, borderRadius: 8 }}>{tasksError}</div>}
          {tasksCreated && tasksCreated.length > 0 && (
            <ul style={{ marginTop: 12, paddingLeft: 18 }}>
              {tasksCreated.map((t: any) => (
                <li key={t.id} style={{ marginBottom: 6 }}>
                  {t.title} <span style={{ color: '#6b7280' }}>({t.task_type})</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </>
  )
}
