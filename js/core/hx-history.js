/**
 * hx-history.js - history + search screens shared by the restaurant pages (loaded on demand by HX.loadHistory()).
 *
 *   HX.history.open('deliveries' | 'orders' | 'qr' | 'kiosk' | 'guest')   full-width window with filters, KPIs, results, details and CSV export
 *   HX.history.mount(el, 'orders', { external: () => ({ from, to, branchId }) })   same thing inline (used by Reports > All orders)
 *
 * API (read-only): GET /restaurant/history/orders | /history/deliveries | /history/guest | /reports/orders, GET /restaurant/orders/:id for details.
 * Filters are kept per view while the page stays open. Nothing here changes an order.
 */
(function (window) {
  const HX = window.HX; if (!HX || HX.history) return;
  const { E, M, get, can } = HX;

  /* ---------------------------------------------------------------- labels */
  const TYPE = { DINE_IN: 'Dine-in', TAKEAWAY: 'Takeaway', DELIVERY: 'Delivery', COUNTER: 'Counter', BAR_TAB: 'Bar tab', ROOM_SERVICE: 'Room service', PICKUP: 'Pickup' };
  const SOURCE = { WAITER: 'Waiter', POS: 'POS', PHONE: 'Phone', ONLINE: 'Online', KIOSK: 'Kiosk', QR_TABLE: 'QR · table', QR_ROOM: 'QR · room', FRONT_DESK: 'Front desk' };
  const BILL = { NONE: 'No bill', REQUESTED: 'Bill requested', ISSUED: 'Unpaid', PARTIAL: 'Part paid', PAID: 'Paid', WRITTEN_OFF: 'Written off' };
  const REQ = { PENDING: 'Waiting', ACCEPTED: 'Accepted', AUTO_ACCEPTED: 'Auto-accepted', REJECTED: 'Declined', EXPIRED: 'Expired', CANCELLED: 'Cancelled', FAILED: 'Failed' };
  const CALLS = { WAITER: 'Call waiter', BILL: 'Wants the bill', ASSISTANCE: 'Assistance', CLEANING: 'Cleaning', HOUSEKEEPING: 'Housekeeping', MAINTENANCE: 'Maintenance', RECEPTION: 'Reception', CHECKOUT: 'Checkout', OTHER: 'Other' };
  const CALL_ST = { OPEN: 'Open', ACKNOWLEDGED: 'On the way', RESOLVED: 'Done', CANCELLED: 'Cancelled' };
  const nice = (s) => String(s || '').replace(/_/g, ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase());
  const lab = (map, k) => map[k] || nice(k);
  const PAYM = (m) => (HX.payLabel ? HX.payLabel(m) : nice(m));
  const dt = (t) => (t ? new Date(t).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-');
  const dshort = (t) => (t ? new Date(t).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '-');
  const minsBetween = (a, b) => (a && b ? Math.max(0, Math.round((new Date(b) - new Date(a)) / 60000)) : null);
  const dur = (m) => (m == null ? '-' : m < 60 ? m + ' min' : Math.floor(m / 60) + ' h ' + (m % 60) + ' min');
  const n0 = (v) => Number(v || 0).toLocaleString('en-KE');

  /** The status a person cares about for one order. */
  function orderState(o) {
    const d = o.delivery || {};
    if (o.status === 'CANCELLED') return ['Cancelled', 'bad'];
    if (o.orderType === 'DELIVERY' && d.status) return [{ PENDING: 'Awaiting rider', ASSIGNED: 'Rider assigned', OUT_FOR_DELIVERY: 'Out for delivery', DELIVERED: 'Delivered', FAILED: 'Failed' }[d.status] || nice(d.status), { PENDING: 'warn', ASSIGNED: 'plan', OUT_FOR_DELIVERY: 'busy', DELIVERED: 'ok', FAILED: 'bad' }[d.status] || 'mute'];
    if (o.pickup && o.pickup.status === 'COLLECTED') return ['Collected', 'ok'];
    if (o.status === 'CLOSED') return ['Completed', 'ok'];
    return ['Open', 'warn'];
  }
  const payTone = (b) => ({ PAID: 'ok', PARTIAL: 'warn', ISSUED: 'warn', REQUESTED: 'warn', WRITTEN_OFF: 'mute', NONE: 'mute' }[b] || 'mute');
  const where = (o) => (o.roomNumber ? 'Room ' + o.roomNumber : o.tableName ? 'Table ' + o.tableName : o.orderType === 'DELIVERY' ? ((o.delivery && o.delivery.address) || 'Delivery') : lab(TYPE, o.orderType));
  const who = (o) => (o.delivery && o.delivery.contactName) || o.customerName || '';
  const phone = (o) => (o.delivery && o.delivery.phone) || o.customerPhone || '';

  /* ---------------------------------------------------------------- styles (injected once) */
  function css() {
    if (document.getElementById('hxh-css')) return;
    const s = document.createElement('style'); s.id = 'hxh-css';
    s.textContent = `
.hxh{display:flex;flex-direction:column;gap:var(--space-3);min-width:0}
.hxh-bar{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.hxh-bar .input{flex:1 1 220px;min-width:0}
.hxh-chips{display:flex;gap:6px;flex-wrap:wrap}
.hxh-chips .hx-chip{padding:6px 12px;min-height:34px;font-size:var(--text-sm)}
.hxh-filters{display:none;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:10px;padding:12px;border:1px solid var(--color-border);border-radius:12px;background:var(--color-surface)}
.hxh-filters.open{display:grid}
.hxh-filters label{display:flex;flex-direction:column;gap:4px;font-size:var(--text-xs);color:var(--color-text-secondary);font-weight:600}
.hxh-filters .input,.hxh-filters .select{width:100%;min-height:40px}
.hxh-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px}
.hxh-kpi{border:1px solid var(--color-border);border-radius:12px;padding:10px 12px;background:var(--color-surface)}
.hxh-kpi small{display:block;color:var(--color-text-secondary);font-size:var(--text-xs)}
.hxh-kpi b{font-size:1.15rem;font-variant-numeric:tabular-nums}
.hxh-wrap{border:1px solid var(--color-border);border-radius:12px;background:var(--color-surface);overflow:auto}
.hxh table{width:100%;border-collapse:collapse;font-size:var(--text-sm)}
.hxh th{position:sticky;top:0;background:var(--color-bg);text-align:left;font-size:var(--text-xs);text-transform:uppercase;letter-spacing:.03em;color:var(--color-text-secondary);padding:9px 12px;white-space:nowrap;border-bottom:1px solid var(--color-border)}
.hxh td{padding:10px 12px;border-bottom:1px solid var(--color-border);vertical-align:top}
.hxh tbody tr{cursor:pointer}.hxh tbody tr:hover{background:var(--color-bg)}
.hxh td.num,.hxh th.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.hxh td small{display:block;color:var(--color-text-secondary)}
.hxh-pager{display:flex;gap:8px;align-items:center;justify-content:space-between;flex-wrap:wrap}
.hxh-pager .select{width:auto;min-height:36px}
.hxh-riders{display:flex;gap:8px;overflow-x:auto;padding-bottom:2px}
.hxh-riders div{flex:none;border:1px solid var(--color-border);border-radius:10px;padding:8px 12px;background:var(--color-surface);font-size:var(--text-sm)}
.hxh-det h4{margin:14px 0 6px;font-size:var(--text-sm);text-transform:uppercase;letter-spacing:.03em;color:var(--color-text-secondary)}
.hxh-det .kv{display:grid;grid-template-columns:130px 1fr;gap:4px 10px;font-size:var(--text-sm)}.hxh-det .kv span:nth-child(odd){color:var(--color-text-secondary)}
.hxh-det .ln{display:flex;justify-content:space-between;gap:10px;padding:5px 0;border-bottom:1px dashed var(--color-border);font-size:var(--text-sm)}
.hxh-det .tot{display:flex;justify-content:space-between;font-weight:700;padding-top:8px}
.hxh-win .modal-body{padding-top:var(--space-3)}
@media (max-width:720px){
  .hxh table,.hxh thead,.hxh tbody,.hxh tr,.hxh td{display:block;width:100%}.hxh thead{display:none}
  .hxh tbody tr{border-bottom:8px solid var(--color-bg);padding:8px 4px}
  .hxh td{border:0;padding:4px 10px 4px 104px;position:relative;text-align:left;min-height:24px}
  .hxh td::before{content:attr(data-l);position:absolute;left:10px;top:6px;width:88px;color:var(--color-text-secondary);font-size:var(--text-xs)}
  .hxh td.num{text-align:left}
  .hxh-det .kv{grid-template-columns:100px 1fr}
  .hxh-win{max-width:100vw!important;width:100vw!important;height:100dvh!important;max-height:100dvh!important;border-radius:0!important;margin:0!important}
}`;
    document.head.appendChild(s);
  }

  /* ---------------------------------------------------------------- date presets */
  const sod = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
  const eod = (d) => { const x = new Date(d); x.setHours(23, 59, 59, 999); return x; };
  const PRESETS = [['today', 'Today'], ['yesterday', 'Yesterday'], ['7d', '7 days'], ['30d', '30 days'], ['month', 'This month'], ['all', 'All time'], ['custom', 'Custom']];
  function range(st) {
    const now = new Date(); let a = null, b = null;
    switch (st.preset) {
      case 'today': a = sod(now); b = eod(now); break;
      case 'yesterday': { const y = new Date(now); y.setDate(y.getDate() - 1); a = sod(y); b = eod(y); break; }
      case '7d': { const y = new Date(now); y.setDate(y.getDate() - 6); a = sod(y); b = eod(now); break; }
      case '30d': { const y = new Date(now); y.setDate(y.getDate() - 29); a = sod(y); b = eod(now); break; }
      case 'month': a = sod(new Date(now.getFullYear(), now.getMonth(), 1)); b = eod(now); break;
      case 'custom': a = st.from ? sod(st.from + 'T12:00:00') : null; b = st.to ? eod(st.to + 'T12:00:00') : null; break;
      default: break;
    }
    return { from: a ? a.toISOString() : undefined, to: b ? b.toISOString() : undefined };
  }

  /* ---------------------------------------------------------------- view definitions */
  const OPT = {
    type: [['', 'All types'], ...['DINE_IN', 'TAKEAWAY', 'DELIVERY', 'PICKUP', 'COUNTER', 'BAR_TAB', 'ROOM_SERVICE'].map((k) => [k, TYPE[k]])],
    source: [['', 'All sources'], ...Object.keys(SOURCE).map((k) => [k, SOURCE[k]])],
    status: [['', 'Any status'], ['OPEN', 'Open'], ['CLOSED', 'Completed'], ['CANCELLED', 'Cancelled']],
    bill: [['', 'Any payment'], ['PAID', 'Paid'], ['PARTIAL', 'Part paid'], ['ISSUED,REQUESTED', 'Unpaid (billed)'], ['NONE', 'No bill yet'], ['WRITTEN_OFF', 'Written off']],
    method: [['', 'Any method'], ...['CASH', 'MPESA', 'MOBILE_MONEY', 'CARD', 'BANK', 'CREDIT', 'ROOM', 'OTHER'].map((k) => [k, PAYM(k)])],
    sort: [['newest', 'Newest first'], ['oldest', 'Oldest first'], ['highest', 'Highest total'], ['lowest', 'Lowest total'], ['number', 'Order number']],
  };

  const VIEWS = {
    orders: {
      title: 'All orders', path: '/restaurant/history/orders', reportPath: '/restaurant/reports/orders', preset: '30d', placeholder: 'Search order no., table, room, customer, phone, waiter, item, bill no…',
      filters: ['type', 'source', 'status', 'bill', 'method', 'waiter', 'rider', 'min', 'max', 'sort'], empty: ['No orders found', 'Try a wider date range or clear some filters.'],
    },
    deliveries: {
      title: 'Delivery & pickup history', path: '/restaurant/history/deliveries', preset: '30d', placeholder: 'Search order no., customer, phone, address, rider, bill no…',
      tabs: [['all', 'All'], ['delivery', 'Deliveries'], ['pickup', 'Pickups']], filters: ['outcome', 'method', 'rider', 'bill', 'min', 'max', 'sort'], empty: ['No past deliveries or pickups', 'Completed runs show here. Try “All outcomes” or a wider date range.'],
    },
    qr: {
      title: 'QR code orders', path: '/restaurant/history/orders', preset: '30d', fixed: { scope: 'qr' }, placeholder: 'Search order no., table, room, guest, item…',
      filters: ['source', 'status', 'bill', 'method', 'waiter', 'min', 'max', 'sort'], empty: ['No QR orders yet', 'Orders guests place after scanning a table or room code show here.'],
    },
    kiosk: {
      title: 'Kiosk orders', path: '/restaurant/history/orders', preset: '7d', fixed: { scope: 'kiosk' }, placeholder: 'Search order no., collect no., table, item…',
      filters: ['status', 'bill', 'method', 'min', 'max', 'sort'], empty: ['No kiosk orders', 'Self-service kiosk orders show here.'],
    },
    guest: {
      title: 'Guest request history', path: '/restaurant/history/guest', preset: '7d', placeholder: 'Search table, room, guest, phone, item, note, order no…',
      tabs: [['requests', 'Orders from guests'], ['calls', 'Calls & requests']], empty: ['Nothing found', 'Try a wider date range or clear some filters.'],
    },
  };

  /* ---------------------------------------------------------------- the component */
  const STATE = {};          // remembered per view while the page is open
  function mountView(host, viewKey, opts = {}) {
    css();
    const V = VIEWS[viewKey]; if (!V) return null;
    const S = STATE[viewKey] || (STATE[viewKey] = { preset: V.preset, from: '', to: '', q: '', f: {}, tab: V.tabs ? V.tabs[0][0] : '', page: 1, limit: 25, open: false });
    if (opts.defaultTab && !STATE[viewKey]._tabSet) { S.tab = opts.defaultTab; STATE[viewKey]._tabSet = true; }
    const ext = typeof opts.external === 'function' ? opts.external : null;
    let fac = { waiters: [], riders: [] }, last = null, token = 0, alive = true;
    const isGuest = viewKey === 'guest', isDel = viewKey === 'deliveries';

    host.innerHTML = `<div class="hxh">
      ${V.tabs ? `<div class="hxh-chips" id="h-tabs"></div>` : ''}
      <div class="hxh-bar"><input class="input" id="h-q" type="search" placeholder="${E(V.placeholder)}" aria-label="Search" value="${E(S.q)}"><button class="btn btn-secondary" id="h-ft" type="button">Filters<span id="h-fc"></span></button><button class="btn btn-secondary" id="h-ex" type="button">Export CSV</button></div>
      ${ext ? '' : '<div class="hxh-chips" id="h-dates"></div><div class="hxh-bar" id="h-cust" style="display:none"><label class="hx-sub">From <input class="input" type="date" id="h-from" style="flex:none;width:auto"></label><label class="hx-sub">To <input class="input" type="date" id="h-to" style="flex:none;width:auto"></label></div>'}
      <div class="hxh-filters" id="h-fp"></div>
      <div id="h-kp"></div><div id="h-res"></div></div>`;
    const $ = (s) => host.querySelector(s);

    const sel = (id, label, opts2, val) => `<label>${E(label)}<select class="select" id="${id}">${opts2.map(([k, l]) => `<option value="${E(k)}" ${String(val || '') === String(k) ? 'selected' : ''}>${E(l)}</option>`).join('')}</select></label>`;
    function paintFilters() {
      const fl = isGuest ? (S.tab === 'calls' ? ['callKind', 'callStatus', 'sort'] : ['guestKind', 'reqStatus', 'sort']) : V.filters;
      const m = {
        type: () => sel('f-type', 'Order type', OPT.type, S.f.type), source: () => sel('f-source', 'Source', V.fixed && V.fixed.scope === 'qr' ? [['', 'Table & room QR'], ['QR_TABLE', 'QR · table'], ['QR_ROOM', 'QR · room']] : OPT.source, S.f.source),
        status: () => sel('f-status', 'Order status', OPT.status, S.f.status), bill: () => sel('f-bill', 'Payment', OPT.bill, S.f.bill), method: () => sel('f-method', 'Paid with', OPT.method, S.f.method),
        waiter: () => sel('f-waiter', 'Waiter', [['', 'Any waiter'], ...fac.waiters.map((w) => [w.id, `${w.name} (${w.orders})`])], S.f.waiter),
        rider: () => sel('f-rider', 'Rider', [['', 'Any rider'], ...fac.riders.map((w) => [w.id, `${w.name} (${w.orders})`])], S.f.rider),
        outcome: () => sel('f-outcome', 'Outcome', [['DONE', 'Delivered / collected'], ['FAILED', 'Failed deliveries'], ['CANCELLED', 'Cancelled'], ['ALL', 'All outcomes']], S.f.outcome || 'DONE'),
        min: () => `<label>Min total<input class="input" id="f-min" type="number" min="0" step="any" inputmode="decimal" value="${E(S.f.min || '')}"></label>`,
        max: () => `<label>Max total<input class="input" id="f-max" type="number" min="0" step="any" inputmode="decimal" value="${E(S.f.max || '')}"></label>`,
        sort: () => sel('f-sort', 'Sort by', isGuest ? [['newest', 'Newest first'], ['oldest', 'Oldest first']] : OPT.sort, S.f.sort || (isGuest ? 'newest' : 'newest')),
        guestKind: () => sel('f-gk', 'Where', [['', 'Tables & rooms'], ['TABLE', 'Tables'], ['ROOM', 'Rooms']], S.f.gk),
        reqStatus: () => sel('f-rs', 'Result', [['', 'Any'], ['ACCEPTED,AUTO_ACCEPTED', 'Accepted'], ['REJECTED', 'Declined'], ['EXPIRED', 'Expired'], ['CANCELLED,FAILED', 'Cancelled / failed'], ['PENDING', 'Still waiting']], S.f.rs),
        callKind: () => sel('f-ck', 'Type', [['', 'All types'], ...Object.keys(CALLS).map((k) => [k, CALLS[k]])], S.f.ck),
        callStatus: () => sel('f-cs', 'Status', [['', 'Any'], ['RESOLVED', 'Done'], ['OPEN', 'Open'], ['ACKNOWLEDGED', 'On the way'], ['CANCELLED', 'Cancelled']], S.f.cs),
      };
      $('#h-fp').innerHTML = fl.map((k) => m[k]()).join('') + '<label style="justify-content:flex-end"><button class="btn btn-secondary" id="h-clear" type="button">Clear filters</button></label>';
      $('#h-fp').classList.toggle('open', !!S.open);
      $('#h-fp').querySelectorAll('select,input').forEach((c) => c.addEventListener('change', () => { readFilters(); S.page = 1; run(); }));
      $('#h-clear').onclick = () => { S.f = {}; S.q = ''; $('#h-q').value = ''; S.page = 1; paintFilters(); run(); };
      badge();
    }
    function readFilters() {
      const g = (id) => { const e = $('#' + id); return e ? e.value : undefined; };
      S.f = { type: g('f-type'), source: g('f-source'), status: g('f-status'), bill: g('f-bill'), method: g('f-method'), waiter: g('f-waiter'), rider: g('f-rider'), outcome: g('f-outcome'), min: g('f-min'), max: g('f-max'), sort: g('f-sort'), gk: g('f-gk'), rs: g('f-rs'), ck: g('f-ck'), cs: g('f-cs') };
      badge();
    }
    function badge() {
      const n = Object.entries(S.f).filter(([k, v]) => v && !(k === 'sort' && (v === 'newest')) && !(k === 'outcome' && v === 'DONE')).length;
      const b = $('#h-fc'); if (b) b.textContent = n ? ` (${n})` : '';
    }
    function paintTabs() {
      const t = $('#h-tabs'); if (!t) return;
      t.innerHTML = V.tabs.map(([k, l]) => `<button class="hx-chip ${k === S.tab ? 'on' : ''}" data-tab="${k}" type="button">${E(l)}</button>`).join('');
      t.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => { S.tab = b.dataset.tab; S.page = 1; S.f = {}; paintTabs(); paintFilters(); run(); }));
    }
    function paintDates() {
      const d = $('#h-dates'); if (!d) return;
      d.innerHTML = PRESETS.map(([k, l]) => `<button class="hx-chip ${k === S.preset ? 'on' : ''}" data-p="${k}" type="button">${l}</button>`).join('');
      $('#h-cust').style.display = S.preset === 'custom' ? 'flex' : 'none'; $('#h-from').value = S.from; $('#h-to').value = S.to;
      d.querySelectorAll('[data-p]').forEach((b) => b.addEventListener('click', () => { S.preset = b.dataset.p; S.page = 1; paintDates(); if (S.preset !== 'custom' || S.from || S.to) run(); }));
    }

    function query(page, limit) {
      const r = ext ? ext() : { ...range(S), branchId: HX.branchId() };
      const q = { branchId: r.branchId || undefined, from: r.from || undefined, to: r.to || undefined, search: S.q || undefined, page, limit };
      const f = S.f;
      if (isGuest) { Object.assign(q, { type: S.tab, kind: S.tab === 'calls' ? f.ck : f.gk, status: S.tab === 'calls' ? f.cs : f.rs, sort: f.sort || 'newest' }); return q; }
      Object.assign(q, { orderType: f.type, source: f.source, status: f.status, billStatus: f.bill, paymentMethod: f.method, waiterId: f.waiter, riderId: f.rider, minTotal: f.min, maxTotal: f.max, sort: f.sort || 'newest', ...(V.fixed || {}) });
      if (viewKey === 'qr' && !f.source) q.source = undefined;
      if (isDel) { q.scope = S.tab || 'all'; q.outcome = f.outcome || 'DONE'; q.dateField = 'createdAt'; q.orderType = undefined; q.facets = page === 1 && !fac.riders.length ? '1' : undefined; }
      else q.facets = page === 1 && !fac.waiters.length && !fac.riders.length ? '1' : undefined;
      Object.keys(q).forEach((k) => (q[k] === undefined || q[k] === '') && delete q[k]);
      return q;
    }
    const pathOf = () => (opts.report && V.reportPath ? V.reportPath : V.path);

    async function run() {
      if (!alive || !host.isConnected) return;
      const my = ++token; $('#h-res').innerHTML = HX.skel('rows', 5);
      const d = await get(pathOf(), query(S.page, S.limit));
      if (my !== token || !alive) return;
      if (!d) { $('#h-kp').innerHTML = ''; $('#h-res').innerHTML = HX.empty('Could not load', 'Check your connection and try again.'); return; }
      last = d;
      if (d.facets) { fac = d.facets; paintFilters(); }
      paintKpis(d); paintResults(d);
    }

    /* ---- KPI tiles */
    function paintKpis(d) {
      const s = d.summary; const t = (l, v) => `<div class="hxh-kpi"><small>${E(l)}</small><b>${v}</b></div>`;
      if (!s) return;
      let html = '';
      if (isGuest && S.tab === 'calls') html = t('Calls', n0(s.total)) + t('Done', n0((s.byStatus.find((x) => x.status === 'RESOLVED') || {}).count || 0)) + t('Avg. response', s.avgAckMinutes == null ? '-' : dur(Math.round(s.avgAckMinutes))) + t('Avg. time to finish', s.avgResolveMinutes == null ? '-' : dur(Math.round(s.avgResolveMinutes)));
      else if (isGuest) html = t('Guest orders', n0(s.total)) + t('Accepted', n0(s.acceptedCount)) + t('Accepted value', M(s.acceptedValue)) + t('Declined / expired', n0(s.byStatus.filter((x) => ['REJECTED', 'EXPIRED', 'CANCELLED', 'FAILED'].includes(x.status)).reduce((a, x) => a + x.count, 0)));
      else if (isDel) html = t('Orders', n0(s.orders)) + t('Delivered', n0(s.delivered)) + t('Picked up', n0(s.collected)) + t('Failed', n0(s.failed)) + t('Sales', M(s.sales)) + t('Avg. delivery time', s.avgDeliveryMinutes == null ? '-' : dur(Math.round(s.avgDeliveryMinutes)));
      else html = t('Orders', n0(s.orders)) + t('Sales', M(s.sales)) + t('Average order', M(s.average)) + t('Cancelled', n0(s.cancelled)) + (s.guests ? t('Guests', n0(s.guests)) : '');
      const riders = isDel && s.byRider && s.byRider.length > 1 ? `<div class="hxh-riders" style="margin-top:10px">${s.byRider.map((r) => `<div><b>${E(r.name)}</b><br><span class="hx-sub">${r.delivered} delivered${r.failed ? ' · ' + r.failed + ' failed' : ''} · ${M(r.sales)}</span></div>`).join('')}</div>` : '';
      $('#h-kp').innerHTML = `<div class="hxh-kpis">${html}</div>${riders}`;
    }

    /* ---- result tables */
    function pager(d) {
      const pages = d.pages || 1;
      return `<div class="hxh-pager"><span class="hx-sub">${n0(d.total)} result${d.total === 1 ? '' : 's'} · page ${d.page} of ${pages}</span><span class="hxh-bar"><select class="select" id="h-pl" aria-label="Rows per page">${[25, 50, 100, 200].map((n) => `<option value="${n}" ${n === S.limit ? 'selected' : ''}>${n} per page</option>`).join('')}</select><button class="btn btn-secondary" id="h-pv" ${d.page <= 1 ? 'disabled' : ''}>Previous</button><button class="btn btn-secondary" id="h-nx" ${d.page >= pages ? 'disabled' : ''}>Next</button></span></div>`;
    }
    const th = (cols) => `<thead><tr>${cols.map(([l, c]) => `<th class="${c || ''}">${l}</th>`).join('')}</tr></thead>`;
    function orderRow(o) {
      const [st, tone] = orderState(o), pay = o.payment || {};
      const items = (o.items || []).filter((i) => i.status !== 'CANCELLED');
      const names = items.slice(0, 2).map((i) => `${i.quantity}× ${i.name}`).join(', ') + (items.length > 2 ? ` +${items.length - 2} more` : '');
      const d = o.delivery || {};
      const took = o.orderType === 'DELIVERY' && d.deliveredAt ? dur(minsBetween(o.createdAt, d.deliveredAt)) : '';
      return `<tr data-id="${E(o._id)}">
        <td data-l="Order"><b>#${E(o.orderNumber)}</b>${o.pickupNumber ? `<small>Collect ${E(o.pickupNumber)}</small>` : ''}<small>${E(dshort(o.createdAt))}</small></td>
        <td data-l="Type">${E(lab(TYPE, o.orderType))}<small>${E(lab(SOURCE, o.source))}${o.branchName ? ' · ' + E(o.branchName) : ''}</small></td>
        <td data-l="Where / who">${E(where(o))}<small>${E([who(o), phone(o)].filter(Boolean).join(' · '))}</small></td>
        ${isDel ? `<td data-l="Rider">${E(d.riderName || (o.pickup && o.pickup.collectedBy ? 'Collected by ' + o.pickup.collectedBy : '-'))}<small>${took ? 'Took ' + E(took) : o.pickup && o.pickup.collectedAt ? E(dshort(o.pickup.collectedAt)) : ''}</small></td>` : `<td data-l="Staff">${E(o.waiterName || '-')}</td>`}
        <td data-l="Items">${E(names || '-')}<small>${o.itemCount || 0} item${o.itemCount === 1 ? '' : 's'}</small></td>
        <td class="num" data-l="Total"><b>${M(o.totals && o.totals.total)}</b></td>
        <td data-l="Payment">${HX.pill(lab(BILL, o.billStatus), payTone(o.billStatus))}<small>${E((pay.methods || []).map(PAYM).join(', '))}</small></td>
        <td data-l="Status">${HX.pill(st, tone)}${o.status === 'CANCELLED' && o.cancelReason ? `<small>${E(o.cancelReason)}</small>` : d.failReason && d.status === 'FAILED' ? `<small>${E(d.failReason)}</small>` : ''}</td></tr>`;
    }
    function reqRow(r) {
      const tone = { ACCEPTED: 'ok', AUTO_ACCEPTED: 'ok', REJECTED: 'bad', EXPIRED: 'mute', CANCELLED: 'mute', FAILED: 'bad', PENDING: 'warn' }[r.status] || 'mute';
      const items = (r.items || []); const names = items.slice(0, 2).map((i) => `${i.quantity}× ${i.name}`).join(', ') + (items.length > 2 ? ` +${items.length - 2} more` : '');
      return `<tr data-id="${E(r._id)}"><td data-l="When"><b>${E(dshort(r.createdAt))}</b></td><td data-l="Where">${E(r.kind === 'ROOM' ? 'Room ' + (r.roomNumber || '') : 'Table ' + (r.tableName || ''))}<small>${E(r.guest && r.guest.name ? r.guest.name : '')}${r.guest && r.guest.phone ? ' · ' + E(r.guest.phone) : ''}</small></td>
        <td data-l="Items">${E(names || '-')}${items.some((i) => i.allergyNotes) ? '<small style="color:var(--color-danger)">Allergy note</small>' : ''}</td><td class="num" data-l="Value"><b>${M(r.estimatedTotal)}</b></td>
        <td data-l="Order">${r.order ? '#' + E(r.order.orderNumber) + `<small>${E(lab(BILL, r.order.billStatus))}</small>` : '-'}</td>
        <td data-l="Result">${HX.pill(lab(REQ, r.status), tone)}${r.decision && r.decision.byName ? `<small>${E(r.decision.byName)}${r.decision.reason ? ' · ' + E(r.decision.reason) : ''}</small>` : ''}</td></tr>`;
    }
    function callRow(c) {
      const tone = { RESOLVED: 'ok', OPEN: 'warn', ACKNOWLEDGED: 'busy', CANCELLED: 'mute' }[c.status] || 'mute';
      return `<tr><td data-l="When"><b>${E(dshort(c.createdAt))}</b></td><td data-l="Type">${E(lab(CALLS, c.kind))}${c.repeatCount ? `<small>Pressed ${c.repeatCount + 1}×</small>` : ''}</td>
        <td data-l="Where">${E(c.roomNumber ? 'Room ' + c.roomNumber : c.tableName ? 'Table ' + c.tableName : '-')}<small>${E(c.guestName || '')}</small></td><td data-l="Note">${E(c.note || '-')}</td>
        <td data-l="Handled by">${E(c.acknowledgedByName || '-')}<small>${c.acknowledgedAt ? 'Replied in ' + dur(minsBetween(c.createdAt, c.acknowledgedAt)) : ''}</small></td>
        <td data-l="Finished">${c.resolvedAt ? E(dshort(c.resolvedAt)) + `<small>after ${dur(minsBetween(c.createdAt, c.resolvedAt))}</small>` : '-'}</td><td data-l="Status">${HX.pill(lab(CALL_ST, c.status), tone)}</td></tr>`;
    }
    function paintResults(d) {
      const rows = d.items || [];
      if (!rows.length) { $('#h-res').innerHTML = HX.empty(V.empty[0], V.empty[1]); return; }
      let head, body;
      if (isGuest && S.tab === 'calls') { head = th([['When'], ['Type'], ['Where'], ['Note'], ['Handled by'], ['Finished'], ['Status']]); body = rows.map(callRow).join(''); }
      else if (isGuest) { head = th([['When'], ['Where'], ['Items'], ['Value', 'num'], ['Order'], ['Result']]); body = rows.map(reqRow).join(''); }
      else { head = th([['Order'], ['Type'], ['Where / who'], [isDel ? 'Rider / collected' : 'Staff'], ['Items'], ['Total', 'num'], ['Payment'], ['Status']]); body = rows.map(orderRow).join(''); }
      $('#h-res').innerHTML = `<div class="hxh-wrap"><table>${head}<tbody>${body}</tbody></table></div>${pager(d)}`;
      $('#h-res').querySelectorAll('tbody tr[data-id]').forEach((tr) => tr.addEventListener('click', () => (isGuest ? guestDetail(rows.find((x) => String(x._id) === tr.dataset.id)) : orderDetail(tr.dataset.id))));
      $('#h-pv').onclick = () => { S.page = Math.max(1, S.page - 1); run(); host.scrollIntoView && $('#h-res').scrollIntoView({ block: 'nearest' }); };
      $('#h-nx').onclick = () => { S.page += 1; run(); };
      $('#h-pl').onchange = (e) => { S.limit = Number(e.target.value); S.page = 1; run(); };
    }

    /* ---- export (walks every page, up to 5,000 rows) */
    async function exportCsv() {
      const btn = $('#h-ex'); btn.disabled = true; const old = btn.textContent; btn.textContent = 'Preparing…';
      try {
        let rows = [], page = 1, pages = 1;
        do { const d = await get(pathOf(), { ...query(page, 200), facets: undefined, page }); if (!d) throw new Error('fail'); rows = rows.concat(d.items || []); pages = d.pages || 1; page++; } while (page <= pages && page <= 25);
        if (!rows.length) { window.UI.toast.info('Nothing to export'); return; }
        let head, lines;
        if (isGuest && S.tab === 'calls') { head = ['Date', 'Type', 'Where', 'Guest', 'Note', 'Handled by', 'Replied (min)', 'Finished (min)', 'Status']; lines = rows.map((c) => [dt(c.createdAt), lab(CALLS, c.kind), c.roomNumber ? 'Room ' + c.roomNumber : c.tableName ? 'Table ' + c.tableName : '', c.guestName || '', c.note || '', c.acknowledgedByName || '', minsBetween(c.createdAt, c.acknowledgedAt) ?? '', minsBetween(c.createdAt, c.resolvedAt) ?? '', lab(CALL_ST, c.status)]); }
        else if (isGuest) { head = ['Date', 'Where', 'Guest', 'Phone', 'Items', 'Value', 'Order no.', 'Result', 'Decided by', 'Reason']; lines = rows.map((r) => [dt(r.createdAt), r.kind === 'ROOM' ? 'Room ' + (r.roomNumber || '') : 'Table ' + (r.tableName || ''), (r.guest || {}).name || '', (r.guest || {}).phone || '', (r.items || []).map((i) => `${i.quantity}x ${i.name}`).join('; '), r.estimatedTotal, r.order ? r.order.orderNumber : '', lab(REQ, r.status), (r.decision || {}).byName || '', (r.decision || {}).reason || '']); }
        else { head = ['Order no.', 'Date', 'Branch', 'Type', 'Source', 'Table / room / address', 'Customer', 'Phone', 'Staff', 'Rider', 'Items', 'Total', 'Delivery fee', 'Bill no.', 'Payment', 'Paid with', 'Status', 'Note'];
          lines = rows.map((o) => [o.orderNumber, dt(o.createdAt), o.branchName || '', lab(TYPE, o.orderType), lab(SOURCE, o.source), where(o), who(o), phone(o), o.waiterName || '', (o.delivery || {}).riderName || '', (o.items || []).filter((i) => i.status !== 'CANCELLED').map((i) => `${i.quantity}x ${i.name}`).join('; '), (o.totals || {}).total, (o.delivery || {}).fee || '', ((o.payment || {}).bills || []).map((b) => b.billNumber).join('; '), lab(BILL, o.billStatus), ((o.payment || {}).methods || []).map(PAYM).join('; '), orderState(o)[0], o.cancelReason || (o.delivery || {}).failReason || '']); }
        download(`${viewKey}${S.tab ? '-' + S.tab : ''}-${new Date().toISOString().slice(0, 10)}.csv`, [head, ...lines]);
        window.UI.toast.success(`${rows.length} row${rows.length === 1 ? '' : 's'} exported`);
      } catch (e) { window.UI.toast.error('Could not export. Try again.'); } finally { btn.disabled = false; btn.textContent = old; }
    }

    /* ---- wire up */
    paintTabs(); paintDates(); paintFilters();
    let t; $('#h-q').addEventListener('input', (e) => { clearTimeout(t); t = setTimeout(() => { S.q = e.target.value.trim(); S.page = 1; run(); }, 350); });
    $('#h-ft').onclick = () => { S.open = !S.open; $('#h-fp').classList.toggle('open', S.open); };
    $('#h-ex').onclick = exportCsv;
    const df = $('#h-from'), dtt = $('#h-to');
    if (df) { df.onchange = () => { S.from = df.value; S.page = 1; run(); }; dtt.onchange = () => { S.to = dtt.value; S.page = 1; run(); }; }
    const onBranch = () => { fac = { waiters: [], riders: [] }; S.page = 1; run(); };
    if (!ext) window.addEventListener('branchchange', onBranch);
    run();
    return { reload: run, destroy() { alive = false; window.removeEventListener('branchchange', onBranch); }, exportCsv };
  }

  /* ---------------------------------------------------------------- details */
  function download(name, rows) {
    const cell = (v) => { let s = v == null ? '' : v; if (typeof s === 'string' && /^[=+\-@]/.test(s)) s = `'${s}`; s = String(s); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const blob = new Blob(['﻿' + rows.map((r) => r.map(cell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  const kv = (rows) => `<div class="kv">${rows.filter(([, v]) => v != null && v !== '').map(([k, v]) => `<span>${E(k)}</span><span>${v}</span>`).join('')}</div>`;

  async function orderDetail(id) {
    const d = await get('/restaurant/orders/' + id); const o = d && (d.order || d); if (!o || !o._id) return window.UI.toast.error('Could not open this order');
    const bills = (d && d.bills) || []; const [st, tone] = orderState(o); const dl = o.delivery || {}; const items = o.items || [];
    const rows = items.map((i) => `<div class="ln"><span>${i.quantity}× ${E(i.name)}${i.variantName ? ' - ' + E(i.variantName) : ''}${i.notes ? `<br><small class="hx-sub">${E(i.notes)}</small>` : ''}${i.status === 'CANCELLED' ? ' <small class="hx-sub">(cancelled)</small>' : ''}${i.isComplimentary ? ' <small class="hx-sub">(complimentary)</small>' : ''}</span><span>${M((i.unitPrice || 0) * (i.quantity || 0))}</span></div>`).join('');
    const t = o.totals || {};
    const bl = bills.map((b) => `<div class="ln"><span><b>${E(b.billNumber)}</b> ${HX.pill(b.status, b.status === 'PAID' ? 'ok' : b.status === 'VOID' ? 'bad' : 'warn')}${(b.payments || []).map((p) => `<br><small class="hx-sub">${p.kind === 'REFUND' ? 'Refund ' : ''}${E(PAYM(p.method))} ${M(p.amount)} · ${E(dshort(p.at))}${p.reference ? ' · ' + E(p.reference) : ''}</small>`).join('')}</span><span>${M(b.total)}${b.balance ? `<br><small class="hx-sub">Owing ${M(b.balance)}</small>` : ''}</span></div>`).join('');
    const hist = (o.history || []).slice(-30).map((h) => `<div class="ln"><span>${E(nice(String(h.action || '').replace(/\./g, ' ')))}${h.note ? ' · ' + E(h.note) : ''}</span><span class="hx-sub">${E(dshort(h.at))}</span></div>`).join('');
    const body = `<div class="hxh-det" id="hxh-print">
      ${kv([['Status', HX.pill(st, tone)], ['Type', E(lab(TYPE, o.orderType)) + ' · ' + E(lab(SOURCE, o.source))], ['Opened', E(dt(o.createdAt))], ['Closed', o.closedAt ? E(dt(o.closedAt)) : ''], ['Cancelled', o.cancelledAt ? E(dt(o.cancelledAt)) + (o.cancelReason ? ' · ' + E(o.cancelReason) : '') : ''],
        ['Table / room', E(o.tableName ? 'Table ' + o.tableName : o.roomNumber ? 'Room ' + o.roomNumber : '')], ['Guests', o.guestCount ? E(o.guestCount) : ''], ['Staff', E(o.waiterName || '')], ['Customer', E([o.customerName, o.customerPhone].filter(Boolean).join(' · '))], ['Collect no.', E(o.pickupNumber || '')], ['Notes', E(o.notes || '')]])}
      ${o.orderType === 'DELIVERY' ? `<h4>Delivery</h4>${kv([['Contact', E([dl.contactName, dl.phone].filter(Boolean).join(' · '))], ['Address', E([dl.address, dl.landmark].filter(Boolean).join(' · '))], ['Instructions', E(dl.instructions || '')], ['Rider', E([dl.riderName, dl.riderPhone].filter(Boolean).join(' · '))], ['Assigned', dl.assignedAt ? E(dt(dl.assignedAt)) : ''], ['Left kitchen', dl.outForDeliveryAt ? E(dt(dl.outForDeliveryAt)) : ''], ['Delivered', dl.deliveredAt ? E(dt(dl.deliveredAt)) + ' (' + E(dur(minsBetween(o.createdAt, dl.deliveredAt))) + ' after the order)' : ''], ['Failed', dl.failReason ? E(dl.failReason) : ''], ['Fee', dl.fee ? M(dl.fee) : ''], ['Pays', E(dl.payment ? nice(dl.payment) : '')], ['Rating', dl.rating && dl.rating.stars ? '★'.repeat(dl.rating.stars) + (dl.rating.comment ? ' ' + E(dl.rating.comment) : '') : '']])}` : ''}
      ${o.pickup && o.pickup.status ? `<h4>Pickup</h4>${kv([['Status', E(nice(o.pickup.status))], ['Handed over', o.pickup.collectedAt ? E(dt(o.pickup.collectedAt)) : ''], ['Collected by', E(o.pickup.collectedBy || '')]])}` : ''}
      <h4>Items</h4>${rows || '<p class="hx-sub">No items</p>'}
      <div class="ln"><span>Items</span><span>${M(t.itemsTotal)}</span></div>${t.discount ? `<div class="ln"><span>Discount</span><span>-${M(t.discount)}</span></div>` : ''}${t.serviceCharge ? `<div class="ln"><span>Service charge</span><span>${M(t.serviceCharge)}</span></div>` : ''}${t.tax ? `<div class="ln"><span>Tax</span><span>${M(t.tax)}</span></div>` : ''}<div class="tot"><span>Total</span><span>${M(t.total)}</span></div>
      ${bl ? `<h4>Bills &amp; payments</h4>${bl}` : ''}${hist ? `<h4>Timeline</h4>${hist}` : ''}</div>`;
    HX.modal({ title: 'Order #' + o.orderNumber, maxWidth: '640px', body, footer: `<button class="btn btn-secondary" data-x>Close</button><button class="btn btn-secondary" id="hxh-pr">Print</button>${o.status === 'OPEN' && HX.order && can('restaurant.orders.create') ? '<button class="btn btn-primary" id="hxh-op">Open order</button>' : ''}`,
      onMount(root, close) {
        root.querySelector('[data-x]').onclick = close;
        root.querySelector('#hxh-pr').onclick = () => { const w = window.open('', '_blank', 'width=420,height=640'); if (!w) return window.UI.toast.warning('Allow pop-ups to print'); w.document.write(`<body style="font:13px/1.5 system-ui,sans-serif;margin:14px"><h3>Order #${E(o.orderNumber)}</h3>${root.querySelector('#hxh-print').innerHTML}</body>`); w.document.close(); w.focus(); w.print(); };
        const op = root.querySelector('#hxh-op'); if (op) op.onclick = () => { close(); HX.order.open(o._id, {}); };
      } });
  }

  function guestDetail(r) {
    if (!r) return;
    const items = (r.items || []).map((i) => `<div class="ln"><span>${i.quantity}× ${E(i.name)}${i.notes ? `<br><small class="hx-sub">${E(i.notes)}</small>` : ''}${i.allergyNotes ? `<br><small style="color:var(--color-danger)">Allergy: ${E(i.allergyNotes)}</small>` : ''}</span><span>${i.unitPriceEstimate ? M(i.unitPriceEstimate * i.quantity) : ''}</span></div>`).join('');
    const body = `<div class="hxh-det">${kv([['Result', HX.pill(lab(REQ, r.status), { ACCEPTED: 'ok', AUTO_ACCEPTED: 'ok', REJECTED: 'bad', PENDING: 'warn' }[r.status] || 'mute')], ['Where', E(r.kind === 'ROOM' ? 'Room ' + (r.roomNumber || '') : 'Table ' + (r.tableName || ''))], ['Guest', E([(r.guest || {}).name, (r.guest || {}).phone].filter(Boolean).join(' · '))], ['Sent', E(dt(r.createdAt))],
      ['Decided', r.decision && r.decision.at ? E(dt(r.decision.at)) + (r.decision.byName ? ' by ' + E(r.decision.byName) : '') : (r.mode === 'AUTO' ? 'Auto-accepted' : '')], ['Reason', E((r.decision || {}).reason || r.failure || '')], ['Notes', E(r.notes || '')], ['Order', r.order ? '#' + E(r.order.orderNumber) + ' · ' + E(lab(BILL, r.order.billStatus)) : '']])}
      <h4>Items</h4>${items}<div class="tot"><span>Guest saw</span><span>${M(r.estimatedTotal)}</span></div></div>`;
    HX.modal({ title: 'Guest order', maxWidth: '560px', body, footer: `<button class="btn btn-secondary" data-x>Close</button>${r.order ? '<button class="btn btn-primary" id="hxh-go">View order</button>' : ''}`,
      onMount(root, close) { root.querySelector('[data-x]').onclick = close; const g = root.querySelector('#hxh-go'); if (g) g.onclick = () => orderDetail(r.order._id); } });
  }

  /* ---------------------------------------------------------------- public API */
  function open(viewKey, opts = {}) {
    css(); const V = VIEWS[viewKey]; if (!V) return;
    let inst = null;
    HX.modal({ title: opts.title || V.title, maxWidth: '1180px', cls: 'hxh-win', body: '<div id="hxh-host"></div>', footer: '<button class="btn btn-secondary" data-x>Close</button>',
      onMount(root, close) { root.querySelector('[data-x]').onclick = close; inst = mountView(root.querySelector('#hxh-host'), viewKey, opts); const ob = new MutationObserver(() => { if (!root.isConnected) { if (inst) inst.destroy(); ob.disconnect(); } }); ob.observe(document.body, { childList: true, subtree: true }); } });
  }
  HX.history = { open, mount: (el, viewKey, opts) => mountView(el, viewKey, opts), orderDetail };
})(window);
