import { createClient as createSupabaseServerClient } from '@/lib/supabase/server'
import type { BusinessProfile, DescriptionDraft } from '@/lib/audit-engine/advice'

export type StoredBusinessProfile = BusinessProfile & {
  confirmed: boolean
  confirmedAt: string | null
  placeKey: string | null
  drafts: DescriptionDraft[]
  draftsAt: string | null
}

function fromRow(r: any): StoredBusinessProfile {
  return {
    summary: String(r.summary || ''),
    mainService: String(r.main_service || ''),
    services: Array.isArray(r.services) ? r.services.filter((x: unknown) => typeof x === 'string') : [],
    confidence: r.confidence === 'high' || r.confidence === 'medium' ? r.confidence : 'low',
    question: null,
    confirmed: !!r.confirmed,
    confirmedAt: r.confirmed_at ?? null,
    placeKey: r.place_key ?? null,
    drafts: Array.isArray(r.drafts)
      ? r.drafts.filter((d: any) => d && typeof d.text === 'string').map((d: any) => ({ label: String(d.label || ''), text: d.text }))
      : [],
    draftsAt: r.drafts_at ?? null,
  }
}

/**
 * Hồ sơ đã lưu của 1 doanh nghiệp. Lỗi (vd chưa chạy migration 023) => null: audit vẫn chạy, chỉ chưa có xác nhận.
 * Hồ sơ lưu cho địa điểm khác (placeKey lệch) thì không còn áp dụng => null.
 */
export async function getBusinessProfile(clientId: string, workspaceId: string, placeKey?: string | null): Promise<StoredBusinessProfile | null> {
  try {
    const supabase = await createSupabaseServerClient()
    const { data, error } = await supabase
      .from('client_business_profiles')
      .select('*')
      .eq('client_id', clientId)
      .eq('workspace_id', workspaceId)
      .maybeSingle()
    if (error || !data) return null
    const p = fromRow(data)
    if (placeKey && p.placeKey && p.placeKey !== placeKey) return null
    return p
  } catch {
    return null
  }
}

export async function saveBusinessProfile(args: {
  clientId: string
  workspaceId: string
  placeKey: string | null
  profile: Pick<BusinessProfile, 'summary' | 'mainService' | 'services' | 'confidence'>
  confirmed: boolean
}): Promise<void> {
  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.from('client_business_profiles').upsert(
    {
      client_id: args.clientId,
      workspace_id: args.workspaceId,
      place_key: args.placeKey,
      summary: args.profile.summary,
      main_service: args.profile.mainService,
      services: args.profile.services,
      confidence: args.profile.confidence,
      confirmed: args.confirmed,
      confirmed_at: args.confirmed ? new Date().toISOString() : null,
      drafts: [],
      drafts_at: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'client_id' },
  )
  if (error) throw error
}

export async function saveDescriptionDrafts(clientId: string, workspaceId: string, drafts: DescriptionDraft[]): Promise<void> {
  const supabase = await createSupabaseServerClient()
  const { error } = await supabase
    .from('client_business_profiles')
    .update({ drafts, drafts_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('client_id', clientId)
    .eq('workspace_id', workspaceId)
  if (error) throw error
}
