/**
 * unit-conversion-kit.js - dynamic unit conversion for products, receiving, adjusting and break-down.
 *
 * ONE stock pool per product, counted in its BASE unit (kg, litre, piece...). Every other size is a "unit" with a
 * factor = base units in one of it (bag 25, 1/4 bag 6.25, 500g 0.5). Selling 12 kg, a 1/4 bag or 3 x 500g all take
 * from the same pool, so nothing is ever double counted. Cost is kept per base unit, so the cost, price, profit and
 * margin of every size is exact.
 *
 *   UnitKit.applies(product)                    -> is unit conversion available here
 *   UnitKit.sectionHtml(product) / bind(...)    -> the "Sizes" editor inside the product form (products.js)
 *   UnitKit.attachQtyUnit({...})                -> unit picker + live conversion on Receive / Adjust stock
 *   UnitKit.openBreakdown(product)              -> price breakdown: cost, price, profit, margin for every size
 *   UnitKit.openBreakModal({ product })         -> break a bag into sellable sizes (wastage, packaging cost)
 *
 * Units managed elsewhere (code PKT / DEAL = the pieces-only "Sold in packets" widget) are never touched here.
 */
(function (window) {
  'use strict';

  const MANAGED_ELSEWHERE = ['PKT', 'DEAL'];
  const MEASURED = ['kg', 'g', 'litre', 'ml', 'metre', 'm2', 'm3', 'tonne'];

  const esc = (v) => window.UI.escapeHtml(v == null ? '' : String(v));
  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  const r2 = (n) => Math.round(num(n) * 100) / 100;
  const r3 = (n) => Math.round(num(n) * 1000) / 1000;
  const r4 = (n) => Math.round(num(n) * 10000) / 10000;
  const fq = (n) => r3(n).toLocaleString('en-KE', { maximumFractionDigits: 3 });
  const money = (n) => window.UI.formatMoney(r2(n));
  const cents = (c) => money(num(c) / 100);
  const RED = '#b3140a';
  let seq = 0;
  const newKey = () => `uk${Date.now().toString(36)}${(seq += 1)}`;

  const isMeasured = (product) => !!product && (MEASURED.includes(product.unit) || product.productType === 'weighted');
  const activeUnits = (product) => ((product && product.units) || []).filter((u) => u.status !== 'inactive' && num(u.factor) > 0);
  const canDo = (perm) => { try { return !!window.Permissions.can(window.AppShell.getUser(), perm); } catch { return false; } };

  function applies(product) {
    try {
      if (window.AppShell.hasFeature && window.AppShell.hasFeature('unitConversions')) return true;
      const t = window.AppShell.getBusinessProfile && window.AppShell.getBusinessProfile().businessType;
      if (t === 'supermarket' || t === 'general_shop') return true; // the server switches the feature on at first use
    } catch { /* ignore */ }
    return !!(product && activeUnits(product).length);
  }

  /** Base-unit size presets ('kg' -> 250g, 500g, 1kg...). Values are in the BASE unit. */
  function sizePresets(base) {
    const mk = (arr) => arr.map(([name, factor]) => ({ name, factor }));
    switch (base) {
      case 'kg': return mk([['250g', 0.25], ['500g', 0.5], ['1kg', 1], ['2kg', 2], ['5kg', 5], ['10kg', 10]]);
      case 'g': return mk([['100g', 100], ['250g', 250], ['500g', 500], ['1kg', 1000], ['2kg', 2000]]);
      case 'litre': return mk([['250ml', 0.25], ['500ml', 0.5], ['1 litre', 1], ['2 litre', 2], ['5 litre', 5], ['20 litre', 20]]);
      case 'ml': return mk([['100ml', 100], ['250ml', 250], ['500ml', 500], ['1 litre', 1000]]);
      case 'metre': return mk([['Half metre', 0.5], ['2 metre', 2], ['5 metre', 5], ['10 metre', 10]]);
      default: return mk([['Pair', 2], ['Half dozen', 6], ['Dozen', 12]]);
    }
  }

  /* ================================================================== *
   * 1. PRODUCT FORM SECTION
   * ================================================================== */
  function sectionHtml(product) {
    const on = !!(product && activeUnits(product).some((u) => !MANAGED_ELSEWHERE.includes(u.code)));
    return `
      <div class="field" id="uk-section" style="border:1.5px solid var(--color-primary, #2563eb); background:color-mix(in srgb, var(--color-primary, #2563eb) 5%, transparent); border-radius: var(--radius-md); padding: var(--space-3)">
        <label class="checkbox-row" style="align-items:flex-start"><input type="checkbox" id="uk-on" ${on ? 'checked' : ''} style="margin-top:3px" />
          <span class="text-sm font-semibold">Sold or received in different sizes? <span class="text-muted" style="font-weight:400">e.g. a 25 kg bag of sugar sold by the kg, 500 g, 1/4 bag... or broken into 1 kg packs. Stock is ONE pool counted in the unit chosen below, so every size comes out of the same stock and profit stays exact.</span></span></label>
        <div id="uk-fields" style="${on ? '' : 'display:none;'}margin-top:var(--space-2)">
          <div class="form-row">
            <div class="field" style="margin-bottom:var(--space-2)"><label for="uk-cost">What you pay (KES)</label>
              <input class="input" id="uk-cost" type="number" min="0" step="0.01" inputmode="decimal" placeholder="e.g. 3000" /></div>
            <div class="field" style="margin-bottom:var(--space-2)"><label for="uk-cost-unit">for one</label>
              <select class="select" id="uk-cost-unit"></select></div>
          </div>
          <div class="field-hint" id="uk-cost-line" style="margin-bottom:var(--space-2)"></div>

          <div class="field" style="margin-bottom:var(--space-2)">
            <label>Bulk pack you buy <span class="text-muted">(optional - e.g. Bag of 25 kg)</span></label>
            <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:flex-end">
              <div style="flex:2 1 110px"><input class="input" id="uk-pack-name" maxlength="30" placeholder="Bag, Sack, Carton" aria-label="Pack name" /></div>
              <div style="flex:1 1 110px"><input class="input" id="uk-pack-size" type="number" min="0" step="any" inputmode="decimal" placeholder="size" aria-label="Pack size in base unit" /></div>
              <div style="flex:1 1 120px"><input class="input" id="uk-pack-price" type="number" min="0" step="0.01" inputmode="decimal" placeholder="price (auto)" aria-label="Pack selling price" /></div>
            </div>
            <div class="text-xs text-muted" id="uk-pack-calc" style="margin-top:4px"></div>
          </div>

          <div class="field" style="margin-bottom:var(--space-2)">
            <label>Other sizes you sell <span class="text-muted">(tap to add, or add your own)</span></label>
            <div id="uk-chips" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:var(--space-2)"></div>
            <div id="uk-rows"></div>
            <button type="button" class="btn btn-secondary btn-sm" id="uk-add-row">${window.Icons.get('plus')} Custom size</button>
          </div>
          <div class="field" style="margin-bottom:var(--space-2)">
            <label for="uk-markup">Extra % on sizes smaller than 1 <span id="uk-markup-unit">unit</span> <span class="text-muted">(optional, e.g. 5 so 250 g costs a little more per kg)</span></label>
            <input class="input" id="uk-markup" type="number" min="0" max="500" step="0.1" inputmode="decimal" placeholder="0" style="max-width:140px" />
          </div>
          <div id="uk-summary" class="text-sm" style="padding:var(--space-2) var(--space-3);border-radius:var(--radius-md);background:var(--color-surface-2, rgba(127,127,127,.08))"></div>
        </div>
      </div>`;
  }

  function rowHtml(r, baseName) {
    return `
      <div class="uk-row" data-key="${esc(r.key)}" style="border:1px solid var(--color-border);border-radius:var(--radius-md);padding:8px;margin-bottom:8px">
        <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:flex-end">
          <div style="flex:2 1 120px"><label class="text-xs text-muted">Name</label><input class="input uk-name" maxlength="30" value="${esc(r.name)}" placeholder="500g, 1/4 Bag" /></div>
          <div style="flex:1 1 90px"><label class="text-xs text-muted">Size (in <span class="uk-base">${esc(baseName)}</span>)</label><input class="input uk-factor" type="number" min="0" step="any" inputmode="decimal" value="${esc(r.factor)}" /></div>
          <div style="flex:1 1 110px"><label class="text-xs text-muted">Price (KES)</label><input class="input uk-price" type="number" min="0" step="0.01" inputmode="decimal" value="${esc(r.price)}" /></div>
          <button type="button" class="btn btn-ghost btn-sm uk-del" aria-label="Remove size" title="Remove size">${window.Icons.get('trash')}</button>
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:6px">
          <input class="input uk-barcode" value="${esc(r.barcode || '')}" placeholder="Barcode for this size (optional)" style="flex:1 1 180px;height:34px;min-height:34px;font-size:13px" />
          <button type="button" class="btn btn-ghost btn-sm uk-gen" title="Generate a barcode">Generate</button>
        </div>
        <div class="uk-calc text-xs" style="margin-top:4px"></div>
      </div>`;
  }

  /**
   * Wires the section. opts: { product, baseUnit(): string, generateBarcode(): Promise<string> }
   * Returns { active(), collect(), confirmBelowCost(), stockUnitKey(), stockBase(qty) } or null when the section is absent.
   */
  function bind(modal, opts) {
    const $q = (q) => modal.querySelector(q);
    const on = $q('#uk-on');
    if (!on) return null;
    const product = opts.product || null;
    const baseName = () => (opts.baseUnit ? opts.baseUnit() : 'piece') || 'piece';
    const priceEl = $q('#p-price');
    const costEl = $q('#p-cost');
    const bp = () => (priceEl ? num(priceEl.value) : 0);

    // ---- state ----
    const existing = activeUnits(product).filter((u) => !MANAGED_ELSEWHERE.includes(u.code));
    const origUnits = ((product && product.units) || []).filter((u) => !MANAGED_ELSEWHERE.includes(u.code));
    const asRow = (u) => {
      const auto = u.retailPrice == null || u.retailPrice === '' || Math.abs(num(u.retailPrice) - r2((product ? num(product.sellingPrice) : 0) * u.factor)) < 0.011;
      return { key: newKey(), id: u._id, name: u.name, factor: u.factor, price: auto ? '' : u.retailPrice, kind: u.kind || 'custom', barcode: u.barcode || '', code: u.code, wholesalePrice: u.wholesalePrice, isWholesaleDefault: !!u.isWholesaleDefault };
    };
    let pack = null;
    const packSrc = existing.find((u) => u.kind === 'pack');
    if (packSrc) pack = asRow(packSrc);
    let rows = existing.filter((u) => u !== packSrc).map(asRow);

    // ---- DOM → state ----
    const readPack = () => {
      const name = $q('#uk-pack-name').value.trim(); const size = num($q('#uk-pack-size').value);
      if (!name && !size) { if (pack && !pack.id) pack = null; if (pack && pack.id) { pack.name = ''; pack.factor = 0; } return; }
      pack = Object.assign(pack || { key: newKey(), kind: 'pack', barcode: '' }, { name, factor: size, price: $q('#uk-pack-price').value });
    };
    const readRows = () => {
      modal.querySelectorAll('.uk-row').forEach((el) => {
        const r = rows.find((x) => x.key === el.dataset.key); if (!r) return;
        r.name = el.querySelector('.uk-name').value.trim(); r.factor = el.querySelector('.uk-factor').value;
        r.price = el.querySelector('.uk-price').value; r.barcode = el.querySelector('.uk-barcode').value.trim();
      });
    };
    const costFactor = () => {
      const sel = $q('#uk-cost-unit').value;
      if (!sel || sel === '__base') return 1;
      if (pack && sel === pack.key) return num(pack.factor) || 1;
      const r = rows.find((x) => x.key === sel); return r ? (num(r.factor) || 1) : 1;
    };
    const perBaseCost = () => { const v = num($q('#uk-cost').value); const f = costFactor(); return v > 0 && f > 0 ? v / f : 0; };
    const markup = () => Math.max(0, num($q('#uk-markup').value));

    /** Effective price of a size (KES): typed price, else loose price x size (+ extra % for sizes under 1 base unit). */
    const priceOf = (r) => {
      if (num(r.price) > 0) return num(r.price);
      const f = num(r.factor); const m = f > 0 && f < 1 ? 1 + markup() / 100 : 1;
      return r2(bp() * f * m);
    };
    const markupApplies = (r) => !(num(r.price) > 0) && num(r.factor) > 0 && num(r.factor) < 1 && markup() > 0;
    const allSizes = () => [pack && pack.name && num(pack.factor) > 0 ? pack : null].concat(rows).filter(Boolean);

    // ---- render pieces ----
    function renderCostUnits() {
      const sel = $q('#uk-cost-unit'); const keep = sel.value;
      const opts2 = [`<option value="__base">${esc(baseName())}</option>`]
        .concat(allSizes().filter((r) => r.name && num(r.factor) > 0).map((r) => `<option value="${esc(r.key)}">${esc(r.name)} (${esc(fq(r.factor))} ${esc(baseName())})</option>`));
      sel.innerHTML = opts2.join('');
      if (keep && Array.from(sel.options).some((o) => o.value === keep)) sel.value = keep;
    }
    function renderChips() {
      const base = baseName(); const box = $q('#uk-chips'); const chips = [];
      if (pack && pack.name && num(pack.factor) > 0) {
        const has = (f) => rows.some((r) => Math.abs(num(r.factor) - f) < 0.0005);
        const fr = [['1/4', 0.25], ['1/2', 0.5], ['3/4', 0.75]].map(([l, k]) => ({ name: `${l} ${pack.name}`, factor: r3(num(pack.factor) * k), kind: 'fraction' }));
        if (fr.some((f) => !has(f.factor))) chips.push(`<button type="button" class="btn btn-secondary btn-sm" data-uk-fr="1">+ 1/4, 1/2, 3/4 ${esc(pack.name)}</button>`);
      }
      sizePresets(base).forEach((s, i) => {
        const taken = rows.some((r) => Math.abs(num(r.factor) - s.factor) < 0.0005) || (pack && Math.abs(num(pack.factor) - s.factor) < 0.0005);
        if (!taken) chips.push(`<button type="button" class="btn btn-ghost btn-sm" style="border:1px dashed var(--color-border)" data-uk-size="${i}">+ ${esc(s.name)}</button>`);
      });
      box.innerHTML = chips.join('');
    }
    function renderRows() {
      $q('#uk-rows').innerHTML = rows.map((r) => rowHtml(r, baseName())).join('');
      $q('#uk-markup-unit').textContent = baseName();
    }

    function refresh() {
      const fields = $q('#uk-fields'); const isOn = on.checked && !packetOn();
      $q('#uk-section').style.display = packetOn() ? 'none' : '';
      fields.style.display = on.checked ? '' : 'none';
      // one cost only: the cost box above is replaced by "What you pay ... for one [unit]"
      if (costEl) { costEl.readOnly = isOn; const cf = costEl.closest('.field'); if (cf) cf.style.display = isOn ? 'none' : ''; }
      const pl = modal.querySelector('label[for="p-price"]'); if (pl && isOn) pl.textContent = `Selling price per ${baseName()} - loose (KES)`;
      const base = baseName(); const c = perBaseCost();
      if (costEl && isOn) costEl.value = c > 0 ? String(r4(c)) : '0';
      modal.querySelectorAll('.uk-base').forEach((e) => { e.textContent = base; });
      $q('#uk-markup-unit').textContent = base;
      if (!isOn) { $q('#uk-summary').innerHTML = ''; return; }

      const f = costFactor(); const cv = num($q('#uk-cost').value);
      $q('#uk-cost-line').textContent = c > 0
        ? `Cost per ${base}: ${money(r4(c))}${f !== 1 ? ` (${money(cv)} ÷ ${fq(f)})` : ''}. Every size's cost and profit is worked out from this.`
        : 'Enter what you pay to see the cost and profit of every size.';
      $q('#uk-pack-calc').textContent = pack && pack.name && num(pack.factor) > 0
        ? `1 ${pack.name} = ${fq(pack.factor)} ${base}. Selling whole: ${money(priceOf(pack))}${c > 0 ? ` (profit ${money(priceOf(pack) - c * num(pack.factor))})` : ''}`
        : '';
      if (pack) $q('#uk-pack-price').placeholder = pack.name && num(pack.factor) > 0 ? `auto: ${r2(bp() * num(pack.factor))}` : 'price (auto)';

      // per-row calc lines
      modal.querySelectorAll('.uk-row').forEach((el) => {
        const r = rows.find((x) => x.key === el.dataset.key); if (!r) return;
        const fac = num(r.factor); const calc = el.querySelector('.uk-calc'); const pin = el.querySelector('.uk-price');
        if (fac > 0) pin.placeholder = `auto: ${priceOf(Object.assign({}, r, { price: '' }))}`;
        if (!(fac > 0)) { calc.textContent = 'Enter the size in ' + base; return; }
        const p = priceOf(r); const cost = c * fac; const profit = p - cost;
        const bad = c > 0 && p < cost;
        calc.innerHTML = `${fq(fac)} ${esc(base)} · ${money(p)}${markupApplies(r) ? ` <span class="text-muted">(+${markup()}%)</span>` : ''}${c > 0 ? ` · cost ${money(cost)} · <b style="color:${bad ? RED : 'inherit'}">profit ${money(profit)}${p > 0 ? ` (${r2((profit / p) * 100)}%)` : ''}</b>${bad ? ' - below cost!' : ''}` : ''}`;
      });
      renderSummary(c);
    }

    function renderSummary(c) {
      const base = baseName(); const lines = [];
      const rowOut = (name, fac, p) => {
        const cost = c * fac; const profit = p - cost; const bad = c > 0 && p < cost;
        return `<tr><td>${esc(name)}</td><td>${esc(fq(fac))} ${esc(base)}</td><td>${c > 0 ? money(cost) : '-'}</td><td>${money(p)}</td><td style="color:${bad ? RED : 'inherit'};font-weight:600">${c > 0 ? money(profit) : '-'}</td><td style="color:${bad ? RED : 'inherit'}">${c > 0 && p > 0 ? `${r2((profit / p) * 100)}%` : '-'}</td></tr>`;
      };
      lines.push(rowOut(`1 ${base} (loose)`, 1, bp()));
      allSizes().filter((r) => r.name && num(r.factor) > 0).forEach((r) => lines.push(rowOut(r.name, num(r.factor), priceOf(r))));
      let hint = '';
      if (pack && pack.name && num(pack.factor) > 0) {
        const whole = (r) => { const x = num(pack.factor) / num(r.factor); return Math.abs(x - Math.round(x)) < 0.001; };
        const eq = rows.filter((r) => r.name && num(r.factor) > 0 && num(r.factor) <= num(pack.factor) && whole(r))
          .map((r) => `${fq(num(pack.factor) / num(r.factor))} × ${esc(r.name)}`).slice(0, 6);
        if (eq.length) hint = `<div class="text-xs text-muted" style="margin-top:6px">1 ${esc(pack.name)} can be sold as: ${eq.join(' · ')}</div>`;
      }
      $q('#uk-summary').innerHTML = `<div class="table-wrap"><table class="table" style="font-size:12.5px"><thead><tr><th>Size</th><th>Equals</th><th>Cost</th><th>Price</th><th>Profit</th><th>Margin</th></tr></thead><tbody>${lines.join('')}</tbody></table></div>${hint}`;
    }

    // ---- stock (Add inventory now) in any size ----
    const stockQty = $q('#p-stock-qty');
    let stockSel = null;
    function renderStockUnits() {
      if (!stockSel) return;
      const keep = stockSel.value;
      stockSel.innerHTML = [`<option value="__base">${esc(baseName())}</option>`]
        .concat(allSizes().filter((r) => r.name && num(r.factor) > 0).map((r) => `<option value="${esc(r.key)}">${esc(r.name)} (${esc(fq(r.factor))} ${esc(baseName())})</option>`)).join('');
      if (keep && Array.from(stockSel.options).some((o) => o.value === keep)) stockSel.value = keep;
      const q = num(stockQty.value); const fac = stockFactor();
      const conv = $q('#uk-stock-conv');
      if (conv) conv.textContent = on.checked && !packetOn() && q > 0 && fac !== 1 ? `${fq(q)} × ${stockSel.options[stockSel.selectedIndex].text.split(' (')[0]} = ${fq(q * fac)} ${baseName()} added to stock` : '';
      stockSel.style.display = on.checked && !packetOn() ? '' : 'none';
    }
    function stockFactor() {
      if (!stockSel || !on.checked || packetOn()) return 1;
      const k = stockSel.value;
      if (!k || k === '__base') return 1;
      if (pack && k === pack.key) return num(pack.factor) || 1;
      const r = rows.find((x) => x.key === k); return r ? (num(r.factor) || 1) : 1;
    }
    if (stockQty) {
      stockQty.min = '0.001'; stockQty.step = 'any';
      stockQty.insertAdjacentHTML('afterend', '<select class="select" id="uk-stock-unit" aria-label="Received as" style="margin-top:6px;display:none"></select><span class="field-hint" id="uk-stock-conv"></span>');
      stockSel = $q('#uk-stock-unit');
      ['input', 'change'].forEach((ev) => { stockQty.addEventListener(ev, renderStockUnits); stockSel.addEventListener(ev, renderStockUnits); });
    }

    const packetOn = () => { const p = modal.querySelector('#p-pk-on'); return !!(p && p.checked); };
    const full = () => { readPack(); readRows(); renderCostUnits(); renderStockUnits(); refresh(); };

    // ---- initial values ----
    $q('#uk-pack-name').value = pack ? pack.name : '';
    $q('#uk-pack-size').value = pack ? pack.factor : '';
    $q('#uk-pack-price').value = pack ? pack.price : '';
    renderRows(); renderChips(); renderCostUnits();
    {
      const hasCost = product && num(product.costPrice) > 0;
      const sel = $q('#uk-cost-unit');
      if (hasCost) {
        const target = pack || null; // default: cost per pack when there is one (what the supplier charges)
        if (target) { sel.value = target.key; $q('#uk-cost').value = String(r2(num(product.costPrice) * num(target.factor))); }
        else { sel.value = '__base'; $q('#uk-cost').value = String(r4(num(product.costPrice))); }
      }
    }
    renderStockUnits(); refresh();

    // ---- events ----
    on.addEventListener('change', () => { full(); if (on.checked) $q('#uk-cost').focus(); });
    const pk = modal.querySelector('#p-pk-on'); if (pk) pk.addEventListener('change', full);
    const unitSel = modal.querySelector('#p-unit');
    if (unitSel) unitSel.addEventListener('change', () => { renderRows(); renderChips(); full(); });
    if (priceEl) priceEl.addEventListener('input', () => { refresh(); });
    ['#uk-cost', '#uk-markup'].forEach((q) => $q(q).addEventListener('input', () => { readPack(); readRows(); refresh(); }));
    $q('#uk-cost-unit').addEventListener('change', () => { readPack(); readRows(); refresh(); });
    ['#uk-pack-name', '#uk-pack-size', '#uk-pack-price'].forEach((q) => $q(q).addEventListener('input', () => { readPack(); renderChips(); renderCostUnits(); renderStockUnits(); refresh(); }));
    $q('#uk-rows').addEventListener('input', (e) => {
      readPack(); readRows();
      if (e.target.closest('.uk-name') || e.target.closest('.uk-factor')) { renderChips(); renderCostUnits(); renderStockUnits(); }
      refresh();
    });
    $q('#uk-rows').addEventListener('click', async (e) => {
      const row = e.target.closest('.uk-row'); if (!row) return;
      if (e.target.closest('.uk-del')) { readRows(); rows = rows.filter((r) => r.key !== row.dataset.key); renderRows(); renderChips(); renderCostUnits(); renderStockUnits(); refresh(); return; }
      if (e.target.closest('.uk-gen') && opts.generateBarcode) {
        const inp = row.querySelector('.uk-barcode');
        try { inp.value = await opts.generateBarcode(); inp.dispatchEvent(new Event('input', { bubbles: true })); } catch { window.UI.toast.error('Could not generate a barcode'); }
      }
    });
    $q('#uk-chips').addEventListener('click', (e) => {
      const fr = e.target.closest('[data-uk-fr]'); const sz = e.target.closest('[data-uk-size]');
      if (!fr && !sz) return;
      readPack(); readRows();
      const add = (name, factor, kind) => { if (!rows.some((r) => Math.abs(num(r.factor) - factor) < 0.0005)) rows.push({ key: newKey(), name, factor, price: '', kind, barcode: '' }); };
      if (fr) [['1/4', 0.25], ['1/2', 0.5], ['3/4', 0.75]].forEach(([l, k]) => add(`${l} ${pack.name}`, r3(num(pack.factor) * k), 'fraction'));
      else { const s = sizePresets(baseName())[Number(sz.dataset.ukSize)]; if (s) add(s.name, s.factor, 'size'); }
      renderRows(); renderChips(); renderCostUnits(); renderStockUnits(); refresh();
    });
    $q('#uk-add-row').addEventListener('click', () => {
      readPack(); readRows();
      rows.push({ key: newKey(), name: '', factor: '', price: '', kind: 'custom', barcode: '' });
      renderRows(); renderChips(); renderCostUnits(); refresh();
      const last = modal.querySelector('.uk-row:last-child .uk-name'); if (last) last.focus();
    });

    // ---- collect ----
    const clean = (u, status) => ({ _id: u._id, name: u.name, code: u.code, factor: u.factor, barcode: u.barcode || undefined, wholesalePrice: u.wholesalePrice, retailPrice: u.retailPrice, isWholesaleDefault: !!u.isWholesaleDefault, kind: u.kind, status });
    function belowCostNames() {
      const c = perBaseCost(); if (!(c > 0)) return [];
      return allSizes().filter((r) => r.name && num(r.factor) > 0 && priceOf(r) < c * num(r.factor)).map((r) => r.name);
    }
    return {
      active: () => on.checked && !packetOn(),
      stockBase: (qty) => r3(num(qty) * stockFactor()),
      stockLabel: () => (stockSel && stockFactor() !== 1 ? stockSel.options[stockSel.selectedIndex].text.split(' (')[0] : ''),
      async confirmBelowCost() {
        const names = belowCostNames(); if (!names.length) return true;
        return window.UI.confirmDialog({ title: 'Selling below cost', message: `These sizes sell for less than they cost: ${names.join(', ')}. Save anyway?`, confirmText: 'Save anyway', danger: true });
      },
      /** { touched, units } | { error, focus } - `units` are ONLY this section's units (PKT / DEAL are left to the packet widget). */
      collect() {
        if (packetOn()) return { touched: false, units: [] };
        readPack(); readRows();
        const asInactive = () => origUnits.map((u) => clean(u, 'inactive'));
        if (!on.checked) { const old = asInactive(); return { touched: origUnits.some((u) => u.status !== 'inactive'), units: old }; }
        const base = baseName(); const list = allSizes().filter((r) => r.name || num(r.factor) || num(r.price));
        if (!list.length) return { error: 'Add at least one size (pack, 1/4, 500g...) or untick "Sold or received in different sizes"', focus: $q('#uk-pack-name') };
        const seen = new Set([String(base).toLowerCase()]);
        const units = [];
        let order = 0;
        for (const r of list) {
          const el = r === pack ? $q('#uk-pack-name') : (modal.querySelector(`.uk-row[data-key="${r.key}"] .uk-name`));
          if (!r.name) return { error: 'Every size needs a name', focus: el };
          if (!(num(r.factor) > 0)) return { error: `Enter the size of "${r.name}" in ${base}`, focus: r === pack ? $q('#uk-pack-size') : modal.querySelector(`.uk-row[data-key="${r.key}"] .uk-factor`) };
          if (seen.has(r.name.toLowerCase())) return { error: `The size "${r.name}" is listed twice (or has the same name as the base unit)`, focus: el };
          seen.add(r.name.toLowerCase());
          const custom = num(r.price) > 0 ? num(r.price) : (markupApplies(r) ? priceOf(r) : undefined);
          units.push({
            _id: r.id, name: r.name, code: r.code, factor: r3(num(r.factor)), barcode: r.barcode || undefined,
            retailPrice: custom, wholesalePrice: r.wholesalePrice, isWholesaleDefault: !!r.isWholesaleDefault,
            kind: r === pack ? 'pack' : (r.kind && r.kind !== 'pack' ? r.kind : 'custom'), sortOrder: order += 1, status: 'active',
          });
        }
        // sizes removed from the form are switched off (not deleted) so old sales still point at them
        origUnits.filter((u) => !units.some((x) => x._id && String(x._id) === String(u._id))).forEach((u) => units.push(clean(u, 'inactive')));
        const out = { touched: true, units };
        const c = perBaseCost();
        if (c > 0) out.costPrice = r4(c);
        return out;
      },
    };
  }

  /* ================================================================== *
   * 2. PRICE BREAKDOWN (cost / price / profit / margin of every size + stock in every size)
   * ================================================================== */
  async function openBreakdown(product, opts) {
    opts = opts || {};
    const branchId = opts.branchId || (window.AppShell.getActiveBranchId && window.AppShell.getActiveBranchId()) || undefined;
    let eco;
    try { eco = (await window.Api.get(`/inventory/unit-economics/${product._id}`, { branchId })).data; }
    catch (err) { window.UI.toast.error(err.message || 'Could not load the price breakdown'); return null; }

    const base = eco.baseUnit; const c0 = eco.costPerBaseCents;
    const body = eco.rows.map((r) => {
      const bad = r.belowCost; const col = bad ? RED : 'inherit';
      return `<tr>
        <td><div class="cell-primary">${esc(r.isBase ? `1 ${r.name} (loose)` : r.name)}</div>${r.kind && r.kind !== 'custom' && r.kind !== 'base' ? `<div class="text-xs text-muted">${esc(r.kind)}</div>` : ''}</td>
        <td>${esc(fq(r.factor))} ${esc(base)}</td>
        <td>${c0 > 0 ? cents(r.costCents) : '-'}</td>
        <td>${cents(r.retailCents)}${r.customRetail ? ' <span class="badge badge-neutral">set</span>' : ''}</td>
        <td style="color:${col};font-weight:600">${c0 > 0 ? cents(r.profitCents) : '-'}</td>
        <td style="color:${col}">${r.marginPct == null || !(c0 > 0) ? '-' : `${r.marginPct}%`}${bad ? ' ⚠' : ''}</td>
        <td>${r.wholesaleCents != null ? `${cents(r.wholesaleCents)}${r.wholesaleProfitCents != null && c0 > 0 ? `<div class="text-xs text-muted">profit ${cents(r.wholesaleProfitCents)}</div>` : ''}` : '-'}</td>
      </tr>`;
    }).join('');

    let stockHtml = '';
    if (eco.stock) {
      const s = eco.stock;
      stockHtml = `
        <div class="card" style="margin-top:var(--space-3);padding:var(--space-3)">
          <div class="text-sm"><b>On hand (this branch):</b> ${esc(fq(s.retail))} ${esc(base)}${s.warehouse ? ` shop floor · ${esc(fq(s.warehouse))} ${esc(base)} warehouse` : ''}</div>
          <div class="text-sm" style="margin-top:4px">Worth ${cents(s.valueAtCostCents)} at cost · ${cents(s.valueAtRetailCents)} sold loose · potential profit <b>${cents(s.potentialProfitCents)}</b></div>
          ${(s.inEveryUnit || []).length ? `<div class="text-xs text-muted" style="margin-top:6px">${s.inEveryUnit.map((b) => `${esc(fq(b.whole))} ${esc(b.unit)}${b.remainderBase > 0 ? ` + ${esc(fq(b.remainderBase))} ${esc(base)}` : ''}`).join(' · ')}</div>` : ''}
        </div>`;
    }
    const canBreak = canDo('inventory.adjust') && eco.rows.length > 1;
    const modal = window.UI.openModal({
      title: `Sizes, prices & profit - ${product.name}`,
      maxWidth: '820px',
      bodyHtml: `
        <p class="text-sm text-secondary" style="margin-bottom:var(--space-3)">Cost per ${esc(base)}: <b>${c0 > 0 ? cents(c0) : 'not set'}</b>. Every size below comes out of the same stock, so selling any of them updates the one stock count.</p>
        <div class="table-wrap"><table class="table" style="font-size:13px"><thead><tr><th>Size</th><th>Equals</th><th>Cost</th><th>Price</th><th>Profit</th><th>Margin</th><th>Wholesale</th></tr></thead><tbody>${body}</tbody></table></div>
        ${stockHtml}`,
      footerHtml: `<button class="btn btn-secondary" data-action="close">Close</button>${canBreak ? '<button class="btn btn-primary" data-action="break">Break down stock</button>' : ''}`,
    });
    modal.querySelector('[data-action="close"]').addEventListener('click', window.UI.closeModal);
    const bb = modal.querySelector('[data-action="break"]');
    if (bb) bb.addEventListener('click', () => { window.UI.closeModal(); openBreakModal({ product, branchId, onDone: opts.onDone }); });
    return modal;
  }

  /* ================================================================== *
   * 3. BREAK DOWN STOCK (a 25 kg bag -> 20 x 1 kg + 10 x 500 g ...)
   * ================================================================== */
  async function openBreakModal(opts) {
    opts = opts || {};
    const branchId = opts.branchId || (window.AppShell.getActiveBranchId && window.AppShell.getActiveBranchId());
    if (!branchId) { window.UI.toast.error('Select a branch first'); return null; }
    if (!opts.product) {
      window.ProductPicker.open({ title: 'Select a product to break down', onSelect: ({ product }) => openBreakModal(Object.assign({}, opts, { product })) });
      return null;
    }
    let product = opts.product;
    try { const r = await window.Api.get(`/products/${product._id}`); product = (r.data && r.data.product) || product; } catch { /* use what we have */ }
    if (product.trackSerialNumber) { window.UI.toast.error(`${product.name} is serial-tracked and cannot be broken down`); return null; }
    const units = activeUnits(product).slice().sort((a, b) => num(b.factor) - num(a.factor));
    if (!units.length) { window.UI.toast.error(`${product.name} has no other sizes yet. Edit the product and add sizes (bag, 1/4, 500g...) first.`); return null; }
    const base = product.unit || 'piece';
    const variants = product.hasVariants ? (product.variants || []).filter((v) => v.status !== 'archived') : [];
    const wh = !!(window.AppShell.hasFeature && window.AppShell.hasFeature('multiWarehouse'));
    const unitOpts = (sel, withBase) => (withBase ? `<option value="" ${!sel ? 'selected' : ''}>${esc(base)}</option>` : '')
      + units.map((u) => `<option value="${esc(u._id)}" ${String(sel) === String(u._id) ? 'selected' : ''}>${esc(u.name)} (${esc(fq(u.factor))} ${esc(base)})</option>`).join('');
    const factorOf = (id) => { if (!id) return 1; const u = units.find((x) => String(x._id) === String(id)); return u ? num(u.factor) : 1; };
    const packUnit = units.find((u) => u.kind === 'pack') || units[0];
    const firstOut = units.find((u) => num(u.factor) < num(packUnit.factor)) || null;
    const outRow = (unitId, count) => `<div class="bk-out" style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:6px">
        <input class="input bk-count" type="number" min="0" step="1" inputmode="numeric" value="${count == null ? '' : esc(count)}" placeholder="how many" style="flex:1 1 90px" aria-label="How many" />
        <span class="text-sm">×</span>
        <select class="select bk-ounit" style="flex:2 1 150px" aria-label="Size">${unitOpts(unitId, true)}</select>
        <button type="button" class="btn btn-ghost btn-sm bk-fill" title="Fill with as many as fit">Fill</button>
        <button type="button" class="btn btn-ghost btn-sm bk-rm" aria-label="Remove">${window.Icons.get('trash')}</button></div>`;

    const modal = window.UI.openModal({
      title: `Break down stock - ${product.name}`,
      maxWidth: '780px',
      bodyHtml: `
        <form id="bk-form" novalidate>
          <p class="text-sm text-secondary" style="margin-bottom:var(--space-3)">Choose what you are opening and the sizes you pack it into. Stock is one pool in ${esc(base)}, so breaking only changes it by the wastage; what changes is cost, price and profit per size.</p>
          ${variants.length ? `<div class="field"><label>Variant</label><select class="select" id="bk-variant">${variants.map((v) => `<option value="${esc(v._id)}">${esc(Object.values(v.attributes || {}).join(', ') || v.sku)}</option>`).join('')}</select></div>` : ''}
          ${wh ? '<div class="field"><label>Break down stock in</label><select class="select" id="bk-loc"><option value="RETAIL">Retail (shop floor)</option><option value="WAREHOUSE">Warehouse</option></select></div>' : ''}
          <div class="form-row">
            <div class="field"><label>Break down</label>
              <div style="display:flex;gap:8px"><input class="input" id="bk-qty" type="number" min="0" step="any" inputmode="decimal" value="1" style="flex:1" /><select class="select" id="bk-unit" style="flex:2">${unitOpts(packUnit._id, true)}</select></div>
              <span class="field-hint" id="bk-src-hint"></span></div>
            <div class="field"><label>In stock now</label><div id="bk-stock" style="font-size:18px;font-weight:700;padding:6px 10px;border-radius:8px;background:var(--color-surface-2,#f3f4f6)">…</div><span class="field-hint" id="bk-stock-hint"></span></div>
          </div>
          <div class="field"><label>Into these sizes</label>
            <div id="bk-outs">${outRow(firstOut ? firstOut._id : '', '')}</div>
            <button type="button" class="btn btn-secondary btn-sm" id="bk-add">${window.Icons.get('plus')} Add size</button>
            <div class="field-hint" id="bk-alloc" style="margin-top:6px"></div></div>
          <div class="form-row">
            <div class="field"><label>Wastage / spillage <span class="text-muted">(optional)</span></label>
              <div style="display:flex;gap:8px"><input class="input" id="bk-waste" type="number" min="0" step="any" inputmode="decimal" placeholder="0" style="flex:1" /><select class="select" id="bk-wunit" style="flex:1">${unitOpts('', true)}</select></div></div>
            <div class="field"><label>Packaging / labour cost (KES) <span class="text-muted">(optional)</span></label>
              <input class="input" id="bk-extra" type="number" min="0" step="0.01" inputmode="decimal" placeholder="e.g. 200 for bags and labels" /></div>
          </div>
          <div class="field"><label class="checkbox-row"><input type="checkbox" id="bk-absorb" /> <span class="text-sm">Add the wastage to the stock cost <span class="text-muted">(untick = write it off as a loss at cost)</span></span></label></div>
          <div class="field"><label>Note <span class="text-muted">(optional)</span></label><input class="input" id="bk-note" maxlength="300" placeholder="e.g. repacked for the weekend" /></div>
          <div id="bk-preview" class="text-sm"></div>
        </form>`,
      footerHtml: `<button class="btn btn-secondary" data-action="cancel">Cancel</button><button class="btn btn-primary" data-action="save" id="bk-save" disabled>Break down</button>`,
    });
    const $q = (q) => modal.querySelector(q);
    modal.querySelector('[data-action="cancel"]').addEventListener('click', window.UI.closeModal);

    const variantId = () => (variants.length ? $q('#bk-variant').value : undefined);
    const location = () => (wh ? $q('#bk-loc').value : 'RETAIL');
    const srcBase = () => r3(num($q('#bk-qty').value) * factorOf($q('#bk-unit').value));
    const wasteBase = () => r3(num($q('#bk-waste').value) * factorOf($q('#bk-wunit').value));
    const outs = () => Array.from(modal.querySelectorAll('.bk-out')).map((el) => ({ el, unitId: el.querySelector('.bk-ounit').value, count: num(el.querySelector('.bk-count').value) }));
    let onHand = null; let seqId = 0; let timer = null; let okToSave = false;

    async function loadStock() {
      $q('#bk-stock').textContent = '…';
      try {
        const q = { branchId }; if (variantId()) q.variantId = variantId();
        const d = (await window.Api.get(`/inventory/unit-economics/${product._id}`, q)).data;
        onHand = location() === 'WAREHOUSE' ? num(d.stock && d.stock.warehouse) : num(d.stock && d.stock.retail);
        $q('#bk-stock').textContent = `${fq(onHand)} ${base}`;
        const b = (d.stock && d.stock.inEveryUnit) || [];
        $q('#bk-stock-hint').textContent = b.length && location() === 'RETAIL' ? b.slice(0, 3).map((x) => `${fq(x.whole)} ${x.unit}${x.remainderBase > 0 ? ` + ${fq(x.remainderBase)} ${base}` : ''}`).join(' · ') : '';
      } catch (err) { onHand = null; $q('#bk-stock').textContent = '?'; }
      recalc();
    }

    function recalc() {
      const s = srcBase(); const w = wasteBase();
      const used = r3(outs().reduce((a, o) => a + o.count * factorOf(o.unitId), 0));
      const left = r3(s - used - w);
      $q('#bk-src-hint').textContent = s > 0 ? `= ${fq(s)} ${base}${onHand != null && s > onHand + 0.0005 ? ` - only ${fq(onHand)} ${base} in stock` : ''}` : '';
      const al = $q('#bk-alloc');
      al.innerHTML = s > 0 ? `Packed ${esc(fq(used))} of ${esc(fq(s))} ${esc(base)}${w > 0 ? ` · wastage ${esc(fq(w))}` : ''} · <b style="color:${left < -0.0005 ? RED : 'inherit'}">${left < -0.0005 ? `${esc(fq(-left))} ${esc(base)} too much` : `${esc(fq(left))} ${esc(base)} stays loose in stock`}</b>` : '';
      schedule();
    }

    function schedule() { clearTimeout(timer); timer = setTimeout(preview, 350); }
    function payload() {
      const w = num($q('#bk-waste').value);
      return {
        branchId, productId: product._id, variantId: variantId(), location: location(),
        source: { quantity: num($q('#bk-qty').value), unitId: $q('#bk-unit').value || undefined },
        outputs: outs().filter((o) => o.count > 0).map((o) => ({ unitId: o.unitId || undefined, count: o.count })),
        wastage: w > 0 ? { quantity: w, unitId: $q('#bk-wunit').value || undefined } : undefined,
        extraCost: num($q('#bk-extra').value), absorbWastage: $q('#bk-absorb').checked, note: $q('#bk-note').value.trim() || undefined,
      };
    }
    async function preview() {
      const my = ++seqId; const box = $q('#bk-preview'); const save = $q('#bk-save');
      const p = payload(); okToSave = false; save.disabled = true;
      if (!(p.source.quantity > 0) || (!p.outputs.length && !p.wastage)) { box.innerHTML = '<span class="text-muted">Add how many of each size you are packing to see the cost and profit.</span>'; return; }
      try {
        const d = (await window.Api.post('/inventory/break/preview', p)).data;
        if (my !== seqId) return;
        const s = d.summary;
        const rows = d.lines.map((l) => {
          const bad = l.profitEachCents < 0 && l.priceEachCents > 0;
          return `<tr><td>${esc(l.name)}</td><td>${esc(fq(l.count))}</td><td>${cents(l.costEachCents)}</td><td>${cents(l.priceEachCents)}</td><td style="color:${bad ? RED : 'inherit'};font-weight:600">${cents(l.profitEachCents)}</td><td>${cents(l.profitTotalCents)}</td></tr>`;
        }).join('');
        const costMoved = Math.abs(s.costPerBaseAfterCents - s.costPerBaseBeforeCents) >= 0.5;
        box.innerHTML = `
          ${rows ? `<div class="table-wrap"><table class="table" style="font-size:12.5px"><thead><tr><th>Size</th><th>Pieces</th><th>Cost each</th><th>Price each</th><th>Profit each</th><th>Profit total</th></tr></thead><tbody>${rows}</tbody></table></div>` : ''}
          <div style="margin-top:8px;line-height:1.6">
            ${costMoved ? `Cost per ${esc(base)}: ${cents(s.costPerBaseBeforeCents)} → <b>${cents(s.costPerBaseAfterCents)}</b> (spread over all ${esc(base)} in stock)<br/>` : ''}
            ${s.leftoverBase > 0.0005 ? `${esc(fq(s.leftoverBase))} ${esc(base)} stays loose and can still be sold by any size<br/>` : ''}
            ${s.wastageLossCents > 0 ? `Wastage written off: ${cents(s.wastageLossCents)} at cost<br/>` : ''}
            ${rows ? `Profit if all pieces sell at today's prices: <b>${cents(s.expectedProfitCents)}</b>` : ''}
          </div>
          ${d.warnings.length ? `<div style="margin-top:8px;padding:8px 10px;border-radius:6px;background:#fdecea;border:1px solid #d93025;color:${RED};font-weight:600;font-size:13px">${d.warnings.map(esc).join('<br/>')}</div>` : ''}`;
        okToSave = !!s.canProceed; save.disabled = !okToSave;
      } catch (err) {
        if (my !== seqId) return;
        box.innerHTML = `<span style="color:${RED};font-weight:600">${esc(err.message || 'Could not work this out')}</span>`;
      }
    }

    $q('#bk-form').addEventListener('input', recalc);
    $q('#bk-form').addEventListener('change', (e) => { if (e.target.id === 'bk-variant' || e.target.id === 'bk-loc') loadStock(); else recalc(); });
    $q('#bk-add').addEventListener('click', () => { $q('#bk-outs').insertAdjacentHTML('beforeend', outRow('', '')); recalc(); });
    $q('#bk-outs').addEventListener('click', (e) => {
      const row = e.target.closest('.bk-out'); if (!row) return;
      if (e.target.closest('.bk-rm')) { if (modal.querySelectorAll('.bk-out').length > 1) row.remove(); else row.querySelector('.bk-count').value = ''; recalc(); return; }
      if (e.target.closest('.bk-fill')) {
        const others = outs().filter((o) => o.el !== row).reduce((a, o) => a + o.count * factorOf(o.unitId), 0);
        const f = factorOf(row.querySelector('.bk-ounit').value);
        row.querySelector('.bk-count').value = String(Math.max(Math.floor(r3((srcBase() - wasteBase() - others) / f)), 0));
        recalc();
      }
    });

    $q('#bk-save').addEventListener('click', async (e) => {
      if (!okToSave) return;
      const p = payload();
      const ok = await window.UI.confirmDialog({
        title: 'Break down stock',
        message: `Break ${fq(p.source.quantity)} ${$q('#bk-unit').selectedOptions[0].text.split(' (')[0]} of ${product.name} into ${p.outputs.map((o) => `${fq(o.count)} × ${(units.find((u) => String(u._id) === String(o.unitId)) || { name: base }).name}`).join(', ') || 'wastage only'}?`,
        confirmText: 'Yes, break down',
      });
      if (!ok) return;
      window.UI.setButtonLoading(e.currentTarget, true, 'Saving…');
      try {
        const d = (await window.Api.post('/inventory/break', p)).data;
        const s = d.summary;
        window.UI.toast.success(`Broken down into ${fq(s.totalPieces)} piece${s.totalPieces === 1 ? '' : 's'}${s.wastageBase > 0 ? `, ${fq(s.wastageBase)} ${base} wastage recorded` : ''}`);
        window.UI.closeModal();
        if (opts.onDone) opts.onDone(d);
      } catch (err) {
        window.UI.toast.error(err.message || 'Could not break down the stock');
        window.UI.setButtonLoading(e.currentTarget, false);
      }
    });

    loadStock();
    return modal;
  }

  /* ================================================================== *
   * 4. UNIT PICKER FOR RECEIVE / ADJUST STOCK (inventory.js)
   * ================================================================== */
  function attachQtyUnit(cfg) {
    const { qtyInput, costInput, mode = 'receive', onChange } = cfg;
    let product = null;
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:none;margin-top:6px';
    wrap.innerHTML = '<select class="select" data-uk-unit aria-label="Unit"></select><span class="field-hint" data-uk-hint style="display:block"></span>';
    qtyInput.insertAdjacentElement('afterend', wrap);
    const sel = wrap.querySelector('[data-uk-unit]'); const hint = wrap.querySelector('[data-uk-hint]');

    let costWrap = null; let updBox = null; let costLabel = null; let costLabelOrig = '';
    if (costInput) {
      costWrap = document.createElement('div');
      costWrap.style.cssText = 'display:none;margin-top:6px';
      costWrap.innerHTML = '<span class="field-hint" data-uk-cost-hint style="display:block"></span><label class="checkbox-row" style="margin-top:4px"><input type="checkbox" data-uk-upd checked /> <span class="text-sm">Update the product cost price (average of old and new stock)</span></label>';
      costInput.insertAdjacentElement('afterend', costWrap);
      updBox = costWrap.querySelector('[data-uk-upd]');
      const f = costInput.closest('.field'); costLabel = f ? f.querySelector('label') : null; costLabelOrig = costLabel ? costLabel.textContent : '';
    }

    const baseName = () => (product && product.unit) || 'piece';
    const current = () => {
      const id = sel.value; if (!product || !id) return { id: null, name: baseName(), factor: 1, unit: null };
      const u = activeUnits(product).find((x) => String(x._id) === String(id));
      return u ? { id: u._id, name: u.name, factor: num(u.factor), unit: u } : { id: null, name: baseName(), factor: 1, unit: null };
    };
    const fractional = () => !!product && (isMeasured(product) || activeUnits(product).length > 0);

    function refresh() {
      const u = current(); const q = num(qtyInput.value); const base = baseName();
      hint.textContent = product && u.factor !== 1 && q > 0 ? `= ${fq(q * u.factor)} ${base}${mode === 'receive' ? ' added to stock' : ''}` : '';
      if (costInput && costWrap) {
        const ch = costWrap.querySelector('[data-uk-cost-hint]'); const cost = num(costInput.value);
        updBox.parentElement.style.display = cost > 0 ? '' : 'none';
        if (product && cost > 0) {
          const per = cost / u.factor;
          let t = `Cost per ${base}: ${money(r4(per))}`;
          let bad = false;
          if (!product.hasVariants) {
            const retail = u.unit ? (u.unit.retailPrice != null && u.unit.retailPrice !== '' ? num(u.unit.retailPrice) : r2(num(product.sellingPrice) * u.factor)) : num(product.sellingPrice);
            if (retail > 0) { const profit = retail - cost; bad = profit < 0; t += ` · sells at ${money(retail)} per ${u.name}: ${bad ? 'LOSS of ' : 'profit '}${money(Math.abs(profit))} (${r2((profit / retail) * 100)}%)`; }
          }
          ch.textContent = t; ch.style.color = bad ? RED : '';
        } else { ch.textContent = ''; }
      }
      if (onChange) onChange();
    }

    function setProduct(p) {
      product = p || null;
      const us = activeUnits(product).slice().sort((a, b) => num(b.factor) - num(a.factor));
      const serial = !!(product && product.trackSerialNumber);
      sel.innerHTML = `<option value="">${esc(baseName())}</option>` + us.map((u) => `<option value="${esc(u._id)}">${esc(u.name)} (${esc(fq(u.factor))} ${esc(baseName())})</option>`).join('');
      wrap.style.display = product && us.length && !serial ? '' : 'none';
      if (costWrap) costWrap.style.display = product && !serial ? '' : 'none';
      if (fractional()) { qtyInput.step = 'any'; qtyInput.min = '0.001'; qtyInput.setAttribute('inputmode', 'decimal'); }
      if (costLabel) costLabel.textContent = costLabelOrig;
      refresh();
    }
    sel.addEventListener('change', () => {
      if (costLabel) { const u = current(); costLabel.textContent = u.id ? `Cost price per ${u.name} (KES, optional)` : costLabelOrig; }
      refresh();
    });
    qtyInput.addEventListener('input', refresh);
    if (costInput) costInput.addEventListener('input', refresh);

    return {
      setProduct, refresh, fractional,
      unitId: () => current().id || undefined,
      unitName: () => current().name,
      factor: () => current().factor,
      entered: () => num(qtyInput.value),
      base: (q) => r3(num(q) * current().factor),
      validBase: (b) => isMeasured(product) || Number.isInteger(r3(b)),
      updateCost: () => (updBox ? updBox.checked : undefined),
    };
  }

  window.UnitKit = { applies, isMeasured, activeUnits, sizePresets, sectionHtml, bind, openBreakdown, openBreakModal, attachQtyUnit };
})(window);
