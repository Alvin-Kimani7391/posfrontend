/**
 * hx-rooms.js - Room board. Every room as a tile: occupied, ready, dirty, out of order, arriving, due out.
 * API: GET /accommodation/board, POST /accommodation/rooms/:id/status|housekeeping, POST /accommodation/housekeeping/tasks
 */
(function () {
  const { E, can, get, send, list, head, pill, formModal, hm } = window.HX;
  let el, rooms = [], summary = {}, filter = '', roomTypes = [];
  document.addEventListener('DOMContentLoaded', init);
  async function init() { el = window.HX.mount('Room board'); if (!el) return; await window.AppShell.whenProfileReady?.(); window.HX.live(load, 30000); load(); loadTypes(); }
  async function loadTypes() { const d = await get('/accommodation/room-types'); roomTypes = (d && (d.roomTypes || (d.data && d.data.roomTypes))) || list(d, 'roomTypes'); }

  async function load() {
    const d = await get('/accommodation/board', { branchId: window.HX.branchId() });
    if (!d) { el.innerHTML = head('Room board') + window.HX.empty('Room board is not available', 'Check that accommodation is switched on.'); return; }
    rooms = d.rooms || []; summary = d.summary || {}; paint();
  }
  const state = (r) => (r.inHouse ? ['Occupied', 'busy'] : r.status === 'OUT_OF_ORDER' ? ['Out of order', 'bad'] : r.sellable ? ['Ready', 'ok'] : ['Needs cleaning', 'warn']);

  function paint() {
    const f = rooms.filter((r) => !filter || (filter === 'occupied' ? r.inHouse : filter === 'ready' ? !r.inHouse && r.sellable : filter === 'dirty' ? !r.inHouse && r.status === 'AVAILABLE' && !r.sellable : r.status === 'OUT_OF_ORDER'));
    const chips = [['', `All · ${summary.total || rooms.length}`], ['occupied', `Occupied · ${summary.occupied || 0}`], ['ready', `Ready · ${summary.vacantReady || 0}`], ['dirty', `Needs cleaning · ${summary.vacantDirty || 0}`], ['ooo', `Out of order · ${summary.outOfOrder || 0}`]];
    el.innerHTML = head('Room board', 'Tap a room for its details and actions.', (can('accommodation.rooms.manage') ? '<button class="btn btn-primary" id="new-room">+ New room</button><button class="btn btn-secondary" id="new-type">+ Room type</button><button class="btn btn-secondary" id="deals">Room deals</button>' : '') + '<span class="hx-live">Live</span>') + `<div class="hx-cats hx-tabs">${chips.map(([k, l]) => `<button class="hx-chip ${k === filter ? 'on' : ''}" data-f="${k}">${l}</button>`).join('')}</div>` +
      (f.length ? `<div class="hx-rooms">${f.map((r) => { const [s, t] = state(r); return `<button class="hx-room hx-st-${t}" data-r="${r._id}"><span class="bedwrap">${r.images && r.images[0] ? `<img src="${E(r.images[0])}" alt="" loading="lazy" style="width:100%;height:100%;object-fit:cover;border-radius:8px">` : window.HX.art.bed(r.roomType)}</span><span class="no"><span>${E(r.number)}</span>${pill(s, t)}</span><span class="ty">${E(r.roomType || '')}${r.floor ? ' · floor ' + E(r.floor) : ''}</span><span class="who">${r.inHouse ? E(r.inHouse.guest && r.inHouse.guest.name) : r.arrivingToday ? 'Arriving today' : ''}${r.dueOutToday ? (r.inHouse ? ' · due out' : 'Due out') : ''}</span></button>`; }).join('')}</div>` : window.HX.empty('No rooms', 'Add rooms in the Setup guide.'));
    el.querySelectorAll('[data-f]').forEach((b) => b.addEventListener('click', () => { filter = b.dataset.f; paint(); }));
    el.querySelectorAll('[data-r]').forEach((b) => b.addEventListener('click', () => open(rooms.find((x) => x._id === b.dataset.r))));
  }

  function open(r) {
    const [s, t] = state(r), st = r.inHouse || r.nextArrival;
    const m = window.UI.openModal({ title: `Room ${r.number}`, maxWidth: '440px', bodyHtml: `<p>${pill(s, t)} <span class="hx-sub">${E(r.roomType || '')}${r.floor ? ' · floor ' + E(r.floor) : ''}</span></p><p class="hx-sub">Housekeeping: ${E((r.housekeeping || '').toLowerCase())}</p>
      ${photosHtml(r)}
      ${st ? `<div class="hx-card" style="margin:var(--space-3) 0"><b>${E(st.guest && st.guest.name)}</b><br><small class="hx-sub">${r.inHouse ? 'In house' : 'Next arrival'} · ${E(st.bookingCode)}</small><br><a href="hx-stays.html#stay=${st._id}">Open booking</a></div>` : ''}
      <div style="display:grid;gap:var(--space-2)">${can('accommodation.housekeeping.update') ? `<button class="btn btn-secondary" data-hk="DIRTY">Mark dirty</button><button class="btn btn-secondary" data-hk="CLEAN">Mark clean</button>${can('accommodation.housekeeping.manage') ? '<button class="btn btn-secondary" data-hk="INSPECTED">Mark inspected</button>' : ''}` : ''}
      ${can('accommodation.rooms.status') && !r.inHouse ? (r.status === 'OUT_OF_ORDER' ? '<button class="btn btn-primary" data-st="AVAILABLE">Back in service</button>' : '<button class="btn btn-secondary" data-st="OUT_OF_ORDER">Take out of service</button>') : ''}
      ${can('accommodation.housekeeping.manage') ? '<button class="btn btn-secondary" id="tk">Create cleaning task</button>' : ''}</div>` });
    m.querySelector('#rp')?.addEventListener('click', () => pickPhotos(r));
    m.querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', async () => { if (await send('put', `/accommodation/rooms/${r._id}`, { images: (r.images || []).filter((u) => u !== b.dataset.rm) })) { window.UI.toast.success('Photo removed'); window.UI.closeModal(); load(); } }));
    m.querySelectorAll('[data-hk]').forEach((b) => b.addEventListener('click', async () => { if (await send('post', `/accommodation/rooms/${r._id}/housekeeping`, { housekeeping: b.dataset.hk })) { window.UI.closeModal(); load(); } }));
    m.querySelectorAll('[data-st]').forEach((b) => b.addEventListener('click', async () => { const reason = b.dataset.st === 'OUT_OF_ORDER' ? await window.HX.ask('Out of service', 'What is wrong?') : ''; if (b.dataset.st === 'OUT_OF_ORDER' && !reason) return; if (await send('post', `/accommodation/rooms/${r._id}/status`, { status: b.dataset.st, ...(reason ? { reason } : {}) })) { window.UI.closeModal(); load(); } }));
    m.querySelector('#tk')?.addEventListener('click', () => formModal({ title: `Task for room ${r.number}`, maxWidth: '400px', fields: [{ name: 'type', label: 'Type', type: 'select', options: [['DEPARTURE_CLEAN', 'Departure clean'], ['STAYOVER_CLEAN', 'Stayover clean'], ['TURNDOWN', 'Turndown'], ['DEEP_CLEAN', 'Deep clean'], ['INSPECTION', 'Inspection'], ['MAINTENANCE', 'Maintenance']] }, { name: 'priority', label: 'Priority', type: 'select', options: [['NORMAL', 'Normal'], ['URGENT', 'Urgent']] }, { name: 'note', label: 'Note', type: 'textarea' }], onSubmit: async (v) => { if (await send('post', '/accommodation/housekeeping/tasks', { ...v, roomId: r._id })) { window.UI.toast.success('Task created'); return true; } return false; } }));
  }

  /* Deals shown to guests on the QR page: pick a room type, set a percentage off and the dates. */
  async function dealsDialog() {
    const d = await get('/accommodation/room-types'); const types = (d && (d.roomTypes || d.data && d.data.roomTypes)) || [];
    if (!types.length) return window.UI.toast.info('Create a room type first');
    const m = window.UI.openModal({ title: 'Room deals for guests', maxWidth: '520px', bodyHtml: `<p class="hx-sub">Guests scanning a QR code see these deals with live availability. Reception confirms the price when they enquire.</p>${types.map((t) => { const p = t.promo || {}; return `<div class="hx-row"><div class="grow"><b>${E(t.name)}</b><small class="hx-sub">${p.active && p.percentOff ? E(p.title || '') + ' · ' + p.percentOff + '% off' + (p.validTo ? ' until ' + E(p.validTo) : '') : 'No deal'}</small></div><button class="btn btn-sm btn-secondary" data-t="${t._id}">${p.active ? 'Edit' : 'Add deal'}</button></div>`; }).join('')}` });
    m.querySelectorAll('[data-t]').forEach((b) => b.addEventListener('click', () => {
      const t = types.find((x) => x._id === b.dataset.t), p = t.promo || {};
      formModal({ title: 'Deal: ' + t.name, submitText: 'Save deal', fields: [
        { name: 'active', label: 'Show this deal to guests', type: 'checkbox', value: !!p.active },
        { name: 'title', label: 'Deal name', value: p.title || '', placeholder: 'Weekend escape' },
        { name: 'percentOff', label: 'Percent off', type: 'number', min: 0, max: 90, value: p.percentOff || 10 },
        { name: 'description', label: 'Details (optional)', type: 'textarea', value: p.description || '', placeholder: 'Free breakfast included' },
        { row: [{ name: 'validFrom', label: 'From', type: 'date', value: p.validFrom || '' }, { name: 'validTo', label: 'Until', type: 'date', value: p.validTo || '' }] },
      ], onSubmit: async (v) => { if (await send('put', `/accommodation/room-types/${t._id}`, { promo: { active: !!v.active, title: v.title || '', percentOff: v.percentOff || 0, description: v.description || '', validFrom: v.validFrom || '', validTo: v.validTo || '' } })) { window.UI.toast.success('Deal saved'); return true; } return false; } });
    }));
  }
  /** Add one room (or a run such as 101-110). Uses the same endpoint as the Setup guide. */
  function newType() {
    formModal({ title: 'Add a room type', maxWidth: '440px', submitText: 'Add room type', intro: 'A room type groups rooms that share a rate, such as Standard Double.', fields: [
      { name: 'name', label: 'Name', required: true, placeholder: 'Standard double' },
      { row: [{ name: 'baseRate', label: 'Rate per night', type: 'number', required: true, min: 0, step: '0.01' }, { name: 'maxAdults', label: 'Max adults', type: 'number', value: 2, min: 1 }] },
      { name: 'images', label: 'Room photos (optional)', type: 'images', hint: 'Guests see these when they book online.' },
    ], onSubmit: async (v) => {
      let urls = []; if (v.images && v.images.length) { try { urls = await window.HX.uploadImages(v.images); } catch (e) { window.UI.toast.error((e && e.message) || 'Could not upload the photos'); return false; } }
      const { images, ...rest } = v;
      if (!await send('post', '/accommodation/room-types', { ...rest, ...(urls.length ? { images: urls } : {}) })) return false;
      window.UI.toast.success('Room type added'); loadTypes(); return true;
    } });
  }
  /** Photos of one room: shown in its dialog, can be added to or removed by whoever manages rooms. */
  const photosHtml = (r) => `<div style="margin:var(--space-2) 0"><div style="display:flex;flex-wrap:wrap;gap:8px">${(r.images || []).map((u) => `<span style="position:relative"><img src="${E(u)}" alt="" style="width:72px;height:72px;object-fit:cover;border-radius:8px">${can('accommodation.rooms.manage') ? `<button type="button" data-rm="${E(u)}" aria-label="Remove photo" style="position:absolute;top:-6px;right:-6px;border:0;border-radius:50%;width:22px;height:22px;background:#111;color:#fff;cursor:pointer">×</button>` : ''}</span>`).join('')}</div>${can('accommodation.rooms.manage') ? `<button class="btn btn-sm btn-secondary" id="rp" style="margin-top:6px">${(r.images || []).length ? '+ Add photos' : '+ Add room photos'}</button>` : ''}</div>`;
  function pickPhotos(r) {
    const i = document.createElement('input'); i.type = 'file'; i.accept = 'image/jpeg,image/png,image/webp'; i.multiple = true;
    i.onchange = async () => {
      const fs = [...i.files].filter((f) => f.size <= 5 * 1024 * 1024).slice(0, 8); if (!fs.length) return window.UI.toast.warning('Choose JPG, PNG or WEBP photos under 5 MB');
      try { const urls = await window.HX.uploadImages(fs); if (await send('put', `/accommodation/rooms/${r._id}`, { images: [...(r.images || []), ...urls].slice(0, 8) })) { window.UI.toast.success('Photos saved'); window.UI.closeModal(); load(); } }
      catch (e) { window.UI.toast.error((e && e.message) || 'Could not upload the photos'); }
    }; i.click();
  }
  async function newRoom() {
    if (!roomTypes.length) await loadTypes();
    if (!roomTypes.length) return window.UI.toast.info('Create a room type first (Setup guide → Add a room type)');
    const expand = (text) => { const out = []; String(text).split(',').map((x) => x.trim()).filter(Boolean).forEach((p) => { const m = p.match(/^(\d+)\s*-\s*(\d+)$/); if (m && +m[2] >= +m[1] && +m[2] - +m[1] < 200) for (let n = +m[1]; n <= +m[2]; n++) out.push(String(n)); else out.push(p); }); return Array.from(new Set(out)).slice(0, 200); };
    formModal({ title: 'Add a room', maxWidth: '440px', submitText: 'Add room', intro: 'One room number, or several separated by commas or as a range, like 101-110.', fields: [
      { name: 'roomTypeId', label: 'Room type', type: 'select', options: roomTypes.map((t) => [t._id, t.name]) },
      { row: [{ name: 'numbers', label: 'Room number(s)', required: true, placeholder: '105' }, { name: 'floor', label: 'Floor (optional)' }] },
      { name: 'images', label: 'Room photos (optional)', type: 'images', hint: 'Guests see these when they book online. With several rooms they all get the same photos.' },
    ], onSubmit: async (v) => {
      const numbers = expand(v.numbers); if (!numbers.length) { window.UI.toast.warning('Enter at least one room number'); return false; }
      const dup = numbers.filter((n) => rooms.some((r) => String(r.number) === n)); if (dup.length) { window.UI.toast.warning(`Room ${dup.join(', ')} already exists`); return false; }
      let urls = []; if (v.images && v.images.length) { try { urls = await window.HX.uploadImages(v.images); } catch (e) { window.UI.toast.error((e && e.message) || 'Could not upload the photos'); return false; } }
      const r = await send('post', '/accommodation/rooms/bulk', { branchId: window.HX.branchId(), roomTypeId: v.roomTypeId, numbers, ...(v.floor ? { floor: v.floor } : {}), ...(urls.length ? { images: urls } : {}) });
      if (!r) return false; window.UI.toast.success(numbers.length > 1 ? `${numbers.length} rooms added` : `Room ${numbers[0]} added`); load(); return true;
    } });
  }
  document.addEventListener('click', (e) => { const b = e.target && e.target.closest && e.target.closest('#deals, #new-room, #new-type'); if (!b) return; if (b.id === 'deals') dealsDialog(); else if (b.id === 'new-type') newType(); else newRoom(); });
})();
