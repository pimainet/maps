import { supabaseAdmin } from '@/lib/supabase/admin'
import { MIN_GOOGLE_PX, normalizeForPost } from '@/lib/autopost/image'
import { tagPhotoWithClaude } from '@/lib/autopost/vision'

const BUCKET = 'client-photos'
const QUALITY_READY = 0.5
const NEAR_DUP_THRESHOLD = 6

type PhotoRow = {
  id: string
  workspace_id: string
  client_id: string
  original_path: string | null
  status: string
}

type ClientRow = {
  id: string
  name: string | null
  industry: string | null
  area: string | null
  latitude: number | null
  longitude: number | null
}

export type ProcessResult = {
  id: string
  status: string
  reject_reason: string | null
  duplicate_of: string | null
}

export async function processClientPhoto(photoId: string): Promise<ProcessResult> {
  const { data: photo, error: photoErr } = await supabaseAdmin
    .from('client_photos')
    .select('id, workspace_id, client_id, original_path, status')
    .eq('id', photoId)
    .maybeSingle()
  if (photoErr) throw photoErr
  if (!photo) throw new Error('Không tìm thấy ảnh này')
  const row = photo as PhotoRow
  if (!row.original_path) throw new Error('Ảnh chưa có file gốc')

  await supabaseAdmin
    .from('client_photos')
    .update({ status: 'processing', processing_error: null })
    .eq('id', photoId)

  try {
    const { data: file, error: dlErr } = await supabaseAdmin.storage.from(BUCKET).download(row.original_path)
    if (dlErr || !file) throw new Error('Không tải được file gốc từ kho ảnh')
    const original = Buffer.from(await file.arrayBuffer())

    const { data: client, error: clientErr } = await supabaseAdmin
      .from('clients')
      .select('id, name, industry, area, latitude, longitude')
      .eq('id', row.client_id)
      .maybeSingle()
    if (clientErr) throw clientErr
    if (!client) throw new Error('Không tìm thấy doanh nghiệp của ảnh')
    const c = client as ClientRow

    const gps =
      c.latitude != null && c.longitude != null
        ? {
            lat: Number(c.latitude),
            lng: Number(c.longitude),
            description: [c.name, c.area].filter(Boolean).join(' – ') || undefined,
          }
        : null

    const normalized = await normalizeForPost(original, gps)
    const phash = normalized.phash.toString()

    const { data: existingSha } = await supabaseAdmin
      .from('client_photos')
      .select('id')
      .eq('client_id', row.client_id)
      .eq('sha256', normalized.sha256)
      .neq('id', photoId)
      .maybeSingle()
    if (existingSha?.id) {
      await supabaseAdmin.storage.from(BUCKET).remove([row.original_path])
      await supabaseAdmin
        .from('client_photos')
        .update({
          status: 'duplicate',
          sha256: normalized.sha256,
          duplicate_of: existingSha.id,
          reject_reason: 'Ảnh này đã được gửi trước đó',
          processing_error: null,
        })
        .eq('id', photoId)
      return { id: photoId, status: 'duplicate', reject_reason: 'Ảnh này đã được gửi trước đó', duplicate_of: existingSha.id }
    }

    const { data: nearDup, error: nearErr } = await supabaseAdmin.rpc('find_near_duplicate_photo', {
      p_client_id: row.client_id,
      p_phash: phash,
      p_exclude: photoId,
      p_threshold: NEAR_DUP_THRESHOLD,
    })
    if (nearErr) throw nearErr

    const processedPath = `${row.workspace_id}/${row.client_id}/${photoId}.jpg`
    const baseMeta = {
      sha256: normalized.sha256,
      phash,
      width: normalized.width,
      height: normalized.height,
      geotagged: normalized.geotagged,
      lat: gps?.lat ?? null,
      lng: gps?.lng ?? null,
      storage_path: processedPath,
      storage_bucket: BUCKET,
      processing_error: null as string | null,
    }

    if (nearDup) {
      await supabaseAdmin.storage.from(BUCKET).upload(processedPath, normalized.jpeg, {
        contentType: 'image/jpeg',
        upsert: true,
      })
      await supabaseAdmin
        .from('client_photos')
        .update({
          ...baseMeta,
          status: 'duplicate',
          duplicate_of: nearDup,
          reject_reason: 'Ảnh gần trùng với một ảnh đã có trong kho',
        })
        .eq('id', photoId)
      return {
        id: photoId,
        status: 'duplicate',
        reject_reason: 'Ảnh gần trùng với một ảnh đã có trong kho',
        duplicate_of: String(nearDup),
      }
    }

    if (normalized.tooSmall || Math.min(normalized.width, normalized.height) < MIN_GOOGLE_PX) {
      await supabaseAdmin
        .from('client_photos')
        .update({
          ...baseMeta,
          storage_path: null,
          status: 'rejected',
          reject_reason: `Ảnh nhỏ hơn ${MIN_GOOGLE_PX}px — Google sẽ không nhận`,
        })
        .eq('id', photoId)
      return {
        id: photoId,
        status: 'rejected',
        reject_reason: `Ảnh nhỏ hơn ${MIN_GOOGLE_PX}px — Google sẽ không nhận`,
        duplicate_of: null,
      }
    }

    const vision = await tagPhotoWithClaude({
      jpeg: normalized.jpeg,
      industry: c.industry,
      name: c.name,
      area: c.area,
    })

    let status = 'ready'
    let reject = vision.reject_reason
    if (vision.quality < QUALITY_READY) {
      status = 'rejected'
      reject = reject || 'Ảnh chưa đủ nét hoặc sáng để đăng'
    }

    const { error: upErr } = await supabaseAdmin.storage.from(BUCKET).upload(processedPath, normalized.jpeg, {
      contentType: 'image/jpeg',
      upsert: true,
    })
    if (upErr) throw upErr

    await supabaseAdmin
      .from('client_photos')
      .update({
        ...baseMeta,
        status,
        ai_description: vision.description || null,
        ai_tags: vision.tags,
        gbp_category: vision.gbp_category,
        quality_score: vision.quality,
        reject_reason: status === 'rejected' ? reject : null,
      })
      .eq('id', photoId)

    return { id: photoId, status, reject_reason: status === 'rejected' ? reject : null, duplicate_of: null }
  } catch (err: any) {
    const message = typeof err?.message === 'string' ? err.message.slice(0, 500) : 'Lỗi xử lý ảnh'
    await supabaseAdmin
      .from('client_photos')
      .update({ status: 'error', processing_error: message })
      .eq('id', photoId)
    throw err
  }
}
