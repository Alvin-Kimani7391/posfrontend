/**
 * liquor-product-form.js - ONE form for adding or editing a drink in a wines & spirits shop.
 *
 * A drink is three records on the server: the Product (name, price, photo, unit), the LiquorDetails (category, ABV, bottle size,
 * vintage, excise, returnable container) and its first stock. This form collects all of it in one place and makes the calls in order,
 * so nothing is left half set up:
 *   LiquorProductForm.applies()                      -> true for a wines & spirits business whose user may edit liquor details
 *   LiquorProductForm.open({ product, onDone })      add a drink (no product) or edit one (product from GET /products/:id)
 *
 * Photo: chosen from the gallery or taken with the camera, shrunk on the device (max 400 px, JPEG) and saved on the product, so it
 * also shows on the till and still works with no internet connection.
 * Needs: ui.js, api.js, permissions.js, app-shell.js, liquor-till.js (optional: cached rules + containers for cashier-safe lookups).
 */
(function (window) {
  'use strict';
  const esc = (v) => window.UI.escapeHtml(v == null ? '' : String(v));
  const can = (p) => window.Permissions.can(window.AppShell.getUser(), p);
  const feat = (...k) => !!(window.AppShell.hasFeature && window.AppShell.hasFeature(...k));

  const CATS = [
    ['WINE', 'Wine', true], ['SPARKLING', 'Champagne & sparkling', true], ['WHISKY', 'Whisky', true], ['VODKA', 'Vodka', true], ['GIN', 'Gin', true], ['RUM', 'Rum', true],
    ['BRANDY', 'Brandy & cognac', true], ['TEQUILA', 'Tequila', true], ['LIQUEUR', 'Liqueur', true], ['BEER', 'Beer', true], ['CIDER', 'Cider', true], ['RTD', 'Ready-to-drink', true],
    ['TRADITIONAL', 'Traditional / local', true], ['OTHER_SPIRIT', 'Other spirit', true], ['SOFT_DRINK', 'Soft drink & water', false], ['MIXER', 'Mixer', false], ['SNACK', 'Snack & ice', false], ['OTHER', 'Other', false],
  ];
  const TYPICAL_ABV = { WINE: 12.5, SPARKLING: 12, WHISKY: 40, VODKA: 40, GIN: 40, RUM: 40, BRANDY: 40, TEQUILA: 38, LIQUEUR: 20, BEER: 5, CIDER: 4.5, RTD: 5, TRADITIONAL: 40, OTHER_SPIRIT: 40 };
  const SIZES = [180, 200, 250, 330, 350, 375, 500, 700, 750, 1000, 1500, 1750];
  const SIZE_LABEL = (ml) => (ml >= 1000 ? `${ml / 1000} L` : `${ml} ml`);
  const num = (v) => (v === '' || v == null || Number.isNaN(Number(v)) ? undefined : Number(v));
  const day = (v) => (v ? new Date(v).toISOString().slice(0, 10) : '');
  const sku = () => `LQ-${Date.now().toString(36).toUpperCase().slice(-5)}${Math.random().toString(36).slice(2, 4).toUpperCase()}`;

  const applies = () => feat('liquorCompliance', 'ageVerification', 'emptiesTracking', 'totSales') && (can('liquor.products') || can('products.create'));

  /** Shrink a photo on the device to a small JPEG data URL (no upload service needed, works offline). */
  function shrink(file, max = 400, quality = 0.72) {
    return new Promise((resolve, reject) => {
      if (!file || !/^image\//.test(file.type)) return reject(new Error('Choose an image file'));
      const url = URL.createObjectURL(file); const img = new Image();
      img.onload = () => {
        const k = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(img.width * k)); c.height = Math.max(1, Math.round(img.height * k));
        const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        const out = c.toDataURL('image/jpeg', quality);
        if (out.length > 90000) { const c2 = document.createElement('canvas'); c2.width = Math.round(c.width * 0.7); c2.height = Math.round(c.height * 0.7); c2.getContext('2d').drawImage(c, 0, 0, c2.width, c2.height); return resolve(c2.toDataURL('image/jpeg', 0.7)); }
        return resolve(out);
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That image could not be read')); };
      img.src = url;
    });
  }

  const sec = (title, body) => `<section class="lq-fsec"><h4>${esc(title)}</h4>${body}</section>`;
  const fld = ({ name, label, type = 'text', value = '', req = false, attrs = '', hint = '', cls = '' }) => `<div class="field ${cls}"><label for="lq-${name}">${esc(label)}${req ? ' <span style="color:var(--color-danger)">*</span>' : ''}</label><input class="input" id="lq-${name}" name="${name}" type="${type}" value="${esc(value)}" ${req ? 'required' : ''} ${attrs} />${hint ? `<div class="lq-hint">${hint}</div>` : ''}</div>`;

  async function loadCategories() { try { const { data } = await window.Api.get('/categories'); return data.categories || []; } catch { return []; } }

  async function open({ product, onDone } = {}) {
    const edit = !!product;
    let d = {};
    if (edit) { try { d = (await window.Api.get(`/liquor/products/${product._id}`)).data.details || {}; } catch { d = {}; } }
    const cats = await loadCategories();
    let conts = []; if (feat('emptiesTracking')) { try { conts = (await window.LiquorTill.containers()) || []; } catch { conts = []; } }
    const p = product || {};
    const canDetails = can('liquor.products');
    const canStock = !edit && can('inventory.receive');
    const branchId = window.AppShell.getActiveBranchId();
    const st = { cat: d.category || 'WHISKY', image: p.image || '', imageChanged: false };
    const excise = d.excisePerUnit != null ? d.excisePerUnit : (d.exciseCentsPerUnit != null ? d.exciseCentsPerUnit / 100 : '');

    const body = `<form id="lq-form" class="lq-form" novalidate>
      ${sec('1 · What is it?', `
        <div class="lq-cats" id="lq-cats">${CATS.map(([k, l]) => `<button type="button" class="lq-cat lq-c-${k}" data-cat="${k}" aria-pressed="${k === st.cat}">${esc(l)}</button>`).join('')}</div>
        <div class="lq-grid" style="margin-top:14px">
          ${fld({ name: 'name', label: 'Product name', value: p.name, req: true, cls: 'span2', attrs: 'placeholder="e.g. Johnnie Walker Black Label 750ml" autocomplete="off"' })}
          ${fld({ name: 'brand', label: 'Brand', value: p.brand })}
          ${fld({ name: 'producer', label: 'Producer / distillery', value: d.producer })}
        </div>`)}
      ${sec('2 · Photo', `<div class="lq-photo"><div class="lq-photo-box" id="lq-photo-box">${st.image ? `<img src="${esc(st.image)}" alt="" />` : 'No photo yet'}</div>
        <div><input type="file" id="lq-file" accept="image/*" hidden /><input type="file" id="lq-cam" accept="image/*" capture="environment" hidden />
          <button type="button" class="btn btn-secondary btn-sm" id="lq-pick">Choose photo</button>
          <button type="button" class="btn btn-secondary btn-sm" id="lq-snap">Take photo</button>
          <button type="button" class="btn btn-ghost btn-sm" id="lq-rm" ${st.image ? '' : 'hidden'}>Remove</button>
          <div class="lq-hint">Bottle shot on a plain background works best. It is shrunk on this device and also shows on the till.</div></div></div>`)}
      ${sec('3 · The drink', `<div class="lq-grid">
          ${fld({ name: 'abv', label: 'Alcohol % (ABV)', type: 'number', value: d.abv, attrs: 'min="0" max="100" step="0.1"' })}
          ${fld({ name: 'volumeMl', label: 'Bottle / can size (ml)', type: 'number', value: d.volumeMl, attrs: 'min="1" step="1"', hint: `<div class="lq-pack" id="lq-sizes">${SIZES.map((s) => `<button type="button" data-size="${s}">${SIZE_LABEL(s)}</button>`).join('')}</div>` })}
          ${fld({ name: 'vintage', label: 'Vintage (year)', type: 'number', value: d.vintage, attrs: 'min="1800" max="2100"' })}
          ${fld({ name: 'country', label: 'Country', value: d.country })}
          ${fld({ name: 'region', label: 'Region', value: d.region })}
        </div>
        <label class="checkbox-row" style="margin-top:12px"><input type="checkbox" name="isAlcohol" ${d.isAlcohol === false ? '' : 'checked'} /> <span class="text-sm">Alcoholic: <b>age check applies</b> at the till. Untick for soft drinks, mixers and snacks.</span></label>`)}
      ${sec('4 · Price', `<div class="lq-grid">
          ${fld({ name: 'costPrice', label: 'Buying price per bottle (KES)', type: 'number', value: p.costPrice, attrs: 'min="0" step="0.01"' })}
          ${fld({ name: 'sellingPrice', label: 'Selling price (KES)', type: 'number', value: p.sellingPrice, req: true, attrs: 'min="0" step="0.01"' })}
          ${fld({ name: 'taxRate', label: 'VAT %', type: 'number', value: p.taxRate != null ? p.taxRate : 16, attrs: 'min="0" max="100" step="0.01"' })}
          ${canDetails ? fld({ name: 'excise', label: 'Excise inside the price, per bottle (KES, optional)', type: 'number', value: excise, attrs: 'min="0" step="0.01"', hint: 'Only used for the excise report. Enter it in shillings, not cents.' }) : ''}
        </div><div class="lq-calc" id="lq-calc"></div>`)}
      ${sec('5 · Packs & empties', `<div class="lq-grid">
          ${fld({ name: 'packSize', label: 'Also sold by the case of (bottles)', type: 'number', value: '', attrs: 'min="2" step="1" placeholder="e.g. 12"', hint: 'Leave empty to sell singly only. Stock is always counted in bottles.' })}
          ${fld({ name: 'packName', label: 'Pack name', value: 'Case', attrs: 'maxlength="30"' })}
          ${fld({ name: 'packPrice', label: 'Case selling price (KES, optional)', type: 'number', value: '', attrs: 'min="0" step="0.01"' })}
          ${conts.length && canDetails ? `<div class="field"><label for="lq-containerTypeId">Returnable container</label><select class="select" id="lq-containerTypeId" name="containerTypeId"><option value="">None</option>${conts.map((c) => `<option value="${esc(c._id)}" ${String(d.containerTypeId && (d.containerTypeId._id || d.containerTypeId)) === String(c._id) ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
            ${fld({ name: 'containersPerUnit', label: 'Containers per bottle sold', type: 'number', value: d.containersPerUnit != null ? d.containersPerUnit : 1, attrs: 'min="0" step="1"' })}` : ''}
        </div>`)}
      ${sec('6 · Stock & codes', `<div class="lq-grid">
          ${canStock ? fld({ name: 'stockQty', label: 'Opening stock (bottles)', type: 'number', attrs: 'min="0" step="1" placeholder="0"' }) : ''}
          ${canStock && feat('batchTracking') ? fld({ name: 'batchNumber', label: 'Batch number', attrs: 'placeholder="From the carton"' }) + fld({ name: 'expiryDate', label: 'Best before (optional)', type: 'date' }) : ''}
          ${fld({ name: 'lowStockThreshold', label: 'Reorder level (bottles)', type: 'number', value: p.lowStockThreshold != null ? p.lowStockThreshold : 6, attrs: 'min="0" step="1"' })}
          ${fld({ name: 'barcode', label: 'Barcode', value: p.barcode, hint: 'Scan the bottle, or leave empty to generate one.' })}
          ${fld({ name: 'sku', label: 'SKU', value: p.sku, attrs: `placeholder="auto"` })}
          ${cats.length ? `<div class="field"><label for="lq-categoryId">Shop category (optional)</label><select class="select" id="lq-categoryId" name="categoryId"><option value="">None</option>${cats.map((c) => `<option value="${esc(c._id)}" ${p.categoryId && String(p.categoryId._id || p.categoryId) === String(c._id) ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>` : ''}
        </div>`)}
      <div class="form-alert form-alert-error" id="lq-err" hidden></div>
    </form>`;

    const m = window.UI.openModal({ title: edit ? `Edit ${p.name}` : 'Add a drink', maxWidth: '780px', bodyHtml: body, footerHtml: '<button class="btn btn-secondary" data-x="cancel">Cancel</button><button class="btn btn-primary" data-x="save">Save drink</button>' });
    const form = m.querySelector('#lq-form'); const el = (n) => form.elements[n];
    const v = (n) => (el(n) ? String(el(n).value).trim() : '');
    const showErr = (t) => { const e = m.querySelector('#lq-err'); e.textContent = t; e.hidden = !t; if (t) e.scrollIntoView({ block: 'nearest' }); };

    // category chips
    const paintCats = () => m.querySelectorAll('[data-cat]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.cat === st.cat)));
    m.querySelectorAll('[data-cat]').forEach((b) => b.addEventListener('click', () => {
      st.cat = b.dataset.cat; paintCats();
      const alc = CATS.find((c) => c[0] === st.cat)[2]; el('isAlcohol').checked = alc;
      if (alc && !v('abv') && TYPICAL_ABV[st.cat]) el('abv').value = TYPICAL_ABV[st.cat];
    }));
    m.querySelectorAll('[data-size]').forEach((b) => b.addEventListener('click', () => { el('volumeMl').value = b.dataset.size; calc(); }));

    // photo
    const paintPhoto = () => { m.querySelector('#lq-photo-box').innerHTML = st.image ? `<img src="${esc(st.image)}" alt="" />` : 'No photo yet'; m.querySelector('#lq-rm').hidden = !st.image; };
    const onFile = async (inp) => { const f = inp.files && inp.files[0]; inp.value = ''; if (!f) return; try { st.image = await shrink(f); st.imageChanged = true; paintPhoto(); } catch (e) { window.UI.toast.error(e.message); } };
    m.querySelector('#lq-pick').addEventListener('click', () => m.querySelector('#lq-file').click());
    m.querySelector('#lq-snap').addEventListener('click', () => m.querySelector('#lq-cam').click());
    m.querySelector('#lq-file').addEventListener('change', (e) => onFile(e.target));
    m.querySelector('#lq-cam').addEventListener('change', (e) => onFile(e.target));
    m.querySelector('#lq-rm').addEventListener('click', () => { st.image = ''; st.imageChanged = true; paintPhoto(); });

    // margin + price per litre + price per standard drink
    function calc() {
      const cost = num(v('costPrice')); const sell = num(v('sellingPrice')); const ml = num(v('volumeMl')); const abv = num(v('abv'));
      const box = m.querySelector('#lq-calc'); const bits = []; const M = window.UI.formatMoney;
      if (cost != null && sell != null && sell > 0) bits.push(`<div>Margin<strong>${M(sell - cost)} (${(((sell - cost) / sell) * 100).toFixed(0)}%)</strong></div>`);
      if (sell != null && ml) bits.push(`<div>Per litre<strong>${M((sell / ml) * 1000)}</strong></div>`);
      if (sell != null && ml && abv) bits.push(`<div>Per 100 ml pure alcohol<strong>${M(sell / ((ml * abv) / 100) * 100)}</strong></div>`);
      box.innerHTML = bits.join('');
      if (cost != null && sell != null && sell < cost) box.insertAdjacentHTML('beforeend', '<div style="background:var(--color-danger-bg);color:var(--color-danger)">Selling below cost<strong>Loss ' + M(cost - sell) + '</strong></div>');
    }
    ['costPrice', 'sellingPrice', 'volumeMl', 'abv'].forEach((n) => el(n).addEventListener('input', calc)); calc();

    m.querySelector('[data-x="cancel"]').addEventListener('click', () => window.UI.closeModal());
    const save = m.querySelector('[data-x="save"]');
    const done = { productId: edit ? p._id : null, details: false, stock: false };

    save.addEventListener('click', async () => {
      showErr('');
      const name = v('name'); const sell = num(v('sellingPrice')); const alcoholic = el('isAlcohol').checked; const abv = num(v('abv'));
      if (!name) return showErr('Enter the product name.');
      if (sell == null || sell < 0) return showErr('Enter the selling price.');
      if (alcoholic && abv == null) return showErr('Enter the alcohol % (ABV). Untick "Alcoholic" for soft drinks, mixers and snacks.');
      const cost = num(v('costPrice')); if (cost != null && sell < cost && !window.confirm('The selling price is below the buying price. Save anyway?')) return;
      const packSize = num(v('packSize'));
      if (packSize != null && packSize < 2) return showErr('A case must hold at least 2 bottles.');

      const body = { name, ...(v('brand') ? { brand: v('brand') } : {}), sellingPrice: sell, ...(cost != null ? { costPrice: cost } : {}), taxRate: num(v('taxRate')) ?? 16, lowStockThreshold: num(v('lowStockThreshold')) ?? 0, ...(v('categoryId') ? { categoryId: v('categoryId') } : {}) };
      if (st.imageChanged) body.image = st.image;
      if (packSize != null) body.units = [{ name: v('packName') || 'Case', factor: packSize, ...(num(v('packPrice')) != null ? { retailPrice: num(v('packPrice')) } : {}) }];
      const dBody = { category: st.cat, isAlcohol: alcoholic, ...(abv != null ? { abv } : {}), ...(num(v('volumeMl')) ? { volumeMl: num(v('volumeMl')) } : {}), ...(num(v('vintage')) ? { vintage: num(v('vintage')) } : {}),
        ...(v('country') ? { country: v('country') } : {}), ...(v('region') ? { region: v('region') } : {}), ...(v('producer') ? { producer: v('producer') } : {}),
        ...(num(v('excise')) != null ? { exciseCentsPerUnit: num(v('excise')) } : {}) }; // the server converts shillings to cents
      if (el('containerTypeId')) { dBody.containerTypeId = v('containerTypeId') || null; dBody.containersPerUnit = num(v('containersPerUnit')) ?? 1; }

      window.UI.setButtonLoading(save, true, 'Saving…');
      let step = 'product';
      try {
        if (!done.productId) {
          let barcode = v('barcode');
          if (!barcode && window.BarcodeLabels) { try { const { used } = await window.BarcodeLabels.loadCatalog(); barcode = window.BarcodeLabels.generateCode(used); } catch { /* optional */ } }
          const { data } = await window.Api.post('/products', { ...body, sku: v('sku') || sku(), ...(barcode ? { barcode } : {}), unit: 'bottle', productType: 'physical', trackInventory: true, trackBatch: feat('batchTracking') && !!v('batchNumber') });
          done.productId = data.product._id;
        } else {
          await window.Api.put(`/products/${done.productId}`, { ...body, ...(v('barcode') ? { barcode: v('barcode') } : {}), ...(v('sku') ? { sku: v('sku') } : {}) });
        }
        if (canDetails && !done.details) { step = 'details'; await window.Api.put(`/liquor/products/${done.productId}`, dBody); done.details = true; }
        const qty = num(v('stockQty'));
        if (canStock && qty && !done.stock) {
          step = 'stock';
          await window.Api.post('/inventory/receive', { branchId, productId: done.productId, quantity: qty, ...(cost != null ? { costPrice: cost } : {}), ...(v('batchNumber') ? { batchNumber: v('batchNumber') } : {}), ...(v('expiryDate') ? { expiryDate: v('expiryDate') } : {}), reason: 'Opening stock' });
          done.stock = true;
        }
        window.UI.toast.success(edit ? 'Drink updated' : `${name} added${qty ? ` with ${qty} in stock` : ''}`);
        window.UI.closeModal();
        if (window.LiquorTill && window.LiquorTill.refresh) window.LiquorTill.refresh();
        if (onDone) onDone({ productId: done.productId });
      } catch (err) {
        window.UI.setButtonLoading(save, false);
        const where = { product: 'The product could not be saved', details: 'The product was saved, but the drink details were not', stock: 'The drink was saved, but the opening stock was not received' }[step];
        showErr(`${where}: ${err.message}${done.productId && step !== 'product' ? ' Fix it and press Save again. Nothing will be duplicated.' : ''}`);
      }
    });
    el('name').focus();
  }

  window.LiquorProductForm = { open, applies, shrink, CATS };
})(window);
