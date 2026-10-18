/**
 * prescriptions.js - prescription intake, pharmacist review and the dispensing register.
 * The dispensing itself happens at the till (Sales): a normal sale that carries the prescription.
 */
(function () {
  const P = window.Pharmacy; const K = window.ModuleKit; const esc = P.esc;
  let rxList; let dList;
  const params = new URLSearchParams(location.search);

  document.addEventListener('DOMContentLoaded', () => P.page({ title: 'Prescriptions', render }));

  function render(el) {
    el.innerHTML = `<div class="page-header"><div><h1>Prescriptions</h1><p>Record prescriptions, have a pharmacist review them, then dispense at the till.</p></div>
      <div class="flex" style="gap:var(--space-2);flex-wrap:wrap">
        <a class="btn btn-secondary" href="sales.html?desk=rx" data-requires-permission="sales.create">${window.Icons.get('pill')} Dispense a prescription</a>
        <button class="btn btn-primary" id="ph-new-rx" data-requires-permission="prescriptions.intake">${window.Icons.get('plus')} New prescription</button></div></div><div id="ph-host"></div>`;
    el.querySelector('#ph-new-rx').addEventListener('click', () => intake());
    if (params.get('new') === '1' && P.can('prescriptions.intake')) intake(params.get('patient'));
    P.tabs(el.querySelector('#ph-host'), [
      { key: 'all', label: 'Prescriptions', perm: 'prescriptions.view', render: (h) => rxTab(h, false) },
      { key: 'review', label: 'Awaiting review', perm: 'prescriptions.review', render: (h) => rxTab(h, true) },
      { key: 'dispensings', label: 'Dispensing register', perm: 'prescriptions.view', render: dispTab },
    ]);
  }

  function rxTab(host, pending) {
    rxList = K.listPage({
      container: host, endpoint: '/pharmacy/prescriptions', itemsKey: 'prescriptions', search: true, searchPlaceholder: 'Prescription number (RX-…)',
      query: () => ({ ...(pending ? { pendingReview: 'true' } : {}), ...(params.get('patient') ? { patientId: params.get('patient') } : {}) }),
      filters: pending ? [] : [{ key: 'status', label: 'Any status', options: ['RECEIVED', 'VALIDATED', 'PARTIALLY_DISPENSED', 'DISPENSED', 'REJECTED', 'CANCELLED', 'EXPIRED'].map((s) => [s, P.label(s)]) }],
      columns: [
        { label: 'No.', render: (r) => `<strong>${esc(r.number)}</strong>${r.externalReference ? `<div class="text-xs text-muted">${esc(r.externalReference)}</div>` : ''}` },
        { label: 'Date', render: (r) => P.date(r.prescriptionDate) },
        { label: 'Prescriber', render: (r) => esc((r.prescriber || {}).name || '-') },
        { label: 'Medicines', render: (r) => `<div class="text-xs">${(r.items || []).map((i) => `${esc(i.nameSnapshot)} <span class="text-muted">${esc(P.qty(i.dispensedQty || 0))}/${esc(P.qty(i.prescribedQty))}</span>`).join('<br>')}</div>` },
        { label: 'Valid until', render: (r) => P.date(r.validUntil) },
        { label: 'Status', render: (r) => P.badge(r.status) },
      ],
      rowActions: (r) => K.btn('open', 'Open') + (['VALIDATED', 'PARTIALLY_DISPENSED'].includes(r.status) && P.can('sales.create') ? ` <a class="btn btn-primary btn-sm" href="sales.html?desk=rx&rx=${esc(r._id)}">Dispense</a>` : ''),
      onAction: (a, r) => open(r._id),
      emptyText: pending ? 'Nothing waiting for review' : 'No prescriptions yet', emptyMessage: pending ? '' : 'Record a prescription when a patient brings one in.', emptyIcon: 'clipboard',
    });
  }

  async function open(id) {
    try {
      const { data } = await window.Api.get(`/pharmacy/prescriptions/${id}`);
      const rx = data.prescription;
      let patient = null;
      if (P.can('patients.view')) { try { ({ data: { patient } } = await window.Api.get(`/pharmacy/patients/${rx.patientId}`)); } catch { /* no access */ } }
      const isOpen = ['RECEIVED', 'VALIDATED', 'PARTIALLY_DISPENSED'].includes(rx.status);
      const modal = window.UI.openModal({
        title: `${rx.number} · ${P.label(rx.status)}`, maxWidth: '760px',
        bodyHtml: `
          ${patient ? `<div class="ph-note" style="margin:0 0 var(--space-2)">Patient</div><div style="margin-bottom:var(--space-3)">${P.patientLine(patient)}</div>${(patient.allergies || []).length ? `<div class="ph-warn-box"><strong>Allergies:</strong> ${patient.allergies.map(esc).join(', ')}</div>` : ''}` : '<p class="ph-note">You do not have access to the patient record.</p>'}
          ${K.kv([['Prescription date', P.date(rx.prescriptionDate)], ['Valid until', P.date(rx.validUntil)], ['Prescriber', esc((rx.prescriber || {}).name)], ['Prescriber reg. no.', esc((rx.prescriber || {}).registrationNumber)], ['Facility', esc((rx.prescriber || {}).facility)], ['Paper reference', esc(rx.externalReference)], ['Repeats allowed', rx.maxDispensings ? esc(rx.maxDispensings) : ''], ['Min days between', rx.minIntervalDays ? esc(rx.minIntervalDays) : '']])}
          <h4 style="margin:0 0 var(--space-2)">Medicines</h4>
          <ul class="ph-rx-items">${(rx.items || []).map((i) => {
    const pct = i.prescribedQty ? Math.min(100, Math.round(((i.dispensedQty || 0) / i.prescribedQty) * 100)) : 0;
    return `<li><strong>${esc(i.nameSnapshot)}</strong> <span class="text-muted">${esc(i.strength || '')} ${esc(i.dosageForm || '')}</span><div class="text-xs">${esc(i.directions || 'No directions given')}</div><div class="text-xs text-secondary">Dispensed ${esc(P.qty(i.dispensedQty || 0))} of ${esc(P.qty(i.prescribedQty))}</div><div class="ph-bar"><i style="width:${pct}%"></i></div></li>`;
  }).join('')}</ul>
          ${rx.review ? `<p class="text-sm" style="margin-top:var(--space-3)"><strong>Review:</strong> ${esc(P.dateTime(rx.review.at))}${rx.review.note ? ` · ${esc(rx.review.note)}` : ''}${rx.review.allergyChecked ? ' · allergies checked' : ''}</p>` : ''}
          ${rx.closure ? `<p class="text-sm"><strong>${esc(P.label(rx.status))}:</strong> ${esc(rx.closure.reason || '')}</p>` : ''}
          ${(rx.interventions || []).length ? `<h4 style="margin:var(--space-3) 0 var(--space-2)">Pharmacist interventions</h4>${rx.interventions.map((i) => `<div class="text-sm" style="padding:4px 0"><span class="badge badge-info">${esc(P.label(i.type))}</span> ${esc(i.note)} <span class="text-muted text-xs">${esc(P.dateTime(i.at))}</span></div>`).join('')}` : ''}`,
        footerHtml: `
          ${isOpen && P.can('prescriptions.intake') ? '<button class="btn btn-ghost" data-act="cancel" style="color:var(--color-danger)">Cancel prescription</button>' : ''}
          ${isOpen && P.can('prescriptions.review') ? '<button class="btn btn-secondary" data-act="intervene">Record intervention</button>' : ''}
          ${rx.status === 'RECEIVED' && P.can('prescriptions.review') ? '<button class="btn btn-secondary" data-act="reject">Reject</button><button class="btn btn-primary" data-act="validate">Validate</button>' : ''}
          ${['VALIDATED', 'PARTIALLY_DISPENSED'].includes(rx.status) && P.can('sales.create') ? '<a class="btn btn-primary" href="sales.html?desk=rx&rx=${esc(rx._id)}">Dispense now</a>' : ''}
          <button class="btn btn-secondary" data-act="close">Close</button>`,
      });
      modal.querySelector('[data-act="close"]').addEventListener('click', () => window.UI.closeModal());
      modal.querySelector('[data-act="validate"]')?.addEventListener('click', () => { window.UI.closeModal(); review(rx, 'VALIDATE', patient); });
      modal.querySelector('[data-act="reject"]')?.addEventListener('click', () => { window.UI.closeModal(); review(rx, 'REJECT', patient); });
      modal.querySelector('[data-act="intervene"]')?.addEventListener('click', () => { window.UI.closeModal(); intervene(rx); });
      modal.querySelector('[data-act="cancel"]')?.addEventListener('click', () => { window.UI.closeModal(); cancel(rx); });
    } catch (e) { window.UI.toast.error(e.message); }
  }

  function review(rx, decision, patient) {
    const validate = decision === 'VALIDATE';
    K.formModal({
      title: `${validate ? 'Validate' : 'Reject'} ${rx.number}`, submitLabel: validate ? 'Validate prescription' : 'Reject prescription',
      intro: validate ? 'Only a pharmacist with a verified credential can do this. Check the prescription, the medicines and the patient’s allergies first.' : 'A reason is required.',
      fields: validate
        ? [{ name: 'allergyChecked', type: 'checkbox', label: `I have checked ${patient ? patient.name + '’s' : 'the patient’s'} allergy information` }, { name: 'note', label: 'Note (optional)', type: 'textarea' }]
        : [{ name: 'note', label: 'Reason for rejecting', required: true, type: 'textarea' }],
      onSubmit: async (d) => {
        if (validate && !d.allergyChecked) throw new Error('Confirm the allergy check first');
        await window.Api.post(`/pharmacy/prescriptions/${rx._id}/review`, { decision, note: d.note, allergyChecked: validate ? true : undefined });
        window.UI.toast.success(validate ? 'Prescription validated' : 'Prescription rejected');
        rxList && rxList.reload();
      },
    });
  }

  function intervene(rx) {
    K.formModal({
      title: `Intervention · ${rx.number}`, submitLabel: 'Record',
      intro: 'Record what you clarified or changed with the prescriber or patient. This is part of the prescription’s permanent record.',
      fields: [
        { name: 'type', label: 'Type', type: 'select', options: [['CLARIFICATION', 'Clarification'], ['CHANGE_AUTHORISED', 'Change authorised by prescriber'], ['ALLERGY_ALERT', 'Allergy alert'], ['OTHER', 'Other']] },
        { name: 'note', label: 'What happened', required: true, type: 'textarea' },
      ],
      onSubmit: async (d) => { await window.Api.post(`/pharmacy/prescriptions/${rx._id}/interventions`, d); window.UI.toast.success('Intervention recorded'); rxList && rxList.reload(); },
    });
  }

  function cancel(rx) {
    K.formModal({
      title: `Cancel ${rx.number}`, submitLabel: 'Cancel prescription', intro: 'Nothing more can be dispensed on it.',
      fields: [{ name: 'reason', label: 'Reason', required: true, type: 'textarea' }],
      onSubmit: async (d) => { await window.Api.post(`/pharmacy/prescriptions/${rx._id}/cancel`, { reason: d.reason }); window.UI.toast.success('Prescription cancelled'); rxList && rxList.reload(); },
    });
  }

  function intake(patientId) {
    const st = { patient: null, lines: [{}] };
    const today = P.day(new Date());
    const modal = window.UI.openModal({
      title: 'New prescription', maxWidth: '780px',
      bodyHtml: `<form id="rx-form">
        <div class="field"><label>Patient *</label><div class="flex" style="gap:var(--space-2);align-items:center"><div id="rx-patient" class="text-sm" style="flex:1"><span class="text-muted">No patient chosen</span></div><button type="button" class="btn btn-secondary btn-sm" id="rx-pick">Choose patient</button></div></div>
        <div id="rx-allergy"></div>
        <div class="form-row">
          <div class="field"><label>Prescription date *</label><input class="input" name="prescriptionDate" type="date" max="${today}" value="${today}" required /></div>
          <div class="field"><label>Paper / e-prescription no.</label><input class="input" name="externalReference" /></div>
        </div>
        <div class="form-row">
          <div class="field"><label>Prescriber name *</label><input class="input" name="pname" required /></div>
          <div class="field"><label>Prescriber reg. no.</label><input class="input" name="preg" /></div>
        </div>
        <div class="form-row">
          <div class="field"><label>Facility</label><input class="input" name="pfac" /></div>
          <div class="field"><label>Prescriber phone</label><input class="input" name="pphone" type="tel" /></div>
        </div>
        <div class="form-row">
          <div class="field"><label>Repeats: max dispensings</label><input class="input" name="maxDispensings" type="number" min="1" max="24" placeholder="1 = no repeats" /></div>
          <div class="field"><label>Min. days between dispensings</label><input class="input" name="minIntervalDays" type="number" min="0" max="365" /></div>
        </div>
        <div class="field"><label>Valid until <span class="text-muted">(leave blank for the legal maximum)</span></label><input class="input" name="validUntil" type="date" /></div>
        <h4 style="margin:var(--space-3) 0 var(--space-2)">Medicines *</h4>
        <div class="ph-lines" id="rx-lines"></div>
        <button type="button" class="btn btn-ghost btn-sm" id="rx-add-line" style="margin-top:var(--space-2)">${window.Icons.get('plus')} Add medicine</button>
        <div class="ph-note">Quantity is in the medicine’s base unit (tablets, ml…), the same unit stock is kept in.</div>
      </form>`,
      footerHtml: '<button class="btn btn-secondary" data-act="cancel">Cancel</button><button class="btn btn-primary" data-act="save">Record prescription</button>',
    });
    const form = modal.querySelector('#rx-form');
    const paintPatient = () => {
      modal.querySelector('#rx-patient').innerHTML = st.patient ? P.patientLine(st.patient) : '<span class="text-muted">No patient chosen</span>';
      modal.querySelector('#rx-allergy').innerHTML = st.patient && (st.patient.allergies || []).length ? `<div class="ph-warn-box"><strong>Allergies:</strong> ${st.patient.allergies.map(esc).join(', ')}</div>` : '';
    };
    modal.querySelector('#rx-pick').addEventListener('click', () => P.patientPicker({ onSelect: async (p) => { try { const { data } = await window.Api.get(`/pharmacy/patients/${p._id}`); st.patient = data.patient; } catch { st.patient = p; } paintPatient(); } }));
    const paintLines = () => {
      const host = modal.querySelector('#rx-lines');
      host.innerHTML = st.lines.map((l, i) => `<div class="ph-line" data-i="${i}">
        <div class="ph-line-med"><label class="text-xs text-muted">Medicine</label><button type="button" class="btn btn-secondary btn-sm btn-block" data-pick="${i}" style="justify-content:flex-start">${l.med ? esc(`${l.med.brandName || l.med.genericName} ${l.med.strength}`) : 'Choose medicine'}</button></div>
        <div><label class="text-xs text-muted">Quantity</label><input class="input" type="number" min="0.001" step="any" data-qty="${i}" value="${l.qty || ''}" /></div>
        <div><label class="text-xs text-muted">Directions</label><input class="input" data-dir="${i}" value="${esc(l.directions || '')}" placeholder="1 tablet 3 times a day for 5 days" /></div>
        <div>${st.lines.length > 1 ? `<button type="button" class="btn btn-ghost btn-sm btn-icon" data-rm="${i}" title="Remove">${window.Icons.get('trash')}</button>` : ''}</div></div>`).join('');
      host.querySelectorAll('[data-pick]').forEach((b) => b.addEventListener('click', () => P.medicinePicker({ onSelect: (m) => { st.lines[Number(b.dataset.pick)].med = m; paintLines(); } })));
      host.querySelectorAll('[data-qty]').forEach((x) => x.addEventListener('input', () => { st.lines[Number(x.dataset.qty)].qty = x.value; }));
      host.querySelectorAll('[data-dir]').forEach((x) => x.addEventListener('input', () => { st.lines[Number(x.dataset.dir)].directions = x.value; }));
      host.querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', () => { st.lines.splice(Number(b.dataset.rm), 1); paintLines(); }));
    };
    paintLines();
    if (patientId && P.can('patients.view')) window.Api.get(`/pharmacy/patients/${patientId}`).then(({ data }) => { st.patient = data.patient; paintPatient(); }).catch(() => {});
    modal.querySelector('#rx-add-line').addEventListener('click', () => { st.lines.push({}); paintLines(); });
    modal.querySelector('[data-act="cancel"]').addEventListener('click', () => window.UI.closeModal());
    const save = modal.querySelector('[data-act="save"]');
    save.addEventListener('click', async () => {
      if (!form.reportValidity()) return;
      if (!st.patient) return window.UI.toast.error('Choose the patient');
      if (st.lines.some((l) => !l.med || !(Number(l.qty) > 0))) return window.UI.toast.error('Every line needs a medicine and a quantity');
      const f = form.elements; const v = (n) => String(f[n].value || '').trim();
      const body = {
        branchId: window.AppShell.getActiveBranchId(), patientId: st.patient._id, prescriptionDate: v('prescriptionDate'),
        externalReference: v('externalReference') || undefined, validUntil: v('validUntil') || undefined,
        maxDispensings: v('maxDispensings') || undefined, minIntervalDays: v('minIntervalDays') || undefined,
        prescriber: { name: v('pname'), registrationNumber: v('preg') || undefined, facility: v('pfac') || undefined, phone: v('pphone') || undefined },
        items: st.lines.map((l) => ({ productId: l.med.productId, prescribedQty: Number(l.qty), directions: (l.directions || '').trim() || undefined })),
      };
      window.UI.setButtonLoading(save, true, 'Saving…');
      try {
        const { data } = await window.Api.post('/pharmacy/prescriptions', body);
        window.UI.closeModal();
        window.UI.toast.success(`Prescription ${data.prescription.number} recorded. A pharmacist must review it before it can be dispensed.`);
        rxList && rxList.reload();
      } catch (e) { window.UI.toast.error(e.message); window.UI.setButtonLoading(save, false); }
    });
  }

  function dispTab(host) {
    dList = K.listPage({
      container: host, endpoint: '/pharmacy/dispensings', itemsKey: 'dispensings',
      query: () => (params.get('patient') ? { patientId: params.get('patient') } : {}),
      filters: [{ key: 'status', label: 'Any status', options: [['DISPENSED', 'Dispensed'], ['REVERSED', 'Reversed']] }],
      columns: [
        { label: 'No.', render: (d) => `<strong>${esc(d.number)}</strong>` },
        { label: 'Date', render: (d) => P.dateTime(d.createdAt) },
        { label: 'Medicines', render: (d) => `<div class="text-xs">${(d.items || []).map((i) => `${esc(i.nameSnapshot)} ${esc(i.strength || '')} × ${esc(P.qty(i.quantity))}`).join('<br>')}</div>` },
        { label: 'Dispensed by', render: (d) => esc((d.dispenserSnapshot || {}).name || '-') },
        { label: 'Status', render: (d) => P.badge(d.status) },
      ],
      rowActions: (d) => (d.status === 'DISPENSED' ? `${K.btn('view', 'Details')} ${P.can('pharmacy.dispense') ? K.btn('label', 'Label') : ''} ${P.can('pharmacy.reverse') ? K.btn('reverse', 'Reverse') : ''}` : K.btn('view', 'Details')),
      onAction: (a, d) => (a === 'label' ? label(d) : a === 'reverse' ? reverse(d) : view(d)),
      emptyText: 'Nothing dispensed yet', emptyMessage: 'Dispensings appear here when a prescription is sold at the till.', emptyIcon: 'clipboard',
    });
  }

  async function printLabel(d, reason) {
    const { data } = await window.Api.post(`/pharmacy/dispensings/${d._id}/label`, { reason });
    P.printLabels(data); dList && dList.reload();
  }
  async function label(d) {
    if (!(d.labelPrints || []).length) { try { await printLabel(d); } catch (e) { window.UI.toast.error(e.message); } return; }
    K.formModal({
      title: `Reprint label · ${d.number}`, submitLabel: 'Print', intro: 'A label was already printed. Every reprint is recorded with its reason.',
      fields: [{ name: 'reason', label: 'Reason for reprint', required: true, placeholder: 'Label damaged' }],
      onSubmit: async (v) => { await printLabel(d, v.reason); },
    });
  }

  function reverse(d) {
    K.formModal({
      title: `Reverse ${d.number}`, submitLabel: 'Reverse dispensing',
      intro: 'A dispensing is never edited. Reversing it refunds the sale, gives the quantity back to the prescription and puts the medicine in quarantine (it does not go straight back on the shelf).',
      fields: [
        { name: 'reason', label: 'Reason', required: true, type: 'textarea' },
        { name: 'refundMethod', label: 'Refund by', type: 'select', options: [['CASH', 'Cash'], ['MPESA', 'M-PESA'], ['CARD', 'Card'], ['BANK', 'Bank'], ['OTHER', 'Other']] },
      ],
      onSubmit: async (v) => { await window.Api.post(`/pharmacy/dispensings/${d._id}/reverse`, v); window.UI.toast.success('Dispensing reversed'); dList.reload(); },
    });
  }

  async function view(d) {
    try {
      const { data } = await window.Api.get(`/pharmacy/dispensings/${d._id}`);
      const r = data.dispensing;
      window.UI.openModal({
        title: `${r.number} · ${P.label(r.status)}`, maxWidth: '680px',
        bodyHtml: `${K.kv([['Date', P.dateTime(r.createdAt)], ['Dispensed by', esc((r.dispenserSnapshot || {}).name)], ['Registration no.', esc((r.dispenserSnapshot || {}).registrationNumber)], ['Countersigned by', r.countersign ? esc(`${r.countersign.name}${r.countersign.relationship ? ` (${r.countersign.relationship})` : ''}`) : ''], ['Labels printed', esc((r.labelPrints || []).length)]])}
          <table class="table"><thead><tr><th>Medicine</th><th>Qty</th><th>Batches</th></tr></thead><tbody>${(r.items || []).map((i) => `<tr><td>${esc(i.nameSnapshot)} ${esc(i.strength || '')}</td><td>${esc(P.qty(i.quantity))}</td><td class="text-xs">${(i.batchAllocations || []).map((b) => `${esc(b.batchNumber)}${b.expiryDate ? ` · exp ${esc(P.date(b.expiryDate))}` : ''} × ${esc(P.qty(b.quantity))}`).join('<br>')}</td></tr>`).join('')}</tbody></table>
          ${r.reversal ? `<p class="text-sm"><strong>Reversed</strong> ${esc(P.dateTime(r.reversal.at))}: ${esc(r.reversal.reason)}</p>` : ''}`,
      });
    } catch (e) { window.UI.toast.error(e.message); }
  }
})();
