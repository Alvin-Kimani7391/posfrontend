/**
 * sales.js  (REDESIGNED POS - full-screen ticket)
 *
 * One workspace with two views: "New sale" (the POS) and "Sales history".
 *
 * HYBRID RETAIL + WHOLESALE (one screen for both)
 *   Businesses that have warehouses (feature multiWarehouse - on by default for the Wholesale type) get a
 *   [Retail | Wholesale] switch in the top bar. Every other business sees the plain retail screen and nothing else.
 *   - RETAIL    : exactly the till below (shop-floor stock, retail prices, offline selling).
 *   - WHOLESALE : same ticket, same summary, same payment window - but products come from a warehouse
 *                 (GET /warehouse/catalog), every line has a Unit (piece / bundle / carton) at the wholesale
 *                 unit price, and the payment window can take a PART payment and put the rest on CREDIT with
 *                 a due date. All payment methods work (cash, M-PESA STK, M-PESA Till, bank, card, credit).
 *   Each mode keeps its own cart, so flipping the switch never loses work.
 *   Deep link: sales.html?mode=wholesale (the old wholesale-sales.html redirects there).
 *
 * LAYOUT
 *   Top bar  : tabs | shift status (open/close) | cashier + clock | view buttons
 *   Search   : scan / search bar (+ camera scan button + shortcut hints + Held sales button)
 *   Ticket   : ONE scrolling grid that takes all the free space. Every row is a
 *              product, both halves on the same line:
 *                Products -> # | Barcode | Product name | Price per unit
 *                Cart     -> Quantity | Discount | Subtotal | remove
 *   Summary  : customer, cart discount, subtotal/tax, the big TOTAL and the
 *              single "Add payment to complete sale" button (also F9).
 *
 * ADD A PRODUCT FROM THE TILL (new)
 *   When a search / scan finds nothing, the suggestions list ends with "Add '<term>' as a new product".
 *   It always works now: if the PosBoost quick-add window is not loaded, a built-in "Add product" window
 *   (name, barcode, price, cost, optional opening stock) is used. In retail the product goes straight into the cart.
 *
 * HELD SALES (new: always visible)
 *   "Park" and "Held sales" buttons are always shown in retail (no longer hidden by a feature flag), the
 *   Held sales button also sits beside the search bar with a live count, and F6 opens the manager.
 *   The manager lists every held sale (server + this device) with: Resume | Add to cart (merge) | Items |
 *   Rename (device) | Print slip | Discard | Discard all | Upload device ones | Park current cart.
 *   If the server refuses to store a parked sale, it is kept on this device instead - nothing is ever lost.
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
 *   SPLIT tab: one sale paid with several methods (Cash + M-PESA, M-PESA + Credit ...). Each line is sent as its own payment;
 *              the unpaid remainder (Credit line) is the sale balance, exactly like a part payment. M-PESA is verified by the backend.
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
 * CASH DRAWER (see js/core/cash-drawer.js)
 *   - The drawer is kept shut for every sale. It opens ONLY when a CASH sale has change
 *     to give back, the moment the sale is saved.
 *   - From then on the POS is LOCKED behind a "give change / close the drawer" screen
 *     (UI.showDrawerLock). Scans, search, F9 and the payment window are all blocked.
 *   - With a drawer sensor the lock lifts by itself when the drawer shuts; otherwise the
 *     cashier taps "Drawer is closed" (F8). F7 re-opens the drawer if it did not pop.
 *   - Shops without a drawer leave "This shop uses a cash drawer" OFF (default): no lock, just "Give change".
 *   - Exact cash, M-PESA, bank, card and credit sales never touch the drawer.
 *   - The lock survives a page reload. Leaving the drawer open > 60s, or overriding a
 *     sensor that still says "open", raises a best-effort alert to management.
 *
 * PRODUCT DISCOUNT (set on the Products page, Product.defaultDiscount, KES PER UNIT)
 *   - When a product is scanned/searched, its line discount is pre-filled with
 *     (discount per unit x quantity). The cart item is flagged `autoDiscount`.
 *   - While a line is `autoDiscount`, changing the quantity (+, -, typing)
 *     re-scales the discount, and an override price re-clamps it so it can
 *     never exceed the line total.
 *   - As soon as the cashier types a DIFFERENT discount in the line editor the
 *     line becomes manual (`autoDiscount = false`) and keeps their figure.
 *     Typing exactly the preset amount puts it back to auto.
 *   - The backend recomputes and enforces everything on "Complete sale": the
 *     preset part is trusted from the Product record, only the extra the
 *     cashier added by hand is checked against their discount limit.
 *
 * WHOLESALE (Product.wholesaleEnabled + moq + wholesalePrice, business feature wholesalePricing)
 *   - Wholesale.forItem() (js/core/wholesale.js) picks the price: once the cart holds >= MOQ of a product
 *     (all its variants / lines together) every line of it switches to the wholesale unit price, and back to
 *     retail if the quantity drops below the MOQ. A permitted price override always wins.
 *   - Online the server recomputes the same rule on "Complete sale"; offline the till charges what is shown here.
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
 * SHORTCUTS (new sale view): F2 search | Up/Down pick | Enter add | F6 held sales | F9 payment
 *   (drawer lock): F7 open drawer again | F8 drawer is closed
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
    { id: 'MOBILE_MONEY', label: 'Mobile money', ico: 'fa-solid fa-mobile-retro' },
    { id: 'BANK', label: 'Bank', ico: 'fa-solid fa-building-columns' },
    { id: 'CREDIT', label: 'Credit', ico: 'fa-solid fa-file-invoice-dollar' },
    { id: 'CARD', label: 'Card', ico: 'fa-solid fa-credit-card' },
    { id: 'SPLIT', label: 'Split', ico: 'fa-solid fa-code-branch' }, // several methods for one sale (renderSplit)
  ];

  const DEFAULT_FLAGS = { mpesaEnabled: false, etimsEnabled: false, mpesaManualEnabled: false, tillNumber: null };
  const FOCUS_KEY = 'pos.fullView';

  // Notification type used for drawer alerts to management (needs to be accepted by POST /notifications/alert).
  const DRAWER_ALERT_TYPE = 'CASH_DRAWER';

  const state = {
    view: 'new-sale',
    focus: true, // "full view": workspace pinned over the whole window
    cart: [], // { product, variant, quantity, discount, autoDiscount, overridePriceEnabled, overridePrice }
    customer: null,
    cartDiscount: 0,
    payments: [], // built when the payment window completes: { method, amount, reference, amountTendered }
    pendingMpesa: null, // { reference, amount (KES), mode: 'STK' | 'MANUAL' } - confirmed M-PESA money that has not been saved as a sale yet
    splitDraft: null, // split payment in progress: { total, preset, lines[], mpesa, pendingRef } - survives closing the payment window
    lastAdded: null, // key of the last product added
    currentShift: null,
    flags: { ...DEFAULT_FLAGS },
    history: { page: 1, limit: 10, search: '', from: '', to: '', channel: '' },
    mode: 'RETAIL', // 'RETAIL' | 'WHOLESALE' (wholesale only exists for businesses with warehouses)
    dueDate: '', // wholesale: when the credit part of an invoice is due (YYYY-MM-DD)
    pharmacy: {}, // pharmacy: { sig, rx, countersign, poisonsBook } collected before payment (see js/core/pharmacy-till.js)
  };

  // What the pharmacy desk (js/core/pharmacy-desk.js) is allowed to do to the cart.
  const pharmacyHost = {
    state,
    addLine: (product, qty) => addToCart(product, null, qty),
    removeProducts: (ids) => { state.cart = state.cart.filter((l) => !ids.includes(String(l.product._id))); renderCart(); },
    clear: () => resetCart(),
    render: () => renderCart(),
    fit: () => fitRoot(),
  };

  const esc = (s) => window.UI.escapeHtml(s == null ? '' : String(s));
  const fm = (n) => window.UI.formatMoney(n);
  const $ = (id) => document.getElementById(id);

  /* Auto-print receipt switch: remembered on this device (PosBoost's setting when it exists, otherwise our own). */
  const AUTOPRINT_KEY = 'pos.autoPrintReceipt';
  function autoPrintGet() {
    try { if (window.PosBoost && window.PosBoost.autoPrint) return !!window.PosBoost.autoPrint.get(); } catch { /* fall through */ }
    try { const v = localStorage.getItem(AUTOPRINT_KEY); return v === null ? true : v === '1'; } catch { return true; }
  }
  function autoPrintSet(on) {
    try { if (window.PosBoost && window.PosBoost.autoPrint) window.PosBoost.autoPrint.set(!!on); } catch { /* ignore */ }
    try { localStorage.setItem(AUTOPRINT_KEY, on ? '1' : '0'); } catch { /* private mode */ }
  }
  function paintAutoPrint() {
    const on = autoPrintGet();
    const cb = $('pb-autoprint'); if (cb) cb.checked = on;
    const track = $('pz-ap-track'); const knob = $('pz-ap-knob');
    if (track) track.style.background = on ? 'var(--color-success,#16a34a)' : '#cbd5e1';
    if (knob) knob.style.left = on ? '16px' : '2px';
  }

  /* ================================================================== *
   * HYBRID: retail + wholesale on one screen
   * ================================================================== */
  const MODE_KEY = 'pos.saleMode';
  const ws = { list: [], whId: '', settings: {}, ready: false, loading: null, error: '' };
  // The cart / customer / discount of the mode that is NOT on screen is parked here.
  const parked = {
    RETAIL: { cart: [], customer: null, cartDiscount: 0, key: null, lastAdded: null },
    WHOLESALE: { cart: [], customer: null, cartDiscount: 0, key: null, lastAdded: null },
  };
  let modeExplicit = false;
  let rootObserver = null;
  let lastRootW = 0;

  const WSK = () => window.WS; // wholesale-kit helpers
  const isWsBiz = () => !!(window.WS && window.AppShell.hasFeature && window.AppShell.hasFeature('multiWarehouse'));
  const isWs = () => state.mode === 'WHOLESALE' && isWsBiz();
  const wsWarehouse = () => ws.list.find((w) => String(w._id) === String(ws.whId)) || null;
  const wsDefaultUnit = (item) => item.units.find((u) => u.isDefault) || item.units.find((u) => u.isBase) || item.units[0];
  const wsUnitOf = (line) => line.catalog.units.find((u) => String(u.unitId || '') === String(line.unitId || '')) || line.catalog.units[0];
  const wsSellable = (item) => item.availableQuantity > 0 && !item.trackSerialNumber;
  const wsAvailText = (item) => item.units.map((u) => `${WSK().num(u.available)} ${u.name}`).slice(0, 3).join(' · ');
  function wsStockIssue(line) {
    if (!line.ws) return '';
    const u = wsUnitOf(line);
    return Number(line.quantity) > u.available + 1e-9 ? `Only ${WSK().num(u.available)} ${u.name} available` : '';
  }

  /** Catalog item -> a cart line shaped like a retail line, so the ticket, totals and discount window are shared. */
  function wsLineFrom(item) {
    const key = `${item.productId}:${item.variantId || ''}`;
    return {
      ws: true, key, catalog: item, productId: item.productId, variantId: item.variantId || undefined,
      product: { _id: item.productId, name: item.name, sku: item.sku || '', barcode: item.barcode || '', taxRate: 0, defaultDiscount: 0 },
      variant: null, unitId: wsDefaultUnit(item).unitId || null,
      quantity: 1, discount: 0, autoDiscount: false, overridePriceEnabled: false, overridePrice: null,
    };
  }

  /* Wholesale boot data (warehouses + settings) is cached on this device so the till paints instantly,
     then refreshed silently. Both requests run in parallel (they used to run one after the other). */
  const WS_BOOT_KEY = 'pos.wsBoot.v1';
  function readBootCache() {
    try { const c = JSON.parse(localStorage.getItem(WS_BOOT_KEY) || 'null'); return c && Array.isArray(c.list) && c.settings ? c : null; } catch { return null; }
  }
  function applyBoot(list, settings) {
    ws.list = list.filter((w) => w.status !== 'inactive' && w.allowSales !== false);
    ws.settings = settings || {};
    const active = String(window.AppShell.getActiveBranchId() || '');
    const inBranch = (w) => String(WSK().branchOf(w) || '') === active;
    const keep = ws.whId && ws.list.find((w) => w._id === ws.whId);
    const pick = keep || ws.list.find((w) => w._id === ws.settings.defaultWarehouseId)
      || ws.list.find((w) => inBranch(w) && w.isDefault) || ws.list.find(inBranch)
      || ws.list.find((w) => w.isDefault) || ws.list[0];
    ws.whId = pick ? pick._id : '';
    if (!state.dueDate) {
      const days = Number(ws.settings.defaultPaymentTermsDays) || 0;
      state.dueDate = days ? new Date(Date.now() + days * 86400000).toISOString().slice(0, 10) : '';
    }
    ws.ready = true;
  }
  async function fetchBoot() {
    const [list, settings] = await Promise.all([WSK().warehouses(true), WSK().settings()]);
    try { localStorage.setItem(WS_BOOT_KEY, JSON.stringify({ list, settings, at: Date.now() })); } catch { /* storage full/private */ }
    return { list, settings };
  }

  function ensureWsReady() {
    if (ws.ready) return Promise.resolve(true);
    if (ws.loading) return ws.loading;
    const cached = readBootCache();
    if (cached) {
      // Instant path: use what we knew last time, refresh behind the scenes.
      applyBoot(cached.list, cached.settings);
      fetchBoot().then(({ list, settings }) => {
        const before = ws.whId;
        applyBoot(list, settings);
        if (isWs() && state.view === 'new-sale' && (ws.whId !== before || !ws.list.length)) renderNewSaleView();
      }).catch(() => { /* cached data keeps working */ });
      return Promise.resolve(true);
    }
    ws.loading = (async () => {
      try {
        ws.error = '';
        const { list, settings } = await fetchBoot();
        applyBoot(list, settings);
        return true;
      } catch (e) {
        ws.error = (e && e.message) || 'Could not load warehouses';
        return false;
      } finally { ws.loading = null; }
    })();
    return ws.loading;
  }

  async function wsSearch(term) {
    const wh = wsWarehouse();
    if (!wh) throw new Error('No sellable warehouse. Create one under Warehouses & stock (turn on "Can sell").');
    const { data } = await window.Api.get('/warehouse/catalog', {
      warehouseId: ws.whId, branchId: WSK().branchOf(wh) || undefined, search: term, page: 1, limit: 15, inStockOnly: 'false',
    });
    ws.elsewhere = data.elsewhere || []; // same product stocked in another warehouse (shown when this one has no match)
    return data.items || [];
  }

  async function addWholesaleByCode(code) {
    const items = await wsSearch(code);
    const c = String(code).trim().toLowerCase();
    const exact = items.find((i) => [i.barcode, i.sku].some((v) => v && String(v).toLowerCase() === c)) || (items.length === 1 ? items[0] : null);
    if (!exact) { window.UI.toast.error(`No warehouse stock found for "${code}"`); return; }
    if (!wsSellable(exact)) { window.UI.toast.error(exact.trackSerialNumber ? `${exact.name} is serial-tracked - sell it in retail mode` : `${exact.name} is out of stock in this warehouse`); return; }
    addWholesale(exact);
  }

  function parkMode() {
    parked[state.mode] = { cart: state.cart, customer: state.customer, cartDiscount: state.cartDiscount, key: checkoutKey, lastAdded: state.lastAdded };
  }
  function loadMode(m) {
    const b = parked[m];
    state.mode = m;
    state.cart = b.cart; state.customer = b.customer; state.cartDiscount = b.cartDiscount; state.lastAdded = b.lastAdded;
    checkoutKey = b.key || window.Api.newIdempotencyKey();
  }

  /** Which sale type to open in: ?mode= link, then the last choice on this device, then wholesale for wholesale businesses. */
  function chooseInitialMode() {
    let want = null;
    try { const q = new URLSearchParams(window.location.search).get('mode'); if (q) want = q.toUpperCase(); } catch { /* ignore */ }
    if (!want) { try { want = (localStorage.getItem(MODE_KEY) || '').toUpperCase(); } catch { /* ignore */ } }
    modeExplicit = want === 'RETAIL' || want === 'WHOLESALE';
    if (!isWsBiz() || isOfflineNow()) { state.mode = 'RETAIL'; return; }
    state.mode = want === 'RETAIL' ? 'RETAIL' : 'WHOLESALE';
  }

  /** Mode switch, accent colour and the data attributes the stylesheet keys off. */
  function refreshModeUi() {
    const biz = isWsBiz();
    if (!biz && state.mode === 'WHOLESALE') { parkMode(); loadMode('RETAIL'); }
    const seg = $('pz-seg');
    if (seg) {
      seg.hidden = !biz;
      seg.dataset.mode = state.mode;
      seg.querySelectorAll('button').forEach((b) => {
        const on = b.dataset.mode === state.mode;
        b.classList.toggle('active', on);
        b.setAttribute('aria-selected', String(on));
      });
    }
    const root = $('pz-root');
    if (root) {
      root.dataset.mode = biz && state.mode === 'WHOLESALE' ? 'WHOLESALE' : 'RETAIL';
      root.dataset.view = state.view;
    }
    document.body.classList.toggle('pz-mode-wholesale', isWs() && state.view === 'new-sale');
    fitRoot();
  }

  async function setMode(next) {
    if (next === state.mode) return;
    if (next === 'WHOLESALE' && !isWsBiz()) return;
    if (state.pendingMpesa) { window.UI.toast.error('An M-PESA payment is waiting to be saved. Finish that sale first.'); return; }
    if (drawerLocked()) { window.UI.toast.error('Close the cash drawer first'); return; }
    if (next === 'WHOLESALE' && isOfflineNow()) { window.UI.toast.error('Wholesale selling needs an internet connection. Retail still works offline.'); return; }
    parkMode();
    loadMode(next);
    modeExplicit = true;
    try { localStorage.setItem(MODE_KEY, next); } catch { /* private mode - fine */ }
    refreshModeUi();
    if (state.view !== 'new-sale') return;
    if (next === 'WHOLESALE' && !ws.ready) { renderNewSaleView(); await ensureWsReady(); if (isWs()) renderNewSaleView(); return; }
    renderNewSaleView();
  }

  function onProfileChanged() {
    refreshModeUi();
    // The business profile can arrive after the till first paints: add the pharmacy switch then.
    if (window.PharmacyDesk && window.PharmacyDesk.active() && !$('ph-seg') && $('pz-root')) {
      $('pz-root').querySelector('.pz-tabs')?.insertAdjacentHTML('afterend', window.PharmacyDesk.segHtml());
      window.PharmacyDesk.bindSeg(contentEl);
      if (state.view === 'new-sale') renderNewSaleView();
    }
    if (isWsBiz() && !modeExplicit && state.mode === 'RETAIL' && !state.cart.length && !isOfflineNow()) { setMode('WHOLESALE'); return; }
    if (isWs() && !ws.ready) ensureWsReady().then(() => { if (isWs() && state.view === 'new-sale') renderNewSaleView(); });
  }

  // Retail product list kept on the device (js/core/fast-search.js): typing answers instantly instead of waiting on the server.
  const retailIndex = window.FastSearch.create({
    params: () => ({ status: 'active', channel: 'retail', branchId: (window.AppShell && window.AppShell.getActiveBranchId && window.AppShell.getActiveBranchId()) || undefined }),
    ttl: 20000,
  });
  const lookupLocal = (t) => retailIndex.search(t, 15); // array, or null when the server has to answer
  const lookupSearch = (t) => (window.Offline && window.Offline.lookup
    ? window.Offline.lookup.search(t)
    : window.Api.get('/products', { search: t, limit: 15, status: 'active', channel: 'retail', branchId: window.AppShell.getActiveBranchId() || undefined }).then((r) => r.data.items || []));
  /** Exact barcode/SKU match from the device copy: instant, no server round trip. Returns { product, variant } or null. */
  function localBarcode(code) {
    const t = String(code || '').trim().toLowerCase();
    const hits = t ? retailIndex.search(t, 8) : null;
    if (!hits) return null;
    for (const p of hits) {
      if (p._pending) continue;
      if (String(p.barcode || '').toLowerCase() === t || String(p.sku || '').toLowerCase() === t) return { product: p, variant: null };
      const v = (p.variants || []).find((x) => String(x.barcode || '').toLowerCase() === t || String(x.sku || '').toLowerCase() === t);
      if (v) return { product: p, variant: v };
      const pu = (p.units || []).find((x) => x.status !== 'inactive' && x.barcode && String(x.barcode).toLowerCase() === t);
      if (pu) return { product: p, variant: null, unitId: String(pu._id) }; // packet / carton barcode
    }
    return null;
  }
  const lookupBarcode = (c) => (window.Offline && window.Offline.lookup
    ? window.Offline.lookup.barcode(c)
    : window.Api.get(`/products/barcode/${encodeURIComponent(c.trim())}`).then((r) => r.data));
  const OFFLINE_METHODS = [
    { id: 'CASH', label: 'Cash', ico: 'fa-solid fa-money-bill-wave' },
    { id: 'MPESA_OFFLINE', label: 'M-PESA Till', ico: 'fa-solid fa-store' },
    { id: 'MOBILE_MONEY', label: 'Mobile money', ico: 'fa-solid fa-mobile-retro' },
    { id: 'BANK', label: 'Bank', ico: 'fa-solid fa-building-columns' },
    { id: 'CARD', label: 'Card', ico: 'fa-solid fa-credit-card' },
  ];
  const isOfflineNow = () => !!window.Offline && !window.Connectivity.isOnline();

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
  let boostWired = false;
  let heldTimer = null;

  // cash drawer
  let drawerUi = null;
  let drawerUnsub = null;
  let drawerKeyHandler = null;
  let drawerTimer = null;

  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    contentEl = window.AppShell.mount({ title: 'Sales' });
    if (!contentEl) return;

    try { state.focus = localStorage.getItem(FOCUS_KEY) !== '0'; } catch { state.focus = true; }

    // Retail or wholesale? Uses the cached business profile, so the till paints without waiting on the network.
    chooseInitialMode();
    contentEl.innerHTML = pageSkeleton();
    bindTopbar();
    refreshModeUi();
    applyFocus(state.focus);
    guardFocus();
    window.addEventListener('resize', fitRoot);
    window.AppShell.onProfileChange?.(onProfileChanged);

    const applyDefaultMode = () => {
      // Owner chose "open the sale screen in Retail" (Wholesale settings) and nobody picked a mode here yet.
      if (ws.ready && !modeExplicit && ws.settings.defaultMode === 'RETAIL' && isWs()) { parkMode(); loadMode('RETAIL'); refreshModeUi(); }
    };
    if (isWs()) {
      const pending = ensureWsReady();
      if (ws.ready) applyDefaultMode(); // cached: no waiting
      else pending.then(() => { applyDefaultMode(); if (state.view === 'new-sale') renderNewSaleView(); });
    }
    // Paint the till first; the shift / payment flags / cash drawer load in the background.
    renderNewSaleView();
    try { const v = new URLSearchParams(window.location.search).get('view'); if (v === 'history' || v === 'held') contentEl.querySelector(`.pz-tab[data-view="${v}"]`)?.click(); } catch { /* ignore */ }
    loadShift().catch(() => {});
    setTimeout(warmLists, 1200); // fetch the first page of history + held sales quietly, so both open instantly

    // The cash drawer module (and any unfinished "close the drawer" lock) is set up
    // after the screen is on, so a slow or missing drawer never delays selling.
    initDrawer().catch(() => {});
    window.Offline?.on('mode', () => {
      if (isOfflineNow() && isWs()) { setMode('RETAIL'); window.UI.toast.info?.('Offline: switched to retail. Wholesale needs an internet connection.'); }
      loadShift(); if (state.view === 'history') renderHistory(); else if (state.view === 'held') renderHeld();
    });
    window.Offline?.on('shift', renderShiftBanner);

    // The branch name arrives after the branch list loads (and may never arrive for roles
    // without branches.view), so fill it in when it does and whenever the branch changes.
    unsubscribeBranchesLoaded = window.AppShell.onBranchesLoaded?.(refreshCashierLabel);
    refreshCashierLabel();

    unsubscribeBranchChange = window.AppShell.onBranchChange(async () => {
      refreshCashierLabel();
      await loadShift();
      listCache.clear();
      if (state.view === 'new-sale') renderNewSaleView();
      else if (state.view === 'held') renderHeld();
      else renderHistory();
      warmLists();
    });

    // Never walk away from an open cash drawer.
    window.addEventListener('beforeunload', (e) => {
      if (drawerLocked()) { e.preventDefault(); e.returnValue = ''; }
    });
    window.addEventListener('pagehide', () => {
      leavingPage = true;
      unsubscribeBranchChange?.();
      unsubscribeBranchesLoaded?.();
      drawerUnsub?.();
      if (drawerKeyHandler) document.removeEventListener('keydown', drawerKeyHandler, true);
      clearInterval(drawerTimer);
      detachHardwareScanner();
      document.body.classList.remove('pz-focus-on', 'pz-mode-wholesale');
      rootObserver?.disconnect();
    });
  }

  /* ================================================================== *
   * Workspace shell: top bar, full view, clock
   * ================================================================== */
  function pageSkeleton() {
    return `
      <div class="pz-root" id="pz-root" data-mode="${state.mode}" data-view="new-sale">
        <header class="pz-topbar">
          <div class="pz-tabs" role="tablist">
            <button class="pz-tab active" data-view="new-sale" role="tab"><i class="fa-solid fa-cash-register" aria-hidden="true"></i> New sale</button>
            <button class="pz-tab" data-view="held" role="tab"><i class="fa-solid fa-pause" aria-hidden="true"></i> <span>Held sales</span> <span class="pz-count held-count" style="display:none">0</span></button>
            <button class="pz-tab" data-view="history" role="tab" data-requires-permission="sales.view"><i class="fa-solid fa-clock-rotate-left" aria-hidden="true"></i> <span>Sales history</span></button>
          </div>
          ${window.PharmacyDesk ? window.PharmacyDesk.segHtml() : ''}
          <div class="pz-seg" id="pz-seg" data-mode="${state.mode}" role="tablist" aria-label="Sale type" hidden>
            <button type="button" data-mode="RETAIL" role="tab"><i class="fa-solid fa-store" aria-hidden="true"></i> Retail</button>
            <button type="button" data-mode="WHOLESALE" role="tab"><i class="fa-solid fa-boxes-stacked" aria-hidden="true"></i> Wholesale</button>
          </div>
          <div class="pz-shift" id="shift-banner"></div>
          <div class="pz-top-right">
            <span class="pz-user" id="pz-user" title="${esc(cashierLabel())}">${esc(cashierLabel())}</span>
            <span class="pz-clock" id="pz-clock"></span>
            <button type="button" class="pz-iconbtn drawer-btn" id="pz-drawer-btn" style="display:none"></button>
            <button type="button" class="pz-iconbtn" id="pz-refresh-btn" title="Refresh products, held sales and history (your cart is kept)" aria-label="Refresh"><i class="fa-solid fa-rotate" aria-hidden="true"></i></button>
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
        if (btn.dataset.view === 'held' && isWs()) { // held sales are retail only: stay where we are
          btn.classList.remove('active'); contentEl.querySelector(`.pz-tab[data-view="${state.view}"]`)?.classList.add('active');
          return window.UI.toast.error('Held sales are for retail sales');
        }
        state.view = btn.dataset.view;
        refreshModeUi();
        if (state.view === 'new-sale') {
          renderNewSaleView();
        } else {
          detachHardwareScanner();
          if (state.view === 'held') renderHeld(); else renderHistory();
        }
      });
    });
    window.Permissions.applyPermissionGates(contentEl, window.AppShell.getUser());

    $('pz-seg')?.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
    if (window.PharmacyDesk) window.PharmacyDesk.bindSeg(contentEl);
    // Re-measure whenever the workspace itself changes size (sidebar open / collapsed, full view, rotation...).
    if (typeof ResizeObserver !== 'undefined' && $('pz-root')) {
      rootObserver?.disconnect();
      let raf = 0;
      rootObserver = new ResizeObserver(() => {
        const w = $('pz-root')?.clientWidth || 0;
        if (w === lastRootW) return;
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(fitRoot);
      });
      rootObserver.observe($('pz-root'));
    }

    $('pz-refresh-btn').addEventListener('click', async (ev) => {
      const btn = ev.currentTarget; if (btn.classList.contains('spinning') || btn.dataset.busy === '1') return;
      if (isOfflineNow()) return window.UI.toast.error('You are offline - nothing to refresh from the server');
      btn.dataset.busy = '1';
      btn.classList.add('spinning');
      // Spin the icon from here (does not rely on the stylesheet) and keep it turning for at least ~0.8s so it is seen.
      const icon = btn.querySelector('i');
      let spin = null;
      try { if (icon && icon.animate) spin = icon.animate([{ transform: 'rotate(0deg)' }, { transform: 'rotate(360deg)' }], { duration: 700, iterations: Infinity }); } catch { /* cosmetic */ }
      btn.disabled = true; btn.style.opacity = '.75';
      const startedAt = Date.now();
      try {
        lcDrop('h|'); lcDrop('d|'); lcDrop('held|');
        retailIndex.invalidate();
        const tasks = [retailIndex.load(), loadShift().catch(() => {}), refreshHeldCount(), refreshPromoCache && refreshPromoCache()];
        if (state.view === 'held') tasks.push(renderHeld()); else if (state.view === 'history') tasks.push(fetchHistory());
        await Promise.allSettled(tasks);
        if (state.view === 'new-sale') renderCart();
        warmLists();
        const wait = 800 - (Date.now() - startedAt);
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));
        window.UI.toast.success('Refreshed');
      } finally {
        if (spin) spin.cancel();
        btn.classList.remove('spinning'); btn.disabled = false; btn.style.opacity = ''; delete btn.dataset.busy;
      }
    });
    $('pz-focus-btn').addEventListener('click', () => applyFocus(!state.focus));
    $('pz-fs-btn').addEventListener('click', toggleBrowserFullscreen);
    $('pz-drawer-btn').addEventListener('click', () => {
      if (window.CashDrawer) window.CashDrawer.openSetup();
      else window.UI.toast.error('The cash drawer module could not be loaded');
    });
    document.addEventListener('fullscreenchange', renderViewButtons);
    guardScannerEnter();

    tickClock();
    clearInterval(clockTimer);
    clockTimer = setInterval(tickClock, 15000);
    renderViewButtons();
  }

  /**
   * A barcode scanner types the code and then presses Enter. If a top-bar button (Full view, Full screen, Refresh...)
   * still has keyboard focus from the last click, that Enter "clicks" it - which flipped the till out of full view /
   * full screen on every scan. Two guards: (1) after a top-bar button is clicked, hand focus back to the search box;
   * (2) an Enter that arrives as part of a fast scanner burst never activates a button.
   */
  let scannerGuardOn = false;
  function guardScannerEnter() {
    if (scannerGuardOn) return;
    scannerGuardOn = true;
    const root = () => $('pz-root');
    document.addEventListener('click', (e) => {
      const b = e.target && e.target.closest ? e.target.closest('.pz-topbar .pz-iconbtn') : null;
      if (!b || b.id === 'pz-drawer-btn') return;
      setTimeout(() => {
        if (document.querySelector('.modal-backdrop')) return;
        try { b.blur(); } catch { /* ignore */ }
        if (state.view === 'new-sale') $('pos-search')?.focus({ preventScroll: true });
      }, 0);
    });
    let lastKey = 0;
    document.addEventListener('keydown', (e) => {
      const now = performance.now(); const gap = now - lastKey; lastKey = now;
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const a = document.activeElement;
      const r = root();
      if (!a || !r || !r.contains(a) || a.tagName !== 'BUTTON') return;
      if (gap < 60) { e.preventDefault(); } // typed by a scanner, not a person
    }, true);
  }

  function tickClock() {
    const el = $('pz-clock');
    if (!el) { clearInterval(clockTimer); return; }
    el.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function applyFocus(on) {
    state.focus = !!on;
    try { localStorage.setItem(FOCUS_KEY, state.focus ? '1' : '0'); } catch { /* private mode - fine */ }
    syncFocusClasses();
    renderViewButtons();
    fitRoot();
  }

  /** Puts the full-view classes back to match state.focus (only touches the DOM when something drifted). */
  let leavingPage = false;
  function syncFocusClasses() {
    if (leavingPage) return;
    const root = $('pz-root');
    if (root && root.classList.contains('pz-focus') !== state.focus) root.classList.toggle('pz-focus', state.focus);
    if (document.body.classList.contains('pz-focus-on') !== state.focus) document.body.classList.toggle('pz-focus-on', state.focus);
  }

  /**
   * Full view must stay on until the cashier turns it off. Something else (the app shell re-rendering, the page coming
   * back from the back/forward cache or from another tab, the browser leaving full screen) can strip the classes, which
   * dropped the till back into the normal "section" layout. Watch for that and put them back.
   */
  let focusGuardOn = false;
  function guardFocus() {
    if (focusGuardOn) return;
    focusGuardOn = true;
    try {
      const mo = new MutationObserver(() => { if (state.focus) syncFocusClasses(); });
      mo.observe(document.body, { attributes: true, attributeFilter: ['class'] });
      const root = $('pz-root'); if (root) mo.observe(root, { attributes: true, attributeFilter: ['class'] });
    } catch { /* observers unsupported: the event handlers below still cover the common cases */ }
    const heal = () => { leavingPage = false; syncFocusClasses(); fitRoot(); };
    window.addEventListener('pageshow', heal);
    window.addEventListener('focus', heal);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) heal(); });
    document.addEventListener('fullscreenchange', heal);
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

  /**
   * Layout is decided from the width the workspace REALLY has (not the browser window), so an open sidebar,
   * the collapsed rail, full view and phones all get a layout that fits. See the header of css/pos.css.
   */
  function applySizeClasses(root) {
    const cs = window.getComputedStyle(root);
    const w = Math.max(0, root.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0));
    if (!w) return;
    lastRootW = root.clientWidth;
    const wsMode = root.dataset.mode === 'WHOLESALE';
    const bucket = w >= 1280 ? 'xl' : w >= 1040 ? 'lg' : w >= 800 ? 'md' : w >= 560 ? 'sm' : 'xs';
    const side = w >= 800;
    const summaryW = bucket === 'xl' ? 380 : bucket === 'lg' ? 340 : 310;
    // Pharmacy "Dispense prescription": the prescription gets its own column beside the cart when there is room (see pharmacy-desk.js).
    const rxCol = side && root.classList.contains('ph-rx') && w >= 1180 ? (w >= 1400 ? 360 : 320) : 0;
    root.style.setProperty('--ph-rx-w', `${rxCol}px`);
    root.classList.toggle('ph-rx-side', rxCol > 0);
    const ticketW = side ? w - summaryW - 12 - (rxCol ? rxCol + 12 : 0) : w;
    const wide = ticketW >= (wsMode ? 940 : 700);
    const bc = wide && ticketW >= (wsMode ? 1120 : 900);
    ['xs', 'sm', 'md', 'lg', 'xl'].forEach((b) => root.classList.toggle(`pz-w-${b}`, b === bucket));
    root.classList.toggle('pz-side', side);
    root.classList.toggle('pz-wide', wide);
    root.classList.toggle('pz-bc', bc);
  }

  /** In full view the CSS pins the workspace; otherwise it is sized to the space under the app bar. */
  function fitRoot() {
    const root = $('pz-root');
    if (!root) return;
    applySizeClasses(root);
    if (state.focus) { root.style.height = ''; return; }
    const top = root.getBoundingClientRect().top + window.scrollY;
    root.style.height = `${Math.max(window.innerHeight - top - 12, 520)}px`;
  }

  /* ================================================================== *
   * CASH DRAWER (UI side - hardware and lock state live in cash-drawer.js)
   * ================================================================== */
  function drawerLocked() {
    return !!(window.CashDrawer && window.CashDrawer.isLocked());
  }

  async function initDrawer() {
    try { await window.AppShell.whenCashDrawerReady?.(); } catch { /* the POS works without a drawer */ }
    const drawer = window.CashDrawer;
    if (!drawer) { renderDrawerButton(); return; }

    drawerUnsub?.();
    drawerUnsub = drawer.on(onDrawerEvent);

    // F7 / F8 work from anywhere (even with a text box focused) while the lock is up.
    if (drawerKeyHandler) document.removeEventListener('keydown', drawerKeyHandler, true);
    drawerKeyHandler = (e) => {
      if (!drawerLocked() || document.querySelector('.modal-backdrop')) return;
      if (e.key === 'F7') { e.preventDefault(); reopenDrawer(); }
      else if (e.key === 'F8') { e.preventDefault(); confirmDrawerClosed(); }
    };
    document.addEventListener('keydown', drawerKeyHandler, true);

    renderDrawerButton();
    showDrawerLock(); // restores the lock screen after a reload
  }

  function onDrawerEvent(ev) {
    switch (ev.type) {
      case 'lock':
      case 'phase':
      case 'reading':
        showDrawerLock();
        break;
      case 'overdue':
        showDrawerLock();
        raiseDrawerAlert(
          `Cash drawer has been open for over a minute${ev.lock?.receiptNumber ? ` (receipt ${ev.lock.receiptNumber})` : ''}.`,
          { drawerEvent: 'left_open', receiptNumber: ev.lock?.receiptNumber, changeDue: toCents(ev.lock?.change), amountTendered: toCents(ev.lock?.tendered), drawerOpenSeconds: 60 }
        );
        break;
      case 'unlock':
        hideDrawerLock();
        if (ev.done && ev.done.method !== 'other-tab') window.UI.toast.success('Drawer closed - ready for the next sale');
        break;
      default:
    }
    renderDrawerButton();
  }

  function toCents(n) { return Math.round((Number(n) || 0) * 100); }

  function showDrawerLock() {
    const drawer = window.CashDrawer;
    const lock = drawer && drawer.getLock();
    if (!lock) { hideDrawerLock(); return; }

    window.BarcodeScanner?.setPaused(true);
    if (!drawerUi) {
      drawerUi = window.UI.showDrawerLock({
        onReopen: reopenDrawer,
        onConfirm: confirmDrawerClosed,
        onSetup: () => drawer.openSetup(),
      });
      clearSearch();
      clearInterval(drawerTimer);
      drawerTimer = setInterval(paintDrawerLock, 1000);
    }
    paintDrawerLock();
  }

  function hideDrawerLock() {
    clearInterval(drawerTimer);
    drawerTimer = null;
    if (drawerUi) { drawerUi.close(); drawerUi = null; }
    window.BarcodeScanner?.setPaused(false);
    // The lock screen made the page inert; give the keyboard back to the search box.
    setTimeout(() => { if (state.view === 'new-sale' && !document.querySelector('.modal-backdrop')) $('pos-search')?.focus(); }, 0);
  }

  /** Works out what the lock screen should say from the drawer's current phase / sensor reading. */
  function paintDrawerLock() {
    const drawer = window.CashDrawer;
    const lock = drawer && drawer.getLock();
    if (!drawerUi || !lock) return;
    const st = drawer.status();
    const seconds = Math.max(0, Math.round((Date.now() - (lock.openedAt || lock.createdAt)) / 1000));

    const view = {
      change: lock.change, tendered: lock.tendered, due: lock.due, receiptNumber: lock.receiptNumber,
      seconds, overdue: !!lock.overdue,
      tone: 'info', message: '', confirmVisible: true, confirmLabel: 'Drawer is closed', canReopen: true,
    };

    if (lock.phase === 'opening') {
      view.message = 'Opening the cash drawer…';
      view.confirmVisible = false;
      view.canReopen = false;
    } else if (lock.phase === 'manual') {
      view.tone = 'warn';
      view.message = 'No cash drawer is connected. Open it with the No-Sale key, give the change, close it, then confirm.';
      view.canReopen = false;
    } else if (lock.phase === 'failed') {
      view.tone = 'error';
      view.message = 'The drawer did not open. Press "Open drawer again", or open it manually.';
    } else if (st.canSense) {
      view.message = lock.reading === 'open'
        ? 'Drawer is open. Give the change, then push it shut - this screen unlocks by itself.'
        : 'Waiting for the drawer…';
      // The sensor decides. A manual override only appears once the drawer has been open too long.
      view.confirmVisible = !!lock.overdue;
      view.confirmLabel = 'Sensor stuck? Confirm closed';
    } else {
      view.message = 'Drawer opened. Give the change, close the drawer, then confirm.';
    }

    if (lock.overdue) {
      view.tone = 'error';
      view.message += ' The drawer has been open too long.';
    }
    drawerUi.update(view);
  }

  async function reopenDrawer() {
    const drawer = window.CashDrawer;
    if (!drawer || !drawer.isLocked()) return;
    const res = await drawer.reopen();
    if (res && !res.ok && res.reason !== 'no-device') window.UI.toast.error(res.error || 'The drawer did not respond');
  }

  async function confirmDrawerClosed() {
    const drawer = window.CashDrawer;
    const lock = drawer && drawer.getLock();
    if (!lock) return;

    if (drawer.status().canSense && lock.reading === 'open') {
      const ok = await window.UI.confirmDialog({
        title: 'The sensor says the drawer is still open',
        message: 'Only confirm if the drawer is physically closed. Management will be told that the sensor was overridden.',
        confirmText: 'Yes, it is closed',
        danger: true,
      });
      if (!ok) return;
      const done = drawer.release({ method: 'override' });
      if (done) {
        raiseDrawerAlert(
          `Cash drawer closed by manual override${done.receiptNumber ? ` (receipt ${done.receiptNumber})` : ''} while the sensor still read open.`,
          { drawerEvent: 'override', closeMethod: 'override', receiptNumber: done.receiptNumber, changeDue: toCents(done.change), amountTendered: toCents(done.tendered), drawerOpenSeconds: done.seconds }
        );
      }
      return;
    }
    drawer.release({ method: 'manual' });
  }

  function renderDrawerButton() {
    const b = $('pz-drawer-btn');
    if (!b) return;
    const drawer = window.CashDrawer;
    if (!drawer) { b.style.display = 'none'; return; }
    const st = drawer.status();
    const locked = drawer.isLocked();
    const tone = locked ? 'open' : st.connected ? 'ok' : 'off';
    b.style.display = '';
    b.className = `pz-iconbtn drawer-btn drawer-${tone}`;
    b.innerHTML = `<i class="fa-solid fa-box-open" aria-hidden="true"></i><i class="drawer-dot" aria-hidden="true"></i>`;
    b.title = locked ? 'Cash drawer is open - close it to continue'
      : !st.enabled ? 'No cash drawer in use - tap to set up'
        : st.connected ? `Cash drawer ready (${st.label}) - settings`
          : 'Cash drawer: manual mode - tap to connect';
    b.setAttribute('aria-label', b.title);
  }

  /** Best effort: tell management about drawer problems. Never blocks or breaks the sale. */
  function raiseDrawerAlert(message, data) {
    window.Api.post('/notifications/alert', {
      type: DRAWER_ALERT_TYPE,
      message,
      branchId: window.AppShell.getActiveBranchId(),
      data,
    }).then(() => window.NotificationCenter?.refresh?.()).catch(() => { /* optional feature */ });
  }

  /** With a drawer sensor, true when the drawer is physically open right now. */
  async function drawerIsOpen() {
    const drawer = window.CashDrawer;
    if (!drawer || !drawer.status().canSense) return false;
    return (await drawer.readState()) === 'open';
  }

  /* ================================================================== *
   * Barcode scanning + keyboard shortcuts
   * ================================================================== */
  function attachHardwareScanner() {
    hardwareScannerUnsub?.();
    if (window.BarcodeScanner) {
      hardwareScannerUnsub = window.BarcodeScanner.listenHardwareScanner(handleScannedCode, {
        onBlocked: () => window.UI.toast.error('Close the cash drawer before scanning the next sale'),
      });
    }
    if (keyHandler) document.removeEventListener('keydown', keyHandler);
    keyHandler = (e) => {
      if (state.view !== 'new-sale' || document.querySelector('.modal-backdrop') || drawerLocked()) return;
      if (e.key === 'F9') { e.preventDefault(); openPaymentModal(); }
      if (e.key === 'F2') { e.preventDefault(); $('pos-search')?.focus(); $('pos-search')?.select(); }
      if (e.key === 'F6' && canHeld() && !isWs()) { e.preventDefault(); recallSale(); }
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
    // A drawer that is still open means the previous sale is not finished.
    if (drawerLocked()) { window.UI.toast.error('Close the cash drawer before scanning the next sale'); return; }
    // The same code arriving twice within a blink (scanner + focused search box) is one scan.
    const now = Date.now();
    if (code === lastScan.code && now - lastScan.at < 350) return;
    lastScan = { code, at: now };

    try {
      if (isWs()) await addWholesaleByCode(code);
      else {
        const data = localBarcode(code) || await lookupBarcode(code);
        if (!data.unitId && !data.variant) { const pu = packetUnitForCode(data.product, code); if (pu) data.unitId = String(pu._id); }
        if (await ensureRetailStock(data.product, data.variant)) {
          if (data.unitId && unitByIdOf(data.product, data.unitId)) await addUnitScan(data.product, data.unitId); // a packet / carton barcode
          else addToCart(data.product, data.variant);
        }
      }
    } catch (err) {
      if (err.code === 'BARCODE_NOT_FOUND' && !isWs()) { openQuickAdd({ barcode: code }); return; }
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
    const off = window.Offline;

    if (off && !window.Connectivity.isOnline()) {
      await off.init();
      state.currentShift = off.shifts.current();
      const ctx = off.context.get();
      state.flags = { ...DEFAULT_FLAGS, tillNumber: (ctx && ctx.mpesaTill) || null };
      renderShiftBanner();
      return;
    }

    const [shiftResult, flagsResult] = await Promise.allSettled([
      window.Api.get('/shifts/current', { branchId }),
      window.Api.get('/settings/integrations/flags'),
    ]);
    state.currentShift = shiftResult.status === 'fulfilled' ? shiftResult.value.data.shift : null;
    state.flags = flagsResult.status === 'fulfilled' ? { ...DEFAULT_FLAGS, ...flagsResult.value.data } : { ...DEFAULT_FLAGS };

    if (off && shiftResult.status === 'fulfilled') {
      await off.init();
      const local = off.shifts.current();
      // A shift opened offline is the truth until the server has it (and while its close is still waiting).
      if (local && local.offline) state.currentShift = local;
      else await off.shifts.syncServer(state.currentShift);
    }
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
    const offlineMode = isOfflineNow();
    try {
      if (offlineMode) registers = await window.Offline.catalog.registers();
      else registers = (await window.Api.get('/registers', { branchId })).data.registers;
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
        if (offlineMode) {
          const reg = registers.find((r) => r._id === raw.registerId) || {};
          await window.Offline.shifts.open({ registerId: raw.registerId, registerName: reg.name, registerCode: reg.code, openingCash: Number(raw.openingCash) || 0 });
          window.UI.toast.success('Shift opened on this till (it will sync when online)');
        } else {
          await window.Api.post('/shifts/open', { branchId, registerId: raw.registerId, openingCash: raw.openingCash });
          window.UI.toast.success('Shift opened');
        }
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
    const shift = state.currentShift;
    // A shift opened offline, or any close while offline, travels through the ordered outbox.
    const viaOutbox = !!window.Offline && (shift.offline || !window.Connectivity.isOnline());
    window.CashCount.openCountModal({
      title: 'Close shift',
      intro: 'Count the cash in the drawer and enter how many of each note and coin you have. The total is added up for you, and the system compares it with what the drawer should hold.',
      confirmText: 'Close shift',
      confirmClass: 'btn-danger',
      onSubmit: async ({ denominations, notes }) => {
        if (viaOutbox) {
          const r = await window.Offline.shifts.close({ denominations, notes });
          window.UI.closeModal();
          const modal = window.UI.openModal({
            title: 'Shift closed on this till', maxWidth: '460px',
            bodyHtml: `<div class="pos-totals-row grand"><span>Cash counted</span><span>${fm(r.totalCents / 100)}</span></div>
              <p class="text-sm text-secondary" style="margin-top:var(--space-3)">Saved on this till. The over/short result is worked out when it syncs, and your manager is told if the drawer is short.</p>`,
            footerHtml: '<button class="btn btn-primary" data-action="close">Done</button>',
          });
          modal.querySelector('[data-action="close"]').addEventListener('click', window.UI.closeModal);
          loadShift();
          return;
        }
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
  function round2(n) { return Math.round(n * 100) / 100; }

  function barcodeOf(product, variant) {
    return (variant && variant.barcode) || product.barcode || '';
  }
  function nameOf(product, variant) {
    const attrs = variant ? Object.values(variant.attributes || {}).join(', ') : '';
    return attrs ? `${product.name} (${attrs})` : product.name;
  }
  /** Retail / wholesale price info for a cart line (ignores any manual override). */
  function priceInfoOf(item) {
    if (item.ws) {
      const p = wsUnitOf(item).wholesalePrice / 100; // the warehouse catalog sends cents
      return { unit: p, priceType: 'WHOLESALE', retail: p, wholesale: null, moq: null };
    }
    const lu = lineUnitOf(item);
    if (lu) { const up = unitPriceFor(item.product, item.variant, lu); return { unit: up, priceType: 'RETAIL', retail: up, wholesale: null, moq: null }; }
    return window.Wholesale ? window.Wholesale.forItem(state.cart, item) : { unit: item.variant ? item.variant.sellingPrice : item.product.sellingPrice, priceType: 'RETAIL', retail: item.variant ? item.variant.sellingPrice : item.product.sellingPrice, wholesale: null, moq: null };
  }
  function unitPriceOf(item) {
    if (item.overridePriceEnabled && item.overridePrice != null) return item.overridePrice;
    return priceInfoOf(item).unit;
  }

  /* ---- Product discount (per unit, set on the Products page) ---- */

  /** The product's standing discount PER UNIT in KES (0 when none). */
  function unitDiscountOf(product) {
    const d = Number(product && product.defaultDiscount);
    return Number.isFinite(d) && d > 0 ? d : 0;
  }

  /** The preset discount for this cart line right now: per-unit x quantity, never above the line total. */
  function autoDiscountFor(item) {
    const lu0 = lineUnitOf(item);
    const per = unitDiscountOf(item.product) * (lu0 ? Number(lu0.factor) : 1);
    if (per <= 0) return 0;
    const gross = round2(unitPriceOf(item) * item.quantity);
    return Math.min(round2(per * item.quantity), gross);
  }

  /** Keeps a line's discount valid after a quantity or price change. */
  function syncAutoDiscount(item) {
    if (item.autoDiscount) {
      item.discount = autoDiscountFor(item);
    } else {
      const gross = round2(unitPriceOf(item) * item.quantity);
      if ((item.discount || 0) > gross) item.discount = gross;
    }
  }

  /** Small "wholesale X from N" line under a search result's price. */
  function wholesaleSearchHint(r) {
    const W = window.Wholesale;
    if (!W || !W.featureOn() || !r.product.wholesaleEnabled || !(Number(r.product.moq) > 0)) return '';
    const wp = W.priceOf(r.product, r.variant);
    return wp === null ? '' : `<small>${fm(wp)} from ${r.product.moq}</small>`;
  }

  /** Neutral grey placeholder in the shape of the till (search + product list on the left, ticket on the right). */
  function wsLoadingHtml() {
    const sk = (h, w = '100%', x = '') => `<div class="skeleton" style="height:${h}px;width:${w};${x}"></div>`;
    const row = `<div class="pz-load-row">${sk(36, '36px', 'border-radius:var(--radius-sm)')}<div style="flex:1">${sk(12, '55%')}${sk(10, '30%', 'margin-top:8px')}</div>${sk(14, '72px')}</div>`;
    return `<div class="pz-load" role="status" aria-label="Loading the wholesale till">
      <div class="pz-load-main">${sk(44, '100%', 'border-radius:var(--radius-md)')}<div class="pz-load-list">${row.repeat(7)}</div></div>
      <aside class="pz-load-side">${sk(14, '40%')}${sk(40, '100%', 'margin-top:16px;border-radius:var(--radius-md)')}${sk(12, '100%', 'margin-top:28px')}${sk(12, '100%', 'margin-top:12px')}${sk(12, '70%', 'margin-top:12px')}${sk(48, '100%', 'margin-top:36px;border-radius:var(--radius-md)')}</aside>
    </div>`;
  }

  function renderWsUnavailable(body) {
    const loading = !!ws.loading;
    if (loading) { body.innerHTML = wsLoadingHtml(); return; }
    body.innerHTML = `
      <div class="card">
        <div class="pz-empty">
          <i class="fa-solid fa-warehouse" aria-hidden="true"></i>
          <strong>Wholesale is not ready</strong>
          ${esc(ws.error || 'Turn on "Warehouse & retail stock" in Settings > Business type & features.')}
          <div style="margin-top:var(--space-4);display:flex;gap:var(--space-2);justify-content:center;flex-wrap:wrap">
            <button class="btn btn-primary" id="ws-retry">Try again</button>
            <button class="btn btn-secondary" id="ws-to-retail">Switch to retail</button></div>
        </div>
      </div>`;
    $('ws-retry')?.addEventListener('click', async () => { renderWsUnavailable(body); await ensureWsReady(); if (isWs()) renderNewSaleView(); });
    $('ws-to-retail')?.addEventListener('click', () => setMode('RETAIL'));
  }

  function renderNewSaleView() {
    const body = $('view-body');
    body.className = 'pz-view pz-view-pos';
    const wsOn = isWs();
    if (wsOn && !ws.ready) { detachHardwareScanner(); renderWsUnavailable(body); return; }

    body.innerHTML = `
      <div class="card pz-searchbar">
        <div class="pz-search-row">
          <div class="pz-searchwrap" id="pz-searchwrap">
            <div class="input-group">
              <span class="input-group-icon">${window.Icons.get('search')}</span>
              <input class="input" id="pos-search" type="text" autocomplete="off" autofocus placeholder="${wsOn ? 'Scan a barcode or search warehouse stock by name / SKU' : 'Scan a barcode or search a product by name / SKU'}" />
            </div>
            <div class="pz-dd" id="pz-dd" role="listbox"></div>
          </div>
          ${wsOn ? `
            <label class="pz-wh" title="The warehouse this invoice sells from">
              <i class="fa-solid fa-warehouse" aria-hidden="true"></i>
              <select id="pz-wh" aria-label="Warehouse">${ws.list.length ? WSK().whOptions(ws.list, ws.whId) : '<option value="">No sellable warehouse</option>'}</select>
            </label>` : ''}
          ${window.BarcodeScanner ? `
            <button type="button" class="btn btn-primary pz-scan-btn" id="pos-scan-btn">
              ${window.BarcodeScanner.cameraIconSvg} <span class="pz-scan-label">Scan barcode</span>
            </button>` : ''}
          <label class="pz-autoprint" id="pz-autoprint-wrap" title="Print the receipt automatically after each sale. When off, no receipt opens after a sale (reprint any time from Sales history)." style="display:inline-flex;align-items:center;gap:8px;padding:0 12px;height:40px;border:1px solid var(--color-border);border-radius:var(--radius-md,10px);background:var(--color-surface,#fff);cursor:pointer;white-space:nowrap;font-size:13px;font-weight:600;user-select:none">
            <input type="checkbox" id="pb-autoprint" ${autoPrintGet() ? 'checked' : ''} style="position:absolute;opacity:0;width:0;height:0" />
            <span id="pz-ap-track" style="position:relative;width:34px;height:20px;border-radius:999px;flex:none;transition:background .15s"><span id="pz-ap-knob" style="position:absolute;top:2px;width:16px;height:16px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.3);transition:left .15s"></span></span>
            <span>Receipt</span>
          </label>
          <div class="pz-keys" aria-hidden="true">
            <span><kbd class="kbd">F2</kbd> search</span>
            <span><kbd class="kbd">↑</kbd><kbd class="kbd">↓</kbd> pick</span>
            <span><kbd class="kbd">Enter</kbd> add</span>
            ${!wsOn && canHeld() ? '<span><kbd class="kbd">F6</kbd> held</span>' : ''}
            <span><kbd class="kbd">F9</kbd> payment</span>
          </div>
        </div>
        <div class="ph-till" id="ph-till-bar" style="display:none"></div>
        <div id="ph-desk" style="display:none"></div>
      </div>

      <div class="pz-main">
        ${window.PharmacyDesk && window.PharmacyDesk.active() && !wsOn ? '<aside class="card ph-rxside" id="ph-rxside" aria-label="Prescription" hidden></aside>' : ''}
        <section class="card pz-ticketwrap" aria-label="Ticket">
          <div class="pz-hr pz-hgroup">
            <div class="pz-left"><h3>${wsOn ? 'Warehouse stock' : 'Products'}</h3></div>
            <div class="pz-rgt"><h3>${wsOn ? 'Invoice' : 'Cart'} <span class="pz-count" id="pz-count">0</span></h3></div>
          </div>
          <div class="pz-hr pz-hlabels">
            <div class="pz-left"><span>#</span><span class="pz-c-bc">Barcode</span><span>Product name</span><span class="pz-right">Price per unit</span></div>
            <div class="pz-rgt"><span>Quantity</span>${wsOn ? '<span>Unit</span>' : ''}<span>Discount</span><span class="pz-right">Subtotal</span><span></span></div>
          </div>
          <div class="pz-tbody" id="pz-ticket"></div>
          <div class="pz-tfoot">
            <div class="pz-tfoot-stats" id="pz-products-foot"></div>
            <div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end">
              ${!wsOn && canHeld() ? '<button class="btn btn-secondary btn-sm" id="park-btn" title="Park this cart and serve the next customer"><i class="fa-solid fa-pause" aria-hidden="true"></i> Park</button><button class="btn btn-secondary btn-sm" id="recall-btn" title="View, resume, merge, print or discard held sales (F6)"><i class="fa-solid fa-rotate-left" aria-hidden="true"></i> Held sales <span class="pz-count held-count" style="display:none">0</span></button>' : ''}
              ${!wsOn && canPromo() ? '<button class="btn btn-secondary btn-sm" id="offers-btn" title="Check promotions for this cart"><i class="fa-solid fa-tags" aria-hidden="true"></i> Offers</button>' : ''}
              <button class="btn btn-ghost btn-sm" id="clear-cart-btn"><i class="fa-solid fa-trash-can" aria-hidden="true"></i> Clear all</button>
            </div>
          </div>
        </section>

        <aside class="card pz-summary" aria-label="${wsOn ? 'Invoice summary' : 'Sale summary'}">
          <div class="pz-sum-head"><h3>${wsOn ? 'Invoice summary' : 'Sale summary'}</h3>${wsOn ? '<span class="pz-chip"><i class="fa-solid fa-boxes-stacked" aria-hidden="true"></i> Wholesale</span>' : ''}</div>
          <div class="pz-sum-body">
            <button class="btn btn-secondary pz-cust-btn" id="pick-customer-btn"></button>
            <p class="pz-sum-hint" id="pz-cust-hint"></p>
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
    retailIndex.load(); // download the product list in the background so searching is instant
    bindScanButton();
    bindTicketEvents();
    renderCart();

    $('park-btn')?.addEventListener('click', parkSale);
    $('recall-btn')?.addEventListener('click', recallSale);
        refreshHeldCount(); if (!heldTimer) heldTimer = setInterval(refreshHeldCount, 30000);
    $('offers-btn')?.addEventListener('click', () => {
      if (!state.cart.length) return window.UI.toast.error('The cart is empty');
      schedulePromoQuote(true);
    });
    $('clear-cart-btn').addEventListener('click', async () => {
      if (!state.cart.length) return;
      const ok = await window.UI.confirmDialog({ title: wsOn ? 'Clear invoice?' : 'Clear cart?', confirmText: 'Clear', danger: true });
      if (ok) resetCart();
    });
    $('cart-discount-input').addEventListener('input', (e) => {
      state.cartDiscount = Math.max(Number(e.target.value) || 0, 0);
      renderTotals();
    });
    $('pick-customer-btn').addEventListener('click', () => {
      if (isOfflineNow()) return window.UI.toast.error('Customers are not available offline. Sell to a walk-in customer.');
      window.CustomerPicker.open({ onSelect: (customer) => { state.customer = customer; renderCustomerButton(); } });
    });
    $('pz-wh')?.addEventListener('change', async (e) => {
      if (state.cart.length) {
        const ok = await window.UI.confirmDialog({ title: 'Change warehouse?', message: 'The invoice lines are cleared because stock is counted per warehouse.', confirmText: 'Change warehouse', danger: true });
        if (!ok) { e.target.value = ws.whId; return; }
        state.cart = []; state.lastAdded = null; checkoutKey = window.Api.newIdempotencyKey(); if (window.BatchTill) window.BatchTill.clear();
        renderCart();
      }
      ws.whId = e.target.value;
      clearSearch();
      $('pos-search')?.focus();
    });

    $('ph-till-bar')?.addEventListener('ph-attach', () => {
      window.PharmacyTill.prepare(state.cart, (r) => { state.pharmacy = r; renderCart(); }, state.pharmacy);
    });
    if (window.PharmacyDesk && !wsOn) window.PharmacyDesk.bind(pharmacyHost);

    attachHardwareScanner();
    paintAutoPrint();
    $('pb-autoprint')?.addEventListener('change', (e) => {
      autoPrintSet(e.target.checked);
      paintAutoPrint();
      window.UI.toast.success(e.target.checked ? 'Receipts will print automatically after each sale' : 'Receipt off: no receipt will show after a sale (find it in Sales history)');
    });
    if (window.PosBoost && !boostWired) {
      boostWired = true;
      window.PosBoost.keepScannerReady(() => (state.view === 'new-sale' ? $('pos-search') : null)); // scanner always typing into the search box
      window.PosBoost.onChange(() => { retailIndex.invalidate(); retailIndex.load(); });
    }
    fitRoot();
    if (!drawerLocked()) $('pos-search')?.focus();
  }

  function renderCustomerButton() {
    const b = $('pick-customer-btn');
    if (!b) return;
    const needCust = isWs() && !!ws.settings.requireCustomerForWholesale;
    const c = state.customer;
    b.innerHTML = `${window.Icons.get('employees')} ${c ? esc(c.name) : (needCust ? 'Choose customer (required)' : 'Walk-in customer')}`;
    b.title = c ? 'Change customer' : 'Tap to add a customer (needed for credit)';
    b.classList.toggle('pz-need', needCust && !c);
    const hint = $('pz-cust-hint');
    if (hint) {
      if (c && isWs() && c.outstandingBalance > 0) hint.textContent = `${c.name} already owes ${fm(c.outstandingBalance)}.`;
      else if (isWs()) hint.textContent = needCust ? 'A customer is required on every wholesale invoice.' : 'Choose a customer to take a part payment or sell on credit.';
      else hint.textContent = '';
      hint.style.display = hint.textContent ? '' : 'none';
    }
  }

  function bindScanButton() {
    $('pos-scan-btn')?.addEventListener('click', () => {
      if (drawerLocked()) { window.UI.toast.error('Close the cash drawer before scanning the next sale'); return; }
      window.BarcodeScanner.openCameraModal({
        title: 'Scan product barcode',
        onDetect: (code) => handleScannedCode(code),
      });
    });
  }

  /** Search-row note for a retail product that is still only in a warehouse. */
  function retailStockNote(product) {
    const h = product && product.stockHint;
    if (!isWsBiz() || !h || h.retailQuantity > 0 || !h.warehouses || !h.warehouses.length || product.trackInventory === false) return '';
    const where = h.warehouses.map((w) => `${w.quantity} in ${w.name}`).join(', ');
    return `<small style="color:var(--color-warning)">Not on the shop floor yet · ${esc(where)} · move it to sell at retail</small>`;
  }

  /** One result row for a warehouse (wholesale) product: price shown for its default unit. */
  function wsResultRow(item, i, active) {
    const d = wsDefaultUnit(item);
    const ok = wsSellable(item);
    const stock = item.trackSerialNumber ? 'Serial-tracked: sell in retail mode' : (item.availableQuantity > 0 ? wsAvailText(item) : 'Out of stock');
    return `
      <div class="pz-dd-row ${active ? 'active' : ''} ${ok ? '' : 'disabled'}" data-idx="${i}" role="option" aria-disabled="${!ok}">
        <span class="pz-mono">${esc(item.barcode || '') || '-'}</span>
        <span class="pz-name">${esc(item.name)}<small>${esc(item.sku ? `SKU ${item.sku} · ` : '')}${esc(stock)}</small></span>
        <span class="pz-price">${WSK().cents(d.wholesalePrice)}<span class="pz-per"> / ${esc(d.name)}</span></span>
      </div>`;
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

    /** "Add as new product" footer: shown under the results AND when nothing matches (retail and wholesale). */
    function addBtnHtml(term) {
      if (!term) return '';
      return `<button type="button" class="pz-dd-add" id="pz-dd-add" style="display:flex;align-items:center;justify-content:center;gap:8px;width:calc(100% - 16px);margin:8px;padding:10px 14px;border:1.5px dashed var(--color-primary,#2563eb);border-radius:var(--radius-md,10px);background:rgba(37,99,235,.07);color:var(--color-primary,#2563eb);font-size:14px;font-weight:600;line-height:1.3;text-align:center;cursor:pointer;word-break:break-word"><i class="fa-solid fa-circle-plus" aria-hidden="true"></i> ${rows.length ? 'Not here? ' : ''}Add “${esc(term)}” as a new product</button>`;
    }
    function bindAddBtn(term) {
      $('pz-dd-add')?.addEventListener('click', () => openQuickAdd(/^\d{6,}$/.test(term) ? { barcode: term } : { name: term }));
    }

    function render(term, loading) {
      dd.classList.add('open');
      if (loading) { dd.innerHTML = '<div class="pz-dd-msg">Searching…</div>'; return; }
      if (!rows.length) {
        const here = isWs() ? wsWarehouse() : null;
        const other = isWs() ? (ws.elsewhere || []) : [];
        dd.innerHTML = `<div class="pz-dd-msg">No product found for “${esc(term)}”${here ? ` in <b>${esc(here.name)}</b>` : ''}</div>` + other.map((o) => `
          <div class="pz-dd-msg" style="padding-top:0">${esc(o.name)}: ${esc(String(o.quantity))} in <b>${esc(o.warehouseName)}</b>${o.allowSales
            ? ` - <button type="button" class="pz-linkbtn" data-switch-wh="${esc(String(o.warehouseId))}">Sell from ${esc(o.warehouseName)}</button>`
            : ' (storage only: switch on "Can sell" for that warehouse, or move the stock to a selling warehouse)'}</div>`).join('');
        dd.insertAdjacentHTML('beforeend', addBtnHtml(term)); bindAddBtn(term);
        dd.querySelectorAll('[data-switch-wh]').forEach((b) => b.addEventListener('click', () => {
          const sel = $('pz-wh');
          if (!sel) return;
          sel.value = b.dataset.switchWh;
          sel.dispatchEvent(new Event('change')); // same path as picking it from the list (clears the cart after a confirm)
        }));
        return;
      }
      dd.innerHTML = `
        <div class="pz-dd-head"><span>Barcode</span><span>Product name</span><span class="pz-right">Price per unit</span></div>
        ${rows.map((r, i) => {
          if (r.ws) return wsResultRow(r.item, i, i === active);
          const off = unitDiscountOf(r.product);
          return `
          <div class="pz-dd-row ${i === active ? 'active' : ''}" data-idx="${i}" role="option">
            <span class="pz-mono">${esc(barcodeOf(r.product, r.variant)) || '-'}</span>
            <span class="pz-name">${esc(nameOf(r.product, r.variant))}<small>SKU ${esc(r.variant ? r.variant.sku : r.product.sku)}</small>${retailStockNote(r.product)}${searchChipsHtml(r)}</span>
            <span class="pz-price">${fm(r.variant ? r.variant.sellingPrice : r.product.sellingPrice)}${off ? `<small>${fm(off)} off</small>` : ''}${wholesaleSearchHint(r)}</span>
          </div>`;
        }).join('')}
        ${addBtnHtml(term)}
      `;
      bindAddBtn(term);
      dd.querySelectorAll('.pz-dd-row').forEach((el) => {
        el.addEventListener('mouseenter', () => setActive(Number(el.dataset.idx)));
        el.addEventListener('click', (ev) => { const chip = ev.target.closest('[data-unit]'); pick(Number(el.dataset.idx), chip ? chip.dataset.unit : null); });
      });
    }

    /** Packet / deal choices under a result: tap one to add it straight away (e.g. "3 for 5", "Packet (50)"). */
    function searchChipsHtml(r) {
      const us = retailUnitsOf(r.product);
      if (!us.length) return '';
      return `<span style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px">${us.map((u) => `<button type="button" data-unit="${esc(u._id)}" style="min-height:30px;padding:3px 11px;border:1px solid var(--color-primary,#2563eb);border-radius:999px;background:#fff;color:var(--color-primary,#2563eb);font:inherit;font-size:12px;font-weight:600;cursor:pointer">${esc(u.name)}${u.code === 'DEAL' ? '' : ` (${esc(String(u.factor))})`} · ${esc(pktMoney(unitPriceFor(r.product, r.variant, u)))}</button>`).join('')}</span>`;
    }

    async function pick(i, unitId) {
      const r = rows[i];
      if (!r) return;
      if (r.ws) {
        if (!wsSellable(r.item)) { window.UI.toast.error(r.item.trackSerialNumber ? 'Serial-tracked products are sold in retail mode' : 'Out of stock in this warehouse'); return; }
        addWholesale(r.item);
      } else {
        if (!(await ensureRetailStock(r.product, r.variant))) { clearSearch(); return; }
        addToCart(r.product, r.variant, 1, unitId || undefined);
      }
      clearSearch();
      input.focus();
    }

    function fillRows(found, wsOn) {
      rows = [];
      if (wsOn) found.forEach((item) => rows.push({ ws: true, item }));
      else found.forEach((product) => {
        if (product.variants?.length) product.variants.forEach((v) => rows.push({ product, variant: v }));
        else rows.push({ product, variant: null });
      });
      active = 0;
    }

    async function runSearch(term) {
      const my = ++seq;
      const wsOn = isWs();
      const quick = wsOn ? null : lookupLocal(term);
      if (quick) { fillRows(quick, false); render(term, false); return rows; } // instant: no "Searching..." flash
      render(term, true);
      try {
        const found = await (wsOn ? wsSearch(term) : lookupSearch(term));
        if (my !== seq) return rows;
        fillRows(found, wsOn);
        render(term, false);
      } catch (err) {
        if (my !== seq) return rows;
        rows = [];
        dd.classList.add('open');
        dd.innerHTML = `<div class="pz-dd-msg">Search failed: ${esc(err.message)}</div>`;
      }
      return rows;
    }

    const debounced = window.UI.debounce((term) => runSearch(term), 150);
    input.addEventListener('input', (e) => {
      const term = e.target.value.trim();
      if (!term) { seq += 1; close(); return; }
      if (!isWs() && retailIndex.isReady()) runSearch(term); else debounced(term);
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
      if (!rows.length && !isWs()) { openQuickAdd(/^\d{6,}$/.test(term) ? { barcode: term } : { name: term }); return; }
      pick(active);
    });

    // click outside closes the results
    if (outsideHandler) document.removeEventListener('click', outsideHandler);
    outsideHandler = (e) => { if (!e.target.closest('#pz-searchwrap')) close(); };
    document.addEventListener('click', outsideHandler);
  }

  /* ------------------------------------------------------------------ *
   * ADD A PRODUCT FROM THE TILL
   * Uses the PosBoost quick-add window when it is loaded; otherwise (or in wholesale mode) the built-in window below.
   * ------------------------------------------------------------------ */
  function openQuickAdd(opts) {
    clearSearch();
    // Online: always the built-in window (it has batch / expiry tracking, like Products). PosBoost is kept for offline quick-add only.
    if (!isWs() && isOfflineNow() && window.PosBoost && typeof window.PosBoost.quickAdd === 'function') {
      window.PosBoost.quickAdd(Object.assign({}, opts, {
        onAdded: (product) => {
          retailIndex.invalidate(); retailIndex.load();
          if (product._pending || String(product._id || '').startsWith('tmp_')) {
            window.UI.toast.info('Saved offline. It can be sold as soon as the internet is back and it has uploaded.');
          } else addToCart(product, null);
          $('pos-search')?.focus();
        },
      }));
      return;
    }
    openBuiltinAddProduct(opts || {});
  }

  function skuFromName(name) {
    const base = String(name || 'ITEM').toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 14) || 'ITEM';
    return `${base}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  }


  /* ------------------------------------------------------------------ *
   * LIVE DUPLICATE-BARCODE ALERT (Add product form): as soon as a barcode is scanned/typed, a RED alert says
   * if it already exists in the system - before "Add product" is clicked.
   * ------------------------------------------------------------------ */
  let bcUsed = null; // Set of every barcode in the catalog (kept in memory so the alert is instant)
  function warmBarcodeSet(force) {
    if (!window.BarcodeLabels || (bcUsed && !force)) return;
    window.BarcodeLabels.loadCatalog().then((c) => { bcUsed = c.used; }).catch(() => {});
  }
  function instantBarcodeHit(code) {
    const c = String(code || '').trim(); const lc = c.toLowerCase();
    if (!c) return null;
    try {
      const l = localBarcode(c);
      if (l && l.product && [l.variant && l.variant.barcode, l.product.barcode].some((v) => v && String(v).trim().toLowerCase() === lc)) return { name: l.product.name || '' };
    } catch { /* ignore */ }
    if (bcUsed && bcUsed.has(c)) return { name: '' };
    return null;
  }
  async function serverBarcodeHit(code) {
    try {
      const d = await window.Api.get(`/products/barcode/${encodeURIComponent(code)}`).then((r) => r.data);
      const prod = d && (d.product || d);
      if (prod && (prod._id || prod.name)) return { name: prod.name || '' };
    } catch { /* not found */ }
    return null;
  }

  function bindBarcodeLiveCheck(input) {
    if (!input || input._bcLive) return;
    input._bcLive = true;
    warmBarcodeSet();
    const field = input.closest('.field') || input.parentElement;
    const msg = document.createElement('div');
    msg.setAttribute('role', 'alert');
    msg.style.cssText = 'display:none;margin-top:6px;padding:8px 10px;border-radius:6px;background:#fdecea;border:1px solid #d93025;color:#b3140a;font-weight:600;font-size:13px';
    field.appendChild(msg);
    let timer = null, seq = 0, lastToasted = '';
    const setState = (dup, text) => {
      input._bcDup = dup;
      input.style.borderColor = dup ? '#d93025' : '';
      input.style.boxShadow = dup ? '0 0 0 3px rgba(217,48,37,.25)' : '';
      input.style.background = dup ? '#fff5f4' : '';
      msg.style.display = dup ? '' : 'none';
      msg.textContent = dup ? text : '';
    };
    const dupText = (name) => `⚠ BARCODE ALREADY EXISTS in the system${name ? ` — product: "${name}"` : ''}. Use a different barcode.`;
    const alertDup = (code, name, final) => {
      setState(true, dupText(name));
      if (final && lastToasted !== code) { lastToasted = code; window.UI.toast.error(`Barcode ${code} already exists${name ? ` (${name})` : ''}`); }
      if (final) { try { input.focus(); input.select(); } catch { /* ignore */ } }
    };
    const check = async (final) => {
      const code = input.value.trim(); const my = ++seq;
      if (!code) { setState(false); return; }
      const hit = instantBarcodeHit(code);            // INSTANT: device copy, no network
      if (hit) { alertDup(code, hit.name, final); return; }
      if (!final) { setState(false); return; }
      const sh = await serverBarcodeHit(code);         // confirm with the server
      if (my !== seq) return;
      if (sh) { if (bcUsed) bcUsed.add(code); alertDup(code, sh.name, true); } else setState(false);
    };
    input.addEventListener('input', () => { check(false); clearTimeout(timer); timer = setTimeout(() => check(true), 80); });
    input.addEventListener('change', () => { clearTimeout(timer); check(true); });
    input.addEventListener('blur', () => { clearTimeout(timer); check(true); });
    input._bcCheck = () => check(true);
    if (input.value.trim()) check(true);
  }

  /** Tracking checkbox shown only when the business has that feature on (same rule as Products). */
  function qaTrackingOption(name, label, feature) {
    const profile = window.AppShell.getBusinessProfile && window.AppShell.getBusinessProfile();
    const known = !!(profile && profile.featureSettings);
    if (known && !(window.AppShell.hasFeature && window.AppShell.hasFeature(feature))) return '';
    return `<label class="checkbox-row"><input type="checkbox" name="${name}" /> <span class="text-sm">${label}</span></label>`;
  }

  function openBuiltinAddProduct(opts) {
    const user = window.AppShell.getUser();
    if (!window.Permissions.can(user, 'products.create')) {
      window.UI.toast.error('You do not have permission to add products. Ask a manager.');
      return;
    }
    if (isOfflineNow()) { window.UI.toast.error('Adding a product needs an internet connection.'); return; }
    const wsOn = isWs();
    const canStock = !wsOn && window.Permissions.can(user, 'inventory.receive');
    const modal = window.UI.openModal({
      title: 'Add product',
      maxWidth: '520px',
      bodyHtml: `
        <form id="qa-form">
          <div class="field"><label for="qa-name">Product name</label><input class="input" id="qa-name" name="name" required value="${esc(opts.name || '')}" /></div>
          <div class="form-row">
            <div class="field"><label for="qa-sku">SKU</label><input class="input" id="qa-sku" name="sku" required value="${esc(skuFromName(opts.name || ''))}" /></div>
            <div class="field"><label for="qa-barcode">Barcode <span class="text-muted">(optional)</span></label>
              <input class="input" id="qa-barcode" name="barcode" value="${esc(opts.barcode || '')}" placeholder="Scan or type" /></div>
          </div>
          <div class="field"><label for="qa-category">Category <span class="text-muted">(optional)</span></label>
            <select class="select" id="qa-category" name="categoryId"><option value="">No category</option></select></div>
          <div class="form-row">
            <div class="field"><label for="qa-price">Selling price (KES)</label><input class="input" id="qa-price" name="sellingPrice" type="number" step="0.01" min="0" inputmode="decimal" required /></div>
            <div class="field"><label for="qa-cost">Cost price (KES)</label><input class="input" id="qa-cost" name="costPrice" type="number" step="0.01" min="0" inputmode="decimal" value="0" /></div>
          </div>
          <div class="form-row">
            <div class="field"><label for="qa-tax">Tax rate (%)</label><input class="input" id="qa-tax" name="taxRate" type="number" step="0.01" min="0" max="100" value="0" /></div>
            ${canStock ? `<div class="field"><label for="qa-qty">Opening stock <span class="text-muted">(optional)</span></label><input class="input" id="qa-qty" type="number" step="any" min="0" inputmode="decimal" placeholder="0" /></div>` : '<div></div>'}
          </div>
          ${(() => {
            const bt = qaTrackingOption('trackBatch', 'Batch tracking', 'batchTracking');
            const et = qaTrackingOption('trackExpiry', 'Expiry dates', 'expiryTracking');
            return (bt || et) ? `<div class="field"><label>Tracking</label><div class="flex gap-4" style="flex-wrap:wrap">${bt}${et}</div></div>` : '';
          })()}
          ${canStock ? `<div id="qa-batch-fields" class="field" style="display:none;border:1px solid var(--color-border,#e5e7eb);border-radius:var(--radius-md,10px);padding:var(--space-3,12px)">
            <label><strong>Batch &amp; expiry details</strong></label>
            <div class="form-row">
              <div class="field"><label for="qa-batch">Batch number <span class="text-muted" id="qa-batch-opt">(optional)</span></label><input class="input" id="qa-batch" autocomplete="off" /></div>
              <div class="field"><label for="qa-expiry">Expiry date <span class="text-muted" id="qa-exp-opt">(optional)</span></label><input class="input" id="qa-expiry" type="date" /></div>
            </div>
            <span class="field-hint" id="qa-batch-hint">These go with the opening stock above. Enter the stock quantity to save them.</span>
          </div>` : ''}
          ${wsOn ? '<p class="text-xs text-muted">The product is created without stock. Receive stock into the warehouse (Warehouses &amp; stock) before selling it wholesale.</p>' : ''}
        </form>`,
      footerHtml: `<button class="btn btn-secondary" data-action="cancel">Cancel</button><button class="btn btn-primary" data-action="save" id="qa-save">${wsOn ? 'Add product' : 'Add &amp; put in cart'}</button>`,
    });
    const nameEl = modal.querySelector('#qa-name');
    const skuEl = modal.querySelector('#qa-sku');
    let skuTouched = false;
    skuEl.addEventListener('input', () => { skuTouched = true; });
    nameEl.addEventListener('input', () => { if (!skuTouched) skuEl.value = skuFromName(nameEl.value); });
    bindBarcodeLiveCheck(modal.querySelector('#qa-barcode'));

    // Expiry is stored on a batch, so tracking expiry always means tracking batches too (same as Products).
    const qaExpiryBox = modal.querySelector('input[name="trackExpiry"]');
    const qaBatchBox = modal.querySelector('input[name="trackBatch"]');
    const qaQtyEl = modal.querySelector('#qa-qty');
    const qaBatchFields = modal.querySelector('#qa-batch-fields');
    const syncQaTracking = () => {
      if (qaExpiryBox && qaBatchBox) {
        if (qaExpiryBox.checked) { qaBatchBox.checked = true; qaBatchBox.disabled = true; qaBatchBox.title = 'Required while expiry dates are tracked'; }
        else { qaBatchBox.disabled = false; qaBatchBox.title = ''; }
      }
      if (!qaBatchFields) return;
      const tracked = !!((qaBatchBox && qaBatchBox.checked) || (qaExpiryBox && qaExpiryBox.checked));
      qaBatchFields.style.display = tracked ? '' : 'none';
      const expOn = !!(qaExpiryBox && qaExpiryBox.checked);
      const expEl = modal.querySelector('#qa-expiry');
      if (expEl) expEl.required = false; // checked in the save handler (only needed when stock is entered)
      const opt = modal.querySelector('#qa-exp-opt'); if (opt) opt.textContent = expOn ? '(required with stock)' : '(optional)';
    };
    [qaExpiryBox, qaBatchBox].forEach((el) => el && el.addEventListener('change', syncQaTracking));
    if (qaQtyEl) qaQtyEl.addEventListener('input', syncQaTracking);
    syncQaTracking();

    modal.querySelector('[data-action="cancel"]').addEventListener('click', () => { window.UI.closeModal(); $('pos-search')?.focus(); });
    setTimeout(() => (opts.name ? modal.querySelector('#qa-price') : nameEl).focus(), 50);
    (async () => {
      try {
        if (!window.__qaCats) window.__qaCats = (await window.Api.get('/categories')).data.categories || [];
        const sel = modal.querySelector('#qa-category');
        if (sel) sel.innerHTML = '<option value="">No category</option>' + window.__qaCats.map((c) => `<option value="${esc(c._id)}">${esc(c.name)}</option>`).join('');
      } catch { /* categories are optional */ }
    })();

    modal.querySelector('#qa-save').addEventListener('click', async () => {
      const form = modal.querySelector('#qa-form');
      if (!form.reportValidity()) return;
      const bcEl = modal.querySelector('#qa-barcode');
      if (bcEl && bcEl.value.trim()) {
        await bcEl._bcCheck();
        if (bcEl._bcDup) { window.UI.toast.error('This barcode already exists in the system - change it first'); bcEl.focus(); return; }
      }
      const raw = window.UI.serializeForm(form);
      const price = Number(raw.sellingPrice);
      if (!(price >= 0)) return window.UI.toast.error('Enter the selling price');
      const payload = {
        name: raw.name.trim(), sku: raw.sku.trim(), barcode: (raw.barcode || '').trim() || undefined,
        costPrice: Number(raw.costPrice) || 0, sellingPrice: price, taxRate: Number(raw.taxRate) || 0,
        unit: 'piece', lowStockThreshold: 5, defaultDiscount: 0, trackInventory: true,
        trackBatch: !!(raw.trackBatch || raw.trackExpiry), trackExpiry: !!raw.trackExpiry,
      };
      const qaQty = Number(qaQtyEl ? qaQtyEl.value : 0) || 0;
      const qaBatchNo = modal.querySelector('#qa-batch') ? modal.querySelector('#qa-batch').value.trim() : '';
      const qaExpiry = modal.querySelector('#qa-expiry') ? modal.querySelector('#qa-expiry').value : '';
      if (raw.categoryId) payload.categoryId = raw.categoryId;
      if ((payload.trackBatch || payload.trackExpiry) && qaQty <= 0 && (qaBatchNo || qaExpiry)) { window.UI.toast.error('Enter the opening stock quantity so the batch / expiry can be saved with it'); if (qaQtyEl) qaQtyEl.focus(); return; }
      if (payload.trackExpiry && qaQty > 0 && !qaExpiry) { window.UI.toast.error('Enter the expiry date for this stock'); modal.querySelector('#qa-expiry').focus(); return; }
      if (!payload.barcode) {
        try {
          if (window.BarcodeLabels) {
            const used = (await window.BarcodeLabels.loadCatalog()).used;
            payload.barcode = window.BarcodeLabels.generateCode(used);
          }
        } catch { /* a barcode is optional */ }
      }
      const btn = modal.querySelector('#qa-save');
      window.UI.setButtonLoading(btn, true, 'Saving…');
      try {
        const res = await window.Api.post('/products', payload);
        const product = (res.data && (res.data.product || res.data)) || null;
        const qty = Number(modal.querySelector('#qa-qty') ? modal.querySelector('#qa-qty').value : 0) || 0;
        if (product && product._id && qty > 0) {
          try {
            await window.Api.post('/inventory/receive', { branchId: window.AppShell.getActiveBranchId(), productId: product._id, quantity: qty, costPrice: payload.costPrice || undefined, batchNumber: qaBatchNo || undefined, expiryDate: qaExpiry || undefined, reason: 'Initial stock' });
          } catch (e) { window.UI.toast.error(`Product added, but the stock was not received (${e.message}). Use Inventory > Receive stock.`); }
        }
        window.UI.closeModal();
        retailIndex.invalidate(); retailIndex.load();
        window.UI.toast.success('Product added');
        if (product && product._id && !wsOn) {
          let full = product;
          try { const { data } = await window.Api.get(`/products/${product._id}`, { branchId: window.AppShell.getActiveBranchId() || undefined }); full = data.product || product; } catch { /* use what we have */ }
          addToCart(full, null);
        }
        $('pos-search')?.focus();
      } catch (err) {
        if (err.code === 'VALIDATION_ERROR' && err.errors && err.errors.length) window.UI.applyFormErrors(modal.querySelector('#qa-form'), err.errors);
        else window.UI.toast.error(err.message);
      } finally {
        if (document.body.contains(btn)) window.UI.setButtonLoading(btn, false);
      }
    });
  }

  /* ---- Cart operations ---- */
  function keyOf(item) { return item.key || (item.variant ? item.variant._id : item.product._id); }

  /* ================================================================== *
   * PACKETS / DEALS on retail lines (sweets: 1 packet = 50 pieces, "3 for 5 bob")
   * Stock is kept in pieces. A cart line can be sold in the product's base unit (piece) or in one of its units
   * (packet / deal). The server prices the line from the unit and takes cost per piece x pieces, so profit is exact
   * whether a packet is sold whole or broken and sold piece by piece.
   * ================================================================== */
  const retailUnitsOf = (product) => ((product && product.units) || []).filter((u) => u.status !== 'inactive' && Number(u.factor) > 0);
  const unitByIdOf = (product, id) => retailUnitsOf(product).find((u) => String(u._id) === String(id)) || null;
  const lineUnitOf = (item) => (item && !item.ws && item.unitId ? unitByIdOf(item.product, item.unitId) : null);
  const unitKeyOf = (product, variant, unitId) => (unitId ? `${variant ? variant._id : product._id}|u|${unitId}` : undefined);
  const baseKeyOf = (product, variant) => (variant ? variant._id : product._id);
  const baseUnitName = (product) => product.unit || 'piece';
  const canBreakUnit = (u) => !!u && u.code !== 'DEAL' && Number(u.factor) > 1;
  function unitPriceFor(product, variant, u) {
    if (!u) return variant ? variant.sellingPrice : product.sellingPrice;
    return u.retailPrice != null && u.retailPrice !== '' ? Number(u.retailPrice) : round2((variant ? variant.sellingPrice : product.sellingPrice) * u.factor);
  }
  const pktMoney = (n) => `KES ${Number(n).toLocaleString('en-KE', { maximumFractionDigits: 2 })}`;

  /** Switch a cart line to another unit (piece / packet / deal). Merges into the line that already sells that unit. */
  function changeLineUnit(line, unitId) {
    const nk = unitId ? unitKeyOf(line.product, line.variant, unitId) : baseKeyOf(line.product, line.variant);
    const other = state.cart.find((x) => x !== line && keyOf(x) === nk);
    if (other) {
      other.quantity += line.quantity;
      syncAutoDiscount(other);
      state.cart.splice(state.cart.indexOf(line), 1);
      state.lastAdded = nk;
      return;
    }
    line.unitId = unitId || undefined;
    if (unitId) line.key = nk; else delete line.key;
    line.overridePriceEnabled = false; line.overridePrice = null; // the old price was for another unit
    if (line.autoDiscount) line.discount = autoDiscountFor(line);
    syncAutoDiscount(line);
    state.lastAdded = nk;
  }

  /** "Break packet": one packet leaves the cart and its pieces are sold instead (stock is already in pieces). */
  function breakLine(idx) {
    const line = state.cart[idx];
    const u = lineUnitOf(line);
    if (!line || !canBreakUnit(u)) return;
    const product = line.product; const variant = line.variant;
    line.quantity -= 1;
    if (line.quantity <= 0) state.cart.splice(idx, 1); else syncAutoDiscount(line);
    addToCart(product, variant, 1);
    const pieces = state.cart.find((i) => keyOf(i) === baseKeyOf(product, variant));
    if (pieces) { pieces.fromPacket = u.name; renderCart(keyOf(pieces)); }
    window.UI.toast.success(`${u.name} broken: set how many ${baseUnitName(product)}s the customer wants on the line below`);
  }

  /** A product barcode that is really the PACKET's code (the supplier's packet was scanned as the product before packets existed, or the packet has no code of its own). */
  function packetUnitForCode(product, code) {
    if (!product || !code) return null;
    const t = String(code).trim().toLowerCase();
    if (String(product.barcode || '').trim().toLowerCase() !== t) return null;
    const pu = retailUnitsOf(product).find((u) => u.code === 'PKT' && Number(u.factor) > 1);
    if (!pu) return null;
    return !pu.barcode || String(pu.barcode).trim().toLowerCase() === t ? pu : null;
  }

  const pktAddMore = new Set(); // packet barcodes where the cashier chose "add another whole packet"
  /** A packet / carton barcode was scanned. First scan = one whole packet; scanning the same packet again asks: break it, or add another. */
  async function addUnitScan(product, unitId) {
    const u = unitByIdOf(product, unitId);
    if (!u) { addToCart(product, null); return; }
    const key = unitKeyOf(product, null, unitId);
    const line = state.cart.find((i) => keyOf(i) === key);
    if (!line) pktAddMore.delete(key);
    if (line && canBreakUnit(u) && !pktAddMore.has(key)) {
      const brk = await window.UI.confirmDialog({
        title: `${u.name} scanned again`,
        message: `Break this ${u.name} (${u.factor} ${baseUnitName(product)}s) and sell single ${baseUnitName(product)}s? Choose "Add another" to sell one more whole ${u.name}.`,
        confirmText: `Break ${u.name}`, cancelText: `Add another ${u.name}`,
      });
      if (brk) { breakLine(state.cart.indexOf(line)); return; }
      pktAddMore.add(key);
    }
    addToCart(product, null, 1, unitId);
  }

  /** Unit picker + Break button shown under the product name when the product has packets / deals. */
  function unitControlsHtml(item, i) {
    const us = retailUnitsOf(item.product);
    if (!us.length || item.ws) return '';
    const cur = lineUnitOf(item);
    const opt = (val, label, price) => `<option value="${esc(val)}" ${String(val) === String(item.unitId || '') ? 'selected' : ''}>${esc(label)} · ${esc(pktMoney(price))}</option>`;
    return `<span class="pk-ctl" style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-top:4px">
      <select class="select" data-action="runit" data-idx="${i}" aria-label="Sell as" style="height:34px;min-height:34px;padding:0 8px;font-size:13px;max-width:100%;width:auto">
        ${opt('', baseUnitName(item.product), unitPriceFor(item.product, item.variant, null))}
        ${us.map((u) => opt(u._id, `${u.name} (${u.factor})`, unitPriceFor(item.product, item.variant, u))).join('')}
      </select>
      ${canBreakUnit(cur) ? `<button type="button" class="btn btn-secondary btn-sm" data-action="break" data-idx="${i}" style="height:34px;min-height:34px">Break ${esc(cur.name)}</button>` : ''}
      ${item.fromPacket ? `<small class="text-muted">from broken ${esc(item.fromPacket)}</small>` : ''}
    </span>`;
  }

  /**
   * Wholesale businesses keep bulk stock in warehouses. A product that is still ONLY in a warehouse has no shop-floor
   * stock, so it cannot be sold at retail yet: say where it is and offer to move it (owner / managers), or ask the
   * cashier to get the owner to move it. Resolves true when the product can go in the cart.
   */
  async function ensureRetailStock(product, variant) {
    try {
      if (!isWsBiz() || isOfflineNow() || product.trackInventory === false) return true;
      let hint = product.stockHint;
      if (!hint) {
        const { data } = await window.Api.get(`/products/${product._id}`, { branchId: window.AppShell.getActiveBranchId() || undefined });
        hint = data.product && data.product.stockHint;
      }
      if (!hint || hint.retailQuantity > 0 || !hint.warehouses || !hint.warehouses.length) return true;
      const best = hint.warehouses.slice().sort((a, b) => b.quantity - a.quantity)[0];
      const where = hint.warehouses.map((w) => `${w.quantity} in ${w.name}`).join(', ');
      if (!WSK().can('inventory.transfer')) {
        window.UI.toast.error(`${product.name} is not on the shop floor yet (${where}). Ask the owner or a manager to move it from the warehouse to the shop floor so it can be sold at retail.`);
        return false;
      }
      const go = await window.UI.confirmDialog({
        title: 'Not on the shop floor yet',
        message: `${product.name} has no shop-floor stock; it is still in the warehouse (${where}). Move it from the warehouse to the shop floor to sell it at retail.`,
        confirmText: `Move from ${best.name}`,
      });
      if (go) {
        WSK().openTransferModal({
          mode: 'TO_RETAIL', warehouseId: best._id, preselect: { product, variant },
          onDone: () => window.UI.toast.success('Stock moved to the shop floor. Search the product again to sell it.'),
        });
      }
      return false;
    } catch { return true; } // never block a sale just because the hint could not be loaded
  }

  function addToCart(product, variant, qty, unitId) {
    if (drawerLocked()) { window.UI.toast.error('Close the cash drawer before starting the next sale'); return; }
    const add = Number(qty) > 0 ? Number(qty) : 1; // the pharmacy desk loads a whole prescription quantity at once
    if (unitId && !unitByIdOf(product, unitId)) unitId = null;
    const key = unitId ? unitKeyOf(product, variant, unitId) : (variant ? variant._id : product._id);
    const existing = state.cart.find((i) => keyOf(i) === key);
    if (existing) {
      existing.quantity += add;
      syncAutoDiscount(existing); // preset discount grows with the quantity; a manual discount is left alone
    } else {
      const item = { product, variant, quantity: add, discount: 0, autoDiscount: false, overridePriceEnabled: false, overridePrice: null, ...(unitId ? { unitId, key } : {}) };
      const preset = autoDiscountFor(item);
      if (preset > 0) {
        item.discount = preset;
        item.autoDiscount = true;
      }
      state.cart.push(item);
    }
    state.lastAdded = key;
    renderCart(key); // scrolls the new / updated row into view
    // Batch / expiry tracked products: show which batch will be sold (earliest expiry first). Display only.
    if (window.BatchTill) window.BatchTill.ensure(state.cart).then(() => { if (state.view === 'new-sale') renderCart(); }).catch(() => {});
    // Pharmacy: learn whether this product is a medicine (class, recall status) and repaint the tags.
    if (window.PharmacyTill && window.PharmacyTill.active()) window.PharmacyTill.ensure([product]).then(() => { if (state.view === 'new-sale') renderCart(); if (window.PharmacyDesk) window.PharmacyDesk.guardOtc(); });
  }

  /** Wholesale: add a warehouse product (a second tap adds one more of the same unit). */
  function addWholesale(item) {
    if (drawerLocked()) { window.UI.toast.error('Close the cash drawer before starting the next sale'); return; }
    const line = wsLineFrom(item);
    const existing = state.cart.find((i) => i.key === line.key);
    if (existing) existing.quantity = Math.round((Number(existing.quantity) + 1) * 1000) / 1000;
    else state.cart.push(line);
    state.lastAdded = line.key;
    renderCart(line.key);
  }

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
    // A quantity change can cross a MOQ and so change the unit price of several lines: re-clamp every discount first.
    state.cart.forEach(syncAutoDiscount);
    renderTicket(flashKey);
    renderCustomerButton();
    renderTotals();
    if (window.PharmacyTill) window.PharmacyTill.paintBar($('ph-till-bar'), state.pharmacy, state.cart);
    if (window.PharmacyDesk) window.PharmacyDesk.paint();
    schedulePromoQuote();
  }

  /* One row per product: Products half (# | Barcode | Name | Price) and Cart half (Qty | Discount | Subtotal | x) */
  function renderTicket(flashKey) {
    const el = $('pz-ticket');
    if (!el) return;
    const foot = $('pz-products-foot');
    const clearBtn = $('clear-cart-btn');
    if (clearBtn) clearBtn.disabled = !state.cart.length;

    if (!state.cart.length) {
      el.innerHTML = isWs()
        ? `<div class="pz-empty"><i class="fa-solid fa-boxes-stacked" aria-hidden="true"></i><strong>No items on this invoice</strong>Scan a barcode or search warehouse stock above.<br/>Pick the unit (piece, bundle or carton) on each line.</div>`
        : `<div class="pz-empty"><i class="fa-solid fa-barcode" aria-hidden="true"></i><strong>No products yet</strong>Scan a barcode or search above.<br/>Every product you add lands here with its quantity, discount and subtotal on the same line.</div>`;
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
      const discTitle = item.autoDiscount
        ? `Product discount (${fm(unitDiscountOf(item.product))} per unit) - tap to change`
        : `Tap to set a discount${canOverride ? ' or change the price' : ''}`;

      let priceCell;
      let nameExtra = '';
      let unitCell = '';
      if (item.ws) {
        const u = wsUnitOf(item);
        const issue = wsStockIssue(item);
        priceCell = `@ ${fm(unit)}<span class="pz-per"> / ${esc(u.name)}</span>${item.overridePriceEnabled ? '<small>price changed</small>' : ''}${issue ? `<small class="pz-bad">${esc(issue)}</small>` : ''}`;
        nameExtra = `<small>${esc(wsAvailText(item.catalog))} in stock</small>`;
        unitCell = `<select class="pz-c-unit pz-unit" data-action="unit" data-idx="${i}" aria-label="Unit">${item.catalog.units.map((x) => `<option value="${esc(x.unitId || '')}" ${String(x.unitId || '') === String(item.unitId || '') ? 'selected' : ''}>${esc(WSK().unitLabel(x))}</option>`).join('')}</select>`;
      } else {
        const info = priceInfoOf(item);
        if (window.PharmacyTill) nameExtra = window.PharmacyTill.tag(item.product._id, state.pharmacy);
        nameExtra += unitControlsHtml(item, i);
        if (window.BatchTill) nameExtra += window.BatchTill.tag(item, i);
        const wholesaleHint = info.priceType === 'WHOLESALE'
          ? 'wholesale price'
          : (info.wholesale !== null && info.moq ? `wholesale ${fm(info.wholesale)} from ${info.moq}` : '');
        const priceHint = item.overridePriceEnabled ? 'price changed' : (info.priceType === 'WHOLESALE' ? 'wholesale price' : (item.autoDiscount ? 'product discount' : wholesaleHint));
        priceCell = canOverride
          ? `<input type="number" class="pb-priceinp ${item.overridePriceEnabled ? 'changed' : ''}" data-action="price" data-idx="${i}" inputmode="decimal" step="0.01" min="0" value="${unit}" aria-label="Selling price" title="Tap to change the selling price for this sale" />${priceHint ? `<small>${priceHint}</small>` : ''}`
          : `@ ${fm(unit)}${priceHint ? `<small>${priceHint}</small>` : ''}`;
      }
      return `
        <div class="pz-tr ${cls}" data-idx="${i}" data-key="${esc(k)}">
          <div class="pz-left">
            <span class="pz-c-no">${i + 1}</span>
            <span class="pz-c-bc pz-mono">${esc(bc) || '-'}</span>
            <span class="pz-c-name pz-name"><span class="pz-nm">${esc(nameOf(item.product, item.variant))}</span>${nameExtra}${bc ? `<small class="pz-name-bc">${esc(bc)}</small>` : ''}</span>
            <span class="pz-c-price pz-price">${priceCell}</span>
          </div>
          <div class="pz-rgt">
            <div class="pz-c-qty pz-stepper">
              <button type="button" data-action="dec" data-idx="${i}" aria-label="Decrease quantity">−</button>
              <input type="number" inputmode="${item.ws ? 'decimal' : 'numeric'}" min="0" step="${item.ws ? 'any' : '1'}" value="${item.quantity}" data-action="qty" data-idx="${i}" aria-label="Quantity" />
              <button type="button" data-action="inc" data-idx="${i}" aria-label="Increase quantity">+</button>
            </div>
            ${unitCell}
            <button type="button" class="pz-c-disc pz-disc ${d ? 'has' : ''}" data-action="discount" data-idx="${i}" title="${esc(discTitle)}">${d ? Number(d).toLocaleString() : '0'}</button>
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
          syncAutoDiscount(item);
          renderCart();
          break;
        case 'dec':
          item.quantity -= 1;
          if (item.quantity <= 0) state.cart.splice(idx, 1);
          else syncAutoDiscount(item);
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
        case 'break':
          breakLine(idx);
          break;
        default:
      }
    });

    el.addEventListener('change', (e) => {
      const bsel = e.target.closest('select[data-action="batch"]');
      if (bsel) {
        const line = state.cart[Number(bsel.dataset.idx)];
        if (line) { line.batchId = bsel.value || undefined; renderCart(); }
        return;
      }
      const rsel = e.target.closest('select[data-action="runit"]');
      if (rsel) {
        const line = state.cart[Number(rsel.dataset.idx)];
        if (line) { changeLineUnit(line, rsel.value || null); renderCart(state.lastAdded); }
        return;
      }
      const sel = e.target.closest('select[data-action="unit"]');
      if (sel) {
        const line = state.cart[Number(sel.dataset.idx)];
        if (line) { line.unitId = sel.value || null; syncAutoDiscount(line); renderCart(); }
        return;
      }
      const pinp = e.target.closest('input[data-action="price"]');
      if (pinp) {
        const line = state.cart[Number(pinp.dataset.idx)];
        const v = Number(pinp.value);
        if (line && pinp.value !== '' && Number.isFinite(v) && v >= 0) {
          const base = priceInfoOf(Object.assign({}, line, { overridePriceEnabled: false, overridePrice: null })).unit;
          if (Math.abs(v - base) < 0.005) { line.overridePriceEnabled = false; line.overridePrice = null; }
          else { line.overridePriceEnabled = true; line.overridePrice = round2(v); }
          syncAutoDiscount(line);
        }
        renderCart();
        setTimeout(() => { if (!document.activeElement || document.activeElement === document.body) $('pos-search')?.focus(); }, 0);
        return;
      }
      const inp = e.target.closest('input[data-action="qty"]');
      if (!inp) return;
      const idx = Number(inp.dataset.idx);
      const n = state.cart[idx] && state.cart[idx].ws ? Math.round(Number(inp.value) * 1000) / 1000 : Math.floor(Number(inp.value));
      if (!Number.isFinite(n) || n <= 0) state.cart.splice(idx, 1);
      else if (state.cart[idx]) {
        state.cart[idx].quantity = n;
        syncAutoDiscount(state.cart[idx]);
      }
      renderCart();
      // Hand the keyboard back to the search box unless the cashier clicked into something else.
      setTimeout(() => {
        if (!document.activeElement || document.activeElement === document.body) $('pos-search')?.focus();
      }, 0);
    });

    el.addEventListener('focusin', (e) => {
      if (e.target.matches('input[data-action="qty"], input[data-action="price"]')) e.target.select();
    });

    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.matches('input[data-action="qty"], input[data-action="price"]')) {
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
        ${isWs() ? '<div class="pz-mini"><span>Tax</span><span>added when you complete</span></div>' : `<div class="pz-mini"><span>Tax (est.)</span><span>${fm(tax)}</span></div>`}
      `;
    }

    foot.innerHTML = `
      <div class="pz-total" aria-live="polite">
        <div class="pz-total-label"><span>${isWs() ? 'Invoice total' : 'Total to pay'}</span><span>${itemCount} unit${itemCount === 1 ? '' : 's'}</span></div>
        <div class="pz-total-amount">${fm(total)}</div>
      </div>
      <button class="btn btn-success pz-pay-btn" id="checkout-btn" ${state.cart.length ? '' : 'disabled'}>
        ${isWs() ? 'Take payment or sell on credit' : 'Add payment to complete sale'}
        <small>Press F9</small>
      </button>
    `;
    $('checkout-btn').addEventListener('click', () => openPaymentModal());
  }

  function openLineDiscountModal(idx) {
    const item = state.cart[idx];
    const user = window.AppShell.getUser();
    const canOverride = window.Permissions.can(user, 'sales.price_override');
    const perUnit = unitDiscountOf(item.product);
    const canEditProduct = window.Permissions.can(user, 'products.update') && !String(item.product._id || '').startsWith('tmp_');

    const modal = window.UI.openModal({
      title: `Adjust - ${item.product.name}`,
      bodyHtml: `
        <form id="line-adjust-form">
          <div class="field">
            <label>Discount (KES)</label>
            <input class="input" name="discount" type="number" step="0.01" min="0" value="${item.discount || ''}" placeholder="0" />
            ${perUnit > 0 ? `<span class="field-hint">Product discount: ${esc(fm(perUnit))} per unit (${esc(fm(autoDiscountFor(item)))} for ${item.quantity} unit${item.quantity === 1 ? '' : 's'}).</span>` : ''}
          </div>
          ${canOverride ? `
            <div class="checkbox-row" style="margin-bottom: var(--space-2)">
              <input type="checkbox" id="override-toggle" ${item.overridePriceEnabled ? 'checked' : ''} />
              <label for="override-toggle" class="text-sm">Override price</label>
            </div>
            <div class="field"><label>Override price (KES)</label><input class="input" name="overridePrice" type="number" step="0.01" min="0" value="${item.overridePrice || ''}" ${item.overridePriceEnabled ? '' : 'disabled'} /></div>
          ` : '<p class="text-xs text-muted">You do not have permission to override prices.</p>'}
          ${canEditProduct && !item.ws ? `
            <hr style="border:0;border-top:1px solid var(--color-border);margin:var(--space-3) 0" />
            <div class="field"><label>Product cost price (KES)</label><input class="input" name="newCost" type="number" step="0.01" min="0" value="${Number(item.variant ? (item.variant.costPrice || 0) : (item.product.costPrice || 0))}" /></div>
            <label class="checkbox-row"><input type="checkbox" name="savePrice" /> <span class="text-sm">Also save this price (and cost) on the product permanently</span></label>
          ` : ''}
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
      const prevDiscount = round2(item.discount || 0);
      const newDiscount = round2(Number(raw.discount) || 0);

      // Work out the price this line WILL have, without touching the item yet,
      // so an invalid entry can be rejected and nothing is half-applied.
      let overrideEnabled = item.overridePriceEnabled;
      let overridePrice = item.overridePrice;
      if (canOverride) {
        overrideEnabled = !!raw.overridePrice && modal.querySelector('#override-toggle').checked;
        overridePrice = overrideEnabled ? Number(raw.overridePrice) : null;
      }
      const nextUnit = overrideEnabled && overridePrice != null
        ? overridePrice
        : priceInfoOf(item).unit;
      const gross = round2(nextUnit * item.quantity);
      if (newDiscount > gross) {
        window.UI.toast.error('Discount cannot be more than the line total');
        return;
      }

      item.overridePriceEnabled = overrideEnabled;
      item.overridePrice = overridePrice;

      if (canEditProduct && !item.ws && raw.savePrice) {
        const body = {};
        const newCost = Number(raw.newCost);
        if (raw.newCost !== '' && Number.isFinite(newCost) && newCost >= 0) body.costPrice = newCost;
        if (overrideEnabled && overridePrice != null) body.sellingPrice = overridePrice;
        if (Object.keys(body).length && !item.variant) {
          window.Api.put(`/products/${item.product._id}`, body)
            .then(() => {
              Object.assign(item.product, body);
              if (body.sellingPrice != null) { item.overridePriceEnabled = false; item.overridePrice = null; syncAutoDiscount(item); }
              retailIndex.invalidate(); retailIndex.load(); renderCart();
              window.UI.toast.success('Product price updated');
            })
            .catch((err) => window.UI.toast.error(err.message));
        } else if (item.variant) window.UI.toast.info('Variant prices are changed on the Products page');
      }

      if (newDiscount === prevDiscount) {
        // Discount field untouched: a preset line follows the (possibly new) price.
        syncAutoDiscount(item);
      } else {
        item.discount = newDiscount;
        item.promoApplied = false; item.promoName = '';
        // Typing exactly the preset amount puts the line back on auto; anything else is a manual discount.
        const preset = autoDiscountFor(item);
        item.autoDiscount = preset > 0 && Math.abs(newDiscount - preset) < 0.005;
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

  function openPaymentModal(initialMethod, carry) {
    if (drawerLocked()) return window.UI.toast.error('Close the cash drawer before taking the next payment');
    if (!state.cart.length) return window.UI.toast.error('Cart is empty');
    const wholesale = isWs();
    if (wholesale) {
      if (isOfflineNow()) return window.UI.toast.error('Wholesale sales need an internet connection.');
      const bad = state.cart.find((l) => wsStockIssue(l));
      if (bad) return window.UI.toast.error(`${bad.product.name}: ${wsStockIssue(bad)}`);
      if (ws.settings.requireCustomerForWholesale && !state.customer) {
        window.UI.toast.error('Choose a customer for a wholesale sale');
        window.CustomerPicker.open({ onSelect: (c) => { state.customer = c; renderCustomerButton(); openPaymentModal(initialMethod, carry); } });
        return;
      }
    }
    // Pharmacy: a "Dispense prescription" sale needs its prescription before any money is taken.
    if (window.PharmacyDesk && !wholesale && !window.PharmacyDesk.beforePayment()) return;
    // Pharmacy: medicines that need a prescription / countersignature / Poisons Book entry are sorted out BEFORE money is taken.
    const PT = window.PharmacyTill;
    if (PT && PT.active() && !wholesale) {
      if (isOfflineNow()) {
        const issue = PT.offlineIssue(state.cart);
        if (issue) return window.UI.toast.error(issue);
      } else if (state.pharmacy.sig !== PT.sig(state.cart)) {
        PT.prepare(state.cart, (r) => { state.pharmacy = r; renderCart(); openPaymentModal(initialMethod, carry); }, state.pharmacy).catch((e) => window.UI.toast.error(e.message));
        return;
      }
    }
    const offlineNow = isOfflineNow();
    if (offlineNow && state.pendingMpesa) return window.UI.toast.error('An M-PESA payment was received online. Reconnect to save that sale.');
    let offCaps = {}; let offTill = null;
    if (offlineNow) {
      const chk = window.Offline.sales.check();
      if (!chk.ok) return window.UI.toast.error(chk.reason);
      offCaps = chk.grant.caps || {};
      offTill = (window.Offline.context.get() || {}).mpesaTill;
    }
    const { total } = computeTotals();
    // A split sale whose M-PESA part was already received: reopen on the Split tab, not as a full M-PESA payment.
    let resumeSplit = false;
    if (state.pendingMpesa && state.splitDraft) {
      const pm = state.pendingMpesa; const sd = state.splitDraft;
      if ((sd.mpesa && sd.mpesa.reference === pm.reference) || sd.pendingRef === pm.reference) {
        sd.mpesa = { reference: pm.reference, amount: pm.amount, mode: pm.mode };
        resumeSplit = true;
      }
    }
    const resumeMpesa = !!state.pendingMpesa && !resumeSplit;
    if (total <= 0 && !resumeMpesa) return window.UI.toast.error('Total must be greater than zero');

    let dueAmount = resumeMpesa ? state.pendingMpesa.amount : total;
    // Wholesale: "paying now" can be less than the invoice total (part payment) once a customer is chosen.
    if (wholesale && !resumeMpesa && carry && state.customer) {
      const want = round2(Number(carry.payNow));
      if (want > 0 && want < total) dueAmount = want;
    }
    const resumeId = resumeMpesa ? mpesaMethodIdFor(state.pendingMpesa) : null;
    const methods = (offlineNow ? OFFLINE_METHODS : METHODS).filter((m) => {
      if (offlineNow) {
        if (m.id === 'MPESA_OFFLINE') return !!(offCaps.allowManualMpesa && offTill);
        if (m.id === 'BANK' || m.id === 'CARD') return !!offCaps.allowCard;
        return true;
      }
      if (m.id === resumeId) return true; // always show the tab that holds already-received money
      if (m.id === 'SPLIT') return !wholesale || resumeSplit; // split: retail tills (wholesale has its own part-payment + credit)
      if (m.id === 'MPESA') return state.flags.mpesaEnabled;
      if (m.id === 'MPESA_TILL') return state.flags.mpesaManualEnabled;
      // MOBILE_MONEY (any network, typed code) is on for every business type, online and offline
      return true;
    });
    let method = resumeSplit ? 'SPLIT' : resumeId || (initialMethod && methods.some((m) => m.id === initialMethod) ? initialMethod : 'CASH');

    const modal = window.UI.openModal({
      title: wholesale ? 'Wholesale payment' : 'Payment',
      maxWidth: '600px',
      bodyHtml: `
        <div class="pz-pay-total"><span id="pz-due-label">Amount due</span><strong id="pz-due-amt">${fm(dueAmount)}</strong></div>
        ${wholesale ? `
        <div class="pz-ws" id="pz-ws">
          <div class="pz-ws-row"><span>Invoice total</span><strong>${fm(total)}</strong></div>
          <div id="pz-ws-paynow">
            <div class="pz-ws-row"><label for="pz-paynow">Paying now (KES)</label>
              <input class="input" id="pz-paynow" type="number" inputmode="decimal" step="0.01" min="0" value="${dueAmount}" ${state.customer && !resumeMpesa ? '' : 'disabled'} /></div>
            ${state.customer && !resumeMpesa ? `<div class="pz-ws-quick" style="margin-top:var(--space-2)"><button type="button" data-pn="full">Full amount</button><button type="button" data-pn="half">Half now</button></div>` : ''}
          </div>
          <div class="pz-ws-credit" id="pz-ws-credit"></div>
          <div class="field" id="pz-ws-due"><label for="pz-due">Credit due date</label><input class="input" type="date" id="pz-due" value="${esc(state.dueDate || '')}" /></div>
          <div class="pz-ws-cust">
            <div class="who">${state.customer ? `${esc(state.customer.name)}<small>${esc(state.customer.phone || '')}${state.customer.outstandingBalance > 0 ? ` · owes ${fm(state.customer.outstandingBalance)}` : ''}</small>` : 'Walk-in customer<small>Choose a customer to take a part payment or sell on credit</small>'}</div>
            <button type="button" class="btn btn-secondary btn-sm" id="pz-ws-cust-btn">${state.customer ? 'Change' : 'Choose customer'}</button>
          </div>
        </div>` : ''}
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
      const splitOwns = !!(state.pendingMpesa && state.splitDraft && state.splitDraft.mpesa && state.splitDraft.mpesa.reference === state.pendingMpesa.reference);
      const lockedTo = state.pendingMpesa ? (splitOwns ? 'SPLIT' : mpesaMethodIdFor(state.pendingMpesa)) : null;
      if (lockedTo && next !== lockedTo) return window.UI.toast.error('M-PESA payment already received - complete the sale first');
      if (method === 'SPLIT' && next !== 'SPLIT' && state.splitDraft && state.splitDraft.lines.some((l) => l.locked && !l.confirmed)) return window.UI.toast.error('An M-PESA request for the split is in progress. Wait for it or let it fail first.');
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
      const renderers = { SPLIT: renderSplit, CASH: renderCash, MPESA: renderMpesa, MPESA_TILL: renderMpesaTill, MPESA_OFFLINE: renderMpesaOffline, MOBILE_MONEY: renderMobileMoney, BANK: renderRef, CARD: renderRef, CREDIT: renderCredit };
      renderers[method]();
      syncWs();
    }

    /** Wholesale: keeps the "paying now / on credit / due date" strip in step with the chosen method and amount. */
    function syncWs() {
      if (!wholesale) return;
      const isCredit = method === 'CREDIT';
      const paying = isCredit ? 0 : dueAmount;
      const bal = round2(total - paying);
      const q = (sel) => modal.querySelector(sel);
      if (q('#pz-ws-paynow')) q('#pz-ws-paynow').style.display = isCredit ? 'none' : '';
      if (q('#pz-ws-credit')) {
        q('#pz-ws-credit').className = `pz-ws-credit${bal > 0.009 ? '' : ' none'}`;
        q('#pz-ws-credit').textContent = bal > 0.009 ? `${fm(bal)} will be recorded as credit${state.customer ? ` for ${state.customer.name}` : ''}` : 'Paid in full - nothing on credit';
      }
      if (q('#pz-ws-due')) q('#pz-ws-due').style.display = bal > 0.009 ? '' : 'none';
      if (q('#pz-due-label')) q('#pz-due-label').textContent = isCredit ? 'On credit' : (bal > 0.009 ? 'Paying now' : 'Amount due');
      if (q('#pz-due-amt')) q('#pz-due-amt').textContent = fm(isCredit ? total : dueAmount);
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
        // Every cash sale starts with the drawer shut. (Only checkable when the drawer has a sensor;
        // otherwise the lock screen after the previous change-giving sale already guarantees it.)
        if (await drawerIsOpen()) {
          window.UI.toast.error('The cash drawer is open. Close it before taking cash.');
          return;
        }
        state.payments = [{ method: 'CASH', amount: dueAmount, amountTendered: tendered }];
        await checkout({ btn: completeBtn, change: round2(tendered - dueAmount), tendered, due: dueAmount });
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

    /* ---- MOBILE MONEY (any network: Airtel Money, T-Kash, Equitel, M-PESA paid to a paybill/till ...) ----
       The cashier reads the confirmation SMS and types the reference. Works with or without internet; a manager checks it against
       the network statement later (same flow as the restaurant's mobile-money payments). */
    function renderMobileMoney() {
      const nets = ['M-PESA', 'Airtel Money', 'T-Kash', 'Equitel', 'Other'];
      panel.innerHTML = `
        <div class="pz-note">Customer pays <strong>${fm(dueAmount)}</strong> by mobile money. Read the confirmation SMS on their phone and type the details below.</div>
        ${offlineNow ? '<div class="pz-note warn">No internet: this payment is saved with the sale and checked when the till reconnects.</div>' : ''}
        <div class="form-row">
          <div class="field"><label for="mm-net">Network</label><select class="select" id="mm-net">${nets.map((n) => `<option value="${esc(n)}">${esc(n)}</option>`).join('')}</select></div>
          <div class="field"><label for="mm-ref">Transaction code</label><input class="input pz-code-input" id="mm-ref" maxlength="30" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="e.g. UJK1A2B3C4" /></div>
        </div>
        <div class="form-row">
          <div class="field"><label for="mm-phone">Customer phone <span class="text-muted">(optional)</span></label><input class="input" id="mm-phone" inputmode="tel" placeholder="07XXXXXXXX" /></div>
        </div>`;
      const net = panel.querySelector('#mm-net'); const ref = panel.querySelector('#mm-ref'); const phone = panel.querySelector('#mm-phone');
      const upd = () => { ref.value = ref.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); setComplete({ enabled: ref.value.length >= 6, label: offlineNow ? 'Save sale offline & print receipt' : 'Complete sale & print receipt' }); };
      ref.addEventListener('input', upd); upd();
      setTimeout(() => ref.focus(), 50);
      onComplete = async () => {
        state.payments = [{ method: 'MOBILE_MONEY', amount: dueAmount, reference: ref.value, provider: net.value, network: net.value, payerPhone: phone.value.trim() || undefined }];
        await checkout({ btn: completeBtn });
      };
    }

    /* ---- CREDIT ---- */
    async function renderCredit() {
      panel.innerHTML = `
        <div class="pz-note warn">The full <strong>${fm(wholesale ? total : dueAmount)}</strong> will be recorded as a debt against the customer${wholesale ? ' (set the due date above)' : ''}.</div>
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
    /* ---- M-PESA Till, OFFLINE: cashier records the code + phone, manager/server verifies later ---- */
    function renderMpesaOffline() {
      const maxCents = (window.Offline.auth.activeGrant()?.limits || {}).maxManualMpesaCents;
      panel.innerHTML = `
        <div class="pz-till">
          <ol class="pz-till-steps">
            <li>Customer pays <strong>Lipa na M-PESA → Buy Goods</strong> to Till <strong>${esc(offTill)}</strong></li>
            <li>Amount: <strong>${fm(dueAmount)}</strong> (exactly)</li>
            <li>Read the <strong>M-PESA SMS on the customer's phone</strong> and type it below</li>
          </ol>
        </div>
        <div class="pz-note warn">No internet: this payment is checked when the till reconnects. ${maxCents && dueAmount * 100 > maxCents ? '<strong>This amount needs a manager\u2019s approval.</strong> ' : ''}Type the code exactly as it appears in the SMS.</div>
        <div class="field"><label for="po-code">M-PESA code (10 characters)</label><input class="input pz-code-input" id="po-code" maxlength="10" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="e.g. UJK1A2B3C4" /></div>
        <div class="form-row">
          <div class="field"><label for="po-phone">Customer phone</label><input class="input" id="po-phone" inputmode="tel" placeholder="07XXXXXXXX" /></div>
          <div class="field"><label for="po-name">Customer name <span class="text-muted">(optional)</span></label><input class="input" id="po-name" maxlength="80" /></div>
        </div>`;
      const code = panel.querySelector('#po-code'); const phone = panel.querySelector('#po-phone'); const name = panel.querySelector('#po-name');
      const ok = () => /^[A-Z][A-Z0-9]{9}$/.test(code.value) && phone.value.replace(/\D/g, '').length >= 9;
      const upd = () => { code.value = code.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); setComplete({ enabled: ok(), label: 'Save sale offline & print receipt' }); };
      [code, phone].forEach((el) => el.addEventListener('input', upd));
      upd();
      setTimeout(() => code.focus(), 50);
      onComplete = async () => {
        state.payments = [{ method: 'MPESA', amount: dueAmount, mpesa: { code: code.value, payerPhone: phone.value.trim(), payerName: name.value.trim() || undefined } }];
        await checkout({ btn: completeBtn });
      };
    }

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

    /* ---- SPLIT PAYMENT (several methods for one sale) ----
       Cash + M-PESA, M-PESA + Credit, Cash + Card ... Each line has its own method and amount. The last unpaid
       part can go on Credit (needs a customer). M-PESA is confirmed for real (STK prompt or Till code) before the
       sale can be completed, so the cashier cannot "pretend" an M-PESA part. Draft survives closing the window. */
    function renderSplit() {
      const mpesaAuto = !!(state.flags.mpesaEnabled || state.flags.mpesaManualEnabled);
      const MP = mpesaAuto ? 'MPESA' : 'MOBILE_MONEY';
      const LM = {
        CASH: 'Cash', MPESA: 'M-PESA', MOBILE_MONEY: mpesaAuto ? 'Mobile money' : 'M-PESA / Mobile money',
        CARD: 'Card', BANK: 'Bank', CREDIT: 'Credit',
      };
      const ICO = { CASH: 'fa-money-bill-wave', MPESA: 'fa-mobile-screen-button', MOBILE_MONEY: 'fa-mobile-retro', CARD: 'fa-credit-card', BANK: 'fa-building-columns', CREDIT: 'fa-file-invoice-dollar' };
      const PRESETS = [
        { id: 'cash_mpesa', label: 'Cash + M-PESA', m: ['CASH', MP] },
        { id: 'mpesa_credit', label: 'M-PESA + Credit', m: [MP, 'CREDIT'] },
        { id: 'cash_credit', label: 'Cash + Credit', m: ['CASH', 'CREDIT'] },
        { id: 'cash_card', label: 'Cash + Card', m: ['CASH', 'CARD'] },
        { id: 'mpesa_card', label: 'M-PESA + Card', m: [MP, 'CARD'] },
        { id: 'cash_bank', label: 'Cash + Bank', m: ['CASH', 'BANK'] },
        { id: 'mpesa_bank', label: 'M-PESA + Bank', m: [MP, 'BANK'] },
        { id: 'cash_mpesa_credit', label: 'Cash + M-PESA + Credit', m: ['CASH', MP, 'CREDIT'] },
        { id: 'custom', label: 'Custom mix…', m: null },
      ];
      const isMp = (l) => l.method === 'MPESA';
      const PAYABLE = ['CASH', ...(mpesaAuto ? ['MPESA'] : []), 'MOBILE_MONEY', 'CARD', 'BANK', 'CREDIT'];
      let uid = 0;
      const mkLine = (method) => ({ id: ++uid, method, amount: '', tendered: '', ref: '', phone: state.customer?.phone || '', net: 'M-PESA', mode: state.flags.mpesaEnabled ? 'STK' : 'TILL', locked: false, confirmed: null });

      // The draft lives in state so closing / reopening the window (e.g. to pick a customer) keeps everything.
      let D = state.splitDraft;
      if (!D || D.total !== total) {
        const p = PRESETS[0];
        D = state.splitDraft = { total, preset: p.id, lines: p.m.map(mkLine), mpesa: null, pendingRef: null };
      }
      uid = Math.max(uid, ...D.lines.map((l) => l.id));
      D.lines.forEach((l) => { if (l.locked && !l.confirmed) l.locked = false; }); // the window was closed mid-request: nothing is being polled any more
      // Money confirmed earlier (window was closed after the customer paid): put it back on its line.
      if (D.mpesa) {
        let ml = D.lines.find(isMp);
        if (!ml) { ml = mkLine('MPESA'); D.lines.unshift(ml); }
        ml.method = 'MPESA'; ml.amount = String(D.mpesa.amount); ml.locked = true; ml.confirmed = D.mpesa;
      }

      const num = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? round2(n) : 0; };
      const credit = () => D.lines.find((l) => l.method === 'CREDIT');
      const paidNow = () => round2(D.lines.filter((l) => l.method !== 'CREDIT').reduce((s, l) => s + num(l.amount), 0));
      const remaining = () => round2(total - paidNow());
      const anyLocked = () => D.lines.some((l) => l.locked);

      /** With two lines, typing one amount fills the other with the rest - the fastest way to split. */
      function autoFill(editedId) {
        const open = D.lines.filter((l) => l.method !== 'CREDIT');
        if (open.length !== 2) return;
        const other = open.find((l) => l.id !== editedId);
        if (!other || other.locked) return;
        const edited = open.find((l) => l.id === editedId);
        const rest = round2(total - num(edited.amount));
        other.amount = rest > 0 ? String(rest) : '';
        const inp = panel.querySelector(`[data-sp-amt="${other.id}"]`);
        if (inp) inp.value = other.amount;
      }

      function validity() {
        const issues = [];
        const mp = D.lines.find(isMp);
        const cr = credit();
        const rem = remaining();
        D.lines.forEach((l) => {
          if (l.method === 'CREDIT') return;
          if (!num(l.amount)) issues.push(`Enter the ${LM[l.method]} amount`);
          if (l.method === 'MOBILE_MONEY' && l.ref.length < 6) issues.push('Enter the mobile money code');
        });
        if (mp && !mp.confirmed) issues.push('Confirm the M-PESA payment');
        if (cr) {
          if (rem <= 0.009) issues.push('Nothing left for credit - lower another amount or remove Credit');
          else if (!state.customer) issues.push('Choose a customer for the credit part');
        } else if (Math.abs(rem) > 0.009) issues.push(rem > 0 ? `${fm(rem)} still unallocated` : `Over by ${fm(-rem)}`);
        if (D.lines.length < 2) issues.push('Add a second payment method');
        return issues;
      }

      /** Updates the totals strip + Complete button without redrawing the lines (so typing never loses focus). */
      function paint() {
        const rem = remaining(); const paid = paidNow(); const cr = credit();
        const pct = Math.max(0, Math.min(100, (paid / total) * 100));
        const bar = panel.querySelector('#sp-bar'); if (bar) bar.style.width = `${pct}%`;
        const set = (id, html) => { const e = panel.querySelector(id); if (e) e.innerHTML = html; };
        set('#sp-paid', fm(paid));
        const left = panel.querySelector('#sp-left');
        if (left) {
          left.className = `sp-left ${cr && rem > 0.009 ? 'credit' : Math.abs(rem) <= 0.009 ? 'ok' : rem < 0 ? 'over' : ''}`;
          left.innerHTML = cr ? `<span>On credit</span><strong>${fm(Math.max(0, rem))}</strong>` : (rem < -0.009 ? `<span>Over by</span><strong>${fm(-rem)}</strong>` : Math.abs(rem) <= 0.009 ? `<span>Balanced</span><strong><i class="fa-solid fa-circle-check"></i></strong>` : `<span>Left to allocate</span><strong>${fm(rem)}</strong>`);
        }
        const cl = D.lines.find((l) => l.method === 'CREDIT');
        if (cl) { const e = panel.querySelector(`[data-sp-credit-amt]`); if (e) e.textContent = fm(Math.max(0, rem)); }
        D.lines.filter((l) => l.method === 'CASH').forEach((l) => {
          const e = panel.querySelector(`[data-sp-change="${l.id}"]`); if (!e) return;
          const amt = num(l.amount); const t = num(l.tendered);
          e.textContent = t > amt && amt ? `Change to give: ${fm(round2(t - amt))}` : '';
          e.style.display = t > amt && amt ? '' : 'none';
        });
        const issues = validity();
        const hint = panel.querySelector('#sp-hint');
        if (hint) { hint.textContent = issues[0] || 'All set - complete the sale'; hint.className = `sp-hint ${issues.length ? '' : 'ok'}`; }
        const hasMpPending = D.lines.some((l) => isMp(l) && !l.confirmed);
        setComplete({ enabled: !issues.length, label: cr ? 'Complete sale (rest on credit)' : 'Complete split sale & print receipt' });
        completeBtn.dataset.mp = hasMpPending ? '1' : '';
      }

      function lineHtml(l, idx) {
        const locked = l.locked; const credit = l.method === 'CREDIT';
        const opts = PAYABLE.filter((m) => m === l.method || !(m === 'CREDIT' && D.lines.some((x) => x.method === 'CREDIT')) && !(m === 'MPESA' && D.lines.some((x) => x.method === 'MPESA')));
        const sel = `<select class="select sp-method" data-sp-method="${l.id}" ${locked ? 'disabled' : ''} aria-label="Payment method">${opts.map((m) => `<option value="${m}" ${m === l.method ? 'selected' : ''}>${LM[m]}</option>`).join('')}</select>`;
        let body = '';
        if (credit) {
          body = `<div class="sp-credit-amt"><span>Amount on credit</span><strong data-sp-credit-amt>${fm(Math.max(0, remaining()))}</strong></div>
            <div class="sp-cust">${state.customer ? `<div><b>${esc(state.customer.name)}</b><small>${esc(state.customer.phone || '')}${state.customer.outstandingBalance > 0 ? ` · owes ${fm(state.customer.outstandingBalance)}` : ''}</small></div>` : '<div><b>No customer yet</b><small>Credit needs a customer</small></div>'}
              <button type="button" class="btn btn-secondary btn-sm" data-sp-cust>${state.customer ? 'Change' : 'Choose customer'}</button></div>`;
        } else {
          body = `<div class="sp-amt-row"><div class="sp-amt-wrap"><span>KES</span><input class="input sp-amt" data-sp-amt="${l.id}" type="number" inputmode="decimal" step="0.01" min="0" placeholder="0.00" value="${esc(l.amount)}" ${locked ? 'disabled' : ''} /></div>
            <button type="button" class="sp-rest" data-sp-rest="${l.id}" ${locked ? 'disabled' : ''} title="Put everything that is left on this line">Rest</button></div>`;
          if (l.method === 'CASH') body += `<div class="sp-sub"><label>Customer gave <em>(optional, for change)</em></label><input class="input" data-sp-tend="${l.id}" type="number" inputmode="decimal" step="0.01" min="0" placeholder="e.g. 1000" value="${esc(l.tendered)}" /><div class="sp-change" data-sp-change="${l.id}" style="display:none"></div></div>`;
          if (l.method === 'CARD' || l.method === 'BANK') body += `<div class="sp-sub"><label>Reference / slip no. <em>(optional)</em></label><input class="input" data-sp-ref="${l.id}" placeholder="Transaction code, slip number…" value="${esc(l.ref)}" /></div>`;
          if (l.method === 'MOBILE_MONEY') body += `<div class="sp-sub sp-two"><div><label>Network</label><select class="select" data-sp-net="${l.id}">${['M-PESA', 'Airtel Money', 'T-Kash', 'Equitel', 'Other'].map((n) => `<option ${n === l.net ? 'selected' : ''}>${n}</option>`).join('')}</select></div><div><label>Transaction code</label><input class="input pz-code-input" data-sp-ref="${l.id}" maxlength="30" autocapitalize="characters" autocomplete="off" placeholder="e.g. UJK1A2B3C4" value="${esc(l.ref)}" /></div></div>`;
          if (l.method === 'MPESA') {
            const both = state.flags.mpesaEnabled && state.flags.mpesaManualEnabled;
            body += `<div class="sp-sub sp-mp">
              ${l.confirmed ? '' : `${both ? `<div class="sp-seg" role="tablist"><button type="button" class="${l.mode === 'STK' ? 'on' : ''}" data-sp-mode="STK" ${locked ? 'disabled' : ''}>STK prompt</button><button type="button" class="${l.mode === 'TILL' ? 'on' : ''}" data-sp-mode="TILL" ${locked ? 'disabled' : ''}>Till (customer pays)</button></div>` : ''}
              ${l.mode === 'STK' ? `<label for="pz-mpesa-phone">Customer M-PESA number</label><div class="input-button-row"><input class="input" id="pz-mpesa-phone" inputmode="tel" placeholder="07XXXXXXXX" value="${esc(l.phone)}" ${locked ? 'disabled' : ''} /><button type="button" class="btn btn-primary" id="mpesa-send-btn" ${locked ? 'disabled' : ''}>Send prompt</button></div>`
                : `<div class="pz-till-grid"><div><span>Till number</span><strong id="pz-till-no">${esc(state.flags.tillNumber || '-')}</strong></div><div><span>Amount</span><strong data-sp-mp-amt>${fm(num(l.amount))}</strong></div></div>
                   <div class="pz-code-box" id="pz-code-box"><button type="button" class="pz-linkbtn" id="pz-code-toggle">Customer paid but nothing appears? Enter the M-PESA code</button><div class="pz-code-row" id="pz-code-row"><input class="input pz-code-input" id="pz-code" maxlength="10" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="e.g. UJK1A2B3C4" /><button type="button" class="btn btn-primary" id="pz-code-btn">Confirm</button></div></div>
                   <button type="button" class="btn btn-primary btn-block" id="sp-till-start" ${locked ? 'disabled' : ''}>Start till payment</button>`}`}
              <div id="mpesa-stk-status"></div></div>`;
          }
        }
        const rm = !locked && D.lines.length > 2 ? `<button type="button" class="sp-x" data-sp-del="${l.id}" aria-label="Remove this method"><i class="fa-solid fa-xmark"></i></button>` : '';
        return `<div class="sp-line ${credit ? 'is-credit' : ''} ${l.confirmed ? 'is-done' : ''}" data-line="${l.id}">
          <div class="sp-line-head"><span class="sp-ico"><i class="fa-solid ${ICO[l.method]}"></i></span><span class="sp-n">${idx + 1}</span>${sel}${l.confirmed ? '<span class="sp-done"><i class="fa-solid fa-circle-check"></i> Received</span>' : ''}${rm}</div>${body}</div>`;
      }

      function draw() {
        const canAdd = D.lines.length < 4 && !anyLocked();
        panel.innerHTML = `
          <div class="sp">
            <div class="sp-top">
              <label for="sp-preset">Combination</label>
              <select class="select" id="sp-preset" ${anyLocked() ? 'disabled' : ''}>${PRESETS.map((p) => `<option value="${p.id}" ${p.id === D.preset ? 'selected' : ''}>${p.label}</option>`).join('')}</select>
            </div>
            <div class="sp-sum">
              <div><span>Sale total</span><strong>${fm(total)}</strong></div>
              <div><span>Allocated</span><strong id="sp-paid">${fm(paidNow())}</strong></div>
              <div id="sp-left" class="sp-left"></div>
              <div class="sp-barwrap"><i id="sp-bar"></i></div>
            </div>
            <div class="sp-lines" id="sp-lines">${D.lines.map(lineHtml).join('')}</div>
            ${canAdd ? '<button type="button" class="sp-add" id="sp-add"><i class="fa-solid fa-plus"></i> Add another method</button>' : ''}
            <div class="sp-hint" id="sp-hint"></div>
            ${!state.currentShift && D.lines.some((l) => l.method === 'CASH') ? '<div class="pz-note warn">No open shift. Open a shift before taking cash so the drawer balances.</div>' : ''}
          </div>`;
        bind();
        const ml = D.lines.find(isMp);
        if (ml && ml.confirmed) renderMpesaStatus(modal, { tone: 'success', label: 'Confirmed', message: `M-PESA ${fm(ml.confirmed.amount)} received.` });
        paint();
      }

      function stopMpesaIfAny() { clearMpesaPolling(modal); if (modal._manualRef) cancelManualAttempt(modal); }

      function setPreset(id) {
        const p = PRESETS.find((x) => x.id === id) || PRESETS[0];
        stopMpesaIfAny();
        D.preset = p.id;
        if (p.m) D.lines = p.m.map(mkLine); else if (D.lines.length < 2) D.lines = [mkLine('CASH'), mkLine(MP)];
        draw();
        setTimeout(() => panel.querySelector('.sp-amt')?.focus(), 40);
      }

      function mpesaDone(line, reference) {
        const amt = num(line.amount);
        line.confirmed = { reference, amount: amt, mode: line.mode === 'TILL' ? 'MANUAL' : 'STK' };
        line.locked = true;
        D.mpesa = line.confirmed;
        // Remember it as pending too, so a new sale / cart edit is blocked until this one is saved.
        state.pendingMpesa = { reference, amount: amt, mode: line.confirmed.mode };
        draw();
      }

      function bind() {
        panel.querySelector('#sp-preset').addEventListener('change', (e) => setPreset(e.target.value));
        panel.querySelector('#sp-add')?.addEventListener('click', () => {
          const have = new Set(D.lines.map((l) => l.method));
          const next = ['CASH', MP, 'CARD', 'BANK', 'MOBILE_MONEY', 'CREDIT'].find((m) => !have.has(m) && (m !== 'MOBILE_MONEY' || true)) || 'CARD';
          D.lines.push(mkLine(next)); D.preset = 'custom'; draw();
        });
        panel.querySelectorAll('[data-sp-del]').forEach((b) => b.addEventListener('click', () => {
          D.lines = D.lines.filter((l) => l.id !== Number(b.dataset.spDel)); D.preset = 'custom'; draw();
        }));
        panel.querySelectorAll('[data-sp-method]').forEach((s) => s.addEventListener('change', () => {
          const l = D.lines.find((x) => x.id === Number(s.dataset.spMethod)); if (!l || l.locked) return;
          l.method = s.value; l.ref = ''; l.confirmed = null; D.preset = 'custom'; draw();
        }));
        panel.querySelectorAll('[data-sp-amt]').forEach((i) => {
          i.addEventListener('input', () => {
            const l = D.lines.find((x) => x.id === Number(i.dataset.spAmt)); if (!l) return;
            l.amount = i.value; autoFill(l.id);
            const mpAmt = panel.querySelector('[data-sp-mp-amt]'); const m = D.lines.find(isMp); if (mpAmt && m) mpAmt.textContent = fm(num(m.amount));
            paint();
          });
          i.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !completeBtn.disabled) completeBtn.click(); });
        });
        panel.querySelectorAll('[data-sp-rest]').forEach((b) => b.addEventListener('click', () => {
          const l = D.lines.find((x) => x.id === Number(b.dataset.spRest)); if (!l) return;
          const others = round2(D.lines.filter((x) => x.id !== l.id && x.method !== 'CREDIT').reduce((s, x) => s + num(x.amount), 0));
          const rest = round2(total - others);
          l.amount = rest > 0 ? String(rest) : '';
          const inp = panel.querySelector(`[data-sp-amt="${l.id}"]`); if (inp) inp.value = l.amount;
          const mpAmt = panel.querySelector('[data-sp-mp-amt]'); const m = D.lines.find(isMp); if (mpAmt && m) mpAmt.textContent = fm(num(m.amount));
          paint();
        }));
        panel.querySelectorAll('[data-sp-tend]').forEach((i) => i.addEventListener('input', () => { const l = D.lines.find((x) => x.id === Number(i.dataset.spTend)); if (l) { l.tendered = i.value; paint(); } }));
        panel.querySelectorAll('[data-sp-ref]').forEach((i) => i.addEventListener('input', () => {
          const l = D.lines.find((x) => x.id === Number(i.dataset.spRef)); if (!l) return;
          if (l.method === 'MOBILE_MONEY') i.value = i.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
          l.ref = i.value.trim(); paint();
        }));
        panel.querySelectorAll('[data-sp-net]').forEach((s) => s.addEventListener('change', () => { const l = D.lines.find((x) => x.id === Number(s.dataset.spNet)); if (l) l.net = s.value; }));
        panel.querySelector('[data-sp-cust]')?.addEventListener('click', () => {
          if (anyLocked()) return window.UI.toast.error('A payment is in progress. Finish or cancel it first.');
          window.UI.closeModal();
          window.CustomerPicker.open({ onSelect: (c) => { state.customer = c; renderCustomerButton(); openPaymentModal('SPLIT'); } });
        });

        // ---- M-PESA line ----
        const ml = D.lines.find(isMp);
        if (!ml || ml.confirmed) return;
        panel.querySelectorAll('[data-sp-mode]').forEach((b) => b.addEventListener('click', () => { if (ml.locked) return; ml.mode = b.dataset.spMode; draw(); }));
        const unlock = (view) => { ml.locked = false; D.mpesa = null; D.pendingRef = null; draw(); if (view) renderMpesaStatus(modal, { ...view, retry: false }); };
        const needAmt = () => { if (!num(ml.amount)) { window.UI.toast.error('Enter the M-PESA amount first'); panel.querySelector(`[data-sp-amt="${ml.id}"]`)?.focus(); return false; } return true; };
        const onPaid = (reference) => mpesaDone(ml, reference);

        if (ml.mode === 'STK') {
          const ph = panel.querySelector('#pz-mpesa-phone');
          ph?.addEventListener('input', () => { ml.phone = ph.value; });
          bindMpesaSendSplit();
        } else {
          bindTill();
        }

        function bindMpesaSendSplit() {
          const send = panel.querySelector('#mpesa-send-btn'); if (!send) return;
          const fresh = send.cloneNode(true); send.replaceWith(fresh); // drop the guard above, bind one clean handler
          fresh.addEventListener('click', async () => {
            if (!needAmt()) return;
            const phone = panel.querySelector('#pz-mpesa-phone').value.trim();
            if (!phone) return window.UI.toast.error('Enter the customer phone number first');
            const amount = num(ml.amount);
            clearMpesaPolling(modal);
            ml.locked = true;
            panel.querySelectorAll('[data-sp-amt],[data-sp-method],[data-sp-rest],#sp-preset,#sp-add,[data-sp-mode]').forEach((e) => { e.disabled = true; });
            window.UI.setButtonLoading(fresh, true, 'Sending…');
            renderMpesaStatus(modal, { tone: 'pending', label: 'Sending', message: 'Sending prompt to customer\u2019s phone…' });
            try {
              const { data } = await window.Api.post('/payments/mpesa/stk', { branchId: window.AppShell.getActiveBranchId(), phone, amountCents: Math.round(amount * 100) });
              renderMpesaStatus(modal, { tone: 'pending', label: 'Waiting', message: 'Ask the customer to enter their M-PESA PIN on their phone.' });
              watchMpesa(modal, data.reference, { amount, mode: 'STK', onPaid, onFail: unlock });
            } catch (err) {
              renderMpesaStatus(modal, { tone: 'error', label: MPESA_FAILURE_LABELS[err.data?.failureType] || 'Could not send prompt', message: err.message, retry: false });
              window.UI.toast.error(err.message);
              unlock({ tone: 'error', label: MPESA_FAILURE_LABELS[err.data?.failureType] || 'Could not send prompt', message: err.message });
            } finally { if (document.body.contains(fresh)) window.UI.setButtonLoading(fresh, false); }
          });
        }

        function bindTill() {
          const codeRow = panel.querySelector('#pz-code-row'); const codeInput = panel.querySelector('#pz-code');
          panel.querySelector('#pz-code-toggle')?.addEventListener('click', () => { codeRow.classList.toggle('open'); if (codeRow.classList.contains('open')) codeInput.focus(); });
          codeInput?.addEventListener('input', () => { codeInput.value = codeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });
          codeInput?.addEventListener('keydown', (e) => { if (e.key === 'Enter') panel.querySelector('#pz-code-btn').click(); });
          panel.querySelector('#pz-code-btn')?.addEventListener('click', async () => {
            const code = codeInput.value.trim().toUpperCase();
            if (!/^[A-Z][A-Z0-9]{9}$/.test(code)) return window.UI.toast.error('An M-PESA code is 10 characters, e.g. UJK1A2B3C4');
            if (!modal._manualRef) return window.UI.toast.error('Tap "Start till payment" first.');
            const btn = panel.querySelector('#pz-code-btn'); window.UI.setButtonLoading(btn, true, 'Checking…');
            try { const { data } = await window.Api.post(`/payments/mpesa/${modal._manualRef}/claim`, { receiptCode: code }); modal._handleStatus?.(data, true); }
            catch (err) { window.UI.toast.error(err.message); }
            finally { if (document.body.contains(btn)) window.UI.setButtonLoading(btn, false); }
          });
          const start = panel.querySelector('#sp-till-start');
          async function begin() {
            if (!needAmt()) return;
            const amount = num(ml.amount);
            ml.locked = true;
            panel.querySelectorAll('[data-sp-amt],[data-sp-method],[data-sp-rest],#sp-preset,#sp-add,[data-sp-mode]').forEach((e) => { e.disabled = true; });
            if (start) { start.disabled = true; start.textContent = 'Waiting for payment…'; }
            modal._manualView = null;
            renderMpesaStatus(modal, { tone: 'pending', label: 'Starting', message: 'Preparing the payment request…' });
            try {
              const { data } = await window.Api.post('/payments/mpesa/manual', { branchId: window.AppShell.getActiveBranchId(), amountCents: Math.round(amount * 100) });
              if (!document.body.contains(modal)) { window.Api.post(`/payments/mpesa/${data.reference}/cancel`, {}).catch(() => {}); return; }
              modal._manualRef = data.reference; D.pendingRef = data.reference;
              const t = panel.querySelector('#pz-till-no'); if (t && data.tillNumber) t.textContent = data.tillNumber;
              renderMpesaStatus(modal, { tone: 'pending', label: 'Waiting', message: 'Waiting for the customer to pay to the Till number…' });
              watchMpesa(modal, data.reference, { amount, mode: 'MANUAL', onPaid, onFail: (v) => { modal._manualRef = null; unlock(v); } });
            } catch (err) {
              renderMpesaStatus(modal, { tone: 'error', label: 'Could not start', message: err.message });
              window.UI.toast.error(err.message); unlock({ tone: 'error', label: 'Could not start', message: err.message });
            }
          }
          start?.addEventListener('click', begin);
          modal._onRetry = () => begin();
        }
      }

      onComplete = async () => {
        const issues = validity();
        if (issues.length) return window.UI.toast.error(issues[0]);
        const cash = D.lines.find((l) => l.method === 'CASH');
        if (cash && await drawerIsOpen()) return window.UI.toast.error('The cash drawer is open. Close it before taking cash.');
        const pays = [];
        D.lines.forEach((l) => {
          if (l.method === 'CREDIT') return; // the unpaid remainder becomes credit on the server
          const amount = num(l.amount);
          if (l.method === 'CASH') pays.push({ method: 'CASH', amount, amountTendered: Math.max(amount, num(l.tendered) || amount) });
          else if (l.method === 'MPESA') pays.push({ method: 'MPESA', amount, reference: l.confirmed.reference });
          else if (l.method === 'MOBILE_MONEY') pays.push({ method: 'MOBILE_MONEY', amount, reference: l.ref, provider: l.net, network: l.net });
          else pays.push({ method: l.method, amount, reference: l.ref || undefined });
        });
        state.payments = pays;
        const changeV = cash ? round2(Math.max(0, (num(cash.tendered) || num(cash.amount)) - num(cash.amount))) : 0;
        const ok = await checkout({ btn: completeBtn, change: changeV, tendered: cash ? (num(cash.tendered) || num(cash.amount)) : 0, due: cash ? num(cash.amount) : 0 });
        if (ok !== false) state.splitDraft = null;
      };
      draw();
      setTimeout(() => panel.querySelector('.sp-amt')?.focus(), 60);
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

    if (wholesale) {
      const pn = modal.querySelector('#pz-paynow');
      const applyPayNow = (raw) => {
        // An M-PESA request that is already out cannot change amount mid-flight.
        if (state.pendingMpesa || (modal._mpesaPoll && !modal._manualRef)) { if (pn) pn.value = dueAmount; return window.UI.toast.error('A payment is in progress. Cancel it before changing the amount.'); }
        let v = round2(Number(raw));
        if (!Number.isFinite(v) || v < 0) v = total;
        if (v > total) v = total;
        if (v <= 0) { selectMethod('CREDIT'); return; }
        dueAmount = v;
        if (pn) pn.value = v;
        if (modal._manualRef) cancelManualAttempt(modal); // TILL: release the old request, the panel below asks for a new one
        selectMethod(method);
      };
      pn?.addEventListener('change', () => applyPayNow(pn.value));
      pn?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); pn.blur(); } });
      modal.querySelectorAll('[data-pn]').forEach((b) => b.addEventListener('click', () => applyPayNow(b.dataset.pn === 'half' ? round2(total / 2) : total)));
      modal.querySelector('#pz-due')?.addEventListener('input', (e) => { state.dueDate = e.target.value; });
      modal.querySelector('#pz-ws-cust-btn')?.addEventListener('click', () => {
        if (state.pendingMpesa || (modal._mpesaPoll && !modal._manualRef) || modal._manualRef) return window.UI.toast.error('A payment is in progress. Cancel it first.');
        window.UI.closeModal();
        window.CustomerPicker.open({ onSelect: (c) => { state.customer = c; renderCustomerButton(); openPaymentModal(method, { payNow: dueAmount }); } });
      });
    }

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
  function watchMpesa(modal, reference, { amount, mode, onPaid, onFail }) {
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
        renderMpesaStatus(modal, { tone: s.failureType === 'timeout' ? 'warning' : 'error', label, message: s.message, retry: !onFail });
        window.UI.toast.error(label);
        if (onFail) onFail({ tone: s.failureType === 'timeout' ? 'warning' : 'error', label, message: s.message });
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
   * HELD SALES (Park / Recall) and PROMOTIONS at the till
   *   Online : POST /shop/held, GET /shop/held, POST /shop/held/:id/recall, DELETE /shop/held/:id
   *   Offline: carts are parked on THIS device (localStorage) and recalled from there - no server needed.
   *   Offers : POST /shop/promotions/quote -> suggestedDiscount per line, applied as the line discount.
   * ================================================================== */
  const LOCAL_HELD_KEY = 'pos.heldLocal.v1';
  // Held sales are always available in retail: if the server refuses them, they are kept on this device instead.
  const canHeld = () => true;
  const canPromo = () => !!(window.AppShell.hasFeature && window.AppShell.hasFeature('promotions')) && window.Permissions.can(window.AppShell.getUser(), 'shop.promotions.view');

  function localHeld() { try { const a = JSON.parse(localStorage.getItem(LOCAL_HELD_KEY) || '[]'); return Array.isArray(a) ? a : []; } catch { return []; } }
  function saveLocalHeld(list) { try { localStorage.setItem(LOCAL_HELD_KEY, JSON.stringify(list)); return true; } catch { window.UI.toast.error('Could not save on this device (storage full)'); return false; } }
  const isNetErr = (e) => !e || e.status == null || e.status === 0 || /network|failed to fetch|offline|timeout/i.test(String((e && e.message) || ''));

  function snapshotCart() {
    return state.cart.map((i) => ({ product: i.product, variant: i.variant || null, quantity: i.quantity, discount: i.discount || 0, autoDiscount: !!i.autoDiscount, promoApplied: !!i.promoApplied, overridePriceEnabled: !!i.overridePriceEnabled, overridePrice: i.overridePrice == null ? null : i.overridePrice, ...(i.unitId ? { unitId: i.unitId, key: i.key } : {}), ...(i.fromPacket ? { fromPacket: i.fromPacket } : {}) }));
  }
  function parkLocal(label) {
    const list = localHeld();
    list.unshift({ id: `L${Date.now().toString(36)}`, label, at: Date.now(), cart: snapshotCart(), customer: state.customer, cartDiscount: state.cartDiscount || 0 });
    return saveLocalHeld(list.slice(0, 30));
  }

  async function parkSale() {
    if (isWs()) return window.UI.toast.error('Park is for retail sales');
    if (!state.cart.length) return window.UI.toast.error('The cart is empty');
    if (state.pendingMpesa) return window.UI.toast.error('An M-PESA payment is pending. Finish it first.');
    const ans = window.prompt('Name for this held sale (optional):', state.customer ? state.customer.name : '');
    if (ans === null) return; // cancelled
    const label = ans.trim().slice(0, 60);
    let saved = false;
    let onServer = false;
    if (!isOfflineNow()) {
      try {
        await window.Api.post('/shop/held', {
          branchId: window.AppShell.getActiveBranchId(), label: label || undefined, customerId: state.customer?._id || undefined, cartDiscount: state.cartDiscount || 0,
          items: state.cart.map((i) => ({ productId: i.product._id, variantId: i.variantId || i.variant?._id || undefined, ...(i.unitId ? { unitId: i.unitId } : {}), quantity: i.quantity, discount: i.discount || 0 })),
        });
        saved = true; onServer = true;
      } catch (e) {
        // Server said no (feature off, no permission, temporary problem): keep the sale safe on this device instead.
      }
    }
    if (!saved) { if (!parkLocal(label || 'Held sale')) return; }
    window.UI.toast.success(onServer ? 'Sale parked' : 'Sale parked on this device');
    resetCart();
    refreshHeldCount();
    $('pos-search')?.focus();
  }

  async function loadRecalledCart(r, label, opts) {
    const merge = !!(opts && opts.merge);
    const lines = r.lines || [];
    // Products come from the copy already on this device (the same one that makes search instant); only a product missing
    // from it is fetched, and those fetches run together. This is what makes Resume / Add to cart fast.
    const idx = new Map();
    try { const all = retailIndex.isReady() ? retailIndex.query({ limit: 1000000 }) : null; if (all) all.items.forEach((p) => { if (!p._pending) idx.set(String(p._id), p); }); } catch { /* fall back to the server */ }
    const got = await Promise.all(lines.map(async (l) => {
      if (l.problems && l.problems.includes('PRODUCT_UNAVAILABLE')) return { l, skip: 'no longer available' };
      let product = idx.get(String(l.productId));
      if (!product) {
        const { data } = await window.Api.get(`/products/${l.productId}`, { branchId: window.AppShell.getActiveBranchId() || undefined });
        product = data.product || data;
      }
      const variant = l.variantId ? (product.variants || []).find((v) => String(v._id) === String(l.variantId)) : null;
      if (l.variantId && !variant) return { l, skip: 'variant no longer available' };
      return { l, product, variant };
    }));
    const notes = [];
    if (!merge) state.cart = [];
    got.forEach((g) => {
      if (g.skip) { notes.push(`${g.l.name}: ${g.skip}`); return; }
      const item = { product: g.product, variant: g.variant, quantity: g.l.quantity, discount: Number(g.l.discount) || 0, autoDiscount: false, promoApplied: false, overridePriceEnabled: false, overridePrice: null };
      if (g.l.unitId) {
        if (!unitByIdOf(g.product, g.l.unitId)) { notes.push(`${g.l.name}: packet / deal no longer available`); return; }
        item.unitId = String(g.l.unitId); item.key = unitKeyOf(g.product, g.variant, item.unitId);
      }
      if (item.discount > round2(unitPriceOf(item) * item.quantity)) item.discount = round2(unitPriceOf(item) * item.quantity);
      const same = merge ? state.cart.find((x) => keyOf(x) === keyOf(item)) : null;
      if (same) { same.quantity += item.quantity; same.discount = round2((same.discount || 0) + item.discount); same.autoDiscount = false; } else state.cart.push(item);
      if ((g.l.problems || []).includes('INSUFFICIENT_STOCK')) notes.push(`${g.l.name}: only ${g.l.available} in stock`);
    });
    if (merge) state.cartDiscount = round2((state.cartDiscount || 0) + (Number(r.cartDiscount) || 0));
    else state.cartDiscount = Number(r.cartDiscount) || 0;
    if (!merge) state.customer = null;
    // The customer never holds the cart back: use what the held sale already carries now, then swap in the full record when it arrives.
    if (r.customerId && !(merge && state.customer)) {
      const cid = r.customerId._id || r.customerId;
      if (r.customerId._id && r.customerId.name) state.customer = r.customerId;
      window.Api.get(`/customers/${cid}`).then(({ data }) => { if (data.customer && (!state.customer || String(state.customer._id) === String(cid))) { state.customer = data.customer; renderCustomerButton(); renderTotals(); } }).catch(() => {});
    }
    checkoutKey = window.Api.newIdempotencyKey();
    const d = $('cart-discount-input'); if (d) d.value = state.cartDiscount || '';
    promoSig = ''; // prices may have changed since it was parked: re-check offers
    renderCart();
    if (notes.length) window.UI.toast.error(`Recalled "${label || 'Held sale'}" - check: ${notes.join('; ')}`);
    else window.UI.toast.success(`Recalled "${label || 'Held sale'}" at today's prices`);
  }

  /* ------------------------------------------------------------------ *
   * HELD SALES MANAGER: every held sale (server + this device) in one place.
   * Actions: Resume (replace cart) | Add to cart (merge) | Items | Rename (device ones) | Print slip | Discard | Discard all
   *          | Upload device ones to the server | Park the cart you are serving now
   * ------------------------------------------------------------------ */
  let heldRows = [];
  function buildHeldRows(server) {
    return [
      ...server.map((h) => ({
        kind: 'S', id: h._id, label: h.label || 'Held sale', at: new Date(h.createdAt).getTime(),
        customer: h.customerId && h.customerId.name ? h.customerId.name : '', cartDiscount: Number(h.cartDiscount) || 0,
        expires: h.expiresAt ? new Date(h.expiresAt).getTime() : 0,
        lines: (h.items || []).map((i) => ({ name: i.nameSnapshot || 'Item', quantity: i.quantity, discount: Number(i.discount) || 0 })),
      })),
      ...localHeld().map((h) => ({
        kind: 'L', id: h.id, label: h.label || 'Held sale', at: h.at, customer: h.customer && h.customer.name ? h.customer.name : '',
        cartDiscount: Number(h.cartDiscount) || 0, expires: 0,
        lines: h.cart.map((i) => ({ name: nameOf(i.product, i.variant), quantity: i.quantity, discount: Number(i.discount) || 0, price: i.overridePriceEnabled && i.overridePrice != null ? i.overridePrice : unitPriceFor(i.product, i.variant, i.unitId ? unitByIdOf(i.product, i.unitId) : null) })),
      })),
    ].sort((a, b) => b.at - a.at);
  }
  function paintHeldCount() {
    const hit = lcGet(heldKey());
    const n = localHeld().length + (hit ? hit.data.server.filter((h) => !heldGone.has(String(h._id))).length : 0);
    document.querySelectorAll('.held-count').forEach((el) => { el.textContent = String(n); el.style.display = n ? '' : 'none'; });
  }
  async function refreshHeldCount() {
    if (!document.querySelector('.held-count')) return;
    paintHeldCount();
    if (isOfflineNow()) return;
    try {
      const { data } = await window.Api.get('/shop/held', { branchId: window.AppShell.getActiveBranchId() || undefined, mine: true }, { background: true });
      lcSet(heldKey(), { server: data.held || [], serverErr: '' });
    } catch { /* keep what we have */ }
    paintHeldCount();
  }
  const heldAgo = (t) => { const m = Math.max(0, Math.round((Date.now() - t) / 60000)); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.floor(m / 60)} h ago` : `${Math.floor(m / 1440)} d ago`; };
  function printHeldSlip(r) {
    const units = r.lines.reduce((n, l) => n + Number(l.quantity || 0), 0);
    const html = `<html><head><title>Held sale</title><style>body{font:13px monospace;width:280px;margin:8px}h3{margin:0 0 4px}hr{border:0;border-top:1px dashed #000}td{padding:1px 2px;vertical-align:top}td:last-child{text-align:right}</style></head><body>
      <h3>HELD SALE: ${esc(r.label)}</h3><div>${esc(new Date(r.at).toLocaleString())}${r.customer ? `<br/>Customer: ${esc(r.customer)}` : ''}</div><hr/>
      <table width="100%">${r.lines.map((l) => `<tr><td>${esc(l.name)}</td><td>x${esc(String(l.quantity))}</td></tr>`).join('')}</table><hr/>
      <div>${r.lines.length} product(s), ${units} unit(s)${r.cartDiscount ? `<br/>Cart discount: ${esc(fm(r.cartDiscount))}` : ''}</div><div>Not a receipt. Prices are re-checked when resumed.</div></body></html>`;
    const f = document.createElement('iframe'); f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
    document.body.appendChild(f); f.contentDocument.open(); f.contentDocument.write(html); f.contentDocument.close();
    setTimeout(() => { try { f.contentWindow.focus(); f.contentWindow.print(); } catch { /* ignore */ } setTimeout(() => f.remove(), 2000); }, 200);
  }

  /* ------------------------------------------------------------------ *
   * INSTANT LISTS: the same idea as product search. The last copy of Sales history / Held sales is kept on this device
   * (memory + this tab's session), shown the moment the tab opens, then refreshed quietly. First pages are fetched in
   * the background right after the till loads, so the first open is instant too.
   * ------------------------------------------------------------------ */
  const listCache = new Map();
  const LC_STORE = 'pos.lists.v2';
  try { (JSON.parse(sessionStorage.getItem(LC_STORE) || '[]') || []).forEach(([k, v]) => listCache.set(k, v)); } catch { /* fresh start */ }
  const lcUser = () => { try { return (window.AppShell.getUser() || {})._id || ''; } catch { return ''; } };
  const lcFull = (k) => `${lcUser()}|${k}`;
  let lcTimer = null;
  function lcPersist() {
    clearTimeout(lcTimer);
    lcTimer = setTimeout(() => {
      try { sessionStorage.setItem(LC_STORE, JSON.stringify([...listCache.entries()].filter(([k]) => /\|(held|h)\|/.test(k)).slice(-12))); } catch { /* storage full */ }
    }, 400);
  }
  function lcGet(k, maxAge) { const m = listCache.get(lcFull(k)); return m && (!maxAge || Date.now() - m.t < maxAge) ? m : null; }
  function lcSet(k, data) { listCache.set(lcFull(k), { t: Date.now(), data }); if (listCache.size > 80) listCache.delete(listCache.keys().next().value); lcPersist(); }
  function lcDrop(prefix) { [...listCache.keys()].forEach((k) => { if (k.includes(`|${prefix}`)) listCache.delete(k); }); lcPersist(); }
  const heldKey = () => `held|${window.AppShell.getActiveBranchId() || ''}`;

  function warmLists() {
    if (isOfflineNow() || !window.AppShell.getUser()) return;
    refreshHeldCount();
    if (window.Permissions.can(window.AppShell.getUser(), 'sales.view') && !lcGet(histKey(), 20000)) {
      const key = histKey();
      window.Api.get('/sales', histParams(), { background: true }).then(({ data }) => lcSet(key, data)).catch(() => {});
    }
  }

  /* ------------------------------------------------------------------ *
   * HELD SALES PAGE (a full tab, like Sales history): every held sale (server + this device) as a card.
   * Resume (replace cart) | Add to cart (merge) | Items | Print slip | Rename (device ones) | Discard | Discard all
   * | Upload device ones to the server | Park the cart you are serving now
   * ------------------------------------------------------------------ */
  const heldUi = { q: '', open: new Set() };
  const heldGone = new Set(); // discarded / recalled, while the server is still confirming
  let heldSeq = 0;
  const heldTime = (t) => new Date(t).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

  async function fetchHeldServer() {
    if (isOfflineNow()) return { server: null, serverErr: '' };
    try { const { data } = await window.Api.get('/shop/held', { branchId: window.AppShell.getActiveBranchId() || undefined, mine: true }); return { server: data.held || [], serverErr: '' }; }
    catch (e) { return { server: null, serverErr: isNetErr(e) ? '' : (e.message || '') }; }
  }
  function heldDropFromCache(id) { const hit = lcGet(heldKey()); if (hit) hit.data.server = hit.data.server.filter((h) => String(h._id) !== String(id)); }
  const heldCurrent = () => { const hit = lcGet(heldKey()); return hit ? hit.data : { server: [], serverErr: '' }; };

  function goToTill() {
    state.view = 'new-sale';
    contentEl.querySelectorAll('.pz-tab').forEach((t) => t.classList.toggle('active', t.dataset.view === 'new-sale'));
    refreshModeUi();
    renderNewSaleView();
  }
  /** Till button + F6: open the Held sales tab. */
  function recallSale() {
    if (isWs()) return window.UI.toast.error('Held sales are for retail sales');
    if (state.view === 'held') return;
    contentEl.querySelector('.pz-tab[data-view="held"]')?.click();
  }

  function heldCardHtml(r) {
    const units = r.lines.reduce((n, l) => n + Number(l.quantity || 0), 0);
    const total = r.kind === 'L' && r.lines.every((l) => l.price != null) ? Math.max(r.lines.reduce((n, l) => n + l.price * l.quantity - (l.discount || 0), 0) - r.cartDiscount, 0) : null;
    const left = r.expires ? Math.round((r.expires - Date.now()) / 3600000) : null;
    const open = heldUi.open.has(r.id);
    const shown = open ? r.lines : r.lines.slice(0, 3);
    const more = r.lines.length - 3;
    return `
      <article class="hv-card" data-id="${esc(r.id)}">
        <div class="hv-card-top">
          <span class="hv-ico ${r.kind === 'L' ? 'dev' : ''}" title="${r.kind === 'L' ? 'Saved on this device' : 'Saved on the server'}"><i class="fa-solid ${r.kind === 'L' ? 'fa-laptop' : 'fa-cloud'}" aria-hidden="true"></i></span>
          <div class="hv-main">
            <div class="hv-name">${esc(r.label)}</div>
            <div class="hv-meta">${esc(heldAgo(r.at))} · ${esc(heldTime(r.at))}</div>
          </div>
          <div class="hv-amt">${total != null ? esc(fm(total)) : '<span class="hv-dash">-</span>'}<small>${total != null ? 'estimate' : 'priced on resume'}</small></div>
        </div>
        <div class="hv-chips">
          <span class="hv-chip">${r.lines.length} product${r.lines.length === 1 ? '' : 's'}</span>
          <span class="hv-chip">${units} unit${units === 1 ? '' : 's'}</span>
          ${r.customer ? `<span class="hv-chip"><i class="fa-solid fa-user" aria-hidden="true"></i> ${esc(r.customer)}</span>` : ''}
          ${r.cartDiscount ? `<span class="hv-chip">Discount ${esc(fm(r.cartDiscount))}</span>` : ''}
          ${left != null && left < 12 ? `<span class="hv-chip warn">Expires in ${Math.max(left, 0)} h</span>` : ''}
        </div>
        <ul class="hv-lines">${shown.map((l) => `<li><span class="hv-ln">${esc(l.name)}</span><span class="hv-lq">&times; ${esc(String(l.quantity))}</span></li>`).join('')}</ul>
        ${more > 0 ? `<button type="button" class="hv-more" data-hv="items">${open ? 'Show less' : `Show all ${r.lines.length} items`}</button>` : ''}
        <div class="hv-actions">
          <button type="button" class="btn btn-primary hv-resume" data-hv="resume"><i class="fa-solid fa-play" aria-hidden="true"></i> Resume</button>
          <button type="button" class="btn btn-secondary hv-merge" data-hv="merge" title="Add these items to the cart you are serving now">Add to cart</button>
          <div class="hv-icons">
            <button type="button" class="hv-ib" data-hv="print" title="Print slip" aria-label="Print slip"><i class="fa-solid fa-print" aria-hidden="true"></i><span>Print</span></button>
            ${r.kind === 'L' ? '<button type="button" class="hv-ib" data-hv="rename" title="Rename" aria-label="Rename"><i class="fa-solid fa-pen" aria-hidden="true"></i><span>Rename</span></button>' : ''}
            <button type="button" class="hv-ib danger" data-hv="drop" title="Discard" aria-label="Discard"><i class="fa-solid fa-trash" aria-hidden="true"></i><span>Discard</span></button>
          </div>
        </div>
      </article>`;
  }

  /** Paints header numbers, buttons and the cards from a held-sales copy (null = still loading the very first time). */
  function paintHeld(data) {
    const list = $('held-list'); if (!list) return;
    if (!data) { list.innerHTML = [1, 2, 3].map(() => '<div class="hv-card hv-skel"><i class="sk sk-l"></i><i class="sk sk-m"></i><i class="sk sk-s"></i><i class="sk sk-b"></i></div>').join(''); return; }
    const all = buildHeldRows((data.server || []).filter((h) => !heldGone.has(String(h._id)))).filter((r) => !heldGone.has(r.id));
    heldRows = all;
    const q = heldUi.q.trim().toLowerCase();
    const rows = q ? all.filter((r) => (`${r.label} ${r.customer} ${r.lines.map((l) => l.name).join(' ')}`).toLowerCase().includes(q)) : all;
    const units = all.reduce((n, r) => n + r.lines.reduce((m, l) => m + Number(l.quantity || 0), 0), 0);
    const localCount = all.filter((r) => r.kind === 'L').length;
    const t = $('hv-total'); if (t) t.textContent = String(all.length);
    const sub = $('hv-sub'); if (sub) sub.textContent = all.length ? `${all.length} waiting · ${units} unit${units === 1 ? '' : 's'}${q ? ` · ${rows.length} match` : ''}` : 'Parked carts waiting to be served';
    const btns = $('hv-btns');
    if (btns) btns.innerHTML = `${state.cart.length ? `<button type="button" class="btn btn-secondary" data-hv="park"><i class="fa-solid fa-pause" aria-hidden="true"></i> Park current cart <span class="hv-pill">${state.cart.length}</span></button>` : ''}${localCount && !isOfflineNow() ? '<button type="button" class="btn btn-secondary" data-hv="upload"><i class="fa-solid fa-cloud-arrow-up" aria-hidden="true"></i> Upload device ones</button>' : ''}${all.length ? '<button type="button" class="btn btn-ghost hv-danger" data-hv="clear"><i class="fa-solid fa-trash" aria-hidden="true"></i> Discard all</button>' : ''}`;
    const note = $('hv-note');
    if (note) note.innerHTML = `${data.serverErr ? `<div class="pz-note hv-alert">Could not load sales held on the server: ${esc(data.serverErr)}. Sales held on this device are shown.</div>` : ''}${state.cart.length && all.length ? '<div class="pz-note">You are serving a customer now. <b>Resume</b> replaces your cart, <b>Add to cart</b> merges a held sale into it, or park your current cart first.</div>' : ''}`;
    if (!all.length) {
      list.innerHTML = `<div class="hv-empty"><span class="hv-empty-ico"><i class="fa-solid fa-pause" aria-hidden="true"></i></span><h3>No held sales</h3><p>Use <b>Park</b> on the till to put the current cart aside and serve the next customer. Parked sales show up here.</p><button type="button" class="btn btn-primary" data-hv="till"><i class="fa-solid fa-cash-register" aria-hidden="true"></i> Back to the till</button></div>`;
    } else if (!rows.length) {
      list.innerHTML = `<div class="hv-empty"><h3>No match</h3><p>No held sale matches &ldquo;${esc(heldUi.q.trim())}&rdquo;.</p></div>`;
    } else list.innerHTML = rows.map(heldCardHtml).join('');
    paintHeldCount();
  }
  const heldRepaint = () => paintHeld(heldCurrent());

  async function renderHeld() {
    const body = $('view-body'); if (!body) return;
    body.className = 'pz-view pz-view-held';
    body.innerHTML = `
      <div class="hv">
        <div class="hv-head card">
          <div class="hv-titlebox"><div class="hv-title">Held sales <span class="hv-total" id="hv-total">0</span></div><div class="hv-sub" id="hv-sub">Parked carts waiting to be served</div></div>
          <div class="hv-tools">
            <div class="input-group hv-search"><span class="input-group-icon">${window.Icons.get('search')}</span><input class="input" id="held-filter" type="search" autocomplete="off" placeholder="Search name, customer or product" value="${esc(heldUi.q)}" /></div>
            <div class="hv-btns" id="hv-btns"></div>
          </div>
        </div>
        <div id="hv-note"></div>
        <div class="hv-grid" id="held-list"></div>
      </div>`;
    const root = body.querySelector('.hv');
    root.addEventListener('click', heldClick);
    $('held-filter').addEventListener('input', (e) => { heldUi.q = e.target.value; heldRepaint(); });

    const hit = lcGet(heldKey());
    paintHeld(hit ? hit.data : (isOfflineNow() ? { server: [], serverErr: '' } : null));
    if (isOfflineNow()) return;
    const seq = ++heldSeq;
    const { server, serverErr } = await fetchHeldServer();
    if (seq !== heldSeq || state.view !== 'held' || !$('held-list')) return;
    const prev = hit ? hit.data : null;
    const next = { server: server == null ? (prev ? prev.server : []) : server, serverErr };
    lcSet(heldKey(), next);
    if (!prev || JSON.stringify(prev) !== JSON.stringify(next)) paintHeld(next);
  }

  async function heldClick(ev) {
    const b = ev.target.closest('[data-hv]'); if (!b || b.disabled) return;
    const act = b.dataset.hv;
    const card = b.closest('.hv-card');
    const r = card ? heldRows.find((x) => x.id === card.dataset.id) : null;
    if (card && !r) return;
    if (act === 'till') return goToTill();
    if (act === 'items') { heldUi.open.has(r.id) ? heldUi.open.delete(r.id) : heldUi.open.add(r.id); card.outerHTML = heldCardHtml(r); return; }
    if (act === 'print') return printHeldSlip(r);
    if (act === 'rename') {
      const name = window.prompt('New name for this held sale:', r.label); if (name === null) return;
      saveLocalHeld(localHeld().map((h) => (h.id === r.id ? { ...h, label: name.trim().slice(0, 60) || 'Held sale' } : h)));
      return heldRepaint();
    }
    if (act === 'drop') return heldDiscard(r);
    if (act === 'resume' || act === 'merge') return heldOpen(r, act === 'merge', b);
    if (act === 'clear') return heldClearAll();
    if (act === 'upload') return heldUpload(b);
    if (act === 'park') { await parkSale(); if (state.view === 'held') renderHeld(); }
  }

  /** Instant: the card disappears at once; the server delete runs behind it and the card comes back (with a message) if it fails. */
  async function heldDiscard(r) {
    if (heldGone.has(r.id)) return;
    if (!(await window.UI.confirmDialog({ title: `Discard "${r.label}"?`, message: 'This cannot be undone.', danger: true, confirmText: 'Discard' }))) return;
    if (heldGone.has(r.id)) return;
    if (r.kind === 'L') { saveLocalHeld(localHeld().filter((h) => h.id !== r.id)); heldRepaint(); window.UI.toast.success('Discarded'); return; }
    heldGone.add(r.id); heldDropFromCache(r.id); heldRepaint(); window.UI.toast.success('Discarded');
    window.Api.delete(`/shop/held/${r.id}`).then(() => { heldGone.delete(r.id); refreshHeldCount(); }).catch((e) => {
      heldGone.delete(r.id); window.UI.toast.error(e.message || 'Could not discard - it is back in the list'); if (state.view === 'held') renderHeld();
    });
  }

  async function heldClearAll() {
    const rows = heldRows.slice(); if (!rows.length) return;
    if (!(await window.UI.confirmDialog({ title: `Discard all ${rows.length} held sales?`, message: 'This cannot be undone.', danger: true, confirmText: 'Discard all' }))) return;
    const local = new Set(rows.filter((r) => r.kind === 'L').map((r) => r.id)); const remote = rows.filter((r) => r.kind !== 'L');
    if (local.size) saveLocalHeld(localHeld().filter((h) => !local.has(h.id)));
    remote.forEach((r) => { heldGone.add(r.id); heldDropFromCache(r.id); });
    heldRepaint(); window.UI.toast.success('All held sales discarded');
    Promise.allSettled(remote.map((r) => window.Api.delete(`/shop/held/${r.id}`))).then((res) => {
      remote.forEach((r) => heldGone.delete(r.id));
      const failed = res.filter((x) => x.status === 'rejected').length;
      if (failed) { window.UI.toast.error(`${failed} could not be discarded`); if (state.view === 'held') renderHeld(); } else refreshHeldCount();
    });
  }

  async function heldUpload(btn) {
    window.UI.setButtonLoading(btn, true);
    const list = localHeld();
    const res = await Promise.allSettled(list.map(async (h) => {
      const items = h.cart.filter((i) => i.product && !String(i.product._id).startsWith('tmp_')).map((i) => ({ productId: i.product._id, variantId: (i.variant && i.variant._id) || undefined, ...(i.unitId ? { unitId: i.unitId } : {}), quantity: i.quantity, discount: i.discount || 0 }));
      if (!items.length) throw new Error('empty');
      await window.Api.post('/shop/held', { branchId: window.AppShell.getActiveBranchId(), label: h.label || undefined, customerId: (h.customer && h.customer._id) || undefined, cartDiscount: h.cartDiscount || 0, items });
      return h.id;
    }));
    const okIds = new Set(res.filter((x) => x.status === 'fulfilled').map((x) => x.value)); const bad = res.length - okIds.size;
    saveLocalHeld(localHeld().filter((x) => !okIds.has(x.id)));
    window.UI.toast[bad ? 'error' : 'success'](`${okIds.size} uploaded${bad ? `, ${bad} could not be uploaded` : ''}`);
    if (state.view === 'held') renderHeld();
  }

  async function heldOpen(r, merge, btn) {
    if (r.busy) return;
    if (isWs()) return window.UI.toast.error('Held sales are for retail sales');
    if (drawerLocked()) return window.UI.toast.error('Close the cash drawer first');
    if (!merge && state.cart.length && !(await window.UI.confirmDialog({ title: 'Replace the current cart?', message: 'Use "Add to cart" to keep the current items, or park the current cart first.', confirmText: 'Replace', danger: true }))) return;
    r.busy = true;
    const card = btn.closest('.hv-card'); card?.classList.add('hv-busy'); window.UI.setButtonLoading(btn, true);
    try {
      if (r.kind === 'L') {
        const h = localHeld().find((x) => x.id === r.id); if (!h) throw new Error('Not found');
        if (merge) {
          h.cart.forEach((i) => {
            const same = state.cart.find((x) => keyOf(x) === (i.key || (i.variant ? i.variant._id : i.product._id)));
            if (same) { same.quantity += i.quantity; syncAutoDiscount(same); } else state.cart.push({ ...i });
          });
          if (!state.customer && h.customer) state.customer = h.customer;
          state.cartDiscount = round2((state.cartDiscount || 0) + (h.cartDiscount || 0));
        } else { state.cart = h.cart.map((i) => ({ ...i })); state.customer = h.customer || null; state.cartDiscount = h.cartDiscount || 0; }
        checkoutKey = window.Api.newIdempotencyKey(); promoSig = '';
        saveLocalHeld(localHeld().filter((x) => x.id !== r.id));
        window.UI.toast.success(`${merge ? 'Added' : 'Resumed'} "${r.label}"`);
      } else {
        const { data } = await window.Api.post(`/shop/held/${r.id}/recall`, {});
        heldGone.add(r.id); heldDropFromCache(r.id);
        await loadRecalledCart(data.cart, r.label, { merge });
        heldGone.delete(r.id);
      }
      goToTill(); refreshHeldCount(); $('pos-search')?.focus();
    } catch (e) {
      window.UI.toast.error(e.message || 'Could not open this held sale');
      r.busy = false; card?.classList.remove('hv-busy'); if (btn.isConnected) window.UI.setButtonLoading(btn, false);
    }
  }

  /* ---- Promotions: ask the server which offer each line earns, apply it as the line discount ---- */
  let promoAnnounce = false; let promoSig = ''; let promoTimer = null; let promoSeq = 0;
  const promoEligible = (i) => !i.ws && !i.unitId && !(i.discount > 0 && !i.autoDiscount && !i.promoApplied); // a hand-typed discount is never overwritten

  /* Offers cached on this till so they still apply with no internet. Same rules as the server (promotion.service.js): the best single offer per line. */
  const PROMO_CACHE_KEY = 'pos.promosActive.v1';
  async function refreshPromoCache() {
    if (!canPromo() || isOfflineNow()) return;
    try {
      const { data } = await window.Api.get('/shop/promotions/active', { branchId: window.AppShell.getActiveBranchId() || undefined });
      localStorage.setItem(PROMO_CACHE_KEY, JSON.stringify({ at: Date.now(), promotions: data.promotions || [] }));
    } catch { /* keep the old copy */ }
  }
  function localPromoQuote(lines) {
    let list = []; try { list = (JSON.parse(localStorage.getItem(PROMO_CACHE_KEY) || '{}').promotions) || []; } catch { list = []; }
    const idOf = (x) => String((x && x._id) || x || ''); const now = Date.now(); const dow = new Date().getDay(); const branch = String(window.AppShell.getActiveBranchId() || '');
    const calc = (p, unit, qty) => {
      const gross = round2(unit * qty); let d = 0;
      if (p.type === 'PERCENT') d = gross * p.value / 100; else if (p.type === 'AMOUNT_OFF') d = p.value * qty;
      else if (p.type === 'FIXED_PRICE') d = unit > p.value ? (unit - p.value) * qty : 0;
      else if (p.type === 'MULTI_BUY') d = Math.floor(qty / p.buyQty) * (p.buyQty - p.payQty) * unit;
      return Math.max(0, Math.min(gross, round2(d)));
    };
    return { lines: lines.map((i) => {
      const unit = unitPriceOf(i); const pid = idOf(i.product); const cat = idOf(i.product.categoryId); let best = null;
      list.forEach((p) => {
        if (p.status && p.status !== 'ACTIVE') return;
        if (now < new Date(p.startsAt).getTime() || now > new Date(p.endsAt).getTime()) return;
        if ((p.branchIds || []).length && branch && !p.branchIds.map(idOf).includes(branch)) return;
        if ((p.daysOfWeek || []).length && !p.daysOfWeek.includes(dow)) return;
        const inScope = p.scope === 'ALL' || (p.scope === 'PRODUCTS' && (p.productIds || []).map(idOf).includes(pid)) || (p.scope === 'CATEGORIES' && cat && (p.categoryIds || []).map(idOf).includes(cat));
        if (!inScope || i.quantity < (p.minQty || 0)) return;
        const d = calc(p, unit, i.quantity); if (d > 0 && (!best || d > best.d)) best = { d, p };
      });
      const standing = Math.min(round2(unit * i.quantity), round2((Number(i.product.defaultDiscount) || 0) * i.quantity));
      const promoD = best ? best.d : 0;
      return { suggestedDiscount: Math.max(promoD, standing), source: promoD > 0 && promoD >= standing ? 'PROMOTION' : null, promotion: best ? { name: best.p.name } : null };
    }) };
  }
  window.addEventListener('online', refreshPromoCache);
  window.addEventListener('connectivitychange', (e) => { if (e.detail && e.detail.online) refreshPromoCache(); });
  document.addEventListener('DOMContentLoaded', () => setTimeout(refreshPromoCache, 2000));

  function schedulePromoQuote(force) {
    if (force) promoAnnounce = true;
    if (!canPromo() || isWs() || state.view !== 'new-sale') return;
    const lines = state.cart.filter(promoEligible);
    const sig = lines.map((i) => `${keyOf(i)}:${i.quantity}:${i.unitId || ''}`).join('|');
    if (!force && sig === promoSig) return;
    promoSig = sig;
    clearTimeout(promoTimer);
    if (!lines.length) return;
    promoTimer = setTimeout(() => runPromoQuote(lines, sig), 350);
  }

  async function runPromoQuote(lines, sig) {
    const seq = ++promoSeq;
    try {
      let data;
      if (isOfflineNow()) data = localPromoQuote(lines); // no internet: work the offers out here from the copy cached on this till
      else {
        try {
          ({ data } = await window.Api.post('/shop/promotions/quote', {
            branchId: window.AppShell.getActiveBranchId() || undefined,
            lines: lines.map((i) => ({ productId: i.product._id, variantId: i.variantId || i.variant?._id || undefined, quantity: i.quantity })),
          }));
        } catch (e) { if (!isNetErr(e)) throw e; data = localPromoQuote(lines); }
      }
      if (seq !== promoSeq) return; // a newer quote is on its way
      let applied = 0; const names = [];
      (data.lines || []).forEach((q, idx) => {
        const item = lines[idx];
        if (!item || !state.cart.includes(item) || !promoEligible(item)) return;
        const gross = round2(unitPriceOf(item) * item.quantity);
        const d = Math.min(round2(Number(q.suggestedDiscount) || 0), gross);
        if (q.source === 'PROMOTION' && d > 0) { item.discount = d; item.autoDiscount = false; item.promoApplied = true; item.promoName = q.promotion ? q.promotion.name : 'Offer'; applied++; names.push(item.promoName); }
        else if (item.promoApplied) { item.promoApplied = false; item.promoName = ''; item.discount = autoDiscountFor(item); item.autoDiscount = item.discount > 0; }
      });
      promoSig = sig;
      if (state.view === 'new-sale') renderCart();
      if (promoAnnounce) { promoAnnounce = false; window.UI.toast[applied ? 'success' : 'info'] ? window.UI.toast[applied ? 'success' : 'info'](applied ? `${applied} offer${applied === 1 ? '' : 's'} applied: ${[...new Set(names)].join(', ')}` : 'No offers apply to this cart') : null; }
    } catch (e) { promoSig = ''; /* offers are a bonus: never block selling */ }
  }

  /* ================================================================== *
   * CHECKOUT
   * ================================================================== */
  function resetCart() {
    state.cart = [];
    promoSig = '';
    if (window.BatchTill) window.BatchTill.clear();
    state.pharmacy = {};
    state.customer = null;
    state.cartDiscount = 0;
    state.payments = [];
    state.pendingMpesa = null;
    state.splitDraft = null;
    state.lastAdded = null;
    checkoutKey = window.Api.newIdempotencyKey();
    const d = $('cart-discount-input');
    if (d) d.value = '';
    renderCart();
  }

  /**
   * Returns true when the sale was saved.
   * change / tendered / due are only passed for CASH sales; when change > 0 the cash drawer
   * is opened (and the POS locked) the moment the sale is saved.
   */
  async function saveOffline(ctid) {
    // Wines & spirits: the till asks the age check itself (the server cannot while offline). null = refused / cancelled: save nothing.
    let ageCheck;
    if (window.LiquorTill && window.LiquorTill.active()) {
      const lp = await window.LiquorTill.offlinePrepare(state.cart);
      if (lp === null) { const e = new Error('Sale not saved: the age check was not completed.'); e.code = 'AGE_CHECK_CANCELLED'; throw e; }
      ageCheck = lp.ageCheck;
    }
    const r = await window.Offline.sales.create({
      cart: state.cart, cartDiscount: state.cartDiscount || 0, payments: state.payments, clientTransactionId: ctid, ageCheck,
    });
    return { sale: { receiptNumber: r.receiptNumber, _id: null }, receipt: r.receipt, offline: true };
  }

  async function checkout({ btn, change, tendered, due } = {}) {
    if (checkingOut) return false;
    if (!state.cart.length) { window.UI.toast.error('Cart is empty'); return false; }

    const wholesale = isWs();
    const off = window.Offline;
    const offlineNow = isOfflineNow();
    if (!wholesale && offlineNow && state.cart.some((i) => i.unitId)) { window.UI.toast.error('Packet and deal lines need an internet connection. Switch them to single pieces to sell offline.'); return false; }
    const PT = window.PharmacyTill;
    const pharmacyOffline = PT && PT.active() ? PT.offlineIssue(state.cart) : '';
    if (PT && PT.active() && !wholesale && !offlineNow && state.pharmacy.sig !== PT.sig(state.cart)) { window.UI.toast.error('The cart changed. Review the pharmacy details and try again.'); return false; }
    const canOffline = !wholesale && !pharmacyOffline && !state.cart.some((i) => i.unitId) && !!off && off.isReady() && off.device.enrolled() && off.context.policyOn();
    let onCredit = false;
    if (wholesale) {
      if (offlineNow) { window.UI.toast.error('Wholesale sales need an internet connection.'); return false; }
      const bad = state.cart.find((l) => wsStockIssue(l));
      if (bad) { window.UI.toast.error(`${bad.product.name}: ${wsStockIssue(bad)}`); return false; }
      if (!wsWarehouse()) { window.UI.toast.error('Choose a warehouse to sell from'); return false; }
      if (ws.settings.requireCustomerForWholesale && !state.customer) { window.UI.toast.error('Choose a customer for a wholesale sale'); return false; }
      const paidNow = state.payments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
      const balance = round2(computeTotals().total - paidNow);
      if (balance < -0.009) { window.UI.toast.error('Payments are more than the invoice total'); return false; }
      onCredit = balance > 0.009;
      if (onCredit && !state.customer) { window.UI.toast.error('Choose a customer to sell on credit or take a part payment'); return false; }
    }
    const ctid = checkoutKey.replace(/-/g, ''); // same id online and offline, so a retry can never become a second sale

    const branchId = wholesale ? (WSK().branchOf(wsWarehouse()) || window.AppShell.getActiveBranchId()) : window.AppShell.getActiveBranchId();
    const payload = {
      branchId,
      // Wholesale businesses tag every sale with its channel (same as the old wholesale screen did).
      ...(wholesale
        ? { channel: 'WHOLESALE', warehouseId: ws.whId, dueDate: onCredit && state.dueDate ? state.dueDate : undefined }
        : (isWsBiz() ? { channel: 'RETAIL' } : {})),
      customerId: state.customer?._id,
      ...(PT && PT.active() ? PT.payload(state.pharmacy) : {}),
      cartDiscount: state.cartDiscount || 0,
      items: state.cart.map((item) => ({
        productId: item.product._id, variantId: item.variantId || item.variant?._id, quantity: item.quantity,
        ...(item.unitId ? { unitId: item.unitId } : {}),
        ...(!wholesale && item.batchId ? { batchId: item.batchId } : {}),
        discount: item.discount || 0, overridePrice: item.overridePriceEnabled ? item.overridePrice : undefined,
      })),
      payments: state.payments.map((p) => ({
        method: p.method, amount: p.amount, reference: p.reference,
        provider: p.method === 'MOBILE_MONEY' ? p.provider : undefined,
        amountTendered: p.method === 'CASH' ? p.amountTendered : undefined,
      })),
      ...(canOffline ? { deviceId: off.device.id(), clientTransactionId: ctid } : {}),
    };

    checkingOut = true;
    if (btn) window.UI.setButtonLoading(btn, true, 'Completing sale…');
    try {
      let data;
      if (offlineNow) {
        if (pharmacyOffline) throw new Error(pharmacyOffline);
        if (!canOffline) throw new Error('You are offline and offline selling is not set up on this till.');
        data = await saveOffline(ctid);
      } else {
        try {
          ({ data } = await (window.LiquorTill && window.LiquorTill.active() ? window.LiquorTill.post('/sales', payload, { idempotencyKey: checkoutKey }) : window.Api.post('/sales', payload, { idempotencyKey: checkoutKey })));
        } catch (err) {
          const cashOnly = state.payments.length === 1 && state.payments[0].method === 'CASH' && !state.pendingMpesa;
          if (err.code === 'NETWORK_ERROR' && canOffline && cashOnly) {
            window.UI.toast.warning('Connection lost - saving this sale on the till');
            data = await saveOffline(ctid);
          } else throw err;
        }
      }

      const drawerDriven = change > 0 && !!window.CashDrawer && window.CashDrawer.isEnabled();
      if (drawerDriven) {
        window.CashDrawer.beginChange({ change, tendered, due, receiptNumber: data.sale.receiptNumber, saleId: data.sale._id || '' });
      }
      if (document.querySelector('.modal-backdrop')) window.UI.closeModal();
      window.UI.toast.success(data.offline ? `Sale ${data.sale.receiptNumber} saved on this till` : `Sale ${data.sale.receiptNumber} completed${onCredit ? ' (balance on credit)' : ''}`);
      if (change > 0 && !drawerDriven) window.UI.toast.success(`Give change: ${fm(change)}`);
      retailIndex.invalidate(); // stock changed: reload the device copy
      resetCart();
      loadShift();
      retailIndex.load();
      try {
        // Wholesale sales open the professional invoice (receipt is one tap away); retail keeps the auto-printing receipt.
        if (payload.channel === 'WHOLESALE' && !data.offline && data.sale && data.sale._id && window.InvoiceView) {
          window.InvoiceView.open(data.sale._id, { receipt: data.receipt, title: `Invoice ${data.sale.invoiceNumber || data.sale.receiptNumber}` });
        } else if (autoPrintGet()) window.ReceiptView.showReceiptModal(data.receipt, { autoPrint: true });
        // Receipt switch OFF: nothing opens after the sale. The receipt stays available under Sales history > View sale > Receipt.
      } catch (receiptErr) {
        window.UI.toast.error(`Sale saved, but the receipt could not be shown: ${receiptErr.message}`);
      }
      if (PT && PT.active()) PT.afterSale(data);
      lcDrop('h|'); lcDrop('d|'); setTimeout(warmLists, 600);
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
  const OFFLINE_STATUS = { pending: ['badge-warning', 'Waiting to sync'], synced: ['badge-success', 'Synced'], issue: ['badge-danger', 'Needs manager'] };
  async function renderOfflineHistory() {
    const body = $('view-body');
    body.className = 'pz-view pz-view-history';
    const rows = await window.Offline.receipts.recent();
    body.innerHTML = `<div class="card"><div class="toolbar"><strong>Sales saved on this till</strong><span class="text-xs text-muted">You are offline. Full history returns when you reconnect.</span></div>
      <div class="table-wrap"><table class="table"><thead><tr><th>Receipt</th><th>Time</th><th>Total</th><th>Status</th><th></th></tr></thead><tbody>
      ${rows.length ? rows.map((r) => { const [c, l] = OFFLINE_STATUS[r.status] || ['badge-neutral', r.status]; return `<tr data-rn="${esc(r.receiptNumber)}"><td class="cell-primary">${esc(r.receiptNumber)}</td><td class="text-sm">${window.UI.formatDateTime(r.soldAt)}</td><td class="font-semibold">${fm(r.totalCents / 100)}</td><td><span class="badge ${c}">${l}</span></td><td class="actions"><button class="btn btn-secondary btn-sm" data-a="view">View / reprint</button></td></tr>`; }).join('') : `<tr><td colspan="5">${window.UI.emptyStateHtml({ icon: 'sales', title: 'No sales saved on this till yet' })}</td></tr>`}
      </tbody></table></div></div>`;
    body.querySelectorAll('[data-a="view"]').forEach((b) => b.addEventListener('click', async () => {
      const rec = await window.Offline.receipts.get(b.closest('tr').dataset.rn);
      if (rec) window.ReceiptView.showReceiptModal(rec);
    }));
  }

  function renderHistory() {
    if (isOfflineNow()) return renderOfflineHistory();
    const body = $('view-body');
    body.className = 'pz-view pz-view-history';
    body.innerHTML = `
      <div class="card">
        <div class="toolbar">
          <div class="toolbar-search input-group">
            <span class="input-group-icon">${window.Icons.get('search')}</span>
            <input class="input" id="history-search" type="text" placeholder="Search by receipt number" />
          </div>
          ${isWsBiz() ? `<select class="select" id="history-channel" style="max-width:170px" aria-label="Sale type">
            <option value="">All sales</option><option value="RETAIL">Retail only</option><option value="WHOLESALE">Wholesale only</option></select>` : ''}
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
    if ($('history-channel')) {
      $('history-channel').value = state.history.channel || '';
      $('history-channel').addEventListener('change', (e) => { state.history.channel = e.target.value; state.history.page = 1; fetchHistory(); });
    }
    $('history-from').addEventListener('change', (e) => { state.history.from = e.target.value; state.history.page = 1; fetchHistory(); });
    $('history-to').addEventListener('change', (e) => { state.history.to = e.target.value; state.history.page = 1; fetchHistory(); });

    fetchHistory();
  }

  const PAYMENT_BADGE = { PAID: 'badge-success', PARTIAL: 'badge-warning', CREDIT: 'badge-danger', UNPAID: 'badge-neutral' };

  /* ---- Sales history: shows the last copy at once, refreshes quietly behind it (like product search) ---- */
  let histSeq = 0;
  const histParams = () => ({
    branchId: window.AppShell.getActiveBranchId(), page: state.history.page, limit: state.history.limit, search: state.history.search,
    from: state.history.from || undefined, to: state.history.to || undefined,
    channel: isWsBiz() && state.history.channel ? state.history.channel : undefined,
  });
  const histKey = () => `h|${JSON.stringify(histParams())}`;

  function paintHistory(data) {
    const tbody = $('history-tbody'); if (!tbody) return;
    const items = isWsBiz() && state.history.channel ? data.items.filter((s) => (s.channel || 'RETAIL') === state.history.channel) : data.items;
    if (!items.length) {
      tbody.innerHTML = `<tr><td colspan="7">${window.UI.emptyStateHtml({ icon: 'sales', title: 'No sales found' })}</td></tr>`;
    } else {
      tbody.innerHTML = items.map((s) => `
        <tr data-id="${s._id}">
          <td class="cell-primary">${s.receiptNumber}${s.channel === 'WHOLESALE' ? ' <span class="badge badge-info">Wholesale</span>' : ''}</td>
          <td class="text-sm">${window.UI.formatDateTime(s.createdAt)}</td>
          <td class="text-sm">${esc(s.cashierId?.name || '')}</td>
          <td class="text-sm">${s.customerId ? esc(s.customerId.name) : '<span class="text-muted">Walk-in</span>'}</td>
          <td class="font-semibold">${fm(s.total)}</td>
          <td>
            <span class="badge ${PAYMENT_BADGE[s.paymentStatus] || 'badge-neutral'}">${s.paymentStatus}</span>
            ${s.saleStatus === 'CANCELLED' ? '<span class="badge badge-neutral">Cancelled</span>' : ''}
            ${s.balance > 0 && s.saleStatus !== 'CANCELLED' ? `<div class="text-xs text-muted">owes ${fm(s.balance)}${s.dueDate ? ` · due ${window.UI.formatDate(s.dueDate)}` : ''}</div>` : ''}
          </td>
          <td class="actions"><button class="btn btn-secondary btn-sm" data-action="view">View</button></td>
        </tr>
      `).join('');
    }
    window.UI.renderPagination($('history-pagination'), data, (p) => { state.history.page = p; fetchHistory(); });
    // one handler for the whole table; hovering / touching a row's View button already fetches that sale, so the modal opens at once
    tbody.onclick = (e) => { const b = e.target.closest('[data-action="view"]'); if (b) openSaleDetail(b.closest('tr').dataset.id, b); };
    const warm = (e) => { const b = e.target.closest && e.target.closest('[data-action="view"]'); if (b) prefetchSale(b.closest('tr').dataset.id); };
    tbody.onpointerover = warm; tbody.ontouchstart = warm;
  }

  async function fetchHistory() {
    if (!$('history-tbody')) return;
    const seq = ++histSeq; const key = histKey(); const params = histParams();
    const hit = lcGet(key);
    if (hit) paintHistory(hit.data); else $('history-tbody').innerHTML = window.UI.skeletonRows(7, 6);
    try {
      const { data } = await window.Api.get('/sales', params);
      if (seq !== histSeq || !$('history-tbody')) return; // the cashier already changed the filter / left the tab
      const same = hit && JSON.stringify(hit.data) === JSON.stringify(data);
      lcSet(key, data);
      if (!same) paintHistory(data);
    } catch (err) {
      if (seq !== histSeq || hit || !$('history-tbody')) return; // keep showing the saved copy if the refresh failed
      $('history-tbody').innerHTML = `<tr><td colspan="7">${window.UI.emptyStateHtml({ icon: 'alert', title: 'Could not load sales', message: err.message })}</td></tr>`;
    }
  }

  const detailKey = (id) => `d|${id}`;
  function prefetchSale(id) {
    if (!id || lcGet(detailKey(id), 120000) || isOfflineNow()) return;
    window.Api.get(`/sales/${id}`, undefined, { background: true }).then(({ data }) => lcSet(detailKey(id), data)).catch(() => {});
  }
  async function openSaleDetail(id, trigger) {
    let data;
    const hit = lcGet(detailKey(id), 120000);
    if (hit) data = hit.data;
    else {
      if (trigger) window.UI.setButtonLoading(trigger, true);
      try {
        ({ data } = await window.Api.get(`/sales/${id}`));
        lcSet(detailKey(id), data);
      } catch (err) {
        return window.UI.toast.error(err.message);
      } finally { if (trigger && document.body.contains(trigger)) window.UI.setButtonLoading(trigger, false); }
    }

    const { sale, receipt } = data;
    const user = window.AppShell.getUser();
    const canCancel = sale.saleStatus === 'COMPLETED' && window.Permissions.can(user, 'sales.cancel');
    const hasRefundableItems = sale.items.some((i) => i.quantity - i.refundedQuantity > 0);
    const canRefund = sale.saleStatus === 'COMPLETED' && hasRefundableItems && window.Permissions.can(user, 'refunds.create');

    const modal = window.UI.openModal({
      title: `Sale ${sale.receiptNumber}${sale.channel === 'WHOLESALE' ? ' · Wholesale' : ''}`,
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
              ${sale.items.map((i) => `<tr><td class="text-sm">${esc(i.nameSnapshot)}${i.priceType === 'WHOLESALE' ? ' <span class="badge badge-info">Wholesale</span>' : ''}${i.refundedQuantity ? ` <span class="text-xs text-muted">(${i.refundedQuantity} refunded)</span>` : ''}</td><td>${i.quantity}</td><td>${fm(i.total)}</td></tr>`).join('')}
            </tbody>
          </table>
        </div>
        <div class="pos-totals-row"><span>Subtotal</span><span>${fm(sale.subtotal)}</span></div>
        <div class="pos-totals-row"><span>Tax</span><span>${fm(sale.tax)}</span></div>
        <div class="pos-totals-row grand"><span>Total</span><span>${fm(sale.total)}</span></div>
        ${sale.channel === 'WHOLESALE' && sale.amountPaid != null ? `<div class="pos-totals-row"><span>Paid</span><span>${fm(sale.amountPaid)}</span></div>` : ''}
        ${sale.balance > 0 ? `<div class="pos-totals-row" style="color:var(--color-warning)"><span>Balance owed${sale.dueDate ? ` (due ${window.UI.formatDate(sale.dueDate)})` : ''}</span><span>${fm(sale.balance)}</span></div>` : ''}
        ${sale.saleStatus === 'CANCELLED' ? `<div class="form-alert form-alert-error" style="margin-top: var(--space-3)">Cancelled: ${esc(sale.cancelReason || '')}</div>` : ''}
      `,
      footerHtml: `
        <button class="btn btn-secondary" data-action="close">Close</button>
        ${window.InvoiceView && sale.saleStatus !== 'CANCELLED' ? `<button class="btn ${sale.channel === 'WHOLESALE' ? 'btn-primary' : 'btn-secondary'}" data-action="invoice">Invoice</button>` : ''}
        ${receipt ? `<button class="btn btn-secondary" data-action="receipt">View receipt</button>` : ''}
        ${canRefund ? `<button class="btn btn-secondary" data-action="refund">Request refund</button>` : ''}
        ${canCancel ? `<button class="btn btn-danger" data-action="cancel">Cancel sale</button>` : ''}
      `,
    });

    modal.querySelector('[data-action="close"]').addEventListener('click', window.UI.closeModal);
    modal.querySelector('[data-action="receipt"]')?.addEventListener('click', () => window.ReceiptView.showReceiptModal(receipt));
    modal.querySelector('[data-action="invoice"]')?.addEventListener('click', () => { window.UI.closeModal(); window.InvoiceView.open(sale._id, { receipt, title: `Invoice ${sale.invoiceNumber || sale.receiptNumber}` }); });
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
        lcDrop('h|'); lcDrop('d|');
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
        lcDrop('h|'); lcDrop('d|');
        fetchHistory();
      } catch (err) {
        window.UI.toast.error(err.message);
      } finally {
        window.UI.setButtonLoading(btn, false);
      }
    });
  }
})();