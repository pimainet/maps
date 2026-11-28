'use client'

/**
 * Lưới thứ hạng + bản đồ nhiệt của 1 khách (tính năng RANK_GRID_ENABLED).
 * Bước: xác định vị trí quán -> chọn từ khoá -> (tuỳ chọn) chỉnh lưới / tắt điểm trên biển -> quét -> đọc bản đồ, top 20 từng điểm,
 * xu hướng, bảng đối thủ. Số liệu là ƯỚC LƯỢNG tại thời điểm quét (dữ liệu bên thứ ba, không cá nhân hoá theo người tìm).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { Crosshair, MapPin, Play, Plus, RefreshCw, Settings2, Star, Trash2, Waves } from 'lucide-react'
import { Card } from '@/components/dashboard/shared'
import { useToast } from '@/components/dashboard/toast-context'
import { RANK_GRID_ENABLED } from '@/lib/features'
import { RankHeatmap, RankLegend, type HeatPoint } from '@/components/rankgrid/heatmap'
import { TrendChart } from '@/components/rankgrid/trend-chart'
import { CompetitorTable, type CompetitorRow } from '@/components/rankgrid/competitor-table'
import { buildGrid, distanceM, radiusM, type GridShape, type GridSize } from '@/lib/rankgrid/geometry'
import { weakestSector } from '@/lib/rankgrid/metrics'

type Overview = {
  providerReady: boolean
  entitlement: {
    gridSizes: number[]
    defaultGridSize: number
    maxKeywords: number
    frequency: 'weekly' | 'biweekly' | 'none'
    manualScansPerMonth: number
    trialScans: number
    monthlyPointCap: number
  }
  usage: { pointsUsed: number; manualUsed: number; trialUsed: number }
  client: { id: string; name: string; latitude: number | null; longitude: number | null }
  config: null | {
    center_lat: number
    center_lng: number
    grid_size: number
    spacing_m: number
    shape: GridShape
    disabled_points: number[]
    land_mask: { checked: number[]; water: number[] }
    target_place_id: string | null
    target_cid: string | null
    next_run_at: string | null
    active_points: number
  }
  grid: Array<HeatPoint & { row: number; col: number; dxM: number; dyM: number; inShape: boolean; disabled: boolean }>
  keywords: Array<{ id: string; keyword: string; is_primary: boolean }>
  suggestions: string[]
  scans: Array<{
    id: string
    keyword_id: string | null
    keyword: string
    status: string
    trigger: string
    points_total: number
    points_done: number
    points_failed: number
    arp: number | null
    atrp: number | null
    solv: number | null
    found_pct: number | null
    center_rank: number | null
    error: string | null
    created_at: string
    completed_at: string | null
    config: any
  }>
  suggestedSpacingM: number
}

type ScanDetail = {
  scan: Overview['scans'][number]
  points: Array<{ id: string; idx: number; row_i: number; col_i: number; lat: number; lng: number; status: string; rank: number | null; result_count: number | null; top_places: string[] }>
  competitors: Array<CompetitorRow & { place_id: string | null; cid: string | null; lat: number | null; lng: number | null }>
}

const FREQ_LABEL = { weekly: 'hàng tuần', biweekly: '2 tuần/lần', none: 'không quét định kỳ' }
const pct = (v: number | null | undefined) => (v == null ? '—' : `${Math.round(Number(v))}%`)
const STATUS_LABEL: Record<string, string> = { queued: 'Đang xếp hàng', running: 'Đang quét', done: 'Xong', partial: 'Xong một phần', failed: 'Lỗi', cancelled: 'Đã huỷ' }
const fmtDate = (s: string) => new Date(s).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Ho_Chi_Minh' })

export default function ClientRankPage() {
  const { showToast } = useToast()
  const { id: clientId } = useParams<{ id: string }>()

  const [data, setData] = useState<Overview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [kwId, setKwId] = useState<string | null>(null)
  const [scanId, setScanId] = useState<string | null>(null)
  const [detail, setDetail] = useState<ScanDetail | null>(null)
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null)
  const [viewKey, setViewKey] = useState<string | null>(null)
  const [newKw, setNewKw] = useState('')
  const [setup, setSetup] = useState(false)
  const [draft, setDraft] = useState<{ grid_size: number; spacing_m: number; shape: GridShape; center_lat: number; center_lng: number; disabled: number[] } | null>(null)
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const post = useCallback(
    async (action: string, extra: Record<string, unknown> = {}) => {
      const res = await fetch('/api/rankgrid', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: clientId, action, ...extra }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || 'Có lỗi xảy ra')
      return json
    },
    [clientId],
  )

  const applyOverview = useCallback((o: Overview) => {
    setData(o)
    setKwId((cur) => (cur && o.keywords.some((k) => k.id === cur) ? cur : o.keywords.find((k) => k.is_primary)?.id || o.keywords[0]?.id || null))
  }, [])

  const load = useCallback(async () => {
    const res = await fetch(`/api/rankgrid?client_id=${clientId}`)
    const json = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(json.error || 'Không tải được lưới thứ hạng')
    applyOverview(json as Overview)
  }, [clientId, applyOverview])

  useEffect(() => {
    if (!RANK_GRID_ENABLED) {
      setLoading(false)
      return
    }
    load()
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [load])

  const kwScans = useMemo(() => (data?.scans || []).filter((s) => s.keyword_id === kwId), [data, kwId])

  // Chọn lần quét mới nhất của từ khoá khi đổi từ khoá.
  useEffect(() => {
    const first = kwScans.find((s) => !['cancelled'].includes(s.status))
    setScanId(first?.id ?? null)
    setSelectedIdx(null)
    setViewKey(null)
  }, [kwId, kwScans.length]) // eslint-disable-line react-hooks/exhaustive-deps

  const loadDetail = useCallback(async (id: string) => {
    const res = await fetch(`/api/rankgrid/scan?id=${id}`)
    const json = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(json.error || 'Không tải được lần quét')
    setDetail(json as ScanDetail)
    return json as ScanDetail
  }, [])

  // Tải chi tiết + hỏi lại mỗi 5 giây khi đang quét.
  useEffect(() => {
    if (pollRef.current) clearTimeout(pollRef.current)
    if (!scanId) {
      setDetail(null)
      return
    }
    let stop = false
    const tick = async () => {
      try {
        const d = await loadDetail(scanId)
        if (!stop && ['queued', 'running'].includes(d.scan.status)) pollRef.current = setTimeout(tick, 5000)
        else if (!stop && d.scan.status !== 'running') load().catch(() => {})
      } catch (e: any) {
        if (!stop) showToast(e.message)
      }
    }
    tick()
    return () => {
      stop = true
      if (pollRef.current) clearTimeout(pollRef.current)
    }
  }, [scanId]) // eslint-disable-line react-hooks/exhaustive-deps

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(label)
    try {
      await fn()
    } catch (e: any) {
      showToast(e.message || 'Có lỗi xảy ra')
    } finally {
      setBusy('')
    }
  }

  const resolveIdentity = () =>
    run('identity', async () => {
      const r = await post('identity')
      applyOverview(r)
      showToast(r.identity?.needsConfirm ? 'Đã tìm theo tên + khu vực — hãy kiểm tra đúng quán trên bản đồ.' : 'Đã xác định vị trí doanh nghiệp')
    })

  const addKeyword = (kw: string, source = 'manual') =>
    run('kw', async () => {
      applyOverview(await post('add_keyword', { keyword: kw, source }))
      setNewKw('')
    })

  const startScan = () =>
    run('scan', async () => {
      if (!kwId) throw new Error('Chọn từ khoá trước')
      const r = await post('scan', { keyword_id: kwId })
      showToast(`Đã gửi ${r.points} điểm, kết quả về trong khoảng 1–3 phút`)
      await load()
      setScanId(r.scan_id)
    })

  function openSetup() {
    if (!data?.config) return
    const c = data.config
    setDraft({ grid_size: c.grid_size, spacing_m: c.spacing_m, shape: c.shape, center_lat: c.center_lat, center_lng: c.center_lng, disabled: [...c.disabled_points] })
    setSetup(true)
  }

  const draftGrid = useMemo(() => {
    if (!draft || !data?.config) return []
    const water = new Set(
      draft.grid_size === data.config.grid_size && draft.spacing_m === data.config.spacing_m && draft.shape === data.config.shape && draft.center_lat === data.config.center_lat && draft.center_lng === data.config.center_lng
        ? data.config.land_mask.water
        : [],
    )
    return buildGrid(
      { centerLat: draft.center_lat, centerLng: draft.center_lng, size: draft.grid_size as GridSize, spacingM: draft.spacing_m, shape: draft.shape },
      [...draft.disabled, ...water],
    )
  }, [draft, data])

  const saveSetup = () =>
    run('config', async () => {
      if (!draft) return
      applyOverview(
        await post('config', {
          grid_size: draft.grid_size,
          spacing_m: draft.spacing_m,
          shape: draft.shape,
          center_lat: draft.center_lat,
          center_lng: draft.center_lng,
          disabled_points: draft.disabled,
        }),
      )
      setSetup(false)
      showToast('Đã lưu cài đặt lưới')
    })

  const waterCheck = () =>
    run('water', async () => {
      // Lưu hình học trước để kiểm đúng lưới đang xem.
      if (draft) await saveSetupSilently()
      let remaining = 1
      let found = 0
      for (let i = 0; i < 6 && remaining > 0; i++) {
        const r = await post('water_check')
        remaining = r.remaining
        found += (r.newly_water || []).length
        applyOverview(r)
      }
      showToast(remaining > 0 ? `Đã kiểm một phần, còn ${remaining} điểm — bấm lại để kiểm tiếp` : `Đã kiểm xong: ${found} điểm nằm trên mặt nước được tắt`)
    })

  async function saveSetupSilently() {
    if (!draft) return
    applyOverview(
      await post('config', { grid_size: draft.grid_size, spacing_m: draft.spacing_m, shape: draft.shape, center_lat: draft.center_lat, center_lng: draft.center_lng, disabled_points: draft.disabled }),
    )
  }

  // ---- Hiển thị kết quả ----
  const resultPoints: HeatPoint[] = useMemo(() => {
    if (!detail) return []
    const targetKey = detail.competitors.find((c) => c.is_target)?.place_key
    return detail.points.map((p) => {
      let rank: number | null = p.rank
      if (viewKey && viewKey !== targetKey) {
        const i = (p.top_places || []).indexOf(viewKey)
        rank = i >= 0 ? i + 1 : null
      }
      return { idx: p.idx, lat: p.lat, lng: p.lng, rank, status: p.status }
    })
  }, [detail, viewKey])

  const compByKey = useMemo(() => new Map((detail?.competitors || []).map((c) => [c.place_key, c])), [detail])
  const selectedPoint = detail?.points.find((p) => p.idx === selectedIdx) || null

  const trend = useMemo(
    () =>
      kwScans
        .filter((s) => ['done', 'partial'].includes(s.status))
        .slice()
        .reverse()
        .map((s) => ({ date: s.completed_at || s.created_at, solv: s.solv, atrp: s.atrp })),
    [kwScans],
  )

  const insight = useMemo(() => {
    if (!detail || !['done', 'partial'].includes(detail.scan.status)) return null
    const size = Number(detail.scan.config?.grid_size) || 5
    const geo = buildGrid({ centerLat: 0, centerLng: 0, size: size as GridSize, spacingM: Number(detail.scan.config?.spacing_m) || 700, shape: 'square' })
    const weak = weakestSector(detail.points.filter((p) => p.status === 'done').map((p) => ({ rank: p.rank, dxM: geo[p.idx]?.dxM ?? 0, dyM: geo[p.idx]?.dyM ?? 0 })))
    const leader = detail.competitors.find((c) => !c.is_target)
    const parts = [`Bạn đứng top 3 ở ${pct(detail.scan.solv)} khu vực quanh quán.`]
    if (weak && weak.solv < (Number(detail.scan.solv) || 0)) parts.push(`Yếu nhất ở ${weak.label} (top 3 ở ${pct(weak.solv)} số điểm).`)
    if (leader?.title) parts.push(`Đối thủ dẫn đầu: ${leader.title} — top 3 ở ${pct(leader.solv)} khu vực${leader.reviews_count != null ? `, ${leader.reviews_count} đánh giá` : ''}.`)
    return parts.join(' ')
  }, [detail])

  // ---- Trạng thái trang ----
  if (!RANK_GRID_ENABLED) {
    return (
      <Card>
        <div className="empty-note">Tính năng lưới thứ hạng đang tắt.</div>
      </Card>
    )
  }
  if (loading) return <Card><div className="empty-note">Đang tải lưới thứ hạng…</div></Card>
  if (error || !data) return <Card><div className="empty-note error">{error || 'Có lỗi xảy ra'}</div></Card>

  const ent = data.entitlement
  const canManual = ent.manualScansPerMonth > 0 ? data.usage.manualUsed < ent.manualScansPerMonth : ent.trialScans > 0 && data.usage.trialUsed < ent.trialScans
  const scanBtnLabel = ent.manualScansPerMonth > 0 ? `Quét ngay (còn ${Math.max(0, ent.manualScansPerMonth - data.usage.manualUsed)}/${ent.manualScansPerMonth} lần tháng này)` : canManual ? 'Quét thử miễn phí (1 lần)' : 'Đã dùng lượt quét thử'
  const center = data.config ? { lat: data.config.center_lat, lng: data.config.center_lng } : null
  const scan = detail?.scan

  return (
    <>
      <Card>
        <div className="section-head">
          <div>
            <h2>Lưới thứ hạng Google Maps</h2>
            <p>
              Đo quán đứng thứ mấy khi khách tìm ở nhiều điểm quanh cửa hàng. Gói hiện tại: lưới {ent.gridSizes.map((s) => `${s}×${s}`).join(' / ')}, tối đa {ent.maxKeywords} từ khoá, {FREQ_LABEL[ent.frequency]}
              {ent.manualScansPerMonth ? `, ${ent.manualScansPerMonth} lần quét tay/tháng` : ''}. Kết quả là ước lượng tại thời điểm quét.
            </p>
          </div>
          <Link href={`/clients/${clientId}`} className="secondary-button">
            Về doanh nghiệp
          </Link>
        </div>
        {!data.providerReady && <p className="empty-note error">Chưa cấu hình nguồn dữ liệu (DATAFORSEO_LOGIN/DATAFORSEO_PASSWORD) nên chưa quét được.</p>}

        {!data.config ? (
          <div className="hero-actions" style={{ flexWrap: 'wrap' }}>
            <p className="empty-note" style={{ width: '100%' }}>
              Bước 1: xác định vị trí ghim Google Maps và mã place_id của quán (lấy từ link Google Maps / tên + khu vực đã lưu).
            </p>
            <button className="primary-button" onClick={resolveIdentity} disabled={!!busy}>
              <MapPin size={18} /> {busy === 'identity' ? 'Đang tìm…' : 'Xác định vị trí doanh nghiệp'}
            </button>
          </div>
        ) : (
          <div className="rg-toolbar">
            <span className="rg-chip">
              Lưới {data.config.grid_size}×{data.config.grid_size} · {data.config.active_points} điểm · bán kính {(radiusM(data.config.grid_size, data.config.spacing_m) / 1000).toFixed(1)} km
            </span>
            <span className="rg-chip">Đã dùng {data.usage.pointsUsed}/{ent.monthlyPointCap} điểm tháng này</span>
            {data.config.next_run_at && ent.frequency !== 'none' && <span className="rg-chip">Lần quét định kỳ tới: {fmtDate(data.config.next_run_at)}</span>}
            <button className="secondary-button" onClick={setup ? () => setSetup(false) : openSetup}>
              <Settings2 size={16} /> {setup ? 'Đóng cài đặt' : 'Cài đặt lưới'}
            </button>
            <button className="secondary-button" onClick={resolveIdentity} disabled={!!busy} title="Tìm lại vị trí / place_id">
              <Crosshair size={16} /> Xác định lại vị trí
            </button>
          </div>
        )}
      </Card>

      {data.config && setup && draft && center && (
        <Card>
          <h2>Cài đặt lưới</h2>
          <p className="empty-note">Bấm vào một điểm trên bản đồ để tắt/bật (ví dụ điểm trên biển, ngoài vùng phục vụ). Điểm tắt không bị quét và không tính hạn mức.</p>
          <div className="rg-form">
            <label>
              Cỡ lưới
              <select value={draft.grid_size} onChange={(e) => setDraft({ ...draft, grid_size: Number(e.target.value), disabled: [] })}>
                {ent.gridSizes.map((s) => (
                  <option key={s} value={s}>{s}×{s}</option>
                ))}
              </select>
            </label>
            <label>
              Khoảng cách điểm (m)
              <input type="number" min={200} max={5000} step={50} value={draft.spacing_m} onChange={(e) => setDraft({ ...draft, spacing_m: Number(e.target.value) })} />
              <small>Gợi ý theo ngành: {data.suggestedSpacingM}m</small>
            </label>
            <label>
              Hình lưới
              <select value={draft.shape} onChange={(e) => setDraft({ ...draft, shape: e.target.value as GridShape })}>
                <option value="circle">Tròn (khuyên dùng)</option>
                <option value="square">Vuông</option>
              </select>
            </label>
            <label>
              Tâm (lat, lng)
              <input value={`${draft.center_lat}, ${draft.center_lng}`} onChange={(e) => {
                const [a, b] = e.target.value.split(',').map((x) => Number(x.trim()))
                if (Number.isFinite(a) && Number.isFinite(b)) setDraft({ ...draft, center_lat: a, center_lng: b })
              }} />
              {data.client.latitude != null && (
                <small>
                  <button type="button" className="link-button" onClick={() => setDraft({ ...draft, center_lat: Number(data.client.latitude), center_lng: Number(data.client.longitude) })}>Đặt tâm về vị trí quán</button>
                </small>
              )}
            </label>
          </div>
          <p className="empty-note">
            {draftGrid.filter((p) => p.inShape && !p.disabled).length} điểm sẽ quét · bán kính {(radiusM(draft.grid_size, draft.spacing_m) / 1000).toFixed(1)} km
          </p>
          <RankHeatmap
            center={{ lat: draft.center_lat, lng: draft.center_lng }}
            points={draftGrid}
            mode="setup"
            centerLabel={data.client.name}
            onPointClick={(idx) => {
              const off = new Set(draft.disabled)
              off.has(idx) ? off.delete(idx) : off.add(idx)
              setDraft({ ...draft, disabled: [...off] })
            }}
          />
          <div className="hero-actions" style={{ marginTop: 12, flexWrap: 'wrap' }}>
            <button className="primary-button" onClick={saveSetup} disabled={!!busy}>{busy === 'config' ? 'Đang lưu…' : 'Lưu cài đặt'}</button>
            <button className="secondary-button" onClick={waterCheck} disabled={!!busy}>
              <Waves size={16} /> {busy === 'water' ? 'Đang kiểm tra (≈1 giây/điểm)…' : 'Tự tắt điểm trên biển/sông'}
            </button>
          </div>
        </Card>
      )}

      {data.config && (
        <Card>
          <h2>Từ khoá theo dõi ({data.keywords.length}/{ent.maxKeywords})</h2>
          <div className="rg-kw-list">
            {data.keywords.map((k) => (
              <span key={k.id} className={`rg-kw ${k.id === kwId ? 'active' : ''}`}>
                <button type="button" onClick={() => setKwId(k.id)}>{k.is_primary ? <Star size={13} /> : null} {k.keyword}</button>
                {!k.is_primary && (
                  <button type="button" title="Đặt làm từ khoá chính" onClick={() => run('kw', async () => applyOverview(await post('set_primary', { keyword_id: k.id })))}>
                    <Star size={13} />
                  </button>
                )}
                <button type="button" title="Bỏ theo dõi" onClick={() => run('kw', async () => applyOverview(await post('remove_keyword', { keyword_id: k.id })))}>
                  <Trash2 size={13} />
                </button>
              </span>
            ))}
          </div>
          {data.keywords.length < ent.maxKeywords && (
            <>
              <form
                className="rg-kw-add"
                onSubmit={(e) => {
                  e.preventDefault()
                  if (newKw.trim()) addKeyword(newKw.trim())
                }}
              >
                <input value={newKw} onChange={(e) => setNewKw(e.target.value)} placeholder="vd: spa sầm sơn, nha khoa thanh hóa, niềng răng" maxLength={80} />
                <button className="secondary-button" disabled={!!busy || !newKw.trim()}><Plus size={16} /> Thêm</button>
              </form>
              {data.suggestions.length > 0 && (
                <div className="rg-kw-list">
                  <small className="rg-sub">Gợi ý:</small>
                  {data.suggestions.map((s) => (
                    <button key={s} type="button" className="rg-chip rg-chip-btn" onClick={() => addKeyword(s, 'suggested')} disabled={!!busy}>
                      + {s}
                    </button>
                  ))}
                </div>
              )}
              <p className="empty-note">Nên có: 1 từ khoá ngành không kèm địa danh, 1 có tên thành phố, và các dịch vụ chính. Không cần thêm “gần đây”.</p>
            </>
          )}
        </Card>
      )}

      {data.config && kwId && center && (
        <Card>
          <div className="section-head">
            <div>
              <h2>Bản đồ nhiệt: “{data.keywords.find((k) => k.id === kwId)?.keyword}”</h2>
              <p>{insight || 'Chọn lần quét hoặc bấm quét để xem bản đồ.'}</p>
            </div>
            <div className="hero-actions" style={{ flexWrap: 'wrap' }}>
              {kwScans.length > 0 && (
                <select value={scanId ?? ''} onChange={(e) => setScanId(e.target.value || null)} className="rg-select">
                  {kwScans.map((s) => (
                    <option key={s.id} value={s.id}>
                      {fmtDate(s.created_at)} · {STATUS_LABEL[s.status] || s.status}
                      {s.solv != null ? ` · SoLV ${pct(s.solv)}` : ''}
                    </option>
                  ))}
                </select>
              )}
              <button className="primary-button" onClick={startScan} disabled={!!busy || !canManual || !data.providerReady}>
                <Play size={16} /> {busy === 'scan' ? 'Đang gửi…' : scanBtnLabel}
              </button>
            </div>
          </div>

          {scan && (
            <div className="metrics-grid rg-metrics">
              <div><span>SoLV (top 3)</span><strong>{pct(scan.solv)}</strong></div>
              <div><span>ATRP (hạng TB toàn lưới)</span><strong>{scan.atrp == null ? '—' : Number(scan.atrp) >= 21 ? '20+' : Number(scan.atrp).toFixed(1)}</strong></div>
              <div><span>ARP (nơi có xuất hiện)</span><strong>{scan.arp == null ? '—' : Number(scan.arp).toFixed(1)}</strong></div>
              <div><span>Xuất hiện trong top 20</span><strong>{pct(scan.found_pct)}</strong></div>
            </div>
          )}
          {scan && ['queued', 'running'].includes(scan.status) && (
            <p className="empty-note">
              <RefreshCw size={14} /> Đang quét: {scan.points_done}/{scan.points_total} điểm có kết quả… (trang tự cập nhật)
            </p>
          )}
          {scan?.status === 'partial' && <p className="empty-note">Có {scan.points_failed} điểm lỗi; chỉ số tính trên {scan.points_done} điểm còn lại.</p>}
          {scan?.error && <p className="empty-note error">{scan.error}</p>}
          {viewKey && (
            <p className="empty-note">
              Đang xem bản đồ của: <strong>{compByKey.get(viewKey)?.title || viewKey}</strong>{' '}
              <button type="button" className="link-button" onClick={() => setViewKey(null)}>Quay về quán của bạn</button>
            </p>
          )}

          <div className="rg-layout">
            <div>
              <RankHeatmap
                center={center}
                points={detail ? resultPoints : (data.grid.filter((p) => p.inShape && !p.disabled) as HeatPoint[]).map((p) => ({ ...p, status: 'pending' }))}
                selectedIdx={selectedIdx}
                onPointClick={setSelectedIdx}
                centerLabel={data.client.name}
              />
              <RankLegend />
            </div>
            <div className="rg-panel">
              {!selectedPoint ? (
                <div className="empty-note">Bấm vào một điểm trên bản đồ để xem 20 kết quả đầu tại vị trí đó.</div>
              ) : (
                <>
                  <h3>
                    Điểm cách quán {(distanceM(center.lat, center.lng, selectedPoint.lat, selectedPoint.lng) / 1000).toFixed(1)} km
                  </h3>
                  <p className="rg-sub">
                    {selectedPoint.status !== 'done'
                      ? 'Chưa có kết quả ở điểm này.'
                      : selectedPoint.rank
                        ? `Quán bạn đứng #${selectedPoint.rank} trong ${selectedPoint.result_count ?? (selectedPoint.top_places || []).length} kết quả.`
                        : 'Quán bạn không nằm trong 20 kết quả đầu.'}
                  </p>
                  <ol className="rg-top20">
                    {(selectedPoint.top_places || []).map((key, i) => {
                      const c = compByKey.get(key)
                      const d = c?.lat != null && c?.lng != null ? distanceM(selectedPoint.lat, selectedPoint.lng, Number(c.lat), Number(c.lng)) : null
                      return (
                        <li key={key + i} className={c?.is_target ? 'rg-target' : key === viewKey ? 'rg-active' : ''} onClick={() => setViewKey(c?.is_target ? null : key)}>
                          <span className="rg-rank">{i + 1}</span>
                          <span>
                            <strong>{c?.title || key}</strong>
                            <small className="rg-sub">
                              {[c?.category, c?.rating != null ? `${Number(c.rating).toFixed(1)}★` : null, c?.reviews_count != null ? `${c.reviews_count} đánh giá` : null, d != null ? `${(d / 1000).toFixed(1)} km` : null]
                                .filter(Boolean)
                                .join(' · ')}
                            </small>
                          </span>
                        </li>
                      )
                    })}
                  </ol>
                </>
              )}
            </div>
          </div>
        </Card>
      )}

      {data.config && kwId && (
        <div className="grid-2">
          <Card>
            <h2>Xu hướng</h2>
            <TrendChart data={trend} />
          </Card>
          <Card>
            <h2>Đối thủ trong lưới</h2>
            <p className="empty-note">Xếp theo SoLV. Bấm một dòng để xem bản đồ nhiệt của địa điểm đó.</p>
            {detail ? (
              <CompetitorTable rows={detail.competitors} totalPoints={detail.scan.points_done || detail.points.length} activeKey={viewKey} onSelect={setViewKey} />
            ) : (
              <div className="empty-note">Chưa có lần quét.</div>
            )}
          </Card>
        </div>
      )}
    </>
  )
}
