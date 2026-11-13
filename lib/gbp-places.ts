/**
 * Places API (New) — nguồn chính thức của Google, dùng làm:
 *   - dự phòng khi Outscraper lỗi / chưa cấu hình,
 *   - đối chiếu số liệu (review, sao) và bù trường còn thiếu cho dữ liệu Outscraper (mergeWithPlaces).
 *
 * Env: GOOGLE_PLACES_API_KEY (tuỳ chọn; thiếu thì bước này tự bỏ qua).
 */

import type {
  GbpAttributeGroup,
  GbpBusinessStatus,
  GbpCoverage,
  GbpReviewItem,
  RunGbpSnapshotInput,
  RunGbpSnapshotResult,
} from '@/lib/gbp-snapshot-types'
import { parseRelativeAgeDays } from '@/lib/gbp-relative-time'
import { buildMapsSearchUrl } from '@/lib/place-identity'

const PLACES_TIMEOUT_MS = 20_000

const PLACES_BASE_MASK =
  'id,displayName,formattedAddress,nationalPhoneNumber,websiteUri,googleMapsUri,rating,userRatingCount,primaryTypeDisplayName,primaryType,types,regularOpeningHours,currentOpeningHours,editorialSummary,photos,reviews'

// Field thuộc cùng tier Enterprise+Atmosphere với reviews/editorialSummary đã gọi sẵn -> không đổi SKU.
// Nếu Google từ chối mask mở rộng (400), tự thử lại bằng mask gốc để không mất fallback.
const PLACES_EXTRA_MASK =
  'businessStatus,delivery,dineIn,takeout,curbsidePickup,reservable,outdoorSeating,goodForChildren,goodForGroups,allowsDogs,restroom,paymentOptions,parkingOptions,accessibilityOptions'

const PLACES_BOOL_LABELS: Record<string, string> = {
  delivery: 'Giao hàng',
  dineIn: 'Ăn tại chỗ',
  takeout: 'Mua mang đi',
  curbsidePickup: 'Nhận hàng tại xe',
  reservable: 'Nhận đặt chỗ',
  outdoorSeating: 'Chỗ ngồi ngoài trời',
  goodForChildren: 'Phù hợp cho trẻ em',
  goodForGroups: 'Phù hợp cho nhóm',
  allowsDogs: 'Cho phép thú cưng',
  restroom: 'Có nhà vệ sinh',
}

const PLACES_OBJ_LABELS: Record<string, { group: string; map: Record<string, string> }> = {
  paymentOptions: {
    group: 'Thanh toán',
    map: {
      acceptsCreditCards: 'Thẻ tín dụng',
      acceptsDebitCards: 'Thẻ ghi nợ',
      acceptsNfc: 'NFC',
      acceptsCashOnly: 'Chỉ tiền mặt',
    },
  },
  parkingOptions: {
    group: 'Bãi đỗ xe',
    map: {
      freeParkingLot: 'Bãi đỗ miễn phí',
      paidParkingLot: 'Bãi đỗ có phí',
      freeStreetParking: 'Đỗ xe ven đường miễn phí',
      paidStreetParking: 'Đỗ xe ven đường có phí',
      valetParking: 'Có người giữ xe',
      freeGarageParking: 'Hầm để xe miễn phí',
      paidGarageParking: 'Hầm để xe có phí',
    },
  },
  accessibilityOptions: {
    group: 'Hỗ trợ tiếp cận',
    map: {
      wheelchairAccessibleParking: 'Chỗ đỗ cho xe lăn',
      wheelchairAccessibleEntrance: 'Lối vào cho xe lăn',
      wheelchairAccessibleRestroom: 'Nhà vệ sinh cho xe lăn',
      wheelchairAccessibleSeating: 'Chỗ ngồi cho xe lăn',
    },
  },
}

function placesAttributes(place: any): GbpAttributeGroup[] {
  const groups: GbpAttributeGroup[] = []
  const flat = Object.keys(PLACES_BOOL_LABELS).filter((k) => place?.[k] === true).map((k) => PLACES_BOOL_LABELS[k])
  if (flat.length) groups.push({ group: 'Tùy chọn dịch vụ (Places)', items: flat })
  for (const key of Object.keys(PLACES_OBJ_LABELS)) {
    const spec = PLACES_OBJ_LABELS[key]
    const obj = place?.[key]
    if (!obj || typeof obj !== 'object') continue
    const items = Object.keys(spec.map).filter((k) => obj[k] === true).map((k) => spec.map[k])
    if (items.length) groups.push({ group: spec.group, items })
  }
  return groups
}

