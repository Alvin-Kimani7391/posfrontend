/**
 * admin-shell.js
 * Sidebar + topbar for the platform-admin pages. Mirrors app-shell.js but:
 *  - only SUPER_ADMIN users are allowed in (everyone else -> admin-login.html)
 *  - no branch switcher / permissions gating / notifications (platform scope)
 * Usage: const content = AdminShell.mount({ title: 'Businesses' });
 */
(function (window) {
  const APP_NAME = 'Kenya POS · Platform Admin';
  const NAV = [
    { key: 'dashboard', label: 'Overview', icon: 'dashboard', href: 'admin-dashboard.html' },
    { key: 'businesses', label: 'Businesses', icon: 'store', href: 'admin-businesses.html' },
    { key: 'sales', label: 'Sales', icon: 'sales', href: 'admin-sales.html' },
    { key: 'employees', label: 'Employees', icon: 'employees', href: 'admin-employees.html' },
    { key: 'products', label: 'Products', icon: 'products', href: 'admin-products.html' },
    { key: 'audit', label: 'Audit log', icon: 'settings', href: 'admin-audit.html' },
    { key: 'tickets', label: 'Tickets', icon: 'alert', href: 'admin-tickets.html' },
    { key: 'billing', label: 'Billing', icon: 'wallet', href: 'admin-billing.html' },
        { key: 'sms', label: 'SMS', icon: 'bell', href: 'admin-sms.html' },
    { key: 'announcements', label: 'Announcements', icon: 'bell', href: 'admin-announcements.html' },
  ];
  const esc = (s) => window.UI.escapeHtml(s == null ? '' : String(s));

  function guard() {
    const u = window.Storage.getUser();
    if (!window.Storage.isAuthenticated() || !u || u.role !== 'SUPER_ADMIN') {
      window.location.replace('admin-login.html');
      return false;
    }
    return true;
  }

  function template(user, title, active) {
    return `
      <div class="sidebar-overlay" id="sidebar-overlay"></div>
      <aside class="sidebar" id="sidebar">
        <div class="sidebar-brand"><span class="logo-mark">${window.Icons.get('store')}</span><span>Platform Admin</span></div>
        <nav class="sidebar-nav">
          <div class="sidebar-section-label">Oversight</div>
          ${NAV.map((n) => `<a class="sidebar-link ${n.key === active ? 'active' : ''}" href="${n.href}" title="${n.label}"><span class="icon">${window.Icons.get(n.icon)}</span><span>${n.label}</span></a>`).join('')}
        </nav>
        <div class="sidebar-footer">
          <div class="sidebar-user">
            <div class="avatar">${esc(window.UI.initials(user.name))}</div>
            <div class="sidebar-user-info"><div class="name">${esc(user.name)}</div><div class="role">Super admin</div></div>
          </div>
        </div>
      </aside>
      <div class="main-area">
        <header class="topbar">
          <div class="topbar-left">
            <button class="menu-btn desktop-hidden" id="sidebar-toggle" aria-label="Open menu">${window.Icons.get('menu')}</button>
            <div class="topbar-title">${esc(title)}</div>
          </div>
          <div class="topbar-right"><button class="btn btn-ghost btn-icon" id="logout-btn" title="Log out">${window.Icons.get('logout')}</button></div>
        </header>
        <main class="page-content" id="page-content"></main>
      </div>`;
  }

  /**
   * "Waiting on you" badge on the Tickets link.
   * (Previously this ran at script-load time, before the sidebar existed, so the
   * badge never appeared and it fired an API call even before the login guard.
   * It now runs from mount(), after the sidebar is rendered.)
   */
  function loadTicketBadge() {
    window.Api.get('/admin/tickets/stats').then(({ data }) => {
      if (!data.awaitingAdmin) return;
      const link = document.querySelector('.sidebar-link[href="admin-tickets.html"]');
      if (link && !link.querySelector('.badge')) {
        link.insertAdjacentHTML('beforeend', `<span class="badge badge-danger" style="margin-left:auto">${data.awaitingAdmin}</span>`);
      }
    }).catch(() => { /* non-fatal */ });
  }

  /** "To verify" badge on the Billing link: manual payments waiting for approval. */
function loadBillingBadge() {
  window.Api.get('/admin/billing/payments', { status: 'SUBMITTED', limit: 1 }).then(({ data }) => {
    if (!data.total) return;
    const link = document.querySelector('.sidebar-link[href="admin-billing.html"]');
    if (link && !link.querySelector('.badge')) {
      link.insertAdjacentHTML('beforeend', `<span class="badge badge-warning" style="margin-left:auto">${data.total}</span>`);
    }
  }).catch(() => { /* non-fatal */ });
}



function loadSmsBadge() {
  window.Api.get('/admin/sms/overview').then(({ data }) => {
    const n = (data.awaitingVerification || 0) + (data.applicationsToProcess || 0);
    const link = document.querySelector('.sidebar-link[href="admin-sms.html"]');
    if (n && link && !link.querySelector('.badge')) link.insertAdjacentHTML('beforeend', `<span class="badge badge-warning" style="margin-left:auto">${n}</span>`);
  }).catch(() => {});
}

  async function logout() {
    const ok = await window.UI.confirmDialog({ title: 'Log out?', message: 'You will need to sign in again.', confirmText: 'Log out', danger: true });
    if (!ok) return;
    try { await window.Api.post('/auth/logout'); } catch { /* clear locally anyway */ }
    window.Storage.clearSession();
    window.location.href = 'admin-login.html';
  }

  function mount({ title = '' } = {}) {
    if (!guard()) return null;
    const user = window.Storage.getUser();
    const root = document.getElementById('app-shell');
    document.title = `${title} · ${APP_NAME}`;
    root.innerHTML = template(user, title, document.body.dataset.page || '');
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    const open = () => { sidebar.classList.add('open'); overlay.classList.add('visible'); };
    const close = () => { sidebar.classList.remove('open'); overlay.classList.remove('visible'); };
    document.getElementById('sidebar-toggle')?.addEventListener('click', open);
    overlay.addEventListener('click', close);
    document.getElementById('logout-btn').addEventListener('click', logout);
    loadTicketBadge();loadBillingBadge();loadSmsBadge();
    return document.getElementById('page-content');
  }

  let bizCache = null;
  /** All businesses (id + name) for filter dropdowns. Backend caps limit at 100 - raise it server-side if you outgrow that. */
  async function loadBusinesses() {
    if (bizCache) return bizCache;
    try {
      const { data } = await window.Api.get('/admin/businesses', { page: 1, limit: 100 });
      bizCache = data.items || [];
    } catch { bizCache = []; }
    return bizCache;
  }

  const STATUS_BADGE = { active: 'badge-success', trialing: 'badge-info', past_due: 'badge-warning', suspended: 'badge-danger', cancelled: 'badge-neutral', closed: 'badge-neutral', inactive: 'badge-neutral' };
  const statusBadge = (s) => `<span class="badge ${STATUS_BADGE[s] || 'badge-neutral'}">${esc(String(s || '-').replace('_', ' '))}</span>`;

  window.AdminShell = { mount, loadBusinesses, statusBadge, esc };
})(window);