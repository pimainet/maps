'use client'

import { useEffect, useState } from 'react'

export type BotStage = 'plan' | 'tasks'

const MESSAGES: Record<BotStage, string[]> = {
  plan: [
    'Bot xắn tay áo, đọc kỹ kết quả kiểm tra hồ sơ…',
    'Đang đếm danh mục phụ bằng ngón tay robot (hơi lạnh)…',
    'Pha ly dầu nhớt đặc để tỉnh táo hơn…',
    'Vạch lộ trình 30 ngày, đừng chớp mắt nha…',
    'Cắm cổng sạc, vặn ốc, siết thêm ý tưởng…',
    'Xếp việc nào làm trước, việc nào để tuần sau…',
  ],
  tasks: [
    'Cắt kế hoạch thành từng việc nhỏ cho dễ làm…',
    'Soi xem việc nào đã có rồi, khỏi giao trùng…',
    'Dán nhãn: gấp, vừa, thong thả…',
    'Viết sẵn bài nháp đầu tiên cho bạn…',
    'Gõ lách cách, bot gõ nhanh hơn người ba lần…',
    'Sắp xong rồi, bot đang lau bàn phím…',
  ],
}

const STEPS: { stage: BotStage; label: string }[] = [
  { stage: 'plan', label: 'Soạn kế hoạch 30 ngày' },
  { stage: 'tasks', label: 'Chia thành việc + soạn bài nháp' },
]

