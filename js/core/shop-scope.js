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
    if (!s || !/^[A-Za-z0-9_-]{1,40}$/.test(s)) return;
    window.__POS_SCOPE = s;

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
