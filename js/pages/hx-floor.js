/**
 * hx-floor.js - Tables & orders. The waiter's main screen.
 *   Floor:  live table map (GET /restaurant/tables) -> tap a table to open it or continue its order.
 *   Order:  menu on the left, running order on the right. Dishes with sizes or extras ask first.
 *           "Send to kitchen" posts new items with sendNow; "Bill" generates the bill and opens Bills & payments.
 * Mobile: the order panel slides up from the bottom (CSS in hospitality.css).
 */
(function () {
  const { E, M, can, get, send, list, head, pill, icon, formModal, unwrap } = window.HX;
  let el, floor = [], areas = [], areaId = '', menu = null, cat = 0, q = '', order = null, draft = [], orderType = 'DINE_IN', stopLive = null;

  const TONE = { AVAILABLE: 'ok', OCCUPIED: 'busy', RESERVED: 'plan', AWAITING_BILL: 'warn', PAYMENT_PENDING: 'warn', CLEANING: 'mute' };
  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    el = window.HX.mount('Tables & orders');
    if (!el) return;
    await window.AppShell.whenProfileReady?.();
    window.addEventListener('hashchange', route);
    route();
  }

  function route() {
    if (stopLive) { stopLive(); stopLive = null; }
    const m = location.hash.match(/order=([a-f0-9]+)/i);
    if (m) openOrder(m[1]); else { order = null; draft = []; showFloor(); stopLive = window.HX.live(loadFloor, 15000); }
  }

  /* ---------------- floor ---------------- */
  async function showFloor() {
    el.innerHTML = head('Tables & orders', 'Tap a table to take or continue an order.',
      `${can('restaurant.orders.create') ? '<button class="btn btn-secondary" id="new-other">New takeaway / tab</button>' : ''}<span class="hx-live">Live</span>`) +
      '<div id="areas"></div><div id="floor" class="hx-floor"></div><div class="hx-legend" id="legend"></div><div id="open-others"></div>';
    el.querySelector('#new-other')?.addEventListener('click', newOther);
    const a = await get('/restaurant/areas', { branchId: window.HX.branchId() }); areas = list(a, 'areas');
    loadFloor();
  }

  async function loadFloor() {
    const box = el.querySelector('#floor'); if (!box) return;
    const d = await get('/restaurant/tables', { branchId: window.HX.branchId(), ...(areaId ? { areaId } : {}) });
    floor = list(d, 'tables');
    el.querySelector('#areas').innerHTML = areas.length > 1 ? `<div class="hx-cats hx-tabs"><button class="hx-chip ${areaId ? '' : 'on'}" data-a="">All</button>${areas.map((x) => `<button class="hx-chip ${areaId === x._id ? 'on' : ''}" data-a="${x._id}">${E(x.name)}</button>`).join('')}</div>` : '';
    el.querySelectorAll('[data-a]').forEach((b) => b.addEventListener('click', () => { areaId = b.dataset.a; loadFloor(); }));
    box.innerHTML = floor.length ? floor.map(tile).join('') : window.HX.empty('No tables yet', 'Add tables in the Setup guide.');
    box.querySelectorAll('[data-t]').forEach((b) => b.addEventListener('click', () => tapTable(floor.find((t) => t._id === b.dataset.t))));
    el.querySelector('#legend').innerHTML = Object.keys(TONE).map((k) => pill(k, TONE[k])).join('');
    const others = await get('/restaurant/orders', { branchId: window.HX.branchId(), status: 'OPEN', limit: 50 });
    const mine = list(others, 'orders').filter((o) => o.orderType && o.orderType !== 'DINE_IN');
    el.querySelector('#open-others').innerHTML = mine.length ? `<div class="hx-section"><h2>Takeaway, tabs and deliveries</h2><div class="hx-card flush">${mine.map((o) => `<a class="hx-row" href="#order=${o._id}" style="text-decoration:none;color:inherit"><div class="grow"><b>${E(o.orderNumber)} · ${E((o.orderType || '').replace('_', ' ').toLowerCase())}</b><small class="hx-sub">${E(o.customerName || o.tableName || '')}</small></div><span class="hx-money">${M(o.totals && o.totals.total)}</span></a>`).join('')}</div></div>` : '';
  }

  function tile(t) {
    const o = t.order, st = t.status || 'AVAILABLE';
    return `<button class="hx-tbl hx-st-${TONE[st] || 'mute'}" data-t="${t._id}" style="border-left:4px solid var(--st)">
      ${o && o.readyItems ? `<span class="ready">${o.readyItems} ready</span>` : ''}
      <span class="nm">${E(t.name)}</span><span class="meta">${t.seats || ''} seats${t.waiterName ? ' · ' + E(t.waiterName) : ''}</span>
      <span class="meta">${pill(st, TONE[st])}${t.occupiedMinutes != null ? ` ${t.occupiedMinutes} min` : ''}</span>
      ${o ? `<span class="amt">${M(o.total)}</span>` : ''}</button>`;
  }

  async function tapTable(t) {
    if (!t) return;
    if (t.order && t.order._id) { location.hash = 'order=' + t.order._id; return; }
    if (!can('restaurant.orders.create')) return window.UI.toast.info('You cannot open tables');
    formModal({ title: `Open ${t.name}`, maxWidth: '380px', submitText: 'Open table', fields: [{ name: 'guestCount', label: 'How many guests?', type: 'number', value: Math.min(t.seats || 2, 2), min: 1, max: 100 }], onSubmit: async (v) => {
      const r = await send('post', '/restaurant/orders', { branchId: window.HX.branchId(), tableId: t._id, orderType: 'DINE_IN', guestCount: v.guestCount || 1 });
      const o = r && unwrap(r, 'order'); if (o && o._id) { location.hash = 'order=' + o._id; return true; } return false;
    } });
  }

  function newOther() {
    formModal({ title: 'New order', submitText: 'Start order', fields: [
      { name: 'orderType', label: 'Type', type: 'select', options: [['TAKEAWAY', 'Takeaway'], ['BAR_TAB', 'Bar tab'], ['COUNTER', 'Counter sale'], ['PICKUP', 'Pickup'], ['DELIVERY', 'Delivery']] },
      { row: [{ name: 'customerName', label: 'Customer name' }, { name: 'customerPhone', label: 'Phone' }] },
      { name: 'address', label: 'Delivery address (delivery only)' },
    ], onSubmit: async (v) => {
      const body = { branchId: window.HX.branchId(), orderType: v.orderType, ...(v.customerName ? { customerName: v.customerName } : {}), ...(v.customerPhone ? { customerPhone: v.customerPhone } : {}) };
      if (v.orderType === 'DELIVERY') { if (!v.address || !v.customerPhone) { window.UI.toast.warning('Delivery needs a phone and an address'); return false; } body.delivery = { contactName: v.customerName, phone: v.customerPhone, address: v.address }; }
      const r = await send('post', '/restaurant/orders', body); const o = r && unwrap(r, 'order');
      if (o && o._id) { location.hash = 'order=' + o._id; return true; } return false;
    } });
  }

  /* ---------------- order ---------------- */
  async function openOrder(id) {
    el.innerHTML = '<div class="hx-card"><p class="hx-sub">Opening order…</p></div>';
    const od = await get('/restaurant/orders/' + id);
    if (!od) { window.UI.toast.error('Could not open that order'); location.hash = ''; return; }
    order = unwrap(od, 'order'); orderType = order.orderType || 'DINE_IN';
    const md = await get('/restaurant/menu', { branchId: order.branchId || window.HX.branchId(), orderType });
    menu = md || { categories: [] }; cat = 0; q = '';
    paint();
    stopLive = window.HX.live(refreshOrder, 20000);
  }

  async function refreshOrder() {
    if (!order || document.querySelector('.modal-backdrop')) return;
    const od = await get('/restaurant/orders/' + order._id); if (od) { order = unwrap(od, 'order'); paintCart(); }
  }

  const liveItems = () => (order.items || []).filter((i) => i.status !== 'CANCELLED');
  const lineTotal = (i) => (i.unitPrice || 0) * (i.quantity || 1);

  function paint() {
    const cats = menu.categories || [];
    const items = q ? cats.flatMap((c) => c.items).filter((i) => i.name.toLowerCase().includes(q.toLowerCase())) : (cats[cat] ? cats[cat].items : []);
    el.innerHTML = head(`${order.tableName ? 'Table ' + order.tableName : (order.orderType || '').replace('_', ' ')} · ${order.orderNumber}`, `${order.guestCount || 0} guests${order.waiterName ? ' · ' + order.waiterName : ''}`,
      `<a class="btn btn-secondary" href="hx-floor.html">Back to tables</a>`) + `
      <div class="hx-order"><div class="hx-order-menu">
        <input class="input" id="srch" placeholder="Search dishes" value="${E(q)}" style="margin-bottom:var(--space-3)">
        ${q ? '' : `<div class="hx-cats">${cats.map((c, i) => `<button class="hx-chip ${i === cat ? 'on' : ''}" data-c="${i}">${E(c.name)}</button>`).join('')}</div>`}
        <div class="hx-dishes">${items.map(dish).join('') || window.HX.empty('No dishes', 'Add dishes in Menu.')}</div></div>
        <aside class="hx-cart" id="cart"></aside></div>`;
    el.querySelectorAll('[data-c]').forEach((b) => b.addEventListener('click', () => { cat = +b.dataset.c; paint(); }));
    el.querySelector('#srch').addEventListener('input', window.UI.debounce((e) => { q = e.target.value; paint(); el.querySelector('#srch').focus(); }, 250));
    el.querySelectorAll('[data-d]').forEach((b) => b.addEventListener('click', () => pick(cats.flatMap((c) => c.items).find((i) => i._id === b.dataset.d))));
    paintCart();
  }

  function dish(i) {
    const price = i.effectivePrice != null ? M(i.effectivePrice) : 'Choose size';
    return `<button class="hx-dish" data-d="${i._id}" ${i.available === false ? 'disabled' : ''}>${i.image ? `<img src="${E(i.image)}" alt="" loading="lazy">` : ''}<span class="in"><b>${E(i.name)}</b><span class="pr">${price}</span>${i.available === false ? `<span class="tag">${i.unavailableReason === 'OUT_OF_STOCK' ? 'Out of stock' : 'Not available'}</span>` : i.portionsLeft != null && i.portionsLeft <= 5 ? `<span class="tag">${i.portionsLeft} left</span>` : ''}</span></button>`;
  }

  function pick(item) {
    if (!item) return;
    const variants = (item.variants || []).filter((v) => v.active !== false), groups = (item.modifierGroups || []).filter(Boolean);
    if (!variants.length && !groups.length) return addDraft(item, null, [], 1, '');
    const fields = [];
    if (variants.length) fields.push({ name: 'variant', label: item.requireVariant ? 'Size *' : 'Size', type: 'select', options: variants.map((v) => [v._id, `${v.name}${v.price != null ? ' · ' + M(v.price) : v.priceDelta ? ' · ' + (v.priceDelta > 0 ? '+' : '') + M(v.priceDelta) : ''}`]), required: false });
    groups.forEach((g, gi) => {
      fields.push({ heading: `${g.name}${g.required ? ' (required)' : ''}${g.max ? ` · up to ${g.max}` : ''}` });
      (g.options || []).filter((o) => o.active !== false && !o.soldOut).forEach((o, oi) => fields.push({ name: `m_${gi}_${oi}`, label: `${o.name}${o.priceDelta ? ' (+' + M(o.priceDelta) + ')' : ''}`, type: 'checkbox' }));
    });
    fields.push({ name: 'qty', label: 'Quantity', type: 'number', value: 1, min: 1 }, { name: 'notes', label: 'Notes for the kitchen', placeholder: 'No onions, well done…', type: 'text' });
    formModal({ title: item.name, submitText: 'Add to order', maxWidth: '460px', fields, onSubmit: async (v) => {
      const mods = []; let bad = '';
      groups.forEach((g, gi) => {
        const chosen = (g.options || []).filter((o) => o.active !== false && !o.soldOut).map((o, oi) => ({ o, on: v[`m_${gi}_${oi}`] })).filter((x) => x.on);
        if (g.required && chosen.length < Math.max(1, g.min || 1)) bad = `Choose ${g.name}`;
        if (g.max && chosen.length > g.max) bad = `${g.name}: choose at most ${g.max}`;
        chosen.forEach((x) => mods.push({ groupId: g._id, optionId: x.o._id, name: x.o.name }));
      });
      if (bad) { window.UI.toast.warning(bad); return false; }
      if (item.requireVariant && !v.variant) { window.UI.toast.warning('Choose a size'); return false; }
      addDraft(item, variants.find((x) => x._id === v.variant) || null, mods, v.qty || 1, v.notes || ''); return true;
    } });
  }

  function addDraft(item, variant, mods, qty, notes) {
    const key = [item._id, variant && variant._id, mods.map((m) => m.optionId).sort().join(','), notes].join('|');
    const ex = draft.find((d) => d.key === key);
    if (ex) ex.quantity += qty; else draft.push({ key, menuItemId: item._id, name: item.name, variantId: variant && variant._id, variantName: variant && variant.name, modifiers: mods, notes, quantity: qty, price: variant && variant.price != null ? variant.price : item.effectivePrice });
    paintCart(true);
  }

  function paintCart(open) {
    const c = el.querySelector('#cart'); if (!c) return;
    const sent = liveItems(), t = order.totals || {}, draftTotal = draft.reduce((a, d) => a + (d.price || 0) * d.quantity, 0), ready = sent.filter((i) => i.status === 'READY').length;
    c.classList.toggle('open', !!open || c.classList.contains('open'));
    c.innerHTML = `<div class="hx-cart-head" id="cart-head"><div><h3>Order</h3><small class="hx-sub">${sent.length} sent · ${draft.length} new</small></div><span class="hx-money">${M((t.total || 0) + draftTotal)}</span></div>
      <div class="hx-cart-body">
        ${draft.map((d, i) => `<div class="hx-line draft"><span class="nm">${E(d.name)}${d.variantName ? ' · ' + E(d.variantName) : ''}</span><span class="hx-money">${M((d.price || 0) * d.quantity)}</span>
          <span class="sub">${d.modifiers.map((m) => E(m.name)).join(', ')}${d.notes ? ' · “' + E(d.notes) + '”' : ''}</span>
          <span class="hx-qty"><button data-m="${i}" aria-label="Less">−</button><span>${d.quantity}</span><button data-p="${i}" aria-label="More">+</button></span></div>`).join('')}
        ${sent.map((i) => `<div class="hx-line"><span class="nm">${i.quantity}× ${E(i.name)}${i.variantName ? ' · ' + E(i.variantName) : ''}</span><span class="hx-money">${M(lineTotal(i))}</span>
          <span class="sub">${pill(i.status, { READY: 'ok', PREPARING: 'busy', SERVED: 'mute', DRAFT: 'warn', HELD: 'warn' }[i.status] || 'plan')} ${(i.modifiers || []).map((m) => E(m.name)).join(', ')}
          ${['DRAFT', 'HELD', 'PENDING', 'ACCEPTED'].includes(i.status) && can('restaurant.orders.create') ? `<a href="#" data-x="${i._id}" style="color:var(--color-danger)">Remove</a>` : ''}</span></div>`).join('')}
        ${!draft.length && !sent.length ? '<p class="hx-sub" style="padding:var(--space-4) 0">Tap a dish to add it.</p>' : ''}
      </div>
      <div class="hx-cart-foot"><div class="hx-totals">${t.serviceCharge ? `<div><span>Service charge</span><span>${M(t.serviceCharge)}</span></div>` : ''}${t.tax ? `<div><span>Tax</span><span>${M(t.tax)}</span></div>` : ''}<div class="grand"><span>Total</span><span>${M((t.total || 0) + draftTotal)}</span></div></div>
        <div style="display:grid;gap:var(--space-2);margin-top:var(--space-3)">
          ${draft.length ? '<button class="btn btn-primary" id="send">Send to kitchen</button>' : ''}
          ${ready ? `<button class="btn btn-success" id="serve">Mark ${ready} ready item${ready > 1 ? 's' : ''} served</button>` : ''}
          ${sent.length && !draft.length && can('restaurant.bills.generate') ? '<button class="btn btn-primary" id="bill">Bill &amp; pay</button>' : ''}
          ${draft.length ? '<button class="btn btn-secondary" id="clear">Clear new items</button>' : ''}
        </div></div>`;
    c.querySelector('#cart-head').addEventListener('click', () => c.classList.toggle('open'));
    c.querySelectorAll('[data-m]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); const d = draft[+b.dataset.m]; if (--d.quantity <= 0) draft.splice(+b.dataset.m, 1); paintCart(true); }));
    c.querySelectorAll('[data-p]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); draft[+b.dataset.p].quantity++; paintCart(true); }));
    c.querySelectorAll('[data-x]').forEach((b) => b.addEventListener('click', async (e) => { e.preventDefault(); const reason = await window.HX.ask('Remove item', 'Reason'); if (reason === null) return; if (await act('/items/' + b.dataset.x + '/cancel', { reason, expectedVersion: order.version })) refreshOrder(); }));
    c.querySelector('#clear')?.addEventListener('click', () => { draft = []; paintCart(); });
    c.querySelector('#send')?.addEventListener('click', sendDraft);
    c.querySelector('#serve')?.addEventListener('click', async () => { if (await act('/serve', { allReady: true })) refreshOrder(); });
    c.querySelector('#bill')?.addEventListener('click', toBill);
  }

  async function act(path, body) { const r = await send('post', '/restaurant/orders/' + order._id + path, body); return r; }

  async function sendDraft() {
    const btn = el.querySelector('#send'); window.UI.setButtonLoading(btn, true, 'Sending…');
    const items = draft.map((d) => ({ menuItemId: d.menuItemId, quantity: d.quantity, ...(d.variantId ? { variantId: d.variantId } : {}), ...(d.modifiers.length ? { modifiers: d.modifiers.map((m) => ({ groupId: m.groupId, optionId: m.optionId })) } : {}), ...(d.notes ? { notes: d.notes } : {}) }));
    const r = await act('/items', { items, sendNow: true, expectedVersion: order.version });
    if (r) { draft = []; window.UI.toast.success('Sent to the kitchen'); await refreshOrder(); } else window.UI.setButtonLoading(btn, false);
  }

  async function toBill() {
    const r = await send('post', `/restaurant/orders/${order._id}/bills`, {});
    let b = r && unwrap(r, 'bill');
    if (!(b && b._id)) { const l = await get('/restaurant/bills', { orderId: order._id }); b = list(l, 'bills')[0]; }
    if (b && b._id) location.href = 'hx-bills.html#bill=' + b._id;
  }
})();
