/**
 * branches.js
 * CRUD UI for /api/v1/branches. Follows the same pattern every future list
 * page (products, suppliers, customers, ...) should copy: local state ->
 * fetchAndRender() -> table markup -> pagination -> modal for create/edit.
 */
(function () {
  const state = { page: 1, limit: 10, search: '', total: 0, pages: 1 };
  let contentEl;

  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    contentEl = window.AppShell.mount({ title: 'Branches' });
    if (!contentEl) return;

    contentEl.innerHTML = pageSkeleton();
    bindToolbar();
    await fetchAndRender();
  }

  function pageSkeleton() {
    return `
      <div class="page-header">
        <div>
          <h1>Branches</h1>
          <p>Manage the shop locations under your business.</p>
        </div>
        <button class="btn btn-primary" id="add-branch-btn" data-requires-permission="branches.create">
          ${window.Icons.get('plus')} Add branch
        </button>
      </div>

      <div class="card">
        <div class="toolbar">
          <div class="toolbar-search input-group">
            <span class="input-group-icon">${window.Icons.get('search')}</span>
            <input class="input" id="search-input" type="text" placeholder="Search by name or code" />
          </div>
        </div>
        <div class="table-wrap">
          <table class="table">
            <thead>
              <tr>
                <th>Branch</th>
                <th>Code</th>
                <th>Location</th>
                <th>Phone</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody id="branches-tbody">
              ${window.UI.skeletonRows(6, 4)}
            </tbody>
          </table>
        </div>
        <div class="pagination" id="pagination"></div>
      </div>
    `;
  }

  function bindToolbar() {
    document.getElementById('add-branch-btn').addEventListener('click', () => openBranchModal());
    document.getElementById('search-input').addEventListener('input', window.UI.debounce((e) => {
      state.search = e.target.value.trim();
      state.page = 1;
      fetchAndRender();
    }));
  }

  async function fetchAndRender() {
    const tbody = document.getElementById('branches-tbody');
    tbody.innerHTML = window.UI.skeletonRows(6, 4);

    try {
      const { data } = await window.Api.get('/branches', { page: state.page, limit: state.limit, search: state.search });
      state.total = data.total;
      state.pages = data.pages;
      renderRows(data.items);
      window.UI.renderPagination(document.getElementById('pagination'), state, (p) => { state.page = p; fetchAndRender(); });
      window.Permissions.applyPermissionGates(contentEl, window.AppShell.getUser());
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="6">${window.UI.emptyStateHtml({ icon: 'alert', title: 'Could not load branches', message: err.message })}</td></tr>`;
    }
  }

  function renderRows(items) {
    const tbody = document.getElementById('branches-tbody');

    if (!items.length) {
      tbody.innerHTML = `<tr><td colspan="6">${window.UI.emptyStateHtml({
        icon: 'branches',
        title: state.search ? 'No branches match your search' : 'No branches yet',
        message: state.search ? '' : 'Add your first branch to get started.',
      })}</td></tr>`;
      return;
    }

    tbody.innerHTML = items.map((b) => `
      <tr data-id="${b._id}">
        <td class="cell-primary">${window.UI.escapeHtml(b.name)} ${b.isMainBranch ? '<span class="badge badge-info">Main</span>' : ''}</td>
        <td>${window.UI.escapeHtml(b.code)}</td>
        <td>${window.UI.escapeHtml([b.town, b.county].filter(Boolean).join(', ') || '—')}</td>
        <td>${window.UI.escapeHtml(b.phone || '—')}</td>
        <td><span class="badge ${b.status === 'active' ? 'badge-success' : 'badge-neutral'}">${b.status}</span></td>
        <td class="actions">
          <button class="btn btn-ghost btn-sm btn-icon" data-action="edit" data-requires-permission="branches.update" title="Edit">${window.Icons.get('edit')}</button>
          ${!b.isMainBranch ? `<button class="btn btn-ghost btn-sm btn-icon" data-action="delete" data-requires-permission="branches.delete" title="Deactivate">${window.Icons.get('trash')}</button>` : ''}
        </td>
      </tr>
    `).join('');

    tbody.querySelectorAll('[data-action="edit"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const row = btn.closest('tr');
        const branch = items.find((b) => b._id === row.dataset.id);
        openBranchModal(branch);
      });
    });

    tbody.querySelectorAll('[data-action="delete"]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const row = btn.closest('tr');
        const branch = items.find((b) => b._id === row.dataset.id);
        const ok = await window.UI.confirmDialog({
          title: 'Deactivate branch?',
          message: `"${branch.name}" will be hidden from new sales but its history is kept.`,
          confirmText: 'Deactivate',
          danger: true,
        });
        if (!ok) return;

        try {
          await window.Api.delete(`/branches/${branch._id}`);
          window.UI.toast.success('Branch deactivated');
          fetchAndRender();
        } catch (err) {
          window.UI.toast.error(err.message);
        }
      });
    });
  }

  function openBranchModal(branch) {
    const isEdit = !!branch;
    const modal = window.UI.openModal({
      title: isEdit ? 'Edit branch' : 'Add branch',
      bodyHtml: `
        <form id="branch-form">
          <div class="field">
            <label for="b-name">Branch name</label>
            <input class="input" id="b-name" name="name" required value="${isEdit ? window.UI.escapeHtml(branch.name) : ''}" placeholder="Westlands Branch" />
          </div>
          <div class="form-row">
            <div class="field">
              <label for="b-code">Branch code</label>
              <input class="input" id="b-code" name="code" required maxlength="10" style="text-transform:uppercase"
                     value="${isEdit ? window.UI.escapeHtml(branch.code) : ''}" placeholder="WEST" ${isEdit && branch.isMainBranch ? 'disabled' : ''} />
            </div>
            <div class="field">
              <label for="b-phone">Phone</label>
              <input class="input" id="b-phone" name="phone" value="${isEdit ? window.UI.escapeHtml(branch.phone || '') : ''}" placeholder="0712345678" />
            </div>
          </div>
          <div class="form-row">
            <div class="field">
              <label for="b-town">Town</label>
              <input class="input" id="b-town" name="town" value="${isEdit ? window.UI.escapeHtml(branch.town || '') : ''}" placeholder="Nairobi" />
            </div>
            <div class="field">
              <label for="b-county">County</label>
              <input class="input" id="b-county" name="county" value="${isEdit ? window.UI.escapeHtml(branch.county || '') : ''}" placeholder="Nairobi" />
            </div>
          </div>
          <div class="field">
            <label for="b-address">Address</label>
            <input class="input" id="b-address" name="address" value="${isEdit ? window.UI.escapeHtml(branch.address || '') : ''}" placeholder="Street, building, floor" />
          </div>
        </form>
      `,
      footerHtml: `
        <button class="btn btn-secondary" data-action="cancel">Cancel</button>
        <button class="btn btn-primary" data-action="save" id="branch-save-btn">${isEdit ? 'Save changes' : 'Add branch'}</button>
      `,
    });

    modal.querySelector('[data-action="cancel"]').addEventListener('click', window.UI.closeModal);
    modal.querySelector('[data-action="save"]').addEventListener('click', async () => {
      const form = modal.querySelector('#branch-form');
      if (!form.reportValidity()) return;

      const payload = window.UI.serializeForm(form);
      if (payload.code) payload.code = payload.code.toUpperCase();
      // Disabled fields aren't submitted by FormData; keep the main branch's code intact.
      if (isEdit && branch.isMainBranch) payload.code = branch.code;

      const btn = document.getElementById('branch-save-btn');
      window.UI.setButtonLoading(btn, true, 'Saving…');

      try {
        if (isEdit) {
          await window.Api.put(`/branches/${branch._id}`, payload);
          window.UI.toast.success('Branch updated');
        } else {
          await window.Api.post('/branches', payload);
          window.UI.toast.success('Branch added');
        }
        window.UI.closeModal();
        fetchAndRender();
      } catch (err) {
        if (err.code === 'VALIDATION_ERROR' && err.errors?.length) {
          window.UI.applyFormErrors(form, err.errors);
        } else {
          window.UI.toast.error(err.message);
        }
      } finally {
        window.UI.setButtonLoading(btn, false);
      }
    });
  }
})();
