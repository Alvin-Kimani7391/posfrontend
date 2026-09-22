(function () {
  let contentEl;

  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    contentEl = window.AppShell.mount({ title: 'Integrations' });
    if (!contentEl) return;
    contentEl.innerHTML = `<div class="page-header"><div><h1>Integrations</h1><p>Turn on M-PESA and eTIMS for your business, and enter your provider credentials.</p></div></div><div id="settings-body"></div>`;
    await render();
  }

  async function render() {
    const body = document.getElementById('settings-body');
    body.innerHTML = window.UI.skeletonRows(2, 1);
    let status;
    try {
      ({ data: status } = await window.Api.get('/settings/integrations'));
    } catch (err) {
      body.innerHTML = window.UI.emptyStateHtml({ icon: 'alert', title: 'Could not load settings', message: err.message });
      return;
    }

    body.innerHTML = `
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

    bindCard('mpesa');
    bindCard('etims');
    bindMpesaCredTypeToggle();
  }

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