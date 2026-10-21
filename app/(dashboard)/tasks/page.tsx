'use client'

// Việc cần làm: mỗi việc là một thẻ. Bấm "Xem hướng dẫn" để được chỉ từng bước,
// tick từng bước khi làm (nhớ trên trình duyệt), xong thì bấm "Tôi đã làm xong".
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Bot, Check, ChevronDown, ChevronUp, ExternalLink, FileText, Loader2 } from 'lucide-react'
import { Badge } from '@/components/dashboard/shared'
import { TASK_TYPE_LABEL } from '@/lib/ui-constants'
import { AUTO_POST_ENABLED } from '@/lib/features'
import { useToast } from '@/components/dashboard/toast-context'
import { completionMessage, summarizeProgress } from '@/lib/progress'

// Khớp đúng lib/task-action.ts (server) — chỉ dùng để quyết hiện nút nào,
// không tự ý thêm/bớt loại ở đây để tránh lệch với logic thật phía server.
const AUTO_TASK_TYPES = new Set<string>(AUTO_POST_ENABLED ? ['content', 'description_update'] : [])

// Việc loại này có bài viết đi kèm để duyệt (trang Bài viết).
const CONTENT_TASK_TYPES = new Set<string>(['content', 'description_update'])

const PRIORITY_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 }

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

type Tab = 'pending' | 'done' | 'all'

// Tiến độ từng bước chỉ lưu trên trình duyệt này. Có thể bị chặn (chế độ riêng tư) nên luôn bọc try/catch.
const stepKey = (taskId: string) => `lgos:steps:${taskId}`
function readSteps(taskId: string): number[] {
  try {
    const raw = JSON.parse(localStorage.getItem(stepKey(taskId)) || '[]')
    return Array.isArray(raw) ? raw.filter((n) => Number.isInteger(n)) : []
  } catch {
    return []
  }
}
function writeSteps(taskId: string, steps: number[]) {
  try {
    localStorage.setItem(stepKey(taskId), JSON.stringify(steps))
  } catch {
    // Không lưu được thì thôi, tiến độ vẫn hiện trong phiên này
  }
}

