'use client'

// Hiển thị báo cáo tháng (dùng cho khách ở /clients/[id]/monthly-report và nhân viên ở /agency/report).
import { Card } from '@/components/dashboard/shared'
import { deltaText, type KeywordRow, type MonthlyReport } from '@/lib/agency/report'

const pct = (n: number | null | undefined) => (n == null ? '—' : `${Math.round(n)}%`)
const TREND: Record<KeywordRow['trend'], { label: string; color: string }> = {
  up: { label: '▲ Tăng', color: 'var(--success)' },
  down: { label: '▼ Giảm', color: 'var(--danger)' },
  flat: { label: '● Ổn định', color: 'var(--muted-foreground)' },
  new: { label: '● Mới', color: 'var(--muted-foreground)' },
  none: { label: '—', color: 'var(--muted-foreground)' },
}

export function ReportView({ report }: { report: MonthlyReport }) {
  const r = report.rank
  const w = report.work
  return (
    <>
      <Card>
        <div className="section-head">
          <div>
            <h2>Báo cáo {report.periodLabel} · {report.clientName}</h2>
            <p>Tóm tắt những gì đã làm và vị trí của bạn trên Google Maps.</p>
          </div>
        </div>
        <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7, fontSize: 14.5 }}>
          {report.highlights.map((h) => <li key={h}>{h}</li>)}
        </ul>
      </Card>

      <Card>
        <div className="section-head"><div><h2>Thứ hạng trên bản đồ</h2><p>“Top 3” là tỉ lệ điểm trên bản đồ mà doanh nghiệp bạn nằm trong 3 kết quả đầu. Càng cao càng tốt.</p></div></div>
        {!r ? (
          <div className="empty-note">Chưa có dữ liệu thứ hạng cho kỳ này.</div>
        ) : (
          <>
            <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', marginBottom: 12 }}>
              <div><div style={{ fontSize: 28, fontWeight: 700 }}>{pct(r.avgSolv)}</div><div style={{ fontSize: 13, color: 'var(--muted-foreground)' }}>Top 3 trung bình{r.avgSolvDelta != null ? ` (${deltaText(r.avgSolvDelta)} so với kỳ trước)` : ''}</div></div>
              <div><div style={{ fontSize: 28, fontWeight: 700 }}>{r.improved}</div><div style={{ fontSize: 13, color: 'var(--muted-foreground)' }}>Từ khoá tăng</div></div>
              <div><div style={{ fontSize: 28, fontWeight: 700 }}>{r.declined}</div><div style={{ fontSize: 13, color: 'var(--muted-foreground)' }}>Từ khoá giảm</div></div>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                <thead>
                  <tr style={{ textAlign: 'left', color: 'var(--muted-foreground)' }}>
                    <th style={{ padding: '6px 8px' }}>Từ khoá</th><th style={{ padding: '6px 8px' }}>Top 3</th><th style={{ padding: '6px 8px' }}>Top 10</th><th style={{ padding: '6px 8px' }}>Hạng TB</th><th style={{ padding: '6px 8px' }}>Thay đổi</th>
                  </tr>
                </thead>
                <tbody>
                  {r.keywords.map((k) => (
                    <tr key={k.keyword} style={{ borderTop: '1px solid var(--border)' }}>
                      <td style={{ padding: '6px 8px' }}>{k.keyword}</td>
                      <td style={{ padding: '6px 8px' }}>{pct(k.current?.solv)}</td>
                      <td style={{ padding: '6px 8px' }}>{pct(k.current?.top10)}</td>
                      <td style={{ padding: '6px 8px' }}>{k.current?.arp != null ? k.current.arp.toFixed(1) : '—'}</td>
                      <td style={{ padding: '6px 8px', color: TREND[k.trend].color }}>{TREND[k.trend].label}{k.solvDelta != null && k.trend !== 'flat' ? ` (${deltaText(k.solvDelta)})` : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>

      <Card>
        <div className="section-head"><div><h2>Chúng tôi đã làm gì trong tháng</h2></div></div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
          {[
            ['Bài đã đăng', w.postsPublished],
            ['Đánh giá mới', w.reviewsNew],
            ['Phản hồi đã gửi', w.reviewsReplied],
            ['Việc tối ưu hồ sơ xong', w.tasksDone],
          ].map(([label, v]) => (
            <div key={String(label)}><div style={{ fontSize: 26, fontWeight: 700 }}>{v}</div><div style={{ fontSize: 13, color: 'var(--muted-foreground)' }}>{label}</div></div>
          ))}
        </div>
      </Card>

      {report.nextSteps.length > 0 && (
        <Card>
          <div className="section-head"><div><h2>Kế hoạch tháng tới</h2></div></div>
          <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7, fontSize: 14.5 }}>
            {report.nextSteps.map((h) => <li key={h}>{h}</li>)}
          </ul>
        </Card>
      )}
    </>
  )
}
