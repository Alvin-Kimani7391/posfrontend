/**
 * tv-player.js - the page that runs ON the TV. Pairs once with a code, then shows the published menu forever:
 *  - keeps the last good menu on screen (and in storage) whenever the network or server fails: never blank, never flicker
 *  - live refresh over a server stream, with polling as the safety net; heartbeat so the POS knows the screen is alive
 *  - revoked / switched-off screens show a clear message instead of a broken page
 */
(function () {
  const API = (window.APP_CONFIG && window.APP_CONFIG.API_BASE_URL) || '';
  const LS = { token: 'tv.token', cache: 'tv.cache', etag: 'tv.etag' };
  const $ = (id) => document.getElementById(id);
  const store = { get: (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* storage full / blocked */ } }, del: (k) => { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } } };
  let token = store.get(LS.token); let ctrl = null; let content = null; let shown = 0; let es = null; let pollT = null; let beatT = null; let busy = false; let fails = 0; let lastErrAt = 0; let stopped = false; let oBusy = false; let oOk = Date.now();

  const status = (txt, ms = 4000) => { const s = $('stat'); s.textContent = txt; s.classList.add('on'); clearTimeout(status.t); if (ms) status.t = setTimeout(() => s.classList.remove('on'), ms); };
  const panel = (id) => { ['pair', 'blocked'].forEach((p) => $(p).classList.toggle('on', p === id)); $('tv').style.visibility = id ? 'hidden' : 'visible'; };

  async function call(path, { method = 'GET', body, query } = {}) {
    const url = new URL(API + path); if (query) Object.entries(query).forEach(([k, v]) => v != null && url.searchParams.set(k, v));
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 20000);
    try {
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json', ...(token ? { 'X-TV-Token': token } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: ctl.signal, cache: 'no-store' });
      let p = {}; try { p = await res.json(); } catch (e) { /* not json */ }
      if (!res.ok) { const err = new Error(p.message || `Error ${res.status}`); err.status = res.status; err.code = p.code; throw err; }
      return p.data || {};
    } finally { clearTimeout(t); }
  }

  // ---- OFFLINE SUPPORT -------------------------------------------------------------------------------------------------
  // The server sends every scheduled slide with its time window (offlineSlides). The screen decides what is live by ITS OWN clock,
  // so breakfast -> lunch -> happy hour still switch correctly after the internet has been gone for hours or days.
  const toMin = (h) => { if (!h) return null; const m = /^(\d{1,2}):(\d{2})$/.exec(h); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
  function localNow(tz) {
    try { const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour12: false, weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date()).map((x) => [x.type, x.value]));
      return { date: `${p.year}-${p.month}-${p.day}`, minutes: (Number(p.hour) % 24) * 60 + Number(p.minute), dow: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday) }; }
    catch (e) { const d = new Date(); return { date: d.toISOString().slice(0, 10), minutes: d.getHours() * 60 + d.getMinutes(), dow: d.getDay() }; }
  }
  function inWindow(t, w) {
    const days = Array.isArray(w.days) ? w.days : []; const st = toMin(w.start); const en = toMin(w.end); const overnight = st !== null && en !== null && en < st;
    let dow = t.dow; let ds = t.date;
    if (overnight && t.minutes < en) { dow = (t.dow + 6) % 7; const d = new Date(t.date + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - 1); ds = d.toISOString().slice(0, 10); }
    if (days.length && !days.includes(dow)) return false;
    const from = w.startDate ? String(w.startDate).slice(0, 10) : null; const to = w.endDate ? String(w.endDate).slice(0, 10) : null;
    if (from && ds < from) return false; if (to && ds > to) return false;
    if (st === null && en === null) return true;
    const s0 = st == null ? 0 : st; const e0 = en == null ? 1440 : en;
    return overnight ? (t.minutes >= s0 || t.minutes < e0) : (t.minutes >= s0 && t.minutes < e0);
  }
  function resolve(c) {
    if (!c || !Array.isArray(c.offlineSlides)) return c;
    const t = localNow((c.business && c.business.timezone) || 'Africa/Nairobi');
    return { ...c, slides: c.offlineSlides.filter((x) => !x.schedule || inWindow(t, x.schedule)).map(({ schedule, ...r }) => r) };
  }
  // Pictures: keep a copy of every image of the current menu in the browser's cache so they still show with no internet (sw.js serves it).
  const MEDIA = 'tv-media-v1';
  const mediaUrls = (c) => { const u = new Set(); const add = (x) => { if (x && /^https?:/i.test(x)) u.add(x); }; add(c.business && c.business.logo);
    (c.offlineSlides || c.slides || []).forEach((s) => { add(s.media && s.media.url); (s.items || []).forEach((i) => add(i.image)); (s.rooms || []).forEach((r) => add(r.image)); }); return [...u]; };
  async function cacheMedia(c) {
    if (!window.caches) return; try {
      const cache = await caches.open(MEDIA); const want = mediaUrls(c); const have = new Set((await cache.keys()).map((r) => r.url));
      for (const url of want) { if (have.has(url)) continue; try { const res = await fetch(new Request(url, { mode: 'no-cors', cache: 'reload' })); if (res && (res.ok || res.type === 'opaque')) await cache.put(url, res); } catch (e) { /* try again next refresh */ } }
      for (const r of await cache.keys()) { if (!want.includes(r.url) && !r.url.endsWith('/__tv-content')) await cache.delete(r); }   // free space used by removed pictures
    } catch (e) { /* storage full / unsupported */ }
  }
  // Second copy of the menu (in case localStorage is cleared / full on a TV browser).
  const backup = async (d) => { try { if (window.caches) { const cache = await caches.open(MEDIA); await cache.put('/__tv-content', new Response(JSON.stringify(d), { headers: { 'Content-Type': 'application/json' } })); } } catch (e) { /* ignore */ } };
  const restore = async () => { try { if (window.caches) { const cache = await caches.open(MEDIA); const r = await cache.match('/__tv-content'); if (r) return await r.json(); } } catch (e) { /* ignore */ } return null; };
  if ('serviceWorker' in navigator) { try { navigator.serviceWorker.register('sw.js').catch(() => {}); } catch (e) { /* ignore */ } }

  function render(c) {
    content = c; if (!ctrl) ctrl = window.TVRender.create($('tv'));
    const fresh = !c.generatedAt || Date.now() - new Date(c.generatedAt).getTime() < 120000;    // never show an old copy of the order statuses as if it were live
    ctrl.setContent(resolve(c.ordersFeed && !fresh ? { ...c, orders: [] } : c)); ctrl.setStale(!!c.ordersFeed && !fresh); if (c.ordersFeed && fresh) oOk = Date.now();
    shown = c.version || 0; panel(null);
  }
  setInterval(() => { if (content && Array.isArray(content.offlineSlides)) { ctrl && ctrl.setContent(resolve(content)); } }, 30000);   // dayparts follow the clock
  function blocked(title, msg, canRepair) { panel('blocked'); $('btitle').textContent = title; $('bmsg').textContent = msg; $('brepair').style.display = canRepair ? '' : 'none'; }
  function dropToken() { token = null; store.del(LS.token); store.del(LS.cache); store.del(LS.etag); closeStream(); }

  async function load() {
    if (busy || !token || stopped) return; busy = true;
    try {
      const d = await call('/public/tv/content', { query: { etag: store.get(LS.etag), v: shown } });
      fails = 0;
      if (!d.unchanged) { store.set(LS.cache, JSON.stringify(d)); store.set(LS.etag, d.etag || ''); render(d); backup(d); cacheMedia(d); if (d.screen && d.screen.command && d.screen.command.type === 'RELOAD') setTimeout(() => location.reload(), 500); }
      else if (!content) { const c = JSON.parse(store.get(LS.cache) || 'null') || await restore(); if (c) render(c); }
      schedulePoll((d.pollSeconds || 30) * 1000);
    } catch (e) {
      if (e.status === 401 || e.code === 'TV_REVOKED' || e.code === 'TV_PENDING') { dropToken(); blocked('Screen disconnected', 'This screen was removed in the POS. Pair it again with a new code.', true); }
      else if (e.code === 'TV_DISABLED') { blocked('Screen switched off', e.message || 'A manager switched this screen off.', false); schedulePoll(30000); }
      else { fails += 1; status('Offline: showing the last menu'); report(e); if (!content) { const c = JSON.parse(store.get(LS.cache) || 'null') || await restore(); if (c) render(c); } schedulePoll(Math.min(10000 * Math.pow(1.5, Math.min(fails, 3)), 30000)); }
    } finally { busy = false; }
  }
  // ---- live order status: tiny separate feed so the slides never restart when an order moves from Preparing to Ready ----
  async function loadOrders() {
    if (oBusy || !token || stopped || !content || !content.ordersFeed || !ctrl) return; oBusy = true;
    try { const d = await call('/public/tv/orders'); oOk = Date.now(); content.orders = d.orders || []; ctrl.setOrders(content.orders); ctrl.setStale(false); }
    catch (e) { if (Date.now() - oOk > 90000) ctrl.setStale(true); if (e.status === 401 || e.code === 'TV_REVOKED' || e.code === 'TV_DISABLED') load(); }
    finally { oBusy = false; }
  }
  setInterval(loadOrders, 8000);
  function schedulePoll(ms) { clearTimeout(pollT); pollT = setTimeout(load, ms); }
  function report(e) { if (!token || Date.now() - lastErrAt < 300000 || e.status === 0) return; lastErrAt = Date.now(); call('/public/tv/error', { method: 'POST', body: { message: String(e.message || e).slice(0, 280) } }).catch(() => {}); }
  function beat() { if (token) call('/public/tv/heartbeat', { method: 'POST', body: { shownVersion: shown, appVersion: 'web-1' } }).catch(() => {}); }

  function openStream() {
    closeStream(); if (!token || !window.EventSource) return;
    es = new EventSource(`${API}/public/tv/stream?token=${encodeURIComponent(token)}`);
    es.addEventListener('refresh', () => load());
    es.addEventListener('orders', () => loadOrders());
    es.addEventListener('command', (ev) => { try { const d = JSON.parse(ev.data); if (d.type === 'RELOAD') location.reload(); else load(); } catch (e) { load(); } });
    es.addEventListener('revoked', () => load());
    es.onerror = () => { /* EventSource retries by itself; polling covers the gap */ };
  }
  function closeStream() { if (es) { es.close(); es = null; } }

  async function pair() {
    const code = $('code').value.trim(); $('perr').textContent = ''; if (code.replace(/[^A-Za-z0-9]/g, '').length < 8) { $('perr').textContent = 'Enter all 8 characters'; return; }
    $('pbtn').disabled = true;
    try { const d = await call('/public/tv/pair', { method: 'POST', body: { code } }); token = d.token; store.set(LS.token, token); store.del(LS.etag); start(); }
    catch (e) { $('perr').textContent = e.message || 'Could not connect. Try again.'; }
    finally { $('pbtn').disabled = false; }
  }
  function start() {
    if (!token) { panel('pair'); $('code').focus(); return; }
    const cached = JSON.parse(store.get(LS.cache) || 'null'); if (cached) render(cached); else { panel(null); restore().then((c) => { if (c && !content) render(c); }); }
    load(); openStream(); clearInterval(beatT); beatT = setInterval(beat, 30000); beat();
  }

  $('pbtn').onclick = pair; $('code').addEventListener('keydown', (e) => { if (e.key === 'Enter') pair(); });
  $('code').addEventListener('input', (e) => { const v = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8); e.target.value = v.length > 4 ? `${v.slice(0, 4)}-${v.slice(4)}` : v; });
  $('brepair').onclick = () => { panel('pair'); $('code').focus(); };
  const fs = $('fs'); const canFs = document.documentElement.requestFullscreen; if (canFs) { fs.style.display = 'block'; fs.onclick = () => document.documentElement.requestFullscreen().catch(() => {}); document.addEventListener('fullscreenchange', () => { fs.style.display = document.fullscreenElement ? 'none' : 'block'; }); }
  document.addEventListener('mousemove', () => { document.body.classList.add('show-cursor'); clearTimeout(document.body._c); document.body._c = setTimeout(() => document.body.classList.remove('show-cursor'), 3000); });
  window.addEventListener('online', load); document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
  window.addEventListener('error', (e) => report(e.error || new Error(e.message)));
  // keep the screen awake, and restart once a day (04:00) so a TV browser that runs for weeks stays healthy
  const wake = async () => { try { if (navigator.wakeLock) await navigator.wakeLock.request('screen'); } catch (e) { /* not supported */ } }; wake(); document.addEventListener('visibilitychange', () => { if (!document.hidden) wake(); });
  (function dailyReload() { const n = new Date(); const t = new Date(n); t.setHours(4, 0, 0, 0); if (t <= n) t.setDate(t.getDate() + 1); const go = () => { if (navigator.onLine !== false) location.reload(); else setTimeout(go, 600000); }; setTimeout(go, t - n); })();
  start();
})();
