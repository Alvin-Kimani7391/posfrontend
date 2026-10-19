/** hx-stock.js - Ingredients & recipes: where the owner tracks kitchen stock (Stock, Running low, Usage log, Recipes). */
(function () {
  const { E, M, can, get, send, list, head, pill, formModal, dt } = window.HX;
  let el, ings = [], tab = 'stock', rowsStock = [];
  const TYPE = { OPENING: ['Opening stock', 'plan'], RECEIPT: ['Delivery received', 'ok'], TRANSFER_IN: ['Moved in', 'ok'], TRANSFER_OUT: ['Moved out', 'mute'], CONSUMPTION: ['Used in a sold dish', 'busy'], CONSUMPTION_REVERSAL: ['Sale reversed', 'ok'], WASTE: ['Wasted', 'bad'], SPOILAGE: ['Spoiled', 'bad'], EXPIRED: ['Expired', 'bad'], STAFF_MEAL: ['Staff meal', 'warn'], COMPLIMENTARY: ['Complimentary', 'warn'], ADJUSTMENT: ['Adjusted', 'plan'], COUNT_ADJUSTMENT: ['Stock count', 'plan'] };
  const LOC = { STORE: 'Store', KITCHEN: 'Kitchen', BAR: 'Bar' };
  const fmt = (n, unit) => { n = Number(n) || 0; if (unit === 'g' && Math.abs(n) >= 1000) return `${+(n / 1000).toFixed(2)} kg`; if (unit === 'ml' && Math.abs(n) >= 1000) return `${+(n / 1000).toFixed(2)} l`; return `${+n.toFixed(2)} ${unit === 'piece' ? (Math.abs(n) === 1 ? 'piece' : 'pieces') : unit}`; };
  const U = () => window.HX.UNITS || { g: ['g', 'kg'], ml: ['ml', 'litre'], piece: ['piece', 'dozen'] };
  const unitOpts = (base) => (U()[base] || [base]).map((u) => [u, u]);
  document.addEventListener('DOMContentLoaded', init);
  async function init() { el = window.HX.mount('Ingredients & recipes'); if (!el) return; await window.AppShell.whenProfileReady?.(); shell(); load(); }
  function shell() {
    el.innerHTML = head('Ingredients & recipes', 'What is in the store and kitchen, what each dish uses, and what has been used up.',
      `${can('restaurant.ingredients.waste') ? '<button class="btn btn-secondary" id="wa">Record waste</button>' : ''}${can('restaurant.ingredients.adjust') ? '<button class="btn btn-secondary" id="ad">Adjust stock</button>' : ''}${can('restaurant.ingredients.receive') ? '<button class="btn btn-secondary" id="rc">Receive delivery</button>' : ''}${can('restaurant.ingredients.manage') ? '<button class="btn btn-primary" id="ni">New ingredient</button>' : ''}`)
      + '<div id="sum"></div>' + window.HX.tabs([['stock', 'Stock'], ['low', 'Running low'], ['usage', 'Usage log'], ['recipes', 'Recipes']], tab) + '<div id="sb"></div>';
    el.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => { tab = b.dataset.tab; el.querySelectorAll('[data-tab]').forEach((x) => x.classList.toggle('on', x === b)); body(); }));
    const on = (id, f) => el.querySelector('#' + id)?.addEventListener('click', f); on('ni', newIng); on('rc', receive); on('wa', waste); on('ad', adjust);
  }
  async function load() {
    const [i, s] = await Promise.all([get('/restaurant/ingredients', { limit: 200 }), get('/restaurant/ingredients/stock', { branchId: window.HX.branchId(), limit: 200 })]);
    ings = list(i, 'items', 'ingredients'); rowsStock = list(s, 'items', 'stock', 'ingredients');
    const lowN = rowsStock.filter((r) => r.low || r.negative).length;
    el.querySelector('#sum').innerHTML = `<div class="hx-stats"><div class="hx-stat"><small>Ingredients</small><b>${ings.length}</b></div><div class="hx-stat"><small>Stock value</small><b>${s && s.totalValue != null ? M(s.totalValue) : '—'}</b></div><div class="hx-stat ${lowN ? 'warn' : ''}"><small>Running low</small><b>${lowN}</b></div></div>`;
    body();
  }
  function body() {
    const sb = el.querySelector('#sb');
    if (tab === 'recipes') return recipes(sb); if (tab === 'low') return low(sb); if (tab === 'usage') return usage(sb);
    if (!ings.length) { sb.innerHTML = window.HX.empty('No ingredients yet', 'Add ingredients like rice, chicken or cooking oil, then receive your first delivery.'); return; }
    const shown = rowsStock.length ? rowsStock : ings.map((i) => ({ name: i.name, baseUnit: i.baseUnit, quantity: 0, byLocation: [] }));
    sb.innerHTML = `<div class="hx-card flush">${shown.map((r) => `<div class="hx-row"><div class="grow"><b>${E(r.name)}</b><small class="hx-sub">${(r.byLocation || []).filter((l) => l.quantity).map((l) => `${LOC[l.location] || l.location}: ${fmt(l.quantity, r.baseUnit)}`).join(' · ') || 'Nothing in stock'}${r.lowStockLevel ? ` · reorder at ${fmt(r.lowStockLevel, r.baseUnit)}` : ''}</small></div>${r.negative ? pill('below zero', 'bad') : r.low ? pill('low', 'warn') : ''}${r.value ? `<span class="hx-sub">${M(r.value)}</span>` : ''}<span class="hx-money">${fmt(r.quantity, r.baseUnit)}</span></div>`).join('')}</div>`;
  }
  async function low(sb) {
    sb.innerHTML = '<div class="hx-card"><p class="hx-sub">Checking…</p></div>';
    const d = await get('/restaurant/ingredients/replenishment', { branchId: window.HX.branchId() }); const rows = list(d, 'items', 'suggestions', 'ingredients', 'replenishment');
    sb.innerHTML = rows.length ? `<div class="hx-card flush">${rows.map((r) => { const u = r.baseUnit || r.unit || ''; const need = r.suggested != null ? r.suggested : r.needed != null ? r.needed : r.orderQty; return `<div class="hx-row"><div class="grow"><b>${E(r.name || r.ingredientName || '')}</b><small class="hx-sub">${r.quantity != null ? 'On hand ' + fmt(r.quantity, u) + ' · ' : ''}${need != null ? 'Order about ' + fmt(need, u) : ''}</small></div>${pill('low', 'warn')}</div>`; }).join('')}</div>` : window.HX.empty('All stocked up', 'Nothing is below its reorder level.');
  }
  async function usage(sb) {
    sb.innerHTML = '<div class="hx-card"><p class="hx-sub">Loading…</p></div>';
    const d = await get('/restaurant/ingredients/movements', { branchId: window.HX.branchId(), limit: 100 }); const rows = list(d, 'items', 'movements');
    sb.innerHTML = rows.length ? `<div class="hx-card flush">${rows.map((r) => { const ing = r.ingredientId || {}, t = TYPE[r.type] || [r.type, 'mute'], u = ing.baseUnit || ''; return `<div class="hx-row"><div class="grow"><b>${E(ing.name || 'Ingredient')}</b><small class="hx-sub">${pill(t[0], t[1])} ${dt(r.createdAt)}${r.performedBy && r.performedBy.name ? ' · ' + E(r.performedBy.name) : ''}${r.reason ? ' · ' + E(r.reason) : ''}</small></div><span class="hx-money" style="color:${r.quantity < 0 ? 'var(--color-danger)' : 'var(--color-success)'}">${r.quantity > 0 ? '+' : ''}${fmt(r.quantity, u)}</span><small class="hx-sub">left ${fmt(r.newQty, u)}</small></div>`; }).join('')}</div>` : window.HX.empty('No movements yet', 'Deliveries, dishes sold, waste and adjustments are listed here as they happen.');
  }
  async function recipes(sb) {
    sb.innerHTML = '<div class="hx-card"><p class="hx-sub">Loading…</p></div>';
    const dishes = []; for (let page = 1; page <= 20; page++) { const d = await get('/restaurant/menu/items', { limit: 100, page }); const got = list(d, 'items'); dishes.push(...got); if (got.length < 100) break; }
    sb.innerHTML = dishes.length ? `<div class="hx-card flush">${dishes.map((i) => `<div class="hx-row"><div class="grow"><b>${E(i.name)}</b><small class="hx-sub">${M(i.basePrice)}</small></div>${i.stockMode === 'RECIPE' ? pill('stock tracked', 'plan') : pill('no ingredients set', 'mute')}${can('restaurant.recipes.manage') ? `<button class="btn btn-sm btn-secondary" data-r="${i._id}">${i.stockMode === 'RECIPE' ? 'Edit ingredients' : 'Set ingredients'}</button>` : ''}</div>`).join('')}</div>` : window.HX.empty('No dishes', 'Add dishes in Menu first.');
    sb.querySelectorAll('[data-r]').forEach((b) => b.addEventListener('click', () => window.HX.recipe.open(dishes.find((x) => x._id === b.dataset.r), { onSaved: () => recipes(sb) })));
  }
  const ingSelect = () => ({ name: 'ingredientId', label: 'Ingredient', type: 'select', options: ings.map((i) => [i._id, `${i.name} (${i.baseUnit})`]) });
  const baseOf = (id) => (ings.find((i) => i._id === id) || {}).baseUnit;
  function newIng() {
    formModal({ title: 'New ingredient', fields: [{ name: 'name', label: 'Name', required: true }, { row: [{ name: 'baseUnit', label: 'Stock is counted in', type: 'select', options: [['g', 'Grams (g)'], ['ml', 'Millilitres (ml)'], ['piece', 'Pieces']] }, { name: 'purchaseUnit', label: 'Usually bought by', type: 'select', options: [['', 'Same unit'], ['kg', 'Kilogram'], ['litre', 'Litre'], ['dozen', 'Dozen']] }] },
      { row: [{ name: 'cost', label: 'Cost (optional)', type: 'number', step: '0.01', min: 0 }, { name: 'per', label: 'Cost is per', type: 'select', options: [['', 'Counting unit'], ['kg', 'kg'], ['litre', 'litre'], ['dozen', 'dozen']] }] },
      { name: 'reorderLevel', label: 'Warn me when stock falls below (in the counting unit)', type: 'number', min: 0 }],
      onSubmit: async (v) => {
        const body = { name: v.name, baseUnit: v.baseUnit, ...(v.purchaseUnit ? { purchaseUnit: v.purchaseUnit } : {}), ...(v.reorderLevel != null ? { reorderLevel: v.reorderLevel, lowStockLevel: v.reorderLevel } : {}) };
        if (v.cost != null) { const per = v.per || v.baseUnit; if ((U()[v.baseUnit] || []).indexOf(per) < 0) { window.UI.toast.warning(`Cost per ${per} does not match an ingredient counted in ${v.baseUnit}`); return false; } body.cost = { amountCents: v.cost, per }; }
        if (v.purchaseUnit && (U()[v.baseUnit] || []).indexOf(v.purchaseUnit) < 0) { window.UI.toast.warning('Bought-by unit does not match the counting unit'); return false; }
        if (await send('post', '/restaurant/ingredients', body)) { window.UI.toast.success('Ingredient added'); load(); return true; } return false;
      } });
  }
  function receive() {
    if (!ings.length) return window.UI.toast.info('Add an ingredient first');
    const mEl = formModal({ title: 'Receive delivery', fields: [ingSelect(), { row: [{ name: 'quantity', label: 'Quantity received', type: 'number', min: 0, step: 'any', required: true }, { name: 'unit', label: 'Unit', type: 'select', options: unitOpts(baseOf(ings[0]._id)) }] }, { name: 'unitCostCents', label: 'Cost per unit above', type: 'number', min: 0, step: '0.01', required: true }, { row: [{ name: 'expiryDate', label: 'Expiry date', type: 'date' }, { name: 'location', label: 'Put in', type: 'select', options: [['STORE', 'Store'], ['KITCHEN', 'Kitchen'], ['BAR', 'Bar']] }] }, { name: 'invoiceNumber', label: 'Invoice no. (optional)' }],
      onSubmit: async (v) => { const body = { branchId: window.HX.branchId(), ...(v.invoiceNumber ? { invoiceNumber: v.invoiceNumber } : {}), lines: [{ ingredientId: v.ingredientId, quantity: v.quantity, unit: v.unit, unitCostCents: v.unitCostCents, location: v.location, ...(v.expiryDate ? { expiryDate: v.expiryDate } : {}) }] }; if (await send('post', '/restaurant/ingredients/receive', body)) { window.UI.toast.success('Stock received'); load(); return true; } return false; } });
    const sel = mEl.querySelector('#f_ingredientId'), un = mEl.querySelector('#f_unit');
    if (sel && un) sel.addEventListener('change', () => { un.innerHTML = unitOpts(baseOf(sel.value)).map(([u]) => `<option>${u}</option>`).join(''); });
  }
  function waste() {
    if (!ings.length) return window.UI.toast.info('Add an ingredient first');
    formModal({ title: 'Record waste', fields: [ingSelect(), { row: [{ name: 'quantity', label: 'Quantity (counting unit)', type: 'number', min: 0, step: 'any', required: true }, { name: 'kind', label: 'Why', type: 'select', options: [['WASTE', 'Wasted'], ['SPOILAGE', 'Spoiled'], ['EXPIRED', 'Expired'], ['STAFF_MEAL', 'Staff meal'], ['REMAKE', 'Remade dish']] }] }, { name: 'reason', label: 'Note', required: true }],
      onSubmit: async (v) => { if (await send('post', '/restaurant/ingredients/waste', { ...v, branchId: window.HX.branchId() })) { window.UI.toast.success('Waste recorded'); load(); return true; } return false; } });
  }
  function adjust() {
    if (!ings.length) return window.UI.toast.info('Add an ingredient first');
    formModal({ title: 'Adjust stock', intro: 'Use this for opening stock or to correct a miscount. Quantity is in the ingredient’s counting unit.', fields: [ingSelect(), { row: [{ name: 'direction', label: 'Change', type: 'select', options: [['IN', 'Add to stock'], ['OUT', 'Remove from stock']] }, { name: 'quantity', label: 'Quantity', type: 'number', min: 0, step: 'any', required: true }] }, { name: 'location', label: 'Where', type: 'select', options: [['STORE', 'Store'], ['KITCHEN', 'Kitchen'], ['BAR', 'Bar']] }, { name: 'reason', label: 'Reason', required: true, value: 'Opening stock' }],
      onSubmit: async (v) => { if (await send('post', '/restaurant/ingredients/adjust', { ...v, branchId: window.HX.branchId() })) { window.UI.toast.success('Stock adjusted'); load(); return true; } return false; } });
  }
})();
