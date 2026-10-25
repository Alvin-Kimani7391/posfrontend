/**
 * rider-app.js - Six Star POS Rider (mobile web app).
 * Scan the rider QR -> sign in -> see assigned deliveries -> share live location -> navigate -> collect payment -> deliver -> hand cash to the cashier.
 * Backend: /public/rider/:token (QR + login) and /rider/* (see routes/rider.routes.js). Live: SSE (/rider/stream) with polling fallback.
 */
(function () {
  const Lv = window.Live, { esc, ic, money, $, $$ } = Lv;
  const app = $('#app');
  const qs = new URLSearchParams(location.search);
  const kv = { get: (k) => { try { return localStorage.getItem('rider.' + k); } catch (e) { return null; } }, set: (k, v) => { try { v == null ? localStorage.removeItem('rider.' + k) : localStorage.setItem('rider.' + k, v); } catch (e) { /* blocked */ } } };
  let QR = qs.get('t') || decodeURIComponent((location.pathname.match(/\/(?:d|r|rider)\/([^/?#]+)/) || [])[1] || '') || kv.get('qr') || '';
  if (QR) kv.set('qr', QR);

  const S = { user: null, biz: null, online: false, pos: null, posErr: null, dash: null, sse: 'down', detail: null, seq: 0, cleanup: [], sound: kv.get('sound') !== '0' };
  const A = Lv.client({ ns: 'rider', onAuthLost: () => { stopTracker(); S.user = null; go('#/login'); } });
  try { S.user = JSON.parse(kv.get('user') || 'null'); } catch (e) { S.user = null; }
  try { S.biz = JSON.parse(kv.get('biz') || 'null'); } catch (e) { S.biz = null; }
  if (S.biz && S.biz.currency) Lv.setCurrency(S.biz.currency);

  const arr = (r) => (Array.isArray(r) ? r : r && (r.items || r.rows || r.deliveries || r.data || r.results) || []);
  const first = (n) => String(n || '').trim().split(/\s+/)[0] || 'Rider';
  const go = (h) => { if (location.hash === h) render(); else location.hash = h; };
  const err = (e) => Lv.toast(e && e.message ? e.message : 'Something went wrong', 'error');
  const busy = (btn, on, txt) => { if (!btn) return; if (on) { btn.dataset.t = btn.innerHTML; btn.disabled = true; btn.innerHTML = '<span class="spin" style="width:20px;height:20px;border-width:3px;margin:0;border-color:rgba(255,255,255,.4);border-top-color:#fff"></span> ' + (txt || ''); } else { btn.disabled = false; if (btn.dataset.t) btn.innerHTML = btn.dataset.t; } };
  const TONE = { PENDING: 'ye', ASSIGNED: 'bl', PICKED_UP: 'ye', ON_THE_WAY: 'or', ARRIVED: 'gr', DELIVERED: 'gr', FAILED: 'rd', CANCELLED: 'gy' };
  const LABEL = { PENDING: 'Pending', ASSIGNED: 'Assigned', PICKED_UP: 'Picked up', ON_THE_WAY: 'On the way', ARRIVED: 'Arrived', DELIVERED: 'Delivered', FAILED: 'Failed', CANCELLED: 'Cancelled' };
  const tag = (st, l) => `<span class="tag ${TONE[st] || 'gy'}">${esc(l || LABEL[st] || st)}</span>`;
  const onRoad = () => !!(S.dash && (S.dash.deliveries || []).some((d) => d.stage === 'ON_THE_WAY' || d.stage === 'ARRIVED'));

  /* =================== location sharing =================== */
  let stopGeo = null, lastSent = 0, sending = false;
  async function pushLocation(p) {
    const now = Date.now(); if (sending || now - lastSent < 4500) return; sending = true; lastSent = now;
    try {
      const b = await Lv.battery();
      const body = { lat: p.lat, lng: p.lng };
      if (p.accuracy != null) body.accuracy = Math.min(Math.round(p.accuracy), 100000);
      if (p.heading != null && isFinite(p.heading) && p.heading >= 0) body.heading = Math.round(p.heading);
      if (p.speed != null && isFinite(p.speed) && p.speed >= 0) body.speed = Math.round(p.speed * 10) / 10;
      if (b) body.battery = b;
      const r = await A.post('/rider/location', body);
      S.lastPing = Date.now(); S.live = r;
      (r.deliveries || []).forEach((d) => { if (S.detail && S.detail.orderId === d.orderId && S.detail.tracking) { S.detail.tracking.distanceM = d.distanceM; S.detail.tracking.etaMinutes = d.etaMinutes; } });
      if (S.onPing) S.onPing(r);
    } catch (e) { if (e.code !== 'NETWORK') S.posErr = e; } finally { sending = false; }
  }
  function startTracker() {
    if (stopGeo) return;
    Lv.wake.want = true; Lv.wake.on();
    stopGeo = Lv.geo.watch((p) => { S.pos = p; S.posErr = null; pushLocation(p); S.onPos && S.onPos(p); }, (e) => { S.posErr = e; S.onPos && S.onPos(null); if (e && e.code === 1) { Lv.toast(Lv.geo.message(e), 'error', 5000); } });
  }
  function stopTracker() { if (stopGeo) { stopGeo(); stopGeo = null; } Lv.wake.want = false; Lv.wake.off(); }
  async function setOnline(on) {
    try {
      let p = S.pos; if (on && !p) { try { p = await Lv.geo.once(); S.pos = p; } catch (e) { Lv.toast(Lv.geo.message(e), 'warn', 4500); } }
      const body = { online: on }; if (p) { body.lat = p.lat; body.lng = p.lng; } const b = await Lv.battery(); if (b) body.battery = b;
      await A.post('/rider/online', body);
      S.online = on; kv.set('want', on ? '1' : '0');
      if (on) startTracker(); else stopTracker();
      Lv.toast(on ? 'You are online. Your location is shared with the restaurant.' : 'You are offline.', on ? 'ok' : 'info');
    } catch (e) { err(e); }
    return S.online;
  }

  /* =================== live stream =================== */
  let stream = null;
  function openStream() {
    if (stream) return;
    stream = Lv.sse({
      open: async () => { const t = await A.post('/rider/stream-ticket'); return A.base + '/rider/stream?ticket=' + encodeURIComponent(t.ticket); },
      events: ['hello', 'assigned', 'payment', 'customer_moved', 'near_destination'],
      state: (s) => { S.sse = s; const c = $('#conn'); if (c) c.classList.toggle('off', s !== 'live'); },
      on: onEvent, poll: () => { if (['home', 'list'].includes(S.view)) { loadDash(true); } }, pollMs: 12000,
    });
  }
  function onEvent(name, d) {
    if (name === 'assigned') { Lv.beep('alert'); Lv.toast('New delivery: #' + d.orderNumber, 'ok', 5000); Lv.notify('New delivery', '#' + d.orderNumber + ' · ' + (d.address || ''), 'assigned'); loadDash(true); if (S.view === 'list') render(); }
    else if (name === 'payment') { Lv.beep(); if (d.method) Lv.toast('Payment received · ' + money(d.amount), 'ok'); if (S.view === 'pay' && S.payId && (!d.orderId || String(d.orderId) === String(S.payId))) render(); }
    else if (name === 'customer_moved') { Lv.toast('The customer updated their location', 'info'); if (S.detail && String(S.detail.orderId) === String(d.orderId)) { S.detail.customer.lat = d.lat; S.detail.customer.lng = d.lng; S.detail.customer.sharedLive = true; S.onDest && S.onDest(); } }
    else if (name === 'near_destination') { Lv.beep('alert'); if (S.view !== 'map') { const s = Lv.sheet(`<div class="center" style="padding:6px 0"><div class="bigok" style="background:var(--o)">${ic('pin')}</div><h3>You are at the customer</h3><p class="muted" style="margin:6px 0 16px">Order #${esc(d.orderNumber)} · about ${Lv.dist(d.distanceM)} away</p><button class="btn" id="na">Mark as arrived</button><div class="sp8"></div><button class="btn ghost" id="nx">Not yet</button></div>`); $('#nx', s.el).onclick = s.close; $('#na', s.el).onclick = async () => { s.close(); await act(d.orderId, 'arrived'); }; } else { Lv.toast('You are at the customer. Tap "Arrived".', 'ok', 4500); } }
  }

  /* =================== data =================== */
  async function loadDash(quiet) {
    try { const d = await A.get('/rider/dashboard'); S.dash = d; if (d.presence && typeof d.online === 'boolean' && d.online !== S.online) { S.online = d.online; if (S.online) startTracker(); } if (!quiet || S.view === 'home') paintHome(); updNav(); } catch (e) { if (!quiet) { if (!S.dash) throw e; err(e); } }
  }
  async function loadDetail(id) { const d = await A.get('/rider/deliveries/' + id); S.detail = d; return d; }

  /* =================== shell =================== */
  const NAV = [['home', 'Home', 'home'], ['list', 'Deliveries', 'box'], ['map', 'Map', 'map'], ['profile', 'Profile', 'user']];
  function navHtml(cur) {
    const n = S.dash ? (S.dash.counts.assigned + S.dash.counts.inProgress) : 0;
    return `<nav class="nav" id="nav">${NAV.map(([k, l, i]) => `<button data-nav="${k}" class="${cur === k ? 'on' : ''}">${ic(i)}<span>${l}</span>${k === 'list' && n ? `<b class="badge">${n}</b>` : ''}</button>`).join('')}</nav>`;
  }
  function updNav() { const nv = $('#nav'); if (!nv) return; const cur = (nv.querySelector('.on') || {}).dataset; nv.outerHTML = navHtml(cur ? cur.nav : S.view); bindNav(); }
  function bindNav() { $$('[data-nav]').forEach((b) => b.onclick = () => { const k = b.dataset.nav; if (k === 'map') { const live = S.dash && (S.dash.deliveries || []).find((d) => d.stage === 'ON_THE_WAY' || d.stage === 'ARRIVED') || S.dash && (S.dash.deliveries || [])[0]; go(live ? '#/map/' + live.orderId : '#/map'); } else go('#/' + k); }); }
  const top = (title, { back = true, right = '', dark = false } = {}) => `<div class="top ${dark ? 'dark' : ''}">${back ? `<button class="ib" data-back aria-label="Back">${ic('back')}</button>` : ''}<h1>${esc(title)}</h1>${right}</div>`;
  function bindBack() { $$('[data-back]').forEach((b) => b.onclick = () => { if (history.length > 1) history.back(); else go('#/home'); }); }
  function cleanup() { S.cleanup.forEach((f) => { try { f(); } catch (e) { /* ignore */ } }); S.cleanup = []; S.onPos = S.onPing = S.onDest = null; }

  /* =================== router =================== */
  function route() { const h = location.hash.replace(/^#\/?/, '').split('/'); return { v: h[0] || (A.has() ? 'home' : 'login'), id: h[1] || '' }; }
  async function render() {
    cleanup(); const r = route(); const my = ++S.seq;
    if (!A.has() || !S.user) { if (r.v !== 'login') return go('#/login'); }
    else if (r.v === 'login') return go('#/home');
    S.view = r.v; window.scrollTo(0, 0);
    const tm = document.querySelector('meta[name=theme-color]'); if (tm) tm.content = r.v === 'login' ? '#0b0f14' : '#F26A21';
    const V = { login: vLogin, home: vHome, list: vList, d: vDetail, map: vMap, pay: vPay, profile: vProfile, wallet: vWallet, earnings: vEarnings }[r.v] || vHome;
    if (r.v !== 'login') { openStream(); }
    try { await V(r.id, my); } catch (e) { if (my === S.seq) { app.innerHTML = `${top('Something went wrong', { back: r.v !== 'home' })}<div class="empty"><div class="em">${ic('alert')}</div><b>${esc(e.message || 'Could not load')}</b><button class="btn sm" style="margin-top:14px" id="rt">Try again</button></div>`; bindBack(); const b = $('#rt'); if (b) b.onclick = render; } }
  }
  window.addEventListener('hashchange', render);

  /* =================== views =================== */
  /* =================== sign-in screen =================== */
  // Icons: Lucide (ISC licence), the standard open-source set used by many production apps.
  const LI = {
    eye: '<path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/>',
    eyeoff: '<path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49"/><path d="M14.084 14.158a3 3 0 0 1-4.242-4.242"/><path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143"/><path d="m2 2 20 20"/>',
    lock: '<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    phone: '<rect width="14" height="20" x="5" y="2" rx="2" ry="2"/><path d="M12 18h.01"/>',
    user: '<circle cx="12" cy="8" r="5"/><path d="M20 21a8 8 0 0 0-16 0"/>',
    idcard: '<path d="M16 10h2"/><path d="M16 14h2"/><path d="M6.17 15a3 3 0 0 1 5.66 0"/><circle cx="9" cy="11" r="2"/><rect x="2" y="5" width="20" height="14" rx="2"/>',
    shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
    alert: '<circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/>',
    arrow: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    qr: '<rect width="5" height="5" x="3" y="3" rx="1"/><rect width="5" height="5" x="16" y="3" rx="1"/><rect width="5" height="5" x="3" y="16" rx="1"/><path d="M21 16h-3a2 2 0 0 0-2 2v3"/><path d="M21 21v.01"/><path d="M12 7v3a2 2 0 0 1-2 2H7"/><path d="M3 12h.01"/><path d="M12 3h.01"/><path d="M12 16v.01"/><path d="M16 12h1"/><path d="M21 12v.01"/><path d="M12 21v-1"/>',
    bike: '<circle cx="18.5" cy="17.5" r="3.5"/><circle cx="5.5" cy="17.5" r="3.5"/><circle cx="15" cy="5" r="1"/><path d="M12 17.5V14l-3-3 4-3 2 3h2"/>',
    pkg: '<path d="M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73z"/><path d="M12 22V12"/><path d="m3.29 7 8.71 5 8.71-5"/>',
    ok: '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
    cash: '<rect width="20" height="12" x="2" y="6" rx="2"/><circle cx="12" cy="12" r="2"/><path d="M6 12h.01M18 12h.01"/>',
    map: '<path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/>',
  };
  const li = (n, cls) => `<svg${cls ? ` class="${cls}"` : ''} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${LI[n]}</svg>`;

  // city skyline tiles (generated once; seamless so they can scroll forever)
  let SKY = null;
  function tile(W, H, seed, fill, win, dens) {
    let s = seed; const r = () => (s = (s * 16807) % 2147483647) / 2147483647; let x = 0, o = '';
    while (x < W) {
      const w = Math.min(26 + ((r() * 44) | 0), W - x), h = (H * (0.28 + r() * 0.62)) | 0; o += `<rect x="${x}" y="${H - h}" width="${w}" height="${h}" fill="${fill}"/>`;
      if (r() < 0.25) o += `<rect x="${x + w / 2 - 1}" y="${H - h - 12}" width="2" height="12" fill="${fill}"/>`;
      for (let wy = H - h + 8; wy < H - 8; wy += 11) for (let wx = x + 6; wx < x + w - 6; wx += 9) if (r() < dens) o += `<rect x="${wx}" y="${wy}" width="3.5" height="5" rx=".8" fill="${win}" opacity="${(0.3 + r() * 0.65).toFixed(2)}"/>`;
      x += w + (r() < 0.3 ? 5 : 0);
    }
    return `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${o}</svg>`)}")`;
  }
  const skies = () => SKY || (SKY = { far: tile(520, 120, 7, '#1b2632', '#ffcf8a', 0.2), near: tile(520, 92, 23, '#0d1218', '#ffb36b', 0.34) });

  const SCOOTER = `<svg viewBox="0 0 220 150" role="img" aria-label="Delivery rider on a scooter"><defs><linearGradient id="rlg" x1="0" x2="1"><stop offset="0" stop-color="#FFE08A" stop-opacity=".55"/><stop offset="1" stop-color="#FFE08A" stop-opacity="0"/></linearGradient></defs>
    <ellipse cx="112" cy="134" rx="84" ry="5" fill="rgba(0,0,0,.45)"/>
    <path d="M180 64 L218 50 L218 80 Z" fill="url(#rlg)"/>
    <g><circle cx="52" cy="112" r="20" fill="#0f1317" stroke="#2c3440" stroke-width="3"/><g class="rl-spin"><circle cx="52" cy="112" r="12" fill="none" stroke="#98a2ad" stroke-width="2"/><path d="M52 100v24M40 112h24M43.5 103.5l17 17M60.5 103.5l-17 17" stroke="#6b7480" stroke-width="1.6"/></g><circle cx="52" cy="112" r="4.5" fill="#cfd4d9"/></g>
    <rect x="22" y="72" width="46" height="5" rx="2" fill="#1c2229"/>
    <rect x="12" y="30" width="60" height="44" rx="8" fill="#F26A21"/><rect x="12" y="30" width="60" height="11" rx="8" fill="#FF8A3D"/><rect x="12" y="38" width="60" height="3" fill="#D9560F"/>
    <path d="M42 46.5l2.6 5.4 5.9.8-4.3 4.1 1.1 5.8-5.3-2.8-5.3 2.8 1.1-5.8-4.3-4.1 5.9-.8z" fill="#fff"/>
    <path d="M34 104C34 85 48 74 72 74H106V100H80Z" fill="#F26A21"/><path d="M30 110A22 22 0 0 1 74 110" fill="none" stroke="#D9560F" stroke-width="5" stroke-linecap="round"/>
    <rect x="62" y="65" width="44" height="10" rx="5" fill="#1c2229"/><rect x="100" y="96" width="54" height="10" rx="5" fill="#1c2229"/>
    <g class="rl-rider"><polyline points="92,68 117,86 123,100" fill="none" stroke="#374151" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/><rect x="115" y="97" width="18" height="8" rx="3.5" fill="#14171A"/>
    <line x1="90" y1="66" x2="118" y2="36" stroke="#1e293b" stroke-width="22" stroke-linecap="round"/><line x1="96" y1="58" x2="108" y2="46" stroke="#F26A21" stroke-width="3" stroke-linecap="round" opacity=".9"/>
    <polyline points="117,40 135,54 154,46" fill="none" stroke="#1e293b" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/><circle cx="155" cy="46" r="5" fill="#F26A21"/>
    <circle cx="128" cy="19" r="14" fill="#fff"/><path d="M118 15A14 14 0 0 1 131 6" fill="none" stroke="#F26A21" stroke-width="3.5" stroke-linecap="round"/><path d="M131 13A14 14 0 0 1 142 24L128 25Z" fill="#14171A" opacity=".88"/></g>
    <path d="M150 100 L158 62 Q160 55 167 55 H171 L176 100Z" fill="#F26A21"/><path d="M168 56 L176 100" stroke="#D9560F" stroke-width="3"/>
    <line x1="169" y1="66" x2="175" y2="112" stroke="#3a4552" stroke-width="5" stroke-linecap="round"/>
    <g><circle cx="174" cy="112" r="20" fill="#0f1317" stroke="#2c3440" stroke-width="3"/><g class="rl-spin"><circle cx="174" cy="112" r="12" fill="none" stroke="#98a2ad" stroke-width="2"/><path d="M174 100v24M162 112h24M165.5 103.5l17 17M182.5 103.5l-17 17" stroke="#6b7480" stroke-width="1.6"/></g><circle cx="174" cy="112" r="4.5" fill="#cfd4d9"/></g>
    <line x1="161" y1="55" x2="151" y2="45" stroke="#1c2229" stroke-width="5" stroke-linecap="round"/><rect x="143" y="41" width="14" height="6" rx="3" fill="#1c2229"/>
    <circle cx="177" cy="63" r="5.5" fill="#FFE08A"/><circle cx="177" cy="63" r="9" fill="#FFE08A" opacity=".25"/></svg>`;

  const CHIPS = [['pkg', 'New delivery', 'Kilimani · 2.4 km'], ['bike', 'Order picked up', 'Heading to the customer'], ['ok', 'Delivered', 'Great job, rider!'], ['cash', 'Cash handed over', 'Cashier confirmed']];
  let chipT = null;
  function stage(brand, logo) {
    clearInterval(chipT);
    const st = Array.from({ length: 24 }, (_, i) => `<i style="left:${(i * 37 + (i % 5) * 11) % 100}%;top:${(i * 53 + (i % 7) * 9) % 100}%;animation-delay:${(i % 9) * 0.4}s"></i>`).join('');
    const k = skies(); const c0 = CHIPS[0];
    return `<div class="rl" id="rl"><div class="rl-hero" aria-hidden="false">
      <div class="rl-stars">${st}</div><div class="rl-sun"></div>
      <div class="rl-layer rl-far" style="background-image:${k.far};background-size:520px 120px"></div><div class="rl-layer rl-near" style="background-image:${k.near};background-size:520px 92px"></div>
      <svg class="rl-route" viewBox="0 0 360 150" preserveAspectRatio="xMaxYMax meet" aria-hidden="true"><path d="M150 128C190 66 252 150 292 102"/></svg>
      <div class="rl-pin" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3" fill="#fff" stroke="none"/></svg></div>
      <div class="rl-road"></div>
      <div class="rl-ride"><div class="rl-spd"><i></i><i></i><i></i></div><div class="rl-bob">${SCOOTER}</div></div>
      <div class="rl-bar"><div class="rl-logo">${logo ? `<img src="${esc(logo)}" alt="" onerror="this.remove()">` : ''}<svg viewBox="0 0 24 24" fill="currentColor" ${logo ? 'style="position:absolute;z-index:-1"' : ''}><path d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4 6.1 20.5l1.2-6.5L2.5 9.4l6.6-.9L12 2.5z"/></svg></div><div class="rl-bn"><b id="rlbn">${esc(brand)}</b><span>Rider</span></div></div>
      <div class="rl-copy"><h1>Ready to<br><em>deliver?</em></h1><p>Sign in to see your orders and start earning.</p></div>
      <div class="rl-chip" id="rlchip" aria-hidden="true"><div class="ci" id="rlci">${li(c0[0])}</div><div class="tx"><b id="rlct">${c0[1]}</b><small id="rlcs">${c0[2]}</small></div></div>
    </div><div class="rl-sheet"><div class="rl-st" id="rlb"></div></div></div>`;
  }
  function chipLoop() {
    let i = 0; chipT = setInterval(() => {
      const ch = $('#rlchip'); if (!ch) return clearInterval(chipT); ch.classList.add('sw');
      setTimeout(() => { i = (i + 1) % CHIPS.length; const c = CHIPS[i]; const a = $('#rlci'); if (!a) return; a.innerHTML = li(c[0]); $('#rlct').textContent = c[1]; $('#rlcs').textContent = c[2]; ch.classList.remove('sw'); }, 280);
    }, 3200);
  }

  async function vLogin() {
    stopTracker(); let ctx = null, mode = kv.get('mode') === 'code' ? 'code' : 'phone', bad = '';
    app.innerHTML = stage((S.biz && S.biz.name) || 'Six Star POS', S.biz && S.biz.logo); chipLoop();
    const body = $('#rlb'); S.cleanup.push(() => clearInterval(chipT));
    if (!QR) {
      body.innerHTML = `<h2 class="rl-h2">Scan your rider QR code</h2><p class="rl-sub">Your manager gives each rider a QR code for this business.</p>
        <div class="rl-steps"><div><span class="n">${li('qr')}</span><span><b>Scan the QR code</b><span>Use your phone camera</span></span></div><div><span class="n">${li('user')}</span><span><b>Sign in</b><span>Phone and password, or employee code and PIN</span></span></div><div><span class="n">${li('bike')}</span><span><b>Go online</b><span>Start receiving deliveries</span></span></div></div>
        <div class="rl-help">${li('shield')} Secure sign-in for delivery partners</div>`; return;
    }
    body.innerHTML = `<h2 class="rl-h2">Welcome back</h2><p class="rl-sub">Checking your restaurant...</p><div class="rl-loading"><i></i><i></i><i></i></div>`;
    try { ctx = await A.get('/public/rider/' + encodeURIComponent(QR)); } catch (e) { bad = e.message; }
    if (!$('#rlb')) return;
    if (ctx && ctx.business) { S.biz = ctx.business; kv.set('biz', JSON.stringify(ctx.business)); Lv.setCurrency(ctx.business.currency); const bn = $('#rlbn'); if (bn) bn.textContent = ctx.business.name; }
    const field = (id, icon, label, o = {}) => `<div class="rl-f" id="f${id}"><span class="li">${li(icon)}</span><input id="${id}" name="${o.name || id}" type="${o.type || 'text'}" placeholder=" " autocomplete="${o.ac || 'off'}" ${o.im ? `inputmode="${o.im}"` : ''} ${o.enter ? `enterkeyhint="${o.enter}"` : ''} autocapitalize="none" autocorrect="off" spellcheck="false" ${o.max ? `maxlength="${o.max}"` : ''}><label for="${id}">${label}</label>${o.eye ? `<button type="button" class="rl-eye" aria-pressed="false" aria-label="Show ${o.eye}" data-for="${id}" data-what="${o.eye}">${li('eye', 'on')}${li('eyeoff', 'off')}</button>` : ''}</div>`;
    const fields = () => mode === 'phone'
      ? field('a', 'user', 'Phone number or email', { name: 'username', ac: 'username', im: 'email', enter: 'next' }) + field('b', 'lock', 'Password', { type: 'password', name: 'password', ac: 'current-password', enter: 'go', eye: 'password' })
      : field('a', 'idcard', 'Employee code', { name: 'employeeCode', ac: 'username', enter: 'next' }) + field('b', 'lock', 'PIN', { type: 'password', name: 'pin', ac: 'current-password', im: 'numeric', enter: 'go', eye: 'PIN', max: 12 });
    body.innerHTML = `<h2 class="rl-h2">Welcome back</h2><p class="rl-sub">Sign in to start receiving deliveries.</p>
      <div class="rl-seg" id="seg" data-m="${mode}" role="tablist"><button type="button" data-m="phone" role="tab" class="${mode === 'phone' ? 'on' : ''}">${li('phone')} Phone</button><button type="button" data-m="code" role="tab" class="${mode === 'code' ? 'on' : ''}">${li('idcard')} Employee code</button></div>
      <form id="lf" novalidate><div id="ff">${fields()}</div><div id="em">${bad ? `<div class="rl-err" role="alert">${li('alert')}<span>${esc(bad)}</span></div>` : ''}</div>
      <button class="rl-btn" id="go" type="submit" ${bad && !ctx ? 'disabled' : ''}><span id="gl">Sign in</span>${li('arrow', 'ar')}</button></form>
      <div class="rl-help">${li('shield')} Secure sign-in · Delivery partners only</div><p class="rl-fine">Forgot your password or PIN? Ask your manager to reset it.</p>`;
    const clearErr = () => { $('#em').innerHTML = ''; $$('.rl-f').forEach((f) => f.classList.remove('bad')); };
    const seg = $('#seg');
    $$('[data-m]', seg).forEach((b) => b.onclick = () => { if (mode === b.dataset.m) return; mode = b.dataset.m; kv.set('mode', mode); seg.dataset.m = mode; $$('[data-m]', seg).forEach((x) => x.classList.toggle('on', x === b)); const ff = $('#ff'); ff.style.opacity = 0; setTimeout(() => { ff.innerHTML = fields(); ff.style.transition = 'opacity .25s'; ff.style.opacity = 1; clearErr(); }, 140); });
    // show / hide password + PIN (works for every password-type field in this form)
    $('#lf').addEventListener('mousedown', (e) => { if (e.target.closest('.rl-eye')) e.preventDefault(); });
    $('#lf').addEventListener('click', (e) => { const b = e.target.closest('.rl-eye'); if (!b) return; const i = $('#' + b.dataset.for), show = i.type === 'password'; const had = document.activeElement === i; i.type = show ? 'text' : 'password'; b.setAttribute('aria-pressed', String(show)); b.setAttribute('aria-label', (show ? 'Hide ' : 'Show ') + b.dataset.what); if (had) { i.focus(); const n = i.value.length; try { i.setSelectionRange(n, n); } catch (x) { /* some input types */ } } });
    $('#lf').addEventListener('input', () => { if ($('#em').firstChild) clearErr(); });
    const fail = (msg, ids) => { const em = $('#em'); em.innerHTML = `<div class="rl-err" role="alert">${li('alert')}<span>${esc(msg)}</span></div>`; (ids || ['a', 'b']).forEach((id) => { const f = $('#f' + id); if (f) { f.classList.add('bad'); f.classList.remove('shake'); void f.offsetWidth; f.classList.add('shake'); } }); };
    $('#lf').onsubmit = async (e) => {
      e.preventDefault(); const btn = $('#go'), gl = $('#gl'); if (btn.disabled) return; clearErr();
      const a = $('#a').value.trim(), p = $('#b').value;
      if (!a || !p) return fail(mode === 'phone' ? 'Enter your phone number (or email) and password.' : 'Enter your employee code and PIN.', [!a && 'a', !p && 'b'].filter(Boolean));
      btn.disabled = true; btn.innerHTML = '<span class="sp"></span><span>Signing in...</span>';
      try {
        const r = await A.post('/public/rider/' + encodeURIComponent(QR) + '/login', mode === 'phone' ? { identifier: a, password: p } : { employeeCode: a, pin: p });
        A.setSession(r.accessToken, r.refreshToken); S.user = r.user; kv.set('user', JSON.stringify(r.user));
        const cur = r.country && (r.country.currency || r.country.currencyCode); if (cur) { Lv.setCurrency(cur); S.biz = Object.assign({}, S.biz, { currency: cur }); kv.set('biz', JSON.stringify(S.biz)); }
        btn.classList.add('ok'); btn.innerHTML = `<svg class="ck" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg><span>Welcome back</span>`;
        try { navigator.vibrate && navigator.vibrate(30); } catch (x) { /* none */ }
        setTimeout(() => { const rl = $('#rl'); if (rl) rl.classList.add('leave'); setTimeout(() => go('#/home'), 480); }, 650);
      } catch (x) {
        btn.disabled = false; btn.classList.remove('ok'); btn.innerHTML = `<span id="gl">Sign in</span>${li('arrow', 'ar')}`;
        fail(x.code === 'NETWORK' ? x.message : x.status === 429 ? 'Too many attempts. Please wait a few minutes and try again.' : x.message || 'Sign-in failed. Please try again.', x.code === 'NETWORK' ? [] : x.code === 'NOT_A_RIDER' ? ['a'] : ['a', 'b']);
      }
    };
  }

  /* ---- home ---- */
  async function vHome() {
    app.innerHTML = `<div class="view"><div class="hello"><div class="sk" style="height:56px"></div></div><div class="stats"><div class="sk" style="height:76px"></div><div class="sk" style="height:76px"></div><div class="sk" style="height:76px"></div></div></div>` + navHtml('home'); bindNav();
    S.onPing = () => paintGps();
    await loadDash(); S.cleanup.push(() => { S.onPing = null; });
    if (kv.get('want') === '1' && !S.online && S.dash && !S.dash.online) { /* keep manual: do not surprise the rider */ }
    if (S.dash && S.dash.online && !stopGeo) startTracker();
  }
  function paintGps() { const g = $('#gps'); if (!g) return; g.innerHTML = gpsText(); }
  function gpsText() { if (!S.online) return 'Go online to share your location'; if (S.posErr && S.posErr.code) return `<span style="color:#ffd7c2">${esc(Lv.geo.message(S.posErr))}</span>`; if (!S.pos) return 'Finding your location...'; return `Sharing live location · ${S.lastPing ? Lv.ago(S.lastPing) : 'starting'}`; }
  function paintHome() {
    if (S.view !== 'home') return; const d = S.dash; if (!d) return; const c = d.counts || {}; const hr = new Date().getHours();
    const g = hr < 12 ? 'Good morning' : hr < 17 ? 'Good afternoon' : 'Good evening'; const cur = (d.deliveries || []).length;
    app.innerHTML = `<div class="view"><div class="hello"><div class="row"><div class="grow"><h2>${g}, ${esc(first(d.greeting && d.greeting.firstName || S.user && S.user.name))}</h2><div class="fine">You have ${cur} deliver${cur === 1 ? 'y' : 'ies'} today</div></div><button class="ib" id="bell" aria-label="Alerts">${ic('bell')}</button><span class="tag ${S.sse === 'live' ? 'gr' : 'ye'}" id="conn">${S.sse === 'live' ? 'Live' : 'Offline'}</span></div></div>
      <div class="stats"><div class="stat"><b>${c.assigned || 0}</b><span>Assigned</span></div><div class="stat"><b>${c.inProgress || 0}</b><span>In Progress</span></div><div class="stat"><b>${c.completed || 0}</b><span>Completed</span></div></div>
      <button class="online-card ${S.online ? '' : 'off'}" id="onl" style="width:calc(100% - 32px)" aria-pressed="${S.online}"><span class="t">${ic('target')}<span>${S.online ? 'You are Online' : 'Go Online'}<small id="gps">${gpsText()}</small></span></span><span class="tg"></span></button>
      ${d.cashHeld > 0 ? `<button class="dcard" id="cashb" style="margin-top:14px;background:#fff7f1;border-color:#fbd5bd"><div class="av">${ic('wallet')}</div><div class="grow"><div class="nm">Cash on you: ${money(d.cashHeld)}</div><div class="meta">${d.cashHeldCount} payment${d.cashHeldCount === 1 ? '' : 's'} to hand to the cashier</div></div>${ic('chev')}</button>` : ''}
      <div class="sec-h"><h3>Current Deliveries</h3><button id="all">View all</button></div>
      ${cur ? (d.deliveries || []).map(dcard).join('') : `<div class="empty"><div class="em">${ic('bike')}</div><b>No deliveries right now</b>${S.online ? 'New orders appear here the moment they are assigned.' : 'Go online to receive deliveries.'}</div>`}
      <div class="sp"></div></div>` + navHtml('home');
    bindNav(); bindCards(); const o = $('#onl'); if (o) o.onclick = async () => { o.style.opacity = .7; await setOnline(!S.online); paintHome(); };
    const a = $('#all'); if (a) a.onclick = () => go('#/list'); const cb = $('#cashb'); if (cb) cb.onclick = () => go('#/wallet');
    const bl = $('#bell'); if (bl) bl.onclick = () => notifSheet();
  }
  function dcard(d) {
    return `<button class="dcard" data-open="${d.orderId}"><div class="av">${ic(d.stage === 'ON_THE_WAY' || d.stage === 'ARRIVED' ? 'bike' : 'box')}</div><div class="grow"><div class="nm">#${esc(d.orderNumber)}</div><div class="meta">${money(d.total)}${d.distanceKm != null ? ' · ' + Lv.km(d.distanceKm) : ''}</div><div class="meta ell">${esc(d.landmark || d.address || '')}</div></div><div class="rt">${tag(d.stage, d.label)}<div style="margin-top:6px">${d.etaMinutes != null ? Lv.eta(d.etaMinutes) : ''}</div></div></button>`;
  }
  function bindCards() { $$('[data-open]').forEach((b) => b.onclick = () => go('#/d/' + b.dataset.open)); }

  /* ---- list ---- */
  async function vList() {
    const tab = kv.get('tab') || 'active';
    app.innerHTML = top('My Deliveries', { back: false }) + `<div class="view"><div class="tabs"><button data-t="active" class="${tab === 'active' ? 'on' : ''}">Active</button><button data-t="completed" class="${tab === 'completed' ? 'on' : ''}">Completed</button></div><div id="ls"><div class="pad" style="margin-top:12px"><div class="sk" style="height:84px"></div></div></div></div>` + navHtml('list'); bindNav();
    $$('[data-t]').forEach((b) => b.onclick = () => { kv.set('tab', b.dataset.t); render(); });
    const [r, av] = await Promise.all([A.get('/rider/deliveries', { tab, limit: 50 }), tab === 'active' ? A.get('/rider/available').catch(() => null) : null]);
    const rows = arr(r); const tabs = r && r.tabs; if (tabs) { const bs = $$('[data-t]'); bs[0].textContent = 'Active (' + tabs.active + ')'; bs[1].textContent = 'Completed (' + tabs.completed + ')'; }
    let h = rows.length ? rows.map(dcard).join('') : `<div class="empty"><div class="em">${ic('box')}</div><b>${tab === 'active' ? 'No active deliveries' : 'Nothing completed yet'}</b>${tab === 'active' ? 'Assigned deliveries show up here.' : 'Finished deliveries from the last 14 days show up here.'}</div>`;
    const avl = av && av.enabled ? arr(av) : []; if (avl.length) h += `<div class="sec-h"><h3>Available to take</h3></div>` + avl.map((d) => `<div class="dcard" style="display:block"><div class="row"><div class="grow"><div class="nm">#${esc(d.orderNumber)} · ${money(d.total)}</div><div class="meta ell">${esc(d.address || '')}</div></div><button class="btn sm" data-claim="${d.orderId}">Take</button></div></div>`).join('');
    $('#ls').innerHTML = h; bindCards();
    $$('[data-claim]').forEach((b) => b.onclick = async (e) => { e.stopPropagation(); busy(b, true); try { await A.post('/rider/deliveries/' + b.dataset.claim + '/claim'); Lv.toast('Delivery is yours', 'ok'); go('#/d/' + b.dataset.claim); } catch (x) { busy(b, false); err(x); } });
  }

  /* ---- order details ---- */
  const STEP_ORDER = [['CONFIRMED', 'Confirmed'], ['PICKED_UP', 'Picked up'], ['ON_THE_WAY', 'On the way'], ['DELIVERED', 'Delivered']];
  function stepper(tl) {
    const list = (tl && tl.length ? tl : STEP_ORDER.map(([key, label]) => ({ key, label }))); return `<div class="steps">${list.map((s) => `<div class="s ${s.current ? 'now' : s.done ? 'done' : ''}"><i></i>${esc(s.label)}</div>`).join('')}</div>`;
  }
  async function vDetail(id, my) {
    app.innerHTML = top('Order Details') + `<div class="pad" style="margin-top:14px"><div class="sk" style="height:120px"></div></div>`; bindBack();
    const d = await loadDetail(id); if (my !== S.seq) return;
    const c = d.customer || {}, p = d.pickup || {}, can = d.can || {}; const pay = d.payment;
    const prim = []; const sec = [];
    if (['DELIVERED', 'FAILED', 'CANCELLED'].includes(d.stage)) { /* no actions */ }
    else {
      if (d.stage === 'ASSIGNED' || d.stage === 'PICKED_UP') {
        if (!d.ready) sec.push('<div class="note">' + ic('clock') + '<div>The kitchen is still preparing this order. You can start once it is ready.</div></div>');
        if (can.start) prim.push(['start', ic('nav') + ' Start Navigation', '']);
        if (can.pickup) (prim.length ? sec : prim).push(['pickup', ic('box') + ' I have picked up the order', prim.length ? 'ghost' : '']);
      }
      if (d.stage === 'ON_THE_WAY') { prim.push(['map', ic('map') + ' Open live map', '']); if (can.arrived) prim.push(['arrived', ic('pin') + ' Arrived at location', 'ghost']); }
      if (can.pay) prim.push(['pay', ic('cash') + ' Collect payment ' + (pay ? money(pay.amountDue) : ''), d.stage === 'ARRIVED' ? '' : 'ghost']);
      if (can.complete && ['ON_THE_WAY', 'ARRIVED'].includes(d.stage)) prim.push(['complete', ic('check') + ' Complete delivery', can.pay ? 'ghost' : 'green']);
    }
    app.innerHTML = top('Order Details', { right: `<span>${tag(d.stage, d.label)}</span>` }) + `<div class="view nonav">
      <div class="hd"><div class="row"><div class="id grow">#${esc(d.orderNumber)}</div><div class="b">${money(d.total)}</div></div><div class="fine">${d.distanceKm != null ? Lv.km(d.distanceKm) + ' · ' : ''}Placed ${Lv.clock(d.placedAt)}${d.tracking && d.tracking.etaMinutes != null ? ' · ETA ' + Lv.eta(d.tracking.etaMinutes) : ''}</div><div class="sp8"></div>${stepper(d.timeline)}</div>
      <div class="pad"><div class="sp"></div>
      <div class="card"><div class="sec-h" style="margin:0 0 8px"><h3>Customer</h3></div><div class="row"><div class="rd-av">${esc(first(c.name).charAt(0).toUpperCase())}</div><div class="grow"><div class="b">${esc(c.name || 'Customer')}</div><div class="fine">${esc(c.phone || '')}</div></div>${c.phone ? `<a class="callb" href="${Lv.phoneHref(c.phone)}" aria-label="Call">${ic('phone')}</a>` : ''}</div>
        <div class="kv" style="margin-top:8px"><span>${ic('pin')} Address</span><span style="text-align:right">${esc(c.address || '')}${c.landmark ? '<br><span class="fine">' + esc(c.landmark) + '</span>' : ''}</span></div>
        ${c.instructions ? `<div class="note info">${ic('alert')}<div>${esc(c.instructions)}</div></div>` : ''}${c.sharedLive ? `<div class="fine">${ic('target')} The customer is sharing their live location.</div>` : ''}
        ${c.mapsUrl ? `<a class="btn line sm" style="margin-top:10px;width:100%" href="${esc(c.mapsUrl)}" target="_blank" rel="noopener">${ic('nav')} Open in Google Maps</a>` : ''}</div>
      <div class="sp"></div>
      <div class="card"><div class="sec-h" style="margin:0 0 4px"><h3>Items (${(d.items || []).reduce((s, i) => s + (i.quantity || 0), 0)})</h3></div>${(d.items || []).map((i) => `<div class="itm"><div class="q">${i.quantity}x</div><div class="grow"><div class="b">${esc(i.name)}</div>${i.variant || i.notes ? `<div class="fine">${esc([i.variant, i.notes].filter(Boolean).join(' · '))}</div>` : ''}</div><div class="b">${money(i.total)}</div></div>`).join('')}
        ${d.deliveryFee ? `<div class="kv"><span>Delivery fee</span><span>${money(d.deliveryFee)}</span></div>` : ''}<div class="kv"><span class="b" style="color:var(--ink)">Total</span><span class="b">${money(d.total)}</span></div></div>
      <div class="sp"></div>
      <div class="card"><div class="sec-h" style="margin:0 0 8px"><h3>Payment method</h3></div><div class="row"><div class="av" style="width:42px;height:42px;border-radius:12px;background:${pay && pay.state === 'PAID' ? 'var(--okl)' : 'var(--ol)'};color:${pay && pay.state === 'PAID' ? 'var(--ok)' : 'var(--o)'};display:grid;place-items:center">${ic(pay && pay.state === 'PAID' ? 'check' : 'cash')}</div><div class="grow"><div class="b">${esc(pay ? pay.methodLabel : 'Payment')}</div><div class="fine">${pay ? ({ UNPAID: 'Collect ' + money(pay.amountDue) + ' from the customer', AWAITING_MPESA: 'Waiting for the customer to enter their M-PESA PIN', CASH_HELD: 'Cash received · hand it to the cashier', PAID: pay.orderPayment === 'PREPAID' ? 'Paid online · nothing to collect' : 'Payment confirmed' })[pay.state] || '' : ''}</div></div>${pay ? tag(pay.state === 'PAID' ? 'ARRIVED' : pay.state === 'UNPAID' ? 'PENDING' : 'PICKED_UP', ({ UNPAID: 'To collect', AWAITING_MPESA: 'Waiting', CASH_HELD: 'Cash held', PAID: 'Paid' })[pay.state]) : ''}</div></div>
      ${p.branch ? `<div class="sp"></div><div class="card"><div class="sec-h" style="margin:0 0 6px"><h3>Pickup</h3></div><div class="row"><div class="grow"><div class="b">${esc(p.branch.name)}</div><div class="fine">${esc(p.branch.address || '')}</div></div>${p.branch.phone ? `<a class="callb" href="${Lv.phoneHref(p.branch.phone)}">${ic('phone')}</a>` : ''}</div></div>` : ''}
      ${d.failReason ? `<div class="note bad">${ic('alert')}<div>${esc(d.failReason)}</div></div>` : ''}${sec.filter((x) => typeof x === 'string').join('')}
      <div class="sp"></div></div></div>
      ${prim.length || sec.some((x) => Array.isArray(x)) || can.fail ? `<div class="cta">${prim.filter((x) => Array.isArray(x)).map(([k, l, cl]) => `<button class="btn ${cl}" data-act="${k}">${l}</button>`).join('')}${sec.filter((x) => Array.isArray(x)).map(([k, l, cl]) => `<button class="btn ${cl}" data-act="${k}">${l}</button>`).join('')}${c.phone && !['DELIVERED', 'FAILED'].includes(d.stage) ? `<a class="btn ghost" href="${Lv.phoneHref(c.phone)}">${ic('phone')} Call Customer</a>` : ''}${can.fail ? `<button class="btn red" data-act="fail">${ic('x')} I can't deliver this order</button>` : ''}</div>` : ''}`;
    bindBack(); $$('[data-act]').forEach((b) => b.onclick = () => act(id, b.dataset.act, b));
  }

  /* ---- actions ---- */
  async function pos() { if (S.pos) return S.pos; try { S.pos = await Lv.geo.once(); return S.pos; } catch (e) { return null; } }
  async function act(id, what, btn) {
    try {
      if (what === 'map') return go('#/map/' + id);
      if (what === 'pay') return go('#/pay/' + id);
      if (what === 'fail') return failSheet(id);
      busy(btn, true, 'Please wait...');
      if (what === 'pickup') { await A.post(`/rider/deliveries/${id}/pickup`); Lv.toast('Marked as picked up', 'ok'); }
      else if (what === 'start') {
        const p = await pos(); if (!p) Lv.toast('Turn on location so the customer can follow you.', 'warn', 4500);
        await A.post(`/rider/deliveries/${id}/start`, p ? { lat: p.lat, lng: p.lng } : {});
        if (!S.online) { S.online = true; kv.set('want', '1'); startTracker(); }
        Lv.toast('Delivery started. The customer can now see you.', 'ok'); loadDash(true); return go('#/map/' + id);
      } else if (what === 'arrived') { const p = S.pos; await A.post(`/rider/deliveries/${id}/arrived`, p ? { lat: p.lat, lng: p.lng } : {}); Lv.toast('The customer has been told you are here.', 'ok'); }
      else if (what === 'complete') { const d = await A.post(`/rider/deliveries/${id}/complete`); await loadDash(true); return delivered(id, d); }
      loadDash(true); await render();
    } catch (e) {
      busy(btn, false);
      if (e.code === 'PAYMENT_NOT_COLLECTED') { Lv.toast(e.message, 'warn', 4500); return go('#/pay/' + id); }
      err(e);
    }
  }
  function failSheet(id) {
    const s = Lv.sheet(`<h3>Can't deliver?</h3><p class="muted" style="margin-bottom:12px">Tell the manager why. If you have not left the restaurant yet, the order goes back to be reassigned.</p><div class="row" style="flex-wrap:wrap;gap:8px;margin-bottom:10px">${['Customer not answering', 'Wrong address', 'Customer refused', 'Bike problem', 'Order not ready'].map((r) => `<button class="tag gy" data-r="${r}" style="padding:8px 12px;font-size:13px">${r}</button>`).join('')}</div><textarea class="field" id="fr" rows="2" placeholder="Reason"></textarea><div class="sp"></div><button class="btn red" id="fs" style="color:#fff;background:var(--bad)">Confirm</button><div class="sp8"></div><button class="btn ghost" id="fc">Cancel</button>`);
    $$('[data-r]', s.el).forEach((b) => b.onclick = () => { $('#fr', s.el).value = b.dataset.r; });
    $('#fc', s.el).onclick = s.close;
    $('#fs', s.el).onclick = async (e) => { const r = $('#fr', s.el).value.trim(); if (r.length < 3) return Lv.toast('Please give a reason', 'warn'); busy(e.currentTarget, true); try { const o = await A.post(`/rider/deliveries/${id}/fail`, { reason: r }); s.close(); loadDash(true); Lv.toast(o && o.returnedToPool ? 'Order returned to the manager' : 'Delivery marked as failed', 'info'); go('#/home'); } catch (x) { busy(e.currentTarget, false); err(x); } };
  }

  /* ---- live navigation map ---- */
  const routeCache = { k: '', pts: null, at: 0 };
  async function osrm(a, b) {
    const k = [a.lat.toFixed(3), a.lng.toFixed(3), b.lat.toFixed(4), b.lng.toFixed(4)].join(); if (routeCache.k === k && Date.now() - routeCache.at < 90000) return routeCache.pts;
    const c = new AbortController(); const t = setTimeout(() => c.abort(), 6000);
    try { const r = await fetch(`https://router.project-osrm.org/route/v1/driving/${a.lng},${a.lat};${b.lng},${b.lat}?overview=full&geometries=geojson`, { signal: c.signal }); const j = await r.json(); const pts = j.routes && j.routes[0] ? j.routes[0].geometry.coordinates.map(([lng, lat]) => ({ lat, lng })) : null; routeCache.k = k; routeCache.pts = pts; routeCache.at = Date.now(); return pts; } catch (e) { return null; } finally { clearTimeout(t); }
  }
  async function vMap(id, my) {
    let d = null; if (id) { app.innerHTML = '<div class="mapscr"><div class="lv-nomap">Loading map...</div></div>'; d = await loadDetail(id); if (my !== S.seq) return; }
    else { const dd = S.dash || await A.get('/rider/dashboard').catch(() => null); if (dd) S.dash = dd; const f = dd && (dd.deliveries || [])[0]; if (f) return go('#/map/' + f.orderId); }
    const dest = () => (d && d.customer && d.customer.lat != null ? { lat: d.customer.lat, lng: d.customer.lng } : null);
    app.innerHTML = `<div class="mapscr"><div class="mapbox"><div id="mp"></div>
      <div class="hudt"><button class="fab" data-back aria-label="Back">${ic('back')}</button><div class="hud" id="hud"></div></div><div class="gps" id="gpsw"></div>
      <div class="fabs"><button class="fab" id="rc" aria-label="Recenter">${ic('target')}</button>${dest() ? `<a class="fab o" id="gm" href="${esc(Lv.navUrl(dest().lat, dest().lng))}" target="_blank" rel="noopener" aria-label="Google Maps">${ic('nav')}</a>` : ''}</div></div>
      <div class="dock" id="dock"></div></div>`;
    bindBack(); const m = Lv.map($('#mp'), { theme: 'dark', center: S.pos ? [S.pos.lat, S.pos.lng] : undefined, zoom: 15 });
    if (!S.online && !onRoad()) { /* still show the rider's own dot */ S.cleanup.push(Lv.geo.watch((p) => { S.pos = p; S.posErr = null; draw(); }, (e) => { S.posErr = e; draw(); })); }
    if (m) S.cleanup.push(() => m.destroy());
    let routed = 0;
    async function draw() {
      if (!m) return; const dp = dest(), me = S.pos, o = d && d.pickup && d.pickup.lat != null ? { lat: d.pickup.lat, lng: d.pickup.lng } : null;
      if (me) m.put('me', 'rider', me, { label: 'You' }); if (dp) m.put('dest', 'dest', dp, { label: first(d.customer.name) }); if (o && d.stage !== 'ON_THE_WAY') m.put('origin', 'origin', o);
      const from = me || o; if (from && dp && Date.now() - routed > 20000) { routed = Date.now(); const pts = await osrm(from, dp); m.route(pts || [from, dp], { dashed: !pts }); }
      if (!m._fitted && (me || dp)) { m._fitted = true; m.fit([me, dp].filter(Boolean), 80, true); }
      hud(); gps();
    }
    function hud() {
      const dp = dest(); const dm = S.pos && dp ? Lv.haversine(S.pos, dp) : d && d.tracking ? d.tracking.distanceM : null; const eta = d && d.tracking && d.tracking.etaMinutes != null && !(S.pos && dp) ? d.tracking.etaMinutes : dm != null ? Math.max(0, Math.round(dm / 1000 / 20 * 60)) : null;
      const h = $('#hud'); if (!h) return; if (!d) { h.innerHTML = '<small>No active delivery</small><b>Pick a delivery</b>'; return; }
      h.innerHTML = d.stage === 'ARRIVED' ? '<small>You have arrived</small><b>Collect payment &amp; hand over</b>' : `<small>Arriving in</small><b>${eta == null ? '--' : Lv.eta(eta)} ${dm != null ? `<em>(${Lv.dist(dm)})</em>` : ''}</b>`;
      if (dm != null && dm < 60 && d.stage === 'ON_THE_WAY' && !S.nearBuzz) { S.nearBuzz = d.orderId; Lv.beep('alert'); Lv.toast('You are at the customer. Tap "Arrived".', 'ok', 4000); }
    }
    function gps() { const g = $('#gpsw'); if (!g) return; g.innerHTML = S.posErr && S.posErr.code ? `<div class="note bad" style="margin:0">${ic('alert')}<div>${esc(Lv.geo.message(S.posErr))}</div></div>` : !S.pos ? `<div class="note" style="margin:0">${ic('target')}<div>Finding your location...</div></div>` : ''; }
    function dock() {
      const k = $('#dock'); if (!k) return; if (!d) { k.innerHTML = `<div class="grab"></div><div class="center" style="padding:6px 0 4px"><b>No active delivery</b><div class="fine">Open a delivery and tap Start Navigation.</div></div><div class="sp8"></div><button class="btn" id="gl">View deliveries</button>`; $('#gl').onclick = () => go('#/list'); return; }
      const can = d.can || {}; const b = [];
      if (d.stage === 'ON_THE_WAY' && can.arrived) b.push(['arrived', 'Arrived at location', '']);
      if (can.pay) b.push(['pay', 'Collect payment ' + (d.payment ? money(d.payment.amountDue) : ''), d.stage === 'ARRIVED' ? '' : 'ghost']);
      if (can.complete && ['ON_THE_WAY', 'ARRIVED'].includes(d.stage)) b.push(['complete', 'Complete delivery', can.pay ? 'ghost' : 'green']);
      if (['ASSIGNED', 'PICKED_UP'].includes(d.stage) && can.start) b.unshift(['start', 'Start Navigation', '']);
      k.innerHTML = `<div class="grab"></div><div class="row"><div class="grow"><div class="b">#${esc(d.orderNumber)} ${tag(d.stage, d.label)}</div><div class="fine">${money(d.total)} · ${esc(d.customer.name || '')}</div></div>${d.customer.phone ? `<a class="callb" href="${Lv.phoneHref(d.customer.phone)}">${ic('phone')}</a>` : ''}<button class="callb" style="background:var(--ol);color:var(--o)" id="dt" aria-label="Details">${ic('list')}</button></div><div class="sp8"></div>${b.map(([a, l, c]) => `<button class="btn ${c}" data-act="${a}" style="margin-top:8px">${l}</button>`).join('')}`;
      $$('[data-act]', k).forEach((x) => x.onclick = () => act(id, x.dataset.act, x)); $('#dt').onclick = () => go('#/d/' + id);
    }
    dock(); draw(); $('#rc').onclick = () => { if (m) { m.follow(); m.fit([S.pos, dest()].filter(Boolean), 80, true); } };
    S.onPos = () => draw(); S.onDest = () => draw(); S.onPing = () => { hud(); };
    const t = setInterval(async () => { try { const n = await loadDetail(id); d = n; dock(); draw(); } catch (e) { /* keep last */ } }, 15000); S.cleanup.push(() => clearInterval(t));
  }

  /* ---- payment ---- */
  async function vPay(id, my) {
    S.payId = id; app.innerHTML = top('Payment') + `<div class="pad" style="margin-top:14px"><div class="sk" style="height:200px"></div></div>`; bindBack();
    const s = await A.get(`/rider/deliveries/${id}/payment`); if (my !== S.seq) return;
    const col = s.collection || {}; const cur = s.currency;
    if (s.state === 'AWAITING_MPESA') return payWait(id, s, my);
    if (s.state === 'PAID' || s.state === 'CASH_HELD') return payDone(id, s);
    let method = (s.options || []).find((o) => o.enabled) ? s.options.find((o) => o.enabled).method : null;
    const paint = () => {
      const sel = (s.options || []).find((o) => o.method === method);
      app.innerHTML = top('Payment') + `<div class="hd"><div class="fine">Order #${esc(s.orderNumber)}</div><div class="amt">${money(s.amountDue, cur)}</div><div class="fine">${esc(s.customer.name || '')} · ${esc(s.message || '')}</div></div><div class="view nonav"><div class="pad"><div class="sec-h" style="margin:18px 0 10px"><h3>Payment method</h3></div>
        ${(s.options || []).map((o) => `<button class="pm ${o.method === method ? 'on' : ''} ${o.enabled ? '' : 'dis'}" data-m="${o.method}" ${o.enabled ? '' : 'disabled'}><span class="ico ${o.method === 'MPESA' ? 'g' : 'y'}">${ic(o.method === 'MPESA' ? 'mpesa' : 'cash')}</span><span class="grow"><b>${esc(o.label)}</b><small>${esc(o.enabled ? o.hint : o.disabledReason || '')}</small></span><span class="rad"></span></button>`).join('')}
        ${method === 'MPESA' ? `<div class="card"><label class="lbl">Customer's M-PESA number</label><input class="field" id="ph" inputmode="tel" value="${esc((s.customer.mpesaPhone || s.customer.phone || '').replace(/^\+/, '+'))}" placeholder="0712 345 678"><div class="fine" style="margin-top:6px">The customer gets a prompt on their phone to enter their M-PESA PIN.</div></div>` : ''}
        ${method === 'CASH' ? `<div class="card"><label class="lbl">Cash received from the customer</label><input class="field" id="tn" inputmode="decimal" type="number" min="0" step="any" value="${s.amountDue}"><div class="fine" id="chg" style="margin-top:6px">Exact amount. No change to give.</div></div>` : ''}
        </div></div><div class="cta"><button class="btn" id="cf" ${method ? '' : 'disabled'}>${method === 'MPESA' ? 'Send M-PESA request' : method === 'CASH' ? 'Confirm cash received' : 'Choose a method'}</button><button class="btn ghost" data-back>Back</button></div>`;
      bindBack(); $$('[data-m]').forEach((b) => b.onclick = () => { method = b.dataset.m; paint(); });
      const tn = $('#tn'); if (tn) tn.oninput = () => { const v = Number(tn.value || 0), ch = v - s.amountDue; $('#chg').textContent = ch > 0 ? 'Give back change: ' + money(ch, cur) : ch < 0 ? 'Less than the amount due.' : 'Exact amount. No change to give.'; };
      const cf = $('#cf'); if (cf) cf.onclick = async () => {
        busy(cf, true, 'Please wait...');
        try {
          if (method === 'MPESA') { const ph = $('#ph').value.trim(); if (ph.length < 9) { busy(cf, false); return Lv.toast('Enter a valid Safaricom number', 'warn'); } await A.post(`/rider/deliveries/${id}/payment/mpesa`, { phone: ph }); Lv.toast('M-PESA request sent', 'ok'); render(); }
          else { const v = Number($('#tn').value); if (!(v >= s.amountDue)) { busy(cf, false); return Lv.toast('The customer gave less than ' + money(s.amountDue, cur), 'warn'); } await A.post(`/rider/deliveries/${id}/payment/cash`, { tendered: v }); Lv.beep(); render(); }
        } catch (e) { busy(cf, false); err(e); if (['ALREADY_PAID', 'ALREADY_COLLECTED', 'MPESA_IN_PROGRESS'].includes(e.code)) render(); }
      };
    };
    paint();
  }
  async function payWait(id, s, my) {
    const ref = s.collection && s.collection.reference; let n = 0;
    app.innerHTML = top('Payment', { back: true }) + `<div class="view nonav"><div class="pad center" style="padding-top:60px"><div class="spin"></div><h2>Waiting for the customer</h2><p class="muted" style="margin:8px 0 6px">${money(s.amountDue, s.currency)} requested from <b>${esc(s.customer.mpesaPhone || s.customer.phone || 'the customer')}</b></p><p class="fine">Ask them to check their phone and enter their M-PESA PIN.</p><div class="sp"></div><div id="pw" class="note info" style="text-align:left">${ic('clock')}<div>Checking payment...</div></div></div></div><div class="cta"><button class="btn ghost" id="rf">Check now</button></div>`; bindBack();
    const check = async () => {
      if (S.view !== 'pay' || my !== S.seq) return; n++;
      try { const r = await A.get('/rider/payments/mpesa/' + encodeURIComponent(ref)); if (r.status === 'SUCCESS') { Lv.beep(); return render(); } if (r.status === 'FAILED' || r.status === 'CANCELLED') { Lv.toast(r.message || 'The customer did not complete the payment.', 'error', 5000); return render(); } const el = $('#pw'); if (el) el.lastElementChild.textContent = r.message || 'Waiting for the customer to enter their PIN...'; } catch (e) { /* keep polling */ }
      if (n > 40) { render(); }
    };
    const t = setInterval(check, 3000); S.cleanup.push(() => clearInterval(t)); $('#rf').onclick = check; check();
  }
  async function payDone(id, s) {
    const col = s.collection || {}; const cash = s.state === 'CASH_HELD' || col.method === 'CASH'; let d = null; try { d = S.detail && String(S.detail.orderId) === String(id) ? await loadDetail(id) : await loadDetail(id); } catch (e) { /* ok */ }
    const live = d && ['ON_THE_WAY', 'ARRIVED'].includes(d.stage); const change = col.change || 0;
    app.innerHTML = top('Payment', { back: false }) + `<div class="view nonav"><div class="pad center" style="padding-top:34px"><div class="bigok">${ic('check')}</div><h2>Payment Confirmed!</h2><p class="muted">Order #${esc(s.orderNumber)}</p><div class="amt" style="margin:8px 0">${money(col.amount || s.amountDue || (d && d.total), s.currency)}</div>
      <div class="card" style="text-align:left"><div class="kv"><span>Method</span><span class="b">${s.orderPayment === 'PREPAID' ? 'Paid online' : cash ? 'Cash (Collected)' : 'M-PESA'}</span></div>${col.receipt ? `<div class="kv"><span>M-PESA receipt</span><span class="b">${esc(col.receipt)}</span></div>` : ''}${cash && col.tendered ? `<div class="kv"><span>Received</span><span>${money(col.tendered, s.currency)}</span></div>` : ''}${change > 0 ? `<div class="kv"><span>Change to give</span><span class="b" style="color:var(--o)">${money(change, s.currency)}</span></div>` : ''}</div>
      ${cash ? `<div class="note">${ic('wallet')}<div>Keep the cash safe and hand it to the cashier at the restaurant. The cashier has been notified.</div></div>` : ''}</div></div>
      <div class="cta">${live && d.can && d.can.complete ? `<button class="btn green" id="cd">${ic('check')} Complete delivery</button>` : `<button class="btn" id="hm">Back to deliveries</button>`}${d && d.customer && d.customer.phone && live ? `<a class="btn ghost" href="${Lv.phoneHref(d.customer.phone)}">${ic('phone')} Call Customer</a>` : ''}</div>`;
    const cd = $('#cd'); if (cd) cd.onclick = () => act(id, 'complete', cd); const hm = $('#hm'); if (hm) hm.onclick = () => go('#/home');
  }
  function delivered(id, d) {
    S.nearBuzz = null; const held = S.dash && S.dash.cashHeld > 0;
    confetti(); Lv.beep();
    app.innerHTML = `<div class="done-hero"><div class="rd2">${ic('bike')}</div><h2>Delivered!</h2><p class="muted" style="margin:6px 0 20px">Order #${esc(d.orderNumber)} is complete. Great job.</p>${held ? `<div class="note" style="text-align:left">${ic('wallet')}<div>You are holding <b>${money(S.dash.cashHeld)}</b> in cash. Head back to the restaurant and hand it to the cashier.</div></div><button class="btn" id="rt">${ic('store')} Proceed to Restaurant</button><div class="sp8"></div>` : ''}<button class="btn ${held ? 'ghost' : ''}" id="hm">Back to home</button></div>`;
    $('#hm').onclick = () => go('#/home'); const rt = $('#rt'); if (rt) rt.onclick = async () => { busy(rt, true); try { await A.post('/rider/cash/returning'); Lv.toast('The cashier has been told you are coming.', 'ok'); go('#/wallet'); } catch (e) { busy(rt, false); err(e); } };
  }
  function confetti() { const c = document.createElement('div'); c.className = 'conf'; const cols = ['#F26A21', '#1F9D55', '#3B82F6', '#F5A623', '#D92D20']; c.innerHTML = Array.from({ length: 44 }, () => `<i style="left:${Math.random() * 100}%;background:${cols[(Math.random() * cols.length) | 0]};animation-duration:${1.6 + Math.random() * 1.6}s;animation-delay:${Math.random() * .5}s"></i>`).join(''); document.body.appendChild(c); setTimeout(() => c.remove(), 4000); }

  /* ---- wallet / earnings / profile ---- */
  async function vWallet() {
    app.innerHTML = top('Wallet') + `<div class="pad" style="margin-top:14px"><div class="sk" style="height:140px"></div></div>`; bindBack(); const w = await A.get('/rider/wallet');
    app.innerHTML = top('Wallet') + `<div class="view nonav"><div class="hd center"><div class="fine">Cash you are holding</div><div class="amt">${money(w.cashHeld)}</div><div class="fine">${w.count} payment${w.count === 1 ? '' : 's'} to hand over${w.oldestAt ? ' · oldest ' + Lv.ago(w.oldestAt) : ''}</div></div><div class="pad">
      <div class="stats" style="margin:14px 0 0;padding:0"><div class="stat"><b style="font-size:18px">${money(w.last24h.cash)}</b><span>Cash · 24h</span></div><div class="stat"><b style="font-size:18px">${money(w.last24h.mpesa)}</b><span>M-PESA · 24h</span></div><div class="stat"><b>${w.last24h.count}</b><span>Payments</span></div></div>
      ${w.count ? `<div class="sec-h" style="margin:20px 0 8px"><h3>To hand to the cashier</h3></div><div class="card">${w.collections.map((c) => `<div class="kv"><span>#${esc(c.orderNumber)} · ${esc(c.customerName || '')}${c.returningAt ? ' ' + tag('ARRIVED', 'On the way back') : ''}</span><span class="b">${money(c.amount)}</span></div>`).join('')}</div>` : `<div class="empty"><div class="em">${ic('wallet')}</div><b>No cash on you</b>Cash you collect shows here until the cashier receives it.</div>`}
      ${w.handovers.length ? `<div class="sec-h" style="margin:20px 0 8px"><h3>Recent handovers</h3></div><div class="card">${w.handovers.map((h) => `<div class="kv"><span>${Lv.clock(h.at)} · ${esc(h.cashier || 'Cashier')}<br><span class="fine">${esc((h.orders || []).map((o) => '#' + o).join(' '))}</span></span><span style="text-align:right"><span class="b">${money(h.received)}</span>${h.variance ? `<br><span class="fine" style="color:var(--bad)">Short ${money(Math.abs(h.variance))}</span>` : ''}</span></div>`).join('')}</div>` : ''}</div></div>${w.count ? `<div class="cta"><button class="btn" id="rb">${ic('store')} I am returning to the restaurant</button></div>` : ''}`;
    bindBack(); const rb = $('#rb'); if (rb) rb.onclick = async () => { busy(rb, true); try { await A.post('/rider/cash/returning'); Lv.toast('The cashier has been told you are coming.', 'ok'); render(); } catch (e) { busy(rb, false); err(e); } };
  }
  async function vEarnings() {
    const per = kv.get('per') || 'today'; app.innerHTML = top('Earnings') + `<div class="pad" style="margin-top:14px"><div class="sk" style="height:140px"></div></div>`; bindBack(); const e = await A.get('/rider/earnings', { period: per });
    app.innerHTML = top('Earnings') + `<div class="view nonav"><div class="tabs">${['today', 'week', 'month'].map((p) => `<button data-p="${p}" class="${p === per ? 'on' : ''}">${p === 'today' ? 'Today' : p === 'week' ? '7 days' : '30 days'}</button>`).join('')}</div><div class="hd center" style="margin-top:12px"><div class="fine">${e.mode === 'NONE' ? 'Delivery fees collected' : 'You earned'}</div><div class="amt">${money(e.mode === 'NONE' ? e.deliveryFees : e.earned)}</div><div class="fine">${e.deliveries} deliver${e.deliveries === 1 ? 'y' : 'ies'}</div></div><div class="pad">${e.lines.length ? `<div class="card" style="margin-top:14px">${e.lines.map((l) => `<div class="kv"><span>#${esc(l.orderNumber)}<br><span class="fine">${Lv.clock(l.at)}${l.distanceKm != null ? ' · ' + Lv.km(l.distanceKm) : ''}${l.rating ? ' · ' + l.rating + '★' : ''}</span></span><span class="b">${money(e.mode === 'NONE' ? l.deliveryFee : l.earned)}</span></div>`).join('')}</div>` : `<div class="empty"><div class="em">${ic('cash')}</div><b>No deliveries yet</b>Completed deliveries show up here.</div>`}</div></div>`;
    bindBack(); $$('[data-p]').forEach((b) => b.onclick = () => { kv.set('per', b.dataset.p); render(); });
  }
  async function vProfile() {
    app.innerHTML = `<div class="prof"><div class="sk" style="height:110px;opacity:.15"></div></div>` + navHtml('profile'); bindNav();
    const m = await A.get('/rider/me');
    app.innerHTML = `<div class="view"><div class="prof"><div class="pa">${esc(first(m.name).charAt(0).toUpperCase())}</div><h2>${esc(m.name)}</h2><div class="fine" style="color:#aab2ba">Rider${m.employeeCode ? ' · ' + esc(m.employeeCode) : ''}${m.rating && m.rating.average ? ' · ' + m.rating.average + '★ (' + m.rating.count + ')' : ''}</div>${m.branches && m.branches.length ? `<div class="fine" style="color:#aab2ba;margin-top:4px">${esc(m.branches.map((b) => b.name).join(', '))}</div>` : ''}</div>
      <div class="menu">${[['box', 'My Deliveries', "go('list')"], ['cash', 'Earnings', "go('earnings')"], ['wallet', 'Wallet' + (m.cashHeld ? ' · ' + money(m.cashHeld) : ''), "go('wallet')"], ['gear', 'Settings', 'set'], ['help', 'Help & Support', 'help'], ['out', 'Log Out', 'out']].map(([i, l, a]) => `<button data-a="${a}"><span class="mi">${ic(i)}</span><span class="grow">${esc(l)}</span><span class="ch">${ic('chev')}</span></button>`).join('')}</div>
      <p class="fine center">${esc(S.biz && S.biz.name || '')} · Six Star POS Rider</p></div>` + navHtml('profile'); bindNav();
    $$('[data-a]').forEach((b) => b.onclick = () => { const a = b.dataset.a; if (a.startsWith('go(')) go('#/' + a.slice(4, -2)); else if (a === 'set') settings(); else if (a === 'help') help(m); else logout(); });
  }
  function settings() {
    const ps = Lv.pushState(); const s = Lv.sheet(`<h3>Settings</h3><div class="sp8"></div>
      <label class="pm" style="cursor:pointer"><span class="grow"><b>Sound &amp; vibration</b><small>For new deliveries and alerts</small></span><input type="checkbox" id="sd" ${S.sound ? 'checked' : ''} style="width:22px;height:22px"></label>
      <button class="pm" id="pn"><span class="grow"><b>Lock-screen alerts</b><small>${ps === 'granted' ? 'Allowed on this phone. Tap to refresh.' : ps === 'denied' ? 'Blocked in browser settings' : 'Get new deliveries even when the app is closed'}</small></span>${ic('bell')}</button>
      <button class="pm" id="ls"><span class="grow"><b>Keep screen awake</b><small>Stops the phone sleeping while you ride</small></span>${ic('eye')}</button>
      <div class="note info">${ic('alert')}<div>Your location is shared only while you are <b>online</b>. Keep this app open while riding for the best tracking.</div></div><button class="btn ghost" id="cl">Close</button>`);
    $('#cl', s.el).onclick = s.close; $('#sd', s.el).onchange = (e) => { S.sound = e.target.checked; kv.set('sound', S.sound ? '1' : '0'); };
    $('#ls', s.el).onclick = () => { Lv.wake.want = true; Lv.wake.on(); Lv.toast('Screen will stay on', 'ok'); };
    $('#pn', s.el).onclick = async () => { try { await Lv.enablePush(() => A.get('/rider/push/key'), (sub) => A.post('/rider/push/subscribe', sub)); Lv.toast('Lock-screen alerts are on', 'ok'); s.close(); } catch (e) { err(e); } };
  }
  function notifSheet() { const s = Lv.sheet(`<h3>Alerts</h3><p class="muted" style="margin:6px 0 14px">New assignments, payments and arrival reminders appear here as pop-ups while the app is open.</p><button class="btn" id="en">Turn on lock-screen alerts</button><div class="sp8"></div><button class="btn ghost" id="cl">Close</button>`); $('#cl', s.el).onclick = s.close; $('#en', s.el).onclick = async () => { try { await Lv.enablePush(() => A.get('/rider/push/key'), (sub) => A.post('/rider/push/subscribe', sub)); Lv.toast('Lock-screen alerts are on', 'ok'); s.close(); } catch (e) { err(e); } }; }
  function help() { const s = Lv.sheet(`<h3>Help &amp; Support</h3><div class="card" style="margin:12px 0"><div class="kv"><span>Can't see deliveries?</span><span>Go online &amp; ask the manager to assign one</span></div><div class="kv"><span>Customer not on the map?</span><span>Use the address &amp; call them</span></div><div class="kv"><span>Payment stuck?</span><span>Tap "Check now" or take cash</span></div></div><button class="btn ghost" id="cl">Close</button>`); $('#cl', s.el).onclick = s.close; }
  function logout() {
    const s = Lv.sheet(`<h3>Log out?</h3><p class="muted" style="margin:6px 0 16px">You will go offline and stop sharing your location.${S.dash && S.dash.cashHeld > 0 ? ' <b>You still hold ' + money(S.dash.cashHeld) + ' in cash.</b>' : ''}</p><button class="btn red" id="ok" style="background:var(--bad);color:#fff">Log out</button><div class="sp8"></div><button class="btn ghost" id="no">Stay signed in</button>`);
    $('#no', s.el).onclick = s.close; $('#ok', s.el).onclick = async () => { try { await A.post('/rider/online', { online: false }); } catch (e) { /* ignore */ } stopTracker(); if (stream) { stream.close(); stream = null; } A.clear(); kv.set('user', null); kv.set('want', '0'); S.user = null; S.online = false; S.dash = null; s.close(); go('#/login'); };
  }

  // beep respects the sound setting
  const _beep = Lv.beep; Lv.beep = (k) => { if (S.sound) _beep(k); };

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  if (!location.hash) location.hash = A.has() && S.user ? '#/home' : '#/login'; else render();
  window.RiderApp = S;
})();