/**
 * hx-restaurant-settings.js - ONE hybrid settings hub for restaurant AND accommodation.
 * It replaces three pages: "Devices & printing" (hx-operations), "Service settings" (hx-settings) and "Services & system check" (hx-services).
 *
 *   Start         Overview               snapshot of every area + warnings, each tile opens its tab
 *   Set up        Services               switch services on/off          PUT /business { businessType, featureSettings }
 *                 Devices & printing     devices, paper, mark-ready      GET/PUT /restaurant/operations
 *                 Staff & roles          worker counts per role          GET /employees
 *   Restaurant    Billing, tips & discounts / Kitchen & floor / Reservations / Guest QR ordering
 *                                         GET/PUT /restaurant/settings   (only the fields of the open section are sent: the schema is strict)
 *                 Ingredient tracking    GET/PUT /restaurant/tracking
 *   Accommodation Rooms & front desk     GET/PUT /accommodation/settings
 *   Health        System check           read-only calls against every restaurant / accommodation endpoint
 *
 * Tabs appear only when the business has the service on AND the user holds the permission. Deep links: hx-restaurant-settings.html#devices
 * The server address is never shown on this page.
 */
(function () {
  const { E, can, feature, get, send, list, head, fieldHtml } = window.HX;
  let el, body, tab, flags = {}, dirty = false, token = 0, filter = '';
  const cache = {};                                    // loaded server data, cleared after each save
  document.addEventListener('DOMContentLoaded', init);

  /* ------------------------------------------------------------------ helpers */
  const dig = (o, path) => path.split('.').reduce((a, k) => (a == null ? undefined : a[k]), o);
  const put = (o, path, v) => { const ks = path.split('.'); ks.slice(0, -1).reduce((a, k) => (a[k] = a[k] || {}), o)[ks.pop()] = v; };
  const ico = (n) => (window.HX.icon ? window.HX.icon(n) : '');
  const rv = () => feature('restaurantOrdering') && can('restaurant.settings.view');
  const av = () => feature('accommodation') && can('accommodation.settings.view');
  const owner = () => can('settings.update');
  const money = (cents) => (typeof cents === 'number' ? 'KSh ' + (cents / 100).toLocaleString('en-KE', { maximumFractionDigits: 2 }) : '');
  const pctTxt = (n) => (typeof n === 'number' ? window.HX.pct(n) : '–');
  const bar = (title, desc) => `<div class="rs-bar"><div><h2>${E(title)}</h2>${desc ? `<p>${E(desc)}</p>` : ''}</div><span class="rs-flag ${dirty ? 'on' : ''}" id="rs-flag">● Unsaved changes</span></div>`;
  const loading = () => window.HX.skel ? window.HX.skel('rows', 4) : '<div class="rs-card"><p class="rs-desc">Loading…</p></div>';
  function setDirty(v) { dirty = v; const f = el && el.querySelector('#rs-flag'); if (f) f.classList.toggle('on', v); }

  async function loadSettings(source) {
    if (!cache[source]) { const d = await get(source === 'restaurant' ? '/restaurant/settings' : '/accommodation/settings'); cache[source] = (d && (d.settings || d)) || null; }
    return cache[source];
  }
  async function loadOps(force) {
    if (force || !cache.ops) cache.ops = await get('/restaurant/operations', { branchId: window.HX.branchId() });
    return cache.ops;
  }
  async function loadTracking(force) {
    if (force || !cache.tracking) { const d = await get('/restaurant/tracking'); cache.tracking = d && d.tracking ? d.tracking : null; }
    return cache.tracking;
  }

  /* ------------------------------------------------------------------ tabs */
  const MODES = [['OFF', 'Off'], ['MENU_ONLY', 'Menu only'], ['ORDER_CONFIRM', 'Order, staff confirm'], ['ORDER_AUTO', 'Order, auto accept']];
  const TABS = [
    { id: 'overview', group: 'Start', label: 'Overview', icon: 'flag', desc: 'Everything at a glance. Tap a card to change it.', kw: 'summary status home warnings', show: () => rv() || av() || owner(), render: renderOverview },
    { id: 'services', group: 'Set up', label: 'Services', icon: 'server', desc: 'Switch on what this business offers. Menus and screens appear straight after saving.', kw: 'features switch on off restaurant tables kitchen recipes reservations qr rooms accommodation', show: owner, render: renderServices },
    { id: 'devices', group: 'Set up', label: 'Devices & printing', icon: 'printer', desc: 'Tell the system what you have. It adapts: kitchen on paper or screen, one printer or many, with or without waiters.', kw: 'printer kitchen screen tablet kiosk paper receipt ticket kot cashier station auto-print bar mark ready', show: rv, render: renderDevices },
    { id: 'staff', group: 'Set up', label: 'Staff & roles', icon: 'employees', desc: 'Which worker roles are available for the services you have switched on.', kw: 'employees workers waiter chef receptionist housekeeper roles team', show: owner, render: renderStaff },
    { id: 'billing', group: 'Restaurant', label: 'Billing, tips & discounts', icon: 'wallet', desc: 'Service charge, tax, how tips are shared and how much discount each role may give.', kw: 'service charge tax vat tips discount percent waiter cashier supervisor manager', show: rv, render: () => renderSettings('billing') },
    { id: 'floor', group: 'Restaurant', label: 'Kitchen & floor', icon: 'utensils', desc: 'When tickets count as late and the rules waiters and cashiers follow.', kw: 'kitchen delay late ticket table cleaning cash shift sold out hide', show: rv, render: () => renderSettings('floor') },
    { id: 'reservations', group: 'Restaurant', label: 'Table reservations', icon: 'calendarCheck', desc: 'How long a booking lasts, when tables lock, no-shows and deposits.', kw: 'booking hold lock deposit prepay no-show reminder', show: () => rv() && feature('reservations'), render: () => renderSettings('reservations') },
    { id: 'guest', group: 'Restaurant', label: 'Guest QR ordering', icon: 'qr', desc: 'What guests can do when they scan the QR code at a table or in a room.', kw: 'qr scan guest menu bill request welcome message', show: () => rv() && feature('guestQrOrdering'), render: () => renderSettings('guest') },
    { id: 'tracking', group: 'Restaurant', label: 'Ingredient tracking', icon: 'box', desc: 'Take ingredients out of stock when a dish is sold, with expiry alerts and real food cost.', kw: 'recipes ingredients stock expiry food cost waste', show: rv, render: renderTracking },
    { id: 'rooms', group: 'Accommodation', label: 'Rooms & front desk', icon: 'bed', desc: 'Check-in and check-out times, stay rules and booking deposits.', kw: 'check-in check-out late early nights id deposit rate front desk stay', show: av, render: () => renderSettings('rooms') },
    { id: 'check', group: 'Health', label: 'System check', icon: 'pulse', desc: 'Tests every restaurant and accommodation screen and tells you exactly what is wrong.', kw: 'test diagnose health problems errors backend', show: owner, render: renderCheck },
  ];
  const ALIAS = { restaurant: 'billing', operations: 'devices', system: 'check', printing: 'devices', settings: 'billing' };
  const visible = () => TABS.filter((t) => { try { return t.show(); } catch { return false; } });
  const byId = (id) => TABS.find((t) => t.id === id);

  /* ------------------------------------------------------------------ shell */
  async function init() {
    el = window.HX.mount('Restaurant settings'); if (!el) return;
    await window.AppShell.whenProfileReady?.(); await window.AppShell.refreshBusinessProfile?.();
    flags = { ...((window.AppShell.getBusinessProfile() || {}).featureSettings || {}) };
    const tabs = visible();
    if (!tabs.length) { el.innerHTML = head('Restaurant settings') + window.UI.emptyStateHtml({ icon: 'lock', title: 'No settings for you', message: 'Ask the owner or a manager.' }); return; }
    el.innerHTML = head('Restaurant settings', 'Devices & printing, services, billing rules, guest ordering, rooms and system health, all in one place.') +
      `<div class="rs"><aside class="rs-nav" id="rs-nav"></aside><section class="rs-main"><div id="rs-body"></div></section></div>`;
    body = el.querySelector('#rs-body');
    body.addEventListener('input', (e) => { if (e.target.closest('[data-track]')) setDirty(true); });
    body.addEventListener('change', (e) => { if (e.target.closest('[data-track]')) setDirty(true); });
    window.addEventListener('beforeunload', (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });
    window.addEventListener('hashchange', () => { const id = location.hash.slice(1); if (byId(ALIAS[id] || id) && (ALIAS[id] || id) !== tab) go(ALIAS[id] || id, true); });
    window.addEventListener('branchchange', () => { if (dirty) return; delete cache.ops; delete cache.tracking; go(tab, true); });
    paintNav();
    const want = location.hash.slice(1); const id = ALIAS[want] || want;
    go(tabs.find((t) => t.id === id) ? id : tabs[0].id, true);
  }

  function paintNav() {
    const nav = el.querySelector('#rs-nav'); const q = filter.trim().toLowerCase();
    const tabs = visible().filter((t) => !q || (t.label + ' ' + t.kw + ' ' + t.group).toLowerCase().includes(q));
    const groups = [...new Set(tabs.map((t) => t.group))];
    nav.innerHTML = `<div class="rs-search"><input class="input" type="search" id="rs-find" placeholder="Find a setting…" value="${E(filter)}" aria-label="Find a setting"></div>` +
      (groups.length ? groups.map((g) => `<div class="rs-group"><h6>${E(g)}</h6>${tabs.filter((t) => t.group === g).map((t) => `<button type="button" class="rs-tab ${t.id === tab ? 'on' : ''}" data-tab="${t.id}">${ico(t.icon)}<span>${E(t.label)}</span></button>`).join('')}</div>`).join('') : '<div class="rs-empty-nav">Nothing matches.</div>');
    nav.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => go(b.dataset.tab)));
    const f = nav.querySelector('#rs-find');
    f.addEventListener('input', () => { filter = f.value; const pos = f.selectionStart; paintNav(); const n = el.querySelector('#rs-find'); n.focus(); try { n.setSelectionRange(pos, pos); } catch { /* ignore */ } });
    f.addEventListener('keydown', (e) => { if (e.key === 'Enter') { const first = nav.querySelector('[data-tab]'); if (first) go(first.dataset.tab); } });
  }

  async function go(id, force) {
    const t = byId(id); if (!t || !visible().includes(t)) return;
    if (!force && dirty && !window.confirm('You have unsaved changes on this page. Leave without saving?')) return;
    setDirty(false); tab = id; const my = ++token;
    if (location.hash.slice(1) !== id) history.replaceState(null, '', '#' + id);
    paintNav();
    body.innerHTML = bar(t.label, t.desc) + loading();
    try { await t.render(my); } catch (e) { if (my === token) body.innerHTML = bar(t.label, t.desc) + window.HX.empty('Something went wrong', (e && e.message) || 'Try again in a moment.'); }
  }
  const current = (my) => my === token;
  const draw = (t, html) => { body.innerHTML = bar(t.label, t.desc) + html; };

  /* ------------------------------------------------------------------ Overview */
  async function renderOverview(my) {
    const t = byId('overview');
    const [rs, as, ops, trk] = await Promise.all([
      rv() ? loadSettings('restaurant') : null, av() ? loadSettings('accommodation') : null,
      rv() ? loadOps() : null, rv() ? loadTracking() : null,
    ]);
    if (!current(my)) return;
    const tile = (id, label, value, sub) => (visible().some((x) => x.id === id) ? `<button type="button" class="rs-tile" data-go="${id}"><small>${E(label)}</small><b>${E(value)}</b><span>${E(sub || '')}</span></button>` : '');
    const tiles = [];
    const svcKeys = SERVICES.map((s) => s[0]); const on = svcKeys.filter((k) => flags[k]).length;
    tiles.push(tile('services', 'Services', `${on} of ${svcKeys.length} on`, svcKeys.filter((k) => flags[k]).map((k) => SERVICES.find((s) => s[0] === k)[1]).slice(0, 3).join(', ')));
    if (ops && ops.operations) {
      const o = ops.operations; const dv = Object.entries(o.devices || {}).filter(([, v]) => v).length;
      tiles.push(tile('devices', 'Devices & printing', o.configured ? `${dv} device${dv === 1 ? '' : 's'}` : 'Not set up yet', o.configured ? (o.preset && o.preset !== 'CUSTOM' ? String(o.preset).replace(/_/g, ' ').toLowerCase() : 'Custom set-up') : 'Pick the set-up closest to yours'));
    }
    if (rs) {
      const sc = rs.serviceCharge || {};
      tiles.push(tile('billing', 'Billing', sc.enabled ? `Service charge ${pctTxt(sc.percent)}` : 'No service charge', `Tax ${pctTxt(sc.taxRate)} · Tips ${dig(rs, 'tips.enabled') ? 'on' : 'off'}`));
      tiles.push(tile('floor', 'Kitchen & floor', `Late after ${rs.kitchenDelayMinutes != null ? rs.kitchenDelayMinutes : '–'} min`, rs.requireTableCleaning ? 'Tables need cleaning' : 'No cleaning step'));
      const r = rs.reservation || {};
      tiles.push(tile('reservations', 'Reservations', r.durationMinutes ? `${r.durationMinutes} min bookings` : 'Default rules', r.depositRequired ? `Deposit ${money(r.depositCents)}` : 'No table deposit'));
      const g = rs.guestOrdering || {}; const m = (MODES.find((x) => x[0] === g.tableMode) || [])[1];
      tiles.push(tile('guest', 'Guest QR ordering', m || 'Not set', g.roomMode ? `Rooms: ${(MODES.find((x) => x[0] === g.roomMode) || [])[1] || g.roomMode}` : ''));
    }
    if (trk) tiles.push(tile('tracking', 'Ingredient tracking', trk.enabled ? 'On' : 'Off', trk.enabled && trk.dishes ? `${trk.dishes.withRecipe} of ${trk.dishes.total} dishes have a recipe` : 'Orders do not touch stock'));
    if (as) tiles.push(tile('rooms', 'Rooms & front desk', `In ${dig(as, 'checkIn.time') || '–'} · Out ${dig(as, 'checkOut.time') || '–'}`, dig(as, 'deposit.required') ? 'Deposit on booking' : 'No booking deposit'));
    tiles.push(tile('staff', 'Staff & roles', 'Workers', 'See who can be added'));
    tiles.push(tile('check', 'System check', 'Run a test', 'Find problems before guests do'));
    const warn = ((ops && ops.warnings) || []).map((w) => `<div class="rs-warn ${w.level === 'warning' ? 'warning' : ''}">${E(w.message)}</div>`).join('');
    draw(t, `${warn}<div class="rs-tiles">${tiles.join('')}</div>
      <div class="rs-card"><h3>Quick links</h3><p class="rs-desc">Related screens outside settings.</p><div class="rs-pills">
        <a class="btn btn-secondary btn-sm" href="hx-setup.html">Setup guide</a><a class="btn btn-secondary btn-sm" href="hx-menu.html">Menu</a>
        <a class="btn btn-secondary btn-sm" href="employees.html">Employees</a>${feature('guestQrOrdering') ? '<a class="btn btn-secondary btn-sm" href="hx-guest.html">Guest QR codes</a>' : ''}${feature('accommodation') ? '<a class="btn btn-secondary btn-sm" href="hx-rooms.html">Room board</a>' : ''}</div></div>`);
    body.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => go(b.dataset.go)));
  }

  /* ------------------------------------------------------------------ generic settings forms (restaurant + accommodation) */
  const SECTIONS = {
    billing: { source: 'restaurant', path: '/restaurant/settings', manage: 'restaurant.settings.manage', cards: [
      { h: 'Service charge and tax', d: 'Added to every bill automatically.', f: [
        { name: 'serviceCharge.enabled', label: 'Add a service charge to bills', type: 'checkbox' },
        { row: [{ name: 'serviceCharge.percent', label: 'Service charge %', type: 'number', min: 0, max: 100, step: '0.1' }, { name: 'serviceCharge.taxRate', label: 'Tax rate %', type: 'number', min: 0, max: 100, step: '0.1' }] }] },
      { h: 'Tips', f: [
        { name: 'tips.enabled', label: 'Accept tips on bills', type: 'checkbox' },
        { name: 'tips.mode', label: 'How tips are shared', type: 'select', showIf: 'tips.enabled', options: [['INDIVIDUAL', 'Each waiter keeps their own'], ['POOL', 'Pooled across staff']] }] },
      { h: 'Discounts', d: 'The maximum % each role may give on a bill.', f: [
        { row: [{ name: 'discounts.waiterMaxPercent', label: 'Waiter', type: 'number', min: 0, max: 100 }, { name: 'discounts.cashierMaxPercent', label: 'Cashier', type: 'number', min: 0, max: 100 }] },
        { row: [{ name: 'discounts.supervisorMaxPercent', label: 'Supervisor', type: 'number', min: 0, max: 100 }, { name: 'discounts.managerMaxPercent', label: 'Manager', type: 'number', min: 0, max: 100 }] }] },
    ] },
    floor: { source: 'restaurant', path: '/restaurant/settings', manage: 'restaurant.settings.manage', cards: [
      { h: 'Kitchen', f: [{ name: 'kitchenDelayMinutes', label: 'Mark a ticket late after (minutes)', type: 'number', min: 1, max: 240 }] },
      { h: 'Floor and payments', f: [
        { name: 'requireTableCleaning', label: 'Tables need cleaning before they can be seated again', type: 'checkbox' },
        { name: 'paymentsRequireShift', label: 'Cash payments need an open cash shift', type: 'checkbox' },
        { name: 'hideOutOfStockItems', label: 'Hide sold-out dishes from waiters', type: 'checkbox' }] },
    ] },
    reservations: { source: 'restaurant', path: '/restaurant/settings', manage: 'restaurant.settings.manage', cards: [
      { h: 'Booking times', f: [
        { row: [{ name: 'reservation.durationMinutes', label: 'Default length of a booking (minutes)', type: 'number', min: 15, max: 600 }, { name: 'reservation.lockMinutes', label: 'Lock the table before the booking (minutes)', type: 'number', min: 0, max: 480, hint: 'From then on the table shows Reserved and no walk-in can be seated there.' }] },
        { row: [{ name: 'reservation.remindMinutes', label: 'Alert staff before a booking (minutes)', type: 'number', min: 0, max: 1440, hint: '0 = no alert.' }, { name: 'reservation.lateAlertMinutes', label: 'Alert staff when the guest is late by (minutes)', type: 'number', min: 0, max: 120, hint: '0 = no alert.' }] }] },
      { h: 'No-shows', f: [
        { row: [{ name: 'reservation.holdMinutes', label: 'Release the table if the guest has not come after (minutes)', type: 'number', min: 0, max: 120, hint: 'The booking becomes a no-show and the table is freed. 0 = never release automatically.' }, { name: 'reservation.noShowAction', label: 'If a guest never comes, their prepaid money', type: 'select', options: [['HOLD', 'Is held: a manager decides'], ['FORFEIT', 'Is kept by the business']] }] },
        { name: 'reservation.maxNoShows', label: 'Stop online booking after this many no-shows', type: 'number', min: 0, max: 20, hint: '0 = never stop.' }] },
      { h: 'Prepayment and deposit', f: [
        { name: 'reservation.minSpendPerGuestCents', label: 'Minimum food to prepay per guest online (KSh)', type: 'number', min: 0, step: '0.01', scale: 100, hint: '0 = guests may prepay any amount.' },
        { name: 'reservation.depositRequired', label: 'Ask for a table deposit when the guest does not prepay food', type: 'checkbox' },
        { name: 'reservation.depositCents', label: 'Table deposit (KSh)', type: 'number', min: 0, step: '0.01', scale: 100, showIf: 'reservation.depositRequired' }] },
    ] },
    guest: { source: 'restaurant', path: '/restaurant/settings', manage: 'restaurant.settings.manage', cards: [
      { h: 'Where guests can order', f: [{ row: [{ name: 'guestOrdering.tableMode', label: 'At tables', type: 'select', options: MODES }, { name: 'guestOrdering.roomMode', label: 'In rooms', type: 'select', options: MODES }] }] },
      { h: 'What guests see and can do', f: [
        { name: 'guestOrdering.showPrices', label: 'Show prices to guests', type: 'checkbox' },
        { name: 'guestOrdering.allowNotes', label: 'Let guests add notes to dishes', type: 'checkbox' },
        { name: 'guestOrdering.allowBillRequest', label: 'Let guests ask for the bill', type: 'checkbox' },
        { name: 'guestOrdering.requireName', label: 'Ask for the guest’s name', type: 'checkbox' },
        { name: 'guestOrdering.requirePhone', label: 'Ask for the guest’s phone', type: 'checkbox' }] },
      { h: 'Limits and message', f: [
        { row: [{ name: 'guestOrdering.maxItemsPerRequest', label: 'Max dishes per request', type: 'number', min: 1, max: 100 }, { name: 'guestOrdering.requestExpiryMinutes', label: 'Request expires after (min)', type: 'number', min: 2, max: 240 }] },
        { name: 'guestOrdering.welcomeMessage', label: 'Welcome message', type: 'textarea' }] },
    ], after: '<div class="rs-pills" style="margin-bottom:var(--space-3)"><a class="btn btn-secondary btn-sm" href="hx-guest.html">Open guest requests &amp; QR codes</a></div>' },
    rooms: { source: 'accommodation', path: '/accommodation/settings', manage: 'accommodation.settings.manage', cards: [
      { h: 'Check-in and check-out', f: [
        { row: [{ name: 'checkIn.time', label: 'Check-in from', type: 'time' }, { name: 'checkOut.time', label: 'Check-out by', type: 'time' }] },
        { name: 'earlyCheckIn.allowed', label: 'Allow early check-in (fees apply)', type: 'checkbox' },
        { name: 'lateCheckOut.allowed', label: 'Allow late check-out (fees apply)', type: 'checkbox' },
        { name: 'lateCheckOut.graceMinutes', label: 'Free grace period (minutes)', type: 'number', min: 0, max: 240, showIf: 'lateCheckOut.allowed' }] },
      { h: 'Stay rules', f: [
        { row: [{ name: 'stay.minNights', label: 'Minimum nights', type: 'number', min: 1 }, { name: 'stay.maxNights', label: 'Maximum nights', type: 'number', min: 1 }] },
        { name: 'stay.requireIdAtCheckIn', label: 'Require guest ID at check-in', type: 'checkbox' },
        { name: 'stay.requirePhone', label: 'Require a phone number', type: 'checkbox' },
        { name: 'stay.allowOverrideRate', label: 'Let staff change the nightly rate', type: 'checkbox' }] },
      { h: 'Deposit', f: [
        { name: 'deposit.required', label: 'Ask for a deposit on booking', type: 'checkbox' },
        { row: [{ name: 'deposit.type', label: 'Deposit type', type: 'select', showIf: 'deposit.required', options: [['FIRST_NIGHT', 'First night'], ['PERCENT', 'Percent of stay'], ['FLAT', 'Fixed amount']] }, { name: 'deposit.value', label: 'Value', type: 'number', min: 0, step: '0.01', showIf: 'deposit.required' }] }] },
    ] },
  };

  async function renderSettings(key) {
    const my = token, t = byId(tab), S = SECTIONS[key];
    const values = await loadSettings(S.source);
    if (!current(my)) return;
    if (!values) { draw(t, window.HX.empty('Could not load these settings', 'Try again in a moment.')); return; }
    const editable = can(S.manage);
    const flat = S.cards.flatMap((c) => c.f.flatMap((f) => (f.row ? f.row : [f])));
    const withVal = (f) => { const v = dig(values, f.name); return { ...f, value: f.scale && typeof v === 'number' ? v / f.scale : v }; };   // money is stored in cents; shown and typed in KSh
    const one = (f) => { const h = fieldHtml(withVal(f)); return f.showIf ? `<div data-showif="${f.showIf}" ${dig(values, f.showIf) ? '' : 'hidden'}>${h}</div>` : h; };
    const cards = S.cards.map((c) => `<div class="rs-card"><h3>${E(c.h)}</h3>${c.d ? `<p class="rs-desc">${E(c.d)}</p>` : ''}<div class="rs-fields">${c.f.map((f) => (f.row ? `<div class="rs-grid two">${f.row.map(one).join('')}</div>` : one(f))).join('')}</div></div>`).join('');
    draw(t, `${S.after || ''}<form data-track novalidate><fieldset class="rs-fields" ${editable ? '' : 'disabled'}>${cards}</fieldset>
      <div class="rs-savebar">${editable ? '<button class="btn btn-primary" type="submit">Save changes</button><button class="btn btn-secondary" type="button" data-reset>Discard changes</button><span class="grow">Changes apply to everyone straight away.</span>' : '<span class="grow">You can view these settings but not change them.</span>'}</div></form>`);
    const form = body.querySelector('form');
    const sync = () => form.querySelectorAll('[data-showif]').forEach((w) => { const c = form.querySelector(`[name="${w.dataset.showif}"]`); w.hidden = !(c && c.checked); });
    form.addEventListener('change', sync);
    form.querySelector('[data-reset]')?.addEventListener('click', () => { setDirty(false); go(tab, true); });
    form.addEventListener('submit', async (e) => {
      e.preventDefault(); if (!editable) return;
      const out = {};
      for (const f of flat) {
        const input = form.querySelector(`[name="${f.name}"]`); if (!input) continue;
        if (f.type === 'checkbox') { put(out, f.name, input.checked); continue; }
        if (input.value === '') continue;
        if (f.type === 'number') {
          if (!input.checkValidity()) { window.UI.toast.warning(`${f.label}: ${input.validationMessage}`); input.focus(); return; }
          put(out, f.name, f.scale ? Math.round(Number(input.value) * f.scale) : Number(input.value));
        } else put(out, f.name, input.value);
      }
      if (key === 'rooms' && out.stay && out.stay.minNights != null && out.stay.maxNights != null && out.stay.minNights > out.stay.maxNights) { window.UI.toast.warning('Minimum nights cannot be more than maximum nights'); return; }
      const btn = form.querySelector('[type=submit]'); window.UI.setButtonLoading(btn, true, 'Saving…');
      const r = await send('put', S.path, out); window.UI.setButtonLoading(btn, false);
      if (r) { delete cache[S.source]; setDirty(false); window.UI.toast.success('Settings saved'); await loadSettings(S.source); }
    });
  }

  /* ------------------------------------------------------------------ Services */
  const SERVICES = [
    ['restaurantOrdering', 'Restaurant ordering', 'Master switch: take orders, send to kitchen, bill and pay. Needed for everything below it.'],
    ['tableManagement', 'Tables & floor', 'Open orders against tables and see the floor at a glance.'],
    ['kitchenDisplay', 'Kitchen & bar screen', 'Tickets and timers for chefs and bartenders.'],
    ['recipeManagement', 'Recipes & ingredients', 'Deduct ingredients per dish, track food cost and waste.'],
    ['reservations', 'Reservations', 'Book tables ahead, take deposits.'],
    ['guestQrOrdering', 'Guest QR ordering', 'QR codes on tables and rooms: guests see the menu, order and call a waiter.'],
    ['accommodation', 'Rooms & stays (accommodation)', 'Room types, rooms, bookings, check-in / check-out, guest folios, housekeeping and front desk.'],
  ];

  function renderServices() {
    const t = byId('services'), mayEdit = owner(), BT = window.BusinessTypes, p = window.AppShell.getBusinessProfile() || {};
    draw(t, `<form data-track novalidate><div class="rs-card"><h3>What this business offers</h3><p class="rs-desc">${mayEdit ? 'Switch a service on and the screens it needs appear. Switching the master switch off hides everything under it.' : 'Only the owner can change these.'}</p>
      <div class="hx-svc">${SERVICES.map(([k, l, d]) => `<label class="hx-svc-row ${flags[k] ? 'on' : ''}"><span class="hx-switch"><input type="checkbox" data-f="${k}" ${flags[k] ? 'checked' : ''} ${mayEdit ? '' : 'disabled'}><i></i></span><span><b>${E(l)}</b><small>${E(d)}</small></span></label>`).join('')}</div><div id="svcnext"></div></div>
      ${mayEdit ? '<div class="rs-savebar"><button class="btn btn-primary" type="submit" id="savesvc">Save services</button><button class="btn btn-secondary" type="button" data-reset>Discard changes</button><span class="grow">Menus and screens update straight after saving.</span></div>' : ''}</form>`);
    body.querySelectorAll('[data-f]').forEach((c) => c.addEventListener('change', () => {
      const on = c.checked; flags = BT && BT.applyToggle ? BT.applyToggle(flags, c.dataset.f, on, p.businessType) : { ...flags, [c.dataset.f]: on };
      body.querySelectorAll('[data-f]').forEach((x) => { x.checked = !!flags[x.dataset.f]; x.closest('.hx-svc-row').classList.toggle('on', !!flags[x.dataset.f]); });
    }));
    body.querySelector('[data-reset]')?.addEventListener('click', () => { flags = { ...((window.AppShell.getBusinessProfile() || {}).featureSettings || {}) }; setDirty(false); go('services', true); });
    body.querySelector('form').addEventListener('submit', async (e) => {
      e.preventDefault(); if (!mayEdit) return;
      if (!BT) { window.UI.toast.error('Could not save: the service list did not load. Refresh the page.'); return; }
      const btn = body.querySelector('#savesvc'); const type = p.businessType || 'restaurant';
      const full = Object.fromEntries(BT.featureKeys().map((k) => [k, !!flags[k]])); (BT.lockedFor(type) || []).forEach((k) => { full[k] = true; });
      window.UI.setButtonLoading(btn, true, 'Saving…');
      try {
        await window.Api.put('/business', { businessType: type, featureSettings: full });
        await window.AppShell.refreshBusinessProfile?.();
        flags = { ...((window.AppShell.getBusinessProfile() || {}).featureSettings || {}) };
        Object.keys(cache).forEach((k) => delete cache[k]); setDirty(false);
        window.UI.toast.success('Services saved'); paintNav();
        const t2 = byId('services'); renderServices();
        body.querySelector('#svcnext').innerHTML = `<div class="hx-note">${flags.accommodation ? 'Rooms &amp; stays are ON. Next: <a href="hx-setup.html">add room types and rooms in the Setup guide</a>, then <a href="employees.html">add a Receptionist and Housekeepers</a>.' : 'Saved.'} ${flags.restaurantOrdering ? 'Then pick your <a href="#devices" data-jump="devices">devices &amp; printing</a> and add tables and dishes in the <a href="hx-setup.html">Setup guide</a>.' : ''}</div>`;
        body.querySelector('[data-jump]')?.addEventListener('click', (ev) => { ev.preventDefault(); go('devices'); });
        void t2;
      } catch (err) { window.UI.toast.error((err && err.message) || 'Could not save'); window.UI.setButtonLoading(btn, false); }
    });
  }

  /* ------------------------------------------------------------------ Staff & roles */
  const ROLE_INFO = [
    ['restaurantOrdering', 'Waiter, Head waiter, Supervisor, Chef, Kitchen staff, Bartender, Expeditor, Delivery rider'],
    ['accommodation', 'Receptionist, Housekeeper'],
  ];
  async function renderStaff(my) {
    my = my || token; const t = byId('staff');
    const d = await get('/employees', { limit: 100 }); if (!current(my)) return;
    const rows = list(d, 'employees'); const by = {}; rows.forEach((u) => { by[u.role] = (by[u.role] || 0) + 1; });
    draw(t, `<div class="rs-card"><h3>Your team</h3><p class="rs-desc">Add workers in <b>Employees</b>. The roles you can pick depend on the services switched on.</p>
      <div class="rs-pills">${Object.keys(by).length ? Object.entries(by).map(([r, n]) => `<span class="badge role-badge role-${E(r)}">${E(r.replace(/_/g, ' '))} · ${n}</span>`).join(' ') : '<span class="rs-desc">No staff yet.</span>'}</div></div>
      <div class="rs-card"><h3>Roles available</h3>${ROLE_INFO.map(([k, r]) => `<div class="rs-row"><div class="grow"><b>${flags[k] ? 'Available' : 'Switch on the service first'}</b><small>${E(r)}</small></div>${flags[k] ? '' : '<button type="button" class="btn btn-sm btn-secondary" data-go="services">Open services</button>'}</div>`).join('')}</div>
      <div class="rs-pills"><a class="btn btn-primary" href="employees.html">Add a worker</a><a class="btn btn-secondary" href="hx-setup.html">Setup guide</a></div>`);
    body.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => go(b.dataset.go)));
  }

  /* ------------------------------------------------------------------ Ingredient tracking */
  async function renderTracking(my) {
    my = my || token; const t = byId('tracking');
    const tr = await loadTracking(true); if (!current(my)) return;
    if (!tr) { draw(t, window.HX.empty('Could not load tracking', 'Try again in a moment.')); return; }
    const editable = can('restaurant.settings.manage'), s = tr.tracking || {};
    const step = (c) => `<div class="rs-row"><span>${c.done ? '✅' : '⬜'}</span><div class="grow">${E(c.label)}</div></div>`;
    const pctDone = tr.dishes && tr.dishes.total ? Math.round((tr.dishes.withRecipe / tr.dishes.total) * 100) : 0;
    draw(t, `<div class="rs-card"><h3>Track ingredients with recipes</h3>
      <p class="rs-desc">${tr.enabled ? 'ON: every dish with a recipe takes its ingredients out of stock when sold (oldest batch first), expiry shows in your daily alert, and Profit &amp; loss uses the real cost of what was sold.' : 'OFF: orders do not touch ingredient stock. Profit &amp; loss counts food cost from what you buy (record it as a “Food Purchases” expense). Nothing is deleted when you switch this.'}</p>
      ${editable ? `<button class="btn ${tr.enabled ? 'btn-secondary' : 'btn-primary'}" id="tg">${tr.enabled ? 'Turn tracking off' : 'Turn tracking on'}</button>` : '<p class="rs-desc">Only the owner can change this.</p>'}</div>
      ${tr.enabled ? `<div class="rs-card flush"><div class="rs-row" style="padding:14px 16px"><div class="grow"><b>Setup progress</b><small>${tr.dishes.withRecipe} of ${tr.dishes.total} dishes have a recipe · ${tr.ingredients.total} ingredients${tr.ingredients.withoutCost ? ` · ${tr.ingredients.withoutCost} without a cost` : ''}</small><div class="rs-progress"><i style="width:${pctDone}%"></i></div></div><a class="btn btn-sm btn-secondary" href="hx-stock.html">Ingredients</a><a class="btn btn-sm btn-secondary" href="hx-menu.html">Menu</a></div><div style="padding:0 16px 8px">${(tr.checklist || []).map(step).join('')}</div></div>
      <form data-track id="tf" novalidate><fieldset class="rs-fields" ${editable ? '' : 'disabled'}><div class="rs-card"><h3>How it behaves</h3><div class="rs-fields">
        <div class="rs-grid two">${fieldHtml({ name: 'expiryCriticalDays', label: 'Red alert: expires within (days)', type: 'number', min: 0, max: 365, value: s.expiryCriticalDays })}${fieldHtml({ name: 'expiryWarningDays', label: 'Orange alert: expires within (days)', type: 'number', min: 1, max: 365, value: s.expiryWarningDays })}</div>
        ${fieldHtml({ name: 'autoWriteOffExpired', label: 'Write expired ingredients off automatically', type: 'checkbox', value: s.autoWriteOffExpired, hint: 'Off: they stay on the Batches list until a manager writes them off.' })}
        <div class="rs-grid two">${fieldHtml({ name: 'targetFoodCostPercent', label: 'Target food cost (% of sales)', type: 'number', min: 1, max: 100, value: s.targetFoodCostPercent })}${fieldHtml({ name: 'costBasis', label: 'Profit & loss counts food cost from', type: 'select', value: s.costBasis, options: [['AUTO', 'Automatic (recipes when tracking is on)'], ['RECIPE', 'Recipes: what was actually used'], ['PURCHASES', 'Purchases: what was bought']] })}</div></div></div></fieldset>
        ${editable ? '<div class="rs-savebar"><button class="btn btn-primary" type="submit">Save changes</button><button class="btn btn-secondary" type="button" data-reset>Discard changes</button></div>' : ''}</form>` : ''}`);
    body.querySelector('#tg')?.addEventListener('click', async (e) => {
      if (tr.enabled && !window.confirm('Turn ingredient tracking off? Recipes and stock are kept, but sales will stop deducting ingredients.')) return;
      window.UI.setButtonLoading(e.currentTarget, true, 'Saving…');
      const r = await send('put', '/restaurant/tracking', { enabled: !tr.enabled });
      if (r) { window.UI.toast.success(tr.enabled ? 'Tracking is off' : 'Tracking is on'); delete cache.tracking; renderTracking(); } else window.UI.setButtonLoading(e.currentTarget, false);
    });
    body.querySelector('[data-reset]')?.addEventListener('click', () => { setDirty(false); go('tracking', true); });
    body.querySelector('#tf')?.addEventListener('submit', async (e) => {
      e.preventDefault(); const f = e.currentTarget, q = (k) => f.querySelector(`[name="${k}"]`);
      for (const k of ['expiryCriticalDays', 'expiryWarningDays', 'targetFoodCostPercent']) { const i = q(k); if (i.value !== '' && !i.checkValidity()) { window.UI.toast.warning(i.validationMessage); i.focus(); return; } }
      const n = (k) => (q(k).value === '' ? undefined : Number(q(k).value));
      const out = { tracking: { expiryCriticalDays: n('expiryCriticalDays'), expiryWarningDays: n('expiryWarningDays'), targetFoodCostPercent: n('targetFoodCostPercent'), autoWriteOffExpired: q('autoWriteOffExpired').checked, costBasis: q('costBasis').value } };
      Object.keys(out.tracking).forEach((k) => out.tracking[k] === undefined && delete out.tracking[k]);
      const btn = f.querySelector('[type=submit]'); window.UI.setButtonLoading(btn, true, 'Saving…'); const r = await send('put', '/restaurant/tracking', out); window.UI.setButtonLoading(btn, false);
      if (r) { setDirty(false); delete cache.tracking; window.UI.toast.success('Saved'); }
    });
  }

  /* ------------------------------------------------------------------ Devices & printing */
  const DEVICE_GROUPS = [
    ['Ordering and payment', [['waiterTablet', 'Waiter tablet / phone', 'Waiters take orders at the table.'], ['cashierStation', 'Cashier station (tablet or PC)', 'Takes payments. With no waiters it also takes the orders.'], ['selfServiceKiosk', 'Self-service kiosk', 'Customers order and pay on a tablet.']]],
    ['Kitchen', [['kitchenScreen', 'Kitchen screen', 'Cooks tap Accept / Preparing / Ready. No screen? The kitchen works from paper.']]],
    ['Printers', [['kitchenPrinter', 'Kitchen printer', 'Prints kitchen tickets.'], ['barPrinter', 'Bar printer', 'Separate printer for drinks. Without it, bar tickets print in the kitchen.'], ['cashierPrinter', 'Till / waiter-station printer', 'Prints customer bills and receipts.']]],
  ];
  const DEVICES = DEVICE_GROUPS.flatMap((g) => g[1]);
  const PAPER = [
    ['kotOnSend', 'Print a kitchen ticket whenever an order is sent'], ['waiterSlip', 'Also print a waiter copy (second slip) with every order'], ['slipPrices', 'Show prices on the waiter copy'],
    ['billOnRequest', 'Print the customer bill when it is generated'], ['receiptOnPayment', 'Print the receipt automatically after payment'], ['cancelSlips', 'Print a CANCELLED slip when a sent item is cancelled'],
  ];
  const TYPES = [['DELIVERY', 'Delivery'], ['PICKUP', 'Pickup'], ['TAKEAWAY', 'Take away'], ['COUNTER', 'Counter'], ['DINE_IN', 'Dine-in'], ['BAR_TAB', 'Bar tab']];
  let ops, draft;

  async function renderDevices(my) {
    my = my || token; const t = byId('devices');
    ops = await loadOps(true); if (!current(my)) return;
    if (!ops || !ops.operations) { draw(t, window.HX.empty('Could not load devices', 'Try again in a moment.')); return; }
    const o = ops.operations;
    draft = { preset: o.preset, devices: { ...o.devices }, printing: { ...o.printing }, manual: ((ops.plan && ops.plan.markReadyByHand) || []).slice(), useTables: undefined };
    paintDevices();
  }

  const chk = (id, label, on, hint, extra = '') => `<label class="rs-check"><input type="checkbox" id="${id}" ${on ? 'checked' : ''} ${extra}> <span><b>${E(label)}</b>${hint ? `<small>${E(hint)}</small>` : ''}</span></label>`;

  function paintDevices() {
    const t = byId('devices'), editable = can('restaurant.settings.manage');
    const anyPrinter = draft.devices.kitchenPrinter || draft.devices.barPrinter || draft.devices.cashierPrinter;
    const warn = (ops.warnings || []).map((w) => `<div class="rs-warn ${w.level === 'warning' ? 'warning' : ''}">${E(w.message)}</div>`).join('');
    const presets = (ops.presets || []).map((p) => `<button type="button" class="rs-preset ${draft.preset === p.id ? 'on' : ''}" data-preset="${E(p.id)}" ${editable ? '' : 'disabled'}><b>${E(p.label)}</b><small>${E(p.summary)}</small></button>`).join('');
    const copies = (id, label, cur) => `<label class="field"><span>${label}</span><select class="select" id="${id}">${[1, 2, 3].map((n) => `<option ${+cur === n ? 'selected' : ''}>${n}</option>`).join('')}</select></label>`;
    draw(t, `${warn}
      <div class="rs-card"><h3>1. Pick the set-up closest to yours</h3><p class="rs-desc">A quick start. You can still tick or untick any device below.</p><div class="rs-presets">${presets}</div></div>
      <form id="of" data-track novalidate><fieldset class="rs-fields" ${editable ? '' : 'disabled'}>
        <div class="rs-card"><h3>2. Your devices</h3>${DEVICE_GROUPS.map(([g, items]) => `<div class="rs-sub">${E(g)}</div><div class="rs-checks">${items.map(([k, l, h]) => chk('d-' + k, l, draft.devices[k], h)).join('')}</div>`).join('')}</div>
        <div class="rs-card"><h3>3. Paper</h3>${anyPrinter ? `<div class="rs-checks">${PAPER.map(([k, l]) => chk('p-' + k, l, draft.printing[k])).join('')}</div>
          <div class="rs-grid three" style="margin-top:var(--space-3)">${copies('p-kotCopies', 'Kitchen ticket copies', draft.printing.kotCopies)}${copies('p-receiptCopies', 'Receipt copies', draft.printing.receiptCopies)}
          <label class="field"><span>Paper width</span><select class="select" id="p-paperWidthMm">${[58, 80].map((n) => `<option value="${n}" ${+draft.printing.paperWidthMm === n ? 'selected' : ''}>${n} mm</option>`).join('')}</select></label></div>` : '<p class="rs-desc">No printer ticked: everything works on screens. Tick a printer above to use paper.</p>'}</div>
        ${draft.devices.kitchenScreen ? '' : `<div class="rs-card"><h3>4. No kitchen screen: which orders are marked READY by hand?</h3><p class="rs-desc">Dine-in food counts as ready when sent (the waiter collects it). These types wait until staff tap <b>Mark ready</b>:</p><div class="rs-pills">${TYPES.map(([k, l]) => `<label class="rs-check"><input type="checkbox" data-mr="${k}" ${draft.manual.includes(k) ? 'checked' : ''}> ${l}</label>`).join('')}</div></div>`}
        <div class="rs-card"><h3>Also</h3><div class="rs-checks">${chk('o-useTables', 'Use table management (choose a table for dine-in orders)', undefined, 'Left as it is until you tick or untick it.')}</div></div></fieldset>
        <div class="rs-savebar">${editable ? '<button class="btn btn-primary" type="submit">Save set-up</button><button class="btn btn-secondary" type="button" data-reset>Discard changes</button><span class="grow">Safe to change any day: nothing is deleted and open orders keep working.</span>' : '<span class="grow">Only the owner or a manager can change this.</span>'}</div></form>
      <div style="height:var(--space-4)"></div>${stations()}${channels()}${advice()}${queue()}`);
    wireDevices(editable);
  }

  function stations() {
    const s = ops.printStations || []; if (!s.length) return '';
    return `<details class="rs-det" open><summary>Printer devices: what to switch on</summary><div><p class="rs-desc">On each printer's PC or tablet tap the <b>Auto-print</b> chip (bottom-left), choose the printer below and keep the page open. Use Chrome with <b>--kiosk-printing</b>.</p>${s.map((x) => `<div class="rs-row"><div class="grow"><b>${E(x.printer)}</b> → choose <b>${E(x.choose)}</b><small>${E(x.where)}</small><small>${(x.prints || []).map(E).join(' · ')}</small></div></div>`).join('')}<div style="margin-top:var(--space-3)"><button class="btn btn-secondary" id="ap" type="button">Set up auto-print on THIS device</button></div></div></details>`;
  }
  function channels() {
    const c = ops.channels || []; if (!c.length) return '';
    return `<details class="rs-det"><summary>How each kind of order reaches your kitchen</summary><div>${c.map((x) => `<div class="rs-row"><div class="grow"><b>${E(x.label)}</b>${x.available === false ? ' <small style="display:inline">(not switched on)</small>' : ''}<small>Kitchen sees it ${E(x.kitchenSees)}${x.readyBy === 'MANUAL' ? ' · staff tap Mark ready' : x.readyBy === 'AUTO' ? ' · ready when sent' : ''}${x.note ? ' · ' + E(x.note) : ''}</small></div></div>`).join('')}</div></details>`;
  }
  function advice() {
    const a = ops.advice || []; if (!a.length) return '';
    return `<details class="rs-det"><summary>How to run your restaurant with what you have</summary><div>${a.map((x) => `<h5 style="margin:var(--space-3) 0 4px">${E(x.title)}</h5><ul>${(x.steps || []).map((s) => `<li>${E(s)}</li>`).join('')}</ul>`).join('')}</div></details>`;
  }
  function queue() {
    const q = ops.queue || {}, k = Object.keys(q); if (!k.length) return '';
    return `<details class="rs-det"><summary>Paper waiting</summary><div>${k.map((n) => `<div class="rs-row"><div class="grow">${E(n)}</div><span>${q[n].pending} waiting · oldest ${q[n].oldestMinutes} min</span></div>`).join('')}</div></details>`;
  }

  function readDevices() {
    const q = (id) => body.querySelector('#' + id);
    for (const [k] of DEVICES) { const i = q('d-' + k); if (i) draft.devices[k] = i.checked; }
    for (const [k] of PAPER) { const i = q('p-' + k); if (i) draft.printing[k] = i.checked; }
    ['kotCopies', 'receiptCopies', 'paperWidthMm'].forEach((k) => { const i = q('p-' + k); if (i) draft.printing[k] = Number(i.value); });
    const mr = [...body.querySelectorAll('[data-mr]')]; if (mr.length) draft.manual = mr.filter((x) => x.checked).map((x) => x.dataset.mr);
    const u = q('o-useTables'); if (u && u.dataset.touched) draft.useTables = u.checked;
  }

  function wireDevices(editable) {
    const u = body.querySelector('#o-useTables');
    if (u) { if (draft.useTables === undefined) u.indeterminate = true; else { u.checked = draft.useTables; u.dataset.touched = '1'; } u.addEventListener('change', () => { u.dataset.touched = '1'; u.indeterminate = false; }); }
    body.querySelectorAll('[data-preset]').forEach((b) => b.addEventListener('click', () => {
      const p = (ops.presets || []).find((x) => x.id === b.dataset.preset); if (!p) return;
      readDevices(); draft.preset = p.id; draft.devices = { ...p.devices }; draft.printing = { ...draft.printing, ...p.printing };
      draft.manual = p.devices.kitchenScreen ? [] : (draft.manual.length ? draft.manual : ['DELIVERY', 'PICKUP', 'TAKEAWAY', 'COUNTER']); setDirty(true); paintDevices();
    }));
    body.querySelectorAll('[id^="d-"]').forEach((i) => i.addEventListener('change', () => { readDevices(); draft.preset = 'CUSTOM'; setDirty(true); paintDevices(); }));
    body.querySelector('#ap')?.addEventListener('click', () => window.HXAutoPrint && window.HXAutoPrint.dialog());
    body.querySelector('[data-reset]')?.addEventListener('click', () => { setDirty(false); go('devices', true); });
    body.querySelector('#of')?.addEventListener('submit', async (e) => {
      e.preventDefault(); if (!editable) return; readDevices();
      const out = { devices: draft.devices, printing: draft.printing };
      if (draft.preset && draft.preset !== 'CUSTOM') out.preset = draft.preset;
      if (!draft.devices.kitchenScreen) out.ready = { manualOrderTypes: draft.manual };
      if (draft.useTables !== undefined) out.useTables = draft.useTables;
      const btn = e.currentTarget.querySelector('[type=submit]'); window.UI.setButtonLoading(btn, true, 'Saving…');
      const r = await send('put', '/restaurant/operations', out); window.UI.setButtonLoading(btn, false);
      if (r) { setDirty(false); (r.notes || []).forEach((n) => window.UI.toast.info(n)); window.UI.toast.success('Set-up saved'); setTimeout(() => location.reload(), 900); }   // reload: the sidebar hides screens the restaurant has no device for
    });
  }

  /* ------------------------------------------------------------------ System check (no server address is ever shown) */
  const CHECKS = [
    ['Business profile', '/business/profile', null, null],
    ['Restaurant settings', '/restaurant/settings', 'restaurantOrdering'],
    ['Stations', '/restaurant/stations', 'restaurantOrdering', { branch: 1 }],
    ['Tables', '/restaurant/tables', 'tableManagement', { branch: 1 }],
    ['Menu (waiter view)', '/restaurant/menu', 'restaurantOrdering', { branch: 1, extra: { orderType: 'DINE_IN' } }],
    ['Dishes list', '/restaurant/menu/items', 'restaurantOrdering', { extra: { limit: 100 } }],
    ['Open orders', '/restaurant/orders', 'restaurantOrdering', { branch: 1, extra: { status: 'OPEN', limit: 20 } }],
    ['Kitchen queue', '/restaurant/kitchen/queue', 'kitchenDisplay', { branch: 1 }],
    ['Bills', '/restaurant/bills', 'restaurantOrdering', { branch: 1, extra: { limit: 20 } }],
    ['Guest requests', '/restaurant/guest/requests', 'guestQrOrdering', { branch: 1 }],
    ['QR codes (tables)', '/restaurant/qr', 'guestQrOrdering', { branch: 1, extra: { kind: 'TABLE' }, qr: 1 }],
    ['Accommodation settings', '/accommodation/settings', 'accommodation'],
    ['Room types', '/accommodation/room-types', 'accommodation'],
    ['Room board', '/accommodation/board', 'accommodation', { branch: 1 }],
    ['Front desk', '/accommodation/desk', 'accommodation', { branch: 1 }],
    ['Housekeeping tasks', '/accommodation/housekeeping/tasks', 'accommodation', { branch: 1 }],
    ['Employees (workers)', '/employees', null, { extra: { limit: 10 } }],
  ];
  const WHY = {
    FEATURE_DISABLED: 'Service is switched off for this business. Turn it on in Services.',
    PERMISSION_DENIED: 'Your role does not have permission. Ask the owner.',
    ROUTE_NOT_FOUND: 'The server has no such route: it is an OLD deployment. Redeploy the updated backend.',
    NETWORK_ERROR: 'Cannot reach the server. Check your internet connection or whether the server is awake.',
    BRANCH_ACCESS_DENIED: 'You are not assigned to this branch. Assign it in Employees.',
    VALIDATION_ERROR: 'The server rejected the request details.',
  };

  function renderCheck() {
    const t = byId('check');
    draw(t, `<div class="rs-card"><h3>Run a full check</h3><p class="rs-desc">Reads every restaurant and accommodation screen's data from the server. Nothing is changed.</p>
      <button class="btn btn-primary" type="button" id="runchk">Run system check</button><div id="chk" style="margin-top:var(--space-3)"></div></div>`);
    body.querySelector('#runchk').addEventListener('click', runCheck);
  }

  async function runCheck() {
    const my = token, out = body.querySelector('#chk'), btn = body.querySelector('#runchk'); window.UI.setButtonLoading(btn, true, 'Checking…');
    const rows = [], branchId = window.HX.branchId();
    const root = window.APP_CONFIG.API_BASE_URL.replace(/\/api\/v1\/?$/, '');
    try { const r = await fetch(root + '/health', { cache: 'no-store' }); const j = await r.json(); rows.push(['Server online', j.status === 'ok' ? 'ok' : 'bad', j.status === 'ok' ? `Database: ${j.database}` : 'The server answered but is not healthy']); }
    catch { rows.push(['Server online', 'bad', 'Cannot reach the server (asleep, offline or blocked)']); }
    rows.push(['Branch selected', branchId ? 'ok' : 'bad', branchId ? 'Active branch found' : 'No branch on this user: assign a branch in Employees']);
    const fl = { ...flags };
    for (const [label, path, feat, o] of CHECKS) {
      if (feat && !fl[feat]) { rows.push([label, 'skip', 'Service switched off']); continue; }
      const q = { ...(o && o.branch ? { branchId } : {}), ...((o && o.extra) || {}) };
      try {
        const { data } = await window.Api.get(path, q); let note = 'Works', st = 'ok';
        if (o && o.qr) { const c = list(data, 'codes', 'qr')[0]; if (!c) note = 'Works (no tables yet)'; else if (/^https?:/.test(c.url)) note = 'Works, QR links are full web addresses'; else { st = 'warn'; note = 'Works, but the QR link is not a full address: set GUEST_APP_URL / FRONTEND_URL on the backend (the app also fixes this itself when printing)'; } }
        rows.push([label, st, note]);
      } catch (e) { rows.push([label, 'bad', `${(e && e.code && WHY[e.code]) || (e && e.message) || 'Failed'} [${(e && e.status) || ''} ${(e && e.code) || ''}]`]); }
    }
    window.UI.setButtonLoading(btn, false);
    if (!current(my) || !out.isConnected) return;
    const bad = rows.filter((r) => r[1] === 'bad').length, warn = rows.filter((r) => r[1] === 'warn').length;
    out.innerHTML = `<p class="rs-chk-sum ${bad ? 'bad' : 'ok'}">${bad ? bad + ' problem(s) found' : 'Everything checked works'}${warn ? ` · ${warn} warning(s)` : ''}</p><div class="rs-card flush" style="max-width:none;margin:0"><table class="hx-chk">${rows.map(([l, s, n]) => `<tr><td>${s === 'ok' ? '✅' : s === 'bad' ? '❌' : s === 'warn' ? '⚠️' : '➖'}</td><td><b>${E(l)}</b></td><td class="rs-desc" style="margin:0">${E(n)}</td></tr>`).join('')}</table></div>`;
  }
})();
