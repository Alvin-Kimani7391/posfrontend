/**
 * wholesale-suppliers.js - "Suppliers": ONE hybrid page that replaces Suppliers + Supplier payables.
 * suppliers.js mounts the shell and hands over here (window.WholesaleSuppliers.mount) when the business has the
 * multiWarehouse feature. payables.html redirects to suppliers.html?tab=payables.
 *
 * Tabs:   Suppliers (directory: add / edit, balance, terms)  |  Ageing  |  Invoices (record, match, approve variance, pay)
 *         Payments (void)  |  Statements (print)
 * Plus a supplier PROFILE (click a name): contact + terms, what you owe, ageing, open invoices, recent payments and
 * one-click Pay / Statement / New purchase / Edit, so the directory and the money side always work together.
 *
 * All money on these endpoints is KES. Deep links: suppliers.html?tab=ageing|invoices|payments|statements|payables
 */
(function (window) {
  'use strict';
  const W = window.WS;
  const TABS = [
    { key: 'suppliers',  label: 'Suppliers',  icon: 'truck',     perm: 'suppliers.view' },
    { key: 'ageing',     label: 'Ageing',     icon: 'dashboard', perm: 'purchases.view' },
    { key: 'invoices',   label: 'Invoices',   icon: 'bag',       perm: 'purchases.view' },
    { key: 'payments',   label: 'Payments',   icon: 'wallet',    perm: 'purchases.view' },
    { key: 'statements', label: 'Statements', icon: 'reports',   perm: 'purchases.view' },
  ];
  const AGE = [['current', 'Not yet due', 0], ['days1to30', '1–30 days', 1], ['days31to60', '31–60 days', 2], ['days61to90', '61–90 days', 3], ['over90', '90+ days', 4]];
  const MATCH = { MATCHED: ['badge-success', 'Matched'], VARIANCE: ['badge-warning', 'Variance'], VARIANCE_APPROVED: ['badge-info', 'Variance approved'] };

  const state = { tab: 'suppliers', search: '', status: '', page: 1, limit: 12, supplierId: '', pStatus: 'UNPAID', iPage: 1, payPage: 1, stFrom: '', stTo: '' };
  let el; let suppliers = []; let ageTotals = null; let canFin = false;
  const $ = (sel, root = el) => root.querySelector(sel);
  const body = () => $('#sp-body');
  const gate = (root) => window.Permissions.applyPermissionGates(root || el, window.AppShell.getUser());
  const supOpts = (sel, blank) => `<option value="">${blank || 'All suppliers'}</option>` + suppliers.map((s) => `<option value="${s._id}" ${String(s._id) === String(sel) ? 'selected' : ''}>${W.esc(s.name)}</option>`).join('');
  const initials = (n) => (String(n || '?').trim().split(/\s+/).slice(0, 2).map((x) => x[0]).join('') || '?').toUpperCase();

  /* ---------------------------------------------------------------- mount */
  async function mount(contentEl) {
    el = contentEl;
    canFin = W.can('purchases.view');
    const q = new URLSearchParams(window.location.search);
    const want = q.get('tab') === 'payables' ? 'ageing' : q.get('tab');
    const allowed = TABS.filter((t) => W.can(t.perm));
    state.tab = (allowed.find((t) => t.key === want) || allowed[0] || TABS[0]).key;
    if (q.get('supplierId')) state.supplierId = q.get('supplierId');

    el.innerHTML = `
      <div class="page-header">
        <div><h1>Suppliers</h1><p>Who you buy from, what you owe them, and every invoice and payment, in one place.</p></div>
        <div class="page-actions">
          <a class="btn btn-secondary" href="purchases.html" data-requires-permission="purchases.view">${W.icon('bag')} New purchase</a>
          <button class="btn btn-secondary" id="sp-pay" data-requires-permission="purchases.pay">${W.icon('wallet')} Pay supplier</button>
          <button class="btn btn-primary" id="sp-add" data-requires-permission="suppliers.create">${W.icon('plus')} Add supplier</button>
        </div>
      </div>
      <div id="sp-stats" class="hub-stats"></div>
      ${W.hubTabs(TABS, state.tab, 'sp-tabs')}
      <div class="card" id="sp-card"><div id="sp-body"></div></div>`;

    $('#sp-add').addEventListener('click', () => supplierModal());
    $('#sp-pay').addEventListener('click', () => payModal({}));
    $('#sp-tabs').querySelectorAll('.hub-tab').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));
    gate();
    await loadSuppliers();
    loadStats();
    render();
  }

  function setTab(t, extra = {}) {
    Object.assign(state, extra);
    state.tab = t; state.page = 1; state.iPage = 1; state.payPage = 1;
    $('#sp-tabs').querySelectorAll('.hub-tab').forEach((x) => x.classList.toggle('active', x.dataset.tab === t));
    try { const u = new URL(window.location.href); u.searchParams.set('tab', t); window.history.replaceState({}, '', u); } catch { /* ignore */ }
    render();
  }

  async function loadSuppliers() {
    try { suppliers = (await window.Api.get('/suppliers', { limit: 100 })).data.items || []; } catch { suppliers = []; }
  }

  async function loadStats() {
    const box = $('#sp-stats'); if (!box) return;
    const active = suppliers.filter((s) => s.status === 'active').length;
    let html = W.stat('Suppliers', W.num(suppliers.length), `${active} active`);
    if (canFin) {
      try {
        const { data } = await window.Api.get('/supplier-finance/ageing');
        ageTotals = data.totals;
        const t = ageTotals; const overdue = t.days1to30 + t.days31to60 + t.days61to90 + t.over90;
        html = W.stat('You owe suppliers', W.kes(t.total), `${(data.suppliers || []).length} supplier${(data.suppliers || []).length === 1 ? '' : 's'} waiting`, t.total > 0 ? 'warning' : 'success')
          + W.stat('Overdue', W.kes(overdue), overdue > 0 ? 'pay these first' : 'nothing late', overdue > 0 ? 'danger' : 'success')
          + W.stat('Not yet due', W.kes(t.current), 'within terms', 'info') + html;
      } catch { /* finance not available: show the directory count only */ }
    }
    box.innerHTML = html;
  }

  async function refreshAll() { await loadSuppliers(); loadStats(); render(); }
  function render() { ({ suppliers: renderDirectory, ageing: renderAgeing, invoices: renderInvoices, payments: renderPayments, statements: renderStatement })[state.tab](); }

  /* ---------------------------------------------------------------- directory */
  function renderDirectory() {
    body().innerHTML = `<div class="toolbar">
        <div class="toolbar-search input-group"><span class="input-group-icon">${W.icon('search')}</span><input class="input" id="d-search" placeholder="Search by name or phone" value="${W.esc(state.search)}" /></div>
      </div>` + W.tableShell(['Supplier', 'Contact', 'Payment terms', 'You owe', 'Status', ''], 6, 5) + '<div class="pagination" id="d-pg"></div>';
    $('#d-search', body()).addEventListener('input', window.UI.debounce((e) => { state.search = e.target.value.trim(); state.page = 1; loadDirectory(); }));
    loadDirectory();
  }
  async function loadDirectory() {
    const tb = $('tbody', body()); if (!tb) return;
    try {
      const { data } = await window.Api.get('/suppliers', { page: state.page, limit: state.limit, search: state.search });
      tb.innerHTML = data.items.length ? data.items.map((s) => `<tr data-id="${s._id}">
        <td><div class="sp-name"><button class="sp-link" data-a="open">${W.esc(s.name)}</button>${s.contactPerson ? `<span class="text-xs text-muted">${W.esc(s.contactPerson)}</span>` : ''}</div></td>
        <td class="text-sm">${s.phone ? `<a href="tel:${W.esc(s.phone)}">${W.esc(s.phone)}</a>` : '—'}${s.email ? `<div class="text-xs text-muted">${W.esc(s.email)}</div>` : ''}</td>
        <td class="text-sm">${W.esc(s.paymentTerms || '—')}</td>
        <td class="${s.currentBalance > 0 ? 'sp-owed' : 'text-muted'}">${s.currentBalance > 0 ? W.kes(s.currentBalance) : '—'}</td>
        <td><span class="badge ${s.status === 'active' ? 'badge-success' : 'badge-neutral'}">${W.esc(s.status)}</span></td>
        <td class="actions">
          ${s.currentBalance > 0 ? '<button class="btn btn-primary btn-sm" data-a="pay" data-requires-permission="purchases.pay">Pay</button>' : ''}
          <button class="btn btn-ghost btn-sm" data-a="open">Open</button>
          <button class="btn btn-ghost btn-sm btn-icon" data-a="edit" data-requires-permission="suppliers.update" title="Edit">${W.icon('edit')}</button>
        </td></tr>`).join('') : W.emptyRow(6, state.search ? 'No suppliers match your search' : 'No suppliers yet. Add your first supplier.');
      tb.querySelectorAll('tr[data-id]').forEach((tr) => {
        const s = data.items.find((x) => x._id === tr.dataset.id);
        tr.querySelectorAll('[data-a="open"]').forEach((b) => b.addEventListener('click', () => profile(s)));
        tr.querySelector('[data-a="pay"]')?.addEventListener('click', () => payModal({ supplierId: s._id }));
        tr.querySelector('[data-a="edit"]')?.addEventListener('click', () => supplierModal(s));
      });
      W.pager($('#d-pg', body()), data, (p) => { state.page = p; loadDirectory(); });
      gate(body());
    } catch (e) { tb.innerHTML = W.errRow(6, e); }
  }

  /* ---------------------------------------------------------------- supplier profile */
  async function profile(s) {
    const m = window.UI.openModal({ title: 'Supplier', maxWidth: '820px', bodyHtml: '<div class="ws-muted-row">Loading…</div>', footerHtml: '<button class="btn btn-secondary" data-action="close">Close</button>' });
    W.bindClose(m);
    const box = m.querySelector('.modal-body') || m;
    let invs = []; let pays = []; let age = null;
    if (canFin) {
      const [a, b, c, d] = await Promise.allSettled([
        window.Api.get('/purchases', { supplierId: s._id, paymentStatus: 'UNPAID', limit: 20 }),
        window.Api.get('/purchases', { supplierId: s._id, paymentStatus: 'PARTIAL', limit: 20 }),
        window.Api.get('/supplier-finance/payments', { supplierId: s._id, limit: 5 }),
        window.Api.get('/supplier-finance/ageing'),
      ]);
      invs = [...(a.value?.data?.items || []), ...(b.value?.data?.items || [])].sort((x, y) => new Date(x.dueDate || x.purchaseDate) - new Date(y.dueDate || y.purchaseDate));
      pays = c.value?.data?.items || [];
      age = (d.value?.data?.suppliers || []).find((x) => String(x.supplierId) === String(s._id)) || null;
    }
    const now = Date.now();
    box.innerHTML = `
      <div class="sp-head"><div class="sp-avatar">${W.esc(initials(s.name))}</div>
        <div><h3>${W.esc(s.name)} <span class="badge ${s.status === 'active' ? 'badge-success' : 'badge-neutral'}">${W.esc(s.status)}</span></h3>
          <p>${[s.contactPerson, s.phone, s.email].filter(Boolean).map(W.esc).join(' · ') || 'No contact details yet'}</p></div></div>
      <div class="sp-grid">
        <div><small>You owe</small><b class="${s.currentBalance > 0 ? 'sp-owed' : ''}">${W.kes(s.currentBalance)}</b></div>
        <div><small>Payment terms</small><b>${W.esc(s.paymentTerms || '—')}</b></div>
        <div><small>Tax PIN</small><b>${W.esc(s.taxPin || '—')}</b></div>
        <div><small>Address</small><b style="font-size:var(--text-sm)">${W.esc(s.address || '—')}</b></div>
      </div>
      ${age ? `<h4 class="sp-sec">Ageing</h4><div class="age-row">${AGE.map(([k, l, i]) => `<div class="age-cell a${i}"><small>${l}</small><b>${age[k] > 0 ? W.kes(age[k]) : '—'}</b></div>`).join('')}</div>` : ''}
      ${canFin ? `<h4 class="sp-sec">Open invoices</h4>
        ${invs.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Purchase</th><th>Invoice #</th><th>Due</th><th>Total</th><th>Balance</th></tr></thead><tbody>${invs.map((p) => { const due = p.dueDate || p.invoiceDate || p.purchaseDate; const over = p.balance > 0 && due && new Date(due).getTime() < now;
          return `<tr><td class="cell-primary">${W.esc(p.purchaseNumber)}</td><td class="text-sm">${W.esc(p.invoiceNumber || '—')}</td><td class="text-sm" style="${over ? 'color:var(--color-danger);font-weight:600' : ''}">${due ? window.UI.formatDate(due) : '—'}${over ? ' · overdue' : ''}</td><td>${W.kes(p.total)}</td><td><strong>${W.kes(p.balance)}</strong></td></tr>`; }).join('')}</tbody></table></div>` : '<div class="ws-muted-row">No unpaid invoices.</div>'}
        <h4 class="sp-sec">Recent payments</h4>
        ${pays.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Payment #</th><th>Date</th><th>Method</th><th>Amount</th><th>Status</th></tr></thead><tbody>${pays.map((p) => `<tr><td class="cell-primary">${W.esc(p.paymentNumber)}</td><td class="text-sm">${window.UI.formatDate(p.paidAt)}</td><td class="text-sm">${W.esc(p.method)}</td><td><strong>${W.kes(p.amount)}</strong></td><td><span class="badge ${p.status === 'VOIDED' ? 'badge-danger' : 'badge-success'}">${p.status === 'VOIDED' ? 'Voided' : 'Completed'}</span></td></tr>`).join('')}</tbody></table></div>` : '<div class="ws-muted-row">No payments yet.</div>'}` : ''}
      <div class="sp-actions">
        ${s.currentBalance > 0 ? '<button class="btn btn-primary" data-p="pay" data-requires-permission="purchases.pay">Pay supplier</button>' : ''}
        <button class="btn btn-secondary" data-p="inv" data-requires-permission="purchases.view">All invoices</button>
        <button class="btn btn-secondary" data-p="st" data-requires-permission="purchases.view">Statement</button>
        <a class="btn btn-secondary" href="purchases.html" data-requires-permission="purchases.view">New purchase</a>
        <button class="btn btn-ghost" data-p="edit" data-requires-permission="suppliers.update">${W.icon('edit')} Edit</button>
      </div>`;
    const close = () => window.UI.closeModal();
    box.querySelector('[data-p="pay"]')?.addEventListener('click', () => { close(); payModal({ supplierId: s._id }); });
    box.querySelector('[data-p="inv"]')?.addEventListener('click', () => { close(); setTab('invoices', { supplierId: s._id, pStatus: '' }); });
    box.querySelector('[data-p="st"]')?.addEventListener('click', () => { close(); setTab('statements', { supplierId: s._id }); });
    box.querySelector('[data-p="edit"]')?.addEventListener('click', () => { close(); supplierModal(s); });
    gate(box);
  }

  /* ---------------------------------------------------------------- add / edit supplier */
  function supplierModal(supplier) {
    const isEdit = !!supplier; const v = (k) => (isEdit ? W.esc(supplier[k] || '') : '');
    const modal = window.UI.openModal({
      title: isEdit ? 'Edit supplier' : 'Add supplier',
      bodyHtml: `<form id="supplier-form">
          <div class="field"><label>Name</label><input class="input" name="name" required value="${v('name')}" /></div>
          <div class="form-row"><div class="field"><label>Phone</label><input class="input" name="phone" value="${v('phone')}" /></div>
            <div class="field"><label>Email</label><input class="input" name="email" type="email" value="${v('email')}" /></div></div>
          <div class="field"><label>Contact person</label><input class="input" name="contactPerson" value="${v('contactPerson')}" /></div>
          <div class="field"><label>Payment terms</label><input class="input" name="paymentTerms" placeholder="e.g. Net 30" value="${v('paymentTerms')}" /></div>
          <div class="field"><label>Address</label><input class="input" name="address" value="${v('address')}" /></div>
          <div class="field"><label>Tax PIN</label><input class="input" name="taxPin" value="${v('taxPin')}" /></div>
        </form>`,
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
        if (isEdit) await window.Api.put(`/suppliers/${supplier._id}`, payload); else await window.Api.post('/suppliers', payload);
        window.UI.toast.success(isEdit ? 'Supplier updated' : 'Supplier added');
        window.UI.closeModal(); refreshAll();
      } catch (err) {
        if (err.code === 'VALIDATION_ERROR' && err.errors?.length) window.UI.applyFormErrors(form, err.errors); else window.UI.toast.error(err.message);
      } finally { window.UI.setButtonLoading(btn, false); }
    });
  }

  /* ---------------------------------------------------------------- ageing */
  async function renderAgeing() {
    body().innerHTML = '<div class="ws-pad ws-muted-row">Loading…</div>';
    try {
      const { data } = await window.Api.get('/supplier-finance/ageing');
      const t = data.totals;
      body().innerHTML = `<div class="ws-pad">
        <div class="age-row"><div class="age-cell"><small>Total payable</small><b style="font-size:var(--text-lg)">${W.kes(t.total)}</b></div>${AGE.map(([k, l, i]) => `<div class="age-cell a${i}"><small>${l}</small><b>${W.kes(t[k])}</b></div>`).join('')}</div>
        <div class="ws-stack">${AGE.map(([k, , i]) => (t.total > 0 && t[k] > 0 ? `<i class="ws-age-${i}" style="width:${(t[k] / t.total) * 100}%"></i>` : '')).join('')}</div>
        <div class="ws-legend">${AGE.map(([, l, i]) => `<span><b class="ws-age-${i}"></b>${l}</span>`).join('')}</div></div>
        <div class="table-wrap"><table class="table"><thead><tr><th>Supplier</th>${AGE.map(([, l]) => `<th>${l}</th>`).join('')}<th>Total</th><th></th></tr></thead><tbody>
        ${data.suppliers.length ? data.suppliers.map((s) => `<tr data-id="${s.supplierId}"><td class="cell-primary">${W.esc(s.name || 'Supplier')}</td>${AGE.map(([k]) => `<td class="${s[k] > 0 ? '' : 'text-muted'}">${s[k] > 0 ? W.kes(s[k]) : '—'}</td>`).join('')}<td><strong>${W.kes(s.total)}</strong></td>
          <td class="actions"><button class="btn btn-ghost btn-sm" data-a="open">Profile</button><button class="btn btn-ghost btn-sm" data-a="inv">Invoices</button><button class="btn btn-secondary btn-sm" data-a="pay" data-requires-permission="purchases.pay">Pay</button><button class="btn btn-ghost btn-sm" data-a="st">Statement</button></td></tr>`).join('') : W.emptyRow(8, 'Nothing owed to suppliers')}</tbody></table></div>`;
      body().querySelectorAll('tr[data-id]').forEach((tr) => {
        const id = tr.dataset.id;
        tr.querySelector('[data-a="open"]').addEventListener('click', () => { const s = suppliers.find((x) => String(x._id) === String(id)); if (s) profile(s); });
        tr.querySelector('[data-a="inv"]').addEventListener('click', () => setTab('invoices', { supplierId: id, pStatus: 'UNPAID' }));
        tr.querySelector('[data-a="st"]').addEventListener('click', () => setTab('statements', { supplierId: id }));
        tr.querySelector('[data-a="pay"]').addEventListener('click', () => payModal({ supplierId: id }));
      });
      gate(body());
    } catch (e) { body().innerHTML = `<div class="ws-pad">${window.UI.emptyStateHtml({ icon: 'alert', title: 'Could not load ageing', message: e.message })}</div>`; }
  }

  /* ---------------------------------------------------------------- invoices */
  function renderInvoices() {
    body().innerHTML = `<div class="ws-toolbar"><select class="select" id="i-sup">${supOpts(state.supplierId)}</select>
      <select class="select" id="i-st"><option value="">All</option><option value="UNPAID" ${state.pStatus === 'UNPAID' ? 'selected' : ''}>Unpaid</option><option value="PARTIAL" ${state.pStatus === 'PARTIAL' ? 'selected' : ''}>Part paid</option><option value="PAID" ${state.pStatus === 'PAID' ? 'selected' : ''}>Paid</option></select></div>` +
      W.tableShell(['Purchase', 'Supplier', 'Invoice #', 'Due', 'Total', 'Paid', 'Balance', 'Invoice check', ''], 9) + '<div class="pagination" id="i-pg"></div>';
    $('#i-sup', body()).addEventListener('change', (e) => { state.supplierId = e.target.value; state.iPage = 1; loadInvoices(); });
    $('#i-st', body()).addEventListener('change', (e) => { state.pStatus = e.target.value; state.iPage = 1; loadInvoices(); });
    loadInvoices();
  }
  async function loadInvoices() {
    const tb = $('tbody', body()); if (!tb) return;
    try {
      const { data } = await window.Api.get('/purchases', { page: state.iPage, limit: 12, supplierId: state.supplierId || undefined, paymentStatus: state.pStatus || undefined });
      const now = Date.now();
      tb.innerHTML = data.items.length ? data.items.map((p) => {
        const due = p.dueDate || p.invoiceDate || p.purchaseDate; const over = p.balance > 0 && due && new Date(due).getTime() < now;
        const m = MATCH[p.invoiceMatchStatus];
        return `<tr data-id="${p._id}"><td class="cell-primary">${W.esc(p.purchaseNumber)}</td><td class="text-sm">${W.esc(p.supplierId?.name || '—')}</td><td class="text-sm">${W.esc(p.invoiceNumber || '—')}</td>
          <td class="text-sm" style="${over ? 'color:var(--color-danger);font-weight:600' : ''}">${due ? window.UI.formatDate(due) : '—'}${over ? ' · overdue' : ''}</td>
          <td>${W.kes(p.total)}</td><td>${W.kes(p.amountPaid)}</td><td style="${p.balance > 0 ? 'font-weight:600;color:var(--color-warning)' : ''}">${W.kes(p.balance)}</td>
          <td>${m ? `<span class="badge ${m[0]}">${m[1]}</span>${p.invoiceVariance ? `<div class="text-xs text-muted">${p.invoiceVariance > 0 ? '+' : ''}${W.kes(p.invoiceVariance)}</div>` : ''}` : '<span class="text-muted text-xs">Not recorded</span>'}</td>
          <td class="actions"><button class="btn btn-ghost btn-sm" data-a="inv" data-requires-permission="purchases.pay">Invoice</button>
            ${p.invoiceMatchStatus === 'VARIANCE' ? '<button class="btn btn-secondary btn-sm" data-a="appr" data-requires-permission="purchases.pay">Approve</button>' : ''}
            ${p.balance > 0 ? '<button class="btn btn-primary btn-sm" data-a="pay" data-requires-permission="purchases.pay">Pay</button>' : ''}</td></tr>`;
      }).join('') : W.emptyRow(9, 'No purchases match');
      tb.querySelectorAll('tr[data-id]').forEach((tr) => {
        const p = data.items.find((x) => x._id === tr.dataset.id);
        tr.querySelector('[data-a="inv"]').addEventListener('click', () => invoiceModal(p));
        tr.querySelector('[data-a="appr"]')?.addEventListener('click', () => approveModal(p));
        tr.querySelector('[data-a="pay"]')?.addEventListener('click', () => payModal({ supplierId: p.supplierId?._id || p.supplierId, purchase: p }));
      });
      W.pager($('#i-pg', body()), data, (pg) => { state.iPage = pg; loadInvoices(); });
      gate(body());
    } catch (e) { tb.innerHTML = W.errRow(9, e); }
  }

  function invoiceModal(p) {
    const iso = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '');
    const m = window.UI.openModal({ title: `Supplier invoice · ${p.purchaseNumber}`, maxWidth: '520px',
      bodyHtml: `<p class="text-sm text-secondary">We ordered <strong>${W.kes(p.total)}</strong>. Enter what the supplier's invoice says; a difference needs approval before payment.</p>
        <div class="form-row"><div class="field"><label>Invoice number</label><input class="input" id="v-no" value="${W.esc(p.invoiceNumber || '')}" /></div>
          <div class="field"><label>Invoice total (KES)</label><input class="input" id="v-tot" type="number" min="0" step="any" value="${p.supplierInvoiceTotal ?? p.total}" /></div></div>
        <div class="form-row"><div class="field"><label>Invoice date</label><input class="input" id="v-date" type="date" value="${iso(p.invoiceDate || p.purchaseDate)}" /></div>
          <div class="field"><label>Due date</label><input class="input" id="v-due" type="date" value="${iso(p.dueDate)}" /></div></div>
        <div class="field"><label>Note</label><input class="input" id="v-note" maxlength="500" /></div>`,
      footerHtml: '<button class="btn btn-secondary" data-action="close">Cancel</button><button class="btn btn-primary" id="v-save">Save invoice</button>' });
    W.bindClose(m);
    m.querySelector('#v-save').addEventListener('click', async (ev) => {
      const tot = m.querySelector('#v-tot').value; if (tot === '' || Number(tot) < 0) return window.UI.toast.error('Enter the invoice total');
      const b = { supplierInvoiceTotal: Number(tot), invoiceNumber: m.querySelector('#v-no').value.trim() || undefined, invoiceDate: m.querySelector('#v-date').value || undefined, dueDate: m.querySelector('#v-due').value || undefined, note: m.querySelector('#v-note').value.trim() || undefined };
      window.UI.setButtonLoading(ev.currentTarget, true);
      try { const { data } = await window.Api.post(`/supplier-finance/purchases/${p._id}/invoice`, b); window.UI.closeModal();
        window.UI.toast[data.purchase.invoiceMatchStatus === 'MATCHED' ? 'success' : 'warning'](data.purchase.invoiceMatchStatus === 'MATCHED' ? 'Invoice matches the purchase' : 'Recorded: there is a variance to approve'); refreshAll();
      } catch (err) { window.UI.setButtonLoading(ev.currentTarget, false); window.UI.toast.error(err.message); }
    });
  }
  function approveModal(p) {
    const m = window.UI.openModal({ title: `Approve variance · ${p.purchaseNumber}`, maxWidth: '500px',
      bodyHtml: `<p class="text-sm">Ordered ${W.kes(p.total)} · invoiced ${W.kes(p.supplierInvoiceTotal)} · variance <strong>${p.invoiceVariance > 0 ? '+' : ''}${W.kes(p.invoiceVariance)}</strong></p>
        <div class="field"><label><input type="checkbox" id="a-adj" checked /> Change what we owe to follow the supplier's invoice</label><span class="field-hint">Untick to accept the difference without touching the books (e.g. a credit note settles it).</span></div>
        <div class="field"><label>Note</label><input class="input" id="a-note" maxlength="500" /></div>`,
      footerHtml: '<button class="btn btn-secondary" data-action="close">Cancel</button><button class="btn btn-primary" id="a-save">Approve</button>' });
    W.bindClose(m);
    m.querySelector('#a-save').addEventListener('click', async (ev) => {
      window.UI.setButtonLoading(ev.currentTarget, true);
      try { await window.Api.post(`/supplier-finance/purchases/${p._id}/invoice/approve`, { adjustPayable: m.querySelector('#a-adj').checked, note: m.querySelector('#a-note').value.trim() || undefined });
        window.UI.closeModal(); window.UI.toast.success('Variance approved'); refreshAll();
      } catch (err) { window.UI.setButtonLoading(ev.currentTarget, false); window.UI.toast.error(err.message); }
    });
  }

  /* ---------------------------------------------------------------- pay */
  function payModal({ supplierId, purchase }) {
    const sup0 = suppliers.find((s) => String(s._id) === String(supplierId));
    const m = window.UI.openModal({ title: purchase ? `Pay ${purchase.purchaseNumber}` : 'Pay supplier', maxWidth: '520px',
      bodyHtml: `<div class="field"><label>Supplier</label><select class="select" id="y-sup" ${purchase ? 'disabled' : ''}>${supOpts(supplierId, 'Choose supplier…')}</select><span class="field-hint" id="y-owed">${sup0 ? `We owe ${W.kes(sup0.currentBalance)}` : ''}</span></div>
        <div class="form-row"><div class="field"><label>Amount (KES)</label><input class="input" id="y-amt" type="number" min="0" step="any" value="${purchase ? purchase.balance : (sup0 && sup0.currentBalance > 0 ? sup0.currentBalance : '')}" /></div>
          <div class="field"><label>Method</label><select class="select" id="y-m">${['CASH', 'MPESA', 'BANK', 'CHEQUE', 'OTHER'].map((x) => `<option>${x}</option>`).join('')}</select></div></div>
        <div class="form-row"><div class="field"><label>Reference</label><input class="input" id="y-ref" maxlength="100" placeholder="M-Pesa code, cheque no." /></div>
          <div class="field"><label>Paid on</label><input class="input" id="y-date" type="date" value="${new Date().toISOString().slice(0, 10)}" /></div></div>
        <div class="field"><label>Notes</label><input class="input" id="y-notes" maxlength="500" /></div>
        <p class="field-hint">${purchase ? 'Applied to this invoice only.' : 'Applied to the oldest due invoices first.'}</p>`,
      footerHtml: '<button class="btn btn-secondary" data-action="close">Cancel</button><button class="btn btn-primary" id="y-save">Record payment</button>' });
    W.bindClose(m);
    m.querySelector('#y-sup').addEventListener('change', (e) => { const s = suppliers.find((x) => String(x._id) === e.target.value); m.querySelector('#y-owed').textContent = s ? `We owe ${W.kes(s.currentBalance)}` : ''; if (s && s.currentBalance > 0 && !purchase) m.querySelector('#y-amt').value = s.currentBalance; });
    m.querySelector('#y-save').addEventListener('click', async (ev) => {
      const sid = purchase ? (purchase.supplierId?._id || purchase.supplierId) : m.querySelector('#y-sup').value; const amount = Number(m.querySelector('#y-amt').value);
      if (!sid) return window.UI.toast.error('Choose a supplier'); if (!(amount > 0)) return window.UI.toast.error('Enter an amount');
      const b = { supplierId: sid, amount, method: m.querySelector('#y-m').value, reference: m.querySelector('#y-ref').value.trim() || undefined, paidAt: m.querySelector('#y-date').value || undefined, notes: m.querySelector('#y-notes').value.trim() || undefined };
      if (purchase) b.allocations = [{ purchaseId: purchase._id, amount }];
      window.UI.setButtonLoading(ev.currentTarget, true);
      try { const { data } = await window.Api.post('/supplier-finance/payments', b); window.UI.closeModal(); window.UI.toast.success(`Payment ${data.payment.paymentNumber} recorded`); refreshAll();
      } catch (err) { window.UI.setButtonLoading(ev.currentTarget, false); window.UI.toast.error(err.message); }
    });
  }

  /* ---------------------------------------------------------------- payments */
  function renderPayments() {
    body().innerHTML = `<div class="ws-toolbar"><select class="select" id="p-sup">${supOpts(state.supplierId)}</select></div>` +
      W.tableShell(['Payment #', 'Date', 'Supplier', 'Method', 'Reference', 'Amount', 'Status', ''], 8) + '<div class="pagination" id="p-pg"></div>';
    $('#p-sup', body()).addEventListener('change', (e) => { state.supplierId = e.target.value; state.payPage = 1; loadPayments(); });
    loadPayments();
  }
  async function loadPayments() {
    const tb = $('tbody', body()); if (!tb) return;
    try {
      const { data } = await window.Api.get('/supplier-finance/payments', { page: state.payPage, limit: 15, supplierId: state.supplierId || undefined });
      tb.innerHTML = data.items.length ? data.items.map((p) => `<tr data-id="${p._id}"><td class="cell-primary">${W.esc(p.paymentNumber)}</td><td class="text-sm">${window.UI.formatDate(p.paidAt)}</td><td class="text-sm">${W.esc(p.supplierId?.name || '—')}</td>
        <td class="text-sm">${W.esc(p.method)}</td><td class="text-sm">${W.esc(p.reference || '—')}</td><td><strong>${W.kes(p.amount)}</strong></td>
        <td><span class="badge ${p.status === 'VOIDED' ? 'badge-danger' : 'badge-success'}">${p.status === 'VOIDED' ? 'Voided' : 'Completed'}</span></td>
        <td class="actions">${p.status === 'COMPLETED' ? '<button class="btn btn-ghost btn-sm" data-a="void" data-requires-permission="purchases.pay">Void</button>' : ''}</td></tr>`).join('') : W.emptyRow(8, 'No payments yet');
      tb.querySelectorAll('[data-a="void"]').forEach((b) => b.addEventListener('click', () => voidPay(b.closest('tr').dataset.id)));
      W.pager($('#p-pg', body()), data, (pg) => { state.payPage = pg; loadPayments(); }); gate(body());
    } catch (e) { tb.innerHTML = W.errRow(8, e); }
  }
  function voidPay(id) {
    const m = window.UI.openModal({ title: 'Void payment', maxWidth: '460px',
      bodyHtml: '<p class="text-sm">This reverses the payment and puts the amount back on the invoices it paid.</p><div class="field"><label>Reason</label><input class="input" id="vd-r" maxlength="300" /></div>',
      footerHtml: '<button class="btn btn-secondary" data-action="close">Cancel</button><button class="btn btn-danger" id="vd-go">Void payment</button>' });
    W.bindClose(m);
    m.querySelector('#vd-go').addEventListener('click', async (ev) => {
      const reason = m.querySelector('#vd-r').value.trim(); if (!reason) return window.UI.toast.error('Give a reason');
      window.UI.setButtonLoading(ev.currentTarget, true);
      try { await window.Api.post(`/supplier-finance/payments/${id}/void`, { reason }); window.UI.closeModal(); window.UI.toast.success('Payment voided'); refreshAll(); }
      catch (err) { window.UI.setButtonLoading(ev.currentTarget, false); window.UI.toast.error(err.message); }
    });
  }

  /* ---------------------------------------------------------------- statements */
  function renderStatement() {
    body().innerHTML = `<div class="ws-toolbar"><select class="select" id="s-sup">${supOpts(state.supplierId, 'Choose supplier…')}</select>
      <input class="input" type="date" id="s-from" value="${state.stFrom}" aria-label="From" /><input class="input" type="date" id="s-to" value="${state.stTo}" aria-label="To" />
      <button class="btn btn-secondary btn-sm" id="s-print">${W.icon('printer')} Print</button></div><div id="s-out"><div class="ws-pad ws-muted-row">Choose a supplier to see the statement.</div></div>`;
    const go = () => { state.supplierId = $('#s-sup', body()).value; state.stFrom = $('#s-from', body()).value; state.stTo = $('#s-to', body()).value; loadStatement(); };
    ['#s-sup', '#s-from', '#s-to'].forEach((s) => $(s, body()).addEventListener('change', go));
    $('#s-print', body()).addEventListener('click', () => window.print());
    if (state.supplierId) loadStatement();
  }
  async function loadStatement() {
    const out = $('#s-out', body()); if (!out) return;
    if (!state.supplierId) { out.innerHTML = '<div class="ws-pad ws-muted-row">Choose a supplier to see the statement.</div>'; return; }
    out.innerHTML = '<div class="ws-pad ws-muted-row">Loading…</div>';
    try {
      const { data } = await window.Api.get(`/supplier-finance/suppliers/${state.supplierId}/statement`, { from: state.stFrom || undefined, to: state.stTo || undefined });
      out.innerHTML = `<div class="ws-pad"><h3 style="margin:0 0 var(--space-3)">${W.esc(data.supplier.name)}${data.supplier.paymentTerms ? ` <span class="text-muted text-sm">· ${W.esc(data.supplier.paymentTerms)}</span>` : ''}</h3>
        <dl class="mk-kv"><div><dt>Opening balance</dt><dd>${W.kes(data.openingBalance)}</dd></div><div><dt>Closing balance (we owe)</dt><dd>${W.kes(data.closingBalance)}</dd></div><div><dt>Outstanding invoices</dt><dd>${W.kes(data.outstandingInvoices)}</dd></div></dl></div>
        <div class="table-wrap"><table class="table"><thead><tr><th>Date</th><th>Type</th><th>Reference</th><th>Due</th><th>Invoiced</th><th>Paid</th><th>Balance</th></tr></thead><tbody>${data.lines.length ? data.lines.map((l) => `<tr><td class="text-sm">${window.UI.formatDate(l.date)}</td>
          <td><span class="badge ${l.type === 'INVOICE' ? 'badge-neutral' : 'badge-success'}">${l.type === 'INVOICE' ? 'Invoice' : 'Payment'}</span></td><td class="text-sm">${W.esc(l.reference || '')}${l.method ? ` <span class="text-muted">(${W.esc(l.method)})</span>` : ''}</td>
          <td class="text-sm">${l.dueDate ? window.UI.formatDate(l.dueDate) : '—'}</td><td>${l.debit ? W.kes(l.debit) : '—'}</td><td>${l.credit ? W.kes(l.credit) : '—'}</td><td><strong>${W.kes(l.balance)}</strong></td></tr>`).join('') : W.emptyRow(7, 'No activity in this period')}</tbody></table></div>`;
    } catch (e) { out.innerHTML = `<div class="ws-pad">${window.UI.emptyStateHtml({ icon: 'alert', title: 'Could not load the statement', message: e.message })}</div>`; }
  }

  window.WholesaleSuppliers = { mount };
})(window);
