'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Activity, ArrowUpRight, BarChart3, CalendarDays, Check, ClipboardCheck, FileText, Sparkles, Target, Users } from 'lucide-react'
import { Badge, Card, Metric, Step } from '@/components/dashboard/shared'

export default function DashboardPage() {
  const router = useRouter()
  const [clientsData, setClientsData] = useState<any[]>([])
  const [contentsData, setContentsData] = useState<any[]>([])
  const [plansData, setPlansData] = useState<any[]>([])
  const [auditsData, setAuditsData] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      try {
        const [c, ct, p, a] = await Promise.all([
          fetch('/api/clients').then((r) => r.json()),
          fetch('/api/content').then((r) => r.json()),
          fetch('/api/plan').then((r) => r.json()),
          fetch('/api/audit').then((r) => r.json()),
        ])
        setClientsData(Array.isArray(c) ? c : [])
        setContentsData(Array.isArray(ct) ? ct : [])
        setPlansData(Array.isArray(p) ? p : [])
        setAuditsData(Array.isArray(a) ? a : [])
      } catch {
        // Dashboard không chặn app nếu 1 API lỗi — chỉ hiện số 0
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const totalClients = clientsData.length
  const clientsWithPlan = new Set(plansData.map((p) => p.client_id)).size
  const waitingApproval = contentsData.filter((c) => c.status === 'waiting_approval').length

  const latestAuditByClient: Record<string, string> = {}
  auditsData.forEach((a) => {
    if (!latestAuditByClient[a.client_id]) latestAuditByClient[a.client_id] = a.created_at
  })
  const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000
  const needsAudit = clientsData.filter((c) => {
    const last = latestAuditByClient[c.id]
    if (!last) return true
    return Date.now() - new Date(last).getTime() > THIRTY_DAYS
  }).length

  const recentClients = [...clientsData]
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 3)

  const clientMap: Record<string, any> = {}
  clientsData.forEach((c) => {
    clientMap[c.id] = c
  })

  const recentWaitingContent = contentsData.filter((c) => c.status === 'waiting_approval').slice(0, 3)

  return (
    <>
      <div className="metrics-grid">
        <Metric icon={Users} label="Tổng khách hàng" value={loading ? '—' : String(totalClients)} note="Trong hệ thống" />
        <Metric
          icon={Activity}
          label="Đang chạy lộ trình"
          value={loading ? '—' : String(clientsWithPlan)}
          note={loading || totalClients === 0 ? '—' : `${Math.round((clientsWithPlan / totalClients) * 100)}% tổng khách hàng`}
          tone="green"
        />
        <Metric icon={FileText} label="Bài viết chờ duyệt" value={loading ? '—' : String(waitingApproval)} note="Cần xử lý" tone="orange" />
        <Metric icon={CalendarDays} label="Cần audit lại" value={loading ? '—' : String(needsAudit)} note="Chưa audit hoặc > 30 ngày" tone="red" />
      </div>

      <div className="grid-2">
        <Card>
          <div className="section-head">
            <div>
              <h2>Khách hàng gần đây</h2>
              <p>Thêm mới gần nhất</p>
            </div>
            <button className="text-button" onClick={() => router.push('/clients')}>
              Xem tất cả <ArrowUpRight size={15} />
            </button>
          </div>
          <div className="client-list">
            {!loading && recentClients.length === 0 && (
              <div style={{ padding: 24, textAlign: 'center', color: '#6b7280' }}>
                Chưa có khách hàng nào.{' '}
                <button className="text-button" onClick={() => router.push('/clients/new')}>
                  Thêm khách hàng đầu tiên
                </button>
              </div>
            )}
            {recentClients.map((c) => (
              <button className="client-row" key={c.id} onClick={() => router.push(`/clients/${c.id}`)}>
                <div className="client-avatar bg-primary">{(c.name || '?').substring(0, 2).toUpperCase()}</div>
                <div className="row-main">
                  <strong>{c.name}</strong>
                  <span>{[c.industry, c.area].filter(Boolean).join(' · ') || 'Chưa có thông tin'}</span>
                </div>
                <ArrowUpRight size={15} />
              </button>
            ))}
          </div>
        </Card>

        <Card>
          <div className="section-head">
            <div>
              <h2>Cần duyệt nội dung</h2>
              <p>Những bài viết cần bạn xem qua</p>
            </div>
            <button className="text-button" onClick={() => router.push('/contents')}>
              Xem tất cả <ArrowUpRight size={15} />
            </button>
          </div>
          <div className="approval-list">
            {!loading && recentWaitingContent.length === 0 && (
              <div style={{ padding: 24, textAlign: 'center', color: '#6b7280' }}>Chưa có bài viết nào chờ duyệt.</div>
            )}
            {recentWaitingContent.map((c) => (
              <button className="approval-row" key={c.id} onClick={() => router.push(`/contents/${c.id}`)}>
                <div className="doc-icon">
                  <FileText size={16} />
                </div>
                <div className="row-main">
                  <strong>{c.topic}</strong>
                  <span>{clientMap[c.client_id]?.name || '—'}</span>
                </div>
                <Badge status={c.status} />
              </button>
            ))}
          </div>
        </Card>
      </div>

      <Card className="workflow-card">
        <div className="section-head">
          <div>
            <h2>Chu kỳ Local SEO</h2>
            <p>Quy trình chuẩn của hệ thống — không gắn với 1 khách hàng cụ thể</p>
          </div>
        </div>
        <div className="workflow">
          <Step icon={ClipboardCheck} label="Audit GBP" />
          <Step icon={Target} label="Lộ trình 30 ngày" />
          <Step icon={Sparkles} label="Sinh nội dung" />
          <Step icon={Check} label="Duyệt & đăng" />
          <Step icon={BarChart3} label="Đo lường & audit lại" />
        </div>
      </Card>
    </>
  )
}
