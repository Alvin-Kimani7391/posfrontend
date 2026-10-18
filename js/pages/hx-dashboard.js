/**
 * hx-dashboard.js - home screen for restaurant / accommodation businesses.
 * Shows today's numbers for whatever is switched on, and big shortcuts to the screens this person's role uses.
 * Data: GET /restaurant/reports/dashboard, GET /accommodation/desk, plus setup progress from hx-setup.
 */
(function () {
  const { E, M, can, canAny, feature, get, pill, head, icon } = window.HX;
  let el, stop;

  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    el = window.HX.mount('Overview');
    if (!el) return;
    el.innerHTML = '<div class="hx-card"><p class="hx-sub">Loading your day…</p></div>';
    await window.AppShell.whenProfileReady?.();
    stop = window.HX.live(render, 30000);
    render();
  }

  const TABLE_TONE = { AVAILABLE: 'ok', OCCUPIED: 'busy', RESERVED: 'plan', NEEDS_CLEANING: 'warn', BILL_REQUESTED: 'warn', OUT_OF_SERVICE: 'mute' };

  function kpi(label, value, sub) {
    return `<div class="hx-card"><small class="hx-sub">${E(label)}</small><div class="hx-money" style="font-size:var(--text-2xl);margin-top:4px">${value}</div>${sub ? `<small class="hx-sub">${sub}</small>` : ''}</div>`;
  }

  async function render() {
    const food = feature('restaurantOrdering') && can('restaurant.reports.view');
    const rooms = feature('accommodation') && can('accommodation.stays.view');
    const q = { branchId: window.HX.branchId() };
    const [rd, ad] = await Promise.all([food ? get('/restaurant/reports/dashboard', q) : null, rooms ? get('/accommodation/desk', q) : null]);
    const d = rd && (rd.dashboard || rd);
    const u = window.HX.user();
    const name = (u && (u.name || u.fullName) || '').split(' ')[0];

    let h = window.HX.head(`${greeting()}${name ? ', ' + name : ''}`, new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' }),
      `<span class="hx-live">Live</span>`);

    h += shortcuts();

    if (d) {
      const t = d.tables || {}, total = Object.values(t).reduce((a, b) => a + b, 0);
      h += `<div class="hx-section"><h2>Restaurant today</h2>
        <div class="hx-grid2" style="grid-template-columns:repeat(auto-fit,minmax(170px,1fr))">
          ${kpi('Sales', M(d.today && d.today.revenue), `${(d.today && d.today.orders) || 0} orders`)}
          ${kpi('Average order', M(d.today && d.today.averageOrderValue))}
          ${kpi('Open orders', d.openOrders ?? 0, 'being served now')}
          ${kpi('In the kitchen', d.kitchenQueue ?? 0, 'tickets waiting')}
          ${d.today && d.today.foodCostPercent != null ? kpi('Food cost', d.today.foodCostPercent + '%') : ''}
        </div>
        ${total ? `<div class="hx-card" style="margin-top:var(--space-3)"><h3>Tables <small class="hx-sub">${total} in service</small></h3>
          <div style="display:flex;gap:var(--space-2);flex-wrap:wrap;margin-top:var(--space-2)">${Object.entries(t).map(([k, n]) => `<span>${pill(k, TABLE_TONE[k])} <b>${n}</b></span>`).join('')}</div></div>` : ''}
      </div>`;
    }

    if (ad) {
      h += `<div class="hx-section"><h2>Rooms today</h2>
        <div class="hx-grid2" style="grid-template-columns:repeat(auto-fit,minmax(170px,1fr))">
          ${kpi('Occupancy', (ad.occupancyPercent ?? 0) + '%', `${ad.occupied ?? 0} of ${ad.rooms ?? 0} rooms`)}
          ${kpi('Arriving', (ad.arrivals || []).length, 'checking in today')}
          ${kpi('Leaving', (ad.departures || []).length, 'checking out today')}
          ${kpi('Out of order', ad.outOfOrder ?? 0)}
        </div>
        ${alertsHtml(ad)}
      </div>`;
    }

    if (!d && !ad && !shortcutsList().length) {
      h += window.UI.emptyStateHtml({ icon: 'store', title: 'Nothing to show yet', message: 'Your role has no restaurant or room screens switched on. Ask the owner to check your permissions.' });
    }
    el.innerHTML = h;
  }

  function alertsHtml(ad) {
    const rows = [];
    (ad.overdueCheckouts || []).forEach((s) => rows.push(['bad', `Room ${s.roomNumber}: check-out overdue`, s.guest && s.guest.name]));
    (ad.possibleNoShows || []).forEach((s) => rows.push(['warn', `${(s.guest && s.guest.name) || 'Guest'} has not arrived`, `Room ${s.roomNumber || '-'} · ${s.bookingCode || ''}`]));
    if (!rows.length) return '';
    return `<div class="hx-card flush" style="margin-top:var(--space-3)">${rows.slice(0, 6).map(([tone, a, b]) => `<div class="hx-row"><div class="grow"><b>${E(a)}</b><small class="hx-sub">${E(b || '')}</small></div>${pill(tone === 'bad' ? 'overdue' : 'check', tone)}</div>`).join('')}</div>`;
  }

  function shortcutsList() {
    const S = [];
    const add = (cond, href, ic, title, sub) => { if (cond) S.push({ href, ic, title, sub }); };
    const food = feature('restaurantOrdering'), rooms = feature('accommodation');
    add(food && can('restaurant.orders.view'), 'hx-floor.html', 'table', 'Tables & orders', 'Take an order or open a table');
    add(food && can('restaurant.kitchen.view'), 'hx-kitchen.html', 'flame', 'Kitchen & bar', 'Tickets to cook and serve');
    add(food && can('restaurant.bills.view'), 'hx-bills.html', 'receipt', 'Bills & payments', 'Collect payment, split, tip');
    add(feature('reservations') && can('restaurant.reservations.view'), 'hx-reservations.html', 'calendar', 'Reservations', 'Bookings for today and later');
    add(rooms && can('accommodation.stays.view'), 'hx-desk.html', 'key', 'Front desk', 'Arrivals, departures, in-house');
    add(rooms && can('accommodation.rooms.view'), 'hx-rooms.html', 'bed', 'Room board', 'Every room at a glance');
    add(rooms && can('accommodation.housekeeping.view'), 'hx-housekeeping.html', 'broom', 'Housekeeping', 'Rooms to clean and inspect');
    add(canAny('restaurant.settings.manage', 'restaurant.tables.manage', 'accommodation.rooms.manage'), 'hx-setup.html', 'rocket', 'Setup guide', 'Kitchen, order and room stations');
    return S;
  }
  function shortcuts() {
    const S = shortcutsList();
    return S.length ? `<div class="hx-tiles">${S.map((s) => `<a class="hx-tile" href="${s.href}"><span class="ic">${icon(s.ic)}</span><b>${E(s.title)}</b><small>${E(s.sub)}</small></a>`).join('')}</div>` : '';
  }

  function greeting() { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; }
})();
