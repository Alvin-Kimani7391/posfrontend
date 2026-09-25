/**
 * reports.js
 * One page, eight reports (Sales, Profit & loss, Payments, Cashiers, Expenses,
 * Inventory, Customers owing, Suppliers owed). Same list -> fetch -> render
 * pattern as the other pages, with a shared filter bar on top.
 *
 * SALES/PAYMENTS/EXPENSES tabs: the primary KPI tiles are expandable via
 * RT.bindAdminDrilldown, backed by the real /reports/*\/detail endpoints -
 * so "Tax collected -> expand" shows a Tax column per sale, "Discounts"
 * shows a Discount column, "Refunds" shows a Refunded column, payments
 * show method/reference, expenses show category/description. Every row
 * shows its branch. Sales/payments rows tap through to the full sale.
 *
 * SALES tab also has a daily trend chart: weekday names (Mon..Sun) for
 * ranges of 7 days or fewer, calendar dates beyond that.
 *
 * Money arrives from the API already converted from cents to shillings, so
 * nothing here divides by 100.
 */
(function () {
  const RT = window.ReportTools;
  const CH = window.Charts;
  const esc = window.UI.escapeHtml;
  const fm = (n) => window.UI.formatMoney(n);

  const TABS = [
    { key: 'sales', label: 'Sales', endpoint: 'sales', permission: 'reports.view', scope: { dates: true, branch: true, cashier: true }, render: renderSales },
    { key: 'profit', label: 'Profit & loss', endpoint: 'profit', permission: 'reports.profit', scope: { dates: true, branch: true, cashier: false }, render: renderProfit },
    { key: 'payments', label: 'Payments', endpoint: 'payments', permission: 'reports.view', scope: { dates: true, branch: true, cashier: false }, render: renderPayments },
    { key: 'cashiers', label: 'Cashiers', endpoint: 'cashiers', permission: 'reports.view', scope: { dates: true, branch: true, cashier: false }, render: renderCashiers },
    { key: 'expenses', label: 'Expenses', endpoint: 'expenses', permission: 'reports.view', scope: { dates: true, branch: true, cashier: false }, render: renderExpenses },
    { key: 'inventory', label: 'Inventory', endpoint: 'inventory', permission: 'reports.view', scope: { dates: false, branch: true, cashier: false }, render: renderInventory },
    { key: 'customers', label: 'Customers owing', endpoint: 'customers', permission: 'reports.view', scope: { dates: false, branch: false, cashier: false }, render: renderCustomers },
    { key: 'suppliers', label: 'Suppliers owed', endpoint: 'suppliers', permission: 'reports.view', scope: { dates: false, branch: false, cashier: false }, render: renderSuppliers },
  ];

  const state = { tab: 'sales', cache: {}, token: 0, exportData: null };
  let contentEl;
  let filterBar;
  let user;
  let tabs = [];

  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    contentEl = window.AppShell.mount({ title: 'Reports' });
    if (!contentEl) return;
    user = window.AppShell.getUser();

    if (!window.Permissions.can(user, 'reports.view')) {
      contentEl.innerHTML = `<div class="card">${window.UI.emptyStateHtml({ icon: 'alert', title: 'Reports are not available for your role', message: 'Ask the business owner to give you the "view reports" permission.' })}</div>`;
      return;
    }

    tabs = TABS.filter((t) => window.Permissions.can(user, t.permission));
    contentEl.innerHTML = pageSkeleton();

    filterBar = RT.createFilterBar(document.getElementById('filters'), {
      defaultPreset: '30d',
      showBranch: true,
      showCashier: true,
      onChange: () => { state.cache = {}; loadTab(); },
    });

    bindTabs();
    document.getElementById('export-btn').addEventListener('click', exportCurrent);
    document.getElementById('print-btn').addEventListener('click', () => window.print());

    await filterBar.ready;
    loadTab();
  }

  function pageSkeleton() {
    return `
      <div class="page-header">
        <div>
          <h1>Reports</h1>
          <p>See what is selling, what it earns and where the money is sitting.</p>
        </div>
        <div class="page-actions">
          <button class="btn btn-secondary" id="export-btn" disabled>Export CSV</button>
          <button class="btn btn-secondary" id="print-btn">Print</button>
        </div>
      </div>
      <div id="filters"></div>
      <div class="tabs" style="margin-bottom: var(--space-4)" role="tablist">
        ${tabs.map((t, i) => `<button class="tab-btn ${i === 0 ? 'active' : ''}" role="tab" data-tab="${t.key}">${esc(t.label)}</button>`).join('')}
      </div>
      <p class="report-meta" id="report-meta"></p>
      <div id="report-body"></div>
    `;
  }

  function bindTabs() {
    contentEl.querySelectorAll('.tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        contentEl.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b === btn));
        state.tab = btn.dataset.tab;
        loadTab();
      });
    });
    state.tab = tabs[0].key;
  }

  /* ------------------------------------------------------------------ *
   * Loading
   * ------------------------------------------------------------------ */
  async function loadTab() {
    const tab = tabs.find((t) => t.key === state.tab) || tabs[0];
    const body = document.getElementById('report-body');
    const exportBtn = document.getElementById('export-btn');

    filterBar.setScope(tab.scope);
    const query = filterBar.getQuery(tab.scope);
    const cacheKey = `${tab.key}|${JSON.stringify(query)}`;
    const token = ++state.token;

    document.getElementById('report-meta').innerHTML = `<span><strong>${esc(tab.label)}</strong>${filterBar.describe(tab.scope) ? ` · ${esc(filterBar.describe(tab.scope))}` : ' · current position'}</span>`;
    exportBtn.disabled = true;
    state.exportData = null;

    try {
      let data = state.cache[cacheKey];
      if (!data) {
        body.innerHTML = loadingHtml();
        const res = await window.Api.get(`/reports/${tab.endpoint}`, query);
        data = res && res.data !== undefined ? res.data : res;
        state.cache[cacheKey] = data;
      }
      if (token !== state.token) return;
      body.innerHTML = '';
      state.exportData = tab.render(body, data, { query }) || null;
      window.Permissions.applyPermissionGates(body, user);
      exportBtn.disabled = !state.exportData;
    } catch (err) {
      if (token !== state.token) return;
      body.innerHTML = `<div class="card">${window.UI.emptyStateHtml({
        icon: 'alert',
        title: 'Could not load this report',
        message: err.message,
        actionHtml: '<button class="btn btn-secondary" id="retry-btn">Try again</button>',
      })}</div>`;
      document.getElementById('retry-btn').addEventListener('click', loadTab);
    }
  }

  function loadingHtml() {
    const tile = '<div class="kpi"><div class="skeleton" style="height:12px;width:50%"></div><div class="skeleton" style="height:28px;width:70%;margin-top:14px"></div></div>';
    const panel = '<div class="card chart-card"><div class="skeleton" style="height:380px;margin:20px"></div></div>';
    return `<div class="kpi-grid">${tile.repeat(4)}</div><div class="chart-grid g-2-1">${panel}${panel}</div>`;
  }

  function emptyReport(title, message) {
    return `<div class="card">${window.UI.emptyStateHtml({ icon: 'reports', title, message })}</div>`;
  }

  function exportCurrent() {
    const ex = typeof state.exportData === 'function' ? state.exportData() : state.exportData;
    if (!ex) return;
    RT.downloadCSV(`${ex.name}-${RT.stamp()}.csv`, ex.sections);
    window.UI.toast.success('Report exported');
  }

  /* ================================================================== *
   * SALES - real per-sale drill-downs + daily trend
   * ================================================================== */
  function renderSales(el, d, { query }) {
    if (!d.transactionCount) {
      el.innerHTML = emptyReport('No completed sales in this period', 'Try a wider date range, another branch or another cashier.');
      return null;
    }
    const avg = d.netSales / d.transactionCount;
    const discRate = RT.pct(d.totalDiscount, d.totalSales);
    const refundRate = RT.pct(d.totalRefunds, d.netSales);
    const products = d.topProducts || [];
    const topRevenue = products.reduce((s, p) => s + p.revenue, 0);
    const payTotal = (d.paymentBreakdown || []).reduce((s, p) => s + p.total, 0);
    const topPay = [...(d.paymentBreakdown || [])].sort((a, b) => b.total - a.total)[0];
    const trend = d.dailyTrend || [];

    const insights = [];
    if (products[0]) insights.push({ tone: 'info', text: `<strong>${esc(products[0].name)}</strong> is the best seller: ${fm(products[0].revenue)}, ${RT.fmtPct(RT.pct(products[0].revenue, topRevenue))} of the top-10 revenue.` });
    if (topPay) insights.push({ tone: 'success', text: `<strong>${esc(RT.methodMeta(topPay.method).label)}</strong> brought in ${RT.fmtPct(RT.pct(topPay.total, payTotal))} of the money collected.` });
    if (d.totalRefunds > 0) insights.push({ tone: refundRate > 5 ? 'warning' : 'info', text: `Refunds are <strong>${RT.fmtPct(refundRate)}</strong> of net sales (${fm(d.totalRefunds)}).${refundRate > 5 ? ' That is high - check the returned items.' : ''}` });
    if (d.totalDiscount > 0) insights.push({ tone: discRate > 10 ? 'warning' : 'info', text: `Discounts given away: <strong>${fm(d.totalDiscount)}</strong> (${RT.fmtPct(discRate)} of gross sales).${discRate > 10 ? ' Worth reviewing who applies them.' : ''}` });

    el.innerHTML = `
      <div class="kpi-grid" id="sales-kpi-grid">
        ${RT.expandableKpi({ key: 'netSales', label: 'Net sales', value: fm(d.netSales), icon: 'sales', tone: 'primary', sub: 'Total charged to customers' })}
        ${RT.expandableKpi({ key: 'grossSales', label: 'Gross sales', value: fm(d.totalSales), icon: 'reports', tone: 'info', sub: 'Sum of sale subtotals' })}
        ${RT.expandableKpi({ key: 'transactions', label: 'Transactions', value: RT.fmtNum(d.transactionCount), icon: 'sales', tone: 'neutral', sub: 'Completed sales' })}
        ${RT.kpi({ label: 'Average sale', value: fm(avg), icon: 'reports', tone: 'success', sub: 'Net sales per transaction' })}
        ${RT.expandableKpi({ key: 'discounts', label: 'Discounts', value: fm(d.totalDiscount), tone: 'warning', sub: `${RT.fmtPct(discRate)} of gross - tap to see which sales` })}
        ${RT.expandableKpi({ key: 'tax', label: 'Tax collected', value: fm(d.totalTax), tone: 'neutral', sub: 'Tap to see tax per sale' })}
        ${RT.expandableKpi({ key: 'refunds', label: 'Refunds', value: fm(d.totalRefunds), tone: d.totalRefunds > 0 ? 'danger' : 'neutral', sub: `${RT.fmtPct(refundRate)} of net sales - tap to see which sales` })}
      </div>

      ${RT.drilldownPanelHtml('sales-drilldown')}

      <div class="insights">${insights.map((i) => `<div class="insight insight-${i.tone}">${i.text}</div>`).join('')}</div>

      <div class="chart-grid trend-chart-card">
        ${RT.chartCard({ id: 'ch-trend', title: 'Sales trend', subtitle: 'Net sales by day for the selected period' })}
      </div>

      <div class="chart-grid g-2-1">
        ${RT.chartCard({ id: 'ch-products', title: 'Top products', subtitle: 'Best sellers in this period', actions: '<div id="prod-toggle"></div>' })}
        ${RT.chartCard({ id: 'ch-pay', title: 'Payment mix', subtitle: 'How customers paid' })}
      </div>

      <div class="card">
        <div class="table-toolbar"><h3>Top 10 products</h3><span class="text-xs text-muted">Ranked by revenue</span></div>
        <div class="table-wrap flat">
          <table class="table">
            <thead><tr><th>#</th><th>Product</th><th class="num">Units sold</th><th class="num">Revenue</th><th>Share of top 10</th></tr></thead>
            <tbody>
              ${products.map((p, i) => `
                <tr>
                  <td>${RT.rankBadge(i)}</td>
                  <td class="cell-primary">${esc(p.name)}</td>
                  <td class="num">${RT.fmtNum(p.quantity)}</td>
                  <td class="num">${fm(p.revenue)}</td>
                  <td><span class="mini-bar"><span style="width:${RT.pct(p.revenue, topRevenue)}%"></span></span> <span class="text-xs text-muted">${RT.fmtPct(RT.pct(p.revenue, topRevenue), 0)}</span></td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>`;

    const rangeDays = query.from && query.to
      ? Math.max(1, Math.round((new Date(query.to) - new Date(query.from)) / 86400000) + 1)
      : (trend.length || 1);
    CH.bar(document.getElementById('ch-trend'), {
      labels: trend.map((t) => RT.trendLabel(t.date, rangeDays)),
      series: [{ name: 'Net sales', values: trend.map((t) => t.netSales), color: 'var(--color-primary)' }],
      format: CH.compact, tipFormat: fm, height: 420, ariaLabel: 'Sales trend by day',
      emptyText: 'No daily sales to chart in this period.',
    });

    const drawProducts = (mode) => CH.hbar(document.getElementById('ch-products'), {
      data: products.map((p) => ({ label: p.name, value: mode === 'units' ? p.quantity : p.revenue, sub: mode === 'units' ? fm(p.revenue) : `${RT.fmtNum(p.quantity)} units` })),
      format: mode === 'units' ? (n) => `${RT.fmtNum(n)} units` : RT.money0,
      valueLabel: mode === 'units' ? 'Units sold' : 'Revenue',
      ranked: true,
    });
    RT.segmented(document.getElementById('prod-toggle'), [{ key: 'revenue', label: 'Revenue' }, { key: 'units', label: 'Units' }], 'revenue', drawProducts);
    drawProducts('revenue');

    CH.donut(document.getElementById('ch-pay'), {
      data: (d.paymentBreakdown || []).map((p) => ({ label: RT.methodMeta(p.method).label, value: p.total, color: RT.methodMeta(p.method).color })),
      format: RT.money0, tipFormat: fm, centerLabel: 'Collected', ariaLabel: 'Payment methods',
    });

    const SALE_BASE_COLUMNS = [
      { label: 'Receipt', render: (s) => `<span class="cell-primary">${esc(s.receiptNumber)}</span>` },
      { label: 'Date & time', render: (s) => `<span class="text-sm">${window.UI.formatDateTime(s.createdAt)}</span>` },
      { label: 'Branch', render: (s) => `<span class="text-sm">${esc(s.branchName || '-')}</span>` },
      { label: 'Cashier', render: (s) => `<span class="text-sm">${esc(s.cashierName || '-')}</span>` },
      { label: 'Customer', render: (s) => (s.customerName ? `<span class="text-sm">${esc(s.customerName)}</span>` : '<span class="text-muted">Walk-in</span>') },
    ];
    const SALE_TOTAL_COL = { label: 'Total', num: true, render: (s) => `<span class="font-semibold">${fm(s.total)}</span>` };
    const SALE_STATUS_COL = { label: 'Status', render: (s) => RT.paymentStatusBadge(s.paymentStatus) + (s.saleStatus === 'CANCELLED' ? ' <span class="badge badge-neutral">Cancelled</span>' : '') };

    const SALES_CONFIG = {
      netSales: { title: 'Sales behind "Net sales"', columns: [...SALE_BASE_COLUMNS, SALE_TOTAL_COL, SALE_STATUS_COL] },
      grossSales: { title: 'Sales behind "Gross sales"', columns: [...SALE_BASE_COLUMNS, { label: 'Subtotal', num: true, render: (s) => fm(s.subtotal) }, SALE_STATUS_COL] },
      transactions: { title: 'All transactions', columns: [...SALE_BASE_COLUMNS, SALE_TOTAL_COL, SALE_STATUS_COL] },
      discounts: {
        title: 'Sales with a discount applied', extraParams: { hasDiscount: true },
        columns: [...SALE_BASE_COLUMNS, { label: 'Discount', num: true, render: (s) => `<span class="text-neg">${fm(s.totalDiscount)}</span>` }, SALE_TOTAL_COL],
      },
      tax: {
        title: 'Tax collected, per sale',
        columns: [...SALE_BASE_COLUMNS, { label: 'Tax', num: true, render: (s) => `<span class="font-semibold">${fm(s.tax)}</span>` }, SALE_TOTAL_COL],
      },
      refunds: {
        title: 'Sales that were refunded', extraParams: { hasRefund: true },
        columns: [...SALE_BASE_COLUMNS, { label: 'Refunded', num: true, render: (s) => `<span class="text-neg">${fm(s.refundedAmount)}</span>` }, SALE_TOTAL_COL],
      },
    };

    RT.bindAdminDrilldown(document.getElementById('sales-kpi-grid'), document.getElementById('sales-drilldown'), (key) => {
      const cfg = SALES_CONFIG[key];
      if (!cfg) return null;
      return {
        title: cfg.title,
        endpoint: '/reports/sales/detail',
        params: { ...query, ...(cfg.extraParams || {}) },
        columns: cfg.columns,
        rowSaleIdField: 'id',
      };
    });

    return {
      name: 'sales-report',
      sections: [
        { title: 'Summary', headers: ['Metric', 'Amount (KES)'], rows: [['Net sales', d.netSales], ['Gross sales', d.totalSales], ['Transactions', d.transactionCount], ['Average sale', avg.toFixed(2)], ['Discounts', d.totalDiscount], ['Tax collected', d.totalTax], ['Refunds', d.totalRefunds]] },
        { title: 'Payment methods', headers: ['Method', 'Total (KES)'], rows: (d.paymentBreakdown || []).map((p) => [RT.methodMeta(p.method).label, p.total]) },
        { title: 'Top products', headers: ['Rank', 'Product', 'Units sold', 'Revenue (KES)'], rows: products.map((p, i) => [i + 1, p.name, p.quantity, p.revenue]) },
        { title: 'Daily trend', headers: ['Date', 'Net sales (KES)', 'Transactions'], rows: trend.map((t) => [t.date, t.netSales, t.transactionCount]) },
      ],
    };
  }

  /* ================================================================== *
   * PROFIT & LOSS
   * ================================================================== */
  function renderProfit(el, d) {
    const rev = d.grossRevenue;
    const cogs = d.costOfGoodsSold;
    const gp = d.grossProfit;
    const exp = d.expenses;
    const np = d.netProfit;

    if (!rev && !exp) {
      el.innerHTML = emptyReport('Nothing to calculate yet', 'There are no completed sales or approved expenses in this period.');
      return null;
    }

    const gm = RT.pct(gp, rev);
    const nm = RT.pct(np, rev);
    const expRatio = RT.pct(exp, rev);
    const cogsRatio = RT.pct(cogs, rev);
    const profitable = np >= 0;

    const verdict = profitable
      ? `<div class="callout callout-success"><span class="callout-icon">${window.Icons.get('check')}</span><div class="callout-body"><strong>The business made a profit.</strong> Out of every KES 100 of sales (before tax) you kept about <strong>KES ${nm.toFixed(1)}</strong> after stock costs and expenses.</div></div>`
      : `<div class="callout callout-danger"><span class="callout-icon">${window.Icons.get('alert')}</span><div class="callout-body"><strong>The business made a loss of ${fm(Math.abs(np))}.</strong> ${gp >= 0 ? `Expenses (${fm(exp)}) are bigger than the gross profit (${fm(gp)}).` : 'Goods were sold for less than they cost.'}</div></div>`;

    const lines = [
      { label: 'Revenue (before tax)', amount: rev, cls: '' },
      { label: 'Cost of goods sold', amount: -cogs, cls: '' },
      { label: 'Gross profit', amount: gp, cls: 'row-strong' },
      { label: 'Expenses (approved)', amount: -exp, cls: '' },
      { label: 'Net profit', amount: np, cls: 'row-strong row-total' },
    ];

    el.innerHTML = `
      ${verdict}
      <div class="kpi-grid">
        ${RT.kpi({ label: 'Revenue', value: fm(rev), icon: 'sales', tone: 'info', sub: 'Sales before tax' })}
        ${RT.kpi({ label: 'Cost of goods sold', value: fm(cogs), icon: 'box', tone: 'warning', sub: `${RT.fmtPct(cogsRatio)} of revenue` })}
        ${RT.kpi({ label: 'Gross profit', value: fm(gp), icon: 'reports', tone: gp >= 0 ? 'success' : 'danger', sub: `${RT.fmtPct(gm)} margin` })}
        ${RT.kpi({ label: 'Expenses', value: fm(exp), icon: 'reports', tone: 'warning', sub: `${RT.fmtPct(expRatio)} of revenue` })}
        ${RT.kpi({ label: 'Net profit', value: `<span class="${profitable ? 'text-pos' : 'text-neg'}">${fm(np)}</span>`, icon: 'check', tone: profitable ? 'success' : 'danger', sub: `${RT.fmtPct(nm)} net margin` })}
      </div>

      <div class="chart-grid g-2-1">
        ${RT.chartCard({ id: 'ch-waterfall', title: 'From sales to profit', subtitle: 'Follow the money: revenue, minus what the stock cost, minus expenses' })}
        ${RT.chartCard({ id: 'ch-gauges', title: 'Margins at a glance', subtitle: 'As a share of revenue' })}
      </div>

      ${profitable && rev ? `<div class="chart-grid">${RT.chartCard({ id: 'ch-hundred', title: 'Where each KES 100 of sales goes', subtitle: 'Stock cost, running costs and what is left for you' })}</div>` : ''}

      <div class="card">
        <div class="table-toolbar"><h3>Profit and loss statement</h3></div>
        <div class="table-wrap flat">
          <table class="table">
            <thead><tr><th>Line</th><th class="num">Amount</th><th class="num">% of revenue</th></tr></thead>
            <tbody>
              ${lines.map((l) => `<tr class="${l.cls}"><td>${l.label}</td><td class="num ${l.label === 'Net profit' ? (profitable ? 'text-pos' : 'text-neg') : ''}">${fm(l.amount)}</td><td class="num">${RT.fmtPct(RT.pct(l.amount, rev))}</td></tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>
      <p class="footnote">Cost of goods uses the cost recorded on each item at the moment it was sold, so later price changes do not rewrite past profit. Only approved expenses are counted. Tax is left out of revenue.</p>`;

    CH.waterfall(document.getElementById('ch-waterfall'), {
      steps: [
        { label: 'Revenue', value: rev, kind: 'total', color: 'var(--color-primary)' },
        { label: 'Cost of goods', value: -cogs, kind: 'delta', color: '#f59e0b' },
        { label: 'Gross profit', value: gp, kind: 'total', color: '#10b981' },
        { label: 'Expenses', value: -exp, kind: 'delta', color: '#f97316' },
        { label: 'Net profit', value: np, kind: 'total', color: profitable ? '#059669' : 'var(--color-danger)' },
      ],
      format: CH.compact, tipFormat: fm, height: 420, ariaLabel: 'Revenue to net profit',
    });

    document.getElementById('ch-gauges').innerHTML = '<div class="gauge-row"><div id="g1"></div><div id="g2"></div><div id="g3"></div></div>';
    CH.gauge(document.getElementById('g1'), { value: gm, label: 'Gross margin', sub: 'After stock cost', color: '#10b981' });
    CH.gauge(document.getElementById('g2'), { value: nm, label: 'Net margin', sub: 'After expenses', color: profitable ? 'var(--color-primary)' : 'var(--color-danger)' });
    CH.gauge(document.getElementById('g3'), { value: expRatio, label: 'Expense ratio', sub: 'Lower is better', color: '#f97316' });

    if (profitable && rev) {
      CH.stackbar(document.getElementById('ch-hundred'), {
        segments: [
          { label: 'Stock cost', value: cogs, color: '#f59e0b' },
          { label: 'Expenses', value: exp, color: '#f97316' },
          { label: 'Profit', value: np, color: '#10b981' },
        ],
        format: fm,
      });
    }

    return {
      name: 'profit-and-loss',
      sections: [{ title: 'Profit and loss', headers: ['Line', 'Amount (KES)', '% of revenue'], rows: lines.map((l) => [l.label, l.amount, RT.pct(l.amount, rev).toFixed(2)]) }],
    };
  }

  /* ================================================================== *
   * PAYMENTS - expandable "Money collected" -> /reports/payments/detail
   * ================================================================== */
  function renderPayments(el, d, { query }) {
    const rows = d.breakdown || [];
    if (!rows.length) {
      el.innerHTML = emptyReport('No payments in this period', 'Payments appear here once sales are paid for.');
      return null;
    }
    const ok = rows.filter((r) => r.status === 'SUCCESS');
    const other = rows.filter((r) => r.status !== 'SUCCESS');
    const collected = ok.reduce((s, r) => s + r.total, 0);
    const okCount = ok.reduce((s, r) => s + r.count, 0);
    const otherTotal = other.reduce((s, r) => s + r.total, 0);
    const otherCount = other.reduce((s, r) => s + r.count, 0);
    const top = [...ok].sort((a, b) => b.total - a.total)[0];

    const methods = [...new Set(rows.map((r) => r.method))];
    const statuses = [...new Set(rows.map((r) => r.status))].sort((a, b) => (a === 'SUCCESS' ? -1 : b === 'SUCCESS' ? 1 : a.localeCompare(b)));

    el.innerHTML = `
      <div class="kpi-grid" id="payments-kpi-grid">
        ${RT.expandableKpi({ key: 'collected', label: 'Money collected', value: fm(collected), icon: 'sales', tone: 'success', sub: 'Successful payments - tap for each one' })}
        ${RT.expandableKpi({ key: 'notSuccessful', label: 'Not successful', value: RT.fmtNum(otherCount), tone: otherCount ? 'warning' : 'neutral', sub: otherCount ? `${fm(otherTotal)} pending, failed or reversed - tap to see them` : 'Nothing stuck' })}
        ${RT.kpi({ label: 'Successful payments', value: RT.fmtNum(okCount), tone: 'primary' })}
        ${RT.kpi({ label: 'Top method', value: top ? esc(RT.methodMeta(top.method).label) : '-', tone: 'info', sub: top ? `${RT.fmtPct(RT.pct(top.total, collected))} of collected` : '' })}
      </div>

      ${RT.drilldownPanelHtml('payments-drilldown')}

      <div class="chart-grid g-1-2">
        ${RT.chartCard({ id: 'ch-methods', title: 'Collected by method', subtitle: 'Successful payments only' })}
        ${RT.chartCard({ id: 'ch-status', title: 'Method by status', subtitle: 'Spot payments that did not go through' })}
      </div>

      <div class="card">
        <div class="table-toolbar"><h3>All payments</h3></div>
        <div class="table-wrap flat">
          <table class="table">
            <thead><tr><th>Method</th><th>Status</th><th class="num">Payments</th><th class="num">Total</th></tr></thead>
            <tbody>
              ${[...rows].sort((a, b) => b.total - a.total).map((r) => `
                <tr><td class="cell-primary">${esc(RT.methodMeta(r.method).label)}</td><td>${RT.statusBadge(r.status)}</td><td class="num">${RT.fmtNum(r.count)}</td><td class="num">${fm(r.total)}</td></tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>`;

    CH.donut(document.getElementById('ch-methods'), {
      data: ok.map((r) => ({ label: RT.methodMeta(r.method).label, value: r.total, color: RT.methodMeta(r.method).color })),
      format: RT.money0, tipFormat: fm, centerLabel: 'Collected', maxSlices: 6, ariaLabel: 'Collected by payment method',
    });

    CH.bar(document.getElementById('ch-status'), {
      labels: methods.map((m) => RT.methodMeta(m).label),
      series: statuses.map((s, i) => ({
        name: RT.prettify(s), color: RT.statusColor(s, i),
        values: methods.map((m) => rows.filter((r) => r.method === m && r.status === s).reduce((sum, r) => sum + r.total, 0)),
      })),
      format: CH.compact, tipFormat: fm, height: 400, ariaLabel: 'Payments by method and status',
    });

    const PAYMENT_COLUMNS = [
      { label: 'Receipt', render: (p) => (p.receiptNumber ? `<span class="cell-primary">${esc(p.receiptNumber)}</span>` : '<span class="text-muted">-</span>') },
      { label: 'Date & time', render: (p) => `<span class="text-sm">${window.UI.formatDateTime(p.createdAt)}</span>` },
      { label: 'Branch', render: (p) => `<span class="text-sm">${esc(p.branchName || '-')}</span>` },
      { label: 'Cashier', render: (p) => `<span class="text-sm">${esc(p.cashierName || '-')}</span>` },
      { label: 'Method', render: (p) => esc(RT.methodMeta(p.method).label) },
      { label: 'Reference', render: (p) => (p.reference ? esc(p.reference) : '<span class="text-muted">-</span>') },
      { label: 'Status', render: (p) => RT.statusBadge(p.status) },
      { label: 'Amount', num: true, render: (p) => `<span class="font-semibold">${fm(p.amount)}</span>` },
    ];

    RT.bindAdminDrilldown(document.getElementById('payments-kpi-grid'), document.getElementById('payments-drilldown'), (key) => {
      if (key === 'collected') {
        return { title: 'Successful payments', endpoint: '/reports/payments/detail', params: { ...query, status: 'SUCCESS' }, columns: PAYMENT_COLUMNS, rowSaleIdField: 'saleId' };
      }
      if (key === 'notSuccessful') {
        // No single "not successful" status filter server-side, so this
        // shows every payment in period; the Status column makes clear
        // which rows are the pending/failed/reversed ones being referenced.
        return { title: 'Payments that did not succeed', endpoint: '/reports/payments/detail', params: { ...query }, columns: PAYMENT_COLUMNS, rowSaleIdField: 'saleId' };
      }
      return null;
    });

    return {
      name: 'payments-report',
      sections: [{ headers: ['Method', 'Status', 'Payments', 'Total (KES)'], rows: rows.map((r) => [RT.methodMeta(r.method).label, r.status, r.count, r.total]) }],
    };
  }

  /* ================================================================== *
   * CASHIERS
   * ================================================================== */
  function renderCashiers(el, d) {
    const list = d.cashiers || [];
    if (!list.length) {
      el.innerHTML = emptyReport('No cashier activity in this period', 'Sales rung up by your team show up here.');
      return null;
    }
    const total = list.reduce((s, c) => s + c.totalSales, 0);
    const txns = list.reduce((s, c) => s + c.transactionCount, 0);
    const best = list[0];
    const bestAvg = [...list].sort((a, b) => b.averageSale - a.averageSale)[0];

    el.innerHTML = `
      <div class="kpi-grid">
        ${RT.kpi({ label: 'Cashiers who sold', value: RT.fmtNum(list.length), icon: 'employees', tone: 'primary' })}
        ${RT.kpi({ label: 'Total sales', value: fm(total), icon: 'sales', tone: 'success', sub: `${RT.fmtNum(txns)} transactions` })}
        ${RT.kpi({ label: 'Top seller', value: esc(best.name), icon: 'check', tone: 'info', sub: `${fm(best.totalSales)} · ${RT.fmtPct(RT.pct(best.totalSales, total), 0)} of sales` })}
        ${RT.kpi({ label: 'Highest average sale', value: esc(bestAvg.name), tone: 'neutral', sub: fm(bestAvg.averageSale) })}
      </div>

      <div class="chart-grid g-2-1">
        ${RT.chartCard({ id: 'ch-cash-bar', title: 'Sales by cashier', subtitle: 'Total value rung up' })}
        ${RT.chartCard({ id: 'ch-cash-pie', title: 'Share of sales', subtitle: 'Who carries the till' })}
      </div>

      <div class="card">
        <div class="table-toolbar"><h3>Leaderboard</h3></div>
        <div class="table-wrap flat">
          <table class="table">
            <thead><tr><th>#</th><th>Cashier</th><th class="num">Transactions</th><th class="num">Total sales</th><th class="num">Average sale</th><th>Share</th></tr></thead>
            <tbody>
              ${list.map((c, i) => `
                <tr>
                  <td>${RT.rankBadge(i)}</td>
                  <td class="cell-primary">${esc(c.name)}</td>
                  <td class="num">${RT.fmtNum(c.transactionCount)}</td>
                  <td class="num">${fm(c.totalSales)}</td>
                  <td class="num">${fm(c.averageSale)}</td>
                  <td><span class="mini-bar"><span style="width:${RT.pct(c.totalSales, total)}%"></span></span> <span class="text-xs text-muted">${RT.fmtPct(RT.pct(c.totalSales, total), 0)}</span></td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>`;

    const top = list.slice(0, 10);
    CH.bar(document.getElementById('ch-cash-bar'), {
      labels: top.map((c) => c.name),
      series: [{ name: 'Total sales', values: top.map((c) => c.totalSales) }],
      format: CH.compact, tipFormat: fm, height: 400, ariaLabel: 'Sales by cashier',
    });
    CH.donut(document.getElementById('ch-cash-pie'), {
      data: list.map((c) => ({ label: c.name, value: c.totalSales })),
      format: RT.money0, tipFormat: fm, centerLabel: 'Total', maxSlices: 6, ariaLabel: 'Share of sales by cashier',
    });

    return {
      name: 'cashier-report',
      sections: [{ headers: ['Rank', 'Cashier', 'Transactions', 'Total sales (KES)', 'Average sale (KES)'], rows: list.map((c, i) => [i + 1, c.name, c.transactionCount, c.totalSales, c.averageSale]) }],
    };
  }

  /* ================================================================== *
   * EXPENSES - expandable total -> /reports/expenses/detail
   * ================================================================== */
  function renderExpenses(el, d, { query }) {
    const rows = d.breakdown || [];
    if (!rows.length) {
      el.innerHTML = emptyReport('No expenses in this period', 'Record expenses on the Expenses page and they will be analysed here.');
      return null;
    }
    const statuses = [...new Set(rows.map((r) => r.status))];
    const pending = rows.filter((r) => r.status === 'PENDING').reduce((s, r) => s + r.total, 0);
    let current = statuses.includes('APPROVED') ? 'APPROVED' : 'ALL';
    let lastExport = null;

    el.innerHTML = `
      <div class="section-bar">
        <div id="exp-status"></div>
        <span class="text-xs text-muted">Only approved expenses reduce profit.</span>
      </div>
      ${RT.drilldownPanelHtml('expenses-drilldown')}
      <div id="exp-body"></div>`;

    RT.segmented(document.getElementById('exp-status'),
      [{ key: 'ALL', label: 'All' }, ...statuses.map((s) => ({ key: s, label: RT.prettify(s) }))],
      current, (k) => { current = k; RT.closeDrilldown(document.getElementById('expenses-drilldown')); paint(); });

    const EXPENSE_COLUMNS = [
      { label: 'Date', render: (e) => window.UI.formatDateTime(e.createdAt) },
      { label: 'Branch', render: (e) => esc(e.branchName || '-') },
      { label: 'Category', render: (e) => esc(RT.prettify(e.category)) },
      { label: 'Description', render: (e) => (e.description ? esc(e.description) : '<span class="text-muted">-</span>') },
      { label: 'Status', render: (e) => RT.statusBadge(e.status) },
      { label: 'Amount', num: true, render: (e) => `<span class="font-semibold">${fm(e.amount)}</span>` },
    ];

    function paint() {
      const sel = current === 'ALL' ? rows : rows.filter((r) => r.status === current);
      const cats = {};
      sel.forEach((r) => {
        const c = cats[r.category] || (cats[r.category] = { category: r.category, total: 0, count: 0 });
        c.total += r.total;
        c.count += r.count;
      });
      const byCat = Object.values(cats).sort((a, b) => b.total - a.total);
      const total = byCat.reduce((s, c) => s + c.total, 0);
      const count = byCat.reduce((s, c) => s + c.count, 0);
      const body = document.getElementById('exp-body');

      if (!sel.length) { body.innerHTML = emptyReport('Nothing with this status', 'Pick another status above.'); lastExport = null; return; }

      body.innerHTML = `
        <div class="kpi-grid" id="expenses-kpi-grid">
          ${RT.expandableKpi({ key: 'expenseTotal', label: current === 'ALL' ? 'All expenses' : `${RT.prettify(current)} expenses`, value: fm(total), icon: 'reports', tone: 'warning', sub: 'Tap to see each entry' })}
          ${RT.kpi({ label: 'Entries', value: RT.fmtNum(count), tone: 'neutral', sub: `${byCat.length} categories` })}
          ${RT.kpi({ label: 'Biggest category', value: esc(RT.prettify(byCat[0].category)), tone: 'info', sub: `${fm(byCat[0].total)} · ${RT.fmtPct(RT.pct(byCat[0].total, total), 0)}` })}
          ${pending > 0 ? RT.kpi({ label: 'Waiting for approval', value: fm(pending), tone: 'danger', sub: 'Not counted in profit yet' }) : ''}
        </div>
        <div class="chart-grid g-1-1">
          ${RT.chartCard({ id: 'ch-exp-pie', title: 'Where the money went', subtitle: 'Share by category' })}
          ${RT.chartCard({ id: 'ch-exp-bar', title: 'Categories ranked', subtitle: 'Biggest first' })}
        </div>
        <div class="card">
          <div class="table-toolbar"><h3>Breakdown</h3></div>
          <div class="table-wrap flat">
            <table class="table">
              <thead><tr><th>Category</th><th>Status</th><th class="num">Entries</th><th class="num">Total</th></tr></thead>
              <tbody>
                ${[...sel].sort((a, b) => b.total - a.total).map((r) => `<tr><td class="cell-primary">${esc(RT.prettify(r.category))}</td><td>${RT.statusBadge(r.status)}</td><td class="num">${RT.fmtNum(r.count)}</td><td class="num">${fm(r.total)}</td></tr>`).join('')}
              </tbody>
            </table>
          </div>
        </div>`;

      CH.donut(document.getElementById('ch-exp-pie'), {
        data: byCat.map((c) => ({ label: RT.prettify(c.category), value: c.total })),
        inner: 0, size: 300, format: RT.money0, tipFormat: fm, maxSlices: 7, ariaLabel: 'Expenses by category',
      });
      CH.hbar(document.getElementById('ch-exp-bar'), {
        data: byCat.slice(0, 10).map((c) => ({ label: RT.prettify(c.category), value: c.total, sub: `${RT.fmtNum(c.count)} entries` })),
        format: RT.money0, valueLabel: 'Total', ranked: true,
      });
      window.Permissions.applyPermissionGates(body, user);

      RT.bindAdminDrilldown(document.getElementById('expenses-kpi-grid'), document.getElementById('expenses-drilldown'), (key) => {
        if (key !== 'expenseTotal') return null;
        return {
          title: current === 'ALL' ? 'All expenses' : `${RT.prettify(current)} expenses`,
          endpoint: '/reports/expenses/detail',
          params: { ...query, ...(current !== 'ALL' ? { status: current } : {}) },
          columns: EXPENSE_COLUMNS,
        };
      });

      lastExport = {
        name: 'expense-report',
        sections: [{ headers: ['Category', 'Status', 'Entries', 'Total (KES)'], rows: sel.map((r) => [RT.prettify(r.category), r.status, r.count, r.total]) }],
      };
    }

    paint();
    return () => lastExport;
  }

  /* ================================================================== *
   * INVENTORY
   * ================================================================== */
  function renderInventory(el, d) {
    if (!d.totalSkus) {
      el.innerHTML = emptyReport('No stock recorded for this branch', 'Receive stock or add products to see valuation and alerts.');
      return null;
    }
    const attention = Math.min(d.lowStockCount + d.outOfStockCount, d.totalSkus);
    const healthy = 100 - RT.pct(attention, d.totalSkus);
    const avgUnitCost = d.totalUnitsOnHand ? d.inventoryValuation / d.totalUnitsOnHand : 0;

    el.innerHTML = `
      <div class="kpi-grid">
        ${RT.kpi({ label: 'Stock value', value: fm(d.inventoryValuation), icon: 'inventory', tone: 'primary', sub: 'At current cost price' })}
        ${RT.kpi({ label: 'Units on hand', value: RT.fmtNum(d.totalUnitsOnHand), icon: 'box', tone: 'info', sub: `${fm(avgUnitCost)} average cost per unit` })}
        ${RT.kpi({ label: 'Products tracked', value: RT.fmtNum(d.totalSkus), icon: 'products', tone: 'neutral' })}
        ${RT.kpi({ label: 'Running low', value: RT.fmtNum(d.lowStockCount), icon: 'alert', tone: d.lowStockCount ? 'warning' : 'success', sub: d.lowStockCount ? 'Reorder soon' : 'Nothing running low' })}
        ${RT.kpi({ label: 'Out of stock', value: RT.fmtNum(d.outOfStockCount), icon: 'alert', tone: d.outOfStockCount ? 'danger' : 'success', sub: d.outOfStockCount ? 'Losing sales right now' : 'Everything available' })}
      </div>

      <div class="chart-grid g-1-2">
        ${RT.chartCard({ id: 'ch-health', title: 'Stock health', subtitle: 'Products not running low or out', bodyClass: 'center' })}
        <section class="card chart-card">
          <header class="chart-card-head"><div><h3>What needs attention</h3><p>Share of your products</p></div></header>
          <div class="chart-card-body">
            <div class="meter"><div class="meter-top"><span>Running low</span><b>${RT.fmtNum(d.lowStockCount)} of ${RT.fmtNum(d.totalSkus)}</b></div>
              <div class="hbar-track"><div class="hbar-fill" style="width:${RT.pct(d.lowStockCount, d.totalSkus)}%;background:var(--color-warning)"></div></div></div>
            <div class="meter"><div class="meter-top"><span>Out of stock</span><b>${RT.fmtNum(d.outOfStockCount)} of ${RT.fmtNum(d.totalSkus)}</b></div>
              <div class="hbar-track"><div class="hbar-fill" style="width:${RT.pct(d.outOfStockCount, d.totalSkus)}%;background:var(--color-danger)"></div></div></div>
            <div style="margin-top: var(--space-5)">
              <a class="btn btn-secondary btn-sm" href="inventory.html" data-requires-permission="inventory.view">Open inventory</a>
              <a class="btn btn-secondary btn-sm" href="purchases.html" data-requires-permission="purchases.view">Restock from suppliers</a>
            </div>
          </div>
        </section>
      </div>
      <p class="footnote">Stock value multiplies units on hand by each product's current cost price. Change a cost price and this figure moves with it.</p>`;

    CH.gauge(document.getElementById('ch-health'), {
      value: healthy, label: 'Healthy', sub: `${RT.fmtNum(attention)} need attention`,
      color: healthy >= 85 ? '#10b981' : healthy >= 60 ? '#f59e0b' : 'var(--color-danger)',
    });

    return {
      name: 'inventory-report',
      sections: [{ headers: ['Metric', 'Value'], rows: [['Stock value (KES)', d.inventoryValuation], ['Units on hand', d.totalUnitsOnHand], ['Products tracked', d.totalSkus], ['Running low', d.lowStockCount], ['Out of stock', d.outOfStockCount]] }],
    };
  }

  /* ================================================================== *
   * CUSTOMERS OWING
   * ================================================================== */
  function renderCustomers(el, d) {
    const list = d.customers || [];
    if (!list.length) {
      el.innerHTML = emptyReport('No customer owes you anything', 'Credit sales that are not fully paid will be listed here.');
      return null;
    }
    const top3 = list.slice(0, 3).reduce((s, c) => s + c.outstandingBalance, 0);
    const over = list.filter((c) => c.creditLimit > 0 && c.outstandingBalance > c.creditLimit);
    const util = (c) => (c.creditLimit > 0 ? RT.pct(c.outstandingBalance, c.creditLimit) : null);

    el.innerHTML = `
      <div class="kpi-grid">
        ${RT.kpi({ label: 'Owed to you', value: fm(d.totalOutstanding), icon: 'employees', tone: 'warning', sub: 'Unpaid credit sales' })}
        ${RT.kpi({ label: 'Customers with a balance', value: RT.fmtNum(list.length), tone: 'neutral', sub: list.length >= 50 ? 'Showing the top 50' : '' })}
        ${RT.kpi({ label: 'Biggest balance', value: fm(list[0].outstandingBalance), tone: 'info', sub: list[0].name })}
        ${RT.kpi({ label: 'Over credit limit', value: RT.fmtNum(over.length), tone: over.length ? 'danger' : 'success', sub: over.length ? 'Stop new credit until they pay' : 'Everyone is within limit' })}
      </div>
      <div class="insights"><div class="insight ${RT.pct(top3, d.totalOutstanding) > 60 ? 'insight-warning' : 'insight-info'}">Your top 3 debtors hold <strong>${RT.fmtPct(RT.pct(top3, d.totalOutstanding), 0)}</strong> of everything owed. ${RT.pct(top3, d.totalOutstanding) > 60 ? 'Collecting from them first will move the needle most.' : 'The debt is spread out.'}</div></div>

      <div class="chart-grid">${RT.chartCard({ id: 'ch-debtors', title: 'Biggest balances', subtitle: 'Top 10 customers by amount owed' })}</div>

      <div class="card">
        <div class="table-toolbar">
          <h3>Who owes what</h3>
          <div class="input-group"><span class="input-group-icon">${window.Icons.get('search')}</span><input class="input" id="tbl-search" type="text" placeholder="Search name or phone" /></div>
        </div>
        <div class="table-wrap flat">
          <table class="table">
            <thead><tr><th>Customer</th><th>Phone</th><th class="num">Balance</th><th class="num">Credit limit</th><th>Limit used</th></tr></thead>
            <tbody id="tbl-body">
              ${list.map((c) => {
                const u = util(c);
                const cls = u == null ? '' : u > 100 ? 'bad' : u >= 80 ? 'warn' : '';
                return `<tr>
                  <td class="cell-primary">${esc(c.name)}</td>
                  <td>${c.phone ? `<a href="tel:${esc(c.phone)}">${esc(c.phone)}</a>` : '<span class="text-muted">-</span>'}</td>
                  <td class="num">${fm(c.outstandingBalance)}</td>
                  <td class="num">${c.creditLimit > 0 ? fm(c.creditLimit) : '<span class="text-muted">No limit</span>'}</td>
                  <td>${u == null ? '<span class="text-muted">-</span>' : `<span class="mini-bar ${cls}"><span style="width:${Math.min(u, 100)}%"></span></span> <span class="text-xs ${u > 100 ? 'text-neg' : 'text-muted'}">${u.toFixed(0)}%</span>`}</td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>`;

    CH.hbar(document.getElementById('ch-debtors'), {
      data: list.slice(0, 10).map((c) => ({ label: c.name, value: c.outstandingBalance, sub: c.phone || '', color: 'var(--color-warning)' })),
      format: RT.money0, valueLabel: 'Owes', ranked: true,
    });
    RT.tableSearch(document.getElementById('tbl-search'), document.getElementById('tbl-body'));

    return {
      name: 'customers-owing',
      sections: [{ headers: ['Customer', 'Phone', 'Balance (KES)', 'Credit limit (KES)'], rows: list.map((c) => [c.name, c.phone || '', c.outstandingBalance, c.creditLimit]) }],
    };
  }

  /* ================================================================== *
   * SUPPLIERS OWED
   * ================================================================== */
  function renderSuppliers(el, d) {
    const list = d.suppliers || [];
    if (!list.length) {
      el.innerHTML = emptyReport('You do not owe any supplier', 'Unpaid purchases will be listed here.');
      return null;
    }
    el.innerHTML = `
      <div class="kpi-grid">
        ${RT.kpi({ label: 'You owe suppliers', value: fm(d.totalPayable), icon: 'branches', tone: 'warning', sub: 'Unpaid purchases' })}
        ${RT.kpi({ label: 'Suppliers waiting', value: RT.fmtNum(list.length), tone: 'neutral', sub: list.length >= 50 ? 'Showing the top 50' : '' })}
        ${RT.kpi({ label: 'Largest balance', value: fm(list[0].currentBalance), tone: 'info', sub: list[0].name })}
      </div>

      <div class="chart-grid g-2-1">
        ${RT.chartCard({ id: 'ch-owed', title: 'Biggest payables', subtitle: 'Top 10 suppliers by amount owed' })}
        ${RT.chartCard({ id: 'ch-owed-pie', title: 'Concentration', subtitle: 'Share of what you owe' })}
      </div>

      <div class="card">
        <div class="table-toolbar">
          <h3>Supplier balances</h3>
          <div class="input-group"><span class="input-group-icon">${window.Icons.get('search')}</span><input class="input" id="tbl-search" type="text" placeholder="Search name or phone" /></div>
        </div>
        <div class="table-wrap flat">
          <table class="table">
            <thead><tr><th>Supplier</th><th>Phone</th><th class="num">You owe</th><th>Share</th></tr></thead>
            <tbody id="tbl-body">
              ${list.map((s) => `<tr>
                <td class="cell-primary">${esc(s.name)}</td>
                <td>${s.phone ? `<a href="tel:${esc(s.phone)}">${esc(s.phone)}</a>` : '<span class="text-muted">-</span>'}</td>
                <td class="num">${fm(s.currentBalance)}</td>
                <td><span class="mini-bar"><span style="width:${RT.pct(s.currentBalance, d.totalPayable)}%"></span></span> <span class="text-xs text-muted">${RT.fmtPct(RT.pct(s.currentBalance, d.totalPayable), 0)}</span></td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>`;

    CH.hbar(document.getElementById('ch-owed'), {
      data: list.slice(0, 10).map((s) => ({ label: s.name, value: s.currentBalance, sub: s.phone || '', color: '#f97316' })),
      format: RT.money0, valueLabel: 'You owe', ranked: true,
    });
    CH.donut(document.getElementById('ch-owed-pie'), {
      data: list.map((s) => ({ label: s.name, value: s.currentBalance })),
      inner: 0, size: 260, format: RT.money0, tipFormat: fm, maxSlices: 5, ariaLabel: 'Share of payables by supplier',
    });
    RT.tableSearch(document.getElementById('tbl-search'), document.getElementById('tbl-body'));

    return {
      name: 'supplier-balances',
      sections: [{ headers: ['Supplier', 'Phone', 'You owe (KES)'], rows: list.map((s) => [s.name, s.phone || '', s.currentBalance]) }],
    };
  }
})();