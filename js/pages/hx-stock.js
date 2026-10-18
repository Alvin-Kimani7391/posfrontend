/**
 * hx-stock.js - ingredients, stock levels, deliveries, waste and recipes.
 * API: /restaurant/ingredients (+/stock, /receive, /waste, /replenishment), /restaurant/recipes, /restaurant/menu/items
 * Recipes link a dish to the ingredients it uses so stock drops as dishes are sold and food cost is known.
 */
(function () {
  const { E, M, can, get, send, list, head, pill, formModal, ymd } = window.HX;
  let el, ings = [], stock = [], tab = 'stock';
  const nm = (r) => r.name || r.ingredientName || (r.ingredient && r.ingredient.name) || '';
  const qty = (r) => (r.quantity != null ? r.quantity : r.onHand != null ? r.onHand : r.total != null ? r.total : '');
  const unitOf = (r) => r.baseUnit || (r.ingredient && r.ingredient.baseUnit) || r.unit || '';
  document.addEventListener('DOMContentLoaded', init);
  async function init() { el = window.HX.mount('Ingredients & recipes'); if (!el) return; await window.AppShell.whenProfileReady?.(); load(); }

  async function load() {
    const [i, s] = await Promise.all([get('/restaurant/ingredients', { limit: 200 }), get('/restaurant/ingredients/stock', { branchId: window.HX.branchId(), limit: 200 })]);
    ings = list(i, 'ingredients'); stock = list(s, 'stock', 'items', 'ingredients'); paint();
  }

  function paint() {
    const m = can('restaurant.ingredients.manage');
    el.innerHTML = head('Ingredients & recipes', 'What is in the store and kitchen, and what each dish uses.',
      `${can('restaurant.ingredients.waste') ? '<button class="btn btn-secondary" id="wa">Record waste</button>' : ''}${can('restaurant.ingredients.receive') ? '<button class="btn btn-secondary" id="rc">Receive delivery</button>' : ''}${m ? '<button class="btn btn-primary" id="ni">New ingredient</button>' : ''}`) +
      window.HX.tabs([['stock', 'Stock'], ['low', 'Running low'], ['recipes', 'Recipes']], tab) + '<div id="sb"></div>';
    el.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => { tab = b.dataset.tab; paint(); }));
    el.querySelector('#ni')?.addEventListener('click', newIng); el.querySelector('#rc')?.addEventListener('click', receive); el.querySelector('#wa')?.addEventListener('click', waste);
    const sb = el.querySelector('#sb');
    if (tab === 'recipes') return recipes(sb);
    if (tab === 'low') return low(sb);
    const rows = stock.length ? stock : ings;
    sb.innerHTML = rows.length ? `<div class="hx-card flush">${rows.map((r) => `<div class="hx-row"><div class="grow"><b>${E(nm(r))}</b><small class="hx-sub">${E(unitOf(r))}</small></div><span class="hx-money">${qty(r)} ${E(unitOf(r))}</span></div>`).join('')}</div>` : window.HX.empty('No ingredients', 'Add ingredients, then receive your first delivery.');
  }

  async function low(sb) {
    sb.innerHTML = '<div class="hx-card"><p class="hx-sub">Checking…</p></div>';
    const d = await get('/restaurant/ingredients/replenishment', { branchId: window.HX.branchId() }); const rows = list(d, 'items', 'ingredients', 'replenishment');
    sb.innerHTML = rows.length ? `<div class="hx-card flush">${rows.map((r) => `<div class="hx-row"><div class="grow"><b>${E(nm(r))}</b><small class="hx-sub">Order about ${r.suggested != null ? r.suggested : r.needed != null ? r.needed : ''} ${E(unitOf(r))}</small></div>${pill('low', 'warn')}</div>`).join('')}</div>` : window.HX.empty('All stocked up', 'Nothing is below its reorder level.');
  }

  async function recipes(sb) {
    const d = await get('/restaurant/menu/items', { limit: 200 }); const dishes = list(d, 'items');
    sb.innerHTML = dishes.length ? `<div class="hx-card flush">${dishes.map((i) => `<div class="hx-row"><div class="grow"><b>${E(i.name)}</b><small class="hx-sub">${M(i.basePrice)}</small></div><button class="btn btn-sm btn-secondary" data-r="${i._id}">Set recipe</button></div>`).join('')}</div>` : window.HX.empty('No dishes', 'Add dishes in Menu first.');
    sb.querySelectorAll('[data-r]').forEach((b) => b.addEventListener('click', () => recipeForm(dishes.find((x) => x._id === b.dataset.r))));
  }

  function newIng() {
    formModal({ title: 'New ingredient', fields: [{ name: 'name', label: 'Name', required: true }, { row: [{ name: 'baseUnit', label: 'Counted in', type: 'select', options: [['g', 'Grams'], ['ml', 'Millilitres'], ['piece', 'Pieces']] }, { name: 'reorderLevel', label: 'Reorder when below', type: 'number', min: 0 }] }, { name: 'cost', label: 'Cost per purchase unit (optional)', type: 'number', step: '0.01', min: 0 }],
      onSubmit: async (v) => { const body = { name: v.name, baseUnit: v.baseUnit, ...(v.reorderLevel != null ? { reorderLevel: v.reorderLevel } : {}), ...(v.cost != null ? { cost: { amountCents: v.cost } } : {}) }; if (await send('post', '/restaurant/ingredients', body)) { load(); return true; } return false; } });
  }
  function receive() {
    if (!ings.length) return window.UI.toast.info('Add an ingredient first');
    formModal({ title: 'Receive delivery', fields: [{ name: 'ingredientId', label: 'Ingredient', type: 'select', options: ings.map((i) => [i._id, i.name]) }, { row: [{ name: 'quantity', label: 'Quantity', type: 'number', min: 0, step: 'any', required: true }, { name: 'unitCostCents', label: 'Cost per unit', type: 'number', min: 0, step: '0.01', required: true }] }, { row: [{ name: 'expiryDate', label: 'Expiry date', type: 'date' }, { name: 'location', label: 'Put in', type: 'select', options: [['STORE', 'Store'], ['KITCHEN', 'Kitchen'], ['BAR', 'Bar']] }] }, { name: 'invoiceNumber', label: 'Invoice no. (optional)' }],
      onSubmit: async (v) => { const body = { branchId: window.HX.branchId(), ...(v.invoiceNumber ? { invoiceNumber: v.invoiceNumber } : {}), lines: [{ ingredientId: v.ingredientId, quantity: v.quantity, unitCostCents: v.unitCostCents, location: v.location, ...(v.expiryDate ? { expiryDate: v.expiryDate } : {}) }] }; if (await send('post', '/restaurant/ingredients/receive', body)) { window.UI.toast.success('Stock received'); load(); return true; } return false; } });
  }
  function waste() {
    if (!ings.length) return window.UI.toast.info('Add an ingredient first');
    formModal({ title: 'Record waste', fields: [{ name: 'ingredientId', label: 'Ingredient', type: 'select', options: ings.map((i) => [i._id, i.name]) }, { row: [{ name: 'quantity', label: 'Quantity', type: 'number', min: 0, step: 'any', required: true }, { name: 'kind', label: 'Why', type: 'select', options: [['WASTE', 'Wasted'], ['SPOILAGE', 'Spoiled'], ['EXPIRED', 'Expired'], ['STAFF_MEAL', 'Staff meal'], ['REMAKE', 'Remade dish']] }] }, { name: 'reason', label: 'Note', required: true }],
      onSubmit: async (v) => { if (await send('post', '/restaurant/ingredients/waste', { ...v, branchId: window.HX.branchId() })) { load(); return true; } return false; } });
  }
  function recipeForm(dish) {
    if (!ings.length) return window.UI.toast.info('Add ingredients first');
    formModal({ title: `Recipe: ${dish.name}`, maxWidth: '520px', intro: 'One ingredient per line: name, quantity. Quantities use each ingredient’s counted unit (g, ml or pieces).', fields: [{ name: 'lines', label: 'Ingredients used for one portion', type: 'textarea', required: true, placeholder: ings.slice(0, 2).map((i) => `${i.name}, 100`).join('\n') }, { name: 'yieldPortions', label: 'Portions this makes', type: 'number', value: 1, min: 1 }],
      onSubmit: async (v) => {
        const lines = []; for (const l of v.lines.split('\n')) { const [n, qn] = l.split(',').map((x) => x.trim()); if (!n) continue; const ing = ings.find((i) => i.name.toLowerCase() === n.toLowerCase()); if (!ing || !(Number(qn) > 0)) { window.UI.toast.warning(`Check this line: ${l}`); return false; } lines.push({ ingredientId: ing._id, quantity: Number(qn) }); }
        if (await send('post', '/restaurant/recipes', { menuItemId: dish._id, yieldPortions: v.yieldPortions || 1, lines })) { window.UI.toast.success('Recipe saved'); return true; } return false;
      } });
  }
})();
