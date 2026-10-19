/**
 * config.js - which backend the frontend talks to.
 * ALWAYS the production (Render) backend. There is no localhost fallback and no ?api= override.
 * To move to a different server, change PRODUCTION_API_URL below and redeploy the frontend.
 */
(function (window) {
  const PRODUCTION_API_URL = 'https://posbackend-5jaq.onrender.com/api/v1';

  // Remove any backend address saved by an older version (a leftover "pos.apiBase" used to override this file).
  try { localStorage.removeItem('pos.apiBase'); } catch { /* storage blocked - fine */ }

  window.APP_CONFIG = Object.freeze({
    API_BASE_URL: PRODUCTION_API_URL,
    PRODUCTION_API_URL,
    APP_NAME: 'Kenya POS',
    CURRENCY: 'KES',
    TOKEN_REFRESH_SKEW_MINUTES: 2,
    // Public address of THIS web app, printed inside receipt QR codes (e.g. 'https://pos.example.com').
    // Leave empty to use the address the app is opened from.
    PUBLIC_APP_URL: '',
  });
})(window);
