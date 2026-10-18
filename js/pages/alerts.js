/**
 * alerts.js - the "Alerts" tab of the SMS & Alerts page (sms.html). Exposes window.AlertsPanel.mount(container, { goto }).
 * ONE place where the owner decides which alerts the business uses.
 *
 *  - In-app notifications (free): low stock, out of stock, expiry watch (daily).
 *  - Texts to the owner (SMS credits): low stock summary, expiry summary.
 *  - Texts to customers (SMS credits): ready for collection, uncollected reminder, service due, warranty ending,
 *    insurance ending, layaway due.
 *  - Delivery: sender ID and quiet hours.
 *
 * Alerts that do not fit the business (no repairs, no vehicles, no warranty, no layaway, no expiry tracking...) are
 * hidden, so each owner only sees what applies. Everything is OFF for texts until switched on: each text costs credits.
 * Data: GET/PUT /alert-prefs (in-app) and GET/PUT /sms-alerts/settings (texts). The server enforces every rule.
 */
(function () {
  const esc = (v) => window.UI.escapeHtml(v == null ? '' : v);
  const user = () => window.AppShell.getUser();
  const can = (p) => window.Permissions.can(user(), p);
  const feat = (...k) => !!(window.AppShell.hasFeature && window.AppShell.hasFeature(...k));

  const S = { goto: null, prefs: null, sms: null, smsError: '', editable: false, recent: null };
  const BLOCKER_TEXT = {
    NO_CREDITS: 'You have no SMS credits, so texts will not send. Buy credits in the Buy SMS tab.',
    NO_SENDER_ID: 'No Sender ID is available yet. Apply for your own in the Sender ID tab or contact support.',
    ALERTS_PAUSED: 'SMS alerts are temporarily paused by the platform. They will resume automatically.',
  };
  const PURPOSE = { READY: 'Ready for collection', READY_REMINDER: 'Not collected', SERVICE_DUE: 'Service due', SERVICE_OVERDUE: 'Service overdue', WARRANTY_EXPIRING: 'Warranty ending', INSURANCE_EXPIRING: 'Insurance ending', LAYAWAY_DUE: 'Layaway due', LAYAWAY_OVERDUE: 'Layaway overdue', EXPIRY_DIGEST: 'Expiry text', LOW_STOCK_DIGEST: 'Low stock text', OWNER_TEST: 'Test text' };

  /* --------------------------- what exists, and who it applies to --------------------------- */
  // Text alerts. `fields` drive both the form and the save payload. `tpl` fields get a live preview.
  const SMS_ITEMS = [
    { group: 'owner', key: 'lowStockDigest', title: 'Low stock text to you', show: () => true,
      desc: 'A short text to the owner listing products that are running low or out of stock.',
      hint: 'Placeholders: {shop} {low} {out} {items}',
      fields: [
        { name: 'frequency', type: 'select', label: 'How often', options: [['weekly', 'Weekly summary (cheapest)'], ['daily', 'Every day something is low']] },
        { name: 'includeOutOfStock', type: 'check', label: 'Include products that are out of stock' },
        { name: 'template', type: 'tpl', kind: 'lowStockDigest', label: 'Message' },
      ] },
    { group: 'owner', key: 'expiryDigest', title: 'Expiry text to you', show: () => feat('expiryTracking', 'batchTracking'),
      desc: 'A short text to the owner when stock is expired or about to expire.',
      hint: 'Placeholders: {shop} {expired} {expiring} {days} {items}',
      fields: [
        { name: 'frequency', type: 'select', label: 'How often', options: [['weekly', 'Weekly summary (cheapest)'], ['daily', 'Every day something is expiring']] },
        { name: 'daysBefore', type: 'number', min: 1, max: 180, label: 'Report stock expiring within (days)' },
        { name: 'template', type: 'tpl', kind: 'expiryDigest', label: 'Message' },
      ],
      actions: [{ id: 'run-expiry', label: 'Check expiry now', perm: 'batches.manage', note: 'Runs the check with the saved settings and notifies management.' }] },
    { group: 'customer', key: 'ready', title: 'Ready for collection', show: () => feat('repairManagement', 'jobCards'),
      desc: 'Text the customer the moment their repair or job card is ready.',
      hint: 'Placeholders: {name} {item} {job} {shop} {shopPhone} {balanceText}',
      fields: [{ name: 'template', type: 'tpl', kind: 'ready', label: 'Message' }] },
    { group: 'customer', key: 'readyReminder', title: 'Still not collected', show: () => feat('repairManagement', 'jobCards'),
      desc: 'Remind customers whose finished item is still waiting.',
      hint: 'Placeholders: {name} {item} {job} {shop} {days}',
      fields: [
        { name: 'afterDays', type: 'days', label: 'Remind after (days, up to 5, e.g. 3, 7, 14)' },
        { name: 'template', type: 'tpl', kind: 'readyReminder', label: 'Message' },
      ] },
    { group: 'customer', key: 'serviceDue', title: 'Vehicle service due', show: () => feat('vehicleManagement'),
      desc: 'Remind vehicle owners when their next service is coming up or overdue.',
      hint: 'Placeholders: {name} {item} {plate} {dueText} {shop} {shopPhone}',
      fields: [
        { name: 'daysBefore', type: 'number', min: 0, max: 60, label: 'Remind this many days before' },
        { name: 'kmWindow', type: 'number', min: 0, max: 10000, label: 'Or when within this many km of the next service' },
        { name: 'template', type: 'tpl', kind: 'serviceDue', label: 'Message: due soon' },
        { name: 'overdueTemplate', type: 'tpl', kind: 'serviceOverdue', label: 'Message: overdue' },
      ] },
    { group: 'customer', key: 'insuranceExpiring', title: 'Vehicle insurance ending', show: () => feat('vehicleManagement'),
      desc: 'Warn vehicle owners before their insurance expires.',
      hint: 'Placeholders: {name} {item} {plate} {date} {shop}',
      fields: [
        { name: 'daysBefore', type: 'number', min: 1, max: 90, label: 'Remind this many days before' },
        { name: 'template', type: 'tpl', kind: 'insuranceExpiring', label: 'Message' },
      ] },
    { group: 'customer', key: 'warrantyExpiring', title: 'Warranty ending', show: () => feat('warrantyManagement'),
      desc: 'Tell customers before the warranty on something they bought ends.',
      hint: 'Placeholders: {name} {item} {date} {shop}',
      fields: [
        { name: 'daysBefore', type: 'number', min: 1, max: 90, label: 'Remind this many days before' },
        { name: 'template', type: 'tpl', kind: 'warrantyExpiring', label: 'Message' },
      ] },
    { group: 'customer', key: 'layawayDue', title: 'Layaway payment due', show: () => feat('layaway'),
      desc: 'Remind customers about unpaid layaway balances, before and after the due date.',
      hint: 'Placeholders: {name} {job} {date} {balance} {shop} {shopPhoneText}',
      fields: [
        { name: 'daysBefore', type: 'number', min: 0, max: 30, label: 'Remind this many days before' },
        { name: 'template', type: 'tpl', kind: 'layawayDue', label: 'Message: due soon' },
        { name: 'overdueTemplate', type: 'tpl', kind: 'layawayOverdue', label: 'Message: overdue' },
      ] },
  ];

  /* --------------------------- page --------------------------- */
  async function mount(container, opts = {}) {
    S.goto = typeof opts.goto === 'function' ? opts.goto : (tab) => { window.location.href = `sms.html?tab=${tab}`; };
    injectStyles();
    container.innerHTML = `
      <p class="text-secondary text-sm" style="margin:0 0 var(--space-4)">Choose which alerts your business uses and how you are told. Notifications in the app are free. Texts use SMS credits.</p>
      <div id="al-root"><p class="text-muted">Loading…</p></div>`;
    await (window.AppShell.whenProfileReady ? window.AppShell.whenProfileReady() : Promise.resolve());
    S.editable = can('settings.update');
    await load();
    render();
  }

  window.AlertsPanel = { mount, current: () => S.sms };

  function injectStyles() {
    if (document.getElementById('al-styles')) return;
    const st = document.createElement('style'); st.id = 'al-styles';
    st.textContent = `
      .al-group-title{margin:var(--space-6) 0 var(--space-3);font-size:var(--text-sm);text-transform:uppercase;letter-spacing:.04em;color:var(--color-text-secondary)}
      .al-item{border-bottom:1px solid var(--color-border)}
      .al-item:last-child{border-bottom:0}
      .al-head{display:flex;align-items:center;justify-content:space-between;gap:var(--space-3);padding:var(--space-4) 0;cursor:pointer}
      .al-title{display:flex;flex-direction:column;gap:2px;min-width:0}
      .al-title small{color:var(--color-text-secondary);font-size:var(--text-xs);line-height:1.4}
      .al-side{display:flex;align-items:center;gap:var(--space-3);flex-shrink:0}
      .al-side input[type=checkbox]{width:22px;height:22px;accent-color:var(--color-primary)}
      .al-body{display:none;padding:0 0 var(--space-4)}
      .al-item.on .al-body{display:block}
      .al-body .field{margin-bottom:var(--space-3)}
      .al-prev{white-space:pre-wrap;word-break:break-word}
      .al-savebar{position:sticky;bottom:0;z-index:5;display:flex;gap:var(--space-3);align-items:center;justify-content:space-between;flex-wrap:wrap;padding:var(--space-3) var(--space-4);margin-top:var(--space-6);background:var(--color-surface,var(--color-bg));border-top:1px solid var(--color-border)}
      .al-strip{display:flex;flex-wrap:wrap;gap:var(--space-4);align-items:center;justify-content:space-between}
      .al-actions{display:flex;flex-wrap:wrap;gap:var(--space-2)}
      .al-recent td,.al-recent th{font-size:var(--text-sm);vertical-align:top}
      @media (max-width:640px){.al-head{align-items:flex-start}}`;
    document.head.appendChild(st);
  }

  async function load() {
    const [prefs, sms] = await Promise.allSettled([window.Api.get('/alert-prefs'), window.Api.get('/sms-alerts/settings')]);
    S.prefs = prefs.status === 'fulfilled' ? prefs.value.data : null;
    S.sms = sms.status === 'fulfilled' ? sms.value.data : null;
    S.smsError = sms.status === 'rejected' ? (sms.reason && sms.reason.code === 'COUNTRY_NOT_SUPPORTED' ? 'Text (SMS) alerts are available for businesses in Kenya.' : (sms.reason && sms.reason.message) || 'Text alerts could not be loaded.') : '';
    S.loadError = prefs.status === 'rejected' ? (prefs.reason && prefs.reason.message) || 'Could not load your alert settings.' : '';
    await loadRecent();
  }

  async function loadRecent() {
    S.recent = null;
    if (!S.sms) return;
    try { S.recent = (await window.Api.get('/sms-alerts/messages', { limit: 10 })).data.items || []; } catch (e) { S.recent = null; /* no permission to view: hide the list */ }
  }

  /* --------------------------- rendering --------------------------- */
  const costBadge = (sms) => (sms ? '<span class="badge badge-warning">Uses SMS credits</span>' : '<span class="badge badge-success">Free</span>');

  function itemHtml({ id, title, desc, cost, enabled, body }) {
    return `
      <section class="al-item ${enabled ? 'on' : ''}" data-item="${esc(id)}">
        <label class="al-head">
          <span class="al-title"><strong>${esc(title)}</strong><small>${esc(desc)}</small></span>
          <span class="al-side">${costBadge(cost === 'sms')}<input type="checkbox" class="al-toggle" name="${esc(id)}.enabled" ${enabled ? 'checked' : ''} ${S.editable ? '' : 'disabled'} aria-label="${esc(title)}" /></span>
        </label>
        <div class="al-body">${body || ''}</div>
      </section>`;
  }

  function fieldHtml(item, f, cfg) {
    const name = `${item.key}.${f.name}`;
    const v = cfg ? cfg[f.name] : '';
    const dis = S.editable ? '' : 'disabled';
    if (f.type === 'check') return `<div class="field"><label class="checkbox-row"><input type="checkbox" name="${name}" ${v ? 'checked' : ''} ${dis} /> <span class="text-sm">${esc(f.label)}</span></label></div>`;
    if (f.type === 'select') return `<div class="field"><label>${esc(f.label)}</label><select class="select" name="${name}" ${dis}>${f.options.map(([val, lab]) => `<option value="${esc(val)}" ${String(val) === String(v) ? 'selected' : ''}>${esc(lab)}</option>`).join('')}</select></div>`;
    if (f.type === 'number') return `<div class="field"><label>${esc(f.label)}</label><input class="input" type="number" inputmode="numeric" min="${f.min}" max="${f.max}" name="${name}" value="${esc(v)}" style="max-width:140px" ${dis} /></div>`;
    if (f.type === 'days') return `<div class="field"><label>${esc(f.label)}</label><input class="input" name="${name}" value="${esc((v || []).join(', '))}" style="max-width:220px" ${dis} /></div>`;
    // tpl
    const def = (S.sms.defaults || {})[f.kind === 'serviceOverdue' ? 'serviceOverdue' : f.kind === 'layawayOverdue' ? 'layawayOverdue' : f.kind] || '';
    return `<div class="field"><label>${esc(f.label)} <span class="text-muted">(empty = standard message)</span></label>
      <textarea class="textarea" rows="3" name="${name}" data-kind="${esc(f.kind)}" placeholder="${esc(def)}" ${dis}>${esc(v || '')}</textarea>
      <div class="field-hint al-prev" data-prev-for="${name}">&nbsp;</div></div>`;
  }

  function smsItemHtml(item) {
    const cfg = S.sms.settings[item.key] || {};
    const body = item.fields.map((f) => fieldHtml(item, f, cfg)).join('')
      + `<div class="field-hint">${esc(item.hint || '')}</div>`
      + (item.actions || []).filter((a) => can(a.perm)).map((a) => `<div style="margin-top:var(--space-2)"><button type="button" class="btn btn-secondary btn-sm" data-action="${a.id}">${esc(a.label)}</button> <span class="text-xs text-muted">${esc(a.note)}</span></div>`).join('')
      + (item.key === 'lowStockDigest' && can('settings.update') ? '<div style="margin-top:var(--space-2)"><button type="button" class="btn btn-secondary btn-sm" data-action="send-lowstock">Send a text now</button> <span class="text-xs text-muted">Uses the saved settings (once an hour at most).</span></div>' : '');
    return itemHtml({ id: item.key, title: item.title, desc: item.desc, cost: 'sms', enabled: !!cfg.enabled, body });
  }

  function render() {
    const host = document.getElementById('al-root');
    if (S.loadError && !S.prefs && !S.sms) { host.innerHTML = `<div class="card"><div class="card-body">${esc(S.loadError)}</div></div>`; return; }
    const p = S.prefs || { lowStockNotify: true, outOfStockNotify: true, expiry: { criticalDays: 30, warningDays: 90, notifyEnabled: true } };
    const expOn = feat('expiryTracking', 'batchTracking');
    const sms = S.sms;
    const ownerSms = sms ? SMS_ITEMS.filter((i) => i.group === 'owner' && i.show()) : [];
    const custSms = sms ? SMS_ITEMS.filter((i) => i.group === 'customer' && i.show()) : [];

    const senderLine = sms && sms.approvedSenderIds && sms.approvedSenderIds.length ? esc(sms.approvedSenderIds.join(', '))
      : sms && sms.defaultSenderId ? `${esc(sms.defaultSenderId)} <span class="text-muted">(shared, free)</span>`
        : '<span style="color:var(--color-warning)">none available yet</span>';
    const strip = sms ? `
      <div class="card" style="margin-bottom:var(--space-4)"><div class="card-body al-strip">
        <div class="text-sm"><strong>SMS credits:</strong> ${esc(String(sms.credits))} &nbsp;&middot;&nbsp; <strong>Texts are sent as:</strong> ${senderLine}
          ${sms.ready ? '<div class="text-xs" style="color:var(--color-success);margin-top:4px">Everything is in place. Alerts you switch on will be sent.</div>'
    : (sms.blockers || []).map((k) => `<div class="text-xs" style="color:var(--color-warning);margin-top:4px">${esc(BLOCKER_TEXT[k] || k)}</div>`).join('')}</div>
        <div class="al-actions">
          ${S.editable && sms.ready ? '<button type="button" class="btn btn-secondary btn-sm" data-action="send-test">Send me a test text</button>' : ''}
          <button type="button" class="btn btn-secondary btn-sm" data-goto="buy">Buy SMS credits</button>
          <button type="button" class="btn btn-secondary btn-sm" data-goto="senderid">Sender ID</button>
        </div>
      </div></div>` : '';

    const inApp = `
      <h3 class="al-group-title">Notifications in the app</h3>
      <div class="card"><div class="card-body" style="padding-top:0;padding-bottom:0">
        ${itemHtml({ id: 'lowStockNotify', title: 'Low stock', desc: 'Notify owners and managers when a product runs low.', cost: 'free', enabled: p.lowStockNotify })}
        ${itemHtml({ id: 'outOfStockNotify', title: 'Out of stock', desc: 'Notify owners and managers when a product runs out.', cost: 'free', enabled: p.outOfStockNotify })}
        ${expOn ? itemHtml({
          id: 'expiryNotify', title: 'Expiry watch (every morning)', desc: 'A daily summary of stock that is expired or about to expire.', cost: 'free', enabled: p.expiry.notifyEnabled,
          body: `<div class="form-row"><div class="field"><label>Red alert: expires within (days)</label><input class="input" type="number" min="1" max="365" name="expiry.criticalDays" value="${esc(p.expiry.criticalDays)}" style="max-width:140px" ${S.editable ? '' : 'disabled'} /></div>
                 <div class="field"><label>Orange alert: expires within (days)</label><input class="input" type="number" min="1" max="730" name="expiry.warningDays" value="${esc(p.expiry.warningDays)}" style="max-width:140px" ${S.editable ? '' : 'disabled'} /></div></div>`,
        }) : ''}
      </div></div>`;

    const ownerCard = ownerSms.length ? `
      <h3 class="al-group-title">Texts to you (the owner)</h3>
      <div class="card"><div class="card-body" style="padding-top:0;padding-bottom:0">${ownerSms.map(smsItemHtml).join('')}</div></div>` : '';

    const custCard = custSms.length ? `
      <h3 class="al-group-title">Texts to your customers</h3>
      <div class="card"><div class="card-body" style="padding-top:0;padding-bottom:0">${custSms.map(smsItemHtml).join('')}</div></div>` : '';

    const q = sms ? sms.settings.quietHours : null;
    const delivery = sms ? `
      <h3 class="al-group-title">How texts are sent</h3>
      <div class="card"><div class="card-body">
        <div class="field"><label>Send texts as (Sender ID)</label>
          <select class="select" name="delivery.senderId" style="max-width:260px" ${S.editable ? '' : 'disabled'}>
            <option value="">${sms.approvedSenderIds && sms.approvedSenderIds.length ? 'First approved Sender ID' : sms.defaultSenderId ? `Shared Sender ID (${esc(sms.defaultSenderId)})` : 'Automatic'}</option>
            ${(sms.approvedSenderIds || []).map((s) => `<option value="${esc(s)}" ${s === sms.settings.senderId ? 'selected' : ''}>${esc(s)}</option>`).join('')}
          </select></div>
        <div class="field"><label class="checkbox-row"><input type="checkbox" name="delivery.quiet" ${q.enabled ? 'checked' : ''} ${S.editable ? '' : 'disabled'} /> <span class="text-sm">Quiet hours: hold texts outside these hours until morning (Nairobi time)</span></label></div>
        <div class="form-row">
          <div class="field"><label>From (hour, 0 to 23)</label><input class="input" type="number" min="0" max="23" name="delivery.start" value="${esc(q.startHour)}" style="max-width:120px" ${S.editable ? '' : 'disabled'} /></div>
          <div class="field"><label>Until (hour, 1 to 24)</label><input class="input" type="number" min="1" max="24" name="delivery.end" value="${esc(q.endHour)}" style="max-width:120px" ${S.editable ? '' : 'disabled'} /></div>
        </div>
      </div></div>` : '';

    const smsNote = !sms && S.smsError ? `<div class="card" style="margin-top:var(--space-4)"><div class="card-body text-sm text-secondary">${esc(S.smsError)}</div></div>` : '';

    host.innerHTML = `
      <form id="al-form" novalidate>
        ${strip}${inApp}${ownerCard}${custCard}${delivery}<div id="al-recent">${recentHtml()}</div>${smsNote}
        <div class="al-savebar">
          <span class="text-sm text-secondary">${S.editable ? 'Changes apply after you press Save.' : 'Only the owner can change alert settings.'}</span>
          ${S.editable ? '<button type="submit" class="btn btn-primary" id="al-save">Save alerts</button>' : ''}
        </div>
      </form>`;
    bind(host);
  }

  function recentHtml() {
    return S.recent ? `
      <h3 class="al-group-title">Recent texts</h3>
      <div class="card"><div class="table-wrap flat al-recent"><table class="table"><thead><tr><th>When</th><th>Alert</th><th>To</th><th>Status</th></tr></thead><tbody>
        ${S.recent.map((m) => {
    const held = m.status === 'queued' && m.nextAttemptAt && new Date(m.nextAttemptAt).getTime() > Date.now() + 60000;
    const cls = /^(sent|delivered)$/.test(m.status) ? 'badge-success' : m.status === 'failed' ? 'badge-danger' : 'badge-warning';
    const label = held ? `waiting until ${window.UI.formatDateTime(m.nextAttemptAt)} (quiet hours)` : m.status === 'queued' ? 'sending soon' : m.status;
    return `<tr><td>${esc(window.UI.formatDateTime(m.createdAt))}</td><td>${esc(PURPOSE[m.purpose] || m.purpose)}</td><td>${esc(m.name || '')} ${esc(m.phone || '')}</td><td><span class="badge ${cls}">${esc(label)}</span>${m.status === 'failed' ? `<div class="text-xs text-muted">${esc(m.error || 'Not delivered. Your credits were refunded.')}</div>` : ''}</td></tr>`;
  }).join('') || '<tr><td colspan="4" class="text-muted">No texts yet. They appear here once an alert goes out.</td></tr>'}
      </tbody></table></div></div>` : '';
  }

  async function refreshRecent() {
    await loadRecent();
    const box = document.getElementById('al-recent');
    if (box) box.innerHTML = recentHtml();
  }

  /* --------------------------- behaviour --------------------------- */
  const debounce = (fn, ms) => (window.UI.debounce ? window.UI.debounce(fn, ms) : fn);

  function bind(host) {
    const form = host.querySelector('#al-form');
    // switch an alert on/off: show or hide its settings
    form.querySelectorAll('.al-toggle').forEach((t) => t.addEventListener('change', () => {
      t.closest('.al-item').classList.toggle('on', t.checked);
      if (t.checked) previewAll(t.closest('.al-item'));
    }));
    // live preview of message templates (only for alerts that are switched on, to keep requests low)
    form.querySelectorAll('textarea[data-kind]').forEach((ta) => ta.addEventListener('input', debounce(() => preview(ta), 350)));
    form.querySelectorAll('.al-item.on').forEach(previewAll);
    form.addEventListener('submit', (e) => { e.preventDefault(); save(form); });
    host.querySelector('[data-action="run-expiry"]')?.addEventListener('click', (e) => runExpiry(e.currentTarget));
    host.querySelector('[data-action="send-lowstock"]')?.addEventListener('click', (e) => sendLowStock(e.currentTarget));
    host.querySelector('[data-action="send-test"]')?.addEventListener('click', (e) => sendTest(e.currentTarget));
    host.querySelectorAll('[data-goto]').forEach((x) => x.addEventListener('click', () => S.goto(x.dataset.goto)));
  }

  function previewAll(item) { item.querySelectorAll('textarea[data-kind]').forEach(preview); }

  async function preview(ta) {
    const out = ta.closest('.field').querySelector('.al-prev');
    try {
      const { data } = await window.Api.post('/sms-alerts/preview', { kind: ta.dataset.kind, template: ta.value.trim() || undefined });
      out.textContent = `Preview: ${data.text} (${data.characters} characters, ${data.credits} credit${data.credits === 1 ? '' : 's'} per text)`;
    } catch (e) { out.textContent = e.message; }
  }

  const val = (form, name) => form.elements[name];
  const num = (el) => { const n = Number(el && el.value); return el && el.value !== '' && Number.isFinite(n) ? n : undefined; };

  function collectSms(form) {
    const patch = {};
    for (const item of SMS_ITEMS) {
      if (!item.show() || !val(form, `${item.key}.enabled`)) continue;
      const sec = { enabled: val(form, `${item.key}.enabled`).checked };
      for (const f of item.fields) {
        const el = val(form, `${item.key}.${f.name}`);
        if (!el) continue;
        if (f.type === 'check') sec[f.name] = el.checked;
        else if (f.type === 'select') sec[f.name] = el.value;
        else if (f.type === 'number') { const n = num(el); if (n !== undefined) sec[f.name] = n; }
        else if (f.type === 'days') {
          const list = [...new Set(el.value.split(/[\s,;]+/).map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= 90))].slice(0, 5);
          if (list.length) sec[f.name] = list;
        } else sec[f.name] = el.value.trim();
      }
      patch[item.key] = sec;
    }
    if (val(form, 'delivery.quiet')) {
      patch.quietHours = { enabled: val(form, 'delivery.quiet').checked };
      const s = num(val(form, 'delivery.start')); const e = num(val(form, 'delivery.end'));
      if (s !== undefined) patch.quietHours.startHour = s;
      if (e !== undefined) patch.quietHours.endHour = e;
    }
    if (val(form, 'delivery.senderId')) patch.senderId = val(form, 'delivery.senderId').value;
    return patch;
  }

  async function save(form) {
    if (!S.editable) return;
    const btn = document.getElementById('al-save');
    window.UI.setButtonLoading(btn, true, 'Saving…');
    try {
      const prefs = {
        lowStockNotify: val(form, 'lowStockNotify.enabled').checked,
        outOfStockNotify: val(form, 'outOfStockNotify.enabled').checked,
      };
      if (val(form, 'expiryNotify.enabled')) {
        prefs.expiry = { notifyEnabled: val(form, 'expiryNotify.enabled').checked };
        const c = num(val(form, 'expiry.criticalDays')); const w = num(val(form, 'expiry.warningDays'));
        if (c !== undefined) prefs.expiry.criticalDays = c;
        if (w !== undefined) prefs.expiry.warningDays = w;
      }
      await window.Api.put('/alert-prefs', prefs);
      if (S.sms) await window.Api.put('/sms-alerts/settings', collectSms(form));
      await load();
      render();
      const anyOn = S.sms && SMS_ITEMS.some((i) => i.show() && S.sms.settings[i.key] && S.sms.settings[i.key].enabled);
      if (anyOn && S.sms && !S.sms.ready) window.UI.toast.warning(`Saved, but texts will not send yet: ${(S.sms.blockers || []).map((k) => BLOCKER_TEXT[k] || k).join(' ')}`);
      else window.UI.toast.success('Alert settings saved');
    } catch (err) {
      window.UI.toast.error(err.message || 'Could not save');
      window.UI.setButtonLoading(btn, false);
    }
  }

  async function runExpiry(btn) {
    window.UI.setButtonLoading(btn, true, 'Checking…');
    try {
      const { data } = await window.Api.post('/batches/alerts/run', {});
      const s = data.summary || {};
      const total = (s.expired || 0) + (s.critical || 0) + (s.warning || 0);
      const t = data.sms;
      const smsNote = !t ? '' : t.queued ? ' A text is on its way to you.' : t.reason === 'DUPLICATE' ? ' (You already got this period\'s text.)' : t.reason === 'NO_CREDITS' ? ' No text sent: you have no SMS credits.' : t.reason === 'NO_SENDER_ID' ? ' No text sent: no Sender ID available.' : t.reason === 'ALERTS_PAUSED' ? ' No text sent: SMS alerts are paused by the platform.' : '';
      window.UI.toast.success((total ? `${s.expired || 0} expired, ${s.critical || 0} expiring soon, ${s.warning || 0} later.` : 'Nothing is expired or about to expire.') + smsNote);
      refreshRecent();
    } catch (e) { window.UI.toast.error(e.message); } finally { window.UI.setButtonLoading(btn, false); }
  }

  async function sendLowStock(btn) {
    window.UI.setButtonLoading(btn, true, 'Sending…');
    try {
      const { data } = await window.Api.post('/sms-alerts/low-stock/send-now', {});
      const r = data.sms || {};
      if (r.queued) window.UI.toast.success(`Text queued: ${data.summary.low} low, ${data.summary.out} out of stock.`);
      else if (r.reason === 'DISABLED') window.UI.toast.error('Switch this alert on and save it first.');
      else if (r.reason === 'NOTHING') window.UI.toast.success('Nothing is low or out of stock right now.');
      else if (r.reason === 'NO_CREDITS') window.UI.toast.error('Not enough SMS credits. Top up in the Buy SMS tab.');
      else if (r.reason === 'NO_SENDER_ID') window.UI.toast.error(BLOCKER_TEXT.NO_SENDER_ID);
      else if (r.reason === 'ALERTS_PAUSED') window.UI.toast.error(BLOCKER_TEXT.ALERTS_PAUSED);
      else if (r.reason === 'DUPLICATE') window.UI.toast.warning('A text was already sent in the last hour. Try again later.');
      else if (r.reason === 'BAD_PHONE' || r.reason === 'NO_OWNER') window.UI.toast.error('No valid owner phone number found. Update the owner phone in Employees.');
      else window.UI.toast.warning('No text was sent. Please try again.');
      if (r.queued) refreshRecent();
    } catch (e) { window.UI.toast.error(e.message); } finally { window.UI.setButtonLoading(btn, false); }
  }

  async function sendTest(btn) {
    window.UI.setButtonLoading(btn, true, 'Sending…');
    try {
      const { data } = await window.Api.post('/sms-alerts/test', {});
      if (data.sent) window.UI.toast.success(data.message); else window.UI.toast.error(data.message);
      refreshRecent();
    } catch (e) { window.UI.toast.error(e.message); } finally { window.UI.setButtonLoading(btn, false); }
  }
})();
