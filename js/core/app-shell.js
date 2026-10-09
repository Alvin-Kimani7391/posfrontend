/**
 * app-shell.js
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
 */
(function (window) {
  const APP_NAME = 'Six Star Pos';

  const NAV_ITEMS = [
    { key: 'dashboard',     label: 'Dashboard',          icon: 'dashboard', href: 'dashboard.html' },
    { key: 'sales',         label: 'Sales',              icon: 'sales',     href: 'sales.html',         permission: 'sales.view' },
    { key: 'products',      label: 'Products',           icon: 'tag',       href: 'products.html',      permission: 'products.view' },
    { key: 'inventory',     label: 'Inventory',          icon: 'inventory', href: 'inventory.html',     permission: 'inventory.view' },

    { key: 'suppliers',     label: 'Suppliers',          icon: 'truck',     href: 'suppliers.html',     permission: 'suppliers.view' },
    { key: 'purchases',     label: 'Purchases',          icon: 'bag',       href: 'purchases.html',     permission: 'purchases.view' },
    { key: 'expenses',      label: 'Expenses',           icon: 'wallet',    href: 'expenses.html',      permission: 'expenses.view' },
    { key: 'refunds',       label: 'Refunds',            icon: 'refund',    href: 'refunds.html',       permission: 'refunds.view' },

    { key: 'reports',       label: 'Reports',            icon: 'reports',   href: 'reports.html',       permission: 'reports.view' },
    { key: 'audit',         label: 'Audit log',          icon: 'audit',     href: 'audit-logs.html',    permission: 'audit.view' },
    { key: 'cash',          label: 'Registers & Shifts', icon: 'cash',      href: 'cash-register.html', permission: 'registers.view' },

    { key: 'branches',      label: 'Branches',           icon: 'store',     href: 'branches.html',      permission: 'branches.view' },
    { key: 'employees',     label: 'Employees',          icon: 'employees', href: 'employees.html',     permission: 'employees.view' },
    { key: 'customers',     label: 'Customers',          icon: 'user',      href: 'customers.html',     permission: 'customers.view' },
    { key: 'crm', label: 'CRM', icon: 'employees', href: 'crm.html', permission: 'reports.view' },
        { key: 'sms', label: 'SMS', icon: 'ticket', href: 'sms.html', permission: 'reports.view' },
    { key: 'tickets',       label: 'Tickets',            icon: 'ticket',    href: 'tickets.html',       permission: 'tickets.view' },
    { key: 'notifications', label: 'Notifications',      icon: 'bell',      href: 'notifications.html', permission: 'notifications.view' },
    { key: 'billing', label: 'Billing', icon: 'wallet', href: 'billing.html', permission: 'billing.view' },
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

  function buildSidebarNav(activePage) {
    return NAV_ITEMS.map((item) => {
      const gated = item.permission ? `data-requires-permission="${item.permission}"` : '';
      const activeClass = item.key === activePage ? 'active' : '';
      const disabled = item.disabled;
      return `
        <a class="sidebar-link ${activeClass}" ${gated}
           href="${disabled ? '#' : item.href}"
           title="${disabled ? 'Coming soon' : item.label}"
           ${disabled ? 'style="opacity:.45;pointer-events:none"' : ''}>
          <span class="icon">${window.Icons.get(item.icon)}</span>
          <span>${item.label}</span>
        </a>`;
    }).join('');
  }

  function buildBottomNav(activePage) {
    return NAV_ITEMS.filter((i) => BOTTOM_NAV_KEYS.includes(i.key)).map((item) => `
      <button class="bottom-nav-item ${item.key === activePage ? 'active' : ''}"
              data-href="${item.disabled ? '' : item.href}"
              ${item.disabled ? 'style="opacity:.45"' : ''}>
        <span class="icon">${window.Icons.get(item.icon)}</span>
        <span>${item.label}</span>
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
    loadBranchSwitcher(); // async, fills in the dropdown once branches load - doesn't block the page. getActiveBranchId() itself does NOT depend on this.
    window.NotificationCenter?.mount(document.getElementById('notif-bell-wrap'), user);
    loadTour();
    loadAnnouncements();
    loadBillingBanner();
    return document.getElementById('page-content');
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
  };
})(window);