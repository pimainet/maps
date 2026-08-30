import { supabase } from './supabase'

export async function getClients() {
  const { data, error } = await supabase
    .from('clients')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) throw error
  return data
}

export async function createClient(client: {
  name: string
  industry?: string
  area?: string
  phone?: string
  contact_name?: string
  brand_voice?: string
  gbp_link?: string
  website_url?: string
  notes?: string
}) {
  const { data, error } = await supabase
    .from('clients')
    .insert(client)
    .select()
    .single()

  if (error) throw error
  return data
}

export async function saveAudit(input: {
  client_id: string
  audit_result: string
  raw_input?: any
  score_overview?: number
}) {
  const { data, error } = await supabase
    .from('audits')
    .insert({
      client_id: input.client_id,
      audit_result: input.audit_result,
      raw_input: input.raw_input ?? {},
      score_overview: input.score_overview ?? null,
      module_key: 'maps_seo',
      status: 'finalized',
    })
    .select()
    .single()

  if (error) throw error
  return data
}

export async function savePlan(input: {
  client_id: string
  audit_id?: string
  plan_result: string
  start_date?: string
  end_date?: string
}) {
  const { data, error } = await supabase
    .from('plans')
    .insert({
      client_id: input.client_id,
      audit_id: input.audit_id ?? null,
      plan_result: input.plan_result,
      start_date: input.start_date ?? null,
      end_date: input.end_date ?? null,
      module_key: 'maps_seo',
      status: 'draft',
    })
    .select()
    .single()

  if (error) throw error
  return data
}

export async function saveContent(input: {
  client_id: string
  plan_id?: string
  topic?: string
  goal?: string
  serp_analysis?: string
  ai_content?: string
  critic_feedback?: string
  final_content?: string
  scheduled_date?: string
  status?: string
}) {
  const { data, error } = await supabase
    .from('contents')
    .insert({
      client_id: input.client_id,
      plan_id: input.plan_id ?? null,
      topic: input.topic ?? null,
      goal: input.goal ?? null,
      serp_analysis: input.serp_analysis ?? null,
      ai_content: input.ai_content ?? null,
      critic_feedback: input.critic_feedback ?? null,
      final_content: input.final_content ?? null,
      scheduled_date: input.scheduled_date ?? null,
      channel: 'gbp_post',
      module_key: 'maps_seo',
      status: input.status ?? 'drafted',
    })
    .select()
    .single()

  if (error) throw error
  return data
}