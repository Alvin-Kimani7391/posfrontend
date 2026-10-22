/**
 * hx-reports.js - reports for restaurant and rooms, built on the SAME tools and look as the main Reports page (reports.js):
 *   ReportTools filter bar (date presets + custom range + branch), KPI tiles, Charts (bar / hbar / donut),
 *   searchable + sortable tables, insights, CSV export and print.
 * Restaurant: /restaurant/reports/summary|profit-loss|sales|food-cost|staff|waste|stock-variance|reconciliation|delivery
 * Rooms:      /accommodation/reports/occupancy|revenue|guest-register
 * The API's columns are not fixed, so tiles/tables/charts are built from whatever each report returns; Profit & loss has its own layout.
 *
 * Number rules (this is what fixed "2500%" and "KSh 25.00" for order counts):
 *   - percentages: HX.pct() - a value above 100 is read as hundredths of a percent (2500 -> 25%), 1 decimal, no trailing zeros
 *   - counts (orders, guests, rooms, nights ...): whole numbers, never currency
 *   - money: window.UI.formatMoney
 */
(function () {
  const RT = window.ReportTools, CH = window.Charts;
  const { E, M, can, get, feature, head } = window.HX;
  const esc = E;
  const R = [
    ['sum', 'Sales summary', '/restaurant/reports/summary', 'restaurant.reports.view', 'restaurantOrdering', false, 'Restaurant'],
    ['pnl', 'Profit & loss', '/restaurant/reports/profit-loss', 'restaurant.reports.view', 'restaurantOrdering', false, 'Restaurant'],
    ['sales', 'Sales breakdown', '/restaurant/reports/sales', 'restaurant.reports.view', 'restaurantOrdering', true, 'Restaurant'],
    ['food', 'Food cost', '/restaurant/reports/food-cost', 'restaurant.reports.view', 'restaurantOrdering', false, 'Restaurant'],
    ['staff', 'Staff performance', '/restaurant/reports/staff', 'restaurant.reports.staff', 'restaurantOrdering', false, 'Restaurant'],
    ['waste', 'Waste', '/restaurant/reports/waste', 'restaurant.reports.view', 'restaurantOrdering', false, 'Restaurant'],
    ['var', 'Stock variance', '/restaurant/reports/stock-variance', 'restaurant.reports.view', 'restaurantOrdering', false, 'Restaurant'],
    ['rec', 'Payment reconciliation', '/restaurant/reports/reconciliation', 'restaurant.reports.view', 'restaurantOrdering', false, 'Restaurant'],
    ['del', 'Delivery', '/restaurant/reports/delivery', 'restaurant.reports.view', 'restaurantOrdering', false, 'Restaurant'],
    ['occ', 'Occupancy', '/accommodation/reports/occupancy', 'accommodation.reports.view', 'accommodation', false, 'Rooms'],
    ['rev', 'Room revenue', '/accommodation/reports/revenue', 'accommodation.reports.view', 'accommodation', false, 'Rooms'],
    ['reg', 'Guest register', '/accommodation/reports/guest-register', 'accommodation.reports.view', 'accommodation', false, 'Rooms'],
  ];
  const GROUPS = ['day', 'hour', 'dow', 'item', 'category', 'waiter', 'orderType', 'table'];

  /* ---------- how to show a column ---------- */
  const PCT = /percent|pct|rate$|ratio|margin|share|occupancy$|utili[sz]ation/i;
  const AVG = /avg|average|per[A-Z_]|adr|revpar|rate$|ratio|margin|percent|pct|share|occupancy$/i;
  const COUNT = /(^|[a-z])(orders?|covers?|guests?|rooms?|nights?|stays?|bookings?|reservations?|tickets?|items?|qty|quantity|units?|count|number|pax|people|tables?|checkins?|checkouts?|noshows?|hours?|minutes?|mins?|days?|deliveries|portions?|sold|served|voids?|bills?)$|^(orders|covers|guests|nights|qty|quantity|count|rooms|items|stays|bookings|bills)/i;
  const MONEY = /revenue|total|cost|price|amount|profit|contribution|adr|revpar|value|tips?$|owing|paid|sales|spend|balance|discount|tax|charge|fee|waste|variance|expense|salar|refund/i;
  const TEMPORAL = /^(date|day|hour|dow|weekday|week|month|period|time)$/i;
  const SKIP_SCALAR = /^(from|to|branchId|branch|currency|generatedAt|period|groupBy|_?id)$/i;
  const nice = (k) => String(k).replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
  const kindOf = (k) => (PCT.test(k) ? 'pct' : COUNT.test(k) && !/(total|revenue|amount|cost|price|value)$/i.test(k) ? 'count' : MONEY.test(k) ? 'money' : 'num');
  const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  function fmt(k, v) {
    if (v == null || v === '') return '-';
    if (typeof v === 'boolean') return v ? 'Yes' : 'No';
    if (typeof v !== 'number') return esc(RT.prettify(v));
    const kd = kindOf(k);
    if (kd === 'pct') return window.HX.pct(v);
    if (kd === 'count') return window.HX.count(v);
    if (kd === 'money') return M(v);
    return (Math.round(v * 100) / 100).toLocaleString('en-KE');
  }
  const plain = (k, v) => (typeof v === 'number' ? (kindOf(k) === 'pct' ? window.HX.pctNum(v) : Math.round(v * 100) / 100) : v == null ? '' : v);

  /* ---------- state ---------- */
  const S = { key: '', groupBy: 'day', token: 0, cache: {}, exp: null, bar: null };
  let el, body, tabs = [], uid = 0;
  document.addEventListener('DOMContentLoaded', init);
  const avail = () => R.filter((r) => feature(r[4]) && can(r[3]) && (r[0] !== 'pnl' || can('reports.profit')));

  async function init() {
    el = window.HX.mount('Reports'); if (!el) return;
    await window.AppShell.whenProfileReady?.();
    tabs = avail();
    if (!tabs.length) { el.innerHTML = head('Reports') + `<div class="card">${window.UI.emptyStateHtml({ icon: 'alert', title: 'No reports for you', message: 'Ask the owner for report access.' })}</div>`; return; }
    S.key = tabs[0][0];
    const grp = (g) => { const t = tabs.filter((x) => x[6] === g); return t.length ? `<span class="rp-grp">${g}</span>${t.map((r) => `<button class="tab-btn ${r[0] === S.key ? 'active' : ''}" role="tab" data-tab="${r[0]}">${esc(r[1])}</button>`).join('')}` : ''; };
    el.innerHTML = `
      <div class="page-header"><div><h1>Reports</h1><p>See what is selling, what it earns and how your rooms are doing.</p></div>
        <div class="page-actions"><button class="btn btn-secondary" id="export-btn" disabled>Export CSV</button><button class="btn btn-secondary" id="print-btn">Print</button></div></div>
      <div id="filters"></div>
      <div class="tabs rp-tabs" style="margin-bottom:var(--space-4)" role="tablist">${grp('Restaurant')}${grp('Rooms')}</div>
      <div id="rp-sub"></div><p class="report-meta" id="report-meta"></p><div id="report-body"></div>`;
    body = el.querySelector('#report-body');
    S.bar = RT.createFilterBar(el.querySelector('#filters'), { defaultPreset: '7d', presets: ['today', '7d', '30d', 'month', 'lastmonth', 'year', 'custom'], showBranch: true, showCashier: false, onChange: () => { S.cache = {}; load(); } });
    el.querySelectorAll('.tab-btn').forEach((b) => b.addEventListener('click', () => { el.querySelectorAll('.tab-btn').forEach((x) => x.classList.toggle('active', x === b)); S.key = b.dataset.tab; load(); }));
    el.querySelector('#export-btn').addEventListener('click', exportNow);
    el.querySelector('#print-btn').addEventListener('click', () => window.print());
    await S.bar.ready;
    load();
  }

  function query() {
    const st = S.bar.getState();
    return { branchId: st.branchId || st.fixedBranchId || window.HX.branchId(), from: RT.toDateInput(st.from), to: RT.toDateInput(st.to) };
  }
  const rangeDays = () => { const st = S.bar.getState(); return Math.max(1, Math.round((st.to - st.from) / 86400000) + 1); };
  const empty = (t, m) => `<div class="card">${window.UI.emptyStateHtml({ icon: 'reports', title: t, message: m })}</div>`;
  const skeleton = () => { const tile = '<div class="kpi"><div class="skeleton" style="height:12px;width:50%"></div><div class="skeleton" style="height:28px;width:70%;margin-top:14px"></div></div>'; return `<div class="kpi-grid">${tile.repeat(4)}</div><div class="card chart-card"><div class="skeleton" style="height:300px;margin:20px"></div></div>`; };

  async function load() {
    const cur = R.find((r) => r[0] === S.key), token = ++S.token, q = query(), btn = el.querySelector('#export-btn');
    const extra = cur[5] ? { groupBy: S.groupBy } : {};
    // group-by switch for the sales breakdown
    const sub = el.querySelector('#rp-sub'); sub.innerHTML = '';
    if (cur[5]) { sub.innerHTML = '<div class="rp-groupby"><span class="text-xs text-muted">Group by</span><div id="gb-seg"></div></div>'; RT.segmented(sub.querySelector('#gb-seg'), GROUPS.map((g) => ({ key: g, label: nice(g) })), S.groupBy, (g) => { S.groupBy = g; load(); }); }
    el.querySelector('#report-meta').innerHTML = `<span><strong>${esc(cur[1])}</strong> · ${esc(S.bar.describe({ dates: true, branch: true, cashier: false }))}</span>`;
    btn.disabled = true; S.exp = null;
    const ck = `${cur[0]}|${JSON.stringify(q)}|${S.groupBy}`;
    let d = S.cache[ck];
    if (!d) { body.innerHTML = skeleton(); d = await get(cur[2], { ...q, ...extra }); if (d) S.cache[ck] = d; }
    if (token !== S.token) return;
    if (!d) { body.innerHTML = `<div class="card">${window.UI.emptyStateHtml({ icon: 'alert', title: 'Could not load this report', message: 'Try another range or report.', actionHtml: '<button class="btn btn-secondary" id="retry-btn">Try again</button>' })}</div>`; body.querySelector('#retry-btn')?.addEventListener('click', load); return; }
    const root = d.report || d.data || d;
    body.innerHTML = '';
    S.exp = (cur[0] === 'pnl' ? renderPnl(body, root) : renderGeneric(body, root, cur)) || null;
    btn.disabled = !S.exp;
  }
  function exportNow() { const ex = typeof S.exp === 'function' ? S.exp() : S.exp; if (!ex) return; RT.downloadCSV(`${ex.name}-${RT.stamp()}.csv`, ex.sections); window.UI.toast.success('Report exported'); }

  /* ---------- reusable pieces ---------- */
  /** Sortable, searchable table card. cols: [{k,label,kind,render?}] rows: objects. */
  function tableCard(title, rows, cols, { sub = 'Click a heading to sort', totals = true } = {}) {
    const id = 'rt' + (++uid);
    const sums = {}; cols.forEach((c) => { if ((c.kind === 'money' || c.kind === 'count') && !AVG.test(c.k)) sums[c.k] = rows.reduce((s, r) => s + (Number(r[c.k]) || 0), 0); });
    const cell = (c, r) => `<td class="${c.kind === 'text' ? '' : 'num'}">${c.render ? c.render(r) : (c.kind === 'text' ? esc(r[c.k] == null ? '-' : fmtLabel(c.k, r[c.k])) : fmt(c.k, r[c.k]))}</td>`;
    const html = `<div class="card" id="${id}"><div class="table-toolbar"><div><h3>${esc(title)}</h3><span class="text-xs text-muted">${rows.length} row${rows.length === 1 ? '' : 's'} · ${esc(sub)}</span></div>${rows.length > 6 ? `<input class="input" type="search" placeholder="Search…" aria-label="Search ${esc(title)}" style="max-width:220px" data-s>` : ''}</div>
      <div class="table-wrap flat"><table class="table"><thead><tr>${cols.map((c) => `<th class="${c.kind === 'text' ? '' : 'num'}" data-sort="${esc(c.k)}" style="cursor:pointer;user-select:none">${esc(c.label || nice(c.k))}<span class="rp-arrow"></span></th>`).join('')}</tr></thead>
      <tbody data-b>${rows.map((r) => `<tr>${cols.map((c) => cell(c, r)).join('')}</tr>`).join('')}</tbody>
      ${totals && rows.length > 1 && Object.keys(sums).length ? `<tfoot><tr class="rp-total">${cols.map((c, i) => `<td class="${c.kind === 'text' ? '' : 'num'}">${c.k in sums ? fmt(c.k, sums[c.k]) : i === 0 ? 'Total' : ''}</td>`).join('')}</tr></tfoot>` : ''}</table></div></div>`;
    const bind = () => {
      const root = document.getElementById(id); if (!root) return;
      const tb = root.querySelector('[data-b]'), s = root.querySelector('[data-s]'); if (s) RT.tableSearch(s, tb);
      const pairs = Array.from(tb.querySelectorAll('tr')).map((tr, i) => ({ tr, r: rows[i] }));
      let dir = -1, last = '';
      root.querySelectorAll('[data-sort]').forEach((th) => th.addEventListener('click', () => {
        const k = th.dataset.sort; dir = last === k ? -dir : -1; last = k; // first click: biggest first
        pairs.sort((x, y) => { const a = x.r[k], b = y.r[k]; const c = typeof a === 'number' && typeof b === 'number' ? a - b : String(a ?? '').localeCompare(String(b ?? ''), undefined, { numeric: true }); return c * -dir; });
        pairs.forEach((p) => tb.appendChild(p.tr));
        root.querySelectorAll('.rp-arrow').forEach((x) => { x.textContent = ''; }); th.querySelector('.rp-arrow').textContent = dir === -1 ? ' ▼' : ' ▲';
      }));
    };
    return { html, bind };
  }
  function fmtLabel(k, v) {
    if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) return RT.trendLabel(v.slice(0, 10), rangeDays());
    if (/^hour$/i.test(k) && typeof v === 'number') return String(v).padStart(2, '0') + ':00';
    if (/^dow$/i.test(k) && typeof v === 'number' && v >= 0 && v <= 6) return DOW[v];
    return RT.prettify(v);
  }
  const exportRows = (rows, cols) => ({ headers: cols.map((c) => c.label || nice(c.k)), rows: rows.map((r) => cols.map((c) => plain(c.k, r[c.k]))) });

  /* ---------- generic report: tiles + chart + table per list ---------- */
  function renderGeneric(el, root, cur) {
    const scalars = Array.isArray(root) ? [] : Object.entries(root).filter(([k, v]) => !SKIP_SCALAR.test(k) && v != null && ['number', 'string'].includes(typeof v) && String(v).length < 40);
    const lists = Array.isArray(root) ? [['Results', root]] : Object.entries(root).filter(([, v]) => Array.isArray(v) && v.length && typeof v[0] === 'object');
    if (!scalars.length && !lists.length) { el.innerHTML = empty('No data', 'Nothing was recorded in this range.'); return null; }
    const ICON = { money: 'sales', count: 'reports', pct: 'reports', num: 'reports' }, TONE = { money: 'primary', count: 'neutral', pct: 'info', num: 'neutral' };
    let html = '';
    if (scalars.length) html += `<div class="kpi-grid">${scalars.map(([k, v]) => { const kd = typeof v === 'number' ? kindOf(k) : 'num'; return RT.kpi({ label: nice(k), value: (kd === 'money' ? RT.money0(v) : fmt(k, v)), icon: ICON[kd], tone: TONE[kd] }); }).join('')}</div>`;
    const blocks = lists.map(([k, rows]) => {
      const cols = Object.keys(rows[0]).filter((c) => !/^_?id$|Id$/.test(c) && typeof rows[0][c] !== 'object').map((c) => ({ k: c, kind: typeof rows[0][c] === 'number' ? kindOf(c) : 'text' }));
      return { k, rows, cols, t: tableCard(nice(k), rows, cols), chartId: 'rc' + (++uid) };
    });
    blocks.forEach((b) => { html += `<div class="insights" id="${b.chartId}-in"></div>` + (chartable(b) ? RT.chartCard({ id: b.chartId, title: nice(b.k), subtitle: 'Chart of the table below', actions: `<div id="${b.chartId}-seg"></div>` }) : '') + b.t.html; });
    el.innerHTML = html;
    blocks.forEach((b) => { b.t.bind(); if (chartable(b)) drawFor(b); });
    window.Permissions.applyPermissionGates?.(el, window.AppShell.getUser());
    return { name: 'hx-' + cur[0] + '-report', sections: [
      ...(scalars.length ? [{ title: 'Summary', headers: ['Metric', 'Value'], rows: scalars.map(([k, v]) => [nice(k), plain(k, v)]) }] : []),
      ...blocks.map((b) => ({ title: nice(b.k), ...exportRows(b.rows, b.cols) })),
    ] };
  }
  const labelCol = (b) => b.cols.find((c) => c.kind === 'text');
  const metricCols = (b) => b.cols.filter((c) => c.kind !== 'text' && c.kind !== 'pct').slice(0, 5);
  const chartable = (b) => b.rows.length >= 2 && labelCol(b) && metricCols(b).length;
  function drawFor(b) {
    const lc = labelCol(b), mets = metricCols(b), host = document.getElementById(b.chartId);
    const pref = mets.find((m) => /revenue|sales|total|amount|profit|value|cost/i.test(m.k)) || mets[0];
    const temporal = TEMPORAL.test(lc.k) || b.rows.every((r) => /^\d{4}-\d{2}-\d{2}/.test(String(r[lc.k])));
    const draw = (mk) => {
      const m = mets.find((x) => x.k === mk) || pref, fm = m.kind === 'money' ? RT.money0 : (n) => RT.fmtNum(n), tip = m.kind === 'money' ? (n) => M(n) : (n) => window.HX.count(n);
      const labels = b.rows.map((r) => fmtLabel(lc.k, r[lc.k]));
      if (temporal) { CH.bar(host, { labels, series: [{ name: m.label || nice(m.k), values: b.rows.map((r) => Number(r[m.k]) || 0), color: 'var(--color-primary)' }], format: m.kind === 'money' ? CH.compact : fm, tipFormat: tip, height: 340, ariaLabel: nice(m.k) + ' by ' + nice(lc.k), emptyText: 'Nothing to chart in this period.' }); return; }
      const data = b.rows.map((r, i) => ({ label: labels[i], value: Number(r[m.k]) || 0 })).sort((x, y) => y.value - x.value);
      if (m.kind === 'money' && data.length <= 6 && /method|type|category|channel|source/i.test(lc.k)) CH.donut(host, { data, format: RT.money0, tipFormat: tip, centerLabel: m.label || nice(m.k), ariaLabel: nice(m.k) + ' share' });
      else CH.hbar(host, { data: data.slice(0, 10).map((x) => ({ ...x, sub: '' })), format: fm, valueLabel: m.label || nice(m.k), ranked: true });
    };
    const seg = document.getElementById(b.chartId + '-seg');
    if (mets.length > 1) RT.segmented(seg, mets.map((m) => ({ key: m.k, label: m.label || nice(m.k) })), pref.k, draw); else seg.remove();
    draw(pref.k);
    // one plain-language insight about the biggest row
    const tot = b.rows.reduce((s, r) => s + (Number(r[pref.k]) || 0), 0), top = [...b.rows].sort((x, y) => (Number(y[pref.k]) || 0) - (Number(x[pref.k]) || 0))[0];
    const ins = document.getElementById(b.chartId + '-in');
    if (ins && tot > 0 && top && !temporal && b.rows.length > 2) ins.innerHTML = `<div class="insight insight-info"><strong>${esc(fmtLabel(lc.k, top[lc.k]))}</strong> leads on ${esc(nice(pref.k).toLowerCase())}: ${fmt(pref.k, top[pref.k])}, ${RT.fmtPct(RT.pct(top[pref.k], tot))} of the total.</div>`;
    else if (ins) ins.remove();
  }

  /* ---------- Profit & loss ---------- */
  function renderPnl(el, r) {
    if (!r || r.restricted) { el.innerHTML = empty('Profit figures are for the owner', 'Ask for the “profit” report permission.'); return null; }
    const P = (v) => (v == null ? '-' : window.HX.pct(v)), neg = (v) => (v < 0 ? ' text-neg' : '');
    const s = r.sales || {}, c = r.costOfSales || { lines: {} }, x = r.expenses || {};
    if (!s.netSales && !s.grossSales && !x.salaries && !x.other) { el.innerHTML = empty('Nothing to calculate yet', 'There are no sales or approved expenses in this period.'); return null; }
    const LBL = { ingredientsUsedInSoldDishes: 'Ingredients used in sold dishes', dishesWithoutRecipe: 'Dishes without a recipe (at entered cost)', wastage: 'Wastage and expired stock', staffMeals: 'Staff meals', complimentary: 'Complimentary dishes', stockCountLosses: 'Stock count shortages', ingredientPurchases: 'Ingredient purchases', foodPurchaseExpenses: 'Food purchase expenses' };
    const row = (label, v, o = {}) => `<tr${o.b ? ' class="rp-b"' : ''}><td style="padding-left:${o.i ? 28 : 12}px">${esc(label)}</td><td class="num${neg(v)}">${o.minus ? '− ' : ''}${M(v)}</td><td class="num text-muted">${o.pct != null ? P(o.pct) : ''}</td></tr>`;
    const tone = r.netProfit < 0 ? 'danger' : 'success';
    const insights = [];
    (r.warnings || []).forEach((w) => insights.push(`<div class="insight insight-warning">${esc(w.message)}</div>`));
    if (c.percentOfSales != null && c.targetPercent != null) insights.push(`<div class="insight insight-${window.HX.pctNum(c.percentOfSales) > window.HX.pctNum(c.targetPercent) ? 'warning' : 'success'}">Food cost is <strong>${P(c.percentOfSales)}</strong> of sales against a target of ${P(c.targetPercent)}.</div>`);
    const lines = Object.entries(c.lines || {}).filter(([, v]) => v);
    const dishes = r.dishes || [], trend = r.trend || [];
    let html = `<div class="kpi-grid" id="pnl-kpi">
        ${RT.kpi({ label: 'Net sales', value: RT.money0(s.netSales), sub: `${window.HX.count(s.bills || 0)} bills`, icon: 'sales', tone: 'primary' })}
        ${RT.kpi({ label: 'Cost of sales', value: RT.money0(c.total), sub: `${P(c.percentOfSales)} of sales`, icon: 'reports', tone: 'warning' })}
        ${RT.kpi({ label: 'Gross profit', value: RT.money0(r.grossProfit), sub: `${P(r.grossMarginPercent)} margin`, icon: 'reports', tone: r.grossProfit < 0 ? 'danger' : 'info' })}
        ${RT.kpi({ label: 'Salaries & expenses', value: RT.money0((x.salaries || 0) + (x.other || 0)), sub: `Salaries ${M(x.salaries || 0)}`, icon: 'reports', tone: 'neutral' })}
        ${RT.kpi({ label: 'Net profit', value: RT.money0(r.netProfit), sub: `${P(r.netMarginPercent)} margin`, icon: 'sales', tone })}
      </div>
      <div class="insights">${insights.join('')}</div>
      <div class="chart-grid g-2-1">
        <div class="card"><div class="table-toolbar"><h3>Statement</h3><span class="text-xs text-muted">Read top to bottom</span></div><div class="table-wrap flat"><table class="table"><thead><tr><th></th><th class="num">Amount</th><th class="num">% of sales</th></tr></thead><tbody>
          ${row('Gross sales (incl. tax)', s.grossSales)}${row('Tax', s.tax, { i: 1, minus: 1 })}${row('Refunds', s.refunds, { i: 1, minus: 1 })}${row('Net sales', s.netSales, { b: 1 })}
          ${Object.entries(c.lines || {}).map(([k, v]) => row(LBL[k] || nice(k), v, { i: 1, minus: 1 })).join('')}${row('Cost of sales', c.total, { b: 1, pct: c.percentOfSales })}${row('Gross profit', r.grossProfit, { b: 1, pct: r.grossMarginPercent })}
          ${row('Salaries & wages', x.salaries, { i: 1, minus: 1, pct: x.salaryPercentOfSales })}${(x.otherByCategory || []).map((e) => row(RT.prettify(e.category), e.amount, { i: 1, minus: 1 })).join('')}${row('NET PROFIT', r.netProfit, { b: 1, pct: r.netMarginPercent })}
        </tbody></table></div>
        <p class="text-xs text-muted" style="padding:var(--space-3) var(--space-4)">Food cost basis: ${r.costBasis === 'RECIPE' ? 'recipes (what was actually used)' : 'purchases (what was bought)'}. Only approved expenses count${x.pendingCount ? `; ${window.HX.count(x.pendingCount)} worth ${M(x.pendingApproval)} await approval` : ''}.</p></div>
        ${RT.chartCard({ id: 'ch-cost', title: 'Where the money went', subtitle: 'Cost of sales by line' })}
      </div>`;
    if (trend.length) html += `<div class="chart-grid">${RT.chartCard({ id: 'ch-trend', title: 'Day by day', subtitle: 'Net sales, food cost, expenses and profit' })}</div>`;
    let dishT = null;
    if (dishes.length) {
      const cols = [{ k: 'name', label: 'Dish', kind: 'text' }, { k: 'sold', label: 'Sold', kind: 'count' }, { k: 'revenue', label: 'Sales (ex tax)', kind: 'money' }, { k: 'cost', label: 'Cost', kind: 'money' },
        { k: 'profit', label: 'Profit', kind: 'money', render: (d) => `<span class="${d.profit < 0 ? 'text-neg' : ''}">${M(d.profit)}</span>` }, { k: 'foodCostPercent', label: 'Food cost %', kind: 'pct' },
        { k: 'overTarget', label: 'Flags', kind: 'text', render: (d) => (d.overTarget ? '<span class="badge badge-warning">Over target</span>' : '') + (d.costedBy !== 'RECIPE' ? ' <span class="text-xs text-muted">no recipe</span>' : '') }];
      dishT = tableCard('Dish profitability', dishes, cols);
      html += `<div class="chart-grid">${RT.chartCard({ id: 'ch-dish', title: 'Most profitable dishes', subtitle: 'Profit per dish in this period' })}</div>` + dishT.html;
    }
    if (r.recipeCheck) html += `<div class="card"><h3>Recipe check</h3><p>Recipe cost of dishes sold: <b>${M(r.recipeCheck.theoreticalCostOfSoldDishes)}</b> · Actually used from stock: <b>${M(r.recipeCheck.actualIngredientUsage)}</b> · Difference: <b class="${neg(-r.recipeCheck.difference)}">${M(r.recipeCheck.difference)}</b></p><p class="text-xs text-muted">${esc(r.recipeCheck.note || '')}</p></div>`;
    if (r.stock) html += `<div class="card"><h3>Ingredient stock</h3><p>Value on hand: <b>${M(r.stock.valueOnHand)}</b> · Bought in this period: <b>${M(r.stock.purchasesInPeriod)}</b> (${window.HX.count(r.stock.purchaseCount)} deliveries)</p></div>`;
    el.innerHTML = html;
    CH.donut(document.getElementById('ch-cost'), { data: lines.map(([k, v]) => ({ label: LBL[k] || nice(k), value: Math.abs(v) })), format: RT.money0, tipFormat: (n) => M(n), centerLabel: 'Cost of sales', ariaLabel: 'Cost of sales by line', emptyText: 'No cost lines in this period.' });
    if (trend.length) { const rd = rangeDays(); CH.bar(document.getElementById('ch-trend'), { labels: trend.map((t) => RT.trendLabel(t.date, rd)), series: [{ name: 'Net sales', values: trend.map((t) => t.netSales), color: 'var(--color-primary)' }, { name: 'Food cost', values: trend.map((t) => t.foodCost), color: '#f59e0b' }, { name: 'Expenses', values: trend.map((t) => t.expenses), color: '#8b5cf6' }, { name: 'Profit', values: trend.map((t) => t.profit), color: '#10b981' }], format: CH.compact, tipFormat: (n) => M(n), height: 380, ariaLabel: 'Day by day profit and loss' }); }
    if (dishT) { dishT.bind(); CH.hbar(document.getElementById('ch-dish'), { data: [...dishes].sort((a, b) => b.profit - a.profit).slice(0, 10).map((d) => ({ label: d.name, value: Math.max(0, d.profit), sub: `${window.HX.count(d.sold)} sold · food cost ${P(d.foodCostPercent)}` })), format: RT.money0, valueLabel: 'Profit', ranked: true }); }
    return { name: 'hx-profit-loss', sections: [
      { title: 'Statement', headers: ['Line', 'Amount', '% of sales'], rows: [['Gross sales', s.grossSales], ['Tax', s.tax], ['Refunds', s.refunds], ['Net sales', s.netSales], ...Object.entries(c.lines || {}).map(([k, v]) => [LBL[k] || nice(k), v]), ['Cost of sales', c.total, plain('percentOfSales', c.percentOfSales)], ['Gross profit', r.grossProfit, plain('marginPercent', r.grossMarginPercent)], ['Salaries & wages', x.salaries], ...(x.otherByCategory || []).map((e) => [e.category, e.amount]), ['Net profit', r.netProfit, plain('marginPercent', r.netMarginPercent)]] },
      ...(dishes.length ? [{ title: 'Dish profitability', headers: ['Dish', 'Sold', 'Sales (ex tax)', 'Cost', 'Profit', 'Food cost %'], rows: dishes.map((d) => [d.name, d.sold, d.revenue, d.cost, d.profit, plain('foodCostPercent', d.foodCostPercent)]) }] : []),
      ...(trend.length ? [{ title: 'Day by day', headers: ['Date', 'Bills', 'Net sales', 'Food cost', 'Expenses', 'Profit'], rows: trend.map((d) => [d.date, d.bills, d.netSales, d.foodCost, d.expenses, d.profit]) }] : []),
    ] };
  }
})();
