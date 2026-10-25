/**
 * hx-live.js - Live delivery tracking for owners, managers and cashiers (Uber-style board).
 * Map of every rider and customer, active deliveries, rider cash at the till, rider QR code.
 * API: GET /delivery-live/board, SSE /delivery-live/stream, GET/POST /delivery-live/cash*, GET/POST /delivery-live/qr*, POST /restaurant/orders/:id/delivery/assign
 */
(function () {
  const Lv = window.Live;
  const { E, M, can, get, send, list, head, formModal } = window.HX;
  let el, board = { stats: {}, riders: [], deliveries: [] }, map = null, tab = 'map', sel = null, filter = 'ALL', sse = null, state = 'down', cash = null, qr = null, refetchT = null, pendingFit = true, riders = [];
  const TONE = { PENDING: 'ye', ASSIGNED: 'bl', PICKED_UP: 'ye', ON_THE_WAY: 'or', ARRIVED: 'gr', DELIVERED: 'gr', FAILED: 'rd', CANCELLED: 'gy' };
  const LBL = { PENDING: 'Pending', ASSIGNED: 'Assigned', PICKED_UP: 'Picked up', ON_THE_WAY: 'On the way', ARRIVED: 'Arrived', DELIVERED: 'Delivered', FAILED: 'Failed' };
  const tag = (s, l) => `<span class="tag ${TONE[s] || 'gy'}">${E(l || LBL[s] || s)}</span>`;
  const bid = () => window.HX.branchId();
  const pos = (o) => (o && o.lat != null ? { lat: o.lat, lng: o.lng } : null);
  const rpos = (r) => pos(r.location) || pos(r);
  const cust = (d) => (d.customer && (d.customer.name || d.customer.contactName)) || 'Customer';
  const caddr = (d) => (d.customer && (d.customer.address || d.customer.landmark)) || '';
  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    el = window.HX.mount('Live tracking'); if (!el) return; await window.AppShell.whenProfileReady?.();
    if (!window.HX.canAny('restaurant.delivery.view', 'restaurant.delivery.cash', 'restaurant.delivery.qr')) { el.innerHTML = head('Live tracking', '') + window.HX.empty('No access', 'Ask the owner for delivery access.'); return; }
    if (can('restaurant.delivery.manage')) { const e = await get('/employees', { limit: 100 }); riders = list(e, 'employees').filter((x) => x.role === 'DELIVERY_RIDER'); }
    await loadBoard(); shell(); paint(); openStream();
    window.HX.live(() => { if (state !== 'live') loadBoard().then(paintLive); }, 15000);
    window.addEventListener('branchchange', () => { pendingFit = true; loadBoard().then(() => { paintLive(); }); });
  }
  async function loadBoard() { const b = await get('/delivery-live/board', { branchId: bid() }); if (b) board = b; return b; }
  const ago = (t) => Lv.ago(t);

  function shell() {
    const tabs = [['map', 'Live map', true], ['cash', 'Rider cash', can('restaurant.delivery.cash')], ['qr', 'Rider QR code', can('restaurant.delivery.qr')]].filter((x) => x[2]);
    el.innerHTML = head('Live Delivery Tracking', 'Follow every rider and customer in real time.', `<span class="lb-live off" id="lst">Connecting</span><a class="btn btn-secondary" href="hx-delivery.html">Delivery &amp; pickup</a>`) +
      `<div class="lb-stats" id="stats"></div><div class="lb-tabs" id="tabs">${tabs.map(([k, l]) => `<button data-t="${k}" class="${tab === k ? 'on' : ''}">${l}</button>`).join('')}</div><div id="body"></div>`;
    el.querySelectorAll('#tabs [data-t]').forEach((b) => b.onclick = () => { tab = b.dataset.t; el.querySelectorAll('#tabs [data-t]').forEach((x) => x.classList.toggle('on', x === b)); paint(); });
  }
  function stats() {
    const s = board.stats || {}; el.querySelector('#stats').innerHTML = [['Active riders', s.activeRiders], ['On delivery', s.onDelivery], ['Completed today', s.completedToday], ['Waiting for a rider', s.unassigned]].map(([l, v]) => `<div class="lb-stat"><span>${l}</span><b>${v == null ? 0 : v}</b></div>`).join('');
  }
  function paint() {
    stats(); if (map) { map.destroy(); map = null; } const b = el.querySelector('#body');
    if (tab === 'map') paintMap(b); else if (tab === 'cash') paintCash(b); else paintQr(b);
  }
  function paintLive() { stats(); if (tab !== 'map') return; paintSide(); drawMap(); }

  /* ---------------- live map ---------------- */
  function paintMap(b) {
    b.innerHTML = `<div class="lb-wrap"><div><div class="lb-map"><div id="lm"></div></div><div class="fine" style="margin-top:8px">Orange = riders · Red pins = customers · Black = restaurant. Click a delivery or rider to focus it.</div></div><div id="side"></div></div>`;
    map = Lv.map(b.querySelector('#lm'), { theme: 'light', controls: true, zoom: 12 }); pendingFit = true; paintSide(); drawMap();
  }
  function paintSide() {
    const side = el.querySelector('#side'); if (!side) return; const ds = (board.deliveries || []).filter((d) => filter === 'ALL' || (filter === 'UNASSIGNED' ? !d.rider : d.stage === filter));
    side.innerHTML = `<div class="lb-panel"><h3><span style="flex:1">Active deliveries (${ds.length})</span><select class="select" id="flt" style="max-width:150px"><option value="ALL">All orders</option><option value="UNASSIGNED">Unassigned</option><option value="ON_THE_WAY">On the way</option><option value="ASSIGNED">Assigned</option><option value="PICKED_UP">Picked up</option><option value="ARRIVED">Arrived</option></select></h3>
      ${ds.length ? ds.map((d) => `<div class="lb-row ${sel === 'd:' + d.orderId ? 'sel' : ''}" data-d="${d.orderId}"><div class="grow"><div><b>#${E(d.orderNumber)}</b> · ${E(cust(d))}</div><div class="fine">${E(d.rider ? d.rider.name : 'No rider yet')}${d.distanceM != null ? ' · ' + Lv.dist(d.distanceM) : ''}${d.etaMinutes != null && ['ON_THE_WAY', 'ARRIVED'].includes(d.stage) ? ' · ETA ' + Lv.eta(d.etaMinutes) : ''}</div>${d.payment && d.payment.rider ? `<div class="fine">${d.payment.rider.method === 'CASH' ? 'Cash held' : 'M-PESA'} ${M(d.payment.rider.amount)}</div>` : d.payment && d.payment.method === 'CASH' && d.rider ? `<div class="fine">Pay on delivery · ${M(d.total)}</div>` : ''}</div><div style="text-align:right">${tag(d.stage)}${!d.rider && riders.length ? `<div style="margin-top:6px"><button class="btn btn-sm btn-primary" data-as="${d.orderId}">Assign</button></div>` : ''}</div></div>`).join('') : '<div class="fine" style="padding:22px;text-align:center">No deliveries in progress.</div>'}</div>
      <div class="lb-panel" style="margin-top:14px"><h3>Riders (${(board.riders || []).length})</h3>${(board.riders || []).length ? board.riders.map((r) => `<div class="lb-row ${sel === 'r:' + r.riderId ? 'sel' : ''}" data-r="${r.riderId}"><span class="lb-dot ${r.online ? 'on' : ''}"></span><div class="grow"><b>${E(r.name)}</b><div class="fine">${r.online ? (r.activeDeliveries && r.activeDeliveries.length ? r.activeDeliveries.map((a) => '#' + E(a.orderNumber)).join(', ') : 'Available') : 'Offline' + (r.lastSeenAt ? ' · ' + ago(r.lastSeenAt) : '')}${r.battery && r.battery.level != null && r.battery.level <= .2 ? ' · Low battery' : ''}</div></div><div style="text-align:right">${r.cashHeld > 0 ? `<span class="tag ye">${M(r.cashHeld)}</span>` : ''}${r.phone ? `<div><a class="fine" href="${Lv.phoneHref(r.phone)}">Call</a></div>` : ''}</div></div>`).join('') : '<div class="fine" style="padding:22px;text-align:center">No riders yet. Add employees with the Delivery rider role.</div>'}</div>`;
    const f = side.querySelector('#flt'); f.value = filter; f.onchange = () => { filter = f.value; paintSide(); };
    side.querySelectorAll('[data-d]').forEach((r) => r.onclick = (e) => { if (e.target.closest('[data-as]')) return; sel = 'd:' + r.dataset.d; focus(); paintSide(); });
    side.querySelectorAll('[data-r]').forEach((r) => r.onclick = () => { sel = 'r:' + r.dataset.r; focus(); paintSide(); });
    side.querySelectorAll('[data-as]').forEach((b) => b.onclick = () => assign(b.dataset.as));
  }
  function drawMap() {
    if (!map) return; const keep = new Set(); const all = [];
    (board.riders || []).forEach((r) => { const p = rpos(r); if (p && r.online) { keep.add('r' + r.riderId); all.push(p); map.put('r' + r.riderId, 'rider', p, { label: first(r.name) + (r.activeDeliveries && r.activeDeliveries.length ? '' : ' · free') }); } });
    (board.deliveries || []).forEach((d) => { const dp = d.destination && pos(d.destination); if (dp) { keep.add('c' + d.orderId); all.push(dp); map.put('c' + d.orderId, 'dest', dp, { label: '#' + d.orderNumber + ' ' + first(cust(d)) }); } const o = d.origin && pos(d.origin); if (o) { keep.add('o' + (d.branchId || '')); map.put('o' + (d.branchId || ''), 'origin', o); if (!all.length) all.push(o); } });
    map.clear(Array.from(keep)); // drop markers of work that has finished
    if (pendingFit && all.length) { pendingFit = false; map.fit(all, 50, true); }
    const s = sel && sel.startsWith('d:') ? (board.deliveries || []).find((d) => String(d.orderId) === sel.slice(2)) : null;
    if (s && s.location && s.destination) map.route([pos(s.location), pos(s.destination)], { dashed: true }); else map.route(null);
  }
  function focus() {
    if (!map || !sel) return; const [k, id] = [sel[0], sel.slice(2)];
    if (k === 'd') { const d = (board.deliveries || []).find((x) => String(x.orderId) === id); if (!d) return; const pts = [d.destination && pos(d.destination), d.location && pos(d.location), d.origin && pos(d.origin)].filter(Boolean); map.fit(pts, 80, true); drawMap(); }
    else { const r = (board.riders || []).find((x) => String(x.riderId) === id); const p = r && rpos(r); if (p) map.fit([p], 60, true); else window.UI.toast.info('This rider has not shared a location yet.'); }
  }
  const first = (n) => String(n || '').split(' ')[0];
  function assign(id) {
    formModal({ title: 'Assign rider', maxWidth: '400px', fields: [{ name: 'riderId', label: 'Rider', type: 'select', options: riders.map((r) => [r._id, r.name || r.fullName || r.employeeCode]) }], onSubmit: async (v) => { if (await send('post', `/restaurant/orders/${id}/delivery/assign`, v)) { await loadBoard(); paintLive(); return true; } return false; } });
  }

  /* ---------------- live stream ---------------- */
  function setState(s) { state = s; const t = el.querySelector('#lst'); if (t) { t.className = 'lb-live' + (s === 'live' ? '' : ' off'); t.textContent = s === 'live' ? 'Live' : 'Reconnecting'; } }
  function openStream() {
    sse = Lv.sse({
      open: async () => { const { data } = await window.Api.post('/delivery-live/stream-ticket', {}); const q = new URLSearchParams({ ticket: data.ticket }); if (bid()) q.set('branchId', bid()); return window.APP_CONFIG.API_BASE_URL + '/delivery-live/stream?' + q; },
      events: ['hello', 'location', 'rider', 'status', 'payment', 'cash', 'alert', 'assigned', 'rated'], state: setState,
      on: (n, d) => {
        if (n === 'hello') { board = d; paintLive(); return; }
        if (n === 'rider' && d.type === 'rider_location') { const r = (board.riders || []).find((x) => String(x.riderId) === String(d.riderId)); if (r) { r.location = { lat: d.lat, lng: d.lng, heading: d.heading, at: d.at }; r.online = true; r.lastSeenAt = d.at; r.battery = d.battery || r.battery; } else queue(); drawMap(); return; }
        if (n === 'location') { const x = (board.deliveries || []).find((k) => String(k.orderId) === String(d.orderId)); if (x) { x.location = { lat: d.lat, lng: d.lng, at: d.at }; x.distanceM = d.distanceM; x.etaMinutes = d.etaMinutes; } drawMap(); if (!queue.t) paintSide(); return; }
        if (n === 'cash') { const m = { COLLECTED: 'collected cash for #' + (d.orderNumber || ''), RETURNING: 'is bringing ' + M(d.total) + ' back', HANDED_OVER: 'handed over ' + M(d.received) }[d.event]; if (m) window.UI.toast.info((d.riderName || 'Rider') + ' ' + m); if (tab === 'cash') loadCash(); queue(); return; }
        if (n === 'status' && d.event === 'ARRIVED') window.UI.toast.info('Rider arrived at #' + d.orderNumber);
        queue();
      },
    });
  }
  function queue() { if (queue.t) return; queue.t = setTimeout(async () => { queue.t = null; await loadBoard(); paintLive(); }, 800); }

  /* ---------------- rider cash ---------------- */
  async function loadCash() { cash = await get('/delivery-live/cash', { branchId: bid() }); if (tab === 'cash') paintCash(el.querySelector('#body')); }
  async function paintCash(b) {
    if (!cash) { b.innerHTML = window.HX.skel('rows', 4); cash = await get('/delivery-live/cash', { branchId: bid() }) || { riders: [], totalHeld: 0, count: 0 }; }
    const rs = cash.riders || [];
    b.innerHTML = `<div class="lb-stats" style="grid-template-columns:repeat(2,1fr);max-width:560px"><div class="lb-stat"><span>Cash with riders</span><b>${M(cash.totalHeld)}</b></div><div class="lb-stat"><span>Payments waiting</span><b>${cash.count || 0}</b></div></div>
      ${rs.length ? rs.map((r) => `<div class="lb-panel" style="margin-bottom:14px"><h3><span style="flex:1">${E(r.rider.name)} ${r.returning ? '<span class="tag gr">On the way back</span>' : ''}</span><b>${M(r.total)}</b></h3>${r.collections.map((c) => `<div class="lb-row" style="cursor:default"><div class="grow"><b>#${E(c.orderNumber)}</b> · ${E(c.customerName || '')}<div class="fine">Collected ${c.heldMinutes} min ago</div></div><b>${M(c.amount)}</b></div>`).join('')}<div style="padding:12px 16px"><button class="btn btn-primary" data-ho="${r.rider.id}">Receive ${M(r.total)} from ${E(first(r.rider.name))}</button></div></div>`).join('') : window.HX.empty('No rider cash waiting', 'When a rider collects cash on delivery it shows here until you receive it at the till.')}`;
    b.querySelectorAll('[data-ho]').forEach((x) => x.onclick = () => handover(rs.find((r) => String(r.rider.id) === x.dataset.ho)));
  }
  function handover(r) {
    formModal({ title: 'Receive rider cash', maxWidth: '420px', fields: [{ name: 'receivedAmount', label: `Cash received (expected ${M(r.total)})`, type: 'number', value: r.total, step: 'any', min: 0, required: true }, { name: 'note', label: 'Note (optional)', type: 'text' }], onSubmit: async (v) => {
      const out = await send('post', '/delivery-live/cash/handover', { riderId: r.rider.id, receivedAmount: Number(v.receivedAmount), note: v.note || undefined }); if (!out) return false;
      window.UI.toast.success('Cash recorded'); cash = null; await loadCash(); queue(); return true; } });
  }

  /* ---------------- rider QR ---------------- */
  async function paintQr(b) {
    if (!qr) { b.innerHTML = window.HX.skel('rows', 3); qr = await get('/delivery-live/qr'); }
    if (!qr) { b.innerHTML = window.HX.empty('Rider QR not available', 'Check that the Delivery feature is switched on.'); return; }
    const tk = qr.token || ''; const url = tk ? location.origin + '/rider.html?t=' + encodeURIComponent(tk) : qr.url;
    b.innerHTML = `<div class="lb-qr"><div class="box" id="qrb"></div><div style="flex:1;min-width:240px"><h2 style="margin:0 0 6px">Rider app QR code</h2><p class="hx-sub">Riders scan this with their phone camera, sign in with their phone and password (or employee code and PIN), then add the app to their Home Screen.</p><p style="word-break:break-all;margin:10px 0"><a href="${E(url)}" target="_blank" rel="noopener">${E(url)}</a></p>
      <div class="hx-actions"><button class="btn btn-secondary" id="cp">Copy link</button><button class="btn btn-secondary" id="pr">Print</button><button class="btn btn-secondary" id="rot">Replace QR</button></div><small class="hx-sub">Replacing the QR makes every printed copy stop working. Riders must have the Delivery rider role to sign in.</small></div></div>`;
    b.querySelector('#qrb').innerHTML = window.QREncoder ? window.QREncoder.toSvg(url, { ecl: 'M', border: 1 }) : '';
    b.querySelector('#cp').onclick = () => { navigator.clipboard && navigator.clipboard.writeText(url); window.UI.toast.success('Link copied'); };
    b.querySelector('#pr').onclick = () => { const w = window.open('', '_blank'); if (!w) return window.UI.toast.warning('Allow pop-ups to print'); w.document.write(`<body style="font-family:sans-serif;text-align:center;padding:40px"><h1>${E(qr.businessName || '')}</h1><h2 style="color:#F26A21">Rider delivery app</h2><div style="width:320px;margin:20px auto">${window.QREncoder ? window.QREncoder.toSvg(url, { ecl: 'M', border: 1 }) : ''}</div><p style="font-size:18px">Scan to sign in and start delivering</p></body>`); w.document.close(); w.focus(); setTimeout(() => w.print(), 400); };
    b.querySelector('#rot').onclick = async () => { if (!confirm('Every printed rider QR will stop working. Continue?')) return; const r = await send('post', '/delivery-live/qr/rotate'); if (r) { qr = r; paintQr(b); } };
  }
})();
