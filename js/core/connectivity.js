/**
 * connectivity.js
 * "Is the SERVER reachable?" - not just navigator.onLine (which is true on Wi-Fi with no internet).
 *
 *  - Probes <api origin>/health with a 4 s timeout.
 *  - Goes OFFLINE only after 2 failed probes in a row (or the browser's own 'offline' event), so one
 *    slow request on weak Wi-Fi never flips a till into offline mode in the middle of a sale.
 *  - Goes ONLINE on the first successful probe or any successful API response.
 *  - Probes every 60 s while online and every 8 s while offline.
 *
 *   Connectivity.isOnline()  Connectivity.check()  Connectivity.onChange(fn) -> unsubscribe
 *   Connectivity.reportSuccess() / reportFailure()   (called by api.js)
 */
(function (window) {
  'use strict';
  const subs = new Set();
  let online = window.navigator.onLine !== false;
  let failures = 0;
  let timer = null;
  let probing = null;

  function healthUrl() {
    try { return `${new URL(window.APP_CONFIG.API_BASE_URL).origin}/health`; } catch { return null; }
  }

  function set(v) {
    if (v === online) return;
    online = v;
    subs.forEach((fn) => { try { fn(online); } catch (e) { console.error(e); } });
    window.dispatchEvent(new CustomEvent('connectivitychange', { detail: { online } }));
  }

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(probe, online ? 60000 : 8000);
  }

  function probe() {
    if (probing) return probing;
    probing = (async () => {
      const url = healthUrl();
      if (!url) return online;
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 4000);
      try {
        await fetch(`${url}?t=${Date.now()}`, { cache: 'no-store', signal: ctrl.signal });
        failures = 0;
        set(true);
      } catch {
        failures += 1;
        if (failures >= 2 || window.navigator.onLine === false) set(false);
        else setTimeout(probe, 1500); // confirm quickly before declaring offline
      } finally {
        clearTimeout(t);
      }
      return online;
    })().finally(() => { probing = null; schedule(); });
    return probing;
  }

  window.addEventListener('online', () => { failures = 0; probe(); });
  window.addEventListener('offline', () => { failures = 2; set(false); schedule(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) probe(); });

  window.Connectivity = {
    isOnline: () => online,
    check: probe,
    onChange(fn) { subs.add(fn); return () => subs.delete(fn); },
    reportSuccess() { failures = 0; set(true); },
    reportFailure() { failures += 1; if (online) probe(); },
  };

  schedule();
})(window);