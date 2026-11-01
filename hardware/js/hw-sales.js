/* Hardware workspace — Reports → "All sales": every sale, searchable and filterable (branch, cashier, dates, payment, amount…),
   click any row for the full sale in a modal. Also exposes HW.saleDetail(id) (used by the global search).
   API (read-only): GET /reports/sales/all   and   GET /reports/sales/all/:id */
(function () {
  const { Api } = window, HW = window.HW; if (!HW || !HW.V.reports) return;
  const E = HW.E, $ = HW.$, $$ = HW.$$, M = HW.money;
  const nice = (s) => HW.human(s);
  const SOURCE = { POS: 'POS', ONLINE: 'Online', SYNC: 'Offline sync', REPAIR: 'Repair', GARAGE: 'Garage', LAYAWAY: 'Layaway', RESTAURANT: 'Restaurant', ACCOMMODATION: 'Rooms' };
  const OPT = {
    status: [['', 'Completed & cancelled'], ['COMPLETED', 'Completed only'], ['CANCELLED', 'Cancelled only']],
    pay: [['', 'Any payment status'], ['PAID', 'Paid'], ['PARTIAL', 'Part paid'], ['UNPAID', 'Unpaid'], ['CREDIT', 'On credit']],
    method: [['', 'Any method'], ['CASH', 'Cash'], ['MPESA', 'M-PESA'], ['MOBILE_MONEY', 'Mobile money'], ['CARD', 'Card'], ['BANK', 'Bank'], ['CREDIT', 'Credit'], ['OTHER', 'Other']],
    channel: [['', 'Retail & wholesale'], ['RETAIL', 'Retail'], ['WHOLESALE', 'Wholesale']],
    cust: [['', 'All customers'], ['REGISTERED', 'Registered'], ['WALKIN', 'Walk-in']],
    source: [['', 'Any source'], ...Object.keys(SOURCE).map((k) => [k, SOURCE[k]])],
    sort: [['newest', 'Newest first'], ['oldest', 'Oldest first'], ['highest', 'Highest total'], ['lowest', 'Lowest total'], ['receipt', 'Receipt number']],
  };
  const ymd = (d) => { const x = new Date(d); x.setMinutes(x.getMinutes() - x.getTimezoneOffset()); return x.toISOString().slice(0, 10); };
  const today = () => ymd(new Date());
  const addDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return ymd(d); };
  const PRESETS = [['today', 'Today', () => [today(), today()]], ['yday', 'Yesterday', () => [addDays(-1), addDays(-1)]], ['7d', 'Last 7 days', () => [addDays(-6), today()]], ['month', 'This month', () => [HW.monthStart(), today()]],
    ['lmonth', 'Last month', () => { const d = new Date(); const a = new Date(d.getFullYear(), d.getMonth() - 1, 1), b = new Date(d.getFullYear(), d.getMonth(), 0); return [ymd(a), ymd(b)]; }], ['year', 'This year', () => [`${new Date().getFullYear()}-01-01`, today()]]];
  let GEN = 0;
  const S = { q: '', preset: 'month', from: null, to: null, branch: undefined, cashier: '', f: {}, page: 1, limit: 25, open: false };
  const isoStart = (d) => new Date(d + 'T00:00:00').toISOString(), isoEnd = (d) => new Date(d + 'T23:59:59.999').toISOString();

  /* ---------- one sale in full ---------- */
  HW.saleDetail = async (id) => {
    let d; try { d = (await Api.get(`/reports/sales/all/${id}`)).data; } catch (e) { return HW.err(e.message || 'Could not open this sale'); }
    const s = d.sale; if (!s) return; const profit = !!d.canSeeProfit, cancelled = s.saleStatus === 'CANCELLED';
    const kv = (rows) => `<div class="kv">${rows.filter(([, v]) => v != null && v !== '').map(([k, v]) => `<span>${E(k)}</span><span>${v}</span>`).join('')}</div>`;
    const lines = (s.items || []).map((i) => { const cost = (i.costPriceSnapshot || 0) * (i.quantity || 0); return { i, cost }; });
    const itemsTbl = HW.tbl([{ h: 'Item', f: ({ i }) => `<b>${E(i.nameSnapshot)}</b><small style="display:block;color:#757a88">${E([i.skuSnapshot, i.unitName, i.priceType && i.priceType !== 'RETAIL' ? nice(i.priceType) : ''].filter(Boolean).join(' · '))}${(i.serialNumbers || []).length ? '<br>Serial: ' + E(i.serialNumbers.join(', ')) : ''}${i.refundedQuantity ? `<br><span style="color:#b42323">${i.refundedQuantity} refunded</span>` : ''}</small>` },
      { h: 'Qty', c: 'n', f: ({ i }) => HW.num(i.quantity) }, { h: 'Price', c: 'n', f: ({ i }) => M(i.unitPrice) }, { h: 'Disc.', c: 'n', f: ({ i }) => i.discount ? M(i.discount) : '–' }, { h: 'Total', c: 'n pr', f: ({ i }) => M(i.total) },
      ...(profit ? [{ h: 'Profit', c: 'n', f: ({ i, cost }) => M(i.total - (i.taxAmount || 0) - cost) }] : [])], lines, { empty: 'No items' });
    const payTbl = (d.payments || []).length ? HW.tbl([{ h: 'Method', f: (p) => E(nice(p.method)) + (p.refundId ? ' <small>(refund)</small>' : '') }, { h: 'Reference', f: (p) => E(p.reference || p.externalTransactionId || '–') }, { h: 'When', f: (p) => E(HW.dt(p.createdAt)) }, { h: 'Amount', c: 'n pr', f: (p) => M(p.amount) }], d.payments) : '<p style="color:#757a88;margin:0">No payments recorded (fully on credit).</p>';
    const refs = (d.refunds || []).map((r) => `<div class="ln"><span><b>${E(r.refundNumber)}</b> · ${E(nice(r.status))} · ${E(nice(r.paymentMethod))}<br><small style="color:#757a88">${E(r.reason || '')} · ${E(HW.dt(r.createdAt))}</small></span><b>${M(r.amount)}</b></div>`).join('');
    const flags = (s.reviewFlags || []).map((f) => `<div class="warn"><b>${E(nice(f.code))}</b> (${E(f.severity || '')}) ${E(f.detail || '')}</div>`).join('');
    const body = `<div class="hs-det" id="hs-print">${cancelled ? `<div class="warn"><b>Cancelled</b>${s.cancelledAt ? ' on ' + E(HW.dt(s.cancelledAt)) : ''}${s.cancelledBy && s.cancelledBy.name ? ' by ' + E(s.cancelledBy.name) : ''}${s.cancelReason ? ' · ' + E(s.cancelReason) : ''}</div>` : ''}${flags}
      ${kv([['Date & time', E(HW.dt(s.soldAt || s.createdAt))], ['Branch', E((s.branchId && s.branchId.name) || '–')], ['Cashier', E((s.cashierId && s.cashierId.name) || '–')], ['Customer', s.customerId ? E(s.customerId.name) + (s.customerId.phone ? ' · ' + E(s.customerId.phone) : '') : 'Walk-in'], ['Invoice no.', E(s.invoiceNumber || '')], ['Channel', E(nice(s.channel || 'RETAIL'))], ['Source', E(SOURCE[s.source] || nice(s.source))],
        ['Payment status', HW.badge(({ PAID: 'OK', PARTIAL: 'WA', CREDIT: 'ER' })[s.paymentStatus] || '', nice(s.paymentStatus))], ['Due date', s.dueDate ? E(HW.dt(s.dueDate)) : ''], ['Notes', E(s.notes || '')], ['Offline sale', s.isOffline ? 'Yes — saved ' + E(HW.dt(s.syncedAt || s.createdAt)) : '']])}
      <h4>Items sold</h4>${itemsTbl}
      <div style="margin-top:10px"><div class="ln"><span>Subtotal</span><span>${M(s.subtotal)}</span></div>${s.itemDiscount ? `<div class="ln"><span>Item discounts</span><span>-${M(s.itemDiscount)}</span></div>` : ''}${s.cartDiscount ? `<div class="ln"><span>Cart discount</span><span>-${M(s.cartDiscount)}</span></div>` : ''}${s.tax ? `<div class="ln"><span>Tax (included)</span><span>${M(s.tax)}</span></div>` : ''}
      <div class="tot"><span>Total</span><span>${M(s.total)}</span></div><div class="ln"><span>Paid</span><span>${M(s.amountPaid)}</span></div>${s.balance > 0 ? `<div class="ln" style="color:#b45309"><b>Balance owed</b><b>${M(s.balance)}</b></div>` : ''}</div>
      <h4>Payments</h4>${payTbl}${refs ? `<h4>Refunds</h4>${refs}` : ''}</div>`;
    HW.modal({ title: `Sale ${s.receiptNumber}`, size: 'lg', body, actions: [{ label: 'Close' }, ...(HW.till && HW.till.receipt ? [{ label: HW.ic('receipt', 16) + ' Receipt', fn: () => { HW.till.receipt(id, null, 'view'); return false; } }, ...(cancelled ? [] : [{ label: HW.ic('file', 16) + ' Invoice', fn: () => { HW.till.invoice(id, null, s.invoiceNumber || s.receiptNumber); return false; } }])] : []), { label: 'Print', cls: 'd', fn: (el) => { const w = window.open('', '_blank', 'width=760,height=860'); if (!w) { HW.err('Allow pop-ups to print'); return false; } w.document.write(`<body style="font:13px/1.5 system-ui,sans-serif;margin:16px"><h3>Sale ${E(s.receiptNumber)}</h3>${$('#hs-print', el).innerHTML}<style>table{width:100%;border-collapse:collapse}td,th{padding:4px 6px;border-bottom:1px solid #ddd;text-align:left}.n{text-align:right}.kv{display:grid;grid-template-columns:130px 1fr;gap:3px 10px}.ln,.tot{display:flex;justify-content:space-between}</style></body>`); w.document.close(); w.focus(); w.print(); return false; } }] });
  };

  /* ---------- the explorer ---------- */
  async function explorer(el) {
    const [pf, pt] = (PRESETS.find((p) => p[0] === S.preset) || [])[2] ? PRESETS.find((p) => p[0] === S.preset)[2]() : [S.from, S.to];
    if (S.preset !== 'custom') { S.from = pf; S.to = pt; }
    const branches = HW.S.branches || []; if (S.branch === undefined) S.branch = HW.S.branch || '';
    let cashiers = []; try { cashiers = (await HW.all('/employees', {}, 3)).map((u) => [u._id, u.name]); } catch (e) { cashiers = []; }
    const sel = (id, opts, val) => `<select data-f="${id}">${opts.map(([k, l]) => `<option value="${E(k)}" ${String(val || '') === String(k) ? 'selected' : ''}>${E(l)}</option>`).join('')}</select>`;
    const f = S.f;
    el.innerHTML = `<div class="hs"><div class="hs-bar"><div class="grow ${S.q ? 'has' : ''}"><input data-q type="search" placeholder="Search receipt, customer, phone, cashier, item, SKU, serial, M-PESA code…" value="${E(S.q)}" aria-label="Search sales" autocomplete="off"><button type="button" data-qx aria-label="Clear search">×</button></div>
        ${branches.length > 1 ? `<label class="hs-sel">${sel('branch', [['', 'All branches'], ...branches], S.branch)}</label>` : ''}<label class="hs-sel">${sel('cashier', [['', 'All cashiers'], ...cashiers], S.cashier)}</label>
        <button class="hw-btn" data-ft>${HW.ic('filter', 15)} Filters<b data-fc></b></button><button class="hw-btn d" data-ex>${HW.ic('download', 15)} Export CSV</button></div>
      <div class="hs-bar"><div class="hs-chips">${PRESETS.map(([k, l]) => `<button data-p="${k}" class="${S.preset === k ? 'on' : ''}">${l}</button>`).join('')}<button data-p="custom" class="${S.preset === 'custom' ? 'on' : ''}">Custom</button></div>
        <label style="display:flex;gap:6px;align-items:center;font-size:13px;color:#757a88">From <input type="date" data-from value="${S.from}"></label><label style="display:flex;gap:6px;align-items:center;font-size:13px;color:#757a88">To <input type="date" data-to value="${S.to}"></label></div>
      <div class="hs-panel ${S.open ? 'open' : ''}" data-panel>
        <label>Sale status${sel('status', OPT.status, f.status)}</label><label>Payment status${sel('pay', OPT.pay, f.pay)}</label><label>Paid with${sel('method', OPT.method, f.method)}</label><label>Channel${sel('channel', OPT.channel, f.channel)}</label><label>Customer type${sel('cust', OPT.cust, f.cust)}</label><label>Source${sel('source', OPT.source, f.source)}</label>
        <label>Min total<input type="number" min="0" step="any" inputmode="decimal" data-f="min" value="${E(f.min || '')}"></label><label>Max total<input type="number" min="0" step="any" inputmode="decimal" data-f="max" value="${E(f.max || '')}"></label><label>Sort by${sel('sort', OPT.sort, f.sort || 'newest')}</label>
        <div class="ck"><label><input type="checkbox" data-f="disc" ${f.disc ? 'checked' : ''}> Had a discount</label><label><input type="checkbox" data-f="ref" ${f.ref ? 'checked' : ''}> Has refunds</label><label><input type="checkbox" data-f="bal" ${f.bal ? 'checked' : ''}> Still owing</label><label><input type="checkbox" data-f="off" ${f.off ? 'checked' : ''}> Offline sales</label></div>
        <label style="justify-content:flex-end"><button class="hw-btn" type="button" data-clear>Clear all filters</button></label></div>
      <div class="hs-tags" data-tags></div><div data-kpi></div><div data-res></div></div>`;
    let token = 0, canProfit = false; const gen = ++GEN;
    const base = () => ({ from: isoStart(S.from), to: isoEnd(S.to), branchId: S.branch || undefined, cashierId: S.cashier || undefined });
    const query = (page, limit) => { const q = { ...base(), search: S.q || undefined, saleStatus: f.status, paymentStatus: f.pay, method: f.method, channel: f.channel, source: f.source, customerType: f.cust, minTotal: f.min, maxTotal: f.max, sort: f.sort || 'newest', hasDiscount: f.disc ? '1' : undefined, hasRefund: f.ref ? '1' : undefined, hasBalance: f.bal ? '1' : undefined, offline: f.off ? '1' : undefined, page, limit }; Object.keys(q).forEach((k) => (q[k] === undefined || q[k] === '' || q[k] === false) && delete q[k]); return q; };
    const lab = (o, k) => (o.find(([x]) => x === k) || [, k])[1];
    function tags() {
      const t = []; if (f.status) t.push(['status', lab(OPT.status, f.status)]); if (f.pay) t.push(['pay', lab(OPT.pay, f.pay)]); if (f.method) t.push(['method', 'Paid with ' + lab(OPT.method, f.method)]); if (f.channel) t.push(['channel', lab(OPT.channel, f.channel)]); if (f.cust) t.push(['cust', lab(OPT.cust, f.cust)]); if (f.source) t.push(['source', lab(OPT.source, f.source)]);
      if (f.min) t.push(['min', 'Min ' + M(f.min)]); if (f.max) t.push(['max', 'Max ' + M(f.max)]); if (f.disc) t.push(['disc', 'Discounted']); if (f.ref) t.push(['ref', 'Refunded']); if (f.bal) t.push(['bal', 'Owing']); if (f.off) t.push(['off', 'Offline']);
      if (S.cashier) t.push(['_cashier', 'Cashier: ' + lab(cashiers, S.cashier)]); if (S.branch && branches.length > 1) t.push(['_branch', 'Branch: ' + lab(branches, S.branch)]);
      $('[data-fc]', el).textContent = t.filter((x) => !x[0].startsWith('_')).length ? ` (${t.filter((x) => !x[0].startsWith('_')).length})` : '';
      $('[data-tags]', el).innerHTML = t.map(([k, l]) => `<span class="hs-tag">${E(l)}<button type="button" data-rm="${k}" aria-label="Remove filter">×</button></span>`).join('');
      $$('[data-rm]', el).forEach((b) => b.onclick = () => { const k = b.dataset.rm; if (k === '_cashier') S.cashier = ''; else if (k === '_branch') S.branch = ''; else delete S.f[k]; S.page = 1; explorer(el); });
    }
    function kpis(s) {
      canProfit = s.estimatedProfit !== undefined; const avg = s.completed ? (s.revenue || 0) / s.completed : 0;
      $('[data-kpi]', el).innerHTML = HW.kpi([['Total sales', M(s.revenue), `${(s.completed || 0).toLocaleString()} completed · ${(s.cancelled || 0).toLocaleString()} cancelled`, 'b'], ['Average sale', M(avg), `${(s.sales || 0).toLocaleString()} sales found`], ['Money collected', M(s.paid), '', 'g'], ['Still owed', M(s.owed), 'Credit / part-paid', s.owed > 0 ? 'y' : 'g'], ['Discounts', M(s.discount), s.tax ? `Tax ${M(s.tax)}` : ''], ...(canProfit ? [['Est. profit', M(s.estimatedProfit), '', 'g']] : [])]);
    }
    function table(d) {
      const rows = d.items || []; const pages = d.pages || 1; if (!rows.length) { $('[data-res]', el).innerHTML = HW.empty('No sales found', 'Try a wider date range, another branch or fewer filters.'); return; }
      const cols = [{ h: 'Receipt', f: (s) => `<span class="rc"><b>${E(s.receiptNumber)}</b></span><small>${E(HW.dt(s.soldAt))}</small>${s.invoiceNumber ? `<small>Inv ${E(s.invoiceNumber)}</small>` : ''}` }, { h: 'Branch / cashier', f: (s) => `${E(s.branchName || '')}<small>${E(s.cashierName || '')}</small>` },
        { h: 'Customer', f: (s) => s.customerName ? `${E(s.customerName)}<small>${E(s.customerPhone || '')}</small>` : '<span style="color:#8d91a1">Walk-in</span>' }, { h: 'Items', f: (s) => `${E((s.itemNames || []).join(', ') || '–')}${s.moreItems ? ` +${s.moreItems} more` : ''}<small>${HW.num(s.units)} unit${s.units === 1 ? '' : 's'}${s.channel === 'WHOLESALE' ? ' · Wholesale' : ''}</small>` },
        { h: 'Total', c: 'n pr', f: (s) => `${M(s.total)}${s.discount ? `<small>Disc ${M(s.discount)}</small>` : ''}${s.refunded ? `<small style="color:#b42323">Refunded ${M(s.refunded)}</small>` : ''}` }, ...(canProfit ? [{ h: 'Profit', c: 'n', f: (s) => s.profit !== undefined ? M(s.profit) : '–' }] : []),
        { h: 'Payment', f: (s) => `${HW.badge(({ PAID: 'OK', PARTIAL: 'WA', CREDIT: 'ER' })[s.paymentStatus] || '', nice(s.paymentStatus))}<small>${E((s.methods || []).map(nice).join(', '))}</small>${s.balance > 0 ? `<small style="color:#b45309">Owes ${M(s.balance)}</small>` : ''}` },
        { h: 'Status', f: (s) => `${s.saleStatus === 'CANCELLED' ? HW.badge('ER', 'Cancelled') : HW.badge('OK', 'Completed')}${s.isOffline ? '<small>Offline sale</small>' : ''}` }, { h: '', f: () => '<span class="vw">View ›</span>' }];
      $('[data-res]', el).innerHTML = `<div class="hs-t">${HW.tbl(cols, rows, { click: true })}</div><div class="hs-pager"><span>${(d.total || 0).toLocaleString()} sale${d.total === 1 ? '' : 's'} · page ${d.page || 1} of ${pages}</span><span class="r"><select data-pl aria-label="Rows per page">${[25, 50, 100, 200].map((n) => `<option ${n === S.limit ? 'selected' : ''} value="${n}">${n} / page</option>`).join('')}</select><button class="hw-btn s" data-pv ${(d.page || 1) <= 1 ? 'disabled' : ''}>‹ Prev</button><button class="hw-btn s" data-nx ${(d.page || 1) >= pages ? 'disabled' : ''}>Next ›</button></span></div>`;
      $$('.hs-t tr[data-i]', el).forEach((tr) => { tr.classList.toggle('cx', rows[+tr.dataset.i].saleStatus === 'CANCELLED'); });
      HW.bindRows($('[data-res]', el), rows, (s) => HW.saleDetail(s.id));
      $('[data-pv]', el).onclick = () => { S.page = Math.max(1, S.page - 1); run(); }; $('[data-nx]', el).onclick = () => { S.page += 1; run(); }; $('[data-pl]', el).onchange = (e) => { S.limit = Number(e.target.value); S.page = 1; run(); };
    }
    async function run() {
      if (gen !== GEN || !el.isConnected) return; const my = ++token; $('[data-res]', el).innerHTML = HW.skeleton ? '<div class="hw-sk"><div class="b l"></div></div>' : 'Loading…'; tags();
      let d; try { d = (await Api.get('/reports/sales/all', query(S.page, S.limit))).data; } catch (e) { if (my === token) { $('[data-kpi]', el).innerHTML = ''; $('[data-res]', el).innerHTML = HW.empty('Could not load sales', e.message || 'Try again'); } return; }
      if (my !== token || gen !== GEN) return; if (d.summary) kpis(d.summary); table(d);
    }
    async function exportCsv() {
      const btn = $('[data-ex]', el); btn.classList.add('is-busy'); btn.disabled = true;
      try { let all = [], page = 1, pages = 1; do { const d = (await Api.get('/reports/sales/all', query(page, 200))).data; all = all.concat(d.items || []); pages = d.pages || 1; page++; } while (page <= pages && page <= 50);
        if (!all.length) return HW.err('Nothing to export'); const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
        const head = ['Receipt', 'Invoice', 'Date', 'Branch', 'Cashier', 'Customer', 'Phone', 'Channel', 'Items', 'Units', 'Discount', 'Total', 'Balance', 'Refunded', 'Payment status', 'Paid with', 'Status'];
        HW.csvDownload(`sales-${today()}.csv`, [head.join(','), ...all.map((s) => [s.receiptNumber, s.invoiceNumber || '', HW.dt(s.soldAt), s.branchName, s.cashierName, s.customerName || 'Walk-in', s.customerPhone || '', s.channel, (s.itemNames || []).join('; '), s.units, s.discount || 0, s.total, s.balance || 0, s.refunded || 0, s.paymentStatus, (s.methods || []).join('/'), s.saleStatus].map(q).join(','))].join('\n')); HW.ok(`${all.length} sale${all.length === 1 ? '' : 's'} exported`);
      } catch (e) { HW.err('Could not export. Try again.'); } finally { btn.classList.remove('is-busy'); btn.disabled = false; }
    }
    const readF = () => { $$('[data-panel] [data-f]', el).forEach((c) => { const k = c.dataset.f; if (c.type === 'checkbox') { if (c.checked) S.f[k] = true; else delete S.f[k]; } else if (c.value) S.f[k] = c.value; else delete S.f[k]; }); };
    $$('[data-panel] [data-f]', el).forEach((c) => c.addEventListener('change', () => { readF(); S.page = 1; run(); }));
    $$('.hs-sel [data-f]', el).forEach((c) => c.addEventListener('change', () => { S[c.dataset.f] = c.value; S.page = 1; explorer(el); }));
    $$('[data-p]', el).forEach((b) => b.onclick = () => { S.preset = b.dataset.p; S.page = 1; if (S.preset === 'custom') { $('[data-from]', el).focus(); return; } explorer(el); });
    $$('[data-from],[data-to]', el).forEach((c) => c.addEventListener('change', () => { S.preset = 'custom'; S.from = $('[data-from]', el).value || S.from; S.to = $('[data-to]', el).value || S.to; if (S.from > S.to) S.to = S.from; S.page = 1; explorer(el); }));
    $('[data-ft]', el).onclick = () => { S.open = !S.open; $('[data-panel]', el).classList.toggle('open', S.open); };
    $('[data-clear]', el).onclick = () => { S.f = {}; S.q = ''; S.cashier = ''; S.page = 1; explorer(el); };
    $('[data-ex]', el).onclick = exportCsv;
    const qi = $('[data-q]', el); let t; qi.addEventListener('input', () => { $('.grow', el).classList.toggle('has', !!qi.value); clearTimeout(t); t = setTimeout(() => { S.q = qi.value.trim(); S.page = 1; run(); }, 320); });
    qi.addEventListener('keydown', (e) => { if (e.key === 'Enter') { clearTimeout(t); S.q = qi.value.trim(); S.page = 1; run(); } });
    $('[data-qx]', el).onclick = () => { qi.value = ''; S.q = ''; S.page = 1; $('.grow', el).classList.remove('has'); run(); qi.focus(); };
    await run();
  }

  /* ---------- plug into Reports as the first tab ---------- */
  const orig = HW.V.reports;
  HW.V.reports = async (el, arg) => {
    if (HW.S.rpAll === undefined) HW.S.rpAll = HW.can('hardware.reports') || HW.can('sales.view');
    if (HW.S.rpAll) {
      el.innerHTML = `<div class="hw-tabs"><a data-allsales class="on">All sales</a><a data-back>Summary reports</a></div><div data-ex-body></div>`;
      $('[data-back]', el).onclick = () => { HW.S.rpAll = false; HW.refresh(); };
      await explorer($('[data-ex-body]', el)); return;
    }
    await orig(el, arg);
    const tabs = $('.hw-tabs', el); if (!tabs || !HW.can('hardware.reports') && !HW.can('sales.view')) return;
    tabs.insertAdjacentHTML('afterbegin', '<a data-allsales>All sales</a>'); $('[data-allsales]', tabs).onclick = () => { HW.S.rpAll = true; HW.refresh(); };
  };
})();
