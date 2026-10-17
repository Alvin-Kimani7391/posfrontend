/**
 * module-kit.js - small helpers shared by the specialised module pages (batches, stocktakes,
 * serials, warranty, repairs, vehicles, job cards): list table with filters + pagination, form
 * modals, status badges. Same look as the existing pages (card / table / modal / badge classes).
 */
(function (window) {
  const esc = (v) => window.UI.escapeHtml(v == null ? '' : v);
  const can = (p) => window.Permissions.can(window.AppShell.getUser(), p);
  const money = (v) => window.UI.formatMoney(Number(v) || 0);
  const date = (v) => (v ? new Date(v).toLocaleDateString() : '-');
  const dateTime = (v) => (v ? new Date(v).toLocaleString() : '-');

  const BADGE = {
    good: ['active', 'in_stock', 'approved', 'resolved', 'collected', 'ready', 'open', 'received'],
    warn: ['quarantined', 'submitted', 'awaiting_approval', 'awaiting_parts', 'in_progress', 'quality_check', 'diagnosed', 'checked_in', 'returned', 'sold'],
    bad: ['recalled', 'expired', 'rejected', 'cancelled', 'damaged', 'unrepairable', 'depleted'],
  };
  function badge(status) {
    const s = String(status || '').toLowerCase();
    const cls = BADGE.good.includes(s) ? 'badge-success' : BADGE.warn.includes(s) ? 'badge-warning' : BADGE.bad.includes(s) ? 'badge-danger' : 'badge-neutral';
    return `<span class="badge ${cls}">${esc(String(status || '').replace(/_/g, ' '))}</span>`;
  }

  function fieldHtml(f, values = {}) {
    const v = values[f.name] != null ? values[f.name] : (f.value != null ? f.value : '');
    const req = f.required ? 'required' : '';
    let input;
    if (f.type === 'select') {
      input = `<select class="select" name="${f.name}" ${req}>${(f.options || []).map((o) => { const [val, label] = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(val)}" ${String(val) === String(v) ? 'selected' : ''}>${esc(label)}</option>`; }).join('')}</select>`;
    } else if (f.type === 'textarea') {
      input = `<textarea class="input" name="${f.name}" rows="3" ${req} placeholder="${esc(f.placeholder || '')}">${esc(v)}</textarea>`;
    } else if (f.type === 'checkbox') {
      return `<div class="field"><label class="checkbox-row"><input type="checkbox" name="${f.name}" ${v ? 'checked' : ''} /> <span class="text-sm">${esc(f.label)}</span></label></div>`;
    } else {
      input = `<input class="input" name="${f.name}" type="${f.type || 'text'}" ${f.step ? `step="${f.step}"` : ''} ${f.min != null ? `min="${f.min}"` : ''} value="${esc(v)}" ${req} placeholder="${esc(f.placeholder || '')}" />`;
    }
    return `<div class="field"><label>${esc(f.label)}${f.required ? ' *' : ''}</label>${input}${f.hint ? `<div class="text-xs text-muted">${esc(f.hint)}</div>` : ''}</div>`;
  }

  /** Read a form into an object: numbers stay strings (server coerces), empty values are dropped, checkboxes -> boolean. */
  function readForm(form, fields) {
    const out = {};
    fields.forEach((f) => {
      const el = form.elements[f.name];
      if (!el) return;
      if (f.type === 'checkbox') { out[f.name] = !!el.checked; return; }
      const val = String(el.value || '').trim();
      if (val !== '') out[f.name] = val;
    });
    return out;
  }

  /** formModal({ title, fields, submitLabel, intro, values, onSubmit(data) }) - closes itself on success. */
  function formModal({ title, fields, submitLabel = 'Save', intro = '', values = {}, onSubmit, maxWidth = '520px' }) {
    const modal = window.UI.openModal({
      title,
      bodyHtml: `${intro ? `<p class="text-sm text-secondary" style="margin-bottom:var(--space-3)">${intro}</p>` : ''}<form id="mk-form">${fields.map((f) => fieldHtml(f, values)).join('')}</form>`,
      footerHtml: `<button class="btn btn-secondary" data-action="cancel">Cancel</button><button class="btn btn-primary" data-action="save">${esc(submitLabel)}</button>`,
      maxWidth,
    });
    modal.querySelector('[data-action="cancel"]').addEventListener('click', () => window.UI.closeModal());
    const save = modal.querySelector('[data-action="save"]');
    const form = modal.querySelector('#mk-form');
    form.addEventListener('submit', (e) => { e.preventDefault(); save.click(); });
    save.addEventListener('click', async () => {
      if (!form.reportValidity()) return;
      window.UI.setButtonLoading(save, true, 'Saving…');
      try { await onSubmit(readForm(form, fields)); window.UI.closeModal(); }
      catch (err) { window.UI.toast.error(err.message || 'Something went wrong'); window.UI.setButtonLoading(save, false); }
    });
    return modal;
  }

  /**
   * listPage({ container, endpoint, columns:[{label, render(row), align}], filters:[{key,label,options}],
   *            query(): extra params, itemsKey, emptyText, search:true, rowActions(row) -> html, onAction(act,row,reload) })
   * Returns { reload }.
   */
  function listPage(cfg) {
    const state = { page: 1, limit: cfg.limit || 20, search: '', filters: {}, pages: 1, total: 0 };
    const root = cfg.container;
    root.innerHTML = `
      <div class="card">
        <div class="toolbar" style="gap:var(--space-2);flex-wrap:wrap">
          ${cfg.search ? `<div class="toolbar-search input-group"><input class="input" id="mk-search" placeholder="${esc(cfg.searchPlaceholder || 'Search')}" /></div>` : ''}
          ${(cfg.filters || []).map((f) => `<select class="select" data-filter="${f.key}" style="max-width:190px"><option value="">${esc(f.label)}</option>${f.options.map((o) => { const [val, label] = Array.isArray(o) ? o : [o, String(o).replace(/_/g, ' ')]; return `<option value="${esc(val)}">${esc(label)}</option>`; }).join('')}</select>`).join('')}
          <span style="flex:1"></span>${cfg.toolbarHtml || ''}
        </div>
        <div class="table-wrap"><table class="table"><thead><tr>${cfg.columns.map((c) => `<th ${c.align ? `style="text-align:${c.align}"` : ''}>${esc(c.label)}</th>`).join('')}${cfg.rowActions ? '<th></th>' : ''}</tr></thead>
        <tbody id="mk-body">${window.UI.skeletonRows(cfg.columns.length + (cfg.rowActions ? 1 : 0), 5)}</tbody></table></div>
        <div class="pagination" id="mk-pagination"></div>
      </div>`;

    async function reload() {
      const body = root.querySelector('#mk-body');
      try {
        const params = { page: state.page, limit: state.limit, ...(cfg.query ? cfg.query() : {}), ...state.filters };
        if (state.search) params[cfg.searchParam || 'search'] = state.search;
        Object.keys(params).forEach((k) => (params[k] === '' || params[k] == null) && delete params[k]);
        const { data } = await window.Api.get(cfg.endpoint, params);
        const items = data[cfg.itemsKey || 'items'] || [];
        state.total = data.total || items.length; state.pages = data.pages || Math.max(1, Math.ceil(state.total / state.limit));
        body.innerHTML = items.length ? items.map((row, i) => `<tr data-i="${i}">${cfg.columns.map((c) => `<td ${c.align ? `style="text-align:${c.align}"` : ''}>${c.render(row)}</td>`).join('')}${cfg.rowActions ? `<td style="text-align:right;white-space:nowrap">${cfg.rowActions(row)}</td>` : ''}</tr>`).join('')
          : `<tr><td colspan="${cfg.columns.length + 1}">${window.UI.emptyStateHtml({ icon: cfg.emptyIcon || 'box', title: cfg.emptyText || 'Nothing here yet', message: cfg.emptyMessage || '' })}</td></tr>`;
        body.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => {
          const row = items[Number(b.closest('tr').dataset.i)];
          cfg.onAction && cfg.onAction(b.dataset.act, row, reload);
        }));
        window.UI.renderPagination(root.querySelector('#mk-pagination'), state, (p) => { state.page = p; reload(); });
        window.Permissions.applyPermissionGates(root, window.AppShell.getUser());
        cfg.onLoaded && cfg.onLoaded(items, data);
      } catch (err) {
        body.innerHTML = `<tr><td colspan="${cfg.columns.length + 1}">${window.UI.emptyStateHtml({ icon: 'alert', title: 'Could not load', message: err.message })}</td></tr>`;
      }
    }
    root.querySelector('#mk-search')?.addEventListener('input', window.UI.debounce((e) => { state.search = e.target.value.trim(); state.page = 1; reload(); }));
    root.querySelectorAll('[data-filter]').forEach((s) => s.addEventListener('change', () => { state.filters[s.dataset.filter] = s.value; state.page = 1; reload(); }));
    reload();
    return { reload, state };
  }

  const btn = (act, label, cls = 'btn-secondary') => `<button class="btn ${cls} btn-sm" data-act="${act}">${esc(label)}</button>`;
  const kv = (pairs) => `<dl class="mk-kv">${pairs.filter(Boolean).map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${v == null || v === '' ? '-' : v}</dd></div>`).join('')}</dl>`;

  /** Branch to act in: the branch chosen in the top bar. */
  const branchId = () => window.AppShell.getActiveBranchId();

  window.ModuleKit = { esc, can, money, date, dateTime, badge, formModal, listPage, btn, kv, branchId };
})(window);
