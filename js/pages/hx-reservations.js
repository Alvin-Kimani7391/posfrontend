/**
 * hx-reservations.js - table bookings and the walk-in waitlist.
 * API: GET/POST /restaurant/reservations, POST .../:id/status (CONFIRMED, ARRIVED, CANCELLED, NO_SHOW), GET /restaurant/reservations/availability
 */
(function () {
  const { E, M, can, get, send, list, head, pill, formModal, dt, hm, ymd, addDays } = window.HX;
  let el, day = ymd(), mode = 'day', tables = [], dayRows = [];
  const TONE = { WAITLIST: 'warn', BOOKED: 'plan', CONFIRMED: 'busy', ARRIVED: 'ok', SEATED: 'ok', COMPLETED: 'mute', CANCELLED: 'mute', NO_SHOW: 'bad' };
  document.addEventListener('DOMContentLoaded', init);
  async function init() { el = window.HX.mount('Reservations'); if (!el) return; await window.AppShell.whenProfileReady?.(); window.HX.live(load, 30000); shell(); load(); loadTables(); }
  async function loadTables() { const d = await get('/restaurant/tables', { branchId: window.HX.branchId() }); tables = list(d, 'tables'); }

  function shell() {
    el.innerHTML = head('Reservations', 'Bookings for the day and guests waiting for a table.', can('restaurant.reservations.manage') ? '<button class="btn btn-secondary" id="wl">Add to waitlist</button><button class="btn btn-primary" id="nb">New booking</button>' : '') +
      `<div class="hx-actions" style="margin-bottom:var(--space-4)"><button class="btn btn-secondary" id="pv">‹</button><input class="input" type="date" id="dy" value="${day}" style="width:auto"><button class="btn btn-secondary" id="nx">›</button><button class="btn btn-secondary" id="td">Today</button></div><div id="rl"></div>`;
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
    box.innerHTML = (wait.length ? `<div class="hx-section"><h2>Waitlist · ${wait.length}</h2><div class="hx-card flush">${wait.map(row).join('')}</div></div>` : '') +
      `<div class="hx-section"><h2>Bookings</h2>${rows.length ? `<div class="hx-card flush">${rows.map(row).join('')}</div>` : window.HX.empty('No bookings', 'Nothing booked for this day.')}</div>`;
    box.querySelectorAll('[data-s]').forEach((b) => b.addEventListener('click', () => setStatus(b.dataset.id, b.dataset.s)));
  }

  const tableOf = (r) => r.tableName || (r.table && r.table.name) || (r.tableIds && r.tableIds[0] && r.tableIds[0].name) || '';
  const tableIdOf = (r) => String(r.tableId || (r.table && r.table._id) || (r.tableIds && r.tableIds[0] && (r.tableIds[0]._id || r.tableIds[0])) || '');
  function row(r) {
    const live = ['BOOKED', 'CONFIRMED', 'WAITLIST', 'ARRIVED'].includes(r.status), btn = (s, l, c = 'btn-secondary') => `<button class="btn btn-sm ${c}" data-id="${r._id}" data-s="${s}">${l}</button>`;
    return `<div class="hx-row"><div class="grow"><b>${r.startsAt ? hm(r.startsAt) : 'Waiting'} · ${E(r.guestName)} · ${r.partySize} guests${tableOf(r) ? ' · Table ' + E(tableOf(r)) : ''}</b><small class="hx-sub">${E(r.phone)}${r.occasion ? ' · ' + E(r.occasion) : ''}${r.deposit && r.deposit.required ? ` · deposit ${r.deposit.paid ? 'paid' : 'due ' + M(r.deposit.amount)}` : ''}${r.notes ? ' · ' + E(r.notes) : ''}</small></div>${pill(r.status, TONE[r.status])}
      ${can('restaurant.reservations.manage') && live ? `<span class="hx-actions">${r.status === 'BOOKED' ? btn('CONFIRMED', 'Confirm') : ''}${r.status !== 'ARRIVED' ? btn('ARRIVED', 'Arrived', 'btn-primary') : ''}${btn('NO_SHOW', 'No-show')}${btn('CANCELLED', 'Cancel')}</span>` : ''}</div>`;
  }

  async function setStatus(id, status) {
    let reason; if (status === 'CANCELLED' || status === 'NO_SHOW') { reason = await window.HX.ask(status === 'CANCELLED' ? 'Cancel booking' : 'Mark no-show', 'Reason (optional)', { required: false }); if (reason === null) return; }
    if (await send('post', `/restaurant/reservations/${id}/status`, { status, ...(reason ? { reason } : {}) })) load();
  }

  function form(waitlist) {
    formModal({ title: waitlist ? 'Add to waitlist' : 'New booking', submitText: 'Save', fields: [
      { row: [{ name: 'guestName', label: 'Guest name', required: true }, { name: 'phone', label: 'Phone', type: 'tel', required: true }] },
      { row: [{ name: 'partySize', label: 'Guests', type: 'number', value: 2, min: 1, required: true }, ...(waitlist ? [{ name: 'quotedWaitMinutes', label: 'Quoted wait (min)', type: 'number', value: 20, min: 0 }] : [{ name: 'startsAt', label: 'Date and time', type: 'datetime-local', value: `${day}T19:00`, required: true }])] },
      ...(waitlist ? [] : [{ name: 'tableId', label: 'Table', type: 'select', options: [['', tables.length ? 'Any table (choose later)' : 'No tables found'], ...tables.map((t) => [t._id, `${t.name} · ${t.seats || '?'} seats`])], hint: 'Pick the table this booking is held for.' }]),
      ...(waitlist ? [] : [{ name: 'durationMinutes', label: 'Length (minutes)', type: 'number', min: 15, hint: 'Leave blank for the default' }]),
      { name: 'occasion', label: 'Occasion (optional)' }, { name: 'notes', label: 'Notes', type: 'textarea' },
    ], onSubmit: async (v) => {
      if (!waitlist && v.tableId) {
        const t = tables.find((x) => x._id === v.tableId), at = new Date(v.startsAt).getTime(), len = (v.durationMinutes || 90) * 60000;
        if (t && t.seats && v.partySize > t.seats && !confirm(`Table ${t.name} seats ${t.seats} but the party is ${v.partySize}. Book it anyway?`)) return false;
        const clash = dayRows.find((r) => r.startsAt && tableIdOf(r) === String(v.tableId) && ['BOOKED', 'CONFIRMED', 'ARRIVED', 'SEATED'].includes(r.status) && Math.abs(new Date(r.startsAt).getTime() - at) < len);
        if (clash && !confirm(`Table ${t ? t.name : ''} is already booked around ${hm(clash.startsAt)} (${clash.guestName}). Book it anyway?`)) return false;
      }
      const body = { ...v, branchId: window.HX.branchId(), source: waitlist ? 'WALK_IN' : 'PHONE', ...(waitlist ? { waitlist: true } : { startsAt: new Date(v.startsAt).toISOString() }) };
      if (await send('post', '/restaurant/reservations', body)) { window.UI.toast.success('Saved'); load(); return true; } return false;
    } });
  }
})();
