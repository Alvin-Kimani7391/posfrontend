/**
 * hx-reservations.js - table bookings, prepaid food, seating and the walk-in waitlist.
 * API: GET/POST /restaurant/reservations, POST .../:id/status (CONFIRMED, ARRIVED, CANCELLED, NO_SHOW), POST .../:id/seat,
 *      POST .../:id/deposit (take prepayment), POST .../:id/deposit/settle (refund / keep), GET /restaurant/reservations/availability
 * A booking holds its table: the owner sets how many minutes before the time the table locks (Settings > Restaurant > Table reservations).
 */
(function () {
  const { E, M, can, get, send, list, head, pill, formModal, hm, ymd, addDays } = window.HX;
  let el, day = ymd(), tables = [], dayRows = [];
  const TONE = { WAITLIST: 'warn', BOOKED: 'plan', CONFIRMED: 'busy', ARRIVED: 'ok', SEATED: 'ok', COMPLETED: 'mute', CANCELLED: 'mute', NO_SHOW: 'bad' };
  const LIVE = ['BOOKED', 'CONFIRMED', 'ARRIVED'];
  document.addEventListener('DOMContentLoaded', init);
  async function init() { el = window.HX.mount('Reservations'); if (!el) return; await window.AppShell.whenProfileReady?.(); window.HX.live(load, 30000); shell(); load(); loadTables(); }
  async function loadTables() { const d = await get('/restaurant/tables', { branchId: window.HX.branchId() }); tables = list(d, 'tables'); }

  function shell() {
    el.innerHTML = head('Reservations', 'Bookings for the day, prepaid food, and guests waiting for a table.', can('restaurant.reservations.manage') ? '<button class="btn btn-secondary" id="wl">Add to waitlist</button><button class="btn btn-primary" id="nb">New booking</button>' : '') +
      `<div class="hx-actions" style="margin-bottom:var(--space-4)"><button class="btn btn-secondary" id="pv">‹</button><input class="input" type="date" id="dy" value="${day}" style="width:auto"><button class="btn btn-secondary" id="nx">›</button><button class="btn btn-secondary" id="td">Today</button></div><div id="sm" class="hx-sum"></div><div id="rl"></div>`;
    const set = (d) => { day = d; el.querySelector('#dy').value = d; load(); };
    el.querySelector('#pv').onclick = () => set(addDays(day, -1)); el.querySelector('#nx').onclick = () => set(addDays(day, 1)); el.querySelector('#td').onclick = () => set(ymd());
    el.querySelector('#dy').onchange = (e) => set(e.target.value);
    el.querySelector('#nb')?.addEventListener('click', () => form(false)); el.querySelector('#wl')?.addEventListener('click', () => form(true));
  }

  async function load() {
    const box = el.querySelector('#rl'); if (!box) return;
    const from = new Date(day + 'T00:00:00'), to = new Date(day + 'T23:59:59');
    const [d, w] = await Promise.all([get('/restaurant/reservations', { branchId: window.HX.branchId(), from: from.toISOString(), to: to.toISOString(), limit: 100 }), get('/restaurant/reservations', { branchId: window.HX.branchId(), status: 'WAITLIST', limit: 50 })]);
    const rows = list(d, 'reservations').filter((r) => r.status !== 'WAITLIST'), wait = list(w, 'reservations'); dayRows = rows;
    const n = (f) => rows.filter(f).length, prepaid = rows.filter((r) => LIVE.includes(r.status) && r.deposit && r.deposit.paid).reduce((a, r) => a + (Number(r.deposit.amount) || 0) - (Number(r.deposit.appliedAmount) || 0), 0);
    el.querySelector('#sm').innerHTML = [['Upcoming', n((r) => ['BOOKED', 'CONFIRMED'].includes(r.status))], ['Arrived', n((r) => r.status === 'ARRIVED')], ['Seated', n((r) => r.status === 'SEATED')], ['No-shows', n((r) => r.status === 'NO_SHOW')], ['Prepaid, not yet used', M(prepaid)]].map(([l, v]) => `<div class="hx-card"><small class="hx-sub">${l}</small><b style="display:block;font-size:var(--text-xl)">${v}</b></div>`).join('');
    box.innerHTML = (wait.length ? `<div class="hx-section"><h2>Waitlist · ${wait.length}</h2><div class="hx-card flush">${wait.map(row).join('')}</div></div>` : '') +
      `<div class="hx-section"><h2>Bookings</h2>${rows.length ? `<div class="hx-card flush">${rows.map(row).join('')}</div>` : window.HX.empty('No bookings', 'Nothing booked for this day.')}</div>`;
    box.querySelectorAll('[data-s]').forEach((b) => b.addEventListener('click', () => setStatus(b.dataset.id, b.dataset.s)));
    box.querySelectorAll('[data-seat]').forEach((b) => b.addEventListener('click', () => seat(b.dataset.seat)));
    box.querySelectorAll('[data-pay]').forEach((b) => b.addEventListener('click', () => takePayment(b.dataset.pay)));
    box.querySelectorAll('[data-settle]').forEach((b) => b.addEventListener('click', () => settle(b.dataset.id, b.dataset.settle)));
  }

  const tableOf = (r) => (r.tableIds || []).map((t) => (t && t.name) || (tables.find((x) => x._id === String(t)) || {}).name || '').filter(Boolean).join(', ') || r.tableName || (r.table && r.table.name) || '';
  const tableIdOf = (r) => String(r.tableId || (r.table && r.table._id) || (r.tableIds && r.tableIds[0] && (r.tableIds[0]._id || r.tableIds[0])) || '');
  /** "in 25 min", "due now", "12 min late" - so the host sees at a glance who to expect and who is late. */
  function when(r) {
    if (!r.startsAt || !LIVE.includes(r.status) || r.status === 'ARRIVED') return '';
    const m = Math.round((new Date(r.startsAt).getTime() - Date.now()) / 60000);
    if (m > 90) return ''; if (m > 0) return `<span class="hx-pill hx-st-plan">in ${m} min</span>`; if (m > -2) return '<span class="hx-pill hx-st-busy">due now</span>';
    return `<span class="hx-pill hx-st-bad">${-m} min late</span>`;
  }
  const left = (r) => (r.deposit && r.deposit.paid && !r.deposit.refunded && !r.deposit.forfeited ? Math.max(0, (Number(r.deposit.amount) || 0) - (Number(r.deposit.appliedAmount) || 0)) : 0);
  function money(r) {
    const d = r.deposit; if (!d || !d.required) return '';
    const what = d.kind === 'FOOD' ? 'food prepaid' : 'deposit';
    if (!d.paid) return ` · <b>${what} ${M(d.amount)} not paid yet</b>`;
    if (d.forfeited) return ` · ${what} ${M(d.amount)} kept`; if (d.refunded) return ` · ${what} refunded`;
    return ` · ${what} ${M(d.amount)} paid${Number(d.appliedAmount) ? `, ${M(d.appliedAmount)} used` : ' (comes off the bill)'}`;
  }
  function row(r) {
    const live = [...LIVE, 'WAITLIST'].includes(r.status), mgr = can('restaurant.reservations.manage'), tb = tableOf(r);
    const btn = (s, l, c = 'btn-secondary') => `<button class="btn btn-sm ${c}" data-id="${r._id}" data-s="${s}">${l}</button>`;
    const unpaid = r.deposit && r.deposit.required && !r.deposit.paid && LIVE.includes(r.status), held = left(r) > 0 && ['CANCELLED', 'NO_SHOW'].includes(r.status);
    const pre = (r.preOrder || []).length ? `<br><small class="hx-sub">Pre-order: ${r.preOrder.map((i) => `${i.quantity}× ${E(i.name)}`).join(', ')}</small>` : '';
    return `<div class="hx-row"><div style="min-width:54px;text-align:center"><div style="font-weight:700;font-size:var(--text-lg)">${tb ? 'T' + E(tb) : '–'}</div><small class="hx-sub">${tb ? 'table' : 'no table'}</small></div>
      <div class="grow"><b>${r.startsAt ? hm(r.startsAt) : 'Waiting'} · ${E(r.guestName)} · ${r.partySize} guests</b><small class="hx-sub">${E(r.phone)}${r.occasion ? ' · ' + E(r.occasion) : ''}${money(r)}${r.source === 'ONLINE' ? ' · booked online' : ''}${r.notes && !pre ? ' · ' + E(r.notes) : ''}</small>${pre}</div>${when(r)}${pill(r.status, TONE[r.status])}
      ${mgr && (live || held) ? `<span class="hx-actions">${r.status === 'BOOKED' ? btn('CONFIRMED', 'Confirm') : ''}${unpaid && can('restaurant.bills.pay') ? `<button class="btn btn-sm btn-secondary" data-pay="${r._id}">Take payment</button>` : ''}${LIVE.includes(r.status) && tb ? `<button class="btn btn-sm btn-primary" data-seat="${r._id}">Seat</button>` : ''}${r.status !== 'ARRIVED' && live ? btn('ARRIVED', 'Arrived') : ''}${['BOOKED', 'CONFIRMED'].includes(r.status) ? btn('NO_SHOW', 'No-show') : ''}${live ? btn('CANCELLED', 'Cancel') : ''}${held ? `<button class="btn btn-sm btn-secondary" data-id="${r._id}" data-settle="REFUND">Refund ${M(left(r))}</button><button class="btn btn-sm btn-secondary" data-id="${r._id}" data-settle="FORFEIT">Keep it</button>` : ''}</span>` : ''}</div>`;
  }

  async function setStatus(id, status) {
    let reason; if (status === 'CANCELLED' || status === 'NO_SHOW') { reason = await window.HX.ask(status === 'CANCELLED' ? 'Cancel booking' : 'Mark no-show', 'Reason (optional)', { required: false }); if (reason === null) return; }
    if (await send('post', `/restaurant/reservations/${id}/status`, { status, ...(reason ? { reason } : {}) })) load();
  }

  /** The guest is here: open their order on the reserved table. Their prepaid food comes off the bill when it is made. */
  async function seat(id) {
    const r = dayRows.find((x) => x._id === id);
    const v = await window.HX.ask(`Seat ${r ? r.guestName : 'guest'}`, 'How many guests are at the table?', { type: 'number', value: r ? r.partySize : 2, cta: 'Seat and open order' }); if (v === null) return;
    const out = await send('post', `/restaurant/reservations/${id}/seat`, { guestCount: Number(v) || undefined });
    if (out) { window.UI.toast.success(`Seated at table ${tableOf(r || {}) || ''}. Their order is open on the floor screen.${left(r || {}) > 0 ? ' The prepaid amount will come off the bill.' : ''}`); load(); }
  }

  function takePayment(id) {
    const r = dayRows.find((x) => x._id === id); if (!r) return;
    formModal({ title: `Payment for ${r.guestName}`, intro: `${r.deposit.kind === 'FOOD' ? 'Prepaid food' : 'Deposit'} for ${r.reservationNumber}. It comes off the bill when they dine.`, submitText: 'Record payment', fields: [
      { name: 'amount', label: 'Amount (KSh)', type: 'number', value: Number(r.deposit.amount) || 0, min: 1, step: '0.01', required: true },
      { name: 'method', label: 'Paid by', type: 'select', options: [['CASH', 'Cash'], ['MPESA', 'M-PESA'], ['CARD', 'Card'], ['BANK', 'Bank'], ['OTHER', 'Other']] },
      { name: 'reference', label: 'Reference (M-PESA code, if any)' },
    ], onSubmit: async (v) => { if (await send('post', `/restaurant/reservations/${id}/deposit`, v)) { window.UI.toast.success('Payment recorded'); load(); return true; } return false; } });
  }

  async function settle(id, action) {
    const r = dayRows.find((x) => x._id === id); const reason = await window.HX.ask(action === 'REFUND' ? 'Refund prepaid amount' : 'Keep prepaid amount', 'Reason (optional)', { required: false }); if (reason === null) return;
    if (await send('post', `/restaurant/reservations/${id}/deposit/settle`, { action, ...(reason ? { reason } : {}), ...(r && r.deposit && r.deposit.method && action === 'REFUND' ? { method: r.deposit.method } : {}) })) { window.UI.toast.success(action === 'REFUND' ? 'Refund recorded' : 'Kept by the business'); load(); }
  }

  function form(waitlist) {
    const opts = (free) => [['', tables.length ? 'Choose a table' : 'No tables found'], ...tables.map((t) => [t._id, `Table ${t.name} · ${t.seats || '?'} seats${free && !free.has(t._id) ? ' · taken at that time' : ''}`])];
    const m = formModal({ title: waitlist ? 'Add to waitlist' : 'New booking', submitText: 'Save', fields: [
      { row: [{ name: 'guestName', label: 'Guest name', required: true }, { name: 'phone', label: 'Phone', type: 'tel', required: true }] },
      { row: [{ name: 'partySize', label: 'Guests', type: 'number', value: 2, min: 1, required: true }, ...(waitlist ? [{ name: 'quotedWaitMinutes', label: 'Quoted wait (min)', type: 'number', value: 20, min: 0 }] : [{ name: 'startsAt', label: 'Date and time', type: 'datetime-local', value: `${day}T19:00`, required: true }])] },
      ...(waitlist ? [] : [{ name: 'tableId', label: 'Table', type: 'select', options: opts(null), hint: 'Tables already booked at that time are marked. The table locks automatically before the booking time.' }]),
      ...(waitlist ? [] : [{ row: [{ name: 'durationMinutes', label: 'Length (minutes)', type: 'number', min: 15, hint: 'Blank = default' }, { name: 'prepaid', label: 'Food to prepay (KSh)', type: 'number', min: 0, step: '0.01', hint: 'Optional. Take the payment from the booking row.' }] }]),
      { name: 'occasion', label: 'Occasion (optional)' }, { name: 'notes', label: 'Notes', type: 'textarea' },
    ], onSubmit: async (v) => {
      if (!waitlist && v.tableId) {
        const t = tables.find((x) => x._id === v.tableId);
        if (t && t.seats && v.partySize > t.seats && !confirm(`Table ${t.name} seats ${t.seats} but the party is ${v.partySize}. Book it anyway?`)) return false;
      }
      const { prepaid, ...rest } = v;
      const body = { ...rest, branchId: window.HX.branchId(), source: waitlist ? 'WALK_IN' : 'PHONE', ...(rest.tableId ? { tableIds: [rest.tableId] } : {}), ...(waitlist ? { waitlist: true } : { startsAt: new Date(v.startsAt).toISOString() }), ...(prepaid > 0 ? { depositAmount: prepaid, depositKind: 'FOOD' } : {}) };
      delete body.tableId;
      if (await send('post', '/restaurant/reservations', body)) { window.UI.toast.success('Saved'); load(); return true; } return false;
    } });
    if (waitlist || !m) return;
    // when the time or party changes, mark the tables that are already taken at that time
    const refresh = async () => {
      const at = m.querySelector('[name=startsAt]'), sel = m.querySelector('[name=tableId]'), ps = m.querySelector('[name=partySize]'), dur = m.querySelector('[name=durationMinutes]'); if (!at || !sel || !at.value) return;
      const a = await get('/restaurant/reservations/availability', { branchId: window.HX.branchId(), startsAt: new Date(at.value).toISOString(), ...(dur && dur.value ? { durationMinutes: dur.value } : {}) }); if (!a) return;
      const free = new Set((a.allFree || []).map((t) => String(t._id))), keep = sel.value;
      sel.innerHTML = opts(free).map(([val, lab]) => `<option value="${E(val)}" ${val === keep ? 'selected' : ''} ${val && !free.has(val) ? 'disabled' : ''}>${E(lab)}</option>`).join('');
    };
    ['startsAt', 'durationMinutes'].forEach((n) => m.querySelector(`[name=${n}]`)?.addEventListener('change', refresh)); refresh();
  }
})();
