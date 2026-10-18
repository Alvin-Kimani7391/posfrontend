/**
 * hx-services.js - Services & system check (owner).
 *   1. Switch services on/off: restaurant, tables, kitchen screen, recipes, reservations, guest QR ordering, ROOMS & STAYS.
 *   2. Staff: which worker roles become available (waiter, chef, receptionist, housekeeper...) and where to add them.
 *   3. Backend address (which server this app talks to).
 *   4. System check: calls every restaurant / accommodation endpoint and says exactly why one fails.
 * API: PUT /business { businessType, featureSettings }, GET /business/profile, GET /employees, and read-only checks.
 */
(function () {
  const { E, can, get, list, head } = window.HX;
  let el, flags = {};
  document.addEventListener('DOMContentLoaded', init);

  const SERVICES = [
    ['restaurantOrdering', 'Restaurant ordering', 'Master switch: take orders, send to kitchen, bill and pay. Needed for everything below it.'],
    ['tableManagement', 'Tables & floor', 'Open orders against tables and see the floor at a glance.'],
    ['kitchenDisplay', 'Kitchen & bar screen', 'Tickets and timers for chefs and bartenders.'],
    ['recipeManagement', 'Recipes & ingredients', 'Deduct ingredients per dish, track food cost and waste.'],
    ['reservations', 'Reservations', 'Book tables ahead, take deposits.'],
    ['guestQrOrdering', 'Guest QR ordering', 'QR codes on tables and rooms: guests see the menu, order and call a waiter.'],
    ['accommodation', 'Rooms & stays (accommodation)', 'Room types, rooms, bookings, check-in / check-out, guest folios, housekeeping and front desk.'],
  ];
  const ROLE_INFO = [
    ['restaurantOrdering', 'Waiter, Head waiter, Supervisor, Chef, Kitchen staff, Bartender, Expeditor, Delivery rider'],
    ['accommodation', 'Receptionist, Housekeeper'],
  ];

  async function init() {
    el = window.HX.mount('Services & system check'); if (!el) return;
    await window.AppShell.whenProfileReady?.(); await window.AppShell.refreshBusinessProfile?.();
    const p = window.AppShell.getBusinessProfile() || {}; flags = { ...(p.featureSettings || {}) };
    paint();
  }

  function paint() {
    const p = window.AppShell.getBusinessProfile() || {}; const BT = window.BusinessTypes;
    const mayEdit = can('settings.update');
    el.innerHTML = head('Services & system check', 'Turn services on, add staff, point the app at your backend and test everything.') + `
      <div class="hx-card"><h3>Services</h3><p class="hx-sub">Switch on what this business offers. Menus and screens appear immediately after saving.${mayEdit ? '' : ' <b>Only the owner can change these.</b>'}</p>
        <div class="hx-svc">${SERVICES.map(([k, l, d]) => `<label class="hx-svc-row ${flags[k] ? 'on' : ''}"><span class="hx-switch"><input type="checkbox" data-f="${k}" ${flags[k] ? 'checked' : ''} ${mayEdit ? '' : 'disabled'}><i></i></span><span><b>${E(l)}</b><small>${E(d)}</small></span></label>`).join('')}</div>
        ${mayEdit ? '<div class="hx-actions" style="margin-top:var(--space-3)"><button class="btn btn-primary" id="savesvc">Save services</button></div>' : ''}
        <div id="svcnext"></div></div>
      <div class="hx-card"><h3>Staff &amp; workers</h3><p class="hx-sub">Add workers in <b>Employees</b>. Roles you can pick depend on the services above.</p>
        <div id="staffbox"><p class="hx-sub">Loading…</p></div>
        <div class="hx-actions" style="margin-top:var(--space-3)"><a class="btn btn-primary" href="employees.html">Add a worker</a><a class="btn btn-secondary" href="hx-setup.html">Setup guide</a></div></div>
      <div class="hx-card"><h3>Backend address</h3><p class="hx-sub">This app is talking to:</p><p><code class="hx-mono" id="apiNow">${E(window.APP_CONFIG.API_BASE_URL)}</code></p>
        <div class="hx-form"><div class="field"><label for="apiIn">Use a different backend (must end with /api/v1)</label><input class="input" id="apiIn" placeholder="https://your-backend.onrender.com/api/v1" value="${E(localStorage.getItem('pos.apiBase') || '')}"></div></div>
        <div class="hx-actions"><button class="btn btn-secondary" id="apiSave">Use this address</button><button class="btn btn-secondary" id="apiReset">Reset to default</button></div></div>
      <div class="hx-card"><h3>System check</h3><p class="hx-sub">Tests every restaurant and accommodation screen against the backend and tells you what is wrong.</p>
        <div class="hx-actions"><button class="btn btn-primary" id="runchk">Run system check</button></div><div id="chk" style="margin-top:var(--space-3)"></div></div>`;
    el.querySelectorAll('[data-f]').forEach((c) => c.addEventListener('change', () => {
      const on = c.checked; flags = BT && BT.applyToggle ? BT.applyToggle(flags, c.dataset.f, on, p.businessType) : { ...flags, [c.dataset.f]: on };
      el.querySelectorAll('[data-f]').forEach((x) => { x.checked = !!flags[x.dataset.f]; x.closest('.hx-svc-row').classList.toggle('on', !!flags[x.dataset.f]); });
    }));
    el.querySelector('#savesvc')?.addEventListener('click', save);
    el.querySelector('#apiSave').addEventListener('click', () => { const v = el.querySelector('#apiIn').value.trim().replace(/\/+$/, ''); if (!/^https?:\/\/.+/.test(v)) return window.UI.toast.warning('Enter a full address starting with https://'); localStorage.setItem('pos.apiBase', v); location.reload(); });
    el.querySelector('#apiReset').addEventListener('click', () => { localStorage.removeItem('pos.apiBase'); location.reload(); });
    el.querySelector('#runchk').addEventListener('click', runCheck);
    staff();
  }

  async function save() {
    const p = window.AppShell.getBusinessProfile() || {}; const BT = window.BusinessTypes; const btn = el.querySelector('#savesvc');
    const type = p.businessType || 'restaurant';
    const full = Object.fromEntries(BT.featureKeys().map((k) => [k, !!flags[k]]));
    (BT.lockedFor(type) || []).forEach((k) => { full[k] = true; });
    window.UI.setButtonLoading(btn, true, 'Saving…');
    try {
      await window.Api.put('/business', { businessType: type, featureSettings: full });
      await window.AppShell.refreshBusinessProfile?.();
      window.UI.toast.success('Services saved');
      flags = { ...(window.AppShell.getBusinessProfile() || {}).featureSettings };
      paint();
      el.querySelector('#svcnext').innerHTML = `<div class="hx-note">${flags.accommodation ? 'Rooms &amp; stays are ON. Next: <a href="hx-setup.html">add room types and rooms in the Setup guide</a>, then <a href="employees.html">add a Receptionist and Housekeepers</a>.' : 'Saved.'} ${flags.restaurantOrdering ? 'Then add tables and dishes in the <a href="hx-setup.html">Setup guide</a>.' : ''}</div>`;
    } catch (e) { window.UI.toast.error((e && e.message) || 'Could not save'); window.UI.setButtonLoading(btn, false); }
  }

  async function staff() {
    const box = el.querySelector('#staffbox');
    const d = await get('/employees', { limit: 100 }); const rows = list(d, 'employees');
    const by = {}; rows.forEach((u) => { by[u.role] = (by[u.role] || 0) + 1; });
    box.innerHTML = `<div class="hx-chiprow">${Object.keys(by).length ? Object.entries(by).map(([r, n]) => `<span class="badge role-badge role-${E(r)}">${E(r.replace('_', ' '))} · ${n}</span>`).join(' ') : '<span class="hx-sub">No staff yet.</span>'}</div>` +
      ROLE_INFO.map(([k, r]) => `<p class="hx-sub" style="margin-top:var(--space-2)"><b>${flags[k] ? 'Available' : 'Switch on the service first'}:</b> ${E(r)}</p>`).join('');
  }

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
    FEATURE_DISABLED: 'Service is switched off for this business. Turn it on above.',
    PERMISSION_DENIED: 'Your role does not have permission. Ask the owner.',
    ROUTE_NOT_FOUND: 'The backend has no such route: it is an OLD deployment. Redeploy the updated backend.',
    NETWORK_ERROR: 'Cannot reach the backend. Check the address, internet, or that the server is awake.',
    BRANCH_ACCESS_DENIED: 'You are not assigned to this branch. Assign it in Employees.',
    VALIDATION_ERROR: 'The backend rejected the request details.',
  };

  async function runCheck() {
    const out = el.querySelector('#chk'); const btn = el.querySelector('#runchk'); window.UI.setButtonLoading(btn, true, 'Checking…');
    const rows = []; const branchId = window.HX.branchId();
    const root = window.APP_CONFIG.API_BASE_URL.replace(/\/api\/v1\/?$/, '');
    try { const r = await fetch(root + '/health', { cache: 'no-store' }); const j = await r.json(); rows.push(['Backend online', j.status === 'ok' ? 'ok' : 'bad', j.status === 'ok' ? `Database: ${j.database}` : 'Backend answered but is not healthy']); }
    catch { rows.push(['Backend online', 'bad', 'Cannot reach ' + root + ' (server asleep, wrong address, or blocked)']); }
    rows.push(['Branch selected', branchId ? 'ok' : 'bad', branchId ? 'Active branch found' : 'No branch on this user: assign a branch in Employees']);
    for (const [label, path, feat, o] of CHECKS) {
      if (feat && !flags[feat]) { rows.push([label, 'skip', 'Service switched off']); continue; }
      const q = { ...(o && o.branch ? { branchId } : {}), ...((o && o.extra) || {}) };
      try {
        const { data } = await window.Api.get(path, q); let note = 'Works';
        if (o && o.qr) { const c = list(data, 'codes', 'qr')[0]; if (c) note = /^https?:/.test(c.url) ? 'Works, QR links are full web addresses' : 'Works, but the QR link is not a full address: set GUEST_APP_URL / FRONTEND_URL on the backend (the app also fixes this itself when printing)'; else note = 'Works (no tables yet)'; }
        rows.push([label, o && o.qr && !/^https?:/.test((list(data, 'codes', 'qr')[0] || {}).url || 'http:') ? 'warn' : 'ok', note]);
      } catch (e) { rows.push([label, 'bad', `${(e && e.code && WHY[e.code]) || (e && e.message) || 'Failed'} [${(e && e.status) || ''} ${(e && e.code) || ''}]`]); }
    }
    window.UI.setButtonLoading(btn, false);
    const bad = rows.filter((r) => r[1] === 'bad').length;
    out.innerHTML = `<p class="${bad ? 'hx-chk-bad' : 'hx-chk-ok'}"><b>${bad ? bad + ' problem(s) found' : 'Everything checked works'}</b></p><div class="hx-card flush"><table class="hx-chk">${rows.map(([l, s, n]) => `<tr><td>${s === 'ok' ? '✅' : s === 'bad' ? '❌' : s === 'warn' ? '⚠️' : '➖'}</td><td><b>${E(l)}</b></td><td class="hx-sub">${E(n)}</td></tr>`).join('')}</table></div>`;
  }
})();
