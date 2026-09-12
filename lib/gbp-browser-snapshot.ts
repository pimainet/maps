/**
 * Quan sát GBP public — Giai đoạn A (bản build-safe).
 *
 * Hiện chỉ dùng Places API (không import Stagehand/zod → Vercel build OK).
 * Khi cài @browserbasehq/stagehand + zod và có BROWSERBASE_* env,
 * sẽ bổ sung nhánh browser ở bước sau.
 *
 * Đặt vào: lib/gbp-browser-snapshot.ts  (đè file cũ)
 */

import type { GbpSnapshotPayload } from '@/lib/gbp-snapshot-types'

export type RunGbpSnapshotInput = {
  mapsUrl?: string
  businessName?: string
  area?: string
  placeId?: string | null
}

export type RunGbpSnapshotResult = GbpSnapshotPayload & {
  error?: string
  raw?: unknown
}

function buildSearchUrl(input: RunGbpSnapshotInput): string | null {
  if (input.mapsUrl) return input.mapsUrl
  if (input.placeId) {
    const id = String(input.placeId).replace(/^places\//, '')
    return `https://www.google.com/maps/place/?q=place_id:${id}`
  }
  if (input.businessName) {
    const q = [input.businessName, input.area].filter(Boolean).join(' ')
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`
  }
  return null
}

/**
 * Lấy dữ liệu công khai qua Places API.
 * Không lấy được bài đăng — posts_signal ghi rõ để Audit biết.
 */
async function fromPlaces(input: RunGbpSnapshotInput): Promise<RunGbpSnapshotResult> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY
  if (!apiKey) {
    return {
      error:
        'Chưa cấu hình GOOGLE_PLACES_API_KEY — không thể quan sát. Thêm key trên Vercel Environment Variables rồi Redeploy.',
    }
  }

  let placeId = input.placeId
    ? String(input.placeId).replace(/^places\//, '')
    : null

  // Nếu chưa có place_id → Text Search
  if (!placeId) {
    let textQuery = ''
    if (input.businessName && input.area) {
      textQuery = `${input.businessName} ${input.area}`
    } else if (input.businessName) {
      textQuery = input.businessName
    } else if (input.mapsUrl) {
      textQuery = input.mapsUrl
    } else {
      return { error: 'Thiếu tên / khu vực / link Maps để tìm địa điểm' }
    }

    const searchRes = await fetch(
      'https://places.googleapis.com/v1/places:searchText',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask': 'places.id,places.displayName',
        },
        body: JSON.stringify({ textQuery, languageCode: 'vi' }),
      }
    )

    const searchData = await searchRes.json()
    if (!searchRes.ok) {
      return {
        error: `Places search lỗi: ${searchData?.error?.message || searchRes.status}`,
        raw: searchData,
      }
    }

    placeId = searchData.places?.[0]?.id || null
    if (!placeId) {
      return { error: 'Không tìm thấy địa điểm trên Google Places' }
    }
  }

  // Place Details
  const idForUrl = placeId.startsWith('places/') ? placeId : `places/${placeId}`
  const detailsRes = await fetch(
    `https://places.googleapis.com/v1/${idForUrl}`,
    {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask':
          'id,displayName,formattedAddress,nationalPhoneNumber,websiteUri,googleMapsUri,rating,userRatingCount,primaryTypeDisplayName,editorialSummary,photos',
      },
    }
  )

  const place = await detailsRes.json()
  if (!detailsRes.ok) {
    return {
      error: `Places details lỗi: ${place?.error?.message || detailsRes.status}`,
      raw: place,
    }
  }

  const photosCount = Array.isArray(place.photos) ? place.photos.length : 0

  return {
    place_id: place.id || placeId,
    maps_url: place.googleMapsUri || input.mapsUrl || buildSearchUrl(input),
    business_name: place.displayName?.text || input.businessName || null,
    description: place.editorialSummary?.text || null,
    primary_category: place.primaryTypeDisplayName?.text || null,
    rating: place.rating ?? null,
    review_count: place.userRatingCount ?? null,
    phone: place.nationalPhoneNumber || null,
    website_url: place.websiteUri || null,
    address_text: place.formattedAddress || null,
    posts_signal:
      'Chưa quan sát được bài đăng (Giai đoạn A dùng Places). Bật Browserbase ở bước sau để lấy posts.',
    recent_posts: [],
    photos_signal:
      photosCount >= 10
        ? 'Nhiều ảnh trên listing'
        : photosCount >= 3
          ? 'Có một số ảnh'
          : photosCount > 0
            ? 'Ít ảnh'
            : 'Chưa rõ / ít ảnh công khai',
    photos_count_est: photosCount,
    raw: { source: 'places', place },
  }
}

/**
 * Entry chính — Giai đoạn A chỉ Places (build-safe).
 */
export async function runGbpPublicSnapshot(
  input: RunGbpSnapshotInput
): Promise<RunGbpSnapshotResult> {
  try {
    return await fromPlaces(input)
  } catch (err: any) {
    return {
      error: err?.message || String(err),
    }
  }
}
