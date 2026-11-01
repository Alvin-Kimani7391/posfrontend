/* Hardware workspace — Pro layer (loads after hw-dash.js, before hw-sales.js).
   1. Action loader   – top progress bar for every request + a blocking "Saving…" card (with success tick) for every change
   2. Sidebar         – collapse / expand, remembered
   3. Search          – one click opens suggestions (recent, pages, products, customers, sales), keyboard friendly, "/" or Ctrl+K
   4. Notifications   – red dot only when unread; mini centre with sound on/off, mark all read, All/Unread, per-item read
   5. Cash shift      – open shift modal, "no till yet" modal to create one, shift bar, count-and-close
*/
(function () {
  const { Api, UI, Storage } = window, HW = window.HW;
  if (!HW || !Api) return;
  const E = HW.E, $ = HW.$, $$ = HW.$$;
  const ls = { get: (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* blocked */ } } };
  const onGone = (el, fn) => { const p = el.parentNode; if (!p) return fn(); const mo = new MutationObserver(() => { if (!el.isConnected) { mo.disconnect(); fn(); } }); mo.observe(p, { childList: true }); };

  /* ======================================================= 1. ACTION LOADER */
  const L = HW.loader = (() => {
    const bar = document.createElement('div'); bar.className = 'hw-topbar'; bar.innerHTML = '<i></i>';
    const ov = document.createElement('div'); ov.className = 'hw-ld'; ov.setAttribute('role', 'status'); ov.setAttribute('aria-live', 'polite');
    ov.innerHTML = '<div class="hw-ld-card"><div class="hw-ring"><svg viewBox="0 0 50 50"><circle class="tr" cx="25" cy="25" r="20"/><circle class="arc" cx="25" cy="25" r="20"/><circle class="arc2" cx="25" cy="25" r="14"/><path class="tick" d="M15 26l7 7 14-15"/></svg></div><b class="t">Working…</b><small class="s">Please wait a moment</small></div>';
    const mount = () => { if (!bar.isConnected) { document.body.appendChild(bar); document.body.appendChild(ov); } };
    let all = 0, muts = 0, barT, ovT, hideT, shown = false, label = '', okText = '';
    const setText = (t, s) => { ov.querySelector('.t').textContent = t; ov.querySelector('.s').textContent = s || ''; };
    const hideNow = () => { clearTimeout(hideT); ov.classList.remove('on', 'ok'); shown = false; };
    function begin(l, ok) {
      mount(); all++; clearTimeout(barT); barT = setTimeout(() => { if (all > 0) bar.classList.add('on'); }, 120);
      if (l) { muts++; label = l; okText = ok || 'Done'; clearTimeout(hideT); ov.classList.remove('ok'); if (!shown) { clearTimeout(ovT); ovT = setTimeout(() => { if (muts > 0) { setText(label, 'Please wait — don’t close this page'); ov.classList.add('on'); shown = true; document.activeElement && document.activeElement.blur && document.activeElement.blur(); } }, 220); } else setText(label, 'Please wait — don’t close this page'); }
      let ended = false;
      return (success) => {
        if (ended) return; ended = true; all = Math.max(0, all - 1); if (!all) { clearTimeout(barT); bar.classList.remove('on'); }
        if (!l) return; muts = Math.max(0, muts - 1); if (muts) return; clearTimeout(ovT);
        if (shown && success) { setText(okText, ''); ov.classList.add('ok'); hideT = setTimeout(hideNow, 520); } else hideNow();
      };
    }
    /** Wrap any async job in the loader: HW.loader.wrap('Preparing receipt…', () => ...) */
    const wrap = async (l, fn, ok) => { const done = begin(l, ok); try { const r = await fn(); done(true); return r; } catch (e) { done(false); throw e; } };
    return { begin, wrap };
  })();

  const QUIET = [/^\/notifications/, /^\/payments\/mpesa\/[^/]+\/(status|cancel)/, /^\/settings\/integrations/, /^\/hardware\/price-quote/, /^\/hardware\/barcode/, /^\/shifts\/current/, /^\/auth\//, /^\/sync/, /^\/devices/];
  const LABELS = [
    [/payments\/mpesa\/stk/, 'Sending prompt to the customer…', 'Prompt sent'], [/payments\/mpesa\/manual/, 'Preparing till payment…', 'Ready'], [/payments\/mpesa\/[^/]+\/claim/, 'Verifying the M-PESA code…', 'Code verified'], [/^\/sales\/[^/]+\/cancel/, 'Cancelling sale…', 'Sale cancelled'], [/^\/refunds/, 'Submitting refund…', 'Refund submitted'],
    [/^\/sales$/, 'Completing sale…', 'Sale completed'], [/\/shifts\/open/, 'Opening shift…', 'Shift opened'], [/\/shifts\/[^/]+\/close/, 'Closing shift…', 'Shift closed'], [/^\/registers/, 'Creating till…', 'Till created'],
    [/approve/, 'Approving…', 'Approved'], [/invoice/, 'Creating invoice…', 'Invoice created'], [/(quot|quote)/, 'Saving quotation…', 'Saved'], [/deliver|dispatch/, 'Updating delivery…', 'Delivery updated'],
    [/deposit/, 'Recording deposit…', 'Deposit saved'], [/refund/, 'Processing refund…', 'Refund processed'], [/(products|units)/, 'Saving product…', 'Product saved'], [/(customers)/, 'Saving customer…', 'Customer saved'],
    [/(expenses|budgets|recurring)/, 'Saving…', 'Saved'], [/(payments?)/, 'Recording payment…', 'Payment recorded'], [/(suppliers|purchases)/, 'Saving supplier data…', 'Saved'],
  ];
  const labelFor = (m, path) => { const hit = LABELS.find(([re]) => re.test(path)); const base = m === 'delete' ? ['Deleting…', 'Deleted'] : m === 'post' ? ['Saving…', 'Saved'] : ['Updating…', 'Updated']; if (m === 'delete') return base; return hit ? [hit[1], hit[2]] : base; };
  ['get', 'post', 'put', 'patch', 'delete'].forEach((m) => {
    const orig = Api[m] && Api[m].bind(Api); if (!orig) return;
    Api[m] = (path, ...rest) => {
      const p = String(path || ''); const quiet = QUIET.some((re) => re.test(p)) || (rest[1] && rest[1].background);
      if (quiet) return orig(path, ...rest);
      const [lbl, ok] = m === 'get' ? [null, null] : labelFor(m, p); const done = L.begin(lbl, ok);
      let pr; try { pr = orig(path, ...rest); } catch (e) { done(false); throw e; }
      return Promise.resolve(pr).then((r) => { done(true); return r; }, (e) => { done(false); throw e; });
    };
  });

  HW.skeleton = () => '<div class="hw-sk"><div class="b t"></div><div class="row"><div class="b k"></div><div class="b k"></div><div class="b k"></div><div class="b k"></div></div><div class="b l"></div></div>';

  /* ======================================================= 2-5 need the shell */
  HW.afterShell = () => { collapse(); bell(); search(); SH.load(); };

  /* ======================================================= 2. SIDEBAR */
  function collapse() {
    const app = $('#app'), btn = $('#collapse'); if (!btn) return;
    const apply = (on, save) => { app.classList.toggle('hw-collapsed', on); btn.title = on ? 'Expand menu' : 'Collapse menu'; btn.setAttribute('aria-label', btn.title); if (save) ls.set('hw.rail', on ? '1' : '0'); };
    apply(ls.get('hw.rail') === '1'); btn.onclick = () => apply(!app.classList.contains('hw-collapsed'), true);
    document.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'b') { e.preventDefault(); btn.click(); } });
  }

  /* ======================================================= 3. SEARCH */
  function search() {
    const wrap = $('#gwrap'), inp = $('#gsearch'); if (!wrap || !inp) return; HW.searchPro = true;
    const RK = 'hw.recent', recent = () => { try { return JSON.parse(ls.get(RK) || '[]'); } catch (e) { return []; } }, addRecent = (t) => { t = (t || '').trim(); if (t.length < 2) return; ls.set(RK, JSON.stringify([t, ...recent().filter((x) => x !== t)].slice(0, 6))); };
    let box = null, items = [], cur = -1, token = 0;
    const pages = () => HW.NAV.filter((n) => HW.canAny(n[3]));
    const hl = (s, t) => { s = E(s || ''); if (!t) return s; const i = s.toLowerCase().indexOf(E(t).toLowerCase()); return i < 0 ? s : s.slice(0, i) + '<mark>' + s.slice(i, i + E(t).length) + '</mark>' + s.slice(i + E(t).length); };
    const close = () => { if (box) { box.remove(); box = null; } wrap.classList.remove('focus'); inp.setAttribute('aria-expanded', 'false'); cur = -1; };
    const setCur = (i) => { const els = $$('.it', box); if (!els.length) return; cur = (i + els.length) % els.length; els.forEach((x, k) => x.classList.toggle('on', k === cur)); els[cur].scrollIntoView({ block: 'nearest' }); };
    const pick = (it) => { if (!it) return; close(); addRecent(it.recent || (it.kind !== 'page' ? inp.value : '')); inp.blur(); it.run(); inp.value = ''; };
    const sec = (title, rows, extra = '') => rows.length ? `<h6><span>${title}</span>${extra}</h6>${rows.join('')}` : '';
    const row = (it, ic, title, sub, right) => { items.push(it); return `<div class="it" data-n="${items.length - 1}" role="option"><span class="ic">${ic}</span><span class="tx"><b>${title}</b><small>${sub || ''}</small></span>${right ? `<span class="rt">${right}</span>` : ''}</div>`; };
    const addProduct = (p) => { if (HW.S.cart && location.hash.startsWith('#/counter')) { HW.S.cart.add(p); HW.ok(`${p.name} added`); const q = $('[data-q]'); if (q) q.focus(); } else { HW.S.pendingAdd = p; HW.go('counter'); } };
    const goCounter = (t) => { if (location.hash.startsWith('#/counter') && $('[data-q]')) { const q = $('[data-q]'); q.value = t; q.dispatchEvent(new Event('input')); q.focus(); } else { HW.S.pending = t; HW.go('counter'); } };
    const stockOf = (p) => (p.stockHint && p.stockHint.retailQuantity !== undefined) ? p.stockHint.retailQuantity : (p.stock ?? p.quantity ?? null);

    function paint(parts, term, loading) {
      if (!box) { box = document.createElement('div'); box.className = 'hw-sg'; box.setAttribute('role', 'listbox'); box.addEventListener('mousedown', (e) => e.preventDefault()); wrap.appendChild(box); inp.setAttribute('aria-expanded', 'true'); }
      box.innerHTML = `<div class="sc">${parts.join('') || `<div class="none">${term ? 'Nothing found for “' + E(term) + '”' : 'Start typing to search'}</div>`}${loading ? '<div class="ld">Searching…</div>' : ''}</div><div class="ft"><span><kbd>↑</kbd><kbd>↓</kbd>navigate</span><span><kbd>Enter</kbd>open</span><span><kbd>Esc</kbd>close</span></div>`;
      $$('.it', box).forEach((el) => { el.onclick = () => pick(items[+el.dataset.n]); el.onmouseenter = () => { $$('.it', box).forEach((x) => x.classList.remove('on')); el.classList.add('on'); cur = +el.dataset.n; }; });
      const clr = $('[data-clr]', box); if (clr) clr.onclick = () => { ls.set(RK, '[]'); show(); };
      if (cur >= 0) setCur(cur);
    }
    function pageRows(term) {
      const t = term.toLowerCase(), list = pages().filter((n) => !t || n[1].toLowerCase().includes(t)).slice(0, t ? 4 : 8);
      return list.map((n) => row({ kind: 'page', run: () => HW.go(n[0]) }, `<span>${n[2]}</span>`, hl(n[1], term), n[4]));
    }
    function show() {
      const term = inp.value.trim(); items = []; cur = -1; const my = ++token;
      if (!term) {
        const rec = recent().map((r) => row({ kind: 'recent', recent: r, run: () => goCounter(r) }, HW.ic('history', 17), E(r), 'Recent search'));
        const quick = [['counter', 'New sale', 'Open the counter till'], ['quotes/new', 'New quotation', 'Price a job'], ['dispatch/new', 'Schedule delivery', 'Yard & delivery']].filter(([to]) => pages().some((n) => n[0] === to.split('/')[0])).map(([to, l, s]) => row({ kind: 'page', run: () => HW.go(...to.split('/')) }, HW.ic('plus', 17), l, s));
        paint([sec('Recent', rec, rec.length ? '<a data-clr>Clear</a>' : ''), sec('Quick actions', quick), sec('Go to', pageRows(''))], '', false); return;
      }
      // instant: pages + products from the local index
      const draw = (prods, custs, sales, loading) => {
        items = []; const parts = [];
        parts.push(sec('Products', prods.map((p) => row({ kind: 'product', run: () => addProduct(p) }, HW.ic('package', 17), hl(p.name, term), E([p.sku, p.brand].filter(Boolean).join(' · ')), `${HW.money(p.sellingPrice)}${stockOf(p) !== null ? `<small>${HW.num(stockOf(p))} ${E(p.unit || '')}</small>` : ''}`))));
        parts.push(sec('Sales', sales.map((s) => row({ kind: 'sale', run: () => HW.saleDetail && HW.saleDetail(s.id) }, HW.ic('receipt', 17), hl(s.receiptNumber, term), E([s.customerName || 'Walk-in', s.cashierName].filter(Boolean).join(' · ')), `${HW.money(s.total)}<small>${HW.date(s.soldAt)}</small>`))));
        parts.push(sec('Customers', custs.map((c) => row({ kind: 'cust', run: () => { location.href = '../customers.html'; } }, HW.ic('user', 17), hl(c.name, term), E(c.phone || c.email || '')))));
        parts.push(sec('Pages', pageRows(term)));
        parts.push(`<h6><span>Or</span></h6>${row({ kind: 'free', run: () => goCounter(term) }, HW.ic('search', 17), `Search “${E(term)}” on the counter`, 'Scan or search all products')}`);
        paint(parts, term, loading);
      };
      const local = (HW.productIndex && HW.productIndex.rows.length) ? HW.productIndex.rows.filter((p) => [p.name, p.sku, p.barcode, p.brand].some((v) => String(v || '').toLowerCase().includes(term.toLowerCase()))).slice(0, 6) : [];
      draw(local, [], [], true);
      const jobs = [(HW.searchProducts ? HW.searchProducts(term) : HW.pickers.product.fetch(term)).then((r) => r.slice(0, 6)).catch(() => local)];
      jobs.push(HW.can('sales.create') ? Api.get('/customers', { search: term, limit: 4 }).then((r) => HW.list(r.data).slice(0, 4)).catch(() => []) : Promise.resolve([]));
      jobs.push(term.length >= 3 && (HW.can('hardware.reports') || HW.can('sales.view')) ? Api.get('/reports/sales/all', { search: term, limit: 4 }).then((r) => ((r.data && r.data.items) || []).slice(0, 4)).catch(() => []) : Promise.resolve([]));
      Promise.all(jobs).then(([p, c, s]) => { if (my === token && box) draw(p, c, s, false); });
    }
    const go = UI.debounce ? UI.debounce(show, 160) : show;
    inp.addEventListener('focus', () => { wrap.classList.add('focus'); show(); });
    inp.addEventListener('click', () => { if (!box) { wrap.classList.add('focus'); show(); } });
    inp.addEventListener('input', () => { cur = -1; go(); });
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); if (!box) show(); setCur(cur + 1); } else if (e.key === 'ArrowUp') { e.preventDefault(); setCur(cur - 1); }
      else if (e.key === 'Escape') { close(); inp.blur(); }
      else if (e.key === 'Enter') { e.preventDefault(); const t = inp.value.trim(); if (cur >= 0 && items[cur]) return pick(items[cur]); const first = items.find((i) => i.kind === 'product'); if (first && items.filter((i) => i.kind === 'product').length === 1 && t) return pick(first); if (t) { addRecent(t); close(); inp.value = ''; goCounter(t); } }
    });
    document.addEventListener('mousedown', (e) => { if (box && !wrap.contains(e.target)) close(); });
    document.addEventListener('keydown', (e) => { const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target.tagName || '')) || e.target.isContentEditable; if (((e.key === '/' && !typing) || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k')) && !document.querySelector('.hw-modal')) { e.preventDefault(); inp.focus(); inp.select(); } });
    window.addEventListener('hashchange', close);
  }

  /* ======================================================= 4. NOTIFICATION CENTRE */
  function bell() {
    const btn = $('#bell'), wrap = $('#bellwrap'); if (!btn || !wrap) return;
    const dot = $('.dot', btn); const S = { items: [], unread: 0, tab: 'all', open: false, first: true, seen: new Set(), loading: true };
    const SK = 'pos.notifSound', soundOn = () => ls.get(SK) !== 'off';
    let ctx = null; const getCtx = () => { if (ctx) return ctx; const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null; try { ctx = new AC(); } catch (e) { ctx = null; } return ctx; };
    const unlock = () => { const c = getCtx(); if (c && c.state === 'suspended') c.resume().catch(() => {}); if (c && c.state === 'running') ['pointerdown', 'keydown', 'touchstart'].forEach((ev) => document.removeEventListener(ev, unlock, true)); };
    ['pointerdown', 'keydown', 'touchstart'].forEach((ev) => document.addEventListener(ev, unlock, true));
    const ping = () => { if (!soundOn()) return; const c = getCtx(); if (!c || c.state !== 'running') return; const t0 = c.currentTime; [[880, 0], [1318.5, 0.14]].forEach(([f, d]) => { const o = c.createOscillator(), g = c.createGain(); o.type = 'sine'; o.frequency.value = f; g.gain.setValueAtTime(0.0001, t0 + d); g.gain.exponentialRampToValueAtTime(0.35, t0 + d + 0.015); g.gain.exponentialRampToValueAtTime(0.0001, t0 + d + 0.26); o.connect(g).connect(c.destination); o.start(t0 + d); o.stop(t0 + d + 0.3); }); };
    const sev = (n) => n.severity || ((/critical|alert|fail|short|overdue|low_stock|out_of/i.test(n.type || '')) ? 'critical' : 'info');
    const ico = { critical: HW.ic('alert', 19), warning: HW.ic('alert', 19), success: HW.ic('check-circle', 19), info: HW.ic('bell', 19) };
    const paintDot = () => { dot.hidden = S.unread <= 0; btn.title = S.unread > 0 ? `${S.unread} unread notification${S.unread === 1 ? '' : 's'}` : 'Notifications'; };

    async function fetchN() {
      try {
        const { data } = await Api.get('/notifications', { limit: 30, page: 1 });
        S.items = data.items || []; S.unread = data.unreadCount !== undefined ? data.unreadCount : S.items.filter((n) => !n.readAt).length; S.loading = false;
        const fresh = S.items.filter((n) => !S.seen.has(n._id)); S.items.forEach((n) => S.seen.add(n._id));
        if (!S.first && fresh.some((n) => !n.readAt)) ping(); S.first = false;
        paintDot(); if (S.open) paintPanel();
      } catch (e) { S.loading = false; if (S.open) paintPanel(); }
    }
    function paintPanel() {
      const p = $('.hw-nc', wrap); if (!p) return; const list = S.tab === 'unread' ? S.items.filter((n) => !n.readAt) : S.items;
      p.innerHTML = `<div class="nc-h"><h4>Notifications${S.unread ? `<em>${S.unread > 99 ? '99+' : S.unread} new</em>` : ''}</h4><button class="nc-act" data-all ${S.unread ? '' : 'disabled'}>${HW.ic('check', 14)} Mark all read</button></div>
        <div class="nc-tools"><button class="nc-pill ${S.tab === 'all' ? 'on' : ''}" data-t="all">All</button><button class="nc-pill ${S.tab === 'unread' ? 'on' : ''}" data-t="unread">Unread${S.unread ? `<b>${S.unread > 99 ? '99+' : S.unread}</b>` : ''}</button><span class="sp"></span><button class="nc-snd ${soundOn() ? 'on' : ''}" data-snd title="Play a sound when a new notification arrives" role="switch" aria-checked="${soundOn()}"><span>Sound ${soundOn() ? 'on' : 'off'}</span><span class="sw"></span></button></div>
        <div class="nc-list">${S.loading ? '<div class="nc-sk"><i></i><i></i><i></i></div>' : list.length ? list.map((n) => `<div class="nc-i ${n.readAt ? '' : 'un'}" data-id="${E(n._id)}"><span class="nc-sev ${sev(n)}">${ico[sev(n)] || ico.info}</span><span class="tx"><b>${E(n.title || 'Notification')}</b><span>${E(n.message || '')}</span><small>${E(UI.timeAgo ? UI.timeAgo(n.createdAt) : '')}</small></span>${n.readAt ? '' : `<button class="rd" data-rd="${E(n._id)}" title="Mark as read" aria-label="Mark as read">${HW.ic('check', 14)}</button>`}</div>`).join('') : `<div class="nc-empty"><b>${S.tab === 'unread' ? HW.ic('check-circle', 38) : HW.ic('bell', 38)}</b>${S.tab === 'unread' ? 'You’re all caught up' : 'No notifications yet'}</div>`}</div>
        <a class="nc-foot" href="../notifications.html">View all notifications</a>`;
      $$('[data-t]', p).forEach((b) => b.onclick = () => { S.tab = b.dataset.t; paintPanel(); });
      $('[data-snd]', p).onclick = () => { const on = !soundOn(); ls.set(SK, on ? 'on' : 'off'); if (on) { unlock(); ping(); } paintPanel(); };
      $('[data-all]', p).onclick = async (e) => { const b = e.currentTarget; b.classList.add('is-busy'); try { await Api.post('/notifications/mark-all-read'); S.items.forEach((n) => { n.readAt = n.readAt || new Date().toISOString(); }); S.unread = 0; paintDot(); paintPanel(); HW.ok('All notifications marked as read'); } catch (err) { HW.err(err.message); b.classList.remove('is-busy'); } };
      $$('[data-rd]', p).forEach((b) => b.onclick = async (e) => { e.stopPropagation(); const n = S.items.find((x) => x._id === b.dataset.rd); if (!n) return; n.readAt = new Date().toISOString(); S.unread = Math.max(0, S.unread - 1); paintDot(); paintPanel(); try { await Api.post(`/notifications/${n._id}/read`); } catch (err) { /* non-fatal */ } });
      $$('.nc-i', p).forEach((el) => el.onclick = async () => { const n = S.items.find((x) => x._id === el.dataset.id); if (!n) return; if (!n.readAt) { n.readAt = new Date().toISOString(); S.unread = Math.max(0, S.unread - 1); paintDot(); try { await Api.post(`/notifications/${n._id}/read`); } catch (err) { /* non-fatal */ } } try { sessionStorage.setItem('notif:open', JSON.stringify(n)); } catch (err) { /* ignore */ } location.href = `../notifications.html?open=${encodeURIComponent(n._id)}`; });
    }
    const closeP = () => { const p = $('.hw-nc', wrap); if (p) p.remove(); S.open = false; btn.setAttribute('aria-expanded', 'false'); };
    const openP = () => { const p = document.createElement('div'); p.className = 'hw-nc'; wrap.appendChild(p); S.open = true; btn.setAttribute('aria-expanded', 'true'); paintPanel(); fetchN(); };
    btn.onclick = (e) => { e.stopPropagation(); S.open ? closeP() : openP(); };
    document.addEventListener('mousedown', (e) => { if (S.open && !wrap.contains(e.target)) closeP(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && S.open) closeP(); });
    window.addEventListener('hashchange', closeP);
    window.addEventListener('notifications:refresh', fetchN);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) fetchN(); });
    fetchN(); setInterval(() => { if (!document.hidden) fetchN(); }, 20000);
  }

  /* ======================================================= 5. CASH SHIFT */
  const SH = HW.shift = { cur: undefined, host: null };
  const br = () => HW.S.branch;
  const denoms = () => ((UI.activeCurrency && UI.activeCurrency()) === 'TZS' ? [10000, 5000, 2000, 1000, 500, 200, 100, 50] : [1000, 500, 200, 100, 50, 40, 20, 10, 5, 1]);
  SH.load = async () => { try { const { data } = await Api.get('/shifts/current', { branchId: br() }); SH.cur = data.shift || null; } catch (e) { SH.cur = undefined; } return SH.cur; };
  SH.refresh = async () => { await SH.load(); if (SH.host && SH.host.isConnected) SH.bar(SH.host); const T = HW.till; if (T) { if (T.paintShiftTab) T.paintShiftTab(); if (T.shiftRefresh) T.shiftRefresh(); } };
  SH.bar = (host) => {
    if (!host) return; SH.host = host;
    const draw = () => {
      const s = SH.cur;
      if (s === undefined) { host.innerHTML = ''; return; }
      if (!s) { host.innerHTML = `<div class="hw-shift off"><span style="display:inline-flex">${HW.ic('lock', 28)}</span><div><b>No cash shift is open</b><small>Open a shift with your starting cash to start taking payments at this till.</small></div><button class="hw-btn p" data-open>Open shift</button></div>`; $('[data-open]', host).onclick = () => SH.openFlow((ok) => ok && SH.refresh()); return; }
      const reg = s.registerId || {}; host.innerHTML = `<div class="hw-shift on"><span class="pulse"></span><div><b>Shift open · ${E(reg.name || 'Till')}</b><small>Since ${E(HW.dt(s.openedAt))} · Opening float ${HW.money(s.openingCash)}</small></div><button class="hw-btn" data-close>Close shift</button></div>`;
      $('[data-close]', host).onclick = () => SH.closeFlow();
    };
    draw(); SH.load().then(draw);
  };
  /** Resolves true when a shift is open (or when shifts are not in use); otherwise walks the cashier through opening one. */
  SH.guard = async () => { if (SH.cur === undefined) await SH.load(); if (SH.cur !== false && SH.cur !== null) return true; if (SH.cur === undefined) return true; return new Promise((res) => SH.openFlow((ok) => { if (ok) SH.refresh(); res(!!ok); })); };

  SH.openFlow = async (cb, preselect) => {
    let regs; try { regs = (await Api.get('/registers', { branchId: br() })).data.registers || []; } catch (e) { HW.err(e.message); return cb && cb(false); }
    let settled = false; const fin = (v) => { if (!settled) { settled = true; cb && cb(v); } };
    if (!regs.length) return SH.noTill(fin);
    const m = HW.modal({ title: 'Open cash shift', body: `<div class="hw-hero"><div class="big">${HW.ic('banknote', 38)}</div><h4>Start your shift</h4><p>Count the cash in the drawer and enter it as your opening float.</p></div>
      <div class="hw-f"><label class="w">Till / register<select name="registerId">${regs.map((r) => `<option value="${E(r._id)}" ${r._id === preselect ? 'selected' : ''}>${E(r.name)} (${E(r.code)})</option>`).join('')}</select></label>
      <label class="w">Opening cash float<input name="openingCash" type="number" min="0" step="any" inputmode="decimal" value="0" autofocus><div class="hw-chips">${[0, 500, 1000, 2000, 5000, 10000].map((v) => `<button type="button" data-f="${v}">${v === 0 ? 'No float' : v.toLocaleString()}</button>`).join('')}</div></label></div>`,
      actions: [{ label: 'Cancel', fn: () => { fin(false); } }, { label: 'Open shift', cls: 'p', fn: async (el) => { const registerId = $('[name=registerId]', el).value, openingCash = Number($('[name=openingCash]', el).value); if (!(openingCash >= 0)) { HW.err('Enter the opening cash'); return false; } try { await Api.post('/shifts/open', { branchId: br(), registerId, openingCash }); } catch (e) { HW.err(e.message); return false; } fin(true); } }],
      onMount: (el) => { $$('[data-f]', el).forEach((b) => b.onclick = () => { $('[name=openingCash]', el).value = b.dataset.f; }); setTimeout(() => { const i = $('[name=openingCash]', el); if (i) { i.focus(); i.select(); } }, 60); } });
    onGone(m.el, () => fin(false));
  };
  SH.noTill = (fin) => {
    const can = HW.can('registers.manage'); let created = false;
    const m = HW.modal({ title: 'No till set up yet', body: `<div class="hw-hero"><div class="big">${HW.ic('monitor', 38)}</div><h4>This branch has no cash register</h4><p>${can ? 'Create a till (cash register) for this branch, then open your shift on it.' : 'Ask the owner or a manager to create a till for this branch, then come back to open your shift.'}</p></div>${can ? `<div class="hw-f"><label>Till name<input name="name" value="Main till" placeholder="Till 1"></label><label>Short code<input name="code" value="TILL1" maxlength="10" placeholder="TILL1"></label></div>` : ''}`,
      actions: can ? [{ label: 'Cancel' }, { label: 'Create till & continue', cls: 'p', fn: async (el) => { const name = $('[name=name]', el).value.trim(), code = $('[name=code]', el).value.trim().toUpperCase(); if (!name || !code) { HW.err('Give the till a name and code'); return false; } try { await Api.post('/registers', { branchId: br(), name, code }); } catch (e) { HW.err(e.message); return false; } created = true; } }] : [{ label: 'OK' }] });
    onGone(m.el, () => { if (created) { setTimeout(() => SH.openFlow(fin), 150); } else fin(false); });
  };

  SH.closeFlow = () => {
    const s = SH.cur; if (!s) return;
    const D = denoms(); const body = `<div class="hw-hero"><div class="big">${HW.ic('calculator', 38)}</div><h4>Count the drawer</h4><p>Enter how many notes and coins of each kind are in the drawer. The total is added up for you.</p></div>
      <div class="hw-den">${D.map((d) => `<label>${d.toLocaleString()}<input type="number" min="0" step="1" inputmode="numeric" data-d="${d}" placeholder="0"><output data-o="${d}">0</output></label>`).join('')}</div>
      <div class="hw-sum t" style="margin-top:10px"><span>Cash counted</span><span data-tot>${HW.money(0)}</span></div><div class="hw-f" style="margin-top:8px"><label class="w">Notes (optional)<textarea name="notes" placeholder="Anything the manager should know"></textarea></label></div>`;
    HW.modal({ title: 'Close shift', size: 'lg', body, actions: [{ label: 'Cancel' }, { label: 'Close shift', cls: 'p', fn: async (el) => {
      const denominations = $$('[data-d]', el).map((i) => ({ denomination: Number(i.dataset.d), count: Math.max(0, Math.floor(Number(i.value) || 0)) })).filter((x) => x.count > 0); const notes = $('[name=notes]', el).value.trim();
      let res; try { res = (await Api.post(`/shifts/${s._id}/close`, { denominations, notes })).data; } catch (e) { HW.err(e.message); return false; }
      SH.cur = null; SH.refresh(); SH.summary(res.shift || res); } }],
      onMount: (el) => el.addEventListener('input', () => { let t = 0; $$('[data-d]', el).forEach((i) => { const v = Math.max(0, Math.floor(Number(i.value) || 0)) * Number(i.dataset.d); t += v; $(`[data-o="${i.dataset.d}"]`, el).textContent = v ? v.toLocaleString() : '0'; }); $('[data-tot]', el).textContent = HW.money(t); }) });
  };
  SH.summary = (s) => {
    if (!s) return; const diff = Number(s.cashDifference || 0);
    HW.modal({ title: 'Shift closed', body: `<div class="hw-hero"><div class="big">${diff === 0 ? HW.ic('check-circle', 38) : HW.ic('alert', 38)}</div><h4>${diff === 0 ? 'Drawer balanced' : diff > 0 ? 'Drawer is over' : 'Drawer is short'}</h4><p>Here is how the shift ended.</p></div>
      <div class="hw-sum"><span>Opening float</span><b>${HW.money(s.openingCash)}</b></div><div class="hw-sum"><span>Expected cash</span><b>${HW.money(s.expectedCash)}</b></div><div class="hw-sum"><span>Cash counted</span><b>${HW.money(s.actualCash)}</b></div>
      <div class="hw-sum t ${diff === 0 ? 'good' : 'bad'}"><span>${diff === 0 ? 'Balanced' : diff > 0 ? 'Over by' : 'Short by'}</span><span>${HW.money(Math.abs(diff))}</span></div>`, actions: [{ label: 'Done', cls: 'p' }] });
  };
})();
