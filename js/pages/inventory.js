/**
 * inventory.js
 * Branch-scoped: reads the active branch from AppShell (the topbar branch
 * switcher) and refetches whenever it changes. Four tabs share one page:
 * Stock levels, Low stock, Movements, and Transfers (which is the only
 * cross-branch view, since a transfer touches two branches at once).
 *
 * WAREHOUSE / RETAIL (business feature "multiWarehouse", on by default for wholesale businesses):
 * every branch keeps two stock pools - RETAIL (the shop floor, the only pool the till sells from) and
 * WAREHOUSE (the wholesale store). When the feature is on this page adds:
 *   - "All stock" tab: one row per product with retail + warehouse + total, value totals, and a books check
 *   - "Warehouse" tab: warehouse stock of the branch ("Stock levels" is renamed "Retail stock")
 *   - "Warehouse moves" tab: history of warehouse <-> retail moves, with batches and serial numbers
 *   - "Move stock" button: move stock between the two pools (serial-tracked products need their serials)
 *   - a location choice on Receive stock / Adjust, and a location filter + column on Movements
 * Without the feature nothing changes.
 *
 * WHOLESALE HUB: for businesses with warehouses this page hands over to js/pages/wholesale-inventory.js ("Wholesale
 * inventory": warehouses -> receive -> stock -> move -> adjust -> history). That page re-uses the tools below through
 * window.InventoryTools (receive / adjust / branch transfer / the stock + ledger views), so nothing is duplicated.
 * warehouses.html now redirects to inventory.html?step=warehouses.
 */
