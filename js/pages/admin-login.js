/** admin-login.js - email/phone + password only. Rejects anyone who isn't SUPER_ADMIN. */
(function () {
  document.addEventListener('DOMContentLoaded', () => {
    const u = window.Storage.getUser();
    if (window.Storage.isAuthenticated() && u?.role === 'SUPER_ADMIN') { window.location.replace('admin-dashboard.html'); return; }

    document.getElementById('logo-mark').innerHTML = window.Icons.get('store');
    const form = document.getElementById('admin-login-form');
    const btn = document.getElementById('admin-login-btn');
    const slot = document.getElementById('form-alert-slot');
    const alert = (m) => { slot.innerHTML = m ? `<div class="form-alert form-alert-error">${window.Icons.get('alert')}<span>${window.UI.escapeHtml(m)}</span></div>` : ''; };

    if (new URLSearchParams(location.search).get('sessionExpired')) alert('Your session expired. Please log in again.');

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      alert('');
      const payload = window.UI.serializeForm(form);
      payload.identifier = (payload.identifier || '').trim();
      window.UI.setButtonLoading(btn, true, 'Signing in…');
      try {
        const { data } = await window.Api.post('/auth/login', payload);
        if (data.user.role !== 'SUPER_ADMIN') {
          // Tokens were never stored - a normal business user must not get in here.
          alert('This account does not have platform admin access.');
          return;
        }
        window.Storage.setTokens({ accessToken: data.accessToken, refreshToken: data.refreshToken });
        window.Storage.setUser(data.user);
        window.location.href = 'admin-dashboard.html';
      } catch (err) {
        alert(err.message || 'Could not sign in. Please try again.');
      } finally {
        window.UI.setButtonLoading(btn, false);
      }
    });
  });
})();