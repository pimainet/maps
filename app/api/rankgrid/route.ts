/**
 * Lưới thứ hạng của 1 khách.
 *  GET  ?client_id=  -> cấu hình, từ khoá, lịch sử lần quét, hạn mức theo gói.
 *  POST { client_id, action, ... } với action:
 *    identity     — xác định place_id/CID/toạ độ (Places -> Outscraper -> DataForSEO), tạo cấu hình lưới nếu chưa có
 *    config       — lưu tâm/cỡ/khoảng cách/hình/điểm tắt (kiểm theo gói)
 *    water_check  — kiểm tra điểm trên mặt nước (Nominatim, tối đa ~40 điểm/lần gọi, gọi lại tới khi remaining = 0)
 *    add_keyword | remove_keyword | set_primary
 *    scan         — "Quét ngay" (gói trả phí, theo quota tháng) hoặc quét thử 1 lần (gói Miễn phí)
 * Mọi GHI dùng service role sau khi đã kiểm thành viên workspace + gói.
 */
import { NextResponse } from 'next/server'
import { publicError } from '@/lib/api-error'
import { getCurrentUser, requireActiveWorkspaceId } from '@/lib/auth'
import { getClientById } from '@/lib/db'
import { isUuid } from '@/lib/autopost/secret'
import { rankGridFeatureOn } from '@/lib/rankgrid/secret'
import { rankgridProviderConfigured } from '@/lib/rankgrid/dataforseo'
import {
  MAX_SPACING_M,
  MIN_SPACING_M,
  applyWaterMask,
  buildGrid,
  countActive,
  isGridSize,
  normalizeLandMask,
  suggestSpacingM,
} from '@/lib/rankgrid/geometry'
import { cleanKeyword, normalizeKeyword, suggestKeywords } from '@/lib/rankgrid/keywords'
import { resolveClientIdentity } from '@/lib/rankgrid/identity'
import { NOMINATIM_DELAY_MS, nominatimTester } from '@/lib/rankgrid/water'
import { nextRunAt } from '@/lib/rankgrid/period'
import {
  RankGridError,
  disabledOf,
  geometryOf,
  getConfig,
  getRankEntitlement,
  startScan,
  usageThisMonth,
  type ConfigRow,
  type KeywordRow,
} from '@/lib/rankgrid/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const off = () => NextResponse.json({ error: 'Tính năng lưới thứ hạng đang tắt.', code: 'disabled' }, { status: 404 })

function fail(error: any) {
  const m = typeof error?.message === 'string' ? error.message : ''
  if (error instanceof RankGridError) {
    const status = error.code === 'not_found' ? 404 : error.code === 'invalid' ? 400 : error.code === 'not_configured' ? 503 : 402
    return NextResponse.json({ error: error.message, code: error.code }, { status })
  }
  if (m.includes('Unauthorized')) return NextResponse.json({ error: publicError(error) }, { status: 401 })
  if (m.includes('NoWorkspace')) return NextResponse.json({ error: publicError(error) }, { status: 409 })
  console.error('rankgrid api:', m)
  return NextResponse.json({ error: publicError(error) }, { status: 500 })
}

async function loadClient(clientId: unknown, workspaceId: string) {
  if (!isUuid(clientId)) throw new RankGridError('Thiếu doanh nghiệp.', 'invalid')
  const client = await getClientById(clientId, workspaceId)
  if (!client) throw new RankGridError('Không tìm thấy doanh nghiệp này.', 'not_found')
  return client as any
}

async function overview(client: any, workspaceId: string) {
  const { supabaseAdmin } = await import('@/lib/supabase/admin')
  const [ent, cfg, usage, kwRes, scanRes, snapRes] = await Promise.all([
    getRankEntitlement(workspaceId),
    getConfig(client.id, workspaceId),
    usageThisMonth(workspaceId),
    supabaseAdmin.from('rank_keywords').select('id,keyword,is_primary,active,source,created_at').eq('client_id', client.id).eq('active', true).order('created_at'),
    supabaseAdmin
      .from('rank_scans')
      .select('id,keyword_id,keyword,status,trigger,provider_mode,points_total,points_done,points_failed,arp,atrp,solv,top10_pct,found_pct,center_rank,competitors_found,error,created_at,completed_at,config')
      .eq('client_id', client.id)
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false })
      .limit(120),
    supabaseAdmin
      .from('gbp_snapshots')
      .select('primary_category,additional_categories')
      .eq('client_id', client.id)
      .eq('workspace_id', workspaceId)
      .order('captured_at', { ascending: false })
      .limit(1),
  ])
  const snap = (snapRes.data || [])[0] as any
  const keywords = kwRes.data || []
  const suggestions = suggestKeywords({
    primaryCategory: snap?.primary_category,
    additionalCategories: snap?.additional_categories,
    industry: client.industry,
    area: client.area,
    limit: 6,
  }).filter((s) => !keywords.some((k: any) => normalizeKeyword(k.keyword) === normalizeKeyword(s)))
  const grid = cfg ? buildGrid(geometryOf(cfg), disabledOf(cfg)) : []
  return {
    enabled: true,
    providerReady: rankgridProviderConfigured(),
    entitlement: ent,
    usage,
    client: { id: client.id, name: client.name, industry: client.industry, area: client.area, latitude: client.latitude, longitude: client.longitude, place_id: client.place_id, gbp_cid: client.gbp_cid },
    config: cfg
      ? {
          ...cfg,
          land_mask: normalizeLandMask(cfg.land_mask, geometryOf(cfg)),
          active_points: grid.filter((p) => p.inShape && !p.disabled).length,
        }
      : null,
    grid,
    keywords,
    suggestions,
    scans: scanRes.data || [],
    suggestedSpacingM: suggestSpacingM(client.industry, client.area),
  }
}