/** Con bot đang gõ máy, bánh răng quay, giấy bay lên. Thuần SVG + CSS, tự tắt chuyển động khi người dùng chọn giảm chuyển động. */
export function WorkingBot({ stage, startedAt }: { stage: BotStage; startedAt: number }) {
  const [idx, setIdx] = useState(0)
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    setIdx(0)
  }, [stage])
  useEffect(() => {
    const t = setInterval(() => setIdx((i) => i + 1), 3800)
    const e = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1000)
    return () => {
      clearInterval(t)
      clearInterval(e)
    }
  }, [startedAt])

  const list = MESSAGES[stage]
  const message = list[idx % list.length]
  const current = STEPS.findIndex((s) => s.stage === stage)

  return (
    <div className="wb-wrap" role="status" aria-live="polite">
      <style>{CSS}</style>
      <svg className="wb-svg" viewBox="0 0 320 230" aria-hidden="true" focusable="false">
        <ellipse cx="160" cy="218" rx="116" ry="8" fill="currentColor" opacity="0.08" />

        {/* bánh răng nhỏ + lấp lánh */}
        <g className="wb-gear" style={{ transformOrigin: '36px 120px' }}>
          <circle cx="36" cy="120" r="14" fill="var(--accent, #e3c98f)" />
          {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => (
            <rect key={a} x="32.5" y="101" width="7" height="8" rx="2" fill="var(--accent, #e3c98f)" transform={`rotate(${a} 36 120)`} />
          ))}
          <circle cx="36" cy="120" r="5.5" fill="var(--card, #131a2b)" />
        </g>
        <path className="wb-spark wb-sp1" d="M286 70l3 8 8 3-8 3-3 8-3-8-8-3 8-3z" fill="var(--accent, #e3c98f)" />
        <path className="wb-spark wb-sp2" d="M58 70l2 5 5 2-5 2-2 5-2-5-5-2 5-2z" fill="var(--primary, #7c8cff)" />

        {/* Bot (ngồi sau bàn) */}
        <g className="wb-bot">
          {/* thân */}
          <rect x="112" y="120" width="52" height="74" rx="22" fill="var(--primary, #7c8cff)" />
          <rect x="112" y="120" width="52" height="74" rx="22" fill="none" stroke="rgb(255 255 255 / .18)" strokeWidth="2" />
          <circle cx="138" cy="150" r="9" fill="var(--card, #131a2b)" opacity=".4" />
          <circle className="wb-core" cx="138" cy="150" r="4.5" fill="var(--accent, #e3c98f)" />
          <rect x="128" y="114" width="20" height="12" rx="5" fill="var(--muted-foreground, #9aa3c2)" />

          {/* tay trái */}
          <g className="wb-arm wb-arm-l" style={{ transformOrigin: '116px 138px' }}>
            <path d="M116 138q-16 14-8 34" fill="none" stroke="var(--primary-hover, #94a1ff)" strokeWidth="11" strokeLinecap="round" />
            <circle cx="108" cy="174" r="8" fill="#eef1ff" />
          </g>
          {/* tay phải */}
          <g className="wb-arm wb-arm-r" style={{ transformOrigin: '160px 138px' }}>
            <path d="M160 138q16 14 8 34" fill="none" stroke="var(--primary-hover, #94a1ff)" strokeWidth="11" strokeLinecap="round" />
            <circle cx="168" cy="174" r="8" fill="#eef1ff" />
          </g>

          {/* đầu */}
          <g className="wb-head" style={{ transformOrigin: '138px 110px' }}>
            <circle cx="92" cy="88" r="7" fill="var(--accent, #e3c98f)" />
            <circle cx="184" cy="88" r="7" fill="var(--accent, #e3c98f)" />
            <rect x="94" y="52" width="88" height="68" rx="30" fill="#eef1ff" />
            <rect x="94" y="52" width="88" height="68" rx="30" fill="none" stroke="rgb(0 0 0 / .12)" strokeWidth="2" />
            <rect x="103" y="66" width="70" height="46" rx="22" fill="#0e1424" />
            {/* má hồng */}
            <ellipse cx="113" cy="100" rx="6" ry="3.6" fill="var(--danger, #f58a8a)" opacity=".55" />
            <ellipse cx="163" cy="100" rx="6" ry="3.6" fill="var(--danger, #f58a8a)" opacity=".55" />
            {/* mắt: nhìn bàn phím rồi liếc sang màn hình */}
            <g className="wb-gaze">
              <g className="wb-eyes" style={{ transformOrigin: '138px 86px' }}>
                <ellipse cx="124" cy="86" rx="8" ry="9.5" fill="var(--success, #6fd3a8)" />
                <ellipse cx="152" cy="86" rx="8" ry="9.5" fill="var(--success, #6fd3a8)" />
                <circle cx="127" cy="82" r="3" fill="#fff" />
                <circle cx="155" cy="82" r="3" fill="#fff" />
              </g>
            </g>
            {/* miệng: cười, lúc lúc há miệng */}
            <path className="wb-mouth wb-mouth-a" d="M130 101q8 6 16 0" fill="none" stroke="var(--success, #6fd3a8)" strokeWidth="3" strokeLinecap="round" />
            <path className="wb-mouth wb-mouth-b" d="M129 100q9 12 18 0z" fill="var(--success, #6fd3a8)" />
            {/* mũ bảo hộ + đèn */}
            <path d="M96 66a42 36 0 0184 0z" fill="var(--warning, #f0b65a)" />
            <rect x="90" y="63" width="96" height="7" rx="3.5" fill="var(--warning, #f0b65a)" />
            <rect x="130" y="34" width="16" height="14" rx="5" fill="var(--warning, #f0b65a)" />
            <circle className="wb-lamp" cx="138" cy="30" r="7" fill="#fff6c9" />
          </g>
        </g>

        {/* bàn */}
        <rect x="56" y="184" width="208" height="12" rx="6" fill="var(--surface-2, #1a2340)" stroke="var(--border-strong, #3a4366)" />
        <rect x="68" y="196" width="9" height="20" rx="4" fill="var(--surface-2, #1a2340)" />
        <rect x="243" y="196" width="9" height="20" rx="4" fill="var(--surface-2, #1a2340)" />
        {/* bàn phím */}
        <rect x="96" y="178" width="84" height="8" rx="4" fill="var(--border-strong, #3a4366)" />

        {/* ly cà phê */}
        <g>
          <rect x="68" y="164" width="20" height="20" rx="4" fill="var(--surface-2, #1a2340)" stroke="var(--border-strong, #3a4366)" />
          <path d="M88 168h4a4 4 0 010 9h-4" fill="none" stroke="var(--border-strong, #3a4366)" strokeWidth="2.5" />
          <path className="wb-steam wb-s1" d="M74 160c-3-4 3-6 0-10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity=".5" />
          <path className="wb-steam wb-s2" d="M82 160c-3-4 3-6 0-10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity=".5" />
        </g>

        {/* màn hình: danh sách việc tự tick */}
        <rect x="208" y="170" width="14" height="14" fill="var(--border-strong, #3a4366)" />
        <rect x="190" y="104" width="94" height="68" rx="9" fill="#0e1424" stroke="var(--border-strong, #3a4366)" strokeWidth="2" />
        {[0, 1, 2].map((i) => (
          <g key={i} className={`wb-row wb-row-${i}`}>
            <rect x="200" y={116 + i * 18} width="11" height="11" rx="3" fill="none" stroke="var(--muted-foreground, #9aa3c2)" strokeWidth="1.6" />
            <path className="wb-tick" d={`M202.5 ${121.5 + i * 18}l3 3 5-6`} fill="none" stroke="var(--success, #6fd3a8)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
            <rect x="218" y={118 + i * 18} width={[52, 40, 46][i]} height="5" rx="2.5" fill="var(--primary, #7c8cff)" opacity=".7" />
          </g>
        ))}

        {/* "xong việc" bay lên từ màn hình */}
        {[0, 1, 2].map((i) => (
          <g key={i} className={`wb-pop wb-pop-${i}`}>
            <circle cx={[212, 238, 262][i]} cy="98" r="9" fill="var(--success, #6fd3a8)" />
            <path d={`M${[207.5, 233.5, 257.5][i]} 98.5l3.5 3.5 6-7.5`} fill="none" stroke="#0b0f1a" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          </g>
        ))}
      </svg>

      <p className="wb-message" key={`${stage}-${idx % list.length}`}>{message}</p>

      <ol className="wb-steps">
        {STEPS.map((s, i) => {
          const state = i < current ? 'done' : i === current ? 'active' : 'todo'
          return (
            <li key={s.stage} className={`wb-step wb-${state}`}>
              <span className="wb-dot" aria-hidden="true">{state === 'done' ? '✓' : i + 1}</span>
              <span>{s.label}</span>
              <span className="wb-sr">{state === 'done' ? ' (xong)' : state === 'active' ? ' (đang chạy)' : ' (chờ)'}</span>
            </li>
          )
        })}
      </ol>

      <p className="wb-hint">
        Đã chạy {elapsed} giây · thường mất khoảng 40–80 giây. Bạn giữ trang này mở nhé, bot đang làm việc.
      </p>
    </div>
  )
}

