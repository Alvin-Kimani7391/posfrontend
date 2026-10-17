/**
 * wholesale-product-form.js - the WHOLESALE-FIRST part of the Add / Edit product form (used by products.js).
 *
 * For a wholesale business the product is entered the way a wholesaler buys and sells it:
 *   1. WHOLESALE (default, always shown): wholesale unit (carton, sack, bundle...), cost and wholesale price per unit.
 *   2. "Also sell as retail" (off by default). When on, the owner sets the RETAIL price either per whole wholesale
 *      unit, per single retail unit, or both - and, if the business has unit conversions, how the wholesale unit
 *      breaks down (1 carton = 24 packets) plus any extra selling units (bundle = 6 packets) with their own prices.
 *
 * How it maps onto the existing stock model (nothing about stock changes):
 *   - Stock is counted in the BASE unit (Product.unit). With a breakdown the base unit is the single retail unit and the
 *     wholesale unit becomes a converted unit (units[] entry with factor = N and isWholesaleDefault). Without a
 *     breakdown the base unit IS the wholesale unit (factor 1).
 *   - costPrice / wholesalePrice / sellingPrice are sent PER BASE UNIT; unit prices ride on units[].
 *   - pricingMode = WHOLESALE_FIRST, retailEnabled = on/off. The server re-validates everything.
 *
 * Public API (window.WholesaleProductForm):
 *   applies(product)             -> true when the wholesale-first form should be used (new product in a wholesale
 *                                   business, or an existing WHOLESALE_FIRST product)
 *   html(product)                -> markup for the pricing / units part of the modal
 *   bind(modal, { product })     -> wires the dynamic behaviour (toggles, live preview, extra-unit rows)
 *   collect(modal, { product })  -> { payload } or { error, focus } - payload fields to merge into the save request
 */
