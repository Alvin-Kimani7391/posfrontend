/**
 * app-shell.js (merged: original shell + pharmacy till integration)
 * Every authenticated page (dashboard.html, branches.html, employees.html, ...)
 * has the same <div id="app-shell"></div> placeholder and the same
 * <body data-page="branches"> attribute. This file renders the sidebar,
 * topbar, and mobile bottom nav into that placeholder, wires up navigation
 * and logout - once, in one place - so no page has to duplicate that markup.
 *
 * Usage in a page's own script:
 *   const content = AppShell.mount({ title: 'Branches' });
 *   const user = AppShell.getUser();
 *
 * BRAND: the product name lives in ONE place (APP_NAME below). It is used for
 * the sidebar brand AND the browser tab title (set in mount()), so every page
 * that mounts the shell is consistent automatically.
 *
 * GUIDED TOURS: mount() also loads js/core/tour.js (see loadTour below), so every
 * page gets the first-visit tour and the ? help button without editing any HTML.
 *
 * ANNOUNCEMENTS: mount() also loads js/core/announcements.js (see loadAnnouncements
 * below) - platform notices from the super admin, shown as a pop-up or a scrolling
 * ticker depending on the page. The page is read from <body data-page="...">.
 *
 * CASH DRAWER: for users with sales.view, mount() loads js/core/cash-drawer.js and
 * shows a small drawer status chip in the topbar (click it for drawer settings).
 * Pages that need the drawer (sales.js) call AppShell.whenCashDrawerReady().
 *
 * PHARMACY TILL: for businesses with the pharmacyDispensing feature the till is split into
 * "Dispense prescription" and "Over the counter" (both open sales.html, see pharmacy-desk.js),
 * and the normal Sales link becomes "Sales history" (sales.html?view=history).
 */
