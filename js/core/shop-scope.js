/**
 * Shop scope: lets one phone hold a separate installed app per shop.
 * An app installed for a shop opens at  dashboard.html?source=pwa&shop=<shopId>. From then on, in that window,
 * localStorage and IndexedDB names are prefixed with the shop id, so each installed app has its own login,
 * offline products, stock and unsent sales. Without a shop id (normal browser use, apps installed before this
 * change) nothing is changed. Must be the FIRST script on every page.
 */
(function () {
  try {
    var s = null;
    try { s = new URL(window.location.href).searchParams.get('shop'); } catch (e) { /* ignore */ }
    if (s && /^[A-Za-z0-9_-]{1,40}$/.test(s)) { try { window.sessionStorage.setItem('pos.scope', s); } catch (e) { /* ignore */ } }
    else { try { s = window.sessionStorage.getItem('pos.scope'); } catch (e) { s = null; } }
    if (!s || !/^[A-Za-z0-9_-]{1,40}$/.test(s)) {
      // Normal browser tab: point the manifest at THIS shop before the browser reads it, so Chrome offers a fresh
      // install for this shop even when another shop's app (or the old "Six Star POS" app) is already on the phone.
      try {
        if (!(window.matchMedia && window.matchMedia('(display-mode: standalone)').matches)) {
          var pr = JSON.parse(window.localStorage.getItem('pos.businessProfile') || 'null');
          var id = String((pr && (pr._id || pr.id)) || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40);
          var nm = String((pr && (pr.name || pr.businessName)) || '').replace(/[\u0000-\u001f<>"]/g, '').replace(/\s+/g, ' ').trim().slice(0, 40);
          if (id && nm) {
            var fix = function (l) { if (l && l.rel === 'manifest' && (l.getAttribute('href') || '').indexOf('manifest.webmanifest') === 0 && (l.getAttribute('href') || '').indexOf('s=') < 0) l.setAttribute('href', 'manifest.webmanifest?n=' + encodeURIComponent(nm) + '&s=' + encodeURIComponent(id)); };
            var ex = document.querySelector('link[rel="manifest"]'); if (ex) fix(ex);
            var mo = new MutationObserver(function (ml) { ml.forEach(function (m) { m.addedNodes.forEach(function (n) { if (n.nodeName === 'LINK') fix(n); }); }); });
            mo.observe(document.documentElement, { childList: true, subtree: true });
            document.addEventListener('DOMContentLoaded', function () { mo.disconnect(); });
          }
        }
      } catch (e) { /* ignore */ }
      return;
    }
    window.__POS_SCOPE = s;
    // keep the shop in the address bar: if the phone restores this window after closing it, the shop id comes back with it
    try {
      var cu = new URL(window.location.href);
      if (cu.searchParams.get('shop') !== s) { cu.searchParams.set('shop', s); window.history.replaceState(window.history.state, '', cu.pathname + cu.search + cu.hash); }
    } catch (e) { /* ignore */ }

    var P = 's:' + s + ':';
    var ls = window.localStorage; var SP = Storage.prototype;
    var get = SP.getItem, set = SP.setItem, rem = SP.removeItem, key = SP.key;
    var lenDesc = Object.getOwnPropertyDescriptor(SP, 'length');
    var own = function (o) { return o === ls; };
    var mine = function () { var out = []; var n = lenDesc.get.call(ls); for (var i = 0; i < n; i++) { var k = key.call(ls, i); if (k && k.indexOf(P) === 0) out.push(k); } return out; };
    SP.getItem = function (k) { return own(this) ? get.call(this, P + k) : get.call(this, k); };
    SP.setItem = function (k, v) { return own(this) ? set.call(this, P + k, v) : set.call(this, k, v); };
    SP.removeItem = function (k) { return own(this) ? rem.call(this, P + k) : rem.call(this, k); };
    SP.key = function (i) { if (!own(this)) return key.call(this, i); var m = mine(); return i < m.length ? m[i].slice(P.length) : null; };
    SP.clear = (function (orig) { return function () { if (!own(this)) return orig.call(this); mine().forEach(function (k) { rem.call(ls, k); }); }; })(SP.clear);
    Object.defineProperty(SP, 'length', { configurable: true, enumerable: lenDesc.enumerable, get: function () { return own(this) ? mine().length : lenDesc.get.call(this); } });

    if (window.IDBFactory) {
      var open = IDBFactory.prototype.open, del = IDBFactory.prototype.deleteDatabase;
      IDBFactory.prototype.open = function (name, ver) { var n = String(name) + '@' + s; return ver === undefined ? open.call(this, n) : open.call(this, n, ver); };
      IDBFactory.prototype.deleteDatabase = function (name) { return del.call(this, String(name) + '@' + s); };
    }
  } catch (e) { /* never block the page */ }
})();
