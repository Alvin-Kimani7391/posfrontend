/**
 * admin-billing-settings.js - the platform's PayHero credentials (stored encrypted, never shown back), manual-payment
 * details, lock policy, reminder schedule, contact + alert emails, and the master "billing enabled" switch.
 * Each card saves on its own. Empty text boxes are sent as empty so a value CAN be cleared.
 */
(function () {
  const AB = window.AdminBilling;
  const { esc } = AB;
  const $ = (id) => document.getElementById(id);
  let el;
  let s;
  let plans = [];

  document.addEventListener('DOMContentLoaded', () => {
    el = window.AdminShell.mount({ title: 'Billing settings' });
    if (!el) return;
    el.innerHTML = `
      <div class="page-header"><div><h1>Billing settings</h1><p>Payment credentials, lock policy, reminders and contacts.</p></div></div>
      ${AB.subnav('settings')}
      <div id="bs-body"></div>`;
    load();
  });

  async function load() {
    const body = $('bs-body');
    body.innerHTML = window.UI.skeletonRows(3, 1);
    try {
      [{ data: s }, { data: { items: plans } }] = await Promise.all([window.Api.get('/admin/billing/settings'), window.Api.get('/admin/billing/plans')]);
      render(body);
    } catch (err) {
      body.innerHTML = `<div class="card">${window.UI.emptyStateHtml({ icon: 'alert', title: 'Could not load settings', message: err.message })}</div>`;
    }
  }

  const card = (id, title, sub, inner, extraBtn = '') => `
    <div class="card bl-card-gap" id="card-${id}">
      <div class="card-header"><div><h2>${title}</h2><p class="text-sm text-muted">${sub}</p></div></div>
      <div class="card-body">${inner}</div>
      <div class="card-footer" style="display:flex;justify-content:${extraBtn ? 'space-between' : 'flex-end'}">${extraBtn}<button class="btn btn-primary btn-sm" data-save="${id}">Save changes</button></div>
    </div>`;
  const chk = (id, label, on) => `<label class="checkbox-row" style="margin-bottom:var(--space-3)"><input type="checkbox" id="${id}" ${on ? 'checked' : ''} /> ${label}</label>`;
  const txt = (id, label, v, extra = '') => `<div class="field"><label for="${id}">${label}</label><input class="input" id="${id}" value="${esc(v || '')}" ${extra} /></div>`;
  const list = (a) => (a || []).join(', ');

  function render(body) {
    const m = s.manual || {}; const e = s.enforcement || {}; const r = s.reminders || {}; const c = s.contact || {};
    const credSet = !!(s.stk.credentials && s.stk.credentials.isSet);
    body.innerHTML = [
      card('master', 'Billing switch & default plan', 'While OFF nobody is invoiced, emailed or locked. Payments that are already in progress are still processed.',
        `${chk('m-enabled', '<b>Billing enabled</b>', s.billingEnabled)}
         <div class="field" style="max-width:360px"><label for="m-plan">Default plan for new businesses</label><select class="select" id="m-plan">${plans.filter((p) => p.isActive).map((p) => `<option value="${esc(p.key)}" ${p.key === s.defaultPlanKey ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></div>
         <p class="bl-muted">Edit the amounts themselves on <a class="bl-link" href="admin-billing-plans.html">Plans & prices</a>.</p>`),

      card('stk', 'M-PESA prompt (PayHero STK)', 'The platform\u2019s own PayHero account - money from shop owners lands here.',
        `${chk('k-enabled', 'Enabled', s.stk.enabled)}
         ${txt('k-channel', 'Payment channel ID', s.stk.channelId, 'placeholder="From PayHero > Payment Channels"')}
         <div class="field"><label for="k-type">Credential type</label><select class="select" id="k-type"><option value="token">Basic Auth token</option><option value="userpass">API username + password</option></select></div>
         <div id="k-token"><div class="field"><label>Basic Auth token ${credSet ? '<span class="badge badge-success">Saved</span>' : ''}</label><input class="input" id="k-tokenv" autocomplete="off" placeholder="Leave blank to keep existing" /></div></div>
         <div id="k-up" style="display:none"><div class="form-row">
           <div class="field"><label>API username</label><input class="input" id="k-user" autocomplete="off" placeholder="Leave blank to keep existing" /></div>
           <div class="field"><label>API password</label><input class="input" id="k-pass" type="password" autocomplete="new-password" placeholder="Leave blank to keep existing" /></div></div></div>
         <p class="bl-muted">Credentials are encrypted and can never be read back. The server needs <code>PUBLIC_API_BASE_URL</code> so PayHero can call back; each payment gets its own secret callback link.</p>`,
        '<button class="btn btn-secondary btn-sm" id="k-test">Test connection</button>'),

      card('manual', 'Manual payment (till / paybill)', 'Shown to owners who pay themselves and paste the M-PESA message.',
        `${chk('n-enabled', 'Enabled', m.enabled)}
         <div class="form-row">${txt('n-label', 'Method label', m.methodLabel, 'maxlength="60" placeholder="Till (Buy Goods)"')}${txt('n-number', 'Till / paybill number', m.number, 'maxlength="30"')}</div>
         <div class="form-row">${txt('n-name', 'Account name on the M-PESA message', m.accountName, 'maxlength="80"')}${txt('n-ref', 'Account / reference to use', m.accountReference, 'maxlength="120" placeholder="e.g. your business name"')}</div>
         ${txt('n-phone', 'Phone (optional)', m.phone, 'maxlength="20"')}
         <div class="field"><label for="n-instr">Extra instructions</label><textarea class="textarea" id="n-instr" rows="3" maxlength="1000">${esc(m.instructions || '')}</textarea></div>
         <p class="bl-muted">The number and name are also used to flag pasted messages that do not mention them.</p>`),

      card('enf', 'Arrears & locking', 'A locked owner can still log in and pay; everything else is blocked until the balance is cleared.',
        `${chk('e-auto', 'Automatically lock accounts with overdue balances', e.autoSuspendEnabled !== false)}
         <div class="field" style="max-width:260px"><label for="e-grace">Grace days after the due date</label><input class="input" id="e-grace" type="number" min="0" max="90" value="${e.graceDays != null ? e.graceDays : 7}" /></div>
         <p class="bl-muted">You can override the grace period or exempt a business on its billing page.</p>`),

      card('rem', 'Reminder schedule', 'Comma-separated days. Each reminder is sent once per invoice by email and in-app.',
        `<div class="form-row">${txt('r-before', 'Before the due date (days)', list(r.beforeDueDays), 'placeholder="3"')}${txt('r-over', 'After the due date (days)', list(r.overdueDays), 'placeholder="1, 3, 7"')}</div>
         ${txt('r-trial', 'Before the free trial ends (days)', list(r.trialEndingDays), 'placeholder="2"')}`),

      card('contact', 'Contacts & alerts', 'Support details shown to owners, and who gets billing emails (manual payments to verify, auto-locks, late STK recoveries).',
        `<div class="form-row">${txt('c-phone', 'Support phone', c.supportPhone, 'maxlength="30"')}${txt('c-email', 'Support email', c.supportEmail)}</div>
         <div class="field"><label for="c-alerts">Platform alert emails <span class="text-muted">(comma separated)</span></label><textarea class="textarea" id="c-alerts" rows="2">${esc(list(s.alertEmails))}</textarea></div>`),
    ].join('');

    const sel = $('k-type');
    sel.addEventListener('change', () => { $('k-token').style.display = sel.value === 'token' ? '' : 'none'; $('k-up').style.display = sel.value === 'token' ? 'none' : ''; });
    $('k-test').addEventListener('click', testStk);
    body.querySelectorAll('[data-save]').forEach((b) => b.addEventListener('click', () => save(b.dataset.save, b)));
  }

  function nums(id, label) {
    const raw = $(id).value.split(/[,\s]+/).filter(Boolean);
    const out = raw.map(Number);
    if (out.some((n) => !Number.isInteger(n) || n < 1)) throw new Error(`${label}: use whole numbers like 1, 3, 7`);
    return out;
  }

  const builders = {
    master: async () => {
      const enabled = $('m-enabled').checked;
      if (enabled && !s.billingEnabled) {
        const ok = await window.UI.confirmDialog({ title: 'Switch billing ON?', message: 'Businesses will start receiving invoices, reminders and (after the grace period) locks. Make sure the plan amounts and payment details are correct.', confirmText: 'Switch on' });
        if (!ok) return null;
      }
      return { billingEnabled: enabled, defaultPlanKey: $('m-plan').value };
    },
    stk: () => {
      const stk = { enabled: $('k-enabled').checked };
      const ch = $('k-channel').value.trim();
      if (ch) stk.channelId = ch;
      if ($('k-type').value === 'token') {
        const t = $('k-tokenv').value.trim();
        if (t) stk.basicAuthToken = t;
      } else {
        const u = $('k-user').value.trim(); const p = $('k-pass').value.trim();
        if ((u || p) && !(u && p)) throw new Error('Enter both the API username and the API password');
        if (u && p) { stk.apiUsername = u; stk.apiPassword = p; }
      }
      return { stk };
    },
    manual: () => ({ manual: {
      enabled: $('n-enabled').checked, methodLabel: $('n-label').value.trim(), number: $('n-number').value.trim(),
      accountName: $('n-name').value.trim(), accountReference: $('n-ref').value.trim(), phone: $('n-phone').value.trim(), instructions: $('n-instr').value.trim(),
    } }),
    enf: () => ({ enforcement: { autoSuspendEnabled: $('e-auto').checked, graceDays: Number($('e-grace').value) } }),
    rem: () => ({ reminders: { beforeDueDays: nums('r-before', 'Before due'), overdueDays: nums('r-over', 'After due'), trialEndingDays: nums('r-trial', 'Trial ending') } }),
    contact: () => ({
      contact: { supportPhone: $('c-phone').value.trim(), supportEmail: $('c-email').value.trim() },
      alertEmails: $('c-alerts').value.split(/[,\s;]+/).map((x) => x.trim().toLowerCase()).filter(Boolean),
    }),
  };

  async function save(id, btn) {
    let payload;
    try { payload = await builders[id](); } catch (err) { return window.UI.toast.error(err.message); }
    if (!payload) return;
    window.UI.setButtonLoading(btn, true, 'Saving…');
    try {
      await window.Api.put('/admin/billing/settings', payload);
      window.UI.toast.success('Settings saved');
      await load();
    } catch (err) {
      window.UI.toast.error(AB.errText(err));
    } finally {
      if (document.body.contains(btn)) window.UI.setButtonLoading(btn, false);
    }
  }

  async function testStk(e) {
    const btn = e.currentTarget;
    window.UI.setButtonLoading(btn, true, 'Testing…');
    try {
      const { data } = await window.Api.post('/admin/billing/settings/test', {});
      (data.ok ? window.UI.toast.success : window.UI.toast.error)(data.message);
    } catch (err) { window.UI.toast.error(err.message); }
    finally { window.UI.setButtonLoading(btn, false); }
  }
})();