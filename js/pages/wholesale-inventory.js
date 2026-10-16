/**
 * wholesale-inventory.js - "Wholesale inventory": ONE guided page that replaces Inventory + Warehouses & stock.
 * inventory.js mounts the shell and hands over here (window.WholesaleInventory.mount) when the business has the
 * multiWarehouse feature. warehouses.html redirects to inventory.html?step=warehouses.
 *
 * Six steps, in the order a wholesaler works:
 *   1 Warehouses      create / edit stores, see what each holds
 *   2 Receive         bring stock in (supplier purchase, direct receive, opening stock)
 *   3 Stock           warehouse stock in bundles/cartons | shop floor | all stock (books) | low stock
 *   4 Move to shop    warehouse -> shop, shop -> warehouse, warehouse -> warehouse, branch -> branch
 *   5 Adjust & count  corrections, damage / expiry / loss, stocktake, batches, serials
 *   6 History         movement ledger, warehouse moves, branch transfers, books check
 *
 * Deep links: inventory.html?step=stock&view=low  (step: warehouses|receive|stock|move|adjust|history)
 * Money rule: /warehouse/overview returns CENTS; /warehouse/stock and the rest return base units.
 */
(function (window) {
  'use strict';
  const W = window.WS;
  const STEPS = [
    { key: 'warehouses', n: 1, label: 'Warehouses',     hint: 'Set up your stores',   icon: 'building',  title: 'Your warehouses', intro: 'Each warehouse is a separate store of bulk stock. Create them once, then receive stock into them.' },
    { key: 'receive',    n: 2, label: 'Receive stock',  hint: 'Bring stock in',        icon: 'bag',       title: 'Receive stock', intro: 'Choose how the goods are arriving. Every way updates your stock on hand straight away.' },
    { key: 'stock',      n: 3, label: 'Stock on hand',  hint: 'See what you have',     icon: 'inventory', title: 'Stock on hand', intro: 'Warehouse stock shows bundles and cartons as well as single units. Switch view to see the shop floor or everything together.' },
    { key: 'move',       n: 4, label: 'Move to shop',   hint: 'Send stock where it sells', icon: 'truck', title: 'Move stock', intro: 'Move bulk stock to the shop floor to sell at retail, send unsold stock back, or shift stock between stores.' },
    { key: 'adjust',     n: 5, label: 'Adjust & count', hint: 'Fix differences',       icon: 'clipboard', title: 'Adjust and count', intro: 'Correct the numbers when reality differs: damaged, expired or lost goods, a recount, or opening stock.' },
    { key: 'history',    n: 6, label: 'History & checks', hint: 'Audit trail',         icon: 'audit',     title: 'History and checks', intro: 'Every movement is recorded. Use the books check to confirm the ledger matches the shelves.' },
  ];
  const KIND = { TO_RETAIL: 'Warehouse → Shop', TO_WAREHOUSE: 'Shop → Warehouse', WAREHOUSE_TO_WAREHOUSE: 'Warehouse → Warehouse' };

  const state = { step: 'warehouses', whId: '', stockView: 'warehouse', histView: 'ledger', search: '', filter: '', page: 1, limit: 12, mPage: 1, mKind: '' };
  let el; let tools; let whs = []; let token = 0;
  const $ = (sel, root = el) => root.querySelector(sel);
  const gate = (root) => window.Permissions.applyPermissionGates(root || el, window.AppShell.getUser());
  const stepOf = (k) => STEPS.find((s) => s.key === k) || STEPS[0];
  const whById = (id) => whs.find((w) => String(w._id) === String(id));

  /* ---------------------------------------------------------------- mount */
  async function mount(contentEl, inventoryTools) {
    el = contentEl; tools = inventoryTools;
    if (!W.on('multiWarehouse')) { el.innerHTML = W.featureOff(); return; }

    const q = new URLSearchParams(window.location.search);
    if (STEPS.some((s) => s.key === q.get('step'))) state.step = q.get('step');
    if (q.get('view') === 'low') state.stockView = 'low';
    if (q.get('action') === 'add') state.step = 'receive'; // opened from the setup guide

    el.innerHTML = `
      <div class="page-header">
        <div><h1>Wholesale inventory</h1><p>Warehouses, receiving, stock, moves and adjustments in one place, step by step.</p></div>
        <div class="page-actions">
          <button class="btn btn-secondary" id="wi-move-quick" data-requires-permission="inventory.transfer">${W.icon('arrowRight')} Move stock</button>
          <button class="btn btn-primary" id="wi-receive-quick" data-requires-permission="inventory.receive">${W.icon('plus')} Receive stock</button>
        </div>
      </div>
      <div id="wi-stats" class="hub-stats">${statSkeleton()}</div>
      <nav class="flow" id="wi-flow" aria-label="Wholesale inventory steps"></nav>
      <section class="card flow-panel" id="wi-panel"></section>`;

    $('#wi-move-quick').addEventListener('click', () => openMove());
    $('#wi-receive-quick').addEventListener('click', () => { if (tools) tools.receive(); });
    tools.onChanged(() => refresh());
    window.AppShell.onBranchChange?.(() => refresh());
    window.addEventListener('popstate', () => { const s = new URLSearchParams(window.location.search).get('step'); if (STEPS.some((x) => x.key === s)) go(s, { push: false }); });

    gate();
    drawFlow();
    await loadWhs();
    loadStats();
    renderStep();
    if (q.get('action') === 'add') window.AppShell.runUrlAction?.('receive-stock-btn');
  }

  const statSkeleton = () => [1, 2, 3, 4, 5].map(() => '<div class="hub-stat"><span>&nbsp;</span><b>…</b></div>').join('');

  async function loadWhs() {
    try { whs = await W.warehouses(true); } catch (e) { whs = []; window.UI.toast.error(e.message); }
    if (!whById(state.whId) && whs.length) state.whId = (whs.find((w) => w.isDefault && w.status !== 'inactive') || whs.find((w) => w.status !== 'inactive') || whs[0])._id;
  }

  async function loadStats() {
    const box = $('#wi-stats'); if (!box) return;
    try {
      const { data } = await window.Api.get('/warehouse/overview', { branchId: window.AppShell.getActiveBranchId(), page: 1, limit: 1 });
      const t = data.totals || {};
      const active = whs.filter((w) => w.status !== 'inactive');
      box.innerHTML = [
        W.stat('Warehouses', W.num(active.length), whs.length !== active.length ? `${whs.length - active.length} inactive` : 'active stores'),
        W.stat('In warehouses', W.num(t.warehouseUnits), 'base units', 'info'),
        W.stat('On the shop floor', W.num(t.retailUnits), 'base units'),
        W.stat('Warehouse value', W.cents(t.warehouseCostValue), 'at cost', 'success'),
        W.stat('Shop-floor value', W.cents(t.retailCostValue), 'at cost'),
      ].join('');
    } catch { box.innerHTML = W.stat('Warehouses', W.num(whs.length), 'active stores'); }
  }

  async function refresh() { await loadWhs(); loadStats(); renderStep(); }

  /* ---------------------------------------------------------------- stepper */
  function drawFlow() {
    const idx = STEPS.findIndex((s) => s.key === state.step);
    $('#wi-flow').innerHTML = STEPS.map((s, i) => `
      <button type="button" class="flow-step ${i === idx ? 'on' : i < idx ? 'done' : ''}" data-step="${s.key}" ${i === idx ? 'aria-current="step"' : ''}>
        <b>${i < idx ? '✓' : s.n}</b><span><strong>${s.label}</strong><small>${s.hint}</small></span>
      </button>`).join('');
    $('#wi-flow').querySelectorAll('[data-step]').forEach((b) => b.addEventListener('click', () => go(b.dataset.step)));
  }

  function go(step, { push = true } = {}) {
    state.step = step; state.page = 1; state.mPage = 1;
    if (push) { try { const u = new URL(window.location.href); u.searchParams.set('step', step); u.searchParams.delete('view'); u.searchParams.delete('action'); window.history.pushState({}, '', u); } catch { /* ignore */ } }
    drawFlow(); renderStep();
    const flow = $('#wi-flow'); if (flow && flow.scrollIntoView) flow.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  function panelHead(s, actionsHtml = '') {
    return `<header class="flow-head"><div><span class="flow-kicker">Step ${s.n} of ${STEPS.length}</span><h2>${s.title}</h2><p>${s.intro}</p></div><div class="flow-actions">${actionsHtml}</div></header>`;
  }
  function panelFoot(s) {
    const i = STEPS.findIndex((x) => x.key === s.key); const prev = STEPS[i - 1]; const next = STEPS[i + 1];
    return `<footer class="flow-foot">${prev ? `<button type="button" class="btn btn-ghost" data-go="${prev.key}">← ${prev.label}</button>` : '<span></span>'}${next ? `<button type="button" class="btn btn-secondary" data-go="${next.key}">Next: ${next.label} →</button>` : '<span class="text-muted text-sm">That is every step. You can come back to any of them.</span>'}</footer>`;
  }
  function wireGo(root) { root.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => go(b.dataset.go))); }
  function whPicker(id = 'wi-wh', label = 'Warehouse') {
    const act = whs.filter((w) => w.status !== 'inactive');
    return `<label class="inline-field"><span>${label}</span><select class="select" id="${id}">${W.whOptions(act, state.whId)}</select></label>`;
  }
  const noWh = () => `<div class="ws-pad">${window.UI.emptyStateHtml({ icon: 'inventory', title: 'Create a warehouse first', message: 'Step 1 sets up your first warehouse.', actionHtml: '<button class="btn btn-primary" data-go="warehouses">Go to step 1</button>' })}</div>`;

  function renderStep() {
    const t = ++token; void t;
    const panel = $('#wi-panel'); if (!panel) return;
    ({ warehouses: stepWarehouses, receive: stepReceive, stock: stepStock, move: stepMove, adjust: stepAdjust, history: stepHistory })[state.step](panel);
  }

  /* ---------------------------------------------------------------- 1 warehouses */
  function stepWarehouses(panel) {
    const s = stepOf('warehouses');
    panel.innerHTML = panelHead(s, `<button class="btn btn-primary" id="s1-new" data-requires-permission="warehouses.manage">${W.icon('plus')} New warehouse</button>`) + `
      <div class="ws-pad">${whs.length ? `<div class="ws-grid ws-grid-wh">${whs.map((w) => `
        <div class="ws-wh ${w.status === 'inactive' ? 'inactive' : ''}" data-id="${w._id}">
          <h4>${W.esc(w.name)} <span class="badge badge-neutral">${W.esc(w.code)}</span>
            ${w.isDefault ? '<span class="badge badge-success">Default</span>' : ''}
            ${w.status === 'inactive' ? '<span class="badge badge-danger">Inactive</span>' : ''}
            ${w.allowSales === false ? '<span class="badge badge-warning">Storage only</span>' : '<span class="badge badge-info">Sells</span>'}</h4>
          <div class="meta">${W.esc(w.branchId?.name || 'Branch')}${w.address ? ' &middot; ' + W.esc(w.address) : ''}${w.managerId?.name ? ' &middot; Manager: ' + W.esc(w.managerId.name) : ''}</div>
          <div class="nums"><div><b>${W.num(w.stock?.skus)}</b><span>products</span></div><div><b>${W.num(w.stock?.units)}</b><span>base units</span></div></div>
          <div class="mk-actions" style="margin:0">
            <button class="btn btn-secondary btn-sm" data-a="stock">View stock</button>
            <button class="btn btn-secondary btn-sm" data-a="adjust" data-requires-permission="inventory.adjust">Adjust</button>
            <button class="btn btn-ghost btn-sm" data-a="edit" data-requires-permission="warehouses.manage">Edit</button>
          </div>
        </div>`).join('')}</div>` : window.UI.emptyStateHtml({ icon: 'inventory', title: 'No warehouses yet', message: 'Create your first warehouse, or receive a purchase into the warehouse to auto-create "Main Warehouse".' })}</div>` + panelFoot(s);
    $('#s1-new')?.addEventListener('click', () => W.openWarehouseModal(null, { onDone: refresh }));
    panel.querySelectorAll('.ws-wh').forEach((card) => {
      const w = whById(card.dataset.id);
      card.querySelector('[data-a="stock"]').addEventListener('click', () => { state.whId = w._id; state.stockView = 'warehouse'; go('stock'); });
      card.querySelector('[data-a="adjust"]').addEventListener('click', () => W.openAdjustModal(w, { onDone: refresh }));
      card.querySelector('[data-a="edit"]').addEventListener('click', () => W.openWarehouseModal(w, { onDone: refresh }));
    });
    wireGo(panel); gate(panel);
  }

  /* ---------------------------------------------------------------- 2 receive */
  function stepReceive(panel) {
    const s = stepOf('receive');
    panel.innerHTML = panelHead(s) + `
      <div class="ws-pad">
        <div class="choice-grid">
          <a class="choice" href="purchases.html" data-requires-permission="purchases.view">
            <span class="choice-ico">${W.icon('bag')}</span><strong>From a supplier order</strong>
            <small>Record the purchase, then receive it into a warehouse. Also updates what you owe the supplier.</small><em>Recommended for supplier deliveries</em></a>
          <button type="button" class="choice" id="receive-stock-btn" data-requires-permission="inventory.receive">
            <span class="choice-ico">${W.icon('plus')}</span><strong>Receive directly</strong>
            <small>Add stock without an order. Supports batches, expiry dates and serial numbers.</small><em>Quick receiving</em></button>
          <button type="button" class="choice" id="s2-opening" data-requires-permission="inventory.adjust">
            <span class="choice-ico">${W.icon('clipboard')}</span><strong>Opening stock</strong>
            <small>Enter what is already on your shelves when you start, in bundles or cartons.</small><em>First-time setup</em></button>
        </div>
        <div class="ws-section-title" style="margin-top:var(--space-5)"><h3>Opening stock goes into</h3>${whs.length ? whPicker('wi-wh', '') : ''}</div>
        <div class="ws-section-title" style="margin-top:var(--space-5)"><h3>Recently received into warehouses</h3></div>
        <div id="s2-recent">${W.tableShell(['Date', 'Product', 'Type', 'Qty', 'Balance', 'By'], 6, 4)}</div>
      </div>` + panelFoot(s);
    $('#receive-stock-btn').addEventListener('click', () => tools.receive());
    $('#wi-wh')?.addEventListener('change', (e) => { state.whId = e.target.value; });
    $('#s2-opening').addEventListener('click', () => { if (!whs.length) return window.UI.toast.error('Create a warehouse first'); W.openAdjustModal(whById(state.whId), { onDone: refresh }); });
    wireGo(panel); gate(panel);
    recentReceipts();
  }
  async function recentReceipts() {
    const box = $('#s2-recent'); if (!box) return;
    try {
      const { data } = await window.Api.get('/inventory/movements', { branchId: window.AppShell.getActiveBranchId(), page: 1, limit: 8, location: 'WAREHOUSE' });
      const rows = (data.items || []).filter((m) => m.quantity > 0);
      box.querySelector('tbody').innerHTML = rows.length ? rows.map((m) => `<tr><td class="text-sm">${window.UI.formatDateTime(m.createdAt)}</td><td class="cell-primary">${W.esc(m.productId?.name || '—')}</td><td><span class="badge badge-neutral">${W.esc(m.type)}</span></td><td class="text-sm" style="color:var(--color-success)">+${W.num(m.quantity)}</td><td class="text-sm">${W.num(m.newStock)}</td><td class="text-sm text-muted">${W.esc(m.performedBy?.name || 'System')}</td></tr>`).join('') : W.emptyRow(6, 'Nothing received into a warehouse yet');
    } catch (e) { box.querySelector('tbody').innerHTML = W.errRow(6, e); }
  }

  /* ---------------------------------------------------------------- 3 stock */
  const STOCK_VIEWS = [['warehouse', 'Warehouse stock'], ['shop', 'Shop floor'], ['all', 'All stock (books)'], ['low', 'Low stock']];
  function seg(views, active, id) {
    return `<div class="seg" id="${id}" role="tablist">${views.map(([k, l]) => `<button type="button" role="tab" class="${k === active ? 'on' : ''}" data-v="${k}">${l}</button>`).join('')}</div>`;
  }
  function stepStock(panel) {
    const s = stepOf('stock');
    panel.innerHTML = panelHead(s) + `<div class="ws-pad flow-sub">${seg(STOCK_VIEWS, state.stockView, 'stk-seg')}</div><div id="stk-body"></div>` + panelFoot(s);
    $('#stk-seg').querySelectorAll('[data-v]').forEach((b) => b.addEventListener('click', () => { state.stockView = b.dataset.v; state.page = 1; state.search = ''; stepStock(panel); }));
    wireGo(panel);
    const body = $('#stk-body');
    if (state.stockView === 'warehouse') return warehouseStock(body);
    const map = { shop: 'stock', all: 'overview', low: 'lowstock' };
    body.innerHTML = '<div class="toolbar" id="view-toolbar"></div><div id="view-body"></div><div class="pagination" id="pagination"></div>';
    tools.setSearch('');
    tools.showView(map[state.stockView]);
  }

  function warehouseStock(body) {
    if (!whs.length) { body.innerHTML = noWh(); wireGo(body); return; }
    body.innerHTML = `<div class="ws-toolbar">${whPicker('f-wh', '')}
      <div class="grow input-group"><span class="input-group-icon">${W.icon('search')}</span><input class="input" id="f-search" placeholder="Search product or SKU" value="${W.esc(state.search)}" /></div>
      <select class="select" id="f-filter"><option value="">All stock</option><option value="low" ${state.filter === 'low' ? 'selected' : ''}>Low stock</option><option value="out" ${state.filter === 'out' ? 'selected' : ''}>Out of stock</option></select>
      <button class="btn btn-secondary btn-sm" id="f-adj" data-requires-permission="inventory.adjust">${W.icon('edit')} Adjust</button>
    </div>` + W.tableShell(['Product', 'SKU', 'In stock', 'In bigger units', 'Reserved', 'Status'], 6) + '<div class="pagination" id="wh-pg"></div>';
    $('#f-wh', body).addEventListener('change', (e) => { state.whId = e.target.value; state.page = 1; loadWhStock(); });
    $('#f-search', body).addEventListener('input', window.UI.debounce((e) => { state.search = e.target.value.trim(); state.page = 1; loadWhStock(); }));
    $('#f-filter', body).addEventListener('change', (e) => { state.filter = e.target.value; state.page = 1; loadWhStock(); });
    $('#f-adj', body).addEventListener('click', () => W.openAdjustModal(whById(state.whId), { onDone: refresh }));
    gate(body); loadWhStock();
  }
  async function loadWhStock() {
    const tb = $('#stk-body tbody'); if (!tb) return;
    try {
      const { data } = await window.Api.get('/warehouse/stock', { warehouseId: state.whId, branchId: W.branchOf(whById(state.whId)) || undefined, page: state.page, limit: state.limit, search: state.search,
        lowStockOnly: state.filter === 'low' ? true : undefined, outOfStockOnly: state.filter === 'out' ? true : undefined });
      tb.innerHTML = data.items.length ? data.items.map((r) => {
        const p = r.productId || {}; const avail = r.quantity - (r.reservedQuantity || 0); const low = avail <= (r.lowStockThreshold ?? 5);
        const big = (r.inUnits || []).filter((u) => u.whole > 0).map((u) => `${W.num(u.whole)} ${W.esc(u.unit)}${u.remainderBase ? ` + ${W.num(u.remainderBase)}` : ''}`).join(' &middot; ') || '<span class="text-muted">—</span>';
        return `<tr><td class="cell-primary">${W.esc(p.name || 'Product')}${r.variantId ? ' <span class="badge badge-neutral">variant</span>' : ''}</td><td class="text-sm">${W.esc(p.sku || '—')}</td>
          <td><strong>${W.num(r.quantity)}</strong> <span class="text-muted text-xs">${W.esc(p.unit || '')}</span></td><td class="text-sm">${big}</td><td>${W.num(r.reservedQuantity)}</td>
          <td>${r.quantity <= 0 ? '<span class="badge badge-danger">Out</span>' : low ? '<span class="badge badge-warning">Low</span>' : '<span class="badge badge-success">OK</span>'}</td></tr>`;
      }).join('') : W.emptyRow(6, 'No stock in this warehouse');
      W.pager($('#wh-pg'), data, (p) => { state.page = p; loadWhStock(); });
    } catch (e) { tb.innerHTML = W.errRow(6, e); }
  }

  /* ---------------------------------------------------------------- 4 move */
  function openMove(mode) {
    W.openTransferModal({ mode: mode || 'TO_RETAIL', warehouseId: state.whId || undefined, onDone: () => { refresh(); } });
  }
  function stepMove(panel) {
    const s = stepOf('move');
    panel.innerHTML = panelHead(s) + `
      <div class="ws-pad">
        <div class="choice-grid">
          <button type="button" class="choice" data-mv="TO_RETAIL" data-requires-permission="inventory.transfer"><span class="choice-ico">${W.icon('store')}</span><strong>Warehouse → Shop floor</strong><small>Put bulk stock on sale at retail prices. You check units, prices and profit before confirming.</small><em>Most common</em></button>
          <button type="button" class="choice" data-mv="TO_WAREHOUSE" data-requires-permission="inventory.transfer"><span class="choice-ico">${W.icon('inventory')}</span><strong>Shop floor → Warehouse</strong><small>Return unsold stock to the warehouse.</small></button>
          <button type="button" class="choice" data-mv="WH_TO_WH" data-requires-permission="inventory.transfer"><span class="choice-ico">${W.icon('truck')}</span><strong>Warehouse → Warehouse</strong><small>Shift stock between two of your stores.</small></button>
          <button type="button" class="choice" id="s4-branch" data-requires-permission="inventory.transfer"><span class="choice-ico">${W.icon('branches')}</span><strong>Branch → Branch</strong><small>Request a transfer to another branch.</small></button>
        </div>
        <div class="ws-section-title" style="margin-top:var(--space-5)"><h3>Recent moves</h3><button class="btn btn-ghost btn-sm" data-go="history">Full history</button></div>
        <div id="s4-moves"></div>
      </div>` + panelFoot(s);
    panel.querySelectorAll('[data-mv]').forEach((b) => b.addEventListener('click', () => openMove(b.dataset.mv)));
    $('#s4-branch').addEventListener('click', () => tools.branchTransfer());
    wireGo(panel); gate(panel);
    moveList($('#s4-moves'), { limit: 6, paginate: false });
  }

  /* shared by step 4 (recent) and step 6 (full) */
  async function moveList(box, { limit = 15, paginate = true } = {}) {
    box.innerHTML = (paginate ? `<div class="ws-toolbar"><select class="select" id="m-wh">${W.whOptions(whs, '', { blank: 'All warehouses' })}</select>
      <select class="select" id="m-kind"><option value="">All moves</option>${Object.entries(KIND).map(([k, v]) => `<option value="${k}" ${state.mKind === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div>` : '')
      + W.tableShell(['Move #', 'When', 'Direction', 'Items', 'By', ''], 6, 3) + (paginate ? '<div class="pagination" id="mv-pg"></div>' : '');
    const load = async () => {
      const tb = $('tbody', box);
      try {
        const { data } = await window.Api.get('/warehouse/transfers', { page: state.mPage, limit, kind: state.mKind || undefined, warehouseId: ($('#m-wh', box) || {}).value || undefined });
        tb.innerHTML = data.items.length ? data.items.map((t) => `<tr data-id="${t._id}"><td class="cell-primary">${W.esc(t.transferNumber)}</td><td class="text-sm">${window.UI.formatDateTime(t.createdAt)}</td>
          <td class="text-sm">${W.esc(KIND[t.kind] || `${t.fromLocation} → ${t.toLocation}`)}</td><td>${(t.items || []).length}</td><td class="text-sm">${W.esc(t.performedBy?.name || '—')}</td>
          <td class="actions"><button class="btn btn-ghost btn-sm" data-a="view">View</button></td></tr>`).join('') : W.emptyRow(6, 'No stock moves yet');
        tb.querySelectorAll('[data-a="view"]').forEach((b) => b.addEventListener('click', () => openMoveDetail(b.closest('tr').dataset.id)));
        if (paginate) W.pager($('#mv-pg', box), data, (p) => { state.mPage = p; load(); });
      } catch (e) { tb.innerHTML = W.errRow(6, e); }
    };
    $('#m-wh', box)?.addEventListener('change', () => { state.mPage = 1; load(); });
    $('#m-kind', box)?.addEventListener('change', (e) => { state.mKind = e.target.value; state.mPage = 1; load(); });
    load();
  }
  async function openMoveDetail(id) {
    let t; try { ({ data: { transfer: t } } = await window.Api.get(`/warehouse/transfers/${id}`)); } catch (e) { return window.UI.toast.error(e.message); }
    const m = window.UI.openModal({ title: `Move ${t.transferNumber}`, maxWidth: '680px',
      bodyHtml: `<div class="text-sm text-secondary" style="margin-bottom:var(--space-3)">${W.esc(KIND[t.kind] || '')} &middot; ${W.esc(t.branchId?.name || '')} &middot; ${window.UI.formatDateTime(t.createdAt)} &middot; by ${W.esc(t.performedBy?.name || '—')}</div>
        <div class="table-wrap"><table class="table"><thead><tr><th>Item</th><th>Qty</th><th>Unit</th><th>Batches / serials</th></tr></thead><tbody>${(t.items || []).map((i) => `<tr><td class="text-sm">${W.esc(i.nameSnapshot || i.productId?.name || '—')}</td><td>${W.num(i.quantity)}</td><td class="text-sm">${W.esc(i.unitName || 'base')}</td>
          <td class="text-xs text-muted">${(i.batchAllocations || []).map((b) => `${W.esc(b.batchNumber)} × ${b.quantity}`).join('<br>') || ''} ${(i.serialNumbers || []).map(W.esc).join(', ')}</td></tr>`).join('')}</tbody></table></div>
        ${t.notes ? `<p class="text-sm" style="margin-top:var(--space-3)">Notes: ${W.esc(t.notes)}</p>` : ''}`,
      footerHtml: '<button class="btn btn-secondary" data-action="close">Close</button>' });
    W.bindClose(m);
  }

  /* ---------------------------------------------------------------- 5 adjust */
  function stepAdjust(panel) {
    const s = stepOf('adjust');
    const links = [
      { href: 'stocktakes.html', ico: 'clipboard', t: 'Stocktake (full count)', d: 'Count the shelves, compare with the system and post the differences.', perm: 'stocktake.view' },
      window.AppShell.hasFeature('batchTracking', 'expiryTracking') ? { href: 'batches.html', ico: 'layers', t: 'Batches & expiry', d: 'See what is about to expire; quarantine, release or dispose a batch.', perm: 'batches.view' } : null,
      window.AppShell.hasFeature('serialNumberTracking') ? { href: 'serials.html', ico: 'hash', t: 'Serial numbers', d: 'Look up a unit by serial number or IMEI.', perm: 'serials.view' } : null,
    ].filter(Boolean);
    panel.innerHTML = panelHead(s) + `
      <div class="ws-pad">
        <div class="choice-grid">
          <button type="button" class="choice" id="s5-wh" data-requires-permission="inventory.adjust"><span class="choice-ico">${W.icon('inventory')}</span><strong>Adjust warehouse stock</strong><small>Correct a count, or write off damaged, expired or lost goods, in bundles or cartons.</small></button>
          <button type="button" class="choice" id="s5-shop" data-requires-permission="inventory.adjust"><span class="choice-ico">${W.icon('store')}</span><strong>Adjust shop-floor stock</strong><small>The same corrections for the stock you sell at retail.</small></button>
          ${links.map((l) => `<a class="choice" href="${l.href}" data-requires-permission="${l.perm}"><span class="choice-ico">${W.icon(l.ico)}</span><strong>${l.t}</strong><small>${l.d}</small></a>`).join('')}
        </div>
        <div class="ws-section-title" style="margin-top:var(--space-5)"><h3>Warehouse to adjust</h3>${whs.length ? whPicker('wi-wh', '') : ''}</div>
        <p class="field-hint">Every adjustment needs a reason and is recorded in the history (step 6) with your name.</p>
      </div>` + panelFoot(s);
    $('#wi-wh')?.addEventListener('change', (e) => { state.whId = e.target.value; });
    $('#s5-wh').addEventListener('click', () => { if (!whs.length) return window.UI.toast.error('Create a warehouse first'); W.openAdjustModal(whById(state.whId), { onDone: refresh }); });
    $('#s5-shop').addEventListener('click', () => tools.adjust());
    wireGo(panel); gate(panel);
  }

  /* ---------------------------------------------------------------- 6 history */
  const HIST_VIEWS = [['ledger', 'Movement ledger'], ['moves', 'Warehouse moves'], ['branch', 'Branch transfers'], ['books', 'Books check']];
  function stepHistory(panel) {
    const s = stepOf('history');
    panel.innerHTML = panelHead(s) + `<div class="ws-pad flow-sub">${seg(HIST_VIEWS, state.histView, 'hist-seg')}</div><div id="hist-body"></div>` + panelFoot(s);
    $('#hist-seg').querySelectorAll('[data-v]').forEach((b) => b.addEventListener('click', () => { state.histView = b.dataset.v; state.page = 1; state.mPage = 1; stepHistory(panel); }));
    wireGo(panel);
    const body = $('#hist-body');
    if (state.histView === 'moves') return moveList(body, { limit: 15, paginate: true });
    if (state.histView === 'books') return renderBooks(body);
    body.innerHTML = '<div class="toolbar" id="view-toolbar"></div><div id="view-body"></div><div class="pagination" id="pagination"></div>';
    tools.showView(state.histView === 'branch' ? 'transfers' : 'movements');
  }

  async function renderBooks(body) {
    const branchId = window.AppShell.getActiveBranchId();
    body.innerHTML = '<div class="ws-pad ws-muted-row">Checking the books…</div>';
    try {
      const [ov, rc] = await Promise.all([window.Api.get('/warehouse/overview', { branchId, limit: 100 }), window.Api.get('/warehouse/reconcile', { branchId })]);
      const t = ov.data.totals || {}; const names = {}; (ov.data.items || []).forEach((r) => { names[r.productId] = r.name; });
      const d = rc.data.differences || [];
      body.innerHTML = `<div class="ws-pad">
        <dl class="mk-kv"><div><dt>Retail units</dt><dd>${W.num(t.retailUnits)}</dd></div><div><dt>Warehouse units</dt><dd>${W.num(t.warehouseUnits)}</dd></div>
          <div><dt>Retail value (cost)</dt><dd>${W.cents(t.retailCostValue)}</dd></div><div><dt>Warehouse value (cost)</dt><dd>${W.cents(t.warehouseCostValue)}</dd></div></dl>
        <div class="${d.length ? 'ws-warn' : 'books-ok'}">${d.length ? `${d.length} difference(s) between the stock ledger and the stock on hand.` : 'Books are balanced: the ledger matches the stock on hand.'}</div>
        ${d.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Product</th><th>Where</th><th>Ledger</th><th>Stock</th><th>Difference</th></tr></thead><tbody>${d.map((x) => `<tr><td>${W.esc(names[x.productId] || x.productId)}</td><td>${W.esc(x.location)}</td><td>${W.num(x.ledger)}</td><td>${W.num(x.stock)}</td><td>${W.num(x.difference)}</td></tr>`).join('')}</tbody></table></div>` : ''}
        <div class="ws-section-title" style="margin-top:var(--space-5)"><h3>Shop + warehouse by product</h3></div>
        <div class="table-wrap"><table class="table"><thead><tr><th>Product</th><th>SKU</th><th>Shop floor</th><th>Warehouse</th><th>Total</th></tr></thead><tbody>${(ov.data.items || []).map((r) => `<tr><td class="cell-primary">${W.esc(r.name || 'Unknown')}</td><td class="text-sm">${W.esc(r.sku || '—')}</td><td>${W.num(r.retailQuantity)}</td><td>${W.num(r.warehouseQuantity)}</td><td><strong>${W.num(r.totalQuantity)}</strong></td></tr>`).join('') || W.emptyRow(5, 'No stock')}</tbody></table></div></div>`;
    } catch (e) { body.innerHTML = `<div class="ws-pad">${window.UI.emptyStateHtml({ icon: 'alert', title: 'Could not run the books check', message: e.message })}</div>`; }
  }

  window.WholesaleInventory = { mount };
})(window);
