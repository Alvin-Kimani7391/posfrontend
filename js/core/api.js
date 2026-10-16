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

  function networkError() {
    const deviceOffline = typeof window.navigator !== 'undefined' && window.navigator.onLine === false;
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
      headers: { 'Content-Type': 'application/json' },
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
    const headers = { ...extraHeaders };
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
    if (res.status === 402 && payload.code === 'SUBSCRIPTION_LOCKED' && !background) {
      const p = window.location.pathname;
      if (!/billing\.html$/.test(p) && !p.includes('admin-') && !/login\.html$/.test(p)) window.location.href = 'billing.html?locked=1';
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
    const headers = {};
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

  const withOpts = (o = {}) => ({ headers: o.headers, background: o.background, timeoutMs: o.timeoutMs });

  window.Api = {
    ApiError,
    newIdempotencyKey,
    getText: requestText,
    get: (path, query, opts) => request('GET', path, { query, ...withOpts(opts) }),
    post: (path, body, opts) => request('POST', path, {
      body,
      ...withOpts(opts),
      headers: { ...(opts?.headers || {}), ...(opts?.idempotencyKey ? { 'Idempotency-Key': opts.idempotencyKey } : {}) },
    }),
    put: (path, body, opts) => request('PUT', path, { body, ...withOpts(opts) }),
    patch: (path, body, opts) => request('PATCH', path, { body, ...withOpts(opts) }),
    delete: (path, opts) => request('DELETE', path, withOpts(opts)),
    /** multipart upload (screenshots). `formData` is a FormData instance. */
    upload: (path, formData, method = 'POST') => request(method, path, { formData }),
  };
})(window);