/** hx-bills.js - Bills & payments. "To pay" = every open order not yet billed + every open / part-paid bill. Everything opens as a modal. Paid / Void history. Manager "Verify mobile money". */
(function () {
  const { E, M, can, get, list, head, pill, dt } = window.HX;
  let el, tab = 'TOPAY';
  const TONE = { OPEN: 'warn', PARTIAL: 'busy', PAID: 'ok', VOID: 'mute', WRITTEN_OFF: 'mute' };
  const canVerify = () => can('restaurant.payments.verify') || can('accommodation.folio.verify');
  document.addEventListener('DOMContentLoaded', init);
  async function init() {
    el = window.HX.mount('Bills & payments'); if (!el) return;
    await window.AppShell.whenProfileReady?.();
    const m = location.hash.match(/bill=([a-f0-9]+)/i); show();
    if (m) { history.replaceState(null, '', location.pathname); window.HX.bill.open(m[1], { onChange: show }); }
    window.HX.live(() => { if (!document.querySelector('.modal-backdrop') && tab === 'TOPAY') show(true); }, 20000);
  }
  const label = (x) => (x.tableName ? 'Table ' + x.tableName : (x.orderType || '').replace('_', ' ').toLowerCase());
  async function show(quiet) {
    const tabs = [['TOPAY', 'To pay'], ['PAID', 'Paid'], ['VOID', 'Void']]; if (canVerify()) tabs.push(['VERIFY', 'Verify mobile money']);
    el.innerHTML = head('Bills & payments', 'Everything waiting for payment, in one place.', can('restaurant.orders.create') ? '<a class="btn btn-secondary" href="hx-floor.html">Tables &amp; orders</a>' : '') + window.HX.tabs(tabs, tab) + '<div id="bl"></div>';
    el.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => { tab = b.dataset.tab; show(); }));
    const box = el.querySelector('#bl'); if (!quiet) box.innerHTML = window.HX.skel('rows');
    const bid = window.HX.branchId();
    if (tab === 'VERIFY') return window.HX.verify.render(box, () => {});
    if (tab === 'PAID' || tab === 'VOID') {
      const d = await get('/restaurant/bills', { branchId: bid, status: tab, limit: 50 }); const rows = list(d, 'bills');
      box.innerHTML = rows.length ? `<div class="hx-card flush">${rows.map(billRow).join('')}</div>` : window.HX.empty('Nothing here', 'Bills appear here once they are paid or voided.'); return wire(box);
    }
    const [ob, pb, od] = await Promise.all([get('/restaurant/bills', { branchId: bid, status: 'OPEN', limit: 100 }), get('/restaurant/bills', { branchId: bid, status: 'PARTIAL', limit: 100 }), get('/restaurant/orders', { branchId: bid, status: 'OPEN', limit: 100 })]);
    const bills = [...list(ob, 'bills'), ...list(pb, 'bills')], billed = new Set(bills.map((b) => String(b.orderId)));
    const orders = list(od, 'orders').filter((o) => !billed.has(String(o._id)) && o.billStatus !== 'PAID' && (o.items || []).some((i) => i.status !== 'CANCELLED'));
    const total = bills.reduce((s, b) => s + (b.balance != null ? b.balance : b.total || 0), 0) + orders.reduce((s, o) => s + ((o.totals && o.totals.total) || 0), 0);
    box.innerHTML = (bills.length || orders.length) ? `<div class="hx-sub" style="margin-bottom:var(--space-3)">${bills.length + orders.length} waiting · ${M(total)} to collect</div><div class="hx-card flush">
      ${bills.map((b) => `<div class="hx-row"><button type="button" class="hx-linkrow grow" data-bill="${b._id}"><b>${E(b.billNumber)} · ${E(label(b))}</b><small class="hx-sub">${E(b.waiterName || '')} ${b.createdAt ? '· ' + dt(b.createdAt) : ''}</small></button>${pill(b.status, TONE[b.status])}<span class="hx-money">${M(b.balance != null ? b.balance : b.total)}</span>${can('restaurant.bills.pay') ? `<button class="btn btn-sm btn-primary" data-pay="${b._id}">Pay</button>` : ''}</div>`).join('')}
      ${orders.map((o) => `<div class="hx-row"><button type="button" class="hx-linkrow grow" data-ord="${o._id}"><b>${E(o.orderNumber)} · ${E(label(o))}</b><small class="hx-sub">${E(o.waiterName || o.customerName || '')} · not billed yet</small></button>${pill('To bill', 'warn')}<span class="hx-money">${M(o.totals && o.totals.total)}</span>${can('restaurant.bills.generate') ? `<button class="btn btn-sm btn-secondary" data-prev="${o._id}">Bill</button>` : ''}${can('restaurant.bills.pay') && can('restaurant.bills.generate') ? `<button class="btn btn-sm btn-primary" data-bp="${o._id}">Bill &amp; pay</button>` : ''}</div>`).join('')}</div>`
      : window.HX.empty('All paid up', 'Open orders and unpaid bills show here until they are paid.');
    wire(box);
  }
  const billRow = (b) => `<div class="hx-row"><button type="button" class="hx-linkrow grow" data-bill="${b._id}"><b>${E(b.billNumber)} · ${E(label(b))}</b><small class="hx-sub">${E(b.waiterName || '')} ${b.createdAt ? '· ' + dt(b.createdAt) : ''}</small></button>${pill(b.status, TONE[b.status])}<span class="hx-money">${M(b.total)}</span></div>`;
  function wire(box) {
    const again = () => show(true);
    box.querySelectorAll('[data-bill]').forEach((b) => b.addEventListener('click', () => window.HX.bill.open(b.dataset.bill, { onChange: again })));
    box.querySelectorAll('[data-pay]').forEach((b) => b.addEventListener('click', () => window.HX.bill.open(b.dataset.pay, { onChange: again, autoPay: true })));
    box.querySelectorAll('[data-ord]').forEach((b) => b.addEventListener('click', () => window.HX.order.open(b.dataset.ord, { onChange: again, onClose: again })));
    box.querySelectorAll('[data-prev]').forEach((b) => b.addEventListener('click', () => window.HX.bill.forOrder(b.dataset.prev, { onChange: again })));
    box.querySelectorAll('[data-bp]').forEach((b) => b.addEventListener('click', () => window.HX.bill.forOrder(b.dataset.bp, { pay: true, onChange: again })));
  }
})();