/**
 * audit-logs.js
 * Who did what, where and when. Server-side filtering + pagination
 * (GET /audit-logs), rows grouped by day, click a row for the full record
 * including a before/after comparison when the log carries one.
 *
 * The action filter is a PREFIX match on the backend: "sale" finds
 * sale.create, sale.cancel, ... and "sale.cancel" finds only cancellations.
 *
 * The log's exact shape can vary by action, so the detail view is generic:
 * it shows the known fields nicely, diffs `before` / `after` if present, and
 * prints anything else it finds as formatted JSON instead of hiding it.
 */
(function () {
  const RT = window.ReportTools;
  const esc = window.UI.escapeHtml;

  const QUICK = [
    ['', 'All activity'], ['sale', 'Sales'], ['refund', 'Refunds'], ['product', 'Products'],
    ['inventory', 'Inventory'], ['purchase', 'Purchases'], ['expense', 'Expenses'],
    ['employee', 'Employees'], ['shift', 'Shifts'], ['auth', 'Sign-ins'],
  ];

  const state = { page: 1, limit: 20, action: '', entityType: '', userId: '', branchId: '', from: '', to: '', items: [], auto: false };
  const entityTypes = new Set();
  let contentEl;
  let user;
  let timer = null;

  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    contentEl = window.AppShell.mount({ title: 'Audit log' });
    if (!contentEl) return;
    user = window.AppShell.getUser();

    if (!window.Permissions.can(user, 'audit.view')) {
      contentEl.innerHTML = `<div class="card">${window.UI.emptyStateHtml({ icon: 'alert', title: 'The audit log is not available for your role', message: 'Ask the business owner to give you the "view audit log" permission.' })}</div>`;
      return;
    }

    contentEl.innerHTML = pageSkeleton();
    bindFilters();
    window.addEventListener('beforeunload', () => clearInterval(timer));
    loadLookups();
    await fetchLogs();
  }

  function pageSkeleton() {
    return `
      <div class="page-header">
        <div>
          <h1>Audit log</h1>
          <p>A record of who did what in your business. Entries cannot be edited or deleted.</p>
        </div>
        <div class="page-actions">
          <label class="checkbox-row text-sm"><input type="checkbox" id="auto-refresh" /> Refresh every 30s</label>
          <button class="btn btn-secondary btn-sm" id="refresh-btn">Refresh</button>
          <button class="btn btn-secondary btn-sm" id="export-btn" disabled>Export this page</button>
        </div>
      </div>

      <div class="card" style="margin-bottom: var(--space-4)">
        <div class="audit-quick"><div class="chip-row" id="quick-chips">
          ${QUICK.map(([k, l]) => `<button type="button" class="chip ${k === '' ? 'active' : ''}" data-action="${k}">${l}</button>`).join('')}
        </div></div>
        <div class="audit-filters">
          <div class="field"><label for="f-action">Action starts with</label><input class="input" id="f-action" placeholder="e.g. sale.cancel" autocomplete="off" /></div>
          <div class="field"><label for="f-entity">Entity type</label><input class="input" id="f-entity" list="entity-list" placeholder="Exact type, e.g. Sale" autocomplete="off" /><datalist id="entity-list"></datalist></div>
          <div class="field"><label for="f-user">Done by</label><select class="select" id="f-user"><option value="">Everyone</option></select></div>
          <div class="field"><label for="f-branch">Branch</label><select class="select" id="f-branch"><option value="">All branches</option></select></div>
          <div class="field"><label for="f-from">From</label><input class="input" id="f-from" type="date" /></div>
          <div class="field"><label for="f-to">To</label><input class="input" id="f-to" type="date" /></div>
        </div>
        <div class="audit-foot">
          <span class="text-xs text-muted">Tip: the Entity type must match exactly. Pick from the list once entries have loaded.</span>
          <button class="btn btn-ghost btn-sm" id="clear-btn">Clear filters</button>
        </div>
      </div>

      <div class="card">
        <div class="table-wrap flat">
          <table class="table">
            <thead><tr><th>When</th><th>Who</th><th>Action</th><th>What</th><th>Branch</th><th></th></tr></thead>
            <tbody id="log-tbody">${window.UI.skeletonRows(6, 8)}</tbody>
          </table>
        </div>
        <div class="pagination" id="log-pagination"></div>
      </div>`;
  }

  /* ------------------------------------------------------------------ *
   * Filters
   * ------------------------------------------------------------------ */
  function bindFilters() {
    const $ = (id) => document.getElementById(id);
    const reload = () => { state.page = 1; fetchLogs(); };
    const typing = window.UI.debounce(reload, 400);

    $('quick-chips').addEventListener('click', (e) => {
      const chip = e.target.closest('[data-action]');
      if (!chip) return;
      state.action = chip.dataset.action;
      $('f-action').value = state.action;
      syncChips();
      reload();
    });
    $('f-action').addEventListener('input', (e) => { state.action = e.target.value.trim(); syncChips(); typing(); });
    $('f-entity').addEventListener('input', (e) => { state.entityType = e.target.value.trim(); typing(); });
    $('f-user').addEventListener('change', (e) => { state.userId = e.target.value; reload(); });
    $('f-branch').addEventListener('change', (e) => { state.branchId = e.target.value; reload(); });
    $('f-from').addEventListener('change', (e) => { state.from = e.target.value; reload(); });
    $('f-to').addEventListener('change', (e) => { state.to = e.target.value; reload(); });

    $('clear-btn').addEventListener('click', clearFilters);
    $('refresh-btn').addEventListener('click', () => fetchLogs());
    $('export-btn').addEventListener('click', exportPage);
    $('auto-refresh').addEventListener('change', (e) => {
      state.auto = e.target.checked;
      clearInterval(timer);
      if (state.auto) timer = setInterval(() => { if (!document.hidden) fetchLogs({ silent: true }); }, 30000);
    });
  }

  function syncChips() {
    document.querySelectorAll('#quick-chips .chip').forEach((c) => c.classList.toggle('active', c.dataset.action === state.action));
  }

  function clearFilters() {
    Object.assign(state, { page: 1, action: '', entityType: '', userId: '', branchId: '', from: '', to: '' });
    ['f-action', 'f-entity', 'f-from', 'f-to'].forEach((id) => { document.getElementById(id).value = ''; });
    ['f-user', 'f-branch'].forEach((id) => { document.getElementById(id).value = ''; });
    syncChips();
    fetchLogs();
  }

  async function loadLookups() {
    if (window.Permissions.can(user, 'employees.view')) {
      try {
        const { data } = await window.Api.get('/employees', { page: 1, limit: 100 });
        document.getElementById('f-user').insertAdjacentHTML('beforeend', (data.items || []).map((u) => `<option value="${u._id}">${esc(u.name)}</option>`).join(''));
      } catch { /* selector stays at "Everyone" */ }
    }
    if (window.Permissions.can(user, 'branches.view')) {
      try {
        const { data } = await window.Api.get('/branches', { page: 1, limit: 100 });
        document.getElementById('f-branch').insertAdjacentHTML('beforeend', (data.items || []).map((b) => `<option value="${b._id}">${esc(b.name)}</option>`).join(''));
      } catch { /* selector stays at "All branches" */ }
    }
  }

  /* ------------------------------------------------------------------ *
   * Fetch + render
   * ------------------------------------------------------------------ */
  function actionBadge(action) {
    const a = String(action || '');
    const verb = a.split('.').pop().toLowerCase();
    let cls = 'badge-neutral';
    if (/(create|add|open|login|receive|complete|approve|restore)/.test(verb)) cls = 'badge-success';
    else if (/(update|edit|adjust|transfer|close|change|reset|assign)/.test(verb)) cls = 'badge-info';
    else if (/(delete|cancel|void|remove|reject|deactivate|fail)/.test(verb)) cls = 'badge-danger';
    else if (/(refund|discount|override)/.test(verb)) cls = 'badge-warning';
    return `<span class="badge ${cls} mono">${esc(a || 'unknown')}</span>`;
  }

  function shortId(id) { return id ? String(id).slice(-6) : ''; }

  async function fetchLogs({ silent = false } = {}) {
    const tbody = document.getElementById('log-tbody');
    if (!silent) tbody.innerHTML = window.UI.skeletonRows(6, 8);

    try {
      const { data } = await window.Api.get('/audit-logs', {
        page: state.page,
        limit: state.limit,
        action: state.action || undefined,
        entityType: state.entityType || undefined,
        userId: state.userId || undefined,
        branchId: state.branchId || undefined,
        from: state.from ? RT.parseDateInput(state.from, false).toISOString() : undefined,
        to: state.to ? RT.parseDateInput(state.to, true).toISOString() : undefined,
      });
      state.items = data.items || [];
      state.items.forEach((l) => { if (l.entityType) entityTypes.add(l.entityType); });
      document.getElementById('entity-list').innerHTML = [...entityTypes].sort().map((t) => `<option value="${esc(t)}"></option>`).join('');
      document.getElementById('export-btn').disabled = !state.items.length;
      renderRows(tbody);
      window.UI.renderPagination(document.getElementById('log-pagination'), data, (p) => { state.page = p; fetchLogs(); window.scrollTo({ top: 0, behavior: 'smooth' }); });
    } catch (err) {
      if (silent) return;
      tbody.innerHTML = `<tr><td colspan="6">${window.UI.emptyStateHtml({ icon: 'alert', title: 'Could not load the audit log', message: err.message })}</td></tr>`;
    }
  }

  function renderRows(tbody) {
    if (!state.items.length) {
      tbody.innerHTML = `<tr><td colspan="6">${window.UI.emptyStateHtml({
        icon: 'reports', title: 'No activity matches these filters', message: 'Try a wider date range or clear the filters.',
        actionHtml: '<button class="btn btn-secondary btn-sm" id="empty-clear">Clear filters</button>',
      })}</td></tr>`;
      document.getElementById('empty-clear').addEventListener('click', clearFilters);
      return;
    }

    let lastDay = '';
    let html = '';
    state.items.forEach((log, idx) => {
      const day = RT.dayLabel(log.timestamp);
      if (day !== lastDay) { html += `<tr class="log-day"><td colspan="6">${esc(day)}</td></tr>`; lastDay = day; }
      const u = log.userId;
      html += `
        <tr class="log-row" data-idx="${idx}" tabindex="0">
          <td class="time-cell">${RT.timeOnly(log.timestamp)}<small>${window.UI.timeAgo(log.timestamp)}</small></td>
          <td>
            <div class="user-cell">
              <span class="avatar-sm">${u ? esc(window.UI.initials(u.name)) : 'SYS'}</span>
              <span>${u ? esc(u.name) : 'System'}${u?.role ? `<small>${esc(u.role)}</small>` : ''}</span>
            </div>
          </td>
          <td>${actionBadge(log.action)}</td>
          <td>${log.entityType ? esc(log.entityType) : '<span class="text-muted">-</span>'}${log.entityId ? ` <span class="mono text-muted">#${esc(shortId(log.entityId))}</span>` : ''}</td>
          <td class="text-sm">${log.branchId?.name ? esc(log.branchId.name) : '<span class="text-muted">All</span>'}</td>
          <td class="actions"><button class="btn btn-secondary btn-sm" data-view="${idx}">Details</button></td>
        </tr>`;
    });
    tbody.innerHTML = html;

    tbody.querySelectorAll('.log-row').forEach((row) => {
      const open = () => openDetail(state.items[Number(row.dataset.idx)]);
      row.addEventListener('click', open);
      row.addEventListener('keydown', (e) => { if (e.key === 'Enter') open(); });
    });
  }

  /* ------------------------------------------------------------------ *
   * Detail modal
   * ------------------------------------------------------------------ */
  const KNOWN = new Set(['_id', '__v', 'businessId', 'branchId', 'userId', 'action', 'entityType', 'entityId', 'timestamp', 'createdAt', 'updatedAt', 'ipAddress', 'ip', 'userAgent', 'before', 'after']);

  function flatten(obj, prefix = '', out = {}, depth = 0) {
    if (obj && typeof obj === 'object' && !Array.isArray(obj) && depth < 4) {
      const keys = Object.keys(obj);
      if (!keys.length && prefix) out[prefix] = '{}';
      keys.forEach((k) => flatten(obj[k], prefix ? `${prefix}.${k}` : k, out, depth + 1));
    } else {
      out[prefix] = obj;
    }
    return out;
  }

  function show(v) {
    if (v === undefined) return '<span class="text-muted">(not set)</span>';
    const s = typeof v === 'string' ? v : JSON.stringify(v);
    return esc(s.length > 140 ? `${s.slice(0, 140)}…` : s);
  }

  function diffHtml(before, after) {
    const a = flatten(before || {});
    const b = flatten(after || {});
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
    const changed = keys.filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
    if (!changed.length) return '<p class="text-sm text-muted">No field values changed.</p>';
    return `
      <table class="diff-table">
        <thead><tr><th>Field</th><th>Before</th><th>After</th></tr></thead>
        <tbody>${changed.map((k) => `<tr><td class="mono">${esc(k)}</td><td class="was">${show(a[k])}</td><td class="now">${show(b[k])}</td></tr>`).join('')}</tbody>
      </table>
      <p class="text-xs text-muted" style="margin-top:6px">${keys.length - changed.length} unchanged field${keys.length - changed.length === 1 ? '' : 's'} hidden.</p>`;
  }

  function openDetail(log) {
    const u = log.userId;
    const when = new Intl.DateTimeFormat('en-KE', { dateStyle: 'full', timeStyle: 'medium' }).format(new Date(log.timestamp));
    const extras = Object.entries(log).filter(([k]) => !KNOWN.has(k));
    const hasDiff = log.before && log.after && typeof log.before === 'object' && typeof log.after === 'object';

    const modal = window.UI.openModal({
      title: 'Audit entry',
      maxWidth: '640px',
      bodyHtml: `
        <dl class="kv-grid">
          <dt>Action</dt><dd>${actionBadge(log.action)}</dd>
          <dt>When</dt><dd>${esc(when)}<br /><span class="text-xs text-muted">${window.UI.timeAgo(log.timestamp)}</span></dd>
          <dt>Done by</dt><dd>${u ? `${esc(u.name)} <span class="badge role-badge role-${esc(u.role || '')}">${esc(u.role || '')}</span>` : 'System'}</dd>
          <dt>Branch</dt><dd>${log.branchId?.name ? esc(log.branchId.name) : 'Not tied to a branch'}</dd>
          <dt>Entity</dt><dd>${log.entityType ? esc(log.entityType) : '-'}${log.entityId ? ` <span class="mono">${esc(log.entityId)}</span>` : ''}</dd>
          ${log.ipAddress || log.ip ? `<dt>IP address</dt><dd class="mono">${esc(log.ipAddress || log.ip)}</dd>` : ''}
          ${log.userAgent ? `<dt>Device</dt><dd class="text-xs">${esc(log.userAgent)}</dd>` : ''}
        </dl>
        ${hasDiff ? `<div class="detail-title">What changed</div>${diffHtml(log.before, log.after)}` : ''}
        ${!hasDiff && (log.before || log.after) ? `<div class="detail-title">${log.before ? 'Before' : 'After'}</div><pre class="json-view">${esc(JSON.stringify(log.before || log.after, null, 2))}</pre>` : ''}
        ${extras.map(([k, v]) => `<div class="detail-title">${esc(k)}</div><pre class="json-view">${esc(typeof v === 'string' ? v : JSON.stringify(v, null, 2))}</pre>`).join('')}
      `,
      footerHtml: `<button class="btn btn-secondary" data-action="copy">Copy record</button><button class="btn btn-primary" data-action="close">Close</button>`,
    });
    modal.querySelector('[data-action="close"]').addEventListener('click', window.UI.closeModal);
    modal.querySelector('[data-action="copy"]').addEventListener('click', () => RT.copyText(JSON.stringify(log, null, 2), 'Record copied'));
  }

  /* ------------------------------------------------------------------ *
   * Export (current page only - the server pages the data)
   * ------------------------------------------------------------------ */
  function exportPage() {
    RT.downloadCSV(`audit-log-page-${state.page}-${RT.stamp()}.csv`, [{
      headers: ['Time', 'User', 'Role', 'Action', 'Entity type', 'Entity ID', 'Branch'],
      rows: state.items.map((l) => [
        new Date(l.timestamp).toISOString(), l.userId?.name || 'System', l.userId?.role || '',
        l.action || '', l.entityType || '', l.entityId || '', l.branchId?.name || '',
      ]),
    }]);
    window.UI.toast.success('Exported the entries on this page');
  }
})();