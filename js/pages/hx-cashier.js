/**
 * hx-cashier.js - Cashier desk (owner, manager, cashier).
 * One place for every payment: waiter served, self service, delivery, take away, counter, room service and accommodation.
 *   GET  /cashier/overview | /cashier/queue | /cashier/orders/:id | /cashier/payments | /cashier/drawer
 *   POST /cashier/drawer/events | /cashier/bills/:id/reprint
 * Money is still taken by the existing dialogs (HX.pay / HX.bill) and the kiosk "confirm cash" endpoint, so their rules stay in one place.
 */
(function () {
  const { E, M, can, get, list, pill, dt } = window.HX;
  const ALLOWED = ['OWNER', 'MANAGER', 'CASHIER'];
  const CH = {
    DINE_IN: ['Waiter served', '#1570ef'], SELF_SERVICE: ['Self service', '#a23ae6'], DELIVERY: ['Delivery', '#e8590c'],
    TAKEAWAY: ['Take away', '#0e9384'], COUNTER: ['Counter / tab', '#64748b'], ROOM_SERVICE: ['Room service', '#d9468f'], ACCOMMODATION: ['Accommodation', '#20b04a'],
  };
  const STATE = {
    AWAITING_CASH: ['Cash at kiosk', 'bad'], BILL_REQUESTED: ['Bill requested', 'warn'], CHECKOUT_DUE: ['Checkout due', 'warn'], PART_PAID: ['Part paid', 'busy'],
    BILLED: ['Billed', 'plan'], DEPOSIT_DUE: ['Deposit due', 'plan'], IN_HOUSE: ['In house', 'mute'], NOT_BILLED: ['Not billed', 'mute'], MPESA_PENDING: ['M-PESA pending', 'busy'],
  };
  const FLAG = {
    BILL_REQUESTED: ['Bill requested', 'warn'], CASH_ON_DELIVERY: ['Cash on delivery', 'busy'], DELIVERED: ['Delivered', 'ok'], OUT_FOR_DELIVERY: ['Out for delivery', 'plan'],
    NOT_ALL_SERVED: ['Not all served', 'mute'], UNVERIFIED_PAYMENT: ['Check M-PESA', 'bad'], LONG_WAIT: ['Waiting long', 'bad'], CHECKOUT_REQUESTED: ['Checkout requested', 'warn'],
    DUE_OUT_TODAY: ['Due out today', 'warn'], OVERDUE: ['Overdue', 'bad'],
  };
  const METHODS = [['CASH', 'Cash'], ['MPESA', 'M-PESA'], ['MOBILE_MONEY', 'Mobile money'], ['CARD', 'Card'], ['BANK', 'Bank'], ['OTHER', 'Other']];
  const mLabel = (m) => (METHODS.find((x) => x[0] === m) || [m, window.HX.payLabel ? window.HX.payLabel(m) : m])[1];
  const S = { tab: 'queue', channel: '', search: '', ov: null, queue: null, drawer: null, recent: null, pay: { date: '', method: '', search: '' }, busy: false, full: false, open: {}, seen: {}, fresh: {}, known: null, det: {}, expandAll: false, sound: (function () { try { return localStorage.getItem('cx.sound') === '1'; } catch (e) { return false; } })() };
  let el, timer;

  document.addEventListener('DOMContentLoaded', init);
  async function init() {
    el = window.HX.mount('Cashier desk'); if (!el) return;
    await window.AppShell.whenProfileReady?.();
    const role = window.HX.user() && window.HX.user().role;
    if (!ALLOWED.includes(role) || !can('cashier.view')) {
      el.innerHTML = window.HX.head('Cashier desk', 'For owners, managers and cashiers.') + window.HX.empty('No access', 'The cashier desk can only be opened by the owner, a manager or a cashier.');
      return;
    }
    S.tab = (location.hash.match(/tab=(queue|payments|drawer)/) || [])[1] || 'queue';
    window.AppShell.onBranchChange?.(() => refresh());
    document.addEventListener('keydown', (e) => { if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) { const i = el.querySelector('#cx-search'); if (i) { e.preventDefault(); i.focus(); } } });
    await refresh();
    document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && S.full) { S.full = false; document.body.classList.remove('cx-full'); const b = el.querySelector('#cx-full'); if (b) b.textContent = 'Full screen'; } });
    window.HX.live(() => { const a = document.activeElement; if (!document.querySelector('.modal-backdrop') && !S.busy && !(a && /^(cx-search|px-s|px-date)$/.test(a.id))) { S.det = {}; refresh(true); } }, 15000);
  }

  // ------------------------------------------------------------------ data + shell
  const bid = () => window.HX.branchId();
  const ICON = { DINE_IN: 'utensils', SELF_SERVICE: 'qr', DELIVERY: 'bike', TAKEAWAY: 'bag', COUNTER: 'coffee', ROOM_SERVICE: 'key', ACCOMMODATION: 'bed' };
  const ic = (n) => (window.HX.icon ? window.HX.icon(n) : '');
  const NEW_MS = 3 * 60000;
  /** A row is "new" until the cashier opens it: it arrived in the last minutes, or appeared in the queue since the last refresh. */
  const isNew = (r) => !S.seen[r.key] && ((S.fresh[r.key] && Date.now() - S.fresh[r.key] < NEW_MS) || (r.kind !== 'STAY' && r.waitMinutes != null && r.waitMinutes <= 2));
  const seen = (r) => { if (r) S.seen[r.key] = true; };

  function beep() { try { const c = new (window.AudioContext || window.webkitAudioContext)(), o = c.createOscillator(), g = c.createGain(); o.connect(g); g.connect(c.destination); o.frequency.value = 880; g.gain.value = 0.15; o.start(); setTimeout(() => { o.stop(); c.close(); }, 220); } catch (e) { /* no sound */ } }

  async function refresh(quiet) {
    S.busy = true;
    try {
      const rail = S.tab === 'queue';
      const [ov, q, dr, rp] = await Promise.all([
        get('/cashier/overview', { branchId: bid() }),
        get('/cashier/queue', { branchId: bid(), channel: S.channel, search: S.search, limit: 300 }),
        rail && can('cashier.drawer') ? get('/cashier/drawer', { branchId: bid() }) : null,
        rail ? get('/cashier/payments', { branchId: bid(), limit: 8 }) : null,
      ]);
      if (ov) S.ov = ov;
      if (q) {
        const keys = new Set(q.rows.map((r) => r.key)); let added = 0;
        if (S.known && !S.channel && !S.search) q.rows.forEach((r) => { if (!S.known.has(r.key)) { S.fresh[r.key] = Date.now(); added += 1; } });
        if (!S.channel && !S.search) S.known = keys;
        Object.keys(S.fresh).forEach((k) => { if (Date.now() - S.fresh[k] > 10 * 60000) delete S.fresh[k]; });
        S.queue = q;
        if (added) { if (S.sound) beep(); window.UI.toast.info ? window.UI.toast.info(`${added} new ${added === 1 ? 'order' : 'orders'} to confirm`) : window.UI.toast.success(`${added} new to confirm`); }
      }
      if (dr) S.drawer = dr; if (rp) S.recent = rp;
    } finally { S.busy = false; }
    draw(quiet);
  }

  function setFull(on) {
    S.full = on; document.body.classList.toggle('cx-full', on);
    try { if (on && document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => {}); else if (!on && document.fullscreenElement) document.exitFullscreen().catch(() => {}); } catch (e) { /* ignore */ }
    const b = el && el.querySelector('#cx-full'); if (b) b.innerHTML = fullLabel();
  }
  const fullLabel = () => (S.full ? 'Exit full screen' : 'Full screen');

  function draw(quiet) {
    const ov = S.ov; if (!ov) { el.innerHTML = window.HX.head('Cashier desk', 'Could not load. Check the connection and try again.', '<button class="btn btn-primary" id="cx-retry">Try again</button>'); el.querySelector('#cx-retry').onclick = () => refresh(); return; }
    const aw = ov.awaiting || {}, t = ov.today || {}, a = ov.attention || {};
    const rows = (S.queue && S.queue.rows) || [], newN = rows.filter(isNew).length;
    const tabs = [['queue', `To collect${aw.count ? ' (' + aw.count + ')' : ''}${newN ? ' · ' + newN + ' new' : ''}`], ['payments', 'Payments'], ['drawer', 'Cash drawer']];
    const mm = (k) => (t.byMethod && t.byMethod[k]) || { amount: 0, count: 0 };
    const alerts = [
      [a.kioskCashWaiting, 'Cash waiting at kiosk', 'bad', () => { S.tab = 'queue'; S.channel = 'SELF_SERVICE'; }],
      [a.billRequested, 'Bills requested', 'warn', () => { S.tab = 'queue'; S.channel = ''; }],
      [a.checkoutsDue, 'Checkouts due', 'warn', () => { S.tab = 'queue'; S.channel = 'ACCOMMODATION'; }],
      [a.codDeliveries, 'Cash on delivery', 'busy', () => { S.tab = 'queue'; S.channel = 'DELIVERY'; }],
      [a.mpesaInProgress, 'M-PESA in progress', 'busy', null],
      [a.unverifiedPayments, 'Payments to verify', 'bad', () => { location.href = 'hx-bills.html'; }],
      [a.longWait, 'Waiting too long', 'bad', () => { S.tab = 'queue'; S.channel = ''; }],
    ].filter((x) => x[0] > 0);
    el.innerHTML = window.HX.head('Cashier desk', `${ov.date || ''} · confirm and take every payment here`, `<span class="cx-live">Live</span><button class="btn btn-secondary" id="cx-snd" title="Sound when a new order arrives">${S.sound ? 'Sound on' : 'Sound off'}</button><button class="btn btn-secondary" id="cx-ref">Refresh</button>${can('restaurant.bills.view') ? '<a class="btn btn-secondary cx-hide-full" href="hx-bills.html">All bills</a>' : ''}<button class="btn btn-primary" id="cx-full">${fullLabel()}</button>`) + `<div class="cx-wrap">
      <div class="cx-tiles">
        <div class="cx-tile hero"><small>Waiting to collect</small><b>${M(aw.amount || 0)}</b><span>${aw.count || 0} ${aw.count === 1 ? 'order' : 'orders'}${aw.oldestWaitMinutes ? ' · oldest ' + waitText(aw.oldestWaitMinutes) : ''}</span></div>
        <div class="cx-tile" style="--c:#20b04a"><small>Collected today</small><b>${M(t.net || 0)}</b><span>${t.payments || 0} payments${t.refunds ? ' · refunds ' + M(t.refunds) : ''}</span></div>
        <div class="cx-tile" style="--c:#f59e0b"><small>Cash</small><b>${M(mm('CASH').amount)}</b><span>${mm('CASH').count} payments</span></div>
        <div class="cx-tile" style="--c:#1570ef"><small>M-PESA & mobile</small><b>${M(mm('MPESA').amount + mm('MOBILE_MONEY').amount)}</b><span>${mm('MPESA').count + mm('MOBILE_MONEY').count} payments</span></div>
        <div class="cx-tile" style="--c:#a23ae6"><small>Card & bank</small><b>${M(mm('CARD').amount + mm('BANK').amount)}</b><span>${mm('CARD').count + mm('BANK').count} payments</span></div>
      </div>
      ${alerts.length ? `<div class="cx-alerts">${alerts.map((x, i) => `<button type="button" class="cx-alert hx-st-${x[2]}" data-al="${i}">${E(x[1])} <b>${x[0]}</b></button>`).join('')}</div>` : ''}
      ${shiftBar(ov.shift, ov)}
      ${window.HX.tabs(tabs, S.tab)}
      <div id="cx-body"></div></div>`;
    el.querySelector('#cx-ref').onclick = () => refresh();
    el.querySelector('#cx-full').onclick = () => setFull(!S.full);
    el.querySelector('#cx-snd').onclick = (e) => { S.sound = !S.sound; try { localStorage.setItem('cx.sound', S.sound ? '1' : '0'); } catch (x) { /* ignore */ } e.currentTarget.textContent = S.sound ? 'Sound on' : 'Sound off'; if (S.sound) beep(); };
    el.querySelectorAll('[data-al]').forEach((b) => b.addEventListener('click', () => { const f = alerts[Number(b.dataset.al)][3]; if (f) { f(); refresh(); } }));
    el.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => { S.tab = b.dataset.tab; history.replaceState(null, '', '#tab=' + S.tab); refresh(true); }));
    const so = el.querySelector('#cx-shift-open'); if (so) so.onclick = () => { S.tab = 'drawer'; refresh(true); };
    const sc = el.querySelector('#cx-shift-close'); if (sc) sc.onclick = () => closeShiftById(ov.shift && ov.shift.shiftId);
    const body = el.querySelector('#cx-body');
    if (S.tab === 'queue') queueView(body); else if (S.tab === 'payments') paymentsView(body); else drawerView(body);
  }

  function shiftBar(sh, ov) {
    if (sh) return `<div class="cx-shift ok"><div class="grow"><b>Your cash shift is open</b><small>${E((sh.register && sh.register.name) || 'Register')} · since ${dt(sh.openedAt)} · opening float ${M(sh.openingCash)}</small></div><div><small>Cash that should be in your drawer</small><b style="font-size:20px">${M(sh.expectedCash)}</b></div>${can('shifts.close') ? '<button class="btn btn-secondary" id="cx-shift-close">Close shift</button>' : ''}</div>`;
    return `<div class="cx-shift warn"><div class="grow"><b>No open cash shift</b><small>Open your shift to take cash and use the drawer.${ov.openShifts ? ' ' + ov.openShifts + ' shift(s) are open in this branch.' : ''}</small></div><button class="btn btn-primary" id="cx-shift-open">Open shift</button></div>`;
  }

  const waitText = (m) => (m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m} min`);

  // ------------------------------------------------------------------ queue: one compact row per sale, expand for more
  function queueView(box) {
    const q = S.queue || { rows: [], summary: { byChannel: {} } };
    const by = (q.summary && q.summary.byChannel) || {}, newN = q.rows.filter(isNew).length;
    const chips = [['', 'All', q.summary && q.summary.count]].concat(Object.keys(CH).filter((k) => (by[k] && by[k].count) || S.channel === k).map((k) => [k, CH[k][0], by[k] ? by[k].count : 0]));
    box.innerHTML = `<div class="cx-split"><div class="cx-main">
      <div class="cx-bar"><input class="input grow" id="cx-search" type="search" placeholder="Search order, bill, table, room, phone or name  ( / )" value="${E(S.search)}" autocomplete="off">${newN ? `<button type="button" class="cx-newpill" id="cx-allseen">${ic('bell')}<span>${newN} new</span></button>` : ''}<button type="button" class="btn btn-secondary" id="cx-exp">${S.expandAll ? 'Collapse all' : 'Expand all'}</button></div>
      <div class="cx-chips">${chips.map(([k, l, n]) => `<button type="button" class="hx-chip ${k === S.channel ? 'on' : ''}" data-ch="${k}">${E(l)}<em>${n || 0}</em></button>`).join('')}</div>
      <div class="cx-list">${q.rows.length ? q.rows.map(row).join('') : window.HX.empty('Nothing to collect', S.search || S.channel ? 'No orders match this filter.' : 'Every order is paid. New orders waiting for payment show here by themselves.')}</div>
      ${q.total > q.rows.length ? `<p class="hx-sub" style="text-align:center">Showing ${q.rows.length} of ${q.total}. Use search to narrow the list.</p>` : ''}</div>
      <aside class="cx-rail">${railHtml()}</aside></div>`;
    box.querySelectorAll('[data-ch]').forEach((b) => b.addEventListener('click', () => { S.channel = b.dataset.ch; refresh(); }));
    const si = box.querySelector('#cx-search'); let tm;
    si.addEventListener('input', () => { clearTimeout(tm); tm = setTimeout(async () => { S.search = si.value.trim(); await refresh(true); const n = el.querySelector('#cx-search'); if (n) { n.focus(); n.setSelectionRange(n.value.length, n.value.length); } }, 350); });
    const as = box.querySelector('#cx-allseen'); if (as) as.onclick = () => { q.rows.forEach(seen); queueView(box); draw(); };
    box.querySelector('#cx-exp').onclick = () => { S.expandAll = !S.expandAll; q.rows.forEach((r) => { S.open[r.key] = S.expandAll; if (S.expandAll) seen(r); }); queueView(box); };
    box.querySelectorAll('[data-tog]').forEach((h) => h.addEventListener('click', (e) => { if (e.target.closest('button,a')) return; toggle(find(h.dataset.tog), box); }));
    box.querySelectorAll('[data-pay]').forEach((b) => b.addEventListener('click', () => { const r = find(b.dataset.pay); seen(r); pay(r); }));
    box.querySelectorAll('[data-det]').forEach((b) => b.addEventListener('click', () => { const r = find(b.dataset.det); seen(r); detail(r); }));
    wireRail(box);
    q.rows.filter((r) => S.open[r.key]).forEach((r) => loadItems(r, box));
  }
  const find = (key) => ((S.queue && S.queue.rows) || []).find((r) => r.key === key);
  function toggle(r, box) {
    if (!r) return; S.open[r.key] = !S.open[r.key]; seen(r);
    const node = box.querySelector(`[data-row="${CSS.escape(r.key)}"]`); if (!node) return;
    node.classList.toggle('open', !!S.open[r.key]); node.classList.remove('new');
    const nb = node.querySelector('.cx-newbadge'); if (nb) nb.remove();
    if (S.open[r.key]) loadItems(r, box);
  }
  async function loadItems(r, box) {
    const slot = box.querySelector(`[data-items="${CSS.escape(r.key)}"]`); if (!slot || r.kind === 'STAY' || !r.orderId) return;
    let d = S.det[r.orderId];
    if (!d) { slot.innerHTML = '<span class="hx-sub">Loading items…</span>'; d = await get('/cashier/orders/' + r.orderId); if (d) S.det[r.orderId] = d; }
    const again = box.querySelector(`[data-items="${CSS.escape(r.key)}"]`); if (!again) return;
    if (!d) { again.innerHTML = '<span class="hx-sub">Could not load the items. Tap Details to try again.</span>'; return; }
    const its = (d.order.items || []).filter((i) => !i.isChild && i.status !== 'CANCELLED' && i.status !== 'DRAFT');
    again.innerHTML = `<div class="cx-xitems">${its.map((i) => `<div><b>${i.quantity}×</b><span>${E(i.name)}${i.variantName ? ' · ' + E(i.variantName) : ''}${i.notes ? `<small>${E(i.notes)}</small>` : ''}${i.allergyNotes ? `<small class="cx-neg">Allergy: ${E(i.allergyNotes)}</small>` : ''}</span><i>${i.status === 'SERVED' ? 'Served' : E(String(i.status).toLowerCase())}</i><b>${M(i.total)}</b></div>`).join('') || '<span class="hx-sub">No items</span>'}</div>
      <div class="cx-xsum"><span>Billed <b>${M(d.paymentSummary.billed)}</b></span><span>Paid <b>${M(d.paymentSummary.paid)}</b></span><span>${d.paymentSummary.unbilled ? 'Not billed yet' : 'Balance'} <b>${M(d.paymentSummary.unbilled || d.paymentSummary.balance)}</b></span></div>`;
  }

  function payLabelFor(r) {
    return { BILL_PAY: 'Take payment', ORDER_BILL_PAY: 'Bill & pay', KIOSK_CASH: 'Confirm cash', STAY_PAY: r.state === 'DEPOSIT_DUE' ? 'Take deposit' : 'Take payment', NONE: 'Waiting for M-PESA' }[r.payAction] || 'Pay';
  }
  const canPay = (r) => (r.kind === 'STAY' ? can('accommodation.folio.pay') : can('restaurant.bills.pay')) && (r.payAction !== 'ORDER_BILL_PAY' || can('restaurant.bills.generate'));

  function row(r) {
    const [chLabel, color] = CH[r.channel] || ['Order', '#64748b'];
    const st = STATE[r.state] || [r.state, 'mute'];
    const urgent = ['AWAITING_CASH', 'BILL_REQUESTED', 'CHECKOUT_DUE'].includes(r.state), fresh = isNew(r), open = !!S.open[r.key];
    const sub = [r.ref, r.customerName, r.waiterName && 'by ' + r.waiterName, r.itemCount ? r.itemCount + ' item' + (r.itemCount === 1 ? '' : 's') : ''].filter(Boolean).join(' · ');
    const flags = (r.flags || []).map((f) => { const x = FLAG[f]; return x ? `<span class="cx-flag hx-st-${x[1]}">${E(x[0])}</span>` : ''; }).join('') + (r.payHint ? `<span class="cx-flag hx-st-plan">${E(String(r.payHint).replace(/_/g, ' ').toLowerCase())}</span>` : '');
    const disabled = r.payAction === 'NONE' || !canPay(r);
    const lead = r.state === 'AWAITING_CASH' ? `<span class="cx-need" title="Customer is waiting to pay cash">${ic('cash')}</span>` : '';
    return `<div class="cx-r ${open ? 'open' : ''} ${fresh ? 'new' : ''} ${urgent ? 'urgent' : ''}" data-row="${E(r.key)}" style="--ch:${color}">
      <div class="cx-rh" data-tog="${E(r.key)}">
        <span class="cx-ic" title="${E(chLabel)}">${ic(ICON[r.channel] || 'receipt')}</span>
        <div class="cx-t"><b>${E(r.title)}</b>${fresh ? `<span class="cx-newbadge">${ic('bell')}NEW</span>` : ''}${lead}<small>${E(sub)}</small></div>
        <span class="cx-chl">${E(chLabel)}</span>
        <span class="cx-st">${pill(st[0], st[1])}</span>
        <span class="cx-wait ${r.waitMinutes > 25 ? 'hot' : ''}">${r.waitMinutes ? waitText(r.waitMinutes) : ''}</span>
        <b class="cx-amt">${M(r.balance)}</b>
        <div class="cx-rb"><button class="btn btn-sm btn-secondary" data-det="${E(r.key)}">Details</button><button class="btn btn-sm btn-primary" data-pay="${E(r.key)}" ${disabled ? 'disabled' : ''}>${E(payLabelFor(r))}</button></div>
        <span class="cx-caret" aria-hidden="true"></span>
      </div>
      <div class="cx-rx"><div class="cx-xgrid">
        <div><small>Customer</small><b>${E(r.customerName || '-')}</b>${r.customerPhone ? `<a href="tel:${E(r.customerPhone)}">${E(r.customerPhone)}</a>` : ''}</div>
        <div><small>Total / paid</small><b>${M(r.total)}</b><span>paid ${M(r.paid)}</span></div>
        <div><small>${r.kind === 'STAY' ? 'Stay' : 'Served'}</small><b>${r.kind === 'STAY' ? E((r.itemsPreview || []).join(' · ')) : `${r.servedCount}/${r.itemCount}`}</b>${r.waiterName ? `<span>${E(r.waiterName)}</span>` : ''}</div>
        ${r.delivery ? `<div><small>Delivery</small><b>${E(String(r.delivery.status).replace(/_/g, ' ').toLowerCase())}</b><span>${E(r.delivery.address || '')}${r.delivery.riderName ? ' · ' + E(r.delivery.riderName) : ''}</span></div>` : ''}
      </div>${flags ? `<div class="cx-flags">${flags}</div>` : ''}<div data-items="${E(r.key)}"></div></div></div>`;
  }

  // ------------------------------------------------------------------ side panel: my drawer + latest payments (wide screens / full screen)
  function railHtml() {
    const d = S.drawer, sh = d && d.shifts && d.shifts.find((s) => s.shiftId === d.myShiftId), rp = (S.recent && S.recent.payments) || [];
    const drawer = !can('cashier.drawer') ? '' : sh ? `<div class="cx-rcard"><div class="cx-rtitle">My cash drawer <small>${E((sh.register && sh.register.name) || '')}</small></div>
        <div class="cx-rbig"><small>Should be in drawer</small><b>${M(sh.expectedCash)}</b></div>
        <div class="cx-rkv"><span>Float</span><b>${M(sh.openingCash)}</b><span>Cash sales</span><b>+ ${M(sh.cashSales)}</b><span>Paid in / out</span><b>${M(sh.paidIn)} / ${M(sh.paidOut)}</b><span>Safe drops</span><b>${M(sh.safeDrops)}</b></div>
        <div class="cx-ract"><button class="btn btn-sm btn-secondary" data-rev="NO_SALE">No sale</button><button class="btn btn-sm btn-secondary" data-rev="PAID_IN">Paid in</button><button class="btn btn-sm btn-secondary" data-rev="PAID_OUT">Paid out</button><button class="btn btn-sm btn-secondary" data-rev="SAFE_DROP">Safe drop</button></div>
        ${can('shifts.close') ? `<button class="btn btn-danger" style="width:100%;margin-top:8px" data-rclose="${E(sh.shiftId)}">Close shift</button>` : ''}</div>`
      : `<div class="cx-rcard"><div class="cx-rtitle">My cash drawer</div><p class="hx-sub" style="margin:6px 0 10px">No open shift. Open one to take cash.</p><button class="btn btn-primary" style="width:100%" data-rtab="drawer">Open shift</button></div>`;
    return `${drawer}<div class="cx-rcard"><div class="cx-rtitle">Latest payments <small><a href="#tab=payments" data-rtab="payments">All</a></small></div>${rp.length ? rp.map((p) => `<div class="cx-rp"><div><b>${E(p.number)}</b><small>${E(mLabel(p.method))} · ${dt(p.at)}</small></div><b class="${p.kind === 'REFUND' ? 'cx-neg' : ''}">${p.kind === 'REFUND' ? '−' : ''}${M(p.amount)}</b></div>`).join('') : '<p class="hx-sub" style="margin:6px 0 0">No payments yet today.</p>'}</div>`;
  }
  function wireRail(box) {
    box.querySelectorAll('[data-rev]').forEach((b) => b.addEventListener('click', () => { const sh = S.drawer && S.drawer.shifts.find((s) => s.shiftId === S.drawer.myShiftId); drawerEvent(b.dataset.rev, sh); }));
    box.querySelectorAll('[data-rclose]').forEach((b) => b.addEventListener('click', () => closeShiftById(b.dataset.rclose)));
    box.querySelectorAll('[data-rtab]').forEach((b) => b.addEventListener('click', (e) => { e.preventDefault(); S.tab = b.dataset.rtab; refresh(true); }));
  }

  // ------------------------------------------------------------------ taking money (existing dialogs)
  function pay(r) {
    if (!r) return;
    const again = () => refresh(true);
    if (r.payAction === 'BILL_PAY') return window.HX.bill.open(r.billId, { onChange: again, autoPay: true });
    if (r.payAction === 'ORDER_BILL_PAY') return window.HX.bill.forOrder(r.orderId, { pay: true, onChange: again });
    if (r.payAction === 'KIOSK_CASH') return confirmCash(r);
    if (r.payAction === 'STAY_PAY') return window.HX.pay.open({ kind: 'stay', id: r.stayId, title: r.state === 'DEPOSIT_DUE' ? 'Take deposit' : 'Take payment', reference: r.title, due: Math.max(0, r.balance), phone: r.customerPhone, customerName: r.customerName, depositChoice: true, onPaid: again });
    return null;
  }

  function confirmCash(r) {
    let key = window.Api.newIdempotencyKey();
    window.HX.modal({
      title: 'Confirm cash · ' + r.ref, maxWidth: '420px',
      body: `<p style="margin:0 0 6px">${E(r.title)} · amount due</p><div style="font-size:30px;font-weight:800">${M(r.balance)}</div>
        <p class="hx-sub" style="margin:8px 0 0">${E((r.itemsPreview || []).join(', '))}</p>
        <div class="field" style="margin-top:14px"><label for="cx-tn">Cash received (optional)</label><input class="input" id="cx-tn" type="number" min="0" step="any" inputmode="decimal" placeholder="${r.balance}"></div><div id="cx-ch" class="hx-sub" style="font-weight:700"></div>
        <p class="hx-sub" style="margin:10px 0 0">The kitchen only gets this order after you confirm the money.</p>`,
      footer: '<button class="btn btn-secondary" data-x>Cancel</button><button class="btn btn-primary" id="cx-go">Money received</button>',
      onMount(root, close) {
        root.querySelector('[data-x]').onclick = close; const tn = root.querySelector('#cx-tn'), ch = root.querySelector('#cx-ch');
        tn.oninput = () => { const v = Number(tn.value); ch.textContent = v > r.balance ? 'Change to give: ' + M(v - r.balance) : v && v < r.balance ? 'Less than the amount due' : ''; };
        root.querySelector('#cx-go').onclick = async (ev) => {
          const btn = ev.currentTarget; if (btn.disabled) return; btn.disabled = true; btn.textContent = 'Working…';
          const t = tn.value === '' ? undefined : Number(tn.value);
          try {
            const { data } = await window.Api.post('/restaurant/self-service/orders/' + r.orderId + '/confirm-cash', t != null ? { tendered: t } : {}, { idempotencyKey: key });
            close(); window.UI.toast.success(data && data.sentToKitchen === false ? 'Cash confirmed. The kitchen will get it shortly.' : 'Cash confirmed. Sent to the kitchen.'); refresh(true);
          } catch (e) { btn.disabled = false; btn.textContent = 'Money received'; key = window.Api.newIdempotencyKey(); window.UI.toast.error((e && e.message) || 'Could not confirm. Try again.'); }
        };
      },
    });
  }

  // ------------------------------------------------------------------ order details
  async function detail(r) {
    if (!r) return;
    const m = window.HX.modal({ title: `${r.title} · ${r.ref || ''}`, maxWidth: '760px', body: window.HX.skel('rows', 5), footer: '<span></span>' });
    const foot = (html) => { const f = m.el.querySelector('.modal-footer'); if (f) f.innerHTML = html; };
    const bodyEl = () => m.el.querySelector('.modal-body');
    const payBtn = !canPay(r) || r.payAction === 'NONE' ? '' : `<button class="btn btn-primary" id="cx-dpay">${E(payLabelFor(r))} · ${M(r.balance)}</button>`;
    if (r.kind === 'STAY' || !r.orderId) {
      bodyEl().innerHTML = `<div class="cx-det"><div class="cx-kv"><div><small>Guest</small><b>${E(r.customerName || '-')}</b></div><div><small>Room</small><b>${E(r.roomNumber || '-')}</b></div><div><small>Stay</small><b>${E((r.itemsPreview || []).join(' · '))}</b></div><div><small>Charges</small><b>${M(r.total)}</b></div><div><small>Paid</small><b>${M(r.paid)}</b></div><div><small>Balance</small><b>${M(r.balance)}</b></div></div>${r.stay ? `<div class="cx-box">${pill(r.stay.status.replace(/_/g, ' '), 'plan')} <span class="hx-sub">${r.stay.nights || ''} night(s) ${r.stay.mealPlan ? '· ' + E(r.stay.mealPlan) : ''}</span></div>` : ''}</div>`;
      foot(`<a class="btn btn-secondary" href="hx-stays.html">Open booking</a><button class="btn btn-secondary" data-x>Close</button>${payBtn}`);
    } else {
      const d = await get('/cashier/orders/' + r.orderId);
      if (!d) { bodyEl().innerHTML = window.HX.empty('Could not load', 'Try again in a moment.'); foot('<button class="btn btn-secondary" data-x>Close</button>'); } else { bodyEl().innerHTML = detailHtml(d); foot(`<button class="btn btn-secondary" data-x>Close</button>${payBtn}`); wireDetail(m, d); }
    }
    const x = m.el.querySelector('[data-x]'); if (x) x.onclick = m.close;
    const dp = m.el.querySelector('#cx-dpay'); if (dp) dp.onclick = () => { m.close(); pay(r); };
  }

  function detailHtml(d) {
    const o = d.order, ps = d.paymentSummary || {}, [chLabel] = CH[o.channel] || [o.channelLabel];
    const kv = (k, v) => (v || v === 0 ? `<div><small>${E(k)}</small><b>${E(v)}</b></div>` : '');
    const items = (o.items || []).filter((i) => !i.isChild || i.status !== 'CANCELLED').map((i) => `<div class="cx-line"><b>${i.quantity}×</b><div>${E(i.name)}${i.variantName ? ' · ' + E(i.variantName) : ''} ${i.status === 'CANCELLED' ? pill('Cancelled', 'bad') : i.status === 'SERVED' ? pill('Served', 'ok') : i.status === 'DRAFT' ? '' : pill(i.status, 'busy')}
      ${(i.modifiers || []).length ? `<small>${i.modifiers.map((x) => (x.removal ? 'No ' : '') + E(x.name)).join(', ')}</small>` : ''}${i.notes ? `<small>Note: ${E(i.notes)}</small>` : ''}${i.allergyNotes ? `<small style="color:var(--px-red)">Allergy: ${E(i.allergyNotes)}</small>` : ''}${i.isComplimentary ? `<small>Complimentary ${E(i.compReason)}</small>` : ''}</div><b>${M(i.total)}</b></div>`).join('');
    const bills = (d.bills || []).map((b) => `<div class="cx-box"><div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;align-items:center"><b>${E(b.billNumber)}${b.label ? ' · ' + E(b.label) : ''}</b><span>${pill(b.status, { PAID: 'ok', OPEN: 'warn', PARTIAL: 'busy' }[b.status] || 'mute')} <b>${M(b.total)}</b></span></div>
      <div class="hx-sub" style="margin:4px 0">Items ${M(b.itemsTotal)}${b.discount ? ' · Discount −' + M(b.discount) : ''}${b.serviceCharge ? ' · Service ' + M(b.serviceCharge) : ''}${b.tax ? ' · VAT incl. ' + M(b.tax) : ''} · Paid ${M(b.paid)} · Balance ${M(b.balance)}</div>
      ${(b.payments || []).map((p) => `<div class="cx-line" style="grid-template-columns:1fr auto"><div>${E(mLabel(p.method))}${p.kind === 'REFUND' ? ' (refund)' : ''} ${p.verifyStatus === 'PENDING' ? pill('Check', 'bad') : ''}<small>${[p.reference, p.by, p.at && dt(p.at), p.method === 'CASH' && p.tendered ? `Given ${M(p.tendered)} · change ${M(p.change || 0)}` : ''].filter(Boolean).map(E).join(' · ')}</small></div><b>${p.kind === 'REFUND' ? '−' : ''}${M(p.amount)}</b></div>`).join('')}
      <div class="cx-btns" style="margin-top:8px;justify-content:flex-start">${can('restaurant.bills.view') ? `<button class="btn btn-sm btn-secondary" data-reprint="${E(b.id)}">Reprint receipt at cashier</button>` : ''}</div></div>`).join('');
    const dl = o.delivery, ss = o.selfService;
    return `<div class="cx-det">
      <div>${pill(o.status, o.status === 'OPEN' ? 'busy' : 'mute')} ${pill(chLabel, 'plan')} ${o.billStatus && o.billStatus !== 'NONE' ? pill('Bill ' + o.billStatus, 'warn') : ''}</div>
      <div class="cx-kv">${kv('Order', o.orderNumber)}${kv('Pickup no.', o.pickupNumber)}${kv('Table', o.tableName)}${kv('Room', o.roomNumber)}${kv('Guests', o.guestCount)}${kv('Waiter', o.waiterName)}${kv('Customer', o.customerName)}${kv('Phone', o.customerPhone)}${kv('Opened', dt(o.createdAt))}</div>
      ${o.notes ? `<div class="cx-box"><b>Order note</b><div class="hx-sub">${E(o.notes)}</div></div>` : ''}
      <div class="cx-sum"><div><small>Billed</small><b>${M(ps.billed)}</b></div><div><small>Paid</small><b style="color:var(--px-green)">${M(ps.paid)}</b></div><div><small>${ps.unbilled ? 'Not billed yet' : 'Balance'}</small><b>${M(ps.unbilled || ps.balance)}</b></div></div>
      ${dl ? `<div><h4>Delivery</h4><div class="cx-box cx-kv">${kv('Status', String(dl.status).replace(/_/g, ' '))}${kv('Contact', dl.contactName)}${kv('Phone', dl.phone)}${kv('Address', dl.address)}${kv('Landmark', dl.landmark)}${kv('Rider', dl.riderName)}${kv('Pays by', dl.payment)}${dl.fee ? kv('Delivery fee', M(dl.fee)) : ''}${kv('Instructions', dl.instructions)}</div></div>` : ''}
      ${ss ? `<div><h4>Self service</h4><div class="cx-box cx-kv">${kv('Pays by', ss.paymentMethod)}${kv('State', String(ss.paymentState).replace(/_/g, ' '))}${kv('Confirmed by', ss.confirmedByName)}${kv('Paid at', ss.paidAt && dt(ss.paidAt))}</div></div>` : ''}
      <div><h4>Items · ${o.servedCount}/${o.itemCount} served</h4><div class="cx-box">${items || '<span class="hx-sub">No items</span>'}</div></div>
      ${bills ? `<div><h4>Bills & payments</h4><div style="display:grid;gap:8px">${bills}</div></div>` : ''}
      ${(d.timeline || []).length ? `<div><h4>Timeline</h4><ul class="cx-tl">${d.timeline.map((t) => `<li><b>${E(String(t.action || '').replace(/[._]/g, ' '))}</b>${t.note ? ' · ' + E(t.note) : ''}<small>${dt(t.at)}</small></li>`).join('')}</ul></div>` : ''}</div>`;
  }

  function wireDetail(m) { m.el.querySelectorAll('[data-reprint]').forEach((b) => b.addEventListener('click', () => reprint(b.dataset.reprint, b))); }
  async function reprint(billId, btn) {
    if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }
    try { await window.Api.post('/cashier/bills/' + billId + '/reprint', {}); window.UI.toast.success('Receipt sent to the cashier printer'); }
    catch (e) { window.UI.toast.error((e && e.message) || 'Could not print'); }
    if (btn) { btn.disabled = false; btn.textContent = 'Reprint receipt at cashier'; }
  }

  // ------------------------------------------------------------------ payments ledger
  async function paymentsView(box) {
    const f = S.pay; if (!f.date) f.date = (S.ov && S.ov.date) || '';
    box.innerHTML = `<div class="cx-bar"><input class="input" type="date" id="px-date" value="${E(f.date)}"><select class="select" id="px-m"><option value="">All methods</option>${METHODS.map(([k, l]) => `<option value="${k}" ${f.method === k ? 'selected' : ''}>${l}</option>`).join('')}</select><input class="input grow" id="px-s" type="search" placeholder="Search bill, room, reference, phone or cashier" value="${E(f.search)}"></div><div id="px-out">${window.HX.skel('rows', 4)}</div>`;
    const load = async () => {
      const d = await get('/cashier/payments', { branchId: bid(), date: f.date, method: f.method, search: f.search, limit: 400 }); const out = box.querySelector('#px-out'); if (!out) return;
      if (!d) { out.innerHTML = window.HX.empty('Could not load', 'Try again in a moment.'); return; }
      const s = d.summary || {}, rows = d.payments || [];
      out.innerHTML = `<div class="cx-methods">${[['Collected', s.collected, s.count + ' payments'], ...Object.entries(s.byMethod || {}).map(([k, v]) => [mLabel(k), v.amount, v.count + ' payments'])].concat(s.refunds ? [['Refunds', -s.refunds, 'given back']] : []).concat([['Net', s.net, 'after refunds']]).map(([l, a, c]) => `<div class="cx-method"><small>${E(l)}</small><b class="${a < 0 ? 'cx-neg' : ''}">${M(a)}</b><span>${E(c)}</span></div>`).join('')}</div>
        <div class="cx-scroll" style="margin-top:12px">${rows.length ? `<table class="cx-table"><thead><tr><th>Time</th><th>Document</th><th>Method</th><th>Taken by</th><th class="num">Amount</th><th></th></tr></thead><tbody>${rows.map((r) => `<tr><td>${dt(r.at)}</td><td><b>${E(r.number)}</b><small>${E(r.label || '')}</small></td><td>${E(mLabel(r.method))}${r.kind === 'REFUND' ? ' ' + pill('Refund', 'bad') : ''}${r.verifyStatus === 'PENDING' ? ' ' + pill('Check', 'bad') : ''}<small>${E([r.reference, r.payerPhone, r.method === 'CASH' && r.tendered ? `given ${M(r.tendered)}, change ${M(r.change || 0)}` : ''].filter(Boolean).join(' · '))}</small></td><td>${E(r.by || '')}</td><td class="num ${r.kind === 'REFUND' ? 'cx-neg' : ''}">${r.kind === 'REFUND' ? '−' : ''}${M(r.amount)}</td><td>${r.docType === 'BILL' ? `<button class="btn btn-sm btn-secondary" data-rp="${E(r.docId)}">Reprint</button>` : ''}</td></tr>`).join('')}</tbody></table>` : window.HX.empty('No payments', 'Nothing was collected for this filter.')}</div>`;
      out.querySelectorAll('[data-rp]').forEach((b) => b.addEventListener('click', () => reprint(b.dataset.rp, b)));
    };
    box.querySelector('#px-date').onchange = (e) => { f.date = e.target.value; load(); };
    box.querySelector('#px-m').onchange = (e) => { f.method = e.target.value; load(); };
    let tm; box.querySelector('#px-s').oninput = (e) => { clearTimeout(tm); tm = setTimeout(() => { f.search = e.target.value.trim(); load(); }, 350); };
    load();
  }

  // ------------------------------------------------------------------ cash drawer
  async function drawerView(box) {
    box.innerHTML = window.HX.skel('rows', 4);
    const d = await get('/cashier/drawer', { branchId: bid() }); if (!d || S.tab !== 'drawer') { if (!d) box.innerHTML = window.HX.empty('Could not load the drawer', 'Try again in a moment.'); return; }
    const mine = (d.shifts || []).find((s) => s.shiftId === d.myShiftId), others = (d.shifts || []).filter((s) => s.shiftId !== d.myShiftId);
    const names = Object.fromEntries((d.shifts || []).map((s) => [s.shiftId, s.cashier.name]));
    const shiftCard = (s, own) => `<div class="cx-drawer"><div class="cx-drawer-head"><div><b style="font-size:16px">${E(s.cashier.name || 'Cashier')}${own ? ' (you)' : ''}</b><div class="hx-sub">${E((s.register && s.register.name) || 'Register')} · open ${waitText(s.durationMinutes)} · since ${dt(s.openedAt)}</div></div><div class="cx-expected"><small>Should be in drawer</small><b>${M(s.expectedCash)}</b></div></div>
      <div class="cx-calc"><div><small>Opening float</small><b>${M(s.openingCash)}</b></div><div><small>Cash sales (${s.cashSalesCount})</small><b>+ ${M(s.cashSales)}</b></div><div><small>Paid in</small><b>+ ${M(s.paidIn)}</b></div><div><small>Paid out</small><b>− ${M(s.paidOut)}</b></div><div><small>Safe drops</small><b>− ${M(s.safeDrops)}</b></div><div><small>No sales / opens</small><b>${s.noSales} / ${s.drawerOpens}</b></div></div>
      <div class="cx-methods">${Object.entries(s.salesByMethod || {}).map(([k, v]) => `<div class="cx-method"><small>${E(mLabel(k))}</small><b>${M(v.amount)}</b><span>${v.count} payments</span></div>`).join('') || '<span class="hx-sub">No sales on this shift yet.</span>'}</div>
      ${own && can('cashier.drawer') ? `<div class="cx-actions"><button class="btn btn-secondary" data-ev="NO_SALE">No sale (open drawer)</button><button class="btn btn-secondary" data-ev="PAID_IN">Paid in</button><button class="btn btn-secondary" data-ev="PAID_OUT">Paid out</button><button class="btn btn-secondary" data-ev="SAFE_DROP">Safe drop</button></div>${can('shifts.close') ? `<button class="btn btn-danger" data-sclose="${E(s.shiftId)}" style="min-height:48px">Close shift &amp; count drawer</button>` : ''}` : (d.lead && can('shifts.close') ? `<button class="btn btn-secondary" data-sclose="${E(s.shiftId)}">Close this shift</button>` : '')}</div>`;
    const events = (d.events || []).filter((e) => e.type !== 'CASH_SALE');
    const evLabel = { NO_SALE: ['No sale', 'warn'], PAID_IN: ['Paid in', 'ok'], PAID_OUT: ['Paid out', 'bad'], SAFE_DROP: ['Safe drop', 'plan'] };
    box.innerHTML = `<div style="display:grid;gap:14px">${mine ? shiftCard(mine, true) : openShiftHtml(d)}${others.map((s) => shiftCard(s, false)).join('')}
      <div class="cx-box"><h4 style="margin:0 0 6px;font-size:13px">Drawer activity</h4>${events.length ? events.map((e) => `<div class="cx-ev">${pill(evLabel[e.type] ? evLabel[e.type][0] : e.type, evLabel[e.type] ? evLabel[e.type][1] : 'mute')}<div><b>${E(e.reason || '-')}</b><div class="hx-sub">${E(e.by || names[e.shiftId] || '')} · ${dt(e.at)}${e.reference ? ' · ' + E(e.reference) : ''}</div></div><b>${e.amount ? (e.type === 'PAID_IN' ? '+ ' : '− ') + M(e.amount) : ''}</b></div>`).join('') : '<span class="hx-sub">No drawer movements yet.</span>'}</div></div>`;
    box.querySelectorAll('[data-ev]').forEach((b) => b.addEventListener('click', () => drawerEvent(b.dataset.ev, mine)));
    box.querySelectorAll('[data-sclose]').forEach((b) => b.addEventListener('click', () => closeShiftById(b.dataset.sclose)));
    const form = box.querySelector('#cx-open-form'); if (form) form.onsubmit = (e) => { e.preventDefault(); openShift(form, d); };
  }

  function openShiftHtml(d) {
    const free = (d.registers || []).filter((r) => !r.inUse);
    if (!d.registers || !d.registers.length) return `<div class="cx-box">${window.HX.empty('No cash register', 'Add a register in Cash register first, then open your shift here.')}<div style="text-align:center"><a class="btn btn-primary" href="cash-register.html">Go to Cash register</a></div></div>`;
    return `<form class="cx-drawer" id="cx-open-form"><div><b style="font-size:17px">Open your cash shift</b><div class="hx-sub">Count the float in your drawer, then start. You need an open shift to take cash.</div></div>
      <div class="hx-form" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px"><div class="field"><label for="cx-reg">Register</label><select class="select" id="cx-reg" required>${free.map((r) => `<option value="${E(r.id)}">${E(r.name)}${r.code ? ' · ' + E(r.code) : ''}</option>`).join('') || '<option value="">All registers are in use</option>'}</select></div>
      <div class="field"><label for="cx-float">Opening cash (float)</label><input class="input" id="cx-float" type="number" min="0" step="0.01" inputmode="decimal" value="0" required></div></div>
      <button class="btn btn-primary" type="submit" ${free.length ? '' : 'disabled'} style="min-height:48px">Open shift</button></form>`;
  }
  async function openShift(form, d) {
    const reg = form.querySelector('#cx-reg').value, cash = Number(form.querySelector('#cx-float').value);
    if (!reg) return window.UI.toast.warning('Pick a register'); if (!(cash >= 0)) return window.UI.toast.warning('Enter the opening cash');
    const btn = form.querySelector('button[type=submit]'); btn.disabled = true; btn.textContent = 'Opening…';
    try { await window.Api.post('/restaurant/shift/open', { branchId: bid() || undefined, registerId: reg, openingCash: cash }); window.UI.toast.success('Cash shift opened'); await refresh(true); }
    catch (e) { btn.disabled = false; btn.textContent = 'Open shift'; window.UI.toast.error((e && e.message) || 'Could not open the shift'); }
  }

  function drawerEvent(type, shift) {
    const money = type !== 'NO_SALE'; let key = window.Api.newIdempotencyKey();
    const T = { NO_SALE: ['No sale', 'Opens the drawer without a sale. Management is told.', 'Reason (e.g. change for a customer)'], PAID_IN: ['Paid in', 'Cash added to the drawer (e.g. extra float).', 'Reason'], PAID_OUT: ['Paid out', `Cash taken out for a supplier or expense. At most ${M(shift ? shift.expectedCash : 0)} is in the drawer.`, 'Reason (e.g. gas, supplier)'], SAFE_DROP: ['Safe drop', 'Cash moved from the drawer to the safe.', 'Reason (e.g. drawer over limit)'] }[type];
    window.HX.modal({
      title: T[0], maxWidth: '420px',
      body: `<p class="hx-sub" style="margin:0 0 10px">${E(T[1])}</p>${money ? '<div class="field"><label for="de-a">Amount</label><input class="input hx-big" id="de-a" type="number" min="0" step="0.01" inputmode="decimal" required></div>' : ''}<div class="field"><label for="de-r">${E(T[2])}</label><input class="input" id="de-r" maxlength="300" required></div><div class="field"><label for="de-ref">Reference (optional)</label><input class="input" id="de-ref" maxlength="80"></div>`,
      footer: '<button class="btn btn-secondary" data-x>Cancel</button><button class="btn btn-primary" id="de-go">Record</button>',
      onMount(root, close) {
        root.querySelector('[data-x]').onclick = close;
        root.querySelector('#de-go').onclick = async (ev) => {
          const btn = ev.currentTarget, amt = money ? Number(root.querySelector('#de-a').value) : undefined, reason = root.querySelector('#de-r').value.trim(), ref = root.querySelector('#de-ref').value.trim();
          if (money && !(amt > 0)) return window.UI.toast.warning('Enter the amount'); if (reason.length < 3) return window.UI.toast.warning('Give a reason');
          btn.disabled = true; btn.textContent = 'Saving…';
          const body = { type, reason }; if (money) body.amount = amt; if (ref) body.reference = ref;
          try { await window.Api.post('/cashier/drawer/events', body, { idempotencyKey: key }); close(); window.UI.toast.success(T[0] + ' recorded'); refresh(true); }
          catch (e) { btn.disabled = false; btn.textContent = 'Record'; key = window.Api.newIdempotencyKey(); window.UI.toast.error((e && e.message) || 'Could not record'); }
        };
      },
    });
  }
  // ------------------------------------------------------------------ close shift (count the drawer by note and coin, same dialog as the till)
  async function closeShiftById(shiftId) {
    if (!shiftId) return;
    const known = (S.drawer && S.drawer.shifts || []).find((s) => s.shiftId === shiftId) || (S.ov && S.ov.shift && S.ov.shift.shiftId === shiftId ? S.ov.shift : null);
    const lead = ['OWNER', 'MANAGER'].includes(window.HX.user().role), own = !known || !S.drawer || shiftId === S.drawer.myShiftId || (S.ov && S.ov.shift && S.ov.shift.shiftId === shiftId);
    if (!window.CashCount || !window.CashCount.openCountModal) { window.UI.toast.warning('Opening the cash register page to close the shift'); location.href = 'cash-register.html'; return; }
    const waiting = (S.ov && S.ov.attention && S.ov.attention.kioskCashWaiting) || 0;
    if (waiting && window.UI.confirmDialog) { const ok = await window.UI.confirmDialog({ title: 'Orders still waiting for cash', message: `${waiting} self-service order${waiting === 1 ? ' is' : 's are'} waiting for cash. Close the shift anyway?`, confirmText: 'Continue', danger: true }); if (!ok) return; }
    window.CashCount.openCountModal({
      title: own ? 'Close your shift' : `Close ${known && known.cashier ? known.cashier.name + "'s" : 'this'} shift`,
      intro: `Count the cash in the drawer and enter how many of each note and coin there are. The total is added up for you.${lead && known ? ' The system expects ' + M(known.expectedCash) + '.' : ''}`,
      confirmText: 'Close shift', confirmClass: 'btn-danger',
      onSubmit: async ({ denominations, notes }) => {
        const { data } = await window.Api.post(`/shifts/${shiftId}/close`, { denominations, notes });
        window.UI.closeModal(); shiftSummary(data.shift); S.drawer = null; refresh(true);
      },
    });
  }
  function shiftSummary(s) {
    const diff = Number(s.cashDifference) || 0;
    const m = window.HX.modal({
      title: 'Shift closed', maxWidth: '520px',
      body: `<div class="cx-sum" style="grid-template-columns:repeat(3,1fr)"><div><small>Expected</small><b>${M(s.expectedCash)}</b></div><div><small>Counted</small><b>${M(s.actualCash)}</b></div><div><small>${diff === 0 ? 'Balanced' : diff > 0 ? 'Over' : 'Short'}</small><b style="color:${diff === 0 ? 'var(--px-green)' : 'var(--px-red)'}">${M(Math.abs(diff))}</b></div></div><p class="hx-sub" style="margin:10px 0 0">Opening float ${M(s.openingCash)}.${diff < 0 ? ' A short drawer is recorded against the cashier and management is told.' : ''}</p>${window.CashCount && window.CashCount.breakdownHtml ? window.CashCount.breakdownHtml(s.denominations) : ''}`,
      footer: '<button class="btn btn-primary" data-x>Done</button>', onMount(root, close) { root.querySelector('[data-x]').onclick = close; },
    });
    return m;
  }
})();
