/**
 * hx-storefront.js - the business storefront: ONE QR code that lets anyone order delivery, reserve a table and book a room.
 * API: GET /restaurant/storefront/qr, POST /restaurant/storefront/qr/rotate, GET|PUT /restaurant/settings (storefront block), GET /branches.
 * Money in settings is returned as cents and accepted as KES, so the form shows cents/100 and sends KES.
 */
(function () {
  const { E, can, get, send, list, head } = window.HX;
  let el, st = {}, branches = [], qrInfo = null;
  document.addEventListener('DOMContentLoaded', init);
  const v = (o, p, d = '') => { const x = p.split('.').reduce((a, k) => (a == null ? undefined : a[k]), o); return x == null ? d : x; };
  const kes = (c) => (c ? c / 100 : 0);
  async function init() {
    el = window.HX.mount('Online storefront'); if (!el) return; await window.AppShell.whenProfileReady?.();
    if (!can('restaurant.guest.qr')) { el.innerHTML = head('Online storefront', '') + window.HX.empty('No access', 'Ask the owner or a manager to set up the storefront.'); return; }
    await load(); paint();
  }
  async function load() {
    const [s, q, b] = await Promise.all([get('/restaurant/settings'), get('/restaurant/storefront/qr'), get('/branches', { limit: 100 })]);
    st = (s && (s.settings || s).storefront) || {}; qrInfo = q; branches = list(b, 'branches').filter((x) => x.status !== 'inactive');
  }
  const chk = (id, label, on) => `<label class="hx-check"><input type="checkbox" id="${id}" ${on ? 'checked' : ''}> <span>${E(label)}</span></label>`;
  const num = (id, label, val, extra = '') => `<label>${E(label)}<input type="number" id="${id}" value="${E(val)}" min="0" step="any" ${extra}></label>`;
  const txt = (id, label, val, ph = '') => `<label>${E(label)}<input type="text" id="${id}" value="${E(val)}" placeholder="${E(ph)}"></label>`;
  function paint() {
    const d = st.delivery || {}, t = st.tables || {};
    const loc = (id) => (st.branchLocations || []).find((x) => String(x.branchId) === String(id)) || {};
    // Same proven pattern as the table/room codes: a direct link to a real file (store.html?t=<token>) on THIS site - no dependence on rewrites or on a server-side base URL.
    const tk = qrInfo && (qrInfo.token || String(qrInfo.url || '').split(/\/(?:q|s)\//)[1] || '');
    const url = tk ? location.origin + '/store.html?t=' + encodeURIComponent(tk) : '';
    el.innerHTML = head('Online storefront', 'One QR code for delivery, table reservations and room booking.', '<button class="btn btn-primary" id="save">Save settings</button>') + `
    <div class="hx-card"><h3>Your storefront QR</h3>
      <div style="display:flex;gap:18px;flex-wrap:wrap;align-items:center"><div id="qr" style="background:#fff;padding:10px;border-radius:10px"></div>
      <div style="flex:1;min-width:240px"><p style="word-break:break-all"><a href="${E(url)}" target="_blank" rel="noopener">${E(url || 'Save and enable the storefront to get your link')}</a></p>
      <p class="hx-sub">Print this on menus, receipts, posters and your door. Customers scan it, install the app, then order, reserve and book.</p>
      <div class="hx-actions"><button class="btn btn-secondary" id="cp">Copy link</button><button class="btn btn-secondary" id="pr">Print</button><button class="btn btn-secondary" id="rot">Replace QR (old prints stop working)</button></div></div></div></div>
    <div class="hx-card"><h3>General</h3>${chk('en', 'Storefront is switched on', st.enabled)}${txt('tg', 'Tagline', v(st, 'tagline'), 'Fresh food, delivered')}${txt('wm', 'Welcome message', v(st, 'welcomeMessage'))}<label>Brand colour<input type="color" id="co" value="${E(v(st, 'themeColor', '#0f766e'))}"></label></div>
    <div class="hx-card"><h3>Delivery</h3>${chk('de', 'Offer delivery', d.enabled !== false)}${chk('dp', 'Pause delivery now (we are too busy)', d.paused)}
      <label>New delivery orders<select id="dm"><option value="AUTO" ${d.mode !== 'CONFIRM' ? 'selected' : ''}>Go straight to the kitchen</option><option value="CONFIRM" ${d.mode === 'CONFIRM' ? 'selected' : ''}>Wait for staff to confirm and send</option></select></label>
      <div class="hx-cols">${num('bf', 'Base delivery fee (KSh)', kes(d.baseFeeCents))}${num('pk', 'Extra fee per km (KSh)', kes(d.perKmCents))}${num('mo', 'Minimum order (KSh)', kes(d.minOrderCents))}${num('mr', 'Max distance (km, 0 = no limit)', v(d, 'maxRadiusKm', 0))}</div>
      <div class="hx-cols">${num('mk', 'Minutes per km', v(d, 'minutesPerKm', 3))}${num('bm', 'Extra buffer minutes', v(d, 'bufferMinutes', 10))}${txt('hs', 'Delivery from (HH:MM)', v(d, 'hoursStart'), '08:00')}${txt('he', 'Delivery until (HH:MM)', v(d, 'hoursEnd'), '22:00')}</div></div>
    <div class="hx-card"><h3>Branch locations</h3><p class="hx-sub">Where each branch cooks from. Delivery distance, fee and range are measured from here. Stand at the branch and press the button.</p>
      ${branches.map((b) => { const l = loc(b._id); return `<div class="hx-row" data-b="${b._id}"><div class="grow"><b>${E(b.name)}</b></div><input type="number" step="any" class="la" placeholder="Latitude" value="${E(l.lat ?? '')}" style="width:120px"><input type="number" step="any" class="ln" placeholder="Longitude" value="${E(l.lng ?? '')}" style="width:120px"><button class="btn btn-secondary btn-sm here">Use my location</button><a class="btn btn-secondary btn-sm" target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=${E(l.lat ?? '')},${E(l.lng ?? '')}">View on Google Maps</a></div>`; }).join('') || '<p class="hx-sub">No branches found.</p>'}</div>
    <div class="hx-card"><h3>Table reservations</h3>${chk('te', 'Let customers see free tables and reserve', t.enabled !== false)}
      <div class="hx-cols">${txt('ot', 'Bookings from (HH:MM)', v(t, 'openTime', '10:00'))}${txt('ct', 'Last booking until (HH:MM)', v(t, 'closeTime', '22:00'))}${num('sm', 'Time slot every (minutes)', v(t, 'slotMinutes', 30))}${num('ml', 'Book at least (minutes ahead)', v(t, 'minLeadMinutes', 30))}${num('ma', 'Up to (days ahead)', v(t, 'maxAdvanceDays', 30))}</div>
      <p class="hx-sub">The table deposit is set in <a href="hx-settings.html">Settings → Restaurant → Reservations</a>.</p></div>
    <div class="hx-card"><h3>Rooms</h3>${chk('re', 'Let customers see free rooms and book', v(st, 'rooms.enabled', true) !== false)}<p class="hx-sub">The room deposit is set in <a href="hx-settings.html">Settings → Rooms → Deposit</a>. Online bookings appear in Front desk and Stays.</p></div>
    <div class="hx-card"><h3>Where it shows up</h3><p class="hx-sub"><b>Delivery orders</b> → Delivery &amp; pickup (name, phone, address, Google Maps link, ETA). <b>Table bookings</b> and pre-orders → Reservations. <b>Room bookings</b> and deposits → Front desk. Managers, cashiers and waiters get a notification for each one.</p></div>`;
    draw(url);
    const $ = (s) => el.querySelector(s); const val = (s) => $(s).value;
    $('#cp').onclick = () => { navigator.clipboard?.writeText(url); window.UI.toast.success('Link copied'); };
    $('#pr').onclick = () => { const w = window.open('', '_blank'); if (!w) return window.UI.toast.warning('Allow pop-ups to print'); const svg = window.QREncoder ? window.QREncoder.toSvg(url, { ecl: 'M', border: 1 }) : ''; w.document.write(`<body style="font-family:sans-serif;text-align:center;padding:40px"><h1>${E(qrInfo.businessName)}</h1><p style="font-size:20px">Scan to order delivery, reserve a table or book a room</p><div style="width:600px;max-width:100%;margin:0 auto">${svg}</div><p>${E(url)}</p></body>`); w.document.close(); w.print(); };
    $('#rot').onclick = async () => { if (!confirm('Every printed storefront QR will stop working. Continue?')) return; const r = await send('post', '/restaurant/storefront/qr/rotate'); if (r) { qrInfo = r; paint(); } };
    el.querySelectorAll('.here').forEach((b) => b.addEventListener('click', () => navigator.geolocation.getCurrentPosition((p) => { const row = b.closest('[data-b]'); row.querySelector('.la').value = p.coords.latitude.toFixed(6); row.querySelector('.ln').value = p.coords.longitude.toFixed(6); }, () => window.UI.toast.error('Allow location access first'), { enableHighAccuracy: true })));
    $('#save').onclick = async () => {
      const n = (s) => (val(s) === '' ? undefined : Number(val(s)));
      const body = { storefront: { enabled: $('#en').checked, tagline: val('#tg'), welcomeMessage: val('#wm'), themeColor: val('#co'),
        branchLocations: [...el.querySelectorAll('[data-b]')].filter((r) => r.querySelector('.la').value !== '' && r.querySelector('.ln').value !== '').map((r) => ({ branchId: r.dataset.b, lat: Number(r.querySelector('.la').value), lng: Number(r.querySelector('.ln').value) })),
        delivery: { enabled: $('#de').checked, paused: $('#dp').checked, mode: val('#dm'), baseFeeCents: n('#bf') ?? 0, perKmCents: n('#pk') ?? 0, minOrderCents: n('#mo') ?? 0, maxRadiusKm: n('#mr') ?? 0, minutesPerKm: n('#mk') ?? 3, bufferMinutes: n('#bm') ?? 10, hoursStart: val('#hs'), hoursEnd: val('#he') },
        tables: { enabled: $('#te').checked, openTime: val('#ot'), closeTime: val('#ct'), slotMinutes: n('#sm') ?? 30, minLeadMinutes: n('#ml') ?? 30, maxAdvanceDays: n('#ma') ?? 30 }, rooms: { enabled: $('#re').checked } } };
      const r = await send('put', '/restaurant/settings', body); if (r) { window.UI.toast.success('Storefront saved'); await load(); paint(); }
    };
  }
  function draw(url) { const box = el.querySelector('#qr'); if (!url || !window.QREncoder) { box.textContent = 'QR appears once the link is ready'; return; } box.innerHTML = '<div style="width:340px;max-width:100%">' + window.QREncoder.toSvg(url, { ecl: 'M', border: 1 }) + '</div>'; }
})();