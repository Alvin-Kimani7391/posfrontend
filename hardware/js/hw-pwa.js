/**
 * hw-pwa.js - Hardware workspace: service-worker registration, VERSION CAPTURE and the themed update prompt.
 * Replaces js/core/pwa.js on /hardware/ (that file registers 'sw.js' relative to the page and uses the teal look).
 *
 *  - Registers ../sw.js (scope ../), so /hardware/ shares the one root worker and cache with the rest of the app.
 *  - Reads the version straight from sw.js (VERSION + NOTES): the running one and the one that is waiting.
 *  - A new sw.js  ->  Navy & Lime modal: "Update ready  v4.9.4 -> v4.9.5" + what changed.
 *      Update now        applies it at once, unless a sale is in progress: then it waits ("Update after this sale")
 *                        and applies the moment the cart is empty and no dialog is open, so a sale is never lost.
 *      Later             the modal shrinks to a small card (bottom-right) that stays until the update is applied.
 *  - After the reload a one-time "Updated to vX" toast shows what changed (and from which version).
 *  - Install card (Install app) in the same theme; offline download progress is published for hw-offline.js.
 *
 *  window.HWPWA: version() / info() / check() / apply() / on(fn) -> off     (events: 'update', 'applied', 'progress', 'version')
 */
(function (window, document) {
  'use strict';
  if (window.HWPWA) return;

  var SW_URL = '../sw.js', SCOPE = '../';
  var LS_VER = 'hw.pwa.version', LS_DISMISS = 'hw.pwa.installDismissedAt';
  var CHECK_EVERY = 10 * 60 * 1000;
  var sw = window.navigator.serviceWorker;

  var reg = null, current = null, waiting = null, waitingInfo = null;
  var ov = null, floatEl = null, installEl = null, deferred = null;
  var accepted = false, idleTimer = null, listeners = [], progress = null;

  var ls = {
    get: function (k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { window.localStorage.setItem(k, v); } catch (e) { /* blocked */ } },
  };
  function emit(type, detail) { listeners.slice().forEach(function (fn) { try { fn(type, detail); } catch (e) { /* ignore */ } }); try { window.dispatchEvent(new CustomEvent('hwpwa:' + type, { detail: detail })); } catch (e) { /* ignore */ } }
  function el(tag, cls, html) { var n = document.createElement(tag); if (cls) n.className = cls; if (html != null) n.innerHTML = html; return n; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function pretty(v) { return v ? String(v).replace(/^v?/, 'v') : '-'; }
  function standalone() { try { return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true; } catch (e) { return false; } }

  var ICON_REFRESH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 4v5h-5"/></svg>';
  var ICON_DL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="m7 11 5 5 5-5"/><path d="M5 21h14"/></svg>';

  /* ---------------- ask a worker for its version ---------------- */
  function ask(worker) {
    return new Promise(function (resolve) {
      if (!worker) return resolve(null);
      var done = false, ch = new MessageChannel();
      var t = setTimeout(function () { if (!done) { done = true; resolve(null); } }, 2500);
      ch.port1.onmessage = function (e) { if (done) return; done = true; clearTimeout(t); resolve(e.data || null); };
      try { worker.postMessage({ type: 'GET_VERSION' }, [ch.port2]); } catch (e) { clearTimeout(t); resolve(null); }
    });
  }

  /* ---------------- is a sale in progress? ---------------- */
  function busyReason() {
    try {
      var T = window.HW && window.HW.till;
      if (T && T.busy) return 'A sale is being saved';
      if (T && T.lines && T.lines.some(function (l) { return Number(l.qty) > 0; })) return 'There is an open sale in the cart';
      if (document.querySelector('.hw-modal, .modal-backdrop, .scanner-overlay')) return 'A window is open';
    } catch (e) { /* ignore */ }
    return '';
  }

  /* ---------------- update prompt ---------------- */
  function closeModal() { if (ov) { ov.remove(); ov = null; } }
  function closeFloat() { if (floatEl) { floatEl.remove(); floatEl = null; } }

  function showModal() {
    if (!waiting || !document.body) return;
    closeFloat(); closeModal();
    var from = current && current.version, to = waitingInfo && waitingInfo.version;
    var notes = (waitingInfo && waitingInfo.notes) || [];
    ov = el('div', 'hwp-ov');
    ov.innerHTML =
      '<div class="hwp-card" role="dialog" aria-modal="true" aria-labelledby="hwp-t">' +
      '<div class="hwp-head"><div class="hwp-ico">' + ICON_REFRESH + '</div><div style="flex:1;min-width:0"><h3 id="hwp-t">Update ready</h3><p>A newer version of the hardware workspace is downloaded.</p></div></div>' +
      '<div class="hwp-body">' +
      '<div class="hwp-vers"><span class="hwp-ver">' + esc(pretty(from)) + '</span><span class="hwp-arrow">&rarr;</span><span class="hwp-ver new">' + esc(pretty(to)) + '</span></div>' +
      (notes.length ? '<ul class="hwp-notes">' + notes.map(function (n) { return '<li>' + esc(n) + '</li>'; }).join('') + '</ul>' : '') +
      '<div class="hwp-busy" id="hwp-busy"></div><div class="hwp-bar" id="hwp-bar"><i></i></div>' +
      '</div>' +
      '<div class="hwp-foot"><button type="button" class="hwp-btn" data-a="later">Later</button><button type="button" class="hwp-btn p" data-a="now">Update now</button></div>' +
      '</div>';
    ov.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('[data-a]'); if (!b) { if (e.target === ov && !accepted) later(); return; }
      if (b.getAttribute('data-a') === 'later') later(); else apply();
    });
    document.body.appendChild(ov);
    var now = ov.querySelector('[data-a="now"]'); if (now) now.focus();
    paintBusy();
  }

  function paintBusy() {
    if (!ov) return;
    var why = busyReason(), box = ov.querySelector('#hwp-busy'), now = ov.querySelector('[data-a="now"]');
    if (accepted) return;
    box.classList.toggle('on', !!why);
    box.textContent = why ? why + '. You can update after this sale: nothing in the cart is lost.' : '';
    now.textContent = why ? 'Update after this sale' : 'Update now';
  }

  function later() { accepted = false; closeModal(); showFloat(); }

  function showFloat() {
    if (floatEl || !waiting || !document.body) return;
    floatEl = el('div', 'hwp-float');
    floatEl.setAttribute('role', 'status');
    floatEl.innerHTML = '<div class="t"><b>Update ready</b><span>' + esc(pretty(waitingInfo && waitingInfo.version)) + ' is waiting. Finish your sale, then update.</span></div><button type="button" class="hwp-btn p" data-a="open">Update</button>';
    floatEl.addEventListener('click', function (e) { if (e.target.closest('[data-a="open"]')) showModal(); });
    document.body.appendChild(floatEl);
  }

  /** Apply the waiting worker. If a sale is open, wait until it is finished (never lose a cart). */
  function apply() {
    if (!waiting) return;
    accepted = true;
    var now = ov && ov.querySelector('[data-a="now"]'), lat = ov && ov.querySelector('[data-a="later"]');
    function go() {
      clearInterval(idleTimer); idleTimer = null;
      if (ov) { ov.querySelector('#hwp-bar').classList.add('on'); ov.querySelector('#hwp-busy').classList.remove('on'); if (now) { now.disabled = true; now.innerHTML = '<span class="hwp-spin"></span> Updating&hellip;'; } if (lat) lat.hidden = true; }
      try { waiting.postMessage({ type: 'SKIP_WAITING' }); } catch (e) { /* ignore */ }
      setTimeout(function () { if (accepted) window.location.reload(); }, 5000); // failsafe if controllerchange never fires
    }
    if (!busyReason()) return go();
    if (ov && now) {
      now.textContent = 'Waiting for the sale to finish…'; now.disabled = true; if (lat) { lat.textContent = 'Cancel'; lat.onclick = function (e) { e.stopPropagation(); clearInterval(idleTimer); accepted = false; now.disabled = false; lat.textContent = 'Later'; lat.onclick = null; paintBusy(); }; }
    }
    clearInterval(idleTimer);
    idleTimer = setInterval(function () { if (!accepted) return clearInterval(idleTimer); if (!busyReason()) go(); }, 1200);
  }

  function onWaiting(worker) {
    waiting = worker;
    ask(worker).then(function (info) {
      waitingInfo = info || { version: '' };
      emit('update', { from: current && current.version, to: waitingInfo.version, notes: waitingInfo.notes || [] });
      if (busyReason() && document.querySelector('.hw-modal,.modal-backdrop')) showFloat(); // do not cover a payment window
      else showModal();
    });
  }

  /* ---------------- "Updated to vX" ---------------- */
  function announceVersion(info, previousHint) {
    if (!info || !info.version) return;
    current = info;
    var last = ls.get(LS_VER);
    ls.set(LS_VER, info.version);
    emit('version', info);
    if (last && last !== info.version) {
      var t = el('div', 'hwp-toast');
      t.setAttribute('role', 'status');
      t.innerHTML = 'Updated to ' + esc(pretty(info.version)) + '<small>' + esc((info.notes && info.notes[0]) || ('from ' + pretty(previousHint || last))) + '</small>';
      document.body.appendChild(t);
      setTimeout(function () { t.remove(); }, 7000);
      emit('applied', { from: previousHint || last, to: info.version, notes: info.notes || [] });
    }
  }

  /* ---------------- install as app ---------------- */
  function ios() { var ua = window.navigator.userAgent || ''; return /iphone|ipad|ipod/i.test(ua) || (window.navigator.platform === 'MacIntel' && window.navigator.maxTouchPoints > 1); }
  function canInstall() { return !standalone() && (!!deferred || ios()); }
  function dismissedRecently() { var at = Number(ls.get(LS_DISMISS) || 0); return at && Date.now() - at < 3 * 864e5; }

  function showGuide() {
    var g = el('div', 'hwp-ov');
    g.innerHTML = '<div class="hwp-card" role="dialog" aria-modal="true"><div class="hwp-head"><div class="hwp-ico">' + ICON_DL + '</div><div><h3>Add to Home Screen</h3><p>Three taps and the till opens like an app.</p></div></div>' +
      '<div class="hwp-body"><ol class="hwp-steps"><li>Tap the <b>Share</b> button in the browser toolbar.</li><li>Choose <b>Add to Home Screen</b>.</li><li>Tap <b>Add</b>.</li></ol></div>' +
      '<div class="hwp-foot"><button type="button" class="hwp-btn p">Got it</button></div></div>';
    g.addEventListener('click', function (e) { if (e.target === g || e.target.closest('.hwp-btn')) g.remove(); });
    document.body.appendChild(g);
  }
  /** Runs the real install flow (browser prompt, or the iPhone guide). */
  function install() {
    if (standalone()) return;
    if (deferred) { var p = deferred; deferred = null; try { p.prompt(); } catch (err) { /* ignore */ } paintInstallBtn(); return; }
    if (ios()) showGuide();
  }
  function paintInstallBtn() {
    var top = document.querySelector('.hw-top'), b = document.getElementById('hw-install-btn');
    if (!top) return;
    if (!canInstall()) { if (b) b.remove(); return; }
    if (b) return;
    b = el('button', 'hwo-install', ICON_DL + '<span>Install app</span>'); b.type = 'button'; b.id = 'hw-install-btn'; b.title = 'Install this till as an app on this device';
    b.addEventListener('click', install);
    var anchor = document.getElementById('hw-ofl-pill') || document.getElementById('gwrap');
    if (anchor && anchor.parentNode === top) top.insertBefore(b, anchor); else top.appendChild(b);
  }

  function showInstall() {
    if (installEl || floatEl || ov || !canInstall() || dismissedRecently() || !document.body) return;
    if (busyReason()) return setTimeout(showInstall, 8000);
    installEl = el('div', 'hwp-float');
    installEl.setAttribute('role', 'region'); installEl.setAttribute('aria-label', 'Install the till');
    installEl.innerHTML = '<div class="hwp-ico" style="width:38px;height:38px;border-radius:12px">' + ICON_DL + '</div><div class="t"><b>Install the till as an app</b><span>Opens full screen, starts fast and keeps selling offline.</span></div><button type="button" class="hwp-btn p" data-a="i">' + (deferred ? 'Install' : 'How') + '</button><button type="button" class="hwp-x" data-a="x" aria-label="Not now">&times;</button>';
    installEl.addEventListener('click', function (e) {
      var b = e.target.closest('[data-a]'); if (!b) return;
      installEl.remove(); installEl = null;
      if (b.getAttribute('data-a') === 'x') { ls.set(LS_DISMISS, String(Date.now())); return; }
      install();
    });
    document.body.appendChild(installEl);
  }
  window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); deferred = e; paintInstallBtn(); setTimeout(showInstall, 2500); });
  window.addEventListener('appinstalled', function () { deferred = null; if (installEl) { installEl.remove(); installEl = null; } paintInstallBtn(); });
  // The workspace draws its top bar a moment after load: keep the button in place, and offer the iPhone guide where there is no install event.
  setInterval(paintInstallBtn, 1500);
  window.addEventListener('load', function () { setTimeout(function () { if (ios()) showInstall(); }, 4000); });

  /* ---------------- POS icon on every hardware page ---------------- */
  (function icons() {
    function add(rel, href, extra) {
      if (document.querySelector('link[rel="' + rel + '"]')) return;
      var l = document.createElement('link'); l.rel = rel; l.href = href; if (extra) Object.keys(extra).forEach(function (k) { l.setAttribute(k, extra[k]); }); document.head.appendChild(l);
    }
    add('icon', '../icons/favicon-32.png', { type: 'image/png', sizes: '32x32' });
    add('shortcut icon', '../icons/favicon-32.png');
    add('apple-touch-icon', '../icons/apple-touch-icon.png');
    add('manifest', 'manifest.webmanifest');
    if (!document.querySelector('meta[name="theme-color"]')) { var m = document.createElement('meta'); m.name = 'theme-color'; m.content = '#1d1c35'; document.head.appendChild(m); }
  })();

  /* ---------------- registration ---------------- */
  function secure() { var h = location.hostname; return location.protocol === 'https:' || h === 'localhost' || h === '127.0.0.1'; }
  function check() { return reg ? reg.update().catch(function () {}) : Promise.resolve(); }

  function register() {
    if (!sw || !secure()) return;
    sw.addEventListener('controllerchange', function () { if (accepted) window.location.reload(); });
    sw.addEventListener('message', function (e) {
      var d = e.data || {};
      if (d.type === 'SW_PROGRESS') { progress = { done: d.done, total: d.total, version: d.version }; emit('progress', progress); }
      else if (d.type === 'SW_READY') { progress = { done: 1, total: 1, ready: true, version: d.version }; emit('progress', progress); }
      else if (d.type === 'SW_ACTIVATED') { if (!accepted) announceVersion({ version: d.version, notes: d.notes }, d.previous); /* accepted: the page reloads next and shows the "Updated" toast then */ }
    });
    sw.register(SW_URL, { scope: SCOPE }).then(function (r) {
      reg = r;
      if (sw.controller) ask(sw.controller).then(function (info) { announceVersion(info); });
      if (r.waiting && sw.controller) onWaiting(r.waiting);
      r.addEventListener('updatefound', function () {
        var nw = r.installing; if (!nw) return;
        nw.addEventListener('statechange', function () { if (nw.state === 'installed' && sw.controller) onWaiting(nw); });
      });
      setInterval(check, CHECK_EVERY);
      document.addEventListener('visibilitychange', function () { if (!document.hidden) check(); });
      window.addEventListener('online', check);
    }).catch(function (err) { if (window.console) console.warn('[HWPWA] service worker registration failed:', err); });
    try { if (window.navigator.storage && window.navigator.storage.persist) window.navigator.storage.persist(); } catch (e) { /* ignore */ }
  }

  // Keep the busy notice live while the modal is open.
  setInterval(function () { if (ov && !accepted) paintBusy(); }, 1500);

  window.HWPWA = {
    version: function () { return current && current.version || ''; },
    info: function () { return { current: current, waiting: waitingInfo, hasUpdate: !!waiting, progress: progress }; },
    check: check,
    install: install,
    canInstall: canInstall,
    apply: function () { if (waiting) { showModal(); apply(); } },
    showUpdate: function () { if (waiting) showModal(); },
    on: function (fn) { listeners.push(fn); return function () { listeners = listeners.filter(function (f) { return f !== fn; }); }; },
  };

  register();
})(window, document);
