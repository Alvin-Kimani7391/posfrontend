/**
 * hx-housekeeping.js - cleaning and maintenance tasks for housekeepers and supervisors.
 * API: GET/POST /accommodation/housekeeping/tasks, PUT .../tasks/:id {action: assign|start|complete|cancel}
 */
(function () {
  const { E, can, get, send, list, head, pill, formModal, mins } = window.HX;
  let el, tab = 'PENDING,IN_PROGRESS', rooms = [], staff = [];
  const NAME = { DEPARTURE_CLEAN: 'Departure clean', STAYOVER_CLEAN: 'Stayover clean', TURNDOWN: 'Turndown', DEEP_CLEAN: 'Deep clean', INSPECTION: 'Inspection', MAINTENANCE: 'Maintenance', REQUEST: 'Guest request' };
  document.addEventListener('DOMContentLoaded', init);
  async function init() {
    el = window.HX.mount('Housekeeping'); if (!el) return; await window.AppShell.whenProfileReady?.();
    if (can('accommodation.housekeeping.manage')) await loadLookups();
    window.HX.live(paint, 30000); paint();
  }

  async function loadLookups() {
    const [b, e] = await Promise.all([get('/accommodation/board', { branchId: window.HX.branchId() }), get('/employees', { limit: 100 })]);
    rooms = (b && b.rooms) || []; staff = list(e, 'employees').filter((x) => x.role === 'HOUSEKEEPER' && x.status !== 'inactive');
  }

  async function paint() {
    if (document.querySelector('.modal-backdrop')) return;
    const mine = !can('accommodation.housekeeping.manage');
    const d = await get('/accommodation/housekeeping/tasks', { branchId: window.HX.branchId(), status: tab });
    const rows = list(d, 'tasks');
    el.innerHTML = head('Housekeeping', mine ? 'Your rooms to clean today.' : 'Assign rooms and follow progress.', `${!mine ? '<button class="btn btn-primary" id="nt">New task</button>' : ''}<span class="hx-live">Live</span>`) + window.HX.tabs([['PENDING,IN_PROGRESS', 'To do'], ['DONE', 'Done']], tab) +
      (rows.length ? `<div class="hx-card flush">${rows.map((t) => `<div class="hx-row"><div class="grow"><b>Room ${E(t.roomNumber || (t.roomId && t.roomId.number) || '')} · ${E(NAME[t.type] || t.type)}</b><small class="hx-sub">${(t.assignedName || t.assignedToName) ? E(t.assignedName || t.assignedToName) : 'Unassigned'}${t.note ? ' · ' + E(t.note) : ''}${t.createdAt ? ' · ' + mins(t.createdAt) + ' min ago' : ''}</small></div>${t.priority === 'URGENT' ? pill('urgent', 'bad') : ''}${pill(t.status, { PENDING: 'warn', IN_PROGRESS: 'busy', DONE: 'ok', CANCELLED: 'mute' }[t.status])}
        ${can('accommodation.housekeeping.update') && t.status !== 'DONE' && t.status !== 'CANCELLED' ? `<span class="hx-actions">${t.status === 'PENDING' ? `<button class="btn btn-sm btn-secondary" data-a="start" data-id="${t._id}">Start</button>` : ''}<button class="btn btn-sm btn-primary" data-a="complete" data-id="${t._id}">Done</button>${!mine ? `<button class="btn btn-sm btn-secondary" data-a="assign" data-id="${t._id}">Assign</button>` : ''}</span>` : ''}</div>`).join('')}</div>` : window.HX.empty(tab === 'DONE' ? 'Nothing finished yet' : 'All caught up', 'Cleaning tasks appear when guests check out or a task is added.'));
    el.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => { tab = b.dataset.tab; paint(); }));
    el.querySelectorAll('[data-a]').forEach((b) => b.addEventListener('click', () => (b.dataset.a === 'assign' ? assign(b.dataset.id) : act(b.dataset.id, { action: b.dataset.a }))));
    el.querySelector('#nt')?.addEventListener('click', newTask);
  }
  async function act(id, body) { if (await send('put', '/accommodation/housekeeping/tasks/' + id, body)) paint(); }
  function assign(id) { if (!staff.length) return window.UI.toast.info('No housekeepers yet. Add an employee with the Housekeeper role in Employees (or Services & system check > Staff).'); formModal({ title: 'Assign to', maxWidth: '380px', fields: [{ name: 'assignedTo', label: 'Housekeeper', type: 'select', options: staff.map((s) => [s._id, s.name || s.employeeCode]) }], onSubmit: async (v) => { await act(id, { action: 'assign', assignedTo: v.assignedTo }); return true; } }); }
  async function newTask() {
    if (!rooms.length) await loadLookups();
    if (!rooms.length) return window.UI.toast.warning('There are no rooms yet. Add rooms first (Setup guide > Accommodation).');
    formModal({ title: 'New task', fields: [{ name: 'roomId', label: 'Room', type: 'select', options: rooms.map((r) => [r._id, `Room ${r.number}`]) }, { row: [{ name: 'type', label: 'Type', type: 'select', options: Object.entries(NAME) }, { name: 'priority', label: 'Priority', type: 'select', options: [['NORMAL', 'Normal'], ['URGENT', 'Urgent']] }] }, { name: 'assignedTo', label: 'Assign to', type: 'select', options: [['', 'Anyone'], ...staff.map((s) => [s._id, s.name || s.employeeCode])] }, { name: 'note', label: 'Note', type: 'textarea' }], onSubmit: async (v) => { if (await send('post', '/accommodation/housekeeping/tasks', v)) { paint(); return true; } return false; } });
  }
})();
