/**
 * Các script chạy TRONG trang Google Maps (qua page.evaluate).
 *
 * Viết dưới dạng chuỗi JS thuần (không phải hàm TS) vì 2 lý do:
 *  1. Playwright serialize hàm bằng toString(); bundler của Next có thể chèn helper
 *     (vd __name, _async_to_generator) vào thân hàm -> chạy trong trình duyệt báo ReferenceError.
 *  2. Test được bằng jsdom (xem scripts/test-gbp-scripts.mjs).
 *
 * Nguyên tắc chống vỡ khi Google đổi giao diện:
 *  - Ưu tiên thuộc tính ổn định: data-item-id, aria-label, role, data-review-id, h1/h2.
 *    KHÔNG dùng class mã hóa (vd .Io6YTe, .wiI7pd) vì Google đổi thường xuyên.
 *  - Nhãn hỗ trợ cả tiếng Việt và tiếng Anh.
 *  - Mỗi script độc lập, trả null/[] khi không thấy thay vì ném lỗi.
 */

const COMMON = String.raw`
const T = (el) => ((el && (el.innerText !== undefined ? el.innerText : el.textContent)) || '').replace(/\u00a0/g, ' ').trim();
const TC = (el) => ((el && el.textContent) || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
const mainEl = () => {
  const ms = Array.prototype.slice.call(document.querySelectorAll('div[role="main"]'));
  return ms.find((m) => m.querySelector('h1')) || ms[0] || document.body;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const REL_RE = /((\d+|một|vài)\s*(giờ|phút|ngày|tuần|tháng|năm)\s*trước)|((an?|\d+)\s+(minute|hour|day|week|month|year)s?\s+ago)|hôm qua|yesterday/i;
const ICON_RE = /[\ue000-\uf8ff]/g;
`

function fn(body: string): string {
  return '(async (arg) => {' + COMMON + body + '})'
}

/** Trạng thái trang: có phải trang địa điểm, hay danh sách kết quả, hay trang consent. */
export const PANEL_STATE = fn(String.raw`
  const main = mainEl();
  const h1 = main.querySelector('h1');
  const feed = document.querySelector('div[role="feed"]');
  const links = feed
    ? Array.prototype.slice.call(feed.querySelectorAll('a[href*="/maps/place/"]'), 0, 8).map((a) => ({
        href: a.href,
        label: a.getAttribute('aria-label') || T(a),
      }))
    : [];
  const tabs = Array.prototype.slice.call(main.querySelectorAll('[role="tab"]'))
    .map((t) => ({ label: (t.getAttribute('aria-label') || T(t)).replace(/\s+/g, ' ').trim(), selected: t.getAttribute('aria-selected') === 'true' }))
    .filter((t) => t.label && t.label.length < 40);
  const hasPlaceFacts = !!main.querySelector('[data-item-id="address"], [data-item-id^="phone"], button[jsaction*="category"]');
  return {
    url: location.href,
    h1: h1 ? T(h1) : null,
    hasFeed: !!feed,
    hasPlaceFacts: hasPlaceFacts,
    links: links,
    tabs: tabs,
    consent: /consent\./.test(location.host),
  };
`)

/** Đánh dấu 1 phần tử (data-gbp-target=1) để Playwright bấm chuột thật. arg: { css, pattern } */
export const MARK = fn(String.raw`
  const re = new RegExp(arg.pattern, 'i');
  const scope = arg.global ? document : mainEl();
  const nodes = Array.prototype.slice.call(scope.querySelectorAll(arg.css));
  const hit = nodes.find((n) => re.test((n.getAttribute('aria-label') || '') + ' ' + T(n)));
  Array.prototype.forEach.call(document.querySelectorAll('[data-gbp-target]'), (e) => e.removeAttribute('data-gbp-target'));
  if (!hit) return null;
  hit.setAttribute('data-gbp-target', '1');
  return (hit.getAttribute('aria-label') || T(hit)).replace(/\s+/g, ' ').trim().slice(0, 60);
`)

/**
 * Cuộn đúng khung cuộn của panel (không phải window) cho tới khi hết nội dung mới.
 * arg: { itemSelector?, targetItems?, maxSteps, stepMs, budgetMs }
 */
