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
  const svg = (d, w = 18) => `<svg width="${w}" height="${w}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const ICON = {
    check: svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>', 34),
    cross: svg('<path d="M6 6l12 12M18 6L6 18"/>', 34),
    bang: svg('<path d="M12 6v7"/><path d="M12 17.5v.01"/>', 34),
    alert: svg('<circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16.5v.01"/>', 18),
    shield: svg('<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/>', 14),
  };
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
    const ini = String(u.name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
    el.innerHTML = `<div class="vf-avatar" aria-hidden="true">${esc(ini)}</div><div class="vf-who"><b>${esc(u.name || 'Signed in')}</b><span>${esc(String(u.role || '').toLowerCase())}</span></div><a class="vf-link hide-sm" href="dashboard.html">POS</a><button class="vf-link" id="vf-out" type="button">Sign out</button>`;
    $('vf-out').addEventListener('click', async () => {
      try { await window.Api.post('/auth/logout', undefined, { background: true }); } catch { /* clear locally anyway */ }
      window.Storage.clearSession();
      view('login');
    });
  }

  /* ------------------------------ sign in ------------------------------ */
  function loginAlert(msg) { $('vf-login-alert').innerHTML = msg ? `<div class="vf-err" role="alert">${ICON.alert}<span>${esc(msg)}</span></div>` : ''; }
  function onLogin(data) {
    window.Storage.setTokens({ accessToken: data.accessToken, refreshToken: data.refreshToken });
    window.Storage.setUser(data.user);
    loginAlert('');
    start();
  }
  function setupLogin() {
    document.querySelectorAll('#vf-login .vf-seg button').forEach((b) => b.addEventListener('click', () => {
      document.querySelectorAll('#vf-login .vf-seg button').forEach((x) => x.classList.toggle('active', x === b));
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
    const root = $('vf-result-root'); const r = data.receipt || {}; const cur = r.currency;
    const u = window.Storage.getUser() || {};
    let cls = 'vf-ok'; let icon = ICON.check; let chip = 'Verified'; let title = 'Receipt confirmed'; let sub = 'This receipt matches a real sale recorded in your system.';
    let stop = false;
    if (data.verdict === 'FAKE') {
      cls = 'vf-bad'; icon = ICON.cross; chip = 'Not recognised'; title = 'Fake receipt'; stop = true;
      sub = data.typed ? 'No sale matches that receipt number.' : 'This QR code does not match any sale in your system.';
    } else if (data.status === 'CANCELLED') {
      cls = 'vf-bad'; icon = ICON.cross; chip = 'Void'; title = 'Sale cancelled'; stop = true; sub = 'This sale was cancelled, so the receipt is no longer valid.';
    } else if (data.status === 'REFUNDED') {
      cls = 'vf-bad'; icon = ICON.bang; chip = 'Void'; title = 'Fully refunded'; stop = true; sub = 'The whole sale was refunded, so the goods are not owed to the customer.';
    } else if (data.status === 'PARTLY_REFUNDED' || data.status === 'UNPAID_BALANCE') {
      cls = 'vf-warn'; icon = ICON.bang; chip = 'Check details'; title = 'Receipt confirmed'; sub = 'The receipt is real, but please read the notices below before releasing goods.';
    }

    const notes = [];
    (data.warnings || []).forEach((w) => { if (WARN_TEXT[w]) notes.push(`<div class="vf-note">${ICON.alert}<div>${esc(WARN_TEXT[w])}</div></div>`); });
    if (data.verdict !== 'FAKE' && data.scan && data.scan.previousCount > 0) {
      const n = data.scan.previousCount;
      notes.push(`<div class="vf-note">${ICON.alert}<div><b>Checked ${esc(n)} time${n === 1 ? '' : 's'} before.</b>${data.scan.lastScannedAt ? ` Last on ${esc(window.UI.formatDateTime(data.scan.lastScannedAt))}.` : ''} If this customer is collecting goods again, the receipt may be getting re-used.</div></div>`);
    }

    let body = '';
    if (data.verdict === 'FAKE') {
      body = `<div class="vf-paper" style="padding:6px 18px"><div class="vf-sec" style="padding-left:0">What to do</div><ol class="vf-steps">
        <li><span>Do not release the goods.</span></li>
        <li><span>Ask the customer to wait and call the manager or owner.</span></li>
        <li><span>The owner has been alerted automatically and this scan is saved in the audit log.</span></li></ol></div>`;
    } else {
      const method = (m) => String(m || '').replace(/_/g, ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase());
      body = `<div class="vf-paper">
        <div class="vf-paper-head"><div><div class="biz">${esc(r.business || 'Receipt')}${r.branch ? ` · ${esc(r.branch)}` : ''}</div><div class="no">${esc(r.receiptNumber)}</div></div>
          <div class="amt"><span>Total</span><b>${esc(money(r.total, cur))}</b></div></div>
        <div class="vf-tear"></div>
        <dl class="vf-dl">
          <dt>Time of sale</dt><dd>${esc(window.UI.formatDateTime(r.soldAt))}${r.offline ? ' <small>(made offline)</small>' : ''}</dd>
          <dt>Served by</dt><dd>${esc(r.cashier || '—')}</dd>
          <dt>Till</dt><dd>${esc(r.till || '—')}</dd>
          ${r.invoiceNumber ? `<dt>Invoice no.</dt><dd>${esc(r.invoiceNumber)}</dd>` : ''}
          ${r.customer ? `<dt>Customer</dt><dd>${esc(r.customer)}</dd>` : ''}
          ${r.saleStatus === 'CANCELLED' && r.cancelReason ? `<dt>Reason</dt><dd>${esc(r.cancelReason)}</dd>` : ''}
        </dl>
        <div class="vf-tear"></div>
        <div class="vf-sec">Products</div>
        <table class="vf-items"><tbody>
          ${(r.items || []).map((i) => `<tr><td>${esc(i.name)}<span class="u">${esc(money(i.unitPrice, cur))} each</span></td><td class="q">× ${esc(i.quantity)}</td><td>${esc(money(i.total, cur))}</td></tr>`).join('')}
        </tbody></table>
        <div class="vf-sums">
          ${r.tax ? `<div class="vf-sum"><span>VAT included</span><span>${esc(money(r.tax, cur))}</span></div>` : ''}
          <div class="vf-sum total"><span>Total</span><span>${esc(money(r.total, cur))}</span></div>
          ${(r.payments || []).map((p) => `<div class="vf-sum"><span>${esc(method(p.method))}</span><span>${esc(money(p.amount, cur))}</span></div>`).join('')}
          ${Number(r.balance) > 0 ? `<div class="vf-sum owed"><span>Balance owed</span><span>${esc(money(r.balance, cur))}</span></div>` : ''}
        </div></div>
        <div class="vf-audit">${ICON.shield}<span>Checked by ${esc(u.name || 'staff')} · ${esc(window.UI.formatDateTime(new Date()))}</span></div>`;
    }

    root.innerHTML = `
      <div class="vf-backdrop" id="vf-backdrop">
        <div class="vf-sheet ${cls}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
          <div class="vf-scroll">
            <div class="vf-status"><div class="vf-seal">${icon}</div><div class="vf-chip">${esc(chip)}</div><h2>${esc(title)}</h2><p>${esc(sub)}</p></div>
            <div class="vf-pad">${notes.join('')}${body}</div>
          </div>
          <div class="vf-foot"><button class="vf-btn" id="vf-next" type="button">Scan next receipt</button><button class="vf-btn quiet" id="vf-close" type="button">Close</button></div>
        </div>
      </div>`;
    document.body.style.overflow = 'hidden';
    const close = () => { root.innerHTML = ''; document.body.style.overflow = ''; document.removeEventListener('keydown', onKey); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    $('vf-close').addEventListener('click', close);
    $('vf-backdrop').addEventListener('click', (e) => { if (e.target.id === 'vf-backdrop') close(); });
    $('vf-next').addEventListener('click', () => { close(); scan(); });
    $('vf-next').focus();
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
