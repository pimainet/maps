export type JsonObjectResult =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; status: 400 | 413; error: string }

const DEFAULT_MAX_BODY_BYTES = 64 * 1024

export function isValidIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
}

/** Read a small JSON object safely at API boundaries. */
export async function readJsonObject(
  request: Request,
  maxBodyBytes = DEFAULT_MAX_BODY_BYTES,
): Promise<JsonObjectResult> {
  const contentLength = request.headers.get('content-length')
  if (contentLength) {
    const declaredBytes = Number(contentLength)
    if (Number.isFinite(declaredBytes) && declaredBytes > maxBodyBytes) {
      return { ok: false, status: 413, error: 'Dữ liệu gửi lên quá lớn.' }
    }
  }

  let raw: string
  try {
    raw = await request.text()
  } catch {
    return { ok: false, status: 400, error: 'Không đọc được dữ liệu gửi lên.' }
  }

  if (new TextEncoder().encode(raw).byteLength > maxBodyBytes) {
    return { ok: false, status: 413, error: 'Dữ liệu gửi lên quá lớn.' }
  }

  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return { ok: false, status: 400, error: 'Dữ liệu JSON không hợp lệ.' }
  }

  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, status: 400, error: 'Dữ liệu JSON phải là một đối tượng.' }
  }

  return { ok: true, value: value as Record<string, unknown> }
}