(function (window) {
  'use strict';

  // Same list as the backend Product.UNITS enum (the BASE unit must be one of these).
  const UNITS = [
    'piece', 'kg', 'g', 'litre', 'ml', 'metre', 'box', 'packet', 'bundle', 'carton', 'dozen', 'pack', 'bag', 'sack',
    'bottle', 'tin', 'sachet', 'roll', 'pair', 'set', 'tray', 'crate', 'pallet', 'tablet', 'strip',
  ];
  const DEFAULT_WHOLESALE_UNIT = 'carton';
  const DEFAULT_RETAIL_UNIT = 'piece';
  const MAX_EXTRA_UNITS = 8; // the backend allows 10 units in total; one is the wholesale unit

  const esc = (s) => window.UI.escapeHtml(String(s === undefined || s === null ? '' : s));
  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  const r2 = (n) => Math.round(n * 100) / 100;
  const r4 = (n) => Math.round(n * 10000) / 10000;
  const money = (n) => window.UI.formatMoney(r2(n));
  const qty = (n) => String(Math.round(n * 1000) / 1000);
  const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

  function profile() {
    try { return (window.AppShell && window.AppShell.getBusinessProfile && window.AppShell.getBusinessProfile()) || null; } catch { return null; }
  }
  const isWholesaleBusiness = () => { const p = profile(); return !!p && p.businessType === 'wholesale'; };
  const conversionsOn = () => !!(window.AppShell && window.AppShell.hasFeature && window.AppShell.hasFeature('unitConversions'));

  function applies(product) {
    if (product) return product.pricingMode === 'WHOLESALE_FIRST';
    return isWholesaleBusiness();
  }

  function injectStyle() {
    if (document.getElementById('wpf-style')) return;
    const st = document.createElement('style');
    st.id = 'wpf-style';
    st.textContent = `
      .wpf [hidden] { display: none !important; }
      .wpf-card { border: 1px solid var(--color-border); border-radius: var(--radius-md); padding: var(--space-3); margin-bottom: var(--space-4); }
      .wpf-card.is-default { border-color: var(--color-primary); }
      .wpf-title { display: flex; align-items: center; gap: var(--space-2); font-weight: 600; font-size: var(--text-sm); margin-bottom: var(--space-1); }
      .wpf-tag { font-size: var(--text-xs); font-weight: 500; padding: 1px 8px; border-radius: 999px; background: var(--color-primary); color: #fff; }
      .wpf-sub { border-top: 1px dashed var(--color-border); margin-top: var(--space-3); padding-top: var(--space-3); }
      .wpf-extra { border: 1px solid var(--color-border); border-radius: var(--radius-md); padding: var(--space-3); margin-bottom: var(--space-2); }
      .wpf-extra .form-row { margin-bottom: var(--space-2); }
      .wpf-preview { font-size: var(--text-sm); background: var(--color-surface-alt, rgba(127,127,127,.08)); border-radius: var(--radius-md); padding: var(--space-3); margin-bottom: var(--space-4); }
      .wpf-preview ul { margin: 0; padding-left: 18px; }
      .wpf-preview li { margin: 2px 0; }
      .wpf-warn { color: var(--color-danger, #c0392b); }
      .wpf-ok { color: var(--color-success, #1e8449); }
    `;
    document.head.appendChild(st);
  }

  /* ------------------------------------------------------------------ *
   * Existing product -> form state
   * ------------------------------------------------------------------ */
  function stateFrom(product) {
    const blank = {
      wUnit: DEFAULT_WHOLESALE_UNIT, rUnit: DEFAULT_RETAIL_UNIT, split: false, n: '', cost: '', wprice: '',
      retailOn: false, single: '', whole: '', extras: [], wId: null, hasWholesaleUnit: false, baseLocked: false,
    };
    if (!product) return blank;

    const units = (product.units || []).filter((u) => u.status !== 'inactive');
    const wu = units.find((u) => u.isWholesaleDefault);
    const retailOn = product.retailEnabled !== false;
    const selling = num(product.sellingPrice);

    if (wu) {
      const n = num(wu.factor);
      const whole = num(wu.retailPrice) > 0 ? num(wu.retailPrice) : '';
      // A single price that is just the whole price / N was derived by the form, not typed: leave it empty.
      const derived = whole !== '' && Math.abs(selling * n - whole) <= n * 0.005 + 0.01;
      return {
        wUnit: wu.name, rUnit: product.unit, split: true, n,
        cost: num(product.costPrice) > 0 ? r2(num(product.costPrice) * n) : '',
        wprice: num(wu.wholesalePrice) > 0 ? num(wu.wholesalePrice) : '',
        retailOn, single: retailOn && selling > 0 && !derived ? selling : '', whole: retailOn ? whole : '',
        extras: units.filter((u) => u !== wu).map((u) => ({
          id: u._id, name: u.name, qty: num(u.factor),
          wprice: num(u.wholesalePrice) > 0 ? num(u.wholesalePrice) : '', rprice: num(u.retailPrice) > 0 ? num(u.retailPrice) : '',
        })),
        wId: wu._id, hasWholesaleUnit: true, baseLocked: true,
      };
    }
    // No breakdown: the base unit is the wholesale unit (stock is counted in it, so it stays fixed on edit).
    return {
      ...blank, wUnit: product.unit || DEFAULT_WHOLESALE_UNIT, split: false, n: 1,
      cost: num(product.costPrice) > 0 ? num(product.costPrice) : '',
      wprice: num(product.wholesalePrice) > 0 ? num(product.wholesalePrice) : '',
      retailOn, whole: retailOn && selling > 0 ? selling : '', baseLocked: true,
    };
  }

  /* ------------------------------------------------------------------ *
   * Markup
   * ------------------------------------------------------------------ */
  const unitOptions = (selected) => {
    const list = UNITS.includes(selected) || !selected ? UNITS : [selected, ...UNITS];
    return list.map((u) => `<option value="${esc(u)}" ${u === selected ? 'selected' : ''}>${esc(u)}</option>`).join('');
  };

  function extraRowHtml(x) {
    x = x || {};
    return `
      <div class="wpf-extra" data-extra ${x.id ? `data-id="${esc(x.id)}"` : ''}>
        <div class="form-row">
          <div class="field" style="margin-bottom:var(--space-2)">
            <label>Unit name</label>
            <input class="input" data-x="name" list="wp-unit-names" maxlength="30" placeholder="e.g. bundle, half carton" value="${esc(x.name || '')}" />
          </div>
          <div class="field" style="margin-bottom:var(--space-2)">
            <label>Contains how many <span data-ru></span>?</label>
            <input class="input" data-x="qty" type="number" step="any" min="0" inputmode="decimal" placeholder="e.g. 6" value="${x.qty ? esc(x.qty) : ''}" />
          </div>
        </div>
        <div class="form-row">
          <div class="field" style="margin-bottom:var(--space-2)">
            <label>Wholesale price (KES) <span class="text-muted">(optional)</span></label>
            <input class="input" data-x="wprice" type="number" step="0.01" min="0" inputmode="decimal" placeholder="Auto from the carton price" value="${x.wprice ? esc(x.wprice) : ''}" />
          </div>
          <div class="field" style="margin-bottom:var(--space-2)">
            <label>Retail price (KES) <span class="text-muted">(optional)</span></label>
            <input class="input" data-x="rprice" type="number" step="0.01" min="0" inputmode="decimal" placeholder="Auto from the single price" value="${x.rprice ? esc(x.rprice) : ''}" />
          </div>
        </div>
        <button type="button" class="btn btn-ghost btn-sm" data-remove-extra>${window.Icons.get('trash')} Remove</button>
      </div>`;
  }

  function html(product) {
    injectStyle();
    const s = stateFrom(product);
    const canSplit = conversionsOn() || s.hasWholesaleUnit;
    const lockedHint = s.baseLocked && !s.hasWholesaleUnit
      ? '<span class="field-hint">Stock of this product is already counted in this unit, so it can\'t be changed. (To sell it in smaller units, add a new product.)</span>' : '';
    return `
      <div class="wpf" id="wpf">
        <datalist id="wp-unit-names">${UNITS.map((u) => `<option value="${esc(u)}"></option>`).join('')}</datalist>

        <div class="wpf-card is-default">
          <div class="wpf-title">Wholesale <span class="wpf-tag">Default</span></div>
          <span class="field-hint">Enter the product the way you buy and sell it in bulk.</span>
          <div class="form-row" style="margin-top:var(--space-3)">
            <div class="field">
              <label for="wp-wunit">Wholesale unit</label>
              <select class="select" id="wp-wunit" ${s.baseLocked && !s.hasWholesaleUnit ? 'disabled' : ''}>${unitOptions(s.wUnit)}</select>
              ${lockedHint}
            </div>
            <div class="field">
              <label for="wp-wprice">Wholesale price per <b data-wu></b> (KES)</label>
              <input class="input" id="wp-wprice" type="number" step="0.01" min="0" inputmode="decimal" required value="${s.wprice !== '' ? esc(s.wprice) : ''}" placeholder="0.00" />
            </div>
          </div>
          <div class="field" style="margin-bottom:0">
            <label for="wp-cost">Cost price per <b data-wu></b> (KES) <span class="text-muted">(what you pay your supplier)</span></label>
            <input class="input" id="wp-cost" type="number" step="0.01" min="0" inputmode="decimal" value="${s.cost !== '' ? esc(s.cost) : ''}" placeholder="0.00" style="max-width:240px" />
          </div>
        </div>

        <div class="wpf-card">
          <label class="checkbox-row"><input type="checkbox" id="wp-retail-on" ${s.retailOn ? 'checked' : ''} /> <span class="text-sm font-semibold">Also sell as retail</span></label>
          <span class="field-hint">Off = wholesale only. Turn on to sell to walk-in customers, at a retail price per whole unit, per single item, or both.</span>

          <div id="wp-retail-box" class="wpf-sub" ${s.retailOn ? '' : 'hidden'}>
            ${canSplit ? `
            <label class="checkbox-row"><input type="checkbox" id="wp-split" ${s.split ? 'checked' : ''} ${s.hasWholesaleUnit || s.baseLocked ? 'disabled' : ''} /> <span class="text-sm">Break each <b data-wu></b> into smaller retail units <span class="text-muted">(unit conversion)</span></span></label>
            ${s.baseLocked && !s.hasWholesaleUnit ? '<span class="field-hint" style="display:block">Stock of this product is already counted in whole units, so it can\'t be split afterwards. Add a new product to sell it in smaller units.</span>' : ''}
            <div id="wp-split-box" ${s.split ? '' : 'hidden'} style="margin-top:var(--space-3)">
              <div class="form-row">
                <div class="field">
                  <label for="wp-runit">Single retail unit</label>
                  <select class="select" id="wp-runit" ${s.hasWholesaleUnit ? 'disabled' : ''}>${unitOptions(s.rUnit)}</select>
                  ${s.hasWholesaleUnit ? '<span class="field-hint">Stock is counted in this unit, so it can\'t be changed.</span>' : ''}
                </div>
                <div class="field">
                  <label for="wp-n">How many <b data-ru></b> in one <b data-wu></b>?</label>
                  <input class="input" id="wp-n" type="number" step="any" min="0" inputmode="decimal" value="${s.n !== '' ? esc(s.n) : ''}" placeholder="e.g. 24" />
                </div>
              </div>
            </div>` : `
            <span class="field-hint" style="display:block;margin-bottom:var(--space-3)">Want to sell single items out of a carton or sack? Turn on "Unit conversions" in Settings &rarr; Business type to break wholesale units into retail units.</span>`}

            <div class="form-row" style="margin-top:var(--space-3)">
              <div class="field" id="wp-single-f" ${s.split ? '' : 'hidden'}>
                <label for="wp-single">Retail price per single <b data-ru></b> (KES)</label>
                <input class="input" id="wp-single" type="number" step="0.01" min="0" inputmode="decimal" value="${s.single !== '' ? esc(s.single) : ''}" placeholder="0.00" />
                <span class="field-hint" id="wp-single-h"></span>
              </div>
              <div class="field" id="wp-whole-f">
                <label for="wp-whole" id="wp-whole-l">Retail price per <b data-wu></b> (KES)</label>
                <input class="input" id="wp-whole" type="number" step="0.01" min="0" inputmode="decimal" value="${s.whole !== '' ? esc(s.whole) : ''}" placeholder="0.00" />
                <span class="field-hint" id="wp-whole-h"></span>
              </div>
            </div>
            <span class="field-hint" id="wp-pick-hint" ${s.split ? '' : 'hidden'}>Fill one price or both: whole units, single items, or either. The other is worked out for you.</span>

            <div id="wp-extras-wrap" class="wpf-sub" ${s.split ? '' : 'hidden'}>
              <div class="text-sm font-semibold">More selling units <span class="text-muted">(optional)</span></div>
              <span class="field-hint" style="display:block;margin-bottom:var(--space-2)">Other ways you sell or move this product, e.g. a bundle of 6 <span data-ru></span>. Leave prices empty to calculate them from the unit's size.</span>
              <div id="wp-extras">${s.extras.map(extraRowHtml).join('')}</div>
              <button type="button" class="btn btn-secondary btn-sm" id="wp-add-extra">${window.Icons.get('plus')} Add unit</button>
            </div>
          </div>
        </div>

        <div class="wpf-preview" id="wp-preview"></div>
      </div>`;
  }

  /* ------------------------------------------------------------------ *
   * Behaviour
   * ------------------------------------------------------------------ */
  function bind(modal, { product } = {}) {
    const root = modal.querySelector('#wpf');
    if (!root) return;
    const q = (id) => root.querySelector(`#${id}`);
    const isEdit = !!product;
    const s0 = stateFrom(product);

    const unitNames = () => {
      const wu = q('wp-wunit').value;
      const splitOn = isSplit(root, s0, isEdit);
      return { wu, ru: splitOn ? q('wp-runit').value : wu };
    };

    function refresh() {
      const retailOn = q('wp-retail-on').checked;
      q('wp-retail-box').hidden = !retailOn;
      const split = isSplit(root, s0, isEdit);
      const splitBox = q('wp-split-box');
      if (splitBox) splitBox.hidden = !split;
      q('wp-single-f').hidden = !split;
      q('wp-pick-hint').hidden = !split;
      q('wp-extras-wrap').hidden = !split;

      const { wu, ru } = unitNames();
      root.querySelectorAll('[data-wu]').forEach((e) => { e.textContent = wu; });
      root.querySelectorAll('[data-ru]').forEach((e) => { e.textContent = ru; });
      q('wp-whole-l').innerHTML = split
        ? `Retail price per whole <b>${esc(wu)}</b> (KES)`
        : `Retail price per <b>${esc(wu)}</b> (KES)`;

      renderPreview(root, s0, isEdit);
    }

    root.addEventListener('input', refresh);
    root.addEventListener('change', refresh);

    const addBtn = q('wp-add-extra');
    if (addBtn) {
      addBtn.addEventListener('click', () => {
        const wrap = q('wp-extras');
        if (wrap.querySelectorAll('[data-extra]').length >= MAX_EXTRA_UNITS) { window.UI.toast.error(`You can add up to ${MAX_EXTRA_UNITS} extra units`); return; }
        wrap.insertAdjacentHTML('beforeend', extraRowHtml());
        refresh();
        const last = wrap.querySelector('[data-extra]:last-child [data-x="name"]');
        if (last) last.focus();
      });
    }
    root.addEventListener('click', (e) => {
      const rm = e.target.closest('[data-remove-extra]');
      if (rm) { rm.closest('[data-extra]').remove(); refresh(); }
    });

    refresh();
  }

  /** Is the "break into smaller units" set-up active? (Always on for a product that already has a wholesale unit.) */
  function isSplit(root, s0, isEdit) {
    if (isEdit && s0.hasWholesaleUnit) return true;
    const retailOn = root.querySelector('#wp-retail-on').checked;
    const box = root.querySelector('#wp-split');
    return !!(retailOn && box && box.checked);
  }

  /* ------------------------------------------------------------------ *
   * Reading the form (shared by the preview and the save)
   * ------------------------------------------------------------------ */
  function read(root, s0, isEdit) {
    const q = (id) => root.querySelector(`#${id}`);
    const split = isSplit(root, s0, isEdit);
    const wUnit = q('wp-wunit').value;
    const rUnit = split ? q('wp-runit').value : wUnit;
    return {
      split, wUnit, rUnit,
      retailOn: q('wp-retail-on').checked,
      n: split ? num(q('wp-n').value) : 1,
      wprice: num(q('wp-wprice').value),
      cost: num(q('wp-cost').value),
      single: split ? num(q('wp-single').value) : 0,
      whole: num(q('wp-whole').value),
      extras: split ? Array.from(root.querySelectorAll('[data-extra]')).map((row) => {
        const f = (k) => row.querySelector(`[data-x="${k}"]`).value;
        return { el: row, id: row.dataset.id || undefined, name: f('name').trim(), qty: num(f('qty')), wprice: num(f('wprice')), rprice: num(f('rprice')), blank: !f('name').trim() && !f('qty') && !f('wprice') && !f('rprice') };
      }) : [],
    };
  }

  function renderPreview(root, s0, isEdit) {
    const box = root.querySelector('#wp-preview');
    const v = read(root, s0, isEdit);
    const lines = [];
    const warns = [];
    const N = v.split && v.n > 0 ? v.n : 1;

    if (v.split && v.n > 0) lines.push(`1 <b>${esc(v.wUnit)}</b> = <b>${qty(v.n)} ${esc(v.rUnit)}</b>`);
    if (v.wprice > 0) {
      let t = `Wholesale: <b>${money(v.wprice)}</b> per ${esc(v.wUnit)}`;
      if (v.split && v.n > 0) t += ` (${money(v.wprice / N)} per ${esc(v.rUnit)})`;
      lines.push(t);
      if (v.cost > 0) {
        const profit = v.wprice - v.cost;
        const cls = profit < 0 ? 'wpf-warn' : 'wpf-ok';
        lines.push(`<span class="${cls}">Wholesale profit: ${money(profit)} per ${esc(v.wUnit)} (${r2((profit / v.wprice) * 100)}%)</span>`);
        if (profit < 0) warns.push('below cost');
      }
    }
    if (v.retailOn) {
      const singleEff = v.single > 0 ? v.single : (v.whole > 0 ? v.whole / N : 0);
      const wholeEff = v.whole > 0 ? v.whole : (v.single > 0 ? v.single * N : 0);
      if (singleEff > 0 || wholeEff > 0) {
        if (v.split) lines.push(`Retail: <b>${money(singleEff)}</b> per ${esc(v.rUnit)} &middot; <b>${money(wholeEff)}</b> per whole ${esc(v.wUnit)}`);
        else lines.push(`Retail: <b>${money(wholeEff)}</b> per ${esc(v.wUnit)}`);
        if (v.cost > 0) {
          const profit = wholeEff - v.cost;
          lines.push(`<span class="${profit < 0 ? 'wpf-warn' : 'wpf-ok'}">Retail profit: ${money(profit)} per ${esc(v.wUnit)} (${wholeEff > 0 ? r2((profit / wholeEff) * 100) : 0}%)</span>`);
        }
        if (v.wprice > 0 && wholeEff <= v.wprice) lines.push(`<span class="wpf-warn">Retail must be higher than wholesale (${money(v.wprice)} per ${esc(v.wUnit)}).</span>`);
      } else {
        lines.push('<span class="text-muted">Enter a retail price to sell this product at retail.</span>');
      }
      const sh = root.querySelector('#wp-single-h');
      const wh = root.querySelector('#wp-whole-h');
      if (sh) sh.textContent = v.single <= 0 && v.whole > 0 && v.split ? `Worked out: ${money(v.whole / N)} per ${v.rUnit}` : (v.single > 0 && v.wprice > 0 ? `Wholesale per ${v.rUnit}: ${money(v.wprice / N)}` : '');
      if (wh) wh.textContent = v.whole <= 0 && v.single > 0 && v.split ? `Worked out: ${money(v.single * N)} per ${v.wUnit}` : '';
    } else {
      lines.push('<span class="text-muted">Wholesale only. It will not appear on the retail till.</span>');
    }
    box.innerHTML = `<ul>${lines.map((l) => `<li>${l}</li>`).join('')}</ul>`;
  }

  /* ------------------------------------------------------------------ *
   * Validate + build the request payload
   * ------------------------------------------------------------------ */
  function collect(modal, { product } = {}) {
    const root = modal.querySelector('#wpf');
    const q = (id) => root.querySelector(`#${id}`);
    const isEdit = !!product;
    const s0 = stateFrom(product);
    const v = read(root, s0, isEdit);
    const fail = (message, el) => ({ error: message, focus: el });

    if (!(v.wprice > 0)) return fail('Enter the wholesale price', q('wp-wprice'));

    const N = v.split ? v.n : 1;
    if (v.split) {
      if (!(N > 1)) return fail(`Enter how many ${v.rUnit} are in one ${v.wUnit} (more than 1)`, q('wp-n'));
      if (v.rUnit === v.wUnit) return fail('The single retail unit must be different from the wholesale unit', q('wp-runit'));
    }

    if (v.retailOn) {
      if (v.split) {
        if (!(v.single > 0) && !(v.whole > 0)) return fail('Enter a retail price: per single item, per whole unit, or both', q('wp-single'));
        if (v.single > 0 && v.single <= v.wprice / N) return fail(`Retail price per ${v.rUnit} must be higher than the wholesale price per ${v.rUnit} (${money(v.wprice / N)})`, q('wp-single'));
        if (v.whole > 0 && v.whole <= v.wprice) return fail(`Retail price per ${v.wUnit} must be higher than the wholesale price (${money(v.wprice)})`, q('wp-whole'));
      } else {
        if (!(v.whole > 0)) return fail('Enter the retail price, or turn off "Also sell as retail"', q('wp-whole'));
        if (v.whole <= v.wprice) return fail(`Retail price must be higher than the wholesale price (${money(v.wprice)})`, q('wp-whole'));
      }
    }

    // Extra units
    const extras = [];
    if (v.split) {
      const taken = new Set([v.wUnit.toLowerCase(), v.rUnit.toLowerCase()]);
      for (const x of v.extras) {
        if (x.blank) continue;
        const nameEl = x.el.querySelector('[data-x="name"]');
        const qtyEl = x.el.querySelector('[data-x="qty"]');
        if (!x.name) return fail('Give every extra unit a name', nameEl);
        if (taken.has(x.name.toLowerCase())) return fail(`The unit name "${x.name}" is used twice (or equals the wholesale / single unit)`, nameEl);
        taken.add(x.name.toLowerCase());
        if (!(x.qty > 0)) return fail(`Enter how many ${v.rUnit} are in one ${x.name}`, qtyEl);
        if (x.wprice > 0 && x.rprice > 0 && x.rprice <= x.wprice) return fail(`${x.name}: the retail price must be higher than its wholesale price`, x.el.querySelector('[data-x="rprice"]'));
        extras.push({
          ...(x.id ? { _id: x.id } : {}), name: x.name, factor: x.qty,
          ...(x.wprice > 0 ? { wholesalePrice: x.wprice } : {}), ...(x.rprice > 0 ? { retailPrice: x.rprice } : {}),
        });
      }
      if (extras.length + 1 > 10) return fail('A product can have at most 10 units', q('wp-add-extra'));
    }

    // ---- payload: money fields are PER BASE UNIT; unit prices are per that unit ----
    const payload = {
      pricingMode: 'WHOLESALE_FIRST',
      retailEnabled: v.retailOn,
      wholesaleEnabled: false,
      costPrice: v.cost > 0 ? r4(v.cost / N) : 0,
      wholesalePrice: r4(v.wprice / N),
    };
    if (v.retailOn) payload.sellingPrice = v.single > 0 ? v.single : r4(v.whole / N);
    if (!isEdit) payload.unit = v.rUnit; // the base unit; stock is counted in it (fixed once the product exists)

    if (v.split) {
      payload.units = [
        {
          ...(s0.wId ? { _id: s0.wId } : {}), name: v.wUnit, factor: N, wholesalePrice: v.wprice,
          ...(v.whole > 0 ? { retailPrice: v.whole } : {}), isWholesaleDefault: true,
        },
        ...extras,
      ];
    } else if (!isEdit) {
      payload.units = [];
    }
    return { payload, display: { price: payload.sellingPrice !== undefined ? payload.sellingPrice : payload.wholesalePrice } };
  }

  /** Small helper for the products table: { wholesale, unit, retail, retailUnit, retailOn } in decimal KES. */
  function summarize(p) {
    const wu = (p.units || []).find((u) => u.isWholesaleDefault && u.status !== 'inactive');
    return {
      wholesale: wu ? num(wu.wholesalePrice) : num(p.wholesalePrice),
      unit: wu ? wu.name : p.unit,
      retailOn: p.retailEnabled !== false,
      retail: num(p.sellingPrice),
      retailUnit: p.unit,
    };
  }

  window.WholesaleProductForm = { applies, html, bind, collect, summarize, UNITS, cap };
})(window);
