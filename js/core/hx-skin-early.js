/**
 * hx-skin-early.js - put in <head> (last item) of every shared page.
 * Restaurant / accommodation businesses get the black-rail / blue look from the FIRST paint, so the default
 * orange theme never flashes. It reads the cached business profile (same cache app-shell.js uses), loads the
 * hx stylesheets as render-blocking <link>s and tags <body class="hx-skin"> the moment <body> exists.
 */
(function () {
  try {
    var file = (location.pathname.split('/').pop() || 'index.html').replace(/\.html$/, '');
    if (/^(hx-|admin|login|register|verify|kiosk|track|rider|store|offline|index|q$)/.test(file)) return;
    var p = JSON.parse(localStorage.getItem('pos.businessProfile') || 'null'); if (!p) return;
    var f = p.featureSettings || {};
    if (!(p.businessType === 'restaurant' || f.restaurantOrdering === true || f.accommodation === true)) return;
    ['css/hospitality.css', 'css/hx-redesign.css', 'css/hx-pro.css', 'css/hx-fixes.css'].forEach(function (h) {
      document.write('<link rel="stylesheet" href="' + h + '" data-hx-skin="' + h + '">');
    });
    document.write('<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" data-hx-skin="font">');
    var tag = function () { if (document.body) { document.body.classList.add('hx-skin'); return true; } return false; };
    if (!tag()) { var mo = new MutationObserver(function () { if (tag()) mo.disconnect(); }); mo.observe(document.documentElement, { childList: true }); }
  } catch (e) { /* never block the page */ }
})();
