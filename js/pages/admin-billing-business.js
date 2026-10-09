/**
 * admin-billing-business.js - everything the admin can do for ONE business: record/approve payments, create/adjust/void
 * invoices, lock/unlock, extend trial, change plan, per-business grace policy, send notices/reminders. URL: ?id=<businessId>
 */
(function () {
  const AB = window.AdminBilling;
  const { esc, kes, kesToCents, centsToKes, fdate, formModal, val } = AB;
  const businessId = new URLSearchParams(window.location.search).get('id');
  let el;
  let data;

  document.addEventListener('DOMContentLoaded', () => {
    el = window.AdminShell.mount({ title: 'Business billing' });
    if (!el) return;
    if (!businessId) { el.innerHTML = `<div class="card">${window.UI.emptyStateHtml({ icon: 'alert', title: 'No business selected', message: 'Open a business from the Subscriptions list.' })}</div>`; return; }
    load();
  });

  async function load() {
    el.innerHTML = window.UI.skeletonRows(3, 1);
    try {
      ({ data } = await window.Api.get(`/admin/billing/businesses/${businessId}`));
      render();
    } catch (err) {
      if (err.code === 'NO_SUBSCRIPTION') return renderStart();
      el.innerHTML = `<div class="card">${window.UI.emptyStateHtml({ icon: 'alert', title: 'Could not load billing', message: err.message, actionHtml: '<a class="btn btn-secondary" href="admin-billing.html">Back</a>' })}</div>`;
    }
  }

  /* --------------------- business has no subscription --------------------- */
  async function renderStart() {
    let name = 'this business';
    let plans = [];
    try { const r = await window.Api.get(`/admin/businesses/${businessId}`); name = r.data.business.name; } catch { /* ignore */ }
    try { plans = (await window.Api.get('/admin/billing/plans')).data.items.filter((p) => p.isActive); } catch { /* ignore */ }
    el.innerHTML = `
      <div class="page-header"><div><h1>${esc(name)}</h1><p>This business has no subscription yet.</p></div><div class="page-actions"><a class="btn btn-secondary btn-sm" href="admin-billing.html">Back</a></div></div>
      <div class="card"><div class="card-body" style="max-width:480px">
        <div class="field"><label>Plan</label><select class="select" id="st-plan">${plans.map((p) => `<option value="${esc(p.key)}">${esc(p.name)}</option>`).join('')}</select></div>
        <div class="field"><label>Start at phase</label><select class="select" id="st-phase"></select><span class="field-hint">Choose a later phase to skip the free trial.</span></div>
        <button class="btn btn-primary" id="st-go">Start subscription</button>
      </div></div>`;
    const fill = () => {
      const p = plans.find((x) => x.key === document.getElementById('st-plan').value);
      document.getElementById('st-phase').innerHTML = (p ? p.phases : []).map((ph, i) => `<option value="${esc(ph.key)}" ${i === 0 ? 'selected' : ''}>${esc(ph.name)}</option>`).join('');
    };
    document.getElementById('st-plan').addEventListener('change', fill);
    fill();
    document.getElementById('st-go').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      window.UI.setButtonLoading(btn, true, 'Starting…');
      try {
        await window.Api.post(`/admin/billing/businesses/${businessId}/start`, { planKey: document.getElementById('st-plan').value, startPhaseKey: document.getElementById('st-phase').value });
        window.UI.toast.success('Subscription started');
        load();
      } catch (err) { window.UI.toast.error(AB.errText(err)); window.UI.setButtonLoading(btn, false); }
    });
  }

  /* -------------------------------- main view -------------------------------- */
  function render() {
    const { business: b, subscription: s, plan, invoices, payments, events, upcoming } = data;
    const locked = !!(s.lock && s.lock.active);
    const trial = s.phaseType === 'TRIAL';

    el.innerHTML = `
      <div class="page-header">
        <div>
          <h1>${esc(b.name)} ${AB.badge(AB.SUB_BADGE, AB.SUB_LABEL, s.status)} ${locked ? `<span class="badge badge-danger">${s.lock.reason === 'ADMIN' ? 'Locked by admin' : 'Auto-locked'}</span>` : ''}</h1>
          <p>${esc(b.phone || '')}${b.email ? ` · ${esc(b.email)}` : ''} · Business status: ${esc(b.status)}</p>
        </div>
        <div class="page-actions"><a class="btn btn-secondary btn-sm" href="admin-billing.html">Back to billing</a></div>
      </div>

      <div class="bl-actions">
        <button class="btn btn-primary btn-sm" data-act="record">Record payment</button>
        <button class="btn btn-secondary btn-sm" data-act="invoice">Create invoice</button>
        <button class="btn btn-secondary btn-sm" data-act="notice">Send notice</button>
        <button class="btn btn-secondary btn-sm" data-act="remind">Send reminder</button>
        ${trial ? '<button class="btn btn-secondary btn-sm" data-act="trial">Extend trial</button>' : ''}
        <button class="btn btn-secondary btn-sm" data-act="plan">Change plan</button>
        <button class="btn btn-secondary btn-sm" data-act="policy">Grace policy</button>
        ${locked ? '<button class="btn btn-success btn-sm" data-act="unlock">Unlock</button>' : '<button class="btn btn-danger btn-sm" data-act="lock">Lock account</button>'}
      </div>

      <div class="bl-stats">
        ${AB.stat({ label: 'Overdue', value: kes(s.arrearsCents), tone: s.arrearsCents ? 'danger' : '', sub: s.oldestOverdueAt ? `Since ${fdate(s.oldestOverdueAt)}` : 'Nothing overdue' })}
        ${AB.stat({ label: 'Open balance', value: kes(s.openBalanceCents) })}
        ${AB.stat({ label: 'Credit', value: kes(s.creditCents), tone: s.creditCents ? 'success' : '' })}
        ${AB.stat({ label: 'Total paid', value: kes(s.totalPaidCents), sub: s.lastPaymentAt ? `Last ${window.UI.timeAgo(s.lastPaymentAt)}` : 'No payments' })}
        ${AB.stat({ label: locked ? 'Locked since' : 'Auto-lock on', value: locked ? fdate(s.lock.at) : data.lockAt ? fdate(data.lockAt) : '-', tone: locked ? 'danger' : '', sub: locked ? esc(s.lock.note || '') : `${data.graceDays} day grace${s.graceDaysOverride != null ? ' (override)' : ''}` })}
      </div>

      <div class="bl-grid-2">
        <section class="card"><div class="card-header"><h2>Plan & schedule</h2></div><div class="card-body">
          <div class="bl-kv"><span>Plan</span><span>${esc(s.planName || '-')}</span></div>
          <div class="bl-kv"><span>Phase</span><span>${esc(s.phaseName || 'Plan complete')}</span></div>
          <div class="bl-kv"><span>Phase started</span><span>${fdate(s.phaseStartedAt)}</span></div>
          <div class="bl-kv"><span>Phase ends</span><span>${s.phaseEndsAt ? fdate(s.phaseEndsAt) : 'Ongoing'}</span></div>
          <div class="bl-kv"><span>Next action</span><span>${s.nextActionAt ? fdate(s.nextActionAt) : '-'}</span></div>
          ${upcoming ? `<div class="bl-kv"><span>Upcoming</span><span>${upcoming.type === 'INVOICE' ? `${esc(upcoming.description)} · ${kes(upcoming.amountCents)}${upcoming.estimated ? ' (est.)' : ''} · due ${fdate(upcoming.at)}` : upcoming.type === 'TRIAL_END' ? `Trial ends ${fdate(upcoming.at)}` : `Next phase ${esc(upcoming.nextPhaseName || 'end')} on ${fdate(upcoming.at)}`}</span></div>` : ''}
          ${s.lockExemptUntil ? `<div class="bl-kv"><span>Lock exemption until</span><span>${fdate(s.lockExemptUntil)}</span></div>` : ''}
        </div></section>
        <section class="card"><div class="card-header"><h2>Activity</h2></div><div class="card-body">
          <ul class="bl-timeline">${events.map((e) => `<li><time>${window.UI.formatDateTime(e.createdAt)}</time><span>${esc(e.message)}${e.actorName ? ` <span class="bl-muted">- ${esc(e.actorName)}</span>` : ''}</span></li>`).join('') || '<li class="text-muted">No activity yet.</li>'}</ul>
        </div></section>
      </div>

      <section class="card bl-card-gap"><div class="card-header"><h2>Invoices</h2></div>
        <div class="table-wrap flat"><table class="table"><thead><tr><th>Invoice</th><th>Description</th><th>Due</th><th class="bl-right">Amount</th><th class="bl-right">Paid</th><th>Status</th><th></th></tr></thead><tbody>
          ${invoices.map((i) => {
            const open = i.status === 'PENDING' || i.status === 'PARTIAL';
            const overdue = open && new Date(i.dueDate) <= new Date();
            return `<tr><td class="cell-primary">${esc(i.number)}</td><td class="text-sm">${esc(i.description)}${i.kind === 'ONE_OFF' ? ' <span class="badge badge-neutral">Manual</span>' : ''}</td><td class="text-sm">${fdate(i.dueDate)}</td><td class="bl-right">${kes(i.amount)}</td><td class="bl-right">${kes(i.amountPaid)}</td>
              <td><span class="badge ${overdue ? 'badge-danger' : AB.INV_BADGE[i.status]}">${overdue ? 'Overdue' : esc(i.status)}</span></td>
              <td class="actions">${i.status !== 'VOID' ? `<button class="btn btn-secondary btn-sm" data-adj="${esc(i._id)}">Adjust</button><button class="btn btn-ghost btn-sm" data-void="${esc(i._id)}">Void</button>` : ''}</td></tr>`;
          }).join('') || '<tr><td colspan="7" class="text-muted">No invoices yet.</td></tr>'}
        </tbody></table></div></section>

      <section class="card bl-card-gap"><div class="card-header"><h2>Payments</h2></div>
        <div class="table-wrap flat"><table class="table"><thead><tr><th>Date</th><th>Method</th><th>Code / reference</th><th class="bl-right">Amount</th><th>Status</th><th></th></tr></thead><tbody>
          ${payments.map((p) => `<tr><td class="text-sm">${window.UI.formatDateTime(p.createdAt)}</td><td class="text-sm">${esc(AB.METHOD_LABEL[p.method] || p.method)}${p.source === 'ADMIN' ? ' <span class="badge badge-neutral">Admin</span>' : ''}</td>
            <td class="text-sm">${esc(p.mpesaReceiptNumber || '-')}<div class="bl-muted">${esc(p.reference)}</div></td>
            <td class="bl-right font-semibold">${kes(p.status === 'SUBMITTED' ? p.claimedAmount : p.amount)}</td><td>${AB.badge(AB.PAY_BADGE, AB.PAY_LABEL, p.status)}</td>
            <td class="actions"><button class="btn btn-secondary btn-sm" data-pay="${esc(p._id)}">${p.status === 'SUBMITTED' ? 'Review' : 'View'}</button></td></tr>`).join('') || '<tr><td colspan="6" class="text-muted">No payments yet.</td></tr>'}
        </tbody></table></div></section>`;

    el.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => actions[b.dataset.act]()));
    el.querySelectorAll('[data-adj]').forEach((b) => b.addEventListener('click', () => adjustInvoice(invoices.find((i) => i._id === b.dataset.adj))));
    el.querySelectorAll('[data-void]').forEach((b) => b.addEventListener('click', () => voidInvoice(invoices.find((i) => i._id === b.dataset.void))));
    el.querySelectorAll('[data-pay]').forEach((b) => b.addEventListener('click', () => AB.openPaymentReview(b.dataset.pay, load)));
  }

  /* -------------------------------- actions -------------------------------- */
  const post = (path, body) => window.Api.post(`/admin/billing/businesses/${businessId}/${path}`, body);
  const patch = (path, body) => window.Api.patch(`/admin/billing/businesses/${businessId}/${path}`, body);
  const done = (msg) => { window.UI.toast.success(msg); load(); };

  const actions = {
    record() {
      formModal({
        title: 'Record a payment', submitText: 'Record payment',
        bodyHtml: `
          <p class="text-sm text-secondary" style="margin-bottom:var(--space-3)">Use this for cash, bank or M-PESA money you have already received outside the system. It is credited immediately.</p>
          <div class="form-row">
            <div class="field"><label>Amount (KES)</label><input class="input" name="amount" type="number" min="1" step="0.01" required /></div>
            <div class="field"><label>Method</label><select class="select" name="method"><option value="MPESA_MANUAL">M-PESA</option><option value="CASH">Cash</option><option value="BANK">Bank</option><option value="OTHER">Other</option></select></div>
          </div>
          <div class="field"><label>M-PESA code <span class="text-muted">(optional, blocks the same code being used twice)</span></label><input class="input" name="receiptCode" maxlength="10" pattern="[A-Za-z][A-Za-z0-9]{9}" placeholder="UJK1A2B3C4" /></div>
          <div class="field"><label>Reference <span class="text-muted">(optional)</span></label><input class="input" name="reference" maxlength="120" /></div>
          <div class="field"><label>Note <span class="text-muted">(optional)</span></label><input class="input" name="note" maxlength="300" /></div>`,
        onSubmit: async (f) => {
          const body = { amountCents: kesToCents(val(f, 'amount')), method: val(f, 'method') };
          ['receiptCode', 'reference', 'note'].forEach((k) => { if (val(f, k)) body[k] = val(f, k); });
          await post('payments', body);
          done('Payment recorded and applied');
        },
      });
    },
    invoice() {
      formModal({
        title: 'Create an invoice', submitText: 'Create invoice',
        bodyHtml: `
          <div class="field"><label>Description</label><input class="input" name="description" required minlength="3" maxlength="200" placeholder="e.g. Extra branch set-up" /></div>
          <div class="form-row">
            <div class="field"><label>Amount (KES, whole shillings)</label><input class="input" name="amount" type="number" min="1" step="1" required /></div>
            <div class="field"><label>Due date</label><input class="input" name="due" type="date" /></div>
          </div>
          <p class="bl-muted">The owner is notified by email and in-app. Leave the date empty to make it due now.</p>`,
        onSubmit: async (f) => {
          const body = { description: val(f, 'description'), amountCents: kesToCents(val(f, 'amount')) };
          if (val(f, 'due')) body.dueDate = `${val(f, 'due')}T23:59:59+03:00`;
          await post('invoices', body);
          done('Invoice created');
        },
      });
    },
    notice() {
      formModal({
        title: 'Send a notice to this business', submitText: 'Send notice',
        bodyHtml: `
          <div class="field"><label>Title</label><input class="input" name="title" required minlength="3" maxlength="120" /></div>
          <div class="field"><label>Message</label><textarea class="textarea" name="message" required minlength="3" maxlength="1000" rows="4"></textarea></div>
          <div class="form-row">
            <div class="field"><label>Severity</label><select class="select" name="severity"><option value="info">Info</option><option value="warning" selected>Warning</option><option value="critical">Critical</option></select></div>
            <div class="field"><label>&nbsp;</label><label class="checkbox-row"><input type="checkbox" name="sendEmail" checked /> Also send by email</label></div>
          </div>`,
        onSubmit: async (f) => {
          await post('notice', { title: val(f, 'title'), message: val(f, 'message'), severity: val(f, 'severity'), sendEmail: f.elements.sendEmail.checked });
          window.UI.toast.success('Notice sent');
          load();
        },
      });
    },
    async remind() {
      const ok = await window.UI.confirmDialog({ title: 'Send a reminder now?', message: 'Emails and notifies the owner about their oldest unpaid invoice.', confirmText: 'Send reminder' });
      if (!ok) return;
      try { const { data: r } = await post('remind', {}); window.UI.toast.success(`Reminder sent for ${r.invoice}`); load(); }
      catch (err) { window.UI.toast.error(AB.errText(err)); }
    },
    trial() {
      formModal({
        title: 'Extend free trial', submitText: 'Extend',
        bodyHtml: `<div class="field"><label>Extra days</label><input class="input" name="days" type="number" min="1" max="90" value="7" required /></div><p class="bl-muted">Current trial end: ${fdate(data.subscription.phaseEndsAt)}</p>`,
        onSubmit: async (f) => { await post('extend-trial', { days: Number(val(f, 'days')) }); done('Trial extended'); },
      });
    },
    async plan() {
      let plans = [];
      try { plans = (await window.Api.get('/admin/billing/plans')).data.items.filter((p) => p.isActive); } catch (err) { return window.UI.toast.error(err.message); }
      const cur = data.subscription.planKey;
      const modal = formModal({
        title: 'Change plan', submitText: 'Change plan', danger: true,
        bodyHtml: `
          <div class="bl-alert warning"><div class="grow">The new plan starts <b>today</b> at the phase you choose. Unpaid invoices already issued stay as they are; only future invoices follow the new plan.</div></div>
          <div class="field"><label>Plan</label><select class="select" name="planKey">${plans.map((p) => `<option value="${esc(p.key)}" ${p.key === cur ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></div>
          <div class="field"><label>Start at phase</label><select class="select" name="startPhaseKey"></select></div>`,
        onSubmit: async (f) => { await patch('plan', { planKey: val(f, 'planKey'), startPhaseKey: val(f, 'startPhaseKey') || undefined }); done('Plan changed'); },
      });
      const sel = modal.querySelector('[name="planKey"]');
      const fill = () => { const p = plans.find((x) => x.key === sel.value); modal.querySelector('[name="startPhaseKey"]').innerHTML = (p ? p.phases : []).map((ph) => `<option value="${esc(ph.key)}">${esc(ph.name)}</option>`).join(''); };
      sel.addEventListener('change', fill);
      fill();
    },
    policy() {
      const s = data.subscription;
      formModal({
        title: 'Grace policy for this business', submitText: 'Save',
        bodyHtml: `
          <div class="field"><label>Grace days before auto-lock <span class="text-muted">(empty = platform default of ${data.graceDays})</span></label><input class="input" name="grace" type="number" min="0" max="90" value="${s.graceDaysOverride != null ? s.graceDaysOverride : ''}" /></div>
          <div class="field"><label>Never auto-lock before <span class="text-muted">(optional)</span></label><input class="input" name="exempt" type="date" value="${s.lockExemptUntil ? new Date(s.lockExemptUntil).toISOString().slice(0, 10) : ''}" /></div>`,
        onSubmit: async (f) => {
          await patch('policy', {
            graceDaysOverride: val(f, 'grace') === '' ? null : Number(val(f, 'grace')),
            lockExemptUntil: val(f, 'exempt') ? `${val(f, 'exempt')}T23:59:59+03:00` : null,
          });
          done('Policy saved');
        },
      });
    },
    lock() {
      formModal({
        title: 'Lock this account', submitText: 'Lock account', danger: true,
        bodyHtml: `<p class="text-sm text-secondary" style="margin-bottom:var(--space-3)">The owner can still log in and pay, but every other part of the system is blocked until you unlock it or the balance is cleared. They are emailed straight away.</p>
          <div class="field"><label>Reason shown to the owner <span class="text-muted">(optional)</span></label><input class="input" name="note" maxlength="300" /></div>`,
        onSubmit: async (f) => { await post('lock', val(f, 'note') ? { note: val(f, 'note') } : {}); done('Account locked'); },
      });
    },
    unlock() {
      formModal({
        title: 'Unlock this account', submitText: 'Unlock',
        bodyHtml: `<div class="field"><label>Note <span class="text-muted">(optional)</span></label><input class="input" name="note" maxlength="300" /></div>
          <div class="field"><label>Protect from auto-lock for (days) <span class="text-muted">(optional)</span></label><input class="input" name="exempt" type="number" min="1" max="60" placeholder="e.g. 7" /><span class="field-hint">Use this if the balance is still unpaid, otherwise the system may lock them again at the next check.</span></div>`,
        onSubmit: async (f) => {
          const body = {};
          if (val(f, 'note')) body.note = val(f, 'note');
          if (val(f, 'exempt')) body.exemptDays = Number(val(f, 'exempt'));
          await post('unlock', body);
          done('Account unlocked');
        },
      });
    },
  };

  function adjustInvoice(inv) {
    formModal({
      title: `Adjust ${inv.number}`, submitText: 'Save changes',
      bodyHtml: `
        <p class="bl-muted" style="margin-bottom:var(--space-3)">Already paid on this invoice: ${kes(inv.amountPaid)}. The amount cannot go below that - void the invoice instead.</p>
        <div class="field"><label>Description</label><input class="input" name="description" value="${esc(inv.description)}" maxlength="200" /></div>
        <div class="form-row">
          <div class="field"><label>Amount (KES, whole shillings)</label><input class="input" name="amount" type="number" min="1" step="1" value="${centsToKes(inv.amount)}" /></div>
          <div class="field"><label>Due date</label><input class="input" name="due" type="date" value="${new Date(inv.dueDate).toISOString().slice(0, 10)}" /></div>
        </div>
        <div class="field"><label>Reason for the change</label><input class="input" name="reason" required minlength="3" maxlength="300" /></div>`,
      onSubmit: async (f) => {
        const body = { reason: val(f, 'reason') };
        const amountCents = kesToCents(val(f, 'amount'));
        if (amountCents !== inv.amount) body.amountCents = amountCents;
        if (val(f, 'description') && val(f, 'description') !== inv.description) body.description = val(f, 'description');
        if (val(f, 'due') && val(f, 'due') !== new Date(inv.dueDate).toISOString().slice(0, 10)) body.dueDate = `${val(f, 'due')}T23:59:59+03:00`;
        if (Object.keys(body).length === 1) { window.UI.toast.error('Nothing was changed'); return false; }
        await window.Api.patch(`/admin/billing/invoices/${inv._id}`, body);
        done('Invoice updated');
      },
    });
  }

  function voidInvoice(inv) {
    formModal({
      title: `Void ${inv.number}`, submitText: 'Void invoice', danger: true,
      bodyHtml: `<p class="text-sm text-secondary" style="margin-bottom:var(--space-3)">The invoice stops counting as owed.${inv.amountPaid ? ` The ${kes(inv.amountPaid)} already paid on it moves to the owner's account credit - it is never lost.` : ''}</p>
        <div class="field"><label>Reason</label><input class="input" name="reason" required minlength="3" maxlength="300" /></div>`,
      onSubmit: async (f) => { await window.Api.post(`/admin/billing/invoices/${inv._id}/void`, { reason: val(f, 'reason') }); done('Invoice voided'); },
    });
  }
})();