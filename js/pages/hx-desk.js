/**
 * hx-desk.js - Front desk. Today at a glance for the receptionist: arrivals, departures, in-house guests, problems.
 * API: GET /accommodation/desk. Every guest opens the full booking (hx-stays.html#stay=ID) for check-in, folio and check-out.
 */
(function () {
  const { E, M, can, get, list, head, pill, hm } = window.HX;
  let el, tab = 'arrivals', d = null;
  document.addEventListener('DOMContentLoaded', init);
  async function init() { el = window.HX.mount('Front desk'); if (!el) return; await window.AppShell.whenProfileReady?.(); window.HX.live(() => { if (!document.querySelector('.modal-backdrop')) load(); }, 30000); load(); }

  async function load() {
    d = await get('/accommodation/desk', { branchId: window.HX.branchId() });
    if (!d) { el.innerHTML = head('Front desk') + window.HX.empty('Front desk is not available', 'Turn on accommodation in Service settings, or ask the owner for access.'); return; }
    paint();
  }

  function row(s) {
    const g = s.guest || {}, t = s.totals || {};
    const head = `<div class="grow"><b>${E(g.name)}${s.roomNumber ? ' · Room ' + E(s.roomNumber) : ''}</b><small class="hx-sub">${E(s.roomTypeName || '')} · ${s.adults || 1} adult${(s.adults || 1) > 1 ? 's' : ''}${s.children ? ', ' + s.children + ' child' : ''} · ${E(s.bookingCode)}${tab === 'departures' ? ' · out by ' + hm(s.expectedCheckOut) : tab === 'arrivals' ? ' · from ' + hm(s.expectedCheckIn) : ''}</small></div>${t.balance > 0 ? `<span class="hx-money">${M(t.balance)}</span>` : ''}${pill(s.status === 'RESERVED' ? 'Check in' : s.status === 'CHECKED_IN' && tab === 'departures' ? 'Check out' : s.status, s.status === 'RESERVED' ? 'plan' : 'busy')}`;
    const kv = (k, v) => (v ? `<div><small class="hx-sub">${k}</small><b>${v}</b></div>` : '');
    const body = `<div class="hx-detail">${kv('Phone', E(g.phone))}${kv('Email', E(g.email))}${kv('Arrival', window.HX.dt(s.expectedCheckIn))}${kv('Departure', window.HX.dt(s.expectedCheckOut))}${kv('Total', t.total != null ? M(t.total) : '')}${kv('Paid', t.paid != null ? M(t.paid) : '')}${kv('Balance', t.balance != null ? M(t.balance) : '')}${kv('Requests', E(s.specialRequests))}${kv('Notes', E(s.notes))}</div><div class="hx-actions"><a class="btn btn-primary btn-sm" href="hx-stays.html#stay=${s._id}">${s.status === 'RESERVED' ? 'Check in / open booking' : s.status === 'CHECKED_IN' ? 'Folio & check-out' : 'Open booking'}</a>${(s.status === 'CHECKED_IN' || s.status === 'RESERVED') && can('accommodation.folio.pay') ? `<button class="btn btn-secondary btn-sm" data-pay="${s._id}" data-bal="${t.balance || 0}" data-name="${E(g.name || '')}" data-room="${E(s.roomNumber || '')}" data-phone="${E(g.phone || '')}">Take payment</button>` : ''}</div>`;
    return window.HX.xrow(head, body);
  }

  function paint() {
    const a = d.arrivals || [], l = d.departures || [], h = d.inHouse || [], over = d.overdueCheckouts || [], ns = d.possibleNoShows || [];
    const kpi = (label, v, sub, tone, ic) => window.HX.kpi(label, v, sub, tone, ic);
    const sets = { arrivals: [a, 'Arriving today'], departures: [l, 'Leaving today'], inhouse: [h, 'In house'] };
    const rows = sets[tab][0];
    el.innerHTML = head('Front desk', new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' }), `${can('accommodation.stays.create') ? '<a class="btn btn-primary" href="hx-stays.html#new">New booking</a>' : ''}<span class="hx-live">Live</span>`) +
      `<div class="hx-kpis">${kpi('Occupancy', window.HX.pct(d.occupancyPercent || 0), `${d.occupied || 0} of ${d.rooms || 0} rooms`, 'blue', 'bed')}${kpi('Arriving', a.length, 'checking in today', 'green', 'key')}${kpi('Leaving', l.length, 'checking out today', 'amber', 'calendar')}${kpi('Out of order', d.outOfOrder || 0, 'not for sale', 'red', 'wrench')}</div>` +
      (over.length || ns.length ? `<div class="hx-card flush" style="margin-bottom:var(--space-4)">${over.map((s) => `<a class="hx-row" href="hx-stays.html#stay=${s._id}" style="text-decoration:none;color:inherit"><div class="grow"><b>Room ${E(s.roomNumber)} · ${E(s.guest && s.guest.name)}</b><small class="hx-sub">Check-out is overdue</small></div>${pill('overdue', 'bad')}</a>`).join('')}${ns.map((s) => `<a class="hx-row" href="hx-stays.html#stay=${s._id}" style="text-decoration:none;color:inherit"><div class="grow"><b>${E(s.guest && s.guest.name)} · ${E(s.bookingCode)}</b><small class="hx-sub">Has not arrived</small></div>${pill('no-show?', 'warn')}</a>`).join('')}</div>` : '') +
      window.HX.tabs([['arrivals', `Arrivals · ${a.length}`], ['departures', `Departures · ${l.length}`], ['inhouse', `In house · ${h.length}`]], tab) +
      (rows.length ? `<div class="hx-card flush hx-xlist">${rows.map(row).join('')}</div>` : window.HX.empty('No guests here', 'Nothing for this list today.'));
    el.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => { tab = b.dataset.tab; paint(); }));
    el.querySelectorAll('[data-pay]').forEach((b) => b.addEventListener('click', () => window.HX.pay.open({ kind: 'stay', id: b.dataset.pay, title: 'Take payment', reference: `${b.dataset.name}${b.dataset.room ? ' · Room ' + b.dataset.room : ''}`, due: Math.max(0, Number(b.dataset.bal) || 0), phone: b.dataset.phone, customerName: b.dataset.name, depositChoice: true, onPaid: () => load() })));
  }
})();
