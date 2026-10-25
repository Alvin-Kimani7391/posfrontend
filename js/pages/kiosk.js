/**
 * kiosk.js - customer self-service kiosk (public, no login). Opened from /kiosk/<token> (see vercel.json rewrite).
 * Talks ONLY to /api/v1/public/kiosk/:token/*. The server prices every line, checks the table, takes the payment and sends the order
 * to the kitchen after payment is verified - this page just shows what the server says and never decides money or payment state.
 *
 *   welcome -> shop (menu + order panel) -> checkout (M-PESA / cash) -> pay screen (polls the server) -> done (pickup number + progress)
 */
(function () {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const E = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const mt = location.pathname.match(/\/kiosk\/([^/?#]+)/);
  const TOKEN = mt ? decodeURIComponent(mt[1]) : (new URLSearchParams(location.search).get('t') || '');
  const BASE = window.APP_CONFIG.API_BASE_URL + '/public/kiosk/' + encodeURIComponent(TOKEN);
  const KEY = 'kiosk.order.' + TOKEN.slice(-12);
  const PHONE_RX = /^(?:\+?254|0)?[17]\d{8}$/;
  const TYPE_LABEL = { DINE_IN: 'Dine in', TAKEAWAY: 'Take away' };

  const IC = {
    dine: '<svg class="i" viewBox="0 0 24 24"><path d="M4 3v7a2 2 0 0 0 2 2v9M8 3v7M6 3v9M16 21V3c-2 1-4 4-4 8 0 2 1 3 4 3"/></svg>',
    bag: '<svg class="i" viewBox="0 0 24 24"><path d="M5 8h14l-1 12H6L5 8Z"/><path d="M9 8a3 3 0 0 1 6 0"/></svg>',
    phone: '<svg class="i" viewBox="0 0 24 24"><rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/></svg>',
    cash: '<svg class="i" viewBox="0 0 24 24"><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/></svg>',
    check: '<svg class="i" viewBox="0 0 24 24"><path d="m5 12 5 5 9-10"/></svg>',
    cross: '<svg class="i" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>',
    cart: '<svg class="i" viewBox="0 0 24 24"><circle cx="9" cy="20" r="1.5"/><circle cx="18" cy="20" r="1.5"/><path d="M2 3h3l2.7 12.4a1 1 0 0 0 1 .8h8.9a1 1 0 0 0 1-.8L20 8H6"/></svg>',
    print: '<svg class="i" viewBox="0 0 24 24"><path d="M7 9V3h10v6M7 17H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2"/><rect x="7" y="14" width="10" height="7"/></svg>',
    warn: '<svg class="i" viewBox="0 0 24 24"><path d="M12 3 2 20h20L12 3Z"/><path d="M12 10v5M12 18h.01"/></svg>',
    clock: '<svg class="i" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
    bowl: '<svg class="i" viewBox="0 0 24 24"><path d="M3 11h18a9 9 0 0 1-18 0Z"/><path d="M8 7c0-1.5 1-1.5 1-3M12 7c0-1.5 1-1.5 1-3M16 7c0-1.5 1-1.5 1-3"/></svg>',
  };

  const S = {
    ctx: null, types: [], orderType: null, table: null, menu: null, items: {}, catId: 'all', q: '',
    cart: [], quote: null, quoteSeq: 0, cartErr: '', clientRef: null, busy: false,
    code: null, order: null, payment: null, bill: null, polling: null, paidAt: 0, resetTimer: null, payStart: 0,
  };
  let CUR = 'KES';
  const money = (n) => {
    n = Number(n || 0); const f = Number.isInteger(n) ? 0 : 2;
    try { return new Intl.NumberFormat('en-KE', { style: 'currency', currency: CUR, minimumFractionDigits: f, maximumFractionDigits: 2 }).format(n).replace(/\u00a0/g, ' '); }
    catch (e) { return CUR + ' ' + n.toFixed(f); }
  };

  // ------------------------------------------------------------------ network
  function mkErr(message, code, status) { const e = new Error(message); e.code = code; e.status = status; return e; }
  async function api(path, { method = 'GET', body, query } = {}) {
    let url = BASE + path;
    if (query) { const q = new URLSearchParams(); Object.keys(query).forEach((k) => { if (query[k] != null && query[k] !== '') q.set(k, query[k]); }); const s = q.toString(); if (s) url += '?' + s; }
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 25000);
    let res;
    try { res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: ctl.signal }); }
    catch (e) { throw mkErr('Cannot reach the server. Please check the connection and try again.', 'NETWORK_ERROR', 0); }
    finally { clearTimeout(t); }
    let j = null; try { j = await res.json(); } catch (e) { /* not json */ }
    if (!res.ok || (j && j.success === false)) throw mkErr((j && j.message) || 'Something went wrong. Please try again.', j && j.code, res.status);
    return j && j.data !== undefined ? j.data : j;
  }
  function toast(msg) { const t = $('#toast'); const d = document.createElement('div'); d.textContent = msg; t.appendChild(d); setTimeout(() => d.remove(), 3500); }

  // ------------------------------------------------------------------ screens
  const SCREENS = ['fatal', 'welcome', 'shop', 'pay'];
  function show(name) { SCREENS.forEach((s) => { $('#' + s).hidden = s !== name; }); closeModal(); }
  function fatal(msg) {
    stopPoll(); show('fatal');
    $('#fatal').innerHTML = `<div class="ico warn">${IC.warn}</div><h1>Sorry, we can’t take orders here</h1><p class="lead">${E(msg || 'Please order at the counter.')}</p>`;
  }
  const initial = (s) => E(String(s || '?').trim().charAt(0).toUpperCase());

  function showWelcome() {
    stopPoll(); clearReset(); sessionStorage.removeItem(KEY);
    Object.assign(S, { orderType: null, table: null, menu: null, items: {}, catId: 'all', q: '', cart: [], quote: null, cartErr: '', clientRef: null, code: null, order: null, payment: null, bill: null });
    const c = S.ctx, o = c.options;
    S.types = [o.dineIn && 'DINE_IN', o.takeAway && 'TAKEAWAY'].filter(Boolean);
    if (!S.types.length) return fatal('Ordering is not available on this kiosk right now. Please order at the counter.');
    const logo = c.business.logo ? `<img src="${E(c.business.logo)}" alt="" onerror="this.remove()">` : initial(c.business.name);
    $('#welcome').innerHTML = `<div class="welcome-logo">${logo}</div><h1>${E(c.business.name)}</h1>
      <p class="lead">${E(c.welcome || 'Order here, pay, and we’ll bring it to you.')}</p>
      <div class="choose">${S.types.map((t) => `<button class="bigopt" data-act="start" data-t="${t}">${t === 'DINE_IN' ? IC.dine : IC.bag}${TYPE_LABEL[t]}<small>${t === 'DINE_IN' ? 'Eat here at a table' : 'Collect and go'}</small></button>`).join('')}</div>`;
    show('welcome');
  }

  async function start(type) {
    S.orderType = type; S.table = null;
    try { await loadMenu(); } catch (e) { return toast(e.message); }
    show('shop'); renderShop();
    if (type === 'DINE_IN' && S.ctx.options.tablesRequired) openTables();
  }

  async function loadMenu() {
    const d = await api('/menu', { query: { orderType: S.orderType } });
    S.menu = d; S.items = {};
    (d.categories || []).forEach((c) => (c.items || []).forEach((i) => { S.items[i.id] = Object.assign({ catName: c.name }, i); }));
    // keep what is already in the cart in step with the (possibly different) menu
    S.cart = S.cart.map((l) => (S.items[l.item.id] ? Object.assign(l, { item: S.items[l.item.id] }) : l));
  }

  // ------------------------------------------------------------------ shop rendering
  const allItems = () => (S.menu ? S.menu.categories.flatMap((c) => (c.items || []).map((i) => S.items[i.id])) : []);
  const qtyOf = (id) => S.cart.filter((l) => l.item.id === id).reduce((a, l) => a + l.qty, 0);
  const cartCount = () => S.cart.reduce((a, l) => a + l.qty, 0);
  const hasChoices = (i) => (i.variants && i.variants.length) || (i.modifierGroups && i.modifierGroups.length) || i.isCombo;
  const comboOk = (i) => !i.isCombo || (i.comboGroups || []).every((g) => g.id);
  function fromPrice(i) {
    if (i.price != null) return money(i.price);
    const ps = (i.variants || []).map((v) => v.price).filter((p) => p != null);
    return ps.length ? 'From ' + money(Math.min.apply(null, ps)) : '—';
  }

  function renderShop() { renderTop(); renderCats(); renderGrid(); renderPanel(); }
  function renderTop() {
    const c = S.ctx; const logo = c.business.logo ? `<img src="${E(c.business.logo)}" alt="" onerror="this.remove()">` : initial(c.business.name);
    $('#brand').innerHTML = `<div class="lg">${logo}</div><div>${E(c.business.name)}<small>${E(c.branch || '')}</small></div>`;
    $('#modeTabs').innerHTML = typeButtons('pillbtn');
  }
  const typeButtons = (cls) => S.types.map((t) => `<button class="${cls} ${S.orderType === t ? 'on' : ''}" data-act="type" data-t="${t}">${t === 'DINE_IN' ? IC.dine : IC.bag} ${TYPE_LABEL[t]}</button>`).join('');

  function renderCats() {
    const cats = (S.menu && S.menu.categories || []).filter((c) => (c.items || []).length);
    const total = cats.reduce((a, c) => a + c.items.length, 0);
    const th = (c) => { const im = (c.items.find((i) => i.image) || {}).image; return im ? `<img src="${E(im)}" alt="" onerror="this.remove()">` : initial(c.name); };
    $('#cats').innerHTML = `<button class="cat ${S.catId === 'all' ? 'on' : ''}" data-act="cat" data-id="all"><span class="th">${IC.bowl}</span><span>All menu<small>${total} items</small></span></button>`
      + cats.map((c) => `<button class="cat ${S.catId === c.id ? 'on' : ''}" data-act="cat" data-id="${E(c.id)}"><span class="th">${th(c)}</span><span>${E(c.name)}<small>${c.items.length} items</small></span></button>`).join('');
  }

  function card(i) {
    const out = i.available === false || !comboOk(i); const q = qtyOf(i.id);
    const pic = `<div class="pic">${i.promoLabel ? `<span class="badge">${E(i.promoLabel)}</span>` : ''}${i.image ? `<img src="${E(i.image)}" alt="" loading="lazy" onerror="this.remove()">` : initial(i.name)}</div>`;
    const sold = out ? `<div class="soldout">${i.available === false ? E(i.unavailableReason || 'Sold out') : 'Ask a member of staff'}</div>` : '';
    const ctl = out ? '' : q
      ? `<span class="step"><button data-act="dec" data-id="${E(i.id)}" aria-label="Remove one">−</button><b>${q}</b><button class="plus" data-act="add" data-id="${E(i.id)}" aria-label="Add one">+</button></span>`
      : `<span class="step"><button class="plus" data-act="add" data-id="${E(i.id)}" aria-label="Add">+</button></span>`;
    return `<div class="card ${out ? 'out' : ''}" ${out ? '' : `data-act="add" data-id="${E(i.id)}"`}>${pic}${sold}<div class="cn"><span>${E(i.catName || '')}</span></div><h3>${E(i.name)}</h3><div class="row"><span class="price">${fromPrice(i)}</span>${ctl}</div></div>`;
  }
  function renderGrid() {
    const q = S.q.trim().toLowerCase(); let items;
    if (q) items = allItems().filter((i) => (i.name + ' ' + (i.description || '')).toLowerCase().includes(q));
    else if (S.catId === 'all') items = allItems();
    else items = ((S.menu.categories.find((c) => c.id === S.catId) || {}).items || []).map((i) => S.items[i.id]);
    $('#grid').innerHTML = items.length ? items.map(card).join('') : '<div class="empty">Nothing found. Try another search.</div>';
  }

  // ------------------------------------------------------------------ order panel
  const unitEst = (l) => {
    let b = l.item.price || 0;
    if (l.variant) b = l.variant.price != null ? l.variant.price : b + (l.variant.priceDelta || 0);
    return b + l.mods.reduce((a, x) => a + (x.priceDelta || 0), 0);
  };
  const lineTotal = (l, k) => (S.quote && S.quote.lines && S.quote.lines[k] ? S.quote.lines[k].lineTotal : unitEst(l) * l.qty);
  const needTable = () => S.orderType === 'DINE_IN' && S.ctx.options.tablesRequired;

  function renderPanel() {
    const n = cartCount();
    $('#pSub').textContent = n ? n + (n === 1 ? ' item' : ' items') : '';
    $('#typeSeg').innerHTML = typeButtons('');
    const tb = $('#tableBtn'); tb.hidden = !needTable();
    if (needTable()) { tb.className = 'tablebtn' + (S.table ? ' set' : ''); tb.innerHTML = `<span>${S.table ? 'Table ' + E(S.table.name) : 'Choose your table'}</span><span>${S.table ? 'Change' : '›'}</span>`; }
    $('#plist').innerHTML = S.cart.length
      ? `<div class="lab">Ordered menu <span>Total items: ${n}</span></div>` + S.cart.map(lineHtml).join('')
      : `<div class="pempty">${IC.cart}Your order is empty.<br>Tap a dish to add it.</div>`;
    const t = S.quote && S.quote.totals; const sub = S.cart.reduce((a, l, k) => a + lineTotal(l, k), 0);
    const rows = t
      ? [['Sub total', t.itemsTotal], t.serviceCharge ? ['Service charge', t.serviceCharge] : null, t.tax ? [S.ctx.options.taxInclusive ? 'VAT included' : 'Tax', t.tax] : null]
      : [['Sub total', sub]];
    const total = t ? t.total : sub;
    $('#psum').innerHTML = S.cart.length ? `<h4>Payment summary</h4>${rows.filter(Boolean).map((r) => `<div class="r"><span>${r[0]}</span><span>${money(r[1])}</span></div>`).join('')}<div class="tot"><span>Amount to be paid</span><span>${money(total)}</span></div>` : '';
    const ok = S.cart.length && !S.cartErr;
    $('#pact').innerHTML = (S.cartErr ? `<div class="err">${E(S.cartErr)}</div>` : '')
      + `<button class="btn block" data-act="checkout" ${ok ? '' : 'disabled'}>Pay${S.cart.length ? ' · ' + money(total) : ''}</button>`
      + (S.cart.length ? '<button class="btn alt red block" data-act="clear">Clear order</button>' : '');
    const bar = $('#cartbar'); bar.hidden = !S.cart.length;
    bar.innerHTML = `<span><span class="n">${n}</span>View order</span><span>${money(total)}</span>`;
  }
  function lineHtml(l, k) {
    const opts = [l.variant && l.variant.name].concat(l.mods.map((m) => m.name)).concat(l.picks.map((p) => p.name)).filter(Boolean).join(' · ');
    return `<div class="line"><div class="th">${l.item.image ? `<img src="${E(l.item.image)}" alt="" onerror="this.remove()">` : initial(l.item.name)}</div>
      <div><h4>${E(l.item.name)}</h4>${opts ? `<div class="opt">${E(opts)}</div>` : ''}</div><div class="amt">${money(lineTotal(l, k))}</div>
      <div class="ft"><span class="step"><button data-act="ldec" data-k="${k}" aria-label="Less">−</button><b>${l.qty}</b><button class="plus" data-act="linc" data-k="${k}" aria-label="More">+</button></span>
      <button class="note" data-act="note" data-k="${k}">${l.notes ? 'Edit note' : 'Add note'}</button><button class="rm" data-act="lrm" data-k="${k}" aria-label="Remove">×</button></div>
      ${l.notes ? `<div class="noteshow">Note: ${E(l.notes)}</div>` : ''}</div>`;
  }

  // ------------------------------------------------------------------ cart + server quote
  const keyOf = (item, variant, mods, picks) => [item.id, variant ? variant.id : '', mods.map((m) => m.optionId).sort().join(','), picks.map((p) => p.groupId + ':' + p.menuItemId).sort().join(',')].join('|');
  function addLine(item, variant, mods, picks, qty, notes) {
    const key = keyOf(item, variant, mods, picks); const ex = S.cart.find((l) => l.key === key && (l.notes || '') === (notes || ''));
    if (ex) ex.qty = Math.min(50, ex.qty + qty);
    else { if (S.cart.length >= 60) return toast('Your order is full. Please check out first.'); S.cart.push({ key, item, variant, mods, picks, qty, notes: notes || '' }); }
    cartChanged();
  }
  function cartChanged() { S.quote = null; S.cartErr = ''; S.clientRef = null; renderGrid(); renderPanel(); scheduleQuote(); }
  let qTimer = null;
  function scheduleQuote() { clearTimeout(qTimer); if (!S.cart.length) return; qTimer = setTimeout(runQuote, 350); }
  const apiItems = () => S.cart.map((l) => ({
    menuItemId: l.item.id, quantity: l.qty, variantId: l.variant ? l.variant.id : undefined,
    modifiers: l.mods.length ? l.mods.map((m) => ({ groupId: m.groupId, optionId: m.optionId })) : undefined,
    comboPicks: l.picks.length ? l.picks.map((p) => ({ groupId: p.groupId, menuItemId: p.menuItemId })) : undefined, notes: l.notes || undefined,
  }));
  async function runQuote() {
    if (!S.cart.length || (needTable() && !S.table)) return;
    const seq = ++S.quoteSeq;
    try {
      const q = await api('/quote', { method: 'POST', body: { orderType: S.orderType, tableId: S.orderType === 'DINE_IN' && S.table ? S.table.id : undefined, items: apiItems() } });
      if (seq !== S.quoteSeq) return; S.quote = q; S.cartErr = ''; renderPanel();
    } catch (e) {
      if (seq !== S.quoteSeq) return;
      if (e.code === 'TABLE_UNAVAILABLE') { S.table = null; renderPanel(); toast(e.message); return openTables(); }
      S.cartErr = e.message; renderPanel();
    }
  }

  // ------------------------------------------------------------------ modals
  function openModal(html, cls) { const m = $('#modal'); m.onclick = null; m.innerHTML = `<div class="ov"><div class="sheet ${cls || ''}" role="dialog" aria-modal="true">${html}</div></div>`; return m; }
  function closeModal() { const m = $('#modal'); m.onclick = null; m.innerHTML = ''; }
  function confirmBox(title, text, yes, cb, no) {
    openModal(`<div class="sh-h"><h3>${E(title)}</h3></div><div class="sh-b"><p>${E(text)}</p></div><div class="sh-f"><button class="btn alt" data-m="close">${E(no || 'Keep going')}</button><button class="btn" data-m="yes">${E(yes)}</button></div>`);
    $('#modal [data-m=yes]').onclick = () => { closeModal(); cb(); };
  }

  async function openTables() {
    openModal(`<div class="sh-h"><h3>Choose your table</h3><button class="x" data-m="close">×</button></div><div class="sh-b"><div class="msg">Loading tables…</div></div>`, 'wide');
    try {
      const d = await api('/tables'); const list = d.tables || [];
      $('#modal .sh-b').innerHTML = list.length
        ? `<div class="tgrid">${list.map((t) => `<button class="tbl ${S.table && S.table.id === t.id ? 'on' : ''} ${t.selectable ? '' : 'no'}" data-m="tbl" data-id="${E(t.id)}" data-n="${E(t.name)}">${E(t.name)}<small>${t.selectable ? (t.seats ? t.seats + ' seats' : 'Free') : (t.state === 'RESERVED' ? 'Reserved' : 'Taken')}</small></button>`).join('')}</div>`
        : '<div class="msg">No tables are available right now. Please ask a member of staff.</div>';
    } catch (e) { $('#modal .sh-b').innerHTML = `<div class="err">${E(e.message)}</div>`; }
  }

  function noteModal(k) {
    const l = S.cart[k]; if (!l) return;
    openModal(`<div class="sh-h"><h3>Note for ${E(l.item.name)}</h3><button class="x" data-m="close">×</button></div><div class="sh-b"><textarea class="area" id="nt" rows="3" maxlength="200" placeholder="e.g. no onions, extra spicy">${E(l.notes)}</textarea><div class="hint">Up to 200 characters.</div></div><div class="sh-f"><button class="btn" data-m="savenote" data-k="${k}">Save note</button></div>`);
    setTimeout(() => { const t = $('#nt'); if (t) t.focus(); }, 60);
  }

  // ---- item options (size, extras, combo picks)
  function optionsModal(item) {
    const groups = (item.modifierGroups || []).map((g) => ({ kind: 'mod', g, name: g.name, min: g.required ? Math.max(g.min || 1, 1) : (g.min || 0), max: g.max || 0, opts: (g.options || []).map((o) => ({ id: o.id, name: o.name, delta: o.priceDelta || 0, raw: o })) }));
    (item.comboGroups || []).forEach((g) => groups.push({ kind: 'combo', g, name: g.name, min: g.min == null ? 1 : g.min, max: g.max || 1, opts: (g.options || []).map((o) => ({ id: o.menuItemId, name: (S.items[o.menuItemId] || {}).name || 'Item', delta: 0, raw: o })) }));
    const st = { variantId: item.requireVariant && item.variants[0] ? item.variants[0].id : null, sel: groups.map(() => new Set()), qty: 1, notes: '' };
    const variant = () => (item.variants || []).find((v) => v.id === st.variantId) || null;
    const picked = (gi) => st.sel[gi].size;
    const invalid = () => {
      if (item.requireVariant && !st.variantId) return 'Choose a size';
      for (let i = 0; i < groups.length; i++) if (picked(i) < groups[i].min) return `Choose ${groups[i].min > 1 ? 'at least ' + groups[i].min : 'one'} for “${groups[i].name}”`;
      if (item.price == null && !variant()) return 'Choose a size';
      return '';
    };
    const est = () => {
      const v = variant(); let b = item.price || 0; if (v) b = v.price != null ? v.price : b + (v.priceDelta || 0);
      groups.forEach((gr, gi) => { if (gr.kind === 'mod') gr.opts.forEach((o) => { if (st.sel[gi].has(o.id)) b += o.delta; }); });
      return b * st.qty;
    };
    const body = () => {
      const bad = invalid();
      $('#modal .sh-b').innerHTML = `<div class="hero">${item.image ? `<img src="${E(item.image)}" alt="" onerror="this.remove()">` : ''}</div>
        ${item.description ? `<p class="msg" style="margin:0 0 6px">${E(item.description)}</p>` : ''}
        ${(item.allergens || []).length ? `<div class="hint">Contains: ${E(item.allergens.join(', '))}</div>` : ''}
        ${item.variants && item.variants.length ? `<div class="grp"><h4>Size<em class="${item.requireVariant ? 'req' : ''}">${item.requireVariant ? 'Required' : 'Optional'}</em></h4>${item.variants.map((v) => `<button class="optrow ${st.variantId === v.id ? 'on' : ''}" data-o="var" data-id="${E(v.id)}"><span class="dot"></span>${E(v.name)}<span class="pr">${v.price != null ? money(v.price) : v.priceDelta ? (v.priceDelta > 0 ? '+' : '') + money(v.priceDelta) : ''}</span></button>`).join('')}</div>` : ''}
        ${groups.map((gr, gi) => { const single = gr.max === 1; return `<div class="grp"><h4>${E(gr.name)}<em class="${gr.min ? 'req' : ''}">${gr.min ? 'Required' : 'Optional'}${gr.max ? ' · up to ' + gr.max : ''}</em></h4>${gr.opts.map((o) => `<button class="optrow ${single ? '' : 'chk'} ${st.sel[gi].has(o.id) ? 'on' : ''}" data-o="opt" data-gi="${gi}" data-id="${E(o.id)}"><span class="dot"></span>${E(o.name)}<span class="pr">${o.delta ? '+' + money(o.delta) : ''}</span></button>`).join('')}</div>`; }).join('')}
        <div class="grp"><h4>Special request <em>Optional</em></h4><textarea class="area" id="inote" rows="2" maxlength="200" placeholder="e.g. no onions">${E(st.notes)}</textarea></div>
        ${bad ? `<div class="hint" style="color:var(--warn);font-weight:700">${E(bad)}</div>` : ''}`;
      $('#inote').oninput = (e) => { st.notes = e.target.value; };
      $('#modal .sh-f').innerHTML = `<span class="step" style="gap:12px"><button data-o="q-" aria-label="Less" style="width:44px;height:44px">−</button><b style="font-size:18px">${st.qty}</b><button class="plus" data-o="q+" aria-label="More" style="width:44px;height:44px">+</button></span><button class="btn" data-o="add" ${bad ? 'disabled' : ''}>Add · ${item.price == null && !variant() ? '—' : money(est())}</button>`;
    };
    openModal(`<div class="sh-h"><h3>${E(item.name)}</h3><button class="x" data-m="close">×</button></div><div class="sh-b"></div><div class="sh-f"></div>`);
    body();
    $('#modal').onclick = (ev) => {
      const b = ev.target.closest('[data-o]'); if (!b) return; const a = b.dataset.o;
      if (a === 'var') { st.variantId = st.variantId === b.dataset.id && !item.requireVariant ? null : b.dataset.id; }
      else if (a === 'opt') {
        const gi = +b.dataset.gi, gr = groups[gi], id = b.dataset.id, set = st.sel[gi];
        if (set.has(id)) set.delete(id);
        else if (gr.max === 1) { set.clear(); set.add(id); }
        else if (gr.max && set.size >= gr.max) return toast(`You can choose up to ${gr.max} for ${gr.name}`);
        else set.add(id);
      } else if (a === 'q-') st.qty = Math.max(1, st.qty - 1);
      else if (a === 'q+') st.qty = Math.min(20, st.qty + 1);
      else if (a === 'add') {
        if (invalid()) return;
        const mods = [], picks = [];
        groups.forEach((gr, gi) => st.sel[gi].forEach((id) => {
          const o = gr.opts.find((x) => x.id === id);
          if (gr.kind === 'mod') mods.push({ groupId: gr.g.id, optionId: id, name: o.name, priceDelta: o.delta });
          else picks.push({ groupId: gr.g.id, menuItemId: id, name: o.name, priceDelta: 0 });
        }));
        const v = variant(); closeModal(); $('#modal').onclick = null;
        return addLine(item, v ? { id: v.id, name: v.name, price: v.price, priceDelta: v.priceDelta } : null, mods, picks, st.qty, st.notes.trim());
      }
      body();
    };
  }

  // ---- checkout
  function checkout() {
    if (!S.cart.length || S.cartErr) return;
    if (needTable() && !S.table) { toast('Please choose your table first.'); return openTables(); }
    const o = S.ctx.options; const t = S.quote ? S.quote.totals.total : S.cart.reduce((a, l, k) => a + lineTotal(l, k), 0);
    const methods = [o.mpesa && 'MPESA', o.cash && 'CASH'].filter(Boolean);
    if (!methods.length) return toast('No payment method is available. Please ask a member of staff.');
    if (!S.clientRef) S.clientRef = 'kiosk-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
    const st = { method: methods.length === 1 ? methods[0] : null, phone: '' };
    const draw = () => {
      $('#modal .sh-b').innerHTML = `${methods.length > 1 ? `<div class="method">${methods.map((m) => `<button class="${st.method === m ? 'on' : ''}" data-c="m" data-m2="${m}">${m === 'MPESA' ? IC.phone + 'M-PESA<small>Pay with your phone</small>' : IC.cash + 'Cash<small>Pay at the cashier</small>'}</button>`).join('')}</div>` : ''}
        ${st.method === 'MPESA' ? `<div class="area-h">Your Safaricom number</div><div class="phone ${st.phone ? '' : 'ph'}">${st.phone ? E(fmtPhone(st.phone)) : '07XX XXX XXX'}</div>${keypad('c')}<div class="hint">You will get a prompt on your phone to enter your M-PESA PIN.</div>` : ''}
        ${st.method === 'CASH' ? '<p class="msg" style="font-size:15px;margin-top:14px">We will show your bill. Take it to the cashier and pay. Your order goes to the kitchen after you have paid.</p>' : ''}
        ${!st.method ? '<p class="msg" style="margin-top:14px">Choose how you would like to pay.</p>' : ''}<div id="cerr"></div>`;
      const ready = st.method === 'CASH' || (st.method === 'MPESA' && PHONE_RX.test(st.phone));
      $('#modal .sh-f').innerHTML = `<button class="btn alt" data-m="close">Back</button><button class="btn ${st.method === 'MPESA' ? 'green' : ''}" data-c="go" ${ready && !S.busy ? '' : 'disabled'}>${S.busy ? 'Please wait…' : st.method === 'CASH' ? 'Get my bill' : 'Pay ' + money(t)}</button>`;
    };
    openModal(`<div class="sh-h"><h3>Pay ${money(t)}</h3><button class="x" data-m="close">×</button></div><div class="sh-b"></div><div class="sh-f"></div>`);
    draw();
    $('#modal').onclick = async (ev) => {
      const b = ev.target.closest('[data-c],[data-m]'); if (!b) return;
      if (b.dataset.m === 'close') { closeModal(); $('#modal').onclick = null; return; }
      const a = b.dataset.c;
      if (a === 'm') st.method = b.dataset.m2;
      else if (a === 'k') st.phone = keyPress(st.phone, b.dataset.v);
      else if (a === 'go') {
        S.busy = true; draw();
        try { await placeOrder(st.method, st.phone); $('#modal').onclick = null; return; }
        catch (e) {
          S.busy = false;
          if (e.code === 'TABLE_UNAVAILABLE') { S.table = null; S.clientRef = null; renderPanel(); toast(e.message); return openTables(); }
          draw(); const x = $('#cerr'); if (x) x.innerHTML = `<div class="err" style="margin-top:12px">${E(e.message)}</div>`; return;
        }
      }
      draw();
    };
  }
  const fmtPhone = (p) => p.replace(/^(\d{4})(\d{0,3})(\d{0,3}).*$/, (m, a, b, c) => [a, b, c].filter(Boolean).join(' '));
  const keypad = (tag) => `<div class="keys">${['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '⌫'].map((k) => `<button data-${tag}="k" data-v="${k}" aria-label="${k}">${k}</button>`).join('')}</div>`;
  const keyPress = (cur, v) => (v === 'C' ? '' : v === '⌫' ? cur.slice(0, -1) : cur.length < 13 ? cur + v : cur);

  async function placeOrder(method, phone) {
    const body = { orderType: S.orderType, tableId: S.orderType === 'DINE_IN' && S.table ? S.table.id : undefined, items: apiItems(), paymentMethod: method, phone: method === 'MPESA' ? phone.replace(/\s/g, '') : undefined, clientRef: S.clientRef };
    const r = await api('/orders', { method: 'POST', body });
    S.busy = false; S.clientRef = null; S.cart = []; S.quote = null;
    S.code = r.order.code; sessionStorage.setItem(KEY, S.code);
    S.order = r.order; S.payment = r.payment || null; S.bill = r.bill || null; S.payStart = Date.now(); S.paidAt = 0; S.cashArm = false; S.cxArm = false; S.queued = false;
    showPay(); startPoll();
    if (method === 'CASH') autoPrint();
  }

  // ------------------------------------------------------------------ payment + tracking screen
  const PAID_STAGES = ['RECEIVED', 'PREPARING', 'READY', 'COMPLETED'];
  function itemsBlock(o) {
    const t = o.totals || {};
    return `<div class="items">${(o.items || []).map((i) => `<div><span>${i.quantity} × ${E(i.name)}</span><span>${money(i.total)}</span></div>`).join('')}
      ${t.serviceCharge ? `<div><span>Service charge</span><span>${money(t.serviceCharge)}</span></div>` : ''}<div class="t"><span>Total</span><span>${money(t.total)}</span></div></div>`;
  }
  function billHtml(b) {
    if (!b) return '';
    const biz = b.business || {};
    return `<div class="paper" id="billpaper"><div class="pb-h"><b>${E(biz.name || '')}</b>${biz.phone ? '<br>' + E(biz.phone) : ''}<br><b>${E(b.title || 'Bill')}</b></div>${b.banner ? `<div class="pb-ban">${E(b.banner)}</div>` : ''}
      ${S.code && b.status !== 'PAID' ? `<div class="pb-code"><small>ORDER CODE</small><b>${E(S.code)}</b></div>` : ''}
      <div class="pb-m">${(b.meta || []).map((m) => `<div><span>${E(m[0])}</span><span>${E(m[1])}</span></div>`).join('')}${S.order && S.order.orderType ? `<div><span>Order type</span><span>${S.order.orderType === 'DINE_IN' ? 'Dine in' : 'Take away'}</span></div>` : ''}</div>
      <div class="pb-l">${(b.lines || []).map((l) => `<div><span>${l.qty} × ${E(l.name)}</span><span>${money(l.total)}</span></div>`).join('')}</div>
      <div class="pb-t">${(b.totals || []).map((t) => `<div class="${t[2] ? 'big' : ''}"><span>${E(t[0])}</span><span>${E(t[1])}</span></div>`).join('')}</div><div class="pb-f">${E(b.footer || '')}</div></div>`;
  }
  async function ensureBill() { if (S.bill || !S.code) return; try { const d = await api('/orders/' + S.code + '/bill'); S.bill = d.bill; if (S.order && S.order.stage === 'AWAITING_CASHIER') showPay(); } catch (e) { /* items list still shows */ } }
  function autoPrint() { if (S.ctx && S.ctx.options && S.ctx.options.printAvailable === false) return; S.queued = true; api('/orders/' + S.code + '/print', { method: 'POST' }).catch(() => {}); }
  async function printBill() {
    try { if (!S.bill) { const d = await api('/orders/' + S.code + '/bill'); S.bill = d.bill; } }
    catch (e) { return note(e.message); }
    if (S.order && S.order.stage === 'AWAITING_CASHIER') armReset(90000);      // reading the bill counts as using the kiosk
    openModal(`<div class="sh-h"><h3>${E(S.bill.title || 'Bill')}</h3><button class="x" data-m="close">×</button></div><div class="sh-b">${billHtml(S.bill)}</div><div class="sh-f"><button class="btn alt" data-m="close">Close</button><button class="btn" data-m="prn">${IC.print} Print</button></div>`);
    if (!S.queued) { S.queued = true; api('/orders/' + S.code + '/print', { method: 'POST' }).catch(() => {}); }   // one copy also goes to the cashier's printer
  }

  function showPay() {
    show('pay'); const o = S.order, p = S.payment || {}; const el = $('#pay'); const stage = o.stage;
    let h = '';
    if (PAID_STAGES.includes(stage)) {
      if (!S.paidAt) { S.paidAt = Date.now(); armReset(20000); }
      const idx = PAID_STAGES.indexOf(stage); const names = ['Received', 'Preparing', o.orderType === 'DINE_IN' ? 'Ready' : 'Ready to collect', o.orderType === 'DINE_IN' ? 'Served' : 'Collected'];
      h = `<div class="pcard"><div class="ico ok">${IC.check}</div><h1>${stage === 'COMPLETED' ? 'Enjoy your meal!' : 'Payment received'}</h1><p class="lead">${E(o.message)}</p>
        ${o.pickupNumber ? `<div class="pickup"><small>${o.table ? 'Order number' : 'Collect number'}</small><b>${E(o.pickupNumber)}</b></div>` : ''}
        ${o.table ? `<p class="msg">We will bring it to <b>Table ${E(o.table)}</b>.</p>` : ''}
        <div class="steps">${names.map((n, i) => `<div class="${i < idx + (stage === 'COMPLETED' ? 1 : 0) ? 'done' : i === idx ? 'cur' : ''}">${n}</div>`).join('')}</div>
        ${itemsBlock(o)}<div class="acts"><button class="btn alt" data-p="print">${IC.print} Print receipt</button><button class="btn" data-p="new">Start a new order</button></div><p class="msg" id="rs"></p>${cdLine}</div>`;
    } else if (stage === 'CANCELLED') {
      if (!S.cxArm) { S.cxArm = true; armReset(15000); }
      h = `<div class="pcard"><div class="ico bad">${IC.cross}</div><h1>Order cancelled</h1><p class="lead">${E(o.message)}</p><div class="acts"><button class="btn" data-p="new">Start a new order</button></div>${cdLine}</div>`;
    } else if (stage === 'AWAITING_CASHIER') {
      if (!S.cashArm) { S.cashArm = true; armReset(60000); }
      h = `<div class="pcard"><div class="ico warn">${IC.cash}</div><h1>Pay at the cashier</h1><p class="lead">${S.ctx.options.printAvailable === false ? 'Go to the cashier, say your order number and pay' : 'Print your bill, take it to the cashier and pay'} <b>${money(o.totals.total)}</b>. Your order goes to the kitchen as soon as you have paid.</p>${S.ctx.options.printAvailable === false ? `<div style="text-align:center;margin:12px 0"><small>Your order number</small><div style="font-size:3.2rem;font-weight:800;letter-spacing:.06em">${E(o.pickupNumber || o.orderNumber || S.code)}</div></div>` : ''}
        ${S.bill ? billHtml(S.bill) : itemsBlock(o)}<p class="msg">Your bill has everything the cashier needs. Just hand it over.</p>
        <div class="acts">${S.ctx.options.printAvailable === false ? '' : `<button class="btn" data-p="print">${IC.print} Print my bill</button>`}${S.ctx.options.mpesa ? '<button class="btn alt" data-p="mpesa">Pay with M-PESA instead</button>' : ''}<button class="btn red" data-p="cancel">Cancel order</button></div><p class="msg" id="rs"></p><div class="acts"><button class="btn" data-p="new">Done · next customer</button></div>${cdLine}</div>`;
    } else {
      const failed = ['FAILED', 'CANCELLED', 'TIMEOUT'].includes(p.status) || p.retry || !p.status;
      if (failed) {
        h = `<div class="pcard"><div class="ico bad">${IC.warn}</div><h1>${p.status === 'CANCELLED' ? 'Payment cancelled' : p.status === 'TIMEOUT' ? 'Payment timed out' : 'Payment not completed'}</h1><p class="lead">${E(p.message || 'You have not been charged. You can try again.')}</p>${itemsBlock(o)}
          <div class="acts">${S.ctx.options.mpesa ? '<button class="btn green" data-p="mpesa">Try M-PESA again</button>' : ''}${S.ctx.options.cash ? '<button class="btn alt" data-p="cash">Pay cash at the cashier</button>' : ''}<button class="btn red" data-p="cancel">Cancel order</button></div><p class="msg" id="rs"></p></div>`;
      } else {
        const slow = Date.now() - S.payStart > 45000;
        h = `<div class="pcard"><div class="ico blue"><div class="spin"></div></div><h1>Check your phone</h1><p class="lead">Enter your M-PESA PIN to pay <b>${money(p.amount || o.totals.total)}</b>. Please don’t close this page.</p>
          ${itemsBlock(o)}<div class="acts">${slow ? '<button class="btn alt" data-p="mpesa">No prompt? Send it again</button>' : ''}<button class="btn red" data-p="cancel">Cancel order</button></div><p class="msg" id="rs"></p></div>`;
      }
    }
    el.innerHTML = h; paintCountdown();
  }
  function note(msg) { const r = $('#rs'); if (r) r.textContent = msg; else toast(msg); }

  function stopPoll() { if (S.polling) { clearTimeout(S.polling); S.polling = null; } }
  function startPoll() { stopPoll(); const tick = async () => {
    if (!S.code) return;
    try {
      const d = await api('/orders/' + S.code); if (!S.code) return;
      const was = S.order && S.order.stage, wasPay = S.payment && S.payment.status;
      S.order = d.order; S.payment = d.payment || S.payment;
      if (!$('#modal').innerHTML && (was !== S.order.stage || wasPay !== (S.payment && S.payment.status) || S.order.stage === 'AWAITING_PAYMENT')) showPay();
      if (S.order.stage === 'COMPLETED' || S.order.stage === 'CANCELLED') return stopPoll();
    } catch (e) { if (e.code === 'ORDER_NOT_FOUND' || e.code === 'KIOSK_INVALID') return showWelcome(); }
    S.polling = setTimeout(tick, PAID_STAGES.includes(S.order && S.order.stage) ? 6000 : 3000);
  }; S.polling = setTimeout(tick, 1500); }

  async function resume() {
    try { const d = await api('/orders/' + S.code); S.order = d.order; S.payment = d.payment || null; S.payStart = Date.now(); showPay(); startPoll(); ensureBill(); }
    catch (e) { showWelcome(); }
  }

  function phoneModal(title, cta, go) {
    const st = { phone: '' }; let busy = false;
    const draw = () => {
      $('#modal .sh-b').innerHTML = `<div class="phone ${st.phone ? '' : 'ph'}">${st.phone ? E(fmtPhone(st.phone)) : '07XX XXX XXX'}</div>${keypad('k')}<div id="kerr"></div>`;
      $('#modal .sh-f').innerHTML = `<button class="btn alt" data-m="close">Back</button><button class="btn green" data-k="go" ${PHONE_RX.test(st.phone) && !busy ? '' : 'disabled'}>${busy ? 'Please wait…' : E(cta)}</button>`;
    };
    openModal(`<div class="sh-h"><h3>${E(title)}</h3><button class="x" data-m="close">×</button></div><div class="sh-b"></div><div class="sh-f"></div>`); draw();
    $('#modal').onclick = async (ev) => {
      const b = ev.target.closest('[data-k],[data-m]'); if (!b) return;
      if (b.dataset.m === 'close') { closeModal(); $('#modal').onclick = null; return; }
      if (b.dataset.k === 'k') st.phone = keyPress(st.phone, b.dataset.v);
      else if (b.dataset.k === 'go') {
        busy = true; draw();
        try { await go(st.phone.replace(/\s/g, '')); closeModal(); $('#modal').onclick = null; return; }
        catch (e) { busy = false; draw(); $('#kerr').innerHTML = `<div class="err" style="margin-top:12px">${E(e.message)}</div>`; return; }
      }
      draw();
    };
  }
  async function payAction(a) {
    if (a === 'new') return showWelcome();
    if (a === 'mpesa') return phoneModal('Pay with M-PESA', 'Send prompt', async (phone) => {
      const r = await api('/orders/' + S.code + '/mpesa', { method: 'POST', body: { phone } });
      S.order = r.order; S.payment = r.payment; S.payStart = Date.now(); clearReset(); S.cashArm = false; showPay(); startPoll();
    });
    try {
      if (a === 'cash') { const r = await api('/orders/' + S.code + '/cash', { method: 'POST' }); S.cashArm = false; S.order = r.order; S.payment = r.payment; S.bill = r.bill; showPay(); startPoll(); autoPrint(); }
      else if (a === 'cancel') confirmBox('Cancel this order?', 'You have not been charged. Your order will be cancelled.', 'Yes, cancel', async () => {
        try { const r = await api('/orders/' + S.code + '/cancel', { method: 'POST' }); S.order = r.order; showPay(); stopPoll(); } catch (e) { note(e.message); }
      }, 'No, go back');
      else if (a === 'print') { await printBill(); }
    } catch (e) { note(e.message); }
  }

  // ------------------------------------------------------------------ auto reset (a kiosk must never show the last customer's order)
  function armReset(ms) {
    clearReset(); S.resetAt = Date.now() + ms; S.resetTimer = setTimeout(showWelcome, ms);
    S.cdTimer = setInterval(paintCountdown, 1000); paintCountdown();
  }
  function clearReset() { if (S.resetTimer) { clearTimeout(S.resetTimer); S.resetTimer = null; } if (S.cdTimer) { clearInterval(S.cdTimer); S.cdTimer = null; } }
  function paintCountdown() { const c = $('#cdn'); if (!c || !S.resetAt) return; const t = Math.max(0, Math.ceil((S.resetAt - Date.now()) / 1000)); c.textContent = t >= 60 ? Math.ceil(t / 60) + ' min' : t + 's'; }
  const cdLine = '<p class="msg">Returning to the start screen in <b id="cdn"></b>…</p>';
  let idleT = null, idleWarn = null;
  function touch() {
    clearTimeout(idleT); clearInterval(idleWarn);
    if (!S.cart.length || $('#shop').hidden) return;
    idleT = setTimeout(() => {
      let s = 15; openModal(`<div class="sh-h"><h3>Are you still there?</h3></div><div class="sh-b"><p>Your order will be cleared in <b id="cd">${s}</b> seconds.</p></div><div class="sh-f"><button class="btn" data-m="close">I’m still here</button></div>`);
      idleWarn = setInterval(() => { s--; const c = $('#cd'); if (c) c.textContent = s; if (s <= 0 || !c) { clearInterval(idleWarn); if (s <= 0) showWelcome(); } }, 1000);
    }, 150000);
  }

  // ------------------------------------------------------------------ events
  document.addEventListener('pointerdown', touch, true);
  document.addEventListener('keydown', touch, true);
  $('#q').addEventListener('input', (e) => { S.q = e.target.value; renderGrid(); });
  document.addEventListener('click', async (ev) => {
    const mb = ev.target.closest('[data-m]');
    if (mb && $('#modal').contains(mb)) {
      const a = mb.dataset.m;
      if (a === 'close') { closeModal(); $('#modal').onclick = null; }
      else if (a === 'prn') { const pg = $('#pay'), was = pg.hidden; pg.hidden = true; window.print(); pg.hidden = was; }
      else if (a === 'tbl') { S.table = { id: mb.dataset.id, name: mb.dataset.n }; closeModal(); S.quote = null; S.cartErr = ''; renderPanel(); scheduleQuote(); }
      else if (a === 'savenote') { const l = S.cart[+mb.dataset.k]; if (l) { l.notes = ($('#nt').value || '').trim(); closeModal(); cartChanged(); } }
      return;
    }
    const pb = ev.target.closest('[data-p]'); if (pb) return payAction(pb.dataset.p);
    const b = ev.target.closest('[data-act]'); if (!b) return; const a = b.dataset.act, id = b.dataset.id, k = +b.dataset.k;
    if (a === 'start') return start(b.dataset.t);
    if (a === 'type') {
      const t = b.dataset.t; if (t === S.orderType) return;
      S.orderType = t; S.table = null; S.quote = null; S.cartErr = '';
      try { await loadMenu(); } catch (e) { toast(e.message); }
      renderShop(); scheduleQuote(); if (needTable()) openTables(); return;
    }
    if (a === 'cat') { S.catId = id; S.q = ''; $('#q').value = ''; renderCats(); renderGrid(); return; }
    if (a === 'add') { ev.stopPropagation(); const it = S.items[id]; if (!it || it.available === false || !comboOk(it)) return; return hasChoices(it) ? optionsModal(it) : addLine(it, null, [], [], 1, ''); }
    if (a === 'dec') { const idx = S.cart.map((l) => l.item.id).lastIndexOf(id); if (idx >= 0) { if (--S.cart[idx].qty <= 0) S.cart.splice(idx, 1); cartChanged(); } return; }
    if (a === 'linc') { const l = S.cart[k]; if (l && l.qty < 50) { l.qty++; cartChanged(); } return; }
    if (a === 'ldec') { const l = S.cart[k]; if (l) { if (--l.qty <= 0) S.cart.splice(k, 1); cartChanged(); } return; }
    if (a === 'lrm') { S.cart.splice(k, 1); cartChanged(); return; }
    if (a === 'note') return noteModal(k);
    if (a === 'table') return openTables();
    if (a === 'checkout') return checkout();
    if (a === 'clear') return confirmBox('Clear your order?', 'All dishes will be removed.', 'Clear order', () => { S.cart = []; cartChanged(); });
    if (a === 'drawer') { $('#panel').classList.toggle('open'); return; }
    if (a === 'home') return S.cart.length ? confirmBox('Start over?', 'Your current order will be cleared.', 'Start over', showWelcome) : showWelcome();
  });

  // ------------------------------------------------------------------ start
  (async function init() {
    if (!TOKEN) return fatal('This kiosk link is not valid. Please ask a member of staff.');
    try { S.ctx = await api(''); } catch (e) { return fatal(e.message); }
    CUR = (S.ctx.business && S.ctx.business.currency) || 'KES'; document.title = S.ctx.business.name + ' · Order here';
    S.code = sessionStorage.getItem(KEY);
    if (S.code) return resume();
    showWelcome();
  })();
})();