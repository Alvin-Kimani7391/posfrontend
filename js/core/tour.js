/**
 * tour.js - guided tours for Six Star Pos.
 *
 * WHAT IT DOES
 *  - First login: a "Karibu" welcome offering the full walkthrough, this page only, or not now.
 *  - Every page gets its own short spotlight tour, shown once (per user, per device).
 *  - "What's new": bump a page's `version` and tag new steps `since: <version>`; people who
 *    already saw the page only get the new steps.
 *  - Forms that open in a window (Add product, Payment, Receive stock...) give a short tip
 *    the first time they are opened.
 *  - Some steps are interactive: the highlighted button works, and the tour reacts to it.
 *  - The ? button in the top bar (and in the POS top bar) replays any tour at any time.
 *
 * HOW IT LOADS
 *  app-shell.js injects this file after AppShell.mount(), so no HTML page needs editing.
 *  Public API: window.Tour = { start(), startFull(), reset(), openMenu(anchor) }
 *
 * ADDING A STEP
 *  { target: '#css-selector' | () => element, title, body, late?, pad?, since?,
 *    advanceOn?: 'click' | 'input', endOnAction?: true, tryText? }
 *  - A step whose target is missing/hidden (e.g. the role has no permission) is skipped
 *    silently, so one config works for every role.
 *  - late: true  -> target appears after data loads (table rows); the tour waits for it.
 *  - advanceOn   -> highlighted element stays clickable/typeable; tour moves on after the action.
 *  - endOnAction -> after the action the tour ends (the form that opened gets its own tip).
 */
