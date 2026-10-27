/** Wines & spirits: compliance overview, licence/hours/age settings, product facts + tots, returnable empties, open bottles, reports. API: /api/v1/liquor/* */
(function () {
  const K = window.ModuleKit, A = () => window.Api, esc = K.esc, can = K.can, money = K.money;
  const feat = (f) => !f || window.AppShell.hasFeature?.(f);
  const TABS = [
    { id: 'overview', label: 'Overview', perm: 'liquor.reports' },
    { id: 'settings', label: 'Licence & rules', perm: 'liquor.settings', feature: 'liquorCompliance' },
    { id: 'products', label: 'Products', perm: 'liquor.products' },
    { id: 'empties', label: 'Empties', perm: 'liquor.empties', feature: 'emptiesTracking' },
    { id: 'tots', label: 'Open bottles', perm: 'liquor.tots', feature: 'totSales' },
    { id: 'reports', label: 'Reports', perm: 'liquor.reports' },
  ];
  const CATS = ['WINE', 'SPARKLING', 'WHISKY', 'VODKA', 'GIN', 'RUM', 'BRANDY', 'TEQUILA', 'LIQUEUR', 'BEER', 'CIDER', 'RTD', 'TRADITIONAL', 'OTHER_SPIRIT', 'SOFT_DRINK', 'MIXER', 'SNACK', 'OTHER'];
  const nice = (s) => String(s || '').replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
  const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  let body, root, containersCache = null;

  document.addEventListener('DOMContentLoaded', () => {
    const el = window.AppShell.mount({ title: 'Wines & spirits' });
    if (!el) return;
    const tabs = TABS.filter((t) => can(t.perm) && feat(t.feature));
    el.innerHTML = `<div class="page-header"><div><h1>Wines &amp; spirits</h1><p>Licence, trading hours, age checks, returnable bottles, tots and compliance reports.</p></div></div>
      <div class="tabs">${tabs.map((t) => `<button class="tab-btn" data-tab="${t.id}">${esc(t.label)}</button>`).join('')}</div><div id="lq-body" style="margin-top:var(--space-4)"></div>`;
    root = el; body = el.querySelector('#lq-body');
    if (!tabs.length) { body.innerHTML = window.UI.emptyStateHtml({ icon: 'lock', title: 'No access', message: 'Ask the owner for access.' }); return; }
    el.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => show(b.dataset.tab)));
    const h = (location.hash || '').slice(1);
    show(tabs.find((t) => t.id === h) ? h : tabs[0].id);
  });

  function show(id) {
    root.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('active', b.dataset.tab === id));
    try { history.replaceState(null, '', `#${id}`); } catch { /* ignore */ }
    body.innerHTML = '<div class="card" style="padding:var(--space-5)">Loading…</div>';
    ({ overview, settings, products, empties, tots, reports }[id])();
  }

  const err = (e) => window.UI.toast.error(e.message || 'Something went wrong');
  const card = (h) => `<div class="card" style="padding:var(--space-5);margin-bottom:var(--space-4)">${h}</div>`;
  const stat = (l, v) => `<div class="stat-card"><div class="stat-label">${esc(l)}</div><div class="stat-value">${v}</div></div>`;
  const grid = (h) => `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:var(--space-3);margin-bottom:var(--space-4)">${h}</div>`;
  const table = (heads, rows, empty = 'Nothing to show') => `<div class="table-wrap"><table class="table"><thead><tr>${heads.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.length ? rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${heads.length}" class="text-muted">${esc(empty)}</td></tr>`}</tbody></table></div>`;
  const ymd = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '');
  const today = () => new Date().toISOString().slice(0, 10);
  const daysAgo = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
  const branch = () => K.branchId() || undefined;
  const loadContainers = async () => (containersCache = (await A().get('/liquor/containers')).data.containers || []);

  // ---------------- overview
  async function overview() {
    try {
      const { data: o } = await A().get('/liquor/reports/overview', { branchId: branch() });
      const t = o.trading || {}, l = o.licence || {};
      body.innerHTML = card(`<div style="display:flex;gap:var(--space-3);align-items:center;flex-wrap:wrap"><h3 style="margin:0">${t.open ? '🟢 Alcohol sales open' : '🔴 Alcohol sales closed'}</h3><span class="text-sm text-secondary">${esc(t.message || '')}</span></div>`)
        + grid(stat('Licence', esc(l.number || 'Not set')) + stat('Licence expires', l.expiresAt ? `${K.date(l.expiresAt)}${l.daysLeft != null ? ` (${l.daysLeft} days)` : ''}` : '-') + stat('Minimum age', esc(o.minAge)) + stat('Age check mode', esc(nice(o.ageMode))) + stat('Empties mode', esc(nice(o.emptiesMode))))
        + ((o.warnings || []).length ? card(`<h4 style="margin:0 0 var(--space-2)">Needs attention</h4>${o.warnings.map((w) => `<div class="text-sm" style="padding:4px 0">⚠️ ${esc(w.message)}</div>`).join('')}`) : '')
        + card(`<h4 style="margin:0 0 var(--space-3)">Last 30 days</h4>${grid(stat('Age checks passed', o.last30Days.ageChecksPassed) + stat('Sales refused (age)', o.last30Days.ageChecksRefused) + stat('Manager overrides', o.last30Days.overrides))}`)
        + (o.upcomingClosedDates?.length ? card(`<h4 style="margin:0 0 var(--space-2)">Closed days coming up</h4>${o.upcomingClosedDates.map((d) => `<div class="text-sm">${esc(d.date)} ${d.reason ? `· ${esc(d.reason)}` : ''}</div>`).join('')}`) : '')
        + (o.containers?.length ? card(`<h4 style="margin:0 0 var(--space-3)">Returnable containers</h4>${table(['Container', 'With customers', 'Empties in shop', 'Owed to suppliers', 'Deposit held'], o.containers.map((c) => [esc(c.name), c.withCustomers, c.emptiesOnHand, c.owedToSuppliers, money(c.depositHeld)]))}`) : '')
        + (o.productsWithoutDetails ? card(`<div class="text-sm">${o.productsWithoutDetails} active products have no liquor details yet. <a href="#products" id="lq-go">Add them now</a></div>`) : '');
      body.querySelector('#lq-go')?.addEventListener('click', (e) => { e.preventDefault(); show('products'); });
    } catch (e) { body.innerHTML = card(esc(e.message)); }
  }

  // ---------------- settings
  async function settings() {
    try {
      const { data } = await A().get('/liquor/settings'); const s = data.settings, lic = s.licence || {}, th = s.tradingHours || {}, byDay = th.byDay || [];
      const day = (i) => byDay.find((d) => d.day === i) || { day: i, closed: false, open: '10:00', close: '22:00' };
      body.innerHTML = card(`<p class="text-sm text-secondary"><strong>Important:</strong> these are your rules. The defaults are only starting points, not legal advice. Confirm hours, minimum age, licence terms and dry days with your county liquor board or regulator.</p>
      <form id="ls"><h4>Licence</h4><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:var(--space-3)">
        <div class="field"><label>Licence number</label><input class="input" name="number" value="${esc(lic.number || '')}" /></div>
        <div class="field"><label>Licence type</label><input class="input" name="type" value="${esc(lic.type || '')}" /></div>
        <div class="field"><label>Issued by</label><input class="input" name="issuer" value="${esc(lic.issuer || '')}" /></div>
        <div class="field"><label>Premises</label><input class="input" name="premises" value="${esc(lic.premises || '')}" /></div>
        <div class="field"><label>Issued on</label><input class="input" type="date" name="issuedAt" value="${ymd(lic.issuedAt)}" /></div>
        <div class="field"><label>Expires on</label><input class="input" type="date" name="expiresAt" value="${ymd(lic.expiresAt)}" /></div>
        <div class="field"><label>Warn before expiry (days)</label><input class="input" type="number" min="0" max="365" name="licenceWarnDays" value="${esc(s.licenceWarnDays ?? 30)}" /></div></div>
      <label class="checkbox-row"><input type="checkbox" name="blockWhenLicenceExpired" ${s.blockWhenLicenceExpired !== false ? 'checked' : ''} /> <span class="text-sm">Block alcohol sales when the licence has expired</span></label>
      <h4 style="margin-top:var(--space-4)">Trading hours</h4>
      <label class="checkbox-row"><input type="checkbox" name="hoursEnabled" ${th.enabled ? 'checked' : ''} /> <span class="text-sm">Enforce trading hours at the till (a closing time after midnight is allowed)</span></label>
      <div style="margin:var(--space-2) 0">${DAYS.map((n, i) => { const d = day(i); return `<div style="display:flex;gap:var(--space-2);align-items:center;margin-bottom:6px;flex-wrap:wrap"><span style="width:100px">${n}</span><label class="text-sm"><input type="checkbox" name="closed${i}" ${d.closed ? 'checked' : ''} /> Closed</label><input class="input" type="time" name="open${i}" value="${esc(d.open || '10:00')}" style="max-width:130px" /> to <input class="input" type="time" name="close${i}" value="${esc(d.close || '22:00')}" style="max-width:130px" /></div>`; }).join('')}</div>
      <div class="field"><label>Closed dates (dry days: elections, notices). One per line: <code>2027-08-09 Election day</code></label><textarea class="input" name="closedDates" rows="4">${esc((s.closedDates || []).map((d) => `${d.date}${d.reason ? ` ${d.reason}` : ''}`).join('\n'))}</textarea></div>
      <h4>Age check</h4><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:var(--space-3)">
        <div class="field"><label>Minimum age</label><input class="input" type="number" min="16" max="25" name="minAge" value="${esc(s.age?.minAge ?? 18)}" /></div>
        <div class="field"><label>How the cashier checks</label><select class="select" name="ageMode"><option value="CONFIRM" ${s.age?.mode === 'CONFIRM' ? 'selected' : ''}>Cashier confirms the buyer is of age</option><option value="ID_REQUIRED" ${s.age?.mode === 'ID_REQUIRED' ? 'selected' : ''}>ID required (type + last digits, or date of birth)</option></select></div>
        <div class="field"><label>Max bottles per sale (0 = no limit)</label><input class="input" type="number" min="0" max="1000" name="maxBottlesPerSale" value="${esc(s.maxBottlesPerSale ?? 0)}" /></div>
        <div class="field"><label>Returnable empties</label><select class="select" name="emptiesMode">${[['OFF', 'Off'], ['TRACK', 'Track only'], ['ENFORCE', 'Enforce (deposit must match bottles sold minus returned)']].map(([k, v]) => `<option value="${k}" ${s.emptiesMode === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div></div>
      <div class="text-xs text-muted">No full ID number and no date of birth is ever stored.</div>
      <div style="margin-top:var(--space-4)"><button class="btn btn-primary" type="submit">Save settings</button></div></form>`);
      const f = body.querySelector('#ls');
      f.addEventListener('submit', async (e) => {
        e.preventDefault();
        const v = (n) => f.elements[n].value.trim();
        const licence = {}; ['number', 'type', 'issuer', 'premises'].forEach((k) => { if (v(k)) licence[k] = v(k); }); ['issuedAt', 'expiresAt'].forEach((k) => { if (v(k)) licence[k] = new Date(v(k)).toISOString(); });
        const closedDates = [];
        for (const line of v('closedDates').split('\n').map((x) => x.trim()).filter(Boolean)) { const m = line.match(/^(\d{4}-\d{2}-\d{2})\s*(.*)$/); if (!m) return window.UI.toast.error(`Closed date not understood: "${line}". Use YYYY-MM-DD then a reason.`); closedDates.push({ date: m[1], ...(m[2] ? { reason: m[2].slice(0, 100) } : {}) }); }
        const byDayOut = DAYS.map((_, i) => (f.elements[`closed${i}`].checked ? { day: i, closed: true } : { day: i, closed: false, open: v(`open${i}`), close: v(`close${i}`) }));
        const payload = { licence, blockWhenLicenceExpired: f.elements.blockWhenLicenceExpired.checked, licenceWarnDays: Number(v('licenceWarnDays')) || 0, tradingHours: { enabled: f.elements.hoursEnabled.checked, byDay: byDayOut }, closedDates, age: { minAge: Number(v('minAge')) || 18, mode: v('ageMode') }, maxBottlesPerSale: Number(v('maxBottlesPerSale')) || 0, emptiesMode: v('emptiesMode') };
        try { await A().put('/liquor/settings', payload); window.UI.toast.success('Settings saved'); } catch (er) { err(er); }
      });
    } catch (e) { body.innerHTML = card(esc(e.message)); }
  }

  // ---------------- products
  function products() {
    body.innerHTML = '<div id="lq-pl"></div>';
    const mode = { missing: false };
    const draw = () => K.listPage({
      container: body.querySelector('#lq-pl'), endpoint: '/liquor/products', search: true, searchPlaceholder: 'Search product', itemsKey: mode.missing ? 'products' : 'items',
      query: () => (mode.missing ? { missing: true } : {}),
      filters: mode.missing ? [] : [{ key: 'category', label: 'All categories', options: CATS.map((c) => [c, nice(c)]) }],
      toolbarHtml: `<button class="btn btn-secondary btn-sm" id="lq-toggle">${mode.missing ? 'Show products with details' : 'Show products still needing details'}</button>`,
      columns: mode.missing
        ? [{ label: 'Product', render: (p) => `<strong>${esc(p.name)}</strong>` }, { label: 'SKU', render: (p) => esc(p.sku || '') }, { label: 'Price', render: (p) => money(p.sellingPrice) }]
        : [{ label: 'Product', render: (d) => `<strong>${esc(d.productId?.name || '-')}</strong>` }, { label: 'Category', render: (d) => esc(nice(d.category)) }, { label: 'Alcohol', render: (d) => (d.isAlcohol ? `${esc(d.abv ?? '?')}%` : '<span class="badge badge-neutral">No</span>') }, { label: 'Size', render: (d) => (d.volumeMl ? `${d.volumeMl} ml` : '-') }, { label: 'Tot', render: (d) => (d.tot?.ml ? `${d.tot.ml} ml tot` : '') }],
      rowActions: (r) => K.btn('edit', mode.missing ? 'Add details' : 'Edit') + (!mode.missing && r.isAlcohol && !r.tot?.ml && feat('totSales') ? ` ${K.btn('tot', 'Make tot')}` : ''),
      onAction: (a, r, reload) => { const pid = mode.missing ? r._id : r.productId?._id; if (a === 'tot') return totProductForm(pid, r.productId?.name); return detailsForm(pid, mode.missing ? r.name : r.productId?.name, mode.missing ? null : r, reload); },
      emptyText: mode.missing ? 'Every product has liquor details' : 'No liquor details yet',
      onLoaded: () => body.querySelector('#lq-toggle')?.addEventListener('click', () => { mode.missing = !mode.missing; draw(); }),
    });
    draw();
  }

  async function detailsForm(productId, name, d, reload) {
    let conts = []; if (feat('emptiesTracking') && can('liquor.empties')) { try { conts = containersCache || await loadContainers(); } catch { /* optional */ } }
    d = d || {};
    const m = K.formModal({ title: `Liquor details: ${name || ''}`, maxWidth: '620px', submitLabel: 'Save', values: { category: d.category || 'WHISKY', abv: d.abv, volumeMl: d.volumeMl, vintage: d.vintage, country: d.country, region: d.region, producer: d.producer, exciseCentsPerUnit: d.exciseCentsPerUnit != null ? d.exciseCentsPerUnit / 100 : '', containerTypeId: d.containerTypeId || '', containersPerUnit: d.containersPerUnit ?? 1, isAlcohol: d.isAlcohol !== false },
      intro: 'Mixers, soft drinks and snacks: untick "Alcoholic" so no age check applies.',
      fields: [{ name: 'category', label: 'Category', type: 'select', options: CATS.map((c) => [c, nice(c)]) }, { name: 'isAlcohol', label: 'Alcoholic (age check applies)', type: 'checkbox' }, { name: 'abv', label: 'Alcohol % (ABV)', type: 'number', step: '0.1', min: 0 }, { name: 'volumeMl', label: 'Bottle size (ml)', type: 'number', min: 1 }, { name: 'vintage', label: 'Vintage (year)', type: 'number' }, { name: 'country', label: 'Country' }, { name: 'region', label: 'Region' }, { name: 'producer', label: 'Producer' }, { name: 'exciseCentsPerUnit', label: 'Excise inside the price, per unit (optional)', type: 'number', step: '0.01', min: 0 },
        ...(conts.length ? [{ name: 'containerTypeId', label: 'Returnable container', type: 'select', options: [['', 'None'], ...conts.map((c) => [c._id, c.name])] }, { name: 'containersPerUnit', label: 'Containers per unit sold', type: 'number', min: 0 }] : [])],
      onSubmit: async (v) => {
        const out = { ...v }; if (out.containerTypeId === undefined && conts.length) out.containerTypeId = null;
        ['abv', 'volumeMl', 'vintage', 'exciseCentsPerUnit', 'containersPerUnit'].forEach((k) => { if (out[k] !== undefined) out[k] = Number(out[k]); });
        await A().put(`/liquor/products/${productId}`, out); window.UI.toast.success('Saved'); reload && reload();
      } });
    return m;
  }

  function totProductForm(bottleId, name) {
    const m = K.formModal({ title: `Make a tot product from ${name || 'this bottle'}`, submitLabel: 'Create tot product', intro: 'Selling a tot takes millilitres from an open bottle. Opening a bottle takes 1 from stock automatically.',
      fields: [{ name: 'ml', label: 'Tot size (ml)', type: 'number', min: 1, required: true, value: 25 }, { name: 'price', label: 'Price per tot (leave empty to use the bottle price share)', type: 'number', step: '0.01', min: 0, hint: 'Use "Check" below to see the cost and suggested price.' }, { name: 'name', label: 'Name (optional)' }],
      onSubmit: async (v) => { const r = await A().post(`/liquor/products/${bottleId}/tot-product`, { ...v, ml: Number(v.ml) }); window.UI.toast.success(`Created: ${r.data.totsPerBottle} tots per bottle`); } });
    const check = document.createElement('button'); check.type = 'button'; check.className = 'btn btn-secondary btn-sm'; check.textContent = 'Check cost'; check.style.marginTop = '6px';
    const out = document.createElement('div'); out.className = 'text-sm'; out.style.marginTop = '6px';
    m.querySelector('#mk-form').appendChild(check); m.querySelector('#mk-form').appendChild(out);
    check.addEventListener('click', async () => { try { const ml = Number(m.querySelector('[name="ml"]').value); const { data } = await A().get(`/liquor/products/${bottleId}/tot-cost`, { ml }); out.textContent = `${data.totsPerBottle} tots per bottle · cost ${money(data.costPerTot)} · suggested price ${money(data.suggestedPrice)}`; } catch (e) { out.textContent = e.message; } });
  }

  // ---------------- empties
  async function empties() {
    try {
      const conts = await loadContainers(); const { data: mv } = await A().get('/liquor/empties/movements', { page: 1, limit: 25 });
      body.innerHTML = card(`<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:var(--space-3)"><div><h3 style="margin:0">Returnable bottles &amp; crates</h3><p class="text-sm text-secondary" style="margin:4px 0 0">Each sale sends containers out; empties come back with a sale or as a walk-in deposit refund.</p></div><button class="btn btn-primary" id="em-new">New container</button></div>
        ${table(['Container', 'Deposit', 'With customers', 'In shop', 'Owed to suppliers', 'Deposit held', ''], conts.map((c, i) => [`<strong>${esc(c.name)}</strong> <span class="badge badge-neutral">${esc(nice(c.kind))}</span>`, money(c.deposit), c.withCustomers, c.emptiesOnHand, c.owedToSuppliers, money(c.depositHeld), `<button class="btn btn-secondary btn-sm" data-a="refund" data-i="${i}">Refund deposit</button> <button class="btn btn-secondary btn-sm" data-a="recv" data-i="${i}">From supplier</button> <button class="btn btn-secondary btn-sm" data-a="ret" data-i="${i}">To supplier</button> <button class="btn btn-secondary btn-sm" data-a="adj" data-i="${i}">Adjust</button> <button class="btn btn-secondary btn-sm" data-a="edit" data-i="${i}">Edit</button>`]), 'No containers yet. Add the bottle or crate types you take back.')}`)
        + card(`<h4 style="margin:0 0 var(--space-2)">Recent movements</h4>${table(['When', 'Type', 'Container', 'Qty', 'Note'], (mv.movements || []).map((m) => [K.dateTime(m.createdAt), esc(nice(m.type)), esc((conts.find((c) => String(c._id) === String(m.containerTypeId)) || {}).name || ''), esc(m.quantity), esc(m.note || m.reason || '')]), 'No movements yet')}`);
      body.querySelector('#em-new').addEventListener('click', () => K.formModal({ title: 'New container', fields: [{ name: 'name', label: 'Name (e.g. Tusker 500ml bottle)', required: true }, { name: 'kind', label: 'Kind', type: 'select', options: ['BOTTLE', 'CRATE', 'KEG', 'OTHER'].map((x) => [x, nice(x)]) }, { name: 'deposit', label: 'Deposit per container', type: 'number', step: '0.01', min: 0, value: 0 }, { name: 'createDepositProduct', label: 'Create the deposit item for the till', type: 'checkbox', value: true }], onSubmit: async (v) => { await A().post('/liquor/containers', { ...v, deposit: Number(v.deposit) || 0 }); window.UI.toast.success('Container added'); empties(); } }));
      body.querySelectorAll('[data-a]').forEach((b) => b.addEventListener('click', () => emptyAction(b.dataset.a, conts[Number(b.dataset.i)])));
    } catch (e) { body.innerHTML = card(esc(e.message)); }
  }

  function emptyAction(a, c) {
    const done = (m) => { window.UI.toast.success(m); empties(); };
    const qty = { name: 'quantity', label: 'How many', type: 'number', min: 1, required: true };
    if (a === 'edit') return K.formModal({ title: `Edit ${c.name}`, values: { name: c.name, deposit: c.deposit, active: c.active !== false }, fields: [{ name: 'name', label: 'Name' }, { name: 'deposit', label: 'Deposit per container', type: 'number', step: '0.01', min: 0 }, { name: 'active', label: 'Active', type: 'checkbox' }], onSubmit: async (v) => { await A().put(`/liquor/containers/${c._id}`, { ...v, ...(v.deposit !== undefined ? { deposit: Number(v.deposit) } : {}) }); done('Saved'); } });
    if (a === 'refund') return K.formModal({ title: `Refund deposit: ${c.name}`, intro: `Walk-in customer returns empties without buying. Pays out ${money(c.deposit)} each.`, fields: [qty, { name: 'method', label: 'Paid by', type: 'select', options: [['CASH', 'Cash'], ['MPESA', 'M-PESA'], ['OTHER', 'Other']] }, { name: 'reference', label: 'Reference (optional)' }], onSubmit: async (v) => { const r = await A().post('/liquor/empties/refund', { containerTypeId: c._id, quantity: Number(v.quantity), method: v.method, reference: v.reference, branchId: K.branchId() }); done(`Refunded ${money(r.data.refunded)}`); } });
    if (a === 'recv' || a === 'ret') return K.formModal({ title: `${a === 'recv' ? 'Received from' : 'Returned to'} supplier: ${c.name}`, fields: [qty, { name: 'note', label: 'Note (optional)' }], onSubmit: async (v) => { await A().post(`/liquor/empties/supplier-${a === 'recv' ? 'receive' : 'return'}`, { containerTypeId: c._id, quantity: Number(v.quantity), note: v.note, branchId: K.branchId() }); done('Recorded'); } });
    return K.formModal({ title: `Adjust empties: ${c.name}`, intro: 'Correct the count of empties in the shop after a physical count. Use a negative number to remove.', fields: [{ name: 'delta', label: 'Change (+/-)', type: 'number', required: true }, { name: 'reason', label: 'Reason', required: true }], onSubmit: async (v) => { await A().post('/liquor/empties/adjust', { containerTypeId: c._id, delta: Number(v.delta), reason: v.reason, branchId: K.branchId() }); done('Adjusted'); } });
  }

  // ---------------- open bottles / tots
  async function tots() {
    try {
      const { data } = await A().get('/liquor/tots/pools', { branchId: branch() }); const pools = data.pools || [];
      body.innerHTML = card(`<h3 style="margin:0 0 var(--space-2)">Open bottles</h3><p class="text-sm text-secondary">Liquid already poured out of bottles that were taken from stock. Do a dip count regularly and record waste or free pours.</p>
        ${table(['Bottle', 'Open (ml)', 'Bottles opened', 'Tots left', 'Value left', ''], pools.map((p, i) => [`<strong>${esc(p.name)}</strong>`, esc(Math.round(p.openMl)), esc(p.bottlesOpened), esc(p.totsLeft ?? '-'), money(p.valueLeft), `<button class="btn btn-secondary btn-sm" data-a="count" data-i="${i}">Dip count</button> <button class="btn btn-secondary btn-sm" data-a="waste" data-i="${i}">Waste / comp</button>`]), 'No open bottles yet. They appear after the first tot is sold.')}`)
        + card(`<div style="display:flex;gap:var(--space-2);align-items:end;flex-wrap:wrap"><div class="field" style="margin:0"><label>From</label><input class="input" type="date" id="tv-from" value="${daysAgo(30)}" /></div><div class="field" style="margin:0"><label>To</label><input class="input" type="date" id="tv-to" value="${today()}" /></div><button class="btn btn-primary" id="tv-run">Show variance</button></div><div id="tv-out" style="margin-top:var(--space-3)"></div>`);
      body.querySelectorAll('[data-a]').forEach((b) => b.addEventListener('click', () => totAction(b.dataset.a, pools[Number(b.dataset.i)])));
      body.querySelector('#tv-run').addEventListener('click', async () => {
        try { const { data: d } = await A().get('/liquor/tots/variance', { from: body.querySelector('#tv-from').value, to: `${body.querySelector('#tv-to').value}T23:59:59`, branchId: branch() });
          body.querySelector('#tv-out').innerHTML = `<div class="text-sm" style="margin-bottom:8px">Total liquid missing: <strong>${Math.abs(Math.round(d.totalMissingMl))} ml</strong></div>${table(['Bottle', 'Count variance (ml)', 'Waste (ml)', 'Comps (ml)', 'Value lost'], d.items.map((x) => [esc(x.name), Math.round(x.countVarianceMl), Math.round(x.wasteMl), Math.round(x.compMl), money(Math.abs(x.countValue) + x.wasteValue + x.compValue)]), 'Nothing recorded')}<div class="text-xs text-muted">${esc(d.note)}</div>`; } catch (e) { err(e); }
      });
    } catch (e) { body.innerHTML = card(esc(e.message)); }
  }
  function totAction(a, p) {
    const base = { branchId: p.branchId || K.branchId(), bottleProductId: p.bottleProductId };
    if (a === 'count') return K.formModal({ title: `Dip count: ${p.name}`, intro: `The system expects about ${Math.round(p.openMl)} ml in the open bottle(s).`, fields: [{ name: 'measuredMl', label: 'Measured (ml)', type: 'number', min: 0, required: true }, { name: 'reason', label: 'Note (optional)' }], onSubmit: async (v) => { const r = await A().post('/liquor/tots/count', { ...base, measuredMl: Number(v.measuredMl), reason: v.reason }); window.UI.toast.success(`Variance ${Math.round(r.data.varianceMl)} ml (${money(r.data.costValue)})`); tots(); } });
    return K.formModal({ title: `Waste / free pour: ${p.name}`, fields: [{ name: 'type', label: 'Type', type: 'select', options: [['WASTE', 'Waste / spill'], ['COMP', 'Free pour (comp)']] }, { name: 'ml', label: 'Millilitres', type: 'number', min: 1, required: true }, { name: 'reason', label: 'Reason', required: true }], onSubmit: async (v) => { await A().post('/liquor/tots/waste', { ...base, type: v.type, ml: Number(v.ml), reason: v.reason }); window.UI.toast.success('Recorded'); tots(); } });
  }

  // ---------------- reports
  function reports() {
    body.innerHTML = card(`<div style="display:flex;gap:var(--space-2);flex-wrap:wrap;align-items:end">
      <div class="field" style="margin:0"><label>Report</label><select class="select" id="rp-k"><option value="sales">Litres & pure alcohol sold</option><option value="checks">Age checks</option><option value="over">Manager overrides</option></select></div>
      <div class="field" style="margin:0"><label>From</label><input class="input" type="date" id="rp-f" value="${daysAgo(30)}" /></div>
      <div class="field" style="margin:0"><label>To</label><input class="input" type="date" id="rp-t" value="${today()}" /></div>
      <div class="field" style="margin:0" id="rp-g"><label>Group by</label><select class="select" id="rp-gb"><option value="category">Category</option><option value="product">Product</option></select></div>
      <div class="field hidden" style="margin:0" id="rp-o"><label>Outcome</label><select class="select" id="rp-oc"><option value="">All</option><option value="PASSED">Passed</option><option value="REFUSED">Refused</option></select></div>
      <button class="btn btn-primary" id="rp-run">Show</button></div></div><div id="rp-out"></div>`.replace('</div></div><div id="rp-out"></div>', '</div>') + '<div id="rp-out"></div>');
    const $ = (s) => body.querySelector(s);
    const sync = () => { const k = $('#rp-k').value; $('#rp-g').classList.toggle('hidden', k !== 'sales'); $('#rp-o').classList.toggle('hidden', k !== 'checks'); };
    $('#rp-k').addEventListener('change', sync); sync();
    $('#rp-run').addEventListener('click', async () => {
      const k = $('#rp-k').value, q = { from: $('#rp-f').value, to: `${$('#rp-t').value}T23:59:59`, branchId: branch() }, out = $('#rp-out');
      out.innerHTML = card('Loading…');
      try {
        if (k === 'sales') { const { data: d } = await A().get('/liquor/reports/sales', { ...q, groupBy: $('#rp-gb').value }); const t = d.totals;
          out.innerHTML = card(`${grid(stat('Units sold', t.units) + stat('Litres', t.litres) + stat('Pure alcohol (L)', t.pureAlcoholLitres) + stat('Revenue', money(t.revenue)) + stat('Excise included', money(t.exciseIncluded)))}${table(['Name', 'Units', 'Litres', 'Pure alcohol (L)', 'Revenue', 'Profit'], d.items.map((x) => [esc(nice(x.name)), x.units, x.litres, x.pureAlcoholLitres, money(x.revenue), money(x.profit)]))}<div class="text-xs text-muted">${esc(d.note)}</div>`); }
        else if (k === 'checks') { const { data: d } = await A().get('/liquor/reports/age-checks', { ...q, outcome: $('#rp-oc').value || undefined });
          out.innerHTML = card(`${grid(stat('Passed', d.passed) + stat('Refused', d.refused))}${table(['When', 'Cashier', 'Outcome', 'Method', 'ID', 'Reason'], d.checks.map((c) => [K.dateTime(c.at), esc(c.cashierId?.name || ''), K.badge(c.outcome === 'PASSED' ? 'approved' : 'rejected').replace(/>.*?</, `>${esc(c.outcome.toLowerCase())}<`), esc(nice(c.method)), esc([c.idType && nice(c.idType), c.idLast4].filter(Boolean).join(' ')), esc(c.reason || '')]))}`); }
        else { const { data: d } = await A().get('/liquor/reports/overrides', { from: q.from, to: q.to });
          out.innerHTML = card(table(['When', 'Manager', 'What', 'Reason'], d.overrides.map((o) => [K.dateTime(o.at), esc(o.by || ''), esc(nice(o.code || o.message || '')), esc(o.reason || '')]), 'No overrides in this period')); }
      } catch (e) { out.innerHTML = card(esc(e.message)); }
    });
  }
})();