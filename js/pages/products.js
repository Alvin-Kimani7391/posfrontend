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
 *
 * DISCOUNT PER UNIT: each product can carry a standing per-unit discount
 * (field "defaultDiscount", KES). The sales screen pre-fills it on the
 * cart line whenever the product is scanned or searched (x quantity).
 */
(function () {
  const state = { page: 1, limit: 10, search: '', categoryId: '', status: '' };
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
    await fetchAndRender();
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
          <button class="btn btn-primary" id="add-product-btn" data-requires-permission="products.create">
            ${window.Icons.get('plus')} Add product
          </button>
        </div>
      </div>

      <div class="card">
        <div class="toolbar">
          <div class="toolbar-search input-group">
            <span class="input-group-icon">${window.Icons.get('search')}</span>
            <input class="input" id="search-input" type="text" placeholder="Search by name, SKU, or barcode" />
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

    document.getElementById('add-product-btn').addEventListener('click', () => openProductModal());
    window.AppShell.runUrlAction?.('add-product-btn'); // opened from the setup guide
    document.getElementById('manage-categories-btn').addEventListener('click', openCategoriesModal);

    document.getElementById('search-input').addEventListener('input', window.UI.debounce((e) => {
      state.search = e.target.value.trim();
      state.page = 1;
      fetchAndRender();
    }));

    document.getElementById('category-filter').addEventListener('change', (e) => {
      state.categoryId = e.target.value;
      state.page = 1;
      fetchAndRender();
    });
  }

  /* ------------------------------------------------------------------ *
   * List + table
   * ------------------------------------------------------------------ */
  async function fetchAndRender() {
    const tbody = document.getElementById('products-tbody');
    tbody.innerHTML = window.UI.skeletonRows(7, 4);

    try {
      const { data } = await window.Api.get('/products', {
        page: state.page, limit: state.limit, search: state.search, categoryId: state.categoryId,
      });
      renderRows(data.items);
      window.UI.renderPagination(document.getElementById('pagination'), data, (p) => { state.page = p; fetchAndRender(); });
      window.Permissions.applyPermissionGates(contentEl, window.AppShell.getUser());
    } catch (err) {
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
          <div class="cell-primary">${window.UI.escapeHtml(p.name)}</div>
          ${p.hasVariants ? `<div class="text-xs text-muted">${p.variants.length} variant${p.variants.length === 1 ? '' : 's'}</div>` : ''}
        </td>
        <td>
          <div class="text-sm">${window.UI.escapeHtml(p.sku)}</div>
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
        const { data } = await window.Api.get(`/products/${id}`);
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
    return window.AppShell.hasFeature('wholesalePricing') || !!(product && product.wholesaleEnabled);
  }

  function wholesaleSectionHtml(product) {
    const on = !!(product && product.wholesaleEnabled);
    const hasVariants = !!(product && product.hasVariants);
    return `
        <div class="field" id="wholesale-section" style="border:1px solid var(--color-border); border-radius: var(--radius-md); padding: var(--space-3)">
          <label class="checkbox-row"><input type="checkbox" name="wholesaleEnabled" id="p-wholesale-on" ${on ? 'checked' : ''} /> <span class="text-sm font-semibold">Also sell wholesale</span></label>
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
          <input class="input" id="p-name" name="name" required value="${isEdit ? window.UI.escapeHtml(product.name) : ''}" placeholder="Samsung 43&quot; Smart TV" />
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

    bindBarcodeScanButton(modal.querySelector('#p-barcode-scan-btn'), modal.querySelector('#p-barcode'));
    bindGenerateButton(modal.querySelector('#p-barcode-gen-btn'), modal.querySelector('#p-barcode'));

    if (wf) window.WholesaleProductForm.bind(modal, { product: isEdit ? product : null });

    const wsToggle = modal.querySelector('#p-wholesale-on');
    if (wsToggle) {
      wsToggle.addEventListener('change', () => {
        modal.querySelector('#p-moq').disabled = !wsToggle.checked;
        modal.querySelector('#p-wprice').disabled = !wsToggle.checked;
        if (wsToggle.checked) modal.querySelector('#p-moq').focus();
      });
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
      });
    }

    modal.querySelector('[data-action="save"]').addEventListener('click', async () => {
      const form = modal.querySelector('#product-form');
      if (!form.reportValidity()) return;

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

      const payload = {
        name: raw.name, sku: raw.sku, barcode: raw.barcode, categoryId: raw.categoryId || undefined,
        brand: raw.brand, costPrice: raw.costPrice, sellingPrice: raw.sellingPrice,
        // Always sent (0 when empty) so that clearing the box on an existing product removes the discount.
        defaultDiscount: discountValue,
        taxRate: raw.taxRate, unit: raw.unit, lowStockThreshold: raw.lowStockThreshold,
        description: raw.description,
        trackInventory: !!raw.trackInventory, trackSerialNumber: !!raw.trackSerialNumber,
        trackBatch: !!raw.trackBatch, trackExpiry: !!raw.trackExpiry,
      };
      if (wfRes) {
        // Pricing, base unit and unit conversions come from the wholesale-first form; the discount box does not exist there.
        delete payload.costPrice; delete payload.sellingPrice; delete payload.unit;
        if (isEdit) delete payload.defaultDiscount;
        Object.assign(payload, wfRes.payload);
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
          await createProductWithRetry(payload, generated);
          window.UI.toast.success('Product added');
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