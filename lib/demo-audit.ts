export type DemoStatus = 'none' | 'buried' | 'unstable' | 'unknown'

export type DemoInput = {
  industry: string
  industryLabel?: string
  city: string
  status: DemoStatus | string
  business: string
  mapsUrl: string
  name: string
  phone: string
}

export type ScoreGroup = {
  key: string
  label: string
  score: number
}

export type DemoAudit = {
  businessName: string
  industryLabel: string
  area: string
  mapsUrl: string
  overall: number
  overallNote: string
  groups: ScoreGroup[]
  strengths: string[]
  weaknesses: { priority: 'high' | 'medium' | 'low'; text: string }[]
  actions: string[]
  difficulty: 'Cao' | 'Trung bình' | 'Thấp'
  lockedHints: { title: string; teaser: string }[]
  source?: string
  snapshot?: {
    rating?: number | null
    review_count?: number | null
    category?: string | null
    address?: string | null
    phone?: string | null
    photos_signal?: string | null
    posts_signal?: string | null
    place_id?: string | null
    maps_url?: string | null
  }
}

const INDUSTRY_LABEL: Record<string, string> = {
  fnb: 'Nhà hàng, quán ăn',
  spa: 'Spa, thẩm mỹ',
  health: 'Nha khoa, phòng khám',
  home: 'Nội thất, xây dựng',
  auto: 'Gara, ô tô',
  retail: 'Cửa hàng bán lẻ',
  edu: 'Trung tâm, lớp học',
  other: 'Dịch vụ local',
}

function clamp(n: number, min = 1, max = 9.2) {
  return Math.round(Math.min(max, Math.max(min, n)) * 10) / 10
}

function hash(s: string) {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return Math.abs(h)
}

