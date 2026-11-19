// Kiểu dữ liệu kết quả audit dùng chung (parse từ AI + hiển thị trang audit).
export type ScoreGroup = {
  key: string
  label: string
  score: number
}

export type AuditResult = {
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
