/**
 * register.js
 * Owner-only signup flow. On success the backend returns tokens immediately
 * (no separate "verify your email" step in Phase 1), so we log the owner
 * straight into the dashboard rather than bouncing them back to login.html.
 */
(function () {
  document.addEventListener('DOMContentLoaded', init);

  function init() {
    if (window.Storage.isAuthenticated()) {
      window.location.replace('dashboard.html');
      return;
    }

    document.getElementById('logo-mark').innerHTML = window.Icons.get('store');
    document.getElementById('app-name').textContent = window.APP_CONFIG.APP_NAME;

    setupForm();
  }

  function setupForm() {
    const form = document.getElementById('register-form');
    const btn = document.getElementById('register-btn');

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearAlert();
      window.UI.applyFormErrors(form, []);

      const payload = window.UI.serializeForm(form);

      if (payload.password !== payload.confirmPassword) {
        window.UI.applyFormErrors(form, [{ field: 'confirmPassword', message: 'Passwords do not match' }]);
        return;
      }
      if (!payload.agree) {
        showAlert('Please confirm you agree to be responsible for this account.');
        return;
      }

      // confirmPassword/agree only exist for client-side UX - the backend
      // schema is strict and would reject unknown fields.
      delete payload.confirmPassword;
      delete payload.agree;

      window.UI.setButtonLoading(btn, true, 'Creating your business…');

      try {
        const registerRes = await window.Api.post('/auth/register', payload);

        // Register doesn't return tokens itself (it's a business-creation
        // endpoint) - immediately log in with the same credentials so the
        // owner lands straight in the dashboard.
        const loginRes = await window.Api.post('/auth/login', {
          identifier: payload.phone,
          password: payload.password,
        });

        window.Storage.setTokens({ accessToken: loginRes.data.accessToken, refreshToken: loginRes.data.refreshToken });
        window.Storage.setUser(loginRes.data.user);

        window.UI.toast.success(`Welcome, ${registerRes.data.user.name.split(' ')[0]}! Your shop is ready.`);
        window.location.href = 'dashboard.html';
      } catch (err) {
        if (err.code === 'VALIDATION_ERROR' && err.errors?.length) {
          window.UI.applyFormErrors(form, err.errors);
        }
        showAlert(err.message || 'Could not create your account. Please try again.');
      } finally {
        window.UI.setButtonLoading(btn, false);
      }
    });
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
