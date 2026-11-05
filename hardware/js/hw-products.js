/* Hardware workspace — Products: list every product, add a new one (with extra selling units and opening stock),
   edit it, and jump to the hardware specification form. Replaces the old "Products & specs" screen, which only
   showed products that already had hardware details and had no way to create a product. */
(function () {
  const { Api } = window, HW = window.HW, E = HW.E, $ = HW.$, $$ = HW.$$;
  const br = () => HW.S.branch, M = HW.money;
  const UNITS = ['piece', 'bag', 'sack', 'roll', 'metre', 'm2', 'm3', 'kg', 'tonne', 'litre', 'tin', 'box', 'carton', 'packet', 'bundle', 'pack', 'pair', 'set', 'pallet', 'dozen', 'crate', 'g', 'ml', 'bottle', 'sachet', 'tray', 'tablet', 'strip', 'service'];
  const unitLabel = (u) => ({ m2: 'm² (square metre)', m3: 'm³ (cubic metre)', metre: 'metre', tonne: 'tonne (1000 kg)' }[u] || HW.human(u));
  const nav = HW.NAV.find((n) => n[0] === 'stock'); if (nav) nav[3] = [...new Set([...(nav[3] || []), 'products.create', 'products.view'])];
  const autoSku = (name) => `${String(name || 'ITM').replace(/[^a-z0-9]/gi, '').toUpperCase().slice(0, 3).padEnd(3, 'X')}-${Date.now().toString(36).toUpperCase().slice(-5)}`;
  const idOf = (x) => HW.id(x);

  /** Create (existing = null) or edit a product. onDone(product) runs after a successful save. */
  async function productModal(existing, onDone) {
    const isEdit = !!existing, x = existing || {};
    const cats = await HW.opt.categories().catch(() => []);
    const catSel = (cur) => `<div class="hw-inl"><select name="categoryId"><option value="">— none —</option>${cats.map(([id, n]) => `<option value="${E(id)}" ${String(id) === String(cur || '') ? 'selected' : ''}>${E(n)}</option>`).join('')}</select><button type="button" class="hw-btn s" data-newcat>+ New</button></div>`;
    const base = x.unit || 'piece';
    const fields = [
      { t: 'h', l: 'Product' },
      { n: 'name', l: 'Product name', w: 1, req: 1, v: x.name, ph: 'e.g. Cement 50kg (Bamburi)' },
      { n: 'sku', l: 'SKU / code', v: x.sku, ph: 'Made for you if left empty', hint: isEdit ? '' : 'A short code you use to find it' },
      { n: 'barcode', l: 'Barcode', v: x.barcode, ph: 'Scan or type (optional)' },
      { n: 'brand', l: 'Brand / manufacturer', v: x.brand },
      { n: 'categoryId', l: 'Category', t: 'html', html: catSel(idOf(x.categoryId)) },
      { t: 'h', l: 'Unit & prices' },
      { n: 'unit', l: 'Stock is counted in', t: 'select', blank: false, opts: UNITS.map((u) => [u, unitLabel(u)]), v: base, hint: isEdit ? 'Fixed once the product exists' : 'The smallest unit you sell, e.g. piece, kg, metre' },
      { n: 'costPrice', l: 'Cost price (per unit)', t: 'number', v: isEdit ? x.costPrice : 0 },
      { n: 'sellingPrice', l: 'Selling price (per unit)', t: 'number', req: 1, v: x.sellingPrice },
      { n: 'taxRate', l: 'Tax rate %', t: 'number', v: isEdit ? x.taxRate : 0 },
      { n: 'lowStockThreshold', l: 'Warn me when stock is below', t: 'number', step: 1, v: x.lowStockThreshold },
    ];
    if (!isEdit) fields.push(
      { t: 'h', l: 'Also sold by (optional)' },
      { n: 'xName', l: 'Other unit name', ph: 'e.g. Bag, Bundle, Pallet' },
      { n: 'xFactor', l: 'How many base units in one?', t: 'number', hint: 'e.g. 1 bundle = 12 pieces → 12' },
      { n: 'xPrice', l: 'Selling price for one of these', t: 'number' },
      { t: 'h', l: 'Opening stock (optional)' },
      { n: 'openQty', l: 'Quantity in stock now', t: 'number', hint: 'Added to this branch' },
      { n: 'openCost', l: 'Cost per unit', t: 'number', hint: 'Leave empty to use the cost price above' },
    );
    fields.push({ n: 'description', l: 'Description', t: 'textarea', w: 1, v: x.description });
    if (!isEdit) fields.push({ n: 'specs', l: 'Add hardware specifications after saving (size, weight, handling…)', t: 'check', w: 1 });
    return HW.formModal({
      title: isEdit ? 'Edit product' : 'New product', size: 'lg', label: isEdit ? 'Save changes' : 'Save product', fields,
      onMount: (m) => {
        const nc = $('[data-newcat]', m); if (!nc) return;
        nc.onclick = () => HW.formModal({ title: 'New category', label: 'Add category', fields: [{ n: 'name', l: 'Category name', req: 1, ph: 'e.g. Cement, Roofing, Paint' }], onSave: async (v) => {
          const { data } = await Api.post('/categories', { name: v.name }); const c = data.category || data; const sel = $('[name=categoryId]', m);
          const o = document.createElement('option'); o.value = idOf(c); o.textContent = c.name || v.name; sel.appendChild(o); sel.value = o.value;
        } });
      },
      onSave: async (v) => {
        const body = { name: v.name, trackInventory: true };
        ['barcode', 'brand', 'categoryId', 'description'].forEach((k) => { if (v[k]) body[k] = v[k]; });
        body.sku = v.sku || (isEdit ? x.sku : autoSku(v.name));
        body.costPrice = v.costPrice ?? 0; body.sellingPrice = v.sellingPrice;
        if (v.taxRate !== undefined) body.taxRate = v.taxRate;
        if (v.lowStockThreshold !== undefined) body.lowStockThreshold = Math.round(v.lowStockThreshold);
        if (isEdit) {
          if (x.hasVariants) delete body.sellingPrice;
          await Api.put(`/products/${x._id}`, body); HW.ok('Product updated'); if (onDone) onDone(); return;
        }
        body.unit = v.unit || 'piece';
        if (v.xName) {
          if (!(v.xFactor > 0)) throw new Error('Say how many base units are in one ' + v.xName);
          if (v.xName.trim().toLowerCase() === body.unit) throw new Error('The other unit must be different from the base unit');
          body.units = [{ name: v.xName.trim(), factor: v.xFactor, ...(v.xPrice >= 0 && v.xPrice !== undefined ? { retailPrice: v.xPrice } : {}) }];
        }
        const { data } = await Api.post('/products', body); const p = data.product || data; const pid = idOf(p);
        HW.ok('Product added');
        if (v.openQty > 0) {
          if (!br()) HW.err('Product saved, but no branch is selected for the opening stock');
          else { try { await Api.post('/inventory/receive', { branchId: br(), productId: pid, quantity: v.openQty, costPrice: v.openCost ?? v.costPrice ?? 0, reason: 'Opening stock' }); HW.ok('Opening stock added'); } catch (e) { HW.err('Product saved, but the opening stock failed: ' + (e.message || '')); } }
        }
        if (onDone) onDone(p);
        if (v.specs && HW.profileForm) setTimeout(() => HW.profileForm(pid, body.name), 150);
      },
    });
  }
  HW.productModal = productModal;

  HW.V.stock = async (el, arg) => {
    const canNew = HW.can('products.create'), canEdit = HW.can('products.update'), canSpec = HW.can('hardware.profile');
    const st = { q: '', cat: '', page: 1, limit: 40 }; let profs = {}, loaded = false, seq = 0;
    const cats = await HW.opt.categories().catch(() => []);
    el.innerHTML = `<div class="hw-bar"><input data-s type="search" placeholder="Search name, SKU, barcode, brand…" style="min-width:260px;flex:1;max-width:420px"><select data-c><option value="">All categories</option>${cats.map(([id, n]) => `<option value="${E(id)}">${E(n)}</option>`).join('')}</select><span class="sp"></span><button class="hw-btn d" data-lookup>Barcode lookup</button>${canNew ? '<button class="hw-btn d" data-xl>Import from Excel</button><button class="hw-btn p" data-new>+ New product</button>' : ''}</div><div data-b><p class="hw-muted">Loading products…</p></div>`;
    const b = $('[data-b]', el);
    const draw = async () => {
      const my = ++seq; b.classList.add('busy');
      let res; try { res = (await Api.get('/products', { page: st.page, limit: st.limit, search: st.q || undefined, categoryId: st.cat || undefined })).data; } catch (e) { b.classList.remove('busy'); b.innerHTML = HW.empty('Could not load products', e.message || 'Try again'); return; }
      if (!loaded) { loaded = true; try { (await Api.get('/hardware/products', { limit: 100 })).data.rows.forEach((r) => { profs[idOf(r.productId)] = r; }); } catch (e) { /* hardware details are optional */ } }
      if (my !== seq) return; b.classList.remove('busy');
      const rows = HW.list(res), total = res.total ?? rows.length, pages = res.pages || 1;
      const detail = (r) => { const p = profs[r._id]; if (!p) return '<span class="hw-muted">—</span>'; const h = (p.handling || []).slice(0, 2).map((t) => HW.badge('OR', t)).join(' '); return `${HW.badge('ok', 'Specs saved')} ${h}`; };
      b.innerHTML = HW.tbl([
        { h: 'Product', f: (r) => `<b>${E(r.name)}</b><small class="hw-sub">${E([r.sku, r.brand].filter(Boolean).join(' · '))}</small>` },
        { h: 'Category', f: (r) => E(HW.name(r.categoryId)) },
        { h: 'Unit', f: (r) => E(r.unit || '') + ((r.units || []).filter((u) => u.status !== 'inactive').length ? `<small class="hw-sub">+ ${(r.units || []).map((u) => E(u.name)).join(', ')}</small>` : '') },
        { h: 'Cost', c: 'n', f: (r) => M(r.costPrice) }, { h: 'Price', c: 'n pr', f: (r) => M(r.sellingPrice) },
        { h: 'Hardware details', f: detail },
        { h: '', c: 'n', f: (r) => `${canEdit ? `<button class="hw-btn s" data-edit="${r._id}">Edit</button> ` : ''}${canSpec ? `<button class="hw-btn s" data-spec="${r._id}">Specs</button>` : ''}` },
      ], rows, { click: canSpec, empty: st.q || st.cat ? 'No products match' : 'No products yet', hint: canNew ? 'Press “+ New product” to add your first material.' : '' })
        + `<div class="hw-pager"><span>${total ? `${(st.page - 1) * st.limit + 1}–${Math.min(total, st.page * st.limit)} of ${total}` : ''}</span><span class="sp"></span><button class="hw-btn s" data-pg="-1" ${st.page <= 1 ? 'disabled' : ''}>← Previous</button><button class="hw-btn s" data-pg="1" ${st.page >= pages ? 'disabled' : ''}>Next →</button></div>`;
      if (canSpec) HW.bindRows(b, rows, (r) => HW.profileForm(r._id, r.name));
      $$('[data-edit]', b).forEach((x) => x.onclick = () => productModal(rows.find((r) => r._id === x.dataset.edit), draw));
      $$('[data-spec]', b).forEach((x) => x.onclick = () => { const r = rows.find((y) => y._id === x.dataset.spec); HW.profileForm(r._id, r.name); });
      $$('[data-pg]', b).forEach((x) => x.onclick = () => { st.page += Number(x.dataset.pg); draw(); window.scrollTo({ top: 0 }); });
    };
    let t; $('[data-s]', el).oninput = (e) => { clearTimeout(t); t = setTimeout(() => { st.q = e.target.value.trim(); st.page = 1; draw(); }, 120); };
    $('[data-c]', el).onchange = (e) => { st.cat = e.target.value; st.page = 1; draw(); };
    const xl = $('[data-xl]', el); if (xl) xl.onclick = () => window.ProductImport.open({ onDone: () => { HW.loadProducts && (HW.productIndex.dirty = true); draw(); } });
    const nw = $('[data-new]', el); if (nw) nw.onclick = () => productModal(null, () => { HW.loadProducts && (HW.productIndex.dirty = true); draw(); });
    $('[data-lookup]', el).onclick = () => HW.formModal({ title: 'Barcode lookup', label: 'Find', fields: [{ n: 'code', l: 'Scan or type barcode', req: 1 }], onSave: async (v) => { const { data: r } = await Api.get(`/hardware/barcode/${encodeURIComponent(v.code)}`); HW.modal({ title: 'Match found', body: HW.dl([['Product', E(r.name)], ['Matched on', E(HW.human(r.matchedOn))], ['Unit', E(r.unitName)], ['Unit factor', r.unitFactor]]), actions: [{ label: 'Close' }, ...(canSpec ? [{ label: 'Open details', cls: 'p', fn: () => HW.profileForm(r.productId, r.name) }] : [])] }); } });
    await draw();
    if (arg === 'new' && nw) { history.replaceState(null, '', '#/stock'); nw.click(); }
  };
})();