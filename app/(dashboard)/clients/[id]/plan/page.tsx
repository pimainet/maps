'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { ArrowRight, ExternalLink, Loader2, Unplug } from 'lucide-react'
import { Card } from '@/components/dashboard/shared'
import { useToast } from '@/components/dashboard/toast-context'
import { TASK_TYPE_LABEL } from '@/lib/ui-constants'
import { AUTO_POST_ENABLED } from '@/lib/features'

export default function ClientPlanPage() {
  const { showToast } = useToast()
  const params = useParams<{ id: string }>()
  const clientId = params.id
  const router = useRouter()
  const searchParams = useSearchParams()
  const [googleConnected, setGoogleConnected] = useState<boolean | null>(null)
  const [disconnecting, setDisconnecting] = useState(false)

  // Khách quay lại từ /api/google-connect/callback — hiện toast đúng kết quả
  // rồi dọn query param để bấm F5 không hiện lại thông báo cũ.
  useEffect(() => {
    const status = searchParams.get('google_connect')
    if (!status) return
    const message = searchParams.get('message')
    if (status === 'connected') {
      showToast('Đã kết nối Google Business Profile — các việc "Đăng ngay" giờ chạy thật.')
      setGoogleConnected(true)
    } else if (status === 'error') {
      showToast(message || 'Kết nối Google thất bại — thử lại.')
    }
    router.replace(`/clients/${clientId}/plan`)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  async function handleDisconnectGoogle() {
    setDisconnecting(true)
    try {
      const res = await fetch('/api/google-connect/disconnect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: clientId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Ngắt kết nối thất bại')
      setGoogleConnected(false)
      showToast(data.note || 'Đã ngắt kết nối.')
    } catch (err: any) {
      showToast(err.message || 'Có lỗi xảy ra')
    } finally {
      setDisconnecting(false)
    }
  }

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
        if (!found) throw new Error('Không tìm thấy doanh nghiệp này')
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

        if (AUTO_POST_ENABLED) {
          const connRes = await fetch(`/api/google-connect/status?client_id=${clientId}`)
          const connData = await connRes.json()
          if (connRes.ok) setGoogleConnected(Boolean(connData.connected))
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
          throw new Error('Bạn đang có một kế hoạch đang chạy. Chọn “Bắt đầu kế hoạch mới” nếu muốn làm lại từ đầu.')
        }
        throw new Error(data.error || 'Chưa tạo được kế hoạch. Thử lại sau ít phút.')
      }
      setResult(data.plan_result || 'Chưa có nội dung kế hoạch.')
      setSavedPlan(data.plan || null)
      setCycleInfo(data.cycle ? { active_cycle: data.cycle } : null)
      setForceNewCycle(false)
      showToast(data.force_new_cycle ? 'Đã bắt đầu kế hoạch mới' : 'Đã tạo kế hoạch 30 ngày')
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
      if (!res.ok) throw new Error(data.error || 'Chưa tạo được danh sách việc. Thử lại sau ít phút.')
      setTasksCreated(data.items || [])
      const written = data.auto_written || 0
      if (written > 0) {
        showToast(data.message || `Đã tạo ${data.items?.length || 0} việc và soạn sẵn ${written} bài nháp`)
      } else if (data.auto_write_error) {
        setTasksError(`Đã tạo việc nhưng chưa soạn được bài nháp: ${data.auto_write_error}`)
        showToast(data.message || 'Đã tạo việc, bài nháp chưa soạn được')
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
        <div className="empty-note">Đang tải…</div>
      </Card>
    )
  }
  if (!client) {
    return (
      <Card>
        <div className="empty-note error">{error || 'Không tìm thấy doanh nghiệp này'}</div>
      </Card>
    )
  }

  const startedAt = cycleInfo?.active_cycle?.started_at
    ? new Date(cycleInfo.active_cycle.started_at).toLocaleDateString('vi-VN')
    : null

  return (
    <>
      <Card>
        <div className="section-head">
          <div>
            <h2>Tạo kế hoạch 30 ngày</h2>
            <p>
              Cho <strong>{client.name}</strong>
              {client.industry || client.area ? `, ${[client.industry, client.area].filter(Boolean).join(', ')}` : ''}
            </p>
          </div>
          {cycleInfo?.active_cycle && (
            <span className="status-badge status-success">
              <span className="status-dot" />
              {startedAt ? `Đang chạy từ ${startedAt}` : 'Đang chạy'}
            </span>
          )}
        </div>

        {AUTO_POST_ENABLED && (
          <div className={`alert ${googleConnected ? 'alert-ok' : 'alert-warn'}`} style={{ marginBottom: 20 }}>
            {googleConnected === null ? (
              <span>Đang kiểm tra kết nối Google…</span>
            ) : googleConnected ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <span>Đã kết nối Google Business Profile. Các việc “Đăng ngay” ở trang Việc cần làm sẽ chạy thật.</span>
                <button className="icon-button" disabled={disconnecting} onClick={handleDisconnectGoogle} title="Ngắt kết nối">
                  {disconnecting ? <Loader2 size={16} className="animate-spin" /> : <Unplug size={16} />}
                </button>
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                <span>Chưa kết nối Google Business Profile. Kết nối để đăng bài tự động.</span>
                <a className="secondary-button" href={`/api/google-connect/start?client_id=${clientId}`}>
                  Kết nối Google Business Profile <ExternalLink size={14} />
                </a>
              </div>
            )}
          </div>
        )}

        <label className="field">
          <span>Kết quả kiểm tra hồ sơ</span>
          <textarea
            value={auditResult}
            onChange={(e) => setAuditResult(e.target.value)}
            placeholder="Dán kết quả kiểm tra vào đây, hoặc kiểm tra hồ sơ trước."
            rows={5}
          />
        </label>
        <p className="rail-sub" style={{ margin: '10px 0 0' }}>
          {loadingAudit ? (
            'Đang tải kết quả kiểm tra gần nhất…'
          ) : auditRecord ? (
            `Lấy từ lần kiểm tra ngày ${new Date(auditRecord.created_at).toLocaleDateString('vi-VN')}. Bạn có thể chỉnh sửa trước khi tạo kế hoạch.`
          ) : (
            <>
              Chưa có kết quả kiểm tra. Kế hoạch sẽ sát thực tế hơn nếu bạn{' '}
              <Link href={`/clients/${clientId}/audit`} className="text-button">
                kiểm tra hồ sơ trước
              </Link>
              .
            </>
          )}
        </p>

        {cycleInfo && (
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginTop: 20, fontSize: 14.5, lineHeight: 1.6 }}>
            <input type="checkbox" checked={forceNewCycle} onChange={(e) => setForceNewCycle(e.target.checked)} style={{ marginTop: 5 }} />
            <span>
              <strong>Bắt đầu kế hoạch mới.</strong> Kế hoạch đang chạy sẽ được đóng lại. Chỉ chọn khi bạn đã xong việc kỳ trước hoặc muốn đổi hướng.
            </span>
          </label>
        )}

        {cycleInfo?.open_tasks_count != null && (
          <div className="alert alert-warn" style={{ marginTop: 16 }}>
            Kế hoạch hiện tại còn khoảng {cycleInfo.open_tasks_count} việc chưa xong
            {cycleInfo.contents_count != null ? ` và ${cycleInfo.contents_count} bài viết` : ''}.
          </div>
        )}

        {error && <div className="alert alert-error" style={{ marginTop: 16 }}>{error}</div>}

        <div className="plan-actions" style={{ marginTop: 24 }}>
          <button className="primary-button" onClick={handleCreatePlan} disabled={running}>
            {running && <Loader2 size={18} className="animate-spin" />}
            {running ? 'Đang tạo kế hoạch… (khoảng 15–25 giây)' : 'Tạo kế hoạch 30 ngày'}
          </button>
        </div>
      </Card>

      {running && (
        <Card>
          <div className="empty-note">Đang soạn kế hoạch 30 ngày cho bạn…</div>
        </Card>
      )}

      {result && (
        <Card>
          <div className="section-head">
            <div>
              <h2>Kế hoạch của bạn</h2>
              <p>Soạn dựa trên kết quả kiểm tra hồ sơ.</p>
            </div>
          </div>
          <div className="prose">{result}</div>
        </Card>
      )}

      {result && (
        <Card>
          <div className="section-head">
            <div>
              <p className="overline">Bước tiếp theo</p>
              <h2>Biến kế hoạch thành danh sách việc</h2>
              <p>Mỗi việc có hướng dẫn từng bước. Việc đã có sẽ không bị tạo trùng.</p>
            </div>
          </div>

          {tasksError && <div className="alert alert-error" style={{ marginBottom: 16 }}>{tasksError}</div>}

          {tasksCreated && tasksCreated.length > 0 && (
            <div className="client-list" style={{ marginBottom: 20 }}>
              {tasksCreated.map((t: any) => (
                <div className="client-row" key={t.id}>
                  <div className="row-main">
                    <strong>{t.title}</strong>
                    <span>{TASK_TYPE_LABEL[t.task_type] || t.task_type}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
          {tasksCreated && tasksCreated.length === 0 && (
            <div className="alert alert-ok" style={{ marginBottom: 20 }}>
              Không có việc mới. Các việc trong kế hoạch này đã được tạo trước đó.
            </div>
          )}

          <div className="plan-actions">
            {tasksCreated ? (
              <Link href="/tasks" className="primary-button">
                Bắt đầu làm <ArrowRight size={18} />
              </Link>
            ) : (
              <button className="primary-button" onClick={handleGenerateTasks} disabled={generatingTasks}>
                {generatingTasks && <Loader2 size={18} className="animate-spin" />}
                {generatingTasks ? 'Đang tạo danh sách việc… (20–30 giây)' : 'Tạo danh sách việc'}
              </button>
            )}
          </div>
        </Card>
      )}
    </>
  )
}
