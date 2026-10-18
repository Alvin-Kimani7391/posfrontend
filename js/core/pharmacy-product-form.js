/**
 * pharmacy-product-form.js - ONE form for adding a medicine to a pharmacy.
 *
 * A medicine is three records on the server: the Product (name, price, stock unit), the MedicineDetails (generic name,
 * strength, dosage form, class, storage...) and its first stock batch (batch no. + expiry). Pharmacies used to have to visit
 * Products, then Medicines, then Inventory. This form collects everything the pharmacy needs in one place and makes the
 * three calls in order, so nothing is left half-set-up:
 *
 *   PharmacyProductForm.open({ onDone })                 add a new medicine (product + drug details + opening stock)
 *   PharmacyProductForm.open({ medicine, onDone })       edit a medicine (row from GET /pharmacy/medicines)
 *   PharmacyProductForm.open({ product, onDone })        turn an existing product into a medicine
 *   PharmacyProductForm.chooser({ onDone, onOther })     small "medicine or other item?" prompt used by the Products page
 *
 * Needs: ui.js, api.js, permissions.js, app-shell.js, pharmacy-kit.js (classes). barcode-labels.js is optional (barcode + sticker).
 */
(function (window) {
  'use strict';
  const esc = (v) => window.UI.escapeHtml(v == null ? '' : String(v));
  const can = (p) => window.Permissions.can(window.AppShell.getUser(), p);

  const FORMS = ['tablet', 'capsule', 'syrup', 'suspension', 'solution', 'injection', 'infusion', 'cream', 'ointment', 'gel', 'lotion', 'drops', 'spray', 'inhaler', 'suppository', 'pessary', 'powder', 'sachet', 'patch', 'lozenge', 'other'];
  // Stock units the server accepts for Product.unit. Stock, batches and prescriptions are all counted in this unit.
  const UNITS = [['tablet', 'Tablet / capsule'], ['piece', 'Piece'], ['strip', 'Strip'], ['bottle', 'Bottle'], ['ml', 'Millilitre (ml)'], ['g', 'Gram (g)'], ['sachet', 'Sachet'], ['pack', 'Pack'], ['box', 'Box'], ['tin', 'Tin']];

  const sectionHtml = (title, hint, body) => `<section class="ph-fsec"><h4>${esc(title)}</h4>${hint ? `<p class="ph-note" style="margin:0 0 var(--space-3)">${hint}</p>` : ''}${body}</section>`;
  const field = ({ name, label, required, type = 'text', placeholder = '', hint = '', attrs = '', value = '', list = '', cls = '' }) => `
    <div class="field ${cls}"><label for="pf-${name}">${esc(label)}${required ? ' <span class="ph-req">*</span>' : ''}</label>
      <input class="input" id="pf-${name}" name="${name}" type="${type}" value="${esc(value)}" placeholder="${esc(placeholder)}" ${required ? 'required' : ''} ${list ? `list="${list}"` : ''} ${attrs} />
      ${hint ? `<div class="text-xs text-muted">${hint}</div>` : ''}</div>`;

  const sku = () => `MED-${Date.now().toString(36).toUpperCase().slice(-5)}${Math.random().toString(36).slice(2, 4).toUpperCase()}`;
  const num = (v) => (v === '' || v == null || Number.isNaN(Number(v)) ? undefined : Number(v));
  const day = (v) => (v ? new Date(v).toISOString().slice(0, 10) : '');

  async function categories() {
    try { const { data } = await window.Api.get('/categories'); return data.categories || []; } catch { return []; }
  }

  function classHint(settings, code) {
    const c = ((settings && settings.classes) || []).find((x) => String(x.code).toUpperCase() === String(code).toUpperCase());
    if (!c) return 'Over-the-counter: can be sold without a prescription.';
    const bits = [];
    if (c.requiresPrescription) bits.push('needs a validated prescription');
    if (c.dispenserOnly) bits.push('only an authorised dispenser may sell it');
    if (c.restricted) bits.push('controlled drug: countersignature and register entry');
    if (c.poisonsBook) bits.push('Poisons Book entry when sold without a prescription');
    if (c.maxQtyPerDispense) bits.push(`max ${c.maxQtyPerDispense} per dispensing`);
    return bits.length ? `At the till: ${bits.join('; ')}.` : 'Over-the-counter: can be sold without a prescription.';
  }

  /**
   * @param {{ medicine?: object, product?: object, onDone?: Function }} opts
   */
  async function open({ medicine, product, onDone } = {}) {
    const P = window.Pharmacy;
    const settings = await P.classes();
    const cats = await categories();
    const edit = !!medicine;
    const link = !edit && !!product;
    const create = !edit && !link;
    const m = medicine || {}; const st = m.storage || {};

    // For an edit we also need the product's own fields (price, category, barcode...).
    let p = product || null;
    if (edit && !p) {
      try { ({ data: { product: p } } = await window.Api.get(`/products/${m.productId}`)); } catch (e) { window.UI.toast.error(`Could not load the product: ${e.message}`); return; }
    }
    p = p || {};
    const productId = edit ? m.productId : (link ? p._id : null);
    const classes = (settings.classes && settings.classes.length ? settings.classes : [{ code: 'OTC', label: 'Over the counter' }]);
    const showStock = create && can('inventory.receive');
    const branchId = window.AppShell.getActiveBranchId();
    const title = edit ? `Edit ${m.brandName || m.genericName}` : link ? `Medicine details · ${p.name}` : 'Add medicine';

    const body = `<form id="pf-form" novalidate>
      ${sectionHtml('1 · The medicine', 'What it is. This is what the pharmacist sees when dispensing and what is printed on the label.', `
        <div class="form-row">
          ${field({ name: 'genericName', label: 'Generic name (active ingredient)', required: true, placeholder: 'Amoxicillin', value: m.genericName })}
          ${field({ name: 'brandName', label: 'Brand name', placeholder: 'Amoxil', value: m.brandName, hint: 'Leave empty if it is sold under its generic name.' })}
        </div>
        <div class="form-row">
          ${field({ name: 'strength', label: 'Strength', required: true, placeholder: '500 mg   or   125 mg/5 ml', value: m.strength })}
          ${field({ name: 'dosageForm', label: 'Dosage form', required: true, placeholder: 'tablet, syrup, injection…', value: m.dosageForm, list: 'pf-forms' })}
        </div>
        <datalist id="pf-forms">${FORMS.map((f) => `<option value="${f}"></option>`).join('')}</datalist>
        <div class="form-row">
          <div class="field"><label for="pf-classification">Class <span class="ph-req">*</span></label>
            <select class="select" id="pf-classification" name="classification">${classes.map((c) => `<option value="${esc(c.code)}" ${String(c.code).toUpperCase() === String(m.classification || 'OTC').toUpperCase() ? 'selected' : ''}>${esc(c.label || c.code)}</option>`).join('')}</select>
            <div class="text-xs text-muted" id="pf-class-hint"></div></div>
          ${field({ name: 'packSize', label: 'Pack size', placeholder: '10 x 10 tablets', value: m.packSize })}
        </div>
        <div class="form-row">
          ${field({ name: 'manufacturer', label: 'Manufacturer', value: m.manufacturer })}
          ${field({ name: 'registrationNumber', label: 'Registration no. (PPB / TMDA)', value: m.registrationNumber, hint: 'The regulator’s registration or authorisation number, if it has one.' })}
        </div>`)}

      ${sectionHtml('2 · Product, price & stock unit', 'How it is listed, priced and counted.', `
        <div class="form-row">
          ${field({ name: 'name', label: 'Product name (shown at the till)', required: true, value: p.name, placeholder: 'Amoxil 500 mg capsule' })}
          <div class="field"><label for="pf-categoryId">Category</label>
            <select class="select" id="pf-categoryId" name="categoryId"><option value="">No category</option>${cats.map((c) => `<option value="${esc(c._id)}" ${String((p.categoryId && p.categoryId._id) || p.categoryId || '') === String(c._id) ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}<option value="__new">+ New category…</option></select></div>
        </div>
        <div class="form-row">
          ${field({ name: 'costPrice', label: 'Cost price (per unit)', type: 'number', attrs: 'min="0" step="0.01" inputmode="decimal"', value: p.costPrice != null ? p.costPrice : '', placeholder: '0.00' })}
          ${field({ name: 'sellingPrice', label: 'Selling price (per unit)', required: true, type: 'number', attrs: 'min="0" step="0.01" inputmode="decimal"', value: p.sellingPrice != null ? p.sellingPrice : '', placeholder: '0.00', hint: '<span id="pf-margin"></span>' })}
        </div>
        <div class="form-row">
          <div class="field"><label for="pf-unit">Stock is counted in</label>
            <select class="select" id="pf-unit" name="unit" ${create ? '' : 'disabled'}>${UNITS.map(([v, l]) => `<option value="${v}" ${v === (p.unit || m.unitOfSale || 'tablet') ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>
            <div class="text-xs text-muted">Prescriptions and labels use this unit (e.g. 21 tablets). ${create ? 'It cannot be changed once stock exists.' : 'Fixed after the product is created.'}</div></div>
          ${field({ name: 'lowStockThreshold', label: 'Reorder level', type: 'number', attrs: 'min="0" step="1"', value: p.lowStockThreshold != null ? p.lowStockThreshold : '', placeholder: 'e.g. 50', hint: 'You are alerted when stock falls to this.' })}
        </div>
        <div class="form-row">
          <div class="field"><label for="pf-barcode">Barcode</label>
            <div class="input-button-row"><input class="input" id="pf-barcode" name="barcode" value="${esc(p.barcode || '')}" placeholder="Scan or type" style="flex:1" />${window.BarcodeLabels ? '<button type="button" class="btn btn-secondary" id="pf-gen">Generate</button>' : ''}</div>
            <div class="text-xs text-muted">Left empty, one is generated for you.</div></div>
          ${field({ name: 'sku', label: 'SKU', value: p.sku || '', placeholder: 'Auto', attrs: edit || link ? 'readonly' : '', hint: create ? 'Left empty, one is generated.' : 'Cannot be changed.' })}
        </div>
        ${field({ name: 'taxRate', label: 'Tax rate (%)', type: 'number', attrs: 'min="0" max="100" step="0.01"', value: p.taxRate != null ? p.taxRate : '', placeholder: '0', hint: 'Check with your accountant; many medicines are exempt or zero-rated.' })}`)}

      ${sectionHtml('3 · Storage & information', 'Shown to staff and used for the temperature rules.', `
        ${field({ name: 'storageInstructions', label: 'Storage instructions', value: st.instructions, placeholder: 'Store below 25 °C, protect from light' })}
        <div class="form-row">
          ${field({ name: 'storageMinC', label: 'Storage min (°C)', type: 'number', attrs: 'step="0.1"', value: st.minC })}
          ${field({ name: 'storageMaxC', label: 'Storage max (°C)', type: 'number', attrs: 'step="0.1"', value: st.maxC })}
        </div>
        <div class="field"><label class="checkbox-row"><input type="checkbox" name="storageCold" ${st.coldChain ? 'checked' : ''} /> <span class="text-sm">Cold chain: keep refrigerated (2–8 °C)</span></label></div>
        <div class="form-row">
          ${field({ name: 'supplierCode', label: 'Supplier code', value: m.supplierCode })}
          ${field({ name: 'infoReference', label: 'Leaflet / information link', value: m.infoReference, placeholder: 'https://…' })}
        </div>`)}

      ${showStock ? sectionHtml('4 · Opening stock (optional)', 'Medicines are always tracked by batch and expiry. Enter the batch you are putting on the shelf now, or skip and receive stock later from a purchase.', `
        <div class="form-row">
          ${field({ name: 'stockQty', label: 'Quantity received', type: 'number', attrs: 'min="0" step="1"', placeholder: '0' })}
          ${field({ name: 'batchNumber', label: 'Batch number', placeholder: 'From the pack' })}
        </div>
        <div class="form-row">
          ${field({ name: 'expiryDate', label: 'Expiry date', type: 'date', attrs: `min="${day(new Date())}"` })}
          ${field({ name: 'manufacturingDate', label: 'Manufacturing date', type: 'date' })}
        </div>`) : (create ? '<p class="ph-note">Receive stock from Purchases or Inventory once the medicine is saved.</p>' : '')}

      ${create && window.BarcodeLabels ? '<div class="field"><label class="checkbox-row"><input type="checkbox" name="printSticker" /> <span class="text-sm">Print a shelf barcode sticker after saving</span></label></div>' : ''}
      <div class="ph-warn-box" id="pf-error" hidden></div>
    </form>`;

    const modal = window.UI.openModal({
      title, maxWidth: '860px', bodyHtml: body,
      footerHtml: `<button class="btn btn-secondary" data-act="cancel">Cancel</button><button class="btn btn-primary" data-act="save">${edit ? 'Save changes' : 'Save medicine'}</button>`,
    });
    const form = modal.querySelector('#pf-form');
    const el = (n) => form.elements[n];
    const errBox = modal.querySelector('#pf-error');
    const showError = (msg) => { errBox.hidden = !msg; errBox.textContent = msg || ''; if (msg) errBox.scrollIntoView({ block: 'nearest' }); };

    // class rules, live
    const paintClass = () => { modal.querySelector('#pf-class-hint').textContent = classHint(settings, el('classification').value); };
    el('classification').addEventListener('change', paintClass); paintClass();

    // product name suggestion until the user types their own
    let nameTouched = !!p.name;
    el('name').addEventListener('input', () => { nameTouched = true; });
    const suggest = () => {
      if (nameTouched) return;
      el('name').value = [el('brandName').value || el('genericName').value, el('strength').value, el('dosageForm').value].map((s) => String(s || '').trim()).filter(Boolean).join(' ');
    };
    ['genericName', 'brandName', 'strength', 'dosageForm'].forEach((n) => el(n).addEventListener('input', suggest));

    // margin hint
    const paintMargin = () => {
      const c = num(el('costPrice').value); const s = num(el('sellingPrice').value);
      modal.querySelector('#pf-margin').textContent = (c != null && s != null && s > 0) ? `Margin ${(((s - c) / s) * 100).toFixed(1)}% · profit ${window.UI.formatMoney(s - c)} per unit` : '';
    };
    ['costPrice', 'sellingPrice'].forEach((n) => el(n).addEventListener('input', paintMargin)); paintMargin();

    // new category on the fly
    el('categoryId').addEventListener('change', async (e) => {
      if (e.target.value !== '__new') return;
      const name = (window.prompt('Name of the new category (e.g. Antibiotics)') || '').trim();
      if (!name) { e.target.value = ''; return; }
      try {
        const { data } = await window.Api.post('/categories', { name });
        const c = data.category || data;
        const opt = document.createElement('option'); opt.value = c._id; opt.textContent = c.name;
        e.target.insertBefore(opt, e.target.querySelector('option[value="__new"]')); e.target.value = c._id;
      } catch (err) { window.UI.toast.error(err.message); e.target.value = ''; }
    });

    // barcode generator
    modal.querySelector('#pf-gen')?.addEventListener('click', async () => {
      try { const { used } = await window.BarcodeLabels.loadCatalog(); el('barcode').value = window.BarcodeLabels.generateCode(used); } catch (e) { window.UI.toast.error(e.message); }
    });

    modal.querySelector('[data-act="cancel"]').addEventListener('click', () => window.UI.closeModal());
    const save = modal.querySelector('[data-act="save"]');
    const done = { product: !!productId, productId, medicine: false, stock: false };

    save.addEventListener('click', async () => {
      showError('');
      if (!form.reportValidity()) return;
      const v = (n) => String(el(n) ? el(n).value : '').trim();
      const sell = num(v('sellingPrice'));
      if (sell == null || sell < 0) return showError('Enter the selling price.');
      const cost = num(v('costPrice'));
      if (cost != null && sell < cost && !(await window.UI.confirmDialog({ title: 'Selling below cost?', message: `The selling price (${window.UI.formatMoney(sell)}) is lower than the cost price (${window.UI.formatMoney(cost)}). Save anyway?`, confirmText: 'Save anyway' }))) return;
      const qty = showStock ? num(v('stockQty')) : undefined;
      if (qty && !done.stock) {
        if (!v('expiryDate')) return showError('Enter the expiry date of the batch you are receiving. Medicines are tracked by expiry.');
        if (!v('batchNumber')) return showError('Enter the batch number from the pack.');
        if (new Date(v('expiryDate')) <= new Date()) return showError('That batch has already expired. It cannot be put on the shelf.');
      }

      const storage = {};
      if (v('storageInstructions')) storage.instructions = v('storageInstructions');
      if (num(v('storageMinC')) !== undefined) storage.minC = num(v('storageMinC'));
      if (num(v('storageMaxC')) !== undefined) storage.maxC = num(v('storageMaxC'));
      if (el('storageCold').checked) storage.coldChain = true;
      if (storage.minC != null && storage.maxC != null && storage.minC >= storage.maxC) return showError('Storage minimum must be below the maximum.');

      const unit = v('unit') || 'tablet';
      const medBody = {
        genericName: v('genericName'), strength: v('strength'), dosageForm: v('dosageForm').toLowerCase(), classification: v('classification') || 'OTC',
        ...(v('brandName') ? { brandName: v('brandName') } : {}), ...(v('packSize') ? { packSize: v('packSize') } : {}), ...(v('manufacturer') ? { manufacturer: v('manufacturer') } : {}),
        ...(v('registrationNumber') ? { registrationNumber: v('registrationNumber') } : {}), ...(v('supplierCode') ? { supplierCode: v('supplierCode') } : {}),
        ...(v('infoReference') ? { infoReference: v('infoReference') } : {}), unitOfSale: unit,
        ...(Object.keys(storage).length ? { storage } : {}),
        ...(edit && Array.isArray(m.alternatives) ? { alternatives: m.alternatives.map((a) => String(a._id || a)) } : {}),
      };
      const cat = v('categoryId');
      const productBody = {
        name: v('name'), sellingPrice: sell, ...(cost != null ? { costPrice: cost } : {}), ...(cat && cat !== '__new' ? { categoryId: cat } : {}),
        ...(num(v('taxRate')) !== undefined ? { taxRate: num(v('taxRate')) } : {}), ...(num(v('lowStockThreshold')) !== undefined ? { lowStockThreshold: num(v('lowStockThreshold')) } : {}),
        ...(v('brandName') ? { brand: v('brandName') } : {}),
      };

      window.UI.setButtonLoading(save, true, 'Saving…');
      let step = 'product';
      try {
        // 1 · the product
        if (!done.product) {
          let barcode = v('barcode');
          if (!barcode && window.BarcodeLabels) { try { const { used } = await window.BarcodeLabels.loadCatalog(); barcode = window.BarcodeLabels.generateCode(used); } catch { /* optional */ } }
          const { data } = await window.Api.post('/products', { ...productBody, sku: v('sku') || sku(), ...(barcode ? { barcode } : {}), unit, productType: 'physical', trackInventory: true, trackBatch: true, trackExpiry: true });
          done.product = true; done.productId = data.product._id; done.created = data.product;
        } else if (!done.medicine) {
          // editing, linking an existing product, or retrying after a failed second step
          await window.Api.put(`/products/${done.productId}`, { ...productBody, ...(v('barcode') ? { barcode: v('barcode') } : {}) });
        }
        // 2 · the drug details
        step = 'medicine';
        if (!done.medicine) { await window.Api.put(`/pharmacy/medicines/${done.productId}`, medBody); done.medicine = true; }
        // 3 · opening stock
        step = 'stock';
        if (qty && !done.stock && showStock) {
          await window.Api.post('/inventory/receive', {
            branchId, productId: done.productId, quantity: qty, ...(cost != null ? { costPrice: cost } : {}),
            batchNumber: v('batchNumber'), expiryDate: v('expiryDate'), ...(v('manufacturingDate') ? { manufacturingDate: v('manufacturingDate') } : {}), reason: 'Opening stock',
          });
          done.stock = true;
        }
        window.UI.toast.success(edit ? 'Medicine updated' : `${productBody.name} added${qty ? ` with ${qty} in stock` : ''}`);
        const sticker = create && el('printSticker') && el('printSticker').checked && window.BarcodeLabels;
        window.UI.closeModal();
        if (sticker && done.created) window.BarcodeLabels.printItems([{ name: productBody.name, barcode: done.created.barcode, price: sell, copies: 1 }]);
        if (onDone) onDone({ productId: done.productId });
      } catch (err) {
        window.UI.setButtonLoading(save, false);
        if (err.code === 'VALIDATION_ERROR' && err.errors && err.errors.length) { try { window.UI.applyFormErrors(form, err.errors); } catch { /* ignore */ } }
        const where = { product: 'The product could not be saved', medicine: done.product ? 'The product was saved, but the drug details were not' : 'The drug details could not be saved', stock: 'The medicine was saved, but the opening stock was not received' }[step];
        showError(`${where}: ${err.message}${done.product && step !== 'product' ? ' Fix it and press Save again. Nothing will be duplicated.' : ''}`);
        if (done.product && !done.medicine && onDone) onDone({ productId: done.productId, partial: true });
      }
    });
    el('genericName').focus();
  }

  /** Products page, pharmacy: ask whether it is a medicine (full pharmacy form) or an ordinary shop item. */
  function chooser({ onDone, onOther }) {
    const modal = window.UI.openModal({
      title: 'What are you adding?', maxWidth: '520px',
      bodyHtml: `<div class="ph-choose">
        <button type="button" class="ph-choose-card" data-pick="med"><span class="ph-choose-ic">${window.Icons.get('pill')}</span><strong>A medicine</strong><span class="text-sm text-secondary">Generic name, strength, dosage form, class, storage and opening batch with expiry.</span></button>
        <button type="button" class="ph-choose-card" data-pick="other"><span class="ph-choose-ic">${window.Icons.get('tag')}</span><strong>Another item</strong><span class="text-sm text-secondary">Toiletries, baby products, supplements, devices and other non-medicine goods.</span></button></div>`,
    });
    modal.querySelector('[data-pick="med"]').addEventListener('click', () => { window.UI.closeModal(); open({ onDone }); });
    modal.querySelector('[data-pick="other"]').addEventListener('click', () => { window.UI.closeModal(); if (onOther) onOther(); });
  }

  window.PharmacyProductForm = { open, chooser };
})(window);
