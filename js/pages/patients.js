/** patients.js - pharmacy patient records, kept apart from shop customers. Every open/search is audit-logged by the server. */
(function () {
  const P = window.Pharmacy; const K = window.ModuleKit; const esc = P.esc;
  let list;

  document.addEventListener('DOMContentLoaded', () => P.page({ title: 'Patients', render }));

  function render(el) {
    el.innerHTML = `<div class="page-header"><div><h1>Patients</h1><p>Patient records for prescriptions and dispensing. Every time a record is opened it is logged.</p></div>
      <button class="btn btn-primary" id="ph-new-patient" data-requires-permission="patients.manage">${window.Icons.get('plus')} New patient</button></div><div id="mk-root"></div>`;
    el.querySelector('#ph-new-patient').addEventListener('click', () => P.patientForm({ onDone: () => list.reload() }));
    list = K.listPage({
      container: el.querySelector('#mk-root'), endpoint: '/pharmacy/patients', itemsKey: 'patients', search: true, searchParam: 'q', searchPlaceholder: 'Name, patient no, phone or ID number',
      columns: [
        { label: 'No.', render: (p) => `<strong>${esc(p.number)}</strong>` },
        { label: 'Name', render: (p) => esc(p.name) },
        { label: 'Phone', render: (p) => esc(p.phone || '-') },
        { label: 'Date of birth', render: (p) => P.date(p.dateOfBirth) },
      ],
      rowActions: () => K.btn('open', 'Open'),
      onAction: (a, p) => open(p._id),
      emptyText: 'No patients yet', emptyMessage: 'Add a patient when a prescription arrives.', emptyIcon: 'employees',
    });
  }

  async function open(id) {
    try {
      const [{ data: g }, { data: h }] = await Promise.all([window.Api.get(`/pharmacy/patients/${id}`), window.Api.get(`/pharmacy/patients/${id}/history`)]);
      const p = g.patient; const rx = h.prescriptions || [];
      const modal = window.UI.openModal({
        title: `${p.name} · ${p.number}`, maxWidth: '760px',
        bodyHtml: `${K.kv([['Phone', esc(p.phone)], ['Date of birth', P.date(p.dateOfBirth)], ['Sex', esc(p.sex)], ['ID', p.idNumber ? `${esc(String(p.idType || '').replace(/_/g, ' '))} ${esc(p.idNumber)}` : ''], ['Consent', p.consent ? esc(p.consent.basis) : '']])}
          ${(p.allergies || []).length ? `<div class="ph-warn-box"><strong>Allergies:</strong> ${p.allergies.map(esc).join(', ')}</div>` : '<p class="ph-note">No allergies recorded.</p>'}
          ${p.notes ? `<p class="text-sm">${esc(p.notes)}</p>` : ''}
          <h4 style="margin:var(--space-4) 0 var(--space-2)">Prescription history</h4>
          ${rx.length ? `<table class="table"><thead><tr><th>Prescription</th><th>Date</th><th>Prescriber</th><th>Medicines</th><th>Status</th></tr></thead><tbody>${rx.map((r) => `<tr><td><strong>${esc(r.number)}</strong></td><td>${P.date(r.prescriptionDate)}</td><td>${esc((r.prescriber || {}).name || '')}</td><td class="text-xs">${(r.items || []).map((i) => `${esc(i.nameSnapshot)} ${esc(P.qty(i.dispensedQty || 0))}/${esc(P.qty(i.prescribedQty))}`).join('<br>')}</td><td>${P.badge(r.status)}</td></tr>`).join('')}</tbody></table>` : '<p class="text-muted text-sm">No prescriptions yet.</p>'}`,
        footerHtml: `${P.can('pharmacy.settings') && p.status !== 'erased' ? '<button class="btn btn-ghost" data-act="erase" style="color:var(--color-danger)">Erase personal data</button>' : ''}${P.can('patients.manage') && p.status !== 'erased' ? '<button class="btn btn-secondary" data-act="edit">Edit</button>' : ''}<a class="btn btn-secondary" href="prescriptions.html?patient=${p._id}">Prescriptions</a><button class="btn btn-primary" data-act="close">Close</button>`,
      });
      modal.querySelector('[data-act="close"]').addEventListener('click', () => window.UI.closeModal());
      modal.querySelector('[data-act="edit"]')?.addEventListener('click', () => { window.UI.closeModal(); P.patientForm({ patient: p, onDone: () => list.reload() }); });
      modal.querySelector('[data-act="erase"]')?.addEventListener('click', () => {
        window.UI.closeModal();
        K.formModal({
          title: `Erase ${p.number}`, submitLabel: 'Erase personal data',
          intro: 'Removes the name, phone, ID, date of birth and allergies. Not allowed while the record is inside the retention period. This cannot be undone.',
          fields: [{ name: 'reason', label: 'Reason', required: true, type: 'textarea' }],
          onSubmit: async (d) => { await window.Api.post(`/pharmacy/patients/${p._id}/erase`, { reason: d.reason }); window.UI.toast.success('Record erased'); list.reload(); },
        });
      });
    } catch (e) { window.UI.toast.error(e.message); }
  }
})();
