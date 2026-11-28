/**
 * Lưới thứ hạng — phần server (service role). Mọi GHI vào bảng rank_* đi qua đây vì phải kiểm hạn mức theo gói.
 * Luồng: startScan -> DataForSEO task_post (+pingback) -> handlePointResult -> rankgrid_finalize_scan.
 * Sweeper (sweepScans) lấy kết quả còn sót / gửi lại / chốt lần quét treo. Lịch (runSchedule) tạo lần quét định kỳ.
 */
import crypto from 'node:crypto'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getPlanState } from '@/lib/billing/server'
import type { RankGridEntitlement } from '@/lib/billing/plans'
import { appUrl } from '@/lib/notifications'
import {
  activePoints,
  buildGrid,
  centerIndex,
  isGridSize,
  normalizeLandMask,
  type GridGeometry,
  type GridShape,
  type GridSize,
} from './geometry'
import { COST_PER_POINT_USD, getMapsTask, postMapsTasks, rankgridProviderConfigured, dfsBalanceUsd, type MapsQuery } from './dataforseo'
import { findTargetRank } from './parse'
import { nextRunAt, periodKey, usagePeriodStart, vnMonthStartUtc, type Frequency } from './period'
import { pingbackSig } from './secret'

export const MAX_ATTEMPTS = 3
const STALE_POSTED_MS = 10 * 60_000
const GIVE_UP_POSTED_MS = 3 * 3_600_000
const SCAN_TIMEOUT_MS = 3 * 3_600_000

export type ConfigRow = {
  id: string
  workspace_id: string
  client_id: string
  center_lat: number
  center_lng: number
  grid_size: number
  spacing_m: number
  shape: GridShape
  zoom: number
  device: 'mobile' | 'desktop'
  language_code: string
  disabled_points: number[]
  land_mask: any
  frequency: Frequency
  next_run_at: string | null
  target_place_id: string | null
  target_cid: string | null
  active: boolean
}

export type KeywordRow = { id: string; client_id: string; workspace_id: string; keyword: string; is_primary: boolean; active: boolean }

export class RankGridError extends Error {
  constructor(
    message: string,
    public code: 'not_configured' | 'plan' | 'quota' | 'budget' | 'balance' | 'invalid' | 'not_found' = 'invalid',
  ) {
    super(message)
  }
}

export function geometryOf(cfg: Pick<ConfigRow, 'center_lat' | 'center_lng' | 'grid_size' | 'spacing_m' | 'shape'>): GridGeometry {
  return {
    centerLat: Number(cfg.center_lat),
    centerLng: Number(cfg.center_lng),
    size: (isGridSize(cfg.grid_size) ? cfg.grid_size : 5) as GridSize,
    spacingM: Number(cfg.spacing_m),
    shape: cfg.shape === 'square' ? 'square' : 'circle',
  }
}

/** Điểm tắt = người dùng tắt ∪ điểm kiểm tra là mặt nước (theo đúng hình học hiện tại). */
export function disabledOf(cfg: ConfigRow): number[] {
  const g = geometryOf(cfg)
  const mask = normalizeLandMask(cfg.land_mask, g)
  return [...new Set([...(cfg.disabled_points || []), ...mask.water])]
}

export async function getRankEntitlement(workspaceId: string): Promise<RankGridEntitlement> {
  return (await getPlanState(workspaceId)).entitlements.rankGrid
}

export async function getConfig(clientId: string, workspaceId: string): Promise<ConfigRow | null> {
  const { data, error } = await supabaseAdmin
    .from('rank_grid_configs')
    .select('*')
    .eq('client_id', clientId)
    .eq('workspace_id', workspaceId)
    .maybeSingle()
  if (error) throw error
  return (data as ConfigRow) || null
}

/** Trần điểm/tháng của workspace = trần theo gói × số khách đang có lưới (gói agency nhiều khách). */
async function workspacePointCap(workspaceId: string, ent: RankGridEntitlement): Promise<number> {
  const { count } = await supabaseAdmin
    .from('rank_grid_configs')
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', workspaceId)
    .eq('active', true)
  return ent.monthlyPointCap * Math.max(1, count || 0)
}

