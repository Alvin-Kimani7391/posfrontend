/**
 * hw-offline.js - Hardware workspace: plugs the existing till offline system (js/core/offline-*.js + offline-ui.js)
 * into the hardware counter till, with its own live status in Navy & Lime.
 *
 * It does not copy any offline logic. It reads the same policy / device / grants / catalog / outbox the rest of the
 * app uses, so what the owner sets in Settings > Offline selling is exactly what the hardware till obeys:
 * offline switched on/off, max window, unsynced limits, discount cap, allowed payment methods, PIN lock, shifts.
 *
 *  1. Status pill in the top bar (always there): Online / Offline-ready / Syncing / N waiting / OFFLINE / Set up offline.
 *     Click = the "Till offline centre" (set up this till, download products, offline PIN, sync now, issues, backup).
 *  2. Strip under the top bar: appears the moment the server cannot be reached ("Selling continues from this till"),
 *     turns lime "Back online - syncing N sales" and clears itself when the queue is empty.
 *  3. Counter till works offline:
 *       - product search / barcode fall back to the product list saved on this till
 *       - Pay: saves the sale in the offline outbox (same receipt numbers, same limits) instead of failing
 *       - a connection that drops in the middle of Pay falls back to the offline save automatically
 *         (same transaction id, so a sale can never be recorded twice)
 *  4. Live panel inside the Till offline centre: sync progress, files saved for offline use, app version, update check.
 */
