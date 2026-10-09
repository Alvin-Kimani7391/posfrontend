/**
 * admin-billing.js - tabs: Overview | Subscriptions | Payments (verification queue).
 * The Subscriptions and Payments tables reuse AdminList. AdminList reads its initial filters from the URL,
 * so the URL is set just before each list is created (the Payments tab opens on "To verify").
 */
(function () {
  const AB = window.AdminBilling;
  const { esc, kes } = AB;
  const lists = {};
  let el;
  let tab = 'overview';

  document.addEventListener('DOMContentLoaded', () => {
    el = window.AdminShell.mount({ title: 'Billing' });
    if (!el) return;
    const wanted = new URLSearchParams(window.location.search).get('tab');
    if (['overview', 'subs', 'payments'].includes(wanted)) tab = wanted;

    el.innerHTML = `
      <div class="page-header">
        <div><h1>Billing</h1><p>Subscriptions, arrears and payments across every business.</p></div>
        <div class="page-actions" style="display:flex;gap:var(--space-2);flex-wrap:wrap">
          <button class="btn btn-secondary btn-sm" id="ab-backfill">Start subscriptions for existing businesses</button>
          <button class="btn btn-secondary btn-sm" id="ab-cycle">Run billing cycle now</button>
        </div>
      </div>
      ${AB.subnav('overview')}
      <div class="tabs" id="ab-tabs" style="margin-bottom:var(--space-5)">
        <button class="tab-btn" data-tab="overview">Overview</button>
        <button class="tab-btn" data-tab="subs">Subscriptions</button>
        <button class="tab-btn" data-tab="payments">Payments <span id="ab-pay-badge"></span></button>
      </div>
      <div class="bl-pane" id="pane-overview"></div>
      <div class="bl-pane" id="pane-subs"></div>
      <div class="bl-pane" id="pane-payments"></div>`;

    document.getElementById('ab-tabs').addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (b) show(b.dataset.tab); });
    document.getElementById('ab-cycle').addEventListener('click', runCycle);
    document.getElementById('ab-backfill').addEventListener('click', backfill);
    show(tab);
  });

  function show(t) {
    tab = t;
    document.querySelectorAll('#ab-tabs .tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === t));
    document.querySelectorAll('.bl-pane').forEach((p) => p.classList.toggle('active', p.id === `pane-${t}`));
    if (t === 'overview') loadOverview();
    if (t === 'subs') initSubs();
    if (t === 'payments') initPayments();
  }

  /* ------------------------------- actions ------------------------------- */
  async function runCycle() {
    const ok = await window.UI.confirmDialog({ title: 'Run the billing cycle now?', message: 'Issues any due invoices, sends due reminders and applies locks. It is safe to run at any time - the scheduler does this every 5 minutes anyway.', confirmText: 'Run now' });
    if (!ok) return;
    const btn = document.getElementById('ab-cycle');
    window.UI.setButtonLoading(btn, true, 'Running…');
    try {
      const { data } = await window.Api.post('/admin/billing/run-cycle', {});
      window.UI.toast.success(data.skipped ? `Skipped: ${String(data.skipped).replace(/_/g, ' ')}` : `Done - ${data.advanced || 0} advanced, ${data.reviewed || 0} reviewed`);
      show(tab);
    } catch (err) { window.UI.toast.error(err.message); }
    finally { window.UI.setButtonLoading(btn, false); }
  }

  async function backfill() {
    const ok = await window.UI.confirmDialog({ title: 'Start subscriptions for existing businesses?', message: 'Every business without a subscription gets the default plan, starting with the free trial today. Nobody is billed until billing is switched on in Settings.', confirmText: 'Start subscriptions' });
    if (!ok) return;
    const btn = document.getElementById('ab-backfill');
    window.UI.setButtonLoading(btn, true, 'Working…');
    try {
      const { data } = await window.Api.post('/admin/billing/backfill', {});
      window.UI.toast.success(`${data.started} subscription(s) started`);
      show(tab);
    } catch (err) { window.UI.toast.error(err.message); }
    finally { window.UI.setButtonLoading(btn, false); }
  }

  /* ------------------------------- overview ------------------------------- */
  async function loadOverview() {
    const pane = document.getElementById('pane-overview');
    pane.innerHTML = window.UI.skeletonRows(3, 1);
    try {
      const { data: d } = await window.Api.get('/admin/billing/overview');
      const c = d.counts || {};
      const badge = document.getElementById('ab-pay-badge');
      if (badge) badge.innerHTML = d.pendingVerification ? `<span class="badge badge-warning">${d.pendingVerification}</span>` : '';

      pane.innerHTML = `
        ${d.billingEnabled ? '' : `<div class="bl-alert warning"><div class="grow"><b>Billing is OFF.</b> Nobody is invoiced, emailed or locked. Finish setup, then switch it on.</div><a class="btn btn-secondary btn-sm" href="admin-billing-settings.html">Open settings</a></div>`}
        <div class="bl-stats">
          ${AB.stat({ label: 'To verify', value: d.pendingVerification, sub: 'Manual payments waiting', tone: d.pendingVerification ? 'warning' : '', href: '?tab=payments' })}
          ${AB.stat({ label: 'Total arrears', value: kes(d.arrears.totalCents), sub: `${d.arrears.businesses} business(es)`, tone: d.arrears.totalCents ? 'danger' : '' })}
          ${AB.stat({ label: 'Collected this month', value: kes(d.collectedThisMonth.totalCents), sub: `${d.collectedThisMonth.payments} payment(s)`, tone: 'success' })}
          ${AB.stat({ label: 'Trials ending in 3 days', value: d.trialsEndingSoon })}
        </div>
        <div class="bl-stats">
          ${AB.stat({ label: 'Active', value: c.ACTIVE || 0 })}
          ${AB.stat({ label: 'On trial', value: c.TRIALING || 0 })}
          ${AB.stat({ label: 'Past due', value: c.PAST_DUE || 0, tone: c.PAST_DUE ? 'warning' : '' })}
          ${AB.stat({ label: 'Locked', value: c.SUSPENDED || 0, tone: c.SUSPENDED ? 'danger' : '' })}
          ${AB.stat({ label: 'Cancelled', value: c.CANCELLED || 0 })}
        </div>
        <div class="bl-grid-2">
          <section class="card">
            <div class="card-header"><h2>Biggest arrears</h2></div>
            <div class="table-wrap flat"><table class="table"><thead><tr><th>Business</th><th class="bl-right">Overdue</th><th>Since</th><th>Status</th></tr></thead><tbody>
              ${d.topDefaulters.map((s) => `<tr><td class="cell-primary"><a class="bl-link" href="admin-billing-business.html?id=${esc(s.businessId)}">${esc(s.businessName || '-')}</a></td><td class="bl-right font-semibold">${kes(s.arrearsCents)}</td><td class="text-sm">${AB.fdate(s.oldestOverdueAt)}</td><td>${AB.badge(AB.SUB_BADGE, AB.SUB_LABEL, s.status)}</td></tr>`).join('') || '<tr><td colspan="4" class="text-muted">Nobody is in arrears.</td></tr>'}
            </tbody></table></div>
          </section>
          <section class="card">
            <div class="card-header"><h2>Recent payments</h2></div>
            <div class="table-wrap flat"><table class="table"><thead><tr><th>Business</th><th class="bl-right">Amount</th><th>Method</th><th>Status</th></tr></thead><tbody>
              ${d.recentPayments.map((p) => `<tr class="bl-row-click" data-pay="${esc(p._id)}"><td class="cell-primary">${esc(p.businessName || '-')}<div class="bl-muted">${window.UI.timeAgo(p.createdAt)}</div></td><td class="bl-right font-semibold">${kes(p.status === 'SUBMITTED' ? p.claimedAmount : p.amount)}</td><td class="text-sm">${esc(AB.METHOD_LABEL[p.method] || p.method)}</td><td>${AB.badge(AB.PAY_BADGE, AB.PAY_LABEL, p.status)}</td></tr>`).join('') || '<tr><td colspan="4" class="text-muted">No payments yet.</td></tr>'}
            </tbody></table></div>
          </section>
        </div>`;
      pane.querySelectorAll('[data-pay]').forEach((tr) => tr.addEventListener('click', () => AB.openPaymentReview(tr.dataset.pay, () => loadOverview())));
    } catch (err) {
      pane.innerHTML = `<div class="card">${window.UI.emptyStateHtml({ icon: 'alert', title: 'Could not load billing overview', message: err.message })}</div>`;
    }
  }

  /* ----------------------------- subscriptions ----------------------------- */
  function presetUrl(qs) { try { window.history.replaceState(null, '', `${window.location.pathname}${qs}`); } catch { /* ignore */ } }

  function initSubs() {
    if (lists.subs) return lists.subs.reload();
    presetUrl('?tab=subs');
    lists.subs = window.AdminList.create(document.getElementById('pane-subs'), {
      endpoint: '/admin/billing/subscriptions',
      search: 'Search business name, phone or email...',
      filters: [
        { key: 'status', type: 'select', label: 'Status', options: [['', 'All'], ['TRIALING', 'Trial'], ['ACTIVE', 'Active'], ['PAST_DUE', 'Past due'], ['SUSPENDED', 'Locked'], ['CANCELLED', 'Cancelled']] },
        { key: 'arrears', type: 'select', label: 'Arrears', options: [['', 'All'], ['1', 'In arrears']] },
        { key: 'sort', type: 'select', label: 'Sort', options: [['', 'Newest first'], ['arrears', 'Highest arrears']] },
      ],
      columns: [
        { label: 'Business', render: (s) => `<b>${esc(s.business?.name || '-')}</b><div class="bl-muted">${esc(s.business?.phone || '')}</div>` },
        { label: 'Plan / phase', render: (s) => `${esc(s.planName || '-')}<div class="bl-muted">${esc(s.phaseName || 'Complete')}</div>` },
        { label: 'Status', render: (s) => `${AB.badge(AB.SUB_BADGE, AB.SUB_LABEL, s.status)}${s.locked ? ` <span class="badge badge-danger">${s.lockReason === 'ADMIN' ? 'Locked by admin' : 'Auto-locked'}</span>` : ''}` },
        { label: 'Overdue', num: true, render: (s) => (s.arrearsCents ? `<b style="color:var(--color-danger)">${kes(s.arrearsCents)}</b><div class="bl-muted">${s.daysOverdue} day(s)</div>` : '-') },
        { label: 'Open balance', num: true, render: (s) => kes(s.openBalanceCents) },
        { label: 'Credit', num: true, render: (s) => (s.creditCents ? kes(s.creditCents) : '-') },
        { label: 'Last payment', render: (s) => (s.lastPaymentAt ? window.UI.timeAgo(s.lastPaymentAt) : '<span class="text-muted">Never</span>') },
      ],
      onRow: (s) => { if (s.businessId) window.location.href = `admin-billing-business.html?id=${s.businessId}`; },
      empty: { title: 'No subscriptions yet', message: 'Use "Start subscriptions for existing businesses" above.' },
    });
  }

  /* -------------------------------- payments -------------------------------- */
  function initPayments() {
    if (lists.payments) return lists.payments.reload();
    presetUrl('?tab=payments&status=SUBMITTED');
    lists.payments = window.AdminList.create(document.getElementById('pane-payments'), {
      endpoint: '/admin/billing/payments',
      filters: [
        { key: 'status', type: 'select', label: 'Status', options: [['', 'All'], ['SUBMITTED', 'To verify'], ['SUCCESS', 'Received'], ['PENDING', 'Waiting'], ['FAILED', 'Failed'], ['REJECTED', 'Rejected']] },
        { key: 'method', type: 'select', label: 'Method', options: [['', 'All'], ['STK', 'M-PESA prompt'], ['MPESA_MANUAL', 'M-PESA manual'], ['CASH', 'Cash'], ['BANK', 'Bank'], ['OTHER', 'Other']] },
      ],
      columns: [
        { label: 'Business', render: (p) => `<b>${esc(p.businessName || '-')}</b><div class="bl-muted">${esc(p.businessPhone || '')}</div>` },
        { label: 'Method', render: (p) => esc(AB.METHOD_LABEL[p.method] || p.method) },
        { label: 'Amount', num: true, render: (p) => `<b>${kes(p.status === 'SUBMITTED' ? p.claimedAmount : p.amount)}</b>` },
        { label: 'Code / reference', render: (p) => `${esc(p.mpesaReceiptNumber || '-')}<div class="bl-muted">${esc(p.reference)}</div>` },
        { label: 'Flags', render: (p) => ((p.flags || []).length ? `<span class="badge badge-warning">${p.flags.length} flag(s)</span>` : '<span class="text-muted">-</span>') },
        { label: 'Submitted', render: (p) => window.UI.timeAgo(p.createdAt) },
        { label: 'Status', render: (p) => AB.badge(AB.PAY_BADGE, AB.PAY_LABEL, p.status) },
      ],
      onRow: (p, api) => AB.openPaymentReview(p._id, () => { api.reload(); loadBadge(); }),
      empty: { title: 'Nothing here', message: 'Manual payments that need verifying appear in this list.' },
    });
  }

  async function loadBadge() {
    try {
      const { data } = await window.Api.get('/admin/billing/payments', { status: 'SUBMITTED', limit: 1 });
      const b = document.getElementById('ab-pay-badge');
      if (b) b.innerHTML = data.total ? `<span class="badge badge-warning">${data.total}</span>` : '';
    } catch { /* ignore */ }
  }
  loadBadge && document.addEventListener('DOMContentLoaded', () => setTimeout(loadBadge, 400));
})();