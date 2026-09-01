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
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '32px 20px' }}>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 28,
          gap: 16,
          flexWrap: 'wrap',
        }}
      >
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 700, margin: 0, color: '#111827' }}>
            Danh sách khách hàng
          </h1>
          <p style={{ color: '#6b7280', margin: '6px 0 0', fontSize: 14 }}>
            Các doanh nghiệp đang vận hành Local SEO
          </p>
        </div>

        <Link
          href="/clients/new"
          style={{
            background: '#2563eb',
            color: 'white',
            padding: '10px 18px',
            borderRadius: 8,
            textDecoration: 'none',
            fontWeight: 600,
            fontSize: 14,
            whiteSpace: 'nowrap',
          }}
        >
          + Thêm khách hàng
        </Link>
      </div>

      {/* Loading */}
      {loading && (
        <div style={{ textAlign: 'center', padding: 40, color: '#6b7280' }}>
          Đang tải danh sách...
        </div>
      )}

      {/* Error */}
      {error && (
        <div
          style={{
            color: '#b91c1c',
            background: '#fef2f2',
            border: '1px solid #fecaca',
            padding: 14,
            borderRadius: 10,
            marginBottom: 20,
            fontSize: 14,
          }}
        >
          {error}
        </div>
      )}

      {/* Empty */}
      {!loading && !error && clients.length === 0 && (
        <div
          style={{
            padding: '48px 24px',
            textAlign: 'center',
            background: '#f9fafb',
            borderRadius: 12,
            border: '1px dashed #d1d5db',
          }}
        >
          <p style={{ margin: '0 0 12px', color: '#6b7280' }}>Chưa có khách hàng nào.</p>
          <Link
            href="/clients/new"
            style={{ color: '#2563eb', fontWeight: 600, textDecoration: 'none' }}
          >
            Thêm khách hàng đầu tiên →
          </Link>
        </div>
      )}

      {/* List */}
      {!loading && clients.length > 0 && (
        <div style={{ display: 'grid', gap: 12 }}>
          {clients.map((client) => (
            <Link
              key={client.id}
              href={`/clients/${client.id}`}
              style={{
                display: 'block',
                padding: '18px 20px',
                border: '1px solid #e5e7eb',
                borderRadius: 12,
                textDecoration: 'none',
                color: 'inherit',
                background: 'white',
                transition: 'border-color 0.15s, box-shadow 0.15s',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = '#93c5fd'
                e.currentTarget.style.boxShadow = '0 4px 12px rgba(37, 99, 235, 0.08)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = '#e5e7eb'
                e.currentTarget.style.boxShadow = 'none'
              }}
            >
              <div
                style={{
                  fontWeight: 600,
                  fontSize: 16,
                  color: '#111827',
                  marginBottom: 6,
                }}
              >
                {client.name}
              </div>

              <div style={{ color: '#6b7280', fontSize: 14, lineHeight: 1.4 }}>
                {[client.industry, client.area].filter(Boolean).join(' · ') ||
                  'Chưa có ngành / khu vực'}
              </div>

              {client.phone && (
                <div
                  style={{
                    color: '#9ca3af',
                    fontSize: 13,
                    marginTop: 6,
                  }}
                >
                  {client.phone}
                </div>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}