export async function usageThisMonth(workspaceId: string, now = new Date()) {
  const period = usagePeriodStart(now)
  const monthStart = vnMonthStartUtc(now).toISOString()
  const [{ data: u }, manual, trial] = await Promise.all([
    supabaseAdmin.from('rank_usage').select('points_reserved,cost_usd').eq('workspace_id', workspaceId).eq('period_start', period).maybeSingle(),
    supabaseAdmin
      .from('rank_scans')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId)
      .eq('trigger', 'manual')
      .gte('created_at', monthStart)
      .not('status', 'in', '(failed,cancelled)'),
    supabaseAdmin
      .from('rank_scans')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId)
      .eq('trigger', 'onboarding')
      .not('status', 'in', '(failed,cancelled)'),
  ])
  return {
    period,
    pointsUsed: Number((u as any)?.points_reserved || 0),
    costUsd: Number((u as any)?.cost_usd || 0),
    manualUsed: manual.count || 0,
    trialUsed: trial.count || 0,
  }
}

/** Trần ngân sách toàn hệ thống mỗi tháng (USD). Mặc định 50. */
export function monthlyBudgetUsd(): number {
  const n = Number(process.env.RANKGRID_MONTHLY_BUDGET_USD)
  return Number.isFinite(n) && n > 0 ? n : 50
}

export async function globalSpendUsd(now = new Date()): Promise<number> {
  const { data, error } = await supabaseAdmin.from('rank_usage').select('cost_usd').eq('period_start', usagePeriodStart(now))
  if (error) throw error
  return (data || []).reduce((s: number, r: any) => s + Number(r.cost_usd || 0), 0)
}

function pingbackUrl(pointId: string): string {
  const sig = pingbackSig(pointId)
  if (!sig) throw new RankGridError('Chưa đặt RANKGRID_PINGBACK_SECRET.', 'not_configured')
  // DataForSEO tự thay $id bằng id task khi gọi lại.
  return `${appUrl()}/api/rankgrid/pingback?p=${pointId}&s=${sig}&id=$id`
}

function queryFor(cfg: ConfigRow, keyword: string, lat: number, lng: number): MapsQuery {
  return { keyword, lat, lng, zoom: cfg.zoom, device: cfg.device, languageCode: cfg.language_code || 'vi' }
}

export type StartScanResult = { scanId: string | null; status: string; points: number; reused?: boolean; error?: string }

/**
 * Tạo 1 lần quét (1 từ khoá × lưới hiện tại). Idempotent theo (client, keyword, period_key).
 * Thứ tự chốt chặn: provider đã cấu hình -> trần ngân sách hệ thống -> giữ chỗ hạn mức điểm của workspace (atomic trong DB).
 */
