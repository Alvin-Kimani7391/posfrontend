/** Batches & expiry: stock by batch, expiry watch, quarantine / release / write-off, recall by batch number. */
(function () {
  const K = window.ModuleKit;
  let contentEl, view = 'batches', list = null, days = 30;

  document.addEventListener('DOMContentLoaded', () => {
    contentEl = window.AppShell.mount({ title: 'Batches & expiry' });
    if (!contentEl) return;
    contentEl.innerHTML = `
      <div class="page-header"><div><h1>Batches &amp; expiry</h1><p>Stock by batch, what is about to expire, and recalls.</p></div>
        <div class="flex gap-2"><button class="btn btn-secondary" id="recall-btn" data-requires-permission="batches.manage">Recall a batch</button></div></div>
      <div class="tabs" style="margin-bottom:var(--space-4)"><button class="tab-btn active" data-v="batches">All batches</button><button class="tab-btn" data-v="expiry">Expiry watch</button></div>
      <div id="mk-root"></div>`;
    contentEl.querySelectorAll('.tab-btn').forEach((b) => b.addEventListener('click', () => {
      view = b.dataset.v; contentEl.querySelectorAll('.tab-btn').forEach((x) => x.classList.toggle('active', x === b)); show();
    }));
    document.getElementById('recall-btn').addEventListener('click', recall);
    window.AppShell.onBranchChange?.(show);
    window.Permissions.applyPermissionGates(contentEl, window.AppShell.getUser());
    show();
  });

  const name = (b) => K.esc(b.productId?.name || '-');
  const actions = (b) => (K.can('batches.manage') ? [
    b.status === 'active' ? K.btn('quarantine', 'Quarantine') : '',
    b.status === 'quarantined' ? K.btn('release', 'Release') : '',
    ['active', 'quarantined', 'expired'].includes(b.status) && b.quantity > 0 ? K.btn('dispose', 'Write off') : '',
  ].join(' ') : '');

  function show() {
    const root = document.getElementById('mk-root');
    if (view === 'batches') {
      list = K.listPage({
        container: root, endpoint: '/batches', search: true, searchPlaceholder: 'Search batch number',
        query: () => ({ branchId: K.branchId() }),
        filters: [{ key: 'status', label: 'All statuses', options: ['active', 'quarantined', 'recalled', 'expired', 'depleted'] }],
        columns: [
          { label: 'Product', render: name }, { label: 'Batch', render: (b) => K.esc(b.batchNumber) },
          { label: 'Qty left', align: 'right', render: (b) => b.quantity }, { label: 'Expiry', render: (b) => K.date(b.expiryDate) },
          { label: 'Status', render: (b) => K.badge(b.status) },
        ],
        rowActions: actions, onAction: act,
        emptyText: 'No batches yet', emptyMessage: 'Batches appear when you receive stock for products that track batches.',
      });
    } else renderExpiry(root);
  }

  async function renderExpiry(root) {
    root.innerHTML = `<div class="card"><div class="toolbar"><label class="text-sm">Show items expiring within <select class="select" id="exp-days" style="display:inline-block;width:auto">${[7, 14, 30, 60, 90].map((d) => `<option value="${d}" ${d === days ? 'selected' : ''}>${d} days</option>`).join('')}</select></label></div><div class="card-body" id="exp-body">Loading…</div></div>`;
    document.getElementById('exp-days').addEventListener('change', (e) => { days = Number(e.target.value); renderExpiry(root); });
    try {
      const { data } = await window.Api.get('/batches/expiring', { branchId: K.branchId(), days });
      const table = (rows) => rows.length ? `<table class="table"><thead><tr><th>Product</th><th>Batch</th><th style="text-align:right">Qty</th><th>Expiry</th><th></th></tr></thead><tbody>${rows.map((b) => `<tr data-id="${b._id}"><td>${name(b)}</td><td>${K.esc(b.batchNumber)}</td><td style="text-align:right">${b.quantity}</td><td>${K.date(b.expiryDate)}</td><td style="text-align:right">${K.can('batches.manage') ? K.btn('dispose', 'Write off') : ''}</td></tr>`).join('')}</tbody></table>` : '<p class="text-muted">None.</p>';
      document.getElementById('exp-body').innerHTML = `
        <div class="mk-section">Already expired (${data.expired.length}) · cost value ${K.money((data.expiredCostValue || 0) / 100)}</div>${table(data.expired)}
        <div class="mk-section">Expiring in ${days} days (${data.expiring.length}) · cost value ${K.money((data.expiringCostValue || 0) / 100)}</div>${table(data.expiring)}`;
      const all = [...data.expired, ...data.expiring];
      document.querySelectorAll('#exp-body [data-act="dispose"]').forEach((b) => b.addEventListener('click', () => act('dispose', all.find((x) => x._id === b.closest('tr').dataset.id), () => renderExpiry(root))));
    } catch (err) { document.getElementById('exp-body').innerHTML = K.esc(err.message); }
  }

  function act(a, b, reload) {
    const done = (msg) => { window.UI.toast.success(msg); (reload || (() => show()))(); };
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

  function recall() {
    K.formModal({ title: 'Recall a batch', submitLabel: 'Recall', intro: 'Marks every batch with this number as recalled so it cannot be sold.',
      fields: [{ name: 'batchNumber', label: 'Batch number', required: true }, { name: 'reason', label: 'Reason', required: true }],
      onSubmit: async (d) => { const { data } = await window.Api.post('/batches/recall', d); window.UI.toast.success(data.message || 'Batch recalled'); show(); } });
  }
})();