(function (window) {
  const APP_NAME = 'Six Star Pos';

  const NAV_ITEMS = [
    { key: 'dashboard',     label: 'Dashboard',          icon: 'dashboard', href: 'dashboard.html' },
    // Setup guide: owner only (it edits business settings). Always reachable so the owner can resume it any time.
    { key: 'onboarding', hxHide: true,    label: 'Setup guide',        icon: 'rocket',    href: 'onboarding.html',    permission: 'settings.update', ownerOnly: true, badge: 'setup' },
    // Pharmacy: the till is split into the two things a pharmacy actually does (both open sales.html; see pharmacy-desk.js).
    { key: 'dispense-rx',  label: 'Dispense prescription', icon: 'pill', href: 'sales.html?desk=rx',  permission: 'sales.create', feature: ['pharmacyDispensing'] },
    { key: 'dispense-otc', label: 'Over the counter',      icon: 'bag',  href: 'sales.html?desk=otc', permission: 'sales.create', feature: ['pharmacyDispensing'] },
    { key: 'sales', hxHide: true,         label: 'Sales',              icon: 'sales',     href: 'sales.html',         permission: 'sales.view', phLabel: 'Sales history', phHref: 'sales.html?view=history' },
    // Anti-fraud: scan a receipt's QR to confirm it is a real sale. Open to every signed-in staff member (no permission).
    { key: 'verify', hxHide: true,        label: 'Verify receipt',     icon: 'shield',    href: 'verify.html' },
    // ---- Restaurant & accommodation (shown only when those modules are switched on; see isHospitality()).
    { key: 'hx-floor',        group: 'Restaurant',    label: 'Tables & orders',      icon: 'table',    href: 'hx-floor.html',        permission: 'restaurant.orders.view', feature: ['restaurantOrdering'] },
    { key: 'hx-kitchen',      group: 'Restaurant',    label: 'Kitchen & bar',        icon: 'flame',    href: 'hx-kitchen.html',      permission: 'restaurant.kitchen.view', feature: ['restaurantOrdering'] },
    { key: 'hx-bills',        group: 'Restaurant',    label: 'Bills & payments',     icon: 'receipt',  href: 'hx-bills.html',        permission: 'restaurant.bills.view', feature: ['restaurantOrdering'] },
    { key: 'hx-reservations', group: 'Restaurant',    label: 'Reservations',         icon: 'calendar', href: 'hx-reservations.html', permission: 'restaurant.reservations.view', feature: ['reservations'] },
    { key: 'hx-delivery',     group: 'Restaurant',    label: 'Delivery & pickup',    icon: 'bike',     href: 'hx-delivery.html',     permAny: ['restaurant.delivery.view', 'restaurant.delivery.self'], feature: ['restaurantOrdering'] },
    { key: 'hx-selfservice',  group: 'Restaurant',    label: 'Self-service kiosk',   icon: 'receipt',  href: 'hx-selfservice.html',  permAny: ['restaurant.bills.view', 'restaurant.settings.manage'], feature: ['restaurantOrdering'] },
    { key: 'hx-storefront',   group: 'Restaurant',    label: 'Online storefront',    icon: 'bike',     href: 'hx-storefront.html',   permission: 'restaurant.guest.qr', feature: ['restaurantOrdering'] },
    { key: 'hx-menu',         group: 'Restaurant',    label: 'Menu',                 icon: 'utensils', href: 'hx-menu.html',         permission: 'restaurant.menu.manage', feature: ['restaurantOrdering'] },
    { key: 'hx-stock',        group: 'Restaurant',    label: 'Ingredients & recipes',icon: 'box',      href: 'hx-stock.html',        permission: 'restaurant.ingredients.view', feature: ['recipeManagement'] },
    { key: 'hx-guest',        group: 'Restaurant',    label: 'Guest requests & QR',  icon: 'qr',       href: 'hx-guest.html',        permAny: ['restaurant.guest.view', 'restaurant.guest.qr'], feature: ['guestQrOrdering'] },
    { key: 'hx-staff',        group: 'Restaurant',    label: 'Shifts & tips',        icon: 'clock',    href: 'hx-staff.html',        permAny: ['restaurant.shifts.self', 'restaurant.shifts.view', 'restaurant.tips.view'], feature: ['restaurantOrdering'] },
    { key: 'hx-desk',         group: 'Accommodation', label: 'Front desk',           icon: 'key',      href: 'hx-desk.html',         permission: 'accommodation.stays.view', feature: ['accommodation'] },
    { key: 'hx-rooms',        group: 'Accommodation', label: 'Room board',           icon: 'bed',      href: 'hx-rooms.html',        permission: 'accommodation.rooms.view', feature: ['accommodation'] },
    { key: 'hx-stays',        group: 'Accommodation', label: 'Bookings',             icon: 'calendar', href: 'hx-stays.html',        permission: 'accommodation.stays.view', feature: ['accommodation'] },
    { key: 'hx-housekeeping', group: 'Accommodation', label: 'Housekeeping',         icon: 'broom',    href: 'hx-housekeeping.html', permission: 'accommodation.housekeeping.view', feature: ['accommodation'] },
    { key: 'hx-reports',      group: 'Restaurant & rooms', label: 'Reports',         icon: 'reports',  href: 'hx-reports.html',      permAny: ['restaurant.reports.view', 'accommodation.reports.view'], feature: ['restaurantOrdering', 'accommodation'] },
    { key: 'hx-setup',        group: 'Restaurant & rooms', label: 'Setup guide',     icon: 'rocket',   href: 'hx-setup.html',        permAny: ['restaurant.settings.manage', 'restaurant.tables.manage', 'restaurant.menu.manage', 'accommodation.rooms.manage'], feature: ['restaurantOrdering', 'accommodation'] },
    { key: 'hx-settings',     group: 'Restaurant & rooms', label: 'Service settings',icon: 'sliders',  href: 'hx-settings.html',     permAny: ['restaurant.settings.view', 'accommodation.settings.view'], feature: ['restaurantOrdering', 'accommodation'] },
    { key: 'hx-services',     group: 'Restaurant & rooms', label: 'Services & system check', icon: 'sliders', href: 'hx-services.html', permission: 'settings.update' },
    { key: 'products',      label: 'Products',           icon: 'tag',       href: 'products.html',      permission: 'products.view' },
    { key: 'inventory',     label: 'Inventory',          icon: 'inventory', href: 'inventory.html',     permission: 'inventory.view', wsLabel: 'Wholesale inventory' },
    // Wholesale is no longer a separate section. For businesses with warehouses (feature multiWarehouse) the normal pages
    // become hybrids: Dashboard (wholesale desk), Wholesale inventory (warehouses + stock), Suppliers (+ payables) and
    // Reports (Wholesale tab). Selling, retail AND wholesale, is the single Sales screen (Retail | Wholesale switch).
    // Specialised screens: shown only when the business has the matching feature switched on
    // (feature = ANY of the listed flags) AND the user holds the permission.
    { key: 'batches',       label: 'Batches & expiry',   icon: 'layers',    href: 'batches.html',       permission: 'batches.view',   feature: ['batchTracking', 'expiryTracking'] },
    // Pharmacy module: appears when the business has the Dispensing feature (business type Pharmacy switches it on).
    { key: 'pharmacy',      label: 'Pharmacy desk',      icon: 'pulse',     href: 'pharmacy.html',      permission: 'pharmacy.reports', feature: ['pharmacyDispensing'] },
    { key: 'prescriptions', label: 'Prescriptions',      icon: 'clipboard', href: 'prescriptions.html', permission: 'prescriptions.view', feature: ['pharmacyDispensing'] },
    { key: 'medicines',     label: 'Medicines',          icon: 'pill',      href: 'medicines.html',     permission: 'medicines.view', feature: ['pharmacyDispensing'] },
    { key: 'patients',      label: 'Patients',           icon: 'patient',   href: 'patients.html',      permission: 'patients.view',  feature: ['pharmacyDispensing'] },
    { key: 'pharmacy-compliance', label: 'Recalls & registers', icon: 'shield', href: 'pharmacy-compliance.html', permission: 'pharmacy.reports', feature: ['pharmacyDispensing'] },
    { key: 'pharmacy-settings', label: 'Pharmacy settings', icon: 'sliders', href: 'pharmacy-settings.html', permission: 'pharmacy.settings', feature: ['pharmacyDispensing'] },
    { key: 'stocktakes', hxHide: true,    label: 'Stocktake',          icon: 'clipboard', href: 'stocktakes.html',    permission: 'stocktake.view' },
    { key: 'serials',       label: 'Serial numbers',     icon: 'hash',      href: 'serials.html',       permission: 'serials.view',   feature: ['serialNumberTracking'] },
    { key: 'warranty',      label: 'Warranty claims',    icon: 'shield',    href: 'warranty.html',      permission: 'warranty.view',  feature: ['warrantyManagement'] },
    { key: 'repairs',       label: 'Repairs',            icon: 'wrench',    href: 'repairs.html',       permission: 'repairs.view',   feature: ['repairManagement'] },
    { key: 'vehicles',      label: 'Vehicles',           icon: 'car',       href: 'vehicles.html',      permission: 'vehicles.view',  feature: ['vehicleManagement'] },
    { key: 'jobcards',      label: 'Job cards',          icon: 'clipboard', href: 'job-cards.html',     permission: 'jobcards.view',  feature: ['jobCards'] },

    { key: 'suppliers',     label: 'Suppliers',          icon: 'truck',     href: 'suppliers.html',     permission: 'suppliers.view' },
    { key: 'purchases',     label: 'Purchases',          icon: 'bag',       href: 'purchases.html',     permission: 'purchases.view' },
    { key: 'expenses',      label: 'Expenses',           icon: 'wallet',    href: 'expenses.html',      permission: 'expenses.view' },
    { key: 'refunds', hxHide: true,       label: 'Refunds',            icon: 'refund',    href: 'refunds.html',       permission: 'refunds.view' },

    { key: 'reports',       label: 'Reports',            icon: 'reports',   href: 'reports.html',       permission: 'reports.view' },
    { key: 'audit',         label: 'Audit log',          icon: 'audit',     href: 'audit-logs.html',    permission: 'audit.view' },
    { key: 'cash',          label: 'Registers & Shifts', icon: 'cash',      href: 'cash-register.html', permission: 'registers.view' },
    { key: 'offline', hxHide: true,       label: 'Offline review',     icon: 'wifiOff',     href: 'offline-review.html', permission: 'offline.review' },

    { key: 'branches',      label: 'Branches',           icon: 'building',     href: 'branches.html',      permission: 'branches.view' },
    { key: 'employees',     label: 'Employees',          icon: 'employees', href: 'employees.html',     permission: 'employees.view' },
    { key: 'customers',     label: 'Customers',          icon: 'contact',      href: 'customers.html',     permission: 'customers.view' },
    { key: 'crm',           label: 'CRM',                icon: 'crm', href: 'crm.html',           permission: 'reports.view' },
    { key: 'sms',           label: 'SMS & Alerts',       icon: 'message',    href: 'sms.html',           permission: 'reports.view' },
    { key: 'tickets',       label: 'Tickets',            icon: 'ticket',    href: 'tickets.html',       permission: 'tickets.view' },
    { key: 'notifications', label: 'Notifications',      icon: 'bell',      href: 'notifications.html', permission: 'notifications.view' },
   
    { key: 'billing',       label: 'Billing',            icon: 'card',    href: 'billing.html',       permission: 'billing.view' },
    { key: 'settings',      label: 'Settings',           icon: 'settings',  href: 'settings.html',      permission: 'settings.view' },
  ];

  // Items shown in the mobile bottom nav (kept short - 5 max is the mobile UX norm).
  const BOTTOM_NAV_KEYS = ['dashboard', 'products', 'inventory', 'branches', 'employees'];

  function requireAuthOrRedirect() {
    if (!window.Storage.isAuthenticated()) {
      window.location.href = 'login.html';
      return false;
    }
    return true;
  }

  function getUser() {
    return window.Storage.getUser();
  }

  /* ------------------------------------------------------------------ *
   * Branch switcher - inventory, and later sales/reports, are scoped to
   * a single branch at a time. This loads the business's branches once,
   * renders a dropdown in the topbar, and broadcasts a "branchchange"
   * window event so whichever page is open can refetch its data.
   *
   * IMPORTANT: getActiveBranchId() must be resolvable SYNCHRONOUSLY and
   * WITHOUT any network call, straight from data we already have at login
   * (user.branchIds). Pages like sales.js call this immediately on init,
   * before the branch-list fetch below has any chance to finish, and for
   * roles without branches.view permission (e.g. CASHIER) that fetch never
   * succeeds at all. If resolving the active branch depended on that
   * fetch, those pages would keep sending branchId: null. So this is
   * split into two independent concerns:
   *   1. Knowing which branch id is active - local, synchronous, always
   *      works as long as the user has at least one branchId.
   *   2. Rendering the switcher dropdown with branch names - needs the
   *      /branches list, requires permission, fails gracefully by just
   *      not showing a switcher.
   *
   * getActiveBranchName() follows the same rule: it never makes a request.
   * It answers from the /branches cache when that loaded, or from branch
   * objects already on the logged-in user (if the login response populated
   * them), and returns '' when the name is not known. Pages that show the
   * name listen with onBranchesLoaded() so they can fill it in once the
   * list arrives.
   * ------------------------------------------------------------------ */
  let branchesCache = null;

  function getActiveBranchId() {
    let id = window.Storage.getActiveBranchId();
    if (!id) {
      const user = getUser();
      const first = (user?.branchIds || [])[0];
      id = (first && typeof first === 'object' ? first._id || first.id : first) || null;
      if (id) window.Storage.setActiveBranchId(id);
    }
    return id || null;
  }

  /** Name of the active branch, or '' when it is not known (yet). Never makes a network call. */
  function getActiveBranchName() {
    const id = getActiveBranchId();
    if (!id) return '';

    const cached = branchesCache?.find((b) => b._id === id);
    if (cached?.name) return cached.name;

    // Some login responses already carry populated branch objects.
    const user = getUser();
    const pools = [user?.branches, user?.branchIds, user?.branch];
    for (const pool of pools) {
      const list = Array.isArray(pool) ? pool : pool ? [pool] : [];
      const hit = list.find((b) => b && typeof b === 'object' && (b._id === id || b.id === id));
      if (hit?.name) return hit.name;
    }
    return '';
  }

  async function loadBranchSwitcher() {
    const wrap = document.getElementById('branch-switcher-wrap');
    if (!wrap) return;

    // Resolve the active id locally first - this must not depend on the
    // /branches fetch below succeeding (see note above).
    const activeId = getActiveBranchId();
    if (!activeId) {
      wrap.innerHTML = '';
      return;
    }

    try {
      if (!branchesCache) {
        const { data } = await window.Api.get('/branches', { page: 1, limit: 100, status: 'active' });
        branchesCache = data.items;
      }
    } catch {
      // Likely a role without branches.view (e.g. CASHIER). That's fine -
      // the active branch id is already set above; we just don't have
      // names to render a dropdown with, so skip it silently.
      wrap.innerHTML = '';
      window.dispatchEvent(new CustomEvent('branchesloaded'));
      return;
    }

    if (!branchesCache.length) {
      wrap.innerHTML = '';
      window.dispatchEvent(new CustomEvent('branchesloaded'));
      return;
    }

    // If the previously-stored active id isn't in the fetched list
    // (e.g. stale/inactive branch), fall back to one the user actually
    // has access to.
    let resolvedId = activeId;
    if (!branchesCache.some((b) => b._id === resolvedId)) {
      const user = getUser();
      const ownIds = (user?.branchIds || []).map((b) => (b && typeof b === 'object' ? b._id || b.id : b));
      resolvedId = ownIds.find((id) => branchesCache.some((b) => b._id === id)) || branchesCache[0]._id;
      window.Storage.setActiveBranchId(resolvedId);
    }

    renderBranchSwitcher(wrap, resolvedId);
    window.dispatchEvent(new CustomEvent('branchesloaded'));
  }

  function renderBranchSwitcher(wrap, activeId) {
    const active = branchesCache.find((b) => b._id === activeId);
    wrap.innerHTML = `
      <button class="branch-switcher" id="branch-switcher-btn" type="button">
        ${window.Icons.get('store')}
        <span>${window.UI.escapeHtml(active?.name || 'Select branch')}</span>
        ${branchesCache.length > 1 ? window.Icons.get('chevronDown') : ''}
      </button>
    `;

    if (branchesCache.length <= 1) return; // nothing to switch to

    wrap.querySelector('#branch-switcher-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      wrap.querySelectorAll('.dropdown-menu').forEach((m) => m.remove());

      const menu = document.createElement('div');
      menu.className = 'dropdown-menu';
      menu.innerHTML = branchesCache.map((b) => `
        <button data-branch-id="${b._id}">${b._id === activeId ? window.Icons.get('check') : '<span style="width:18px;display:inline-block"></span>'} ${window.UI.escapeHtml(b.name)}</button>
      `).join('');
      wrap.appendChild(menu);

      menu.querySelectorAll('button').forEach((btn) => {
        btn.addEventListener('click', () => {
          const id = btn.dataset.branchId;
          window.Storage.setActiveBranchId(id);
          renderBranchSwitcher(wrap, id);
          window.dispatchEvent(new CustomEvent('branchchange', { detail: { branchId: id } }));
        });
      });

      const closeOnOutsideClick = (evt) => {
        if (!menu.contains(evt.target)) {
          menu.remove();
          document.removeEventListener('click', closeOnOutsideClick);
        }
      };
      setTimeout(() => document.addEventListener('click', closeOnOutsideClick), 0);
    });
  }

  /** Registers a callback for branch-switch events; returns an unsubscribe function. */
  function onBranchChange(callback) {
    const handler = (e) => callback(e.detail.branchId);
    window.addEventListener('branchchange', handler);
    return () => window.removeEventListener('branchchange', handler);
  }

  /** Registers a callback for when the branch list (and so branch names) finished loading; returns an unsubscribe function. */
  function onBranchesLoaded(callback) {
    const handler = () => callback();
    window.addEventListener('branchesloaded', handler);
    return () => window.removeEventListener('branchesloaded', handler);
  }

  /* ------------------------------------------------------------------ *
   * BUSINESS PROFILE (type + feature flags) - drives menu personalisation.
   * Every role may read GET /business/profile (a cashier cannot read /business).
   * The last answer is cached in localStorage so the menu is right on first paint; a fresh copy is
   * fetched on every page and, if it differs, the menu is redrawn.
   * Until a profile has ever loaded (e.g. first offline start) NO specialised item is hidden by
   * mistake: items without a feature flag always show, feature-gated ones stay hidden.
   * ------------------------------------------------------------------ */
  const PROFILE_KEY = 'pos.businessProfile';
  const SETUP_KEY = 'pos.setupProgress';
  let profile = readCachedProfile();
  let profilePromise = null;

  function readCachedProfile() {
    try {
      const p = JSON.parse(localStorage.getItem(PROFILE_KEY) || 'null');
      const u = window.Storage.getUser();
      return p && u && String(p.userId) === String(u._id || u.id) ? p : null;
    } catch { return null; }
  }

  function getBusinessProfile() { return profile; }
  function hasFeature(...keys) {
    if (!profile || !profile.featureSettings) return false;
    return keys.some((k) => profile.featureSettings[k] === true);
  }

  function loadBusinessProfile({ force = false } = {}) {
    if (profilePromise && !force) return profilePromise;
    profilePromise = (async () => {
      try {
        const { data } = await window.Api.get('/business/profile');
        const u = window.Storage.getUser();
        const next = { ...data.profile, userId: u && (u._id || u.id) };
        const changed = JSON.stringify(profile && { ...profile, fetchedAt: 0 }) !== JSON.stringify({ ...next, fetchedAt: 0 });
        profile = next;
        try { localStorage.setItem(PROFILE_KEY, JSON.stringify(next)); } catch { /* storage blocked */ }
        if (changed) { rebuildSidebarNav(); window.dispatchEvent(new CustomEvent('businessprofilechange', { detail: next })); }
      } catch { /* offline or no access: keep the cached copy */ }
      return profile;
    })();
    return profilePromise;
  }

  function whenProfileReady() { return profile ? Promise.resolve(profile) : loadBusinessProfile(); } // cached copy is used at once; mount() already refreshes it in the background

  /** Re-fetch after the owner changes type/features (settings, picker). */
  function refreshBusinessProfile() { return loadBusinessProfile({ force: true }); }

  function onProfileChange(cb) {
    const h = (e) => cb(e.detail);
    window.addEventListener('businessprofilechange', h);
    return () => window.removeEventListener('businessprofilechange', h);
  }

  /** Sidebar label: pharmacies see "Sales history"; wholesale businesses see the hybrid names (e.g. "Wholesale inventory"). */
  function labelFor(item) {
    if (item.phLabel && hasFeature('pharmacyDispensing')) return item.phLabel;
    return item.wsLabel && hasFeature('multiWarehouse') ? item.wsLabel : item.label;
  }

  /** Which sidebar link is lit. The pharmacy till links share one page (sales.html), so the URL / desk mode decides. */
  function isActiveItem(item, activePage) {
    if (activePage === 'sales' && hasFeature('pharmacyDispensing')) {
      let q = null; try { q = new URLSearchParams(window.location.search); } catch { q = null; }
      const history = !!q && q.get('view') === 'history';
      const desk = (window.PharmacyDesk && window.PharmacyDesk.mode && window.PharmacyDesk.mode()) || (q && q.get('desk')) || 'otc';
      if (item.key === 'sales') return history;
      if (item.key === 'dispense-rx') return !history && desk === 'rx';
      if (item.key === 'dispense-otc') return !history && desk !== 'rx';
      return false;
    }
    return item.key === activePage;
  }

  function itemVisibleForBusiness(item) {
    if (!item.feature) return true;
    return hasFeature(...item.feature);
  }

  function setupBadgeHtml() {
    try {
      const p = JSON.parse(localStorage.getItem(SETUP_KEY) || 'null');
      if (!p || !p.total || p.done >= p.total) return '';
      return `<span class="nav-badge" title="Setup guide progress">${p.done}/${p.total}</span>`;
    } catch { return ''; }
  }

  /** Called by the setup guide / dashboard so the sidebar can show "3/9". */
  function setSetupProgress(done, total) {
    try { localStorage.setItem(SETUP_KEY, JSON.stringify({ done, total })); } catch { /* ignore */ }
    const link = document.querySelector('.sidebar-link[data-nav-key="onboarding"]');
    if (link) { link.querySelector('.nav-badge')?.remove(); link.insertAdjacentHTML('beforeend', setupBadgeHtml()); }
  }

  function rebuildSidebarNav() {
    const nav = document.querySelector('#sidebar .sidebar-nav');
    if (!nav) return;
    const active = document.body.dataset.page || '';
    nav.innerHTML = `<div class="sidebar-section-label">Menu</div>${buildSidebarNav(active)}`;
    window.Permissions.applyPermissionGates(nav, getUser());
    const bn = document.querySelector('.bottom-nav');
    if (bn) {
      bn.innerHTML = buildBottomNav(active);
      bn.querySelectorAll('.bottom-nav-item').forEach((btn) => btn.addEventListener('click', () => { if (btn.dataset.href) window.location.href = btn.dataset.href; }));
    }
    nav.querySelectorAll('.sidebar-link').forEach((a) => {
      if (!a.title) a.title = a.textContent.replace(/\s+/g, ' ').trim();
      a.addEventListener('click', () => {
        document.getElementById('sidebar')?.classList.remove('open');
        document.getElementById('sidebar-overlay')?.classList.remove('visible');
      });
    });
  }

  /** Restaurant / accommodation business: the menu is built around the floor, kitchen and front desk. */
  function isHospitality() {
    if (!profile) return false;
    const f = profile.featureSettings || {};
    return profile.businessType === 'restaurant' || f.restaurantOrdering === true || f.accommodation === true;
  }

  function itemAllowed(item, user) {
    if (!itemVisibleForBusiness(item)) return false;
    if (item.ownerOnly && user?.role !== 'OWNER') return false;
    if (item.hxHide && isHospitality()) return false;
    if (item.permAny && !item.permAny.some((p) => window.Permissions.can(user, p))) return false;
    return true;
  }

  function hrefFor(item) {
    if (item.key === 'dashboard' && isHospitality()) return 'hx-dashboard.html';
    if (item.phHref && hasFeature('pharmacyDispensing')) return item.phHref;
    return item.href;
  }

  function buildSidebarNav(activePage) {
    const user = getUser();
    const hx = isHospitality();
    let lastGroup = null;
    return NAV_ITEMS.filter((i) => itemAllowed(i, user) && !(hx === false && i.group)).map((item) => {
      const gated = item.permission ? `data-requires-permission="${item.permission}"` : '';
      const activeClass = isActiveItem(item, activePage) ? 'active' : '';
      const disabled = item.disabled;
      let label = '';
      if (hx) {
        const g = item.key === 'dashboard' ? '' : (item.group || 'Business');
        if (g !== lastGroup) { if (g) label = `<div class="sidebar-section-label">${g}</div>`; lastGroup = g; }
      }
      return `${label}
        <a class="sidebar-link ${activeClass}" ${gated} data-nav-key="${item.key}"
           href="${disabled ? '#' : hrefFor(item)}"
           title="${disabled ? 'Coming soon' : labelFor(item)}"
           ${disabled ? 'style="opacity:.45;pointer-events:none"' : ''}>
          <span class="icon">${window.Icons.get(item.icon)}</span>
          <span>${labelFor(item)}</span>
          ${item.badge === 'setup' ? setupBadgeHtml() : ''}
        </a>`;
    }).join('');
  }

  function bottomNavKeys() {
    if (!isHospitality()) return BOTTOM_NAV_KEYS;
    const user = getUser();
    const want = ['dashboard', 'hx-floor', 'hx-kitchen', 'hx-desk', 'hx-rooms', 'hx-bills', 'hx-stays', 'hx-housekeeping', 'hx-delivery', 'hx-guest', 'employees'];
    return want.filter((k) => { const it = NAV_ITEMS.find((n) => n.key === k); return it && itemAllowed(it, user) && (!it.permission || window.Permissions.can(user, it.permission)); }).slice(0, 5);
  }

  function buildBottomNav(activePage) {
    const keys = bottomNavKeys();
    return keys.map((k) => NAV_ITEMS.find((n) => n.key === k)).filter(Boolean).map((item) => `
      <button class="bottom-nav-item ${item.key === activePage ? 'active' : ''}"
              data-href="${item.disabled ? '' : hrefFor(item)}"
              ${item.disabled ? 'style="opacity:.45"' : ''}>
        <span class="icon">${window.Icons.get(item.icon)}</span>
        <span>${labelFor(item)}</span>
      </button>
    `).join('');
  }

  function shellTemplate(user, title, activePage) {
    return `
      <div class="sidebar-overlay" id="sidebar-overlay"></div>
      <aside class="sidebar" id="sidebar">
        <div class="sidebar-brand">
          <span class="logo-mark">${window.Icons.get('store')}</span>
          <span>${window.UI.escapeHtml(APP_NAME)}</span>
        </div>
        <nav class="sidebar-nav">
          <div class="sidebar-section-label">Menu</div>
          ${buildSidebarNav(activePage)}
        </nav>
        <div class="sidebar-footer">
          <div class="sidebar-user">
            <div class="avatar">${window.UI.initials(user?.name)}</div>
            <div class="sidebar-user-info">
              <div class="name">${window.UI.escapeHtml(user?.name || '')}</div>
              <div class="role">${window.UI.escapeHtml(user?.role || '')}</div>
            </div>
          </div>
        </div>
      </aside>

      <div class="main-area">
        <header class="topbar">
          <div class="topbar-left">
            <button class="menu-btn desktop-hidden" id="sidebar-toggle" aria-label="Open menu">${window.Icons.get('menu')}</button>
            <div class="topbar-title">${window.UI.escapeHtml(title)}</div>
          </div>
          <div class="topbar-right">
            <span id="lang-switch-wrap"></span>
            <span id="country-flag"></span>
            <div class="dropdown" id="drawer-chip-wrap"></div>
            <div class="dropdown" id="branch-switcher-wrap"></div>
            <div class="dropdown" id="notif-bell-wrap"></div>
            <button class="btn btn-ghost btn-icon" id="logout-btn" title="Log out">${window.Icons.get('logout')}</button>
          </div>
        </header>
        <main class="page-content" id="page-content"></main>
      </div>

      <nav class="bottom-nav">${buildBottomNav(activePage)}</nav>
    `;
  }

  async function handleLogout() {
    // A cash drawer that is still open must be closed first.
    if (window.CashDrawer?.isLocked()) {
      window.UI.toast.error('Close the cash drawer before logging out.');
      return;
    }
    if (window.Offline && window.Offline.outbox) {
      const p = window.Offline.outbox.cached();
      if (p.count > 0) { window.UI.toast.error(`${p.count} offline item(s) are still waiting to sync. Connect and let them sync before logging out.`); return; }
    }
    const ok = await window.UI.confirmDialog({
      title: 'Log out?',
      message: 'You will need to sign in again to continue.',
      confirmText: 'Log out',
      danger: true,
    });
    if (!ok) return;
    try {
      await window.Api.post('/auth/logout');
    } catch {
      // Even if the network call fails, still clear local session.
    }
    try { if (window.Offline && window.Offline.context.get()?.device?.mode === 'SHARED') await window.Offline.auth.clearUserData(); } catch { /* ignore */ }
    window.Storage.clearSession();
    window.location.href = 'login.html';
  }

  function bindShellEvents() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    const toggle = document.getElementById('sidebar-toggle');

    const openSidebar = () => { sidebar.classList.add('open'); overlay.classList.add('visible'); };
    const closeSidebar = () => { sidebar.classList.remove('open'); overlay.classList.remove('visible'); };

    toggle?.addEventListener('click', openSidebar);
    overlay?.addEventListener('click', closeSidebar);
    sidebar.querySelectorAll('.sidebar-link').forEach((link) => link.addEventListener('click', closeSidebar));

    document.getElementById('logout-btn')?.addEventListener('click', handleLogout);

    document.querySelectorAll('.bottom-nav-item').forEach((btn) => {
      btn.addEventListener('click', () => {
        const href = btn.dataset.href;
        if (href) window.location.href = href;
      });
    });
  }

  /**
   * Guided tours (first-visit walkthrough + ? help button).
   * Injected once per page, after the shell exists. Wrapped so a missing or
   * broken tour file can never affect the app itself.
   */
  function loadTour() {
    try {
      if (window.Tour || document.getElementById('tour-script')) return;
      const s = document.createElement('script');
      s.id = 'tour-script';
      s.src = 'js/core/tour.js';
      s.async = true;
      s.onerror = () => console.warn('Tour: js/core/tour.js could not be loaded');
      document.head.appendChild(s);
    } catch (err) {
      console.warn('Tour: not loaded', err);
    }
  }

  /**
   * Platform announcements (pop-up / scrolling ticker set by the super admin).
   * Same pattern as loadTour: injected once per page, and wrapped so a missing
   * or broken file can never affect the app. announcements.js starts itself once
   * it loads (AppShell is already defined by then) and fetches only what is
   * targeted at this user's role and this page (<body data-page>).
   */
  function loadAnnouncements() {
    try {
      if (window.Announcements || document.getElementById('announcements-script')) return;
      const s = document.createElement('script');
      s.id = 'announcements-script';
      s.src = 'js/core/announcements.js';
      s.async = true;
      s.onerror = () => console.warn('Announcements: js/core/announcements.js could not be loaded');
      document.head.appendChild(s);
    } catch (err) {
      console.warn('Announcements: not loaded', err);
    }
  }

  /** Country flag badge + one-time "choose your country" window for older accounts (js/core/country-flag.js). */
  function loadCountryFlag(user) {
    try {
      // Language switcher first (every user, including super admin pages that use this shell): the person's own language.
      if (window.I18n) { window.I18n.ready.then(() => window.I18n.mountSwitcher(document.getElementById('lang-switch-wrap'))); }
      if (!document.getElementById('country-flag-css')) { // styles the language switcher too, so load it for everyone
        const l = document.createElement('link');
        l.id = 'country-flag-css'; l.rel = 'stylesheet'; l.href = 'css/country-flag.css';
        document.head.appendChild(l);
      }
      if (user && user.role === 'SUPER_ADMIN') return;
      if (window.PosMoney || document.getElementById('country-flag-script')) return;
      const s = document.createElement('script');
      s.id = 'country-flag-script';
      s.src = 'js/core/country-flag.js';
      s.async = true;
      s.onerror = () => console.warn('Country flag: js/core/country-flag.js could not be loaded');
      document.head.appendChild(s);
    } catch { /* never block the page */ }
  }

  /** Billing banner (locked / overdue / trial). Same pattern as loadTour/loadAnnouncements. */
  function loadBillingBanner() {
    try {
      if (window.BillingBanner || document.getElementById('billing-banner-script')) return;
      const s = document.createElement('script');
      s.id = 'billing-banner-script';
      s.src = 'js/core/billing-banner.js';
      s.async = true;
      s.onerror = () => console.warn('Billing banner: js/core/billing-banner.js could not be loaded');
      document.head.appendChild(s);
    } catch (err) {
      console.warn('Billing banner: not loaded', err);
    }
  }

  /* ------------------------------------------------------------------ *
   * Cash drawer: lazy-loaded once per page (js/core/cash-drawer.js).
   * whenCashDrawerReady() resolves with window.CashDrawer (after it has reconnected to
   * the printer and restored any unfinished "close the drawer" lock) - or null when the
   * file could not be loaded, so the POS keeps working without it.
   * ------------------------------------------------------------------ */
  let cashDrawerPromise = null;

  function loadCashDrawer() {
    if (cashDrawerPromise) return cashDrawerPromise;
    cashDrawerPromise = new Promise((resolve) => {
      const done = () => {
        const cd = window.CashDrawer || null;
        if (!cd) { resolve(null); return; }
        Promise.resolve(cd.ready).then(() => resolve(cd), () => resolve(cd));
      };
      if (window.CashDrawer) { done(); return; }
      try {
        const s = document.createElement('script');
        s.id = 'cash-drawer-script';
        s.src = 'js/core/cash-drawer.js';
        s.async = true;
        s.onload = done;
        s.onerror = () => { console.warn('Cash drawer: js/core/cash-drawer.js could not be loaded'); resolve(null); };
        document.head.appendChild(s);
      } catch (err) {
        console.warn('Cash drawer: not loaded', err);
        resolve(null);
      }
    });
    return cashDrawerPromise;
  }

  function whenCashDrawerReady() { return loadCashDrawer(); }

  /** Small topbar chip: Drawer ready / Drawer open / Drawer: manual. Click -> drawer settings. */
  function mountDrawerChip(drawer) {
    const wrap = document.getElementById('drawer-chip-wrap');
    if (!wrap || !drawer) return;

    const paint = () => {
      const st = drawer.status();
      const locked = drawer.isLocked();
      const tone = locked ? 'open' : st.connected ? 'ok' : 'off';
      const label = locked ? 'Drawer open' : !st.enabled ? 'No drawer' : st.connected ? 'Drawer ready' : 'Drawer: manual';
      wrap.innerHTML = `
        <button type="button" class="drawer-chip drawer-chip-${tone}" title="Cash drawer settings">
          ${window.Icons.get('cash')}<span>${label}</span>
        </button>`;
      wrap.querySelector('button').addEventListener('click', () => drawer.openSetup());
    };
    drawer.on(paint);
    paint();
  }

  /**
   * Pages opened from the Setup guide carry ?action=add (and ?from=onboarding&step=...).
   * runUrlAction('add-product-btn') clicks that page's own "Add" button once, so the owner lands
   * straight in the form. It respects permissions (hidden/disabled buttons are never clicked) and
   * removes the parameter so a refresh does not reopen the form.
   */
  function runUrlAction(buttonId) {
    try {
      const q = new URLSearchParams(window.location.search);
      if (q.get('action') !== 'add') return false;
      const btn = document.getElementById(buttonId);
      q.delete('action');
      const qs = q.toString();
      window.history.replaceState({}, '', window.location.pathname + (qs ? `?${qs}` : ''));
      if (!btn || btn.disabled || btn.classList.contains('hidden')) return false;
      setTimeout(() => btn.click(), 150);
      return true;
    } catch { return false; }
  }

  /** "Back to setup guide" bar for pages opened from the guide. */
  function mountSetupReturnBar(contentEl) {
    try {
      const q = new URLSearchParams(window.location.search);
      if (q.get('from') !== 'onboarding' || !contentEl || document.getElementById('setup-return-bar')) return;
      const bar = document.createElement('div');
      bar.id = 'setup-return-bar';
      bar.className = 'setup-return-bar';
      bar.innerHTML = `<span>${window.Icons.get('rocket')} You are following the setup guide.</span><a class="btn btn-secondary btn-sm" href="onboarding.html">Back to setup guide</a>`;
      contentEl.prepend(bar);
    } catch { /* cosmetic only */ }
  }

  /** Owner-only business-type pop-up for existing businesses (js/core/business-setup.js). */
  function loadBusinessSetup(user) {
    try {
      if (document.body.dataset.page === 'onboarding') return; // the guide handles this itself
      if (!window.Permissions.can(user, 'settings.update') || user.role === 'ADMIN') return;
      const run = () => window.BusinessSetup && window.BusinessSetup.maybePromptExisting();
      if (window.BusinessSetup) { run(); return; }
      if (document.getElementById('business-setup-script')) return;
      const s = document.createElement('script');
      s.id = 'business-setup-script';
      s.src = 'js/core/business-setup.js';
      s.async = true;
      s.onload = run;
      s.onerror = () => console.warn('Business setup: js/core/business-setup.js could not be loaded');
      const t = document.createElement('script');
      t.src = 'js/core/business-types.js';
      t.async = false;
      t.onload = () => document.head.appendChild(s);
      t.onerror = () => console.warn('Business types: js/core/business-types.js could not be loaded');
      if (window.BusinessTypes) document.head.appendChild(s); else document.head.appendChild(t);
    } catch (err) { console.warn('Business setup: not loaded', err); }
  }

  /**
   * AppShell.mount({ title })
   * Renders the shell into #app-shell, gates nav items by permission, sets the
   * browser tab title ("<page> · Six Star Pos"), and returns the #page-content
   * element for the page script to render into.
   */
  function mount({ title = '' } = {}) {
    if (!requireAuthOrRedirect()) return null;

    const user = getUser();
    const activePage = document.body.dataset.page || '';
    const root = document.getElementById('app-shell');
    if (!root) {
      console.error('AppShell.mount: #app-shell element not found on this page');
      return null;
    }

    document.title = title ? `${title} · ${APP_NAME}` : APP_NAME;

    root.innerHTML = shellTemplate(user, title, activePage);
    bindShellEvents();
    window.Permissions.applyPermissionGates(root, user);
    loadBusinessProfile();
    loadBranchSwitcher(); // async, fills in the dropdown once branches load - doesn't block the page. getActiveBranchId() itself does NOT depend on this.
    window.NotificationCenter?.mount(document.getElementById('notif-bell-wrap'), user);
    loadTour();
    loadAnnouncements();
    loadBillingBanner();
    loadCountryFlag(user);
    loadBusinessSetup(user);
    if (window.Permissions.can(user, 'sales.view')) {
      loadCashDrawer().then((drawer) => { if (drawer) mountDrawerChip(drawer); });
    }
    const contentEl = document.getElementById('page-content');
    mountSetupReturnBar(contentEl);
    return contentEl;
  }

  window.AppShell = {
    APP_NAME,
    mount,
    getUser,
    requireAuthOrRedirect,
    getActiveBranchId,
    getActiveBranchName,
    onBranchChange,
    onBranchesLoaded,
    whenCashDrawerReady,
    getBusinessProfile,
    hasFeature,
    isHospitality,
    whenProfileReady,
    refreshBusinessProfile,
    onProfileChange,
    setSetupProgress,
    runUrlAction,
  };
})(window);