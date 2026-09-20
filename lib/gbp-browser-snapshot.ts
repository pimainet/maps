/**
 * Quan sát GBP public — Browserbase mở trang + Claude trích xuất.
 * Ổn định hơn Stagehand.extract trên Google Maps.
 *
 * Env:
 *   BROWSERBASE_API_KEY (bắt buộc cho browser)
 *   BROWSERBASE_PROJECT_ID (nếu có)
 *   ANTHROPIC_API_KEY (Claude — đã có)
 *   GOOGLE_PLACES_API_KEY (fallback)
 *
 * Đặt vào: lib/gbp-browser-snapshot.ts
 */

import type { GbpSnapshotPayload, GbpPostItem } from '@/lib/gbp-snapshot-types'
import { GBP_SNAPSHOT_MAX_POSTS } from '@/lib/gbp-snapshot-types'
import { askClaude } from '@/lib/claude'

export type RunGbpSnapshotInput = {
  mapsUrl?: string
  businessName?: string
  area?: string
  placeId?: string | null
}

export type RunGbpSnapshotResult = GbpSnapshotPayload & {
  error?: string
  raw?: unknown
  source_used?: 'browser' | 'places' | 'browser+places'
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
      error: 'Chưa cấu hình GOOGLE_PLACES_API_KEY',
      source_used: 'places',
    }
  }

  let placeId = input.placeId
    ? String(input.placeId).replace(/^places\//, '')
    : null

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
    if (!placeId) {
      return { error: 'Places: không tìm thấy địa điểm', source_used: 'places' }
    }
  }

  const idForUrl = placeId.startsWith('places/') ? placeId : `places/${placeId}`
  const detailsRes = await fetch(`https://places.googleapis.com/v1/${idForUrl}`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask':
        'id,displayName,formattedAddress,nationalPhoneNumber,websiteUri,googleMapsUri,rating,userRatingCount,primaryTypeDisplayName,primaryType,types,regularOpeningHours,currentOpeningHours,editorialSummary,photos',
    },
  })
  const place = await detailsRes.json()
  if (!detailsRes.ok) {
    return {
      error: `Places details: ${place?.error?.message || detailsRes.status}`,
      source_used: 'places',
      raw: place,
    }
  }

  const photosCount = Array.isArray(place.photos) ? place.photos.length : 0
  const typeLabels = Array.isArray(place.types)
    ? place.types
        .map((t: string) => String(t || '').replace(/_/g, ' '))
        .filter((t: string) => t && t !== 'point of interest' && t !== 'establishment')
    : []
  const hoursLines: string[] = place.regularOpeningHours?.weekdayDescriptions ||
    place.currentOpeningHours?.weekdayDescriptions ||
    []

  return {
    place_id: place.id || placeId,
    maps_url: place.googleMapsUri || input.mapsUrl || buildSearchUrl(input),
    business_name: place.displayName?.text || input.businessName || null,
    description: place.editorialSummary?.text || null,
    primary_category: place.primaryTypeDisplayName?.text || place.primaryType || null,
    additional_categories: typeLabels.length ? typeLabels.join(', ') : null,
    opening_hours: hoursLines.length ? hoursLines.join(' | ') : null,
    rating: place.rating ?? null,
    review_count: place.userRatingCount ?? null,
    phone: place.nationalPhoneNumber || null,
    website_url: place.websiteUri || null,
    address_text: place.formattedAddress || null,
    posts_signal:
      'Chưa quan sát được bài đăng (Places). Cần Browserbase.',
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
    source_used: 'places',
    raw: { source: 'places', place },
  }
}

/** Lấy text hiển thị từ trang Maps qua Browserbase + Playwright CDP */
async function fetchMapsPageText(url: string): Promise<{ text: string; finalUrl: string }> {
  const apiKey = process.env.BROWSERBASE_API_KEY
  if (!apiKey) throw new Error('Thiếu BROWSERBASE_API_KEY')

  const projectId = process.env.BROWSERBASE_PROJECT_ID

  // Tạo session Browserbase
  const createRes = await fetch('https://api.browserbase.com/v1/sessions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-BB-API-Key': apiKey,
    },
    body: JSON.stringify({
      ...(projectId ? { projectId } : {}),
      browserSettings: {
        viewport: { width: 1280, height: 900 },
      },
    }),
  })
  const session = await createRes.json()
  if (!createRes.ok) {
    throw new Error(
      `Browserbase session: ${session?.message || session?.error || createRes.status}`
    )
  }

  const sessionId = session.id
  const connectUrl = session.connectUrl || session.connect_url

  try {
    const { chromium } = await import('playwright-core')
    const browser = await chromium.connectOverCDP(connectUrl)
    const context = browser.contexts()[0] || (await browser.newContext())
    const page = context.pages()[0] || (await context.newPage())

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
    await page.waitForTimeout(5000)

    // Thử cuộn panel / mở tab nếu có
    try {
      await page.evaluate(() => {
        window.scrollBy(0, 400)
      })
      await page.waitForTimeout(1500)
    } catch {
      /* ignore */
    }

    const text = await page.evaluate(() => {
      const root = document.body
      return (root?.innerText || '').slice(0, 25000)
    })
    const finalUrl = page.url()

    await browser.close()
    return { text, finalUrl }
  } finally {
    // Đóng session Browserbase
    try {
      await fetch(`https://api.browserbase.com/v1/sessions/${sessionId}`, {
        method: 'DELETE',
        headers: { 'X-BB-API-Key': apiKey },
      })
    } catch {
      /* ignore */
    }
  }
}

