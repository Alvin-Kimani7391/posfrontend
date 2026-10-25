/**
 * hx-manager.js - owner / manager command centre. ONE page, one call: GET /manager/overview?date=&branchId=
 * Refreshes every 30 s (today only) and keeps the open tab, filters and date while it does.
 */
(function () {
  const { E, M, get, head } = window.HX;
  let el, data = null, tab = 'overview', date = '', ch = '', st = '', q = '', stop;
  document.addEventListener('DOMContentLoaded', init);

  const TABS = [['overview', 'Overview'], ['orders', 'Orders'], ['kitchen', 'Kitchen'], ['reservations', 'Reservations'], ['staff', 'Staff & shifts'], ['payments', 'Payments'], ['delivery', 'Delivery & online'], ['qr', 'Guest QR'], ['menu', 'Menu today'], ['stock', 'Stock & expiry'], ['money', 'Tips & cash box'], ['loss', 'Losses']];
  const CSS = `<style>
  .mg-tabs{display:flex;gap:6px;overflow-x:auto;padding:6px 0 10px;position:sticky;top:0;z-index:5;background:var(--color-bg);scrollbar-width:thin}
  .mg-tabs button{border:1px solid var(--color-border);background:var(--color-surface);color:var(--color-text);padding:8px 14px;border-radius:999px;font-weight:600;white-space:nowrap;cursor:pointer;font-family:inherit;font-size:var(--text-sm)}
  .mg-tabs button.on{background:var(--color-primary);color:var(--color-text-on-primary,#fff);border-color:transparent}
  .mg-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;margin:8px 0 14px}
  .mg-k b{display:block;font-size:var(--text-xl);margin-top:2px;line-height:1.2}
  .mg-wrap{overflow-x:auto;border:1px solid var(--color-border);border-radius:12px;background:var(--color-surface)}
  .mg-tbl{width:100%;border-collapse:collapse;font-size:var(--text-sm)}
  .mg-tbl th{text-align:left;font-size:var(--text-xs);text-transform:uppercase;letter-spacing:.04em;color:var(--color-text-muted);padding:9px 10px;white-space:nowrap;background:var(--color-bg)}
  .mg-tbl td{padding:9px 10px;border-top:1px solid var(--color-border);vertical-align:top}
  .mg-tbl tr.mg-hot td{background:var(--st-bg)}
  .mg-al{padding:10px 14px;border-radius:12px;margin:6px 0;font-weight:600;font-size:var(--text-sm);background:var(--st-bg);color:var(--st);border-left:4px solid var(--st)}
  .mg-bar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:6px 0 10px}
  .mg-bar input,.mg-bar select{padding:9px 12px;border:1px solid var(--color-border);border-radius:10px;font-family:inherit;background:var(--color-surface);color:var(--color-text)}
  .mg-sec{margin:20px 0 8px;font-weight:800;font-size:var(--text-lg)}
  .mg-sub{color:var(--color-text-muted);font-size:var(--text-xs)}
  .mg-ch{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:10px;margin-bottom:8px}
  .mg-ch .hx-card{cursor:pointer}.mg-ch .hx-card:hover{border-color:var(--color-primary)}
  @media print{.mg-tabs,.mg-bar{display:none}}
  </style>`;

  async function init() {
    el = window.HX.mount('Manager dashboard');
    if (!el) return;
    el.innerHTML = '<div class="hx-card"><p class="hx-sub">Loading the day…</p></div>';
    await window.AppShell.whenProfileReady?.();
    date = new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 10);
    stop = window.HX.live(() => { if (isToday()) load(); }, 30000);
    load();
  }
  const isToday = () => date === new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 10);
  async function load() {
    const d = await get('/manager/overview', { branchId: window.HX.branchId(), date });
    if (d) data = d.overview || d;
    render();
  }

  const t = (d) => (d ? new Date(d).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' }) : '-');
  const dt = (d) => (d ? new Date(d).toLocaleString('en-KE', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '-');
  const mn = (v) => (v == null ? '-' : v + ' min');
  const num = (v) => (v == null ? '-' : Number(v).toLocaleString('en-KE'));
  const m = (v) => (v == null ? '-' : M(v));
  const nice = (s) => String(s || '').replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
  function pill(text, tone) { return window.HX.pill(text, tone || 'mute'); }
  const TONE = { PAID: 'ok', VERIFIED: 'ok', OK: 'ok', SERVED: 'ok', READY: 'ok', DELIVERED: 'ok', ACCEPTED: 'ok', AVAILABLE: 'ok', CLOSED: 'mute', OPEN: 'busy', COOKING: 'warn', WAITING: 'warn', UNPAID: 'bad', NOT_BILLED: 'mute', PART_PAID: 'warn', AWAITING_CASH: 'warn', PENDING: 'warn', REJECTED: 'bad', CANCELLED: 'mute', FAILED: 'bad', SOLD_OUT: 'bad', EXPIRED: 'bad', CRITICAL: 'warn', WARNING: 'warn', LOW: 'warn', OUT: 'bad', NEGATIVE: 'bad', NO_SHOW: 'bad', CASH_WITH_RIDER: 'warn', OUT_FOR_DELIVERY: 'warn' };
  const P = (s) => pill(s, TONE[s] || 'mute');
  function table(cols, rows, empty) {
    if (!rows || !rows.length) return `<p class="hx-sub">${E(empty || 'Nothing to show.')}</p>`;
    return `<div class="mg-wrap"><table class="mg-tbl"><thead><tr>${cols.map((c) => `<th>${E(c[0])}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${cols.map((c) => `<td>${c[1](r)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  }
  const kpi = (l, v, sub) => `<div class="hx-card mg-k"><small class="hx-sub">${E(l)}</small><b>${v}</b>${sub ? `<small class="hx-sub">${sub}</small>` : ''}</div>`;
  const sect = (title, body, err) => `<div class="mg-sec">${E(title)}</div>${err ? `<div class="mg-al hx-st-warn">Could not load: ${E(err)}</div>` : ''}${body}`;
  const sec = (s) => (s && s.error ? s.error : null);

  function render() {
    if (!el) return;
    let h = window.HX.head('Manager dashboard', 'Everything happening today, in one place', isToday() ? '<span class="hx-live">Live</span>' : '');
    h += CSS + `<div class="mg-bar"><label>Date <input type="date" id="mg-date" value="${E(date)}" max="${new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 10)}"></label><button class="btn btn-secondary" id="mg-today" type="button">Today</button><button class="btn btn-secondary" id="mg-refresh" type="button">Refresh</button><button class="btn btn-secondary" id="mg-print" type="button">Print</button>${data ? `<span class="mg-sub">Updated ${t(data.meta.generatedAt)}</span>` : ''}</div>`;
    if (!data) { el.innerHTML = h + '<div class="hx-card"><p class="hx-sub">No data yet. If this stays empty, the backend needs the new /manager route deployed, and you must be signed in as owner, admin or manager.</p></div>'; bind(); return; }
    const al = data.alerts.filter((a) => a.level !== 'info').length;
    h += `<div class="mg-tabs">${TABS.map(([k, l]) => `<button type="button" data-tab="${k}" class="${tab === k ? 'on' : ''}">${E(l)}${k === 'overview' && al ? ` (${al})` : ''}</button>`).join('')}</div>`;
    h += ({ overview, orders, kitchen, reservations, staff, payments, delivery, qr, menu, stock, money, loss }[tab] || overview)();
    el.innerHTML = h; bind();
  }
  function bind() {
    el.querySelectorAll('[data-goch]').forEach((b) => (b.onclick = () => { tab = 'orders'; ch = b.dataset.goch; st = ''; q = ''; render(); window.scrollTo(0, 0); }));
    el.querySelectorAll('[data-tab]').forEach((b) => (b.onclick = () => { tab = b.dataset.tab; render(); window.scrollTo(0, 0); }));
    const $ = (id) => el.querySelector(id);
    $('#mg-date').onchange = (e) => { date = e.target.value || date; load(); };
    $('#mg-today').onclick = () => { date = new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 10); load(); };
    $('#mg-refresh').onclick = load; $('#mg-print').onclick = () => window.print();
    const c = $('#mg-ch'), s = $('#mg-st'), qq = $('#mg-q');
    if (c) c.onchange = () => { ch = c.value; render(); };
    if (s) s.onchange = () => { st = s.value; render(); };
    if (qq) { qq.oninput = () => { q = qq.value; const pos = qq.selectionStart; render(); const n = el.querySelector('#mg-q'); n.focus(); n.setSelectionRange(pos, pos); }; }
  }

  // ---------------- tabs ----------------
  function overview() {
    const k = data.kpis; const a = data.accommodation && !data.accommodation.error ? data.accommodation : null;
    let h = '<div class="mg-grid">' + [
      kpi('Sales today', m(k.revenue), `${num(k.orders)} orders`), kpi('Collected', m(k.collected), `Net ${m(k.netCollected)}`), kpi('Open orders', num(k.openOrders), `${num(k.unpaidOpenOrders)} unpaid`),
      kpi('In kitchen', num(k.inKitchen), `${num(k.delayedNow)} late · avg ${k.averagePrepMinutes == null ? '-' : k.averagePrepMinutes + ' min'}`), kpi('Reservations', num(k.reservationsToday)), kpi('Deliveries active', num(k.deliveriesActive), `${num(k.onlineOrders)} online`),
      kpi('Guest QR waiting', num(k.qrPending)), kpi('Staff on duty', num(k.staffOnDuty)), kpi('Cash in drawers', m(k.cashInDrawers), `${num(k.openDrawers)} open`), kpi('Tips', m(k.tips)), kpi('Losses', m(k.loss)), kpi('Guests served', num(k.guests)),
      a ? kpi('Room occupancy', k.occupancyPercent + '%', `${a.occupied}/${a.rooms} rooms · ${a.reserved} reserved`) : '',
    ].join('') + '</div>';
    h += sect('Needs your attention', data.alerts.length ? data.alerts.map((x) => `<div class="mg-al ${x.level === 'high' ? 'hx-st-bad' : x.level === 'warn' ? 'hx-st-warn' : 'hx-st-plan'}">${E(nice(x.area))}: ${E(x.text)}</div>`).join('') : '<p class="hx-sub">All clear.</p>');
    h += sect('Orders by channel (tap to open)', `<div class="mg-ch">${data.orders.byChannel.filter((r) => r.orders || r.cancelled).map((r) => `<div class="hx-card" data-goch="${r.key}"><small class="hx-sub">${E(r.label)}</small><b style="display:block;font-size:var(--text-xl)">${num(r.orders)}</b><small class="hx-sub">${m(r.revenue)} · ${num(r.open)} open${r.cancelled ? ' · ' + r.cancelled + ' cancelled' : ''}</small></div>`).join('') || '<p class="hx-sub">No orders yet.</p>'}</div>`);
    h += sect('Who handled the orders', table([['Staff', (r) => E(r.name)], ['Orders', (r) => num(r.total)], ['Sales', (r) => m(r.revenue)], ['Channels', (r) => Object.entries(r.byChannel).map(([c, n]) => `${E(nice(c))} ${n}`).join(' · ')]], data.orders.byStaff));
    return h;
  }
  function orders() {
    const rows = data.orders.rows.filter((r) => (!ch || r.channel === ch) && (!st || (st === 'LATE' ? r.kitchen.delayedNow : st === 'UNPAID' ? r.status === 'OPEN' && r.payment.state !== 'PAID' : r.status === st)) && (!q || [r.orderNumber, r.table, r.waiter, r.handledBy, r.customer, r.phone].join(' ').toLowerCase().includes(q.toLowerCase())));
    const s = data.orders.summary;
    let h = `<div class="mg-grid">${kpi('Orders', num(s.total))}${kpi('Open', num(s.open))}${kpi('Closed', num(s.closed))}${kpi('Cancelled', num(s.cancelled))}${kpi('Unpaid open', num(s.unpaidOpen))}${kpi('From earlier days', num(s.carriedOver))}</div>`;
    h += `<div class="mg-bar"><select id="mg-ch"><option value="">All channels</option>${data.orders.byChannel.map((c) => `<option value="${c.key}" ${ch === c.key ? 'selected' : ''}>${E(c.label)}</option>`).join('')}</select><select id="mg-st">${[['', 'Any status'], ['OPEN', 'Open'], ['CLOSED', 'Closed'], ['CANCELLED', 'Cancelled'], ['LATE', 'Late in kitchen'], ['UNPAID', 'Open & unpaid']].map(([v, l]) => `<option value="${v}" ${st === v ? 'selected' : ''}>${l}</option>`).join('')}</select><input id="mg-q" placeholder="Search order, table, staff, customer" value="${E(q)}"></div>`;
    return h + table([
      ['Order', (r) => `<b>${E(r.orderNumber)}</b>${r.carriedOver ? '<br>' + pill('earlier day', 'warn') : ''}<br><span class="mg-sub">${t(r.createdAt)}</span>`],
      ['Channel', (r) => E(r.channelLabel) + (r.table ? `<br><span class="mg-sub">Table ${E(r.table)}</span>` : r.room ? `<br><span class="mg-sub">Room ${E(r.room)}</span>` : r.customer ? `<br><span class="mg-sub">${E(r.customer)}</span>` : '')],
      ['Handled by', (r) => E(r.handledLabel) + (r.waiter && r.waiter !== r.handledBy ? `<br><span class="mg-sub">Waiter ${E(r.waiter)}</span>` : '')],
      ['Items', (r) => E(r.items.slice(0, 3).join(', ')) + (r.items.length > 3 ? ` +${r.items.length - 3}` : '')],
      ['Kitchen', (r) => P(r.kitchen.state) + (r.kitchen.delayedNow ? ' ' + pill('late ' + r.kitchen.elapsedMinutes + 'm', 'bad') : r.kitchen.prepMinutes != null ? `<br><span class="mg-sub">${r.kitchen.prepMinutes} min${r.kitchen.wasLate ? ' (was late)' : ''}</span>` : '')],
      ['Payment', (r) => P(r.payment.state) + (r.payment.methods.length ? `<br><span class="mg-sub">${E(r.payment.methods.map(nice).join(', '))}</span>` : '') + (r.payment.verify === 'PENDING' ? '<br>' + pill('unverified', 'warn') : '')],
      ['Cash received / approved', (r) => `${E(r.payment.receivedBy || '-')}<br><span class="mg-sub">${E(r.payment.approvedBy || '-')}</span>`],
      ['Total', (r) => `<b>${m(r.total)}</b><br><span class="mg-sub">paid ${m(r.paid)}</span>`],
      ['Status', (r) => P(r.status)],
    ], rows, 'No orders match.');
  }
  function kitchen() {
    const k = data.kitchen; if (sec(k)) return sect('Kitchen', '', sec(k)); const s = k.stats;
    let h = `<div class="mg-grid">${kpi('In kitchen', num(s.inKitchen))}${kpi('Running late', num(s.delayedNow), 'limit ' + k.limitMinutes + ' min')}${kpi('Ready, waiting to serve', num(s.readyWaiting))}${kpi('Finished today', num(s.finishedToday))}${kpi('Finished late', num(s.lateFinished))}${kpi('Average prep', s.averagePrepMinutes == null ? '-' : s.averagePrepMinutes + ' min')}</div>`;
    h += sect('Average time per station', table([['Station', (r) => E(r.station)], ['Tickets', (r) => num(r.tickets)], ['Average', (r) => mn(r.averageMinutes)]], s.byStation));
    h += sect('Tickets (late first)', table([['Ticket', (r) => `<b>${E(r.ticketNumber)}</b><br><span class="mg-sub">Order ${E(r.orderNumber || '')}</span>`], ['Station', (r) => E(r.station)], ['Table / waiter', (r) => E([r.table, r.waiter].filter(Boolean).join(' · ') || '-')], ['Items', (r) => E(r.items.join(', '))], ['Received', (r) => t(r.receivedAt)], ['Time', (r) => `${mn(r.minutes)} <span class="mg-sub">/ ${r.limitMinutes}</span>`], ['State', (r) => P(r.status) + (r.delayed ? ' ' + pill('LATE', 'bad') : r.wasLate ? ' ' + pill('was late', 'warn') : '') + (r.readyWaitMinutes >= 10 ? ' ' + pill('waiting ' + r.readyWaitMinutes + 'm', 'warn') : '')]], k.rows, 'No tickets.'));
    return h;
  }
  function reservations() {
    const r = data.reservations; if (sec(r)) return sect('Reservations', '', sec(r)); const s = r.summary;
    return `<div class="mg-grid">${kpi('Bookings', num(s.total), num(s.covers) + ' guests')}${kpi('Upcoming', num(s.upcoming))}${kpi('Arrived / seated', num(s.arrived))}${kpi('Late', num(s.late))}${kpi('Food to start', num(s.needFoodPrep))}${kpi('No-shows', num(s.noShow))}</div>` +
      table([['Time', (x) => `<b>${t(x.startsAt)}</b>`], ['Guest', (x) => `${E(x.guest)}<br><span class="mg-sub">${E(x.phone)} · ${x.partySize} guests</span>`], ['Status', (x) => P(x.status) + (x.late ? ' ' + pill('late ' + x.lateMinutes + 'm', 'bad') : '')], ['Food', (x) => `${E(x.foodLabel)}${x.preOrder.length ? `<br><span class="mg-sub">${E(x.preOrder.join(', '))}</span>` : ''}${x.needsFoodPrep ? '<br>' + pill('start prep', 'warn') : ''}`], ['Order', (x) => E(x.orderNumber || '-')], ['Deposit', (x) => (x.deposit ? `${m(x.deposit.amount)} ${x.deposit.paid ? pill('paid', 'ok') : pill('unpaid', 'bad')}` : '-')], ['Source', (x) => E(nice(x.source))]], r.rows, 'No reservations for this day.');
  }
  function staff() {
    const s = data.shifts;
    return sect('Staff shifts', table([['Staff', (x) => `<b>${E(x.name)}</b><br><span class="mg-sub">${E(nice(x.role))}</span>`], ['Status', (x) => P(x.status) + (x.notClockedIn ? ' ' + pill('not clocked in', 'bad') : '')], ['Scheduled', (x) => `${t(x.scheduledStart)} - ${t(x.scheduledEnd)}`], ['Clock in / out', (x) => `${t(x.clockIn)} - ${t(x.clockOut)}`], ['Hours', (x) => (x.hoursOnDuty == null ? '-' : x.hoursOnDuty + ' h')], ['Orders handled', (x) => num(x.ordersHandled)], ['Tips', (x) => m(x.tips)]], s.staff, 'No shifts recorded for this day.')) +
      sect('Cashier shifts', cashTable(s.cash));
  }
  function cashTable(rows) {
    return table([['Cashier', (x) => `<b>${E(x.cashier)}</b>`], ['Status', (x) => P(x.status)], ['Opened / closed', (x) => `${t(x.openedAt)} - ${t(x.closedAt)}`], ['Opening', (x) => m(x.openingCash)], ['Cash sales', (x) => m(x.cashSales)], ['Refunds', (x) => m(x.refunds)], ['Expected', (x) => `<b>${m(x.expectedCash)}</b>`], ['Counted', (x) => m(x.actualCash)], ['Difference', (x) => (x.difference == null ? '-' : x.difference < 0 ? pill('short ' + m(Math.abs(x.difference)), 'bad') : x.difference > 0 ? pill('over ' + m(x.difference), 'warn') : pill('balanced', 'ok'))]], rows, 'No cash shifts.');
  }
  function payments() {
    const p = data.payments; if (sec(p)) return sect('Payments', '', sec(p)); const T = p.totals;
    let h = `<div class="mg-grid">${kpi('Collected', m(T.collected))}${kpi('Refunds', m(T.refunds))}${kpi('Unverified mobile money', num(p.unverified.count), m(p.unverified.amount))}${kpi('Charged to rooms', m(T.toRoom))}${kpi('On credit', m(T.onCredit))}${kpi('Deposits applied', m(T.depositsApplied))}</div>`;
    h += sect('By method', table([['Method', (r) => E(nice(r[0]))], ['Payments', (r) => num(r[1].count)], ['Amount', (r) => m(r[1].amount)]], Object.entries(T.byMethod).filter(([, v]) => v.count)));
    h += sect('Who received the money', table([['Staff', (r) => E(r.name)], ['Payments', (r) => num(r.count)], ['Total', (r) => m(r.amount)], ['Cash', (r) => m(r.cash)]], p.byReceiver));
    h += sect('Every payment', table([['Time', (r) => t(r.at)], ['Bill / order', (r) => `${E(r.bill)}<br><span class="mg-sub">${E(r.order || '')}${r.table ? ' · T' + E(r.table) : ''}</span>`], ['Method', (r) => E(nice(r.method)) + (r.kind === 'REFUND' ? ' ' + pill('refund', 'bad') : '')], ['Amount', (r) => `<b>${m(r.amount)}</b>`], ['Reference', (r) => E(r.reference || '-')], ['Received by', (r) => E(r.receivedBy || '-')], ['Approved by', (r) => E(r.approvedBy || '-')], ['Check', (r) => (r.verifyStatus ? P(r.verifyStatus) : '-')]], p.rows, 'No payments.'));
    return h;
  }
  function delivery() {
    const d = data.delivery; if (sec(d)) return sect('Delivery', '', sec(d)); const s = d.summary;
    let h = `<div class="mg-grid">${kpi('Orders', num(s.total), `${num(s.online)} online · ${num(s.byStaff)} by staff`)}${kpi('On the way', num(s.active))}${kpi('Delivered', num(s.delivered))}${kpi('Late', num(s.late))}${kpi('Not paid', num(s.unpaid), m(s.unpaidAmount))}${kpi('Cash with riders', m(s.cashWithRiders))}${kpi('Avg kitchen time', s.averagePrepMinutes == null ? '-' : s.averagePrepMinutes + ' min')}${kpi('Avg on road', s.averageOnRoadMinutes == null ? '-' : s.averageOnRoadMinutes + ' min')}${kpi('Avg door to door', s.averageTotalMinutes == null ? '-' : s.averageTotalMinutes + ' min')}</div>`;
    h += sect('Riders', table([['Rider', (r) => E(r.name)], ['Orders', (r) => num(r.orders)], ['Delivered', (r) => num(r.delivered)], ['Active', (r) => num(r.active)], ['Avg on road', (r) => mn(r.averageOnRoadMinutes)], ['Cash held', (r) => m(r.cashHeld)]], d.riders));
    h += sect('All delivery and online orders', table([['Order', (r) => `<b>${E(r.orderNumber)}</b><br><span class="mg-sub">${t(r.placedAt)}</span>`], ['Source', (r) => (r.online ? pill('Online', 'ok') : pill('Staff'))], ['Customer', (r) => `${E(r.customer || '-')}<br><span class="mg-sub">${E(r.phone || '')} ${E(r.address || '')}</span>`], ['Rider', (r) => E(r.rider || '-')], ['Status', (r) => P(r.cancelled ? 'CANCELLED' : r.status) + (r.late ? ' ' + pill('late', 'bad') : '')], ['Kitchen', (r) => mn(r.prepMinutes)], ['Waited for rider', (r) => mn(r.waitForRiderMinutes)], ['On road', (r) => mn(r.onRoadMinutes)], ['Total', (r) => mn(r.totalMinutes)], ['Payment', (r) => P(r.pay) + `<br><span class="mg-sub">${E(nice(r.payMethod))} · ${m(r.total)}</span>`]], d.rows, 'No delivery orders.'));
    return h;
  }
  function qr() {
    const d = data.qr; if (sec(d)) return sect('Guest QR orders', '', sec(d)); const s = d.summary;
    return `<div class="mg-grid">${kpi('Requests', num(s.requests), `${num(s.table)} table · ${num(s.room)} room`)}${kpi('Waiting', num(s.pending))}${kpi('Accepted', num(s.accepted))}${kpi('Rejected / expired', num(s.rejected + s.expired))}${kpi('Avg response', s.averageResponseMinutes == null ? '-' : s.averageResponseMinutes + ' min')}${kpi('QR sales', m(s.revenue))}</div>` +
      table([['Time', (r) => t(r.at)], ['Place', (r) => `<b>${E(r.place)}</b><br><span class="mg-sub">${E(r.guest || '')}</span>`], ['Items', (r) => E(r.items.join(', '))], ['Estimate', (r) => m(r.estimated)], ['Request', (r) => P(r.status) + `<br><span class="mg-sub">${E(r.decidedBy || '')} ${r.respondedInMinutes != null ? r.respondedInMinutes + ' min' : ''}</span>`], ['Order', (r) => E(r.orderNumber || '-') + (r.waiter ? `<br><span class="mg-sub">${E(r.waiter)}</span>` : '')], ['Kitchen', (r) => (r.kitchenState ? P(r.kitchenState) : '-')], ['Payment', (r) => (r.paymentState ? P(r.paymentState) : '-')]], d.rows, 'No guest QR orders today.');
  }
  function menu() {
    const d = data.menu; if (sec(d)) return sect('Menu', '', sec(d)); const s = d.summary;
    return `<div class="mg-grid">${kpi('Menu items', num(s.total))}${kpi('On sale now', num(s.available))}${kpi('Sold out', num(s.soldOut))}${kpi('Outside serving time', num(s.outOfPeriod))}${kpi('Promotions on', num(s.promos))}${kpi('Not sold today', num(s.neverSold))}</div>` +
      table([['Dish', (r) => `<b>${E(r.name)}</b>${r.promo ? ' ' + pill('promo', 'ok') : ''}`], ['Now', (r) => P(r.state) + (r.soldOutReason ? `<br><span class="mg-sub">${E(r.soldOutReason)}</span>` : '')], ['Price', (r) => m(r.price)], ['Sold today', (r) => num(r.soldToday)], ['Prep', (r) => mn(r.prepMinutes)], ['Station', (r) => E(r.station || '')], ['Served', (r) => E(r.periods.join(' · ') || 'All day')]], d.rows, 'No menu items.');
  }
  function stock() {
    const d = data.stock; if (sec(d)) return sect('Stock', '', sec(d) + ' (ingredient tracking may be switched off)'); const s = d.summary;
    return `<div class="mg-grid">${kpi('Out of stock', num(s.out))}${kpi('Low', num(s.low))}${kpi('Below zero', num(s.negative))}${kpi('Expired', num(s.expired), m(s.expiredValue))}${kpi('Expiring soon', num(s.critical + s.warning))}${kpi('Stock value', m(s.stockValue))}</div>` +
      sect('Expiry', table([['Ingredient', (r) => `<b>${E(r.name)}</b><br><span class="mg-sub">Batch ${E(r.batch)} · ${E(nice(r.location))}</span>`], ['Expires', (r) => dt(r.expiryDate)], ['Days left', (r) => P(r.bucket) + ' ' + r.daysLeft], ['Quantity', (r) => E(r.quantityText)], ['Value', (r) => m(r.value)]], d.expiry, 'Nothing expiring soon.')) +
      sect('Ingredients needing attention', table([['Ingredient', (r) => `<b>${E(r.name)}</b>`], ['In stock', (r) => E(r.quantityText)], ['State', (r) => P(r.state)], ['Alert level', (r) => num(r.low)], ['Value', (r) => m(r.value)]], d.ingredients, 'No ingredients.'));
  }
  function money() {
    const tp = data.tips; const c = data.cashBox;
    let h = `<div class="mg-grid">${kpi('Tips today', m(tp.total), num(tp.count) + ' tips')}${kpi('Tips not yet paid out', m(tp.unpaidTotal))}${c && c.totals ? kpi('Cash in open drawers', m(c.totals.cashInDrawers)) + kpi('Short', m(c.totals.short)) + kpi('Over', m(c.totals.over)) + kpi('Unpaid cashier shortages', m(c.totals.shortagesOutstanding), num(c.totals.shortagesOutstandingCount) + ' open') : ''}</div>`;
    h += sect('Tips by waiter', table([['Waiter', (r) => E(r.name)], ['Tips', (r) => num(r.count)], ['Amount', (r) => m(r.amount)]], tp.byWaiter, 'No tips.'));
    h += sect('Cashier cash box', cashTable(c && c.rows ? c.rows : []), sec(c));
    return h;
  }
  function loss() {
    const l = data.loss; if (sec(l)) return sect('Losses', '', sec(l));
    return `<div class="mg-grid">${kpi('Total losses', m(l.total))}</div>` + table([['Where the money was lost', (r) => E(r.kind)], ['Count', (r) => num(r.count)], ['Amount', (r) => `<b>${m(r.amount)}</b>`]], l.lines, 'No losses recorded for this day.');
  }
})();