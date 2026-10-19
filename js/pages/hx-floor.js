/** hx-floor.js - Tables & orders. Tap a table -> the order opens as a MODAL (menu, send to kitchen, Bill, Bill & pay). New takeaway/pickup/delivery/tab buttons. */
(function () {
  const { E, M, can, get, list, head, pill } = window.HX;
  let el, floor = [], areas = [], areaId = '', busy = false;
  const TONE = { AVAILABLE: 'ok', OCCUPIED: 'busy', RESERVED: 'plan', AWAITING_BILL: 'warn', PAYMENT_PENDING: 'warn', CLEANING: 'mute' };
  document.addEventListener('DOMContentLoaded', init);
  async function init() {
    el = window.HX.mount('Tables & orders'); if (!el) return;
    await window.AppShell.whenProfileReady?.();
    const mk = (type, label) => (can('restaurant.orders.create') ? `<button class="btn btn-secondary" data-new="${type}">${label}</button>` : '');
    el.innerHTML = head('Tables & orders', 'Tap a table to take an order, send it to the kitchen, then bill and take payment.',
      `${mk('TAKEAWAY', 'Takeaway')}${mk('PICKUP', 'New pickup')}${mk('DELIVERY', 'New delivery')}${mk('BAR_TAB', 'Bar tab')}${can('restaurant.bills.view') ? '<a class="btn btn-secondary" href="hx-bills.html">Bills &amp; payments</a>' : ''}<span class="hx-live">Live</span>`)
      + '<div id="areas"></div><div id="floor" class="hx-floor">' + window.HX.skel('tilesin') + '</div><div class="hx-legend" id="legend"></div><div id="open-others"></div>';
    el.querySelectorAll('[data-new]').forEach((b) => b.addEventListener('click', () => window.HX.order.start(b.dataset.new, { onChange: load, onClose: load })));
    el.querySelector('#legend').innerHTML = Object.keys(TONE).map((k) => pill(k, TONE[k])).join('');
    if (window.HX.order && window.HX.order.prefetch) window.HX.order.prefetch();
    const [a] = await Promise.all([get('/restaurant/areas', { branchId: window.HX.branchId() }), load()]);
    areas = list(a, 'areas'); paintAreas();
    window.HX.live(() => { if (!document.querySelector('.modal-backdrop')) load(); }, 15000);
    const m = location.hash.match(/order=([a-f0-9]+)/i);
    if (m) { history.replaceState(null, '', location.pathname); window.HX.order.open(m[1], { onChange: load, onClose: load }); }
  }
  function paintAreas() {
    el.querySelector('#areas').innerHTML = areas.length > 1 ? `<div class="hx-cats hx-tabs"><button class="hx-chip ${areaId ? '' : 'on'}" data-a="">All</button>${areas.map((x) => `<button class="hx-chip ${areaId === x._id ? 'on' : ''}" data-a="${x._id}">${E(x.name)}</button>`).join('')}</div>` : '';
    el.querySelectorAll('[data-a]').forEach((b) => b.addEventListener('click', () => { areaId = b.dataset.a; paintAreas(); load(); }));
  }
  async function load() {
    if (busy || !el) return; busy = true;
    try {
      const bid = window.HX.branchId();
      const [d, others] = await Promise.all([get('/restaurant/tables', { branchId: bid, ...(areaId ? { areaId } : {}) }), get('/restaurant/orders', { branchId: bid, status: 'OPEN', limit: 50 })]);
      floor = list(d, 'tables');
      const box = el.querySelector('#floor');
      box.innerHTML = floor.length ? floor.map(tile).join('') : window.HX.empty('No tables yet', 'Add tables in the Setup guide.');
      box.querySelectorAll('[data-t]').forEach((b) => b.addEventListener('click', () => window.HX.order.openTable(floor.find((t) => t._id === b.dataset.t), { onChange: load, onClose: load })));
      const mine = list(others, 'orders').filter((o) => o.orderType && o.orderType !== 'DINE_IN');
      const oo = el.querySelector('#open-others');
      oo.innerHTML = mine.length ? `<div class="hx-section"><h2>Takeaway, pickup, tabs and deliveries</h2><div class="hx-card flush">${mine.map((o) => `<div class="hx-row"><button type="button" class="hx-linkrow grow" data-o="${o._id}"><b>${E(o.orderNumber)} · ${E((o.orderType || '').replace('_', ' ').toLowerCase())}</b><small class="hx-sub">${E(o.customerName || o.tableName || '')}${o.customerPhone ? ' · ' + E(o.customerPhone) : ''}</small></button><span class="hx-money">${M(o.totals && o.totals.total)}</span>${can('restaurant.bills.generate') && o.items && o.items.length ? `<button class="btn btn-sm btn-primary" data-bp="${o._id}">Bill &amp; pay</button>` : ''}</div>`).join('')}</div></div>` : '';
      oo.querySelectorAll('[data-o]').forEach((b) => b.addEventListener('click', () => window.HX.order.open(b.dataset.o, { onChange: load, onClose: load })));
      oo.querySelectorAll('[data-bp]').forEach((b) => b.addEventListener('click', () => window.HX.bill.forOrder(b.dataset.bp, { pay: true, onChange: load })));
    } finally { busy = false; }
  }
  function tile(t) {
    const o = t.order, st = t.status || 'AVAILABLE';
    return `<button type="button" class="hx-tbl hx-st-${TONE[st] || 'mute'}" data-t="${t._id}">${o && o.readyItems ? `<span class="ready">${o.readyItems} ready</span>` : ''}<span class="nm">${E(t.name)}</span><span class="meta">${t.seats || ''} seats${t.waiterName ? ' · ' + E(t.waiterName) : ''}</span><span class="meta">${pill(st, TONE[st])}${t.occupiedMinutes != null ? ` ${t.occupiedMinutes} min` : ''}</span>${o ? `<span class="amt">${M(o.total)}</span>` : ''}</button>`;
  }
})();