/** Repairs: take in a device, estimate, get approval, repair, take payment, hand over. */
(function () {
  const K = window.ModuleKit;
  let list;

  document.addEventListener('DOMContentLoaded', () => {
    const el = window.AppShell.mount({ title: 'Repairs' });
    if (!el) return;
    el.innerHTML = `<div class="page-header"><div><h1>Repairs</h1><p>Devices brought in for repair, from check-in to collection.</p></div>
      <button class="btn btn-primary" id="new-repair" data-requires-permission="repairs.manage">${window.Icons.get('plus')} Take in a device</button></div><div id="mk-root"></div>`;
    document.getElementById('new-repair').addEventListener('click', create);
    window.Permissions.applyPermissionGates(el, window.AppShell.getUser());
    load(); window.AppShell.onBranchChange?.(load);
    window.AppShell.runUrlAction?.('new-repair');
  });

  function load() {
    list = K.listPage({
      container: document.getElementById('mk-root'), endpoint: '/repairs', query: () => ({ branchId: K.branchId() }),
      filters: [{ key: 'status', label: 'All statuses', options: ['RECEIVED', 'DIAGNOSED', 'AWAITING_APPROVAL', 'APPROVED', 'AWAITING_PARTS', 'IN_PROGRESS', 'READY', 'COLLECTED', 'UNREPAIRABLE', 'CANCELLED'] }],
      columns: [
        { label: 'Job', render: (j) => `<strong>${K.esc(j.jobNumber)}</strong>` }, { label: 'Customer', render: (j) => K.esc(j.customerName) },
        { label: 'Device', render: (j) => K.esc([j.device?.brand, j.device?.model].filter(Boolean).join(' ') || '-') },
        { label: 'Promised', render: (j) => K.date(j.promisedDate) }, { label: 'Balance', align: 'right', render: (j) => K.money(j.balance) },
        { label: 'Status', render: (j) => K.badge(j.status) },
      ],
      rowActions: () => K.btn('open', 'Open'), onAction: (a, j, reload) => window.JobWorkflow.open('repair', j._id, reload),
      emptyText: 'No repair jobs', emptyMessage: 'Take in a device to start a repair job.',
    });
  }

  function create() {
    K.formModal({ title: 'Take in a device', submitLabel: 'Create repair job', maxWidth: '560px',
      fields: [
        { name: 'customerName', label: 'Customer name', required: true }, { name: 'customerPhone', label: 'Customer phone', required: true },
        { name: 'brand', label: 'Brand' }, { name: 'model', label: 'Model' }, { name: 'serialNumber', label: 'Serial / IMEI (links warranty if sold by you)' },
        { name: 'condition', label: 'Condition on arrival', placeholder: 'Cracked screen, scratches…' }, { name: 'accessories', label: 'Accessories left (comma separated)', placeholder: 'charger, case' },
        { name: 'fault', label: 'What is wrong?', type: 'textarea', required: true }, { name: 'promisedDate', label: 'Promised date', type: 'date' }],
      onSubmit: async (d) => {
        const body = { branchId: K.branchId(), customerName: d.customerName, customerPhone: d.customerPhone, fault: d.fault, promisedDate: d.promisedDate,
          device: { brand: d.brand, model: d.model, serialNumber: d.serialNumber, condition: d.condition, accessories: d.accessories ? d.accessories.split(',').map((s) => s.trim()).filter(Boolean) : undefined } };
        Object.keys(body.device).forEach((x) => body.device[x] === undefined && delete body.device[x]);
        Object.keys(body).forEach((x) => body[x] === undefined && delete body[x]);
        const { data } = await window.Api.post('/repairs', body);
        window.UI.toast.success('Repair job created'); list.reload(); setTimeout(() => window.JobWorkflow.open('repair', data.job._id, list.reload), 200);
      } });
  }
})();
