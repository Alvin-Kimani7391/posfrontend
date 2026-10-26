/**
 * hx-guest.js - guests who order from their phone: requests to confirm, service calls, and QR codes to print.
 * API: GET /restaurant/guest/requests|calls, POST .../accept|reject, .../calls/:id/acknowledge|resolve, GET /restaurant/qr?kind=, POST /restaurant/qr/:kind/:id/rotate|enabled
 */
(function () {
  const { E, M, can, get, send, list, head, pill, mins } = window.HX;
  let el, tab = 'requests';
  document.addEventListener('DOMContentLoaded', init);
  async function init() {
    el = window.HX.mount('Guest requests & QR'); if (!el) return; await window.AppShell.whenProfileReady?.();
    window.HX.live(() => tab !== 'qr' && paint(), 15000); paint();
  }
  async function paint() {
    const tabs = [['requests', 'Orders to confirm'], ['calls', 'Calls']]; if (can('restaurant.guest.qr')) tabs.push(['qr', 'QR codes']);
    el.innerHTML = head('Guest requests & QR', 'Orders and calls from guests who scanned a table or room code.', '<span class="hx-live">Live</span>') + window.HX.tabs(tabs, tab) + '<div id="gb"><div class="hx-card"><p class="hx-sub">Loading…</p></div></div>';
    el.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => { tab = b.dataset.tab; paint(); }));
    const gb = el.querySelector('#gb');
    if (tab === 'requests') return requests(gb); if (tab === 'calls') return calls(gb); return qr(gb);
  }

  async function requests(gb) {
    const bid = window.HX.branchId();
    const [d, od] = await Promise.all([get('/restaurant/guest/requests', { branchId: bid }), get('/restaurant/orders', { branchId: bid, status: 'OPEN', limit: 60 })]); const rows = list(d, 'requests');
    const pending = rows.length ? `<div class="hx-cols">${rows.map((r) => `<div class="hx-card"><div class="hx-row" style="padding-top:0"><div class="grow"><b>${E(r.kind === 'ROOM' ? 'Room ' + r.roomNumber : 'Table ' + r.tableName)}</b><small class="hx-sub">${mins(r.createdAt)} min ago${r.guest && r.guest.name ? ' · ' + E(r.guest.name) : ''}</small></div><span class="hx-money">${M(r.estimatedTotal)}</span></div>
      ${(r.items || []).map((i) => `<div class="hx-row"><span class="grow"><b>${i.quantity}× ${E(i.name)}</b>${i.notes ? `<small class="hx-sub">${E(i.notes)}</small>` : ''}${i.allergyNotes ? `<small class="hx-sub" style="color:var(--color-danger)">Allergy: ${E(i.allergyNotes)}</small>` : ''}</span></div>`).join('')}
      ${r.notes ? `<p class="hx-sub">${E(r.notes)}</p>` : ''}${can('restaurant.guest.respond') ? `<div class="hx-actions" style="margin-top:var(--space-3)"><button class="btn btn-primary" data-ok="${r._id}">Accept and send</button><button class="btn btn-secondary" data-no="${r._id}">Decline</button></div>` : ''}</div>`).join('')}</div>` : window.HX.empty('No orders waiting', 'Guest orders that need your confirmation appear here.');
    gb.innerHTML = `<div class="hx-section"><h2>To confirm${rows.length ? ' · ' + rows.length : ''}</h2>${pending}</div>` + tracking(list(od, 'orders'));
    gb.querySelectorAll('[data-ok]').forEach((b) => b.addEventListener('click', async () => { if (await send('post', `/restaurant/guest/requests/${b.dataset.ok}/accept`, { sendNow: true })) { window.UI.toast.success('Sent to the kitchen'); paint(); } }));
    gb.querySelectorAll('[data-no]').forEach((b) => b.addEventListener('click', async () => { const r = await window.HX.ask('Decline order', 'Reason shown to the guest', { required: false }); if (r === null) return; if (await send('post', `/restaurant/guest/requests/${b.dataset.no}/reject`, r ? { reason: r } : {})) paint(); }));
  }

  /* ---- Confirmed orders: follow each one through Confirmed > Cooking > Ready > Served ---- */
  const STAGES = ['Confirmed', 'Cooking', 'Ready', 'Served'];
  const STAGE_OF = { DRAFT: 0, HELD: 0, PENDING: 0, ACCEPTED: 0, PREPARING: 1, READY: 2, SERVED: 3 };
  const guestSource = (o) => /guest|qr|self|room|scan/i.test(String(o.source || o.channel || o.origin || o.createdVia || ''));
  function tracking(all) {
    const flagged = all.some((o) => o.source || o.channel || o.origin || o.createdVia);
    const orders = all.filter((o) => (flagged ? guestSource(o) : o.orderType === 'DINE_IN' || o.roomNumber) && (o.items || []).some((i) => i.status !== 'CANCELLED'))
      .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    const body = orders.length ? `<div class="hx-trk">${orders.map((o) => {
      const items = (o.items || []).filter((i) => i.status !== 'CANCELLED'), idx = items.map((i) => (STAGE_OF[i.status] == null ? 0 : STAGE_OF[i.status]));
      const stage = Math.min(...idx), counts = STAGES.map((_, k) => idx.filter((x) => x === k).length);
      const where = o.roomNumber ? 'Room ' + o.roomNumber : o.tableName ? 'Table ' + o.tableName : (o.orderType || '').replace('_', ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase());
      const done = stage === 3, late = mins(o.createdAt) > 45 && !done;
      return `<div class="hx-card hx-trk-card ${done ? 'is-done' : ''}"><div class="hx-row" style="padding-top:0"><div class="grow"><b>${E(where)} · ${E(o.orderNumber || '')}</b><small class="hx-sub">${mins(o.createdAt)} min ago${o.customerName ? ' · ' + E(o.customerName) : ''}</small></div>${pill(STAGES[stage], done ? 'ok' : stage === 2 ? 'ok' : stage === 1 ? 'busy' : 'plan')}${late ? pill('Slow', 'bad') : ''}</div>
        <ol class="hx-steps" aria-label="Order progress">${STAGES.map((l, k) => `<li class="${k < stage ? 'done' : k === stage ? 'now' : ''}"><i></i><span>${l}</span>${counts[k] ? `<em>${counts[k]}</em>` : ''}</li>`).join('')}</ol>
        <div class="hx-trk-items">${items.map((i) => `<span class="hx-trk-it s${STAGE_OF[i.status] == null ? 0 : STAGE_OF[i.status]}">${i.quantity}× ${E(i.name)} <em>${STAGES[STAGE_OF[i.status] == null ? 0 : STAGE_OF[i.status]]}</em></span>`).join('')}</div></div>`;
    }).join('')}</div>` : window.HX.empty('No confirmed orders yet', 'Orders you accept show up here so you can follow them until they are served.');
    return `<div class="hx-section"><h2>Confirmed orders · tracking${orders.length ? ' · ' + orders.length : ''}</h2>${body}</div>`;
  }

  async function calls(gb) {
    const d = await get('/restaurant/guest/calls', { branchId: window.HX.branchId() }); const rows = list(d, 'calls');
    gb.innerHTML = rows.length ? `<div class="hx-card flush">${rows.map((c) => `<div class="hx-row"><div class="grow"><b>${E(c.kind === 'BILL' ? 'Wants the bill' : (c.kind || '').toLowerCase().replace(/^./, (x) => x.toUpperCase()))} · ${E(c.tableName ? 'Table ' + c.tableName : c.roomNumber ? 'Room ' + c.roomNumber : '')}</b><small class="hx-sub">${mins(c.createdAt)} min ago${c.note ? ' · ' + E(c.note) : ''}</small></div>${pill(c.status, c.status === 'OPEN' ? 'warn' : 'busy')}
      ${can('restaurant.guest.respond') ? `<span class="hx-actions">${c.status === 'OPEN' ? `<button class="btn btn-sm btn-secondary" data-a="${c._id}">On my way</button>` : ''}<button class="btn btn-sm btn-primary" data-r="${c._id}">Done</button></span>` : ''}</div>`).join('')}</div>` : window.HX.empty('No calls', 'When a guest taps “call waiter” it shows here.');
    gb.querySelectorAll('[data-a]').forEach((b) => b.addEventListener('click', async () => { if (await send('post', `/restaurant/guest/calls/${b.dataset.a}/acknowledge`, {})) paint(); }));
    gb.querySelectorAll('[data-r]').forEach((b) => b.addEventListener('click', async () => { if (await send('post', `/restaurant/guest/calls/${b.dataset.r}/resolve`, {})) paint(); }));
  }

  let kind = 'TABLE';
  const A = (u) => window.HX.abs(u);
  function printSheet(rows) {
    const w = window.open('', '_blank'); if (!w) return window.UI.toast.warning('Allow pop-ups to print the QR sheet');
    const biz = ((window.AppShell.getBusinessProfile && window.AppShell.getBusinessProfile()) || {}).name || '';
    w.document.write(`<!doctype html><title>QR codes</title><style>
      body{font-family:system-ui,sans-serif;margin:0;padding:12mm;color:#111}.g{display:grid;grid-template-columns:repeat(3,1fr);gap:8mm}
      .c{border:2px solid #111;border-radius:10px;padding:8mm 5mm;text-align:center;break-inside:avoid}.c svg{width:100%;max-width:46mm;height:auto}
      .c h2{margin:3mm 0 1mm;font-size:20pt}.c p{margin:0;font-size:10pt;color:#444}.b{font-size:11pt;font-weight:700;margin-bottom:2mm}
      @media print{@page{margin:8mm}}</style><div class="g">${rows.map((r) => `<div class="c"><div class="b">${E(biz)}</div>${window.QREncoder.toSvg(A(r.url), { ecl: 'M', border: 1 })}<h2>${E(r.label)}</h2><p>Scan to see the menu${kind === 'TABLE' ? ' and order' : ', order and call reception'}</p></div>`).join('')}</div>`);
    w.document.close(); setTimeout(() => { w.focus(); w.print(); }, 400);
  }
  async function qr(gb) {
    const kinds = [['TABLE', 'Tables']]; if (window.HX.feature('accommodation')) kinds.push(['ROOM', 'Rooms']);
    const d = await get('/restaurant/qr', { kind, branchId: window.HX.branchId() }); const rows = list(d, 'codes', 'qr');
    // Build each link here from the signed token, straight to q.html?t=<token>: no dependence on the /q/:token rewrite or on the address saved on the server.
    rows.forEach((r) => { const t = r.token || String(r.url || '').split('/q/')[1]; if (t) r.url = window.HX.abs('/q.html?t=' + encodeURIComponent(t)); });
    gb.innerHTML = `<div class="hx-actions" style="margin-bottom:var(--space-3)">${kinds.length > 1 ? kinds.map(([k, l]) => `<button class="hx-chip ${k === kind ? 'on' : ''}" data-k="${k}">${l}</button>`).join('') : ''}<button class="btn btn-primary" id="pr" ${rows.length ? '' : 'disabled'}>Print all codes</button><a class="btn btn-secondary" href="hx-restaurant-settings.html#guest">Ordering rules</a></div>
      <p class="hx-sub" style="margin-bottom:var(--space-3)">Each code opens <b>${E(A('/q.html?t=…'))}</b> on the guest’s phone. Tables must be <b>opened by a waiter</b> before guests can order (or switch on “self-seat” in Ordering rules). Rooms accept orders once a guest is checked in.</p>` +
      (rows.length ? `<div class="hx-qrs">${rows.map((r) => `<div class="hx-qr">${window.QREncoder ? window.QREncoder.toSvg(A(r.url), { ecl: 'M', border: 1 }) : ''}<b>${E(r.label)}</b><small class="hx-sub">${r.enabled ? 'On' : 'Off'}</small><div class="hx-actions" style="justify-content:center;margin-top:var(--space-2)"><a class="btn btn-sm btn-secondary" href="${E(A(r.url))}" target="_blank" rel="noopener">Open</a><button class="btn btn-sm btn-secondary" data-cp="${E(A(r.url))}">Copy link</button></div><div class="hx-actions" style="justify-content:center;margin-top:var(--space-2)"><button class="btn btn-sm btn-secondary" data-en="${r.id}" data-v="${r.enabled ? 0 : 1}">${r.enabled ? 'Turn off' : 'Turn on'}</button><button class="btn btn-sm btn-secondary" data-rot="${r.id}">New code</button></div></div>`).join('')}</div>` : window.HX.empty('No codes yet', kind === 'ROOM' ? 'Add rooms first (Setup guide).' : 'Add tables first (Setup guide).'));
    gb.querySelectorAll('[data-k]').forEach((b) => b.addEventListener('click', () => { kind = b.dataset.k; qr(gb); }));
    gb.querySelector('#pr')?.addEventListener('click', () => printSheet(rows.filter((r) => r.enabled)));
    gb.querySelectorAll('[data-cp]').forEach((b) => b.addEventListener('click', async () => { try { await navigator.clipboard.writeText(b.dataset.cp); window.UI.toast.success('Link copied'); } catch { window.prompt('Copy this link', b.dataset.cp); } }));
    gb.querySelectorAll('[data-en]').forEach((b) => b.addEventListener('click', async () => { if (await send('post', `/restaurant/qr/${kind}/${b.dataset.en}/enabled`, { enabled: b.dataset.v === '1' })) qr(gb); }));
    gb.querySelectorAll('[data-rot]').forEach((b) => b.addEventListener('click', async () => { if (await window.UI.confirmDialog({ title: 'Replace this code?', message: 'The printed code stops working. Print the new one.', confirmText: 'Replace' }) && await send('post', `/restaurant/qr/${kind}/${b.dataset.rot}/rotate`, {})) qr(gb); }));
  }
})();