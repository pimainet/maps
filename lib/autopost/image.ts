import { createHash } from 'node:crypto'
import sharp from 'sharp'
import { embedGpsJpeg } from '@/lib/autopost/geotag'
import { phashFromGray32 } from '@/lib/autopost/phash'

export const MAX_POST_BYTES = 5 * 1024 * 1024
export const MIN_GOOGLE_PX = 250
export const PREFERRED_MIN_PX = 720
export const MAX_EDGE_PX = 2048

export type NormalizedImage = {
  jpeg: Buffer
  width: number
  height: number
  sha256: string
  phash: bigint
  geotagged: boolean
  tooSmall: boolean
}

export function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex')
}

async function toJpegUnderLimit(input: Buffer, quality: number, maxEdge: number): Promise<Buffer> {
  return sharp(input, { failOn: 'none' })
    .rotate()
    .resize({
      width: maxEdge,
      height: maxEdge,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .jpeg({ quality, chromaSubsampling: '4:4:4', mozjpeg: true })
    .toBuffer()
}

export async function normalizeForPost(
  original: Buffer,
  gps?: { lat: number; lng: number; description?: string } | null,
): Promise<NormalizedImage> {
  const hash = sha256(original)

  let quality = 82
  let maxEdge = MAX_EDGE_PX
  let jpeg = await toJpegUnderLimit(original, quality, maxEdge)
  while (jpeg.length > MAX_POST_BYTES && quality > 50) {
    quality -= 8
    jpeg = await toJpegUnderLimit(original, quality, maxEdge)
  }
  while (jpeg.length > MAX_POST_BYTES && maxEdge > 1024) {
    maxEdge = Math.round(maxEdge * 0.85)
    jpeg = await toJpegUnderLimit(original, quality, maxEdge)
  }
  if (jpeg.length > MAX_POST_BYTES) {
    throw new Error('Ảnh vẫn lớn hơn 5MB sau khi nén — hãy chọn ảnh khác.')
  }

  const meta = await sharp(jpeg).metadata()
  const width = meta.width ?? 0
  const height = meta.height ?? 0
  const tooSmall = Math.min(width, height) < MIN_GOOGLE_PX

  const gray = await sharp(jpeg)
    .greyscale()
    .resize(32, 32, { fit: 'fill' })
    .raw()
    .toBuffer()
  const phash = phashFromGray32(gray)

  let geotagged = false
  let out = jpeg
  if (gps && Number.isFinite(gps.lat) && Number.isFinite(gps.lng)) {
    out = embedGpsJpeg(jpeg, gps.lat, gps.lng, gps.description)
    geotagged = true
  }

  return { jpeg: out, width, height, sha256: hash, phash, geotagged, tooSmall }
}
