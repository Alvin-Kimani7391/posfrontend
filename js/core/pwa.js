/**
 * pwa.js
 * Everything the browser side of the PWA needs, in one self-contained file.
 * It does not depend on (or modify) app-shell.js, ui.js or any page script.
 *
 *  - Adds the manifest / theme-color / iOS meta tags if the page lacks them,
 *    so any page only needs `<script src="js/core/pwa.js"></script>`.
 *  - Registers sw.js.
 *  - Install: captures the browser's install prompt and offers it through a
 *    compact, dismissible card (never during an open modal or the barcode
 *    scanner, never again for 14 days after it is closed). iPhone/iPad have
 *    no install prompt, so they get a short "Add to Home Screen" guide.
 *  - Update: when a new version is downloaded, shows "Refresh". Nothing
 *    reloads by itself, so a sale in progress is never lost.
 *  - Offline: shows a small notice while there is no connection.
 *
 * Layout (v2): one slim row on every screen size.
 *   phones / tablets (< 960px): full width, sits ABOVE the bottom nav
 *   larger tablets:             360px card, bottom-right
 *   desktop (>= 960px):         360px card, bottom-right (clear of the sidebar)
 *
 * Public API (window.PWA):
 *   PWA.canInstall()        -> boolean, true when an Install button makes sense
 *   PWA.install()           -> Promise<'accepted'|'dismissed'|'ios-guide'|'unsupported'|'installed'>
 *   PWA.isInstalled()       -> boolean, true when running as the installed app
 *   PWA.onChange(fn)        -> subscribe to install-availability changes; returns unsubscribe
 *   PWA.checkForUpdate()    -> Promise, asks the browser to look for a new version now
 *
 * Optional: any element with the attribute  data-pwa-install  becomes an
 * "Install app" trigger. It is hidden automatically whenever install is not
 * possible (already installed, unsupported browser) and shown when it is.
 */