(function (window, document) {
  'use strict';
  var Offline = window.Offline, Api = window.Api, HW = window.HW;
  if (!Offline || !Api) return;

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var r2 = function (n) { return Math.round((Number(n) || 0) * 100) / 100; };
  var online = function () { return !window.Connectivity || window.Connectivity.isOnline(); };
  var ready = function () { return Offline.isReady && Offline.isReady(); };
  var canOffline = function () { try { return ready() && Offline.device.enrolled() && Offline.context.policyOn(); } catch (e) { return false; } };
  var money = function (n) { return (window.UI && window.UI.formatMoney) ? window.UI.formatMoney(n || 0) : String(n); };
  var toastOk = function (m) { (HW && HW.ok) ? HW.ok(m) : (window.UI && window.UI.toast.success(m)); };
  var toastErr = function (m) { (HW && HW.err) ? HW.err(m) : (window.UI && window.UI.toast.error(m)); };

  /* ====================================================================
   * 1 + 2. Status pill and strip
   * ==================================================================== */
  var pill = null, strip = null, stripTimer = null, wasOffline = !online();

  function state() {
    var s = ready() ? Offline.status() : null;
    if (!s) return { tone: 'info', text: 'Offline', title: 'Starting offline mode' };
    var pend = s.pendingSales || s.pending || 0;
    if (!s.online) {
      var ok = s.enrolled && s.policyOn && s.catalogReady;
      return { tone: 'off', text: 'OFFLINE' + (pend ? ' · ' + pend + ' saved' : ''), title: ok ? 'No internet. This till can keep selling.' : 'No internet. This till is not set up to sell offline.', s: s };
    }
    if (s.syncState === 'syncing') return { tone: 'info', text: 'Syncing ' + (s.pending || '') + '…', title: 'Sending offline sales to the server', s: s };
    if (s.pending && s.syncState === 'auth') return { tone: 'warn', text: 'Sign in to sync', title: 'Sign in again to send ' + s.pending + ' saved sale(s)', s: s };
    if (s.pending) return { tone: 'warn', text: s.pending + ' waiting', title: 'Offline sales waiting to sync', s: s };
    if (s.issues) return { tone: 'bad', text: s.issues + ' need attention', title: 'Some offline sales need a manager', s: s };
    if (!s.enrolled) return { tone: 'warn', text: 'Set up offline', title: 'Set up this till so it can sell without internet', s: s };
    if (!s.policyOn) return { tone: 'warn', text: 'Offline: off', title: 'The owner has switched offline selling off', s: s };
    if (!s.catalogReady) return { tone: 'info', text: 'Downloading products…', title: 'Saving the product list on this till', s: s };
    return { tone: 'ok', text: 'Offline-ready', title: 'This till can keep selling if the internet drops', s: s };
  }

  function ensurePill() {
    var top = $('.hw-top'); if (!top) return;
    if (!pill || !pill.isConnected) {
      pill = document.createElement('button');
      pill.type = 'button'; pill.id = 'hw-ofl-pill'; pill.className = 'hwo-pill';
      pill.addEventListener('click', function () { if (window.OfflineUI) window.OfflineUI.openCenter(); });
      var anchor = $('#gwrap', top) || $('.u', top);
      if (anchor && anchor.parentNode === top) top.insertBefore(pill, anchor.nextSibling); else top.appendChild(pill);
    }
    if (!strip || !strip.isConnected) {
      strip = document.createElement('div'); strip.id = 'hw-ofl-strip'; strip.className = 'hwo-strip'; strip.setAttribute('role', 'status'); strip.setAttribute('aria-live', 'polite');
      top.parentNode.insertBefore(strip, top.nextSibling);
    }
  }

  function paint() {
    ensurePill();
    if (!pill) return;
    var st = state();
    pill.className = 'hwo-pill ' + st.tone;
    pill.title = st.title + ' – click for the offline centre';
    pill.innerHTML = '<i></i><span class="l">' + esc(st.text) + '</span>';
    paintStrip(st);
  }

  function setStrip(cls, title, sub, btn) {
    if (!strip) return;
    strip.className = 'hwo-strip on ' + cls;
    strip.innerHTML = '<span class="d"></span><div class="g">' + esc(title) + (sub ? '<small>' + esc(sub) + '</small>' : '') + '</div>' + (btn ? '<button type="button" class="hwp-btn" data-s>' + esc(btn) + '</button>' : '');
    var b = $('[data-s]', strip); if (b) b.onclick = function () { if (window.OfflineUI) window.OfflineUI.openCenter(); };
  }
  function hideStrip() { if (strip) strip.className = 'hwo-strip'; }

  function paintStrip(st) {
    if (!strip) return;
    var s = st.s; if (!s) return;
    var pend = s.pendingSales || s.pending || 0;
    if (!s.online) {
      wasOffline = true; clearTimeout(stripTimer);
      var can = s.enrolled && s.policyOn && s.catalogReady;
      if (can) setStrip('', 'You are offline. Selling continues from this till.', 'Sales are saved here' + (pend ? ' (' + pend + ' so far)' : '') + ' and sync by themselves when the internet returns.', 'Offline centre');
      else setStrip('warn', 'You are offline and this till is not set up to sell offline.', !s.enrolled ? 'Connect once, tap the Offline button and choose "Set up this till".' : (!s.policyOn ? 'The owner has switched offline selling off.' : 'The product list has not finished downloading.'), 'Offline centre');
      return;
    }
    if (wasOffline) {
      if (pend) setStrip('back', 'Back online. Syncing ' + pend + ' saved sale' + (pend === 1 ? '' : 's') + '…', s.syncState === 'auth' ? 'Sign in again to send them.' : 'Nothing is lost if you close this page.', null);
      else { setStrip('back', 'Back online. Everything is synced.', '', null); wasOffline = false; clearTimeout(stripTimer); stripTimer = setTimeout(hideStrip, 3500); }
      return;
    }
    if (s.pending && s.syncState === 'auth') setStrip('warn', pend + ' offline sale(s) waiting. Sign in to send them.', '', 'Offline centre');
    else hideStrip();
  }

  /* ====================================================================
   * 3a. Offline product lookup for the till
   * ==================================================================== */
  var idMap = null, idMapFor = -1;
  function products() {
    var n = Offline.catalog.count();
    if (!idMap || idMapFor !== n) { idMap = new Map(); Offline.catalog.search('', 1e6).forEach(function (p) { idMap.set(String(p._id), p); }); idMapFor = n; }
    return idMap;
  }
  function catalogUsable() { try { return ready() && Offline.catalog.isReady(); } catch (e) { return false; } }
  function useLocal(err) { return catalogUsable() && (!online() || (err && err.code === 'NETWORK_ERROR')); }

  function patchLookup() {
    if (patchLookup.done) return; patchLookup.done = true;
    // Search box
    if (HW && HW.searchProducts) {
      var orig = HW.searchProducts;
      HW.searchProducts = async function (term) {
        if (!online() && catalogUsable()) return Offline.catalog.search(term, 20);
        try { var r = await orig(term); if (r && r.length) return r; if (online()) return r; } catch (e) { if (!useLocal(e)) throw e; }
        return catalogUsable() ? Offline.catalog.search(term, 20) : [];
      };
      if (HW.pickers && HW.pickers.product) HW.pickers.product.fetch = HW.searchProducts;
    }
    // Barcode scan + opening a product: the till asks the server; answer from the saved product list when it cannot be reached.
    var get = Api.get.bind(Api);
    Api.get = async function (path, query, opts) {
      var m = typeof path === 'string' && (path.match(/^\/hardware\/barcode\/(.+)$/) || path.match(/^\/products\/([^/?]+)$/));
      if (!m) return get(path, query, opts);
      if (online()) {
        try { return await get(path, query, opts); } catch (e) { if (!useLocal(e)) throw e; }
      }
      if (!catalogUsable()) return get(path, query, opts);
      var key = decodeURIComponent(m[1]);
      if (/^\/hardware\/barcode\//.test(path)) {
        var hit = await Offline.catalog.byBarcode(key);
        if (!hit) { var e = new Error('No product found for barcode "' + key + '"'); e.code = 'BARCODE_NOT_FOUND'; throw e; }
        return { data: { productId: hit.product._id, matchedOn: 'BARCODE', unitName: null } };
      }
      var p = products().get(key); if (!p) { var e2 = new Error('This product is not saved on this till'); e2.code = 'NOT_FOUND'; throw e2; }
      return { data: { product: p } };
    };
    // Contractor / tier prices come from the server. Offline the list price stays (no error toast on every scan).
    var post = Api.post.bind(Api);
    Api.post = async function (path, body, opts) {
      if (path === '/hardware/price-quote' && !online()) {
        return { data: { items: (body.items || []).map(function () { return null; }) } };
      }
      return post(path, body, opts);
    };
  }

  /* ====================================================================
   * 3b. Offline checkout
   * ==================================================================== */
  function hookCheckout() {
    var T = HW && HW.till; if (!T || !T.checkout || T.checkout._hwo) return;
    var orig = T.checkout;

    async function offlineSave(note) {
      var chk = Offline.sales.check();
      if (!chk.ok) { toastErr(chk.reason); return false; }
      var lines = T.lines.filter(function (l) { return Number(l.qty) > 0; });
      if (!lines.length) { toastErr('Cart is empty'); return false; }
      var tot = T.totals(), paid = T.paid(), balance = r2(tot.total - paid);
      if (balance > 0.009) { toastErr('Offline sales must be paid in full. Credit and part payment need the internet.'); return false; }
      if (balance < -0.009) { toastErr('Payments are more than the sale total'); return false; }
      var pmap = products(), cart = [];
      for (var i = 0; i < lines.length; i++) {
        var l = lines[i], p = pmap.get(String(l.productId));
        if (!p) { toastErr(l.name + ' is not saved on this till. Remove it, or wait for the internet.'); return false; }
        if (l.override !== null && l.override !== undefined) { toastErr('Price changes are not allowed offline. Remove the changed price on ' + l.name + '.'); return false; }
        var u = (l.units || []).find(function (x) { return x.id === l.unitId; }); var factor = u && u.factor ? Number(u.factor) : 1;
        cart.push({ product: p, variant: null, quantity: r2(Number(l.qty) * factor), discount: Number(l.discount) || 0 });
      }
      var cash = T.payments.filter(function (p) { return p.method === 'CASH' && p.amountTendered; });
      var change = r2(cash.reduce(function (s, p) { return s + Math.max(0, (p.amountTendered || 0) - p.amount); }, 0));
      var tendered = r2(cash.reduce(function (s, p) { return s + (p.amountTendered || 0); }, 0));
      var payments = T.payments.map(function (p) { return { method: p.method, amount: p.amount, reference: p.reference, provider: p.provider, amountTendered: p.method === 'CASH' ? p.amountTendered : undefined }; });
      var cust = T.customer, snapshot = T.lines.slice();
      T.busy = true;
      var r;
      try {
        r = await Offline.sales.create({ cart: cart, cartDiscount: Number(T.cartDiscount) || 0, payments: payments, clientTransactionId: String(T.key).replace(/-/g, '') });
      } catch (err) { T.busy = false; toastErr(err.message); return false; }
      T.busy = false;
      if (change > 0 && window.CashDrawer && window.CashDrawer.isEnabled && window.CashDrawer.isEnabled()) window.CashDrawer.beginChange({ change: change, tendered: tendered, due: tot.total, receiptNumber: r.receiptNumber, saleId: '' });
      T.payments = []; T.reset();
      var sale = { _id: null, receiptNumber: r.receiptNumber, total: tot.total };
      if (T.afterSaleModal) {
        T.afterSaleModal(sale, r.receipt, { change: change, balance: 0, cust: cust, lines: snapshot });
        setTimeout(function () { // an offline sale has no invoice or delivery yet: say so instead of showing buttons that cannot work
          var m = document.querySelector('.hw-modal:last-of-type'); if (!m) return;
          var inv = m.querySelector('[data-inv]'); if (inv && inv.closest('.dc')) inv.closest('.dc').style.display = 'none';
          var del = m.querySelector('[data-del]'); if (del) del.style.display = 'none';
          var bd = m.querySelector('.hw-mbd'); if (bd) { var n = document.createElement('div'); n.className = 'hwo-saved'; n.innerHTML = '<span>✓</span><span>' + esc(note || 'Saved on this till.') + ' It will sync when the internet is back, then the invoice and delivery options appear in Sales history.</span>'; bd.appendChild(n); }
        }, 0);
      }
      try { // same auto-print choice as an online sale (Counter till > print setting)
        var mode = localStorage.getItem('hw.till.autodoc') || (localStorage.getItem('hw.till.autoprint') === '0' ? 'off' : 'receipt');
        if ((mode === 'receipt' || mode === 'both') && T.receipt) T.receipt(null, r.receipt, 'print');
      } catch (e) { /* printing is optional */ }
      paint(); return true;
    }

    T.checkout = async function () {
      if (T.busy) return false;
      // 1) Server not reachable right now: save on this till.
      if (!online() && canOffline()) return offlineSave('Saved offline.');
      if (!online() && !canOffline()) { toastErr(ready() && Offline.device.enrolled() ? 'You are offline and offline selling is switched off for this till.' : 'You are offline. Set up this till for offline selling (Offline button) while connected.'); return false; }
      // 2) Online: normal path, but if the connection drops while paying, fall back to the same sale offline (same transaction id).
      var failedNetwork = false, post = Api.post, errFn = HW.err;
      Api.post = function (path) { var p = post.apply(Api, arguments); if (path === '/sales') return p.catch(function (e) { if (e && e.code === 'NETWORK_ERROR') failedNetwork = true; throw e; }); return p; };
      if (canOffline()) HW.err = function (m) { if (/Connection lost/.test(String(m))) return; errFn(m); };
      var ok;
      try { ok = await orig.apply(T, arguments); } finally { Api.post = post; HW.err = errFn; }
      if (!ok && failedNetwork && canOffline()) { if (window.Connectivity) window.Connectivity.reportFailure(); return offlineSave('Connection dropped. Saved offline.'); }
      if (!ok && failedNetwork) toastErr('Connection lost. Nothing was saved. Your cart is kept: try again when the internet is back.');
      return ok;
    };
    T.checkout._hwo = true; HW.till.checkout = T.checkout;
  }

  /* ====================================================================
   * 4. Live panel inside the Till offline centre
   * ==================================================================== */
  function livePanel() {
    var host = document.getElementById('ofl-center'); if (!host) return;
    var box = document.getElementById('hwo-live');
    if (!box) { box = document.createElement('div'); box.id = 'hwo-live'; box.className = 'hwo-live'; host.parentNode.insertBefore(box, host); }
    var info = window.HWPWA ? window.HWPWA.info() : {}, pr = info.progress, ver = info.current && info.current.version;
    var s = ready() ? Offline.status() : null;
    var pct = pr && pr.total ? Math.min(100, Math.round((pr.done / pr.total) * 100)) : (pr && pr.ready ? 100 : null);
    var catPct = s && s.catalogProgress && s.catalogProgress.total ? Math.round((s.catalogProgress.done / s.catalogProgress.total) * 100) : (s && s.catalogReady ? 100 : 0);
    box.innerHTML =
      '<div class="r"><b>' + (online() ? 'Connected' : 'No internet') + (s && s.catalogReady ? ' · ' + s.catalogCount + ' products saved' : '') + '</b><span class="s">App ' + esc(ver ? 'v' + String(ver).replace(/^v/, '') : 'version unknown') + (info.hasUpdate ? ' · update waiting' : '') + '</span></div>' +
      '<div><div class="s" style="margin-bottom:4px">Product list ' + catPct + '%</div><div class="bar"><i style="width:' + catPct + '%"></i></div></div>' +
      (pct !== null ? '<div><div class="s" style="margin-bottom:4px">Screens saved for offline use ' + pct + '%</div><div class="bar"><i style="width:' + pct + '%"></i></div></div>' : '') +
      '<div class="acts"><button type="button" class="hwp-btn p" data-x="sync">Sync now</button><button type="button" class="hwp-btn" data-x="upd">' + (info.hasUpdate ? 'Install update' : 'Check for update') + '</button></div>';
    box.onclick = async function (e) {
      var b = e.target.closest('[data-x]'); if (!b) return;
      if (b.dataset.x === 'sync') { b.disabled = true; try { await Offline.sync.kick(); if (Offline.catalog && online()) await Offline.catalog.sync().catch(function () {}); toastOk('Sync started'); } finally { b.disabled = false; paint(); } }
      if (b.dataset.x === 'upd') { if (!window.HWPWA) return; if (window.HWPWA.info().hasUpdate) window.HWPWA.apply(); else { b.disabled = true; await window.HWPWA.check(); setTimeout(function () { b.disabled = false; if (window.HWPWA.info().hasUpdate) window.HWPWA.showUpdate(); else toastOk('You have the latest version'); livePanel(); }, 1200); } }
    };
  }

  /* ====================================================================
   * start
   * ==================================================================== */
  function start() {
    patchLookup();
    // the workspace renders its shell a moment after load: keep trying until the top bar exists, then follow it
    var tries = 0, t = setInterval(function () { ensurePill(); paint(); hookCheckout(); if ((pill && pill.isConnected && HW && HW.till && HW.till.checkout && HW.till.checkout._hwo) || ++tries > 80) clearInterval(t); }, 250);
    var app = document.getElementById('app');
    if (app && window.MutationObserver) new MutationObserver(function () { if (!pill || !pill.isConnected || !strip || !strip.isConnected) { ensurePill(); paint(); } if (document.getElementById('ofl-center') && !document.getElementById('hwo-live')) livePanel(); }).observe(document.body, { childList: true, subtree: true });
    if (window.Connectivity) window.Connectivity.onChange(function () { paint(); });
    ['pending', 'sync', 'readiness', 'catalog', 'mode', 'shift'].forEach(function (e) { Offline.on(e, function () { paint(); livePanel(); }); });
    if (window.HWPWA) window.HWPWA.on(function () { livePanel(); paint(); });
    window.addEventListener('online', paint); window.addEventListener('offline', paint);
    setInterval(function () { paint(); if (document.getElementById('hwo-live')) livePanel(); }, 4000);
    paint();
  }

  var go = function () { if (Offline.init) Offline.init().then(start, start); else start(); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go); else go();

  window.HWOffline = { paint: paint, canSellOffline: canOffline, state: state };
})(window, document);
