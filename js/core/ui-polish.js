/**
 * ui-polish.js
 * Two additive upgrades, loaded by app-shell.js before any page script runs:
 *
 *  1. UNIQUE ICONS - a hand-drawn icon pack laid over window.Icons. Any name found here is
 *     used; any name that is not (icons only some pages use) falls through to your existing
 *     icons.js, so nothing can go missing. Every nav item and feature now has its own icon.
 *
 *  2. COPY ON EVERY ALERT - toasts (success / error / warning) and inline alerts
 *     (.form-alert) get a small copy button. Hovering or touching a toast keeps it on screen
 *     long enough to copy it.
 *
 * Safe to load on login/register too: <script src="js/core/ui-polish.js"></script>
 */
(function (window, document) {
  'use strict';
  if (window.__uiPolish) return;
  window.__uiPolish = true;

  /* ================================================================== *
   * 1. ICON PACK  (24x24 grid, 1.8 stroke, currentColor)
   * ================================================================== */
  var ATTR = 'fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"';
  function svg(inner) {
    return '<svg viewBox="0 0 24 24" width="20" height="20" ' + ATTR + ' aria-hidden="true" focusable="false">' + inner + '</svg>';
  }

  var PACK = {
    // Pages
    dashboard: '<rect x="3" y="3" width="8" height="10" rx="2"/><rect x="13" y="3" width="8" height="5" rx="2"/><rect x="13" y="10" width="8" height="11" rx="2"/><rect x="3" y="15" width="8" height="6" rx="2"/>',
    sales: '<rect x="7" y="3" width="10" height="6" rx="1.5"/><path d="M12 9v4"/><path d="M4 21v-6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v6z"/><path d="M8 17h.01M12 17h.01M16 17h.01"/>',
    products: '<path d="M3 4a1 1 0 0 1 1-1h7.2a2 2 0 0 1 1.4.6l7.8 7.8a2 2 0 0 1 0 2.8l-5.2 5.2a2 2 0 0 1-2.8 0L3.6 12.6A2 2 0 0 1 3 11.2z"/><circle cx="7.5" cy="7.5" r="1.3"/>',
    inventory: '<path d="M3 21V8l9-5 9 5v13"/><path d="M7 21v-7h10v7"/><path d="M7 17.5h10"/>',
    suppliers: '<path d="M2 6h11v10H2z"/><path d="M13 9h4.5L21 12.5V16h-8"/><circle cx="6.5" cy="17.5" r="2"/><circle cx="17" cy="17.5" r="2"/>',
    purchases: '<path d="M3 9h18l-1.8 9.2a2 2 0 0 1-2 1.8H6.8a2 2 0 0 1-2-1.8z"/><path d="M8 9l3-5M16 9l-3-5"/><path d="M9 13v3M12 13v3M15 13v3"/>',
    expenses: '<path d="M3 7a2 2 0 0 1 2-2h12v3"/><path d="M3 7v11a2 2 0 0 0 2 2h14a1 1 0 0 0 1-1v-9a1 1 0 0 0-1-1H5a2 2 0 0 1-2-2z"/><circle cx="16.5" cy="14.5" r="1" fill="currentColor"/>',
    refunds: '<path d="M4 6v5h5"/><path d="M4.6 15a8 8 0 1 0 1.5-8.5L4 11"/><circle cx="12.5" cy="12" r="2.4"/>',
    reports: '<path d="M3 3v18h18"/><rect x="7" y="12" width="3" height="6" rx=".6"/><rect x="12" y="8" width="3" height="10" rx=".6"/><rect x="17" y="5" width="3" height="13" rx=".6"/>',
    audit: '<path d="M12 3l8 3v6c0 4.5-3.2 7.8-8 9-4.8-1.2-8-4.5-8-9V6z"/><path d="M8.5 12l2.5 2.5 4.5-5"/>',
    cash: '<rect x="2.5" y="6" width="19" height="12" rx="2"/><circle cx="12" cy="12" r="2.6"/><path d="M6 9.5h.01M18 14.5h.01"/>',
    branches: '<path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
    employees: '<rect x="4" y="3" width="16" height="18" rx="2.5"/><circle cx="12" cy="10" r="2.5"/><path d="M8 17c.6-2 2.2-3 4-3s3.4 1 4 3"/><path d="M10 5.5h4"/>',
    customers: '<circle cx="9" cy="8" r="3"/><path d="M3 20c.5-3.3 3-5 6-5s5.5 1.7 6 5"/><circle cx="17" cy="9" r="2.3"/><path d="M17 14.2c2.2.2 3.8 1.6 4.2 4.3"/>',
    tickets: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3.5"/><path d="M5.6 5.6l3.9 3.9M14.5 14.5l3.9 3.9M18.4 5.6l-3.9 3.9M9.5 14.5l-3.9 3.9"/>',
    bell: '<path d="M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 21h4"/>',
    settings: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
    store: '<path d="M4 9l1.5-5h13L20 9"/><path d="M4 9a2.7 2.7 0 0 0 5.3 0 2.7 2.7 0 0 0 5.4 0A2.7 2.7 0 0 0 20 9"/><path d="M5 12v8h14v-8"/><path d="M10 20v-4h4v4"/>',
    box: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M4 7.5l8 4.5 8-4.5M12 12v9"/>',

    // Actions and status
    alert: '<path d="M12 3.5L2.8 19.5h18.4z"/><path d="M12 10v4.5M12 17.2h.01"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
    edit: '<path d="M4 20l1-4.5L16.5 4a2.1 2.1 0 0 1 3 3L8 18.5z"/><path d="M14.5 6l3.5 3.5"/>',
    trash: '<path d="M4 7h16M10 7V4h4v3"/><path d="M6 7l1 13h10l1-13"/><path d="M10 11v6M14 11v6"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    dots: '<circle cx="5" cy="12" r="1.4" fill="currentColor"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/><circle cx="19" cy="12" r="1.4" fill="currentColor"/>',
    chevronDown: '<path d="M6 9l6 6 6-6"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h10"/>',
    logout: '<path d="M9 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h3"/><path d="M16 8l4 4-4 4M20 12H10"/>',
    lock: '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>',
    copy: '<rect x="9" y="9" width="11" height="11" rx="2.2"/><path d="M5.5 15H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v.5"/>',
  };

  var Icons = window.Icons = window.Icons || {};
  var original = typeof Icons.get === 'function' ? Icons.get : null;
  Icons.pack = PACK;
  Icons.get = function (name) {
    if (Object.prototype.hasOwnProperty.call(PACK, name)) return svg(PACK[name]);
    return original ? original.apply(Icons, arguments) : '';
  };

  // Dashboard shortcuts reuse one icon for several links; give each its own without touching dashboard.js.
  var QUICK_ICON = {
    'sales.html': 'sales', 'products.html': 'products', 'inventory.html': 'inventory',
    'customers.html': 'customers', 'expenses.html': 'expenses', 'reports.html': 'reports', 'audit-logs.html': 'audit',
  };
  function relinkQuickActions() {
    document.querySelectorAll('.quick-actions a[href]').forEach(function (a) {
      var key = QUICK_ICON[a.getAttribute('href')];
      if (!key || a.dataset.icoDone) return;
      var old = a.querySelector('svg');
      if (old) {
        var t = document.createElement('template');
        t.innerHTML = svg(PACK[key]);
        old.replaceWith(t.content.firstChild);
      }
      a.dataset.icoDone = '1';
    });
  }

  /* ================================================================== *
   * 2. COPY BUTTON ON ALERTS
   * ================================================================== */
  var css = document.createElement('style');
  css.id = 'ui-polish-css';
  css.textContent =
    '.ui-copy{flex:none;display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;padding:0;border:none;border-radius:6px;background:transparent;color:inherit;opacity:.75;cursor:pointer}' +
    '.ui-copy:hover,.ui-copy:focus-visible{opacity:1;background:rgba(255,255,255,.2);outline:none}' +
    '.ui-copy svg{width:16px;height:16px}' +
    '.toast .ui-copy{margin-left:auto}' +
    '.toast .ui-copy + .toast-close{margin-left:2px}' +
    '.form-alert .ui-copy{margin-left:auto}' +
    '.form-alert .ui-copy:hover,.form-alert .ui-copy:focus-visible{background:rgba(0,0,0,.08)}';
  document.head.appendChild(css);

  function messageOf(el) {
    var c = el.cloneNode(true);
    c.querySelectorAll('button, svg, .toast-icon, .ui-copy').forEach(function (n) { n.remove(); });
    return c.textContent.replace(/\s+/g, ' ').trim();
  }

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text).then(function () { return true; }, function () { return legacyCopy(text); });
    }
    return Promise.resolve(legacyCopy(text));
  }
  function legacyCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text; ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0';
    document.body.appendChild(ta);
    ta.select();
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    ta.remove();
    return ok;
  }

  function addCopy(el) {
    if (el.__hasCopy) return;
    el.__hasCopy = true;
    var text = messageOf(el);
    if (!text) return;

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ui-copy';
    btn.title = 'Copy message';
    btn.setAttribute('aria-label', 'Copy message');
    btn.innerHTML = Icons.get('copy');

    var close = el.querySelector('.toast-close');
    if (close && close.parentNode === el) el.insertBefore(btn, close); else el.appendChild(btn);

    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      copyText(messageOf(el) || text).then(function (ok) {
        btn.innerHTML = Icons.get(ok ? 'check' : 'alert');
        btn.title = btn.ariaLabel = ok ? 'Copied' : 'Could not copy';
        setTimeout(function () {
          btn.innerHTML = Icons.get('copy');
          btn.title = 'Copy message';
          btn.setAttribute('aria-label', 'Copy message');
        }, 1500);
      });
    });

    if (el.classList.contains('toast')) holdWhileHovered(el);
  }

  /* A toast under the pointer (or finger) stays until it is let go, so there is time to copy it. */
  function holdWhileHovered(el) {
    el.addEventListener('pointerenter', function () { el.__hold = true; });
    el.addEventListener('pointerleave', function () {
      el.__hold = false;
      if (el.__rescued) setTimeout(function () { if (!el.__hold) { el.__gone = true; el.remove(); } }, 1500);
    });
  }

  function scan(root) {
    if (root.nodeType !== 1) return;
    if (root.matches('.toast, .form-alert')) addCopy(root);
    root.querySelectorAll('.toast, .form-alert').forEach(addCopy);
    if (root.matches('.quick-actions') || root.querySelector('.quick-actions')) relinkQuickActions();
  }

  function rescue(node, parent) {
    if (node.nodeType !== 1 || !node.classList.contains('toast') || !node.__hold || node.__gone) return;
    node.__rescued = true;
    Array.prototype.slice.call(node.classList).forEach(function (c) {
      if (/out|leav|hid|exit|fade/i.test(c)) node.classList.remove(c);
    });
    node.style.opacity = ''; node.style.transform = '';
    if (parent && parent.isConnected) parent.appendChild(node);
  }

  function start() {
    scan(document.body);
    new MutationObserver(function (muts) {
      muts.forEach(function (m) {
        m.addedNodes.forEach(scan);
        m.removedNodes.forEach(function (n) { rescue(n, m.target); });
      });
    }).observe(document.body, { childList: true, subtree: true });
  }

  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
})(window, document);