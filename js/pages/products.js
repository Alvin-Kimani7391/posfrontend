/**
 * products.js
 * Covers Products, Categories, and Variants - all backed by
 * /api/v1/products and /api/v1/categories. Categories and per-product
 * variant management open as modals from this same page rather than
 * getting their own nav entries, since they're both small, closely
 * related surfaces rather than destinations on their own.
 *
 * WHOLESALE: when the business has the "wholesalePricing" feature (Settings -> Business type) a product can be sold
 * wholesale too: fields wholesaleEnabled, moq (minimum order quantity, in the product's unit) and wholesalePrice
 * (KES per unit once the sale holds >= moq). Variants may carry their own wholesalePrice. The sales screen switches
 * price automatically; the backend enforces the rules (FEATURE_DISABLED / INVALID_WHOLESALE_CONFIG).
 * In the product form the wholesale fields only appear after the "Also sell wholesale" box is ticked.
 *
 * COPY NAME -> SKU: a small copy icon sits inside the Product name box; one click puts the name into the SKU box.
 *
 * DISCOUNT PER UNIT: each product can carry a standing per-unit discount
 * (field "defaultDiscount", KES). The sales screen pre-fills it on the
 * cart line whenever the product is scanned or searched (x quantity).
 *
 * POS BOOST (js/core/pos-boost.js): the barcode scanner is always listening on this page, the list and
 * search work offline from the copy saved on the device, and adding / editing products offline is queued.
 */
