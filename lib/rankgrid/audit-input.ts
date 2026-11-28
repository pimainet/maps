/**
 * Đọc lần quét lưới gần nhất (≤ 14 ngày) của khách -> RankGridAuditInput cho audit v2 và kế hoạch 30 ngày.
 * Tính năng tắt / chưa có dữ liệu / lỗi -> undefined (VY02/VY04 giữ "chưa đủ dữ liệu").
 */
import { RANK_GRID_ENABLED } from '@/lib/features'
import type { RankGridAuditInput } from '@/lib/audit-engine/types'
import { buildGrid, isGridSize, type GridSize } from './geometry'
import { weakestSector } from './metrics'

export const RANK_GRID_AUDIT_MAX_AGE_DAYS = 14

export async function loadRankGridAuditInput(clientId: string, workspaceId: string): Promise<RankGridAuditInput | undefined> {
  if (!RANK_GRID_ENABLED) return undefined
  try {
    const { supabaseAdmin } = await import('@/lib/supabase/admin')
    const since = new Date(Date.now() - RANK_GRID_AUDIT_MAX_AGE_DAYS * 86_400_000).toISOString()
    const [{ data: scans }, { data: kws }] = await Promise.all([
      supabaseAdmin
        .from('rank_scans')
        .select('id,keyword_id,keyword,config,solv,atrp,arp,found_pct,center_rank,points_done,completed_at')
        .eq('client_id', clientId)
        .eq('workspace_id', workspaceId)
        .in('status', ['done', 'partial'])
        .gte('completed_at', since)
        .order('completed_at', { ascending: false })
        .limit(60),
      supabaseAdmin.from('rank_keywords').select('id,is_primary,active').eq('client_id', clientId).eq('active', true),
    ])
    if (!scans?.length) return undefined
    const activeIds = new Set((kws || []).map((k: any) => k.id))
    const latest = new Map<string, any>()
    for (const s of scans as any[]) {
      const k = s.keyword_id || s.keyword
      if (s.keyword_id && activeIds.size && !activeIds.has(s.keyword_id)) continue
      if (!latest.has(k)) latest.set(k, s)
    }
    const list = [...latest.values()]
    if (!list.length) return undefined
    const primaryId = (kws || []).find((k: any) => k.is_primary)?.id
    const primary = list.find((s) => s.keyword_id === primaryId) || list[0]

    const [{ data: pts }, { data: comps }] = await Promise.all([
      supabaseAdmin.from('rank_scan_points').select('row_i,col_i,rank,status').eq('scan_id', primary.id).eq('status', 'done'),
      supabaseAdmin
        .from('rank_scan_competitors')
        .select('title,solv,reviews_count,is_target')
        .eq('scan_id', primary.id)
        .eq('is_target', false)
        .order('solv', { ascending: false })
        .limit(1),
    ])
    const cfg = primary.config || {}
    const size = (isGridSize(cfg.grid_size) ? cfg.grid_size : 5) as GridSize
    const geo = buildGrid({ centerLat: 0, centerLng: 0, size, spacingM: Number(cfg.spacing_m) || 700, shape: 'square' })
    const sectorPts = ((pts || []) as any[]).map((p) => {
      const g = geo[p.row_i * size + p.col_i]
      return { rank: p.rank, dxM: g?.dxM ?? 0, dyM: g?.dyM ?? 0 }
    })
    const weak = weakestSector(sectorPts)
    const leader = (comps || [])[0] as any
    return {
      scannedAt: primary.completed_at,
      primary: {
        keyword: primary.keyword,
        solv: primary.solv != null ? Number(primary.solv) : null,
        atrp: primary.atrp != null ? Number(primary.atrp) : null,
        arp: primary.arp != null ? Number(primary.arp) : null,
        foundPct: primary.found_pct != null ? Number(primary.found_pct) : null,
        centerRank: primary.center_rank ?? null,
        points: primary.points_done ?? sectorPts.length,
        weakSector: weak ? { label: weak.label, solv: weak.solv } : null,
        leader: leader?.title ? { title: leader.title, solv: Number(leader.solv || 0), reviews: leader.reviews_count ?? null } : null,
      },
      keywords: list.map((s) => ({ keyword: s.keyword, solv: s.solv != null ? Number(s.solv) : null, foundPct: s.found_pct != null ? Number(s.found_pct) : null })),
    }
  } catch (e: any) {
    console.error('rankgrid audit input (non-fatal):', e?.message)
    return undefined
  }
}
