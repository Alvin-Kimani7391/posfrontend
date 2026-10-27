/**
 * hx-selfservice.js - staff side of the self-service kiosk.
 *   Cashier desk : kiosk orders waiting for cash (GET /restaurant/self-service/orders, POST .../:id/confirm-cash). The kitchen only sees
 *                  the order AFTER the cashier confirms the money here (or M-PESA is verified by the server).
 *   Kiosk setup  : on/off switches, branch, link + QR (GET /restaurant/self-service/link, POST .../link/rotate, PUT /restaurant/settings).
 */
(function () {
  const { E, M, can, get, list, head, pill, dt, hm } = window.HX;
  let el, tab = 'CASH', search = '', info = null, ss = {}, branches = [], busy = false;
  const canDesk = () => can('restaurant.bills.view'), canSetup = () => can('restaurant.settings.manage'), canTables = () => can('restaurant.tables.assign');
  let pick = new Set();
  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    el = window.HX.mount('Self-service kiosk'); if (!el) return;
    await window.AppShell.whenProfileReady?.();
    if (!canDesk() && !canSetup() && !canTables()) { el.innerHTML = head('Self-service kiosk', '') + window.HX.empty('No access', 'Ask the owner or a manager for access.'); return; }
    if (!canDesk()) tab = canTables() ? 'TABLES' : 'SETUP';
    show();
    window.HX.live(() => { if (!document.querySelector('.modal-backdrop') && tab !== 'SETUP' && tab !== 'TABLES') show(true); }, 8000);
  }

  async function show(quiet) {
    const tabs = []; if (canDesk()) tabs.push(['CASH', 'Waiting for payment'], ['PAID', 'Paid today']); if (canTables()) tabs.push(['TABLES', 'Free tables']); if (canSetup()) tabs.push(['SETUP', 'Kiosk setup']);
    el.innerHTML = head('Self-service kiosk', 'Customers order and pay at the kiosk. Confirm cash here.', canDesk() ? '<button class="btn btn-secondary" id="kh">Order history</button>' : '') + window.HX.tabs(tabs, tab) + '<div id="ss"></div>';
    el.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => { tab = b.dataset.tab; show(); }));
    el.querySelector('#kh')?.addEventListener('click', () => window.HX.showHistory('kiosk'));
    const box = el.querySelector('#ss'); if (!quiet) box.innerHTML = window.HX.skel('rows');
    return tab === 'SETUP' ? setup(box) : tab === 'TABLES' ? tables(box) : desk(box);
  }

  // ---------------------------------------------------------------- cashier desk
  async function desk(box) {
    const d = await get('/restaurant/self-service/orders', { branchId: window.HX.branchId(), state: tab === 'PAID' ? 'PAID' : undefined, search: search || undefined });
    const rows = list(d, 'orders');
    const bar = `<div class="hx-row" style="margin-bottom:var(--space-3)"><input class="input grow" id="sq" type="search" placeholder="Search by order no., collect no., table or customer code" value="${E(search)}"></div>`;
    box.innerHTML = bar + (rows.length ? `<div class="hx-card flush">${rows.map((o) => row(o)).join('')}</div>` : window.HX.empty(tab === 'PAID' ? 'Nothing paid yet' : 'No kiosk orders waiting', tab === 'PAID' ? 'Paid kiosk orders from the last 24 hours show here.' : 'When a customer chooses “Cash”, the order appears here until you confirm the money.'));
    const sq = box.querySelector('#sq'); let t; sq.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { search = sq.value.trim(); desk(box).then(() => { const n = box.querySelector('#sq'); if (n) { n.focus(); n.setSelectionRange(n.value.length, n.value.length); } }); }, 400); });
    box.querySelectorAll('[data-bill]').forEach((b) => b.addEventListener('click', () => viewBill(rows.find((x) => String(x.id) === b.dataset.bill))));
    box.querySelectorAll('[data-cash]').forEach((b) => b.addEventListener('click', () => confirmCash(rows.find((x) => String(x.id) === b.dataset.cash))));
  }
  function row(o) {
    const cash = o.paymentState === 'AWAITING_CASH', paid = o.paymentState === 'PAID';
    const tone = paid ? 'ok' : cash ? 'warn' : 'busy';
    const label = paid ? (o.sentToKitchen ? 'Paid · in kitchen' : 'Paid') : cash ? 'Cash due' : 'M-PESA in progress';
    const where = o.table ? 'Table ' + o.table : 'Take away';
    return `<div class="hx-row"><div class="grow"><b>${E(o.orderNumber)}${o.pickupNumber ? ' · #' + E(o.pickupNumber) : ''} · ${E(where)}</b>
      <small class="hx-sub">${E((o.items || []).slice(0, 4).join(', '))}${(o.items || []).length > 4 ? '…' : ''} · ${hm(o.createdAt)}${o.expiresAt && !paid ? ' · expires ' + hm(o.expiresAt) : ''}</small></div>
      ${pill(label, tone)}<span class="hx-money">${M(o.total)}</span>
      <button class="btn btn-sm btn-secondary" data-bill="${o.id}">Bill</button>${cash && can('restaurant.bills.pay') ? `<button class="btn btn-sm btn-primary" data-cash="${o.id}">Confirm cash</button>` : ''}</div>`;
  }
  function paper(o) {
    const items = (o.items || []).map((i) => `<div style="display:flex;justify-content:space-between"><span>${E(i)}</span></div>`).join('');
    return `<div id="bp" style="font:13px/1.5 ui-monospace,Menlo,Consolas,monospace;max-width:300px;margin:0 auto;text-align:center"><b>${o.paymentState === 'PAID' ? 'RECEIPT' : 'BILL'} ${E(o.orderNumber)}</b><br>${o.table ? 'Table ' + E(o.table) : 'Take away'}${o.pickupNumber ? ' · Collect #' + E(o.pickupNumber) : ''}<br>${dt(o.createdAt)}<hr style="border:0;border-top:1px dashed #999">
      <div style="text-align:left">${items}</div><hr style="border:0;border-top:1px dashed #999"><b style="font-size:16px">${o.paymentState === 'PAID' ? 'TOTAL PAID' : 'AMOUNT DUE'}: ${M(o.total)}</b>${o.paymentState === 'PAID' ? '' : '<br><b>UNPAID - CASH</b>'}</div>`;
  }
  function viewBill(o) {
    if (!o) return;
    window.HX.modal({ title: 'Bill · ' + o.orderNumber, maxWidth: '420px', body: paper(o), footer: '<button class="btn btn-secondary" data-x>Close</button><button class="btn btn-primary" id="pr">Print</button>',
      onMount(root, close) {
        root.querySelector('[data-x]').onclick = close;
        root.querySelector('#pr').onclick = () => { const w = window.open('', '_blank', 'width=380,height=600'); if (!w) return window.UI.toast.warning('Allow pop-ups to print'); w.document.write('<body style="margin:12px">' + paper(o) + '</body>'); w.document.close(); w.focus(); w.print(); };
      } });
  }
  function confirmCash(o) {
    if (!o) return; let key = window.Api.newIdempotencyKey();
    const m = window.HX.modal({
      title: 'Confirm cash · ' + o.orderNumber, maxWidth: '420px',
      body: `<p style="margin:0 0 6px">Amount due</p><div class="hx-money" style="font-size:28px;font-weight:800">${M(o.total)}</div>
        <p class="hx-sub" style="margin:8px 0 0">${E((o.items || []).join(', '))}</p>
        <div class="field" style="margin-top:14px"><label for="tn">Cash received (optional)</label><input class="input" id="tn" type="number" min="0" step="any" inputmode="decimal" placeholder="${o.total}"></div><div id="ch" class="hx-sub"></div>`,
      footer: '<button class="btn btn-secondary" data-x>Cancel</button><button class="btn btn-primary" id="go">Money received</button>',
      onMount(root, close) {
        root.querySelector('[data-x]').onclick = close; const tn = root.querySelector('#tn'), ch = root.querySelector('#ch');
        tn.oninput = () => { const v = Number(tn.value); ch.textContent = v > o.total ? 'Change to give: ' + M(v - o.total) : v && v < o.total ? 'Less than the amount due' : ''; };
        root.querySelector('#go').onclick = async (ev) => {
          const btn = ev.currentTarget; if (btn.disabled) return; btn.disabled = true; btn.textContent = 'Working…';
          const t = tn.value === '' ? undefined : Number(tn.value);
          try {
            const { data } = await window.Api.post('/restaurant/self-service/orders/' + o.id + '/confirm-cash', t != null ? { tendered: t } : {}, { idempotencyKey: key });
            close(); window.UI.toast.success(data && data.sentToKitchen === false ? 'Cash confirmed. The kitchen will get it shortly.' : 'Cash confirmed. Sent to the kitchen.'); show(true);
          } catch (e) { btn.disabled = false; btn.textContent = 'Money received'; key = window.Api.newIdempotencyKey(); window.UI.toast.error((e && e.message) || 'Could not confirm. Try again.'); }
        };
      },
    });
  }

  // ---------------------------------------------------------------- free tables (a customer left, or walked away from an unpaid kiosk order)
  async function tables(box) {
    const bid = window.HX.branchId();
    const [d, k] = await Promise.all([get('/restaurant/tables', { branchId: bid }), get('/restaurant/self-service/orders', { branchId: bid })]);
    const floor = list(d, 'tables'); const kiosk = {}; list(k, 'orders').forEach((o) => { if (o.table) kiosk[o.table] = o; });
    const busyT = floor.filter((t) => (t.status || 'AVAILABLE') !== 'AVAILABLE');
    pick = new Set([...pick].filter((id) => busyT.some((t) => String(t._id) === id)));
    const label = (t) => { const st = t.status || 'AVAILABLE', ko = kiosk[t.name]; return ko ? 'Kiosk order ' + ko.orderNumber + (ko.paymentState === 'AWAITING_CASH' ? ' · cash not paid' : ' · M-PESA not paid') : st.replace(/_/g, ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase()); };
    box.innerHTML = `<p class="hx-sub" style="margin:0 0 10px">Tick the tables whose customers have left and press <b>Free tables</b>. Unpaid kiosk orders on those tables are cancelled (nobody is charged) and the table becomes available again.</p>
      <div class="hx-row" style="margin-bottom:var(--space-3);gap:8px;flex-wrap:wrap"><button class="btn btn-secondary btn-sm" id="t_all">Select all not available</button><button class="btn btn-secondary btn-sm" id="t_none">Clear</button><span class="grow"></span><button class="btn btn-primary" id="t_go" ${pick.size ? '' : 'disabled'}>Free tables (${pick.size})</button></div>
      ${floor.length ? `<div class="hx-card flush">${floor.map((t) => { const av = (t.status || 'AVAILABLE') === 'AVAILABLE'; return `<label class="hx-row" style="${av ? 'opacity:.55' : 'cursor:pointer'}"><input type="checkbox" data-t="${E(t._id)}" ${av ? 'disabled' : ''} ${pick.has(String(t._id)) ? 'checked' : ''} style="width:22px;height:22px"><span class="grow"><b>Table ${E(t.name)}</b><small class="hx-sub">${t.seats ? t.seats + ' seats · ' : ''}${E(label(t))}</small></span>${pill(av ? 'AVAILABLE' : (t.status || '').replace(/_/g, ' '), av ? 'ok' : 'busy')}</label>`; }).join('')}</div>` : window.HX.empty('No tables', 'There are no tables for this branch.')}`;
    const $ = (i) => box.querySelector(i);
    const upd = () => { const b = $('#t_go'); b.disabled = !pick.size; b.textContent = `Free tables (${pick.size})`; };
    box.querySelectorAll('input[data-t]').forEach((c) => c.addEventListener('change', () => { c.checked ? pick.add(c.dataset.t) : pick.delete(c.dataset.t); upd(); }));
    $('#t_all').onclick = () => { busyT.forEach((t) => pick.add(String(t._id))); tables(box); };
    $('#t_none').onclick = () => { pick.clear(); tables(box); };
    $('#t_go').onclick = async () => {
      const chosen = floor.filter((t) => pick.has(String(t._id))); if (!chosen.length) return;
      const withKiosk = chosen.filter((t) => kiosk[t.name]).length;
      const ok = await window.UI.confirmDialog({ title: `Free ${chosen.length} table${chosen.length > 1 ? 's' : ''}?`, message: 'Only do this when the customers have left. ' + (withKiosk ? withKiosk + ' unpaid kiosk order(s) will be cancelled. ' : '') + 'Orders that are already paid or being served are not cancelled.', confirmText: 'Free tables' });
      if (!ok) return; const b = $('#t_go'); b.disabled = true; b.textContent = 'Working…';
      const reason = 'Table freed by ' + ((window.HX.user() || {}).name || 'staff'); let done = 0; const fails = [];
      for (const t of chosen) {
        try {
          const ko = kiosk[t.name];
          if (ko) await window.Api.post('/restaurant/orders/' + ko.id + '/cancel', { reason });
          await window.Api.post('/restaurant/tables/' + t._id + '/status', { status: 'AVAILABLE', reason });
          done++;
        } catch (e) { fails.push(`Table ${t.name}: ${(e && e.message) || 'failed'}`); }
      }
      pick.clear();
      if (done) window.UI.toast.success(`${done} table${done > 1 ? 's' : ''} freed`);
      if (fails.length) window.UI.toast.error(fails.slice(0, 3).join(' · '));
      tables(box);
    };
  }

  // ---------------------------------------------------------------- setup
  async function setup(box) {
    if (!canSetup()) { box.innerHTML = window.HX.empty('No access', 'Only an owner or manager can change the kiosk.'); return; }
    const [l, s, b] = await Promise.all([get('/restaurant/self-service/link'), get('/restaurant/settings'), get('/branches', { limit: 100 })]);
    info = l; ss = (s && (s.settings || s).selfService) || {}; branches = list(b, 'branches').filter((x) => x.status !== 'inactive');
    const on = (k, d = true) => (ss[k] == null ? d : !!ss[k]);
    const branchId = ss.branchId || window.HX.branchId() || (branches[0] && branches[0]._id) || '';
    const tg = (id, label, hint, v) => `<label class="hx-row" style="cursor:pointer"><span class="grow"><b>${E(label)}</b><small class="hx-sub">${E(hint)}</small></span><input type="checkbox" id="${id}" ${v ? 'checked' : ''} style="width:22px;height:22px"></label>`;
    const url = info && info.token ? location.origin + '/kiosk.html?t=' + encodeURIComponent(info.token) : '';
    box.innerHTML = `<div class="hx-card flush">
      ${tg('k_en', 'Kiosk switched on', 'Customers can order and pay on the kiosk link.', on('enabled', false))}
      ${tg('k_di', 'Dine in', 'Customer picks a free table (if tables are used).', on('dineIn'))}
      ${tg('k_ta', 'Take away', 'Customer gets a collect number.', on('takeAway'))}
      ${tg('k_mp', 'Pay by M-PESA', 'Needs M-PESA switched on in Integration settings.', on('mpesa'))}
      ${tg('k_ca', 'Pay cash at the cashier', 'Bill is shown; you confirm the cash on the “Waiting for payment” tab.', on('cash'))}
      <div class="hx-row"><div class="field grow"><label for="k_br">Branch this kiosk sells for</label><select class="input" id="k_br">${branches.map((x) => `<option value="${E(x._id)}" ${String(x._id) === String(branchId) ? 'selected' : ''}>${E(x.name)}</option>`).join('')}</select></div>
        <div class="field"><label for="k_ex">Unpaid orders cancel after (min)</label><input class="input" id="k_ex" type="number" min="5" max="240" value="${E(ss.expiryMinutes || 30)}"></div></div>
      <div class="hx-row"><div class="field grow"><label for="k_wm">Welcome message</label><input class="input" id="k_wm" maxlength="300" value="${E(ss.welcomeMessage || '')}" placeholder="Order here, pay, and we’ll bring it to you."></div></div>
      <div class="hx-row"><button class="btn btn-primary" id="k_save">Save</button></div></div>
      <div class="hx-card" style="margin-top:var(--space-4)"><h3 style="margin:0 0 4px">Kiosk link</h3><p class="hx-sub" style="margin:0 0 12px">Open this on the kiosk tablet or screen (full screen). Anyone with the link can place orders, so keep it on the kiosk only.</p>
        ${url ? `<div style="display:flex;gap:18px;flex-wrap:wrap;align-items:flex-start"><div id="k_qr" style="width:160px;height:160px"></div><div class="grow" style="min-width:240px"><input class="input" id="k_url" readonly value="${E(url)}" style="width:100%"><div class="hx-actions" style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap"><button class="btn btn-secondary" id="k_copy">Copy link</button><a class="btn btn-secondary" href="${E(url)}" target="_blank" rel="noopener">Open kiosk</a><button class="btn btn-secondary" id="k_rot">Replace link</button></div>
        ${info.configured === false ? '<p class="hx-sub" style="margin-top:10px">Choose a branch and press Save to finish set-up.</p>' : ''}</div></div>` : '<p class="hx-sub">The link could not be loaded.</p>'}</div>`;
    const qr = box.querySelector('#k_qr'); if (qr && window.QREncoder) { try { qr.innerHTML = window.QREncoder.toSvg(url, { ecl: 'M', border: 1, title: 'Kiosk link' }); } catch (e) { /* link still works */ } }
    const $ = (id) => box.querySelector(id);
    $('#k_save').onclick = save;
    if ($('#k_copy')) $('#k_copy').onclick = async () => { try { await navigator.clipboard.writeText(url); window.UI.toast.success('Link copied'); } catch (e) { $('#k_url').select(); document.execCommand('copy'); } };
    if ($('#k_rot')) $('#k_rot').onclick = async () => {
      if (!(await window.UI.confirmDialog({ title: 'Replace the kiosk link?', message: 'The old link stops working at once. You will need to open the new link on the kiosk.', confirmText: 'Replace link', danger: true }))) return;
      try { await window.Api.post('/restaurant/self-service/link/rotate', {}); window.UI.toast.success('New link ready'); setup(box); } catch (e) { window.UI.toast.error((e && e.message) || 'Could not replace the link'); }
    };
  }
  async function save() {
    if (busy) return; const q = (i) => el.querySelector(i);
    const body = { selfService: { enabled: q('#k_en').checked, dineIn: q('#k_di').checked, takeAway: q('#k_ta').checked, mpesa: q('#k_mp').checked, cash: q('#k_ca').checked, expiryMinutes: Number(q('#k_ex').value) || 30, welcomeMessage: q('#k_wm').value.trim(), ...(q('#k_br').value ? { branchId: q('#k_br').value } : {}) } };
    if (body.selfService.enabled && !body.selfService.dineIn && !body.selfService.takeAway) return window.UI.toast.error('Switch on dine in or take away.');
    if (body.selfService.enabled && !body.selfService.mpesa && !body.selfService.cash) return window.UI.toast.error('Switch on at least one way to pay.');
    busy = true; try { await window.Api.put('/restaurant/settings', body); window.UI.toast.success('Kiosk settings saved'); show(true); } catch (e) { window.UI.toast.error((e && e.message) || 'Could not save'); } busy = false;
  }
})();