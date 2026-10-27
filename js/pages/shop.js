/** Shop tools: set-up checklist, product import/export, held sales, promotions, bulk prices, barcodes, shop reports. API: /api/v1/shop/* */
(function () {
  const K = window.ModuleKit, A = () => window.Api, esc = K.esc, can = K.can, money = K.money;
  const feat = (f) => !f || window.AppShell.hasFeature?.(f);
  const TABS = [
    { id: 'setup', label: 'Set-up', perm: 'shop.onboarding.manage' },
    { id: 'import', label: 'Import / export', perm: 'shop.import' },
    { id: 'held', label: 'Held sales', perm: 'shop.held.use', feature: 'heldSales' },
    { id: 'promos', label: 'Promotions', perm: 'shop.promotions.manage', feature: 'promotions' },
    { id: 'prices', label: 'Bulk prices', perm: 'shop.prices.manage' },
    { id: 'barcodes', label: 'Barcodes', perm: 'shop.barcodes.manage' },
    { id: 'reports', label: 'Reports', perm: 'shop.reports.view' },
  ];
  let root, body, categories = null;

  document.addEventListener('DOMContentLoaded', () => {
    const el = window.AppShell.mount({ title: 'Shop tools' });
    if (!el) return;
    const tabs = TABS.filter((t) => can(t.perm) && feat(t.feature));
    el.innerHTML = `<div class="page-header"><div><h1>Shop tools</h1><p>Set up, import products, run offers, change prices in bulk and read shop reports.</p></div></div>
      <div class="tabs" id="sh-tabs">${tabs.map((t) => `<button class="tab-btn" data-tab="${t.id}">${esc(t.label)}</button>`).join('')}</div><div id="sh-body" style="margin-top:var(--space-4)"></div>`;
    root = el; body = el.querySelector('#sh-body');
    if (!tabs.length) { body.innerHTML = window.UI.emptyStateHtml({ icon: 'lock', title: 'No access', message: 'Ask the owner for access to shop tools.' }); return; }
    el.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => show(b.dataset.tab)));
    show((location.hash || '').slice(1) && tabs.find((t) => t.id === location.hash.slice(1)) ? location.hash.slice(1) : tabs[0].id);
  });

  function show(id) {
    root.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('active', b.dataset.tab === id));
    try { history.replaceState(null, '', `#${id}`); } catch { /* ignore */ }
    body.innerHTML = '<div class="card" style="padding:var(--space-5)">Loading…</div>';
    ({ setup, import: importTab, held, promos, prices, barcodes, reports }[id])();
  }

  const err = (e) => window.UI.toast.error(e.message || 'Something went wrong');
  const card = (html) => `<div class="card" style="padding:var(--space-5);margin-bottom:var(--space-4)">${html}</div>`;
  const stat = (l, v) => `<div class="stat-card"><div class="stat-label">${esc(l)}</div><div class="stat-value">${v}</div></div>`;
  const grid = (h) => `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:var(--space-3);margin-bottom:var(--space-4)">${h}</div>`;
  const table = (heads, rows, empty = 'Nothing to show') => `<div class="table-wrap"><table class="table"><thead><tr>${heads.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.length ? rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${heads.length}" class="text-muted">${esc(empty)}</td></tr>`}</tbody></table></div>`;
  const loadCats = async () => categories || (categories = (await A().get('/categories')).data.categories || []);
  const catOptions = (cats) => cats.map((c) => [c._id, c.name]);
  const today = () => new Date().toISOString().slice(0, 10);
  const daysAgo = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
  const branch = () => K.branchId() || undefined;

  async function saveCsv(path, name, query) {
    const text = await A().getText(path, query);
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  // ---------------- set-up
  async function setup() {
    try {
      const { data: s } = await A().get('/shop/onboarding');
      body.innerHTML = card(`<h3 style="margin:0 0 var(--space-2)">${s.ready ? 'Your shop is ready to sell' : 'Get your shop ready'} · ${s.percent}%</h3>
        <div style="height:8px;background:var(--color-border);border-radius:99px;overflow:hidden;margin-bottom:var(--space-4)"><div style="height:100%;width:${s.percent}%;background:var(--color-primary)"></div></div>
        ${s.steps.map((x) => `<div style="display:flex;gap:var(--space-3);padding:var(--space-2) 0;border-bottom:1px solid var(--color-border)"><span>${x.done ? '✅' : '⬜'}</span><div style="flex:1"><strong>${esc(x.title)}</strong>${x.optional ? ' <span class="badge badge-neutral">optional</span>' : ''}<div class="text-sm text-muted">${esc(x.hint)}</div></div></div>`).join('')}
        <div style="margin-top:var(--space-4);display:flex;gap:var(--space-2);flex-wrap:wrap"><button class="btn btn-primary" id="sh-seed">Add starter categories</button><button class="btn btn-secondary" data-go="import">Import products</button></div>`);
      body.querySelector('#sh-seed').addEventListener('click', async () => {
        if (!(await window.UI.confirmDialog({ title: 'Add starter categories?', message: 'Common categories for your type of shop are created. Ones you already have are skipped.', confirmText: 'Add' }))) return;
        try { const { data } = await A().post('/shop/onboarding/starter-categories', {}); categories = null; window.UI.toast.success(`${data.created} added, ${data.skippedExisting} already existed`); setup(); } catch (e) { err(e); }
      });
      body.querySelector('[data-go="import"]').addEventListener('click', () => show('import'));
    } catch (e) { body.innerHTML = card(esc(e.message)); }
  }

  // ---------------- import / export
  function importTab() {
    let csv = '', lastOpts = {};
    body.innerHTML = card(`<h3 style="margin:0 0 var(--space-2)">Import products from a spreadsheet</h3>
      <p class="text-sm text-secondary">Save your Excel sheet as CSV. We always check first (nothing is saved) and show what would happen. Existing SKUs / barcodes are skipped, or updated in "Update existing" mode.</p>
      <div style="display:flex;gap:var(--space-2);flex-wrap:wrap;margin-bottom:var(--space-3)"><button class="btn btn-secondary" id="im-tpl">Download template</button><button class="btn btn-secondary" id="im-exp">Export current products</button></div>
      <div class="field"><label>CSV file</label><input type="file" id="im-file" accept=".csv,text/csv,text/plain" class="input" /></div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:var(--space-3)">
        <div class="field"><label>Mode</label><select class="select" id="im-mode"><option value="CREATE_ONLY">Add new only</option><option value="UPSERT">Add new + update existing</option></select></div>
        <div class="field"><label>Default VAT %</label><input class="input" id="im-tax" type="number" min="0" max="100" value="0" /></div>
        <div class="field"><label class="checkbox-row" style="margin-top:28px"><input type="checkbox" id="im-cats" checked /> <span class="text-sm">Create missing categories</span></label></div></div>
      <div class="text-xs text-muted" style="margin-bottom:var(--space-3)">Opening stock goes onto NEW products in the branch selected at the top.</div>
      <button class="btn btn-primary" id="im-check" disabled>Check file</button> <button class="btn btn-success hidden" id="im-go">Import now</button>`) + '<div id="im-out"></div>';
    const $ = (s) => body.querySelector(s);
    $('#im-tpl').addEventListener('click', () => saveCsv('/shop/import/template', 'products-template.csv').catch(err));
    $('#im-exp').addEventListener('click', () => saveCsv('/shop/export', 'products.csv', { branchId: branch() }).catch(err));
    $('#im-file').addEventListener('change', (e) => {
      const f = e.target.files[0]; if (!f) return;
      if (f.size > 4.5e6) { window.UI.toast.error('File too large (max about 2000 rows)'); return; }
      const r = new FileReader(); r.onload = () => { csv = String(r.result); $('#im-check').disabled = false; $('#im-go').classList.add('hidden'); }; r.readAsText(f);
    });
    async function run(dryRun) {
      const payload = { csv, dryRun, mode: $('#im-mode').value, createCategories: $('#im-cats').checked, defaultTaxRate: Number($('#im-tax').value) || 0, branchId: branch() };
      Object.keys(payload).forEach((k) => payload[k] === undefined && delete payload[k]);
      const btn = $(dryRun ? '#im-check' : '#im-go'); window.UI.setButtonLoading(btn, true, dryRun ? 'Checking…' : 'Importing…');
      try {
        const { data } = await A().post('/shop/import', payload); lastOpts = payload; const s = data.summary || {};
        $('#im-out').innerHTML = card(`<h3 style="margin:0 0 var(--space-3)">${dryRun ? 'Check result (nothing saved yet)' : 'Import finished'}</h3>
          ${grid(stat('New products', s.created || 0) + stat('Updated', s.updated || 0) + stat('Skipped', s.skipped || 0) + stat('Errors', s.failed || 0) + stat('Opening stock lines', s.stockLines || 0))}
          ${data.unknownColumns && data.unknownColumns.length ? `<div class="text-sm" style="margin-bottom:var(--space-2)">Columns ignored: ${data.unknownColumns.map(esc).join(', ')}</div>` : ''}
          ${table(['Row', 'Name', 'Status', 'Notes'], (data.results || []).slice(0, 300).map((r) => [esc(r.row || r.line || ''), esc(r.name || ''), K.badge(r.status), esc([...(r.errors || []), ...(r.warnings || [])].join('; '))]))}`);
        if (dryRun && ((s.created || 0) + (s.updated || 0)) > 0) $('#im-go').classList.remove('hidden');
        if (!dryRun) { $('#im-go').classList.add('hidden'); window.UI.toast.success('Import complete'); }
      } catch (e) { err(e); } finally { window.UI.setButtonLoading(btn, false); }
    }
    $('#im-check').addEventListener('click', () => run(true));
    $('#im-go').addEventListener('click', async () => { if (await window.UI.confirmDialog({ title: 'Import these products?', message: 'The checked rows will be saved.', confirmText: 'Import' })) run(false); });
  }

  // ---------------- held sales
  async function held() {
    try {
      const { data } = await A().get('/shop/held', { branchId: branch(), mine: can('shop.held.manage') ? undefined : true });
      const rows = data.held || [];
      body.innerHTML = card(`<h3 style="margin:0 0 var(--space-2)">Held sales</h3><p class="text-sm text-secondary">Carts parked at the till. Nothing is reserved; recalling a cart happens from the till and uses today's prices. Carts expire after 24 hours.</p>
        ${table(['Label', 'Items', 'Held by', 'Held', ''], rows.map((h, i) => [esc(h.label || 'Held sale'), esc((h.items || []).length), esc(h.cashierId?.name || '-'), K.dateTime(h.createdAt), `<button class="btn btn-secondary btn-sm" data-i="${i}">Discard</button>`]), 'No held sales right now')}`);
      body.querySelectorAll('[data-i]').forEach((b) => b.addEventListener('click', async () => {
        if (!(await window.UI.confirmDialog({ title: 'Discard this held sale?', danger: true, confirmText: 'Discard' }))) return;
        try { await A().delete(`/shop/held/${rows[Number(b.dataset.i)]._id}`); window.UI.toast.success('Discarded'); held(); } catch (e) { err(e); }
      }));
    } catch (e) { body.innerHTML = card(esc(e.message)); }
  }

  // ---------------- promotions
  const PTYPE = { PERCENT: '% off', AMOUNT_OFF: 'Amount off', FIXED_PRICE: 'Fixed price', MULTI_BUY: 'Multi-buy' };
  const pState = (p) => { const n = Date.now(); if (p.status === 'PAUSED') return 'paused'; if (new Date(p.endsAt) < n) return 'expired'; if (new Date(p.startsAt) > n) return 'scheduled'; return 'active'; };
  const pDesc = (p) => (p.type === 'PERCENT' ? `${p.value}% off` : p.type === 'AMOUNT_OFF' ? `${money(p.value)} off` : p.type === 'FIXED_PRICE' ? `Price ${money(p.value)}` : `Buy ${p.buyQty}, pay ${p.payQty}`);
  async function promos() {
    try {
      const { data } = await A().get('/shop/promotions', { state: 'all' });
      const rows = data.promotions || [];
      body.innerHTML = card(`<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:var(--space-3)"><div><h3 style="margin:0">Promotions</h3><p class="text-sm text-secondary" style="margin:4px 0 0">The best single offer applies per line (offers do not stack). The till suggests the discount; the cashier applies it as the line discount.</p></div><button class="btn btn-primary" id="pr-new">New offer</button></div>
        ${table(['Offer', 'Deal', 'Applies to', 'Runs', 'Status', ''], rows.map((p, i) => [`<strong>${esc(p.name)}</strong>`, esc(pDesc(p)), esc(p.scope === 'ALL' ? 'Everything' : p.scope === 'CATEGORIES' ? `${(p.categoryIds || []).length} categories` : `${(p.productIds || []).length} products`), `${K.date(p.startsAt)} → ${K.date(p.endsAt)}`, K.badge(pState(p)), `<button class="btn btn-secondary btn-sm" data-a="edit" data-i="${i}">Edit</button> <button class="btn btn-secondary btn-sm" data-a="${p.status === 'PAUSED' ? 'resume' : 'pause'}" data-i="${i}">${p.status === 'PAUSED' ? 'Resume' : 'Pause'}</button> <button class="btn btn-secondary btn-sm" data-a="del" data-i="${i}">Delete</button>`]), 'No offers yet')}`);
      body.querySelector('#pr-new').addEventListener('click', () => promoForm(null));
      body.querySelectorAll('[data-a]').forEach((b) => b.addEventListener('click', async () => {
        const p = rows[Number(b.dataset.i)], a = b.dataset.a;
        try {
          if (a === 'edit') return promoForm(p);
          if (a === 'del') { if (!(await window.UI.confirmDialog({ title: `Delete "${p.name}"?`, danger: true, confirmText: 'Delete' }))) return; await A().delete(`/shop/promotions/${p._id}`); } else await A().post(`/shop/promotions/${p._id}/${a}`, {});
          promos();
        } catch (e) { err(e); }
      }));
    } catch (e) { body.innerHTML = card(esc(e.message)); }
  }

  async function promoForm(p) {
    const cats = await loadCats().catch(() => []);
    const dt = (v, d) => (v ? new Date(v) : new Date(Date.now() + d * 864e5)).toISOString().slice(0, 16);
    const sel = { products: new Map() };
    (p?.productIds || []).forEach((id) => sel.products.set(String(id), String(id).slice(-6)));
    const m = window.UI.openModal({ title: p ? 'Edit offer' : 'New offer', maxWidth: '620px', bodyHtml: `<form id="pf">
      <div class="field"><label>Name *</label><input class="input" name="name" required maxlength="80" value="${esc(p?.name || '')}" /></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-3)">
        <div class="field"><label>Type</label><select class="select" name="type">${Object.entries(PTYPE).map(([k, v]) => `<option value="${k}" ${p?.type === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
        <div class="field" id="pf-val"><label>Value (% or amount)</label><input class="input" name="value" type="number" step="0.01" min="0" value="${esc(p?.value ?? '')}" /></div>
        <div class="field hidden" id="pf-buy"><label>Buy qty</label><input class="input" name="buyQty" type="number" min="2" value="${esc(p?.buyQty ?? 3)}" /></div>
        <div class="field hidden" id="pf-pay"><label>Pay for qty</label><input class="input" name="payQty" type="number" min="1" value="${esc(p?.payQty ?? 2)}" /></div>
        <div class="field"><label>Starts</label><input class="input" name="startsAt" type="datetime-local" value="${dt(p?.startsAt, 0)}" required /></div>
        <div class="field"><label>Ends</label><input class="input" name="endsAt" type="datetime-local" value="${dt(p?.endsAt, 7)}" required /></div>
        <div class="field"><label>Minimum quantity</label><input class="input" name="minQty" type="number" min="0" value="${esc(p?.minQty ?? 0)}" /></div>
        <div class="field"><label>Applies to</label><select class="select" name="scope">${[['PRODUCTS', 'Chosen products'], ['CATEGORIES', 'Categories'], ['ALL', 'Everything']].map(([k, v]) => `<option value="${k}" ${(p?.scope || 'PRODUCTS') === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div></div>
      <div class="field hidden" id="pf-cats"><label>Categories</label><select class="select" name="categoryIds" multiple size="5">${cats.map((c) => `<option value="${c._id}" ${(p?.categoryIds || []).map(String).includes(String(c._id)) ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
      <div class="field" id="pf-prods"><label>Products</label><input class="input" id="pf-q" placeholder="Search a product to add" /><div id="pf-res" class="text-sm"></div><div id="pf-chosen" class="text-sm" style="margin-top:6px"></div></div>
      <div class="field"><label>Days of week (none = every day)</label><div class="text-sm">${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d, i) => `<label style="margin-right:10px"><input type="checkbox" name="dow" value="${i}" ${(p?.daysOfWeek || []).includes(i) ? 'checked' : ''}/> ${d}</label>`).join('')}</div></div></form>`,
      footerHtml: '<button class="btn btn-secondary" data-x="c">Cancel</button><button class="btn btn-primary" data-x="s">Save offer</button>' });
    const f = m.querySelector('#pf'), $ = (s) => m.querySelector(s);
    const sync = () => { const t = f.type.value, s = f.scope.value; $('#pf-val').classList.toggle('hidden', t === 'MULTI_BUY'); $('#pf-buy').classList.toggle('hidden', t !== 'MULTI_BUY'); $('#pf-pay').classList.toggle('hidden', t !== 'MULTI_BUY'); $('#pf-cats').classList.toggle('hidden', s !== 'CATEGORIES'); $('#pf-prods').classList.toggle('hidden', s !== 'PRODUCTS'); };
    const chosen = () => { $('#pf-chosen').innerHTML = [...sel.products].map(([id, n]) => `<span class="badge badge-neutral" style="margin:2px">${esc(n)} <a href="#" data-rm="${id}">✕</a></span>`).join(' ') || '<span class="text-muted">None chosen</span>'; $('#pf-chosen').querySelectorAll('[data-rm]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); sel.products.delete(a.dataset.rm); chosen(); })); };
    f.type.addEventListener('change', sync); f.scope.addEventListener('change', sync); sync(); chosen();
    $('#pf-q').addEventListener('input', window.UI.debounce(async (e) => {
      const t = e.target.value.trim(); if (t.length < 2) { $('#pf-res').innerHTML = ''; return; }
      try { const { data } = await A().get('/products', { search: t, limit: 8, status: 'active' }); $('#pf-res').innerHTML = (data.items || []).map((x) => `<div><a href="#" data-add="${x._id}" data-n="${esc(x.name)}">+ ${esc(x.name)}</a></div>`).join('') || '<span class="text-muted">No match</span>'; $('#pf-res').querySelectorAll('[data-add]').forEach((a) => a.addEventListener('click', (ev) => { ev.preventDefault(); sel.products.set(a.dataset.add, a.dataset.n); chosen(); })); } catch { /* ignore */ }
    }));
    $('[data-x="c"]').addEventListener('click', () => window.UI.closeModal());
    const save = $('[data-x="s"]');
    save.addEventListener('click', async () => {
      if (!f.reportValidity()) return;
      const t = f.type.value, s = f.scope.value;
      const d = { name: f.name.value.trim(), type: t, scope: s, startsAt: new Date(f.startsAt.value).toISOString(), endsAt: new Date(f.endsAt.value).toISOString(), minQty: Number(f.minQty.value) || 0,
        daysOfWeek: [...f.querySelectorAll('[name="dow"]:checked')].map((x) => Number(x.value)),
        categoryIds: s === 'CATEGORIES' ? [...f.categoryIds.selectedOptions].map((o) => o.value) : [], productIds: s === 'PRODUCTS' ? [...sel.products.keys()] : [] };
      if (t === 'MULTI_BUY') { d.buyQty = Number(f.buyQty.value); d.payQty = Number(f.payQty.value); } else d.value = Number(f.value.value);
      if (s === 'PRODUCTS' && !d.productIds.length) return window.UI.toast.error('Choose at least one product');
      if (s === 'CATEGORIES' && !d.categoryIds.length) return window.UI.toast.error('Choose at least one category');
      window.UI.setButtonLoading(save, true, 'Saving…');
      try { p ? await A().put(`/shop/promotions/${p._id}`, d) : await A().post('/shop/promotions', d); window.UI.closeModal(); window.UI.toast.success('Offer saved'); promos(); }
      catch (e) { err(e); window.UI.setButtonLoading(save, false); }
    });
  }

  // ---------------- bulk prices
  async function prices() {
    const cats = await loadCats().catch(() => []);
    body.innerHTML = card(`<h3 style="margin:0 0 var(--space-2)">Change prices in bulk</h3><p class="text-sm text-secondary">Always preview first. Products with variants are skipped. Revert only restores products not edited since.</p>
      <form id="bp"><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:var(--space-3)">
      <div class="field"><label>Which products</label><select class="select" name="sel"><option value="all">All products</option><option value="cat">One category</option><option value="brand">One brand</option></select></div>
      <div class="field hidden" data-s="cat"><label>Category</label><select class="select" name="cat">${cats.map((c) => `<option value="${c._id}">${esc(c.name)}</option>`).join('')}</select></div>
      <div class="field hidden" data-s="brand"><label>Brand</label><input class="input" name="brand" /></div>
      <div class="field"><label>Change</label><select class="select" name="field"><option value="sellingPrice">Selling price</option><option value="costPrice">Cost price</option></select></div>
      <div class="field"><label>How</label><select class="select" name="mode"><option value="PERCENT">Percent (+/-)</option><option value="AMOUNT">Add / subtract amount</option><option value="MARGIN">Set margin % over cost</option><option value="SET">Set exact price</option></select></div>
      <div class="field"><label>Value</label><input class="input" name="value" type="number" step="0.01" required /></div>
      <div class="field"><label>Round to</label><select class="select" name="rounding">${[['NONE', 'No rounding'], ['NEAREST_1', 'Nearest 1'], ['NEAREST_5', 'Nearest 5'], ['NEAREST_10', 'Nearest 10'], ['NEAREST_50', 'Nearest 50']].map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div></div>
      <label class="checkbox-row"><input type="checkbox" name="end99" /> <span class="text-sm">Make prices end in .99</span></label><br/>
      <label class="checkbox-row"><input type="checkbox" name="below" /> <span class="text-sm">Allow selling below cost</span></label>
      <div style="margin-top:var(--space-3)"><button type="submit" class="btn btn-primary">Preview</button> <button type="button" class="btn btn-success hidden" id="bp-apply">Apply changes</button></div></form></div>
      <div id="bp-out"></div><div id="bp-hist"></div>`);
    const f = body.querySelector('#bp'), $ = (s) => body.querySelector(s);
    const syncSel = () => { body.querySelectorAll('[data-s]').forEach((e) => e.classList.toggle('hidden', e.dataset.s !== f.sel.value)); };
    f.sel.addEventListener('change', syncSel);
    const payload = () => {
      const filter = f.sel.value === 'cat' ? { categoryIds: [f.cat.value] } : f.sel.value === 'brand' ? { brand: f.brand.value.trim() } : { all: true };
      return { filter, rule: { field: f.field.value, mode: f.mode.value, value: Number(f.value.value), rounding: f.rounding.value, endIn99: f.end99.checked }, allowBelowCost: f.below.checked };
    };
    f.addEventListener('submit', async (e) => {
      e.preventDefault(); $('#bp-apply').classList.add('hidden');
      try {
        const { data } = await A().post('/shop/prices/preview', payload());
        $('#bp-out').innerHTML = card(`${grid(stat('Matched', data.matched) + stat('Will change', data.willChange) + stat('Skipped', data.skipped) + stat('Below cost', data.belowCost))}
          ${table(['Product', 'From', 'To'], (data.sample || []).map((c) => [esc(c.name), money(c.from), money(c.to)]), 'No products would change')}${data.belowCost > 0 ? '<div class="text-sm" style="color:var(--color-danger);margin-top:8px">Some prices fall below cost. Tick "Allow selling below cost" to apply anyway.</div>' : ''}`);
        if (data.willChange > 0) $('#bp-apply').classList.remove('hidden');
      } catch (er) { err(er); }
    });
    $('#bp-apply').addEventListener('click', async () => {
      if (!(await window.UI.confirmDialog({ title: 'Apply these price changes?', message: 'You can revert this batch later from the history below.', confirmText: 'Apply' }))) return;
      try { const { data } = await A().post('/shop/prices/apply', payload()); window.UI.toast.success(`${data.changed} prices updated`); $('#bp-apply').classList.add('hidden'); $('#bp-out').innerHTML = ''; history_(); } catch (er) { err(er); }
    });
    async function history_() {
      try {
        const { data } = await A().get('/shop/prices/history', { page: 1, limit: 10 });
        const rows = data.rows || [];
        $('#bp-hist').innerHTML = card(`<h4 style="margin:0 0 var(--space-2)">Recent price changes</h4>${table(['When', 'What', 'Source', ''], rows.map((r, i) => [K.dateTime(r.createdAt), esc(r.summary || r.field), esc(r.source || ''), r.status === 'REVERTED' ? K.badge('reverted') : `<button class="btn btn-secondary btn-sm" data-r="${i}">Revert</button>`]), 'No price changes yet')}`);
        $('#bp-hist').querySelectorAll('[data-r]').forEach((b) => b.addEventListener('click', async () => {
          if (!(await window.UI.confirmDialog({ title: 'Revert this change?', message: 'Products edited since will be left alone.', confirmText: 'Revert' }))) return;
          try { const { data: d } = await A().post(`/shop/prices/history/${rows[Number(b.dataset.r)]._id}/revert`, {}); window.UI.toast.success(`${d.reverted} restored, ${d.keptBecauseEditedSince} kept (edited since)`); history_(); } catch (er) { err(er); }
        }));
      } catch { /* history is optional */ }
    }
    syncSel(); history_();
  }

  // ---------------- barcodes
  async function barcodes() {
    body.innerHTML = card(`<h3 style="margin:0 0 var(--space-2)">Barcodes</h3><p class="text-sm text-secondary">Give every product without a barcode its own internal EAN-13 code (starts with 2), then print shelf labels.</p>
      <div style="display:flex;gap:var(--space-2);flex-wrap:wrap"><button class="btn btn-primary" id="bc-gen">Generate barcodes for products without one</button><a class="btn btn-secondary" href="shelf-labels.html">Print shelf labels</a></div><div id="bc-out" style="margin-top:var(--space-3)"></div>`);
    body.querySelector('#bc-gen').addEventListener('click', async (e) => {
      if (!(await window.UI.confirmDialog({ title: 'Generate barcodes?', message: 'Up to 500 products without a barcode will get one. Existing barcodes are never changed.', confirmText: 'Generate' }))) return;
      window.UI.setButtonLoading(e.target, true, 'Working…');
      try { const { data } = await A().post('/shop/barcodes/generate', { limit: 500 }); body.querySelector('#bc-out').innerHTML = `<div class="text-sm">${data.generated} barcodes created. ${data.remainingWithout ? `${data.remainingWithout} products still have none, run again.` : 'All products now have a barcode.'}</div>`; }
      catch (er) { err(er); } finally { window.UI.setButtonLoading(e.target, false); }
    });
  }

  // ---------------- reports
  const REPORTS = [['eod', 'End of day'], ['margins', 'Margins'], ['dead', 'Dead stock'], ['value', 'Stock valuation'], ['reorder', 'Reorder list'], ['aging', 'Credit aging']];
  function reports() {
    body.innerHTML = card(`<div style="display:flex;gap:var(--space-2);flex-wrap:wrap;align-items:end">
      <div class="field" style="margin:0"><label>Report</label><select class="select" id="rp-kind">${REPORTS.map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
      <div class="field" style="margin:0" data-for="eod"><label>Date</label><input class="input" type="date" id="rp-date" value="${today()}" /></div>
      <div class="field hidden" style="margin:0" data-for="margins"><label>From</label><input class="input" type="date" id="rp-from" value="${daysAgo(30)}" /></div>
      <div class="field hidden" style="margin:0" data-for="margins"><label>To</label><input class="input" type="date" id="rp-to" value="${today()}" /></div>
      <div class="field hidden" style="margin:0" data-for="margins"><label>Group by</label><select class="select" id="rp-group"><option value="product">Product</option><option value="category">Category</option></select></div>
      <div class="field hidden" style="margin:0" data-for="dead"><label>No sales for (days)</label><input class="input" type="number" id="rp-days" value="60" min="7" max="730" /></div>
      <button class="btn btn-primary" id="rp-run">Show</button></div></div><div id="rp-out"></div>`);
    const $ = (s) => body.querySelector(s);
    const sync = () => body.querySelectorAll('[data-for]').forEach((e) => e.classList.toggle('hidden', e.dataset.for !== $('#rp-kind').value));
    $('#rp-kind').addEventListener('change', sync);
    $('#rp-run').addEventListener('click', async () => {
      const k = $('#rp-kind').value, out = $('#rp-out'); out.innerHTML = card('Loading…');
      try { out.innerHTML = await RUN[k]($); } catch (e) { out.innerHTML = card(esc(e.message)); }
    });
    sync();
  }
  const RUN = {
    async eod($) {
      const { data: d } = await A().get('/shop/reports/end-of-day', { date: $('#rp-date').value, branchId: branch() }); const s = d.sales;
      return card(`${grid(stat('Sales', s.count) + stat('Total', money(s.total)) + stat('Collected', money(s.collected)) + stat('On credit', money(s.soldOnCredit)) + stat('Discounts', money(s.discounts)) + stat('VAT', money(s.tax)) + stat('Refunds', money(d.refunds.total)) + stat('Expenses', money(d.expenses.total)))}
        <h4>By payment method</h4>${table(['Method', 'Received', 'Paid out', 'Net', 'Count'], (d.paymentsByMethod || []).map((m) => [esc(m.method), money(m.received), money(m.paidOut), money(m.net), m.count]))}
        <div class="text-xs text-muted" style="margin:6px 0 14px">Expected net cash (estimate): ${money(d.cash.expectedNetCash)}. The shift close is the authoritative count.</div>
        <h4>Top products</h4>${table(['Product', 'Qty', 'Revenue'], (d.topProducts || []).map((p) => [esc(p.name), p.quantity, money(p.revenue)]))}
        <h4>By cashier</h4>${table(['Cashier', 'Sales', 'Total'], (d.byCashier || []).map((c) => [esc(c.name), c.count, money(c.total)]))}`);
    },
    async margins($) {
      const { data: d } = await A().get('/shop/reports/margins', { from: $('#rp-from').value, to: `${$('#rp-to').value}T23:59:59`, groupBy: $('#rp-group').value, branchId: branch() }); const t = d.totals;
      const rows = d.best || [];
      return card(`${grid(stat('Revenue', money(t.revenue)) + stat('Cost', money(t.cost)) + stat('Profit', money(t.profit)) + stat('Margin', t.marginPercent == null ? '-' : `${t.marginPercent}%`))}
        <h4>Most profitable</h4>${table(['Name', 'Qty', 'Revenue', 'Cost', 'Profit', 'Margin'], rows.map((r) => [esc(r.name), esc(r.quantity ?? ''), money(r.revenue), money(r.cost), money(r.profit), r.marginPercent == null ? '-' : `${r.marginPercent}%`]))}`);
    },
    async dead($) {
      const { data: d } = await A().get('/shop/reports/dead-stock', { days: $('#rp-days').value, branchId: branch() });
      return card(`${grid(stat('Products idle', d.count) + stat('Cost tied up', money(d.tiedUpCost)))}${table(['Product', 'SKU', 'On hand', 'Cost value', 'Retail value'], (d.items || []).map((x) => [esc(x.name), esc(x.sku || ''), x.onHand, money(x.costValue), money(x.retailValue)]))}`);
    },
    async value() {
      const { data: d } = await A().get('/shop/reports/stock-valuation', { branchId: branch() }); const t = d.totals;
      return card(`${grid(stat('Units', t.units) + stat('At cost', money(t.cost)) + stat('At retail', money(t.retail)) + stat('Potential profit', money(t.potentialProfit)))}${table(['Category', 'Units', 'Cost', 'Retail', 'Potential profit'], (d.byCategory || []).map((r) => [esc(r.name || 'Uncategorised'), esc(r.units ?? ''), money(r.cost), money(r.retail), money(r.potentialProfit)]))}`);
    },
    async reorder() {
      const { data: d } = await A().get('/shop/reports/reorder', { branchId: branch() });
      return card(`${grid(stat('Products to reorder', d.count) + stat('Estimated cost', money(d.estimatedTotal)))}<div class="text-xs text-muted" style="margin-bottom:8px">Based on the last ${d.lookbackDays} days of sales, covering ${d.coverDays} days.</div>${table(['Product', 'On hand', 'Selling / day', 'Days left', 'Suggested qty', 'Est. cost'], (d.items || []).map((r) => [esc(r.name), esc(r.onHand ?? ''), esc(r.soldPerDay ?? ''), esc(r.daysLeft ?? '-'), esc(r.suggestedQty ?? ''), money(r.estimatedCost)]))}`);
    },
    async aging() {
      const { data: d } = await A().get('/shop/reports/credit-aging');
      const keys = Object.keys(d.totals || {});
      return card(`${grid(stat('Customers owing', d.count) + stat('Total owed', money(d.total)))}${table(['Customer', 'Phone', 'Balance', ...keys], (d.customers || []).map((c) => [esc(c.name), esc(c.phone || ''), money(c.balance), ...keys.map((k) => money(c[k]))]))}`);
    },
  };
})();