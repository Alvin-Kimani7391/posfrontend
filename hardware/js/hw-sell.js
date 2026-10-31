/* Hardware workspace — Overview, Counter till, Quotes -> Orders -> Invoices */
(function () {
  const { Api } = window, HW = window.HW, E = HW.E, $ = HW.$, $$ = HW.$$, M = HW.money;
  const br = () => HW.S.branch;
  const PAY = ['CASH', 'MPESA', 'MOBILE_MONEY', 'CARD', 'BANK', 'OTHER'];
  const stockOf = (p) => (p.stockHint && p.stockHint.retailQuantity !== undefined) ? p.stockHint.retailQuantity : (p.stock ?? p.quantity ?? null);

  /* ===================== reusable line cart (till + quote builder) ===================== */
  HW.Cart = function (root, { getCustomer, onChange, withPrice = true }) {
    const st = { lines: [], note: '' }; let seq = 0, timer, ready = false;
    const canPrice = HW.can('sales.price_override') || HW.can('hardware.pricing');
    const unitsOf = (p) => [{ id: '', name: p.unit || 'unit', factor: 1 }].concat((p.units || []).filter((u) => u.status !== 'inactive').map((u) => ({ id: u._id, name: u.name, factor: u.factor })));
    const total = () => st.lines.reduce((s, l) => s + (l.price || 0) * (Number(l.qty) || 0), 0);
    const api = {
      st, total,
      lines: () => st.lines.filter((l) => Number(l.qty) > 0),
      clear() { st.lines = []; draw(); },
      load(items) { st.lines = items; draw(); reprice(); },
      add(p, unitName) {
        const units = unitsOf(p); const u = unitName ? units.find((x) => x.name === unitName) : null;
        const ex = st.lines.find((l) => l.productId === (p._id || p.productId) && l.unitId === (u ? u.id : ''));
        if (ex) ex.qty = Number(ex.qty) + 1; else st.lines.push({ key: ++seq, productId: p._id || p.productId, name: p.name, units, unitId: u ? u.id : '', qty: 1, price: p.sellingPrice || 0, list: p.sellingPrice || 0, type: 'RETAIL', override: null, stock: stockOf(p), measurable: p.measurable });
        draw(); reprice();
      },
    };
    async function reprice() {
      clearTimeout(timer); timer = setTimeout(async () => {
        const items = st.lines.filter((l) => Number(l.qty) > 0 && l.override === null); if (!items.length) { draw(); return; }
        try {
          const { data } = await Api.post('/hardware/price-quote', { customerId: getCustomer() || undefined, items: items.map((l) => ({ productId: l.productId, unitId: l.unitId || undefined, quantity: Number(l.qty) })) });
          items.forEach((l, i) => { const r = data.items[i]; if (r) { l.price = r.unitPrice; l.list = r.listPrice; l.type = r.priceType; l.saving = r.saving; l.err = null; } });
        } catch (e) { items.forEach((l) => { l.err = e.message; }); HW.err(e.message); }
        draw();
      }, 250);
    }
    api.reprice = reprice;
    function draw() {
      const box = $('[data-cart]', root); if (!box) return;
      box.innerHTML = st.lines.length ? st.lines.map((l) => `<div class="hw-line" data-k="${l.key}"><div><b>${E(l.name)}</b>${l.type === 'CONTRACT' ? ' ' + HW.badge('CONTRACT', 'Contract price') : ''}<small style="display:block;color:#667080">${l.err ? `<span style="color:#dc2626">${E(l.err)}</span>` : (l.stock !== null && l.stock !== undefined ? `In stock: ${HW.num(l.stock)}` : '')}${l.saving > 0 ? ` · saves ${M(l.saving)}` : ''}</small></div>
        <input type="number" min="0" step="${l.measurable === false ? 1 : 'any'}" value="${l.qty}" data-f="qty" title="Quantity"><select data-f="unit" title="Unit">${l.units.map((u) => `<option value="${E(u.id)}" ${u.id === l.unitId ? 'selected' : ''}>${E(u.name)}</option>`).join('')}</select><button type="button" class="hw-btn s x" data-f="del">×</button>
        ${withPrice ? `<div style="grid-column:1/-1;display:flex;gap:8px;align-items:center;font-size:13px"><span style="color:#667080">Price</span>${canPrice ? `<input type="number" min="0" step="any" value="${l.price}" data-f="price" style="max-width:110px">` : `<b>${M(l.price)}</b>`}<span style="color:#667080">${l.override !== null ? '(manual) <a href="#" data-f="auto">reset</a>' : ''}</span><span style="flex:1"></span><b>${M((l.price || 0) * (Number(l.qty) || 0))}</b></div>` : ''}</div>`).join('') : HW.empty('Cart is empty', 'Search or scan a product to add it.');
      $$('.hw-line', box).forEach((row) => { const l = st.lines.find((x) => x.key === +row.dataset.k);
        row.querySelector('[data-f=qty]').onchange = (e) => { l.qty = e.target.value; reprice(); if (onChange) onChange(); };
        row.querySelector('[data-f=unit]').onchange = (e) => { l.unitId = e.target.value; l.override = null; reprice(); };
        row.querySelector('[data-f=del]').onclick = () => { st.lines = st.lines.filter((x) => x !== l); draw(); };
        const pr = row.querySelector('[data-f=price]'); if (pr) pr.onchange = (e) => { l.price = Number(e.target.value); l.override = l.price; draw(); };
        const au = row.querySelector('[data-f=auto]'); if (au) au.onclick = (e) => { e.preventDefault(); l.override = null; reprice(); }; });
      if (ready && onChange) onChange();
    }
    api.draw = draw; draw(); ready = true; if (onChange) setTimeout(onChange, 0); return api;
  };
  /** Product search box + result tiles. onAdd(product, unitName). */
  HW.productFinder = (root, onAdd) => {
    const inp = $('[data-q]', root), out = $('[data-res]', root);
    const show = (rows) => { out.innerHTML = rows.length ? rows.map((p, i) => `<div class="hw-prod" data-i="${i}"><b>${E(p.name)}</b><small>${E([p.sku, p.brand].filter(Boolean).join(' · '))}</small><small>${stockOf(p) !== null ? 'Stock ' + HW.num(stockOf(p)) + ' ' + E(p.unit || '') : ''}</small><div class="pc">${M(p.sellingPrice)} <small>/ ${E(p.unit || 'unit')}</small></div></div>`).join('') : HW.empty('No product found', 'Try a different word or scan the barcode.'); $$('.hw-prod', out).forEach((d) => d.onclick = () => onAdd(rows[+d.dataset.i])); };
    const find = async (term) => { const { data } = await Api.get('/products', { search: term, limit: 24, status: 'active', branchId: br() }); show(HW.list(data)); };
    const tryCode = async (code) => {
      try { const { data } = await Api.get(`/hardware/barcode/${encodeURIComponent(code)}`); const r = await Api.get(`/products/${data.productId}`, { branchId: br() }); const p = r.data.product || r.data; onAdd(p, data.matchedOn !== 'BARCODE' ? data.unitName : null); inp.value = ''; return true; } catch (e) { return false; }
    };
    inp.addEventListener('input', window.UI.debounce(() => { const t = inp.value.trim(); if (t.length >= 2) find(t).catch((e) => HW.err(e.message)); else if (!t) out.innerHTML = ''; }, 300));
    inp.addEventListener('keydown', async (e) => { if (e.key !== 'Enter') return; e.preventDefault(); const t = inp.value.trim(); if (t.length >= 3 && /^[\w-]+$/.test(t) && await tryCode(t)) return; if (t) find(t).catch((x) => HW.err(x.message)); });
    inp.focus();
  };
  const payRowHtml = (p = {}) => `<div class="hw-f" data-pay style="grid-template-columns:120px 1fr 1fr 28px;margin-bottom:6px"><select data-p="method">${PAY.map((m) => `<option ${m === (p.method || 'CASH') ? 'selected' : ''} value="${m}">${HW.human(m)}</option>`).join('')}</select><input type="number" min="0" step="any" data-p="amount" placeholder="Amount" value="${p.amount ?? ''}"><input data-p="reference" placeholder="Reference / code"><button type="button" class="hw-btn s x" data-p="del">×</button></div>`;
  HW.payRows = (root, key = '[data-pays]') => {
    const box = $(key, root); const add = (p) => { const d = document.createElement('div'); d.innerHTML = payRowHtml(p); const row = d.firstChild; row.querySelector('[data-p=del]').onclick = () => row.remove(); box.appendChild(row); };
    return { add, clear: () => { box.innerHTML = ''; }, sum: () => $$('[data-p=amount]', box).reduce((s, i) => s + (Number(i.value) || 0), 0),
      get: () => $$('[data-pay]', box).map((r) => { const o = { method: r.querySelector('[data-p=method]').value, amount: Number(r.querySelector('[data-p=amount]').value) }; const ref = r.querySelector('[data-p=reference]').value.trim(); if (ref) o.reference = ref; return o; }).filter((p) => p.amount > 0) };
  };

  /* ===================== OVERVIEW ===================== */
  HW.V.home = async (el) => {
    let d = {}, alerts = [], canRep = HW.can('hardware.reports');
    if (canRep) { try { d = (await Api.get('/hardware/dashboard', { branchId: br() })).data; } catch (e) { /* module off */ } }
    if (HW.can('hardware.transport')) { try { alerts = (await Api.get('/hardware/transport/vehicles/alerts', { days: 30 })).data.alerts || []; } catch (e) { /* ignore */ } }
    const todo = (n, l, to, er) => `<div class="hw-todo ${er ? 'er' : ''}" data-go="${to}"><b>${n ?? '–'}</b><span>${l}</span></div>`;
    el.innerHTML = `<div class="hw-flow"><a href="#/counter">Sell<small>counter till</small></a><a href="#/quotes">Quote<small>price the job</small></a><a href="#/quotes">Order<small>reserve stock</small></a><a href="#/dispatch">Deliver<small>load · drive · proof</small></a><a href="#/finance">Collect<small>deposits · credit</small></a></div>
    ${canRep ? HW.kpi([['Open orders', d.openOrders ?? 0, 'approved, not fully invoiced', 'b'], ['Pending deliveries', d.pendingDeliveries ?? 0, `${d.overdueDeliveries || 0} overdue`, d.overdueDeliveries ? 'r' : 'y'], ['Quotes expiring (3 days)', d.quotationsExpiringIn3Days ?? 0, '', 'y'], ['Owed by customers', M(d.totalOwed), `${M(d.totalOverdue)} overdue`, d.totalOverdue ? 'r' : 'g']]) : ''}
    <div class="hw-grid hw-g2"><div class="hw-card hz"><h3>Needs attention</h3>
      ${canRep ? todo(d.overdueDeliveries, 'Deliveries past their scheduled time', 'dispatch', d.overdueDeliveries > 0) + todo(d.quotationsExpiringIn3Days, 'Quotations about to expire', 'quotes') + todo(d.outOfStockLines, 'Order lines short on stock (backorders)', 'quotes/back', d.outOfStockLines > 0) + todo((alerts || []).length, 'Vehicle papers / services due in 30 days', 'fleet', (alerts || []).length > 0) : '<p style="color:#667080">Use the menu to open your work screens.</p>'}</div>
      <div class="hw-card hz"><h3>Top customers owing</h3>${HW.tbl([{ h: 'Customer', f: (r) => E(r.name || '') }, { h: 'Owed', c: 'n', f: (r) => M(r.owed) }, { h: 'Limit used', c: 'n', f: (r) => HW.num(r.usedPct, 0) + '%' }], d.contractorBalances || [], { empty: 'No balances owing', hint: canRep ? '' : 'Reports permission needed' })}</div></div>
    <div class="hw-card" style="margin-top:14px"><h3>Quick start</h3><div class="hw-bar">${[['counter', 'New sale'], ['quotes/new', 'New quotation'], ['dispatch/new', 'Schedule delivery'], ['projects', 'Projects & BOQ'], ['deposits', 'Take deposit'], ['shelves', 'Pick list']].filter(([to]) => HW.NAV.find((n) => n[0] === to.split('/')[0] && HW.canAny(n[3]))).map(([to, l]) => `<a class="hw-btn" href="#/${to}">${l}</a>`).join('')}</div></div>`;
    $$('[data-go]', el).forEach((x) => x.onclick = () => HW.go(...x.dataset.go.split('/')));
  };

  /* ===================== COUNTER TILL ===================== */
  let TILL = null;
  HW.V.counter = async (el) => {
    el.innerHTML = `<div class="hw-till"><div><div class="hw-card hz"><h3>Find product <span class="sp"></span><small style="font-weight:400;color:#667080">Scan a barcode or type a name / SKU</small></h3><input data-q placeholder="Scan or search…" style="width:100%;font-size:18px;min-height:50px"><div class="hw-prods" data-res></div></div></div>
      <div class="hw-card hw-cart hz"><h3>Current sale</h3>
        <div style="margin-bottom:10px">${HW.pickHtml('customerId', 'Customer (needed for credit & contractor prices)')}</div>
        <div data-cart></div><div data-tot></div>
        <div style="margin:10px 0"><b style="font-size:13px">PAYMENT</b><div data-pays></div><div class="hw-bar"><button class="hw-btn s" data-addpay>+ Split payment</button><span class="sp"></span><button class="hw-btn s" data-fill>Full amount</button></div><small data-due style="color:#667080"></small></div>
        <button class="hw-btn p big" data-done>Complete sale</button>
        <div class="hw-bar" style="margin-top:8px"><button class="hw-btn" data-quote style="flex:1">Save as quotation</button><button class="hw-btn x" data-clear>Clear</button></div></div></div>`;
    let cust = null;
    const cart = HW.Cart(el, { getCustomer: () => cust, onChange: totals });
    const pays = HW.payRows(el); pays.add({ method: 'CASH' });
    function totals() { const t = cart.total(); $('[data-tot]', el).innerHTML = `<div class="hw-tot"><span>Items</span><span>${cart.lines().length}</span></div><div class="hw-tot big"><span>TOTAL</span><span>${M(t)}</span></div><small style="color:#667080">Tax and discounts are applied when the sale is saved.</small>`; const due = t - pays.sum(); $('[data-due]', el).textContent = !cust && due > 0.005 && pays.sum() > 0 ? 'Short payment needs a customer (credit).' : (due > 0.005 && pays.sum() > 0 ? `${M(due)} will go on credit` : ''); }
    HW.bindCustomer(el, 'customerId', (c) => { cust = HW.id(c); cart.reprice(); });
    $('[name=customerId]', el).previousElementSibling.addEventListener('input', () => { cust = null; });
    HW.productFinder(el, (p, u) => cart.add(p, u));
    el.addEventListener('input', (e) => { if (e.target.matches('[data-p]')) totals(); });
    $('[data-addpay]', el).onclick = () => pays.add({});
    $('[data-fill]', el).onclick = () => { const f = $('[data-p=amount]', el); if (f) { f.value = cart.total().toFixed(2); totals(); } };
    $('[data-clear]', el).onclick = () => { cart.clear(); };
    $('[data-quote]', el).onclick = () => { if (!cart.lines().length) return HW.err('Add items first'); HW.quoteForm({ customerId: cust, customerName: $('.hw-pick input[type=text]', el).value, lines: cart.st.lines }); };
    $('[data-done]', el).onclick = async () => {
      const lines = cart.lines(); if (!lines.length) return HW.err('Add items first');
      const payments = pays.get(); const paid = payments.reduce((s, p) => s + p.amount, 0); const t = cart.total();
      if (paid < t - 0.005 && !cust) return HW.err('Pick a customer to put the balance on credit, or take full payment.');
      const body = { branchId: br(), channel: 'RETAIL', customerId: cust || undefined, items: lines.map((l) => ({ productId: l.productId, unitId: l.unitId || undefined, quantity: Number(l.qty), overridePrice: l.override !== null ? l.override : undefined })), payments };
      const r = await HW.run(async () => (await Api.post('/sales', body)).data); if (!r) return;
      const sale = r.sale || r; const cname = $('.hw-pick input[type=text]', el).value;
      cart.clear(); pays.clear(); pays.add({ method: 'CASH' }); totals();
      HW.modal({ title: 'Sale complete', body: `<div class="hw-note ok"><b>${E(sale.receiptNumber || sale.invoiceNumber || 'Saved')}</b> · Total ${M(sale.total)}${sale.change ? ' · Change ' + M(sale.change) : ''}</div><p>Next: does this customer need the goods delivered?</p>`, actions: [{ label: 'Done' }, { label: 'Schedule delivery', cls: 'p', fn: () => { HW.deliveryForm({ saleId: sale._id || sale.id, customerId: cust, customerName: cname }); } }] });
    };
    totals();
    if (HW.S.pending) { const q = $('[data-q]', el); q.value = HW.S.pending; HW.S.pending = ''; q.dispatchEvent(new Event('input')); }
  };

  /* ===================== QUOTES -> ORDERS -> INVOICES ===================== */
  let QS = { tab: 'ALL', search: '' };
  const OPENST = ['APPROVED', 'PARTIALLY_FULFILLED'];
  const qTotal = (q) => (q.total !== undefined ? q.total : (q.subtotal || 0) + (q.deliveryCharge || 0));
  const remaining = (l) => Math.max(0, (l.quantity || 0) - (l.fulfilledQty || 0));
  HW.V.quotes = async (el, arg) => {
    if (arg === 'new') { await HW.quoteForm({}); location.hash = '#/quotes'; return; }
    if (arg === 'back') QS.tab = 'BACK';
    const tabs = [['ALL', 'All'], ['DRAFT', 'Drafts'], ['SENT', 'Sent'], ['ORDERS', 'Open orders'], ['FULFILLED', 'Invoiced'], ['CLOSED', 'Closed'], ['BACK', 'Backorders']];
    const draw = async () => {
      let body = '';
      if (QS.tab === 'BACK') {
        const { data } = await Api.get('/hardware/quotations/backorders', { branchId: br() });
        body = HW.tbl([{ h: 'Order', f: (r) => E(r.number || '') }, { h: 'Customer', f: (r) => E(HW.name(r.customer)) }, { h: 'PO', f: (r) => E(r.customerPO || '') }, { h: 'Material', f: (r) => E(r.name || '') }, { h: 'Ordered', c: 'n', f: (r) => HW.num(r.ordered) }, { h: 'Delivered', c: 'n', f: (r) => HW.num(r.delivered) }, { h: 'Still owed', c: 'n pr', f: (r) => HW.num(r.backorder) + ' ' + E(r.unit || '') }, { h: 'Stock held', f: (r) => r.reserved ? HW.badge('OPEN', 'Reserved') : HW.badge('PENDING', 'Not reserved') }], data.rows || [], { empty: 'No backorders', hint: 'Every approved line has stock reserved.' });
        $('[data-body]', el).innerHTML = body; return;
      }
      const q = { branchId: br(), limit: 100, search: QS.search || undefined };
      if (['DRAFT', 'SENT', 'FULFILLED'].includes(QS.tab)) q.status = QS.tab;
      const { data } = await Api.get('/hardware/quotations', q); let rows = data.rows || [];
      if (QS.tab === 'ORDERS') rows = rows.filter((r) => OPENST.includes(r.status)); if (QS.tab === 'CLOSED') rows = rows.filter((r) => ['REJECTED', 'EXPIRED', 'CANCELLED'].includes(r.status));
      $('[data-body]', el).innerHTML = HW.tbl([{ h: 'Number', f: (r) => `<b>${E(r.number)}</b>` }, { h: 'Customer', f: (r) => E(HW.name(r.customerId)) }, { h: 'Project', f: (r) => E(HW.name(r.projectId)) }, { h: 'PO / ref', f: (r) => E(r.customerPO || r.reference || '') }, { h: 'Status', f: (r) => HW.badge(r.status) }, { h: 'Valid until', f: (r) => HW.date(r.validUntil) }, { h: 'Total', c: 'n pr', f: (r) => M(qTotal(r)) }], rows, { click: 1, empty: 'No quotations here', hint: 'Create one with “New quotation”.' });
      HW.bindRows(el, rows, (r) => HW.quoteView(r._id));
    };
    el.innerHTML = `<div class="hw-bar"><input data-s placeholder="Search number, customer, PO…" value="${E(QS.search)}" style="min-width:260px"><span class="sp"></span><button class="hw-btn p" data-new>+ New quotation</button></div>${HW.tabs(tabs, QS.tab)}<div data-body></div>`;
    $('[data-s]', el).onchange = (e) => { QS.search = e.target.value.trim(); draw(); };
    $('[data-new]', el).onclick = () => HW.quoteForm({});
    HW.bindTabs(el, (t) => { QS.tab = t; $$('[data-tab]', el).forEach((a) => a.classList.toggle('on', a.dataset.tab === t)); draw(); });
    await draw();
  };

  /** Create or edit a quotation. pre: {customerId, customerName, lines} or {quote}. */
  HW.quoteForm = async (pre = {}) => {
    const q = pre.quote; let cust = q ? HW.id(q.customerId) : pre.customerId; const projects = cust ? await HW.opt.projects(cust).catch(() => []) : [];
    const fields = [{ n: 'projectId', l: 'Project / site', t: 'select', opts: projects.map((p) => [p._id, p.name]), v: q && HW.id(q.projectId) }, { n: 'customerPO', l: 'Customer PO', v: q && q.customerPO }, { n: 'reference', l: 'Reference', v: q && q.reference }, { n: 'validUntil', l: 'Valid until', t: 'date', v: q && q.validUntil }, { n: 'deliveryCharge', l: 'Delivery charge', t: 'number', v: q && q.deliveryCharge }, { n: 'deliveryAddress', l: 'Delivery address', v: q && q.deliveryAddress, w: 1 }, { n: 'notes', l: 'Notes', t: 'textarea', w: 1, v: q && q.notes }, { n: 'terms', l: 'Terms', t: 'textarea', w: 1, v: q && q.terms }, { n: 'reserve', l: 'Hold stock while the quotation is open', t: 'check', v: q ? q.reserve : false }];
    let cart;
    HW.modal({ title: q ? `Edit ${q.number}` : 'New quotation', size: 'lg', body: `<div class="hw-grid hw-split"><div><div class="hw-card"><h3>Add materials</h3><input data-q placeholder="Search or scan…" style="width:100%"><div class="hw-prods" data-res style="max-height:340px;overflow:auto"></div></div></div>
        <div><div class="hw-card"><h3>Customer</h3>${q ? `<b>${E(HW.name(q.customerId))}</b>` : HW.pickHtml('customerId', 'Search customer', pre.customerName || '', pre.customerId || '')}<div data-cart style="margin-top:10px"></div><div class="hw-tot big"><span>Subtotal</span><span data-sub>${M(0)}</span></div></div></div></div><div class="hw-card" style="margin-top:12px"><div data-fs>${HW.form(fields)}</div></div>`,
      onMount: (m) => {
        cart = HW.Cart(m, { getCustomer: () => cust, onChange: () => { const s = $('[data-sub]', m); if (s) s.textContent = M(cart.total()); } });
        HW.productFinder(m, (p, u) => cart.add(p, u));
        if (pre.lines) cart.load(pre.lines.map((l) => ({ ...l, key: l.key + 1000 })));
        if (q) cart.load(q.items.map((i, n) => ({ key: n + 1, productId: HW.id(i.productId), name: i.nameSnapshot, units: [{ id: '', name: i.unitName || 'unit', factor: 1 }].concat(i.unitId ? [{ id: i.unitId, name: i.unitName || 'unit', factor: 1 }] : []), unitId: i.unitId || '', qty: i.quantity, price: i.unitPrice, list: i.unitPrice, type: 'RETAIL', override: i.unitPrice, stock: null })));
        if (!q) HW.bindCustomer(m, 'customerId', async (c) => { cust = HW.id(c); cart.reprice(); const ps = await HW.opt.projects(cust).catch(() => []); const sel = $('[name=projectId]', m); sel.innerHTML = '<option value="">— none —</option>' + ps.map((p) => `<option value="${p._id}">${E(p.name)}</option>`).join(''); });
      },
      actions: [{ label: 'Cancel' }, { label: q ? 'Save changes' : 'Save quotation', cls: 'p', fn: async (m) => {
        let v; try { v = HW.vals(m, fields); } catch (e) { HW.err(e.message); return false; }
        const lines = cart.lines(); if (!lines.length) { HW.err('Add at least one item'); return false; }
        if (!cust) { HW.err('Choose a customer'); return false; }
        const items = lines.map((l) => ({ productId: l.productId, unitId: l.unitId || undefined, quantity: Number(l.qty), unitPrice: l.override !== null ? l.override : undefined }));
        const body = { ...v, items }; if (!body.projectId) delete body.projectId;
        const r = await HW.run(async () => q ? (await Api.put(`/hardware/quotations/${q._id}`, body)).data : (await Api.post('/hardware/quotations', { ...body, branchId: br(), customerId: cust })).data, 'Quotation saved');
        if (!r) return false; const sav = r.quotation || {}; if ((sav.lowMarginLines || []).length) HW.err(`${sav.lowMarginLines.length} line(s) are below your low-margin level`);
        if (location.hash.startsWith('#/quotes')) HW.refresh(); return true; } }] });
  };

  HW.quoteView = async (id) => {
    const q = (await Api.get(`/hardware/quotations/${id}`)).data.quotation; const st = q.status; const open = OPENST.includes(st);
    const acts = [];
    const reload = () => { m.close(); HW.quoteView(id); if (location.hash.startsWith('#/quotes')) HW.refresh(); };
    const A = (label, cls, fn, show = true) => { if (show) acts.push({ label, cls, fn: async () => { await fn(); return false; } }); };
    A('Pro forma', '', () => HW.proforma(id));
    A('Edit', '', () => { m.close(); HW.quoteForm({ quote: q }); }, ['DRAFT', 'SENT'].includes(st));
    A('Send to customer', 'd', async () => { if (await HW.run(() => Api.post(`/hardware/quotations/${id}/send`), 'Marked as sent')) reload(); }, st === 'DRAFT');
    A('Approve → order', 'p', () => HW.modal({ title: 'Approve as order', body: `<p>Stock will be held for ${HW.S.settings && HW.S.settings.reservationDays || 'the configured'} days.</p>${HW.form([{ n: 'allowBackorder', l: 'Allow backorder when stock is short', t: 'check' }])}`, actions: [{ label: 'Cancel' }, { label: 'Approve', cls: 'p', fn: async (e) => { const r = await HW.run(async () => (await Api.post(`/hardware/quotations/${id}/approve`, { allowBackorder: $('[name=allowBackorder]', e).checked })).data, 'Approved'); if (r === false) return false; if (r.backordered && r.backordered.length) HW.err(`${r.backordered.length} line(s) on backorder`); reload(); } }] }), HW.can('hardware.quotes.approve') && ['SENT', 'DRAFT'].includes(st));
    A('Invoice (full / partial)', 'p', () => HW.convertForm(q, reload), open && HW.can('sales.create'));
    A('Schedule delivery', 'd', () => HW.deliveryForm({ quotationId: id, customerId: HW.id(q.customerId), customerName: HW.name(q.customerId), address: q.deliveryAddress, items: q.items.filter((l) => remaining(l) > 0 || open).map((l) => ({ productId: HW.id(l.productId), name: l.nameSnapshot, unitName: l.unitName, quantity: remaining(l) || l.quantity })) }), open);
    A('Extend', '', () => HW.formModal({ title: 'Extend validity', fields: [{ n: 'days', l: 'Extra days', t: 'number', req: 1, v: 7, step: 1 }], onSave: async (v) => { await Api.post(`/hardware/quotations/${id}/extend`, v); reload(); } }), ['DRAFT', 'SENT'].includes(st));
    A('Reject', 'x', () => HW.reason('Reject quotation', async (r) => { await Api.post(`/hardware/quotations/${id}/reject`, { reason: r }); reload(); }), ['DRAFT', 'SENT'].includes(st));
    A('Cancel order', 'x', () => HW.reason('Cancel order', async (r) => { await Api.post(`/hardware/quotations/${id}/cancel`, { reason: r }); reload(); }), open && HW.can('hardware.quotes.approve'));
    const m = HW.modal({ title: `${q.number}  ·  ${HW.human(st)}`, size: 'lg', actions: acts.concat([{ label: 'Close' }]), body: `<div class="hw-grid hw-g2"><div class="hw-card">${HW.dl([['Customer', E(HW.name(q.customerId))], ['Project', E(HW.name(q.projectId))], ['Customer PO', E(q.customerPO || '')], ['Reference', E(q.reference || '')], ['Valid until', HW.date(q.validUntil)], ['Stock held until', q.reservedUntil ? HW.date(q.reservedUntil) : ''], ['Delivery to', E(q.deliveryAddress || '')], ['Delivery charge', q.deliveryCharge ? M(q.deliveryCharge) : '']])}</div><div class="hw-card">${HW.dl([['Subtotal', M(q.subtotal)], ['Total', `<b>${M(qTotal(q))}</b>`], ['Prices locked', q.priceLockedAt ? HW.dt(q.priceLockedAt) : 'Not yet'], ['Notes', E(q.notes || '')]])}${(q.lowMarginLines || []).length ? `<div class="hw-note">${q.lowMarginLines.length} line(s) are below the low-margin level.</div>` : ''}${q.rejectedReason ? `<div class="hw-note er">${E(q.rejectedReason)}</div>` : ''}</div></div>
      <div style="margin-top:12px">${HW.tbl([{ h: 'Material', f: (l) => E(l.nameSnapshot) }, { h: 'Unit', f: (l) => E(l.unitName || '') }, { h: 'Qty', c: 'n', f: (l) => HW.num(l.quantity) }, { h: 'Invoiced', c: 'n', f: (l) => HW.num(l.fulfilledQty || 0) }, { h: 'Left', c: 'n', f: (l) => HW.num(remaining(l)) }, { h: 'Price', c: 'n', f: (l) => M(l.unitPrice) }, { h: 'Total', c: 'n pr', f: (l) => M(l.lineTotal) }], q.items)}</div>
      ${(q.history || []).length ? `<details style="margin-top:10px"><summary><b>History</b></summary>${HW.tbl([{ h: 'When', f: (h) => HW.dt(h.at || h.date) }, { h: 'Action', f: (h) => E(h.action || h.status || '') }, { h: 'Note', f: (h) => E(h.note || h.reason || '') }], q.history.slice().reverse())}</details>` : ''}` });
  };

  HW.convertForm = async (q, done) => {
    let dep = []; try { dep = (await Api.get(`/hardware/customers/${HW.id(q.customerId)}/deposits`)).data.deposits || []; } catch (e) { /* none */ }
    const m = HW.modal({ title: `Invoice ${q.number}`, size: 'lg', body: `<p style="color:#667080">Invoices at the prices locked on the order. Change a quantity to invoice only part of the order; the rest stays open.</p>
      ${HW.tbl([{ h: 'Material', f: (l) => E(l.nameSnapshot) }, { h: 'Left', c: 'n', f: (l) => HW.num(remaining(l)) + ' ' + E(l.unitName || '') }, { h: 'Invoice now', c: 'n', f: (l) => `<input type="number" min="0" step="any" max="${remaining(l)}" value="${remaining(l)}" data-line="${l._id}" style="width:110px">` }], q.items.filter((l) => remaining(l) > 0))}
      ${dep.length ? `<div class="hw-card" style="margin-top:12px"><h3>Customer deposits held</h3>${dep.map((d) => `<div class="hw-bar"><span style="flex:1">${E(d.number)} · balance ${M(d.balance)}</span><input type="number" min="0" step="any" max="${d.balance}" placeholder="Use" data-dep="${d.id}" style="width:120px"></div>`).join('')}</div>` : ''}
      <div class="hw-card" style="margin-top:12px"><h3>Payment now</h3><div data-pays></div><button class="hw-btn s" data-addpay>+ Add payment</button><small style="display:block;margin-top:6px;color:#667080">Leave empty to put the whole invoice on the customer's account (credit limit applies).</small></div>
      <div class="hw-f" style="margin-top:12px">${HW.field({ n: 'dueDate', l: 'Due date (credit)', t: 'date' })}${HW.can('hardware.quotes.reprice') ? HW.field({ n: 'reprice', l: 'Invoice at today’s prices (manager)', t: 'check' }) : ''}${HW.field({ n: 'notes', l: 'Notes', w: 1 })}</div>`,
      actions: [{ label: 'Cancel' }, { label: 'Create invoice', cls: 'p', fn: async (e) => {
        const lines = $$('[data-line]', e).map((i) => ({ lineId: i.dataset.line, quantity: Number(i.value) })).filter((l) => l.quantity > 0);
        if (!lines.length) { HW.err('Nothing to invoice'); return false; }
        const deposits = $$('[data-dep]', e).map((i) => ({ depositId: i.dataset.dep, amount: Number(i.value) })).filter((d) => d.amount > 0);
        const body = { branchId: br(), lines, payments: pays.get() }; if (deposits.length) body.deposits = deposits;
        const due = $('[name=dueDate]', e).value; if (due) body.dueDate = due; const rp = $('[name=reprice]', e); if (rp && rp.checked) body.reprice = true; const nt = $('[name=notes]', e).value.trim(); if (nt) body.notes = nt;
        const r = await HW.run(async () => (await Api.post(`/hardware/quotations/${q._id}/convert`, body)).data, 'Invoice created'); if (!r) return false;
        const left = (r.backorder || []).length; HW.modal({ title: 'Invoice created', body: `<div class="hw-note ok">${E((r.sale && (r.sale.invoiceNumber || r.sale.receiptNumber)) || 'Done')} · ${r.sale ? M(r.sale.total) : ''}</div>${left ? `<p>${left} line(s) still to invoice.</p>` : '<p>Order fully invoiced.</p>'}`, actions: [{ label: 'Close' }, { label: 'Schedule delivery', cls: 'p', fn: () => HW.deliveryForm({ saleId: r.sale && (r.sale._id || r.sale.id), quotationId: q._id, customerId: HW.id(q.customerId), customerName: HW.name(q.customerId), address: q.deliveryAddress }) }] });
        if (done) done(); return true; } }] });
    const pays = HW.payRows(m.el); $('[data-addpay]', m.el).onclick = () => pays.add({});
  };

  HW.proforma = async (id) => {
    const p = (await Api.get(`/hardware/quotations/${id}/proforma`)).data; const it = p.items || p.lines || [];
    HW.modal({ title: p.document || 'Pro forma', size: 'lg', body: `<div style="display:flex;justify-content:space-between;gap:20px;flex-wrap:wrap"><div><h2>${E((p.business || {}).name || '')}</h2>${E((p.business || {}).address || '')}<br>${E((p.business || {}).phone || '')}</div><div style="text-align:right"><b>${E(p.number)}</b><br>Issued ${HW.date(p.issuedAt)}<br>Valid until ${HW.date(p.validUntil)}<br>${p.customerPO ? 'PO ' + E(p.customerPO) : ''}</div></div>
      <p><b>To:</b> ${E(HW.name(p.customer))} ${p.project ? ' · Project: ' + E(HW.name(p.project)) : ''}</p>${HW.tbl([{ h: 'Item', f: (l) => E(l.name || l.nameSnapshot || '') }, { h: 'Unit', f: (l) => E(l.unit || l.unitName || '') }, { h: 'Qty', c: 'n', f: (l) => HW.num(l.quantity) }, { h: 'Price', c: 'n', f: (l) => M(l.unitPrice) }, { h: 'Total', c: 'n pr', f: (l) => M(l.lineTotal) }], it)}
      <div class="hw-tot"><span>Subtotal</span><span>${M(p.subtotal)}</span></div>${p.deliveryCharge ? `<div class="hw-tot"><span>Delivery</span><span>${M(p.deliveryCharge)}</span></div>` : ''}<div class="hw-tot big"><span>TOTAL</span><span>${M(p.total !== undefined ? p.total : (p.subtotal || 0) + (p.deliveryCharge || 0))}</span></div><p style="color:#667080">${E(p.terms || p.notes || '')}</p><p style="color:#667080;font-size:12px">Pro forma invoice — not a tax invoice.</p>`, actions: [{ label: 'Close' }, { label: 'Print', cls: 'p', fn: () => { window.print(); return false; } }] });
  };
})();
