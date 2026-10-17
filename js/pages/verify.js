/**
 * verify.js - receipt verification page.
 *   verify.html?t=<token>   opened by scanning the QR printed on a receipt / invoice
 *   verify.html             staff scan a receipt's QR with the camera (or type the receipt number)
 * Staff sign in with the SAME credentials as the POS (email/phone + password, or employee code + PIN). If they are
 * already signed in to the POS on this device, they go straight through. The server decides: GENUINE or FAKE.
 */
(function (window) {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const esc = (s) => window.UI.escapeHtml(String(s == null ? '' : s));
  const TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;
  const BUSINESS_ID_RE = /^[a-f0-9]{24}$/i;
  const pending = { token: new URLSearchParams(location.search).get('t') || '' };

  const money = (n, cur) => window.UI.formatMoney(Number(n) || 0, cur === 'TZS' ? 'TZS' : 'KES');
  const loggedIn = () => !!window.Storage.getAccessToken();
  const show = (id, on) => $(id).classList.toggle('hidden', !on);

  function view(state) { // 'login' | 'scan' | 'loading'
    show('vf-loading', state === 'loading');
    show('vf-login', state === 'login');
    show('vf-scan', state === 'scan');
    renderSession();
  }

  function renderSession() {
    const el = $('vf-session'); const u = window.Storage.getUser();
    if (!loggedIn() || !u) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    el.innerHTML = `<span>${esc(u.name || 'Signed in')}</span><a class="btn btn-ghost btn-sm" href="dashboard.html">POS</a><button class="btn btn-ghost btn-sm" id="vf-out" type="button">Sign out</button>`;
    $('vf-out').addEventListener('click', async () => {
      try { await window.Api.post('/auth/logout', undefined, { background: true }); } catch { /* clear locally anyway */ }
      window.Storage.clearSession();
      view('login');
    });
  }

  /* ------------------------------ sign in ------------------------------ */
  function loginAlert(msg) { $('vf-login-alert').innerHTML = msg ? `<div class="form-alert form-alert-error"><span>${esc(msg)}</span></div>` : ''; }
  function onLogin(data) {
    window.Storage.setTokens({ accessToken: data.accessToken, refreshToken: data.refreshToken });
    window.Storage.setUser(data.user);
    loginAlert('');
    start();
  }
  function setupLogin() {
    document.querySelectorAll('#vf-login .tab-btn').forEach((b) => b.addEventListener('click', () => {
      document.querySelectorAll('#vf-login .tab-btn').forEach((x) => x.classList.toggle('active', x === b));
      show('vf-pw-form', b.dataset.tab === 'password'); show('vf-pin-form', b.dataset.tab === 'pin'); loginAlert('');
    }));
    $('vf-pw-form').addEventListener('submit', async (e) => {
      e.preventDefault(); loginAlert('');
      const body = { identifier: $('vf-identifier').value.trim(), password: $('vf-password').value };
      if (!body.identifier || !body.password) return loginAlert('Enter your email/phone and password.');
      window.UI.setButtonLoading($('vf-pw-btn'), true, 'Signing in…');
      try { onLogin((await window.Api.post('/auth/login', body, { background: true })).data); }
      catch (err) { loginAlert(err.message || 'Could not sign in.'); }
      finally { window.UI.setButtonLoading($('vf-pw-btn'), false); }
    });
    $('vf-pin-form').addEventListener('submit', async (e) => {
      e.preventDefault(); loginAlert('');
      const body = { businessId: $('vf-biz').value.trim(), employeeCode: $('vf-code').value.trim(), pin: $('vf-pin').value };
      if (!BUSINESS_ID_RE.test(body.businessId)) return loginAlert('That Business ID does not look right (24 letters/numbers).');
      if (!body.employeeCode || !body.pin) return loginAlert('Enter your employee code and PIN.');
      window.UI.setButtonLoading($('vf-pin-btn'), true, 'Signing in…');
      try {
        const { data } = await window.Api.post('/auth/pin-login', body, { background: true });
        try { localStorage.setItem('pos.rememberedBusinessId', body.businessId); } catch { /* ignore */ }
        onLogin(data);
      } catch (err) { loginAlert(err.message || 'Could not sign in.'); }
      finally { window.UI.setButtonLoading($('vf-pin-btn'), false); }
    });
    try { const r = localStorage.getItem('pos.rememberedBusinessId'); if (r) $('vf-biz').value = r; } catch { /* ignore */ }
    if (window.PasswordToggle) window.PasswordToggle.init();
  }

  /* ------------------------------ verify ------------------------------ */
  /** A scanned QR is normally our link (…verify?t=TOKEN). Anything else is sent as-is: the server answers FAKE. */
  function tokenFromScan(text) {
    const raw = String(text || '').trim();
    try { const t = new URL(raw).searchParams.get('t'); if (t) return t; } catch { /* not a URL */ }
    return TOKEN_RE.test(raw) ? raw : raw.slice(0, 120) || 'unreadable';
  }

  async function check(input) {
    view('loading');
    try {
      const { data } = await window.Api.post('/receipts/verify', input, { background: true });
      view('scan');
      showResult(data);
    } catch (err) {
      if (err.code === 'SESSION_EXPIRED' || err.status === 401) { pending.token = input.token || pending.token; view('login'); loginAlert('Your session expired. Please sign in again.'); return; }
      view('scan');
      showError(err);
    }
  }

  function showError(err) {
    const offline = err.code === 'NETWORK_ERROR';
    window.UI.toast.error(offline ? 'No internet connection. A receipt can only be verified while online.' : (err.message || 'Could not verify the receipt.'));
  }

  const WARN_TEXT = {
    PARTLY_REFUNDED: 'Part of this sale has been refunded.',
    UNPAID_BALANCE: 'This sale is NOT fully paid - a balance is still owed.',
    PENDING_REVIEW: 'This offline sale is still under review by management.',
  };

  function showResult(data) {
    const root = $('vf-result-root'); const r = data.receipt || {};
    let cls = 'vf-ok'; let mark = '✓'; let title = 'RECEIPT CONFIRMED'; let sub = 'Legit - this receipt matches a real sale in your system.';
    if (data.verdict === 'FAKE') { cls = 'vf-bad'; mark = '✕'; title = 'FAKE RECEIPT'; sub = data.typed ? 'No sale matches that receipt number.' : 'This QR code matches no sale in your system. Do NOT release the goods.'; }
    else if (data.status === 'CANCELLED') { cls = 'vf-bad'; mark = '✕'; title = 'SALE CANCELLED'; sub = 'This sale was cancelled - the receipt is no longer valid. Do NOT release the goods.'; }
    else if (data.status === 'REFUNDED') { cls = 'vf-bad'; mark = '!'; title = 'FULLY REFUNDED'; sub = 'The whole sale was refunded. Do NOT release the goods.'; }
    else if (data.status === 'PARTLY_REFUNDED' || data.status === 'UNPAID_BALANCE') { cls = 'vf-warn'; mark = '!'; title = 'RECEIPT CONFIRMED'; sub = 'The receipt is real, but read the notices below.'; }

    const alerts = [];
    (data.warnings || []).forEach((w) => { if (WARN_TEXT[w]) alerts.push(`<div class="vf-alert warn">${esc(WARN_TEXT[w])}</div>`); });
    if (data.verdict !== 'FAKE' && data.scan && data.scan.previousCount > 0) {
      alerts.push(`<div class="vf-alert warn"><strong>Already checked ${esc(data.scan.previousCount)} time${data.scan.previousCount === 1 ? '' : 's'} before</strong>${data.scan.lastScannedAt ? ` (last: ${esc(window.UI.formatDateTime(data.scan.lastScannedAt))})` : ''}. If this customer is collecting goods again, the receipt may be re-used.</div>`);
    }

    let details = '';
    if (data.verdict !== 'FAKE') {
      const cur = r.currency;
      details = `
        <div class="vf-card"><dl class="vf-kv">
          <dt>Receipt no.</dt><dd>${esc(r.receiptNumber)}</dd>
          ${r.invoiceNumber ? `<dt>Invoice no.</dt><dd>${esc(r.invoiceNumber)}</dd>` : ''}
          <dt>Time of sale</dt><dd>${esc(window.UI.formatDateTime(r.soldAt))}${r.offline ? ' <span class="text-xs text-muted">(made offline)</span>' : ''}</dd>
          <dt>Served by</dt><dd>${esc(r.cashier || '—')}</dd>
          <dt>Till</dt><dd>${esc(r.till || '—')}</dd>
          <dt>Branch</dt><dd>${esc(r.branch || '—')}</dd>
          ${r.customer ? `<dt>Customer</dt><dd>${esc(r.customer)}</dd>` : ''}
          ${r.saleStatus === 'CANCELLED' && r.cancelReason ? `<dt>Cancelled</dt><dd>${esc(r.cancelReason)}</dd>` : ''}
        </dl></div>
        <div class="vf-card"><h2>Products</h2>
          <table class="vf-items"><thead><tr><th>Item</th><th class="r">Qty</th><th class="r">Amount</th></tr></thead><tbody>
          ${(r.items || []).map((i) => `<tr><td>${esc(i.name)}<div class="text-xs text-muted">@ ${esc(money(i.unitPrice, cur))}</div></td><td class="r">${esc(i.quantity)}</td><td class="r">${esc(money(i.total, cur))}</td></tr>`).join('')}
          </tbody></table>
          <div style="margin-top:var(--space-3)">
            ${r.tax ? `<div class="vf-sum"><span>VAT / tax</span><span>${esc(money(r.tax, cur))}</span></div>` : ''}
            <div class="vf-sum total"><span>Total</span><span>${esc(money(r.total, cur))}</span></div>
            ${(r.payments || []).map((p) => `<div class="vf-sum"><span>Paid by ${esc(String(p.method || '').replace('_', ' ').toLowerCase())}</span><span>${esc(money(p.amount, cur))}</span></div>`).join('')}
            ${Number(r.balance) > 0 ? `<div class="vf-sum" style="color:var(--color-danger);font-weight:600"><span>Balance owed</span><span>${esc(money(r.balance, cur))}</span></div>` : ''}
          </div>
        </div>`;
    }
    root.innerHTML = `
      <div class="vf-result ${cls}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
        <div class="vf-banner"><div class="vf-mark" aria-hidden="true">${mark}</div><h2>${esc(title)}</h2><p>${esc(sub)}</p></div>
        <div class="vf-body-wrap">${alerts.join('')}${details}</div>
        <div class="vf-foot"><button class="btn btn-primary" id="vf-next" type="button">Scan next receipt</button><button class="btn btn-secondary" id="vf-close" type="button">Close</button></div>
      </div>`;
    document.body.style.overflow = 'hidden';
    const close = () => { root.innerHTML = ''; document.body.style.overflow = ''; };
    $('vf-close').addEventListener('click', close);
    $('vf-next').addEventListener('click', () => { close(); scan(); });
  }

  function scan() {
    if (!window.BarcodeScanner) return window.UI.toast.error('Scanner not available.');
    window.BarcodeScanner.openCameraModal({ title: 'Scan receipt QR', qr: true, onDetect: (text) => check({ token: tokenFromScan(text) }) });
  }

  function setupScan() {
    $('vf-scan-btn').addEventListener('click', scan);
    $('vf-manual-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const v = $('vf-manual').value.trim();
      if (!v) return;
      check({ receiptNumber: v });
    });
  }

  function start() {
    if (!loggedIn()) { view('login'); return; }
    view('scan');
    if (pending.token) { const t = pending.token; pending.token = ''; history.replaceState(null, '', location.pathname); check({ token: tokenFromScan(t) }); }
  }

  document.addEventListener('DOMContentLoaded', () => {
    setupLogin(); setupScan(); start();
  });
})(window);
