(function () {
  let contentEl;

  const TILL_RE = /^\d{5,8}$/;
  const esc = (s) => window.UI.escapeHtml(s == null ? '' : String(s));

  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    contentEl = window.AppShell.mount({ title: 'Settings' });
    if (!contentEl) return;
    contentEl.innerHTML = `<div class="page-header"><div><h1>Settings</h1><p>Your business details, receipt layout, and payment/tax integrations.</p></div></div><div id="settings-body"></div>`;
    await render();
  }

  /* ------------------------------------------------------------------ *
   * Data loading
   * ------------------------------------------------------------------ */

  /**
   * Till setup (webhook URL etc.) is OWNER-only on the backend. A non-owner with settings.view
   * gets a 403 - that is not an error for the page, it just means "show the read-only notice".
   */
  async function loadTillSetup() {
    try {
      const { data } = await window.Api.get('/payments/mpesa/manual/setup');
      return data;
    } catch (err) {
      if (err.code === 'OWNER_ONLY' || err.status === 403) return { forbidden: true };
      return { error: err.message };
    }
  }

  async function render() {
    const body = document.getElementById('settings-body');
    body.innerHTML = window.UI.skeletonRows(3, 1);

    const [statusResult, businessResult, tillResult] = await Promise.allSettled([
      window.Api.get('/settings/integrations'),
      window.Api.get('/business'),
      loadTillSetup(),
    ]);

    if (statusResult.status === 'rejected') {
      body.innerHTML = window.UI.emptyStateHtml({ icon: 'alert', title: 'Could not load settings', message: statusResult.reason.message });
      return;
    }
    const status = statusResult.value.data;
    const business = businessResult.status === 'fulfilled' ? businessResult.value.data.business : null;
    const till = tillResult.status === 'fulfilled' ? tillResult.value : { error: 'Could not load Till setup' };

    body.innerHTML = `
      ${business ? businessCard(business) : ''}
      ${business ? salesSettingsCard(business) : ''}
      <div class="section-label" style="margin: var(--space-2) 0 var(--space-3)"><h2 style="font-size:var(--text-lg, 1.125rem)">Payments</h2></div>
      ${mpesaStkCard(status)}
      <div id="till-card-wrap">${tillCard(status.mpesa, till)}</div>
      <div class="section-label" style="margin: var(--space-2) 0 var(--space-3)"><h2 style="font-size:var(--text-lg, 1.125rem)">Tax</h2></div>
      ${etimsCard(status)}
    `;

    if (business) { bindBusinessCard(); bindSalesSettingsCard(); }
    bindMpesaStk();
    bindTillCard();
    bindEtims();
    bindMpesaCredTypeToggle();
  }

  /* ------------------------------------------------------------------ *
   * Business & receipt customization
   * ------------------------------------------------------------------ */
  function businessCard(business) {
    const rs = business.receiptSettings || {};
    return `
      <div class="card" style="margin-bottom: var(--space-6)">
        <div class="card-header">
          <div><h2>Business & receipt details</h2><p class="text-sm text-muted">What appears on every printed receipt, plus your company info.</p></div>
        </div>
        <div class="card-body">
          <form id="business-form">
            <div class="form-row">
              <div class="field"><label>Business name</label><input class="input" name="name" value="${esc(business.name || '')}" /></div>
              <div class="field"><label>Phone</label><input class="input" name="phone" value="${esc(business.phone || '')}" /></div>
            </div>
            <div class="form-row">
              <div class="field"><label>Email <span class="text-muted">(optional)</span></label><input class="input" name="email" type="email" value="${esc(business.email || '')}" placeholder="owner@business.com" /></div>
              <div class="field"><label>Address</label><input class="input" name="address" value="${esc(business.address || '')}" /></div>
            </div>
            <div class="form-row">
              <div class="field"><label>County <span class="text-muted">(optional)</span></label><input class="input" name="county" value="${esc(business.county || '')}" placeholder="Nairobi" /></div>
              <div class="field"><label>Town <span class="text-muted">(optional)</span></label><input class="input" name="town" value="${esc(business.town || '')}" placeholder="Westlands" /></div>
            </div>
            <div class="form-row">
              <div class="field"><label>KRA PIN</label><input class="input" name="kraPin" value="${esc(business.kraPin || '')}" /></div>
              <div class="field"><label>Tax PIN <span class="text-muted">(if different from KRA PIN)</span></label><input class="input" name="taxPin" value="${esc(business.taxPin || '')}" /></div>
            </div>
            <div class="checkbox-row" style="margin-bottom:var(--space-4)">
              <input type="checkbox" id="biz_vatRegistered" ${business.vatRegistered ? 'checked' : ''} />
              <label for="biz_vatRegistered" class="text-sm">VAT registered</label>
            </div>
            <div class="form-row">
              <div class="field"><label>Currency</label><input class="input" name="currency" value="${esc(business.currency || 'KES')}" /></div>
              <div class="field"><label>Timezone</label><input class="input" name="timezone" value="${esc(business.timezone || 'Africa/Nairobi')}" /></div>
            </div>
            <div class="field"><label>Logo URL <span class="text-muted">(optional)</span></label><input class="input" name="logo" value="${esc(business.logo || '')}" placeholder="https://…" /></div>

            <hr style="margin: var(--space-4) 0; border-color: var(--color-border)" />

            <div class="field"><label>Receipt header message <span class="text-muted">(optional)</span></label><input class="input" name="rs_headerMessage" value="${esc(rs.headerMessage || '')}" placeholder="e.g. Welcome to..." /></div>
            <div class="field"><label>Receipt footer message</label><input class="input" name="rs_footerMessage" value="${esc(rs.footerMessage || '')}" /></div>
            <div class="field"><label>Extra line(s) <span class="text-muted">(one per line, e.g. return policy)</span></label><textarea class="textarea" name="rs_customLines" rows="2">${esc((rs.customLines || []).join('\n'))}</textarea></div>
            <div class="form-row">
              <div class="field"><label>Receipt paper width</label>
                <select class="select" name="rs_paperWidth">
                  <option value="80mm" ${rs.paperWidth !== '58mm' ? 'selected' : ''}>80mm</option>
                  <option value="58mm" ${rs.paperWidth === '58mm' ? 'selected' : ''}>58mm</option>
                </select>
              </div>
            </div>
            <div class="checkbox-row" style="margin-bottom:var(--space-2)"><input type="checkbox" id="rs_showKraPin" ${rs.showKraPin !== false ? 'checked' : ''} /><label for="rs_showKraPin" class="text-sm">Show KRA PIN</label></div>
            <div class="checkbox-row" style="margin-bottom:var(--space-2)"><input type="checkbox" id="rs_showCashierName" ${rs.showCashierName !== false ? 'checked' : ''} /><label for="rs_showCashierName" class="text-sm">Show cashier name</label></div>
            <div class="checkbox-row" style="margin-bottom:var(--space-2)"><input type="checkbox" id="rs_showMpesaReceiptCode" ${rs.showMpesaReceiptCode !== false ? 'checked' : ''} /><label for="rs_showMpesaReceiptCode" class="text-sm">Show M-PESA receipt code on receipt</label></div>
            <div class="checkbox-row"><input type="checkbox" id="rs_showLogo" ${rs.showLogo !== false ? 'checked' : ''} /><label for="rs_showLogo" class="text-sm">Show logo</label></div>
          </form>
        </div>
        <div class="card-footer" style="display:flex; justify-content:flex-end">
          <button class="btn btn-primary btn-sm" id="business-save">Save changes</button>
        </div>
      </div>
    `;
  }

  function bindBusinessCard() {
    document.getElementById('business-save').addEventListener('click', async () => {
      const raw = window.UI.serializeForm(document.getElementById('business-form'));
      const payload = {
        name: raw.name,
        phone: raw.phone,
        address: raw.address,
        kraPin: raw.kraPin,
        email: raw.email || undefined,
        county: raw.county || undefined,
        town: raw.town || undefined,
        taxPin: raw.taxPin || undefined,
        currency: raw.currency || undefined,
        timezone: raw.timezone || undefined,
        logo: raw.logo || undefined,
        vatRegistered: document.getElementById('biz_vatRegistered').checked,
        receiptSettings: {
          headerMessage: raw.rs_headerMessage,
          footerMessage: raw.rs_footerMessage,
          customLines: (raw.rs_customLines || '').split('\n').map((s) => s.trim()).filter(Boolean),
          paperWidth: raw.rs_paperWidth,
          showKraPin: document.getElementById('rs_showKraPin').checked,
          showCashierName: document.getElementById('rs_showCashierName').checked,
          showMpesaReceiptCode: document.getElementById('rs_showMpesaReceiptCode').checked,
          showLogo: document.getElementById('rs_showLogo').checked,
        },
      };
      const btn = document.getElementById('business-save');
      window.UI.setButtonLoading(btn, true, 'Saving…');
      try {
        await window.Api.put('/business', payload);
        window.UI.toast.success('Business details saved');
      } catch (err) {
        window.UI.toast.error(err.message);
      } finally {
        window.UI.setButtonLoading(btn, false);
      }
    });
  }

  /* ------------------------------------------------------------------ *
   * Sales settings (customer credit on/off)
   * ------------------------------------------------------------------ */
  function salesSettingsCard(business) {
    const s = business.settings || {};
    return `
      <div class="card" style="margin-bottom: var(--space-6)">
        <div class="card-header">
          <div><h2>Sales settings</h2><p class="text-sm text-muted">Controls what cashiers are allowed to do at checkout.</p></div>
        </div>
        <div class="card-body">
          <div class="checkbox-row" style="margin-bottom:var(--space-2)">
            <input type="checkbox" id="settings_enableCustomerCredit" ${s.enableCustomerCredit ? 'checked' : ''} />
            <label for="settings_enableCustomerCredit" class="text-sm">Allow sales on customer credit</label>
          </div>
          <p class="text-xs text-muted">
            When off, every sale must be paid in full at checkout and cashiers cannot leave a balance on a customer's account.
            When on, a cashier can complete a sale with an outstanding balance for a selected customer, as long as it's within
            that customer's credit limit (set on the Customers page).
          </p>
        </div>
        <div class="card-footer" style="display:flex; justify-content:flex-end">
          <button class="btn btn-primary btn-sm" id="sales-settings-save">Save changes</button>
        </div>
      </div>
    `;
  }

  function bindSalesSettingsCard() {
    document.getElementById('sales-settings-save').addEventListener('click', async () => {
      const payload = {
        settings: {
          enableCustomerCredit: document.getElementById('settings_enableCustomerCredit').checked,
        },
      };
      const btn = document.getElementById('sales-settings-save');
      window.UI.setButtonLoading(btn, true, 'Saving…');
      try {
        await window.Api.put('/business', payload);
        window.UI.toast.success('Sales settings saved');
      } catch (err) {
        window.UI.toast.error(err.message);
      } finally {
        window.UI.setButtonLoading(btn, false);
      }
    });
  }

  /* ------------------------------------------------------------------ *
   * Shared card chrome
   * ------------------------------------------------------------------ */
  function integrationCard({ key, title, enabled, subtitle, fieldsHtml, testButton = true }) {
    return `
      <div class="card" style="margin-bottom: var(--space-6)">
        <div class="card-header">
          <div><h2>${title}</h2><p class="text-sm text-muted">${subtitle}</p></div>
          <label class="checkbox-row"><input type="checkbox" id="${key}-enabled" ${enabled ? 'checked' : ''} /> Enabled</label>
        </div>
        <div class="card-body">
          <form id="${key}-form" onsubmit="return false">${fieldsHtml}</form>
        </div>
        <div class="card-footer" style="display:flex; justify-content:${testButton ? 'space-between' : 'flex-end'}">
          ${testButton ? `<button class="btn btn-secondary btn-sm" id="${key}-test">Test connection</button>` : ''}
          <button class="btn btn-primary btn-sm" id="${key}-save">Save changes</button>
        </div>
      </div>
    `;
  }

  /** Wires "Test connection" for a card. */
  function bindTest(key) {
    const btn = document.getElementById(`${key}-test`);
    if (!btn) return;
    btn.addEventListener('click', async () => {
      window.UI.setButtonLoading(btn, true, 'Testing…');
      try {
        const { data } = await window.Api.post(`/settings/integrations/${key}/test`);
        (data.ok ? window.UI.toast.success : window.UI.toast.error)(data.message);
      } catch (err) {
        window.UI.toast.error(err.message);
      } finally {
        window.UI.setButtonLoading(btn, false);
      }
    });
  }

  /** Wires "Save changes" for a card whose payload is built by buildPayload() (may return null to abort). */
  function bindSave(key, label, buildPayload) {
    const btn = document.getElementById(`${key}-save`);
    btn.addEventListener('click', async () => {
      const payload = buildPayload();
      if (!payload) return;
      window.UI.setButtonLoading(btn, true, 'Saving…');
      try {
        await window.Api.put(`/settings/integrations/${key}`, payload);
        window.UI.toast.success(`${label} settings saved`);
        await render();
      } catch (err) {
        window.UI.toast.error(err.message);
      } finally {
        if (document.body.contains(btn)) window.UI.setButtonLoading(btn, false);
      }
    });
  }

  /* ------------------------------------------------------------------ *
   * M-PESA STK push (PayHero)
   * ------------------------------------------------------------------ */
  function mpesaStkCard(status) {
    return integrationCard({
      key: 'mpesa', title: 'M-PESA STK push (via PayHero)', enabled: status.mpesa.enabled,
      subtitle: 'Send a payment prompt to the customer\u2019s phone at checkout.',
      fieldsHtml: `
        <div class="field"><label>Payment channel ID</label><input class="input" name="channelId" value="${esc(status.mpesa.channelId || '')}" placeholder="From PayHero &gt; Payment Channels" /></div>
        <div class="field">
          <label>Credential type</label>
          <select class="select" id="mpesa-cred-type">
            <option value="token">Basic Auth token (PayHero gave you this directly)</option>
            <option value="userpass">API username + password</option>
          </select>
        </div>
        <div id="mpesa-token-fields">
          <div class="field">
            <label>Basic Auth token ${status.mpesa.credentials?.isSet ? '<span class="badge badge-success">Saved</span>' : ''}</label>
            <input class="input" name="basicAuthToken" autocomplete="off" placeholder="Leave blank to keep existing" />
            <p class="text-xs text-muted">Paste just the token PayHero gave you - with or without a leading "Basic ", either is fine.</p>
          </div>
        </div>
        <div id="mpesa-userpass-fields" style="display:none">
          <div class="form-row">
            <div class="field"><label>API username</label><input class="input" name="apiUsername" autocomplete="off" placeholder="Leave blank to keep existing" /></div>
            <div class="field"><label>API password</label><input class="input" name="apiPassword" type="password" autocomplete="new-password" placeholder="Leave blank to keep existing" /></div>
          </div>
        </div>
        <p class="text-xs text-muted">These same PayHero credentials are also used to look up receipt codes for STK payments. The Till option below does not need them.</p>
      `,
    });
  }

  function bindMpesaCredTypeToggle() {
    const select = document.getElementById('mpesa-cred-type');
    if (!select) return;
    const toggle = () => {
      const isToken = select.value === 'token';
      document.getElementById('mpesa-token-fields').style.display = isToken ? '' : 'none';
      document.getElementById('mpesa-userpass-fields').style.display = isToken ? 'none' : '';
    };
    select.addEventListener('change', toggle);
    toggle();
  }

  function bindMpesaStk() {
    bindSave('mpesa', 'M-PESA STK', () => {
      const raw = window.UI.serializeForm(document.getElementById('mpesa-form'));
      const payload = { enabled: document.getElementById('mpesa-enabled').checked };
      const channelId = (raw.channelId || '').trim();
      if (channelId) payload.channelId = channelId;

      // Only send the credential type that is currently selected - the API rejects both at once.
      const credType = document.getElementById('mpesa-cred-type').value;
      if (credType === 'token') {
        const token = (raw.basicAuthToken || '').trim();
        if (token) payload.basicAuthToken = token;
      } else {
        const u = (raw.apiUsername || '').trim();
        const p = (raw.apiPassword || '').trim();
        if ((u || p) && !(u && p)) {
          window.UI.toast.error('Enter both the API username and the API password');
          return null;
        }
        if (u && p) { payload.apiUsername = u; payload.apiPassword = p; }
      }
      return payload;
    });
    bindTest('mpesa');
  }

  /* ------------------------------------------------------------------ *
   * M-PESA Till (Buy Goods) - manual payments
   * ------------------------------------------------------------------ */
  function tillCard(mpesa, till) {
    const enabled = till && !till.forbidden && !till.error ? till.enabled : !!mpesa.manualEnabled;
    const tillNumber = (till && till.tillNumber) || mpesa.tillNumber || '';
    const readOnly = !!(till && till.forbidden);

    return `
      <div class="card" style="margin-bottom: var(--space-6)" id="till-card">
        <div class="card-header">
          <div>
            <h2>M-PESA Till (Buy Goods)</h2>
            <p class="text-sm text-muted">Customer pays your Till from their own phone; the POS confirms the payment automatically. No STK prompt and no PayHero API credentials needed.</p>
          </div>
          <label class="checkbox-row"><input type="checkbox" id="till-enabled" ${enabled ? 'checked' : ''} ${readOnly ? 'disabled' : ''} /> Enabled</label>
        </div>
        <div class="card-body">
          <form id="till-form" onsubmit="return false">
            <div class="field" style="max-width:320px">
              <label for="till-number">Till number</label>
              <input class="input" id="till-number" name="tillNumber" inputmode="numeric" maxlength="8" autocomplete="off"
                     value="${esc(tillNumber)}" placeholder="e.g. 5123456" ${readOnly ? 'disabled' : ''} />
              <p class="text-xs text-muted">5-8 digits. This is shown to the customer on the POS payment screen.</p>
            </div>
          </form>
          ${tillWebhookBlock(till)}
        </div>
        <div class="card-footer" style="display:flex; justify-content:flex-end">
          <button class="btn btn-primary btn-sm" id="till-save" ${readOnly ? 'disabled' : ''}>Save changes</button>
        </div>
      </div>
    `;
  }

  function tillWebhookBlock(till) {
    const boxStyle = 'margin-top:var(--space-4); padding:var(--space-3); border-radius:var(--radius-md); background:var(--color-bg)';

    if (till && till.forbidden) {
      return `<div style="${boxStyle}" class="text-sm text-secondary">Only the business owner can view or change the Till setup and webhook URL. Ask the owner to configure this option.</div>`;
    }
    if (till && till.error) {
      return `
        <div style="${boxStyle}" class="text-sm">
          Could not load the webhook details: ${esc(till.error)}
          <button type="button" class="btn btn-secondary btn-sm" id="till-reload" style="margin-left:var(--space-2)">Retry</button>
        </div>`;
    }

    let urlHtml;
    if (!till.baseUrlConfigured) {
      urlHtml = `<div class="form-alert form-alert-error">The server has no <code>PUBLIC_API_BASE_URL</code> set, so a webhook URL cannot be built. Set it in the backend environment, restart, then reload this page.</div>`;
    } else if (!till.webhookUrl) {
      urlHtml = `<p class="text-sm text-secondary">Turn the option on, enter your Till number and press <strong>Save changes</strong> - your private webhook URL will appear here.</p>`;
    } else {
      urlHtml = `
        <label class="text-sm" for="till-webhook-url" style="display:block; margin-bottom:var(--space-1)"><strong>Webhook URL</strong></label>
        <div class="input-button-row">
          <input class="input" id="till-webhook-url" readonly value="${esc(till.webhookUrl)}" onfocus="this.select()" style="font-family:monospace; font-size:12px" />
          <button type="button" class="btn btn-secondary" id="till-copy">Copy</button>
        </div>
        <p class="text-xs text-muted" style="margin-top:var(--space-1)">Treat this like a password: anyone with it can post payments to your POS inbox. Payments are still matched by exact amount, and cashiers can never type in a code the provider has not reported.</p>
        <ol class="text-sm text-secondary" style="margin:var(--space-3) 0 0 var(--space-4); line-height:1.6">
          <li>Copy the URL above.</li>
          <li>In PayHero, open the payment channel/settings for your Till and paste it as the callback (webhook) URL for incoming payments.</li>
          <li>Make a small test payment to the Till, then press <strong>Refresh</strong> below - it should appear as the last payment received.</li>
        </ol>
        <div style="margin-top:var(--space-3)">
          <button type="button" class="btn btn-ghost btn-sm" id="till-regen">Regenerate URL</button>
        </div>`;
    }

    let statusHtml = '';
    if (till.webhookUrl) {
      const last = till.lastReceivedAt
        ? `Last Till payment received <strong>${esc(window.UI.formatDateTime(till.lastReceivedAt))}</strong>${till.lastReceivedAmount != null ? ` (${esc(window.UI.formatMoney(till.lastReceivedAmount / 100))})` : ''}.`
        : 'No Till payments received yet. If you have paid the Till and nothing shows here, the webhook URL is probably not set in PayHero yet.';
      statusHtml = `
        <div style="display:flex; gap:var(--space-2); align-items:center; flex-wrap:wrap; margin-top:var(--space-3)" class="text-sm text-secondary">
          <span>${last}</span>
          ${till.unclaimedCount > 0 ? `<span class="badge badge-warning">${till.unclaimedCount} unmatched</span>` : ''}
          <button type="button" class="btn btn-ghost btn-sm" id="till-reload">Refresh</button>
        </div>`;
    }

    return `
      <div style="${boxStyle}">
        ${urlHtml}
        ${statusHtml}
      </div>
      <p class="text-xs text-muted" style="margin-top:var(--space-3)">
        Cashiers see the <strong>M-PESA Till</strong> option at checkout once it is enabled and a Till number is saved.
        Payments are matched automatically when the amount is unique; otherwise the cashier asks the customer for the code in their M-PESA SMS.
      </p>`;
  }

  async function refreshTillCard() {
    const wrap = document.getElementById('till-card-wrap');
    if (!wrap) return;
    const [statusResult, till] = await Promise.all([
      window.Api.get('/settings/integrations').catch(() => null),
      loadTillSetup(),
    ]);
    const mpesa = statusResult ? statusResult.data.mpesa : {};
    wrap.innerHTML = tillCard(mpesa, till);
    bindTillCard();
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      const input = document.getElementById('till-webhook-url');
      if (!input) return false;
      input.select();
      try { return document.execCommand('copy'); } catch { return false; }
    }
  }

  function bindTillCard() {
    const saveBtn = document.getElementById('till-save');
    if (!saveBtn) return;

    document.getElementById('till-reload')?.addEventListener('click', async (e) => {
      window.UI.setButtonLoading(e.currentTarget, true, 'Loading…');
      await refreshTillCard();
    });

    document.getElementById('till-copy')?.addEventListener('click', async () => {
      const url = document.getElementById('till-webhook-url').value;
      (await copyText(url)) ? window.UI.toast.success('Webhook URL copied') : window.UI.toast.error('Could not copy - select the URL and copy it manually');
    });

    document.getElementById('till-regen')?.addEventListener('click', async () => {
      const ok = await window.UI.confirmDialog({
        title: 'Regenerate webhook URL?',
        message: 'The current URL stops working immediately. Till payments will not reach the POS until you paste the new URL into PayHero.',
        confirmText: 'Regenerate',
        danger: true,
      });
      if (!ok) return;
      try {
        await window.Api.put('/payments/mpesa/manual/setup', { regenerateToken: true });
        window.UI.toast.success('New webhook URL generated - update it in PayHero');
        await refreshTillCard();
      } catch (err) {
        window.UI.toast.error(err.message);
      }
    });

    saveBtn.addEventListener('click', async () => {
      const enabled = document.getElementById('till-enabled').checked;
      const tillNumber = document.getElementById('till-number').value.replace(/\s+/g, '');

      if (tillNumber && !TILL_RE.test(tillNumber)) return window.UI.toast.error('Till number must be 5-8 digits');
      if (enabled && !tillNumber) return window.UI.toast.error('Enter the Till number before enabling this option');

      const payload = { enabled };
      if (tillNumber) payload.tillNumber = tillNumber;

      window.UI.setButtonLoading(saveBtn, true, 'Saving…');
      try {
        await window.Api.put('/payments/mpesa/manual/setup', payload);
        window.UI.toast.success('M-PESA Till settings saved');
        await refreshTillCard(); // only this card - unsaved edits in other cards are kept
      } catch (err) {
        window.UI.toast.error(err.message);
      } finally {
        if (document.body.contains(saveBtn)) window.UI.setButtonLoading(saveBtn, false);
      }
    });
  }

  /* ------------------------------------------------------------------ *
   * eTIMS (DigiTax)
   * ------------------------------------------------------------------ */
  function etimsCard(status) {
    return integrationCard({
      key: 'etims', title: 'eTIMS (via DigiTax)', enabled: status.etims.enabled,
      subtitle: 'Transmit every sale to KRA automatically.',
      fieldsHtml: `
        <div class="form-row">
          <div class="field"><label>Environment</label>
            <select class="select" name="environment">
              <option value="sandbox" ${status.etims.environment === 'sandbox' ? 'selected' : ''}>Sandbox</option>
              <option value="production" ${status.etims.environment === 'production' ? 'selected' : ''}>Production</option>
            </select>
          </div>
          <div class="field"><label>KRA PIN</label><input class="input" name="kraPin" value="${esc(status.etims.kraPin || '')}" placeholder="P000000000A" /></div>
        </div>
        <div class="field"><label>DigiTax API key ${status.etims.credentials?.isSet ? '<span class="badge badge-success">Saved</span>' : ''}</label><input class="input" name="apiKey" autocomplete="off" placeholder="Leave blank to keep existing" /></div>
        <div class="form-row">
          <div class="field"><label>Username <span class="text-muted">(if DigiTax issued one)</span></label><input class="input" name="username" autocomplete="off" /></div>
          <div class="field"><label>Password</label><input class="input" name="password" type="password" autocomplete="new-password" /></div>
        </div>
        <p class="text-xs text-muted">Username and password are only saved together with the API key. To change them, enter the API key again.</p>
      `,
    });
  }

  function bindEtims() {
    bindSave('etims', 'eTIMS', () => {
      const raw = window.UI.serializeForm(document.getElementById('etims-form'));
      const payload = { enabled: document.getElementById('etims-enabled').checked };
      if (raw.environment) payload.environment = raw.environment;
      const pin = (raw.kraPin || '').trim();
      if (pin) payload.kraPin = pin;
      const apiKey = (raw.apiKey || '').trim();
      if (apiKey) {
        payload.apiKey = apiKey;
        if ((raw.username || '').trim()) payload.username = raw.username.trim();
        if ((raw.password || '').trim()) payload.password = raw.password.trim();
      } else if ((raw.username || '').trim() || (raw.password || '').trim()) {
        window.UI.toast.error('Enter the DigiTax API key too - username and password are saved together with it');
        return null;
      }
      return payload;
    });
    bindTest('etims');
  }
})();