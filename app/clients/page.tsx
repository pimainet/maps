'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

type Client = {
  id: string
  name: string
  industry?: string
  area?: string
  phone?: string
  contact_name?: string
  created_at?: string
}

export default function ClientsPage() {
  const [clients, setClients] = useState<Client[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('/api/clients')
        const data = await res.json()

        if (!res.ok) {
          throw new Error(data.error || 'Không tải được danh sách')
        }

        setClients(Array.isArray(data) ? data : [])
      } catch (err: any) {
        setError(err.message || 'Có lỗi xảy ra')
      } finally {
        setLoading(false)
      }
    }

    load()
  }, [])

  return (
    <div style={{ maxWidth: 960, margin: '0 auto', padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 28, marginBottom: 4 }}>Danh sách khách hàng</h1>
          <p style={{ color: '#666', margin: 0 }}>Các doanh nghiệp đang vận hành Local SEO</p>
        </div>
        <Link
          href="/clients/new"
          style={{
            background: '#2563eb',
            color: 'white',
            padding: '10px 16px',
            borderRadius: 8,
            textDecoration: 'none',
            fontWeight: 600,
          }}
        >
          + Thêm khách hàng
        </Link>
      </div>

      {loading && <p>Đang tải...</p>}

      {error && (
        <div style={{ color: '#b91c1c', background: '#fef2f2', padding: 12, borderRadius: 8, marginBottom: 16 }}>
          {error}
        </div>
      )}

      {!loading && !error && clients.length === 0 && (
        <div style={{ padding: 32, textAlign: 'center', background: '#f9fafb', borderRadius: 12 }}>
          <p style={{ marginBottom: 12 }}>Chưa có khách hàng nào.</p>
          <Link href="/clients/new" style={{ color: '#2563eb', fontWeight: 600 }}>
            Thêm khách hàng đầu tiên →
          </Link>
        </div>
      )}

      {!loading && clients.length > 0 && (
        <div style={{ display: 'grid', gap: 12 }}>
          {clients.map((client) => (
            <Link
              key={client.id}
              href={`/clients/${client.id}`}
              style={{
                display: 'block',
                padding: 16,
                border: '1px solid #e5e7eb',
                borderRadius: 10,
                textDecoration: 'none',
                color: 'inherit',
                background: 'white',
              }}
            >
              <div style={{ fontWeight: 600, fontSize: 16, marginBottom: 4 }}>{client.name}</div>
              <div style={{ color: '#6b7280', fontSize: 14 }}>
                {[client.industry, client.area].filter(Boolean).join(' · ') || 'Chưa có ngành / khu vực'}
              </div>
              {client.phone && (
                <div style={{ color: '#6b7280', fontSize: 13, marginTop: 4 }}>{client.phone}</div>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}