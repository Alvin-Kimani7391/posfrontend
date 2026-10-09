/**
 * billing.js - the shop owner's billing page.
 * Plan + phase progress, arrears, upcoming invoice, pay by M-PESA prompt (STK) or by pasting the M-PESA SMS,
 * outstanding invoices, invoice + payment history. All API money is integer cents.
 *
 * This page still works when the account is LOCKED (the backend lets /billing/* through), which is the point:
 * a locked owner can always get here and pay.
 */
(function () {
  const esc = window.UI.escapeHtml;
  const fm = (c) => window.UI.formatMoney((Number(c) || 0) / 100);
  const $ = (id) => document.getElementById(id);

  const SUB_BADGE = { TRIALING: 'badge-info', ACTIVE: 'badge-success', PAST_DUE: 'badge-warning', SUSPENDED: 'badge-danger', CANCELLED: 'badge-neutral' };
  const SUB_LABEL = { TRIALING: 'Free trial', ACTIVE: 'Active', PAST_DUE: 'Payment overdue', SUSPENDED: 'Locked', CANCELLED: 'Cancelled' };
  const INV_BADGE = { PENDING: 'badge-warning', PARTIAL: 'badge-warning', PAID: 'badge-success', VOID: 'badge-neutral' };
  const INV_LABEL = { PENDING: 'Unpaid', PARTIAL: 'Part-paid', PAID: 'Paid', VOID: 'Void' };
  const PAY_BADGE = { PENDING: 'badge-info', SUBMITTED: 'badge-warning', SUCCESS: 'badge-success', FAILED: 'badge-danger', REJECTED: 'badge-danger', CANCELLED: 'badge-neutral' };
  const PAY_LABEL = { PENDING: 'Waiting', SUBMITTED: 'Awaiting verification', SUCCESS: 'Received', FAILED: 'Failed', REJECTED: 'Not approved', CANCELLED: 'Cancelled' };
  const METHOD_LABEL = { STK: 'M-PESA prompt', MPESA_MANUAL: 'M-PESA (manual)', CASH: 'Cash', BANK: 'Bank', OTHER: 'Other' };
  const FAIL_LABELS = {
    wrong_pin: 'Wrong PIN entered', insufficient_funds: 'Insufficient M-PESA balance', cancelled: 'Cancelled on the phone',
    timeout: 'No response in time', in_progress: 'Another request already pending', system_error: 'M-PESA system error',
    bad_credentials: 'Online payment is not configured correctly', rate_limited: 'Too many requests - try again shortly',
    wallet_empty: 'Online payment is temporarily unavailable', send_failed: 'Could not reach M-PESA', failed: 'Payment failed',
  };
  const PHONE_KEY = 'sixstar.billing.phone';

  const state = { data: null, tab: 'invoices', invPage: 1, payPage: 1, pollTimer: null };
  let contentEl;
  let user;

  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    contentEl = window.AppShell.mount({ title: 'Billing' });
    if (!contentEl) return;
    user = window.AppShell.getUser();
    contentEl.innerHTML = `
      <div class="page-header">
        <div><h1>Billing & subscription</h1><p>Your plan, what is due, and your payment history.</p></div>
        <div class="page-actions"><button class="btn btn-secondary btn-sm" id="bl-refresh">Refresh</button></div>
      </div>
      <div id="bl-body"></div>`;
    $('bl-refresh').addEventListener('click', () => load());
    window.addEventListener('beforeunload', stopPoll);
    await load();
  }

  /* ------------------------------ helpers ------------------------------ */
  const fdate = (d) => (d ? window.UI.formatDate(d) : '-');
  const card = (title, inner, right = '') =>
    `<div class="card bl-card-gap"><div class="card-header"><h2>${title}</h2>${right}</div><div class="card-body">${inner}</div></div>`;
  const kv = (k, v) => `<div class="bl-kv"><span>${esc(k)}</span><span>${v}</span></div>`;
  const alert = (tone, title, text, extra = '') =>
    `<div class="bl-alert ${tone}"><div class="grow"><b>${esc(title)}</b> ${esc(text)}</div>${extra}</div>`;
  const methodUnit = (m) => (m === 'SALES_VALUE' ? 'in sales' : 'sales');

  /* ------------------------------- loading ------------------------------- */
  async function load() {
    stopPoll();
    const body = $('bl-body');
    if (!window.Permissions.can(user, 'billing.view')) return renderRestricted(body);
    body.innerHTML = window.UI.skeletonRows(3, 1);
    try {
      const { data } = await window.Api.get('/billing/overview');
      state.data = data;
      render(body, data);
    } catch (err) {
      body.innerHTML = window.UI.emptyStateHtml({ icon: 'alert', title: 'Could not load billing', message: err.message });
    }
  }

  async function renderRestricted(body) {
    let s = null;
    try { ({ data: s } = await window.Api.get('/billing/status')); } catch { /* ignore */ }
    const locked = s && s.locked;
    body.innerHTML = `<div class="card">${window.UI.emptyStateHtml({
      icon: locked ? 'alert' : 'check',
      title: locked ? 'This account is locked' : 'Billing is managed by the business owner',
      message: locked
        ? 'The account has an unpaid balance. Please ask the business owner to open the Billing page and pay.'
        : 'You do not have access to billing details.',
    })}</div>`;
  }

  /* -------------------------------- render -------------------------------- */
  function render(body, d) {
    if (!d.enabled) {
      body.innerHTML = alert('info', 'Billing is not active yet.', 'You are not being charged and nothing is due.');
      return;
    }
    if (!d.subscription) {
      const c = d.contact || {};
      body.innerHTML = alert('warning', 'No subscription found for this business.',
        `Please contact support${c.supportPhone ? ` on ${c.supportPhone}` : ''}${c.supportEmail ? ` or ${c.supportEmail}` : ''}.`);
      return;
    }
    const s = d.subscription;
    const parts = [];

    if (s.lock.active) {
      parts.push(alert('danger', 'Your account is locked.',
        s.lock.reason === 'ADMIN'
          ? 'It was locked by the administrator. Contact support, or pay any balance below.'
          : `An overdue balance of ${fm(s.arrearsCents)} is unpaid. Pay below and access is restored automatically.`));
    } else if (s.arrearsCents > 0) {
      parts.push(alert('danger', `${fm(s.arrearsCents)} is overdue.`,
        s.lockAt ? `Your account will be locked on ${fdate(s.lockAt)} if it stays unpaid. Part-payments are accepted.` : 'Please pay as soon as you can.'));
    } else if (s.status === 'TRIALING') {
      const days = Math.max(Math.ceil((new Date(s.trialEndsAt) - Date.now()) / 86400000), 0);
      parts.push(alert('info', `Free trial - ${days} day${days === 1 ? '' : 's'} left.`, `Your trial ends on ${fdate(s.trialEndsAt)}. Your first invoice is issued then.`));
    }

    parts.push(`
      <div class="bl-stats">
        <div class="bl-stat ${s.arrearsCents > 0 ? 'danger' : ''}"><span class="l">Overdue</span><span class="v">${fm(s.arrearsCents)}</span><span class="s">${s.arrearsCents > 0 ? 'Pay to avoid a lock' : 'Nothing overdue'}</span></div>
        <div class="bl-stat"><span class="l">Open balance</span><span class="v">${fm(s.openBalanceCents)}</span><span class="s">All unpaid invoices</span></div>
        <div class="bl-stat ${s.creditCents > 0 ? 'success' : ''}"><span class="l">Account credit</span><span class="v">${fm(s.creditCents)}</span><span class="s">Applied to your next invoice</span></div>
        <div class="bl-stat"><span class="l">Total paid</span><span class="v">${fm(s.totalPaidCents)}</span><span class="s">${s.lastPaymentAt ? `Last: ${fdate(s.lastPaymentAt)}` : 'No payments yet'}</span></div>
      </div>`);

    parts.push(`<div class="bl-grid-2">${planCard(d, s)}${upcomingCard(d)}</div>`);
    if (d.pricing) parts.push(pricingCard(d.pricing));
    if (d.openInvoices.length) parts.push(openInvoicesCard(d.openInvoices));
    parts.push(payCard(d, s));
    if (d.pendingPayments.length) parts.push(pendingCard(d.pendingPayments));
    parts.push(card('History', `
      <div class="tabs" id="bl-tabs" style="margin-bottom:var(--space-4)">
        <button class="tab-btn ${state.tab === 'invoices' ? 'active' : ''}" data-tab="invoices">Invoices</button>
        <button class="tab-btn ${state.tab === 'payments' ? 'active' : ''}" data-tab="payments">Payments</button>
      </div>
      <div id="bl-hist"></div>
      <div class="pagination" id="bl-hist-pag"></div>`));

    body.innerHTML = parts.join('');
    bindAll(d, s);
    loadHistory();
    resumePendingStk(d.pendingPayments);
  }

  function planCard(d, s) {
    const ph = s.phase;
    const setup = d.setup;
    const pct = setup && setup.totalCents ? Math.min(100, Math.round((setup.paidCents / setup.totalCents) * 100)) : 0;
    return card('Your plan', `
      ${kv('Plan', esc(s.planName || '-'))}
      ${kv('Status', `<span class="badge ${SUB_BADGE[s.status] || 'badge-neutral'}">${esc(SUB_LABEL[s.status] || s.status)}</span>`)}
      ${ph ? kv('Current phase', esc(ph.name)) : kv('Current phase', 'Plan complete')}
      ${ph ? kv('Phase started', fdate(ph.startedAt)) : ''}
      ${ph ? kv('Phase ends', ph.endsAt ? fdate(ph.endsAt) : 'Ongoing') : ''}
      ${setup ? `
        <div style="margin-top:var(--space-4)">
          <div class="bl-kv" style="border:none;padding-bottom:0"><span>Setup payment progress</span><span>${fm(setup.paidCents)} of ${fm(setup.totalCents)}</span></div>
          <div class="bl-progress"><i style="width:${pct}%"></i></div>
          <div class="bl-muted">${setup.instalments} monthly instalments · ${fm(setup.issuedCents)} invoiced so far</div>
        </div>` : ''}`);
  }

  function upcomingCard(d) {
    const u = d.upcoming;
    let inner = '<p class="text-sm text-secondary">Nothing is scheduled.</p>';
    if (u && u.type === 'INVOICE') {
      inner = `
        ${kv('Next invoice', esc(u.description))}
        ${kv(u.estimated ? 'Estimated amount' : 'Amount', fm(u.amountCents))}
        ${kv('Due', fdate(u.at))}
        ${u.meta && u.meta.tierLabel ? kv('Current tier', `${esc(u.meta.tierLabel)} (${Number(u.meta.value || 0).toLocaleString()} ${methodUnit(u.meta.metric)} last month)`) : ''}
        ${u.estimated ? '<p class="bl-muted" style="margin-top:var(--space-3)">Estimate only. The final amount is set on the invoice date from your activity in the month before.</p>' : ''}`;
    } else if (u && u.type === 'TRIAL_END') {
      inner = `${kv('Free trial ends', fdate(u.at))}<p class="bl-muted" style="margin-top:var(--space-3)">${u.nextPhaseName ? `Next: ${esc(u.nextPhaseName)}. Your first invoice is issued then.` : ''}</p>`;
    } else if (u && u.type === 'PHASE_CHANGE') {
      inner = `${kv('Next phase', esc(u.nextPhaseName || 'End of plan'))}${kv('Starts', fdate(u.at))}`;
    }
    return card('Coming up', inner);
  }

  function pricingCard(p) {
    const rows = (p.tiers || []).map((t) => {
      const upTo = t.upTo == null ? 'Above that' : `Up to ${p.metric === 'SALES_VALUE' ? fm(t.upTo) : Number(t.upTo).toLocaleString()}`;
      return `<tr><td>${esc(t.label || '-')}</td><td>${upTo} ${methodUnit(p.metric)} / month</td><td class="bl-right font-semibold">${fm(t.amountCents)}</td></tr>`;
    }).join('');
    return card('Monthly maintenance pricing',
      `<p class="text-sm text-secondary" style="margin-bottom:var(--space-3)">Your monthly fee depends on your ${p.metric === 'SALES_VALUE' ? 'sales value' : 'number of sales'} in the previous month.</p>
       <div class="table-wrap flat"><table class="table"><thead><tr><th>Tier</th><th>Usage</th><th class="bl-right">Fee</th></tr></thead><tbody>${rows}</tbody></table></div>`);
  }

  function openInvoicesCard(list) {
    const rows = list.map((i) => `
      <tr>
        <td class="cell-primary">${esc(i.number)}</td>
        <td class="text-sm">${esc(i.description)}</td>
        <td class="text-sm">${fdate(i.dueDate)} ${i.overdue ? '<span class="badge badge-danger">Overdue</span>' : ''}</td>
        <td class="bl-right font-semibold">${fm(i.balanceCents)}</td>
        <td class="actions"><button class="btn btn-secondary btn-sm" data-pay-invoice="${Math.ceil(i.balanceCents / 100)}">Pay</button></td>
      </tr>`).join('');
    return card('Outstanding invoices', `<div class="table-wrap flat"><table class="table"><thead><tr><th>Invoice</th><th>Description</th><th>Due</th><th class="bl-right">Balance</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
      <p class="bl-muted" style="margin-top:var(--space-3)">Payments are applied to the oldest invoice first. Anything extra is kept as credit for the next invoice.</p>`);
  }

  function payCard(d, s) {
    if (!window.Permissions.can(user, 'billing.pay')) {
      return card('Make a payment', '<p class="text-sm text-secondary">You can view billing but not pay. Ask the business owner to make payments.</p>');
    }
    const opts = d.paymentOptions || {};
    const stk = !!(opts.stk && opts.stk.available);
    const man = !!(opts.manual && opts.manual.available);
    if (!stk && !man) {
      const c = d.contact || {};
      return card('Make a payment', `<p class="text-sm text-secondary">Online payment is not available right now. Please contact support${c.supportPhone ? ` on <strong>${esc(c.supportPhone)}</strong>` : ''}.</p>`);
    }
    const due = s.arrearsCents > 0 ? s.arrearsCents : s.openBalanceCents;
    const dueKes = due > 0 ? Math.ceil(due / 100) : '';
    const chips = [];
    if (s.arrearsCents > 0) chips.push(`<button type="button" class="bl-chip" data-amt="${Math.ceil(s.arrearsCents / 100)}">Overdue · ${fm(s.arrearsCents)}</button>`);
    if (s.openBalanceCents > 0 && s.openBalanceCents !== s.arrearsCents) chips.push(`<button type="button" class="bl-chip" data-amt="${Math.ceil(s.openBalanceCents / 100)}">Full balance · ${fm(s.openBalanceCents)}</button>`);
    let savedPhone = '';
    try { savedPhone = localStorage.getItem(PHONE_KEY) || ''; } catch { /* ignore */ }
    const m = opts.manual || {};

    return `
      <div class="card bl-card-gap" id="bl-pay">
        <div class="card-header"><h2>Make a payment</h2></div>
        <div class="card-body">
          ${due > 0 ? '' : '<p class="text-sm text-secondary" style="margin-bottom:var(--space-3)">Nothing is due right now. You can still pay in advance - it is kept as credit.</p>'}
          <div class="tabs" id="bl-methods" style="margin-bottom:var(--space-4)">
            ${stk ? '<button class="tab-btn active" data-method="stk">M-PESA prompt (STK)</button>' : ''}
            ${man ? `<button class="tab-btn ${stk ? '' : 'active'}" data-method="manual">Pay manually & paste the M-PESA message</button>` : ''}
          </div>

          ${stk ? `
          <div id="bl-pane-stk">
            <div class="form-row">
              <div class="field"><label for="bl-stk-phone">M-PESA phone number</label><input class="input" id="bl-stk-phone" inputmode="tel" placeholder="07XXXXXXXX" value="${esc(savedPhone)}" /></div>
              <div class="field"><label for="bl-stk-amount">Amount (KES, whole shillings)</label><input class="input" id="bl-stk-amount" type="number" inputmode="numeric" min="1" step="1" value="${dueKes}" /></div>
            </div>
            <div class="bl-chips">${chips.join('')}</div>
            <button class="btn btn-success" id="bl-stk-send">Send payment prompt</button>
            <div id="bl-stk-status"></div>
          </div>` : ''}

          ${man ? `
          <div id="bl-pane-manual" style="${stk ? 'display:none' : ''}">
            <div class="bl-instr">
              <div><span>${esc(m.label || 'Pay to')}</span><strong>${esc(m.number || '-')}</strong></div>
              ${m.accountName ? `<div><span>Name</span><strong>${esc(m.accountName)}</strong></div>` : ''}
              ${m.accountReference ? `<div><span>Account / reference</span><strong>${esc(m.accountReference)}</strong></div>` : ''}
              ${m.phone ? `<div><span>Phone</span><strong>${esc(m.phone)}</strong></div>` : ''}
              ${m.instructions ? `<p>${esc(m.instructions)}</p>` : ''}
            </div>
            <div class="field"><label for="bl-man-msg">Paste the full M-PESA confirmation message</label>
              <textarea class="textarea" id="bl-man-msg" rows="4" placeholder="e.g. UJK1A2B3C4 Confirmed. Ksh5,000.00 paid to ..."></textarea></div>
            <div class="field" style="max-width:260px"><label for="bl-man-amount">Amount paid (KES) <span class="text-muted">(read from the message if possible)</span></label>
              <input class="input" id="bl-man-amount" type="number" inputmode="decimal" min="1" step="0.01" /></div>
            <div class="bl-chips">${chips.join('')}</div>
            <button class="btn btn-primary" id="bl-man-send">Submit for verification</button>
            <p class="bl-muted" style="margin-top:var(--space-2)">We check this against our M-PESA statement and credit your account once verified - usually within a few hours.</p>
          </div>` : ''}
        </div>
      </div>`;
  }

  function pendingCard(list) {
    const rows = list.map((p) => `
      <tr>
        <td class="text-sm">${window.UI.formatDateTime(p.createdAt)}</td>
        <td class="text-sm">${esc(METHOD_LABEL[p.method] || p.method)}</td>
        <td class="text-sm">${esc(p.mpesaReceiptNumber || p.reference)}</td>
        <td class="bl-right font-semibold">${fm(p.claimedAmount || p.amount)}</td>
        <td><span class="badge ${PAY_BADGE[p.status] || 'badge-neutral'}">${esc(PAY_LABEL[p.status] || p.status)}</span></td>
      </tr>`).join('');
    return card('Waiting for confirmation', `<div class="table-wrap flat"><table class="table"><thead><tr><th>Date</th><th>Method</th><th>Reference</th><th class="bl-right">Amount</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table></div>`);
  }

  /* -------------------------------- events -------------------------------- */
  function bindAll(d, s) {
    $('bl-tabs')?.addEventListener('click', (e) => {
      const b = e.target.closest('[data-tab]');
      if (!b) return;
      state.tab = b.dataset.tab;
      document.querySelectorAll('#bl-tabs .tab-btn').forEach((x) => x.classList.toggle('active', x === b));
      loadHistory();
    });

    document.querySelectorAll('#bl-methods [data-method]').forEach((b) => b.addEventListener('click', () => {
      document.querySelectorAll('#bl-methods .tab-btn').forEach((x) => x.classList.toggle('active', x === b));
      const stk = $('bl-pane-stk'); const man = $('bl-pane-manual');
      if (stk) stk.style.display = b.dataset.method === 'stk' ? '' : 'none';
      if (man) man.style.display = b.dataset.method === 'manual' ? '' : 'none';
    }));

    document.querySelectorAll('#bl-pay .bl-chip').forEach((c) => c.addEventListener('click', () => {
      const stkVisible = $('bl-pane-stk') && $('bl-pane-stk').style.display !== 'none';
      const input = stkVisible ? $('bl-stk-amount') : $('bl-man-amount');
      if (input) input.value = c.dataset.amt;
    }));

    document.querySelectorAll('[data-pay-invoice]').forEach((b) => b.addEventListener('click', () => {
      const pay = $('bl-pay');
      if (!pay) return;
      const stkBtn = document.querySelector('#bl-methods [data-method="stk"]');
      if (stkBtn) stkBtn.click();
      const input = $('bl-stk-amount') || $('bl-man-amount');
      if (input) input.value = b.dataset.payInvoice;
      pay.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }));

    $('bl-stk-send')?.addEventListener('click', sendStk);

    const msg = $('bl-man-msg');
    msg?.addEventListener('input', () => {
      const amt = $('bl-man-amount');
      const m = msg.value.match(/(?:Ksh|KES)\.?\s?([\d,]+(?:\.\d{1,2})?)/i);
      if (m && amt && !amt.dataset.touched) amt.value = parseFloat(m[1].replace(/,/g, ''));
    });
    $('bl-man-amount')?.addEventListener('input', (e) => { e.target.dataset.touched = '1'; });
    $('bl-man-send')?.addEventListener('click', sendManual);
  }

  /* ----------------------------- STK payment ----------------------------- */
  function showStatus(tone, label, message, retry) {
    const el = $('bl-stk-status');
    if (!el) return;
    const cls = { pending: 'badge-info', error: 'badge-danger', warning: 'badge-warning', success: 'badge-success' }[tone] || 'badge-neutral';
    el.innerHTML = `<div class="bl-status"><span class="badge ${cls}">${esc(label)}</span><span class="text-sm text-secondary" style="flex:1">${esc(message)}</span></div>${retry ? '<button type="button" class="btn btn-secondary btn-sm" id="bl-stk-retry" style="margin-top:var(--space-2)">Try again</button>' : ''}`;
    $('bl-stk-retry')?.addEventListener('click', () => { el.innerHTML = ''; $('bl-stk-phone')?.focus(); });
  }

  async function sendStk() {
    const phone = $('bl-stk-phone').value.trim();
    const kes = Number($('bl-stk-amount').value);
    if (phone.replace(/\D/g, '').length < 9) return window.UI.toast.error('Enter the M-PESA phone number');
    if (!Number.isInteger(kes) || kes < 1) return window.UI.toast.error('Enter the amount in whole shillings');
    if (kes > 150000) return window.UI.toast.error('M-PESA allows at most KES 150,000 per prompt. Pay in smaller parts.');

    const btn = $('bl-stk-send');
    window.UI.setButtonLoading(btn, true, 'Sending…');
    showStatus('pending', 'Sending', 'Sending the prompt to the phone…');
    try {
      const { data } = await window.Api.post('/billing/payments/stk', { phone, amountCents: kes * 100 });
      try { localStorage.setItem(PHONE_KEY, phone); } catch { /* ignore */ }
      startPoll(data.payment.id);
    } catch (err) {
      const label = FAIL_LABELS[err.data && err.data.failureType] || 'Could not send the prompt';
      showStatus('error', label, err.message, true);
      window.UI.toast.error(err.message);
    } finally {
      window.UI.setButtonLoading(btn, false);
    }
  }

  function stopPoll() { if (state.pollTimer) { clearInterval(state.pollTimer); state.pollTimer = null; } }

  function startPoll(id) {
    stopPoll();
    showStatus('pending', 'Waiting', 'Ask the customer to enter their M-PESA PIN on the phone.');
    const t0 = Date.now();
    state.pollTimer = setInterval(async () => {
      if (!$('bl-stk-status')) { stopPoll(); return; }
      try {
        const { data } = await window.Api.get(`/billing/payments/${id}/status`);
        const p = data.payment;
        if (p.status === 'SUCCESS') {
          stopPoll();
          showStatus('success', 'Confirmed', p.message);
          window.UI.toast.success('Payment received - thank you');
          setTimeout(load, 1500);
          return;
        }
        if (p.status === 'FAILED' || p.status === 'CANCELLED') {
          stopPoll();
          const timedOut = p.failureType === 'timeout';
          showStatus(timedOut ? 'warning' : 'error', FAIL_LABELS[p.failureType] || 'Payment failed',
            timedOut ? 'No response in time. If money was deducted it is credited automatically within a few minutes - refresh this page shortly.' : p.message, true);
          return;
        }
      } catch { /* transient - keep polling */ }
      if (Date.now() - t0 > 150000) {
        stopPoll();
        showStatus('warning', 'Still waiting', 'No confirmation yet. If money was deducted it will be credited automatically; refresh shortly, or pay manually and paste the M-PESA message.');
      }
    }, 3000);
  }

  function resumePendingStk(list) {
    const p = (list || []).find((x) => x.method === 'STK' && x.status === 'PENDING' && Date.now() - new Date(x.createdAt) < 120000);
    if (p && $('bl-stk-status')) startPoll(p._id);
  }

  /* ---------------------------- manual payment ---------------------------- */
  async function sendManual() {
    const message = $('bl-man-msg').value.trim();
    const amt = $('bl-man-amount').value;
    if (message.length < 20) return window.UI.toast.error('Paste the full M-PESA confirmation message');
    const payload = { mpesaMessage: message };
    if (amt) payload.amountCents = Math.round(Number(amt) * 100);
    const btn = $('bl-man-send');
    window.UI.setButtonLoading(btn, true, 'Submitting…');
    try {
      await window.Api.post('/billing/payments/manual', payload);
      window.UI.toast.success('Submitted - we will verify it shortly');
      await load();
    } catch (err) {
      window.UI.toast.error(err.message);
    } finally {
      if (document.body.contains(btn)) window.UI.setButtonLoading(btn, false);
    }
  }

  /* -------------------------------- history -------------------------------- */
  async function loadHistory() {
    const host = $('bl-hist');
    if (!host) return;
    const isInv = state.tab === 'invoices';
    host.innerHTML = '<div class="table-wrap flat"><table class="table"><tbody>' + window.UI.skeletonRows(5, 4) + '</tbody></table></div>';
    try {
      const { data } = await window.Api.get(isInv ? '/billing/invoices' : '/billing/payments', { page: isInv ? state.invPage : state.payPage, limit: 10 });
      host.innerHTML = isInv ? invoiceTable(data.items) : paymentTable(data.items);
      window.UI.renderPagination($('bl-hist-pag'), data, (p) => { if (isInv) state.invPage = p; else state.payPage = p; loadHistory(); });
    } catch (err) {
      host.innerHTML = window.UI.emptyStateHtml({ icon: 'alert', title: 'Could not load history', message: err.message });
    }
  }

  function invoiceTable(items) {
    if (!items.length) return window.UI.emptyStateHtml({ icon: 'reports', title: 'No invoices yet' });
    const now = Date.now();
    return `<div class="table-wrap flat"><table class="table"><thead><tr><th>Invoice</th><th>Description</th><th>Due</th><th class="bl-right">Amount</th><th class="bl-right">Paid</th><th>Status</th></tr></thead><tbody>
      ${items.map((i) => {
        const open = i.status === 'PENDING' || i.status === 'PARTIAL';
        const overdue = open && new Date(i.dueDate) <= now;
        return `<tr><td class="cell-primary">${esc(i.number)}</td><td class="text-sm">${esc(i.description)}</td><td class="text-sm">${fdate(i.dueDate)}</td>
          <td class="bl-right">${fm(i.amount)}</td><td class="bl-right">${fm(i.amountPaid)}</td>
          <td><span class="badge ${overdue ? 'badge-danger' : INV_BADGE[i.status] || 'badge-neutral'}">${overdue ? 'Overdue' : esc(INV_LABEL[i.status] || i.status)}</span></td></tr>`;
      }).join('')}</tbody></table></div>`;
  }

  function paymentTable(items) {
    if (!items.length) return window.UI.emptyStateHtml({ icon: 'reports', title: 'No payments yet' });
    return `<div class="table-wrap flat"><table class="table"><thead><tr><th>Date</th><th>Method</th><th>Reference</th><th class="bl-right">Amount</th><th>Status</th></tr></thead><tbody>
      ${items.map((p) => `<tr><td class="text-sm">${window.UI.formatDateTime(p.createdAt)}</td><td class="text-sm">${esc(METHOD_LABEL[p.method] || p.method)}</td>
        <td class="text-sm">${esc(p.mpesaReceiptNumber || p.reference)}</td>
        <td class="bl-right font-semibold">${fm(p.status === 'SUBMITTED' ? p.claimedAmount || p.amount : p.amount)}</td>
        <td><span class="badge ${PAY_BADGE[p.status] || 'badge-neutral'}">${esc(PAY_LABEL[p.status] || p.status)}</span></td></tr>`).join('')}</tbody></table></div>`;
  }
})();