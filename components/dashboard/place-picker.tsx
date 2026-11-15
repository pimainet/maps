'use client'

import { useState } from 'react'
import { MapPin, Search, Star } from 'lucide-react'
import type { PlaceCandidate } from '@/lib/place-search'

/**
 * Chủ quán gõ "tên + khu vực" -> chọn đúng doanh nghiệp trong danh sách -> nhận về place_id + link Maps.
 * Không bắt người dùng tự tìm link hay mã Place ID.
 */
export function PlacePicker({
  initialQuery = '',
  selected,
  onSelect,
}: {
  initialQuery?: string
  selected?: { name: string; address?: string | null } | null
  onSelect: (c: PlaceCandidate) => void
}) {
  const [query, setQuery] = useState(initialQuery)
  const [results, setResults] = useState<PlaceCandidate[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [chosen, setChosen] = useState<PlaceCandidate | null>(null)

  async function search() {
    if (loading) return
    setLoading(true)
    setError('')
    setResults(null)
    try {
      const res = await fetch('/api/places/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Không tìm được. Vui lòng thử lại.')
      setResults(data.results || [])
    } catch (e: any) {
      setError(e.message || 'Không tìm được. Vui lòng thử lại.')
    } finally {
      setLoading(false)
    }
  }

  function pick(c: PlaceCandidate) {
    setChosen(c)
    setResults(null)
    onSelect(c)
  }

  const current = chosen || (selected?.name ? { name: selected.name, address: selected.address ?? null } : null)

  return (
    <div style={{ gridColumn: '1 / -1' }}>
      <span style={{ display: 'block', fontWeight: 600, marginBottom: 6 }}>Tìm doanh nghiệp của bạn trên Google Maps</span>
      {current && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: 10, borderRadius: 8, background: 'var(--success-soft, #eefbf1)', marginBottom: 8, fontSize: 14 }}>
          <MapPin size={16} />
          <div>
            <strong>{current.name}</strong>
            {current.address ? <div style={{ color: 'var(--muted-foreground)' }}>{current.address}</div> : null}
          </div>
        </div>
      )}
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          style={{ flex: 1 }}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              search()
            }
          }}
          placeholder="Gõ tên + khu vực, ví dụ: Nha khoa Tâm An Quận 3"
        />
        <button type="button" className="secondary-button" onClick={search} disabled={loading || query.trim().length < 3}>
          <Search size={14} /> {loading ? 'Đang tìm…' : current ? 'Tìm lại' : 'Tìm'}
        </button>
      </div>
      {error && <div style={{ color: 'var(--danger)', fontSize: 13, marginTop: 6 }}>{error}</div>}
      {results && results.length === 0 && (
        <div style={{ color: 'var(--muted-foreground)', fontSize: 13, marginTop: 6 }}>
          Không thấy kết quả. Thử gõ thêm khu vực (quận/huyện, tỉnh/thành) hoặc tên đúng như trên biển hiệu.
        </div>
      )}
      {results && results.length > 0 && (
        <div style={{ display: 'grid', gap: 6, marginTop: 8 }}>
          <div style={{ color: 'var(--muted-foreground)', fontSize: 13 }}>Bấm vào đúng doanh nghiệp của bạn:</div>
          {results.map((c) => (
            <button
              key={c.place_id}
              type="button"
              onClick={() => pick(c)}
              style={{ textAlign: 'left', padding: 10, borderRadius: 8, border: '1px solid var(--border, #ddd)', background: 'transparent', cursor: 'pointer' }}
            >
              <strong>{c.name}</strong>
              {c.category ? <span style={{ color: 'var(--muted-foreground)' }}> · {c.category}</span> : null}
              {c.address ? <div style={{ fontSize: 13, color: 'var(--muted-foreground)' }}>{c.address}</div> : null}
              {c.rating != null ? (
                <div style={{ fontSize: 13 }}>
                  <Star size={12} /> {c.rating}
                  {c.review_count != null ? ` (${c.review_count} đánh giá)` : ''}
                </div>
              ) : null}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
