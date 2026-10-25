/* Setup, reservations, stock, shifts, reports, guest QR and folio screens. Registers into HX.V. */
(function () {
  const { V, S, api, list, all, money, kpi, E, $ } = window.HX, { Api, UI } = window, q = () => ({ branchId: S.branch });
  const num = (v) => (v === '' || v == null ? undefined : +v);
  /** Generic modal form. fields: [name,label,type|options[],default]. Resolves values to submit(v). */
  function form(title, fields, submit, btn = 'Save') {
    const body = fields.map(([n, l, t = 'text', d = '']) => `<div class="field"><label>${l}</label>${Array.isArray(t) ? `<select class="select" name="${n}">${t.map((o) => `<option value="${E(o.v ?? o)}">${E(o.l ?? o)}</option>`).join('')}</select>` : t === 'file' ? `<input class="input" name="${n}" type="file" accept="image/jpeg,image/png,image/webp" multiple>` : `<input class="input" name="${n}" type="${t}" value="${E(d)}">`}</div>`).join('');
    const m = UI.openModal({ title, bodyHtml: `<form id="hf">${body}</form>`, footerHtml: `<button class="btn btn-primary" id="hs">${btn}</button>` });
    $('#hs', m).onclick = () => api(async () => { const v = {}; m.querySelectorAll('[name]').forEach((e) => { if (e.type === 'file') { const fs = [...e.files].filter((f) => f.size <= 5 * 1024 * 1024).slice(0, 8); if (fs.length) v[e.name] = fs; } else if (e.value !== '') v[e.name] = e.value; }); await submit(v); UI.closeModal(); });
  }
  /** Photos are uploaded first and come back as links, so they are saved together with the room type in one step. */
  const uploadPhotos = async (files) => { if (!files || !files.length) return []; const fd = new FormData(); files.forEach((f) => fd.append('images', f)); const { data } = await Api.upload('/accommodation/images', fd); return (data && data.urls) || []; };
  const table = (cols, rows) => rows.length ? `<div class="hx-card" style="padding:0;overflow:auto"><table class="table"><thead><tr>${cols.map((c) => `<th>${c}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>` : UI.emptyStateHtml({ title: 'Nothing here yet' });
  const head = (t, btn, id) => `<div style="display:flex;justify-content:space-between;align-items:center;margin:0 0 12px"><h3 style="margin:0">${t}</h3>${btn ? `<button class="btn btn-primary" id="${id}">${btn}</button>` : ''}</div>`;
  const ymd = (d = 0) => new Date(Date.now() + d * 864e5).toISOString().slice(0, 10);

  /* ---------- Table setup ---------- */
  V.tables = async (pg) => {
    const [{ data: a }, { data: t }] = await Promise.all([Api.get('/restaurant/areas', q()), Api.get('/restaurant/tables', q())]);
    const areas = list(a.areas), tbl = list(t.tables);
    pg.innerHTML = head('Areas', 'Add area', 'aa') + `<p>${areas.map((x) => `<span class="hx-chip">${E(x.name)}</span> `).join('') || '<span class="text-muted">No areas yet (e.g. Main hall, Patio, Bar).</span>'}</p>` + head('Tables', 'Add table', 'at') +
      table(['Table', 'Seats', 'Area', ''], tbl.map((x) => [`<b>${E(x.name)}</b>`, x.seats || '', E(x.areaId && x.areaId.name || '-'), `<button class="btn btn-sm btn-secondary" data-e="${x._id}">Edit</button>`]));
    $('#aa').onclick = () => form('Add area', [['name', 'Name'], ['type', 'Type', ['INDOOR', 'OUTDOOR', 'BAR', 'VIP', 'PRIVATE']]], async (v) => { await Api.post('/restaurant/areas', { ...v, branchId: S.branch }); V.tables(pg); });
    $('#at').onclick = () => form('Add table', [['name', 'Table name / number'], ['seats', 'Seats', 'number', 4], ['areaId', 'Area', [{ v: '', l: 'No area' }, ...areas.map((x) => ({ v: x._id, l: x.name }))]]], async (v) => { await Api.post('/restaurant/tables', { ...v, seats: num(v.seats), branchId: S.branch }); V.tables(pg); });
    pg.querySelectorAll('[data-e]').forEach((b) => b.onclick = () => { const x = tbl.find((y) => y._id === b.dataset.e); form('Edit table', [['name', 'Name', 'text', x.name], ['seats', 'Seats', 'number', x.seats]], async (v) => { await Api.put('/restaurant/tables/' + x._id, { ...v, seats: num(v.seats) }); V.tables(pg); }); });
  };

  /* ---------- Menu ---------- */
  V.menu = async (pg) => {
    const [items0, cats] = await Promise.all([all('/restaurant/menu/items'), Api.get('/categories', { limit: 100 }).catch(() => ({ data: {} }))]);
    const items = items0, cl = list(cats.data.categories || cats.data);
    pg.innerHTML = head('Menu items', 'Add dish', 'ad') + table(['Dish', 'Price', 'Prep', 'Available', ''], items.map((i) => [`<b>${E(i.name)}</b><br><small>${E(i.description || '')}</small>`, money(i.basePrice), (i.prepMinutes || 0) + ' min', (i.soldOut && i.soldOut.flag) ? '<span class="hx-chip">Sold out</span>' : '<span class="hx-chip" style="background:#e4f6ec">On menu</span>', `<button class="btn btn-sm btn-secondary" data-so="${i._id}" data-v="${i.soldOut && i.soldOut.flag ? 0 : 1}">${i.soldOut && i.soldOut.flag ? 'Back on' : 'Sold out'}</button> <button class="btn btn-sm btn-secondary" data-ed="${i._id}">Edit</button>`]));
    const f = (x = {}) => [['name', 'Dish name', 'text', x.name || ''], ['basePrice', 'Price', 'number', x.basePrice ?? ''], ['prepMinutes', 'Prep minutes', 'number', x.prepMinutes ?? 10], ['description', 'Description', 'text', x.description || ''], ['categoryId', 'Category', [{ v: '', l: 'No category' }, ...cl.map((c) => ({ v: c._id, l: c.name }))]]];
    const pack = (v) => ({ ...v, basePrice: num(v.basePrice), prepMinutes: num(v.prepMinutes) });
    $('#ad').onclick = () => form('Add dish', f(), async (v) => { await Api.post('/restaurant/menu/items', pack(v)); V.menu(pg); });
    pg.querySelectorAll('[data-so]').forEach((b) => b.onclick = () => api(async () => { await Api.post(`/restaurant/menu/items/${b.dataset.so}/sold-out`, { soldOut: b.dataset.v === '1' }); V.menu(pg); }));
    pg.querySelectorAll('[data-ed]').forEach((b) => b.onclick = () => form('Edit dish', f(items.find((i) => i._id === b.dataset.ed)), async (v) => { await Api.put('/restaurant/menu/items/' + b.dataset.ed, pack(v)); V.menu(pg); }));
  };

  /* ---------- Room setup ---------- */
  V.roomsetup = async (pg) => {
    const { data } = await Api.get('/accommodation/room-types', { all: 'true' }); const types = list(data.roomTypes);
    pg.innerHTML = head('Room types', 'Add room type', 'ar') + table(['Type', 'Nightly rate', 'Sleeps', ''], types.map((t) => [`<b>${E(t.name)}</b><br><small>${E(t.bedConfig || '')}</small>`, money(t.baseRate), (t.maxAdults || 2) + ' adults', `<button class="btn btn-sm btn-secondary" data-ed="${t._id}">Edit</button>`])) +
      `<div style="margin:18px 0 12px">${head('Rooms', 'Add rooms', 'ab')}<p class="text-muted">Add many at once, e.g. 101, 102, 103. They appear on the room board.</p></div>`;
    const f = (x = {}) => [['name', 'Name', 'text', x.name || ''], ['baseRate', 'Base rate per night', 'number', x.baseRate ?? ''], ['weekendRate', 'Weekend rate (optional)', 'number', x.weekendRate ?? ''], ['maxAdults', 'Max adults', 'number', x.maxAdults || 2], ['bedConfig', 'Beds', 'text', x.bedConfig || '']];
    const pack = (v) => { const { images, ...rest } = v; return { ...rest, baseRate: num(v.baseRate), weekendRate: num(v.weekendRate), maxAdults: num(v.maxAdults) }; };
    $('#ar').onclick = () => form('Add room type', [...f(), ['images', 'Room photos (optional)', 'file']], async (v) => { const urls = await uploadPhotos(v.images); await Api.post('/accommodation/room-types', { ...pack(v), ...(urls.length ? { images: urls } : {}) }); V.roomsetup(pg); });
    pg.querySelectorAll('[data-ed]').forEach((b) => b.onclick = () => form('Edit room type', f(types.find((t) => t._id === b.dataset.ed)), async (v) => { await Api.put('/accommodation/room-types/' + b.dataset.ed, pack(v)); V.roomsetup(pg); }));
    $('#ab').onclick = () => { if (!types.length) return UI.toast.warning('Add a room type first'); form('Add rooms', [['roomTypeId', 'Room type', types.map((t) => ({ v: t._id, l: t.name }))], ['numbers', 'Room numbers (comma separated)'], ['floor', 'Floor'], ['images', 'Room photos (optional)', 'file']], async (v) => { const urls = await uploadPhotos(v.images); await Api.post('/accommodation/rooms/bulk', { branchId: S.branch, roomTypeId: v.roomTypeId, floor: v.floor, numbers: v.numbers.split(',').map((x) => x.trim()).filter(Boolean), ...(urls.length ? { images: urls } : {}) }); UI.toast.success('Rooms added'); }); };
  };

  /* ---------- Reservations ---------- */
  V.resv = async (pg) => {
    const { data } = await Api.get('/restaurant/reservations', { branchId: S.branch, limit: 50 }); const r = list(data.reservations || data);
    pg.innerHTML = head('Reservations', 'New reservation', 'nr') + table(['Guest', 'Party', 'When', 'Status', ''], r.map((x) => [`<b>${E(x.guestName)}</b><br><small>${E(x.phone || '')}</small>`, x.partySize, UI.formatDateTime(x.startsAt), `<span class="hx-chip">${E(x.status)}</span>`, ['BOOKED', 'CONFIRMED'].includes(x.status) ? `<button class="btn btn-sm btn-primary" data-s="ARRIVED" data-i="${x._id}">Arrived</button> <button class="btn btn-sm btn-secondary" data-s="NO_SHOW" data-i="${x._id}">No-show</button> <button class="btn btn-sm btn-secondary" data-s="CANCELLED" data-i="${x._id}">Cancel</button>` : '']));
    $('#nr').onclick = () => form('New reservation', [['guestName', 'Guest name'], ['phone', 'Phone', 'tel'], ['partySize', 'Party size', 'number', 2], ['date', 'Date', 'date', ymd()], ['time', 'Time', 'time', '19:00'], ['occasion', 'Occasion'], ['notes', 'Notes']], async (v) => { const d = new Date(`${v.date}T${v.time || '19:00'}`); await Api.post('/restaurant/reservations', { branchId: S.branch, guestName: v.guestName, phone: v.phone, partySize: num(v.partySize), startsAt: d.toISOString(), occasion: v.occasion, notes: v.notes, source: 'STAFF' }); V.resv(pg); });
    pg.querySelectorAll('[data-s]').forEach((b) => b.onclick = () => api(async () => { await Api.post(`/restaurant/reservations/${b.dataset.i}/status`, { status: b.dataset.s }); V.resv(pg); }));
  };

  /* ---------- Ingredients & stock ---------- */
  V.stock = async (pg) => {
    const rows = await all('/restaurant/ingredients/stock', { branchId: S.branch });
    pg.innerHTML = head('Ingredient stock', 'New ingredient', 'ni') + `<div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap"><button class="btn btn-secondary" id="rc">Receive stock</button><button class="btn btn-secondary" id="ws">Record waste</button></div>` +
      table(['Ingredient', 'On hand', 'Reorder at', 'Status'], rows.map((s) => { const n = s.name || (s.ingredient && s.ingredient.name) || s.ingredientName; const qty = s.quantity ?? s.onHand ?? s.total ?? 0; const low = s.low || (s.lowStockLevel != null && qty <= s.lowStockLevel); return [`<b>${E(n)}</b>`, `${qty} ${E(s.baseUnit || s.unit || '')}`, s.reorderLevel ?? s.lowStockLevel ?? '-', low ? '<span class="hx-chip" style="background:#fde8e8">Low</span>' : '<span class="hx-chip" style="background:#e4f6ec">OK</span>']; }));
    const ing = () => all('/restaurant/ingredients');
    $('#ni').onclick = () => form('New ingredient', [['name', 'Name'], ['baseUnit', 'Measured in', ['g', 'ml', 'piece']], ['lowStockLevel', 'Low stock level', 'number'], ['reorderLevel', 'Reorder level', 'number']], async (v) => { await Api.post('/restaurant/ingredients', { ...v, lowStockLevel: num(v.lowStockLevel), reorderLevel: num(v.reorderLevel) }); V.stock(pg); });
    const pick = async () => (await ing()).map((i) => ({ v: i._id, l: i.name }));
    $('#rc').onclick = async () => form('Receive stock', [['ingredientId', 'Ingredient', await pick()], ['quantity', 'Quantity (in base unit)', 'number'], ['cost', 'Cost per unit', 'number'], ['invoiceNumber', 'Invoice no.'], ['expiryDate', 'Expiry date', 'date']], async (v) => { await Api.post('/restaurant/ingredients/receive', { branchId: S.branch, invoiceNumber: v.invoiceNumber, lines: [{ ingredientId: v.ingredientId, quantity: num(v.quantity), unitCostCents: num(v.cost) || 0, expiryDate: v.expiryDate }] }); V.stock(pg); }, 'Receive');
    $('#ws').onclick = async () => form('Record waste', [['ingredientId', 'Ingredient', await pick()], ['quantity', 'Quantity', 'number'], ['kind', 'Reason', ['WASTE', 'SPOILAGE', 'EXPIRED', 'STAFF_MEAL', 'COMPLIMENTARY', 'REMAKE']], ['reason', 'Note']], async (v) => { await Api.post('/restaurant/ingredients/waste', { ...v, branchId: S.branch, quantity: num(v.quantity) }); V.stock(pg); });
  };

  /* ---------- Staff shifts ---------- */
  V.shifts = async (pg) => {
    const { data } = await Api.get('/restaurant/shifts', { branchId: S.branch, limit: 50 }); const sh = list(data.shifts || data);
    pg.innerHTML = `<div class="hx-card" style="margin-bottom:14px;display:flex;gap:10px;flex-wrap:wrap;align-items:center"><b style="flex:1">My duty</b><button class="btn btn-success" id="on">Start duty</button><button class="btn btn-secondary" id="off">End duty</button></div>` + head('Shifts', S.user && ['OWNER', 'ADMIN', 'MANAGER', 'SUPERVISOR', 'HEAD_WAITER'].includes(S.user.role) ? 'Schedule shift' : '', 'sc') +
      table(['Staff', 'Role', 'Scheduled', 'Clocked in', 'Status'], sh.map((s) => [E(s.userId && s.userId.name || ''), E(s.role || (s.userId && s.userId.role) || ''), `${UI.formatDateTime(s.scheduledStart)}`, s.clockIn ? UI.formatDateTime(s.clockIn) : '-', `<span class="hx-chip">${E(s.status || '')}</span>`]));
    $('#on').onclick = () => api(async () => { await Api.post('/restaurant/duty/start', { branchId: S.branch, acceptingTables: true }); UI.toast.success('You are on duty'); V.shifts(pg); });
    $('#off').onclick = () => api(async () => { await Api.post('/restaurant/duty/end', {}); UI.toast.success('Duty ended'); V.shifts(pg); });
    const sc = $('#sc'); if (sc) sc.onclick = async () => { const { data: e } = await Api.get('/employees', { limit: 100 }); const us = list(e.employees || e); form('Schedule shift', [['userId', 'Staff', us.map((u) => ({ v: u._id, l: `${u.name} (${u.role})` }))], ['d', 'Date', 'date', ymd()], ['a', 'From', 'time', '09:00'], ['b', 'To', 'time', '17:00']], async (v) => { await Api.post('/restaurant/shifts', { userId: v.userId, branchId: S.branch, scheduledStart: new Date(`${v.d}T${v.a}`).toISOString(), scheduledEnd: new Date(`${v.d}T${v.b}`).toISOString() }); V.shifts(pg); }); };
  };

  /* ---------- Reports ---------- */
  const flat = (o) => Object.entries(o || {}).filter(([, v]) => typeof v !== 'object' || v === null).map(([k, v]) => [k.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase()), typeof v === 'number' && /revenue|total|tax|charge|discount|value|average|spend|rev|adr|cost|profit|tips/i.test(k) ? money(v) : E(v ?? '-')]);
  V.reports = async (pg) => {
    const from = pg.dataset.from || ymd(-30), to = pg.dataset.to || ymd(0), range = { branchId: S.branch, from: new Date(from).toISOString(), to: new Date(to + 'T23:59:59').toISOString() };
    const get = async (p) => { try { return (await Api.get(p, range)).data; } catch (e) { return null; } };
    const [rs, rsales, food, staff, occ, rev] = await Promise.all([S.mode !== 'ACCOMMODATION' ? get('/restaurant/reports/summary') : null, S.mode !== 'ACCOMMODATION' ? get('/restaurant/reports/sales') : null, S.mode !== 'ACCOMMODATION' ? get('/restaurant/reports/food-cost') : null, S.mode !== 'ACCOMMODATION' ? get('/restaurant/reports/staff') : null, S.mode !== 'RESTAURANT' ? get('/accommodation/reports/occupancy') : null, S.mode !== 'RESTAURANT' ? get('/accommodation/reports/revenue') : null]);
    const sec = (t, d) => d ? `<div class="hx-card" style="margin-bottom:14px"><h3>${t}</h3><table class="table"><tbody>${flat(d.summary || d).map(([k, v]) => `<tr><td>${k}</td><td style="text-align:right"><b>${v}</b></td></tr>`).join('')}</tbody></table></div>` : '';
    const rows = (t, a, cols) => a && a.length ? `<div class="hx-card" style="margin-bottom:14px"><h3>${t}</h3>${table(cols.map((c) => c[0]), a.slice(0, 15).map((r) => cols.map((c) => c[1](r))))}</div>` : '';
    const top = rsales && (rsales.items || rsales.topItems || rsales.byItem);
    pg.innerHTML = `<div class="hx-card" style="margin-bottom:14px;display:flex;gap:10px;align-items:end;flex-wrap:wrap"><div class="field"><label>From</label><input type="date" class="input" id="f" value="${from}"></div><div class="field"><label>To</label><input type="date" class="input" id="t" value="${to}"></div><button class="btn btn-primary" id="go">Apply</button><button class="btn btn-secondary" onclick="window.print()">Print</button></div>` +
      sec('Restaurant summary', rs) + rows('Best sellers', top, [['Dish', (r) => E(r.name || r._id)], ['Sold', (r) => r.quantity ?? r.qty ?? ''], ['Revenue', (r) => money(r.revenue ?? r.total)]]) + sec('Food cost', food) + rows('Staff performance', staff && (staff.staff || staff.items || staff.waiters), [['Staff', (r) => E(r.name || r.waiterName || '')], ['Orders', (r) => r.orders ?? r.bills ?? ''], ['Sales', (r) => money(r.revenue ?? r.sales)], ['Tips', (r) => money(r.tips)]]) +
      sec('Occupancy', occ) + rows('Occupancy by day', occ && occ.days, [['Date', (r) => E(r.date)], ['Rooms sold', (r) => r.roomsSold], ['Occupancy', (r) => r.occupancyPercent + '%'], ['ADR', (r) => money(r.adr)], ['RevPAR', (r) => money(r.revPar)]]) + sec('Accommodation revenue', rev) + rows('Revenue by category', rev && rev.byType, [['Type', (r) => E(r.type)], ['Amount', (r) => money(r.amount)]]);
    if (!rs && !occ) pg.innerHTML += UI.emptyStateHtml({ title: 'No report data', message: 'You may not have permission, or there is no activity in this range.' });
    $('#go').onclick = () => { pg.dataset.from = $('#f').value; pg.dataset.to = $('#t').value; V.reports(pg); };
  };

  /* ---------- Guest requests, calls and QR codes ---------- */
  function qrSvg(text, size = 160) { try { const r = window.QREncoder.encode(text, { ecl: 'M' }); const c = size / r.size; let d = ''; r.modules.forEach((row, y) => row.forEach((on, x) => { if (on) d += `M${x * c},${y * c}h${c}v${c}h-${c}z`; })); return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><path d="${d}"/></svg>`; } catch (e) { return ''; } }
  V.guest = async (pg) => {
    const get = (p, qq) => Api.get(p, qq).then((r) => r.data).catch(() => null);
    const [rq, cl] = await Promise.all([get('/restaurant/guest/requests', q()), get('/restaurant/guest/calls', q())]);
    const reqs = list(rq && (rq.requests || rq)), calls = list(cl && (cl.calls || cl));
    pg.innerHTML = head('Guest orders waiting') + (reqs.length ? `<div class="hx-grid w">${reqs.map((r) => `<div class="hx-card"><b>${E(r.placeLabel || r.tableName || r.roomNumber || 'Guest')}</b> <span class="hx-chip">${E(r.status)}</span>${(r.items || []).map((i) => `<div class="hx-item"><span>${i.quantity}× ${E(i.name)}</span></div>`).join('')}${r.status === 'PENDING' ? `<div style="display:flex;gap:8px;margin-top:8px"><button class="btn btn-primary" data-a="accept" data-i="${r._id}">Accept</button><button class="btn btn-secondary" data-a="reject" data-i="${r._id}">Reject</button></div>` : ''}</div>`).join('')}</div>` : '<p class="text-muted">No guest orders waiting.</p>') +
      head('Calls (waiter, bill, housekeeping)') + (calls.length ? `<div class="hx-grid w">${calls.map((c) => `<div class="hx-card"><b>${E(c.kind)}</b> · ${E(c.placeLabel || c.tableName || c.roomNumber || '')}<br><small>${E(c.note || '')}</small><div style="display:flex;gap:8px;margin-top:8px"><button class="btn btn-secondary" data-c="acknowledge" data-i="${c._id}">On my way</button><button class="btn btn-primary" data-c="resolve" data-i="${c._id}">Done</button></div></div>`).join('')}</div>` : '<p class="text-muted">No open calls.</p>') +
      `<div style="margin-top:22px">${head('QR codes', '', '')}<div style="display:flex;gap:8px;margin-bottom:12px"><button class="btn btn-secondary" data-k="TABLE">Table codes</button>${S.mode !== 'RESTAURANT' ? '<button class="btn btn-secondary" data-k="ROOM">Room codes</button>' : ''}<button class="btn btn-secondary" onclick="window.print()">Print</button></div><div id="qr"></div></div>`;
    pg.querySelectorAll('[data-a]').forEach((b) => b.onclick = () => api(async () => { await Api.post(`/restaurant/guest/requests/${b.dataset.i}/${b.dataset.a}`, {}); V.guest(pg); }));
    pg.querySelectorAll('[data-c]').forEach((b) => b.onclick = () => api(async () => { await Api.post(`/restaurant/guest/calls/${b.dataset.i}/${b.dataset.c}`, {}); V.guest(pg); }));
    pg.querySelectorAll('[data-k]').forEach((b) => b.onclick = () => api(async () => { const { data } = await Api.get('/restaurant/qr', { kind: b.dataset.k, branchId: S.branch }); const codes = list(data.codes || data.qr || data);
      $('#qr', pg).innerHTML = `<div class="hx-grid w">${codes.map((c) => { const link = c.url && /^http/.test(c.url) ? c.url : `${location.origin}/q/${c.token || (c.url || '').split('/q/')[1] || ''}`; return `<div class="hx-card" style="text-align:center">${qrSvg(link)}<h3>${E(c.label)}</h3><small class="text-muted">${c.enabled ? 'Active' : 'Switched off'}</small><div style="display:flex;gap:6px;justify-content:center;margin-top:8px"><button class="btn btn-sm btn-secondary" data-t="${c.id}" data-e="${c.enabled ? 0 : 1}" data-kk="${b.dataset.k}">${c.enabled ? 'Switch off' : 'Switch on'}</button><button class="btn btn-sm btn-secondary" data-rot="${c.id}" data-kk="${b.dataset.k}">New code</button></div></div>`; }).join('')}</div>`;
      pg.querySelectorAll('[data-t]').forEach((x) => x.onclick = () => api(async () => { await Api.post(`/restaurant/qr/${x.dataset.kk}/${x.dataset.t}/enabled`, { enabled: x.dataset.e === '1' }); b.click(); }));
      pg.querySelectorAll('[data-rot]').forEach((x) => x.onclick = async () => { if (await UI.confirmDialog({ title: 'Replace this QR code?', message: 'Printed copies of the old code stop working.', danger: true })) api(async () => { await Api.post(`/restaurant/qr/${x.dataset.kk}/${x.dataset.rot}/rotate`, {}); b.click(); }); }); }));
  }; V.guest.live = 12000;

  /* ---------- Folio (stay account) ---------- */
  window.HX.folio = async (id, done) => {
    const { data } = await api(() => Api.get('/accommodation/stays/' + id)); const s = data.stay || data; const t = s.totals || {};
    const lines = (s.folio || []).filter((l) => !l.voided);
    const m = UI.openModal({ title: `Folio · ${s.guest && s.guest.name || ''} · Room ${s.roomNumber || ''}`, maxWidth: '720px', bodyHtml: `<div class="hx-kpi"><div class="hx-card"><span>Charges</span><b>${money(t.charges)}</b></div><div class="hx-card"><span>Paid</span><b>${money(t.paid)}</b></div><div class="hx-card"><span>Balance</span><b>${money(t.balance)}</b></div></div>` + table(['Date', 'Description', 'Qty', 'Total', ''], lines.map((l) => [UI.formatDate(l.postedAt), E(l.description), l.quantity, money(l.total), l.source === 'AUTO' || l.type === 'ROOM' ? '' : `<button class="btn btn-sm btn-secondary" data-v="${l._id}">Void</button>`])), footerHtml: '<button class="btn btn-secondary" id="ch">Add charge</button><button class="btn btn-primary" id="py">Take payment</button>' });
    const again = () => { UI.closeModal(); window.HX.folio(id, done); };
    m.querySelectorAll('[data-v]').forEach((b) => b.onclick = () => form('Void line', [['reason', 'Reason']], async (v) => { await Api.post(`/accommodation/stays/${id}/charges/${b.dataset.v}/void`, v); again(); }, 'Void'));
    $('#ch', m).onclick = () => form('Add charge', [['type', 'Type', [{ v: 'FNB', l: 'Food & drink' }, 'MINIBAR', 'LAUNDRY', 'TRANSPORT', 'SERVICE', 'DAMAGE', 'EXTRA_PERSON', 'OTHER']], ['description', 'Description'], ['quantity', 'Quantity', 'number', 1], ['unitPrice', 'Unit price', 'number']], async (v) => { await Api.post(`/accommodation/stays/${id}/charges`, { ...v, quantity: num(v.quantity) || 1, unitPrice: num(v.unitPrice) }); again(); }, 'Post charge');
    $('#py', m).onclick = () => form('Take payment', [['method', 'Method', ['CASH', 'MPESA', 'CARD', 'BANK', 'MOBILE_MONEY']], ['amount', 'Amount', 'number', t.balance > 0 ? t.balance : ''], ['reference', 'Reference']], async (v) => { await Api.post(`/accommodation/stays/${id}/payments`, { ...v, amount: num(v.amount) }); again(); }, 'Record payment');
  };
  window.HX._r && window.HX._r();
})();
