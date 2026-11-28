'use client'

/**
 * Bản đồ nhiệt lưới thứ hạng: Leaflet + nền CARTO (OpenStreetMap). Không dùng Google Maps JS (không phí tải bản đồ,
 * không vẽ dữ liệu bên thứ ba lên bản đồ Google). Leaflet chỉ nạp ở trình duyệt (import động trong useEffect).
 * Zoom tối thiểu 11 (mức tỉnh/thành) để không bao giờ hiện vùng biển rộng ở mức zoom thế giới.
 */
import 'leaflet/dist/leaflet.css'
import { useEffect, useRef } from 'react'
import type * as Leaflet from 'leaflet'
import { rankTone } from '@/lib/rankgrid/metrics'

export type HeatPoint = {
  idx: number
  lat: number
  lng: number
  rank?: number | null
  status?: string
  /** Điểm bị tắt (biển / người dùng tắt). */
  disabled?: boolean
  inShape?: boolean
}

const TILE_URL = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
const ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'

function pinHtml(p: HeatPoint, mode: 'result' | 'setup', selected: boolean): string {
  const sel = selected ? ' rg-sel' : ''
  if (mode === 'setup') {
    if (p.inShape === false) return `<div class="rg-pin rg-ghost${sel}"></div>`
    return p.disabled ? `<div class="rg-pin rg-off${sel}">×</div>` : `<div class="rg-pin rg-on${sel}">•</div>`
  }
  if (p.disabled || p.inShape === false) return `<div class="rg-pin rg-ghost${sel}"></div>`
  if (p.status && p.status !== 'done') {
    return `<div class="rg-pin rg-wait${sel}">${p.status === 'failed' ? '!' : '…'}</div>`
  }
  const tone = rankTone(p.rank)
  const label = p.rank != null && p.rank <= 20 ? String(p.rank) : '20+'
  return `<div class="rg-pin rg-${tone}${sel}">${label}</div>`
}

export function RankHeatmap({
  center,
  points,
  mode = 'result',
  selectedIdx,
  onPointClick,
  centerLabel,
}: {
  center: { lat: number; lng: number }
  points: HeatPoint[]
  mode?: 'result' | 'setup'
  selectedIdx?: number | null
  onPointClick?: (idx: number) => void
  centerLabel?: string
}) {
  const el = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<Leaflet.Map | null>(null)
  const layerRef = useRef<Leaflet.LayerGroup | null>(null)
  const LRef = useRef<typeof Leaflet | null>(null)
  const clickRef = useRef(onPointClick)
  clickRef.current = onPointClick
  const fittedKey = useRef('')

  // Khởi tạo bản đồ 1 lần.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const mod: any = await import('leaflet')
      const L = (mod.default ?? mod) as typeof Leaflet
      if (cancelled || !el.current || mapRef.current) return
      LRef.current = L
      const map = L.map(el.current, { minZoom: 11, maxZoom: 18, zoomControl: true, attributionControl: true })
      L.tileLayer(TILE_URL, { attribution: ATTRIBUTION, subdomains: 'abcd', maxZoom: 19 }).addTo(map)
      map.setView([center.lat, center.lng], 14)
      layerRef.current = L.layerGroup().addTo(map)
      mapRef.current = map
      draw()
    })()
    return () => {
      cancelled = true
      mapRef.current?.remove()
      mapRef.current = null
      layerRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function draw() {
    const L = LRef.current
    const map = mapRef.current
    const layer = layerRef.current
    if (!L || !map || !layer) return
    layer.clearLayers()
    const latlngs: Leaflet.LatLngExpression[] = []
    for (const p of points) {
      latlngs.push([p.lat, p.lng])
      const icon = L.divIcon({ className: 'rg-pin-wrap', html: pinHtml(p, mode, p.idx === selectedIdx), iconSize: [32, 32], iconAnchor: [16, 16] })
      const m = L.marker([p.lat, p.lng], { icon, keyboard: false })
      m.on('click', () => clickRef.current?.(p.idx))
      m.addTo(layer)
    }
    const c = L.divIcon({ className: 'rg-pin-wrap', html: '<div class="rg-home" title="Vị trí quán">★</div>', iconSize: [18, 18], iconAnchor: [9, 28] })
    L.marker([center.lat, center.lng], { icon: c, interactive: false, title: centerLabel || '' }).addTo(layer)
    const key = `${center.lat},${center.lng},${points.length},${points[0]?.lat},${points[points.length - 1]?.lng}`
    if (latlngs.length && fittedKey.current !== key) {
      fittedKey.current = key
      map.fitBounds(L.latLngBounds(latlngs).pad(0.12))
    }
  }

  useEffect(() => {
    draw()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points, mode, selectedIdx, center.lat, center.lng])

  return <div ref={el} className="rg-map" role="application" aria-label="Bản đồ thứ hạng" />
}

export function RankLegend() {
  return (
    <div className="rg-legend">
      <span><i className="rg-dot rg-top3" /> Top 3</span>
      <span><i className="rg-dot rg-top10" /> 4–10</span>
      <span><i className="rg-dot rg-top20" /> 11–20</span>
      <span><i className="rg-dot rg-out" /> Ngoài top 20</span>
    </div>
  )
}
