/**
 * hx-art.js - visuals for the restaurant + accommodation screens. No network, no image files:
 *   HX.art.dish(name, category)  -> data-URI illustration of the dish (used when a dish has no photo of its own)
 *   HX.art.table(seats)          -> inline SVG: a table with its chairs (colour comes from CSS `color`)
 *   HX.art.bed(kind)             -> inline SVG: a bed for room tiles
 *   HX.art.donut(parts, centre)  -> inline SVG donut chart
 *   HX.kpi(label, value, sub, tone, iconName, badge) -> coloured stat tile
 * Real photos always win: set an image on a dish in Menu and it replaces the illustration everywhere.
 */
(function (window) {
  const HX = window.HX; if (!HX) return;
  const E = HX.E;

  /* ---------- helpers ---------- */
  const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return Math.abs(h); };
  // One short blob: URL per illustration (was a 3-6 KB data: URI copied into every <img>, twice). The browser decodes each URL once and reuses it.
  const uri = (svg) => { try { return URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' })); } catch (e) { return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg); } };
  // Big photos stored inline (data: URIs) are turned into one short blob: URL as well, so re-painting the menu never re-parses megabytes of text.
  const photoCache = new Map();
  const photo = (src) => {
    if (!src || src.slice(0, 5) !== 'data:' || src.length < 2000) return src;
    if (photoCache.has(src.length + src.slice(-40))) return photoCache.get(src.length + src.slice(-40));
    let out = src;
    try { const i = src.indexOf(','), head = src.slice(5, i), bin = head.includes('base64') ? atob(src.slice(i + 1)) : decodeURIComponent(src.slice(i + 1)); const u = new Uint8Array(bin.length); for (let k = 0; k < bin.length; k++) u[k] = bin.charCodeAt(k); out = URL.createObjectURL(new Blob([u], { type: head.split(';')[0] || 'image/jpeg' })); } catch (e) { out = src; }
    photoCache.set(src.length + src.slice(-40), out); return out;
  };
  const frame = (a, b, inner) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 220"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient><radialGradient id="p" cx=".4" cy=".35" r=".8"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#e6eaf0"/></radialGradient></defs><rect width="320" height="220" fill="url(#g)"/>${inner}</svg>`;
  const shadow = '<ellipse cx="160" cy="198" rx="108" ry="9" fill="#000" opacity=".13"/>';
  const plate = '<circle cx="160" cy="108" r="88" fill="url(#p)"/><circle cx="160" cy="108" r="70" fill="none" stroke="#d9dee6" stroke-width="2"/>';
  const dots = (arr, r, fill) => arr.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}"/>`).join('');

  /* ---------- what kind of dish is it? ---------- */
  const KINDS = [
    ['coffee', /coffee|latte|cappuccino|espresso|mocha|tea\b|chai|dawa|macchiato/],
    ['drink', /juice|soda|water|milk|smoothie|beer|wine|cocktail|mocktail|drink|beverage|mojito|whisky|whiskey|vodka|gin\b|cola|fanta|sprite|lemonade|shake|cider|tusker|guinness/],
    ['icecream', /ice ?cream|gelato|sundae|kulfi/],
    ['dessert', /cake|dessert|brownie|\bpie\b|tart|pudding|cheesecake|donut|doughnut|waffle|pancake|cookie|mousse|tiramisu|sweet/],
    ['burger', /burger|sandwich|wrap|hot ?dog|club|sub\b|shawarma|taco|kebab roll/],
    ['pizza', /pizza|calzone|focaccia/],
    ['pasta', /pasta|spaghetti|noodle|lasagn|macaroni|penne|fettuccine|ramen|mac /],
    ['soup', /soup|stew|broth|githeri|mukimo|chowder|\bsauce\b/],
    ['salad', /salad|bowl|greens|vegetable|veggie|coleslaw|kachumbari|sukuma|spinach|veg\b/],
    ['fish', /fish|tilapia|prawn|shrimp|seafood|lobster|calamari|samaki|crab|salmon|tuna|oyster/],
    ['chicken', /chicken|steak|beef|nyama|choma|grill|ribs|wings|lamb|goat|mutton|bbq|skewer|sausage|roast|pork|bacon|meat|mbuzi|ugali|lollipop/],
    ['rice', /rice|biryani|pilau|pilaf|chapati|chapo|naan|bread|paratha|risotto|mandazi/],
    ['fries', /fries|chips|crisps|snack|samosa|bhajia|nuggets|popcorn|wedges/],
    ['breakfast', /egg|omelet|omelette|breakfast|toast|bacon|sausage egg|sunny/],
  ];
  const kindOf = (name, cat) => { const s = `${name || ''} ${cat || ''}`.toLowerCase(); for (const [k, re] of KINDS) if (re.test(s)) return k; return 'plate'; };

  /* ---------- the illustrations ---------- */
  const ART = {
    burger: () => frame('#fff3d9', '#ffd9a1', `${shadow}${plate}
      <rect x="104" y="132" width="112" height="22" rx="11" fill="#d58f36"/><rect x="100" y="114" width="120" height="20" rx="10" fill="#5e3219"/>
      <path d="M104 112h112l-10 13-12-9-12 9-12-9-12 9-12-9-12 9z" fill="#f7c33f"/><rect x="104" y="100" width="112" height="10" rx="5" fill="#e1473a"/>
      <path d="M98 100q10-11 20 0t20 0t20 0t20 0t20 0t20 0v5H98z" fill="#5cb85c"/><path d="M98 96a62 46 0 0 1 124 0z" fill="#eaa955"/><path d="M118 80q12-12 30-14" stroke="#f9d79b" stroke-width="5" stroke-linecap="round" fill="none"/>
      ${[[132, 78, -20], [152, 70, 5], [176, 74, 20], [196, 84, 35], [120, 90, -35]].map(([x, y, r]) => `<ellipse cx="${x}" cy="${y}" rx="5" ry="2.6" fill="#fff4d8" transform="rotate(${r} ${x} ${y})"/>`).join('')}`),
    pizza: () => frame('#ffe6d4', '#ffc79f', `${shadow}<circle cx="160" cy="108" r="92" fill="#8a5a2b" opacity=".18"/>
      <circle cx="160" cy="108" r="84" fill="#e5a65a"/><circle cx="160" cy="108" r="74" fill="#d8402c"/><circle cx="160" cy="108" r="70" fill="#f8cf62"/>
      <path d="M160 108L160 38M160 108L228 130M160 108L100 160M160 108L96 74" stroke="#e2b04a" stroke-width="2" opacity=".7"/>
      ${dots([[132, 76], [188, 80], [210, 120], [176, 152], [124, 138], [152, 112], [196, 106], [118, 104]], 12, '#b6281f')}${dots([[132, 76], [188, 80], [210, 120], [176, 152], [124, 138], [152, 112], [196, 106], [118, 104]], 4, '#d9503a')}
      ${[[170, 62], [100, 118], [200, 146], [146, 150]].map(([x, y]) => `<ellipse cx="${x}" cy="${y}" rx="9" ry="4.5" fill="#3f9f4b" transform="rotate(${(x * 3) % 90} ${x} ${y})"/>`).join('')}`),
    salad: () => frame('#e6f8e2', '#bfe8bf', `${shadow}<circle cx="160" cy="110" r="88" fill="#fff"/><circle cx="160" cy="110" r="76" fill="#eef1f5"/><circle cx="160" cy="110" r="64" fill="#5fb865"/>
      ${[[130, 86, 25, '#79c97c'], [182, 82, -30, '#4aa653'], [196, 112, 60, '#7fd283'], [150, 140, -50, '#3f9b4b'], [118, 116, 80, '#6cc070'], [168, 108, 10, '#8fd993'], [140, 108, -15, '#4aa653']].map(([x, y, r, c]) => `<ellipse cx="${x}" cy="${y}" rx="22" ry="9" fill="${c}" transform="rotate(${r} ${x} ${y})"/>`).join('')}
      ${dots([[150, 92], [196, 126], [124, 130], [172, 148]], 9, '#e44b3c')}${dots([[150, 92], [196, 126], [124, 130], [172, 148]], 3.5, '#f4796c')}
      ${dots([[178, 100], [134, 104], [160, 126]], 8, '#c5e9a6')}${dots([[178, 100], [134, 104], [160, 126]], 4, '#e8f7d3')}${dots([[206, 98], [142, 148], [112, 98], [188, 142], [162, 80]], 3, '#f7d34a')}${dots([[120, 120], [200, 84]], 4.5, '#5b3a73')}`),
    soup: () => frame('#ffe7e0', '#ffc8bb', `${shadow}<circle cx="160" cy="110" r="88" fill="#fff"/><circle cx="160" cy="110" r="74" fill="#eef1f5"/><circle cx="160" cy="110" r="62" fill="#d7452f"/><circle cx="160" cy="110" r="52" fill="#e5603f"/>
      <path d="M126 110q16-22 34-6t34-6" stroke="#fff4e8" stroke-width="7" stroke-linecap="round" fill="none"/>${[[140, 130], [182, 128], [170, 88], [128, 94]].map(([x, y]) => `<ellipse cx="${x}" cy="${y}" rx="8" ry="3.5" fill="#3f9f4b" transform="rotate(${x % 70} ${x} ${y})"/>`).join('')}
      <rect x="224" y="40" width="9" height="86" rx="4" fill="#b9c0cb" transform="rotate(28 228 80)"/><ellipse cx="248" cy="38" rx="14" ry="9" fill="#cfd5de" transform="rotate(28 248 38)"/>`),
    drink: (h) => { const c = [['#ff9f2e', '#ffd08a'], ['#59c36a', '#b7ecbf'], ['#ee5d8a', '#ffc1d4'], ['#8a5bd6', '#d6c0f7']][h % 4]; return frame('#e5f2ff', '#c6e0ff', `${shadow}
      <path d="M112 62h96l-10 124a10 10 0 0 1-10 9h-56a10 10 0 0 1-10-9z" fill="#fff" opacity=".55" stroke="#c9d3e0" stroke-width="3"/><path d="M118 90h84l-7 96a8 8 0 0 1-8 7h-54a8 8 0 0 1-8-7z" fill="${c[0]}"/><path d="M118 90h84l-1.5 18h-81z" fill="${c[1]}" opacity=".7"/>
      <rect x="132" y="104" width="30" height="30" rx="7" fill="#fff" opacity=".45" transform="rotate(-12 147 119)"/><rect x="164" y="128" width="28" height="28" rx="7" fill="#fff" opacity=".4" transform="rotate(14 178 142)"/>
      <rect x="170" y="22" width="9" height="120" rx="4.5" fill="#ff5d5d" transform="rotate(14 174 80)"/><circle cx="214" cy="70" r="24" fill="#ffd84d"/><circle cx="214" cy="70" r="18" fill="#ffe98a"/><path d="M214 52v36M196 70h36M201 57l26 26M227 57l-26 26" stroke="#ffd84d" stroke-width="2"/>`); },
    coffee: () => frame('#f6ebdd', '#e5cdb0', `${shadow}<ellipse cx="160" cy="170" rx="96" ry="24" fill="#fff"/><ellipse cx="160" cy="166" rx="74" ry="17" fill="#eceff3"/>
      <path d="M108 88h104v50a42 42 0 0 1-42 42h-20a42 42 0 0 1-42-42z" fill="#fff"/><path d="M212 100h14a20 20 0 0 1 0 40h-18" stroke="#fff" stroke-width="10" fill="none" stroke-linecap="round"/><ellipse cx="160" cy="88" rx="52" ry="12" fill="#7a4a28"/><ellipse cx="160" cy="88" rx="38" ry="8" fill="#a8703f"/>
      <path d="M146 88q14-8 28 0q-14 5-28 0z" fill="#f3dfc4"/><path d="M140 62q-10-14 0-26M162 58q-10-14 0-30M184 62q-10-14 0-26" stroke="#fff" stroke-width="5" stroke-linecap="round" fill="none" opacity=".8"/>`),
    icecream: (h) => { const c = [['#f9a8c9', '#ffd6e6'], ['#ffe2a8', '#fff1cf'], ['#b78a62', '#d9b896']][h % 3]; return frame('#ffe6f1', '#f8c6dc', `${shadow}
      <path d="M126 112h68l-34 88z" fill="#e0a45b"/><path d="M134 126l50 14M130 140l56 16M142 160l36 8M150 112l22 70M170 112l-18 70" stroke="#c4843a" stroke-width="2" opacity=".7"/>
      <circle cx="160" cy="86" r="42" fill="${c[0]}"/><circle cx="160" cy="62" r="34" fill="${c[1]}"/><path d="M126 104q34 18 68 0v10h-68z" fill="${c[0]}"/><circle cx="160" cy="26" r="9" fill="#d6283f"/><path d="M160 18q8-10 16-8" stroke="#3f9f4b" stroke-width="3" fill="none"/>${dots([[142, 60], [176, 70], [158, 90], [138, 84], [182, 52]], 2.6, '#ff6b9a')}`); },
    dessert: () => frame('#fde7f2', '#f8c8de', `${shadow}<ellipse cx="160" cy="172" rx="100" ry="22" fill="#fff"/><ellipse cx="160" cy="168" rx="80" ry="15" fill="#eceff3"/>
      <path d="M96 120L214 98l8 44-118 22z" fill="#6a3b22"/><path d="M96 120L214 98l-2-14L94 108z" fill="#f6dcc0"/><path d="M104 148L220 126l2 16-118 22z" fill="#f6dcc0"/><path d="M94 108L212 84l4 14L96 122z" fill="#8b5233"/>
      <path d="M92 108q28 8 56-6t58-16l8 8-124 28z" fill="#4a2616"/><circle cx="196" cy="80" r="16" fill="#e0233f"/><circle cx="192" cy="76" r="5" fill="#ff7a8e"/><path d="M196 66q6-12 16-12" stroke="#3f9f4b" stroke-width="3" fill="none"/>`),
    chicken: () => frame('#fcebd9', '#f3c9a0', `${shadow}${plate}
      <g transform="rotate(-24 160 108)"><ellipse cx="150" cy="100" rx="46" ry="26" fill="#b5652a"/><ellipse cx="146" cy="94" rx="36" ry="16" fill="#cf7d38"/><rect x="186" y="96" width="40" height="11" rx="5" fill="#f6ead8"/><circle cx="230" cy="94" r="8" fill="#f6ead8"/><circle cx="230" cy="110" r="8" fill="#f6ead8"/></g>
      <g transform="rotate(14 160 130)"><ellipse cx="150" cy="140" rx="42" ry="22" fill="#a65a24"/><ellipse cx="146" cy="134" rx="32" ry="13" fill="#c4742f"/><rect x="182" y="136" width="36" height="10" rx="5" fill="#f6ead8"/><circle cx="222" cy="134" r="7" fill="#f6ead8"/><circle cx="222" cy="148" r="7" fill="#f6ead8"/></g>
      ${[[120, 92], [136, 82], [170, 98]].map(([x, y]) => `<path d="M${x} ${y}l14 8" stroke="#7a3f17" stroke-width="3" opacity=".5"/>`).join('')}<path d="M92 142q10-18 24-8-6 18-24 8zM104 76q16-8 20 8-14 8-20-8z" fill="#4aa653"/><path d="M214 70a18 18 0 1 1 0 .1z" fill="#ffd84d"/><path d="M214 70m-18 0h36M214 52v36" stroke="#f3b800" stroke-width="2"/>`),
    fish: () => frame('#e0f1fc', '#bfdff5', `${shadow}${plate}
      <path d="M92 108q40-44 96-20l30-22v84l-30-22q-56 24-96-20z" fill="#9db4c8"/><path d="M92 108q40-40 96-18q-52 4-96 18z" fill="#c4d4e2"/><path d="M92 108q40 40 96 18q-52-4-96-18z" fill="#e3ebf2"/>
      <path d="M130 84q10 24 0 48M152 80q10 28 0 56M174 82q8 26 0 52" stroke="#7d97ae" stroke-width="3" fill="none" opacity=".7"/><circle cx="112" cy="102" r="6" fill="#fff"/><circle cx="111" cy="102" r="3" fill="#1f2a37"/>
      <circle cx="226" cy="146" r="22" fill="#ffe14d"/><path d="M226 124v44M204 146h44" stroke="#f3b800" stroke-width="2"/><path d="M96 150q12-14 24-4-8 16-24 4zM112 66q14-8 20 6-14 10-20-6z" fill="#4aa653"/>`),
    pasta: () => frame('#fff5d9', '#ffe0a4', `${shadow}${plate}<circle cx="160" cy="108" r="58" fill="#f1c25a"/>
      ${[52, 44, 36, 28, 20].map((r, i) => `<ellipse cx="${160 + (i % 2 ? 3 : -3)}" cy="${108 + (i % 2 ? -2 : 2)}" rx="${r}" ry="${r - 4}" fill="none" stroke="${i % 2 ? '#e3a93b' : '#f7d57f'}" stroke-width="5"/>`).join('')}
      <circle cx="160" cy="100" r="22" fill="#d7402c"/><circle cx="154" cy="94" r="8" fill="#ea6a4f"/>${dots([[144, 112], [176, 108], [162, 122]], 6, '#c53a28')}<ellipse cx="176" cy="88" rx="12" ry="5" fill="#3f9f4b" transform="rotate(-30 176 88)"/>${dots([[130, 100], [190, 120], [150, 134], [184, 84]], 2.4, '#fff7e0')}`),
    rice: () => frame('#f5f0e4', '#e8dcc4', `${shadow}${plate}<path d="M96 140q64-84 128 0z" fill="#fff"/><path d="M104 138q56-70 112 0z" fill="#f4e7c2"/>
      ${Array.from({ length: 34 }, (_, i) => { const a = (i * 53) % 100, b = (i * 37) % 60; return `<ellipse cx="${112 + a}" cy="${96 + b / 1.6 + (a > 50 ? 8 : 0)}" rx="5" ry="2" fill="#fff" stroke="#e6d6a8" stroke-width=".6" transform="rotate(${(i * 41) % 180} ${112 + a} ${96 + b / 1.6})"/>`; }).join('')}
      ${dots([[140, 118], [170, 104], [188, 124], [152, 132]], 4, '#5bb85d')}${[[130, 126], [180, 112], [162, 128]].map(([x, y]) => `<rect x="${x}" y="${y}" width="7" height="7" rx="1.5" fill="#f08a2c"/>`).join('')}`),
    fries: () => frame('#fff1d9', '#ffd79f', `${shadow}
      ${Array.from({ length: 13 }, (_, i) => `<rect x="${112 + i * 8}" y="${34 + (i * 11) % 24}" width="9" height="${96 - (i * 11) % 24}" rx="3" fill="${i % 2 ? '#f7c948' : '#f2b92e'}" transform="rotate(${(i - 6) * 3.4} ${116 + i * 8} 130)"/>`).join('')}
      <path d="M100 112h120l-12 84a8 8 0 0 1-8 7h-80a8 8 0 0 1-8-7z" fill="#e23c3c"/><path d="M104 140h112" stroke="#fff" stroke-width="22" opacity=".9"/><path d="M104 140h112" stroke="#e23c3c" stroke-width="8"/><circle cx="160" cy="154" r="14" fill="#ffd84d"/>`),
    breakfast: () => frame('#fff7d9', '#ffe79c', `${shadow}${plate}
      <path d="M92 96q24-14 32 8t30 6 24 22-20 18-38 4-34-20 6-38z" fill="#fff"/><circle cx="130" cy="112" r="18" fill="#ffb81f"/><circle cx="124" cy="106" r="6" fill="#ffd96b"/>
      <path d="M170 88q22-12 40 4t6 36-34 14-24-20 12-34z" fill="#fff"/><circle cx="192" cy="112" r="15" fill="#ffb81f"/><circle cx="187" cy="107" r="5" fill="#ffd96b"/>
      <path d="M104 150q20-12 40-4t36-2" stroke="#b6382a" stroke-width="8" stroke-linecap="round" fill="none"/><path d="M104 150q20-12 40-4t36-2" stroke="#e76a58" stroke-width="3" stroke-linecap="round" fill="none"/><path d="M200 64l18 18-26 6z" fill="#e9b563"/>`),
    plate: () => frame('#eef2f8', '#d6e0ee', `${shadow}<path d="M80 168a80 80 0 0 1 160 0z" fill="#fff" stroke="#cfd7e3" stroke-width="3"/><rect x="62" y="166" width="196" height="12" rx="6" fill="#dfe6f0"/><circle cx="160" cy="76" r="9" fill="#fff" stroke="#cfd7e3" stroke-width="3"/><path d="M112 140q20-34 56-40" stroke="#fff" stroke-width="6" stroke-linecap="round" fill="none" opacity=".9"/>`),
  };
  const cache = {};
  function dish(name, category) {
    const k = kindOf(name, category), h = hash(String(name || ''));
    const key = k + (k === 'drink' ? h % 4 : k === 'icecream' ? h % 3 : '');
    return cache[key] || (cache[key] = uri(ART[k](h)));
  }
  /** <img> for a dish: its own photo when there is one, otherwise the illustration (also the fallback if the photo fails to load). */
  function dishImg(item, category, cls = '') {
    const fb = dish(item && item.name, category), src = item && item.image ? photo(item.image) : fb;
    return `<img class="${cls}" src="${E(src)}" alt="" loading="lazy" decoding="async"${src !== fb ? ` data-fb="${fb}" onerror="if(this.dataset.fb&&this.src!==this.dataset.fb){this.src=this.dataset.fb}"` : ''}>`;
  }

  /* ---------- table with chairs ---------- */
  function table(seats) {
    const n = Math.max(1, Math.min(16, Number(seats) || 2)), top = Math.ceil(n / 2), bot = n - top;
    const W = n <= 2 ? 84 : n <= 4 ? 96 : n <= 6 ? 116 : n <= 10 ? 150 : 190, H = 72, round = n <= 2;
    const tw = W - 36, row = (cnt, y) => Array.from({ length: cnt }, (_, i) => { const cx = 18 + tw * ((i + 0.5) / cnt); return `<rect x="${(cx - 8).toFixed(1)}" y="${y}" width="16" height="9" rx="4.5" fill="currentColor" opacity=".6"/>`; }).join('');
    return `<svg class="hx-tsvg" viewBox="0 0 ${W} ${H}" aria-hidden="true">${row(top, 6)}${row(bot, 57)}${round ? `<circle cx="${W / 2}" cy="36" r="18" fill="currentColor"/>` : `<rect x="18" y="19" width="${tw}" height="34" rx="14" fill="currentColor"/>`}</svg>`;
  }

  /* ---------- bed ---------- */
  function bed(kind) {
    const twin = /twin|single|double/i.test(kind || '') && !/king|queen|suite|deluxe/i.test(kind || '');
    const one = (x) => `<rect x="${x}" y="26" width="${twin ? 38 : 52}" height="12" rx="6" fill="#fff" opacity=".9"/><rect x="${x - 4}" y="38" width="${twin ? 46 : 60}" height="22" rx="5" fill="currentColor" opacity=".55"/>`;
    return `<svg class="hx-bsvg" viewBox="0 0 120 72" aria-hidden="true"><rect x="10" y="4" width="100" height="26" rx="9" fill="currentColor" opacity=".4"/><rect x="6" y="18" width="108" height="46" rx="8" fill="currentColor"/>${twin ? one(14) + one(68) : one(34)}<rect x="6" y="56" width="6" height="12" rx="2" fill="currentColor"/><rect x="108" y="56" width="6" height="12" rx="2" fill="currentColor"/></svg>`;
  }

  /* ---------- donut ---------- */
  function donut(parts, centre, sub) {
    const total = parts.reduce((a, p) => a + (p.value || 0), 0), R = 54, C = 2 * Math.PI * R; let off = 0;
    const arcs = total ? parts.filter((p) => p.value > 0).map((p) => { const len = (p.value / total) * C, a = `<circle cx="80" cy="80" r="${R}" fill="none" stroke="${p.color}" stroke-width="22" stroke-dasharray="${(len - 2).toFixed(2)} ${(C - len + 2).toFixed(2)}" stroke-dashoffset="${(-off).toFixed(2)}" transform="rotate(-90 80 80)"/>`; off += len; return a; }).join('') : '';
    return `<svg class="hx-donut" viewBox="0 0 160 160" role="img" aria-label="${E(centre || '')}"><circle cx="80" cy="80" r="${R}" fill="none" stroke="#eef1f5" stroke-width="22"/>${arcs}<text x="80" y="${sub ? 78 : 86}" text-anchor="middle" class="dv">${E(centre == null ? '' : centre)}</text>${sub ? `<text x="80" y="98" text-anchor="middle" class="ds">${E(sub)}</text>` : ''}</svg>`;
  }

  HX.art = { dish, dishImg, kindOf, table, bed, donut, hash };

  /* ---------- coloured KPI tile ---------- */
  HX.kpi = (label, value, sub, tone = 'blue', ic = '', badge = '') =>
    `<div class="hx-kpi hx-k-${tone}"><span class="kic">${ic ? HX.icon(ic) : ''}</span><small>${E(label)}</small><b>${value}</b>${sub ? `<em>${sub}</em>` : ''}${badge ? `<i class="kb">${badge}</i>` : ''}</div>`;
})(window);
