/**
 * crm.js - Customer CRM (Phase 1)
 *
 * Tabs: Overview | Customers | Segments | Settings (owners/admins)
 *  - Customers are captured automatically from sales and successful M-PESA payments.
 *  - Stage (new / returning / frequent / VIP / inactive) is computed by the backend from the
 *    thresholds in Settings, so changing a threshold re-labels everyone.
 *  - Segments are saved RULES evaluated live; Phase 2 (SMS) will target them by id.
 * All money from the API is integer cents -> money(); amounts typed by the user are KES.
 */
(function () {
  const RT = window.ReportTools;
  const CH = window.Charts;
  const esc = window.UI.escapeHtml;
  const Api = window.Api;
  const $ = (id) => document.getElementById(id);
  const kes = (c) => (Number(c) || 0) / 100;
  const money = (c) => window.UI.formatMoney(kes(c));
  const num = (n) => Number(n || 0).toLocaleString('en-KE');

  const STAGES = {
    vip: { label: 'VIP', color: '#b45309' },
    frequent: { label: 'Frequent', color: '#7c3aed' },
    returning: { label: 'Returning', color: '#0f766e' },
    new: { label: 'New', color: '#2563eb' },
    inactive: { label: 'Inactive', color: '#64748b' },
    prospect: { label: 'Not bought yet', color: '#94a3b8' },
  };
  const STAGE_ORDER = ['vip', 'frequent', 'returning', 'new', 'inactive', 'prospect'];
  const SWATCHES = ['#0f766e', '#2563eb', '#7c3aed', '#b45309', '#dc2626', '#0891b2', '#16a34a', '#be185d'];
  const METHODS = ['CASH', 'MPESA', 'CARD', 'BANK', 'CREDIT'];

  const NUM_OPS = ['gte', 'lte', 'gt', 'lt', 'eq', 'between'];
  const DAY_OPS = ['gt', 'gte', 'lt', 'lte', 'between'];
  const FIELD_META = {
    totalSpent: { label: 'Total spent (KES)', type: 'number', ops: NUM_OPS },
    purchaseCount: { label: 'Number of purchases', type: 'number', ops: NUM_OPS },
    avgOrder: { label: 'Average order (KES)', type: 'number', ops: NUM_OPS },
    recentPurchases: { label: 'Purchases in the "frequent" window', type: 'number', ops: NUM_OPS },
    lastPurchaseDays: { label: 'Days since last purchase', type: 'number', ops: DAY_OPS },
    customerSinceDays: { label: 'Days since added', type: 'number', ops: DAY_OPS },
    lifecycle: { label: 'Stage', type: 'select', ops: ['eq', 'neq'], options: STAGE_ORDER.map((k) => [k, STAGES[k].label]) },
    category: { label: 'Buys category', type: 'text', ops: ['contains', 'eq'] },
    paymentMethod: { label: 'Pays with', type: 'select', ops: ['eq', 'neq'], options: METHODS.map((m) => [m, m === 'MPESA' ? 'M-PESA' : m.charAt(0) + m.slice(1).toLowerCase()]) },
    tag: { label: 'Has tag', type: 'text', ops: ['contains', 'eq'] },
    hasPhone: { label: 'Has a valid phone number', type: 'bool', ops: ['eq'] },
    source: { label: 'Added via', type: 'select', ops: ['eq', 'neq'], options: [['manual', 'Added by hand'], ['pos', 'Point of sale'], ['mpesa', 'M-PESA payment']] },
  };
  const OP_LABEL = {
    gt: 'is more than', gte: 'is at least', lt: 'is less than', lte: 'is at most',
    eq: 'is', neq: 'is not', between: 'is between', contains: 'includes',
  };

  const state = {
    tab: 'overview',
    overview: null,
    atRisk: [],
    segments: [],
    settings: null,
    list: { page: 1, limit: 20, search: '', filter: '', sort: 'spent', total: 0, pages: 1 },
  };

  let contentEl;
  let user;
  let canManage = false;
  let canSettings = false;
  let tabToken = 0;
  let listToken = 0;
  let rebuildTimer = null;

  document.addEventListener('DOMContentLoaded', init);

  /* ===================================================================== *
   * Helpers
   * ===================================================================== */
  const pill = (stage) => {
    const s = STAGES[stage] || STAGES.prospect;
    return `<span class="crm-pill" style="--c:${s.color}">${esc(s.label)}</span>`;
  };
  const avatar = (name, stage, big) =>
    `<span class="crm-avatar${big ? ' lg' : ''}" style="--c:${(STAGES[stage] || STAGES.prospect).color}">${esc(window.UI.initials(name) || '?')}</span>`;
  const monthLabel = (ym) => {
    const [y, m] = String(ym).split('-').map(Number);
    return new Date(y, m - 1, 1).toLocaleString('en-KE', { month: 'short' });
  };
  const phoneText = (c) => c.phone || c.phoneNormalized || '';
  const errorCard = (err, retryId) => `<div class="card">${window.UI.emptyStateHtml({
    icon: 'alert', title: 'Could not load this section', message: err.message || 'Please try again.',
    actionHtml: `<button class="btn btn-secondary" id="${retryId}">Try again</button>`,
  })}</div>`;

  function stageHint(k, st) {
    switch (k) {
      case 'vip': {
        const parts = [];
        if (st.vipMinSpendCents > 0) parts.push(`spent ${money(st.vipMinSpendCents)}+`);
        if (st.vipMinPurchases > 0) parts.push(`${st.vipMinPurchases}+ purchases`);
        return parts.length ? parts.join(' or ') : 'Turned off in Settings';
      }
      case 'frequent': return `${st.frequentMinPurchases}+ purchases in ${st.frequentWindowDays} days`;
      case 'returning': return 'Bought 2 or more times';
      case 'new': return 'Bought once so far';
      case 'inactive': return `No purchase in ${st.inactiveDays}+ days`;
      default: return 'In your book, never bought';
    }
  }

  function ruleSummary(seg) {
    const glue = seg.match === 'any' ? ' or ' : ' and ';
    return (seg.rules || []).map((r) => {
      const m = FIELD_META[r.field];
      if (!m) return '';
      let val;
      if (m.type === 'bool') val = r.value === true || r.value === 'true' ? 'yes' : 'no';
      else if (m.type === 'select') val = (m.options.find((o) => o[0] === r.value) || [0, r.value])[1];
      else val = r.op === 'between' ? `${r.value} and ${r.value2}` : r.value;
      return `${m.label.toLowerCase()} ${OP_LABEL[r.op] || r.op} ${val}`;
    }).filter(Boolean).join(glue);
  }

  /* ===================================================================== *
   * Page frame
   * ===================================================================== */
  async function init() {
    contentEl = window.AppShell.mount({ title: 'CRM' });
    if (!contentEl) return;
    user = window.AppShell.getUser();
    canManage = window.Permissions.can(user, 'customers.update');
    canSettings = window.Permissions.can(user, 'settings.update');

    if (!window.Permissions.can(user, 'reports.view')) {
      contentEl.innerHTML = `<div class="card">${window.UI.emptyStateHtml({ icon: 'alert', title: 'No access', message: 'Customer spending is limited to managers and owners.' })}</div>`;
      return;
    }

    contentEl.innerHTML = `
      <div class="page-header">
        <div>
          <h1>Customer CRM</h1>
          <p>Every sale and M-PESA payment builds your customer book automatically.</p>
        </div>
        <div class="page-actions">
          <button class="btn btn-secondary btn-sm" id="crm-refresh">Refresh</button>
        </div>
      </div>
      <div class="tabs crm-tabs" id="crm-tabs" role="tablist">
        <button class="tab-btn" data-tab="overview" role="tab">Overview</button>
        <button class="tab-btn" data-tab="customers" role="tab">Customers</button>
        <button class="tab-btn" data-tab="segments" role="tab">Segments</button>
        ${canSettings ? '<button class="tab-btn" data-tab="settings" role="tab">Settings</button>' : ''}
      </div>
      <div class="crm-body" id="crm-body"></div>`;

    $('crm-tabs').addEventListener('click', (e) => {
      const b = e.target.closest('[data-tab]');
      if (b) showTab(b.dataset.tab);
    });
    $('crm-refresh').addEventListener('click', () => { state.overview = null; showTab(state.tab, true); });
    $('crm-body').addEventListener('click', onBodyClick);

    loadSegments(); // needed by the Customers filter + Segments tab
    showTab('overview');
  }

  function onBodyClick(e) {
    const open = e.target.closest('[data-open]');
    if (open) return openProfile(open.dataset.open);
    const stage = e.target.closest('[data-stage]');
    if (stage) { state.list.filter = `life:${stage.dataset.stage}`; state.list.page = 1; showTab('customers'); }
  }

  function showTab(name, force) {
    clearInterval(rebuildTimer);
    state.tab = name;
    document.querySelectorAll('#crm-tabs .tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
    ({ overview: renderOverview, customers: renderCustomers, segments: renderSegments, settings: renderSettings }[name])(force);
  }

  async function loadSegments() {
    try {
      const { data } = await Api.get('/crm/segments');
      state.segments = data.items || [];
      if (state.tab === 'customers') fillFilterSelect();
    } catch { /* non-fatal; segments tab will retry */ }
  }

  /* ===================================================================== *
   * OVERVIEW
   * ===================================================================== */
  async function renderOverview(force) {
    const body = $('crm-body');
    const my = ++tabToken;
    if (force || !state.overview) {
      body.innerHTML = `<div class="kpi-grid">${'<div class="kpi"><div class="skeleton" style="height:12px;width:50%"></div><div class="skeleton" style="height:28px;width:70%;margin-top:14px"></div></div>'.repeat(6)}</div>`;
      try {
        const [ov, risk] = await Promise.all([
          Api.get('/crm/overview'),
          Api.get('/crm/customers', { segmentId: 'sys:at-risk', sort: 'spent', limit: 6 }),
        ]);
        if (my !== tabToken) return;
        state.overview = ov.data;
        state.atRisk = risk.data.items || [];
        state.settings = ov.data.settings;
      } catch (err) {
        if (my !== tabToken) return;
        body.innerHTML = errorCard(err, 'crm-retry');
        $('crm-retry').addEventListener('click', () => renderOverview(true));
        return;
      }
    }

    const d = state.overview;
    const k = d.kpis;
    const st = d.settings;
    const empty = !k.customers;

    const tiles = [
      RT.kpi({ label: 'Customers', value: num(k.customers), icon: 'employees', tone: 'primary', sub: `${num(k.reachable)} reachable by SMS` }),
      RT.kpi({ label: 'Revenue from known customers', value: money(k.revenueCents), icon: 'reports', tone: 'success', sub: `${num(k.buyers)} have bought` }),
      RT.kpi({ label: 'Repeat rate', value: `${k.repeatRate}%`, icon: 'check', tone: k.repeatRate >= 30 ? 'success' : 'warning', sub: 'of buyers came back' }),
      RT.kpi({ label: 'Average spend per buyer', value: money(k.avgSpendCents), icon: 'wallet' }),
      RT.kpi({ label: `New in ${k.newWindowDays} days`, value: num(k.newRecent), icon: 'plus', tone: 'primary', sub: 'First purchase' }),
      RT.kpi({ label: 'Slipping away', value: num(k.atRisk), icon: 'alert', tone: k.atRisk ? 'warning' : 'neutral', sub: 'Repeat buyers gone quiet' }),
    ];

    const stageTiles = STAGE_ORDER.map((key) => {
      const s = STAGES[key];
      const v = d.lifecycle[key] || { count: 0, revenueCents: 0 };
      return `
        <button class="crm-stage" style="--c:${s.color}" data-stage="${key}" type="button">
          <span class="nm">${esc(s.label)}</span>
          <b>${num(v.count)}</b>
          <small>${esc(stageHint(key, st))}</small>
          <span class="rev">${key === 'prospect' ? 'No revenue yet' : `${money(v.revenueCents)} lifetime`}</span>
        </button>`;
    }).join('');

    const topRows = (d.topCustomers || []).map((c) => `
      <button class="crm-list-row" data-open="${c._id}" type="button">
        <div class="crm-person">${avatar(c.name, c.crm?.lifecycle)}<div class="meta"><div>${esc(c.name)}</div><div class="crm-sub">${num(c.crm?.purchaseCount)} purchases · ${phoneText(c) ? esc(phoneText(c)) : 'No phone'}</div></div></div>
        <div class="amt">${money(c.crm?.totalSpentCents)}</div>
      </button>`).join('');
    const riskRows = state.atRisk.map((c) => `
      <button class="crm-list-row" data-open="${c._id}" type="button">
        <div class="crm-person">${avatar(c.name, c.crm?.lifecycle)}<div class="meta"><div>${esc(c.name)}</div><div class="crm-sub">Last bought ${c.crm?.lastPurchaseAt ? window.UI.timeAgo(c.crm.lastPurchaseAt) : '—'}</div></div></div>
        <div class="amt">${money(c.crm?.totalSpentCents)}</div>
      </button>`).join('');

    body.innerHTML = `
      ${empty ? `
        <div class="crm-banner">
          <div><strong>Your customer book is empty</strong><span>New M-PESA payments will fill it automatically. To bring in past sales, build it from your sales history${canSettings ? '.' : ' — ask the owner.'}</span></div>
          ${canSettings ? '<button class="btn btn-primary btn-sm" id="crm-go-settings">Build from sales history</button>' : ''}
        </div>` : ''}
      <div class="kpi-grid">${tiles.join('')}</div>
      <div class="crm-stages">${stageTiles}</div>

      <div class="chart-grid g-1-1">
        ${RT.chartCard({ id: 'crm-trend', title: 'Revenue from known customers', subtitle: 'Last 12 months' })}
        ${RT.chartCard({ id: 'crm-growth', title: 'New customers and active buyers', subtitle: 'Per month' })}
      </div>
      <div class="chart-grid g-1-1">
        ${RT.chartCard({ id: 'crm-mix', title: 'Customer mix', subtitle: 'By stage' })}
        ${RT.chartCard({ id: 'crm-cats', title: 'What customers buy', subtitle: 'Top categories, last 90 days' })}
      </div>
      <div class="chart-grid g-1-1">
        <section class="card"><div class="card-header"><h3>Top customers</h3><span class="text-xs text-muted">By lifetime spend</span></div>
          <div class="crm-list">${topRows || '<div class="crm-list-empty">No purchases linked to customers yet.</div>'}</div></section>
        <section class="card"><div class="card-header"><h3>Win them back</h3><span class="text-xs text-muted">Repeat buyers who went quiet</span></div>
          <div class="crm-list">${riskRows || '<div class="crm-list-empty">Nobody is slipping away right now.</div>'}</div></section>
      </div>`;

    $('crm-go-settings')?.addEventListener('click', () => showTab('settings'));

    const tr = d.trend || [];
    CH.bar($('crm-trend'), {
      labels: tr.map((t) => monthLabel(t.month)),
      series: [{ name: 'Revenue', values: tr.map((t) => kes(t.revenueCents)) }],
      format: CH.compact, tipFormat: (v) => window.UI.formatMoney(v), height: 300, ariaLabel: 'Revenue from known customers by month',
      emptyText: 'Revenue appears once customers are linked to sales.',
    });
    CH.bar($('crm-growth'), {
      labels: tr.map((t) => monthLabel(t.month)),
      series: [
        { name: 'New customers', values: tr.map((t) => t.newCustomers), color: '#2563eb' },
        { name: 'Active buyers', values: tr.map((t) => t.buyers), color: '#0f766e' },
      ],
      format: (v) => num(v), tipFormat: (v) => num(v), height: 300, ariaLabel: 'New customers and active buyers by month', emptyText: 'Nothing to show yet.',
    });
    CH.donut($('crm-mix'), {
      data: STAGE_ORDER.map((key) => ({ label: STAGES[key].label, value: (d.lifecycle[key] || {}).count || 0, color: STAGES[key].color })),
      format: (v) => num(v), tipFormat: (v) => `${num(v)} customers`, centerFormat: (v) => num(v), centerLabel: 'Customers', ariaLabel: 'Customers by stage', emptyText: 'No customers yet.',
    });
    CH.hbar($('crm-cats'), {
      data: (d.categories || []).map((c) => ({ label: c.name, value: kes(c.spentCents) })),
      format: (v) => window.UI.formatMoney(v), valueLabel: 'Spent', ranked: true, emptyText: 'No category data yet.',
    });
  }

  /* ===================================================================== *
   * CUSTOMERS
   * ===================================================================== */
  function renderCustomers() {
    const L = state.list;
    $('crm-body').innerHTML = `
      <div class="card">
        <div class="crm-toolbar">
          <div class="toolbar-search input-group">
            <span class="input-group-icon">${window.Icons.get('search')}</span>
            <input class="input" id="crm-search" type="text" placeholder="Search name, phone or email" value="${esc(L.search)}" />
          </div>
          <select class="select" id="crm-filter" aria-label="Filter customers"></select>
          <select class="select" id="crm-sort" aria-label="Sort customers">
            <option value="spent">Highest spend</option>
            <option value="recent">Latest purchase</option>
            <option value="visits">Most purchases</option>
            <option value="newest">Newest customers</option>
            <option value="name">Name A–Z</option>
          </select>
          <span class="crm-count" id="crm-count"></span>
        </div>
        <div class="table-wrap flat">
          <table class="table crm-table">
            <thead><tr><th>Customer</th><th>Stage</th><th class="num">Purchases</th><th class="num">Total spent</th><th class="num">Avg order</th><th>Last purchase</th><th>Buys most</th></tr></thead>
            <tbody id="crm-tbody"></tbody>
          </table>
        </div>
        <div class="pagination" id="crm-pagination"></div>
      </div>`;

    fillFilterSelect();
    $('crm-sort').value = L.sort;
    $('crm-search').addEventListener('input', window.UI.debounce((e) => { L.search = e.target.value.trim(); L.page = 1; fetchCustomers(); }, 300));
    $('crm-filter').addEventListener('change', (e) => { L.filter = e.target.value; L.page = 1; fetchCustomers(); });
    $('crm-sort').addEventListener('change', (e) => { L.sort = e.target.value; L.page = 1; fetchCustomers(); });
    fetchCustomers();
  }

  function fillFilterSelect() {
    const sel = $('crm-filter');
    if (!sel) return;
    sel.innerHTML = `
      <option value="">All customers</option>
      <optgroup label="By stage">${STAGE_ORDER.map((k) => `<option value="life:${k}">${esc(STAGES[k].label)}</option>`).join('')}</optgroup>
      <optgroup label="Segments">${state.segments.map((s) => `<option value="seg:${esc(s.id)}">${esc(s.name)}</option>`).join('')}</optgroup>`;
    sel.value = state.list.filter;
    if (sel.value !== state.list.filter) sel.value = '';
  }

  async function fetchCustomers() {
    const L = state.list;
    const tbody = $('crm-tbody');
    if (!tbody) return;
    const my = ++listToken;
    tbody.innerHTML = window.UI.skeletonRows(7, 6);

    const q = { page: L.page, limit: L.limit, sort: L.sort, search: L.search };
    if (L.filter.startsWith('life:')) q.lifecycle = L.filter.slice(5);
    if (L.filter.startsWith('seg:')) q.segmentId = L.filter.slice(4);

    try {
      const { data } = await Api.get('/crm/customers', q);
      if (my !== listToken) return;
      L.total = data.total; L.pages = data.pages;
      $('crm-count').textContent = `${num(data.total)} customer${data.total === 1 ? '' : 's'}`;

      if (!data.items.length) {
        const filtered = L.search || L.filter;
        tbody.innerHTML = `<tr><td colspan="7">${window.UI.emptyStateHtml({
          icon: 'employees',
          title: filtered ? 'No customers match' : 'No customers yet',
          message: filtered ? 'Try a different search or filter.' : 'Customers appear here after their first sale or M-PESA payment.',
        })}</td></tr>`;
      } else {
        tbody.innerHTML = data.items.map((c) => {
          const x = c.crm || {};
          const cat = (x.topCategories && x.topCategories[0] && x.topCategories[0].name) || '—';
          return `
          <tr class="drilldown-row" data-open="${c._id}">
            <td><div class="crm-person">${avatar(c.name, x.lifecycle)}<div style="min-width:0"><div class="cell-primary">${esc(c.name)}</div><div class="crm-sub">${phoneText(c) ? esc(phoneText(c)) : 'No phone'}</div></div></div></td>
            <td>${pill(x.lifecycle)}</td>
            <td class="num">${num(x.purchaseCount)}</td>
            <td class="num font-semibold">${money(x.totalSpentCents)}</td>
            <td class="num">${x.purchaseCount ? money(x.avgOrderCents) : '—'}</td>
            <td class="text-sm">${x.lastPurchaseAt ? `${window.UI.timeAgo(x.lastPurchaseAt)}<div class="crm-sub">${window.UI.formatDate(x.lastPurchaseAt)}</div>` : '—'}</td>
            <td class="text-sm">${esc(cat)}</td>
          </tr>`;
        }).join('');
      }
      window.UI.renderPagination($('crm-pagination'), { page: data.page, pages: data.pages, total: data.total, limit: L.limit }, (p) => { L.page = p; fetchCustomers(); });
    } catch (err) {
      if (my !== listToken) return;
      tbody.innerHTML = `<tr><td colspan="7">${window.UI.emptyStateHtml({ icon: 'alert', title: 'Could not load customers', message: err.message })}</td></tr>`;
    }
  }

  /* ---- customer profile modal ---- */
  async function openProfile(id) {
    let data;
    try { ({ data } = await Api.get(`/crm/customers/${id}`)); } catch (err) { return window.UI.toast.error(err.message); }
    const c = data.customer;
    const x = c.crm || {};
    let tags = [...(c.tags || [])];

    const monthly = data.monthly || [];
    const cats = (x.topCategories || []).map((t) => `<span class="crm-chip">${esc(t.name)} · ${money(t.spentCents)}</span>`).join('') || '<span class="text-muted text-sm">No category data</span>';
    const segs = (data.segments || []).map((s) => `<span class="crm-chip seg" style="--c:${esc(s.color || '#0f766e')}">${esc(s.name)}</span>`).join('') || '<span class="text-muted text-sm">Not in any segment</span>';
    const sourceLabel = { manual: 'Added by hand', pos: 'Point of sale', mpesa: 'M-PESA payment' }[c.source] || '—';
    const usual = (x.paymentMix || []).slice(0, 3).map((m) => `${m.method === 'MPESA' ? 'M-PESA' : m.method} (${m.count})`).join(', ') || '—';

    const rows = (data.purchases || []).map((p) => `
      <tr>
        <td class="text-sm">${window.UI.formatDateTime(p.purchasedAt)}</td>
        <td class="cell-primary">${esc(p.saleNumber || '—')}</td>
        <td class="num">${num(p.itemCount)}</td>
        <td class="text-sm">${esc((p.paymentMethods || []).map((m) => (m === 'MPESA' ? 'M-PESA' : m)).join(', ') || '—')}${p.mpesaReceipt ? `<div class="crm-sub">${esc(p.mpesaReceipt)}</div>` : ''}</td>
        <td class="num font-semibold">${money(p.amountCents - (p.refundedCents || 0))}${p.refundedCents ? `<div class="crm-sub">${money(p.refundedCents)} refunded</div>` : ''}</td>
      </tr>`).join('');

    const modal = window.UI.openModal({
      title: 'Customer profile',
      maxWidth: '780px',
      bodyHtml: `
        <div class="crm-prof-head">
          ${avatar(c.name, x.lifecycle, true)}
          <div style="min-width:0">
            <h2>${esc(c.name)} ${pill(x.lifecycle)}</h2>
            <div class="contact">
              ${c.phone ? `<a href="tel:${esc(c.phoneNormalized || c.phone)}">${esc(c.phone)}</a>` : '<span class="text-muted">No phone</span>'}
              ${c.email ? `<span>${esc(c.email)}</span>` : ''}
            </div>
          </div>
        </div>

        <div class="crm-mini">
          <div><small>Total spent</small><b>${money(x.totalSpentCents)}</b></div>
          <div><small>Purchases</small><b>${num(x.purchaseCount)}</b></div>
          <div><small>Average order</small><b>${x.purchaseCount ? money(x.avgOrderCents) : '—'}</b></div>
          <div><small>Last purchase</small><b>${x.lastPurchaseAt ? window.UI.timeAgo(x.lastPurchaseAt) : '—'}</b></div>
        </div>

        <dl class="crm-kv">
          <dt>Customer since</dt><dd>${window.UI.formatDate(c.createdAt)} (${esc(sourceLabel)})</dd>
          <dt>First purchase</dt><dd>${x.firstPurchaseAt ? window.UI.formatDate(x.firstPurchaseAt) : '—'}</dd>
          <dt>Usually pays with</dt><dd>${esc(usual)}</dd>
          <dt>Owes you</dt><dd>${money(c.outstandingBalance)} <a href="customers.html" class="text-sm">Credit &amp; payments</a></dd>
        </dl>

        <div class="crm-sect">Segments</div><div class="crm-chips">${segs}</div>
        <div class="crm-sect">Favourite categories</div><div class="crm-chips">${cats}</div>
        <div class="crm-sect">Tags</div>
        <div class="crm-chips" id="cp-tags"></div>
        ${canManage ? '<div class="crm-tag-add"><input class="input" id="cp-tag-input" maxlength="24" placeholder="Add a tag, e.g. wholesale" /><button class="btn btn-secondary btn-sm" id="cp-tag-btn" type="button">Add</button></div>' : ''}

        <div class="crm-sect">Spending, last 12 months</div>
        <div id="cp-monthly"></div>

        <div class="crm-sect">Purchase history</div>
        <div class="table-wrap flat">
          <table class="table">
            <thead><tr><th>Date</th><th>Receipt</th><th class="num">Items</th><th>Paid with</th><th class="num">Amount</th></tr></thead>
            <tbody>${rows || `<tr><td colspan="5"><div class="crm-list-empty">No purchases linked yet.</div></td></tr>`}</tbody>
          </table>
        </div>
        ${(x.purchaseCount || 0) > (data.purchases || []).length ? `<p class="crm-sub" style="margin-top:8px">Showing the latest ${data.purchases.length} of ${num(x.purchaseCount)} purchases.</p>` : ''}`,
      footerHtml: '<button class="btn btn-secondary" data-action="close">Close</button>',
    });
    modal.querySelector('[data-action="close"]').addEventListener('click', window.UI.closeModal);

    CH.bar(modal.querySelector('#cp-monthly'), {
      labels: monthly.map((m) => monthLabel(m.month)),
      series: [{ name: 'Spent', values: monthly.map((m) => kes(m.spentCents)) }],
      format: CH.compact, tipFormat: (v) => window.UI.formatMoney(v), height: 240, ariaLabel: 'Monthly spending', emptyText: 'No spending in the last 12 months.',
    });

    const tagBox = modal.querySelector('#cp-tags');
    const drawTags = () => {
      tagBox.innerHTML = tags.length
        ? tags.map((t, i) => `<span class="crm-chip">${esc(t)}${canManage ? `<button type="button" data-rm="${i}" aria-label="Remove tag">×</button>` : ''}</span>`).join('')
        : '<span class="text-muted text-sm">No tags</span>';
    };
    const saveTags = async (next) => {
      try {
        const res = await Api.put(`/crm/customers/${id}/tags`, { tags: next });
        tags = res.data.tags; drawTags();
      } catch (err) { window.UI.toast.error(err.message); }
    };
    drawTags();
    tagBox.addEventListener('click', (e) => {
      const b = e.target.closest('[data-rm]');
      if (b) saveTags(tags.filter((_, i) => i !== Number(b.dataset.rm)));
    });
    const addTag = () => {
      const input = modal.querySelector('#cp-tag-input');
      const v = (input.value || '').trim();
      if (!v || tags.includes(v)) { input.value = ''; return; }
      input.value = '';
      saveTags([...tags, v]);
    };
    modal.querySelector('#cp-tag-btn')?.addEventListener('click', addTag);
    modal.querySelector('#cp-tag-input')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } });
  }

  /* ===================================================================== *
   * SEGMENTS
   * ===================================================================== */
  async function renderSegments() {
    const body = $('crm-body');
    const my = ++tabToken;
    body.innerHTML = '<div class="crm-seg-grid">' + '<div class="card" style="padding:20px"><div class="skeleton" style="height:90px"></div></div>'.repeat(4) + '</div>';
    try {
      const { data } = await Api.get('/crm/segments');
      if (my !== tabToken) return;
      state.segments = data.items || [];
    } catch (err) {
      if (my !== tabToken) return;
      body.innerHTML = errorCard(err, 'crm-seg-retry');
      $('crm-seg-retry').addEventListener('click', renderSegments);
      return;
    }

    const card = (s) => `
      <article class="crm-seg-card" style="--c:${esc(s.color || '#0f766e')}">
        <h4>${esc(s.name)}</h4>
        ${s.description ? `<div class="desc">${esc(s.description)}</div>` : ''}
        ${s.system ? '' : `<div class="rules">${esc(ruleSummary(s))}</div>`}
        <div class="count">${num(s.memberCount)}<small>customer${s.memberCount === 1 ? '' : 's'}</small></div>
        <div class="crm-seg-actions">
          <button class="btn btn-secondary btn-sm" data-seg-view="${esc(s.id)}" type="button">View customers</button>
          ${!s.system && canManage ? `<button class="btn btn-ghost btn-sm" data-seg-edit="${esc(s.id)}" type="button">Edit</button><button class="btn btn-ghost btn-sm" data-seg-del="${esc(s.id)}" type="button">Delete</button>` : ''}

          <button class="btn btn-secondary btn-sm" data-seg-sms="${esc(s.id)}" type="button">Send SMS</button>


        </div>
      </article>`;

    const sys = state.segments.filter((s) => s.system);
    const custom = state.segments.filter((s) => !s.system);
    body.innerHTML = `
      <div class="crm-seg-head">
        <div><h3>Your segments</h3><p>Saved rules that stay up to date as customers buy. Pick one when you send SMS campaigns.</p></div>
        ${canManage ? '<button class="btn btn-primary" id="crm-new-seg" type="button">New segment</button>' : ''}
      </div>
      ${custom.length ? `<div class="crm-seg-grid">${custom.map(card).join('')}</div>` : `<div class="card">${window.UI.emptyStateHtml({ icon: 'employees', title: 'No custom segments yet', message: 'Combine spend, visits, categories and more — for example "spent over 10,000 and quiet for 30 days".' })}</div>`}
      <div class="crm-seg-head"><div><h3>Built-in segments</h3><p>Ready to use. Their thresholds follow your CRM settings.</p></div></div>
      <div class="crm-seg-grid">${sys.map(card).join('')}</div>`;

    $('crm-new-seg')?.addEventListener('click', () => openSegmentModal(null));
    body.querySelectorAll('[data-seg-view]').forEach((b) => b.addEventListener('click', () => {
      state.list.filter = `seg:${b.dataset.segView}`; state.list.page = 1; showTab('customers');
    }));
    body.querySelectorAll('[data-seg-edit]').forEach((b) => b.addEventListener('click', () => openSegmentModal(state.segments.find((s) => s.id === b.dataset.segEdit))));
    body.querySelectorAll('[data-seg-del]').forEach((b) => b.addEventListener('click', async () => {
      const seg = state.segments.find((s) => s.id === b.dataset.segDel);
      const ok = await window.UI.confirmDialog({ title: 'Delete segment?', message: `"${seg.name}" will be removed. Customers are not affected.`, confirmText: 'Delete segment', danger: true });
      if (!ok) return;
      try { await Api.delete(`/crm/segments/${seg.id}`); window.UI.toast.success('Segment deleted'); renderSegments(); } catch (err) { window.UI.toast.error(err.message); }
    }));


        body.querySelectorAll('[data-seg-sms]').forEach((b) => b.addEventListener('click', () => {
      window.location.href = `sms.html?tab=compose&segment=${encodeURIComponent(b.dataset.segSms)}`;
    }));



    
  }

  function blankRule() { return { field: 'totalSpent', op: 'gte', value: '' }; }

  function openSegmentModal(seg) {
    const draft = {
      name: seg ? seg.name : '',
      description: seg ? seg.description || '' : '',
      color: seg ? seg.color : SWATCHES[0],
      match: seg ? seg.match : 'all',
      rules: seg && seg.rules.length ? seg.rules.map((r) => ({ ...r })) : [blankRule()],
    };

    const modal = window.UI.openModal({
      title: seg ? 'Edit segment' : 'New segment',
      maxWidth: '760px',
      bodyHtml: `
        <div class="form-row">
          <div class="field"><label for="sg-name">Name</label><input class="input" id="sg-name" maxlength="60" placeholder="Big spenders gone quiet" value="${esc(draft.name)}" /></div>
          <div class="field"><label for="sg-desc">Description <span class="text-muted">(optional)</span></label><input class="input" id="sg-desc" maxlength="200" value="${esc(draft.description)}" /></div>
        </div>
        <div class="field"><label>Colour</label><div class="crm-swatches" id="sg-colors">${SWATCHES.map((c) => `<button type="button" class="crm-swatch ${c === draft.color ? 'on' : ''}" style="--c:${c}" data-c="${c}" aria-label="Colour ${c}"></button>`).join('')}</div></div>
        <div class="crm-match">Customers who match
          <select class="select" id="sg-match"><option value="all">all</option><option value="any">any</option></select>
          of these rules:</div>
        <div id="sg-rules"></div>
        <button class="btn btn-secondary btn-sm" id="sg-add" type="button">Add rule</button>
        <div class="crm-preview" id="sg-preview">Add a rule to see who matches.</div>`,
      footerHtml: `<button class="btn btn-secondary" data-action="cancel">Cancel</button><button class="btn btn-primary" data-action="save" id="sg-save">${seg ? 'Save changes' : 'Create segment'}</button>`,
    });

    const rulesEl = modal.querySelector('#sg-rules');
    modal.querySelector('#sg-match').value = draft.match;

    function valueInput(r, m, i) {
      if (m.type === 'bool') {
        const yes = r.value === true || r.value === 'true';
        return `<select class="select" data-i="${i}" data-k="value"><option value="true" ${yes ? 'selected' : ''}>Yes</option><option value="false" ${!yes && r.value !== '' && r.value !== undefined ? 'selected' : ''}>No</option></select>`;
      }
      if (m.type === 'select') {
        return `<select class="select" data-i="${i}" data-k="value"><option value="">Choose…</option>${m.options.map(([v, l]) => `<option value="${esc(v)}" ${String(r.value) === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
      }
      const type = m.type === 'number' ? 'number' : 'text';
      const one = `<input class="input" type="${type}" ${type === 'number' ? 'min="0" step="any" inputmode="decimal"' : 'maxlength="60"'} data-i="${i}" data-k="value" value="${esc(r.value ?? '')}" placeholder="${type === 'number' ? 'Amount or number' : 'Text'}" />`;
      if (r.op !== 'between') return one;
      return `<div class="pair">${one}<span>and</span><input class="input" type="number" min="0" step="any" inputmode="decimal" data-i="${i}" data-k="value2" value="${esc(r.value2 ?? '')}" /></div>`;
    }

    function drawRules() {
      rulesEl.innerHTML = draft.rules.map((r, i) => {
        const m = FIELD_META[r.field];
        return `
        <div class="crm-rule" data-i="${i}">
          <select class="select" data-i="${i}" data-k="field" aria-label="Field">${Object.entries(FIELD_META).map(([k, f]) => `<option value="${k}" ${k === r.field ? 'selected' : ''}>${esc(f.label)}</option>`).join('')}</select>
          <select class="select" data-i="${i}" data-k="op" aria-label="Condition">${m.ops.map((o) => `<option value="${o}" ${o === r.op ? 'selected' : ''}>${esc(OP_LABEL[o])}</option>`).join('')}</select>
          ${valueInput(r, m, i)}
          <button class="btn btn-ghost btn-icon btn-sm" type="button" data-rm="${i}" aria-label="Remove rule" ${draft.rules.length === 1 ? 'disabled' : ''}>${window.Icons.get('close')}</button>
        </div>`;
      }).join('');
    }
    drawRules();

    /* ---- cleaned rules for the API (drops incomplete rows) ---- */
    function cleanRules() {
      return draft.rules.map((r) => {
        const m = FIELD_META[r.field];
        const out = { field: r.field, op: r.op };
        if (m.type === 'bool') out.value = r.value === true || r.value === 'true';
        else if (m.type === 'number') {
          if (r.value === '' || r.value === undefined || Number.isNaN(Number(r.value))) return null;
          out.value = Number(r.value);
          if (r.op === 'between') {
            if (r.value2 === '' || r.value2 === undefined || Number.isNaN(Number(r.value2))) return null;
            out.value2 = Number(r.value2);
          }
        } else {
          if (!String(r.value ?? '').trim()) return null;
          out.value = String(r.value).trim();
        }
        return out;
      }).filter(Boolean);
    }

    /* ---- live preview ---- */
    let pv = 0;
    const runPreview = window.UI.debounce(async () => {
      const box = modal.querySelector('#sg-preview');
      const rules = cleanRules();
      if (!rules.length) { box.textContent = 'Fill in a rule to see who matches.'; return; }
      const my = ++pv;
      try {
        const { data } = await Api.post('/crm/segments/preview', { match: draft.match, rules });
        if (my !== pv) return;
        box.innerHTML = `<strong>${num(data.count)}</strong> customer${data.count === 1 ? '' : 's'} match right now.
          ${data.sample.length ? `<ul>${data.sample.map((s) => `<li>${esc(s.name)} · ${money(s.crm?.totalSpentCents)}</li>`).join('')}</ul>` : ''}`;
      } catch (err) {
        if (my === pv) box.textContent = err.message;
      }
    }, 450);
    if (seg) runPreview();

    /* ---- events ---- */
    modal.querySelector('#sg-colors').addEventListener('click', (e) => {
      const b = e.target.closest('[data-c]');
      if (!b) return;
      draft.color = b.dataset.c;
      modal.querySelectorAll('.crm-swatch').forEach((s) => s.classList.toggle('on', s === b));
    });
    modal.querySelector('#sg-match').addEventListener('change', (e) => { draft.match = e.target.value; runPreview(); });
    modal.querySelector('#sg-add').addEventListener('click', () => {
      if (draft.rules.length >= 10) return window.UI.toast.error('A segment can have up to 10 rules');
      draft.rules.push(blankRule()); drawRules();
    });
    rulesEl.addEventListener('click', (e) => {
      const b = e.target.closest('[data-rm]');
      if (!b || draft.rules.length === 1) return;
      draft.rules.splice(Number(b.dataset.rm), 1); drawRules(); runPreview();
    });
    const onEdit = (e) => {
      const t = e.target.closest('[data-k]');
      if (!t) return;
      const r = draft.rules[Number(t.dataset.i)];
      const k = t.dataset.k;
      if (k === 'field') {
        const m = FIELD_META[t.value];
        r.field = t.value; r.op = m.ops[0]; r.value = m.type === 'bool' ? true : ''; delete r.value2;
        drawRules();
      } else if (k === 'op') {
        r.op = t.value;
        if (t.value !== 'between') delete r.value2;
        drawRules();
      } else {
        r[k] = t.value;
      }
      runPreview();
    };
    rulesEl.addEventListener('input', (e) => { if (e.target.matches('input')) onEdit(e); });
    rulesEl.addEventListener('change', (e) => { if (e.target.matches('select')) onEdit(e); });

    modal.querySelector('[data-action="cancel"]').addEventListener('click', window.UI.closeModal);
    modal.querySelector('#sg-save').addEventListener('click', async () => {
      const name = modal.querySelector('#sg-name').value.trim();
      const rules = cleanRules();
      if (name.length < 2) return window.UI.toast.error('Give the segment a name');
      if (!rules.length) return window.UI.toast.error('Complete at least one rule');
      const btn = modal.querySelector('#sg-save');
      window.UI.setButtonLoading(btn, true, 'Saving…');
      try {
        const payload = { name, description: modal.querySelector('#sg-desc').value.trim(), color: draft.color, match: draft.match, rules };
        if (seg) await Api.put(`/crm/segments/${seg.id}`, payload); else await Api.post('/crm/segments', payload);
        window.UI.toast.success(seg ? 'Segment updated' : 'Segment created');
        window.UI.closeModal();
        renderSegments();
      } catch (err) {
        window.UI.toast.error(err.message);
      } finally {
        window.UI.setButtonLoading(btn, false);
      }
    });
  }

  /* ===================================================================== *
   * SETTINGS (owners / admins)
   * ===================================================================== */
  async function renderSettings() {
    const body = $('crm-body');
    const my = ++tabToken;
    body.innerHTML = '<div class="card"><div class="card-body"><div class="skeleton" style="height:220px"></div></div></div>';
    let st;
    let rebuild;
    try {
      const [s, r] = await Promise.all([Api.get('/crm/settings'), Api.get('/crm/rebuild')]);
      if (my !== tabToken) return;
      st = s.data.settings; rebuild = r.data.rebuild;
    } catch (err) {
      if (my !== tabToken) return;
      body.innerHTML = errorCard(err, 'crm-set-retry');
      $('crm-set-retry').addEventListener('click', renderSettings);
      return;
    }
    state.settings = st;

    body.innerHTML = `
      <div class="crm-settings">
        <section class="card">
          <div class="card-header"><h3>How customers are classified</h3></div>
          <div class="card-body">
            <form id="crm-set-form">
              <div class="form-row">
                <div class="field"><label for="s-inactive">Inactive after (days without a purchase)</label><input class="input" id="s-inactive" name="inactiveDays" type="number" min="7" max="730" required value="${st.inactiveDays}" /></div>
                <div class="field"><label for="s-new">"New" window (days)</label><input class="input" id="s-new" name="newWindowDays" type="number" min="1" max="365" required value="${st.newWindowDays}" /><span class="field-hint">Used for the "new customers" figure.</span></div>
              </div>
              <div class="form-row">
                <div class="field"><label for="s-fmin">Frequent: purchases needed</label><input class="input" id="s-fmin" name="frequentMinPurchases" type="number" min="2" max="100" required value="${st.frequentMinPurchases}" /></div>
                <div class="field"><label for="s-fwin">Frequent: within (days)</label><input class="input" id="s-fwin" name="frequentWindowDays" type="number" min="7" max="365" required value="${st.frequentWindowDays}" /></div>
              </div>
              <div class="form-row">
                <div class="field"><label for="s-vip">VIP: total spent (KES)</label><input class="input" id="s-vip" name="vipMinSpend" type="number" min="0" step="1" required value="${Math.round(kes(st.vipMinSpendCents))}" /><span class="field-hint">Set 0 to switch off.</span></div>
                <div class="field"><label for="s-vipn">VIP: or number of purchases</label><input class="input" id="s-vipn" name="vipMinPurchases" type="number" min="0" max="10000" required value="${st.vipMinPurchases}" /><span class="field-hint">Set 0 to switch off.</span></div>
              </div>
              <button class="btn btn-primary" type="submit" id="s-save">Save and re-label customers</button>
            </form>
          </div>
        </section>

        <div style="display:flex;flex-direction:column;gap:var(--space-5)">
          <section class="card">
            <div class="card-header"><h3>The rules, in plain words</h3></div>
            <div class="card-body"><ol class="crm-rules-preview" id="s-explain"></ol></div>
          </section>
          <section class="card">
            <div class="card-header"><h3>Build from sales history</h3></div>
            <div class="card-body" id="s-rebuild"></div>
          </section>
        </div>
      </div>`;

    const form = $('crm-set-form');
    const explain = () => {
      const v = window.UI.serializeForm(form);
      const vip = [];
      if (Number(v.vipMinSpend) > 0) vip.push(`spent ${window.UI.formatMoney(Number(v.vipMinSpend))} or more`);
      if (Number(v.vipMinPurchases) > 0) vip.push(`bought ${v.vipMinPurchases}+ times`);
      $('s-explain').innerHTML = `
        <li><b>Inactive</b> — no purchase in ${esc(v.inactiveDays)} days. This wins over every other stage so lapsed customers show up for win-back.</li>
        <li><b>VIP</b> — ${vip.length ? esc(vip.join(' or ')) : 'switched off'}.</li>
        <li><b>Frequent</b> — ${esc(v.frequentMinPurchases)}+ purchases in ${esc(v.frequentWindowDays)} days.</li>
        <li><b>Returning</b> — bought 2 or more times.</li>
        <li><b>New</b> — bought once so far.</li>`;
    };
    explain();
    form.addEventListener('input', explain);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = $('s-save');
      window.UI.setButtonLoading(btn, true, 'Saving…');
      try {
        const v = window.UI.serializeForm(form);
        const payload = {};
        ['inactiveDays', 'newWindowDays', 'frequentMinPurchases', 'frequentWindowDays', 'vipMinSpend', 'vipMinPurchases'].forEach((k) => { payload[k] = Number(v[k]); });
        await Api.put('/crm/settings', payload);
        state.overview = null;
        window.UI.toast.success('Saved. Customer stages are updating in the background.');
      } catch (err) {
        if (err.code === 'VALIDATION_ERROR' && err.errors?.length) window.UI.applyFormErrors(form, err.errors);
        else window.UI.toast.error(err.message);
      } finally {
        window.UI.setButtonLoading(btn, false);
      }
    });

    drawRebuild(rebuild, st.lastRebuildAt);
  }

  function drawRebuild(r, lastAt) {
    const el = $('s-rebuild');
    if (!el) return;
    const running = r.state === 'running';
    const stage = { phones: 'Cleaning up phone numbers…', sales: 'Linking past sales to customers…', stats: 'Working out every customer’s stage…' }[r.stage] || 'Working…';

    el.innerHTML = `
      <p class="text-sm text-secondary" style="margin-bottom:var(--space-3)">Links past sales and M-PESA payments to customers by phone number, merges nothing, and recalculates every customer. Safe to run again at any time. Needed once; new sales are captured automatically.</p>
      ${running ? `<div class="crm-progress"><i></i></div><div class="text-sm">${esc(stage)}</div>` : ''}
      ${r.state !== 'idle' ? `
        <div class="crm-stat-row" style="margin:var(--space-3) 0">
          <div><b>${num(r.salesScanned)}</b>sales checked</div>
          <div><b>${num(r.purchasesLinked)}</b>linked to customers</div>
          <div><b>${num(r.phonesFixed)}</b>phones tidied</div>
          ${r.duplicates ? `<div><b>${num(r.duplicates)}</b>duplicate numbers</div>` : ''}
        </div>` : ''}
      ${r.state === 'done' ? '<div class="text-sm" style="color:var(--color-success);margin-bottom:var(--space-3)">Finished. Your customer book is up to date.</div>' : ''}
      ${r.state === 'failed' ? `<div class="form-alert form-alert-error" style="margin-bottom:var(--space-3)">Rebuild stopped: ${esc(r.error || 'unknown error')}. You can run it again.</div>` : ''}
      ${lastAt && r.state === 'idle' ? `<div class="crm-sub" style="margin-bottom:var(--space-3)">Last built ${window.UI.timeAgo(lastAt)}.</div>` : ''}
      <button class="btn btn-secondary" id="s-rebuild-btn" type="button" ${running ? 'disabled' : ''}>${running ? 'Building…' : r.state === 'idle' ? 'Build from sales history' : 'Run again'}</button>`;

    $('s-rebuild-btn').addEventListener('click', async () => {
      try {
        const { data } = await Api.post('/crm/rebuild', {});
        state.overview = null;
        drawRebuild(data.rebuild, lastAt);
        pollRebuild(lastAt);
      } catch (err) { window.UI.toast.error(err.message); }
    });
    if (running) pollRebuild(lastAt);
  }

  function pollRebuild(lastAt) {
    clearInterval(rebuildTimer);
    rebuildTimer = setInterval(async () => {
      if (state.tab !== 'settings' || !$('s-rebuild')) { clearInterval(rebuildTimer); return; }
      try {
        const { data } = await Api.get('/crm/rebuild');
        drawRebuild(data.rebuild, lastAt);
        if (data.rebuild.state !== 'running') { clearInterval(rebuildTimer); state.overview = null; }
      } catch { /* transient - keep polling */ }
    }, 2000);
  }
})();