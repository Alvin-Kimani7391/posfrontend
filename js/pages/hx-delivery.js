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
    el.innerHTML = head(rider ? 'My deliveries' : 'Delivery & pickup', rider ? 'Runs assigned to you.' : 'Assign riders and follow each order to the door.', '<span class="hx-live">Live</span>') + (rider ? '' : '<div id="tb"></div>') + '<div id="dl"></div>';
    window.HX.live(() => load(rider), 20000); load(rider);
  }
  async function load(rider) {
    const d = await get(rider ? '/restaurant/delivery/mine' : '/restaurant/delivery', { branchId: window.HX.branchId() });
    rows = list(d, 'deliveries', 'orders'); paint(rider);
  }
  function paint(rider) {
    const tb = el.querySelector('#tb'); if (tb) { tb.innerHTML = window.HX.tabs([['DELIVERY', 'Delivery'], ['PICKUP', 'Pickup']], tab); tb.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => { tab = b.dataset.tab; paint(rider); })); }
    const v = rider ? rows : rows.filter((o) => (tab === 'PICKUP' ? o.orderType === 'PICKUP' : o.orderType !== 'PICKUP'));
    el.querySelector('#dl').innerHTML = v.length ? `<div class="hx-cols">${v.map(card).join('')}</div>` : window.HX.empty('Nothing here', 'New delivery and pickup orders show up automatically.');
    el.querySelectorAll('[data-as]').forEach((b) => b.addEventListener('click', () => assign(b.dataset.as)));
    el.querySelectorAll('[data-st]').forEach((b) => b.addEventListener('click', () => status(b.dataset.id, b.dataset.st)));
    el.querySelectorAll('[data-pk]').forEach((b) => b.addEventListener('click', () => collect(b.dataset.pk)));
  }
  function card(o) {
    const d = o.delivery || {}, st = d.status || (o.pickup && o.pickup.status) || 'PENDING', id = o._id || o.orderId;
    const b = (s, l, c) => `<button class="btn btn-sm ${c || 'btn-primary'}" data-id="${id}" data-st="${s}">${l}</button>`;
    return `<div class="hx-card"><div class="hx-row" style="padding-top:0"><div class="grow"><b>#${E(o.orderNumber)} · ${E(d.contactName || o.customerName || 'Customer')}</b><small class="hx-sub">${mins(o.createdAt)} min ago · ${M(o.totals && o.totals.total)}</small></div>${pill(st, TONE[st] || 'warn')}</div>
      ${d.address ? `<p>${E(d.address)}${d.landmark ? ' · ' + E(d.landmark) : ''}</p>` : ''}${d.phone || o.customerPhone ? `<p><a href="tel:${E(d.phone || o.customerPhone)}">${E(d.phone || o.customerPhone)}</a></p>` : ''}${d.instructions ? `<small class="hx-sub">${E(d.instructions)}</small>` : ''}${d.riderName ? `<p class="hx-sub">Rider: ${E(d.riderName)}</p>` : ''}
      <div class="hx-actions" style="margin-top:var(--space-3)">
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
