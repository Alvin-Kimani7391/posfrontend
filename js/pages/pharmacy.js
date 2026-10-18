/**
 * pharmacy.js - the Pharmacy desk: today's dispensing, what needs attention, the setup checklist, shortcuts.
 * Backed by GET /pharmacy/dashboard (aggregates only) and GET /pharmacy/setup/status.
 */
(function () {
  const P = window.Pharmacy;
  const esc = P.esc;

  document.addEventListener('DOMContentLoaded', () => P.page({ title: 'Pharmacy desk', render }));

  async function render(el) {
    el.innerHTML = `
      <div class="page-header"><div><h1>Pharmacy desk</h1><p id="ph-sub">What needs attention today.</p></div>
        <div class="flex" style="gap:var(--space-2);flex-wrap:wrap">
          <a class="btn btn-secondary" href="prescriptions.html?new=1" data-requires-permission="prescriptions.intake">${window.Icons.get('plus')} New prescription</a>
          <a class="btn btn-secondary" href="medicines.html?add=1" data-requires-permission="medicines.manage">${window.Icons.get('pill')} Add medicine</a>
          <a class="btn btn-secondary" href="sales.html?desk=otc" data-requires-permission="sales.create">${window.Icons.get('bag')} Over the counter</a>
          <a class="btn btn-primary" href="sales.html?desk=rx" data-requires-permission="sales.create">${window.Icons.get('pill')} Dispense prescription</a>
        </div></div>
      <div id="ph-setup"></div>
      <div id="ph-dash"><div class="ph-card-pad text-muted">Loading…</div></div>`;
    const [dash, setup] = await Promise.allSettled([
      P.can('pharmacy.reports') ? window.Api.get('/pharmacy/dashboard', { branchId: window.AppShell.getActiveBranchId() || undefined }) : Promise.reject(new Error('You do not have access to the pharmacy dashboard.')),
      P.can('pharmacy.settings') ? window.Api.get('/pharmacy/setup/status') : Promise.reject(new Error('skip')),
    ]);
    if (setup.status === 'fulfilled') renderSetup(el.querySelector('#ph-setup'), setup.value.data);
    const host = el.querySelector('#ph-dash');
    if (dash.status === 'rejected') { host.innerHTML = `<div class="card ph-card-pad">${window.UI.emptyStateHtml({ icon: 'alert', title: 'Dashboard unavailable', message: dash.reason.message })}</div>`; return; }
    renderDash(host, dash.value.data);
    window.AppShell.onBranchChange?.(() => render(el));
  }

  const stat = (label, value, { tone = '', href = '', hint = '' } = {}) => {
    const inner = `<div class="stat-label">${esc(label)}</div><div class="stat-value ph-num ${tone}">${esc(value)}</div>${hint ? `<div class="ph-note">${esc(hint)}</div>` : ''}`;
    return href ? `<a class="stat-card" href="${href}" style="text-decoration:none;color:inherit">${inner}</a>` : `<div class="stat-card">${inner}</div>`;
  };

  function renderDash(host, d) {
    const t = d.today || {}; const s = d.stock || {}; const k = d.tasks || {};
    const task = (text, n, href, tone) => `<div class="ph-task"><span>${esc(text)}</span><span style="display:flex;gap:var(--space-3);align-items:center"><span class="ph-num ${n ? tone : ''}">${n}</span>${href ? `<a href="${href}" class="btn btn-ghost btn-sm">Open</a>` : ''}</span></div>`;
    host.innerHTML = `
      <div class="ph-grid">
        ${stat('Dispensings today', t.dispensings || 0)}
        ${stat('Sales today', t.sales || 0, { hint: P.moneyCents(t.salesTotal) })}
        ${stat('Awaiting pharmacist review', k.prescriptionsAwaitingReview || 0, { tone: k.prescriptionsAwaitingReview ? 'warn' : '', href: 'prescriptions.html#review' })}
        ${stat('Open recalls', k.openRecalls || 0, { tone: k.openRecalls ? 'bad' : '', href: 'pharmacy-compliance.html#recalls' })}
      </div>
      <div class="ph-two">
        <div class="card ph-card-pad"><div class="ph-h"><h3>Needs attention</h3></div>
          ${task('Prescriptions waiting for a pharmacist', k.prescriptionsAwaitingReview || 0, 'prescriptions.html#review', 'warn')}
          ${task('Open recalls', k.openRecalls || 0, 'pharmacy-compliance.html#recalls', 'bad')}
          ${task('Open storage / temperature exceptions', k.openStorageExceptions || 0, 'pharmacy-compliance.html#storage', 'bad')}
          ${task('Purchase orders waiting to be received', k.purchaseOrdersAwaitingReceipt || 0, 'purchases.html', 'warn')}
          ${task('Controlled medicines to reconcile', k.controlledMedicinesToReconcile || 0, 'pharmacy-compliance.html#controlled', 'warn')}
        </div>
        <div class="card ph-card-pad"><div class="ph-h"><h3>Stock health</h3></div>
          ${task('Expired batches still holding stock', s.expiredBatches || 0, 'pharmacy-compliance.html#expiry', 'bad')}
          ${task('Batches expiring in 30 days', s.expiringIn30Days || 0, 'pharmacy-compliance.html#expiry', 'warn')}
          ${task('Quarantined batches', s.quarantinedBatches || 0, 'batches.html', 'warn')}
          ${task('Recalled batches held', s.recalledBatchesHeld || 0, 'pharmacy-compliance.html#recalls', 'bad')}
          ${task('Medicines low on stock', s.lowStockMedicines || 0, 'pharmacy-compliance.html#replenish', 'warn')}
          ${task('Medicines out of stock', s.outOfStockMedicines || 0, 'pharmacy-compliance.html#replenish', 'bad')}
        </div>
      </div>
      <p class="ph-note">As of ${esc(P.dateTime(d.asOf))}. Figures are for the branch selected at the top.</p>`;
  }

  const CHECK_LINK = { classes: ['pharmacy-settings.html#classes', 'Review classes'], pharmacist: ['pharmacy-settings.html#staff', 'Add credentials'], dispensers: ['pharmacy-settings.html#staff', 'Add credentials'], medicines: ['pharmacy-settings.html#import', 'Set up medicines'], rooms: ['pharmacy-settings.html#rules', 'Add storage places'], suppliers: ['pharmacy-compliance.html#suppliers', 'Approve suppliers'] };
  function renderSetup(host, s) {
    const open = s.checks.filter((c) => !c.ok);
    if (!open.length) { host.innerHTML = ''; return; }
    host.innerHTML = `<div class="card ph-card-pad" style="margin-bottom:var(--space-4)">
      <div class="ph-h"><h3>${s.ready ? 'Almost there' : 'Finish setting up your pharmacy'}</h3>${P.badge(s.ready ? 'active' : 'pending', s.ready ? 'Ready to dispense' : 'Not ready yet')}</div>
      <p class="text-sm text-secondary" style="margin:0 0 var(--space-2)">${esc(s.country || '')}${s.regulator ? ` · regulator: ${esc(s.regulator)}` : ''}. Items marked required stop dispensing until they are done.</p>
      ${s.checks.map((c) => { const l = CHECK_LINK[c.key]; return `<div class="ph-check"><span class="ph-dot ${c.ok ? 'ok' : c.blocker ? 'no' : 'opt'}">${c.ok ? '✓' : c.blocker ? '!' : '•'}</span><div style="flex:1"><div class="text-sm">${esc(c.message)}</div>${!c.ok && c.blocker ? '<div class="ph-note">Required</div>' : ''}</div>${!c.ok && l ? `<a class="btn btn-secondary btn-sm" href="${l[0]}">${esc(l[1])}</a>` : ''}</div>`; }).join('')}
    </div>`;
  }
})();
