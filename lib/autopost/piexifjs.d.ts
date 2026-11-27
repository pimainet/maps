declare module 'piexifjs' {
  export const ImageIFD: { ImageDescription: number; Artist: number; [key: string]: number }
  export const GPSIFD: {
    GPSLatitudeRef: number
    GPSLatitude: number
    GPSLongitudeRef: number
    GPSLongitude: number
    [key: string]: number
  }
  export function dump(exifObj: unknown): string
  export function insert(exifBytes: string, jpeg: string): string
  export function load(jpeg: string): any
  const piexif: {
    ImageIFD: typeof ImageIFD
    GPSIFD: typeof GPSIFD
    dump: typeof dump
    insert: typeof insert
    load: typeof load
  }
  export default piexif
}
