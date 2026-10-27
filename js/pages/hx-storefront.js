/**
 * hx-storefront.js - Online storefront settings: ONE QR code that lets anyone order delivery, reserve a table and book a room.
 *
 * Layout: one page, six tabs, ONE save bar.
 *   Overview        link + QR, storefront branding, live status of every service, setup checklist
 *   Delivery        availability, how orders are handled, payment, hours and limits
 *   Fees & areas    fixed fee / by distance / by county and town (the owner's price list)
 *   Table booking   reservation rules
 *   Room booking    on / off
 *   Branches        the map location every delivery distance is measured from
 * Every tab lives in the same form, so ONE "Save changes" button saves everything and the bar always shows
 * whether there is anything unsaved.
 *
 * API: GET /restaurant/storefront/qr, POST /restaurant/storefront/qr/rotate, GET|PUT /restaurant/settings (storefront block), GET /branches.
 * Money in settings is returned as cents and accepted as KES, so the form shows cents/100 and sends KES.
 */
(function () {
  const { E, can, get, send, list } = window.HX;
  let el, st = {}, branches = [], qrInfo = null, zones = [];
  let tab = 'overview', dirty = false, saving = false, url = '', raf = 0;
  const closed = new Set();                                    // collapsed county groups in the price list
  const TABS = ['overview', 'delivery', 'fees', 'tables', 'rooms', 'branches'];

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
    'Nairobi': ['CBD', 'Westlands', 'Kilimani', 'Kileleshwa', 'Lavington', 'Karen', 'Langata', 'South B', 'South C', 'Parklands', 'Eastleigh', 'Embakasi', 'Donholm', 'Umoja', 'Kasarani', 'Roysambu', 'Zimmerman', 'Githurai', 'Ruaraka', 'Kayole', 'Buruburu', 'Dandora', 'Pangani', 'Muthaiga', 'Gigiri', 'Runda', 'Kitisuru', 'Rongai Road (Nairobi side)', 'Ngong Road', 'Kawangware', 'Dagoretti', 'Kangemi', 'Uthiru', 'Waithaka', 'Industrial Area', 'Upper Hill', 'Madaraka', 'Nairobi West', 'Kibera', 'Mathare', 'Utawala', 'Ruai', 'Njiru', 'JKIA / Syokimau Road', 'Fedha', 'Pipeline', 'Komarock', "Lang'ata Road"],
    'Nakuru': ['Nakuru', 'Naivasha', 'Gilgil', 'Molo', 'Njoro', 'Subukia', 'Rongai', 'Bahati', 'Mai Mahiu', 'Elementaita'],
    'Nandi': ['Kapsabet', 'Nandi Hills', 'Mosoriot', 'Kobujoi', 'Chepterit', 'Lessos'],
    'Narok': ['Narok', 'Kilgoris', "Ololulung'a", 'Suswa', 'Mulot', 'Maasai Mara (Sekenani)'],
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

  /* ---------- tiny helpers ---------- */
  const v = (o, p, d = '') => { const x = p.split('.').reduce((a, k) => (a == null ? undefined : a[k]), o); return x == null ? d : x; };
  const kes = (c) => (c ? c / 100 : 0);
  const fmt = (n) => 'KSh ' + (Math.round(n * 100) / 100).toLocaleString('en-KE');
  const hhmm = (s) => { const m = /^(\d{1,2}):(\d{2})/.exec(s || ''); return m ? m[1].padStart(2, '0') + ':' + m[2] : ''; };
  const $ = (s) => el.querySelector(s);
  const $$ = (s) => [...el.querySelectorAll(s)];
  const toast = (kind, msg) => window.UI && window.UI.toast && window.UI.toast[kind] && window.UI.toast[kind](msg);

  const IC = {
    store: '<path d="M3 9l1.5-5h15L21 9"/><path d="M4 9v11h16V9"/><path d="M3 9a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0"/><path d="M10 20v-5h4v5"/>',
    grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    bike: '<circle cx="5.5" cy="17" r="3.5"/><circle cx="18.5" cy="17" r="3.5"/><path d="M5.5 17l4-8h5l4 8"/><path d="M9.5 9L8 6H6"/><path d="M14.5 9l-3 8"/>',
    tag: '<path d="M3 12V4h8l10 10-8 8L3 12z"/><circle cx="7.5" cy="8.5" r="1.3"/>',
    utensils: '<path d="M7 3v8a2 2 0 0 0 2 2v8"/><path d="M5 3v6M9 3v6"/><path d="M17 21V3c-2.5 1.5-4 4.5-4 8h4"/>',
    bed: '<path d="M3 19V6"/><path d="M3 14h18v5"/><path d="M21 14v-2a3 3 0 0 0-3-3h-7v5"/><circle cx="7" cy="10.5" r="1.8"/>',
    pin: '<path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    alert: '<path d="M12 3l10 18H2L12 3z"/><path d="M12 10v5M12 18h.01"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
    print: '<path d="M7 9V3h10v6"/><rect x="4" y="9" width="16" height="8" rx="2"/><path d="M7 14h10v7H7z"/>',
    download: '<path d="M12 4v11"/><path d="M7 11l5 5 5-5"/><path d="M5 20h14"/>',
    ext: '<path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    trash: '<path d="M4 7h16"/><path d="M10 11v6M14 11v6"/><path d="M6 7l1 13h10l1-13"/><path d="M9 7V4h6v3"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
    chevron: '<path d="M6 9l6 6 6-6"/>',
    save: '<path d="M5 3h11l4 4v14H5z"/><path d="M8 3v5h7V3"/><rect x="8" y="13" width="8" height="8"/>',
    wallet: '<path d="M3 7a2 2 0 0 1 2-2h13v4"/><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M16 13.5h2"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    refresh: '<path d="M20 11a8 8 0 0 0-14.3-4.5L4 8"/><path d="M4 4v4h4"/><path d="M4 13a8 8 0 0 0 14.3 4.5L20 16"/><path d="M20 20v-4h-4"/>',
    target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
    building: '<rect x="4" y="3" width="16" height="18" rx="1.5"/><path d="M9 7h2M13 7h2M9 11h2M13 11h2M9 15h2M13 15h2"/>',
    map: '<path d="M9 4L3 6v14l6-2 6 2 6-2V4l-6 2-6-2z"/><path d="M9 4v14M15 6v14"/>',
    ruler: '<path d="M3 17L17 3l4 4L7 21z"/><path d="M7 13l2 2M10 10l2 2M13 7l2 2"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/>',
  };
  const ic = (n, cls = '') => `<svg class="sfx-i ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${IC[n] || ''}</svg>`;

  /* ---------- styles (self-contained, scoped to .sfx) ---------- */
  const CSS = `
.sfx{--a:#1570ef;--a2:#0b57c9;--al:#e8f1fe;--ok:#178a3a;--okl:#e3f6e9;--warn:#b45309;--warnl:#fef3c7;--bad:#d92d20;--badl:#fee4e2;--ink:#101828;--ink2:#344054;--mut:#667085;--line:#e4e7ec;--bg:#f6f7f9;--card:#fff;display:block;color:var(--ink);font-size:14px;line-height:1.45;max-width:1180px;margin:0 auto;padding-bottom:8px}
.sfx *{box-sizing:border-box}.sfx [hidden]{display:none!important}
.sfx-i{width:18px;height:18px;flex:none}
.sfx-top{display:flex;flex-wrap:wrap;gap:14px;align-items:center;justify-content:space-between;margin-bottom:18px}
.sfx-top h1{margin:0;font-size:1.55rem;font-weight:800;letter-spacing:-.02em;display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.sfx-top p{margin:4px 0 0;color:var(--mut);font-size:.92rem}
.sfx-live{display:inline-flex;align-items:center;gap:7px;font-size:.76rem;font-weight:800;padding:5px 11px;border-radius:99px;background:var(--line);color:var(--mut);letter-spacing:.02em}
.sfx-live i{width:8px;height:8px;border-radius:50%;background:#98a2b3}
.sfx-live.on{background:var(--okl);color:var(--ok)}.sfx-live.on i{background:#22a447;box-shadow:0 0 0 3px rgba(34,164,71,.2)}
.sfx-shell{display:grid;grid-template-columns:230px minmax(0,1fr);gap:22px;align-items:start}
.sfx-nav{position:sticky;top:12px;display:grid;gap:4px;background:var(--card);border:1px solid var(--line);border-radius:16px;padding:8px;box-shadow:0 1px 2px rgba(16,24,40,.05)}
.sfx-tab{all:unset;box-sizing:border-box;display:flex;align-items:center;gap:11px;padding:10px 12px;border-radius:11px;cursor:pointer;font-weight:700;color:var(--ink2);position:relative;transition:background .12s,color .12s}
.sfx-tab:hover{background:#f2f4f7}.sfx-tab:focus-visible{outline:3px solid rgba(21,112,239,.35)}
.sfx-tab.on{background:var(--al);color:var(--a2)}
.sfx-tab small{display:block;font-weight:500;color:var(--mut);font-size:.74rem;margin-top:1px}
.sfx-tab.on small{color:#4a78c4}
.sfx-tab .st{margin-left:auto;font-size:.68rem;font-weight:800;padding:2px 8px;border-radius:99px;background:var(--line);color:var(--mut)}
.sfx-tab .st.on{background:var(--okl);color:var(--ok)}
.sfx-tab.err::after{content:'';position:absolute;top:9px;right:9px;width:9px;height:9px;border-radius:50%;background:var(--bad)}
.sfx-main{display:grid;gap:16px;min-width:0}
.sfx-panel{display:grid;gap:16px;animation:sfxIn .18s ease}
@keyframes sfxIn{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
.sfx-card{background:var(--card);border:1px solid var(--line);border-radius:16px;box-shadow:0 1px 2px rgba(16,24,40,.05);overflow:hidden}
.sfx-ch{display:flex;gap:12px;align-items:center;padding:16px 20px;border-bottom:1px solid var(--line)}
.sfx-ch .ico{width:38px;height:38px;border-radius:11px;background:var(--al);color:var(--a);display:grid;place-items:center;flex:none}
.sfx-ch .ico .sfx-i{width:20px;height:20px}
.sfx-ch h3{margin:0;font-size:1rem;font-weight:800}.sfx-ch p{margin:2px 0 0;color:var(--mut);font-size:.84rem}
.sfx-ch .end{margin-left:auto}
.sfx-cb{padding:18px 20px;display:grid;gap:16px}
.sfx-g2{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}
.sfx-g3{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}
.sfx-f{display:grid;gap:6px;align-content:start;min-width:0}
.sfx-f>label{font-size:.82rem;font-weight:700;color:var(--ink2)}
.sfx-f small,.sfx-hint{color:var(--mut);font-size:.78rem;margin:0}
.sfx-in,.sfx-sel{width:100%;height:42px;padding:0 12px;border:1px solid #d0d5dd;border-radius:10px;background:#fff;font:inherit;color:var(--ink);transition:border-color .12s,box-shadow .12s}
.sfx-in:focus,.sfx-sel:focus,.sfx-ad input:focus{outline:0;border-color:var(--a);box-shadow:0 0 0 3px rgba(21,112,239,.16)}
.sfx-in.bad,.sfx-sel.bad,.sfx-ad.bad{border-color:var(--bad)!important;box-shadow:0 0 0 3px rgba(217,45,32,.12)!important}
.sfx-ad{display:flex;align-items:stretch;border:1px solid #d0d5dd;border-radius:10px;background:#fff;overflow:hidden;height:42px;transition:border-color .12s,box-shadow .12s}
.sfx-ad:focus-within{border-color:var(--a);box-shadow:0 0 0 3px rgba(21,112,239,.16)}
.sfx-ad span{display:grid;place-items:center;padding:0 11px;background:#f2f4f7;color:var(--mut);font-weight:700;font-size:.8rem;white-space:nowrap}
.sfx-ad input{flex:1;min-width:0;border:0;outline:0;padding:0 12px;font:inherit;background:#fff;color:var(--ink)}
.sfx-ad span:last-child{border-left:1px solid #d0d5dd}.sfx-ad span:first-child{border-right:1px solid #d0d5dd}
.sfx-sw{display:flex;gap:12px;align-items:center;cursor:pointer;padding:12px 14px;border:1px solid var(--line);border-radius:12px;background:#fcfcfd;transition:border-color .12s,background .12s}
.sfx-sw:hover{border-color:#c5ccd6}.sfx-sw input{position:absolute;opacity:0;pointer-events:none}
.sfx-tr{flex:none;width:42px;height:25px;border-radius:99px;background:#d0d5dd;position:relative;transition:background .15s}
.sfx-tr::after{content:'';position:absolute;top:3px;left:3px;width:19px;height:19px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(16,24,40,.3);transition:transform .15s}
.sfx-sw input:checked+.sfx-tr{background:var(--a)}.sfx-sw input:checked+.sfx-tr::after{transform:translateX(17px)}
.sfx-sw input:focus-visible+.sfx-tr{outline:3px solid rgba(21,112,239,.35);outline-offset:2px}
.sfx-sw b{display:block;font-size:.92rem}.sfx-sw small{display:block;color:var(--mut);font-size:.78rem;font-weight:500;margin-top:1px}
.sfx-sw.master{background:var(--al);border-color:#c8dcfa}
.sfx-banner{display:flex;gap:10px;align-items:flex-start;padding:12px 14px;border-radius:12px;font-size:.86rem;background:var(--warnl);color:#6b3f08}
.sfx-banner.info{background:var(--al);color:#1b4a9a}.sfx-banner.bad{background:var(--badl);color:#912018}.sfx-banner.ok{background:var(--okl);color:#0f5a25}
.sfx-banner .sfx-i{margin-top:1px}.sfx-banner a,.sfx-link{color:inherit;font-weight:800;text-decoration:underline;cursor:pointer;background:none;border:0;padding:0;font:inherit}
.sfx-btn{all:unset;box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;gap:8px;height:40px;padding:0 16px;border-radius:10px;font-weight:700;font-size:.88rem;cursor:pointer;border:1px solid #d0d5dd;background:#fff;color:var(--ink2);transition:background .12s,border-color .12s,transform .05s;white-space:nowrap}
.sfx-btn:hover{background:#f9fafb;border-color:#b8c0cc}.sfx-btn:active{transform:scale(.98)}.sfx-btn:focus-visible{outline:3px solid rgba(21,112,239,.35);outline-offset:1px}
.sfx-btn.pri{background:var(--a);border-color:var(--a);color:#fff}.sfx-btn.pri:hover{background:var(--a2);border-color:var(--a2)}
.sfx-btn.sm{height:34px;padding:0 12px;font-size:.82rem}.sfx-btn.ghost{border-color:transparent;background:transparent}.sfx-btn.ghost:hover{background:#f2f4f7}
.sfx-btn.dng{color:var(--bad)}.sfx-btn.dng:hover{background:var(--badl);border-color:#f6b7b1}
.sfx-btn[disabled]{opacity:.55;cursor:not-allowed;pointer-events:none}
.sfx-ibtn{all:unset;box-sizing:border-box;width:34px;height:34px;display:grid;place-items:center;border-radius:9px;cursor:pointer;color:var(--mut)}.sfx-ibtn:hover{background:var(--badl);color:var(--bad)}.sfx-ibtn:focus-visible{outline:3px solid rgba(21,112,239,.35)}
.sfx-spin{width:16px;height:16px;border-radius:50%;border:2.5px solid rgba(255,255,255,.4);border-top-color:#fff;animation:sfxRot .7s linear infinite;flex:none}
@keyframes sfxRot{to{transform:rotate(360deg)}}
/* overview */
.sfx-hero{display:grid;grid-template-columns:auto minmax(0,1fr);gap:24px;padding:20px;align-items:center}
.sfx-qr{width:210px;max-width:100%;aspect-ratio:1;background:#fff;padding:10px;border:1px solid var(--line);border-radius:14px;display:grid;place-items:center}
.sfx-qr svg{width:100%;height:100%;display:block}.sfx-qr .e{font-size:.78rem;text-align:center;color:var(--mut)}
.sfx-hero h2{margin:0 0 4px;font-size:1.15rem;font-weight:800}
.sfx-url{display:flex;align-items:center;gap:8px;background:#f2f4f7;border-radius:10px;padding:9px 12px;font-weight:600;font-size:.85rem;word-break:break-all;margin:10px 0 12px}
.sfx-acts{display:flex;flex-wrap:wrap;gap:8px}
.sfx-tiles{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
.sfx-tile{all:unset;box-sizing:border-box;cursor:pointer;display:grid;gap:8px;padding:14px;border:1px solid var(--line);border-radius:14px;background:#fff;transition:border-color .12s,box-shadow .12s}
.sfx-tile:hover{border-color:#b8c9ea;box-shadow:0 2px 8px rgba(16,24,40,.06)}.sfx-tile:focus-visible{outline:3px solid rgba(21,112,239,.35)}
.sfx-tile .t{display:flex;align-items:center;gap:9px;font-weight:800}.sfx-tile .t .sfx-i{color:var(--a)}
.sfx-tile .s{font-size:.78rem;font-weight:800;padding:2px 9px;border-radius:99px;justify-self:start;background:var(--line);color:var(--mut)}
.sfx-tile .s.on{background:var(--okl);color:var(--ok)}.sfx-tile .s.warn{background:var(--warnl);color:var(--warn)}
.sfx-tile .d{font-size:.8rem;color:var(--mut)}
.sfx-cl{display:grid;gap:0}.sfx-cl li{list-style:none;display:flex;gap:12px;align-items:center;padding:11px 0;border-top:1px solid var(--line)}.sfx-cl li:first-child{border-top:0}
.sfx-cl{margin:0;padding:0}
.sfx-dot{width:24px;height:24px;border-radius:50%;display:grid;place-items:center;flex:none;background:var(--line);color:transparent}
.sfx-dot .sfx-i{width:14px;height:14px;stroke-width:3}.sfx-cl li.done .sfx-dot{background:var(--ok);color:#fff}
.sfx-cl li.done b{color:var(--mut);text-decoration:line-through;text-decoration-color:#c5ccd6}
.sfx-cl small{display:block;color:var(--mut);font-size:.78rem}.sfx-cl .grow{flex:1;min-width:0}
.sfx-prog{height:8px;border-radius:99px;background:var(--line);overflow:hidden}.sfx-prog i{display:block;height:100%;background:linear-gradient(90deg,var(--a),#2e90fa);border-radius:99px;transition:width .3s}
.sfx-color{display:flex;align-items:center;gap:10px}.sfx-color input[type=color]{width:54px;height:42px;padding:3px;border:1px solid #d0d5dd;border-radius:10px;background:#fff;cursor:pointer}
/* fee type cards */
.sfx-opts{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
.sfx-opt{position:relative;cursor:pointer}.sfx-opt input{position:absolute;opacity:0;pointer-events:none}
.sfx-ob{display:grid;gap:6px;padding:14px;border:1.5px solid var(--line);border-radius:14px;background:#fff;height:100%;transition:border-color .12s,background .12s,box-shadow .12s}
.sfx-opt:hover .sfx-ob{border-color:#b8c9ea}
.sfx-opt input:checked+.sfx-ob{border-color:var(--a);background:var(--al);box-shadow:0 0 0 3px rgba(21,112,239,.12)}
.sfx-opt input:focus-visible+.sfx-ob{outline:3px solid rgba(21,112,239,.35);outline-offset:2px}
.sfx-ob .h{display:flex;align-items:center;gap:9px;font-weight:800}.sfx-ob .h .sfx-i{color:var(--a)}
.sfx-ob small{color:var(--mut);font-size:.8rem}
.sfx-ob .ck{margin-left:auto;width:20px;height:20px;border-radius:50%;border:2px solid #d0d5dd;display:grid;place-items:center;color:transparent}
.sfx-ob .ck .sfx-i{width:12px;height:12px;stroke-width:3.2;color:inherit}
.sfx-opt input:checked+.sfx-ob .ck{background:var(--a);border-color:var(--a);color:#fff}
.sfx-ex{display:flex;flex-wrap:wrap;gap:10px;padding:12px 14px;border-radius:12px;background:#f9fafb;border:1px dashed #d0d5dd;font-size:.86rem}
.sfx-ex b{color:var(--a2)}
/* price list */
.sfx-zadd{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;align-items:end}
.sfx-zbar{display:flex;flex-wrap:wrap;gap:10px;align-items:center;justify-content:space-between}
.sfx-zs{position:relative;flex:1;min-width:200px;max-width:340px}.sfx-zs .sfx-i{position:absolute;left:12px;top:12px;color:var(--mut);width:17px;height:17px}.sfx-zs input{padding-left:38px}
.sfx-zsum{font-size:.84rem;color:var(--mut);font-weight:600}.sfx-zsum b{color:var(--ink)}
.sfx-zg{border:1px solid var(--line);border-radius:14px;overflow:hidden;background:#fff}
.sfx-zgh{display:flex;gap:10px;align-items:center;padding:10px 12px;background:#f9fafb;flex-wrap:wrap}
.sfx-zgh .tg{all:unset;display:flex;align-items:center;gap:8px;cursor:pointer;font-weight:800;flex:1;min-width:150px}.sfx-zgh .tg .sfx-i{transition:transform .15s;color:var(--mut)}
.sfx-zg.shut .tg .sfx-i{transform:rotate(-90deg)}.sfx-zg.shut .sfx-zrows{display:none}
.sfx-zgh .n{font-weight:600;color:var(--mut);font-size:.8rem}
.sfx-zgh .ap{display:flex;gap:6px;align-items:center}.sfx-zgh .ap .sfx-ad{width:140px;height:34px}.sfx-zgh .ap .sfx-ad span{font-size:.72rem;padding:0 8px}
.sfx-zr{display:grid;grid-template-columns:minmax(0,1fr) 150px 120px 34px;gap:10px;align-items:center;padding:8px 12px;border-top:1px solid var(--line)}
.sfx-zr .tn{font-weight:600;overflow:hidden;text-overflow:ellipsis}.sfx-zr.off .tn{color:var(--mut);text-decoration:line-through}
.sfx-zr .sfx-ad{height:36px}
.sfx-zr .on{display:flex;align-items:center;gap:8px;font-size:.8rem;font-weight:700;color:var(--ink2);cursor:pointer}
.sfx-zr .on input{width:17px;height:17px;accent-color:var(--a)}
.sfx-zempty{text-align:center;padding:30px 16px;border:2px dashed var(--line);border-radius:14px;color:var(--mut)}
.sfx-zempty b{display:block;color:var(--ink);margin-bottom:4px}
/* branches */
.sfx-brs{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}
.sfx-br{display:grid;gap:12px;padding:16px;border:1px solid var(--line);border-radius:14px;background:#fff}
.sfx-br .h{display:flex;align-items:center;gap:10px;font-weight:800}
.sfx-chip{margin-left:auto;font-size:.72rem;font-weight:800;padding:3px 10px;border-radius:99px;background:var(--warnl);color:var(--warn)}.sfx-chip.ok{background:var(--okl);color:var(--ok)}
/* save bar */
.sfx-bar{position:sticky;bottom:0;z-index:30;margin-top:22px;display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:12px 16px;background:rgba(255,255,255,.96);backdrop-filter:blur(8px);border:1px solid var(--line);border-radius:16px;box-shadow:0 -4px 22px rgba(16,24,40,.1);transition:border-color .2s,background .2s}
.sfx-bar .msg{display:flex;align-items:center;gap:10px;font-weight:700;flex:1;min-width:200px;color:var(--mut)}
.sfx-bar .msg i{width:10px;height:10px;border-radius:50%;background:#98a2b3;flex:none}
.sfx-bar.dirty{border-color:#f5c26b;background:#fffbf0}.sfx-bar.dirty .msg{color:#8a4b08}.sfx-bar.dirty .msg i{background:#f79009;box-shadow:0 0 0 4px rgba(247,144,9,.2)}
.sfx-bar.saving .msg{color:var(--a2)}.sfx-bar.saving .msg i{background:var(--a);animation:sfxPulse 1s infinite}
.sfx-bar.saved{border-color:#9bd9ae;background:#f3fbf5}.sfx-bar.saved .msg{color:var(--ok)}.sfx-bar.saved .msg i{background:#22a447}
@keyframes sfxPulse{50%{opacity:.35}}
.sfx-bar .sfx-btn.pri{min-width:150px}
.sfx-skel{height:260px;border-radius:16px;background:linear-gradient(90deg,#eef0f3,#f7f8fa,#eef0f3);background-size:200% 100%;animation:sfxSk 1.2s infinite}@keyframes sfxSk{to{background-position:-200% 0}}
@media(max-width:900px){.sfx-shell{grid-template-columns:1fr}.sfx-nav{position:sticky;top:0;z-index:20;display:flex;overflow-x:auto;padding:6px;gap:4px;scrollbar-width:none}.sfx-nav::-webkit-scrollbar{display:none}.sfx-tab{flex:none;padding:9px 13px}.sfx-tab small,.sfx-tab .st{display:none}.sfx-opts,.sfx-tiles,.sfx-g3{grid-template-columns:1fr}.sfx-brs{grid-template-columns:1fr}}
@media(max-width:600px){.sfx-g2{grid-template-columns:1fr}.sfx-hero{grid-template-columns:1fr;justify-items:center;text-align:center}.sfx-acts{justify-content:center}.sfx-zr{grid-template-columns:minmax(0,1fr) 130px 34px}.sfx-zr .on{grid-column:1/-1;order:5}.sfx-top h1{font-size:1.3rem}.sfx-bar .msg{min-width:100%}.sfx-bar .sfx-btn{flex:1}.sfx-ch{padding:14px}.sfx-cb{padding:14px}}
@media print{.sfx-bar,.sfx-nav{display:none}}
`;
  function injectCss() { if (document.getElementById('sfx-css')) return; const s = document.createElement('style'); s.id = 'sfx-css'; s.textContent = CSS; document.head.appendChild(s); }

  /* ---------- form building blocks ---------- */
  const fld = (id, label, control, hint = '') => `<div class="sfx-f"><label for="${id}">${E(label)}</label>${control}${hint ? `<small>${E(hint)}</small>` : ''}</div>`;
  const text = (id, label, val, ph = '', hint = '') => fld(id, label, `<input class="sfx-in" type="text" id="${id}" value="${E(val)}" placeholder="${E(ph)}" autocomplete="off">`, hint);
  const time = (id, label, val, hint = '') => fld(id, label, `<input class="sfx-in" type="time" id="${id}" value="${E(hhmm(val))}">`, hint);
  const money = (id, label, val, hint = '') => fld(id, label, `<div class="sfx-ad"><span>KSh</span><input type="number" id="${id}" value="${E(val === '' ? '' : val)}" min="0" step="any" inputmode="decimal" placeholder="0"></div>`, hint);
  const unit = (id, label, val, u, hint = '', min = 0) => fld(id, label, `<div class="sfx-ad"><input type="number" id="${id}" value="${E(val)}" min="${min}" step="any" inputmode="decimal"><span>${E(u)}</span></div>`, hint);
  const sw = (id, label, on, hint = '', cls = '') => `<label class="sfx-sw ${cls}"><input type="checkbox" id="${id}" ${on ? 'checked' : ''}><span class="sfx-tr" aria-hidden="true"></span><span><b>${E(label)}</b>${hint ? `<small>${E(hint)}</small>` : ''}</span></label>`;
  const card = (icon, title, sub, body, end = '') => `<section class="sfx-card"><header class="sfx-ch"><span class="ico">${ic(icon)}</span><div><h3>${E(title)}</h3>${sub ? `<p>${sub}</p>` : ''}</div>${end ? `<div class="end">${end}</div>` : ''}</header><div class="sfx-cb">${body}</div></section>`;
  const banner = (kind, icon, html) => `<div class="sfx-banner ${kind}">${ic(icon)}<div>${html}</div></div>`;

  /* ---------- load ---------- */
  async function init() {
    injectCss();
    el = window.HX.mount('Online storefront'); if (!el) return; await window.AppShell.whenProfileReady?.();
    if (!can('restaurant.guest.qr')) { el.innerHTML = `<div class="sfx">${banner('info', 'info', '<b>No access.</b> Ask the owner or a manager to set up the storefront.')}</div>`; return; }
    el.innerHTML = '<div class="sfx"><div class="sfx-skel"></div></div>';
    try { await load(); } catch (e) { el.innerHTML = `<div class="sfx">${banner('bad', 'alert', '<b>We could not load the storefront settings.</b> Check your connection and refresh the page.')}</div>`; return; }
    const h = (location.hash || '').replace('#', ''); if (TABS.includes(h)) tab = h;
    paint();
    window.addEventListener('beforeunload', (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });
    document.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && el && el.querySelector('.sfx')) { e.preventDefault(); save(); } });
  }
  async function load() {
    const [s, q, b] = await Promise.all([get('/restaurant/settings'), get('/restaurant/storefront/qr'), get('/branches', { limit: 100 })]);
    if (!s) throw new Error('settings');
    st = (s.settings || s).storefront || {}; qrInfo = q || qrInfo;
    zones = ((st.delivery && st.delivery.zones) || []).map((z) => ({ county: z.county, town: z.town, fee: kes(z.feeCents), active: z.active !== false }));
    branches = list(b, 'branches').filter((x) => x.status !== 'inactive');
  }

  /* ---------- page ---------- */
  function paint() {
    const d = st.delivery || {}, t = st.tables || {};
    const tk = qrInfo && (qrInfo.token || String(qrInfo.url || '').split(/\/(?:q|s)\//)[1] || '');
    // A direct link to a real file (store.html?t=<token>) on THIS site: no dependence on rewrites or a server-side base URL.
    url = tk ? location.origin + '/store.html?t=' + encodeURIComponent(tk) : '';
    const loc = (id) => (st.branchLocations || []).find((x) => String(x.branchId) === String(id)) || {};
    const mode = d.feeMode || 'DISTANCE';

    const overview = `
      <section class="sfx-card"><div class="sfx-hero"><div class="sfx-qr" id="qr"></div><div>
        <h2>Your storefront link</h2><p class="sfx-hint">Print it on menus, receipts, posters and your door. Customers scan it, install the app, then order, reserve and book.</p>
        ${url ? `<div class="sfx-url">${ic('store')}<span>${E(url)}</span></div>` : `<div class="sfx-url">Switch the storefront on and save to get your link.</div>`}
        <div class="sfx-acts"><button type="button" class="sfx-btn pri sm" id="cp" ${url ? '' : 'disabled'}>${ic('copy')} Copy link</button>${url ? `<a class="sfx-btn sm" href="${E(url)}" target="_blank" rel="noopener">${ic('ext')} Open</a>` : ''}<button type="button" class="sfx-btn sm" id="dl" ${url ? '' : 'disabled'}>${ic('download')} Download QR</button><button type="button" class="sfx-btn sm" id="pr" ${url ? '' : 'disabled'}>${ic('print')} Print</button><button type="button" class="sfx-btn sm ghost dng" id="rot">${ic('refresh')} Replace QR</button></div>
        <p class="sfx-hint" style="margin-top:10px">Replacing the QR makes every printed copy stop working.</p></div></div></section>
      ${card('grid', 'What customers can do', 'Live status of each service. Select one to change it.', `<div class="sfx-tiles" id="tiles"></div>`)}
      <div class="sfx-g2" style="align-items:start">
        ${card('store', 'Storefront', 'What customers see first.', sw('en', 'Storefront is switched on', st.enabled, 'When off, the QR code shows nothing.', 'master') + text('tg', 'Tagline', v(st, 'tagline'), 'Fresh food, delivered') + text('wm', 'Welcome message', v(st, 'welcomeMessage'), 'Welcome! What are you craving today?') + fld('co', 'Brand colour', `<div class="sfx-color"><input type="color" id="co" value="${E(v(st, 'themeColor', '#0f766e'))}"><span class="sfx-hint">Used for buttons and highlights in the customer app.</span></div>`))}
        ${card('check', 'Setup checklist', 'Finish these so customers can order.', `<div class="sfx-prog"><i id="prog" style="width:0"></i></div><ul class="sfx-cl" id="cl"></ul>`)}
      </div>`;

    const delivery = `
      <div id="dOff"></div>
      ${card('bike', 'Delivery availability', 'Switch delivery on, or pause it when the kitchen is too busy.', sw('de', 'Offer delivery', d.enabled !== false, 'Customers can order food to their door.', 'master') + sw('dp', 'Pause delivery now', d.paused, 'Customers see "delivery is paused" until you turn this off.'))}
      ${card('list', 'Orders and payment', 'How new orders are handled and paid for.', `<div class="sfx-g2">${fld('dm', 'New delivery orders', `<select class="sfx-sel" id="dm"><option value="AUTO" ${d.mode !== 'CONFIRM' ? 'selected' : ''}>Go straight to the kitchen</option><option value="CONFIRM" ${d.mode === 'CONFIRM' ? 'selected' : ''}>Wait for staff to confirm and send</option></select>`, 'Confirm first if you want to check every order.')}${fld('dpay', 'How customers pay', `<select class="sfx-sel" id="dpay"><option value="MPESA_OR_CASH" ${d.payment !== 'MPESA' ? 'selected' : ''}>M-PESA now, or cash on delivery</option><option value="MPESA" ${d.payment === 'MPESA' ? 'selected' : ''}>M-PESA only (kitchen starts after payment)</option></select>`, 'M-PESA only protects you from fake orders.')}</div>`)}
      ${card('clock', 'Hours, limits and timing', 'When you deliver and how far. Leave the times empty to deliver all day.', `<div class="sfx-g2">${time('hs', 'Delivers from', d.hoursStart)}${time('he', 'Delivers until', d.hoursEnd, 'A closing time earlier than the opening time runs past midnight.')}${money('mo', 'Minimum order', kes(d.minOrderCents) || '', 'Food total only, the delivery fee is not counted.')}${unit('mr', 'Maximum distance', v(d, 'maxRadiusKm', 0), 'km', '0 means no limit. Needs a branch location.')}${unit('mk', 'Travel time per km', v(d, 'minutesPerKm', 3), 'min', 'Used for the delivery time shown to customers.')}${unit('bm', 'Extra buffer', v(d, 'bufferMinutes', 10), 'min', 'Added to every promised delivery time.')}</div>`)}`;

    const fees = `
      <div id="fOff"></div>
      ${card('wallet', 'How do you charge for delivery?', 'Pick one. The fee is always worked out by the server, so customers cannot change it.', `<div class="sfx-opts">
        ${[['FIXED', 'tag', 'One fixed fee', 'The same fee on every order, wherever the customer is.'], ['DISTANCE', 'ruler', 'By distance', 'Base fee plus an amount per km, from your branch to the customer’s map pin.'], ['ZONE', 'map', 'By county and town', 'You set the exact fee for every county and town you deliver to.']].map(([k, i, t, s]) => `<label class="sfx-opt"><input type="radio" name="fm" value="${k}" ${mode === k ? 'checked' : ''}><span class="sfx-ob"><span class="h">${ic(i)}${t}<span class="ck">${ic('check')}</span></span><small>${s}</small></span></label>`).join('')}</div>
        <div id="fxFixed">${money('ff', 'Fixed delivery fee', kes(d.fixedFeeCents) || '', 'Charged on every delivery order. Enter 0 for free delivery.')}</div>
        <div id="fxPin"><div class="sfx-g2">${money('bf', 'Base fee', kes(d.baseFeeCents) || '', '')}${money('pk', 'Extra per km', kes(d.perKmCents) || '', '')}</div><p class="sfx-hint" id="pinNote" style="margin-top:8px"></p></div>
        <div id="fxPinAllow">${sw('zp', 'Also let customers use a map pin', d.zoneAllowPin !== false, 'Customers can choose a town from your list OR drop a map pin (priced with the base fee and per km above). Turn off to allow the list only.')}</div>
        <div class="sfx-ex" id="fxEx"></div>`)}
      <div id="zsec">${card('map', 'Delivery areas and fees', 'Add every county and town you deliver to, with its fee. Customers can only order to towns on this list.',
        `<div class="sfx-zadd">${fld('zc', 'County', `<select class="sfx-sel" id="zc"><option value="">Choose county…</option>${Object.keys(KE).map((c) => `<option>${E(c)}</option>`).join('')}</select>`)}${fld('zt', 'Town / area', `<select class="sfx-sel" id="zt"><option value="">Choose county first</option></select>`)}${fld('zx', 'Or type another town', `<input class="sfx-in" id="zx" type="text" maxlength="80" placeholder="e.g. Kamulu" autocomplete="off">`)}${money('zf', 'Delivery fee', '', '')}</div>
        <div class="sfx-acts"><button type="button" class="sfx-btn pri sm" id="zadd">${ic('plus')} Add town</button><button type="button" class="sfx-btn sm" id="zall">${ic('plus')} Add all towns of the county at this fee</button></div>
        <div class="sfx-zbar"><div class="sfx-zs"><span class="sfx-f">${ic('search')}<input class="sfx-in" id="zq" type="search" placeholder="Search towns or counties" aria-label="Search the price list"></span></div><div class="sfx-zsum" id="zsum"></div></div>
        <div id="zlist" style="display:grid;gap:12px"></div>`)}</div>`;

    const tables = `
      <div id="tOff"></div>
      ${card('utensils', 'Table reservations', 'Customers see free tables and reserve.', sw('te', 'Let customers reserve tables', t.enabled !== false, '', 'master') + sw('trp', 'Pay first to book a table', t.requirePayment !== false, 'A table is only booked once the customer pays by M-PESA (pre-ordered food or the table deposit).'))}
      ${card('clock', 'Booking rules', '', `<div class="sfx-g2">${time('ot', 'Bookings from', v(t, 'openTime', '10:00'))}${time('ct', 'Last booking until', v(t, 'closeTime', '22:00'))}${unit('sm', 'Time slot length', v(t, 'slotMinutes', 30), 'min', 'Between 15 and 240.', 15)}${unit('ml', 'Book at least', v(t, 'minLeadMinutes', 30), 'min ahead', '', 0)}${unit('ma', 'Book up to', v(t, 'maxAdvanceDays', 30), 'days ahead', '', 1)}</div>${banner('info', 'info', 'The table deposit is set in <a href="hx-restaurant-settings.html#reservations">Restaurant settings → Table reservations</a>.')}`)}`;

    const rooms = `
      <div id="rOff"></div>
      ${card('bed', 'Room booking', 'Customers see free rooms and book.', sw('re', 'Let customers book rooms', v(st, 'rooms.enabled', true) !== false, 'Online bookings appear in Front desk and Stays.', 'master') + banner('info', 'info', 'The room deposit is set in <a href="hx-restaurant-settings.html#rooms">Restaurant settings → Rooms &amp; front desk → Deposit</a>.'))}`;

    const branchTab = `
      ${card('building', 'Branch locations', 'Delivery distance, fee and range are measured from here. Stand at the branch and press “Use my location”.', `<div class="sfx-brs">${branches.map((b) => { const l = loc(b._id); const has = l.lat != null && l.lng != null && l.lat !== ''; return `<div class="sfx-br" data-b="${b._id}"><div class="h">${ic('pin')}${E(b.name)}<span class="sfx-chip ${has ? 'ok' : ''}" data-chip>${has ? 'Location set' : 'No location'}</span></div><div class="sfx-g2"><div class="sfx-f"><label>Latitude</label><input type="number" step="any" class="sfx-in la" placeholder="-1.286389" value="${E(l.lat ?? '')}"></div><div class="sfx-f"><label>Longitude</label><input type="number" step="any" class="sfx-in ln" placeholder="36.817223" value="${E(l.lng ?? '')}"></div></div><div class="sfx-acts"><button type="button" class="sfx-btn sm here">${ic('target')} Use my location</button><a class="sfx-btn sm" target="_blank" rel="noopener" data-maps href="https://www.google.com/maps/search/?api=1&query=${E(l.lat ?? '')},${E(l.lng ?? '')}">${ic('ext')} View on Google Maps</a></div></div>`; }).join('') || banner('info', 'info', 'No branches found.')}</div>`)}`;

    const meta = { overview: ['grid', 'Overview', 'Link, QR and status'], delivery: ['bike', 'Delivery', 'Hours, payment, limits'], fees: ['wallet', 'Fees & areas', 'What you charge'], tables: ['utensils', 'Table booking', 'Reservation rules'], rooms: ['bed', 'Room booking', 'Online room sales'], branches: ['pin', 'Branches', 'Map locations'] };
    const html = { overview, delivery, fees, tables, rooms, branches: branchTab };

    el.innerHTML = `<div class="sfx">
      <div class="sfx-top"><div><h1>Online storefront <span class="sfx-live" id="live"><i></i><span>Off</span></span></h1><p>One QR code for delivery, table reservations and room booking.</p></div></div>
      <div class="sfx-shell">
        <nav class="sfx-nav" role="tablist" aria-label="Storefront settings">${TABS.map((k) => `<button type="button" class="sfx-tab" role="tab" data-tab="${k}">${ic(meta[k][0])}<span>${meta[k][1]}<small>${meta[k][2]}</small></span>${['delivery', 'tables', 'rooms'].includes(k) ? `<span class="st" data-st="${k}"></span>` : ''}</button>`).join('')}</nav>
        <main class="sfx-main">${TABS.map((k) => `<div class="sfx-panel" role="tabpanel" data-panel="${k}" hidden>${html[k]}</div>`).join('')}</main>
      </div>
      <div class="sfx-bar" id="bar" role="status" aria-live="polite"><div class="msg"><i></i><span id="barTxt">All changes saved</span></div><button type="button" class="sfx-btn" id="discard" hidden>Discard</button><button type="button" class="sfx-btn pri" id="save">${ic('save')} <span>Save changes</span></button></div>
    </div>`;
    bind();
    setTab(tab, true);
    drawQr();
    paintZones();
    refresh();
    setBar(dirty ? 'dirty' : 'clean');
  }

  /* ---------- tabs ---------- */
  function setTab(k, silent) {
    if (!TABS.includes(k)) k = 'overview'; tab = k;
    $$('.sfx-tab').forEach((b) => { const on = b.dataset.tab === k; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); });
    $$('.sfx-panel').forEach((p) => { p.hidden = p.dataset.panel !== k; });
    if (!silent) { try { history.replaceState(null, '', '#' + k); } catch (e) { /* ignore */ } const m = $('.sfx-shell'); if (m) { const r = m.getBoundingClientRect(); if (r.top < 0) window.scrollBy(0, r.top - 8); } }
  }

  /* ---------- live reading of the form ---------- */
  const num = (id) => { const e = $('#' + id); if (!e || e.value === '') return undefined; const x = Number(e.value); return Number.isFinite(x) ? x : NaN; };
  const checked = (id) => { const e = $('#' + id); return !!(e && e.checked); };
  const feeMode = () => { const r = $('input[name="fm"]:checked'); return r ? r.value : 'DISTANCE'; };
  function snapshot() {
    return { en: checked('en'), de: checked('de'), dp: checked('dp'), te: checked('te'), re: checked('re'), mode: feeMode(), ff: num('ff') || 0, bf: num('bf') || 0, pk: num('pk') || 0, zp: checked('zp'), mr: num('mr') || 0,
      pins: $$('[data-b]').filter((r) => r.querySelector('.la').value !== '' && r.querySelector('.ln').value !== '').length, hs: $('#hs') && $('#hs').value, he: $('#he') && $('#he').value };
  }
  function schedule() { if (raf) return; raf = requestAnimationFrame(() => { raf = 0; refresh(); }); }

  /** Re-draws everything that depends on the form: status, tiles, checklist, fee panes, fee example. */
  function refresh() {
    if (!el || !$('#live')) return;
    const s = snapshot(), act = zones.filter((z) => z.active !== false);
    const feeOk = s.mode === 'FIXED' ? true : s.mode === 'DISTANCE' ? s.bf > 0 || s.pk > 0 : act.length > 0;
    const live = $('#live'); live.classList.toggle('on', s.en); live.lastElementChild.textContent = s.en ? 'Live' : 'Off';

    // fee type panes
    $('#fxFixed').hidden = s.mode !== 'FIXED'; $('#fxPin').hidden = s.mode === 'FIXED'; $('#fxPinAllow').hidden = s.mode !== 'ZONE'; $('#zsec').hidden = s.mode !== 'ZONE';
    $('#pinNote').textContent = s.mode === 'ZONE' ? 'Used only when a customer drops a map pin instead of choosing a town: base fee + extra per km. Set these so pin orders are not delivered free.' : 'Fee = base fee + extra per km, measured from your branch to the customer’s map pin.';
    $('#fxPin').hidden = s.mode === 'FIXED' || (s.mode === 'ZONE' && !s.zp);
    const ex = $('#fxEx');
    if (s.mode === 'FIXED') ex.innerHTML = `${ic('info')}<span>Every customer pays <b>${s.ff ? fmt(s.ff) : 'nothing (free delivery)'}</b> for delivery.</span>`;
    else if (s.mode === 'DISTANCE') ex.innerHTML = `${ic('info')}<span>Example: </span>${[2, 5, 10].map((k) => `<span>${k} km → <b>${fmt(s.bf + s.pk * k)}</b></span>`).join('<span>·</span>')}`;
    else { const f = act.map((z) => z.fee).filter((x) => x >= 0); ex.innerHTML = act.length ? `${ic('info')}<span><b>${act.length}</b> town${act.length === 1 ? '' : 's'} in <b>${new Set(act.map((z) => z.county)).size}</b> count${new Set(act.map((z) => z.county)).size === 1 ? 'y' : 'ies'}, fees from <b>${fmt(Math.min(...f))}</b> to <b>${fmt(Math.max(...f))}</b>.${s.zp ? ` Map-pin orders: ${fmt(s.bf)} + ${fmt(s.pk)} per km.` : ' Map pin is switched off.'}</span>` : `${ic('alert')}<span>No towns yet. Add the towns you deliver to below.</span>`; }

    // service switched off banners + tab status
    const off = (id, on, label, tabName) => { const b = $('#' + id); if (b) b.innerHTML = on ? '' : banner('warn', 'alert', `<b>${label} is switched off.</b> Customers cannot use it. Turn it on with the first switch on this page.`); };
    off('dOff', s.de, 'Delivery'); off('fOff', s.de, 'Delivery'); off('tOff', s.te, 'Table reservations'); off('rOff', s.re, 'Room booking');
    $$('[data-st]').forEach((b) => { const on = b.dataset.st === 'delivery' ? s.de && !s.dp : b.dataset.st === 'tables' ? s.te : s.re; b.textContent = b.dataset.st === 'delivery' && s.de && s.dp ? 'Paused' : on ? 'On' : 'Off'; b.classList.toggle('on', on); });

    // overview tiles
    const tiles = $('#tiles');
    if (tiles) {
      const feeTxt = s.mode === 'FIXED' ? (s.ff ? `Flat ${fmt(s.ff)}` : 'Free delivery') : s.mode === 'ZONE' ? `${act.length} town${act.length === 1 ? '' : 's'} priced` : `${fmt(s.bf)} + ${fmt(s.pk)}/km`;
      tiles.innerHTML = [
        ['delivery', 'bike', 'Delivery', !s.de ? ['', 'Off'] : s.dp ? ['warn', 'Paused'] : ['on', 'On'], feeTxt],
        ['tables', 'utensils', 'Table booking', s.te ? ['on', 'On'] : ['', 'Off'], s.te ? 'Customers can reserve tables' : 'Not offered'],
        ['rooms', 'bed', 'Room booking', s.re ? ['on', 'On'] : ['', 'Off'], s.re ? 'Customers can book rooms' : 'Not offered'],
      ].map(([k, i, t, [c, l], d]) => `<button type="button" class="sfx-tile" data-go="${k}"><span class="t">${ic(i)}${t}</span><span class="s ${c}">${l}</span><span class="d">${E(d)}</span></button>`).join('');
      $$('[data-go]').forEach((b) => { b.onclick = () => setTab(b.dataset.go); });
    }
    // checklist
    const cl = $('#cl');
    if (cl) {
      const items = [
        [!!url || s.en, 'Switch the storefront on', 'Then save to create your link and QR.', 'overview', s.en],
        [s.pins > 0, 'Set your branch location', 'Needed to measure delivery distance.', 'branches', s.pins > 0],
        [feeOk, 'Set your delivery fees', s.mode === 'ZONE' ? 'Add the towns you deliver to.' : s.mode === 'DISTANCE' ? 'Enter a base fee or a fee per km.' : 'Fixed fee chosen.', 'fees', feeOk],
        [!!(s.hs && s.he) || true, 'Opening hours', s.hs && s.he ? `Delivering ${s.hs} – ${s.he}.` : 'Delivering all day. Set hours if you close.', 'delivery', !!(s.hs && s.he)],
      ];
      const done = items.filter((i) => i[4]).length;
      cl.innerHTML = items.map(([, t, d, go, ok]) => `<li class="${ok ? 'done' : ''}"><span class="sfx-dot">${ic('check')}</span><span class="grow"><b>${t}</b><small>${E(d)}</small></span>${ok ? '' : `<button type="button" class="sfx-btn sm" data-go="${go}">Fix</button>`}</li>`).join('');
      $('#prog').style.width = Math.round((done / items.length) * 100) + '%';
      $$('#cl [data-go]').forEach((b) => { b.onclick = () => setTab(b.dataset.go); });
    }
  }

  /* ---------- save bar ---------- */
  function setBar(state, msg) {
    const bar = $('#bar'); if (!bar) return; const btn = $('#save'), dis = $('#discard');
    bar.className = 'sfx-bar ' + (state === 'clean' ? '' : state);
    const t = { clean: 'All changes saved', dirty: 'You have unsaved changes', saving: 'Saving your changes…', saved: 'Changes saved' }[state];
    $('#barTxt').textContent = msg || t;
    btn.disabled = state === 'saving' || state === 'clean' || state === 'saved'; dis.hidden = state !== 'dirty';
    btn.innerHTML = state === 'saving' ? '<span class="sfx-spin" aria-hidden="true"></span><span>Saving…</span>' : state === 'saved' ? `${ic('check')}<span>Saved</span>` : `${ic('save')}<span>Save changes</span>`;
    btn.setAttribute('aria-busy', state === 'saving');
  }
  function markDirty() { if (saving) return; dirty = true; setBar('dirty'); }

  /* ---------- collect + validate + save ---------- */
  function problem(tabName, sel, msg) {
    $$('.sfx-tab').forEach((b) => b.classList.toggle('err', b.dataset.tab === tabName));
    setTab(tabName); const f = sel && $(sel); if (f) { const box = f.closest('.sfx-ad') || f; box.classList.add('bad'); f.focus({ preventScroll: false }); setTimeout(() => box.classList.remove('bad'), 4000); }
    toast('warning', msg); return null;
  }
  function collect() {
    $$('.sfx-tab.err').forEach((b) => b.classList.remove('err'));
    const s = snapshot(), val = (id) => ($('#' + id) ? $('#' + id).value : '');
    const bad = (id) => { const x = num(id); return x !== undefined && (!(x >= 0)); };
    for (const [id, label, tb] of [['ff', 'fixed delivery fee', 'fees'], ['bf', 'base fee', 'fees'], ['pk', 'fee per km', 'fees'], ['mo', 'minimum order', 'delivery'], ['mr', 'maximum distance', 'delivery'], ['mk', 'travel time per km', 'delivery'], ['bm', 'buffer', 'delivery']]) if (bad(id)) return problem(tb, '#' + id, `Enter a valid ${label} (zero or more).`);
    if ((val('hs') === '') !== (val('he') === '')) return problem('delivery', val('hs') === '' ? '#hs' : '#he', 'Set both the opening and closing time, or leave both empty to deliver all day.');
    if (s.mode === 'ZONE') {
      if (!zones.some((z) => z.active !== false)) return problem('fees', '#zc', 'Add at least one county and town you deliver to, or choose another fee type.');
      if (zones.some((z) => !(z.fee >= 0))) return problem('fees', null, 'Every town needs a delivery fee (0 for free delivery).');
    }
    const sm = num('sm'), ml = num('ml'), ma = num('ma');
    if (!(sm >= 15 && sm <= 240)) return problem('tables', '#sm', 'The time slot must be between 15 and 240 minutes.');
    if (!(ml >= 0 && ml <= 1440)) return problem('tables', '#ml', 'Book-at-least must be between 0 and 1440 minutes.');
    if (!(ma >= 1 && ma <= 365)) return problem('tables', '#ma', 'Book-up-to must be between 1 and 365 days.');
    if (!val('ot') || !val('ct')) return problem('tables', !val('ot') ? '#ot' : '#ct', 'Set the first and last booking time.');
    const locs = []; for (const r of $$('[data-b]')) {
      const la = r.querySelector('.la').value, ln = r.querySelector('.ln').value; if (la === '' && ln === '') continue;
      if (la === '' || ln === '' || Math.abs(Number(la)) > 90 || Math.abs(Number(ln)) > 180 || !Number.isFinite(Number(la)) || !Number.isFinite(Number(ln))) return problem('branches', la === '' || Math.abs(Number(la)) > 90 ? `[data-b="${r.dataset.b}"] .la` : `[data-b="${r.dataset.b}"] .ln`, 'Enter a valid latitude (-90 to 90) and longitude (-180 to 180).');
      locs.push({ branchId: r.dataset.b, lat: Number(la), lng: Number(ln) });
    }
    return { storefront: { enabled: s.en, tagline: val('tg'), welcomeMessage: val('wm'), themeColor: val('co'), branchLocations: locs,
      delivery: { enabled: s.de, paused: s.dp, mode: val('dm'), payment: val('dpay'), feeMode: s.mode, fixedFeeCents: s.ff, zoneAllowPin: s.zp, zones: zones.map((z) => ({ county: z.county, town: z.town, feeCents: z.fee, active: z.active !== false })), baseFeeCents: s.bf, perKmCents: s.pk, minOrderCents: num('mo') ?? 0, maxRadiusKm: s.mr, minutesPerKm: num('mk') ?? 3, bufferMinutes: num('bm') ?? 10, hoursStart: val('hs'), hoursEnd: val('he') },
      tables: { enabled: s.te, requirePayment: checked('trp'), openTime: val('ot'), closeTime: val('ct'), slotMinutes: sm, minLeadMinutes: ml, maxAdvanceDays: ma }, rooms: { enabled: s.re } } };
  }
  async function save() {
    if (saving || !dirty) return;
    const body = collect(); if (!body) return;
    const s = snapshot();
    if (s.mode === 'FIXED' && s.ff === 0 && s.de && window.UI && window.UI.confirmDialog) {
      const ok = await window.UI.confirmDialog({ title: 'Free delivery?', message: 'The fixed delivery fee is 0, so delivery will be free for every customer. Continue?', confirmText: 'Yes, save' }); if (!ok) return;
    }
    saving = true; setBar('saving'); const y = window.scrollY;
    const t0 = Date.now(); let r = null;
    try { r = await send('put', '/restaurant/settings', body); } finally { const wait = 450 - (Date.now() - t0); if (wait > 0) await new Promise((res) => setTimeout(res, wait)); }
    if (!r) { saving = false; setBar('dirty', 'Could not save. Your changes are still here.'); return; }
    try { await load(); } catch (e) { /* the save worked; the refresh can wait */ }
    dirty = false; saving = false; paint(); window.scrollTo(0, y); setBar('saved'); toast('success', 'Storefront settings saved');
    setTimeout(() => { if (!dirty && !saving) setBar('clean'); }, 2200);
  }

  /* ---------- wiring ---------- */
  function bind() {
    $$('.sfx-tab').forEach((b) => { b.onclick = () => setTab(b.dataset.tab); });
    if (!el._sfxBound) {                                              // bound once: paint() runs again after every save
      el._sfxBound = true; const NOT_SETTINGS = '#zq,#zc,#zt,#zx,#zf,.zcf';
      const onEdit = (e) => { if (e.target.closest('.sfx-panel') && !e.target.matches(NOT_SETTINGS)) { markDirty(); schedule(); } };
      el.addEventListener('input', onEdit); el.addEventListener('change', onEdit);
    }
    $('#save').onclick = save;
    $('#discard').onclick = async () => {
      const ok = window.UI && window.UI.confirmDialog ? await window.UI.confirmDialog({ title: 'Discard changes?', message: 'Everything you changed since the last save will be lost.', confirmText: 'Discard', danger: true }) : true; if (!ok) return;
      try { await load(); } catch (e) { /* keep what we have */ } dirty = false; paint(); toast('success', 'Changes discarded');
    };
    const cp = $('#cp'); if (cp) cp.onclick = async () => { try { await navigator.clipboard.writeText(url); toast('success', 'Link copied'); } catch (e) { toast('warning', 'Could not copy. Select the link and copy it.'); } };
    const dl = $('#dl'); if (dl) dl.onclick = () => { if (!window.QREncoder) return toast('error', 'The QR script did not load. Refresh the page.'); const svg = window.QREncoder.toSvg(url, { ecl: 'M', border: 2 }); const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' })); a.download = 'storefront-qr.svg'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); };
    const pr = $('#pr'); if (pr) pr.onclick = () => { const w = window.open('', '_blank'); if (!w) return toast('warning', 'Allow pop-ups to print'); const svg = window.QREncoder ? window.QREncoder.toSvg(url, { ecl: 'M', border: 1 }) : ''; w.document.write(`<body style="font-family:sans-serif;text-align:center;padding:40px"><h1>${E(qrInfo.businessName)}</h1><p style="font-size:20px">Scan to order delivery, reserve a table or book a room</p><div style="width:600px;max-width:100%;margin:0 auto">${svg}</div><p>${E(url)}</p></body>`); w.document.close(); w.print(); };
    const rot = $('#rot'); if (rot) rot.onclick = async () => {
      if (dirty) return toast('warning', 'Save your changes first, then replace the QR.');
      const ok = window.UI && window.UI.confirmDialog ? await window.UI.confirmDialog({ title: 'Replace the QR code?', message: 'Every printed storefront QR will stop working. Customers will need the new one.', confirmText: 'Replace QR', danger: true }) : confirm('Every printed storefront QR will stop working. Continue?'); if (!ok) return;
      rot.disabled = true; const r = await send('post', '/restaurant/storefront/qr/rotate'); rot.disabled = false; if (r) { qrInfo = r; paint(); toast('success', 'New QR created'); }
    };
    // branches: use my location + live maps link + status chip
    $$('[data-b]').forEach((row) => {
      const upd = () => { const la = row.querySelector('.la').value, ln = row.querySelector('.ln').value, has = la !== '' && ln !== ''; const c = row.querySelector('[data-chip]'); c.textContent = has ? 'Location set' : 'No location'; c.classList.toggle('ok', has); row.querySelector('[data-maps]').href = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(la)},${encodeURIComponent(ln)}`; };
      row.addEventListener('input', upd);
      row.querySelector('.here').onclick = (ev) => { const b = ev.currentTarget; if (!navigator.geolocation) return toast('error', 'Location is not available on this device'); b.disabled = true; navigator.geolocation.getCurrentPosition((p) => { b.disabled = false; row.querySelector('.la').value = p.coords.latitude.toFixed(6); row.querySelector('.ln').value = p.coords.longitude.toFixed(6); upd(); markDirty(); schedule(); }, () => { b.disabled = false; toast('error', 'Allow location access first'); }, { enableHighAccuracy: true, timeout: 20000 }); };
    });
    // price list controls
    const zc = $('#zc'), zt = $('#zt');
    zc.onchange = () => { zt.innerHTML = zc.value ? '<option value="">Choose town…</option>' + (KE[zc.value] || []).map((x) => `<option>${E(x)}</option>`).join('') : '<option value="">Choose county first</option>'; };
    const has = (c, t) => zones.some((z) => z.county.toLowerCase() === c.toLowerCase() && z.town.toLowerCase() === t.toLowerCase());
    const fee = () => { const x = $('#zf').value; return x === '' ? NaN : Number(x); };
    $('#zadd').onclick = () => {
      const c = zc.value, t = ($('#zx').value.trim() || zt.value), f = fee();
      if (!c) return toast('warning', 'Choose the county'); if (!t) return toast('warning', 'Choose the town or type one'); if (!(f >= 0)) return toast('warning', 'Enter the delivery fee for this town (0 for free delivery)');
      if (has(c, t)) return toast('warning', t + ' is already in your list. Change its fee below.');
      if (zones.length >= 1500) return toast('warning', 'The list is full (1500 towns).');
      zones.push({ county: c, town: t, fee: f, active: true }); $('#zx').value = ''; zt.value = ''; closed.delete(c); markDirty(); paintZones(); schedule();
    };
    $('#zall').onclick = () => {
      const c = zc.value, f = fee(); if (!c) return toast('warning', 'Choose the county first'); if (!(f >= 0)) return toast('warning', 'Enter the fee to use for all its towns, then adjust each one below');
      let n = 0; (KE[c] || []).forEach((t) => { if (!has(c, t) && zones.length < 1500) { zones.push({ county: c, town: t, fee: f, active: true }); n++; } });
      closed.delete(c); toast('success', n + ' town' + (n === 1 ? '' : 's') + ' added to ' + c); if (n) markDirty(); paintZones(); schedule();
    };
    $('#zq').addEventListener('input', () => paintZones());
  }

  function paintZones() {
    const box = $('#zlist'); if (!box) return;
    const q = ($('#zq') ? $('#zq').value : '').toLowerCase().trim();
    const act = zones.filter((z) => z.active !== false).length;
    $('#zsum').innerHTML = zones.length ? `<b>${zones.length}</b> town${zones.length === 1 ? '' : 's'} · ${act} active` : '';
    if (!zones.length) { box.innerHTML = `<div class="sfx-zempty"><b>No towns yet</b>Choose a county and town above, set its fee and press “Add town”.</div>`; return; }
    const by = {}; zones.forEach((z, i) => { if (!q || z.town.toLowerCase().includes(q) || z.county.toLowerCase().includes(q)) (by[z.county] = by[z.county] || []).push(i); });
    const keys = Object.keys(by).sort();
    if (!keys.length) { box.innerHTML = `<div class="sfx-zempty"><b>No match</b>Nothing in your list matches “${E(q)}”.</div>`; return; }
    box.innerHTML = keys.map((c) => `<div class="sfx-zg ${closed.has(c) && !q ? 'shut' : ''}" data-c="${E(c)}"><div class="sfx-zgh"><button type="button" class="tg" aria-expanded="${!closed.has(c)}">${ic('chevron')}<span>${E(c)} <span class="n">${by[c].length} town${by[c].length === 1 ? '' : 's'}</span></span></button><div class="ap"><div class="sfx-ad"><span>KSh</span><input type="number" min="0" step="any" class="zcf" placeholder="Fee" aria-label="Fee for all towns in ${E(c)}"></div><button type="button" class="sfx-btn sm zap">Apply to all</button><button type="button" class="sfx-ibtn zrc" aria-label="Remove ${E(c)} from the list" title="Remove county">${ic('trash')}</button></div></div><div class="sfx-zrows">${by[c].sort((a, b) => zones[a].town.localeCompare(zones[b].town)).map((i) => { const z = zones[i]; return `<div class="sfx-zr ${z.active === false ? 'off' : ''}" data-i="${i}"><span class="tn" title="${E(z.town)}">${E(z.town)}</span><div class="sfx-ad"><span>KSh</span><input class="zf" type="number" min="0" step="any" inputmode="decimal" value="${E(z.fee)}" aria-label="Delivery fee for ${E(z.town)}"></div><label class="on"><input type="checkbox" class="za" ${z.active !== false ? 'checked' : ''}> Deliver here</label><button type="button" class="sfx-ibtn zrm" aria-label="Remove ${E(z.town)}" title="Remove">${ic('trash')}</button></div>`; }).join('')}</div></div>`).join('');
    box.querySelectorAll('.sfx-zg').forEach((g) => {
      const c = g.dataset.c;
      g.querySelector('.tg').onclick = () => { if (closed.has(c)) closed.delete(c); else closed.add(c); g.classList.toggle('shut', closed.has(c)); g.querySelector('.tg').setAttribute('aria-expanded', !closed.has(c)); };
      g.querySelector('.zap').onclick = () => { const x = g.querySelector('.zcf').value; if (x === '' || !(Number(x) >= 0)) return toast('warning', 'Enter the fee to apply to every town in ' + c); zones.forEach((z) => { if (z.county === c) z.fee = Number(x); }); markDirty(); paintZones(); schedule(); toast('success', 'Fee updated for ' + c); };
      g.querySelector('.zrc').onclick = async () => { const ok = window.UI && window.UI.confirmDialog ? await window.UI.confirmDialog({ title: 'Remove ' + c + '?', message: 'All its towns will be removed from your delivery list.', confirmText: 'Remove', danger: true }) : true; if (!ok) return; zones = zones.filter((z) => z.county !== c); markDirty(); paintZones(); schedule(); };
      g.querySelectorAll('.sfx-zr').forEach((row) => {
        const z = zones[Number(row.dataset.i)];
        row.querySelector('.zf').oninput = (e) => { z.fee = e.target.value === '' ? NaN : Number(e.target.value); };
        row.querySelector('.za').onchange = (e) => { z.active = e.target.checked; row.classList.toggle('off', !z.active); };
        row.querySelector('.zrm').onclick = () => { zones.splice(Number(row.dataset.i), 1); markDirty(); paintZones(); schedule(); };
      });
    });
  }

  function drawQr() {
    const box = $('#qr'); if (!box) return;
    if (!url) { box.innerHTML = '<span class="e">QR appears once the link is ready</span>'; return; }
    if (!window.QREncoder) { box.innerHTML = '<span class="e">The QR script did not load. Refresh the page.</span>'; return; }
    try { box.innerHTML = window.QREncoder.toSvg(url, { ecl: 'M', border: 1, title: 'Storefront QR' }); } catch (e) { box.innerHTML = '<span class="e">Could not draw the QR. Copy the link instead.</span>'; }
  }

  document.addEventListener('DOMContentLoaded', init);
})();