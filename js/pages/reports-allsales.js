/**
 * reports-allsales.js - Reports > "All sales": every sale the business has made, searchable, filterable, with full detail per sale.
 *
 *   window.AllSales.mount(el, { getQuery })   getQuery() returns the report filter bar's { from, to, branchId, cashierId }
 *
 * API: GET /reports/sales/all (list + summary), GET /reports/sales/all/:id (one sale in full). Read-only.
 * The date range, branch and cashier come from the filter bar at the top of the Reports page; everything else is filtered here.
 * Filters are remembered while the page stays open.
 */
(function (window) {
  const RT = window.ReportTools;
  const esc = window.UI.escapeHtml;
  const fm = (n) => window.UI.formatMoney(n);
  const n0 = (v) => Number(v || 0).toLocaleString('en-KE');
  const nice = (s) => (RT && RT.prettify ? RT.prettify(s) : String(s || '').replace(/_/g, ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase()));
  const dt = (t) => (t ? window.UI.formatDateTime(t) : '-');
  const method = (m) => (RT && RT.methodMeta ? RT.methodMeta(m).label : nice(m));
  const SOURCE = { POS: 'POS', ONLINE: 'Online', SYNC: 'Offline sync', REPAIR: 'Repair', GARAGE: 'Garage', LAYAWAY: 'Layaway', RESTAURANT: 'Restaurant', ACCOMMODATION: 'Rooms' };
  const PAY_BADGE = { PAID: 'badge-success', PARTIAL: 'badge-warning', CREDIT: 'badge-danger', UNPAID: 'badge-neutral' };

  /* ---------------------------------------------------------------- styles */
  function css() {
    if (document.getElementById('as-css')) return;
    const s = document.createElement('style'); s.id = 'as-css';
    s.textContent = `
.as{display:flex;flex-direction:column;gap:var(--space-3);min-width:0}
.as .kpi-value{font-size:1.35rem;white-space:nowrap}
.as-bar{display:flex;gap:8px;flex-wrap:wrap;align-items:center}.as-bar .input{flex:1 1 240px;min-width:0}
.as-filters{display:none;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:10px;padding:var(--space-3);border:1px solid var(--color-border);border-radius:12px;background:var(--color-surface)}
.as-filters.open{display:grid}
.as-filters label{display:flex;flex-direction:column;gap:4px;font-size:var(--text-xs);color:var(--color-text-secondary);font-weight:600}
.as-filters .input,.as-filters .select{width:100%;min-height:40px}
.as-checks{grid-column:1/-1;display:flex;flex-wrap:wrap;gap:6px 18px}
.as-checks label{flex-direction:row;align-items:center;gap:8px;font-size:var(--text-sm);font-weight:500;color:var(--color-text)}
.as-checks input{width:18px;height:18px}
.as-active{display:flex;gap:6px;flex-wrap:wrap}
.as-tag{display:inline-flex;gap:6px;align-items:center;background:var(--color-bg);border:1px solid var(--color-border);border-radius:999px;padding:3px 10px;font-size:var(--text-xs)}
.as-tag button{border:0;background:none;cursor:pointer;font-size:14px;line-height:1;color:var(--color-text-secondary)}
.as-wrap{border:1px solid var(--color-border);border-radius:12px;background:var(--color-surface);overflow:auto}
.as table{width:100%;border-collapse:collapse;font-size:var(--text-sm)}
.as th{position:sticky;top:0;background:var(--color-bg);text-align:left;font-size:var(--text-xs);text-transform:uppercase;letter-spacing:.03em;color:var(--color-text-secondary);padding:9px 12px;white-space:nowrap;border-bottom:1px solid var(--color-border)}
.as td{padding:10px 12px;border-bottom:1px solid var(--color-border);vertical-align:top}
.as tbody tr{cursor:pointer}.as tbody tr:hover{background:var(--color-bg)}
.as tr.is-cancelled td{opacity:.65}.as tr.is-cancelled .rc{text-decoration:line-through}
.as td.num,.as th.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.as td small{display:block;color:var(--color-text-secondary)}
.as-pager{display:flex;gap:8px;align-items:center;justify-content:space-between;flex-wrap:wrap}
.as-pager .select{width:auto;min-height:36px}
.as-det .kv{display:grid;grid-template-columns:130px 1fr;gap:4px 10px;font-size:var(--text-sm);margin-bottom:var(--space-3)}.as-det .kv span:nth-child(odd){color:var(--color-text-secondary)}
.as-det h4{margin:14px 0 6px;font-size:var(--text-sm);text-transform:uppercase;letter-spacing:.03em;color:var(--color-text-secondary)}
.as-det .ln{display:flex;justify-content:space-between;gap:10px;padding:5px 0;border-bottom:1px dashed var(--color-border);font-size:var(--text-sm)}
.as-det .tot{display:flex;justify-content:space-between;font-weight:700;font-size:1.05rem;padding-top:8px}
.as-det .warn{background:var(--color-warning-bg);border-radius:8px;padding:8px 10px;font-size:var(--text-sm);margin-bottom:8px}
@media (max-width:720px){
  .as table,.as thead,.as tbody,.as tr,.as td{display:block;width:100%}.as thead{display:none}
  .as tbody tr{border-bottom:8px solid var(--color-bg);padding:8px 4px}
  .as td{border:0;padding:4px 10px 4px 104px;position:relative;text-align:left;min-height:24px}
  .as td::before{content:attr(data-l);position:absolute;left:10px;top:6px;width:88px;color:var(--color-text-secondary);font-size:var(--text-xs)}
  .as td.num{text-align:left}.as-det .kv{grid-template-columns:100px 1fr}
}`;
    document.head.appendChild(s);
  }

  /* ---------------------------------------------------------------- state (kept while the page stays open) */
  const S = { q: '', f: {}, page: 1, limit: 25, open: false };
  const SEL = (id, label, opts, val) => `<label>${esc(label)}<select class="select" id="${id}">${opts.map(([k, l]) => `<option value="${esc(k)}" ${String(val || '') === String(k) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`;
  const OPT = {
    status: [['', 'Completed & cancelled'], ['COMPLETED', 'Completed only'], ['CANCELLED', 'Cancelled only']],
    pay: [['', 'Any payment status'], ['PAID', 'Paid'], ['PARTIAL', 'Part paid'], ['UNPAID', 'Unpaid'], ['CREDIT', 'On credit']],
    method: [['', 'Any payment method'], ['CASH', 'Cash'], ['MPESA', 'M-PESA'], ['MOBILE_MONEY', 'Mobile money'], ['CARD', 'Card'], ['BANK', 'Bank'], ['CREDIT', 'Credit'], ['TRADE_IN', 'Trade-in'], ['OTHER', 'Other']],
    channel: [['', 'Retail & wholesale'], ['RETAIL', 'Retail'], ['WHOLESALE', 'Wholesale']],
    source: [['', 'Any source'], ...Object.keys(SOURCE).map((k) => [k, SOURCE[k]])],
    cust: [['', 'All customers'], ['REGISTERED', 'Registered customers'], ['WALKIN', 'Walk-in']],
    sort: [['newest', 'Newest first'], ['oldest', 'Oldest first'], ['highest', 'Highest total'], ['lowest', 'Lowest total'], ['receipt', 'Receipt number']],
  };

  function mount(host, { getQuery }) {
    css(); let token = 0, alive = true, canProfit = false;
    host.innerHTML = `<div class="as">
      <div class="as-bar"><input class="input" id="as-q" type="search" placeholder="Search receipt no., customer, phone, cashier, item, SKU, barcode, serial, M-PESA code, notes…" aria-label="Search sales" value="${esc(S.q)}"><button class="btn btn-secondary" id="as-ft" type="button">Filters<span id="as-fc"></span></button><button class="btn btn-secondary" id="as-ex" type="button">Export all (CSV)</button></div>
      <div class="as-filters" id="as-fp"></div><div class="as-active" id="as-act"></div><div id="as-kp"></div><div id="as-res"></div></div>`;
    const $ = (s) => host.querySelector(s);

    function paintFilters() {
      const f = S.f;
      $('#as-fp').innerHTML = SEL('f-status', 'Sale status', OPT.status, f.status) + SEL('f-pay', 'Payment status', OPT.pay, f.pay) + SEL('f-method', 'Paid with', OPT.method, f.method) + SEL('f-channel', 'Channel', OPT.channel, f.channel) + SEL('f-source', 'Source', OPT.source, f.source) + SEL('f-cust', 'Customer', OPT.cust, f.cust) +
        `<label>Min total<input class="input" id="f-min" type="number" min="0" step="any" inputmode="decimal" value="${esc(f.min || '')}"></label><label>Max total<input class="input" id="f-max" type="number" min="0" step="any" inputmode="decimal" value="${esc(f.max || '')}"></label>` + SEL('f-sort', 'Sort by', OPT.sort, f.sort || 'newest') +
        `<div class="as-checks"><label><input type="checkbox" id="f-disc" ${f.disc ? 'checked' : ''}> Had a discount</label><label><input type="checkbox" id="f-ref" ${f.ref ? 'checked' : ''}> Has refunds</label><label><input type="checkbox" id="f-bal" ${f.bal ? 'checked' : ''}> Money still owed</label><label><input type="checkbox" id="f-off" ${f.off ? 'checked' : ''}> Made offline</label><label><input type="checkbox" id="f-flag" ${f.flag ? 'checked' : ''}> Flagged for review</label></div>
        <label style="justify-content:flex-end"><button class="btn btn-secondary" id="as-clear" type="button">Clear filters</button></label>`;
      $('#as-fp').classList.toggle('open', !!S.open);
      $('#as-fp').querySelectorAll('select,input').forEach((c) => c.addEventListener('change', () => { read(); S.page = 1; run(); }));
      $('#as-clear').onclick = () => { S.f = {}; S.q = ''; $('#as-q').value = ''; S.page = 1; paintFilters(); run(); };
      active();
    }
    function read() {
      const v = (id) => { const e = $('#' + id); return e ? e.value : ''; }, c = (id) => { const e = $('#' + id); return !!(e && e.checked); };
      S.f = { status: v('f-status'), pay: v('f-pay'), method: v('f-method'), channel: v('f-channel'), source: v('f-source'), cust: v('f-cust'), min: v('f-min'), max: v('f-max'), sort: v('f-sort'), disc: c('f-disc'), ref: c('f-ref'), bal: c('f-bal'), off: c('f-off'), flag: c('f-flag') };
      active();
    }
    function active() {
      const f = S.f, tags = [];
      const lab = (opts, k) => (opts.find(([x]) => x === k) || [, k])[1];
      if (f.status) tags.push(['status', lab(OPT.status, f.status)]); if (f.pay) tags.push(['pay', lab(OPT.pay, f.pay)]); if (f.method) tags.push(['method', 'Paid with ' + lab(OPT.method, f.method)]);
      if (f.channel) tags.push(['channel', lab(OPT.channel, f.channel)]); if (f.source) tags.push(['source', lab(OPT.source, f.source)]); if (f.cust) tags.push(['cust', lab(OPT.cust, f.cust)]);
      if (f.min) tags.push(['min', 'Min ' + fm(f.min)]); if (f.max) tags.push(['max', 'Max ' + fm(f.max)]);
      if (f.disc) tags.push(['disc', 'Discounted']); if (f.ref) tags.push(['ref', 'Refunded']); if (f.bal) tags.push(['bal', 'Owing']); if (f.off) tags.push(['off', 'Offline']); if (f.flag) tags.push(['flag', 'Flagged']);
      $('#as-fc').textContent = tags.length ? ` (${tags.length})` : '';
      $('#as-act').innerHTML = tags.map(([k, l]) => `<span class="as-tag">${esc(l)}<button type="button" data-rm="${k}" aria-label="Remove filter">×</button></span>`).join('');
      $('#as-act').querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', () => { delete S.f[b.dataset.rm]; S.page = 1; paintFilters(); run(); }));
    }

    function query(page, limit) {
      const f = S.f, base = getQuery() || {};
      const q = { ...base, search: S.q || undefined, saleStatus: f.status || undefined, paymentStatus: f.pay || undefined, method: f.method || undefined, channel: f.channel || undefined, source: f.source || undefined, customerType: f.cust || undefined,
        minTotal: f.min || undefined, maxTotal: f.max || undefined, sort: f.sort || 'newest', hasDiscount: f.disc ? '1' : undefined, hasRefund: f.ref ? '1' : undefined, hasBalance: f.bal ? '1' : undefined, offline: f.off ? '1' : undefined, flagged: f.flag ? '1' : undefined, page, limit };
      Object.keys(q).forEach((k) => (q[k] === undefined || q[k] === '') && delete q[k]);
      return q;
    }
    async function fetchPage(page, limit) { const res = await window.Api.get('/reports/sales/all', query(page, limit)); return res && res.data !== undefined ? res.data : res; }

    async function run() {
      if (!alive || !host.isConnected) return;
      const my = ++token; $('#as-res').innerHTML = '<div class="card"><div class="skeleton" style="height:260px;margin:16px"></div></div>';
      let d; try { d = await fetchPage(S.page, S.limit); } catch (e) { if (my === token) { $('#as-kp').innerHTML = ''; $('#as-res').innerHTML = `<div class="card">${window.UI.emptyStateHtml({ icon: 'alert', title: 'Could not load sales', message: e.message || 'Try again.' })}</div>`; } return; }
      if (my !== token || !alive) return;
      if (d.summary) kpis(d.summary);
      table(d);
    }

    function kpis(s) {
      canProfit = s.estimatedProfit !== undefined;
      const k = (label, value, sub, tone, icon) => RT.kpi({ label, value, sub, tone, icon });
      $('#as-kp').innerHTML = `<div class="kpi-grid">${k('Sales found', n0(s.sales), `${n0(s.completed)} completed · ${n0(s.cancelled)} cancelled`, 'neutral', 'sales')}${k('Total sales', fm(s.revenue), 'Completed sales only', 'primary', 'sales')}${k('Average sale', fm(s.average), '', 'info', 'reports')}
        ${k('Money collected', fm(s.paid), '', 'success', 'sales')}${k('Still owed', fm(s.owed), 'Credit / part-paid', s.owed > 0 ? 'warning' : 'neutral', 'reports')}${k('Discounts', fm(s.discount), '', 'neutral', 'reports')}${k('Tax', fm(s.tax), '', 'neutral', 'reports')}${s.cancelled ? k('Cancelled value', fm(s.cancelledValue), `${n0(s.cancelled)} sale${s.cancelled === 1 ? '' : 's'}`, 'warning', 'alert') : ''}${canProfit ? k('Estimated profit', fm(s.estimatedProfit), 'Sales − tax − cost', 'success', 'reports') : ''}</div>`;
    }

    function row(s) {
      const cancelled = s.saleStatus === 'CANCELLED';
      return `<tr data-id="${esc(s.id)}" class="${cancelled ? 'is-cancelled' : ''}">
        <td data-l="Receipt"><b class="rc">${esc(s.receiptNumber)}</b>${s.invoiceNumber ? `<small>Inv ${esc(s.invoiceNumber)}</small>` : ''}<small>${esc(dt(s.soldAt))}</small></td>
        <td data-l="Branch">${esc(s.branchName)}<small>${esc(s.cashierName)}</small></td>
        <td data-l="Customer">${s.customerName ? esc(s.customerName) : '<span class="text-muted">Walk-in</span>'}<small>${esc(s.customerPhone || '')}</small></td>
        <td data-l="Items">${esc(s.itemNames.join(', ') || '-')}${s.moreItems ? ` +${s.moreItems} more` : ''}<small>${n0(s.units)} unit${s.units === 1 ? '' : 's'} · ${esc(SOURCE[s.source] || nice(s.source))}${s.channel === 'WHOLESALE' ? ' · Wholesale' : ''}</small></td>
        <td class="num" data-l="Total"><b>${fm(s.total)}</b>${s.discount ? `<small>Disc ${fm(s.discount)}</small>` : ''}${s.refunded ? `<small style="color:var(--color-danger)">Refunded ${fm(s.refunded)}</small>` : ''}</td>
        ${canProfit ? `<td class="num" data-l="Profit">${s.profit !== undefined ? fm(s.profit) : '-'}</td>` : ''}
        <td data-l="Payment"><span class="badge ${PAY_BADGE[s.paymentStatus] || 'badge-neutral'}">${esc(nice(s.paymentStatus))}</span><small>${esc(s.methods.map(method).join(', '))}</small>${s.balance > 0 ? `<small style="color:var(--color-warning)">Owes ${fm(s.balance)}</small>` : ''}</td>
        <td data-l="Status">${cancelled ? '<span class="badge badge-danger">Cancelled</span>' : '<span class="badge badge-success">Completed</span>'}${s.isOffline ? '<small>Offline sale</small>' : ''}${s.flagged ? '<small style="color:var(--color-warning)">Flagged</small>' : ''}${cancelled && s.cancelReason ? `<small>${esc(s.cancelReason)}</small>` : ''}</td></tr>`;
    }
    function table(d) {
      const rows = d.items || [];
      if (!rows.length) { $('#as-res').innerHTML = `<div class="card">${window.UI.emptyStateHtml({ icon: 'sales', title: 'No sales found', message: 'Try a wider date range, another branch or fewer filters.' })}</div>`; return; }
      const pages = d.pages || 1;
      $('#as-res').innerHTML = `<div class="as-wrap"><table><thead><tr><th>Receipt</th><th>Branch / cashier</th><th>Customer</th><th>Items</th><th class="num">Total</th>${canProfit ? '<th class="num">Profit</th>' : ''}<th>Payment</th><th>Status</th></tr></thead><tbody>${rows.map(row).join('')}</tbody></table></div>
        <div class="as-pager"><span class="text-sm text-muted">${n0(d.total)} sale${d.total === 1 ? '' : 's'} · page ${d.page} of ${pages}</span><span class="as-bar"><select class="select" id="as-pl" aria-label="Rows per page">${[25, 50, 100, 200].map((n) => `<option value="${n}" ${n === S.limit ? 'selected' : ''}>${n} per page</option>`).join('')}</select><button class="btn btn-secondary" id="as-pv" ${d.page <= 1 ? 'disabled' : ''}>Previous</button><button class="btn btn-secondary" id="as-nx" ${d.page >= pages ? 'disabled' : ''}>Next</button></span></div>`;
      $('#as-res').querySelectorAll('tbody tr').forEach((tr) => tr.addEventListener('click', () => openDetail(tr.dataset.id)));
      $('#as-pv').onclick = () => { S.page = Math.max(1, S.page - 1); run(); }; $('#as-nx').onclick = () => { S.page += 1; run(); };
      $('#as-pl').onchange = (e) => { S.limit = Number(e.target.value); S.page = 1; run(); };
    }

    async function exportCsv() {
      const btn = $('#as-ex'), old = btn.textContent; btn.disabled = true; btn.textContent = 'Preparing…';
      try {
        let all = [], page = 1, pages = 1;
        do { const d = await fetchPage(page, 200); all = all.concat(d.items || []); pages = d.pages || 1; page++; } while (page <= pages && page <= 50);
        if (!all.length) { window.UI.toast.info('Nothing to export'); return; }
        const head = ['Receipt', 'Invoice', 'Date', 'Branch', 'Cashier', 'Customer', 'Phone', 'Channel', 'Source', 'Items', 'Units', 'Subtotal', 'Discount', 'Tax', 'Total', 'Paid', 'Balance', 'Refunded', 'Payment status', 'Paid with', 'Sale status', 'Offline', 'Flagged', 'Notes / cancel reason', ...(all.some((s) => s.profit !== undefined) ? ['Cost', 'Profit'] : [])];
        const withProfit = head.length > 24;
        RT.downloadCSV(`all-sales-${RT.stamp()}.csv`, [{ headers: head, rows: all.map((s) => [s.receiptNumber, s.invoiceNumber || '', dt(s.soldAt), s.branchName, s.cashierName, s.customerName || 'Walk-in', s.customerPhone || '', s.channel, SOURCE[s.source] || s.source, s.itemNames.join('; ') + (s.moreItems ? ` +${s.moreItems} more` : ''), s.units, s.subtotal, s.discount, s.tax, s.total, s.amountPaid, s.balance, s.refunded, s.paymentStatus, s.methods.map(method).join('; '), s.saleStatus, s.isOffline ? 'Yes' : '', s.flagged ? 'Yes' : '', s.cancelReason || s.notes || '', ...(withProfit ? [s.cost ?? '', s.profit ?? ''] : [])]) }]);
        window.UI.toast.success(`${all.length} sale${all.length === 1 ? '' : 's'} exported`);
      } catch (e) { window.UI.toast.error('Could not export. Try again.'); } finally { btn.disabled = false; btn.textContent = old; }
    }

    paintFilters();
    let t; $('#as-q').addEventListener('input', (e) => { clearTimeout(t); t = setTimeout(() => { S.q = e.target.value.trim(); S.page = 1; run(); }, 350); });
    $('#as-ft').onclick = () => { S.open = !S.open; $('#as-fp').classList.toggle('open', S.open); };
    $('#as-ex').onclick = exportCsv;
    run();
    return { exportCsv, destroy() { alive = false; } };
  }

  /* ---------------------------------------------------------------- one sale in full */
  async function openDetail(id) {
    let d; try { const res = await window.Api.get(`/reports/sales/all/${id}`); d = res && res.data !== undefined ? res.data : res; } catch (e) { window.UI.toast.error(e.message || 'Could not open this sale'); return; }
    const s = d.sale; if (!s) return; const profit = !!d.canSeeProfit; const cancelled = s.saleStatus === 'CANCELLED';
    const kv = (rows) => `<div class="kv">${rows.filter(([, v]) => v != null && v !== '').map(([k, v]) => `<span>${esc(k)}</span><span>${v}</span>`).join('')}</div>`;
    const lines = (s.items || []).map((i) => {
      const cost = (i.costPriceSnapshot || 0) * (i.quantity || 0);
      return `<tr><td class="text-sm">${esc(i.nameSnapshot)}<div class="text-xs text-muted">${esc(i.skuSnapshot || '')}${i.unitName ? ' · ' + esc(i.unitName) : ''}${i.priceType && i.priceType !== 'RETAIL' ? ' · ' + esc(nice(i.priceType)) : ''}${(i.serialNumbers || []).length ? '<br>Serial: ' + esc(i.serialNumbers.join(', ')) : ''}${(i.batchAllocations || []).length ? '<br>Batch: ' + esc(i.batchAllocations.map((b) => b.batchNumber).filter(Boolean).join(', ')) : ''}${i.refundedQuantity ? `<br><span style="color:var(--color-danger)">${i.refundedQuantity} refunded</span>` : ''}</div></td>
        <td class="num">${i.quantity}</td><td class="num">${fm(i.unitPrice)}</td><td class="num">${i.discount ? fm(i.discount) : '-'}</td><td class="num">${i.taxAmount ? fm(i.taxAmount) : '-'}</td><td class="num"><b>${fm(i.total)}</b></td>${profit ? `<td class="num">${fm(i.total - (i.taxAmount || 0) - cost)}</td>` : ''}</tr>`;
    }).join('');
    const pays = (d.payments || []).map((p) => `<tr><td class="cell-primary">${esc(method(p.method))}${p.refundId ? ' <span class="text-xs text-muted">(refund)</span>' : ''}</td><td class="text-sm">${p.reference ? esc(p.reference) : '<span class="text-muted">-</span>'}${p.externalTransactionId ? `<div class="text-xs text-muted">${esc(p.externalTransactionId)}</div>` : ''}</td><td class="text-sm">${esc(dt(p.createdAt))}</td><td>${RT.statusBadge ? RT.statusBadge(p.status) : esc(p.status)}</td><td class="num">${fm(p.amount)}</td></tr>`).join('');
    const refs = (d.refunds || []).map((r) => `<div class="ln"><span><b>${esc(r.refundNumber)}</b> · ${esc(nice(r.status))} · ${esc(method(r.paymentMethod))}<br><small class="text-muted">${esc(r.reason || '')} · ${esc(dt(r.createdAt))}${r.requestedBy && r.requestedBy.name ? ' · by ' + esc(r.requestedBy.name) : ''}${r.approvedBy && r.approvedBy.name ? ' · approved ' + esc(r.approvedBy.name) : ''}</small><br><small>${(r.items || []).map((i) => `${i.quantity}× ${esc(i.nameSnapshot)}`).join(', ')}</small></span><span>${fm(r.amount)}</span></div>`).join('');
    const flags = (s.reviewFlags || []).map((f) => `<div class="warn"><b>${esc(nice(f.code))}</b> (${esc(f.severity || '')}) ${esc(f.detail || '')}</div>`).join('');
    const body = `<div class="as-det" id="as-print">
      ${cancelled ? `<div class="warn"><b>Cancelled</b>${s.cancelledAt ? ' on ' + esc(dt(s.cancelledAt)) : ''}${s.cancelledBy && s.cancelledBy.name ? ' by ' + esc(s.cancelledBy.name) : ''}${s.cancelReason ? ' · ' + esc(s.cancelReason) : ''}</div>` : ''}${flags}
      ${kv([['Date & time', esc(dt(s.soldAt || s.createdAt))], ['Saved on server', s.isOffline ? esc(dt(s.syncedAt || s.createdAt)) + ' (offline sale)' : ''], ['Branch', esc((s.branchId && s.branchId.name) || '-')], ['Cashier', esc((s.cashierId && s.cashierId.name) || '-')],
        ['Customer', s.customerId ? esc(s.customerId.name) + (s.customerId.phone ? ' · ' + esc(s.customerId.phone) : '') : 'Walk-in'], ['Invoice no.', esc(s.invoiceNumber || '')], ['Channel', esc(nice(s.channel || 'RETAIL'))], ['Source', esc(SOURCE[s.source] || nice(s.source))],
        ['Payment status', `<span class="badge ${PAY_BADGE[s.paymentStatus] || 'badge-neutral'}">${esc(nice(s.paymentStatus))}</span>`], ['Due date', s.dueDate ? esc(dt(s.dueDate)) : ''], ['Notes', esc(s.notes || '')], ['Reviewed', s.reviewedAt ? esc(dt(s.reviewedAt)) + (s.reviewedBy && s.reviewedBy.name ? ' by ' + esc(s.reviewedBy.name) : '') + (s.reviewNote ? ' · ' + esc(s.reviewNote) : '') : '']])}
      <h4>Items sold</h4><div class="table-wrap flat"><table class="table"><thead><tr><th>Item</th><th class="num">Qty</th><th class="num">Price</th><th class="num">Discount</th><th class="num">Tax</th><th class="num">Total</th>${profit ? '<th class="num">Profit</th>' : ''}</tr></thead><tbody>${lines}</tbody></table></div>
      <div class="ln"><span>Subtotal</span><span>${fm(s.subtotal)}</span></div>${s.itemDiscount ? `<div class="ln"><span>Item discounts</span><span>-${fm(s.itemDiscount)}</span></div>` : ''}${s.cartDiscount ? `<div class="ln"><span>Cart discount</span><span>-${fm(s.cartDiscount)}</span></div>` : ''}${s.tax ? `<div class="ln"><span>Tax (included)</span><span>${fm(s.tax)}</span></div>` : ''}
      <div class="tot"><span>Total</span><span>${fm(s.total)}</span></div><div class="ln"><span>Paid</span><span>${fm(s.amountPaid)}</span></div>${s.balance > 0 ? `<div class="ln" style="color:var(--color-warning)"><span>Balance owed</span><span>${fm(s.balance)}</span></div>` : ''}
      <h4>Payments</h4>${pays ? `<div class="table-wrap flat"><table class="table"><thead><tr><th>Method</th><th>Reference</th><th>When</th><th>Status</th><th class="num">Amount</th></tr></thead><tbody>${pays}</tbody></table></div>` : '<p class="text-sm text-muted">No payments recorded (fully on credit).</p>'}
      ${refs ? `<h4>Refunds</h4>${refs}` : ''}</div>`;
    window.UI.openModal({ title: `Sale ${s.receiptNumber}`, maxWidth: '760px', bodyHtml: body, footerHtml: '<button class="btn btn-secondary" data-action="close">Close</button><button class="btn btn-secondary" data-action="print">Print</button>',
      onMount(m) {
        m.querySelector('[data-action="close"]').addEventListener('click', window.UI.closeModal);
        m.querySelector('[data-action="print"]').addEventListener('click', () => { const w = window.open('', '_blank', 'width=720,height=800'); if (!w) return window.UI.toast.warning('Allow pop-ups to print'); w.document.write(`<body style="font:13px/1.5 system-ui,sans-serif;margin:16px"><h3>Sale ${esc(s.receiptNumber)}</h3>${m.querySelector('#as-print').innerHTML}<style>table{width:100%;border-collapse:collapse}td,th{padding:4px 6px;border-bottom:1px solid #ddd;text-align:left}.num{text-align:right}.kv{display:grid;grid-template-columns:130px 1fr;gap:3px 10px}.ln,.tot{display:flex;justify-content:space-between}</style></body>`); w.document.close(); w.focus(); w.print(); });
      } });
  }

  window.AllSales = { mount, openDetail };
})(window);
