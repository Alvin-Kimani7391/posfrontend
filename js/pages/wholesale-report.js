/**
 * wholesale-report.js - the "Wholesale" tab INSIDE reports.html (replaces the stand-alone wholesale-reports.html,
 * which now redirects to reports.html?tab=wholesale). reports.js loads GET /reports/wholesale with the shared date +
 * branch filter and calls   WholesaleReport.render(el, data, { query })   to draw it; the return value feeds the page's
 * Export CSV button, so wholesale exports like every other report.
 *
 * "How is wholesale doing?" in plain words (all amounts KES):
 *   1 Totals    2 Wholesale vs Retail side by side    3 "Is selling at retail worth it?"
 *   4 Profit per day    5 Profit by product (search)    6 Stock moved to the shop floor (expected profit)
 * An extra warehouse filter inside the tab re-runs the report for one warehouse.
 */
(function (window) {
  'use strict';
  const W = window.WS;
  const pct = (n) => `${(Number(n) || 0).toLocaleString('en-KE', { maximumFractionDigits: 1 })}%`;

  function render(el, initial, ctx = {}) {
    const st = { data: initial, q: '', warehouseId: '', whs: [] };

    const channelCard = (title, c, tone) => {
      c = c || {};
      return `<div class="card rp-ch rp-${tone}"><div class="card-body">
        <div class="rp-ch-h"><span class="badge ${tone === 'ws' ? 'badge-info' : 'badge-neutral'}">${title}</span><small>${W.num(c.sales || 0)} sales</small></div>
        <div class="rp-big">${W.kes(c.profit)}<small>profit</small></div>
        <dl class="mk-kv"><div><dt>Sales value</dt><dd>${W.kes(c.revenue)}</dd></div><div><dt>Cost of goods</dt><dd>${W.kes(c.costOfGoods)}</dd></div>
          <div><dt>Margin</dt><dd>${pct(c.marginPercent)}</dd></div><div><dt>Units sold</dt><dd>${W.num(c.units)}</dd></div>
          <div><dt>Still unpaid</dt><dd style="${c.outstanding > 0 ? 'color:var(--color-warning)' : ''}">${W.kes(c.outstanding)}</dd></div></dl></div></div>`;
    };

    function draw() {
      const d = st.data || {}; const t = d.totals || {}; const rp = d.retailPremium || {};
      const tr = d.transfers || { totals: {}, byProduct: [] }; const trend = d.trend || [];
      const max = Math.max(1, ...trend.map((x) => Math.max(x.wholesaleProfit, x.retailProfit, 0)));
      const q = st.q.trim().toLowerCase();
      const rows = (d.byProduct || []).filter((p) => !q || String(p.name || '').toLowerCase().includes(q));
      el.innerHTML = `
        <div class="wr-bar">
          <label class="inline-field"><span>Warehouse</span><select class="select" id="wr-wh">${W.whOptions(st.whs, st.warehouseId, { blank: 'All warehouses' })}</select></label>
          <span class="wr-note">Dates and branch follow the filter above. Profit from wholesale and retail, and what moving stock to the shop earns you.</span>
        </div>
        <div class="kpi-grid">
          <div class="kpi"><div class="kpi-label">Total sales value</div><div class="kpi-value">${W.kes(t.revenue)}</div><div class="kpi-foot">before tax</div></div>
          <div class="kpi kpi-success"><div class="kpi-label">Total profit</div><div class="kpi-value">${W.kes(t.profit)}</div><div class="kpi-foot">${pct(t.marginPercent)} margin</div></div>
          <div class="kpi"><div class="kpi-label">Cost of goods</div><div class="kpi-value">${W.kes(t.costOfGoods)}</div></div>
          <div class="kpi kpi-warning"><div class="kpi-label">Customers owe you</div><div class="kpi-value">${W.kes(((d.channels || {}).WHOLESALE || {}).outstanding)}</div><div class="kpi-foot">unpaid wholesale invoices</div></div>
        </div>
        <div class="ws-grid ws-grid-2" style="margin-top:var(--space-4)">${channelCard('Wholesale', (d.channels || {}).WHOLESALE, 'ws')}${channelCard('Retail', (d.channels || {}).RETAIL, 'rt')}</div>

        <div class="card" style="margin-top:var(--space-4)"><div class="card-body">
          <div class="ws-section-title"><h3>Is selling at retail worth it?</h3></div>
          ${rp.wholesaleValueOfSameUnits > 0 ? `
            <p class="rp-sentence">Retail sales of products that also have a wholesale price brought in <b>${W.kes(rp.comparableRevenue)}</b>. Sold at wholesale, the same goods would have brought in <b>${W.kes(rp.wholesaleValueOfSameUnits)}</b>.
              That is <b class="rp-good">${W.kes(rp.extraProfitFromRetailPrice)} extra</b> (${pct(rp.upliftPercentOverWholesale)} more) from selling at retail.</p>
            <div class="rp-compare">
              <div><small>Profit at retail price</small><b>${W.kes(rp.profitAtRetail)}</b></div>
              <div><small>Profit if sold at wholesale</small><b>${W.kes(rp.profitIfSoldAtWholesale)}</b></div>
              <div><small>Extra from retail</small><b class="rp-good">${W.kes(rp.extraProfitFromRetailPrice)}</b></div>
            </div>` : '<div class="ws-muted-row">No retail sales with a wholesale price in this period yet. Once you move stock to the shop and sell it, the comparison appears here.</div>'}
        </div></div>

        <div class="card" style="margin-top:var(--space-4)"><div class="card-body">
          <div class="ws-section-title"><h3>Profit per day</h3><div class="ws-legend" style="margin:0"><span><b style="background:var(--color-primary)"></b>Wholesale</span><span><b style="background:var(--color-info)"></b>Retail</span></div></div>
          ${trend.length ? `<div class="ws-bars rp-bars">${trend.map((x) => `<div class="ws-bar" title="${x.date}: wholesale ${W.kes(x.wholesaleProfit)} · retail ${W.kes(x.retailProfit)}">
            <div class="rp-pair"><i style="height:${Math.max(2, Math.round(Math.max(x.wholesaleProfit, 0) / max * 100))}%;background:var(--color-primary)"></i><i style="height:${Math.max(2, Math.round(Math.max(x.retailProfit, 0) / max * 100))}%;background:var(--color-info)"></i></div>
            <small>${x.date.slice(5)}</small></div>`).join('')}</div>` : '<div class="ws-muted-row">No sales in this period.</div>'}
        </div></div>

        <div class="card" style="margin-top:var(--space-4)">
          <div class="ws-toolbar"><h3 style="margin:0" class="grow">Profit by product</h3><input class="input" id="wr-q" placeholder="Search product…" value="${W.esc(st.q)}" style="max-width:240px" /></div>
          <div class="table-wrap"><table class="table"><thead><tr><th>Product</th><th>Units</th><th>Sales value</th><th>Profit</th><th>Margin</th><th>Wholesale profit</th><th>Retail profit</th></tr></thead><tbody>
            ${rows.map((p) => `<tr><td class="cell-primary">${W.esc(p.name)}</td><td>${W.num(p.units)}</td><td>${W.kes(p.revenue)}</td><td><strong>${W.kes(p.profit)}</strong></td><td>${pct(p.marginPercent)}</td><td>${W.kes(p.wholesale.profit)}</td><td>${W.kes(p.retail.profit)}</td></tr>`).join('') || W.emptyRow(7, 'No products sold in this period')}
          </tbody></table></div>
        </div>

        <div class="card" style="margin-top:var(--space-4)"><div class="card-body">
          <div class="ws-section-title"><h3>Stock moved to the shop floor</h3></div>
          ${tr.totals.units > 0 ? `
            <p class="rp-sentence">You moved <b>${W.num(tr.totals.units)}</b> units from the warehouse to the shop. They cost <b>${W.kes(tr.totals.costValue)}</b> and will bring in
              <b>${W.kes(tr.totals.retailValue)}</b> at the new retail prices: an expected profit of <b class="rp-good">${W.kes(tr.totals.expectedProfit)}</b>.</p>
            <p class="field-hint">${W.esc(tr.totals.note || '')}</p>
            <div class="table-wrap"><table class="table"><thead><tr><th>Product</th><th>Units moved</th><th>Cost</th><th>Retail value</th><th>Expected profit</th><th>Extra vs wholesale</th></tr></thead><tbody>
              ${tr.byProduct.map((p) => `<tr><td class="cell-primary">${W.esc(p.name)}</td><td>${W.num(p.units)} ${W.esc(p.baseUnit || '')}</td><td>${W.kes(p.costValue)}</td><td>${W.kes(p.retailValue)}</td><td><strong>${W.kes(p.expectedProfit)}</strong></td><td>${W.kes(p.upliftOverWholesale)}</td></tr>`).join('')}
            </tbody></table></div>` : '<div class="ws-muted-row">No stock was moved to the shop in this period.</div>'}
        </div></div>
        <p class="field-hint" style="margin-top:var(--space-3)">Looking for what customers owe or what you owe suppliers? Open the <b>Customers owing</b> and <b>Suppliers owed</b> tabs, or the <a href="suppliers.html?tab=ageing">Suppliers hub</a>.</p>`;

      const qi = el.querySelector('#wr-q');
      qi.addEventListener('input', () => { st.q = qi.value; const pos = qi.selectionStart; draw(); const n = el.querySelector('#wr-q'); n.focus(); n.setSelectionRange(pos, pos); });
      el.querySelector('#wr-wh').addEventListener('change', async (e) => {
        st.warehouseId = e.target.value;
        el.style.opacity = '.55';
        try {
          const res = await window.Api.get('/reports/wholesale', { ...(ctx.query || {}), warehouseId: st.warehouseId || undefined, top: 100 });
          st.data = res && res.data !== undefined ? res.data : res;
        } catch (err) { window.UI.toast.error(err.message); }
        el.style.opacity = '1'; draw();
      });
    }

    W.warehouses().then((l) => { st.whs = l; const sel = el.querySelector('#wr-wh'); if (sel) sel.innerHTML = W.whOptions(l, st.warehouseId, { blank: 'All warehouses' }); }).catch(() => {});
    draw();

    // CSV for the page's Export button (re-read at click time so a warehouse change is included)
    return () => {
      const d = st.data || {};
      return {
        name: 'wholesale-report',
        sections: [
          { title: 'Profit by product', headers: ['Product', 'Units', 'Sales value', 'Cost of goods', 'Profit', 'Margin %', 'Wholesale profit', 'Retail profit', 'Retail extra vs wholesale'],
            rows: (d.byProduct || []).map((p) => [p.name, p.units, p.revenue, p.costOfGoods, p.profit, p.marginPercent, p.wholesale.profit, p.retail.profit, p.retailPremium]) },
          { title: 'Stock moved to the shop', headers: ['Product', 'Units moved', 'Cost', 'Retail value', 'Expected profit', 'Extra vs wholesale'],
            rows: ((d.transfers || {}).byProduct || []).map((p) => [p.name, p.units, p.costValue, p.retailValue, p.expectedProfit, p.upliftOverWholesale]) },
        ],
      };
    };
  }

  window.WholesaleReport = { render };
})(window);
