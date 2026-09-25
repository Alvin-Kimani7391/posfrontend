/**
 * dashboard.js
 * Two dashboards:
 *
 *  - Full dashboard (reports.view): unchanged - takings, KPIs, charts,
 *    stock alerts, employee login card, setup checklist.
 *
 *  - Personal dashboard (no reports.view - Cashier, Storekeeper, custom
 *    roles): now has its OWN filter bar (dates only) instead of a silent
 *    "today" default. THIS IS THE FIX for stats reading zero even when
 *    the cashier made sales: previously /reports/me was called with no
 *    from/to at all, so it always meant "today" with no way to see
 *    yesterday or a wider period. Now the same date presets the full
 *    dashboard uses (Today/7d/30d/month) are available here too, and the
 *    resolved range is shown under the greeting so it's never ambiguous
 *    what "zero" means.
 *    "Transactions today" and friends are now expandable - clicking opens
 *    the same shared drill-down panel used in Reports, listing the
 *    cashier's own sales (branch, time, customer, total, status) with
 *    "Load more" and a tap-through to full sale detail (real payment
 *    methods used). The backend now self-scopes GET /sales for anyone
 *    without reports.view, so this is safe: a cashier can only ever see
 *    their own sales through it, however the query is built.
 */
(function () {
  const RT = window.ReportTools;
  const CH = window.Charts;
  const esc = window.UI.escapeHtml;
  const fm = (n) => window.UI.formatMoney(n);

  let contentEl;
  let user;
  let businessId = '';
  let filterBar = null;
  let personalFilterBar = null;
  let canReports = false;
  let canProfit = false;
  let canSelfSales = false;
  let canSelfInventory = false;
  let canSelfShift = false;
  let token = 0;
  let timer = null;

  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    contentEl = window.AppShell.mount({ title: 'Dashboard' });
    if (!contentEl) return;

    user = window.AppShell.getUser();
    canReports = window.Permissions.can(user, 'reports.view');
    canProfit = window.Permissions.can(user, 'reports.profit');
    canSelfSales = window.Permissions.can(user, 'sales.view') || window.Permissions.can(user, 'sales.create');
    canSelfInventory = window.Permissions.can(user, 'inventory.view');
    canSelfShift = window.Permissions.can(user, 'shifts.view');
    businessId = await ensureBusinessId();

    contentEl.innerHTML = pageSkeleton();
    bindLoginCard();
    window.Permissions.applyPermissionGates(contentEl, user);
    window.addEventListener('beforeunload', () => clearInterval(timer));

    if (canReports) {
      document.getElementById('dash-refresh').addEventListener('click', () => load());
      filterBar = RT.createFilterBar(document.getElementById('dash-filters'), {
        defaultPreset: 'today',
        presets: ['today', 'yesterday', '7d', '30d', 'month'],
        showBranch: true,
        onChange: () => load(),
      });
      await filterBar.ready;
      await load();
      timer = setInterval(() => {
        if (!document.hidden && filterBar.getState().preset === 'today') load({ silent: true });
      }, 60000);
    } else {
      document.getElementById('dash-refresh').addEventListener('click', () => loadPersonal());
      personalFilterBar = RT.createFilterBar(document.getElementById('dash-personal-filters'), {
        defaultPreset: 'today',
        presets: ['today', 'yesterday', '7d', '30d'],
        showBranch: false,
        onChange: () => loadPersonal(),
      });
      await personalFilterBar.ready;
      await loadPersonal();
      timer = setInterval(() => {
        if (!document.hidden && personalFilterBar.getState().preset === 'today') loadPersonal({ silent: true });
      }, 60000);
    }
    loadSetupChecklist();
  }

  /* ------------------------------------------------------------------ *
   * Page frame
   * ------------------------------------------------------------------ */
  function greeting() {
    const h = new Date().getHours();
    const part = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
    return `${part}, ${esc((user?.name || '').split(' ')[0])}`;
  }

  function pageSkeleton() {
    return `
      <div class="page-header">
        <div>
          <h1>${greeting()} 👋</h1>
          <p id="dash-sub">${canReports ? 'Here is how your business is doing.' : "Here's what's happening on your shift."}</p>
        </div>
        <div class="page-actions"><button class="btn btn-secondary btn-sm" id="dash-refresh">Refresh</button></div>
      </div>

      <div class="quick-actions">
        <a class="qa primary" href="sales.html" data-requires-permission="sales.view">${window.Icons.get('sales')} New sale</a>
        <a class="qa" href="products.html" data-requires-permission="products.view">${window.Icons.get('products')} Products</a>
        <a class="qa" href="inventory.html" data-requires-permission="inventory.view">${window.Icons.get('inventory')} Inventory</a>
        <a class="qa" href="customers.html" data-requires-permission="customers.view">${window.Icons.get('employees')} Customers</a>
        <a class="qa" href="expenses.html" data-requires-permission="expenses.view">${window.Icons.get('reports')} Expenses</a>
        <a class="qa" href="reports.html" data-requires-permission="reports.view">${window.Icons.get('reports')} Reports</a>
        <a class="qa" href="audit-logs.html" data-requires-permission="audit.view">${window.Icons.get('settings')} Audit log</a>
      </div>

      ${canReports ? '<div id="dash-filters"></div>' : '<div id="dash-personal-filters"></div>'}
      <div id="dash-body"></div>
      <div id="setup-slot"></div>
      ${loginCard()}
    `;
  }

  /* ==================================================================== *
   * FULL DASHBOARD (reports.view) - unchanged
   * ==================================================================== */
  async function load({ silent = false } = {}) {
    const body = document.getElementById('dash-body');
    const my = ++token;
    const st = filterBar.getState();
    const q = filterBar.getQuery();
    const pr = RT.previousRange(st.from, st.to);
    const prevQ = { ...q, from: pr.from.toISOString(), to: pr.to.toISOString() };

    if (!silent) body.innerHTML = loadingHtml();

    const [cur, prev] = await Promise.allSettled([
      window.Api.get('/reports/dashboard', q),
      window.Api.get('/reports/dashboard', prevQ),
    ]);
    if (my !== token) return;

    if (cur.status === 'rejected') {
      if (silent) return;
      body.innerHTML = `<div class="card">${window.UI.emptyStateHtml({
        icon: 'alert', title: 'Could not load your dashboard', message: cur.reason?.message || 'Please try again.',
        actionHtml: '<button class="btn btn-secondary" id="dash-retry">Try again</button>',
      })}</div>`;
      document.getElementById('dash-retry').addEventListener('click', () => load());
      return;
    }
    render(body, cur.value.data, prev.status === 'fulfilled' ? prev.value.data : null, st);
  }

  function loadingHtml() {
    const tile = '<div class="kpi"><div class="skeleton" style="height:12px;width:50%"></div><div class="skeleton" style="height:28px;width:70%;margin-top:14px"></div></div>';
    return `<div class="takings"><div class="skeleton" style="height:90px"></div><div class="skeleton" style="height:60px"></div></div>
      <div class="kpi-grid">${tile.repeat(4)}</div>
      <div class="chart-grid g-1-1"><div class="card chart-card"><div class="skeleton" style="height:320px;margin:20px"></div></div><div class="card chart-card"><div class="skeleton" style="height:320px;margin:20px"></div></div></div>`;
  }

  function render(body, d, prev, st) {
    const s = d.sales;
    const p = d.profit;
    const inv = d.inventory;
    const ps = prev?.sales;
    const pp = prev?.profit;
    const avg = s.transactions ? s.netSales / s.transactions : 0;
    const vs = st.preset === 'today' ? 'vs yesterday' : st.preset === 'yesterday' ? 'vs the day before' : 'vs the period before';
    const rangeText = RT.describeRange(st.from, st.to);

    document.getElementById('dash-sub').textContent = `${rangeText} · ${filterBar.branchLabel()}`;

    const quiet = !s.transactions;
    const tiles = [];
    if (canProfit && p) {
      tiles.push(RT.kpi({ label: 'Gross profit', value: fm(p.grossProfit), icon: 'reports', tone: p.grossProfit >= 0 ? 'success' : 'danger', sub: `${RT.fmtPct(RT.pct(p.grossProfit, p.grossRevenue))} margin`, delta: RT.deltaBadge(p.grossProfit, pp?.grossProfit) }));
      tiles.push(RT.kpi({ label: 'Net profit', value: `<span class="${p.netProfit >= 0 ? 'text-pos' : 'text-neg'}">${fm(p.netProfit)}</span>`, icon: 'check', tone: p.netProfit >= 0 ? 'success' : 'danger', sub: `${RT.fmtPct(RT.pct(p.netProfit, p.grossRevenue))} net margin`, delta: RT.deltaBadge(p.netProfit, pp?.netProfit) }));
      tiles.push(RT.kpi({ label: 'Expenses', value: fm(p.expenses), icon: 'reports', tone: 'warning', sub: 'Approved only', delta: RT.deltaBadge(p.expenses, pp?.expenses, { invert: true }) }));
    }
    tiles.push(RT.kpi({ label: 'Refunds', value: fm(s.totalRefunds), tone: s.totalRefunds > 0 ? 'danger' : 'neutral', sub: `${RT.fmtPct(RT.pct(s.totalRefunds, s.netSales))} of net sales`, delta: RT.deltaBadge(s.totalRefunds, ps?.totalRefunds, { invert: true }) }));
    tiles.push(RT.kpi({ label: 'Owed by customers', value: fm(d.outstandingCustomerCredit), icon: 'employees', tone: 'warning', sub: 'Unpaid credit sales' }));
    tiles.push(RT.kpi({ label: 'Owed to suppliers', value: fm(d.supplierPayables), icon: 'branches', tone: 'warning', sub: 'Unpaid purchases' }));

    body.innerHTML = `
      <section class="takings">
        <div>
          <div class="takings-label">Net sales</div>
          <div class="takings-value">${fm(s.netSales)}</div>
          <div class="takings-meta">
            ${RT.deltaBadge(s.netSales, ps?.netSales)} ${ps ? `<span>${vs}</span>` : ''}
            ${quiet ? '<span>No sales yet in this period.</span>' : ''}
          </div>
          <div class="takings-meta" style="margin-top: var(--space-2)">
            <span><b>${RT.fmtNum(s.transactions)}</b> sales ${RT.deltaBadge(s.transactions, ps?.transactions)}</span>
            <span><b>${fm(avg)}</b> average</span>
            <span><b>${fm(s.totalDiscount)}</b> discounts</span>
          </div>
        </div>
        <div>
          <div class="takings-split-title">How the money came in</div>
          <div id="pay-split"></div>
        </div>
      </section>

      <div class="kpi-grid" id="dash-kpi-grid">${tiles.join('')}</div>

      <div class="chart-grid g-1-1">
        ${RT.chartCard({ id: 'd-pay', title: 'Payment mix', subtitle: 'Cash, M-PESA, card and more' })}
        ${RT.chartCard({ id: 'd-products', title: 'Top products', subtitle: 'Best five by revenue' })}
      </div>

      <div class="chart-grid ${canProfit ? 'g-1-1' : ''}">
        ${canProfit ? RT.chartCard({ id: 'd-profit', title: 'From sales to profit', subtitle: 'Revenue, stock cost, expenses' }) : ''}
        ${RT.chartCard({ id: 'd-cashiers', title: 'Top cashiers', subtitle: 'Sales rung up this period' })}
      </div>

      <div class="chart-grid g-1-1">
        ${RT.chartCard({ id: 'd-money', title: 'Money position', subtitle: 'What is owed to you, what you owe, what is on the shelves' })}
        <section class="card chart-card">
          <header class="chart-card-head"><div><h3>Stock alerts</h3><p>Across the selected branch</p></div></header>
          <div class="chart-card-body">
            <div class="tile-row">
              <div class="tile ${inv.lowStockCount ? 'warn' : 'good'}"><b>${RT.fmtNum(inv.lowStockCount)}</b><span>Running low</span></div>
              <div class="tile ${inv.outOfStockCount ? 'bad' : 'good'}"><b>${RT.fmtNum(inv.outOfStockCount)}</b><span>Out of stock</span></div>
              <div class="tile"><b>${RT.money0(inv.inventoryValuation)}</b><span>Stock value at cost</span></div>
            </div>
            <div style="margin-top: var(--space-4)"><a class="btn btn-secondary btn-sm" href="inventory.html" data-requires-permission="inventory.view">Open inventory</a></div>
          </div>
        </section>
      </div>`;

    CH.stackbar(document.getElementById('pay-split'), {
      segments: (s.paymentBreakdown || []).map((x) => ({ label: RT.methodMeta(x.method).label, value: x.total, color: RT.methodMeta(x.method).color })),
      format: RT.money0, emptyText: 'Payments will show up here as sales are made.',
    });
    CH.donut(document.getElementById('d-pay'), {
      data: (s.paymentBreakdown || []).map((x) => ({ label: RT.methodMeta(x.method).label, value: x.total, color: RT.methodMeta(x.method).color })),
      format: RT.money0, tipFormat: fm, centerLabel: 'Collected', ariaLabel: 'Payment mix',
    });
    CH.hbar(document.getElementById('d-products'), {
      data: (s.topProducts || []).map((x) => ({ label: x.name, value: x.revenue, sub: `${RT.fmtNum(x.quantity)} sold` })),
      format: RT.money0, valueLabel: 'Revenue', ranked: true, emptyText: 'No products sold in this period.',
    });
    if (canProfit && p) {
      CH.waterfall(document.getElementById('d-profit'), {
        steps: [
          { label: 'Revenue', value: p.grossRevenue, kind: 'total', color: 'var(--color-primary)' },
          { label: 'Stock cost', value: -p.costOfGoodsSold, kind: 'delta', color: '#f59e0b' },
          { label: 'Gross profit', value: p.grossProfit, kind: 'total', color: '#10b981' },
          { label: 'Expenses', value: -p.expenses, kind: 'delta', color: '#f97316' },
          { label: 'Net profit', value: p.netProfit, kind: 'total', color: p.netProfit >= 0 ? '#059669' : 'var(--color-danger)' },
        ],
        format: CH.compact, tipFormat: fm, height: 340, ariaLabel: 'Revenue to net profit',
      });
    }
    const cashiers = (d.topCashiers || []).slice(0, 5);
    CH.bar(document.getElementById('d-cashiers'), {
      labels: cashiers.map((c) => c.name),
      series: [{ name: 'Sales', values: cashiers.map((c) => c.totalSales) }],
      format: CH.compact, tipFormat: fm, height: 340, ariaLabel: 'Top cashiers', emptyText: 'No cashier activity in this period.',
    });
    CH.bar(document.getElementById('d-money'), {
      labels: ['Owed by customers', 'Owed to suppliers', 'Stock value'],
      series: [{ name: 'Amount', values: [d.outstandingCustomerCredit, d.supplierPayables, inv.inventoryValuation], colors: ['#3b82f6', '#f59e0b', '#10b981'] }],
      format: CH.compact, tipFormat: fm, height: 320, ariaLabel: 'Money position',
    });

    window.Permissions.applyPermissionGates(body, user);
  }

  /* ==================================================================== *
   * PERSONAL DASHBOARD (no reports.view) - Cashier, Storekeeper, custom roles
   * ==================================================================== */
  function loadingHtmlPersonal() {
    const tile = '<div class="kpi"><div class="skeleton" style="height:12px;width:50%"></div><div class="skeleton" style="height:28px;width:70%;margin-top:14px"></div></div>';
    return `<div class="skeleton" style="height:56px;border-radius:var(--radius-md);margin-bottom:var(--space-4)"></div>
      <div class="takings"><div class="skeleton" style="height:70px"></div></div>
      <div class="kpi-grid">${tile.repeat(3)}</div>`;
  }

  async function loadPersonal({ silent = false } = {}) {
    const body = document.getElementById('dash-body');
    const my = ++token;
    if (!silent) body.innerHTML = loadingHtmlPersonal();

    const branchId = window.AppShell.getActiveBranchId();
    const st = personalFilterBar.getState();
    // ALWAYS an explicit from/to now - this is the fix for the "zero even
    // though sales were made" bug: previously no range was sent at all,
    // which silently meant "today" with no visible label and no way to
    // widen it from the UI.
    const dateQuery = { from: st.from.toISOString(), to: st.to.toISOString() };

    const [meRes, shiftRes] = await Promise.allSettled([
      window.Api.get('/reports/me', { ...dateQuery, ...(branchId ? { branchId } : {}) }),
      canSelfShift ? window.Api.get('/shifts/current', branchId ? { branchId } : {}) : Promise.resolve(null),
    ]);
    if (my !== token) return;

    if (meRes.status === 'rejected') {
      if (silent) return;
      body.innerHTML = `<div class="card">${window.UI.emptyStateHtml({
        icon: 'alert', title: 'Could not load your stats', message: meRes.reason?.message || 'Please try again.',
        actionHtml: '<button class="btn btn-secondary" id="dash-retry">Try again</button>',
      })}</div>`;
      document.getElementById('dash-retry').addEventListener('click', () => loadPersonal());
      return;
    }

    const shift = shiftRes.status === 'fulfilled' && shiftRes.value ? shiftRes.value.data.shift : null;
    renderPersonal(body, meRes.value.data, shift, st, dateQuery);
  }

  function renderPersonal(body, d, shift, st, dateQuery) {
    document.getElementById('dash-sub').textContent = `${RT.describeRange(st.from, st.to)} · your shift`;

    const s = d.sales || {};
    const inv = d.inventory || null;

    if (!canSelfSales && !inv) {
      body.innerHTML = `<div class="card">${window.UI.emptyStateHtml({
        icon: 'dashboard', title: 'Nothing to show here yet', message: 'Use the quick actions above to get to work.',
      })}</div>`;
      window.Permissions.applyPermissionGates(body, user);
      return;
    }

    const quiet = canSelfSales && !s.transactionCount;
    const tiles = [];
    if (canSelfSales) {
      tiles.push(RT.expandableKpi({ key: 'mySales', label: 'Transactions', value: RT.fmtNum(s.transactionCount || 0), icon: 'sales', tone: 'primary', sub: 'In the selected period' }));
      tiles.push(RT.kpi({ label: 'Net sales', value: fm(s.netSales || 0), icon: 'reports', tone: 'success' }));
      tiles.push(RT.kpi({ label: 'Average sale', value: fm(s.averageSale || 0) }));
      tiles.push(RT.kpi({ label: 'Discounts given', value: fm(s.totalDiscount || 0), tone: s.totalDiscount ? 'warning' : 'neutral' }));
    }
    if (inv) {
      tiles.push(RT.kpi({ label: 'Running low', value: RT.fmtNum(inv.lowStockCount || 0), icon: 'inventory', tone: inv.lowStockCount ? 'warning' : 'success' }));
      tiles.push(RT.kpi({ label: 'Out of stock', value: RT.fmtNum(inv.outOfStockCount || 0), tone: inv.outOfStockCount ? 'danger' : 'success' }));
    }

    body.innerHTML = `
      ${canSelfShift ? renderShiftStrip(shift) : ''}

      ${canSelfSales ? `
      <section class="takings">
        <div>
          <div class="takings-label">My net sales</div>
          <div class="takings-value">${fm(s.netSales || 0)}</div>
          <div class="takings-meta">
            <span><b>${RT.fmtNum(s.transactionCount || 0)}</b> sales</span>
            <span><b>${fm(s.averageSale || 0)}</b> average</span>
            ${quiet ? `<span>No sales in ${esc(RT.describeRange(st.from, st.to))}. Try a wider range above.</span>` : ''}
          </div>
        </div>
        <div>
          <div class="takings-split-title">How I collected it</div>
          <div id="me-pay-split"></div>
        </div>
      </section>` : ''}

      <div class="kpi-grid" id="dash-personal-kpi-grid">${tiles.join('')}</div>

      ${canSelfSales ? RT.drilldownPanelHtml('personal-drilldown') : ''}

      ${canSelfSales ? `
      <div class="chart-grid g-1-1">
        ${RT.chartCard({ id: 'me-pay', title: 'My payment mix', subtitle: 'This period' })}
        ${RT.chartCard({ id: 'me-products', title: 'What I sold most', subtitle: 'Top 5 by revenue' })}
      </div>
      <div class="card">
        <div class="card-header"><h3>My recent sales</h3><span class="text-xs text-muted">Tap a row for full details</span></div>
        <div class="table-wrap flat">
          <table class="table">
            <thead><tr><th>Receipt</th><th>Date &amp; time</th><th>Customer</th><th class="num">Total</th><th>Status</th></tr></thead>
            <tbody id="my-recent-sales-body">${renderRecentSalesRows(d.recentSales)}</tbody>
          </table>
        </div>
      </div>` : ''}
    `;

    if (canSelfSales) {
      CH.stackbar(document.getElementById('me-pay-split'), {
        segments: (s.paymentBreakdown || []).map((x) => ({ label: RT.methodMeta(x.method).label, value: x.total, color: RT.methodMeta(x.method).color })),
        format: RT.money0, emptyText: 'Payments will show up here as you make sales.',
      });
      CH.donut(document.getElementById('me-pay'), {
        data: (s.paymentBreakdown || []).map((x) => ({ label: RT.methodMeta(x.method).label, value: x.total, color: RT.methodMeta(x.method).color })),
        format: RT.money0, tipFormat: fm, centerLabel: 'Collected', ariaLabel: 'My payment mix',
      });
      CH.hbar(document.getElementById('me-products'), {
        data: (s.topProducts || []).map((x) => ({ label: x.name, value: x.revenue, sub: `${RT.fmtNum(x.quantity)} sold` })),
        format: RT.money0, valueLabel: 'Revenue', ranked: true, emptyText: 'Nothing sold in this period.',
      });

      document.getElementById('my-recent-sales-body').querySelectorAll('[data-sale-id]').forEach((tr) => {
        tr.addEventListener('click', () => RT.openSaleDetailModal(tr.dataset.saleId));
      });

      // Expandable "Transactions" tile -> shared drill-down panel, backed
      // by GET /sales. The backend now force-scopes cashierId to this
      // user for anyone without reports.view, so this always shows only
      // the caller's own sales no matter what branchId/dates are passed.
      RT.bindDrilldown(
        document.getElementById('dash-personal-kpi-grid'),
        document.getElementById('personal-drilldown'),
        () => ({ ...dateQuery, ...(window.AppShell.getActiveBranchId() ? { branchId: window.AppShell.getActiveBranchId() } : {}) })
      );
    }

    window.Permissions.applyPermissionGates(body, user);
  }

  function renderShiftStrip(shift) {
    if (shift) {
      return `
        <div class="shift-banner open" style="margin-bottom: var(--space-4)">
          <span>${window.Icons.get('check')} Shift open since ${window.UI.formatDateTime(shift.openedAt)} - ${esc(shift.registerId?.name || 'Register')}</span>
          <a class="btn btn-secondary btn-sm" href="sales.html">Manage in Sales</a>
        </div>`;
    }
    return `
      <div class="shift-banner closed" style="margin-bottom: var(--space-4)">
        <span>${window.Icons.get('alert')} No open shift - open one before taking cash payments</span>
        <a class="btn btn-primary btn-sm" href="sales.html" data-requires-permission="shifts.open">Open a shift</a>
      </div>`;
  }

  function renderRecentSalesRows(rows) {
    if (!rows || !rows.length) {
      return `<tr><td colspan="5">${window.UI.emptyStateHtml({ icon: 'sales', title: 'No sales in this period' })}</td></tr>`;
    }
    return rows.map((r) => `
      <tr data-sale-id="${r.id}" class="drilldown-row">
        <td class="cell-primary">${esc(r.receiptNumber)}</td>
        <td class="text-sm">${window.UI.formatDateTime(r.createdAt)}</td>
        <td class="text-sm">${r.customerName ? esc(r.customerName) : '<span class="text-muted">Walk-in</span>'}</td>
        <td class="font-semibold">${fm(r.total)}</td>
        <td>${RT.paymentStatusBadge(r.paymentStatus)}</td>
      </tr>
    `).join('');
  }

  /* ------------------------------------------------------------------ *
   * First-run checklist (owners/admins only, hides itself once staff exist)
   * ------------------------------------------------------------------ */
  async function loadSetupChecklist() {
    if (!window.Permissions.can(user, 'employees.create')) return;
    const [b, e] = await Promise.allSettled([
      window.Api.get('/branches', { page: 1, limit: 1 }),
      window.Api.get('/employees', { page: 1, limit: 1 }),
    ]);
    const branchCount = b.status === 'fulfilled' ? b.value.data.total : 0;
    const staffAdded = Math.max((e.status === 'fulfilled' ? e.value.data.total : 0) - 1, 0);
    if (staffAdded > 0) return;

    const items = [
      { done: true, label: 'Create your business account', sub: 'Done during sign-up' },
      { done: branchCount > 1, label: 'Add another branch (optional)', sub: `${branchCount} branch${branchCount === 1 ? '' : 'es'} so far`, href: 'branches.html' },
      { done: false, label: 'Add your first employee', sub: 'Share the Business ID, their code and PIN so they can log in', href: 'employees.html' },
    ];
    document.getElementById('setup-slot').innerHTML = `
      <div class="card" style="margin-bottom: var(--space-6)">
        <div class="card-header"><h2>Get your shop ready</h2></div>
        <div class="card-body">
          <ul class="setup-list">
            ${items.map((i) => `
              <li>
                <span class="setup-dot ${i.done ? 'done' : ''}">${i.done ? window.Icons.get('check') : ''}</span>
                <span style="flex:1"><div class="${i.done ? '' : 'font-semibold'}">${esc(i.label)}</div><div class="text-xs text-muted">${esc(i.sub)}</div></span>
                ${i.href ? `<a href="${i.href}" class="btn btn-secondary btn-sm">Open</a>` : ''}
              </li>`).join('')}
          </ul>
        </div>
      </div>`;
  }

  /* ------------------------------------------------------------------ *
   * Employee login card (unchanged behaviour)
   * ------------------------------------------------------------------ */
  async function ensureBusinessId() {
    const fromUser = window.AppShell.getUser()?.businessId;
    if (fromUser) return String(fromUser);
    try {
      const { data } = await window.Api.get('/auth/me');
      return data?.user?.businessId ? String(data.user.businessId) : '';
    } catch {
      return '';
    }
  }

  function loginLink() {
    const url = new URL('login.html', window.location.href);
    url.search = '';
    url.searchParams.set('tab', 'pin');
    if (businessId) url.searchParams.set('businessId', businessId);
    return url.toString();
  }

  function bindLoginCard() {
    const copyId = document.getElementById('copy-business-id');
    const copyLink = document.getElementById('copy-login-link');
    if (copyId) copyId.addEventListener('click', () => RT.copyText(businessId, 'Business ID copied'));
    if (copyLink) copyLink.addEventListener('click', () => RT.copyText(loginLink(), 'Login link copied'));
  }

  function loginCard() {
    return `
      <div class="card" style="margin-bottom: var(--space-6)" data-requires-permission="employees.create">
        <div class="card-header"><h2>Employee login details</h2></div>
        <div class="card-body">
          <p class="text-secondary text-sm" style="margin-bottom: var(--space-4)">
            Staff who log in with a PIN need three things: your <strong>Business ID</strong>, their
            <strong>employee code</strong>, and their <strong>PIN</strong>. The code and PIN are set when you
            add the employee - you'll get a shareable summary right after.
          </p>
          <div style="display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:var(--space-4)">
            <div style="min-width:0">
              <div class="text-xs text-muted">Business ID</div>
              <div class="font-semibold" style="font-family:monospace; word-break:break-all">
                ${businessId ? esc(businessId) : '<span class="text-muted">Unavailable - refresh the page</span>'}
              </div>
            </div>
            <div style="display:flex; gap:var(--space-2); flex-wrap:wrap">
              <button class="btn btn-secondary btn-sm" id="copy-business-id" ${businessId ? '' : 'disabled'}>Copy ID</button>
              <button class="btn btn-secondary btn-sm" id="copy-login-link" ${businessId ? '' : 'disabled'}>Copy login link</button>
              <a href="employees.html" class="btn btn-primary btn-sm">Manage employees</a>
            </div>
          </div>
        </div>
      </div>`;
  }
})();