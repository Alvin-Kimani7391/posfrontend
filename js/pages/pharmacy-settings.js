/**
 * pharmacy-settings.js - the pharmacy's own rules: classes (pharmacist sign-off), rules & storage places,
 * staff credentials, and CSV medicine import. Defaults are starting points; the pharmacy is responsible for checking
 * them against the regulator's current requirements.
 */
(function () {
  const P = window.Pharmacy; const K = window.ModuleKit; const esc = P.esc;
  let S;

  document.addEventListener('DOMContentLoaded', () => P.page({ title: 'Pharmacy settings', render }));

  async function load() { const { data } = await window.Api.get('/pharmacy/settings'); S = data.settings; return S; }

  async function render(el) {
    el.innerHTML = '<div class="page-header"><div><h1>Pharmacy settings</h1><p>Medicine classes, legal limits, staff credentials and medicine import.</p></div></div><div id="ph-host"></div>';
    await load();
    P.tabs(el.querySelector('#ph-host'), [
      { key: 'classes', label: 'Classes', perm: 'pharmacy.settings', render: classesTab },
      { key: 'rules', label: 'Rules & storage', perm: 'pharmacy.settings', render: rulesTab },
      { key: 'staff', label: 'Staff credentials', perm: 'pharmacy.settings', render: staffTab },
      { key: 'import', label: 'Import medicines', perm: 'medicines.manage', render: importTab },
    ]);
  }

  const save = async (body, msg = 'Saved') => { const { data } = await window.Api.put('/pharmacy/settings', body); S = data.settings; window.UI.toast.success(msg); P.classes(true); };

  function classesTab(host) {
    let rows = (S.classes || []).map((c) => ({ ...c }));
    const paint = () => {
      host.innerHTML = `
        <div class="card ph-card-pad" style="margin-bottom:var(--space-4)">
          <div class="ph-h"><h3>Pharmacist sign-off</h3>${P.badge(S.classesConfirmed ? 'signed' : 'pending', S.classesConfirmed ? 'Confirmed' : 'Not confirmed')}</div>
          <p class="text-sm text-secondary" style="margin:0 0 var(--space-3)">${esc(S.country || '')} starting points${S.regulator ? ` (regulator: ${esc(S.regulator)})` : ''}. ${S.usingDefaultClasses ? 'You are using the starting classes. ' : ''}A registered pharmacist must check the classes and each medicine’s class against the regulator’s current lists, then confirm. Changing a class voids the sign-off.</p>
          ${S.classesConfirmed && S.classesConfirmation ? `<p class="text-sm">Confirmed by <strong>${esc(S.classesConfirmation.byName)}</strong>${S.classesConfirmation.registrationNumber ? ` (${esc(S.classesConfirmation.registrationNumber)})` : ''} on ${esc(P.date(S.classesConfirmation.at))}.</p>` : ''}
          <button class="btn btn-primary" id="cl-confirm" ${P.can('pharmacy.restricted') ? '' : 'disabled title="Only a pharmacist can confirm"'}>${S.classesConfirmed ? 'Confirm again' : 'Confirm classes'}</button>
          ${S.renewalNote ? `<p class="ph-note">${esc(S.renewalNote)}</p>` : ''}</div>
        <div class="card ph-card-pad"><div class="ph-h"><h3>Medicine classes</h3><button class="btn btn-secondary btn-sm" id="cl-add">${window.Icons.get('plus')} Add class</button></div>
          ${rows.map((c, i) => `<div class="ph-class-row" data-i="${i}">
            <div><div class="text-xs text-muted">Code</div><strong>${esc(c.code)}</strong>${c.code === 'OTC' ? '<div class="ph-note">Required</div>' : `<div><button class="btn btn-ghost btn-sm" data-rm="${i}" style="padding:0;color:var(--color-danger)">Remove</button></div>`}</div>
            <div><div class="field" style="margin-bottom:var(--space-2)"><label class="text-xs">Name shown to staff</label><input class="input" data-f="label" value="${esc(c.label || '')}" /></div>
              <div class="ph-flags">
                ${[['requiresPrescription', 'Needs a prescription'], ['dispenserOnly', 'Dispenser only'], ['restricted', 'Controlled / restricted'], ['poisonsBook', 'Poisons Book entry']].map(([k, t]) => `<label class="checkbox-row"><input type="checkbox" data-f="${k}" ${c[k] ? 'checked' : ''}/> <span class="text-sm">${t}</span></label>`).join('')}
                <label class="text-sm">Max per dispense <input class="input" data-f="maxQtyPerDispense" type="number" min="0" step="any" value="${c.maxQtyPerDispense || ''}" style="width:90px;display:inline-block" /></label>
              </div></div></div>`).join('')}
          <button class="btn btn-primary" id="cl-save" style="margin-top:var(--space-3)">Save classes</button>
          <p class="ph-note">Removing a class is refused while medicines still use it. Unknown classes are always treated as the strictest (prescription, dispenser, restricted).</p></div>`;
      host.querySelectorAll('.ph-class-row').forEach((r) => r.querySelectorAll('[data-f]').forEach((x) => x.addEventListener('input', () => {
        const c = rows[Number(r.dataset.i)]; const k = x.dataset.f;
        c[k] = x.type === 'checkbox' ? x.checked : k === 'maxQtyPerDispense' ? (x.value === '' ? undefined : Number(x.value)) : x.value;
      })));
      host.querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', () => { rows.splice(Number(b.dataset.rm), 1); paint(); }));
      host.querySelector('#cl-add').addEventListener('click', () => K.formModal({ title: 'Add a class', submitLabel: 'Add', fields: [{ name: 'code', label: 'Code (letters, numbers, underscore)', required: true, placeholder: 'PART_II' }, { name: 'label', label: 'Name' }], onSubmit: async (d) => { const code = d.code.toUpperCase(); if (!/^[A-Z0-9_]{2,40}$/.test(code)) throw new Error('Use letters, numbers and underscore only'); if (rows.some((r) => r.code === code)) throw new Error('That code exists'); rows.push({ code, label: d.label, requiresPrescription: false, dispenserOnly: false, restricted: false, poisonsBook: false }); paint(); } }));
      host.querySelector('#cl-save').addEventListener('click', async () => {
        try { await save({ classes: rows.map((c) => ({ code: c.code, label: c.label || undefined, requiresPrescription: !!c.requiresPrescription, dispenserOnly: !!c.dispenserOnly, restricted: !!c.restricted, poisonsBook: !!c.poisonsBook, maxQtyPerDispense: c.maxQtyPerDispense || undefined })) }, 'Classes saved. The pharmacist must confirm them again.'); classesTab(host); } catch (e) { window.UI.toast.error(e.message); }
      });
      host.querySelector('#cl-confirm').addEventListener('click', () => K.formModal({
        title: 'Confirm medicine classes', submitLabel: 'I confirm',
        intro: 'By confirming, you state that you have checked these classes, and each medicine’s class, against the regulator’s current lists. Your name and registration number are recorded.',
        fields: [{ name: 'statement', label: 'Statement', type: 'textarea', required: true, value: 'I have checked the classes against the current regulator lists.' }],
        onSubmit: async (d) => { await window.Api.post('/pharmacy/settings/confirm-classes', { statement: d.statement }); await load(); window.UI.toast.success('Classes confirmed'); classesTab(host); },
      }));
    };
    paint();
  }

  function rulesTab(host) {
    const r = S.rules || {}; const rooms = (S.rooms || []).map((x) => ({ ...x }));
    const cb = (v, name, text, hint) => `<label class="checkbox-row" style="display:flex;gap:8px;margin-bottom:var(--space-2)"><input type="checkbox" name="${name}" ${v ? 'checked' : ''}/> <span class="text-sm">${text}${hint ? `<span class="ph-note" style="display:block">${hint}</span>` : ''}</span></label>`;
    host.innerHTML = `<form id="rl-f" class="card ph-card-pad">
      <div class="ph-h"><h3>Rules for ${esc(S.country || 'your country')}</h3></div>
      <div class="form-row"><div class="field"><label>Prescription valid for (days)</label><input class="input" type="number" name="prescriptionValidDays" min="1" max="730" value="${esc(S.prescriptionValidDays)}"/></div>
      <div class="field"><label>Prescription with refills valid for (days)</label><input class="input" type="number" name="refillValidDays" min="1" max="730" value="${esc(r.refillValidDays || '')}"/></div></div>
      <div class="form-row"><div class="field"><label>Keep records for (years)</label><input class="input" type="number" name="recordRetentionYears" min="1" max="30" value="${esc(S.recordRetentionYears)}"/></div>
      <div class="field"><label>Expiry warning (days, comma separated)</label><input class="input" name="expiryWarnDays" value="${esc((S.expiryWarnDays || []).join(', '))}"/></div></div>
      ${cb(r.noRefillsForRestricted, 'noRefillsForRestricted', 'No refills on controlled drugs')}
      ${cb(r.oneRestrictedPerPrescription, 'oneRestrictedPerPrescription', 'One controlled drug per prescription')}
      ${cb(r.requireCountersign, 'requireCountersign', 'Patient (or representative) countersigns when a controlled drug is dispensed')}
      ${cb(S.requireDispenserCredential, 'requireDispenserCredential', 'Require a verified pharmacist / dispenser credential to dispense', 'Turning this off removes a safety check. Leave it on unless the regulator does not require it.')}
      ${cb(S.requireApprovedSuppliers, 'requireApprovedSuppliers', 'Only buy medicines from suppliers with a current licence')}
      ${cb(S.allowOfflineOtc, 'allowOfflineOtc', 'Allow tills to sell ordinary (OTC) medicines while offline', 'Prescription, pharmacy-only and controlled medicines can never be sold offline. Offline medicine sales are sent for manager review.')}
      <h4 style="margin:var(--space-4) 0 var(--space-2)">Storage places and temperature limits</h4>
      <div id="rm-rows"></div><button type="button" class="btn btn-ghost btn-sm" id="rm-add">${window.Icons.get('plus')} Add place</button>
      <div style="margin-top:var(--space-4)"><button class="btn btn-primary">Save rules</button></div></form>`;
    const paintRooms = () => {
      host.querySelector('#rm-rows').innerHTML = rooms.length ? rooms.map((x, i) => `<div class="flex" style="gap:var(--space-2);margin-bottom:var(--space-2);align-items:end;flex-wrap:wrap"><div class="field" style="margin:0;flex:1;min-width:150px"><label class="text-xs">Place</label><input class="input" data-r="place" data-i="${i}" value="${esc(x.place)}"/></div><div class="field" style="margin:0"><label class="text-xs">Min °C</label><input class="input" data-r="minC" data-i="${i}" type="number" step="0.1" value="${esc(x.minC)}" style="width:90px"/></div><div class="field" style="margin:0"><label class="text-xs">Max °C</label><input class="input" data-r="maxC" data-i="${i}" type="number" step="0.1" value="${esc(x.maxC)}" style="width:90px"/></div><button type="button" class="btn btn-ghost btn-sm btn-icon" data-rm="${i}">${window.Icons.get('trash')}</button></div>`).join('') : '<p class="text-muted text-sm">No places yet. Add “Fridge” (2–8 °C) and “Dispensary” (15–25 °C), or whatever your procedure uses.</p>';
      host.querySelectorAll('[data-r]').forEach((x) => x.addEventListener('input', () => { rooms[Number(x.dataset.i)][x.dataset.r] = x.dataset.r === 'place' ? x.value : x.value === '' ? '' : Number(x.value); }));
      host.querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', () => { rooms.splice(Number(b.dataset.rm), 1); paintRooms(); }));
    };
    paintRooms();
    host.querySelector('#rm-add').addEventListener('click', () => { rooms.push({ place: '', minC: 2, maxC: 8 }); paintRooms(); });
    host.querySelector('#rl-f').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target.elements; const n = (k) => (f[k].value === '' ? undefined : Number(f[k].value));
      const warn = String(f.expiryWarnDays.value).split(',').map((x) => Number(x.trim())).filter((x) => x > 0);
      if (rooms.some((x) => !String(x.place).trim() || x.minC === '' || x.maxC === '' || !(x.minC < x.maxC))) return window.UI.toast.error('Every storage place needs a name and a min below its max');
      try {
        await save({ prescriptionValidDays: n('prescriptionValidDays'), refillValidDays: n('refillValidDays'), recordRetentionYears: n('recordRetentionYears'), ...(warn.length ? { expiryWarnDays: warn.slice(0, 6) } : {}), noRefillsForRestricted: f.noRefillsForRestricted.checked, oneRestrictedPerPrescription: f.oneRestrictedPerPrescription.checked, requireCountersign: f.requireCountersign.checked, requireDispenserCredential: f.requireDispenserCredential.checked, requireApprovedSuppliers: f.requireApprovedSuppliers.checked, allowOfflineOtc: f.allowOfflineOtc.checked, rooms: rooms.map((x) => ({ place: String(x.place).trim(), minC: Number(x.minC), maxC: Number(x.maxC) })) }, 'Rules saved');
        rulesTab(host);
      } catch (err) { window.UI.toast.error(err.message); }
    });
  }

  async function staffTab(host) {
    const { data } = await window.Api.get('/pharmacy/staff');
    const now = new Date();
    const state = (c) => (!c ? ['unapproved', 'No credential'] : c.expiresAt && new Date(c.expiresAt) < now ? ['expired', 'Expired'] : ['verified', `${P.label(c.role)} · verified`]);
    host.innerHTML = `<div class="card ph-card-pad"><div class="ph-h"><h3>Professional credentials</h3></div>
      <p class="text-sm text-secondary" style="margin-top:0">Nobody can dispense without a current, verified credential. <strong>Check the registration number against the regulator’s register before saving</strong>: saving marks it as verified by you. The Pharmacist role gives access; the credential is what allows dispensing.</p>
      <div class="table-wrap"><table class="table"><thead><tr><th>Staff</th><th>App role</th><th>Credential</th><th>Registration no.</th><th>Expires</th><th></th></tr></thead><tbody>${(data.staff || []).map((u, i) => { const c = u.credential; const [k, t] = state(c); return `<tr><td><strong>${esc(u.name)}</strong></td><td>${esc(P.label(u.role))}</td><td>${P.badge(k, t)}</td><td>${esc((c || {}).registrationNumber || '-')}</td><td>${c && c.expiresAt ? esc(P.date(c.expiresAt)) : '-'}</td><td style="text-align:right;white-space:nowrap"><button class="btn btn-secondary btn-sm" data-ed="${i}">${c ? 'Update' : 'Add'}</button>${c ? ` <button class="btn btn-ghost btn-sm" data-rv="${i}">Remove</button>` : ''}</td></tr>`; }).join('')}</tbody></table></div></div>`;
    host.querySelectorAll('[data-ed]').forEach((b) => b.addEventListener('click', () => {
      const u = data.staff[Number(b.dataset.ed)]; const c = u.credential || {};
      K.formModal({
        title: `Credential · ${u.name}`, submitLabel: 'Save & mark verified', values: { role: c.role || 'DISPENSER', registrationNumber: c.registrationNumber, expiresAt: P.day(c.expiresAt) },
        intro: `${esc(S.registrationLabel || 'Registration number')}. A pharmacist needs a registration number. Controlled drugs need a pharmacist.`,
        fields: [{ name: 'role', label: 'Role', type: 'select', options: [['PHARMACIST', 'Pharmacist'], ['DISPENSER', 'Dispenser / technologist'], ['ASSISTANT', 'Assistant (cannot dispense)']] }, { name: 'registrationNumber', label: 'Registration number' }, { name: 'expiresAt', label: 'Registration expires', type: 'date' }],
        onSubmit: async (d) => { await window.Api.put(`/pharmacy/staff/${u.userId}/credential`, d); window.UI.toast.success('Credential saved'); staffTab(host); },
      });
    }));
    host.querySelectorAll('[data-rv]').forEach((b) => b.addEventListener('click', async () => {
      const u = data.staff[Number(b.dataset.rv)];
      if (!(await window.UI.confirmDialog({ title: `Remove ${u.name}’s credential?`, message: 'They will no longer be able to dispense.', confirmText: 'Remove', danger: true }))) return;
      try { await window.Api.delete(`/pharmacy/staff/${u.userId}/credential`); window.UI.toast.success('Credential removed'); staffTab(host); } catch (e) { window.UI.toast.error(e.message); }
    }));
  }

  function parseCsv(text) {
    const rows = []; let row = []; let cur = ''; let q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) { if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
      else if (ch === '"') q = true;
      else if (ch === ',') { row.push(cur); cur = ''; }
      else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; }
      else cur += ch;
    }
    if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
    return rows.filter((r) => r.some((c) => String(c).trim() !== ''));
  }

  function importTab(host) {
    host.innerHTML = `<div class="card ph-card-pad">
      <div class="ph-h"><h3>Set up many medicines at once</h3></div>
      <ol class="text-sm" style="margin:0 0 var(--space-3);padding-left:20px;line-height:1.7"><li>Download the template. It lists your products that are not set up as medicines yet.</li><li>Fill in generic name, strength, dosage form and class for each medicine you sell. Delete rows that are not medicines.</li><li>Upload it and press <strong>Check</strong>. Nothing is saved until you press Import.</li></ol>
      <div class="flex" style="gap:var(--space-2);flex-wrap:wrap"><button class="btn btn-secondary" id="im-tpl">Download template (CSV)</button>
        <label class="btn btn-secondary" style="cursor:pointer">Choose filled CSV<input type="file" id="im-file" accept=".csv,text/csv" hidden/></label>
        <button class="btn btn-secondary" id="im-check" disabled>Check</button><button class="btn btn-primary" id="im-go" disabled>Import</button></div>
      <p class="ph-note" id="im-file-name">No file chosen</p><div id="im-out" style="margin-top:var(--space-3)"></div></div>`;
    host.querySelector('#im-tpl').addEventListener('click', () => P.downloadCsv('/pharmacy/setup/medicines-template', {}, 'medicines-setup.csv').catch((e) => window.UI.toast.error(e.message)));
    let items = [];
    host.querySelector('#im-file').addEventListener('change', async (e) => {
      const file = e.target.files[0]; if (!file) return;
      const rows = parseCsv((await file.text()).replace(/^\uFEFF/, ''));
      if (rows.length < 2) { window.UI.toast.error('The file has no rows'); return; }
      const head = rows[0].map((h) => String(h).trim());
      const col = (name) => head.findIndex((h) => h.toLowerCase() === name.toLowerCase());
      const fields = ['sku', 'barcode', 'genericName', 'strength', 'dosageForm', 'classification', 'brandName', 'manufacturer', 'registrationNumber', 'packSize'];
      items = rows.slice(1).map((r) => { const o = {}; fields.forEach((f) => { const i = col(f); const v = i >= 0 ? String(r[i] || '').trim() : ''; if (v) o[f] = v; }); return o; })
        .filter((o) => o.genericName || o.strength || o.dosageForm);
      host.querySelector('#im-file-name').textContent = `${file.name}: ${items.length} medicine row(s) with details`;
      host.querySelector('#im-check').disabled = host.querySelector('#im-go').disabled = !items.length;
      host.querySelector('#im-out').innerHTML = items.length > 500 ? '<div class="ph-warn-box">Only the first 500 rows are sent at a time. Import in batches.</div>' : '';
    });
    const run = async (dryRun) => {
      const out = host.querySelector('#im-out'); out.innerHTML = '<span class="text-muted">Working…</span>';
      try {
        const { data } = await window.Api.post('/pharmacy/medicines/bulk', { dryRun, items: items.slice(0, 500) });
        out.innerHTML = `<div class="${data.failed ? 'ph-warn-box' : 'callout callout-success'}" style="margin-bottom:var(--space-3)"><strong>${dryRun ? 'Checked' : 'Imported'}:</strong> ${esc(data.ok)} of ${esc(data.total)} row(s) ${dryRun ? 'are ready' : 'saved'}${data.failed ? `, ${esc(data.failed)} need fixing` : ''}.</div>
          ${data.failed ? `<div class="table-wrap"><table class="table"><thead><tr><th>Row</th><th>Product</th><th>Problem</th></tr></thead><tbody>${data.results.filter((r) => !r.ok).map((r) => `<tr><td>${esc(r.row)}</td><td>${esc(r.ref || '')}</td><td class="text-sm">${esc(r.error)}</td></tr>`).join('')}</tbody></table></div>` : ''}`;
        if (!dryRun) window.UI.toast.success(`${data.ok} medicine(s) saved`);
      } catch (e) { out.innerHTML = `<div class="ph-danger-box">${esc(e.message)}</div>`; }
    };
    host.querySelector('#im-check').addEventListener('click', () => run(true));
    host.querySelector('#im-go').addEventListener('click', async () => {
      if (await window.UI.confirmDialog({ title: `Import ${items.length} medicine(s)?`, message: 'Rows with problems are skipped and listed. Medicines are always tracked by batch and expiry.', confirmText: 'Import' })) run(false);
    });
  }
})();
