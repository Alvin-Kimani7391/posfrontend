/**
 * offline-ui.js - everything the cashier sees about offline mode.
 *  - status chip (bottom-left, every page): Set up offline / OFFLINE / pending count / syncing / needs attention
 *  - "Offline" button in the top bar (always visible once the app shell exists)
 *  - lock screen when a cashier must unlock with a PIN (shared tills, expired sessions)
 *  - "Till offline centre": status, sync now, download products, offline PIN, set up this till, roster, issues, backup
 * Starts itself: only the <script> tag is needed.
 */
(function (window) {
  'use strict';
  const Offline = (window.Offline = window.Offline || {});
  const UI = () => window.UI;
  const esc = (s) => UI().escapeHtml(s == null ? '' : String(s));
  const onLogin = /login\.html$/.test(window.location.pathname);
  const onOfflinePage = /offline\.html$/.test(window.location.pathname);
  let chip = null; let lockEl = null;

  function css() {
    if (document.getElementById('ofl-css')) return;
    const s = document.createElement('style'); s.id = 'ofl-css';
    s.textContent = `
      .ofl-chip{position:fixed;left:10px;bottom:calc(10px + env(safe-area-inset-bottom,0px));z-index:1250;display:inline-flex;align-items:center;gap:8px;padding:8px 14px;border-radius:999px;border:0;font:600 .8rem system-ui,sans-serif;color:#fff;cursor:pointer;box-shadow:0 6px 18px rgba(0,0,0,.25)}
      @media (max-width:959px){.ofl-chip{bottom:calc(var(--bottom-nav-height,64px) + 10px)}}
      .ofl-chip[hidden]{display:none}.ofl-ok{background:#0d7a4f}.ofl-info{background:#1d4ed8}.ofl-warn{background:#b45309}.ofl-bad{background:#b91c1c}.ofl-off{background:#7c2d12}
      .ofl-dot{width:8px;height:8px;border-radius:50%;background:#fff;opacity:.9}
      .ofl-lock{position:fixed;inset:0;z-index:2500;background:rgba(15,23,42,.94);display:flex;align-items:center;justify-content:center;padding:16px}
      .ofl-lock-card{width:100%;max-width:380px;background:var(--color-surface,#fff);color:var(--color-text,#0f172a);border-radius:16px;padding:24px;display:grid;gap:12px}
      .ofl-lock-card h2{margin:0;font-size:1.15rem}.ofl-err{color:var(--color-danger,#b91c1c);font-size:.85rem;min-height:1.2em}
      .ofl-row{display:flex;justify-content:space-between;gap:12px;padding:6px 0;border-bottom:1px solid var(--color-border,#e2e8f0);font-size:.88rem}
      .ofl-row span:first-child{color:var(--color-text-secondary,#475569)}.ofl-acts{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px}
      .ofl-issue{padding:8px 10px;border:1px solid var(--color-border,#e2e8f0);border-radius:8px;margin-top:8px;font-size:.82rem}
      .ofl-help{width:100%;font-size:.8rem;color:var(--color-text-secondary,#475569);margin:8px 0 0}
      #ofl-top-btn{display:inline-flex;align-items:center;gap:6px;font-weight:600}
      #ofl-top-btn i{width:8px;height:8px;border-radius:50%;background:#94a3b8;display:inline-block}
      #ofl-top-btn.on-ok i{background:#10b981}#ofl-top-btn.on-warn i{background:#f59e0b}#ofl-top-btn.on-bad i{background:#ef4444}`;
    document.head.appendChild(s);
  }

  /* ------------------------------ top bar button ------------------------------ */
  function ensureTopButton() {
    const bar = document.querySelector('.topbar-right');
    if (!bar) return;
    let b = document.getElementById('ofl-top-btn');
    if (!b) {
      b = document.createElement('button');
      b.id = 'ofl-top-btn'; b.type = 'button'; b.className = 'btn btn-ghost btn-sm';
      b.title = 'Till offline centre: set up this till, download products, offline PIN';
      b.addEventListener('click', openCenter);
      bar.insertBefore(b, bar.firstChild);
    }
    if (!Offline.isReady()) { b.innerHTML = '<i></i><span>Offline</span>'; return; }
    const s = Offline.status();
    let cls = ''; let label = 'Offline';
    if (!s.enrolled) { cls = 'on-warn'; label = 'Set up offline'; }
    else if (!s.policyOn) { cls = 'on-warn'; label = 'Offline: off'; }
    else if (s.issues) { cls = 'on-bad'; label = 'Offline'; }
    else { cls = 'on-ok'; label = s.pending ? `Offline (${s.pending})` : 'Offline'; }
    b.className = `btn btn-ghost btn-sm ${cls}`;
    b.innerHTML = `<i></i><span>${esc(label)}</span>`;
  }

  /* ------------------------------ chip ------------------------------ */
  function paintChip() {
    ensureTopButton();
    if (!chip || !Offline.isReady()) return;
    const s = Offline.status();
    let tone = 'ok'; let text = '';
    if (!s.online) { tone = s.pending ? 'warn' : 'off'; text = `OFFLINE${s.pending ? ` · ${s.pendingSales || s.pending} pending` : ''}`; }
    else if (s.syncState === 'syncing') { tone = 'info'; text = `Syncing ${s.pending}…`; }
    else if (s.pending && s.syncState === 'auth') { tone = 'warn'; text = 'Sign in to sync'; }
    else if (s.pending) { tone = 'warn'; text = `${s.pending} waiting to sync`; }
    else if (s.issues) { tone = 'bad'; text = `${s.issues} need attention`; }
    else if (!s.enrolled) { tone = 'info'; text = 'Set up offline'; }
    else if (!s.policyOn) { tone = 'warn'; text = 'Offline selling is off'; }
    else { text = s.catalogReady ? 'Offline-ready' : 'Downloading products…'; if (!s.catalogReady) tone = 'info'; }
    if (s.online && s.pending && s.issues) text += ` · ${s.issues} issue(s)`;
    chip.hidden = !text;
    chip.className = `ofl-chip ofl-${tone}`;
    chip.innerHTML = `<i class="ofl-dot"></i><span>${esc(text)}</span>`;
    chip.title = 'Till offline centre';
  }

  /* ------------------------------ lock screen ------------------------------ */
  function hideLock() { if (lockEl) { lockEl.remove(); lockEl = null; } }
  function showLock() {
    if (lockEl) return;
    const users = Offline.auth.listLoginUsers();
    const active = Offline.auth.activeUserId();
    lockEl = document.createElement('div');
    lockEl.className = 'ofl-lock';
    lockEl.innerHTML = `
      <form class="ofl-lock-card" autocomplete="off">
        <h2>Till locked</h2>
        ${users.length ? `
          <select class="select" name="u">${users.map((u) => `<option value="${esc(u.userId)}" ${u.userId === active ? 'selected' : ''}>${esc(u.name)} (${esc(u.role)})</option>`).join('')}</select>
          <input class="input" name="pin" type="password" inputmode="numeric" maxlength="8" placeholder="Offline PIN" autofocus />
          <div class="ofl-err" id="ofl-lock-err"></div>
          <button class="btn btn-primary" type="submit">Unlock</button>` : `
          <p class="text-sm">No offline PIN is stored on this till. Connect to the internet and sign in, then set your offline PIN from the "Offline" button.</p>`}
        <a class="btn btn-secondary" href="login.html?online=1">Sign in online</a>
      </form>`;
    document.body.appendChild(lockEl);
    lockEl.querySelector('form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.currentTarget; const err = lockEl.querySelector('#ofl-lock-err');
      try { await Offline.auth.unlock(f.u.value, f.pin.value); f.pin.value = ''; checkLock(); }
      catch (ex) { err.textContent = ex.message; f.pin.value = ''; }
    });
  }
  function checkLock() {
    if (onLogin || onOfflinePage || !Offline.isReady() || !window.Storage.isAuthenticated()) return hideLock();
    if (Offline.auth.requiresUnlock()) showLock(); else hideLock();
  }

  /* ------------------------------ centre ------------------------------ */
  let centerModal = null;
  const when = (t) => (t ? UI().formatDateTime(t) : '-');
  const canManage = () => window.Permissions.can(window.Storage.getUser(), 'devices.manage');

  function centerHtml() {
    const s = Offline.status(); const ctx = Offline.context.get();
    const row = (a, b) => `<div class="ofl-row"><span>${a}</span><span>${b}</span></div>`;
    const online = s.online;
    return `
      ${row('Connection', online ? 'Online' : '<b>Offline</b>')}
      ${row('This till', s.enrolled ? `${esc(s.deviceCode || '')} · ${esc(s.mode || '')}` : '<b>Not set up for offline selling</b>')}
      ${row('Offline selling', s.policyOn ? 'Enabled' : s.enrolled ? 'Off (the owner enables it in Settings, or turn it on for this till)' : 'Off')}
      ${row('Offline permission until', s.grantUntil ? `${when(s.grantUntil)}${s.grantValid ? '' : ' (expired)'}` : '-')}
      ${row('Products saved on this till', `${s.catalogCount}${s.catalogProgress ? ` (downloading ${esc(s.catalogProgress.type)}…)` : ''}`)}
      ${row('Unsynced items', `${s.pending} (${s.pendingSales} sales, ${UI().formatMoney(s.pendingValueCents / 100)})`)}
      ${row('Last sync', s.lastSyncAt ? when(s.lastSyncAt) : '-')}
      ${s.syncError ? `<div class="ofl-err" style="margin-top:8px">${esc(s.syncError)}</div>` : ''}
      <div id="ofl-issues"></div>
      <div class="ofl-acts">
        ${!s.enrolled && canManage() ? '<button class="btn btn-primary btn-sm" data-a="enroll">1. Set up this till</button>' : ''}
        ${s.enrolled ? '<button class="btn btn-primary btn-sm" data-a="catalog">2. Download products</button>' : ''}
        <button class="btn btn-secondary btn-sm" data-a="pin">3. Set my offline PIN</button>
        ${s.enrolled ? '<button class="btn btn-secondary btn-sm" data-a="grant">Renew offline permission</button>' : ''}
        <button class="btn btn-secondary btn-sm" data-a="sync">Sync now</button>
        <button class="btn btn-secondary btn-sm" data-a="backup">Export backup</button>
        ${s.enrolled && canManage() && (ctx && ctx.device && ctx.device.mode === 'SHARED') ? '<button class="btn btn-secondary btn-sm" data-a="roster">Issue cashier roster</button>' : ''}
        ${s.enrolled && canManage() ? '<button class="btn btn-ghost btn-sm" data-a="reset">Reset this till identity</button>' : ''}
        <a class="btn btn-ghost btn-sm" href="login.html?online=1">Sign in online</a>
      </div>
      ${!s.enrolled && !canManage() ? '<p class="ofl-help">This till is not set up yet. A manager or the owner must sign in on this till (online) and tap <b>Set up this till</b>. You can still set your own offline PIN below.</p>' : ''}
      ${!online ? '<p class="ofl-help">You are offline: setting up the till, downloading products and setting a PIN need an internet connection.</p>' : ''}
      <p class="ofl-help">Order: (1) manager sets up the till online, (2) products download, (3) every cashier signs in online once on this till and sets an offline PIN. After that the till keeps selling with no internet.</p>`;
  }

  async function paintIssues() {
    const box = document.getElementById('ofl-issues');
    if (!box) return;
    const list = await Offline.outbox.issues();
    box.innerHTML = list.length ? `<h4 style="margin:14px 0 0">Needs a manager (${list.length})</h4>${list.map((i) => `
      <div class="ofl-issue"><b>${esc(i.receiptNumber || i.type)}</b> · ${esc(i.code)} · ${i.totalCents ? UI().formatMoney(i.totalCents / 100) : ''}<br>${esc(i.message || '')}
      <br><button class="btn btn-ghost btn-sm" data-dismiss="${esc(i.ref)}">Dismiss notice</button></div>`).join('')}
      <p class="text-xs text-muted" style="margin-top:6px">The server keeps a full copy of each of these. A manager releases or discards them under Offline review.</p>` : '';
    box.querySelectorAll('[data-dismiss]').forEach((b) => b.addEventListener('click', async () => {
      await window.OfflineDB.bulkDelete('issues', [b.dataset.dismiss]); await Offline.outbox.refresh(); paintCenter();
    }));
  }

  function paintCenter() {
    if (!centerModal || !document.body.contains(centerModal)) { centerModal = null; return; }
    const body = centerModal.querySelector('#ofl-center'); if (!body) return;
    body.innerHTML = centerHtml();
    paintIssues();
    body.querySelectorAll('[data-a]').forEach((b) => b.addEventListener('click', () => act(b.dataset.a, b)));
  }

  async function act(a, btn) {
    const U = UI();
    try {
      U.setButtonLoading(btn, true, '…');
      if (a === 'sync') { await Offline.sync.now(); U.toast.success('Sync finished'); }
      if (a === 'catalog') { if (!(await Offline.catalog.sync())) throw new Error('Could not download. Check the connection, and that offline selling is switched on for this till.'); U.toast.success('Products updated'); }
      if (a === 'grant') { if (!(await Offline.grants.refresh())) throw new Error('You must be online and signed in.'); U.toast.success('Offline permission renewed'); }
      if (a === 'roster') { U.toast.success(`${await Offline.auth.refreshRoster()} cashier(s) can now unlock this till offline`); }
      if (a === 'pin') {
        if (!window.Connectivity.isOnline() || !window.Storage.getAccessToken()) throw new Error('Connect to the internet and sign in to set your offline PIN.');
        pinModal();
      }
      if (a === 'backup') backupModal();
      if (a === 'enroll') {
        if (!window.Connectivity.isOnline()) throw new Error('Connect to the internet to set up this till.');
        enrollModal();
      }
      if (a === 'reset' && (await U.confirmDialog({ title: 'Reset this till identity?', message: 'Only do this if the till was replaced. A manager must set it up again.', confirmText: 'Reset', danger: true }))) await Offline.device.resetIdentity();
    } catch (e) { U.toast.error(e.message); }
    finally { if (document.body.contains(btn)) U.setButtonLoading(btn, false); paintCenter(); }
  }

  function pinModal() {
    const m = UI().openModal({
      title: 'Set my offline PIN',
      bodyHtml: `<form id="p-f" autocomplete="off"><p class="text-sm text-secondary">The offline PIN is 6 to 8 digits. It unlocks this till when there is no internet. It is separate from your normal login PIN.</p>
        <div class="field"><label>Your current login PIN or account password</label><input class="input" name="password" type="password" autocomplete="current-password" required />
          <small class="text-sm text-secondary">Cashiers: type the PIN you use to sign in (e.g. 4 digits). Managers/owners: your account password.</small></div>
        <div class="field"><label>New PIN</label><input class="input" name="pin" type="password" inputmode="numeric" pattern="\\d{6,8}" maxlength="8" required /></div>
        <div class="field"><label>Repeat PIN</label><input class="input" name="pin2" type="password" inputmode="numeric" maxlength="8" required /></div></form>`,
      footerHtml: '<button class="btn btn-secondary" data-c>Cancel</button><button class="btn btn-primary" data-s>Save PIN</button>',
    });
    if (window.PasswordToggle) window.PasswordToggle.enhance(m);
    m.querySelector('[data-c]').addEventListener('click', UI().closeModal);
    m.querySelector('[data-s]').addEventListener('click', async (e) => {
      const f = m.querySelector('#p-f'); if (!f.reportValidity()) return;
      if (f.pin.value !== f.pin2.value) return UI().toast.error('The two PINs do not match');
      UI().setButtonLoading(e.currentTarget, true, 'Saving…');
      try {
        await Offline.auth.setPin({ password: f.password.value, pin: f.pin.value });
        UI().toast.success('Offline PIN saved');
        UI().closeModal();
        try { await Offline.grants.refresh(); } catch { /* grant is renewed on the next heartbeat */ }
      } catch (err) { UI().toast.error(err.message); UI().setButtonLoading(e.currentTarget, false); }
    });
  }

  function backupModal() {
    const m = UI().openModal({
      title: 'Export backup of unsynced sales',
      bodyHtml: `<p class="text-sm text-secondary">Last resort only. The file is encrypted with this passphrase and contains customer phone numbers. Keep both safe.</p>
        <div class="field"><label>Passphrase (8+ characters)</label><input class="input" id="b-p" type="password" autocomplete="new-password" /></div>`,
      footerHtml: '<button class="btn btn-secondary" data-c>Cancel</button><button class="btn btn-primary" data-s>Download</button>',
    });
    m.querySelector('[data-c]').addEventListener('click', UI().closeModal);
    m.querySelector('[data-s]').addEventListener('click', async () => {
      try { const n = await Offline.backup.export(m.querySelector('#b-p').value); UI().toast.success(`${n} item(s) exported`); UI().closeModal(); }
      catch (e) { UI().toast.error(e.message); }
    });
  }

  function enrollModal() {
    const m = UI().openModal({
      title: 'Set up this till for offline selling',
      bodyHtml: `<form id="e-f"><div class="field"><label>Till name</label><input class="input" name="name" required value="Till" maxlength="60" /></div>
        <div class="field"><label>Who uses this device?</label><select class="select" name="mode">
          <option value="DEDICATED">One cashier per till (dedicated PC / tablet)</option>
          <option value="SHARED">Shared device (cashiers switch with a PIN)</option></select></div>
        <div class="checkbox-row"><input type="checkbox" id="e-o" checked /><label for="e-o" class="text-sm">Allow offline selling on this till</label></div>
        <p class="text-xs text-muted" style="margin-top:8px">Enrolls it in the branch you are viewing. The owner must have turned on "Allow offline selling" in Settings first.</p></form>`,
      footerHtml: '<button class="btn btn-secondary" data-c>Cancel</button><button class="btn btn-primary" data-s>Set up</button>',
    });
    m.querySelector('[data-c]').addEventListener('click', UI().closeModal);
    m.querySelector('[data-s]').addEventListener('click', async (e) => {
      const f = m.querySelector('#e-f'); if (!f.reportValidity()) return;
      UI().setButtonLoading(e.currentTarget, true, 'Setting up…');
      try {
        await Offline.device.enroll({ branchId: window.AppShell.getActiveBranchId(), deviceName: f.name.value.trim(), mode: f.mode.value, offlineEnabled: m.querySelector('#e-o').checked });
        UI().closeModal();
        UI().toast.success('Till set up. Downloading products…');
        await Offline.grants.refresh().catch(() => {});
        await Offline.catalog.sync().catch((e2) => UI().toast.error(e2.message));
        paintChip(); paintCenter();
      } catch (err) { UI().toast.error(err.message); UI().setButtonLoading(e.currentTarget, false); }
    });
  }

  function openCenter() {
    if (centerModal && document.body.contains(centerModal)) return;
    centerModal = UI().openModal({ title: 'Till offline centre', maxWidth: '560px', bodyHtml: '<div id="ofl-center"></div>', footerHtml: '<button class="btn btn-primary" data-c>Close</button>' });
    centerModal.querySelector('[data-c]').addEventListener('click', UI().closeModal);
    paintCenter();
  }

  /* ------------------------------ start ------------------------------ */
  async function start() {
    css();
    chip = document.createElement('button');
    chip.type = 'button'; chip.hidden = true; chip.className = 'ofl-chip';
    chip.addEventListener('click', openCenter);
    document.body.appendChild(chip);
    window.OfflineUI = { openCenter, paintChip, checkLock };
    await Offline.init();
    ['pending', 'sync', 'readiness', 'catalog', 'mode', 'shift'].forEach((e) => Offline.on(e, () => { paintChip(); checkLock(); paintCenter(); }));
    paintChip(); checkLock();
    // The app shell may render after this script: keep trying to add the top-bar button for a few seconds.
    let tries = 0;
    const t = setInterval(() => { ensureTopButton(); if (document.getElementById('ofl-top-btn') || ++tries > 40) clearInterval(t); }, 250);
    setInterval(() => { paintChip(); checkLock(); }, 10000);
    nagForPin();
  }

  /** Once per sign-in: an enrolled till, online, signed-in user with no offline PIN yet gets the PIN form straight away. */
  function nagForPin() {
    try {
      if (/(login|offline)\.html$/.test(location.pathname)) return;
      if (!window.Storage.getAccessToken() || !window.Connectivity.isOnline()) return;
      const s = Offline.status();
      if (!s.enrolled || !s.policyOn || Offline.auth.hasPin()) return;
      const key = 'pos.offline.pinNag';
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, '1');
      setTimeout(() => { if (!Offline.auth.hasPin()) pinModal(); }, 1500);
    } catch { /* never block the page */ }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})(window);