export async function startScan(args: {
  cfg: ConfigRow
  keyword: KeywordRow
  ent: RankGridEntitlement
  trigger: 'schedule' | 'manual' | 'onboarding'
  mode: 'standard' | 'priority'
  periodKey: string
  requestedBy?: string | null
  clientName?: string | null
}): Promise<StartScanResult> {
  const { cfg, keyword, ent } = args
  if (!rankgridProviderConfigured()) throw new RankGridError('Chưa cấu hình DATAFORSEO_LOGIN/DATAFORSEO_PASSWORD.', 'not_configured')
  if (!pingbackSig('check')) throw new RankGridError('Chưa đặt RANKGRID_PINGBACK_SECRET.', 'not_configured')
  if (!cfg.target_place_id && !cfg.target_cid) throw new RankGridError('Chưa xác định được place_id/CID của doanh nghiệp.', 'invalid')

  // Cỡ lưới không thuộc gói hiện tại (vd vừa hạ gói) -> dùng cỡ mặc định của gói.
  let g = geometryOf(cfg)
  if (!ent.gridSizes.includes(g.size)) g = { ...g, size: ent.defaultGridSize }
  const disabled = g.size === cfg.grid_size ? disabledOf(cfg) : []
  const pts = activePoints(buildGrid(g, disabled))
  const cost = pts.length * COST_PER_POINT_USD[args.mode]

  const spent = await globalSpendUsd()
  if (spent + cost > monthlyBudgetUsd()) {
    throw new RankGridError('Hệ thống đã chạm trần ngân sách quét tháng này. Vui lòng thử lại sau hoặc liên hệ hỗ trợ.', 'budget')
  }

  const config = {
    grid_size: g.size,
    spacing_m: g.spacingM,
    shape: g.shape,
    center_lat: g.centerLat,
    center_lng: g.centerLng,
    zoom: cfg.zoom,
    device: cfg.device,
    language_code: cfg.language_code,
    disabled_points: disabled,
    target_place_id: cfg.target_place_id,
    target_cid: cfg.target_cid,
    provider_params: { depth: 20, search_this_area: process.env.RANKGRID_SEARCH_THIS_AREA === 'true', search_places: false },
  }

  const { data: inserted, error: insErr } = await supabaseAdmin
    .from('rank_scans')
    .upsert(
      {
        workspace_id: cfg.workspace_id,
        client_id: cfg.client_id,
        keyword_id: keyword.id,
        keyword: keyword.keyword,
        config,
        period_key: args.periodKey,
        trigger: args.trigger,
        requested_by: args.requestedBy ?? null,
        provider: 'dataforseo',
        provider_mode: args.mode,
        status: 'queued',
        points_total: pts.length,
      },
      { onConflict: 'client_id,keyword,period_key', ignoreDuplicates: true },
    )
    .select('id')
  if (insErr) throw insErr
  const scanId: string | undefined = (inserted as any[])?.[0]?.id
  if (!scanId) {
    const { data: existing } = await supabaseAdmin
      .from('rank_scans')
      .select('id,status,points_total')
      .eq('client_id', cfg.client_id)
      .eq('keyword', keyword.keyword)
      .eq('period_key', args.periodKey)
      .maybeSingle()
    return { scanId: (existing as any)?.id ?? null, status: (existing as any)?.status ?? 'unknown', points: (existing as any)?.points_total ?? 0, reused: true }
  }

  const period = usagePeriodStart(new Date())
  const cap = await workspacePointCap(cfg.workspace_id, ent)
  const { data: ok, error: resErr } = await supabaseAdmin.rpc('rankgrid_reserve_points', {
    p_workspace_id: cfg.workspace_id,
    p_period_start: period,
    p_points: pts.length,
    p_limit: cap,
    p_cost_usd: cost,
  })
  if (resErr || ok !== true) {
    const msg = resErr ? `Không giữ được hạn mức: ${resErr.message}` : `Đã dùng hết hạn mức ${cap} điểm quét của tháng này.`
    await supabaseAdmin.from('rank_scans').update({ status: 'cancelled', error: msg, completed_at: new Date().toISOString() }).eq('id', scanId)
    return { scanId, status: 'cancelled', points: pts.length, error: msg }
  }

  // Dòng của chính quán trong bảng đối thủ (để luôn có chỉ số kể cả khi không xuất hiện ở điểm nào).
  const targetKey = cfg.target_place_id || `cid:${cfg.target_cid}`
  await supabaseAdmin.from('rank_scan_competitors').upsert(
    {
      scan_id: scanId,
      place_key: targetKey,
      workspace_id: cfg.workspace_id,
      client_id: cfg.client_id,
      place_id: cfg.target_place_id,
      cid: cfg.target_cid,
      title: args.clientName ?? null,
      is_target: true,
    },
    { onConflict: 'scan_id,place_key', ignoreDuplicates: true },
  )

  const rows = pts.map((p) => ({
    id: crypto.randomUUID(),
    scan_id: scanId,
    workspace_id: cfg.workspace_id,
    client_id: cfg.client_id,
    idx: p.idx,
    row_i: p.row,
    col_i: p.col,
    lat: p.lat,
    lng: p.lng,
    status: 'pending' as string,
    attempts: 0,
    provider_task_id: null as string | null,
    last_error: null as string | null,
    posted_at: null as string | null,
  }))
  const { error: ptErr } = await supabaseAdmin.from('rank_scan_points').insert(rows)
  if (ptErr) {
    await supabaseAdmin.rpc('rankgrid_release_points', { p_workspace_id: cfg.workspace_id, p_period_start: period, p_points: pts.length, p_cost_usd: cost })
    await supabaseAdmin.from('rank_scans').update({ status: 'failed', error: ptErr.message.slice(0, 300) }).eq('id', scanId)
    throw ptErr
  }

  await supabaseAdmin.from('rank_scans').update({ status: 'running', started_at: new Date().toISOString(), cost_usd: cost }).eq('id', scanId)
  await postPoints(cfg, keyword.keyword, rows, args.mode)
  return { scanId, status: 'running', points: pts.length }
}

