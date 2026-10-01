/**
 * cash-register.js
 * Owner / manager view of the cash drawer side of the business:
 *   - Shifts tab   : every shift (open and closed) with who opened it, who closed it, the
 *                    money figures, the over/short result, and a detail window showing the
 *                    closing count by denomination plus every cash sale in the shift.
 *   - Registers tab: create / rename / activate-deactivate tills for the active branch and
 *                    see which ones currently have an open shift.
 */
(function () {
  const esc = window.UI.escapeHtml;
  const fm = (n) => window.UI.formatMoney(n);
  const $ = (id) => document.getElementById(id);
  const nm = (x) => (x && typeof x === 'object' ? x.name || '' : '');

  const state = {
    tab: 'shifts',
    shifts: { page: 1, limit: 15, status: '', from: '', to: '', scope: 'branch' },
  };

  let contentEl;
  let user;
  let canManage = false;
  let canViewShifts = false;

  document.addEventListener('DOMContentLoaded', init);

  function init() {
    contentEl = window.AppShell.mount({ title: 'Registers & Shifts' });
    if (!contentEl) return;

    user = window.AppShell.getUser();
    canManage = window.Permissions.can(user, 'registers.manage');
    canViewShifts = window.Permissions.can(user, 'shifts.view');
    state.tab = canViewShifts ? 'shifts' : 'registers';

    contentEl.innerHTML = `
      <div class="page-header">
        <div>
          <h1>Registers &amp; Shifts</h1>
          <p>Tills, who opened and closed each shift, and how the cash drawer balanced.</p>
        </div>
      </div>
      <div class="tabs" id="cr-tabs" style="margin-bottom:var(--space-4)">
        ${canViewShifts ? '<button class="tab-btn" data-tab="shifts">Shifts</button>' : ''}
        <button class="tab-btn" data-tab="registers">Registers</button>
      </div>
      <div id="cr-body"></div>
    `;

    contentEl.querySelectorAll('.tab-btn').forEach((b) => b.addEventListener('click', () => { state.tab = b.dataset.tab; show(); }));
    window.AppShell.onBranchChange(() => { state.shifts.page = 1; show(); });
    show();
  }

  function show() {
    contentEl.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === state.tab));
    if (state.tab === 'shifts') renderShifts();
    else renderRegisters();
  }

  /* ================================================================== *
   * SHIFTS TAB
   * ================================================================== */
  function renderShifts() {
    const f = state.shifts;
    $('cr-body').innerHTML = `
      <div class="card">
        <div class="toolbar">
          <div class="flex gap-2" style="flex-wrap:wrap">
            <select class="select" id="sf-scope" style="max-width:170px">
              <option value="branch" ${f.scope === 'branch' ? 'selected' : ''}>This branch</option>
              <option value="all" ${f.scope === 'all' ? 'selected' : ''}>All branches</option>
            </select>
            <select class="select" id="sf-status" style="max-width:150px">
              <option value="">All shifts</option>
              <option value="OPEN" ${f.status === 'OPEN' ? 'selected' : ''}>Open</option>
              <option value="CLOSED" ${f.status === 'CLOSED' ? 'selected' : ''}>Closed</option>
            </select>
            <input class="input" id="sf-from" type="date" value="${esc(f.from)}" style="max-width:160px" title="Opened from" />
            <input class="input" id="sf-to" type="date" value="${esc(f.to)}" style="max-width:160px" title="Opened until" />
          </div>
          <button class="btn btn-secondary btn-sm" id="sf-refresh">Refresh</button>
        </div>
        <div class="table-wrap">
          <table class="table" style="min-width:1100px">
            <thead>
              <tr>
                <th>Register</th><th>Opened by</th><th>Opened</th><th>Closed by</th><th>Closed</th>
                <th class="num">Float</th><th class="num">Expected</th><th class="num">Counted</th><th class="num">Difference</th>
                <th>Status</th><th></th>
              </tr>
            </thead>
            <tbody id="sh-tbody">${window.UI.skeletonRows(11, 6)}</tbody>
          </table>
        </div>
        <div class="pagination" id="sh-pagination"></div>
      </div>
    `;

    const reset = () => { state.shifts.page = 1; fetchShifts(); };
    $('sf-scope').addEventListener('change', (e) => { f.scope = e.target.value; reset(); });
    $('sf-status').addEventListener('change', (e) => { f.status = e.target.value; reset(); });
    $('sf-from').addEventListener('change', (e) => { f.from = e.target.value; reset(); });
    $('sf-to').addEventListener('change', (e) => { f.to = e.target.value; reset(); });
    $('sf-refresh').addEventListener('click', fetchShifts);
    fetchShifts();
  }

  function diffCell(s) {
    if (s.status !== 'CLOSED') return '<span class="text-muted">-</span>';
    const d = s.cashDifference || 0;
    if (d === 0) return '<span style="color:var(--color-success);font-weight:600">Balanced</span>';
    return `<span style="color:var(--color-danger);font-weight:600">${d > 0 ? 'Over' : 'Short'} ${fm(Math.abs(d))}</span>`;
  }

  async function fetchShifts() {
    const tbody = $('sh-tbody');
    if (!tbody) return;
    tbody.innerHTML = window.UI.skeletonRows(11, 6);

    const f = state.shifts;
    const query = {
      page: f.page,
      limit: f.limit,
      status: f.status || undefined,
      branchId: f.scope === 'branch' ? window.AppShell.getActiveBranchId() : undefined,
      from: f.from ? new Date(`${f.from}T00:00:00`).toISOString() : undefined,
      to: f.to ? new Date(`${f.to}T23:59:59.999`).toISOString() : undefined,
    };

    try {
      const { data } = await window.Api.get('/shifts', query);
      if (!data.items.length) {
        tbody.innerHTML = `<tr><td colspan="11">${window.UI.emptyStateHtml({ icon: 'sales', title: 'No shifts found', message: 'Try a different branch, status or date range.' })}</td></tr>`;
      } else {
        tbody.innerHTML = data.items.map((s) => {
          const closed = s.status === 'CLOSED';
          return `
            <tr data-id="${s._id}">
              <td class="cell-primary">${esc(nm(s.registerId) || 'Register')}${s.registerId?.code ? ` <span class="text-xs text-muted">(${esc(s.registerId.code)})</span>` : ''}</td>
              <td class="text-sm">${esc(nm(s.cashierId))}</td>
              <td class="text-sm">${window.UI.formatDateTime(s.openedAt)}</td>
              <td class="text-sm">${closed ? esc(nm(s.closedBy) || nm(s.cashierId)) : '<span class="text-muted">-</span>'}</td>
              <td class="text-sm">${closed ? window.UI.formatDateTime(s.closedAt) : '<span class="text-muted">-</span>'}</td>
              <td class="num">${fm(s.openingCash)}</td>
              <td class="num">${closed ? fm(s.expectedCash) : '<span class="text-muted">-</span>'}</td>
              <td class="num">${closed ? fm(s.actualCash) : '<span class="text-muted">-</span>'}</td>
              <td class="num">${diffCell(s)}</td>
              <td><span class="badge ${closed ? 'badge-neutral' : 'badge-success'}">${closed ? 'Closed' : 'Open'}</span></td>
              <td class="actions"><button class="btn btn-secondary btn-sm" data-action="view">Details</button></td>
            </tr>`;
        }).join('');
        tbody.querySelectorAll('[data-action="view"]').forEach((b) =>
          b.addEventListener('click', () => openShiftDetail(b.closest('tr').dataset.id)));
      }
      window.UI.renderPagination($('sh-pagination'), data, (p) => { state.shifts.page = p; fetchShifts(); });
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="11">${window.UI.emptyStateHtml({ icon: 'alert', title: 'Could not load shifts', message: err.message })}</td></tr>`;
    }
  }

  async function openShiftDetail(id) {
    let data;
    try {
      ({ data } = await window.Api.get(`/shifts/${id}`));
    } catch (err) {
      return window.UI.toast.error(err.message);
    }
    const { shift: s, cashSales = [] } = data;
    const closed = s.status === 'CLOSED';
    const d = s.cashDifference || 0;

    const salesTable = cashSales.length ? `
      <div class="table-wrap" style="margin-top:var(--space-3)">
        <table class="table" style="min-width:0">
          <thead><tr><th>Receipt</th><th>Time</th><th class="num">Amount</th><th class="num">Tendered</th><th class="num">Change</th></tr></thead>
          <tbody>
            ${cashSales.map((p) => `
              <tr>
                <td class="cell-primary">${esc(p.receiptNumber || '-')}</td>
                <td class="text-sm">${window.UI.formatDateTime(p.createdAt)}</td>
                <td class="num">${fm(p.amount)}</td>
                <td class="num">${p.amountTendered != null ? fm(p.amountTendered) : '-'}</td>
                <td class="num">${p.changeGiven != null ? fm(p.changeGiven) : '-'}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>` : '<p class="text-xs text-muted" style="margin-top:var(--space-2)">No cash sales were taken in this shift.</p>';

    const modal = window.UI.openModal({
      title: `Shift · ${nm(s.registerId) || 'Register'}`,
      maxWidth: '640px',
      bodyHtml: `
        <div class="pos-totals-row"><span>Branch</span><span>${esc(nm(s.branchId) || '-')}</span></div>
        <div class="pos-totals-row"><span>Opened by</span><span>${esc(nm(s.cashierId))} · ${window.UI.formatDateTime(s.openedAt)}</span></div>
        <div class="pos-totals-row"><span>Closed by</span><span>${closed ? `${esc(nm(s.closedBy) || nm(s.cashierId))} · ${window.UI.formatDateTime(s.closedAt)}` : '<span class="badge badge-success">Still open</span>'}</span></div>
        <div class="pos-totals-row" style="margin-top:var(--space-2)"><span>Opening float</span><span>${fm(s.openingCash)}</span></div>
        ${closed ? `
          <div class="pos-totals-row"><span>Expected cash</span><span>${fm(s.expectedCash)}</span></div>
          <div class="pos-totals-row"><span>Actual cash counted</span><span>${fm(s.actualCash)}</span></div>
          <div class="pos-totals-row grand" style="color:${d === 0 ? 'var(--color-success)' : 'var(--color-danger)'}">
            <span>${d === 0 ? 'Balanced' : d > 0 ? 'Over' : 'Short'}</span><span>${fm(Math.abs(d))}</span>
          </div>
          ${window.CashCount.breakdownHtml(s.denominations)}
          ${s.notes ? `<div class="pz-note" style="margin-top:var(--space-3)"><strong>Notes:</strong> ${esc(s.notes)}</div>` : ''}
        ` : ''}
        <h4 style="margin-top:var(--space-4)">Cash sales in this shift (${cashSales.length})</h4>
        ${salesTable}
      `,
      footerHtml: '<button class="btn btn-primary" data-action="close">Close</button>',
    });
    modal.querySelector('[data-action="close"]').addEventListener('click', window.UI.closeModal);
  }

  /* ================================================================== *
   * REGISTERS TAB
   * ================================================================== */
  async function renderRegisters() {
    $('cr-body').innerHTML = `
      <div class="card">
        <div class="toolbar">
          <div class="text-sm text-secondary">Registers for <strong>${esc(window.AppShell.getActiveBranchName() || 'the active branch')}</strong></div>
          ${canManage ? '<button class="btn btn-primary btn-sm" id="reg-new">New register</button>' : ''}
        </div>
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>Name</th><th>Code</th><th>Status</th><th>Current shift</th><th></th></tr></thead>
            <tbody id="reg-tbody">${window.UI.skeletonRows(5, 4)}</tbody>
          </table>
        </div>
      </div>
    `;
    $('reg-new')?.addEventListener('click', () => openRegisterModal());

    const branchId = window.AppShell.getActiveBranchId();
    const [regRes, shiftRes] = await Promise.allSettled([
      window.Api.get('/registers', { branchId }),
      canViewShifts ? window.Api.get('/shifts', { branchId, status: 'OPEN', page: 1, limit: 100 }) : Promise.resolve(null),
    ]);
    const tbody = $('reg-tbody');
    if (!tbody) return;

    if (regRes.status === 'rejected') {
      tbody.innerHTML = `<tr><td colspan="5">${window.UI.emptyStateHtml({ icon: 'alert', title: 'Could not load registers', message: regRes.reason.message })}</td></tr>`;
      return;
    }

    const registers = regRes.value.data.registers || [];
    const openByRegister = {};
    if (shiftRes.status === 'fulfilled' && shiftRes.value) {
      (shiftRes.value.data.items || []).forEach((s) => { openByRegister[s.registerId?._id || s.registerId] = s; });
    }

    if (!registers.length) {
      tbody.innerHTML = `<tr><td colspan="5">${window.UI.emptyStateHtml({ icon: 'store', title: 'No registers yet', message: canManage ? 'Create the first till for this branch.' : 'Ask the owner to create a register.' })}</td></tr>`;
      return;
    }

    tbody.innerHTML = registers.map((r) => {
      const open = openByRegister[r._id];
      return `
        <tr data-id="${r._id}">
          <td class="cell-primary">${esc(r.name)}</td>
          <td><span class="pz-mono">${esc(r.code)}</span></td>
          <td><span class="badge ${r.status === 'active' ? 'badge-success' : 'badge-neutral'}">${r.status === 'active' ? 'Active' : 'Inactive'}</span></td>
          <td class="text-sm">${open ? `<span class="badge badge-info">Open</span> ${esc(nm(open.cashierId))} · since ${window.UI.formatDateTime(open.openedAt)}` : '<span class="text-muted">No open shift</span>'}</td>
          <td class="actions">${canManage ? '<button class="btn btn-secondary btn-sm" data-action="edit">Edit</button>' : ''}</td>
        </tr>`;
    }).join('');

    tbody.querySelectorAll('[data-action="edit"]').forEach((b) => {
      b.addEventListener('click', () => openRegisterModal(registers.find((r) => r._id === b.closest('tr').dataset.id)));
    });
  }

  function openRegisterModal(register) {
    const editing = !!register;
    const branchId = window.AppShell.getActiveBranchId();
    const modal = window.UI.openModal({
      title: editing ? `Edit ${register.name}` : 'New cash register',
      bodyHtml: `
        <form id="reg-form">
          <div class="field"><label>Name</label><input class="input" name="name" required placeholder="Till 1" value="${editing ? esc(register.name) : ''}" /></div>
          ${editing ? `
            <div class="field"><label>Code</label><input class="input" value="${esc(register.code)}" disabled /></div>
            <div class="field"><label>Status</label>
              <select class="select" name="status">
                <option value="active" ${register.status === 'active' ? 'selected' : ''}>Active</option>
                <option value="inactive" ${register.status === 'inactive' ? 'selected' : ''}>Inactive</option>
              </select>
            </div>` : `
            <div class="field"><label>Code</label><input class="input" name="code" required maxlength="10" placeholder="TILL1" /></div>
            <p class="text-xs text-muted">Created in ${esc(window.AppShell.getActiveBranchName() || 'the active branch')}.</p>`}
        </form>
      `,
      footerHtml: '<button class="btn btn-secondary" data-action="cancel">Cancel</button><button class="btn btn-primary" data-action="save" id="reg-save">Save</button>',
    });

    modal.querySelector('[data-action="cancel"]').addEventListener('click', window.UI.closeModal);
    modal.querySelector('[data-action="save"]').addEventListener('click', async () => {
      const form = modal.querySelector('#reg-form');
      if (!form.reportValidity()) return;
      const raw = window.UI.serializeForm(form);
      const btn = $('reg-save');
      window.UI.setButtonLoading(btn, true, 'Saving…');
      try {
        if (editing) await window.Api.put(`/registers/${register._id}`, { name: raw.name, status: raw.status });
        else await window.Api.post('/registers', { branchId, name: raw.name, code: raw.code });
        window.UI.toast.success(editing ? 'Register updated' : 'Register created');
        window.UI.closeModal();
        renderRegisters();
      } catch (err) {
        window.UI.toast.error(err.message);
      } finally {
        window.UI.setButtonLoading(btn, false);
      }
    });
  }
})();