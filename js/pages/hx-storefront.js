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
  const chk = (id, label, on, hint = '') => `<label class="sf-toggle"><input type="checkbox" id="${id}" ${on ? 'checked' : ''}><span class="sf-sw" aria-hidden="true"></span><span class="sf-tt">${E(label)}${hint ? `<small>${E(hint)}</small>` : ''}</span></label>`;
  const fld = (id, label, control, hint = '') => `<div class="field"><label for="${id}">${E(label)}</label>${control}${hint ? `<small class="hx-sub">${E(hint)}</small>` : ''}</div>`;
  const num = (id, label, val, hint = '') => fld(id, label, `<input class="input" type="number" id="${id}" value="${E(val)}" min="0" step="any" inputmode="decimal">`, hint);
  const txt = (id, label, val, ph = '') => fld(id, label, `<input class="input" type="text" id="${id}" value="${E(val)}" placeholder="${E(ph)}">`);
  const sec = (ic, title, sub, body, tone = 'blue') => `<section class="sf-card sf-${tone}"><header><span class="sf-ic">${window.HX.icon(ic)}</span><div><h3>${E(title)}</h3>${sub ? `<p>${sub}</p>` : ''}</div></header><div class="sf-body">${body}</div></section>`;
  function paint() {
    const d = st.delivery || {}, t = st.tables || {};
    const loc = (id) => (st.branchLocations || []).find((x) => String(x.branchId) === String(id)) || {};
    // Same proven pattern as the table/room codes: a direct link to a real file (store.html?t=<token>) on THIS site - no dependence on rewrites or on a server-side base URL.
    const tk = qrInfo && (qrInfo.token || String(qrInfo.url || '').split(/\/(?:q|s)\//)[1] || '');
    const url = tk ? location.origin + '/store.html?t=' + encodeURIComponent(tk) : '';
    el.innerHTML = head('Online storefront', 'One QR code for delivery, table reservations and room booking.', '<button class="btn btn-primary" id="save">Save settings</button>') + `
    <div class="sf-page">
    <section class="sf-hero">
      <div class="sf-qr"><div id="qr" class="sf-qrbox"></div></div>
      <div class="sf-herotxt">
        <h2>Your storefront QR</h2>
        <p class="sf-link">${url ? `<a href="${E(url)}" target="_blank" rel="noopener">${E(url)}</a>` : 'Switch the storefront on and save to get your link.'}</p>
        <p class="hx-sub">Print this on menus, receipts, posters and your door. Customers scan it, install the app, then order, reserve and book.</p>
        <div class="hx-actions"><button class="btn btn-secondary" id="cp">Copy link</button><button class="btn btn-secondary" id="pr">Print</button><button class="btn btn-secondary" id="rot">Replace QR</button></div>
        <small class="hx-sub">Replacing the QR makes every printed copy stop working.</small>
      </div>
    </section>
    <div class="sf-grid">
      ${sec('store', 'General', 'What customers see first.', chk('en', 'Storefront is switched on', st.enabled) + `<div class="sf-two">${txt('tg', 'Tagline', v(st, 'tagline'), 'Fresh food, delivered')}${txt('wm', 'Welcome message', v(st, 'welcomeMessage'))}</div>` + fld('co', 'Brand colour', `<input class="sf-color" type="color" id="co" value="${E(v(st, 'themeColor', '#0f766e'))}">`))}
      ${sec('bike', 'Delivery', 'Fees, range and how new orders are handled.', chk('de', 'Offer delivery', d.enabled !== false) + chk('dp', 'Pause delivery now', d.paused, 'Use this when the kitchen is too busy.') + fld('dm', 'New delivery orders', `<select class="select" id="dm"><option value="AUTO" ${d.mode !== 'CONFIRM' ? 'selected' : ''}>Go straight to the kitchen</option><option value="CONFIRM" ${d.mode === 'CONFIRM' ? 'selected' : ''}>Wait for staff to confirm and send</option></select>`) + fld('dpay', 'How customers pay for delivery', `<select class="select" id="dpay"><option value="MPESA_OR_CASH" ${d.payment !== 'MPESA' ? 'selected' : ''}>M-PESA now, or cash on delivery</option><option value="MPESA" ${d.payment === 'MPESA' ? 'selected' : ''}>M-PESA only (kitchen starts after payment)</option></select>`) + `<div class="sf-grid2">${num('bf', 'Base fee (KSh)', kes(d.baseFeeCents))}${num('pk', 'Extra per km (KSh)', kes(d.perKmCents))}${num('mo', 'Minimum order (KSh)', kes(d.minOrderCents))}${num('mr', 'Max distance (km)', v(d, 'maxRadiusKm', 0), '0 means no limit')}${num('mk', 'Minutes per km', v(d, 'minutesPerKm', 3))}${num('bm', 'Buffer (minutes)', v(d, 'bufferMinutes', 10))}${txt('hs', 'Delivers from', v(d, 'hoursStart'), '08:00')}${txt('he', 'Delivers until', v(d, 'hoursEnd'), '22:00')}</div>`, 'orange')}
      ${sec('utensils', 'Table reservations', 'Customers see free tables and reserve.', chk('te', 'Let customers reserve tables', t.enabled !== false) + chk('trp', 'Pay first to book a table', t.requirePayment !== false, 'A table is only booked once the customer pays by M-PESA (pre-ordered food or the table deposit).') + `<div class="sf-grid2">${txt('ot', 'Bookings from', v(t, 'openTime', '10:00'), '10:00')}${txt('ct', 'Last booking until', v(t, 'closeTime', '22:00'), '22:00')}${num('sm', 'Time slot (minutes)', v(t, 'slotMinutes', 30))}${num('ml', 'Book at least (minutes ahead)', v(t, 'minLeadMinutes', 30))}${num('ma', 'Up to (days ahead)', v(t, 'maxAdvanceDays', 30))}</div><p class="hx-sub">The deposit is set in <a href="hx-settings.html">Settings → Restaurant → Reservations</a>.</p>`, 'purple')}
      ${sec('bed', 'Rooms', 'Customers see free rooms and book.', chk('re', 'Let customers book rooms', v(st, 'rooms.enabled', true) !== false) + '<p class="hx-sub">The deposit is set in <a href="hx-settings.html">Settings → Rooms → Deposit</a>. Online bookings appear in Front desk and Stays.</p>', 'green')}
    </div>
    ${sec('building', 'Branch locations', 'Delivery distance, fee and range are measured from here. Stand at the branch and press “Use my location”.', `<div class="sf-branches">${branches.map((b) => { const l = loc(b._id); return `<div class="sf-branch" data-b="${b._id}"><b>${E(b.name)}</b><div class="sf-two"><input type="number" step="any" class="input la" placeholder="Latitude" aria-label="Latitude" value="${E(l.lat ?? '')}"><input type="number" step="any" class="input ln" placeholder="Longitude" aria-label="Longitude" value="${E(l.lng ?? '')}"></div><div class="hx-actions"><button class="btn btn-secondary btn-sm here">Use my location</button><a class="btn btn-secondary btn-sm" target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=${E(l.lat ?? '')},${E(l.lng ?? '')}">View on Google Maps</a></div></div>`; }).join('') || '<p class="hx-sub">No branches found.</p>'}</div>`, 'slate')}
    ${sec('receipt', 'Where it shows up', '', '<ul class="sf-where"><li><b>Delivery orders</b> go to Delivery &amp; pickup, with name, phone, address, map link and ETA.</li><li><b>Table bookings</b> and pre-orders go to Reservations.</li><li><b>Room bookings</b> and deposits go to Front desk.</li></ul><p class="hx-sub">Managers, cashiers and waiters get a notification for each one.</p>', 'slate')}
    </div>`;
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
        delivery: { enabled: $('#de').checked, paused: $('#dp').checked, mode: val('#dm'), payment: val('#dpay'), baseFeeCents: n('#bf') ?? 0, perKmCents: n('#pk') ?? 0, minOrderCents: n('#mo') ?? 0, maxRadiusKm: n('#mr') ?? 0, minutesPerKm: n('#mk') ?? 3, bufferMinutes: n('#bm') ?? 10, hoursStart: val('#hs'), hoursEnd: val('#he') },
        tables: { enabled: $('#te').checked, requirePayment: $('#trp').checked, openTime: val('#ot'), closeTime: val('#ct'), slotMinutes: n('#sm') ?? 30, minLeadMinutes: n('#ml') ?? 30, maxAdvanceDays: n('#ma') ?? 30 }, rooms: { enabled: $('#re').checked } } };
      const r = await send('put', '/restaurant/settings', body); if (r) { window.UI.toast.success('Storefront saved'); await load(); paint(); }
    };
  }
  function draw(url) {
    const box = el.querySelector('#qr');
    if (!url) { box.innerHTML = '<span class="sf-qrempty">QR appears once the link is ready</span>'; return; }
    if (!window.QREncoder) { box.innerHTML = '<span class="sf-qrempty">The QR script did not load. Refresh the page.</span>'; return; }
    try { box.innerHTML = window.QREncoder.toSvg(url, { ecl: 'M', border: 1, title: 'Storefront QR' }); }
    catch (e) { box.innerHTML = '<span class="sf-qrempty">Could not draw the QR. Copy the link instead.</span>'; }
  }
})();