export const SCROLL_LOAD = fn(String.raw`
  const itemSel = arg.itemSelector || null;
  const count = () => (itemSel ? document.querySelectorAll(itemSel).length : 0);
  const pick = () => {
    const all = Array.prototype.slice.call(document.querySelectorAll('div'));
    const cands = all.filter((d) => {
      if (d.clientHeight < 200 || d.scrollHeight <= d.clientHeight + 40) return false;
      const oy = getComputedStyle(d).overflowY;
      return oy === 'auto' || oy === 'scroll';
    });
    const withItems = itemSel ? cands.filter((d) => d.querySelector(itemSel)) : cands.filter((d) => mainEl().contains(d) || d.contains(mainEl()));
    const pool = withItems.length ? withItems : cands;
    pool.sort((a, b) => b.scrollHeight - a.scrollHeight);
    // khung cuộn thật là khung nhỏ nhất bao hết item, không phải wrapper khổng lồ
    return pool.length ? pool[pool.length > 1 && itemSel ? pool.length - 1 : 0] : null;
  };
  const t0 = Date.now();
  let last = -1, stable = 0, steps = 0, found = false, lastHeight = -1;
  while (steps < arg.maxSteps && Date.now() - t0 < arg.budgetMs) {
    const sc = pick();
    if (!sc) break;
    found = true;
    sc.scrollTo({ top: sc.scrollHeight });
    await sleep(arg.stepMs);
    const n = itemSel ? count() : sc.scrollHeight;
    if (arg.targetItems && itemSel && n >= arg.targetItems) { last = n; break; }
    if (n === last) { stable++; if (stable >= 2) break; } else { stable = 0; last = n; }
    steps++;
  }
  return { items: itemSel ? count() : null, steps: steps, scrollerFound: found };
`)

/** Bấm mọi nút "Xem thêm" trong phạm vi arg.scopeCss (mở review/mô tả bị cắt). */
export const EXPAND_MORE = fn(String.raw`
  let n = 0;
  Array.prototype.forEach.call(document.querySelectorAll(arg.scopeCss + ' button'), (b) => {
    const l = (b.getAttribute('aria-label') || '') + '|' + T(b);
    if (/(^|\|)\s*(Xem thêm|See more|More|Thêm)\s*(\||$)/i.test(l)) {
      try { b.click(); n++; } catch (e) {}
    }
  });
  return n;
`)

/** Text của panel hiện tại (đã cắt). */
export const PANEL_TEXT = fn(String.raw`
  return T(mainEl()).replace(/\n{3,}/g, '\n\n').slice(0, arg.max || 12000);
`)

/** Dữ kiện có cấu trúc trên tab Tổng quan, đọc thẳng từ thuộc tính DOM. */
export const FACTS = fn(String.raw`
  const main = mainEl();
  const out = {};
  const h1 = main.querySelector('h1');
  out.name = h1 ? T(h1) : null;

  const cat = main.querySelector('button[jsaction*="category"]');
  out.category = cat ? T(cat) : null;

  const num = (s) => { const m = String(s || '').match(/(\d+(?:[.,]\d+)?)/); return m ? parseFloat(m[1].replace(',', '.')) : null; };
  const intOf = (s) => { const d = String(s || '').replace(/[^\d]/g, ''); return d ? parseInt(d, 10) : null; };
  out.rating = null; out.review_count = null;
  const labelled = Array.prototype.slice.call(main.querySelectorAll('[aria-label]'), 0, 700);
  for (let i = 0; i < labelled.length; i++) {
    const l = labelled[i].getAttribute('aria-label') || '';
    if (out.rating == null && /^\s*\d+(?:[.,]\d+)?\s*(sao|stars?)\b/i.test(l)) {
      const r = num(l); if (r != null && r > 0 && r <= 5) out.rating = r;
    }
    if (out.review_count == null && /^\s*[\d.,\s]+\s*(bài đánh giá|đánh giá|reviews?)\s*$/i.test(l)) {
      out.review_count = intOf(l);
    }
    if (out.rating != null && out.review_count != null) break;
  }

  const strip = (s) => String(s || '').replace(ICON_RE, '').replace(/^[^:]{0,30}:\s*/, '').replace(/\s+/g, ' ').trim();
  const addr = main.querySelector('[data-item-id="address"]');
  out.address = addr ? strip(addr.getAttribute('aria-label') || T(addr)) : null;
  const ph = main.querySelector('[data-item-id^="phone"]');
  out.phone = ph ? strip(ph.getAttribute('aria-label') || T(ph)) : null;

  const web = main.querySelector('a[data-item-id="authority"]');
  let site = web ? web.href : null;
  if (site) {
    try { const u = new URL(site); if (/google\./.test(u.host) && u.searchParams.get('q')) site = u.searchParams.get('q'); } catch (e) {}
  }
  out.website = site;

  const skip = /^(address|authority|oh|oloc|merchant|phone.*|ppt.*)$/;
  const actions = [];
  Array.prototype.forEach.call(main.querySelectorAll('a[data-item-id], button[data-item-id]'), (el) => {
    const id = el.getAttribute('data-item-id') || '';
    if (!id || skip.test(id)) return;
    const label = (el.getAttribute('aria-label') || T(el)).replace(ICON_RE, '').replace(/\s+/g, ' ').trim().slice(0, 80);
    const hay = (id + ' ' + label).toLowerCase();
    let kind = 'other';
    if (/menu|thực đơn/.test(hay)) kind = 'menu';
    else if (/đặt bàn|đặt chỗ|đặt lịch|reserve|booking|appointment/.test(hay)) kind = 'booking';
    else if (/đặt hàng|order|giao hàng|delivery/.test(hay)) kind = 'order';
    actions.push({ kind: kind, label: label || null, url: el.href || null });
  });
  out.action_links = actions.slice(0, 8);

  const whole = T(main);
  out.claim_signal = /Nhận quyền sở hữu|Claim this business|Own this business\?|Bạn là chủ doanh nghiệp\?/i.test(whole) ? 'unclaimed' : 'unknown';
  out.business_status = /Đóng cửa vĩnh viễn|Permanently closed/i.test(whole)
    ? 'permanently_closed'
    : /Tạm thời đóng cửa|Temporarily closed/i.test(whole) ? 'temporarily_closed' : null;
  return out;
`)

