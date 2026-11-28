/**
 * Cache nhỏ cho các nguồn phụ của audit (tín hiệu website, review đối thủ, lưới thứ hạng mini) — lưu trong
 * gbp_snapshots.raw_json.audit_cache.<key> của snapshot mới nhất (không cần migration). Đọc lùi tối đa vài snapshot gần nhất
 * để cache không mất khi có snapshot mới. Lỗi đọc/ghi không làm hỏng audit.
 */
import { createClient as createSupabaseServerClient } from '@/lib/supabase/server'

export interface AuditCacheEntry<T> {
  savedAt: string
  value: T
}

const LOOKBACK_SNAPSHOTS = 8

/** Hàm thuần: chọn mục cache mới nhất còn hạn và hợp lệ từ các dòng snapshot (mới -> cũ). */
export function pickCacheEntry<T>(
  rows: Array<{ audit_cache?: Record<string, unknown> | null }>,
  key: string,
  maxAgeDays: number,
  now = new Date(),
  isValid: (v: T) => boolean = () => true,
): AuditCacheEntry<T> | null {
  let best: AuditCacheEntry<T> | null = null
  for (const r of rows) {
    const e = r?.audit_cache?.[key] as AuditCacheEntry<T> | undefined
    if (!e || typeof e !== 'object' || !e.savedAt || e.value === undefined) continue
    const t = new Date(e.savedAt).getTime()
    if (!Number.isFinite(t)) continue
    if (now.getTime() - t > maxAgeDays * 86_400_000 || t > now.getTime() + 60_000) continue
    if (!isValid(e.value)) continue
    if (!best || t > new Date(best.savedAt).getTime()) best = e
  }
  return best
}

export async function readAuditCache<T>(
  clientId: string,
  workspaceId: string,
  key: string,
  maxAgeDays: number,
  isValid?: (v: T) => boolean,
): Promise<AuditCacheEntry<T> | null> {
  try {
    const supabase = await createSupabaseServerClient()
    const { data, error } = await supabase
      .from('gbp_snapshots')
      .select('id, audit_cache:raw_json->audit_cache')
      .eq('client_id', clientId)
      .eq('workspace_id', workspaceId)
      .neq('source', 'manual')
      .neq('status', 'superseded')
      .order('created_at', { ascending: false })
      .limit(LOOKBACK_SNAPSHOTS)
    if (error || !data) return null
    return pickCacheEntry<T>(data as any[], key, maxAgeDays, new Date(), isValid)
  } catch {
    return null
  }
}

/** Ghi (gộp) 1 mục vào raw_json.audit_cache của snapshot mới nhất của client. Best-effort. */
export async function writeAuditCache<T>(clientId: string, workspaceId: string, key: string, value: T): Promise<void> {
  try {
    const supabase = await createSupabaseServerClient()
    const { data, error } = await supabase
      .from('gbp_snapshots')
      .select('id, raw_json')
      .eq('client_id', clientId)
      .eq('workspace_id', workspaceId)
      .neq('source', 'manual')
      .neq('status', 'superseded')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (error || !data) return
    const raw = (data as any).raw_json && typeof (data as any).raw_json === 'object' ? (data as any).raw_json : {}
    const cache = raw.audit_cache && typeof raw.audit_cache === 'object' ? raw.audit_cache : {}
    const next = { ...raw, audit_cache: { ...cache, [key]: { savedAt: new Date().toISOString(), value } } }
    await supabase.from('gbp_snapshots').update({ raw_json: next }).eq('id', (data as any).id).eq('workspace_id', workspaceId)
  } catch (e: any) {
    console.warn(`audit cache write failed (${key}, non-fatal):`, e?.message)
  }
}
