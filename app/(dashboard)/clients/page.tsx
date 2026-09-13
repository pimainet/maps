'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { MoreHorizontal, Search } from 'lucide-react'
import { Card } from '@/components/dashboard/shared'

export default function ClientsPage() {
  const router = useRouter()
  const [realClients, setRealClients] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('/api/clients')
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Không tải được danh sách')
        setRealClients(Array.isArray(data) ? data : [])
      } catch (err: any) {
        setError(err.message || 'Có lỗi xảy ra')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const filtered = realClients.filter((c: any) => (c.name || '').toLowerCase().includes(query.toLowerCase()))

  return (
    <Card>
      <div className="toolbar">
        <div className="search-field">
          <Search size={16} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Tìm theo tên doanh nghiệp..." />
        </div>
        <select>
          <option>Tất cả trạng thái</option>
          <option>Đang hoạt động</option>
          <option>Tạm dừng</option>
        </select>
        <button className="secondary-button">
          <MoreHorizontal size={16} /> Bộ lọc khác
        </button>
      </div>

      {loading && <div style={{ padding: 40, textAlign: 'center', color: '#6b7280' }}>Đang tải danh sách khách hàng...</div>}

      {error && (
        <div style={{ padding: 20, color: '#b91c1c', background: '#fef2f2', margin: 16, borderRadius: 8 }}>{error}</div>
      )}

      {!loading && !error && filtered.length === 0 && (
        <div style={{ padding: 40, textAlign: 'center', color: '#6b7280' }}>Chưa có khách hàng nào. Hãy thêm khách hàng mới.</div>
      )}

      {!loading && filtered.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Tên doanh nghiệp</th>
                <th>Ngành / Khu vực</th>
                <th>Số điện thoại</th>
                <th>Người liên hệ</th>
                <th>Cập nhật</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filtered.map((c: any) => (
                <tr key={c.id} onClick={() => router.push(`/clients/${c.id}`)}>
                  <td>
                    <div className="table-client">
                      <div className="client-avatar small bg-primary">{(c.name || '?').substring(0, 2).toUpperCase()}</div>
                      <strong>{c.name}</strong>
                    </div>
                  </td>
                  <td>
                    <span>{c.industry || '—'}</span>
                    <small>{c.area || ''}</small>
                  </td>
                  <td className="muted-cell">{c.phone || '—'}</td>
                  <td className="muted-cell">{c.contact_name || '—'}</td>
                  <td className="muted-cell">{c.created_at ? new Date(c.created_at).toLocaleDateString('vi-VN') : '—'}</td>
                  <td>
                    <button className="icon-button">
                      <MoreHorizontal size={17} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}
