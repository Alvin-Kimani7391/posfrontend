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
 */
(function () {
  const state = { view: 'stock', page: 1, limit: 10, search: '', location: '' };
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

  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    contentEl = window.AppShell.mount({ title: 'Inventory' });
    if (!contentEl) return;

    // the warehouse tabs depend on the business features, so wait for the profile before drawing the page
    try { await window.AppShell.whenProfileReady?.(); } catch { /* the cached profile is used */ }
    await getBranches();
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
          ${wh() ? `<button class="btn btn-secondary" id="move-stock-btn" data-requires-permission="inventory.transfer">${window.Icons.get('truck')} Move stock</button>` : ''}
          <button class="btn btn-primary" id="new-transfer-btn" data-requires-permission="inventory.transfer">${window.Icons.get('branches')} New transfer</button>
        </div>
      </div>

      <div class="card">
        <div class="tabs" style="padding: 0 var(--space-6)">
          ${wh() ? '<button class="tab-btn" data-view="overview">All stock</button>' : ''}
          <button class="tab-btn active" data-view="stock">${wh() ? 'Retail stock' : 'Stock levels'}</button>
          ${wh() ? '<button class="tab-btn" data-view="warehouse">Warehouse</button>' : ''}
          <button class="tab-btn" data-view="lowstock">Low stock</button>
          <button class="tab-btn" data-view="movements">Movements</button>
          <button class="tab-btn" data-view="transfers">${wh() ? 'Branch transfers' : 'Transfers'}</button>
          ${wh() ? '<button class="tab-btn" data-view="locmoves">Warehouse moves</button>' : ''}
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
    document.getElementById('move-stock-btn')?.addEventListener('click', openMoveModal);
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

  async function renderActiveView() {
    window.Permissions.applyPermissionGates(contentEl, window.AppShell.getUser());
    renderToolbar();
    if (state.view === 'overview') return renderOverview();
    if (state.view === 'stock') return renderStockLevels();
    if (state.view === 'warehouse') return renderWarehouseStock();
    if (state.view === 'lowstock') return renderLowStock();
    if (state.view === 'movements') return renderMovements();
    if (state.view === 'transfers') return renderTransfers();
    if (state.view === 'locmoves') return renderLocationMoves();
  }

  function renderToolbar() {
    const toolbar = document.getElementById('view-toolbar');
    const searchable = ['stock', 'warehouse', 'overview'].includes(state.view);
    if (searchable) {
      toolbar.innerHTML = `
        <div class="toolbar-search input-group">
          <span class="input-group-icon">${window.Icons.get('search')}</span>
          <input class="input" id="search-input" type="text" placeholder="Search by product name or SKU" value="${esc(state.search)}" />
        </div>
        ${state.view === 'overview' ? `<span style="flex:1"></span><button class="btn btn-secondary btn-sm" id="reconcile-btn" type="button">${window.Icons.get('check')} Check books</button>` : ''}
      `;
      document.getElementById('search-input').addEventListener('input', window.UI.debounce((e) => {
        state.search = e.target.value.trim();
        state.page = 1;
        if (state.view === 'stock') renderStockLevels();
        else if (state.view === 'warehouse') renderWarehouseStock();
        else renderOverview();
      }));
      document.getElementById('reconcile-btn')?.addEventListener('click', openReconcileModal);
    } else if (state.view === 'movements' && wh()) {
      toolbar.innerHTML = `
        <select class="select" id="loc-filter" style="max-width:200px">
          <option value="">Retail + warehouse</option>
          <option value="RETAIL" ${state.location === 'RETAIL' ? 'selected' : ''}>Retail only</option>
          <option value="WAREHOUSE" ${state.location === 'WAREHOUSE' ? 'selected' : ''}>Warehouse only</option>
        </select>`;
      document.getElementById('loc-filter').addEventListener('change', (e) => { state.location = e.target.value; state.page = 1; renderMovements(); });
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
    body.innerHTML = tableShell(['Product', 'SKU', 'On hand', 'Reserved', 'Available', ''], 5, 4);

    const branchId = window.AppShell.getActiveBranchId();
    if (!branchId) {
      body.innerHTML = window.UI.emptyStateHtml({ icon: 'branches', title: 'No branch selected' });
      return;
    }

    try {
      const { data } = await window.Api.get(endpoint, { branchId, page: state.page, limit: state.limit, search: state.search });
      const tbody = body.querySelector('tbody');
      if (!data.items.length) {
        tbody.innerHTML = `<tr><td colspan="6">${window.UI.emptyStateHtml({ icon: 'inventory', title: emptyTitle, message: emptyMessage })}</td></tr>`;
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
            </tr>
          `;
        }).join('');
      }
      window.UI.renderPagination(document.getElementById('pagination'), data, (p) => { state.page = p; renderStockTable(endpoint, emptyTitle, emptyMessage); });
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
  async function renderMovements() {
    const body = document.getElementById('view-body');
    const showLoc = wh();
    body.innerHTML = tableShell(showLoc ? ['Date', 'Product', 'Where', 'Type', 'Qty', 'Balance', 'By'] : ['Date', 'Product', 'Type', 'Qty', 'Balance', 'By'], showLoc ? 7 : 6, 6);

    const branchId = window.AppShell.getActiveBranchId();
    try {
      const { data } = await window.Api.get('/inventory/movements', { branchId, page: state.page, limit: state.limit, location: showLoc ? state.location : undefined });
      const tbody = body.querySelector('tbody');
      if (!data.items.length) {
        tbody.innerHTML = `<tr><td colspan="${showLoc ? 7 : 6}">${window.UI.emptyStateHtml({ icon: 'inventory', title: 'No movements yet' })}</td></tr>`;
      } else {
        tbody.innerHTML = data.items.map((m) => `
          <tr>
            <td class="text-sm">${window.UI.formatDateTime(m.createdAt)}</td>
            <td class="text-sm">${window.UI.escapeHtml(m.productId?.name || '—')}</td>
            ${showLoc ? `<td>${locBadge(m.location)}</td>` : ''}
            <td><span class="badge badge-neutral">${m.type}</span></td>
            <td class="text-sm" style="color: ${m.quantity > 0 ? 'var(--color-success)' : 'var(--color-danger)'}">${m.quantity > 0 ? '+' : ''}${m.quantity}</td>
            <td class="text-sm">${m.newStock}</td>
            <td class="text-sm text-muted">${window.UI.escapeHtml(m.performedBy?.name || 'System')}</td>
          </tr>
        `).join('');
      }
      window.UI.renderPagination(document.getElementById('pagination'), data, (p) => { state.page = p; renderMovements(); });
    } catch (err) {
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
  function openReceiveModal() {
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
            <div class="field"><label>Quantity received</label><input class="input" name="quantity" type="number" min="1" required /></div>
            <div class="field"><label>Cost price (KES, optional)</label><input class="input" name="costPrice" type="number" step="0.01" min="0" /></div>
          </div>
          <div class="form-row">
            <div class="field"><label>Batch number <span class="text-muted">(optional)</span></label><input class="input" name="batchNumber" /></div>
            <div class="field"><label>Expiry date <span class="text-muted">(optional)</span></label><input class="input" name="expiryDate" type="date" /></div>
          </div>
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
    modal.querySelector('#pick-product-btn').addEventListener('click', () => {
      window.ProductPicker.open({
        title: 'Select a product to receive',
        onSelect: ({ product, variant }) => {
          selected = { product, variant };
          const sf = modal.querySelector('#serials-field');
          if (sf) sf.style.display = product.trackSerialNumber ? '' : 'none';
          modal.querySelector('#selected-product').innerHTML = `
            <span class="badge badge-info">${window.UI.escapeHtml(variant ? `${product.name} (${Object.values(variant.attributes || {}).join(', ')})` : product.name)}</span>
          `;
        },
      });
    });

    modal.querySelector('[data-action="save"]').addEventListener('click', async () => {
      if (!selected) return window.UI.toast.error('Select a product first');
      const form = modal.querySelector('#receive-form');
      if (!form.reportValidity()) return;

      const raw = window.UI.serializeForm(form);
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
          costPrice: raw.costPrice || undefined,
          batchNumber: raw.batchNumber || undefined,
          expiryDate: raw.expiryDate || undefined,
          reason: raw.reason || undefined,
          location: wh() ? (raw.location || 'RETAIL') : undefined,
          serials: selected.product.trackSerialNumber ? serials : undefined,
        });
        window.UI.toast.success(wh() && raw.location === 'WAREHOUSE' ? 'Stock received into the warehouse' : 'Stock received');
        window.UI.closeModal();
        renderActiveView();
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
  function openAdjustModal() {
    const branchId = window.AppShell.getActiveBranchId();
    if (!branchId) return window.UI.toast.error('Select a branch first');

    let selected = null;

    const modal = window.UI.openModal({
      title: 'Adjust stock',
      bodyHtml: `
        <form id="adjust-form">
          <div class="field">
            <label>Product</label>
            <button type="button" class="btn btn-secondary btn-block" id="pick-product-btn" style="justify-content:flex-start">${window.Icons.get('search')} Select a product</button>
            <div id="selected-product" class="text-sm" style="margin-top: var(--space-2)"></div>
          </div>
          <div class="form-row">
            <div class="field">
              <label>Adjustment type</label>
              <select class="select" name="type" required>
                <option value="ADJUSTMENT_IN">Correction - add stock</option>
                <option value="ADJUSTMENT_OUT">Correction - remove stock</option>
                <option value="DAMAGE">Damaged</option>
                <option value="EXPIRED">Expired</option>
                <option value="LOST">Lost / stolen</option>
              </select>
            </div>
            <div class="field"><label>Quantity</label><input class="input" name="quantity" type="number" min="1" required /></div>
          </div>
          ${wh() ? `<div class="field"><label>Adjust stock in</label><select class="select" name="location"><option value="RETAIL">Retail (shop floor)</option><option value="WAREHOUSE">Warehouse</option></select></div>` : ''}
          <div class="field"><label>Reason</label><input class="input" name="reason" required placeholder="e.g. Physical count correction" /></div>
        </form>
      `,
      footerHtml: `
        <button class="btn btn-secondary" data-action="cancel">Cancel</button>
        <button class="btn btn-primary" data-action="save" id="adjust-save-btn">Save adjustment</button>
      `,
    });

    modal.querySelector('[data-action="cancel"]').addEventListener('click', window.UI.closeModal);
    modal.querySelector('#pick-product-btn').addEventListener('click', () => {
      window.ProductPicker.open({
        title: 'Select a product to adjust',
        onSelect: ({ product, variant }) => {
          selected = { product, variant };
          modal.querySelector('#selected-product').innerHTML = `<span class="badge badge-info">${window.UI.escapeHtml(variant ? `${product.name} (${Object.values(variant.attributes || {}).join(', ')})` : product.name)}</span>`;
        },
      });
    });

    modal.querySelector('[data-action="save"]').addEventListener('click', async () => {
      if (!selected) return window.UI.toast.error('Select a product first');
      const form = modal.querySelector('#adjust-form');
      if (!form.reportValidity()) return;

      const raw = window.UI.serializeForm(form);
      const btn = document.getElementById('adjust-save-btn');
      window.UI.setButtonLoading(btn, true, 'Saving…');
      try {
        await window.Api.post('/inventory/adjust', {
          branchId, productId: selected.product._id, variantId: selected.variant?._id,
          type: raw.type, quantity: raw.quantity, reason: raw.reason,
          location: wh() ? (raw.location || 'RETAIL') : undefined,
        });
        window.UI.toast.success('Stock adjusted');
        window.UI.closeModal();
        renderActiveView();
      } catch (err) {
        window.UI.toast.error(err.message);
      } finally {
        window.UI.setButtonLoading(btn, false);
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
        document.querySelector('[data-view="transfers"]').click();
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