/** Gửi (hoặc gửi lại) các điểm; lỗi gửi -> giữ 'pending' để sweeper thử lại (tối đa MAX_ATTEMPTS). */
async function postPoints(
  cfg: ConfigRow,
  keyword: string,
  rows: Array<{ id: string; lat: number; lng: number; attempts: number }>,
  mode: 'standard' | 'priority',
) {
  const now = new Date().toISOString()
  const posted = await postMapsTasks(
    rows.map((r) => ({ tag: r.id, query: queryFor(cfg, keyword, Number(r.lat), Number(r.lng)), pingbackUrl: pingbackUrl(r.id) })),
    mode,
  )
  const byTag = new Map(posted.map((p) => [p.tag, p]))
  await Promise.all(
    rows.map((r) => {
      const p = byTag.get(r.id)
      const patch = p?.taskId
        ? { status: 'posted', provider_task_id: p.taskId, posted_at: now, attempts: r.attempts + 1, last_error: null }
        : { status: 'pending', attempts: r.attempts + 1, last_error: (p?.error || 'không gửi được').slice(0, 300), posted_at: now }
      return supabaseAdmin.from('rank_scan_points').update(patch).eq('id', r.id)
    }),
  )
}

async function releaseFor(scan: { workspace_id: string; created_at: string; provider_mode: string }, points: number) {
  if (points <= 0) return
  const mode = (scan.provider_mode as 'standard' | 'priority') || 'standard'
  await supabaseAdmin.rpc('rankgrid_release_points', {
    p_workspace_id: scan.workspace_id,
    p_period_start: usagePeriodStart(new Date(scan.created_at)),
    p_points: points,
    p_cost_usd: points * (COST_PER_POINT_USD[mode] ?? COST_PER_POINT_USD.standard),
  })
}

async function finalize(scanId: string, force = false): Promise<string> {
  const { data, error } = await supabaseAdmin.rpc('rankgrid_finalize_scan', { p_scan_id: scanId, p_force: force })
  if (error) throw error
  return String(data)
}

/**
 * Nhận kết quả 1 điểm (pingback hoặc sweeper). Idempotent: điểm đã 'done'/'failed' thì bỏ qua.
 * Trả trạng thái lần quét sau khi cập nhật.
 */
export async function handlePointResult(pointId: string, taskId: string | null): Promise<{ status: string }> {
  const { data: pt } = await supabaseAdmin
    .from('rank_scan_points')
    .select('id,scan_id,workspace_id,client_id,status,attempts,provider_task_id,posted_at')
    .eq('id', pointId)
    .maybeSingle()
  if (!pt) return { status: 'point_not_found' }
  if ((pt as any).status === 'done' || (pt as any).status === 'failed') return { status: 'already' }
  const tid = taskId || (pt as any).provider_task_id
  if (!tid) return { status: 'no_task' }

  const { data: scan } = await supabaseAdmin
    .from('rank_scans')
    .select('id,workspace_id,client_id,config,status,created_at,provider_mode')
    .eq('id', (pt as any).scan_id)
    .maybeSingle()
  if (!scan) return { status: 'scan_not_found' }

  const parsed = await getMapsTask(tid)
  if (!parsed.ok) {
    const postedAt = (pt as any).posted_at ? new Date((pt as any).posted_at).getTime() : 0
    const tooOld = Date.now() - postedAt > GIVE_UP_POSTED_MS
    if (parsed.retryable && !tooOld) {
      await supabaseAdmin.from('rank_scan_points').update({ last_error: parsed.error.slice(0, 300), provider_task_id: tid }).eq('id', pointId)
      return { status: 'waiting' }
    }
    await supabaseAdmin.from('rank_scan_points').update({ status: 'failed', last_error: parsed.error.slice(0, 300) }).eq('id', pointId)
    await releaseFor(scan as any, 1)
    return { status: await finalize((scan as any).id) }
  }

  const cfg = (scan as any).config || {}
  const rank = findTargetRank(parsed.places, { placeId: cfg.target_place_id ?? null, cid: cfg.target_cid ?? null })
  const targetKey = cfg.target_place_id || (cfg.target_cid ? `cid:${cfg.target_cid}` : null)
  const keys = parsed.places.map((p, i) => (rank === i + 1 && targetKey ? targetKey : p.placeKey))

  // Thông tin đối thủ: lần đầu thấy địa điểm nào trong lần quét thì ghi (ignoreDuplicates).
  if (parsed.places.length) {
    await supabaseAdmin.from('rank_scan_competitors').upsert(
      parsed.places.map((p, i) => ({
        scan_id: (scan as any).id,
        place_key: keys[i],
        workspace_id: (scan as any).workspace_id,
        client_id: (scan as any).client_id,
        place_id: p.placeId,
        cid: p.cid,
        title: p.title,
        category: p.category,
        rating: p.rating != null ? Math.round(p.rating * 10) / 10 : null,
        reviews_count: p.reviewsCount,
        lat: p.lat,
        lng: p.lng,
        is_target: keys[i] === targetKey,
      })),
      { onConflict: 'scan_id,place_key', ignoreDuplicates: true },
    )
    // Dòng chính quán được tạo sẵn lúc bắt đầu (title có thể rỗng) -> bổ sung thông tin thật khi thấy.
    if (rank) {
      const p = parsed.places[rank - 1]
      await supabaseAdmin
        .from('rank_scan_competitors')
        .update({ title: p.title, category: p.category, rating: p.rating, reviews_count: p.reviewsCount, lat: p.lat, lng: p.lng, cid: p.cid ?? cfg.target_cid ?? null })
        .eq('scan_id', (scan as any).id)
        .eq('place_key', targetKey)
        .is('category', null)
    }
  }

  await supabaseAdmin
    .from('rank_scan_points')
    .update({
      status: 'done',
      rank,
      result_count: parsed.resultCount,
      top_places: keys,
      fetched_at: new Date().toISOString(),
      provider_task_id: tid,
      last_error: null,
    })
    .eq('id', pointId)
    .neq('status', 'done')

  return { status: await finalize((scan as any).id) }
}

