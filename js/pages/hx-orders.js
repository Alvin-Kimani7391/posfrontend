/** hx-orders.js - Orders board: KPI cards, status tabs and one card per order. Tap a card to open the order (add items, bill, pay). API: GET /restaurant/orders */
(function () {
  const { E, M, can, get, list, pill, mins } = window.HX;
  let el, rows = [], tab = 'ALL', q = '', busy = false;
  document.addEventListener('DOMContentLoaded', init);
  const items = (o) => (o.items || []).filter((i) => i.status !== 'CANCELLED');
  const kind = (o) => {
    if (o.status === 'CANCELLED' || o.status === 'VOID') return 'CANCELLED';
    if (o.status && o.status !== 'OPEN') return 'DONE';
    const it = items(o);
    if (it.length && it.every((i) => i.status === 'SERVED' || i.status === 'READY')) return 'READY';
    if (it.some((i) => i.status === 'PREPARING' || i.status === 'ACCEPTED' || i.status === 'PENDING')) return 'COOKING';
    return 'OPEN';
  };
  const TABS = [['ALL', 'All Orders'], ['OPEN', 'Open'], ['COOKING', 'In Progress'], ['READY', 'Ready'], ['DONE', 'Completed'], ['CANCELLED', 'Cancelled']];
  const where = (o) => (o.tableName ? 'Table ' + o.tableName : (o.orderType || 'order').replace(/_/g, ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase()));
  async function init() {
    el = window.HX.mount('Orders'); if (!el) return;
    await window.AppShell.whenProfileReady?.();
    if (!can('restaurant.orders.view')) { el.innerHTML = window.HX.empty('No access', 'Ask the owner or a manager for access to orders.'); return; }
    if (window.HX.order && window.HX.order.prefetch) window.HX.order.prefetch();
    await load(); window.HX.live(() => { if (!document.querySelector('.modal-backdrop')) load(); }, 15000);
  }
  async function load() {
    if (busy) return; busy = true;
    try { const d = await get('/restaurant/orders', { branchId: window.HX.branchId(), limit: 100 }); rows = list(d, 'orders'); paint(); } finally { busy = false; }
  }
  function paint() {
    const cnt = (k) => rows.filter((o) => kind(o) === k).length, total = rows.length;
    const kp = [['Open', cnt('OPEN'), '#f6a73a'], ['In progress', cnt('COOKING'), '#1a73e8'], ['Ready', cnt('READY'), '#16a34a'], ['Completed', cnt('DONE'), '#7c5cff'], ['Cancelled', cnt('CANCELLED'), '#ef3b36']];
    const shown = rows.filter((o) => (tab === 'ALL' || kind(o) === tab) && (!q || (where(o) + ' ' + (o.orderNumber || '') + ' ' + (o.customerName || '')).toLowerCase().includes(q)));
    el.innerHTML = `<div class="dr-title"><h1>Orders</h1><span class="dr-spacer"></span><button class="btn btn-secondary" id="all">All orders &amp; history</button><input class="dr-search" id="q" placeholder="Search order, table or customer" value="${E(q)}">${can('restaurant.orders.create') ? '<button class="btn btn-primary" id="new">+ New order</button>' : ''}</div>
      <div class="dr-kpis">${kp.map(([l, n, c]) => `<div class="dr-kpi solid" style="--c:${c}"><div><small>${l}</small><b>${n}</b></div><i>${n}</i></div>`).join('')}</div>
      <div class="dr-tabs">${TABS.map(([k, l]) => `<button data-t="${k}" class="${k === tab ? 'on' : ''}">${l} (${k === 'ALL' ? total : cnt(k)})</button>`).join('')}</div>
      <div class="dr-orders">${shown.map(card).join('') || '<div style="grid-column:1/-1">' + window.HX.empty('No orders', 'Orders you take at the POS appear here.') + '</div>'}</div>`;
    el.querySelectorAll('[data-t]').forEach((b) => b.addEventListener('click', () => { tab = b.dataset.t; paint(); }));
    const s = el.querySelector('#q'); s.addEventListener('input', window.UI.debounce((e) => { q = e.target.value.toLowerCase(); paint(); const n = el.querySelector('#q'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }, 250));
    el.querySelector('#all')?.addEventListener('click', () => window.HX.showHistory('orders'));
    el.querySelector('#new')?.addEventListener('click', () => { location.href = 'hx-floor.html'; });
    el.querySelectorAll('[data-o]').forEach((c) => c.addEventListener('click', () => window.HX.order.open(c.dataset.o, { onChange: load, onClose: load })));
  }
  function card(o) {
    const it = items(o), k = kind(o), tone = { OPEN: 'warn', COOKING: 'blue', READY: '', DONE: 'mute', CANCELLED: 'bad' }[k];
    const t = o.createdAt ? new Date(o.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
    const paid = o.billStatus === 'PAID' || (o.status && o.status !== 'OPEN' && k === 'DONE');
    return `<div class="dr-oc" data-o="${o._id}"><div class="h"><span class="ic" style="background:${({ DINE_IN: '#1a73e8', TAKEAWAY: '#f97316', DELIVERY: '#7c5cff', PICKUP: '#0ea5a4', BAR_TAB: '#ec4899' })[o.orderType] || '#1a73e8'}">${({ DINE_IN: '🍽️', TAKEAWAY: '🥡', DELIVERY: '🛵', PICKUP: '🛍️', BAR_TAB: '🍸' })[o.orderType] || '🧾'}</span><div style="flex:1"><b>#${E(o.orderNumber || '')}</b><small>${E(where(o))}${o.guestCount ? ' · ' + o.guestCount + ' guests' : ''}</small></div><span class="dr-badge ${tone}">${{ OPEN: 'Open', COOKING: 'In progress', READY: 'Ready', DONE: 'Completed', CANCELLED: 'Cancelled' }[k]}</span></div>
      <div class="row"><span>${E(o.waiterName || o.customerName || '')}</span><b>${t}${o.createdAt ? ' · ' + mins(o.createdAt) + ' min' : ''}</b></div>
      ${it.slice(0, 3).map((i) => `<div class="ln"><span>${E(i.name)}${i.variantName ? ' - ' + E(i.variantName) : ''}</span><b>×${i.quantity}</b></div>`).join('')}
      ${it.length > 3 ? `<a style="color:var(--dr-blue);font-weight:600">+${it.length - 3} more items</a>` : ''}
      <div class="f"><span class="dr-badge ${paid ? '' : 'warn'}">${paid ? 'Billed' : 'Unpaid'}</span><b>${M((o.totals && o.totals.total) || 0)}</b></div></div>`;
  }
})();
