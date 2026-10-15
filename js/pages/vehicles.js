/** Vehicle register for garages: register vehicles, look them up by plate, see service history. */
(function () {
  const K = window.ModuleKit;
  let list;

  document.addEventListener('DOMContentLoaded', () => {
    const el = window.AppShell.mount({ title: 'Vehicles' });
    if (!el) return;
    el.innerHTML = `<div class="page-header"><div><h1>Vehicles</h1><p>Your customers' vehicles and their service history.</p></div>
      <button class="btn btn-primary" id="add-vehicle-btn" data-requires-permission="vehicles.manage">${window.Icons.get('plus')} Add vehicle</button></div><div id="mk-root"></div>`;
    document.getElementById('add-vehicle-btn').addEventListener('click', () => form());
    window.Permissions.applyPermissionGates(el, window.AppShell.getUser());
    list = K.listPage({
      container: document.getElementById('mk-root'), endpoint: '/vehicles', search: true, searchPlaceholder: 'Plate, make or owner',
      columns: [
        { label: 'Plate', render: (v) => `<strong>${K.esc(v.plateDisplay || v.plate)}</strong>` }, { label: 'Vehicle', render: (v) => K.esc([v.make, v.model, v.year].filter(Boolean).join(' ')) },
        { label: 'Owner', render: (v) => K.esc(v.ownerName || '-') }, { label: 'Odometer', align: 'right', render: (v) => `${(v.odometerKm || 0).toLocaleString()} km` },
        { label: 'Next service', render: (v) => K.date(v.nextServiceDate) },
      ],
      rowActions: (v) => K.btn('history', 'History') + (K.can('vehicles.manage') ? ` ${K.btn('edit', 'Edit')}` : ''),
      onAction: (a, v) => (a === 'history' ? history(v) : form(v)),
      emptyText: 'No vehicles yet', emptyMessage: 'Register a vehicle when a customer brings it in.',
    });
    window.AppShell.runUrlAction?.('add-vehicle-btn');
  });

  function form(v) {
    const edit = !!v;
    K.formModal({ title: edit ? `Edit ${v.plateDisplay || v.plate}` : 'Add vehicle', submitLabel: 'Save', maxWidth: '560px',
      values: edit ? { ...v, plate: v.plateDisplay || v.plate } : {},
      fields: [
        { name: 'plate', label: 'Number plate', required: true, placeholder: 'KDG 123A' }, { name: 'make', label: 'Make', required: true, placeholder: 'Toyota' },
        { name: 'model', label: 'Model' }, { name: 'year', label: 'Year', type: 'number' }, { name: 'color', label: 'Colour' },
        { name: 'vin', label: 'VIN / chassis' }, { name: 'ownerName', label: 'Owner name' }, { name: 'ownerPhone', label: 'Owner phone' },
        { name: 'odometerKm', label: 'Odometer (km)', type: 'number', min: 0 },
        { name: 'fuelType', label: 'Fuel', type: 'select', options: [['', '-'], 'PETROL', 'DIESEL', 'HYBRID', 'ELECTRIC', 'OTHER'] },
        { name: 'transmission', label: 'Transmission', type: 'select', options: [['', '-'], 'MANUAL', 'AUTOMATIC', 'OTHER'] },
        { name: 'insuranceExpiry', label: 'Insurance expiry', type: 'date' }, { name: 'notes', label: 'Notes', type: 'textarea' }],
      onSubmit: async (d) => {
        if (d.insuranceExpiry === undefined) delete d.insuranceExpiry;
        if (edit) await window.Api.put(`/vehicles/${v._id}`, d); else await window.Api.post('/vehicles', d);
        window.UI.toast.success('Vehicle saved'); list.reload();
      } });
  }

  async function history(v) {
    try {
      const { data } = await window.Api.get(`/vehicles/${v._id}/history`, { page: 1, limit: 20 });
      window.UI.openModal({ title: `${v.plateDisplay || v.plate} · service history`, maxWidth: '720px', bodyHtml: data.items.length
        ? `<table class="table"><thead><tr><th>Job</th><th>Collected</th><th>Complaint</th><th style="text-align:right">Total</th></tr></thead><tbody>${data.items.map((j) => `<tr><td>${K.esc(j.jobNumber)}</td><td>${K.date(j.collectedAt)}</td><td>${K.esc(j.complaint)}</td><td style="text-align:right">${K.money(j.total)}</td></tr>`).join('')}</tbody></table>`
        : '<p class="text-muted">No completed jobs for this vehicle yet.</p>' });
    } catch (e) { window.UI.toast.error(e.message); }
  }
})();