/**
 * Dọn dẹp: lấy kết quả điểm đã gửi > 10 phút mà chưa có pingback, gửi lại điểm lỗi gửi, chốt lần quét treo > 3 giờ.
 * `scanId` = chỉ xử lý 1 lần quét (gọi "lười" khi người dùng mở trang — hữu ích trên Vercel Hobby).
 */
export async function sweepScans(opts: { deadline: number; scanId?: string; limit?: number }) {
  const summary = { fetched: 0, reposted: 0, failed: 0, forced: 0 }
  const staleIso = new Date(Date.now() - STALE_POSTED_MS).toISOString()

  let q = supabaseAdmin
    .from('rank_scan_points')
    .select('id,scan_id,status,attempts,provider_task_id,posted_at')
    .in('status', ['posted', 'pending'])
    .lt('posted_at', staleIso)
    .order('posted_at', { ascending: true })
    .limit(opts.limit ?? 300)
  if (opts.scanId) q = q.eq('scan_id', opts.scanId)
  const { data: pts } = await q

  const repostByScan = new Map<string, any[]>()
  for (const p of (pts || []) as any[]) {
    if (Date.now() > opts.deadline) break
    if (p.status === 'posted' && p.provider_task_id) {
      await handlePointResult(p.id, p.provider_task_id)
      summary.fetched++
    } else if (p.status === 'pending') {
      if (p.attempts >= MAX_ATTEMPTS) {
        await supabaseAdmin.from('rank_scan_points').update({ status: 'failed' }).eq('id', p.id)
        summary.failed++
        const { data: scan } = await supabaseAdmin.from('rank_scans').select('id,workspace_id,created_at,provider_mode').eq('id', p.scan_id).maybeSingle()
        if (scan) {
          await releaseFor(scan as any, 1)
          await finalize((scan as any).id)
        }
      } else {
        const list = repostByScan.get(p.scan_id) || []
        list.push(p)
        repostByScan.set(p.scan_id, list)
      }
    }
  }

  for (const [scanId, list] of repostByScan) {
    if (Date.now() > opts.deadline) break
    const { data: scan } = await supabaseAdmin.from('rank_scans').select('id,client_id,workspace_id,keyword,provider_mode,status').eq('id', scanId).maybeSingle()
    if (!scan || (scan as any).status !== 'running') continue
    const cfg = await getConfig((scan as any).client_id, (scan as any).workspace_id)
    if (!cfg) continue
    const { data: rows } = await supabaseAdmin.from('rank_scan_points').select('id,lat,lng,attempts').in('id', list.map((x) => x.id))
    await postPoints(cfg, (scan as any).keyword, (rows || []) as any[], ((scan as any).provider_mode as any) === 'priority' ? 'priority' : 'standard')
    summary.reposted += (rows || []).length
  }

  // Chốt lần quét treo quá lâu (điểm còn treo tính là lỗi và được hoàn hạn mức).
  let sq = supabaseAdmin
    .from('rank_scans')
    .select('id,workspace_id,created_at,provider_mode')
    .in('status', ['queued', 'running'])
    .lt('created_at', new Date(Date.now() - SCAN_TIMEOUT_MS).toISOString())
    .limit(50)
  if (opts.scanId) sq = sq.eq('id', opts.scanId)
  const { data: stuck } = await sq
  for (const s of (stuck || []) as any[]) {
    if (Date.now() > opts.deadline) break
    const { count } = await supabaseAdmin
      .from('rank_scan_points')
      .select('id', { count: 'exact', head: true })
      .eq('scan_id', s.id)
      .in('status', ['pending', 'posted'])
    await releaseFor(s, count || 0)
    await finalize(s.id, true)
    summary.forced++
  }
  return summary
}