/** Giờ mở cửa từ bảng 7 ngày (đọc textContent nên không cần mở rộng nếu bảng chỉ bị ẩn bằng CSS). */
export const HOURS = fn(String.raw`
  const main = mainEl();
  const dayRe = /^(Thứ\s*(Hai|Ba|Tư|Năm|Sáu|Bảy)|Chủ\s*nhật|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)/i;
  const lines = [];
  const seen = {};
  Array.prototype.forEach.call(main.querySelectorAll('tr'), (tr) => {
    const cells = tr.querySelectorAll('td, th');
    if (cells.length < 2) return;
    const day = TC(cells[0]);
    if (!dayRe.test(day)) return;
    const hrs = TC(cells[1]).replace(ICON_RE, '').replace(/\s*[·•]\s*$/, '').trim();
    if (!hrs) return;
    const key = day.toLowerCase();
    if (seen[key]) return;
    seen[key] = 1;
    lines.push(day + ': ' + hrs);
  });
  return lines.length >= 3 ? lines.join(' | ') : null;
`)

/** Nhóm thuộc tính/tiện ích ở tab Giới thiệu: mỗi h2 + danh sách <li> đứng ngay sau nó. */
export const ATTRIBUTES = fn(String.raw`
  const main = mainEl();
  const hs = Array.prototype.slice.call(main.querySelectorAll('h2'));
  const uls = Array.prototype.slice.call(main.querySelectorAll('ul'));
  const groups = [];
  const seen = {};
  hs.forEach((h, i) => {
    const title = T(h).replace(ICON_RE, '').trim();
    if (!title || title.length > 60) return;
    const nextH = hs[i + 1];
    const ul = uls.find((u) =>
      (h.compareDocumentPosition(u) & Node.DOCUMENT_POSITION_FOLLOWING) &&
      (!nextH || (nextH.compareDocumentPosition(u) & Node.DOCUMENT_POSITION_PRECEDING)));
    if (!ul) return;
    const items = Array.prototype.slice.call(ul.querySelectorAll('li'))
      .map((li) => (li.getAttribute('aria-label') || TC(li)).replace(ICON_RE, '').replace(/\s+/g, ' ').trim())
      .filter((s) => s && s.length < 90);
    const uniq = items.filter((s, k) => items.indexOf(s) === k).slice(0, 20);
    if (!uniq.length) return;
    const key = title.toLowerCase();
    if (seen[key]) return;
    seen[key] = 1;
    groups.push({ group: title, items: uniq });
  });
  return groups.slice(0, 12);
`)

/** Biểu đồ phân bố sao ở đầu tab Bài đánh giá: aria-label kiểu "5 sao, 123 bài đánh giá". */
export const RATING_DIST = fn(String.raw`
  const dist = {};
  Array.prototype.forEach.call(document.querySelectorAll('[aria-label]'), (el) => {
    const l = el.getAttribute('aria-label') || '';
    const m = l.match(/^\s*([1-5])\s*(sao|stars?)\s*[,:]?\s*([\d.,\s]+)\s*(bài đánh giá|đánh giá|reviews?)/i);
    if (m && dist[m[1]] === undefined) {
      const n = parseInt(m[3].replace(/[^\d]/g, ''), 10);
      if (isFinite(n)) dist[m[1]] = n;
    }
  });
  return Object.keys(dist).length >= 3 ? dist : null;
`)

