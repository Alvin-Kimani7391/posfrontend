/**
 * login.js
 * Handles both login modes on login.html: email/phone+password (owner,
 * admin, manager, accountant, or any role really) and employee PIN login
 * (cashiers on a shared till). Talks to the backend only through window.Api.
 *
 * Deep link support (used by the "Copy login link" / WhatsApp message the
 * owner sends to staff):
 *   login.html?tab=pin&businessId=<24-char id>
 * opens the Employee PIN tab with the Business ID already filled in.
 */
(function () {
  const BUSINESS_ID_RE = /^[a-f0-9]{24}$/i; // Mongo ObjectId
  const REMEMBERED_KEY = 'pos.lastBusinessId';

  document.addEventListener('DOMContentLoaded', init);

  function init() {
    // If already logged in, skip straight to the dashboard.
    if (window.Storage.isAuthenticated()) {
      window.location.replace('dashboard.html');
      return;
    }

    document.getElementById('logo-mark').innerHTML = window.Icons.get('store');
    document.getElementById('app-name').textContent = window.APP_CONFIG.APP_NAME;

    setupTabs();
    setupPasswordForm();
    setupPinForm();
    applyDeepLink();
    showSessionExpiredNoticeIfAny();
  }

  /* ---- Tabs: password vs PIN login ---- */
  function activateTab(name) {
    const tabs = document.querySelectorAll('.tab-btn');
    const passwordForm = document.getElementById('password-login-form');
    const pinForm = document.getElementById('pin-login-form');

    tabs.forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
    clearAlert();

    if (name === 'pin') {
      pinForm.classList.remove('hidden');
      passwordForm.classList.add('hidden');
    } else {
      passwordForm.classList.remove('hidden');
      pinForm.classList.add('hidden');
    }
  }

  function setupTabs() {
    document.querySelectorAll('.tab-btn').forEach((tab) => {
      tab.addEventListener('click', () => activateTab(tab.dataset.tab));
    });
  }

  /* ---- Deep link + remembered business id ---- */
  function readRemembered() {
    try { return localStorage.getItem(REMEMBERED_KEY) || ''; } catch { return ''; }
  }

  function remember(businessId) {
    try { localStorage.setItem(REMEMBERED_KEY, businessId); } catch { /* private mode etc. */ }
  }

  function applyDeepLink() {
    const params = new URLSearchParams(window.location.search);
    const linkedBusinessId = (params.get('businessId') || '').trim();
    const input = document.getElementById('pin-business-id');

    // Link value wins over the value remembered on this device.
    const prefill = linkedBusinessId || readRemembered();
    if (input && prefill) input.value = prefill;

    if (params.get('tab') === 'pin' || linkedBusinessId) {
      activateTab('pin');
      // Business ID is done - put the cursor where the employee has to type.
      const codeInput = document.getElementById('employee-code');
      if (codeInput && input && input.value) codeInput.focus();
    }
  }

  function trimValues(obj) {
    const out = {};
    Object.keys(obj).forEach((k) => {
      out[k] = typeof obj[k] === 'string' ? obj[k].trim() : obj[k];
    });
    return out;
  }

  /* ---- Password login ---- */
  function setupPasswordForm() {
    const form = document.getElementById('password-login-form');
    const btn = document.getElementById('password-login-btn');

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearAlert();
      window.UI.applyFormErrors(form, []);

      const payload = window.UI.serializeForm(form);
      // Only trim the identifier - passwords may legitimately contain spaces.
      if (typeof payload.identifier === 'string') payload.identifier = payload.identifier.trim();
      window.UI.setButtonLoading(btn, true, 'Signing in…');

      try {
        const { data } = await window.Api.post('/auth/login', payload);
        onLoginSuccess(data);
      } catch (err) {
        handleLoginError(err, form);
      } finally {
        window.UI.setButtonLoading(btn, false);
      }
    });
  }

  /* ---- Employee PIN login ---- */
  function setupPinForm() {
    const form = document.getElementById('pin-login-form');
    const btn = document.getElementById('pin-login-btn');

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearAlert();
      window.UI.applyFormErrors(form, []);

      const payload = trimValues(window.UI.serializeForm(form));

      // Catch typos / partial pastes before hitting the server.
      if (!BUSINESS_ID_RE.test(payload.businessId || '')) {
        showAlert('That Business ID doesn\u2019t look right. It is 24 letters/numbers - ask your manager to copy it from the Employees page.');
        document.getElementById('pin-business-id').focus();
        return;
      }

      window.UI.setButtonLoading(btn, true, 'Signing in…');

      try {
        const { data } = await window.Api.post('/auth/pin-login', payload);
        // Remember the business ID on this device so cashiers don't have to
        // re-type it every shift (it's not a secret - just a lookup key).
        remember(payload.businessId);
        onLoginSuccess(data);
      } catch (err) {
        handleLoginError(err, form);
      } finally {
        window.UI.setButtonLoading(btn, false);
      }
    });
  }

  function onLoginSuccess(data) {
    window.Storage.setTokens({ accessToken: data.accessToken, refreshToken: data.refreshToken });
    window.Storage.setUser(data.user);
    window.location.href = 'dashboard.html';
  }

  function handleLoginError(err, form) {
    if (err.code === 'VALIDATION_ERROR' && err.errors?.length) {
      window.UI.applyFormErrors(form, err.errors);
    }
    showAlert(err.message || 'Something went wrong. Please try again.');
  }

  function showSessionExpiredNoticeIfAny() {
    const params = new URLSearchParams(window.location.search);
    if (params.get('sessionExpired')) {
      showAlert('Your session expired. Please log in again.');
    }
  }

  function showAlert(message) {
    const slot = document.getElementById('form-alert-slot');
    slot.innerHTML = `
      <div class="form-alert form-alert-error">
        ${window.Icons.get('alert')}
        <span>${window.UI.escapeHtml(message)}</span>
      </div>
    `;
  }

  function clearAlert() {
    document.getElementById('form-alert-slot').innerHTML = '';
  }
})();