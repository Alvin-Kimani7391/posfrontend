/* Hardware workspace — FULL COUNTER TILL (replaces the simple counter).
   Everything sales.html does, in the hardware look:
   sell (scan / search / categories / units / contract prices) · line discounts & price override · cart discount · customer & credit ·
   hold & recall · payment window (cash + change, M-PESA prompt, M-PESA till, mobile money, card, bank, split, part-pay / credit) ·
   receipt print · cash drawer · cash shift · sales history with receipt / invoice / refund / cancel · keyboard shortcuts.
   Part 1 (this file): state, cart, sell screen, payment, checkout.  Part 2 (hw-till-more.js): drawer, held sales, history, refunds. */
(function () {
  const { Api, UI, Storage } = window, HW = window.HW;
  if (!HW || !HW.V) return;
  const E = HW.E, $ = HW.$, $$ = HW.$$, M = HW.money, br = () => HW.S.branch;
  const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
  const PRE = 'hw.till.'; const pref = { get: (k, d) => { try { const v = localStorage.getItem(PRE + k); return v === null ? d : v; } catch (e) { return d; } }, set: (k, v) => { try { localStorage.setItem(PRE + k, v); } catch (e) { /* blocked */ } } };
  const onGone = (el, fn) => { const p = el.parentNode; if (!p) return fn(); const mo = new MutationObserver(() => { if (!el.isConnected) { mo.disconnect(); fn(); } }); mo.observe(p, { childList: true }); };
  const stockOf = (p) => (p.stockHint && p.stockHint.retailQuantity !== undefined) ? p.stockHint.retailQuantity : (p.stock ?? p.quantity ?? null);
  const catOf = (p) => { const c = p.categoryId || p.category; return c && (c._id || c.id || c) || ''; };
  const can = (p) => HW.can(p);
  const autoMode = () => { const v = pref.get('autodoc', null); return v || (pref.get('autoprint', '1') === '1' ? 'receipt' : 'off'); };

  /* The shared core widgets (customer picker, receipts, scanner, drawer) expect these two globals */
  window.AppShell = window.AppShell || {};
  Object.assign(window.AppShell, { getUser: () => Storage.getUser(), getActiveBranchId: () => HW.S.branch, hasFeature: () => true });

  /* ===================================================== state (survives leaving the screen) */
  const T = HW.till = { lines: [], customer: null, cartDiscount: 0, dueDate: '', payments: [], key: Api.newIdempotencyKey ? Api.newIdempotencyKey() : String(Date.now()), busy: false, view: 'sell', q: '', cat: '', cats: null, flags: null, root: null, mobileCart: false };
  let seq = 0, repTimer = null;
  const unitsOf = (p) => [{ id: '', name: p.unit || 'unit', factor: 1 }].concat((p.units || []).filter((u) => u.status !== 'inactive').map((u) => ({ id: u._id, name: u.name, factor: u.factor })));
  const qtyLines = () => T.lines.filter((l) => Number(l.qty) > 0);
  const lineTotal = (l) => Math.max(0, r2((l.price || 0) * (Number(l.qty) || 0) - (Number(l.discount) || 0)));
  T.totals = () => { const sub = r2(qtyLines().reduce((s, l) => s + (l.price || 0) * Number(l.qty), 0)), ld = r2(qtyLines().reduce((s, l) => s + (Number(l.discount) || 0), 0)), cd = Number(T.cartDiscount) || 0; return { sub, ld, cd, total: Math.max(0, r2(sub - ld - cd)), items: qtyLines().length, units: r2(qtyLines().reduce((s, l) => s + Number(l.qty), 0)) }; };
  T.paid = () => r2(T.payments.reduce((s, p) => s + p.amount, 0));
  const drawerLocked = () => !!(window.CashDrawer && window.CashDrawer.isLocked && window.CashDrawer.isLocked());
  T.drawerLocked = drawerLocked;

  T.add = (p, unitName, qty = 1) => {
    if (drawerLocked()) return HW.err('Close the cash drawer before the next sale');
    const units = unitsOf(p), u = unitName ? units.find((x) => x.name === unitName) : null, pid = p._id || p.productId;
    const ex = T.lines.find((l) => l.productId === pid && l.unitId === (u ? u.id : ''));
    if (ex) ex.qty = r2(Number(ex.qty) + qty); else T.lines.push({ key: ++seq, productId: pid, name: p.name, sku: p.sku, barcode: p.barcode || (p.barcodes && p.barcodes[0]) || '', units, unitId: u ? u.id : '', qty, price: p.sellingPrice || 0, list: p.sellingPrice || 0, type: 'RETAIL', override: null, discount: 0, stock: stockOf(p), measurable: p.measurable, flash: true });
    T.draw(); T.reprice();
  };
  T.reprice = () => {
    clearTimeout(repTimer); repTimer = setTimeout(async () => {
      const items = T.lines.filter((l) => Number(l.qty) > 0 && l.override === null); if (!items.length) return T.draw();
      try { const { data } = await Api.post('/hardware/price-quote', { customerId: (T.customer && T.customer._id) || undefined, items: items.map((l) => ({ productId: l.productId, unitId: l.unitId || undefined, quantity: Number(l.qty) })) }); items.forEach((l, i) => { const r = data.items[i]; if (r) { l.price = r.unitPrice; l.list = r.listPrice; l.type = r.priceType; l.saving = r.saving; l.err = null; } }); }
      catch (e) { items.forEach((l) => { l.err = e.message; }); HW.err(e.message); }
      T.draw();
    }, 250);
  };
  T.reset = () => { T.lines = []; T.customer = null; T.cartDiscount = 0; T.dueDate = ''; T.payments = []; T.key = Api.newIdempotencyKey ? Api.newIdempotencyKey() : String(Date.now()); T.draw(); T.paintCustomer && T.paintCustomer(); };
  /* the global search box and quote form talk to the till through this */
  HW.S.cart = { add: (p, u) => T.add(p, u), reprice: () => T.reprice() };

  /* ===================================================== sell screen */
  HW.V.counter = async (el) => {
    T.root = el; T.mobileCart = false; if (T.unsub) { T.unsub(); T.unsub = null; }
    if (!T.flags) { try { T.flags = (await Api.get('/settings/integrations/flags')).data || {}; } catch (e) { T.flags = {}; } }
    if (!T.cats) { try { T.cats = await HW.opt.categories(); } catch (e) { T.cats = []; } }
    const on = (v) => T.view === v ? 'on' : '';
    el.innerHTML = `<div class="tl is-${T.view} ${T.full ? 'full' : ''}"><div class="tl-head">
      <div class="tl-tabs"><button data-v="sell" class="${on('sell')}">${HW.ic('cart', 17)} <span>Sell</span></button><button data-v="history" class="${on('history')}">${HW.ic('receipt', 17)} <span>Sales history</span></button><button data-v="shift" class="tl-shtab ${on('shift')}" data-shtab>${HW.ic('banknote', 17)} <span>Cash shift</span><i class="sd"></i><em data-shst>…</em></button></div><span class="sp"></span>
      <div class="tl-tools"><button class="tl-chip" data-recall title="Recall a held sale (F6)">${HW.ic('pause', 15)} <span>Held</span><b data-heldn></b></button><label class="tl-chip tl-doc" title="What to print or open after every sale"><span>After each sale</span><select data-autodoc>${[['receipt', 'Receipt'], ['invoice', 'Invoice'], ['both', 'Receipt + invoice'], ['off', 'Nothing']].map(([k, l]) => `<option value="${k}" ${autoMode() === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label><button class="tl-chip" data-drawer title="Cash drawer" style="display:none"></button>
        <button class="tl-ib" data-full title="Full view — hide the menu (F11 for true full screen)" aria-label="Full view">${HW.ic('menu', 18)}</button><button class="tl-ib" data-fs title="Full screen" aria-label="Full screen">${HW.ic('external', 18)}</button></div></div>
      <div class="tl-main" data-body></div></div>`;
    const root = $('.tl', el);
    $$('[data-v]', el).forEach((b) => b.onclick = () => { T.view = b.dataset.v; HW.V.counter(el); });
    $('[data-autodoc]', el).onchange = (e) => pref.set('autodoc', e.target.value);
    $('[data-recall]', el).onclick = () => HW.till.recall && HW.till.recall();
    $('[data-drawer]', el).onclick = () => HW.till.drawerSetup && HW.till.drawerSetup();
    /* full view = the till takes the whole window (menu + top bar hidden); full screen = the browser goes full screen too */
    T.setFull = (on) => { T.full = on; root.classList.toggle('full', on); document.body.classList.toggle('tl-fullview', on); $('[data-full]', el).classList.toggle('on', on); if (!on && document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => { }); };
    $('[data-full]', el).onclick = () => T.setFull(!T.full);
    $('[data-fs]', el).onclick = () => { if (document.fullscreenElement) return document.exitFullscreen(); T.setFull(true); const d = document.documentElement; if (d.requestFullscreen) d.requestFullscreen().catch(() => HW.err('Your browser blocked full screen — press F11 instead')); };
    if (T.full) document.body.classList.add('tl-fullview');
    /* the layout follows the width the till actually has, so it is right with the menu open, collapsed or hidden */
    if (T.ro) T.ro.disconnect();
    const fit = () => { const w = root.getBoundingClientRect().width; root.classList.toggle('narrow', w < 880); root.classList.toggle('xnarrow', w < 560); root.classList.toggle('wide', w > 1500); root.classList.toggle('tw-full', w >= 1400); root.classList.toggle('tw-mid', w >= 1120 && w < 1400); root.classList.toggle('tw-card', w < 1120); };
    if (window.ResizeObserver) { T.ro = new ResizeObserver(() => requestAnimationFrame(fit)); T.ro.observe(root); } fit();
    const leave = () => { if (!document.querySelector('.tl')) { document.body.classList.remove('tl-fullview'); if (T.ro) T.ro.disconnect(); window.removeEventListener('hashchange', leave); } };
    window.addEventListener('hashchange', () => setTimeout(leave, 50));
    /* cash shift tab: live state (Open · amount / Closed) */
    T.paintShiftTab = () => { const t = $('[data-shtab]'); if (!t) return; const s = HW.shift && HW.shift.cur; t.classList.toggle('is-open', !!s); t.classList.toggle('is-closed', s === null || s === false); $('[data-shst]', t).textContent = s ? 'Open' : (s === undefined ? '…' : 'Closed'); t.title = s ? `Shift open since ${HW.dt(s.openedAt)}` : 'No shift open — click to open one'; };
    T.paintShiftTab(); if (HW.shift) HW.shift.load().then(T.paintShiftTab);
    if (HW.till.initDrawer) HW.till.initDrawer(); if (HW.till.heldCount) HW.till.heldCount();
    if (T.view === 'shift') return HW.till.shiftView && HW.till.shiftView($('[data-body]', el));
    if (T.view === 'history') return HW.till.history && HW.till.history($('[data-body]', el));
    sellView($('[data-body]', el));
  };

  function sellView(body) {
    body.innerHTML = `<div class="tl-body"><div class="tl-work">
        <section class="tl-find hw-card"><div class="tl-sbar"><div class="tl-search"><span>${HW.ic('search', 22)}</span><input data-q placeholder="Scan barcode or search name / SKU…   (F2)" autocomplete="off" value="${E(T.q)}"><button type="button" data-qx aria-label="Clear" ${T.q ? '' : 'hidden'}>×</button></div><button class="hw-btn p tl-cam" data-cam title="Scan with camera" aria-label="Scan with camera">${HW.ic('scan', 20)}<span>Scan barcode</span></button></div>
          <div class="tl-pick"><div class="tl-prods" data-res></div></div></section>
        <section class="tl-cartc hw-card"><div class="tl-chd"><h3>Cart</h3><span class="tl-cnt" data-cn>0</span><span class="sp"></span><button class="hw-btn s" data-hold title="Park this sale (F4)">${HW.ic('pause', 14)} Hold <kbd>F4</kbd></button></div>
          <div class="tl-ct"><div class="tl-th"><span class="c-i">#</span><span class="c-b">Barcode</span><span class="c-n">Product</span><span class="c-p">Price / unit</span><span class="c-u">Unit</span><span class="c-q">Quantity</span><span class="c-d">Discount</span><span class="c-s">Subtotal</span><span class="c-x"></span></div><div class="tl-lines" data-cart></div></div>
          <div class="tl-cf"><span><b data-fp>0</b> products</span><span><b data-fu>0</b> units</span><span class="sp"></span><button class="tl-clr" data-clear>${HW.ic('x', 15)} Clear all</button></div></section></div>
      <aside class="tl-cart tl-sum hw-card"><div class="tl-ch"><h3>Sale summary</h3></div>
        <div class="tl-cust" data-cust></div><div data-tot></div>
        <div class="tl-act"><button class="hw-btn p big" data-pay>Pay <kbd>F9</kbd></button><div class="hw-bar" style="margin:8px 0 0"><button class="hw-btn" data-quote style="flex:1">${HW.ic('file', 16)} Save as quotation</button></div></div></aside></div>
      <div class="tl-mbar" data-mbar><button class="hw-btn" data-mview>Summary</button><div class="tt"><small data-mn></small><b data-mt></b></div><button class="hw-btn p" data-mpay>Pay</button></div>`;
    const tl = body.querySelector('.tl-body'), root = body.closest('.tl');
    T.setMobile = (on) => { T.mobileCart = on; tl.classList.toggle('cart-open', on); $('[data-mview]', body).textContent = on ? 'Back to products' : 'View cart'; };
    $('[data-mview]', body).onclick = () => { const s = $('.tl-sum', body); if (s) s.scrollIntoView({ behavior: 'smooth', block: 'start' }); }; $('[data-mpay]', body).onclick = () => HW.till.pay();
    $('[data-pay]', body).onclick = () => HW.till.pay();
    $('[data-hold]', body).onclick = () => HW.till.park && HW.till.park();
    $('[data-clear]', body).onclick = async () => { if (T.payments.some((p) => p.locked)) return HW.err('A confirmed M-PESA payment is waiting. Complete the sale first.'); if (!T.lines.length) return; if (await UI.confirmDialog({ title: 'Clear the cart?', message: 'All items will be removed.', confirmText: 'Clear', danger: true })) T.reset(); };
    $('[data-quote]', body).onclick = () => { if (!qtyLines().length) return HW.err('Add items first'); HW.quoteForm({ customerId: T.customer && T.customer._id, customerName: T.customer ? T.customer.name : '', lines: T.lines }); };
    /* customer */
    T.paintCustomer = () => { const c = T.customer, box = $('[data-cust]', body); if (!box) return; box.innerHTML = c ? `<div class="cu"><span class="av">${E(UI.initials ? UI.initials(c.name) : (c.name || '?')[0])}</span><div><b>${E(c.name)}</b><small>${E([c.phone, c.outstandingBalance > 0 ? 'owes ' + M(c.outstandingBalance) : '', c.creditLimit ? 'limit ' + M(c.creditLimit) : ''].filter(Boolean).join(' · '))}</small></div><button class="hw-btn s" data-cchg>Change</button><button class="hw-btn s x" data-cx aria-label="Remove customer">×</button></div>` : `<button class="tl-addc" data-cchg>${HW.ic('user-plus', 17)} Add customer <small>contractor prices & credit</small></button>`;
      $$('[data-cchg]', box).forEach((b) => b.onclick = () => pickCustomer(() => { T.paintCustomer(); T.reprice(); })); const x = $('[data-cx]', box); if (x) x.onclick = () => { T.customer = null; T.paintCustomer(); T.reprice(); }; };
    T.paintCustomer();
    /* cart */
    T.draw = () => {
      const box = $('[data-cart]', body); if (!box || !box.isConnected) return; const t = T.totals();
      const keep = document.activeElement && document.activeElement.closest && document.activeElement.closest('.tl-line') ? { k: document.activeElement.closest('.tl-line').dataset.k, f: document.activeElement.dataset.f } : null;
      box.innerHTML = T.lines.length ? T.lines.map((l, i) => { const fac = (l.units.find((u) => u.id === l.unitId) || {}).factor || 1, over = l.stock !== null && l.stock !== undefined && Number(l.qty) * fac > l.stock, gross = r2((l.price || 0) * (Number(l.qty) || 0));
        return `<div class="tl-line ${l.flash ? 'fl' : ''} ${l.err || over ? 'er' : ''} ${l.discount > 0 || l.override !== null || l.saving > 0 ? 'dsc' : ''}" data-k="${l.key}">
        <span class="c-i">${i + 1}</span><span class="c-b">${E(l.barcode || l.sku || '–')}</span>
        <div class="c-n"><b>${E(l.name)}</b>${l.type === 'CONTRACT' ? ' ' + HW.badge('CONTRACT', 'Contract') : ''}<small>${l.err ? `<span class="bad">${E(l.err)}</span>` : (over ? `<span class="bad">Only ${HW.num(l.stock)} in stock</span>` : (l.stock !== null && l.stock !== undefined ? `In stock ${HW.num(l.stock)}` : E(l.sku || '')))}${l.saving > 0 ? ` <i class="sv">saves ${M(l.saving)}</i>` : ''}</small></div>
        <div class="c-p"><button data-f="adj" title="Change price or discount">${M(l.price)}${l.override !== null ? '<small class="ch">price changed</small>' : (l.saving > 0 || l.type === 'CONTRACT' ? '<small class="ch">special price</small>' : '')}</button></div>
        <select class="c-u" data-f="unit" aria-label="Unit">${l.units.map((u) => `<option value="${E(u.id)}" ${u.id === l.unitId ? 'selected' : ''}>${E(u.name)}</option>`).join('')}</select>
        <div class="c-q q"><button data-f="dec" aria-label="Less">−</button><input type="number" min="0" step="${l.measurable === false ? 1 : 'any'}" value="${l.qty}" data-f="qty" inputmode="decimal" aria-label="Quantity"><button data-f="inc" aria-label="More">+</button></div>
        <input class="c-d dsci ${l.discount > 0 ? 'has' : ''}" type="number" min="0" step="any" inputmode="decimal" data-f="disc" value="${l.discount > 0 ? l.discount : ''}" placeholder="0" aria-label="Discount amount">
        <div class="c-s"><b>${M(lineTotal(l))}</b>${gross !== lineTotal(l) ? `<small>${M(gross)}</small>` : ''}</div>
        <button class="c-x" data-f="del" aria-label="Remove ${E(l.name)}">${HW.ic('x', 16)}</button></div>`; }).join('') : `<div class="tl-empty"><div>${HW.ic('cart', 46)}</div><b>Cart is empty</b><span>Scan a barcode or search a product above — it is added here.</span></div>`;
      T.lines.forEach((l) => { l.flash = false; });
      $$('.tl-line', box).forEach((row) => { const l = T.lines.find((x) => x.key === +row.dataset.k);
        const set = (v) => { l.qty = Math.max(0, r2(v)); if (l.qty === 0) T.lines = T.lines.filter((x) => x !== l); l.discount = Math.min(l.discount || 0, r2((l.price || 0) * l.qty)); T.draw(); T.reprice(); };
        const qi = row.querySelector('[data-f=qty]'); qi.onchange = (e) => set(Number(e.target.value) || 0); qi.onfocus = (e) => e.target.select(); qi.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); qi.blur(); const q = $('[data-q]', body); if (q && window.innerWidth > 900) q.focus(); } };
        row.querySelector('[data-f=inc]').onclick = () => set(Number(l.qty) + 1); row.querySelector('[data-f=dec]').onclick = () => set(Number(l.qty) - 1);
        row.querySelector('[data-f=unit]').onchange = (e) => { l.unitId = e.target.value; l.override = null; l.discount = 0; T.draw(); T.reprice(); };
        const di = row.querySelector('[data-f=disc]'); di.onfocus = (e) => e.target.select(); di.onchange = (e) => { l.discount = Math.min(Math.max(0, r2(Number(e.target.value) || 0)), r2((l.price || 0) * Number(l.qty))); T.draw(); };
        row.querySelector('[data-f=del]').onclick = () => { T.lines = T.lines.filter((x) => x !== l); T.draw(); T.reprice(); };
        row.querySelector('[data-f=adj]').onclick = () => adjustLine(l); });
      if (keep) { const r = box.querySelector(`.tl-line[data-k="${keep.k}"] [data-f="${keep.f}"]`); if (r && r.tagName === 'INPUT' && keep.f !== 'qty' && keep.f !== 'disc') r.focus(); }
      $('[data-cn]', body).textContent = t.items; $('[data-fp]', body).textContent = t.items; $('[data-fu]', body).textContent = HW.num(t.units, 2); $('[data-cn]', body).classList.toggle('z', !t.items);
      $('[data-tot]', body).innerHTML = `<div class="tl-tot"><div class="cd"><label for="tl-cd">Cart discount</label><input id="tl-cd" type="number" min="0" step="any" inputmode="decimal" data-cd value="${T.cartDiscount || ''}" placeholder="0"></div>
        <div class="rw"><span>Subtotal</span><b>${M(t.sub)}</b></div>${t.ld > 0 ? `<div class="rw dc"><span>Line discounts</span><b>−${M(t.ld)}</b></div>` : ''}${t.cd > 0 ? `<div class="rw dc"><span>Cart discount</span><b>−${M(t.cd)}</b></div>` : ''}
        <div class="gr"><div class="gh"><span>Total to pay</span><em>${HW.num(t.units, 2)} unit${t.units === 1 ? '' : 's'}</em></div><b>${M(t.total)}</b></div><small class="mut">Tax and final price rules are applied when the sale is saved.</small></div>
        ${T.payments.length ? `<div class="hw-note ok" style="margin:8px 0 0">M-PESA payment of <b>${M(T.paid())}</b> is confirmed — press Pay to finish the sale.</div>` : ''}`;
      const cd = $('[data-cd]', body); cd.onchange = (e) => { T.cartDiscount = Math.min(Math.max(0, Number(e.target.value) || 0), r2(t.sub - t.ld)); T.draw(); };
      $('[data-mn]', body).textContent = `${t.items} item${t.items === 1 ? '' : 's'}`; $('[data-mt]', body).textContent = M(t.total);
      $('[data-pay]', body).innerHTML = `${t.total > 0 ? 'Add payment · ' + M(t.total) : 'Add payment'} <kbd>F9</kbd>`; $('[data-pay]', body).disabled = !t.items;
    };
    T.draw(); T.reprice && T.lines.length && T.reprice();
    /* products */
    const res = $('[data-res]', body), inp = $('[data-q]', body), cats = T.cats || [];
    const tile = (p, i) => { const s = stockOf(p), low = s !== null && s <= 0; return `<button class="tl-prod ${low ? 'out' : ''}" data-i="${i}" type="button"><b>${E(p.name)}</b><small>${E([p.sku, p.brand].filter(Boolean).join(' · '))}</small><span class="st ${low ? 'o' : (s !== null && s < 5 ? 'l' : '')}">${s !== null ? (low ? 'Out of stock' : HW.num(s) + ' ' + E(p.unit || '')) : '&nbsp;'}</span><span class="pc">${M(p.sellingPrice)}<small>/ ${E(p.unit || 'unit')}</small></span></button>`; };
    let rows = [], tok = 0;
    const show = (list, note) => { rows = list; res.innerHTML = list.length ? list.map(tile).join('') : HW.empty(note || 'No product found', 'Try another word, or scan the barcode.'); $$('.tl-prod', res).forEach((b) => b.onclick = () => { T.add(rows[+b.dataset.i]); inp.value = ''; find(); inp.focus(); }); };
    async function find() {
      const my = ++tok, t = inp.value.trim(); T.q = t; $('[data-qx]', body).hidden = !t; $('.tl-body', body).classList.toggle('searching', !!t);
      if (!t) { rows = []; res.innerHTML = ''; return; } /* nothing is listed until the cashier searches */
      let l = []; try { l = HW.searchProducts ? await HW.searchProducts(t) : HW.list((await Api.get('/products', { search: t, limit: 24, status: 'active', branchId: br() })).data); } catch (e) { HW.err(e.message); }
      if (my !== tok) return; if (T.cat) l = l.filter((p) => String(catOf(p)) === String(T.cat)); show(l);
    }
    const byCode = async (code) => { try { const { data } = await Api.get(`/hardware/barcode/${encodeURIComponent(code)}`); const r = await Api.get(`/products/${data.productId}`, { branchId: br() }); const p = r.data.product || r.data; T.add(p, data.matchedOn !== 'BARCODE' ? data.unitName : null); return true; } catch (e) { return false; } };
    inp.addEventListener('input', UI.debounce(find, 180));
    inp.addEventListener('keydown', (e) => { if (e.key === 'Escape' && inp.value) { e.stopPropagation(); inp.value = ''; find(); } });
    const away = (e) => { if (!body.isConnected) return document.removeEventListener('mousedown', away); if (!e.target.closest('.tl-find') && inp.value) { inp.value = ''; find(); } }; document.addEventListener('mousedown', away);
    inp.addEventListener('keydown', async (e) => { if (e.key !== 'Enter') return; e.preventDefault(); const t = inp.value.trim(); if (!t) return; if (t.length >= 3 && /^[\w-]+$/.test(t) && await byCode(t)) { inp.value = ''; find(); return; } await find(); if (rows.length === 1) { T.add(rows[0]); inp.value = ''; find(); } });
    $('[data-qx]', body).onclick = () => { inp.value = ''; find(); inp.focus(); };
    $('[data-cam]', body).onclick = () => { if (!window.BarcodeScanner) return HW.err('Camera scanning is not available'); window.BarcodeScanner.openCameraModal({ onDetect: async (code) => { if (!(await byCode(code))) HW.err(`No product found for "${code}"`); } }); };
    find();
    /* hardware (USB / Bluetooth) barcode scanner — works from anywhere on the screen */
    if (window.BarcodeScanner && window.BarcodeScanner.listenHardwareScanner) T.unsub = window.BarcodeScanner.listenHardwareScanner(async (code) => { if (document.querySelector('.hw-modal,.modal-backdrop') || drawerLocked()) return; if (!(await byCode(code))) HW.err(`No product found for barcode "${code}"`); }, { onBlocked: () => HW.err('Close the cash drawer before scanning the next sale') });
    if (HW.S.pendingAdd) { T.add(HW.S.pendingAdd); HW.S.pendingAdd = null; } if (HW.S.pending) { inp.value = HW.S.pending; HW.S.pending = ''; find(); }
    if (window.innerWidth > 1100) setTimeout(() => inp.focus(), 80);
  }
  window.addEventListener('hashchange', () => { if (!location.hash.startsWith('#/counter') && T.unsub) { T.unsub(); T.unsub = null; } });

  /* keyboard shortcuts */
  document.addEventListener('keydown', (e) => {
    if (!location.hash.startsWith('#/counter') || T.view !== 'sell') return;
    if (e.key === 'Escape') { const m = $$('.hw-modal').pop(); if (m && !document.querySelector('.modal-backdrop')) { const x = m.querySelector('.x'); if (x) x.click(); } return; }
    if (document.querySelector('.hw-modal,.modal-backdrop,.drawer-lock')) return;
    if (e.key === 'F9') { e.preventDefault(); HW.till.pay(); } else if (e.key === 'F2') { e.preventDefault(); const q = $('[data-q]'); if (q) { q.focus(); q.select(); } } else if (e.key === 'F4') { e.preventDefault(); HW.till.park && HW.till.park(); } else if (e.key === 'F6') { e.preventDefault(); HW.till.recall && HW.till.recall(); }
  });

  function pickCustomer(done) {
    if (window.CustomerPicker) return window.CustomerPicker.open({ onSelect: (c) => { T.customer = c; done && done(c); } });
    HW.err('Customer picker is not available');
  }
  T.pickCustomer = pickCustomer;

  /* ===================================================== line adjust (discount / price override) */
  function adjustLine(l) {
    const canPrice = can('sales.price_override') || can('hardware.pricing');
    const m = HW.modal({ title: `Adjust — ${l.name}`, body: `<div class="hw-f"><label class="w">Discount on this line (${E(UI.activeCurrency ? UI.activeCurrency() : 'KES')})<input name="discount" type="number" min="0" step="any" inputmode="decimal" value="${l.discount || ''}" placeholder="0"><small>Line value is ${M(r2((l.price || 0) * l.qty))}. Quick:</small><div class="hw-chips">${[5, 10, 15, 20].map((p) => `<button type="button" data-pct="${p}">${p}%</button>`).join('')}</div></label>
      ${canPrice ? `<label class="chk w"><input type="checkbox" name="ov" ${l.override !== null ? 'checked' : ''}> Override the price</label><label class="w">New unit price<input name="price" type="number" min="0" step="any" inputmode="decimal" value="${l.override !== null ? l.override : l.price}" ${l.override !== null ? '' : 'disabled'}></label>` : '<p class="w mut">You do not have permission to change prices.</p>'}</div>`,
      actions: [{ label: 'Cancel' }, { label: 'Apply', cls: 'p', fn: (el) => { const d = Number($('[name=discount]', el).value) || 0; const ov = $('[name=ov]', el); const base = ov && ov.checked ? Number($('[name=price]', el).value) : l.price; if (ov && ov.checked && !(base >= 0)) { HW.err('Enter a valid price'); return false; } if (d > r2(base * l.qty) + 0.005) { HW.err('Discount is more than the line value'); return false; } if (ov && ov.checked) { l.override = base; l.price = base; } else if (l.override !== null) { l.override = null; T.reprice(); } l.discount = r2(d); T.draw(); } }],
      onMount: (el) => { $$('[data-pct]', el).forEach((b) => b.onclick = () => { $('[name=discount]', el).value = r2((l.price || 0) * l.qty * Number(b.dataset.pct) / 100); }); const ov = $('[name=ov]', el); if (ov) ov.onchange = () => { $('[name=price]', el).disabled = !ov.checked; }; setTimeout(() => $('[name=discount]', el).focus(), 60); } });
    return m;
  }

  /* ===================================================== PAYMENT WINDOW */
  const ceilTo = (n, s) => Math.ceil(n / s) * s;
  const quick = (t) => [...new Set([r2(t), ceilTo(t, 50), ceilTo(t, 100), ceilTo(t, 500), ceilTo(t, 1000)])].filter((n) => n >= t).slice(0, 5);
  HW.till.pay = async () => {
    if (drawerLocked()) return HW.err('Close the cash drawer before taking the next payment');
    if (!qtyLines().length) return HW.err('Cart is empty');
    if (T.lines.some((l) => l.err)) return HW.err('Fix the highlighted item first');
    if (T.totals().total <= 0) return HW.err('Total must be greater than zero');
    if (HW.shift && !(await HW.shift.guard())) return;
    payModal();
  };
  function payModal() {
    const F = T.flags || {}; let method = 'CASH', poll = null, manualRef = null, closed = false, cur = null;
    const METH = [['CASH', 'Cash', 'banknote'], ...(F.mpesaEnabled ? [['MPESA', 'M-PESA prompt', 'send']] : []), ...(F.mpesaManualEnabled ? [['MPESA_TILL', 'M-PESA till', 'store']] : []), ['MOBILE_MONEY', 'Mobile money', 'smartphone'], ['CARD', 'Card', 'credit-card'], ['BANK', 'Bank', 'landmark'], ['CREDIT', 'On credit', 'receipt']];
    const total = () => T.totals().total, rem = () => Math.max(0, r2(total() - T.paid()));
    const m = HW.modal({ title: 'Payment', size: 'lg', body: `<div class="tp"><div class="tp-sum" data-sum></div><div class="tp-meth" data-meth>${METH.map(([id, l, ic]) => `<button type="button" data-m="${id}"><i>${HW.ic(ic, 24)}</i>${l}</button>`).join('')}</div><div class="tp-panel" data-panel></div></div>`,
      actions: [{ label: 'Cancel' }, { label: 'Complete sale', cls: 'p', fn: async () => { if (!cur || !cur.build) return false; const p = cur.build(); if (!p) return false; if (p !== true) T.payments.push(p); if (rem() > 0.009 && !cur.credit) { paintSum(); select(method); return false; } return (await finish()) ? true : false; } }] });
    const el = m.el, btn = () => $('.hw-mf [data-a="1"]', el);
    const clearPoll = () => { if (poll) { clearInterval(poll); poll = null; } };
    onGone(el, () => { closed = true; clearPoll(); if (manualRef) { Api.post(`/payments/mpesa/${manualRef}/cancel`, {}).catch(() => {}); manualRef = null; } T.payments = T.payments.filter((p) => p.locked); T.draw && T.draw(); });
    function paintSum() {
      const t = total(), paid = T.paid(), r = rem();
      $('[data-sum]', el).innerHTML = `<div class="due"><span>${paid > 0 ? 'Still to pay' : 'Amount due'}</span><b>${M(r)}</b></div><div class="mini"><div><span>Sale total</span><b>${M(t)}</b></div><div><span>Paid so far</span><b>${M(paid)}</b></div>${T.customer ? `<div><span>Customer</span><b>${E(T.customer.name)}</b></div>` : ''}</div>
        ${T.payments.length ? `<div class="app">${T.payments.map((p, i) => `<span class="pp">${E(HW.human(p.method))} ${M(p.amount)}${p.locked ? ' ' + HW.ic('check', 13) : `<button data-rm="${i}" aria-label="Remove payment">×</button>`}</span>`).join('')}</div>` : ''}`;
      $$('[data-rm]', el).forEach((b) => b.onclick = () => { T.payments.splice(+b.dataset.rm, 1); paintSum(); select(method); });
    }
    const setBtn = (label, ok, hide) => { const b = btn(); if (!b) return; b.textContent = label; b.disabled = !ok; b.style.display = hide ? 'none' : ''; };
    function select(id) {
      clearPoll(); if (manualRef && id !== 'MPESA_TILL') { Api.post(`/payments/mpesa/${manualRef}/cancel`, {}).catch(() => {}); manualRef = null; }
      method = id; $$('[data-m]', el).forEach((b) => b.classList.toggle('on', b.dataset.m === id)); const P = $('[data-panel]', el); const r = rem(); cur = null; ({ CASH: cash, MPESA: stk, MPESA_TILL: till, MOBILE_MONEY: mobile, CARD: ref, BANK: ref, CREDIT: credit }[id])(P, r);
    }
    /* ---- cash ---- */
    function cash(P, r) {
      P.innerHTML = `<div class="hw-f"><label class="w">Cash received<input data-rc type="number" min="0" step="any" inputmode="decimal" value="${r}" ></label></div><div class="hw-chips" data-q>${quick(r).map((n) => `<button type="button" data-v="${n}">${n === r ? 'Exact ' : ''}${n.toLocaleString()}</button>`).join('')}</div><div class="tp-chg" data-chg></div>`;
      const inp = $('[data-rc]', P), upd = () => { const v = Number(inp.value) || 0, ch = r2(v - r); $('[data-chg]', P).innerHTML = v <= 0 ? '' : (v >= r - 0.009 ? `<span>Change to give</span><b>${M(Math.max(0, ch))}</b>` : `<span class="bad">Short by ${M(r2(r - v))} — it will be added as a part payment</span>`); setBtn(v >= r - 0.009 ? 'Complete sale' : 'Add part payment', v > 0); };
      inp.oninput = upd; $$('[data-v]', P).forEach((b) => b.onclick = () => { inp.value = b.dataset.v; upd(); }); upd(); setTimeout(() => { inp.focus(); inp.select(); }, 60);
      inp.onkeydown = (e) => { if (e.key === 'Enter') btn().click(); };
      cur = { build: () => { const v = Number(inp.value) || 0; if (v <= 0) { HW.err('Enter the cash received'); return null; } return { method: 'CASH', amount: Math.min(v, r), amountTendered: v }; } };
    }
    /* ---- generic amount (+ extra fields) ---- */
    function amountField(r) { return `<label class="w">Amount<input data-am type="number" min="0" step="any" inputmode="decimal" value="${r}"></label>`; }
    function mobile(P, r) {
      P.innerHTML = `<div class="tp-note">Customer pays by mobile money. Read the confirmation SMS and type the details.</div><div class="hw-f">${amountField(r)}<label>Network<select data-net>${['M-PESA', 'Airtel Money', 'T-Kash', 'Equitel', 'Other'].map((n) => `<option>${n}</option>`).join('')}</select></label><label>Transaction code<input data-ref maxlength="30" autocapitalize="characters" autocomplete="off" placeholder="e.g. UJK1A2B3C4"></label><label>Customer phone (optional)<input data-ph inputmode="tel" placeholder="07XXXXXXXX" value="${E((T.customer && T.customer.phone) || '')}"></label></div>`;
      const am = $('[data-am]', P), rf = $('[data-ref]', P), upd = () => { rf.value = rf.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); const a = Number(am.value) || 0; setBtn(a >= r - 0.009 ? 'Complete sale' : 'Add part payment', rf.value.length >= 6 && a > 0 && a <= r + 0.009); };
      rf.oninput = upd; am.oninput = upd; upd(); setTimeout(() => rf.focus(), 60);
      cur = { build: () => ({ method: 'MOBILE_MONEY', amount: Math.min(Number(am.value) || 0, r), reference: rf.value, provider: $('[data-net]', P).value, network: $('[data-net]', P).value, payerPhone: $('[data-ph]', P).value.trim() || undefined }) };
    }
    function ref(P, r) {
      P.innerHTML = `<div class="tp-note">${method === 'BANK' ? 'Bank transfer' : 'Card'} payment. Confirm the money has arrived before completing the sale.</div><div class="hw-f">${amountField(r)}<label>Reference / slip no. (optional)<input data-ref placeholder="Transaction code, slip number…"></label></div>`;
      const am = $('[data-am]', P), upd = () => { const a = Number(am.value) || 0; setBtn(a >= r - 0.009 ? 'Complete sale' : 'Add part payment', a > 0 && a <= r + 0.009); }; am.oninput = upd; upd();
      $('[data-ref]', P).onkeydown = (e) => { if (e.key === 'Enter') btn().click(); }; setTimeout(() => $('[data-ref]', P).focus(), 60);
      cur = { build: () => ({ method, amount: Math.min(Number(am.value) || 0, r), reference: $('[data-ref]', P).value.trim() || undefined }) };
    }
    /* ---- credit / part payment on account ---- */
    function credit(P, r) {
      const c = T.customer; const paid = T.paid();
      if (!c) { P.innerHTML = `<div class="hw-empty"><b>Choose a customer</b>A sale can only go on credit for a registered customer.</div><div style="text-align:center"><button class="hw-btn p" data-pc>Choose customer</button></div>`; $('[data-pc]', P).onclick = () => pickCustomer(() => { T.paintCustomer && T.paintCustomer(); T.reprice(); paintSum(); select('CREDIT'); }); setBtn('Complete on credit', false); cur = null; return; }
      P.innerHTML = `<div class="tp-note warn"><b>${M(r)}</b> will be recorded as a debt for <b>${E(c.name)}</b>${paid > 0 ? ` (after ${M(paid)} already paid)` : ''}.${c.outstandingBalance > 0 ? `<br>Already owes ${M(c.outstandingBalance)}${c.creditLimit ? ` of a ${M(c.creditLimit)} limit` : ''}.` : ''}</div><div class="hw-f"><label>Payment due date<input type="date" data-due value="${E(T.dueDate || '')}"></label><label>Pay something now (optional)<input data-am type="number" min="0" step="any" inputmode="decimal" placeholder="0"></label></div>`;
      const am = $('[data-am]', P); setBtn('Complete sale on credit', true);
      cur = { credit: true, build: () => { T.dueDate = $('[data-due]', P).value; const a = Number(am.value) || 0; if (a > 0) { T.payments.push({ method: 'CASH', amount: Math.min(a, r), amountTendered: a }); } return true; } };
    }
    /* ---- M-PESA ---- */
    const status = (P, tone, label, msg, extra = '') => { const s = $('[data-st]', P); if (s) s.innerHTML = `<div class="tp-st ${tone}"><b>${E(label)}</b><span>${E(msg || '')}</span>${extra}</div>`; };
    const watch = (P, reference, amount, mode) => {
      let done = false;
      const handle = async (s) => { if (done || closed) return; if (s.status === 'SUCCESS') { done = true; clearPoll(); manualRef = null; T.payments.push({ method: 'MPESA', amount, reference, locked: true }); status(P, 'ok', 'Payment confirmed', s.message || 'Saving the sale…'); HW.ok('M-PESA payment confirmed'); paintSum(); setTimeout(async () => { if (closed) return; if (rem() > 0.009) { select(method === 'MPESA_TILL' ? 'MPESA_TILL' : 'MPESA'); return; } if (await finish()) m.close(); else { status(P, 'warn', 'Paid — sale not saved', 'The M-PESA payment is confirmed but the sale could not be saved. Press “Save sale” to try again. Do not start another payment.'); setBtn('Save sale', true); cur = { build: () => true }; } }, 700); }
        else if (s.status === 'FAILED' || s.status === 'CANCELLED') { done = true; clearPoll(); status(P, s.failureType === 'timeout' ? 'warn' : 'er', mode === 'TILL' ? 'No payment received' : 'Payment failed', s.message, '<button class="hw-btn s" data-retry>Try again</button>'); const rb = $('[data-retry]', P); if (rb) rb.onclick = () => select(method); manualRef = null; } };
      poll = setInterval(async () => { if (closed) return clearPoll(); try { handle((await Api.get(`/payments/mpesa/${reference}/status`)).data); } catch (e) { /* keep polling */ } }, 3000);
      P._handle = handle;
    };
    function stk(P, r) {
      const locked = T.payments.some((p) => p.locked);
      P.innerHTML = `<div class="tp-note">A payment prompt is sent to the customer’s phone. Amount: <b>${M(r)}</b></div><div class="hw-f"><label class="w">Customer M-PESA number<input data-ph inputmode="tel" placeholder="07XXXXXXXX" value="${E((T.customer && T.customer.phone) || '')}"></label></div><div class="hw-bar" style="margin-top:10px"><button class="hw-btn p" data-send>Send prompt</button></div><div data-st></div>`;
      setBtn('', false, true); cur = null;
      $('[data-send]', P).onclick = async (e) => { const ph = $('[data-ph]', P).value.trim(); if (!ph) return HW.err('Enter the customer phone number'); clearPoll(); const b = e.currentTarget; b.classList.add('is-busy'); status(P, 'pending', 'Sending', 'Sending the prompt to the customer’s phone…');
        try { const { data } = await Api.post('/payments/mpesa/stk', { branchId: br(), phone: ph, amountCents: Math.round(r * 100) }); status(P, 'pending', 'Waiting for the customer', 'Ask the customer to enter their M-PESA PIN on their phone.', '<button class="hw-btn s" data-chk>Check now</button>'); watch(P, data.reference, r, 'STK'); const cb = $('[data-chk]', P); if (cb) cb.onclick = async () => { try { P._handle((await Api.get(`/payments/mpesa/${data.reference}/status`)).data); } catch (er) { HW.err(er.message); } }; }
        catch (err) { status(P, 'er', 'Could not send prompt', err.message); HW.err(err.message); } finally { b.classList.remove('is-busy'); } };
      setTimeout(() => $('[data-ph]', P).focus(), 60);
    }
    async function till(P, r) {
      P.innerHTML = `<div class="tp-note">Customer pays <b>${M(r)}</b> to Till <b data-tn>${E(F.tillNumber || '…')}</b> using M-PESA “Buy Goods”.</div><div data-st></div><div class="hw-f" style="margin-top:10px"><label class="w">Already paid? Enter the M-PESA code<input data-code maxlength="10" autocapitalize="characters" placeholder="e.g. UJK1A2B3C4"></label></div><div class="hw-bar"><button class="hw-btn" data-claim>Verify code</button></div>`;
      setBtn('', false, true); cur = null; status(P, 'pending', 'Starting', 'Preparing the payment request…');
      $('[data-code]', P).oninput = (e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); };
      $('[data-claim]', P).onclick = async (e) => { const code = $('[data-code]', P).value.trim(); if (!/^[A-Z][A-Z0-9]{9}$/.test(code)) return HW.err('An M-PESA code is 10 characters, e.g. UJK1A2B3C4'); if (!manualRef) return HW.err('No payment request is active yet'); const b = e.currentTarget; b.classList.add('is-busy'); try { P._handle && P._handle((await Api.post(`/payments/mpesa/${manualRef}/claim`, { receiptCode: code })).data); } catch (er) { HW.err(er.message); } finally { b.classList.remove('is-busy'); } };
      try { const { data } = await Api.post('/payments/mpesa/manual', { branchId: br(), amountCents: Math.round(r * 100) }); if (closed || method !== 'MPESA_TILL') { Api.post(`/payments/mpesa/${data.reference}/cancel`, {}).catch(() => {}); return; } manualRef = data.reference; if (data.tillNumber) $('[data-tn]', P).textContent = data.tillNumber; status(P, 'pending', 'Waiting for the customer', 'Waiting for the customer to pay to the Till number…'); watch(P, data.reference, r, 'TILL'); }
      catch (err) { status(P, 'er', 'Could not start', err.message, '<button class="hw-btn s" data-retry>Try again</button>'); const rb = $('[data-retry]', P); if (rb) rb.onclick = () => select('MPESA_TILL'); }
    }
    $$('[data-m]', el).forEach((b) => b.onclick = () => select(b.dataset.m));
    paintSum();
    const locked = T.payments.some((p) => p.locked);
    select(locked && rem() > 0.009 ? (F.mpesaManualEnabled ? 'MPESA_TILL' : 'MPESA') : 'CASH');
    if (locked && rem() <= 0.009) { setBtn('Save sale', true); cur = { build: () => true }; $('[data-panel]', el).innerHTML = '<div class="tp-note ok">The M-PESA payment is confirmed. Press <b>Save sale</b> to finish.</div>'; }
    async function finish() { return await HW.till.checkout(); }
  }

  /* ===================================================== EVERY SALE HAS A RECEIPT AND AN INVOICE */
  T.docFor = async (id, receipt) => { if (receipt) return receipt; const { data } = await Api.get(`/sales/${id}`); return data.receipt; };
  T.receipt = async (id, receipt, mode) => { try { const r = await T.docFor(id, receipt); if (!r) throw new Error('No receipt was found for this sale'); if (mode === 'print') await window.ReceiptView.printReceipt(r); else window.ReceiptView.showReceiptModal(r); } catch (e) { HW.err('Receipt: ' + e.message); } };
  T.invoice = async (id, receipt, label) => { if (!window.InvoiceView) return HW.err('Invoice view is not available'); try { const r = await T.docFor(id, receipt); window.InvoiceView.open(id, { receipt: r, title: `Invoice ${label || ''}`.trim() }); } catch (e) { HW.err('Invoice: ' + e.message); } };
  T.documents = (id, receipt, label, cancelled) => [[HW.ic('printer', 17) + ' Print receipt', () => T.receipt(id, receipt, 'print')], [HW.ic('eye', 17) + ' View receipt', () => T.receipt(id, receipt, 'view')], ...(cancelled ? [] : [[HW.ic('file', 17) + ' Invoice', () => T.invoice(id, receipt, label)]])];

  /* ===================================================== CHECKOUT */
  HW.till.checkout = async () => {
    if (T.busy) return false; const t = T.totals(); if (!qtyLines().length) { HW.err('Cart is empty'); return false; }
    const paid = T.paid(), balance = r2(t.total - paid);
    if (balance > 0.009 && !T.customer) { HW.err('Choose a customer to put the balance on credit'); return false; }
    if (balance < -0.009) { HW.err('Payments are more than the sale total'); return false; }
    const cashP = T.payments.filter((p) => p.method === 'CASH' && p.amountTendered); const change = r2(cashP.reduce((s, p) => s + Math.max(0, (p.amountTendered || 0) - p.amount), 0)), tendered = r2(cashP.reduce((s, p) => s + (p.amountTendered || 0), 0));
    const payload = { branchId: br(), channel: 'RETAIL', customerId: (T.customer && T.customer._id) || undefined, cartDiscount: T.cartDiscount || 0, dueDate: balance > 0.009 && T.dueDate ? T.dueDate : undefined,
      items: qtyLines().map((l) => ({ productId: l.productId, unitId: l.unitId || undefined, quantity: Number(l.qty), discount: l.discount || 0, overridePrice: l.override !== null ? l.override : undefined })),
      payments: T.payments.map((p) => ({ method: p.method, amount: p.amount, reference: p.reference, provider: p.method === 'MOBILE_MONEY' ? p.provider : undefined, amountTendered: p.method === 'CASH' ? p.amountTendered : undefined })) };
    T.busy = true; let data;
    try { ({ data } = await Api.post('/sales', payload, { idempotencyKey: T.key })); }
    catch (err) { T.busy = false; HW.err(err.code === 'NETWORK_ERROR' ? 'Connection lost — nothing was saved. Your cart and payment are kept: press the button again to retry safely.' : err.message); return false; }
    T.busy = false;
    const sale = data.sale || data, receipt = data.receipt, cust = T.customer, lines = T.lines.slice();
    if (change > 0 && window.CashDrawer && window.CashDrawer.isEnabled && window.CashDrawer.isEnabled()) window.CashDrawer.beginChange({ change, tendered, due: t.total, receiptNumber: sale.receiptNumber, saleId: sale._id || '' });
    T.payments = []; T.reset(); if (HW.shift) HW.shift.refresh();
    { const mode = autoMode(), sid = sale._id || sale.id, lbl = sale.invoiceNumber || sale.receiptNumber; if (mode === 'receipt' || mode === 'both') T.receipt(sid, receipt, 'print'); if (mode === 'invoice' || mode === 'both' || (balance > 0.009 && mode !== 'off')) T.invoice(sid, receipt, lbl); /* a sale on credit always gets its invoice */ }
    done(sale, receipt, { change, balance, cust, lines }); return true;
  };
  function done(sale, receipt, o) {
    const id = sale._id || sale.id, lbl = sale.invoiceNumber || sale.receiptNumber;
    HW.modal({ title: 'Sale complete', body: `<div class="hw-hero"><div class="big">${HW.ic('check-circle', 40)}</div><h4>${E(sale.receiptNumber || 'Sale saved')}</h4><p>Total ${M(sale.total)}${o.cust ? ' · ' + E(o.cust.name) : ''}${sale.invoiceNumber ? ' · Invoice ' + E(sale.invoiceNumber) : ''}</p></div>
      ${o.change > 0 ? `<div class="tp-chg big"><span>Give change</span><b>${M(o.change)}</b></div>` : ''}${o.balance > 0.009 ? `<div class="hw-note wa">Balance on credit: <b>${M(o.balance)}</b> — give the customer the invoice.</div>` : ''}
      <div class="tl-docs"><div class="dc"><b>${HW.ic('receipt', 18)} Receipt</b><div><button class="hw-btn" data-pr>${HW.ic('printer', 16)} Print</button><button class="hw-btn" data-vr>${HW.ic('eye', 16)} View</button></div></div>
        <div class="dc"><b>${HW.ic('file', 18)} Invoice</b><div><button class="hw-btn ${o.balance > 0.009 ? 'p' : ''}" data-inv>${HW.ic('file', 16)} Open &amp; print</button></div></div></div>
      <div class="tl-done" style="margin-top:10px"><button class="hw-btn" data-del>${HW.ic('truck', 17)} Schedule delivery</button></div>`,
      actions: [{ label: 'New sale', cls: 'p' }], onMount: (el) => { const g = (x) => $(x, el);
        g('[data-pr]').onclick = () => T.receipt(id, receipt, 'print'); g('[data-vr]').onclick = () => T.receipt(id, receipt, 'view'); g('[data-inv]').onclick = () => T.invoice(id, receipt, lbl);
        g('[data-del]').onclick = () => HW.deliveryForm({ saleId: id, customerId: o.cust && o.cust._id, customerName: o.cust ? o.cust.name : '' });
        setTimeout(() => { const q = $('[data-q]'); if (q && window.innerWidth > 1100) q.focus(); }, 100); } });
  }
  T.afterSaleModal = done;
})();
