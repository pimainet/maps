import { AUDIT_PROMPT } from '@/lib/prompts'
import { snapshotToAuditFields } from '@/lib/gbp-audit-fields'

export type AuditPromptInput = {
  /** Snapshot lấy từ Outscraper/Places (dòng gbp_snapshots hoặc payload). */
  snapshot: any
  /** Thông tin khách khai báo — ưu tiên hơn dữ liệu Maps cho ngành/khu vực. */
  declared: { name?: string | null; industry?: string | null; area?: string | null; gbp_link?: string | null }
  progressContext: string
  outputLanguage?: string
  /** Ghi chú thêm của người dùng (những điều Maps không cho thấy). */
  note?: string
}

/** Dựng prompt audit từ dữ liệu đã lấy — dùng chung cho audit khách hàng và demo công khai. */
export function buildAuditPrompt(input: AuditPromptInput): string {
  const { snapshot: s, declared: d } = input
  const f = snapshotToAuditFields(s)
  const additionalInfo = [input.note?.trim(), f.additional_info].filter(Boolean).join('\n\n')

  const values: Record<string, string> = {
    output_language: input.outputLanguage?.trim() || 'Tiếng Việt',
    business_name: s?.business_name || d.name || '',
    industry: d.industry || f.primary_category,
    area: d.area || s?.address_text || '',
    gbp_link: s?.maps_url || d.gbp_link || '',
    description: f.description,
    primary_category: f.primary_category || d.industry || '',
    additional_categories: f.additional_categories,
    review_count: f.review_count,
    rating: f.rating,
    recent_posts: f.recent_posts,
    photos_status: f.photos_status,
    additional_info: additionalInfo,
    progress_context: input.progressContext,
  }

  // Một lượt thay duy nhất: giá trị chứa "{{...}}" (vd review của khách trên Maps) không bị thay lần nữa.
  return AUDIT_PROMPT.replace(/\{\{(\w+)\}\}/g, (match, key: string) => (key in values ? values[key] : match))
}
