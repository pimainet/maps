import type { GbpSnapshotPayload } from '@/lib/gbp-snapshot-types'
import type { AuditAdvice } from './advice'

/**
 * Audit Engine — Types
 *
 * Nguyên tắc (theo đặc tả V1 đã chốt):
 *  - Rule Engine quyết "passed" chắc chắn dựa trên dữ liệu đã thu thập.
 *  - AI chỉ PHÂN LOẠI (vd "specificity: high"), không tự quyết điểm cuối.
 *  - Thiếu dữ liệu -> confidence: "insufficient", passed: null. KHÔNG bịa.
 *
 * QUAN TRỌNG: input của engine này bám sát đúng field THẬT mà
 * lib/gbp-snapshot.ts (Outscraper + Places) thu thập được hôm nay (GbpSnapshotPayload) +
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
  | 'website'
  | 'conversion'

export interface AIClassifyInput {
  system: string
  user: string
  /** Giới hạn token đầu ra (mặc định 1024). Không nằm trong khoá cache. */
  maxTokens?: number
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
    category?: string | null
    subcategories?: string[]
    /** Vị trí trong kết quả tìm (1 = đầu). Không có thì dùng thứ tự mảng. */
    rank?: number
    /** Place id (Outscraper) — để lấy thêm review của đối thủ (T07). */
    placeId?: string | null
  }>

  /**
   * Thứ hạng khi tìm "<danh mục> <khu vực>" (ước lượng, từ Outscraper — xem lib/competitors.ts).
   * undefined = chưa lấy được (thiếu danh mục/khu vực hoặc chưa cấu hình Outscraper).
   */
  visibility?: {
    query: string
    /** 1-based; null = không nằm trong `total` kết quả đầu. */
    selfRank: number | null
    total: number
  }

  /**
   * Lưới thứ hạng (lần quét ≤ 14 ngày, xem lib/rankgrid/audit-input.ts). undefined = tính năng tắt / chưa quét
   * -> VY02/VY04 trả insufficient như cũ.
   */
  rankGrid?: RankGridAuditInput

  /** Tốc độ review mới của các đối thủ đứng đầu (T07). */
  competitorVelocity?: CompetitorVelocity

  /** Tín hiệu địa phương của website (W01–W04). undefined = chưa lấy (không có website / lỗi) -> "chưa đủ dữ liệu". */
  website?: WebsiteSignals

  now?: Date
}

export interface RankGridAuditInput {
  scannedAt: string
  /** 'scan' = lần quét lưới thứ hạng của khách; 'audit_mini' = lưới mini 5×5, 1 từ khoá chạy kèm audit. */
  source?: 'scan' | 'audit_mini'
  primary: {
    keyword: string
    /** % điểm lưới trong top 3. */
    solv: number | null
    atrp: number | null
    arp: number | null
    foundPct: number | null
    centerRank: number | null
    points: number
    weakSector?: { label: string; solv: number } | null
    leader?: { title: string; solv: number; reviews: number | null } | null
  }
  keywords: Array<{ keyword: string; solv: number | null; foundPct: number | null }>
}

/**
 * Tín hiệu địa phương của website (lấy bởi lib/website-signals.ts: GET an toàn, tôn trọng robots.txt, cache 7 ngày).
 * Các trường boolean | null: null = không so được (vd hồ sơ không có số điện thoại) — check tương ứng "chưa đủ dữ liệu".
 */
export interface WebsiteSignals {
  fetchedAt: string
  url: string
  finalUrl?: string
  status: 'ok' | 'robots_disallowed' | 'robots_error' | 'unreachable' | 'unsafe' | 'not_html' | 'http_error' | 'social'
  /** Chi tiết khi không ok (mã HTTP, lý do), để hiện cho người dùng. */
  detail?: string
  https?: boolean
  hasViewport?: boolean
  title?: string | null
  h1?: string[]
  schemaTypes?: string[]
  localBusinessSchema?: boolean
  /** Số điện thoại hồ sơ có trên trang (tel:, văn bản, schema). */
  phoneOnPage?: boolean | null
  /** Địa chỉ hồ sơ (số nhà + tên đường) có trên trang hoặc trong schema. */
  addressOnPage?: boolean | null
  /** Tên doanh nghiệp có trên trang. */
  nameOnPage?: boolean | null
  /** Quận/huyện, tỉnh/thành của hồ sơ có trong title hoặc H1. */
  cityInTitleOrH1?: boolean | null
  /** Các tên địa danh đã dùng để so (đã chuẩn hoá hiển thị). */
  placeTerms?: string[]
  /** Dấu vân tay NAP hồ sơ dùng khi so — đổi thì không dùng lại cache. */
  profileKey?: string
}

