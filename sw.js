/**
 * sw.js (merged: original service worker + pharmacy till files) - app shell cache for offline selling.
 * Same-origin: precached + network-first (3 s) with cache fallback. API calls are never touched.
 * Cross-origin: only well-known CDNs (icons/fonts/scanner lib), stale-while-revalidate.
 * Place in the SAME folder as dashboard.html (the site root). Bump VERSION on every deploy.
 */
const VERSION = 'v4.2.4-stk-phone-anim';
const CACHE = `kenya-pos-${VERSION}`;
const NETWORK_TIMEOUT_MS = 3000;
const OFFLINE_URL = 'offline.html';
const CDN_HOSTS = /^(cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net|unpkg\.com|fonts\.googleapis\.com|fonts\.gstatic\.com|(.+\.)?fontawesome\.com)$/;





// Missing files are skipped (all
// Settled), so listing a file that does not exist is harmless.
const PRECACHE = [
  'rider.html', 'track.html', 'hx-live.html', 'css/live.css', 'css/rider-login.css', 'js/core/live-kit.js', 'js/rider/rider-app.js', 'js/track/track-app.js', 'js/pages/hx-live.js', 'manifest-rider.json',
  'hx-cashier.html', 'css/hx-cashier.css', 'js/pages/hx-cashier.js', 'hx-floor.html', 'hx-kitchen.html', 'hx-bills.html', 'hx-reservations.html', 'hx-delivery.html', 'hx-storefront.html', 'js/pages/hx-storefront.js', 'hx-tv.html', 'js/pages/hx-tv.js', 'css/tv.css', 'js/core/tv-render.js', 'kiosk.html', 'css/kiosk.css', 'js/pages/kiosk.js', 'hx-selfservice.html', 'js/pages/hx-selfservice.js', 'store.html', 'css/store-auth.css', 'hx-menu.html', 'hx-stock.html', 'hx-guest.html', 'hx-staff.html', 'hx-desk.html', 'hx-rooms.html', 'hx-stays.html', 'hx-housekeeping.html', 'hx-reports.html', 'js/pages/hx-floor.js', 'js/pages/hx-kitchen.js', 'js/pages/hx-bills.js', 'js/pages/hx-reservations.js', 'js/pages/hx-delivery.js', 'js/pages/hx-menu.js', 'js/pages/hx-stock.js', 'js/pages/hx-guest.js', 'js/pages/hx-staff.js', 'js/pages/hx-desk.js', 'js/pages/hx-rooms.js', 'js/pages/hx-stays.js', 'js/pages/hx-housekeeping.js', 'js/pages/hx-reports.js', 'js/core/qr-encoder.js',
  'hx-dashboard.html', 'hx-manager.html', 'js/pages/hx-manager.js', 'hx-services.html', 'js/pages/hx-services.js', 'js/core/business-types.js', 'hx-setup.html', 'hx-settings.html', 'hx-operations.html', 'js/pages/hx-operations.js', 'css/hospitality.css', 'css/hx-redesign.css', 'css/hx-pro.css', 'css/hx-fixes.css', 'js/core/hx-art.js', 'js/core/home-route.js', 'js/core/hx-kit.js', 'js/core/hx-pay.js', 'js/core/hx-order.js', 'js/core/hx-recipe.js', 'js/pages/hx-dashboard.js', 'js/pages/hx-setup.js', 'js/pages/hx-settings.js',
  'offline.html', 'onboarding.html', 'shelf-labels.html', 'batches.html', 'alerts.html', 'stocktakes.html', 'serials.html', 'warranty.html', 'repairs.html', 'vehicles.html', 'pharmacy.html', 'prescriptions.html', 'medicines.html', 'patients.html', 'pharmacy-compliance.html', 'pharmacy-settings.html', 'job-cards.html', 'manifest.webmanifest', 'index.html', 'login.html', 'register.html', 'dashboard.html', 'sales.html',
  'products.html', 'inventory.html', 'customers.html', 'branches.html', 'employees.html', 'suppliers.html',
  'purchases.html', 'expenses.html', 'refunds.html', 'reports.html', 'audit-logs.html', 'settings.html',
  'cash-register.html', 'notifications.html', 'offline-review.html', 'billing.html', 'crm.html',

  'wholesale.html', 'wholesale-reports.html', 'wholesale-sales.html', 'warehouses.html', 'payables.html', 'css/wholesale.css', 'js/core/wholesale-kit.js', 'js/core/product-picker.js', 'js/pages/wholesale-dashboard.js', 'js/pages/wholesale-inventory.js', 'js/pages/wholesale-suppliers.js', 'js/pages/wholesale-report.js', 'js/core/invoice-view.js',
  'css/variables.css', 'css/base.css', 'css/components.css', 'css/layout.css', 'css/pos.css', 'css/reports.css',
  'css/tour.css', 'css/announcements.css', 'css/billing.css', 'css/crm.css',

  'js/core/config.js', 'js/core/icons.js', 'js/core/storage.js', 'js/core/api.js', 'js/core/connectivity.js',
  'js/core/offline-db.js', 'js/core/offline-sync.js', 'js/core/offline-shifts.js', 'js/core/offline-auth.js',
  'js/core/offline-sale.js', 'js/core/wholesale.js', 'js/core/password-toggle.js', 'js/core/offline-ui.js', 'js/core/offline-settings.js',
  'js/core/permissions.js', 'js/core/ui.js', 'js/core/ui-polish.js', 'js/core/notification-types.js', 'js/core/notifications.js',
  'js/core/app-shell.js', 'js/core/pharmacy-kit.js', 'js/core/pharmacy-till.js', 'js/core/pharmacy-desk.js', 'js/core/pharmacy-product-form.js', 'js/core/batch-till.js', 'css/pharmacy.css', 'js/pages/pharmacy.js', 'js/pages/medicines.js', 'js/pages/patients.js', 'js/pages/prescriptions.js', 'js/pages/pharmacy-compliance.js', 'js/pages/pharmacy-settings.js', 'js/core/business-types.js', 'js/core/business-setup.js', 'js/core/barcode.js', 'js/core/barcode-labels.js', 'css/barcode-labels.css', 'css/onboarding.css', 'css/shelf-labels.css', 'js/pages/onboarding.js', 'js/pages/shelf-labels.js', 'js/core/module-kit.js', 'js/core/job-workflow.js', 'js/pages/batches.js', 'js/pages/alerts.js', 'js/pages/stocktakes.js', 'js/pages/serials.js', 'js/pages/warranty.js', 'js/pages/repairs.js', 'js/pages/vehicles.js', 'js/pages/job-cards.js', 'js/core/sidebar-rail.js', 'js/core/charts.js', 'js/core/report-tools.js', 'js/core/product-picker.js',
  'js/core/customer-picker.js', 'js/core/receipt-view.js', 'js/core/barcode-scanner.js', 'js/core/cash-count.js',
  'js/core/cash-drawer.js', 'js/core/tour.js', 'js/core/announcements.js', 'js/core/billing-banner.js', 'js/core/pwa.js', 'js/core/i18n.js', 'js/core/i18n-sw.js', 'js/core/country-flag.js', 'css/country-flag.css',

  'js/pages/dashboard.js', 'js/pages/login.js', 'js/pages/register.js', 'js/pages/sales.js', 'js/pages/products.js', 'js/core/wholesale-product-form.js',
  'js/pages/inventory.js', 'js/pages/customers.js', 'js/pages/branches.js', 'js/pages/employees.js', 'js/pages/suppliers.js',
  'js/pages/purchases.js', 'js/pages/expenses.js', 'js/pages/refunds.js', 'js/pages/reports.js', 'js/pages/audit-logs.js',
  'js/pages/settings.js', 'js/pages/cash-register.js', 'js/pages/notifications.js', 'js/pages/offline-review.js',

  'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png', 'icons/favicon-32.png',
];

