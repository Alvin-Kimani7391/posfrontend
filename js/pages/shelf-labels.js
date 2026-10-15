/**
 * shelf-labels.js - print the full shelf price list (name, price, barcode) and cut-apart shelf labels.
 * Reads GET /products (all active products + variants). Barcode = product barcode, or the SKU when
 * a product has none (flagged in the table so the owner can add real barcodes).
 *
 * DISCOUNTS: a product's standing per-unit discount (defaultDiscount, set on the Products page) is
 * shown here as Was / Now / Save. The owner can print ALL products (discounted ones are marked
 * with the struck-through old price) or ONLY the discounted products.
 */
(function () {
  document.addEventListener('DOMContentLoaded', init);

  const SIZES = {
    small:  { label: 'Small (50 × 30 mm)',  w: 50, h: 30 },
    medium: { label: 'Medium (63 × 38 mm)', w: 63, h: 38 },
    large:  { label: 'Large (90 × 50 mm)',  w: 90, h: 50 },
  };
  const esc = (v) => window.UI.escapeHtml(v == null ? '' : v);

  let contentEl;
  const state = { rows: [], selected: new Set(), search: '', categoryId: '', size: 'medium', copies: 1, showSku: true, mode: 'all', categories: [], businessName: '' };

  async function init() {
    contentEl = window.AppShell.mount({ title: 'Shelf labels' });
    if (!contentEl) return;
    contentEl.innerHTML = '<div class="card"><div class="card-body text-muted">Loading products…</div></div>';
    try {
      const [rows, cats] = await Promise.all([loadAllProducts(), loadCategories()]);
      state.rows = rows; state.categories = cats;
      state.selected = new Set(rows.map((r) => r.id));
      const prof = await window.AppShell.whenProfileReady();
      state.businessName = prof?.name || window.AppShell.getUser()?.businessName || '';
    } catch (err) {
      contentEl.innerHTML = `<div class="card"><div class="card-body">${esc(err.message || 'Could not load products')}</div></div>`;
      return;
    }
    render();
  }

  async function loadCategories() {
    try { const { data } = await window.Api.get('/categories'); return data.categories || []; }
    catch { return []; }
  }

  async function loadAllProducts() {
    const out = []; let page = 1, pages = 1;
    do {
      const { data } = await window.Api.get('/products', { page, limit: 100, status: 'active' });
      (data.items || []).forEach((p) => {
        const variants = p.variants || [];
        if (p.hasVariants && variants.length) {
          variants.forEach((v) => {
            const attrs = v.attributes && typeof v.attributes === 'object' ? Object.values(v.attributes).join(' / ') : '';
            out.push(row(p, v.sellingPrice, v.barcode, v.sku, attrs ? `${p.name} (${attrs})` : p.name, v._id, v.defaultDiscount));
          });
        } else out.push(row(p, p.sellingPrice, p.barcode, p.sku, p.name, p._id));
      });
      pages = data.pages || 1; page += 1;
    } while (page <= pages);
    return out;
  }

  function row(p, price, barcode, sku, name, id, variantDiscount) {
    const hasBarcode = !!(barcode && String(barcode).trim());
    const was = Number(price) || 0;
    // Variant-level discount wins if the backend ever supplies one; otherwise the product's per-unit discount applies.
    const rawDisc = variantDiscount != null && variantDiscount !== '' ? Number(variantDiscount) : Number(p.defaultDiscount);
    const discount = Number.isFinite(rawDisc) && rawDisc > 0 && rawDisc <= was ? rawDisc : 0;
    return { id: `${p._id}:${id}`, name, price: was, discount, now: Math.max(0, was - discount), hasDiscount: discount > 0, sku: sku || '', barcode: hasBarcode ? String(barcode).trim() : (sku || ''), fromSku: !hasBarcode, categoryId: String(p.categoryId?._id || p.categoryId || '') };
  }

  const visible = () => state.rows.filter((r) =>
    (!state.search || r.name.toLowerCase().includes(state.search) || r.sku.toLowerCase().includes(state.search) || r.barcode.toLowerCase().includes(state.search)) &&
    (!state.categoryId || r.categoryId === state.categoryId) &&
    (state.mode !== 'discount' || r.hasDiscount));

  /* Price cell used on screen and in the A4 list: was (struck) / now / save when discounted. */
  const priceCellHtml = (r) => r.hasDiscount
    ? `<span class="sl-was">${window.UI.formatMoney(r.price)}</span> <strong>${window.UI.formatMoney(r.now)}</strong> <span class="badge badge-success">Save ${window.UI.formatMoney(r.discount)}</span>`
    : window.UI.formatMoney(r.price);

  function render() {
    if (!state.rows.length) {
      contentEl.innerHTML = `<div class="card"><div class="card-body"><h3>No products yet</h3><p class="text-secondary">Add your products first, then come back to print the shelf list and labels.</p><a class="btn btn-primary" href="products.html?action=add&from=onboarding&step=products">Add a product</a></div></div>`;
      return;
    }
    contentEl.innerHTML = `
      <div class="card" style="margin-bottom:var(--space-4)"><div class="card-body">
        <div class="sl-controls">
          <input class="input" id="sl-search" placeholder="Search name, SKU or barcode" />
          <select class="select" id="sl-cat"><option value="">All categories</option>${state.categories.map((c) => `<option value="${c._id}">${esc(c.name)}</option>`).join('')}</select>
          <select class="select" id="sl-size">${Object.entries(SIZES).map(([k, v]) => `<option value="${k}" ${k === state.size ? 'selected' : ''}>${v.label}</option>`).join('')}</select>
          <label class="sl-inline">Print
            <select class="select" id="sl-mode" style="min-width:0">
              <option value="all" ${state.mode === 'all' ? 'selected' : ''}>All products (discounts marked)</option>
              <option value="discount" ${state.mode === 'discount' ? 'selected' : ''}>Discounted products only</option>
            </select></label>
          <label class="sl-inline">Copies <input class="input" id="sl-copies" type="number" min="1" max="20" value="${state.copies}" style="width:70px" /></label>
          <label class="sl-inline"><input type="checkbox" id="sl-sku" ${state.showSku ? 'checked' : ''} /> Show SKU</label>
        </div>
        <div class="sl-actions">
          <span class="text-sm text-secondary" id="sl-count"></span>
          <span style="flex:1"></span>
          <button class="btn btn-secondary" id="sl-print-list">${window.Icons.get('printer')} Print price list (A4)</button>
          <button class="btn btn-primary" id="sl-print-labels">${window.Icons.get('printer')} Print shelf labels</button>
        </div>
        <div class="text-xs text-muted" style="margin-top:var(--space-2)">Labels print as a grid with dashed cut lines: print, cut along the lines, and stick one on each shelf edge. Discounted products show the old price crossed out, the new price and the amount saved. Products with no barcode use their SKU (marked <span class="badge badge-warning">SKU</span>).</div>
      </div></div>
      <div class="card"><div class="table-wrap"><table class="table">
        <thead><tr><th style="width:36px"><input type="checkbox" id="sl-all" /></th><th>Product</th><th>Barcode</th><th style="text-align:right">Price</th></tr></thead>
        <tbody id="sl-body"></tbody></table></div></div>`;
    bind(); renderBody();
  }

  function renderBody() {
    const rows = visible();
    document.getElementById('sl-body').innerHTML = rows.map((r) => `
      <tr><td><input type="checkbox" data-id="${esc(r.id)}" ${state.selected.has(r.id) ? 'checked' : ''} /></td>
      <td>${esc(r.name)}</td><td>${esc(r.barcode)} ${r.fromSku ? '<span class="badge badge-warning">SKU</span>' : ''}</td>
      <td style="text-align:right">${priceCellHtml(r)}</td></tr>`).join('') || `<tr><td colspan="4" class="text-muted" style="padding:var(--space-4)">${state.mode === 'discount' ? 'No discounted products found. Set a "Discount per unit" on a product to see it here.' : 'No matching products.'}</td></tr>`;
    document.querySelectorAll('#sl-body input[type=checkbox]').forEach((cb) => cb.addEventListener('change', () => {
      cb.checked ? state.selected.add(cb.dataset.id) : state.selected.delete(cb.dataset.id); updateCount();
    }));
    const all = document.getElementById('sl-all');
    all.checked = rows.length > 0 && rows.every((r) => state.selected.has(r.id));
    updateCount();
  }

  const chosen = () => state.rows.filter((r) => state.selected.has(r.id) && visible().includes(r));
  function updateCount() { const n = chosen().length; const el = document.getElementById('sl-count');
    if (!el) return;
    const total = state.mode === 'discount' ? state.rows.filter((r) => r.hasDiscount).length : state.rows.length;
    el.textContent = `${n} of ${total} ${state.mode === 'discount' ? 'discounted ' : ''}products selected`; }

  function bind() {
    document.getElementById('sl-search').addEventListener('input', window.UI.debounce((e) => { state.search = e.target.value.trim().toLowerCase(); renderBody(); }));
    document.getElementById('sl-cat').addEventListener('change', (e) => { state.categoryId = e.target.value; renderBody(); });
    document.getElementById('sl-mode').addEventListener('change', (e) => { state.mode = e.target.value; renderBody(); });
    document.getElementById('sl-size').addEventListener('change', (e) => { state.size = e.target.value; });
    document.getElementById('sl-copies').addEventListener('change', (e) => { state.copies = Math.min(20, Math.max(1, parseInt(e.target.value, 10) || 1)); e.target.value = state.copies; });
    document.getElementById('sl-sku').addEventListener('change', (e) => { state.showSku = e.target.checked; });
    document.getElementById('sl-all').addEventListener('change', (e) => { visible().forEach((r) => (e.target.checked ? state.selected.add(r.id) : state.selected.delete(r.id))); renderBody(); });
    document.getElementById('sl-print-list').addEventListener('click', () => print('list'));
    document.getElementById('sl-print-labels').addEventListener('click', () => print('labels'));
  }

  /* ---------------- printing ---------------- */
  function print(mode) {
    const rows = chosen();
    if (!rows.length) { window.UI.toast.error(state.mode === 'discount' ? 'No discounted products selected' : 'Select at least one product'); return; }
    let area = document.getElementById('print-area');
    if (!area) { area = document.createElement('div'); area.id = 'print-area'; document.body.appendChild(area); }
    const date = new Date().toLocaleDateString();
    if (mode === 'list') {
      area.innerHTML = `
        <h2 class="pl-title">${esc(state.businessName)} - ${state.mode === 'discount' ? 'Special offers' : 'Shelf price list'}</h2>
        <div class="pl-sub">${esc(date)} · ${rows.length} ${state.mode === 'discount' ? 'discounted ' : ''}products</div>
        <table class="pl-table"><thead><tr><th>#</th><th>Product</th><th>Barcode</th><th class="pl-r">Price</th></tr></thead><tbody>
        ${rows.map((r, i) => `<tr><td>${i + 1}</td><td>${esc(r.name)}${state.showSku && r.sku ? `<div class="pl-sku">${esc(r.sku)}</div>` : ''}</td><td class="pl-bc">${window.Barcode.svg(r.barcode, { height: 34, module: 1.6, quiet: 6 })}<div class="pl-code">${esc(r.barcode)}</div></td><td class="pl-r">${r.hasDiscount ? `<span class="pl-was">${window.UI.formatMoney(r.price)}</span><br>${window.UI.formatMoney(r.now)}<div class="pl-save">SAVE ${window.UI.formatMoney(r.discount)}</div>` : window.UI.formatMoney(r.price)}</td></tr>`).join('')}
        </tbody></table>`;
      document.body.dataset.printMode = 'list';
    } else {
      const sz = SIZES[state.size];
      const cells = [];
      rows.forEach((r) => { for (let i = 0; i < state.copies; i++) cells.push(r); });
      area.innerHTML = `<div class="lb-grid" style="--lb-w:${sz.w}mm;--lb-h:${sz.h}mm">
        ${cells.map((r) => `<div class="lb${r.hasDiscount ? ' lb-disc' : ''}">
          <div class="lb-name">${esc(r.name)}</div>
          ${r.hasDiscount ? `<div class="lb-offer">
            <div class="lb-was-row"><span class="lb-was">Was ${window.UI.formatMoney(r.price)}</span><span class="lb-save">SAVE ${window.UI.formatMoney(r.discount)}</span></div>
            <div class="lb-price"><span class="lb-now">NOW</span> ${window.UI.formatMoney(r.now)}</div>
          </div>` : `<div class="lb-price">${window.UI.formatMoney(r.price)}</div>`}
          <div class="lb-bc">${window.Barcode.svg(r.barcode, { fluid: true, height: 40, module: 2, quiet: 8 })}</div>
          <div class="lb-code">${esc(r.barcode)}${state.showSku && r.fromSku === false && r.sku ? ` · ${esc(r.sku)}` : ''}</div>
          ${state.businessName ? `<div class="lb-shop">${esc(state.businessName)}</div>` : ''}
        </div>`).join('')}</div>`;
      document.body.dataset.printMode = 'labels';
    }
    const done = () => { window.removeEventListener('afterprint', done); document.body.removeAttribute('data-print-mode'); area.innerHTML = ''; window.BusinessSetup?.markStepDone('labels'); };
    window.addEventListener('afterprint', done);
    setTimeout(() => window.print(), 100);
  }
})();