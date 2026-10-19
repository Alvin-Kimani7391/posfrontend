/**
 * hx-stays.js - Bookings and the guest folio.
 *   List     GET /accommodation/stays        New booking (#new): dates -> availability -> guest details
 *   Detail   GET /accommodation/stays/:id    (#stay=ID) check-in, folio charges and payments, move room, cancel, check-out with payment
 */
(function () {
  const { E, M, can, get, send, list, head, pill, formModal, unwrap, dt, ymd, addDays, payLabel } = window.HX;
  let el, tab = '', stay = null;
  const TONE = { RESERVED: 'plan', CHECKED_IN: 'busy', CHECKED_OUT: 'ok', CANCELLED: 'mute', NO_SHOW: 'bad' };
  const LABEL = { RESERVED: 'Booked', CHECKED_IN: 'In house', CHECKED_OUT: 'Checked out', CANCELLED: 'Cancelled', NO_SHOW: 'No-show' };
  document.addEventListener('DOMContentLoaded', init);
  async function init() { el = window.HX.mount('Bookings'); if (!el) return; await window.AppShell.whenProfileReady?.(); window.addEventListener('hashchange', route); route(); }
  function route() {
    const m = location.hash.match(/stay=([a-f0-9]+)/i);
    if (m) return openStay(m[1]);
    showList(); if (location.hash === '#new') { history.replaceState(null, '', location.pathname); newBooking(); }
  }

  async function showList() {
    stay = null;
    el.innerHTML = head('Bookings', 'Every reservation and stay.', can('accommodation.stays.create') ? '<button class="btn btn-primary" id="nb">New booking</button>' : '') + window.HX.tabs([['', 'All'], ['RESERVED', 'Booked'], ['CHECKED_IN', 'In house'], ['CHECKED_OUT', 'Checked out'], ['CANCELLED,NO_SHOW', 'Cancelled']], tab) + '<div id="sl" class="hx-card flush"><p class="hx-sub" style="padding:var(--space-4)">Loading…</p></div>';
    el.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => { tab = b.dataset.tab; showList(); }));
    el.querySelector('#nb')?.addEventListener('click', newBooking);
    const d = await get('/accommodation/stays', { branchId: window.HX.branchId(), limit: 50, ...(tab ? { status: tab } : {}) }); const rows = list(d, 'stays');
    el.querySelector('#sl').innerHTML = rows.length ? rows.map((s) => `<a class="hx-row" href="#stay=${s._id}" style="text-decoration:none;color:inherit"><div class="grow"><b>${E(s.guest && s.guest.name)}${s.roomNumber ? ' · Room ' + E(s.roomNumber) : ''}</b><small class="hx-sub">${E(s.checkInDate)} → ${E(s.checkOutDate)} · ${E(s.roomTypeName || '')} · ${E(s.bookingCode)}</small></div>${s.totals && s.totals.balance > 0 && s.status === 'CHECKED_IN' ? `<span class="hx-money">${M(s.totals.balance)}</span>` : ''}${pill(LABEL[s.status] || s.status, TONE[s.status])}</a>`).join('') : window.HX.empty('No bookings', 'New bookings will be listed here.');
  }

  /* ---------- new booking ---------- */
  async function newBooking() {
    // "Today" is the business's today (its time zone), which can differ from this device's clock.
    const bd = await get('/accommodation/board', { branchId: window.HX.branchId() });
    const today = (bd && bd.date) || ymd();
    formModal({ title: 'New booking: dates', submitText: 'Check availability', fields: [
      { row: [{ name: 'checkInDate', label: 'Check-in', type: 'date', value: today, required: true }, { name: 'checkOutDate', label: 'Check-out', type: 'date', value: addDays(today, 1), required: true }] },
      { row: [{ name: 'adults', label: 'Adults', type: 'number', value: 2, min: 1 }, { name: 'children', label: 'Children', type: 'number', value: 0, min: 0 }] },
    ], onSubmit: async (v) => {
      if (v.checkOutDate <= v.checkInDate) { window.UI.toast.warning('Check-out must be after check-in'); return false; }
      const a = await get('/accommodation/availability', { branchId: window.HX.branchId(), checkInDate: v.checkInDate, checkOutDate: v.checkOutDate, adults: v.adults || 1, children: v.children || 0 });
      if (a && a.today && v.checkInDate < a.today) { window.UI.toast.warning(`Check-in ${v.checkInDate} is before today (${a.today}, ${a.timeZone || 'business time zone'}). Choose ${a.today} or later.`); return false; }
      const types = ((a && Array.isArray(a.byType)) ? a.byType : []).filter((t) => (t.available != null ? t.available : 0) > 0);
      if (!types.length) { window.UI.toast.warning('No rooms are free for those dates'); return false; }
      setTimeout(() => guestForm(v, types), 150); return true;
    } });
  }
  function guestForm(dates, types) {
    const id = (t) => t.roomTypeId || t._id, price = (t) => (t.from != null ? t.from : t.total != null ? t.total : null);
    formModal({ title: 'New booking: guest', submitText: 'Create booking', maxWidth: '540px', fields: [
      { name: 'roomTypeId', label: 'Room type', type: 'select', options: types.map((t) => [id(t), `${t.roomType || t.name || t.roomTypeName || 'Room'}${price(t) != null ? ' · ' + M(price(t)) + ' total' : ''} · ${t.available} free`]) },
      { row: [{ name: 'name', label: 'Guest name', required: true }, { name: 'phone', label: 'Phone', type: 'tel' }] }, { name: 'email', label: 'Email (optional)', type: 'email' },
      { row: [{ name: 'mealPlan', label: 'Meals', type: 'select', options: [['ROOM_ONLY', 'Room only'], ['BED_BREAKFAST', 'Bed & breakfast'], ['HALF_BOARD', 'Half board'], ['FULL_BOARD', 'Full board']] }, { name: 'source', label: 'Booked via', type: 'select', options: [['WALK_IN', 'Walk-in'], ['PHONE', 'Phone'], ['ONLINE', 'Online'], ['AGENT', 'Agent'], ['CORPORATE', 'Corporate']] }] },
      { row: [{ name: 'idType', label: 'ID type', type: 'select', options: [['NATIONAL_ID', 'National ID'], ['PASSPORT', 'Passport'], ['DRIVING_LICENCE', 'Driving licence'], ['OTHER', 'Other']] }, { name: 'idNumber', label: 'ID / passport number', hint: 'Needed to check the guest in.' }] },
      { name: 'specialRequests', label: 'Special requests', type: 'textarea' }, { name: 'checkInNow', label: 'Check the guest in now', type: 'checkbox' },
    ], onSubmit: async (v) => {
      if (v.checkInNow && !v.idNumber) { window.UI.toast.warning('Enter the guest’s ID or passport number to check in now, or untick “Check the guest in now”.'); return false; }
      const body = { branchId: window.HX.branchId(), roomTypeId: v.roomTypeId, checkInDate: dates.checkInDate, checkOutDate: dates.checkOutDate, adults: dates.adults || 1, children: dates.children || 0, mealPlan: v.mealPlan, source: v.source, guest: { name: v.name, ...(v.phone ? { phone: v.phone } : {}), ...(v.email ? { email: v.email } : {}), ...(v.idNumber ? { idType: v.idType || 'NATIONAL_ID', idNumber: v.idNumber } : {}) }, ...(v.specialRequests ? { specialRequests: v.specialRequests } : {}), ...(v.checkInNow ? { checkInNow: true } : {}) };
      const r = await send('post', '/accommodation/stays', body); const s = r && unwrap(r, 'stay');
      if (s && s._id) { window.UI.toast.success('Booking created'); setTimeout(() => { location.hash = 'stay=' + s._id; }, 100); return true; } return false;
    } });
  }

  /* ---------- detail ---------- */
  async function openStay(id) {
    el.innerHTML = '<div class="hx-card"><p class="hx-sub">Loading booking…</p></div>';
    const d = await get('/accommodation/stays/' + id); if (!d) { window.UI.toast.error('Booking not found'); location.hash = ''; return; }
    stay = unwrap(d, 'stay'); paintStay();
  }
  async function reload() { const d = await get('/accommodation/stays/' + stay._id); if (d) { stay = unwrap(d, 'stay'); paintStay(); } }

  function paintStay() {
    const s = stay, t = s.totals || {}, g = s.guest || {}, live = s.status === 'CHECKED_IN', booked = s.status === 'RESERVED';
    const B = (id, label, show, cls = 'btn-secondary') => (show ? `<button class="btn ${cls}" id="${id}">${label}</button>` : '');
    const lines = (s.folio || []);
    el.innerHTML = head(`${g.name || 'Guest'}${s.roomNumber ? ' · Room ' + s.roomNumber : ''}`, `${s.bookingCode} · ${s.checkInDate} → ${s.checkOutDate}${s.roomTypeName ? ' · ' + s.roomTypeName : ''}`, `<a class="btn btn-secondary" href="#">All bookings</a>${pill(LABEL[s.status] || s.status, TONE[s.status])}`) + `
      <div class="hx-cols" style="grid-template-columns:minmax(0,1.5fr) minmax(280px,1fr)"><div>
        <div class="hx-card flush"><div class="hx-card" style="border:0;border-bottom:1px solid var(--color-border);border-radius:0"><h3>Folio</h3></div>
          ${lines.length ? lines.map((l) => `<div class="hx-row ${l.voided ? 'hx-voided' : ''}"><div class="grow"><b>${E(l.description)}</b><small class="hx-sub">${E(l.type)}${l.nightDate ? ' · ' + E(l.nightDate) : ''}${l.quantity > 1 ? ' · ×' + l.quantity : ''}</small></div><span class="hx-money">${M(l.total)}</span>${!l.voided && live && can('accommodation.folio.adjust') && l.type !== 'ROOM' ? `<button class="btn btn-sm btn-secondary" data-v="${l._id}">Void</button>` : ''}</div>`).join('') : '<p class="hx-sub" style="padding:var(--space-4)">No charges yet.</p>'}
          ${(s.payments || []).length ? `<div class="hx-card" style="border:0;border-top:1px solid var(--color-border);border-radius:0"><h3>Payments</h3>${s.payments.map((p) => `<div class="hx-row"><div class="grow"><b>${payLabel(p.method)} ${p.kind === 'DEPOSIT' ? '(deposit)' : p.kind === 'REFUND' ? '(refund)' : ''}</b><small class="hx-sub">${dt(p.at)}${p.reference ? ' · ' + E(p.reference) : ''}</small></div><span class="hx-money">${p.kind === 'REFUND' ? '−' : ''}${M(p.amount)}</span></div>`).join('')}</div>` : ''}</div></div>
        <div style="display:grid;gap:var(--space-3);align-content:start">
          <div class="hx-card"><div class="hx-folio-sum" style="grid-template-columns:1fr 1fr 1fr"><div><small>Charges</small><b>${M(t.total != null ? t.total : t.charges)}</b></div><div><small>Paid</small><b>${M(t.paid != null ? t.paid : t.payments)}</b></div><div><small>Balance</small><b>${M(t.balance)}</b></div></div></div>
          <div class="hx-card"><h3>Guest</h3><p>${E(g.name || '')}</p><p class="hx-sub">${E(g.phone || '')} ${E(g.email || '')}</p><p class="hx-sub">${s.adults || 1} adult${(s.adults || 1) > 1 ? 's' : ''}${s.children ? ', ' + s.children + ' children' : ''} · ${E((s.mealPlan || '').replace(/_/g, ' ').toLowerCase())}</p>${s.specialRequests ? `<p class="hx-sub">“${E(s.specialRequests)}”</p>` : ''}</div>
          <div class="hx-card" style="display:grid;gap:var(--space-2)">${B('ci', 'Check in', booked && can('accommodation.stays.checkin'), 'btn-primary')}${B('co', 'Check out', live && can('accommodation.stays.checkout'), 'btn-primary')}${B('ch', 'Add charge', live && can('accommodation.folio.charge'))}${B('py', 'Take payment', (live || booked) && can('accommodation.folio.pay'))}${B('mv', 'Move room', (live || booked) && can('accommodation.stays.manage'))}${B('cn', 'Cancel booking', booked && can('accommodation.stays.manage'))}${B('ns', 'Mark no-show', booked && can('accommodation.stays.manage'))}</div></div></div>`;
    const on = (id, f) => el.querySelector('#' + id)?.addEventListener('click', f);
    on('ci', checkIn); on('co', checkOut); on('ch', charge); on('py', pay); on('mv', move);
    on('cn', async () => { const r = await window.HX.ask('Cancel booking', 'Reason'); if (r && await send('post', `/accommodation/stays/${s._id}/cancel`, { reason: r })) reload(); });
    on('ns', async () => { if (await window.UI.confirmDialog({ title: 'Mark as no-show?', message: 'A no-show fee may apply.', confirmText: 'Mark no-show', danger: true }) && await send('post', `/accommodation/stays/${s._id}/no-show`, {})) reload(); });
    el.querySelectorAll('[data-v]').forEach((b) => b.addEventListener('click', async () => { const r = await window.HX.ask('Void charge', 'Reason'); if (r && await send('post', `/accommodation/stays/${s._id}/charges/${b.dataset.v}/void`, { reason: r })) reload(); }));
  }

  function checkIn() {
    const g = stay.guest || {};
    formModal({ title: 'Check in', intro: 'Confirm who is arriving. ID details may be required by your settings.', fields: [{ row: [{ name: 'idType', label: 'ID type', type: 'select', options: [['NATIONAL_ID', 'National ID'], ['PASSPORT', 'Passport'], ['DRIVING_LICENCE', 'Driving licence'], ['OTHER', 'Other']], value: g.idType }, { name: 'idNumber', label: 'ID number', value: g.idNumber }] }, { name: 'phone', label: 'Phone', type: 'tel', value: g.phone }],
      onSubmit: async (v) => { const guest = {}; ['idType', 'idNumber', 'phone'].forEach((k) => { if (v[k]) guest[k] = v[k]; }); if (await send('post', `/accommodation/stays/${stay._id}/check-in`, { guest })) { window.UI.toast.success('Checked in'); reload(); return true; } return false; } });
  }
  function charge() {
    formModal({ title: 'Add a charge', fields: [{ name: 'type', label: 'Type', type: 'select', options: [['FNB', 'Food & drink'], ['MINIBAR', 'Minibar'], ['LAUNDRY', 'Laundry'], ['TRANSPORT', 'Transport'], ['SERVICE', 'Service'], ['DAMAGE', 'Damage'], ['EXTRA_PERSON', 'Extra person'], ['OTHER', 'Other']] }, { name: 'description', label: 'Description', required: true }, { row: [{ name: 'quantity', label: 'Quantity', type: 'number', value: 1, min: 1 }, { name: 'unitPrice', label: 'Price each', type: 'number', step: '0.01', required: true }] }],
      onSubmit: async (v) => { if (await send('post', `/accommodation/stays/${stay._id}/charges`, v)) { reload(); return true; } return false; } });
  }
  function pay() {
    const bal = (stay.totals && stay.totals.balance) || 0;
    formModal({ title: 'Take payment', fields: [{ name: 'kind', label: 'This is a', type: 'select', options: [['PAYMENT', 'Payment'], ['DEPOSIT', 'Deposit']] }, { row: [{ name: 'amount', label: 'Amount', type: 'number', step: '0.01', value: bal > 0 ? bal : '', required: true }, { name: 'method', label: 'Method', type: 'select', options: ['CASH', 'MPESA', 'CARD', 'BANK', 'MOBILE_MONEY'].map((m) => [m, payLabel(m)]) }] }, { name: 'reference', label: 'Reference (optional)' }],
      onSubmit: async (v) => { if (await send('post', `/accommodation/stays/${stay._id}/payments`, v)) { window.UI.toast.success('Payment recorded'); reload(); return true; } return false; } });
  }
  async function move() {
    const b = await get('/accommodation/board', { branchId: window.HX.branchId() }); const free = ((b && b.rooms) || []).filter((r) => !r.inHouse && r._id !== stay.roomId && r.status === 'AVAILABLE');
    if (!free.length) return window.UI.toast.info('No other free rooms right now');
    formModal({ title: 'Move room', fields: [{ name: 'roomId', label: 'New room', type: 'select', options: free.map((r) => [r._id, `Room ${r.number} · ${r.roomType}${r.sellable ? '' : ' (needs cleaning)'}`]) }, { name: 'reason', label: 'Reason', required: true }], onSubmit: async (v) => { if (await send('post', `/accommodation/stays/${stay._id}/move`, v)) { reload(); return true; } return false; } });
  }
  async function checkOut() {
    const qd = await get(`/accommodation/stays/${stay._id}/checkout-quote`); const q = (qd && (qd.quote || qd)) || {};
    const bal = q.balance != null ? q.balance : (stay.totals && stay.totals.balance) || 0;
    formModal({ title: 'Check out', intro: bal > 0 ? `Balance to pay: ${M(bal)}. Any late check-out fee is included.` : 'Nothing left to pay.', submitText: bal > 0 ? 'Pay and check out' : 'Check out', fields: bal > 0 ? [{ row: [{ name: 'amount', label: 'Amount received', type: 'number', step: '0.01', value: bal }, { name: 'method', label: 'Method', type: 'select', options: ['CASH', 'MPESA', 'CARD', 'BANK', 'MOBILE_MONEY'].map((m) => [m, payLabel(m)]) }] }, { name: 'reference', label: 'Reference (optional)' }] : [{ name: 'noop', label: 'Guest has settled the bill', type: 'checkbox', value: true }],
      onSubmit: async (v) => { const body = bal > 0 && v.amount > 0 ? { payments: [{ method: v.method, amount: v.amount, ...(v.reference ? { reference: v.reference } : {}) }] } : {}; if (await send('post', `/accommodation/stays/${stay._id}/check-out`, body)) { window.UI.toast.success('Checked out'); reload(); return true; } return false; } });
  }
})();
