/**
 * hx-setup.js - guided setup for the three stations of a restaurant / accommodation business:
 *   Kitchen station (kitchen + bar printers/screens, dishes), Order station (areas, tables, waiters),
 *   Accommodation station (room types, rooms, check-in rules).
 * Progress is read live from the API, so it is always true and nothing needs to be "ticked" by hand.
 */
(function () {
  const { E, can, canAny, feature, get, send, list, head, icon, formModal } = window.HX;
  let el;
  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    el = window.HX.mount('Setup guide');
    if (!el) return;
    await window.AppShell.whenProfileReady?.();
    render();
  }

  async function facts() {
    const b = window.HX.branchId(), q = { branchId: b };
    const food = feature('restaurantOrdering'), rooms = feature('accommodation');
    const [st, ar, tb, mi, rt, bd, em, rs, as] = await Promise.all([
      food ? get('/restaurant/stations', q) : null, food ? get('/restaurant/areas', q) : null,
      food ? get('/restaurant/tables', q) : null, food ? get('/restaurant/menu/items', { limit: 1 }) : null,
      rooms ? get('/accommodation/room-types') : null, rooms ? get('/accommodation/board', q) : null,
      get('/employees', { limit: 100 }), food ? get('/restaurant/settings') : null, rooms ? get('/accommodation/settings') : null,
    ]);
    const emp = list(em, 'employees');
    const roles = new Set(emp.map((e) => e.role));
    const boardRooms = bd && (bd.rooms || bd.board || list(bd, 'rooms'));
    return {
      stations: list(st, 'stations'), areas: list(ar, 'areas'), tables: list(tb, 'tables'),
      menuCount: (mi && (mi.total ?? (mi.pagination && mi.pagination.total))) ?? list(mi, 'items').length,
      roomTypes: list(rt, 'roomTypes'), rooms: Array.isArray(boardRooms) ? boardRooms.length : 0,
      hasWaiter: ['WAITER', 'HEAD_WAITER'].some((r) => roles.has(r)), hasChef: ['CHEF', 'KITCHEN_STAFF', 'BARTENDER'].some((r) => roles.has(r)),
      hasFront: ['RECEPTIONIST', 'HOUSEKEEPER'].some((r) => roles.has(r)),
      chargeSet: !!(rs && (rs.settings || rs).serviceCharge), checkSet: !!(as && (as.settings || as)),
    };
  }

  async function render() {
    el.innerHTML = '<div class="hx-card"><p class="hx-sub">Checking your setup…</p></div>';
    const f = await facts();
    const manageFood = can('restaurant.settings.manage') || can('restaurant.tables.manage') || can('restaurant.menu.manage');
    const manageRooms = can('accommodation.rooms.manage');

    const cards = [];
    if (feature('restaurantOrdering') && manageFood) {
      cards.push(station('Kitchen station', 'Where food and drinks are prepared', 'flame', [
        step('Create a kitchen or bar station', f.stations.length > 0, 'Add station', 'station', can('restaurant.settings.manage')),
        step('Add dishes to your menu', f.menuCount > 0, 'Add a dish', 'dish', can('restaurant.menu.manage')),
        step('Invite a chef or bartender', f.hasChef, 'Add staff', 'link:employees.html', true),
      ]));
      cards.push(station('Order station', 'Where guests sit and waiters take orders', 'table', [
        step('Add a dining area (indoor, patio, bar)', f.areas.length > 0, 'Add area', 'area', can('restaurant.tables.manage')),
        step('Add tables', f.tables.length > 0, 'Add tables', 'tables', can('restaurant.tables.manage')),
        step('Invite waiters', f.hasWaiter, 'Add staff', 'link:employees.html', true),
        step('Set service charge and tax', f.chargeSet, 'Open settings', 'link:hx-settings.html', true),
      ]));
    }
    if (feature('accommodation') && manageRooms) {
      cards.push(station('Accommodation station', 'Your rooms, rates and front desk', 'bed', [
        step('Create a room type with its nightly rate', f.roomTypes.length > 0, 'Add room type', 'roomtype', true),
        step('Add your rooms', f.rooms > 0, 'Add rooms', 'rooms', f.roomTypes.length > 0),
        step('Set check-in and check-out times', f.checkSet, 'Open settings', 'link:hx-settings.html', true),
        step('Invite reception and housekeeping staff', f.hasFront, 'Add staff', 'link:employees.html', true),
      ]));
    }
    const steps = cards.flatMap((c) => c.steps), done = steps.filter((s) => s.done).length, pct = steps.length ? Math.round((done / steps.length) * 100) : 0;
    const welcome = new URLSearchParams(location.search).has('welcome');

    el.innerHTML = head('Setup guide', 'Three stations to get working. Each step ticks itself off when it is done.') +
      `<div class="hx-welcome"><h2>${pct === 100 ? 'You are ready to serve' : welcome ? 'Welcome. Let’s set up your business' : 'Your setup'}</h2>
        <p>${pct === 100 ? 'Every station is set up. Open Tables & orders or the Front desk to start.' : `${done} of ${steps.length} steps done. Start at the top of each card.`}</p>
        <div class="hx-progress"><i style="width:${pct}%"></i></div></div>` +
      (cards.length ? `<div class="hx-stations">${cards.map((c) => c.html).join('')}</div>` : window.UI.emptyStateHtml({ icon: 'lock', title: 'Nothing for you to set up', message: 'Setup needs the owner or a manager. Ask them to open this page.' })) +
      (pct === 100 ? `<div class="hx-actions" style="margin-top:var(--space-5)"><a class="btn btn-primary" href="hx-dashboard.html">Go to overview</a></div>` : '');

    el.querySelectorAll('[data-do]').forEach((b) => b.addEventListener('click', () => doStep(b.dataset.do, f)));
  }

  function step(label, done, cta, action, allowed) { return { label, done, cta, action, allowed }; }
  function station(title, sub, ic, steps) {
    const html = `<section class="hx-station"><header><span class="ic">${icon(ic)}</span><div><h3>${E(title)}</h3><small>${E(sub)}</small></div></header>
      <ul>${steps.map((s) => `<li><span class="hx-tick ${s.done ? 'done' : ''}">${s.done ? icon('check') : ''}</span><span style="flex:1">${E(s.label)}</span>
        ${s.done || !s.allowed ? '' : (s.action.startsWith('link:') ? `<a class="btn btn-sm btn-secondary" href="${s.action.slice(5)}">${E(s.cta)}</a>` : `<button class="btn btn-sm btn-primary" data-do="${s.action}">${E(s.cta)}</button>`)}</li>`).join('')}</ul></section>`;
    return { html, steps };
  }

  async function doStep(action, f) {
    const b = window.HX.branchId(), after = async (r) => { if (r) { window.UI.toast.success('Saved'); render(); } return !!r; };
    if (action === 'station') return formModal({ title: 'Add a station', intro: 'A station is a kitchen or bar screen. Dishes are sent to the station they belong to.', fields: [
      { name: 'name', label: 'Name', required: true, placeholder: 'Main kitchen' }, { name: 'code', label: 'Short code', required: true, placeholder: 'KIT', hint: 'At least 2 letters. Used when assigning dishes.' },
      { name: 'type', label: 'Type', type: 'select', options: [['KITCHEN', 'Kitchen'], ['BAR', 'Bar']], value: 'KITCHEN' }, { name: 'isDefault', label: 'Send dishes here by default', type: 'checkbox', value: !f.stations.length },
    ], onSubmit: async (v) => after(await send('post', '/restaurant/stations', { ...v, code: v.code.toUpperCase(), branchId: b })) });
    if (action === 'area') return formModal({ title: 'Add a dining area', fields: [
      { name: 'name', label: 'Name', required: true, placeholder: 'Main hall' },
      { name: 'type', label: 'Type', type: 'select', options: ['INDOOR', 'OUTDOOR', 'BALCONY', 'VIP', 'BAR', 'PRIVATE', 'OTHER'], value: 'INDOOR' },
    ], onSubmit: async (v) => after(await send('post', '/restaurant/areas', { ...v, branchId: b })) });
    if (action === 'tables') return formModal({ title: 'Add tables', intro: 'Creates a run of tables in one go, for example T1 to T10.', fields: [
      { name: 'areaId', label: 'Area', type: 'select', options: [['', 'No area'], ...f.areas.map((a) => [a._id, a.name])] },
      { row: [{ name: 'prefix', label: 'Name prefix', value: 'T' }, { name: 'count', label: 'How many', type: 'number', value: 10, min: 1, max: 100, required: true }, { name: 'seats', label: 'Seats each', type: 'number', value: 4, min: 1, max: 100 }] },
    ], onSubmit: async (v) => {
      let made = 0;
      for (let i = 1; i <= v.count; i++) {
        const r = await send('post', '/restaurant/tables', { branchId: b, ...(v.areaId ? { areaId: v.areaId } : {}), name: `${v.prefix || 'T'}${i}`, seats: v.seats || 4 });
        if (!r) break; made++;
      }
      if (made) { window.UI.toast.success(`${made} table${made > 1 ? 's' : ''} added`); render(); }
      return made > 0;
    } });
    if (action === 'dish') return formModal({ title: 'Add your first dish', intro: 'You can add photos, sizes and extras later in Menu.', fields: [
      { name: 'name', label: 'Dish name', required: true, placeholder: 'Chicken biryani' },
      { row: [{ name: 'basePrice', label: 'Price', type: 'number', required: true, min: 0, step: '0.01' }, { name: 'stationCode', label: 'Station', type: 'select', options: [['', 'Default'], ...f.stations.map((s) => [s.code, s.name])] }] },
    ], onSubmit: async (v) => after(await send('post', '/restaurant/menu/items', v)) });
    if (action === 'roomtype') return formModal({ title: 'Add a room type', intro: 'A room type groups rooms that share a rate, such as Standard Double.', fields: [
      { name: 'name', label: 'Name', required: true, placeholder: 'Standard double' },
      { row: [{ name: 'baseRate', label: 'Rate per night', type: 'number', required: true, min: 0, step: '0.01' }, { name: 'maxAdults', label: 'Max adults', type: 'number', value: 2, min: 1 }] },
      { name: 'images', label: 'Room photos (optional)', type: 'images', hint: 'Guests see these when they book online.' },
    ], onSubmit: async (v) => {
      let urls = []; if (v.images && v.images.length) { try { urls = await window.HX.uploadImages(v.images); } catch (e) { window.UI.toast.error((e && e.message) || 'Could not upload the photos'); return false; } }
      const { images, ...rest } = v;
      return after(await send('post', '/accommodation/room-types', { ...rest, ...(urls.length ? { images: urls } : {}) }));
    } });
    if (action === 'rooms') return formModal({ title: 'Add rooms', intro: 'Type room numbers separated by commas, or a range like 101-110.', fields: [
      { name: 'roomTypeId', label: 'Room type', type: 'select', options: f.roomTypes.map((t) => [t._id, t.name]) },
      { name: 'numbers', label: 'Room numbers', required: true, placeholder: '101-110, 201' }, { name: 'floor', label: 'Floor (optional)' },
      { name: 'images', label: 'Room photos (optional)', type: 'images', hint: 'With several rooms, they all get the same photos.' },
    ], onSubmit: async (v) => {
      const numbers = expand(v.numbers); if (!numbers.length) { window.UI.toast.warning('Enter at least one room number'); return false; }
      let urls = []; if (v.images && v.images.length) { try { urls = await window.HX.uploadImages(v.images); } catch (e) { window.UI.toast.error((e && e.message) || 'Could not upload the photos'); return false; } }
      return after(await send('post', '/accommodation/rooms/bulk', { branchId: b, roomTypeId: v.roomTypeId, numbers, ...(v.floor ? { floor: v.floor } : {}), ...(urls.length ? { images: urls } : {}) }));
    } });
  }

  function expand(text) {
    const out = [];
    String(text).split(',').map((s) => s.trim()).filter(Boolean).forEach((p) => {
      const m = p.match(/^(\d+)\s*-\s*(\d+)$/);
      if (m && +m[2] >= +m[1] && +m[2] - +m[1] < 200) for (let n = +m[1]; n <= +m[2]; n++) out.push(String(n)); else out.push(p);
    });
    return Array.from(new Set(out)).slice(0, 200);
  }
})();
