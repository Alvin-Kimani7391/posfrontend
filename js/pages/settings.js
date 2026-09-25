(function () {
  let contentEl;

  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    contentEl = window.AppShell.mount({ title: 'Settings' });
    if (!contentEl) return;
    contentEl.innerHTML = `<div class="page-header"><div><h1>Settings</h1><p>Your business details, receipt layout, and payment/tax integrations.</p></div></div><div id="settings-body"></div>`;
    await render();
  }

  async function render() {
    const body = document.getElementById('settings-body');
    body.innerHTML = window.UI.skeletonRows(3, 1);

    const [statusResult, businessResult] = await Promise.allSettled([
      window.Api.get('/settings/integrations'),
      window.Api.get('/business'),
    ]);

    if (statusResult.status === 'rejected') {
      body.innerHTML = window.UI.emptyStateHtml({ icon: 'alert', title: 'Could not load settings', message: statusResult.reason.message });
      return;
    }
    const status = statusResult.value.data;
    const business = businessResult.status === 'fulfilled' ? businessResult.value.data.business : null;

    body.innerHTML = `
      ${business ? businessCard(business) : ''}
      ${integrationCard({
        key: 'mpesa', title: 'M-PESA (via PayHero)', enabled: status.mpesa.enabled,
        subtitle: 'Let customers pay by STK push at checkout.',
        fieldsHtml: `
          <div class="field"><label>Payment channel ID</label><input class="input" name="channelId" value="${window.UI.escapeHtml(status.mpesa.channelId || '')}" placeholder="From PayHero &gt; Payment Channels" /></div>
          <div class="field">
            <label>Credential type</label>
            <select class="select" id="mpesa-cred-type">
              <option value="token">Basic Auth token (PayHero gave you this directly)</option>
              <option value="userpass">API username + password</option>
            </select>
          </div>
          <div id="mpesa-token-fields">
            <div class="field">
              <label>Basic Auth token ${status.mpesa.credentials.isSet ? '<span class="badge badge-success">Saved</span>' : ''}</label>
              <input class="input" name="basicAuthToken" placeholder="Leave blank to keep existing" />
              <p class="text-xs text-muted">Paste just the token PayHero gave you - with or without a leading "Basic ", either is fine.</p>
            </div>
          </div>
          <div id="mpesa-userpass-fields" style="display:none">
            <div class="form-row">
              <div class="field"><label>API username</label><input class="input" name="apiUsername" placeholder="Leave blank to keep existing" /></div>
              <div class="field"><label>API password</label><input class="input" name="apiPassword" type="password" placeholder="Leave blank to keep existing" /></div>
            </div>
          </div>
        `,
      })}
      ${integrationCard({
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
            <div class="field"><label>KRA PIN</label><input class="input" name="kraPin" value="${window.UI.escapeHtml(status.etims.kraPin || '')}" placeholder="P000000000A" /></div>
          </div>
          <div class="field"><label>DigiTax API key ${status.etims.credentials.isSet ? '<span class="badge badge-success">Saved</span>' : ''}</label><input class="input" name="apiKey" placeholder="Leave blank to keep existing" /></div>
          <div class="form-row">
            <div class="field"><label>Username <span class="text-muted">(if DigiTax issued one)</span></label><input class="input" name="username" /></div>
            <div class="field"><label>Password</label><input class="input" name="password" type="password" /></div>
          </div>
        `,
      })}
    `;

    if (business) bindBusinessCard();
    bindCard('mpesa');
    bindCard('etims');
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
          <div><h2>Business & receipt details</h2><p class="text-sm text-muted">What appears on every printed receipt.</p></div>
        </div>
        <div class="card-body">
          <form id="business-form">
            <div class="form-row">
              <div class="field"><label>Business name</label><input class="input" name="name" value="${window.UI.escapeHtml(business.name || '')}" /></div>
              <div class="field"><label>Phone</label><input class="input" name="phone" value="${window.UI.escapeHtml(business.phone || '')}" /></div>
            </div>
            <div class="form-row">
              <div class="field"><label>Address</label><input class="input" name="address" value="${window.UI.escapeHtml(business.address || '')}" /></div>
              <div class="field"><label>KRA PIN</label><input class="input" name="kraPin" value="${window.UI.escapeHtml(business.kraPin || '')}" /></div>
            </div>
            <div class="field"><label>Receipt header message <span class="text-muted">(optional)</span></label><input class="input" name="rs_headerMessage" value="${window.UI.escapeHtml(rs.headerMessage || '')}" placeholder="e.g. Welcome to..." /></div>
            <div class="field"><label>Receipt footer message</label><input class="input" name="rs_footerMessage" value="${window.UI.escapeHtml(rs.footerMessage || '')}" /></div>
            <div class="field"><label>Extra line(s) <span class="text-muted">(one per line, e.g. return policy)</span></label><textarea class="textarea" name="rs_customLines" rows="2">${window.UI.escapeHtml((rs.customLines || []).join('\n'))}</textarea></div>
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
        name: raw.name, phone: raw.phone, address: raw.address, kraPin: raw.kraPin,
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
   * M-PESA / eTIMS integration cards
   * ------------------------------------------------------------------ */
  function integrationCard({ key, title, enabled, subtitle, fieldsHtml }) {
    return `
      <div class="card" style="margin-bottom: var(--space-6)">
        <div class="card-header">
          <div><h2>${title}</h2><p class="text-sm text-muted">${subtitle}</p></div>
          <label class="checkbox-row"><input type="checkbox" id="${key}-enabled" ${enabled ? 'checked' : ''} /> Enabled</label>
        </div>
        <div class="card-body">
          <form id="${key}-form">${fieldsHtml}</form>
        </div>
        <div class="card-footer" style="display:flex; justify-content:space-between">
          <button class="btn btn-secondary btn-sm" id="${key}-test">Test connection</button>
          <button class="btn btn-primary btn-sm" id="${key}-save">Save changes</button>
        </div>
      </div>
    `;
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

  function bindCard(key) {
    document.getElementById(`${key}-save`).addEventListener('click', async () => {
      const raw = window.UI.serializeForm(document.getElementById(`${key}-form`));
      const payload = { enabled: document.getElementById(`${key}-enabled`).checked, ...Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== '')) };
      const btn = document.getElementById(`${key}-save`);
      window.UI.setButtonLoading(btn, true, 'Saving…');
      try {
        await window.Api.put(`/settings/integrations/${key}`, payload);
        window.UI.toast.success(`${key === 'mpesa' ? 'M-PESA' : 'eTIMS'} settings saved`);
        await render();
      } catch (err) {
        window.UI.toast.error(err.message);
      } finally {
        window.UI.setButtonLoading(btn, false);
      }
    });

    document.getElementById(`${key}-test`).addEventListener('click', async () => {
      const btn = document.getElementById(`${key}-test`);
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
})();