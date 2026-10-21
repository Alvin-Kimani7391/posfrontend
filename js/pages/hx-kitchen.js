/**
 * hx-kitchen.js - Kitchen & bar display (KDS). One screen for chefs, bartenders and the expediter.
 * Tickets are grouped New / Cooking / Ready, oldest first. One big button per ticket moves it forward.
 * Pick a station to see only that station's tickets (kitchen, bar, ...). Beeps when a new ticket arrives.
 * API: GET /restaurant/kitchen/queue, POST /restaurant/kitchen/tickets/:id/bump|expo|priority, PUT .../items/:itemId
 */
(function () {
  const { E, can, get, send, list, head, pill, mins, icon } = window.HX;
  let el, flt = '', closed = new Set(), tickets = [], stations = [], stationId = '', known = new Set(), first = true, sound = true;
  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    el = window.HX.mount('Kitchen & bar');
    if (!el) return;
    await window.AppShell.whenProfileReady?.();
    const s = await get('/restaurant/stations', { branchId: window.HX.branchId() }); stations = list(s, 'stations');
    shell(); window.HX.live(load, 8000); load();
  }

  function shell() {
    el.innerHTML = head('Kitchen & bar', 'Each stage has its own column, oldest tickets first. Tap the button on a ticket to move it along.',
      `<button class="btn btn-secondary" id="snd">Sound on</button><button class="btn btn-secondary" id="full">Full screen</button><span class="hx-live">Live</span>`) +
      `<div id="kst" class="hx-kstats"></div><div id="stn"></div><div class="hx-kds hx-kcols" id="kds"></div>`;
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

  const stOf = (t) => (t.status === 'READY' ? 'READY' : t.overdue ? 'LATE' : t.status === 'PREPARING' ? 'COOK' : 'NEW');
  function paint() {
    el.querySelector('#stn').innerHTML = stations.length > 1 ? `<div class="hx-cats hx-tabs" style="margin-bottom:14px"><button class="hx-chip ${stationId ? '' : 'on'}" data-s="">All stations</button>${stations.map((s) => `<button class="hx-chip ${stationId === s._id ? 'on' : ''}" data-s="${s._id}">${E(s.name)}</button>`).join('')}</div>` : '';
    el.querySelectorAll('[data-s]').forEach((b) => b.addEventListener('click', () => { stationId = b.dataset.s; load(); }));
    const cnt = (k) => tickets.filter((t) => stOf(t) === k).length;
    const chips = [['NEW', 'New order', '#64748b', 'bellRing'], ['COOK', 'In kitchen', '#f5a524', 'flame'], ['LATE', 'Delayed', '#ef3b3b', 'clock'], ['READY', 'Ready', '#22a447', 'check']];
    el.querySelector('#kst').innerHTML = chips.map(([k, l, c, ic]) => `<button type="button" class="hx-kstat" style="--c:${c};cursor:pointer;${flt === k ? `outline:3px solid ${c}55` : ''}" data-f="${k}"><i>${icon(ic)}</i>${l}<b>${String(cnt(k)).padStart(2, '0')}</b></button>`).join('');
    el.querySelectorAll('[data-f]').forEach((b) => b.addEventListener('click', () => { flt = flt === b.dataset.f ? '' : b.dataset.f; paint(); }));
    // One column per stage, so a new order lands in "New order", then moves to "In kitchen", "Delayed" or "Ready" by itself.
    const oldest = (x, y) => new Date(x.receivedAt || 0) - new Date(y.receivedAt || 0);
    const cols = chips.filter(([k]) => !flt || k === flt);
    const klass = { NEW: 's-new', COOK: 's-cook', LATE: 's-late', READY: 's-ready' };
    el.querySelector('#kds').innerHTML = tickets.length || flt ? cols.map(([k, l, c, ic]) => {
      const rows = tickets.filter((t) => stOf(t) === k).sort(oldest);
      return `<section class="hx-kcol ${klass[k]}" style="--c:${c}" aria-label="${l}"><header><i>${icon(ic)}</i><b>${l}</b><span class="n">${rows.length}</span></header><div class="hx-kcol-body">${rows.map(card).join('') || `<div class="hx-kcol-empty">${k === 'NEW' ? 'New orders appear here' : k === 'LATE' ? 'Nothing is late' : 'Nothing here'}</div>`}</div></section>`;
    }).join('') : `<div class="hx-empty-kds" style="grid-column:1/-1">${window.HX.empty('No tickets', 'New orders from the floor appear here.')}</div>`;
    el.querySelectorAll('[data-bump]').forEach((b) => b.addEventListener('click', () => bump(b.dataset.bump, b.dataset.to)));
    el.querySelectorAll('[data-expo]').forEach((b) => b.addEventListener('click', async () => { if (await send('post', `/restaurant/kitchen/tickets/${b.dataset.expo}/expo`, {})) load(); }));
    el.querySelectorAll('[data-urgent]').forEach((b) => b.addEventListener('click', async () => { if (await send('post', `/restaurant/kitchen/tickets/${b.dataset.urgent}/priority`, { priority: b.dataset.p })) load(); }));
    el.querySelectorAll('[data-item]').forEach((b) => b.addEventListener('click', async () => { const [o, i] = b.dataset.item.split(':'); if (await send('put', `/restaurant/kitchen/orders/${o}/items/${i}`, { status: 'READY' })) load(); }));
  }

  function card(t) {
    const age = t.ageMinutes != null ? t.ageMinutes : mins(t.receivedAt), late = t.overdue, k = stOf(t);
    const where = t.tableName ? 'Table ' + t.tableName : (t.pickupNumber ? 'Pickup ' + t.pickupNumber : (t.orderType || '').replace('_', ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase()));
    const kind = (t.orderType || 'DINE_IN').replace('_', ' ').toLowerCase();
    const items = (t.items || []).filter((i) => !i.cancelled);
    const next = t.status === 'READY' ? null : t.status === 'PREPARING' ? ['READY', 'Mark done'] : ['PREPARING', 'Start cooking'];
    const target = Number(t.targetMinutes || t.prepMinutes || 20), pct = Math.min(100, Math.round((age / (target || 20)) * 100));
    const cls = { NEW: 's-new', COOK: 's-cook', LATE: 's-late', READY: 's-ready' }[k];
    return `<div class="hx-tk ${cls} ${t.priority && t.priority !== 'NORMAL' ? 'urgent' : ''}">
      <div class="hd"><span class="av">${icon(t.orderType === 'DELIVERY' ? 'bike' : t.orderType === 'TAKEAWAY' || t.orderType === 'PICKUP' ? 'bag' : 'utensils')}</span><div class="wh"><b>${E(where)}</b><small>${E(kind)}${t.waiterName ? ' · ' + E(t.waiterName) : ''}</small></div><span class="no">${E(String(t.orderNumber || t.ticketNumber || '').replace(/^#?/, '#'))}</span></div>
      <div class="tm"><span>${t.stationName ? E(t.stationName) + ' · ' : ''}${items.length} item${items.length === 1 ? '' : 's'}</span><span>${window.HX.hm(t.receivedAt)}</span></div>
      ${t.allergyAlert ? '<div class="al-top">Allergy alert on this order</div>' : ''}
      <div class="bd">${items.map((i) => `<div class="hx-tk-item ${i.status === 'READY' || i.status === 'SERVED' ? 'done' : ''}" ${t.status === 'PREPARING' && i.status !== 'READY' ? `data-item="${t.orderId}:${i.orderItemId}" style="cursor:pointer" title="Tap when this item is ready"` : ''}><span class="vd"></span><span><b>${E(i.name)}</b>${i.variantName ? ' · ' + E(i.variantName) : ''}${i.modifiersText ? `<small>${E(i.modifiersText)}</small>` : ''}${i.notes ? `<small>Notes: ${E(i.notes)}</small>` : ''}${i.allergyNotes ? `<small class="al">Allergy: ${E(i.allergyNotes)}</small>` : ''}</span><span class="q">×${i.quantity}</span></div>`).join('')}${t.notes ? `<small class="hx-sub">${E(t.notes)}</small>` : ''}</div>
      <div class="prog"><span class="tr"><i style="width:${t.status === 'READY' ? 100 : pct}%"></i></span><span>${age} min</span></div>
      ${late ? `<div class="late-note">Delayed by ${Math.max(1, age - target)} min</div>` : t.status === 'READY' ? '<div class="ok-note">Ready to serve</div>' : ''}
      <div class="ac">
        ${next && can('restaurant.kitchen.update') ? `<button class="btn btn-primary" data-bump="${t._id}" data-to="${next[0]}">${next[1]}</button>` : ''}
        ${t.status === 'READY' && can('restaurant.kitchen.expedite') ? `<button class="btn btn-success" data-expo="${t._id}">Handed to waiter</button>` : ''}
        ${t.status === 'READY' && !can('restaurant.kitchen.expedite') ? '<small class="hx-sub">Waiting for the waiter</small>' : ''}
        ${can('restaurant.kitchen.expedite') && t.status !== 'READY' ? `<button class="btn btn-secondary" data-urgent="${t._id}" data-p="${t.priority === 'NORMAL' || !t.priority ? 'URGENT' : 'NORMAL'}">${t.priority === 'NORMAL' || !t.priority ? 'Mark urgent' : 'Remove urgent'}</button>` : ''}
      </div></div>`;
  }

  async function bump(id, to) { if (await send('post', `/restaurant/kitchen/tickets/${id}/bump`, { status: to })) load(); }
})();
