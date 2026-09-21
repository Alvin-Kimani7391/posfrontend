/**
 * suppliers.js
 * Follows the same list -> fetchAndRender -> modal pattern as branches.js.
 * currentBalance is read-only here (what we owe them) - it's only ever
 * changed by receiving/paying a purchase, never edited directly.
 */
(function () {
  const state = { page: 1, limit: 10, search: '' };
  let contentEl;

  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    contentEl = window.AppShell.mount({ title: 'Suppliers' });
    if (!contentEl) return;
    contentEl.innerHTML = pageSkeleton();
    bindToolbar();
    await fetchAndRender();
  }

  function pageSkeleton() {
    return `
      <div class="page-header">
        <div><h1>Suppliers</h1><p>Manage who you buy stock from and what you owe them.</p></div>
        <button class="btn btn-primary" id="add-supplier-btn" data-requires-permission="suppliers.create">${window.Icons.get('plus')} Add supplier</button>
      </div>
      <div class="card">
        <div class="toolbar">
          <div class="toolbar-search input-group">
            <span class="input-group-icon">${window.Icons.get('search')}</span>
            <input class="input" id="search-input" type="text" placeholder="Search by name or phone" />
          </div>
        </div>
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>Supplier</th><th>Contact</th><th>Payment terms</th><th>Payable</th><th>Status</th><th></th></tr></thead>
            <tbody id="suppliers-tbody">${window.UI.skeletonRows(6, 4)}</tbody>
          </table>
        </div>
        <div class="pagination" id="pagination"></div>
      </div>
    `;
  }

  function bindToolbar() {
    document.getElementById('add-supplier-btn').addEventListener('click', () => openSupplierModal());
    document.getElementById('search-input').addEventListener('input', window.UI.debounce((e) => {
      state.search = e.target.value.trim(); state.page = 1; fetchAndRender();
    }));
  }

  async function fetchAndRender() {
    const tbody = document.getElementById('suppliers-tbody');
    tbody.innerHTML = window.UI.skeletonRows(6, 4);
    try {
      const { data } = await window.Api.get('/suppliers', { page: state.page, limit: state.limit, search: state.search });
      renderRows(data.items);
      window.UI.renderPagination(document.getElementById('pagination'), data, (p) => { state.page = p; fetchAndRender(); });
      window.Permissions.applyPermissionGates(contentEl, window.AppShell.getUser());
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="6">${window.UI.emptyStateHtml({ icon: 'alert', title: 'Could not load suppliers', message: err.message })}</td></tr>`;
    }
  }

  function renderRows(items) {
    const tbody = document.getElementById('suppliers-tbody');
    if (!items.length) {
      tbody.innerHTML = `<tr><td colspan="6">${window.UI.emptyStateHtml({ icon: 'branches', title: state.search ? 'No suppliers match your search' : 'No suppliers yet' })}</td></tr>`;
      return;
    }
    tbody.innerHTML = items.map((s) => `
      <tr data-id="${s._id}">
        <td class="cell-primary">${window.UI.escapeHtml(s.name)}</td>
        <td class="text-sm">${window.UI.escapeHtml(s.phone || '—')}${s.contactPerson ? ` <span class="text-muted">(${window.UI.escapeHtml(s.contactPerson)})</span>` : ''}</td>
        <td class="text-sm">${window.UI.escapeHtml(s.paymentTerms || '—')}</td>
        <td class="${s.currentBalance > 0 ? 'font-semibold' : ''}" style="color: ${s.currentBalance > 0 ? 'var(--color-warning)' : ''}">${window.UI.formatMoney(s.currentBalance)}</td>
        <td><span class="badge ${s.status === 'active' ? 'badge-success' : 'badge-neutral'}">${s.status}</span></td>
        <td class="actions"><button class="btn btn-ghost btn-sm btn-icon" data-action="edit" data-requires-permission="suppliers.update" title="Edit">${window.Icons.get('edit')}</button></td>
      </tr>
    `).join('');

    tbody.querySelectorAll('[data-action="edit"]').forEach((btn) => {
      btn.addEventListener('click', () => openSupplierModal(items.find((s) => s._id === btn.closest('tr').dataset.id)));
    });
  }

  function openSupplierModal(supplier) {
    const isEdit = !!supplier;
    const modal = window.UI.openModal({
      title: isEdit ? 'Edit supplier' : 'Add supplier',
      bodyHtml: `
        <form id="supplier-form">
          <div class="field"><label>Name</label><input class="input" name="name" required value="${isEdit ? window.UI.escapeHtml(supplier.name) : ''}" /></div>
          <div class="form-row">
            <div class="field"><label>Phone</label><input class="input" name="phone" value="${isEdit ? window.UI.escapeHtml(supplier.phone || '') : ''}" /></div>
            <div class="field"><label>Email</label><input class="input" name="email" type="email" value="${isEdit ? window.UI.escapeHtml(supplier.email || '') : ''}" /></div>
          </div>
          <div class="field"><label>Contact person</label><input class="input" name="contactPerson" value="${isEdit ? window.UI.escapeHtml(supplier.contactPerson || '') : ''}" /></div>
          <div class="field"><label>Payment terms</label><input class="input" name="paymentTerms" placeholder="e.g. Net 30" value="${isEdit ? window.UI.escapeHtml(supplier.paymentTerms || '') : ''}" /></div>
          <div class="field"><label>Address</label><input class="input" name="address" value="${isEdit ? window.UI.escapeHtml(supplier.address || '') : ''}" /></div>
          <div class="field"><label>Tax PIN</label><input class="input" name="taxPin" value="${isEdit ? window.UI.escapeHtml(supplier.taxPin || '') : ''}" /></div>
        </form>
      `,
      footerHtml: `<button class="btn btn-secondary" data-action="cancel">Cancel</button><button class="btn btn-primary" data-action="save" id="supplier-save-btn">${isEdit ? 'Save changes' : 'Add supplier'}</button>`,
    });

    modal.querySelector('[data-action="cancel"]').addEventListener('click', window.UI.closeModal);
    modal.querySelector('[data-action="save"]').addEventListener('click', async () => {
      const form = modal.querySelector('#supplier-form');
      if (!form.reportValidity()) return;
      const payload = window.UI.serializeForm(form);
      const btn = document.getElementById('supplier-save-btn');
      window.UI.setButtonLoading(btn, true, 'Saving…');
      try {
        if (isEdit) await window.Api.put(`/suppliers/${supplier._id}`, payload);
        else await window.Api.post('/suppliers', payload);
        window.UI.toast.success(isEdit ? 'Supplier updated' : 'Supplier added');
        window.UI.closeModal();
        fetchAndRender();
      } catch (err) {
        if (err.code === 'VALIDATION_ERROR' && err.errors?.length) window.UI.applyFormErrors(form, err.errors);
        else window.UI.toast.error(err.message);
      } finally {
        window.UI.setButtonLoading(btn, false);
      }
    });
  }
})();
