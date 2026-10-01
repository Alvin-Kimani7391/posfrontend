/**
 * admin-dashboard.js - platform-wide totals across EVERY business.
 * GET /admin/overview?from&to
 */
(function () {
  const RT = window.ReportTools, CH = window.Charts;
  const esc = window.UI.escapeHtml, fm = (n) => window.UI.formatMoney(n);
  let el, days = 30, token = 0;

  document.addEventListener('DOMContentLoaded', () => {
    el = window.AdminShell.mount({ title: 'Overview' });
    if (!el) return;
    el.innerHTML = `
      <div class="page-header">
        <div><h1>Platform overview</h1><p id="ov-sub">Every business on the platform, combined.</p></div>
        <div class="page-actions" style="display:flex;gap:var(--space-2)">
          <select class="select" id="ov-range" style="width:auto">
            <option value="1">Today</option><option value="7">Last 7 days</option>
            <option value="30" selected>Last 30 days</option><option value="90">Last 90 days</option><option value="365">Last 12 months</option>
          </select>
          <button class="btn btn-secondary btn-sm" id="ov-refresh">Refresh</button>
        </div>
      </div>
      <div id="ov-body"></div>`;
    document.getElementById('ov-range').addEventListener('change', (e) => { days = Number(e.target.value); load(); });
    document.getElementById('ov-refresh').addEventListener('click', load);
    load();
    setInterval(() => { if (!document.hidden && days === 1) load(true); }, 60000);
  });

  function range() {
    const to = new Date(); const from = new Date();
    from.setDate(from.getDate() - (days - 1)); from.setHours(0, 0, 0, 0);
    return { from: from.toISOString(), to: to.toISOString() };
  }

  async function load(silent) {
    const body = document.getElementById('ov-body'), my = ++token;
    if (!silent) body.innerHTML = '<div class="kpi-grid">' + '<div class="kpi"><div class="skeleton" style="height:12px;width:50%"></div><div class="skeleton" style="height:28px;width:70%;margin-top:14px"></div></div>'.repeat(4) + '</div>';
    try {
      const { data } = await window.Api.get('/admin/overview', range());
      if (my !== token) return;
      render(body, data);
    } catch (err) {
      if (silent || my !== token) return;
      body.innerHTML = `<div class="card">${window.UI.emptyStateHtml({ icon: 'alert', title: 'Could not load overview', message: err.message, actionHtml: '<button class="btn btn-secondary" id="ov-retry">Try again</button>' })}</div>`;
      document.getElementById('ov-retry').addEventListener('click', () => load());
    }
  }

  function render(body, d) {
    const t = d.totals || {}, s = d.sales || {};
    const avg = s.transactions ? s.netSales / s.transactions : 0;
    document.getElementById('ov-sub').textContent = `${RT.fmtNum(t.businesses || 0)} businesses · ${RT.describeRange ? RT.describeRange(new Date(range().from), new Date(range().to)) : ''}`;
    body.innerHTML = `
      <section class="takings">
        <div>
          <div class="takings-label">Total net sales (all businesses)</div>
          <div class="takings-value">${fm(s.netSales || 0)}</div>
          <div class="takings-meta">
            <span><b>${RT.fmtNum(s.transactions || 0)}</b> sales</span>
            <span><b>${fm(avg)}</b> average</span>
            <span><b>${fm(s.totalRefunds || 0)}</b> refunded</span>
            <span><b>${fm(s.totalTax || 0)}</b> tax</span>
          </div>
        </div>
        <div><div class="takings-split-title">How the money came in</div><div id="ov-pay"></div></div>
      </section>

      <div class="kpi-grid">
        ${RT.kpi({ label: 'Businesses', value: RT.fmtNum(t.businesses || 0), icon: 'store', tone: 'primary', sub: `${RT.fmtNum(t.activeBusinesses || 0)} active` })}
        ${RT.kpi({ label: 'Suspended', value: RT.fmtNum(t.suspendedBusinesses || 0), icon: 'alert', tone: t.suspendedBusinesses ? 'danger' : 'success', sub: 'Blocked from logging in' })}
        ${RT.kpi({ label: 'Employees', value: RT.fmtNum(t.employees || 0), icon: 'employees', tone: 'info', sub: 'Across all businesses' })}
        ${RT.kpi({ label: 'Branches', value: RT.fmtNum(t.branches || 0), icon: 'branches', tone: 'neutral' })}
        ${RT.kpi({ label: 'Products', value: RT.fmtNum(t.products || 0), icon: 'products', tone: 'neutral' })}
        ${RT.kpi({ label: 'New businesses', value: RT.fmtNum(t.newBusinesses || 0), icon: 'plus', tone: 'success', sub: 'In this period' })}
      </div>

      <div class="chart-grid trend-chart-card">${RT.chartCard({ id: 'ov-trend', title: 'Sales trend', subtitle: 'Net sales per day, all businesses' })}</div>

      <div class="chart-grid g-1-1">
        ${RT.chartCard({ id: 'ov-top', title: 'Top businesses', subtitle: 'By net sales in this period' })}
        <section class="card chart-card">
          <header class="chart-card-head"><div><h3>Newest businesses</h3><p>Latest sign-ups</p></div><a class="btn btn-secondary btn-sm" href="admin-businesses.html">All businesses</a></header>
          <div class="table-wrap flat"><table class="table"><thead><tr><th>Business</th><th>Owner</th><th>Joined</th><th>Status</th></tr></thead><tbody>
            ${(d.recentBusinesses || []).map((b) => `<tr><td class="cell-primary"><a href="admin-businesses.html?open=${esc(b._id)}">${esc(b.name)}</a></td><td class="text-sm">${esc(b.ownerName || '-')}</td><td class="text-sm">${window.UI.timeAgo(b.createdAt)}</td><td>${window.AdminShell.statusBadge(b.status)}</td></tr>`).join('') || '<tr><td colspan="4" class="text-muted">No sign-ups yet</td></tr>'}
          </tbody></table></div>
        </section>
      </div>`;

    CH.stackbar(document.getElementById('ov-pay'), {
      segments: (s.paymentBreakdown || []).map((x) => ({ label: RT.methodMeta(x.method).label, value: x.total, color: RT.methodMeta(x.method).color })),
      format: RT.money0, emptyText: 'Payments will show up here as businesses make sales.',
    });
    const trend = d.trend || [];
    CH.bar(document.getElementById('ov-trend'), {
      labels: trend.map((x) => RT.trendLabel(x.date, days)),
      series: [{ name: 'Net sales', values: trend.map((x) => x.netSales), color: 'var(--color-primary)' }],
      format: CH.compact, tipFormat: fm, height: 360, ariaLabel: 'Platform sales trend', emptyText: 'No sales in this period.',
    });
    CH.hbar(document.getElementById('ov-top'), {
      data: (d.topBusinesses || []).map((b) => ({ label: b.name, value: b.netSales, sub: `${RT.fmtNum(b.transactions)} sales` })),
      format: RT.money0, valueLabel: 'Net sales', ranked: true, emptyText: 'No sales in this period.',
    });
  }
})();