const scopeUrl = (path) => new URL(path, self.registration.scope).toString();

async function cleanResponse(res) {
  if (!res.redirected) return res;
  const body = await res.blob();
  return new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers });
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

async function matchCached(cache, request) {
  const opts = { ignoreSearch: true };
  let hit = await cache.match(request, opts);
  if (hit) return hit;
  const url = new URL(request.url);
  const alts = [];
  if (url.pathname.endsWith('/')) alts.push(`${url.pathname}index.html`);
  else if (url.pathname.endsWith('.html')) alts.push(url.pathname.slice(0, -5));
  else if (!/\.[a-z0-9]+$/i.test(url.pathname)) alts.push(`${url.pathname}.html`);
  for (const p of alts) {
    hit = await cache.match(new URL(p, url.origin).toString(), opts);
    if (hit) return hit;
  }
  return null;
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.allSettled(PRECACHE.map(async (path) => {
      const res = await fetch(new Request(scopeUrl(path), { cache: 'reload' }));
      if (res && res.ok) await cache.put(scopeUrl(path), await cleanResponse(res));
    }));
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('kenya-pos-') && k !== CACHE).map((k) => caches.delete(k)));
    if (self.registration.navigationPreload) { try { await self.registration.navigationPreload.disable(); } catch (e) { /* ignore */ } }
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  const type = event.data && event.data.type;
  if (type === 'SKIP_WAITING') self.skipWaiting();
  if (type === 'GET_VERSION' && event.ports && event.ports[0]) event.ports[0].postMessage({ version: VERSION });
});

