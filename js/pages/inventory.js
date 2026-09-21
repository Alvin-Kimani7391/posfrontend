/**
 * inventory.js
 * Branch-scoped: reads the active branch from AppShell (the topbar branch
 * switcher) and refetches whenever it changes. Four tabs share one page:
 * Stock levels, Low stock, Movements, and Transfers (which is the only
 * cross-branch view, since a transfer touches two branches at once).
 */
(function () {
  const state = { view: 'stock', page: 1, limit: 10, search: '' };
  let contentEl;
  let branchesCache = null;
  let unsubscribeBranchChange = null;

  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    contentEl = window.AppShell.mount({ title: 'Inventory' });
    if (!contentEl) return;

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
          <p>Stock levels, movement history, and inter-branch transfers.</p>
        </div>
        <div class="flex gap-2">
          <button class="btn btn-secondary" id="adjust-stock-btn" data-requires-permission="inventory.adjust">${window.Icons.get('edit')} Adjust</button>
          <button class="btn btn-secondary" id="receive-stock-btn" data-requires-permission="inventory.receive">${window.Icons.get('plus')} Receive stock</button>
          <button class="btn btn-primary" id="new-transfer-btn" data-requires-permission="inventory.transfer">${window.Icons.get('branches')} New transfer</button>
        </div>
      </div>

      <div class="card">
        <div class="tabs" style="padding: 0 var(--space-6)">
          <button class="tab-btn active" data-view="stock">Stock levels</button>
          <button class="tab-btn" data-view="lowstock">Low stock</button>
          <button class="tab-btn" data-view="movements">Movements</button>
          <button class="tab-btn" data-view="transfers">Transfers</button>
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
    document.getElementById('new-transfer-btn').addEventListener('click', openTransferModal);
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
    if (state.view === 'stock') return renderStockLevels();
    if (state.view === 'lowstock') return renderLowStock();
    if (state.view === 'movements') return renderMovements();
    if (state.view === 'transfers') return renderTransfers();
  }

  function renderToolbar() {
    const toolbar = document.getElementById('view-toolbar');
    if (state.view === 'stock') {
      toolbar.innerHTML = `
        <div class="toolbar-search input-group">
          <span class="input-group-icon">${window.Icons.get('search')}</span>
          <input class="input" id="search-input" type="text" placeholder="Search by product name or SKU" />
        </div>
      `;
      document.getElementById('search-input').addEventListener('input', window.UI.debounce((e) => {
        state.search = e.target.value.trim();
        state.page = 1;
        renderStockLevels();
      }));
    } else {
      toolbar.innerHTML = '';
    }
  }

  /* ------------------------------------------------------------------ *
   * Stock levels
   * ------------------------------------------------------------------ */
  async function renderStockLevels() {
    const body = document.getElementById('view-body');
    body.innerHTML = tableShell(['Product', 'SKU', 'On hand', 'Reserved', 'Available', ''], 5, 4);

    const branchId = window.AppShell.getActiveBranchId();
    if (!branchId) {
      body.innerHTML = window.UI.emptyStateHtml({ icon: 'branches', title: 'No branch selected' });
      return;
    }

    try {
      const { data } = await window.Api.get('/inventory', { branchId, page: state.page, limit: state.limit, search: state.search });
      const tbody = body.querySelector('tbody');
      if (!data.items.length) {
        tbody.innerHTML = `<tr><td colspan="6">${window.UI.emptyStateHtml({ icon: 'inventory', title: 'No stock recorded yet', message: 'Receive stock to start tracking inventory for this branch.' })}</td></tr>`;
      } else {
        tbody.innerHTML = data.items.map((row) => {
          const low = row.quantity - row.reservedQuantity <= (row.lowStockThreshold ?? 5);
          return `
            <tr>
              <td class="cell-primary">${window.UI.escapeHtml(row.productId?.name || 'Unknown product')}</td>
              <td class="text-sm">${window.UI.escapeHtml(row.productId?.sku || '—')}</td>
              <td>${row.quantity}</td>
              <td class="text-muted">${row.reservedQuantity}</td>
              <td>${row.availableQuantity}</td>
              <td>${row.quantity <= 0 ? '<span class="badge badge-danger">Out of stock</span>' : low ? '<span class="badge badge-warning">Low</span>' : '<span class="badge badge-success">OK</span>'}</td>
            </tr>
          `;
        }).join('');
      }
      window.UI.renderPagination(document.getElementById('pagination'), data, (p) => { state.page = p; renderStockLevels(); });
    } catch (err) {
      body.innerHTML = window.UI.emptyStateHtml({ icon: 'alert', title: 'Could not load inventory', message: err.message });
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
    body.innerHTML = tableShell(['Date', 'Product', 'Type', 'Qty', 'Balance', 'By'], 6, 6);

    const branchId = window.AppShell.getActiveBranchId();
    try {
      const { data } = await window.Api.get('/inventory/movements', { branchId, page: state.page, limit: state.limit });
      const tbody = body.querySelector('tbody');
      if (!data.items.length) {
        tbody.innerHTML = `<tr><td colspan="6">${window.UI.emptyStateHtml({ icon: 'inventory', title: 'No movements yet' })}</td></tr>`;
      } else {
        tbody.innerHTML = data.items.map((m) => `
          <tr>
            <td class="text-sm">${window.UI.formatDateTime(m.createdAt)}</td>
            <td class="text-sm">${window.UI.escapeHtml(m.productId?.name || '—')}</td>
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
        });
        window.UI.toast.success('Stock received');
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
})();
