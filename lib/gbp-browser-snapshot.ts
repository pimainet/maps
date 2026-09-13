/**
 * Quan sát GBP public — Giai đoạn A+ (Places + Browserbase/Stagehand).
 *
 * - Có BROWSERBASE_API_KEY + BROWSERBASE_PROJECT_ID → browser lấy mô tả + posts
 * - Không có → Places fallback (như trước)
 *
 * Cần: pnpm add @browserbasehq/stagehand zod
 * Đặt vào: lib/gbp-browser-snapshot.ts
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
    const id = String(input.placeId).replace(/^places\//, '')
    return `https://www.google.com/maps/place/?q=place_id:${id}`
  }
  if (input.businessName) {
    const q = [input.businessName, input.area].filter(Boolean).join(' ')
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`
  }
  return null
}

async function fromPlaces(input: RunGbpSnapshotInput): Promise<RunGbpSnapshotResult> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY
  if (!apiKey) {
    return {
      error:
        'Chưa cấu hình GOOGLE_PLACES_API_KEY. Thêm trên Vercel rồi Redeploy.',
    }
  }

  let placeId = input.placeId
    ? String(input.placeId).replace(/^places\//, '')
    : null

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
      'Chưa quan sát được bài đăng (Places). Cần Browserbase để lấy posts.',
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
 * Browser agent qua Stagehand + Browserbase (v4 API ưu tiên).
 */
async function fromBrowser(url: string): Promise<RunGbpSnapshotResult> {
  const { browserbase, Stagehand } = await import('@browserbasehq/stagehand')
  const { z } = await import('zod')

  const apiKey = process.env.BROWSERBASE_API_KEY!
  const projectId = process.env.BROWSERBASE_PROJECT_ID

  // Model: ưu tiên Anthropic (đã có key trong project)
  const modelApiKey =
    process.env.ANTHROPIC_API_KEY ||
    process.env.OPENAI_API_KEY ||
    process.env.MODEL_API_KEY

  const modelName =
    process.env.STAGEHAND_MODEL ||
    (process.env.ANTHROPIC_API_KEY
      ? 'anthropic/claude-sonnet-4-20250514'
      : 'openai/gpt-4o')

  let browser: any
  let stagehand: any

  try {
    // Stagehand v4 style
    browser = await browserbase.launch({
      apiKey,
      ...(projectId ? { projectId } : {}),
    })
    stagehand = await Stagehand.create({
      browser,
      model: {
        modelName,
        apiKey: modelApiKey,
      },
    })
  } catch {
    // Fallback constructor cũ (env: BROWSERBASE)
    const { Stagehand: StagehandLegacy } = await import(
      '@browserbasehq/stagehand'
    )
    stagehand = new (StagehandLegacy as any)({
      env: 'BROWSERBASE',
      apiKey,
      projectId,
      model: modelName,
      modelClientOptions: { apiKey: modelApiKey },
    })
    await stagehand.init()
  }

  try {
    let page: any
    if (browser?.context?.pages) {
      const pages = await browser.context.pages()
      page = pages[0]
    } else if (stagehand.page) {
      page = stagehand.page
    } else if (stagehand.context?.pages) {
      page = stagehand.context.pages()[0]
    }

    if (!page) {
      return { error: 'Stagehand không mở được page' }
    }

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
    // Cho Maps render panel
    if (typeof page.waitForTimeout === 'function') {
      await page.waitForTimeout(4000)
    } else {
      await new Promise((r) => setTimeout(r, 4000))
    }

    // Thử click tab / mở phần About hoặc Posts nếu thấy (không bắt buộc)
    try {
      await stagehand.act(
        'Nếu có nút hoặc tab About, Mô tả, Updates, Posts, Bài đăng thì mở nó. Nếu không thì bỏ qua.'
      )
    } catch {
      // ignore
    }

    const schema = z.object({
      business_name: z.string().nullable().optional(),
      description: z
        .string()
        .nullable()
        .optional()
        .describe('Mô tả doanh nghiệp / About text trên listing'),
      primary_category: z.string().nullable().optional(),
      rating: z.number().nullable().optional(),
      review_count: z.number().nullable().optional(),
      phone: z.string().nullable().optional(),
      website_url: z.string().nullable().optional(),
      address_text: z.string().nullable().optional(),
      posts_signal: z
        .string()
        .nullable()
        .optional()
        .describe(
          'Tóm tắt bài đăng: có/không, ước lượng gần đây hay không'
        ),
      recent_posts: z
        .array(
          z.object({
            text: z.string(),
            approx_date: z.string().nullable().optional(),
          })
        )
        .nullable()
        .optional(),
      photos_signal: z.string().nullable().optional(),
      photos_count_est: z.number().nullable().optional(),
    })

    const extractResult = await stagehand.extract(
      `Bạn đang xem Google Maps / Google Business Profile công khai (có thể tiếng Việt hoặc Anh).
Đọc panel thông tin doanh nghiệp.
Lấy: tên, mô tả đầy đủ (About), danh mục, rating, số review, SĐT, website, địa chỉ.
Tìm phần Posts / Updates / Bài đăng nếu có — lấy tối đa ${GBP_SNAPSHOT_MAX_POSTS} bài (nội dung ngắn + ngày nếu có).
Đánh giá tình trạng ảnh (nhiều/ít/không rõ).
Không bịa. Trường không thấy thì null.`,
      schema
    )

    // v4 trả { data }, bản cũ có thể trả object thẳng
    const extracted = extractResult?.data ?? extractResult ?? {}

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
          ? `Thấy khoảng ${posts.length} bài trên listing`
          : 'Không thấy bài đăng công khai'),
      recent_posts: posts,
      photos_signal: extracted.photos_signal || null,
      photos_count_est: extracted.photos_count_est ?? null,
      raw: { source: 'browserbase_stagehand', extracted },
    }
  } finally {
    try {
      if (stagehand?.close) await stagehand.close()
    } catch {
      /* ignore */
    }
    try {
      if (browser?.close) await browser.close()
    } catch {
      /* ignore */
    }
  }
}

