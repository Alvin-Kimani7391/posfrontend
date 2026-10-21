/**
 * hx-topnav.js - the pill-style module bar shown above every restaurant / accommodation page:
 *   POS | Orders | Kitchen | Reservation | Table  ...  Front desk | Rooms | Bookings | Housekeeping | Reports
 * Items appear only when the business has the module on AND the user holds the permission (same rules as the sidebar).
 */
(function () {
  const I = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  const IC = {
    pos: I('<path d="M4 7h16M6 7l1 12h10l1-12"/><path d="M9 7a3 3 0 0 1 6 0"/>'),
    orders: I('<path d="M8 6h12M8 12h12M8 18h12"/><path d="M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>'),
    kitchen: I('<path d="M12 3c1 3.5 5 5.5 5 10a5 5 0 0 1-10 0c0-2 1-3.5 2.2-4.5 0 2 1 3 2 3 0-3-1.5-5 .8-8.5z"/>'),
    resv: I('<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 3v4M16 3v4M4 10h16"/>'),
    table: I('<path d="M3 10h18M6 10l-1 9M18 10l1 9M12 10v9"/><path d="M5 10V7h14v3"/>'),
    delivery: I('<circle cx="6" cy="17" r="3"/><circle cx="18" cy="17" r="3"/><path d="M9 17h6l-3-8h-3M12 9h4"/>'),
    desk: I('<circle cx="8" cy="12" r="3.5"/><path d="M11.5 12H21M17 12v3M20 12v2"/>'),
    rooms: I('<path d="M3 19V6M3 15h18v4M21 15v-3a3 3 0 0 0-3-3h-7v6"/><circle cx="7" cy="11.5" r="1.7"/>'),
    stays: I('<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 3v4M16 3v4M4 10h16M9 15l2 2 4-4"/>'),
    broom: I('<path d="M14 3l-4 8M8 11h8l2 10H6z"/>'),
    chart: I('<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'),
  };
  const ITEMS = [
    { k: 'pos', label: 'POS', href: 'hx-floor.html', view: 'pos', icon: 'pos', perm: 'restaurant.orders.view', feat: ['restaurantOrdering'] },
    { k: 'orders', label: 'Orders', href: 'hx-orders.html', icon: 'orders', perm: 'restaurant.orders.view', feat: ['restaurantOrdering'] },
    { k: 'kitchen', label: 'Kitchen', href: 'hx-kitchen.html', icon: 'kitchen', perm: 'restaurant.kitchen.view', feat: ['restaurantOrdering'] },
    { k: 'resv', label: 'Reservation', href: 'hx-reservations.html', icon: 'resv', perm: 'restaurant.reservations.view', feat: ['reservations'] },
    { k: 'table', label: 'Table', href: 'hx-floor.html?view=table', view: 'table', icon: 'table', perm: 'restaurant.orders.view', feat: ['restaurantOrdering'] },
    { k: 'delivery', label: 'Delivery', href: 'hx-delivery.html', icon: 'delivery', permAny: ['restaurant.delivery.view', 'restaurant.delivery.self'], feat: ['restaurantOrdering'] },
    { sep: true, feat: ['accommodation'] },
    { k: 'desk', label: 'Front desk', href: 'hx-desk.html', icon: 'desk', perm: 'accommodation.stays.view', feat: ['accommodation'] },
    { k: 'rooms', label: 'Rooms', href: 'hx-rooms.html', icon: 'rooms', perm: 'accommodation.rooms.view', feat: ['accommodation'] },
    { k: 'stays', label: 'Bookings', href: 'hx-stays.html', icon: 'stays', perm: 'accommodation.stays.view', feat: ['accommodation'] },
    { k: 'hk', label: 'Housekeeping', href: 'hx-housekeeping.html', icon: 'broom', perm: 'accommodation.housekeeping.view', feat: ['accommodation'] },
    { sep: true },
    { k: 'reports', label: 'Reports', href: 'hx-reports.html', icon: 'chart', permAny: ['restaurant.reports.view', 'accommodation.reports.view'], feat: ['restaurantOrdering', 'accommodation'] },
  ];
  const file = () => (location.pathname.split('/').pop() || '').replace(/\.html$/, '') + '.html';
  const view = () => new URLSearchParams(location.search).get('view') || 'pos';
  function active(it) {
    const f = it.href.split('?')[0];
    if (f !== file()) return false;
    return it.view ? it.view === view() : true;
  }
  function ok(it) {
    const H = window.HX || {};
    if (it.feat && H.feature && !it.feat.some((f) => H.feature(f))) return false;
    if (it.perm && H.can && !H.can(it.perm)) return false;
    if (it.permAny && H.canAny && !H.canAny(...it.permAny)) return false;
    return true;
  }
  function build() {
    const host = document.getElementById('page-content'); if (!host || document.querySelector('.dr-topnav')) return !!document.querySelector('.dr-topnav');
    const vis = []; ITEMS.forEach((it) => { if (it.sep) { if (it.feat && !ok(it)) return; if (vis.length && !vis[vis.length - 1].sep) vis.push(it); } else if (ok(it)) vis.push(it); });
    while (vis.length && vis[vis.length - 1].sep) vis.pop();
    if (!vis.length) return true;
    const nav = document.createElement('div'); nav.className = 'dr-topnav';
    nav.innerHTML = `<nav class="dr-nav" aria-label="Modules">${vis.map((it) => it.sep ? '<span class="sep"></span>' : `<a href="${it.href}" class="${active(it) ? 'on' : ''}">${IC[it.icon] || ''}<span>${it.label}</span></a>`).join('')}</nav><span class="dr-clock" id="dr-clock"></span>`;
    host.parentNode.insertBefore(nav, host);
    const tick = () => { const c = document.getElementById('dr-clock'); if (c) c.textContent = new Date().toLocaleString('en-KE', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); };
    tick(); setInterval(tick, 30000);
    return true;
  }
  async function init() {
    try { await window.AppShell?.whenProfileReady?.(); } catch (e) { /* ignore */ }
    let n = 0; const t = setInterval(() => { if (build() || ++n > 40) clearInterval(t); }, 150);
  }
  document.addEventListener('DOMContentLoaded', init);
})();
