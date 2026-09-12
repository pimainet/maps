/**
 * Quan sát GBP public qua browser agent (Stagehand + Browserbase).
 *
 * Giai đoạn A:
 * - Nếu có BROWSERBASE_API_KEY + BROWSERBASE_PROJECT_ID → chạy Stagehand thật
 * - Nếu chưa cấu hình → fallback Places-like stub (không crash), status partial
 *
 * Copy vào: lib/gbp-browser-snapshot.ts
 *
 * Cài package (khi sẵn sàng browser thật):
 *   pnpm add @browserbasehq/stagehand zod
 */

import type { GbpSnapshotPayload, GbpPostItem } from '@/lib/gbp-snapshot-types'
import { GBP_SNAPSHOT_MAX_POSTS } from '@/lib/gbp-snapshot-types'

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
    const id = input.placeId.replace(/^places\//, '')
    return `https://www.google.com/maps/place/?q=place_id:${id}`
  }
  if (input.businessName) {
    const q = [input.businessName, input.area].filter(Boolean).join(' ')
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`
  }
  return null
}

/**
 * Fallback khi chưa có Browserbase: dùng Places API (đã có key) để không để trống.
 * Không lấy được posts — posts_signal ghi rõ.
 */
async function fallbackFromPlaces(
  input: RunGbpSnapshotInput
): Promise<RunGbpSnapshotResult> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY
  if (!apiKey) {
    return {
      error:
        'Chưa cấu hình BROWSERBASE và cũng không có GOOGLE_PLACES_API_KEY — không thể quan sát',
    }
  }

  let textQuery = ''
  if (input.businessName && input.area) {
    textQuery = `${input.businessName} ${input.area}`
  } else if (input.businessName) {
    textQuery = input.businessName
  } else if (input.mapsUrl) {
    textQuery = input.mapsUrl
  } else {
    return { error: 'Thiếu thông tin để tìm địa điểm' }
  }

  const searchRes = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': 'places.id,places.displayName',
    },
    body: JSON.stringify({ textQuery, languageCode: 'vi' }),
  })
  const searchData = await searchRes.json()
  const placeId = searchData.places?.[0]?.id
  if (!placeId) {
    return { error: 'Places fallback: không tìm thấy địa điểm' }
  }

  const detailsRes = await fetch(`https://places.googleapis.com/v1/places/${placeId}`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask':
        'id,displayName,formattedAddress,nationalPhoneNumber,websiteUri,googleMapsUri,rating,userRatingCount,primaryTypeDisplayName,editorialSummary,photos',
    },
  })
  if (!detailsRes.ok) {
    return { error: 'Places fallback: không lấy được chi tiết' }
  }
  const place = await detailsRes.json()
  const photosCount = place.photos?.length ?? 0

  return {
    place_id: place.id,
    maps_url: place.googleMapsUri || input.mapsUrl || null,
    business_name: place.displayName?.text || input.businessName || null,
    description: place.editorialSummary?.text || null,
    primary_category: place.primaryTypeDisplayName?.text || null,
    rating: place.rating ?? null,
    review_count: place.userRatingCount ?? null,
    phone: place.nationalPhoneNumber || null,
    website_url: place.websiteUri || null,
    address_text: place.formattedAddress || null,
    posts_signal:
      'Chưa quan sát được bài đăng (đang dùng Places — cần Browserbase để lấy posts)',
    recent_posts: [],
    photos_signal:
      photosCount >= 10
        ? 'Nhiều ảnh trên listing'
        : photosCount >= 3
          ? 'Có một số ảnh'
          : photosCount > 0
            ? 'Ít ảnh'
            : 'Chưa rõ / ít ảnh',
    photos_count_est: photosCount,
    raw: { source: 'places_fallback', place },
  }
}

/**
 * Browser thật với Stagehand (khi đã cấu hình env).
 */