(function () {
  const state = { view: 'stock', page: 1, limit: 10, search: '', location: '', productId: '', productName: '', mv: { search: '', categoryId: '', type: '', from: '', to: '' } };
  // opened from Products > "View stock":  inventory.html?productId=...&search=...
  try {
    const q = new URLSearchParams(window.location.search);
    if (q.get('productId')) { state.productId = q.get('productId'); state.productName = q.get('search') || ''; state.search = q.get('search') || ''; }
  } catch { /* ignore */ }
  const wh = () => !!(window.AppShell.hasFeature && window.AppShell.hasFeature('multiWarehouse'));
  const esc = (v) => window.UI.escapeHtml(v == null ? '' : String(v));
  const locLabel = (l) => (l === 'WAREHOUSE' ? 'Warehouse' : 'Retail');
  const locBadge = (l) => `<span class="badge ${l === 'WAREHOUSE' ? 'badge-info' : 'badge-neutral'}">${locLabel(l)}</span>`;
  const kes = (cents) => window.UI.formatMoney((Number(cents) || 0) / 100); // overview values are in cents
  const variantText = (v) => (v ? Object.values(v.attributes || {}).join(', ') : '');
  const splitList = (txt) => String(txt || '').split(/[\n,;]+/).map((x) => x.trim()).filter(Boolean);
  const productNames = {}; // productId -> name, so the books check can show names
  let contentEl;
  let branchesCache = null;
  let unsubscribeBranchChange = null;
  const hooks = { onChanged: null }; // set by the wholesale hub so it can refresh after a receive / adjust
  const afterChange = () => { if (hooks.onChanged) hooks.onChanged(); else renderActiveView(); };

  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    contentEl = window.AppShell.mount({ title: window.AppShell.hasFeature && window.AppShell.hasFeature('multiWarehouse') && window.WholesaleInventory ? 'Wholesale inventory' : 'Inventory' });
    if (!contentEl) return;

    // the warehouse tabs depend on the business features, so wait for the profile before drawing the page
    try { await window.AppShell.whenProfileReady?.(); } catch { /* the cached profile is used */ }
    await getBranches();

    // Wholesale businesses get the guided "Wholesale inventory" page; it borrows the tools below.
    if (wh() && window.WholesaleInventory) {
      window.InventoryTools = {
        receive: openReceiveModal,
        adjust: openAdjustModal,
        branchTransfer: openTransferModal,
        returnPurchase: openReturnPurchase,
        breakDown: openBreakDown,
        /** Draw one of the classic views (overview | stock | lowstock | movements | transfers | locmoves) into #view-toolbar / #view-body / #pagination. */
        showView(view) { state.view = view; state.page = 1; return renderActiveView(); },
        setSearch(v) { state.search = v || ''; },
        onChanged(fn) { hooks.onChanged = fn; },
      };
      document.title = `Wholesale inventory · ${window.AppShell.APP_NAME}`;
      window.WholesaleInventory.mount(contentEl, window.InventoryTools);
      if (state.productId) { try { window.InventoryTools.setSearch(state.productName); window.InventoryTools.showView('stock'); } catch { /* hub keeps its own view */ } }
      return;
    }

    contentEl.innerHTML = pageSkeleton();
    bindHeaderActions();
    bindTabs();
    await renderActiveView();

    unsubscribeBranchChange = window.AppShell.onBranchChange(() => {
      state.page = 1;
      renderActiveView();
    });
    window.addEventListener('beforeunload', () => unsubscribeBranchChange?.());
  }

  async function getBranches() {
    if (branchesCache) return branchesCache;
    try {
      const { data } = await window.Api.get('/branches', { page: 1, limit: 100 });
      branchesCache = data.items;
    } catch {
      branchesCache = [];
    }
    return branchesCache;
  }

  function pageSkeleton() {
    return `
      <div class="page-header">
        <div>
          <h1>Inventory</h1>
          <p>${wh() ? 'Retail and warehouse stock, movement history, and transfers.' : 'Stock levels, movement history, and inter-branch transfers.'}</p>
        </div>
        <div class="flex gap-2" style="flex-wrap:wrap">
          <button class="btn btn-secondary" id="adjust-stock-btn" data-requires-permission="inventory.adjust">${window.Icons.get('edit')} Adjust</button>
          <button class="btn btn-secondary" id="receive-stock-btn" data-requires-permission="inventory.receive">${window.Icons.get('plus')} Receive stock</button>
          ${window.UnitKit ? `<button class="btn btn-secondary" id="break-stock-btn" data-requires-permission="inventory.adjust" title="Break a bag into sellable sizes">${window.Icons.get('inventory')} Break down</button>` : ''}
          <button class="btn btn-secondary" id="return-purchase-btn" data-requires-permission="purchases.return">${window.Icons.get('bag')} Return purchase</button>
          ${wh() ? `<button class="btn btn-secondary" id="move-stock-btn" data-requires-permission="inventory.transfer">${window.Icons.get('truck')} Move stock</button>` : ''}
          <button class="btn btn-secondary" id="low-sms-btn" data-requires-permission="settings.update">${window.Icons.get('bell')} Low stock SMS</button>
          <button class="btn btn-primary" id="new-transfer-btn" data-requires-permission="inventory.transfer">${window.Icons.get('branches')} New transfer</button>
        </div>
      </div>

      <div id="stock-value-strip"></div>

      <div class="card">
        <div class="tabs" style="padding: 0 var(--space-6)">
          ${wh() ? '<button class="tab-btn" data-view="overview">All stock</button>' : ''}
          <button class="tab-btn active" data-view="stock">${wh() ? 'Retail stock' : 'Stock levels'}</button>
          ${wh() ? '<button class="tab-btn" data-view="warehouse">Warehouse</button>' : ''}
          <button class="tab-btn" data-view="lowstock">Low stock</button>
          <button class="tab-btn" data-view="movements">Movements</button>
          <button class="tab-btn" data-view="transfers">${wh() ? 'Branch transfers' : 'Transfers'}</button>
          ${wh() ? '<button class="tab-btn" data-view="locmoves">Warehouse moves</button>' : ''}
          <button class="tab-btn" data-view="preturns" data-requires-permission="purchases.view">Purchase returns</button>
        </div>
        <div class="toolbar" id="view-toolbar"></div>
        <div id="view-body"></div>
        <div class="pagination" id="pagination"></div>
      </div>
    `;
  }

  function bindHeaderActions() {
    document.getElementById('adjust-stock-btn').addEventListener('click', openAdjustModal);
    document.getElementById('receive-stock-btn').addEventListener('click', openReceiveModal);
    window.AppShell.runUrlAction?.('receive-stock-btn'); // opened from the setup guide
    document.getElementById('new-transfer-btn').addEventListener('click', openTransferModal);
    document.getElementById('break-stock-btn')?.addEventListener('click', openBreakDown);
    document.getElementById('return-purchase-btn')?.addEventListener('click', openReturnPurchase);
    document.getElementById('move-stock-btn')?.addEventListener('click', openMoveModal);
    document.getElementById('low-sms-btn')?.addEventListener('click', openLowStockSmsModal);
  }

  function bindTabs() {
    document.querySelectorAll('.tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        state.view = btn.dataset.view;
        state.page = 1;
        renderActiveView();
      });
    });
  }

  /** Stock value for the active branch (same calculation as the dashboard). Values arrive in cents. */
  async function loadStockValue() {
    const el = document.getElementById('stock-value-strip');
    if (!el) return;
    const branchId = window.AppShell.getActiveBranchId();
    if (!branchId) { el.innerHTML = ''; return; }
    try {
      const { data } = await window.Api.get('/inventory/valuation', { branchId });
      const t = data.totals || {};
      const tile = (label, val, sub) => `<div class="card" style="flex:1;min-width:170px;padding:var(--space-4)"><div class="text-sm text-secondary">${label}</div><div style="font-size:1.4rem;font-weight:700">${kes(val)}</div>${sub ? `<div class="text-sm text-muted">${sub}</div>` : ''}</div>`;
      el.innerHTML = `<div style="display:flex;gap:var(--space-3);flex-wrap:wrap;margin-bottom:var(--space-4)">
        ${tile('Stock value (at cost)', t.cost, `${Number(t.units || 0).toLocaleString()} units on hand`)}
        ${tile('Shop floor', t.retailCost)}
        ${wh() || t.warehouseCost ? tile('Warehouse', t.warehouseCost) : ''}
        ${tile('Selling value', t.retail, `Potential profit ${kes((t.retail || 0) - (t.retailCost || 0))}`)}
        ${t.expiredCost ? tile('Expired (not counted)', t.expiredCost) : ''}
      </div>
      ${t.zeroCostItems ? `<div class="card" style="margin-bottom:var(--space-4);border-left:4px solid var(--color-warning, #d97706);padding:var(--space-3) var(--space-4)"><span class="text-sm"><strong>${t.zeroCostItems}</strong> product${t.zeroCostItems === 1 ? '' : 's'} in stock ha${t.zeroCostItems === 1 ? 's' : 've'} no cost price, so ${t.zeroCostItems === 1 ? 'it is' : 'they are'} valued at 0 (e.g. ${(data.zeroCostList || []).slice(0, 3).map((z) => esc(z.name)).join(', ')}). Set the cost price or receive them through a purchase to correct the stock value.</span></div>` : ''}`;
    } catch { el.innerHTML = ''; }
  }

  async function renderActiveView() {
    window.Permissions.applyPermissionGates(contentEl, window.AppShell.getUser());
    loadStockValue();
    renderToolbar();
    if (state.view === 'overview') return renderOverview();
    if (state.view === 'stock') return renderStockLevels();
    if (state.view === 'warehouse') return renderWarehouseStock();
    if (state.view === 'lowstock') return renderLowStock();
    if (state.view === 'movements') return renderMovements();
    if (state.view === 'transfers') return renderTransfers();
    if (state.view === 'locmoves') return renderLocationMoves();
    if (state.view === 'preturns') return renderPurchaseReturns();
  }

  /* ------------------------------------------------------------------ *
   * Purchase returns: send goods from a RECEIVED purchase back to the supplier (stock out + supplier balance down).
   * The wizard and the list live in js/pages/purchase-returns.js.
   * ------------------------------------------------------------------ */
  let returnsList = null;
  function renderPurchaseReturns() {
    document.getElementById('pagination').innerHTML = '';
    const body = document.getElementById('view-body');
    if (!window.PurchaseReturns) { body.innerHTML = window.UI.emptyStateHtml({ icon: 'alert', title: 'Purchase returns did not load', message: 'Refresh the page and try again.' }); return; }
    returnsList = window.PurchaseReturns.renderList(body);
  }
  function openReturnPurchase() {
    if (!window.PurchaseReturns) return window.UI.toast.error('Purchase returns did not load. Refresh the page.');
    window.PurchaseReturns.openWizard({
      onDone: () => { if (state.view === 'preturns' && returnsList) returnsList.reload(); else renderActiveView(); },
    });
  }

  function renderToolbar() {
    const toolbar = document.getElementById('view-toolbar');
    const searchable = ['stock', 'warehouse', 'overview'].includes(state.view);
    if (searchable) {
      toolbar.innerHTML = `
        <div class="toolbar-search input-group">
          <span class="input-group-icon">${window.Icons.get('search')}</span>
          <input class="input" id="search-input" type="text" placeholder="Search by product name, SKU or barcode" value="${esc(state.search)}" />
        </div>
        ${state.view === 'overview' ? `<span style="flex:1"></span><button class="btn btn-secondary btn-sm" id="reconcile-btn" type="button">${window.Icons.get('check')} Check books</button>` : ''}
      `;
      const runSearch = () => {
        if (state.view === 'stock') renderStockLevels();
        else if (state.view === 'warehouse') renderWarehouseStock();
        else renderOverview();
      };
      const searchInput = document.getElementById('search-input');
      searchInput.addEventListener('input', window.UI.debounce((e) => {
        state.search = e.target.value.trim();
        state.page = 1;
        runSearch();
      }));
      // Camera icon INSIDE the search bar (same scanner as the Add product window): scan a barcode, the stock list filters to it.
      if (window.BarcodeGuard) {
        window.BarcodeGuard.attachSearchScan(searchInput, {
          title: 'Scan product barcode',
          onCode: (code) => {
            searchInput.value = code; state.search = code; state.page = 1;
            runSearch();
            window.BarcodeGuard.check(code).then((r) => {
              if (r.unknown) return;
              if (r.exists) window.UI.toast.success(`Barcode ${code}: ${r.name || 'product found'}`);
              else window.UI.toast.info(`No product has barcode ${code}. Add it on the Products or Sales page.`);
            }).catch(() => {});
          },
        });
      }
      document.getElementById('reconcile-btn')?.addEventListener('click', openReconcileModal);
    } else if (state.view === 'movements') {
      const mv = state.mv;
      const types = ['SALE', 'PURCHASE', 'RETURN', 'REFUND', 'PURCHASE_RETURN', 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT', 'TRANSFER_IN', 'TRANSFER_OUT', 'DAMAGE', 'EXPIRED', 'LOST', 'OPENING_STOCK'];
      toolbar.innerHTML = `
        <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end;width:100%">
          <div class="toolbar-search input-group" style="min-width:210px;flex:1 1 210px">
            <span class="input-group-icon">${window.Icons.get('search')}</span>
            <input class="input" id="mv-search" type="text" placeholder="Product name, SKU or barcode" value="${esc(mv.search)}" />
          </div>
          <select class="select" id="mv-category" style="max-width:190px"><option value="">All categories</option></select>
          <select class="select" id="mv-type" style="max-width:170px">
            <option value="">All movement types</option>
            ${types.map((t) => `<option value="${t}" ${mv.type === t ? 'selected' : ''}>${t.replace(/_/g, ' ')}</option>`).join('')}
          </select>
          ${wh() ? `<select class="select" id="loc-filter" style="max-width:170px">
            <option value="">Retail + warehouse</option>
            <option value="RETAIL" ${state.location === 'RETAIL' ? 'selected' : ''}>Retail only</option>
            <option value="WAREHOUSE" ${state.location === 'WAREHOUSE' ? 'selected' : ''}>Warehouse only</option>
          </select>` : ''}
          <label class="text-sm text-secondary" style="display:flex;flex-direction:column;gap:2px">From<input class="input" type="date" id="mv-from" value="${esc(mv.from)}" /></label>
          <label class="text-sm text-secondary" style="display:flex;flex-direction:column;gap:2px">To<input class="input" type="date" id="mv-to" value="${esc(mv.to)}" /></label>
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            <button type="button" class="btn btn-secondary btn-sm" data-mv-range="0">Today</button>
            <button type="button" class="btn btn-secondary btn-sm" data-mv-range="7">7 days</button>
            <button type="button" class="btn btn-secondary btn-sm" data-mv-range="30">30 days</button>
            <button type="button" class="btn btn-secondary btn-sm" id="mv-clear">Clear filters</button>
          </div>
        </div>
        ${state.productId ? `<div style="margin-top:8px;display:inline-flex;gap:8px;align-items:center;padding:4px 10px;background:#e8f1ff;border:1px solid #9ec1ff;border-radius:999px;color:#0b3d91;font-size:13px">Product: <strong>${esc(state.productName || 'selected product')}</strong><button type="button" id="mv-clear-product" class="btn btn-secondary btn-sm" style="padding:0 8px">×</button></div>` : ''}`;

      // categories (loaded once, then cached)
      loadMovementCategories().then((cats) => {
        const sel = document.getElementById('mv-category');
        if (!sel) return;
        sel.innerHTML = '<option value="">All categories</option>' + cats.map((c) => `<option value="${esc(c._id)}" ${mv.categoryId === c._id ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
      });

      const reload = () => { state.page = 1; renderMovements(); };
      document.getElementById('mv-search').addEventListener('input', window.UI.debounce((e) => { mv.search = e.target.value.trim(); reload(); }));
      document.getElementById('mv-category').addEventListener('change', (e) => { mv.categoryId = e.target.value; reload(); });
      document.getElementById('mv-type').addEventListener('change', (e) => { mv.type = e.target.value; reload(); });
      document.getElementById('loc-filter')?.addEventListener('change', (e) => { state.location = e.target.value; reload(); });
      document.getElementById('mv-from').addEventListener('change', (e) => { mv.from = e.target.value; reload(); });
      document.getElementById('mv-to').addEventListener('change', (e) => { mv.to = e.target.value; reload(); });
      const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      toolbar.querySelectorAll('[data-mv-range]').forEach((btn) => btn.addEventListener('click', () => {
        const days = Number(btn.dataset.mvRange);
        const start = new Date(); start.setDate(start.getDate() - days);
        mv.from = ymd(start); mv.to = ymd(new Date());
        document.getElementById('mv-from').value = mv.from; document.getElementById('mv-to').value = mv.to;
        reload();
      }));
      document.getElementById('mv-clear').addEventListener('click', () => {
        state.mv = { search: '', categoryId: '', type: '', from: '', to: '' }; state.location = ''; state.productId = ''; state.productName = '';
        try { window.history.replaceState({}, '', window.location.pathname); } catch { /* ignore */ }
        renderToolbar(); state.page = 1; renderMovements();
      });
      document.getElementById('mv-clear-product')?.addEventListener('click', () => {
        state.productId = ''; state.productName = '';
        try { window.history.replaceState({}, '', window.location.pathname); } catch { /* ignore */ }
        renderToolbar(); state.page = 1; renderMovements();
      });
    } else {
      toolbar.innerHTML = '';
    }
  }

  /* ------------------------------------------------------------------ *
   * Stock levels
   * ------------------------------------------------------------------ */
  function renderStockLevels() { return renderStockTable('/inventory', 'No stock recorded yet', 'Receive stock to start tracking inventory for this branch.'); }

  /** Warehouse stock of the active branch (same columns as the retail list). */
  function renderWarehouseStock() {
    return renderStockTable('/warehouse', 'No warehouse stock yet', 'Receive stock into the warehouse (Receive stock or a purchase), or move it over from retail.');
  }

  async function renderStockTable(endpoint, emptyTitle, emptyMessage) {
    const body = document.getElementById('view-body');
    body.innerHTML = tableShell(['Product', 'SKU', 'On hand', 'Reserved', 'Available', 'Status', 'Actions'], 7, 4);

    const branchId = window.AppShell.getActiveBranchId();
    if (!branchId) {
      body.innerHTML = window.UI.emptyStateHtml({ icon: 'branches', title: 'No branch selected' });
      return;
    }

    try {
      const focused = !!state.productId;
      const { data } = await window.Api.get(endpoint, { branchId, page: focused ? 1 : state.page, limit: focused ? 100 : state.limit, search: state.search });
      const location = endpoint === '/warehouse' ? 'WAREHOUSE' : 'RETAIL';
      if (focused) data.items = data.items.filter((r) => String((r.productId && r.productId._id) || r.productId) === String(state.productId));
      const tbody = body.querySelector('tbody');
      if (focused) {
        body.insertAdjacentHTML('afterbegin', `<div style="display:flex;gap:12px;align-items:center;justify-content:space-between;flex-wrap:wrap;padding:10px var(--space-6);background:#e8f1ff;border-bottom:1px solid #9ec1ff;color:#0b3d91;font-size:14px">
          <span>Showing stock for <strong>${esc(state.productName || 'this product')}</strong></span>
          <button type="button" class="btn btn-secondary btn-sm" id="stock-show-all">Show all stock</button></div>`);
        document.getElementById('stock-show-all').addEventListener('click', () => {
          state.productId = ''; state.productName = ''; state.search = ''; state.page = 1;
          try { window.history.replaceState({}, '', window.location.pathname); } catch { /* ignore */ }
          renderToolbar(); renderStockTable(endpoint, emptyTitle, emptyMessage);
        });
        document.getElementById('pagination').innerHTML = '';
      }
      if (!data.items.length && focused) {
        tbody.innerHTML = `<tr><td colspan="7"><div style="padding:24px;text-align:center">
          <p class="text-secondary" style="margin-bottom:12px">No ${location === 'WAREHOUSE' ? 'warehouse' : 'shop'} stock is recorded for this product in this branch yet.</p>
          <button type="button" class="btn btn-primary btn-sm" data-stock-action="receive" data-pid="${esc(state.productId)}" data-vid="" data-loc="${location}" data-requires-permission="inventory.receive">${window.Icons.get('plus')} Receive stock</button></div></td></tr>`;
      } else if (!data.items.length) {
        tbody.innerHTML = `<tr><td colspan="7">${window.UI.emptyStateHtml({ icon: 'inventory', title: emptyTitle, message: emptyMessage })}</td></tr>`;
      } else {
        tbody.innerHTML = data.items.map((row) => {
          const available = row.availableQuantity != null ? row.availableQuantity : row.quantity - row.reservedQuantity;
          const low = row.quantity - row.reservedQuantity <= (row.lowStockThreshold ?? 5);
          return `
            <tr>
              <td class="cell-primary">${window.UI.escapeHtml(row.productId?.name || 'Unknown product')}</td>
              <td class="text-sm">${window.UI.escapeHtml(row.productId?.sku || '—')}</td>
              <td>${row.quantity}</td>
              <td class="text-muted">${row.reservedQuantity}</td>
              <td>${available}</td>
              <td>${row.quantity <= 0 ? '<span class="badge badge-danger">Out of stock</span>' : low ? '<span class="badge badge-warning">Low</span>' : '<span class="badge badge-success">OK</span>'}</td>
              <td class="actions" style="white-space:nowrap">
                <button type="button" class="btn btn-secondary btn-sm" data-stock-action="receive" data-pid="${esc((row.productId && row.productId._id) || row.productId)}" data-vid="${esc((row.variantId && row.variantId._id) || row.variantId || '')}" data-loc="${location}" data-requires-permission="inventory.receive">Receive</button>
                <button type="button" class="btn btn-secondary btn-sm" data-stock-action="adjust" data-pid="${esc((row.productId && row.productId._id) || row.productId)}" data-vid="${esc((row.variantId && row.variantId._id) || row.variantId || '')}" data-loc="${location}" data-requires-permission="inventory.adjust">Adjust</button>
              </td>
            </tr>
          `;
        }).join('');
      }
      if (!focused) window.UI.renderPagination(document.getElementById('pagination'), data, (p) => { state.page = p; renderStockTable(endpoint, emptyTitle, emptyMessage); });
      window.Permissions.applyPermissionGates(body, window.AppShell.getUser());
      body.querySelectorAll('[data-stock-action]').forEach((btn) => btn.addEventListener('click', () => openStockAction(btn)));
    } catch (err) {
      body.innerHTML = window.UI.emptyStateHtml({ icon: 'alert', title: 'Could not load inventory', message: err.message });
    }
  }

  /* ------------------------------------------------------------------ *
   * All stock (warehouse + retail "books" view)
   * ------------------------------------------------------------------ */
  async function renderOverview() {
    const body = document.getElementById('view-body');
    body.innerHTML = tableShell(['Product', 'SKU', 'Retail', 'Warehouse', 'Total'], 5, 4);
    const branchId = window.AppShell.getActiveBranchId();
    if (!branchId) { body.innerHTML = window.UI.emptyStateHtml({ icon: 'branches', title: 'No branch selected' }); return; }
    try {
      const { data } = await window.Api.get('/warehouse/overview', { branchId, page: state.page, limit: state.limit, search: state.search });
      data.items.forEach((r) => { if (r.name) productNames[r.productId] = r.name; });
      const t = data.totals || {};
      const tiles = `
        <div class="mk-kv" style="padding: var(--space-4) var(--space-6) 0">
          <div><dt>Retail units</dt><dd>${t.retailUnits ?? 0}</dd></div>
          <div><dt>Warehouse units</dt><dd>${t.warehouseUnits ?? 0}</dd></div>
          <div><dt>Retail value (at cost)</dt><dd>${kes(t.retailCostValue)}</dd></div>
          <div><dt>Warehouse value (at cost)</dt><dd>${kes(t.warehouseCostValue)}</dd></div>
        </div>`;
      const rows = data.items.length ? data.items.map((r) => `
        <tr>
          <td class="cell-primary">${esc(r.name || 'Unknown product')}${r.variantId ? ' <span class="badge badge-neutral">variant</span>' : ''}</td>
          <td class="text-sm">${esc(r.sku || '—')}</td>
          <td>${r.retailQuantity}</td>
          <td>${r.warehouseQuantity}</td>
          <td><strong>${r.totalQuantity}</strong></td>
        </tr>`).join('')
        : `<tr><td colspan="5">${window.UI.emptyStateHtml({ icon: 'inventory', title: 'No stock recorded yet', message: 'Receive stock into the warehouse or retail to see it here.' })}</td></tr>`;
      body.innerHTML = `${tiles}
        <div class="table-wrap" style="border:none; border-radius:0">
          <table class="table"><thead><tr><th>Product</th><th>SKU</th><th>Retail</th><th>Warehouse</th><th>Total</th></tr></thead><tbody>${rows}</tbody></table>
        </div>`;
      window.UI.renderPagination(document.getElementById('pagination'), data, (p) => { state.page = p; renderOverview(); });
    } catch (err) {
      body.innerHTML = window.UI.emptyStateHtml({ icon: 'alert', title: 'Could not load stock overview', message: err.message });
    }
  }

  /** Does the movement history agree with the stock rows? */
  async function openReconcileModal() {
    const branchId = window.AppShell.getActiveBranchId();
    if (!branchId) return window.UI.toast.error('Select a branch first');
    const modal = window.UI.openModal({ title: 'Check books', maxWidth: '640px', bodyHtml: `<div id="rc-body">${window.UI.skeletonRows(1, 3)}</div>`, footerHtml: '<button class="btn btn-secondary" data-action="close">Close</button>' });
    modal.querySelector('[data-action="close"]').addEventListener('click', window.UI.closeModal);
    try {
      const { data } = await window.Api.get('/warehouse/reconcile', { branchId });
      if (!data.ok) {
        try {
          const ov = await window.Api.get('/warehouse/overview', { branchId, page: 1, limit: 100 });
          ov.data.items.forEach((r) => { if (r.name) productNames[r.productId] = r.name; });
        } catch { /* ids are shown instead */ }
      }
      modal.querySelector('#rc-body').innerHTML = data.ok
        ? window.UI.emptyStateHtml({ icon: 'check', title: 'Books agree', message: 'The movement history matches the stock on hand, in the shop and in the warehouse.' })
        : `<p class="text-sm text-secondary" style="margin-bottom:var(--space-3)">${data.differences.length} difference${data.differences.length === 1 ? '' : 's'} found. Stock that was entered before movement history existed shows up here.</p>
           <div class="table-wrap"><table class="table"><thead><tr><th>Product</th><th>Where</th><th>History says</th><th>Stock says</th><th>Difference</th></tr></thead><tbody>
           ${data.differences.map((d) => `<tr><td class="text-sm">${esc(productNames[d.productId] || String(d.productId).slice(-6))}</td><td>${locBadge(d.location)}</td><td>${d.ledger}</td><td>${d.stock}</td><td style="color:${d.difference > 0 ? 'var(--color-success)' : 'var(--color-danger)'}">${d.difference > 0 ? '+' : ''}${d.difference}</td></tr>`).join('')}
           </tbody></table></div>`;
    } catch (err) {
      modal.querySelector('#rc-body').innerHTML = window.UI.emptyStateHtml({ icon: 'alert', title: 'Could not run the check', message: err.message });
    }
  }

  /* ------------------------------------------------------------------ *
   * Low stock
   * ------------------------------------------------------------------ */
  async function renderLowStock() {
    const body = document.getElementById('view-body');
    body.innerHTML = `<div style="padding: var(--space-6)">${window.UI.skeletonRows(1, 3)}</div>`;
    document.getElementById('pagination').innerHTML = '';

    const branchId = window.AppShell.getActiveBranchId();
    try {
      const { data } = await window.Api.get('/inventory/low-stock', { branchId });
      if (!data.lowStock.length && !data.outOfStock.length) {
        body.innerHTML = window.UI.emptyStateHtml({ icon: 'check', title: 'All stocked up', message: 'Nothing is low or out of stock right now.' });
        return;
      }
      body.innerHTML = `
        ${sectionTable('Out of stock', data.outOfStock, 'badge-danger')}
        ${sectionTable('Low stock', data.lowStock, 'badge-warning')}
      `;
    } catch (err) {
      body.innerHTML = window.UI.emptyStateHtml({ icon: 'alert', title: 'Could not load low stock alerts', message: err.message });
    }
  }

  function sectionTable(title, rows, badgeClass) {
    if (!rows.length) return '';
    return `
      <div style="padding: var(--space-4) var(--space-6) 0">
        <h3 class="text-sm font-semibold" style="margin-bottom: var(--space-2)">${title} <span class="badge ${badgeClass}">${rows.length}</span></h3>
      </div>
      <div class="table-wrap" style="border:none; border-radius:0">
        <table class="table">
          <tbody>
            ${rows.map((r) => `
              <tr>
                <td class="cell-primary">${window.UI.escapeHtml(r.productId?.name || 'Unknown product')}</td>
                <td class="text-sm text-muted">${window.UI.escapeHtml(r.branchId?.name || '')}</td>
                <td>${r.quantity} in stock</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  /* ------------------------------------------------------------------ *
   * Movements
   * ------------------------------------------------------------------ */
  let movementCategories = null;
  async function loadMovementCategories() {
    if (movementCategories) return movementCategories;
    try { const { data } = await window.Api.get('/categories'); movementCategories = data.categories || []; } catch { movementCategories = []; }
    return movementCategories;
  }

  /** Filters of the Movements tab as API parameters. The date range covers whole days in the user's own time zone. */
  function movementParams(branchId) {
    const mv = state.mv;
    const p = { branchId, page: state.page, limit: state.limit };
    if (wh() && state.location) p.location = state.location;
    if (state.productId) p.productId = state.productId;
    if (mv.search) p.search = mv.search;
    if (mv.categoryId) p.categoryId = mv.categoryId;
    if (mv.type) p.type = mv.type;
    if (mv.from) p.from = new Date(`${mv.from}T00:00:00`).toISOString();
    if (mv.to) p.to = new Date(`${mv.to}T23:59:59.999`).toISOString();
    return p;
  }

  async function renderMovements() {
    const body = document.getElementById('view-body');
    const showLoc = wh();
    const cols = showLoc ? 8 : 7;
    body.innerHTML = tableShell(showLoc ? ['Date', 'Product', 'Where', 'Type', 'Qty', 'Balance', 'Details', 'By'] : ['Date', 'Product', 'Type', 'Qty', 'Balance', 'Details', 'By'], cols, 6);

    const branchId = window.AppShell.getActiveBranchId();
    const ticket = (renderMovements.ticket = (renderMovements.ticket || 0) + 1); // a slower, older answer must never overwrite a newer filter
    try {
      const { data } = await window.Api.get('/inventory/movements', movementParams(branchId));
      if (ticket !== renderMovements.ticket) return;
      const tbody = body.querySelector('tbody');
      const sm = data.summary || { count: data.total, unitsIn: 0, unitsOut: 0, net: 0 };
      const fmt = (n) => (Math.round((Number(n) || 0) * 1000) / 1000).toLocaleString();
      body.insertAdjacentHTML('afterbegin', `
        <div class="mk-kv" style="padding: var(--space-4) var(--space-6) 0">
          <div><dt>Movements found</dt><dd>${fmt(sm.count)}</dd></div>
          <div><dt>Units in</dt><dd style="color:var(--color-success)">+${fmt(sm.unitsIn)}</dd></div>
          <div><dt>Units out</dt><dd style="color:var(--color-danger)">−${fmt(sm.unitsOut)}</dd></div>
          <div><dt>Net change</dt><dd>${sm.net > 0 ? '+' : ''}${fmt(sm.net)}</dd></div>
        </div>`);
      if (!data.items.length) {
        tbody.innerHTML = `<tr><td colspan="${cols}">${window.UI.emptyStateHtml({ icon: 'inventory', title: 'No movements found', message: 'Try a different product, category or date range.' })}</td></tr>`;
      } else {
        tbody.innerHTML = data.items.map((m) => `
          <tr>
            <td class="text-sm">${window.UI.formatDateTime(m.createdAt)}</td>
            <td class="text-sm">${window.UI.escapeHtml(m.productId?.name || '—')}</td>
            ${showLoc ? `<td>${locBadge(m.location)}${m.location === 'WAREHOUSE' && m.warehouseId?.name ? `<div class="text-sm text-muted">${esc(m.warehouseId.name)}</div>` : ''}</td>` : ''}
            <td><span class="badge badge-neutral">${esc(String(m.type).replace(/_/g, ' '))}</span></td>
            <td class="text-sm" style="color: ${m.quantity > 0 ? 'var(--color-success)' : 'var(--color-danger)'}">${m.quantity > 0 ? '+' : ''}${m.quantity}</td>
            <td class="text-sm">${m.newStock}</td>
            <td class="text-sm text-muted" style="max-width:260px">${esc(m.reason || '—')}</td>
            <td class="text-sm text-muted">${window.UI.escapeHtml(m.performedBy?.name || 'System')}</td>
          </tr>
        `).join('');
      }
      window.UI.renderPagination(document.getElementById('pagination'), data, (p) => { state.page = p; renderMovements(); });
    } catch (err) {
      if (ticket !== renderMovements.ticket) return;
      body.innerHTML = window.UI.emptyStateHtml({ icon: 'alert', title: 'Could not load movements', message: err.message });
    }
  }

  /* ------------------------------------------------------------------ *
   * Transfers
   * ------------------------------------------------------------------ */
  const TRANSFER_BADGE = { REQUESTED: 'badge-warning', APPROVED: 'badge-info', IN_TRANSIT: 'badge-info', RECEIVED: 'badge-success', CANCELLED: 'badge-neutral' };
  const NEXT_ACTION = {
    REQUESTED: { label: 'Approve', endpoint: 'approve' },
    APPROVED: { label: 'Dispatch', endpoint: 'dispatch' },
    IN_TRANSIT: { label: 'Mark received', endpoint: 'receive' },
  };

  async function renderTransfers() {
    document.getElementById('pagination').innerHTML = '';
    const body = document.getElementById('view-body');
    body.innerHTML = tableShell(['Transfer', 'From', 'To', 'Items', 'Status', ''], 6, 4);

    try {
      const { data } = await window.Api.get('/transfers', { page: state.page, limit: state.limit });
      const tbody = body.querySelector('tbody');
      if (!data.items.length) {
        tbody.innerHTML = `<tr><td colspan="6">${window.UI.emptyStateHtml({ icon: 'branches', title: 'No transfers yet' })}</td></tr>`;
      } else {
        tbody.innerHTML = data.items.map((t) => {
          const next = NEXT_ACTION[t.status];
          return `
            <tr data-id="${t._id}">
              <td class="cell-primary">${t.transferNumber}</td>
              <td class="text-sm">${window.UI.escapeHtml(t.fromBranchId?.name || '')}</td>
              <td class="text-sm">${window.UI.escapeHtml(t.toBranchId?.name || '')}</td>
              <td class="text-sm">${t.items.length} item${t.items.length === 1 ? '' : 's'}</td>
              <td><span class="badge ${TRANSFER_BADGE[t.status]}">${t.status.replace('_', ' ')}</span></td>
              <td class="actions">
                ${next ? `<button class="btn btn-secondary btn-sm" data-action="${next.endpoint}" data-requires-permission="inventory.transfer">${next.label}</button>` : ''}
                ${['REQUESTED', 'APPROVED'].includes(t.status) ? `<button class="btn btn-ghost btn-sm btn-icon" data-action="cancel" data-requires-permission="inventory.transfer" title="Cancel">${window.Icons.get('close')}</button>` : ''}
              </td>
            </tr>
          `;
        }).join('');
      }
      window.UI.renderPagination(document.getElementById('pagination'), data, (p) => { state.page = p; renderTransfers(); });
      window.Permissions.applyPermissionGates(body, window.AppShell.getUser());

      body.querySelectorAll('[data-action]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const id = btn.closest('tr').dataset.id;
          const action = btn.dataset.action;
          if (action === 'cancel') {
            const ok = await window.UI.confirmDialog({ title: 'Cancel transfer?', confirmText: 'Cancel transfer', danger: true });
            if (!ok) return;
          }
          try {
            await window.Api.post(`/transfers/${id}/${action}`);
            window.UI.toast.success('Transfer updated');
            renderTransfers();
          } catch (err) {
            window.UI.toast.error(err.message);
          }
        });
      });
    } catch (err) {
      body.innerHTML = window.UI.emptyStateHtml({ icon: 'alert', title: 'Could not load transfers', message: err.message });
    }
  }

  /* ------------------------------------------------------------------ *
   * Warehouse <-> retail moves (history)
   * ------------------------------------------------------------------ */
  async function renderLocationMoves() {
    const body = document.getElementById('view-body');
    document.getElementById('pagination').innerHTML = '';
    body.innerHTML = tableShell(['Move', 'Date', 'Direction', 'Items', 'By', ''], 6, 4);
    const branchId = window.AppShell.getActiveBranchId();
    if (!branchId) { body.innerHTML = window.UI.emptyStateHtml({ icon: 'branches', title: 'No branch selected' }); return; }
    try {
      const { data } = await window.Api.get('/warehouse/transfers', { branchId, page: state.page, limit: state.limit });
      const tbody = body.querySelector('tbody');
      if (!data.items.length) {
        tbody.innerHTML = `<tr><td colspan="6">${window.UI.emptyStateHtml({ icon: 'truck', title: 'No warehouse moves yet', message: 'Use "Move stock" to move goods between the warehouse and the shop floor.' })}</td></tr>`;
      } else {
        tbody.innerHTML = data.items.map((t) => `
          <tr data-id="${t._id}">
            <td class="cell-primary">${esc(t.transferNumber)}</td>
            <td class="text-sm">${window.UI.formatDateTime(t.createdAt)}</td>
            <td class="text-sm">${locBadge(t.fromLocation)} &rarr; ${locBadge(t.toLocation)}</td>
            <td class="text-sm">${t.items.length} item${t.items.length === 1 ? '' : 's'}</td>
            <td class="text-sm text-muted">${esc(t.performedBy?.name || 'System')}</td>
            <td class="actions"><button class="btn btn-secondary btn-sm" data-action="view">Details</button></td>
          </tr>`).join('');
        tbody.querySelectorAll('[data-action="view"]').forEach((btn) => btn.addEventListener('click', () => openLocationMoveDetail(btn.closest('tr').dataset.id)));
      }
      window.UI.renderPagination(document.getElementById('pagination'), data, (p) => { state.page = p; renderLocationMoves(); });
    } catch (err) {
      body.innerHTML = window.UI.emptyStateHtml({ icon: 'alert', title: 'Could not load warehouse moves', message: err.message });
    }
  }

  async function openLocationMoveDetail(id) {
    let t;
    try { ({ data: { transfer: t } } = await window.Api.get(`/warehouse/transfers/${id}`)); } catch (err) { return window.UI.toast.error(err.message); }
    const lines = t.items.map((i) => `
      <tr>
        <td class="text-sm">${esc(i.nameSnapshot || i.productId?.name || '—')}</td>
        <td>${i.quantity}</td>
        <td class="text-xs text-muted">${(i.batchAllocations || []).map((b) => `${esc(b.batchNumber)} × ${b.quantity}`).join('<br>') || '—'}</td>
        <td class="text-xs text-muted">${(i.serialNumbers || []).map(esc).join(', ') || '—'}</td>
      </tr>`).join('');
    const modal = window.UI.openModal({
      title: `Move ${t.transferNumber}`, maxWidth: '680px',
      bodyHtml: `
        <div class="text-sm text-secondary" style="margin-bottom:var(--space-3)">${locBadge(t.fromLocation)} &rarr; ${locBadge(t.toLocation)} &middot; ${esc(t.branchId?.name || '')} &middot; ${window.UI.formatDateTime(t.createdAt)} &middot; by ${esc(t.performedBy?.name || 'System')}</div>
        <div class="table-wrap"><table class="table"><thead><tr><th>Item</th><th>Qty</th><th>Batches</th><th>Serial numbers</th></tr></thead><tbody>${lines}</tbody></table></div>
        ${t.notes ? `<p class="text-sm" style="margin-top:var(--space-3)">Notes: ${esc(t.notes)}</p>` : ''}`,
      footerHtml: '<button class="btn btn-secondary" data-action="close">Close</button>',
    });
    modal.querySelector('[data-action="close"]').addEventListener('click', window.UI.closeModal);
  }

  /** Receive / Adjust straight from a stock row: the product (and variant) is already chosen. */
  async function openStockAction(btn) {
    const { stockAction, pid, vid, loc } = btn.dataset;
    if (btn.disabled) return;
    btn.disabled = true;
    try {
      const { data } = await window.Api.get(`/products/${pid}`);
      const product = data.product || data;
      const variant = vid ? ((product.variants || []).find((v) => String(v._id) === String(vid)) || null) : null;
      (stockAction === 'receive' ? openReceiveModal : openAdjustModal)({ product, variant, location: loc });
    } catch (err) {
      window.UI.toast.error(err.message || 'Could not open the product');
    } finally {
      btn.disabled = false;
    }
  }

  /** Current on-hand stock of one product / variant in the active branch (RETAIL or WAREHOUSE pool). */
  async function fetchCurrentStock(product, variant, location) {
    const branchId = window.AppShell.getActiveBranchId();
    const endpoint = location === 'WAREHOUSE' ? '/warehouse' : '/inventory';
    const wantVid = variant ? String(variant._id) : '';
    let page = 1, pages = 1;
    do {
      const { data } = await window.Api.get(endpoint, { branchId, page, limit: 100, search: product.sku || product.name });
      const hit = (data.items || []).find((r) => String((r.productId && r.productId._id) || r.productId) === String(product._id)
        && String((r.variantId && r.variantId._id) || r.variantId || '') === wantVid);
      if (hit) return { quantity: Number(hit.quantity) || 0, reserved: Number(hit.reservedQuantity) || 0 };
      pages = data.pages || 1; page += 1;
    } while (page <= pages && page <= 5);
    return { quantity: 0, reserved: 0 }; // no stock row yet = nothing on hand
  }

  function tableShell(headers, colCount, skeletonRowCount) {
    return `
      <div class="table-wrap" style="border:none; border-radius:0">
        <table class="table">
          <thead><tr>${headers.map((h) => `<th>${h}</th>`).join('')}</tr></thead>
          <tbody>${window.UI.skeletonRows(colCount, skeletonRowCount)}</tbody>
        </table>
      </div>
    `;
  }

  /* ------------------------------------------------------------------ *
   * Receive stock modal
   * ------------------------------------------------------------------ */
  /* ------------------------------------------------------------------ *
   * Low stock SMS (opt-in, paid from SMS credits): text the owner which products are running low
   * ------------------------------------------------------------------ */
  async function openLowStockSmsModal() {
    const esc = window.UI.escapeHtml;
    let s;
    try { s = (await window.Api.get('/sms-alerts/settings')).data; }
    catch (e) { return window.UI.toast.error(e.code === 'COUNTRY_NOT_SUPPORTED' || e.status === 403 ? 'Low stock texts are not available for this account.' : e.message); }
    const d = s.settings.lowStockDigest;

    const modal = window.UI.openModal({
      title: 'Low stock SMS',
      maxWidth: '560px',
      bodyHtml: `
        <p class="text-sm text-secondary" style="margin-bottom:var(--space-3)">
          Get a text on your phone when products are running low or out of stock. <strong>This is optional and paid:</strong>
          each text uses SMS credits from your balance (${esc(String(s.credits))} credit${s.credits === 1 ? '' : 's'} now; a short text is 1 credit per owner).
          ${s.ready ? '' : '<br><span style="color:var(--color-warning)">Texts will not send until you have an approved Sender ID and SMS credits (SMS page).</span>'}
        </p>
        <form id="lsms-form">
          <div class="field"><label class="checkbox-row"><input type="checkbox" name="enabled" ${d.enabled ? 'checked' : ''} /> <span class="text-sm">Text the owner about low stock</span></label></div>
          <div class="field"><label>How often</label>
            <select class="select" name="frequency">
              <option value="weekly" ${d.frequency === 'weekly' ? 'selected' : ''}>Weekly summary (cheapest)</option>
              <option value="daily" ${d.frequency === 'daily' ? 'selected' : ''}>Every day something is low</option>
            </select></div>
          <div class="field"><label class="checkbox-row"><input type="checkbox" name="includeOutOfStock" ${d.includeOutOfStock ? 'checked' : ''} /> <span class="text-sm">Include products that are out of stock</span></label></div>
          <div class="field"><label>Message <span class="text-muted">(leave empty for the default)</span></label>
            <textarea class="textarea" name="template" rows="3" placeholder="${esc(s.defaults.lowStockDigest)}">${esc(d.template || '')}</textarea>
            <div class="field-hint">You can use {shop} {low} {out} {items}. Plain characters only. Preview: <span id="lsms-prev" class="text-muted">...</span></div></div>
        </form>`,
      footerHtml: `
        <button class="btn btn-secondary" data-action="cancel">Cancel</button>
        <button class="btn btn-secondary" data-action="send">Save &amp; send now</button>
        <button class="btn btn-primary" data-action="save">Save</button>`,
    });
    const form = modal.querySelector('#lsms-form');
    const read = () => ({
      enabled: form.elements.enabled.checked, frequency: form.elements.frequency.value,
      includeOutOfStock: form.elements.includeOutOfStock.checked, template: form.elements.template.value.trim(),
    });

    const prev = modal.querySelector('#lsms-prev');
    const refreshPreview = window.UI.debounce(async () => {
      try {
        const r = (await window.Api.post('/sms-alerts/preview', { kind: 'lowStockDigest', template: form.elements.template.value.trim() || undefined })).data;
        prev.textContent = `"${r.text}" (${r.characters} characters, ${r.credits} credit${r.credits === 1 ? '' : 's'} per text)`;
      } catch (e) { prev.textContent = e.message; }
    }, 300);
    form.elements.template.addEventListener('input', refreshPreview);
    refreshPreview();

    modal.querySelector('[data-action="cancel"]').addEventListener('click', window.UI.closeModal);
    const save = async () => { await window.Api.put('/sms-alerts/settings', { lowStockDigest: read() }); };

    modal.querySelector('[data-action="save"]').addEventListener('click', async (e) => {
      window.UI.setButtonLoading(e.currentTarget, true, 'Saving…');
      try { await save(); window.UI.toast.success(read().enabled ? 'Low stock texts are on' : 'Low stock texts are off'); window.UI.closeModal(); }
      catch (err) { window.UI.toast.error(err.message); window.UI.setButtonLoading(e.currentTarget, false); }
    });

    modal.querySelector('[data-action="send"]').addEventListener('click', async (e) => {
      if (!read().enabled) return window.UI.toast.error('Switch the texts on first');
      window.UI.setButtonLoading(e.currentTarget, true, 'Sending…');
      try {
        await save();
        const r = (await window.Api.post('/sms-alerts/low-stock/send-now', {})).data;
        const { low, out } = r.summary || {};
        if (r.sms && r.sms.queued) window.UI.toast.success(`Text queued: ${low} low, ${out} out of stock.`);
        else if (r.sms && r.sms.reason === 'NOTHING') window.UI.toast.success('Nothing is low or out of stock right now.');
        else if (r.sms && r.sms.reason === 'NO_CREDITS') window.UI.toast.error('Not enough SMS credits. Top up on the SMS page.');
        else if (r.sms && r.sms.reason === 'NO_SENDER_ID') window.UI.toast.error('No approved Sender ID yet. Set one up on the SMS page.');
        else window.UI.toast.warning('No text was sent (already sent this hour, or the owner phone is invalid).');
        window.UI.closeModal();
      } catch (err) { window.UI.toast.error(err.message); window.UI.setButtonLoading(e.currentTarget, false); }
    });
  }

  /** Break a bag into sellable sizes (js/core/unit-conversion-kit.js). */
  function openBreakDown() {
    if (!window.UnitKit) return window.UI.toast.error('Unit conversion is not available on this page');
    window.UnitKit.openBreakModal({ onDone: afterChange });
  }

  function openReceiveModal(arg) {
    const preset = arg && arg.product ? arg : null; // (a click event is not a preset)
    const branchId = window.AppShell.getActiveBranchId();
    if (!branchId) return window.UI.toast.error('Select a branch first');

    let selected = null;

    const modal = window.UI.openModal({
      title: 'Receive stock',
      bodyHtml: `
        <form id="receive-form">
          <div class="field">
            <label>Product</label>
            <button type="button" class="btn btn-secondary btn-block" id="pick-product-btn" style="justify-content:flex-start">${window.Icons.get('search')} Select a product</button>
            <div id="selected-product" class="text-sm" style="margin-top: var(--space-2)"></div>
          </div>
          <div class="form-row">
            <div class="field"><label>Quantity received</label><input class="input" name="quantity" type="number" min="1" step="any" inputmode="decimal" required /></div>
            <div class="field"><label>Cost price (KES, optional)</label><input class="input" name="costPrice" type="number" step="0.01" min="0" /></div>
          </div>
          <div class="form-row">
            <div class="field"><label>Batch number <span class="text-muted" id="rcv-batch-opt">(optional)</span></label><input class="input" name="batchNumber" /></div>
            <div class="field"><label>Expiry date <span class="text-muted" id="rcv-exp-opt">(optional)</span></label><input class="input" name="expiryDate" type="date" /></div>
          </div>
          <div class="field-hint" id="rcv-expiry-hint" style="display:none; margin-top:calc(var(--space-2) * -1); margin-bottom:var(--space-3)"></div>
          ${wh() ? `<div class="field"><label>Receive into</label>
            <select class="select" name="location"><option value="RETAIL">Retail (shop floor, ready to sell)</option><option value="WAREHOUSE">Warehouse (wholesale store)</option></select>
            <span class="field-hint">Warehouse stock cannot be sold at the till until you move it to retail.</span></div>` : ''}
          <div class="field" id="serials-field" style="display:none"><label>Serial numbers / IMEIs <span class="text-muted">(one per line, one for each unit received)</span></label><textarea class="textarea" name="serials" rows="4"></textarea></div>
          <div class="field"><label>Reason <span class="text-muted">(optional)</span></label><input class="input" name="reason" placeholder="e.g. Initial stock, supplier delivery" /></div>
        </form>
      `,
      footerHtml: `
        <button class="btn btn-secondary" data-action="cancel">Cancel</button>
        <button class="btn btn-primary" data-action="save" id="receive-save-btn">Receive stock</button>
      `,
    });

    modal.querySelector('[data-action="cancel"]').addEventListener('click', window.UI.closeModal);
    // Receive in any size (a 25 kg bag, a 1/4 bag, kg...): the unit picker converts to the base unit and updates the average cost.
    const uk = window.UnitKit ? window.UnitKit.attachQtyUnit({ modal, qtyInput: modal.querySelector('[name="quantity"]'), costInput: modal.querySelector('[name="costPrice"]'), mode: 'receive' }) : null;
    const applySel = ({ product, variant }) => {
          selected = { product, variant };
          if (uk) uk.setProduct(product);
          const sf = modal.querySelector('#serials-field');
          if (sf) sf.style.display = product.trackSerialNumber ? '' : 'none';
          // Expiry-tracked products must be given an expiry date: it is what feeds the expiry watch.
          const expInput = modal.querySelector('[name="expiryDate"]');
          const expOpt = modal.querySelector('#rcv-exp-opt');
          const hint = modal.querySelector('#rcv-expiry-hint');
          if (expInput) expInput.required = !!product.trackExpiry;
          if (expOpt) expOpt.textContent = product.trackExpiry ? '(required)' : '(optional)';
          if (hint) {
            hint.style.display = product.trackExpiry ? '' : 'none';
            hint.textContent = product.trackExpiry ? 'This product tracks expiry. Leave the batch number empty to use one based on the expiry date.' : '';
          }
          modal.querySelector('#selected-product').innerHTML = `
            <span class="badge badge-info">${window.UI.escapeHtml(variant ? `${product.name} (${Object.values(variant.attributes || {}).join(', ')})` : product.name)}</span>
          `;
    };
    modal.querySelector('#pick-product-btn').addEventListener('click', () => {
      window.ProductPicker.open({ title: 'Select a product to receive', onSelect: applySel });
    });
    if (preset) {
      applySel({ product: preset.product, variant: preset.variant });
      const locSel = modal.querySelector('[name="location"]');
      if (locSel && preset.location) locSel.value = preset.location;
      setTimeout(() => { const q = modal.querySelector('[name="quantity"]'); if (q) q.focus(); }, 50);
    }

    modal.querySelector('[data-action="save"]').addEventListener('click', async () => {
      if (!selected) return window.UI.toast.error('Select a product first');
      const form = modal.querySelector('#receive-form');
      if (!form.reportValidity()) return;

      const raw = window.UI.serializeForm(form);
      if (selected.product.trackExpiry && !raw.expiryDate) return window.UI.toast.error('Enter the expiry date for this product');
      const serials = selected.product.trackSerialNumber ? splitList(raw.serials) : [];
      if (selected.product.trackSerialNumber) {
        if (!serials.length) return window.UI.toast.error('Enter the serial number / IMEI of each unit');
        if (serials.length !== Number(raw.quantity)) return window.UI.toast.error(`You entered ${serials.length} serial number(s) but the quantity is ${raw.quantity}`);
      }
      const btn = document.getElementById('receive-save-btn');
      window.UI.setButtonLoading(btn, true, 'Saving…');
      try {
        await window.Api.post('/inventory/receive', {
          branchId,
          productId: selected.product._id,
          variantId: selected.variant?._id,
          quantity: raw.quantity,
          unitId: uk ? uk.unitId() : undefined,
          updateCost: uk && raw.costPrice ? uk.updateCost() : undefined,
          costPrice: raw.costPrice || undefined,
          batchNumber: raw.batchNumber || undefined,
          expiryDate: raw.expiryDate || undefined,
          reason: raw.reason || undefined,
          location: wh() ? (raw.location || 'RETAIL') : undefined,
          serials: selected.product.trackSerialNumber ? serials : undefined,
        });
        window.UI.toast.success(wh() && raw.location === 'WAREHOUSE' ? 'Stock received into the warehouse' : (uk && uk.factor() !== 1 ? `Stock received: ${uk.base(raw.quantity)} ${selected.product.unit || ''}` : 'Stock received'));
        window.UI.closeModal();
        afterChange();
      } catch (err) {
        window.UI.toast.error(err.message);
      } finally {
        window.UI.setButtonLoading(btn, false);
      }
    });
  }

  /* ------------------------------------------------------------------ *
   * Adjust stock modal
   * ------------------------------------------------------------------ */
  function openAdjustModal(arg) {
    const preset = arg && arg.product ? arg : null; // (a click event is not a preset)
    const branchId = window.AppShell.getActiveBranchId();
    if (!branchId) return window.UI.toast.error('Select a branch first');

    let selected = null;
    let current = null;        // { quantity, reserved } of the chosen product in the chosen pool, null = not known yet
    let loadSeq = 0;

    const modal = window.UI.openModal({
      title: 'Adjust stock',
      bodyHtml: `
        <form id="adjust-form" novalidate>
          <div class="field">
            <label>Product</label>
            <button type="button" class="btn btn-secondary btn-block" id="pick-product-btn" style="justify-content:flex-start">${window.Icons.get('search')} Select a product</button>
            <div id="selected-product" class="text-sm" style="margin-top: var(--space-2)"></div>
          </div>
          ${wh() ? `<div class="field"><label>Adjust stock in</label><select class="select" name="location"><option value="RETAIL">Retail (shop floor)</option><option value="WAREHOUSE">Warehouse</option></select></div>` : ''}
          <div class="field">
            <label>Current stock</label>
            <div id="adj-current" style="font-size:22px;font-weight:700;padding:8px 12px;border-radius:8px;background:var(--color-surface-2,#f3f4f6)">—</div>
            <span class="field-hint" id="adj-current-hint">Select a product to see its current stock.</span>
          </div>
          <div class="field">
            <label>How do you want to adjust?</label>
            <div id="adj-mode" style="display:flex;gap:8px;flex-wrap:wrap">
              <button type="button" class="btn btn-primary btn-sm" data-mode="delta">Add / remove units</button>
              <button type="button" class="btn btn-secondary btn-sm" data-mode="count">Enter counted stock</button>
            </div>
            <span class="field-hint" id="adj-mode-hint">Say how many to add or remove.</span>
          </div>
          <div class="field" id="adj-type-field">
            <label id="adj-type-label">What happened? (current condition)</label>
            <select class="select" name="type" required>
              <option value="ADJUSTMENT_IN">Add stock (found / counted more / correction)</option>
              <option value="ADJUSTMENT_OUT">Remove stock (counted less / correction)</option>
              <option value="DAMAGE">Damaged</option>
              <option value="EXPIRED">Expired</option>
              <option value="LOST">Lost / stolen</option>
            </select>
          </div>
          <div class="form-row">
            <div class="field"><label id="adj-qty-label">Quantity to add</label><input class="input" name="quantity" type="number" min="1" step="1" inputmode="numeric" autocomplete="off" required /></div>
            <div class="field"><label id="adj-new-label">New stock (calculated)</label><input class="input" id="adj-new" type="text" readonly tabindex="-1" placeholder="—" style="font-weight:700" /></div>
          </div>
          <div id="adj-msg" role="alert" style="display:none;margin:0 0 var(--space-3);padding:8px 10px;border-radius:6px;font-weight:600;font-size:13px"></div>
          <div class="field"><label>Reason</label><input class="input" name="reason" required placeholder="e.g. Physical count correction" /></div>
        </form>
      `,
      footerHtml: `
        <button class="btn btn-secondary" data-action="cancel">Cancel</button>
        <button class="btn btn-primary" data-action="save" id="adjust-save-btn">Save adjustment</button>
      `,
    });

    const form = modal.querySelector('#adjust-form');
    const typeEl = form.querySelector('[name="type"]');
    const qtyEl = form.querySelector('[name="quantity"]');
    const locEl = form.querySelector('[name="location"]');
    const newEl = modal.querySelector('#adj-new');
    const msgEl = modal.querySelector('#adj-msg');
    const curEl = modal.querySelector('#adj-current');
    const curHint = modal.querySelector('#adj-current-hint');
    const saveBtn = modal.querySelector('#adjust-save-btn');
    let adjMode = 'delta'; // 'delta' = add / remove units,  'count' = type what is really on the shelf; the system works out the difference
    const typeField = modal.querySelector('#adj-type-field');
    const reasonEl = form.querySelector('[name="reason"]');
    const LABELS = { ADJUSTMENT_IN: 'Quantity to add', ADJUSTMENT_OUT: 'Quantity to remove', DAMAGE: 'Quantity damaged', EXPIRED: 'Quantity expired', LOST: 'Quantity lost / stolen' };
    const pool = () => (wh() && locEl ? locEl.value : 'RETAIL');
    // Adjust in any size / with decimals (12.5 kg, 1/4 bag): the picker converts to the base unit.
    const uk = window.UnitKit ? window.UnitKit.attachQtyUnit({ modal, qtyInput: qtyEl, mode: 'adjust', onChange: () => recalc() }) : null;
    const fracOk = () => !!(uk && uk.fractional());

    const showMsg = (kind, text) => {
      if (!text) { msgEl.style.display = 'none'; msgEl.textContent = ''; return; }
      const red = kind === 'error';
      msgEl.style.cssText = `display:block;margin:0 0 var(--space-3);padding:8px 10px;border-radius:6px;font-weight:600;font-size:13px;background:${red ? '#fdecea' : '#fff7e0'};border:1px solid ${red ? '#d93025' : '#f0b429'};color:${red ? '#b3140a' : '#7a5200'}`;
      msgEl.textContent = text;
    };

    /** Works out the change and checks the entered value. Returns { ok, qty, newStock, type, warn, noChange }. qty is always the amount to add / remove. */
    function recalc() {
      qtyEl.style.borderColor = ''; qtyEl.style.boxShadow = ''; newEl.style.color = '';
      const count = adjMode === 'count';
      const result = { ok: false, qty: NaN, newStock: NaN, type: typeEl.value, warn: '' };
      modal.querySelector('#adj-qty-label').textContent = count ? 'Counted stock (what is on the shelf now)' : (LABELS[typeEl.value] || 'Quantity');
      modal.querySelector('#adj-new-label').textContent = count ? 'Difference (calculated)' : 'New stock (calculated)';
      modal.querySelector('#adj-type-label').textContent = count ? 'Why is there less stock?' : 'What happened? (current condition)';
      const addOpt = typeEl.querySelector('option[value="ADJUSTMENT_IN"]'); if (addOpt) addOpt.disabled = count;
      typeField.style.display = count ? 'none' : ''; // in count mode it only appears when stock turns out to be LOWER
      if (!selected || !current) { newEl.value = ''; showMsg('', ''); return result; }
      const raw = String(qtyEl.value).trim();
      if (raw === '') { newEl.value = ''; showMsg('', ''); return result; }
      const entered = Number(raw);
      const qty = uk ? uk.base(entered) : entered;
      const bad = (text) => {
        qtyEl.style.borderColor = '#d93025'; qtyEl.style.boxShadow = '0 0 0 3px rgba(217,48,37,.25)';
        newEl.value = ''; showMsg('error', text); return result;
      };
      if (!Number.isFinite(qty)) return bad('Enter a valid number.');
      if (qty > 1000000) return bad('That quantity is too large. Check the number you typed.');

      if (count) {
        if (qty < 0) return bad('The counted stock cannot be below 0.');
        if (qty !== 0 && (uk ? !uk.validBase(qty) : !Number.isInteger(qty))) return bad(fracOk() ? 'That makes a part of a single item. Enter a whole number of items.' : 'Enter a whole number (no decimals).');
        const diff = Math.round((qty - current.quantity) * 1000) / 1000;
        if (diff === 0) { newEl.value = '0  (no difference)'; showMsg('warn', `Your count matches the system (${current.quantity}). Nothing to adjust.`); return { ...result, newStock: qty, noChange: true }; }
        const up = diff > 0; const amount = Math.abs(diff);
        if (!up && !['ADJUSTMENT_OUT', 'DAMAGE', 'EXPIRED', 'LOST'].includes(typeEl.value)) typeEl.value = 'ADJUSTMENT_OUT';
        typeField.style.display = up ? 'none' : ''; // stock is lower: let them say why (counted less / damaged / expired / lost)
        newEl.value = `${up ? '+' : '−'}${amount}  (${amount} ${up ? 'extra' : 'missing'})`;
        let warn = '';
        if (up && amount >= 1000 && amount > current.quantity * 10) warn = `Large increase: stock goes from ${current.quantity} to ${qty}. Make sure ${qty} is right.`;
        else if (!up && qty < current.reserved) warn = `${current.reserved} unit(s) are reserved for orders - the counted stock ${qty} is below that.`;
        else if (qty === 0) warn = 'This will leave the product out of stock.';
        showMsg(warn ? 'warn' : '', warn);
        return { ok: true, qty: amount, newStock: qty, type: up ? 'ADJUSTMENT_IN' : typeEl.value, warn, diff };
      }

      if (qty <= 0) return bad('Quantity must be more than 0. Choose "Remove stock" to reduce stock.');
      if (uk ? !uk.validBase(qty) : !Number.isInteger(qty)) return bad(fracOk() ? 'That makes a part of a single item. Enter a whole number of items.' : 'Enter a whole number (no decimals).');
      const add = typeEl.value === 'ADJUSTMENT_IN';
      if (!add && qty > current.quantity) return bad(`You cannot remove ${qty}: only ${current.quantity} in stock. New stock cannot go below 0.`);
      const newStock = add ? current.quantity + qty : current.quantity - qty;
      newEl.value = `${Math.round(newStock * 1000) / 1000}  (${add ? '+' : '−'}${qty})`;
      let warn = '';
      if (add && qty >= 1000 && qty > current.quantity * 10) warn = `Large increase: stock goes from ${current.quantity} to ${newStock}. Make sure ${qty} is right.`;
      else if (!add && newStock < current.reserved) warn = `${current.reserved} unit(s) are reserved for orders - new stock ${newStock} is below that.`;
      else if (!add && newStock === 0) warn = 'This will leave the product out of stock.';
      showMsg(warn ? 'warn' : '', warn);
      return { ok: true, qty, newStock, type: typeEl.value, warn };
    }

    function setMode(mode) {
      adjMode = mode;
      modal.querySelectorAll('#adj-mode [data-mode]').forEach((b) => { const on = b.dataset.mode === mode; b.classList.toggle('btn-primary', on); b.classList.toggle('btn-secondary', !on); });
      modal.querySelector('#adj-mode-hint').textContent = mode === 'count'
        ? 'Type the stock you actually counted. The system works out how many are extra or missing and corrects the stock.'
        : 'Say how many to add or remove.';
      if (mode === 'count' && !reasonEl.value.trim()) reasonEl.value = 'Physical stock count';
      if (mode === 'delta' && reasonEl.value === 'Physical stock count') reasonEl.value = '';
      qtyEl.value = ''; recalc();
      setTimeout(() => qtyEl.focus(), 30);
    }
    modal.querySelector('#adj-mode').addEventListener('click', (e) => { const b = e.target.closest('[data-mode]'); if (b && b.dataset.mode !== adjMode) setMode(b.dataset.mode); });

    async function loadCurrent() {
      const my = ++loadSeq;
      current = null;
      curEl.textContent = '…'; curHint.textContent = 'Loading current stock…';
      recalc();
      if (!selected) { curEl.textContent = '—'; curHint.textContent = 'Select a product to see its current stock.'; return; }
      try {
        const c = await fetchCurrentStock(selected.product, selected.variant, pool());
        if (my !== loadSeq) return;
        current = c;
        curEl.textContent = String(c.quantity);
        curHint.textContent = `${pool() === 'WAREHOUSE' ? 'Warehouse' : 'Shop'} stock in this branch${c.reserved ? ` · ${c.reserved} reserved` : ''}.`;
      } catch (err) {
        if (my !== loadSeq) return;
        curEl.textContent = '?';
        curHint.innerHTML = '<span style="color:#b3140a;font-weight:600">Could not load current stock.</span> <a href="#" id="adj-retry">Try again</a>';
        const r = modal.querySelector('#adj-retry'); if (r) r.addEventListener('click', (e) => { e.preventDefault(); loadCurrent(); });
      }
      recalc();
    }

    const select = ({ product, variant }) => {
      selected = { product, variant: variant || null };
      if (uk) uk.setProduct(product);
      modal.querySelector('#selected-product').innerHTML = `<span class="badge badge-info">${window.UI.escapeHtml(variant ? `${product.name} (${Object.values(variant.attributes || {}).join(', ')})` : product.name)}</span>`;
      loadCurrent();
      setTimeout(() => qtyEl.focus(), 50);
    };

    modal.querySelector('[data-action="cancel"]').addEventListener('click', window.UI.closeModal);
    modal.querySelector('#pick-product-btn').addEventListener('click', () => {
      window.ProductPicker.open({ title: 'Select a product to adjust', onSelect: select });
    });
    typeEl.addEventListener('change', recalc);
    qtyEl.addEventListener('input', recalc);
    setMode('delta'); // paints labels and the active switch
    if (locEl) locEl.addEventListener('change', loadCurrent);
    // block characters that make no sense in a whole-number quantity (e, +, -, .)
    qtyEl.addEventListener('keydown', (e) => { if ((fracOk() ? ['e', 'E', '+', '-'] : ['e', 'E', '+', '-', '.', ',']).includes(e.key)) e.preventDefault(); });
    qtyEl.addEventListener('wheel', () => qtyEl.blur(), { passive: true });

    if (preset) {
      if (locEl && preset.location) locEl.value = preset.location;
      select({ product: preset.product, variant: preset.variant });
    }

    let saving = false;
    saveBtn.addEventListener('click', async () => {
      if (saving) return; // a second tap while it is working does nothing
      saving = true;
      window.UI.setButtonLoading(saveBtn, true, 'Saving…'); // react the instant it is tapped; the checks below happen while it spins
      try {
        if (!selected) return window.UI.toast.error('Select a product first');
        if (!current) return window.UI.toast.error('Current stock is not loaded yet - wait a moment or try again');
        let r = recalc();
        if (!String(qtyEl.value).trim()) { window.UI.toast.error(adjMode === 'count' ? 'Enter the counted stock' : 'Enter the quantity'); qtyEl.focus(); return; }
        if (r.noChange) { window.UI.toast.error('Your count matches the stock already recorded - nothing to adjust'); return; }
        if (!r.ok) { window.UI.toast.error(msgEl.textContent || 'Check the quantity'); qtyEl.focus(); return; }
        if (adjMode === 'count' && !reasonEl.value.trim()) reasonEl.value = 'Physical stock count';
        if (!reasonEl.value.trim()) { window.UI.toast.error('Enter the reason'); reasonEl.focus(); return; }

        // the stock may have changed (a sale) while the window was open: re-read it and re-check BEFORE asking to confirm
        try {
          const fresh = await fetchCurrentStock(selected.product, selected.variant, pool());
          if (fresh.quantity !== current.quantity) {
            current = fresh; curEl.textContent = String(fresh.quantity); recalc();
            window.UI.toast.error(`Stock changed to ${fresh.quantity} while you were working. Check the new value and save again.`);
            return;
          }
        } catch { /* the server still validates */ }

        const up = r.type === 'ADJUSTMENT_IN';
        const name = selected.variant ? `${selected.product.name} (${Object.values(selected.variant.attributes || {}).join(', ')})` : selected.product.name;
        const message = adjMode === 'count'
          ? `${name}: you counted ${r.newStock}, the system had ${current.quantity}. ${r.qty} ${up ? 'extra will be added' : 'missing will be removed'} so the stock becomes ${r.newStock}.${r.warn ? ` ${r.warn}` : ''}`
          : `${name}: ${up ? 'add' : 'remove'} ${r.qty}. Stock changes from ${current.quantity} to ${r.newStock}.${r.warn ? ` ${r.warn}` : ''}`;
        const ok = await window.UI.confirmDialog({ title: 'Confirm stock change', message, confirmText: 'Yes, save', danger: !up });
        if (!ok) return;

        const values = window.UI.serializeForm(form);
        await window.Api.post('/inventory/adjust', {
          branchId, productId: selected.product._id, variantId: selected.variant?._id,
          type: r.type,
          // counted stock is sent as the exact difference in the base unit; add/remove keeps the unit the user chose
          quantity: adjMode === 'count' ? r.qty : (uk ? uk.entered() : r.qty),
          unitId: adjMode === 'count' ? undefined : (uk ? uk.unitId() : undefined),
          reason: values.reason || reasonEl.value.trim(),
          location: wh() ? (values.location || 'RETAIL') : undefined,
        });
        window.UI.toast.success(adjMode === 'count' ? `Stock corrected: ${current.quantity} → ${r.newStock} (${up ? '+' : '−'}${r.qty})` : `Stock adjusted: ${current.quantity} → ${r.newStock}`);
        window.UI.closeModal();
        afterChange();
      } catch (err) {
        window.UI.toast.error(err.message);
      } finally {
        saving = false;
        window.UI.setButtonLoading(saveBtn, false);
      }
    });
  }

  /* ------------------------------------------------------------------ *
   * New transfer modal
   * ------------------------------------------------------------------ */
  function openTransferModal() {
    const items = []; // { product, variant, quantity }

    const modal = window.UI.openModal({
      title: 'New stock transfer',
      maxWidth: '600px',
      bodyHtml: `
        <form id="transfer-form">
          <div class="form-row">
            <div class="field">
              <label>From branch</label>
              <select class="select" name="fromBranchId" required>${branchesCache.map((b) => `<option value="${b._id}">${window.UI.escapeHtml(b.name)}</option>`).join('')}</select>
            </div>
            <div class="field">
              <label>To branch</label>
              <select class="select" name="toBranchId" required>${branchesCache.map((b) => `<option value="${b._id}">${window.UI.escapeHtml(b.name)}</option>`).join('')}</select>
            </div>
          </div>
          <div class="field">
            <label>Items</label>
            <div id="transfer-items"></div>
            <button type="button" class="btn btn-secondary btn-sm" id="add-item-btn">${window.Icons.get('plus')} Add item</button>
          </div>
          <div class="field"><label>Notes <span class="text-muted">(optional)</span></label><textarea class="textarea" name="notes"></textarea></div>
        </form>
      `,
      footerHtml: `
        <button class="btn btn-secondary" data-action="cancel">Cancel</button>
        <button class="btn btn-primary" data-action="save" id="transfer-save-btn">Request transfer</button>
      `,
    });

    function renderItems() {
      const el = modal.querySelector('#transfer-items');
      if (!items.length) {
        el.innerHTML = '<p class="text-sm text-muted">No items added yet.</p>';
        return;
      }
      el.innerHTML = items.map((it, i) => `
        <div class="flex items-center gap-2" style="margin-bottom: var(--space-2)">
          <span class="text-sm" style="flex:1">${window.UI.escapeHtml(it.product.name)}${it.variant ? ` <span class="text-muted">(${Object.values(it.variant.attributes || {}).join(', ')})</span>` : ''}</span>
          <input class="input" type="number" min="1" value="${it.quantity}" data-item-qty="${i}" style="width:80px; height:36px" />
          <button type="button" class="btn btn-ghost btn-sm btn-icon" data-remove-item="${i}">${window.Icons.get('trash')}</button>
        </div>
      `).join('');

      el.querySelectorAll('[data-item-qty]').forEach((input) => {
        input.addEventListener('change', () => { items[Number(input.dataset.itemQty)].quantity = Number(input.value); });
      });
      el.querySelectorAll('[data-remove-item]').forEach((btn) => {
        btn.addEventListener('click', () => { items.splice(Number(btn.dataset.removeItem), 1); renderItems(); });
      });
    }
    renderItems();

    modal.querySelector('#add-item-btn').addEventListener('click', () => {
      window.ProductPicker.open({
        onSelect: ({ product, variant }) => {
          items.push({ product, variant, quantity: 1 });
          renderItems();
        },
      });
    });

    modal.querySelector('[data-action="cancel"]').addEventListener('click', window.UI.closeModal);
    modal.querySelector('[data-action="save"]').addEventListener('click', async () => {
      const form = modal.querySelector('#transfer-form');
      if (!form.reportValidity()) return;
      if (!items.length) return window.UI.toast.error('Add at least one item');

      const raw = window.UI.serializeForm(form);
      if (raw.fromBranchId === raw.toBranchId) return window.UI.toast.error('Source and destination must be different branches');

      const btn = document.getElementById('transfer-save-btn');
      window.UI.setButtonLoading(btn, true, 'Requesting…');
      try {
        await window.Api.post('/transfers', {
          fromBranchId: raw.fromBranchId,
          toBranchId: raw.toBranchId,
          notes: raw.notes,
          items: items.map((it) => ({ productId: it.product._id, variantId: it.variant?._id, quantity: it.quantity })),
        });
        window.UI.toast.success('Transfer requested');
        window.UI.closeModal();
        const tabBtn = document.querySelector('[data-view="transfers"]'); if (tabBtn) tabBtn.click(); else afterChange();
      } catch (err) {
        window.UI.toast.error(err.message);
      } finally {
        window.UI.setButtonLoading(btn, false);
      }
    });
  }

  /* ------------------------------------------------------------------ *
   * Move stock between warehouse and retail (same branch)
   * ------------------------------------------------------------------ */
  function openMoveModal() {
    const branchId = window.AppShell.getActiveBranchId();
    if (!branchId) return window.UI.toast.error('Select a branch first');
    const items = []; // { product, variant, quantity, serialsText }

    const modal = window.UI.openModal({
      title: `Move stock · ${window.AppShell.getActiveBranchName?.() || 'this branch'}`,
      maxWidth: '640px',
      bodyHtml: `
        <form id="move-form">
          <div class="field">
            <label>Direction</label>
            <select class="select" name="direction">
              <option value="WAREHOUSE>RETAIL">Warehouse &rarr; Retail (restock the shop floor)</option>
              <option value="RETAIL>WAREHOUSE">Retail &rarr; Warehouse (return to the store)</option>
            </select>
          </div>
          <div class="field">
            <label>Items</label>
            <div id="move-items"></div>
            <button type="button" class="btn btn-secondary btn-sm" id="move-add-btn">${window.Icons.get('plus')} Add item</button>
          </div>
          <div class="field"><label>Notes <span class="text-muted">(optional)</span></label><textarea class="textarea" name="notes" maxlength="500"></textarea></div>
        </form>`,
      footerHtml: `
        <button class="btn btn-secondary" data-action="cancel">Cancel</button>
        <button class="btn btn-primary" data-action="save" id="move-save-btn">Move stock</button>`,
    });

    function renderItems() {
      const el = modal.querySelector('#move-items');
      if (!items.length) { el.innerHTML = '<p class="text-sm text-muted">No items added yet.</p>'; return; }
      el.innerHTML = items.map((it, i) => `
        <div style="margin-bottom:var(--space-3); padding-bottom:var(--space-3); border-bottom:1px solid var(--color-border)">
          <div class="flex items-center gap-2">
            <span class="text-sm" style="flex:1">${esc(it.product.name)}${it.variant ? ` <span class="text-muted">(${esc(variantText(it.variant))})</span>` : ''}${it.product.trackSerialNumber ? ' <span class="badge badge-info">serials</span>' : ''}</span>
            <input class="input" type="number" min="0" step="any" value="${esc(it.quantity)}" data-qty="${i}" style="width:90px; height:36px" />
            <button type="button" class="btn btn-ghost btn-sm btn-icon" data-remove="${i}">${window.Icons.get('trash')}</button>
          </div>
          ${it.product.trackSerialNumber ? `<textarea class="textarea" data-serials="${i}" rows="2" placeholder="Serial numbers / IMEIs to move, one per line" style="margin-top:var(--space-2)">${esc(it.serialsText)}</textarea>` : ''}
        </div>`).join('');
      el.querySelectorAll('[data-qty]').forEach((x) => x.addEventListener('input', () => { items[Number(x.dataset.qty)].quantity = x.value; }));
      el.querySelectorAll('[data-serials]').forEach((x) => x.addEventListener('input', () => { items[Number(x.dataset.serials)].serialsText = x.value; }));
      el.querySelectorAll('[data-remove]').forEach((x) => x.addEventListener('click', () => { items.splice(Number(x.dataset.remove), 1); renderItems(); }));
    }
    renderItems();

    modal.querySelector('#move-add-btn').addEventListener('click', () => {
      window.ProductPicker.open({
        title: 'Select a product to move',
        onSelect: ({ product, variant }) => { items.push({ product, variant, quantity: 1, serialsText: '' }); renderItems(); },
      });
    });
    modal.querySelector('[data-action="cancel"]').addEventListener('click', window.UI.closeModal);

    modal.querySelector('[data-action="save"]').addEventListener('click', async () => {
      if (!items.length) return window.UI.toast.error('Add at least one item');
      const raw = window.UI.serializeForm(modal.querySelector('#move-form'));
      const [fromLocation, toLocation] = String(raw.direction || 'WAREHOUSE>RETAIL').split('>');
      const lines = [];
      for (const it of items) {
        const qty = Number(it.quantity);
        if (!(qty > 0)) return window.UI.toast.error(`Enter a quantity for ${it.product.name}`);
        const line = { productId: it.product._id, variantId: it.variant?._id, quantity: qty };
        if (it.product.trackSerialNumber) {
          const serials = splitList(it.serialsText);
          if (!Number.isInteger(qty)) return window.UI.toast.error(`${it.product.name}: serial-tracked units must be whole numbers`);
          if (serials.length !== qty) return window.UI.toast.error(`${it.product.name}: enter ${qty} serial number(s) - you entered ${serials.length}`);
          line.serialNumbers = serials;
        }
        lines.push(line);
      }
      const btn = document.getElementById('move-save-btn');
      window.UI.setButtonLoading(btn, true, 'Moving…');
      try {
        await window.Api.post('/warehouse/transfers', { branchId, fromLocation, toLocation, items: lines, notes: raw.notes || undefined });
        window.UI.toast.success(`Stock moved to ${locLabel(toLocation).toLowerCase()}`);
        window.UI.closeModal();
        state.page = 1;
        document.querySelector('[data-view="locmoves"]')?.click();
      } catch (err) {
        window.UI.toast.error(err.message);
      } finally {
        window.UI.setButtonLoading(btn, false);
      }
    });
  }
})(); 