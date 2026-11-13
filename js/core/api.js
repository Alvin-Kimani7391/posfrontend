/**
 * api.js  (offline-aware)
 * Thin fetch wrapper around the backend's standard response shape:
 *   { success, message, data, code, errors }
 *
 * CHANGES FOR OFFLINE MODE
 *  - A failed token refresh caused by NO NETWORK no longer clears the session. Before, an expired
 *    access token + no internet logged the cashier out mid-shift.
 *  - Only a real "refresh token rejected" answer (401/403 from the server) ends the session.
 *  - Every call has a timeout (default 30 s), so a hung connection can never freeze the till.
 *  - opts.background = true: used by the sync engine. A dead session NEVER redirects to the login
 *    page (that would yank a cashier out of a sale); it throws SESSION_EXPIRED instead.
 *  - opts.headers: extra headers (e.g. X-Device-Secret for /sync and /devices calls).
 *  - Reports network success/failure to window.Connectivity (if loaded).
 *
 * Usage:
 *   const { data } = await Api.get('/branches', { page: 1 });
 *   const { data } = await Api.post('/sync/push', body, { headers: {...}, background: true });
 */
(function (window) {
  class ApiError extends Error {
    constructor(message, { code, status, errors, data } = {}) {
      super(message);
      this.name = 'ApiError';
      this.code = code || 'ERROR';
      this.status = status;
      this.errors = errors || [];
      this.data = data || null;
    }
  }

  const DEFAULT_TIMEOUT_MS = 30000;
  let refreshPromise = null; // single-flight guard

  function buildUrl(path, query) {
    const url = new URL(window.APP_CONFIG.API_BASE_URL + path);
    if (query) {
      Object.entries(query).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, value);
      });
    }
    return url.toString();
  }

  const conn = () => window.Connectivity;

  /** The screen language (en / sw) chosen by the person - sent on every call so receipts, notifications and error messages follow it. */
  function langHeader() {
    try { const l = localStorage.getItem('pos.lang'); return l === 'en' || l === 'sw' ? { 'X-Lang': l } : {}; } catch { return {}; }
  }

  function networkError() {
    // Only say "You're offline" when the browser AND the server check agree (the browser alone is often wrong).
    const deviceOffline = typeof window.navigator !== 'undefined' && window.navigator.onLine === false && !(window.Connectivity && window.Connectivity.isOnline && window.Connectivity.isOnline());
    return new ApiError(
      deviceOffline ? "You're offline. Reconnect to the internet and try again." : 'Could not reach the server. Check your connection.',
      { code: 'NETWORK_ERROR' }
    );
  }

  /** fetch with a timeout. Any failure to get an HTTP answer becomes a NETWORK_ERROR. */
  async function timedFetch(url, init, timeoutMs) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs || DEFAULT_TIMEOUT_MS);
    try {
      const res = await fetch(url, { ...init, signal: ctrl.signal });
      conn()?.reportSuccess?.();
      return res;
    } catch (e) {
      conn()?.reportFailure?.();
      throw networkError();
    } finally {
      clearTimeout(timer);
    }
  }

  async function refreshAccessToken() {
    const refreshToken = window.Storage.getRefreshToken();
    if (!refreshToken) throw new ApiError('No refresh token available', { code: 'NO_REFRESH_TOKEN', status: 401 });

    const res = await timedFetch(`${window.APP_CONFIG.API_BASE_URL}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...langHeader() },
      body: JSON.stringify({ refreshToken }),
    }, 15000);
    const body = await res.json().catch(() => ({}));

    if (!res.ok || !body.success) {
      throw new ApiError(body.message || 'Session expired', { code: body.code, status: res.status });
    }
    window.Storage.setTokens(body.data);
    return body.data.accessToken;
  }

  /** The session is only dead when the SERVER says the refresh token is bad. Network trouble or a 5xx is not that. */
  const sessionIsDead = (err) => err && err.code !== 'NETWORK_ERROR' && (err.status === 401 || err.status === 403 || err.code === 'NO_REFRESH_TOKEN');

  function endSession() {
    window.Storage.clearSession();
    if (!window.location.pathname.endsWith('login.html')) {
      window.location.href = window.location.pathname.includes('admin-') ? 'admin-login.html?sessionExpired=1' : 'login.html?sessionExpired=1';
    }
  }

  async function request(method, path, { body, formData, query, isRetry, headers: extraHeaders, background, timeoutMs } = {}) {
    const headers = { ...langHeader(), ...extraHeaders };
    if (!formData) headers['Content-Type'] = 'application/json';
    const token = window.Storage.getAccessToken();
    if (token) headers.Authorization = `Bearer ${token}`;

    const res = await timedFetch(buildUrl(path, query), {
      method,
      headers,
      body: formData || (body !== undefined ? JSON.stringify(body) : undefined),
    }, timeoutMs);

    let payload;
    try { payload = await res.json(); } catch { payload = {}; }

    if (res.status === 401 && !isRetry && window.Storage.getRefreshToken()) {
      try {
        if (!refreshPromise) refreshPromise = refreshAccessToken().finally(() => { refreshPromise = null; });
        await refreshPromise;
        return request(method, path, { body, formData, query, isRetry: true, headers: extraHeaders, background, timeoutMs });
      } catch (err) {
        if (!sessionIsDead(err)) throw err; // offline / server hiccup: keep the session, let the caller cope
        if (background) throw new ApiError('Session expired, please sign in again', { code: 'SESSION_EXPIRED', status: 401 });
        endSession();
        throw new ApiError('Session expired, please log in again', { code: 'SESSION_EXPIRED', status: 401 });
      }
    }

    // Locked for non-payment: send the user to the one page that still works (Billing).
    // NOTE: with cleanUrls the page path is "/billing" (no ".html"), so match both forms - otherwise the
    // Billing page redirects to itself forever (the screen "blinks") and the owner can never pay.
    if (res.status === 402 && payload.code === 'SUBSCRIPTION_LOCKED' && !background) {
      const p = window.location.pathname.replace(/\/+$/, '');
      const onBilling = /(^|\/)billing(\.html)?$/.test(p);
      const onExempt = onBilling || p.includes('admin-') || /(^|\/)(login|register|verify)(\.html)?$/.test(p);
      let recent = false;
      try { // loop guard: never auto-redirect more than once every 10s
        const last = Number(sessionStorage.getItem('pos.lockRedirectAt') || 0);
        recent = Date.now() - last < 10000;
        if (!onExempt && !recent) sessionStorage.setItem('pos.lockRedirectAt', String(Date.now()));
      } catch { /* storage blocked */ }
      // Pages in a sub-folder (/hardware/, /restaurant/) must go to the ROOT billing page, not /hardware/billing.
      const sub = p.search(/\/(hardware|restaurant)(\/|$)/);
      const rootPrefix = sub >= 0 ? p.slice(0, sub) : '';
      if (!onExempt && !recent) window.location.replace(`${rootPrefix}${sub >= 0 ? '/' : ''}billing?locked=1`.replace(/^\/\//, '/'));
    }

    if (!res.ok || payload.success === false) {
      throw new ApiError(payload.message || `Request failed (${res.status})`, {
        code: payload.code, status: res.status, errors: payload.errors, data: payload.data,
      });
    }
    return payload;
  }

  /** Random key for the Idempotency-Key header (one per logical attempt, reused across retries of the SAME attempt). */
  function newIdempotencyKey() {
    return (window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`);
  }

  /** GET that returns the response body as TEXT (e.g. the printable invoice HTML). Sends the token, retries once after a refresh. */
  async function requestText(path, query, isRetry) {
    const headers = { ...langHeader() };
    const token = window.Storage.getAccessToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await timedFetch(buildUrl(path, query), { method: 'GET', headers }, 45000);
    if (res.status === 401 && !isRetry && window.Storage.getRefreshToken()) {
      if (!refreshPromise) refreshPromise = refreshAccessToken().finally(() => { refreshPromise = null; });
      await refreshPromise;
      return requestText(path, query, true);
    }
    const text = await res.text();
    if (!res.ok) {
      let msg = `Request failed (${res.status})`;
      try { msg = JSON.parse(text).message || msg; } catch { /* not json */ }
      throw new ApiError(msg, { status: res.status });
    }
    return text;
  }

  /* ------------------------------------------------------------------ *
   * Speed layer for reads
   *  1. The same GET asked twice at the same moment is sent ONCE (the shell and the page both ask for branches, etc.).
   *  2. Slow-changing lists (branches, categories...) are kept for this browser session: they come back instantly and
   *     are refreshed quietly in the background, so the next page already has the newest copy.
   *  3. Any change (POST / PUT / PATCH / DELETE) clears the saved copies, so you never see your own edit missing.
   * Live data (sales, stock, reports, notifications...) is never served from the saved copy.
   * ------------------------------------------------------------------ */
  const inflight = new Map();
  const SAVED_OK = /^\/(branches|categories|brands|units|suppliers|settings\/integrations\/flags|shop\/promotions\/active)(\?|$)/;
  const SAVED_MAX_AGE_MS = 10 * 60 * 1000;
  const clone = (v) => { try { return window.structuredClone ? window.structuredClone(v) : JSON.parse(JSON.stringify(v)); } catch { return v; } };
  const tokenTag = () => (window.Storage.getAccessToken() || '').slice(-12);

  function savedKey(path, query) { return `pos.api.${tokenTag() ? '' : 'x'}${buildUrl(path, query)}`; }
  function readSaved(key) {
    try { const v = JSON.parse(sessionStorage.getItem(key) || 'null'); return v && Date.now() - v.t < SAVED_MAX_AGE_MS ? v.p : null; } catch { return null; }
  }
  function writeSaved(key, payload) { try { sessionStorage.setItem(key, JSON.stringify({ t: Date.now(), p: payload })); } catch { /* storage full or blocked */ } }
  function clearSaved() {
    try {
      const dead = [];
      for (let i = 0; i < sessionStorage.length; i += 1) { const k = sessionStorage.key(i); if (k && k.startsWith('pos.api.')) dead.push(k); }
      dead.forEach((k) => sessionStorage.removeItem(k));
    } catch { /* ignore */ }
  }

  function smartGet(path, query, opts) {
    if (opts && (opts.fresh || opts.background || opts.headers)) return request('GET', path, { query, ...withOpts(opts) });
    const key = `${tokenTag()}|${buildUrl(path, query)}`;
    const sKey = SAVED_OK.test(path) ? savedKey(path, query) : null;
    if (sKey) {
      const hit = readSaved(sKey);
      if (hit) { // instant answer now, quiet refresh for next time
        if (!inflight.has(key)) {
          const bg = request('GET', path, { query, background: true }).then((r) => { writeSaved(sKey, r); return r; }).catch(() => {}).finally(() => inflight.delete(key));
          inflight.set(key, bg);
        }
        return Promise.resolve(clone(hit));
      }
    }
    if (inflight.has(key)) return inflight.get(key).then((r) => (r ? clone(r) : request('GET', path, { query, ...withOpts(opts) })));
    const p = request('GET', path, { query, ...withOpts(opts) }).then((r) => { if (sKey) writeSaved(sKey, r); return r; }).finally(() => inflight.delete(key));
    inflight.set(key, p);
    return p.then(clone);
  }

  const withOpts = (o = {}) => ({ headers: o.headers, background: o.background, timeoutMs: o.timeoutMs });

  /** Clear the saved read copies as soon as a change is sent, and again when it succeeds. */
  function clearSavedThen(promise) { clearSaved(); promise.then(clearSaved, () => {}); return promise; }

  /** Sign-out that never waits: the server call is sent in the background (keepalive survives the page change). */
  function logoutFast() {
    try {
      const token = window.Storage.getAccessToken();
      if (!token) return;
      fetch(`${window.APP_CONFIG.API_BASE_URL}/auth/logout`, {
        method: 'POST', keepalive: true,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...langHeader() },
      }).catch(() => {});
    } catch { /* ignore */ }
  }

  /** The backend sleeps when idle (hosting free tier), which makes the first screens slow. Wake it as soon as any page opens and keep it awake while the app is in use. */
  function wakeBackend() {
    try {
      const ping = () => { if (!document.hidden && navigator.onLine !== false) fetch(`${new URL(window.APP_CONFIG.API_BASE_URL).origin}/health`, { mode: 'no-cors', cache: 'no-store', keepalive: true }).catch(() => {}); };
      ping();
      setInterval(ping, 4 * 60 * 1000);
      document.addEventListener('visibilitychange', () => { if (!document.hidden) ping(); });
    } catch { /* ignore */ }
  }
  wakeBackend();

  window.Api = {
    ApiError,
    logoutFast,
    newIdempotencyKey,
    getText: requestText,
    get: (path, query, opts) => smartGet(path, query, opts),
    post: (path, body, opts) => clearSavedThen(request('POST', path, {
      body,
      ...withOpts(opts),
      headers: { ...(opts?.headers || {}), ...(opts?.idempotencyKey ? { 'Idempotency-Key': opts.idempotencyKey } : {}) },
    })),
    put: (path, body, opts) => clearSavedThen(request('PUT', path, { body, ...withOpts(opts) })),
    patch: (path, body, opts) => clearSavedThen(request('PATCH', path, { body, ...withOpts(opts) })),
    delete: (path, opts) => clearSavedThen(request('DELETE', path, withOpts(opts))),
    /** multipart upload (screenshots). `formData` is a FormData instance. */
    upload: (path, formData, method = 'POST') => clearSavedThen(request(method, path, { formData })),
  };
})(window);