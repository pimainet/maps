import type { GbpSnapshotPayload } from '@/lib/gbp-snapshot-types'

/**
 * Audit Engine — Types
 *
 * Nguyên tắc (theo đặc tả V1 đã chốt):
 *  - Rule Engine quyết "passed" chắc chắn dựa trên dữ liệu đã thu thập.
 *  - AI chỉ PHÂN LOẠI (vd "specificity: high"), không tự quyết điểm cuối.
 *  - Thiếu dữ liệu -> confidence: "insufficient", passed: null. KHÔNG bịa.
 *
 * QUAN TRỌNG: input của engine này bám sát đúng field THẬT mà
 * gbp-browser-snapshot.ts thu thập được hôm nay (GbpSnapshotPayload) +
 * một vài field caller tự cung cấp thêm (tên khách khai, ngành khách khai,
 * lịch sử snapshot từ bảng gbp_snapshots...). Những field framework gốc
 * cần nhưng HỆ THỐNG CHƯA THU THẬP (services, attributes, review text,
 * ảnh thật, competitor, keyword ranking) được giữ optional — khi thiếu,
 * check tương ứng trả "insufficient" thay vì suy diễn.
 */

export type Confidence = 'verified' | 'estimated' | 'insufficient'
export type Severity = 'critical' | 'high' | 'medium' | 'low'
export type CheckGroup =
  | 'foundation'
  | 'relevance'
  | 'trust'
  | 'visual'
  | 'content'
  | 'visibility'
  | 'conversion'

export interface AIClassifyInput {
  system: string
  user: string
}

export interface AIClassifier {
  classify<T>(input: AIClassifyInput): Promise<T>
}

/**
 * Input của Audit Engine = snapshot thật (GbpSnapshotPayload) + vài field
 * caller cung cấp thêm, KHÔNG field nào do engine tự đi lấy.
 */
export interface AuditInput {
  snapshot: GbpSnapshotPayload

  /** Tên khách tự khai lúc tạo client — đối chiếu F03 với business_name thật trên Maps. */
  claimedBusinessName?: string
  /** Ngành khách tự khai/chọn — đối chiếu R01 với primary_category thật. */
  declaredIndustry?: string

  /**
   * Kết quả fetch thử website_url — CALLER tự chạy (vd gọi `checkWebsiteReachable`
   * export ở file riêng) và truyền vào, engine không tự ý gọi network để giữ
   * hàm audit thuần/dễ test. undefined = chưa kiểm tra.
   */
  websiteReachable?: boolean

  /**
   * Lịch sử review_count theo thời gian — lấy từ bảng `gbp_snapshots` của
   * cùng client_id (query ngoài engine, truyền vào). Cần ≥2 điểm mới tính
   * được Review Velocity (T04), không suy diễn từ 1 lần đo.
   */
  reviewCountHistory?: Array<{ capturedAt: string; reviewCount: number }>

  /**
   * Dữ liệu đối thủ — cột `competitors` trong bảng gbp_snapshots ĐÃ TỒN TẠI
   * trong schema nhưng CHƯA có collector nào ghi vào (kiểm tra lại trước khi
   * dùng). Để trống cho tới khi có nguồn thật.
   */
  competitors?: Array<{
    name: string
    reviewCount?: number
    rating?: number
    photoCountEst?: number
  }>

  now?: Date
}

export interface CheckResult {
  id: string
  group: CheckGroup
  label: string
  severity: Severity
  confidence: Confidence
  passed: boolean | null
  message: string
  action?: string
}

export interface TierScore {
  group: CheckGroup
  score: number | null
  checkedCount: number
  insufficientCount: number
}

export interface Opportunity {
  checkId: string
  label: string
  severity: Severity
  confidence: Confidence
  action: string
}

export interface AuditReport {
  checks: CheckResult[]
  tierScores: TierScore[]
  overallScore: number | null
  topOpportunities: Opportunity[]
  generatedAt: string
}
