/** offline-settings.js - OfflineSettings.mount(containerEl): offline policy (owner) + enrolled tills (managers). */
(function (window) {
  'use strict';
  const esc = (s) => window.UI.escapeHtml(s == null ? '' : String(s));
  const KES = (c) => Math.round((c || 0)) / 100;

  async function mount(root) {
    const user = window.Storage.getUser();
    if (!window.Permissions.can(user, 'devices.manage')) return;
    const wrap = document.createElement('div');
    wrap.innerHTML = '<div class="section-label" style="margin:var(--space-2) 0 var(--space-3)"><h2 style="font-size:var(--text-lg,1.125rem)">Offline selling</h2></div><div id="ofs-policy"></div><div id="ofs-devices"></div>';
    root.appendChild(wrap);
    await Promise.all([policy(wrap.querySelector('#ofs-policy'), user), devices(wrap.querySelector('#ofs-devices'))]);
  }

  async function policy(box, user) {
    let p;
    try { p = (await window.Api.get('/devices/policy')).data.policy; } catch (e) { box.innerHTML = `<p class="text-sm text-muted">Could not load offline settings: ${esc(e.message)}</p>`; return; }
    const owner = user.role === 'OWNER';
    const chk = (k, label, hint) => `<div class="checkbox-row" style="margin-bottom:var(--space-2)"><input type="checkbox" id="of_${k}" ${p[k] ? 'checked' : ''} ${owner ? '' : 'disabled'} /><label for="of_${k}" class="text-sm">${label}</label></div>${hint ? `<p class="text-xs text-muted" style="margin:-4px 0 var(--space-3) 26px">${hint}</p>` : ''}`;
    const num = (k, label, val, hint) => `<div class="field"><label>${label}</label><input class="input" id="of_${k}" type="number" min="0" step="1" value="${val}" ${owner ? '' : 'disabled'} />${hint ? `<span class="field-hint">${hint}</span>` : ''}</div>`;
    box.innerHTML = `<div class="card" style="margin-bottom:var(--space-6)">
      <div class="card-header"><div><h2>Offline policy</h2><p class="text-sm text-muted">Rules every till in this business must follow when the internet is down. Only the owner can change them. Each till can only be stricter.</p></div></div>
      <div class="card-body">
        ${chk('enabled', '<strong>Allow offline selling</strong>')}
        <div class="form-row">
          ${num('maxOfflineHours', 'Longest offline window (hours)', p.maxOfflineHours, 'Till refuses new sales after this long without a server visit. Confirm KRA/DigiTax limits first.')}
          ${num('sharedDeviceMaxOfflineHours', 'Shared devices: window (hours)', p.sharedDeviceMaxOfflineHours)}
        </div>
        <div class="form-row">
          ${num('maxPendingSales', 'Max unsynced sales per till', p.maxPendingSales)}
          ${num('maxPendingValue', 'Max unsynced value per till (KES)', KES(p.maxPendingValueCents))}
        </div>
        <div class="form-row">
          ${num('sessionHours', 'Offline unlock stays valid (hours)', p.sessionHours)}
          ${num('maxDiscountPercent', 'Max discount offline (%)', p.maxDiscountPercent, 'Applies to every role, owners included.')}
        </div>
        <div class="form-row">
          <div class="field"><label>New tills are</label><select class="select" id="of_defaultDeviceMode" ${owner ? '' : 'disabled'}><option value="DEDICATED" ${p.defaultDeviceMode === 'DEDICATED' ? 'selected' : ''}>Dedicated (one cashier)</option><option value="SHARED" ${p.defaultDeviceMode === 'SHARED' ? 'selected' : ''}>Shared (PIN switching)</option></select></div>
          <div class="field"><label>Offline M-PESA approval</label><select class="select" id="of_manualMpesaApproval" ${owner ? '' : 'disabled'}><option value="UNMATCHED_ONLY" ${p.manualMpesaApproval === 'UNMATCHED_ONLY' ? 'selected' : ''}>Auto-verify matches, manager approves the rest</option><option value="ALWAYS" ${p.manualMpesaApproval === 'ALWAYS' ? 'selected' : ''}>Manager approves every payment</option></select></div>
        </div>
        ${chk('allowManualMpesa', 'Allow M-PESA Till payments offline', 'Cashier records the customer\u2019s M-PESA code and phone. The server checks it when the till reconnects.')}
        ${num('maxManualMpesa', 'Offline M-PESA above this amount always needs approval (KES)', KES(p.maxManualMpesaCents))}
        ${chk('allowCard', 'Allow card / bank payments offline', 'These cannot be verified offline. Leave off unless you accept the risk.')}
        ${chk('syncCustomers', 'Download customer names/phones to tills', 'Needed for offline credit. Puts personal data on the device (Data Protection Act).')}
        ${chk('allowCredit', 'Allow customer credit offline')}
        ${chk('allowRefunds', 'Allow refunds offline (not yet supported by the till)')}
        ${chk('allowShiftCloseWithPending', 'Allow closing a shift while sales are still unsynced')}
      </div>
      ${owner ? '<div class="card-footer" style="display:flex;justify-content:flex-end"><button class="btn btn-primary btn-sm" id="ofs-save">Save offline policy</button></div>' : ''}</div>`;
    if (!owner) return;
    box.querySelector('#ofs-save').addEventListener('click', async (e) => {
      const g = (id) => box.querySelector(`#of_${id}`);
      const payload = {
        enabled: g('enabled').checked, allowManualMpesa: g('allowManualMpesa').checked, allowCard: g('allowCard').checked,
        syncCustomers: g('syncCustomers').checked, allowCredit: g('allowCredit').checked, allowRefunds: g('allowRefunds').checked,
        allowShiftCloseWithPending: g('allowShiftCloseWithPending').checked,
        maxOfflineHours: Number(g('maxOfflineHours').value), sharedDeviceMaxOfflineHours: Number(g('sharedDeviceMaxOfflineHours').value),
        maxPendingSales: Number(g('maxPendingSales').value), sessionHours: Number(g('sessionHours').value),
        maxDiscountPercent: Number(g('maxDiscountPercent').value),
        maxPendingValueCents: Math.round(Number(g('maxPendingValue').value) * 100), maxManualMpesaCents: Math.round(Number(g('maxManualMpesa').value) * 100),
        defaultDeviceMode: g('defaultDeviceMode').value, manualMpesaApproval: g('manualMpesaApproval').value,
      };
      window.UI.setButtonLoading(e.currentTarget, true, 'Saving…');
      try { await window.Api.put('/devices/policy', payload); window.UI.toast.success('Offline policy saved'); }
      catch (err) { window.UI.toast.error(err.message); }
      finally { window.UI.setButtonLoading(e.currentTarget, false); }
    });
  }

  async function devices(box) {
    let items;
    try { items = (await window.Api.get('/devices')).data.items; } catch (e) { box.innerHTML = ''; return; }
    box.innerHTML = `<div class="card" style="margin-bottom:var(--space-6)"><div class="card-header"><div><h2>Tills</h2><p class="text-sm text-muted">Set up a till from the till itself: tap the status chip, then "Set up this till". A lost or stolen till: block it here; its unsynced sales are held for your review, never lost.</p></div></div>
      <div class="table-wrap"><table class="table"><thead><tr><th>Till</th><th>Branch</th><th>Mode</th><th>Offline</th><th>Last seen</th><th>Unsynced</th><th>Status</th><th></th></tr></thead><tbody>
      ${items.length ? items.map((d) => `<tr data-id="${d._id}"><td class="cell-primary">${esc(d.deviceName)} <span class="text-xs text-muted">${esc(d.deviceCode || '')}</span></td><td>${esc((d.branchId || {}).name || '')}</td>
        <td>${esc(d.mode)}</td><td>${d.offlineEnabled ? 'On' : 'Off'}</td><td class="text-sm">${d.lastSeenAt ? window.UI.formatDateTime(d.lastSeenAt) : '-'}</td><td>${d.lastPendingCount || 0}</td>
        <td><span class="badge ${d.status === 'active' ? 'badge-success' : 'badge-danger'}">${d.status === 'active' ? 'Active' : 'Blocked'}</span></td>
        <td class="actions">${d.status === 'active' ? `<button class="btn btn-secondary btn-sm" data-a="toggle">${d.offlineEnabled ? 'Turn offline off' : 'Turn offline on'}</button><button class="btn btn-secondary btn-sm" data-a="mode">${d.mode === 'SHARED' ? 'Make dedicated' : 'Make shared'}</button><button class="btn btn-danger btn-sm" data-a="revoke">Block</button>` : ''}</td></tr>`).join('') : '<tr><td colspan="8" class="text-muted" style="padding:var(--space-5)">No tills set up yet.</td></tr>'}
      </tbody></table></div></div>`;
    box.querySelectorAll('tr[data-id]').forEach((tr) => {
      const d = items.find((x) => x._id === tr.dataset.id);
      tr.querySelectorAll('[data-a]').forEach((b) => b.addEventListener('click', async () => {
        try {
          if (b.dataset.a === 'toggle') await window.Api.patch(`/devices/${d._id}`, { offlineEnabled: !d.offlineEnabled });
          if (b.dataset.a === 'mode') await window.Api.patch(`/devices/${d._id}`, { mode: d.mode === 'SHARED' ? 'DEDICATED' : 'SHARED' });
          if (b.dataset.a === 'revoke') {
            const reason = window.prompt('Why is this till being blocked? (e.g. stolen)'); if (!reason) return;
            await window.Api.post(`/devices/${d._id}/revoke`, { reason });
          }
          window.UI.toast.success('Updated'); devices(box);
        } catch (err) { window.UI.toast.error(err.message); }
      }));
    });
  }

  window.OfflineSettings = { mount };
})(window);
