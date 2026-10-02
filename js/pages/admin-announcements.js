/**
 * admin-announcements.js - platform announcements manager (SUPER_ADMIN only).
 * Create / edit / pause / delete announcements, choose the audience (roles),
 * the pages they appear on (pop-up or scrolling ticker per page) and how long
 * they run. Includes a live preview of the ticker and the pop-up.
 */
(function () {
  const esc = window.UI.escapeHtml;
  const A = window.Announcements; // preview helpers (may be undefined if the script failed to load)
  const fmt = (d) => window.UI.formatDateTime(d);

  const PAGES = [
    ['dashboard', 'Dashboard'], ['sales', 'Sales (POS)'], ['products', 'Products'], ['inventory', 'Inventory'],
    ['suppliers', 'Suppliers'], ['purchases', 'Purchases'], ['expenses', 'Expenses'], ['refunds', 'Refunds'],
    ['reports', 'Reports'], ['cash', 'Registers & Shifts'], ['branches', 'Branches'], ['employees', 'Employees'],
    ['customers', 'Customers'], ['tickets', 'Help & Support'], ['notifications', 'Notifications'],
    ['settings', 'Settings'], ['audit', 'Audit log'],
  ];
  const PAGE_LABEL = Object.fromEntries(PAGES);
  const ROLES = [
    ['OWNER', 'Owner'], ['ADMIN', 'Admin'], ['MANAGER', 'Manager'],
    ['CASHIER', 'Cashier'], ['STOREKEEPER', 'Storekeeper'], ['ACCOUNTANT', 'Accountant'],
  ];
  const TYPES = [['INFO', 'Info'], ['SUCCESS', 'Good news'], ['WARNING', 'Warning'], ['CRITICAL', 'Critical']];
  const DURATIONS = [
    ['1h', '1 hour'], ['6h', '6 hours'], ['24h', '24 hours'], ['3d', '3 days'], ['7d', '7 days'],
    ['14d', '14 days'], ['30d', '30 days'], ['custom', 'Until a date I pick…'], ['none', 'No end - until I stop it'],
  ];
  const HOUR = 3600 * 1000;
  const DUR_MS = { '1h': HOUR, '6h': 6 * HOUR, '24h': 24 * HOUR, '3d': 72 * HOUR, '7d': 168 * HOUR, '14d': 336 * HOUR, '30d': 720 * HOUR };
  const STATUS_BADGE = { LIVE: 'badge-success', SCHEDULED: 'badge-info', EXPIRED: 'badge-neutral', PAUSED: 'badge-warning' };
  const STATUS_LABEL = { LIVE: 'Live', SCHEDULED: 'Scheduled', EXPIRED: 'Expired', PAUSED: 'Paused' };

  const rows = new Map();
  let el;
  let listApi;

  const pad = (n) => String(n).padStart(2, '0');
  const toLocalInput = (d) => {
    const x = new Date(d);
    return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}T${pad(x.getHours())}:${pad(x.getMinutes())}`;
  };
  function span(ms) {
    const m = Math.round(Math.abs(ms) / 60000);
    if (m < 60) return `${Math.max(m, 1)} min`;
    const h = Math.round(m / 60);
    if (h < 48) return `${h} hour${h === 1 ? '' : 's'}`;
    return `${Math.round(h / 24)} days`;
  }

  document.addEventListener('DOMContentLoaded', () => {
    el = window.AdminShell.mount({ title: 'Announcements' });
    if (!el) return;
    el.innerHTML = `
      <div class="page-header">
        <div><h1>Announcements</h1><p>Broadcast notices to shop users - a pop-up on pages like the dashboard, a scrolling ticker on the sales screen.</p></div>
        <div class="page-actions"><button class="btn btn-primary btn-sm" id="an-new">New announcement</button></div>
      </div>
      <div id="an-list"></div>`;
    document.getElementById('an-new').addEventListener('click', () => openForm());

    const root = document.getElementById('an-list');
    listApi = window.AdminList.create(root, {
      endpoint: '/admin/announcements',
      search: 'Search title or message...',
      filters: [
        { key: 'status', type: 'select', label: 'Status', options: [['', 'All'], ['LIVE', 'Live'], ['SCHEDULED', 'Scheduled'], ['PAUSED', 'Paused'], ['EXPIRED', 'Expired']] },
        { key: 'type', type: 'select', label: 'Style', options: [['', 'All'], ...TYPES] },
      ],
      columns: [
        {
          label: 'Announcement',
          render: (a) => {
            rows.set(a._id, a);
            return `<div class="ann-cell"><span class="ann-dot ann-t-${esc(a.type)}"></span><div><b>${esc(a.title)}</b><div class="ann-clamp">${esc(a.message)}</div></div></div>`;
          },
        },
        {
          label: 'Audience',
          render: (a) => (a.roles && a.roles.length
            ? `<div class="ann-pills">${a.roles.map((r) => `<span class="ann-pill">${esc(r.charAt(0) + r.slice(1).toLowerCase())}</span>`).join('')}</div>`
            : '<span class="ann-pill">Everyone</span>'),
        },
        {
          label: 'Shown on',
          render: (a) => `<div class="ann-pills">${a.placements.map((p) =>
            `<span class="ann-pill ${p.display === 'TICKER' ? 'ticker' : ''}">${esc(PAGE_LABEL[p.page] || p.page)} · ${p.display === 'TICKER' ? 'ticker' : 'pop-up'}</span>`).join('')}</div>`,
        },
        { label: 'Schedule', render: scheduleHtml },
        { label: 'Status', render: (a) => `<span class="badge ${STATUS_BADGE[a.status] || 'badge-neutral'}">${STATUS_LABEL[a.status] || esc(a.status)}</span>` },
        {
          label: '',
          render: (a) => `<div class="ann-actions">
            <button class="btn btn-secondary btn-sm" data-an="edit" data-id="${esc(a._id)}">Edit</button>
            <button class="btn btn-secondary btn-sm" data-an="toggle" data-id="${esc(a._id)}">${a.isActive ? 'Pause' : 'Resume'}</button>
            <button class="btn btn-ghost btn-sm ann-danger" data-an="delete" data-id="${esc(a._id)}">Delete</button>
          </div>`,
        },
      ],
      empty: { title: 'No announcements yet', message: 'Use "New announcement" to broadcast something to shop users.' },
    });
    root.addEventListener('click', onAction);
  });

  function scheduleHtml(a) {
    const now = Date.now();
    const s = new Date(a.startsAt).getTime();
    const e = a.endsAt ? new Date(a.endsAt).getTime() : null;
    let note = '';
    if (a.status === 'LIVE') note = e ? `ends in ${span(e - now)}` : 'no end date';
    else if (a.status === 'SCHEDULED') note = `starts in ${span(s - now)}`;
    else if (a.status === 'EXPIRED') note = `ended ${span(now - e)} ago`;
    else note = 'paused - not showing';
    return `<div class="text-sm">${fmt(a.startsAt)}${e ? ` → ${fmt(a.endsAt)}` : ' → no end'}</div><div class="text-xs text-muted">${note}</div>`;
  }

  async function onAction(e) {
    const btn = e.target.closest('[data-an]');
    if (!btn) return;
    const a = rows.get(btn.dataset.id);
    if (!a) return;

    if (btn.dataset.an === 'edit') return openForm(a);

    if (btn.dataset.an === 'toggle') {
      window.UI.setButtonLoading(btn, true, '…');
      try {
        await window.Api.patch(`/admin/announcements/${a._id}/active`, { isActive: !a.isActive });
        window.UI.toast.success(a.isActive ? 'Announcement paused' : 'Announcement resumed');
        listApi.reload();
      } catch (err) {
        window.UI.toast.error(err.message);
        window.UI.setButtonLoading(btn, false);
      }
      return;
    }

    if (btn.dataset.an === 'delete') {
      const ok = await window.UI.confirmDialog({
        title: 'Delete announcement?',
        message: `"${a.title}" will stop showing for everyone straight away. This cannot be undone.`,
        confirmText: 'Delete',
        danger: true,
      });
      if (!ok) return;
      try {
        await window.Api.delete(`/admin/announcements/${a._id}`);
        window.UI.toast.success('Announcement deleted');
        listApi.reload();
      } catch (err) { window.UI.toast.error(err.message); }
    }
  }

  /* ------------------------------ form modal ------------------------------ */
  function openForm(existing) {
    const isEdit = !!existing;
    const d = existing || {
      title: '', message: '', type: 'INFO', roles: [], frequency: 'ONCE',
      placements: [{ page: 'dashboard', display: 'MODAL' }], startsAt: null, endsAt: null,
    };
    const pageMap = new Map(d.placements.map((p) => [p.page, p.display]));
    const everyone = !d.roles.length;
    const startVal = toLocalInput(d.startsAt || new Date());
    const durDefault = isEdit ? (d.endsAt ? 'custom' : 'none') : '24h';
    const endVal = toLocalInput(d.endsAt || new Date(Date.now() + 24 * HOUR));

    const modal = window.UI.openModal({
      title: isEdit ? 'Edit announcement' : 'New announcement',
      maxWidth: '780px',
      bodyHtml: `
        <form class="ann-form" id="an-form" novalidate>
          <div class="field"><label for="an-title">Title</label><input class="input" id="an-title" maxlength="120" value="${esc(d.title)}" placeholder="e.g. System maintenance tonight at 11pm" /></div>
          <div class="field"><label for="an-message">Message <span class="text-muted ann-count" id="an-count"></span></label><textarea class="textarea" id="an-message" maxlength="1000" placeholder="Keep it short - cashiers read this between customers.">${esc(d.message)}</textarea></div>
          <div class="field"><label>Style</label>
            <div class="ann-types">${TYPES.map(([k, l]) => `<label class="ann-type ann-t-${k}"><input type="radio" name="an-type" value="${k}" ${d.type === k ? 'checked' : ''} /><span><i></i>${l}</span></label>`).join('')}</div>
          </div>

          <div class="ann-section-title">Who sees it</div>
          <label class="checkbox-row"><input type="checkbox" id="an-everyone" ${everyone ? 'checked' : ''} /><span>Everyone (all roles, every business)</span></label>
          <div class="ann-roles">${ROLES.map(([k, l]) => `<label class="ann-chip"><input type="checkbox" name="role" value="${k}" ${d.roles.includes(k) ? 'checked' : ''} ${everyone ? 'disabled' : ''} /><span>${l}</span></label>`).join('')}</div>

          <div class="ann-section-title">Where it appears</div>
          <p class="field-hint" style="margin-bottom:var(--space-3)">A pop-up must be acknowledged. A ticker is a slim scrolling bar that never blocks work - best for the Sales screen.</p>
          <div class="ann-pages">${PAGES.map(([k, l]) => {
            const on = pageMap.has(k);
            const disp = pageMap.get(k) || (k === 'sales' ? 'TICKER' : 'MODAL');
            return `<div class="ann-page ${on ? 'on' : ''}" data-page="${k}">
              <label class="checkbox-row"><input type="checkbox" ${on ? 'checked' : ''} /><span>${esc(l)}</span></label>
              <select class="select" aria-label="Display on ${esc(l)}" ${on ? '' : 'disabled'}>
                <option value="MODAL" ${disp === 'MODAL' ? 'selected' : ''}>Pop-up</option>
                <option value="TICKER" ${disp === 'TICKER' ? 'selected' : ''}>Ticker</option>
              </select>
            </div>`;
          }).join('')}</div>
          <div class="field" style="margin-top:var(--space-4)"><label for="an-freq">Pop-up frequency</label>
            <select class="select" id="an-freq">
              <option value="ONCE" ${d.frequency === 'ONCE' ? 'selected' : ''}>Once per person (until you edit it)</option>
              <option value="EVERY_VISIT" ${d.frequency === 'EVERY_VISIT' ? 'selected' : ''}>Every time the page opens</option>
            </select>
          </div>

          <div class="ann-section-title">How long it runs</div>
          <div class="form-row">
            <div class="field">
              <label for="an-start">Starts</label>
              <input class="input" type="datetime-local" id="an-start" value="${startVal}" />
              <label class="checkbox-row" style="margin-top:var(--space-2)"><input type="checkbox" id="an-now" ${isEdit ? '' : 'checked'} /><span>Start immediately</span></label>
            </div>
            <div class="field">
              <label for="an-dur">Runs for</label>
              <select class="select" id="an-dur">${DURATIONS.map(([k, l]) => `<option value="${k}" ${k === durDefault ? 'selected' : ''}>${l}</option>`).join('')}</select>
              <input class="input" type="datetime-local" id="an-end" value="${endVal}" style="margin-top:var(--space-2);${durDefault === 'custom' ? '' : 'display:none'}" aria-label="Ends at" />
            </div>
          </div>
          <p class="field-hint" id="an-hint"></p>
          ${isEdit ? '<label class="checkbox-row" style="margin-top:var(--space-3)"><input type="checkbox" id="an-resend" /><span>Show again to people who already dismissed it</span></label>' : ''}

          <div class="ann-section-title">Preview</div>
          <div class="ann-preview">
            <div id="an-prev"></div>
            <button type="button" class="btn btn-secondary btn-sm" id="an-prev-modal">Preview pop-up</button>
          </div>
        </form>`,
      footerHtml: `<button class="btn btn-secondary" data-action="cancel">Cancel</button><button class="btn btn-primary" data-action="save">${isEdit ? 'Save changes' : 'Publish announcement'}</button>`,
    });

    const $ = (s) => modal.querySelector(s);
    const $$ = (s) => Array.from(modal.querySelectorAll(s));
    const startInput = $('#an-start');
    const nowChk = $('#an-now');
    const dur = $('#an-dur');
    const endInput = $('#an-end');
    startInput.disabled = nowChk.checked;

    /* counter */
    const count = () => { $('#an-count').textContent = `(${$('#an-message').value.length}/1000)`; };
    count();

    /* audience */
    $('#an-everyone').addEventListener('change', (e) => {
      $$('input[name="role"]').forEach((c) => { c.disabled = e.target.checked; if (e.target.checked) c.checked = false; });
    });

    /* pages */
    $$('.ann-page').forEach((row) => {
      const chk = row.querySelector('input[type="checkbox"]');
      const sel = row.querySelector('select');
      chk.addEventListener('change', () => { sel.disabled = !chk.checked; row.classList.toggle('on', chk.checked); });
    });

    /* schedule */
    function computeWindow() {
      const start = nowChk.checked ? new Date() : new Date(startInput.value);
      let end = null;
      if (dur.value === 'custom') end = endInput.value ? new Date(endInput.value) : undefined;
      else if (dur.value !== 'none') end = new Date(start.getTime() + DUR_MS[dur.value]);
      return { start, end };
    }
    function hint() {
      const { start, end } = computeWindow();
      const h = $('#an-hint');
      if (Number.isNaN(start.getTime())) { h.textContent = ''; return; }
      if (end === null) h.textContent = `Starts ${fmt(start)} and keeps showing until you pause or delete it.`;
      else if (end && !Number.isNaN(end.getTime())) h.textContent = `Shows from ${fmt(start)} to ${fmt(end)} (${span(end - start)}).`;
      else h.textContent = '';
    }
    nowChk.addEventListener('change', () => {
      startInput.disabled = nowChk.checked;
      if (nowChk.checked) startInput.value = toLocalInput(new Date());
      hint();
    });
    startInput.addEventListener('input', hint);
    endInput.addEventListener('input', hint);
    dur.addEventListener('change', () => { endInput.style.display = dur.value === 'custom' ? '' : 'none'; hint(); });
    hint();

    /* preview */
    const draft = () => ({
      _id: 'preview',
      version: 1,
      title: $('#an-title').value.trim() || 'Your title appears here',
      message: $('#an-message').value.trim() || 'Your message scrolls across the screen like this.',
      type: ($('input[name="an-type"]:checked') || {}).value || 'INFO',
    });
    function renderPreview() {
      const host = $('#an-prev');
      if (!A) { host.textContent = 'Preview unavailable.'; return; }
      host.innerHTML = '';
      const bar = A.buildTickerEl([draft()], { closable: false });
      host.appendChild(bar);
      A.startMarquee(bar);
    }
    const debouncedPreview = window.UI.debounce(renderPreview, 250);
    ['#an-title', '#an-message'].forEach((s) => $(s).addEventListener('input', () => { count(); debouncedPreview(); }));
    $$('input[name="an-type"]').forEach((r) => r.addEventListener('change', renderPreview));
    $('#an-prev-modal').addEventListener('click', () => { if (A) A.showModalQueue([draft()], { preview: true }); });
    setTimeout(renderPreview, 60);

    /* save */
    $('[data-action="cancel"]').addEventListener('click', window.UI.closeModal);
    $('[data-action="save"]').addEventListener('click', async (e) => {
      const fail = (m) => window.UI.toast.error(m);
      const title = $('#an-title').value.trim();
      const message = $('#an-message').value.trim();
      if (title.length < 3) return fail('Add a title (at least 3 characters)');
      if (message.length < 3) return fail('Add a message (at least 3 characters)');

      const toAll = $('#an-everyone').checked;
      const roles = toAll ? [] : $$('input[name="role"]:checked').map((c) => c.value);
      if (!toAll && !roles.length) return fail('Choose who should see it, or tick Everyone');

      const placements = $$('.ann-page')
        .filter((r) => r.querySelector('input[type="checkbox"]').checked)
        .map((r) => ({ page: r.dataset.page, display: r.querySelector('select').value }));
      if (!placements.length) return fail('Pick at least one page');

      const { start, end } = computeWindow();
      if (Number.isNaN(start.getTime())) return fail('Choose a valid start time');
      if (end === undefined || (end && Number.isNaN(end.getTime()))) return fail('Choose when it should end');
      if (end && end <= start) return fail('The end time must be after the start time');
      if (end && end <= new Date()) return fail('The end time must be in the future');

      const payload = {
        title, message, roles, placements,
        type: ($('input[name="an-type"]:checked') || {}).value || 'INFO',
        frequency: $('#an-freq').value,
        endsAt: end ? end.toISOString() : null,
      };
      if (nowChk.checked) payload.startNow = true;
      else payload.startsAt = start.toISOString();
      if (isEdit) payload.resend = $('#an-resend').checked;

      const btn = e.currentTarget;
      window.UI.setButtonLoading(btn, true, 'Saving…');
      try {
        if (isEdit) await window.Api.put(`/admin/announcements/${existing._id}`, payload);
        else await window.Api.post('/admin/announcements', payload);
        window.UI.closeModal();
        window.UI.toast.success(isEdit ? 'Announcement updated' : 'Announcement published');
        listApi.reload();
      } catch (err) {
        window.UI.toast.error(err.message);
      } finally {
        window.UI.setButtonLoading(btn, false);
      }
    });
  }
})();