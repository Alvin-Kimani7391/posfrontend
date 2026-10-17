/** Batches & expiry: stock by batch, expiry watch, stock with no expiry recorded, quarantine / release / write-off, recall by batch number. */
(function () {
  const K = window.ModuleKit;
  let contentEl, view = 'batches', list = null, days = 30;
  let thr = { criticalDays: 30, warningDays: 90 };

  document.addEventListener('DOMContentLoaded', () => {
    contentEl = window.AppShell.mount({ title: 'Batches & expiry' });
    if (!contentEl) return;
    contentEl.innerHTML = `
      <div class="page-header"><div><h1>Batches &amp; expiry</h1><p>Stock by batch, what is about to expire, and recalls.</p></div>
        <div class="flex gap-2" style="flex-wrap:wrap"><button class="btn btn-secondary" id="check-btn" data-requires-permission="batches.manage">Check now</button><button class="btn btn-secondary" id="alerts-btn" data-requires-permission="batches.manage">Alert settings</button><button class="btn btn-secondary" id="recall-btn" data-requires-permission="batches.manage">Recall a batch</button></div></div>
      <div id="exp-banner"></div>
      <div class="tabs" style="margin-bottom:var(--space-4);overflow-x:auto;white-space:nowrap"><button class="tab-btn active" data-v="batches">All batches</button><button class="tab-btn" data-v="expiry">Expiry watch</button><button class="tab-btn" data-v="unbatched">No expiry recorded <span class="badge badge-warning" id="unb-count" style="display:none"></span></button></div>
      <div id="mk-root"></div>`;
    contentEl.querySelectorAll('.tab-btn').forEach((b) => b.addEventListener('click', () => setView(b.dataset.v)));
    document.getElementById('recall-btn').addEventListener('click', recall);
    document.getElementById('alerts-btn').addEventListener('click', alertSettings);
    document.getElementById('check-btn').addEventListener('click', checkNow);
    window.Api.get('/batches/alert-settings').then(({ data }) => { thr = { criticalDays: data.criticalDays, warningDays: data.warningDays }; show(); }).catch(() => {});
    window.AppShell.onBranchChange?.(() => { show(); loadBanner(); });
    window.Permissions.applyPermissionGates(contentEl, window.AppShell.getUser());
    show();
    loadBanner();
  });

  function setView(v) {
    view = v;
    contentEl.querySelectorAll('.tab-btn').forEach((x) => x.classList.toggle('active', x.dataset.v === v));
    show();
  }

  const wh = () => !!(window.AppShell.hasFeature && window.AppShell.hasFeature('multiWarehouse'));
  const loc = (b) => (b.location === 'WAREHOUSE' ? '<span class="badge badge-info">Warehouse</span>' : '<span class="badge badge-neutral">Retail</span>');
  const name = (b) => K.esc(b.productId?.name || '-');
  // Expiry dates are calendar days stored at UTC midnight: show them in UTC so the day never shifts with the viewer's time zone.
  const expDate = (v) => (v ? new Date(v).toLocaleDateString(undefined, { timeZone: 'UTC' }) : '-');
  const todayUtc = () => { const n = new Date(); return Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()); };
  const daysLeft = (v) => Math.round((new Date(v).getTime() - todayUtc()) / 86400000);
  function dueBadge(v) {
    if (!v) return '';
    const d = daysLeft(v);
    if (d < 0) return `<span class="badge badge-danger">Expired ${-d} day${d === -1 ? '' : 's'} ago</span>`;
    if (d === 0) return '<span class="badge badge-danger">Expires today</span>';
    return `<span class="badge ${d <= thr.criticalDays ? 'badge-danger' : d <= thr.warningDays ? 'badge-warning' : 'badge-neutral'}">${d} day${d === 1 ? '' : 's'} left</span>`;
  }
  const actions = (b) => (K.can('batches.manage') ? [
    b.status === 'active' ? K.btn('quarantine', 'Quarantine') : '',
    b.status === 'quarantined' ? K.btn('release', 'Release') : '',
    ['active', 'quarantined', 'expired'].includes(b.status) && b.quantity > 0 ? K.btn('dispose', 'Write off') : '',
  ].join(' ') : '');

  /** Top strip: what needs attention right now, whichever tab is open. */
  async function loadBanner() {
    const el = document.getElementById('exp-banner');
    const badge = document.getElementById('unb-count');
    if (!el) return;
    const branchId = K.branchId();
    if (!branchId) { el.innerHTML = ''; return; }
    const [exp, unb] = await Promise.all([
      window.Api.get('/batches/expiring', { branchId, days: 30 }).then((r) => r.data).catch(() => null),
      window.Api.get('/batches/unbatched', { branchId }).then((r) => r.data).catch(() => null),
    ]);
    const parts = [];
    if (exp?.expired?.length) parts.push(`<strong>${exp.expired.length}</strong> batch${exp.expired.length === 1 ? '' : 'es'} already expired and still in stock`);
    if (exp?.expiring?.length) parts.push(`<strong>${exp.expiring.length}</strong> expiring within 30 days`);
    if (unb?.items?.length) parts.push(`<strong>${unb.items.length}</strong> product${unb.items.length === 1 ? '' : 's'} with stock that has no expiry date recorded`);
    if (badge) { badge.textContent = unb?.items?.length || ''; badge.style.display = unb?.items?.length ? '' : 'none'; }
    el.innerHTML = parts.length
      ? `<div class="card" style="margin-bottom:var(--space-4);border-left:4px solid var(--color-warning, #d97706)"><div class="card-body text-sm" style="display:flex;gap:var(--space-3);flex-wrap:wrap;align-items:center;justify-content:space-between"><span>${parts.join(' &middot; ')}</span><span style="display:flex;gap:var(--space-2);flex-wrap:wrap"><button class="btn btn-secondary btn-sm" data-go="expiry">Open expiry watch</button>${unb?.items?.length ? '<button class="btn btn-secondary btn-sm" data-go="unbatched">Add missing expiry dates</button>' : ''}</span></div></div>`
      : '';
    el.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => setView(b.dataset.go)));
  }

  function show() {
    const root = document.getElementById('mk-root');
    if (view === 'batches') {
      list = K.listPage({
        container: root, endpoint: '/batches', search: true, searchPlaceholder: 'Search batch number',
        query: () => ({ branchId: K.branchId() }),
        filters: [{ key: 'status', label: 'All statuses', options: ['active', 'quarantined', 'recalled', 'expired', 'depleted'] },
          ...(wh() ? [{ key: 'location', label: 'Retail + warehouse', options: [['RETAIL', 'Retail only'], ['WAREHOUSE', 'Warehouse only']] }] : [])],
        columns: [
          { label: 'Product', render: name }, { label: 'Batch', render: (b) => K.esc(b.batchNumber) },
          ...(wh() ? [{ label: 'Where', render: loc }] : []),
          { label: 'Qty left', align: 'right', render: (b) => b.quantity },
          { label: 'Expiry', render: (b) => (b.expiryDate ? `${expDate(b.expiryDate)} ${b.status === 'active' && b.quantity > 0 ? dueBadge(b.expiryDate) : ''}` : '-') },
          { label: 'Status', render: (b) => K.badge(b.status) },
        ],
        rowActions: actions, onAction: act,
        emptyText: 'No batches yet', emptyMessage: 'Batches appear when you receive stock for products that track batches or expiry.',
      });
    } else if (view === 'expiry') renderExpiry(root);
    else renderUnbatched(root);
  }

  async function renderExpiry(root) {
    root.innerHTML = `<div class="card"><div class="toolbar"><label class="text-sm">Show items expiring within <select class="select" id="exp-days" style="display:inline-block;width:auto">${[7, 14, 30, 60, 90].map((d) => `<option value="${d}" ${d === days ? 'selected' : ''}>${d} days</option>`).join('')}</select></label></div><div class="card-body" id="exp-body">Loading…</div></div>`;
    document.getElementById('exp-days').addEventListener('change', (e) => { days = Number(e.target.value); renderExpiry(root); });
    const branchId = K.branchId();
    if (!branchId) { document.getElementById('exp-body').innerHTML = '<p class="text-muted">Select a branch first.</p>'; return; }
    try {
      const { data } = await window.Api.get('/batches/expiring', { branchId, days });
      const table = (rows, emptyMsg) => rows.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Product</th><th>Batch</th><th style="text-align:right">Qty</th><th>Expiry</th><th></th><th></th></tr></thead><tbody>${rows.map((b) => `<tr data-id="${b._id}"><td>${name(b)}</td><td>${K.esc(b.batchNumber)}</td><td style="text-align:right">${b.quantity}</td><td>${expDate(b.expiryDate)}</td><td>${dueBadge(b.expiryDate)}</td><td style="text-align:right">${K.can('batches.manage') ? K.btn('dispose', 'Write off') : ''}</td></tr>`).join('')}</tbody></table></div>` : `<p class="text-muted">${emptyMsg}</p>`;
      document.getElementById('exp-body').innerHTML = `
        <div class="mk-section">Already expired (${data.expired.length}) · cost value ${K.money((data.expiredCostValue || 0) / 100)}</div>${table(data.expired, 'Nothing expired is still in stock.')}
        <div class="mk-section">Expiring in ${days} days (${data.expiring.length}) · cost value ${K.money((data.expiringCostValue || 0) / 100)}</div>${table(data.expiring, `Nothing expires in the next ${days} days. Stock received without an expiry date is listed under “No expiry recorded”.`)}`;
      const all = [...data.expired, ...data.expiring];
      document.querySelectorAll('#exp-body [data-act="dispose"]').forEach((b) => b.addEventListener('click', () => act('dispose', all.find((x) => x._id === b.closest('tr').dataset.id), () => { renderExpiry(root); loadBanner(); })));
    } catch (err) { document.getElementById('exp-body').innerHTML = K.esc(err.message); }
  }

  /** Stock already on the shelf that has no batch / expiry date: lets the shop add it so it shows up in the expiry watch. */
  async function renderUnbatched(root) {
    root.innerHTML = '<div class="card"><div class="card-body" id="unb-body">Loading…</div></div>';
    const body = document.getElementById('unb-body');
    const branchId = K.branchId();
    if (!branchId) { body.innerHTML = '<p class="text-muted">Select a branch first.</p>'; return; }
    try {
      const { data } = await window.Api.get('/batches/unbatched', { branchId });
      const items = data.items || [];
      if (!items.length) { body.innerHTML = '<p class="text-muted">Every unit of your batch / expiry-tracked products has an expiry date recorded.</p>'; return; }
      body.innerHTML = `<p class="text-sm text-secondary" style="margin-bottom:var(--space-3)">These products have stock on hand that was never given a batch and expiry date, so it cannot appear in the expiry watch. Add the details printed on the pack. Your stock quantity does not change.</p>
        <div class="table-wrap"><table class="table"><thead><tr><th>Product</th><th style="text-align:right">Units without expiry</th><th></th></tr></thead><tbody>${items.map((it, i) => `<tr data-i="${i}"><td>${K.esc(it.name)}${it.variantLabel ? ` <span class="text-muted">(${K.esc(it.variantLabel)})</span>` : ''}</td><td style="text-align:right">${it.quantityUnbatched}</td><td style="text-align:right">${K.can('batches.manage') ? K.btn('backfill', 'Add expiry') : ''}</td></tr>`).join('')}</tbody></table></div>`;
      body.querySelectorAll('[data-act="backfill"]').forEach((b) => b.addEventListener('click', () => backfill(items[Number(b.closest('tr').dataset.i)], () => { renderUnbatched(root); loadBanner(); })));
    } catch (err) { body.innerHTML = K.esc(err.message); }
  }

  function backfill(it, reload) {
    const label = it.name + (it.variantLabel ? ` (${it.variantLabel})` : '');
    K.formModal({
      title: `Add expiry: ${label}`, submitLabel: 'Save',
      intro: `${it.quantityUnbatched} unit(s) are on hand without an expiry date. Enter the batch for some or all of them. If the stock has several expiry dates, repeat this for each one.`,
      values: { quantity: it.quantityUnbatched },
      fields: [
        { name: 'batchNumber', label: 'Batch / lot number', required: true, hint: 'Printed on the pack. No number? Use any reference, e.g. EXP-2026-11.' },
        { name: 'expiryDate', label: 'Expiry date', type: 'date', required: !!it.trackExpiry },
        { name: 'quantity', label: 'Units in this batch', type: 'number', step: 'any', min: 0, required: true },
      ],
      onSubmit: async (d) => {
        await window.Api.post('/batches/backfill', { ...d, branchId: K.branchId(), productId: it.productId, variantId: it.variantId || undefined });
        window.UI.toast.success('Expiry recorded');
        reload();
      },
    });
  }

  function act(a, b, reload) {
    const done = (msg) => { window.UI.toast.success(msg); (reload || (() => show()))(); loadBanner(); };
    if (a === 'dispose') {
      K.formModal({ title: `Write off batch ${b.batchNumber}`, intro: `This removes the remaining ${b.quantity} from stock.`, submitLabel: 'Write off',
        fields: [{ name: 'type', label: 'Reason type', type: 'select', options: [['EXPIRED', 'Expired'], ['DAMAGE', 'Damaged'], ['LOST', 'Lost']] }, { name: 'reason', label: 'Reason', required: true }],
        onSubmit: async (d) => { await window.Api.post(`/batches/${b._id}/dispose`, d); done('Batch written off'); } });
    } else {
      const verb = a === 'quarantine' ? 'Quarantine' : 'Release';
      K.formModal({ title: `${verb} batch ${b.batchNumber}`, submitLabel: verb, intro: a === 'quarantine' ? 'Quarantined stock cannot be sold.' : '',
        fields: [{ name: 'reason', label: 'Reason', required: true }],
        onSubmit: async (d) => { await window.Api.post(`/batches/${b._id}/${a}`, d); done(`Batch ${a === 'quarantine' ? 'quarantined' : 'released'}`); } });
    }
  }

  /** Thresholds, the daily in-app notification, and (Kenya) the optional SMS to the owner. */
  async function alertSettings() {
    let cur; let sms = null;
    try { cur = (await window.Api.get('/batches/alert-settings')).data; } catch (e) { window.UI.toast.error(e.message); return; }
    try { sms = (await window.Api.get('/sms-alerts/settings')).data; } catch { /* no permission / not Kenya: in-app alerts only */ }
    const dg = sms && sms.settings && sms.settings.expiryDigest;
    const fields = [
      { name: 'criticalDays', label: 'Red alert: expires within (days)', type: 'number', min: 1, required: true },
      { name: 'warningDays', label: 'Orange alert: expires within (days)', type: 'number', min: 1, required: true },
      { name: 'notifyEnabled', label: 'Send a notification every morning when stock is expired or about to expire', type: 'checkbox' },
    ];
    if (dg) {
      fields.push(
        { name: 'smsEnabled', label: 'Also text the shop owner (uses SMS credits)', type: 'checkbox' },
        { name: 'smsFrequency', label: 'How often to text', type: 'select', options: [['weekly', 'Weekly summary'], ['daily', 'Every day there is something to report']] },
        { name: 'smsDays', label: 'Text about stock expiring within (days)', type: 'number', min: 1 },
        { name: 'smsTemplate', label: 'Message (empty = default)', type: 'textarea', hint: 'You can use {shop} {expired} {expiring} {days} {items}. Plain characters only.' },
      );
    }
    const smsNote = dg
      ? `<br>Texts need an approved Sender ID and SMS credits${sms.ready ? ` (you have ${K.esc(String(sms.credits))}).` : ' &mdash; set these up on the SMS page first.'}`
      : '';
    K.formModal({
      title: 'Expiry alert settings', submitLabel: 'Save',
      intro: `Management gets an in-app notification each morning (6:00) listing expired and expiring stock. Nothing is written off automatically.${smsNote}`,
      values: {
        criticalDays: cur.criticalDays, warningDays: cur.warningDays, notifyEnabled: cur.notifyEnabled,
        ...(dg ? { smsEnabled: dg.enabled, smsFrequency: dg.frequency, smsDays: dg.daysBefore, smsTemplate: dg.template } : {}),
      },
      fields,
      onSubmit: async (d) => {
        const saved = (await window.Api.put('/batches/alert-settings', { criticalDays: Number(d.criticalDays), warningDays: Number(d.warningDays), notifyEnabled: !!d.notifyEnabled })).data;
        if (dg) {
          try {
            await window.Api.put('/sms-alerts/settings', { expiryDigest: { enabled: !!d.smsEnabled, frequency: d.smsFrequency || 'weekly', daysBefore: Number(d.smsDays) || 30, template: d.smsTemplate || '' } });
          } catch (e) { window.UI.toast.warning(`Alert settings saved, but the SMS part was not: ${e.message}`); }
        }
        thr = { criticalDays: saved.criticalDays, warningDays: saved.warningDays };
        window.UI.toast.success('Expiry alert settings saved');
        show(); loadBanner();
      },
    });
  }

  /** Run the daily check right now (also sends today's notification). */
  async function checkNow() {
    const btn = document.getElementById('check-btn');
    window.UI.setButtonLoading(btn, true, 'Checking…');
    try {
      const { data } = await window.Api.post('/batches/alerts/run', {});
      const s = data.summary || {};
      const total = (s.expired || 0) + (s.critical || 0) + (s.warning || 0);
      window.UI.toast.success(total ? `${s.expired || 0} expired, ${s.critical || 0} expiring soon, ${s.warning || 0} later. Management was notified.` : 'Nothing is expired or about to expire.');
    } catch (e) { window.UI.toast.error(e.message); } finally { window.UI.setButtonLoading(btn, false); }
  }

  function recall() {
    K.formModal({ title: 'Recall a batch', submitLabel: 'Recall', intro: 'Marks every batch with this number as recalled so it cannot be sold.',
      fields: [{ name: 'batchNumber', label: 'Batch number', required: true }, { name: 'reason', label: 'Reason', required: true }],
      onSubmit: async (d) => { const { data } = await window.Api.post('/batches/recall', d); window.UI.toast.success(data.message || 'Batch recalled'); show(); loadBanner(); } });
  }
})();
