/**
 * api.js
 * Thin fetch wrapper around the backend's standard response shape:
 *   { success, message, data, code, errors }
 *
 * - Attaches the Bearer access token automatically.
 * - On a 401 with code UNAUTHENTICATED/expired token, transparently tries
 *   ONE refresh (single-flight - concurrent 401s share the same refresh
 *   call) and retries the original request once.
 * - Throws ApiError so callers can do: catch (err) { err.message, err.code, err.errors, err.data }
 *
 * Usage:
 *   const { data } = await Api.get('/branches', { page: 1 });
 *   const { data } = await Api.post('/branches', { name, code });
 */
(function (window) {
  class ApiError extends Error {
    constructor(message, { code, status, errors, data } = {}) {
      super(message);
      this.name = 'ApiError';
      this.code = code || 'ERROR';
      this.status = status;
      this.errors = errors || [];
      // Carries any `data` payload the backend attached to an error response
      // (e.g. mpesa.controller.js's { failureType } on a send-time STK
      // failure) so callers can branch on it without re-parsing anything.
      this.data = data || null;
    }
  }

  let refreshPromise = null; // single-flight guard

  function buildUrl(path, query) {
    const url = new URL(window.APP_CONFIG.API_BASE_URL + path);
    if (query) {
      Object.entries(query).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
          url.searchParams.set(key, value);
        }
      });
    }
    return url.toString();
  }

  async function refreshAccessToken() {
    const refreshToken = window.Storage.getRefreshToken();
    if (!refreshToken) throw new ApiError('No refresh token available', { code: 'NO_REFRESH_TOKEN' });

    const res = await fetch(`${window.APP_CONFIG.API_BASE_URL}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    const body = await res.json().catch(() => ({}));

    if (!res.ok || !body.success) {
      throw new ApiError(body.message || 'Session expired', { code: body.code, status: res.status });
    }

    window.Storage.setTokens(body.data);
    return body.data.accessToken;
  }

  async function request(method, path, { body, query, isRetry, headers: extraHeaders } = {}) {
    const headers = { 'Content-Type': 'application/json', ...extraHeaders };
    const token = window.Storage.getAccessToken();
    if (token) headers.Authorization = `Bearer ${token}`;

    let res;
    try {
      res = await fetch(buildUrl(path, query), {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch (networkErr) {
      throw new ApiError('Could not reach the server. Check your connection.', { code: 'NETWORK_ERROR' });
    }

    let payload;
    try {
      payload = await res.json();
    } catch {
      payload = {};
    }

    // Token expired/invalid - try ONE silent refresh-and-retry.
    if (res.status === 401 && !isRetry && window.Storage.getRefreshToken()) {
      try {
        if (!refreshPromise) refreshPromise = refreshAccessToken().finally(() => { refreshPromise = null; });
        await refreshPromise;
        return request(method, path, { body, query, isRetry: true, headers: extraHeaders });
      } catch {
        window.Storage.clearSession();
        if (!window.location.pathname.endsWith('login.html')) {
          window.location.href = 'login.html?sessionExpired=1';
        }
        throw new ApiError('Session expired, please log in again', { code: 'SESSION_EXPIRED', status: 401 });
      }
    }

    if (!res.ok || payload.success === false) {
      throw new ApiError(payload.message || `Request failed (${res.status})`, {
        code: payload.code,
        status: res.status,
        errors: payload.errors,
        data: payload.data,
      });
    }

    return payload; // { success, message, data }
  }

  /** Generates a random key suitable for the Idempotency-Key header (one per logical "attempt", reused across retries of the SAME attempt). */
  function newIdempotencyKey() {
    return (window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`);
  }

  window.Api = {
    ApiError,
    newIdempotencyKey,
    get: (path, query) => request('GET', path, { query }),
    post: (path, body, opts) => request('POST', path, { body, headers: opts?.idempotencyKey ? { 'Idempotency-Key': opts.idempotencyKey } : undefined }),
    put: (path, body) => request('PUT', path, { body }),
    patch: (path, body) => request('PATCH', path, { body }),
    delete: (path) => request('DELETE', path),
  };
})(window);