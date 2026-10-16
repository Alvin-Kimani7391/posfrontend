/**
 * payables.js - Supplier payables: ageing, supplier invoices (record / match / approve variance),
 * payments allocated to invoices (oldest due first, or a chosen invoice), void payments, supplier statements.
 * All money on these endpoints is KES.
 */
(function () {
  const W = window.WS;
  const state = { tab: 'ageing', supplierId: '', pStatus: 'UNPAID', page: 1, payPage: 1, stFrom: '', stTo: '' };
  let contentEl, suppliers = [];
  const AGE = [['current', 'Not yet due', 0], ['days1to30', '1–30 days', 1], ['days31to60', '31–60 days', 2], ['days61to90', '61–90 days', 3], ['over90', '90+ days', 4]];
  const MATCH = { MATCHED: ['badge-success', 'Matched'], VARIANCE: ['badge-warning', 'Variance'], VARIANCE_APPROVED: ['badge-info', 'Variance approved'] };

  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    contentEl = window.AppShell.mount({ title: 'Supplier payables' });
    if (!contentEl) return;
    try { await window.AppShell.whenProfileReady?.(); } catch { /* cached */ }
    try { suppliers = (await window.Api.get('/suppliers', { limit: 100 })).data.items || []; } catch { suppliers = []; }
    contentEl.innerHTML = W.subnav('payables') + W.header('Supplier payables', 'What you owe suppliers: invoices, payments, statements and ageing.',
      `<button class="btn btn-primary" id="pay-new" data-requires-permission="purchases.pay">${W.icon('wallet')} Pay supplier</button>`) + `
      <div class="card"><div class="tabs" id="pt">
        <button class="tab-btn active" data-tab="ageing">Ageing</button><button class="tab-btn" data-tab="invoices">Invoices</button>
        <button class="tab-btn" data-tab="payments">Payments</button><button class="tab-btn" data-tab="statement">Statements</button></div><div id="pb"></div></div>`;
    contentEl.querySelector('#pay-new').addEventListener('click', () => payModal({}));
    contentEl.querySelectorAll('#pt .tab-btn').forEach((b) => b.addEventListener('click', () => {
      contentEl.querySelectorAll('#pt .tab-btn').forEach((x) => x.classList.toggle('active', x === b)); state.tab = b.dataset.tab; state.page = 1; render();
    }));
    window.Permissions.applyPermissionGates(contentEl, window.AppShell.getUser());
    render();
  }
  const body = () => contentEl.querySelector('#pb');
  const supOpts = (sel, blank) => `<option value="">${blank || 'All suppliers'}</option>` + suppliers.map((s) => `<option value="${s._id}" ${s._id === sel ? 'selected' : ''}>${W.esc(s.name)}</option>`).join('');
  function render() { ({ ageing: renderAgeing, invoices: renderInvoices, payments: renderPayments, statement: renderStatement })[state.tab](); }
  const gate = () => window.Permissions.applyPermissionGates(body(), window.AppShell.getUser());

  /* ---------------- ageing ---------------- */
  async function renderAgeing() {
    body().innerHTML = '<div class="ws-pad ws-muted-row">Loading…</div>';
    try {
      const { data } = await window.Api.get('/supplier-finance/ageing');
      const t = data.totals;
      body().innerHTML = `<div class="ws-pad">
        <dl class="mk-kv"><div><dt>Total payable</dt><dd style="font-size:var(--text-lg)">${W.kes(t.total)}</dd></div>${AGE.map(([k, l]) => `<div><dt>${l}</dt><dd>${W.kes(t[k])}</dd></div>`).join('')}</dl>
        <div class="ws-stack">${AGE.map(([k, , i]) => (t.total > 0 && t[k] > 0 ? `<i class="ws-age-${i}" style="width:${(t[k] / t.total) * 100}%"></i>` : '')).join('')}</div>
        <div class="ws-legend">${AGE.map(([, l, i]) => `<span><b class="ws-age-${i}"></b>${l}</span>`).join('')}</div></div>
        <div class="table-wrap"><table class="table"><thead><tr><th>Supplier</th>${AGE.map(([, l]) => `<th>${l}</th>`).join('')}<th>Total</th><th></th></tr></thead><tbody>
        ${data.suppliers.length ? data.suppliers.map((s) => `<tr data-id="${s.supplierId}"><td class="cell-primary">${W.esc(s.name || 'Supplier')}</td>${AGE.map(([k]) => `<td class="${s[k] > 0 ? '' : 'text-muted'}">${s[k] > 0 ? W.kes(s[k]) : '—'}</td>`).join('')}<td><strong>${W.kes(s.total)}</strong></td>
          <td class="actions"><button class="btn btn-ghost btn-sm" data-a="inv">Invoices</button><button class="btn btn-secondary btn-sm" data-a="pay" data-requires-permission="purchases.pay">Pay</button><button class="btn btn-ghost btn-sm" data-a="st">Statement</button></td></tr>`).join('') : W.emptyRow(8, 'Nothing owed to suppliers')}</tbody></table></div>`;
      body().querySelectorAll('tr[data-id]').forEach((tr) => {
        const id = tr.dataset.id;
        tr.querySelector('[data-a="inv"]').addEventListener('click', () => { state.supplierId = id; goTab('invoices'); });
        tr.querySelector('[data-a="st"]').addEventListener('click', () => { state.supplierId = id; goTab('statement'); });
        tr.querySelector('[data-a="pay"]').addEventListener('click', () => payModal({ supplierId: id }));
      });
      gate();
    } catch (e) { body().innerHTML = `<div class="ws-pad">${W.esc(e.message)}</div>`; }
  }
  const goTab = (t) => contentEl.querySelector(`#pt [data-tab="${t}"]`).click();

  /* ---------------- invoices ---------------- */
  function renderInvoices() {
    body().innerHTML = `<div class="ws-toolbar"><select class="select" id="i-sup">${supOpts(state.supplierId)}</select>
      <select class="select" id="i-st"><option value="">All</option><option value="UNPAID" ${state.pStatus === 'UNPAID' ? 'selected' : ''}>Unpaid</option><option value="PARTIAL" ${state.pStatus === 'PARTIAL' ? 'selected' : ''}>Part paid</option><option value="PAID" ${state.pStatus === 'PAID' ? 'selected' : ''}>Paid</option></select></div>` +
      W.tableShell(['Purchase', 'Supplier', 'Invoice #', 'Due', 'Total', 'Paid', 'Balance', 'Invoice check', ''], 9) + '<div class="pagination" id="pg"></div>';
    body().querySelector('#i-sup').addEventListener('change', (e) => { state.supplierId = e.target.value; state.page = 1; loadInvoices(); });
    body().querySelector('#i-st').addEventListener('change', (e) => { state.pStatus = e.target.value; state.page = 1; loadInvoices(); });
    loadInvoices();
  }
  async function loadInvoices() {
    const tb = body().querySelector('tbody');
    try {
      const { data } = await window.Api.get('/purchases', { page: state.page, limit: 12, supplierId: state.supplierId || undefined, paymentStatus: state.pStatus || undefined });
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
      W.pager(body().querySelector('#pg'), data, (pg) => { state.page = pg; loadInvoices(); });
      gate();
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
        window.UI.toast[data.purchase.invoiceMatchStatus === 'MATCHED' ? 'success' : 'warning'](data.purchase.invoiceMatchStatus === 'MATCHED' ? 'Invoice matches the purchase' : 'Recorded: there is a variance to approve'); render();
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
        window.UI.closeModal(); window.UI.toast.success('Variance approved'); render();
      } catch (err) { window.UI.setButtonLoading(ev.currentTarget, false); window.UI.toast.error(err.message); }
    });
  }

  /* ---------------- pay ---------------- */
  function payModal({ supplierId, purchase }) {
    const sup0 = suppliers.find((s) => s._id === supplierId);
    const m = window.UI.openModal({ title: purchase ? `Pay ${purchase.purchaseNumber}` : 'Pay supplier', maxWidth: '520px',
      bodyHtml: `<div class="field"><label>Supplier</label><select class="select" id="y-sup" ${purchase ? 'disabled' : ''}>${supOpts(supplierId, 'Choose supplier…')}</select><span class="field-hint" id="y-owed">${sup0 ? `We owe ${W.kes(sup0.currentBalance)}` : ''}</span></div>
        <div class="form-row"><div class="field"><label>Amount (KES)</label><input class="input" id="y-amt" type="number" min="0" step="any" value="${purchase ? purchase.balance : ''}" /></div>
          <div class="field"><label>Method</label><select class="select" id="y-m">${['CASH', 'MPESA', 'BANK', 'CHEQUE', 'OTHER'].map((x) => `<option>${x}</option>`).join('')}</select></div></div>
        <div class="form-row"><div class="field"><label>Reference</label><input class="input" id="y-ref" maxlength="100" placeholder="M-Pesa code, cheque no." /></div>
          <div class="field"><label>Paid on</label><input class="input" id="y-date" type="date" value="${new Date().toISOString().slice(0, 10)}" /></div></div>
        <div class="field"><label>Notes</label><input class="input" id="y-notes" maxlength="500" /></div>
        <p class="field-hint">${purchase ? 'Applied to this invoice only.' : 'Applied to the oldest due invoices first.'}</p>`,
      footerHtml: '<button class="btn btn-secondary" data-action="close">Cancel</button><button class="btn btn-primary" id="y-save">Record payment</button>' });
    W.bindClose(m);
    m.querySelector('#y-sup').addEventListener('change', (e) => { const s = suppliers.find((x) => x._id === e.target.value); m.querySelector('#y-owed').textContent = s ? `We owe ${W.kes(s.currentBalance)}` : ''; });
    m.querySelector('#y-save').addEventListener('click', async (ev) => {
      const sid = purchase ? (purchase.supplierId?._id || purchase.supplierId) : m.querySelector('#y-sup').value; const amount = Number(m.querySelector('#y-amt').value);
      if (!sid) return window.UI.toast.error('Choose a supplier'); if (!(amount > 0)) return window.UI.toast.error('Enter an amount');
      const b = { supplierId: sid, amount, method: m.querySelector('#y-m').value, reference: m.querySelector('#y-ref').value.trim() || undefined, paidAt: m.querySelector('#y-date').value || undefined, notes: m.querySelector('#y-notes').value.trim() || undefined };
      if (purchase) b.allocations = [{ purchaseId: purchase._id, amount }];
      window.UI.setButtonLoading(ev.currentTarget, true);
      try { const { data } = await window.Api.post('/supplier-finance/payments', b); window.UI.closeModal(); window.UI.toast.success(`Payment ${data.payment.paymentNumber} recorded`);
        try { suppliers = (await window.Api.get('/suppliers', { limit: 100 })).data.items || suppliers; } catch { /* keep */ } render();
      } catch (err) { window.UI.setButtonLoading(ev.currentTarget, false); window.UI.toast.error(err.message); }
    });
  }

  /* ---------------- payments ---------------- */
  function renderPayments() {
    body().innerHTML = `<div class="ws-toolbar"><select class="select" id="p-sup">${supOpts(state.supplierId)}</select></div>` +
      W.tableShell(['Payment #', 'Date', 'Supplier', 'Method', 'Reference', 'Amount', 'Status', ''], 8) + '<div class="pagination" id="pg"></div>';
    body().querySelector('#p-sup').addEventListener('change', (e) => { state.supplierId = e.target.value; state.payPage = 1; loadPayments(); });
    loadPayments();
  }
  async function loadPayments() {
    const tb = body().querySelector('tbody');
    try {
      const { data } = await window.Api.get('/supplier-finance/payments', { page: state.payPage, limit: 15, supplierId: state.supplierId || undefined });
      tb.innerHTML = data.items.length ? data.items.map((p) => `<tr data-id="${p._id}"><td class="cell-primary">${W.esc(p.paymentNumber)}</td><td class="text-sm">${window.UI.formatDate(p.paidAt)}</td><td class="text-sm">${W.esc(p.supplierId?.name || '—')}</td>
        <td class="text-sm">${W.esc(p.method)}</td><td class="text-sm">${W.esc(p.reference || '—')}</td><td><strong>${W.kes(p.amount)}</strong></td>
        <td><span class="badge ${p.status === 'VOIDED' ? 'badge-danger' : 'badge-success'}">${p.status === 'VOIDED' ? 'Voided' : 'Completed'}</span></td>
        <td class="actions">${p.status === 'COMPLETED' ? '<button class="btn btn-ghost btn-sm" data-a="void" data-requires-permission="purchases.pay">Void</button>' : ''}</td></tr>`).join('') : W.emptyRow(8, 'No payments yet');
      tb.querySelectorAll('[data-a="void"]').forEach((b) => b.addEventListener('click', () => voidPay(b.closest('tr').dataset.id)));
      W.pager(body().querySelector('#pg'), data, (pg) => { state.payPage = pg; loadPayments(); }); gate();
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
      try { await window.Api.post(`/supplier-finance/payments/${id}/void`, { reason }); window.UI.closeModal(); window.UI.toast.success('Payment voided'); loadPayments(); }
      catch (err) { window.UI.setButtonLoading(ev.currentTarget, false); window.UI.toast.error(err.message); }
    });
  }

  /* ---------------- statement ---------------- */
  function renderStatement() {
    body().innerHTML = `<div class="ws-toolbar"><select class="select" id="s-sup">${supOpts(state.supplierId, 'Choose supplier…')}</select>
      <input class="input" type="date" id="s-from" value="${state.stFrom}" /><input class="input" type="date" id="s-to" value="${state.stTo}" />
      <button class="btn btn-secondary btn-sm" id="s-print">${W.icon('printer')} Print</button></div><div id="s-out"><div class="ws-pad ws-muted-row">Choose a supplier to see the statement.</div></div>`;
    const go = () => { state.supplierId = body().querySelector('#s-sup').value; state.stFrom = body().querySelector('#s-from').value; state.stTo = body().querySelector('#s-to').value; loadStatement(); };
    ['#s-sup', '#s-from', '#s-to'].forEach((s) => body().querySelector(s).addEventListener('change', go));
    body().querySelector('#s-print').addEventListener('click', () => window.print());
    if (state.supplierId) loadStatement();
  }
  async function loadStatement() {
    const out = body().querySelector('#s-out'); if (!state.supplierId) { out.innerHTML = '<div class="ws-pad ws-muted-row">Choose a supplier to see the statement.</div>'; return; }
    out.innerHTML = '<div class="ws-pad ws-muted-row">Loading…</div>';
    try {
      const { data } = await window.Api.get(`/supplier-finance/suppliers/${state.supplierId}/statement`, { from: state.stFrom || undefined, to: state.stTo || undefined });
      out.innerHTML = `<div class="ws-pad"><h3 style="margin:0 0 var(--space-3)">${W.esc(data.supplier.name)}${data.supplier.paymentTerms ? ` <span class="text-muted text-sm">· ${W.esc(data.supplier.paymentTerms)}</span>` : ''}</h3>
        <dl class="mk-kv"><div><dt>Opening balance</dt><dd>${W.kes(data.openingBalance)}</dd></div><div><dt>Closing balance (we owe)</dt><dd>${W.kes(data.closingBalance)}</dd></div><div><dt>Outstanding invoices</dt><dd>${W.kes(data.outstandingInvoices)}</dd></div></dl></div>
        <div class="table-wrap"><table class="table"><thead><tr><th>Date</th><th>Type</th><th>Reference</th><th>Due</th><th>Invoiced</th><th>Paid</th><th>Balance</th></tr></thead><tbody>${data.lines.length ? data.lines.map((l) => `<tr><td class="text-sm">${window.UI.formatDate(l.date)}</td>
          <td><span class="badge ${l.type === 'INVOICE' ? 'badge-neutral' : 'badge-success'}">${l.type === 'INVOICE' ? 'Invoice' : 'Payment'}</span></td><td class="text-sm">${W.esc(l.reference || '')}${l.method ? ` <span class="text-muted">(${W.esc(l.method)})</span>` : ''}</td>
          <td class="text-sm">${l.dueDate ? window.UI.formatDate(l.dueDate) : '—'}</td><td>${l.debit ? W.kes(l.debit) : '—'}</td><td>${l.credit ? W.kes(l.credit) : '—'}</td><td><strong>${W.kes(l.balance)}</strong></td></tr>`).join('') : W.emptyRow(7, 'No activity in this period')}</tbody></table></div>`;
    } catch (e) { out.innerHTML = `<div class="ws-pad">${W.esc(e.message)}</div>`; }
  }
})();
