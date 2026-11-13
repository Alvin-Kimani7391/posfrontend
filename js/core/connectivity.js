/**
 * connectivity.js  (v2 - fixes the false "You are offline" while the internet is fine)
 * "Is the SERVER reachable?" - not just navigator.onLine (which is true on Wi-Fi with no internet, and sometimes FALSE with working internet).
 *
 *  - Probes <api origin>/health with an 8 s timeout (the old 4 s was too short for a busy server / weak mobile data).
 *  - Goes OFFLINE after 2 failed probes in a row (1 if the browser also says offline). A failed sale/report request, a page change that cancels a
 *    request, or the browser's own 'offline' event NEVER flips the till offline by themselves - they only trigger a fresh probe.
 *  - If the normal probe is blocked by CORS but the server still answers (no-cors probe), the till stays ONLINE.
 *  - Goes ONLINE on the first successful probe or any successful API response.
 *  - Probes every 20 s while online and every 8 s while offline.
 *
 *   Connectivity.isOnline()  Connectivity.check()  Connectivity.onChange(fn) -> unsubscribe
 *   Connectivity.reportSuccess() / reportFailure()   (called by api.js)
 *   Connectivity.info()   -> { online, failures, lastError, lastProbeAt }   (type it in the browser console when diagnosing)
 */
(function (window) {
  'use strict';
  const PROBE_TIMEOUT_MS = 8000;
  const FAILS_TO_GO_OFFLINE = 2; // 1 when the browser ALSO says it is offline
  const subs = new Set();
  let online = true; // start optimistic: the first probe (or the first API call) corrects it
  let failures = 0;
  let timer = null;
  let probing = null;
  let lastError = '';
  let lastProbeAt = 0;

  function healthUrl() {
    try { return `${new URL(window.APP_CONFIG.API_BASE_URL).origin}/health`; } catch { return null; }
  }

  function set(v, why) {
    if (v === online) return;
    online = v;
    try { console.info('[Connectivity] ' + (v ? 'ONLINE' : 'OFFLINE') + (why ? ' - ' + why : '')); } catch (e) { /* ignore */ }
    subs.forEach((fn) => { try { fn(online); } catch (e) { console.error(e); } });
    window.dispatchEvent(new CustomEvent('connectivitychange', { detail: { online } }));
  }

  function schedule(ms) {
    clearTimeout(timer);
    timer = setTimeout(probe, ms || (online ? 20000 : 8000));
  }

  /** One attempt: true = the server answered (any HTTP status), false = could not reach it.
   *  Two requests run AT THE SAME TIME (normal + "no-cors"), so a dead connection is detected in one timeout, not two.
   *  A "no-cors" request succeeds whenever the server is reachable, even if the server's CORS list is wrong. */
  function tryOnce(url) {
    return new Promise((resolve) => {
      let pending = 2;
      const done = (ok, e) => {
        if (ok) { resolve(true); return; }
        if (e) lastError = (e.name || 'Error') + ': ' + (e.message || 'fetch failed');
        if (--pending === 0) resolve(false);
      };
      [false, true].forEach((noCors) => {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
        const opts = { cache: 'no-store', signal: ctrl.signal };
        if (noCors) opts.mode = 'no-cors';
        fetch(`${url}?t=${Date.now()}${noCors ? 'n' : ''}`, opts)
          .then(() => { clearTimeout(t); done(true); }, (e) => { clearTimeout(t); done(false, e); });
      });
    });
  }

  function probe() {
    if (probing) return probing;
    probing = (async () => {
      const url = healthUrl();
      if (!url) { schedule(); return online; }
      lastProbeAt = Date.now();
      if (await tryOnce(url)) {
        failures = 0;
        set(true, 'server answered');
        schedule();
        return online;
      }
      failures += 1;
      if (failures >= (window.navigator.onLine === false ? 1 : FAILS_TO_GO_OFFLINE)) { set(false, 'server not reachable (' + failures + ' probes failed: ' + lastError + ')'); schedule(); return online; }
      // not sure yet: confirm again shortly instead of waiting a full minute
      schedule(1000);
      return online;
    })().finally(() => { probing = null; });
    return probing;
  }

  // The browser's 'offline' event is only a HINT (it is often wrong on Android, VPNs and shared Wi-Fi): verify with the server.
  window.addEventListener('online', () => { failures = 0; probe(); });
  window.addEventListener('offline', () => { probe(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) probe(); });

  window.Connectivity = {
    isOnline: () => online,
    check: probe,
    onChange(fn) { subs.add(fn); return () => subs.delete(fn); },
    reportSuccess() { failures = 0; set(true, 'API call succeeded'); },
    // A single failed request proves nothing (timeout, cancelled by page change, one bad packet): just re-check the server.
    reportFailure() { if (online) probe(); },
    info: () => ({ online, failures, lastError, lastProbeAt: lastProbeAt ? new Date(lastProbeAt).toISOString() : null }),
  };

  schedule(2000); // first check shortly after the page opens
})(window);