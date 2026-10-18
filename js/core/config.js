/**
 * config.js - which backend the frontend talks to.
 * Order: 1) ?api=https://host/api/v1 (remembered, ?api=reset clears)  2) localStorage 'pos.apiBase'
 *        3) localhost -> http://localhost:5000/api/v1   4) PRODUCTION_API_URL
 * The backend you point at MUST include the /restaurant and /accommodation routes (redeploy the updated backend zip).
 */
(function (window) {
  const PRODUCTION_API_URL = 'https://posbackend-5jaq.onrender.com/api/v1';
  const LOCAL_API_URL = 'http://localhost:5000/api/v1';
  function pick() {
    try {
      const q = new URLSearchParams(window.location.search).get('api');
      if (q === 'reset') localStorage.removeItem('pos.apiBase');
      else if (q) localStorage.setItem('pos.apiBase', q.replace(/\/+$/, ''));
      const saved = localStorage.getItem('pos.apiBase');
      if (saved) return saved;
    } catch { /* storage blocked */ }
    const h = window.location.hostname;
    return (h === 'localhost' || h === '127.0.0.1') ? LOCAL_API_URL : PRODUCTION_API_URL;
  }
  window.APP_CONFIG = Object.freeze({
    API_BASE_URL: pick(), PRODUCTION_API_URL, APP_NAME: 'Kenya POS', CURRENCY: 'KES', TOKEN_REFRESH_SKEW_MINUTES: 2,
    PUBLIC_APP_URL: '', // public address of THIS web app (used inside QR codes); empty = the address you opened it from
  });
})(window);
