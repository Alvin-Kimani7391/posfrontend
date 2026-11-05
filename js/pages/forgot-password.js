/** forgot-password.js: asks the backend to email a password / PIN reset link. */
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

  let kind = new URLSearchParams(location.search).get('kind') === 'pin' ? 'pin' : 'password';

  function setKind(k) {
    kind = k;
    document.querySelectorAll('.tab-btn').forEach((t) => t.classList.toggle('active', t.dataset.kind === k));
    $('kind-hint').textContent = k === 'pin'
      ? 'Employees: use the email your manager saved on your profile. No email on file? Ask your manager to reset your PIN.'
      : 'The reset link is sent to the email saved on your account.';
    $('page-title').textContent = k === 'pin' ? 'Forgot your PIN?' : 'Forgot password?';
    alertBox('');
  }

  function init() {
    setKind(kind);
    document.querySelectorAll('.tab-btn').forEach((t) => t.addEventListener('click', () => setKind(t.dataset.kind)));
    $('again-btn').addEventListener('click', () => { $('sent').classList.add('hidden'); $('forgot-form').classList.remove('hidden'); $('identifier').focus(); });
    $('forgot-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const identifier = $('identifier').value.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier)) { alertBox('Enter a valid email address.'); $('identifier').focus(); return; }
      const btn = $('forgot-btn');
      window.UI.setButtonLoading(btn, true, 'Sending…');
      try {
        await window.Api.post('/auth/forgot-password', { identifier, kind });
        alertBox('');
        $('forgot-form').classList.add('hidden');
        $('sent').classList.remove('hidden');
      } catch (err) {
        alertBox(err.code === 'NETWORK_ERROR' ? 'No internet connection. Please try again.' : (err.message || 'Something went wrong. Please try again.'));
      } finally { window.UI.setButtonLoading(btn, false); }
    });
  }
})();