export function buildDemoAudit(input: DemoInput): DemoAudit {
  const status = (input.status || 'unknown') as DemoStatus
  const industryLabel = input.industryLabel || INDUSTRY_LABEL[input.industry] || input.industry || 'Dịch vụ local'
  const businessName = input.business.trim() || `Cửa hàng ${industryLabel}`
  const area = input.city || 'khu vực của bạn'
  const seed = hash(`${businessName}|${area}|${status}|${input.industry}|${input.mapsUrl}`)
  const jitter = ((seed % 7) - 3) * 0.1

  const base = status === 'none' ? 2.6 : status === 'buried' ? 4.2 : status === 'unstable' ? 6.1 : 3.6
  const overall = clamp(base + jitter)

  const groups: ScoreGroup[] = [
    { key: 'basic', label: 'Thông tin cơ bản', score: clamp(overall + (status === 'none' ? -0.8 : status === 'unstable' ? 0.6 : 0.2)) },
    { key: 'complete', label: 'Mức độ hoàn thiện hồ sơ', score: clamp(overall - 0.4 + (input.mapsUrl ? 0.3 : -0.5)) },
    { key: 'media', label: 'Hình ảnh & Media', score: clamp(overall - 0.8) },
    { key: 'activity', label: 'Hoạt động & Tương tác', score: clamp(overall - (status === 'unstable' ? 0.2 : 1.1) + (input.mapsUrl ? 0.2 : 0)) },
    { key: 'risk', label: 'Dấu hiệu rủi ro / cảnh báo', score: clamp(status === 'none' ? 3.2 : 7.4 + jitter * 0.4, 2, 9) },
  ]

  const strengths =
    status === 'unstable'
      ? [
          `Đã có hồ sơ Google Maps gắn với ${area} — nền tảng để đo gọi / chỉ đường.`,
          'Tín hiệu không bằng 0: cửa hàng từng nhúc nhích hạng, vấn đề là giữ được.',
        ]
      : status === 'buried'
        ? [
            `Hồ sơ đã tồn tại trên bản đồ ${area}, khách có cửa để bấm nếu thấy bạn.`,
            input.mapsUrl
              ? 'Đã có link Maps — đủ để đối chiếu đúng hồ sơ, không nhầm cửa hàng.'
              : 'Bạn biết mình đang invisible — đó là điểm bắt đầu đúng.',
          ]
        : status === 'none'
          ? [
              'Chưa bị khóa / phạt hồ sơ vì chưa có gì để Google phạt.',
              `Ngành ${industryLabel} ở ${area} vẫn có cửa nếu làm đúng thứ tự.`,
            ]
          : [
              'Bạn chưa tự tin vào số liệu — tránh được việc tối ưu mù.',
              input.mapsUrl ? 'Có link Maps nên lần xem hồ sơ sau sẽ sát hơn.' : 'Chẩn đoán sơ bộ đủ để chọn 3 việc đầu.',
            ]

  const highByStatus: Record<DemoStatus, string[]> = {
    none: [
      `Chưa có hồ sơ Google Business gắn đúng ${area} — khách gõ gần tôi gần như không thấy tên bạn.`,
      'Thiếu NAP (tên – địa chỉ – SĐT) chuẩn, Google không biết cửa hàng để hiện nút gọi.',
    ],
    buried: [
      `Hồ sơ có nhưng tín hiệu gọi / chỉ đường yếu hơn đối thủ cùng ngành quanh ${area}.`,
      'Ảnh, bài đăng hoặc danh mục chưa đủ để vào Top 3 khi khách đứng gần cửa.',
    ],
    unstable: [
      'Hạng nhúc nhích rồi tụt — thiếu việc tuần cố định.',
      'Chưa đo gọi / chỉ đường theo tuần nên không biết việc nào đang ra khách.',
    ],
    unknown: [
      'Chưa đọc được hiện trạng hồ sơ nên không biết việc nào đáng làm trước.',
      'Dễ đổ tiền ads trong lúc Maps vẫn đang đưa khách sang cửa bên cạnh.',
    ],
  }

  const weaknesses = [
    { priority: 'high' as const, text: highByStatus[status]?.[0] || highByStatus.unknown[0] },
    { priority: 'high' as const, text: highByStatus[status]?.[1] || highByStatus.unknown[1] },
    {
      priority: 'medium' as const,
      text: input.mapsUrl
        ? 'Cần đối chiếu mô tả, danh mục, ảnh gần đây trên đúng link Maps — phần chi tiết nằm ở audit đầy đủ.'
        : 'Chưa có link Maps nên chưa đối chiếu được mô tả / ảnh / bài đăng thật.',
    },
    { priority: 'low' as const, text: 'Chưa so được lưới hạng 2 km — cần bản đầy đủ trong OS.' },
  ]

  const actions =
    status === 'none'
      ? [
          `Tạo hồ sơ Google Business đúng tên + địa chỉ ${area}, bật nút Gọi và Chỉ đường.`,
          'Thêm 10–15 ảnh thật tại cửa trong 7 ngày.',
          'Điền danh mục chính đúng ngành — đừng nhồi từ khóa vào tên.',
        ]
      : status === 'buried'
        ? [
            'Rà danh mục và mô tả: viết cho khách gần cửa, không viết brochure.',
            'Đăng 1 bài/tuần; trả lời hết đánh giá đang để trống.',
            'Bổ sung ảnh mới chụp 14 ngày gần đây.',
          ]
        : status === 'unstable'
          ? [
              'Chốt 3 việc tuần: 1 bài Maps, trả lời đánh giá, ảnh mới hoặc cập nhật giờ.',
              'Đo gọi điện + chỉ đường mỗi cuối tuần.',
              'Giữ NAP đồng nhất trên Facebook / website nếu có.',
            ]
          : [
              'Gửi đúng link Google Maps để đối chiếu hồ sơ.',
              'Chọn 1 việc ưu tiên Cao làm trong 7 ngày.',
              'Sau khi có hiện trạng, mới quyết tự làm hay vào gói SEO Maps.',
            ]

  const difficulty: DemoAudit['difficulty'] =
    status === 'unstable' || /Hồ Chí Minh|Hà Nội|Đà Nẵng/.test(area) ? 'Cao' : 'Trung bình'

  const overallNote =
    status === 'none'
      ? 'Google gần như chưa biết cửa hàng trên bản đồ.'
      : status === 'buried'
        ? 'Hồ sơ có, nhưng chưa đủ tín hiệu để khách bấm gọi / chỉ đường trước đối thủ.'
        : status === 'unstable'
          ? 'Nền đã có. Vấn đề là giữ hạng và đọc tín hiệu.'
          : 'Điểm sơ bộ theo tình trạng bạn chọn. Bản đầy đủ đối chiếu đúng hồ sơ Maps.'

  return {
    businessName,
    industryLabel,
    area,
    mapsUrl: input.mapsUrl,
    overall,
    overallNote,
    groups,
    strengths,
    weaknesses,
    actions,
    difficulty,
    lockedHints: [
      { title: 'Lộ trình 30 ngày', teaser: 'Tuần 1 ưu tiên Cao · Tuần 2 hồ sơ · Tuần 3 nội dung · Tuần 4 đo tín hiệu' },
      { title: 'Hạng quanh cửa · 2 km', teaser: 'Lưới ô theo từ khóa khách hay tìm.' },
      { title: 'Tín hiệu gọi / chỉ đường', teaser: 'Số liệu trước–sau theo chu kỳ. Demo không bịa số thật.' },
    ],
  }
}
