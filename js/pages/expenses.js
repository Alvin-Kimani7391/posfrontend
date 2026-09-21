/**
 * expenses.js
 * OWNER/ADMIN expenses are auto-approved by the backend; everyone else's
 * land as PENDING until a manager/owner approves or rejects them.
 */
(function () {
  const CATEGORIES = ['Rent', 'Electricity', 'Water', 'Transport', 'Salary', 'Packaging', 'Internet', 'Maintenance', 'Other'];
  const state = { page: 1, limit: 10, status: '' };
  let contentEl;

  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    contentEl = window.AppShell.mount({ title: 'Expenses' });
    if (!contentEl) return;
    contentEl.innerHTML = pageSkeleton();
    bindToolbar();
    await fetchAndRender();
  }

  function pageSkeleton() {
    return `
      <div class="page-header">
        <div><h1>Expenses</h1><p>Track and approve business spending.</p></div>
        <button class="btn btn-primary" id="add-expense-btn" data-requires-permission="expenses.create">${window.Icons.get('plus')} Record expense</button>
      </div>
      <div class="card">
        <div class="toolbar">
          <select class="select" id="status-filter" style="max-width: 180px">
            <option value="">All statuses</option>
            <option value="PENDING">Pending</option>
            <option value="APPROVED">Approved</option>
            <option value="REJECTED">Rejected</option>
          </select>
        </div>
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>Date</th><th>Category</th><th>Description</th><th>Amount</th><th>Status</th><th></th></tr></thead>
            <tbody id="expenses-tbody">${window.UI.skeletonRows(6, 5)}</tbody>
          </table>
        </div>
        <div class="pagination" id="pagination"></div>
      </div>
    `;
  }

  function bindToolbar() {
    document.getElementById('add-expense-btn').addEventListener('click', openCreateModal);
    document.getElementById('status-filter').addEventListener('change', (e) => {
      state.status = e.target.value; state.page = 1; fetchAndRender();
    });
  }

  const STATUS_BADGE = { PENDING: 'badge-warning', APPROVED: 'badge-success', REJECTED: 'badge-danger' };

  async function fetchAndRender() {
    const branchId = window.AppShell.getActiveBranchId();
    const tbody = document.getElementById('expenses-tbody');
    tbody.innerHTML = window.UI.skeletonRows(6, 5);
    try {
      const { data } = await window.Api.get('/expenses', { branchId, page: state.page, limit: state.limit, status: state.status || undefined });
      if (!data.items.length) {
        tbody.innerHTML = `<tr><td colspan="6">${window.UI.emptyStateHtml({ icon: 'reports', title: 'No expenses recorded' })}</td></tr>`;
      } else {
        tbody.innerHTML = data.items.map((e) => `
          <tr data-id="${e._id}">
            <td class="text-sm">${window.UI.formatDate(e.expenseDate)}</td>
            <td class="text-sm">${window.UI.escapeHtml(e.category)}</td>
            <td class="text-sm">${window.UI.escapeHtml(e.description || '—')}</td>
            <td class="font-semibold">${window.UI.formatMoney(e.amount)}</td>
            <td><span class="badge ${STATUS_BADGE[e.status]}">${e.status}</span></td>
            <td class="actions">
              ${e.status === 'PENDING' ? `
                <button class="btn btn-ghost btn-sm btn-icon" data-action="approve" data-requires-permission="expenses.approve" title="Approve">${window.Icons.get('check')}</button>
                <button class="btn btn-ghost btn-sm btn-icon" data-action="reject" data-requires-permission="expenses.approve" title="Reject">${window.Icons.get('close')}</button>
              ` : ''}
            </td>
          </tr>
        `).join('');
      }
      window.UI.renderPagination(document.getElementById('pagination'), data, (p) => { state.page = p; fetchAndRender(); });
      window.Permissions.applyPermissionGates(contentEl, window.AppShell.getUser());

      document.querySelectorAll('[data-action="approve"]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          try {
            await window.Api.post(`/expenses/${btn.closest('tr').dataset.id}/approve`);
            window.UI.toast.success('Expense approved');
            fetchAndRender();
          } catch (err) { window.UI.toast.error(err.message); }
        });
      });
      document.querySelectorAll('[data-action="reject"]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const reason = window.prompt('Reason for rejecting this expense:');
          if (!reason) return;
          try {
            await window.Api.post(`/expenses/${btn.closest('tr').dataset.id}/reject`, { rejectionReason: reason });
            window.UI.toast.success('Expense rejected');
            fetchAndRender();
          } catch (err) { window.UI.toast.error(err.message); }
        });
      });
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="6">${window.UI.emptyStateHtml({ icon: 'alert', title: 'Could not load expenses', message: err.message })}</td></tr>`;
    }
  }

  function openCreateModal() {
    const branchId = window.AppShell.getActiveBranchId();
    const modal = window.UI.openModal({
      title: 'Record expense',
      bodyHtml: `
        <form id="expense-form">
          <div class="form-row">
            <div class="field"><label>Category</label><select class="select" name="category" required>${CATEGORIES.map((c) => `<option value="${c}">${c}</option>`).join('')}</select></div>
            <div class="field"><label>Amount (KES)</label><input class="input" name="amount" type="number" step="0.01" min="0.01" required /></div>
          </div>
          <div class="field"><label>Description</label><input class="input" name="description" placeholder="What was this for?" /></div>
          <div class="form-row">
            <div class="field">
              <label>Payment method</label>
              <select class="select" name="paymentMethod">
                <option value="CASH">Cash</option><option value="MPESA">M-PESA</option><option value="CARD">Card</option><option value="BANK">Bank</option><option value="OTHER">Other</option>
              </select>
            </div>
            <div class="field"><label>Date</label><input class="input" name="expenseDate" type="date" value="${new Date().toISOString().slice(0, 10)}" /></div>
          </div>
          <div class="field"><label>Reference <span class="text-muted">(optional)</span></label><input class="input" name="reference" /></div>
        </form>
      `,
      footerHtml: `<button class="btn btn-secondary" data-action="cancel">Cancel</button><button class="btn btn-primary" data-action="save" id="expense-save-btn">Save</button>`,
    });

    modal.querySelector('[data-action="cancel"]').addEventListener('click', window.UI.closeModal);
    modal.querySelector('[data-action="save"]').addEventListener('click', async () => {
      const form = modal.querySelector('#expense-form');
      if (!form.reportValidity()) return;
      const raw = window.UI.serializeForm(form);
      const btn = document.getElementById('expense-save-btn');
      window.UI.setButtonLoading(btn, true, 'Saving…');
      try {
        await window.Api.post('/expenses', { ...raw, branchId });
        window.UI.toast.success('Expense recorded');
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
