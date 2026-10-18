/** medicines.js - medicine master data (a Product + generic name, strength, form, class, storage, status, alternatives). */
(function () {
  const P = window.Pharmacy; const K = window.ModuleKit; const esc = P.esc;
  let list; let settings;

  document.addEventListener('DOMContentLoaded', () => P.page({ title: 'Medicines', render }));

  async function render(el) {
    settings = await P.classes();
    el.innerHTML = `<div class="page-header"><div><h1>Medicines</h1><p>The medicine details behind your products: what it is, how strong, its class and how it must be stored.</p></div>
      <div class="flex" style="gap:var(--space-2);flex-wrap:wrap">
        <a class="btn btn-secondary" href="pharmacy-settings.html#import" data-requires-permission="medicines.manage">Bulk import</a>
        <button class="btn btn-secondary" id="ph-link-med" data-requires-permission="medicines.manage" title="You already have this item under Products">Use an existing product</button>
        <button class="btn btn-primary" id="ph-add-med" data-requires-permission="medicines.manage">${window.Icons.get('plus')} Add medicine</button></div></div><div id="mk-root"></div>`;
    el.querySelector('#ph-add-med').addEventListener('click', () => window.PharmacyProductForm.open({ onDone: () => list.reload() }));
    el.querySelector('#ph-link-med').addEventListener('click', () => window.ProductPicker.open({ title: 'Which product is this medicine?', onSelect: ({ product }) => window.PharmacyProductForm.open({ product, onDone: () => list.reload() }) }));
    if (new URLSearchParams(location.search).get('add') === '1') window.PharmacyProductForm.open({ onDone: () => list.reload() });
    list = K.listPage({
      container: el.querySelector('#mk-root'), endpoint: '/pharmacy/medicines', itemsKey: 'medicines', search: true, searchParam: 'q', searchPlaceholder: 'Generic or brand name, strength',
      filters: [
        { key: 'classification', label: 'All classes', options: (settings.classes || []).map((c) => [c.code, c.label || c.code]) },
        { key: 'status', label: 'Any status', options: [['active', 'Active'], ['discontinued', 'Discontinued'], ['quarantined', 'Quarantined'], ['recalled', 'Recalled']] },
      ],
      columns: [
        { label: 'Medicine', render: (m) => `<strong>${esc(m.brandName || m.genericName)}</strong><div class="text-xs text-muted">${esc(m.genericName)}</div>` },
        { label: 'Strength / form', render: (m) => `${esc(m.strength)} · ${esc(m.dosageForm)}${m.packSize ? `<div class="text-xs text-muted">${esc(m.packSize)}</div>` : ''}` },
        { label: 'Class', render: (m) => P.classBadge(m.classification) },
        { label: 'Storage', render: (m) => (m.storage && (m.storage.coldChain || m.storage.minC != null)) ? `${m.storage.coldChain ? '❄ ' : ''}${m.storage.minC != null ? `${m.storage.minC}–${m.storage.maxC} °C` : 'Cold chain'}` : '<span class="text-muted">-</span>' },
        { label: 'Status', render: (m) => P.badge(m.status) + (m.statusReason ? `<div class="text-xs text-muted">${esc(m.statusReason)}</div>` : '') },
      ],
      rowActions: (m) => K.btn('alt', 'Alternatives') + (P.can('medicines.manage') ? ` ${K.btn('edit', 'Edit')} ${K.btn('status', 'Status')}` : ''),
      onAction: (a, m) => (a === 'alt' ? alternatives(m) : a === 'edit' ? window.PharmacyProductForm.open({ medicine: m, onDone: () => list.reload() }) : status(m)),
      emptyText: 'No medicines set up yet', emptyMessage: 'Add your first medicine, or import them all from a spreadsheet in Pharmacy settings.', emptyIcon: 'inventory',
    });
  }

  function form({ productId, name, medicine }) {
    const edit = !!medicine; const m = medicine || {}; const st = m.storage || {};
    K.formModal({
      title: edit ? `Edit ${m.brandName || m.genericName}` : `Medicine details${name ? ` · ${name}` : ''}`, maxWidth: '640px', submitLabel: 'Save medicine',
      intro: edit ? '' : 'Medicines are always tracked by batch and expiry. This switches that on for the product.',
      values: { ...m, storageInstructions: st.instructions, storageMinC: st.minC, storageMaxC: st.maxC, storageCold: !!st.coldChain },
      fields: [
        { name: 'genericName', label: 'Generic name (active ingredient)', required: true, placeholder: 'Amoxicillin' },
        { name: 'brandName', label: 'Brand name', placeholder: 'Amoxil' },
        { name: 'strength', label: 'Strength', required: true, placeholder: '500 mg' },
        { name: 'dosageForm', label: 'Dosage form', required: true, placeholder: 'tablet, capsule, syrup, cream, injection' },
        { name: 'classification', label: 'Class', type: 'select', value: m.classification || 'OTC', options: (settings.classes || [{ code: 'OTC' }]).map((c) => [c.code, c.label || c.code]), hint: 'Sets who may sell it and whether a prescription is needed. Ask your pharmacist if unsure.' },
        { name: 'packSize', label: 'Pack size', placeholder: '10 x 10 tablets' },
        { name: 'unitOfSale', label: 'Unit of sale', placeholder: 'tablet, strip, bottle' },
        { name: 'manufacturer', label: 'Manufacturer' },
        { name: 'registrationNumber', label: 'Registration number', hint: 'The regulator’s registration / authorisation, if any.' },
        { name: 'supplierCode', label: 'Supplier code' },
        { name: 'infoReference', label: 'Leaflet / information link' },
        { name: 'storageInstructions', label: 'Storage instructions', placeholder: 'Store below 25 °C, protect from light' },
        { name: 'storageMinC', label: 'Storage min (°C)', type: 'number', step: '0.1' },
        { name: 'storageMaxC', label: 'Storage max (°C)', type: 'number', step: '0.1' },
        { name: 'storageCold', label: 'Cold chain (keep refrigerated)', type: 'checkbox' },
      ],
      onSubmit: async (d) => {
        const body = { ...d }; const storage = {};
        if (d.storageInstructions) storage.instructions = d.storageInstructions;
        if (d.storageMinC !== undefined) storage.minC = Number(d.storageMinC);
        if (d.storageMaxC !== undefined) storage.maxC = Number(d.storageMaxC);
        if (d.storageCold) storage.coldChain = true;
        ['storageInstructions', 'storageMinC', 'storageMaxC', 'storageCold'].forEach((k) => delete body[k]);
        if (Object.keys(storage).length) body.storage = storage;
        await window.Api.put(`/pharmacy/medicines/${productId}`, body);
        window.UI.toast.success('Medicine saved'); list.reload();
      },
    });
  }

  function status(m) {
    K.formModal({
      title: `Status · ${m.brandName || m.genericName}`, submitLabel: 'Update status',
      intro: 'Recalled and quarantined medicines cannot be sold at the till. A reason is required for anything other than Active.',
      values: { status: m.status, reason: m.statusReason },
      fields: [
        { name: 'status', label: 'Status', type: 'select', options: [['active', 'Active'], ['discontinued', 'Discontinued'], ['quarantined', 'Quarantined'], ['recalled', 'Recalled']] },
        { name: 'reason', label: 'Reason', type: 'textarea' },
      ],
      onSubmit: async (d) => {
        if (d.status !== 'active' && !d.reason) throw new Error('Give a reason');
        await window.Api.post(`/pharmacy/medicines/${m.productId}/status`, { status: d.status, reason: d.reason });
        window.UI.toast.success('Status updated'); list.reload();
      },
    });
  }

  async function alternatives(m) {
    try {
      const { data } = await window.Api.get(`/pharmacy/medicines/${m.productId}/alternatives`);
      const rows = data.alternatives || [];
      const modal = window.UI.openModal({
        title: `Alternatives · ${m.brandName || m.genericName} ${m.strength}`, maxWidth: '620px',
        bodyHtml: `<p class="text-sm text-secondary" style="margin-top:0">Suggestions only. Choosing a substitute is the pharmacist’s decision; the system never swaps a medicine for you.</p>
          ${rows.length ? `<table class="table"><thead><tr><th>Medicine</th><th>Why listed</th><th></th></tr></thead><tbody>${rows.map((a) => `<tr><td><strong>${esc(a.brandName || a.genericName)}</strong><div class="text-xs text-muted">${esc(a.genericName)} ${esc(a.strength)} · ${esc(a.dosageForm)}</div></td><td>${a.basis === 'PHARMACIST_LISTED' ? 'Listed by pharmacist' : 'Same ingredient, strength and form'}</td><td style="text-align:right">${a.basis === 'PHARMACIST_LISTED' && P.can('medicines.manage') ? `<button class="btn btn-ghost btn-sm" data-rm="${a.productId}">Remove</button>` : ''}</td></tr>`).join('')}</tbody></table>` : '<p class="text-muted">No alternatives found.</p>'}`,
        footerHtml: `${P.can('medicines.manage') ? '<button class="btn btn-secondary" data-act="add">Add an alternative</button>' : ''}<button class="btn btn-primary" data-act="close">Done</button>`,
      });
      modal.querySelector('[data-act="close"]').addEventListener('click', () => window.UI.closeModal());
      const save = async (ids) => {
        await window.Api.put(`/pharmacy/medicines/${m.productId}`, { genericName: m.genericName, strength: m.strength, dosageForm: m.dosageForm, alternatives: ids });
        window.UI.toast.success('Alternatives updated'); window.UI.closeModal(); list.reload();
      };
      // the curated list = the PHARMACIST_LISTED rows (the medicine list payload may not carry ids)
      const cur = rows.filter((a) => a.basis === 'PHARMACIST_LISTED').map((a) => String(a.productId));
      modal.querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', () => save(cur.filter((id) => id !== b.dataset.rm)).catch((e) => window.UI.toast.error(e.message))));
      modal.querySelector('[data-act="add"]')?.addEventListener('click', () => {
        window.UI.closeModal();
        P.medicinePicker({ filter: (x) => String(x.productId) !== String(m.productId), onSelect: (x) => save([...new Set([...cur, String(x.productId)])]).catch((e) => window.UI.toast.error(e.message)) });
      });
    } catch (e) { window.UI.toast.error(e.message); }
  }
})();