function todayISO() {
  const d = new Date()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

function dueInfo(due?: string | null) {
  if (!due) return null
  const key = String(due).slice(0, 10)
  const late = key < todayISO()
  const label = new Date(`${key}T00:00:00`).toLocaleDateString('vi-VN', { day: 'numeric', month: 'numeric' })
  return { late, label: late ? `Quá hạn từ ${label}` : `Hạn ${label}` }
}

export default function TasksPage() {
  const { showToast } = useToast()
  const [items, setItems] = useState<any[]>([])
  const [clients, setClients] = useState<any[]>([])
  const [contents, setContents] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [clientFilter, setClientFilter] = useState('all')
  const [tab, setTab] = useState<Tab>('pending')
  const [updatingId, setUpdatingId] = useState<string | null>(null)

  // Kết quả thực thi/hướng dẫn theo từng task, hiện ngay trong thẻ của task đó.
  const [executingId, setExecutingId] = useState<string | null>(null)
  const [results, setResults] = useState<Record<string, ExecuteResult>>({})
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [ticks, setTicks] = useState<Record<string, number[]>>({})

  useEffect(() => {
    async function load() {
      try {
        const [taskRes, clientRes, contentRes] = await Promise.all([
          fetch('/api/tasks'),
          fetch('/api/clients'),
          fetch('/api/content'),
        ])
        const taskData = await taskRes.json()
        if (!taskRes.ok) throw new Error(taskData.error || 'Không tải được danh sách việc')
        setItems(Array.isArray(taskData) ? taskData : [])
        if (clientRes.ok) {
          const clientData = await clientRes.json()
          setClients(Array.isArray(clientData) ? clientData : [])
        }
        // Bài viết chỉ để dẫn tới đúng bài cần duyệt, tải lỗi cũng không chặn trang.
        if (contentRes.ok) {
          const contentData = await contentRes.json().catch(() => [])
          setContents(Array.isArray(contentData) ? contentData : [])
        }
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

  const contentByTask = useMemo(() => {
    const map: Record<string, any> = {}
    contents.forEach((c) => {
      if (c.task_id) map[c.task_id] = c
    })
    return map
  }, [contents])

  const inClient = items.filter((t) => clientFilter === 'all' || t.client_id === clientFilter)
  const statusOf = (t: any) => t.status || 'pending'
  const counts = {
    pending: inClient.filter((t) => statusOf(t) === 'pending').length,
    done: inClient.filter((t) => statusOf(t) === 'done').length,
    all: inClient.length,
  }

  const progress = summarizeProgress(inClient)

  const filtered = inClient
    .filter((t) => tab === 'all' || statusOf(t) === tab)
    .sort((a, b) => {
      const da = a.due_date ? String(a.due_date).slice(0, 10) : '9999-12-31'
      const db = b.due_date ? String(b.due_date).slice(0, 10) : '9999-12-31'
      if (da !== db) return da < db ? -1 : 1
      return (PRIORITY_RANK[a.priority] ?? 3) - (PRIORITY_RANK[b.priority] ?? 3)
    })

  // Chỉ việc đầu tiên chưa xong dùng nút nổi bật, các việc còn lại dùng nút phụ để mắt tập trung một chỗ.
  const firstOpenId = filtered.find((t) => t.status !== 'done')?.id

  async function toggleStatus(task: any) {
    const next = task.status === 'done' ? 'pending' : 'done'
    const before = summarizeProgress(inClient)
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
      if (next === 'done') {
        setExpandedId((cur) => (cur === task.id ? null : cur))
        // Câu chúc mừng dùng số thật của khách: xong bao nhiêu việc, vừa qua mốc nào
        showToast(completionMessage(before, summarizeProgress(inClient.map((t) => (t.id === task.id ? data : t)))))
      }
    } catch (err: any) {
      setError(err.message || 'Cập nhật thất bại')
    } finally {
      setUpdatingId(null)
    }
  }

  // "Đăng ngay" cho task tự động hoá được — chỉ dùng khi AUTO_POST_ENABLED = true.
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

  // "Xem hướng dẫn" — gọi cùng endpoint, server trả hướng dẫn (không thực thi gì).
  async function handleShowGuidance(task: any) {
    if (expandedId === task.id) {
      setExpandedId(null)
      return
    }
    setExpandedId(task.id)
    setTicks((prev) => ({ ...prev, [task.id]: readSteps(task.id) }))
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

  function toggleStep(taskId: string, index: number) {
    setTicks((prev) => {
      const current = prev[taskId] || []
      const next = current.includes(index) ? current.filter((n) => n !== index) : [...current, index]
      writeSteps(taskId, next)
      return { ...prev, [taskId]: next }
    })
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: 'pending', label: 'Cần làm' },
    { id: 'done', label: 'Đã xong' },
    { id: 'all', label: 'Tất cả' },
  ]

  const emptyText =
    items.length === 0
      ? 'Chưa có việc nào. Mở một doanh nghiệp, vào Kế hoạch 30 ngày và bấm “Tạo danh sách việc”.'
      : tab === 'pending'
        ? 'Bạn đã làm xong mọi việc. Việc mới sẽ xuất hiện ở đây.'
        : tab === 'done'
          ? 'Chưa có việc nào hoàn thành.'
          : 'Không có việc nào.'

  return (
    <>
      {!loading && progress.total > 0 && (
        <div className="progress-strip">
          <div className="progress-strip-text">
            <strong>
              Đã xong {progress.done}/{progress.total} việc
            </strong>
            <span>
              {progress.nextMilestone
                ? `Còn ${progress.nextMilestone.remaining} việc nữa là đạt ${progress.nextMilestone.target}%.`
                : 'Bạn đã hoàn thành toàn bộ kế hoạch.'}
            </span>
            {progress.doneThisWeek ? <span>Tuần này bạn đã xong {progress.doneThisWeek} việc.</span> : null}
          </div>
          <div
            className="progress"
            role="progressbar"
            aria-label="Tiến độ kế hoạch"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progress.percent}
          >
            <i style={{ width: `${progress.percent}%` }} />
          </div>
          <span className="progress-strip-pct">{progress.percent}%</span>
        </div>
      )}

      <div className="task-filter">
        <div className="seg" role="tablist" aria-label="Lọc việc theo trạng thái">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              className={tab === t.id ? 'active' : ''}
              onClick={() => setTab(t.id)}
            >
              {t.label}
              <span>{counts[t.id]}</span>
            </button>
          ))}
        </div>
        {clients.length > 1 && (
          <select value={clientFilter} onChange={(e) => setClientFilter(e.target.value)} aria-label="Lọc theo doanh nghiệp">
            <option value="all">Tất cả doanh nghiệp</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {error && <div className="alert alert-error" style={{ marginBottom: 16 }}>{error}</div>}

      {loading && (
        <div className="task-list" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <div className="skeleton" key={i} style={{ height: 104, borderRadius: 16 }} />
          ))}
        </div>
      )}

      {!loading && !error && filtered.length === 0 && <div className="panel empty-note">{emptyText}</div>}

      {!loading && filtered.length > 0 && (
        <div className="task-list">
          {filtered.map((t) => {
            const isAuto = AUTO_TASK_TYPES.has(t.task_type)
            const isDone = t.status === 'done'
            const result = results[t.id]
            const isBusy = executingId === t.id
            const isExpanded = expandedId === t.id && !isAuto && !isDone
            const due = isDone ? null : dueInfo(t.due_date)
            const linkedContent = CONTENT_TASK_TYPES.has(t.task_type) ? contentByTask[t.id] : null
            const steps = result?.steps || []
            const ticked = (ticks[t.id] || []).filter((n) => n < steps.length)
            const panelId = `guide-${t.id}`

            return (
              <article key={t.id} className={`task-card ${isDone ? 'is-done' : ''} ${isExpanded ? 'open' : ''}`}>
                <div className="task-card-head">
                  <button
                    type="button"
                    className="check-box"
                    disabled={updatingId === t.id}
                    onClick={() => toggleStatus(t)}
                    aria-label={isDone ? `Mở lại việc: ${t.title}` : `Đánh dấu đã xong: ${t.title}`}
                    title={isDone ? 'Mở lại việc này' : 'Đánh dấu đã xong'}
                  >
                    {isDone && <Check size={15} strokeWidth={3} />}
                  </button>

                  <div className="task-card-main">
                    <div className="task-card-meta">
                      {clientMap[t.client_id]?.name && <span>{clientMap[t.client_id].name}</span>}
                      <span className="type-label">{TASK_TYPE_LABEL[t.task_type] || t.task_type}</span>
                      {!isDone && t.priority === 'high' && <span className="chip-high">Ưu tiên cao</span>}
                      {due && <span className={`chip-due ${due.late ? 'late' : ''}`}>{due.label}</span>}
                    </div>
                    <h3>{t.title}</h3>
                    {t.description && <p className="task-desc">{t.description}</p>}
                  </div>

                  {!isDone && (
                    <div className="task-card-actions">
                      {isAuto ? (
                        <button className="secondary-button" disabled={isBusy} onClick={() => handleAutoExecute(t)}>
                          {isBusy ? <Loader2 size={16} className="animate-spin" /> : <Bot size={16} />}
                          {isBusy ? 'Đang đăng…' : 'Đăng ngay'}
                        </button>
                      ) : (
                        <button
                          className={isExpanded || t.id !== firstOpenId ? 'secondary-button' : 'primary-button'}
                          onClick={() => handleShowGuidance(t)}
                          aria-expanded={isExpanded}
                          aria-controls={panelId}
                        >
                          {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                          {isExpanded ? 'Thu gọn' : 'Xem hướng dẫn'}
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {/* Kết quả "Đăng ngay": thành công / cần kết nối Google / lỗi (chỉ khi bật đăng tự động) */}
                {result && isAuto && (result.error || result.actionType) && (
                  <div className="task-note">
                    {result.executed && <span style={{ color: 'var(--success)' }}>Đã đăng lên Google Maps thành công.</span>}
                    {result.actionType === 'needs_connection' && (
                      <span style={{ color: 'var(--warning)', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                        Chưa kết nối Google Business Profile cho doanh nghiệp này.
                        <a className="secondary-button" href={`/api/google-connect/start?client_id=${t.client_id}`}>
                          Kết nối ngay <ExternalLink size={14} />
                        </a>
                      </span>
                    )}
                    {result.error && !result.actionType && <span style={{ color: 'var(--danger)' }}>{result.error}</span>}
                  </div>
                )}

                {/* Hướng dẫn từng bước — mở khi bấm "Xem hướng dẫn" */}
                {isExpanded && (
                  <div className="guide-panel" id={panelId}>
                    {isBusy && !result?.steps ? (
                      <p className="guide-why" style={{ color: 'var(--muted-foreground)' }}>Đang tải hướng dẫn…</p>
                    ) : result?.error ? (
                      <p className="guide-why" style={{ color: 'var(--danger)' }}>{result.error}</p>
                    ) : (
                      <>
                        {result?.whyManual && (
                          <p className="guide-why">
                            <b>Lưu ý:</b> {result.whyManual}
                          </p>
                        )}

                        {steps.length > 0 && (
                          <>
                            <div className="step-progress">
                              <span>
                                Đã làm {ticked.length}/{steps.length} bước
                              </span>
                              <div className="progress" aria-hidden="true">
                                <i style={{ width: `${(ticked.length / steps.length) * 100}%` }} />
                              </div>
                            </div>
                            <ol className="guide-steps">
                              {steps.map((s, i) => {
                                const on = ticked.includes(i)
                                return (
                                  <li key={i}>
                                    <button
                                      type="button"
                                      className={`step-toggle ${on ? 'done' : ''}`}
                                      aria-pressed={on}
                                      onClick={() => toggleStep(t.id, i)}
                                    >
                                      <span>{s}</span>
                                    </button>
                                  </li>
                                )
                              })}
                            </ol>
                          </>
                        )}

                        <div className="guide-actions">
                          {linkedContent && (
                            <Link href={`/contents/${linkedContent.id}`} className="secondary-button">
                              <FileText size={18} /> Mở bài để duyệt
                              <Badge status={linkedContent.status} />
                            </Link>
                          )}
                          <button className="primary-button" disabled={updatingId === t.id} onClick={() => toggleStatus(t)}>
                            <Check size={18} /> Tôi đã làm xong
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </article>
            )
          })}
        </div>
      )}
    </>
  )
}
