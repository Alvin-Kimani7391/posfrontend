/* Recipes, kitchen stations, delivery, tips payouts, photo upload for menu items and room types. */
(function () {
  const { V, S, api, list, all, money, kpi, E, $ } = window.HX, { Api, UI } = window, q = () => ({ branchId: S.branch });
  const num = (v) => (v === '' || v == null ? undefined : +v);
  const ymd = (d = 0) => new Date(Date.now() + d * 864e5).toISOString().slice(0, 10);
  const head = (t, btn, id) => `<div style="display:flex;justify-content:space-between;align-items:center;margin:0 0 12px"><h3 style="margin:0">${t}</h3>${btn ? `<button class="btn btn-primary" id="${id}">${btn}</button>` : ''}</div>`;
  const table = (cols, rows) => rows.length ? `<div class="hx-card" style="padding:0;overflow:auto"><table class="table"><thead><tr>${cols.map((c) => `<th>${c}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>` : UI.emptyStateHtml({ title: 'Nothing here yet' });
  function form(title, fields, submit, btn = 'Save') {
    const body = fields.map(([n, l, t = 'text', d = '']) => `<div class="field"><label>${l}</label>${Array.isArray(t) ? `<select class="select" name="${n}">${t.map((o) => `<option value="${E(o.v ?? o)}">${E(o.l ?? o)}</option>`).join('')}</select>` : `<input class="input" name="${n}" type="${t}" value="${E(d)}">`}</div>`).join('');
    const m = UI.openModal({ title, bodyHtml: body, footerHtml: `<button class="btn btn-primary" id="hs">${btn}</button>` });
    $('#hs', m).onclick = () => api(async () => { const v = {}; m.querySelectorAll('[name]').forEach((e) => { if (e.value !== '') v[e.name] = e.value; }); await submit(v); UI.closeModal(); });
  }
  const pickFile = (accept, multiple) => new Promise((res) => { const i = document.createElement('input'); i.type = 'file'; i.accept = accept; i.multiple = !!multiple; i.onchange = () => res([...i.files]); i.click(); });

  /* ---------- Kitchen stations ---------- */
  V.stations = async (pg) => {
    const { data } = await Api.get('/restaurant/stations', q()); const st = list(data.stations);
    pg.innerHTML = `<p class="text-muted">A station is a place that prepares food, such as Grill, Cold kitchen or Bar. Each dish is sent to its station's ticket screen.</p>` + head('Stations', 'Add station', 'as') +
      table(['Station', 'Code', 'Type', 'Default', ''], st.map((s) => [`<b>${E(s.name)}</b>`, E(s.code), E(s.type || 'KITCHEN'), s.isDefault ? '<span class="hx-chip">Default</span>' : '', `<button class="btn btn-sm btn-secondary" data-e="${s._id}">Edit</button> <button class="btn btn-sm btn-secondary" data-d="${s._id}">Remove</button>`]));
    const f = (x = {}) => [['name', 'Name', 'text', x.name || ''], ['code', 'Code (e.g. GRILL)', 'text', x.code || ''], ['type', 'Type', ['KITCHEN', 'BAR']], ['printerName', 'Printer name (optional)', 'text', x.printerName || '']];
    $('#as').onclick = () => form('Add station', f(), async (v) => { await Api.post('/restaurant/stations', { ...v, code: v.code.toUpperCase(), branchId: S.branch, isDefault: !st.length }); V.stations(pg); });
    pg.querySelectorAll('[data-e]').forEach((b) => b.onclick = () => form('Edit station', f(st.find((x) => x._id === b.dataset.e)), async (v) => { await Api.put('/restaurant/stations/' + b.dataset.e, { ...v, code: v.code && v.code.toUpperCase() }); V.stations(pg); }));
    pg.querySelectorAll('[data-d]').forEach((b) => b.onclick = async () => { if (await UI.confirmDialog({ title: 'Remove station?', message: 'Dishes using it move to the default station.', danger: true })) api(async () => { await Api.delete('/restaurant/stations/' + b.dataset.d); V.stations(pg); }); });
  };

  /* ---------- Recipes ---------- */
  V.recipes = async (pg) => {
    const items = await all('/restaurant/menu/items');
    pg.innerHTML = `<p class="text-muted">A recipe lists the ingredients one dish uses. When the dish is sold the ingredients are deducted from stock, and you see the cost of each dish.</p>` +
      table(['Dish', 'Price', ''], items.map((i) => [`<b>${E(i.name)}</b>`, money(i.basePrice), `<button class="btn btn-sm btn-primary" data-r="${i._id}">Recipe</button>`]));
    pg.querySelectorAll('[data-r]').forEach((b) => b.onclick = () => recipeEditor(items.find((i) => i._id === b.dataset.r)));
  };
  async function recipeEditor(item) {
    const [ings, rc] = await Promise.all([all('/restaurant/ingredients'), Api.get('/restaurant/recipes', { menuItemId: item._id }).catch(() => ({ data: {} }))]); const cur = rc.data.recipe || rc.data || {}; let lines = (cur.lines || []).map((l) => ({ ingredientId: String(l.ingredientId && l.ingredientId._id || l.ingredientId), quantity: l.quantity, prepLossPercent: l.prepLossPercent || 0 }));
    if (!lines.length) lines = [{ ingredientId: ings[0] && ings[0]._id, quantity: '', prepLossPercent: 0 }];
    let yieldP = cur.yieldPortions || 1;
    const m = UI.openModal({ title: 'Recipe · ' + item.name, maxWidth: '680px', bodyHtml: '<div id="rb"></div>', footerHtml: '<button class="btn btn-secondary" id="cost">Show cost</button><button class="btn btn-primary" id="sv">Save recipe</button>' });
    const draw = () => {
      $('#rb', m).innerHTML = `<div class="field"><label>Portions this recipe makes</label><input class="input" id="yp" type="number" min="1" value="${yieldP}"></div>` + lines.map((l, i) => `<div style="display:grid;grid-template-columns:2fr 1fr 1fr auto;gap:8px;margin-bottom:8px;align-items:end"><div class="field" style="margin:0"><label>Ingredient</label><select class="select" data-i="${i}" data-f="ingredientId">${ings.map((g) => `<option value="${g._id}" ${g._id === l.ingredientId ? 'selected' : ''}>${E(g.name)} (${E(g.baseUnit)})</option>`).join('')}</select></div><div class="field" style="margin:0"><label>Quantity</label><input class="input" type="number" step="any" data-i="${i}" data-f="quantity" value="${l.quantity}"></div><div class="field" style="margin:0"><label>Prep loss %</label><input class="input" type="number" data-i="${i}" data-f="prepLossPercent" value="${l.prepLossPercent}"></div><button class="btn btn-sm btn-secondary" data-x="${i}">✕</button></div>`).join('') + '<button class="btn btn-secondary" id="al">+ Add ingredient</button><div id="cr" style="margin-top:12px"></div>';
      m.querySelectorAll('[data-f]').forEach((e) => e.onchange = () => { lines[+e.dataset.i][e.dataset.f] = e.value; });
      m.querySelectorAll('[data-x]').forEach((e) => e.onclick = () => { lines.splice(+e.dataset.x, 1); draw(); });
      $('#yp', m).onchange = (e) => { yieldP = +e.target.value || 1; }; $('#al', m).onclick = () => { lines.push({ ingredientId: ings[0] && ings[0]._id, quantity: '', prepLossPercent: 0 }); draw(); };
    }; draw();
    const body = () => ({ menuItemId: item._id, yieldPortions: yieldP, lines: lines.filter((l) => +l.quantity > 0).map((l) => ({ ingredientId: l.ingredientId, quantity: +l.quantity, prepLossPercent: +l.prepLossPercent || 0 })) });
    $('#sv', m).onclick = () => api(async () => { if (!body().lines.length) return UI.toast.warning('Add at least one ingredient with a quantity'); await Api.post('/restaurant/recipes', body()); UI.toast.success('Recipe saved'); UI.closeModal(); });
    $('#cost', m).onclick = () => api(async () => { const id = cur._id; if (!id) return UI.toast.info('Save the recipe first, then check its cost'); const { data } = await Api.get(`/restaurant/recipes/${id}/cost`, q()); const c = data.cost || data;
      $('#cr', m).innerHTML = `<div class="hx-card"><b>Cost per portion:</b> ${money(c.costPerPortion ?? c.cost ?? c.totalCost)} · <b>Price:</b> ${money(item.basePrice)}${c.marginPercent != null ? ` · <b>Margin:</b> ${c.marginPercent}%` : ''}</div>`; });
  }

  /* ---------- Delivery ---------- */
  V.delivery = async (pg) => {
    const rider = S.user && S.user.role === 'DELIVERY_RIDER';
    const { data } = await Api.get(rider ? '/restaurant/delivery/mine' : '/restaurant/delivery', q()); const rows = list(data.orders || data.deliveries || data);
    let riders = []; if (!rider) { try { const e = await Api.get('/employees', { limit: 100 }); riders = list(e.data.employees || e.data).filter((u) => u.role === 'DELIVERY_RIDER'); } catch (e) { /* no permission */ } }
    const NEXT = { PENDING: ['ASSIGNED'], ASSIGNED: ['OUT_FOR_DELIVERY'], OUT_FOR_DELIVERY: ['DELIVERED', 'FAILED'] };
    pg.innerHTML = head(rider ? 'My deliveries' : 'Delivery orders', rider ? '' : 'New delivery order', 'nd') + (rows.length ? `<div class="hx-grid w">${rows.map((o) => { const d = o.delivery || {}; const st = d.status || 'PENDING';
      return `<div class="hx-card hx-tk ${st === 'DELIVERED' ? 'READY' : ''}"><div style="display:flex;justify-content:space-between"><b>${E(o.orderNumber)}</b><span class="hx-chip">${E(st.replace(/_/g, ' '))}</span></div><div>${E(d.contactName || o.customerName || '')} ${d.phone ? `· <a href="tel:${E(d.phone)}">${E(d.phone)}</a>` : ''}</div><small>${E(d.address || '')} ${E(d.landmark || '')}</small><br><b>${money(o.totals && o.totals.total)}</b> ${d.riderName ? `· Rider: ${E(d.riderName)}` : ''}
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">${!rider && st === 'PENDING' && riders.length ? `<button class="btn btn-sm btn-primary" data-as="${o._id}">Assign rider</button>` : ''}${(NEXT[st] || []).filter((n) => n !== 'ASSIGNED' || rider).map((n) => `<button class="btn btn-sm ${n === 'FAILED' ? 'btn-secondary' : 'btn-primary'}" data-st="${n}" data-i="${o._id}">${{ OUT_FOR_DELIVERY: 'Picked up', DELIVERED: 'Delivered', FAILED: 'Failed', ASSIGNED: 'Accept' }[n]}</button>`).join('')}${rider ? '' : `<a class="btn btn-sm btn-secondary" href="#/floor/${o._id}">Open order</a>`}</div></div>`; }).join('')}</div>` : '<p class="text-muted">No deliveries right now.</p>');
    if (!rider) $('#nd').onclick = () => form('New delivery order', [['contactName', 'Customer name'], ['phone', 'Phone', 'tel'], ['address', 'Delivery address'], ['landmark', 'Landmark'], ['fee', 'Delivery fee', 'number', 0]], async (v) => { const r = await Api.post('/restaurant/orders', { branchId: S.branch, orderType: 'DELIVERY', delivery: { contactName: v.contactName, phone: v.phone, address: v.address, landmark: v.landmark, fee: num(v.fee) || 0 } }); location.hash = '#/floor/' + r.data.order._id; }, 'Create & add dishes');
    pg.querySelectorAll('[data-as]').forEach((b) => b.onclick = () => form('Assign rider', [['riderId', 'Rider', riders.map((r) => ({ v: r._id, l: r.name }))]], async (v) => { await Api.post(`/restaurant/orders/${b.dataset.as}/delivery/assign`, { riderId: v.riderId }); V.delivery(pg); }, 'Assign'));
    pg.querySelectorAll('[data-st]').forEach((b) => b.onclick = () => api(async () => { const reason = b.dataset.st === 'FAILED' ? prompt('Why did it fail?') : undefined; if (b.dataset.st === 'FAILED' && !reason) return; await Api.post(`/restaurant/orders/${b.dataset.i}/delivery/status`, { status: b.dataset.st, reason }); V.delivery(pg); }));
  }; V.delivery.live = 20000;

  /* ---------- Tips and payouts ---------- */
  V.tips = async (pg) => {
    const mgr = S.user && ['OWNER', 'ADMIN', 'MANAGER', 'SUPERVISOR'].includes(S.user.role);
    const from = pg.dataset.from || ymd(-7), to = pg.dataset.to || ymd(0); const r = { branchId: S.branch, from: new Date(from).toISOString(), to: new Date(to + 'T23:59:59').toISOString(), limit: 100 };
    const { data } = await Api.get('/restaurant/tips', r); const tips = list(data.tips || data.items || data); let sum = null; if (mgr) { try { sum = (await Api.get('/restaurant/tips/summary', r)).data; } catch (e) { /* ignore */ } }
    const total = tips.reduce((t, x) => t + (x.amount || 0), 0), toPay = tips.filter((x) => x.status === 'ALLOCATED');
    pg.innerHTML = `<div class="hx-card" style="margin-bottom:14px;display:flex;gap:10px;align-items:end;flex-wrap:wrap"><div class="field"><label>From</label><input type="date" class="input" id="f" value="${from}"></div><div class="field"><label>To</label><input type="date" class="input" id="t" value="${to}"></div><button class="btn btn-secondary" id="go">Show</button>${mgr ? '<button class="btn btn-primary" id="al">Share tips for this period</button>' : ''}${mgr && toPay.length ? `<button class="btn btn-success" id="po">Pay out ${toPay.length} tips (${money(toPay.reduce((t, x) => t + x.amount, 0))})</button>` : ''}</div>` +
      kpi([['Tips in period', money(total)], ['Entries', tips.length], ['Waiting to pay out', money(toPay.reduce((t, x) => t + x.amount, 0))]]) +
      table(['Date', 'Staff', 'Amount', 'Method', 'Status'], tips.map((x) => [UI.formatDateTime(x.createdAt), E(x.waiterId && x.waiterId.name || x.waiterName || ''), `<b>${money(x.amount)}</b>`, E(x.method || ''), `<span class="hx-chip">${E((x.status || '').replace('_', ' '))}</span>`])) + (sum && Array.isArray(sum.byStaff || sum.staff) ? `<h3 style="margin-top:18px">Per person</h3>${table(['Staff', 'Tips'], (sum.byStaff || sum.staff).map((x) => [E(x.name || x.waiterName || ''), money(x.total ?? x.amount)]))}` : '');
    $('#go').onclick = () => { pg.dataset.from = $('#f').value; pg.dataset.to = $('#t').value; V.tips(pg); };
    const al = $('#al'); if (al) al.onclick = () => api(async () => { if (!await UI.confirmDialog({ title: 'Share tips?', message: 'Tips in this period are split between staff using your tip settings.' })) return; await Api.post('/restaurant/tips/allocate', { branchId: S.branch, from: new Date($('#f').value).toISOString(), to: new Date($('#t').value + 'T23:59:59').toISOString() }); UI.toast.success('Tips shared'); V.tips(pg); });
    const po = $('#po'); if (po) po.onclick = () => api(async () => { if (!await UI.confirmDialog({ title: 'Pay out tips?', message: `Mark ${toPay.length} tips as paid to staff.` })) return; await Api.post('/restaurant/tips/payout', { tipIds: toPay.map((x) => x._id) }); UI.toast.success('Tips paid out'); V.tips(pg); });
  };

  /* ---------- Photos: wrap the menu and room-setup screens ---------- */
  const thumb = (u) => u ? `<img src="${E(u)}" alt="" style="width:44px;height:44px;border-radius:10px;object-fit:cover;vertical-align:middle;margin-right:8px">` : '';
  async function upload(path, files, field) { const fd = new FormData(); files.forEach((f) => fd.append(field, f)); await Api.upload(path, fd); }
  const baseMenu = V.menu; V.menu = async (pg) => {
    await baseMenu(pg); let items = []; try { items = await all('/restaurant/menu/items'); } catch (e) { return; }
    pg.querySelectorAll('[data-ed]').forEach((b) => { const it = items.find((i) => i._id === b.dataset.ed); if (!it) return; const row = b.closest('tr'); if (it.image) row.firstElementChild.insertAdjacentHTML('afterbegin', thumb(it.image));
      b.insertAdjacentHTML('afterend', ` <button class="btn btn-sm btn-secondary" data-ph="${it._id}">Photo</button>`); b.nextElementSibling.onclick = async () => { const [f] = await pickFile('image/*'); if (!f) return; api(async () => { await upload(`/restaurant/menu/items/${it._id}/image`, [f], 'image'); UI.toast.success('Photo saved'); V.menu(pg); }); }; });
  };
  const baseRooms = V.roomsetup; V.roomsetup = async (pg) => {
    await baseRooms(pg);
    pg.querySelectorAll('[data-ed]').forEach((b) => { b.insertAdjacentHTML('afterend', ` <button class="btn btn-sm btn-secondary" data-ph="${b.dataset.ed}">Photos</button>`); b.nextElementSibling.onclick = async () => { const fs = await pickFile('image/*', true); if (!fs.length) return; api(async () => { await upload(`/accommodation/room-types/${b.dataset.ed}/images`, fs.slice(0, 8), 'images'); UI.toast.success('Photos saved'); }); }; });
  };
})();
