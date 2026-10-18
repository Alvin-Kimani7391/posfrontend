/**
 * hx-settings.js - service settings. Three tabs, only the ones this business has:
 *   Restaurant   PUT /restaurant/settings      (service charge, tax, tips, discounts, kitchen, reservations)
 *   Guest QR     PUT /restaurant/settings      (guestOrdering block)
 *   Rooms        PUT /accommodation/settings   (check-in / check-out times, stay rules, deposit)
 * Only fields the backend schema accepts are sent (the restaurant schema is strict).
 */
(function () {
  const { E, can, feature, get, send, head, fieldHtml } = window.HX;
  let el, tab, cache = {};
  document.addEventListener('DOMContentLoaded', init);

  const dig = (o, path) => path.split('.').reduce((a, k) => (a == null ? undefined : a[k]), o);
  const put = (o, path, v) => { const ks = path.split('.'); ks.slice(0, -1).reduce((a, k) => (a[k] = a[k] || {}), o)[ks.pop()] = v; };

  const MODES = [['OFF', 'Off'], ['MENU_ONLY', 'Menu only'], ['ORDER_CONFIRM', 'Order, staff confirm'], ['ORDER_AUTO', 'Order, auto accept']];
  const SPEC = {
    restaurant: [
      { h: 'Service charge and tax' },
      { name: 'serviceCharge.enabled', label: 'Add a service charge to bills', type: 'checkbox' },
      { row: [{ name: 'serviceCharge.percent', label: 'Service charge %', type: 'number', min: 0, max: 100, step: '0.1' }, { name: 'serviceCharge.taxRate', label: 'Tax rate %', type: 'number', min: 0, max: 100, step: '0.1' }] },
      { h: 'Tips' },
      { name: 'tips.enabled', label: 'Accept tips on bills', type: 'checkbox' },
      { name: 'tips.mode', label: 'How tips are shared', type: 'select', options: [['INDIVIDUAL', 'Each waiter keeps their own'], ['POOL', 'Pooled across staff']] },
      { h: 'Discounts (maximum % each role may give)' },
      { row: [{ name: 'discounts.waiterMaxPercent', label: 'Waiter', type: 'number', min: 0, max: 100 }, { name: 'discounts.cashierMaxPercent', label: 'Cashier', type: 'number', min: 0, max: 100 }] },
      { row: [{ name: 'discounts.supervisorMaxPercent', label: 'Supervisor', type: 'number', min: 0, max: 100 }, { name: 'discounts.managerMaxPercent', label: 'Manager', type: 'number', min: 0, max: 100 }] },
      { h: 'Kitchen and floor' },
      { name: 'kitchenDelayMinutes', label: 'Mark a ticket late after (minutes)', type: 'number', min: 1, max: 240 },
      { name: 'requireTableCleaning', label: 'Tables need cleaning before they can be seated again', type: 'checkbox' },
      { name: 'paymentsRequireShift', label: 'Cash payments need an open cash shift', type: 'checkbox' },
      { name: 'hideOutOfStockItems', label: 'Hide sold-out dishes from waiters', type: 'checkbox' },
      { h: 'Reservations' },
      { row: [{ name: 'reservation.durationMinutes', label: 'Default length (minutes)', type: 'number', min: 15, max: 600 }, { name: 'reservation.holdMinutes', label: 'Hold table for late guests (minutes)', type: 'number', min: 0, max: 120 }] },
      { name: 'reservation.depositRequired', label: 'Ask for a deposit', type: 'checkbox' },
    ],
    guest: [
      { h: 'QR ordering' },
      { row: [{ name: 'guestOrdering.tableMode', label: 'At tables', type: 'select', options: MODES }, { name: 'guestOrdering.roomMode', label: 'In rooms', type: 'select', options: MODES }] },
      { name: 'guestOrdering.showPrices', label: 'Show prices to guests', type: 'checkbox' },
      { name: 'guestOrdering.allowNotes', label: 'Let guests add notes to dishes', type: 'checkbox' },
      { name: 'guestOrdering.allowBillRequest', label: 'Let guests ask for the bill', type: 'checkbox' },
      { name: 'guestOrdering.requireName', label: 'Ask for the guest’s name', type: 'checkbox' },
      { name: 'guestOrdering.requirePhone', label: 'Ask for the guest’s phone', type: 'checkbox' },
      { row: [{ name: 'guestOrdering.maxItemsPerRequest', label: 'Max dishes per request', type: 'number', min: 1, max: 100 }, { name: 'guestOrdering.requestExpiryMinutes', label: 'Request expires after (min)', type: 'number', min: 2, max: 240 }] },
      { name: 'guestOrdering.welcomeMessage', label: 'Welcome message', type: 'textarea' },
    ],
    rooms: [
      { h: 'Times' },
      { row: [{ name: 'checkIn.time', label: 'Check-in from', type: 'time' }, { name: 'checkOut.time', label: 'Check-out by', type: 'time' }] },
      { name: 'lateCheckOut.allowed', label: 'Allow late check-out (fees apply)', type: 'checkbox' },
      { name: 'lateCheckOut.graceMinutes', label: 'Free grace period (minutes)', type: 'number', min: 0, max: 240 },
      { name: 'earlyCheckIn.allowed', label: 'Allow early check-in (fees apply)', type: 'checkbox' },
      { h: 'Stay rules' },
      { row: [{ name: 'stay.minNights', label: 'Minimum nights', type: 'number', min: 1 }, { name: 'stay.maxNights', label: 'Maximum nights', type: 'number', min: 1 }] },
      { name: 'stay.requireIdAtCheckIn', label: 'Require guest ID at check-in', type: 'checkbox' },
      { name: 'stay.requirePhone', label: 'Require a phone number', type: 'checkbox' },
      { name: 'stay.allowOverrideRate', label: 'Let staff change the nightly rate', type: 'checkbox' },
      { h: 'Deposit' },
      { name: 'deposit.required', label: 'Ask for a deposit on booking', type: 'checkbox' },
      { row: [{ name: 'deposit.type', label: 'Deposit type', type: 'select', options: [['FIRST_NIGHT', 'First night'], ['PERCENT', 'Percent of stay'], ['FLAT', 'Fixed amount']] }, { name: 'deposit.value', label: 'Value', type: 'number', min: 0, step: '0.01' }] },
    ],
  };
  const SOURCE = { restaurant: 'restaurant', guest: 'restaurant', rooms: 'accommodation' };
  const PATH = { restaurant: '/restaurant/settings', guest: '/restaurant/settings', rooms: '/accommodation/settings' };

  async function init() {
    el = window.HX.mount('Service settings');
    if (!el) return;
    await window.AppShell.whenProfileReady?.();
    const tabs = available();
    if (!tabs.length) { el.innerHTML = head('Service settings') + window.UI.emptyStateHtml({ icon: 'lock', title: 'No settings for you', message: 'Ask the owner or a manager.' }); return; }
    tab = tabs.find((t) => t[0] === location.hash.slice(1))?.[0] || tabs[0][0];
    show();
  }

  function available() {
    const t = [];
    if (feature('restaurantOrdering') && can('restaurant.settings.view')) t.push(['restaurant', 'Restaurant']);
    if (feature('guestQrOrdering') && can('restaurant.settings.view')) t.push(['guest', 'Guest QR ordering']);
    if (feature('accommodation') && can('accommodation.settings.view')) t.push(['rooms', 'Rooms and front desk']);
    return t;
  }

  async function show() {
    const tabs = available();
    el.innerHTML = head('Service settings', 'Changes apply to everyone straight away.') +
      `<div class="hx-cats hx-tabs">${tabs.map(([k, l]) => `<button class="hx-chip ${k === tab ? 'on' : ''}" data-tab="${k}">${E(l)}</button>`).join('')}</div><div id="hx-set"><div class="hx-card"><p class="hx-sub">Loading…</p></div></div>`;
    el.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => { tab = b.dataset.tab; history.replaceState(null, '', '#' + tab); show(); }));
    const src = SOURCE[tab];
    if (!cache[src]) { const d = await get(PATH[tab]); cache[src] = (d && (d.settings || d)) || {}; }
    paint(cache[src]);
  }

  function paint(values) {
    const editable = tab === 'rooms' ? can('accommodation.settings.manage') : can('restaurant.settings.manage');
    const fields = SPEC[tab], flat = fields.flatMap((f) => (f.row ? f.row : f.h ? [] : [f]));
    const withVal = (f) => ({ ...f, value: dig(values, f.name) });
    const body = fields.map((f) => (f.h ? `<h4>${E(f.h)}</h4>` : f.row ? `<div class="two">${f.row.map((x) => fieldHtml(withVal(x))).join('')}</div>` : fieldHtml(withVal(f)))).join('');
    const box = el.querySelector('#hx-set');
    box.innerHTML = `<form class="hx-card hx-form" style="max-width:720px" novalidate><fieldset ${editable ? '' : 'disabled'} style="border:0;padding:0;display:grid;gap:var(--space-3)">${body}</fieldset>
      ${editable ? '<div><button class="btn btn-primary" type="submit">Save changes</button></div>' : '<p class="hx-sub">You can view these settings but not change them.</p>'}</form>`;
    const form = box.querySelector('form');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const out = {};
      flat.forEach((f) => {
        const input = form.querySelector(`[name="${f.name}"]`); if (!input) return;
        if (f.type === 'checkbox') return put(out, f.name, input.checked);
        if (input.value === '') return;
        put(out, f.name, f.type === 'number' ? Number(input.value) : input.value);
      });
      const btn = form.querySelector('[type=submit]'); window.UI.setButtonLoading(btn, true, 'Saving…');
      const r = await send('put', PATH[tab], out);
      window.UI.setButtonLoading(btn, false);
      if (r) { delete cache[SOURCE[tab]]; window.UI.toast.success('Settings saved'); }
    });
  }
})();
