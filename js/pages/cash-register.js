/**
 * cash-register.js
 * Owner / manager view of the cash drawer side of the business:
 *   - Shifts tab    : every shift (open and closed) with who opened it, who closed it, the
 *                     money figures, the over/short result, and a detail window showing the
 *                     closing count by denomination plus every cash sale in the shift.
 *   - Shortages tab : every shift that closed SHORT is tracked against the cashier until it is
 *                     repaid. Per-cashier running totals, and managers/owners can record
 *                     (part-)payments to clear the loss.
 *   - Registers tab : create / rename / activate-deactivate tills for the active branch and
 *                     see which ones currently have an open shift.
 */
(function () {
  const esc = window.UI.escapeHtml;
  const fm = (n) => window.UI.formatMoney(n);
  const $ = (id) => document.getElementById(id);
  const nm = (x) => (x && typeof x === 'object' ? x.name || '' : '');

  const state = {
    tab: 'shifts',
    shifts: { page: 1, limit: 15, status: '', from: '', to: '', scope: 'branch' },
    shortages: { page: 1, limit: 15, status: 'UNSETTLED', from: '', to: '', scope: 'branch', cashierId: '', cashierName: '' },
  };

  let contentEl;
  let user;
  let canManage = false;
  let canViewShifts = false;
  let canViewShortages = false;
  let canClearShortages = false;

  document.addEventListener('DOMContentLoaded', init);

  function init() {
    contentEl = window.AppShell.mount({ title: 'Registers & Shifts' });
    if (!contentEl) return;

    user = window.AppShell.getUser();
    canManage = window.Permissions.can(user, 'registers.manage');
    canViewShifts = window.Permissions.can(user, 'shifts.view');
    canViewShortages = window.Permissions.can(user, 'shortages.view');
    canClearShortages = window.Permissions.can(user, 'shortages.manage');
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
        ${canViewShortages ? '<button class="tab-btn" data-tab="shortages">Cashier shortages</button>' : ''}
        <button class="tab-btn" data-tab="registers">Registers</button>
      </div>
      <div id="cr-body"></div>
    `;

    contentEl.querySelectorAll('.tab-btn').forEach((b) => b.addEventListener('click', () => { state.tab = b.dataset.tab; show(); }));
    window.AppShell.onBranchChange(() => { state.shifts.page = 1; state.shortages.page = 1; show(); });
    show();
  }

  function show() {
    contentEl.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === state.tab));
    if (state.tab === 'shifts') renderShifts();
    else if (state.tab === 'shortages') renderShortages();
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
   * CASHIER SHORTAGES TAB
   * ================================================================== */
  const SG_STATUS = {
    OUTSTANDING: ['badge-danger', 'Outstanding'],
    PARTIAL: ['badge-warning', 'Part-paid'],
    CLEARED: ['badge-success', 'Cleared'],
  };
  const SG_METHODS = { CASH: 'Cash', MPESA: 'M-PESA', BANK: 'Bank', SALARY_DEDUCTION: 'Salary deduction', OTHER: 'Other' };
  const sgBadge = (s) => { const [c, l] = SG_STATUS[s] || ['badge-neutral', s]; return `<span class="badge ${c}">${l}</span>`; };

  function sgQuery(extra) {
    const f = state.shortages;
    return {
      branchId: f.scope === 'branch' ? window.AppShell.getActiveBranchId() : undefined,
      from: f.from ? new Date(`${f.from}T00:00:00`).toISOString() : undefined,
      to: f.to ? new Date(`${f.to}T23:59:59.999`).toISOString() : undefined,
      ...extra,
    };
  }

  function renderShortages() {
    const f = state.shortages;
    $('cr-body').innerHTML = `
      <div class="card" style="margin-bottom:var(--space-4)">
        <div class="toolbar"><strong>Shortage count per cashier</strong><span class="text-xs text-muted">Every shift that closed short is recorded here until repaid</span></div>
        <div id="sg-summary" style="padding:0 var(--space-6) var(--space-5)"><div class="skeleton" style="height:90px"></div></div>
      </div>
      <div class="card">
        <div class="toolbar">
          <div class="flex gap-2" style="flex-wrap:wrap;align-items:center">
            <select class="select" id="sg-scope" style="max-width:170px">
              <option value="branch" ${f.scope === 'branch' ? 'selected' : ''}>This branch</option>
              <option value="all" ${f.scope === 'all' ? 'selected' : ''}>All branches</option>
            </select>
            <select class="select" id="sg-status" style="max-width:160px">
              <option value="UNSETTLED" ${f.status === 'UNSETTLED' ? 'selected' : ''}>Still owing</option>
              <option value="" ${f.status === '' ? 'selected' : ''}>All shortages</option>
              <option value="CLEARED" ${f.status === 'CLEARED' ? 'selected' : ''}>Cleared</option>
            </select>
            <input class="input" id="sg-from" type="date" value="${esc(f.from)}" style="max-width:160px" title="From" />
            <input class="input" id="sg-to" type="date" value="${esc(f.to)}" style="max-width:160px" title="Until" />
            ${f.cashierId ? `<button class="badge badge-info" id="sg-clear-cashier" style="border:none;cursor:pointer">${esc(f.cashierName)} ✕</button>` : ''}
          </div>
          <button class="btn btn-secondary btn-sm" id="sg-refresh">Refresh</button>
        </div>
        <div class="table-wrap">
          <table class="table" style="min-width:1000px">
            <thead><tr>
              <th>Date</th><th>Cashier</th><th>Register</th>
              <th class="num">Shortage</th><th class="num">Paid</th><th class="num">Balance</th>
              <th>Status</th><th></th>
            </tr></thead>
            <tbody id="sg-tbody">${window.UI.skeletonRows(8, 5)}</tbody>
          </table>
        </div>
        <div class="pagination" id="sg-pagination"></div>
      </div>
    `;

    const reload = () => { state.shortages.page = 1; fetchShortageSummary(); fetchShortages(); };
    $('sg-scope').addEventListener('change', (e) => { f.scope = e.target.value; reload(); });
    $('sg-status').addEventListener('change', (e) => { f.status = e.target.value; state.shortages.page = 1; fetchShortages(); });
    $('sg-from').addEventListener('change', (e) => { f.from = e.target.value; reload(); });
    $('sg-to').addEventListener('change', (e) => { f.to = e.target.value; reload(); });
    $('sg-refresh').addEventListener('click', () => { fetchShortageSummary(); fetchShortages(); });
    $('sg-clear-cashier')?.addEventListener('click', () => { f.cashierId = ''; f.cashierName = ''; renderShortages(); });
    fetchShortageSummary();
    fetchShortages();
  }

  async function fetchShortageSummary() {
    const box = $('sg-summary');
    if (!box) return;
    try {
      const { data } = await window.Api.get('/shortages/summary', sgQuery());
      const t = data.totals;
      const tile = (label, value, color) => `
        <div class="stat-card"><div class="stat-label">${label}</div>
        <div class="stat-value" ${color ? `style="color:${color}"` : ''}>${value}</div></div>`;

      const rows = data.cashiers.length ? `
        <div class="table-wrap" style="margin-top:var(--space-4)">
          <table class="table" style="min-width:720px">
            <thead><tr><th>Cashier</th><th class="num">Shortages</th><th class="num">Still owing (count)</th><th class="num">Total lost</th><th class="num">Repaid</th><th class="num">Outstanding</th><th>Last shortage</th><th></th></tr></thead>
            <tbody>
              ${data.cashiers.map((c) => `
                <tr data-cid="${c.cashierId}" data-cname="${esc(c.name)}">
                  <td class="cell-primary">${esc(c.name)}</td>
                  <td class="num">${c.shortageCount}</td>
                  <td class="num">${c.unsettledCount}</td>
                  <td class="num">${fm(c.totalLost)}</td>
                  <td class="num">${fm(c.totalPaid)}</td>
                  <td class="num" style="font-weight:600;color:${c.outstanding > 0 ? 'var(--color-danger)' : 'var(--color-success)'}">${fm(c.outstanding)}</td>
                  <td class="text-sm">${c.lastShortageAt ? window.UI.formatDateTime(c.lastShortageAt) : '-'}</td>
                  <td class="actions"><button class="btn btn-secondary btn-sm" data-action="filter">View</button></td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>` : '<p class="text-sm text-muted" style="margin-top:var(--space-3)">No cashier has closed a shift short in this period.</p>';

      box.innerHTML = `
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:var(--space-3)">
          ${tile('Shortages recorded', t.shortageCount)}
          ${tile('Total lost', fm(t.totalLost))}
          ${tile('Repaid', fm(t.totalPaid), 'var(--color-success)')}
          ${tile('Outstanding', fm(t.outstanding), t.outstanding > 0 ? 'var(--color-danger)' : 'var(--color-success)')}
        </div>${rows}`;

      box.querySelectorAll('[data-action="filter"]').forEach((b) => b.addEventListener('click', () => {
        const tr = b.closest('tr');
        state.shortages.cashierId = tr.dataset.cid;
        state.shortages.cashierName = tr.dataset.cname;
        state.shortages.page = 1;
        renderShortages();
      }));
    } catch (err) {
      box.innerHTML = `<p class="text-sm" style="color:var(--color-danger)">${esc(err.message)}</p>`;
    }
  }

  async function fetchShortages() {
    const tbody = $('sg-tbody');
    if (!tbody) return;
    tbody.innerHTML = window.UI.skeletonRows(8, 5);
    const f = state.shortages;
    try {
      const { data } = await window.Api.get('/shortages', sgQuery({
        page: f.page, limit: f.limit, status: f.status || undefined, cashierId: f.cashierId || undefined,
      }));
      if (!data.items.length) {
        tbody.innerHTML = `<tr><td colspan="8">${window.UI.emptyStateHtml({ icon: 'sales', title: 'No shortages found', message: f.status === 'UNSETTLED' ? 'Nothing is owed right now.' : 'Try a different filter.' })}</td></tr>`;
      } else {
        tbody.innerHTML = data.items.map((s) => `
          <tr data-id="${s._id}">
            <td class="text-sm">${window.UI.formatDateTime(s.incurredAt)}</td>
            <td class="cell-primary">${esc(nm(s.cashierId))}</td>
            <td class="text-sm">${esc(nm(s.registerId) || '-')}</td>
            <td class="num">${fm(s.amount)}</td>
            <td class="num">${fm(s.amountPaid)}</td>
            <td class="num" style="font-weight:600;color:${s.balance > 0 ? 'var(--color-danger)' : 'var(--color-success)'}">${fm(s.balance)}</td>
            <td>${sgBadge(s.status)}</td>
            <td class="actions">
              <button class="btn btn-secondary btn-sm" data-action="details">Details</button>
              ${canClearShortages && s.balance > 0 ? '<button class="btn btn-primary btn-sm" data-action="pay">Record payment</button>' : ''}
            </td>
          </tr>`).join('');
        const byId = Object.fromEntries(data.items.map((s) => [s._id, s]));
        tbody.querySelectorAll('[data-action="details"]').forEach((b) => b.addEventListener('click', () => openShortageDetail(b.closest('tr').dataset.id)));
        tbody.querySelectorAll('[data-action="pay"]').forEach((b) => b.addEventListener('click', () => openShortagePayModal(byId[b.closest('tr').dataset.id])));
      }
      window.UI.renderPagination($('sg-pagination'), data, (p) => { state.shortages.page = p; fetchShortages(); });
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="8">${window.UI.emptyStateHtml({ icon: 'alert', title: 'Could not load shortages', message: err.message })}</td></tr>`;
    }
  }

  async function openShortageDetail(id) {
    let data;
    try { ({ data } = await window.Api.get(`/shortages/${id}`)); } catch (err) { return window.UI.toast.error(err.message); }
    const { shortage: s, payments = [] } = data;

    const payTable = payments.length ? `
      <div class="table-wrap" style="margin-top:var(--space-3)">
        <table class="table" style="min-width:0">
          <thead><tr><th>When</th><th>Method</th><th>Ref</th><th>Recorded by</th><th class="num">Amount</th><th class="num">Balance after</th></tr></thead>
          <tbody>${payments.map((p) => `
            <tr>
              <td class="text-sm">${window.UI.formatDateTime(p.receivedAt)}</td>
              <td class="text-sm">${esc(SG_METHODS[p.method] || p.method)}</td>
              <td class="text-sm">${esc(p.reference || '-')}</td>
              <td class="text-sm">${esc(nm(p.receivedBy))}</td>
              <td class="num">${fm(p.amount)}</td>
              <td class="num">${fm(p.balanceAfter)}</td>
            </tr>`).join('')}</tbody>
        </table>
      </div>` : '<p class="text-xs text-muted" style="margin-top:var(--space-2)">No payments yet.</p>';

    const canPay = canClearShortages && s.balance > 0;
    const modal = window.UI.openModal({
      title: `Shortage · ${nm(s.cashierId)}`,
      maxWidth: '640px',
      bodyHtml: `
        <div class="pos-totals-row"><span>Cashier</span><span>${esc(nm(s.cashierId))}</span></div>
        <div class="pos-totals-row"><span>Register</span><span>${esc(nm(s.registerId) || '-')}</span></div>
        <div class="pos-totals-row"><span>Branch</span><span>${esc(nm(s.branchId) || '-')}</span></div>
        <div class="pos-totals-row"><span>Shift closed</span><span>${window.UI.formatDateTime(s.shiftId?.closedAt || s.incurredAt)}</span></div>
        <div class="pos-totals-row" style="margin-top:var(--space-2)"><span>Shortage</span><span>${fm(s.amount)}</span></div>
        <div class="pos-totals-row"><span>Repaid so far</span><span>${fm(s.amountPaid)}</span></div>
        <div class="pos-totals-row grand" style="color:${s.balance > 0 ? 'var(--color-danger)' : 'var(--color-success)'}"><span>${s.balance > 0 ? 'Still owing' : 'Cleared'}</span><span>${fm(s.balance)}</span></div>
        <h4 style="margin-top:var(--space-4)">Payments (${payments.length})</h4>
        ${payTable}
      `,
      footerHtml: `<button class="btn btn-secondary" data-action="close">Close</button>${canPay ? '<button class="btn btn-primary" data-action="pay">Record payment</button>' : ''}`,
    });
    modal.querySelector('[data-action="close"]').addEventListener('click', window.UI.closeModal);
    modal.querySelector('[data-action="pay"]')?.addEventListener('click', () => { window.UI.closeModal(); openShortagePayModal(s); });
  }

  function openShortagePayModal(s) {
    const modal = window.UI.openModal({
      title: `Record payment · ${nm(s.cashierId)}`,
      bodyHtml: `
        <div class="pos-totals-row"><span>Shortage</span><span>${fm(s.amount)}</span></div>
        <div class="pos-totals-row"><span>Already repaid</span><span>${fm(s.amountPaid)}</span></div>
        <div class="pos-totals-row grand" style="color:var(--color-danger)"><span>Still owing</span><span>${fm(s.balance)}</span></div>
        <form id="sg-pay-form" style="margin-top:var(--space-4)">
          <div class="field"><label>Amount received (KES)</label>
            <input class="input" name="amount" type="number" inputmode="decimal" step="0.01" min="0.01" max="${s.balance}" value="${s.balance}" required />
            <span class="field-hint">Enter less than the balance for a part-payment.</span></div>
          <div class="field"><label>How was it paid?</label>
            <select class="select" name="method">
              ${Object.entries(SG_METHODS).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}
            </select></div>
          <div class="field"><label>Reference <span class="text-muted">(optional)</span></label>
            <input class="input" name="reference" maxlength="100" placeholder="M-PESA code, etc." /></div>
          <div class="field"><label>Notes <span class="text-muted">(optional)</span></label>
            <textarea class="textarea" name="notes" maxlength="500" style="min-height:64px"></textarea></div>
        </form>
      `,
      footerHtml: '<button class="btn btn-secondary" data-action="cancel">Cancel</button><button class="btn btn-primary" data-action="save" id="sg-pay-save">Record payment</button>',
    });

    modal.querySelector('[data-action="cancel"]').addEventListener('click', window.UI.closeModal);
    modal.querySelector('[data-action="save"]').addEventListener('click', async () => {
      const form = modal.querySelector('#sg-pay-form');
      if (!form.reportValidity()) return;
      const raw = window.UI.serializeForm(form);
      const btn = $('sg-pay-save');
      window.UI.setButtonLoading(btn, true, 'Saving…');
      try {
        const { data } = await window.Api.post(`/shortages/${s._id}/payments`, {
          amount: Number(raw.amount),
          method: raw.method,
          reference: raw.reference || undefined,
          notes: raw.notes || undefined,
        });
        window.UI.toast.success(data.shortage.status === 'CLEARED' ? 'Shortage cleared' : 'Payment recorded');
        window.UI.closeModal();
        fetchShortageSummary();
        fetchShortages();
      } catch (err) {
        window.UI.toast.error(err.message);
      } finally {
        window.UI.setButtonLoading(btn, false);
      }
    });
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