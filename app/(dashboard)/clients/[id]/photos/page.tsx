'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { Copy, ImagePlus, Link2, RefreshCw } from 'lucide-react'
import { Card } from '@/components/dashboard/shared'
import { useToast } from '@/components/dashboard/toast-context'
import { AUTO_POST_ENABLED } from '@/lib/features'

type Photo = {
  id: string
  status: string
  original_filename: string | null
  width: number | null
  height: number | null
  geotagged: boolean
  ai_description: string | null
  quality_score: number | null
  reject_reason: string | null
  used_count: number
  created_at: string
}

const STATUS_LABEL: Record<string, string> = {
  uploaded: 'Đã nhận',
  processing: 'Đang xử lý',
  ready: 'Sẵn sàng',
  reserved: 'Đang giữ chỗ',
  rejected: 'Không dùng',
  duplicate: 'Trùng',
  archived: 'Đã ẩn',
  error: 'Lỗi',
}

export default function ClientPhotosPage() {
  const { showToast } = useToast()
  const params = useParams<{ id: string }>()
  const clientId = params.id

  const [photos, setPhotos] = useState<Photo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [link, setLink] = useState('')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState('')

  const load = useCallback(async () => {
    const res = await fetch(`/api/photos?client_id=${clientId}`)
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || 'Không tải được kho ảnh')
    setPhotos(Array.isArray(data.photos) ? data.photos : [])
  }, [clientId])

  useEffect(() => {
    if (!AUTO_POST_ENABLED) {
      setLoading(false)
      return
    }
    load()
      .catch((err) => setError(err.message || 'Có lỗi xảy ra'))
      .finally(() => setLoading(false))
    fetch('/api/photos/link', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: clientId }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.path) setLink(`${window.location.origin}${data.path}`)
      })
      .catch(() => {})
  }, [clientId, load])

  async function rotateLink() {
    setBusy(true)
    try {
      const res = await fetch('/api/photos/link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: clientId, rotate: true }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Không tạo được link')
      const url = `${window.location.origin}${data.path}`
      setLink(url)
      showToast('Đã tạo link mới (link cũ không còn dùng được)')
    } catch (err: any) {
      showToast(err.message || 'Có lỗi xảy ra')
    } finally {
      setBusy(false)
    }
  }

  async function copyLink() {
    if (!link) return
    try {
      await navigator.clipboard.writeText(link)
      showToast('Đã sao chép link gửi ảnh')
    } catch {
      showToast('Không sao chép được, hãy chọn và copy bằng tay')
    }
  }

  async function uploadOne(file: File) {
    const type = file.type || 'image/jpeg'
    const urlRes = await fetch('/api/photos/upload-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: clientId,
        filename: file.name,
        content_type: type,
        bytes: file.size,
      }),
    })
    const urlData = await urlRes.json()
    if (!urlRes.ok) throw new Error(urlData.error || 'Không tạo được chỗ lưu ảnh')

    const put = await fetch(urlData.signedUrl, {
      method: 'PUT',
      headers: { 'Content-Type': type },
      body: file,
    })
    if (!put.ok) throw new Error('Tải ảnh lên kho thất bại')

    const proc = await fetch('/api/photos/process', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ photo_id: urlData.photo_id }),
    })
    const procData = await proc.json()
    if (!proc.ok) throw new Error(procData.error || 'Không xử lý được ảnh')
    return procData
  }

  async function onPick(files: FileList | null) {
    if (!files || files.length === 0) return
    setBusy(true)
    let ok = 0
    let fail = 0
    const list = Array.from(files)
    for (let i = 0; i < list.length; i++) {
      const file = list[i]
      setProgress(`Đang gửi ảnh ${i + 1}/${list.length}: ${file.name}`)
      try {
        await maybeConvertHeic(file).then(uploadOne)
        ok++
      } catch (err: any) {
        fail++
        showToast(err.message || `Lỗi ảnh ${file.name}`)
      }
    }
    setProgress('')
    setBusy(false)
    try {
      await load()
    } catch {}
    if (ok) showToast(`Đã nhận ${ok} ảnh` + (fail ? `, ${fail} ảnh lỗi` : ''))
  }

  const readyCount = useMemo(() => photos.filter((p) => p.status === 'ready').length, [photos])

  if (!AUTO_POST_ENABLED) {
    return (
      <Card>
        <div className="empty-note">Tính năng kho ảnh đang tắt.</div>
      </Card>
    )
  }

  if (loading) {
    return (
      <Card>
        <div className="empty-note">Đang tải kho ảnh…</div>
      </Card>
    )
  }

  if (error) {
    return (
      <Card>
        <div className="empty-note error">{error}</div>
      </Card>
    )
  }

  return (
    <>
      <Card>
        <div className="section-head">
          <div>
            <h2>Kho ảnh đăng bài</h2>
            <p>
              Gửi ảnh thật của quán (món, không gian, mặt tiền). Hệ thống sẽ chuẩn hoá, gắn vị trí nội bộ và chọn ảnh
              chưa dùng khi đăng. {readyCount} ảnh đang sẵn sàng.
            </p>
          </div>
          <Link href={`/clients/${clientId}`} className="secondary-button">
            Về doanh nghiệp
          </Link>
        </div>

        <div className="hero-actions" style={{ marginTop: 16, flexWrap: 'wrap' }}>
          <label className="primary-button" style={{ cursor: busy ? 'not-allowed' : 'pointer' }}>
            <ImagePlus size={18} />
            {busy ? 'Đang gửi…' : 'Chọn ảnh từ máy'}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
              multiple
              hidden
              disabled={busy}
              onChange={(e) => {
                onPick(e.target.files)
                e.target.value = ''
              }}
            />
          </label>
        </div>
        {progress ? <p className="empty-note">{progress}</p> : null}

        <div style={{ marginTop: 20 }}>
          <h3 style={{ fontSize: 15, marginBottom: 8 }}>Link gửi ảnh (điện thoại, không cần đăng nhập)</h3>
          <p className="empty-note" style={{ marginBottom: 8 }}>
            Gửi link này cho nhân viên hoặc thợ chụp. Họ chỉ tải ảnh lên được cho doanh nghiệp này.
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <input readOnly value={link} style={{ flex: 1, minWidth: 200, padding: "8px 10px", borderRadius: 8, border: "1px solid #d1d5db" }} />
            <button type="button" className="secondary-button" onClick={copyLink} disabled={!link}>
              <Copy size={16} /> Sao chép
            </button>
            <button type="button" className="secondary-button" onClick={rotateLink} disabled={busy}>
              <RefreshCw size={16} /> <Link2 size={16} /> Đổi link
            </button>
          </div>
        </div>
      </Card>

      <Card>
        <h2>Ảnh đã gửi</h2>
        {photos.length === 0 ? (
          <div className="empty-note">Chưa có ảnh nào. Hãy chọn ảnh hoặc gửi link cho nhân viên.</div>
        ) : (
          <ul className="photo-grid">
            {photos.map((p) => (
              <li key={p.id} className="photo-card">
                <div className={`photo-status status-${p.status}`}>{STATUS_LABEL[p.status] || p.status}</div>
                <div className="photo-name">{p.original_filename || 'Ảnh'}</div>
                <div className="photo-meta">
                  {[p.width && p.height ? `${p.width}×${p.height}` : null, p.geotagged ? 'đã gắn vị trí' : null]
                    .filter(Boolean)
                    .join(' · ')}
                </div>
                {p.ai_description ? <p className="photo-desc">{p.ai_description}</p> : null}
                {p.reject_reason ? <p className="photo-desc error">{p.reject_reason}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
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
