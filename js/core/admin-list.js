/**
 * admin-list.js
 * Generic "toolbar + filters + table + pagination" for every admin list page.
 *
 * AdminList.create(rootEl, {
 *   endpoint: '/admin/sales',
 *   search: 'Search receipt...' | null,
 *   filters: [{ key:'businessId', type:'business' }, { key:'status', type:'select', label:'Status', options:[['','All'],['active','Active']] }, { key:'from', type:'date', label:'From' }],
 *   columns: [{ label, render(row), num }],
 *   onRow(row, api),
 *   empty: { title, message }
 * })
 * Filter values can be preset from the URL, e.g. admin-sales.html?businessId=abc
 */
(function (window) {
  const esc = (s) => window.UI.escapeHtml(s == null ? '' : String(s));

  function create(root, cfg) {
    const params = new URLSearchParams(window.location.search);
    const state = { page: 1, limit: 15, search: '', f: {}, items: [] };
    (cfg.filters || []).forEach((f) => { state.f[f.key] = params.get(f.key) || ''; });

    const fieldHtml = (f) => {
      const id = `al-f-${f.key}`;
      if (f.type === 'date') return `<div class="field"><label for="${id}">${esc(f.label)}</label><input class="input" type="date" id="${id}" value="${esc(state.f[f.key])}" /></div>`;
      const opts = f.type === 'business' ? '<option value="">All businesses</option>' : (f.options || []).map(([v, l]) => `<option value="${esc(v)}" ${state.f[f.key] === v ? 'selected' : ''}>${esc(l)}</option>`).join('');
      return `<div class="field"><label for="${id}">${esc(f.type === 'business' ? 'Business' : f.label)}</label><select class="select" id="${id}">${opts}</select></div>`;
    };

    root.innerHTML = `
      <div class="card">
        <div class="toolbar admin-filters">
          ${cfg.search ? `<div class="toolbar-search input-group"><span class="input-group-icon">${window.Icons.get('search')}</span><input class="input" id="al-search" type="text" placeholder="${esc(cfg.search)}" /></div>` : ''}
          ${(cfg.filters || []).map(fieldHtml).join('')}
          <button class="btn btn-ghost btn-sm" id="al-clear">Clear</button>
          <button class="btn btn-secondary btn-sm" id="al-refresh">Refresh</button>
        </div>
        <div class="table-wrap">
          <table class="table">
            <thead><tr>${cfg.columns.map((c) => `<th class="${c.num ? 'num' : ''}">${esc(c.label)}</th>`).join('')}</tr></thead>
            <tbody id="al-body">${window.UI.skeletonRows(cfg.columns.length, 5)}</tbody>
          </table>
        </div>
        <div class="pagination" id="al-pag"></div>
      </div>`;

    const $ = (id) => root.querySelector(`#${id}`);

    // Business dropdown is filled asynchronously.
    (cfg.filters || []).filter((f) => f.type === 'business').forEach(async (f) => {
      const list = await window.AdminShell.loadBusinesses();
      const sel = $(`al-f-${f.key}`);
      sel.innerHTML = '<option value="">All businesses</option>' + list.map((b) => `<option value="${esc(b._id)}" ${state.f[f.key] === b._id ? 'selected' : ''}>${esc(b.name)}</option>`).join('');
    });

    function query() {
      const q = { page: state.page, limit: state.limit, search: state.search || undefined };
      (cfg.filters || []).forEach((f) => {
        let v = state.f[f.key];
        if (!v) return;
        if (f.type === 'date') v = new Date(`${v}${f.key === 'to' ? 'T23:59:59.999' : 'T00:00:00'}`).toISOString();
        q[f.key] = v;
      });
      return q;
    }

    async function load() {
      const body = $('al-body');
      body.innerHTML = window.UI.skeletonRows(cfg.columns.length, 5);
      try {
        const { data } = await window.Api.get(cfg.endpoint, query());
        state.items = data.items || [];
        if (!state.items.length) {
          body.innerHTML = `<tr><td colspan="${cfg.columns.length}">${window.UI.emptyStateHtml({ icon: 'reports', title: cfg.empty?.title || 'Nothing found', message: cfg.empty?.message || 'Try changing the filters.' })}</td></tr>`;
        } else {
          body.innerHTML = state.items.map((row, i) => `<tr class="${cfg.onRow ? 'admin-row' : ''}" data-idx="${i}">${cfg.columns.map((c) => `<td class="${c.num ? 'num' : ''}">${c.render(row)}</td>`).join('')}</tr>`).join('');
          if (cfg.onRow) body.querySelectorAll('tr[data-idx]').forEach((tr) => tr.addEventListener('click', () => cfg.onRow(state.items[Number(tr.dataset.idx)], api)));
        }
        window.UI.renderPagination($('al-pag'), data, (p) => { state.page = p; load(); });
      } catch (err) {
        body.innerHTML = `<tr><td colspan="${cfg.columns.length}">${window.UI.emptyStateHtml({ icon: 'alert', title: 'Could not load data', message: err.message })}</td></tr>`;
      }
    }

    const reload = () => { state.page = 1; load(); };
    $('al-search')?.addEventListener('input', window.UI.debounce((e) => { state.search = e.target.value.trim(); reload(); }, 350));
    (cfg.filters || []).forEach((f) => $(`al-f-${f.key}`).addEventListener('change', (e) => { state.f[f.key] = e.target.value; reload(); }));
    $('al-refresh').addEventListener('click', load);
    $('al-clear').addEventListener('click', () => {
      state.search = ''; if ($('al-search')) $('al-search').value = '';
      (cfg.filters || []).forEach((f) => { state.f[f.key] = ''; $(`al-f-${f.key}`).value = ''; });
      reload();
    });

    const api = { reload: load };
    load();
    return api;
  }

  window.AdminList = { create };
})(window);