/**
 * live-kit.js - shared toolkit for the rider app, the customer tracking page and the staff live board.
 * Window.Live = { esc, money, dist, eta, ago, ic, toast, client, sse, geo, wake, beep, map, haversine, bearing, battery }
 * No dependency on the POS shell, so rider.html and track.html stay light (they load only this + Leaflet).
 */
(function (window) {
  const API = (window.APP_CONFIG && window.APP_CONFIG.API_BASE_URL) || 'https://posbackend-5jaq.onrender.com/api/v1';
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  /* ---------- formatting ---------- */
  let CUR = 'KES';
  const setCurrency = (c) => { if (c) CUR = c; };
  const money = (n, cur = CUR) => {
    const v = Number(n || 0);
    try { return new Intl.NumberFormat(cur === 'TZS' ? 'en-TZ' : 'en-KE', { style: 'currency', currency: cur, currencyDisplay: 'code', minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(v).replace(/\u00a0/g, ' '); }
    catch (e) { return cur + ' ' + v.toLocaleString(); }
  };
  const dist = (m) => (m == null ? '--' : m < 1000 ? Math.round(m / 10) * 10 + ' m' : (m / 1000).toFixed(1) + ' km');
  const km = (k) => (k == null ? '--' : Number(k).toFixed(1) + ' km');
  const eta = (min) => (min == null ? '--' : min <= 0 ? '< 1 min' : min + ' min');
  const clock = (d) => { if (!d) return ''; const x = new Date(d); return isNaN(x) ? '' : x.toLocaleTimeString('en-KE', { hour: 'numeric', minute: '2-digit' }); };
  const ago = (d) => {
    if (!d) return ''; const s = Math.max(0, Math.round((Date.now() - new Date(d).getTime()) / 1000));
    if (s < 45) return 'just now'; if (s < 3600) return Math.round(s / 60) + ' min ago'; if (s < 86400) return Math.round(s / 3600) + ' h ago'; return Math.round(s / 86400) + ' d ago';
  };
  const phoneHref = (p) => 'tel:' + String(p || '').replace(/[^\d+]/g, '');

  /* ---------- geometry ---------- */
  const rad = (x) => (x * Math.PI) / 180;
  function haversine(a, b) {
    if (!a || !b) return null; const R = 6371000;
    const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  function bearing(a, b) {
    const y = Math.sin(rad(b.lng - a.lng)) * Math.cos(rad(b.lat));
    const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lng - a.lng));
    return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
  }

  /* ---------- icons (inline, no network) ---------- */
  const P = {
    home: '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>',
    list: '<path d="M8 6h12M8 12h12M8 18h12"/><path d="M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>',
    box: '<path d="M21 8l-9-5-9 5 9 5 9-5z"/><path d="M3 8v8l9 5 9-5V8"/><path d="M12 13v8"/>',
    map: '<path d="M9 4L3 6v14l6-2 6 2 6-2V4l-6 2-6-2z"/><path d="M9 4v14M15 6v14"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>',
    back: '<path d="M15 5l-7 7 7 7"/>',
    chev: '<path d="M9 5l7 7-7 7"/>',
    phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/>',
    pin: '<path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
    nav: '<path d="M3 11l18-8-8 18-2-8-8-2z"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    cash: '<rect x="2.5" y="6" width="19" height="12" rx="2"/><circle cx="12" cy="12" r="2.8"/><path d="M6 9v.01M18 15v.01"/>',
    mpesa: '<rect x="6" y="2.5" width="12" height="19" rx="2.5"/><path d="M10 18.5h4"/><path d="M9 8h6M9 11.5h6"/>',
    wallet: '<path d="M4 7a2 2 0 0 1 2-2h12v4"/><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M16 13.5h2"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7"/><path d="M12 17v.01"/>',
    out: '<path d="M9 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h4"/><path d="M16 8l4 4-4 4M20 12H9"/>',
    star: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9L12 3z"/>',
    bell: '<path d="M6 17V11a6 6 0 0 1 12 0v6l1.5 2h-15L6 17z"/><path d="M10 21h4"/>',
    bike: '<circle cx="6" cy="17" r="3.5"/><circle cx="18" cy="17" r="3.5"/><path d="M6 17l4-8h5l3 8"/><path d="M10 9L8 6H6"/>',
    shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z"/><path d="M9 12l2 2 4-4"/>',
    alert: '<path d="M12 3l10 18H2L12 3z"/><path d="M12 10v5M12 18v.01"/>',
    refresh: '<path d="M20 11a8 8 0 0 0-14-4L4 9"/><path d="M4 4v5h5"/><path d="M4 13a8 8 0 0 0 14 4l2-2"/><path d="M20 20v-5h-5"/>',
    target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
    receipt: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3z"/><path d="M9 8h6M9 12h6"/>',
    store: '<path d="M4 9l1.5-5h13L20 9"/><path d="M4 9a3 3 0 0 0 5.3 2 3 3 0 0 0 5.4 0A3 3 0 0 0 20 9"/><path d="M5 12v8h14v-8"/>',
    eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    qr: '<path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4z"/><path d="M14 14h3v3M20 14v.01M14 20h.01M17 20h3v-3"/>',
    lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
    wifi: '<path d="M2 9a15 15 0 0 1 20 0M5.5 12.5a10 10 0 0 1 13 0M9 16a5 5 0 0 1 6 0"/><path d="M12 19.5v.01"/>',
  };
  const ic = (n, cls = '') => `<svg class="i ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[n] || ''}</svg>`;

  /* ---------- toast ---------- */
  function toast(msg, kind = 'info', ms = 3200) {
    let box = $('#lv-toasts'); if (!box) { box = document.createElement('div'); box.id = 'lv-toasts'; document.body.appendChild(box); }
    const t = document.createElement('div'); t.className = 'lv-toast ' + kind; t.setAttribute('role', 'status');
    t.innerHTML = `<span>${esc(msg)}</span>`; box.appendChild(t);
    requestAnimationFrame(() => t.classList.add('in'));
    setTimeout(() => { t.classList.remove('in'); setTimeout(() => t.remove(), 250); }, ms);
  }

  /* ---------- HTTP client with its own session (so it never clashes with the POS staff login) ---------- */
  class ApiErr extends Error { constructor(m, o = {}) { super(m); this.code = o.code; this.status = o.status; this.data = o.data; } }
  function client({ ns, base = API, onAuthLost }) {
    const K = { a: ns + '.access', r: ns + '.refresh' };
    const store = { get: (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) { /* blocked */ } } };
    let refreshing = null;
    const timed = async (url, opt, ms = 25000) => {
      const c = new AbortController(); const t = setTimeout(() => c.abort(), ms);
      try { return await fetch(url, { ...opt, signal: c.signal }); }
      catch (e) { throw new ApiErr(e.name === 'AbortError' ? 'The connection is slow. Please try again.' : 'No internet connection.', { code: 'NETWORK' }); }
      finally { clearTimeout(t); }
    };
    async function refresh() {
      const rt = store.get(K.r); if (!rt) throw new ApiErr('Signed out', { code: 'NO_REFRESH', status: 401 });
      const res = await timed(base + '/auth/refresh', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refreshToken: rt }) }, 15000);
      const b = await res.json().catch(() => ({}));
      if (!res.ok || !b.success) throw new ApiErr(b.message || 'Session expired', { code: b.code, status: res.status });
      store.set(K.a, b.data.accessToken); if (b.data.refreshToken) store.set(K.r, b.data.refreshToken);
      return b.data.accessToken;
    }
    async function call(method, path, body, query, retry) {
      const qs = query ? '?' + new URLSearchParams(Object.fromEntries(Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== ''))).toString() : '';
      const headers = { 'Content-Type': 'application/json' }; const tk = store.get(K.a); if (tk) headers.Authorization = 'Bearer ' + tk;
      const res = await timed(base + path + qs, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
      if (res.status === 401 && !retry && store.get(K.r) && !path.startsWith('/public/')) {
        try { if (!refreshing) refreshing = refresh().finally(() => { refreshing = null; }); await refreshing; return call(method, path, body, query, true); }
        catch (e) { if (e.status === 401 || e.status === 403) { clear(); onAuthLost && onAuthLost(); } throw e; }
      }
      const j = await res.json().catch(() => ({}));
      if (!res.ok || j.success === false) {
        if (res.status === 401 && !path.startsWith('/public/')) { clear(); onAuthLost && onAuthLost(); }
        throw new ApiErr(j.message || `Request failed (${res.status})`, { code: j.code, status: res.status, data: j.data });
      }
      return j.data;
    }
    const clear = () => { store.set(K.a, null); store.set(K.r, null); };
    return {
      get: (p, q) => call('GET', p, undefined, q), post: (p, b) => call('POST', p, b || {}),
      setSession: (a, r) => { store.set(K.a, a); store.set(K.r, r); }, clear,
      has: () => !!(store.get(K.a) || store.get(K.r)), token: () => store.get(K.a), base,
      kv: { get: (k) => store.get(ns + '.' + k), set: (k, v) => store.set(ns + '.' + k, v) },
    };
  }

  /* ---------- Server-Sent Events with automatic reconnect + polling safety net ---------- */
  function sse({ open, events = [], on, state, poll, pollMs = 8000 }) {
    let es = null, stopped = false, retry = 0, timer = null, pollT = null, live = false;
    const set = (s) => { live = s === 'live'; state && state(s); };
    async function connect() {
      if (stopped) return;
      try {
        const url = await open(); if (stopped) return;
        es = new EventSource(url);
        es.onopen = () => { retry = 0; set('live'); };
        events.forEach((n) => es.addEventListener(n, (ev) => { let d = null; try { d = JSON.parse(ev.data); } catch (e) { return; } on(n, d); }));
        es.onerror = () => { set('down'); try { es.close(); } catch (e) { /* closed */ } es = null; schedule(); };
      } catch (e) { set('down'); schedule(); }
    }
    function schedule() { if (stopped) return; clearTimeout(timer); retry = Math.min(retry + 1, 6); timer = setTimeout(connect, Math.min(1500 * retry, 15000)); }
    if (poll) pollT = setInterval(() => { if (!document.hidden && !live) poll(); }, pollMs);
    const vis = () => { if (!document.hidden && !es && !stopped) { clearTimeout(timer); connect(); } };
    document.addEventListener('visibilitychange', vis);
    connect();
    return { close() { stopped = true; clearTimeout(timer); clearInterval(pollT); document.removeEventListener('visibilitychange', vis); try { es && es.close(); } catch (e) { /* closed */ } } };
  }

  /* ---------- geolocation / device ---------- */
  const geo = {
    supported: () => 'geolocation' in navigator,
    watch(ok, bad) {
      if (!geo.supported()) { bad && bad({ code: 0, message: 'Location is not supported on this device.' }); return () => {}; }
      const id = navigator.geolocation.watchPosition((p) => ok({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy, heading: p.coords.heading, speed: p.coords.speed, at: p.timestamp }), (e) => bad && bad(e), { enableHighAccuracy: true, maximumAge: 4000, timeout: 20000 });
      return () => navigator.geolocation.clearWatch(id);
    },
    once: () => new Promise((res, rej) => { if (!geo.supported()) return rej(new Error('no geo')); navigator.geolocation.getCurrentPosition((p) => res({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }), rej, { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 }); }),
    message: (e) => (e && e.code === 1 ? 'Location is blocked. Allow location for this site in your browser settings.' : e && e.code === 2 ? 'Your location is not available right now. Move to an open area.' : e && e.code === 3 ? 'Finding your location is taking long...' : 'Location is not available.'),
  };
  let wakeLock = null;
  const wake = {
    async on() { try { if ('wakeLock' in navigator) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); } } catch (e) { /* not allowed */ } },
    off() { try { wakeLock && wakeLock.release(); } catch (e) { /* released */ } wakeLock = null; },
  };
  document.addEventListener('visibilitychange', () => { if (!document.hidden && wake.want && !wakeLock) wake.on(); });
  const battery = async () => { try { if (navigator.getBattery) { const b = await navigator.getBattery(); return { level: Math.max(0, Math.min(1, b.level)), charging: !!b.charging }; } } catch (e) { /* unsupported */ } return undefined; };
  let actx = null;
  function beep(kind = 'ok') {
    try { navigator.vibrate && navigator.vibrate(kind === 'alert' ? [160, 80, 160, 80, 260] : [90]); } catch (e) { /* no vibration */ }
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)(); const o = actx.createOscillator(), g = actx.createGain();
      o.type = 'sine'; o.frequency.value = kind === 'alert' ? 880 : 660; g.gain.value = 0.06; o.connect(g); g.connect(actx.destination); o.start(); o.stop(actx.currentTime + (kind === 'alert' ? 0.35 : 0.15));
    } catch (e) { /* audio blocked until a tap */ }
  }

  /* ---------- Leaflet map wrapper ---------- */
  // Keyless OpenStreetMap tiles. CARTO's basemaps now return "API KEY REQUIRED" without a key.
  // To use a keyed provider later (MapTiler, Stadia, Geoapify...), set window.APP_CONFIG.MAP_TILE_URL
  // (and optionally MAP_TILE_ATTRIBUTION) in js/core/config.js, e.g. 'https://api.maptiler.com/maps/streets-v2/{z}/{x}/{y}.png?key=YOUR_KEY'.
  const CFG = () => window.APP_CONFIG || {};
  const TILE_URL = () => CFG().MAP_TILE_URL || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
  const TILE_ATTR = () => CFG().MAP_TILE_ATTRIBUTION || '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
  const mk = (cls, html) => window.L.divIcon({ className: 'lv-mk-wrap', html: `<div class="lv-mk ${cls}">${html}</div>`, iconSize: [44, 44], iconAnchor: [22, 22] });
  // Real delivery-motorbike marker (rider + helmet + orange delivery box), side view, flips to face the direction of travel.
  const BIKE_SVG = `<svg class="lv-bike" viewBox="0 0 64 48" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><ellipse cx="32" cy="45" rx="23" ry="2.4" fill="#000" opacity=".18"/><path d="M6 32Q14 23 23 30" fill="none" stroke="#334155" stroke-width="3.2" stroke-linecap="round"/><path d="M10 30L24 27H40L44 31L38 36H22Z" fill="#334155"/><path d="M38 27L43 20H46L44 30L40 33Z" fill="#475569"/><path d="M45 18.5L50 36" stroke="#475569" stroke-width="2.8" stroke-linecap="round"/><path d="M44 29Q50 24.5 56 30" fill="none" stroke="#334155" stroke-width="3.2" stroke-linecap="round"/><circle cx="14" cy="36" r="8" fill="#111827"/><circle cx="14" cy="36" r="4.6" fill="#CBD5E1"/><circle cx="14" cy="36" r="1.7" fill="#475569"/><circle cx="50" cy="36" r="8" fill="#111827"/><circle cx="50" cy="36" r="4.6" fill="#CBD5E1"/><circle cx="50" cy="36" r="1.7" fill="#475569"/><rect x="21" y="24.5" width="15" height="4" rx="2" fill="#111827"/><path d="M3 26.2H22" stroke="#111827" stroke-width="1.8" stroke-linecap="round"/><rect x="2" y="9" width="20" height="16" rx="2.6" fill="#F26A21"/><path d="M2 14.5H22" stroke="#C2410C" stroke-width="1.4"/><circle cx="12" cy="20" r="3.1" fill="#fff"/><path d="M12 18.2V21.8M10.2 20H13.8" stroke="#F26A21" stroke-width="1.3" stroke-linecap="round"/><path d="M28 25L37 29L36 35" fill="none" stroke="#1F2937" stroke-width="4.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M27 25L31 14.5" stroke="#F26A21" stroke-width="7.2" stroke-linecap="round"/><path d="M32 16.5L40 19.5L43.5 18" fill="none" stroke="#F26A21" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"/><circle cx="43.8" cy="18" r="2" fill="#111827"/><path d="M43 17.4L48 16.4" stroke="#111827" stroke-width="2.4" stroke-linecap="round"/><circle cx="47.6" cy="21.4" r="2.5" fill="#FDE047" stroke="#fff" stroke-width=".9"/><circle cx="33" cy="8.6" r="5.7" fill="#111827"/><path d="M33.6 6.8Q40 6.4 38.6 11.4L33.6 10.8Z" fill="#7DD3FC"/><path d="M29.4 6.6Q31 3.8 34 3.9" fill="none" stroke="#fff" stroke-width="1" stroke-linecap="round" opacity=".7"/></svg>`;
  const mkBike = () => window.L.divIcon({ className: 'lv-mk-wrap', html: `<div class="lv-mk rider"><span class="pulse"></span><span class="core">${BIKE_SVG}</span></div>`, iconSize: [64, 52], iconAnchor: [32, 44] });
  const ICONS = {
    rider: () => mkBike(),
    me: () => mk('me', '<span class="pulse"></span><span class="dot"></span>'),
    dest: () => window.L.divIcon({ className: 'lv-mk-wrap', html: '<div class="lv-pin dest"><svg viewBox="0 0 32 40"><path d="M16 39S3 26.5 3 15a13 13 0 0 1 26 0C29 26.5 16 39 16 39z" fill="currentColor"/><circle cx="16" cy="15" r="5.2" fill="#fff"/></svg></div>', iconSize: [32, 40], iconAnchor: [16, 39] }),
    origin: () => window.L.divIcon({ className: 'lv-mk-wrap', html: `<div class="lv-pin origin"><span>${ic('store')}</span></div>`, iconSize: [36, 36], iconAnchor: [18, 18] }),
  };
  function map(el, { theme = 'light', center = [-1.2921, 36.8219], zoom = 13, controls = false } = {}) {
    if (!window.L) { el.innerHTML = '<div class="lv-nomap">Map could not load. Check your internet connection.</div>'; return null; }
    const L = window.L; const m = L.map(el, { zoomControl: controls, attributionControl: true, tap: true }).setView(center, zoom);
    const LAYERS = {
      street: () => L.tileLayer(TILE_URL(), { maxZoom: 19, attribution: TILE_ATTR() }),
      dark: () => L.tileLayer(TILE_URL(), { maxZoom: 19, attribution: TILE_ATTR(), className: 'lv-tiles-dark' }),
      sat: () => L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: 'Tiles &copy; Esri' }),
    };
    let base = null, baseName = '';
    const setMode = (n) => { if (!LAYERS[n]) n = 'street'; if (n === baseName) return baseName; if (base) m.removeLayer(base); base = LAYERS[n]().addTo(m); base.bringToBack(); baseName = n; return n; };
    setMode(theme === 'dark' ? 'dark' : 'street');
    const markers = {}; let line = null, trail = null, user = false, casing = null, accC = null, progr = false, userCb = null;
    const prog = (ms) => { progr = true; setTimeout(() => { progr = false; }, ms); };
    m.on('dragstart', () => { user = true; userCb && userCb(); });
    m.on('zoomstart', () => { if (!progr) user = true; });
    setTimeout(() => m.invalidateSize(), 120);
    const api = {
      raw: m,
      /** move (animated) or create a marker. kind: rider|me|dest|origin */
      put(id, kind, pos, { label, heading } = {}) {
        if (!pos || pos.lat == null) { api.drop(id); return null; }
        const ll = [pos.lat, pos.lng]; let mm = markers[id];
        if (!mm) { mm = markers[id] = { m: L.marker(ll, { icon: ICONS[kind](), zIndexOffset: kind === 'rider' ? 1000 : kind === 'me' ? 900 : 0, keyboard: false }).addTo(m), kind, cur: ll }; }
        else { animate(mm, ll); }
        if (label) { mm.m.unbindTooltip(); mm.m.bindTooltip(label, { permanent: kind === 'rider', direction: 'top', offset: [0, kind === 'rider' ? -40 : -20], className: 'lv-tip' }); }
        if (kind === 'rider' && heading != null && !isNaN(heading)) { flip(mm, Math.sin(heading * Math.PI / 180) < 0 ? -1 : 1); }
        return mm.m;
      },
      drop(id) { if (markers[id]) { m.removeLayer(markers[id].m); delete markers[id]; } },
      clear(keep = []) { Object.keys(markers).forEach((k) => { if (!keep.includes(k)) api.drop(k); }); },
      route(points, { color = '#F26A21', dashed = false } = {}) {
        if (!points || points.length < 2) { if (line) { m.removeLayer(line); line = null; } if (casing) { m.removeLayer(casing); casing = null; } return; }
        const ll = points.map((p) => [p.lat, p.lng]);
        if (!casing) casing = L.polyline(ll, { color: '#fff', weight: 10, opacity: 0.95, lineCap: 'round', lineJoin: 'round', interactive: false }).addTo(m); else casing.setLatLngs(ll);
        if (!line) line = L.polyline(ll, { color, weight: 6, opacity: 1, lineCap: 'round', lineJoin: 'round', interactive: false }).addTo(m); else line.setLatLngs(ll);
        line.setStyle({ color, dashArray: dashed ? '2 10' : null }); casing.setStyle({ opacity: dashed ? 0 : 0.95 });
      },
      mode: setMode, modeName: () => baseName,
      onUser(fn) { userCb = fn; },
      /** smooth camera follow; offsetY shifts the rider below centre like Uber / Google navigation */
      cam(pos, zoom, dur = 0.9, offsetY = 0) {
        if (!pos) return; const z = zoom || m.getZoom(); let c = L.latLng(pos.lat, pos.lng);
        if (offsetY) { const pt = m.project(c, z); pt.y -= offsetY; c = m.unproject(pt, z); }
        prog(dur * 1000 + 200); m.setView(c, z, { animate: true, duration: dur, easeLinearity: 0.4, noMoveStart: true });
      },
      acc(pos, meters) {
        if (!pos || !meters || meters > 200) { if (accC) { m.removeLayer(accC); accC = null; } return; }
        if (!accC) accC = L.circle([pos.lat, pos.lng], { radius: meters, color: '#3B82F6', weight: 1, opacity: 0.35, fillColor: '#3B82F6', fillOpacity: 0.08, interactive: false }).addTo(m); else { accC.setLatLng([pos.lat, pos.lng]); accC.setRadius(meters); }
      },
      trail(points) {
        if (trail) { m.removeLayer(trail); trail = null; }
        if (points && points.length > 1) trail = L.polyline(points.map((p) => [p.lat, p.lng]), { color: '#3B82F6', weight: 4, opacity: 0.75 }).addTo(m);
      },
      fit(pts, pad = 60, force = false) {
        const v = (pts || []).filter((p) => p && p.lat != null); if (!v.length || (user && !force)) return;
        if (v.length === 1) { prog(900); return m.setView([v[0].lat, v[0].lng], Math.max(m.getZoom(), 16), { animate: true }); }
        prog(900); m.fitBounds(L.latLngBounds(v.map((p) => [p.lat, p.lng])), { padding: [pad, pad], maxZoom: 17, animate: true });
      },
      follow() { user = false; }, size() { setTimeout(() => m.invalidateSize(), 60); }, destroy() { try { m.remove(); } catch (e) { /* gone */ } },
      onClick(fn) { m.on('click', (e) => fn({ lat: e.latlng.lat, lng: e.latlng.lng })); },
    };
    function flip(mm, dir) { mm.dir = dir; const el = mm.m.getElement && mm.m.getElement(); const c = el && el.querySelector('.core'); if (c) c.style.setProperty('--flip', dir); }
    function animate(mm, to) {
      const from = mm.cur; if (!from || (from[0] === to[0] && from[1] === to[1])) return;
      if (mm.kind === 'rider' && Math.abs(to[1] - from[1]) > 1e-6) flip(mm, to[1] < from[1] ? -1 : 1); const t0 = performance.now(), dur = 1100;
      cancelAnimationFrame(mm.raf);
      const step = (t) => { const k = Math.min(1, (t - t0) / dur), e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2; mm.m.setLatLng([from[0] + (to[0] - from[0]) * e, from[1] + (to[1] - from[1]) * e]); if (k < 1) mm.raf = requestAnimationFrame(step); else mm.cur = to; };
      mm.cur = to; mm.raf = requestAnimationFrame(step);
    }
    return api;
  }

  /** open Google Maps directions in the rider's own maps app */
  const navUrl = (lat, lng) => `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`;

  /** Bottom sheet / modal used by all three apps. */
  function sheet(html, { onClose, cls = '' } = {}) {
    const bd = document.createElement('div'); bd.className = 'lv-sheet-bd';
    bd.innerHTML = `<div class="lv-sheet ${cls}" role="dialog" aria-modal="true"><div class="lv-grab"></div>${html}</div>`;
    document.body.appendChild(bd); requestAnimationFrame(() => bd.classList.add('in'));
    const close = () => { bd.classList.remove('in'); setTimeout(() => { bd.remove(); onClose && onClose(); }, 220); };
    bd.addEventListener('click', (e) => { if (e.target === bd) close(); });
    return { el: bd.firstElementChild, close };
  }


  /** Lock-screen alerts (Web Push). Needs the POS service worker (sw.js) and VAPID keys on the server. */
  const b64 = (k) => { const pad = '='.repeat((4 - (k.length % 4)) % 4); const raw = atob((k + pad).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from([...raw].map((c) => c.charCodeAt(0))); };
  async function enablePush(getKey, send) {
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) throw new Error('This browser cannot show lock-screen alerts. On iPhone, add the app to your Home Screen first.');
    const k = await getKey(); if (!k || !k.enabled || !k.publicKey) throw new Error('Lock-screen alerts are not switched on for this business yet.');
    const perm = await Notification.requestPermission(); if (perm !== 'granted') throw new Error('Notifications are blocked. Allow them in your browser settings.');
    const reg = await navigator.serviceWorker.register('/sw.js').then(() => navigator.serviceWorker.ready);
    let sub = await reg.pushManager.getSubscription(); if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(k.publicKey) });
    const j = sub.toJSON(); await send({ endpoint: j.endpoint, keys: { p256dh: j.keys.p256dh, auth: j.keys.auth } });
    return true;
  }
  const pushState = () => ('Notification' in window ? Notification.permission : 'unsupported');
  const notify = (title, body, tag) => { try { if ('Notification' in window && Notification.permission === 'granted' && document.hidden) new Notification(title, { body, tag, icon: '/icons/icon-192.png' }); } catch (e) { /* ignore */ } };

  window.Live = { enablePush, pushState, notify, API, esc, $, $$, money, setCurrency, dist, km, eta, clock, ago, phoneHref, haversine, bearing, ic, toast, client, ApiErr, sse, geo, wake, battery, beep, map, navUrl, sheet };
})(window);