/** Đọc review có cấu trúc (sao, ngày, nội dung, phản hồi của chủ) + raw để dự phòng. */
export const REVIEWS = fn(String.raw`
  const maxN = arg.max || 30;
  const wrappers = Array.prototype.slice.call(document.querySelectorAll('div[data-review-id]'))
    .filter((n) => !(n.parentElement && n.parentElement.closest('div[data-review-id]')));
  const ids = {};
  const out = [];

  const ownerHeaderRe = /^(Phản hồi từ chủ sở hữu|Response from the owner)/i;
  const findOwner = (root) => {
    const leaves = Array.prototype.slice.call(root.querySelectorAll('span, div, b'))
      .filter((e) => e.children.length === 0 && ownerHeaderRe.test(T(e)));
    if (!leaves.length) return null;
    let box = leaves[0].parentElement;
    for (let i = 0; i < 3 && box && box !== root; i++) {
      if (T(box).length > T(leaves[0]).length + 8) return box;
      box = box.parentElement;
    }
    return box && box !== root ? box : leaves[0].parentElement;
  };

  for (let i = 0; i < wrappers.length && out.length < maxN; i++) {
    const n = wrappers[i];
    const id = n.getAttribute('data-review-id');
    if (ids[id]) continue;
    ids[id] = 1;

    let rating = null;
    const imgs = n.querySelectorAll('[role="img"][aria-label]');
    for (let k = 0; k < imgs.length && rating == null; k++) {
      const m = (imgs[k].getAttribute('aria-label') || '').match(/(\d)\s*(sao|star)/i);
      if (m) rating = parseInt(m[1], 10);
    }

    const owner = findOwner(n);
    let reply = null, replyTime = null;
    if (owner) {
      const lines = T(owner).split('\n').map((s) => s.trim()).filter(Boolean);
      const body = [];
      lines.forEach((ln, idx) => {
        if (idx === 0 && ownerHeaderRe.test(ln)) {
          // tiêu đề và ngày có thể dính chung 1 dòng: "Phản hồi từ chủ sở hữu1 tuần trước"
          const rest = ln.replace(ownerHeaderRe, '').trim();
          if (rest && rest.length < 40 && REL_RE.test(rest) && !replyTime) replyTime = rest;
          return;
        }
        if (REL_RE.test(ln) && ln.length < 40) { if (!replyTime) replyTime = ln; return; }
        body.push(ln);
      });
      reply = body.join(' ').replace(/\s+/g, ' ').trim() || null;
    }

    const clone = n.cloneNode(true);
    const ownerInClone = findOwner(clone);
    if (ownerInClone && ownerInClone.parentNode) ownerInClone.parentNode.removeChild(ownerInClone);
    Array.prototype.forEach.call(clone.querySelectorAll('button, [role="img"]'), (b) => {
      const t = T(b);
      if (!t || t.length < 30) b.parentNode && b.parentNode.removeChild(b);
    });

    let rel = null;
    const leaves = Array.prototype.slice.call(clone.querySelectorAll('span, div')).filter((e) => e.children.length === 0);
    for (let k = 0; k < leaves.length; k++) {
      const t = T(leaves[k]);
      if (t.length < 40 && REL_RE.test(t)) { rel = t; break; }
    }

    let text = '';
    leaves.forEach((e) => {
      const t = T(e).replace(/\s+/g, ' ');
      if (t.length < 8 || REL_RE.test(t) && t.length < 40) return;
      if (/^(Local Guide|Hướng dẫn viên|\d+\s*(bài đánh giá|reviews?|ảnh|photos?))/i.test(t)) return;
      if (/^(Thích|Chia sẻ|Like|Share|Được dịch|Translated|Xem bản gốc|See original)/i.test(t)) return;
      if (t.length > text.length) text = t;
    });
    text = text.replace(/\s*(Xem thêm|See more)\s*$/i, '').trim();

    out.push({
      rating: rating,
      text: text,
      relative_time: rel,
      reply: reply,
      reply_relative_time: replyTime,
      raw: T(n).replace(/\s+/g, ' ').slice(0, 700),
    });
  }
  return out;
`)

/** Đếm ảnh đã nạp + lấy nhãn nhóm ảnh (Tất cả / Bởi chủ sở hữu / Video...). */
export const PHOTOS_INFO = fn(String.raw`
  const idx = {};
  Array.prototype.forEach.call(document.querySelectorAll('a[data-photo-index]'), (a) => { idx[a.getAttribute('data-photo-index')] = 1; });
  let count = Object.keys(idx).length;
  if (!count) {
    const srcs = {};
    Array.prototype.forEach.call(document.querySelectorAll('img[src*="googleusercontent.com"]'), (im) => {
      if (im.naturalWidth && im.naturalWidth < 60) return;
      srcs[String(im.src).split('=')[0]] = 1;
    });
    count = Object.keys(srcs).length;
  }
  const chips = Array.prototype.slice.call(document.querySelectorAll('[role="tab"]'))
    .map((t) => (t.getAttribute('aria-label') || T(t)).replace(/\s+/g, ' ').trim())
    .filter((s) => s && s.length < 40);
  return { count: count, chips: chips.filter((s, i) => chips.indexOf(s) === i).slice(0, 12) };
`)
