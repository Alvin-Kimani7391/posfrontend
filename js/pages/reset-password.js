/** reset-password.js: sets the new password or PIN using the token from the emailed link. */
(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => window.UI.escapeHtml(String(s == null ? '' : s));
  const alertBox = (msg, ok) => {
    $('form-alert-slot').innerHTML = msg ? `<div class="form-alert ${ok ? 'form-alert-success' : 'form-alert-error'}">${window.Icons.get(ok ? 'check' : 'alert')}<span>${esc(msg)}</span></div>` : '';
  };
  function pwToggle() {
    if (window.PasswordToggle) { window.PasswordToggle.init(); return; }
    const s = document.createElement('script'); s.src = 'js/core/password-toggle.js'; s.async = true; document.head.appendChild(s);
  }
  document.addEventListener('DOMContentLoaded', () => {
    $('logo-mark').innerHTML = window.Icons.get('store');
    $('app-name').textContent = window.APP_CONFIG.APP_NAME;
    pwToggle();
    init();
  });

  const params = new URLSearchParams(location.search);
  const token = (params.get('token') || '').trim();
  const isPin = params.get('kind') === 'pin';
  const what = isPin ? 'PIN' : 'password';

  function init() {
    // Keep the token out of the address bar / history once read.
    try { history.replaceState(null, '', location.pathname + (isPin ? '?kind=pin' : '')); } catch { /* ignore */ }
    $('page-title').textContent = `Set a new ${what}`;
    $('page-sub').textContent = isPin ? 'Choose a new PIN for signing in at the till.' : 'Choose a new password for your account.';
    $('pw-fields').classList.toggle('hidden', isPin);
    $('pin-fields').classList.toggle('hidden', !isPin);
    $('done-link').href = isPin ? 'login.html?tab=pin' : 'login.html';

    if (token.length < 10) { dead('This reset link is incomplete. Open the link from your email again, or request a new one.'); return; }

    $('reset-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const a = isPin ? $('new-pin').value : $('new-password').value;
      const b = isPin ? $('confirm-pin').value : $('confirm-password').value;
      if (isPin ? !/^\d{4,8}$/.test(a) : a.length < 8) { alertBox(isPin ? 'PIN must be 4 to 8 digits.' : 'Password must be at least 8 characters.'); return; }
      if (a !== b) { alertBox(`The two ${what}s do not match.`); return; }
      const btn = $('reset-btn');
      window.UI.setButtonLoading(btn, true, 'Saving…');
      try {
        await window.Api.post('/auth/reset-password', isPin ? { token, newPin: a } : { token, newPassword: a });
        $('reset-form').classList.add('hidden');
        $('foot').classList.add('hidden');
        $('done').classList.remove('hidden');
        $('page-title').textContent = 'All set';
        $('page-sub').textContent = `Your ${what} was changed. You can now log in.`;
        alertBox('');
      } catch (err) {
        if (err.code === 'INVALID_RESET_TOKEN') dead('This reset link has expired or was already used. Request a new one.');
        else alertBox(err.code === 'NETWORK_ERROR' ? 'No internet connection. Please try again.' : (err.message || 'Something went wrong. Please try again.'));
      } finally { window.UI.setButtonLoading(btn, false); }
    });
  }

  function dead(msg) {
    alertBox(msg);
    $('reset-form').classList.add('hidden');
    $('foot').innerHTML = `<a href="forgot-password.html${isPin ? '?kind=pin' : ''}">Request a new link</a> · <a href="login.html">Back to log in</a>`;
  }
})();
