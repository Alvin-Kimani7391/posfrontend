/**
 * products.js
 * Covers Products, Categories, and Variants - all backed by
 * /api/v1/products and /api/v1/categories. Categories and per-product
 * variant management open as modals from this same page rather than
 * getting their own nav entries, since they're both small, closely
 * related surfaces rather than destinations on their own.
 */
(function () {
  const state = { page: 1, limit: 10, search: '', categoryId: '', status: '' };
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
        <div class="table-wrap">
          <table class="table">
            <thead>
              <tr>
                <th>Product</th>
                <th>SKU / Barcode</th>
                <th>Category</th>
                <th>Price</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody id="products-tbody">${window.UI.skeletonRows(6, 4)}</tbody>
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

  function categoryOptionsHtml(selectedId) {
    return '<option value="">No category</option>' +
      categoriesCache.map((c) => `<option value="${c._id}" ${c._id === selectedId ? 'selected' : ''}>${window.UI.escapeHtml(c.name)}</option>`).join('');
  }

  function bindToolbar() {
    document.getElementById('add-product-btn').addEventListener('click', () => openProductModal());
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
    tbody.innerHTML = window.UI.skeletonRows(6, 4);

    try {
      const { data } = await window.Api.get('/products', {
        page: state.page, limit: state.limit, search: state.search, categoryId: state.categoryId,
      });
      renderRows(data.items);
      window.UI.renderPagination(document.getElementById('pagination'), data, (p) => { state.page = p; fetchAndRender(); });
      window.Permissions.applyPermissionGates(contentEl, window.AppShell.getUser());
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="6">${window.UI.emptyStateHtml({ icon: 'alert', title: 'Could not load products', message: err.message })}</td></tr>`;
    }
  }

  function renderRows(items) {
    const tbody = document.getElementById('products-tbody');

    if (!items.length) {
      tbody.innerHTML = `<tr><td colspan="6">${window.UI.emptyStateHtml({
        icon: 'products',
        title: state.search || state.categoryId ? 'No products match your filters' : 'No products yet',
        message: state.search || state.categoryId ? '' : 'Add your first product to start building your catalog.',
      })}</td></tr>`;
      return;
    }

    tbody.innerHTML = items.map((p) => `
      <tr data-id="${p._id}">
        <td>
          <div class="cell-primary">${window.UI.escapeHtml(p.name)}</div>
          ${p.hasVariants ? `<div class="text-xs text-muted">${p.variants.length} variant${p.variants.length === 1 ? '' : 's'}</div>` : ''}
        </td>
        <td>
          <div class="text-sm">${window.UI.escapeHtml(p.sku)}</div>
          ${p.barcode ? `<div class="text-xs text-muted">${window.UI.escapeHtml(p.barcode)}</div>` : ''}
        </td>
        <td class="text-sm">${p.categoryId ? window.UI.escapeHtml(p.categoryId.name) : '<span class="text-muted">Uncategorized</span>'}</td>
        <td class="cell-primary">${p.hasVariants ? 'Varies' : window.UI.formatMoney(p.sellingPrice)}</td>
        <td><span class="badge ${p.status === 'active' ? 'badge-success' : 'badge-neutral'}">${p.status}</span></td>
        <td class="actions">
          ${p.hasVariants ? `<button class="btn btn-ghost btn-sm btn-icon" data-action="variants" data-requires-permission="products.update" title="Manage variants">${window.Icons.get('box')}</button>` : ''}
          <button class="btn btn-ghost btn-sm btn-icon" data-action="edit" data-requires-permission="products.update" title="Edit">${window.Icons.get('edit')}</button>
          <button class="btn btn-ghost btn-sm btn-icon" data-action="archive" data-requires-permission="products.delete" title="Archive">${window.Icons.get('trash')}</button>
        </td>
      </tr>
    `).join('');

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
              <input class="input" name="v-barcode-${idx}" placeholder="Scan or type" />
              ${scanButtonHtml(`v-barcode-scan-${idx}`)}
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
              <input class="input" id="p-barcode" name="barcode" value="${isEdit ? window.UI.escapeHtml(product.barcode || '') : ''}" placeholder="Scan or type a barcode" />
              ${scanButtonHtml('p-barcode-scan-btn')}
            </div>
          </div>
        </div>
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

        <div class="form-row">
          <div class="field">
            <label for="p-taxrate">Tax rate (%)</label>
            <input class="input" id="p-taxrate" name="taxRate" type="number" step="0.01" min="0" max="100" value="${isEdit ? product.taxRate : 16}" />
          </div>
          <div class="field">
            <label for="p-unit">Unit</label>
            <select class="select" id="p-unit" name="unit">
              ${['piece', 'kg', 'g', 'litre', 'ml', 'metre', 'box', 'packet', 'service'].map((u) => `<option value="${u}" ${isEdit && product.unit === u ? 'selected' : ''}>${u}</option>`).join('')}
            </select>
          </div>
        </div>

        <div class="field">
          <label for="p-lowstock">Low stock threshold</label>
          <input class="input" id="p-lowstock" name="lowStockThreshold" type="number" min="0" value="${isEdit ? product.lowStockThreshold : 5}" style="max-width: 140px" />
        </div>

        <div class="field">
          <label>Tracking</label>
          <div class="flex gap-4" style="flex-wrap: wrap">
            <label class="checkbox-row"><input type="checkbox" name="trackInventory" ${!isEdit || product.trackInventory ? 'checked' : ''} /> <span class="text-sm">Track inventory</span></label>
            <label class="checkbox-row"><input type="checkbox" name="trackSerialNumber" ${isEdit && product.trackSerialNumber ? 'checked' : ''} /> <span class="text-sm">Serial numbers</span></label>
            <label class="checkbox-row"><input type="checkbox" name="trackBatch" ${isEdit && product.trackBatch ? 'checked' : ''} /> <span class="text-sm">Batch tracking</span></label>
            <label class="checkbox-row"><input type="checkbox" name="trackExpiry" ${isEdit && product.trackExpiry ? 'checked' : ''} /> <span class="text-sm">Expiry dates</span></label>
          </div>
        </div>

        <div class="field">
          <label for="p-description">Description <span class="text-muted">(optional)</span></label>
          <textarea class="textarea" id="p-description" name="description">${isEdit ? window.UI.escapeHtml(product.description || '') : ''}</textarea>
        </div>

        ${!isEdit ? `
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
      maxWidth: '640px',
      footerHtml: `
        <button class="btn btn-secondary" data-action="cancel">Cancel</button>
        <button class="btn btn-primary" data-action="save" id="product-save-btn">${isEdit ? 'Save changes' : 'Add product'}</button>
      `,
    });

    modal.querySelector('[data-action="cancel"]').addEventListener('click', window.UI.closeModal);

    bindBarcodeScanButton(modal.querySelector('#p-barcode-scan-btn'), modal.querySelector('#p-barcode'));

    if (!isEdit) {
      modal.querySelector('#add-variant-row-btn').addEventListener('click', () => {
        const container = modal.querySelector('#variants-container');
        const idx = variantRowCount++;
        container.insertAdjacentHTML('beforeend', variantRowHtml(idx));
        const row = container.querySelector(`[data-idx="${idx}"]`);
        row.querySelector('[data-action="remove-variant-row"]').addEventListener('click', (e) => {
          e.target.closest('.variant-row').remove();
        });
        bindBarcodeScanButton(row.querySelector(`#v-barcode-scan-${idx}`), row.querySelector(`[name="v-barcode-${idx}"]`));
      });
    }

    modal.querySelector('[data-action="save"]').addEventListener('click', async () => {
      const form = modal.querySelector('#product-form');
      if (!form.reportValidity()) return;

      const raw = window.UI.serializeForm(form);
      const payload = {
        name: raw.name, sku: raw.sku, barcode: raw.barcode, categoryId: raw.categoryId || undefined,
        brand: raw.brand, costPrice: raw.costPrice, sellingPrice: raw.sellingPrice,
        taxRate: raw.taxRate, unit: raw.unit, lowStockThreshold: raw.lowStockThreshold,
        description: raw.description,
        trackInventory: !!raw.trackInventory, trackSerialNumber: !!raw.trackSerialNumber,
        trackBatch: !!raw.trackBatch, trackExpiry: !!raw.trackExpiry,
      };

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
              costPrice: raw.costPrice,
            };
          });
          delete payload.sellingPrice; // variants carry their own prices when present
        }
      }

      const btn = document.getElementById('product-save-btn');
      window.UI.setButtonLoading(btn, true, 'Saving…');

      try {
        if (isEdit) {
          await window.Api.put(`/products/${product._id}`, payload);
          window.UI.toast.success('Product updated');
        } else {
          await window.Api.post('/products', payload);
          window.UI.toast.success('Product added');
        }
        window.UI.closeModal();
        fetchAndRender();
      } catch (err) {
        if (err.code === 'VALIDATION_ERROR' && err.errors?.length) {
          window.UI.applyFormErrors(form, err.errors);
        } else {
          window.UI.toast.error(err.message);
        }
      } finally {
        window.UI.setButtonLoading(btn, false);
      }
    });
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
          <thead><tr><th>SKU</th><th>Attributes</th><th>Price</th><th>Status</th><th></th></tr></thead>
          <tbody>
            ${product.variants.map((v) => `
              <tr data-id="${v._id}">
                <td class="text-sm">${window.UI.escapeHtml(v.sku)}</td>
                <td class="text-sm">${window.UI.escapeHtml(variantAttrsText(v))}</td>
                <td>
                  <input class="input" style="width:110px; height:34px" data-variant-price="${v._id}" type="number" step="0.01" min="0" value="${v.sellingPrice}" />
                </td>
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
              <input class="input" name="barcode" placeholder="Scan or type" />
              ${scanButtonHtml('add-variant-barcode-scan-btn')}
            </div>
          </div>
          <div class="field"><label>Selling price (KES)</label><input class="input" name="sellingPrice" type="number" step="0.01" min="0" required /></div>
        </div>
        <button type="submit" class="btn btn-primary btn-sm">${window.Icons.get('plus')} Add variant</button>
      </form>
    `;

    bindBarcodeScanButton(listEl.querySelector('#add-variant-barcode-scan-btn'), listEl.querySelector('#add-variant-form [name="barcode"]'));

    listEl.querySelectorAll('[data-action="save-variant"]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.closest('tr').dataset.id;
        const price = listEl.querySelector(`[data-variant-price="${id}"]`).value;
        try {
          await window.Api.put(`/products/${product._id}/variants/${id}`, { sellingPrice: price });
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
        await window.Api.post(`/products/${product._id}/variants`, {
          sku: raw.sku,
          barcode: raw.barcode || undefined,
          attributes: parseAttributes(raw.attrsText),
          sellingPrice: raw.sellingPrice,
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