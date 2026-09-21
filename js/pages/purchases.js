/**
 * purchases.js
 * Create a purchase order (items priced with the actual cost paid to the
 * supplier - that's legitimate direct input, unlike a sale price), then
 * separately mark it received (which is what actually moves inventory)
 * and record payments against it.
 */
(function () {
  const state = { page: 1, limit: 10 };
  let contentEl;
  let suppliersCache = null;

  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    contentEl = window.AppShell.mount({ title: 'Purchases' });
    if (!contentEl) return;
    contentEl.innerHTML = pageSkeleton();
    document.getElementById('add-purchase-btn').addEventListener('click', openCreateModal);
    await fetchAndRender();
  }

  function pageSkeleton() {
    return `
      <div class="page-header">
        <div><h1>Purchases</h1><p>Purchase orders from suppliers and stock receiving.</p></div>
        <button class="btn btn-primary" id="add-purchase-btn" data-requires-permission="purchases.create">${window.Icons.get('plus')} New purchase</button>
      </div>
      <div class="card">
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>PO #</th><th>Supplier</th><th>Date</th><th>Total</th><th>Payment</th><th>Received</th><th></th></tr></thead>
            <tbody id="purchases-tbody">${window.UI.skeletonRows(7, 5)}</tbody>
          </table>
        </div>
        <div class="pagination" id="pagination"></div>
      </div>
    `;
  }

  async function getSuppliers() {
    if (suppliersCache) return suppliersCache;
    const { data } = await window.Api.get('/suppliers', { page: 1, limit: 100 });
    suppliersCache = data.items;
    return suppliersCache;
  }

  const PAY_BADGE = { UNPAID: 'badge-danger', PARTIAL: 'badge-warning', PAID: 'badge-success' };
  const RECV_BADGE = { PENDING: 'badge-neutral', PARTIAL: 'badge-warning', RECEIVED: 'badge-success' };

  async function fetchAndRender() {
    const tbody = document.getElementById('purchases-tbody');
    tbody.innerHTML = window.UI.skeletonRows(7, 5);
    try {
      const { data } = await window.Api.get('/purchases', { page: state.page, limit: state.limit });
      if (!data.items.length) {
        tbody.innerHTML = `<tr><td colspan="7">${window.UI.emptyStateHtml({ icon: 'box', title: 'No purchases yet' })}</td></tr>`;
      } else {
        tbody.innerHTML = data.items.map((p) => `
          <tr data-id="${p._id}">
            <td class="cell-primary">${p.purchaseNumber}</td>
            <td class="text-sm">${window.UI.escapeHtml(p.supplierId?.name || '')}</td>
            <td class="text-sm">${window.UI.formatDate(p.purchaseDate)}</td>
            <td class="font-semibold">${window.UI.formatMoney(p.total)}</td>
            <td><span class="badge ${PAY_BADGE[p.paymentStatus]}">${p.paymentStatus}</span></td>
            <td><span class="badge ${RECV_BADGE[p.receivedStatus]}">${p.receivedStatus}</span></td>
            <td class="actions"><button class="btn btn-secondary btn-sm" data-action="view">View</button></td>
          </tr>
        `).join('');
      }
      window.UI.renderPagination(document.getElementById('pagination'), data, (p) => { state.page = p; fetchAndRender(); });
      window.Permissions.applyPermissionGates(contentEl, window.AppShell.getUser());
      document.querySelectorAll('[data-action="view"]').forEach((btn) => {
        btn.addEventListener('click', () => openDetailModal(btn.closest('tr').dataset.id));
      });
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="7">${window.UI.emptyStateHtml({ icon: 'alert', title: 'Could not load purchases', message: err.message })}</td></tr>`;
    }
  }

  async function openDetailModal(id) {
    let purchase;
    try {
      ({ data: { purchase } } = await window.Api.get(`/purchases/${id}`));
    } catch (err) {
      return window.UI.toast.error(err.message);
    }

    const canReceive = purchase.receivedStatus !== 'RECEIVED' && window.Permissions.can(window.AppShell.getUser(), 'purchases.receive');
    const canPay = purchase.balance > 0 && window.Permissions.can(window.AppShell.getUser(), 'purchases.pay');

    const modal = window.UI.openModal({
      title: `Purchase ${purchase.purchaseNumber}`,
      maxWidth: '560px',
      bodyHtml: `
        <div class="text-sm text-secondary" style="margin-bottom: var(--space-3)">Supplier: ${window.UI.escapeHtml(purchase.supplierId?.name || '')} &middot; ${window.UI.formatDate(purchase.purchaseDate)}</div>
        <div class="table-wrap" style="margin-bottom: var(--space-4)">
          <table class="table">
            <thead><tr><th>Item</th><th>Qty</th><th>Unit cost</th><th>Total</th></tr></thead>
            <tbody>${purchase.items.map((i) => `<tr><td class="text-sm">${window.UI.escapeHtml(i.nameSnapshot)}</td><td>${i.quantity}</td><td>${window.UI.formatMoney(i.unitCost)}</td><td>${window.UI.formatMoney(i.total)}</td></tr>`).join('')}</tbody>
          </table>
        </div>
        <div class="pos-totals-row"><span>Subtotal</span><span>${window.UI.formatMoney(purchase.subtotal)}</span></div>
        <div class="pos-totals-row"><span>Tax</span><span>${window.UI.formatMoney(purchase.tax)}</span></div>
        <div class="pos-totals-row grand"><span>Total</span><span>${window.UI.formatMoney(purchase.total)}</span></div>
        <div class="pos-totals-row"><span>Paid</span><span>${window.UI.formatMoney(purchase.amountPaid)}</span></div>
        <div class="pos-totals-row" style="color:${purchase.balance > 0 ? 'var(--color-warning)' : ''}"><span>Balance</span><span>${window.UI.formatMoney(purchase.balance)}</span></div>
      `,
      footerHtml: `
        <button class="btn btn-secondary" data-action="close">Close</button>
        ${canPay ? `<button class="btn btn-secondary" data-action="pay">Record payment</button>` : ''}
        ${canReceive ? `<button class="btn btn-primary" data-action="receive">Mark received</button>` : ''}
      `,
    });

    modal.querySelector('[data-action="close"]').addEventListener('click', window.UI.closeModal);
    modal.querySelector('[data-action="receive"]')?.addEventListener('click', async () => {
      try {
        await window.Api.post(`/purchases/${purchase._id}/receive`);
        window.UI.toast.success('Purchase received - inventory updated');
        window.UI.closeModal();
        fetchAndRender();
      } catch (err) {
        window.UI.toast.error(err.message);
      }
    });
    modal.querySelector('[data-action="pay"]')?.addEventListener('click', () => {
      window.UI.closeModal();
      openPaymentModal(purchase);
    });
  }

  function openPaymentModal(purchase) {
    const modal = window.UI.openModal({
      title: 'Record payment',
      bodyHtml: `
        <form id="pay-form">
          <p class="text-sm text-secondary" style="margin-bottom: var(--space-3)">Balance owed: ${window.UI.formatMoney(purchase.balance)}</p>
          <div class="field"><label>Amount (KES)</label><input class="input" name="amount" type="number" step="0.01" min="0.01" max="${purchase.balance}" required value="${purchase.balance}" /></div>
        </form>
      `,
      footerHtml: `<button class="btn btn-secondary" data-action="cancel">Cancel</button><button class="btn btn-primary" data-action="save">Record</button>`,
    });
    modal.querySelector('[data-action="cancel"]').addEventListener('click', window.UI.closeModal);
    modal.querySelector('[data-action="save"]').addEventListener('click', async () => {
      const form = modal.querySelector('#pay-form');
      if (!form.reportValidity()) return;
      const raw = window.UI.serializeForm(form);
      try {
        await window.Api.post(`/purchases/${purchase._id}/payments`, { amount: raw.amount });
        window.UI.toast.success('Payment recorded');
        window.UI.closeModal();
        fetchAndRender();
      } catch (err) {
        window.UI.toast.error(err.message);
      }
    });
  }

  async function openCreateModal() {
    const branchId = window.AppShell.getActiveBranchId();
    const suppliers = await getSuppliers();
    if (!suppliers.length) {
      window.UI.toast.error('Add a supplier first');
      return;
    }

    const items = []; // { product, variant, quantity, unitCost, taxRate, discount }

    const modal = window.UI.openModal({
      title: 'New purchase',
      maxWidth: '640px',
      bodyHtml: `
        <form id="purchase-form">
          <div class="form-row">
            <div class="field">
              <label>Supplier</label>
              <select class="select" name="supplierId" required>${suppliers.map((s) => `<option value="${s._id}">${window.UI.escapeHtml(s.name)}</option>`).join('')}</select>
            </div>
            <div class="field"><label>Supplier invoice # <span class="text-muted">(optional)</span></label><input class="input" name="invoiceNumber" /></div>
          </div>
          <div class="field">
            <label>Items</label>
            <div id="purchase-items"></div>
            <button type="button" class="btn btn-secondary btn-sm" id="add-item-btn">${window.Icons.get('plus')} Add item</button>
          </div>
          <div class="field"><label>Notes <span class="text-muted">(optional)</span></label><textarea class="textarea" name="notes"></textarea></div>
        </form>
      `,
      footerHtml: `<button class="btn btn-secondary" data-action="cancel">Cancel</button><button class="btn btn-primary" data-action="save" id="purchase-save-btn">Create purchase</button>`,
    });

    function renderItems() {
      const el = modal.querySelector('#purchase-items');
      if (!items.length) { el.innerHTML = '<p class="text-sm text-muted">No items added yet.</p>'; return; }
      el.innerHTML = items.map((it, i) => `
        <div style="border:1px solid var(--color-border); border-radius:var(--radius-md); padding: var(--space-3); margin-bottom: var(--space-2)">
          <div class="flex items-center justify-between" style="margin-bottom: var(--space-2)">
            <span class="text-sm font-semibold">${window.UI.escapeHtml(it.product.name)}</span>
            <button type="button" class="btn btn-ghost btn-sm btn-icon" data-remove="${i}">${window.Icons.get('trash')}</button>
          </div>
          <div class="form-row">
            <div class="field" style="margin-bottom:0"><label class="text-xs">Quantity</label><input class="input" type="number" min="0.01" step="0.01" value="${it.quantity}" data-field="quantity" data-idx="${i}" /></div>
            <div class="field" style="margin-bottom:0"><label class="text-xs">Unit cost (KES)</label><input class="input" type="number" min="0" step="0.01" value="${it.unitCost}" data-field="unitCost" data-idx="${i}" /></div>
          </div>
        </div>
      `).join('');
      el.querySelectorAll('input[data-field]').forEach((input) => {
        input.addEventListener('change', () => { items[Number(input.dataset.idx)][input.dataset.field] = Number(input.value); });
      });
      el.querySelectorAll('[data-remove]').forEach((btn) => {
        btn.addEventListener('click', () => { items.splice(Number(btn.dataset.remove), 1); renderItems(); });
      });
    }
    renderItems();

    modal.querySelector('#add-item-btn').addEventListener('click', () => {
      window.ProductPicker.open({
        onSelect: ({ product, variant }) => {
          items.push({ product, variant, quantity: 1, unitCost: variant ? variant.costPrice : product.costPrice });
          renderItems();
        },
      });
    });

    modal.querySelector('[data-action="cancel"]').addEventListener('click', window.UI.closeModal);
    modal.querySelector('[data-action="save"]').addEventListener('click', async () => {
      if (!items.length) return window.UI.toast.error('Add at least one item');
      const form = modal.querySelector('#purchase-form');
      if (!form.reportValidity()) return;
      const raw = window.UI.serializeForm(form);

      const btn = document.getElementById('purchase-save-btn');
      window.UI.setButtonLoading(btn, true, 'Creating…');
      try {
        await window.Api.post('/purchases', {
          branchId, supplierId: raw.supplierId, invoiceNumber: raw.invoiceNumber, notes: raw.notes,
          items: items.map((it) => ({ productId: it.product._id, variantId: it.variant?._id, quantity: it.quantity, unitCost: it.unitCost })),
        });
        window.UI.toast.success('Purchase created');
        window.UI.closeModal();
        fetchAndRender();
      } catch (err) {
        window.UI.toast.error(err.message);
      } finally {
        window.UI.setButtonLoading(btn, false);
      }
    });
  }
})();
