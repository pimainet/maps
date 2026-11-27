'use client'

import { useState } from 'react'
import { useParams } from 'next/navigation'
import { ImagePlus } from 'lucide-react'
import { Brand } from '@/components/dashboard/brand'
import { AUTO_POST_ENABLED } from '@/lib/features'

export default function PublicUploadPage() {
  const params = useParams<{ token: string }>()
  const token = params.token
  const [items, setItems] = useState<{ name: string; ok: boolean; message: string }[]>([])
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState('')

  if (!AUTO_POST_ENABLED) {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <Brand className="auth-brand" />
          <p className="auth-sub">Tính năng gửi ảnh đang tắt.</p>
        </div>
      </div>
    )
  }

  async function uploadOne(file: File) {
    const ready = await maybeConvertHeic(file)
    const urlRes = await fetch('/api/photos/upload-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token,
        filename: ready.name,
        content_type: ready.type || 'image/jpeg',
        bytes: ready.size,
      }),
    })
    const urlData = await urlRes.json()
    if (!urlRes.ok) throw new Error(urlData.error || 'Không tạo được chỗ lưu ảnh')

    const put = await fetch(urlData.signedUrl, {
      method: 'PUT',
      headers: { 'Content-Type': ready.type || 'image/jpeg' },
      body: ready,
    })
    if (!put.ok) throw new Error('Tải ảnh lên thất bại')

    const proc = await fetch('/api/photos/process', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ photo_id: urlData.photo_id, token }),
    })
    const procData = await proc.json()
    if (!proc.ok) throw new Error(procData.error || 'Không xử lý được ảnh')
    if (procData.status === 'duplicate') return 'Ảnh trùng với ảnh đã gửi'
    if (procData.status === 'rejected') return procData.reject_reason || 'Ảnh chưa đủ điều kiện'
    return 'Đã nhận'
  }

  async function onPick(files: FileList | null) {
    if (!files || files.length === 0) return
    setBusy(true)
    const list = Array.from(files)
    for (let i = 0; i < list.length; i++) {
      const file = list[i]
      setProgress(`Đang gửi ${i + 1}/${list.length}…`)
      try {
        const message = await uploadOne(file)
        setItems((prev) => [...prev, { name: file.name, ok: true, message }])
      } catch (err: any) {
        setItems((prev) => [...prev, { name: file.name, ok: false, message: err.message || 'Lỗi' }])
      }
    }
    setProgress('')
    setBusy(false)
  }

  return (
    <div className="auth-page">
      <div className="auth-card" style={{ maxWidth: 480, width: '100%' }}>
        <Brand className="auth-brand" />
        <h1 style={{ fontSize: 22, margin: '8px 0 4px' }}>Gửi ảnh cho quán</h1>
        <p className="auth-sub">Chọn một hoặc nhiều ảnh (món, không gian, mặt tiền). Ảnh iPhone HEIC sẽ được đổi sang JPEG.</p>

        <label className="primary-button auth-submit" style={{ cursor: busy ? 'not-allowed' : 'pointer', display: 'flex', justifyContent: 'center', gap: 8 }}>
          <ImagePlus size={18} />
          {busy ? 'Đang gửi…' : 'Chọn ảnh'}
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,image/heic,image/heif,image/*"
            multiple
            hidden
            disabled={busy}
            onChange={(e) => {
              onPick(e.target.files)
              e.target.value = ''
            }}
          />
        </label>
        {progress ? <p className="auth-sub">{progress}</p> : null}

        {items.length > 0 ? (
          <ul style={{ listStyle: 'none', padding: 0, marginTop: 16 }}>
            {items.map((it, i) => (
              <li key={i} className={it.ok ? '' : 'auth-error'} style={{ marginBottom: 8, fontSize: 14 }}>
                <strong>{it.name}</strong> — {it.message}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  )
}

async function maybeConvertHeic(file: File): Promise<File> {
  const type = (file.type || '').toLowerCase()
  const name = file.name.toLowerCase()
  if (!type.includes('heic') && !type.includes('heif') && !name.endsWith('.heic') && !name.endsWith('.heif')) {
    return file
  }
  const heic2any = (await import('heic2any')).default
  const blob = (await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.86 })) as Blob
  return new File([blob], file.name.replace(/\.(heic|heif)$/i, '.jpg'), { type: 'image/jpeg' })
}
