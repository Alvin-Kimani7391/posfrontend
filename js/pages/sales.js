/**
 * sales.js
 * Two views sharing one page: "New Sale" (the actual POS - product search,
 * cart, payments, checkout) and "Sales History" (list + detail, what an
 * owner/manager uses to review what's been sold). A shift banner sits above
 * both since it affects whether a cash sale can even be rung up.
 *
 * PRICING NOTE: everything shown while building the cart (line totals, tax,
 * grand total) is a CLIENT-SIDE PREVIEW ONLY, computed with a hard-coded
 * tax-inclusive assumption because the cashier role isn't granted
 * settings.view and so can't fetch the business's real tax configuration.
 * The moment "Complete Sale" is pressed, the backend recomputes every
 * number from the authoritative Product/ProductVariant records and its own
 * tax settings - that response, not this preview, is what actually gets
 * charged and printed on the receipt.
 *
 * BARCODE SCANNING: the "New sale" view supports two scan paths (see
 * js/core/barcode-scanner.js) that both funnel into handleScannedCode():
 *   - A hardware/Bluetooth scanner (keyboard-wedge) is picked up globally
 *     while this view is active, so the cashier doesn't need to click into
 *     the search box first.
 *   - Tapping "Scan barcode" opens the camera viewfinder (phone or webcam).
 * Either way, an exact match adds straight to the cart via the existing
 * GET /products/barcode/:barcode lookup - no manual search needed.
 *
 * M-PESA STK PUSH: when the business has M-PESA enabled (state.flags.mpesaEnabled,
 * fetched alongside the shift), the payment modal offers a "Send prompt"
 * flow instead of a free-text reference field. The reference used on the
 * eventual payment line is NEVER typed by the cashier - it only gets set
 * (modal.dataset.mpesaReference) once GET /payments/mpesa/:reference/status
 * confirms SUCCESS. The backend re-verifies this same reference against a
 * server-side MpesaTransaction when the sale is finalized, so a cashier
 * can't fabricate a fake M-PESA payment even if they tamper with the request.
 */
