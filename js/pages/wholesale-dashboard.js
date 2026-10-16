/**
 * wholesale-dashboard.js - the "Wholesale desk" that lives INSIDE dashboard.html for businesses with warehouses.
 * (It replaces the old stand-alone wholesale.html page. That URL now redirects to the dashboard.)
 *
 * dashboard.js owns the page, the date/branch filter bar and the standard reports. For wholesale businesses it
 * calls   WholesaleDashboard.render(slotEl, { from, to, branchId, canProfit })   after each load, so the wholesale
 * numbers always follow the SAME date range and branch as the rest of the dashboard.
 *
 * Shows: wholesale vs retail split, KPIs (sales, collected, owed by customers, overdue, profit, warehouse stock,
 * owed to suppliers), daily wholesale sales, top customers, warehouses, overdue customer invoices,
 * low stock, supplier payables ageing and recent stock moves, plus the wholesale settings dialog.
 * Sales come from GET /sales (KES) and are split by channel here.
 */
(function (window) {
  'use strict';
  const W = window.WS;
  let settings = {};
  let whs = [];
  let seq = 0;

  const settle = (p) => p.then((v) => ({ v }), (e) => ({ e }));

  async function fetchSales({ from, to, branchId }) {
    const out = [];
    for (let page = 1; page <= 10; page++) {
      const { data } = await window.Api.get('/sales', { branchId: branchId || undefined, from: from ? from.toISOString() : undefined, to: to ? to.toISOString() : undefined, page, limit: 100 });
      out.push(...data.items);
      if (page >= data.pages) break;
    }
    return out.filter((s) => s.saleStatus !== 'CANCELLED');
  }

  const skeleton = () => `<div class="ws-pad ws-muted-row">Loading the wholesale desk…</div>`;

  /** Public entry point. */
  async function render(el, ctx = {}) {
    if (!el || !W || !W.on('multiWarehouse')) return;
    const my = ++seq;
    const { from, to, branchId } = ctx;
    const canProfit = !!ctx.canProfit && W.can('reports.profit');
    el.innerHTML = `<section class="wd"><header class="wd-head"><div><h2>Wholesale desk</h2><p>Credit owed to you, warehouse stock and supplier bills, for the same dates and branch as above.</p></div></header>${skeleton()}</section>`;

    const canPay = W.can('purchases.view');
    const canStock = W.can('inventory.view');
    const [sRes, wRes, lowRes, ageRes, mvRes, setRes] = await Promise.all([
      settle(W.can('sales.view') ? fetchSales({ from, to, branchId }) : Promise.resolve([])),
      canStock ? settle(W.warehouses(true)) : Promise.resolve({ v: [] }),
      canStock ? settle(window.Api.get('/warehouse/stock', { branchId: branchId || undefined, lowStockOnly: true, limit: 8 })) : Promise.resolve({ e: 'skip' }),
      canPay ? settle(window.Api.get('/supplier-finance/ageing')) : Promise.resolve({ e: 'skip' }),
      canStock ? settle(window.Api.get('/warehouse/transfers', { limit: 5 })) : Promise.resolve({ e: 'skip' }),
      settle(W.settings()),
    ]);
    if (my !== seq) return;
    settings = setRes.v || {};
    whs = wRes.v || [];

    const all = sRes.v || [];
    const sales = all.filter((s) => s.channel === 'WHOLESALE');
    const retail = all.filter((s) => s.channel !== 'WHOLESALE');
    const sum = (list, f) => list.reduce((t, x) => t + (Number(f(x)) || 0), 0);
    const rev = sum(sales, (x) => x.total);
    const got = sum(sales, (x) => x.amountPaid);
    const retailRev = sum(retail, (x) => x.total);
    const owing = sales.filter((s) => s.balance > 0);
    const owed = sum(owing, (x) => x.balance);
    const overdue = owing.filter((s) => s.dueDate && new Date(s.dueDate) < new Date());
    const overdueAmt = sum(overdue, (x) => x.balance);
    const profit = sum(sales, (s) => (s.items || []).reduce((t, i) => t + ((i.unitPrice - (i.costPriceSnapshot || 0)) * i.quantity - (i.discount || 0)), 0));
    const totalRev = rev + retailRev;
    const wsShare = totalRev ? Math.round((rev / totalRev) * 100) : 0;

    // daily bars across the selected range (max 31 bars; longer ranges show the most recent 31 days)
    const end = to ? new Date(to) : new Date();
    const spanDays = from ? Math.max(1, Math.round((end - from) / 86400000) + 1) : 14;
    const nDays = Math.min(31, spanDays);
    const byDay = new Map();
    for (let i = nDays - 1; i >= 0; i--) byDay.set(W.dayKey(end.getTime() - i * 86400000), { ws: 0, rt: 0 });
    all.forEach((s) => { const k = W.dayKey(s.soldAt || s.createdAt); const b = byDay.get(k); if (b) { if (s.channel === 'WHOLESALE') b.ws += s.total; else b.rt += s.total; } });
    const max = Math.max(1, ...[...byDay.values()].map((b) => b.ws + b.rt));

    const cust = new Map();
    sales.forEach((s) => { const id = s.customerId?._id || 'walkin'; const c = cust.get(id) || { name: s.customerId?.name || 'Walk-in', total: 0, owed: 0, n: 0 }; c.total += s.total; c.owed += Math.max(0, s.balance); c.n++; cust.set(id, c); });
    const top = [...cust.values()].sort((a, b) => b.total - a.total).slice(0, 6);

    const age = ageRes.v?.data?.totals;
    const stockUnits = whs.reduce((s, w) => s + (w.stock?.units || 0), 0);
    const ageOverdue = age ? age.days1to30 + age.days31to60 + age.days61to90 + age.over90 : 0;
    const lowItems = lowRes.v?.data?.items || [];
    const moves = mvRes.v?.data?.items || [];

    const action = (href, ico, label, perm, id) => `<${href ? `a href="${href}"` : `button type="button" id="${id}"`} class="ws-action" ${perm ? `data-requires-permission="${perm}"` : ''}><span class="icon">${W.icon(ico)}</span>${label}</${href ? 'a' : 'button'}>`;

    el.innerHTML = `
    <section class="wd">
      <header class="wd-head">
        <div><h2>Wholesale desk</h2><p>Credit owed to you, warehouse stock and supplier bills, for the same dates and branch as above.</p></div>
        <button class="btn btn-secondary btn-sm" id="wd-settings" data-requires-permission="inventory.view">${W.icon('sliders')} Wholesale settings</button>
      </header>

      <div class="ws-actions">
        ${action('sales.html?mode=wholesale', 'sales', 'Sell wholesale', 'sales.create')}
        ${action('', 'arrowRight', 'Move stock to shop', 'inventory.transfer', 'wd-move')}
        ${action('purchases.html', 'bag', 'Receive purchase', 'purchases.view')}
        ${action('suppliers.html?tab=payables', 'wallet', 'Pay suppliers', 'purchases.view')}
        ${action('inventory.html', 'inventory', 'Wholesale inventory', 'inventory.view')}
        ${action('reports.html?tab=wholesale', 'reports', 'Wholesale report', 'reports.profit')}
      </div>

      ${sRes.e ? `<div class="ws-warn">Could not load sales: ${W.esc(sRes.e.message)}</div>` : ''}

      <div class="kpi-grid">
        <div class="kpi kpi-success"><div class="kpi-label">Wholesale sales</div><div class="kpi-value">${W.kes(rev)}</div><div class="kpi-foot">${sales.length} invoices · ${wsShare}% of all sales</div></div>
        <div class="kpi"><div class="kpi-label">Collected</div><div class="kpi-value">${W.kes(got)}</div><div class="kpi-foot">${rev ? Math.round((got / rev) * 100) : 0}% of wholesale sales</div></div>
        <div class="kpi kpi-warning"><div class="kpi-label">Owed by customers</div><div class="kpi-value">${W.kes(owed)}</div><div class="kpi-foot">${owing.length} open invoices</div></div>
        <div class="kpi kpi-danger"><div class="kpi-label">Overdue</div><div class="kpi-value">${W.kes(overdueAmt)}</div><div class="kpi-foot">${overdue.length} invoices past due</div></div>
        ${canProfit ? `<div class="kpi kpi-success"><div class="kpi-label">Wholesale gross profit</div><div class="kpi-value">${W.kes(profit)}</div><div class="kpi-foot">before expenses</div></div>` : ''}
        ${canStock ? `<div class="kpi"><div class="kpi-label">Warehouse stock</div><div class="kpi-value">${W.num(stockUnits)}</div><div class="kpi-foot">${whs.length} warehouse${whs.length === 1 ? '' : 's'}</div></div>` : ''}
        ${age ? `<div class="kpi kpi-warning"><div class="kpi-label">Owed to suppliers</div><div class="kpi-value">${W.kes(age.total)}</div><div class="kpi-foot">${W.kes(ageOverdue)} overdue</div></div>` : ''}
      </div>

      <div class="ws-grid ws-grid-2">
        <div class="card"><div class="ws-pad">
          <div class="ws-section-title"><h3>Daily sales · wholesale and retail</h3>
            <div class="ws-legend" style="margin:0"><span><b style="background:var(--color-primary)"></b>Wholesale</span><span><b style="background:var(--color-info)"></b>Retail</span></div></div>
          <div class="ws-bars">${[...byDay].map(([k, v]) => `<div class="ws-bar" title="${k}: wholesale ${W.kes(v.ws)} · retail ${W.kes(v.rt)}"><div class="wd-stackbar" style="height:${((v.ws + v.rt) / max) * 100}%"><i style="height:${(v.ws + v.rt) ? (v.ws / (v.ws + v.rt)) * 100 : 0}%;background:var(--color-primary)"></i><i style="flex:1;background:var(--color-info)"></i></div><small>${k.slice(8)}</small></div>`).join('')}</div>
        </div></div>
        <div class="card"><div class="ws-pad">
          <div class="ws-section-title"><h3>Top wholesale customers</h3><a class="btn btn-ghost btn-sm" href="customers.html" data-requires-permission="customers.view">All customers</a></div>
          ${top.length ? `<div class="table-wrap flat"><table class="table"><thead><tr><th>Customer</th><th>Invoices</th><th>Bought</th><th>Owes</th></tr></thead><tbody>${top.map((c) => `<tr><td class="cell-primary">${W.esc(c.name)}</td><td>${c.n}</td><td>${W.kes(c.total)}</td><td style="${c.owed > 0 ? 'color:var(--color-warning);font-weight:600' : ''}">${c.owed > 0 ? W.kes(c.owed) : '—'}</td></tr>`).join('')}</tbody></table></div>` : '<div class="ws-muted-row">No wholesale sales in this period.</div>'}
        </div></div>
      </div>

      ${canStock ? `<div class="card" style="margin-top:var(--space-4)"><div class="ws-pad"><div class="ws-section-title"><h3>Warehouses</h3><a class="btn btn-ghost btn-sm" href="inventory.html?step=warehouses">Manage</a></div>
        <div class="ws-grid ws-grid-wh">${whs.length ? whs.map((w) => `<div class="ws-wh ${w.status === 'inactive' ? 'inactive' : ''}"><h4>${W.esc(w.name)} ${w.isDefault ? '<span class="badge badge-success">Default</span>' : ''}</h4>
          <div class="meta">${W.esc(w.branchId?.name || '')}</div><div class="nums"><div><b>${W.num(w.stock?.skus)}</b><span>products</span></div><div><b>${W.num(w.stock?.units)}</b><span>base units</span></div></div></div>`).join('') : '<div class="ws-muted-row">No warehouses yet. Create one in Wholesale inventory.</div>'}</div></div></div>` : ''}

      <div class="ws-grid ws-grid-2" style="margin-top:var(--space-4)">
        <div class="card"><div class="ws-pad"><div class="ws-section-title"><h3>Overdue customer invoices</h3></div>
          ${overdue.length ? `<div class="table-wrap flat"><table class="table"><thead><tr><th>Receipt</th><th>Customer</th><th>Due</th><th>Balance</th><th></th></tr></thead><tbody>${overdue.sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate)).slice(0, 8).map((s) => `<tr><td class="cell-primary">${W.esc(s.receiptNumber)}</td><td class="text-sm">${W.esc(s.customerId?.name || '—')}</td><td class="text-sm" style="color:var(--color-danger)">${window.UI.formatDate(s.dueDate)}</td><td><strong>${W.kes(s.balance)}</strong></td><td class="actions"><button class="btn btn-ghost btn-sm" data-inv="${s._id}">Invoice</button></td></tr>`).join('')}</tbody></table></div>` : '<div class="ws-muted-row">Nothing overdue.</div>'}
        </div></div>
        ${canStock ? `<div class="card"><div class="ws-pad"><div class="ws-section-title"><h3>Low stock in warehouses</h3><a class="btn btn-ghost btn-sm" href="inventory.html?step=stock&view=low">Open</a></div>
          ${lowItems.length ? `<div class="table-wrap flat"><table class="table"><thead><tr><th>Product</th><th>Warehouse</th><th>Left</th></tr></thead><tbody>${lowItems.map((r) => `<tr><td class="cell-primary">${W.esc(r.productId?.name || '—')}</td><td class="text-sm">${W.esc(r.warehouseId?.name || '')}</td><td><span class="badge badge-warning">${W.num(r.quantity)} ${W.esc(r.productId?.unit || '')}</span></td></tr>`).join('')}</tbody></table></div>` : '<div class="ws-muted-row">Nothing running low.</div>'}
        </div></div>` : ''}
        ${age ? `<div class="card"><div class="ws-pad"><div class="ws-section-title"><h3>Supplier payables ageing</h3><a class="btn btn-ghost btn-sm" href="suppliers.html?tab=payables">Open</a></div>
          <div class="ws-stack">${[['current', 0], ['days1to30', 1], ['days31to60', 2], ['days61to90', 3], ['over90', 4]].map(([k, i]) => (age.total > 0 && age[k] > 0 ? `<i class="ws-age-${i}" style="width:${(age[k] / age.total) * 100}%"></i>` : '')).join('')}</div>
          <div class="ws-legend"><span><b class="ws-age-0"></b>Current ${W.kes(age.current)}</span><span><b class="ws-age-1"></b>1–30 ${W.kes(age.days1to30)}</span><span><b class="ws-age-2"></b>31–60 ${W.kes(age.days31to60)}</span><span><b class="ws-age-3"></b>61–90 ${W.kes(age.days61to90)}</span><span><b class="ws-age-4"></b>90+ ${W.kes(age.over90)}</span></div>
        </div></div>` : ''}
        ${canStock ? `<div class="card"><div class="ws-pad"><div class="ws-section-title"><h3>Recent stock moves</h3><a class="btn btn-ghost btn-sm" href="inventory.html?step=history">All</a></div>
          ${moves.length ? `<div class="table-wrap flat"><table class="table"><thead><tr><th>Move</th><th>When</th><th>Items</th></tr></thead><tbody>${moves.map((t) => `<tr><td class="cell-primary">${W.esc(t.transferNumber)}</td><td class="text-sm">${window.UI.formatDate(t.createdAt)}</td><td>${(t.items || []).length}</td></tr>`).join('')}</tbody></table></div>` : '<div class="ws-muted-row">No moves yet.</div>'}
        </div></div>` : ''}
      </div>
    </section>`;

    el.querySelector('#wd-settings')?.addEventListener('click', openSettings);
    el.querySelector('#wd-move')?.addEventListener('click', () => W.openTransferModal({ onDone: () => render(el, ctx) }));
    el.addEventListener('click', (e) => { const b = e.target.closest('[data-inv]'); if (b && window.InvoiceView) window.InvoiceView.open(b.dataset.inv); });
    window.Permissions.applyPermissionGates(el, window.AppShell.getUser());
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

  window.WholesaleDashboard = { render };
})(window);
