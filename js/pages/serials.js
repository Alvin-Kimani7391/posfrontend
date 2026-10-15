/** Serial numbers / IMEI: find any unit, see its sale + warranty + claims, inspect returned units. */
(function () {
  const K = window.ModuleKit;
  let contentEl, list;

  document.addEventListener('DOMContentLoaded', () => {
    contentEl = window.AppShell.mount({ title: 'Serial numbers' });
    if (!contentEl) return;
    contentEl.innerHTML = `<div class="page-header"><div><h1>Serial numbers</h1><p>Track every unit by serial number or IMEI.</p></div>
      <form id="lk-form" class="flex gap-2"><input class="input" id="lk-input" placeholder="Look up a serial / IMEI" minlength="3" required /><button class="btn btn-primary">Look up</button></form></div><div id="mk-root"></div>`;
    document.getElementById('lk-form').addEventListener('submit', (e) => { e.preventDefault(); lookup(document.getElementById('lk-input').value.trim()); });
    load(); window.AppShell.onBranchChange?.(load);
  });

  function load() {
    list = K.listPage({
      container: document.getElementById('mk-root'), endpoint: '/serials', search: true, searchPlaceholder: 'Search serial number',
      query: () => ({ branchId: K.branchId() }),
      filters: [{ key: 'status', label: 'All statuses', options: ['in_stock', 'sold', 'damaged', 'returned'] },
        ...(window.AppShell.hasFeature?.('multiWarehouse') ? [{ key: 'location', label: 'Retail + warehouse', options: [['RETAIL', 'Retail only'], ['WAREHOUSE', 'Warehouse only']] }] : [])],
      columns: [
        { label: 'Serial / IMEI', render: (u) => `<strong>${K.esc(u.serialNumber)}</strong>` }, { label: 'Product', render: (u) => K.esc(u.productId?.name || '-') },
        { label: 'Status', render: (u) => K.badge(u.status) },
        ...(window.AppShell.hasFeature?.('multiWarehouse') ? [{ label: 'Where', render: (u) => (u.location === 'WAREHOUSE' ? '<span class="badge badge-info">Warehouse</span>' : '<span class="badge badge-neutral">Retail</span>') }] : []),
        { label: 'Warranty ends', render: (u) => K.date(u.warrantyEnd) },
      ],
      rowActions: (u) => K.btn('view', 'Details') + (u.status === 'returned' && K.can('serials.manage') ? ` ${K.btn('inspect', 'Inspect')}` : ''),
      onAction: (a, u, reload) => (a === 'view' ? lookup(u.serialNumber) : inspect(u, reload)),
      emptyText: 'No serial numbers yet', emptyMessage: 'Receive stock of a product that tracks serial numbers.',
    });
  }

  async function lookup(serial) {
    try {
      const { data } = await window.Api.get('/serials/lookup', { serial });
      const u = data.unit;
      window.UI.openModal({ title: `Unit ${u.serialNumber}`, maxWidth: '640px', bodyHtml: `
        ${K.kv([['Product', K.esc(u.productId?.name)], ['Status', K.badge(u.status)], ['Condition', K.esc(u.condition)], ['Sold', K.date(u.soldAt)], ['Receipt', K.esc(data.sale?.receiptNumber)], ['Customer', K.esc(u.customerId?.name)], ['Shop warranty ends', K.date(u.warrantyEnd)], ['Warranty state', K.esc(data.warranty?.shop)], ['Supplier', K.esc(u.supplierId?.name)]])}
        <div class="mk-section">Warranty claims</div>${data.claims.length ? data.claims.map((c) => `<div class="text-sm">${K.esc(c.claimNumber)} · ${K.badge(c.status)} · ${K.date(c.createdAt)}</div>`).join('') : '<div class="text-sm text-muted">None</div>'}
        <div class="mk-section">Repairs</div>${data.repairs.length ? data.repairs.map((r) => `<div class="text-sm">${K.esc(r.jobNumber)} · ${K.badge(r.status)} · ${K.date(r.createdAt)}</div>`).join('') : '<div class="text-sm text-muted">None</div>'}` });
    } catch (e) { window.UI.toast.error(e.message); }
  }

  function inspect(u, reload) {
    K.formModal({ title: `Inspect ${u.serialNumber}`, submitLabel: 'Save', intro: 'Decide what happens to this returned unit.',
      fields: [{ name: 'outcome', label: 'Outcome', type: 'select', options: [['RESTOCK', 'Good - put back in stock'], ['DAMAGED', 'Damaged']] }, { name: 'note', label: 'Note' }],
      onSubmit: async (d) => { await window.Api.post(`/serials/${u._id}/inspect`, d); window.UI.toast.success('Unit inspected'); reload(); } });
  }
})();
