/* Restaurant + Accommodation workspace. Hash-routed, mode-aware (RESTAURANT / ACCOMMODATION / BOTH). */
(function () {
  const { Api, UI, Storage } = window, E = UI.escapeHtml, M = UI.formatMoney, $ = (s, r = document) => r.querySelector(s);
  const S = { mode: 'RESTAURANT', branch: null, user: Storage.getUser(), timer: null };
  const ROLE_SECTIONS = { // which sections each role sees (backend still enforces every permission)
    WAITER: ['floor', 'orders', 'shifts', 'guest', 'tips'], DELIVERY_RIDER: ['delivery', 'shifts'], HEAD_WAITER: ['floor', 'orders', 'kitchen', 'resv', 'shifts', 'guest', 'delivery', 'tips'], CHEF: ['kitchen', 'stock', 'recipes', 'shifts'], KITCHEN_STAFF: ['kitchen'], BARTENDER: ['kitchen'], EXPEDITOR: ['kitchen'],
    RECEPTIONIST: ['rooms', 'stays', 'guest', 'reports'], HOUSEKEEPER: ['rooms'], CASHIER: ['floor', 'orders', 'rooms', 'stays', 'resv', 'guest'], STOREKEEPER: ['stock'],
  };
  const NAV = [['home', 'Home', 'both'], ['sep', 'Restaurant', 'R'], ['floor', 'Tables', 'R'], ['kitchen', 'Kitchen', 'R'], ['resv', 'Reservations', 'R'], ['stock', 'Ingredients & stock', 'R'], ['recipes', 'Recipes', 'R'], ['delivery', 'Delivery', 'R'], ['tips', 'Tips', 'R'], ['shifts', 'Staff shifts', 'R'], ['sep', 'Accommodation', 'A'], ['rooms', 'Room board', 'A'], ['stays', 'Bookings', 'A'], ['roomsetup', 'Room setup', 'A'], ['sep', 'Manage', 'both'], ['guest', 'Guest requests & QR', 'both'], ['reports', 'Reports', 'both'], ['menu', 'Menu', 'R'], ['tables', 'Table setup', 'R'], ['stations', 'Kitchen stations', 'R'], ['settings', 'Settings', 'both']];
  const showR = () => S.mode !== 'ACCOMMODATION', showA = () => S.mode !== 'RESTAURANT';
  const allowed = (id) => { const r = S.user && S.user.role; if (!r || ['OWNER', 'ADMIN', 'MANAGER', 'SUPERVISOR'].includes(r)) return true; return id === 'home' || (ROLE_SECTIONS[r] || []).includes(id) || (id === 'floor' && !ROLE_SECTIONS[r]); };
  const api = async (fn) => { try { return await fn(); } catch (e) { UI.toast.error(e.message || 'Something went wrong'); throw e; } };
  const list = (d) => Array.isArray(d) ? d : (d && (d.items || Object.values(d).find(Array.isArray))) || [];
  /** Fetch every page (backend caps a page at 100). */
  const all = async (path, query = {}, max = 10) => { let out = [], page = 1, pages = 1; do { const { data } = await Api.get(path, { ...query, limit: 100, page }); out = out.concat(list(data)); pages = data.pages || 1; page++; } while (page <= pages && page <= max); return out; };
  const money = (n) => M(n || 0);

  async function boot() {
    if (!Storage.isAuthenticated()) { location.href = '../login.html'; return; }
    let fs = {}; try { const { data } = await Api.get('/business/profile'); S.profile = data.profile; fs = (data.profile && data.profile.featureSettings) || {}; } catch (e) { /* keep default */ }
    if (fs.accommodation && fs.restaurantOrdering === false) S.mode = 'ACCOMMODATION';
    try { const { data } = await Api.get('/restaurant/settings'); S.settings = data.settings; S.mode = (data.settings && data.settings.serviceMode) || S.mode; } catch (e) { /* module off: keep the mode from the profile */ }
    if (S.mode === 'RESTAURANT' && fs.accommodation && !S.settings) S.mode = 'ACCOMMODATION';
    S.branch = Storage.getActiveBranchId() || (S.user && (S.user.branchId || (S.user.branchIds || [])[0]));
    if (!S.branch) { try { const { data } = await Api.get('/branches'); const b = list(data.branches || data)[0]; S.branch = b && b._id; Storage.setActiveBranchId(S.branch); } catch (e) { /* ignore */ } }
    shell(); window.addEventListener('hashchange', route); route();
  }
  function shell() {
    $('#app').innerHTML = `<aside class="hx-rail"><div class="hx-brand">${E((S.profile && S.profile.name) || 'Hospitality')}<small>${{ RESTAURANT: 'Restaurant', ACCOMMODATION: 'Rooms & stays', BOTH: 'Restaurant + Rooms' }[S.mode]}</small></div>
      <nav class="hx-nav">${NAV.filter(([id, , m]) => (m === 'both' || (m === 'R' && showR()) || (m === 'A' && showA())) && (id === 'sep' || allowed(id))).map(([id, l]) => id === 'sep' ? `<div class="sep">${l}</div>` : `<a href="#/${id}" data-id="${id}">${l}</a>`).join('')}</nav>
      <div class="hx-foot"><b>${E(S.user && S.user.name || '')}</b><br><small>${E(S.user && S.user.role || '')}</small><br><a href="../dashboard.html">POS</a><a id="out">Sign out</a></div></aside>
      <main class="hx-main"><div class="hx-top"><h1 id="ttl"></h1><span id="upd" class="text-sm text-muted"></span></div><div class="hx-pg" id="pg"></div></main>`;
    $('#out').onclick = () => { Storage.clearSession(); location.href = '../login.html'; };
  }
  function route() {
    clearInterval(S.timer); const [, id = 'home', arg] = (location.hash || '#/home').split('/'); const fn = V[id] || V.home;
    document.querySelectorAll('.hx-nav a').forEach((a) => a.classList.toggle('on', a.dataset.id === id));
    $('#ttl').textContent = (NAV.find((n) => n[0] === id) || [, 'Home'])[1]; $('#pg').innerHTML = '<p class="text-muted">Loading…</p>';
    const run = async () => { try { await fn($('#pg'), arg); $('#upd').textContent = 'Updated ' + new Date().toLocaleTimeString(); } catch (e) { $('#pg').innerHTML = UI.emptyStateHtml({ icon: 'alert', title: 'Could not load', message: e.message }); } };
    run(); if (V[id] && V[id].live) S.timer = setInterval(run, V[id].live);
  }
  const kpi = (items) => `<div class="hx-kpi">${items.map(([l, v]) => `<div class="hx-card"><span>${l}</span><b>${v}</b></div>`).join('')}</div>`;
  const V = {};

  /* ---------- Home ---------- */
  V.home = async (pg) => {
    let h = ''; const q = { branchId: S.branch };
    if (showR()) { try { const { data } = await Api.get('/restaurant/reports/dashboard', q); const d = data.dashboard || data; h += `<h3>Restaurant today</h3>` + kpi([['Revenue today', money((d.today || d).revenue)], ['Orders today', (d.today || d).orders ?? 0], ['Open orders', Array.isArray(d.openOrders) ? d.openOrders.length : (d.openOrders ?? 0)], ['In kitchen', Array.isArray(d.kitchenQueue) ? d.kitchenQueue.length : (d.kitchenQueue ?? 0)]]); } catch (e) { /* no permission */ } }
    if (showA()) { try { const { data } = await Api.get('/accommodation/board', q); const s = data.summary || {}; h += `<h3>Rooms today</h3>` + kpi([['Occupied', s.occupied ?? 0], ['Vacant & ready', s.vacantReady ?? 0], ['Needs cleaning', s.vacantDirty ?? 0], ['Out of order', s.outOfOrder ?? 0]]); } catch (e) { /* no permission */ } }
    h += `<div class="hx-grid w">${[showR() && ['#/floor', 'Take an order', 'Open a table and send it to the kitchen'], showR() && ['#/kitchen', 'Kitchen screen', 'See and bump tickets'], showA() && ['#/rooms', 'Room board', 'Occupancy and housekeeping'], showA() && ['#/stays', 'Bookings', 'Reserve, check in and check out']].filter(Boolean).map(([u, t, d]) => `<a class="hx-tile" href="${u}"><h3>${t}</h3><small>${d}</small></a>`).join('')}</div>`;
    pg.innerHTML = h;
  };

  /* ---------- Tables + order ---------- */
  V.floor = async (pg, orderId) => {
    if (orderId) return orderScreen(pg, orderId);
    const { data } = await Api.get('/restaurant/tables', { branchId: S.branch }); const t = list(data.tables);
    pg.innerHTML = (t.length ? `<div class="hx-grid">${t.map((x) => `<button class="hx-tile s-${x.status}" data-id="${x._id}" data-o="${x.order ? x.order._id : ''}"><h3>${E(x.name)}</h3><small>${x.seats || ''} seats</small><br><span class="hx-chip">${E(x.status.replace('_', ' '))}</span>${x.order ? `<br><small>${money(x.order.total)} · ${x.order.readyItems ? x.order.readyItems + ' ready!' : (x.occupiedMinutes ?? 0) + ' min'}</small>` : ''}</button>`).join('')}</div>` : UI.emptyStateHtml({ icon: 'store', title: 'No tables yet', message: 'Add tables in the restaurant setup.' }));
    pg.querySelectorAll('.hx-tile').forEach((b) => b.onclick = () => api(async () => {
      let id = b.dataset.o; if (!id) { const g = prompt('How many guests?', '2'); if (g === null) return; const r = await Api.post('/restaurant/orders', { branchId: S.branch, tableId: b.dataset.id, orderType: 'DINE_IN', guestCount: +g || 1 }); id = r.data.order._id; }
      location.hash = '#/floor/' + id; }));
  }; V.floor.live = 15000;
  async function orderScreen(pg, id) {
    clearInterval(S.timer); const [{ data: o }, { data: m }] = await Promise.all([Api.get('/restaurant/orders/' + id), Api.get('/restaurant/menu', { branchId: S.branch })]);
    const order = o.order, cats = m.categories || []; let cur = 0;
    const draw = () => {
      pg.innerHTML = `<div class="hx-split"><div><div class="hx-cats">${cats.map((c, i) => `<button class="btn ${i === cur ? 'btn-primary' : 'btn-secondary'}" data-c="${i}">${E(c.name)}</button>`).join('')}</div>
        <div class="hx-menu">${(cats[cur] ? cats[cur].items : []).map((i) => `<button class="hx-card" data-m="${i._id}" ${i.available === false ? 'disabled' : ''}>${i.image ? `<img src="${E(i.image)}" alt="" style="width:100%;height:70px;object-fit:cover;border-radius:10px;margin-bottom:6px">` : ''}<b>${E(i.name)}</b><br><small>${money(i.effectivePrice ?? i.price)}</small>${i.available === false ? '<br><span class="hx-chip">Sold out</span>' : ''}</button>`).join('')}</div></div>
        <div class="hx-card hx-cart"><h3>${E(order.tableName || order.orderNumber)} <small class="text-muted">${E(order.orderNumber)}</small></h3>
        ${order.items.filter((i) => i.status !== 'CANCELLED').map((i) => `<div class="hx-item"><span>${i.quantity}× ${E(i.name)}<br><small class="text-muted">${E(i.status)}</small></span><span>${money(i.unitPrice * i.quantity)}${i.status === 'READY' ? ` <button class="btn btn-sm btn-success" data-serve="${i._id}">Serve</button>` : ''}</span></div>`).join('') || '<p class="text-muted">Tap a dish to add it.</p>'}
        <h3 style="display:flex;justify-content:space-between"><span>Total</span><span>${money(order.totals && order.totals.total)}</span></h3>
        <div style="display:grid;gap:8px"><button class="btn btn-secondary" id="send">Send to kitchen</button><button class="btn btn-primary btn-lg" id="bill">Bill &amp; pay</button><a class="btn btn-secondary" href="#/floor">Back to tables</a></div></div></div>`;
      pg.querySelectorAll('[data-c]').forEach((b) => b.onclick = () => { cur = +b.dataset.c; draw(); });
      pg.querySelectorAll('[data-m]').forEach((b) => b.onclick = () => api(async () => { const r = await Api.post(`/restaurant/orders/${id}/items`, { items: [{ menuItemId: b.dataset.m, quantity: 1 }] }); Object.assign(order, r.data.order || {}); if (!r.data.order) return reload(); draw(); }));
      pg.querySelectorAll('[data-serve]').forEach((b) => b.onclick = () => api(async () => { await Api.post(`/restaurant/orders/${id}/serve`, { itemIds: [b.dataset.serve] }); reload(); }));
      $('#send').onclick = () => api(async () => { await Api.post(`/restaurant/orders/${id}/send`, {}); UI.toast.success('Sent to the kitchen'); reload(); });
      $('#bill').onclick = () => api(() => payScreen(id));
    }; const reload = () => orderScreen(pg, id); draw();
  }
  async function payScreen(orderId) {
    const r = await Api.post(`/restaurant/orders/${orderId}/bills`, {}); const bill = r.data.bill || r.data; const due = bill.balance ?? bill.total;
    const mod = UI.openModal({ title: 'Payment · ' + (bill.billNumber || ''), bodyHtml: `<h2>${money(due)}</h2><div class="field"><label>Method</label><select class="select" id="pm"><option>CASH</option><option>MPESA</option><option>CARD</option><option>MOBILE_MONEY</option><option>BANK</option>${showA() ? '<option value="ROOM">Charge to room</option>' : ''}</select></div><div class="field"><label>Cash given / reference</label><input class="input" id="pr" placeholder="Amount tendered or M-PESA code"></div>`, footerHtml: '<button class="btn btn-primary" id="pay">Confirm payment</button>' });
    $('#pay', mod).onclick = () => api(async () => { const m = $('#pm', mod).value, v = $('#pr', mod).value.trim(); const p = { method: m, amount: due }; if (m === 'CASH' && +v) p.tendered = +v; else if (v) p.reference = v;
      await Api.post(`/restaurant/bills/${bill._id}/pay`, { payments: [p] }); UI.closeModal(); UI.toast.success('Paid'); location.hash = '#/floor'; });
  }

  /* ---------- Kitchen ---------- */
  V.kitchen = async (pg) => {
    const { data } = await Api.get('/restaurant/kitchen/queue', { branchId: S.branch }); const t = list(data);
    pg.innerHTML = t.length ? `<div class="hx-grid w">${t.map((k) => `<div class="hx-card hx-tk ${k.overdue ? 'overdue' : ''} ${k.status}"><div style="display:flex;justify-content:space-between"><b>#${E(k.ticketNumber || '')} ${E(k.tableName || k.orderNumber || '')}</b><span class="hx-chip">${E(k.status)}</span></div><small class="${k.overdue ? 'text-danger' : 'text-muted'}">${k.ageMinutes} min ${k.overdue ? '· LATE' : ''}</small>${(k.items || []).filter((i) => !i.cancelled).map((i) => `<div class="hx-item"><span><b>${i.quantity}×</b> ${E(i.name)}${i.notes ? `<br><small>${E(i.notes)}</small>` : ''}</span></div>`).join('')}<button class="btn btn-primary" style="width:100%;margin-top:10px" data-b="${k._id}" data-s="${k.status}">${{ NEW: 'Accept', ACCEPTED: 'Start cooking', PREPARING: 'Mark ready', READY: 'Collected' }[k.status] || 'Next'}</button></div>`).join('')}</div>` : UI.emptyStateHtml({ icon: 'check', title: 'Kitchen is clear', message: 'New orders appear here automatically.' });
    pg.querySelectorAll('[data-b]').forEach((b) => b.onclick = () => api(async () => { const nx = { NEW: 'ACCEPTED', ACCEPTED: 'PREPARING', PREPARING: 'READY' }[b.dataset.s]; if (nx) await Api.post(`/restaurant/kitchen/tickets/${b.dataset.b}/bump`, { status: nx }); else await Api.post(`/restaurant/kitchen/tickets/${b.dataset.b}/expo`, {}); V.kitchen(pg); }));
  }; V.kitchen.live = 8000;

  /* ---------- Rooms ---------- */
  V.rooms = async (pg) => {
    const { data } = await Api.get('/accommodation/board', { branchId: S.branch }); const s = data.summary || {};
    pg.innerHTML = kpi([['Occupied', s.occupied || 0], ['Vacant ready', s.vacantReady || 0], ['Dirty', s.vacantDirty || 0], ['Out of order', s.outOfOrder || 0]]) + `<div class="hx-grid">${list(data.rooms).map((r) => `<button class="hx-tile s-${r.inHouse ? 'occ' : r.status === 'OUT_OF_ORDER' ? 'OUT_OF_ORDER' : r.housekeeping}" data-r="${r._id}"><h3>${E(r.number)}</h3><small>${E(r.roomType || '')}</small><br>${r.inHouse ? `<b>${E(r.inHouse.guest && r.inHouse.guest.name || 'Guest')}</b>${r.dueOutToday ? '<br><span class="hx-chip">Due out</span>' : ''}` : `<span class="hx-chip">${E(r.housekeeping)}</span>`}${r.arrivingToday ? '<br><span class="hx-chip">Arrival today</span>' : ''}</button>`).join('')}</div>`;
    pg.querySelectorAll('[data-r]').forEach((b) => b.onclick = () => { const room = list(data.rooms).find((x) => x._id === b.dataset.r);
      const m = UI.openModal({ title: 'Room ' + room.number, bodyHtml: `<p>${E(room.roomType || '')} · ${E(room.status)} · ${E(room.housekeeping)}</p><div style="display:grid;gap:8px">${['DIRTY', 'CLEANING', 'CLEAN', 'INSPECTED'].map((x) => `<button class="btn btn-secondary" data-hk="${x}">Mark ${x.toLowerCase()}</button>`).join('')}${room.inHouse ? `<a class="btn btn-primary" href="#/stays">Open stay</a>` : ''}</div>` });
      m.querySelectorAll('[data-hk]').forEach((x) => x.onclick = () => api(async () => { await Api.post(`/accommodation/rooms/${room._id}/housekeeping`, { housekeeping: x.dataset.hk }); UI.closeModal(); V.rooms(pg); })); });
  }; V.rooms.live = 30000;

  /* ---------- Bookings / stays ---------- */
  V.stays = async (pg) => {
    const { data } = await Api.get('/accommodation/stays', { branchId: S.branch, limit: 50 }); const st = list(data);
    pg.innerHTML = `<div style="display:flex;justify-content:flex-end;margin-bottom:12px"><button class="btn btn-primary" id="nb">New booking</button></div>` + (st.length ? `<div class="hx-card" style="padding:0;overflow:auto"><table class="table"><thead><tr><th>Guest</th><th>Room</th><th>Dates</th><th>Status</th><th></th></tr></thead><tbody>${st.map((s) => `<tr><td><b>${E(s.guest && s.guest.name)}</b><br><small>${E(s.bookingCode || '')}</small></td><td>${E(s.roomNumber || '')}</td><td>${E(s.checkInDate)} → ${E(s.checkOutDate)}</td><td><span class="hx-chip">${E(s.status.replace('_', ' '))}</span></td><td><button class="btn btn-sm btn-secondary" data-fo="${s._id}">Folio</button> ${s.status === 'RESERVED' ? `<button class="btn btn-sm btn-primary" data-ci="${s._id}">Check in</button>` : s.status === 'CHECKED_IN' ? `<button class="btn btn-sm btn-primary" data-co="${s._id}">Check out</button>` : ''}</td></tr>`).join('')}</tbody></table></div>` : UI.emptyStateHtml({ icon: 'store', title: 'No bookings', message: 'Create the first booking.' }));
    $('#nb').onclick = () => newBooking(() => V.stays(pg));
    pg.querySelectorAll('[data-fo]').forEach((b) => b.onclick = () => window.HX.folio(b.dataset.fo, () => V.stays(pg)));
    pg.querySelectorAll('[data-ci]').forEach((b) => b.onclick = () => api(async () => { await Api.post(`/accommodation/stays/${b.dataset.ci}/check-in`, {}); UI.toast.success('Checked in'); V.stays(pg); }));
    pg.querySelectorAll('[data-co]').forEach((b) => b.onclick = () => api(async () => {
      const [{ data: sd }, { data: q }] = await Promise.all([Api.get(`/accommodation/stays/${b.dataset.co}`), Api.get(`/accommodation/stays/${b.dataset.co}/checkout-quote`)]);
      const sum = (a) => (a || []).reduce((t, l) => t + (l.total || 0), 0); const bal = Math.max(0, ((sd.stay || sd).totals || {}).balance + sum((q.quote || q).adds) - sum((q.quote || q).voids));
      const m = UI.openModal({ title: 'Check out', bodyHtml: `<h2>Balance ${money(bal)}</h2><p class="text-muted">Includes any late check-out or other fees due now.</p><div class="field"><label>Method</label><select class="select" id="cm"><option>CASH</option><option>MPESA</option><option>CARD</option><option>BANK</option></select></div><div class="field"><label>Amount received</label><input class="input" id="ca" type="number" value="${bal}"></div>`, footerHtml: '<button class="btn btn-primary" id="go">Pay & check out</button>' });
      $('#go', m).onclick = () => api(async () => { await Api.post(`/accommodation/stays/${b.dataset.co}/check-out`, +$('#ca', m).value > 0 ? { payments: [{ method: $('#cm', m).value, amount: +$('#ca', m).value }] } : {}); UI.closeModal(); UI.toast.success('Checked out'); V.stays(pg); }); }));
  };
  async function newBooking(done) {
    const today = new Date().toISOString().slice(0, 10), tm = new Date(Date.now() + 864e5).toISOString().slice(0, 10);
    const m = UI.openModal({ title: 'New booking', bodyHtml: `<div class="field"><label>Guest name</label><input class="input" id="gn"></div><div class="field"><label>Phone</label><input class="input" id="gp"></div><div style="display:grid;grid-template-columns:1fr 1fr;gap:10px"><div class="field"><label>Check-in</label><input type="date" class="input" id="d1" value="${today}"></div><div class="field"><label>Check-out</label><input type="date" class="input" id="d2" value="${tm}"></div></div><button class="btn btn-secondary" id="av">Find free rooms</button><div id="rl" style="margin-top:10px;display:grid;gap:8px"></div>` });
    $('#av', m).onclick = () => api(async () => { const { data } = await Api.get('/accommodation/availability', { branchId: S.branch, checkInDate: $('#d1', m).value, checkOutDate: $('#d2', m).value });
      $('#rl', m).innerHTML = list(data.rooms).map((r) => `<button class="btn btn-secondary" data-rm="${r.roomId}">Room ${E(r.number)} · ${E(r.roomType)} · ${money(r.quote && r.quote.total)}</button>`).join('') || '<p class="text-muted">No free rooms for those dates.</p>';
      m.querySelectorAll('[data-rm]').forEach((b) => b.onclick = () => api(async () => { const name = $('#gn', m).value.trim(); if (!name) return UI.toast.warning('Enter the guest name');
        await Api.post('/accommodation/stays', { branchId: S.branch, roomId: b.dataset.rm, checkInDate: $('#d1', m).value, checkOutDate: $('#d2', m).value, guest: { name, phone: $('#gp', m).value.trim() || undefined } }, { idempotencyKey: Api.newIdempotencyKey() }); UI.closeModal(); UI.toast.success('Booking created'); done(); })); });
  }

  /* ---------- Settings: the owner chooses restaurant / rooms / both ---------- */
  V.settings = async (pg) => {
    const opts = [['RESTAURANT', 'Restaurant only', 'Tables, kitchen, menu and bills.'], ['ACCOMMODATION', 'Accommodation only', 'Rooms, bookings, folios. Guests order food to their room.'], ['BOTH', 'Restaurant + accommodation', 'Everything, with room charges on the bill.']];
    pg.innerHTML = `<div class="hx-card"><h3>What does this business offer?</h3><p class="text-muted">You can change this any time. Nothing is deleted when you switch.</p><div class="hx-seg">${opts.map(([k, t, d]) => `<button data-k="${k}" class="${S.mode === k ? 'on' : ''}"><b>${t}</b><br><small>${d}</small></button>`).join('')}</div></div>`;
    pg.querySelectorAll('[data-k]').forEach((b) => b.onclick = () => api(async () => { await Api.put('/restaurant/settings', { serviceMode: b.dataset.k }); S.mode = b.dataset.k; UI.toast.success('Saved'); shell(); route(); }));
  };
  window.HX = { V, S, api, list, all, money, kpi, E, $, route, shell };
  window.HX.ready = new Promise((r) => { window.HX._r = r; });
  document.addEventListener('DOMContentLoaded', boot);
})();