async function networkFirst(event, isNavigation) {
  const request = event.request;
  const cache = await caches.open(CACHE);
  const networkPromise = fetch(request).then((res) => {
    if (res && res.ok && res.type === 'basic') {
      cleanResponse(res.clone()).then((clean) => cache.put(request, clean)).catch(() => {});
    }
    return res;
  });
  event.waitUntil(networkPromise.catch(() => {}));
  try {
    return await withTimeout(networkPromise, NETWORK_TIMEOUT_MS);
  } catch (err) {
    const cached = await matchCached(cache, request);
    if (cached) return cached;
    if (err && err.message === 'timeout') { try { return await networkPromise; } catch (e) { /* fall through */ } }
    if (isNavigation) { const offline = await cache.match(scopeUrl(OFFLINE_URL)); if (offline) return offline; }
    return new Response('Offline', { status: 503, statusText: 'Offline', headers: { 'Content-Type': 'text/plain' } });
  }
}

async function cacheFirst(event) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(event.request, { ignoreSearch: true });
  if (cached) return cached;
  try {
    const res = await fetch(event.request);
    if (res && res.ok && res.type === 'basic') cache.put(event.request, res.clone()).catch(() => {});
    return res;
  } catch (e) { return new Response('', { status: 504, statusText: 'Offline' }); }
}

/** CDN files: serve the saved copy at once, refresh it in the background (opaque responses are fine to store). */
async function staleWhileRevalidate(event) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(event.request);
  const refresh = fetch(event.request).then((res) => {
    if (res && (res.ok || res.type === 'opaque')) cache.put(event.request, res.clone()).catch(() => {});
    return res;
  });
  event.waitUntil(refresh.catch(() => {}));
  if (cached) return cached;
  try { return await refresh; } catch (e) { return new Response('', { status: 504, statusText: 'Offline' }); }
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  if (req.headers.has('range')) return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) {
    if (CDN_HOSTS.test(url.hostname)) event.respondWith(staleWhileRevalidate(event));
    return; // the backend API is never cached
  }
  if (url.pathname.startsWith('/api/')) return;
  // Storefront links (/s/TOKEN, /q/b_TOKEN): network first, fall back to the cached store page so the installed app never shows "page not found"
  const SHELL = url.pathname.startsWith('/rider/') ? 'rider.html' : url.pathname.startsWith('/kiosk/') ? 'kiosk.html' : (url.pathname.startsWith('/s/') || /^\/q\/b_/.test(url.pathname)) ? 'store.html' : '';
  if (req.mode === 'navigate' && SHELL) {
    event.respondWith((async () => {
      try { const res = await fetch(req); if (res && res.ok) return res; throw new Error('bad'); }
      catch (e) { const cache = await caches.open(CACHE); const hit = await cache.match(scopeUrl(SHELL)); return hit || (await cache.match(scopeUrl(OFFLINE_URL))) || new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } }); }
    })());
    return;
  }
  if (url.pathname.startsWith('/s/') || url.pathname === '/s' || url.pathname.startsWith('/q/') || url.pathname === '/q' || url.pathname === '/q.html') return; // guest QR menu: always straight from the network
  if (url.pathname.endsWith('/sw.js')) return;

  if (req.mode === 'navigate') { event.respondWith(networkFirst(event, true)); return; }
  if (/\.(?:png|jpg|jpeg|gif|webp|svg|ico|woff2?|ttf)$/i.test(url.pathname)) { event.respondWith(cacheFirst(event)); return; }
  event.respondWith(networkFirst(event, false));
});

// ---- Web Push: "Your rider is 100 m away" (customer) and "New delivery" (rider). Needs VAPID keys on the server.
self.addEventListener('push', (event) => {
  let d = {}; try { d = event.data ? event.data.json() : {}; } catch (e) { d = { title: 'Six Star POS', body: event.data ? event.data.text() : '' }; }
  const title = d.title || 'Six Star POS';
  event.waitUntil(self.registration.showNotification(title, { body: d.body || d.message || '', icon: '/icons/icon-192.png', badge: '/icons/favicon-32.png', tag: d.tag || 'delivery', renotify: true, vibrate: [160, 80, 160], data: { url: d.url || d.link || '/' } }));
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close(); const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil((async () => {
    const all = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) { if (c.url.includes('/rider.html') || c.url.includes('/track.html')) { try { await c.focus(); return; } catch (e) { /* open new */ } } }
    return clients.openWindow(url);
  })());
});