async function runWithStagehand(
  url: string
): Promise<RunGbpSnapshotResult> {
  // Dynamic import để project build được khi chưa cài package
  const { Stagehand } = await import('@browserbasehq/stagehand')
  const { z } = await import('zod')

  const stagehand = new Stagehand({
    env: 'BROWSERBASE',
    apiKey: process.env.BROWSERBASE_API_KEY,
    projectId: process.env.BROWSERBASE_PROJECT_ID,
    // Model cho extract — dùng Anthropic nếu đã có key
    modelName: process.env.STAGEHAND_MODEL || 'claude-sonnet-4-20250514',
    modelClientOptions: {
      apiKey: process.env.ANTHROPIC_API_KEY,
    },
  })

  await stagehand.init()
  const page = stagehand.page

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeoutMs: 60000 })
    // Cho Maps render panel
    await page.waitForTimeout(3000)

    const schema = z.object({
      business_name: z.string().optional().nullable(),
      description: z.string().optional().nullable(),
      primary_category: z.string().optional().nullable(),
      rating: z.number().optional().nullable(),
      review_count: z.number().optional().nullable(),
      phone: z.string().optional().nullable(),
      website_url: z.string().optional().nullable(),
      address_text: z.string().optional().nullable(),
      posts_signal: z
        .string()
        .describe(
          'Tóm tắt tình trạng bài đăng công khai, ví dụ: "Có vài bài cập nhật gần đây" hoặc "Không thấy bài đăng"'
        )
        .optional()
        .nullable(),
      recent_posts: z
        .array(
          z.object({
            text: z.string(),
            approx_date: z.string().optional().nullable(),
          })
        )
        .max(GBP_SNAPSHOT_MAX_POSTS)
        .optional()
        .nullable(),
      photos_signal: z
        .string()
        .describe('Tóm tắt ảnh: nhiều / ít / không rõ')
        .optional()
        .nullable(),
      photos_count_est: z.number().optional().nullable(),
    })

    const extracted = await stagehand.extract({
      instruction: `Bạn đang xem trang Google Maps / Google Business Profile công khai (tiếng Việt hoặc Anh).
Hãy đọc panel thông tin doanh nghiệp đang mở.
Lấy: tên, mô tả (About), danh mục, rating, số review, SĐT, website, địa chỉ.
Tìm phần bài đăng / Updates / Posts nếu có — lấy tối đa ${GBP_SNAPSHOT_MAX_POSTS} bài (nội dung ngắn + ngày nếu thấy).
Đánh giá nhanh tình trạng ảnh (nhiều/ít).
Nếu không tìm thấy trường nào thì để null. Không bịa dữ liệu.`,
      schema,
    })

    const posts: GbpPostItem[] = (extracted.recent_posts || [])
      .filter((p: any) => p?.text)
      .slice(0, GBP_SNAPSHOT_MAX_POSTS)
      .map((p: any) => ({
        text: String(p.text).slice(0, 500),
        approx_date: p.approx_date || null,
      }))

    return {
      maps_url: url,
      business_name: extracted.business_name || null,
      description: extracted.description || null,
      primary_category: extracted.primary_category || null,
      rating: extracted.rating ?? null,
      review_count: extracted.review_count ?? null,
      phone: extracted.phone || null,
      website_url: extracted.website_url || null,
      address_text: extracted.address_text || null,
      posts_signal:
        extracted.posts_signal ||
        (posts.length > 0
          ? `Thấy khoảng ${posts.length} bài đăng trên listing`
          : 'Không thấy bài đăng công khai'),
      recent_posts: posts,
      photos_signal: extracted.photos_signal || null,
      photos_count_est: extracted.photos_count_est ?? null,
      raw: { source: 'stagehand', extracted },
    }
  } finally {
    await stagehand.close()
  }
}

/**
 * Entry chính — tự chọn Stagehand hoặc Places fallback.
 */
export async function runGbpPublicSnapshot(
  input: RunGbpSnapshotInput
): Promise<RunGbpSnapshotResult> {
  const url = buildSearchUrl(input)
  const hasBrowserbase =
    Boolean(process.env.BROWSERBASE_API_KEY) &&
    Boolean(process.env.BROWSERBASE_PROJECT_ID)

  if (hasBrowserbase && url) {
    try {
      return await runWithStagehand(url)
    } catch (err: any) {
      // Browser lỗi → fallback Places, không nuốt hoàn toàn
      const fb = await fallbackFromPlaces(input)
      return {
        ...fb,
        error: `Browser lỗi: ${err?.message || err}. Đã fallback Places.`,
      }
    }
  }

  // Chưa có Browserbase
  const fb = await fallbackFromPlaces(input)
  if (!fb.error) {
    return {
      ...fb,
      error: undefined,
    }
  }
  return fb
}
