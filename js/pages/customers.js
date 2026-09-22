/**
 * customers.js
 * Owner/Manager-facing customer book: search & browse everyone in
 * Customer, open a profile with their credit standing and ledger
 * ("purchase & payment history" - see note below), edit their details,
 * set a credit limit (the closest thing this backend has to "approving" a
 * customer for credit), and record a payment against what they owe.
 *
 * IMPORTANT SCOPE NOTE: the API has no endpoint that returns a customer's
 * full sales history (GET /sales doesn't filter by customerId), and
 * CustomerLedger only logs CREDIT activity - credit sales, payments,
 * adjustments - not cash purchases. So the "History" tab here is exactly
 * that: credit-related transactions, not a complete order history. It's
 * labelled honestly in the UI rather than implied to be more than it is.
 *
 * Permissions used (all already in the default role map):
 *   customers.view    - see this page at all, open a profile
 *   customers.create  - the "Add customer" button
 *   customers.update  - edit details, set credit limit
 *   payments.view     - record a payment (this is the permission the
 *                       backend route actually checks, oddly named but
 *                       that's what POST /customers/:id/payment requires)
 *   reports.view       - the summary KPI row at the top (uses GET /reports/customers)
 */
(function () {
  const esc = window.UI.escapeHtml;
  const fm = window.UI.formatMoney;

  const state = { page: 1, limit: 15, search: '', total: 0, pages: 1 };
  let contentEl;
  let user;
  let canCreate = false;
  let canUpdate = false;
  let canPayment = false;
  let canReports = false;

  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    contentEl = window.AppShell.mount({ title: 'Customers' });
    if (!contentEl) return;

    user = window.AppShell.getUser();
    canCreate = window.Permissions.can(user, 'customers.create');
    canUpdate = window.Permissions.can(user, 'customers.update');
    canPayment = window.Permissions.can(user, 'payments.view');
    canReports = window.Permissions.can(user, 'reports.view');

    contentEl.innerHTML = pageSkeleton();
    window.Permissions.applyPermissionGates(contentEl, user);
    bindToolbar();
    if (canReports) loadSummary();
    await fetchAndRender();
  }

  /* ------------------------------------------------------------------ *
   * Page frame
   * ------------------------------------------------------------------ */
  function pageSkeleton() {
    return `
      <div class="page-header">
        <div>
          <h1>Customers</h1>
          <p>Search your customer book, manage credit, and record payments.</p>
        </div>
        <button class="btn btn-primary" id="add-customer-btn" data-requires-permission="customers.create">
          ${window.Icons.get('plus')} Add customer
        </button>
      </div>

      ${canReports ? `<div class="kpi-grid" id="cust-summary" style="margin-bottom: var(--space-4)">
        <div class="kpi"><div class="kpi-top"><span class="kpi-label">Total customers</span></div><div class="kpi-value skeleton" style="height:28px;width:60%"></div></div>
        <div class="kpi kpi-warning"><div class="kpi-top"><span class="kpi-label">Total owed to you</span></div><div class="kpi-value skeleton" style="height:28px;width:60%"></div></div>
        <div class="kpi kpi-danger"><div class="kpi-top"><span class="kpi-label">Top debtors listed</span></div><div class="kpi-value skeleton" style="height:28px;width:60%"></div></div>
      </div>` : ''}

      <div class="card">
        <div class="toolbar">
          <div class="toolbar-search input-group">
            <span class="input-group-icon">${window.Icons.get('search')}</span>
            <input class="input" id="search-input" type="text" placeholder="Search by name, phone, or customer number" />
          </div>
        </div>
        <div class="table-wrap">
          <table class="table">
            <thead>
              <tr>
                <th>Customer</th>
                <th>Contact</th>
                <th class="num">Outstanding</th>
                <th class="num">Credit limit</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody id="customers-tbody">${window.UI.skeletonRows(6, 6)}</tbody>
          </table>
        </div>
        <div class="pagination" id="pagination"></div>
      </div>
    `;
  }

  function bindToolbar() {
    document.getElementById('add-customer-btn')?.addEventListener('click', () => openCreateModal());
    document.getElementById('search-input').addEventListener('input', window.UI.debounce((e) => {
      state.search = e.target.value.trim();
      state.page = 1;
      fetchAndRender();
    }, 300));
  }

  /* ------------------------------------------------------------------ *
   * Summary KPIs (GET /reports/customers - owners/managers/accountants only)
   * ------------------------------------------------------------------ */
  async function loadSummary() {
    const el = document.getElementById('cust-summary');
    if (!el) return;
    try {
      const { data } = await window.Api.get('/reports/customers');
      el.innerHTML = `
        <div class="kpi"><div class="kpi-top"><span class="kpi-label">Total customers</span>${window.Icons.get('employees')}</div><div class="kpi-value">${state.total || '—'}</div></div>
        <div class="kpi kpi-warning"><div class="kpi-top"><span class="kpi-label">Total owed to you</span></div><div class="kpi-value">${fm(data.totalOutstanding)}</div></div>
        <div class="kpi kpi-danger"><div class="kpi-top"><span class="kpi-label">Top debtors listed</span></div><div class="kpi-value">${data.customers.length}</div><div class="kpi-foot"><span class="kpi-sub">Largest balances, up to 50</span></div></div>
      `;
    } catch {
      el.innerHTML = ''; // quiet failure - the table below is the important part
    }
  }

  /* ------------------------------------------------------------------ *
   * List
   * ------------------------------------------------------------------ */
  async function fetchAndRender() {
    const tbody = document.getElementById('customers-tbody');
    tbody.innerHTML = window.UI.skeletonRows(6, 6);

    try {
      const { data } = await window.Api.get('/customers', { page: state.page, limit: state.limit, search: state.search });
      state.total = data.total;
      state.pages = data.pages;
      renderRows(data.items);
      window.UI.renderPagination(document.getElementById('pagination'), state, (p) => { state.page = p; fetchAndRender(); });
      window.Permissions.applyPermissionGates(contentEl, user);
      const summaryTotalEl = document.querySelector('#cust-summary .kpi-value');
      if (summaryTotalEl && summaryTotalEl.textContent === '—') summaryTotalEl.textContent = state.total;
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="6">${window.UI.emptyStateHtml({ icon: 'alert', title: 'Could not load customers', message: err.message })}</td></tr>`;
    }
  }

  const STATUS_BADGE = { active: 'badge-success', inactive: 'badge-neutral' };

  function renderRows(items) {
    const tbody = document.getElementById('customers-tbody');
    if (!items.length) {
      tbody.innerHTML = `<tr><td colspan="6">${window.UI.emptyStateHtml({
        icon: 'employees',
        title: state.search ? 'No customers match your search' : 'No customers yet',
        message: state.search ? '' : 'Customers are added here or picked up automatically when one is created at the till.',
      })}</td></tr>`;
      return;
    }

    tbody.innerHTML = items.map((c) => `
      <tr data-id="${c._id}">
        <td>
          <div class="cell-primary">${esc(c.name)}</div>
          ${c.customerNumber ? `<div class="text-xs text-muted">${esc(c.customerNumber)}</div>` : ''}
        </td>
        <td class="text-sm">
          <div>${c.phone ? esc(c.phone) : '<span class="text-muted">No phone</span>'}</div>
          ${c.email ? `<div class="text-xs text-muted">${esc(c.email)}</div>` : ''}
        </td>
        <td class="num">${c.outstandingBalance > 0 ? `<span class="text-neg font-semibold">${fm(c.outstandingBalance)}</span>` : fm(0)}</td>
        <td class="num">${fm(c.creditLimit)}</td>
        <td><span class="badge ${STATUS_BADGE[c.status] || 'badge-neutral'}">${esc(c.status)}</span></td>
        <td class="actions">
          <button class="btn btn-secondary btn-sm" data-action="view" data-requires-permission="customers.view">View</button>
        </td>
      </tr>
    `).join('');

    tbody.querySelectorAll('[data-action="view"]').forEach((btn) => {
      btn.addEventListener('click', () => openCustomerProfile(btn.closest('tr').dataset.id));
    });
  }

  /* ------------------------------------------------------------------ *
   * Add customer
   * ------------------------------------------------------------------ */
  function customerFormFields(prefill = {}) {
    return `
      <div class="field">
        <label for="c-name">Full name</label>
        <input class="input" id="c-name" name="name" required value="${esc(prefill.name || '')}" placeholder="Jane Wanjiru" />
      </div>
      <div class="form-row">
        <div class="field">
          <label for="c-phone">Phone</label>
          <input class="input" id="c-phone" name="phone" value="${esc(prefill.phone || '')}" placeholder="0712345678" />
        </div>
        <div class="field">
          <label for="c-email">Email</label>
          <input class="input" id="c-email" name="email" type="email" value="${esc(prefill.email || '')}" placeholder="jane@email.com" />
        </div>
      </div>
      <div class="field">
        <label for="c-address">Address</label>
        <input class="input" id="c-address" name="address" value="${esc(prefill.address || '')}" placeholder="Shop 12, Moi Avenue" />
      </div>
      <div class="field">
        <label for="c-number">Customer number <span class="text-muted">(optional)</span></label>
        <input class="input" id="c-number" name="customerNumber" value="${esc(prefill.customerNumber || '')}" placeholder="Auto or your own reference" />
      </div>
    `;
  }

  function openCreateModal() {
    const modal = window.UI.openModal({
      title: 'Add customer',
      bodyHtml: `<form id="customer-create-form">${customerFormFields()}</form>`,
      footerHtml: `<button class="btn btn-secondary" data-action="cancel">Cancel</button><button class="btn btn-primary" data-action="save" id="customer-create-save">Add customer</button>`,
    });

    modal.querySelector('[data-action="cancel"]').addEventListener('click', window.UI.closeModal);
    modal.querySelector('[data-action="save"]').addEventListener('click', async () => {
      const form = modal.querySelector('#customer-create-form');
      if (!form.reportValidity()) return;

      const raw = window.UI.serializeForm(form);
      ['phone', 'email', 'address', 'customerNumber'].forEach((k) => {
        if (typeof raw[k] === 'string') raw[k] = raw[k].trim();
        if (!raw[k]) delete raw[k];
      });
      raw.name = (raw.name || '').trim();

      const btn = document.getElementById('customer-create-save');
      window.UI.setButtonLoading(btn, true, 'Saving…');
      try {
        await window.Api.post('/customers', raw);
        window.UI.toast.success('Customer added');
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

  /* ------------------------------------------------------------------ *
   * Customer profile modal - overview + edit + credit limit + history
   * ------------------------------------------------------------------ */
  async function openCustomerProfile(id) {
    let customer, ledger;
    try {
      const [cRes, lRes] = await Promise.all([
        window.Api.get(`/customers/${id}`),
        window.Api.get(`/customers/${id}/ledger`, { page: 1, limit: 15 }),
      ]);
      customer = cRes.data.customer;
      ledger = lRes.data;
    } catch (err) {
      window.UI.toast.error(err.message);
      return;
    }

    renderProfileModal(customer, ledger, { ledgerPage: 1 });
  }

  const TX_LABEL = { SALE_CREDIT: 'Credit sale', PAYMENT: 'Payment', ADJUSTMENT: 'Adjustment', REVERSAL: 'Reversal' };
  const TX_BADGE = { SALE_CREDIT: 'badge-warning', PAYMENT: 'badge-success', ADJUSTMENT: 'badge-info', REVERSAL: 'badge-danger' };

  function ledgerRows(items) {
    if (!items.length) {
      return `<tr><td colspan="5">${window.UI.emptyStateHtml({ icon: 'reports', title: 'No credit activity yet', message: 'Credit sales and payments for this customer will appear here.' })}</td></tr>`;
    }
    return items.map((row) => `
      <tr>
        <td class="text-sm">${window.UI.formatDateTime(row.createdAt)}</td>
        <td><span class="badge ${TX_BADGE[row.transactionType] || 'badge-neutral'}">${TX_LABEL[row.transactionType] || esc(row.transactionType)}</span></td>
        <td class="num">${row.debit ? `<span class="text-neg">${fm(row.debit)}</span>` : '—'}</td>
        <td class="num">${row.credit ? `<span class="text-pos">${fm(row.credit)}</span>` : '—'}</td>
        <td class="num font-semibold">${fm(row.balance)}</td>
      </tr>
    `).join('');
  }

  function renderProfileModal(customer, ledger, uiState) {
    const availableCredit = Math.max((customer.creditLimit || 0) - (customer.outstandingBalance || 0), 0);

    const modal = window.UI.openModal({
      title: customer.name,
      maxWidth: '640px',
      bodyHtml: `
        <div class="kpi-grid" style="margin-bottom: var(--space-4)">
          <div class="kpi ${customer.outstandingBalance > 0 ? 'kpi-warning' : ''}">
            <div class="kpi-top"><span class="kpi-label">Outstanding</span></div>
            <div class="kpi-value">${fm(customer.outstandingBalance)}</div>
          </div>
          <div class="kpi">
            <div class="kpi-top"><span class="kpi-label">Credit limit</span></div>
            <div class="kpi-value">${fm(customer.creditLimit)}</div>
          </div>
          <div class="kpi kpi-success">
            <div class="kpi-top"><span class="kpi-label">Available credit</span></div>
            <div class="kpi-value">${fm(availableCredit)}</div>
          </div>
        </div>

        <div class="kv-grid" style="margin-bottom: var(--space-4)">
          <dt>Phone</dt><dd>${customer.phone ? esc(customer.phone) : '<span class="text-muted">Not set</span>'}</dd>
          <dt>Email</dt><dd>${customer.email ? esc(customer.email) : '<span class="text-muted">Not set</span>'}</dd>
          <dt>Address</dt><dd>${customer.address ? esc(customer.address) : '<span class="text-muted">Not set</span>'}</dd>
          <dt>Status</dt><dd><span class="badge ${STATUS_BADGE[customer.status] || 'badge-neutral'}">${esc(customer.status)}</span></dd>
        </div>

        <div style="display:flex; gap: var(--space-2); flex-wrap: wrap; margin-bottom: var(--space-4)">
          <button class="btn btn-secondary btn-sm" id="prof-edit-btn" data-requires-permission="customers.update">Edit details</button>
          <button class="btn btn-secondary btn-sm" id="prof-credit-btn" data-requires-permission="customers.update">Set credit limit</button>
          <button class="btn btn-primary btn-sm" id="prof-payment-btn" data-requires-permission="payments.view" ${customer.outstandingBalance > 0 ? '' : 'disabled title="Nothing outstanding"'}>Record payment</button>
        </div>

        <h4 class="detail-title" style="margin-top:0">Purchase & payment history</h4>
        <p class="text-xs text-muted" style="margin: -4px 0 var(--space-3)">
          Credit sales, payments, and adjustments only. Cash sales aren't tracked against a customer record in this version.
        </p>
        <div class="table-wrap flat">
          <table class="table">
            <thead><tr><th>Date</th><th>Type</th><th class="num">Debit</th><th class="num">Credit</th><th class="num">Balance</th></tr></thead>
            <tbody id="prof-ledger-body">${ledgerRows(ledger.items)}</tbody>
          </table>
        </div>
        <div style="text-align:center; margin-top: var(--space-3)" id="prof-ledger-more-wrap">
          ${ledger.page < ledger.pages ? '<button class="btn btn-ghost btn-sm" id="prof-ledger-more">Load more</button>' : ''}
        </div>
      `,
      footerHtml: `<button class="btn btn-secondary" data-action="close">Close</button>`,
    });

    modal.querySelector('[data-action="close"]').addEventListener('click', window.UI.closeModal);
    window.Permissions.applyPermissionGates(modal, user);

    modal.querySelector('#prof-edit-btn')?.addEventListener('click', () => openEditModal(customer, () => openCustomerProfile(customer._id)));
    modal.querySelector('#prof-credit-btn')?.addEventListener('click', () => openCreditLimitModal(customer, () => openCustomerProfile(customer._id)));
    modal.querySelector('#prof-payment-btn')?.addEventListener('click', () => openPaymentModal(customer, () => openCustomerProfile(customer._id)));

    modal.querySelector('#prof-ledger-more')?.addEventListener('click', async (e) => {
      const nextPage = uiState.ledgerPage + 1;
      window.UI.setButtonLoading(e.target, true, 'Loading…');
      try {
        const { data } = await window.Api.get(`/customers/${customer._id}/ledger`, { page: nextPage, limit: 15 });
        uiState.ledgerPage = nextPage;
        document.getElementById('prof-ledger-body').insertAdjacentHTML('beforeend', ledgerRows(data.items));
        document.getElementById('prof-ledger-more-wrap').innerHTML = data.page < data.pages ? '<button class="btn btn-ghost btn-sm" id="prof-ledger-more">Load more</button>' : '';
        modal.querySelector('#prof-ledger-more')?.addEventListener('click', () => {}); // re-bound on next renderProfileModal open if needed
      } catch (err) {
        window.UI.toast.error(err.message);
      }
    });
  }

  /* ------------------------------------------------------------------ *
   * Edit details
   * ------------------------------------------------------------------ */
  function openEditModal(customer, onSaved) {
    const modal = window.UI.openModal({
      title: `Edit - ${customer.name}`,
      bodyHtml: `
        <form id="customer-edit-form">
          ${customerFormFields(customer)}
          <div class="field">
            <label for="c-status">Status</label>
            <select class="select" id="c-status" name="status">
              <option value="active" ${customer.status === 'active' ? 'selected' : ''}>Active</option>
              <option value="inactive" ${customer.status === 'inactive' ? 'selected' : ''}>Inactive</option>
            </select>
          </div>
        </form>
      `,
      footerHtml: `<button class="btn btn-secondary" data-action="cancel">Cancel</button><button class="btn btn-primary" data-action="save" id="customer-edit-save">Save changes</button>`,
    });

    modal.querySelector('[data-action="cancel"]').addEventListener('click', window.UI.closeModal);
    modal.querySelector('[data-action="save"]').addEventListener('click', async () => {
      const form = modal.querySelector('#customer-edit-form');
      if (!form.reportValidity()) return;

      const raw = window.UI.serializeForm(form);
      ['phone', 'email', 'address', 'customerNumber'].forEach((k) => {
        if (typeof raw[k] === 'string') raw[k] = raw[k].trim();
        if (!raw[k]) delete raw[k];
      });
      raw.name = (raw.name || '').trim();

      const btn = document.getElementById('customer-edit-save');
      window.UI.setButtonLoading(btn, true, 'Saving…');
      try {
        await window.Api.put(`/customers/${customer._id}`, raw);
        window.UI.toast.success('Customer updated');
        window.UI.closeModal();
        fetchAndRender();
        onSaved?.();
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

  /* ------------------------------------------------------------------ *
   * Set credit limit ("approve" a customer for credit)
   * ------------------------------------------------------------------ */
  function openCreditLimitModal(customer, onSaved) {
    const modal = window.UI.openModal({
      title: `Credit limit - ${customer.name}`,
      bodyHtml: `
        <p class="text-sm text-secondary" style="margin-bottom: var(--space-4)">
          Currently owes <strong>${fm(customer.outstandingBalance)}</strong>. Setting a limit below that won't
          undo the existing balance - it only controls how much MORE credit they can take on.
        </p>
        <form id="credit-limit-form">
          <div class="field">
            <label for="cl-limit">New credit limit (KES)</label>
            <input class="input" id="cl-limit" name="creditLimit" type="number" step="0.01" min="0" required value="${customer.creditLimit || 0}" />
          </div>
        </form>
      `,
      footerHtml: `<button class="btn btn-secondary" data-action="cancel">Cancel</button><button class="btn btn-primary" data-action="save" id="credit-limit-save">Save limit</button>`,
    });

    modal.querySelector('[data-action="cancel"]').addEventListener('click', window.UI.closeModal);
    modal.querySelector('[data-action="save"]').addEventListener('click', async () => {
      const form = modal.querySelector('#credit-limit-form');
      if (!form.reportValidity()) return;
      const creditLimit = Number(window.UI.serializeForm(form).creditLimit);

      const btn = document.getElementById('credit-limit-save');
      window.UI.setButtonLoading(btn, true, 'Saving…');
      try {
        await window.Api.patch(`/customers/${customer._id}/credit-limit`, { creditLimit });
        window.UI.toast.success('Credit limit updated');
        window.UI.closeModal();
        fetchAndRender();
        onSaved?.();
      } catch (err) {
        window.UI.toast.error(err.message);
      } finally {
        window.UI.setButtonLoading(btn, false);
      }
    });
  }

  /* ------------------------------------------------------------------ *
   * Record a payment against outstanding balance
   * ------------------------------------------------------------------ */
  function openPaymentModal(customer, onSaved) {
    const branchId = window.AppShell.getActiveBranchId();
    const modal = window.UI.openModal({
      title: `Record payment - ${customer.name}`,
      bodyHtml: `
        <p class="text-sm text-secondary" style="margin-bottom: var(--space-4)">Outstanding balance: <strong>${fm(customer.outstandingBalance)}</strong></p>
        <form id="payment-form">
          <div class="field">
            <label for="pay-method">Method</label>
            <select class="select" id="pay-method" name="method">
              <option value="CASH">Cash</option>
              <option value="MPESA">M-PESA</option>
              <option value="CARD">Card</option>
              <option value="BANK">Bank transfer</option>
              <option value="OTHER">Other</option>
            </select>
          </div>
          <div class="field">
            <label for="pay-amount">Amount (KES)</label>
            <input class="input" id="pay-amount" name="amount" type="number" step="0.01" min="0.01" max="${customer.outstandingBalance}" required value="${customer.outstandingBalance || ''}" />
          </div>
          <div class="field">
            <label for="pay-reference">Reference / code <span class="text-muted">(optional)</span></label>
            <input class="input" id="pay-reference" name="reference" placeholder="Till number, transaction code, etc" />
          </div>
        </form>
      `,
      footerHtml: `<button class="btn btn-secondary" data-action="cancel">Cancel</button><button class="btn btn-primary" data-action="save" id="payment-save">Record payment</button>`,
    });

    modal.querySelector('[data-action="cancel"]').addEventListener('click', window.UI.closeModal);
    modal.querySelector('[data-action="save"]').addEventListener('click', async () => {
      const form = modal.querySelector('#payment-form');
      if (!form.reportValidity()) return;
      if (!branchId) {
        window.UI.toast.error('No active branch selected');
        return;
      }
      const raw = window.UI.serializeForm(form);
      if (typeof raw.reference === 'string') raw.reference = raw.reference.trim();
      if (!raw.reference) delete raw.reference;

      const btn = document.getElementById('payment-save');
      window.UI.setButtonLoading(btn, true, 'Recording…');
      try {
        await window.Api.post(`/customers/${customer._id}/payment`, {
          branchId, method: raw.method, amount: Number(raw.amount), reference: raw.reference,
        });
        window.UI.toast.success('Payment recorded');
        window.UI.closeModal();
        fetchAndRender();
        onSaved?.();
      } catch (err) {
        window.UI.toast.error(err.message);
      } finally {
        window.UI.setButtonLoading(btn, false);
      }
    });
  }
})();