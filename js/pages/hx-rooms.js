/**
 * hx-rooms.js - Room board. Every room as a tile: occupied, ready, dirty, out of order, arriving, due out.
 * API: GET /accommodation/board, POST /accommodation/rooms/:id/status|housekeeping, POST /accommodation/housekeeping/tasks
 */
(function () {
  const { E, can, get, send, list, head, pill, formModal, hm } = window.HX;
  let el, rooms = [], summary = {}, filter = '';
  document.addEventListener('DOMContentLoaded', init);
  async function init() { el = window.HX.mount('Room board'); if (!el) return; await window.AppShell.whenProfileReady?.(); window.HX.live(load, 30000); load(); }

  async function load() {
    const d = await get('/accommodation/board', { branchId: window.HX.branchId() });
    if (!d) { el.innerHTML = head('Room board') + window.HX.empty('Room board is not available', 'Check that accommodation is switched on.'); return; }
    rooms = d.rooms || []; summary = d.summary || {}; paint();
  }
  const state = (r) => (r.inHouse ? ['Occupied', 'busy'] : r.status === 'OUT_OF_ORDER' ? ['Out of order', 'bad'] : r.sellable ? ['Ready', 'ok'] : ['Needs cleaning', 'warn']);

  function paint() {
    const f = rooms.filter((r) => !filter || (filter === 'occupied' ? r.inHouse : filter === 'ready' ? !r.inHouse && r.sellable : filter === 'dirty' ? !r.inHouse && r.status === 'AVAILABLE' && !r.sellable : r.status === 'OUT_OF_ORDER'));
    const chips = [['', `All · ${summary.total || rooms.length}`], ['occupied', `Occupied · ${summary.occupied || 0}`], ['ready', `Ready · ${summary.vacantReady || 0}`], ['dirty', `Needs cleaning · ${summary.vacantDirty || 0}`], ['ooo', `Out of order · ${summary.outOfOrder || 0}`]];
    el.innerHTML = head('Room board', 'Tap a room for its details and actions.', '<span class="hx-live">Live</span>') + `<div class="hx-cats hx-tabs">${chips.map(([k, l]) => `<button class="hx-chip ${k === filter ? 'on' : ''}" data-f="${k}">${l}</button>`).join('')}</div>` +
      (f.length ? `<div class="hx-rooms">${f.map((r) => { const [s, t] = state(r); return `<button class="hx-room hx-st-${t}" data-r="${r._id}" style="border-left:4px solid var(--st)"><span class="no">${E(r.number)}</span><span class="ty">${E(r.roomType || '')}</span><span>${pill(s, t)}</span><span class="who">${r.inHouse ? E(r.inHouse.guest && r.inHouse.guest.name) : r.arrivingToday ? 'Arriving today' : ''}${r.dueOutToday ? ' · due out' : ''}</span></button>`; }).join('')}</div>` : window.HX.empty('No rooms', 'Add rooms in the Setup guide.'));
    el.querySelectorAll('[data-f]').forEach((b) => b.addEventListener('click', () => { filter = b.dataset.f; paint(); }));
    el.querySelectorAll('[data-r]').forEach((b) => b.addEventListener('click', () => open(rooms.find((x) => x._id === b.dataset.r))));
  }

  function open(r) {
    const [s, t] = state(r), st = r.inHouse || r.nextArrival;
    const m = window.UI.openModal({ title: `Room ${r.number}`, maxWidth: '440px', bodyHtml: `<p>${pill(s, t)} <span class="hx-sub">${E(r.roomType || '')}${r.floor ? ' · floor ' + E(r.floor) : ''}</span></p><p class="hx-sub">Housekeeping: ${E((r.housekeeping || '').toLowerCase())}</p>
      ${st ? `<div class="hx-card" style="margin:var(--space-3) 0"><b>${E(st.guest && st.guest.name)}</b><br><small class="hx-sub">${r.inHouse ? 'In house' : 'Next arrival'} · ${E(st.bookingCode)}</small><br><a href="hx-stays.html#stay=${st._id}">Open booking</a></div>` : ''}
      <div style="display:grid;gap:var(--space-2)">${can('accommodation.housekeeping.update') ? `<button class="btn btn-secondary" data-hk="DIRTY">Mark dirty</button><button class="btn btn-secondary" data-hk="CLEAN">Mark clean</button>${can('accommodation.housekeeping.manage') ? '<button class="btn btn-secondary" data-hk="INSPECTED">Mark inspected</button>' : ''}` : ''}
      ${can('accommodation.rooms.status') && !r.inHouse ? (r.status === 'OUT_OF_ORDER' ? '<button class="btn btn-primary" data-st="AVAILABLE">Back in service</button>' : '<button class="btn btn-secondary" data-st="OUT_OF_ORDER">Take out of service</button>') : ''}
      ${can('accommodation.housekeeping.manage') ? '<button class="btn btn-secondary" id="tk">Create cleaning task</button>' : ''}</div>` });
    m.querySelectorAll('[data-hk]').forEach((b) => b.addEventListener('click', async () => { if (await send('post', `/accommodation/rooms/${r._id}/housekeeping`, { housekeeping: b.dataset.hk })) { window.UI.closeModal(); load(); } }));
    m.querySelectorAll('[data-st]').forEach((b) => b.addEventListener('click', async () => { const reason = b.dataset.st === 'OUT_OF_ORDER' ? await window.HX.ask('Out of service', 'What is wrong?') : ''; if (b.dataset.st === 'OUT_OF_ORDER' && !reason) return; if (await send('post', `/accommodation/rooms/${r._id}/status`, { status: b.dataset.st, ...(reason ? { reason } : {}) })) { window.UI.closeModal(); load(); } }));
    m.querySelector('#tk')?.addEventListener('click', () => formModal({ title: `Task for room ${r.number}`, maxWidth: '400px', fields: [{ name: 'type', label: 'Type', type: 'select', options: [['DEPARTURE_CLEAN', 'Departure clean'], ['STAYOVER_CLEAN', 'Stayover clean'], ['TURNDOWN', 'Turndown'], ['DEEP_CLEAN', 'Deep clean'], ['INSPECTION', 'Inspection'], ['MAINTENANCE', 'Maintenance']] }, { name: 'priority', label: 'Priority', type: 'select', options: [['NORMAL', 'Normal'], ['URGENT', 'Urgent']] }, { name: 'note', label: 'Note', type: 'textarea' }], onSubmit: async (v) => { if (await send('post', '/accommodation/housekeeping/tasks', { ...v, roomId: r._id })) { window.UI.toast.success('Task created'); return true; } return false; } }));
  }
})();
