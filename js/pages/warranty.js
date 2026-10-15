/** Warranty claims: open a claim on a sold unit, decide repair / replacement / reject, record supplier claim. */
(function () {
  const K = window.ModuleKit;
  let list;

  document.addEventListener('DOMContentLoaded', () => {
    const el = window.AppShell.mount({ title: 'Warranty claims' });
    if (!el) return;
    el.innerHTML = `<div class="page-header"><div><h1>Warranty claims</h1><p>Open claims on units you sold and decide them.</p></div>
      <button class="btn btn-primary" id="new-claim" data-requires-permission="warranty.manage">${window.Icons.get('plus')} New claim</button></div><div id="mk-root"></div>`;
    document.getElementById('new-claim').addEventListener('click', create);
    window.Permissions.applyPermissionGates(el, window.AppShell.getUser());
    load(); window.AppShell.onBranchChange?.(load);
  });

  function load() {
    list = K.listPage({
      container: document.getElementById('mk-root'), endpoint: '/warranty-claims', search: true, searchPlaceholder: 'Serial number',
      query: () => ({ branchId: K.branchId() }),
      filters: [{ key: 'status', label: 'All statuses', options: ['OPEN', 'APPROVED', 'REJECTED', 'RESOLVED'] }],
      columns: [
        { label: 'Claim', render: (c) => `<strong>${K.esc(c.claimNumber)}</strong>` }, { label: 'Product', render: (c) => K.esc(c.nameSnapshot) },
        { label: 'Serial', render: (c) => K.esc(c.serialNumber) }, { label: 'Customer', render: (c) => K.esc(c.customerName || '-') },
        { label: 'Cover', render: (c) => K.badge(c.coverage === 'SHOP' ? 'in warranty' : 'expired') }, { label: 'Status', render: (c) => K.badge(c.status) },
      ],
      rowActions: () => K.btn('open', 'Open'), onAction: (a, c) => openClaim(c._id),
      emptyText: 'No warranty claims', emptyMessage: 'Open a claim when a customer brings back a faulty unit.',
    });
  }

  function create() {
    K.formModal({ title: 'New warranty claim', submitLabel: 'Open claim',
      fields: [{ name: 'serialNumber', label: 'Serial number / IMEI', required: true }, { name: 'fault', label: 'What is wrong?', type: 'textarea', required: true }],
      onSubmit: async (d) => { await window.Api.post('/warranty-claims', { branchId: K.branchId(), ...d }); window.UI.toast.success('Claim opened'); list.reload(); } });
  }

  async function openClaim(id) {
    let c;
    try { c = (await window.Api.get(`/warranty-claims/${id}`)).data.claim; } catch (e) { window.UI.toast.error(e.message); return; }
    const canDecide = c.status === 'OPEN' && K.can('warranty.decide');
    const modal = window.UI.openModal({ title: `Claim ${c.claimNumber}`, maxWidth: '640px',
      bodyHtml: `${K.kv([['Status', K.badge(c.status)], ['Product', K.esc(c.nameSnapshot)], ['Serial', K.esc(c.serialNumber)], ['Customer', K.esc(c.customerName)], ['Phone', K.esc(c.customerPhone)], ['Warranty ended', K.date(c.warrantyEndAtClaim)], ['Decision', K.esc(c.decision)], ['Reason', K.esc(c.decisionReason)], ['Replacement', K.esc(c.replacementSerialNumber)], ['Supplier claim', K.esc(c.supplierRma?.reference)]])}
        <div class="mk-section">Fault</div><div class="text-sm">${K.esc(c.fault)}</div>`,
      footerHtml: `${canDecide ? '<button class="btn btn-primary" data-a="decide">Decide claim</button>' : ''}${K.can('warranty.decide') && c.status !== 'OPEN' ? '<button class="btn btn-secondary" data-a="rma">Record supplier claim</button>' : ''}<button class="btn btn-secondary" data-a="close">Close</button>` });
    modal.querySelector('[data-a="close"]').addEventListener('click', () => window.UI.closeModal());
    modal.querySelector('[data-a="decide"]')?.addEventListener('click', () => { window.UI.closeModal(); decide(c); });
    modal.querySelector('[data-a="rma"]')?.addEventListener('click', () => { window.UI.closeModal(); rma(c); });
  }

  function decide(c) {
    K.formModal({ title: `Decide ${c.claimNumber}`, submitLabel: 'Save decision',
      intro: c.coverage === 'EXPIRED' ? 'The warranty has expired. Tick goodwill to approve anyway.' : '',
      fields: [
        { name: 'decision', label: 'Decision', type: 'select', options: [['REPAIR', 'Repair it'], ['REPLACEMENT', 'Replace it'], ['REJECT', 'Reject']] },
        { name: 'reason', label: 'Reason', required: true },
        { name: 'replacementSerialNumber', label: 'Replacement serial (for replacements)' },
        { name: 'goodwill', label: 'Goodwill (approve although warranty expired)', type: 'checkbox' }],
      onSubmit: async (d) => { await window.Api.post(`/warranty-claims/${c._id}/decide`, d); window.UI.toast.success('Claim decided'); list.reload(); } });
  }

  function rma(c) {
    K.formModal({ title: 'Supplier claim', submitLabel: 'Save',
      fields: [{ name: 'reference', label: 'Supplier reference / RMA number', required: true }, { name: 'outcome', label: 'Outcome', type: 'select', options: ['PENDING', 'CREDITED', 'REPLACED', 'REJECTED'] }, { name: 'note', label: 'Note' }],
      onSubmit: async (d) => { await window.Api.post(`/warranty-claims/${c._id}/supplier-claim`, d); window.UI.toast.success('Saved'); list.reload(); } });
  }
})();
