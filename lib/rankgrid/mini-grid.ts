/**
 * Lưới thứ hạng mini 5×5, 1 từ khoá, chạy kèm audit khi khách chưa có lần quét lưới ≤ 14 ngày — để VY04 (phủ quanh quán,
 * trọng số 10) có dữ liệu thay vì "chưa đủ dữ liệu". Dùng lại mã lưới thứ hạng (DataForSEO live, buildGrid, computeMetrics).
 *
 * Bật bằng AUDIT_MINI_GRID_ENABLED=true + DATAFORSEO_LOGIN/DATAFORSEO_PASSWORD. Tắt / thiếu khoá / thiếu toạ độ / hết hạn mức
 * / lỗi => trả undefined kèm lý do, VY04 giữ "chưa đủ dữ liệu".
 *
 * Chốt chi phí:
 *  - 25 điểm × $0,002 (live) = $0,05 ≈ 1.300đ mỗi lần không có cache; cache 14 ngày (cùng từ khoá + toạ độ + quán).
 *  - Hạn mức mỗi workspace: AUDIT_MINI_GRID_WORKSPACE_POINTS điểm/tháng (mặc định 125 = 5 lưới), giữ chỗ nguyên tử qua
 *    RPC audit_minigrid_reserve (migration 034), tách khỏi hạn mức lưới của gói.
 *  - Trần ngân sách hệ thống RANKGRID_MONTHLY_BUDGET_USD (chung với lưới thứ hạng).
 */
import type { RankGridAuditInput } from '@/lib/audit-engine/types'
import { buildGrid, centerIndex, suggestSpacingM, type GridPoint } from './geometry'
import { computeMetrics, computePlaceMetrics, weakestSector } from './metrics'
import { findTargetRank, type ParsedTask } from './parse'
import { suggestKeywords } from './keywords'
import type { MapsQuery } from './dataforseo'

export const MINI_GRID_SIZE = 5 as const
export const MINI_GRID_CACHE_DAYS = 14
export const MINI_GRID_COST_PER_POINT_USD = 0.002 // DataForSEO live/advanced
const CONCURRENCY = 5
const MIN_OK_POINTS = 20

export function miniGridWorkspacePoints(): number {
  const n = Number.parseInt(process.env.AUDIT_MINI_GRID_WORKSPACE_POINTS ?? '', 10)
  return Number.isFinite(n) && n >= 0 ? n : 125
}

export interface MiniGridDeps {
  enabled: () => boolean
  loadContext: (clientId: string, workspaceId: string) => Promise<{
    lat: number | null
    lng: number | null
    placeId: string | null
    cid: string | null
    keyword: string | null
    zoom?: number | null
    spacingM?: number | null
  }>
  resolveIdentity?: () => Promise<{ lat: number | null; lng: number | null; placeId: string | null; cid: string | null }>
  readCache: (key: string) => Promise<RankGridAuditInput | null>
  writeCache: (key: string, value: RankGridAuditInput) => Promise<void>
  globalSpendUsd: () => Promise<number>
  monthlyBudgetUsd: () => number
  reserve: (points: number, limit: number, costUsd: number) => Promise<boolean>
  release: (points: number, costUsd: number) => Promise<void>
  query: (q: MapsQuery) => Promise<ParsedTask>
  now?: () => Date
}

export type MiniGridResult = { input: RankGridAuditInput | undefined; from: 'cache' | 'live' | 'none'; note?: string; costUsd: number }

const validLatLng = (lat: number | null, lng: number | null) =>
  lat != null && lng != null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0)

export function miniGridCacheKey(keyword: string, lat: number, lng: number, placeId: string | null, cid: string | null): string {
  return [keyword.trim().toLowerCase(), lat.toFixed(4), lng.toFixed(4), placeId || '', cid || ''].join('|')
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let i = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++
        out[idx] = await fn(items[idx])
      }
    }),
  )
  return out
}

