/**
 * wholesale-reports.js - "How is wholesale doing?" in plain words, from GET /reports/wholesale (all amounts KES).
 *   1. Wholesale vs Retail side by side   2. "Selling at retail earned you extra" card
 *   3. Profit per day bars                4. Product table (search, CSV)   5. Stock moved to the shop (expected profit)
 */
(function () {
  const W = window.WS;
  const state = { preset: '30', from: '', to: '', warehouseId: '', q: '' };
  let contentEl; let data = null; let whs = [];
  document.addEventListener('DOMContentLoaded', init);

  const PRESETS = [['0', 'Today'], ['7', 'Last 7 days'], ['30', 'Last 30 days'], ['90', 'Last 90 days'], ['m', 'This month'], ['c', 'Custom dates']];
  function range() {
    if (state.preset === 'c') return { from: state.from ? new Date(`${state.from}T00:00:00`).toISOString() : undefined, to: state.to ? new Date(`${state.to}T23:59:59`).toISOString() : undefined };
    const to = new Date(); const from = new Date(); from.setHours(0, 0, 0, 0);
    if (state.preset === 'm') from.setDate(1); else from.setDate(from.getDate() - Number(state.preset));
    return { from: from.toISOString(), to: to.toISOString() };
  }
  const pct = (n) => `${(Number(n) || 0).toLocaleString('en-KE', { maximumFractionDigits: 1 })}%`;

  async function init() {
    contentEl = window.AppShell.mount({ title: 'Wholesale reports' });
    if (!contentEl) return;
    try { await window.AppShell.whenProfileReady?.(); } catch { /* cached */ }
    if (!W.on('multiWarehouse')) { contentEl.innerHTML = W.subnav('reports') + W.featureOff(); return; }
    if (!W.can('reports.profit')) { contentEl.innerHTML = W.subnav('reports') + `<div class="card"><div class="card-body">${window.UI.emptyStateHtml({ icon: 'lock', title: 'No access', message: 'Profit reports are for owners, managers and accountants.' })}</div></div>`; return; }
    W.warehouses().then((l) => { whs = l; const sel = contentEl.querySelector('#r-wh'); if (sel) sel.innerHTML = W.whOptions(whs, state.warehouseId, { blank: 'All warehouses' }); }).catch(() => {});
    contentEl.innerHTML = W.subnav('reports') + W.header('Wholesale reports', 'Profit from wholesale and retail, and what moving stock to the shop earns you.', `
      <button class="btn btn-secondary" id="r-csv">Export CSV</button>`) + `
      <div class="card" style="margin-bottom:var(--space-4)"><div class="ws-toolbar" style="border:0">
        <select class="select" id="r-preset">${PRESETS.map(([v, l]) => `<option value="${v}" ${state.preset === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <span id="r-dates" style="display:none;gap:var(--space-2);align-items:center"><input class="input" type="date" id="r-from" /> to <input class="input" type="date" id="r-to" /></span>
        <select class="select" id="r-wh"><option value="">All warehouses</option></select>
      </div></div><div id="r-body">${skeleton()}</div>`;
    const $ = (id) => contentEl.querySelector(id);
    $('#r-preset').addEventListener('change', (e) => { state.preset = e.target.value; $('#r-dates').style.display = state.preset === 'c' ? 'flex' : 'none'; if (state.preset !== 'c') load(); });
    $('#r-from').addEventListener('change', (e) => { state.from = e.target.value; if (state.from && state.to) load(); });
    $('#r-to').addEventListener('change', (e) => { state.to = e.target.value; if (state.from && state.to) load(); });
    $('#r-wh').addEventListener('change', (e) => { state.warehouseId = e.target.value; load(); });
    $('#r-csv').addEventListener('click', exportCsv);
    window.AppShell.onBranchChange?.(() => load());
    load();
  }

  const skeleton = () => `<div class="kpi-grid">${'<div class="kpi"><div class="kpi-label">&nbsp;</div><div class="kpi-value">…</div></div>'.repeat(4)}</div>`;

  async function load() {
    const box = contentEl.querySelector('#r-body');
    box.innerHTML = skeleton();
    try {
      const r = range();
      const res = await window.Api.get('/reports/wholesale', { branchId: window.AppShell.getActiveBranchId() || undefined, from: r.from, to: r.to, warehouseId: state.warehouseId || undefined, top: 100 });
      data = res.data; draw();
    } catch (e) { box.innerHTML = `<div class="card"><div class="card-body">${window.UI.emptyStateHtml({ icon: 'alert', title: 'Could not load the report', message: e.message })}</div></div>`; }
  }

  function channelCard(title, c, tone) {
    c = c || {};
    return `<div class="card rp-ch rp-${tone}"><div class="card-body">
      <div class="rp-ch-h"><span class="badge ${tone === 'ws' ? 'badge-info' : 'badge-neutral'}">${title}</span><small>${W.num(c.sales || 0)} sales</small></div>
      <div class="rp-big">${W.kes(c.profit)}<small>profit</small></div>
      <dl class="mk-kv"><div><dt>Sales value</dt><dd>${W.kes(c.revenue)}</dd></div><div><dt>Cost of goods</dt><dd>${W.kes(c.costOfGoods)}</dd></div>
        <div><dt>Margin</dt><dd>${pct(c.marginPercent)}</dd></div><div><dt>Units sold</dt><dd>${W.num(c.units)}</dd></div>
        <div><dt>Still unpaid</dt><dd style="${c.outstanding > 0 ? 'color:var(--color-warning)' : ''}">${W.kes(c.outstanding)}</dd></div></dl></div></div>`;
  }

  function draw() {
    const d = data; const box = contentEl.querySelector('#r-body'); const t = d.totals || {}; const rp = d.retailPremium || {}; const tr = d.transfers || { totals: {}, byProduct: [] };
    const trend = d.trend || []; const max = Math.max(1, ...trend.map((x) => Math.max(x.wholesaleProfit, x.retailProfit, 0)));
    const q = state.q.trim().toLowerCase();
    const rows = (d.byProduct || []).filter((p) => !q || String(p.name || '').toLowerCase().includes(q));
    box.innerHTML = `
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
          <p class="rp-sentence">Retail sales of products that also have a wholesale price brought in
            <b>${W.kes(rp.comparableRevenue)}</b>. Sold at wholesale, the same goods would have brought in <b>${W.kes(rp.wholesaleValueOfSameUnits)}</b>.
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
        <div class="ws-toolbar"><h3 style="margin:0" class="grow">Profit by product</h3><input class="input" id="r-q" placeholder="Search product…" value="${W.esc(state.q)}" style="max-width:240px" /></div>
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
      </div></div>`;
    const qi = box.querySelector('#r-q');
    qi.addEventListener('input', () => { state.q = qi.value; const pos = qi.selectionStart; draw(); const n = contentEl.querySelector('#r-q'); n.focus(); n.setSelectionRange(pos, pos); });
  }

  function exportCsv() {
    if (!data) return;
    const rows = [['Product', 'Units', 'Sales value', 'Cost of goods', 'Profit', 'Margin %', 'Wholesale profit', 'Retail profit', 'Retail extra vs wholesale']]
      .concat((data.byProduct || []).map((p) => [p.name, p.units, p.revenue, p.costOfGoods, p.profit, p.marginPercent, p.wholesale.profit, p.retail.profit, p.retailPremium]));
    const csv = rows.map((r) => r.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([`﻿${csv}`], { type: 'text/csv' }));
    a.download = `wholesale-report-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
  }
})();
