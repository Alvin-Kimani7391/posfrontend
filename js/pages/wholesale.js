/**
 * wholesale.js - Wholesale business dashboard: KPIs, 14-day revenue, receivables (customer credit), top customers,
 * warehouse stock, low stock, payables ageing, recent moves + the customisable wholesale settings.
 * Sales come from GET /sales (KES) and are filtered to channel WHOLESALE here.
 */
(function () {
  const W = window.WS;
  const state = { days: 30 };
  let contentEl, settings = {}, whs = [];
  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    contentEl = window.AppShell.mount({ title: 'Wholesale' });
    if (!contentEl) return;
    try { await window.AppShell.whenProfileReady?.(); } catch { /* cached */ }
    if (!W.on('multiWarehouse')) { contentEl.innerHTML = W.subnav('wholesale') + W.featureOff(); return; }
    contentEl.innerHTML = W.subnav('wholesale') + W.header('Wholesale dashboard', 'Sales, credit owed to you, warehouse stock and supplier payables in one place.', `
      <select class="select" id="d-days" style="width:auto"><option value="7">Last 7 days</option><option value="30" selected>Last 30 days</option><option value="90">Last 90 days</option></select>
      <a class="btn btn-primary" href="sales.html?mode=wholesale" data-requires-permission="sales.create">${W.icon('sales')} New wholesale sale</a>
      <button class="btn btn-secondary" id="d-set" data-requires-permission="inventory.view">${W.icon('sliders')} Settings</button>`) + '<div id="d-body"><div class="ws-pad ws-muted-row">Loading…</div></div>';
    contentEl.querySelector('#d-days').addEventListener('change', (e) => { state.days = Number(e.target.value); load(); });
    contentEl.querySelector('#d-set').addEventListener('click', openSettings);
    contentEl.addEventListener('click', (e) => { const b = e.target.closest('[data-inv]'); if (b && window.InvoiceView) window.InvoiceView.open(b.dataset.inv); });
    window.Permissions.applyPermissionGates(contentEl, window.AppShell.getUser());
    window.AppShell.onBranchChange?.(() => load());
    load();
  }

  async function fetchSales(from, branchId) {
    const out = [];
    for (let page = 1; page <= 6; page++) {
      const { data } = await window.Api.get('/sales', { branchId, from: from.toISOString(), page, limit: 100 });
      out.push(...data.items); if (page >= data.pages) break;
    }
    return out.filter((s) => s.channel === 'WHOLESALE' && s.saleStatus !== 'CANCELLED');
  }
  const settle = (p) => p.then((v) => ({ v }), (e) => ({ e }));

  async function load() {
    const box = contentEl.querySelector('#d-body'); const branchId = window.AppShell.getActiveBranchId();
    const from = new Date(Date.now() - state.days * 86400000); from.setHours(0, 0, 0, 0);
    box.innerHTML = '<div class="ws-pad ws-muted-row">Loading…</div>';
    const canPay = W.can('purchases.view');
    const [sRes, wRes, lowRes, ageRes, mvRes, setRes] = await Promise.all([
      settle(fetchSales(from, branchId)), settle(W.warehouses(true)),
      settle(window.Api.get('/warehouse/stock', { branchId, lowStockOnly: true, limit: 8 })),
      canPay ? settle(window.Api.get('/supplier-finance/ageing')) : Promise.resolve({ e: 'skip' }),
      settle(window.Api.get('/warehouse/transfers', { limit: 5 })), settle(W.settings()),
    ]);
    settings = setRes.v || {}; whs = wRes.v || [];
    const sales = sRes.v || [];
    const rev = sales.reduce((s, x) => s + x.total, 0), got = sales.reduce((s, x) => s + x.amountPaid, 0);
    const owing = sales.filter((s) => s.balance > 0);
    const owed = owing.reduce((s, x) => s + x.balance, 0);
    const overdue = owing.filter((s) => s.dueDate && new Date(s.dueDate) < new Date());
    const overdueAmt = overdue.reduce((s, x) => s + x.balance, 0);
    const profit = sales.reduce((s, x) => s + (x.items || []).reduce((t, i) => t + ((i.unitPrice - (i.costPriceSnapshot || 0)) * i.quantity - (i.discount || 0)), 0), 0);
    const showProfit = W.can('reports.profit');

    const byDay = new Map(); for (let i = Math.min(state.days, 14) - 1; i >= 0; i--) byDay.set(W.dayKey(Date.now() - i * 86400000), 0);
    sales.forEach((s) => { const k = W.dayKey(s.soldAt || s.createdAt); if (byDay.has(k)) byDay.set(k, byDay.get(k) + s.total); });
    const max = Math.max(1, ...byDay.values());
    const cust = new Map(); sales.forEach((s) => { const id = s.customerId?._id || 'walkin'; const c = cust.get(id) || { name: s.customerId?.name || 'Walk-in', total: 0, owed: 0, n: 0 }; c.total += s.total; c.owed += Math.max(0, s.balance); c.n++; cust.set(id, c); });
    const top = [...cust.values()].sort((a, b) => b.total - a.total).slice(0, 6);
    const age = ageRes.v?.data?.totals;
    const stockUnits = whs.reduce((s, w) => s + (w.stock?.units || 0), 0);

    box.innerHTML = `
      <div class="ws-actions">
        <a class="ws-action" href="sales.html?mode=wholesale" data-requires-permission="sales.create"><span class="icon">${W.icon('sales')}</span>Sell wholesale</a>
        <button class="ws-action" id="q-move" data-requires-permission="inventory.transfer"><span class="icon">${W.icon('arrowRight')}</span>Move stock to shop</button>
        <a class="ws-action" href="purchases.html" data-requires-permission="purchases.view"><span class="icon">${W.icon('bag')}</span>Purchases</a>
        <a class="ws-action" href="payables.html" data-requires-permission="purchases.view"><span class="icon">${W.icon('wallet')}</span>Pay suppliers</a>
        <a class="ws-action" href="warehouses.html"><span class="icon">${W.icon('inventory')}</span>Warehouses</a></div>
      ${sRes.e ? `<div class="ws-warn">Could not load wholesale sales: ${W.esc(sRes.e.message)}</div>` : ''}
      <div class="kpi-grid">
        <div class="kpi kpi-success"><div class="kpi-label">Wholesale sales</div><div class="kpi-value">${W.kes(rev)}</div><div class="kpi-foot">${sales.length} invoices</div></div>
        <div class="kpi"><div class="kpi-label">Collected</div><div class="kpi-value">${W.kes(got)}</div><div class="kpi-foot">${rev ? Math.round((got / rev) * 100) : 0}% of sales</div></div>
        <div class="kpi kpi-warning"><div class="kpi-label">Owed by customers</div><div class="kpi-value">${W.kes(owed)}</div><div class="kpi-foot">${owing.length} open invoices</div></div>
        <div class="kpi kpi-danger"><div class="kpi-label">Overdue</div><div class="kpi-value">${W.kes(overdueAmt)}</div><div class="kpi-foot">${overdue.length} invoices past due</div></div>
        ${showProfit ? `<div class="kpi kpi-success"><div class="kpi-label">Gross profit</div><div class="kpi-value">${W.kes(profit)}</div><div class="kpi-foot">before expenses</div></div>` : ''}
        <div class="kpi"><div class="kpi-label">Warehouse stock</div><div class="kpi-value">${W.num(stockUnits)}</div><div class="kpi-foot">${whs.length} warehouse${whs.length === 1 ? '' : 's'}</div></div>
        ${age ? `<div class="kpi kpi-warning"><div class="kpi-label">Owed to suppliers</div><div class="kpi-value">${W.kes(age.total)}</div><div class="kpi-foot">${W.kes(age.days1to30 + age.days31to60 + age.days61to90 + age.over90)} overdue</div></div>` : ''}
      </div>
      <div class="ws-grid ws-grid-2" style="margin-bottom:var(--space-4)">
        <div class="card"><div class="ws-pad"><div class="ws-section-title"><h3>Daily wholesale sales</h3></div>
          <div class="ws-bars">${[...byDay].map(([k, v]) => `<div class="ws-bar" title="${k}: ${W.kes(v)}"><i style="height:${(v / max) * 100}%"></i><small>${k.slice(8)}</small></div>`).join('')}</div></div></div>
        <div class="card"><div class="ws-pad"><div class="ws-section-title"><h3>Top customers</h3></div>
          ${top.length ? `<table class="table"><thead><tr><th>Customer</th><th>Invoices</th><th>Bought</th><th>Owes</th></tr></thead><tbody>${top.map((c) => `<tr><td class="cell-primary">${W.esc(c.name)}</td><td>${c.n}</td><td>${W.kes(c.total)}</td><td style="${c.owed > 0 ? 'color:var(--color-warning);font-weight:600' : ''}">${c.owed > 0 ? W.kes(c.owed) : '—'}</td></tr>`).join('')}</tbody></table>` : '<div class="ws-muted-row">No wholesale sales in this period.</div>'}</div></div>
      </div>
      <div class="card" style="margin-bottom:var(--space-4)"><div class="ws-pad"><div class="ws-section-title"><h3>Warehouses</h3><a class="btn btn-ghost btn-sm" href="warehouses.html">Manage</a></div>
        <div class="ws-grid ws-grid-wh">${whs.length ? whs.map((w) => `<div class="ws-wh ${w.status === 'inactive' ? 'inactive' : ''}"><h4>${W.esc(w.name)} ${w.isDefault ? '<span class="badge badge-success">Default</span>' : ''}</h4>
          <div class="meta">${W.esc(w.branchId?.name || '')}</div><div class="nums"><div><b>${W.num(w.stock?.skus)}</b><span>products</span></div><div><b>${W.num(w.stock?.units)}</b><span>base units</span></div></div></div>`).join('') : '<div class="ws-muted-row">No warehouses yet.</div>'}</div></div></div>
      <div class="ws-grid ws-grid-2">
        <div class="card"><div class="ws-pad"><div class="ws-section-title"><h3>Overdue customer invoices</h3></div>
          ${overdue.length ? `<table class="table"><thead><tr><th>Receipt</th><th>Customer</th><th>Due</th><th>Balance</th><th></th></tr></thead><tbody>${overdue.sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate)).slice(0, 8).map((s) => `<tr><td class="cell-primary">${W.esc(s.receiptNumber)}</td><td class="text-sm">${W.esc(s.customerId?.name || '—')}</td><td class="text-sm" style="color:var(--color-danger)">${window.UI.formatDate(s.dueDate)}</td><td><strong>${W.kes(s.balance)}</strong></td><td class="actions"><button class="btn btn-ghost btn-sm" data-inv="${s._id}">Invoice</button></td></tr>`).join('')}</tbody></table>` : '<div class="ws-muted-row">Nothing overdue.</div>'}</div></div>
        <div class="card"><div class="ws-pad"><div class="ws-section-title"><h3>Low stock in warehouses</h3></div>
          ${lowRes.v?.data?.items?.length ? `<table class="table"><thead><tr><th>Product</th><th>Warehouse</th><th>Left</th></tr></thead><tbody>${lowRes.v.data.items.map((r) => `<tr><td class="cell-primary">${W.esc(r.productId?.name || '—')}</td><td class="text-sm">${W.esc(r.warehouseId?.name || '')}</td><td><span class="badge badge-warning">${W.num(r.quantity)} ${W.esc(r.productId?.unit || '')}</span></td></tr>`).join('')}</tbody></table>` : '<div class="ws-muted-row">Nothing running low.</div>'}</div></div>
        ${age ? `<div class="card"><div class="ws-pad"><div class="ws-section-title"><h3>Payables ageing</h3><a class="btn btn-ghost btn-sm" href="payables.html">Open</a></div>
          <div class="ws-stack">${[['current', 0], ['days1to30', 1], ['days31to60', 2], ['days61to90', 3], ['over90', 4]].map(([k, i]) => (age.total > 0 && age[k] > 0 ? `<i class="ws-age-${i}" style="width:${(age[k] / age.total) * 100}%"></i>` : '')).join('')}</div>
          <div class="ws-legend"><span><b class="ws-age-0"></b>Current ${W.kes(age.current)}</span><span><b class="ws-age-1"></b>1–30 ${W.kes(age.days1to30)}</span><span><b class="ws-age-2"></b>31–60 ${W.kes(age.days31to60)}</span><span><b class="ws-age-3"></b>61–90 ${W.kes(age.days61to90)}</span><span><b class="ws-age-4"></b>90+ ${W.kes(age.over90)}</span></div></div></div>` : ''}
        <div class="card"><div class="ws-pad"><div class="ws-section-title"><h3>Recent stock moves</h3><a class="btn btn-ghost btn-sm" href="warehouses.html">All</a></div>
          ${mvRes.v?.data?.items?.length ? `<table class="table"><thead><tr><th>Move</th><th>When</th><th>Items</th></tr></thead><tbody>${mvRes.v.data.items.map((t) => `<tr><td class="cell-primary">${W.esc(t.transferNumber)}</td><td class="text-sm">${window.UI.formatDate(t.createdAt)}</td><td>${(t.items || []).length}</td></tr>`).join('')}</tbody></table>` : '<div class="ws-muted-row">No moves yet.</div>'}</div></div>
      </div>`;
    box.querySelector('#q-move')?.addEventListener('click', () => W.openTransferModal({ onDone: load }));
    window.Permissions.applyPermissionGates(box, window.AppShell.getUser());
  }

  function openSettings() {
    const canEdit = W.can('warehouses.manage'); const dis = canEdit ? '' : 'disabled';
    const m = window.UI.openModal({ title: 'Wholesale settings', maxWidth: '520px',
      bodyHtml: `${canEdit ? '' : '<p class="text-sm text-muted">Only users who can manage warehouses can change these.</p>'}
        <div class="field"><label>Open the sale screen in</label><select class="select" id="st-mode" ${dis}><option value="WHOLESALE" ${settings.defaultMode !== 'RETAIL' ? 'selected' : ''}>Wholesale mode</option><option value="RETAIL" ${settings.defaultMode === 'RETAIL' ? 'selected' : ''}>Retail mode</option></select></div>
        <div class="field"><label>Default selling warehouse</label><select class="select" id="st-wh" ${dis}>${W.whOptions(whs.filter((w) => w.status !== 'inactive'), settings.defaultWarehouseId, { blank: 'Branch default' })}</select></div>
        <div class="field"><label>Default payment terms (days)</label><input class="input" id="st-days" type="number" min="0" max="365" value="${settings.defaultPaymentTermsDays ?? 0}" ${dis} /><span class="field-hint">Sets the due date on credit invoices.</span></div>
        <div class="field"><label><input type="checkbox" id="st-cust" ${settings.requireCustomerForWholesale ? 'checked' : ''} ${dis} /> Require a customer on every wholesale sale</label></div>
        <div class="field"><label><input type="checkbox" id="st-retail" ${settings.allowRetailFromWarehouse !== false ? 'checked' : ''} ${dis} /> Allow selling some warehouse products at retail (via stock moves)</label></div>
        <div class="field"><label><input type="checkbox" id="st-units" ${settings.showUnitSwitcher !== false ? 'checked' : ''} ${dis} /> Show unit switcher (piece / bundle / carton)</label></div>
        <div class="text-xs text-muted">Features: warehouses ${settings.features?.multiWarehouse ? 'on' : 'off'} · unit conversions ${settings.features?.unitConversions ? 'on' : 'off'} · wholesale pricing ${settings.features?.wholesalePricing ? 'on' : 'off'}</div>`,
      footerHtml: `<button class="btn btn-secondary" data-action="close">Close</button>${canEdit ? '<button class="btn btn-primary" id="st-save">Save</button>' : ''}` });
    W.bindClose(m);
    m.querySelector('#st-save')?.addEventListener('click', async (ev) => {
      const body = { defaultMode: m.querySelector('#st-mode').value, defaultPaymentTermsDays: Number(m.querySelector('#st-days').value) || 0, requireCustomerForWholesale: m.querySelector('#st-cust').checked,
        allowRetailFromWarehouse: m.querySelector('#st-retail').checked, showUnitSwitcher: m.querySelector('#st-units').checked };
      const w = m.querySelector('#st-wh').value; if (w) body.defaultWarehouseId = w;
      window.UI.setButtonLoading(ev.currentTarget, true);
      try { const { data } = await window.Api.put('/warehouse/settings', body); settings = data.settings; window.UI.closeModal(); window.UI.toast.success('Settings saved'); }
      catch (err) { window.UI.setButtonLoading(ev.currentTarget, false); window.UI.toast.error(err.message); }
    });
  }
})();
