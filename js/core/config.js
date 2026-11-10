/**
 * config.js - which backend the frontend talks to.
 * Production site  -> https://pos-api.sixstarsuppliers.com
 * Staging site     -> https://staging-api.sixstarsuppliers.com   (ONLY when opened from staging.sixstarsuppliers.com)
 * Anything else (including *.vercel.app previews and localhost) uses PRODUCTION, exactly as before.
 * There is no ?api= override and no saved override, so nobody can be pointed at the wrong backend by accident.
 */
(function (window) {
  const PRODUCTION_API_URL = 'https://pos-api.sixstarsuppliers.com/api/v1';
  const STAGING_API_URL = 'https://staging-api.sixstarsuppliers.com/api/v1';
  const STAGING_HOST = 'staging.sixstarsuppliers.com';

  const IS_STAGING = String(window.location && window.location.hostname).toLowerCase() === STAGING_HOST;
  const API_BASE_URL = IS_STAGING ? STAGING_API_URL : PRODUCTION_API_URL;

  // Remove any backend address saved by an older version (a leftover "pos.apiBase" used to override this file).
  try { localStorage.removeItem('pos.apiBase'); } catch { /* storage blocked - fine */ }

  window.APP_CONFIG = Object.freeze({
    API_BASE_URL,
    PRODUCTION_API_URL,
    ENVIRONMENT: IS_STAGING ? 'staging' : 'production',
    IS_STAGING,
    APP_NAME: 'Kenya POS',
    CURRENCY: 'KES',
    TOKEN_REFRESH_SKEW_MINUTES: 2,
    // Public address of THIS web app, printed inside receipt QR codes (e.g. 'https://pos.example.com').
    // Leave empty to use the address the app is opened from.
    PUBLIC_APP_URL: '',
    // Google sign-in on the QR guest page. Paste your OAuth "Web application" client ID here (looks like 123-abc.apps.googleusercontent.com).
    // Leave empty to hide the Google button. The SAME id must be set as GOOGLE_CLIENT_ID on the backend.
    GOOGLE_CLIENT_ID: '',
  });

  // Staging can never be mistaken for the real thing: tab title + a red pill on every page.
  if (IS_STAGING && window.document) {
    const mark = () => {
      try {
        document.title = '[STAGING] ' + document.title.replace(/^\[STAGING\]\s*/, '');
        const b = document.createElement('div');
        b.textContent = 'STAGING - test data only';
        b.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:2147483647;background:#b42318;color:#fff;font:700 11px/1 system-ui,sans-serif;letter-spacing:.04em;padding:6px 10px;border-radius:999px;pointer-events:none;opacity:.92';
        document.body.appendChild(b);
      } catch (e) { /* cosmetic only */ }
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mark); else mark();
  }
})(window);
