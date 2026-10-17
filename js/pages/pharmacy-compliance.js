/**
 * pharmacy-compliance.js - recalls, storage/temperature log, expiry watch, reorder suggestions, controlled drugs
 * (register + signed period returns), Poisons Book, supplier licences + returns, compliance reports.
 * Nothing is edited in place: reasons are required and the server keeps the audit trail.
 */
(function () {
  const P = window.Pharmacy; const K = window.ModuleKit; const esc = P.esc;

  document.addEventListener('DOMContentLoaded', () => P.page({ title: 'Recalls & registers', render }));

  function render(el) {
    el.innerHTML = `<div class="page-header"><div><h1>Recalls &amp; registers</h1><p>Recalls, temperature log, controlled drugs, Poisons Book, expiry, suppliers and compliance reports.</p></div></div><div id="ph-host"></div>`;
    P.tabs(el.querySelector('#ph-host'), [
      { key: 'recalls', label: 'Recalls', perm: 'pharmacy.recall', render: recallsTab },
      { key: 'storage', label: 'Storage & temperature', perm: 'pharmacy.storage', render: storageTab },
      { key: 'expiry', label: 'Expiry watch', perm: 'pharmacy.reports', render: expiryTab },
      { key: 'replenish', label: 'Reorder suggestions', perm: 'pharmacy.reports', render: replenishTab },
      { key: 'controlled', label: 'Controlled drugs', perm: 'pharmacy.reports', render: controlledTab },
      { key: 'poisons', label: 'Poisons Book', perm: 'patients.view', render: poisonsTab },
      { key: 'suppliers', label: 'Suppliers & returns', perm: 'medicines.manage', render: suppliersTab },
      { key: 'reports', label: 'Reports', perm: 'pharmacy.reports', render: reportsTab },
    ]);
  }

  const bar = (html) => `<div class="ph-h" style="margin-bottom:var(--space-3)">${html}</div>`;
  const slot = (host) => { host.innerHTML = '<div id="ph-top"></div><div id="ph-list"></div>'; return [host.querySelector('#ph-top'), host.querySelector('#ph-list')]; };
  const fail = (e) => window.UI.toast.error(e.message || 'Something went wrong');
  const branch = () => window.AppShell.getActiveBranchId() || undefined;

  /** Choose batches at this branch (multi). onDone(rows[]) */
  function batchPicker({ title = 'Choose batches', status, onDone }) {
    const chosen = new Map();
    const modal = window.UI.openModal({
      title, maxWidth: '640px',
      bodyHtml: `<div class="input-group"><span class="input-group-icon">${window.Icons.get('search')}</span><input class="input" id="bp-q" placeholder="Batch number" /></div><div class="ph-picker-list" id="bp-list" style="max-height:300px"></div><div class="ph-note" id="bp-count">None chosen</div>`,
      footerHtml: '<button class="btn btn-secondary" data-act="close">Cancel</button><button class="btn btn-primary" data-act="ok">Use chosen batches</button>',
    });
    const list = modal.querySelector('#bp-list');
    const paint = (rows) => {
      list.innerHTML = rows.length ? rows.map((b) => `<label class="checkbox-row" style="padding:var(--space-2) var(--space-3);border-bottom:1px solid var(--color-border)"><input type="checkbox" data-id="${b._id}" ${chosen.has(b._id) ? 'checked' : ''}/> <span class="text-sm"><strong>${esc(b.batchNumber)}</strong> · ${esc((b.productId || {}).name || '')} <span class="text-muted text-xs">qty ${esc(P.qty(b.quantity))} · exp ${esc(P.date(b.expiryDate))} · ${esc(b.status)}</span></span></label>`).join('') : '<div class="ph-card-pad text-muted text-sm">No batches found</div>';
      list.querySelectorAll('input').forEach((c) => c.addEventListener('change', () => {
        const row = rows.find((r) => r._id === c.dataset.id);
        if (c.checked) chosen.set(c.dataset.id, row); else chosen.delete(c.dataset.id);
        modal.querySelector('#bp-count').textContent = chosen.size ? `${chosen.size} chosen` : 'None chosen';
      }));
    };
    const run = async () => {
      try {
        const { data } = await window.Api.get('/batches', { branchId: branch(), search: modal.querySelector('#bp-q').value.trim() || undefined, status, limit: 40 });
        paint((data.items || []).filter((b) => b.quantity > 0));
      } catch (e) { list.innerHTML = `<div class="ph-card-pad text-sm" style="color:var(--color-danger)">${esc(e.message)}</div>`; }
    };
    modal.querySelector('#bp-q').addEventListener('input', window.UI.debounce(run, 250));
    modal.querySelector('[data-act="close"]').addEventListener('click', () => window.UI.closeModal());
    modal.querySelector('[data-act="ok"]').addEventListener('click', () => { window.UI.closeModal(); onDone([...chosen.values()]); });
    run();
  }

  /* ------------------------------ recalls ------------------------------ */
  function recallsTab(host) {
    const [top, listEl] = slot(host);
    top.innerHTML = bar(`<p class="text-sm text-secondary" style="margin:0;flex:1">Starting a recall holds every batch with that number, so it cannot be sold, and traces who received it.</p><button class="btn btn-primary" id="rc-new" data-requires-permission="pharmacy.recall">${window.Icons.get('plus')} Start a recall</button>`);
    const list = K.listPage({
      container: listEl, endpoint: '/pharmacy/recalls', itemsKey: 'recalls',
      filters: [{ key: 'status', label: 'Any status', options: [['OPEN', 'Open'], ['CLOSED', 'Closed']] }],
      columns: [
        { label: 'No.', render: (r) => `<strong>${esc(r.number)}</strong>` },
        { label: 'Batch', render: (r) => esc(r.batchNumber) },
        { label: 'Reason', render: (r) => `<span class="text-sm">${esc(r.reason)}</span>${r.noticeReference ? `<div class="text-xs text-muted">Notice ${esc(r.noticeReference)}</div>` : ''}` },
        { label: 'Source', render: (r) => esc(P.label(r.source)) },
        { label: 'Held', align: 'right', render: (r) => esc(P.qty(r.unitsHeld)) },
        { label: 'Started', render: (r) => P.date(r.createdAt) },
        { label: 'Status', render: (r) => P.badge(r.status) },
      ],
      rowActions: () => K.btn('open', 'Open'), onAction: (a, r) => openRecall(r._id, () => list.reload()),
      emptyText: 'No recalls', emptyMessage: 'When the regulator or a supplier recalls a batch, start it here.', emptyIcon: 'shield',
    });
    top.querySelector('#rc-new').addEventListener('click', () => {
      let med = null;
      const m = window.UI.openModal({
        title: 'Start a recall', maxWidth: '560px',
        bodyHtml: `<div class="ph-danger-box">This takes every batch with this number out of sellable stock straight away.</div><form id="rc-form">
          <div class="field"><label>Batch number *</label><input class="input" name="batchNumber" required /></div>
          <div class="field"><label>Medicine <span class="text-muted">(optional, narrows it down)</span></label><div class="flex" style="gap:var(--space-2);align-items:center"><span id="rc-med" class="text-sm text-muted" style="flex:1">Any medicine with this batch number</span><button type="button" class="btn btn-secondary btn-sm" id="rc-pick">Choose</button></div></div>
          <div class="form-row"><div class="field"><label>Source</label><select class="select" name="source">${['PPB', 'MANUFACTURER', 'SUPPLIER', 'INTERNAL', 'OTHER'].map((s) => `<option value="${s}">${esc(P.label(s))}</option>`).join('')}</select></div>
          <div class="field"><label>Notice reference</label><input class="input" name="noticeReference" /></div></div>
          <div class="field"><label>Reason *</label><textarea class="input" name="reason" rows="3" required></textarea></div></form>`,
        footerHtml: '<button class="btn btn-secondary" data-act="cancel">Cancel</button><button class="btn btn-primary" data-act="go">Hold stock &amp; start recall</button>',
      });
      m.querySelector('#rc-pick').addEventListener('click', () => P.medicinePicker({ onSelect: (x) => { med = x; m.querySelector('#rc-med').textContent = `${x.brandName || x.genericName} ${x.strength}`; } }));
      m.querySelector('[data-act="cancel"]').addEventListener('click', () => window.UI.closeModal());
      const go = m.querySelector('[data-act="go"]');
      go.addEventListener('click', async () => {
        const f = m.querySelector('#rc-form'); if (!f.reportValidity()) return;
        const v = (n) => String(f.elements[n].value || '').trim();
        window.UI.setButtonLoading(go, true, 'Working…');
        try {
          const { data } = await window.Api.post('/pharmacy/recalls', { batchNumber: v('batchNumber'), reason: v('reason'), source: v('source'), noticeReference: v('noticeReference') || undefined, productId: med ? med.productId : undefined, branchId: branch() });
          window.UI.closeModal(); window.UI.toast.success(`Recall ${data.recall.number} started: ${data.batches.length} batch record(s) held, ${data.affectedSalesCount} sale(s) traced`); list.reload();
        } catch (e) { fail(e); window.UI.setButtonLoading(go, false); }
      });
    });
  }

  async function openRecall(id, reload) {
    try {
      const { data } = await window.Api.get(`/pharmacy/recalls/${id}/trace`);
      const r = data.recall; const closed = r.status === 'CLOSED';
      const modal = window.UI.openModal({
        title: `${r.number} · batch ${r.batchNumber}`, maxWidth: '820px',
        bodyHtml: `${K.kv([['Status', P.badge(r.status)], ['Reason', esc(r.reason)], ['Source', esc(P.label(r.source))], ['Notice', esc(r.noticeReference)], ['Units held at start', esc(P.qty(r.unitsHeld))], ['Closed', r.closedAt ? esc(P.dateTime(r.closedAt)) : '']])}
          <h4 style="margin:0 0 var(--space-2)">Batch records</h4>
          <table class="table"><thead><tr><th>Batch</th><th>Qty left</th><th>Status</th><th>Expiry</th></tr></thead><tbody>${(data.batches || []).map((b) => `<tr><td>${esc(b.batchNumber)}</td><td>${esc(P.qty(b.quantity))}</td><td>${P.badge(b.status)}</td><td>${P.date(b.expiryDate)}</td></tr>`).join('') || '<tr><td colspan="4" class="text-muted">None</td></tr>'}</tbody></table>
          <h4 style="margin:var(--space-4) 0 var(--space-2)">Who received it</h4>
          <p class="text-sm">${esc(data.salesCount)} sale(s) and ${esc((data.dispensings || []).length)} dispensing(s) used this batch.</p>
          ${data.patientsHidden ? '<p class="ph-note">Patient details are only shown to staff who may open patient records.</p>' : (data.patients || []).length ? `<table class="table"><thead><tr><th>Patient</th><th>No.</th><th>Phone</th></tr></thead><tbody>${data.patients.map((p) => `<tr><td>${esc(p.name)}</td><td>${esc(p.number)}</td><td>${esc(p.phone || '-')}</td></tr>`).join('')}</tbody></table><p class="ph-note">Contact these patients as the notice requires. This view was logged.</p>` : '<p class="text-muted text-sm">No dispensings to trace.</p>'}
          <h4 style="margin:var(--space-4) 0 var(--space-2)">Actions taken</h4>
          ${(r.actions || []).map((a) => `<div class="text-sm" style="padding:4px 0"><span class="badge badge-info">${esc(a.action)}</span> ${esc(a.note || '')} <span class="text-muted text-xs">${esc(P.dateTime(a.at))}</span></div>`).join('') || '<p class="text-muted text-sm">None yet.</p>'}`,
        footerHtml: `${!closed ? '<button class="btn btn-secondary" data-act="act">Record an action</button>' + (P.can('medicines.manage') ? '<button class="btn btn-secondary" data-act="return">Return to supplier</button>' : '') + '<button class="btn btn-primary" data-act="close-rc">Close recall</button>' : ''}<button class="btn btn-secondary" data-act="x">Close window</button>`,
      });
      modal.querySelector('[data-act="x"]').addEventListener('click', () => window.UI.closeModal());
      modal.querySelector('[data-act="act"]')?.addEventListener('click', () => {
        window.UI.closeModal();
        K.formModal({ title: `Action · ${r.number}`, submitLabel: 'Record', fields: [{ name: 'action', label: 'Action', required: true, placeholder: 'Patients contacted, stock counted…' }, { name: 'note', label: 'Note', type: 'textarea' }], onSubmit: async (d) => { await window.Api.post(`/pharmacy/recalls/${id}/actions`, d); window.UI.toast.success('Action recorded'); reload(); } });
      });
      modal.querySelector('[data-act="return"]')?.addEventListener('click', () => { window.UI.closeModal(); returnForm({ recallId: id, onDone: reload, preBatch: (data.batches || []).filter((b) => b.quantity > 0) }); });
      modal.querySelector('[data-act="close-rc"]')?.addEventListener('click', () => {
        window.UI.closeModal();
        K.formModal({ title: `Close ${r.number}`, submitLabel: 'Close recall', intro: 'Only a pharmacist can close a recall, and only once none of the held stock is left (disposed of or returned to the supplier).', fields: [{ name: 'note', label: 'Closing note', type: 'textarea' }], onSubmit: async (d) => { await window.Api.post(`/pharmacy/recalls/${id}/close`, d); window.UI.toast.success('Recall closed'); reload(); } });
      });
    } catch (e) { fail(e); }
  }

  /* ------------------------------ storage ------------------------------ */
  async function storageTab(host) {
    const [top, listEl] = slot(host);
    const s = await P.classes();
    top.innerHTML = bar(`<p class="text-sm text-secondary" style="margin:0;flex:1">A reading outside its range raises an exception. Stock named on it is quarantined until a pharmacist assesses it.</p><button class="btn btn-primary" id="st-new">${window.Icons.get('thermo')} Log a reading</button>`);
    const list = K.listPage({
      container: listEl, endpoint: '/pharmacy/storage', itemsKey: 'logs',
      query: () => ({ branchId: branch() }),
      filters: [{ key: 'openOnly', label: 'All readings', options: [['true', 'Open exceptions only']] }],
      columns: [
        { label: 'When', render: (l) => P.dateTime(l.createdAt) },
        { label: 'Place', render: (l) => esc(l.place) },
        { label: 'Reading', render: (l) => `<strong class="${l.withinRange ? '' : 'ph-num bad'}">${esc(l.readingC)} °C</strong> <span class="text-muted text-xs">(${esc(l.minC)}–${esc(l.maxC)})</span>` },
        { label: 'Result', render: (l) => (l.withinRange ? P.badge('active', 'In range') : l.exception ? P.badge(l.exception.status === 'OPEN' ? 'open' : 'assessed', l.exception.status === 'OPEN' ? 'Exception open' : `Assessed · ${P.label(l.exception.outcome)}`) : P.badge('exception', 'Out of range')) },
        { label: 'Held', render: (l) => (l.exception ? esc((l.exception.batchIds || []).length) : '-') },
      ],
      rowActions: (l) => (l.exception && l.exception.status === 'OPEN' ? `${K.btn('flag', 'Add stock')} ${P.can('pharmacy.recall') || P.can('medicines.manage') ? K.btn('assess', 'Assess', 'btn-primary') : ''}` : ''),
      onAction: (a, l) => (a === 'flag' ? flagMore(l, () => list.reload()) : assess(l, () => list.reload())),
      emptyText: 'No readings yet', emptyMessage: 'Log the fridge and room temperature as often as your procedure requires.', emptyIcon: 'inventory',
    });
    top.querySelector('#st-new').addEventListener('click', () => {
      let batches = [];
      const rooms = s.rooms || [];
      const m = window.UI.openModal({
        title: 'Log a temperature reading', maxWidth: '560px',
        bodyHtml: `<form id="st-form">
          <div class="field"><label>Place *</label>${rooms.length ? `<select class="select" name="place" required>${rooms.map((r) => `<option value="${esc(r.place)}">${esc(r.place)} (${esc(r.minC)}–${esc(r.maxC)} °C)</option>`).join('')}<option value="__other">Other…</option></select><input class="input hidden" name="placeOther" placeholder="Name of the place" style="margin-top:var(--space-2)" />` : '<input class="input" name="place" required placeholder="Fridge 1, Dispensary shelf" />'}</div>
          <div class="form-row"><div class="field"><label>Reading (°C) *</label><input class="input" name="readingC" type="number" step="0.1" required /></div>
          ${rooms.length ? '' : '<div class="field"><label>Allowed range (°C)</label><div class="flex" style="gap:var(--space-2)"><input class="input" name="minC" type="number" step="0.1" placeholder="min" /><input class="input" name="maxC" type="number" step="0.1" placeholder="max" /></div></div>'}</div>
          <div class="field"><label>Note</label><input class="input" name="note" /></div>
          <div class="field"><label>Stock stored there <span class="text-muted">(used only if the reading is out of range)</span></label><div class="flex" style="gap:var(--space-2);align-items:center"><span class="text-sm text-muted" id="st-b" style="flex:1">None chosen</span><button type="button" class="btn btn-secondary btn-sm" id="st-pick">Choose batches</button></div></div></form>`,
        footerHtml: '<button class="btn btn-secondary" data-act="cancel">Cancel</button><button class="btn btn-primary" data-act="save">Save reading</button>',
      });
      const f = m.querySelector('#st-form');
      if (rooms.length) f.elements.place.addEventListener('change', () => f.elements.placeOther.classList.toggle('hidden', f.elements.place.value !== '__other'));
      m.querySelector('#st-pick').addEventListener('click', () => batchPicker({ title: 'Stock stored in this place', status: 'active', onDone: (rows) => { batches = rows; m.querySelector('#st-b').textContent = rows.length ? `${rows.length} batch(es)` : 'None chosen'; } }));
      m.querySelector('[data-act="cancel"]').addEventListener('click', () => window.UI.closeModal());
      const save = m.querySelector('[data-act="save"]');
      save.addEventListener('click', async () => {
        if (!f.reportValidity()) return;
        const v = (n) => (f.elements[n] ? String(f.elements[n].value || '').trim() : '');
        const place = v('place') === '__other' ? v('placeOther') : v('place');
        if (!place) return window.UI.toast.error('Name the place');
        const body = { branchId: branch(), place, readingC: Number(v('readingC')), note: v('note') || undefined, ...(v('minC') && v('maxC') ? { minC: Number(v('minC')), maxC: Number(v('maxC')) } : {}), ...(batches.length ? { batchIds: batches.map((b) => b._id) } : {}) };
        window.UI.setButtonLoading(save, true, 'Saving…');
        try {
          const { data } = await window.Api.post('/pharmacy/storage', body);
          window.UI.closeModal();
          if (data.log.withinRange) window.UI.toast.success('Reading recorded'); else window.UI.toast.warning('Out of range. Exception raised' + (batches.length ? ' and the stock is quarantined.' : '. Name the stock affected so it can be held.'));
          list.reload();
        } catch (e) { fail(e); window.UI.setButtonLoading(save, false); }
      });
    });
  }

  function flagMore(l, reload) {
    batchPicker({ title: 'More stock affected', status: 'active', onDone: async (rows) => {
      if (!rows.length) return;
      try { await window.Api.post(`/pharmacy/storage/${l._id}/flag`, { batchIds: rows.map((b) => b._id) }); window.UI.toast.success('Stock quarantined'); reload(); } catch (e) { fail(e); }
    } });
  }

  async function assess(l, reload) {
    try {
      const ids = (l.exception && l.exception.batchIds) || [];
      const known = new Map();
      try { const { data } = await window.Api.get('/batches', { branchId: l.branchId, status: 'quarantined', limit: 100 }); (data.items || []).forEach((b) => known.set(String(b._id), b)); } catch { /* fall back to ids */ }
      const nameOf = (id) => { const b = known.get(String(id)); return b ? `<strong>${esc(b.batchNumber)}</strong> · ${esc((b.productId || {}).name || '')} <span class="text-muted">qty ${esc(P.qty(b.quantity))}</span>` : `<span class="text-xs">${esc(id)}</span>`; };
      const m = window.UI.openModal({
        title: `Assess exception · ${l.place} ${l.readingC} °C`, maxWidth: '620px',
        bodyHtml: `<p class="text-sm text-secondary" style="margin-top:0">Only a pharmacist can do this. Decide for every held batch whether it is safe to release back to stock or must be disposed of. The system does not decide for you.</p>
          ${ids.length ? `<table class="table"><thead><tr><th>Held batch</th><th>Release</th><th>Dispose</th></tr></thead><tbody>${ids.map((id) => `<tr><td class="text-sm">${nameOf(id)}</td><td><input type="radio" name="d-${id}" value="release" /></td><td><input type="radio" name="d-${id}" value="dispose" checked /></td></tr>`).join('')}</tbody></table>` : '<p class="text-muted text-sm">No stock was held for this exception.</p>'}
          <div class="field" style="margin-top:var(--space-3)"><label>Assessment note *</label><textarea class="input" id="as-note" rows="3"></textarea></div>`,
        footerHtml: '<button class="btn btn-secondary" data-act="cancel">Cancel</button><button class="btn btn-primary" data-act="ok">Record assessment</button>',
      });
      m.querySelector('[data-act="cancel"]').addEventListener('click', () => window.UI.closeModal());
      const ok = m.querySelector('[data-act="ok"]');
      ok.addEventListener('click', async () => {
        const note = m.querySelector('#as-note').value.trim();
        if (note.length < 3) return window.UI.toast.error('Add an assessment note');
        const pick = (v) => ids.filter((id) => (m.querySelector(`input[name="d-${id}"]:checked`) || {}).value === v);
        window.UI.setButtonLoading(ok, true, 'Saving…');
        try { await window.Api.post(`/pharmacy/storage/${l._id}/assess`, { releaseBatchIds: pick('release'), disposeBatchIds: pick('dispose'), note }); window.UI.closeModal(); window.UI.toast.success('Assessment recorded'); reload(); } catch (e) { fail(e); window.UI.setButtonLoading(ok, false); }
      });
    } catch (e) { fail(e); }
  }

  /* ------------------------------ expiry + replenishment ------------------------------ */
  async function expiryTab(host) {
    const { data } = await window.Api.get('/pharmacy/reports/expiry', { branchId: branch() });
    const row = (b) => `<tr><td><strong>${esc((b.productId || {}).name || '')}</strong></td><td>${esc(b.batchNumber)}</td><td>${esc(P.qty(b.quantity))}</td><td>${P.date(b.expiryDate)}</td></tr>`;
    host.innerHTML = `<div class="ph-grid">
        <div class="stat-card"><div class="stat-label">Expired, still in stock</div><div class="stat-value ph-num ${data.expired.length ? 'bad' : ''}">${data.expired.length}</div><div class="ph-note">Cost ${esc(P.moneyCents(data.expiredCostValue))}</div></div>
        <div class="stat-card"><div class="stat-label">Expiring within ${esc(data.days)} days</div><div class="stat-value ph-num ${data.expiring.length ? 'warn' : ''}">${data.expiring.length}</div><div class="ph-note">Cost ${esc(P.moneyCents(data.expiringCostValue))}</div></div></div>
      <div class="ph-two"><div class="card ph-card-pad"><div class="ph-h"><h3>Expired</h3></div><div class="table-wrap"><table class="table"><thead><tr><th>Medicine</th><th>Batch</th><th>Qty</th><th>Expired</th></tr></thead><tbody>${data.expired.map(row).join('') || '<tr><td colspan="4" class="text-muted">None</td></tr>'}</tbody></table></div><p class="ph-note">Expired stock cannot be sold. Dispose of it or return it to the supplier from <a href="batches.html">Batches &amp; expiry</a>.</p></div>
      <div class="card ph-card-pad"><div class="ph-h"><h3>Expiring soon</h3><span class="ph-note">Warn at ${(data.warnDays || []).map(esc).join(' / ')} days</span></div><div class="table-wrap"><table class="table"><thead><tr><th>Medicine</th><th>Batch</th><th>Qty</th><th>Expires</th></tr></thead><tbody>${data.expiring.map(row).join('') || '<tr><td colspan="4" class="text-muted">None</td></tr>'}</tbody></table></div></div></div>`;
  }

  async function replenishTab(host) {
    host.innerHTML = '<div id="rp-body"></div>';
    const load = async (lookbackDays, leadDays, safetyDays) => {
      const { data } = await window.Api.get('/pharmacy/reports/replenishment', { branchId: branch(), lookbackDays, leadDays, safetyDays });
      host.querySelector('#rp-body').innerHTML = `<div class="card ph-card-pad">
        <form class="flex" id="rp-f" style="gap:var(--space-3);flex-wrap:wrap;align-items:end;margin-bottom:var(--space-3)">
          <div class="field" style="margin:0"><label class="text-xs">Look back (days)</label><input class="input" name="a" type="number" min="7" max="365" value="${data.lookbackDays}" style="width:110px"/></div>
          <div class="field" style="margin:0"><label class="text-xs">Supplier lead time (days)</label><input class="input" name="b" type="number" min="0" max="120" value="${data.leadDays}" style="width:110px"/></div>
          <div class="field" style="margin:0"><label class="text-xs">Safety cover (days)</label><input class="input" name="c" type="number" min="0" max="120" value="${data.safetyDays}" style="width:110px"/></div>
          <button class="btn btn-secondary">Recalculate</button></form>
        <div class="table-wrap"><table class="table"><thead><tr><th>Medicine</th><th style="text-align:right">Daily use</th><th style="text-align:right">On hand</th><th style="text-align:right">Expiring first</th><th style="text-align:right">Days of cover</th><th style="text-align:right">Suggested order</th></tr></thead><tbody>${(data.suggestions || []).map((s) => `<tr><td><strong>${esc(s.name)}</strong></td><td style="text-align:right">${esc(s.dailyUse)}</td><td style="text-align:right">${esc(P.qty(s.onHand))}</td><td style="text-align:right">${esc(P.qty(s.expiringBeforeArrival))}</td><td style="text-align:right">${s.daysOfCover == null ? '-' : esc(s.daysOfCover)}</td><td style="text-align:right"><strong>${esc(P.qty(s.suggestedOrder))}</strong></td></tr>`).join('') || '<tr><td colspan="6" class="text-muted">Nothing needs ordering based on recent sales.</td></tr>'}</tbody></table></div>
        <p class="ph-note">Suggestions come from your recent sales. Stock that will expire before the order arrives is not counted as cover. Always check before ordering.</p></div>`;
      host.querySelector('#rp-f').addEventListener('submit', (e) => { e.preventDefault(); const f = e.target.elements; load(f.a.value, f.b.value, f.c.value).catch(fail); });
    };
    await load();
  }

  /* ------------------------------ controlled drugs ------------------------------ */
  function controlledTab(host) {
    host.innerHTML = '<div class="ph-two"><div id="cd-reg" class="card ph-card-pad"></div><div id="cd-ret"></div></div>';
    registerPanel(host.querySelector('#cd-reg'));
    returnsPanel(host.querySelector('#cd-ret'));
  }

  function registerPanel(el) {
    el.innerHTML = `<div class="ph-h"><h3>Controlled-drug register</h3></div><p class="text-sm text-secondary" style="margin-top:0">A running record for one controlled medicine, built from the stock ledger so it cannot disagree with stock.</p>
      <form id="cr-f" class="flex" style="gap:var(--space-2);flex-wrap:wrap;align-items:end"><div class="field" style="margin:0;flex:1;min-width:200px"><label class="text-xs">Medicine</label><button type="button" class="btn btn-secondary btn-block" id="cr-pick" style="justify-content:flex-start">Choose controlled medicine</button></div>
      <div class="field" style="margin:0"><label class="text-xs">From</label><input class="input" type="date" name="from" /></div><div class="field" style="margin:0"><label class="text-xs">To</label><input class="input" type="date" name="to" /></div><button class="btn btn-primary" id="cr-go" disabled>Show</button></form><div id="cr-out" style="margin-top:var(--space-3)"></div>`;
    let med = null;
    const restricted = (m) => { const c = P.classOf(m.classification); return c && c.restricted; };
    el.querySelector('#cr-pick').addEventListener('click', () => P.medicinePicker({ filter: restricted, onSelect: (m) => { med = m; el.querySelector('#cr-pick').textContent = `${m.brandName || m.genericName} ${m.strength}`; el.querySelector('#cr-go').disabled = false; } }));
    const q = () => { const f = el.querySelector('#cr-f').elements; return { productId: med.productId, branchId: branch(), from: f.from.value || undefined, to: f.to.value ? `${f.to.value}T23:59:59` : undefined }; };
    el.querySelector('#cr-f').addEventListener('submit', async (e) => {
      e.preventDefault(); if (!med) return;
      const out = el.querySelector('#cr-out'); out.innerHTML = '<span class="text-muted">Loading…</span>';
      try {
        const { data } = await window.Api.get('/pharmacy/reports/controlled-register', q());
        const diff = data.closing !== data.systemQuantity;
        out.innerHTML = `${K.kv([['Opening', esc(P.qty(data.opening))], ['Received', esc(P.qty(data.received))], ['Issued', esc(P.qty(data.issued))], ['Closing', esc(P.qty(data.closing))], ['Stock on hand now', esc(P.qty(data.systemQuantity))]])}
          ${diff ? '<div class="ph-warn-box">The register closing balance differs from stock on hand now because the period ends before today.</div>' : ''}
          <div class="table-wrap"><table class="table"><thead><tr><th>When</th><th>Type</th><th style="text-align:right">Qty</th><th style="text-align:right">Balance</th><th>Dispensing / reason</th></tr></thead><tbody>${data.entries.map((x) => `<tr><td>${esc(P.dateTime(x.at))}</td><td>${esc(P.label(x.type))}</td><td style="text-align:right">${esc(P.qty(x.quantity))}</td><td style="text-align:right">${esc(P.qty(x.balance))}</td><td class="text-xs">${esc(x.dispensing || x.reason || '')}</td></tr>`).join('') || '<tr><td colspan="5" class="text-muted">No movements in this period</td></tr>'}</tbody></table></div>
          <button class="btn btn-secondary btn-sm" id="cr-csv" style="margin-top:var(--space-2)">Download CSV</button>`;
        out.querySelector('#cr-csv').addEventListener('click', () => P.downloadCsv('/pharmacy/exports/controlled-register', q(), 'controlled-register.csv').catch(fail));
      } catch (err) { out.innerHTML = `<div class="ph-danger-box">${esc(err.message)}</div>`; }
    });
  }

  function returnsPanel(el) {
    el.innerHTML = '<div class="card ph-card-pad"><div class="ph-h"><h3>Period returns (pharmacist-signed)</h3><button class="btn btn-primary btn-sm" id="pr-new" data-requires-permission="pharmacy.restricted">Prepare a return</button></div><p class="text-sm text-secondary" style="margin-top:0">Opening, received, issued and closing for every controlled medicine, your physical count and the variance, signed by a pharmacist. A signed return is locked.</p><div id="pr-list"></div></div>';
    const list = K.listPage({
      container: el.querySelector('#pr-list'), endpoint: '/pharmacy/controlled-returns', itemsKey: 'returns', query: () => ({ branchId: branch() }),
      columns: [
        { label: 'No.', render: (r) => `<strong>${esc(r.number)}</strong>` },
        { label: 'Period', render: (r) => `${esc(P.date(r.periodFrom))} – ${esc(P.date(r.periodTo))}` },
        { label: 'Status', render: (r) => P.badge(r.status) },
      ],
      rowActions: () => K.btn('open', 'Open'), onAction: (a, r) => openReturn(r._id, () => list.reload()),
      emptyText: 'No returns yet', emptyIcon: 'clipboard',
    });
    window.Permissions.applyPermissionGates(el, window.AppShell.getUser());
    el.querySelector('#pr-new').addEventListener('click', () => {
      const today = P.day(new Date()); const first = P.day(new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1)); const last = P.day(new Date(new Date().getFullYear(), new Date().getMonth(), 0));
      K.formModal({ title: 'Prepare a controlled-drug return', submitLabel: 'Prepare', values: { from: first, to: last },
        intro: 'Pulls opening, received, issued and closing from the stock ledger for the period. You then enter your physical count.',
        fields: [{ name: 'from', label: 'Period from', type: 'date', required: true }, { name: 'to', label: 'Period to', type: 'date', required: true }],
        onSubmit: async (d) => {
          const { data } = await window.Api.post('/pharmacy/controlled-returns', { branchId: branch(), from: d.from, to: `${d.to}T23:59:59` });
          window.UI.toast.success(`Return ${data.controlledReturn.number} prepared`); list.reload(); setTimeout(() => openReturn(data.controlledReturn._id, () => list.reload()), 200);
        } });
    });
  }

  async function openReturn(id, reload) {
    try {
      const { data } = await window.Api.get(`/pharmacy/controlled-returns/${id}`);
      const r = data.controlledReturn; const draft = r.status === 'DRAFT';
      const canCount = draft && P.can('pharmacy.restricted');
      const m = window.UI.openModal({
        title: `${r.number} · ${P.label(r.status)}`, maxWidth: '900px',
        bodyHtml: `${K.kv([['Period', `${esc(P.date(r.periodFrom))} – ${esc(P.date(r.periodTo))}`], ['Signed by', r.signer ? `${esc(r.signer.name)}${r.signer.registrationNumber ? ` (${esc(r.signer.registrationNumber)})` : ''}` : ''], ['Signed at', r.signedAt ? esc(P.dateTime(r.signedAt)) : '']])}
          <div class="table-wrap"><table class="table"><thead><tr><th>Medicine</th><th style="text-align:right">Opening</th><th style="text-align:right">Received</th><th style="text-align:right">Issued</th><th style="text-align:right">Closing</th><th style="text-align:right">Counted</th><th style="text-align:right">Variance</th></tr></thead><tbody>${(r.lines || []).map((l) => `<tr><td><strong>${esc(l.name)}</strong> <span class="text-xs text-muted">${esc(l.strength || '')} ${esc(l.dosageForm || '')}</span></td><td style="text-align:right">${esc(P.qty(l.opening))}</td><td style="text-align:right">${esc(P.qty(l.received))}</td><td style="text-align:right">${esc(P.qty(l.issued))}</td><td style="text-align:right">${esc(P.qty(l.closing))}</td><td style="text-align:right">${canCount ? `<input class="input" data-cnt="${l.productId}" type="number" min="0" step="any" value="${l.countedQuantity == null ? '' : l.countedQuantity}" style="width:90px;text-align:right"/>` : (l.countedQuantity == null ? '-' : esc(P.qty(l.countedQuantity)))}</td><td style="text-align:right" class="${l.variance ? 'ph-num bad' : ''}">${l.variance == null ? '-' : esc(P.qty(l.variance))}</td></tr>`).join('') || '<tr><td colspan="7" class="text-muted">No controlled medicines</td></tr>'}</tbody></table></div>
          ${r.notes ? `<p class="text-sm">${esc(r.notes)}</p>` : ''}`,
        footerHtml: `${canCount ? '<button class="btn btn-secondary" data-act="save">Save counts</button><button class="btn btn-primary" data-act="sign">Sign &amp; lock</button>' : ''}<button class="btn btn-secondary" data-act="csv">Download CSV</button><button class="btn btn-secondary" data-act="x">Close</button>`,
      });
      m.querySelector('[data-act="x"]').addEventListener('click', () => window.UI.closeModal());
      m.querySelector('[data-act="csv"]').addEventListener('click', () => P.downloadCsv(`/pharmacy/controlled-returns/${id}/export`, {}, `controlled-return-${r.number}.csv`).catch(fail));
      const counts = () => [...m.querySelectorAll('[data-cnt]')].filter((i) => i.value !== '').map((i) => ({ productId: i.dataset.cnt, countedQuantity: Number(i.value) }));
      m.querySelector('[data-act="save"]')?.addEventListener('click', async () => { try { const c = counts(); if (!c.length) return window.UI.toast.error('Enter at least one count'); await window.Api.put(`/pharmacy/controlled-returns/${id}/counts`, { counts: c }); window.UI.toast.success('Counts saved'); window.UI.closeModal(); openReturn(id, reload); } catch (e) { fail(e); } });
      m.querySelector('[data-act="sign"]')?.addEventListener('click', async () => {
        const ok = await window.UI.confirmDialog({ title: 'Sign and lock this return?', message: 'Your name and registration number are recorded. A signed return cannot be changed. Save your counts first.', confirmText: 'Sign' });
        if (!ok) return;
        try { await window.Api.post(`/pharmacy/controlled-returns/${id}/sign`, {}); window.UI.toast.success('Return signed'); window.UI.closeModal(); reload(); } catch (e) { fail(e); }
      });
    } catch (e) { fail(e); }
  }

  /* ------------------------------ poisons book ------------------------------ */
  function poisonsTab(host) {
    K.listPage({
      container: host, endpoint: '/pharmacy/poisons-book', itemsKey: 'entries',
      columns: [
        { label: 'Entry', render: (e) => `<strong>${esc(e.number)}</strong>` },
        { label: 'Date', render: (e) => P.dateTime(e.createdAt) },
        { label: 'Purchaser', render: (e) => `${esc((e.purchaser || {}).name)}<div class="text-xs text-muted">${esc((e.purchaser || {}).address)}${(e.purchaser || {}).idNumber ? ` · ID ${esc(e.purchaser.idNumber)}` : ''}</div>` },
        { label: 'Poison', render: (e) => `<div class="text-xs">${(e.items || []).map((i) => `${esc(i.nameSnapshot)} ${esc(i.strength || '')} × ${esc(P.qty(i.quantity))}`).join('<br>')}</div>` },
        { label: 'Purpose', render: (e) => esc((e.purchaser || {}).purpose) },
        { label: 'Sold by', render: (e) => esc((e.dispenserSnapshot || {}).name || '-') },
      ],
      emptyText: 'No Poisons Book entries', emptyMessage: 'An entry is written automatically when a Part I poison is sold without a prescription.', emptyIcon: 'shield',
    });
  }

  /* ------------------------------ suppliers + returns ------------------------------ */
  async function suppliersTab(host) {
    const { data } = await window.Api.get('/pharmacy/suppliers');
    host.innerHTML = `<div class="card ph-card-pad" style="margin-bottom:var(--space-4)"><div class="ph-h"><h3>Supplier licences</h3></div><p class="text-sm text-secondary" style="margin-top:0">Medicines can only be bought from suppliers with a current licence on file.</p>
      <div class="table-wrap"><table class="table"><thead><tr><th>Supplier</th><th>Status</th><th>Licence</th><th>Expires</th><th></th></tr></thead><tbody>${(data.suppliers || []).map((s) => `<tr><td><strong>${esc(s.name)}</strong><div class="text-xs text-muted">${esc(s.phone || '')}</div></td><td>${P.badge(s.state === 'APPROVED' ? 'approved' : s.state === 'LICENCE_EXPIRED' ? 'expired' : 'unapproved', s.state === 'APPROVED' ? 'Approved' : s.state === 'LICENCE_EXPIRED' ? 'Licence expired' : 'Not approved')}</td><td>${esc(s.licenseNumber || '-')}</td><td>${P.date(s.licenseExpiry)}</td><td style="text-align:right;white-space:nowrap"><button class="btn btn-secondary btn-sm" data-ap="${s.supplierId}" data-n="${esc(s.name)}">${s.state === 'APPROVED' ? 'Update' : 'Approve'}</button>${s.state === 'APPROVED' ? ` <button class="btn btn-ghost btn-sm" data-rv="${s.supplierId}" data-n="${esc(s.name)}">Revoke</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="5" class="text-muted">No suppliers yet. Add them under Suppliers.</td></tr>'}</tbody></table></div></div>
      <div class="card ph-card-pad"><div class="ph-h"><h3>Returns to suppliers</h3><button class="btn btn-primary btn-sm" id="sr-new">${window.Icons.get('plus')} Return stock</button></div><div id="sr-list"></div></div>`;
    host.querySelectorAll('[data-ap]').forEach((b) => b.addEventListener('click', () => K.formModal({ title: `Licence · ${b.dataset.n}`, submitLabel: 'Save approval', intro: 'Record the licence you have seen for this supplier. Check it against the regulator’s register.', fields: [{ name: 'licenseNumber', label: 'Licence number', required: true }, { name: 'licenseExpiry', label: 'Licence expiry', type: 'date', required: true }, { name: 'note', label: 'Note' }], onSubmit: async (d) => { await window.Api.put(`/pharmacy/suppliers/${b.dataset.ap}/approval`, d); window.UI.toast.success('Supplier approved'); suppliersTab(host); } })));
    host.querySelectorAll('[data-rv]').forEach((b) => b.addEventListener('click', () => K.formModal({ title: `Revoke · ${b.dataset.n}`, submitLabel: 'Revoke approval', fields: [{ name: 'reason', label: 'Reason', required: true, type: 'textarea' }], onSubmit: async (d) => { await window.Api.post(`/pharmacy/suppliers/${b.dataset.rv}/approval/revoke`, d); window.UI.toast.success('Approval revoked'); suppliersTab(host); } })));
    const list = K.listPage({
      container: host.querySelector('#sr-list'), endpoint: '/pharmacy/supplier-returns', itemsKey: 'returns',
      filters: [{ key: 'status', label: 'Any status', options: [['RETURNED', 'Returned'], ['CREDITED', 'Credited']] }],
      columns: [
        { label: 'No.', render: (r) => `<strong>${esc(r.number)}</strong>` }, { label: 'Date', render: (r) => P.date(r.createdAt) },
        { label: 'Stock', render: (r) => `<div class="text-xs">${(r.lines || []).map((l) => `${esc(l.nameSnapshot)} · ${esc(l.batchNumber)} × ${esc(P.qty(l.quantity))} (${esc(P.label(l.reason))})`).join('<br>')}</div>` },
        { label: 'Value (cost)', align: 'right', render: (r) => esc(P.money(r.totalValue)) }, { label: 'Status', render: (r) => P.badge(r.status) },
      ],
      rowActions: (r) => (r.status === 'RETURNED' ? K.btn('credit', 'Record credit note') : (r.creditNote ? `<span class="text-xs text-muted">CN ${esc(r.creditNote.number)}</span>` : '')),
      onAction: (a, r) => K.formModal({ title: `Credit note · ${r.number}`, submitLabel: 'Record credit', intro: 'The credit is applied to what you owe this supplier.', fields: [{ name: 'creditNoteNumber', label: 'Credit note number', required: true }, { name: 'amount', label: 'Amount', type: 'number', step: '0.01', min: 0, required: true }], onSubmit: async (d) => { await window.Api.post(`/pharmacy/supplier-returns/${r._id}/credit`, { creditNoteNumber: d.creditNoteNumber, amount: Number(d.amount) }); window.UI.toast.success('Credit recorded'); list.reload(); } }),
      emptyText: 'No returns yet', emptyIcon: 'truck',
    });
    host.querySelector('#sr-new').addEventListener('click', () => returnForm({ onDone: () => list.reload() }));
  }

  async function returnForm({ recallId, onDone, preBatch }) {
    let sup = [];
    try { ({ data: { suppliers: sup } } = await window.Api.get('/pharmacy/suppliers')); } catch (e) { return fail(e); }
    const lines = (preBatch || []).map((b) => ({ batch: b, quantity: b.quantity, reason: 'RECALL' }));
    const m = window.UI.openModal({
      title: recallId ? 'Return recalled stock to supplier' : 'Return stock to supplier', maxWidth: '720px',
      bodyHtml: `<p class="text-sm text-secondary" style="margin-top:0">The stock leaves your shelves now. Record the supplier’s credit note afterwards.</p>
        <div class="field"><label>Supplier *</label><select class="select" id="sr-sup"><option value="">Choose…</option>${sup.map((s) => `<option value="${s.supplierId}">${esc(s.name)}</option>`).join('')}</select></div>
        <div id="sr-lines"></div><button class="btn btn-ghost btn-sm" id="sr-add" type="button">${window.Icons.get('plus')} Add batch</button>
        <div class="field" style="margin-top:var(--space-3)"><label>Notes</label><input class="input" id="sr-notes" /></div>`,
      footerHtml: '<button class="btn btn-secondary" data-act="cancel">Cancel</button><button class="btn btn-primary" data-act="go">Record return</button>',
    });
    const paint = () => {
      m.querySelector('#sr-lines').innerHTML = lines.length ? `<table class="table"><thead><tr><th>Batch</th><th>Qty</th><th>Reason</th><th></th></tr></thead><tbody>${lines.map((l, i) => `<tr><td><strong>${esc(l.batch.batchNumber)}</strong><div class="text-xs text-muted">${esc((l.batch.productId || {}).name || '')} · max ${esc(P.qty(l.batch.quantity))}</div></td><td><input class="input" data-q="${i}" type="number" min="0.001" step="any" max="${l.batch.quantity}" value="${l.quantity}" style="width:90px"/></td><td><select class="select" data-r="${i}">${['EXPIRED', 'DAMAGED', 'RECALL', 'WRONG_ITEM', 'OVERSUPPLY', 'OTHER'].map((r) => `<option value="${r}" ${l.reason === r ? 'selected' : ''}>${esc(P.label(r))}</option>`).join('')}</select></td><td><button class="btn btn-ghost btn-sm btn-icon" data-d="${i}">${window.Icons.get('trash')}</button></td></tr>`).join('')}</tbody></table>` : '<p class="text-muted text-sm">No batches yet.</p>';
      m.querySelectorAll('[data-q]').forEach((x) => x.addEventListener('input', () => { lines[Number(x.dataset.q)].quantity = x.value; }));
      m.querySelectorAll('[data-r]').forEach((x) => x.addEventListener('change', () => { lines[Number(x.dataset.r)].reason = x.value; }));
      m.querySelectorAll('[data-d]').forEach((x) => x.addEventListener('click', () => { lines.splice(Number(x.dataset.d), 1); paint(); }));
    };
    paint();
    m.querySelector('#sr-add').addEventListener('click', () => batchPicker({ title: 'Batches to return', onDone: (rows) => { rows.forEach((b) => { if (!lines.some((l) => l.batch._id === b._id)) lines.push({ batch: b, quantity: b.quantity, reason: recallId ? 'RECALL' : 'EXPIRED' }); }); paint(); } }));
    m.querySelector('[data-act="cancel"]').addEventListener('click', () => window.UI.closeModal());
    const go = m.querySelector('[data-act="go"]');
    go.addEventListener('click', async () => {
      const supplierId = m.querySelector('#sr-sup').value;
      if (!supplierId) return window.UI.toast.error('Choose the supplier');
      if (!lines.length) return window.UI.toast.error('Add at least one batch');
      window.UI.setButtonLoading(go, true, 'Saving…');
      try {
        await window.Api.post('/pharmacy/supplier-returns', { branchId: branch(), supplierId, recallId, notes: m.querySelector('#sr-notes').value.trim() || undefined, lines: lines.map((l) => ({ batchId: l.batch._id, quantity: Number(l.quantity), reason: l.reason })) });
        window.UI.closeModal(); window.UI.toast.success('Return recorded'); onDone && onDone();
      } catch (e) { fail(e); window.UI.setButtonLoading(go, false); }
    });
  }

  /* ------------------------------ reports ------------------------------ */
  function reportsTab(host) {
    const to = P.day(new Date()); const from = P.day(new Date(Date.now() - 29 * 86400000));
    host.innerHTML = `<div class="card ph-card-pad"><form id="rp-f" class="flex" style="gap:var(--space-3);flex-wrap:wrap;align-items:end">
      <div class="field" style="margin:0"><label class="text-xs">From</label><input class="input" type="date" name="from" value="${from}"/></div>
      <div class="field" style="margin:0"><label class="text-xs">To</label><input class="input" type="date" name="to" value="${to}"/></div>
      <div class="field" style="margin:0"><label class="text-xs">Dispensing by</label><select class="select" name="groupBy"><option value="day">Day</option><option value="dispenser">Dispenser</option><option value="medicine">Medicine</option></select></div>
      <button class="btn btn-primary">Run reports</button>
      <button type="button" class="btn btn-secondary" id="rp-csv">Dispensing register CSV</button></form></div>
      <div id="rp-out" style="margin-top:var(--space-4)"></div>
      <div id="rp-admin" style="margin-top:var(--space-4)"></div>`;
    const f = host.querySelector('#rp-f');
    const range = () => ({ from: f.elements.from.value ? `${f.elements.from.value}T00:00:00` : undefined, to: f.elements.to.value ? `${f.elements.to.value}T23:59:59` : undefined });
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const out = host.querySelector('#rp-out'); out.innerHTML = '<div class="ph-card-pad text-muted">Loading…</div>';
      try {
        const [d, x] = await Promise.all([window.Api.get('/pharmacy/reports/dispensing', { ...range(), groupBy: f.elements.groupBy.value, branchId: branch() }), window.Api.get('/pharmacy/reports/exceptions', range())]);
        const dd = d.data; const ex = x.data;
        out.innerHTML = `<div class="ph-grid"><div class="stat-card"><div class="stat-label">Dispensings</div><div class="stat-value">${esc(dd.totals.dispensings)}</div></div><div class="stat-card"><div class="stat-label">Units dispensed</div><div class="stat-value">${esc(P.qty(dd.totals.units))}</div></div>
          <div class="stat-card"><div class="stat-label">Reversals</div><div class="stat-value ph-num ${ex.reversals.length ? 'warn' : ''}">${ex.reversals.length}</div></div>
          <div class="stat-card"><div class="stat-label">Rejected / cancelled / expired Rx</div><div class="stat-value">${esc(['REJECTED', 'CANCELLED', 'EXPIRED'].reduce((t, k) => t + (ex.byStatus[k] || 0), 0))}</div></div></div>
          <div class="ph-two"><div class="card ph-card-pad"><div class="ph-h"><h3>Dispensing by ${esc(f.elements.groupBy.value)}</h3></div><div class="table-wrap"><table class="table"><thead><tr><th>${esc(P.label(f.elements.groupBy.value))}</th><th style="text-align:right">Dispensings</th><th style="text-align:right">Units</th></tr></thead><tbody>${dd.rows.map((r) => `<tr><td>${esc(r.label || r.key)}</td><td style="text-align:right">${esc(r.dispensings)}</td><td style="text-align:right">${esc(P.qty(r.units))}</td></tr>`).join('') || '<tr><td colspan="3" class="text-muted">No dispensings in this period</td></tr>'}</tbody></table></div></div>
          <div class="card ph-card-pad"><div class="ph-h"><h3>Exceptions &amp; interventions</h3></div>
            <p class="text-sm">${Object.entries(ex.interventions || {}).map(([k, v]) => `${esc(P.label(k))}: <strong>${esc(v)}</strong>`).join(' · ') || 'No pharmacist interventions recorded.'}</p>
            <div class="table-wrap"><table class="table"><thead><tr><th>Prescription</th><th>Status</th><th>Reason</th></tr></thead><tbody>${(ex.prescriptions || []).map((r) => `<tr><td>${esc(r.number)}</td><td>${P.badge(r.status)}</td><td class="text-xs">${esc(r.reason || (r.interventions ? `${r.interventions} intervention(s)` : ''))}</td></tr>`).join('') || '<tr><td colspan="3" class="text-muted">None</td></tr>'}</tbody></table></div>
            ${ex.reversals.length ? `<h4 style="margin:var(--space-3) 0 var(--space-2)">Reversed dispensings</h4>${ex.reversals.map((r) => `<div class="text-sm" style="padding:3px 0"><strong>${esc(r.number)}</strong> · ${esc(r.reason || '')} <span class="text-muted text-xs">${esc(P.dateTime(r.at))}</span></div>`).join('')}` : ''}</div></div>`;
      } catch (err) { out.innerHTML = `<div class="ph-danger-box">${esc(err.message)}</div>`; }
    });
    host.querySelector('#rp-csv').addEventListener('click', () => P.downloadCsv('/pharmacy/exports/dispensing', { ...range(), branchId: branch() }, 'dispensing-register.csv').catch(fail));
    f.requestSubmit();
    if (P.can('pharmacy.settings')) adminReports(host.querySelector('#rp-admin'), range);
  }

  async function adminReports(el, range) {
    el.innerHTML = '<div class="ph-two"><div class="card ph-card-pad" id="ac-card"><div class="ph-h"><h3>Who opened patient records</h3></div><div class="text-muted text-sm">Loading…</div></div><div class="card ph-card-pad" id="rt-card"><div class="ph-h"><h3>Record retention</h3></div><div class="text-muted text-sm">Loading…</div></div></div>';
    try {
      const { data } = await window.Api.get('/pharmacy/reports/access', range());
      el.querySelector('#ac-card').innerHTML = `<div class="ph-h"><h3>Who opened patient records</h3></div><div class="table-wrap"><table class="table"><thead><tr><th>Staff</th><th style="text-align:right">Opens</th><th style="text-align:right">Records</th><th style="text-align:right">Bulk lookups</th><th style="text-align:right">Edits</th></tr></thead><tbody>${(data.users || []).map((u) => `<tr><td>${esc(u.name)}</td><td style="text-align:right">${esc(u.views)}</td><td style="text-align:right">${esc(u.recordsViewed)}</td><td style="text-align:right" class="${u.bulkLookups ? 'ph-num warn' : ''}">${esc(u.bulkLookups)}</td><td style="text-align:right">${esc(u.edits)}</td></tr>`).join('') || '<tr><td colspan="5" class="text-muted">No activity</td></tr>'}</tbody></table></div>${(data.review || []).length ? '<p class="ph-note">Staff with bulk lookups should be reviewed.</p>' : ''}`;
    } catch (e) { el.querySelector('#ac-card').innerHTML = `<div class="ph-danger-box">${esc(e.message)}</div>`; }
    try {
      const { data } = await window.Api.get('/pharmacy/reports/retention');
      el.querySelector('#rt-card').innerHTML = `<div class="ph-h"><h3>Record retention</h3></div><p class="text-sm">Records are kept for <strong>${esc(data.retentionYears)} years</strong>. ${esc(data.heldCount)} patient(s) are still inside that period.</p><p class="text-sm">${data.eligibleForErasure.length ? `<strong>${esc(data.eligibleForErasure.length)}</strong> patient record(s) are past the period and can be erased on request:` : 'No patient records are past the retention period.'}</p>${data.eligibleForErasure.slice(0, 15).map((p) => `<div class="text-xs">${esc(p.number)} · keep until ${esc(P.date(p.keepUntil))}</div>`).join('')}`;
    } catch (e) { el.querySelector('#rt-card').innerHTML = `<div class="ph-danger-box">${esc(e.message)}</div>`; }
  }
})();
