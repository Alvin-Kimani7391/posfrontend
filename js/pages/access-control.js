/**
 * access-control.js
 * Owner-controlled access for staff.
 *   People - each employee uses the SYSTEM DEFAULTS for their role, or is switched to CUSTOM:
 *            join groups + allow/deny single permissions. Bulk-edit many employees at once.
 *   Groups - reusable permission sets ("Stock controllers", "Refund approvers") you can attach to anyone.
 *   Roles  - change what EVERY employee with a role gets by default (e.g. all Cashiers).
 * Order of precedence (later wins): system default -> role template -> groups -> this employee.
 * The server enforces every rule (no granting what you don't hold, no self-edits, owner is fixed);
 * this screen only makes it fast and visible.
 */
(function () {
  const esc = (s) => window.UI.escapeHtml(s == null ? '' : String(s));
  const toast = (m, t) => (t === 'error' ? window.UI.toast.error(m) : window.UI.toast.success(m));
  const S = { tab: 'people', catalog: null, policy: null, people: [], sel: new Set(), q: '', mode: 'all', role: '' };
  const COLORS = ['#2563eb', '#16a34a', '#d97706', '#dc2626', '#7c3aed', '#0891b2', '#db2777', '#475569'];
  const PRESETS = [
    { name: 'Stock controllers', description: 'Count, adjust and receive stock', color: '#d97706', grant: ['inventory.view', 'inventory.adjust', 'inventory.receive', 'inventory.transfer', 'stocktake.view', 'stocktake.count', 'stocktake.manage', 'batches.view', 'products.view'] },
    { name: 'Refund approvers', description: 'Can approve refunds and cancel sales', color: '#dc2626', grant: ['sales.view', 'refunds.view', 'refunds.create', 'refunds.approve', 'sales.cancel'] },
    { name: 'Read-only viewers', description: 'Can look but not change anything', color: '#475569', grant: '*view' },
  ];
  let root;

  document.addEventListener('DOMContentLoaded', init);

  /* ============================== boot / data ============================== */
  async function init() {
    root = window.AppShell.mount({ title: 'Access control' });
    if (!root) return;
    if (!window.Permissions.can(window.AppShell.getUser(), 'employees.permissions')) {
      root.innerHTML = `<div class="card"><div class="card-body">${window.UI.emptyStateHtml({ icon: 'lock', title: 'Owner access only', message: 'Only the business owner (or someone the owner trusts with this) can change what staff are allowed to do.' })}</div></div>`;
      return;
    }
    root.innerHTML = `<div class="card"><div class="card-body">${window.UI.skeletonRows ? '<table class="table"><tbody>' + window.UI.skeletonRows(6, 4) + '</tbody></table>' : 'Loading…'}</div></div>`;
    try {
      const { data } = await window.Api.get('/permissions/catalog', undefined, { fresh: true });
      S.catalog = data;
      await reload();
    } catch (err) {
      root.innerHTML = `<div class="card"><div class="card-body">${window.UI.emptyStateHtml({ icon: 'alert', title: 'Could not load access settings', message: err.message })}</div></div>`;
      return;
    }
    renderShell();
    const emp = new URLSearchParams(location.search).get('employee');
    if (emp) openEmployeeEditor(emp);
  }

  async function reload() {
    const [pol, emps] = await Promise.all([
      window.Api.get('/permissions/policy', undefined, { fresh: true }),
      window.Api.get('/permissions/employees', undefined, { fresh: true }),
    ]);
    S.policy = pol.data; S.people = emps.data.items;
  }
  async function reloadAndPaint() { try { await reload(); paint(); } catch (e) { toast(e.message, 'error'); } }

  /* ============================== helpers ============================== */
  const cat = () => S.catalog;
  const groupById = (id) => S.policy.groups.find((g) => String(g._id) === String(id));
  const roleDefaults = (role) => (cat().roles.find((r) => r.role === role) || { defaults: [] }).defaults;
  const roleLabel = (r) => r.charAt(0) + r.slice(1).toLowerCase().replace(/_/g, ' ');
  const roleTemplate = (role) => S.policy.roleOverrides.find((r) => r.role === role);
  const hasFeature = (k) => !k || (window.AppShell.hasFeature ? window.AppShell.hasFeature(k) : true);
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

  /** What a person would get from the layers BELOW their personal settings. Mirrors the server resolver. -> Map(perm -> source label) */
  function baseMap(role, { template = true, groupIds = [] } = {}) {
    const m = new Map(); const denied = new Map();
    roleDefaults(role).forEach((p) => m.set(p, 'role default'));
    const ro = template && roleTemplate(role);
    if (ro) { (ro.revoke || []).forEach((p) => { m.delete(p); denied.set(p, 'business template'); }); (ro.grant || []).forEach((p) => { m.set(p, 'business template'); denied.delete(p); }); }
    groupIds.forEach((id) => {
      const g = groupById(id); if (!g) return;
      (g.revoke || []).forEach((p) => { m.delete(p); denied.set(p, `group “${g.name}”`); });
      (g.grant || []).forEach((p) => { m.set(p, `group “${g.name}”`); denied.delete(p); });
    });
    m.denied = denied;
    return m;
  }

  /* ============================== shell + tabs ============================== */
  function renderShell() {
    root.innerHTML = `
      <div class="page-header">
        <div>
          <h1>Access control</h1>
          <p>Decide what each employee can do. Everyone starts on the system defaults for their role — change anyone, any group, or a whole role in seconds.</p>
        </div>
        <a class="btn btn-secondary" href="audit-logs.html" data-requires-permission="audit.view">${window.Icons.get('audit')} Change history</a>
      </div>
      <div class="tabs ac-tabs" id="ac-tabs">
        <button class="tab-btn" data-tab="people">People</button>
        <button class="tab-btn" data-tab="groups">Groups</button>
        <button class="tab-btn" data-tab="roles">Roles</button>
      </div>
      <div id="ac-body"></div>`;
    root.querySelector('#ac-tabs').addEventListener('click', (e) => {
      const b = e.target.closest('[data-tab]'); if (!b) return;
      S.tab = b.dataset.tab; paint();
    });
    window.Permissions.applyPermissionGates(root, window.AppShell.getUser());
    paint();
  }

  function paint() {
    root.querySelectorAll('#ac-tabs .tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === S.tab));
    const body = root.querySelector('#ac-body');
    if (S.tab === 'people') paintPeople(body); else if (S.tab === 'groups') paintGroups(body); else paintRoles(body);
  }

  /* ============================== PEOPLE ============================== */
  function filteredPeople() {
    const q = S.q.toLowerCase();
    return S.people.filter((p) => p.role !== 'OWNER'
      && (!S.role || p.role === S.role)
      && (S.mode === 'all' || p.mode === S.mode)
      && (!q || `${p.name} ${p.employeeCode || ''} ${p.role}`.toLowerCase().includes(q)));
  }

  function paintPeople(body) {
    const roles = [...new Set(S.people.filter((p) => p.role !== 'OWNER').map((p) => p.role))];
    body.innerHTML = `
      <div class="card">
        <div class="ac-filters">
          <div class="toolbar-search input-group">
            <span class="input-group-icon">${window.Icons.get('search')}</span>
            <input class="input" id="ac-q" placeholder="Search employees" value="${esc(S.q)}" />
          </div>
          <select class="select" id="ac-role"><option value="">All roles</option>${roles.map((r) => `<option value="${r}" ${S.role === r ? 'selected' : ''}>${esc(roleLabel(r))}</option>`).join('')}</select>
          <div class="ac-chips" id="ac-modes">
            ${[['all', 'Everyone'], ['default', 'System defaults'], ['custom', 'Customised']].map(([k, l]) => `<span class="ac-chip btn-chip ${S.mode === k ? 'on' : ''}" data-mode="${k}">${l}</span>`).join('')}
          </div>
        </div>
        <div class="ac-bulk" id="ac-bulk"></div>
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th style="width:36px"><input type="checkbox" id="ac-all" aria-label="Select all"></th><th>Employee</th><th>Access</th><th>Can do</th><th></th></tr></thead>
            <tbody id="ac-rows"></tbody>
          </table>
        </div>
      </div>`;
    body.querySelector('#ac-q').addEventListener('input', window.UI.debounce((e) => { S.q = e.target.value.trim(); paintRows(); }));
    body.querySelector('#ac-role').addEventListener('change', (e) => { S.role = e.target.value; paintRows(); });
    body.querySelector('#ac-modes').addEventListener('click', (e) => { const c = e.target.closest('[data-mode]'); if (!c) return; S.mode = c.dataset.mode; paintPeople(body); });
    body.querySelector('#ac-all').addEventListener('change', (e) => { filteredPeople().forEach((p) => (e.target.checked ? S.sel.add(p._id) : S.sel.delete(p._id))); paintRows(); });
    paintRows();
  }

  function paintRows() {
    const tbody = root.querySelector('#ac-rows'); if (!tbody) return;
    const list = filteredPeople();
    if (!list.length) {
      tbody.innerHTML = `<tr><td colspan="5">${window.UI.emptyStateHtml({ icon: 'employees', title: 'No employees found', message: S.people.length > 1 ? 'Try a different search or filter.' : 'Add employees first, then control what they can do here.' })}</td></tr>`;
    } else {
      tbody.innerHTML = list.map((p) => {
        const groups = (p.groupIds || []).map(groupById).filter(Boolean);
        const custom = p.mode === 'custom';
        return `<tr data-id="${p._id}">
          <td><input type="checkbox" data-sel ${S.sel.has(p._id) ? 'checked' : ''} aria-label="Select ${esc(p.name)}"></td>
          <td><div class="cell-primary">${esc(p.name)}</div><div class="text-xs text-muted">${esc(roleLabel(p.role))}${p.employeeCode ? ' · ' + esc(p.employeeCode) : ''}${p.status !== 'active' ? ' · ' + esc(p.status) : ''}</div></td>
          <td><div class="ac-access-cell">
            <span class="badge ${custom ? 'badge-info' : 'badge-neutral'}">${custom ? 'Customised' : 'System defaults'}</span>
            ${custom ? groups.map((g) => `<span class="ac-chip"><span class="dot" style="background:${esc(g.color || COLORS[0])}"></span>${esc(g.name)}</span>`).join('') : ''}
            ${custom && p.grantCount ? `<span class="ac-num-allow">+${p.grantCount}</span>` : ''}${custom && p.revokeCount ? `<span class="ac-num-deny">−${p.revokeCount}</span>` : ''}
          </div></td>
          <td class="text-sm">${plural(p.effectiveCount, 'permission')}</td>
          <td class="actions"><button class="btn btn-secondary btn-sm" data-edit>Edit access</button></td>
        </tr>`;
      }).join('');
    }
    tbody.querySelectorAll('tr[data-id]').forEach((tr) => {
      tr.querySelector('[data-sel]').addEventListener('change', (e) => { e.target.checked ? S.sel.add(tr.dataset.id) : S.sel.delete(tr.dataset.id); paintBulk(); });
      tr.querySelector('[data-edit]').addEventListener('click', () => openEmployeeEditor(tr.dataset.id));
    });
    const all = root.querySelector('#ac-all'); if (all) all.checked = !!list.length && list.every((p) => S.sel.has(p._id));
    paintBulk();
  }

  function paintBulk() {
    const bar = root.querySelector('#ac-bulk'); if (!bar) return;
    S.sel = new Set([...S.sel].filter((id) => S.people.some((p) => p._id === id)));
    const n = S.sel.size;
    bar.classList.toggle('show', n > 0);
    if (!n) { bar.innerHTML = ''; return; }
    const groups = S.policy.groups;
    bar.innerHTML = `
      <strong>${plural(n, 'employee')} selected</strong>
      ${groups.length ? `<select class="select" data-bulk="addGroup"><option value="">Add to group…</option>${groups.map((g) => `<option value="${g._id}">${esc(g.name)}</option>`).join('')}</select>
      <select class="select" data-bulk="removeGroup"><option value="">Remove from group…</option>${groups.map((g) => `<option value="${g._id}">${esc(g.name)}</option>`).join('')}</select>` : ''}
      <button class="btn btn-secondary btn-sm" data-bulk-pick="grant">Allow…</button>
      <button class="btn btn-secondary btn-sm" data-bulk-pick="revoke">Deny…</button>
      <button class="btn btn-secondary btn-sm" data-bulk-pick="inherit">Back to default…</button>
      <button class="btn btn-ghost btn-sm" data-bulk-reset>Reset to system defaults</button>
      <button class="btn btn-ghost btn-sm" data-bulk-clear>Clear selection</button>`;
    bar.querySelectorAll('select[data-bulk]').forEach((s) => s.addEventListener('change', () => { if (s.value) runBulk({ op: s.dataset.bulk, groupId: s.value }); }));
    bar.querySelectorAll('[data-bulk-pick]').forEach((b) => b.addEventListener('click', async () => {
      const op = b.dataset.bulkPick;
      const titles = { grant: 'Allow these permissions', revoke: 'Deny these permissions', inherit: 'Put these permissions back to default' };
      const perms = await pickPermissions(titles[op], `For ${plural(S.sel.size, 'employee')}. ${op === 'grant' ? 'Employees are switched to Customised.' : ''}`);
      if (perms && perms.length) runBulk({ op, permissions: perms });
    }));
    bar.querySelector('[data-bulk-reset]').addEventListener('click', async () => {
      const ok = await window.UI.confirmDialog({ title: 'Reset to system defaults?', message: `${plural(S.sel.size, 'employee')} will lose all groups and custom allow/deny settings and go back to their role's defaults.`, confirmText: 'Reset', danger: true });
      if (ok) runBulk({ op: 'reset' });
    });
    bar.querySelector('[data-bulk-clear]').addEventListener('click', () => { S.sel.clear(); paintRows(); });
  }

  async function runBulk(payload) {
    try {
      const { data } = await window.Api.post('/permissions/employees/bulk', { employeeIds: [...S.sel], ...payload });
      toast(data.skipped.length ? `Updated ${data.updated}, skipped ${data.skipped.length}` : `Updated ${plural(data.updated, 'employee')}`);
      if (data.skipped.length) window.UI.toast.error(data.skipped.slice(0, 3).map((s) => s.reason).join(' · '));
      S.sel.clear(); await reloadAndPaint();
    } catch (err) { toast(err.message, 'error'); }
  }

  /* ============================== permission picker (for bulk) ============================== */
  function pickPermissions(title, hint) {
    return new Promise((resolve) => {
      let done = false; const chosen = new Set();
      const groups = cat().groups.filter((g) => hasFeature(g.feature));
      const modal = window.UI.openModal({
        title, maxWidth: '620px',
        bodyHtml: `${hint ? `<p class="ac-note">${esc(hint)}</p>` : ''}<input class="input" id="pk-q" placeholder="Search permissions" style="margin:var(--space-3) 0">
          <div class="ac-pick" id="pk-list"></div>`,
        footerHtml: '<button class="btn btn-secondary" data-x>Cancel</button><button class="btn btn-primary" data-ok>Continue</button>',
      });
      const listEl = modal.querySelector('#pk-list');
      const draw = () => {
        const q = modal.querySelector('#pk-q').value.trim().toLowerCase();
        listEl.innerHTML = groups.map((g) => {
          const items = cat().permissions.filter((p) => p.group === g.key && (!q || `${p.label} ${p.key} ${g.label}`.toLowerCase().includes(q)));
          if (!items.length) return '';
          return `<h5>${esc(g.label)}</h5>${items.map((p) => `<label><input type="checkbox" value="${p.key}" ${chosen.has(p.key) ? 'checked' : ''}> <span>${esc((p.section ? p.section + ' · ' : '') + p.label)} ${p.sensitive ? '<span class="badge badge-warning">sensitive</span>' : ''}</span></label>`).join('')}`;
        }).join('') || '<p class="ac-muted">Nothing matches.</p>';
      };
      listEl.addEventListener('change', (e) => { if (e.target.type === 'checkbox') (e.target.checked ? chosen.add(e.target.value) : chosen.delete(e.target.value)); });
      modal.querySelector('#pk-q').addEventListener('input', draw); draw();
      const finish = (v) => { if (done) return; done = true; window.UI.closeModal(); resolve(v); };
      modal.querySelector('[data-x]').addEventListener('click', () => finish(null));
      modal.querySelector('[data-ok]').addEventListener('click', () => finish([...chosen]));
    });
  }

  /* ============================== MATRIX EDITOR (shared) ============================== */
  /**
   * opts: { title, subtitle, topHtml, onTopMount(modal, api), getBase(): Map, initial:{grant,revoke}, inheritLabel,
   *         baseNoun, saveLabel, footerLeftHtml, onFooterMount(modal, api), extraDirty(): bool, onSave(grant, revoke), normalize }
   * api: { states, render(), setAll(fn), dirty() }
   */
  function openMatrix(opts) {
    const states = new Map();
    (opts.initial.grant || []).forEach((p) => states.set(p, 'allow'));
    (opts.initial.revoke || []).forEach((p) => states.set(p, 'deny'));
    const initial = new Map(states);
    const ui = { q: '', filter: 'all', showAll: false };
    const inh = opts.inheritLabel || 'Default';

    const modal = window.UI.openModal({
      title: opts.title, maxWidth: '900px',
      bodyHtml: `${opts.subtitle ? `<p class="text-sm text-muted" style="margin-top:0">${esc(opts.subtitle)}</p>` : ''}
        <div class="ac-top" id="mx-top">${opts.topHtml || ''}</div>
        <div id="mx-matrix">
          <div class="ac-tools">
            <input class="input" id="mx-q" placeholder="Search permissions (e.g. refund, stock, price)" />
            <select class="select" id="mx-filter" style="max-width:170px"><option value="all">All</option><option value="allowed">Allowed</option><option value="denied">Denied</option><option value="changed">Changed by you</option><option value="sensitive">Sensitive only</option></select>
            <select class="select" id="mx-quick" style="max-width:190px"><option value="">Quick set…</option><option value="view">Allow only “view” permissions</option><option value="nosens">Deny all sensitive</option><option value="clear">Clear all my changes</option></select>
          </div>
          <div class="ac-summary" id="mx-sum"></div>
          <div class="ac-list" id="mx-list"></div>
          <label class="checkbox-row" style="margin-top:var(--space-2)"><input type="checkbox" id="mx-all"> <span class="text-sm">Show permissions for modules this business doesn't use</span></label>
        </div>`,
      footerHtml: `${opts.footerLeftHtml || ''}<span style="flex:1"></span><button class="btn btn-secondary" data-x>Cancel</button><button class="btn btn-primary" data-save disabled>${esc(opts.saveLabel || 'Save changes')}</button>`,
    });

    const listEl = modal.querySelector('#mx-list'); const saveBtn = modal.querySelector('[data-save]');
    const stateOf = (k) => states.get(k) || 'inherit';
    const changedCount = () => { let n = 0; const keys = new Set([...states.keys(), ...initial.keys()]); keys.forEach((k) => { if ((states.get(k) || 'inherit') !== (initial.get(k) || 'inherit')) n += 1; }); return n; };
    const dirty = () => changedCount() > 0 || (opts.extraDirty ? opts.extraDirty() : false);

    function resultOf(k, base) {
      const st = stateOf(k);
      if (st === 'allow') return { ok: true, text: 'Allowed · set here', cls: 'ok' };
      if (st === 'deny') return { ok: false, text: 'Denied · set here', cls: 'no' };
      if (opts.noBase) return { ok: false, text: 'No effect', cls: 'na' };
      if (base.has(k)) return { ok: true, text: `Allowed · ${base.get(k)}`, cls: 'ok' };
      return { ok: false, text: base.denied && base.denied.get(k) ? `Denied · removed by ${base.denied.get(k)}` : 'Denied · not in default', cls: 'no' };
    }

    function render() {
      const base = opts.getBase(); const q = ui.q.toLowerCase(); const scroll = listEl.scrollTop;
      let html = '';
      const total = cat().permissions.length; const allowed = cat().permissions.filter((p) => resultOf(p.key, base).ok).length; // true effective count, not just what's visible
      cat().groups.forEach((g) => {
        const items = cat().permissions.filter((p) => p.group === g.key);
        const touched = items.some((p) => stateOf(p.key) !== 'inherit');
        if (!hasFeature(g.feature) && !ui.showAll && !touched && !q) return;
        let rows = ''; let lastSec = null;
        items.forEach((p) => {
          const r = resultOf(p.key, base);
          const changed = stateOf(p.key) !== (initial.get(p.key) || 'inherit');
          if (q && !`${p.label} ${p.key} ${g.label} ${p.description || ''}`.toLowerCase().includes(q)) return;
          if (ui.filter === 'allowed' && !r.ok) return; if (ui.filter === 'denied' && r.ok) return;
          if (ui.filter === 'changed' && !changed) return; if (ui.filter === 'sensitive' && !p.sensitive) return;
          if (p.section && p.section !== lastSec) { rows += `<div class="ac-sec">${esc(p.section)}</div>`; lastSec = p.section; }
          const st = stateOf(p.key);
          rows += `<div class="ac-p ${changed ? 'changed' : ''}" data-k="${p.key}">
            <div class="nm"><div class="t">${esc(p.label)} ${p.sensitive ? '<span class="badge badge-warning" title="Handle with care">sensitive</span>' : ''}</div>
              ${p.description ? `<div class="text-xs text-muted">${esc(p.description)}</div>` : ''}
              ${p.requires && p.requires.length ? `<div class="text-xs text-muted">Also needs: ${esc(p.requires.map((x) => x.replace('.', ' ')).join(', '))}</div>` : ''}
              <div class="r ${r.cls}">${esc(r.text)}</div><div class="k">${p.key}</div></div>
            <div class="ac-seg" data-k="${p.key}"><button data-s="inherit" class="${st === 'inherit' ? 'on' : ''}">${esc(inh)}</button><button data-s="allow" class="${st === 'allow' ? 'on' : ''}">Allow</button><button data-s="deny" class="${st === 'deny' ? 'on' : ''}">Deny</button></div>
          </div>`;
        });
        if (!rows) return;
        html += `<div class="ac-gh" data-g="${g.key}"><span>${esc(g.label)}</span><span class="acts"><button data-ga="allow">Allow all</button><button data-ga="deny">Deny all</button><button data-ga="inherit">Reset</button></span></div>${rows}`;
      });
      listEl.innerHTML = html || '<div class="ac-p"><span class="ac-muted">No permissions match.</span></div>';
      listEl.scrollTop = scroll;
      const n = changedCount();
      modal.querySelector('#mx-sum').innerHTML = opts.noBase
        ? `${plural(n, 'change')} to this set`
        : `<b>${allowed}</b> of ${total} permissions allowed · ${n ? `<b>${plural(n, 'change')}</b> not saved yet` : 'no changes yet'}`;
      saveBtn.disabled = !dirty();
    }

    function setState(k, st) {
      if (st === 'inherit') { states.delete(k); return; }
      states.set(k, st);
      // Allowing something also allows what it needs (server does the same) so it never half-works.
      if (st === 'allow' && !opts.noBase) (cat().permissions.find((p) => p.key === k)?.requires || []).forEach((r) => { if (stateOf(r) === 'deny') return; if (!opts.getBase().has(r)) states.set(r, 'allow'); });
      if (st === 'allow' && opts.noBase) (cat().permissions.find((p) => p.key === k)?.requires || []).forEach((r) => { if (stateOf(r) !== 'deny') states.set(r, 'allow'); });
    }
    function setGroup(gkey, st) { cat().permissions.filter((p) => p.group === gkey).forEach((p) => setState(p.key, st)); }

    listEl.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.s) { setState(b.closest('[data-k]').dataset.k, b.dataset.s); render(); return; }
      if (b.dataset.ga) { setGroup(b.closest('[data-g]').dataset.g, b.dataset.ga); render(); }
    });
    modal.querySelector('#mx-q').addEventListener('input', window.UI.debounce((e) => { ui.q = e.target.value.trim(); render(); }, 120));
    modal.querySelector('#mx-filter').addEventListener('change', (e) => { ui.filter = e.target.value; render(); });
    modal.querySelector('#mx-all').addEventListener('change', (e) => { ui.showAll = e.target.checked; render(); });
    modal.querySelector('#mx-quick').addEventListener('change', (e) => {
      const v = e.target.value; e.target.value = ''; if (!v) return;
      if (v === 'clear') { states.clear(); initial.forEach((st, k) => states.set(k, st)); /* back to what was saved */ }
      if (v === 'view') { const base = opts.getBase(); cat().permissions.forEach((p) => { const isView = /\.view$|\.view_all$/.test(p.key); const has = opts.noBase ? false : base.has(p.key); if (isView) setState(p.key, has && !opts.noBase ? 'inherit' : 'allow'); else setState(p.key, opts.noBase ? 'inherit' : (has ? 'deny' : 'inherit')); }); }
      if (v === 'nosens') cat().permissions.filter((p) => p.sensitive).forEach((p) => setState(p.key, 'deny'));
      render();
    });
    modal.querySelector('[data-x]').addEventListener('click', () => window.UI.closeModal());
    saveBtn.addEventListener('click', async () => {
      let grant = []; let revoke = []; const base = opts.getBase();
      states.forEach((st, k) => {
        if (opts.normalize && !opts.noBase) { if (st === 'allow' && base.has(k)) return; if (st === 'deny' && !base.has(k)) return; }
        (st === 'allow' ? grant : revoke).push(k);
      });
      window.UI.setButtonLoading(saveBtn, true, 'Saving…');
      try { await opts.onSave(grant, revoke); } catch (err) { toast(err.message, 'error'); } finally { window.UI.setButtonLoading(saveBtn, false); }
    });

    const api = { states, render, dirty, modal, refreshDirty: () => { saveBtn.disabled = !dirty(); }, setSaveEnabled: (v) => { saveBtn.disabled = !v; } };
    if (opts.onTopMount) opts.onTopMount(modal, api);
    if (opts.onFooterMount) opts.onFooterMount(modal, api);
    render();
    return api;
  }

  /* ============================== EMPLOYEE EDITOR ============================== */
  async function openEmployeeEditor(id) {
    let detail;
    try { ({ data: detail } = await window.Api.get(`/permissions/employees/${id}`, undefined, { fresh: true })); }
    catch (err) { toast(err.message, 'error'); return; }
    const emp = detail.employee;
    let mode = emp.mode; let groupIds = [...emp.groupIds];
    const startMode = mode; const startGroups = [...groupIds].sort().join(',');
    const defaultsCount = baseMap(emp.role).size;
    const others = S.people.filter((p) => p._id !== id && p.role !== 'OWNER' && p.status === 'active');

    const top = () => `
      <div class="ac-who"><div class="avatar" style="width:40px;height:40px">${window.UI.initials(emp.name)}</div>
        <div><div class="cell-primary" style="font-size:var(--text-md)">${esc(emp.name)}</div><div class="text-sm text-muted">${esc(roleLabel(emp.role))}${emp.employeeCode ? ' · ' + esc(emp.employeeCode) : ''}</div></div></div>
      <div class="ac-modes">
        <button type="button" class="ac-mode" data-mode="default"><b>System defaults</b><span>Gets everything a ${esc(roleLabel(emp.role))} normally gets (${defaultsCount} permissions).</span></button>
        <button type="button" class="ac-mode" data-mode="custom"><b>Custom</b><span>Add groups and allow or deny individual permissions.</span></button>
      </div>
      <div id="ed-custom">
        <div style="margin-bottom:var(--space-3)"><div class="text-xs text-muted" style="margin-bottom:6px">GROUPS</div>
          ${S.policy.groups.length ? `<div class="ac-chips" id="ed-groups">${S.policy.groups.map((g) => `<span class="ac-chip btn-chip" data-g="${g._id}"><span class="dot" style="background:${esc(g.color || COLORS[0])}"></span>${esc(g.name)}</span>`).join('')}</div>`
            : '<span class="text-sm text-muted">No groups yet — create reusable ones in the Groups tab.</span>'}</div>
        ${others.length ? `<div class="ac-row-inline"><span class="text-sm">Copy access from</span><select class="select" id="ed-copy"><option value="">Choose an employee…</option>${others.map((p) => `<option value="${p._id}">${esc(p.name)} (${esc(roleLabel(p.role))})</option>`).join('')}</select><button type="button" class="btn btn-secondary btn-sm" id="ed-copy-go">Copy</button></div>` : ''}
      </div>
      <div class="ac-note" id="ed-default-note">${esc(emp.name.split(' ')[0])} follows the ${esc(roleLabel(emp.role))} defaults${roleTemplate(emp.role) ? ' (including your business template for this role)' : ''}. Switch to <b>Custom</b> to change anything.${emp.mode === 'custom' && (emp.grant.length || emp.revoke.length || emp.groupIds.length) ? ' Your earlier custom settings are kept and will apply again if you switch back.' : ''}</div>`;

    const api = openMatrix({
      title: `Access · ${emp.name}`, inheritLabel: 'Default', topHtml: top(), initial: { grant: emp.grant, revoke: emp.revoke }, saveLabel: 'Save access',
      getBase: () => baseMap(emp.role, { groupIds }),
      extraDirty: () => mode !== startMode || [...groupIds].sort().join(',') !== startGroups,
      footerLeftHtml: '<button class="btn btn-ghost" data-reset>Reset to defaults</button>',
      onTopMount: (modal, a) => {
        const sync = () => {
          modal.querySelectorAll('.ac-mode').forEach((b) => b.classList.toggle('on', b.dataset.mode === mode));
          modal.querySelector('#ed-custom').style.display = mode === 'custom' ? '' : 'none';
          modal.querySelector('#mx-matrix').style.display = mode === 'custom' ? '' : 'none';
          modal.querySelector('#ed-default-note').style.display = mode === 'custom' ? 'none' : '';
          modal.querySelectorAll('#ed-groups [data-g]').forEach((c) => c.classList.toggle('on', groupIds.includes(c.dataset.g)));
          a.render();
        };
        modal.querySelector('.ac-modes').addEventListener('click', (e) => { const b = e.target.closest('[data-mode]'); if (b) { mode = b.dataset.mode; sync(); } });
        const gEl = modal.querySelector('#ed-groups');
        if (gEl) gEl.addEventListener('click', (e) => { const c = e.target.closest('[data-g]'); if (!c) return; groupIds = groupIds.includes(c.dataset.g) ? groupIds.filter((x) => x !== c.dataset.g) : [...groupIds, c.dataset.g]; sync(); });
        const go = modal.querySelector('#ed-copy-go');
        if (go) go.addEventListener('click', async () => {
          const srcId = modal.querySelector('#ed-copy').value; if (!srcId) return;
          try {
            const { data } = await window.Api.get(`/permissions/employees/${srcId}`, undefined, { fresh: true });
            const want = new Set(data.effective); const base = baseMap(emp.role, { groupIds });
            a.states.clear();
            cat().permissions.forEach((p) => { const has = base.has(p.key); if (want.has(p.key) && !has) a.states.set(p.key, 'allow'); else if (!want.has(p.key) && has) a.states.set(p.key, 'deny'); });
            mode = 'custom'; sync(); toast(`Copied ${data.employee.name}'s access — review it, then save`);
          } catch (err) { toast(err.message, 'error'); }
        });
        sync();
      },
      onFooterMount: (modal) => {
        modal.querySelector('[data-reset]').addEventListener('click', async () => {
          const ok = await window.UI.confirmDialog({ title: 'Reset to system defaults?', message: `${emp.name} will lose all groups and custom allow/deny settings.`, confirmText: 'Reset', danger: true });
          if (!ok) return;
          try { await window.Api.put(`/permissions/employees/${id}`, { reset: true }); window.UI.closeModal(); toast('Access reset to defaults'); reloadAndPaint(); } catch (err) { toast(err.message, 'error'); }
        });
      },
      onSave: async (grant, revoke) => {
        const payload = mode === 'default' ? { mode: 'default' } : { mode: 'custom', groupIds, grant, revoke };
        const { data } = await window.Api.put(`/permissions/employees/${id}`, payload);
        window.UI.closeModal();
        const d = data.diff;
        toast(d.added.length || d.removed.length ? `Saved · ${d.added.length} added, ${d.removed.length} removed` : 'Saved');
        reloadAndPaint();
      },
    });
    return api;
  }

  /* ============================== GROUPS ============================== */
  function paintGroups(body) {
    const gs = S.policy.groups;
    body.innerHTML = `
      <div class="card"><div class="card-body">
        <div style="display:flex;justify-content:space-between;gap:var(--space-3);flex-wrap:wrap;margin-bottom:var(--space-4)">
          <div><b>Groups</b><div class="text-sm text-muted">A group is a reusable set of allow/deny rules. Add it to anyone (or many people at once) — change the group and everyone in it updates.</div></div>
          <button class="btn btn-primary" id="g-new">${window.Icons.get('plus')} New group</button>
        </div>
        ${gs.length ? `<div class="ac-grid">${gs.map((g) => `
          <div class="ac-card" data-id="${g._id}">
            <h4><span class="ac-dot" style="background:${esc(g.color || COLORS[0])}"></span>${esc(g.name)}</h4>
            <div class="text-sm text-muted">${esc(g.description || 'No description')}</div>
            <div class="text-sm"><span class="ac-num-allow">+${(g.grant || []).length} allowed</span> · <span class="ac-num-deny">−${(g.revoke || []).length} denied</span> · ${plural(g.memberCount || 0, 'member')}</div>
            <div class="actions"><button class="btn btn-secondary btn-sm" data-a="edit">Edit</button><button class="btn btn-secondary btn-sm" data-a="members">Members</button><button class="btn btn-ghost btn-sm" data-a="del">Delete</button></div>
          </div>`).join('')}</div>`
        : `${window.UI.emptyStateHtml({ icon: 'employees', title: 'No groups yet', message: 'Create one to give several people the same extra access — or start from a ready-made idea:' })}
           <div class="ac-presets">${PRESETS.map((p, i) => `<button class="btn btn-secondary" data-preset="${i}">${esc(p.name)}</button>`).join('')}</div>`}
      </div></div>`;
    body.querySelector('#g-new').addEventListener('click', () => openGroupEditor(null));
    body.querySelectorAll('[data-preset]').forEach((b) => b.addEventListener('click', () => openGroupEditor(null, PRESETS[Number(b.dataset.preset)])));
    body.querySelectorAll('.ac-card').forEach((c) => c.addEventListener('click', async (e) => {
      const a = e.target.closest('[data-a]'); if (!a) return;
      const g = groupById(c.dataset.id);
      if (a.dataset.a === 'edit') openGroupEditor(g);
      if (a.dataset.a === 'members') openMembers(g);
      if (a.dataset.a === 'del') {
        const ok = await window.UI.confirmDialog({ title: `Delete “${g.name}”?`, message: g.memberCount ? `${plural(g.memberCount, 'member')} will lose the access this group gives.` : 'This group has no members.', confirmText: 'Delete', danger: true });
        if (!ok) return;
        try { await window.Api.delete(`/permissions/groups/${g._id}`); toast('Group deleted'); reloadAndPaint(); } catch (err) { toast(err.message, 'error'); }
      }
    }));
  }

  function openGroupEditor(group, preset) {
    const seed = group || preset || {};
    let grant = seed.grant; if (grant === '*view') grant = cat().permissions.filter((p) => /\.view$/.test(p.key)).map((p) => p.key);
    const known = new Set(cat().permissions.map((p) => p.key)); grant = (grant || []).filter((k) => known.has(k));
    let color = seed.color || COLORS[0];
    openMatrix({
      title: group ? `Edit group · ${group.name}` : 'New group', inheritLabel: 'Off', noBase: true, saveLabel: group ? 'Save group' : 'Create group',
      subtitle: 'Allow adds a permission for every member. Deny removes it — even if their role normally has it. “Off” leaves it alone.',
      topHtml: `<div class="form-row"><div class="field"><label>Group name</label><input class="input" id="gn" maxlength="60" value="${esc(seed.name || '')}" placeholder="e.g. Night shift supervisors"></div>
        <div class="field"><label>Description <span class="text-muted">(optional)</span></label><input class="input" id="gd" maxlength="200" value="${esc(seed.description || '')}"></div></div>
        <div class="ac-colors" id="gc">${COLORS.map((c) => `<button type="button" data-c="${c}" class="${c === color ? 'on' : ''}" style="background:${c}" aria-label="Colour"></button>`).join('')}</div>`,
      initial: { grant, revoke: group ? group.revoke : [] },
      getBase: () => new Map(),
      extraDirty: () => !group || (document.getElementById('gn') && (document.getElementById('gn').value !== (group.name || '') || document.getElementById('gd').value !== (group.description || '') || color !== (group.color || COLORS[0]))),
      onTopMount: (modal, a) => {
        modal.querySelector('#gc').addEventListener('click', (e) => { const b = e.target.closest('[data-c]'); if (!b) return; color = b.dataset.c; modal.querySelectorAll('#gc button').forEach((x) => x.classList.toggle('on', x === b)); a.refreshDirty(); });
        modal.querySelectorAll('#gn,#gd').forEach((i) => i.addEventListener('input', () => a.refreshDirty()));
        if (!group) a.setSaveEnabled(true);
      },
      onSave: async (g, r) => {
        const name = document.getElementById('gn').value.trim();
        if (name.length < 2) { toast('Give the group a name', 'error'); return; }
        const body = { name, description: document.getElementById('gd').value.trim(), color, grant: g, revoke: r };
        if (group) await window.Api.put(`/permissions/groups/${group._id}`, body); else await window.Api.post('/permissions/groups', body);
        window.UI.closeModal(); toast(group ? 'Group updated' : 'Group created'); reloadAndPaint();
      },
    });
  }

  function openMembers(group) {
    const people = S.people.filter((p) => p.role !== 'OWNER' && p.status === 'active');
    const start = new Set(people.filter((p) => (p.groupIds || []).includes(String(group._id))).map((p) => p._id));
    const chosen = new Set(start);
    const modal = window.UI.openModal({
      title: `Members · ${group.name}`, maxWidth: '520px',
      bodyHtml: `<p class="ac-note">Members are switched to <b>Customised</b> so the group applies. Changes take effect immediately.</p>
        <div class="ac-pick">${people.map((p) => `<label><input type="checkbox" value="${p._id}" ${chosen.has(p._id) ? 'checked' : ''}> <span>${esc(p.name)} <span class="text-muted text-sm">${esc(roleLabel(p.role))}</span></span></label>`).join('') || '<p class="ac-muted">No employees yet.</p>'}</div>`,
      footerHtml: '<button class="btn btn-secondary" data-x>Cancel</button><button class="btn btn-primary" data-ok>Save members</button>',
    });
    modal.addEventListener('change', (e) => { if (e.target.type === 'checkbox') (e.target.checked ? chosen.add(e.target.value) : chosen.delete(e.target.value)); });
    modal.querySelector('[data-x]').addEventListener('click', () => window.UI.closeModal());
    modal.querySelector('[data-ok]').addEventListener('click', async () => {
      const add = [...chosen].filter((i) => !start.has(i)); const rem = [...start].filter((i) => !chosen.has(i));
      try {
        let skipped = 0;
        if (add.length) skipped += (await window.Api.post('/permissions/employees/bulk', { employeeIds: add, op: 'addGroup', groupId: group._id })).data.skipped.length;
        if (rem.length) skipped += (await window.Api.post('/permissions/employees/bulk', { employeeIds: rem, op: 'removeGroup', groupId: group._id })).data.skipped.length;
        window.UI.closeModal(); toast(skipped ? `Saved, ${skipped} could not be changed` : 'Members saved'); reloadAndPaint();
      } catch (err) { toast(err.message, 'error'); }
    });
  }

  /* ============================== ROLES ============================== */
  function paintRoles(body) {
    body.innerHTML = `
      <div class="card"><div class="card-body">
        <div style="margin-bottom:var(--space-4)"><b>Role defaults</b><div class="text-sm text-muted">Change what <i>everyone</i> with a role gets — for example, stop all cashiers from issuing refunds. Individual employees and groups can still be adjusted on top.</div></div>
        <div class="table-wrap"><table class="table"><thead><tr><th>Role</th><th>Employees</th><th>System default</th><th>Your changes</th><th></th></tr></thead><tbody>
          ${cat().roles.filter((r) => hasFeature(roleFeature(r.role)) || S.policy.roleCounts[r.role] || roleTemplate(r.role)).map((r) => {
            const t = roleTemplate(r.role);
            return `<tr data-role="${r.role}"><td><span class="badge role-badge role-${r.role}">${esc(roleLabel(r.role))}</span></td><td>${S.policy.roleCounts[r.role] || 0}</td><td>${r.defaults.length} permissions</td>
              <td>${t ? `<span class="ac-num-allow">+${t.grant.length}</span> <span class="ac-num-deny">−${t.revoke.length}</span>` : '<span class="text-muted">None — using system defaults</span>'}</td>
              <td class="actions"><button class="btn btn-secondary btn-sm" data-a="edit">Customise</button>${t ? '<button class="btn btn-ghost btn-sm" data-a="reset">Reset</button>' : ''}</td></tr>`;
          }).join('')}
        </tbody></table></div>
      </div></div>`;
    body.querySelector('tbody').addEventListener('click', async (e) => {
      const b = e.target.closest('[data-a]'); if (!b) return; const role = b.closest('tr').dataset.role;
      if (b.dataset.a === 'edit') openRoleEditor(role);
      if (b.dataset.a === 'reset') {
        const ok = await window.UI.confirmDialog({ title: `Reset ${roleLabel(role)} to system defaults?`, message: `All ${roleLabel(role).toLowerCase()}s go back to the standard access (employees on System defaults are affected immediately).`, confirmText: 'Reset', danger: true });
        if (!ok) return;
        try { await window.Api.delete(`/permissions/roles/${role}`); toast('Role reset'); reloadAndPaint(); } catch (err) { toast(err.message, 'error'); }
      }
    });
  }
  const roleFeature = (role) => ({ WAITER: 'restaurantOrdering', HEAD_WAITER: 'restaurantOrdering', CHEF: 'restaurantOrdering', KITCHEN_STAFF: 'restaurantOrdering', BARTENDER: 'restaurantOrdering', EXPEDITOR: 'restaurantOrdering', DELIVERY_RIDER: 'restaurantOrdering', SUPERVISOR: 'restaurantOrdering', RECEPTIONIST: 'accommodation', HOUSEKEEPER: 'accommodation', PHARMACIST: 'pharmacyDispensing' }[role] || null);

  function openRoleEditor(role) {
    const t = roleTemplate(role) || { grant: [], revoke: [] }; const n = S.policy.roleCounts[role] || 0;
    openMatrix({
      title: `${roleLabel(role)} — role defaults`, inheritLabel: 'System', saveLabel: 'Save role defaults', normalize: true,
      subtitle: `Applies to ${plural(n, 'employee')} with this role who use System defaults, and to Custom employees as their starting point.`,
      initial: { grant: t.grant, revoke: t.revoke },
      getBase: () => baseMap(role, { template: false }),
      footerLeftHtml: '',
      onSave: async (grant, revoke) => {
        await window.Api.put(`/permissions/roles/${role}`, { grant, revoke });
        window.UI.closeModal(); toast('Role defaults saved'); reloadAndPaint();
      },
    });
  }
})();
