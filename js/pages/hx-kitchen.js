/**
 * hx-kitchen.js - Kitchen & bar display (KDS). One screen for chefs, bartenders and the expediter.
 * Tickets are grouped New / Cooking / Ready, oldest first. One big button per ticket moves it forward.
 * Pick a station to see only that station's tickets (kitchen, bar, ...). Beeps when a new ticket arrives.
 * API: GET /restaurant/kitchen/queue, POST /restaurant/kitchen/tickets/:id/bump|expo|priority, PUT .../items/:itemId
 */
(function () {
  const { E, can, get, send, list, head, pill, mins } = window.HX;
  let el, closed = new Set(), tickets = [], stations = [], stationId = '', known = new Set(), first = true, sound = true;
  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    el = window.HX.mount('Kitchen & bar');
    if (!el) return;
    await window.AppShell.whenProfileReady?.();
    const s = await get('/restaurant/stations', { branchId: window.HX.branchId() }); stations = list(s, 'stations');
    shell(); window.HX.live(load, 8000); load();
  }

  function shell() {
    el.innerHTML = head('Kitchen & bar', 'Oldest tickets first. Tap the button on a ticket to move it along.',
      `<button class="btn btn-secondary" id="xall">Collapse all</button><button class="btn btn-secondary" id="snd">Sound on</button><button class="btn btn-secondary" id="full">Full screen</button><span class="hx-live">Live</span>`) +
      `<div id="stn"></div><div class="hx-kds" id="kds"></div>`;
    el.querySelector('#xall').addEventListener('click', (e) => { const collapse = e.target.textContent === 'Collapse all'; closed = collapse ? new Set(tickets.map((t) => t._id)) : new Set(); e.target.textContent = collapse ? 'Expand all' : 'Collapse all'; paint(); });
    el.addEventListener('click', (e) => { const h = e.target.closest('[data-tk]'); if (!h || e.target.closest('button,a')) return; setTimeout(() => { if (h.classList.contains('open')) closed.delete(h.dataset.tk); else closed.add(h.dataset.tk); }, 0); });
    el.querySelector('#snd').addEventListener('click', (e) => { sound = !sound; e.target.textContent = sound ? 'Sound on' : 'Sound off'; });
    el.querySelector('#full').addEventListener('click', () => { const k = el.querySelector('#kds'); k.classList.toggle('full'); document.body.style.overflow = k.classList.contains('full') ? 'hidden' : ''; });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { el.querySelector('#kds')?.classList.remove('full'); document.body.style.overflow = ''; } });
  }

  async function load() {
    if (document.hidden && !first) return;
    const d = await get('/restaurant/kitchen/queue', { branchId: window.HX.branchId(), ...(stationId ? { stationId } : {}) });
    tickets = list(d, 'tickets', 'queue');
    const fresh = tickets.filter((t) => !known.has(t._id) && t.status === 'NEW');
    tickets.forEach((t) => known.add(t._id));
    if (fresh.length && !first && sound) beep();
    first = false; paint();
  }

  function beep() { try { const c = new (window.AudioContext || window.webkitAudioContext)(), o = c.createOscillator(), g = c.createGain(); o.connect(g); g.connect(c.destination); o.frequency.value = 880; g.gain.value = 0.15; o.start(); o.stop(c.currentTime + 0.25); } catch { /* audio blocked */ } }

  function paint() {
    el.querySelector('#stn').innerHTML = stations.length > 1 ? `<div class="hx-cats hx-tabs"><button class="hx-chip ${stationId ? '' : 'on'}" data-s="">All stations</button>${stations.map((s) => `<button class="hx-chip ${stationId === s._id ? 'on' : ''}" data-s="${s._id}">${E(s.name)}</button>`).join('')}</div>` : '';
    el.querySelectorAll('[data-s]').forEach((b) => b.addEventListener('click', () => { stationId = b.dataset.s; load(); }));
    const cols = [['NEW', 'New', ['NEW', 'ACCEPTED']], ['PREPARING', 'Cooking', ['PREPARING']], ['READY', 'Ready', ['READY']]];
    el.querySelector('#kds').innerHTML = cols.map(([k, label, sts]) => {
      const t = tickets.filter((x) => sts.includes(x.status));
      return `<div class="hx-kds-col"><h3>${label} · ${t.length}</h3>${t.map(card).join('') || '<p class="hx-sub" style="text-align:center;padding:var(--space-4)">Nothing here</p>'}</div>`;
    }).join('');
    el.querySelectorAll('[data-bump]').forEach((b) => b.addEventListener('click', () => bump(b.dataset.bump, b.dataset.to)));
    el.querySelectorAll('[data-expo]').forEach((b) => b.addEventListener('click', async () => { if (await send('post', `/restaurant/kitchen/tickets/${b.dataset.expo}/expo`, {})) load(); }));
    el.querySelectorAll('[data-urgent]').forEach((b) => b.addEventListener('click', async () => { if (await send('post', `/restaurant/kitchen/tickets/${b.dataset.urgent}/priority`, { priority: b.dataset.p })) load(); }));
    el.querySelectorAll('[data-item]').forEach((b) => b.addEventListener('click', async () => { const [o, i] = b.dataset.item.split(':'); if (await send('put', `/restaurant/kitchen/orders/${o}/items/${i}`, { status: 'READY' })) load(); }));
  }

  function card(t) {
    const age = t.ageMinutes != null ? t.ageMinutes : mins(t.receivedAt), late = t.overdue;
    const where = t.tableName ? 'Table ' + t.tableName : (t.pickupNumber ? 'Pickup ' + t.pickupNumber : (t.orderType || '').replace('_', ' ').toLowerCase());
    const open = !closed.has(t._id); const next = t.status === 'READY' ? null : t.status === 'PREPARING' ? ['READY', 'Mark ready'] : ['PREPARING', 'Start cooking'];
    return `<div class="hx-tk ${late ? 'late' : ''} ${t.priority && t.priority !== 'NORMAL' ? 'urgent' : ''}">
      <div class="hx-tk-top hx-xhead ${open ? 'open' : ''}" data-xtoggle data-tk="${t._id}"><span class="hx-caret"></span><b>${E(where)}</b><span class="hx-tk-sum">${(t.items || []).filter((i) => !i.cancelled).length} item(s)</span><span class="hx-tk-age ${late ? 'late' : ''}">${age} min</span></div><div class="hx-xbody ${open ? 'open' : ''}">
      <small class="hx-sub">#${E(t.orderNumber || t.ticketNumber)} · ${E(t.stationName || '')}${t.waiterName ? ' · ' + E(t.waiterName) : ''}</small>
      ${t.allergyAlert ? '<div class="al" style="color:var(--color-danger);font-weight:600;margin-top:4px">Allergy alert</div>' : ''}
      ${(t.items || []).filter((i) => !i.cancelled).map((i) => `<div class="hx-tk-item ${i.status === 'READY' || i.status === 'SERVED' ? 'done' : ''}" ${t.status === 'PREPARING' && i.status !== 'READY' ? `data-item="${t.orderId}:${i.orderItemId}" style="cursor:pointer"` : ''}>
        <span class="q">${i.quantity}×</span><span><b>${E(i.name)}</b>${i.variantName ? ' · ' + E(i.variantName) : ''}${i.modifiersText ? `<small>${E(i.modifiersText)}</small>` : ''}${i.notes ? `<small>“${E(i.notes)}”</small>` : ''}${i.allergyNotes ? `<small class="al">Allergy: ${E(i.allergyNotes)}</small>` : ''}</span></div>`).join('')}
      ${t.notes ? `<small class="hx-sub">${E(t.notes)}</small>` : ''}
      ${next && can('restaurant.kitchen.update') ? `<button class="btn btn-primary" data-bump="${t._id}" data-to="${next[0]}">${next[1]}</button>` : ''}
      ${t.status === 'READY' && can('restaurant.kitchen.expedite') ? `<button class="btn btn-success" data-expo="${t._id}">Handed to waiter</button>` : ''}
      ${t.status === 'READY' && !can('restaurant.kitchen.expedite') ? '<small class="hx-sub">Waiting for the waiter</small>' : ''}
      ${can('restaurant.kitchen.expedite') && t.status !== 'READY' ? `<button class="btn btn-sm btn-secondary" data-urgent="${t._id}" data-p="${t.priority === 'NORMAL' || !t.priority ? 'URGENT' : 'NORMAL'}" style="margin-top:var(--space-2)">${t.priority === 'NORMAL' || !t.priority ? 'Mark urgent' : 'Remove urgent'}</button>` : ''}
      </div>
    </div>`;
  }

  async function bump(id, to) { if (await send('post', `/restaurant/kitchen/tickets/${id}/bump`, { status: to })) load(); }
})();