(function () {
  const state = { page: 1, limit: 10, search: '', categoryId: '', status: '' };
  const productIndex = window.FastSearch.create({ params: () => ({}), ttl: 60000 }); // all products, searched on the device
  const selected = new Map(); // product id -> name, kept across pages for "print selected stickers"
  let usedBarcodes = null;    // Set of every barcode already in the catalog (lazy, for auto-generation)
  let contentEl;
  let categoriesCache = null;

  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    contentEl = window.AppShell.mount({ title: 'Products' });
    if (!contentEl) return;

    contentEl.innerHTML = pageSkeleton();
    await getCategories(); // warm the cache before first render so filters/forms have data
    populateCategoryFilter();
    bindToolbar();
    bindAlwaysOnScanner();
    await fetchAndRender();
  }

  /** Full product from the server; with no internet, the copy saved on this device (so prices can still be changed). */
  async function getProductForEdit(id) {
    try { return (await window.Api.get(`/products/${id}`)).data; }
    catch (err) {
      const local = (productIndex.query({ search: '', page: 1, limit: 100000 }) || { items: [] }).items.find((p) => p._id === id);
      if (local) return { product: local };
      window.UI.toast.error(err.message);
      return null;
    }
  }

  /** Barcode scanner is ALWAYS listening on this page: a scan fills the search box and filters the list at once. */
  function bindAlwaysOnScanner() {
    const input = document.getElementById('search-input');
    const run = (code) => {
      if (document.querySelector('.modal-backdrop')) return; // a form is open: its own barcode field gets the scan
      input.value = code; state.search = code; state.page = 1;
      fetchAndRender({ local: true }).then(() => {
        const rows = document.querySelectorAll('#products-tbody tr[data-id]');
        if (!rows.length && window.PosBoost) {
          window.UI.toast.info(`No product with barcode ${code}`);
          window.PosBoost.quickAdd({ barcode: code, onAdded: () => { productIndex.invalidate(); fetchAndRender(); } });
        } else if (rows.length === 1) rows[0].classList.add('pb-hit');
      });
      input.select();
    };
    if (window.BarcodeScanner) window.BarcodeScanner.listenHardwareScanner(run, { minLength: 4 });
    input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      const term = input.value.trim();
      if (!term) return;
      e.preventDefault();
      if (/^\d{6,}$/.test(term)) run(term);
      else if (!document.querySelector('#products-tbody tr[data-id]') && window.PosBoost) {
        window.PosBoost.quickAdd({ name: term, onAdded: () => { productIndex.invalidate(); fetchAndRender(); } });
      }
    });
    if (window.PosBoost) {
      window.PosBoost.keepScannerReady(() => input);
      window.PosBoost.onChange(() => { productIndex.invalidate(); productIndex.load().then(() => fetchAndRender({ local: true })); });
    }
    input.focus();
  }

  function pageSkeleton() {
    return `
      <div class="page-header">
        <div>
          <h1>Products</h1>
          <p>Manage your catalog, categories, and product variants.</p>
        </div>
        <div class="flex gap-2">
          <button class="btn btn-secondary" id="manage-categories-btn" data-requires-permission="categories.view">
            ${window.Icons.get('box')} Categories
          </button>
          <button class="btn btn-secondary" id="barcode-stickers-btn" data-requires-permission="products.view" title="Print barcode stickers on the receipt printer">
            ${window.Icons.get('printer')} Barcode stickers
          </button>
          <a class="btn btn-secondary" id="shelf-labels-link" href="shelf-labels.html" data-requires-permission="products.view">
            ${window.Icons.get('printer')} Shelf labels
          </a>
          <button class="btn btn-secondary" id="import-excel-btn" data-requires-permission="products.create" title="Add many products from an Excel sheet">
            ${window.Icons.get('table')} Import from Excel
          </button>
          <button class="btn btn-primary" id="add-product-btn" data-requires-permission="products.create">
            ${window.Icons.get('plus')} Add product
          </button>
        </div>
      </div>

      <div class="card">
        <div class="toolbar">
          <div class="toolbar-search input-group">
            <span class="input-group-icon">${window.Icons.get('search')}</span>
            <input class="input" id="search-input" type="text" autocomplete="off" placeholder="Scan a barcode or search by name, SKU, or barcode" />
          </div>
          <select class="select" id="category-filter" style="max-width: 220px">
            <option value="">All categories</option>
          </select>
        </div>
        <div class="bl-sel-bar" id="bl-sel-bar" hidden>
          <span id="bl-sel-count"></span>
          <button class="btn btn-primary btn-sm" id="bl-print-selected">${window.Icons.get('printer')} Print stickers for selected</button>
          <button class="btn btn-ghost btn-sm" id="bl-clear-selected">Clear</button>
        </div>
        <div class="table-wrap">
          <table class="table">
            <thead>
              <tr>
                <th class="bl-sel-col"><input type="checkbox" id="bl-page-all" title="Select all on this page" /></th>
                <th>Product</th>
                <th>SKU / Barcode</th>
                <th>Category</th>
                <th>Price</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody id="products-tbody">${window.UI.skeletonRows(7, 4)}</tbody>
          </table>
        </div>
        <div class="pagination" id="pagination"></div>
      </div>
    `;
  }

  /* ------------------------------------------------------------------ *
   * Barcode scanning helpers - shared by every barcode field on this
   * page (main product form, each dynamic variant row when creating a
   * product, and the "add variant" form on an existing product).
   * ------------------------------------------------------------------ */
  function scanButtonHtml(id) {
    if (!window.BarcodeScanner) return '';
    return `<button type="button" class="btn btn-secondary btn-icon" id="${id}" title="Scan barcode">${window.BarcodeScanner.cameraIconSvg}</button>`;
  }

  function bindBarcodeScanButton(button, input) {
    if (!button || !input || !window.BarcodeScanner) return;
    button.addEventListener('click', () => {
      window.BarcodeScanner.openCameraModal({
        title: 'Scan barcode',
        onDetect: (code) => {
          input.value = code.trim();
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.focus();
        },
      });
    });
  }


  /* ------------------------------------------------------------------ *
   * LIVE DUPLICATE-BARCODE ALERT
   * The moment a barcode is scanned / typed / generated into ANY barcode box, it is checked against the
   * catalog (and the server) and a RED alert is shown straight away - before the user clicks Add product.
   * `ownCodes` = barcodes that belong to the record being edited (they are not duplicates of themselves).
   * ------------------------------------------------------------------ */
  async function findExistingBarcode(code) {
    const c = String(code || '').trim();
    if (!c) return null;
    let used = null;
    try { used = await getUsedBarcodes(); } catch { /* ignore */ }
    try {
      const { data } = await window.Api.get(`/products/barcode/${encodeURIComponent(c)}`);
      const p = data && (data.product || data);
      if (p && (p._id || p.name)) return { name: p.name || '' };
    } catch { /* not found on the server */ }
    if (used && used.has(c)) return { name: '' };
    return null;
  }

  function bindBarcodeLiveCheck(input, scope, ownCodes) {
    if (!input || input._bcLive) return;
    input._bcLive = true;
    const own = new Set((ownCodes || []).map((x) => String(x || '').trim()).filter(Boolean));
    const field = input.closest('.field') || input.parentElement;
    const msg = document.createElement('div');
    msg.className = 'bc-dup-msg';
    msg.setAttribute('role', 'alert');
    msg.style.cssText = 'display:none;margin-top:6px;padding:8px 10px;border-radius:6px;background:#fdecea;border:1px solid #d93025;color:#b3140a;font-weight:600;font-size:13px';
    field.appendChild(msg);
    let timer = null, seq = 0, lastToasted = '';

    const setState = (dup, text) => {
      input._bcDup = dup;
      input.classList.toggle('bc-dup', dup);
      input.style.borderColor = dup ? '#d93025' : '';
      input.style.boxShadow = dup ? '0 0 0 3px rgba(217,48,37,.25)' : '';
      input.style.background = dup ? '#fff5f4' : '';
      msg.style.display = dup ? '' : 'none';
      msg.textContent = dup ? text : '';
    };

    const check = async () => {
      const code = input.value.trim();
      const my = ++seq;
      if (!code || own.has(code)) { setState(false); return; }
      // same code typed in another barcode box of this same form
      const sameForm = Array.from(scope.querySelectorAll('input[name="barcode"], input[name^="v-barcode-"]'))
        .some((el) => el !== input && el.value.trim() === code);
      if (sameForm) { setState(true, `⚠ Barcode ${code} is already used in another field of this form.`); return; }
      const hit = await findExistingBarcode(code);
      if (my !== seq) return; // a newer scan replaced this one
      if (hit && !own.has(input.value.trim())) {
        const text = `⚠ BARCODE ALREADY EXISTS in the system${hit.name ? ` — product: "${hit.name}"` : ''}. Use a different barcode.`;
        setState(true, text);
        if (lastToasted !== code) { lastToasted = code; window.UI.toast.error(`Barcode ${code} already exists${hit.name ? ` (${hit.name})` : ''}`); }
        try { input.focus(); input.select(); } catch { /* ignore */ }
      } else {
        setState(false);
      }
    };

    input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(check, 250); });
    input.addEventListener('change', () => { clearTimeout(timer); check(); });
    input.addEventListener('blur', () => { clearTimeout(timer); check(); });
    input._bcCheck = check;
    if (input.value.trim()) check();
  }

  /** True (and focuses the offending box) when any barcode box in `scope` currently holds a duplicate. */
  async function barcodeBlocked(scope) {
    const inputs = Array.from(scope.querySelectorAll('input[name="barcode"], input[name^="v-barcode-"]'));
    for (const el of inputs) { if (el._bcCheck && el.value.trim()) await el._bcCheck(); }
    const bad = inputs.find((el) => el._bcDup);
    if (bad) { window.UI.toast.error('This barcode already exists in the system - change it first'); bad.focus(); return true; }
    return false;
  }

  /* ------------------------------------------------------------------ *
   * Categories (cached, shared by the filter dropdown and product forms)
   * ------------------------------------------------------------------ */
  async function getCategories(force = false) {
    if (categoriesCache && !force) return categoriesCache;
    try {
      const { data } = await window.Api.get('/categories');
      categoriesCache = data.categories;
    } catch {
      categoriesCache = [];
    }
    return categoriesCache;
  }

  function populateCategoryFilter() {
    const select = document.getElementById('category-filter');
    select.innerHTML = '<option value="">All categories</option>' +
      categoriesCache.map((c) => `<option value="${c._id}">${window.UI.escapeHtml(c.name)}</option>`).join('');
  }

  /**
   * Personalised tracking options: an option shows only when the business has that feature on
   * (Settings -> Business type), or when this product already uses it (so nothing is ever lost on edit).
   */
  function trackingOption(name, label, feature, checked) {
    const profile = window.AppShell.getBusinessProfile?.();
    const known = !!(profile && profile.featureSettings);
    if (known && !window.AppShell.hasFeature(feature) && !checked) return '';
    return `<label class="checkbox-row"><input type="checkbox" name="${name}" ${checked ? 'checked' : ''} /> <span class="text-sm">${label}</span></label>`;
  }

  function categoryOptionsHtml(selectedId) {
    return '<option value="">No category</option>' +
      categoriesCache.map((c) => `<option value="${c._id}" ${c._id === selectedId ? 'selected' : ''}>${window.UI.escapeHtml(c.name)}</option>`).join('');
  }

  function updateSelectionBar(pageItems) {
    const bar = document.getElementById('bl-sel-bar');
    if (!bar) return;
    bar.hidden = selected.size === 0;
    document.getElementById('bl-sel-count').textContent = `${selected.size} product${selected.size === 1 ? '' : 's'} selected`;
    const all = document.getElementById('bl-page-all');
    if (all && pageItems) all.checked = pageItems.length > 0 && pageItems.every((p) => selected.has(p._id));
  }

  /* ------------------------------------------------------------------ *
   * Barcode generation (products that have no barcode get a store EAN-13)
   * ------------------------------------------------------------------ */
  async function getUsedBarcodes(force = false) {
    if (usedBarcodes && !force) return usedBarcodes;
    try { usedBarcodes = (await window.BarcodeLabels.loadCatalog()).used; }
    catch { usedBarcodes = new Set(); }
    return usedBarcodes;
  }

  /** Puts a freshly generated barcode into a form field. */
  async function fillGeneratedBarcode(input) {
    const used = await getUsedBarcodes();
    // anything typed in the other barcode boxes of the open form counts as used too
    document.querySelectorAll('#product-form input[name^="v-barcode-"], #product-form input[name="barcode"], #add-variant-form input[name="barcode"]')
      .forEach((el) => { if (el !== input && el.value.trim()) used.add(el.value.trim()); });
    input.value = window.BarcodeLabels.generateCode(used);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function generateButtonHtml(id) {
    return `<button type="button" class="btn btn-secondary" id="${id}" title="Generate a barcode for this product">Generate</button>`;
  }
  function bindGenerateButton(button, input) {
    if (!button || !input) return;
    button.addEventListener('click', () => fillGeneratedBarcode(input));
  }

  function bindToolbar() {
    document.getElementById('barcode-stickers-btn').addEventListener('click', () => {
      window.BarcodeLabels.openPrintDialog({ selectedIds: [] }); // everything ticked: untick what you do not need
    });
    document.getElementById('bl-print-selected').addEventListener('click', () => {
      window.BarcodeLabels.openPrintDialog({ selectedIds: Array.from(selected.keys()) });
    });
    document.getElementById('bl-clear-selected').addEventListener('click', () => {
      selected.clear();
      document.querySelectorAll('#products-tbody [data-select]').forEach((cb) => { cb.checked = false; });
      updateSelectionBar([]);
    });
    document.getElementById('bl-page-all').addEventListener('change', (e) => {
      document.querySelectorAll('#products-tbody [data-select]').forEach((cb) => {
        cb.checked = e.target.checked;
        const name = cb.closest('tr').querySelector('.cell-primary')?.textContent || '';
        if (e.target.checked) selected.set(cb.dataset.select, name); else selected.delete(cb.dataset.select);
      });
      updateSelectionBar();
    });

    document.getElementById('import-excel-btn')?.addEventListener('click', () => window.ProductImport.open({ onDone: () => window.location.reload() }));
    document.getElementById('add-product-btn').addEventListener('click', () => {
      // Pharmacies add medicines through their own form (drug details + opening batch); other goods use the normal form.
      // Wines & spirits add drinks through their own form (category, ABV, size, photo, packs, empties, opening stock).
      if (window.LiquorProductForm && window.LiquorProductForm.applies()) { window.LiquorProductForm.open({ onDone: () => fetchAndRender() }); return; }
      if (window.PharmacyProductForm && window.AppShell.hasFeature && window.AppShell.hasFeature('pharmacyDispensing') && window.Permissions.can(window.AppShell.getUser(), 'medicines.manage')) {
        window.PharmacyProductForm.chooser({ onDone: () => fetchAndRender(), onOther: () => openProductModal() });
      } else openProductModal();
    });
    window.AppShell.runUrlAction?.('add-product-btn'); // opened from the setup guide
    document.getElementById('manage-categories-btn').addEventListener('click', openCategoriesModal);

    // Instant when the product list is already on the device (js/core/fast-search.js); otherwise a short debounce + server.
    const searchLater = window.UI.debounce(() => fetchAndRender({ local: true }), 250);
    document.getElementById('search-input').addEventListener('input', (e) => {
      state.search = e.target.value.trim();
      state.page = 1;
      if (productIndex.isReady()) fetchAndRender({ local: true }); else searchLater();
    });

    document.getElementById('category-filter').addEventListener('change', (e) => {
      state.categoryId = e.target.value;
      state.page = 1;
      fetchAndRender({ local: true });
    });
  }

  /* ------------------------------------------------------------------ *
   * List + table
   * ------------------------------------------------------------------ */
  async function fetchAndRender(opts) {
    const tbody = document.getElementById('products-tbody');
    const local = !!(opts && opts.local);
    if (!local) productIndex.invalidate(); // something changed (or first load): the device copy must reload

    if (local) {
      // Search / filter / page change answered from the in-memory list: no skeleton, no waiting.
      const res = productIndex.query({ search: state.search, categoryId: state.categoryId, page: state.page, limit: state.limit });
      if (res) {
        state.page = res.page;
        renderRows(res.items);
        window.UI.renderPagination(document.getElementById('pagination'), res, (p) => { state.page = p; fetchAndRender({ local: true }); });
        window.Permissions.applyPermissionGates(contentEl, window.AppShell.getUser());
        return;
      }
    }

    tbody.innerHTML = window.UI.skeletonRows(7, 4);

    try {
      if (window.LiquorTill && window.LiquorTill.active()) await window.LiquorTill.refresh(); // category / ABV / size beside each drink
      const { data } = await window.Api.get('/products', {
        page: state.page, limit: state.limit, search: state.search, categoryId: state.categoryId,
      });
      renderRows(data.items);
      window.UI.renderPagination(document.getElementById('pagination'), data, (p) => { state.page = p; fetchAndRender({ local: true }); });
      window.Permissions.applyPermissionGates(contentEl, window.AppShell.getUser());
      productIndex.load(); // warm the device copy so the next search is instant
    } catch (err) {
      // No internet / server down: show the copy saved on this device (plus anything waiting to upload).
      await productIndex.load();
      const res = productIndex.query({ search: state.search, categoryId: state.categoryId, page: state.page, limit: state.limit });
      if (res) {
        state.page = res.page;
        renderRows(res.items);
        window.UI.renderPagination(document.getElementById('pagination'), res, (p) => { state.page = p; fetchAndRender({ local: true }); });
        window.Permissions.applyPermissionGates(contentEl, window.AppShell.getUser());
        window.UI.toast.info('Offline: showing products saved on this device');
        return;
      }
      tbody.innerHTML = `<tr><td colspan="7">${window.UI.emptyStateHtml({ icon: 'alert', title: 'Could not load products', message: err.message })}</td></tr>`;
    }
  }

  /** Price cell for a wholesale-first product: the wholesale price leads, retail (if any) follows. */
  function wholesalePriceCell(p) {
    const s = window.WholesaleProductForm.summarize(p);
    const esc = window.UI.escapeHtml;
    return `
          <div class="cell-primary">${window.UI.formatMoney(s.wholesale)} <span class="text-xs text-muted">/ ${esc(s.unit || '')} wholesale</span></div>
          ${s.retailOn
            ? `<div class="text-xs text-muted">Retail ${window.UI.formatMoney(s.retail)} / ${esc(s.retailUnit || '')}</div>`
            : '<div class="text-xs text-muted">Wholesale only</div>'}`;
  }

  /** Wines & spirits: photo (or a coloured initial), category chip, ABV and bottle size beside the name. Cashier-safe: reads the cached till rules. */
  function liquorCell(p) {
    const LT = window.LiquorTill; if (!LT || !LT.active()) return '';
    const e = window.UI.escapeHtml; const d = LT.info(p._id);
    const thumb = p.image ? `<img class="lq-thumb" src="${e(p.image)}" alt="" loading="lazy" />` : `<span class="lq-thumb-ph lq-c-${d ? e(d.category) : 'OTHER'}">${e((p.name || '?').trim().charAt(0).toUpperCase())}</span>`;
    const size = d && d.volumeMl ? (d.volumeMl >= 1000 ? `${d.volumeMl / 1000} L` : `${d.volumeMl} ml`) : '';
    const meta = d ? `<span class="lq-chip lq-c-${e(d.category)}">${e(String(d.category).replace(/_/g, ' ').toLowerCase())}</span>${d.abv != null ? ` <span class="lq-abv">${e(d.abv)}%</span>` : ''}${size ? ` <span class="text-xs text-muted">${size}</span>` : ''}` : '<span class="text-xs text-muted">No drink details yet</span>';
    return `<div class="lq-pcell">${thumb}<div><div class="cell-primary">${e(p.name)}</div><small>${meta}</small></div></div>`;
  }

  function renderRows(items) {
    const tbody = document.getElementById('products-tbody');

    if (!items.length) {
      tbody.innerHTML = `<tr><td colspan="7">${window.UI.emptyStateHtml({
        icon: 'products',
        title: state.search || state.categoryId ? 'No products match your filters' : 'No products yet',
        message: state.search || state.categoryId ? '' : 'Add your first product to start building your catalog.',
      })}</td></tr>`;
      return;
    }

    tbody.innerHTML = items.map((p) => {
      const discount = Number(p.defaultDiscount) || 0;
      return `
      <tr data-id="${p._id}">
        <td class="bl-sel-col"><input type="checkbox" data-select="${p._id}" ${selected.has(p._id) ? 'checked' : ''} /></td>
        <td>
          ${liquorCell(p) || `<div class="cell-primary">${window.UI.escapeHtml(p.name)}${p._pending ? '<span class="pb-pending">waiting to upload</span>' : ''}</div>`}
          ${p.hasVariants ? `<div class="text-xs text-muted">${p.variants.length} variant${p.variants.length === 1 ? '' : 's'}</div>` : ''}
        </td>
        <td>
          <div class="text-sm">${window.UI.escapeHtml(p.sku)}</div>
          ${p.unitValue > 0 ? `<div class="text-xs text-muted">${window.UI.escapeHtml(`${p.unitValue}${/^(g|kg|ml|l|litre)$/.test(p.unit || '') ? '' : ' '}${p.unit === 'litre' ? 'L' : (p.unit || '')}`)} per item</div>` : ''}
          ${p.barcode ? `<div class="text-xs text-muted">${window.UI.escapeHtml(p.barcode)}</div>` : (p.hasVariants ? '' : '<div class="text-xs"><span class="badge badge-warning">No barcode</span></div>')}
        </td>
        <td class="text-sm">${p.categoryId ? window.UI.escapeHtml(p.categoryId.name) : '<span class="text-muted">Uncategorized</span>'}</td>
        <td>
          ${p.pricingMode === 'WHOLESALE_FIRST' ? wholesalePriceCell(p) : `
          <div class="cell-primary">${p.hasVariants ? 'Varies' : window.UI.formatMoney(p.sellingPrice)}</div>
          ${discount > 0 ? `<div class="text-xs text-muted">${window.UI.formatMoney(discount)} off / unit</div>` : ''}
          ${p.wholesaleEnabled && p.moq ? `<div class="text-xs text-muted">${p.wholesalePrice ? window.UI.formatMoney(p.wholesalePrice) : 'Per variant'} wholesale from ${p.moq} ${window.UI.escapeHtml(p.unit || '')}</div>` : ''}`}
        </td>
        <td><span class="badge ${p.status === 'active' ? 'badge-success' : 'badge-neutral'}">${p.status}</span></td>
        <td class="actions">
          ${p.hasVariants ? `<button class="btn btn-ghost btn-sm btn-icon" data-action="variants" data-requires-permission="products.update" title="Manage variants">${window.Icons.get('box')}</button>` : ''}
          <button class="btn btn-ghost btn-sm btn-icon" data-action="sticker" data-requires-permission="products.view" title="Print barcode sticker">${window.Icons.get('printer')}</button>
          <button class="btn btn-ghost btn-sm btn-icon" data-action="edit" data-requires-permission="products.update" title="Edit">${window.Icons.get('edit')}</button>
          <button class="btn btn-ghost btn-sm btn-icon" data-action="archive" data-requires-permission="products.delete" title="Archive">${window.Icons.get('trash')}</button>
        </td>
      </tr>
    `;
    }).join('');

    tbody.querySelectorAll('[data-select]').forEach((cb) => {
      cb.addEventListener('change', () => {
        const prod = items.find((p) => p._id === cb.dataset.select);
        if (cb.checked) selected.set(cb.dataset.select, prod ? prod.name : ''); else selected.delete(cb.dataset.select);
        updateSelectionBar(items);
      });
    });
    tbody.querySelectorAll('[data-action="sticker"]').forEach((btn) => {
      btn.addEventListener('click', () => window.BarcodeLabels.openPrintDialog({ selectedIds: [btn.closest('tr').dataset.id] }));
    });
    updateSelectionBar(items);

    tbody.querySelectorAll('[data-action="edit"]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.closest('tr').dataset.id;
        const data = await getProductForEdit(id);
        if (!data) return;
        if (window.LiquorProductForm && window.LiquorProductForm.applies()) { window.LiquorProductForm.open({ product: data.product, onDone: () => fetchAndRender() }); return; }
        openProductModal(data.product);
      });
    });

    tbody.querySelectorAll('[data-action="variants"]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.closest('tr').dataset.id;
        const { data } = await window.Api.get(`/products/${id}`);
        openVariantsModal(data.product);
      });
    });

    tbody.querySelectorAll('[data-action="archive"]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const row = btn.closest('tr');
        const product = items.find((p) => p._id === row.dataset.id);
        const ok = await window.UI.confirmDialog({
          title: 'Archive product?',
          message: `"${product.name}" will no longer appear in the catalog or be sellable.`,
          confirmText: 'Archive',
          danger: true,
        });
        if (!ok) return;
        try {
          await window.Api.delete(`/products/${product._id}`);
          window.UI.toast.success('Product archived');
          fetchAndRender();
        } catch (err) {
          window.UI.toast.error(err.message);
        }
      });
    });
  }

  /* ------------------------------------------------------------------ *
   * Categories modal
   * ------------------------------------------------------------------ */
  async function openCategoriesModal() {
    await getCategories(true);

    const modal = window.UI.openModal({
      title: 'Categories',
      maxWidth: '480px',
      bodyHtml: `
        <form id="new-category-form" class="flex gap-2" style="margin-bottom: var(--space-4)">
          <input class="input" name="name" placeholder="New category name" required style="flex:1" />
          <button type="submit" class="btn btn-primary btn-sm">${window.Icons.get('plus')} Add</button>
        </form>
        <div id="category-list"></div>
      `,
      footerHtml: `<button class="btn btn-secondary" data-action="close">Close</button>`,
    });

    modal.querySelector('[data-action="close"]').addEventListener('click', async () => {
      window.UI.closeModal();
      populateCategoryFilter();
      fetchAndRender();
    });

    renderCategoryList(modal);

    modal.querySelector('#new-category-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const form = e.target;
      const payload = window.UI.serializeForm(form);
      try {
        await window.Api.post('/categories', payload);
        form.reset();
        await getCategories(true);
        renderCategoryList(modal);
      } catch (err) {
        window.UI.toast.error(err.message);
      }
    });
  }

  function renderCategoryList(modal) {
    const listEl = modal.querySelector('#category-list');
    if (!categoriesCache.length) {
      listEl.innerHTML = window.UI.emptyStateHtml({ icon: 'box', title: 'No categories yet' });
      return;
    }

    listEl.innerHTML = `
      <div class="table-wrap" style="max-height: 280px; overflow-y: auto">
        <table class="table">
          <tbody>
            ${categoriesCache.map((c) => `
              <tr data-id="${c._id}">
                <td class="cell-primary">${window.UI.escapeHtml(c.name)}</td>
                <td class="actions">
                  <button class="btn btn-ghost btn-sm btn-icon" data-action="archive-cat" title="Archive">${window.Icons.get('trash')}</button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;

    listEl.querySelectorAll('[data-action="archive-cat"]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.closest('tr').dataset.id;
        const ok = await window.UI.confirmDialog({ title: 'Archive category?', confirmText: 'Archive', danger: true });
        if (!ok) return;
        try {
          await window.Api.delete(`/categories/${id}`);
          await getCategories(true);
          renderCategoryList(modal);
        } catch (err) {
          window.UI.toast.error(err.message);
        }
      });
    });
  }

  /* ------------------------------------------------------------------ *
   * Create / edit product modal
   * ------------------------------------------------------------------ */
  let variantRowCount = 0;

  /** Wholesale section is offered only when the business has the feature, or the product already uses it. */
  function wholesaleAllowed(product) {
    const t = window.AppShell.getBusinessProfile?.()?.businessType;
    // Shops and supermarkets always get the option (the server switches the feature on the first time it is used).
    return window.AppShell.hasFeature('wholesalePricing') || t === 'supermarket' || t === 'general_shop' || !!(product && product.wholesaleEnabled);
  }

  /**
   * "Also sell wholesale" checkbox is always shown; the wholesale fields (MOQ, price, pack)
   * are revealed only while the box is ticked (see the wsToggle handler in openProductModal).
   */
  function wholesaleSectionHtml(product) {
    const on = !!(product && product.wholesaleEnabled);
    const hasVariants = !!(product && product.hasVariants);
    return `
        <div class="field" id="wholesale-section" style="border:1px solid var(--color-border); border-radius: var(--radius-md); padding: var(--space-3)">
          <label class="checkbox-row"><input type="checkbox" name="wholesaleEnabled" id="p-wholesale-on" ${on ? 'checked' : ''} /> <span class="text-sm font-semibold">Also sell wholesale</span></label>
          <div id="wholesale-fields" style="${on ? '' : 'display:none;'}">
          <span class="field-hint">Once a sale holds at least the minimum order quantity (MOQ) of this product, the till charges the wholesale price automatically. Below it, the normal selling price applies.</span>
          <div class="form-row" style="margin-top: var(--space-2)">
            <div class="field" style="margin-bottom: var(--space-2)">
              <label for="p-moq">Minimum order quantity (MOQ)</label>
              <input class="input" id="p-moq" name="moq" type="number" step="any" min="0" inputmode="decimal" value="${product && product.moq ? product.moq : ''}" placeholder="e.g. 12" ${on ? '' : 'disabled'} />
            </div>
            <div class="field" style="margin-bottom: var(--space-2)">
              <label for="p-wprice">Wholesale price per unit (KES)${hasVariants ? ' <span class="text-muted">(default for variants)</span>' : ''}</label>
              <input class="input" id="p-wprice" name="wholesalePrice" type="number" step="0.01" min="0" inputmode="decimal" value="${product && product.wholesalePrice ? product.wholesalePrice : ''}" placeholder="Lower than the selling price" ${on ? '' : 'disabled'} />
            </div>
          </div>
          ${!product || !(product.units && product.units.length) ? `
          <div class="form-row" style="margin-top: var(--space-1)">
            <div class="field" style="margin-bottom: var(--space-2)">
              <label for="p-wu-name">Wholesale pack <span class="text-muted">(optional, e.g. Carton)</span></label>
              <input class="input" id="p-wu-name" name="wuName" placeholder="Carton, Dozen, Bale" maxlength="30" ${on ? '' : 'disabled'} />
            </div>
            <div class="field" style="margin-bottom: var(--space-2)">
              <label for="p-wu-factor">Items in one pack</label>
              <input class="input" id="p-wu-factor" name="wuFactor" type="number" step="any" min="0" inputmode="decimal" placeholder="e.g. 24" ${on ? '' : 'disabled'} />
            </div>
          </div>
          <span class="field-hint">Lets you buy, stock and sell by the pack as well as by single items.</span>` : ''}
          </div>
        </div>`;
  }

  function variantRowHtml(idx) {
    return `
      <div class="variant-row" data-idx="${idx}" style="border:1px solid var(--color-border); border-radius: var(--radius-md); padding: var(--space-3); margin-bottom: var(--space-2)">
        <div class="form-row">
          <div class="field" style="margin-bottom: var(--space-2)">
            <label>SKU</label>
            <input class="input" name="v-sku-${idx}" required placeholder="TS-BLK-M" />
          </div>
          <div class="field" style="margin-bottom: var(--space-2)">
            <label>Barcode <span class="text-muted">(optional)</span></label>
            <div class="input-button-row">
              <input class="input" name="v-barcode-${idx}" placeholder="Scan, type or Generate" />
              ${scanButtonHtml(`v-barcode-scan-${idx}`)}
              ${generateButtonHtml(`v-barcode-gen-${idx}`)}
            </div>
          </div>
        </div>
        <div class="form-row">
          <div class="field" style="margin-bottom: var(--space-2)">
            <label>Attributes</label>
            <input class="input" name="v-attrs-${idx}" placeholder="Size: M, Color: Black" />
          </div>
          <div class="field" style="margin-bottom: var(--space-2)">
            <label>Selling price (KES)</label>
            <input class="input" name="v-price-${idx}" type="number" step="0.01" min="0" required />
          </div>
        </div>
        ${window.AppShell.hasFeature('wholesalePricing') ? `
        <div class="field" style="margin-bottom: var(--space-2)">
          <label>Wholesale price (KES) <span class="text-muted">(optional - uses the product's wholesale price when empty)</span></label>
          <input class="input" name="v-wprice-${idx}" type="number" step="0.01" min="0" style="max-width: 200px" />
        </div>` : ''}
        <button type="button" class="btn btn-ghost btn-sm" data-action="remove-variant-row">${window.Icons.get('trash')} Remove</button>
      </div>
    `;
  }

  function parseAttributes(text) {
    if (!text) return {};
    const attrs = {};
    text.split(',').forEach((pair) => {
      const [k, v] = pair.split(':').map((s) => s?.trim());
      if (k && v) attrs[k] = v;
    });
    return attrs;
  }

  function canReceiveStock() {
    try { return !!window.Permissions.can(window.AppShell.getUser(), 'inventory.receive'); } catch { return false; }
  }

  /** Small inline "copy" icon (used inside the Product name box). */
  const COPY_ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';

  function openProductModal(product) {
    const isEdit = !!product;
    variantRowCount = 0;

    const existingDiscount = isEdit ? Number(product.defaultDiscount) || 0 : 0;
    // Wholesale businesses enter products wholesale-first (retail + unit conversion are optional extras).
    const wf = !!(window.WholesaleProductForm && window.WholesaleProductForm.applies(isEdit ? product : null));

    const bodyHtml = `
      <form id="product-form">
        <div class="field">
          <label for="p-name">Product name</label>
          <div style="position:relative">
            <input class="input" id="p-name" name="name" required value="${isEdit ? window.UI.escapeHtml(product.name) : ''}" placeholder="Samsung 43&quot; Smart TV" style="padding-right:44px" />
            <button type="button" id="p-name-copy-btn" title="Copy product name to SKU" aria-label="Copy product name to SKU"
              style="position:absolute; right:6px; top:50%; transform:translateY(-50%); display:flex; align-items:center; justify-content:center; width:30px; height:30px; padding:0; border:0; border-radius:6px; background:transparent; color:var(--color-text-muted, #6b7280); cursor:pointer">${COPY_ICON_SVG}</button>
          </div>
          <span class="field-hint">Tap the copy icon to put this name into the SKU box.</span>
        </div>
        <div class="form-row">
          <div class="field">
            <label for="p-sku">SKU</label>
            <input class="input" id="p-sku" name="sku" required value="${isEdit ? window.UI.escapeHtml(product.sku) : ''}" placeholder="TV-SAM-43" />
          </div>
          <div class="field">
            <label for="p-barcode">Barcode <span class="text-muted">(optional)</span></label>
            <div class="input-button-row">
              <input class="input" id="p-barcode" name="barcode" value="${isEdit ? window.UI.escapeHtml(product.barcode || '') : ''}" placeholder="Scan, type or Generate" />
              ${scanButtonHtml('p-barcode-scan-btn')}
              ${generateButtonHtml('p-barcode-gen-btn')}
            </div>
            <span class="field-hint">No barcode on the product? Leave empty or press Generate - the system creates a scannable one.</span>
          </div>
        </div>
        ${!isEdit ? `
        <div class="field bl-print-opt">
          <label class="checkbox-row"><input type="checkbox" id="p-print-sticker" ${window.Storage.getPref('printStickerOnAdd', true) ? 'checked' : ''} /> <span class="text-sm">Print barcode sticker after saving</span></label>
          <label class="text-sm">Stickers <input class="input" id="p-print-copies" type="number" min="1" max="500" value="1" /></label>
        </div>` : ''}
        <div class="form-row">
          <div class="field">
            <label for="p-category">Category</label>
            <select class="select" id="p-category" name="categoryId">${categoryOptionsHtml(isEdit ? product.categoryId?._id : null)}</select>
          </div>
          <div class="field">
            <label for="p-brand">Brand <span class="text-muted">(optional)</span></label>
            <input class="input" id="p-brand" name="brand" value="${isEdit ? window.UI.escapeHtml(product.brand || '') : ''}" />
          </div>
        </div>

        ${wf ? window.WholesaleProductForm.html(isEdit ? product : null) : `
        ${!isEdit ? `
        <div class="form-row">
          <div class="field">
            <label for="p-cost">Cost price (KES)</label>
            <input class="input" id="p-cost" name="costPrice" type="number" step="0.01" min="0" value="0" />
          </div>
          <div class="field">
            <label for="p-price">Selling price (KES)</label>
            <input class="input" id="p-price" name="sellingPrice" type="number" step="0.01" min="0" required />
          </div>
        </div>
        ` : `
        <div class="form-row">
          <div class="field">
            <label for="p-cost">Cost price (KES)</label>
            <input class="input" id="p-cost" name="costPrice" type="number" step="0.01" min="0" value="${product.costPrice}" />
          </div>
          <div class="field">
            <label for="p-price">Selling price (KES)</label>
            <input class="input" id="p-price" name="sellingPrice" type="number" step="0.01" min="0" value="${product.sellingPrice}" ${product.hasVariants ? 'disabled' : 'required'} />
          </div>
        </div>
        ${product.hasVariants ? '<p class="text-xs text-muted" style="margin-top:-8px; margin-bottom: var(--space-4)">This product has variants - manage their prices individually from the Variants screen.</p>' : ''}
        `}

        <div class="field">
          <label for="p-discount">Discount per unit (KES) <span class="text-muted">(optional)</span></label>
          <input class="input" id="p-discount" name="defaultDiscount" type="number" step="0.01" min="0" inputmode="decimal" value="${existingDiscount > 0 ? existingDiscount : ''}" placeholder="0" style="max-width: 200px" />
          <span class="field-hint">Applied automatically on the sales screen when this product is scanned or searched (multiplied by the quantity). Leave empty for no discount.</span>
        </div>

        ${wholesaleAllowed(isEdit ? product : null) ? wholesaleSectionHtml(isEdit ? product : null) : ''}
        `}

        <div class="form-row">
          <div class="field">
            <label for="p-taxrate">Tax rate (%)</label>
            <input class="input" id="p-taxrate" name="taxRate" type="number" step="0.01" min="0" max="100" value="${isEdit ? product.taxRate : 16}" />
          </div>
          ${wf ? '' : `<div class="field">
            <label for="p-unit">Unit</label>
            <select class="select" id="p-unit" name="unit">
              ${['piece', 'kg', 'g', 'litre', 'ml', 'metre', 'box', 'packet', 'service'].map((u) => `<option value="${u}" ${isEdit && product.unit === u ? 'selected' : ''}>${u}</option>`).join('')}
            </select>
          </div>`}
        </div>
        ${wf ? '' : `<div class="field">
          <label for="p-unitvalue">Size per item <span class="text-muted">(optional, in the unit above - e.g. 200 for a 200g pack)</span></label>
          <input class="input" id="p-unitvalue" name="unitValue" type="number" min="0" step="any" inputmode="decimal" value="${isEdit && product.unitValue > 0 ? product.unitValue : ''}" placeholder="e.g. 200" style="max-width: 200px" />
        </div>`}

        <div class="field">
          <label for="p-lowstock">Low stock threshold</label>
          <input class="input" id="p-lowstock" name="lowStockThreshold" type="number" min="0" value="${isEdit ? product.lowStockThreshold : 5}" style="max-width: 140px" />
        </div>

        <div class="field">
          <label>Tracking</label>
          <div class="flex gap-4" style="flex-wrap: wrap">
            <label class="checkbox-row"><input type="checkbox" name="trackInventory" ${!isEdit || product.trackInventory ? 'checked' : ''} /> <span class="text-sm">Track inventory</span></label>
            ${trackingOption('trackSerialNumber', 'Serial numbers', 'serialNumberTracking', isEdit && product.trackSerialNumber)}
            ${trackingOption('trackBatch', 'Batch tracking', 'batchTracking', isEdit && product.trackBatch)}
            ${trackingOption('trackExpiry', 'Expiry dates', 'expiryTracking', isEdit && product.trackExpiry)}
          </div>
        </div>

        ${!isEdit && canReceiveStock() ? `
        <div class="field" id="p-stock-section" style="border:1px solid var(--color-border, #e5e7eb);border-radius:var(--radius-md, 10px);padding:var(--space-3, 12px)">
          <label class="checkbox-row"><input type="checkbox" id="p-add-stock" /> <span class="text-sm"><strong>Add inventory now</strong> <span class="text-muted">(stock received)</span></span></label>
          <div id="p-stock-fields" style="display:none;margin-top:var(--space-3, 12px)">
            <div class="form-row">
              <div class="field"><label for="p-stock-qty">Quantity received</label><input class="input" id="p-stock-qty" type="number" min="1" step="any" inputmode="decimal" /></div>
              <div class="field"><label for="p-stock-batch">Batch number <span class="text-muted" id="p-stock-batch-opt">(optional)</span></label><input class="input" id="p-stock-batch" autocomplete="off" /></div>
            </div>
            <div class="field"><label for="p-stock-expiry">Expiry date <span class="text-muted" id="p-stock-exp-opt">(optional)</span></label><input class="input" id="p-stock-expiry" type="date" style="max-width:220px" /></div>
            <span class="field-hint" id="p-stock-hint">Stock is added to the current branch when the product is saved.</span>
          </div>
        </div>` : ''}

        <div class="field">
          <label for="p-description">Description <span class="text-muted">(optional)</span></label>
          <textarea class="textarea" id="p-description" name="description">${isEdit ? window.UI.escapeHtml(product.description || '') : ''}</textarea>
        </div>

        ${!isEdit && !wf ? `
        <div class="field">
          <label>Variants <span class="text-muted">(optional - leave empty for a simple product)</span></label>
          <div id="variants-container"></div>
          <button type="button" class="btn btn-secondary btn-sm" id="add-variant-row-btn">${window.Icons.get('plus')} Add variant</button>
        </div>
        ` : ''}
      </form>
    `;

    const modal = window.UI.openModal({
      title: isEdit ? 'Edit product' : 'Add product',
      bodyHtml,
      maxWidth: wf ? '720px' : '640px',
      footerHtml: `
        <button class="btn btn-secondary" data-action="cancel">Cancel</button>
        <button class="btn btn-primary" data-action="save" id="product-save-btn">${isEdit ? 'Save changes' : 'Add product'}</button>
      `,
    });

    modal.querySelector('[data-action="cancel"]').addEventListener('click', window.UI.closeModal);

    // Copy icon inside the Product name box: puts the name straight into the SKU box (and onto the clipboard too).
    const nameCopyBtn = modal.querySelector('#p-name-copy-btn');
    if (nameCopyBtn) {
      nameCopyBtn.addEventListener('click', () => {
        const nameInput = modal.querySelector('#p-name');
        const skuInput = modal.querySelector('#p-sku');
        const text = nameInput ? nameInput.value.trim() : '';
        if (!text) { window.UI.toast.error('Type the product name first'); if (nameInput) nameInput.focus(); return; }
        if (skuInput) {
          skuInput.value = text;
          skuInput.dispatchEvent(new Event('input', { bubbles: true }));
          skuInput.focus();
          skuInput.select();
        }
        try { if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).catch(() => {}); } catch { /* clipboard is optional */ }
        window.UI.toast.success('Name copied to SKU');
      });
    }

    // An expiry date is stored on a batch, so tracking expiry always means tracking batches too.
    const expiryBox = modal.querySelector('input[name="trackExpiry"]');
    const batchBox = modal.querySelector('input[name="trackBatch"]');
    if (expiryBox && batchBox) {
      const syncExpiryBatch = () => {
        if (expiryBox.checked) { batchBox.checked = true; batchBox.disabled = true; batchBox.title = 'Required while expiry dates are tracked'; }
        else { batchBox.disabled = false; batchBox.title = ''; }
      };
      expiryBox.addEventListener('change', syncExpiryBatch);
      syncExpiryBatch();
    }

    // Optional "Add inventory now" section (new products only).
    const stockToggle = modal.querySelector('#p-add-stock');
    if (stockToggle) {
      const stockFields = modal.querySelector('#p-stock-fields');
      const stockExp = modal.querySelector('#p-stock-expiry');
      const stockExpOpt = modal.querySelector('#p-stock-exp-opt');
      const syncStock = () => {
        const on = stockToggle.checked;
        const hasVariants = modal.querySelectorAll('.variant-row').length > 0;
        stockFields.style.display = on ? '' : 'none';
        const expiryOn = !!(expiryBox && expiryBox.checked);
        const tracked = !modal.querySelector('input[name="trackInventory"]') || modal.querySelector('input[name="trackInventory"]').checked;
        stockExp.required = on && expiryOn;
        stockExpOpt.textContent = expiryOn ? '(required)' : '(optional)';
        modal.querySelector('#p-stock-hint').textContent = hasVariants
          ? 'This product has variants - receive their stock from Inventory > Receive stock after saving.'
          : (tracked ? 'Stock is added to the current branch when the product is saved.' : 'Turn on "Track inventory" below so this stock counts.');
      };
      stockToggle.addEventListener('change', () => { syncStock(); if (stockToggle.checked) modal.querySelector('#p-stock-qty').focus(); });
      modal.querySelectorAll('input[name="trackExpiry"], input[name="trackBatch"], input[name="trackInventory"]').forEach((el) => el.addEventListener('change', syncStock));
      modal.addEventListener('click', (e) => { if (e.target.closest('#add-variant-row-btn, .variant-row')) setTimeout(syncStock, 0); });
      syncStock();
    }

    bindBarcodeScanButton(modal.querySelector('#p-barcode-scan-btn'), modal.querySelector('#p-barcode'));
    bindGenerateButton(modal.querySelector('#p-barcode-gen-btn'), modal.querySelector('#p-barcode'));
    bindBarcodeLiveCheck(modal.querySelector('#p-barcode'), modal, isEdit ? [product.barcode].concat((product.variants || []).map((v) => v.barcode)) : []);

    if (wf) window.WholesaleProductForm.bind(modal, { product: isEdit ? product : null });

    // "Also sell wholesale": the wholesale fields appear only while this box is ticked.
    const wsToggle = modal.querySelector('#p-wholesale-on');
    if (wsToggle) {
      const wsFields = modal.querySelector('#wholesale-fields');
      const syncWholesale = () => {
        const on = wsToggle.checked;
        if (wsFields) wsFields.style.display = on ? '' : 'none';
        ['#p-moq', '#p-wprice', '#p-wu-name', '#p-wu-factor'].forEach((q) => { const el = modal.querySelector(q); if (el) el.disabled = !on; });
      };
      wsToggle.addEventListener('change', () => {
        syncWholesale();
        if (wsToggle.checked) modal.querySelector('#p-moq').focus();
      });
      syncWholesale();
    }

    // The variants block does not exist in the wholesale-first form: a missing button must never abort the setup
    // (it used to throw here, so the Save listener below was never attached and "Add product" did nothing).
    const addVariantBtn = modal.querySelector('#add-variant-row-btn');
    if (!isEdit && addVariantBtn) {
      addVariantBtn.addEventListener('click', () => {
        const container = modal.querySelector('#variants-container');
        const idx = variantRowCount++;
        container.insertAdjacentHTML('beforeend', variantRowHtml(idx));
        const row = container.querySelector(`[data-idx="${idx}"]`);
        row.querySelector('[data-action="remove-variant-row"]').addEventListener('click', (e) => {
          e.target.closest('.variant-row').remove();
        });
        bindBarcodeScanButton(row.querySelector(`#v-barcode-scan-${idx}`), row.querySelector(`[name="v-barcode-${idx}"]`));
        bindGenerateButton(row.querySelector(`#v-barcode-gen-${idx}`), row.querySelector(`[name="v-barcode-${idx}"]`));
        bindBarcodeLiveCheck(row.querySelector(`[name="v-barcode-${idx}"]`), modal, []);
      });
    }

    modal.querySelector('[data-action="save"]').addEventListener('click', async () => {
      const form = modal.querySelector('#product-form');
      if (!form.reportValidity()) return;
      if (await barcodeBlocked(modal)) return;

      const raw = window.UI.serializeForm(form);

      // Wholesale-first form: validate + build the pricing / unit fields (the backend re-checks all of it).
      let wfRes = null;
      if (wf) {
        wfRes = window.WholesaleProductForm.collect(modal, { product: isEdit ? product : null });
        if (wfRes.error) {
          window.UI.toast.error(wfRes.error);
          if (wfRes.focus) wfRes.focus.focus();
          return;
        }
      }

      // Discount sanity check (the backend enforces the same rule). Skipped for
      // variant products, whose prices are per variant. serializeForm drops
      // empty fields, so an empty box means "no discount".
      const discountValue = Number(raw.defaultDiscount) || 0;
      const hasVariantRows = !isEdit && modal.querySelectorAll('.variant-row').length > 0;
      const priceValue = Number(raw.sellingPrice);
      if (discountValue > 0 && !hasVariantRows && Number.isFinite(priceValue) && discountValue > priceValue) {
        window.UI.toast.error('Discount per unit cannot be more than the selling price');
        modal.querySelector('#p-discount').focus();
        return;
      }

      // Wholesale (only when the section is shown). Mirrors the backend rules so the cashier gets a clear message.
      const wholesaleOn = !!(wsToggle && wsToggle.checked);
      const moqValue = Number(raw.moq) || 0;
      const wholesalePriceValue = Number(raw.wholesalePrice) || 0;
      if (wholesaleOn) {
        const variantsHere = hasVariantRows || (isEdit && product.hasVariants);
        if (!(moqValue > 0)) { window.UI.toast.error('Enter the minimum order quantity (MOQ) for wholesale'); modal.querySelector('#p-moq').focus(); return; }
        if (!variantsHere) {
          if (!(wholesalePriceValue > 0)) { window.UI.toast.error('Enter the wholesale price per unit'); modal.querySelector('#p-wprice').focus(); return; }
          if (Number.isFinite(priceValue) && wholesalePriceValue >= priceValue) { window.UI.toast.error('Wholesale price must be lower than the selling price'); modal.querySelector('#p-wprice').focus(); return; }
        }
      }

      // Optional opening stock (simple products only; variants are received from the Inventory page).
      let stockReq = null;
      const stockOn = !!modal.querySelector('#p-add-stock')?.checked && modal.querySelectorAll('.variant-row').length === 0;
      if (stockOn) {
        const qty = Number(modal.querySelector('#p-stock-qty').value);
        const batchNo = modal.querySelector('#p-stock-batch').value.trim();
        const expiry = modal.querySelector('#p-stock-expiry').value;
        if (!(qty > 0)) { window.UI.toast.error('Enter the quantity received'); modal.querySelector('#p-stock-qty').focus(); return; }
        if (raw.trackExpiry && !expiry) { window.UI.toast.error('Enter the expiry date for this product'); modal.querySelector('#p-stock-expiry').focus(); return; }
        if (raw.trackSerialNumber) { window.UI.toast.error('Serial-numbered products: receive stock from Inventory > Receive stock so each serial can be entered'); return; }
        if (!raw.trackInventory) { window.UI.toast.error('Turn on "Track inventory" to add stock'); return; }
        const branchId = window.AppShell.getActiveBranchId();
        if (!branchId) { window.UI.toast.error('Select a branch first'); return; }
        stockReq = { branchId, quantity: qty, batchNumber: batchNo || undefined, expiryDate: expiry || undefined, reason: 'Initial stock' };
      }

      const payload = {
        name: raw.name, sku: raw.sku, barcode: raw.barcode, categoryId: raw.categoryId || undefined,
        brand: raw.brand, costPrice: raw.costPrice, sellingPrice: raw.sellingPrice,
        // Always sent (0 when empty) so that clearing the box on an existing product removes the discount.
        defaultDiscount: discountValue,
        taxRate: raw.taxRate, unit: raw.unit, ...(wf ? {} : { unitValue: Number(raw.unitValue) || 0 }), lowStockThreshold: raw.lowStockThreshold,
        description: raw.description,
        trackInventory: !!raw.trackInventory, trackSerialNumber: !!raw.trackSerialNumber,
        trackBatch: !!raw.trackBatch || !!raw.trackExpiry, trackExpiry: !!raw.trackExpiry,
      };
      if (wfRes) {
        // Pricing, base unit and unit conversions come from the wholesale-first form; the discount box does not exist there.
        delete payload.costPrice; delete payload.sellingPrice; delete payload.unit;
        if (isEdit) delete payload.defaultDiscount;
        Object.assign(payload, wfRes.payload);
      }
      if (wsToggle && wholesaleOn && !isEdit) {
        const wuName = (raw.wuName || '').trim();
        const wuFactor = Number(raw.wuFactor) || 0;
        if (wuName || wuFactor) {
          if (!wuName || !(wuFactor > 1)) { window.UI.toast.error('Enter the pack name and how many items it holds (more than 1)'); modal.querySelector('#p-wu-name').focus(); return; }
          payload.units = [{ name: wuName, factor: wuFactor, isWholesaleDefault: true }];
        }
      }
      if (wsToggle) {
        payload.wholesaleEnabled = wholesaleOn;
        // When on: null clears an emptied price (e.g. variants carry their own). When off the saved values are left untouched.
        if (wholesaleOn) { payload.moq = moqValue; payload.wholesalePrice = wholesalePriceValue > 0 ? wholesalePriceValue : null; }
      }

      if (!isEdit) {
        const variantEls = modal.querySelectorAll('.variant-row');
        if (variantEls.length) {
          payload.variants = Array.from(variantEls).map((row) => {
            const idx = row.dataset.idx;
            return {
              sku: row.querySelector(`[name="v-sku-${idx}"]`).value,
              barcode: row.querySelector(`[name="v-barcode-${idx}"]`).value || undefined,
              attributes: parseAttributes(row.querySelector(`[name="v-attrs-${idx}"]`).value),
              sellingPrice: row.querySelector(`[name="v-price-${idx}"]`).value,
              wholesalePrice: row.querySelector(`[name="v-wprice-${idx}"]`)?.value || undefined,
              costPrice: raw.costPrice,
            };
          });
          delete payload.sellingPrice; // variants carry their own prices when present
        }
      }

      const btn = document.getElementById('product-save-btn');
      window.UI.setButtonLoading(btn, true, 'Saving…');

      try {
        // New product with no barcode: the system creates one (also for variants without a barcode).
        const generated = { main: false, variants: new Set() };
        if (!isEdit) {
          const used = await getUsedBarcodes();
          (payload.variants || []).forEach((v) => { if (v.barcode) used.add(String(v.barcode).trim()); });
          if (payload.barcode) used.add(String(payload.barcode).trim());
          if (payload.variants) {
            payload.variants.forEach((v, i) => { if (!v.barcode) { v.barcode = window.BarcodeLabels.generateCode(used); generated.variants.add(i); } });
            if (!payload.barcode) delete payload.barcode;
          } else if (!payload.barcode) {
            payload.barcode = window.BarcodeLabels.generateCode(used);
            generated.main = true;
          }
        }
        if (isEdit) {
          await window.Api.put(`/products/${product._id}`, payload);
          window.UI.toast.success('Product updated');
        } else {
          const created = await createProductWithRetry(payload, generated);
          window.UI.toast.success('Product added');
          if (stockReq) {
            if (created && created.queued) {
              window.UI.toast.warning('Saved offline. Add its stock from Inventory > Receive stock once it has uploaded.');
            } else {
              try {
                const pid = created?.data?.product?._id || created?.data?._id;
                if (!pid) throw new Error('product id missing');
                await window.Api.post('/inventory/receive', { ...stockReq, productId: pid, costPrice: (wfRes ? undefined : raw.costPrice) || undefined });
                window.UI.toast.success('Stock received');
              } catch (stockErr) {
                window.UI.toast.warning(`Product saved, but the stock was not added (${stockErr.message}). Use Inventory > Receive stock.`);
              }
            }
          }
          const printBox = modal.querySelector('#p-print-sticker');
          window.Storage.setPref('printStickerOnAdd', !!(printBox && printBox.checked));
          if (printBox && printBox.checked) {
            const copies = Math.min(500, Math.max(1, parseInt(modal.querySelector('#p-print-copies').value, 10) || 1));
            const stickerItems = payload.variants
              ? payload.variants.map((v) => {
                  const attrs = Object.values(v.attributes || {}).join(' / ');
                  return { name: attrs ? `${payload.name} (${attrs})` : payload.name, barcode: v.barcode, price: Number(v.sellingPrice) || 0, copies };
                })
              : [{ name: payload.name, barcode: payload.barcode, price: Number(wfRes ? wfRes.display.price : payload.sellingPrice) || 0, copies }];
            window.UI.closeModal();
            fetchAndRender();
            window.BarcodeLabels.printItems(stickerItems);
            return;
          }
        }
        window.UI.closeModal();
        fetchAndRender();
      } catch (err) {
        if (err.code === 'VALIDATION_ERROR' && err.errors?.length) {
          window.UI.applyFormErrors(form, err.errors);
          // Errors for fields without a form name (wholesale / retail / unit prices) have nowhere to render: say it.
          const unmatched = err.errors.filter((e) => !form.querySelector(`[name="${e.field}"]`));
          if (unmatched.length) window.UI.toast.error(unmatched.map((e) => e.message).slice(0, 2).join('. '));
        } else {
          window.UI.toast.error(err.message);
        }
      } finally {
        window.UI.setButtonLoading(btn, false);
      }
    });
  }

  /** Create a product; if a generated barcode was taken meanwhile (another till), generate a new one and retry. */
  async function createProductWithRetry(payload, generated) {
    for (let attempt = 0; ; attempt++) {
      try { return await window.Api.post('/products', payload); }
      catch (err) {
        const taken = /barcode/i.test(err.message || '') && /(exist|duplicate|already|taken|unique)/i.test(err.message || '');
        const anyGenerated = generated && (generated.main || generated.variants.size);
        if (!taken || attempt >= 2 || !anyGenerated) throw err;
        const used = await getUsedBarcodes(true);
        if (payload.variants) payload.variants.forEach((v, i) => { if (generated.variants.has(i)) v.barcode = window.BarcodeLabels.generateCode(used); });
        else if (generated.main) payload.barcode = window.BarcodeLabels.generateCode(used);
      }
    }
  }

  /* ------------------------------------------------------------------ *
   * Variants modal (for an existing product)
   * ------------------------------------------------------------------ */
  function openVariantsModal(product) {
    const modal = window.UI.openModal({
      title: `Variants - ${product.name}`,
      maxWidth: '600px',
      bodyHtml: `<div id="variants-list"></div>`,
      footerHtml: `<button class="btn btn-secondary" data-action="close">Close</button>`,
    });
    modal.querySelector('[data-action="close"]').addEventListener('click', () => { window.UI.closeModal(); fetchAndRender(); });

    renderVariantsList(modal, product);
  }

  function renderVariantsList(modal, product) {
    const listEl = modal.querySelector('#variants-list');
    listEl.innerHTML = `
      <div class="table-wrap" style="margin-bottom: var(--space-4)">
        <table class="table">
          <thead><tr><th>SKU</th><th>Attributes</th><th>Price</th>${wholesaleAllowed(product) ? '<th>Wholesale</th>' : ''}<th>Status</th><th></th></tr></thead>
          <tbody>
            ${product.variants.map((v) => `
              <tr data-id="${v._id}">
                <td class="text-sm">${window.UI.escapeHtml(v.sku)}</td>
                <td class="text-sm">${window.UI.escapeHtml(variantAttrsText(v))}</td>
                <td>
                  <input class="input" style="width:110px; height:34px" data-variant-price="${v._id}" type="number" step="0.01" min="0" value="${v.sellingPrice}" />
                </td>
                ${wholesaleAllowed(product) ? `<td>
                  <input class="input" style="width:110px; height:34px" data-variant-wprice="${v._id}" type="number" step="0.01" min="0" value="${v.wholesalePrice || ''}" placeholder="${product.wholesalePrice || '-'}" title="Empty = use the product's wholesale price" />
                </td>` : ''}
                <td><span class="badge ${v.status === 'active' ? 'badge-success' : 'badge-neutral'}">${v.status}</span></td>
                <td class="actions">
                  <button class="btn btn-ghost btn-sm btn-icon" data-action="save-variant" title="Save price">${window.Icons.get('check')}</button>
                  <button class="btn btn-ghost btn-sm btn-icon" data-action="archive-variant" title="Archive">${window.Icons.get('trash')}</button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
      <form id="add-variant-form">
        <div class="form-row">
          <div class="field"><label>SKU</label><input class="input" name="sku" required /></div>
          <div class="field"><label>Attributes</label><input class="input" name="attrsText" placeholder="Size: L, Color: Red" /></div>
        </div>
        <div class="form-row">
          <div class="field">
            <label>Barcode <span class="text-muted">(optional)</span></label>
            <div class="input-button-row">
              <input class="input" name="barcode" placeholder="Scan, type or Generate" />
              ${scanButtonHtml('add-variant-barcode-scan-btn')}
              ${generateButtonHtml('add-variant-barcode-gen-btn')}
            </div>
          </div>
          <div class="field"><label>Selling price (KES)</label><input class="input" name="sellingPrice" type="number" step="0.01" min="0" required /></div>
        </div>
        ${wholesaleAllowed(product) ? `<div class="field"><label>Wholesale price (KES) <span class="text-muted">(optional)</span></label><input class="input" name="wholesalePrice" type="number" step="0.01" min="0" style="max-width:200px" /></div>` : ''}
        <button type="submit" class="btn btn-primary btn-sm">${window.Icons.get('plus')} Add variant</button>
      </form>
    `;

    bindBarcodeScanButton(listEl.querySelector('#add-variant-barcode-scan-btn'), listEl.querySelector('#add-variant-form [name="barcode"]'));
    bindGenerateButton(listEl.querySelector('#add-variant-barcode-gen-btn'), listEl.querySelector('#add-variant-form [name="barcode"]'));
    bindBarcodeLiveCheck(listEl.querySelector('#add-variant-form [name="barcode"]'), listEl.querySelector('#add-variant-form'), []);

    listEl.querySelectorAll('[data-action="save-variant"]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.closest('tr').dataset.id;
        const price = listEl.querySelector(`[data-variant-price="${id}"]`).value;
        const wEl = listEl.querySelector(`[data-variant-wprice="${id}"]`);
        const body = { sellingPrice: price };
        if (wEl) body.wholesalePrice = wEl.value === '' ? null : wEl.value; // null clears it (falls back to the product's)
        try {
          await window.Api.put(`/products/${product._id}/variants/${id}`, body);
          window.UI.toast.success('Variant updated');
        } catch (err) {
          window.UI.toast.error(err.message);
        }
      });
    });

    listEl.querySelectorAll('[data-action="archive-variant"]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.closest('tr').dataset.id;
        const ok = await window.UI.confirmDialog({ title: 'Archive variant?', confirmText: 'Archive', danger: true });
        if (!ok) return;
        try {
          await window.Api.delete(`/products/${product._id}/variants/${id}`);
          const { data } = await window.Api.get(`/products/${product._id}`);
          renderVariantsList(modal, data.product);
        } catch (err) {
          window.UI.toast.error(err.message);
        }
      });
    });

    listEl.querySelector('#add-variant-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const form = e.target;
      if (await barcodeBlocked(form)) return;
      const raw = window.UI.serializeForm(form);
      try {
        if (!raw.barcode) raw.barcode = window.BarcodeLabels.generateCode(await getUsedBarcodes()); // no barcode typed: create one
        await window.Api.post(`/products/${product._id}/variants`, {
          sku: raw.sku,
          barcode: raw.barcode || undefined,
          attributes: parseAttributes(raw.attrsText),
          sellingPrice: raw.sellingPrice,
          wholesalePrice: raw.wholesalePrice || undefined,
        });
        window.UI.toast.success('Variant added');
        const { data } = await window.Api.get(`/products/${product._id}`);
        renderVariantsList(modal, data.product);
      } catch (err) {
        if (err.code === 'VALIDATION_ERROR' && err.errors?.length) {
          window.UI.applyFormErrors(form, err.errors);
        } else {
          window.UI.toast.error(err.message);
        }
      }
    });
  }

  function variantAttrsText(variant) {
    if (!variant.attributes) return '—';
    const entries = Object.entries(variant.attributes);
    return entries.length ? entries.map(([k, v]) => `${k}: ${v}`).join(', ') : '—';
  }
})();