const CSS = `
.wb-wrap { display:flex; flex-direction:column; align-items:center; gap:14px; padding:8px 0 4px; color: var(--muted-foreground, #9aa3c2); }
.wb-svg { width:min(360px,100%); height:auto; overflow:visible; }
.wb-message { margin:0; min-height:1.6em; text-align:center; font-size:15px; color: var(--foreground, #e8ecf8); animation: wb-fade .5s ease both; }
.wb-steps { list-style:none; margin:0; padding:0; display:grid; gap:8px; width:min(340px,100%); }
.wb-step { display:flex; align-items:center; gap:10px; font-size:14px; color: var(--faint, #6f7899); }
.wb-dot { width:22px; height:22px; border-radius:999px; display:inline-grid; place-items:center; font-size:12px; border:1px solid var(--border-strong, #3a4366); flex:none; }
.wb-active { color: var(--foreground, #e8ecf8); }
.wb-active .wb-dot { border-color: var(--primary, #7c8cff); background: var(--primary-soft, rgb(124 140 255 / .14)); animation: wb-pulse 1.4s ease-in-out infinite; }
.wb-done { color: var(--success, #6fd3a8); }
.wb-done .wb-dot { border-color: var(--success, #6fd3a8); background: var(--success-soft, rgb(111 211 168 / .13)); }
.wb-hint { margin:0; font-size:12.5px; text-align:center; color: var(--faint, #6f7899); }
.wb-sr { position:absolute; width:1px; height:1px; overflow:hidden; clip:rect(0 0 0 0); white-space:nowrap; }

.wb-gear { animation: wb-spin 7s linear infinite; }
.wb-bot { animation: wb-bob 1.1s ease-in-out infinite; transform-origin: 138px 190px; }
.wb-head { animation: wb-tilt 2.6s ease-in-out infinite; }
.wb-gaze { animation: wb-gaze 5s ease-in-out infinite; }
.wb-eyes { animation: wb-blink 3.4s infinite; }
.wb-lamp { animation: wb-glow 1.2s ease-in-out infinite; }
.wb-core { animation: wb-glow 1.6s ease-in-out infinite; }
.wb-arm-l { animation: wb-type .34s ease-in-out infinite; }
.wb-arm-r { animation: wb-type .34s ease-in-out infinite .17s; }
.wb-mouth-b { opacity:0; animation: wb-open 5s ease-in-out infinite; transform-box: fill-box; transform-origin:center; }
.wb-mouth-a { animation: wb-open-inv 5s ease-in-out infinite; }
.wb-spark { animation: wb-twinkle 2.4s ease-in-out infinite; transform-box: fill-box; transform-origin:center; }
.wb-sp2 { animation-delay: 1.2s; }
.wb-steam { animation: wb-steam 2.2s ease-in-out infinite; }
.wb-s2 { animation-delay: 1s; }
.wb-tick { stroke-dasharray: 16; stroke-dashoffset: 16; animation: wb-draw 4.5s ease-in-out infinite; }
.wb-row-1 .wb-tick { animation-delay: 1.2s; }
.wb-row-2 .wb-tick { animation-delay: 2.4s; }
.wb-pop { opacity:0; animation: wb-pop 3.6s ease-out infinite; transform-box: fill-box; transform-origin:center; }
.wb-pop-1 { animation-delay: 1.2s; }
.wb-pop-2 { animation-delay: 2.4s; }

@keyframes wb-spin { to { transform: rotate(360deg); } }
@keyframes wb-bob { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-3px); } }
@keyframes wb-tilt { 0%,100% { transform: rotate(-3deg); } 50% { transform: rotate(3deg); } }
@keyframes wb-gaze { 0%,35% { transform: translate(-1px,5px); } 45%,85% { transform: translate(7px,-1px); } 100% { transform: translate(-1px,5px); } }
@keyframes wb-blink { 0%,92%,100% { transform: scaleY(1); } 95% { transform: scaleY(.1); } }
@keyframes wb-glow { 0%,100% { opacity:1; } 50% { opacity:.4; } }
@keyframes wb-pulse { 0%,100% { box-shadow:0 0 0 0 rgb(124 140 255 / .45); } 50% { box-shadow:0 0 0 6px rgb(124 140 255 / 0); } }
@keyframes wb-type { 0%,100% { transform: rotate(0) translateY(0); } 50% { transform: rotate(-7deg) translateY(-4px); } }
@keyframes wb-open { 0%,40%,100% { opacity:0; } 50%,62% { opacity:1; } }
@keyframes wb-open-inv { 0%,40%,100% { opacity:1; } 50%,62% { opacity:0; } }
@keyframes wb-twinkle { 0%,100% { opacity:.2; transform: scale(.6) rotate(0); } 50% { opacity:1; transform: scale(1.1) rotate(25deg); } }
@keyframes wb-steam { 0% { opacity:0; transform: translateY(6px); } 40% { opacity:.55; } 100% { opacity:0; transform: translateY(-8px); } }
@keyframes wb-draw { 0%,8% { stroke-dashoffset:16; } 22%,80% { stroke-dashoffset:0; } 92%,100% { stroke-dashoffset:16; } }
@keyframes wb-pop { 0% { opacity:0; transform: translateY(14px) scale(.4); } 18% { opacity:1; transform: translateY(0) scale(1.1); } 30% { transform: scale(1); } 70% { opacity:1; } 100% { opacity:0; transform: translateY(-26px) scale(.9); } }
@keyframes wb-fade { from { opacity:0; transform: translateY(4px); } to { opacity:1; transform:none; } }

/*
 * Giảm chuyển động: giao diện chung (globals.css) tắt MỌI animation khi hệ điều hành bật "giảm chuyển động",
 * khiến con bot đứng im (Windows: tắt "Animation effects" / chế độ tiết kiệm pin cũng bật cờ này). Ở đây giữ lại
 * những chuyển động nhỏ, không quay/không bay (gõ phím, chớp mắt, tick việc, hơi cà phê) để bot vẫn "đang làm việc",
 * còn chuyển động lớn (quay, nhún, nghiêng đầu, bay lên) thì tắt.
 */
@media (prefers-reduced-motion: reduce) {
  .wb-wrap .wb-eyes { animation: wb-blink 3.4s infinite !important; }
  .wb-wrap .wb-arm-l { animation: wb-type .5s ease-in-out infinite !important; }
  .wb-wrap .wb-arm-r { animation: wb-type .5s ease-in-out infinite .25s !important; }
  .wb-wrap .wb-tick { animation: wb-draw 4.5s ease-in-out infinite !important; }
  .wb-wrap .wb-row-1 .wb-tick { animation-delay: 1.2s !important; }
  .wb-wrap .wb-row-2 .wb-tick { animation-delay: 2.4s !important; }
  .wb-wrap .wb-steam { animation: wb-steam 2.6s ease-in-out infinite !important; }
  .wb-wrap .wb-lamp, .wb-wrap .wb-core { animation: wb-glow 1.6s ease-in-out infinite !important; }
  .wb-wrap .wb-pop { animation: wb-pop 3.6s ease-out infinite !important; }
  .wb-wrap .wb-pop-1 { animation-delay: 1.2s !important; }
  .wb-wrap .wb-pop-2 { animation-delay: 2.4s !important; }
  .wb-wrap .wb-gear, .wb-wrap .wb-bot, .wb-wrap .wb-head, .wb-wrap .wb-gaze { animation: none !important; }
}
`