function mergeAttributes(a: GbpAttributeGroup[] = [], b: GbpAttributeGroup[] = []): GbpAttributeGroup[] {
  const map = new Map<string, GbpAttributeGroup>()
  for (const g of [...a, ...b]) {
    const key = g.group.toLowerCase()
    const cur = map.get(key)
    if (!cur) map.set(key, { group: g.group, items: [...g.items] })
    else for (const it of g.items) if (!cur.items.includes(it)) cur.items.push(it)
  }
  return Array.from(map.values())
}

function placesStatus(s: unknown): GbpBusinessStatus | null {
  if (s === 'OPERATIONAL') return 'operational'
  if (s === 'CLOSED_TEMPORARILY') return 'temporarily_closed'
  if (s === 'CLOSED_PERMANENTLY') return 'permanently_closed'
  return null
}

/** Gọi Places API. KHÔNG BAO GIỜ ném lỗi: mọi lỗi (mạng, JSON, HTTP) trả về { error } để nơi gọi tự quyết định. */
export async function fetchPlacesSnapshot(input: RunGbpSnapshotInput): Promise<RunGbpSnapshotResult> {
  try {
    return await fetchPlacesUnsafe(input)
  } catch (err: any) {
    return { error: `Places: ${err?.message || err}`, source_used: 'places' }
  }
}

async function fetchPlacesUnsafe(input: RunGbpSnapshotInput): Promise<RunGbpSnapshotResult> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY
  if (!apiKey) {
    return { error: 'Chưa cấu hình GOOGLE_PLACES_API_KEY', source_used: 'places' }
  }

  let placeId = input.placeId ? String(input.placeId).replace(/^places\//, '') : null

  if (!placeId) {
    let textQuery = ''
    if (input.businessName && input.area) textQuery = `${input.businessName} ${input.area}`
    else if (input.businessName) textQuery = input.businessName
    else if (input.mapsUrl) textQuery = input.mapsUrl
    else return { error: 'Thiếu thông tin tìm địa điểm', source_used: 'places' }

    const searchRes = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': 'places.id,places.displayName',
      },
      body: JSON.stringify({ textQuery, languageCode: 'vi' }),
      signal: AbortSignal.timeout(PLACES_TIMEOUT_MS),
    })
    const searchData = await searchRes.json()
    if (!searchRes.ok) {
      return {
        error: `Places search: ${searchData?.error?.message || searchRes.status}`,
        source_used: 'places',
        raw: searchData,
      }
    }
    placeId = searchData.places?.[0]?.id || null
    if (!placeId) return { error: 'Places: không tìm thấy địa điểm', source_used: 'places' }
  }

  const idForUrl = placeId.startsWith('places/') ? placeId : `places/${placeId}`
  const callDetails = (mask: string) =>
    fetch(`https://places.googleapis.com/v1/${idForUrl}?languageCode=vi`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': mask,
      },
      signal: AbortSignal.timeout(PLACES_TIMEOUT_MS),
    })

  let detailsRes = await callDetails(`${PLACES_BASE_MASK},${PLACES_EXTRA_MASK}`)
  let place = await detailsRes.json()
  if (detailsRes.status === 400) {
    // mask mở rộng bị từ chối -> quay về mask gốc đã chạy ổn định
    detailsRes = await callDetails(PLACES_BASE_MASK)
    place = await detailsRes.json()
  }
  if (!detailsRes.ok) {
    return {
      error: `Places details: ${place?.error?.message || detailsRes.status}`,
      source_used: 'places',
      raw: place,
    }
  }

  const photosCount = Array.isArray(place.photos) ? place.photos.length : 0
  const reviews: GbpReviewItem[] = Array.isArray(place.reviews)
    ? place.reviews
        .map((r: any) => {
          const rel = r?.relativePublishTimeDescription || null
          return {
            rating: typeof r?.rating === 'number' ? r.rating : (null as unknown as number),
            text: r?.originalText?.text || r?.text?.text || '',
            relative_time: rel,
            age_days_est: parseRelativeAgeDays(rel),
            reply: null, // Places API không trả phản hồi của chủ
          }
        })
        .filter((r: GbpReviewItem) => r.rating != null && r.text.trim().length > 0)
    : []
  const hoursLines: string[] =
    place.regularOpeningHours?.weekdayDescriptions || place.currentOpeningHours?.weekdayDescriptions || []

  return {
    place_id: place.id || placeId,
    maps_url: place.googleMapsUri || input.mapsUrl || buildMapsSearchUrl(input),
    business_name: place.displayName?.text || input.businessName || null,
    description: place.editorialSummary?.text || null,
    primary_category: place.primaryTypeDisplayName?.text || place.primaryType || null,
    // `types` của Places KHÔNG phải danh mục phụ của hồ sơ -> không gán vào additional_categories (xem types).
    additional_categories: null,
    opening_hours: hoursLines.length ? hoursLines.join(' | ') : null,
    rating: place.rating ?? null,
    review_count: place.userRatingCount ?? null,
    phone: place.nationalPhoneNumber || null,
    website_url: place.websiteUri || null,
    address_text: place.formattedAddress || null,
    business_status: placesStatus(place.businessStatus),
    attributes: placesAttributes(place),
    posts_signal: 'Chưa quan sát được bài đăng (Places API không có dữ liệu này).',
    recent_posts: [],
    photos_signal:
      photosCount >= 10
        ? 'Từ 10 ảnh trở lên (Places chỉ trả tối đa 10)'
        : photosCount >= 3
          ? 'Có một số ảnh'
          : photosCount > 0
            ? 'Ít ảnh'
            : 'Chưa rõ / ít ảnh công khai',
    photos_count_est: photosCount,
    reviews,
    source_used: 'places',
    raw: { source: 'places', place },
  }
}

