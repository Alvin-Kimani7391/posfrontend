/**
 * hx-menu.js - the menu manager. Dishes, sizes, prices per order type, station routing, sold-out, extras (modifier groups).
 * API: /restaurant/menu/items, /restaurant/menu/groups, /restaurant/stations, /categories, POST .../sold-out
 */
(function () {
  const { E, M, can, get, send, list, head, pill, formModal, unwrap } = window.HX;
  let el, items = [], groups = [], stations = [], cats = [], tab = 'dishes', q = '';
  document.addEventListener('DOMContentLoaded', init);
  async function init() { el = window.HX.mount('Menu'); if (!el) return; await window.AppShell.whenProfileReady?.(); load(); }

  async function load() {
    // The API allows at most 100 per page (asking for 200 returns a 400 = an EMPTY menu), so walk the pages.
    const [g, s, c] = await Promise.all([get('/restaurant/menu/groups'), get('/restaurant/stations', { branchId: window.HX.branchId() }), get('/categories', { limit: 100 })]);
    items = [];
    for (let page = 1; page <= 20; page++) {
      const d = await get('/restaurant/menu/items', { limit: 100, page });
      const got = list(d, 'items'); items.push(...got);
      const pages = d && ((d.pagination && d.pagination.pages) || d.pages); if (got.length < 100 || (pages && page >= pages)) break;
    }
    groups = list(g, 'groups'); stations = list(s, 'stations'); cats = list(c, 'categories'); paint();
  }

  function paint() {
    el.innerHTML = head('Menu', 'What you sell, what it costs and which station cooks it.', `<button class="btn btn-secondary" id="ng">New extras group</button><button class="btn btn-primary" id="ni">New dish</button>`) + window.HX.tabs([['dishes', 'Dishes'], ['groups', 'Extras & options']], tab) + '<div id="mb"></div>';
    el.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => { tab = b.dataset.tab; paint(); }));
    el.querySelector('#ni').onclick = () => dishForm(); el.querySelector('#ng').onclick = () => groupForm();
    const mb = el.querySelector('#mb');
    if (tab === 'groups') { mb.innerHTML = groups.length ? `<div class="hx-card flush">${groups.map((g) => `<div class="hx-row"><div class="grow"><b>${E(g.name)}</b><small class="hx-sub">${(g.options || []).map((o) => E(o.name) + (o.priceDelta ? ' (+' + M(o.priceDelta) + ')' : '')).join(', ')}</small></div>${g.required ? pill('required', 'warn') : ''}<button class="btn btn-sm btn-secondary" data-g="${g._id}">Edit</button></div>`).join('')}</div>` : window.HX.empty('No extras yet', 'Groups like “Cooking level” or “Add-ons” appear when waiters add a dish.'); mb.querySelectorAll('[data-g]').forEach((b) => b.onclick = () => groupForm(groups.find((x) => x._id === b.dataset.g))); return; }
    mb.innerHTML = `<input class="input" id="sq" placeholder="Search dishes" value="${E(q)}" style="max-width:320px;margin-bottom:var(--space-3)"><div id="dl"></div>`;
    mb.querySelector('#sq').addEventListener('input', window.UI.debounce((e) => { q = e.target.value; rows(); }, 200)); rows();
  }
  function rows() {
    const v = items.filter((i) => i.name.toLowerCase().includes(q.toLowerCase())), box = el.querySelector('#dl');
    box.innerHTML = v.length ? `<div class="hx-card flush">${v.map((i) => `<div class="hx-row"><div class="grow"><b>${E(i.name)}</b><small class="hx-sub">${E((cats.find((c) => c._id === i.categoryId) || {}).name || 'No category')} · ${E(i.stationCode || 'default station')}${(i.variants || []).length ? ' · ' + i.variants.length + ' sizes' : ''}</small></div>
      <span class="hx-money">${M(i.basePrice)}</span>${i.soldOut ? pill('sold out', 'bad') : ''}
      ${can('restaurant.menu.soldout') ? `<button class="btn btn-sm btn-secondary" data-so="${i._id}" data-v="${i.soldOut ? 0 : 1}">${i.soldOut ? 'Back in stock' : 'Sold out'}</button>` : ''}<button class="btn btn-sm btn-secondary" data-e="${i._id}">Edit</button></div>`).join('')}</div>` : window.HX.empty('No dishes', 'Add your first dish.');
    box.querySelectorAll('[data-e]').forEach((b) => b.onclick = () => dishForm(items.find((x) => x._id === b.dataset.e)));
    box.querySelectorAll('[data-so]').forEach((b) => b.onclick = async () => { if (await send('post', `/restaurant/menu/items/${b.dataset.so}/sold-out`, { soldOut: b.dataset.v === '1' })) load(); });
  }

  function dishForm(it) {
    const tp = (it && it.typePrices) || {};
    formModal({ title: it ? 'Edit dish' : 'New dish', maxWidth: '560px', fields: [
      { name: 'name', label: 'Name', required: true, value: it && it.name }, { name: 'description', label: 'Description', type: 'textarea', value: it && it.description },
      { row: [{ name: 'basePrice', label: 'Price', type: 'number', step: '0.01', min: 0, required: true, value: it && it.basePrice }, { name: 'categoryId', label: 'Category', type: 'select', options: [['', 'None'], ...cats.map((c) => [c._id, c.name])], value: it && it.categoryId }] },
      { row: [{ name: 'stationCode', label: 'Cooked at', type: 'select', options: [['', 'Default station'], ...stations.map((s) => [s.code, s.name])], value: it && it.stationCode }, { name: 'prepMinutes', label: 'Prep time (min)', type: 'number', min: 0, value: it && it.prepMinutes }] },
      { heading: 'Different prices (optional)' }, { row: [{ name: 'takeaway', label: 'Takeaway', type: 'number', step: '0.01', value: tp.takeaway }, { name: 'delivery', label: 'Delivery', type: 'number', step: '0.01', value: tp.delivery }] },
      { heading: 'Sizes (optional)' }, { name: 'variants', label: 'One per line: Name, Price', type: 'textarea', placeholder: 'Small, 350\nLarge, 550', value: it && (it.variants || []).map((v) => `${v.name}, ${v.price != null ? v.price : ''}`).join('\n') },
      { name: 'modifierGroupIds', label: 'Extras groups', type: 'select', options: [['', 'None'], ...groups.map((g) => [g._id, g.name])], value: it && (it.modifierGroupIds || [])[0], hint: 'Pick one group; add more by editing again later.' },
    ], onSubmit: async (v) => {
      const body = { name: v.name, basePrice: v.basePrice, ...(v.description ? { description: v.description } : {}), ...(v.categoryId ? { categoryId: v.categoryId } : {}), ...(v.stationCode ? { stationCode: v.stationCode } : {}), ...(v.prepMinutes != null ? { prepMinutes: v.prepMinutes } : {}) };
      if (v.takeaway != null || v.delivery != null) body.typePrices = { ...(v.takeaway != null ? { takeaway: v.takeaway } : {}), ...(v.delivery != null ? { delivery: v.delivery } : {}) };
      if (v.variants) body.variants = v.variants.split('\n').map((l) => l.split(',')).filter((p) => p[0].trim()).map((p) => ({ name: p[0].trim(), ...(p[1] && !isNaN(p[1]) ? { price: Number(p[1]) } : {}) }));
      if (v.modifierGroupIds) body.modifierGroupIds = [v.modifierGroupIds];
      const r = it ? await send('put', '/restaurant/menu/items/' + it._id, body) : await send('post', '/restaurant/menu/items', body);
      if (r) { window.UI.toast.success('Saved'); load(); return true; } return false;
    } });
  }

  function groupForm(g) {
    formModal({ title: g ? 'Edit extras group' : 'New extras group', fields: [
      { name: 'name', label: 'Group name', required: true, value: g && g.name, placeholder: 'Cooking level' },
      { row: [{ name: 'required', label: 'Guest must choose', type: 'checkbox', value: g && g.required }, { name: 'max', label: 'Max choices', type: 'number', min: 0, value: g && g.max }] },
      { name: 'options', label: 'Options, one per line: Name, extra price', type: 'textarea', required: true, placeholder: 'Rare\nMedium\nWell done\nExtra cheese, 50', value: g && (g.options || []).map((o) => `${o.name}${o.priceDelta ? ', ' + o.priceDelta : ''}`).join('\n') },
    ], onSubmit: async (v) => {
      const body = { name: v.name, required: !!v.required, ...(v.max != null ? { max: v.max } : {}), options: v.options.split('\n').map((l) => l.split(',')).filter((p) => p[0].trim()).map((p) => ({ name: p[0].trim(), ...(p[1] && !isNaN(p[1]) ? { priceDelta: Number(p[1]) } : {}) })) };
      const r = g ? await send('put', '/restaurant/menu/groups/' + g._id, body) : await send('post', '/restaurant/menu/groups', body);
      if (r) { load(); return true; } return false;
    } });
  }
})();
