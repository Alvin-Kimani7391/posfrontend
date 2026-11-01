/* Hardware workspace — Overview dashboard ("Lime & Navy"): stat cards, sales charts, latest transactions, delivery map.
   Loaded after hw-sell.js, so HW.V.home here replaces the old plain Overview. All charts are dependency-free SVG
   (no CDN) so they keep working when the yard's internet is down. */
(function () {
  const { Api, UI } = window, HW = window.HW, E = UI.escapeHtml, $ = HW.$, $$ = HW.$$;
  const br = () => HW.S.branch;

  /* ---------- line icons for the left menu (replace the old text glyphs) ---------- */
  const P = {
    home: '<rect x="3" y="3" width="7" height="7" rx="1.6"/><rect x="14" y="3" width="7" height="7" rx="1.6"/><rect x="3" y="14" width="7" height="7" rx="1.6"/><rect x="14" y="14" width="7" height="7" rx="1.6"/>',
    counter: '<circle cx="9" cy="20" r="1.2"/><circle cx="18" cy="20" r="1.2"/><path d="M1 1h4l2.7 13.4a2 2 0 0 0 2 1.6h9.7a2 2 0 0 0 2-1.6L23 6H6"/>',
    quotes: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h8"/>',
    projects: '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2M9 12h6M9 16h6"/>',
    deposits: '<path d="M20 12V8H6a2 2 0 0 1 0-4h12v4"/><path d="M4 6v12a2 2 0 0 0 2 2h14v-4"/><path d="M18 12a2 2 0 0 0 0 4h4v-4z"/>',
    dispatch: '<path d="M22 2 11 13"/><path d="M22 2l-7 20-4-9-9-4z"/>',
    fleet: '<path d="M1 3h15v13H1z"/><path d="M16 8h4l3 3v5h-7z"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/>',
    shelves: '<path d="M21 8v13H3V8"/><rect x="1" y="3" width="22" height="5" rx="1"/><path d="M10 12h4"/>',
    stock: '<path d="M21 16V8a2 2 0 0 0-1-1.7l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.7l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><path d="M3.3 7 12 12l8.7-5M12 22V12"/>',
    pricing: '<path d="M19 5 5 19"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/>',
    suppliers: '<path d="m17 1 4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="m7 23-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>',
    finance: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.4"/><path d="M6 12h.01M18 12h.01"/>',
    reports: '<path d="M3 3v18h18"/><path d="M18 17V9M13 17V5M8 17v-3"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
    bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>',
    coins: '<circle cx="12" cy="12" r="9"/><path d="M14.8 9a3 3 0 0 0-2.8-1.5c-1.7 0-3 .9-3 2.2 0 3 6 1.6 6 4.6 0 1.3-1.3 2.2-3 2.2A3.2 3.2 0 0 1 9 15.2M12 6v1.5M12 16.5V18"/>',
    target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.3"/>',
    swap: '<path d="M17 3 21 7l-4 4"/><path d="M3 11V9a2 2 0 0 1 2-2h16"/><path d="M7 21 3 17l4-4"/><path d="M21 13v2a2 2 0 0 1-2 2H3"/>',
  };
  const svg = (k, size = 18, sw = 1.8) => `<svg class="hw-svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[k] || ''}</svg>`;
  HW.icon = svg;
  (HW.NAV || []).forEach((n) => { if (P[n[0]]) n[2] = svg(n[0]); });
  const NAV_ICON = { home: 'home', counter: 'counter', quotes: 'quotes', projects: 'projects', deposits: 'deposits', dispatch: 'dispatch', fleet: 'fleet', shelves: 'shelves', stock: 'stock', pricing: 'pricing', suppliers: 'suppliers', finance: 'finance', reports: 'reports', settings: 'settings' };
  void NAV_ICON;

  /* ---------- small helpers ---------- */
  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const addDays = (d, n) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() + n); return x; };
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const currency = () => { try { return (window.POS_COUNTRY_INFO && window.POS_COUNTRY_INFO.currency) || localStorage.getItem('pos.currency') || 'KES'; } catch (e) { return 'KES'; } };
  const grp = (n) => Math.round(Number(n) || 0).toLocaleString('en-US');
  const trim1 = (n) => n.toFixed(1).replace(/\.0$/, '');
  const compact = (n) => { const v = Number(n) || 0, a = Math.abs(v); if (a >= 1e9) return trim1(v / 1e9) + 'B'; if (a >= 1e6) return trim1(v / 1e6) + 'M'; if (a >= 1e3) return trim1(v / 1e3) + 'K'; return String(Math.round(v)); };
  const pctChange = (cur, prev) => (prev > 0 ? ((cur - prev) / prev) * 100 : null);
  const sum = (a) => a.reduce((s, x) => s + x, 0);

  /** Ticks 0..max with a "nice" step. */
  function scale(maxVal, want = 4) {
    const v = Math.max(maxVal, 1), raw = v / want, p = 10 ** Math.floor(Math.log10(raw)), f = raw / p;
    const step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p, n = Math.ceil(v / step);
    return { step, max: step * n, ticks: Array.from({ length: n + 1 }, (_, i) => i * step) };
  }

  /** Monotone cubic path through points (no overshoot, so sales never dip below zero between days). */
  function smooth(pts) {
    const n = pts.length; if (n < 2) return '';
    const dx = [], d = [], m = new Array(n);
    for (let i = 0; i < n - 1; i++) { dx[i] = pts[i + 1][0] - pts[i][0] || 1e-6; d[i] = (pts[i + 1][1] - pts[i][1]) / dx[i]; }
    m[0] = d[0]; m[n - 1] = d[n - 2];
    for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
    for (let i = 0; i < n - 1; i++) {
      if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
      const a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b;
      if (s > 9) { const t = 3 / Math.sqrt(s); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
    }
    let out = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
    for (let i = 0; i < n - 1; i++) {
      const h = dx[i] / 3;
      out += `C${(pts[i][0] + h).toFixed(1)},${(pts[i][1] + m[i] * h).toFixed(1)} ${(pts[i + 1][0] - h).toFixed(1)},${(pts[i + 1][1] - m[i + 1] * h).toFixed(1)} ${pts[i + 1][0].toFixed(1)},${pts[i + 1][1].toFixed(1)}`;
    }
    return out;
  }

  /** Draws into `host` at its real width and again whenever the card is resized. */
  function mount(host, draw) {
    let last = 0;
    const run = () => { const w = Math.floor(host.clientWidth); if (!w || w === last) return; last = w; draw(w); };
    run();
    if (window.ResizeObserver) { const ro = new ResizeObserver(run); ro.observe(host); host._ro = ro; } else window.addEventListener('resize', run);
  }
  const tipFor = (host) => { let t = host.querySelector('.hwd-tip'); if (!t) { t = document.createElement('div'); t.className = 'hwd-tip'; host.appendChild(t); } return t; };
  function placeTip(host, tip, x, y) { tip.style.display = 'block'; const w = tip.offsetWidth, hostW = host.clientWidth; tip.style.left = Math.max(4, Math.min(hostW - w - 4, x - w / 2)) + 'px'; tip.style.top = Math.max(0, y - tip.offsetHeight - 10) + 'px'; }

  /* ---------- chart 1: sales bars (monthly = year view, stacked by part of month · daily = last 14 days) ---------- */
  function barChart(host, o) {
    host.classList.add('hwd-chart');
    mount(host, (w) => {
      const H = 300, L = 46, R = 6, T = 12, B = 30, iw = w - L - R, ih = H - T - B;
      const totals = o.bars.map((b) => sum(b.parts)), sc = scale(Math.max(...totals, 0));
      const slot = iw / o.bars.length, bw = Math.min(54, slot * 0.58), y = (v) => T + ih - (v / sc.max) * ih;
      let g = '';
      sc.ticks.forEach((t) => { g += `<text x="${L - 12}" y="${y(t) + 4}" text-anchor="end" class="ax">${compact(t)}</text>`; });
      o.bars.forEach((b, i) => {
        const x = L + slot * i + (slot - bw) / 2; let acc = 0; let segs = '';
        b.parts.forEach((v, k) => {
          const y0 = y(acc + v), y1 = y(acc) - (k ? 3 : 0), h = Math.max(0, y1 - y0); acc += v;
          if (h < 1) return;
          segs += `<rect x="${x.toFixed(1)}" y="${y0.toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="${Math.min(6, h / 2).toFixed(1)}" fill="${o.fills[k] || o.fills[o.fills.length - 1]}"/>`;
        });
        g += `<g class="bar" data-i="${i}">${segs}<rect x="${(L + slot * i).toFixed(1)}" y="${T}" width="${slot.toFixed(1)}" height="${ih}" fill="transparent"/></g>`;
        const showLbl = o.bars.length <= 14 || i % 2 === 0;
        if (showLbl) g += `<text x="${(L + slot * i + slot / 2).toFixed(1)}" y="${H - 8}" text-anchor="middle" class="ax">${E(b.label)}</text>`;
      });
      host.querySelector('svg')?.remove();
      host.insertAdjacentHTML('afterbegin', `<svg width="${w}" height="${H}" viewBox="0 0 ${w} ${H}" role="img" aria-label="${E(o.aria)}"><defs><pattern id="hwdHatch" width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="9" height="9" fill="#f1f9c4"/><rect width="4.5" height="9" fill="#d4ee5a"/></pattern></defs>${g}</svg>`);
      const tip = tipFor(host);
      $$('.bar', host).forEach((el) => {
        const b = o.bars[+el.dataset.i];
        el.addEventListener('mousemove', () => { tip.innerHTML = `<b>${E(b.full || b.label)}</b><span>${E(HW.money(sum(b.parts)))}</span>${b.parts.length > 1 ? b.parts.map((v, k) => `<i><u style="background:${o.fills[k] === 'url(#hwdHatch)' ? '#d4ee5a' : o.fills[k]}"></u>${E(o.partNames[k])} · ${E(HW.money(v))}</i>`).join('') : ''}`; const r = el.getBoundingClientRect(), hr = host.getBoundingClientRect(); placeTip(host, tip, r.left - hr.left + r.width / 2, +el.querySelector('rect').getAttribute('y') + 4); el.classList.add('hot'); });
        el.addEventListener('mouseleave', () => { tip.style.display = 'none'; el.classList.remove('hot'); });
      });
    });
  }

  /* ---------- chart 2: smooth area/line, this period vs the one before ---------- */
  function areaChart(host, o) {
    host.classList.add('hwd-chart');
    mount(host, (w) => {
      const H = 300, L = 52, R = 14, T = 16, B = 30, iw = w - L - R, ih = H - T - B, n = o.cur.length;
      const all = o.cur.concat((o.prev || []).filter((v) => v !== null)), sc = scale(Math.max(...all, 0)), min = 0;
      const X = (i) => L + (n === 1 ? iw / 2 : (iw * i) / (n - 1)), Y = (v) => T + ih - ((v - min) / (sc.max - min)) * ih;
      const cp = o.cur.map((v, i) => [X(i), Y(v)]), line = smooth(cp);
      const pp = (o.prev || []).map((v, i) => (v === null ? null : [X(i), Y(v)])).filter(Boolean), pline = pp.length > 1 ? smooth(pp) : '';
      let g = '';
      sc.ticks.forEach((t) => { g += `<line x1="${L}" x2="${w - R}" y1="${Y(t)}" y2="${Y(t)}" class="gl"/><text x="${L - 12}" y="${Y(t) + 4}" text-anchor="end" class="ax">${compact(t)}</text>`; });
      o.labels.forEach((l, i) => { if (l) g += `<text x="${X(i).toFixed(1)}" y="${H - 8}" text-anchor="${i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}" class="ax">${E(l)}</text>`; });
      const last = cp[n - 1];
      host.querySelector('svg')?.remove();
      host.insertAdjacentHTML('afterbegin', `<svg width="${w}" height="${H}" viewBox="0 0 ${w} ${H}" role="img" aria-label="${E(o.aria)}"><defs><linearGradient id="hwdArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d4ee5a" stop-opacity=".95"/><stop offset="1" stop-color="#d4ee5a" stop-opacity=".04"/></linearGradient></defs>${g}
        ${pline ? `<path d="${pline}" class="prev"/>` : ''}<path d="${line}L${X(n - 1).toFixed(1)},${T + ih}L${X(0).toFixed(1)},${T + ih}Z" fill="url(#hwdArea)"/><path d="${line}" class="cur"/>
        <circle cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}" r="4.5" class="end"/><line class="guide" y1="${T}" y2="${T + ih}" x1="0" x2="0" style="display:none"/><circle class="dot" r="5" style="display:none"/><rect x="${L}" y="${T}" width="${iw}" height="${ih}" fill="transparent" class="hit"/></svg>`);
      const s = host.querySelector('svg'), tip = tipFor(host), guide = s.querySelector('.guide'), dot = s.querySelector('.dot'), hit = s.querySelector('.hit');
      hit.addEventListener('mousemove', (e) => {
        const r = s.getBoundingClientRect(), mx = e.clientX - r.left; let i = Math.round(((mx - L) / iw) * (n - 1)); i = Math.max(0, Math.min(n - 1, i));
        guide.setAttribute('x1', X(i)); guide.setAttribute('x2', X(i)); guide.style.display = ''; dot.setAttribute('cx', X(i)); dot.setAttribute('cy', Y(o.cur[i])); dot.style.display = '';
        const pv = o.prev && o.prev[i] !== null && o.prev[i] !== undefined ? `<i><u class="pv"></u>Before · ${E(HW.money(o.prev[i]))}</i>` : '';
        tip.innerHTML = `<b>${E(o.full[i])}</b><span>${E(HW.money(o.cur[i]))}</span>${pv}`; placeTip(host, tip, X(i), Y(o.cur[i]));
      });
      hit.addEventListener('mouseleave', () => { guide.style.display = 'none'; dot.style.display = 'none'; tip.style.display = 'none'; });
    });
  }

  /* ---------- medium (payment method) look ---------- */
  const MED = { MPESA: ['M-Pesa', '#12a150'], MOBILE: ['Mobile money', '#12a150'], CASH: ['Cash', '#1d1c35'], CARD: ['Card', '#3340a8'], BANK: ['Bank', '#0f766e'], BANK_TRANSFER: ['Bank transfer', '#0f766e'], CHEQUE: ['Cheque', '#8a6d00'], CREDIT: ['On credit', '#d9480f'], DEPOSIT: ['Deposit', '#7c3aed'] };
  const medOf = (s) => { const p = (s.payments || [])[0]; const k = String((p && (p.method || p.type)) || s.paymentMethod || '').toUpperCase(); if (MED[k]) return MED[k]; if (s.paymentStatus === 'UNPAID') return MED.CREDIT; return k ? [HW.human(k), '#5b6070'] : [HW.human(s.paymentStatus || 'Sale'), '#5b6070']; };
  const ago = (d) => { const t = new Date(d); return isNaN(t) ? '' : `${t.getDate()} ${MON[t.getMonth()]}, ${pad(t.getHours())}:${pad(t.getMinutes())}`; };

  /* ---------- the Overview page ---------- */
  HW.V.home = async (el) => {
    const canRep = HW.can('hardware.reports'), canSales = canRep || HW.can('sales.view') || HW.can('sales.create');
    const now = new Date(), today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const mStart = new Date(today.getFullYear(), today.getMonth(), 1), pStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const pEnd = addDays(pStart, today.getDate() - 1), fetchFrom = [new Date(today.getFullYear(), 0, 1), addDays(today, -365), pStart].reduce((a, b) => (a < b ? a : b));
    const q = (f, t) => ({ from: ymd(f), to: ymd(t) + 'T23:59:59', branchId: br() });
    const settle = (p) => p.then((v) => v, () => null);
    const [dash, alerts, sales, expNow, expPrev, latest] = await Promise.all([
      canRep ? settle(Api.get('/hardware/dashboard', { branchId: br() })) : null,
      HW.can('hardware.transport') ? settle(Api.get('/hardware/transport/vehicles/alerts', { days: 30 })) : null,
      canRep ? settle(Api.get('/reports/sales', q(fetchFrom, today))) : null,
      canRep ? settle(Api.get('/reports/dashboard', q(mStart, today))) : null,
      canRep ? settle(Api.get('/reports/dashboard', q(pStart, pEnd))) : null,
      canSales ? settle(Api.get('/sales', { branchId: br(), limit: 6, page: 1 })) : null,
    ]);
    const d = (dash && dash.data) || {}, alertList = (alerts && alerts.data && alerts.data.alerts) || [];
    const trend = (sales && sales.data && sales.data.dailyTrend) || [], haveSales = !!sales;
    const byDay = {}; trend.forEach((t) => { byDay[String(t.date).slice(0, 10)] = { v: Number(t.netSales) || 0, n: Number(t.transactionCount) || 0 }; });
    const dayV = (dt) => (byDay[ymd(dt)] || { v: 0 }).v, dayN = (dt) => (byDay[ymd(dt)] || { n: 0 }).n;
    const range = (a, b, f) => { let s = 0; for (let x = a; x <= b; x = addDays(x, 1)) s += f(x); return s; };
    const incNow = range(mStart, today, dayV), incPrev = range(pStart, pEnd, dayV), txNow = range(mStart, today, dayN), txPrev = range(pStart, pEnd, dayN);
    const exp = (r) => (r && r.data && r.data.profit && typeof r.data.profit.expenses === 'number' ? r.data.profit.expenses : null);
    const spNow = exp(expNow), spPrev = exp(expPrev), owed = d.totalOwed, over = d.totalOverdue;
    const cur = currency();

    /* stat cards */
    const chip = (pct, goodUp = true, text) => {
      if (text) return `<span class="hwd-chip"><i class="up">${arrow(true)}</i>${text}</span>`;
      if (pct === null || pct === undefined || !isFinite(pct)) return '<span class="hwd-chip muted">no earlier data</span>';
      const up = pct >= 0, good = up === goodUp;
      return `<span class="hwd-chip"><i class="${up ? 'up' : 'dn'} ${good ? 'good' : 'bad'}">${arrow(up)}</i>${Math.abs(pct).toFixed(1)}%</span>`;
    };
    const arrow = (up) => `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round">${up ? '<path d="M12 19V5M5 12l7-7 7 7"/>' : '<path d="M12 5v14M19 12l-7 7-7-7"/>'}</svg>`;
    const dots = (href) => `<a class="hwd-dots" href="${href}" title="Open" aria-label="Open">${'<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>'}</a>`;
    const val = (v) => (v === null || v === undefined ? '<b class="na">—</b>' : `<b>${grp(v)}<small>${E(cur)}</small></b>`);
    const stat = (cls, label, valueHtml, chipHtml, icon, href) => `<div class="hwd-stat ${cls}" data-href="${href}" style="cursor:pointer"><div class="top"><span>${label}</span>${dots(href)}</div>${valueHtml}<div class="bot">${chipHtml}</div><div class="ghost">${svg(icon, 64, 1.2)}</div></div>`;
    const statsHtml = canRep ? `<div class="hwd-stats">
      ${stat('dark', 'Sales this month', val(haveSales ? incNow : null), chip(pctChange(incNow, incPrev)), 'coins', '#/reports/sales')}
      ${stat('', 'Expenses this month', val(spNow), spNow === null ? '' : chip(pctChange(spNow, spPrev), false), 'swap', '#/reports/expenses')}
      ${stat('', 'Owed by customers', val(dash ? owed || 0 : null), dash ? chip(null, true, owed > 0 ? `${Math.round(((over || 0) / owed) * 100)}% overdue` : 'nothing overdue') : '', 'target', '#/reports/customers')}
      ${stat('', 'Transactions', haveSales ? `<b>${grp(txNow)}</b>` : '<b class="na">—</b>', haveSales ? chip(pctChange(txNow, txPrev)) : '', 'swap', '#/reports/allsales')}
    </div>` : '';

    /* chart cards (filled after the HTML is in) */
    const sel = (id, opts) => `<select class="hwd-sel" id="${id}">${opts.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>`;
    const chartsHtml = canRep ? `<div class="hwd-row">
      <div class="hw-card hwd-card"><div class="hwd-h"><h3>Sales overview</h3><span style="display:flex;gap:8px;align-items:center">${dots('#/reports/sales')}${sel('hwdBarMode', [['month', 'Monthly'], ['day', 'Daily']])}</span></div><div class="hwd-leg" id="hwdBarLeg"></div><div id="hwdBar" class="hwd-host"></div></div>
      <div class="hw-card hwd-card"><div class="hwd-h"><h3>Sales trend</h3><span style="display:flex;gap:8px;align-items:center">${dots('#/reports/sales')}${sel('hwdAreaMode', [['week', 'Week'], ['month', 'Month'], ['quarter', 'Quarter']])}</span></div><div class="hwd-leg"><span><u class="a"></u>This period</span><span><u class="p"></u>Period before</span></div><div id="hwdArea" class="hwd-host"></div></div>
    </div>` : '';

    /* latest transactions */
    const rows = latest && latest.data ? HW.list(latest.data).slice(0, 5) : [];
    const sortIc = '<svg width="10" height="12" viewBox="0 0 10 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 5l3-3 3 3M2 9l3 3 3-3"/></svg>';
    const txHtml = canSales ? `<div class="hw-card hwd-card"><div class="hwd-h"><h3>Latest transactions</h3>${dots('#/reports/allsales')}</div>
      ${rows.length ? `<div class="hwd-tx"><div class="hd"><span>Title ${sortIc}</span><span>Medium ${sortIc}</span><span>Amount ${sortIc}</span></div>${rows.map((s) => { const [ml, mc] = medOf(s); const who = s.customerId && s.customerId.name ? s.customerId.name : 'Walk-in'; return `<div class="rw" data-sid="${E(s._id || s.id || '')}" style="cursor:pointer"><div class="t"><em style="background:${mc}">${E(ml.slice(0, 1))}</em><div><b>${E(s.receiptNumber || s.invoiceNumber || '')}</b><small>${E(who)} · ${E(ago(s.createdAt))}</small></div></div><span class="m">${E(ml)}</span><span class="a">${E(HW.money(s.total))}</span></div>`; }).join('')}</div>` : (latest ? HW.empty('No sales yet', 'Completed sales will show here.') : HW.empty('Not available', 'You need sales permission to see transactions.'))}</div>` : '';
    const tops = ((sales && sales.data && sales.data.topProducts) || []).slice(0, 5), topMax = Math.max(...tops.map((t) => Number(t.revenue) || 0), 1);
    const mapHtml = canRep ? `<div class="hw-card hwd-card"><div class="hwd-h"><h3>Top materials <small>(12 months)</small></h3>${dots('#/reports/sales')}</div>
      ${tops.length ? `<div class="hwd-top">${tops.map((t) => `<div class="it"><div class="l"><b>${E(t.name || 'Material')}</b><span>${E(HW.money(t.revenue))}</span></div><div class="bar"><i style="width:${Math.max(3, Math.round(((Number(t.revenue) || 0) / topMax) * 100))}%"></i></div><small>${E(HW.num(t.quantity, 2))} sold</small></div>`).join('')}</div>` : HW.empty(haveSales ? 'No sales yet' : 'Not available', haveSales ? 'Your best-selling materials will show here.' : 'Sales figures could not be loaded.')}</div>` : '';

    /* day-to-day work (kept from the old Overview) */
    const todo = (n, l, to, er) => `<div class="hw-todo ${er ? 'er' : ''}" data-go="${to}"><b>${n ?? '–'}</b><span>${l}</span></div>`;
    const flow = `<div class="hw-flow"><a href="#/counter">Sell<small>counter till</small></a><a href="#/quotes">Quote<small>price the job</small></a><a href="#/quotes">Order<small>reserve stock</small></a><a href="#/dispatch">Deliver<small>load · drive · proof</small></a><a href="#/finance">Collect<small>deposits · credit</small></a></div>`;
    const opsHtml = `<div class="hwd-row">
      <div class="hw-card hwd-card"><div class="hwd-h"><h3>Needs attention</h3></div>${canRep ? todo(d.openOrders, 'Open orders approved, not fully invoiced', 'quotes') + todo(d.pendingDeliveries, 'Deliveries waiting to go out', 'dispatch') + todo(d.overdueDeliveries, 'Deliveries past their scheduled time', 'dispatch', d.overdueDeliveries > 0) + todo(d.quotationsExpiringIn3Days, 'Quotations about to expire (3 days)', 'quotes') + todo(d.outOfStockLines, 'Order lines short on stock (backorders)', 'quotes/back', d.outOfStockLines > 0) + todo(alertList.length, 'Vehicle papers / services due in 30 days', 'fleet', alertList.length > 0) : '<p style="color:#757a88">Use the menu to open your work screens.</p>'}</div>
      <div class="hw-card hwd-card"><div class="hwd-h"><h3>Top customers owing</h3>${dots('#/reports/customers')}</div>${HW.tbl([{ h: 'Customer', f: (r) => E(r.name || '') }, { h: 'Owed', c: 'n', f: (r) => HW.money(r.owed) }, { h: 'Limit used', c: 'n', f: (r) => HW.num(r.usedPct, 0) + '%' }], d.contractorBalances || [], { empty: 'No balances owing', hint: canRep ? '' : 'Reports permission needed' })}</div></div>
      <div class="hw-card hwd-card" style="margin-top:18px"><div class="hwd-h"><h3>Quick start</h3></div>${flow}<div class="hw-bar" style="margin:6px 0 0">${[['counter', 'New sale'], ['stock/new', 'New product'], ['quotes/new', 'New quotation'], ['dispatch/new', 'Schedule delivery'], ['projects', 'Projects & BOQ'], ['deposits', 'Take deposit'], ['shelves', 'Pick list']].filter(([to]) => HW.NAV.find((n) => n[0] === to.split('/')[0] && HW.canAny(n[3]))).map(([to, l]) => `<a class="hw-btn" href="#/${to}">${l}</a>`).join('')}</div></div>`;

    el.innerHTML = `<div class="hwd">${statsHtml}${chartsHtml}<div class="hwd-row">${txHtml}${mapHtml}</div>${opsHtml}</div>`;
    $$('[data-go]', el).forEach((x) => x.onclick = () => HW.go(...x.dataset.go.split('/')));
    $$('.hwd-stat[data-href]', el).forEach((x) => x.addEventListener('click', (e) => { if (e.target.closest('a,select,button')) return; location.hash = x.dataset.href; }));
    $$('.rw[data-sid]', el).forEach((x) => x.addEventListener('click', () => { if (x.dataset.sid && HW.saleDetail) HW.saleDetail(x.dataset.sid); else location.hash = '#/reports/allsales'; }));
    if (!canRep) return;

    /* ---- bar chart: Monthly (12 months of this year, each split in three parts) / Daily (last 14 days) ---- */
    const barHost = $('#hwdBar', el), barLeg = $('#hwdBarLeg', el), year = today.getFullYear();
    const drawBars = () => {
      const mode = $('#hwdBarMode', el).value;
      if (mode === 'month') {
        const bars = MON.map((m, i) => { const last = new Date(year, i + 1, 0).getDate(), part = (a, b) => range(new Date(year, i, a), new Date(year, i, Math.min(b, last)), dayV); return { label: m, full: `${m} ${year}`, parts: [part(1, 10), part(11, 20), part(21, 31)] }; });
        barLeg.innerHTML = '<span><u class="h"></u>Days 1–10</span><span><u class="l"></u>Days 11–20</span><span><u class="s"></u>Day 21 – end</span>';
        barChart(barHost, { bars, fills: ['url(#hwdHatch)', '#e9f5a8', '#d4ee5a'], partNames: ['Days 1–10', 'Days 11–20', 'Day 21 – end'], aria: `Net sales by month, ${year}` });
      } else {
        const bars = Array.from({ length: 14 }, (_, i) => { const dt = addDays(today, i - 13); return { label: `${dt.getDate()}`, full: `${DOW[dt.getDay()]} ${dt.getDate()} ${MON[dt.getMonth()]}`, parts: [dayV(dt)] }; });
        bars.forEach((b, i) => { if (i === 13) b.label = 'Today'; });
        barLeg.innerHTML = '<span><u class="s"></u>Net sales per day</span><span><u class="h"></u>Today (still counting)</span>';
        barChart(barHost, { bars, fills: ['#d4ee5a'], partNames: ['Net sales'], aria: 'Net sales for the last 14 days' });
        const lastBar = $$('.bar', barHost)[13]; if (lastBar) $$('rect', lastBar).forEach((r) => { if (r.getAttribute('fill') !== 'transparent') r.setAttribute('fill', 'url(#hwdHatch)'); });
      }
    };
    const redrawBars = () => { if (barHost._ro) barHost._ro.disconnect(); barHost.innerHTML = ''; drawBars(); };
    $('#hwdBarMode', el).onchange = redrawBars; drawBars();

    /* ---- area chart: Week / Month / Quarter, with the period before drawn behind it ---- */
    const areaHost = $('#hwdArea', el);
    const drawArea = () => {
      const mode = $('#hwdAreaMode', el).value; let cur2 = [], prev2 = [], labels = [], full = [];
      if (mode === 'quarter') {
        const wk = 13; for (let i = 0; i < wk; i++) { const a = addDays(today, -(wk - i) * 7 + 1), b = addDays(a, 6), pa = addDays(a, -wk * 7), pb = addDays(pa, 6); cur2.push(range(a, b, dayV)); prev2.push(pa < fetchFrom ? null : range(pa, pb, dayV)); labels.push(i % 2 === 0 ? `${a.getDate()} ${MON[a.getMonth()]}` : ''); full.push(`Week of ${a.getDate()} ${MON[a.getMonth()]}`); }
      } else {
        const len = mode === 'week' ? 7 : 30; for (let i = 0; i < len; i++) { const dt = addDays(today, i - (len - 1)), pd = addDays(dt, -len); cur2.push(dayV(dt)); prev2.push(pd < fetchFrom ? null : dayV(pd)); labels.push(mode === 'week' ? DOW[dt.getDay()] : (i % 5 === 0 || i === len - 1 ? `${dt.getDate()} ${MON[dt.getMonth()]}` : '')); full.push(`${DOW[dt.getDay()]} ${dt.getDate()} ${MON[dt.getMonth()]}`); }
      }
      areaChart(areaHost, { cur: cur2, prev: prev2, labels, full, aria: 'Sales trend' });
    };
    const redrawArea = () => { if (areaHost._ro) areaHost._ro.disconnect(); areaHost.innerHTML = ''; drawArea(); };
    $('#hwdAreaMode', el).onchange = redrawArea; drawArea();
    if (!haveSales) { barHost.insertAdjacentHTML('beforeend', '<div class="hwd-msg">Sales figures are not available right now.</div>'); }
  };
})();