(function (window) {
  'use strict';

  if (window.Tour) return;

  var STORE = 'sixstar.tour.v1';
  var RUN_KEY = 'sixstar.tour.run';
  var CSS_HREF = 'css/tour.css';

  /* ================================================================== *
   * Small helpers
   * ================================================================== */
  function $(s, r) { return (r || document).querySelector(s); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function isMobile() { return window.matchMedia && window.matchMedia('(max-width: 640px)').matches; }
  function reduceMotion() { return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
  function toast(kind, msg) { try { window.UI.toast[kind](msg); } catch (e) { /* ignore */ } }

  function visible(el) {
    if (!el || !el.isConnected) return false;
    var r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    var cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none';
  }

  function waitFor(fn, ms) {
    return new Promise(function (resolve) {
      var t0 = performance.now();
      (function poll() {
        var v = fn();
        if (v) return resolve(v);
        if (performance.now() - t0 > ms) return resolve(null);
        setTimeout(poll, 120);
      })();
    });
  }

  var cardOf = function (sel) {
    return function () { var e = $(sel); return e ? (e.closest('.card') || e) : null; };
  };

  /* ================================================================== *
   * Per-user storage (localStorage). Shape:
   * { welcomed: bool, auto: bool (default true), pages: {key: version}, tips: {id: 1} }
   * ================================================================== */
  function uid() {
    var u = (window.AppShell && window.AppShell.getUser && window.AppShell.getUser()) || {};
    return String(u._id || u.id || u.phone || 'anon');
  }
  function load() {
    try {
      var d = JSON.parse(localStorage.getItem(STORE + '.' + uid()) || '{}');
      d.pages = d.pages || {};
      d.tips = d.tips || {};
      return d;
    } catch (e) { return { pages: {}, tips: {} }; }
  }
  function save(d) { try { localStorage.setItem(STORE + '.' + uid(), JSON.stringify(d)); } catch (e) { /* private mode */ } }
  function mutate(fn) { var d = load(); fn(d); save(d); return d; }

  function getRun() { try { return JSON.parse(sessionStorage.getItem(RUN_KEY) || 'null'); } catch (e) { return null; } }
  function setRun(r) { try { sessionStorage.setItem(RUN_KEY, JSON.stringify(r)); } catch (e) { /* ignore */ } }
  function clearRun() { try { sessionStorage.removeItem(RUN_KEY); } catch (e) { /* ignore */ } }

  /* ================================================================== *
   * Mobile drawer helpers (the sidebar is off-canvas on phones)
   * ================================================================== */
  var drawer = {
    open: function () {
      if (!visible($('#sidebar-toggle'))) return;
      var s = $('#sidebar'), o = $('#sidebar-overlay');
      if (s) s.classList.add('open');
      if (o) o.classList.add('visible');
    },
    close: function () {
      var s = $('#sidebar'), o = $('#sidebar-overlay');
      if (s) s.classList.remove('open');
      if (o) o.classList.remove('visible');
    },
  };

  /* ================================================================== *
   * TOUR CONTENT
   * ================================================================== */
  var SHELL = [
    {
      target: '#sidebar', pad: 0, title: 'Everything lives in this menu',
      body: 'Each page is one tap away: <b>Sales</b> to sell, <b>Products</b> for your catalogue, <b>Inventory</b> for stock and <b>Reports</b> for the numbers. You only see the pages your role allows.',
      onEnter: function () { drawer.open(); }, onLeave: function () { drawer.close(); },
    },
    {
      target: '#branch-switcher-wrap', title: 'Which shop are you working in?',
      body: 'Sales, stock and shifts follow the branch shown here. Owners with more than one branch can switch it at any time.',
    },
    {
      target: '#notif-bell-wrap', title: 'Alerts come to you',
      body: 'Low stock, shift closings and payment problems show up under the bell, so you do not have to go looking.',
    },
    {
      target: '#tour-help-btn', title: 'Help is always here',
      body: 'Replay this tour, take the full walkthrough or get in touch with support from this button.',
    },
    {
      target: '.bottom-nav', title: 'Quick tabs on your phone',
      body: 'The tabs at the bottom jump to your most used pages. The menu button at the top opens the rest.',
    },
  ];

  var PAGES = {
    dashboard: {
      label: 'Dashboard', href: 'dashboard.html', version: 1, permission: null,
      steps: [
        { target: '.quick-actions', title: 'Shortcuts for common jobs', body: 'Start a sale, check products or record an expense in one tap. Buttons you do not have access to are hidden.' },
        { target: '#dash-filters, #dash-personal-filters', title: 'Choose the period', body: 'Switch between today, yesterday, 7 days, 30 days or this month. Every figure on this page follows your choice. <b>If you see zero, widen the period.</b>' },
        { target: '.takings', title: 'Money in, at a glance', body: 'Your sales for the period and how customers paid: cash, M-PESA, card or credit.' },
        { target: '#dash-kpi-grid, #dash-personal-kpi-grid', title: 'Key figures', body: 'Profit, refunds and what is owed to you or by you. Figures with a drop-down can be tapped to list the sales behind them. Cashiers can tap <b>Transactions</b> to see their own sales.' },
        { target: '#dash-refresh', title: 'Always up to date', body: "Today's figures refresh every minute. Press Refresh to update right away." },
        { target: cardOf('#copy-business-id'), title: 'Give staff their login details', body: 'Staff sign in at the till with your <b>Business ID</b>, their employee code and their PIN. Copy the ID or a ready-made login link here.' },
        { target: '#setup-slot .card', late: true, title: 'Finish setting up your shop', body: 'This checklist disappears once you have added your first employee.' },
      ],
    },

    sales: {
      label: 'Sales', href: 'sales.html', version: 1, permission: 'sales.view', ready: '#pos-search',
      steps: [
        { target: '.pz-tabs', title: 'Sell or look back', body: '<b>New sale</b> is your till. <b>Sales history</b> lists past receipts, where you can reprint, refund or cancel a sale.' },
        { target: '#shift-banner', title: 'Open a shift first', body: 'A shift tracks the cash in your drawer. Open one before taking cash. At the end of the day, close it by counting your notes and coins.' },
        { target: '#pos-search', advanceOn: 'input', tryText: 'Type two letters of a product name, or press Next.', title: 'Scan or search', body: 'Scan a barcode with a handheld scanner or the camera button, or type a product name or SKU. Pick a result and it goes straight onto the ticket.' },
        { target: '#pz-ticket', title: 'Your ticket', body: 'Every product sits on one line with its quantity, discount and subtotal. Use the arrows to change quantity, or tap the discount number to adjust a line.' },
        { target: '#pick-customer-btn', title: 'Walk-in or named customer', body: 'Leave it as walk-in for normal sales. Choose a customer when the sale is on credit.' },
        { target: '#cart-discount-input', title: 'Discount the whole sale', body: 'Type an amount in KES to take it off the entire cart.' },
        { target: '#checkout-btn', title: 'Take payment', body: 'Press this button or <span class="kbd">F9</span>. Choose cash, M-PESA, bank, card or credit. The receipt opens as soon as the sale is saved.' },
        { target: '.pz-keys', title: 'Keyboard shortcuts', body: '<span class="kbd">F2</span> jumps to search, the arrow keys pick a result, <span class="kbd">Enter</span> adds it and <span class="kbd">F9</span> opens payment.' },
        { target: '#pz-focus-btn', title: 'More room, or the full menu', body: 'Full view gives the ticket the whole screen. Tap it again to bring the menu back.' },
        { target: '#tour-help-btn-pz', title: 'Need a reminder?', body: 'This button replays the tour and shows other help any time.' },
      ],
      modals: [
        {
          id: 'sales.payment', detect: '#pz-methods',
          steps: [
            { target: '#pz-methods', title: 'How is the customer paying?', body: '<b>M-PESA STK</b> sends a prompt to their phone. <b>M-PESA Till</b> waits for them to pay your Buy Goods number. Either way the sale completes by itself once the money arrives.' },
            { target: '#pz-pay-panel', title: 'Fill in the details', body: 'For cash, type the amount received or tap a quick amount. The change to give back is worked out for you.' },
            { target: '#pz-complete-btn', title: 'Finish the sale', body: 'This saves the sale and opens the receipt for printing.' },
          ],
        },
        {
          id: 'sales.openShift', detect: '#open-shift-form',
          steps: [
            { target: '#open-shift-form [name="openingCash"]', title: 'Opening cash float', body: 'Enter the cash already in the drawer before the first sale. At closing, the system compares your count against this plus the day\'s cash sales.' },
          ],
        },
      ],
    },

    products: {
      label: 'Products', href: 'products.html', version: 1, permission: 'products.view',
      steps: [
        { target: '#search-input', title: 'Find a product fast', body: 'Search by name, SKU or barcode.' },
        { target: '#category-filter', title: 'Filter by category', body: 'Narrow the list to one category.' },
        { target: '#manage-categories-btn', title: 'Organise with categories', body: 'Create and archive categories here, such as Drinks or Cleaning.' },
        { target: '#products-tbody [data-action="edit"]', late: true, title: 'Edit or archive', body: 'Change a product with the pencil. Archiving hides it from the till but keeps its history.' },
        { target: '#add-product-btn', advanceOn: 'click', endOnAction: true, tryText: 'Tap Add product to see what each box means.', title: 'Add your first product', body: 'Every product needs a name, an SKU and a selling price.' },
      ],
      modals: [
        {
          id: 'products.form', detect: '#product-form',
          steps: [
            { target: '#p-sku', title: 'SKU and barcode', body: 'The SKU is your own code for the product. Add the barcode too (type it, or tap the camera) so it scans at the till.' },
            { target: function () { var e = $('#p-cost'); return e && e.closest('.form-row'); }, title: 'Cost and selling price', body: 'Cost is what you paid. Selling price is what customers pay. The difference becomes your profit in Reports.' },
            { target: '#p-taxrate', title: 'Tax rate', body: 'Standard VAT is 16. Use 0 for items that are exempt.' },
            { target: '#add-variant-row-btn', title: 'Sizes, colours and other options', body: 'Add a variant when one product comes in versions with their own prices. Leave it empty for a simple product.' },
          ],
        },
      ],
    },

    inventory: {
      label: 'Inventory', href: 'inventory.html', version: 1, permission: 'inventory.view',
      steps: [
        { target: '.tabs', title: 'Four views of your stock', body: '<b>Stock levels</b> shows what you have. <b>Low stock</b> lists what to reorder. <b>Movements</b> records every change and who made it. <b>Transfers</b> moves stock between branches.' },
        { target: '#adjust-stock-btn', title: 'Fix mistakes', body: 'Use Adjust for damaged, expired or lost items and count corrections. A reason is required and the change is logged.' },
        { target: '#new-transfer-btn', title: 'Move stock between branches', body: 'The other branch approves, then you dispatch, then they mark it received.' },
        { target: '#receive-stock-btn', advanceOn: 'click', endOnAction: true, tryText: 'Tap Receive stock to see how it works.', title: 'Receive new stock', body: 'Use this when goods arrive without a purchase order. For supplier orders, receive from Purchases instead.' },
      ],
      modals: [
        {
          id: 'inventory.receive', detect: '#receive-form',
          steps: [
            { target: '#pick-product-btn', title: 'Choose the product', body: 'Search for the item that arrived.' },
            { target: '#receive-form [name="quantity"]', title: 'How many arrived', body: 'Enter the quantity you counted. Stock goes up as soon as you save.' },
            { target: '#receive-form [name="batchNumber"]', title: 'Batch and expiry', body: 'Only needed for products where you track batches or expiry dates.' },
          ],
        },
        {
          id: 'inventory.adjust', detect: '#adjust-form',
          steps: [
            { target: '#adjust-form [name="type"]', title: 'Why is stock changing?', body: 'Pick correction, damaged, expired or lost. Reports use this to show where stock went.' },
          ],
        },
        {
          id: 'inventory.transfer', detect: '#transfer-form',
          steps: [
            { target: '#add-item-btn', title: 'Add the items to send', body: 'Choose each product, then set the quantity. The two branches must be different.' },
          ],
        },
      ],
    },

    customers: {
      label: 'Customers', href: 'customers.html', version: 1, permission: 'customers.view',
      steps: [
        { target: '#cust-summary', title: 'Who owes you', body: 'The total your customers owe on credit sales.' },
        { target: '#search-input', title: 'Find a customer', body: 'Search by name, phone number or customer number.' },
        { target: '#customers-tbody [data-action="view"]', late: true, title: 'Open a customer', body: 'See their balance and credit history, set a credit limit and record a payment when they pay you back. Credit sales must also be switched on in Settings.' },
        { target: '#add-customer-btn', title: 'Add a customer', body: 'You can also add one from the till while selling.' },
      ],
    },

    suppliers: {
      label: 'Suppliers', href: 'suppliers.html', version: 1, permission: 'suppliers.view',
      steps: [
        { target: '#search-input', title: 'Find a supplier', body: 'Search by name or phone.' },
        { target: '.table-wrap', title: 'What you owe', body: 'The Payable column shows what you still owe each supplier. It only changes when you receive or pay a purchase.' },
        { target: '#add-supplier-btn', title: 'Add a supplier', body: 'Save their phone, payment terms and tax PIN so purchases are quick to create.' },
      ],
    },

    purchases: {
      label: 'Purchases', href: 'purchases.html', version: 1, permission: 'purchases.view',
      steps: [
        { target: '#purchases-tbody', late: true, title: 'Three separate steps', body: 'Creating a purchase records the order. Stock goes up only when you press <b>Mark received</b> inside it. Payments are recorded separately, so partial payments are fine.' },
        { target: '#add-purchase-btn', advanceOn: 'click', endOnAction: true, tryText: 'Tap New purchase to start an order.', title: 'Order from a supplier', body: 'Pick the supplier, add items and enter the cost you actually paid for each.' },
      ],
      modals: [
        {
          id: 'purchases.form', detect: '#purchase-form',
          steps: [
            { target: '#add-item-btn', title: 'Add items to the order', body: 'Each item takes a quantity and your unit cost. Cost prices here also update your profit reports.' },
          ],
        },
      ],
    },

    expenses: {
      label: 'Expenses', href: 'expenses.html', version: 1, permission: 'expenses.view',
      steps: [
        { target: '#status-filter', title: 'Pending, approved or rejected', body: 'Expenses entered by staff wait here for a manager or owner. Only approved expenses reduce your profit.' },
        { target: '#add-expense-btn', advanceOn: 'click', endOnAction: true, tryText: 'Tap Record expense to see the form.', title: 'Record spending', body: 'Rent, electricity, transport and other running costs.' },
      ],
    },

    refunds: {
      label: 'Refunds', href: 'refunds.html', version: 1, permission: 'refunds.view',
      steps: [
        { target: '#status-filter', title: 'Your approval queue', body: 'Pending requests are shown first.' },
        { target: '.table-wrap', title: 'Approve or reject', body: 'Approving puts the items back in stock and returns the money. To start a new refund, open the sale in <b>Sales history</b>.' },
      ],
    },

    reports: {
      label: 'Reports', href: 'reports.html', version: 1, permission: 'reports.view',
      steps: [
        { target: '#filters', title: 'Set the scope', body: 'Choose dates, a branch or a cashier. Every report below follows these filters.' },
        { target: '.tabs', title: 'Eight reports in one place', body: 'Sales, profit and loss, payments, cashiers, expenses, inventory, customers owing and suppliers owed.' },
        { target: '#sales-kpi-grid', late: true, title: 'Tap a figure to see why', body: 'Tax, discounts and refunds open a list of the exact sales behind each number.' },
        { target: '#export-btn', title: 'Take it with you', body: 'Export to CSV for Excel, or print the page.' },
      ],
    },

    cash: {
      label: 'Registers and shifts', href: 'cash-register.html', version: 1, permission: 'registers.view',
      steps: [
        { target: '#cr-tabs', title: 'Shifts and registers', body: '<b>Shifts</b> shows who opened and closed each one. <b>Registers</b> is where you create tills.' },
        { target: '#cr-body', late: true, title: 'Over or short', body: 'When a shift closes, the cash counted is compared with what the drawer should hold. Open a shift for the notes and coins breakdown.' },
      ],
    },

    branches: {
      label: 'Branches', href: 'branches.html', version: 1, permission: 'branches.view',
      steps: [
        { target: '#add-branch-btn', title: 'Add a branch', body: 'Each branch has its own stock, shifts and sales. Staff only see the branches you give them.' },
        { target: '.table-wrap', title: 'Deactivate, never delete', body: 'Deactivated branches keep their history but cannot make new sales.' },
      ],
    },

    employees: {
      label: 'Employees', href: 'employees.html', version: 1, permission: 'employees.view',
      steps: [
        { target: cardOf('#copy-business-id'), title: 'Your Business ID', body: 'Staff need this, plus their own code and PIN, to sign in at the till.' },
        { target: '#employees-tbody [data-action="info"]', late: true, title: 'Share login details again', body: 'Shows the Business ID, code and a ready login link. The PIN is stored encrypted, so it can only be shown when you first create it.' },
        { target: '#add-employee-btn', advanceOn: 'click', endOnAction: true, tryText: 'Tap Add employee to see the form.', title: 'Add a team member', body: 'Choose a role, an employee code and a PIN.' },
      ],
      modals: [
        {
          id: 'employees.form', detect: '#employee-form',
          steps: [
            { target: '#e-role', title: 'Pick a role', body: 'Cashiers sell. Storekeepers manage stock. Managers approve refunds and expenses.' },
            { target: '#e-code', title: 'Employee code', body: 'The employee types this at the till together with the Business ID and PIN.' },
            { target: function () { var e = $('#e-pin'); return e ? e.closest('.form-row') : null; }, title: 'Set a PIN or password', body: 'After saving you can send the details on WhatsApp. <b>The PIN cannot be seen again</b>, so share it straight away.' },
          ],
        },
      ],
    },

    audit: {
      label: 'Audit log', href: 'audit-logs.html', version: 1, permission: 'audit.view',
      steps: [
        { target: '#quick-chips', title: 'Filter by activity', body: 'Jump straight to sales, refunds, stock changes, shifts or sign-ins.' },
        { target: '.audit-filters', title: 'Narrow it down', body: 'Filter by person, branch and dates to answer questions like who cancelled a sale.' },
        { target: '#log-tbody', late: true, title: 'Open any entry', body: 'Entries that changed something show what it was before and after. Nothing here can be edited or deleted.' },
      ],
    },

    notifications: {
      label: 'Notifications', href: 'notifications.html', version: 1, permission: 'notifications.view',
      steps: [
        { target: '#notif-quick-chips', title: 'Filter by type', body: 'Shifts, sales, stock and payments each have their own filter.' },
        { target: '#unread-only', title: 'Only what you have not seen', body: 'Tick this to hide notifications you have already read.' },
        { target: '#raise-alert-btn', title: 'Tell management', body: 'Spotted a problem on the shop floor? Send an alert straight to the owner.' },
      ],
    },

    tickets: {
      label: 'Help and support', href: 'tickets.html', version: 1, permission: 'tickets.view',
      steps: [
        { target: '#tk-chips', title: 'Follow your tickets', body: 'See which are open, in progress or solved. You are notified when one is fixed.' },
        { target: '#new-ticket-btn', advanceOn: 'click', endOnAction: true, tryText: 'Tap Raise a ticket to see the form.', title: 'Something not working?', body: 'Describe the problem, paste the red error message and add screenshots.' },
      ],
      modals: [
        {
          id: 'tickets.form', detect: '#tk-form',
          steps: [
            { target: '#tk-paste', title: 'Paste the error message', body: 'Copy the red message you saw and paste it here. It helps us fix the problem faster.' },
            { target: '#tk-picker', title: 'Add screenshots', body: 'Attach a photo or screenshot of the screen.' },
          ],
        },
      ],
    },

    settings: {
      label: 'Settings', href: 'settings.html', version: 1, permission: 'settings.view',
      steps: [
        { target: cardOf('#business-form'), late: true, title: 'Business and receipt details', body: 'Your name, KRA PIN and the lines printed on every receipt, including paper width (80mm or 58mm).' },
        { target: cardOf('#settings_enableCustomerCredit'), late: true, title: 'Allow credit sales', body: 'Turn this on if cashiers may sell on credit to customers with a credit limit.' },
        { target: cardOf('#mpesa-form'), late: true, title: 'M-PESA prompt (STK push)', body: 'Connect PayHero so cashiers can send a payment prompt to the customer\'s phone.' },
        { target: '#till-card', late: true, title: 'M-PESA Till (Buy Goods)', body: 'Customers pay your Till themselves and the POS confirms it. Copy the webhook URL into PayHero.' },
        { target: cardOf('#etims-form'), late: true, title: 'Send sales to KRA', body: 'Connect eTIMS through DigiTax to transmit every sale automatically.' },
      ],
    },
  };

  var ORDER = ['dashboard', 'sales', 'products', 'inventory', 'customers', 'suppliers', 'purchases', 'expenses', 'refunds', 'reports', 'cash', 'branches', 'employees', 'audit', 'notifications', 'tickets', 'settings'];

  /* ================================================================== *
   * Engine
   * ================================================================== */
  var page = '';
  var layer = null, ui = {};
  var run = null;       // active tour (or welcome)
  var menuEl = null;
  var started = false;

  var SVG_X = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
  var SVG_HELP = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9.5"/><path d="M9.2 9.3a2.9 2.9 0 0 1 5.5 1.2c0 1.9-2.7 2.3-2.7 4"/><circle cx="12" cy="17.6" r=".6" fill="currentColor"/></svg>';

  function injectCss() {
    if ($('#tour-css')) return;
    var l = document.createElement('link');
    l.id = 'tour-css'; l.rel = 'stylesheet'; l.href = CSS_HREF;
    document.head.appendChild(l);
  }

  function buildLayer() {
    if (layer) return;
    layer = document.createElement('div');
    layer.className = 'tour-layer';
    layer.innerHTML =
      '<div class="tour-dim"></div>' +
      '<div class="tour-block" data-b="t"></div><div class="tour-block" data-b="b"></div>' +
      '<div class="tour-block" data-b="l"></div><div class="tour-block" data-b="r"></div>' +
      '<div class="tour-guard"></div>' +
      '<div class="tour-hole" aria-hidden="true"></div>' +
      '<div class="tour-card" role="dialog" aria-labelledby="tour-title" tabindex="-1"></div>';
    document.body.appendChild(layer);
    ui.dim = $('.tour-dim', layer);
    ui.hole = $('.tour-hole', layer);
    ui.guard = $('.tour-guard', layer);
    ui.card = $('.tour-card', layer);
    ui.blocks = {
      t: $('[data-b="t"]', layer), b: $('[data-b="b"]', layer),
      l: $('[data-b="l"]', layer), r: $('[data-b="r"]', layer),
    };
    ui.card.addEventListener('click', onCardClick);
  }

  function resolve(s) {
    var t = s.target;
    if (!t) return null;
    try { return typeof t === 'function' ? t() : $(t); } catch (e) { return null; }
  }

  /* ---- layout ---- */
  function setBox(el, l, t, w, h) {
    el.style.left = l + 'px'; el.style.top = t + 'px';
    el.style.width = Math.max(w, 0) + 'px'; el.style.height = Math.max(h, 0) + 'px';
  }

  function placeAround(r, s) {
    var vw = window.innerWidth, vh = window.innerHeight, pad = s.pad == null ? 6 : s.pad;
    var t = Math.max(r.top - pad, 4), l = Math.max(r.left - pad, 4);
    var b = Math.min(r.bottom + pad, vh - 4), rt = Math.min(r.right + pad, vw - 4);

    ui.dim.classList.remove('show');
    ui.hole.style.display = 'block';
    setBox(ui.hole, l, t, rt - l, b - t);

    var interactive = !!run.interactive;
    setBox(ui.blocks.t, 0, 0, vw, t);
    setBox(ui.blocks.b, 0, b, vw, vh - b);
    setBox(ui.blocks.l, 0, t, l, b - t);
    setBox(ui.blocks.r, rt, t, vw - rt, b - t);
    Object.keys(ui.blocks).forEach(function (k) { ui.blocks[k].style.display = 'block'; });
    ui.guard.style.display = interactive ? 'none' : 'block';
    setBox(ui.guard, l, t, rt - l, b - t);

    placeCard(t, l, b, rt);
  }

  function placeCenter() {
    ui.hole.style.display = 'none';
    ui.guard.style.display = 'none';
    Object.keys(ui.blocks).forEach(function (k) { ui.blocks[k].style.display = 'none'; });
    ui.dim.classList.add('show');
    ui.card.classList.add('center');
    ui.card.removeAttribute('style');
  }

  function placeCard(t, l, b, rt) {
    var card = ui.card, vw = window.innerWidth, vh = window.innerHeight, m = 12;
    card.classList.remove('center');
    card.style.transform = '';

    if (isMobile()) {
      card.style.left = m + 'px'; card.style.right = m + 'px'; card.style.width = 'auto';
      if ((t + b) / 2 > vh / 2) { card.style.top = m + 'px'; card.style.bottom = 'auto'; }
      else { card.style.top = 'auto'; card.style.bottom = 'calc(' + m + 'px + env(safe-area-inset-bottom, 0px))'; }
      return;
    }

    card.style.right = 'auto'; card.style.bottom = 'auto'; card.style.width = '';
    var cw = card.offsetWidth, ch = card.offsetHeight, gap = 14, x, y;
    var cx = Math.min(Math.max((l + rt) / 2 - cw / 2, m), vw - cw - m);
    var clampY = function (v) { return Math.min(Math.max(v, m), vh - ch - m); };

    if (b + gap + ch + m <= vh) { x = cx; y = b + gap; }
    else if (t - gap - ch >= m) { x = cx; y = t - gap - ch; }
    else if (rt + gap + cw + m <= vw) { x = rt + gap; y = clampY(t); }
    else if (l - gap - cw >= m) { x = l - gap - cw; y = clampY(t); }
    else { x = vw - cw - m; y = vh - ch - m; }
    card.style.left = Math.round(x) + 'px';
    card.style.top = Math.round(y) + 'px';
  }

  function ensureInView(el) {
    var r = el.getBoundingClientRect(), vh = window.innerHeight;
    if (r.top >= 0 && r.bottom <= vh) return;
    if (r.height > vh * 0.8) { if (r.top < 0 || r.top > vh) el.scrollIntoView({ block: 'start' }); return; }
    el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: reduceMotion() ? 'auto' : 'smooth' });
  }

  /* Follows the target every frame: handles scrolling, drawers sliding in and re-rendered DOM. */
  function loop() {
    if (!run) return;
    var s = run.step;
    if (s && !s.center) {
      var el = resolve(s);
      if (visible(el)) {
        if (el !== run.el) { run.el = el; bindAdvance(s, el); }
        var r = el.getBoundingClientRect();
        var key = [r.top | 0, r.left | 0, r.width | 0, r.height | 0, window.innerWidth, window.innerHeight].join(',');
        if (key !== run.key) { run.key = key; placeAround(r, s); }
      }
    }
    run.raf = requestAnimationFrame(loop);
  }

  /* ---- step lifecycle ---- */
  function cleanupStep() {
    if (!run) return;
    if (run.advance) { run.advance.el.removeEventListener(run.advance.type, run.advance.h, true); run.advance = null; }
    var s = run.step;
    run.step = null; run.el = null; run.key = '';
    if (s && s.onLeave) { try { s.onLeave(); } catch (e) { /* ignore */ } }
  }

  async function show(i, dir) {
    if (!run) return;
    dir = dir || 1;
    var my = ++run.token;
    cleanupStep();
    if (i >= run.steps.length) return finish(true);
    if (i < 0) i = 0;
    var s = run.steps[i];
    run.i = i;
    if (s.onEnter) { try { s.onEnter(); } catch (e) { /* ignore */ } }

    var el = null;
    if (!s.center) {
      el = await waitFor(function () { var e = resolve(s); return visible(e) ? e : null; }, s.late ? 3000 : 1200);
      if (my !== run.token) return;
      if (!el) {
        run.steps.splice(i, 1);
        if (!run.steps.length) return finish(false);
        return show(dir > 0 ? i : Math.max(i - 1, 0), dir);
      }
    }
    run.step = s;
    run.interactive = !!(s.advanceOn && !run.opts.full);
    renderCard(s);
    if (el) {
      ensureInView(el);
      run.el = el;
      if (!reduceMotion()) {
        ui.hole.classList.add('animate');
        clearTimeout(run.animT);
        run.animT = setTimeout(function () { ui.hole.classList.remove('animate'); }, 360);
      }
      ui.hole.classList.toggle('try', run.interactive);
      placeAround(el.getBoundingClientRect(), s);
      bindAdvance(s, el);
    } else {
      placeCenter();
    }
    ui.card.style.visibility = 'visible';
    ui.card.classList.remove('pop'); void ui.card.offsetWidth; ui.card.classList.add('pop');
    if (!run.interactive) { var nb = $('[data-t="next"]', ui.card); if (nb) nb.focus({ preventScroll: true }); }
  }

  function bindAdvance(s, el) {
    if (!run || !run.interactive || !s.advanceOn) return;
    if (run.advance) run.advance.el.removeEventListener(run.advance.type, run.advance.h, true);
    var h = function () {
      if (run && run.advance) { run.advance.el.removeEventListener(run.advance.type, run.advance.h, true); run.advance = null; }
      setTimeout(function () {
        if (!run || run.step !== s) return;
        if (s.endOnAction) finish(true); else show(run.i + 1, 1);
      }, 380);
    };
    el.addEventListener(s.advanceOn, h, true);
    run.advance = { el: el, type: s.advanceOn, h: h };
  }

  function renderCard(s) {
    var n = run.steps.length, i = run.i, last = i === n - 1, opts = run.opts;
    var dots = '';
    if (n > 1) {
      if (n <= 8) { for (var k = 0; k < n; k++) dots += '<span class="' + (k === i ? 'on' : (k < i ? 'done' : '')) + '"></span>'; }
      else dots = '<span class="tour-count">' + (i + 1) + ' of ' + n + '</span>';
    }
    var nextLabel = last ? (opts.finishLabel || 'Done') : 'Next';
    var hint = run.interactive
      ? '<div class="tour-try"><span class="tour-try-dot"></span>' + esc(s.tryText || 'Try it: tap the highlighted area.') + '</div>' : '';

    var meta = '';
    if (opts.full) {
      meta = '<div class="tour-meta"><span>Page ' + (opts.fullIndex + 1) + ' of ' + opts.fullTotal + '</span><button type="button" class="tour-link" data-t="close">End walkthrough</button></div>';
    } else if (opts.auto) {
      meta = '<div class="tour-meta"><span></span><button type="button" class="tour-link" data-t="autooff">Stop automatic tips</button></div>';
    }

    ui.card.innerHTML =
      '<button type="button" class="tour-x" data-t="close" aria-label="Close tour">' + SVG_X + '</button>' +
      '<h3 class="tour-title" id="tour-title">' + s.title + '</h3>' +
      '<div class="tour-body">' + s.body + '</div>' + hint +
      '<div class="tour-foot"><div class="tour-dots">' + dots + '</div><div class="tour-actions">' +
      (i > 0 ? '<button type="button" class="btn btn-ghost btn-sm" data-t="back">Back</button>' : '') +
      '<button type="button" class="btn btn-primary btn-sm" data-t="next">' + esc(nextLabel) + '</button></div></div>' + meta;
    layer.classList.add('on');
  }

  function onCardClick(e) {
    var b = e.target.closest('[data-t]');
    if (!b || !run) return;
    var a = b.dataset.t;
    if (a === 'next') show(run.i + 1, 1);
    else if (a === 'back') show(run.i - 1, -1);
    else if (a === 'close') finish(false);
    else if (a === 'autooff') {
      mutate(function (d) { d.auto = false; });
      toast('success', 'Automatic tips are off. Use the ? button to open a tour any time.');
      finish(false);
    }
    else if (a === 'w-full') { var r = run; closeLayer(); run = null; startFull(); void r; }
    else if (a === 'w-page') { closeLayer(); run = null; markWelcomed(); startPage(page, { all: true }); }
    else if (a === 'w-later') { markWelcomed(); finish(false); }
    else if (a === 'w-never') { mutate(function (d) { d.welcomed = true; d.auto = false; }); toast('success', 'Done. Find tours any time under the ? button.'); finish(false); }
  }

  function closeLayer() {
    if (run && run.raf) cancelAnimationFrame(run.raf);
    cleanupStep();
    if (layer) {
      layer.classList.remove('on');
      ui.hole.classList.remove('try', 'animate');
      ui.card.style.visibility = 'hidden';
    }
  }

  function finish(completed) {
    if (!run) return;
    var r = run;
    closeLayer();
    run = null;
    if (r.welcome) markWelcomed();
    if (r.opts.seen) {
      mutate(function (d) {
        if (r.opts.seen.page) d.pages[r.opts.seen.page] = r.opts.seen.version;
        if (r.opts.seen.tip) d.tips[r.opts.seen.tip] = 1;
      });
    }
    if (r.prevFocus && r.prevFocus.focus) { try { r.prevFocus.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
    if (r.opts.onDone) { try { r.opts.onDone(completed); } catch (e) { /* ignore */ } }
    setTimeout(checkModals, 500);
  }

  function markWelcomed() { mutate(function (d) { d.welcomed = true; }); }

  /* ---- keyboard ---- */
  document.addEventListener('keydown', function (e) {
    if (!run) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); return; }
    if (run.welcome) return;
    var tag = (e.target && e.target.tagName) || '';
    var typing = /^(INPUT|TEXTAREA|SELECT)$/.test(tag) && !(layer && layer.contains(e.target));
    if (typing) return;
    if (e.key === 'ArrowRight') { e.preventDefault(); show(run.i + 1, 1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); show(run.i - 1, -1); }
  }, true);

  /* ================================================================== *
   * Starting tours
   * ================================================================== */
  function newRun(steps, opts) {
    buildLayer();
    run = {
      steps: steps, i: 0, token: 0, opts: opts || {}, step: null, el: null, key: '', raf: 0,
      prevFocus: document.activeElement, interactive: false,
    };
    ui.card.style.visibility = 'hidden';
    layer.classList.add('on');
    run.raf = requestAnimationFrame(loop);
    return run;
  }

  async function startTour(steps, opts) {
    if (run) return false;
    steps = steps.filter(function (s) { return s.center || s.late || visible(resolve(s)); });
    if (!steps.length) return false;
    newRun(steps.slice(), opts);
    await show(0, 1);
    return true;
  }

  async function pageReady(cfg) {
    await waitFor(function () {
      var pc = $('#page-content');
      if (!pc || !pc.children.length) return false;
      if (cfg && cfg.ready && !$(cfg.ready)) return false;
      return !pc.querySelector('.skeleton');
    }, 9000);
    await sleep(350);
  }

  function allowed(key) {
    var cfg = PAGES[key];
    if (!cfg) return false;
    if (!cfg.permission) return true;
    try { return window.Permissions.can(window.AppShell.getUser(), cfg.permission); } catch (e) { return false; }
  }

  async function startPage(key, mode) {
    mode = mode || {};
    var cfg = PAGES[key];
    if (!cfg || run) return false;
    await pageReady(cfg);
    var seenV = (load().pages || {})[key] || 0;
    var list = (key === 'dashboard' ? SHELL : []).concat(cfg.steps);
    if (!mode.all && !mode.full && seenV > 0) list = list.filter(function (s) { return (s.since || 1) > seenV; });

    var opts = { seen: { page: key, version: cfg.version }, auto: !!mode.auto };
    if (mode.full) {
      var rs = getRun() || { queue: [key], i: 0 };
      var nextKey = rs.queue[rs.i + 1];
      opts.full = true; opts.fullIndex = rs.i; opts.fullTotal = rs.queue.length;
      opts.finishLabel = nextKey ? 'Next: ' + PAGES[nextKey].label : 'Finish';
      opts.onDone = function (completed) {
        var cur = getRun();
        if (!cur) return;
        if (!completed) { clearRun(); toast('success', 'Walkthrough ended. Restart it from the ? button.'); return; }
        cur.i += 1;
        if (cur.i < cur.queue.length) { setRun(cur); window.location.href = PAGES[cur.queue[cur.i]].href; }
        else { clearRun(); markWelcomed(); toast('success', "That's the whole POS. You can replay any tour from the ? button."); }
      };
    }
    var ok = await startTour(list, opts);
    if (!ok && mode.manual) toast('success', 'There is nothing to tour on this page for your role.');
    if (!ok && mode.full) opts.onDone(true);
    return ok;
  }

  function startFull() {
    var queue = ORDER.filter(allowed);
    if (!queue.length) return;
    setRun({ queue: queue, i: 0 });
    if (queue[0] === page) startPage(page, { full: true });
    else window.location.href = PAGES[queue[0]].href;
  }

  function showWelcome() {
    if (run) return;
    buildLayer();
    var u = (window.AppShell.getUser() || {});
    var first = esc(String(u.name || '').split(' ')[0] || 'there');
    var appName = esc((window.AppShell && window.AppShell.APP_NAME) || 'the POS');
    run = { welcome: true, steps: [], i: 0, token: 0, opts: {}, step: null, prevFocus: document.activeElement };
    ui.card.innerHTML =
      '<h3 class="tour-title tour-title-lg" id="tour-title">Karibu, ' + first + '</h3>' +
      '<div class="tour-body">Welcome to ' + appName + '. A two minute tour shows you where to sell, receive stock and check your money. You can replay it any time from the <b>?</b> button at the top.</div>' +
      '<div class="tour-stack">' +
      '<button type="button" class="btn btn-primary btn-block" data-t="w-full">Start the full walkthrough</button>' +
      '<button type="button" class="btn btn-secondary btn-block" data-t="w-page">Just show me this page</button>' +
      '<button type="button" class="btn btn-ghost btn-block" data-t="w-later">Not now</button>' +
      '</div>' +
      '<div class="tour-meta"><span></span><button type="button" class="tour-link" data-t="w-never">Never show tips automatically</button></div>';
    layer.classList.add('on');
    placeCenter();
    ui.card.style.visibility = 'visible';
    ui.card.classList.remove('pop'); void ui.card.offsetWidth; ui.card.classList.add('pop');
    var b = $('[data-t="w-full"]', ui.card); if (b) b.focus({ preventScroll: true });
  }

  /* ---- tips for windows (modals) that open on this page ---- */
  function checkModals() {
    if (run) return;
    var cfg = PAGES[page];
    if (!cfg || !cfg.modals) return;
    var st = load();
    if (st.auto === false || !st.welcomed) return;
    for (var i = 0; i < cfg.modals.length; i++) {
      var m = cfg.modals[i];
      if (st.tips[m.id]) continue;
      if (visible($(m.detect))) {
        startTour(m.steps, { seen: { tip: m.id }, finishLabel: 'Got it' });
        return;
      }
    }
  }

  function watchModals() {
    var cfg = PAGES[page];
    if (!cfg || !cfg.modals) return;
    var t;
    new MutationObserver(function () { clearTimeout(t); t = setTimeout(checkModals, 400); })
      .observe(document.body, { childList: true });
  }

  /* ================================================================== *
   * Help button + menu
   * ================================================================== */
  function closeMenu() {
    if (menuEl) { menuEl.remove(); menuEl = null; }
    document.removeEventListener('click', closeMenu, true);
  }

  function openMenu(anchor) {
    closeMenu();
    var st = load();
    var canSupport = false;
    try { canSupport = window.Permissions.can(window.AppShell.getUser(), 'tickets.view'); } catch (e) { /* ignore */ }
    var items = [];
    if (PAGES[page]) items.push(['page', 'Tour this page']);
    items.push(['full', 'Full walkthrough of the POS']);
    if (canSupport && page !== 'tickets') items.push(['support', 'Get help from support']);
    items.push(['auto', st.auto === false ? 'Turn on automatic tips' : 'Turn off automatic tips']);

    menuEl = document.createElement('div');
    menuEl.className = 'tour-menu';
    menuEl.setAttribute('role', 'menu');
    menuEl.innerHTML = items.map(function (it) { return '<button type="button" role="menuitem" data-m="' + it[0] + '">' + esc(it[1]) + '</button>'; }).join('');
    document.body.appendChild(menuEl);

    var r = anchor.getBoundingClientRect();
    menuEl.style.top = (r.bottom + 8) + 'px';
    var left = Math.min(Math.max(r.right - menuEl.offsetWidth, 8), window.innerWidth - menuEl.offsetWidth - 8);
    menuEl.style.left = left + 'px';

    menuEl.addEventListener('click', function (e) {
      var b = e.target.closest('[data-m]');
      if (!b) return;
      var a = b.dataset.m;
      closeMenu();
      if (a === 'page') startPage(page, { all: true, manual: true });
      else if (a === 'full') startFull();
      else if (a === 'support') window.location.href = 'tickets.html';
      else if (a === 'auto') {
        var on = load().auto === false;
        mutate(function (d) { d.auto = on; });
        toast('success', on ? 'Automatic tips are on.' : 'Automatic tips are off.');
      }
    });
    setTimeout(function () { document.addEventListener('click', closeMenu, true); }, 0);
    var first = $('button', menuEl); if (first) first.focus();
  }

  function mountLaunchers() {
    var attempt = function () {
      var right = $('.topbar-right');
      if (right && !$('#tour-help-btn')) {
        var b = document.createElement('button');
        b.id = 'tour-help-btn'; b.type = 'button'; b.className = 'btn btn-ghost btn-icon';
        b.title = 'Help and tours'; b.setAttribute('aria-label', 'Help and tours'); b.setAttribute('aria-haspopup', 'menu');
        b.innerHTML = SVG_HELP;
        right.insertBefore(b, $('#logout-btn') || null);
        b.addEventListener('click', function (e) { e.stopPropagation(); openMenu(b); });
      }
      var pz = $('.pz-top-right');
      if (pz && !$('#tour-help-btn-pz')) {
        var p = document.createElement('button');
        p.id = 'tour-help-btn-pz'; p.type = 'button'; p.className = 'pz-iconbtn';
        p.title = 'Help and tours'; p.setAttribute('aria-label', 'Help and tours'); p.setAttribute('aria-haspopup', 'menu');
        p.innerHTML = SVG_HELP;
        pz.insertBefore(p, $('#pz-focus-btn') || pz.firstChild);
        p.addEventListener('click', function (e) { e.stopPropagation(); openMenu(p); });
      }
    };
    attempt();
    var n = 0;
    var timer = setInterval(function () { attempt(); if (++n > 40) clearInterval(timer); }, 400);
  }

  /* ================================================================== *
   * Boot
   * ================================================================== */
  async function boot() {
    if (started) return;
    started = true;
    page = (document.body && document.body.dataset.page) || '';
    if (!page || !window.AppShell || !window.AppShell.getUser || !window.AppShell.getUser()) return;
    injectCss();
    mountLaunchers();
    watchModals();

    var cfg = PAGES[page];
    var rs = getRun();
    if (rs) {
      if (rs.queue[rs.i] === page) { startPage(page, { full: true }); return; }
      clearRun();
    }
    var st = load();
    if (st.auto === false || !cfg) return;

    await pageReady(cfg);
    if (run || $('.modal-backdrop')) return;
    if (!st.welcomed) { showWelcome(); return; }
    if ((st.pages[page] || 0) < cfg.version) startPage(page, { auto: true });
  }

  window.Tour = {
    start: function () { return startPage(page, { all: true, manual: true }); },
    startFull: startFull,
    openMenu: openMenu,
    reset: function () { try { localStorage.removeItem(STORE + '.' + uid()); } catch (e) { /* ignore */ } clearRun(); },
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(window);