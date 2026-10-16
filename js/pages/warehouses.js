/**
 * warehouses.js - Warehouses & stock: warehouse cards (create / edit / default / deactivate),
 * stock per warehouse with unit breakdown (bundles / cartons), stock adjustments, stock moves history, books check.
 */
(function () {
  const W = window.WS;
  const state = { tab: 'warehouses', whId: '', page: 1, limit: 15, search: '', filter: '', tPage: 1, tKind: '' };
  let contentEl, whs = [], branches = [];

  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    contentEl = window.AppShell.mount({ title: 'Warehouses & stock' });
    if (!contentEl) return;
    try { await window.AppShell.whenProfileReady?.(); } catch { /* cached */ }
    if (!W.on('multiWarehouse')) { contentEl.innerHTML = W.subnav('warehouses') + W.featureOff(); return; }
    try { branches = (await window.Api.get('/branches', { limit: 100 })).data.items || []; } catch { branches = []; }
    contentEl.innerHTML = W.subnav('warehouses') + W.header('Warehouses & stock', 'Wholesale stores, stock in bundles/cartons, and moves to the shop floor.',
      `<button class="btn btn-secondary" id="wh-move" data-requires-permission="inventory.transfer">${W.icon('arrowRight')} Move stock</button>
       <button class="btn btn-primary" id="wh-new" data-requires-permission="warehouses.manage">${W.icon('plus')} New warehouse</button>`) + `
      <div class="card"><div class="tabs" id="wh-tabs">
        <button class="tab-btn active" data-tab="warehouses">Warehouses</button><button class="tab-btn" data-tab="stock">Stock</button>
        <button class="tab-btn" data-tab="moves">Stock moves</button><button class="tab-btn" data-tab="books">Books check</button></div>
        <div id="wh-body"></div></div>`;
    contentEl.querySelector('#wh-new').addEventListener('click', () => openWarehouseModal());
    contentEl.querySelector('#wh-move').addEventListener('click', () => W.openTransferModal({ warehouseId: state.whId || undefined, onDone: () => render() }));
    contentEl.querySelectorAll('#wh-tabs .tab-btn').forEach((b) => b.addEventListener('click', () => {
      contentEl.querySelectorAll('#wh-tabs .tab-btn').forEach((x) => x.classList.toggle('active', x === b));
      state.tab = b.dataset.tab; state.page = 1; state.tPage = 1; render();
    }));
    window.Permissions.applyPermissionGates(contentEl, window.AppShell.getUser());
    window.AppShell.onBranchChange?.(() => render());
    await render();
  }

  const body = () => contentEl.querySelector('#wh-body');
  async function loadWhs() { whs = await W.warehouses(true); if (!state.whId && whs.length) state.whId = (whs.find((w) => w.isDefault) || whs[0])._id; }
  async function render() {
    try { await loadWhs(); } catch (e) { body().innerHTML = `<div class="ws-pad">${W.esc(e.message)}</div>`; return; }
    if (state.tab === 'warehouses') return renderCards();
    if (state.tab === 'stock') return renderStock();
    if (state.tab === 'moves') return renderMoves();
    return renderBooks();
  }

  /* ---------------- warehouses ---------------- */
  function renderCards() {
    if (!whs.length) { body().innerHTML = `<div class="ws-pad">${window.UI.emptyStateHtml({ icon: 'inventory', title: 'No warehouses yet', message: 'Create your first warehouse, or receive a purchase into the warehouse to auto-create "Main Warehouse".' })}</div>`; return; }
    body().innerHTML = `<div class="ws-pad"><div class="ws-grid ws-grid-wh">${whs.map((w) => `
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
      </div>`).join('')}</div></div>`;
    body().querySelectorAll('.ws-wh').forEach((card) => {
      const w = whs.find((x) => x._id === card.dataset.id);
      card.querySelector('[data-a="stock"]').addEventListener('click', () => { state.whId = w._id; switchTab('stock'); });
      card.querySelector('[data-a="adjust"]').addEventListener('click', () => openAdjustModal(w));
      card.querySelector('[data-a="edit"]').addEventListener('click', () => openWarehouseModal(w));
    });
    window.Permissions.applyPermissionGates(body(), window.AppShell.getUser());
  }
  function switchTab(t) { contentEl.querySelector(`#wh-tabs [data-tab="${t}"]`).click(); }

  function openWarehouseModal(w) {
    const edit = !!w;
    const modal = window.UI.openModal({
      title: edit ? `Edit ${w.name}` : 'New warehouse', maxWidth: '560px',
      bodyHtml: `<form id="wm-form">
        <div class="field"><label>Name</label><input class="input" name="name" required maxlength="80" value="${W.esc(w?.name || '')}" /></div>
        ${edit ? '' : `<div class="form-row"><div class="field"><label>Branch</label><select class="select" name="branchId">${branches.map((b) => `<option value="${b._id}" ${b._id === window.AppShell.getActiveBranchId() ? 'selected' : ''}>${W.esc(b.name)}</option>`).join('')}</select></div>
          <div class="field"><label>Code <span class="text-muted">(optional)</span></label><input class="input" name="code" maxlength="20" /></div></div>`}
        <div class="form-row"><div class="field"><label>Phone</label><input class="input" name="phone" maxlength="30" value="${W.esc(w?.phone || '')}" /></div>
          <div class="field"><label>Address</label><input class="input" name="address" maxlength="200" value="${W.esc(w?.address || '')}" /></div></div>
        <div class="field"><label>Notes</label><textarea class="textarea" name="notes" maxlength="500" rows="2">${W.esc(w?.notes || '')}</textarea></div>
        <div class="field"><label><input type="checkbox" name="allowSales" ${w?.allowSales === false ? '' : 'checked'} /> Can sell from this warehouse (untick for storage only)</label></div>
        ${edit && !w.isDefault && w.status !== 'inactive' ? '<div class="field"><label><input type="checkbox" name="isDefault" /> Make this the default warehouse of its branch</label></div>' : ''}
        ${edit ? `<div class="field"><label><input type="checkbox" name="inactive" ${w.status === 'inactive' ? 'checked' : ''} /> Inactive <span class="text-muted">(must be empty to deactivate)</span></label></div>` : ''}
      </form>`,
      footerHtml: '<button class="btn btn-secondary" data-action="close">Cancel</button><button class="btn btn-primary" id="wm-save">Save</button>',
    });
    W.bindClose(modal);
    modal.querySelector('#wm-save').addEventListener('click', async (ev) => {
      const f = modal.querySelector('#wm-form'); const g = (n) => f.elements[n];
      if (!g('name').value.trim()) return window.UI.toast.error('Name is required');
      const data = { name: g('name').value.trim(), phone: g('phone').value.trim() || undefined, address: g('address').value.trim() || undefined, notes: g('notes').value.trim() || undefined, allowSales: g('allowSales').checked };
      if (!edit) { data.branchId = g('branchId').value; if (g('code').value.trim()) data.code = g('code').value.trim(); }
      else { if (g('isDefault')?.checked) data.isDefault = true; data.status = g('inactive').checked ? 'inactive' : 'active'; }
      window.UI.setButtonLoading(ev.currentTarget, true);
      try {
        edit ? await window.Api.patch(`/warehouse/${w._id}`, data) : await window.Api.post('/warehouse', data);
        W.bust(); window.UI.closeModal(); window.UI.toast.success('Warehouse saved'); render();
      } catch (err) { window.UI.setButtonLoading(ev.currentTarget, false); window.UI.toast.error(err.message); }
    });
  }

  /* ---------------- stock ---------------- */
  function whToolbar(extra = '') {
    return `<div class="ws-toolbar"><select class="select" id="f-wh">${W.whOptions(whs, state.whId)}</select>${extra}</div>`;
  }
  async function renderStock() {
    body().innerHTML = whToolbar(`
      <div class="grow input-group"><span class="input-group-icon">${W.icon('search')}</span><input class="input" id="f-search" placeholder="Search product or SKU" value="${W.esc(state.search)}" /></div>
      <select class="select" id="f-filter"><option value="">All stock</option><option value="low" ${state.filter === 'low' ? 'selected' : ''}>Low stock</option><option value="out" ${state.filter === 'out' ? 'selected' : ''}>Out of stock</option></select>
      <button class="btn btn-secondary btn-sm" id="f-adj" data-requires-permission="inventory.adjust">${W.icon('plus')} Adjust stock</button>`) +
      W.tableShell(['Product', 'SKU', 'In stock', 'In bigger units', 'Reserved', 'Status'], 6) + '<div class="pagination" id="pg"></div>';
    body().querySelector('#f-wh').addEventListener('change', (e) => { state.whId = e.target.value; state.page = 1; renderStock(); });
    body().querySelector('#f-search').addEventListener('input', window.UI.debounce((e) => { state.search = e.target.value.trim(); state.page = 1; loadStock(); }));
    body().querySelector('#f-filter').addEventListener('change', (e) => { state.filter = e.target.value; state.page = 1; loadStock(); });
    body().querySelector('#f-adj').addEventListener('click', () => openAdjustModal(whs.find((w) => w._id === state.whId)));
    window.Permissions.applyPermissionGates(body(), window.AppShell.getUser());
    loadStock();
  }
  async function loadStock() {
    const tb = body().querySelector('tbody');
    try {
      const { data } = await window.Api.get('/warehouse/stock', { warehouseId: state.whId, branchId: W.branchOf(whs.find((w) => w._id === state.whId)) || undefined, page: state.page, limit: state.limit, search: state.search,
        lowStockOnly: state.filter === 'low' ? true : undefined, outOfStockOnly: state.filter === 'out' ? true : undefined });
      tb.innerHTML = data.items.length ? data.items.map((r) => {
        const p = r.productId || {}; const avail = r.quantity - (r.reservedQuantity || 0); const low = avail <= (r.lowStockThreshold ?? 5);
        const big = (r.inUnits || []).filter((u) => u.whole > 0).map((u) => `${W.num(u.whole)} ${W.esc(u.unit)}${u.remainderBase ? ` + ${W.num(u.remainderBase)}` : ''}`).join(' &middot; ') || '<span class="text-muted">—</span>';
        return `<tr><td class="cell-primary">${W.esc(p.name || 'Product')}${r.variantId ? ' <span class="badge badge-neutral">variant</span>' : ''}</td><td class="text-sm">${W.esc(p.sku || '—')}</td>
          <td><strong>${W.num(r.quantity)}</strong> <span class="text-muted text-xs">${W.esc(p.unit || '')}</span></td><td class="text-sm">${big}</td><td>${W.num(r.reservedQuantity)}</td>
          <td>${r.quantity <= 0 ? '<span class="badge badge-danger">Out</span>' : low ? '<span class="badge badge-warning">Low</span>' : '<span class="badge badge-success">OK</span>'}</td></tr>`;
      }).join('') : W.emptyRow(6, 'No stock in this warehouse');
      W.pager(body().querySelector('#pg'), data, (p) => { state.page = p; loadStock(); });
    } catch (e) { tb.innerHTML = W.errRow(6, e); }
  }

  function openAdjustModal(w) {
    if (!w) return window.UI.toast.error('Choose a warehouse');
    let picked = null;
    const modal = window.UI.openModal({
      title: `Adjust stock · ${w.name}`, maxWidth: '520px',
      bodyHtml: `<div class="field"><label>Product</label><button type="button" class="btn btn-secondary btn-block" id="ad-pick">Choose product…</button></div>
        <div class="form-row"><div class="field"><label>Type</label><select class="select" id="ad-type">
          <option value="OPENING_STOCK">Opening stock (add)</option><option value="ADJUSTMENT_IN">Correction: add</option><option value="ADJUSTMENT_OUT">Correction: remove</option>
          <option value="DAMAGE">Damaged (remove)</option><option value="EXPIRED">Expired (remove)</option><option value="LOST">Lost (remove)</option></select></div>
          <div class="field"><label>Quantity</label><input class="input" id="ad-qty" type="number" min="0" step="any" /></div></div>
        <div class="field"><label>Unit</label><select class="select" id="ad-unit"><option value="">—</option></select></div>
        <div class="field"><label>Reason</label><input class="input" id="ad-reason" maxlength="300" placeholder="e.g. Opening count, broken carton" /></div>`,
      footerHtml: '<button class="btn btn-secondary" data-action="close">Cancel</button><button class="btn btn-primary" id="ad-save">Save adjustment</button>',
    });
    W.bindClose(modal);
    modal.querySelector('#ad-pick').addEventListener('click', () => window.ProductPicker.open({ onSelect: ({ product, variant }) => {
      picked = { product, variant };
      modal.querySelector('#ad-pick').textContent = product.name + (variant ? ` (${Object.values(variant.attributes || {}).join(', ')})` : '');
      modal.querySelector('#ad-unit').innerHTML = `<option value="">${W.esc(product.unit || 'piece')} (base)</option>` + (product.units || []).filter((u) => u.status !== 'inactive').map((u) => `<option value="${u._id}">${W.esc(u.name)} (${u.factor} ${W.esc(product.unit || '')})</option>`).join('');
    } }));
    modal.querySelector('#ad-save').addEventListener('click', async (ev) => {
      const q = Number(modal.querySelector('#ad-qty').value); const type = modal.querySelector('#ad-type').value; const reason = modal.querySelector('#ad-reason').value.trim();
      if (!picked) return window.UI.toast.error('Choose a product');
      if (!(q > 0)) return window.UI.toast.error('Enter a quantity above zero');
      if (!reason) return window.UI.toast.error('Give a reason');
      const sign = ['OPENING_STOCK', 'ADJUSTMENT_IN'].includes(type) ? 1 : -1;
      window.UI.setButtonLoading(ev.currentTarget, true);
      try {
        await window.Api.post(`/warehouse/${w._id}/adjust`, { productId: picked.product._id, variantId: picked.variant?._id, quantity: sign * q, unitId: modal.querySelector('#ad-unit').value || undefined, type, reason });
        window.UI.closeModal(); window.UI.toast.success('Stock adjusted'); W.bust(); render();
      } catch (err) { window.UI.setButtonLoading(ev.currentTarget, false); window.UI.toast.error(err.message); }
    });
  }

  /* ---------------- moves ---------------- */
  const kindLabel = { TO_RETAIL: 'Warehouse → Retail', TO_WAREHOUSE: 'Retail → Warehouse', WAREHOUSE_TO_WAREHOUSE: 'Warehouse → Warehouse' };
  async function renderMoves() {
    body().innerHTML = `<div class="ws-toolbar"><select class="select" id="m-wh">${W.whOptions(whs, state.whId, { blank: 'All warehouses' })}</select>
      <select class="select" id="m-kind"><option value="">All moves</option>${Object.entries(kindLabel).map(([k, v]) => `<option value="${k}" ${state.tKind === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div>` +
      W.tableShell(['Move #', 'When', 'Direction', 'Items', 'By', ''], 6) + '<div class="pagination" id="pg"></div>';
    body().querySelector('#m-wh').value = '';
    body().querySelector('#m-wh').addEventListener('change', (e) => { loadMoves(e.target.value); });
    body().querySelector('#m-kind').addEventListener('change', (e) => { state.tKind = e.target.value; state.tPage = 1; loadMoves(body().querySelector('#m-wh').value); });
    loadMoves('');
  }
  async function loadMoves(whId) {
    const tb = body().querySelector('tbody');
    try {
      const { data } = await window.Api.get('/warehouse/transfers', { page: state.tPage, limit: 15, kind: state.tKind || undefined, warehouseId: whId || undefined });
      tb.innerHTML = data.items.length ? data.items.map((t) => `<tr data-id="${t._id}"><td class="cell-primary">${W.esc(t.transferNumber)}</td><td class="text-sm">${window.UI.formatDateTime(t.createdAt)}</td>
        <td class="text-sm">${W.esc(kindLabel[t.kind] || `${t.fromLocation} → ${t.toLocation}`)}</td><td>${(t.items || []).length}</td><td class="text-sm">${W.esc(t.performedBy?.name || '—')}</td>
        <td class="actions"><button class="btn btn-ghost btn-sm" data-a="view">View</button></td></tr>`).join('') : W.emptyRow(6, 'No stock moves yet');
      tb.querySelectorAll('[data-a="view"]').forEach((b) => b.addEventListener('click', () => openMove(b.closest('tr').dataset.id)));
      W.pager(body().querySelector('#pg'), data, (p) => { state.tPage = p; loadMoves(whId); });
    } catch (e) { tb.innerHTML = W.errRow(6, e); }
  }
  async function openMove(id) {
    let t; try { ({ data: { transfer: t } } = await window.Api.get(`/warehouse/transfers/${id}`)); } catch (e) { return window.UI.toast.error(e.message); }
    const m = window.UI.openModal({ title: `Move ${t.transferNumber}`, maxWidth: '680px',
      bodyHtml: `<div class="text-sm text-secondary" style="margin-bottom:var(--space-3)">${W.esc(kindLabel[t.kind] || '')} &middot; ${W.esc(t.branchId?.name || '')} &middot; ${window.UI.formatDateTime(t.createdAt)} &middot; by ${W.esc(t.performedBy?.name || '—')}</div>
        <div class="table-wrap"><table class="table"><thead><tr><th>Item</th><th>Qty</th><th>Unit</th><th>Batches / serials</th></tr></thead><tbody>${(t.items || []).map((i) => `<tr><td class="text-sm">${W.esc(i.nameSnapshot || i.productId?.name || '—')}</td><td>${W.num(i.quantity)}</td><td class="text-sm">${W.esc(i.unitName || 'base')}</td>
          <td class="text-xs text-muted">${(i.batchAllocations || []).map((b) => `${W.esc(b.batchNumber)} × ${b.quantity}`).join('<br>') || ''} ${(i.serialNumbers || []).map(W.esc).join(', ')}</td></tr>`).join('')}</tbody></table></div>
        ${t.notes ? `<p class="text-sm" style="margin-top:var(--space-3)">Notes: ${W.esc(t.notes)}</p>` : ''}`,
      footerHtml: '<button class="btn btn-secondary" data-action="close">Close</button>' });
    W.bindClose(m);
  }

  /* ---------------- books check ---------------- */
  async function renderBooks() {
    const branchId = window.AppShell.getActiveBranchId();
    body().innerHTML = `<div class="ws-pad" id="bk">${window.UI.skeletonRows(4, 4) ? '<div class="ws-muted-row">Loading…</div>' : ''}</div>`;
    try {
      const [ov, rc] = await Promise.all([window.Api.get('/warehouse/overview', { branchId, limit: 100 }), window.Api.get('/warehouse/reconcile', { branchId })]);
      const t = ov.data.totals || {}; const names = {}; (ov.data.items || []).forEach((r) => { names[r.productId] = r.name; });
      const d = rc.data.differences || [];
      body().querySelector('#bk').innerHTML = `
        <dl class="mk-kv"><div><dt>Retail units</dt><dd>${W.num(t.retailUnits)}</dd></div><div><dt>Warehouse units</dt><dd>${W.num(t.warehouseUnits)}</dd></div>
          <div><dt>Retail value (cost)</dt><dd>${W.cents(t.retailCostValue)}</dd></div><div><dt>Warehouse value (cost)</dt><dd>${W.cents(t.warehouseCostValue)}</dd></div></dl>
        <div class="${d.length ? 'ws-warn' : 'badge badge-success'}" style="${d.length ? '' : 'padding:8px 12px'}">${d.length ? `${d.length} difference(s) between the stock ledger and the stock on hand.` : 'Books are balanced: ledger matches stock on hand.'}</div>
        ${d.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Product</th><th>Where</th><th>Ledger</th><th>Stock</th><th>Difference</th></tr></thead><tbody>${d.map((x) => `<tr><td>${W.esc(names[x.productId] || x.productId)}</td><td>${W.esc(x.location)}</td><td>${W.num(x.ledger)}</td><td>${W.num(x.stock)}</td><td>${W.num(x.difference)}</td></tr>`).join('')}</tbody></table></div>` : ''}
        <div class="ws-section-title" style="margin-top:var(--space-5)"><h3>Retail + warehouse by product</h3></div>
        <div class="table-wrap"><table class="table"><thead><tr><th>Product</th><th>SKU</th><th>Retail</th><th>Warehouse</th><th>Total</th></tr></thead><tbody>${(ov.data.items || []).map((r) => `<tr><td class="cell-primary">${W.esc(r.name || 'Unknown')}</td><td class="text-sm">${W.esc(r.sku || '—')}</td><td>${W.num(r.retailQuantity)}</td><td>${W.num(r.warehouseQuantity)}</td><td><strong>${W.num(r.totalQuantity)}</strong></td></tr>`).join('') || W.emptyRow(5, 'No stock')}</tbody></table></div>`;
    } catch (e) { body().querySelector('#bk').innerHTML = `<div class="ws-pad">${W.esc(e.message)}</div>`; }
  }
})();
