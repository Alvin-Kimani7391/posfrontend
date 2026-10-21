/**
 * hx-order.js - the order workspace as a MODAL, usable from any restaurant screen.
 *   HX.order.open(orderId, {onChange,onClose}) / openTable(table, opts) / start(type, opts)
 * Bill, Bill & pay, payment and receipt open on top of it (hx-pay.js): the waiter never leaves the screen.
 */
(function (window) {
  const HX = window.HX; if (!HX) return;
  const { E, M, can, get, send, pill, formModal, unwrap } = HX;
  const menuCache = {};
  const TYPE_NAMES = [['DINE_IN', 'Dine in'], ['TAKEAWAY', 'Take away'], ['DELIVERY', 'Delivery'], ['BAR_TAB', 'Tab']];
  async function loadMenu(branchId, orderType) {
    const k = branchId + orderType, c = menuCache[k]; if (c && Date.now() - c.t < 120000) return c.d;
    const d = (await get('/restaurant/menu', { branchId, orderType })) || { categories: [] }; menuCache[k] = { t: Date.now(), d }; return d;
  }
  const LOADING = () => `<div class="hx-ow-loading" aria-busy="true">${HX.skel('rows', 5)}</div>`;
  async function open(id, opts = {}) {
    // The dialog appears on the tap (with a placeholder); the order and menu fill it in as soon as they arrive.
    const early = HX.modal({ title: 'Loading order…', maxWidth: '1120px', cls: 'hx-modal-order', body: LOADING() });
    const gone = () => !early.el || !early.el.isConnected;
    const [od, warm] = await Promise.all([get('/restaurant/orders/' + id), loadMenu(HX.branchId(), 'DINE_IN').catch(() => null)]);
    if (gone()) return null;
    if (!od) { early.close(); window.UI.toast.error('Could not open that order'); return null; }
    let order = unwrap(od, 'order'); const type = order.orderType || 'DINE_IN';
    const menu = (type === 'DINE_IN' && (!order.branchId || String(order.branchId) === String(HX.branchId())) && warm) ? warm : await loadMenu(order.branchId || HX.branchId(), type);
    if (gone()) return null;
    let draft = [], cat = 0, q = '', root = null, timer = null, busy = false;
    const title = `${order.tableName ? 'Table ' + order.tableName : (order.orderType || '').replace('_', ' ')} · ${order.orderNumber}`;
    const modalAbove = () => { const all = document.querySelectorAll('.modal-backdrop'); return all.length && all[all.length - 1] !== root.closest('.modal-backdrop'); };
    const $ = (s) => root.querySelector(s);
    const live = () => (order.items || []).filter((i) => i.status !== 'CANCELLED');
    const lineTotal = (i) => (i.unitPrice || 0) * (i.quantity || 1);
    const m = early; root = early.el;
    root.querySelector('.modal-header h3').textContent = title;
    root.querySelector('.modal-body').innerHTML = '<div class="hx-ow"><div class="hx-order-menu"><div class="hx-owbar"></div><div class="hx-recent" id="ow-recent"></div><div class="hx-cats" id="ow-cats"></div><div class="hx-dishes" id="ow-dishes"></div></div><aside class="hx-cart" id="ow-cart"></aside></div>';
    paintBar(); paintMenu(); paintCart(); paintRecent();
    timer = setInterval(() => { if (!root.isConnected) { clearInterval(timer); return; } if (!document.hidden && !busy && !modalAbove()) refresh(); }, 15000);
    const obs = new MutationObserver(() => { if (!root.isConnected) { obs.disconnect(); clearInterval(timer); if (opts.onClose) opts.onClose(); } });
    obs.observe(document.body, { childList: true });
    async function refresh() { const r = await get('/restaurant/orders/' + order._id); if (r && root.isConnected) { order = unwrap(r, 'order'); paintBar(); paintCart(); if (opts.onChange) opts.onChange(order); } }
    const act = (path, body) => send('post', '/restaurant/orders/' + order._id + path, body);
    function paintBar() {
      const d = order.delivery || {}, bar = $('.hx-owbar');
      if (!$('#ow-q')) {
        bar.innerHTML = `<div class="hx-owmeta"></div><input class="input" id="ow-q" placeholder="Search dishes" value="${E(q)}" autocomplete="off">`;
        $('#ow-q').addEventListener('input', window.UI.debounce((e) => { q = e.target.value; paintMenu(); }, 150));
      }
      $('.hx-owmeta').innerHTML = `<span>${order.guestCount || 0} guests${order.waiterName ? ' · ' + E(order.waiterName) : ''}</span>${order.customerName ? `<span>${E(order.customerName)}${order.customerPhone ? ' · ' + E(order.customerPhone) : ''}</span>` : ''}${d.address ? `<span>📍 ${E(d.address)}</span>` : ''}`;
    }
    function allItems() { return (menu.categories || []).flatMap((c) => c.items.map((i) => Object.assign(i, { _cat: c.name }))); }
    function inDraft(id) { return draft.filter((d) => d.menuItemId === id).reduce((n, d) => n + d.quantity, 0); }
    function paintMenu() {
      const cats = menu.categories || [];
      const all = allItems();
      const items = q ? all.filter((i) => i.name.toLowerCase().includes(q.toLowerCase())) : (cats[cat] ? cats[cat].items : []);
      $('#ow-cats').innerHTML = q ? '' : cats.map((c, i) => `<button type="button" class="hx-cat ${i === cat ? 'on' : ''}" data-c="${i}">${HX.art.dishImg({ name: c.name }, c.name)}<span><b>${E(c.name)}</b><small>${c.items.length} dish${c.items.length === 1 ? '' : 'es'}</small></span></button>`).join('');
      $('#ow-dishes').innerHTML = items.map(dish).join('') || HX.empty('No dishes', 'Add dishes in Menu.');
      root.querySelectorAll('[data-c]').forEach((b) => b.addEventListener('click', () => { cat = +b.dataset.c; paintMenu(); }));
      root.querySelectorAll('[data-d]').forEach((b) => {
        const go = () => { if (b.classList.contains('off')) return; pick(all.find((i) => i._id === b.dataset.d)); };
        b.addEventListener('click', go);
        b.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === b) { e.preventDefault(); go(); } });
      });
      root.querySelectorAll('[data-dm]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); const idx = draft.map((d) => d.menuItemId).lastIndexOf(b.dataset.dm); if (idx < 0) return; if (--draft[idx].quantity <= 0) draft.splice(idx, 1); paintCart(); paintMenu(); }));
    }
    function dish(i) {
      const off = i.available === false, n = inDraft(i._id);
      const price = i.effectivePrice != null ? M(i.effectivePrice) : 'Choose size';
      const badge = off ? (i.unavailableReason === 'OUT_OF_STOCK' ? 'Out of stock' : 'Not available') : (i.portionsLeft != null && i.portionsLeft <= 5 ? `${i.portionsLeft} left` : '');
      return `<div class="hx-dish ${off ? 'off' : ''} ${n ? 'has' : ''}" role="button" tabindex="${off ? -1 : 0}" data-d="${i._id}"><div class="ph">${HX.art.dishImg(i, i._cat)}${badge ? `<span class="bd ${off ? '' : 'low'}">${badge}</span>` : ''}</div><span class="cat"><i></i>${E(i._cat || '')}</span><b>${E(i.name)}</b><span class="ft"><span class="pr">${price}</span>${off ? '' : `<span class="hx-step">${n ? `<button type="button" data-dm="${i._id}" aria-label="Remove one">−</button><span>${n}</span>` : ''}<button type="button" class="pl" tabindex="-1" aria-label="Add">+</button></span>`}</span></div>`;
    }
    function pick(item) {
      if (!item) return;
      const variants = (item.variants || []).filter((v) => v.active !== false), groups = (item.modifierGroups || []).filter(Boolean);
      if (!variants.length && !groups.length) return addDraft(item, null, [], 1, '');
      const fields = [];
      if (variants.length) fields.push({ name: 'variant', label: item.requireVariant ? 'Size *' : 'Size', type: 'select', options: variants.map((v) => [v._id, `${v.name}${v.price != null ? ' · ' + M(v.price) : v.priceDelta ? ' · ' + (v.priceDelta > 0 ? '+' : '') + M(v.priceDelta) : ''}`]) });
      groups.forEach((g, gi) => { fields.push({ heading: `${g.name}${g.required ? ' (required)' : ''}${g.max ? ` · up to ${g.max}` : ''}` }); (g.options || []).filter((o) => o.active !== false && !o.soldOut).forEach((o, oi) => fields.push({ name: `m_${gi}_${oi}`, label: `${o.name}${o.priceDelta ? ' (+' + M(o.priceDelta) + ')' : ''}`, type: 'checkbox' })); });
      fields.push({ name: 'qty', label: 'Quantity', type: 'number', value: 1, min: 1 }, { name: 'notes', label: 'Notes for the kitchen', placeholder: 'No onions, well done…' });
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
      const key = [item._id, variant && variant._id, mods.map((x) => x.optionId).sort().join(','), notes].join('|');
      const ex = draft.find((d) => d.key === key);
      if (ex) ex.quantity += qty; else draft.push({ key, menuItemId: item._id, name: item.name, variantId: variant && variant._id, variantName: variant && variant.name, modifiers: mods, notes, quantity: qty, price: variant && variant.price != null ? variant.price : item.effectivePrice });
      paintCart(); paintMenu();
    }
    function thumb(name, itemId) { const it = allItems().find((x) => x._id === itemId) || { name }; return `<span class="th">${HX.art.dishImg(it, it._cat)}</span>`; }
    async function paintRecent() {
      const d = await get('/restaurant/orders', { branchId: order.branchId || HX.branchId(), status: 'OPEN', limit: 20 }); if (!root || !root.isConnected) return;
      const rows = (d && (d.orders || (d.data && d.data.orders))) || (Array.isArray(d) ? d : []);
      const box = $('#ow-recent'); if (!box) return;
      box.innerHTML = rows.map((o) => { const mn = HX.mins(o.createdAt), late = mn > 45; return `<button type="button" class="hx-rc ${o._id === order._id ? 'cur' : ''}" data-ro="${o._id}"><span class="t"><span>${E(o.orderNumber || '')}</span><span class="mn ${late ? 'late' : ''}">${mn} min</span></span><b>${o.tableName ? 'Table ' + E(o.tableName) : E((o.orderType || '').replace('_', ' ').toLowerCase().replace(/^./, (x) => x.toUpperCase()))}</b><span class="bar"><i class="${late ? 'late' : ''}" style="width:${Math.min(100, Math.round(mn / 60 * 100))}%"></i></span></button>`; }).join('');
      box.querySelectorAll('[data-ro]').forEach((b) => b.addEventListener('click', () => { if (b.dataset.ro === order._id) return; if (draft.length && !confirm('Discard the new items you have not sent?')) return; const nid = b.dataset.ro; const bd = root.closest('.modal-backdrop'); const cb = bd && bd.querySelector('.modal-close'); if (opts.onClose) { const oc = opts.onClose; opts = Object.assign({}, opts, { onClose: null }); if (cb) cb.click(); setTimeout(() => { oc(); open(nid, Object.assign({}, opts, { onClose: oc })); }, 150); } else { if (cb) cb.click(); setTimeout(() => open(nid, opts), 150); } }));
    }
    function paintCart() {
      const c = $('#ow-cart'); if (!c) return;
      const sent = live(), t = order.totals || {}, dtot = draft.reduce((a, d) => a + (d.price || 0) * d.quantity, 0), ready = sent.filter((i) => i.status === 'READY').length;
      const isOpen = order.status === 'OPEN' || !order.status;
      const sub = (t.itemsTotal != null ? t.itemsTotal : Math.max(0, (t.total || 0) - (t.tax || 0) - (t.serviceCharge || 0))) + dtot;
      const cur = TYPE_NAMES.some(([k]) => k === type) ? type : null;
      c.innerHTML = `<div class="hx-cart-head"><div class="ct"><h3>Order ${E(order.orderNumber || '')}</h3><small>${E(HX.dt(order.createdAt || Date.now()))}</small></div>
        <div class="hx-types">${TYPE_NAMES.map(([k, l]) => `<span class="${k === cur ? 'on' : ''}">${l}</span>`).join('')}</div>
        <small style="display:block;margin-top:10px">${order.tableName ? 'Table ' + E(order.tableName) + ' · ' : ''}${order.guestCount || 0} guest${order.guestCount === 1 ? '' : 's'}${order.waiterName ? ' · ' + E(order.waiterName) : ''}${order.customerName ? ' · ' + E(order.customerName) : ''}</small></div>
        <div class="hx-cart-sec"><span>Ordered menus</span><small>${sent.length + draft.length} item${sent.length + draft.length === 1 ? '' : 's'} · ${draft.length} new</small></div>
        <div class="hx-cart-body">
          ${draft.map((d, i) => `<div class="hx-line draft">${thumb(d.name, d.menuItemId)}<span class="nm">${E(d.name)}${d.variantName ? ' · ' + E(d.variantName) : ''}</span><span class="hx-money">${M((d.price || 0) * d.quantity)}</span><span class="sub">${d.modifiers.map((x) => E(x.name)).join(', ')}${d.notes ? ' · “' + E(d.notes) + '”' : ''}${!d.modifiers.length && !d.notes ? M(d.price || 0) + ' each' : ''}</span><span class="hx-qty"><button type="button" data-m="${i}" aria-label="Less">−</button><span>${d.quantity}</span><button type="button" data-p="${i}" aria-label="More">+</button></span></div>`).join('')}
          ${sent.map((i) => `<div class="hx-line">${thumb(i.name, i.menuItemId)}<span class="nm">${i.quantity}× ${E(i.name)}${i.variantName ? ' · ' + E(i.variantName) : ''}</span><span class="hx-money">${M(lineTotal(i))}</span><span class="sub">${pill(i.status, { READY: 'ok', PREPARING: 'busy', SERVED: 'mute', DRAFT: 'warn', HELD: 'warn' }[i.status] || 'plan')} ${(i.modifiers || []).map((x) => E(x.name)).join(', ')} ${['DRAFT', 'HELD', 'PENDING', 'ACCEPTED'].includes(i.status) && can('restaurant.orders.create') ? `<a href="#" data-x="${i._id}" class="hx-danger">Remove</a>` : ''}</span></div>`).join('')}
          ${!draft.length && !sent.length ? `<div class="hx-empty-cart">${HX.icon('utensils')}Tap a dish to add it to this order.</div>` : ''}
        </div>
        <div class="hx-cart-foot"><div class="hx-totals"><div><span>Sub total</span><span>${M(sub)}</span></div>${t.serviceCharge ? `<div><span>Service charge</span><span>${M(t.serviceCharge)}</span></div>` : ''}${t.tax ? `<div><span>Tax</span><span>${M(t.tax)}</span></div>` : ''}${t.discount ? `<div><span>Discount</span><span>−${M(t.discount)}</span></div>` : ''}<div class="grand"><span>Amount to be paid</span><span>${M((t.total || 0) + dtot)}</span></div></div>
          <div class="hx-cartbtns">
            ${draft.length ? '<button type="button" class="btn btn-primary" id="send">Place order · send to kitchen</button>' : ''}
            ${ready ? `<button type="button" class="btn btn-success" id="serve">Mark ${ready} ready item${ready > 1 ? 's' : ''} served</button>` : ''}
            ${sent.length && !draft.length && isOpen && can('restaurant.bills.generate') ? '<div class="hx-btnrow"><button type="button" class="btn btn-secondary" id="bill">Bill</button>' + (can('restaurant.bills.pay') ? '<button type="button" class="btn btn-primary" id="billpay">Bill &amp; pay</button>' : '') + '</div>' : ''}
            ${draft.length ? '<button type="button" class="btn btn-secondary" id="clear">Clear new items</button>' : ''}
            ${!isOpen ? `<p class="hx-sub" style="text-align:center">${pill(order.status, 'mute')} This order is closed.</p>` : ''}
          </div></div>`;
      c.querySelectorAll('[data-m]').forEach((b) => b.addEventListener('click', () => { const d = draft[+b.dataset.m]; if (--d.quantity <= 0) draft.splice(+b.dataset.m, 1); paintCart(); paintMenu(); }));
      c.querySelectorAll('[data-p]').forEach((b) => b.addEventListener('click', () => { draft[+b.dataset.p].quantity++; paintCart(); paintMenu(); }));
      c.querySelectorAll('[data-x]').forEach((b) => b.addEventListener('click', async (e) => { e.preventDefault(); const reason = await HX.ask('Remove item', 'Reason'); if (reason === null) return; if (await act('/items/' + b.dataset.x + '/cancel', { reason, expectedVersion: order.version })) refresh(); }));
      const on = (s, f) => c.querySelector(s)?.addEventListener('click', f);
      on('#clear', () => { draft = []; paintCart(); paintMenu(); }); on('#send', sendDraft);
      on('#serve', async () => { if (await act('/serve', { allReady: true })) refresh(); });
      on('#bill', () => HX.bill.forOrder(order._id, { onChange: () => refresh() }));
      on('#billpay', () => HX.bill.forOrder(order._id, { pay: true, onChange: () => refresh() }));
    }
    async function sendDraft() {
      const btn = $('#send'); busy = true; window.UI.setButtonLoading(btn, true, 'Sending…');
      const items = draft.map((d) => ({ menuItemId: d.menuItemId, quantity: d.quantity, ...(d.variantId ? { variantId: d.variantId } : {}), ...(d.modifiers.length ? { modifiers: d.modifiers.map((x) => ({ groupId: x.groupId, optionId: x.optionId })) } : {}), ...(d.notes ? { notes: d.notes } : {}) }));
      const r = await act('/items', { items, sendNow: true, expectedVersion: order.version }); busy = false;
      if (r) { draft = []; paintMenu(); window.UI.toast.success('Sent to the kitchen'); await refresh(); } else window.UI.setButtonLoading(btn, false);
    }
    return m;
  }
  async function openTable(t, opts = {}) {
    if (!t) return;
    if (t.order && t.order._id) return open(t.order._id, opts);
    if (!can('restaurant.orders.create')) return window.UI.toast.info('You cannot open tables');
    formModal({ title: `Open ${t.name}`, maxWidth: '380px', submitText: 'Open table', fields: [{ name: 'guestCount', label: 'How many guests?', type: 'number', value: Math.min(t.seats || 2, 2), min: 1, max: 100 }], onSubmit: async (v) => {
      const r = await send('post', '/restaurant/orders', { branchId: HX.branchId(), tableId: t._id, orderType: 'DINE_IN', guestCount: v.guestCount || 1 });
      const o = r && unwrap(r, 'order'); if (o && o._id) { if (opts.onChange) opts.onChange(o); setTimeout(() => open(o._id, opts), 120); return true; } return false;
    } });
  }
  const TYPES = { TAKEAWAY: 'Takeaway', BAR_TAB: 'Bar tab', COUNTER: 'Counter sale', PICKUP: 'Pickup', DELIVERY: 'Delivery' };
  function start(type, opts = {}) {
    const isDel = type === 'DELIVERY', needsPhone = isDel || type === 'PICKUP', fields = [];
    if (!type) fields.push({ name: 'orderType', label: 'Type', type: 'select', options: Object.entries(TYPES) });
    fields.push({ row: [{ name: 'customerName', label: 'Customer name', required: needsPhone }, { name: 'customerPhone', label: 'Phone', type: 'tel', required: needsPhone }] });
    if (!type || isDel) fields.push({ name: 'address', label: 'Delivery address', required: isDel }, { name: 'landmark', label: 'Landmark (optional)' }, { name: 'instructions', label: 'Delivery notes (optional)' });
    formModal({ title: type ? `New ${TYPES[type].toLowerCase()} order` : 'New order', submitText: 'Start order', maxWidth: '480px', fields, onSubmit: async (v) => {
      const ty = type || v.orderType;
      const body = { branchId: HX.branchId(), orderType: ty, ...(v.customerName ? { customerName: v.customerName } : {}), ...(v.customerPhone ? { customerPhone: v.customerPhone } : {}) };
      if (ty === 'DELIVERY') { if (!v.address || !v.customerPhone) { window.UI.toast.warning('Delivery needs a phone and an address'); return false; } body.delivery = { contactName: v.customerName, phone: v.customerPhone, address: v.address, ...(v.landmark ? { landmark: v.landmark } : {}), ...(v.instructions ? { instructions: v.instructions } : {}) }; }
      if (ty === 'PICKUP' && !v.customerPhone) { window.UI.toast.warning('Pickup needs the customer phone'); return false; }
      const r = await send('post', '/restaurant/orders', body); const o = r && unwrap(r, 'order');
      if (o && o._id) { if (opts.onChange) opts.onChange(o); setTimeout(() => open(o._id, opts), 120); return true; } return false;
    } });
  }
  HX.order = { open, openTable, start, TYPES, prefetch: () => { try { loadMenu(HX.branchId(), 'DINE_IN'); } catch (e) { /* ignore */ } } };
})(window);