/** Lần quét định kỳ theo gói. Gọi từ cron hằng ngày (Vercel Hobby chỉ cho 1 lần/ngày). */
export async function runSchedule(opts: { deadline: number; dry?: boolean }) {
  const summary = { configs: 0, scans: 0, reused: 0, skipped: 0, errors: [] as string[], balance: null as number | null, truncated: false }
  if (!rankgridProviderConfigured()) return { ...summary, errors: ['Chưa cấu hình DataForSEO'] }
  const minBalance = Number(process.env.RANKGRID_MIN_BALANCE_USD) || 5
  summary.balance = await dfsBalanceUsd()
  if (summary.balance != null && summary.balance < minBalance) {
    return { ...summary, errors: [`Số dư DataForSEO ${summary.balance} USD < ${minBalance} USD — tạm dừng quét định kỳ.`] }
  }

  const now = new Date()
  const { data: cfgs, error } = await supabaseAdmin
    .from('rank_grid_configs')
    .select('*')
    .eq('active', true)
    .neq('frequency', 'manual')
    .not('next_run_at', 'is', null)
    .lte('next_run_at', now.toISOString())
    .order('next_run_at', { ascending: true })
    .limit(200)
  if (error) throw error

  for (const cfg of (cfgs || []) as ConfigRow[]) {
    if (Date.now() > opts.deadline) {
      summary.truncated = true
      break
    }
    summary.configs++
    try {
      const ent = await getRankEntitlement(cfg.workspace_id)
      if (ent.frequency === 'none') {
        if (!opts.dry) await supabaseAdmin.from('rank_grid_configs').update({ next_run_at: null }).eq('id', cfg.id)
        summary.skipped++
        continue
      }
      const freq: Frequency = ent.frequency
      const key = periodKey(freq, now)!
      const { data: kws } = await supabaseAdmin
        .from('rank_keywords')
        .select('*')
        .eq('client_id', cfg.client_id)
        .eq('active', true)
        .order('is_primary', { ascending: false })
        .order('created_at', { ascending: true })
        .limit(ent.maxKeywords)
      const { data: client } = await supabaseAdmin.from('clients').select('name').eq('id', cfg.client_id).maybeSingle()
      for (const kw of (kws || []) as KeywordRow[]) {
        if (opts.dry) {
          summary.scans++
          continue
        }
        const r = await startScan({ cfg, keyword: kw, ent, trigger: 'schedule', mode: 'standard', periodKey: key, clientName: (client as any)?.name })
        if (r.reused) summary.reused++
        else if (r.status === 'running') summary.scans++
        else if (r.error) summary.errors.push(`${cfg.client_id}: ${r.error}`)
      }
      if (!opts.dry) await supabaseAdmin.from('rank_grid_configs').update({ next_run_at: nextRunAt(freq, now)!.toISOString() }).eq('id', cfg.id)
    } catch (e: any) {
      summary.errors.push(`${cfg.client_id}: ${String(e?.message || e).slice(0, 160)}`)
    }
  }
  return summary
}

/** Giữ top_places 180 ngày (dữ liệu nặng); chỉ số và bảng đối thủ tổng hợp giữ lâu dài. */
export async function pruneOldPoints() {
  const cutoff = new Date(Date.now() - 180 * 86_400_000).toISOString()
  await supabaseAdmin.from('rank_scan_points').update({ top_places: [] }).lt('fetched_at', cutoff).neq('top_places', '{}')
}

export function centerIdxOf(size: number) {
  return centerIndex(size)
}
