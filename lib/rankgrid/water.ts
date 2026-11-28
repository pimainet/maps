/**
 * Kiểm tra điểm lưới nằm trên mặt nước (biển Sầm Sơn, sông Mã...) bằng reverse geocode Nominatim (OpenStreetMap).
 * Chỉ chạy lúc cài đặt lưới, tuần tự ≤ 1 request/giây theo chính sách Nominatim, có User-Agent định danh.
 * Có thể trỏ sang máy chủ Nominatim khác bằng NOMINATIM_URL. Lỗi/không rõ -> null (giữ điểm, người dùng tự tắt trên bản đồ).
 */
import type { WaterTester } from './geometry'

export const NOMINATIM_DELAY_MS = 1100

/** Phần thuần: đọc phản hồi reverse -> true (nước) / false (đất) / null (không rõ). */
export function classifyReverse(json: any): boolean | null {
  if (!json || typeof json !== 'object') return null
  if (typeof json.error === 'string') return /unable to geocode/i.test(json.error) ? true : null
  const cls = String(json.class || json.category || '')
  const type = String(json.type || json.addresstype || '')
  if (cls === 'natural' && /^(water|bay|strait|coastline|sea)$/.test(type)) return true
  if (cls === 'waterway' || (cls === 'place' && /^(sea|ocean)$/.test(type))) return true
  if (json.address && typeof json.address === 'object') return false
  return null
}

export function nominatimTester(): WaterTester {
  const base = (process.env.NOMINATIM_URL || 'https://nominatim.openstreetmap.org').replace(/\/$/, '')
  const ua = `LocalGrowthOS-rankgrid/1.0 (${process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || 'local-growth-os'})`
  return async (lat, lng) => {
    const url = `${base}/reverse?format=jsonv2&zoom=17&lat=${lat}&lon=${lng}&accept-language=vi`
    const res = await fetch(url, { headers: { 'User-Agent': ua }, signal: AbortSignal.timeout(10_000) })
    if (!res.ok) return null
    return classifyReverse(await res.json().catch(() => null))
  }
}
