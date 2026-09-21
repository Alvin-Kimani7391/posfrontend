/**
 * refunds.js
 * This page reviews and actions refund requests. Creating a NEW refund
 * happens from a sale's detail view in Sales History (sales.js), since a
 * refund is meaningless without the sale context it's against - this page
 * is purely the queue a manager/owner works through.
 */
(function () {
  const state = { page: 1, limit: 10, status: 'REQUESTED' };
  let contentEl;

  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    contentEl = window.AppShell.mount({ title: 'Refunds' });
    if (!contentEl) return;
    contentEl.innerHTML = pageSkeleton();
    document.getElementById('status-filter').addEventListener('change', (e) => {
      state.status = e.target.value; state.page = 1; fetchAndRender();
    });
    await fetchAndRender();
  }

  function pageSkeleton() {
    return `
      <div class="page-header">
        <div><h1>Refunds</h1><p>Review and action refund requests. Start a new refund from a sale in Sales History.</p></div>
      </div>
      <div class="card">
        <div class="toolbar">
          <select class="select" id="status-filter" style="max-width: 180px">
            <option value="">All statuses</option>
            <option value="REQUESTED" selected>Pending approval</option>
            <option value="APPROVED">Approved</option>
            <option value="COMPLETED">Completed</option>
            <option value="REJECTED">Rejected</option>
          </select>
        </div>
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>Refund #</th><th>Date</th><th>Requested by</th><th>Reason</th><th>Amount</th><th>Status</th><th></th></tr></thead>
            <tbody id="refunds-tbody">${window.UI.skeletonRows(7, 5)}</tbody>
          </table>
        </div>
        <div class="pagination" id="pagination"></div>
      </div>
    `;
  }

  const STATUS_BADGE = { REQUESTED: 'badge-warning', APPROVED: 'badge-info', COMPLETED: 'badge-success', REJECTED: 'badge-danger' };

  async function fetchAndRender() {
    const branchId = window.AppShell.getActiveBranchId();
    const tbody = document.getElementById('refunds-tbody');
    tbody.innerHTML = window.UI.skeletonRows(7, 5);

    try {
      const { data } = await window.Api.get('/refunds', { branchId, page: state.page, limit: state.limit, status: state.status || undefined });
      if (!data.items.length) {
        tbody.innerHTML = `<tr><td colspan="7">${window.UI.emptyStateHtml({ icon: 'sales', title: 'No refunds found' })}</td></tr>`;
      } else {
        tbody.innerHTML = data.items.map((r) => `
          <tr data-id="${r._id}">
            <td class="cell-primary">${r.refundNumber}</td>
            <td class="text-sm">${window.UI.formatDateTime(r.createdAt)}</td>
            <td class="text-sm">${window.UI.escapeHtml(r.requestedBy?.name || '')}</td>
            <td class="text-sm">${window.UI.escapeHtml(r.reason)}</td>
            <td class="font-semibold">${window.UI.formatMoney(r.amount)}</td>
            <td><span class="badge ${STATUS_BADGE[r.status]}">${r.status}</span></td>
            <td class="actions">
              ${r.status === 'REQUESTED' ? `
                <button class="btn btn-secondary btn-sm" data-action="approve" data-requires-permission="refunds.approve">Approve</button>
                <button class="btn btn-ghost btn-sm btn-icon" data-action="reject" data-requires-permission="refunds.approve" title="Reject">${window.Icons.get('close')}</button>
              ` : ''}
            </td>
          </tr>
        `).join('');
      }
      window.UI.renderPagination(document.getElementById('pagination'), data, (p) => { state.page = p; fetchAndRender(); });
      window.Permissions.applyPermissionGates(contentEl, window.AppShell.getUser());

      document.querySelectorAll('[data-action="approve"]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const ok = await window.UI.confirmDialog({ title: 'Approve refund?', message: 'This will restore inventory and reverse the payment immediately.', confirmText: 'Approve' });
          if (!ok) return;
          try {
            await window.Api.post(`/refunds/${btn.closest('tr').dataset.id}/approve`);
            window.UI.toast.success('Refund approved and completed');
            fetchAndRender();
          } catch (err) { window.UI.toast.error(err.message); }
        });
      });
      document.querySelectorAll('[data-action="reject"]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const reason = window.prompt('Reason for rejecting this refund:');
          if (!reason) return;
          try {
            await window.Api.post(`/refunds/${btn.closest('tr').dataset.id}/reject`, { rejectionReason: reason });
            window.UI.toast.success('Refund rejected');
            fetchAndRender();
          } catch (err) { window.UI.toast.error(err.message); }
        });
      });
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="7">${window.UI.emptyStateHtml({ icon: 'alert', title: 'Could not load refunds', message: err.message })}</td></tr>`;
    }
  }
})();
