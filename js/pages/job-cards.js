/** Garage job cards: check a vehicle in, estimate, approve, work, quality check, pay, hand over. */
(function () {
  const K = window.ModuleKit;
  let list;

  document.addEventListener('DOMContentLoaded', () => {
    const el = window.AppShell.mount({ title: 'Job cards' });
    if (!el) return;
    el.innerHTML = `<div class="page-header"><div><h1>Job cards</h1><p>Workshop jobs from check-in to hand-over.</p></div>
      <button class="btn btn-primary" id="new-job" data-requires-permission="jobcards.manage">${window.Icons.get('plus')} Check in a vehicle</button></div><div id="mk-root"></div>`;
    document.getElementById('new-job').addEventListener('click', create);
    window.Permissions.applyPermissionGates(el, window.AppShell.getUser());
    load(); window.AppShell.onBranchChange?.(load);
    window.AppShell.runUrlAction?.('new-job');
  });

  function load() {
    list = K.listPage({
      container: document.getElementById('mk-root'), endpoint: '/job-cards', search: true, searchPlaceholder: 'Plate or job number', query: () => ({ branchId: K.branchId() }),
      filters: [{ key: 'status', label: 'All statuses', options: ['CHECKED_IN', 'DIAGNOSED', 'AWAITING_APPROVAL', 'APPROVED', 'AWAITING_PARTS', 'IN_PROGRESS', 'QUALITY_CHECK', 'READY', 'COLLECTED', 'CANCELLED'] }],
      columns: [
        { label: 'Job', render: (j) => `<strong>${K.esc(j.jobNumber)}</strong>` }, { label: 'Vehicle', render: (j) => K.esc(`${j.plate} ${j.vehicleLabel || ''}`) },
        { label: 'Customer', render: (j) => K.esc(j.customerName) }, { label: 'Promised', render: (j) => K.date(j.promisedDate) },
        { label: 'Balance', align: 'right', render: (j) => K.money(j.balance) }, { label: 'Status', render: (j) => K.badge(j.status) },
      ],
      rowActions: () => K.btn('open', 'Open'), onAction: (a, j, reload) => window.JobWorkflow.open('jobcard', j._id, reload),
      emptyText: 'No job cards', emptyMessage: 'Check a vehicle in to open the first job card.',
    });
  }

  function create() {
    K.formModal({ title: 'Check in a vehicle', submitLabel: 'Open job card', maxWidth: '560px',
      intro: 'Type the plate. If the vehicle is not registered yet, add it first under Vehicles.',
      fields: [
        { name: 'plate', label: 'Number plate', required: true }, { name: 'customerName', label: 'Customer name (if different from owner)' }, { name: 'customerPhone', label: 'Customer phone' },
        { name: 'odometerIn', label: 'Odometer now (km)', type: 'number', min: 0, required: true },
        { name: 'fuelLevel', label: 'Fuel level', type: 'select', options: [['', '-'], 'EMPTY', 'QUARTER', 'HALF', 'THREE_QUARTER', 'FULL'] },
        { name: 'conditionNotes', label: 'Condition notes', placeholder: 'Dents, scratches, warning lights' }, { name: 'itemsLeftInCar', label: 'Items left in car (comma separated)' },
        { name: 'complaint', label: 'Customer complaint', type: 'textarea', required: true }, { name: 'promisedDate', label: 'Promised date', type: 'date' }],
      onSubmit: async (d) => {
        let vehicle;
        try { vehicle = (await window.Api.get('/vehicles/lookup', { plate: d.plate })).data.vehicle; } catch { throw new Error('That plate is not registered. Add the vehicle under Vehicles first.'); }
        if (!vehicle) throw new Error('That plate is not registered. Add the vehicle under Vehicles first.');
        const body = { branchId: K.branchId(), vehicleId: vehicle._id, customerName: d.customerName || vehicle.ownerName, customerPhone: d.customerPhone || vehicle.ownerPhone,
          odometerIn: d.odometerIn, fuelLevel: d.fuelLevel, conditionNotes: d.conditionNotes, complaint: d.complaint, promisedDate: d.promisedDate,
          itemsLeftInCar: d.itemsLeftInCar ? d.itemsLeftInCar.split(',').map((s) => s.trim()).filter(Boolean) : undefined };
        if (!body.customerName || !body.customerPhone) throw new Error('Enter the customer name and phone (the vehicle has no owner on file).');
        Object.keys(body).forEach((x) => body[x] === undefined && delete body[x]);
        const { data } = await window.Api.post('/job-cards', body);
        window.UI.toast.success('Job card opened'); list.reload(); setTimeout(() => window.JobWorkflow.open('jobcard', data.job._id, list.reload), 200);
      } });
  }
})();
