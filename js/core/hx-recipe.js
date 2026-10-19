/** hx-recipe.js - recipe editor modal: which ingredients one portion of a dish uses (stock then drops on every sale). HX.recipe.open(dish,{onSaved}) */
(function (window) {
  const HX = window.HX; if (!HX) return;
  const { E, M, get, send, list, unwrap } = HX;
  const UNITS = { g: ['g', 'kg'], ml: ['ml', 'litre', 'tsp', 'tbsp', 'cup'], piece: ['piece', 'dozen'] };
  HX.UNITS = UNITS;
  async function open(dish, opts = {}) {
    const [ingD, cur] = await Promise.all([get('/restaurant/ingredients', { limit: 200 }), get('/restaurant/recipes', { menuItemId: dish._id })]);
    const ings = list(ingD, 'items', 'ingredients');
    if (!ings.length) return window.UI.toast.info('Add your ingredients first (Ingredients & recipes → New ingredient).');
    const recipe = (cur && (cur.recipe || (cur.data && cur.data.recipe))) || null;
    let rows = ((recipe && recipe.lines) || []).map((l) => ({ id: String((l.ingredientId && l.ingredientId._id) || l.ingredientId), q: l.displayQuantity != null ? l.displayQuantity : l.quantity, u: l.displayUnit }));
    if (!rows.length) rows = [{ id: ings[0]._id, q: '', u: '' }];
    let portions = (recipe && recipe.yieldPortions) || 1, root;
    const ingOf = (id) => ings.find((i) => String(i._id) === String(id)) || ings[0];
    const m = HX.modal({ title: `Ingredients for ${dish.name}`, maxWidth: '620px', cls: 'hx-modal-recipe', body: '<div id="rc-b"></div>',
      footer: '<button class="btn btn-secondary" data-c>Cancel</button><button class="btn btn-primary" id="rc-save">Save recipe</button>',
      onMount(el, close) {
        root = el; paint(); el.querySelector('[data-c]').addEventListener('click', close);
        el.querySelector('#rc-save').addEventListener('click', async () => {
          read(); const lines = [];
          for (const r of rows) { if (!(Number(r.q) > 0)) { if (r.q === '' || r.q == null) continue; return window.UI.toast.warning('Enter a quantity greater than zero'); } lines.push({ ingredientId: r.id, quantity: Number(r.q), unit: r.u || ingOf(r.id).baseUnit }); }
          if (!lines.length) return window.UI.toast.warning('Add at least one ingredient');
          if (new Set(lines.map((l) => l.ingredientId)).size !== lines.length) return window.UI.toast.warning('An ingredient is listed twice');
          const btn = el.querySelector('#rc-save'); window.UI.setButtonLoading(btn, true, 'Saving…');
          const r = await send('post', '/restaurant/recipes', { menuItemId: dish._id, yieldPortions: portions || 1, lines });
          window.UI.setButtonLoading(btn, false);
          if (r) { window.UI.toast.success('Recipe saved. Stock now drops as this dish is sold.'); if (opts.onSaved) opts.onSaved(unwrap(r, 'recipe')); close(); }
        });
      } });
    function read() { root.querySelectorAll('[data-row]').forEach((tr, i) => { rows[i].id = tr.querySelector('.rc-ing').value; rows[i].q = tr.querySelector('.rc-q').value; rows[i].u = tr.querySelector('.rc-u').value; }); const y = root.querySelector('#rc-y'); if (y) portions = Number(y.value) || 1; }
    function paint() {
      root.querySelector('#rc-b').innerHTML = `<p class="hx-sub" style="margin-bottom:var(--space-3)">List what goes into ONE portion. When this dish is sold, these amounts are taken off your stock.</p>
        <div class="hx-reciperows">${rows.map((r, i) => { const ing = ingOf(r.id), us = UNITS[ing.baseUnit] || [ing.baseUnit]; return `<div class="hx-reciperow" data-row="${i}"><select class="select rc-ing">${ings.map((x) => `<option value="${x._id}" ${String(x._id) === String(r.id) ? 'selected' : ''}>${E(x.name)}</option>`).join('')}</select><input class="input rc-q" type="number" min="0" step="any" placeholder="Qty" value="${E(r.q)}"><select class="select rc-u">${us.map((u) => `<option ${((r.u || ing.baseUnit) === u) ? 'selected' : ''}>${u}</option>`).join('')}</select><button type="button" class="btn btn-sm btn-secondary" data-del="${i}">✕</button></div>`; }).join('')}</div>
        <button type="button" class="btn btn-sm btn-secondary" id="rc-add" style="margin-top:var(--space-2)">+ Add ingredient</button>
        <div class="field" style="margin-top:var(--space-4);max-width:220px"><label>Portions this recipe makes</label><input class="input" id="rc-y" type="number" min="1" value="${portions}"></div>
        ${recipe && recipe.costPerPortion != null ? `<p class="hx-sub">Current cost per portion: <b>${M(recipe.costPerPortion / 100)}</b></p>` : ''}`;
      root.querySelectorAll('.rc-ing').forEach((s) => s.addEventListener('change', () => { read(); rows.forEach((r) => { r.u = ''; }); paint(); }));
      root.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => { read(); rows.splice(+b.dataset.del, 1); if (!rows.length) rows.push({ id: ings[0]._id, q: '', u: '' }); paint(); }));
      root.querySelector('#rc-add').addEventListener('click', () => { read(); const used = new Set(rows.map((r) => String(r.id))); const nx = ings.find((x) => !used.has(String(x._id))) || ings[0]; rows.push({ id: nx._id, q: '', u: '' }); paint(); });
    }
    return m;
  }
  HX.recipe = { open };
})(window);
