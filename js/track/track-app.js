/**
 * track-app.js - customer live tracking (Uber-style). Opened from the storefront order page:  track.html?t=<storefront token>&k=<trackKey>
 * Backend: /public/store/:token/delivery/:key/{live,stream,location,rate,push}  (no login: the unguessable key is the pass).
 */
(function () {
  const Lv = window.Live, { esc, ic, money, $, $$ } = Lv; const app = $('#app');
  const q = new URLSearchParams(location.search);
  const T = q.get('t') || (location.pathname.match(/\/track\/([^/]+)\/([a-f0-9]{16})/) || [])[1] || '';
  const K = q.get('k') || q.get('track') || (location.pathname.match(/\/track\/([^/]+)\/([a-f0-9]{16})/) || [])[2] || '';
  const base = `/public/store/${encodeURIComponent(T)}/delivery/${encodeURIComponent(K)}`;
  const A = Lv.client({ ns: 'track' });
  const storeUrl = `store.html?t=${encodeURIComponent(T)}&track=${encodeURIComponent(K)}`;
  const S = { live: null, order: null, map: null, sse: 'down', seen: new Set(), sharing: false, stopShare: null, lastShare: 0, alertT: null, done: false };
  const hasShared = () => { try { return localStorage.getItem('track.share.' + K) === '1'; } catch (e) { return false; } };

  if (!T || !K) { app.innerHTML = `<div class="empty" style="padding-top:120px"><div class="em">${ic('alert')}</div><b>This tracking link is incomplete</b>Open it again from your order page.</div>`; return; }

  const STEP = { CONFIRMED: 'Confirmed', PICKED_UP: 'Picked Up', ON_THE_WAY: 'On the Way', DELIVERED: 'Delivered' };
  const stepper = (steps) => `<div class="steps">${(steps && steps.length ? steps : Object.keys(STEP).map((k) => ({ key: k }))).map((s) => `<div class="s ${s.current ? 'now' : s.done ? 'done' : ''}"><i></i>${esc(STEP[s.key] || s.label)}</div>`).join('')}</div>`;
  const TONE = { PENDING: 'ye', ASSIGNED: 'bl', PICKED_UP: 'ye', ON_THE_WAY: 'or', ARRIVED: 'gr', DELIVERED: 'gr', FAILED: 'rd', CANCELLED: 'gy' };
  const LBL = { PENDING: 'Preparing', ASSIGNED: 'Rider assigned', PICKED_UP: 'Picked up', ON_THE_WAY: 'On the way', ARRIVED: 'Arrived', DELIVERED: 'Delivered', FAILED: 'Not delivered', CANCELLED: 'Cancelled' };
  const first = (n) => String(n || '').split(' ')[0];

  /* ---- alerts: pop-up banner + sound (+ system notification when the tab is hidden) ---- */
  function showAlert(a) {
    if (!a) return; const id = a.id || a.kind + ':' + a.distanceM + ':' + a.message; if (S.seen.has(id)) return; S.seen.add(id);
    const bar = $('#ab'); bar.innerHTML = `<div class="ai">${ic(a.kind === 'ARRIVED' ? 'pin' : 'bike')}</div><div class="grow"><b>${esc(a.title || 'Your rider')}</b><div style="font-size:13px;color:#cdd3d9">${esc(a.message || '')}</div></div>`;
    bar.classList.add('in'); clearTimeout(S.alertT); S.alertT = setTimeout(() => bar.classList.remove('in'), 7000); bar.onclick = () => bar.classList.remove('in');
    Lv.beep('alert'); Lv.notify(a.title || 'Six Star POS', a.message || '', 'rider-' + id);
  }

  /* ---- data ---- */
  async function loadLive(quiet) {
    try { const l = await A.get(base + '/live'); S.live = l; (l.alerts || []).forEach((a) => { if (!S.seen.has(a.id || a.kind + ':' + a.distanceM + ':' + a.message)) { if (S.first) showAlert(Object.assign({}, a, { title: 'Your rider' })); else S.seen.add(a.id || a.kind + ':' + a.distanceM + ':' + a.message); } }); S.first = true; paint(); }
    catch (e) { if (!S.live) app.innerHTML = `<div class="empty" style="padding-top:120px"><div class="em">${ic('alert')}</div><b>${esc(e.message)}</b><a class="btn sm" style="margin-top:14px" href="${storeUrl}">Back to order</a></div>`; else if (!quiet) Lv.toast(e.message, 'error'); }
  }
  async function loadOrder() { try { S.order = await A.get(`/public/store/${encodeURIComponent(T)}/delivery/${encodeURIComponent(K)}`); if (S.order && S.order.currency) Lv.setCurrency(S.order.currency); } catch (e) { /* the live block is enough */ } }

  function openStream() {
    Lv.sse({
      open: async () => A.base + base + '/stream', events: ['hello', 'location', 'status', 'alert', 'payment', 'arrived', 'rated'],
      state: (s) => { S.sse = s; const c = $('#cn'); if (c) { c.className = 'tag ' + (s === 'live' ? 'gr' : 'ye'); c.textContent = s === 'live' ? 'Live' : 'Reconnecting'; } },
      on: (n, d) => {
        if (n === 'hello') { S.live = d; paint(); return; }
        if (n === 'location' && S.live) { S.live.riderLocation = { lat: d.lat, lng: d.lng, heading: d.heading, at: d.at, ageSec: 0, stale: false }; if (d.distanceM != null) S.live.distanceM = d.distanceM; if (d.etaMinutes != null) S.live.etaMinutes = d.etaMinutes; if (S.live.stage !== 'ARRIVED' && S.live.stage !== 'DELIVERED') S.live.live = true; paintLive(); return; }
        if (n === 'alert') { showAlert(d); loadLive(true); return; }
        loadLive(true);
      },
      poll: () => loadLive(true), pollMs: 6000,
    });
  }

  /* ---- paint ---- */
  const top = (right) => `<div class="top"><a class="ib" href="${storeUrl}" aria-label="Back">${ic('back')}</a><h1>Track Your Order</h1>${right || ''}</div>`;
  function headline(l) {
    const st = l.stage; const d = l.distanceM, e = l.etaMinutes;
    if (st === 'ON_THE_WAY') return `<div class="big">Arriving in <em>${e == null ? '--' : e <= 0 ? 'under a minute' : e + ' min'}</em>${d != null ? ` <span class="muted" style="font-weight:600">(${Lv.dist(d)})</span>` : ''}</div>`;
    if (st === 'ARRIVED') return '<div class="big"><em>Your rider has arrived</em></div>';
    if (st === 'PICKED_UP') return '<div class="big">Your rider is about to set off</div>';
    if (st === 'ASSIGNED') return '<div class="big">A rider has been assigned</div>';
    if (st === 'FAILED' || st === 'CANCELLED') return `<div class="big">${st === 'FAILED' ? 'We could not deliver' : 'Order cancelled'}</div>`;
    return '<div class="big">We are preparing your order</div>';
  }
  function paint() {
    const l = S.live; if (!l) return;
    if (l.stage === 'DELIVERED') { const k = 'DELIVERED:' + (l.canRate ? 1 : 0) + (l.rating || 0); if (S.rendered === k) return; S.rendered = k; return paintDone(l); }
    if (S.rendered === l.stage && S.map && $('#tm')) { paintCard(); const st = $('.tk-card .steps'); if (st) st.outerHTML = stepper(l.steps); paintLive(); return; }
    S.rendered = l.stage;
    if (S.map && S.mapStage === 'done') { S.map.destroy(); S.map = null; }
    const rd = l.rider; const o = S.order || {};
    app.innerHTML = top(`<span class="tag ${S.sse === 'live' ? 'gr' : 'ye'}" id="cn">${S.sse === 'live' ? 'Live' : 'Connecting'}</span>`) +
      `<div class="tk-eta"><div class="row"><div class="grow"><b>Order ${esc(l.orderNumber)}</b>${o.items ? `<div class="fine">${o.items.length} item${o.items.length > 1 ? 's' : ''} · ${money(o.total)}</div>` : ''}</div><span class="tag ${TONE[l.stage] || 'gy'}">${LBL[l.stage] || l.stage}</span></div><div class="sp8"></div><div id="hl">${headline(l)}</div><div class="fine" id="msg">${esc(l.message || '')}</div></div>
      <div class="tk-map"><div class="m" id="tm"></div></div>
      <div class="tk-card"><div class="row" id="rc"></div><div class="sp8"></div>${stepper(l.steps)}<div id="pyn"></div></div>
      <div class="pad"><div class="sp"></div><div id="acts"></div><div class="sp"></div></div>`;
    S.mapStage = 'live'; initMap(); paintCard(); paintLive();
  }
  function initMap() {
    if (S.map) { S.map.destroy(); S.map = null; } const l = S.live; const dp = l.destination;
    S.map = Lv.map($('#tm'), { theme: 'light', center: dp ? [dp.lat, dp.lng] : undefined, zoom: 15 }); S.fitted = false;
  }
  function paintCard() {
    const l = S.live, rd = l.rider, rc = $('#rc'); if (!rc) return;
    rc.innerHTML = rd ? `<div class="rd-av">${esc(first(rd.name).charAt(0).toUpperCase())}</div><div class="grow"><div class="b">${esc(rd.fullName || rd.name)}</div><div class="fine">Your rider${l.riderLocation && l.riderLocation.stale ? ' · last seen ' + Lv.ago(l.riderLocation.at) : ''}</div></div>${rd.phone ? `<a class="callb" href="${Lv.phoneHref(rd.phone)}" aria-label="Call rider">${ic('phone')}</a>` : ''}` : `<div class="rd-av">${ic('bike')}</div><div class="grow"><div class="b">Rider coming soon</div><div class="fine">You will see them here as soon as one is assigned.</div></div>`;
    const p = l.pay || {}; const cod = p.state === 'COD' || p.state === 'UNPAID';
    $('#pyn').innerHTML = ['ON_THE_WAY', 'ARRIVED', 'PICKED_UP'].includes(l.stage) && cod && !(p.rider && p.rider.status !== 'CANCELLED') ? `<div class="note info" style="margin-bottom:0">${ic('cash')}<div>Pay on delivery${S.order && S.order.total ? ': have <b>' + money(S.order.amountDue || S.order.total) + '</b> ready' : ''}. M-PESA or cash, the rider will help you.</div></div>` : p.rider && p.rider.status === 'AWAITING_MPESA' ? `<div class="note ok" style="margin-bottom:0">${ic('mpesa')}<div>Check your phone and enter your M-PESA PIN to pay ${money(p.rider.amount)}.</div></div>` : '';
    const a = $('#acts'); if (!a) return; const live = ['ASSIGNED', 'PICKED_UP', 'ON_THE_WAY', 'ARRIVED'].includes(l.stage);
    a.innerHTML = (live ? `<button class="btn ${S.sharing ? 'green' : 'line'}" id="sh">${ic('target')} ${S.sharing ? 'Sharing my location' : 'Share my location with the rider'}</button><div class="sp8"></div>` : '') + `<button class="btn ghost" id="al">${ic('bell')} ${Lv.pushState() === 'granted' ? 'Lock-screen alerts are on' : 'Alert me when the rider is close'}</button><div class="sp8"></div><a class="btn ghost" href="${storeUrl}">${ic('receipt')} Order details</a>`;
    const sh = $('#sh'); if (sh) sh.onclick = toggleShare; const al = $('#al'); if (al) al.onclick = enableAlerts;
  }
  function paintLive() {
    const l = S.live; if (!l) return; const h = $('#hl'); if (h) h.innerHTML = headline(l); const m = $('#msg'); if (m) m.textContent = l.message || '';
    const mp = S.map; if (!mp) return; const dp = l.destination, rl = l.live ? l.riderLocation : null, org = l.origin;
    if (dp) mp.put('dest', 'dest', dp, { label: 'You' }); if (org && !rl) mp.put('origin', 'origin', org, { label: 'Restaurant' }); else if (rl) mp.drop('origin');
    if (rl) mp.put('rider', 'rider', rl, { label: first(l.rider && l.rider.name) || 'Rider' }); else mp.drop('rider');
    mp.trail(l.trail || []); if (rl && dp) mp.route([rl, dp], { dashed: true, color: '#F26A21' }); else mp.route(null);
    const pts = [rl || org, dp].filter(Boolean); const key = pts.length + ':' + (rl ? 'r' : 'o'); if (S.fitKey !== key) { S.fitKey = key; mp.fit(pts, 70, true); } else if (rl) mp.fit(pts, 70);
    const c = $('#rc'); if (c && !c.children.length) paintCard();
  }

  /* ---- delivered ---- */
  function paintDone(l) {
    if (S.map) { S.map.destroy(); S.map = null; } S.mapStage = 'done'; let stars = 0;
    app.innerHTML = `<div class="done-hero"><div class="rd2">${ic('bike')}</div><h2 style="font-size:24px">Your order has arrived!</h2><p class="muted" style="margin:8px 0 0">Order ${esc(l.orderNumber)}</p><p style="font-weight:700;margin-top:4px">Bon appétit!</p>
      <div class="sp"></div>${l.canRate ? `<div class="card"><b>How was ${esc(first(l.rider && l.rider.name) || 'your rider')}?</b><div class="stars" id="st">${[1, 2, 3, 4, 5].map((n) => `<button data-s="${n}" aria-label="${n} star">${ic('star')}</button>`).join('')}</div><textarea class="field" id="cm" rows="2" placeholder="Add a comment (optional)" style="display:none"></textarea></div><div class="sp"></div>` : l.rating ? `<div class="note ok">${ic('star')}<div>Thanks for rating your rider ${l.rating}★</div></div>` : ''}
      <a class="btn ghost" href="${storeUrl}">${ic('receipt')} View Receipt</a><div class="sp8"></div>${l.canRate ? '<button class="btn" id="rt" disabled>Rate Rider</button><div class="sp8"></div>' : ''}<a class="btn ${l.canRate ? 'ghost' : ''}" href="store.html?t=${encodeURIComponent(T)}">Back to Menu</a></div>`;
    if (!S.done) { S.done = true; confetti(); Lv.beep(); } stopShare();
    $$('#st button').forEach((b) => b.onclick = () => { stars = +b.dataset.s; $$('#st button').forEach((x) => x.classList.toggle('on', +x.dataset.s <= stars)); $('#cm').style.display = 'block'; $('#rt').disabled = false; });
    const rt = $('#rt'); if (rt) rt.onclick = async () => { rt.disabled = true; try { await A.post(base + '/rate', { stars, comment: $('#cm').value.trim() || undefined }); Lv.toast('Thank you for your feedback!', 'ok'); loadLive(true); } catch (e) { rt.disabled = false; Lv.toast(e.message, 'error'); } };
  }
  function confetti() { const c = document.createElement('div'); c.className = 'conf'; const cols = ['#F26A21', '#1F9D55', '#3B82F6', '#F5A623', '#D92D20']; c.innerHTML = Array.from({ length: 44 }, () => `<i style="left:${Math.random() * 100}%;background:${cols[(Math.random() * cols.length) | 0]};animation-duration:${1.6 + Math.random() * 1.6}s;animation-delay:${Math.random() * .5}s"></i>`).join(''); document.body.appendChild(c); setTimeout(() => c.remove(), 4000); }

  /* ---- customer shares where they are, so the rider can find the door ---- */
  function toggleShare() { S.sharing ? stopShare(true) : startShare(); }
  function startShare() {
    if (S.stopShare) return;
    S.stopShare = Lv.geo.watch(async (p) => {
      S.sharing = true; try { localStorage.setItem('track.share.' + K, '1'); } catch (e) { /* ignore */ }
      if (S.myPos) S.map && S.map.put('me', 'me', p, { label: 'Me' }); S.myPos = p; S.map && S.map.put('me', 'me', p);
      if (Date.now() - S.lastShare < 15000) return; S.lastShare = Date.now();
      try { await A.post(base + '/location', { lat: p.lat, lng: p.lng }); } catch (e) { /* the rider still has the address */ }
      const b = $('#sh'); if (b && !b.classList.contains('green')) paintCard();
    }, (e) => { S.sharing = false; S.stopShare = null; Lv.toast(Lv.geo.message(e), 'warn', 4500); paintCard(); });
    Lv.toast('Your rider can now see where you are.', 'ok'); setTimeout(paintCard, 300);
  }
  function stopShare(manual) { if (S.stopShare) { S.stopShare(); S.stopShare = null; } S.sharing = false; if (S.map) S.map.drop('me'); try { localStorage.removeItem('track.share.' + K); } catch (e) { /* ignore */ } if (manual) { Lv.toast('You stopped sharing your location.', 'info'); paintCard(); } }
  async function enableAlerts() {
    try { await Lv.enablePush(() => A.get(`/public/store/${encodeURIComponent(T)}/push/key`), (sub) => A.post(base + '/push', sub)); Lv.toast('You will be alerted when your rider is close.', 'ok'); paintCard(); }
    catch (e) { Lv.toast(e.message, 'warn', 5000); }
  }

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  loadOrder().then(() => { if (S.live) paintCard(); });
  loadLive().then(() => { openStream(); if (hasShared()) startShare(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) loadLive(true); });
})();