function parseJsonLoose(raw: string): any {
  const cleaned = raw
    .trim()
    .replace(/^```json/i, '')
    .replace(/^```/, '')
    .replace(/```$/, '')
    .trim()
  return JSON.parse(cleaned)
}

async function extractWithClaude(
  pageText: string,
  businessName?: string
): Promise<Partial<GbpSnapshotPayload>> {
  const prompt = `Bạn đọc đoạn text chụp từ trang Google Maps / Google Business Profile công khai.
Doanh nghiệp cần tìm: ${businessName || '(xem trong text)'}

Trích xuất JSON ĐÚNG schema sau (không markdown, không giải thích):
{
  "business_name": string|null,
  "description": string|null,
  "primary_category": string|null,
  "rating": number|null,
  "review_count": number|null,
  "phone": string|null,
  "website_url": string|null,
  "address_text": string|null,
  "posts_signal": string|null,
  "recent_posts": [{"text": string, "approx_date": string|null}],
  "photos_signal": string|null,
  "photos_count_est": number|null
}

Quy tắc:
- description = phần mô tả / About của doanh nghiệp (không lấy review của khách).
- recent_posts: tối đa ${GBP_SNAPSHOT_MAX_POSTS} bài đăng/updates của doanh nghiệp nếu thấy; không thấy thì [].
- posts_signal: 1 câu tóm tắt tình trạng đăng bài (có/không, gần đây hay không).
- photos_signal: nhiều/ít/không rõ.
- Không bịa. Không thấy thì null hoặc [].

TEXT TRANG:
---
${pageText.slice(0, 18000)}
---`

  const raw = await askClaude(prompt, { maxTokens: 2000, temperature: 0.2 })
  try {
    return parseJsonLoose(raw)
  } catch {
    return {}
  }
}

async function fromBrowser(input: RunGbpSnapshotInput): Promise<RunGbpSnapshotResult> {
  const url = buildSearchUrl(input)
  if (!url) {
    return { error: 'Không tạo được URL Maps', source_used: 'browser' }
  }

  const { text, finalUrl } = await fetchMapsPageText(url)
  if (!text || text.length < 80) {
    return {
      error: 'Trang Maps trả về ít text (có thể bị chặn hoặc chưa load)',
      source_used: 'browser',
      raw: { finalUrl, textLen: text?.length || 0 },
    }
  }

  const extracted = await extractWithClaude(text, input.businessName)

  const posts: GbpPostItem[] = Array.isArray(extracted.recent_posts)
    ? extracted.recent_posts
        .filter((p: any) => p?.text)
        .slice(0, GBP_SNAPSHOT_MAX_POSTS)
        .map((p: any) => ({
          text: String(p.text).slice(0, 500),
          approx_date: p.approx_date || null,
        }))
    : []

  return {
    maps_url: finalUrl || url,
    business_name: extracted.business_name || input.businessName || null,
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
        : 'Không thấy bài đăng công khai trên trang'),
    recent_posts: posts,
    photos_signal: extracted.photos_signal || null,
    photos_count_est: extracted.photos_count_est ?? null,
    source_used: 'browser',
    raw: {
      source: 'browserbase_playwright_claude',
      finalUrl,
      textLen: text.length,
      extracted,
    },
  }
}

export async function runGbpPublicSnapshot(
  input: RunGbpSnapshotInput
): Promise<RunGbpSnapshotResult> {
  const hasBrowserbase = Boolean(process.env.BROWSERBASE_API_KEY)

  if (hasBrowserbase) {
    try {
      const browserResult = await fromBrowser(input)
      // Bổ sung Places nếu thiếu rating/review
      try {
        const places = await fromPlaces(input)
        return {
          ...places,
          ...browserResult,
          description: browserResult.description || places.description || null,
          rating: browserResult.rating ?? places.rating ?? null,
          review_count: browserResult.review_count ?? places.review_count ?? null,
          primary_category:
            browserResult.primary_category || places.primary_category || null,
          additional_categories:
            browserResult.additional_categories || places.additional_categories || null,
          opening_hours: browserResult.opening_hours || places.opening_hours || null,
          phone: browserResult.phone || places.phone || null,
          website_url: browserResult.website_url || places.website_url || null,
          address_text: browserResult.address_text || places.address_text || null,
          photos_signal:
            browserResult.photos_signal || places.photos_signal || null,
          photos_count_est:
            browserResult.photos_count_est ?? places.photos_count_est ?? null,
          posts_signal: browserResult.posts_signal || places.posts_signal,
          recent_posts:
            browserResult.recent_posts?.length
              ? browserResult.recent_posts
              : places.recent_posts || [],
          source_used: 'browser+places',
          error: browserResult.error,
          raw: { browser: browserResult.raw, places: places.raw },
        }
      } catch {
        return browserResult
      }
    } catch (err: any) {
      const fb = await fromPlaces(input)
      return {
        ...fb,
        error: `Browser lỗi: ${err?.message || err}. Đã fallback Places.`,
        source_used: 'places',
      }
    }
  }

  return fromPlaces(input)
}