(function () {
  const MPESA_FAILURE_LABELS = {
    wrong_pin: 'Wrong PIN entered',
    insufficient_funds: 'Insufficient M-PESA balance',
    cancelled: 'Cancelled by customer',
    timeout: 'No response in time',
    in_progress: 'Another request already pending',
    system_error: 'M-PESA system error',
    bad_credentials: 'M-PESA not configured correctly',
    rate_limited: 'Too many requests - try again shortly',
    wallet_empty: 'PayHero wallet is empty',
    send_failed: 'Could not reach M-PESA',
    failed: 'Payment failed',
  };

  const state = {
    view: 'new-sale',
    cart: [], // { product, variant, quantity, discount, overridePriceEnabled, overridePrice }
    customer: null,
    cartDiscount: 0,
    payments: [], // { method, amount, reference, amountTendered }
    currentShift: null,
    flags: { mpesaEnabled: false, etimsEnabled: false },
    history: { page: 1, limit: 10, search: '', from: '', to: '' },
  };
  let contentEl;
  let checkoutKey = window.Api.newIdempotencyKey();
  let unsubscribeBranchChange = null;
  let hardwareScannerUnsub = null;

  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    contentEl = window.AppShell.mount({ title: 'Sales' });
    if (!contentEl) return;

    contentEl.innerHTML = pageSkeleton();
    bindTabs();
    await Promise.all([loadShift(), renderNewSaleView()]);

    unsubscribeBranchChange = window.AppShell.onBranchChange(async () => {
      await loadShift();
      if (state.view === 'new-sale') renderNewSaleView();
      else renderHistory();
    });
    window.addEventListener('beforeunload', () => {
      unsubscribeBranchChange?.();
      detachHardwareScanner();
    });
  }

  function pageSkeleton() {
    return `
      <div class="page-header">
        <div>
          <h1>Sales</h1>
          <p>Ring up sales and review what's been sold.</p>
        </div>
      </div>
      <div id="shift-banner"></div>
      <div class="tabs" style="margin-bottom: var(--space-4)">
        <button class="tab-btn active" data-view="new-sale">New sale</button>
        <button class="tab-btn" data-view="history" data-requires-permission="sales.view">Sales history</button>
      </div>
      <div id="view-body"></div>
    `;
  }

  function bindTabs() {
    document.querySelectorAll('.tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        state.view = btn.dataset.view;
        if (state.view === 'new-sale') {
          renderNewSaleView();
        } else {
          detachHardwareScanner(); // scanning only makes sense while ringing up a sale
          renderHistory();
        }
      });
    });
    window.Permissions.applyPermissionGates(contentEl, window.AppShell.getUser());
  }

  /* ================================================================== *
   * Barcode scanning (shared by hardware scanner + camera scan button)
   * ================================================================== */
  function attachHardwareScanner() {
    hardwareScannerUnsub?.();
    if (!window.BarcodeScanner) return;
    hardwareScannerUnsub = window.BarcodeScanner.listenHardwareScanner(handleScannedCode);
  }

  function detachHardwareScanner() {
    hardwareScannerUnsub?.();
    hardwareScannerUnsub = null;
  }

  async function handleScannedCode(code) {
    if (!code) return;
    // Don't hijack a scan while some other modal (payment, discount,
    // customer picker...) is open and legitimately expects its own input.
    if (document.querySelector('.modal-backdrop')) return;

    try {
      const { data } = await window.Api.get(`/products/barcode/${encodeURIComponent(code.trim())}`);
      addToCart(data.product, data.variant);
      const label = data.variant
        ? `${data.product.name} (${Object.values(data.variant.attributes || {}).join(', ')})`
        : data.product.name;
      window.UI.toast.success(`${label} added`);
    } catch (err) {
      window.UI.toast.error(err.code === 'BARCODE_NOT_FOUND' ? `No product found for barcode "${code}"` : err.message);
    }

    const searchInput = document.getElementById('pos-search');
    const resultsEl = document.getElementById('pos-search-results');
    if (searchInput) searchInput.value = '';
    if (resultsEl) resultsEl.innerHTML = '<p class="text-sm text-muted" style="padding: var(--space-3)">Start typing to search your catalog.</p>';
  }

  /* ================================================================== *
   * Shift banner (+ integration flags, fetched alongside it)
   * ================================================================== */
  async function loadShift() {
    const branchId = window.AppShell.getActiveBranchId();
    if (!branchId) return;

    const [shiftResult, flagsResult] = await Promise.allSettled([
      window.Api.get('/shifts/current', { branchId }),
      window.Api.get('/settings/integrations/flags'),
    ]);

    state.currentShift = shiftResult.status === 'fulfilled' ? shiftResult.value.data.shift : null;
    // Default to disabled rather than throw - a role without payments.view
    // (shouldn't happen for anyone who can reach this page, but stay safe)
    // just won't see the M-PESA/eTIMS options.
    state.flags = flagsResult.status === 'fulfilled' ? flagsResult.value.data : { mpesaEnabled: false, etimsEnabled: false };

    renderShiftBanner();
  }

  function renderShiftBanner() {
    const el = document.getElementById('shift-banner');
    if (!el) return;

    if (state.currentShift) {
      el.innerHTML = `
        <div class="shift-banner open">
          <span>${window.Icons.get('check')} Shift open since ${window.UI.formatDateTime(state.currentShift.openedAt)} - ${window.UI.escapeHtml(state.currentShift.registerId?.name || 'Register')}</span>
          <button class="btn btn-secondary btn-sm" id="close-shift-btn" data-requires-permission="shifts.close">Close shift</button>
        </div>
      `;
      el.querySelector('#close-shift-btn').addEventListener('click', openCloseShiftModal);
    } else {
      el.innerHTML = `
        <div class="shift-banner closed">
          <span>${window.Icons.get('alert')} No open shift - open one before taking cash payments</span>
          <button class="btn btn-primary btn-sm" id="open-shift-btn" data-requires-permission="shifts.open">Open shift</button>
        </div>
      `;
      el.querySelector('#open-shift-btn').addEventListener('click', openOpenShiftModal);
    }
    window.Permissions.applyPermissionGates(el, window.AppShell.getUser());
  }

  async function openOpenShiftModal() {
    const branchId = window.AppShell.getActiveBranchId();
    let registers = [];
    try {
      const { data } = await window.Api.get('/registers', { branchId });
      registers = data.registers;
    } catch (err) {
      window.UI.toast.error(err.message);
      return;
    }

    if (!registers.length) {
      const canManage = window.Permissions.can(window.AppShell.getUser(), 'registers.manage');
      const modal = window.UI.openModal({
        title: 'No registers set up',
        bodyHtml: `<p class="text-sm text-secondary">${canManage ? 'Create a cash register for this branch first.' : 'Ask your manager to set up a cash register for this branch first.'}</p>`,
        footerHtml: canManage
          ? `<button class="btn btn-secondary" data-action="close">Close</button><button class="btn btn-primary" data-action="create">Create register</button>`
          : `<button class="btn btn-secondary" data-action="close">Close</button>`,
      });
      modal.querySelector('[data-action="close"]').addEventListener('click', window.UI.closeModal);
      modal.querySelector('[data-action="create"]')?.addEventListener('click', () => {
        window.UI.closeModal();
        openCreateRegisterModal(() => openOpenShiftModal());
      });
      return;
    }

    const modal = window.UI.openModal({
      title: 'Open shift',
      bodyHtml: `
        <form id="open-shift-form">
          <div class="field">
            <label>Register</label>
            <select class="select" name="registerId" required>${registers.map((r) => `<option value="${r._id}">${window.UI.escapeHtml(r.name)} (${window.UI.escapeHtml(r.code)})</option>`).join('')}</select>
          </div>
          <div class="field">
            <label>Opening cash float (KES)</label>
            <input class="input" name="openingCash" type="number" step="0.01" min="0" required value="0" />
          </div>
        </form>
      `,
      footerHtml: `<button class="btn btn-secondary" data-action="cancel">Cancel</button><button class="btn btn-primary" data-action="save" id="open-shift-save">Open shift</button>`,
    });

    modal.querySelector('[data-action="cancel"]').addEventListener('click', window.UI.closeModal);
    modal.querySelector('[data-action="save"]').addEventListener('click', async () => {
      const form = modal.querySelector('#open-shift-form');
      if (!form.reportValidity()) return;
      const raw = window.UI.serializeForm(form);
      const btn = document.getElementById('open-shift-save');
      window.UI.setButtonLoading(btn, true, 'Opening…');
      try {
        await window.Api.post('/shifts/open', { branchId, registerId: raw.registerId, openingCash: raw.openingCash });
        window.UI.toast.success('Shift opened');
        window.UI.closeModal();
        loadShift();
      } catch (err) {
        window.UI.toast.error(err.message);
      } finally {
        window.UI.setButtonLoading(btn, false);
      }
    });
  }

  function openCreateRegisterModal(onDone) {
    const branchId = window.AppShell.getActiveBranchId();
    const modal = window.UI.openModal({
      title: 'New cash register',
      bodyHtml: `
        <form id="register-form">
          <div class="field"><label>Name</label><input class="input" name="name" required placeholder="Till 1" /></div>
          <div class="field"><label>Code</label><input class="input" name="code" required maxlength="10" placeholder="TILL1" /></div>
        </form>
      `,
      footerHtml: `<button class="btn btn-secondary" data-action="cancel">Cancel</button><button class="btn btn-primary" data-action="save">Create</button>`,
    });
    modal.querySelector('[data-action="cancel"]').addEventListener('click', window.UI.closeModal);
    modal.querySelector('[data-action="save"]').addEventListener('click', async () => {
      const form = modal.querySelector('#register-form');
      if (!form.reportValidity()) return;
      const raw = window.UI.serializeForm(form);
      try {
        await window.Api.post('/registers', { branchId, name: raw.name, code: raw.code });
        window.UI.toast.success('Register created');
        window.UI.closeModal();
        onDone?.();
      } catch (err) {
        window.UI.toast.error(err.message);
      }
    });
  }

  function openCloseShiftModal() {
    const modal = window.UI.openModal({
      title: 'Close shift',
      bodyHtml: `
        <form id="close-shift-form">
          <p class="text-sm text-secondary" style="margin-bottom: var(--space-4)">Count the cash in the drawer and enter it below. The system will calculate the expected amount and show any difference.</p>
          <div class="field"><label>Actual cash counted (KES)</label><input class="input" name="actualCash" type="number" step="0.01" min="0" required /></div>
          <div class="field"><label>Notes <span class="text-muted">(optional)</span></label><textarea class="textarea" name="notes"></textarea></div>
        </form>
      `,
      footerHtml: `<button class="btn btn-secondary" data-action="cancel">Cancel</button><button class="btn btn-danger" data-action="save" id="close-shift-save">Close shift</button>`,
    });

    modal.querySelector('[data-action="cancel"]').addEventListener('click', window.UI.closeModal);
    modal.querySelector('[data-action="save"]').addEventListener('click', async () => {
      const form = modal.querySelector('#close-shift-form');
      if (!form.reportValidity()) return;
      const raw = window.UI.serializeForm(form);
      const btn = document.getElementById('close-shift-save');
      window.UI.setButtonLoading(btn, true, 'Closing…');
      try {
        const { data } = await window.Api.post(`/shifts/${state.currentShift._id}/close`, { actualCash: raw.actualCash, notes: raw.notes });
        window.UI.closeModal();
        showShiftSummary(data.shift);
        loadShift();
      } catch (err) {
        window.UI.toast.error(err.message);
      } finally {
        window.UI.setButtonLoading(btn, false);
      }
    });
  }

  function showShiftSummary(shift) {
    const diff = shift.cashDifference;
    const modal = window.UI.openModal({
      title: 'Shift summary',
      bodyHtml: `
        <div class="pos-totals-row"><span>Opening float</span><span>${window.UI.formatMoney(shift.openingCash)}</span></div>
        <div class="pos-totals-row"><span>Expected cash</span><span>${window.UI.formatMoney(shift.expectedCash)}</span></div>
        <div class="pos-totals-row"><span>Actual cash counted</span><span>${window.UI.formatMoney(shift.actualCash)}</span></div>
        <div class="pos-totals-row grand" style="color:${diff === 0 ? 'var(--color-success)' : 'var(--color-danger)'}">
          <span>${diff === 0 ? 'Balanced' : diff > 0 ? 'Over' : 'Short'}</span><span>${window.UI.formatMoney(Math.abs(diff))}</span>
        </div>
      `,
      footerHtml: `<button class="btn btn-primary" data-action="close">Done</button>`,
    });
    modal.querySelector('[data-action="close"]').addEventListener('click', window.UI.closeModal);
  }

  /* ================================================================== *
   * NEW SALE VIEW
   * ================================================================== */
  function renderNewSaleView() {
    const body = document.getElementById('view-body');
    body.innerHTML = `
      <div class="pos-layout">
        <div class="card">
          <div class="card-body">
            ${window.BarcodeScanner ? `
            <div class="pos-scan-row">
              <button type="button" class="btn btn-primary btn-block" id="pos-scan-btn">
                ${window.BarcodeScanner.cameraIconSvg} Scan barcode
              </button>
              <p class="text-xs text-muted pos-scan-hint">Tap to scan with your camera, or use a connected barcode scanner - it's picked up automatically.</p>
            </div>
            ` : ''}
            <div class="field" style="margin-bottom: var(--space-3)">
              <div class="input-group">
                <span class="input-group-icon">${window.Icons.get('search')}</span>
                <input class="input" id="pos-search" type="text" placeholder="Search products by name, SKU, or barcode" autofocus />
              </div>
            </div>
            <div class="pos-search-results" id="pos-search-results"></div>
          </div>
        </div>

        <div class="card pos-cart-panel">
          <div class="card-header">
            <h3>Cart</h3>
            <button class="btn btn-ghost btn-sm" id="clear-cart-btn">Clear</button>
          </div>
          <div class="card-body" id="cart-body"></div>
        </div>
      </div>
    `;

    bindProductSearch();
    bindScanButton();
    renderCart();
    document.getElementById('clear-cart-btn').addEventListener('click', async () => {
      if (!state.cart.length) return;
      const ok = await window.UI.confirmDialog({ title: 'Clear cart?', confirmText: 'Clear', danger: true });
      if (ok) resetCart();
    });

    attachHardwareScanner();
  }

  function bindScanButton() {
    document.getElementById('pos-scan-btn')?.addEventListener('click', () => {
      window.BarcodeScanner.openCameraModal({
        title: 'Scan product barcode',
        onDetect: (code) => handleScannedCode(code),
      });
    });
  }

  function bindProductSearch() {
    const input = document.getElementById('pos-search');
    const resultsEl = document.getElementById('pos-search-results');

    async function runSearch(term) {
      if (!term) { resultsEl.innerHTML = '<p class="text-sm text-muted" style="padding: var(--space-3)">Start typing to search your catalog.</p>'; return; }
      resultsEl.innerHTML = window.UI.skeletonRows(1, 4);
      try {
        const { data } = await window.Api.get('/products', { search: term, limit: 20, status: 'active' });
        renderSearchResults(data.items);
      } catch (err) {
        resultsEl.innerHTML = window.UI.emptyStateHtml({ icon: 'alert', title: 'Search failed', message: err.message });
      }
    }

    function renderSearchResults(items) {
      if (!items.length) {
        resultsEl.innerHTML = window.UI.emptyStateHtml({ icon: 'products', title: 'No products found' });
        return;
      }
      const rows = [];
      items.forEach((product) => {
        if (product.variants?.length) {
          product.variants.forEach((v) => rows.push({ product, variant: v }));
        } else {
          rows.push({ product, variant: null });
        }
      });
      resultsEl.innerHTML = rows.map((r, i) => `
        <div class="pos-product-card" data-idx="${i}">
          <span>
            <div class="font-semibold text-sm">${window.UI.escapeHtml(r.product.name)}${r.variant ? ` <span class="text-muted">(${Object.values(r.variant.attributes || {}).join(', ')})</span>` : ''}</div>
            <div class="text-xs text-muted">${window.UI.escapeHtml(r.variant ? r.variant.sku : r.product.sku)}</div>
          </span>
          <span class="font-semibold">${window.UI.formatMoney(r.variant ? r.variant.sellingPrice : r.product.sellingPrice)}</span>
        </div>
      `).join('');
      resultsEl.querySelectorAll('.pos-product-card').forEach((card) => {
        card.addEventListener('click', () => {
          const r = rows[Number(card.dataset.idx)];
          addToCart(r.product, r.variant);
        });
      });
    }

    input.addEventListener('input', window.UI.debounce((e) => runSearch(e.target.value.trim()), 300));
    runSearch('');
  }

  /* ---- Cart operations ---- */
  function addToCart(product, variant) {
    const key = variant ? variant._id : product._id;
    const existing = state.cart.find((i) => (i.variant ? i.variant._id : i.product._id) === key);
    if (existing) {
      existing.quantity += 1;
    } else {
      state.cart.push({ product, variant, quantity: 1, discount: 0, overridePriceEnabled: false, overridePrice: null });
    }
    renderCart();
  }

  function round2(n) { return Math.round(n * 100) / 100; }

  /** Client-side preview only - see the file header note. */
  function previewLine(unitPrice, qty, discount, taxRate) {
    const gross = round2(unitPrice * qty);
    const net = round2(gross - (discount || 0));
    const tax = round2(net - net / (1 + (taxRate || 0) / 100));
    return { gross, net, tax, total: net };
  }

  function renderCart() {
    const el = document.getElementById('cart-body');
    if (!el) return;

    if (!state.cart.length) {
      el.innerHTML = window.UI.emptyStateHtml({ icon: 'sales', title: 'Cart is empty', message: 'Search or scan a product to add it.' });
      return;
    }

    let subtotal = 0, tax = 0, itemDiscountTotal = 0;
    const lines = state.cart.map((item) => {
      const unitPrice = item.overridePriceEnabled && item.overridePrice != null ? item.overridePrice : (item.variant ? item.variant.sellingPrice : item.product.sellingPrice);
      const preview = previewLine(unitPrice, item.quantity, item.discount, item.product.taxRate);
      subtotal += preview.gross;
      tax += preview.tax;
      itemDiscountTotal += item.discount || 0;
      return { item, unitPrice, preview };
    });
    const total = round2(subtotal - itemDiscountTotal - (state.cartDiscount || 0));
    const paidSoFar = round2(state.payments.reduce((s, p) => s + p.amount, 0));
    const balance = round2(total - paidSoFar);

    el.innerHTML = `
      <div id="cart-items"></div>
      <div style="margin: var(--space-3) 0">
        <button class="btn btn-secondary btn-sm btn-block" id="pick-customer-btn">
          ${window.Icons.get('employees')} ${state.customer ? window.UI.escapeHtml(state.customer.name) : 'Walk-in customer (add one for credit)'}
        </button>
      </div>
      <div class="field" style="margin-bottom: var(--space-3)">
        <label class="text-xs">Cart discount (KES)</label>
        <input class="input" id="cart-discount-input" type="number" step="0.01" min="0" value="${state.cartDiscount || ''}" placeholder="0" />
      </div>

      <div class="pos-totals-row"><span>Subtotal</span><span>${window.UI.formatMoney(subtotal)}</span></div>
      ${itemDiscountTotal ? `<div class="pos-totals-row"><span>Item discounts</span><span>-${window.UI.formatMoney(itemDiscountTotal)}</span></div>` : ''}
      ${state.cartDiscount ? `<div class="pos-totals-row"><span>Cart discount</span><span>-${window.UI.formatMoney(state.cartDiscount)}</span></div>` : ''}
      <div class="pos-totals-row"><span>Tax (est.)</span><span>${window.UI.formatMoney(tax)}</span></div>
      <div class="pos-totals-row grand"><span>Total</span><span>${window.UI.formatMoney(total)}</span></div>

      <div style="margin-top: var(--space-4)">
        <div class="flex items-center justify-between" style="margin-bottom: var(--space-2)">
          <label class="text-xs font-semibold">Payments</label>
          <button class="btn btn-ghost btn-sm" id="add-payment-btn">${window.Icons.get('plus')} Add payment</button>
        </div>
        <div id="payments-list"></div>
        <div class="pos-totals-row"><span>Paid</span><span>${window.UI.formatMoney(paidSoFar)}</span></div>
        <div class="pos-totals-row" style="color: ${balance > 0 ? 'var(--color-warning)' : 'var(--color-text)'}"><span>Balance${balance > 0 ? ' (credit)' : ''}</span><span>${window.UI.formatMoney(Math.max(balance, 0))}</span></div>
      </div>

      <button class="btn btn-primary btn-block btn-lg" id="checkout-btn" style="margin-top: var(--space-4)">
        Complete sale - ${window.UI.formatMoney(total)}
      </button>
    `;

    renderCartItems(lines);
    renderPaymentsList();

    document.getElementById('cart-discount-input').addEventListener('change', (e) => {
      state.cartDiscount = Number(e.target.value) || 0;
      renderCart();
    });
    document.getElementById('pick-customer-btn').addEventListener('click', () => {
      window.CustomerPicker.open({ onSelect: (customer) => { state.customer = customer; renderCart(); } });
    });
    document.getElementById('add-payment-btn').addEventListener('click', () => openAddPaymentModal(balance > 0 ? balance : total));
    document.getElementById('checkout-btn').addEventListener('click', checkout);
  }

  function renderCartItems(lines) {
    const el = document.getElementById('cart-items');
    el.innerHTML = lines.map(({ item, unitPrice, preview }, i) => `
      <div class="pos-cart-item">
        <span style="flex:1">
          <div class="font-semibold text-sm">${window.UI.escapeHtml(item.product.name)}${item.variant ? ` <span class="text-muted">(${Object.values(item.variant.attributes || {}).join(', ')})</span>` : ''}</div>
          <div class="text-xs text-muted">${window.UI.formatMoney(unitPrice)} each${item.discount ? ` &middot; -${window.UI.formatMoney(item.discount)}` : ''}</div>
          <div class="pos-qty-control" style="margin-top: var(--space-2)">
            <button type="button" data-action="dec" data-idx="${i}">-</button>
            <span class="text-sm" style="min-width:20px; text-align:center">${item.quantity}</span>
            <button type="button" data-action="inc" data-idx="${i}">+</button>
            <button type="button" class="btn btn-ghost btn-sm" data-action="discount" data-idx="${i}" style="height:26px">Discount</button>
          </div>
        </span>
        <span class="flex flex-col items-end gap-1">
          <span class="font-semibold text-sm">${window.UI.formatMoney(preview.total)}</span>
          <button type="button" class="btn btn-ghost btn-sm btn-icon" data-action="remove" data-idx="${i}">${window.Icons.get('trash')}</button>
        </span>
      </div>
    `).join('');

    el.querySelectorAll('[data-action="inc"]').forEach((b) => b.addEventListener('click', () => { state.cart[Number(b.dataset.idx)].quantity += 1; renderCart(); }));
    el.querySelectorAll('[data-action="dec"]').forEach((b) => b.addEventListener('click', () => {
      const idx = Number(b.dataset.idx);
      state.cart[idx].quantity -= 1;
      if (state.cart[idx].quantity <= 0) state.cart.splice(idx, 1);
      renderCart();
    }));
    el.querySelectorAll('[data-action="remove"]').forEach((b) => b.addEventListener('click', () => { state.cart.splice(Number(b.dataset.idx), 1); renderCart(); }));
    el.querySelectorAll('[data-action="discount"]').forEach((b) => b.addEventListener('click', () => openLineDiscountModal(Number(b.dataset.idx))));
  }

  function openLineDiscountModal(idx) {
    const item = state.cart[idx];
    const user = window.AppShell.getUser();
    const canOverride = window.Permissions.can(user, 'sales.price_override');

    const modal = window.UI.openModal({
      title: `Adjust - ${item.product.name}`,
      bodyHtml: `
        <form id="line-adjust-form">
          <div class="field"><label>Discount (KES)</label><input class="input" name="discount" type="number" step="0.01" min="0" value="${item.discount || ''}" placeholder="0" /></div>
          ${canOverride ? `
            <div class="checkbox-row" style="margin-bottom: var(--space-2)">
              <input type="checkbox" id="override-toggle" ${item.overridePriceEnabled ? 'checked' : ''} />
              <label for="override-toggle" class="text-sm">Override price</label>
            </div>
            <div class="field"><label>Override price (KES)</label><input class="input" name="overridePrice" type="number" step="0.01" min="0" value="${item.overridePrice || ''}" ${item.overridePriceEnabled ? '' : 'disabled'} /></div>
          ` : '<p class="text-xs text-muted">You do not have permission to override prices.</p>'}
        </form>
      `,
      footerHtml: `<button class="btn btn-secondary" data-action="cancel">Cancel</button><button class="btn btn-primary" data-action="save">Apply</button>`,
    });

    if (canOverride) {
      const toggle = modal.querySelector('#override-toggle');
      const priceInput = modal.querySelector('[name="overridePrice"]');
      toggle.addEventListener('change', () => { priceInput.disabled = !toggle.checked; });
    }

    modal.querySelector('[data-action="cancel"]').addEventListener('click', window.UI.closeModal);
    modal.querySelector('[data-action="save"]').addEventListener('click', () => {
      const raw = window.UI.serializeForm(modal.querySelector('#line-adjust-form'));
      item.discount = Number(raw.discount) || 0;
      if (canOverride) {
        item.overridePriceEnabled = !!raw.overridePrice && modal.querySelector('#override-toggle').checked;
        item.overridePrice = item.overridePriceEnabled ? Number(raw.overridePrice) : null;
      }
      window.UI.closeModal();
      renderCart();
    });
  }

  function renderPaymentsList() {
    const el = document.getElementById('payments-list');
    if (!state.payments.length) {
      el.innerHTML = '<p class="text-xs text-muted">No payments added - sale will be fully on credit (requires a customer).</p>';
      return;
    }
    el.innerHTML = state.payments.map((p, i) => `
      <div class="flex items-center justify-between text-sm" style="padding: 4px 0">
        <span>${window.UI.escapeHtml(p.method)}${p.reference ? ` <span class="text-muted">(${window.UI.escapeHtml(p.reference)})</span>` : ''}</span>
        <span class="flex items-center gap-2">
          ${window.UI.formatMoney(p.amount)}
          <button type="button" class="btn btn-ghost btn-sm btn-icon" data-remove-payment="${i}">${window.Icons.get('close')}</button>
        </span>
      </div>
    `).join('');
    el.querySelectorAll('[data-remove-payment]').forEach((b) => b.addEventListener('click', () => { state.payments.splice(Number(b.dataset.removePayment), 1); renderCart(); }));
  }

  /* ---- M-PESA STK status panel (used inside the payment modal) ---- */
  function renderMpesaStatus(modal, viewState, data = {}) {
    const el = modal.querySelector('#mpesa-stk-status');
    if (!el) return;
    const toneClass = { pending: 'badge-info', error: 'badge-danger', warning: 'badge-warning', success: 'badge-success' }[viewState.tone] || 'badge-neutral';
    el.innerHTML = `
      <div style="display:flex; gap:var(--space-2); align-items:flex-start; padding:var(--space-3); border-radius:var(--radius-md); background:var(--color-bg)">
        <span class="badge ${toneClass}">${window.UI.escapeHtml(viewState.label)}</span>
        <span class="text-sm text-secondary" style="flex:1">${window.UI.escapeHtml(viewState.message)}</span>
      </div>
      ${viewState.retry ? `<button type="button" class="btn btn-secondary btn-sm" id="mpesa-retry-btn" style="margin-top:var(--space-2)">Try again</button>` : ''}
    `;
    modal.querySelector('#mpesa-retry-btn')?.addEventListener('click', () => modal.querySelector('#mpesa-send-btn').click());
  }

  function clearMpesaPolling(modal) {
    if (modal._mpesaPoll) {
      clearInterval(modal._mpesaPoll);
      modal._mpesaPoll = null;
    }
  }

  function bindMpesaSend(modal) {
    modal.querySelector('#mpesa-send-btn').addEventListener('click', async () => {
      const phone = modal.querySelector('[name="mpesaPhone"]').value.trim();
      const amount = Number(modal.querySelector('[name="amount"]').value);
      if (!phone || !amount) return window.UI.toast.error('Enter a phone number and amount first');

      delete modal.dataset.mpesaReference;
      clearMpesaPolling(modal);

      const sendBtn = modal.querySelector('#mpesa-send-btn');
      window.UI.setButtonLoading(sendBtn, true, 'Sending…');
      renderMpesaStatus(modal, { tone: 'pending', label: 'Sending', message: 'Sending prompt to customer\u2019s phone…' });

      try {
        const { data } = await window.Api.post('/payments/mpesa/stk', {
          branchId: window.AppShell.getActiveBranchId(), phone, amountCents: Math.round(amount * 100),
        });
        const reference = data.reference;
        renderMpesaStatus(modal, { tone: 'pending', label: 'Waiting', message: 'Ask the customer to enter their M-PESA PIN on their phone.' });

        modal._mpesaPoll = setInterval(async () => {
          let s;
          try {
            ({ data: s } = await window.Api.get(`/payments/mpesa/${reference}/status`));
          } catch {
            return; // transient network hiccup - keep polling
          }
          if (s.status === 'SUCCESS') {
            clearMpesaPolling(modal);
            modal.dataset.mpesaReference = reference;
            renderMpesaStatus(modal, { tone: 'success', label: 'Confirmed', message: s.message });
            window.UI.toast.success('M-PESA payment confirmed');
          } else if (s.status === 'FAILED') {
            clearMpesaPolling(modal);
            const label = MPESA_FAILURE_LABELS[s.failureType] || 'Payment failed';
            renderMpesaStatus(modal, { tone: s.failureType === 'timeout' ? 'warning' : 'error', label, message: s.message, retry: true });
            window.UI.toast.error(label);
          }
        }, 3000);
      } catch (err) {
        // Send-time failure (bad credentials, rate-limited, wallet empty,
        // network) - err.data.failureType comes straight from mpesa.controller.js.
        const failureType = err.data?.failureType;
        const label = MPESA_FAILURE_LABELS[failureType] || 'Could not send prompt';
        renderMpesaStatus(modal, { tone: 'error', label, message: err.message, retry: true });
        window.UI.toast.error(err.message);
      } finally {
        window.UI.setButtonLoading(sendBtn, false);
      }
    });
  }

  function openAddPaymentModal(suggestedAmount) {
    const mpesaFieldHtml = state.flags.mpesaEnabled ? `
      <div class="field" id="mpesa-stk-field" style="display:none">
        <label>Customer phone (M-PESA)</label>
        <div class="input-button-row">
          <input class="input" name="mpesaPhone" placeholder="07XXXXXXXX" />
          <button type="button" class="btn btn-secondary" id="mpesa-send-btn">Send prompt</button>
        </div>
        <div id="mpesa-stk-status" style="margin-top: var(--space-3)"></div>
      </div>
    ` : '';

    const modal = window.UI.openModal({
      title: 'Add payment',
      bodyHtml: `
        <form id="payment-form">
          <div class="field">
            <label>Method</label>
            <select class="select" name="method" id="payment-method">
              <option value="CASH">Cash</option>
              <option value="MPESA">M-PESA</option>
              <option value="CARD">Card</option>
              <option value="BANK">Bank transfer</option>
              <option value="OTHER">Other</option>
            </select>
          </div>
          <div class="field"><label>Amount (KES)</label><input class="input" name="amount" type="number" step="0.01" min="0.01" required value="${suggestedAmount > 0 ? suggestedAmount : ''}" /></div>
          <div class="field" id="tendered-field"><label>Amount tendered (KES) <span class="text-muted">(for change)</span></label><input class="input" name="amountTendered" type="number" step="0.01" min="0" /></div>
          <div class="field" id="reference-field" style="display:none"><label>Reference / code</label><input class="input" name="reference" placeholder="Till number, transaction code, etc" /></div>
          ${mpesaFieldHtml}
        </form>
      `,
      footerHtml: `<button class="btn btn-secondary" data-action="cancel">Cancel</button><button class="btn btn-primary" data-action="save">Add</button>`,
    });

    const methodSelect = modal.querySelector('#payment-method');
    const toggleFields = () => {
      const isCash = methodSelect.value === 'CASH';
      const isMpesa = methodSelect.value === 'MPESA';
      modal.querySelector('#tendered-field').style.display = isCash ? '' : 'none';
      modal.querySelector('#reference-field').style.display = isCash || isMpesa ? 'none' : '';
      const mpesaField = modal.querySelector('#mpesa-stk-field');
      if (mpesaField) mpesaField.style.display = isMpesa ? '' : 'none';
    };
    methodSelect.addEventListener('change', toggleFields);
    toggleFields();

    if (state.flags.mpesaEnabled) bindMpesaSend(modal);

    modal.querySelector('[data-action="cancel"]').addEventListener('click', () => {
      clearMpesaPolling(modal);
      window.UI.closeModal();
    });
    modal.querySelector('[data-action="save"]').addEventListener('click', () => {
      const form = modal.querySelector('#payment-form');
      if (!form.reportValidity()) return;
      const raw = window.UI.serializeForm(form);

      if (raw.method === 'MPESA') {
        if (!modal.dataset.mpesaReference) {
          return window.UI.toast.error('Wait for the M-PESA payment to be confirmed first');
        }
        clearMpesaPolling(modal);
        state.payments.push({ method: 'MPESA', amount: Number(raw.amount), reference: modal.dataset.mpesaReference });
        window.UI.closeModal();
        renderCart();
        return;
      }

      state.payments.push({
        method: raw.method,
        amount: Number(raw.amount),
        reference: raw.reference,
        amountTendered: raw.amountTendered ? Number(raw.amountTendered) : undefined,
      });
      window.UI.closeModal();
      renderCart();
    });
  }

  function resetCart() {
    state.cart = [];
    state.customer = null;
    state.cartDiscount = 0;
    state.payments = [];
    checkoutKey = window.Api.newIdempotencyKey();
    renderCart();
  }

  async function checkout() {
    if (!state.cart.length) return window.UI.toast.error('Cart is empty');

    const branchId = window.AppShell.getActiveBranchId();
    const payload = {
      branchId,
      customerId: state.customer?._id,
      cartDiscount: state.cartDiscount || 0,
      items: state.cart.map((item) => ({
        productId: item.product._id,
        variantId: item.variant?._id,
        quantity: item.quantity,
        discount: item.discount || 0,
        overridePrice: item.overridePriceEnabled ? item.overridePrice : undefined,
      })),
      payments: state.payments.map((p) => ({
        method: p.method, amount: p.amount, reference: p.reference,
        amountTendered: p.method === 'CASH' ? p.amountTendered : undefined,
      })),
    };

    const btn = document.getElementById('checkout-btn');
    window.UI.setButtonLoading(btn, true, 'Completing sale…');
    try {
      const { data } = await window.Api.post('/sales', payload, { idempotencyKey: checkoutKey });
      window.UI.toast.success(`Sale ${data.sale.receiptNumber} completed`);
      window.ReceiptView.showReceiptModal(data.receipt);
      resetCart();
      loadShift();
    } catch (err) {
      window.UI.toast.error(err.message);
    } finally {
      window.UI.setButtonLoading(btn, false);
    }
  }

  /* ================================================================== *
   * SALES HISTORY VIEW
   * ================================================================== */
  function renderHistory() {
    const body = document.getElementById('view-body');
    body.innerHTML = `
      <div class="card">
        <div class="toolbar">
          <div class="toolbar-search input-group">
            <span class="input-group-icon">${window.Icons.get('search')}</span>
            <input class="input" id="history-search" type="text" placeholder="Search by receipt number" />
          </div>
          <div class="flex gap-2">
            <input class="input" id="history-from" type="date" style="max-width:160px" />
            <input class="input" id="history-to" type="date" style="max-width:160px" />
          </div>
        </div>
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>Receipt</th><th>Date</th><th>Cashier</th><th>Customer</th><th>Total</th><th>Status</th><th></th></tr></thead>
            <tbody id="history-tbody">${window.UI.skeletonRows(7, 6)}</tbody>
          </table>
        </div>
        <div class="pagination" id="history-pagination"></div>
      </div>
    `;

    document.getElementById('history-search').addEventListener('input', window.UI.debounce((e) => {
      state.history.search = e.target.value.trim(); state.history.page = 1; fetchHistory();
    }));
    document.getElementById('history-from').addEventListener('change', (e) => { state.history.from = e.target.value; state.history.page = 1; fetchHistory(); });
    document.getElementById('history-to').addEventListener('change', (e) => { state.history.to = e.target.value; state.history.page = 1; fetchHistory(); });

    fetchHistory();
  }

  const PAYMENT_BADGE = { PAID: 'badge-success', PARTIAL: 'badge-warning', CREDIT: 'badge-danger', UNPAID: 'badge-neutral' };

  async function fetchHistory() {
    const tbody = document.getElementById('history-tbody');
    tbody.innerHTML = window.UI.skeletonRows(7, 6);

    const branchId = window.AppShell.getActiveBranchId();
    try {
      const { data } = await window.Api.get('/sales', {
        branchId, page: state.history.page, limit: state.history.limit, search: state.history.search,
        from: state.history.from || undefined, to: state.history.to || undefined,
      });
      if (!data.items.length) {
        tbody.innerHTML = `<tr><td colspan="7">${window.UI.emptyStateHtml({ icon: 'sales', title: 'No sales found' })}</td></tr>`;
      } else {
        tbody.innerHTML = data.items.map((s) => `
          <tr data-id="${s._id}">
            <td class="cell-primary">${s.receiptNumber}</td>
            <td class="text-sm">${window.UI.formatDateTime(s.createdAt)}</td>
            <td class="text-sm">${window.UI.escapeHtml(s.cashierId?.name || '')}</td>
            <td class="text-sm">${s.customerId ? window.UI.escapeHtml(s.customerId.name) : '<span class="text-muted">Walk-in</span>'}</td>
            <td class="font-semibold">${window.UI.formatMoney(s.total)}</td>
            <td>
              <span class="badge ${PAYMENT_BADGE[s.paymentStatus] || 'badge-neutral'}">${s.paymentStatus}</span>
              ${s.saleStatus === 'CANCELLED' ? '<span class="badge badge-neutral">Cancelled</span>' : ''}
            </td>
            <td class="actions"><button class="btn btn-secondary btn-sm" data-action="view">View</button></td>
          </tr>
        `).join('');
      }
      window.UI.renderPagination(document.getElementById('history-pagination'), data, (p) => { state.history.page = p; fetchHistory(); });

      tbody.querySelectorAll('[data-action="view"]').forEach((btn) => {
        btn.addEventListener('click', () => openSaleDetail(btn.closest('tr').dataset.id));
      });
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="7">${window.UI.emptyStateHtml({ icon: 'alert', title: 'Could not load sales', message: err.message })}</td></tr>`;
    }
  }

  async function openSaleDetail(id) {
    let data;
    try {
      ({ data } = await window.Api.get(`/sales/${id}`));
    } catch (err) {
      return window.UI.toast.error(err.message);
    }

    const { sale, receipt } = data;
    const user = window.AppShell.getUser();
    const canCancel = sale.saleStatus === 'COMPLETED' && window.Permissions.can(user, 'sales.cancel');
    const hasRefundableItems = sale.items.some((i) => i.quantity - i.refundedQuantity > 0);
    const canRefund = sale.saleStatus === 'COMPLETED' && hasRefundableItems && window.Permissions.can(user, 'refunds.create');

    const modal = window.UI.openModal({
      title: `Sale ${sale.receiptNumber}`,
      maxWidth: '520px',
      bodyHtml: `
        <div class="text-sm text-secondary" style="margin-bottom: var(--space-3)">
          ${window.UI.formatDateTime(sale.createdAt)} &middot; Cashier: ${window.UI.escapeHtml(sale.cashierId?.name || '')}
          ${sale.customerId ? ` &middot; Customer: ${window.UI.escapeHtml(sale.customerId.name)}` : ''}
        </div>
        <div class="table-wrap" style="margin-bottom: var(--space-4)">
          <table class="table">
            <thead><tr><th>Item</th><th>Qty</th><th>Total</th></tr></thead>
            <tbody>
              ${sale.items.map((i) => `<tr><td class="text-sm">${window.UI.escapeHtml(i.nameSnapshot)}${i.refundedQuantity ? ` <span class="text-xs text-muted">(${i.refundedQuantity} refunded)</span>` : ''}</td><td>${i.quantity}</td><td>${window.UI.formatMoney(i.total)}</td></tr>`).join('')}
            </tbody>
          </table>
        </div>
        <div class="pos-totals-row"><span>Subtotal</span><span>${window.UI.formatMoney(sale.subtotal)}</span></div>
        <div class="pos-totals-row"><span>Tax</span><span>${window.UI.formatMoney(sale.tax)}</span></div>
        <div class="pos-totals-row grand"><span>Total</span><span>${window.UI.formatMoney(sale.total)}</span></div>
        ${sale.balance > 0 ? `<div class="pos-totals-row" style="color:var(--color-warning)"><span>Balance owed</span><span>${window.UI.formatMoney(sale.balance)}</span></div>` : ''}
        ${sale.saleStatus === 'CANCELLED' ? `<div class="form-alert form-alert-error" style="margin-top: var(--space-3)">Cancelled: ${window.UI.escapeHtml(sale.cancelReason || '')}</div>` : ''}
      `,
      footerHtml: `
        <button class="btn btn-secondary" data-action="close">Close</button>
        ${receipt ? `<button class="btn btn-secondary" data-action="receipt">View receipt</button>` : ''}
        ${canRefund ? `<button class="btn btn-secondary" data-action="refund">Request refund</button>` : ''}
        ${canCancel ? `<button class="btn btn-danger" data-action="cancel">Cancel sale</button>` : ''}
      `,
    });

    modal.querySelector('[data-action="close"]').addEventListener('click', window.UI.closeModal);
    modal.querySelector('[data-action="receipt"]')?.addEventListener('click', () => window.ReceiptView.showReceiptModal(receipt));
    modal.querySelector('[data-action="refund"]')?.addEventListener('click', () => {
      window.UI.closeModal();
      openRefundModal(sale);
    });
    modal.querySelector('[data-action="cancel"]')?.addEventListener('click', async () => {
      const reason = window.prompt('Reason for cancelling this sale:');
      if (!reason) return;
      try {
        await window.Api.post(`/sales/${sale._id}/cancel`, { reason });
        window.UI.toast.success('Sale cancelled');
        window.UI.closeModal();
        fetchHistory();
      } catch (err) {
        window.UI.toast.error(err.message);
      }
    });
  }

  /**
   * openRefundModal - lets a manager/cashier pick how many units of each
   * still-refundable line to return. The refund AMOUNT is never entered by
   * hand here - the backend computes it proportionally from what was
   * actually charged on the original sale, so this form only collects
   * quantities plus the reason and how the money is being given back.
   */
  function openRefundModal(sale) {
    const refundable = sale.items
      .map((i, idx) => ({ ...i, idx, remaining: i.quantity - i.refundedQuantity }))
      .filter((i) => i.remaining > 0);

    const modal = window.UI.openModal({
      title: 'Request refund',
      maxWidth: '480px',
      bodyHtml: `
        <form id="refund-form">
          <div class="field">
            <label>Items to refund</label>
            ${refundable.map((i) => `
              <div class="flex items-center justify-between" style="padding: var(--space-2) 0; border-bottom: 1px solid var(--color-border)">
                <span class="text-sm">${window.UI.escapeHtml(i.nameSnapshot)}<br/><span class="text-xs text-muted">${i.remaining} available to refund</span></span>
                <input class="input" type="number" min="0" max="${i.remaining}" step="1" value="0" data-refund-qty="${i.idx}" style="width:80px" />
              </div>
            `).join('')}
          </div>
          <div class="field" style="margin-top: var(--space-3)"><label>Reason</label><input class="input" name="reason" required placeholder="e.g. Defective item" /></div>
          <div class="field">
            <label>Refund method</label>
            <select class="select" name="paymentMethod">
              <option value="CASH">Cash</option><option value="MPESA">M-PESA</option><option value="CARD">Card</option><option value="BANK">Bank</option><option value="OTHER">Other</option>
            </select>
          </div>
        </form>
      `,
      footerHtml: `<button class="btn btn-secondary" data-action="cancel">Cancel</button><button class="btn btn-primary" data-action="save" id="refund-save-btn">Submit refund</button>`,
    });

    modal.querySelector('[data-action="cancel"]').addEventListener('click', window.UI.closeModal);
    modal.querySelector('[data-action="save"]').addEventListener('click', async () => {
      const form = modal.querySelector('#refund-form');
      if (!form.reportValidity()) return;

      const items = refundable
        .map((i) => ({ productId: i.productId, variantId: i.variantId, quantity: Number(modal.querySelector(`[data-refund-qty="${i.idx}"]`).value) || 0 }))
        .filter((i) => i.quantity > 0);

      if (!items.length) return window.UI.toast.error('Enter a quantity for at least one item');

      const raw = window.UI.serializeForm(form);
      const btn = document.getElementById('refund-save-btn');
      window.UI.setButtonLoading(btn, true, 'Submitting…');
      try {
        const { data } = await window.Api.post('/refunds', {
          branchId: sale.branchId?._id || sale.branchId,
          saleId: sale._id, items, reason: raw.reason, paymentMethod: raw.paymentMethod,
        });
        const refund = data.refund || data;
        window.UI.toast.success(refund.status === 'COMPLETED' ? 'Refund completed' : 'Refund submitted for approval');
        window.UI.closeModal();
        fetchHistory();
      } catch (err) {
        window.UI.toast.error(err.message);
      } finally {
        window.UI.setButtonLoading(btn, false);
      }
    });
  }
})();