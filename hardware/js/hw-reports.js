/* Hardware workspace — REPORTS (hybrid).
   Combines the full business reports (sales, profit & loss, payments, cashiers, expenses, customers owing, suppliers owed, stock)
   with the hardware-only reports (operating profit, contractor & project profit, slow materials, stock valuation, pending deliveries,
   delivery profit, transport, supplier prices) in one screen, in the Lime & Navy style.

   Loaded AFTER hw-sales.js. It replaces HW.V.reports, but keeps the old one as a fallback (so a user who only has a
   narrow permission, e.g. a driver with transport reports, still gets exactly what they had).
   Deep links:  #/reports/overview  #/reports/profit  #/reports/sales  #/reports/allsales  #/reports/payments  #/reports/cashiers
                #/reports/expenses  #/reports/customers  #/reports/suppliers  #/reports/stock  #/reports/contractors
                #/reports/delivery  #/reports/prices
   Read-only: only GET requests. Charts come from js/core/charts.js (the same dependency-free kit as reports.html: animated bars, donuts,
   waterfall, gauges, stacked bars, hover tooltips) in the Lime & Navy palette - no CDN, so it also works when the yard's internet is down. */
(function () {
  const { Api } = window, HW = window.HW; if (!HW || !HW.V || !HW.V.reports) return;
  const E = HW.E, $ = HW.$, $$ = HW.$$, M = HW.money;
  const legacy = HW.V.reports;
  const N = (n) => Number(n) || 0;
  const br = () => HW.S.branch;
  const cur = () => { try { return (window.POS_COUNTRY_INFO && window.POS_COUNTRY_INFO.currency) || localStorage.getItem('pos.currency') || 'KES'; } catch (e) { return 'KES'; } };
  const num = (n) => Math.round(N(n)).toLocaleString('en-US');
  const pct = (a, b) => (N(b) ? (N(a) / N(b)) * 100 : 0);
  const fp = (n, d = 1) => `${N(n).toFixed(d).replace(/\.0$/, '')}%`;
  const pad2 = (n) => String(n).padStart(2, '0');
  const ymd = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const addDays = (d, n) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() + n); return x; };
  const parse = (s) => { const [y, m, d] = String(s).slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d); };
  const pretty = (s) => HW.human(String(s || '').toLowerCase());
  const METHOD = { CASH: 'Cash', MPESA: 'M-PESA', MOBILE_MONEY: 'Mobile money', CARD: 'Card', BANK: 'Bank', BANK_TRANSFER: 'Bank transfer', CREDIT: 'Credit', CHEQUE: 'Cheque', OTHER: 'Other' };
  const mLabel = (m) => METHOD[m] || pretty(m);
  const settle = (p) => p.then((r) => r.data, () => null);
  const get = (path, q) => settle(Api.get(path, q));
  const can = (p) => HW.can(p);
  const canView = () => can('reports.view') || can('hardware.reports') || can('sales.view');
  const canProfit = () => can('reports.profit') || can('hardware.reports') || can('hardware.finance');

  /* ---------- date range (kept while the user moves between tabs) ---------- */
  const today = () => ymd(new Date());
  const PRESETS = [
    ['today', 'Today', () => [today(), today()]],
    ['7d', 'Last 7 days', () => [ymd(addDays(new Date(), -6)), today()]],
    ['month', 'This month', () => [HW.monthStart(), today()]],
    ['lmonth', 'Last month', () => { const d = new Date(); return [ymd(new Date(d.getFullYear(), d.getMonth() - 1, 1)), ymd(new Date(d.getFullYear(), d.getMonth(), 0))]; }],
    ['quarter', 'Last 90 days', () => [ymd(addDays(new Date(), -89)), today()]],
    ['year', 'This year', () => [`${new Date().getFullYear()}-01-01`, today()]],
  ];
  const R = HW.S.rp = HW.S.rp || { preset: 'month', from: HW.monthStart(), to: today() };
  const q = () => ({ from: R.from, to: R.to + 'T23:59:59', branchId: br() });
  const prevRange = () => { const a = parse(R.from), b = parse(R.to), len = Math.round((b - a) / 864e5) + 1; const pb = addDays(a, -1), pa = addDays(pb, -(len - 1)); return { from: ymd(pa), to: ymd(pb) + 'T23:59:59', branchId: br() }; };
  const periodText = () => (R.from === R.to ? HW.date(R.from) : `${HW.date(R.from)} – ${HW.date(R.to)}`);

  /* ---------- tiny visual helpers ---------- */
  const card = (title, body, right, cls) => `<div class="hw-card hwr-card ${cls || ''}"><div class="hwr-h"><h3>${title}</h3>${right ? `<span class="hwr-r">${right}</span>` : ''}</div>${body}</div>`;
  const note = (tone, html) => `<div class="hwr-ins ${tone}">${html}</div>`;
  const link = (tab, label) => `<a class="hwr-more" href="#/reports/${tab}">${label} ›</a>`;
  const compact = (n) => { const v = N(n), a = Math.abs(v); const t = (x) => x.toFixed(1).replace(/\.0$/, ''); return a >= 1e9 ? t(v / 1e9) + 'B' : a >= 1e6 ? t(v / 1e6) + 'M' : a >= 1e3 ? t(v / 1e3) + 'K' : String(Math.round(v)); };
  const change = (cur, prev, goodUp = true) => {
    if (!N(prev)) return '';
    const p = ((N(cur) - N(prev)) / Math.abs(N(prev))) * 100, up = p >= 0, good = up === goodUp;
    return `<span class="hwr-chg ${good ? 'good' : 'bad'}">${up ? '▲' : '▼'} ${Math.abs(p).toFixed(1)}% vs previous period</span>`;
  };
  const kpi = (items) => HW.kpi(items);


  /* ---------- charts (js/core/charts.js, same kit as reports.html) ---------- */
  const CH = window.Charts;
  const C = { navy: '#1d1c35', lime: '#c3e03a', limeL: '#e4f27d', violet: '#6c5ce7', amber: '#f59e0b', teal: '#14b8a6', coral: '#ef6a6a', blue: '#3b82f6', pink: '#ec4899', green: '#16a34a', red: '#e5484d', slate: '#8b8fa3' };
  const PAL = [C.violet, C.lime, C.amber, C.teal, C.coral, C.blue, C.pink, C.navy];
  if (CH && CH.setPalette) CH.setPalette(PAL);
  const MCOL = { CASH: C.amber, MPESA: C.green, MOBILE_MONEY: C.green, CARD: C.blue, BANK: C.violet, BANK_TRANSFER: C.violet, CREDIT: C.coral, CHEQUE: C.teal, OTHER: C.slate };
  const mColor = (m, i) => MCOL[m] || PAL[(i + 4) % PAL.length];
  const m0 = (n) => `${cur()} ${num(n)}`;
  let uid = 0, queue = [];
  /** A chart placeholder: html now, drawn by flush() once it is in the page (charts measure their real width). */
  const slot = (draw, cls = '') => { const id = `hwc${++uid}`; queue.push(() => { const el = document.getElementById(id); if (el) draw(el); }); return `<div class="hwr-ch ${cls}" id="${id}"></div>`; };
  const flush = () => { const q = queue; queue = []; q.forEach((f) => { try { f(); } catch (e) { if (window.console) console.warn('chart', e); } }); };
  const noChart = (t, m) => HW.empty(t, m);
  const legend = (items) => `<div class="hwr-leg">${items.map(([c, l]) => `<span><i style="background:${c}"></i>${l}</span>`).join('')}</div>`;
  const dayLabel = (d, n) => { try { return new Intl.DateTimeFormat('en-GB', n <= 7 ? { weekday: 'short' } : { day: '2-digit', month: 'short' }).format(parse(d)); } catch (e) { return d; } };
  /** Daily net sales: weekdays lime, weekends teal, the best day navy. */
  function trendChart(trend) {
    const pts = (trend || []).map((t) => ({ d: String(t.date).slice(0, 10), v: N(t.netSales), n: N(t.transactionCount) }));
    if (!pts.length || pts.every((p) => !p.v)) return noChart('No daily sales in this period', 'Try a wider date range.');
    const best = pts.reduce((a, x) => (x.v > a.v ? x : a), pts[0]), tot = pts.reduce((a, x) => a + x.v, 0), avg = tot / pts.length, we = (d) => { const w = parse(d).getDay(); return w === 0 || w === 6; };
    const sum = `<div class="hwr-sum"><div><small>Best day</small><b>${E(HW.date(best.d))}</b><em>${E(m0(best.v))}</em></div><div><small>Daily average</small><b>${E(m0(avg))}</b><em>${pts.length} day${pts.length === 1 ? '' : 's'}</em></div><div><small>Total</small><b>${E(m0(tot))}</b><em>${num(pts.reduce((a, x) => a + x.n, 0))} sales</em></div></div>`;
    return sum + legend([[C.lime, 'Weekday'], [C.teal, 'Weekend'], [C.navy, 'Best day']]) + slot((el) => CH.bar(el, {
      labels: pts.map((p) => dayLabel(p.d, pts.length)), height: 330, fixedHeight: 330, format: CH.compact, tipFormat: M, ariaLabel: 'Net sales by day',
      series: [{ name: 'Net sales', values: pts.map((p) => p.v), colors: pts.map((p) => (p === best ? C.navy : we(p.d) ? C.teal : C.lime)) }], showValues: pts.length <= 8, emptyText: 'No daily sales to chart in this period.',
    }), 'tall');
  }
  const payDonut = (rows, empty) => slot((el) => CH.donut(el, { data: rows.map((x, i) => ({ label: mLabel(x.method), value: N(x.total), color: mColor(x.method, i) })), format: m0, tipFormat: M, centerLabel: 'Collected', fixedSize: 230, ariaLabel: 'Payment methods', emptyText: empty || 'No payments yet' }), 'mid');
  const catChart = (rows) => slot((el) => CH.donut(el, { data: rows.map((r, i) => ({ label: r.l, value: N(r.v), color: PAL[i % PAL.length] })), format: m0, tipFormat: M, centerLabel: 'Total', fixedSize: 230, ariaLabel: 'Share by category', emptyText: 'No approved expenses in this period.' }), 'mid');
  const payStack = (rows) => slot((el) => CH.stackbar(el, { segments: rows.map((x, i) => ({ label: mLabel(x.method), value: N(x.total), color: mColor(x.method, i) })), format: M, emptyText: 'No payments yet' }));
  const prodBars = (products) => slot((el) => CH.hbar(el, { data: (products || []).map((x, i) => ({ label: x.name || 'Material', value: N(x.revenue), sub: `${HW.num(x.quantity, 2)} sold`, color: PAL[i % PAL.length] })), format: m0, valueLabel: 'Revenue', ranked: true, emptyText: 'No sales yet' }));
  const rankBars = (rows, label, colorFn) => slot((el) => CH.hbar(el, { data: rows.map((r, i) => ({ label: r.l, value: N(r.v), sub: r.s, color: colorFn ? colorFn(r, i) : PAL[i % PAL.length] })), format: m0, valueLabel: label, ranked: true, emptyText: 'Nothing to show yet' }));
  /** Revenue -> cost of goods -> gross profit -> expenses -> net profit (same walk as reports.html). */
  const wfChart = (p) => slot((el) => CH.waterfall(el, { steps: [
    { label: 'Revenue', value: N(p.grossRevenue), kind: 'total', color: C.violet }, { label: 'Cost of goods', value: -N(p.costOfGoodsSold), kind: 'delta', color: C.amber },
    { label: 'Gross profit', value: N(p.grossProfit), kind: 'total', color: C.teal }, { label: 'Expenses', value: -N(p.expenses), kind: 'delta', color: C.coral },
    { label: 'Net profit', value: N(p.netProfit), kind: 'total', color: N(p.netProfit) >= 0 ? C.green : C.red }], format: CH.compact, tipFormat: M, height: 320, fixedHeight: 320, ariaLabel: 'Revenue to net profit' }), 'tall');
  const gaugeRow = (p) => { const rev = N(p.grossRevenue), gm = pct(p.grossProfit, rev), nm = pct(p.netProfit, rev), er = pct(p.expenses, rev);
    return `<div class="hwr-gauges">${[['Gross margin', 'After stock cost', gm, C.teal], ['Net margin', 'After expenses', nm, nm >= 0 ? C.violet : C.red], ['Expense ratio', 'Lower is better', er, C.amber]].map(([l, sub, v, c]) => slot((el) => CH.gauge(el, { value: v, label: l, sub, color: c }))).join('')}</div>`; };
  const hundred = (p) => { const rev = N(p.grossRevenue); if (rev <= 0) return noChart('No sales yet', 'Nothing to split in this period.');
    const np = N(p.netProfit); return slot((el) => CH.stackbar(el, { segments: [{ label: 'Stock cost', value: N(p.costOfGoodsSold), color: C.amber }, { label: 'Expenses', value: N(p.expenses), color: C.coral }, { label: np >= 0 ? 'Profit' : 'Loss (uncovered)', value: Math.abs(np), color: np >= 0 ? C.green : C.red }], format: M })) + `<p class="hwr-sub">Out of every ${cur()} 100 of sales: about ${cur()} ${pct(p.costOfGoodsSold, rev).toFixed(0)} goes on stock, ${cur()} ${pct(p.expenses, rev).toFixed(0)} on expenses and ${cur()} ${pct(np, rev).toFixed(0)} is ${np >= 0 ? 'yours to keep' : 'a shortfall'}.</p>`; };
  const cashBars = (list) => rankBars(list.map((c) => ({ l: c.name, v: c.totalSales, s: `${num(c.transactionCount)} sales` })), 'Sales');
  const shareDonut = (rows, label) => slot((el) => CH.donut(el, { data: rows.map((r, i) => ({ label: r.l, value: N(r.v), color: PAL[i % PAL.length] })), format: m0, tipFormat: M, centerLabel: label, fixedSize: 230, ariaLabel: label }), 'mid');
  const stockHealth = (d) => { const tot = N(d.totalSkus), low = N(d.lowStockCount), out = N(d.outOfStockCount), ok = Math.max(0, tot - low - out);
    return slot((el) => CH.stackbar(el, { segments: [{ label: 'Well stocked', value: ok, color: C.green }, { label: 'Running low', value: low, color: C.amber }, { label: 'Out of stock', value: out, color: C.red }], format: (n) => `${num(n)} products` })) + slot((el) => CH.gauge(el, { value: pct(ok, tot), label: 'Products well stocked', sub: `${num(ok)} of ${num(tot)} products`, color: pct(ok, tot) >= 85 ? C.green : pct(ok, tot) >= 65 ? C.amber : C.red }), 'g1'); };

  /* ---------- profit verdict (plain words for the owner) ---------- */
  function verdict(p, extra) {
    const rev = N(p.grossRevenue), cogs = N(p.costOfGoodsSold), gp = N(p.grossProfit), exp = N(p.expenses), np = N(p.netProfit);
    if (!rev && !exp) return note('bl', '<b>Nothing to calculate yet.</b> There are no completed sales or approved expenses in this period.');
    const nm = pct(np, rev), gm = pct(gp, rev), c = cur();
    let h;
    if (np >= 0) {
      const tag = nm >= 15 ? 'Strong' : nm >= 5 ? 'Healthy' : 'Thin';
      h = `<div class="hwr-verdict ok"><div class="vi">✔</div><div><span class="vt">${tag} · making a profit</span><b>The business made ${M(np)} profit in this period.</b><p>Out of every ${c} 100 of sales (before tax) you keep about <b>${c} ${nm.toFixed(1)}</b> after stock costs and expenses.${nm < 5 ? ' That margin is thin — a small drop in sales or rise in costs could push you into a loss.' : ''}</p></div></div>`;
    } else {
      const why = gp < 0 ? 'Goods were sold for less than they cost — check your selling and cost prices.' : `Expenses (${M(exp)}) are bigger than the gross profit (${M(gp)}).`;
      h = `<div class="hwr-verdict er"><div class="vi">!</div><div><span class="vt">Making a loss</span><b>The business made a loss of ${M(Math.abs(np))} in this period.</b><p>${why}</p></div></div>`;
    }
    const ins = [];
    if (gp > 0 && exp > 0) { const be = exp / (gp / rev); ins.push(note(rev >= be ? 'ok' : 'wa', `<b>Break-even:</b> you need about <b>${M(be)}</b> in sales to cover your expenses at the current margin — you are at <b>${fp(pct(rev, be), 0)}</b> of that.`)); }
    if (gm < 15 && rev) ins.push(note('wa', `<b>Gross margin is ${fp(gm)}.</b> Building materials usually need more room than this after transport and handling — review cost prices and discounts.`));
    if (gp > 0 && pct(exp, gp) > 80) ins.push(note('wa', `<b>Expenses take ${fp(pct(exp, gp), 0)} of your gross profit.</b> Little is left over for you.`));
    if (cogs > 0 && rev) ins.push(note('bl', `Stock costs are <b>${fp(pct(cogs, rev))}</b> of sales; expenses are <b>${fp(pct(exp, rev))}</b>.`));
    if (extra) ins.push(...extra);
    return h + (ins.length ? `<div class="hwr-insl">${ins.join('')}</div>` : '');
  }
  function waterfall(p) {
    const rev = N(p.grossRevenue);
    const rows = [['Revenue (before tax)', rev, ''], ['Cost of goods sold', -N(p.costOfGoodsSold), ''], ['Gross profit', N(p.grossProfit), 'st'], ['Expenses (approved)', -N(p.expenses), ''], ['Net profit', N(p.netProfit), 'st tot']];
    return `<div class="hw-tw"><table class="hw-t"><thead><tr><th>Line</th><th class="n">Amount</th><th class="n">% of revenue</th><th></th></tr></thead><tbody>${rows.map(([l, v, c]) => `<tr class="${c}"><td>${l}</td><td class="n ${v < 0 ? 'neg' : ''}">${v < 0 ? '−' + M(-v) : M(v)}</td><td class="n">${rev ? fp(pct(Math.abs(v), rev)) : '–'}</td><td style="width:34%"><span class="hwr-mb"><i class="${v < 0 ? 'neg' : ''}" style="width:${rev ? Math.min(100, Math.round(pct(Math.abs(v), rev))) : 0}%"></i></span></td></tr>`).join('')}</tbody></table></div>`;
  }

  /* ---------- tab content ---------- */
  const T = {};

  T.overview = async (b) => {
    const wantProfit = canProfit(), pr = prevRange();
    const [s, p, pp, d, ex, inv, sup] = await Promise.all([
      get('/reports/sales', q()), wantProfit ? get('/reports/profit', q()) : null, wantProfit ? get('/reports/profit', pr) : null,
      can('hardware.reports') ? get('/hardware/dashboard', { branchId: br() }) : null, get('/reports/expenses', q()), get('/reports/inventory', { branchId: br() }), get('/reports/suppliers', {}),
    ]);
    const net = N(s && s.netSales), tx = N(s && s.transactionCount);
    const banner = p ? verdict(p) : '';
    const items = [['Net sales', M(net), s ? change(net, 0) || `${num(tx)} sale${tx === 1 ? '' : 's'}` : '', 'b']];
    if (p) items.push(['Gross profit', M(p.grossProfit), `${fp(pct(p.grossProfit, p.grossRevenue))} margin`, N(p.grossProfit) >= 0 ? 'g' : 'r'], ['Expenses', M(p.expenses), `${fp(pct(p.expenses, p.grossRevenue))} of revenue`, 'y'], ['Net profit', M(p.netProfit), (pp ? change(p.netProfit, pp.netProfit) : '') || `${fp(pct(p.netProfit, p.grossRevenue))} net margin`, N(p.netProfit) >= 0 ? 'g' : 'r']);
    items.push(['Average sale', M(tx ? net / tx : 0), `${num(tx)} transactions`]);
    if (d) items.push(['Owed by customers', M(d.totalOwed), N(d.totalOverdue) > 0 ? `${M(d.totalOverdue)} overdue` : 'nothing overdue', N(d.totalOverdue) > 0 ? 'r' : 'g']);
    if (inv && inv.totalSkus) items.push(['Stock value', M(inv.inventoryValuation), `${num(inv.lowStockCount)} low · ${num(inv.outOfStockCount)} out`, N(inv.outOfStockCount) ? 'y' : '']);
    if (sup && N(sup.totalPayable)) items.push(['You owe suppliers', M(sup.totalPayable), `${num((sup.suppliers || []).length)} supplier${(sup.suppliers || []).length === 1 ? '' : 's'}`, 'y']);
    const products = ((s && s.topProducts) || []).slice(0, 6), pay = ((s && s.paymentBreakdown) || []).slice().sort((a, b2) => b2.total - a.total), payTot = pay.reduce((a, x) => a + N(x.total), 0);
    const cats = {}; ((ex && ex.breakdown) || []).filter((r) => r.status === 'APPROVED' || !r.status).forEach((r) => { cats[r.category] = (cats[r.category] || 0) + N(r.total); });
    const catRows = Object.entries(cats).sort((a, c) => c[1] - a[1]).slice(0, 6).map(([k, v]) => ({ l: pretty(k), v }));
    b.innerHTML = `${banner}${kpi(items)}
      ${p ? `<div class="hwr-g2">${card('Where each ' + cur() + ' 100 of sales went', hundred(p), 'Stock cost · expenses · profit')}${card('Profit health', gaugeRow(p), link('profit', 'Full profit & loss'))}</div>` : ''}
      <div class="hwr-g2">${card('Sales trend', s ? trendChart(s.dailyTrend) : HW.empty('Not available', 'Sales figures could not be loaded.'), link('sales', 'Full sales report'))}${card('How customers paid', payDonut(pay), link('payments', 'Payments'))}</div>
      <div class="hwr-g2">${card('Top materials', prodBars(products), link('sales', 'More'))}${card('Where the money went (expenses)', catChart(catRows), link('expenses', 'Expenses'))}</div>
      ${d && (d.contractorBalances || []).length ? card('Top customers owing', HW.tbl([{ h: 'Customer', f: (r) => E(r.name || '') }, { h: 'Owed', c: 'n', f: (r) => M(r.owed) }, { h: 'Limit used', c: 'n', f: (r) => HW.num(r.usedPct, 0) + '%' }], d.contractorBalances), link('customers', 'All customers owing')) : ''}`;
  };

  T.profit = async (b) => {
    const pr = prevRange();
    const [p, pp, ex, op, dp, co] = await Promise.all([
      get('/reports/profit', q()), get('/reports/profit', pr), get('/reports/expenses', q()),
      can('hardware.finance') || can('hardware.reports') ? get('/hardware/reports/operating-profit', q()) : null,
      can('hardware.reports') ? get('/hardware/reports/delivery-profit', q()) : null, can('hardware.reports') ? get('/hardware/reports/contractors', q()) : null,
    ]);
    if (!p) { b.innerHTML = HW.empty('Profit & loss is not available', 'You may need the "view profit" permission.'); return; }
    const cats = {}; ((ex && ex.breakdown) || []).filter((r) => r.status === 'APPROVED').forEach((r) => { cats[r.category] = (cats[r.category] || 0) + N(r.total); });
    const catRows = Object.entries(cats).sort((a, c) => c[1] - a[1]).map(([k, v]) => ({ l: pretty(k), v, s: fp(pct(v, p.grossRevenue)) + ' of revenue' }));
    const days = Math.max(1, Math.round((parse(R.to) - parse(R.from)) / 864e5) + 1);
    b.innerHTML = `${verdict(p)}
      ${kpi([['Revenue', M(p.grossRevenue), 'Sales before tax', 'b'], ['Cost of goods sold', M(p.costOfGoodsSold), `${fp(pct(p.costOfGoodsSold, p.grossRevenue))} of revenue`, 'y'], ['Gross profit', M(p.grossProfit), `${fp(pct(p.grossProfit, p.grossRevenue))} margin`, N(p.grossProfit) >= 0 ? 'g' : 'r'], ['Expenses', M(p.expenses), `${fp(pct(p.expenses, p.grossRevenue))} of revenue`, 'y'], ['Net profit', M(p.netProfit), (pp ? change(p.netProfit, pp.netProfit) : '') || `${fp(pct(p.netProfit, p.grossRevenue))} net margin`, N(p.netProfit) >= 0 ? 'g' : 'r'], ['Profit per day', M(N(p.netProfit) / days), `over ${days} day${days === 1 ? '' : 's'}`]])}
      ${card('Revenue to net profit', wfChart(p), 'How each part of your sales was used')}<div class="hwr-g2">${card('Where each ' + cur() + ' 100 of sales went', hundred(p))}${card('Profit health', gaugeRow(p))}</div><div class="hwr-g2">${card('Profit & loss statement', waterfall(p), 'Only approved expenses reduce profit')}${card('Expenses by category', catChart(catRows), link('expenses', 'Expenses'))}</div>
      ${pp ? card('Compared with the previous period', HW.tbl([{ h: 'Line', f: (r) => r[0] }, { h: 'This period', c: 'n', f: (r) => M(r[1]) }, { h: 'Previous', c: 'n', f: (r) => M(r[2]) }, { h: 'Change', c: 'n', f: (r) => (N(r[2]) ? `<span class="${(N(r[1]) - N(r[2])) * r[3] >= 0 ? 'hwr-up' : 'hwr-dn'}">${N(r[1]) >= N(r[2]) ? '▲' : '▼'} ${Math.abs(((N(r[1]) - N(r[2])) / Math.abs(N(r[2]))) * 100).toFixed(1)}%</span>` : '–') }], [['Revenue', p.grossRevenue, pp.grossRevenue, 1], ['Cost of goods sold', p.costOfGoodsSold, pp.costOfGoodsSold, -1], ['Gross profit', p.grossProfit, pp.grossProfit, 1], ['Expenses', p.expenses, pp.expenses, -1], ['Net profit', p.netProfit, pp.netProfit, 1]]), periodText() + ' vs the same length before') : ''}
      ${op ? card('Operating profit — hardware view', `<p class="hwr-sub">Keeps owner drawings, loans and capital purchases out of your operating profit, so you see what the yard really earns.</p>${HW.auto(op)}`) : ''}
      ${dp ? card('Delivery profit', HW.auto(dp), link('delivery', 'Deliveries & transport')) : ''}
      ${co ? card('Contractor & project profit', HW.auto(co), link('contractors', 'Open')) : ''}`;
  };

  T.sales = async (b) => {
    const [s, h] = await Promise.all([get('/reports/sales', q()), can('hardware.reports') ? get('/hardware/reports/sales', { ...q(), by: HW.S.rpBy || 'product' }) : null]);
    if (!s) { b.innerHTML = HW.empty('Sales report not available', 'You may need the "view reports" permission.'); return; }
    const tx = N(s.transactionCount); if (!tx) { b.innerHTML = HW.empty('No completed sales in this period', 'Try a wider date range or another branch.'); return; }
    const net = N(s.netSales), gross = N(s.totalSales), products = s.topProducts || [], topRev = products.reduce((a, x) => a + N(x.revenue), 0);
    const pay = (s.paymentBreakdown || []).slice().sort((a, c) => c.total - a.total), payTot = pay.reduce((a, x) => a + N(x.total), 0);
    const ins = []; if (products[0]) ins.push(note('bl', `<b>${E(products[0].name)}</b> is the best seller: ${M(products[0].revenue)} (${fp(pct(products[0].revenue, topRev), 0)} of the top-10 revenue).`)); if (pay[0]) ins.push(note('ok', `<b>${E(mLabel(pay[0].method))}</b> brought in ${fp(pct(pay[0].total, payTot), 0)} of the money collected.`));
    if (N(s.totalRefunds) > 0) ins.push(note(pct(s.totalRefunds, net) > 5 ? 'wa' : 'bl', `Refunds are <b>${fp(pct(s.totalRefunds, net))}</b> of net sales (${M(s.totalRefunds)}).`));
    if (N(s.totalDiscount) > 0) ins.push(note(pct(s.totalDiscount, gross) > 10 ? 'wa' : 'bl', `Discounts given: <b>${M(s.totalDiscount)}</b> (${fp(pct(s.totalDiscount, gross))} of gross sales).`));
    b.innerHTML = `${kpi([['Net sales', M(net), 'Total charged to customers', 'b'], ['Gross sales', M(gross), 'Sum of sale subtotals'], ['Transactions', num(tx), 'Completed sales'], ['Average sale', M(net / tx), 'Net sales per transaction', 'g'], ['Discounts', M(s.totalDiscount), `${fp(pct(s.totalDiscount, gross))} of gross`, N(s.totalDiscount) ? 'y' : ''], ['Tax collected', M(s.totalTax)], ['Refunds', M(s.totalRefunds), `${fp(pct(s.totalRefunds, net))} of net sales`, N(s.totalRefunds) ? 'r' : 'g']])}
      <div class="hwr-insl">${ins.join('')}</div>
      ${card('Sales trend', trendChart(s.dailyTrend), 'Net sales by day · ' + periodText())}
      <div class="hwr-g2">${card('Top products by revenue', prodBars(products))}${card('How customers paid', payDonut(pay))}</div>
      <div class="hwr-g2">${card('Top products', HW.tbl([{ h: '#', f: (r) => r.i }, { h: 'Product', f: (r) => `<b>${E(r.name)}</b>` }, { h: 'Units', c: 'n', f: (r) => HW.num(r.quantity, 2) }, { h: 'Revenue', c: 'n pr', f: (r) => M(r.revenue) }, { h: 'Share', c: 'n', f: (r) => fp(pct(r.revenue, topRev), 0) }], products.map((x, i) => ({ ...x, i: i + 1 })), { empty: 'No products sold' }))}${card('Payment mix', payStack(pay))}</div>
      ${h ? card('Sales & margin by …', `<div class="hw-bar" style="margin:0 0 10px"><label>Group by <select data-by>${['product', 'unit', 'category'].map((x) => `<option ${x === (HW.S.rpBy || 'product') ? 'selected' : ''}>${x}</option>`).join('')}</select></label></div>${HW.auto(h)}`, 'Hardware: revenue, cost and margin') : ''}
      <div class="hwr-links">${link('allsales', 'Open every sale (All sales)')}</div>`;
    const sel = $('[data-by]', b); if (sel) sel.onchange = () => { HW.S.rpBy = sel.value; HW.refresh(); };
  };

  T.payments = async (b) => {
    const d = await get('/reports/payments', q()); const rows = (d && d.breakdown) || [];
    if (!rows.length) { b.innerHTML = HW.empty('No payments in this period', 'Payments appear here once sales are paid for.'); return; }
    const ok = rows.filter((r) => r.status === 'SUCCESS'), other = rows.filter((r) => r.status !== 'SUCCESS');
    const col = ok.reduce((a, r) => a + N(r.total), 0), okN = ok.reduce((a, r) => a + N(r.count), 0), oT = other.reduce((a, r) => a + N(r.total), 0), oN = other.reduce((a, r) => a + N(r.count), 0);
    const by = {}; ok.forEach((r) => { by[r.method] = (by[r.method] || 0) + N(r.total); });
    const top = Object.entries(by).sort((a, c) => c[1] - a[1]);
    b.innerHTML = `${kpi([['Money collected', M(col), 'Successful payments', 'g'], ['Not successful', num(oN), oN ? `${M(oT)} pending, failed or reversed` : 'All payments went through', oN ? 'y' : 'g'], ['Successful payments', num(okN)], ['Top method', top[0] ? mLabel(top[0][0]) : '–', top[0] ? `${fp(pct(top[0][1], col), 0)} of collected` : '', 'b']])}
      <div class="hwr-g2">${card('Collected by method', payDonut(top.map(([m, v]) => ({ method: m, total: v }))))}${card('All payments', HW.tbl([{ h: 'Method', f: (r) => `<b>${E(mLabel(r.method))}</b>` }, { h: 'Status', f: (r) => HW.badge(r.status === 'SUCCESS' ? 'OK' : /FAIL|REVERS/.test(r.status) ? 'ER' : 'WA', pretty(r.status)) }, { h: 'Payments', c: 'n', f: (r) => num(r.count) }, { h: 'Total', c: 'n pr', f: (r) => M(r.total) }], rows.slice().sort((a, c) => N(c.total) - N(a.total))))}</div>`;
  };

  T.cashiers = async (b) => {
    const d = await get('/reports/cashiers', q()); const list = (d && d.cashiers) || [];
    if (!list.length) { b.innerHTML = HW.empty('No cashier activity in this period', 'Sales rung up by your team show up here.'); return; }
    const total = list.reduce((a, c) => a + N(c.totalSales), 0), tx = list.reduce((a, c) => a + N(c.transactionCount), 0), best = list[0], bestAvg = list.slice().sort((a, c) => N(c.averageSale) - N(a.averageSale))[0];
    b.innerHTML = `${kpi([['Staff who sold', num(list.length), '', 'b'], ['Total sales', M(total), `${num(tx)} transactions`, 'g'], ['Top seller', E(best.name), `${M(best.totalSales)} · ${fp(pct(best.totalSales, total), 0)} of sales`], ['Highest average sale', E(bestAvg.name), M(bestAvg.averageSale)]])}
      <div class="hwr-g2">${card('Sales by cashier', cashBars(list))}${card('Share of total sales', shareDonut(list.map((c) => ({ l: c.name, v: c.totalSales })), 'Total sales'))}</div>
      ${card('Staff performance', HW.tbl([{ h: '#', f: (r) => r.i }, { h: 'Cashier', f: (r) => `<b>${E(r.name)}</b>` }, { h: 'Sales', c: 'n', f: (r) => num(r.transactionCount) }, { h: 'Total', c: 'n pr', f: (r) => M(r.totalSales) }, { h: 'Average sale', c: 'n', f: (r) => M(r.averageSale) }, { h: 'Share', f: (r) => `<span class="hwr-mb"><i style="width:${Math.round(pct(r.totalSales, total))}%"></i></span> ${fp(pct(r.totalSales, total), 0)}` }], list.map((x, i) => ({ ...x, i: i + 1 }))))}`;
  };

  T.expenses = async (b) => {
    const [d, p] = await Promise.all([get('/reports/expenses', q()), canProfit() ? get('/reports/profit', q()) : null]); const rows = (d && d.breakdown) || [];
    if (!rows.length) { b.innerHTML = HW.empty('No expenses in this period', 'Record expenses on the Expenses page and they will be analysed here.'); return; }
    const statuses = [...new Set(rows.map((r) => r.status))]; let cur2 = HW.S.rpExpSt && (HW.S.rpExpSt === 'ALL' || statuses.includes(HW.S.rpExpSt)) ? HW.S.rpExpSt : (statuses.includes('APPROVED') ? 'APPROVED' : 'ALL');
    const pending = rows.filter((r) => r.status === 'PENDING').reduce((a, r) => a + N(r.total), 0);
    const paint = () => {
      const sel = cur2 === 'ALL' ? rows : rows.filter((r) => r.status === cur2), cats = {};
      sel.forEach((r) => { const c = cats[r.category] || (cats[r.category] = { category: r.category, total: 0, count: 0 }); c.total += N(r.total); c.count += N(r.count); });
      const by = Object.values(cats).sort((a, c) => c.total - a.total), tot = by.reduce((a, c) => a + c.total, 0), cnt = by.reduce((a, c) => a + c.count, 0);
      $('[data-ex]', b).innerHTML = by.length ? `${kpi([[cur2 === 'ALL' ? 'All expenses' : pretty(cur2) + ' expenses', M(tot), `${num(cnt)} entries`, 'y'], ['Biggest category', E(pretty(by[0].category)), `${M(by[0].total)} · ${fp(pct(by[0].total, tot), 0)}`], ['Categories', num(by.length)], ...(p && cur2 === 'APPROVED' ? [['Share of revenue', fp(pct(tot, p.grossRevenue)), 'of sales before tax', pct(tot, p.grossRevenue) > 30 ? 'r' : 'g']] : []), ...(pending > 0 ? [['Waiting for approval', M(pending), 'Not counted in profit yet', 'r']] : [])])}
        <div class="hwr-g2">${card('Where the money went', catChart(by.map((c) => ({ l: pretty(c.category), v: c.total }))))}${card('Breakdown', HW.tbl([{ h: 'Category', f: (r) => `<b>${E(pretty(r.category))}</b>` }, { h: 'Entries', c: 'n', f: (r) => num(r.count) }, { h: 'Total', c: 'n pr', f: (r) => M(r.total) }, { h: 'Share', c: 'n', f: (r) => fp(pct(r.total, tot), 0) }], by))}</div>` : HW.empty('Nothing with this status', 'Pick another status above.');
    };
    b.innerHTML = `<div class="hwr-chips" data-st>${['ALL', ...statuses].map((s) => `<button data-s="${s}" class="${s === cur2 ? 'on' : ''}">${s === 'ALL' ? 'All' : pretty(s)}</button>`).join('')}<span class="hwr-sub">Only approved expenses reduce profit.</span></div><div data-ex></div>`;
    $$('[data-s]', b).forEach((x) => x.onclick = () => { cur2 = HW.S.rpExpSt = x.dataset.s; $$('[data-s]', b).forEach((y) => y.classList.toggle('on', y === x)); paint(); flush(); });
    paint();
  };

  T.customers = async (b) => {
    const d = await get('/reports/customers', {}); const list = (d && d.customers) || [];
    if (!list.length) { b.innerHTML = HW.empty('No customer owes you anything', 'Credit sales that are not fully paid will be listed here.'); return; }
    const over = list.filter((c) => N(c.creditLimit) > 0 && N(c.outstandingBalance) > N(c.creditLimit)), top3 = list.slice(0, 3).reduce((a, c) => a + N(c.outstandingBalance), 0);
    b.innerHTML = `${kpi([['Owed to you', M(d.totalOutstanding), 'Unpaid credit sales', 'y'], ['Customers with a balance', num(list.length), list.length >= 50 ? 'Showing the top 50' : ''], ['Top 3 customers', fp(pct(top3, d.totalOutstanding), 0), 'of everything owed', pct(top3, d.totalOutstanding) > 60 ? 'r' : 'g'], ['Over credit limit', num(over.length), over.length ? 'Collect or review limits' : 'Everyone within limit', over.length ? 'r' : 'g']])}
      <div class="hwr-g2">${card('Who owes you the most', rankBars(list.slice(0, 8).map((c) => ({ l: c.name, v: c.outstandingBalance, s: N(c.creditLimit) ? `${fp(pct(c.outstandingBalance, c.creditLimit), 0)} of limit` : 'no limit set' })), 'Owes', (r, i) => { const c = list[i]; return N(c.creditLimit) > 0 && N(c.outstandingBalance) > N(c.creditLimit) ? C.red : PAL[(i + 1) % PAL.length]; }), 'Red = over credit limit')}${card('Share of what is owed', shareDonut(list.slice(0, 6).map((c) => ({ l: c.name, v: c.outstandingBalance })), 'Owed'), 'Top customers')}</div>
      ${card('Customer balances', HW.tbl([{ h: 'Customer', f: (c) => `<b>${E(c.name)}</b>${c.phone ? `<small style="display:block;color:#757a88">${E(c.phone)}</small>` : ''}` }, { h: 'Owes', c: 'n pr', f: (c) => M(c.outstandingBalance) }, { h: 'Credit limit', c: 'n', f: (c) => (N(c.creditLimit) ? M(c.creditLimit) : '–') }, { h: 'Limit used', f: (c) => { if (!N(c.creditLimit)) return '–'; const u = pct(c.outstandingBalance, c.creditLimit); return `<span class="hwr-mb"><i class="${u > 100 ? 'neg' : ''}" style="width:${Math.min(100, Math.round(u))}%"></i></span> ${u.toFixed(0)}%${u > 100 ? ' ' + HW.badge('ER', 'Over limit') : ''}`; } }, { h: 'Share', c: 'n', f: (c) => fp(pct(c.outstandingBalance, d.totalOutstanding), 0) }], list))}`;
  };

  T.suppliers = async (b) => {
    const d = await get('/reports/suppliers', {}); const list = (d && d.suppliers) || [];
    if (!list.length) { b.innerHTML = HW.empty('You do not owe any supplier', 'Unpaid purchases will be listed here.'); return; }
    b.innerHTML = `${kpi([['You owe suppliers', M(d.totalPayable), 'Unpaid purchases', 'y'], ['Suppliers waiting', num(list.length), list.length >= 50 ? 'Showing the top 50' : ''], ['Largest balance', M(list[0].currentBalance), E(list[0].name), 'r']])}
      <div class="hwr-g2">${card('Who you owe the most', rankBars(list.slice(0, 8).map((x) => ({ l: x.name, v: x.currentBalance, s: `${fp(pct(x.currentBalance, d.totalPayable), 0)} of total` })), 'You owe'))}${card('Share of what you owe', shareDonut(list.slice(0, 6).map((x) => ({ l: x.name, v: x.currentBalance })), 'Owed'))}</div>
      ${card('Supplier balances', HW.tbl([{ h: 'Supplier', f: (s) => `<b>${E(s.name)}</b>` }, { h: 'Phone', f: (s) => (s.phone ? `<a href="tel:${E(s.phone)}">${E(s.phone)}</a>` : '–') }, { h: 'You owe', c: 'n pr', f: (s) => M(s.currentBalance) }, { h: 'Share', f: (s) => `<span class="hwr-mb"><i style="width:${Math.round(pct(s.currentBalance, d.totalPayable))}%"></i></span> ${fp(pct(s.currentBalance, d.totalPayable), 0)}` }], list), link('prices', 'Supplier price moves'))}`;
  };

  T.stock = async (b) => {
    const [d, sv, slow] = await Promise.all([get('/reports/inventory', { branchId: br() }), can('hardware.reports') ? get('/hardware/reports/stock-value', { branchId: br() }) : null, can('hardware.reports') ? get('/hardware/reports/slow-materials', { branchId: br(), days: HW.S.rpSlow || 90 }) : null]);
    const att = d ? Math.min(N(d.lowStockCount) + N(d.outOfStockCount), N(d.totalSkus)) : 0;
    b.innerHTML = `${d && d.totalSkus ? `${kpi([['Stock value', M(d.inventoryValuation), 'At current cost price', 'b'], ['Units on hand', num(d.totalUnitsOnHand), `${M(d.totalUnitsOnHand ? d.inventoryValuation / d.totalUnitsOnHand : 0)} average cost`], ['Products tracked', num(d.totalSkus)], ['Running low', num(d.lowStockCount), d.lowStockCount ? 'Reorder soon' : 'Nothing running low', d.lowStockCount ? 'y' : 'g'], ['Out of stock', num(d.outOfStockCount), d.outOfStockCount ? 'Losing sales right now' : 'Everything available', d.outOfStockCount ? 'r' : 'g'], ['Healthy stock', fp(100 - pct(att, d.totalSkus), 0), `${num(att)} need attention`, att ? 'y' : 'g']])}` : HW.empty('No stock recorded for this branch', 'Receive stock or add products to see valuation and alerts.')}
      ${d && d.totalSkus ? card('Stock health', `<div class="hwr-stk">${stockHealth(d)}</div>`, 'Well stocked · low · out of stock') : ''}
      ${sv ? card('Stock valuation — hardware view', HW.auto(sv)) : ''}
      ${slow ? card('Slow materials', `<div class="hw-bar" style="margin:0 0 10px"><label>Not sold for <input type="number" data-days value="${HW.S.rpSlow || 90}" style="width:80px"> days</label><button class="hw-btn d" data-run>Show</button></div>${HW.auto(slow)}`, 'Money tied up in stock that is not moving') : ''}
      <div class="hwr-links"><a class="hwr-more" href="inventory.html">Open inventory ›</a><a class="hwr-more" href="purchases.html">Restock from suppliers ›</a></div>`;
    const r = $('[data-run]', b); if (r) r.onclick = () => { HW.S.rpSlow = Number($('[data-days]', b).value) || 90; HW.refresh(); };
  };

  const plain = (title, path, extra = {}) => async (b) => {
    const parts = await Promise.all(path.map(([, p, o]) => get(p, { branchId: br(), ...(o && o.dates ? q() : {}) })));
    b.innerHTML = path.map(([t], i) => (parts[i] ? card(t, HW.auto(parts[i])) : card(t, HW.empty('Not available', 'You may not have access to this report.')))).join('') + (extra.after || '');
  };
  T.contractors = plain('Contractors', [['Contractor & project profit', '/hardware/reports/contractors', { dates: 1 }]]);
  T.delivery = plain('Deliveries', [['Pending deliveries', '/hardware/reports/pending-deliveries'], ['Delivery profit', '/hardware/reports/delivery-profit', { dates: 1 }], ['Transport & fleet', '/hardware/reports/transport', { dates: 1 }]]);
  T.prices = plain('Supplier prices', [['Supplier price moves', '/hardware/reports/supplier-prices']]);

  /* ---------- screen ---------- */
  const TABS = [
    ['overview', 'Overview', () => canView() || canProfit(), 1], ['profit', 'Profit & loss', canProfit, 1], ['sales', 'Sales', canView, 1], ['allsales', 'All sales', canView, 0],
    ['payments', 'Payments', canView, 1], ['cashiers', 'Cashiers', canView, 1], ['expenses', 'Expenses', canView, 1], ['customers', 'Customers owing', canView, 0], ['suppliers', 'Suppliers owed', canView, 0],
    ['stock', 'Stock', () => canView() || can('hardware.reports'), 0], ['contractors', 'Contractors & projects', () => can('hardware.reports'), 1], ['delivery', 'Deliveries & transport', () => can('hardware.reports') || can('hardware.transport'), 1], ['prices', 'Supplier prices', () => can('hardware.reports'), 0],
  ];
  let gen = 0;
  HW.V.reports = async (el, arg) => {
    const avail = TABS.filter((t) => t[2]());
    if (!avail.length) return legacy(el, arg);                      // narrow permissions: keep the old screen untouched
    let tab = avail.find((t) => t[0] === arg) || avail.find((t) => t[0] === HW.S.rpTab) || avail[0]; HW.S.rpTab = tab[0];
    const my = ++gen;
    const bar = tab[3] ? `<div class="hwr-bar"><div class="hwr-chips">${PRESETS.map(([k, l]) => `<button data-p="${k}" class="${R.preset === k ? 'on' : ''}">${l}</button>`).join('')}<button data-p="custom" class="${R.preset === 'custom' ? 'on' : ''}">Custom</button></div><label>From <input type="date" data-from value="${R.from}"></label><label>To <input type="date" data-to value="${R.to}"></label><span class="sp"></span><button class="hw-btn" data-print>Print</button></div>` : `<div class="hwr-bar"><span class="sp"></span><button class="hw-btn" data-print>Print</button></div>`;
    el.innerHTML = `<div class="hw-tabs hwr-tabs">${avail.map((t) => `<a href="#/reports/${t[0]}" class="${t[0] === tab[0] ? 'on' : ''}">${t[1]}</a>`).join('')}</div>${bar}<div class="hwr-body" data-body>${HW.skeleton ? HW.skeleton() : '<p style="color:#667080">Loading…</p>'}</div>`;
    const on = $('.hwr-tabs a.on', el); if (on && on.scrollIntoView) { try { on.scrollIntoView({ block: 'nearest', inline: 'center' }); } catch (e) { /* ignore */ } }
    const pr = $('[data-print]', el); if (pr) pr.onclick = () => window.print();
    const setRange = (p, f, t) => { R.preset = p; R.from = f; R.to = t; HW.refresh(); };
    $$('[data-p]', el).forEach((x) => x.onclick = () => { const k = x.dataset.p; if (k === 'custom') { R.preset = 'custom'; $$('[data-p]', el).forEach((y) => y.classList.toggle('on', y === x)); const f = $('[data-from]', el); if (f) f.focus(); return; } const [f, t] = PRESETS.find((p) => p[0] === k)[2](); setRange(k, f, t); });
    $$('[data-from],[data-to]', el).forEach((x) => x.onchange = () => { let f = $('[data-from]', el).value || R.from, t = $('[data-to]', el).value || R.to; if (f > t) t = f; setRange('custom', f, t); });
    const body = $('[data-body]', el);
    try {
      if (tab[0] === 'allsales') { HW.S.rpAll = true; await legacy(body); const tb = $('.hw-tabs', body); if (tb) tb.remove(); return; }
      HW.S.rpAll = false;
      await T[tab[0]](body);
      if (my !== gen) { queue = []; return; }
      flush();
    } catch (e) { if (my === gen) body.innerHTML = HW.empty('Could not load this report', (e && e.message) || 'Try again'); }
  };
})();
