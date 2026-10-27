/**
 * hx-delivery.js - delivery and pickup. Dispatchers assign riders; riders see their own runs and update status.
 * API: GET /restaurant/delivery, GET /restaurant/delivery/mine, POST /orders/:id/delivery/assign|status, POST /orders/:id/pickup/collect
 */
(function () {
  const { E, M, can, get, send, list, head, pill, formModal, mins } = window.HX;
  let el, rows = [], riders = [], tab = 'DELIVERY';
  const TONE = { PENDING: 'warn', ASSIGNED: 'plan', OUT_FOR_DELIVERY: 'busy', DELIVERED: 'ok', FAILED: 'bad' };
  document.addEventListener('DOMContentLoaded', init);
  async function init() {
    el = window.HX.mount('Delivery & pickup'); if (!el) return; await window.AppShell.whenProfileReady?.();
    const rider = !can('restaurant.delivery.view');
    if (!rider && can('restaurant.delivery.manage')) { const e = await get('/employees', { limit: 100 }); riders = list(e, 'employees').filter((x) => x.role === 'DELIVERY_RIDER'); }
    el.innerHTML = head(rider ? 'My deliveries' : 'Delivery & pickup', rider ? 'Runs assigned to you.' : 'Assign riders and follow each order to the door.', '<button class="btn btn-secondary" id="hist">Past deliveries &amp; pickups</button>' + (rider || !can('restaurant.orders.create') ? '' : '<button class="btn btn-secondary" id="np">New pickup</button><button class="btn btn-primary" id="nd">New delivery</button>') + (rider ? '' : '<a class="btn btn-secondary" href="hx-live.html">Live map</a>') + '<span class="hx-live">Live</span>') + (rider ? '' : '<div id="tb"></div>') + '<div id="dl"></div>';
    const refresh = () => load(rider);
    el.querySelector('#hist')?.addEventListener('click', () => window.HX.showHistory('deliveries'));
    el.querySelector('#nd')?.addEventListener('click', () => window.HX.order.start('DELIVERY', { onChange: refresh, onClose: refresh }));
    el.querySelector('#np')?.addEventListener('click', () => window.HX.order.start('PICKUP', { onChange: refresh, onClose: refresh }));
    window.HX.live(() => { if (!document.querySelector('.modal-backdrop')) refresh(); }, 20000); refresh();
  }
  let plan = {};
  async function load(rider) {
    plan = await window.HX.plan().catch(() => ({}));
    const d = await get(rider ? '/restaurant/delivery/mine' : '/restaurant/delivery', { branchId: window.HX.branchId() });
    rows = list(d, 'deliveries', 'orders'); paint(rider);
  }
  function paint(rider) {
    const tb = el.querySelector('#tb'); if (tb) { tb.innerHTML = window.HX.tabs([['DELIVERY', 'Delivery'], ['PICKUP', 'Pickup']], tab); tb.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => { tab = b.dataset.tab; paint(rider); })); }
    const v = rider ? rows : rows.filter((o) => (tab === 'PICKUP' ? o.orderType === 'PICKUP' : o.orderType !== 'PICKUP'));
    el.querySelector('#dl').innerHTML = v.length ? `<div class="hx-cols">${v.map(card).join('')}</div>` : window.HX.empty('Nothing here', 'New delivery and pickup orders show up automatically.');
    el.querySelectorAll('[data-as]').forEach((b) => b.addEventListener('click', () => assign(b.dataset.as)));
    el.querySelectorAll('[data-st]').forEach((b) => b.addEventListener('click', () => status(b.dataset.id, b.dataset.st)));
    el.querySelectorAll('[data-mr]').forEach((b) => b.addEventListener('click', async () => { if (await send('post', `/restaurant/orders/${b.dataset.mr}/ready`, { all: true })) { window.UI.toast.success('Marked ready'); load(rider); } }));
    el.querySelectorAll('[data-pk]').forEach((b) => b.addEventListener('click', () => collect(b.dataset.pk)));
    el.querySelectorAll('[data-op]').forEach((b) => b.addEventListener('click', () => window.HX.order.open(b.dataset.op, { onChange: () => load(rider), onClose: () => load(rider) })));
    el.querySelectorAll('[data-bp]').forEach((b) => b.addEventListener('click', () => window.HX.bill.forOrder(b.dataset.bp, { pay: true, onChange: () => load(rider) })));
  }
  function card(o) {
    const d = o.delivery || {}, st = d.status || (o.pickup && o.pickup.status) || 'PENDING', id = o._id || o.orderId;
    const b = (s, l, c) => `<button class="btn btn-sm ${c || 'btn-primary'}" data-id="${id}" data-st="${s}">${l}</button>`;
    return `<div class="hx-card"><div class="hx-row" style="padding-top:0"><div class="grow"><b>#${E(o.orderNumber)} · ${E(d.contactName || o.customerName || 'Customer')}</b><small class="hx-sub">${mins(o.createdAt)} min ago · ${M(o.totals && o.totals.total)}</small></div>${pill(st, TONE[st] || 'warn')}</div>
      ${d.online ? `<p><span class="hx-pill hx-st-plan">Online order</span>${d.etaMinutes ? ` · promised in ${d.etaMinutes} min` : ''}${d.payment ? ` · pay ${E(String(d.payment).toLowerCase())}` : ''}</p>` : ''}${d.address ? `<p>${E(d.address)}${d.landmark ? ' · ' + E(d.landmark) : ''}${d.lat != null && d.lng != null ? ` · <a target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&destination=${d.lat},${d.lng}">Open in Google Maps</a>` : ''}</p>` : ''}${d.instructions ? `<p><small>Rider note: ${E(d.instructions)}</small></p>` : ''}${d.phone || o.customerPhone ? `<p><a href="tel:${E(d.phone || o.customerPhone)}">${E(d.phone || o.customerPhone)}</a></p>` : ''}${d.instructions ? `<small class="hx-sub">${E(d.instructions)}</small>` : ''}${d.riderName ? `<p class="hx-sub">Rider: ${E(d.riderName)}</p>` : ''}
      <div class="hx-actions" style="margin-top:var(--space-3)">
        ${can('restaurant.orders.create') && !['DELIVERED', 'FAILED'].includes(st) ? `<button class="btn btn-sm btn-secondary" data-op="${id}">Order</button>` : ''}${plan.kitchenScreen === false && !rider && can('restaurant.orders.create') && !['DELIVERED', 'FAILED', 'OUT_FOR_DELIVERY'].includes(st) && !(o.pickup && o.pickup.status === 'COLLECTED') ? `<button class="btn btn-sm btn-success" data-mr="${id}">Mark food ready</button>` : ''}${can('restaurant.bills.generate') && can('restaurant.bills.pay') && o.billStatus !== 'PAID' ? `<button class="btn btn-sm btn-secondary" data-bp="${id}">Bill &amp; pay</button>` : ''}
        ${o.orderType === 'PICKUP' ? (o.pickup && o.pickup.status === 'COLLECTED' ? '' : (can('restaurant.orders.create') ? `<button class="btn btn-sm btn-primary" data-pk="${id}">Handed over</button>` : '')) : ''}
        ${o.orderType !== 'PICKUP' && can('restaurant.delivery.manage') && !['DELIVERED', 'FAILED'].includes(st) ? `<button class="btn btn-sm btn-secondary" data-as="${id}">${d.riderName ? 'Change rider' : 'Assign rider'}</button>` : ''}
        ${can('restaurant.delivery.self') && st === 'ASSIGNED' ? b('OUT_FOR_DELIVERY', 'Picked up') : ''}${can('restaurant.delivery.self') && st === 'OUT_FOR_DELIVERY' ? b('DELIVERED', 'Delivered', 'btn-success') + b('FAILED', 'Failed', 'btn-secondary') : ''}</div></div>`;
  }
  function assign(id) {
    if (!riders.length) return window.UI.toast.info('Add an employee with the Delivery rider role first');
    formModal({ title: 'Assign rider', maxWidth: '400px', fields: [{ name: 'riderId', label: 'Rider', type: 'select', options: riders.map((r) => [r._id, r.name || r.fullName || r.employeeCode]) }], onSubmit: async (v) => { if (await send('post', `/restaurant/orders/${id}/delivery/assign`, v)) { load(); return true; } return false; } });
  }
  async function status(id, s) { let reason; if (s === 'FAILED') { reason = await window.HX.ask('Delivery failed', 'What happened?'); if (!reason) return; } if (await send('post', `/restaurant/orders/${id}/delivery/status`, { status: s, ...(reason ? { reason } : {}) })) load(); }
  function collect(id) { formModal({ title: 'Handed over to', maxWidth: '400px', fields: [{ name: 'collectedBy', label: 'Customer name', required: true }], onSubmit: async (v) => { if (await send('post', `/restaurant/orders/${id}/pickup/collect`, v)) { load(); return true; } return false; } }); }
})();
