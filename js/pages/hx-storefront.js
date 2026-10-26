/**
 * hx-storefront.js - the business storefront: ONE QR code that lets anyone order delivery, reserve a table and book a room.
 * API: GET /restaurant/storefront/qr, POST /restaurant/storefront/qr/rotate, GET|PUT /restaurant/settings (storefront block), GET /branches.
 * Money in settings is returned as cents and accepted as KES, so the form shows cents/100 and sends KES.
 */
(function () {
  const { E, can, get, send, list, head } = window.HX;
  let el, st = {}, branches = [], qrInfo = null, zones = [];
  /* Kenya: 47 counties and their main towns / estates. Built in so the form works offline; the owner can also type any other town. */
  const KE = {
    'Baringo': ['Kabarnet', 'Eldama Ravine', 'Marigat', 'Chemolingot', 'Mogotio'],
    'Bomet': ['Bomet', 'Sotik', 'Longisa', 'Mogogosiek', 'Silibwet'],
    'Bungoma': ['Bungoma', 'Webuye', 'Kimilili', 'Chwele', 'Malakisi', 'Kanduyi', 'Sirisia'],
    'Busia': ['Busia', 'Malaba', 'Port Victoria', 'Funyula', 'Nambale', 'Bumala'],
    'Elgeyo-Marakwet': ['Iten', 'Kapsowar', 'Chebiemit', 'Tambach', 'Kapcherop'],
    'Embu': ['Embu', 'Runyenjes', 'Siakago', 'Kiritiri', 'Manyatta'],
    'Garissa': ['Garissa', 'Dadaab', 'Masalani', 'Modogashe', 'Balambala'],
    'Homa Bay': ['Homa Bay', 'Mbita', 'Oyugis', 'Kendu Bay', 'Ndhiwa', 'Rodi Kopany'],
    'Isiolo': ['Isiolo', 'Merti', 'Garbatulla', 'Kinna'],
    'Kajiado': ['Kitengela', 'Ngong', 'Ongata Rongai', 'Kajiado', 'Kiserian', 'Isinya', 'Namanga', 'Loitokitok', 'Athi River (Kajiado side)'],
    'Kakamega': ['Kakamega', 'Mumias', 'Malava', 'Butere', 'Lugari', 'Matungu', 'Shinyalu'],
    'Kericho': ['Kericho', 'Litein', 'Kipkelion', 'Londiani', 'Sosiot'],
    'Kiambu': ['Thika', 'Ruiru', 'Juja', 'Kiambu', 'Kikuyu', 'Limuru', 'Githunguri', 'Karuri', 'Kahawa Sukari', 'Kahawa Wendani', 'Banana', 'Gatundu', 'Lari', 'Tigoni', 'Ndenderu', 'Kamiti', 'Ruaka'],
    'Kilifi': ['Kilifi', 'Malindi', 'Mtwapa', 'Watamu', 'Mariakani', 'Kaloleni', 'Gede', 'Mazeras', 'Kikambala', 'Takaungu'],
    'Kirinyaga': ['Kerugoya', 'Kutus', 'Sagana', 'Wanguru', 'Kianyaga', 'Baricho'],
    'Kisii': ['Kisii', 'Ogembo', 'Suneka', 'Keroka', 'Nyamache', 'Masimba'],
    'Kisumu': ['Kisumu CBD', 'Ahero', 'Maseno', 'Muhoroni', 'Kondele', 'Nyalenda', 'Awasi', 'Katito', 'Kibos'],
    'Kitui': ['Kitui', 'Mwingi', 'Mutomo', 'Kabati', 'Kyuso', 'Mutito'],
    'Kwale': ['Ukunda', 'Kwale', 'Msambweni', 'Lunga Lunga', 'Diani', 'Kinango', 'Shimba Hills'],
    'Laikipia': ['Nanyuki', 'Nyahururu', 'Rumuruti', 'Dol Dol', 'Naro Moru'],
    'Lamu': ['Lamu', 'Mpeketoni', 'Witu', 'Faza', 'Hindi'],
    'Machakos': ['Machakos', 'Athi River', 'Syokimau', 'Mlolongo', 'Kangundo', 'Tala', 'Matuu', 'Mwala', 'Katani', 'Konza'],
    'Makueni': ['Wote', 'Emali', 'Sultan Hamud', 'Makindu', 'Mtito Andei', 'Kibwezi', 'Kathonzweni'],
    'Mandera': ['Mandera', 'Elwak', 'Rhamu', 'Takaba', 'Lafey'],
    'Marsabit': ['Marsabit', 'Moyale', 'Laisamis', 'North Horr', 'Loiyangalani'],
    'Meru': ['Meru', 'Maua', 'Nkubu', 'Timau', 'Kianjai', 'Mitunguu', 'Chogoria'],
    'Migori': ['Migori', 'Rongo', 'Awendo', 'Isebania', 'Kehancha', 'Uriri', 'Macalder'],
    'Mombasa': ['Mombasa CBD', 'Nyali', 'Bamburi', 'Likoni', 'Changamwe', 'Kisauni', 'Mtongwe', 'Tudor', 'Mikindani', 'Shanzu', 'Mwembe Tayari', 'Port Reitz'],
    "Murang'a": ["Murang'a", 'Kenol', 'Kangari', 'Maragua', 'Kiriani', 'Kandara', 'Makuyu'],
    'Nairobi': ['CBD', 'Westlands', 'Kilimani', 'Kileleshwa', 'Lavington', 'Karen', 'Langata', 'South B', 'South C', 'Parklands', 'Eastleigh', 'Embakasi', 'Donholm', 'Umoja', 'Kasarani', 'Roysambu', 'Zimmerman', 'Githurai', 'Ruaraka', 'Kayole', 'Buruburu', 'Dandora', 'Pangani', 'Muthaiga', 'Gigiri', 'Runda', 'Kitisuru', 'Rongai Road (Nairobi side)', 'Ngong Road', 'Kawangware', 'Dagoretti', 'Kangemi', 'Uthiru', 'Waithaka', 'Industrial Area', 'Upper Hill', 'Madaraka', 'Nairobi West', 'Kibera', 'Mathare', 'Utawala', 'Ruai', 'Njiru', 'JKIA / Syokimau Road', 'Fedha', 'Pipeline', 'Komarock', 'Lang\'ata Road'],
    'Nakuru': ['Nakuru', 'Naivasha', 'Gilgil', 'Molo', 'Njoro', 'Subukia', 'Rongai', 'Bahati', 'Mai Mahiu', 'Elementaita'],
    'Nandi': ['Kapsabet', 'Nandi Hills', 'Mosoriot', 'Kobujoi', 'Chepterit', 'Lessos'],
    'Narok': ['Narok', 'Kilgoris', 'Ololulung\'a', 'Suswa', 'Mulot', 'Maasai Mara (Sekenani)'],
    'Nyamira': ['Nyamira', 'Keroka', 'Nyansiongo', 'Ekerenyo', 'Manga'],
    'Nyandarua': ['Ol Kalou', 'Ndaragwa', 'Engineer', 'Njabini', 'Kinangop', 'Mairo Inya'],
    'Nyeri': ['Nyeri', 'Karatina', 'Othaya', 'Mukurweini', 'Naro Moru', 'Mweiga', 'Chaka'],
    'Samburu': ['Maralal', 'Baragoi', 'Archers Post', 'Wamba', 'Kisima'],
    'Siaya': ['Siaya', 'Bondo', 'Ugunja', 'Usenge', 'Yala', 'Ukwala', 'Sega'],
    'Taita-Taveta': ['Voi', 'Wundanyi', 'Taveta', 'Mwatate', 'Maungu', 'Mbololo'],
    'Tana River': ['Hola', 'Garsen', 'Bura', 'Madogo', 'Kipini'],
    'Tharaka-Nithi': ['Chuka', 'Kathwana', 'Marimanti', 'Chogoria', 'Kibugua'],
    'Trans Nzoia': ['Kitale', 'Kiminini', 'Endebess', 'Cherangany', 'Saboti'],
    'Turkana': ['Lodwar', 'Kakuma', 'Lokichogio', 'Kalokol', 'Lokichar'],
    'Uasin Gishu': ['Eldoret', 'Burnt Forest', 'Turbo', 'Moiben', 'Ziwa', 'Kesses', 'Kapseret', 'Langas'],
    'Vihiga': ['Mbale', 'Luanda', 'Majengo (Vihiga)', 'Chavakali', 'Hamisi', 'Kaimosi'],
    'Wajir': ['Wajir', 'Habaswein', 'Griftu', 'Bute', 'Eldas'],
    'West Pokot': ['Kapenguria', 'Makutano', 'Chepareria', 'Sigor', 'Ortum']
  };
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
    st = (s && (s.settings || s).storefront) || {}; zones = ((st.delivery && st.delivery.zones) || []).map((z) => ({ county: z.county, town: z.town, fee: kes(z.feeCents), active: z.active !== false })); qrInfo = q; branches = list(b, 'branches').filter((x) => x.status !== 'inactive');
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
      ${sec('bike', 'Delivery', 'Fees, range and how new orders are handled.', chk('de', 'Offer delivery', d.enabled !== false) + chk('dp', 'Pause delivery now', d.paused, 'Use this when the kitchen is too busy.') + fld('dm', 'New delivery orders', `<select class="select" id="dm"><option value="AUTO" ${d.mode !== 'CONFIRM' ? 'selected' : ''}>Go straight to the kitchen</option><option value="CONFIRM" ${d.mode === 'CONFIRM' ? 'selected' : ''}>Wait for staff to confirm and send</option></select>`) + fld('dpay', 'How customers pay for delivery', `<select class="select" id="dpay"><option value="MPESA_OR_CASH" ${d.payment !== 'MPESA' ? 'selected' : ''}>M-PESA now, or cash on delivery</option><option value="MPESA" ${d.payment === 'MPESA' ? 'selected' : ''}>M-PESA only (kitchen starts after payment)</option></select>`) + feeBlock(d) + `<div class="sf-grid2">${num('mo', 'Minimum order (KSh)', kes(d.minOrderCents))}${num('mr', 'Max distance (km)', v(d, 'maxRadiusKm', 0), '0 means no limit')}${num('mk', 'Minutes per km', v(d, 'minutesPerKm', 3))}${num('bm', 'Buffer (minutes)', v(d, 'bufferMinutes', 10))}${txt('hs', 'Delivers from', v(d, 'hoursStart'), '08:00')}${txt('he', 'Delivers until', v(d, 'hoursEnd'), '22:00')}</div>`, 'orange')}
      ${sec('utensils', 'Table reservations', 'Customers see free tables and reserve.', chk('te', 'Let customers reserve tables', t.enabled !== false) + chk('trp', 'Pay first to book a table', t.requirePayment !== false, 'A table is only booked once the customer pays by M-PESA (pre-ordered food or the table deposit).') + `<div class="sf-grid2">${txt('ot', 'Bookings from', v(t, 'openTime', '10:00'), '10:00')}${txt('ct', 'Last booking until', v(t, 'closeTime', '22:00'), '22:00')}${num('sm', 'Time slot (minutes)', v(t, 'slotMinutes', 30))}${num('ml', 'Book at least (minutes ahead)', v(t, 'minLeadMinutes', 30))}${num('ma', 'Up to (days ahead)', v(t, 'maxAdvanceDays', 30))}</div><p class="hx-sub">The deposit is set in <a href="hx-restaurant-settings.html#reservations">Restaurant settings → Table reservations</a>.</p>`, 'purple')}
      ${sec('bed', 'Rooms', 'Customers see free rooms and book.', chk('re', 'Let customers book rooms', v(st, 'rooms.enabled', true) !== false) + '<p class="hx-sub">The deposit is set in <a href="hx-restaurant-settings.html#rooms">Restaurant settings → Rooms &amp; front desk → Deposit</a>. Online bookings appear in Front desk and Stays.</p>', 'green')}
    </div>
    <div id="zsec" ${(d.feeMode || 'DISTANCE') === 'ZONE' ? '' : 'hidden'}>${sec('bike', 'Delivery areas and fees', 'Add every county and town you deliver to and the exact fee for each. Customers choose from this list only. A town that is not here cannot be ordered to.', zoneBlock(), 'orange')}</div>
    ${sec('building', 'Branch locations', 'Delivery distance, fee and range are measured from here. Stand at the branch and press “Use my location”.', `<div class="sf-branches">${branches.map((b) => { const l = loc(b._id); return `<div class="sf-branch" data-b="${b._id}"><b>${E(b.name)}</b><div class="sf-two"><input type="number" step="any" class="input la" placeholder="Latitude" aria-label="Latitude" value="${E(l.lat ?? '')}"><input type="number" step="any" class="input ln" placeholder="Longitude" aria-label="Longitude" value="${E(l.lng ?? '')}"></div><div class="hx-actions"><button class="btn btn-secondary btn-sm here">Use my location</button><a class="btn btn-secondary btn-sm" target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=${E(l.lat ?? '')},${E(l.lng ?? '')}">View on Google Maps</a></div></div>`; }).join('') || '<p class="hx-sub">No branches found.</p>'}</div>`, 'slate')}
    ${sec('receipt', 'Where it shows up', '', '<ul class="sf-where"><li><b>Delivery orders</b> go to Delivery &amp; pickup, with name, phone, address, map link and ETA.</li><li><b>Table bookings</b> and pre-orders go to Reservations.</li><li><b>Room bookings</b> and deposits go to Front desk.</li></ul><p class="hx-sub">Managers, cashiers and waiters get a notification for each one.</p>', 'slate')}
    </div>`;
    draw(url);
    const $ = (s) => el.querySelector(s); const val = (s) => $(s).value;
    $('#cp').onclick = () => { navigator.clipboard?.writeText(url); window.UI.toast.success('Link copied'); };
    $('#pr').onclick = () => { const w = window.open('', '_blank'); if (!w) return window.UI.toast.warning('Allow pop-ups to print'); const svg = window.QREncoder ? window.QREncoder.toSvg(url, { ecl: 'M', border: 1 }) : ''; w.document.write(`<body style="font-family:sans-serif;text-align:center;padding:40px"><h1>${E(qrInfo.businessName)}</h1><p style="font-size:20px">Scan to order delivery, reserve a table or book a room</p><div style="width:600px;max-width:100%;margin:0 auto">${svg}</div><p>${E(url)}</p></body>`); w.document.close(); w.print(); };
    $('#rot').onclick = async () => { if (!confirm('Every printed storefront QR will stop working. Continue?')) return; const r = await send('post', '/restaurant/storefront/qr/rotate'); if (r) { qrInfo = r; paint(); } };
    el.querySelectorAll('.here').forEach((b) => b.addEventListener('click', () => navigator.geolocation.getCurrentPosition((p) => { const row = b.closest('[data-b]'); row.querySelector('.la').value = p.coords.latitude.toFixed(6); row.querySelector('.ln').value = p.coords.longitude.toFixed(6); }, () => window.UI.toast.error('Allow location access first'), { enableHighAccuracy: true })));
    wireFees($);
    $('#save').onclick = async () => {
      const n = (s) => (val(s) === '' ? undefined : Number(val(s)));
      const fmode = val('#fm');
      if (fmode === 'FIXED' && !(n('#ff') > 0) && !confirm('The fixed delivery fee is 0, so delivery will be free for everyone. Continue?')) return;
      if (fmode === 'ZONE' && !zones.some((z) => z.active !== false)) return window.UI.toast.warning('Add at least one county and town you deliver to, or choose another fee type.');
      if (fmode === 'ZONE' && zones.some((z) => !(z.fee >= 0))) return window.UI.toast.warning('Every town needs a delivery fee (0 for free delivery).');
      const body = { storefront: { enabled: $('#en').checked, tagline: val('#tg'), welcomeMessage: val('#wm'), themeColor: val('#co'),
        branchLocations: [...el.querySelectorAll('[data-b]')].filter((r) => r.querySelector('.la').value !== '' && r.querySelector('.ln').value !== '').map((r) => ({ branchId: r.dataset.b, lat: Number(r.querySelector('.la').value), lng: Number(r.querySelector('.ln').value) })),
        delivery: { enabled: $('#de').checked, paused: $('#dp').checked, mode: val('#dm'), payment: val('#dpay'), feeMode: val('#fm'), fixedFeeCents: n('#ff') ?? 0, zoneAllowPin: $('#zp').checked, zones: zones.map((z) => ({ county: z.county, town: z.town, feeCents: z.fee, active: z.active !== false })), baseFeeCents: n('#bf') ?? 0, perKmCents: n('#pk') ?? 0, minOrderCents: n('#mo') ?? 0, maxRadiusKm: n('#mr') ?? 0, minutesPerKm: n('#mk') ?? 3, bufferMinutes: n('#bm') ?? 10, hoursStart: val('#hs'), hoursEnd: val('#he') },
        tables: { enabled: $('#te').checked, requirePayment: $('#trp').checked, openTime: val('#ot'), closeTime: val('#ct'), slotMinutes: n('#sm') ?? 30, minLeadMinutes: n('#ml') ?? 30, maxAdvanceDays: n('#ma') ?? 30 }, rooms: { enabled: $('#re').checked } } };
      const r = await send('put', '/restaurant/settings', body); if (r) { window.UI.toast.success('Storefront saved'); await load(); paint(); }
    };
  }

  /* ---------- delivery fee type + the owner's county / town price list ---------- */
  function feeBlock(d) {
    const m = d.feeMode || 'DISTANCE';
    return fld('fm', 'How is the delivery fee set?', `<select class="select" id="fm"><option value="FIXED" ${m === 'FIXED' ? 'selected' : ''}>One fixed fee for every order</option><option value="DISTANCE" ${m === 'DISTANCE' ? 'selected' : ''}>By distance from the shop (customer drops a map pin)</option><option value="ZONE" ${m === 'ZONE' ? 'selected' : ''}>By county and town (my own price list)</option></select>`)
      + `<div id="fb-fixed" ${m === 'FIXED' ? '' : 'hidden'}>${num('ff', 'Fixed delivery fee (KSh)', kes(d.fixedFeeCents), 'Charged on every delivery order, wherever the customer is.')}</div>`
      + `<div id="fb-dist" ${m === 'FIXED' ? 'hidden' : ''}><div class="sf-grid2">${num('bf', 'Base fee (KSh)', kes(d.baseFeeCents))}${num('pk', 'Extra per km (KSh)', kes(d.perKmCents))}</div><p class="hx-sub" id="fb-note">${m === 'ZONE' ? 'Used only when a customer drops a map pin instead of choosing a town: base fee + extra per km. Set these so pin orders are not delivered free.' : 'Fee = base fee + extra per km from your branch to the customer’s map pin.'}</p></div>`
      + `<div id="fb-pin" ${m === 'ZONE' ? '' : 'hidden'}>${chk('zp', 'Also let customers use a map pin', d.zoneAllowPin !== false, 'Customers can choose a town from your list OR drop a map pin. Turn off to allow the list only.')}</div>`;
  }
  function zoneBlock() {
    const counties = Object.keys(KE);
    return `<style>.zn-add{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;align-items:end}.zn-tools{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}.zn-grp{margin-top:14px}.zn-grp>h4{margin:0 0 6px;font-size:.9rem}.zn-row{display:grid;grid-template-columns:minmax(0,1fr) 120px auto auto;gap:8px;align-items:center;padding:6px 0;border-top:1px solid #eef0f3}.zn-row.off .zn-t{opacity:.5;text-decoration:line-through}.zn-t{font-weight:600;overflow:hidden;text-overflow:ellipsis}.zn-row input[type=number]{width:100%}@media(max-width:520px){.zn-row{grid-template-columns:minmax(0,1fr) 100px auto}.zn-row .zn-on{grid-column:1/-1}}</style>
      <div class="zn-add">${fld('zc', 'County', `<select class="select" id="zc"><option value="">Choose county…</option>${counties.map((c) => `<option>${E(c)}</option>`).join('')}</select>`)}${fld('zt', 'Town / area', `<select class="select" id="zt"><option value="">Choose county first</option></select>`)}${fld('zx', 'Or type another town', `<input class="input" id="zx" type="text" maxlength="80" placeholder="e.g. Kamulu">`)}${num('zf', 'Delivery fee (KSh)', '', 'Fee for this town')}</div>
      <div class="zn-tools"><button type="button" class="btn btn-primary btn-sm" id="zadd">Add town</button><button type="button" class="btn btn-secondary btn-sm" id="zall">Add ALL towns of this county with this fee</button></div>
      <div id="zlist"></div>`;
  }
  function paintZones() {
    const box = el.querySelector('#zlist'); if (!box) return;
    if (!zones.length) { box.innerHTML = '<p class="hx-sub" style="margin-top:14px">No towns yet. Choose a county and town above, set its fee and press Add town.</p>'; return; }
    const by = {}; zones.forEach((z, i) => { (by[z.county] = by[z.county] || []).push(i); });
    box.innerHTML = Object.keys(by).sort().map((c) => `<div class="zn-grp"><h4>${E(c)} <span class="hx-sub">(${by[c].length})</span></h4>${by[c].sort((a, b) => zones[a].town.localeCompare(zones[b].town)).map((i) => { const z = zones[i]; return `<div class="zn-row ${z.active === false ? 'off' : ''}" data-i="${i}"><span class="zn-t">${E(z.town)}</span><input class="input zf" type="number" min="0" step="any" inputmode="decimal" value="${E(z.fee)}" aria-label="Fee for ${E(z.town)} in KSh"><label class="zn-on"><input type="checkbox" class="za" ${z.active !== false ? 'checked' : ''}> Deliver here</label><button type="button" class="btn btn-secondary btn-sm zrm" aria-label="Remove ${E(z.town)}">Remove</button></div>`; }).join('')}</div>`).join('');
    box.querySelectorAll('.zn-row').forEach((row) => {
      const z = zones[Number(row.dataset.i)];
      row.querySelector('.zf').oninput = (e) => { z.fee = e.target.value === '' ? NaN : Number(e.target.value); };
      row.querySelector('.za').onchange = (e) => { z.active = e.target.checked; row.classList.toggle('off', !z.active); };
      row.querySelector('.zrm').onclick = () => { zones.splice(Number(row.dataset.i), 1); paintZones(); };
    });
  }
  function wireFees($) {
    const sync = () => {
      const m = $('#fm').value;
      $('#fb-fixed').hidden = m !== 'FIXED'; $('#fb-dist').hidden = m === 'FIXED'; $('#fb-pin').hidden = m !== 'ZONE'; $('#zsec').hidden = m !== 'ZONE';
      $('#fb-note').textContent = m === 'ZONE' ? 'Used only when a customer drops a map pin instead of choosing a town: base fee + extra per km. Set these so pin orders are not delivered free.' : 'Fee = base fee + extra per km from your branch to the customer’s map pin.';
    };
    $('#fm').onchange = sync; sync();
    const zc = $('#zc'), zt = $('#zt');
    zc.onchange = () => { zt.innerHTML = zc.value ? '<option value="">Choose town…</option>' + (KE[zc.value] || []).map((t) => `<option>${E(t)}</option>`).join('') : '<option value="">Choose county first</option>'; };
    const has = (c, t) => zones.some((z) => z.county.toLowerCase() === c.toLowerCase() && z.town.toLowerCase() === t.toLowerCase());
    const fee = () => { const v = $('#zf').value; return v === '' ? NaN : Number(v); };
    $('#zadd').onclick = () => {
      const c = zc.value, t = ($('#zx').value.trim() || zt.value); const f = fee();
      if (!c) return window.UI.toast.warning('Choose the county'); if (!t) return window.UI.toast.warning('Choose the town or type one');
      if (!(f >= 0)) return window.UI.toast.warning('Enter the delivery fee for this town (0 for free delivery)');
      if (has(c, t)) return window.UI.toast.warning(t + ' is already in your list. Change its fee below.');
      zones.push({ county: c, town: t, fee: f, active: true }); $('#zx').value = ''; zt.value = ''; paintZones();
    };
    $('#zall').onclick = () => {
      const c = zc.value, f = fee(); if (!c) return window.UI.toast.warning('Choose the county first'); if (!(f >= 0)) return window.UI.toast.warning('Enter the fee to use for all its towns, then adjust each one below');
      let added = 0; (KE[c] || []).forEach((t) => { if (!has(c, t)) { zones.push({ county: c, town: t, fee: f, active: true }); added++; } });
      window.UI.toast.success(added + ' town' + (added === 1 ? '' : 's') + ' added to ' + c); paintZones();
    };
    paintZones();
  }
  function draw(url) {
    const box = el.querySelector('#qr');
    if (!url) { box.innerHTML = '<span class="sf-qrempty">QR appears once the link is ready</span>'; return; }
    if (!window.QREncoder) { box.innerHTML = '<span class="sf-qrempty">The QR script did not load. Refresh the page.</span>'; return; }
    try { box.innerHTML = window.QREncoder.toSvg(url, { ecl: 'M', border: 1, title: 'Storefront QR' }); }
    catch (e) { box.innerHTML = '<span class="sf-qrempty">Could not draw the QR. Copy the link instead.</span>'; }
  }
})();
