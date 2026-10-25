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
  let token = store.get(LS.token); let ctrl = null; let content = null; let shown = 0; let es = null; let pollT = null; let beatT = null; let busy = false; let fails = 0; let lastErrAt = 0; let stopped = false;

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

  function render(c) {
    content = c; if (!ctrl) ctrl = window.TVRender.create($('tv'));
    ctrl.setContent(c); shown = c.version || 0; panel(null);
  }
  function blocked(title, msg, canRepair) { panel('blocked'); $('btitle').textContent = title; $('bmsg').textContent = msg; $('brepair').style.display = canRepair ? '' : 'none'; }
  function dropToken() { token = null; store.del(LS.token); store.del(LS.cache); store.del(LS.etag); closeStream(); }

  async function load() {
    if (busy || !token || stopped) return; busy = true;
    try {
      const d = await call('/public/tv/content', { query: { etag: store.get(LS.etag), v: shown } });
      fails = 0;
      if (!d.unchanged) { store.set(LS.cache, JSON.stringify(d)); store.set(LS.etag, d.etag || ''); render(d); if (d.screen && d.screen.command && d.screen.command.type === 'RELOAD') setTimeout(() => location.reload(), 500); }
      else if (!content) { const c = JSON.parse(store.get(LS.cache) || 'null'); if (c) render(c); }
      schedulePoll((d.pollSeconds || 30) * 1000);
    } catch (e) {
      if (e.status === 401 || e.code === 'TV_REVOKED' || e.code === 'TV_PENDING') { dropToken(); blocked('Screen disconnected', 'This screen was removed in the POS. Pair it again with a new code.', true); }
      else if (e.code === 'TV_DISABLED') { blocked('Screen switched off', e.message || 'A manager switched this screen off.', false); schedulePoll(30000); }
      else { fails += 1; status('Offline: showing the last menu'); report(e); if (!content) { const c = JSON.parse(store.get(LS.cache) || 'null'); if (c) render(c); } schedulePoll(Math.min(30000 * Math.pow(1.5, Math.min(fails, 5)), 180000)); }
    } finally { busy = false; }
  }
  function schedulePoll(ms) { clearTimeout(pollT); pollT = setTimeout(load, ms); }
  function report(e) { if (!token || Date.now() - lastErrAt < 300000 || e.status === 0) return; lastErrAt = Date.now(); call('/public/tv/error', { method: 'POST', body: { message: String(e.message || e).slice(0, 280) } }).catch(() => {}); }
  function beat() { if (token) call('/public/tv/heartbeat', { method: 'POST', body: { shownVersion: shown, appVersion: 'web-1' } }).catch(() => {}); }

  function openStream() {
    closeStream(); if (!token || !window.EventSource) return;
    es = new EventSource(`${API}/public/tv/stream?token=${encodeURIComponent(token)}`);
    es.addEventListener('refresh', () => load());
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
    const cached = JSON.parse(store.get(LS.cache) || 'null'); if (cached) render(cached); else panel(null);
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
  (function dailyReload() { const n = new Date(); const t = new Date(n); t.setHours(4, 0, 0, 0); if (t <= n) t.setDate(t.getDate() + 1); setTimeout(() => location.reload(), t - n); })();
  start();
})();
