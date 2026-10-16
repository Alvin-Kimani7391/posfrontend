/**
 * wholesale-sales.js - the wholesale sale screen.
 *  - WHOLESALE mode: sells a warehouse's stock from GET /warehouse/catalog, in any unit (piece / bundle / carton),
 *    at wholesale unit prices, to a customer, paid now / part-paid / on credit with a due date.
 *  - RETAIL mode: the same business sells shop-floor stock at retail prices (channel RETAIL).
 * The server prices every line; the client never sends a price (except a permitted manual override).
 * Money: catalog prices arrive in CENTS; everything we send is KES.
 */
(function () {
  const W = window.WS;
  const state = { mode: 'WHOLESALE', whId: '', search: '', page: 1, inStockOnly: true, cart: [], customer: null, payments: [], dueDate: '', busy: false, items: [], settings: {} };
  let contentEl, whs = [], key = null;
  const newKey = () => { if (!key) key = window.Api.newIdempotencyKey(); return key; };
  const touch = () => { key = null; };
  const wh = () => whs.find((w) => w._id === state.whId);

  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    contentEl = window.AppShell.mount({ title: 'Wholesale sales' });
    if (!contentEl) return;
    try { await window.AppShell.whenProfileReady?.(); } catch { /* cached */ }
    if (!W.on('multiWarehouse')) { contentEl.innerHTML = W.subnav('wholesale-sales') + W.featureOff(); return; }
    try { whs = (await W.warehouses(true)).filter((w) => w.status !== 'inactive' && w.allowSales !== false); } catch (e) { contentEl.innerHTML = W.subnav('wholesale-sales') + `<div class="card ws-pad">${W.esc(e.message)}</div>`; return; }
    state.settings = await W.settings();
    if (state.settings.defaultMode === 'RETAIL') state.mode = 'RETAIL';
    const preferred = state.settings.defaultWarehouseId;
    state.whId = (whs.find((w) => w._id === preferred) || whs.find((w) => w.isDefault) || whs[0] || {})._id || '';
    const days = Number(state.settings.defaultPaymentTermsDays) || 0;
    state.dueDate = days ? new Date(Date.now() + days * 86400000).toISOString().slice(0, 10) : '';
    draw();
    window.AppShell.onBranchChange?.(() => { if (state.mode === 'RETAIL') loadCatalog(); });
  }

  function draw() {
    contentEl.innerHTML = W.subnav('wholesale-sales') + W.header('Wholesale sales', 'Sell in bundles and cartons, on credit or paid now. Switch to retail to sell single items from the shop floor.') + `
      <div class="ws-pos">
        <div class="card">
          <div class="ws-toolbar">
            <div class="ws-mode" id="s-mode"><button data-m="WHOLESALE" class="${state.mode === 'WHOLESALE' ? 'active' : ''}">Wholesale</button><button data-m="RETAIL" class="${state.mode === 'RETAIL' ? 'active' : ''}">Retail</button></div>
            <select class="select" id="s-wh" style="${state.mode === 'RETAIL' ? 'display:none' : ''}">${W.whOptions(whs, state.whId)}</select>
            <div class="grow input-group"><span class="input-group-icon">${W.icon('search')}</span><input class="input" id="s-search" placeholder="Search name, SKU or barcode" /></div>
            <label class="text-sm" style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="s-instock" checked /> In stock only</label>
          </div>
          <div id="s-grid"></div><div class="pagination" id="s-pg"></div>
        </div>
        <div class="card ws-cart" id="s-cart"></div>
      </div>`;
    contentEl.querySelectorAll('#s-mode button').forEach((b) => b.addEventListener('click', () => {
      if (b.dataset.m === state.mode) return;
      if (state.cart.length && !window.confirm('Switching mode clears the current cart. Continue?')) return;
      state.mode = b.dataset.m; state.cart = []; state.payments = []; touch(); draw();
    }));
    const whSel = contentEl.querySelector('#s-wh');
    whSel.addEventListener('change', (e) => {
      if (state.cart.length && !window.confirm('Changing warehouse clears the current cart. Continue?')) { e.target.value = state.whId; return; }
      state.whId = e.target.value; state.cart = []; state.page = 1; touch(); renderCart(); loadCatalog();
    });
    contentEl.querySelector('#s-search').addEventListener('input', window.UI.debounce((e) => { state.search = e.target.value.trim(); state.page = 1; loadCatalog(); }));
    contentEl.querySelector('#s-instock').addEventListener('change', (e) => { state.inStockOnly = e.target.checked; state.page = 1; loadCatalog(); });
    renderCart();
    loadCatalog();
  }

  /* ---------------- catalog ---------------- */
  const itemKey = (i) => `${i.productId}:${i.variantId || ''}`;
  function defaultUnit(i) { return i.units.find((u) => u.isDefault) || i.units.find((u) => u.isBase) || i.units[0]; }

  async function loadCatalog() {
    const grid = contentEl.querySelector('#s-grid');
    grid.innerHTML = `<div class="ws-pad ws-muted-row">Loading…</div>`;
    try {
      if (state.mode === 'WHOLESALE') {
        if (!state.whId) { grid.innerHTML = `<div class="ws-pad">${window.UI.emptyStateHtml({ icon: 'inventory', title: 'No sellable warehouse', message: 'Create a warehouse (with "Can sell" on) first.' })}</div>`; return; }
        const { data } = await window.Api.get('/warehouse/catalog', { warehouseId: state.whId, branchId: W.branchOf(wh()) || undefined, search: state.search, page: state.page, limit: 24, inStockOnly: state.inStockOnly ? 'true' : 'false' });
        state.items = data.items;
        grid.innerHTML = data.items.length ? `<div class="ws-cat-grid">${data.items.map((i, n) => {
          const d = defaultUnit(i); const sellable = i.availableQuantity > 0 && !i.trackSerialNumber;
          return `<button class="ws-prod" data-n="${n}" ${sellable ? '' : 'disabled'}>
            <span class="nm">${W.esc(i.name)}</span><span class="sk">${W.esc(i.sku || '')}</span>
            <span class="pr">${W.cents(d.wholesalePrice)} <small class="text-muted">/ ${W.esc(d.name)}</small></span>
            <span class="st">${i.trackSerialNumber ? 'Serial-tracked: sell from retail' : i.units.map((u) => `${W.num(u.available)} ${W.esc(u.name)}`).slice(0, 3).join(' · ')}</span></button>`;
        }).join('')}</div>` : `<div class="ws-pad">${window.UI.emptyStateHtml({ icon: 'box', title: state.search ? 'No products match' : 'No stock in this warehouse', message: 'Receive a purchase into the warehouse or add stock under Warehouses & stock.' })}</div>`;
        grid.querySelectorAll('.ws-prod').forEach((b) => b.addEventListener('click', () => addWholesale(state.items[Number(b.dataset.n)])));
        W.pager(contentEl.querySelector('#s-pg'), data, (p) => { state.page = p; loadCatalog(); });
      } else {
        const { data } = await window.Api.get('/products', { search: state.search, page: state.page, limit: 24, status: 'active', branchId: window.AppShell.getActiveBranchId() });
        state.items = data.items;
        grid.innerHTML = data.items.length ? `<div class="ws-cat-grid">${data.items.map((p, n) => `<button class="ws-prod" data-n="${n}">
          <span class="nm">${W.esc(p.name)}</span><span class="sk">${W.esc(p.sku || '')}</span><span class="pr">${window.UI.formatMoney(p.sellingPrice)}${p.hasVariants ? ' <small class="text-muted">+ variants</small>' : ''}</span></button>`).join('')}</div>`
          : `<div class="ws-pad">${window.UI.emptyStateHtml({ icon: 'box', title: 'No products found' })}</div>`;
        grid.querySelectorAll('.ws-prod').forEach((b) => b.addEventListener('click', () => addRetail(state.items[Number(b.dataset.n)])));
        W.pager(contentEl.querySelector('#s-pg'), data, (p) => { state.page = p; loadCatalog(); });
      }
    } catch (e) { grid.innerHTML = `<div class="ws-pad">${window.UI.emptyStateHtml({ icon: 'alert', title: 'Could not load products', message: e.message })}</div>`; }
  }

  /* ---------------- cart ---------------- */
  function addWholesale(item) {
    const k = itemKey(item); const ex = state.cart.find((l) => l.key === k);
    if (ex) ex.qty = Number(ex.qty) + 1;
    else state.cart.push({ key: k, mode: 'WHOLESALE', item, productId: item.productId, variantId: item.variantId, name: item.name, unitId: defaultUnit(item).unitId, qty: 1, override: '' });
    touch(); renderCart();
  }
  function addRetail(p) {
    if (p.hasVariants) {
      return window.ProductPicker.open({ onSelect: ({ product, variant }) => pushRetail(product, variant) });
    }
    pushRetail(p, null);
  }
  function pushRetail(p, v) {
    const k = `${p._id}:${v?._id || ''}`; const ex = state.cart.find((l) => l.key === k);
    if (ex) ex.qty = Number(ex.qty) + 1;
    else state.cart.push({ key: k, mode: 'RETAIL', productId: p._id, variantId: v?._id, name: p.name + (v ? ` (${Object.values(v.attributes || {}).join(', ')})` : ''), price: v ? v.sellingPrice : p.sellingPrice, qty: 1, override: '' });
    touch(); renderCart();
  }
  const unitOf = (l) => l.item.units.find((u) => String(u.unitId || '') === String(l.unitId || '')) || l.item.units[0];
  const linePrice = (l) => (l.mode === 'WHOLESALE' ? unitOf(l).wholesalePrice / 100 : l.price);   // KES per sold unit
  const lineUnitPrice = (l) => (l.override !== '' && l.override != null && W.can('sales.price_override') ? Number(l.override) : linePrice(l));
  const lineTotal = (l) => lineUnitPrice(l) * (Number(l.qty) || 0);
  const total = () => state.cart.reduce((s, l) => s + lineTotal(l), 0);
  const paid = () => state.payments.reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const stockIssue = (l) => {
    if (l.mode !== 'WHOLESALE') return '';
    const u = unitOf(l); return Number(l.qty) > u.available + 1e-9 ? `Only ${W.num(u.available)} ${u.name} available` : '';
  };

  function renderCart() {
    const el = contentEl.querySelector('#s-cart');
    const reqCust = state.mode === 'WHOLESALE' && state.settings.requireCustomerForWholesale;
    el.innerHTML = `
      <div class="card-header"><h3 style="margin:0">${state.mode === 'WHOLESALE' ? 'Wholesale invoice' : 'Retail sale'}</h3>${state.cart.length ? '<button class="btn btn-ghost btn-sm" id="c-clear">Clear</button>' : ''}</div>
      <div class="ws-pad" style="border-bottom:1px solid var(--color-border)">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:var(--space-2)">
          <div>${state.customer ? `<div class="font-semibold text-sm">${W.esc(state.customer.name)}</div><div class="text-xs text-muted">${W.esc(state.customer.phone || '')}${state.customer.outstandingBalance > 0 ? ` · owes ${W.kes(state.customer.outstandingBalance)}` : ''}</div>`
            : `<div class="text-sm text-muted">${reqCust ? 'Customer required' : 'Walk-in customer'}</div>`}</div>
          <div style="display:flex;gap:6px"><button class="btn btn-secondary btn-sm" id="c-cust">${state.customer ? 'Change' : 'Choose customer'}</button>${state.customer ? '<button class="btn btn-ghost btn-sm" id="c-cust-x">✕</button>' : ''}</div>
        </div>
      </div>
      <div class="ws-cart-lines" id="c-lines">${state.cart.length ? state.cart.map(lineHtml).join('') : `<div class="ws-pad">${window.UI.emptyStateHtml({ icon: 'bag', title: 'Cart is empty', message: 'Tap a product to add it.' })}</div>`}</div>
      <div class="ws-tot" id="c-tot"></div>
      <div class="ws-pad" id="c-pay" style="border-top:1px solid var(--color-border)"></div>
      <div class="ws-pad" style="border-top:1px solid var(--color-border)"><button class="btn btn-primary btn-block btn-lg" id="c-go" ${state.cart.length ? '' : 'disabled'}>Complete sale</button></div>`;
    el.querySelector('#c-clear')?.addEventListener('click', () => { state.cart = []; state.payments = []; touch(); renderCart(); });
    el.querySelector('#c-cust').addEventListener('click', () => window.CustomerPicker.open({ onSelect: (c) => { state.customer = c; touch(); renderCart(); } }));
    el.querySelector('#c-cust-x')?.addEventListener('click', () => { state.customer = null; touch(); renderCart(); });
    el.querySelector('#c-go').addEventListener('click', checkout);
    el.querySelectorAll('.ws-line').forEach((row) => {
      const l = state.cart.find((x) => x.key === row.dataset.k);
      row.querySelector('[data-f="qty"]').addEventListener('input', (e) => { l.qty = e.target.value; touch(); refresh(); });
      row.querySelector('[data-f="unit"]')?.addEventListener('change', (e) => { l.unitId = e.target.value || null; touch(); renderCart(); });
      row.querySelector('[data-f="ovr"]')?.addEventListener('input', (e) => { l.override = e.target.value; touch(); refresh(); });
      row.querySelector('[data-f="rm"]').addEventListener('click', () => { state.cart = state.cart.filter((x) => x !== l); touch(); renderCart(); });
    });
    renderPay(); refresh();
  }
  function lineHtml(l) {
    const u = l.mode === 'WHOLESALE' ? unitOf(l) : null;
    return `<div class="ws-line" data-k="${l.key}">
      <div class="top"><div class="nm">${W.esc(l.name)}</div><button class="btn btn-ghost btn-sm btn-icon" data-f="rm" title="Remove">${W.icon('trash')}</button></div>
      <div class="ctl">
        <input class="input" data-f="qty" type="number" min="0" step="any" value="${l.qty}" />
        ${u ? `<select class="select" data-f="unit">${l.item.units.map((x) => `<option value="${x.unitId || ''}" ${String(x.unitId || '') === String(l.unitId || '') ? 'selected' : ''}>${W.esc(W.unitLabel(x))}</option>`).join('')}</select>` : ''}
        ${W.can('sales.price_override') ? `<input class="input" data-f="ovr" type="number" min="0" step="any" placeholder="${linePrice(l).toFixed(2)}" title="Override price per unit" style="width:96px" />` : ''}
        <span class="text-sm text-muted">× ${window.UI.formatMoney(lineUnitPrice(l))}</span>
        <strong class="text-sm" data-f="lt" style="margin-left:auto"></strong></div>
      <div class="text-xs" data-f="warn" style="color:var(--color-danger)"></div></div>`;
  }
  function refresh() {
    contentEl.querySelectorAll('.ws-line').forEach((row) => {
      const l = state.cart.find((x) => x.key === row.dataset.k); if (!l) return;
      row.querySelector('[data-f="lt"]').textContent = window.UI.formatMoney(lineTotal(l));
      row.querySelector('[data-f="warn"]').textContent = stockIssue(l);
    });
    const t = total(); const bal = Math.max(0, t - paid());
    contentEl.querySelector('#c-tot').innerHTML = `
      <div class="r"><span>Items</span><span>${state.cart.length}</span></div>
      <div class="r big"><span>Total</span><span>${window.UI.formatMoney(t)}</span></div>
      <div class="text-xs text-muted">Tax and any preset discounts are applied by the server on completion.</div>
      <div class="r"><span>Paid now</span><span>${window.UI.formatMoney(paid())}</span></div>
      <div class="r" style="${bal > 0 ? 'color:var(--color-warning);font-weight:600' : ''}"><span>${bal > 0 ? 'On credit' : 'Balance'}</span><span>${window.UI.formatMoney(bal)}</span></div>`;
    const due = contentEl.querySelector('#c-due-wrap'); if (due) due.style.display = bal > 0 ? '' : 'none';
  }
  function renderPay() {
    const box = contentEl.querySelector('#c-pay');
    box.innerHTML = `
      <div class="ws-section-title"><h3 style="font-size:var(--text-sm)">Payment</h3>
        <div style="display:flex;gap:6px"><button class="ws-chip-btn" id="p-full">Paid in full</button><button class="ws-chip-btn" id="p-credit">All on credit</button></div></div>
      <div id="p-list">${state.payments.map((p, i) => `<div class="ws-pay" data-i="${i}" style="margin-bottom:var(--space-2)">
        <select class="select" data-f="m">${['CASH', 'MPESA', 'CARD', 'BANK', 'OTHER'].map((m) => `<option ${p.method === m ? 'selected' : ''}>${m}</option>`).join('')}</select>
        <div style="display:flex;gap:6px"><input class="input" data-f="a" type="number" min="0" step="any" value="${p.amount}" placeholder="Amount" /><input class="input" data-f="r" value="${W.esc(p.reference || '')}" placeholder="Ref" style="max-width:110px" />
        <button class="btn btn-ghost btn-sm btn-icon" data-f="x">${W.icon('trash')}</button></div></div>`).join('')}</div>
      <button class="ws-chip-btn" id="p-add">${W.icon('plus')} Add payment</button>
      <div class="field" id="c-due-wrap" style="margin-top:var(--space-3)"><label>Credit due date</label><input class="input" type="date" id="c-due" value="${state.dueDate}" /><span class="field-hint">Unpaid balance becomes customer credit (needs a customer with a credit limit).</span></div>`;
    box.querySelector('#p-add').addEventListener('click', () => { state.payments.push({ method: 'CASH', amount: '', reference: '' }); touch(); renderPay(); refresh(); });
    box.querySelector('#p-full').addEventListener('click', () => { state.payments = [{ method: 'CASH', amount: Math.round(total() * 100) / 100, reference: '' }]; touch(); renderPay(); refresh(); });
    box.querySelector('#p-credit').addEventListener('click', () => { state.payments = []; touch(); renderPay(); refresh(); });
    box.querySelector('#c-due').addEventListener('input', (e) => { state.dueDate = e.target.value; touch(); });
    box.querySelectorAll('[data-i]').forEach((row) => {
      const p = state.payments[Number(row.dataset.i)];
      row.querySelector('[data-f="m"]').addEventListener('change', (e) => { p.method = e.target.value; touch(); });
      row.querySelector('[data-f="a"]').addEventListener('input', (e) => { p.amount = e.target.value; touch(); refresh(); });
      row.querySelector('[data-f="r"]').addEventListener('input', (e) => { p.reference = e.target.value; touch(); });
      row.querySelector('[data-f="x"]').addEventListener('click', () => { state.payments.splice(Number(row.dataset.i), 1); touch(); renderPay(); refresh(); });
    });
  }

  /* ---------------- checkout ---------------- */
  let lastTry = 0;
  async function checkout() {
    if (state.busy || Date.now() - lastTry < 500) return; lastTry = Date.now();
    if (!state.cart.length) return window.UI.toast.error('Cart is empty');
    if (state.cart.some((l) => !(Number(l.qty) > 0))) return window.UI.toast.error('Enter a quantity for every line');
    const bad = state.cart.find((l) => stockIssue(l)); if (bad) return window.UI.toast.error(`${bad.name}: ${stockIssue(bad)}`);
    const wholesale = state.mode === 'WHOLESALE';
    if (wholesale && state.settings.requireCustomerForWholesale && !state.customer) return window.UI.toast.error('Choose a customer for a wholesale sale');
    const t = total(); const bal = Math.max(0, t - paid());
    if (paid() > t + 0.009) return window.UI.toast.error('Payments are more than the total');
    if (bal > 0.009 && !state.customer) return window.UI.toast.error('Choose a customer to sell on credit');
    const branchId = wholesale ? W.branchOf(wh()) : window.AppShell.getActiveBranchId();
    const payload = {
      branchId, channel: state.mode, warehouseId: wholesale ? state.whId : undefined, customerId: state.customer?._id,
      dueDate: bal > 0.009 && state.dueDate ? state.dueDate : undefined,
      items: state.cart.map((l) => ({ productId: l.productId, variantId: l.variantId || undefined, quantity: Number(l.qty), unitId: wholesale && l.unitId ? l.unitId : undefined,
        overridePrice: l.override !== '' && W.can('sales.price_override') ? Number(l.override) : undefined })),
      payments: state.payments.filter((p) => Number(p.amount) > 0).map((p) => ({ method: p.method, amount: Number(p.amount), reference: p.reference || undefined, amountTendered: p.method === 'CASH' ? Number(p.amount) : undefined })),
    };
    const btn = contentEl.querySelector('#c-go'); state.busy = true; window.UI.setButtonLoading(btn, true, 'Saving…');
    try {
      const { data } = await window.Api.post('/sales', payload, { idempotencyKey: newKey() });
      window.UI.toast.success(`Sale ${data.sale.receiptNumber} completed${bal > 0.009 ? ' (on credit)' : ''}`);
      key = null; state.cart = []; state.payments = []; state.customer = null; state.busy = false;
      renderCart(); loadCatalog();
      if (data.receipt) window.ReceiptView.showReceiptModal(data.receipt, { autoPrint: false });
    } catch (err) {
      state.busy = false; if (document.body.contains(btn)) window.UI.setButtonLoading(btn, false);
      const hint = err.code === 'SHIFT_REQUIRED' ? ' Open a cash shift under Registers & Shifts first.' : '';
      window.UI.toast.error(err.message + hint);
    }
  }
})();
