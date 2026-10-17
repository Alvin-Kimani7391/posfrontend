/**
 * wholesale-kit.js - shared helpers for the wholesale experience. Wholesale is no longer a separate section:
 * it lives INSIDE four hybrid pages (shown when the business has the multiWarehouse feature):
 *   dashboard.html  -> js/pages/wholesale-dashboard.js   (wholesale desk under the normal dashboard)
 *   inventory.html  -> js/pages/wholesale-inventory.js   ("Wholesale inventory": warehouses, receive, stock, move, adjust, history)
 *   suppliers.html  -> js/pages/wholesale-suppliers.js   (suppliers + payables: ageing, invoices, payments, statements)
 *   reports.html    -> js/pages/wholesale-report.js      (a "Wholesale" tab next to every other report)
 * Selling lives on sales.html (Retail | Wholesale switch).
 * Money rule (matches the backend): /warehouse/catalog returns CENTS, every other endpoint used here returns KES.
 * Everything WE SEND is KES (the backend converts to cents).
 */
(function (window) {
  const esc = (s) => window.UI.escapeHtml(String(s ?? ''));
  const kes = (n) => window.UI.formatMoney(Number(n) || 0);
  const cents = (n) => window.UI.formatMoney((Number(n) || 0) / 100);
  const num = (n) => { const v = Math.round((Number(n) || 0) * 1000) / 1000; return v.toLocaleString('en-KE', { maximumFractionDigits: 3 }); };
  const can = (p) => window.Permissions.can(window.AppShell.getUser(), p);
  const on = (f) => !!(window.AppShell.hasFeature && window.AppShell.hasFeature(f));
  const icon = (n) => window.Icons.get(n);
  const dayKey = (d) => new Date(d).toISOString().slice(0, 10);

  /** Kept so old callers do not break: wholesale pages no longer carry a second navigation bar. */
  function subnav() { return ''; }

  /** True when this business uses warehouses (the wholesale feature set). */
  const isWs = () => on('multiWarehouse');

  /** Pill tabs used by the hybrid pages. items: [{key,label,icon?,count?,perm?}] */
  function hubTabs(items, active, id = 'hub-tabs') {
    return `<nav class="hub-tabs" id="${id}" role="tablist">${items.filter((t) => !t.perm || can(t.perm)).map((t) =>
      `<button type="button" role="tab" class="hub-tab ${t.key === active ? 'active' : ''}" data-tab="${t.key}">${t.icon ? `<span class="icon">${icon(t.icon)}</span>` : ''}<span>${esc(t.label)}</span>${t.count != null ? `<em>${esc(t.count)}</em>` : ''}</button>`).join('')}</nav>`;
  }

  /** Small stat tile used in hub headers. tone: '' | success | warning | danger | info */
  function stat(label, value, foot = '', tone = '') {
    return `<div class="hub-stat ${tone ? `tone-${tone}` : ''}"><span>${esc(label)}</span><b>${value}</b>${foot ? `<small>${foot}</small>` : ''}</div>`;
  }

  function header(title, sub, actionsHtml = '') {
    return `<div class="page-header"><div><h1>${esc(title)}</h1><p>${esc(sub)}</p></div><div class="mk-actions" style="margin:0">${actionsHtml}</div></div>`;
  }
  function featureOff(what = 'Warehouses') {
    return `<div class="card"><div class="card-body">${window.UI.emptyStateHtml({ icon: 'inventory', title: `${what} are not switched on`,
      message: 'Turn on "Warehouse & retail stock" for this business (Settings > Business type & features), or choose the Wholesale business type.' })}</div></div>`;
  }

  let whCache = null;
  async function warehouses(force) {
    if (whCache && !force) return whCache;
    const { data } = await window.Api.get('/warehouse');
    whCache = data.items || [];
    return whCache;
  }
  const bust = () => { whCache = null; try { localStorage.removeItem('pos.wsBoot.v1'); } catch { /* ignore */ } };
  async function settings() {
    try { const { data } = await window.Api.get('/warehouse/settings'); return data.settings || {}; } catch { return {}; }
  }
  const whOptions = (list, sel, { blank } = {}) =>
    (blank ? `<option value="">${esc(blank)}</option>` : '') + list.map((w) => `<option value="${w._id}" ${String(w._id) === String(sel) ? 'selected' : ''}>${esc(w.name)}${w.isDefault ? ' (default)' : ''}</option>`).join('');
  const branchOf = (w) => (w && (w.branchId?._id || w.branchId)) || null;
  const unitLabel = (u) => (u.isBase ? u.name : `${u.name} (${u.factor})`);

  function tableShell(headers, colCount, rows = 5) {
    return `<div class="table-wrap"><table class="table"><thead><tr>${headers.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${window.UI.skeletonRows(colCount, rows)}</tbody></table></div>`;
  }
  const errRow = (cols, err) => `<tr><td colspan="${cols}">${window.UI.emptyStateHtml({ icon: 'alert', title: 'Could not load', message: err.message })}</td></tr>`;
  const emptyRow = (cols, title) => `<tr><td colspan="${cols}">${window.UI.emptyStateHtml({ icon: 'box', title })}</td></tr>`;
  function pager(el, data, cb) { if (el) window.UI.renderPagination(el, data, cb); }

  function guard(fn) { return async (...a) => { try { return await fn(...a); } catch (e) { window.UI.toast.error(e.message || 'Something went wrong'); return null; } }; }
  function bindClose(modal) { modal.querySelectorAll('[data-action="close"]').forEach((b) => b.addEventListener('click', window.UI.closeModal)); }

  /* ------------------------------------------------------------------ *
   * Move stock - 3 simple steps:  1 Where?  ->  2 What?  ->  3 Check & confirm.
   * Step 3 calls POST /warehouse/transfers/preview (dry run): it shows the exact base units that will move
   * (2 bundles -> 48 packets), whether stock is enough, the retail price and the profit you can expect,
   * and every problem at once. Nothing is written until "Confirm move".
   * ------------------------------------------------------------------ */
  const MOVE_KINDS = [
    { id: 'TO_RETAIL', ico: 'store', title: 'Warehouse → Shop floor', sub: 'Put bulk stock on sale at retail prices' },
    { id: 'TO_WAREHOUSE', ico: 'inventory', title: 'Shop floor → Warehouse', sub: 'Return unsold stock to the warehouse' },
    { id: 'WH_TO_WH', ico: 'truck', title: 'Warehouse → Warehouse', sub: 'Transfer between two warehouses' },
  ];
  async function openTransferModal({ warehouseId, mode = 'TO_RETAIL', onDone, preselect } = {}) {
    const whs = (await warehouses()).filter((w) => w.status !== 'inactive');
    if (!whs.length) return window.UI.toast.error('Create a warehouse first');
    const lines = [];
    const st = { step: 1, mode, from: warehouseId || (whs.find((w) => w.isDefault) || whs[0])._id, to: '', notes: '', preview: null, busy: false };
    st.to = (whs.find((w) => String(w._id) !== String(st.from)) || {})._id || '';
    const stepNames = ['Where', 'What', 'Confirm'];

    const modal = window.UI.openModal({ title: 'Move stock', maxWidth: '860px', bodyHtml: '<div id="tf-root"></div>', footerHtml: '<div id="tf-foot" style="display:flex;gap:var(--space-2);width:100%;justify-content:flex-end;flex-wrap:wrap"></div>' });
    const root = modal.querySelector('#tf-root');
    const foot = modal.querySelector('#tf-foot');
    const whName = (id) => (whs.find((w) => String(w._id) === String(id)) || {}).name || '';
    const fromWh = () => whs.find((w) => String(w._id) === String(st.from));
    const unitsOf = (product) => [{ _id: null, name: product.unit || 'piece', factor: 1, isBase: true },
      ...((product.units || []).filter((u) => u.status !== 'inactive').map((u) => ({ _id: u._id, name: u.name, factor: u.factor, isBase: false })))];

    const stepper = () => `<ol class="mv-steps">${stepNames.map((n, i) => `<li class="${st.step === i + 1 ? 'on' : st.step > i + 1 ? 'done' : ''}"><b>${st.step > i + 1 ? '✓' : i + 1}</b><span>${n}</span></li>`).join('')}</ol>`;
    const setFoot = (html) => { foot.innerHTML = html; };
    const closeBtn = '<button class="btn btn-secondary" data-x="close">Cancel</button>';
    const wireFoot = () => foot.querySelectorAll('[data-x]').forEach((b) => b.addEventListener('click', () => {
      const a = b.dataset.x;
      if (a === 'close') window.UI.closeModal();
      else if (a === 'back') { st.step -= 1; render(); }
      else if (a === 'next') next();
      else if (a === 'confirm') confirmMove(b);
    }));

    function stepWhere() {
      root.innerHTML = `${stepper()}
        <h3 class="mv-q">Where is the stock moving?</h3>
        <div class="mv-cards">${MOVE_KINDS.map((k) => `<button type="button" class="mv-card ${st.mode === k.id ? 'on' : ''}" data-k="${k.id}"><span class="mv-ico">${icon(k.ico)}</span><strong>${k.title}</strong><small>${k.sub}</small></button>`).join('')}</div>
        <div class="form-row" style="margin-top:var(--space-4)">
          <div class="field"><label>${st.mode === 'TO_WAREHOUSE' ? 'Into warehouse' : 'From warehouse'}</label><select class="select" id="tf-from">${whOptions(whs, st.from)}</select></div>
          ${st.mode === 'WH_TO_WH' ? `<div class="field"><label>To warehouse</label><select class="select" id="tf-to">${whOptions(whs.filter((w) => String(w._id) !== String(st.from)), st.to)}</select></div>` : ''}
        </div>
        <p class="field-hint">${st.mode === 'TO_RETAIL' ? 'Stock moves at cost, so no profit is booked yet. You will set a new retail price in the last step.' : st.mode === 'TO_WAREHOUSE' ? 'The shop-floor quantity goes down and the warehouse goes up.' : 'Both warehouses keep their own stock; this just shifts units.'}</p>`;
      root.querySelectorAll('[data-k]').forEach((b) => b.addEventListener('click', () => { st.mode = b.dataset.k; if (st.mode === 'WH_TO_WH' && String(st.to) === String(st.from)) st.to = (whs.find((w) => String(w._id) !== String(st.from)) || {})._id || ''; st.preview = null; stepWhere(); }));
      root.querySelector('#tf-from').addEventListener('change', (e) => { st.from = e.target.value; if (String(st.to) === String(st.from)) st.to = (whs.find((w) => String(w._id) !== String(st.from)) || {})._id || ''; st.preview = null; if (st.mode === 'WH_TO_WH') stepWhere(); });
      root.querySelector('#tf-to')?.addEventListener('change', (e) => { st.to = e.target.value; st.preview = null; });
      setFoot(`${closeBtn}<button class="btn btn-primary" data-x="next">Next: choose products</button>`); wireFoot();
    }

    const conv = (l) => {
      const u = l.units.find((x) => String(x._id || '') === String(l.unitId || '')) || l.units[0];
      if (l.all) return 'Everything in stock';
      const q = Number(l.qty);
      if (!(q > 0)) return '';
      return u.isBase ? '' : `= ${num(q * u.factor)} ${l.baseUnit}`;
    };
    /** Adds a product line (unit defaults to the wholesale unit). false when it is already in the list. */
    function addLine(product, variant) {
      const key = `${product._id}:${variant?._id || ''}`;
      if (lines.some((l) => l.key === key)) return false;
      const units = unitsOf(product);
      const def = units.find((u) => !u.isBase && product.units?.find((x) => String(x._id) === String(u._id))?.isWholesaleDefault);
      lines.push({ key, productId: product._id, variantId: variant?._id, name: product.name + (variant ? ` (${Object.values(variant.attributes || {}).join(', ')})` : ''),
        sku: variant?.sku || product.sku, units, unitId: def ? def._id : null, baseUnit: product.unit || 'piece', qty: '', all: false, price: undefined });
      return true;
    }
    function stepWhat() {
      root.innerHTML = `${stepper()}
        <div class="ws-section-title"><h3 class="mv-q" style="margin:0">What are you moving?</h3><button type="button" class="btn btn-secondary btn-sm" id="tf-add">${icon('plus')} Add product</button></div>
        <div id="tf-lines"></div>
        <p class="field-hint">Pick the unit you are counting in (for example <b>2 bundles</b>); we convert it to the base unit for you.</p>
        <div class="field"><label>Note <span class="text-muted">(optional)</span></label><input class="input" id="tf-notes" maxlength="500" value="${esc(st.notes)}" /></div>`;
      const box = root.querySelector('#tf-lines');
      const draw = () => {
        if (!lines.length) { box.innerHTML = `<div class="mv-empty">${icon('box')}<div>No products yet. Tap <b>Add product</b>.</div></div>`; return; }
        box.innerHTML = lines.map((l, i) => `
          <div class="mv-line" data-i="${i}">
            <div class="mv-name"><strong>${esc(l.name)}</strong><small>${esc(l.sku || '')}</small></div>
            <input class="input" type="number" min="0" step="any" data-f="qty" value="${l.all ? '' : esc(l.qty)}" placeholder="How many" ${l.all ? 'disabled' : ''} />
            <select class="select" data-f="unit" ${l.all ? 'disabled' : ''}>${l.units.map((u) => `<option value="${u._id || ''}" ${String(u._id || '') === String(l.unitId || '') ? 'selected' : ''}>${esc(unitLabel(u))}</option>`).join('')}</select>
            <label class="mv-all"><input type="checkbox" data-f="all" ${l.all ? 'checked' : ''} /> All</label>
            <button type="button" class="btn btn-ghost btn-sm btn-icon" data-f="rm" title="Remove">${icon('trash')}</button>
            <div class="mv-conv" data-conv>${esc(conv(l))}</div>
          </div>`).join('');
        box.querySelectorAll('.mv-line').forEach((row) => {
          const l = lines[Number(row.dataset.i)];
          const cv = row.querySelector('[data-conv]');
          row.querySelector('[data-f="qty"]').addEventListener('input', (e) => { l.qty = e.target.value; cv.textContent = conv(l); });
          row.querySelector('[data-f="unit"]').addEventListener('change', (e) => { l.unitId = e.target.value || null; cv.textContent = conv(l); });
          row.querySelector('[data-f="all"]').addEventListener('change', (e) => { l.all = e.target.checked; draw(); });
          row.querySelector('[data-f="rm"]').addEventListener('click', () => { lines.splice(Number(row.dataset.i), 1); draw(); });
        });
      };
      draw();
      root.querySelector('#tf-notes').addEventListener('input', (e) => { st.notes = e.target.value; });
      root.querySelector('#tf-add').addEventListener('click', () => {
        window.ProductPicker.open({ onSelect: ({ product, variant }) => {
          if (!addLine(product, variant)) return window.UI.toast.info?.('Already in the list');
          st.preview = null; draw();
        } });
      });
      setFoot(`<button class="btn btn-secondary" data-x="back">Back</button><button class="btn btn-primary" data-x="next">Next: check &amp; confirm</button>`); wireFoot();
    }

    const bodyFor = () => {
      const toRetail = st.mode === 'TO_RETAIL';
      const body = {
        fromLocation: st.mode === 'TO_WAREHOUSE' ? 'RETAIL' : 'WAREHOUSE', toLocation: st.mode === 'TO_RETAIL' ? 'RETAIL' : 'WAREHOUSE',
        items: lines.map((l) => ({ productId: l.productId, variantId: l.variantId || undefined,
          ...(l.all ? { moveAll: true } : { quantity: Number(l.qty), unitId: l.unitId || undefined }),
          retailPrice: toRetail && l.price !== undefined && l.price !== '' && l.price !== null ? Number(l.price) : undefined })),
        notes: st.notes.trim() || undefined,
      };
      if (st.mode === 'TO_WAREHOUSE') body.toWarehouseId = st.from; else { body.fromWarehouseId = st.from; if (st.mode === 'WH_TO_WH') body.toWarehouseId = st.to; }
      const w = fromWh(); if (w) body.branchId = branchOf(w);
      return body;
    };

    async function runPreview(keepPrices) {
      root.querySelector('#tf-sum') && (root.querySelector('#tf-sum').style.opacity = '.5');
      try {
        const { data } = await window.Api.post('/warehouse/transfers/preview', bodyFor());
        st.preview = data;
        // first time: adopt the price the server would use, so the owner can just edit it
        data.lines.forEach((pl, i) => { if (lines[i] && !keepPrices && pl.retailPriceCents != null && lines[i].price === undefined) lines[i].price = pl.retailPriceCents / 100; });
      } catch (e) { st.preview = { error: e.message }; }
      drawPreview();
    }

    function stepConfirm() {
      root.innerHTML = `${stepper()}<h3 class="mv-q">Check and confirm</h3><div id="tf-sum"><div class="mv-empty"><span class="spinner"></span><div>Checking stock and prices…</div></div></div>`;
      setFoot(`<button class="btn btn-secondary" data-x="back">Back</button><button class="btn btn-primary" data-x="confirm" disabled>Confirm move</button>`); wireFoot();
      runPreview(false);
    }
    function drawPreview() {
      const box = root.querySelector('#tf-sum'); if (!box) return;
      const pv = st.preview || {};
      const confirmBtn = foot.querySelector('[data-x="confirm"]');
      if (pv.error) { box.innerHTML = `<div class="ws-warn">${esc(pv.error)}</div>`; if (confirmBtn) confirmBtn.disabled = true; return; }
      const toRetail = pv.kind === 'TO_RETAIL';
      const t = pv.totals || {};
      box.style.opacity = '1';
      box.innerHTML = `
        <div class="${pv.ok ? 'mv-ok' : 'ws-warn'}">${pv.ok ? 'Everything checks out. Nothing is saved until you press <b>Confirm move</b>.' : 'Fix the lines marked in red, then the move can go ahead.'}</div>
        <div class="mv-rows">${(pv.lines || []).map((l, i) => `
          <div class="mv-row ${l.ok ? '' : 'bad'}" data-i="${i}">
            <div class="mv-name"><strong>${esc(l.name || 'Product')}</strong>
              <small>${l.unitFactor > 1 ? `${num(l.enteredQuantity)} ${esc(l.unitName)} = <b>${num(l.baseQuantity)} ${esc(l.baseUnit)}</b>` : `<b>${num(l.baseQuantity)} ${esc(l.baseUnit || '')}</b>`} · available ${num(l.availableBase)} ${esc(l.baseUnit || '')}${l.unitFactor > 1 ? ` (${num(l.availableInUnit)} ${esc(l.unitName)})` : ''}</small></div>
            ${toRetail ? `<div class="mv-price"><label>New retail price / ${esc(l.baseUnit || 'unit')}</label><input class="input" type="number" min="0" step="any" data-price value="${lines[i]?.price ?? ''}" />
              <small>${l.wholesaleValuePerBaseCents != null ? `Wholesale ${cents(l.wholesaleValuePerBaseCents)}` : `Cost ${cents(l.unitCostCents)}`}${l.suggestedRetailPriceCents ? ` · suggested ${cents(l.suggestedRetailPriceCents)}` : ''}</small></div>
              <div class="mv-profit"><b>${cents(l.expectedProfitCents)}</b><small>expected profit${l.marginPercent ? ` · ${l.marginPercent}%` : ''}</small></div>` : `<div class="mv-profit"><b>${cents(l.costValueCents)}</b><small>value at cost</small></div>`}
            ${(l.errors || []).map((e) => `<div class="mv-err">${esc(e.message)}</div>`).join('')}
          </div>`).join('')}</div>
        <div class="mv-totals"><div><small>Value at cost</small><b>${cents(t.costValueCents)}</b></div>
          ${toRetail ? `<div><small>Retail value</small><b>${cents(t.retailValueCents)}</b></div><div><small>Expected profit</small><b>${cents(t.expectedProfitCents)}</b></div>${t.upliftOverWholesaleCents ? `<div><small>Extra vs wholesale</small><b>${cents(t.upliftOverWholesaleCents)}</b></div>` : ''}` : ''}</div>`;
      box.querySelectorAll('[data-price]').forEach((inp) => {
        let tm; inp.addEventListener('input', () => { const i = Number(inp.closest('.mv-row').dataset.i); lines[i].price = inp.value; clearTimeout(tm); tm = setTimeout(() => runPreview(true), 500); });
      });
      if (confirmBtn) confirmBtn.disabled = !pv.ok;
    }

    async function confirmMove(btn) {
      window.UI.setButtonLoading(btn, true);
      try {
        const { data } = await window.Api.post('/warehouse/transfers', bodyFor());
        window.UI.closeModal();
        window.UI.toast.success(`Stock moved (${data.transfer?.transferNumber || 'done'})`);
        bust();
        if (onDone) onDone(data.transfer);
      } catch (err) { window.UI.setButtonLoading(btn, false); window.UI.toast.error(err.message); }
    }

    function next() {
      if (st.step === 1) {
        if (st.mode === 'WH_TO_WH' && (!st.to || String(st.to) === String(st.from))) return window.UI.toast.error('Choose two different warehouses');
      } else if (st.step === 2) {
        if (!lines.length) return window.UI.toast.error('Add at least one product');
        if (lines.some((l) => !l.all && !(Number(l.qty) > 0))) return window.UI.toast.error('Enter how many to move for every product');
      }
      st.step += 1; render();
    }
    function render() { (st.step === 1 ? stepWhere : st.step === 2 ? stepWhat : stepConfirm)(); }
    // Opened from the till for ONE product ("not on the shop floor yet"): start at "What", product already listed.
    if (preselect && preselect.product) { addLine(preselect.product, preselect.variant || null); st.step = 2; }
    render();
  }


  /* ------------------------------------------------------------------ *
   * Warehouse create / edit  and  stock adjustment (shared by the inventory hub and anywhere else)
   * ------------------------------------------------------------------ */
  async function openWarehouseModal(w, { onDone } = {}) {
    const edit = !!w;
    let branches = [];
    if (!edit) { try { branches = (await window.Api.get('/branches', { limit: 100 })).data.items || []; } catch { branches = []; } }
    const modal = window.UI.openModal({
      title: edit ? `Edit ${w.name}` : 'New warehouse', maxWidth: '560px',
      bodyHtml: `<form id="wm-form">
        <div class="field"><label>Name</label><input class="input" name="name" required maxlength="80" value="${esc(w?.name || '')}" /></div>
        ${edit ? '' : `<div class="form-row"><div class="field"><label>Branch</label><select class="select" name="branchId">${branches.map((b) => `<option value="${b._id}" ${b._id === window.AppShell.getActiveBranchId() ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}</select></div>
          <div class="field"><label>Code <span class="text-muted">(optional)</span></label><input class="input" name="code" maxlength="20" /></div></div>`}
        <div class="form-row"><div class="field"><label>Phone</label><input class="input" name="phone" maxlength="30" value="${esc(w?.phone || '')}" /></div>
          <div class="field"><label>Address</label><input class="input" name="address" maxlength="200" value="${esc(w?.address || '')}" /></div></div>
        <div class="field"><label>Notes</label><textarea class="textarea" name="notes" maxlength="500" rows="2">${esc(w?.notes || '')}</textarea></div>
        <div class="field"><label><input type="checkbox" name="allowSales" ${w?.allowSales === false ? '' : 'checked'} /> Can sell from this warehouse (untick for storage only)</label></div>
        ${edit && !w.isDefault && w.status !== 'inactive' ? '<div class="field"><label><input type="checkbox" name="isDefault" /> Make this the default warehouse of its branch</label></div>' : ''}
        ${edit ? `<div class="field"><label><input type="checkbox" name="inactive" ${w.status === 'inactive' ? 'checked' : ''} /> Inactive <span class="text-muted">(must be empty to deactivate)</span></label></div>` : ''}
      </form>`,
      footerHtml: '<button class="btn btn-secondary" data-action="close">Cancel</button><button class="btn btn-primary" id="wm-save">Save</button>',
    });
    bindClose(modal);
    modal.querySelector('#wm-save').addEventListener('click', async (ev) => {
      const f = modal.querySelector('#wm-form'); const g = (n) => f.elements[n];
      if (!g('name').value.trim()) return window.UI.toast.error('Name is required');
      const data = { name: g('name').value.trim(), phone: g('phone').value.trim() || undefined, address: g('address').value.trim() || undefined, notes: g('notes').value.trim() || undefined, allowSales: g('allowSales').checked };
      if (!edit) { data.branchId = g('branchId').value; if (g('code').value.trim()) data.code = g('code').value.trim(); }
      else { if (g('isDefault')?.checked) data.isDefault = true; data.status = g('inactive').checked ? 'inactive' : 'active'; }
      window.UI.setButtonLoading(ev.currentTarget, true);
      try {
        edit ? await window.Api.patch(`/warehouse/${w._id}`, data) : await window.Api.post('/warehouse', data);
        bust(); window.UI.closeModal(); window.UI.toast.success('Warehouse saved'); if (onDone) onDone();
      } catch (err) { window.UI.setButtonLoading(ev.currentTarget, false); window.UI.toast.error(err.message); }
    });
  }

  function openAdjustModal(w, { onDone } = {}) {
    if (!w) return window.UI.toast.error('Choose a warehouse');
    let picked = null;
    const modal = window.UI.openModal({
      title: `Adjust stock · ${w.name}`, maxWidth: '520px',
      bodyHtml: `<div class="field"><label>Product</label><button type="button" class="btn btn-secondary btn-block" id="ad-pick">Choose product…</button></div>
        <div class="form-row"><div class="field"><label>Type</label><select class="select" id="ad-type">
          <option value="OPENING_STOCK">Opening stock (add)</option><option value="ADJUSTMENT_IN">Correction: add</option><option value="ADJUSTMENT_OUT">Correction: remove</option>
          <option value="DAMAGE">Damaged (remove)</option><option value="EXPIRED">Expired (remove)</option><option value="LOST">Lost (remove)</option></select></div>
          <div class="field"><label>Quantity</label><input class="input" id="ad-qty" type="number" min="0" step="any" /></div></div>
        <div class="field"><label>Unit</label><select class="select" id="ad-unit"><option value="">—</option></select></div>
        <div class="field"><label>Reason</label><input class="input" id="ad-reason" maxlength="300" placeholder="e.g. Opening count, broken carton" /></div>`,
      footerHtml: '<button class="btn btn-secondary" data-action="close">Cancel</button><button class="btn btn-primary" id="ad-save">Save adjustment</button>',
    });
    bindClose(modal);
    modal.querySelector('#ad-pick').addEventListener('click', () => window.ProductPicker.open({ onSelect: ({ product, variant }) => {
      picked = { product, variant };
      modal.querySelector('#ad-pick').textContent = product.name + (variant ? ` (${Object.values(variant.attributes || {}).join(', ')})` : '');
      modal.querySelector('#ad-unit').innerHTML = `<option value="">${esc(product.unit || 'piece')} (base)</option>` + (product.units || []).filter((u) => u.status !== 'inactive').map((u) => `<option value="${u._id}">${esc(u.name)} (${u.factor} ${esc(product.unit || '')})</option>`).join('');
    } }));
    modal.querySelector('#ad-save').addEventListener('click', async (ev) => {
      const q = Number(modal.querySelector('#ad-qty').value); const type = modal.querySelector('#ad-type').value; const reason = modal.querySelector('#ad-reason').value.trim();
      if (!picked) return window.UI.toast.error('Choose a product');
      if (!(q > 0)) return window.UI.toast.error('Enter a quantity above zero');
      if (!reason) return window.UI.toast.error('Give a reason');
      const sign = ['OPENING_STOCK', 'ADJUSTMENT_IN'].includes(type) ? 1 : -1;
      window.UI.setButtonLoading(ev.currentTarget, true);
      try {
        await window.Api.post(`/warehouse/${w._id}/adjust`, { productId: picked.product._id, variantId: picked.variant?._id, quantity: sign * q, unitId: modal.querySelector('#ad-unit').value || undefined, type, reason });
        window.UI.closeModal(); window.UI.toast.success('Stock adjusted'); bust(); if (onDone) onDone();
      } catch (err) { window.UI.setButtonLoading(ev.currentTarget, false); window.UI.toast.error(err.message); }
    });
  }

  window.WS = { esc, kes, cents, num, can, on, icon, dayKey, subnav, header, featureOff, warehouses, bust, settings, whOptions, branchOf, unitLabel,
    tableShell, errRow, emptyRow, pager, guard, bindClose, openTransferModal,
    isWs, hubTabs, stat, openWarehouseModal, openAdjustModal };
})(window);