/** Hàm thuần: kết quả từng điểm -> RankGridAuditInput. */
export function summariseMiniGrid(
  keyword: string,
  points: GridPoint[],
  results: Array<ParsedTask | null>,
  target: { placeId: string | null; cid: string | null },
  scannedAt: string,
): RankGridAuditInput | null {
  const ok: Array<{ p: GridPoint; rank: number | null; keys: string[]; titles: Map<string, { title: string | null; reviews: number | null }> }> = []
  results.forEach((r, i) => {
    if (!r || !r.ok) return
    const titles = new Map<string, { title: string | null; reviews: number | null }>()
    for (const pl of r.places) titles.set(pl.placeKey, { title: pl.title, reviews: pl.reviewsCount })
    ok.push({ p: points[i], rank: findTargetRank(r.places, target), keys: r.places.map((pl) => pl.placeKey), titles })
  })
  if (ok.length < MIN_OK_POINTS) return null
  const m = computeMetrics(ok.map((x) => ({ rank: x.rank })))
  const center = ok.find((x) => x.p.idx === centerIndex(MINI_GRID_SIZE))
  const weak = weakestSector(ok.map((x) => ({ rank: x.rank, dxM: x.p.dxM, dyM: x.p.dyM })))
  const targetKeys = new Set(ok.flatMap((x) => x.keys.filter((_, i) => x.rank === i + 1)))
  const leaderM = computePlaceMetrics(ok.map((x) => x.keys)).find((pm) => !targetKeys.has(pm.placeKey))
  let leader: { title: string; solv: number; reviews: number | null } | null = null
  if (leaderM) {
    const info = ok.map((x) => x.titles.get(leaderM.placeKey)).find(Boolean)
    if (info?.title) leader = { title: info.title, solv: leaderM.solv, reviews: info.reviews }
  }
  return {
    scannedAt,
    source: 'audit_mini',
    primary: {
      keyword,
      solv: m.solv,
      atrp: m.atrp,
      arp: m.arp,
      foundPct: m.foundPct,
      centerRank: center ? center.rank : null,
      points: ok.length,
      weakSector: weak ? { label: weak.label, solv: weak.solv } : null,
      leader,
    },
    keywords: [{ keyword, solv: m.solv, foundPct: m.foundPct }],
  }
}

export async function runMiniGrid(
  args: { clientId: string; workspaceId: string; primaryCategory?: string | null; additionalCategories?: string | null; industry?: string | null; area?: string | null; snapshotPlaceId?: string | null },
  deps: MiniGridDeps,
): Promise<MiniGridResult> {
  const none = (note: string): MiniGridResult => ({ input: undefined, from: 'none', note, costUsd: 0 })
  if (!deps.enabled()) return none('Lưới mini đang tắt (AUDIT_MINI_GRID_ENABLED) hoặc chưa cấu hình DataForSEO')
  const now = deps.now?.() ?? new Date()

  const ctx = await deps.loadContext(args.clientId, args.workspaceId)
  let { lat, lng } = ctx
  let placeId = ctx.placeId || args.snapshotPlaceId || null
  let cid = ctx.cid
  if ((!validLatLng(lat, lng) || (!placeId && !cid)) && deps.resolveIdentity) {
    const id = await deps.resolveIdentity().catch(() => null)
    if (id) {
      if (!validLatLng(lat, lng)) ((lat = id.lat), (lng = id.lng))
      placeId = placeId || id.placeId
      cid = cid || id.cid
    }
  }
  if (!validLatLng(lat, lng)) return none('Chưa có toạ độ của quán để dựng lưới')
  if (!placeId && !cid) return none('Chưa xác định được place_id/CID của quán')
  const keyword =
    ctx.keyword ||
    suggestKeywords({ primaryCategory: args.primaryCategory, additionalCategories: args.additionalCategories, industry: args.industry, area: args.area, limit: 1 })[0] ||
    null
  if (!keyword) return none('Chưa có từ khoá (danh mục chính) để quét')

  const key = miniGridCacheKey(keyword, lat!, lng!, placeId, cid)
  const cached = await deps.readCache(key).catch(() => null)
  if (cached) return { input: cached, from: 'cache', costUsd: 0 }

  const spacingM = ctx.spacingM || suggestSpacingM(args.industry, args.area)
  const pts = buildGrid({ centerLat: lat!, centerLng: lng!, size: MINI_GRID_SIZE, spacingM, shape: 'square' })
  const cost = pts.length * MINI_GRID_COST_PER_POINT_USD

  const spent = await deps.globalSpendUsd().catch(() => Number.POSITIVE_INFINITY)
  if (spent + cost > deps.monthlyBudgetUsd()) return none('Hệ thống đã chạm trần ngân sách quét tháng này')
  let reserved = false
  try {
    reserved = await deps.reserve(pts.length, miniGridWorkspacePoints(), cost)
  } catch {
    reserved = false
  }
  if (!reserved) return none(`Workspace đã dùng hết hạn mức lưới mini tháng này (${miniGridWorkspacePoints()} điểm) hoặc chưa áp migration 034`)

  const results = await mapLimit(pts, CONCURRENCY, (p) =>
    deps
      .query({ keyword, lat: p.lat, lng: p.lng, zoom: ctx.zoom || 15, device: 'mobile', languageCode: 'vi' })
      .catch((e: any): ParsedTask => ({ ok: false, error: String(e?.message || e), retryable: true })),
  )
  const failed = results.filter((r) => !r.ok).length
  // DataForSEO không tính tiền task lỗi -> trả lại phần hạn mức của điểm lỗi.
  if (failed > 0) await deps.release(failed, failed * MINI_GRID_COST_PER_POINT_USD).catch(() => undefined)
  const spentUsd = (pts.length - failed) * MINI_GRID_COST_PER_POINT_USD

  const input = summariseMiniGrid(keyword, pts, results, { placeId, cid }, now.toISOString())
  if (!input) return { input: undefined, from: 'none', note: `Lưới mini lỗi ${failed}/${pts.length} điểm`, costUsd: spentUsd }
  await deps.writeCache(key, input).catch(() => undefined)
  return { input, from: 'live', costUsd: spentUsd }
}