/**
 * Gộp kết quả nguồn chính (Outscraper) với Places API.
 * Places là nguồn chính thức: dùng để đối chiếu số liệu và bù trường còn thiếu.
 */
export function mergeWithPlaces(
  b: RunGbpSnapshotResult,
  places: RunGbpSnapshotResult,
): RunGbpSnapshotResult {
  const warnings = [...(b.coverage?.warnings || [])]
  // Cảnh báo khi 2 nguồn lệch hẳn nhau — dấu hiệu đọc nhầm doanh nghiệp / số liệu trễ
  if (b.review_count != null && places.review_count != null) {
    const hi = Math.max(b.review_count, places.review_count)
    const lo = Math.min(b.review_count, places.review_count)
    if (hi > 20 && lo / hi < 0.7) {
      warnings.push(`Số review lệch giữa Outscraper (${b.review_count}) và Places API (${places.review_count}).`)
    }
  }
  if (b.rating != null && places.rating != null && Math.abs(b.rating - places.rating) >= 0.3) {
    warnings.push(`Điểm sao lệch giữa Outscraper (${b.rating}) và Places API (${places.rating}).`)
  }

  const primaryReviews = b.reviews && b.reviews.length ? b.reviews : null
  const coverage: GbpCoverage | null = b.coverage ? { ...b.coverage, warnings } : null

  return {
    ...places,
    ...b,
    place_id: places.place_id || b.place_id || null,
    description: b.description || places.description || null,
    rating: b.rating ?? places.rating ?? null,
    review_count: b.review_count ?? places.review_count ?? null,
    primary_category: b.primary_category || places.primary_category || null,
    additional_categories: b.additional_categories || null,
    opening_hours: b.opening_hours || places.opening_hours || null,
    phone: b.phone || places.phone || null,
    website_url: b.website_url || places.website_url || null,
    address_text: b.address_text || places.address_text || null,
    business_status:
      places.business_status && places.business_status !== 'operational'
        ? places.business_status
        : b.business_status || places.business_status || null,
    attributes: mergeAttributes(b.attributes, places.attributes),
    photos_signal: b.photos_signal || places.photos_signal || null,
    photos_count_est: b.photos_count_est ?? places.photos_count_est ?? null,
    posts_signal: b.posts_signal || places.posts_signal,
    recent_posts: b.recent_posts?.length ? b.recent_posts : places.recent_posts || [],
    // Review nguồn chính (nhiều hơn, có ngày + phản hồi chủ) được ưu tiên; Places chỉ là dự phòng
    reviews: primaryReviews || places.reviews || [],
    // Places không có phản hồi của chủ -> không tính thống kê (reply_rate sẽ sai)
    review_stats: primaryReviews ? b.review_stats : null,
    coverage,
    source_used: 'outscraper+places',
    error: b.error,
    raw: { outscraper: b.raw, places: places.raw },
  }
}