(function (window, document) {
  'use strict';

  var CFG = {
    appName: 'Six Star POS',          // used only until the shop's own name is known
    nameKey: 'pos.pwa.shopName', installedAsKey: 'pos.pwa.installedAs', renameDismissKey: 'pos.pwa.renameDismissedAt', renameSnoozeDays: 3,
    swUrl: 'sw.js',
    manifestUrl: 'manifest.webmanifest',
    themeColor: '#0f766e',
    iconUrl: 'icons/icon-192.png',
    appleIconUrl: 'icons/apple-touch-icon.png',
    faviconUrl: 'icons/favicon-32.png',
    dismissKey: 'pos.pwa.installDismissedAt',
    dismissDays: 2,
    bannerDelayMs: 900,
    updateCheckMs: 30 * 60 * 1000,
    // Anything matching this means the cashier is busy; do not pop up over it.
    busySelector: '.modal-backdrop, .scanner-overlay, .pwa-sheet-backdrop',
  };

  var CLOSE_ICON =
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';

  /* ------------------------------------------------------------------ *
   * Small utilities
   * ------------------------------------------------------------------ */
  var ls = {
    get: function (k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { window.localStorage.setItem(k, v); } catch (e) { /* ignore */ } },
  };

  /* ------------------------------------------------------------------ *
   * The installed app is called after the SHOP (e.g. "Alvin Supermarket"), not "Six Star POS".
   * Chrome / Edge read the name from the manifest when the app is installed, so the manifest link carries the shop name
   * (manifest.webmanifest?n=...) and sw.js answers that request with the same manifest under the shop's name.
   * ------------------------------------------------------------------ */
  function cleanName(v) {
    return String(v == null ? '' : v).replace(/[\u0000-\u001f<>"]/g, '').replace(/\s+/g, ' ').trim().slice(0, 40);
  }
  function shopName() {
    var n = '';
    try { var p = JSON.parse(window.localStorage.getItem('pos.businessProfile') || 'null'); n = cleanName(p && (p.name || p.businessName)); } catch (e) { /* ignore */ }
    if (n) { if (ls.get(CFG.nameKey) !== n) ls.set(CFG.nameKey, n); return n; }
    return cleanName(ls.get(CFG.nameKey));
  }
  /** This shop's id (profile, else the signed-in user): each shop gets its own installed app. */
  function shopId() {
    var id = '';
    try { var pr = JSON.parse(window.localStorage.getItem('pos.businessProfile') || 'null'); id = (pr && (pr._id || pr.id)) || ''; } catch (e) { /* ignore */ }
    if (!id) { try { var u = JSON.parse(window.localStorage.getItem('pos.user') || 'null'); id = (u && (u.businessId && (u.businessId._id || u.businessId))) || ''; } catch (e) { /* ignore */ } }
    id = String(id).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40);
    return id;
  }
  function appName() { return shopName() || CFG.appName; }

  /** Point the manifest at the shop name; the browser re-reads it and re-offers the install with the right name. */
  var manifestNameApplied = '';
  function applyManifestName() {
    var n = shopName();
    if (!n || n === manifestNameApplied) return false;
    var link = document.querySelector('link[rel="manifest"]');
    if (!link) return false;
    manifestNameApplied = n;
    var sid = window.__POS_SCOPE || shopId();
    link.setAttribute('href', CFG.manifestUrl + '?n=' + encodeURIComponent(n) + (sid ? '&s=' + encodeURIComponent(sid) : ''));
    var t = document.querySelector('meta[name="apple-mobile-web-app-title"]');
    if (t) t.setAttribute('content', n);
    var strong = bannerEl && bannerEl.querySelector('.pwa-copy strong');
    if (strong && !bannerEl.classList.contains('pwa-rename')) strong.textContent = 'Install ' + n;
    return true;
  }

  function isStandalone() {
    try {
      return (
        window.matchMedia('(display-mode: standalone)').matches ||
        window.matchMedia('(display-mode: minimal-ui)').matches ||
        window.matchMedia('(display-mode: fullscreen)').matches ||
        window.matchMedia('(display-mode: window-controls-overlay)').matches ||
        window.navigator.standalone === true
      );
    } catch (e) {
      return false;
    }
  }

  function isIos() {
    var ua = window.navigator.userAgent || '';
    var iPadOs = window.navigator.platform === 'MacIntel' && window.navigator.maxTouchPoints > 1;
    return /iphone|ipad|ipod/i.test(ua) || iPadOs;
  }

  function isSecureContextForSw() {
    var h = window.location.hostname;
    return window.location.protocol === 'https:' || h === 'localhost' || h === '127.0.0.1';
  }

  function dismissedRecently() {
    try { return window.sessionStorage.getItem(CFG.dismissKey) === '1'; } catch (e) { return false; }
  }
  function instKey() { var sid = window.__POS_SCOPE ? '' : shopId(); return 'pos.pwa.installed' + (sid ? '.' + sid : ''); }
  function rememberInstalled() { ls.set(instKey(), '1'); }
  function rememberInstalledAs(name) { ls.set(CFG.installedAsKey, name || appName()); }
  /** An app installed before the shop name existed is still called "Six Star POS" (the browser keeps the install-time name). */
  function isLegacyInstall() {
    if (isIos()) return false; // iPhone/iPad cannot tell us the home-screen name
    var shop = shopName();
    if (!shop) return false;
    // Only the OLD app (opened standalone, no shop scope) can be a legacy install. A browser tab is never "legacy":
    // it offers this shop's own install instead (a phone can hold one app per shop).
    if (window.__POS_SCOPE || !isStandalone()) return false;
    return ls.get(CFG.installedAsKey) !== shop;
  }
  function renameSnoozed() {
    var t = Number(ls.get(CFG.renameDismissKey) || 0);
    return t && (Date.now() - t) < CFG.renameSnoozeDays * 86400000;
  }

  function toast(kind, message) {
    try {
      if (window.UI && window.UI.toast && window.UI.toast[kind]) window.UI.toast[kind](message);
    } catch (e) { /* ignore */ }
  }

  /** True when the mobile bottom nav is actually on screen (so we sit above it). */
  function bottomNavVisible() {
    var nav = document.querySelector('.bottom-nav');
    if (!nav) return false;
    try { return window.getComputedStyle(nav).display !== 'none'; } catch (e) { return false; }
  }

  function syncNavOffset() {
    var above = bottomNavVisible();
    [bannerEl, updateEl].forEach(function (el) {
      if (el) el.classList.toggle('pwa-above-nav', above);
    });
  }

  /* ------------------------------------------------------------------ *
   * State
   * ------------------------------------------------------------------ */
  var deferredPrompt = null;
  var installedNow = false;
  var swReg = null;
  var userRequestedRefresh = false;
  var bannerEl = null;
  var sheetEl = null;
  var updateEl = null;
  var offlineEl = null;
  var bannerTimer = null;
  var wasOffline = false;
  var listeners = [];

  function isPhone() {
    try { return /android|iphone|ipod|mobile/i.test(window.navigator.userAgent || '') || (window.matchMedia('(pointer:coarse)').matches && window.innerWidth < 820); } catch (e) { return false; }
  }

  function canInstall() {
    if (isStandalone() || installedNow) return false;
    return !!deferredPrompt || ((isIos() || isPhone()) && ls.get(instKey()) !== '1');
  }

  function emitChange() {
    refreshTriggers();
    listeners.slice().forEach(function (fn) { try { fn(canInstall()); } catch (e) { /* ignore */ } });
    try { window.dispatchEvent(new CustomEvent('pwa:installable', { detail: { canInstall: canInstall() } })); } catch (e) { /* ignore */ }
  }

  /* ------------------------------------------------------------------ *
   * <head> tags + styles (added only when missing)
   * ------------------------------------------------------------------ */
  function ensureHeadTags() {
    var head = document.head;
    function addMeta(name, content) {
      if (document.querySelector('meta[name="' + name + '"]')) return;
      var m = document.createElement('meta');
      m.name = name;
      m.content = content;
      head.appendChild(m);
    }
    function addLink(rel, href, extra) {
      if (document.querySelector('link[rel="' + rel + '"]')) return;
      var l = document.createElement('link');
      l.rel = rel;
      l.href = href;
      if (extra) Object.keys(extra).forEach(function (k) { l.setAttribute(k, extra[k]); });
      head.appendChild(l);
    }
    addLink('manifest', CFG.manifestUrl);
    addMeta('theme-color', CFG.themeColor);
    addMeta('mobile-web-app-capable', 'yes');
    addMeta('apple-mobile-web-app-capable', 'yes');
    addMeta('apple-mobile-web-app-title', appName());
    addMeta('apple-mobile-web-app-status-bar-style', 'default');
    addLink('apple-touch-icon', CFG.appleIconUrl);
    addLink('icon', CFG.faviconUrl, { type: 'image/png', sizes: '32x32' });
  }

  function injectStyles() {
    if (document.getElementById('pwa-styles')) return;
    var css = [
      /* Shared floating row: install card + update card */
      '.pwa-float{position:fixed;left:10px;right:10px;bottom:calc(10px + env(safe-area-inset-bottom,0px));z-index:1200;',
      'display:flex;align-items:center;gap:10px;padding:9px 8px 9px 12px;box-sizing:border-box;',
      'background:var(--color-surface,#fff);color:var(--color-text,#0f172a);',
      'border:1px solid var(--color-border,#e2e8f0);border-radius:var(--radius-lg,12px);',
      'box-shadow:var(--shadow-lg,0 10px 28px rgba(15,23,42,.18));',
      'font-size:.85rem;line-height:1.3;animation:pwa-rise .2s ease-out}',
      /* phones/tablets with the bottom nav showing: sit just above it */
      '.pwa-float.pwa-above-nav{bottom:calc(var(--bottom-nav-height,64px) + 10px)}',
      '@media (min-width:521px){.pwa-float{left:auto;right:16px;width:360px}}',
      '@media (min-width:960px){.pwa-float,.pwa-float.pwa-above-nav{right:20px;bottom:20px}}',

      '.pwa-float-icon{width:36px;height:36px;border-radius:9px;flex:none}',
      '.pwa-copy{flex:1 1 auto;min-width:0}',
      '.pwa-copy strong{display:block;font-size:.9rem;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.pwa-copy span{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;',
      'color:var(--color-text-secondary,#475569);font-size:.78rem}',
      '@media (max-width:359px){.pwa-copy span{display:none}}',
      '.pwa-float .btn{height:34px;padding:0 14px;font-size:.85rem;flex:none;border-radius:var(--radius-md,8px)}',
      '.pwa-float .btn{touch-action:manipulation;-webkit-tap-highlight-color:transparent;min-width:84px;transition:transform .08s,opacity .15s}@media (pointer:coarse){.pwa-float .btn{height:42px;padding:0 18px}}.pwa-float .btn:active{transform:scale(.96)}.pwa-float .btn.pwa-busy{opacity:.75;pointer-events:none}',
      '.pwa-close{flex:none;width:32px;height:32px;display:inline-flex;align-items:center;justify-content:center;',
      'border:0;background:transparent;color:var(--color-text-muted,#64748b);border-radius:50%;cursor:pointer}',
      '.pwa-close:hover{background:var(--color-bg,#f1f5f9);color:var(--color-text,#0f172a)}',
      '.pwa-close:focus-visible{outline:2px solid var(--color-primary,#0f766e);outline-offset:1px}',

      /* Offline notice: under the sticky topbar so it never collides with toasts */
      '.pwa-offline{position:fixed;left:50%;transform:translateX(-50%);',
      'top:calc(var(--topbar-height,56px) + env(safe-area-inset-top,0px) + 8px);z-index:1150;',
      'max-width:calc(100% - 24px);padding:7px 14px;border-radius:999px;background:#7c2d12;color:#fff;',
      'font-size:.8rem;font-weight:600;text-align:center;box-shadow:0 6px 18px rgba(0,0,0,.25)}',

      /* iOS guide sheet */
      '.pwa-sheet-backdrop{position:fixed;inset:0;z-index:1400;background:rgba(15,23,42,.55);display:flex;align-items:flex-end;justify-content:center}',
      '@media (min-width:521px){.pwa-sheet-backdrop{align-items:center;padding:16px}}',
      '.pwa-sheet{width:100%;max-width:400px;max-height:90vh;max-height:90dvh;overflow-y:auto;',
      'background:var(--color-surface,#fff);color:var(--color-text,#0f172a);',
      'border-radius:16px 16px 0 0;padding:18px 18px calc(18px + env(safe-area-inset-bottom,0px));animation:pwa-rise .2s ease-out}',
      '@media (min-width:521px){.pwa-sheet{border-radius:16px}}',
      '.pwa-sheet h3{margin:0 0 4px;font-size:1rem}',
      '.pwa-sheet p{margin:0 0 10px;color:var(--color-text-secondary,#475569);font-size:.85rem}',
      '.pwa-sheet ol{margin:0 0 14px;padding-left:20px;display:grid;gap:6px;font-size:.9rem}',
      '.pwa-sheet .btn{width:100%;height:42px}',

      '[data-pwa-install][hidden]{display:none!important}',
      '@keyframes pwa-rise{from{transform:translateY(12px);opacity:0}to{transform:none;opacity:1}}',
      '@media (prefers-reduced-motion:reduce){.pwa-float,.pwa-sheet{animation:none}}',
    ].join('');
    var style = document.createElement('style');
    style.id = 'pwa-styles';
    style.textContent = css;
    document.head.appendChild(style);
  }

  /* ------------------------------------------------------------------ *
   * Install card
   * ------------------------------------------------------------------ */
  function scheduleBanner(delay) {
    if (bannerTimer) clearTimeout(bannerTimer);
    if (!canInstall() || dismissedRecently()) return;
    bannerTimer = setTimeout(showBanner, delay);
  }

  function showBanner() {
    if (bannerEl || updateEl || !canInstall() || dismissedRecently() || !document.body) return;
    // Never interrupt checkout, a dialog, or the barcode scanner.
    if (document.querySelector(CFG.busySelector)) {
      scheduleBanner(5000);
      return;
    }
    var ios = (isIos() || !deferredPrompt) && !deferredPrompt;
    bannerEl = document.createElement('section');
    bannerEl.className = 'pwa-float pwa-install';
    bannerEl.setAttribute('role', 'region');
    bannerEl.setAttribute('aria-label', 'Install ' + appName());
    bannerEl.innerHTML =
      '<img class="pwa-float-icon" src="' + CFG.iconUrl + '" alt="" width="36" height="36">' +
      '<div class="pwa-copy"><strong>Install ' + appName() + '</strong>' +
      '<span>' + (ios ? 'Add it to your home screen. Works like a real app.' : 'Open it like a real app, full screen and fast.') + '</span></div>' +
      '<button type="button" class="btn btn-primary btn-sm" data-pwa-act="install">' + (ios ? 'How' : 'Install') + '</button>' +
      '<button type="button" class="pwa-close" data-pwa-act="dismiss" aria-label="Not now" title="Not now">' + CLOSE_ICON + '</button>';
    bannerEl.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-pwa-act]');
      if (!btn) return;
      if (btn.getAttribute('data-pwa-act') === 'install') {
        btn.classList.add('pwa-busy'); // instant feedback; the browser dialog opens in the same tick
        var label = btn.textContent; btn.textContent = 'Opening\u2026';
        Promise.resolve(install()).then(function () { btn.classList.remove('pwa-busy'); btn.textContent = label; }, function () { btn.classList.remove('pwa-busy'); btn.textContent = label; });
      }
      else dismissBanner(true);
    });
    document.body.appendChild(bannerEl);
    syncNavOffset();
  }

  function dismissBanner(remember) {
    if (remember) { try { window.sessionStorage.setItem(CFG.dismissKey, '1'); } catch (e) { /* ignore */ } }
    if (bannerEl) { bannerEl.remove(); bannerEl = null; }
  }

  function showIosGuide() {
    if (sheetEl || !document.body) return;
    sheetEl = document.createElement('div');
    sheetEl.className = 'pwa-sheet-backdrop';
    sheetEl.innerHTML =
      '<div class="pwa-sheet" role="dialog" aria-modal="true" aria-label="Add ' + appName() + ' to your home screen">' +
      '<h3>Add ' + appName() + ' to your home screen</h3>' +
      '<p>It takes three taps.</p>' +
      '<ol>' +
      '<li>Tap the <strong>Share</strong> button in the browser toolbar.</li>' +
      '<li>Scroll down and tap <strong>Add to Home Screen</strong>.</li>' +
      '<li>Tap <strong>Add</strong>. The app now opens from your home screen.</li>' +
      '</ol>' +
      '<button type="button" class="btn btn-primary" data-pwa-act="close">Got it</button>' +
      '</div>';
    function close() {
      if (sheetEl) { sheetEl.remove(); sheetEl = null; }
      dismissBanner(true);
    }
    sheetEl.addEventListener('click', function (e) {
      if (e.target === sheetEl || e.target.closest('[data-pwa-act="close"]')) close();
    });
    document.body.appendChild(sheetEl);
  }

  function showManualGuide() {
    if (sheetEl || !document.body) return;
    sheetEl = document.createElement('div');
    sheetEl.className = 'pwa-sheet-backdrop';
    sheetEl.innerHTML =
      '<div class="pwa-sheet" role="dialog" aria-modal="true" aria-label="Install ' + appName() + '">' +
      '<h3>Install ' + appName() + ' on your phone</h3>' +
      '<p>Open it like a real app, full screen.</p>' +
      '<ol><li>Tap the <strong>menu</strong> button of your browser (the three dots).</li>' +
      '<li>Choose <strong>Install app</strong> or <strong>Add to Home screen</strong>.</li>' +
      '<li>Tap <strong>Install</strong>. Open it from your home screen.</li></ol>' +
      '<p>Tip: open this site in <strong>Chrome</strong> for the one-tap install button.</p>' +
      '<button type="button" class="btn btn-primary" data-pwa-act="close">Got it</button></div>';
    function close() { if (sheetEl) { sheetEl.remove(); sheetEl = null; } dismissBanner(true); }
    sheetEl.addEventListener('click', function (e) { if (e.target === sheetEl || e.target.closest('[data-pwa-act="close"]')) close(); });
    document.body.appendChild(sheetEl);
  }

  /* ------------------------------------------------------------------ *
   * Soft prompt for people who installed the app when it was still called "Six Star POS"
   * ------------------------------------------------------------------ */
  var renameEl = null;
  function escapeHtml(v) { return String(v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function hideRenameCard() { if (renameEl) { renameEl.remove(); renameEl = null; } }
  function showRenameCard() {
    if (renameEl || bannerEl || updateEl || !document.body || !isLegacyInstall() || renameSnoozed()) return;
    if (document.querySelector(CFG.busySelector)) { setTimeout(showRenameCard, 6000); return; }
    renameEl = document.createElement('section');
    renameEl.className = 'pwa-float pwa-rename';
    renameEl.setAttribute('role', 'region');
    renameEl.setAttribute('aria-label', 'Update the app name');
    renameEl.innerHTML =
      '<img class="pwa-float-icon" src="' + CFG.iconUrl + '" alt="" width="36" height="36">' +
      '<div class="pwa-copy"><strong>Show ' + escapeHtml(shopName()) + ' as the app name</strong>' +
      '<span>Uninstall this app and install it again to update its name.</span></div>' +
      '<button type="button" class="btn btn-primary btn-sm" data-pwa-act="how">How</button>' +
      '<button type="button" class="pwa-close" data-pwa-act="later" aria-label="Later" title="Later">' + CLOSE_ICON + '</button>';
    renameEl.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-pwa-act]');
      if (!btn) return;
      if (btn.getAttribute('data-pwa-act') === 'how') showRenameGuide();
      else { ls.set(CFG.renameDismissKey, String(Date.now())); hideRenameCard(); }
    });
    document.body.appendChild(renameEl);
    syncNavOffset();
  }
  function showRenameGuide() {
    if (sheetEl || !document.body) return;
    hideRenameCard();
    var n = escapeHtml(shopName());
    sheetEl = document.createElement('div');
    sheetEl.className = 'pwa-sheet-backdrop';
    sheetEl.innerHTML =
      '<div class="pwa-sheet" role="dialog" aria-modal="true" aria-label="Update the app name">' +
      '<h3>Your app is still called "' + escapeHtml(CFG.appName) + '"</h3>' +
      '<p>Installed apps keep the name they had when they were installed. To show <strong>' + n + '</strong> instead, take 1 minute:</p>' +
      '<ol>' +
      '<li><strong>Uninstall</strong> the app. On a phone: press and hold its icon, then Uninstall. On a computer: open the app, click the menu (three dots) and choose Uninstall.</li>' +
      '<li>Open this website in Chrome again and sign in.</li>' +
      '<li>Tap <strong>Install</strong> on the card that appears. It will be named <strong>' + n + '</strong>.</li>' +
      '</ol>' +
      '<p>Your sales and stock are safe on the server. Anything saved offline on this till must be uploaded first (connect to the internet and wait for it to sync).</p>' +
      '<button type="button" class="btn btn-primary" data-pwa-act="close">Got it</button></div>';
    function close() { if (sheetEl) { sheetEl.remove(); sheetEl = null; } ls.set(CFG.renameDismissKey, String(Date.now())); }
    sheetEl.addEventListener('click', function (e) { if (e.target === sheetEl || e.target.closest('[data-pwa-act="close"]')) close(); });
    document.body.appendChild(sheetEl);
  }

  /** Runs the real install flow. Safe to call from any button. */
  function install() {
    if (isStandalone() || installedNow) { if (isLegacyInstall()) { showRenameGuide(); return Promise.resolve('rename-guide'); } return Promise.resolve('installed'); }

    if (deferredPrompt) {
      var nameAtPrompt = appName();
      var promptEvent = deferredPrompt;
      deferredPrompt = null; // a prompt event can only be used once
      window.__bip = null;
      promptEvent.prompt();
      return promptEvent.userChoice.then(function (choice) {
        var accepted = !!(choice && choice.outcome === 'accepted');
        if (accepted) { rememberInstalled(); rememberInstalledAs(nameAtPrompt); }
        dismissBanner(!accepted);
        emitChange();
        return accepted ? 'accepted' : 'dismissed';
      }).catch(function () { emitChange(); return 'dismissed'; });
    }

    if (isLegacyInstall()) { // already installed under the old name: tell the user how to rename it (uninstall + install again)
      showRenameGuide();
      return Promise.resolve('rename-guide');
    }

    if (isIos()) {
      rememberInstalledAs(appName());
      showIosGuide();
      return Promise.resolve('ios-guide');
    }

    showManualGuide();
    return Promise.resolve('ios-guide');
  }

  /* ------------------------------------------------------------------ *
   * Optional [data-pwa-install] triggers
   * ------------------------------------------------------------------ */
  function refreshTriggers() {
    var els = document.querySelectorAll('[data-pwa-install]');
    var show = canInstall();
    for (var i = 0; i < els.length; i++) els[i].hidden = !show;
  }

  document.addEventListener('click', function (e) {
    var t = e.target.closest && e.target.closest('[data-pwa-install]');
    if (!t) return;
    e.preventDefault();
    install();
  });

  /* ------------------------------------------------------------------ *
   * Update card
   * ------------------------------------------------------------------ */
  function showUpdate(worker) {
    if (updateEl || !document.body) return;
    dismissBanner(false); // one card at a time; the update matters more
    updateEl = document.createElement('div');
    updateEl.className = 'pwa-float pwa-update';
    updateEl.setAttribute('role', 'status');
    updateEl.innerHTML =
      '<div class="pwa-copy"><strong>Update ready</strong><span>Finish your current sale, then refresh.</span></div>' +
      '<button type="button" class="btn btn-primary btn-sm" data-pwa-act="refresh">Refresh</button>' +
      '<button type="button" class="pwa-close" data-pwa-act="later" aria-label="Later" title="Later">' + CLOSE_ICON + '</button>';
    updateEl.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-pwa-act]');
      if (!btn) return;
      if (btn.getAttribute('data-pwa-act') === 'later') {
        updateEl.remove();
        updateEl = null;
        return;
      }
      if (userRequestedRefresh) return; // already updating: ignore repeat taps
      userRequestedRefresh = true;
      // Instant feedback: the button reacts the moment it is tapped.
      btn.disabled = true;
      btn.classList.add('pwa-busy');
      btn.textContent = 'Updating\u2026';
      // Use the newest waiting worker. The one captured when the card appeared may have been
      // replaced by a newer deploy, and a message to a replaced worker is silently ignored.
      var target = (swReg && swReg.waiting) || worker;
      if (target && target.state !== 'redundant') {
        try { target.postMessage({ type: 'SKIP_WAITING' }); } catch (err) { window.location.reload(); return; }
      } else {
        window.location.reload();
        return;
      }
      // Safety net: if the browser never reports the switch, reload anyway instead of looking frozen.
      setTimeout(function () { window.location.reload(); }, 2500);
    });
    document.body.appendChild(updateEl);
    syncNavOffset();
  }

  /* ------------------------------------------------------------------ *
   * Connection notice
   * ------------------------------------------------------------------ */
  function updateConnectionUi() {
    if (!document.body) return;
    if (window.OfflineUI) { if (offlineEl) { offlineEl.remove(); offlineEl = null; } return; } // the till status chip handles this
    if (!window.navigator.onLine) {
      wasOffline = true;
      if (!offlineEl) {
        offlineEl = document.createElement('div');
        offlineEl.className = 'pwa-offline';
        offlineEl.setAttribute('role', 'status');
        offlineEl.setAttribute('aria-live', 'polite');
        offlineEl.textContent = 'Offline. Sales cannot be saved until you reconnect.';
        document.body.appendChild(offlineEl);
      }
    } else {
      if (offlineEl) { offlineEl.remove(); offlineEl = null; }
      if (wasOffline) { wasOffline = false; toast('success', 'Back online'); }
    }
  }

  /* ------------------------------------------------------------------ *
   * Service worker registration
   * ------------------------------------------------------------------ */
  function registerServiceWorker() {
    if (!('serviceWorker' in window.navigator) || !isSecureContextForSw()) return;

    window.navigator.serviceWorker.addEventListener('controllerchange', function () {
      // Only reload when the cashier asked for it. The very first install
      // also fires this event and must not reload the page.
      if (userRequestedRefresh) window.location.reload();
    });

    window.navigator.serviceWorker.register(CFG.swUrl, { scope: './' }).then(function (reg) {
      swReg = reg;

      if (reg.waiting && window.navigator.serviceWorker.controller) showUpdate(reg.waiting);

      reg.addEventListener('updatefound', function () {
        var nw = reg.installing;
        if (!nw) return;
        nw.addEventListener('statechange', function () {
          if (nw.state === 'installed' && window.navigator.serviceWorker.controller) showUpdate(nw);
        });
      });

      setInterval(function () { reg.update().catch(function () {}); }, CFG.updateCheckMs);
      document.addEventListener('visibilitychange', function () {
        if (!document.hidden) reg.update().catch(function () {});
      });
    }).catch(function (err) {
      if (window.console) console.warn('[PWA] Service worker registration failed:', err);
    });

    // Ask the browser not to evict our saved files when storage runs low.
    try {
      if (window.navigator.storage && window.navigator.storage.persist) window.navigator.storage.persist();
    } catch (e) { /* ignore */ }
  }

  /* ------------------------------------------------------------------ *
   * Wiring
   * ------------------------------------------------------------------ */
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();      // we show our own, better-timed prompt
    deferredPrompt = e;
    window.__bip = e;
    ls.set(instKey(), '0'); // the browser only offers the install when the app is NOT installed (e.g. it was uninstalled)
    hideRenameCard();
    // If the plain "how to install" card is already showing, swap it for the real one-tap Install card.
    if (bannerEl) { bannerEl.remove(); bannerEl = null; }
    emitChange();
    scheduleBanner(bannerEl ? 0 : 300);
  });

  // The browser may have offered the install before this script loaded (app-shell.js keeps it safe in window.__bip).
  if (window.__bip && !deferredPrompt) { deferredPrompt = window.__bip; scheduleBanner(CFG.bannerDelayMs); }

  window.addEventListener('appinstalled', function () {
    installedNow = true;
    rememberInstalled();
    rememberInstalledAs(appName());
    deferredPrompt = null;
    dismissBanner(false);
    if (sheetEl) { sheetEl.remove(); sheetEl = null; }
    emitChange();
    toast('success', appName() + ' installed. Open it from your desktop or home screen.');
  });

  window.addEventListener('online', updateConnectionUi);
  window.addEventListener('offline', updateConnectionUi);

  // Re-check "is the bottom nav showing?" when the window resizes or rotates.
  var resizeTimer = null;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(syncNavOffset, 150);
  });

  // Keep [data-pwa-install] buttons in sync when app-shell renders them later.
  function watchTriggers() {
    if (!('MutationObserver' in window) || !document.body) return;
    var pending = false;
    new MutationObserver(function () {
      if (pending) return;
      pending = true;
      setTimeout(function () { pending = false; refreshTriggers(); syncNavOffset(); }, 200);
    }).observe(document.body, { childList: true, subtree: true });
  }

  function watchShopName() {
    var tries = 0;
    var t = setInterval(function () { tries += 1; applyManifestName(); if (isLegacyInstall()) setTimeout(showRenameCard, 1200); if (tries > 40) clearInterval(t); }, 750);
    window.addEventListener('storage', function () { applyManifestName(); });
    document.addEventListener('visibilitychange', function () { if (!document.hidden) applyManifestName(); });
  }

  function onReady() {
    injectStyles();
    applyManifestName();
    watchShopName();
    setTimeout(showRenameCard, 2500);
    refreshTriggers();
    watchTriggers();
    updateConnectionUi();
    if (isIos()) scheduleBanner(CFG.bannerDelayMs * 2);
    else if (isPhone()) setTimeout(function () { if (!bannerEl && !deferredPrompt) scheduleBanner(0); }, 9000); // no prompt event arrived: show the how-to card
  }

  // Head tags and the service worker do not need the DOM to be ready.
  ensureHeadTags();
  applyManifestName();
  if (isStandalone()) { document.documentElement.classList.add('is-pwa'); rememberInstalled(); }
  registerServiceWorker();

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', onReady);
  else onReady();

  window.PWA = {
    canInstall: canInstall,
    install: install,
    isInstalled: function () { return isStandalone() || installedNow; },
    onChange: function (fn) {
      listeners.push(fn);
      return function () { listeners = listeners.filter(function (f) { return f !== fn; }); };
    },
    checkForUpdate: function () {
      return swReg ? swReg.update() : Promise.resolve();
    },
  };
})(window, document);