/**
 * DB helpers cho gbp_snapshots — Giai đoạn A.
 * Copy vào: lib/gbp-snapshots.ts
 */

import { createClient as createSupabaseServerClient } from '@/lib/supabase/server'
import type { GbpSnapshotPayload, GbpSnapshotStatus } from '@/lib/gbp-snapshot-types'
import { GBP_SNAPSHOT_CACHE_DAYS } from '@/lib/gbp-snapshot-types'

export async function createPendingSnapshot(input: {
  workspace_id: string
  client_id: string
  place_id?: string | null
  maps_url?: string | null
  source?: string
}) {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase
    .from('gbp_snapshots')
    .insert({
      workspace_id: input.workspace_id,
      client_id: input.client_id,
      place_id: input.place_id ?? null,
      maps_url: input.maps_url ?? null,
      source: input.source || 'browser',
      status: 'pending' as GbpSnapshotStatus,
    })
    .select()
    .single()

  if (error) throw error
  return data
}

export async function updateSnapshot(
  id: string,
  workspaceId: string,
  patch: {
    status?: GbpSnapshotStatus
    error_message?: string | null
    captured_at?: string | null
    place_id?: string | null
    maps_url?: string | null
    business_name?: string | null
    description?: string | null
    primary_category?: string | null
    rating?: number | null
    review_count?: number | null
    phone?: string | null
    website_url?: string | null
    address_text?: string | null
    posts_signal?: string | null
    recent_posts?: unknown
    photos_signal?: string | null
    photos_count_est?: number | null
    competitors?: unknown
    raw_json?: unknown
  }
) {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase
    .from('gbp_snapshots')
    .update({
      ...patch,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('workspace_id', workspaceId)
    .select()
    .single()

  if (error) throw error
  return data
}

export async function getLatestSnapshotForClient(
  clientId: string,
  workspaceId: string,
  opts?: { onlyOk?: boolean }
) {
  const supabase = await createSupabaseServerClient()
  let query = supabase
    .from('gbp_snapshots')
    .select('*')
    .eq('client_id', clientId)
    .eq('workspace_id', workspaceId)
    .order('captured_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(1)

  if (opts?.onlyOk) {
    query = query.in('status', ['ok', 'partial'])
  }

  const { data, error } = await query.maybeSingle()
  if (error) throw error
  return data
}

/** Snapshot ok/partial còn trong TTL cache. */
export async function getFreshSnapshotForClient(
  clientId: string,
  workspaceId: string
) {
  const latest = await getLatestSnapshotForClient(clientId, workspaceId, {
    onlyOk: true,
  })
  if (!latest?.captured_at) return null

  const captured = new Date(latest.captured_at).getTime()
  const maxAge = GBP_SNAPSHOT_CACHE_DAYS * 24 * 60 * 60 * 1000
  if (Date.now() - captured > maxAge) return null
  return latest
}

export function snapshotToAuditFields(snapshot: any): {
  description?: string
  primary_category?: string
  review_count?: string
  rating?: string
  recent_posts?: string
  photos_status?: string
  additional_info?: string
} {
  if (!snapshot) return {}

  const posts = Array.isArray(snapshot.recent_posts)
    ? snapshot.recent_posts
    : []
  const postsPreview =
    posts.length > 0
      ? posts
          .slice(0, 3)
          .map((p: any, i: number) => `${i + 1}. ${(p.text || '').slice(0, 120)}`)
          .join('\n')
      : ''

  const additionalParts: string[] = []
  if (snapshot.posts_signal) {
    additionalParts.push(`Tín hiệu bài đăng (quan sát): ${snapshot.posts_signal}`)
  }
  if (postsPreview) {
    additionalParts.push(`Bài gần đây:\n${postsPreview}`)
  }
  if (snapshot.photos_signal) {
    additionalParts.push(`Tín hiệu ảnh: ${snapshot.photos_signal}`)
  }

  return {
    description: snapshot.description || undefined,
    primary_category: snapshot.primary_category || undefined,
    review_count:
      snapshot.review_count != null ? String(snapshot.review_count) : undefined,
    rating: snapshot.rating != null ? String(snapshot.rating) : undefined,
    recent_posts: snapshot.posts_signal || undefined,
    photos_status: snapshot.photos_signal || undefined,
    additional_info: additionalParts.length
      ? additionalParts.join('\n\n')
      : undefined,
  }
}

export type { GbpSnapshotPayload }
