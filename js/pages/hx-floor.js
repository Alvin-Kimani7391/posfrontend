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
      `${can('restaurant.tables.manage') ? '<button class="btn btn-primary" id="add-table">+ Add table</button>' : ''}${mk('TAKEAWAY', 'Takeaway')}${mk('PICKUP', 'New pickup')}${mk('DELIVERY', 'New delivery')}${mk('BAR_TAB', 'Bar tab')}${can('restaurant.bills.view') ? '<a class="btn btn-primary" href="hx-bills.html">Bills &amp; payments</a>' : ''}<span class="hx-live">Live</span>`)
      + '<div id="sum" class="hx-sum"></div><div class="hx-floorbar"><div id="areas"></div><div class="hx-legend" id="legend"></div></div><div id="floor" class="hx-floor">' + window.HX.skel('tilesin') + '</div><div id="open-others"></div>';
    el.querySelectorAll('[data-new]').forEach((b) => b.addEventListener('click', () => window.HX.order.start(b.dataset.new, { onChange: load, onClose: load })));
    el.querySelector('#add-table')?.addEventListener('click', addTable);
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
      { row: [{ name: 'seats', label: 'Seats', type: 'number', value: 4, min: 1, max: 100, required: true }, { name: 'areaId', label: 'Area', type: 'select', options: [['', 'No area'], ...areas.map((a) => [a._id, a.name])], value: areaId }] },
    ], onSubmit: async (v) => {
      const r = await send('post', '/restaurant/tables', { branchId: window.HX.branchId(), name: v.name, seats: v.seats || 4, ...(v.areaId ? { areaId: v.areaId } : {}) });
      if (!r) return false;
      window.UI.toast.success(`Table ${v.name} added`); load(); return true;
    } });
  }
  function paintAreas() {
    el.querySelector('#areas').innerHTML = areas.length > 1 ? `<div class="hx-cats hx-tabs" style="margin:0"><button class="hx-chip ${areaId ? '' : 'on'}" data-a="">All</button>${areas.map((x) => `<button class="hx-chip ${areaId === x._id ? 'on' : ''}" data-a="${x._id}">${E(x.name)}</button>`).join('')}</div>` : '';
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
      box.querySelectorAll('[data-t]').forEach((b) => b.addEventListener('click', () => window.HX.order.openTable(floor.find((t) => t._id === b.dataset.t), { onChange: load, onClose: load })));
      const mine = list(others, 'orders').filter((o) => o.orderType && o.orderType !== 'DINE_IN');
      const oo = el.querySelector('#open-others');
      oo.innerHTML = mine.length ? `<div class="hx-section"><h2>Takeaway, pickup, tabs and deliveries</h2><div class="hx-orders">${mine.map((o) => `<div class="hx-ocard" role="button" tabindex="0" data-o="${o._id}"><div class="oh"><span class="oic">${icon(TYPE_ICON[o.orderType] || 'bag')}</span><div><b>${E(o.orderNumber)}</b><small>${E((o.orderType || '').replace('_', ' ').toLowerCase())}${o.customerName ? ' · ' + E(o.customerName) : ''}</small></div></div>${o.customerPhone || o.tableName ? `<small class="hx-sub">${E(o.tableName || '')}${o.customerPhone ? ' ' + E(o.customerPhone) : ''}</small>` : ''}<div class="of"><span class="hx-money">${M(o.totals && o.totals.total)}</span>${can('restaurant.bills.generate') && o.items && o.items.length ? `<button class="btn btn-sm btn-primary" data-bp="${o._id}">Bill &amp; pay</button>` : '<span class="hx-sub">Open</span>'}</div></div>`).join('')}</div></div>` : '';
      oo.querySelectorAll('[data-o]').forEach((b) => b.addEventListener('click', (e) => { if (e.target.closest('[data-bp]')) return; window.HX.order.open(b.dataset.o, { onChange: load, onClose: load }); }));
      oo.querySelectorAll('[data-bp]').forEach((b) => b.addEventListener('click', () => window.HX.bill.forOrder(b.dataset.bp, { pay: true, onChange: load })));
    } finally { busy = false; }
  }
  function tile(t) {
    const o = t.order, st = t.status || 'AVAILABLE';
    return `<button type="button" class="hx-tbl hx-st-${TONE[st] || 'mute'}" data-t="${t._id}"><span class="dot"></span>${o && o.readyItems ? `<span class="ready">${o.readyItems} ready</span>` : ''}${window.HX.art.table(t.seats)}<span class="nm">${E(t.name)}</span><span class="meta"><span>${t.seats || '-'} seats</span>${t.waiterName ? `<span>· ${E(t.waiterName)}</span>` : ''}${t.occupiedMinutes != null ? `<span>· ${t.occupiedMinutes} min</span>` : ''}</span>${o ? `<span class="amt"><small>${E(LABEL[st] || st)}</small>${M(o.total)}</span>` : ''}</button>`;
  }
})();
