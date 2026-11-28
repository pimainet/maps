/**
 * DataForSEO Google Maps SERP cho lưới thứ hạng.
 *  - Quét theo lịch: task_post hàng đợi Standard ($0,0006/điểm) + pingback.
 *  - "Quét ngay": task_post priority=2 ($0,0012/điểm, ~1 phút) + pingback.
 *  - Kiểm tra lại 1 điểm: live/advanced ($0,002).
 * Dùng chung DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD với lib/gbp-dataforseo.ts.
 */
import { parseDfsMapsTask, type ParsedTask } from './parse'

const API = 'https://api.dataforseo.com/v3'
export const DFS_MAX_TASKS_PER_POST = 100

export type ScanMode = 'standard' | 'priority' | 'live'
export const COST_PER_POINT_USD: Record<ScanMode, number> = { standard: 0.0006, priority: 0.0012, live: 0.002 }

export function rankgridProviderConfigured(): boolean {
  return Boolean(process.env.DATAFORSEO_LOGIN && process.env.DATAFORSEO_PASSWORD)
}

function authHeader(): string {
  const login = process.env.DATAFORSEO_LOGIN
  const pass = process.env.DATAFORSEO_PASSWORD
  if (!login || !pass) throw new Error('Chưa cấu hình DATAFORSEO_LOGIN/DATAFORSEO_PASSWORD')
  return `Basic ${Buffer.from(`${login}:${pass}`).toString('base64')}`
}

async function dfs(path: string, init?: { method?: 'GET' | 'POST'; body?: unknown; timeoutMs?: number }): Promise<any> {
  const res = await fetch(`${API}${path}`, {
    method: init?.method ?? 'GET',
    headers: { Authorization: authHeader(), 'Content-Type': 'application/json' },
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
    signal: AbortSignal.timeout(init?.timeoutMs ?? 30_000),
  })
  const json = await res.json().catch(() => null)
  if (!res.ok || !json) throw new Error(`DataForSEO HTTP ${res.status}`)
  if (json.status_code && json.status_code !== 20000) throw new Error(`DataForSEO ${json.status_code} ${String(json.status_message || '').slice(0, 120)}`)
  return json
}

export type MapsQuery = {
  keyword: string
  lat: number
  lng: number
  zoom: number
  device: 'mobile' | 'desktop'
  languageCode: string
}

/** Tham số chung — xem DESIGN.md mục 2.1 (cần hiệu chỉnh zoom / search_this_area bằng điện thoại thật). */
export function buildMapsTask(q: MapsQuery, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    keyword: q.keyword,
    location_coordinate: `${q.lat.toFixed(7)},${q.lng.toFixed(7)},${q.zoom}z`,
    language_code: q.languageCode || 'vi',
    device: q.device,
    os: q.device === 'mobile' ? 'android' : 'windows',
    depth: 20,
    search_this_area: process.env.RANKGRID_SEARCH_THIS_AREA === 'true',
    search_places: false,
    ...extra,
  }
}

export type PostedTask = { tag: string; taskId: string | null; error: string | null }

/** Gửi tối đa 100 task/lần. `tag` = id điểm lưới. */
export async function postMapsTasks(
  items: Array<{ tag: string; query: MapsQuery; pingbackUrl: string }>,
  mode: 'standard' | 'priority',
): Promise<PostedTask[]> {
  const out: PostedTask[] = []
  for (let i = 0; i < items.length; i += DFS_MAX_TASKS_PER_POST) {
    const chunk = items.slice(i, i + DFS_MAX_TASKS_PER_POST)
    const body = chunk.map((it) =>
      buildMapsTask(it.query, { tag: it.tag, pingback_url: it.pingbackUrl, priority: mode === 'priority' ? 2 : 1 }),
    )
    try {
      const json = await dfs('/serp/google/maps/task_post', { method: 'POST', body, timeoutMs: 45_000 })
      const tasks: any[] = Array.isArray(json.tasks) ? json.tasks : []
      const byTag = new Map<string, any>()
      for (const t of tasks) if (t?.data?.tag) byTag.set(String(t.data.tag), t)
      chunk.forEach((it, j) => {
        const t = byTag.get(it.tag) ?? tasks[j]
        const ok = t && (t.status_code === 20100 || t.status_code === 20000) && t.id
        out.push({ tag: it.tag, taskId: ok ? String(t.id) : null, error: ok ? null : `${t?.status_code ?? '?'} ${t?.status_message ?? 'không tạo được task'}` })
      })
    } catch (e: any) {
      for (const it of chunk) out.push({ tag: it.tag, taskId: null, error: String(e?.message || e).slice(0, 200) })
    }
  }
  return out
}

export async function getMapsTask(taskId: string): Promise<ParsedTask> {
  try {
    const json = await dfs(`/serp/google/maps/task_get/advanced/${encodeURIComponent(taskId)}`)
    return parseDfsMapsTask(json?.tasks?.[0])
  } catch (e: any) {
    return { ok: false, error: String(e?.message || e).slice(0, 200), retryable: true }
  }
}

export async function liveMapsQuery(q: MapsQuery): Promise<ParsedTask> {
  try {
    const json = await dfs('/serp/google/maps/live/advanced', { method: 'POST', body: [buildMapsTask(q)], timeoutMs: 60_000 })
    return parseDfsMapsTask(json?.tasks?.[0])
  } catch (e: any) {
    return { ok: false, error: String(e?.message || e).slice(0, 200), retryable: true }
  }
}

/** Các task đã xong nhưng chưa lấy (pingback bị lỡ). */
export async function mapsTasksReady(): Promise<Array<{ id: string; tag: string | null }>> {
  const json = await dfs('/serp/google/maps/tasks_ready')
  const out: Array<{ id: string; tag: string | null }> = []
  for (const t of json?.tasks || []) for (const r of t?.result || []) if (r?.id) out.push({ id: String(r.id), tag: r.tag ? String(r.tag) : null })
  return out
}

/** Số dư tài khoản (USD) — để cảnh báo trước khi hết tiền. null = không đọc được. */
export async function dfsBalanceUsd(): Promise<number | null> {
  try {
    const json = await dfs('/appendix/user_data')
    const b = json?.tasks?.[0]?.result?.[0]?.money?.balance
    return typeof b === 'number' ? b : null
  } catch {
    return null
  }
}