export async function GET(req: Request) {
  if (!rankGridFeatureOn()) return off()
  try {
    const workspaceId = await requireActiveWorkspaceId()
    const client = await loadClient(new URL(req.url).searchParams.get('client_id'), workspaceId)
    return NextResponse.json(await overview(client, workspaceId))
  } catch (e) {
    return fail(e)
  }
}

export async function POST(req: Request) {
  if (!rankGridFeatureOn()) return off()
  try {
    const workspaceId = await requireActiveWorkspaceId()
    const body = (await req.json().catch(() => null)) as Record<string, any> | null
    if (!body || typeof body !== 'object') throw new RankGridError('Dữ liệu không hợp lệ.', 'invalid')
    const client = await loadClient(body.client_id, workspaceId)
    const { supabaseAdmin } = await import('@/lib/supabase/admin')
    const ent = await getRankEntitlement(workspaceId)
    const action = String(body.action || '')

    if (action === 'identity') {
      const id = await resolveClientIdentity(client)
      if (id.lat == null || id.lng == null || (!id.placeId && !id.cid)) {
        return NextResponse.json(
          { error: 'Chưa xác định được vị trí ghim / place_id của doanh nghiệp. Hãy kiểm tra link Google Maps của khách.', details: id.errors },
          { status: 422 },
        )
      }
      await supabaseAdmin
        .from('clients')
        .update({ latitude: id.lat, longitude: id.lng, ...(id.cid ? { gbp_cid: id.cid } : {}) })
        .eq('id', client.id)
        .eq('workspace_id', workspaceId)
      const existing = await getConfig(client.id, workspaceId)
      const patch = { target_place_id: id.placeId, target_cid: id.cid, updated_at: new Date().toISOString() }
      if (existing) {
        await supabaseAdmin.from('rank_grid_configs').update(patch).eq('id', existing.id)
      } else {
        await supabaseAdmin.from('rank_grid_configs').insert({
          workspace_id: workspaceId,
          client_id: client.id,
          center_lat: id.lat,
          center_lng: id.lng,
          grid_size: ent.defaultGridSize,
          spacing_m: suggestSpacingM(client.industry, client.area),
          shape: 'circle',
          frequency: 'weekly',
          next_run_at: ent.frequency === 'none' ? null : nextRunAt(ent.frequency, new Date(Date.now() - 7 * 86_400_000))?.toISOString(),
          ...patch,
        })
      }
      return NextResponse.json({ ok: true, identity: id, ...(await overview({ ...client, latitude: id.lat, longitude: id.lng, gbp_cid: id.cid }, workspaceId)) })
    }

    const cfg = await getConfig(client.id, workspaceId)

    if (action === 'config') {
      if (!cfg) throw new RankGridError('Hãy xác định vị trí doanh nghiệp trước.', 'invalid')
      const size = Number(body.grid_size ?? cfg.grid_size)
      if (!isGridSize(size) || !ent.gridSizes.includes(size)) throw new RankGridError(`Gói hiện tại chỉ cho lưới ${ent.gridSizes.map((s) => `${s}×${s}`).join(', ')}.`, 'plan')
      const spacing = Math.round(Number(body.spacing_m ?? cfg.spacing_m))
      if (!Number.isFinite(spacing) || spacing < MIN_SPACING_M || spacing > MAX_SPACING_M) throw new RankGridError('Khoảng cách điểm phải từ 200m đến 5km.', 'invalid')
      const lat = Number(body.center_lat ?? cfg.center_lat)
      const lng = Number(body.center_lng ?? cfg.center_lng)
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) throw new RankGridError('Toạ độ tâm không hợp lệ.', 'invalid')
      const shape = body.shape === 'square' ? 'square' : body.shape === 'circle' ? 'circle' : cfg.shape
      const n = size * size
      const disabled = Array.isArray(body.disabled_points)
        ? [...new Set(body.disabled_points.map(Number).filter((x: number) => Number.isInteger(x) && x >= 0 && x < n))].slice(0, n)
        : cfg.disabled_points
      const frequency = body.frequency === 'manual' ? 'manual' : body.frequency === 'weekly' ? 'weekly' : cfg.frequency
      await supabaseAdmin
        .from('rank_grid_configs')
        .update({ grid_size: size, spacing_m: spacing, center_lat: lat, center_lng: lng, shape, disabled_points: disabled, frequency, updated_at: new Date().toISOString() })
        .eq('id', cfg.id)
      return NextResponse.json(await overview(client, workspaceId))
    }

    if (action === 'water_check') {
      if (!cfg) throw new RankGridError('Hãy xác định vị trí doanh nghiệp trước.', 'invalid')
      const g = geometryOf(cfg)
      const r = await applyWaterMask(g, normalizeLandMask(cfg.land_mask, g), nominatimTester(), { maxChecks: 40, delayMs: NOMINATIM_DELAY_MS })
      await supabaseAdmin.from('rank_grid_configs').update({ land_mask: r.mask, updated_at: new Date().toISOString() }).eq('id', cfg.id)
      return NextResponse.json({ remaining: r.remaining, newly_water: r.newlyWater, ...(await overview(client, workspaceId)) })
    }

    if (action === 'add_keyword') {
      const kw = cleanKeyword(body.keyword)
      if (!kw) throw new RankGridError('Từ khoá phải từ 2 đến 80 ký tự.', 'invalid')
      const { count } = await supabaseAdmin.from('rank_keywords').select('id', { count: 'exact', head: true }).eq('client_id', client.id).eq('active', true)
      if ((count || 0) >= ent.maxKeywords) throw new RankGridError(`Gói hiện tại theo dõi tối đa ${ent.maxKeywords} từ khoá.`, 'plan')
      const norm = normalizeKeyword(kw)
      const { error } = await supabaseAdmin.from('rank_keywords').upsert(
        {
          workspace_id: workspaceId,
          client_id: client.id,
          keyword: kw,
          keyword_norm: norm,
          active: true,
          is_primary: (count || 0) === 0,
          source: body.source === 'suggested' ? 'suggested' : 'manual',
        },
        { onConflict: 'client_id,keyword_norm' },
      )
      if (error) throw error
      return NextResponse.json(await overview(client, workspaceId))
    }

    if (action === 'remove_keyword' || action === 'set_primary') {
      if (!isUuid(body.keyword_id)) throw new RankGridError('Thiếu từ khoá.', 'invalid')
      if (action === 'remove_keyword') {
        await supabaseAdmin.from('rank_keywords').update({ active: false, is_primary: false }).eq('id', body.keyword_id).eq('client_id', client.id)
      } else {
        await supabaseAdmin.from('rank_keywords').update({ is_primary: false }).eq('client_id', client.id).eq('is_primary', true)
        await supabaseAdmin.from('rank_keywords').update({ is_primary: true }).eq('id', body.keyword_id).eq('client_id', client.id).eq('active', true)
      }
      return NextResponse.json(await overview(client, workspaceId))
    }

    if (action === 'scan') {
      if (!cfg) throw new RankGridError('Hãy xác định vị trí doanh nghiệp trước.', 'invalid')
      if (!isUuid(body.keyword_id)) throw new RankGridError('Chọn từ khoá cần quét.', 'invalid')
      const { data: kw } = await supabaseAdmin.from('rank_keywords').select('*').eq('id', body.keyword_id).eq('client_id', client.id).eq('active', true).maybeSingle()
      if (!kw) throw new RankGridError('Không tìm thấy từ khoá.', 'not_found')
      const usage = await usageThisMonth(workspaceId)
      let trigger: 'manual' | 'onboarding'
      if (ent.manualScansPerMonth > 0) {
        if (usage.manualUsed >= ent.manualScansPerMonth) throw new RankGridError(`Đã dùng hết ${ent.manualScansPerMonth} lần quét tay của tháng này.`, 'quota')
        trigger = 'manual'
      } else if (ent.trialScans > 0) {
        if (usage.trialUsed >= ent.trialScans) throw new RankGridError('Bạn đã dùng lượt quét thử miễn phí. Nâng cấp để quét định kỳ.', 'plan')
        trigger = 'onboarding'
      } else {
        throw new RankGridError('Gói hiện tại chưa có quét tay.', 'plan')
      }
      const user = await getCurrentUser()
      const r = await startScan({
        cfg: cfg as ConfigRow,
        keyword: kw as KeywordRow,
        ent,
        trigger,
        mode: 'priority',
        periodKey: `manual:${crypto.randomUUID()}`,
        requestedBy: user?.id ?? null,
        clientName: client.name,
      })
      if (r.error) return NextResponse.json({ error: r.error, scan_id: r.scanId, code: 'quota' }, { status: 402 })
      return NextResponse.json({ scan_id: r.scanId, status: r.status, points: r.points })
    }

    if (action === 'estimate') {
      if (!cfg) return NextResponse.json({ points: 0 })
      return NextResponse.json({ points: countActive(geometryOf(cfg), disabledOf(cfg)) })
    }

    throw new RankGridError('Thao tác không hợp lệ.', 'invalid')
  } catch (e) {
    return fail(e)
  }
}