/** Tốc độ review mới của 1 đối thủ (90 ngày gần nhất, tối đa `limit` review/quán). */
export interface CompetitorVelocityItem {
  name: string
  placeId: string
  newestAgeDays: number | null
  last30: number
  last90: number
  /** Chạm giới hạn số review lấy về: last90 là cận dưới. */
  capped: boolean
}
export interface CompetitorVelocity {
  fetchedAt: string
  limit: number
  items: CompetitorVelocityItem[]
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
  /**
   * false = chỉ là INSIGHT để hiển thị, KHÔNG tính vào điểm / độ phủ / so sánh giữa 2 lần audit
   * (vd T06: AI đọc review, kết luận bằng văn bản tự do nên không phù hợp làm tiêu chí đạt/không đạt).
   * Mặc định (undefined) = có tính điểm.
   */
  scored?: boolean
  /**
   * true = check dựa trên dữ liệu thu thập KHÔNG ỔN ĐỊNH giữa các lần (bài đăng mẫu, số ảnh do AI ước tính,
   * tỉ lệ phản hồi review từ nguồn thứ ba...). Chuyển đạt -> không đạt ở loại check này chưa được coi là
   * "xấu đi" cho tới khi lần sau xác nhận lại (xem diff.ts).
   */
  volatile?: boolean
}

export interface TierScore {
  group: CheckGroup
  score: number | null
  checkedCount: number
  insufficientCount: number
  /** Tổng trọng số các check tính điểm của nhóm (scoring v3; báo cáo cũ không có). */
  weight?: number
  /** Phần trọng số của nhóm có dữ liệu. */
  knownWeight?: number
}

/** Cách tính điểm minh bạch (scoring v3) — xem scoring.ts weightingOf. */
export interface AuditWeighting {
  scoringVersion: number
  /** Tổng trọng số các check tính điểm có trong báo cáo. */
  totalWeight: number
  /** Phần trọng số có dữ liệu (đã kết luận đạt/chưa đạt). */
  knownWeight: number
  /** knownWeight / totalWeight, %. Dưới minCoveragePct thì không chấm điểm tổng. */
  coveragePct: number
  minCoveragePct: number
  /** Trọng số gốc và trọng số thực tế (sau khi loại mục thiếu dữ liệu) của từng check, %. */
  checks: Array<{ id: string; weight: number; effectivePct: number }>
}

export interface Opportunity {
  checkId: string
  label: string
  severity: Severity
  confidence: Confidence
  action: string
}

export interface AuditCoverage {
  /** Số check có kết luận và được tính điểm. */
  scored: number
  /** Số check chưa đủ dữ liệu để kết luận. */
  insufficient: number
  /** Số check chỉ hiển thị (không tính điểm). */
  informational: number
  /** Tổng số check engine đã chạy. */
  total: number
}

export interface AuditReport {
  checks: CheckResult[]
  tierScores: TierScore[]
  overallScore: number | null
  topOpportunities: Opportunity[]
  generatedAt: string
  /**
   * Phiên bản logic chấm điểm. Chỉ so sánh điểm giữa các lần audit CÙNG major version
   * (đổi tập check / ngưỡng / trọng số thì thang đo đã khác). Báo cáo cũ không có trường này.
   */
  engineVersion?: string
  /**
   * Phiên bản cách tính điểm (trọng số). Báo cáo không có trường này = cách tính cũ (v2: chia đều nhóm). Chỉ so sánh điểm
   * giữa 2 lần audit cùng scoringVersion (xem diff.ts).
   */
  scoringVersion?: number
  /** Trọng số từng check + độ phủ trọng số (scoring v3). */
  weighting?: AuditWeighting
  coverage?: AuditCoverage
  /**
   * Lời khuyên danh mục + hồ sơ doanh nghiệp (xem advice.ts). KHÔNG tham gia chấm điểm hay so sánh giữa hai lần audit;
   * báo cáo cũ và chế độ shadow không có trường này.
   */
  advice?: AuditAdvice
}

/** Tăng PATCH khi sửa lỗi không đổi thang điểm; tăng MAJOR khi đổi check/ngưỡng/trọng số (điểm không còn so sánh được). */
export const ENGINE_VERSION = '3.0.0'
export const engineMajor = (v: string | undefined | null): string | null => (v ? v.split('.')[0] : null)
