/**
 * product-picker.js
 * ProductPicker.open({ onSelect }) opens a search modal listing products
 * (and their variants, one row each) and calls onSelect({ type, product,
 * variant }) when the user picks one. Any page that needs "search for a
 * product and pick it" (inventory receive/adjust/transfer, and later the
 * sales screen) uses this instead of building its own search UI.
 *
 * Barcode scanning: if js/core/barcode-scanner.js is loaded on the page,
 * a "Scan" button appears next to the search field for camera scanning,
 * and pressing Enter after a hardware scanner types a code into the
 * search box does an exact barcode lookup before falling back to the
 * normal fuzzy search.
 */
(function (window) {
  function variantLabel(variant) {
    if (!variant?.attributes) return '';
    const entries = Object.entries(variant.attributes);
    return entries.map(([k, v]) => `${k}: ${v}`).join(', ');
  }

  function rowHtml(product, variant) {
    const label = variant ? `${product.name} <span class="text-muted">(${window.UI.escapeHtml(variantLabel(variant))})</span>` : window.UI.escapeHtml(product.name);
    const sku = variant ? variant.sku : product.sku;
    const price = variant ? variant.sellingPrice : product.sellingPrice;
    return `
      <button type="button" class="product-picker-row" data-product-id="${product._id}" data-variant-id="${variant ? variant._id : ''}"
        style="display:flex; align-items:center; justify-content:space-between; width:100%; text-align:left; padding: var(--space-3);
               border:none; border-bottom:1px solid var(--color-border); background:none; cursor:pointer;">
        <span>
          <div class="text-sm font-semibold">${label}</div>
          <div class="text-xs text-muted">${window.UI.escapeHtml(sku)}</div>
        </span>
        <span class="text-sm font-semibold">${window.UI.formatMoney(price)}</span>
      </button>
    `;
  }

  async function search(term) {
    const { data } = await window.Api.get('/products', { search: term, limit: 20, status: 'active' });
    return data.items;
  }

  async function lookupBarcode(code) {
    const { data } = await window.Api.get(`/products/barcode/${encodeURIComponent(code.trim())}`);
    return data; // { type, product, variant }
  }

  function open({ title = 'Select a product', onSelect } = {}) {
    const modal = window.UI.openModal({
      title,
      bodyHtml: `
        <div class="field" style="margin-bottom: var(--space-3)">
          <div class="input-button-row">
            <div class="input-group" style="flex:1">
              <span class="input-group-icon">${window.Icons.get('search')}</span>
              <input class="input" id="picker-search" type="text" placeholder="Search by name, SKU, or barcode" autofocus />
            </div>
            ${window.BarcodeScanner ? `<button type="button" class="btn btn-secondary btn-icon" id="picker-scan-btn" title="Scan barcode">${window.BarcodeScanner.cameraIconSvg}</button>` : ''}
          </div>
        </div>
        <div id="picker-results" style="max-height: 360px; overflow-y: auto; border:1px solid var(--color-border); border-radius: var(--radius-md)"></div>
      `,
    });

    const resultsEl = modal.querySelector('#picker-results');
    const searchInput = modal.querySelector('#picker-search');

    async function runSearch(term) {
      resultsEl.innerHTML = `<div style="padding: var(--space-4)">${window.UI.skeletonRows(1, 3)}</div>`;
      try {
        const items = await search(term);
        renderResults(items);
      } catch (err) {
        resultsEl.innerHTML = window.UI.emptyStateHtml({ icon: 'alert', title: 'Search failed', message: err.message });
      }
    }

    function renderResults(items) {
      if (!items.length) {
        resultsEl.innerHTML = window.UI.emptyStateHtml({ icon: 'products', title: 'No products found' });
        return;
      }

      const rows = [];
      items.forEach((product) => {
        if (product.variants?.length) {
          product.variants.forEach((v) => rows.push(rowHtml(product, v)));
        } else {
          rows.push(rowHtml(product, null));
        }
      });
      resultsEl.innerHTML = rows.join('');

      resultsEl.querySelectorAll('.product-picker-row').forEach((row) => {
        row.addEventListener('click', () => {
          const productId = row.dataset.productId;
          const variantId = row.dataset.variantId || null;
          const product = items.find((p) => p._id === productId);
          const variant = variantId ? product.variants.find((v) => v._id === variantId) : null;
          window.UI.closeModal();
          onSelect({ product, variant });
        });
      });
    }

    searchInput.addEventListener('input', window.UI.debounce((e) => runSearch(e.target.value.trim()), 300));

    // A hardware scanner types the barcode into this input (it has focus
    // already) and ends with Enter - try an exact match first so one scan
    // is enough, and only fall back to the fuzzy list if there isn't one.
    searchInput.addEventListener('keydown', async (e) => {
      if (e.key !== 'Enter') return;
      const term = searchInput.value.trim();
      if (!term) return;
      try {
        const data = await lookupBarcode(term);
        window.UI.closeModal();
        onSelect({ product: data.product, variant: data.variant });
      } catch {
        // no exact barcode match for this text - the live fuzzy search
        // triggered by the same keystrokes already covers it
      }
    });

    modal.querySelector('#picker-scan-btn')?.addEventListener('click', () => {
      window.BarcodeScanner.openCameraModal({
        title: 'Scan product barcode',
        onDetect: async (code) => {
          try {
            const data = await lookupBarcode(code);
            window.UI.closeModal();
            onSelect({ product: data.product, variant: data.variant });
          } catch (err) {
            window.UI.toast.error(err.code === 'BARCODE_NOT_FOUND' ? `No product found for barcode "${code}"` : err.message);
            searchInput.value = code;
            runSearch(code);
          }
        },
      });
    });

    runSearch('');
  }

  window.ProductPicker = { open };
})(window);