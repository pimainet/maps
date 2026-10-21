'use client'

// Trang chủ viết cho chủ doanh nghiệp: câu hỏi duy nhất cần trả lời là
// "Hôm nay tôi cần làm gì?". Chỉ dùng số liệu thật từ hệ thống, không ước đoán.
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowRight, Check, ChevronRight, Plus } from 'lucide-react'
import { Badge, ProgressRing } from '@/components/dashboard/shared'
import { TASK_TYPE_LABEL } from '@/lib/ui-constants'
import { summarizeProgress } from '@/lib/progress'

const PRIORITY_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 }

function greetingFor(hour: number) {
  if (hour < 11) return 'Chào buổi sáng'
  if (hour < 14) return 'Chào buổi trưa'
  if (hour < 18) return 'Chào buổi chiều'
  return 'Chào buổi tối'
}

// Tên người Việt: tên gọi nằm ở từ cuối ("Nguyễn Minh Hoàng" gọi là "Hoàng").
function givenName(fullName: string) {
  const parts = fullName.trim().split(/\s+/).filter(Boolean)
  return parts[parts.length - 1] || ''
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

function initialsOf(name: string) {
  return (name || '?').substring(0, 2).toUpperCase()
}

export default function HomePage() {
  const router = useRouter()
  const [userName, setUserName] = useState('')
  const [clients, setClients] = useState<any[]>([])
  const [contents, setContents] = useState<any[]>([])
  const [tasks, setTasks] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [hour, setHour] = useState<number | null>(null)

  useEffect(() => {
    setHour(new Date().getHours())
    async function load() {
      const safe = (p: Promise<Response>) =>
        p.then((r) => (r.ok ? r.json() : null)).catch(() => null)
      const [me, c, ct, t] = await Promise.all([
        safe(fetch('/api/me')),
        safe(fetch('/api/clients')),
        safe(fetch('/api/content')),
        safe(fetch('/api/tasks')),
      ])
      setUserName(me?.profile?.full_name || '')
      setClients(Array.isArray(c) ? c : [])
      setContents(Array.isArray(ct) ? ct : [])
      setTasks(Array.isArray(t) ? t : [])
      setLoading(false)
    }
    load()
  }, [])

  const clientMap: Record<string, any> = {}
  clients.forEach((c) => {
    clientMap[c.id] = c
  })

  const pendingTasks = tasks.filter((t) => (t.status || 'pending') === 'pending')
  const doneCount = tasks.filter((t) => t.status === 'done').length
  const countedTotal = tasks.filter((t) => t.status !== 'skipped').length
  const percent = countedTotal ? Math.round((doneCount / countedTotal) * 100) : 0
  const prog = summarizeProgress(tasks)

  const queue = [...pendingTasks].sort((a, b) => {
    const da = a.due_date ? String(a.due_date).slice(0, 10) : '9999-12-31'
    const db = b.due_date ? String(b.due_date).slice(0, 10) : '9999-12-31'
    if (da !== db) return da < db ? -1 : 1
    return (PRIORITY_RANK[a.priority] ?? 3) - (PRIORITY_RANK[b.priority] ?? 3)
  })
  const next = queue[0]
  const upcoming = queue.slice(1, 5)

  const waiting = contents.filter((c) => c.status === 'waiting_approval')
  const recentClients = [...clients]
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 3)

  const first = givenName(userName)
  const hello = hour === null ? 'Xin chào' : greetingFor(hour)

  let sub = ''
  if (loading) sub = 'Đang tải việc của bạn…'
  else if (clients.length === 0) sub = 'Hãy thêm doanh nghiệp đầu tiên để bắt đầu.'
  else if (pendingTasks.length > 0) {
    sub = `Bạn có ${pendingTasks.length} việc đang chờ${waiting.length > 0 ? ` và ${waiting.length} bài cần duyệt` : ''}. Bắt đầu với việc này.`
  } else if (waiting.length > 0) sub = `Bạn có ${waiting.length} bài đang chờ duyệt.`
  else if (tasks.length > 0) sub = 'Bạn đã làm xong mọi việc. Việc mới sẽ xuất hiện ở đây.'
  else sub = 'Chưa có việc nào. Tạo kế hoạch 30 ngày để có danh sách việc đầu tiên.'

  const nextDue = next ? dueInfo(next.due_date) : null

  return (
    <>
      <header className="home-head">
        <h1 className="greeting">
          {hello}
          {first ? `, ${first}` : ''}.
        </h1>
        <p className="greeting-sub">{sub}</p>
      </header>

      <div className="home-grid">
        <div>
          {/* Khối nổi bật: việc tiếp theo */}
          {loading ? (
            <div className="skeleton" style={{ height: 280, borderRadius: 24 }} aria-hidden="true" />
          ) : clients.length === 0 ? (
            <section className="focus-card">
              <div className="empty-invite">
                <h2 className="focus-title">Bắt đầu với doanh nghiệp của bạn</h2>
                <p className="focus-desc">Nhập tên và khu vực. Phần còn lại là kế hoạch, bài viết và danh sách việc từng bước.</p>
                <Link href="/clients/new" className="primary-button">
                  <Plus size={18} /> Thêm doanh nghiệp
                </Link>
              </div>
            </section>
          ) : next ? (
            <section className="focus-card" aria-label="Việc tiếp theo">
              <div className="focus-biz">
                <div className="client-avatar bg-primary">{initialsOf(clientMap[next.client_id]?.name)}</div>
                <span>{clientMap[next.client_id]?.name || 'Doanh nghiệp của bạn'}</span>
              </div>
              <h2 className="focus-title">{next.title}</h2>
              {next.description && <p className="focus-desc">{next.description}</p>}
              <div className="focus-foot">
                <button className="primary-button" onClick={() => router.push('/tasks')}>
                  Bắt đầu làm <ArrowRight size={18} />
                </button>
                <div className="focus-meta">
                  <span className="type-label">{TASK_TYPE_LABEL[next.task_type] || 'Việc cần làm'}</span>
                  {nextDue && <span className={`chip-due ${nextDue.late ? 'late' : ''}`}>{nextDue.label}</span>}
                </div>
              </div>
            </section>
          ) : tasks.length > 0 ? (
            <section className="focus-card is-done">
              <div className="done-mark">
                <Check size={24} />
              </div>
              <h2 className="focus-title">Bạn đã làm xong mọi việc.</h2>
              <p className="focus-desc">Mỗi việc hoàn thành là một bước để khách tìm thấy bạn dễ hơn. Việc mới sẽ xuất hiện ở đây khi có.</p>
              <div className="focus-foot">
                <Link href="/clients" className="secondary-button">
                  Xem doanh nghiệp
                </Link>
              </div>
            </section>
          ) : (
            <section className="focus-card">
              <div className="empty-invite">
                <h2 className="focus-title">Tạo kế hoạch 30 ngày đầu tiên</h2>
                <p className="focus-desc">Kế hoạch chia nhỏ thành từng việc cụ thể, mỗi việc có hướng dẫn từng bước để bạn làm theo.</p>
                <Link href={`/clients/${recentClients[0]?.id}/plan`} className="primary-button">
                  Tạo kế hoạch <ArrowRight size={18} />
                </Link>
              </div>
            </section>
          )}

          {!loading && upcoming.length > 0 && (
            <section className="queue" aria-label="Các việc tiếp theo">
              <h2>Sau đó</h2>
              <div>
                {upcoming.map((t) => {
                  const due = dueInfo(t.due_date)
                  return (
                    <button className="queue-row" key={t.id} onClick={() => router.push('/tasks')}>
                      <span className={`queue-dot ${t.priority === 'high' ? 'high' : ''}`} aria-hidden="true" />
                      <span className="row-main">
                        <strong>{t.title}</strong>
                        <span>{clientMap[t.client_id]?.name || TASK_TYPE_LABEL[t.task_type] || ''}</span>
                      </span>
                      {due && <span className={`chip-due ${due.late ? 'late' : ''}`}>{due.label}</span>}
                      <ChevronRight size={18} style={{ color: 'var(--faint)' }} />
                    </button>
                  )
                })}
              </div>
              {pendingTasks.length > 5 && (
                <div className="rail-more">
                  <Link href="/tasks" className="text-button">
                    Xem cả {pendingTasks.length} việc <ChevronRight size={16} />
                  </Link>
                </div>
              )}
            </section>
          )}
        </div>

        {/* Cột phụ: tiến độ, bài chờ duyệt, doanh nghiệp */}
        <aside className="rail" aria-label="Tóm tắt">
          <section>
            <h2>Tiến độ kế hoạch</h2>
            {loading ? (
              <div className="skeleton" style={{ height: 112, marginTop: 14 }} aria-hidden="true" />
            ) : countedTotal === 0 ? (
              <p className="rail-sub" style={{ margin: '8px 0 0' }}>
                Chưa có việc nào trong kế hoạch.
              </p>
            ) : (
              <>
                <div className="ring-wrap" style={{ marginTop: 16 }}>
                  <ProgressRing percent={percent} />
                  <div className="ring-text">
                    <strong>
                      {doneCount} trong {countedTotal} việc
                    </strong>
                    <span>{percent === 100 ? 'Đã hoàn thành' : 'đã xong'}</span>
                  </div>
                </div>
                <div className="rail-progress">
                  <p>
                    {prog.nextMilestone ? (
                      <>
                        Còn <strong>{prog.nextMilestone.remaining} việc</strong> nữa là đạt {prog.nextMilestone.target}%.
                      </>
                    ) : (
                      'Bạn đã hoàn thành toàn bộ kế hoạch.'
                    )}
                  </p>
                  {prog.doneThisWeek ? (
                    <p>
                      Tuần này bạn đã xong <strong>{prog.doneThisWeek} việc</strong>.
                    </p>
                  ) : null}
                </div>
              </>
            )}
          </section>

          <section>
            <h2>Bài chờ bạn duyệt</h2>
            {loading ? (
              <div className="skeleton" style={{ height: 60, marginTop: 14 }} aria-hidden="true" />
            ) : waiting.length === 0 ? (
              <p className="rail-sub" style={{ margin: '8px 0 0' }}>
                Không có bài nào đang chờ.
              </p>
            ) : (
              <>
                <p className="rail-sub">{waiting.length} bài cần bạn xem qua trước khi đăng.</p>
                {waiting.slice(0, 3).map((c) => (
                  <button className="rail-row" key={c.id} onClick={() => router.push(`/contents/${c.id}`)}>
                    <span className="row-main">
                      <strong>{c.topic || 'Bài chưa có tiêu đề'}</strong>
                      <span>{clientMap[c.client_id]?.name || ''}</span>
                    </span>
                    <Badge status={c.status} />
                  </button>
                ))}
                <div className="rail-more">
                  <Link href="/contents" className="text-button">
                    Xem tất cả bài <ChevronRight size={16} />
                  </Link>
                </div>
              </>
            )}
          </section>

          <section>
            <h2>Doanh nghiệp của bạn</h2>
            {loading ? (
              <div className="skeleton" style={{ height: 60, marginTop: 14 }} aria-hidden="true" />
            ) : recentClients.length === 0 ? (
              <p className="rail-sub" style={{ margin: '8px 0 0' }}>
                Chưa có doanh nghiệp nào.
              </p>
            ) : (
              <div style={{ marginTop: 8 }}>
                {recentClients.map((c) => (
                  <button className="rail-row" key={c.id} onClick={() => router.push(`/clients/${c.id}`)}>
                    <div className="client-avatar small bg-primary">{initialsOf(c.name)}</div>
                    <span className="row-main">
                      <strong>{c.name}</strong>
                      <span>{[c.industry, c.area].filter(Boolean).join(', ') || 'Chưa có thông tin'}</span>
                    </span>
                    <ChevronRight size={18} style={{ color: 'var(--faint)' }} />
                  </button>
                ))}
                <div className="rail-more">
                  <Link href="/clients" className="text-button">
                    Xem tất cả <ChevronRight size={16} />
                  </Link>
                </div>
              </div>
            )}
          </section>
        </aside>
      </div>
    </>
  )
}
