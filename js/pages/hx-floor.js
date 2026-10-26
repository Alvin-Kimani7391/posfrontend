/** hx-floor.js - Tables & orders. Tap a table -> the order opens as a full POS screen (menu, send to kitchen, Bill, Bill & pay). New takeaway/pickup/delivery/tab buttons. */
(function () {
  const { E, M, can, get, send, list, head, pill, icon, formModal } = window.HX;
  let el, floor = [], areas = [], areaId = '', busy = false;
  const TONE = { AVAILABLE: 'ok', OCCUPIED: 'busy', RESERVED: 'plan', AWAITING_BILL: 'warn', PAYMENT_PENDING: 'warn', CLEANING: 'mute' };
  const LABEL = { AVAILABLE: 'Available', OCCUPIED: 'Occupied', RESERVED: 'Reserved', AWAITING_BILL: 'Awaiting bill', PAYMENT_PENDING: 'Payment pending', CLEANING: 'Cleaning' };
  const TYPE_ICON = { DINE_IN: 'utensils', TAKEAWAY: 'bag', PICKUP: 'bag', DELIVERY: 'bike', BAR_TAB: 'coffee', COUNTER: 'receipt' };
  document.addEventListener('DOMContentLoaded', init);
  async function init() {
    el = window.HX.mount('Tables & orders'); if (!el) return;
    await window.AppShell.whenProfileReady?.();
    const mk = (type, label) => (can('restaurant.orders.create') ? `<button class="btn btn-secondary" data-new="${type}">${label}</button>` : '');
    el.innerHTML = head('Tables & orders', 'Tap a table to take an order, send it to the kitchen, then bill and take payment.',
      `${can('restaurant.tables.manage') ? '<button class="btn btn-primary" id="add-table">+ Add table</button><button class="btn btn-secondary" id="add-area">+ Add location</button>' : ''}${can('restaurant.orders.create') || can('restaurant.tables.manage') ? '<button class="btn btn-secondary" id="clear-tables">Clear tables</button>' : ''}${mk('TAKEAWAY', 'Takeaway')}${mk('PICKUP', 'New pickup')}${mk('DELIVERY', 'New delivery')}${mk('BAR_TAB', 'Bar tab')}${can('restaurant.bills.view') ? '<a class="btn btn-primary" href="hx-bills.html">Bills &amp; payments</a>' : ''}<span class="hx-live">Live</span>`)
      + '<div id="sum" class="hx-sum"></div><div class="hx-floorbar"><div id="areas"></div><div class="hx-legend" id="legend"></div></div><div id="floor" class="hx-floor">' + window.HX.skel('tilesin') + '</div><div id="open-others"></div>';
    el.querySelectorAll('[data-new]').forEach((b) => b.addEventListener('click', () => window.HX.order.start(b.dataset.new, { onChange: load, onClose: load })));
    el.querySelector('#add-table')?.addEventListener('click', addTable);
    el.querySelector('#add-area')?.addEventListener('click', () => addArea());
    el.querySelector('#clear-tables')?.addEventListener('click', clearTables);
    el.querySelector('#legend').innerHTML = ['AVAILABLE', 'OCCUPIED', 'RESERVED', 'AWAITING_BILL'].map((k) => `<span class="lg hx-st-${TONE[k]}"><i></i>${LABEL[k]}</span>`).join('');
    if (window.HX.order && window.HX.order.prefetch) window.HX.order.prefetch();
    const [a] = await Promise.all([get('/restaurant/areas', { branchId: window.HX.branchId() }), load()]);
    areas = list(a, 'areas'); paintAreas();
    window.HX.live(() => { if (!document.querySelector('.modal-backdrop')) load(); }, 15000);
    const m = location.hash.match(/order=([a-f0-9]+)/i);
    if (m) { history.replaceState(null, '', location.pathname); window.HX.order.open(m[1], { onChange: load, onClose: load }); }
  }
  /** Add one table. The dialog opens at once; the list of areas is already loaded (or filled in a moment later). */
  function addTable() {
    const next = (() => { const nums = floor.map((t) => /^(\D*)(\d+)$/.exec(String(t.name || '').trim())).filter(Boolean); if (!nums.length) return { prefix: 'T', n: floor.length + 1 }; const last = nums[nums.length - 1]; return { prefix: last[1], n: Math.max(...nums.map((m) => +m[2])) + 1 }; })();
    formModal({ title: 'Add a table', submitText: 'Add table', maxWidth: '440px', fields: [
      { name: 'name', label: 'Table name or number', required: true, value: next.prefix + next.n, placeholder: 'T12' },
      { row: [{ name: 'seats', label: 'Seats', type: 'number', value: 4, min: 1, max: 100, required: true }, { name: 'areaId', label: 'Location', type: 'select', options: [['', 'No location'], ...areas.map((a) => [a._id, a.name])], value: areaId }] },
      { name: 'newArea', label: 'Or add a new location', placeholder: 'e.g. Patio, Rooftop, Garden', hint: 'Type a name here to create a new table location and put this table in it.' },
    ], onSubmit: async (v) => {
      let aid = v.areaId;
      if (v.newArea && v.newArea.trim()) { const a = await createArea(v.newArea.trim()); if (!a) return false; aid = a._id; }
      const r = await send('post', '/restaurant/tables', { branchId: window.HX.branchId(), name: v.name, seats: v.seats || 4, ...(aid ? { areaId: aid } : {}) });
      if (!r) return false;
      window.UI.toast.success(`Table ${v.name} added`); load(); return true;
    } });
  }
  /** Create a table location (area) and refresh the filter bar. Returns the new area or null. */
  async function createArea(name) {
    const r = await send('post', '/restaurant/areas', { branchId: window.HX.branchId(), name });
    const a = r && window.HX.unwrap(r, 'area'); if (!a || !a._id) return null;
    areas.push(a); paintAreas(); window.UI.toast.success(`Location ${name} added`); return a;
  }
  function addArea() {
    formModal({ title: 'Add a table location', submitText: 'Add location', maxWidth: '400px', fields: [{ name: 'name', label: 'Location name', required: true, placeholder: 'e.g. Patio, Rooftop, Garden' }], onSubmit: async (v) => !!(await createArea(v.name.trim())) });
  }
  /** Free tables that guests occupied and then left without ordering (or that are stuck). Empty open orders are cancelled first. */
  async function clearTables() {
    const d = await get('/restaurant/tables', { branchId: window.HX.branchId() }); const all = list(d, 'tables');
    const busyT = all.filter((t) => (t.status || 'AVAILABLE') !== 'AVAILABLE');
    if (!busyT.length) return window.UI.toast.info('All tables are already available');
    const hasBill = (t) => !!(t.order && Number(t.order.total) > 0);
    const pick = new Set(busyT.filter((t) => !hasBill(t) && t.status === 'OCCUPIED').map((t) => String(t._id)));
    window.HX.modal({ title: 'Clear tables', maxWidth: '520px', body: '', footer: '<button class="btn btn-secondary" data-c>Cancel</button><button class="btn btn-primary" id="ct-go">Clear selected</button>', onMount(m, close) {
      const body = m.querySelector('.modal-body') || m;
      const paint = () => {
        body.innerHTML = `<p class="hx-sub" style="margin:0 0 10px">Tick the tables whose guests left. Tables with nothing ordered are ticked for you. Tables with an order that has items need a second look.</p>
        <div class="hx-card flush">${busyT.map((t) => `<label class="hx-row" style="cursor:pointer"><input type="checkbox" data-t="${E(t._id)}" ${pick.has(String(t._id)) ? 'checked' : ''} style="width:22px;height:22px"><span class="grow"><b>Table ${E(t.name)}</b><small class="hx-sub">${E(LABEL[t.status] || t.status)}${t.occupiedMinutes != null ? ' · ' + t.occupiedMinutes + ' min' : ''}${hasBill(t) ? ' · order ' + M(t.order.total) : ' · nothing ordered'}</small></span>${pill(hasBill(t) ? 'HAS ORDER' : 'EMPTY', hasBill(t) ? 'warn' : 'ok')}</label>`).join('')}</div>`;
        body.querySelectorAll('input[data-t]').forEach((c) => c.addEventListener('change', () => { c.checked ? pick.add(c.dataset.t) : pick.delete(c.dataset.t); m.querySelector('#ct-go').textContent = `Clear selected (${pick.size})`; }));
        m.querySelector('#ct-go').textContent = `Clear selected (${pick.size})`;
      };
      paint(); m.querySelector('[data-c]').onclick = close;
      m.querySelector('#ct-go').onclick = async (e) => {
        const chosen = busyT.filter((t) => pick.has(String(t._id))); if (!chosen.length) return window.UI.toast.info('Tick at least one table');
        const billed = chosen.filter(hasBill).length;
        if (billed && !(await window.UI.confirmDialog({ title: `${billed} table${billed > 1 ? 's have' : ' has'} an order with items`, message: 'Clearing cancels those unpaid orders. Only continue if the guests really left without paying.', confirmText: 'Clear anyway' }))) return;
        const b = e.currentTarget; b.disabled = true; b.textContent = 'Working…';
        const reason = 'Table cleared by ' + ((window.HX.user() || {}).name || 'staff'); let done = 0; const fails = [];
        for (const t of chosen) {
          try {
            if (t.order && t.order._id) await window.Api.post('/restaurant/orders/' + t.order._id + '/cancel', { reason });
            await window.Api.post('/restaurant/tables/' + t._id + '/status', { status: 'AVAILABLE', reason }); done++;
          } catch (err) { fails.push(`Table ${t.name}: ${(err && err.message) || 'failed'}`); }
        }
        if (done) window.UI.toast.success(`${done} table${done > 1 ? 's' : ''} cleared`);
        if (fails.length) window.UI.toast.error(fails.slice(0, 3).join(' · '));
        close(); load();
      };
    } });
  }
  function paintAreas() {
    el.querySelector('#areas').innerHTML = areas.length ? `<div class="hx-cats hx-tabs" style="margin:0"><button class="hx-chip ${areaId ? '' : 'on'}" data-a="">All</button>${areas.map((x) => `<button class="hx-chip ${areaId === x._id ? 'on' : ''}" data-a="${x._id}">${E(x.name)}</button>`).join('')}</div>` : '';
    el.querySelectorAll('[data-a]').forEach((b) => b.addEventListener('click', () => { areaId = b.dataset.a; paintAreas(); load(); }));
  }
  function paintSummary() {
    const c = {}; floor.forEach((t) => { const s = t.status || 'AVAILABLE'; c[s] = (c[s] || 0) + 1; });
    el.querySelector('#sum').innerHTML = floor.length ? `<span class="hx-st-mute"><i></i>All tables <b>${floor.length}</b></span>` + Object.keys(TONE).filter((k) => c[k]).map((k) => `<span class="hx-st-${TONE[k]}"><i></i>${LABEL[k]} <b>${c[k]}</b></span>`).join('') : '';
  }
  async function load() {
    if (busy || !el) return; busy = true;
    try {
      const bid = window.HX.branchId();
      const [d, others] = await Promise.all([get('/restaurant/tables', { branchId: bid, ...(areaId ? { areaId } : {}) }), get('/restaurant/orders', { branchId: bid, status: 'OPEN', limit: 50 })]);
      floor = list(d, 'tables'); paintSummary();
      const box = el.querySelector('#floor');
      box.innerHTML = floor.length ? floor.map(tile).join('') : window.HX.empty('No tables yet', 'Add tables in the Setup guide.');
      box.querySelectorAll('[data-t]').forEach((b) => b.addEventListener('click', async () => {
        const t = floor.find((x) => x._id === b.dataset.t), rv = t && t.reservation;
        if (rv && !t.order && t.status === 'RESERVED') {                 // the table is held for a booking: seat that guest, nobody else can take it
          if (!can('restaurant.reservations.manage')) { window.UI.toast.warning(`Table ${t.name} is reserved for ${rv.guestName} at ${window.HX.hm(rv.startsAt)}.`); return; }
          if (!confirm(`Table ${t.name} is reserved for ${rv.guestName} (${rv.partySize} guests) at ${window.HX.hm(rv.startsAt)}.\n\nIs this guest here? OK seats them and opens their order.`)) return;
          if (await send('post', `/restaurant/reservations/${rv._id}/seat`, {})) { window.UI.toast.success('Guest seated'); load(); }
          return;
        }
        window.HX.order.openTable(t, { onChange: load, onClose: load });
      }));
      const mine = list(others, 'orders').filter((o) => o.orderType && o.orderType !== 'DINE_IN');
      const oo = el.querySelector('#open-others');
      oo.innerHTML = mine.length ? `<div class="hx-section"><h2>Takeaway, pickup, tabs and deliveries</h2><div class="hx-orders">${mine.map((o) => `<div class="hx-ocard" role="button" tabindex="0" data-o="${o._id}"><div class="oh"><span class="oic">${icon(TYPE_ICON[o.orderType] || 'bag')}</span><div><b>${E(o.orderNumber)}</b><small>${E((o.orderType || '').replace('_', ' ').toLowerCase())}${o.customerName ? ' · ' + E(o.customerName) : ''}</small></div></div>${o.customerPhone || o.tableName ? `<small class="hx-sub">${E(o.tableName || '')}${o.customerPhone ? ' ' + E(o.customerPhone) : ''}</small>` : ''}<div class="of"><span class="hx-money">${M(o.totals && o.totals.total)}</span>${can('restaurant.bills.generate') && o.items && o.items.length ? `<button class="btn btn-sm btn-primary" data-bp="${o._id}">Bill &amp; pay</button>` : '<span class="hx-sub">Open</span>'}</div></div>`).join('')}</div></div>` : '';
      oo.querySelectorAll('[data-o]').forEach((b) => b.addEventListener('click', (e) => { if (e.target.closest('[data-bp]')) return; window.HX.order.open(b.dataset.o, { onChange: load, onClose: load }); }));
      oo.querySelectorAll('[data-bp]').forEach((b) => b.addEventListener('click', () => window.HX.bill.forOrder(b.dataset.bp, { pay: true, onChange: load })));
    } finally { busy = false; }
  }
  function tile(t) {
    const o = t.order, st = t.status || 'AVAILABLE';
    return `<button type="button" class="hx-tbl hx-st-${TONE[st] || 'mute'}" data-t="${t._id}"><span class="dot"></span>${o && o.readyItems ? `<span class="ready">${o.readyItems} ready</span>` : ''}${window.HX.art.table(t.seats)}<span class="nm">${E(t.name)}</span><span class="meta"><span>${t.seats || '-'} seats</span>${t.waiterName ? `<span>· ${E(t.waiterName)}</span>` : ''}${t.occupiedMinutes != null ? `<span>· ${t.occupiedMinutes} min</span>` : ''}</span>${o ? `<span class="amt"><small>${E(LABEL[st] || st)}</small>${M(o.total)}</span>` : ''}${!o && t.reservation ? `<span class="amt"><small>${st === 'RESERVED' ? 'Held for' : 'Booked'} ${E(window.HX.hm(t.reservation.startsAt))}</small>${E(t.reservation.guestName)} · ${t.reservation.partySize}${t.reservation.prepaid > 0 ? ' · prepaid' : ''}</span>` : ''}</button>`;
  }
})();
