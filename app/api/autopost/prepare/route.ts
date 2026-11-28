import { NextResponse } from 'next/server'
import { publicError } from '@/lib/api-error'
import { autoPostFeatureOn, authorizedAutopost, isUuid } from '@/lib/autopost/secret'
import { generateCaption } from '@/lib/autopost/write-caption'
import { DONE_FOR_YOU_ENABLED } from '@/lib/features'
import { isDoneForYouWorkspace } from '@/lib/agency/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const BUCKET = 'client-photos'
const SIGNED_TTL = 24 * 60 * 60

export async function POST(req: Request) {
  if (!autoPostFeatureOn()) {
    return NextResponse.json({ error: 'Tính năng tự đăng bài đang tắt.' }, { status: 404 })
  }
  if (!process.env.AUTOPOST_SECRET) {
    return NextResponse.json({ error: 'Chưa đặt AUTOPOST_SECRET nên route này đang tắt.' }, { status: 503 })
  }
  if (!authorizedAutopost(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await req.json().catch(() => ({}))
    const limit = Math.min(20, Math.max(1, Number(body?.limit) || 20))
    const onlyClient = isUuid(body?.client_id) ? body.client_id : null
    const { supabaseAdmin } = await import('@/lib/supabase/admin')

    await supabaseAdmin.rpc('release_stale_autopost', { p_minutes: 120 })

    const topic = typeof body?.topic === 'string' ? body.topic : null
    const topicTags = Array.isArray(body?.topic_tags) ? body.topic_tags.filter((t: unknown) => typeof t === 'string') : []

    const { data: picked, error: pickErr } = await supabaseAdmin.rpc('pick_next_post', {
      p_client_id: onlyClient,
      p_limit: limit,
      p_topic: topic,
      p_topic_tags: topicTags,
    })
    if (pickErr) throw pickErr

    const rows = Array.isArray(picked) ? picked : picked ? [picked] : []
    const items: any[] = []

    for (const row of rows) {
      const { data: client } = await supabaseAdmin
        .from('clients')
        .select('id, name, industry, area, brand_voice, autopost_review_mode, workspace_id')
        .eq('id', row.client_id)
        .maybeSingle()

      // Gói Làm hộ: khách không duyệt, nhưng bài VẪN phải qua tay nhân viên (hàng đợi /agency) trước khi đăng.
      // Nên luôn để needs_review, kể cả khi doanh nghiệp tắt "duyệt tay".
      const staffReview = DONE_FOR_YOU_ENABLED && !!client?.workspace_id && (await isDoneForYouWorkspace(client.workspace_id).catch(() => false))
      const needsReview = client?.autopost_review_mode !== false || staffReview

      const { data: recent } = await supabaseAdmin
        .from('autopost_queue')
        .select('caption')
        .eq('client_id', row.client_id)
        .in('status', ['posted', 'captioned', 'needs_review', 'posting'])
        .not('caption', 'is', null)
        .order('created_at', { ascending: false })
        .limit(5)

      const previousCaptions = (recent || []).map((r: any) => r.caption).filter(Boolean)
      const caption = await generateCaption({
        name: client?.name || row.client_name || 'Doanh nghiệp',
        industry: client?.industry,
        area: client?.area,
        brandVoice: client?.brand_voice,
        topic: row.topic || topic,
        aiDescription: row.ai_description,
        aiTags: row.ai_tags,
        previousCaptions,
      })

      const { data: setRes, error: setErr } = await supabaseAdmin.rpc('set_post_caption', {
        p_queue_id: row.queue_id,
        p_caption: caption,
        p_max_similarity: 0.55,
        p_needs_review: needsReview,
      })
      if (setErr) throw setErr

      let finalCaption = caption
      let captionResult = setRes
      if (setRes && setRes.ok === false && setRes.reason === 'too_similar') {
        const retry = await generateCaption({
          name: client?.name || row.client_name || 'Doanh nghiệp',
          industry: client?.industry,
          area: client?.area,
          brandVoice: client?.brand_voice,
          topic: row.topic || topic,
          aiDescription: row.ai_description,
          aiTags: row.ai_tags,
          previousCaptions: [...previousCaptions, caption],
        })
        const { data: setRes2, error: setErr2 } = await supabaseAdmin.rpc('set_post_caption', {
          p_queue_id: row.queue_id,
          p_caption: retry,
          p_max_similarity: 0.55,
          p_needs_review: needsReview,
        })
        if (setErr2) throw setErr2
        captionResult = setRes2
        finalCaption = retry
      }

      if (!captionResult || captionResult.ok === false) {
        // Để needs_review nếu không chèn được — không đẩy sang Make.
        continue
      }
      if (needsReview) {
        // Bài chờ duyệt tay, không đưa vào lượt đăng lần này.
        continue
      }

      if (!row.storage_path) continue
      const { data: signed, error: signErr } = await supabaseAdmin.storage
        .from(row.storage_bucket || BUCKET)
        .createSignedUrl(row.storage_path, SIGNED_TTL)
      if (signErr || !signed?.signedUrl) continue

      const title = (row.topic || finalCaption).split(/[.!\n]/)[0].slice(0, 80)
      items.push({
        queue_id: row.queue_id,
        client_name: row.client_name || client?.name,
        location_resource: row.location_resource,
        title,
        summary: finalCaption,
        cta_type: row.cta_type && row.cta_type !== 'NONE' ? row.cta_type : 'CALL',
        cta_url: row.cta_url || null,
        photo_url: signed.signedUrl,
        gbp_category: 'ADDITIONAL',
      })
    }

    // Kèm các bài đã duyệt (captioned) đang chờ đăng — không tạo mới.
    let waitingQuery = supabaseAdmin
      .from('autopost_queue')
      .select('id, client_id, photo_id, caption, topic, cta_type, cta_url, workspace_id')
      .eq('status', 'captioned')
      .order('created_at', { ascending: true })
      .limit(limit)
    if (onlyClient) waitingQuery = waitingQuery.eq('client_id', onlyClient)
    const { data: waiting } = await waitingQuery

    for (const q of waiting || []) {
      if (items.some((i) => i.queue_id === q.id)) continue
      if (items.length >= limit) break
      const { data: photo } = await supabaseAdmin
        .from('client_photos')
        .select('storage_path, storage_bucket, gbp_category, ai_description')
        .eq('id', q.photo_id)
        .maybeSingle()
      if (!photo?.storage_path) continue
      const { data: client } = await supabaseAdmin
        .from('clients')
        .select('name, gbp_location_resource')
        .eq('id', q.client_id)
        .maybeSingle()
      const { data: conn } = await supabaseAdmin
        .from('google_connections')
        .select('gbp_location_resource')
        .eq('client_id', q.client_id)
        .eq('status', 'connected')
        .maybeSingle()
      const location = client?.gbp_location_resource || conn?.gbp_location_resource
      if (!location) continue
      const { data: signed } = await supabaseAdmin.storage
        .from(photo.storage_bucket || BUCKET)
        .createSignedUrl(photo.storage_path, SIGNED_TTL)
      if (!signed?.signedUrl) continue
      items.push({
        queue_id: q.id,
        client_name: client?.name,
        location_resource: location,
        title: (q.topic || q.caption || '').split(/[.!\n]/)[0].slice(0, 80),
        summary: q.caption,
        cta_type: q.cta_type && q.cta_type !== 'NONE' ? q.cta_type : 'CALL',
        cta_url: q.cta_url || null,
        photo_url: signed.signedUrl,
        gbp_category: photo.gbp_category || 'ADDITIONAL',
      })
    }

    return NextResponse.json({ items })
  } catch (error: any) {
    return NextResponse.json({ error: publicError(error) }, { status: 500 })
  }
}