/**
 * Entry: Browser nếu có key, không thì Places.
 * Browser lỗi → fallback Places + ghi error.
 */
export async function runGbpPublicSnapshot(
  input: RunGbpSnapshotInput
): Promise<RunGbpSnapshotResult> {
  const url = buildSearchUrl(input)
  const hasBrowserbase = Boolean(process.env.BROWSERBASE_API_KEY)

  if (hasBrowserbase && url) {
    try {
      const browserResult = await fromBrowser(url)
      // Merge Places nếu browser thiếu rating
      if (
        browserResult.rating == null ||
        browserResult.review_count == null ||
        !browserResult.description
      ) {
        try {
          const places = await fromPlaces(input)
          return {
            ...places,
            ...browserResult,
            description:
              browserResult.description || places.description || null,
            rating: browserResult.rating ?? places.rating ?? null,
            review_count:
              browserResult.review_count ?? places.review_count ?? null,
            primary_category:
              browserResult.primary_category ||
              places.primary_category ||
              null,
            phone: browserResult.phone || places.phone || null,
            website_url:
              browserResult.website_url || places.website_url || null,
            address_text:
              browserResult.address_text || places.address_text || null,
            photos_signal:
              browserResult.photos_signal || places.photos_signal || null,
            photos_count_est:
              browserResult.photos_count_est ??
              places.photos_count_est ??
              null,
            posts_signal: browserResult.posts_signal || places.posts_signal,
            recent_posts:
              browserResult.recent_posts?.length
                ? browserResult.recent_posts
                : places.recent_posts || [],
            raw: {
              browser: browserResult.raw,
              places: places.raw,
            },
          }
        } catch {
          return browserResult
        }
      }
      return browserResult
    } catch (err: any) {
      const fb = await fromPlaces(input)
      return {
        ...fb,
        error: `Browser lỗi: ${err?.message || err}. Đã fallback Places.`,
      }
    }
  }

  try {
    return await fromPlaces(input)
  } catch (err: any) {
    return { error: err?.message || String(err) }
  }
}
