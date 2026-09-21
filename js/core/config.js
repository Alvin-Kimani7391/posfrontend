/**
 * config.js
 * Single place that decides which backend the frontend talks to.
 * Edit PRODUCTION_API_URL once you have your Render URL - nothing else
 * in the codebase should hard-code an API URL.
 */
/**
 * config.js
 */
(function (window) {
  const PRODUCTION_API_URL = 'https://posbackend-5jaq.onrender.com/api/v1';

  window.APP_CONFIG = Object.freeze({
    // Always talk to Render backend, or switch dynamically if needed
    API_BASE_URL: PRODUCTION_API_URL,
    APP_NAME: 'Kenya POS',
    CURRENCY: 'KES',
    TOKEN_REFRESH_SKEW_MINUTES: 2,
  });
})(window);