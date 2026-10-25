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
      { h: 'Table reservations' },
      { row: [{ name: 'reservation.durationMinutes', label: 'Default length of a booking (minutes)', type: 'number', min: 15, max: 600 }, { name: 'reservation.lockMinutes', label: 'Lock the table before the booking (minutes)', type: 'number', min: 0, max: 480, hint: 'From then on the table shows Reserved and no walk-in can be seated there.' }] },
      { row: [{ name: 'reservation.remindMinutes', label: 'Alert staff before a booking (minutes)', type: 'number', min: 0, max: 1440, hint: '0 = no alert.' }, { name: 'reservation.lateAlertMinutes', label: 'Alert staff when the guest is late by (minutes)', type: 'number', min: 0, max: 120, hint: '0 = no alert.' }] },
      { row: [{ name: 'reservation.holdMinutes', label: 'Release the table if the guest has not come after (minutes)', type: 'number', min: 0, max: 120, hint: 'The booking becomes a no-show and the table is freed. 0 = never release automatically.' }, { name: 'reservation.noShowAction', label: 'If a guest never comes, their prepaid money', type: 'select', options: [['HOLD', 'Is held: a manager decides'], ['FORFEIT', 'Is kept by the business']] }] },
      { row: [{ name: 'reservation.minSpendPerGuestCents', label: 'Minimum food to prepay per guest online (KSh)', type: 'number', min: 0, step: '0.01', scale: 100, hint: '0 = guests may prepay any amount.' }, { name: 'reservation.maxNoShows', label: 'Stop online booking after this many no-shows', type: 'number', min: 0, max: 20, hint: '0 = never stop.' }] },
      { name: 'reservation.depositRequired', label: 'Ask for a table deposit when the guest does not prepay food', type: 'checkbox' },
      { name: 'reservation.depositCents', label: 'Table deposit (KSh)', type: 'number', min: 0, step: '0.01', scale: 100 },
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
    if (feature('restaurantOrdering') && can('restaurant.settings.view')) t.push(['tracking', 'Ingredient tracking']);
    if (feature('guestQrOrdering') && can('restaurant.settings.view')) t.push(['guest', 'Guest QR ordering']);
    if (feature('accommodation') && can('accommodation.settings.view')) t.push(['rooms', 'Rooms and front desk']);
    return t;
  }

  async function show() {
    const tabs = available();
    el.innerHTML = head('Service settings', 'Changes apply to everyone straight away.') +
      `<div class="hx-cats hx-tabs">${tabs.map(([k, l]) => `<button class="hx-chip ${k === tab ? 'on' : ''}" data-tab="${k}">${E(l)}</button>`).join('')}</div><div id="hx-set"><div class="hx-card"><p class="hx-sub">Loading…</p></div></div>`;
    el.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => { tab = b.dataset.tab; history.replaceState(null, '', '#' + tab); show(); }));
    if (tab === 'tracking') return tracking();
    const src = SOURCE[tab];
    if (!cache[src]) { const d = await get(PATH[tab]); cache[src] = (d && (d.settings || d)) || {}; }
    paint(cache[src]);
  }

  /** Ingredient tracking by recipe: the on/off switch, setup progress and how it behaves. GET/PUT /restaurant/tracking */
  async function tracking() {
    const box = el.querySelector('#hx-set'); const d = await get('/restaurant/tracking'); const t = d && d.tracking;
    if (!t) { box.innerHTML = window.HX.empty('Could not load tracking', 'Try again in a moment.'); return; }
    const editable = can('restaurant.settings.manage'), s = t.tracking || {};
    const step = (c) => `<div class="hx-row"><span>${c.done ? '✅' : '⬜'}</span><div class="grow">${E(c.label)}</div></div>`;
    box.innerHTML = `<div class="hx-card" style="max-width:720px;margin-bottom:var(--space-4)"><h4>Track ingredients with recipes</h4>
      <p class="hx-sub" style="margin:var(--space-2) 0 var(--space-3)">${t.enabled ? 'ON: every dish with a recipe takes its ingredients out of stock when sold (oldest batch first), expiry shows in your daily alert, and Profit &amp; loss uses the real cost of what was sold.' : 'OFF: orders do not touch ingredient stock. Profit &amp; loss counts food cost from what you buy (record it as a “Food Purchases” expense). Nothing is deleted when you switch this.'}</p>
      ${editable ? `<button class="btn ${t.enabled ? 'btn-secondary' : 'btn-primary'}" id="tg">${t.enabled ? 'Turn tracking off' : 'Turn tracking on'}</button>` : '<p class="hx-sub">Only the owner can change this.</p>'}</div>
      ${t.enabled ? `<div class="hx-card flush" style="max-width:720px;margin-bottom:var(--space-4)"><div class="hx-row"><div class="grow"><b>Setup progress</b><small class="hx-sub">${t.dishes.withRecipe} of ${t.dishes.total} dishes have a recipe · ${t.ingredients.total} ingredients${t.ingredients.withoutCost ? ` · ${t.ingredients.withoutCost} without a cost` : ''}</small></div><a class="btn btn-sm btn-secondary" href="hx-stock.html">Ingredients</a><a class="btn btn-sm btn-secondary" href="hx-menu.html">Menu</a></div>${(t.checklist || []).map(step).join('')}</div>
      <form class="hx-card hx-form" id="tf" style="max-width:720px" novalidate><fieldset ${editable ? '' : 'disabled'} style="border:0;padding:0;display:grid;gap:var(--space-3)">
        <h4>How it behaves</h4>
        <div class="two">${fieldHtml({ name: 'expiryCriticalDays', label: 'Red alert: expires within (days)', type: 'number', min: 0, max: 365, value: s.expiryCriticalDays })}${fieldHtml({ name: 'expiryWarningDays', label: 'Orange alert: expires within (days)', type: 'number', min: 1, max: 365, value: s.expiryWarningDays })}</div>
        ${fieldHtml({ name: 'autoWriteOffExpired', label: 'Write expired ingredients off automatically', type: 'checkbox', value: s.autoWriteOffExpired, hint: 'Off: they stay on the Batches list until a manager writes them off.' })}
        <div class="two">${fieldHtml({ name: 'targetFoodCostPercent', label: 'Target food cost (% of sales)', type: 'number', min: 1, max: 100, value: s.targetFoodCostPercent })}${fieldHtml({ name: 'costBasis', label: 'Profit & loss counts food cost from', type: 'select', value: s.costBasis, options: [['AUTO', 'Automatic (recipes when tracking is on)'], ['RECIPE', 'Recipes: what was actually used'], ['PURCHASES', 'Purchases: what was bought']] })}</div>
        ${editable ? '<div><button class="btn btn-primary" type="submit">Save changes</button></div>' : ''}</fieldset></form>` : ''}`;
    box.querySelector('#tg')?.addEventListener('click', async (e) => {
      if (t.enabled && !window.confirm('Turn ingredient tracking off? Recipes and stock are kept, but sales will stop deducting ingredients.')) return;
      window.UI.setButtonLoading(e.currentTarget, true, 'Saving…');
      const r = await send('put', '/restaurant/tracking', { enabled: !t.enabled });
      if (r) { window.UI.toast.success(t.enabled ? 'Tracking is off' : 'Tracking is on'); setTimeout(() => location.reload(), 600); } else window.UI.setButtonLoading(e.currentTarget, false);
    });
    box.querySelector('#tf')?.addEventListener('submit', async (e) => {
      e.preventDefault(); const f = e.currentTarget, n = (k) => (f.querySelector(`[name="${k}"]`).value === '' ? undefined : Number(f.querySelector(`[name="${k}"]`).value));
      const body = { tracking: { expiryCriticalDays: n('expiryCriticalDays'), expiryWarningDays: n('expiryWarningDays'), targetFoodCostPercent: n('targetFoodCostPercent'), autoWriteOffExpired: f.querySelector('[name="autoWriteOffExpired"]').checked, costBasis: f.querySelector('[name="costBasis"]').value } };
      Object.keys(body.tracking).forEach((k) => body.tracking[k] === undefined && delete body.tracking[k]);
      const btn = f.querySelector('[type=submit]'); window.UI.setButtonLoading(btn, true, 'Saving…'); const r = await send('put', '/restaurant/tracking', body); window.UI.setButtonLoading(btn, false);
      if (r) window.UI.toast.success('Saved');
    });
  }

  function paint(values) {
    const editable = tab === 'rooms' ? can('accommodation.settings.manage') : can('restaurant.settings.manage');
    const fields = SPEC[tab], flat = fields.flatMap((f) => (f.row ? f.row : f.h ? [] : [f]));
    const withVal = (f) => { const v = dig(values, f.name); return { ...f, value: f.scale && typeof v === 'number' ? v / f.scale : v }; };     // money is stored in cents, shown and typed in KSh
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
