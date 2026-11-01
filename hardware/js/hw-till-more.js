/* Hardware counter till — part 2: cash drawer · held sales · sales history · sale detail · refunds / cancel. */
(function () {
  const { Api, UI } = window, HW = window.HW; if (!HW || !HW.till) return;
  const T = HW.till, E = HW.E, $ = HW.$, $$ = HW.$$, M = HW.money, br = () => HW.S.branch, r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
  const can = (p) => HW.can(p);

  /* ===================================================== CASH DRAWER (hardware + lock state live in js/core/cash-drawer.js) */
  let drawerP = null, drawerUi = null, drawerTimer = null, unsub = null, keyH = null;
  const loadDrawer = () => drawerP || (drawerP = new Promise((res) => {
    const fin = () => { const cd = window.CashDrawer || null; if (!cd) return res(null); Promise.resolve(cd.ready).then(() => res(cd), () => res(cd)); };
    if (window.CashDrawer) return fin();
    const s = document.createElement('script'); s.src = '../js/core/cash-drawer.js'; s.async = true; s.onload = fin; s.onerror = () => { console.warn('cash-drawer.js could not be loaded'); res(null); }; document.head.appendChild(s);
  }));
  window.AppShell.whenCashDrawerReady = loadDrawer;
  const toCents = (n) => Math.round((Number(n) || 0) * 100);
  const alertMgmt = (message, data) => Api.post('/notifications/alert', { type: 'CASH_DRAWER', message, branchId: br(), data }).then(() => window.dispatchEvent(new Event('notifications:refresh'))).catch(() => {});

  T.initDrawer = async () => {
    const d = await loadDrawer(); if (!d) return; paintBtn();
    if (unsub) unsub(); unsub = d.on((ev) => {
      if (['lock', 'phase', 'reading'].includes(ev.type)) showLock();
      else if (ev.type === 'overdue') { showLock(); alertMgmt(`Cash drawer has been open for over a minute${ev.lock && ev.lock.receiptNumber ? ` (receipt ${ev.lock.receiptNumber})` : ''}.`, { drawerEvent: 'left_open', receiptNumber: ev.lock && ev.lock.receiptNumber, changeDue: toCents(ev.lock && ev.lock.change), amountTendered: toCents(ev.lock && ev.lock.tendered), drawerOpenSeconds: 60 }); }
      else if (ev.type === 'unlock') { hideLock(); if (ev.done && ev.done.method !== 'other-tab') HW.ok('Drawer closed — ready for the next sale'); }
      paintBtn();
    });
    if (keyH) document.removeEventListener('keydown', keyH, true);
    keyH = (e) => { if (!d.isLocked()) return; if (e.key === 'F7') { e.preventDefault(); reopen(); } else if (e.key === 'F8') { e.preventDefault(); confirmClosed(); } };
    document.addEventListener('keydown', keyH, true); showLock();
  };
  T.drawerSetup = async () => { const d = await loadDrawer(); if (!d) return HW.err('Cash drawer support could not be loaded'); d.openSetup(); };
  function paintBtn() {
    const b = $('[data-drawer]'), d = window.CashDrawer; if (!b) return; if (!d) { b.style.display = 'none'; return; }
    const st = d.status(), locked = d.isLocked(); b.style.display = ''; b.className = `tl-chip dr ${locked ? 'open' : st.connected ? 'ok' : ''}`;
    b.innerHTML = `${HW.ic('drawer', 16)} <span>${locked ? 'Drawer open' : st.connected ? 'Drawer ready' : st.enabled ? 'Drawer: manual' : 'Drawer'}</span>`; b.title = locked ? 'Cash drawer is open — close it to continue' : !st.enabled ? 'No cash drawer in use — tap to set up' : st.connected ? `Cash drawer ready (${st.label})` : 'Cash drawer: manual mode — tap to connect';
  }
  function showLock() {
    const d = window.CashDrawer, lock = d && d.getLock(); if (!lock) return hideLock();
    if (window.BarcodeScanner) window.BarcodeScanner.setPaused(true);
    if (!drawerUi) { drawerUi = UI.showDrawerLock({ onReopen: reopen, onConfirm: confirmClosed, onSetup: () => d.openSetup() }); clearInterval(drawerTimer); drawerTimer = setInterval(paintLock, 1000); }
    paintLock();
  }
  function hideLock() { clearInterval(drawerTimer); drawerTimer = null; if (drawerUi) { drawerUi.close(); drawerUi = null; } if (window.BarcodeScanner) window.BarcodeScanner.setPaused(false); setTimeout(() => { const q = $('[data-q]'); if (q && !document.querySelector('.hw-modal') && window.innerWidth > 1100) q.focus(); }, 0); }
  function paintLock() {
    const d = window.CashDrawer, lock = d && d.getLock(); if (!drawerUi || !lock) return; const st = d.status();
    const v = { change: lock.change, tendered: lock.tendered, due: lock.due, receiptNumber: lock.receiptNumber, seconds: Math.max(0, Math.round((Date.now() - (lock.openedAt || lock.createdAt)) / 1000)), overdue: !!lock.overdue, tone: 'info', message: '', confirmVisible: true, confirmLabel: 'Drawer is closed', canReopen: true };
    if (lock.phase === 'opening') { v.message = 'Opening the cash drawer…'; v.confirmVisible = false; v.canReopen = false; }
    else if (lock.phase === 'manual') { v.tone = 'warn'; v.message = 'No cash drawer is connected. Open it with the No-Sale key, give the change, close it, then confirm.'; v.canReopen = false; }
    else if (lock.phase === 'failed') { v.tone = 'error'; v.message = 'The drawer did not open. Press “Open drawer again”, or open it manually.'; }
    else if (st.canSense) { v.message = lock.reading === 'open' ? 'Drawer is open. Give the change, then push it shut — this screen unlocks by itself.' : 'Waiting for the drawer…'; v.confirmVisible = !!lock.overdue; v.confirmLabel = 'Sensor stuck? Confirm closed'; }
    else v.message = 'Drawer opened. Give the change, close the drawer, then confirm.';
    if (lock.overdue) { v.tone = 'error'; v.message += ' The drawer has been open too long.'; }
    drawerUi.update(v);
  }
  async function reopen() { const d = window.CashDrawer; if (!d || !d.isLocked()) return; const r = await d.reopen(); if (r && !r.ok && r.reason !== 'no-device') HW.err(r.error || 'The drawer did not respond'); }
  async function confirmClosed() {
    const d = window.CashDrawer, lock = d && d.getLock(); if (!lock) return;
    if (d.status().canSense && lock.reading === 'open') { if (!(await UI.confirmDialog({ title: 'The sensor says the drawer is still open', message: 'Only confirm if the drawer is physically closed. Management will be told that the sensor was overridden.', confirmText: 'Yes, it is closed', danger: true }))) return; const done = d.release({ method: 'override' }); if (done) alertMgmt(`Cash drawer closed by manual override${done.receiptNumber ? ` (receipt ${done.receiptNumber})` : ''} while the sensor still read open.`, { drawerEvent: 'override', closeMethod: 'override', receiptNumber: done.receiptNumber, changeDue: toCents(done.change), amountTendered: toCents(done.tendered) }); return; }
    d.release({ method: 'manual' });
  }

  /* ===================================================== HELD SALES (parked on this device, with units & contract prices intact) */
  const HK = 'hw.heldSales.v1', held = () => { try { const a = JSON.parse(localStorage.getItem(HK) || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } };
  const saveHeld = (l) => { try { localStorage.setItem(HK, JSON.stringify(l)); return true; } catch (e) { HW.err('Could not save on this device (storage full)'); return false; } };
  T.heldCount = () => { const n = held().length, b = $('[data-heldn]'); if (b) b.textContent = n ? n : ''; };
  T.park = () => {
    if (!T.lines.length) return HW.err('The cart is empty'); if (T.payments.some((p) => p.locked)) return HW.err('An M-PESA payment is confirmed. Finish the sale first.');
    HW.modal({ title: 'Hold this sale', body: `<div class="hw-f"><label class="w">Name for this held sale (optional)<input name="label" maxlength="60" value="${E(T.customer ? T.customer.name : '')}" placeholder="e.g. Contractor on the phone"></label></div>`, actions: [{ label: 'Cancel' }, { label: 'Hold sale', cls: 'p', fn: (el) => { const label = $('[name=label]', el).value.trim() || 'Held sale'; const l = held(); l.unshift({ id: 'H' + Date.now().toString(36), label, at: Date.now(), lines: JSON.parse(JSON.stringify(T.lines)), customer: T.customer, cartDiscount: T.cartDiscount || 0 }); if (!saveHeld(l.slice(0, 30))) return false; T.reset(); T.heldCount(); HW.ok('Sale held — recall it any time'); } }], onMount: (el) => setTimeout(() => { const i = $('[name=label]', el); i.focus(); i.select(); }, 60) });
  };
  T.recall = () => {
    const rows = held(); const time = (t) => new Date(t).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    const m = HW.modal({ title: 'Held sales', body: rows.length ? `<div class="tl-held">${rows.map((h, i) => `<div class="hl"><div><b>${E(h.label)}</b><small>${h.lines.length} item${h.lines.length === 1 ? '' : 's'} · ${E(time(h.at))}${h.customer ? ' · ' + E(h.customer.name) : ''}</small></div><button class="hw-btn p s" data-r="${i}">Recall</button><button class="hw-btn s x" data-d="${i}">Discard</button></div>`).join('')}</div>` : HW.empty('No held sales', 'Use “Hold” on the sale screen to park a sale while you serve someone else.'), actions: [{ label: 'Close' }] });
    $$('[data-r]', m.el).forEach((b) => b.onclick = async () => { const h = held()[+b.dataset.r]; if (!h) return; if (T.lines.length && !(await UI.confirmDialog({ title: 'Replace the current cart?', message: 'Hold the current cart first if you want to keep it.', confirmText: 'Replace', danger: true }))) return; T.lines = h.lines; T.customer = h.customer || null; T.cartDiscount = h.cartDiscount || 0; T.payments = []; T.key = Api.newIdempotencyKey(); saveHeld(held().filter((x) => x.id !== h.id)); m.close(); T.view = 'sell'; if (T.root) HW.V.counter(T.root); T.reprice(); HW.ok(`Recalled “${h.label}” — prices re-checked`); });
    $$('[data-d]', m.el).forEach((b) => b.onclick = async () => { const h = held()[+b.dataset.d]; if (!h) return; if (!(await UI.confirmDialog({ title: `Discard “${h.label}”?`, danger: true, confirmText: 'Discard' }))) return; saveHeld(held().filter((x) => x.id !== h.id)); m.close(); T.heldCount(); T.recall(); });
  };

  /* ===================================================== SALES HISTORY */
  const H = { page: 1, limit: 20, search: '', from: '', to: '', status: '', preset: 'today' };
  const ymd = (d) => { const x = new Date(d); x.setMinutes(x.getMinutes() - x.getTimezoneOffset()); return x.toISOString().slice(0, 10); };
  const PRE = { today: () => [ymd(new Date()), ymd(new Date())], yday: () => { const d = new Date(); d.setDate(d.getDate() - 1); return [ymd(d), ymd(d)]; }, '7d': () => { const d = new Date(); d.setDate(d.getDate() - 6); return [ymd(d), ymd(new Date())]; }, all: () => ['', ''] };
  const PAYB = { PAID: 'OK', PARTIAL: 'WA', CREDIT: 'ER', UNPAID: '' };
  T.history = (body) => {
    if (H.preset !== 'custom') [H.from, H.to] = PRE[H.preset]();
    body.innerHTML = `<div class="tl-hist"><div class="hs-bar"><div class="grow ${H.search ? 'has' : ''}" style="flex:1 1 280px"><input data-hs placeholder="Search by receipt number…" value="${E(H.search)}" autocomplete="off"><button type="button" data-hx aria-label="Clear">×</button></div><select data-st>${[['', 'All sales'], ['PAID', 'Paid'], ['CREDIT', 'On credit / owing'], ['CANCELLED', 'Cancelled']].map(([k, l]) => `<option value="${k}" ${H.status === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div class="hs-bar"><div class="hs-chips">${[['today', 'Today'], ['yday', 'Yesterday'], ['7d', 'Last 7 days'], ['all', 'All time'], ['custom', 'Custom']].map(([k, l]) => `<button data-p="${k}" class="${H.preset === k ? 'on' : ''}">${l}</button>`).join('')}</div><input type="date" data-f value="${H.from}"><input type="date" data-t value="${H.to}"></div><div data-res></div></div>`;
    const run = async () => {
      const res = $('[data-res]', body); res.innerHTML = '<div class="hw-sk"><div class="b l"></div></div>';
      try {
        const { data } = await Api.get('/sales', { branchId: br(), page: H.page, limit: H.limit, search: H.search || undefined, from: H.from ? new Date(H.from + 'T00:00:00').toISOString() : undefined, to: H.to ? new Date(H.to + 'T23:59:59.999').toISOString() : undefined });
        let rows = data.items || []; if (H.status === 'CANCELLED') rows = rows.filter((s) => s.saleStatus === 'CANCELLED'); else if (H.status === 'CREDIT') rows = rows.filter((s) => s.balance > 0 && s.saleStatus !== 'CANCELLED'); else if (H.status) rows = rows.filter((s) => s.paymentStatus === H.status);
        const sum = rows.filter((s) => s.saleStatus !== 'CANCELLED').reduce((a, s) => a + (s.total || 0), 0);
        const live = rows.filter((s) => s.saleStatus !== 'CANCELLED'), got = live.reduce((a, s) => a + (s.amountPaid != null ? s.amountPaid : (s.total || 0) - (s.balance || 0)), 0), owing = live.reduce((a, s) => a + (s.balance > 0 ? s.balance : 0), 0);
        res.innerHTML = `${HW.kpi([['Sales shown', rows.length.toLocaleString(), `of ${(data.total || 0).toLocaleString()} found`, 'b'], ['Value of these sales', M(sum), 'Excludes cancelled'], ['Collected', M(got), 'Paid on these sales', 'g'], ['Still owed', M(owing), owing > 0 ? 'On credit / part-paid' : 'Nothing owing']])}` + HW.tbl([{ h: 'Receipt', f: (s) => `<b>${E(s.receiptNumber)}</b>${s.channel === 'WHOLESALE' ? ' ' + HW.badge('BL', 'Wholesale') : ''}` }, { h: 'Date', f: (s) => E(HW.dt(s.createdAt)) }, { h: 'Cashier', f: (s) => E((s.cashierId && s.cashierId.name) || '') }, { h: 'Customer', f: (s) => s.customerId ? E(s.customerId.name) : '<span style="color:#8d91a1">Walk-in</span>' }, { h: 'Total', c: 'n pr', f: (s) => M(s.total) },
          { h: 'Status', f: (s) => `${HW.badge(PAYB[s.paymentStatus] || '', HW.human(s.paymentStatus))}${s.saleStatus === 'CANCELLED' ? ' ' + HW.badge('ER', 'Cancelled') : ''}${s.balance > 0 && s.saleStatus !== 'CANCELLED' ? `<small style="display:block;color:#b45309">owes ${M(s.balance)}${s.dueDate ? ' · due ' + HW.date(s.dueDate) : ''}</small>` : ''}` }, { h: '', f: () => '<span class="vw" style="font-weight:700;color:#3340a8">View ›</span>' }], rows, { click: true, empty: 'No sales found', hint: 'Try another date range or search.' })
          + `<div class="hs-pager"><span>Page ${data.page || 1} of ${data.pages || 1}</span><span class="r"><button class="hw-btn s" data-pv ${(data.page || 1) <= 1 ? 'disabled' : ''}>‹ Prev</button><button class="hw-btn s" data-nx ${(data.page || 1) >= (data.pages || 1) ? 'disabled' : ''}>Next ›</button></span></div>`;
        HW.bindRows(res, rows, (s) => T.saleDetail(s._id)); $('[data-pv]', res).onclick = () => { H.page--; run(); }; $('[data-nx]', res).onclick = () => { H.page++; run(); };
      } catch (e) { res.innerHTML = HW.empty('Could not load sales', e.message); }
    };
    T.refreshHistory = run;
    $('[data-hs]', body).oninput = UI.debounce((e) => { H.search = e.target.value.trim(); H.page = 1; $('.grow', body).classList.toggle('has', !!H.search); run(); }, 300); $('[data-hx]', body).onclick = () => { H.search = ''; H.page = 1; T.history(body); };
    $('[data-st]', body).onchange = (e) => { H.status = e.target.value; run(); };
    $$('[data-p]', body).forEach((b) => b.onclick = () => { H.preset = b.dataset.p; H.page = 1; T.history(body); });
    $$('[data-f],[data-t]', body).forEach((i) => i.onchange = () => { H.preset = 'custom'; H.from = $('[data-f]', body).value; H.to = $('[data-t]', body).value; H.page = 1; T.history(body); });
    run();
  };

  /* ===================================================== CASH SHIFT TAB (live: open → figures, closed → open a shift) */
  const dur = (from) => { const m = Math.max(0, Math.floor((Date.now() - new Date(from)) / 60000)); return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`; };
  let shiftHost = null, shiftTick = null;
  T.shiftRefresh = () => { if (shiftHost && shiftHost.isConnected && T.view === 'shift') T.shiftView(shiftHost); };
  T.shiftView = async (body) => {
    shiftHost = body; clearInterval(shiftTick); body.innerHTML = '<div class="hw-sk"><div class="b l"></div></div>';
    let s = HW.shift ? await HW.shift.load() : null; if (!body.isConnected) return; if (T.paintShiftTab) T.paintShiftTab();
    let detail = null, recent = [];
    if (s) { try { detail = (await Api.get(`/shifts/${s._id}`)).data; } catch (e) { /* the shift card still works without the cash sales */ } }
    try { recent = ((await Api.get('/shifts', { branchId: br(), page: 1, limit: 8 })).data.items) || []; } catch (e) { /* history is optional */ }
    if (!body.isConnected) return;
    const cs = (detail && detail.cashSales) || [], cashIn = cs.reduce((a, p) => a + (Number(p.amount) || 0), 0), expected = s ? r2((Number(s.openingCash) || 0) + cashIn) : 0;
    const reg = (s && s.registerId) || {}, cashier = (s && s.cashierId && s.cashierId.name) || '';
    const hero = s ? `<section class="hw-card tsh-hero on"><div class="st"><span class="pulse"></span><div><small>Cash shift</small><h3>Open · ${E(reg.name || 'Till')}${reg.code ? ` <em>${E(reg.code)}</em>` : ''}</h3><p>Opened ${E(HW.dt(s.openedAt))}${cashier ? ' by ' + E(cashier) : ''} · running <b data-dur>${dur(s.openedAt)}</b></p></div></div><div class="ac"><button class="hw-btn" data-sellnow>${HW.ic('cart', 16)} Back to selling</button><button class="hw-btn p" data-closesh>${HW.ic('calculator', 16)} Close shift</button></div></section>`
      : `<section class="hw-card tsh-hero off"><div class="st"><span style="display:inline-flex">${HW.ic('lock', 34)}</span><div><small>Cash shift</small><h3>No shift is open</h3><p>Open a shift with your starting cash to take payments at this till.</p></div></div><div class="ac"><button class="hw-btn p big" data-opensh>${HW.ic('banknote', 17)} Open shift</button></div></section>`;
    const kpis = s ? HW.kpi([['Opening float', M(s.openingCash), `${E(reg.name || 'Till')}`, 'b'], ['Cash sales', M(cashIn), `${cs.length} cash payment${cs.length === 1 ? '' : 's'}`], ['Expected in drawer', M(expected), 'Float + cash sales', 'g'], ['Shift length', `<span data-dur2>${dur(s.openedAt)}</span>`, 'Since ' + HW.dt(s.openedAt)]]) : '';
    const cashTbl = s ? `<section class="hw-card"><h4 class="tsh-h">Cash taken this shift</h4>${cs.length ? HW.tbl([{ h: 'Receipt', f: (p) => `<b>${E(p.receiptNumber || '–')}</b>` }, { h: 'Time', f: (p) => E(HW.dt(p.createdAt)) }, { h: 'Amount', c: 'n', f: (p) => M(p.amount) }, { h: 'Tendered', c: 'n', f: (p) => p.amountTendered != null ? M(p.amountTendered) : '–' }, { h: 'Change', c: 'n', f: (p) => p.changeGiven != null ? M(p.changeGiven) : '–' }], cs) : HW.empty('No cash sales yet', 'Cash payments taken at this till appear here.')}</section>` : '';
    const recTbl = `<section class="hw-card"><h4 class="tsh-h">Recent shifts</h4>${recent.length ? HW.tbl([{ h: 'Till', f: (x) => `<b>${E((x.registerId && x.registerId.name) || 'Till')}</b>` }, { h: 'Cashier', f: (x) => E((x.cashierId && x.cashierId.name) || '–') }, { h: 'Opened', f: (x) => E(HW.dt(x.openedAt)) }, { h: 'Closed', f: (x) => x.closedAt ? E(HW.dt(x.closedAt)) : '–' }, { h: 'Float', c: 'n', f: (x) => M(x.openingCash) }, { h: 'Difference', c: 'n', f: (x) => x.status === 'CLOSED' ? `<span class="${Number(x.cashDifference) === 0 ? 'tsh-ok' : 'tsh-bad'}">${Number(x.cashDifference) > 0 ? '+' : ''}${M(x.cashDifference || 0)}</span>` : '–' }, { h: 'Status', f: (x) => HW.badge(x.status === 'CLOSED' ? '' : 'OK', x.status === 'CLOSED' ? 'Closed' : 'Open') }], recent) : HW.empty('No shifts yet', 'Shifts you open and close show up here.')}</section>`;
    body.innerHTML = `<div class="tsh">${hero}${kpis}<div class="tsh-grid">${cashTbl}${recTbl}</div></div>`;
    const o = $('[data-opensh]', body); if (o) o.onclick = () => HW.shift.openFlow((ok) => { if (ok) HW.shift.refresh(); });
    const c = $('[data-closesh]', body); if (c) c.onclick = () => HW.shift.closeFlow();
    const sn = $('[data-sellnow]', body); if (sn) sn.onclick = () => { T.view = 'sell'; HW.V.counter(T.root); };
    if (s) shiftTick = setInterval(() => { if (!body.isConnected || T.view !== 'shift') return clearInterval(shiftTick); $$('[data-dur],[data-dur2]', body).forEach((x) => { x.textContent = dur(s.openedAt); }); }, 30000);
    const rows = $$('tbody tr', body.querySelector('.tsh-grid > section:last-child')); rows.forEach((tr, i) => { const x = recent[i]; if (!x) return; tr.style.cursor = 'pointer'; tr.onclick = () => (x.status === 'CLOSED' ? HW.shift.summary(x) : HW.ok('This shift is open — close it to see the final count')); });
  };

  /* ===================================================== SALE DETAIL (+ receipt, invoice, refund, cancel, delivery) */
  T.saleDetail = async (id) => {
    let data; try { ({ data } = await Api.get(`/sales/${id}`)); } catch (e) { return HW.err(e.message); }
    const { sale, receipt } = data, cancelled = sale.saleStatus === 'CANCELLED';
    const canCancel = !cancelled && sale.saleStatus === 'COMPLETED' && can('sales.cancel'), refundable = (sale.items || []).some((i) => i.quantity - (i.refundedQuantity || 0) > 0), canRefund = !cancelled && refundable && can('refunds.create');
    const acts = [{ label: 'Close' }]; const extra = [];
    extra.push(...T.documents(sale._id, receipt, sale.invoiceNumber || sale.receiptNumber, cancelled));
    if (!cancelled) extra.push(['Schedule delivery', () => HW.deliveryForm({ saleId: sale._id, customerId: sale.customerId && sale.customerId._id, customerName: sale.customerId ? sale.customerId.name : '' })]);
    const m = HW.modal({ title: `Sale ${sale.receiptNumber}`, size: 'lg', body: `<div class="hs-det"><div class="kv"><span>Date</span><span>${E(HW.dt(sale.createdAt))}</span><span>Cashier</span><span>${E((sale.cashierId && sale.cashierId.name) || '–')}</span><span>Customer</span><span>${sale.customerId ? E(sale.customerId.name) + (sale.customerId.phone ? ' · ' + E(sale.customerId.phone) : '') : 'Walk-in'}</span><span>Payment</span><span>${HW.badge(PAYB[sale.paymentStatus] || '', HW.human(sale.paymentStatus))}</span></div>
      ${cancelled ? `<div class="warn"><b>Cancelled</b> ${E(sale.cancelReason || '')}</div>` : ''}
      <h4>Items</h4>${HW.tbl([{ h: 'Item', f: (i) => `<b>${E(i.nameSnapshot)}</b>${i.unitName ? `<small style="display:block;color:#757a88">${E(i.unitName)}</small>` : ''}${i.refundedQuantity ? `<small style="display:block;color:#b42323">${i.refundedQuantity} refunded</small>` : ''}` }, { h: 'Qty', c: 'n', f: (i) => HW.num(i.quantity) }, { h: 'Price', c: 'n', f: (i) => M(i.unitPrice) }, { h: 'Total', c: 'n pr', f: (i) => M(i.total) }], sale.items || [])}
      <div style="margin-top:10px"><div class="ln"><span>Subtotal</span><span>${M(sale.subtotal)}</span></div>${sale.tax ? `<div class="ln"><span>Tax</span><span>${M(sale.tax)}</span></div>` : ''}<div class="tot"><span>Total</span><span>${M(sale.total)}</span></div>${sale.amountPaid != null ? `<div class="ln"><span>Paid</span><span>${M(sale.amountPaid)}</span></div>` : ''}${sale.balance > 0 ? `<div class="ln" style="color:#b45309"><b>Balance owed${sale.dueDate ? ' (due ' + E(HW.date(sale.dueDate)) + ')' : ''}</b><b>${M(sale.balance)}</b></div>` : ''}</div>
      <div class="tl-done" data-x style="margin-top:14px">${extra.map(([l], i) => `<button class="hw-btn" data-e="${i}">${l}</button>`).join('')}${canRefund ? `<button class="hw-btn" data-refund>${HW.ic('undo', 16)} Request refund</button>` : ''}${canCancel ? '<button class="hw-btn x" data-cancel>Cancel sale</button>' : ''}</div></div>`, actions: acts });
    $$('[data-e]', m.el).forEach((b) => b.onclick = () => extra[+b.dataset.e][1]());
    const rf = $('[data-refund]', m.el); if (rf) rf.onclick = () => { m.close(); refund(sale); };
    const cn = $('[data-cancel]', m.el); if (cn) cn.onclick = () => HW.reason('Cancel this sale', async (reason) => { try { await Api.post(`/sales/${sale._id}/cancel`, { reason }); } catch (e) { HW.err(e.message); return false; } HW.ok('Sale cancelled'); m.close(); if (T.refreshHistory) T.refreshHistory(); }, 'Cancel sale');
  };
  function refund(sale) {
    const items = (sale.items || []).map((i, idx) => ({ ...i, idx, remaining: i.quantity - (i.refundedQuantity || 0) })).filter((i) => i.remaining > 0);
    HW.modal({ title: 'Request refund', body: `<div class="tp-note">The refund amount is worked out from what was actually charged. Choose how many units come back.</div>${items.map((i) => `<div class="tl-rf"><span><b>${E(i.nameSnapshot)}</b><small>${HW.num(i.remaining)} available to refund</small></span><input type="number" min="0" max="${i.remaining}" step="any" value="0" data-q="${i.idx}" inputmode="decimal"></div>`).join('')}<div class="hw-f" style="margin-top:12px"><label class="w">Reason<input name="reason" placeholder="e.g. Wrong size, damaged"></label><label class="w">Refund method<select name="pm">${['CASH', 'MPESA', 'CARD', 'BANK', 'OTHER'].map((x) => `<option value="${x}">${HW.human(x)}</option>`).join('')}</select></label></div>`,
      actions: [{ label: 'Cancel' }, { label: 'Submit refund', cls: 'p', fn: async (el) => { const its = items.map((i) => ({ productId: i.productId, variantId: i.variantId, unitId: i.unitId, quantity: Number($(`[data-q="${i.idx}"]`, el).value) || 0 })).filter((i) => i.quantity > 0); const reason = $('[name=reason]', el).value.trim(); if (!its.length) { HW.err('Enter a quantity for at least one item'); return false; } if (reason.length < 3) { HW.err('Please give a reason'); return false; }
        try { const { data } = await Api.post('/refunds', { branchId: (sale.branchId && sale.branchId._id) || sale.branchId, saleId: sale._id, items: its, reason, paymentMethod: $('[name=pm]', el).value }); const r = data.refund || data; HW.ok(r.status === 'COMPLETED' ? 'Refund completed' : 'Refund submitted for approval'); } catch (e) { HW.err(e.message); return false; } if (T.refreshHistory) T.refreshHistory(); } }] });
  }
})();
