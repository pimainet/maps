'use client'

import { useState } from 'react'

export default function TestPage() {
  const [log, setLog] = useState('Chưa chạy gì...')
  const [clientId, setClientId] = useState('')

  async function safeParse(res: Response) {
    const text = await res.text()
    try {
      return {
        ok: res.ok,
        status: res.status,
        data: text ? JSON.parse(text) : null,
        raw: text,
      }
    } catch {
      return {
        ok: res.ok,
        status: res.status,
        data: null,
        raw: text,
      }
    }
  }

  async function createClient() {
    try {
      setLog('Đang tạo khách hàng...')
      const res = await fetch('/api/clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Nha Khoa Tâm An',
          industry: 'Nha khoa',
          area: 'Quận 3, TP.HCM',
          brand_voice: 'chuyên nghiệp, gần gũi',
          gbp_link: 'https://maps.google.com/',
        }),
      })

      const result = await safeParse(res)
      if (result.data?.id) setClientId(result.data.id)
      setLog(JSON.stringify(result, null, 2))
    } catch (error: any) {
      setLog(`Lỗi frontend: ${error.message}`)
    }
  }

  async function runAudit() {
    try {
      if (!clientId) {
        setLog('Chưa có client_id. Hãy tạo khách hàng trước.')
        return
      }

      setLog('Đang chạy Audit...')
      const res = await fetch('/api/audit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: clientId,
          business_name: 'Nha Khoa Tâm An',
          industry: 'Nha khoa',
          area: 'Quận 3, TP.HCM',
          gbp_link: 'https://maps.google.com/',
          description: 'Phòng khám nha khoa tại Quận 3',
          primary_category: 'Nha khoa',
          additional_categories: '',
          review_count: '45',
          rating: '4.8',
          recent_posts: 'Có 1 bài đăng cách đây 2 tuần',
          photos_status: 'Có ảnh nhưng chưa nhiều',
          additional_info: '',
        }),
      })

      const result = await safeParse(res)
      setLog(JSON.stringify(result, null, 2))
    } catch (error: any) {
      setLog(`Lỗi frontend: ${error.message}`)
    }
  }

  async function runContent() {
    try {
      if (!clientId) {
        setLog('Chưa có client_id. Hãy tạo khách hàng trước.')
        return
      }

      setLog('Đang viết bài...')
      const res = await fetch('/api/content', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: clientId,
          business_name: 'Nha Khoa Tâm An',
          industry: 'Nha khoa',
          area: 'Quận 3, TP.HCM',
          topic: '5 dấu hiệu cần lấy cao răng định kỳ',
          goal: 'Tăng lượt gọi',
          brand_voice: 'chuyên nghiệp, gần gũi',
        }),
      })

      const result = await safeParse(res)
      setLog(JSON.stringify(result, null, 2))
    } catch (error: any) {
      setLog(`Lỗi frontend: ${error.message}`)
    }
  }

  return (
    <div style={{ padding: 24, maxWidth: 900, margin: '0 auto' }}>
      <h1>Trang Test Local Growth OS</h1>
      <p>Bấm lần lượt từ trên xuống.</p>

      <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
        <button onClick={createClient}>1. Tạo khách hàng</button>
        <button onClick={runAudit}>2. Chạy Audit</button>
        <button onClick={runContent}>3. Viết bài</button>
      </div>

      <p>
        <b>client_id hiện tại:</b> {clientId || 'Chưa có'}
      </p>

      <pre
        style={{
          whiteSpace: 'pre-wrap',
          background: '#f5f5f5',
          padding: 16,
          borderRadius: 8,
          minHeight: 300,
        }}
      >
        {log}
      </pre>
    </div>
  )
}