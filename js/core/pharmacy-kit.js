/**
 * pharmacy-kit.js - shared helpers for the pharmacy module screens and the till.
 *   Pharmacy.on()  Pharmacy.page({title, render})  Pharmacy.tabs  badges  pickers  CSV download  label printing
 * Money from the API arrives as decimal currency; aggregate numbers straight from the database (dashboard totals, expiry
 * cost values) are integer cents and are converted by the screen that shows them (moneyCents).
 */
(function (window) {
  'use strict';
  const esc = (v) => window.UI.escapeHtml(v == null ? '' : String(v));
  const can = (p) => window.Permissions.can(window.AppShell.getUser(), p);
  const date = (v) => (v ? new Date(v).toLocaleDateString() : '-');
  const dateTime = (v) => (v ? new Date(v).toLocaleString() : '-');
  const day = (v) => (v ? new Date(v).toISOString().slice(0, 10) : '');
  const on = () => !!(window.AppShell && window.AppShell.hasFeature && window.AppShell.hasFeature('pharmacyDispensing'));
  const money = (v) => window.UI.formatMoney(Number(v) || 0);
  const moneyCents = (v) => window.UI.formatMoney((Number(v) || 0) / 100);
  const qty = (n) => (Math.round((Number(n) || 0) * 1000) / 1000).toLocaleString();
  const label = (s) => String(s || '').replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());

  const GOOD = ['active', 'validated', 'dispensed', 'credited', 'assessed', 'released', 'signed', 'closed', 'approved', 'verified'];
  const WARN = ['received', 'partially_dispensed', 'discontinued', 'quarantined', 'draft', 'returned', 'open', 'expiring', 'pending', 'partial'];
  const BAD = ['rejected', 'cancelled', 'expired', 'reversed', 'recalled', 'revoked', 'disposed', 'unapproved', 'exception'];
  function badge(status, text) {
    const s = String(status || '').toLowerCase();
    const cls = GOOD.includes(s) ? 'badge-success' : WARN.includes(s) ? 'badge-warning' : BAD.includes(s) ? 'badge-danger' : 'badge-neutral';
    return `<span class="badge ${cls}">${esc(text || label(status))}</span>`;
  }

  /* classes come from the pharmacy's own settings */
  let classCache = null;
  async function classes(force) {
    if (classCache && !force) return classCache;
    try { const { data } = await window.Api.get('/pharmacy/settings'); classCache = data.settings; } catch { classCache = { classes: [] }; }
    return classCache;
  }
  const classOf = (code) => ((classCache && classCache.classes) || []).find((c) => String(c.code).toUpperCase() === String(code || '').toUpperCase());
  function classBadge(code) {
    const c = classOf(code);
    const text = (c && c.label) || code || 'OTC';
    const cls = !c ? 'badge-neutral' : c.restricted ? 'badge-danger' : (c.requiresPrescription || c.poisonsBook) ? 'badge-warning' : c.dispenserOnly ? 'badge-info' : 'badge-success';
    return `<span class="badge ${cls}" title="${esc(code)}">${esc(text)}</span>`;
  }

  /** Mounts the shell, waits for the business profile, explains clearly when Pharmacy is off, otherwise render(el). */
  async function page({ title, render }) {
    const el = window.AppShell.mount({ title });
    if (!el) return;
    el.innerHTML = `<div class="page-header"><div><h1>${esc(title)}</h1><p>Loading…</p></div></div>`;
    try { await window.AppShell.whenProfileReady(); } catch { /* use cache */ }
    if (!on()) {
      el.innerHTML = `<div class="card ph-card-pad">${window.UI.emptyStateHtml({ icon: 'alert', title: 'Pharmacy is not switched on', message: 'Choose "Pharmacy" as your business type (Settings → Business type) or switch on Dispensing to use this screen.', actionHtml: '<a class="btn btn-primary" href="settings.html">Open settings</a>' })}</div>`;
      return;
    }
    await classes();
    try { await render(el); } catch (err) { el.innerHTML = `<div class="card ph-card-pad">${window.UI.emptyStateHtml({ icon: 'alert', title: 'Could not load this screen', message: err.message || 'Try again' })}</div>`; }
    window.Permissions.applyPermissionGates(el, window.AppShell.getUser());
  }

  /** tabs(host, [{ key, label, perm?, render(host) }]) - remembers the tab in the URL hash. */
  function tabs(host, list, { initial } = {}) {
    const vis = list.filter((t) => !t.perm || can(t.perm));
    host.innerHTML = `<div class="tabs ph-tabs" role="tablist">${vis.map((t) => `<button class="tab-btn" role="tab" data-tab="${t.key}">${esc(t.label)}</button>`).join('')}</div><div id="ph-tab-body"></div>`;
    const body = host.querySelector('#ph-tab-body');
    let current = null;
    async function open(key) {
      const t = vis.find((x) => x.key === key) || vis[0];
      if (!t) { body.innerHTML = '<p class="text-muted">You do not have access to anything on this screen.</p>'; return; }
      current = t.key;
      host.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === t.key));
      try { history.replaceState(null, '', `#${t.key}`); } catch { /* ignore */ }
      body.innerHTML = '<div class="ph-card-pad text-muted">Loading…</div>';
      try { await t.render(body); } catch (err) { body.innerHTML = `<div class="card ph-card-pad">${window.UI.emptyStateHtml({ icon: 'alert', title: 'Could not load', message: err.message })}</div>`; }
      window.Permissions.applyPermissionGates(body, window.AppShell.getUser());
    }
    host.querySelectorAll('.tab-btn').forEach((b) => b.addEventListener('click', () => open(b.dataset.tab)));
    open(initial || (location.hash || '').slice(1) || (vis[0] && vis[0].key));
    return { open, current: () => current };
  }

  async function downloadCsv(path, params, filename) {
    const text = await window.Api.getText(path, params);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
    a.download = filename || 'export.csv';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  function printHtml(title, bodyHtml) {
    const f = document.createElement('iframe');
    f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
    document.body.appendChild(f);
    const d = f.contentWindow.document;
    d.open();
    d.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>
      body{font-family:Arial,Helvetica,sans-serif;margin:0;padding:8px;color:#000}
      .lab{width:78mm;border:1px solid #000;padding:6px 8px;margin:0 0 8px;page-break-inside:avoid;font-size:12px}
      .lab h4{margin:0 0 2px;font-size:14px}.lab .ph{font-size:10px;margin-bottom:4px;border-bottom:1px solid #000;padding-bottom:3px}
      .lab .dir{font-size:13px;font-weight:700;margin:6px 0}.lab .meta{font-size:10px;display:flex;justify-content:space-between;gap:6px;flex-wrap:wrap}
      .reprint{font-size:10px;font-weight:700;text-transform:uppercase}
    </style></head><body>${bodyHtml}</body></html>`);
    d.close();
    f.onload = () => { try { f.contentWindow.focus(); f.contentWindow.print(); } catch { /* blocked */ } setTimeout(() => f.remove(), 4000); };
  }

  /** res = POST /pharmacy/dispensings/:id/label */
  function printLabels(res) {
    const ph = res.pharmacy || {};
    // The label is for the patient: it follows the language the screen is in (Kiswahili or English).
    const T = (t) => { try { return window.I18n && window.I18n.t ? window.I18n.t(t) : t; } catch { return t; } };
    const html = (res.labels || []).map((l) => `
      <div class="lab">
        <div class="ph"><strong>${esc(ph.name || '')}</strong>${ph.phone ? ` · ${esc(ph.phone)}` : ''}${ph.address ? `<br>${esc(typeof ph.address === 'string' ? ph.address : Object.values(ph.address).filter(Boolean).join(', '))}` : ''}</div>
        <div><strong>${esc(res.patientName || '')}</strong> · ${esc(date(res.date))}${res.reprint ? ` <span class="reprint">${T('Reprint')}</span>` : ''}</div>
        <h4>${esc(l.medicine)} ${esc(l.strength || '')} ${esc(l.dosageForm || '')}</h4>
        <div>${T('Qty:')} <strong>${esc(qty(l.quantity))}</strong></div>
        <div class="dir">${esc(l.directions || T('As directed by your prescriber'))}</div>
        <div class="meta"><span>${(l.batches || []).map((b) => `${T('Batch')} ${esc(b.batchNumber)}${b.expiryDate ? ` · ${T('Exp')} ${esc(date(b.expiryDate))}` : ''}`).join('; ') || ''}</span><span>${esc(res.dispensingNumber || '')}</span></div>
        <div class="meta"><span>${T('Dispensed by')} ${esc((res.dispensedBy || {}).name || '')}${(res.dispensedBy || {}).registrationNumber ? ` (${esc(res.dispensedBy.registrationNumber)})` : ''}</span></div>
        <div class="meta"><span>${T('Keep out of reach of children')}</span></div>
      </div>`).join('');
    printHtml(`${T('Labels')} ${res.dispensingNumber || ''}`, html || `<p>${T('Nothing to print')}</p>`);
  }

  /** Search-and-choose modal. fetch(term) -> [{ html, value }]. Returns the modal element. */
  function picker({ title, placeholder, fetch, onSelect, footerHtml = '', maxWidth = '520px', emptyText = 'No matches' }) {
    const modal = window.UI.openModal({
      title, maxWidth,
      bodyHtml: `<div class="input-group"><span class="input-group-icon">${window.Icons.get('search')}</span><input class="input" id="ph-pick-q" autocomplete="off" placeholder="${esc(placeholder || 'Search')}" /></div><div class="ph-picker-list" id="ph-pick-list"><div class="ph-card-pad text-muted text-sm">Type to search…</div></div>`,
      footerHtml: footerHtml || '<button class="btn btn-secondary" data-act="close">Close</button>',
    });
    const q = modal.querySelector('#ph-pick-q'); const list = modal.querySelector('#ph-pick-list');
    let rows = []; let seq = 0;
    async function run() {
      const my = ++seq;
      try {
        rows = await fetch(q.value.trim());
        if (my !== seq) return;
        list.innerHTML = rows.length ? rows.map((r, i) => `<button type="button" data-i="${i}">${r.html}</button>`).join('') : `<div class="ph-card-pad text-muted text-sm">${esc(emptyText)}</div>`;
        list.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { const r = rows[Number(b.dataset.i)]; window.UI.closeModal(); onSelect(r.value); }));
      } catch (e) { list.innerHTML = `<div class="ph-card-pad text-sm" style="color:var(--color-danger)">${esc(e.message)}</div>`; }
    }
    q.addEventListener('input', window.UI.debounce(run, 250));
    modal.querySelector('[data-act="close"]')?.addEventListener('click', () => window.UI.closeModal());
    run(); q.focus();
    return modal;
  }

  const patientLine = (p) => `<strong>${esc(p.name)}</strong> <span class="text-muted text-xs">${esc(p.number || '')}${p.phone ? ` · ${esc(p.phone)}` : ''}${p.dateOfBirth ? ` · b. ${esc(date(p.dateOfBirth))}` : ''}</span>`;
  function patientPicker({ onSelect, allowNew = true }) {
    const modal = picker({
      title: 'Choose patient', placeholder: 'Name, patient no, phone or ID number',
      fetch: async (term) => { const { data } = await window.Api.get('/pharmacy/patients', { q: term || undefined, limit: 15 }); return (data.patients || []).map((p) => ({ html: patientLine(p), value: p })); },
      onSelect,
      footerHtml: `${allowNew && can('patients.manage') ? '<button class="btn btn-primary" data-act="new">New patient</button>' : ''}<button class="btn btn-secondary" data-act="close">Close</button>`,
    });
    modal.querySelector('[data-act="new"]')?.addEventListener('click', () => { window.UI.closeModal(); patientForm({ onDone: onSelect }); });
    return modal;
  }

  function medicinePicker({ onSelect, filter }) {
    return picker({
      title: 'Choose medicine', placeholder: 'Generic or brand name',
      fetch: async (term) => {
        const { data } = await window.Api.get('/pharmacy/medicines', { q: term || undefined, status: 'active', limit: 20 });
        return (data.medicines || []).filter((m) => !filter || filter(m)).map((m) => ({ html: `<strong>${esc(m.brandName || m.genericName)}</strong> <span class="text-muted text-xs">${esc(m.genericName)} ${esc(m.strength)} · ${esc(m.dosageForm)}</span> ${classBadge(m.classification)}`, value: m }));
      },
      onSelect,
    });
  }

  /** Validated prescriptions that can still be dispensed (used by the till). */
  function prescriptionPicker({ onSelect }) {
    return picker({
      title: 'Choose prescription', placeholder: 'Prescription number (RX-…)', maxWidth: '600px',
      emptyText: 'No validated prescription found. Record it on the Prescriptions screen and have a pharmacist review it.',
      fetch: async (term) => {
        const out = [];
        for (const status of ['VALIDATED', 'PARTIALLY_DISPENSED']) {
          const { data } = await window.Api.get('/pharmacy/prescriptions', { status, search: term || undefined, limit: 15 });
          out.push(...(data.prescriptions || []));
        }
        out.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        return out.map((r) => ({
          html: `<strong>${esc(r.number)}</strong> ${badge(r.status)} <span class="text-muted text-xs">valid until ${esc(date(r.validUntil))} · ${esc((r.prescriber || {}).name || '')}</span><div class="text-xs text-secondary">${(r.items || []).map((i) => `${esc(i.nameSnapshot)} ${esc(qty(i.dispensedQty || 0))}/${esc(qty(i.prescribedQty))}`).join(' · ')}</div>`,
          value: r,
        }));
      },
      onSelect,
    });
  }

  function patientForm({ patient, onDone }) {
    const K = window.ModuleKit; const edit = !!patient;
    const fields = [
      { name: 'name', label: 'Full name', required: true },
      { name: 'phone', label: 'Phone', type: 'tel' },
      { name: 'dateOfBirth', label: 'Date of birth', type: 'date' },
      { name: 'sex', label: 'Sex', type: 'select', options: [['', '-'], ['F', 'Female'], ['M', 'Male'], ['OTHER', 'Other']] },
      { name: 'idType', label: 'ID type', type: 'select', options: [['', '-'], ['NATIONAL_ID', 'National ID'], ['PASSPORT', 'Passport'], ['BIRTH_CERT', 'Birth certificate'], ['OTHER', 'Other']] },
      { name: 'idNumber', label: 'ID number' },
      { name: 'allergies', label: 'Allergies (comma separated)', placeholder: 'Penicillin, aspirin' },
      { name: 'notes', label: 'Notes', type: 'textarea' },
    ];
    if (!edit) fields.push({ name: 'consentBasis', label: 'Consent / lawful basis for keeping these details', required: true, value: 'Patient consented to the pharmacy keeping their records', hint: 'Recorded with the patient. Required.' });
    const values = edit ? { ...patient, dateOfBirth: day(patient.dateOfBirth), allergies: (patient.allergies || []).join(', ') } : {};
    K.formModal({
      title: edit ? `Edit ${patient.name}` : 'New patient', fields, values, maxWidth: '560px',
      onSubmit: async (d) => {
        const body = { ...d };
        if (body.allergies !== undefined) body.allergies = String(body.allergies).split(',').map((x) => x.trim()).filter(Boolean);
        else if (edit) body.allergies = [];
        if (!edit) { body.consent = { given: true, basis: body.consentBasis }; delete body.consentBasis; }
        let res;
        if (edit) ({ data: res } = await window.Api.patch(`/pharmacy/patients/${patient._id}`, body));
        else ({ data: res } = await window.Api.post('/pharmacy/patients', body));
        window.UI.toast.success(edit ? 'Patient updated' : 'Patient added');
        if (onDone) onDone(res.patient);
      },
    });
  }

  window.Pharmacy = { on, esc, can, date, dateTime, day, money, moneyCents, qty, label, badge, classBadge, classes, classOf, page, tabs, downloadCsv, printHtml, printLabels, picker, patientPicker, medicinePicker, prescriptionPicker, patientForm, patientLine };
})(window);
