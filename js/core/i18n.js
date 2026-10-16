/**
 * i18n.js - English / Kiswahili for the dashboard screens. No build step, no changes to the page scripts.
 *
 * HOW IT WORKS
 *  - Screens are written in English. When the language is Kiswahili this file swaps every piece of visible text
 *    (text, placeholder, title, aria-label, alt, button value, page title) for the phrase in js/core/i18n-sw.js,
 *    and keeps watching the page so text drawn later (tables, modals, toasts) is translated as it appears.
 *  - A phrase with no entry stays in English - nothing breaks. In Kiswahili mode, run  I18n.missing()  in the browser
 *    console after using a screen: it lists the phrases still untranslated, ready to paste into i18n-sw.js.
 *  - Money labels: for a Tanzanian business "KES" in any label becomes "TZS" (English or Kiswahili).
 *  - Text that must never be translated: translate="no" or class="no-i18n".
 *
 * LANGUAGE (per person)
 *  - Each person picks their own language with the switcher in the top bar. It is saved on their account
 *    (PUT /auth/language) and on this device ("pos.lang"); api.js sends it as X-Lang on every request, so receipts,
 *    notifications and error messages from the server follow it too.
 *  - Until a person chooses, the business default is used (I18n.adopt, called by country-flag.js).
 *
 * API: I18n.lang(), I18n.t(text), I18n.setLanguage('sw') -> Promise, I18n.adopt(userLang, businessLang, userId),
 *      I18n.setCurrency('TZS'), I18n.apply(root), I18n.mountSwitcher(el), I18n.missing(), I18n.ready
 */
