/**
 * sw.js  (place in the SAME folder as dashboard.html, i.e. the site root)
 *
 * What this does
 *  - Pre-caches the app shell (HTML, CSS, JS, icons) so the app opens even
 *    with no connection.
 *  - Network-first for everything else on this origin: online users always
 *    get the freshest files (so a new deploy is never mixed with old JS),
 *    and offline users fall back to the last copy that was saved.
 *  - NEVER touches API calls: anything cross-origin (your Render backend),
 *    anything under /api/, and every non-GET request goes straight to the
 *    network. Sales, stock and money data are never cached or replayed here.
 *  - Updates are user-controlled. A new worker waits until the cashier taps
 *    "Refresh now", so a page never reloads in the middle of a sale.
 *
 * On every deploy that changes any file, bump VERSION below.
 */
const VERSION = 'v1.0.0';
const CACHE = `kenya-pos-${VERSION}`;
const NETWORK_TIMEOUT_MS = 3500;
const OFFLINE_URL = 'offline.html';

// Missing files are skipped (allSettled), so listing a page that does not
// exist yet is harmless.
const PRECACHE = [
  'offline.html',
  'manifest.webmanifest',
  'index.html',
  'login.html',
  'register.html',
  'dashboard.html',
  'sales.html',
  'products.html',
  'inventory.html',
  'customers.html',
  'branches.html',
  'employees.html',
  'suppliers.html',
  'purchases.html',
  'expenses.html',
  'refunds.html',
  'reports.html',
  'audit-logs.html',
  'settings.html',

  'css/variables.css',
  'css/base.css',
  'css/components.css',
  'css/layout.css',
  'css/reports.css',

  'js/core/config.js',
  'js/core/icons.js',
  'js/core/storage.js',
  'js/core/api.js',
  'js/core/permissions.js',
  'js/core/ui.js',
  'js/core/notification-types.js',
  'js/core/notifications.js',
  'js/core/app-shell.js',
  'js/core/charts.js',
  'js/core/report-tools.js',
  'js/core/product-picker.js',
  'js/core/customer-picker.js',
  'js/core/receipt-view.js',
  'js/core/pwa.js',

  'js/pages/dashboard.js',
  'js/pages/login.js',
  'js/pages/register.js',
  'js/pages/sales.js',
  'js/pages/products.js',
  'js/pages/inventory.js',
  'js/pages/customers.js',
  'js/pages/branches.js',
  'js/pages/employees.js',
  'js/pages/suppliers.js',
  'js/pages/purchases.js',
  'js/pages/expenses.js',
  'js/pages/refunds.js',
  'js/pages/reports.js',
  'js/pages/audit-logs.js',

  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png',
  'icons/favicon-32.png',
];

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */
const scopeUrl = (path) => new URL(path, self.registration.scope).toString();

/**
 * A redirected response cannot be used to answer a navigation request, so
 * (e.g. when the host redirects /dashboard.html -> /dashboard) copy the
 * body into a clean, non-redirected Response before caching it.
 */
async function cleanResponse(res) {
  if (!res.redirected) return res;
  const body = await res.blob();
  return new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers });
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); }
    );
  });
}

/** Looks up a cached copy, trying the common URL spellings of the same page. */
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

/* ------------------------------------------------------------------ *
 * Install: pre-cache the shell. Does NOT skipWaiting on its own; the page
 * decides when to switch (see SKIP_WAITING message below).
 * ------------------------------------------------------------------ */
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
    await Promise.all(
      keys.filter((k) => k.startsWith('kenya-pos-') && k !== CACHE).map((k) => caches.delete(k))
    );
    if (self.registration.navigationPreload) {
      try { await self.registration.navigationPreload.disable(); } catch (e) { /* ignore */ }
    }
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  const type = event.data && event.data.type;
  if (type === 'SKIP_WAITING') self.skipWaiting();
  if (type === 'GET_VERSION' && event.ports && event.ports[0]) event.ports[0].postMessage({ version: VERSION });
});

/* ------------------------------------------------------------------ *
 * Fetch strategies
 * ------------------------------------------------------------------ */
async function networkFirst(event, isNavigation) {
  const request = event.request;
  const cache = await caches.open(CACHE);

  const networkPromise = fetch(request).then((res) => {
    if (res && res.ok && res.type === 'basic') {
      const copy = res.clone();
      cleanResponse(copy).then((clean) => cache.put(request, clean)).catch(() => {});
    }
    return res;
  });
  // Keep the worker alive so the cache refresh finishes even after a timeout.
  event.waitUntil(networkPromise.catch(() => {}));

  try {
    return await withTimeout(networkPromise, NETWORK_TIMEOUT_MS);
  } catch (err) {
    const cached = await matchCached(cache, request);
    if (cached) return cached;

    // Slow network and nothing saved yet: keep waiting for the real response.
    if (err && err.message === 'timeout') {
      try { return await networkPromise; } catch (e) { /* fall through */ }
    }
    if (isNavigation) {
      const offline = await cache.match(scopeUrl(OFFLINE_URL));
      if (offline) return offline;
    }
    return new Response('Offline', { status: 503, statusText: 'Offline', headers: { 'Content-Type': 'text/plain' } });
  }
}

async function cacheFirst(event) {
  const request = event.request;
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request, { ignoreSearch: true });
  if (cached) return cached;
  try {
    const res = await fetch(request);
    if (res && res.ok && res.type === 'basic') cache.put(request, res.clone()).catch(() => {});
    return res;
  } catch (e) {
    return new Response('', { status: 504, statusText: 'Offline' });
  }
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;                       // never touch writes
  if (req.headers.has('range')) return;                   // let the browser stream media
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;        // backend API lives elsewhere
  if (url.pathname.startsWith('/api/')) return;           // same-origin API, just in case
  if (url.pathname.endsWith('/sw.js')) return;

  if (req.mode === 'navigate') {
    event.respondWith(networkFirst(event, true));
    return;
  }
  if (/\.(?:png|jpg|jpeg|gif|webp|svg|ico|woff2?|ttf)$/i.test(url.pathname)) {
    event.respondWith(cacheFirst(event));
    return;
  }
  event.respondWith(networkFirst(event, false));
});