/** Phụ thuộc thật (Supabase service role + DataForSEO). */
export async function defaultMiniGridDeps(clientId: string, workspaceId: string, client: { name?: string | null; area?: string | null }): Promise<MiniGridDeps> {
  const [{ supabaseAdmin }, dfs, svc, period, cache, identity] = await Promise.all([
    import('@/lib/supabase/admin'),
    import('./dataforseo'),
    import('./service'),
    import('./period'),
    import('@/lib/audit-cache'),
    import('./identity'),
  ])
  const periodStart = period.usagePeriodStart(new Date())
  let clientRow: any = null
  return {
    enabled: () => process.env.AUDIT_MINI_GRID_ENABLED === 'true' && dfs.rankgridProviderConfigured(),
    loadContext: async () => {
      const [{ data: c }, { data: cfg }, { data: kw }] = await Promise.all([
        supabaseAdmin.from('clients').select('place_id,gbp_cid,gbp_link,latitude,longitude,latlng_source,latlng_cached_at').eq('id', clientId).eq('workspace_id', workspaceId).maybeSingle(),
        supabaseAdmin.from('rank_grid_configs').select('center_lat,center_lng,target_place_id,target_cid,zoom,spacing_m').eq('client_id', clientId).eq('workspace_id', workspaceId).limit(1).maybeSingle(),
        supabaseAdmin.from('rank_keywords').select('keyword').eq('client_id', clientId).eq('workspace_id', workspaceId).eq('active', true).eq('is_primary', true).limit(1).maybeSingle(),
      ])
      clientRow = c
      const cc: any = c || {}
      const g: any = cfg || {}
      // Toạ độ từ Google Places chỉ dùng khi còn trong 30 ngày (GMP Service Specific Terms).
      const placesExpired = cc.latlng_source === 'places' && cc.latlng_cached_at && Date.now() - new Date(cc.latlng_cached_at).getTime() > 30 * 86_400_000
      const lat = g.center_lat != null ? Number(g.center_lat) : !placesExpired && cc.latitude != null ? Number(cc.latitude) : null
      const lng = g.center_lng != null ? Number(g.center_lng) : !placesExpired && cc.longitude != null ? Number(cc.longitude) : null
      return {
        lat,
        lng,
        placeId: g.target_place_id || cc.place_id || null,
        cid: g.target_cid || cc.gbp_cid || null,
        keyword: (kw as any)?.keyword || null,
        zoom: g.zoom ?? null,
        spacingM: g.spacing_m != null ? Number(g.spacing_m) : null,
      }
    },
    // Không lưu toạ độ lấy được ở đây (chỉ dùng cho lần quét này).
    resolveIdentity: async () => {
      const r = await identity.resolveClientIdentity({ name: client.name, area: client.area, gbp_link: clientRow?.gbp_link, place_id: clientRow?.place_id, gbp_cid: clientRow?.gbp_cid })
      return { lat: r.lat, lng: r.lng, placeId: r.placeId, cid: r.cid }
    },
    readCache: async (key) => (await cache.readAuditCache<RankGridAuditInput & { key?: string }>(clientId, workspaceId, 'mini_grid', MINI_GRID_CACHE_DAYS, (v) => v?.key === key))?.value ?? null,
    writeCache: (key, value) => cache.writeAuditCache(clientId, workspaceId, 'mini_grid', { ...value, key }),
    globalSpendUsd: async () => {
      const [rg, { data }] = await Promise.all([
        svc.globalSpendUsd(),
        supabaseAdmin.from('audit_minigrid_usage').select('cost_usd').eq('period_start', periodStart),
      ])
      return rg + ((data as any[]) || []).reduce((s, r) => s + Number(r.cost_usd || 0), 0)
    },
    monthlyBudgetUsd: svc.monthlyBudgetUsd,
    reserve: async (points, limit, costUsd) => {
      const { data, error } = await supabaseAdmin.rpc('audit_minigrid_reserve', { p_workspace_id: workspaceId, p_period_start: periodStart, p_points: points, p_limit: limit, p_cost_usd: costUsd })
      if (error) throw error
      return data === true
    },
    release: async (points, costUsd) => {
      await supabaseAdmin.rpc('audit_minigrid_release', { p_workspace_id: workspaceId, p_period_start: periodStart, p_points: points, p_cost_usd: costUsd })
    },
    query: dfs.liveMapsQuery,
  }
}
