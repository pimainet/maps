'use client'

export type CompetitorRow = {
  place_key: string
  title: string | null
  category: string | null
  rating: number | null
  reviews_count: number | null
  is_target: boolean
  appearances: number
  top3_count: number
  best_rank: number | null
  arp: number | null
  atrp: number | null
  solv: number | null
}

const n = (v: number | null | undefined, d = 1) => (v == null ? '—' : Number(v).toFixed(d))

/** Bảng đối thủ theo SoLV trong lần quét. Bấm 1 dòng để xem bản đồ nhiệt của địa điểm đó (dữ liệu có sẵn, không tốn lượt quét). */
export function CompetitorTable({
  rows,
  totalPoints,
  activeKey,
  onSelect,
  limit = 15,
}: {
  rows: CompetitorRow[]
  totalPoints: number
  activeKey: string | null
  onSelect: (key: string | null) => void
  limit?: number
}) {
  const target = rows.find((r) => r.is_target)
  const list = rows.filter((r) => !r.is_target).slice(0, limit)
  const all = target ? [target, ...list] : list
  if (!all.length) return <div className="empty-note">Chưa có dữ liệu đối thủ.</div>
  return (
    <div className="table-wrap">
      <table className="rg-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Địa điểm</th>
            <th title="% điểm lưới nằm trong top 3">SoLV</th>
            <th title="Hạng TB toàn lưới (ngoài top 20 = 21)">ATRP</th>
            <th title="Hạng TB ở các điểm có xuất hiện">ARP</th>
            <th>Xuất hiện</th>
            <th>Sao</th>
            <th>Đánh giá</th>
          </tr>
        </thead>
        <tbody>
          {all.map((r, i) => {
            const key = r.is_target ? null : r.place_key
            const active = (activeKey ?? null) === key
            return (
              <tr
                key={r.place_key}
                className={`${r.is_target ? 'rg-target' : ''} ${active ? 'rg-active' : ''}`}
                onClick={() => onSelect(key)}
                style={{ cursor: 'pointer' }}
                title="Bấm để xem bản đồ nhiệt của địa điểm này"
              >
                <td>{r.is_target ? '★' : i + (target ? 0 : 1)}</td>
                <td>
                  <strong>{r.title || (r.is_target ? 'Doanh nghiệp của bạn' : r.place_key)}</strong>
                  {r.category ? <small className="rg-sub">{r.category}</small> : null}
                </td>
                <td>{r.solv == null ? '—' : `${Math.round(Number(r.solv))}%`}</td>
                <td>{r.atrp == null ? '—' : Number(r.atrp) >= 21 ? '20+' : n(r.atrp)}</td>
                <td>{n(r.arp)}</td>
                <td>
                  {r.appearances}/{totalPoints}
                </td>
                <td>{n(r.rating)}</td>
                <td>{r.reviews_count ?? '—'}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
