/**
 * sales.js  (REDESIGNED POS - full-screen ticket)
 *
 * One workspace with two views: "New sale" (the POS) and "Sales history".
 *
 * LAYOUT
 *   Top bar  : tabs | shift status (open/close) | cashier + clock | view buttons
 *   Search   : scan / search bar (+ camera scan button + shortcut hints)
 *   Ticket   : ONE scrolling grid that takes all the free space. Every row is a
 *              product, both halves on the same line:
 *                Products -> # | Barcode | Product name | Price per unit
 *                Cart     -> Quantity | Discount | Subtotal | remove
 *   Summary  : customer, cart discount, subtotal/tax, the big TOTAL and the
 *              single "Add payment to complete sale" button (also F9).
 *
 * FULL VIEW (default): the workspace is pinned over the whole browser window
 * so the ticket gets every pixel. The top-bar button switches back to the
 * normal app layout (sidebar + app bar); the choice is remembered on this
 * device. A second button uses the browser's real full-screen mode.
 *
 * NEW SALE FLOW
 *   1. Scan or search. A scan adds straight away; a search shows a results list
 *      (Barcode | Product name | Price per unit) and picking a row adds it.
 *   2. Added products appear in the ticket. Adjust quantity / discount inline.
 *   3. ONE button: "Add payment to complete sale" (F9).
 *   4. The payment window asks how the customer is paying:
 *        CASH         -> amount received, system shows the CHANGE
 *        M-PESA STK   -> STK push; once confirmed the sale completes automatically
 *        M-PESA TILL  -> customer pays the Buy Goods till themselves; the POS
 *                        matches the payment automatically (or by the customer's
 *                        M-PESA code if matching is ambiguous), then completes the sale
 *        BANK / CARD  -> optional reference, then Complete sale
 *        CREDIT       -> pick the customer, then Complete sale
 *   5. Receipt opens after every sale (auto-print requested).
 *
 * PRICING NOTE: everything shown while building the cart is a CLIENT-SIDE
 * PREVIEW (tax-inclusive assumption, cashier lacks settings.view). On
 * "Complete sale" the backend recomputes everything from Product/Variant
 * records + real tax settings; that response is what is charged and printed.
 *
 * BARCODE SCANNING: hardware scanner (global keyboard-wedge) and the camera
 * "Scan barcode" button both funnel into handleScannedCode().
 *
 * M-PESA: the reference is never typed. It only exists once
 * GET /payments/mpesa/:reference/status returns SUCCESS, and the backend
 * re-verifies it against its own MpesaTransaction when the sale is saved.
 * The only thing a cashier may type for the TILL option is the customer's
 * M-PESA confirmation code, and the backend checks it against payments PayHero
 * reported (exact amount, never used before) - a made-up code is rejected.
 *
 * SHORTCUTS (new sale view): F2 search | Up/Down pick | Enter add | F9 payment
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

  // Font Awesome 6 (free, solid) icon classes - loaded in sales.html
  // MPESA_TILL is a UI-only option: it is sent to the backend as method 'MPESA' like STK.
  const METHODS = [
    { id: 'CASH', label: 'Cash', ico: 'fa-solid fa-money-bill-wave' },
    { id: 'MPESA', label: 'M-PESA STK', ico: 'fa-solid fa-mobile-screen-button' },
    { id: 'MPESA_TILL', label: 'M-PESA Till', ico: 'fa-solid fa-store' },
    { id: 'BANK', label: 'Bank', ico: 'fa-solid fa-building-columns' },
    { id: 'CREDIT', label: 'Credit', ico: 'fa-solid fa-file-invoice-dollar' },
    { id: 'CARD', label: 'Card', ico: 'fa-solid fa-credit-card' },
  ];

  const DEFAULT_FLAGS = { mpesaEnabled: false, etimsEnabled: false, mpesaManualEnabled: false, tillNumber: null };
  const FOCUS_KEY = 'pos.fullView';

  const state = {
    view: 'new-sale',
    focus: true, // "full view": workspace pinned over the whole window
    cart: [], // { product, variant, quantity, discount, overridePriceEnabled, overridePrice }
    customer: null,
    cartDiscount: 0,
    payments: [], // built when the payment window completes: { method, amount, reference, amountTendered }
    pendingMpesa: null, // { reference, amount (KES), mode: 'STK' | 'MANUAL' } - confirmed M-PESA money that has not been saved as a sale yet
    lastAdded: null, // key of the last product added
    currentShift: null,
    flags: { ...DEFAULT_FLAGS },
    history: { page: 1, limit: 10, search: '', from: '', to: '' },
  };

  const esc = (s) => window.UI.escapeHtml(s == null ? '' : String(s));
  const fm = (n) => window.UI.formatMoney(n);
  const $ = (id) => document.getElementById(id);

  let contentEl;
  let checkoutKey = window.Api.newIdempotencyKey();
  let unsubscribeBranchChange = null;
  let unsubscribeBranchesLoaded = null;
  let hardwareScannerUnsub = null;
  let keyHandler = null;
  let checkingOut = false;
  let clearSearch = () => {};
  let outsideHandler = null;
  let clockTimer = null;
  let lastScan = { code: '', at: 0 };

  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    contentEl = window.AppShell.mount({ title: 'Sales' });
    if (!contentEl) return;

    try { state.focus = localStorage.getItem(FOCUS_KEY) !== '0'; } catch { state.focus = true; }

    contentEl.innerHTML = pageSkeleton();
    bindTopbar();
    applyFocus(state.focus);
    window.addEventListener('resize', fitRoot);

    await Promise.all([loadShift(), renderNewSaleView()]);

    // The branch name arrives after the branch list loads (and may never arrive for roles
    // without branches.view), so fill it in when it does and whenever the branch changes.
    unsubscribeBranchesLoaded = window.AppShell.onBranchesLoaded?.(refreshCashierLabel);
    refreshCashierLabel();

    unsubscribeBranchChange = window.AppShell.onBranchChange(async () => {
      refreshCashierLabel();
      await loadShift();
      if (state.view === 'new-sale') renderNewSaleView();
      else renderHistory();
    });
    window.addEventListener('beforeunload', () => {
      unsubscribeBranchChange?.();
      unsubscribeBranchesLoaded?.();
      detachHardwareScanner();
      document.body.classList.remove('pz-focus-on');
    });
  }

  /* ================================================================== *
   * Workspace shell: top bar, full view, clock
   * ================================================================== */
  function pageSkeleton() {
    return `
      <div class="pz-root" id="pz-root">
        <header class="pz-topbar">
          <div class="pz-tabs" role="tablist">
            <button class="pz-tab active" data-view="new-sale" role="tab"><i class="fa-solid fa-cash-register" aria-hidden="true"></i> New sale</button>
            <button class="pz-tab" data-view="history" role="tab" data-requires-permission="sales.view"><i class="fa-solid fa-clock-rotate-left" aria-hidden="true"></i> Sales history</button>
          </div>
          <div class="pz-shift" id="shift-banner"></div>
          <div class="pz-top-right">
            <span class="pz-user" id="pz-user" title="${esc(cashierLabel())}">${esc(cashierLabel())}</span>
            <span class="pz-clock" id="pz-clock"></span>
            <button type="button" class="pz-iconbtn" id="pz-focus-btn"></button>
            <button type="button" class="pz-iconbtn" id="pz-fs-btn" style="${document.fullscreenEnabled ? '' : 'display:none'}"></button>
          </div>
        </header>
        <div class="pz-view" id="view-body"></div>
      </div>
    `;
  }

  /** "Alvin Kimani / Main Branch" - falls back to just the name while the branch name is unknown. */
  function cashierLabel() {
    const name = window.AppShell.getUser()?.name || '';
    const branch = window.AppShell.getActiveBranchName?.() || '';
    return [name, branch].filter(Boolean).join(' / ');
  }

  function refreshCashierLabel() {
    const el = $('pz-user');
    if (!el) return;
    const label = cashierLabel();
    el.textContent = label;
    el.title = label;
  }

  function bindTopbar() {
    contentEl.querySelectorAll('.pz-tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        contentEl.querySelectorAll('.pz-tab').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        state.view = btn.dataset.view;
        if (state.view === 'new-sale') {
          renderNewSaleView();
        } else {
          detachHardwareScanner();
          renderHistory();
        }
      });
    });
    window.Permissions.applyPermissionGates(contentEl, window.AppShell.getUser());

    $('pz-focus-btn').addEventListener('click', () => applyFocus(!state.focus));
    $('pz-fs-btn').addEventListener('click', toggleBrowserFullscreen);
    document.addEventListener('fullscreenchange', renderViewButtons);

    tickClock();
    clearInterval(clockTimer);
    clockTimer = setInterval(tickClock, 15000);
    renderViewButtons();
  }

  function tickClock() {
    const el = $('pz-clock');
    if (!el) { clearInterval(clockTimer); return; }
    el.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function applyFocus(on) {
    state.focus = !!on;
    try { localStorage.setItem(FOCUS_KEY, state.focus ? '1' : '0'); } catch { /* private mode - fine */ }
    $('pz-root')?.classList.toggle('pz-focus', state.focus);
    document.body.classList.toggle('pz-focus-on', state.focus);
    renderViewButtons();
    fitRoot();
  }

  function renderViewButtons() {
    const f = $('pz-focus-btn');
    if (f) {
      f.classList.toggle('on', state.focus);
      f.innerHTML = `<i class="fa-solid ${state.focus ? 'fa-down-left-and-up-right-to-center' : 'fa-up-right-and-down-left-from-center'}" aria-hidden="true"></i>`;
      f.title = state.focus ? 'Show sidebar and app bar' : 'Full view - give the ticket the whole screen';
      f.setAttribute('aria-label', f.title);
    }
    const s = $('pz-fs-btn');
    if (s) {
      const on = !!document.fullscreenElement;
      s.classList.toggle('on', on);
      s.innerHTML = `<i class="fa-solid ${on ? 'fa-compress' : 'fa-expand'}" aria-hidden="true"></i>`;
      s.title = on ? 'Leave browser full screen' : 'Browser full screen';
      s.setAttribute('aria-label', s.title);
    }
  }

  function toggleBrowserFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else document.documentElement.requestFullscreen?.().catch(() => window.UI.toast.error('Full screen is not available in this browser'));
  }

  /** In full view the CSS pins the workspace; otherwise it is sized to the space under the app bar. */
  function fitRoot() {
    const root = $('pz-root');
    if (!root) return;
    if (state.focus) { root.style.height = ''; return; }
    const top = root.getBoundingClientRect().top + window.scrollY;
    root.style.height = `${Math.max(window.innerHeight - top - 12, 520)}px`;
  }

  /* ================================================================== *
   * Barcode scanning + keyboard shortcuts
   * ================================================================== */
  function attachHardwareScanner() {
    hardwareScannerUnsub?.();
    if (window.BarcodeScanner) {
      hardwareScannerUnsub = window.BarcodeScanner.listenHardwareScanner(handleScannedCode);
    }
    if (keyHandler) document.removeEventListener('keydown', keyHandler);
    keyHandler = (e) => {
      if (state.view !== 'new-sale' || document.querySelector('.modal-backdrop')) return;
      if (e.key === 'F9') { e.preventDefault(); openPaymentModal(); }
      if (e.key === 'F2') { e.preventDefault(); $('pos-search')?.focus(); $('pos-search')?.select(); }
    };
    document.addEventListener('keydown', keyHandler);
  }

  function detachHardwareScanner() {
    hardwareScannerUnsub?.();
    hardwareScannerUnsub = null;
    if (keyHandler) document.removeEventListener('keydown', keyHandler);
    keyHandler = null;
    if (outsideHandler) document.removeEventListener('click', outsideHandler);
    outsideHandler = null;
  }

  async function handleScannedCode(code) {
    if (!code) return;
    // Don't hijack a scan while a modal (payment, discount, customer...) is open.
    if (document.querySelector('.modal-backdrop')) return;
    // The same code arriving twice within a blink (scanner + focused search box) is one scan.
    const now = Date.now();
    if (code === lastScan.code && now - lastScan.at < 350) return;
    lastScan = { code, at: now };

    try {
      const { data } = await window.Api.get(`/products/barcode/${encodeURIComponent(code.trim())}`);
      addToCart(data.product, data.variant);
    } catch (err) {
      window.UI.toast.error(err.code === 'BARCODE_NOT_FOUND' ? `No product found for barcode "${code}"` : err.message);
    }
    clearSearch();
    $('pos-search')?.focus();
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
    state.flags = flagsResult.status === 'fulfilled' ? { ...DEFAULT_FLAGS, ...flagsResult.value.data } : { ...DEFAULT_FLAGS };

    renderShiftBanner();
  }

  function renderShiftBanner() {
    const el = $('shift-banner');
    if (!el) return;

    if (state.currentShift) {
      el.innerHTML = `
        <div class="shift-banner open">
          <span>${window.Icons.get('check')} Shift open since ${window.UI.formatDateTime(state.currentShift.openedAt)} - ${esc(state.currentShift.registerId?.name || 'Register')}</span>
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
    fitRoot();
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
            <select class="select" name="registerId" required>${registers.map((r) => `<option value="${r._id}">${esc(r.name)} (${esc(r.code)})</option>`).join('')}</select>
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
      const btn = $('open-shift-save');
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
    window.CashCount.openCountModal({
      title: 'Close shift',
      intro: 'Count the cash in the drawer and enter how many of each note and coin you have. The total is added up for you, and the system compares it with what the drawer should hold.',
      confirmText: 'Close shift',
      confirmClass: 'btn-danger',
      onSubmit: async ({ denominations, notes }) => {
        const { data } = await window.Api.post(`/shifts/${state.currentShift._id}/close`, { denominations, notes });
        window.UI.closeModal();
        showShiftSummary(data.shift);
        loadShift();
      },
    });
  }

  function showShiftSummary(shift) {
    const diff = shift.cashDifference;
    const modal = window.UI.openModal({
      title: 'Shift summary',
      maxWidth: '520px',
      bodyHtml: `
        <div class="pos-totals-row"><span>Opening float</span><span>${fm(shift.openingCash)}</span></div>
        <div class="pos-totals-row"><span>Expected cash</span><span>${fm(shift.expectedCash)}</span></div>
        <div class="pos-totals-row"><span>Actual cash counted</span><span>${fm(shift.actualCash)}</span></div>
        <div class="pos-totals-row grand" style="color:${diff === 0 ? 'var(--color-success)' : 'var(--color-danger)'}">
          <span>${diff === 0 ? 'Balanced' : diff > 0 ? 'Over' : 'Short'}</span><span>${fm(Math.abs(diff))}</span>
        </div>
        ${window.CashCount.breakdownHtml(shift.denominations)}
      `,
      footerHtml: `<button class="btn btn-primary" data-action="close">Done</button>`,
    });
    modal.querySelector('[data-action="close"]').addEventListener('click', window.UI.closeModal);
  }

  /* ================================================================== *
   * NEW SALE VIEW
   * ================================================================== */
  function barcodeOf(product, variant) {
    return (variant && variant.barcode) || product.barcode || '';
  }
  function nameOf(product, variant) {
    const attrs = variant ? Object.values(variant.attributes || {}).join(', ') : '';
    return attrs ? `${product.name} (${attrs})` : product.name;
  }
  function unitPriceOf(item) {
    if (item.overridePriceEnabled && item.overridePrice != null) return item.overridePrice;
    return item.variant ? item.variant.sellingPrice : item.product.sellingPrice;
  }

  function renderNewSaleView() {
    const body = $('view-body');
    body.className = 'pz-view pz-view-pos';
    body.innerHTML = `
      <div class="card pz-searchbar">
        <div class="pz-search-row">
          <div class="pz-searchwrap" id="pz-searchwrap">
            <div class="input-group">
              <span class="input-group-icon">${window.Icons.get('search')}</span>
              <input class="input" id="pos-search" type="text" autocomplete="off" autofocus placeholder="Scan a barcode or search a product by name / SKU" />
            </div>
            <div class="pz-dd" id="pz-dd" role="listbox"></div>
          </div>
          ${window.BarcodeScanner ? `
            <button type="button" class="btn btn-primary pz-scan-btn" id="pos-scan-btn">
              ${window.BarcodeScanner.cameraIconSvg} <span class="pz-scan-label">Scan barcode</span>
            </button>` : ''}
          <div class="pz-keys" aria-hidden="true">
            <span><kbd class="kbd">F2</kbd> search</span>
            <span><kbd class="kbd">↑</kbd><kbd class="kbd">↓</kbd> pick</span>
            <span><kbd class="kbd">Enter</kbd> add</span>
            <span><kbd class="kbd">F9</kbd> payment</span>
          </div>
        </div>
      </div>

      <div class="pz-main">
        <section class="card pz-ticketwrap" aria-label="Ticket">
          <div class="pz-hr pz-hgroup">
            <div class="pz-left"><h3>Products</h3></div>
            <div class="pz-rgt"><h3>Cart <span class="pz-count" id="pz-count">0</span></h3></div>
          </div>
          <div class="pz-hr pz-hlabels">
            <div class="pz-left"><span>#</span><span class="pz-c-bc">Barcode</span><span>Product name</span><span class="pz-right">Price per unit</span></div>
            <div class="pz-rgt"><span>Quantity</span><span>Discount</span><span class="pz-right">Subtotal</span><span></span></div>
          </div>
          <div class="pz-tbody" id="pz-ticket"></div>
          <div class="pz-tfoot">
            <div class="pz-tfoot-stats" id="pz-products-foot"></div>
            <button class="btn btn-ghost btn-sm" id="clear-cart-btn"><i class="fa-solid fa-trash-can" aria-hidden="true"></i> Clear all</button>
          </div>
        </section>

        <aside class="card pz-summary" aria-label="Sale summary">
          <div class="pz-sum-head"><h3>Sale summary</h3></div>
          <div class="pz-sum-body">
            <button class="btn btn-secondary" id="pick-customer-btn"></button>
            <div class="field">
              <label for="cart-discount-input">Cart discount (KES)</label>
              <input class="input" id="cart-discount-input" type="number" inputmode="decimal" step="0.01" min="0" placeholder="0" value="${state.cartDiscount || ''}" />
            </div>
            <div class="pz-sum-lines" id="pz-sum-lines"></div>
          </div>
          <div class="pz-cart-foot" id="pz-cart-foot"></div>
        </aside>
      </div>
    `;

    bindProductSearch();
    bindScanButton();
    bindTicketEvents();
    renderCart();

    $('clear-cart-btn').addEventListener('click', async () => {
      if (!state.cart.length) return;
      const ok = await window.UI.confirmDialog({ title: 'Clear cart?', confirmText: 'Clear', danger: true });
      if (ok) resetCart();
    });
    $('cart-discount-input').addEventListener('input', (e) => {
      state.cartDiscount = Math.max(Number(e.target.value) || 0, 0);
      renderTotals();
    });
    $('pick-customer-btn').addEventListener('click', () => {
      window.CustomerPicker.open({ onSelect: (customer) => { state.customer = customer; renderCustomerButton(); } });
    });

    attachHardwareScanner();
    fitRoot();
    $('pos-search')?.focus();
  }

  function renderCustomerButton() {
    const b = $('pick-customer-btn');
    if (!b) return;
    b.innerHTML = `${window.Icons.get('employees')} ${state.customer ? esc(state.customer.name) : 'Walk-in customer'}`;
    b.title = state.customer ? 'Change customer' : 'Tap to add a customer (needed for credit)';
  }

  function bindScanButton() {
    $('pos-scan-btn')?.addEventListener('click', () => {
      window.BarcodeScanner.openCameraModal({
        title: 'Scan product barcode',
        onDetect: (code) => handleScannedCode(code),
      });
    });
  }

  /* ---- Search: results only exist while the cashier is searching ---- */
  function bindProductSearch() {
    const input = $('pos-search');
    const dd = $('pz-dd');
    let rows = [];
    let active = 0;
    let seq = 0;

    const close = () => { dd.classList.remove('open'); dd.innerHTML = ''; rows = []; active = 0; };
    clearSearch = () => { seq += 1; input.value = ''; close(); };

    function setActive(n) {
      active = n;
      dd.querySelectorAll('.pz-dd-row').forEach((r, i) => r.classList.toggle('active', i === active));
      dd.querySelector('.pz-dd-row.active')?.scrollIntoView({ block: 'nearest' });
    }

    function render(term, loading) {
      dd.classList.add('open');
      if (loading) { dd.innerHTML = '<div class="pz-dd-msg">Searching…</div>'; return; }
      if (!rows.length) { dd.innerHTML = `<div class="pz-dd-msg">No product found for “${esc(term)}”</div>`; return; }
      dd.innerHTML = `
        <div class="pz-dd-head"><span>Barcode</span><span>Product name</span><span class="pz-right">Price per unit</span></div>
        ${rows.map((r, i) => `
          <div class="pz-dd-row ${i === active ? 'active' : ''}" data-idx="${i}" role="option">
            <span class="pz-mono">${esc(barcodeOf(r.product, r.variant)) || '-'}</span>
            <span class="pz-name">${esc(nameOf(r.product, r.variant))}<small>SKU ${esc(r.variant ? r.variant.sku : r.product.sku)}</small></span>
            <span class="pz-price">${fm(r.variant ? r.variant.sellingPrice : r.product.sellingPrice)}</span>
          </div>`).join('')}
      `;
      dd.querySelectorAll('.pz-dd-row').forEach((el) => {
        el.addEventListener('mouseenter', () => setActive(Number(el.dataset.idx)));
        el.addEventListener('click', () => pick(Number(el.dataset.idx)));
      });
    }

    function pick(i) {
      const r = rows[i];
      if (!r) return;
      addToCart(r.product, r.variant);
      clearSearch();
      input.focus();
    }

    async function runSearch(term) {
      const my = ++seq;
      render(term, true);
      try {
        const { data } = await window.Api.get('/products', { search: term, limit: 15, status: 'active' });
        if (my !== seq) return rows;
        rows = [];
        (data.items || []).forEach((product) => {
          if (product.variants?.length) product.variants.forEach((v) => rows.push({ product, variant: v }));
          else rows.push({ product, variant: null });
        });
        active = 0;
        render(term, false);
      } catch (err) {
        if (my !== seq) return rows;
        rows = [];
        dd.classList.add('open');
        dd.innerHTML = `<div class="pz-dd-msg">Search failed: ${esc(err.message)}</div>`;
      }
      return rows;
    }

    const debounced = window.UI.debounce((term) => runSearch(term), 250);
    input.addEventListener('input', (e) => {
      const term = e.target.value.trim();
      if (!term) { seq += 1; close(); return; }
      debounced(term);
    });

    input.addEventListener('keydown', async (e) => {
      if (e.key === 'Escape') { clearSearch(); return; }
      if (e.key === 'ArrowDown' && rows.length) { e.preventDefault(); setActive(Math.min(active + 1, rows.length - 1)); return; }
      if (e.key === 'ArrowUp' && rows.length) { e.preventDefault(); setActive(Math.max(active - 1, 0)); return; }
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const term = input.value.trim();
      if (!term) return;
      // A long all-digit entry is a barcode (typed or wedge-scanned): same lookup as the scanner.
      if (/^\d{6,}$/.test(term)) { handleScannedCode(term); return; }
      if (!rows.length || dd.querySelector('.pz-dd-msg')) await runSearch(term);
      pick(active);
    });

    // click outside closes the results
    if (outsideHandler) document.removeEventListener('click', outsideHandler);
    outsideHandler = (e) => { if (!e.target.closest('#pz-searchwrap')) close(); };
    document.addEventListener('click', outsideHandler);
  }

  /* ---- Cart operations ---- */
  function keyOf(item) { return item.variant ? item.variant._id : item.product._id; }

  function addToCart(product, variant) {
    const key = variant ? variant._id : product._id;
    const existing = state.cart.find((i) => keyOf(i) === key);
    if (existing) existing.quantity += 1;
    else state.cart.push({ product, variant, quantity: 1, discount: 0, overridePriceEnabled: false, overridePrice: null });
    state.lastAdded = key;
    renderCart(key); // scrolls the new / updated row into view
  }

  function round2(n) { return Math.round(n * 100) / 100; }

  /** Client-side preview only - see the file header note. */
  function previewLine(unitPrice, qty, discount, taxRate) {
    const gross = round2(unitPrice * qty);
    const net = round2(gross - (discount || 0));
    const tax = round2(net - net / (1 + (taxRate || 0) / 100));
    return { gross, net, tax, total: net };
  }

  function computeTotals() {
    let subtotal = 0, itemDiscountTotal = 0, tax = 0, itemCount = 0;
    state.cart.forEach((item) => {
      const unitPrice = unitPriceOf(item);
      subtotal += round2(unitPrice * item.quantity);
      itemDiscountTotal += item.discount || 0;
      tax += previewLine(unitPrice, item.quantity, item.discount, item.product.taxRate).tax;
      itemCount += item.quantity;
    });
    const total = Math.max(round2(subtotal - itemDiscountTotal - (state.cartDiscount || 0)), 0);
    return { subtotal: round2(subtotal), itemDiscountTotal: round2(itemDiscountTotal), tax: round2(tax), itemCount, total };
  }

  function renderCart(flashKey) {
    renderTicket(flashKey);
    renderCustomerButton();
    renderTotals();
  }

  /* One row per product: Products half (# | Barcode | Name | Price) and Cart half (Qty | Discount | Subtotal | x) */
  function renderTicket(flashKey) {
    const el = $('pz-ticket');
    if (!el) return;
    const foot = $('pz-products-foot');
    const clearBtn = $('clear-cart-btn');
    if (clearBtn) clearBtn.disabled = !state.cart.length;

    if (!state.cart.length) {
      el.innerHTML = `<div class="pz-empty"><i class="fa-solid fa-barcode" aria-hidden="true"></i><strong>No products yet</strong>Scan a barcode or search above.<br/>Every product you add lands here with its quantity, discount and subtotal on the same line.</div>`;
      if (foot) foot.innerHTML = '<span>Nothing scanned yet</span>';
      return;
    }

    const scrollTop = el.scrollTop;
    const canOverride = window.Permissions.can(window.AppShell.getUser(), 'sales.price_override');
    el.innerHTML = state.cart.map((item, i) => {
      const k = keyOf(item);
      const cls = `${k === state.lastAdded ? 'latest' : ''} ${k === flashKey ? 'flash' : ''}`;
      const unit = unitPriceOf(item);
      const preview = previewLine(unit, item.quantity, item.discount, item.product.taxRate);
      const bc = barcodeOf(item.product, item.variant);
      const d = item.discount || 0;
      return `
        <div class="pz-tr ${cls}" data-idx="${i}" data-key="${esc(k)}">
          <div class="pz-left">
            <span class="pz-c-no">${i + 1}</span>
            <span class="pz-c-bc pz-mono">${esc(bc) || '-'}</span>
            <span class="pz-c-name pz-name">${esc(nameOf(item.product, item.variant))}${bc ? `<small class="pz-name-bc">${esc(bc)}</small>` : ''}</span>
            <span class="pz-c-price pz-price">@ ${fm(unit)}${item.overridePriceEnabled ? '<small>price changed</small>' : ''}</span>
          </div>
          <div class="pz-rgt">
            <div class="pz-c-qty pz-stepper">
              <button type="button" data-action="dec" data-idx="${i}" aria-label="Decrease quantity">−</button>
              <input type="number" inputmode="numeric" min="0" step="1" value="${item.quantity}" data-action="qty" data-idx="${i}" aria-label="Quantity" />
              <button type="button" data-action="inc" data-idx="${i}" aria-label="Increase quantity">+</button>
            </div>
            <button type="button" class="pz-c-disc pz-disc ${d ? 'has' : ''}" data-action="discount" data-idx="${i}" title="Tap to set a discount${canOverride ? ' or change the price' : ''}">${d ? Number(d).toLocaleString() : '0'}</button>
            <div class="pz-c-sub pz-sub">${fm(preview.total)}</div>
            <button type="button" class="pz-c-x pz-x" data-action="remove" data-idx="${i}" aria-label="Remove item">${window.Icons.get('close')}</button>
          </div>
        </div>`;
    }).join('');
    el.scrollTop = scrollTop;
    if (flashKey) el.querySelector('.pz-tr.flash')?.scrollIntoView({ block: 'nearest' });

    if (foot) {
      const { itemCount } = computeTotals();
      foot.innerHTML = `<span><strong>${state.cart.length}</strong> product${state.cart.length === 1 ? '' : 's'}</span><span><strong>${itemCount}</strong> unit${itemCount === 1 ? '' : 's'}</span>`;
    }
  }

  /* Ticket events are delegated once per render of the view (rows are rebuilt on every change). */
  function bindTicketEvents() {
    const el = $('pz-ticket');

    el.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-action]');
      if (!b) return;
      const idx = Number(b.dataset.idx);
      const item = state.cart[idx];
      if (!item) return;
      switch (b.dataset.action) {
        case 'inc':
          item.quantity += 1;
          renderCart();
          break;
        case 'dec':
          item.quantity -= 1;
          if (item.quantity <= 0) state.cart.splice(idx, 1);
          renderCart();
          break;
        case 'remove':
          state.cart.splice(idx, 1);
          renderCart();
          $('pos-search')?.focus();
          break;
        case 'discount':
          openLineDiscountModal(idx);
          break;
        default:
      }
    });

    el.addEventListener('change', (e) => {
      const inp = e.target.closest('input[data-action="qty"]');
      if (!inp) return;
      const idx = Number(inp.dataset.idx);
      const n = Math.floor(Number(inp.value));
      if (!Number.isFinite(n) || n <= 0) state.cart.splice(idx, 1);
      else if (state.cart[idx]) state.cart[idx].quantity = n;
      renderCart();
      // Hand the keyboard back to the search box unless the cashier clicked into something else.
      setTimeout(() => {
        if (!document.activeElement || document.activeElement === document.body) $('pos-search')?.focus();
      }, 0);
    });

    el.addEventListener('focusin', (e) => {
      if (e.target.matches('input[data-action="qty"]')) e.target.select();
    });

    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.matches('input[data-action="qty"]')) {
        e.preventDefault();
        e.target.blur(); // fires "change", which re-renders and refocuses the search box
        $('pos-search')?.focus();
      }
    });
  }

  function renderTotals() {
    const foot = $('pz-cart-foot');
    if (!foot) return;
    const { subtotal, itemDiscountTotal, tax, itemCount, total } = computeTotals();
    const discounts = round2(itemDiscountTotal + (state.cartDiscount || 0));
    const countEl = $('pz-count');
    if (countEl) countEl.textContent = itemCount;

    const lines = $('pz-sum-lines');
    if (lines) {
      lines.innerHTML = `
        <div class="pz-mini"><span>Subtotal</span><span>${fm(subtotal)}</span></div>
        ${discounts ? `<div class="pz-mini"><span>Discounts</span><span>-${fm(discounts)}</span></div>` : ''}
        <div class="pz-mini"><span>Tax (est.)</span><span>${fm(tax)}</span></div>
      `;
    }

    foot.innerHTML = `
      <div class="pz-total" aria-live="polite">
        <div class="pz-total-label"><span>Total to pay</span><span>${itemCount} unit${itemCount === 1 ? '' : 's'}</span></div>
        <div class="pz-total-amount">${fm(total)}</div>
      </div>
      <button class="btn btn-success pz-pay-btn" id="checkout-btn" ${state.cart.length ? '' : 'disabled'}>
        Add payment to complete sale
        <small>Press F9</small>
      </button>
    `;
    $('checkout-btn').addEventListener('click', () => openPaymentModal());
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

    modal.querySelector('[data-action="cancel"]').addEventListener('click', () => { window.UI.closeModal(); $('pos-search')?.focus(); });
    modal.querySelector('[data-action="save"]').addEventListener('click', () => {
      const raw = window.UI.serializeForm(modal.querySelector('#line-adjust-form'));
      item.discount = Number(raw.discount) || 0;
      if (canOverride) {
        item.overridePriceEnabled = !!raw.overridePrice && modal.querySelector('#override-toggle').checked;
        item.overridePrice = item.overridePriceEnabled ? Number(raw.overridePrice) : null;
      }
      window.UI.closeModal();
      renderCart();
      $('pos-search')?.focus();
    });
  }

  /* ================================================================== *
   * PAYMENT WINDOW
   * ================================================================== */
  function ceilTo(n, step) { return Math.ceil(n / step) * step; }

  function quickCashAmounts(total) {
    const set = new Set([round2(total), ceilTo(total, 50), ceilTo(total, 100), ceilTo(total, 500), ceilTo(total, 1000)]);
    return [...set].filter((n) => n >= total).sort((a, b) => a - b).slice(0, 5);
  }

  /** Which payment tab a confirmed-but-unsaved M-PESA payment belongs to. */
  function mpesaMethodIdFor(pending) {
    return pending && pending.mode === 'MANUAL' ? 'MPESA_TILL' : 'MPESA';
  }

  function openPaymentModal(initialMethod) {
    if (!state.cart.length) return window.UI.toast.error('Cart is empty');
    const { total } = computeTotals();
    const resumeMpesa = !!state.pendingMpesa;
    if (total <= 0 && !resumeMpesa) return window.UI.toast.error('Total must be greater than zero');

    const dueAmount = resumeMpesa ? state.pendingMpesa.amount : total;
    const resumeId = resumeMpesa ? mpesaMethodIdFor(state.pendingMpesa) : null;
    const methods = METHODS.filter((m) => {
      if (m.id === resumeId) return true; // always show the tab that holds already-received money
      if (m.id === 'MPESA') return state.flags.mpesaEnabled;
      if (m.id === 'MPESA_TILL') return state.flags.mpesaManualEnabled;
      return true;
    });
    let method = resumeId || (initialMethod && methods.some((m) => m.id === initialMethod) ? initialMethod : 'CASH');

    const modal = window.UI.openModal({
      title: 'Payment',
      maxWidth: '600px',
      bodyHtml: `
        <div class="pz-pay-total"><span>Amount due</span><strong>${fm(dueAmount)}</strong></div>
        <div class="pz-methods" id="pz-methods">
          ${methods.map((m) => `<button type="button" class="pz-method" data-method="${m.id}"><span class="pz-method-ico"><i class="${m.ico}" aria-hidden="true"></i></span>${m.label}</button>`).join('')}
        </div>
        <div id="pz-pay-panel"></div>
      `,
      footerHtml: `
        <button class="btn btn-secondary" data-action="cancel">Cancel</button>
        <button class="btn btn-success pz-complete-btn" data-action="complete" id="pz-complete-btn">Complete sale</button>
      `,
    });

    const panel = modal.querySelector('#pz-pay-panel');
    const completeBtn = modal.querySelector('#pz-complete-btn');
    let onComplete = null;

    function setComplete({ enabled = true, hidden = false, label = 'Complete sale & print receipt' } = {}) {
      completeBtn.style.display = hidden ? 'none' : '';
      completeBtn.disabled = !enabled;
      completeBtn.textContent = label;
    }

    function selectMethod(next) {
      const lockedTo = state.pendingMpesa ? mpesaMethodIdFor(state.pendingMpesa) : null;
      if (lockedTo && next !== lockedTo) return window.UI.toast.error('M-PESA payment already received - complete the sale first');
      if (next === 'MPESA_TILL' && method === 'MPESA_TILL' && modal._manualRef) return; // already waiting on this tab

      clearMpesaPolling(modal);
      // Leaving the Till tab while still waiting: release the request so it cannot confuse matching for other cashiers.
      if (modal._manualRef && next !== 'MPESA_TILL') {
        cancelManualAttempt(modal, () => { if (document.body.contains(modal)) selectMethod('MPESA_TILL'); });
      }
      modal._onRetry = null;
      modal._handleStatus = null;

      method = next;
      modal.querySelectorAll('.pz-method').forEach((b) => b.classList.toggle('active', b.dataset.method === method));
      const renderers = { CASH: renderCash, MPESA: renderMpesa, MPESA_TILL: renderMpesaTill, BANK: renderRef, CARD: renderRef, CREDIT: renderCredit };
      renderers[method]();
    }

    /* ---- CASH ---- */
    function renderCash() {
      const noShift = !state.currentShift;
      panel.innerHTML = `
        ${noShift ? '<div class="pz-note warn">No open shift. Open a shift before taking cash so the drawer balances.</div>' : ''}
        <div class="field">
          <label for="pz-tendered">Amount received from customer (KES)</label>
          <input class="input pz-cash-input" id="pz-tendered" type="number" inputmode="decimal" step="0.01" min="0" placeholder="0.00" />
        </div>
        <div class="pz-quick">
          ${quickCashAmounts(dueAmount).map((a, i) => `<button type="button" data-amt="${a}">${i === 0 && a === round2(dueAmount) ? 'Exact' : fm(a)}</button>`).join('')}
        </div>
        <div class="pz-change" id="pz-change"></div>
      `;
      const input = panel.querySelector('#pz-tendered');
      const changeEl = panel.querySelector('#pz-change');

      const update = () => {
        const tendered = Number(input.value);
        if (!input.value || !Number.isFinite(tendered)) {
          changeEl.className = 'pz-change';
          changeEl.innerHTML = '<span>Change to give back</span><strong>-</strong>';
          setComplete({ enabled: false });
          return;
        }
        const diff = round2(tendered - dueAmount);
        if (diff >= 0) {
          changeEl.className = 'pz-change ok';
          changeEl.innerHTML = `<span>Change to give back</span><strong>${fm(diff)}</strong>`;
          setComplete({ enabled: true });
        } else {
          changeEl.className = 'pz-change short';
          changeEl.innerHTML = `<span>Customer still owes</span><strong>${fm(Math.abs(diff))}</strong>`;
          setComplete({ enabled: false });
        }
      };
      input.addEventListener('input', update);
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !completeBtn.disabled) completeBtn.click(); });
      panel.querySelectorAll('[data-amt]').forEach((b) => b.addEventListener('click', () => { input.value = b.dataset.amt; update(); }));
      update();
      setTimeout(() => input.focus(), 50);

      onComplete = async () => {
        const tendered = Number(input.value);
        state.payments = [{ method: 'CASH', amount: dueAmount, amountTendered: tendered }];
        await checkout({ btn: completeBtn, change: round2(tendered - dueAmount) });
      };
    }

    /* ---- BANK / CARD ---- */
    function renderRef() {
      const label = method === 'BANK' ? 'Bank transfer' : 'Card';
      panel.innerHTML = `
        <div class="pz-note">${label} payment of <strong>${fm(dueAmount)}</strong>. Confirm the money has arrived before completing the sale.</div>
        <div class="field">
          <label for="pz-ref">Reference / code <span class="text-muted">(optional)</span></label>
          <input class="input" id="pz-ref" placeholder="Transaction code, slip number, etc" />
        </div>
      `;
      setComplete({ enabled: true });
      panel.querySelector('#pz-ref').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !completeBtn.disabled) completeBtn.click(); });
      onComplete = async () => {
        state.payments = [{ method, amount: dueAmount, reference: panel.querySelector('#pz-ref').value.trim() || undefined }];
        await checkout({ btn: completeBtn });
      };
    }

    /* ---- CREDIT ---- */
    async function renderCredit() {
      panel.innerHTML = `
        <div class="pz-note warn">The full <strong>${fm(dueAmount)}</strong> will be recorded as a debt against the customer.</div>
        <div class="field">
          <label for="pz-customer">Customer</label>
          <select class="select" id="pz-customer"><option value="">Loading customers…</option></select>
        </div>
      `;
      setComplete({ enabled: false });
      const select = panel.querySelector('#pz-customer');
      let customers = [];
      try {
        const { data } = await window.Api.get('/customers', { limit: 200 });
        customers = data.items || data.customers || [];
      } catch { /* fall through to picker */ }
      if (method !== 'CREDIT') return;

      if (!customers.length) {
        // Fallback: the shared customer picker (also lets the cashier add a new customer)
        panel.querySelector('.field').innerHTML = `
          <label>Customer</label>
          <button type="button" class="btn btn-secondary btn-block" id="pz-pick">${state.customer ? esc(state.customer.name) : 'Choose customer'}</button>`;
        panel.querySelector('#pz-pick').addEventListener('click', () => {
          window.UI.closeModal();
          window.CustomerPicker.open({ onSelect: (c) => { state.customer = c; renderCustomerButton(); openPaymentModal('CREDIT'); } });
        });
        setComplete({ enabled: !!state.customer });
      } else {
        select.innerHTML = `<option value="">Select customer…</option>` + customers.map((c) =>
          `<option value="${c._id}" ${state.customer && state.customer._id === c._id ? 'selected' : ''}>${esc(c.name)}${c.phone ? ` - ${esc(c.phone)}` : ''}</option>`).join('');
        select.addEventListener('change', () => {
          state.customer = customers.find((c) => c._id === select.value) || null;
          renderCustomerButton();
          setComplete({ enabled: !!state.customer });
        });
        setComplete({ enabled: !!state.customer });
      }

      onComplete = async () => {
        if (!state.customer) return window.UI.toast.error('Choose a customer for credit sales');
        state.payments = []; // no payment lines = whole sale on credit
        await checkout({ btn: completeBtn });
      };
    }

    /* ---- M-PESA shared: save the sale once the money is confirmed ---- */
    async function finalizeMpesa(reference, amount) {
      state.payments = [{ method: 'MPESA', amount, reference }];
      const ok = await checkout({ btn: null });
      if (!ok) {
        renderMpesaStatus(modal, { tone: 'warning', label: 'Paid - sale not saved', message: 'The M-PESA payment is confirmed but the sale could not be saved. Tap "Save sale" to try again. Do not start another payment.' });
        setComplete({ enabled: true, label: 'Save sale & print receipt' });
        onComplete = async () => { await checkout({ btn: completeBtn }); };
      }
    }

    /* ---- M-PESA (STK push) ---- */
    function renderMpesa() {
      const already = state.pendingMpesa;
      panel.innerHTML = `
        <div class="field">
          <label for="pz-mpesa-phone">Customer M-PESA number</label>
          <div class="input-button-row">
            <input class="input" id="pz-mpesa-phone" name="mpesaPhone" inputmode="tel" placeholder="07XXXXXXXX" value="${esc(state.customer?.phone || '')}" ${already ? 'disabled' : ''} />
            <button type="button" class="btn btn-primary" id="mpesa-send-btn" ${already ? 'disabled' : ''}>Send prompt</button>
          </div>
        </div>
        <div id="mpesa-stk-status"></div>
      `;
      if (already) {
        renderMpesaStatus(modal, { tone: 'warning', label: 'Paid - sale not saved', message: `M-PESA payment of ${fm(already.amount)} was received. Tap "Save sale" to finish. Do not send another prompt.` });
        setComplete({ enabled: true, label: 'Save sale & print receipt' });
        onComplete = async () => { state.payments = [{ method: 'MPESA', amount: already.amount, reference: already.reference }]; await checkout({ btn: completeBtn }); };
      } else {
        setComplete({ hidden: true });
        onComplete = null;
        bindMpesaSend(modal, dueAmount, { onPaid: (reference) => finalizeMpesa(reference, dueAmount) });
      }
    }

    /* ---- M-PESA TILL (Buy Goods, customer pays by themselves) ---- */
    function renderMpesaTill() {
      const already = state.pendingMpesa && state.pendingMpesa.mode === 'MANUAL' ? state.pendingMpesa : null;
      const hasCents = Math.round(dueAmount * 100) % 100 !== 0;

      panel.innerHTML = `
        <div class="pz-till">
          <ol class="pz-till-steps">
            <li>Customer opens <strong>M-PESA</strong> on their phone</li>
            <li>Chooses <strong>Lipa na M-PESA → Buy Goods and Services</strong></li>
            <li>Enters the <strong>Till number</strong> and <strong>Amount</strong> below, then their PIN</li>
          </ol>
          <div class="pz-till-grid">
            <div><span>Till number</span><strong id="pz-till-no">${esc(state.flags.tillNumber || '-')}</strong></div>
            <div><span>Amount</span><strong>${fm(dueAmount)}</strong></div>
          </div>
        </div>
        ${hasCents && !already ? `<div class="pz-note warn">This total has cents. M-PESA till payments are normally whole shillings, so the customer may not be able to pay the exact amount. Consider rounding with the cart discount.</div>` : ''}
        <div id="mpesa-stk-status"></div>
        ${already ? '' : `
        <div class="pz-code-box" id="pz-code-box">
          <button type="button" class="pz-linkbtn" id="pz-code-toggle">Customer paid but nothing appears? Enter the M-PESA code</button>
          <div class="pz-code-row" id="pz-code-row">
            <input class="input pz-code-input" id="pz-code" maxlength="10" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="e.g. UJK1A2B3C4" />
            <button type="button" class="btn btn-primary" id="pz-code-btn">Confirm</button>
          </div>
        </div>`}
      `;

      if (already) {
        renderMpesaStatus(modal, { tone: 'warning', label: 'Paid - sale not saved', message: `M-PESA till payment of ${fm(already.amount)} was received. Tap "Save sale" to finish. Do not start another payment.` });
        setComplete({ enabled: true, label: 'Save sale & print receipt' });
        onComplete = async () => { state.payments = [{ method: 'MPESA', amount: already.amount, reference: already.reference }]; await checkout({ btn: completeBtn }); };
        return;
      }

      setComplete({ hidden: true });
      onComplete = null;

      // Code box
      const codeRow = panel.querySelector('#pz-code-row');
      const codeInput = panel.querySelector('#pz-code');
      panel.querySelector('#pz-code-toggle').addEventListener('click', () => {
        codeRow.classList.toggle('open');
        if (codeRow.classList.contains('open')) codeInput.focus();
      });
      codeInput.addEventListener('input', () => { codeInput.value = codeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });
      codeInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') panel.querySelector('#pz-code-btn').click(); });
      panel.querySelector('#pz-code-btn').addEventListener('click', async () => {
        const code = codeInput.value.trim().toUpperCase();
        if (!/^[A-Z][A-Z0-9]{9}$/.test(code)) return window.UI.toast.error('An M-PESA code is 10 characters, e.g. UJK1A2B3C4');
        if (!modal._manualRef) return window.UI.toast.error('No payment request is active. Tap "Try again" first.');
        const btn = panel.querySelector('#pz-code-btn');
        window.UI.setButtonLoading(btn, true, 'Checking…');
        try {
          const { data } = await window.Api.post(`/payments/mpesa/${modal._manualRef}/claim`, { receiptCode: code });
          modal._handleStatus?.(data, true);
        } catch (err) {
          window.UI.toast.error(err.message);
        } finally {
          if (document.body.contains(btn)) window.UI.setButtonLoading(btn, false);
        }
      });

      async function startManualAttempt() {
        modal._manualView = null;
        renderMpesaStatus(modal, { tone: 'pending', label: 'Starting', message: 'Preparing the payment request…' });
        try {
          const { data } = await window.Api.post('/payments/mpesa/manual', {
            branchId: window.AppShell.getActiveBranchId(),
            amountCents: Math.round(dueAmount * 100),
          });
          // The cashier may have switched tab / closed the window while the request was in flight.
          if (method !== 'MPESA_TILL' || !document.body.contains(modal)) {
            window.Api.post(`/payments/mpesa/${data.reference}/cancel`, {}).catch(() => {});
            return;
          }
          modal._manualRef = data.reference;
          const tillEl = panel.querySelector('#pz-till-no');
          if (tillEl && data.tillNumber) tillEl.textContent = data.tillNumber;
          renderMpesaStatus(modal, { tone: 'pending', label: 'Waiting', message: 'Waiting for the customer to pay to the Till number…' });
          watchMpesa(modal, data.reference, { amount: dueAmount, mode: 'MANUAL', onPaid: (reference) => finalizeMpesa(reference, dueAmount) });
        } catch (err) {
          renderMpesaStatus(modal, { tone: 'error', label: 'Could not start', message: err.message, retry: true });
          window.UI.toast.error(err.message);
        }
      }

      modal._onRetry = startManualAttempt;
      startManualAttempt();
    }

    modal.querySelector('#pz-methods').addEventListener('click', (e) => {
      const b = e.target.closest('.pz-method');
      if (b) selectMethod(b.dataset.method);
    });
    modal.querySelector('[data-action="cancel"]').addEventListener('click', () => {
      clearMpesaPolling(modal);
      cancelManualAttempt(modal, () => openPaymentModal());
      window.UI.closeModal();
      $('pos-search')?.focus();
    });
    completeBtn.addEventListener('click', () => { if (onComplete) onComplete(); });

    selectMethod(method);
  }

  /* ---- M-PESA status panel + polling (shared by STK and TILL) ---- */
  function renderMpesaStatus(modal, viewState) {
    const el = modal.querySelector('#mpesa-stk-status');
    if (!el) return;
    const toneClass = { pending: 'badge-info', error: 'badge-danger', warning: 'badge-warning', success: 'badge-success' }[viewState.tone] || 'badge-neutral';
    el.innerHTML = `
      <div style="display:flex; gap:var(--space-2); align-items:flex-start; padding:var(--space-3); border-radius:var(--radius-md); background:var(--color-bg)">
        <span class="badge ${toneClass}">${esc(viewState.label)}</span>
        <span class="text-sm text-secondary" style="flex:1">${esc(viewState.message)}</span>
      </div>
      ${viewState.retry ? `<button type="button" class="btn btn-secondary btn-sm" id="mpesa-retry-btn" style="margin-top:var(--space-2)">Try again</button>` : ''}
    `;
    modal.querySelector('#mpesa-retry-btn')?.addEventListener('click', () => {
      if (modal._onRetry) modal._onRetry();
      else modal.querySelector('#mpesa-send-btn')?.click();
    });
  }

  function clearMpesaPolling(modal) {
    if (modal._mpesaPoll) { clearInterval(modal._mpesaPoll); modal._mpesaPoll = null; }
    if (modal._mpesaSlow) { clearTimeout(modal._mpesaSlow); modal._mpesaSlow = null; }
  }

  /**
   * Stops waiting on a TILL request and releases it on the server (so a stale request can never
   * make matching ambiguous for another cashier). If the customer's money arrived in the very
   * moment of cancelling, it is remembered in state.pendingMpesa and onAlreadyPaid() lets the
   * caller bring the payment window back so the sale can still be saved.
   */
  function cancelManualAttempt(modal, onAlreadyPaid) {
    const reference = modal._manualRef;
    modal._manualRef = null;
    clearMpesaPolling(modal);
    if (!reference || state.pendingMpesa) return;
    window.Api.post(`/payments/mpesa/${reference}/cancel`, {}).then(({ data }) => {
      if (data && data.status === 'SUCCESS' && !state.pendingMpesa) {
        state.pendingMpesa = { reference, amount: data.amount / 100, mode: 'MANUAL' };
        window.UI.toast.success('The customer\u2019s payment just arrived - finish the sale');
        if (onAlreadyPaid) onAlreadyPaid();
      }
    }).catch(() => { /* the server expires the request on its own */ });
  }

  /** TILL: what the cashier sees while a payment is still pending. */
  function showManualPending(modal, s) {
    const view = s.needsCode ? 'code' : 'wait';
    if (modal._manualView === view) return; // don't redraw (and flicker) on every poll
    modal._manualView = view;
    if (s.needsCode) {
      renderMpesaStatus(modal, {
        tone: 'warning',
        label: 'Enter M-PESA code',
        message: 'This payment cannot be matched automatically (another payment or request has the same amount). Ask the customer for the code in their M-PESA confirmation SMS and enter it below.',
      });
      const row = modal.querySelector('#pz-code-row');
      if (row && !row.classList.contains('open')) {
        row.classList.add('open');
        modal.querySelector('#pz-code')?.focus();
      }
    } else {
      renderMpesaStatus(modal, { tone: 'pending', label: 'Waiting', message: 'Waiting for the customer to pay to the Till number…' });
    }
  }

  /** Polls a confirmed-by-backend M-PESA request (STK or TILL) until it succeeds or fails. */
  function watchMpesa(modal, reference, { amount, mode, onPaid }) {
    clearMpesaPolling(modal);
    let handled = false;

    // One handler for the 3-second poll, the manual "check now" button and the TILL code box.
    const handleStatus = (s, manual) => {
      if (handled) return;
      if (s.status === 'SUCCESS') {
        handled = true;
        clearMpesaPolling(modal);
        // Remember the confirmed money straight away: closing or switching the window can never lose track of it.
        state.pendingMpesa = { reference, amount, mode };
        modal.querySelector('#pz-code-box')?.remove();
        renderMpesaStatus(modal, { tone: 'success', label: 'Confirmed', message: s.message || 'Payment received. Saving sale…' });
        window.UI.toast.success('M-PESA payment confirmed');
        // brief pause so "Confirmed" is actually seen, then save + print automatically
        setTimeout(() => onPaid(reference), 700);
      } else if (s.status === 'FAILED' || s.status === 'CANCELLED') {
        handled = true;
        clearMpesaPolling(modal);
        const label = mode === 'MANUAL'
          ? (s.failureType === 'timeout' ? 'No payment received' : 'Not completed')
          : (MPESA_FAILURE_LABELS[s.failureType] || 'Payment failed');
        renderMpesaStatus(modal, { tone: s.failureType === 'timeout' ? 'warning' : 'error', label, message: s.message, retry: true });
        window.UI.toast.error(label);
      } else if (mode === 'MANUAL') {
        showManualPending(modal, s);
      } else if (manual) {
        window.UI.toast.success('Still pending on M-PESA\u2019s side - keep waiting.');
      }
    };
    modal._handleStatus = handleStatus;

    modal._mpesaPoll = setInterval(async () => {
      if (!document.body.contains(modal)) { // window closed
        clearMpesaPolling(modal);
        if (mode === 'MANUAL') cancelManualAttempt(modal, () => openPaymentModal());
        return;
      }
      try {
        const { data: s } = await window.Api.get(`/payments/mpesa/${reference}/status`);
        handleStatus(s, false);
      } catch { /* transient - keep polling */ }
    }, 3000);

    if (mode === 'STK') {
      // After ~15s of silence offer a manual re-check (closing the tab never loses the payment:
      // the server-side reconciliation job still resolves it).
      modal._mpesaSlow = setTimeout(() => {
        const area = modal.querySelector('#mpesa-stk-status');
        if (!modal._mpesaPoll || !area || area.querySelector('#mpesa-check-now-btn')) return;
        area.insertAdjacentHTML('beforeend', `
          <button type="button" class="btn btn-secondary btn-sm" id="mpesa-check-now-btn" style="margin-top:var(--space-2)">Check status now</button>
          <p class="text-xs text-muted" style="margin-top:var(--space-2)">Taking a while? If the customer already entered their PIN it is still safe to wait - this does not create a second charge.</p>
        `);
        modal.querySelector('#mpesa-check-now-btn').addEventListener('click', async () => {
          try {
            const { data: s } = await window.Api.get(`/payments/mpesa/${reference}/status`);
            handleStatus(s, true);
          } catch (err) {
            window.UI.toast.error(err.message);
          }
        });
      }, 15000);
    }
  }

  function bindMpesaSend(modal, amount, { onPaid }) {
    modal.querySelector('#mpesa-send-btn').addEventListener('click', async () => {
      const phone = modal.querySelector('#pz-mpesa-phone').value.trim();
      if (!phone || !amount) return window.UI.toast.error('Enter the customer phone number first');

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
        watchMpesa(modal, reference, { amount, mode: 'STK', onPaid });
      } catch (err) {
        const failureType = err.data?.failureType;
        const label = MPESA_FAILURE_LABELS[failureType] || 'Could not send prompt';
        renderMpesaStatus(modal, { tone: 'error', label, message: err.message, retry: true });
        window.UI.toast.error(err.message);
      } finally {
        window.UI.setButtonLoading(sendBtn, false);
      }
    });
  }

  /* ================================================================== *
   * CHECKOUT
   * ================================================================== */
  function resetCart() {
    state.cart = [];
    state.customer = null;
    state.cartDiscount = 0;
    state.payments = [];
    state.pendingMpesa = null;
    state.lastAdded = null;
    checkoutKey = window.Api.newIdempotencyKey();
    const d = $('cart-discount-input');
    if (d) d.value = '';
    renderCart();
  }

  /** Returns true when the sale was saved. */
  async function checkout({ btn, change } = {}) {
    if (checkingOut) return false;
    if (!state.cart.length) { window.UI.toast.error('Cart is empty'); return false; }

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

    checkingOut = true;
    if (btn) window.UI.setButtonLoading(btn, true, 'Completing sale…');
    try {
      const { data } = await window.Api.post('/sales', payload, { idempotencyKey: checkoutKey });
      if (document.querySelector('.modal-backdrop')) window.UI.closeModal();
      window.UI.toast.success(`Sale ${data.sale.receiptNumber} completed`);
      if (change > 0) window.UI.toast.success(`Give change: ${fm(change)}`);
      // Open the receipt and ask it to print straight away.
      window.ReceiptView.showReceiptModal(data.receipt, { autoPrint: true });
      resetCart();
      loadShift();
      return true;
    } catch (err) {
      window.UI.toast.error(err.message);
      return false;
    } finally {
      checkingOut = false;
      if (btn && document.body.contains(btn)) window.UI.setButtonLoading(btn, false);
    }
  }

  /* ================================================================== *
   * SALES HISTORY VIEW
   * ================================================================== */
  function renderHistory() {
    const body = $('view-body');
    body.className = 'pz-view pz-view-history';
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

    $('history-search').addEventListener('input', window.UI.debounce((e) => {
      state.history.search = e.target.value.trim(); state.history.page = 1; fetchHistory();
    }));
    $('history-from').addEventListener('change', (e) => { state.history.from = e.target.value; state.history.page = 1; fetchHistory(); });
    $('history-to').addEventListener('change', (e) => { state.history.to = e.target.value; state.history.page = 1; fetchHistory(); });

    fetchHistory();
  }

  const PAYMENT_BADGE = { PAID: 'badge-success', PARTIAL: 'badge-warning', CREDIT: 'badge-danger', UNPAID: 'badge-neutral' };

  async function fetchHistory() {
    const tbody = $('history-tbody');
    if (!tbody) return;
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
            <td class="text-sm">${esc(s.cashierId?.name || '')}</td>
            <td class="text-sm">${s.customerId ? esc(s.customerId.name) : '<span class="text-muted">Walk-in</span>'}</td>
            <td class="font-semibold">${fm(s.total)}</td>
            <td>
              <span class="badge ${PAYMENT_BADGE[s.paymentStatus] || 'badge-neutral'}">${s.paymentStatus}</span>
              ${s.saleStatus === 'CANCELLED' ? '<span class="badge badge-neutral">Cancelled</span>' : ''}
            </td>
            <td class="actions"><button class="btn btn-secondary btn-sm" data-action="view">View</button></td>
          </tr>
        `).join('');
      }
      window.UI.renderPagination($('history-pagination'), data, (p) => { state.history.page = p; fetchHistory(); });

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
          ${window.UI.formatDateTime(sale.createdAt)} &middot; Cashier: ${esc(sale.cashierId?.name || '')}
          ${sale.customerId ? ` &middot; Customer: ${esc(sale.customerId.name)}` : ''}
        </div>
        <div class="table-wrap" style="margin-bottom: var(--space-4)">
          <table class="table">
            <thead><tr><th>Item</th><th>Qty</th><th>Total</th></tr></thead>
            <tbody>
              ${sale.items.map((i) => `<tr><td class="text-sm">${esc(i.nameSnapshot)}${i.refundedQuantity ? ` <span class="text-xs text-muted">(${i.refundedQuantity} refunded)</span>` : ''}</td><td>${i.quantity}</td><td>${fm(i.total)}</td></tr>`).join('')}
            </tbody>
          </table>
        </div>
        <div class="pos-totals-row"><span>Subtotal</span><span>${fm(sale.subtotal)}</span></div>
        <div class="pos-totals-row"><span>Tax</span><span>${fm(sale.tax)}</span></div>
        <div class="pos-totals-row grand"><span>Total</span><span>${fm(sale.total)}</span></div>
        ${sale.balance > 0 ? `<div class="pos-totals-row" style="color:var(--color-warning)"><span>Balance owed</span><span>${fm(sale.balance)}</span></div>` : ''}
        ${sale.saleStatus === 'CANCELLED' ? `<div class="form-alert form-alert-error" style="margin-top: var(--space-3)">Cancelled: ${esc(sale.cancelReason || '')}</div>` : ''}
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
   * openRefundModal - pick how many units of each still-refundable line to
   * return. The refund AMOUNT is never entered by hand: the backend computes
   * it proportionally from what was actually charged on the original sale.
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
                <span class="text-sm">${esc(i.nameSnapshot)}<br/><span class="text-xs text-muted">${i.remaining} available to refund</span></span>
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
      const btn = $('refund-save-btn');
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