(function (window) {
  'use strict';

  var KEY = 'pos.lang';
  var EXPLICIT = 'pos.lang.by';      // who chose the language on this device (user id)
  var LANGS = { en: 'English', sw: 'Kiswahili' };
  var SKIP_TAGS = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TEXTAREA: 1, CODE: 1, PRE: 1, SVG: 1 };
  var ATTRS = ['placeholder', 'title', 'aria-label', 'alt'];

  var current = readLang();
  var currency = readCurrency();
  var dict = null;
  var dictLoading = null;
  var started = false;
  var observer = null;
  var queue = [];
  var scheduled = false;
  var textMemo = new WeakMap();
  var attrMemo = new WeakMap();
  var listeners = [];
  var missing = Object.create(null);

  function readLang() {
    try { var v = localStorage.getItem(KEY); if (v === 'en' || v === 'sw') return v; } catch (e) { /* storage blocked */ }
    return 'en';
  }
  function readCurrency() {
    try { var c = localStorage.getItem('pos.currency'); if (c === 'KES' || c === 'TZS') return c; } catch (e) { /* ignore */ }
    return 'KES';
  }
  function userId() {
    try { var u = window.Storage && window.Storage.getUser && window.Storage.getUser(); return u ? String(u._id || u.id || '') : ''; } catch (e) { return ''; }
  }

  /* ----------------------------- dictionary ----------------------------- */
  function loadDict() {
    if (dict) return Promise.resolve(dict);
    if (window.I18N_SW) { dict = prepare(window.I18N_SW); return Promise.resolve(dict); }
    if (dictLoading) return dictLoading;
    dictLoading = new Promise(function (resolve) {
      var s = document.createElement('script');
      s.src = 'js/core/i18n-sw.js';
      s.async = true;
      s.onload = function () { dict = prepare(window.I18N_SW || {}); resolve(dict); };
      s.onerror = function () { console.warn('i18n: js/core/i18n-sw.js could not be loaded'); dict = prepare({}); resolve(dict); };
      document.head.appendChild(s);
    });
    return dictLoading;
  }
  function prepare(src) {
    var out = { exact: Object.create(null), lower: Object.create(null), rules: window.I18N_SW_RULES || [] };
    Object.keys(src).forEach(function (k) { var nk = norm(k); out.exact[nk] = src[k]; out.lower[nk.toLowerCase()] = src[k]; });
    return out;
  }
  function norm(s) { return String(s).replace(/[\u2018\u2019]/g, "'").replace(/\s+/g, ' ').trim(); }

  function swahili(core) {
    if (!dict) return core;
    var k = norm(core);
    if (!k) return core;
    var hit = dict.exact[k];
    if (hit === undefined) {
      hit = dict.lower[k.toLowerCase()];
      if (hit !== undefined && k === k.toUpperCase() && /[A-Z]/.test(k)) hit = hit.toUpperCase(); // "TOTAL" -> "JUMLA"
    }
    if (hit !== undefined) return hit;
    for (var i = 0; i < dict.rules.length; i++) {
      if (dict.rules[i][0].test(k)) return k.replace(dict.rules[i][0], dict.rules[i][1]);
    }
    var colon = k.match(/^([^:]{2,40}):\s*([\s\S]*)$/);                 // "Label: value"
    if (colon && dict.exact[colon[1]] !== undefined) return dict.exact[colon[1]] + ': ' + swahili(colon[2]);
    var opt = k.match(/^(.{2,60}?)\s*(\([^)]*\))$/);                     // "Label (optional)"
    if (opt && dict.exact[opt[1]] !== undefined) return dict.exact[opt[1]] + ' ' + (dict.exact[opt[2]] !== undefined ? dict.exact[opt[2]] : opt[2]);
    if (/[A-Za-z]{3}/.test(k) && k.length < 140) missing[k] = 1;
    return core;
  }

  function convert(text) {
    var m = String(text).match(/^(\s*)([\s\S]*?)(\s*)$/);
    var core = m[2];
    if (!core) return text;
    var out = core;
    if (current === 'sw') out = swahili(out);
    if (currency === 'TZS' && out.indexOf('KES') !== -1) out = out.replace(/\bKES\b/g, 'TZS');
    return out === core ? text : m[1] + out + m[3];
  }
  function active() { return current === 'sw' || currency !== 'KES'; }

  /* ------------------------------- walking ------------------------------- */
  function skip(el) {
    if (!el || el.nodeType !== 1) return false;
    if (SKIP_TAGS[el.tagName.toUpperCase()]) return true;
    return el.getAttribute('translate') === 'no' || el.classList.contains('no-i18n') || el.isContentEditable;
  }
  function insideSkipped(node) {
    for (var el = node.parentNode; el && el.nodeType === 1; el = el.parentNode) { if (skip(el)) return true; }
    return false;
  }

  function doText(node) {
    var memo = textMemo.get(node);
    var val = node.nodeValue;
    var orig = memo && memo.out === val ? memo.orig : val;     // the app rewrote it: the new text is the new original
    var out = active() ? convert(orig) : orig;
    if (out !== val) node.nodeValue = out;
    if (out !== orig || memo) textMemo.set(node, { orig: orig, out: out });
  }

  function doAttrs(el) {
    if (skip(el)) return;
    var memo = attrMemo.get(el) || {};
    var touched = false;
    ATTRS.forEach(function (a) {
      if (!el.hasAttribute(a)) return;
      var val = el.getAttribute(a);
      var m = memo[a];
      var orig = m && m.out === val ? m.orig : val;
      var out = active() ? convert(orig) : orig;
      if (out !== val) el.setAttribute(a, out);
      if (out !== orig || m) { memo[a] = { orig: orig, out: out }; touched = true; }
    });
    if (el.tagName === 'INPUT' && /^(button|submit|reset)$/i.test(el.type || '')) {
      var v = el.value; var mv = memo.value; var ov = mv && mv.out === v ? mv.orig : v; var nv = active() ? convert(ov) : ov;
      if (nv !== v) el.value = nv;
      if (nv !== ov || mv) { memo.value = { orig: ov, out: nv }; touched = true; }
    }
    if (touched) attrMemo.set(el, memo);
  }

  function apply(root) {
    root = root || document.body;
    if (!root) return;
    if (root.nodeType === 3) { if (!insideSkipped(root)) doText(root); return; }
    if (root.nodeType !== 1 && root.nodeType !== 9) return;
    var base = root.nodeType === 9 ? root.body : root;
    if (!base || skip(base) || insideSkipped(base)) return;
    doAttrs(base);
    var walker = document.createTreeWalker(base, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) {
        if (n.nodeType === 1) return skip(n) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_SKIP;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    var n;
    while ((n = walker.nextNode())) doText(n);
    var list = base.querySelectorAll('[placeholder],[title],[aria-label],[alt],input[type=button],input[type=submit],input[type=reset]');
    for (var i = 0; i < list.length; i++) doAttrs(list[i]);
    if (base === document.body) translateTitle();
  }

  function translateTitle() {
    if (!document.title) return;
    if (!document.__i18nTitle || document.__i18nTitle.out !== document.title) document.__i18nTitle = { orig: document.title, out: document.title };
    if (!active()) return;
    var parts = document.__i18nTitle.orig.split(' \u00b7 ');
    var out = parts.map(function (p, i) { return i === parts.length - 1 && parts.length > 1 ? p : convert(p); }).join(' \u00b7 ');
    document.__i18nTitle.out = out;
    if (document.title !== out) document.title = out;
  }
  function restoreTitle() {
    if (document.__i18nTitle && document.title === document.__i18nTitle.out) document.title = document.__i18nTitle.orig;
  }

  /* ------------------------------- observer ------------------------------- */
  function flush() {
    scheduled = false;
    var items = queue; queue = [];
    if (observer) observer.disconnect();
    try { items.forEach(function (n) { if (n.isConnected !== false) apply(n); }); translateTitle(); } finally { observeNow(); }
  }
  function enqueue(n) {
    queue.push(n);
    if (!scheduled) { scheduled = true; (window.requestAnimationFrame || setTimeout)(flush, 0); }
  }
  function observeNow() {
    if (!observer || !document.body) return;
    observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS.concat(['value']) });
  }
  function startObserver() {
    if (observer || !window.MutationObserver) return;
    observer = new MutationObserver(function (muts) {
      if (!active()) return;
      muts.forEach(function (m) {
        if (m.type === 'childList') m.addedNodes.forEach(function (n) { if (n.nodeType === 1 || n.nodeType === 3) enqueue(n); });
        else enqueue(m.target);
      });
    });
    observeNow();
  }

  /* ------------------------------ public API ------------------------------ */
  function start() {
    if (started) return;
    started = true;
    startObserver();
    if (document.title) document.__i18nTitle = { orig: document.title, out: document.title };
  }

  /** Switch the screen language now (no reload). Device only; setLanguage() also saves it on the account. */
  function use(lang) {
    if (lang !== 'en' && lang !== 'sw') return Promise.resolve();
    current = lang;
    try { localStorage.setItem(KEY, lang); } catch (e) { /* ignore */ }
    document.documentElement.setAttribute('lang', lang);
    return (lang === 'sw' ? loadDict() : Promise.resolve()).then(function () {
      if (!active()) restoreTitle();
      apply(document.body);
      syncSwitcher();
      listeners.forEach(function (fn) { try { fn(lang); } catch (e) { /* ignore */ } });
      document.dispatchEvent(new CustomEvent('pos:language', { detail: { lang: lang } }));
    });
  }

  /** The signed-in person chose a language: apply it now and save it on their account. Resolves when the save was attempted. */
  function setLanguage(lang) {
    var applied = use(lang);
    var saved = saveOnAccount(lang);
    return Promise.all([applied, saved]).then(function () { /* done */ });
  }
  function saveOnAccount(lang) {
    try {
      try { localStorage.setItem(EXPLICIT, userId()); } catch (e) { /* ignore */ }
      var user = window.Storage && window.Storage.getUser && window.Storage.getUser();
      if (user) { user.language = lang; window.Storage.setUser(user); }
      if (window.Api && window.Storage && window.Storage.isAuthenticated && window.Storage.isAuthenticated()) {
        return window.Api.put('/auth/language', { language: lang }, { background: true }).catch(function () { /* offline: kept on this device */ });
      }
    } catch (e) { /* never block the screen */ }
    return Promise.resolve();
  }

  /**
   * Once per page load, after the profile is known. The person's own saved language wins; if they never chose one,
   * a choice made on this device stays; otherwise the business default is used.
   */
  function adopt(userLang, businessLang, uid) {
    var want = null;
    if (userLang === 'en' || userLang === 'sw') want = userLang;
    else {
      var by = ''; try { by = localStorage.getItem(EXPLICIT) || ''; } catch (e) { /* ignore */ }
      if (by && by === String(uid || userId())) return Promise.resolve();
      if (businessLang === 'en' || businessLang === 'sw') want = businessLang;
    }
    if (!want || want === current) return Promise.resolve();
    return use(want);
  }

  function setCurrency(code) {
    if (code !== 'KES' && code !== 'TZS') return;
    if (code === currency) return;
    currency = code;
    if (!active()) restoreTitle();
    apply(document.body);
  }

  /* ------------------------------- switcher ------------------------------- */
  var switchEl = null;
  function syncSwitcher() { if (switchEl) { var s = switchEl.querySelector('select'); if (s) s.value = current; } }
  function mountSwitcher(host) {
    if (!host) return;
    if (host.querySelector('.lang-switch')) { switchEl = host.querySelector('.lang-switch'); syncSwitcher(); return; }
    var wrap = document.createElement('label');
    wrap.className = 'lang-switch no-i18n';
    wrap.setAttribute('translate', 'no');
    wrap.title = 'Language / Lugha';
    var sel = document.createElement('select');
    sel.setAttribute('aria-label', 'Language / Lugha');
    Object.keys(LANGS).forEach(function (code) { var o = document.createElement('option'); o.value = code; o.textContent = LANGS[code]; sel.appendChild(o); });
    sel.value = current;
    sel.addEventListener('change', function () { setLanguage(sel.value); });
    wrap.appendChild(sel);
    host.appendChild(wrap);
    switchEl = wrap;
  }
  /** Public pages (login, register) have no top bar: float a small switcher in the corner. */
  function autoSwitcher() {
    if (document.getElementById('app-shell') || /admin/.test(location.pathname)) return;
    var host = document.createElement('div');
    host.className = 'lang-switch-floating';
    document.body.appendChild(host);
    mountSwitcher(host);
  }

  /* --------------------------------- boot --------------------------------- */
  var ready = (current === 'sw' ? loadDict() : Promise.resolve()).then(function () {
    function go() {
      start();
      document.documentElement.setAttribute('lang', current);
      if (active()) apply(document.body);
      autoSwitcher();
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go); else go();
  });

  window.I18n = {
    ready: ready,
    languages: LANGS,
    lang: function () { return current; },
    currency: function () { return currency; },
    t: function (text) { return convert(text); },
    missing: function () { return Object.keys(missing).sort(); },
    apply: apply, use: use, setLanguage: setLanguage, adopt: adopt, setCurrency: setCurrency, mountSwitcher: mountSwitcher,
    onChange: function (fn) { listeners.push(fn); },
  };
})(window);
