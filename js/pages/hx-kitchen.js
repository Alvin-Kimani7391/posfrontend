/**
 * hx-kitchen.js - Kitchen & bar display (KDS). One screen for chefs, bartenders and the expediter.
 * Tickets are grouped New / Cooking / Ready, oldest first. One big button per ticket moves it forward.
 * Pick a station to see only that station's tickets (kitchen, bar, ...). Beeps when a new ticket arrives.
 * API: GET /restaurant/kitchen/queue, POST /restaurant/kitchen/tickets/:id/bump|expo|priority, PUT .../items/:itemId
 */
(function () {
  const { E, can, get, send, list, head, pill, mins, icon } = window.HX;
  let el, flt = '', closed = new Set(), tickets = [], stations = [], stationId = '', known = new Set(), first = true, sound = true, pending = 0, moved = new Set(), isFull = false;
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
      `<div class="hx-kwrap" id="kwrap"><button type="button" class="hx-kexit" id="kexit" aria-label="Exit full screen"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>Exit full screen</button><div id="kst" class="hx-kstats"></div><div id="stn"></div><div class="hx-kds hx-kcols" id="kds"></div></div>`;
    el.querySelector('#snd').addEventListener('click', (e) => { sound = !sound; e.target.textContent = sound ? 'Sound on' : 'Sound off'; });
    el.querySelector('#full').addEventListener('click', () => setFull(!isFull));
    el.querySelector('#kexit').addEventListener('click', () => setFull(false));
    // Always leave full screen cleanly: Esc, browser "exit fullscreen", or leaving the page.
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && isFull) setFull(false); });
    document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && isFull) setFull(false, true); });
    window.addEventListener('pagehide', () => { if (isFull) setFull(false, true); });
    // One delegated listener set: buttons keep working while columns are repainted.
    const kds = el.querySelector('#kds');
    kds.addEventListener('click', onAction);
    el.querySelector('#kst').addEventListener('click', (e) => { const b = e.target.closest('[data-f]'); if (b) { flt = flt === b.dataset.f ? '' : b.dataset.f; paint(); } });
    el.querySelector('#stn').addEventListener('click', (e) => { const b = e.target.closest('[data-s]'); if (b) { stationId = b.dataset.s; load(true); } });
  }

  /** Full screen = the kitchen board only (sidebar, top bar and nav hidden) + a big Exit button. Uses the browser's real full screen when allowed. */
  function setFull(on, fromBrowser) {
    isFull = !!on;
    document.body.classList.toggle('hx-kds-full', isFull);
    el.querySelector('#kwrap')?.classList.toggle('full', isFull);
    const fb = el.querySelector('#full'); if (fb) fb.textContent = isFull ? 'Exit full screen' : 'Full screen';
    if (isFull) { try { document.documentElement.requestFullscreen?.().catch(() => {}); } catch { /* not allowed: the overlay still works */ } }
    else if (!fromBrowser && document.fullscreenElement) { try { document.exitFullscreen?.().catch(() => {}); } catch { /* ignore */ } }
    window.scrollTo(0, 0);
  }

  async function load(force) {
    force = force === true;
    if (!force && ((document.hidden && !first) || pending)) return;
    const d = await get('/restaurant/kitchen/queue', { branchId: window.HX.branchId(), ...(stationId ? { stationId } : {}) });
    tickets = list(d, 'tickets', 'queue');
    const fresh = tickets.filter((t) => !known.has(t._id) && t.status === 'NEW');
    tickets.forEach((t) => known.add(t._id));
    if (fresh.length && !first && sound) beep();
    if (pending && !force) return; // an action started while we were fetching: keep the optimistic view
    first = false; paint();
  }

  function beep() { try { const c = new (window.AudioContext || window.webkitAudioContext)(), o = c.createOscillator(), g = c.createGain(); o.connect(g); g.connect(c.destination); o.frequency.value = 880; g.gain.value = 0.15; o.start(); o.stop(c.currentTime + 0.25); } catch { /* audio blocked */ } }

  const stOf = (t) => (t.status === 'READY' ? 'READY' : t.overdue ? 'LATE' : t.status === 'PREPARING' ? 'COOK' : 'NEW');
  function paint() {
    el.querySelector('#stn').innerHTML = stations.length > 1 ? `<div class="hx-cats hx-tabs" style="margin-bottom:14px"><button class="hx-chip ${stationId ? '' : 'on'}" data-s="">All stations</button>${stations.map((s) => `<button class="hx-chip ${stationId === s._id ? 'on' : ''}" data-s="${s._id}">${E(s.name)}</button>`).join('')}</div>` : '';
    const cnt = (k) => tickets.filter((t) => stOf(t) === k).length;
    const chips = [['NEW', 'New order', '#64748b', 'bellRing'], ['COOK', 'In kitchen', '#f5a524', 'flame'], ['LATE', 'Delayed', '#ef3b3b', 'clock'], ['READY', 'Ready', '#22a447', 'check']];
    el.querySelector('#kst').innerHTML = chips.map(([k, l, c, ic]) => `<button type="button" class="hx-kstat" style="--c:${c};cursor:pointer;${flt === k ? `outline:3px solid ${c}55` : ''}" data-f="${k}"><i>${icon(ic)}</i>${l}<b>${String(cnt(k)).padStart(2, '0')}</b></button>`).join('');
    // One column per stage, so a new order lands in "New order", then moves to "In kitchen", "Delayed" or "Ready" by itself.
    const oldest = (x, y) => new Date(x.receivedAt || 0) - new Date(y.receivedAt || 0);
    const cols = chips.filter(([k]) => !flt || k === flt);
    const klass = { NEW: 's-new', COOK: 's-cook', LATE: 's-late', READY: 's-ready' };
    el.querySelector('#kds').innerHTML = tickets.length || flt ? cols.map(([k, l, c, ic]) => {
      const rows = tickets.filter((t) => stOf(t) === k).sort(oldest);
      return `<section class="hx-kcol ${klass[k]}" style="--c:${c}" aria-label="${l}"><header><i>${icon(ic)}</i><b>${l}</b><span class="n">${rows.length}</span></header><div class="hx-kcol-body">${rows.map(card).join('') || `<div class="hx-kcol-empty">${k === 'NEW' ? 'New orders appear here' : k === 'LATE' ? 'Nothing is late' : 'Nothing here'}</div>`}</div></section>`;
    }).join('') : `<div class="hx-empty-kds" style="grid-column:1/-1">${window.HX.empty('No tickets', 'New orders from the floor appear here.')}</div>`;
    moved.clear();
  }

  function card(t) {
    const age = t.ageMinutes != null ? t.ageMinutes : mins(t.receivedAt), late = t.overdue, k = stOf(t);
    const where = t.tableName ? 'Table ' + t.tableName : (t.pickupNumber ? 'Pickup ' + t.pickupNumber : (t.orderType || '').replace('_', ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase()));
    const kind = (t.orderType || 'DINE_IN').replace('_', ' ').toLowerCase();
    const items = (t.items || []).filter((i) => !i.cancelled);
    const next = t.status === 'READY' ? null : t.status === 'PREPARING' ? ['READY', 'Mark done'] : ['PREPARING', 'Start cooking'];
    const target = Number(t.targetMinutes || t.prepMinutes || 20), pct = Math.min(100, Math.round((age / (target || 20)) * 100));
    const cls = { NEW: 's-new', COOK: 's-cook', LATE: 's-late', READY: 's-ready' }[k];
    return `<div data-tk="${t._id}" class="hx-tk ${cls} ${moved.has(t._id) ? 'tk-in' : ''} ${t.priority && t.priority !== 'NORMAL' ? 'urgent' : ''}">
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

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const byId = (id) => tickets.find((t) => String(t._id) === String(id));

  /** Instant feedback: the button reacts on press, the ticket slides out, the board updates at once, and the server call
   *  runs in the background. If the server refuses, the ticket snaps back and a message explains why. */
  async function act(btn, apply, request, { leave = true } = {}) {
    if (!btn || btn.disabled) return;
    btn.disabled = true; btn.classList.add('is-busy');
    const cardEl = btn.closest('.hx-tk');
    const snapshot = JSON.parse(JSON.stringify(tickets));
    pending++;
    if (leave && cardEl) cardEl.classList.add('tk-out');
    await sleep(leave ? 170 : 0);
    apply(); paint();
    let ok = false;
    try { ok = await request(); } finally { pending--; }
    if (!ok) { tickets = snapshot; moved.clear(); paint(); return; }
    if (!pending) load(true);
  }

  function onAction(e) {
    const b = e.target.closest('button,[data-item]'); if (!b || !el.contains(b)) return;
    if (b.dataset.bump) {
      const id = b.dataset.bump, to = b.dataset.to;
      act(b, () => { const t = byId(id); if (!t) return; t.status = to; t.overdue = false; if (to === 'READY') (t.items || []).forEach((i) => { if (!i.cancelled) i.status = 'READY'; }); moved.add(t._id); },
        async () => !!(await send('post', `/restaurant/kitchen/tickets/${id}/bump`, { status: to })));
    } else if (b.dataset.expo) {
      const id = b.dataset.expo;
      act(b, () => { tickets = tickets.filter((t) => String(t._id) !== String(id)); },
        async () => !!(await send('post', `/restaurant/kitchen/tickets/${id}/expo`, {})));
    } else if (b.dataset.urgent) {
      const id = b.dataset.urgent, p = b.dataset.p;
      act(b, () => { const t = byId(id); if (t) t.priority = p; },
        async () => !!(await send('post', `/restaurant/kitchen/tickets/${id}/priority`, { priority: p })), { leave: false });
    } else if (b.dataset.item) {
      const [o, i] = b.dataset.item.split(':');
      act(b, () => { tickets.forEach((t) => { if (String(t.orderId) === String(o)) (t.items || []).forEach((x) => { if (String(x.orderItemId) === String(i)) x.status = 'READY'; }); }); },
        async () => !!(await send('put', `/restaurant/kitchen/orders/${o}/items/${i}`, { status: 'READY' })), { leave: false });
    }
  }
})();
