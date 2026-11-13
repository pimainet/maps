/**
 * Điểm vào duy nhất để lấy snapshot hồ sơ Google Maps (GBP) cho audit.
 *
 *   1. Outscraper (lib/gbp-outscraper.ts) là nguồn chính — cần OUTSCRAPER_API_KEY.
 *   2. Places API (lib/gbp-places.ts) đối chiếu số liệu và bù trường thiếu; là nguồn dự phòng khi Outscraper
 *      lỗi hoặc chưa cấu hình key.
 *
 * Hàm này KHÔNG ném lỗi: mọi thất bại trả về kết quả có `error` (và có thể không có dữ liệu hồ sơ),
 * nơi gọi dùng `hasProfileData()` để biết có đủ dữ liệu để audit hay không.
 */

import type { RunGbpSnapshotInput, RunGbpSnapshotResult } from '@/lib/gbp-snapshot-types'
import { fetchOutscraperSnapshot, outscraperConfigured } from '@/lib/gbp-outscraper'
import { fetchPlacesSnapshot, mergeWithPlaces } from '@/lib/gbp-places'
import { buildMapsSearchUrl, isSupportedGoogleMapsUrl } from '@/lib/place-identity'

export type { RunGbpSnapshotInput, RunGbpSnapshotResult }

/** Có ít nhất 1 dấu hiệu đã đọc được đúng hồ sơ (đủ để audit; thiếu thì KHÔNG được gọi AI để "đoán"). */
export function hasProfileData(s: Partial<RunGbpSnapshotResult> | null | undefined): boolean {
  return Boolean(s && (s.business_name || s.rating != null || s.review_count != null || s.address_text || s.place_id))
}

async function fromOutscraper(input: RunGbpSnapshotInput): Promise<RunGbpSnapshotResult> {
  const mapped = await fetchOutscraperSnapshot(input)
  const { reply_field_present, raw_review_count, ...payload } = mapped
  return {
    ...payload,
    maps_url: payload.maps_url || buildMapsSearchUrl(input),
    source_used: 'outscraper',
    raw: {
      source: 'outscraper',
      coverage: payload.coverage,
      reply_field_present,
      raw_review_count,
    },
  }
}

export async function runGbpPublicSnapshot(input: RunGbpSnapshotInput): Promise<RunGbpSnapshotResult> {
  if (input.mapsUrl && !isSupportedGoogleMapsUrl(input.mapsUrl)) {
    return { error: 'Link không hợp lệ. Chỉ hỗ trợ liên kết Google Maps bảo mật (HTTPS).' }
  }
  if (!input.mapsUrl && !input.placeId && !input.businessName) {
    return { error: 'Thiếu link Google Maps, Place ID hoặc tên doanh nghiệp để tìm hồ sơ.' }
  }

  // Không có Outscraper -> chỉ còn Places.
  if (!outscraperConfigured()) return fetchPlacesSnapshot(input)

  let primary: RunGbpSnapshotResult
  try {
    primary = await fromOutscraper(input)
  } catch (err: any) {
    const fallback = await fetchPlacesSnapshot(input)
    return { ...fallback, error: `Outscraper lỗi: ${err?.message || err}. Đã dùng Places làm dự phòng.` }
  }

  // Đã có dữ liệu Outscraper; Places chỉ để đối chiếu/bù. Lỗi hoặc không tìm thấy -> giữ nguyên Outscraper.
  const places = await fetchPlacesSnapshot({ ...input, placeId: input.placeId || primary.place_id })
  if (places.error && !places.business_name) return primary
  return mergeWithPlaces(primary, places)
}
