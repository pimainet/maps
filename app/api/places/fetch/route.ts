import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { gbp_link, name, area } = body

    const apiKey = process.env.GOOGLE_PLACES_API_KEY

    if (!apiKey) {
      return NextResponse.json(
        { error: 'Chưa cấu hình GOOGLE_PLACES_API_KEY' },
        { status: 500 }
      )
    }

    // Tạo câu tìm kiếm
    let textQuery = ''
    if (name && area) {
      textQuery = `${name} ${area}`
    } else if (name) {
      textQuery = name
    } else if (gbp_link) {
      textQuery = gbp_link
    } else {
      return NextResponse.json(
        { error: 'Vui lòng nhập Tên doanh nghiệp hoặc Link Google Maps' },
        { status: 400 }
      )
    }

    // Bước 1: Tìm Place ID
    const searchResponse = await fetch(
      'https://places.googleapis.com/v1/places:searchText',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress',
        },
        body: JSON.stringify({
          textQuery: textQuery,
          languageCode: 'vi',
        }),
      }
    )

    const searchData = await searchResponse.json()

    if (!searchData.places || searchData.places.length === 0) {
      return NextResponse.json(
        { error: 'Không tìm thấy địa điểm phù hợp trên Google Maps' },
        { status: 404 }
      )
    }

    const placeId = searchData.places[0].id

    // Bước 2: Lấy thông tin chi tiết
    const detailsResponse = await fetch(
      `https://places.googleapis.com/v1/places/${placeId}`,
      {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask':
            'id,displayName,formattedAddress,nationalPhoneNumber,internationalPhoneNumber,websiteUri,googleMapsUri,rating,userRatingCount,regularOpeningHours,types,primaryType,primaryTypeDisplayName,editorialSummary,photos,businessStatus',
        },
      }
    )

    if (!detailsResponse.ok) {
      return NextResponse.json(
        { error: 'Không lấy được thông tin chi tiết từ Google' },
        { status: 500 }
      )
    }

    const place = await detailsResponse.json()

    // Đưa về dạng dễ dùng
    const result = {
      place_id: place.id,
      name: place.displayName?.text || '',
      phone: place.nationalPhoneNumber || place.internationalPhoneNumber || '',
      website_url: place.websiteUri || '',
      gbp_link: place.googleMapsUri || gbp_link || '',
      area: place.formattedAddress || '',
      industry: place.primaryTypeDisplayName?.text || place.primaryType || '',
      rating: place.rating || null,
      review_count: place.userRatingCount || null,
      description: place.editorialSummary?.text || '',
      photos_count: place.photos?.length || 0,
    }

    return NextResponse.json(result)
  } catch (error: any) {
    console.error(error)
    return NextResponse.json(
      { error: error.message || 'Có lỗi xảy ra khi gọi Google Places API' },
      { status: 500 }
    )
  }
}