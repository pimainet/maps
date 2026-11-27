import piexif from 'piexifjs'

function toDmsRational(deg: number): [[number, number], [number, number], [number, number]] {
  const abs = Math.abs(deg)
  const d = Math.floor(abs)
  const minFloat = (abs - d) * 60
  const m = Math.floor(minFloat)
  const s = (minFloat - m) * 60
  return [
    [d, 1],
    [m, 1],
    [Math.round(s * 10000), 10000],
  ]
}

function jpegToBinaryString(buf: Buffer): string {
  return buf.toString('binary')
}

function binaryStringToJpeg(s: string): Buffer {
  return Buffer.from(s, 'binary')
}

/** Ghi GPS (và mô tả doanh nghiệp nếu có) vào JPEG. Trả về buffer mới. */
export function embedGpsJpeg(
  jpeg: Buffer,
  lat: number,
  lng: number,
  description?: string,
): Buffer {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new Error('Toạ độ geotag không hợp lệ')
  }
  const zeroth: Record<string, unknown> = {}
  if (description) {
    zeroth[piexif.ImageIFD.ImageDescription] = description
    zeroth[piexif.ImageIFD.Artist] = description
  }
  const exifObj = {
    '0th': zeroth,
    Exif: {},
    GPS: {
      [piexif.GPSIFD.GPSLatitudeRef]: lat >= 0 ? 'N' : 'S',
      [piexif.GPSIFD.GPSLatitude]: toDmsRational(lat),
      [piexif.GPSIFD.GPSLongitudeRef]: lng >= 0 ? 'E' : 'W',
      [piexif.GPSIFD.GPSLongitude]: toDmsRational(lng),
    },
  }
  const exifBytes = piexif.dump(exifObj)
  const inserted = piexif.insert(exifBytes, jpegToBinaryString(jpeg))
  return binaryStringToJpeg(inserted)
}
