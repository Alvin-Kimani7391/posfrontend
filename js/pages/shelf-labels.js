/**
 * shelf-labels.js - print the full shelf price list (name, price, barcode) and cut-apart shelf labels.
 * Reads GET /products (all active products + variants). Barcode = product barcode, or the SKU when
 * a product has none (flagged in the table so the owner can add real barcodes).
 *
 * PAPER: "Sheet" prints the cut-apart grid (A4 / normal printer). "Receipt roll" (80 mm or 58 mm) prints ONE landscape
 * label per row down a continuous strip for a thermal receipt printer: name + price on the left, barcode on the
 * right, a dashed cut line between labels. The page is sized to the roll width (@page size Nmm auto, no margins).
 *
 * SHOP NAME: the "Show shop name" tick adds / removes the shop name on every label (sheet and receipt roll) and in the live
 * preview. Every block of a label has an explicit height worked out from the real text width, so nothing can overlap.
 *
 * DISCOUNTS: a product's standing per-unit discount (defaultDiscount, set on the Products page) is
 * shown here as Was / Now / Save. The owner can print ALL products (discounted ones are marked
 * with the struck-through old price) or ONLY the discounted products.
 */
(function () {
  document.addEventListener('DOMContentLoaded', init);

  const SIZES = {
    small:  { label: 'Small (50 × 30 mm)',  w: 50, h: 30 },
    medium: { label: 'Medium (63 × 38 mm)', w: 63, h: 38 },
    large:  { label: 'Large (90 × 50 mm)',  w: 90, h: 50 },
  };
  // Receipt rolls: paper width, printable width, label height (mm).
  const ROLLS = {
    roll80: { label: 'Receipt roll 80 mm (long strip)', paper: 80, w: 72, h: 28 },
    roll58: { label: 'Receipt roll 58 mm (long strip)', paper: 58, w: 48, h: 24 },
  };
  const esc = (v) => window.UI.escapeHtml(v == null ? '' : v);

  let contentEl;
  const state = { rows: [], selected: new Set(), search: '', categoryId: '', size: 'medium', media: 'sheet', copies: 1, showSku: true, showShop: prefShop(), mode: 'all', categories: [], businessName: '' };
  function prefShop() { try { return window.Storage.getPref('shelfShowShop', true) !== false; } catch { return true; } }

  const CACHE_KEY = 'sl_rows_v2';
  const CACHE_MS = 10 * 60 * 1000;
  const SHOW_STEP = 150;           // rows drawn on screen at a time (printing still uses every selected product)
  let shown = SHOW_STEP;
  let loading = true;
  let touched = false;             // the user changed the selection by hand: never overwrite it with fresh data

  async function init() {
    contentEl = window.AppShell.mount({ title: 'Shelf labels' });
    if (!contentEl) return;
    // The page is drawn at ONCE; products stream in behind it.
    render();
    window.AppShell.whenProfileReady().then((prof) => { state.businessName = prof?.name || window.AppShell.getUser()?.businessName || ''; renderPreview(); }).catch(() => {});
    loadCategories().then((cats) => {
      state.categories = cats;
      const sel = document.getElementById('sl-cat');
      if (sel) sel.innerHTML = '<option value="">All categories</option>' + cats.map((c) => `<option value="${c._id}">${esc(c.name)}</option>`).join('');
    });

    // 1) saved copy from a moment ago: show it instantly
    const cached = readCache();
    if (cached) { setRows(cached, true); }
    // 2) fresh copy: first page at once, the other pages in parallel
    try {
      const fresh = await loadAllProducts((partial) => { if (!cached) setRows(partial, false); });
      setRows(fresh, false);
      writeCache(fresh);
    } catch (err) {
      if (!state.rows.length) { loading = false; contentEl.innerHTML = `<div class="card"><div class="card-body">${esc(err.message || 'Could not load products')}</div></div>`; return; }
    }
    loading = false;
    renderBody();
  }

  function setRows(rows, fromCache) {
    state.rows = rows;
    if (!touched) state.selected = new Set(rows.map((r) => r.id));
    else { const ids = new Set(rows.map((r) => r.id)); state.selected.forEach((id) => { if (!ids.has(id)) state.selected.delete(id); }); }
    if (fromCache) loading = false; // a saved copy is complete enough to print from while the fresh one loads
    renderBody();
  }

  function readCache() {
    try {
      const o = JSON.parse(sessionStorage.getItem(CACHE_KEY) || 'null');
      if (o && Date.now() - o.t < CACHE_MS && Array.isArray(o.rows) && o.rows.length) return o.rows;
    } catch { /* no saved copy */ }
    return null;
  }
  function writeCache(rows) { try { sessionStorage.setItem(CACHE_KEY, JSON.stringify({ t: Date.now(), rows })); } catch { /* too big / blocked: fine */ } }

  async function loadCategories() {
    try { const { data } = await window.Api.get('/categories'); return data.categories || []; }
    catch { return []; }
  }

  function flatten(items) {
    const out = [];
    items.forEach((p) => {
      const variants = p.variants || [];
      if (p.hasVariants && variants.length) {
        variants.forEach((v) => {
          const attrs = v.attributes && typeof v.attributes === 'object' ? Object.values(v.attributes).join(' / ') : '';
          out.push(row(p, v.sellingPrice, v.barcode, v.sku, attrs ? `${p.name} (${attrs})` : p.name, v._id, v.defaultDiscount));
        });
      } else out.push(row(p, p.sellingPrice, p.barcode, p.sku, p.name, p._id));
    });
    return out;
  }

  /** Page 1 first (so something shows immediately), then every remaining page at the same time (6 at once). */
  async function loadAllProducts(onPartial) {
    const LIMIT = 100;
    const first = (await window.Api.get('/products', { page: 1, limit: LIMIT, status: 'active' })).data;
    const pages = first.pages || 1;
    const chunks = new Array(pages);
    chunks[0] = flatten(first.items || []);
    const merged = () => [].concat(...chunks.filter(Boolean));
    if (onPartial) onPartial(merged());
    let next = 2;
    await Promise.all(Array.from({ length: Math.min(6, Math.max(0, pages - 1)) }, async () => {
      while (next <= pages) {
        const pg = next++;
        const { data } = await window.Api.get('/products', { page: pg, limit: LIMIT, status: 'active' });
        chunks[pg - 1] = flatten(data.items || []);
        if (onPartial && pg % 3 === 0) onPartial(merged());
      }
    }));
    return merged();
  }

  function row(p, price, barcode, sku, name, id, variantDiscount) {
    const hasBarcode = !!(barcode && String(barcode).trim());
    const was = Number(price) || 0;
    // Variant-level discount wins if the backend ever supplies one; otherwise the product's per-unit discount applies.
    const rawDisc = variantDiscount != null && variantDiscount !== '' ? Number(variantDiscount) : Number(p.defaultDiscount);
    const discount = Number.isFinite(rawDisc) && rawDisc > 0 && rawDisc <= was ? rawDisc : 0;
    return { id: `${p._id}:${id}`, name, price: was, discount, now: Math.max(0, was - discount), hasDiscount: discount > 0, sku: sku || '', barcode: hasBarcode ? String(barcode).trim() : (sku || ''), fromSku: !hasBarcode, categoryId: String(p.categoryId?._id || p.categoryId || '') };
  }

  const visible = () => state.rows.filter((r) =>
    (!state.search || r.name.toLowerCase().includes(state.search) || r.sku.toLowerCase().includes(state.search) || r.barcode.toLowerCase().includes(state.search)) &&
    (!state.categoryId || r.categoryId === state.categoryId) &&
    (state.mode !== 'discount' || r.hasDiscount));

  /* Price cell used on screen and in the A4 list: was (struck) / now / save when discounted. */
  const priceCellHtml = (r) => r.hasDiscount
    ? `<span class="sl-was">${window.UI.formatMoney(r.price)}</span> <strong>${window.UI.formatMoney(r.now)}</strong> <span class="badge badge-success">Save ${window.UI.formatMoney(r.discount)}</span>`
    : window.UI.formatMoney(r.price);

  function render() {
    contentEl.innerHTML = `
      <div class="card" style="margin-bottom:var(--space-4)"><div class="card-body">
        <div class="sl-controls">
          <input class="input" id="sl-search" placeholder="Search name, SKU or barcode" />
          <select class="select" id="sl-cat"><option value="">All categories</option>${state.categories.map((c) => `<option value="${c._id}">${esc(c.name)}</option>`).join('')}</select>
          <select class="select" id="sl-media" title="Paper to print on">
            <option value="sheet" ${state.media === 'sheet' ? 'selected' : ''}>Sheet / A4 (grid of labels)</option>
            ${Object.entries(ROLLS).map(([k, v]) => `<option value="${k}" ${k === state.media ? 'selected' : ''}>${v.label}</option>`).join('')}
          </select>
          <select class="select" id="sl-size" ${state.media === 'sheet' ? '' : 'disabled'}>${Object.entries(SIZES).map(([k, v]) => `<option value="${k}" ${k === state.size ? 'selected' : ''}>${v.label}</option>`).join('')}</select>
          <label class="sl-inline">Print
            <select class="select" id="sl-mode" style="min-width:0">
              <option value="all" ${state.mode === 'all' ? 'selected' : ''}>All products (discounts marked)</option>
              <option value="discount" ${state.mode === 'discount' ? 'selected' : ''}>Discounted products only</option>
            </select></label>
          <label class="sl-inline">Copies <input class="input" id="sl-copies" type="number" min="1" max="20" value="${state.copies}" style="width:70px" /></label>
          <label class="sl-inline"><input type="checkbox" id="sl-sku" ${state.showSku ? 'checked' : ''} /> Show SKU</label>
          <label class="sl-inline"><input type="checkbox" id="sl-shop" ${state.showShop ? 'checked' : ''} /> Show shop name</label>
        </div>
        <div class="sl-pv" style="margin-top:var(--space-3)"><div class="sl-pv-box" id="sl-pv"></div><div class="sl-pv-note" id="sl-pv-note"></div></div>
        <div class="sl-actions">
          <span class="text-sm text-secondary" id="sl-count"></span>
          <span style="flex:1"></span>
          <button class="btn btn-secondary" id="sl-print-list">${window.Icons.get('printer')} Print price list (A4)</button>
          <button class="btn btn-primary" id="sl-print-labels">${window.Icons.get('printer')} Print shelf labels</button>
        </div>
        <div class="text-xs text-muted" style="margin-top:var(--space-2)">Labels print as a grid with dashed cut lines: print, cut along the lines, and stick one on each shelf edge. For a receipt printer choose <b>Receipt roll</b>: one wide label per row on a long strip (in the print window pick your receipt printer, margins None, scale 100%). Discounted products show the old price crossed out, the new price and the amount saved. Products with no barcode use their SKU (marked <span class="badge badge-warning">SKU</span>).</div>
      </div></div>
      <div class="card"><div class="table-wrap"><table class="table">
        <thead><tr><th style="width:36px"><input type="checkbox" id="sl-all" /></th><th>Product</th><th>Barcode</th><th style="text-align:right">Price</th></tr></thead>
        <tbody id="sl-body"></tbody></table></div><div id="sl-more" style="padding:var(--space-3);text-align:center"></div></div>`;
    bind(); renderBody();
  }

  function renderBody() {
    const body = document.getElementById('sl-body');
    if (!body) return;
    const rows = visible();
    const draw = rows.slice(0, shown);
    if (!rows.length) {
      body.innerHTML = loading
        ? `<tr><td colspan="4" class="text-muted" style="padding:var(--space-4)">Loading products…</td></tr>`
        : (state.rows.length
          ? `<tr><td colspan="4" class="text-muted" style="padding:var(--space-4)">${state.mode === 'discount' ? 'No discounted products found. Set a "Discount per unit" on a product to see it here.' : 'No matching products.'}</td></tr>`
          : `<tr><td colspan="4" style="padding:var(--space-4)"><b>No products yet</b><br><span class="text-secondary">Add your products first, then come back to print the shelf list and labels.</span><br><a class="btn btn-primary btn-sm" style="margin-top:8px" href="products.html?action=add&from=onboarding&step=products">Add a product</a></td></tr>`);
    } else {
      body.innerHTML = draw.map((r) => `
      <tr><td><input type="checkbox" data-id="${esc(r.id)}" ${state.selected.has(r.id) ? 'checked' : ''} /></td>
      <td>${esc(r.name)}</td><td>${esc(r.barcode)} ${r.fromSku ? '<span class="badge badge-warning">SKU</span>' : ''}</td>
      <td style="text-align:right">${priceCellHtml(r)}</td></tr>`).join('');
    }
    const more = document.getElementById('sl-more');
    if (more) {
      const left = rows.length - draw.length;
      more.innerHTML = left > 0 ? `<button class="btn btn-secondary btn-sm" id="sl-show-more">Show ${Math.min(SHOW_STEP, left)} more <span class="text-muted">(${left} hidden - all selected products still print)</span></button>` : (loading && state.rows.length ? '<span class="text-muted text-sm">Loading more products…</span>' : '');
    }
    const all = document.getElementById('sl-all');
    if (all) all.checked = rows.length > 0 && rows.every((r) => state.selected.has(r.id));
    updateCount();
    renderPreview();
  }

  // O(n): the old version re-filtered the whole list once per product.
  function chosen() {
    const vis = new Set(visible());
    return state.rows.filter((r) => state.selected.has(r.id) && vis.has(r));
  }
  function updateCount() { const n = chosen().length; const el = document.getElementById('sl-count');
    if (!el) return;
    const total = state.mode === 'discount' ? state.rows.filter((r) => r.hasDiscount).length : state.rows.length;
    el.textContent = loading && !total ? 'Loading products…' : `${n} of ${total} ${state.mode === 'discount' ? 'discounted ' : ''}products selected${loading ? ' (still loading…)' : ''}`; }

  function bind() {
    document.getElementById('sl-search').addEventListener('input', window.UI.debounce((e) => { state.search = e.target.value.trim().toLowerCase(); shown = SHOW_STEP; renderBody(); }, 120));
    document.getElementById('sl-cat').addEventListener('change', (e) => { state.categoryId = e.target.value; shown = SHOW_STEP; renderBody(); });
    document.getElementById('sl-mode').addEventListener('change', (e) => { state.mode = e.target.value; shown = SHOW_STEP; renderBody(); });
    document.getElementById('sl-size').addEventListener('change', (e) => { state.size = e.target.value; renderPreview(); });
    document.getElementById('sl-media').addEventListener('change', (e) => {
      state.media = e.target.value;
      document.getElementById('sl-size').disabled = state.media !== 'sheet'; // roll labels have a fixed size
      renderPreview();
    });
    document.getElementById('sl-copies').addEventListener('change', (e) => { state.copies = Math.min(20, Math.max(1, parseInt(e.target.value, 10) || 1)); e.target.value = state.copies; });
    document.getElementById('sl-sku').addEventListener('change', (e) => { state.showSku = e.target.checked; renderPreview(); });
    document.getElementById('sl-shop').addEventListener('change', (e) => {
      state.showShop = e.target.checked;
      try { window.Storage.setPref('shelfShowShop', state.showShop); } catch { /* optional */ }
      if (state.showShop && !shopName()) window.UI.toast.info('No shop name is set yet. Add it in Settings → Business profile.');
      renderPreview();
    });
    document.getElementById('sl-all').addEventListener('change', (e) => { touched = true; setTimeout(renderPreview, 0); visible().forEach((r) => (e.target.checked ? state.selected.add(r.id) : state.selected.delete(r.id))); renderBody(); });
    const body = document.getElementById('sl-body');
    body.addEventListener('change', (e) => {
      const cb = e.target.closest('input[data-id]'); if (!cb) return;
      touched = true;
      cb.checked ? state.selected.add(cb.dataset.id) : state.selected.delete(cb.dataset.id);
      updateCount(); renderPreview();
    });
    document.getElementById('sl-more').addEventListener('click', (e) => { if (e.target.closest('#sl-show-more')) { shown += SHOW_STEP; renderBody(); } });
    document.getElementById('sl-print-list').addEventListener('click', () => print('list'));
    document.getElementById('sl-print-labels').addEventListener('click', () => print('labels'));
  }


  /* ---------------- label layout engine (no overlap) ---------------- */
  const LH = 1.15;
  const cl = (v, a, b) => Math.max(a, Math.min(b, v));
  let ctx2d = null; const emMem = new Map();
  function em(word) {
    let v = emMem.get(word);
    if (v === undefined) {
      try { if (!ctx2d) { ctx2d = document.createElement('canvas').getContext('2d'); ctx2d.font = 'bold 100px Arial, Helvetica, sans-serif'; } v = ctx2d.measureText(word).width / 100; }
      catch { v = word.length * 0.58; }
      v *= 1.05; emMem.set(word, v);
    }
    return v;
  }
  function wrapLines(text, f, boxW) {
    const maxEm = boxW / f; const sp = em(' '); let lines = 1; let cur = 0;
    for (const w of String(text).split(/\s+/).filter(Boolean)) {
      const ww = em(w);
      if (ww > maxEm) { const parts = Math.ceil(ww / maxEm); if (cur > 0) lines++; lines += parts - 1; cur = ww - (parts - 1) * maxEm; continue; }
      if (cur === 0) cur = ww; else if (cur + sp + ww <= maxEm) cur += sp + ww; else { lines++; cur = ww; }
    }
    return lines;
  }
  const fitMem = new Map();
  function fitFont(text, boxW, boxH, fMax, fMin) {
    const key = `${text}|${boxW.toFixed(1)}|${boxH.toFixed(1)}|${fMax.toFixed(1)}|${fMin.toFixed(1)}`;
    let r = fitMem.get(key); if (r) return r;
    r = { f: fMin, ok: false };
    for (let f = fMax; f >= fMin - 1e-6; f -= 0.05) { if (wrapLines(text, f, boxW) * f * LH <= boxH + 1e-6) { r = { f, ok: true }; break; } }
    if (fitMem.size > 20000) fitMem.clear();
    fitMem.set(key, r); return r;
  }
  const shopName = () => (state.showShop ? String(state.businessName || '').trim() : '');
  const fmt = (n) => window.UI.formatMoney(n);
  const uniq = (rows) => Array.from(new Set(rows.map((r) => String(r.name || '')))).sort((a, b) => b.length - a.length).slice(0, 40);

  function pickNameBox(names, iw, nameMax, prefFn, minFn) {
    for (let n = 1; n <= 4; n++) {
      const box = Math.min(nameMax, n * prefFn * LH);
      if (names.every((t) => fitFont(t, iw, box, prefFn, minFn).f >= prefFn * 0.82)) return box;
      if (box >= nameMax - 1e-6) break;
    }
    return nameMax;
  }
  function sheetPlan(sz, rows, shop) {
    const px = 2.5; const py = 2; const bd = 0.6; const iw = sz.w - 2 * px - bd; const ih = sz.h - 2 * py - bd; const g = 0.5;
    const names = uniq(rows); const anyDisc = rows.some((r) => r.hasDiscount);
    const maxLen = rows.slice(0, 2000).reduce((m, r) => Math.max(m, fmt(r.hasDiscount ? r.now : r.price).length, r.hasDiscount ? fmt(r.price).length + 4 : 0), 6);
    const prefFn = cl(sz.h * 0.085, 2.3, 4.8); const minFn = 1.7;
    const scales = [1, 0.88, 0.78, 0.68, 0.6]; let out = null;
    for (let si = 0; si < scales.length; si++) {
      const sc = scales[si]; const last = si === scales.length - 1;
      let fs = shop ? cl(sz.h * 0.065 * sc, 1.5, 2.8) : 0; if (fs) fs = Math.min(fs, iw / (em(shop.toUpperCase()) * 1.06)); const shopH = fs ? fs * 1.25 : 0;
      const fc = cl(sz.h * 0.06 * sc, 1.5, 2.6); const codeH = fc * 1.25;
      const fp = Math.min(cl(sz.h * 0.16 * sc, 3, 10), iw / (maxLen * 0.64));
      const fw = Math.min(fp * 0.5, (iw * 0.55) / ((maxLen + 4) * 0.56)); const fv = fw * 0.85;
      const pH = anyDisc ? fw * 1.3 + 0.4 + fp * 0.85 * 1.15 + 0.4 : fp * 1.15;
      const fixed = [shopH, codeH, pH].filter(Boolean);
      const avail = ih - fixed.reduce((a, b) => a + b, 0) - (fixed.length + 1) * g;
      const bcMin = Math.min(Math.max(6, sz.h * 0.2), Math.max(1, avail * 0.55));
      let nameMax = avail - bcMin;
      if (nameMax < minFn * LH && !last) continue;
      nameMax = Math.max(minFn * LH, nameMax);
      const nameH = pickNameBox(names, iw, nameMax, prefFn, minFn);
      if (!last && !names.every((t) => fitFont(t, iw, nameH, prefFn, minFn).ok)) continue;
      out = { px, py, g, iw, prefFn, minFn, fs, shopH, fc, codeH, fp, fw, fv, pH, nameH, bcMax: iw * 0.5 };
      break;
    }
    return out;
  }
  function sheetLabels(cells, sz, rows) {
    const shop = shopName(); const p = sheetPlan(sz, rows, shop);
    const vars = `--lb-w:${sz.w}mm;--lb-h:${sz.h}mm;--lb-px:${p.px}mm;--lb-py:${p.py}mm;--lb-g:${p.g}mm;--lb-nameH:${p.nameH.toFixed(2)}mm;--lb-pH:${p.pH.toFixed(2)}mm;--lb-fp:${p.fp.toFixed(2)}mm;--lb-fw:${p.fw.toFixed(2)}mm;--lb-fv:${p.fv.toFixed(2)}mm;--lb-fc:${p.fc.toFixed(2)}mm;--lb-codeH:${p.codeH.toFixed(2)}mm;--lb-fs:${p.fs.toFixed(2)}mm;--lb-shopH:${p.shopH.toFixed(2)}mm;--lb-bcMax:${p.bcMax.toFixed(1)}mm`;
    const svgs = new Map();
    const bc = (code) => { if (!svgs.has(code)) svgs.set(code, window.Barcode.svg(code, { fluid: true, height: 40, module: 2, quiet: 8 })); return svgs.get(code); };
    const html = `<div class="lb-grid" style="${vars}">${cells.map((r) => {
      const fit = fitFont(String(r.name || ''), p.iw, p.nameH, p.prefFn, p.minFn); const f = fit.f;
      const cn = fit.ok ? 0 : Math.max(1, Math.floor((p.nameH + 0.01) / (f * LH)));
      return `<div class="lb${r.hasDiscount ? ' lb-disc' : ''}">
        <div class="lb-name"><span style="font-size:${f.toFixed(2)}mm${cn ? `;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:${cn};overflow:hidden` : ''}">${esc(r.name)}</span></div>
        <div class="lb-pblock">${r.hasDiscount
          ? `<div class="lb-offer"><div class="lb-was-row"><span class="lb-was">Was ${fmt(r.price)}</span><span class="lb-save">SAVE ${fmt(r.discount)}</span></div><div class="lb-price"><span class="lb-now">NOW</span> ${fmt(r.now)}</div></div>`
          : `<div class="lb-price">${fmt(r.price)}</div>`}</div>
        <div class="lb-bc">${bc(r.barcode)}</div>
        <div class="lb-code">${esc(r.barcode)}${state.showSku && r.fromSku === false && r.sku ? ` · ${esc(r.sku)}` : ''}</div>
        ${p.shopH ? `<div class="lb-shop">${esc(shop)}</div>` : ''}
      </div>`;
    }).join('')}</div>`;
    return { html, plan: p };
  }
  function rollPlan(roll, rows, shop) {
    const narrow = roll.paper <= 58; const px = 1; const py = 1.5; const bd = 0.3; const g = 0.6;
    const iw = roll.w - 2 * px; const ih = roll.h - 2 * py - bd;
    const infoW = iw * (narrow ? 0.46 : 0.44); const names = uniq(rows); const anyDisc = rows.some((r) => r.hasDiscount);
    const maxLen = rows.slice(0, 2000).reduce((m, r) => Math.max(m, fmt(r.hasDiscount ? r.now : r.price).length + (r.hasDiscount ? 4 : 0), r.hasDiscount ? fmt(r.price).length + 4 : 0), 6);
    const scales = [1, 0.88, 0.78, 0.68, 0.6]; let out = null;
    for (let si = 0; si < scales.length; si++) {
      const sc = scales[si]; const last = si === scales.length - 1;
      let fs = shop ? cl(roll.h * 0.075 * sc, 1.5, 2.6) : 0; if (fs) fs = Math.min(fs, iw / (em(shop.toUpperCase()) * 1.06)); const shopH = fs ? fs * 1.25 : 0;
      const mainH = ih - shopH - (shopH ? g : 0);
      const fp = Math.min(cl(mainH * 0.22 * sc, 3, 8), infoW / (maxLen * 0.64));
      const fw = Math.min(fp * 0.5, infoW * 0.5 / ((maxLen + 4) * 0.56)); const fv = fw * 0.85;
      const pH = anyDisc ? fw * 1.3 + 0.4 + fp * 0.85 * 1.15 : fp * 1.15;
      const prefFn = cl(mainH * 0.12, 2.2, 3.8); const minFn = 1.6;
      let nameMax = mainH - pH - g; if (nameMax < minFn * LH && !last) continue;
      nameMax = Math.max(minFn * LH, nameMax);
      const nameH = pickNameBox(names, infoW, nameMax, prefFn, minFn);
      if (!last && !names.every((t) => fitFont(t, infoW, nameH, prefFn, minFn).ok)) continue;
      const fc = cl(mainH * 0.1 * sc, 1.5, 2.4);
      out = { px, py, g, iw, infoW, prefFn, minFn, fs, shopH, fp, fw, fv, pH, nameH, fc, codeH: fc * 1.25 };
      break;
    }
    return out;
  }
  function rollLabels(cells, roll, rows) {
    const shop = shopName(); const p = rollPlan(roll, rows, shop);
    const vars = `--rl-w:${roll.w}mm;--rl-h:${roll.h}mm;--rl-px:${p.px}mm;--rl-py:${p.py}mm;--rl-g:${p.g}mm;--rl-infoW:${p.infoW.toFixed(2)}mm;--rl-nameH:${p.nameH.toFixed(2)}mm;--rl-pH:${p.pH.toFixed(2)}mm;--rl-fp:${p.fp.toFixed(2)}mm;--rl-fw:${p.fw.toFixed(2)}mm;--rl-fv:${p.fv.toFixed(2)}mm;--rl-fc:${p.fc.toFixed(2)}mm;--rl-codeH:${p.codeH.toFixed(2)}mm;--rl-fs:${p.fs.toFixed(2)}mm;--rl-shopH:${p.shopH.toFixed(2)}mm`;
    const svgs = new Map();
    const bc = (code) => { if (!svgs.has(code)) svgs.set(code, window.Barcode.svg(code, { fluid: true, height: 40, module: 2, quiet: 8 })); return svgs.get(code); };
    const html = `<div class="rl-roll" style="${vars}">${cells.map((r) => {
      const fit = fitFont(String(r.name || ''), p.infoW, p.nameH, p.prefFn, p.minFn); const f = fit.f;
      const cn = fit.ok ? 0 : Math.max(1, Math.floor((p.nameH + 0.01) / (f * LH)));
      return `<div class="rl${r.hasDiscount ? ' rl-disc' : ''}">
        ${p.shopH ? `<div class="rl-shop">${esc(shop)}</div>` : ''}
        <div class="rl-main">
          <div class="rl-info">
            <div class="rl-name"><span style="font-size:${f.toFixed(2)}mm${cn ? `;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:${cn};overflow:hidden` : ''}">${esc(r.name)}</span></div>
            <div class="rl-pblock">${r.hasDiscount
              ? `<div class="rl-was-row"><span class="rl-was">Was ${fmt(r.price)}</span><span class="rl-save">SAVE ${fmt(r.discount)}</span></div><div class="rl-price"><span class="rl-now">NOW</span> ${fmt(r.now)}</div>`
              : `<div class="rl-price">${fmt(r.price)}</div>`}</div>
          </div>
          <div class="rl-barcode">
            <div class="rl-bc">${bc(r.barcode)}</div>
            <div class="rl-code">${esc(r.barcode)}${state.showSku && r.fromSku === false && r.sku ? ` · ${esc(r.sku)}` : ''}</div>
          </div>
        </div></div>`;
    }).join('')}</div>`;
    return { html, plan: p };
  }
  function renderPreview() {
    const box = document.getElementById('sl-pv'); const note = document.getElementById('sl-pv-note');
    if (!box) return;
    const rows = state.rows.length ? chosen() : [];
    if (!rows.length) { box.innerHTML = '<div class="text-muted text-sm" style="padding:12px">Select a product to see the label.</div>'; if (note) note.textContent = ''; return; }
    const sample = rows.slice(0, 400);
    const pick = sample.reduce((a, r) => (r.hasDiscount && !a.hasDiscount) || (r.hasDiscount === a.hasDiscount && r.name.length > a.name.length) ? r : a, sample[0]);
    box.innerHTML = ROLLS[state.media] ? rollLabels([pick], ROLLS[state.media], sample).html : sheetLabels([pick], SIZES[state.size], sample).html;
    if (note) note.textContent = `Preview of “${pick.name}” as it will print.${state.showShop && !state.businessName ? ' No shop name is set yet (Settings → Business profile).' : ''}`;
  }

  /* ---------------- printing ---------------- */
  function print(mode) {
    const rows = chosen();
    if (loading) { window.UI.toast.info('Products are still loading - try again in a moment'); return; }
    if (!rows.length) { window.UI.toast.error(state.mode === 'discount' ? 'No discounted products selected' : 'Select at least one product'); return; }
    let pageStyle = null;
    let area = document.getElementById('print-area');
    if (!area) { area = document.createElement('div'); area.id = 'print-area'; document.body.appendChild(area); }
    const date = new Date().toLocaleDateString();
    if (mode === 'list') {
      area.innerHTML = `
        <h2 class="pl-title">${esc(state.businessName)} - ${state.mode === 'discount' ? 'Special offers' : 'Shelf price list'}</h2>
        <div class="pl-sub">${esc(date)} · ${rows.length} ${state.mode === 'discount' ? 'discounted ' : ''}products</div>
        <table class="pl-table"><thead><tr><th>#</th><th>Product</th><th>Barcode</th><th class="pl-r">Price</th></tr></thead><tbody>
        ${rows.map((r, i) => `<tr><td>${i + 1}</td><td>${esc(r.name)}${state.showSku && r.sku ? `<div class="pl-sku">${esc(r.sku)}</div>` : ''}</td><td class="pl-bc">${window.Barcode.svg(r.barcode, { height: 34, module: 1.6, quiet: 6 })}<div class="pl-code">${esc(r.barcode)}</div></td><td class="pl-r">${r.hasDiscount ? `<span class="pl-was">${window.UI.formatMoney(r.price)}</span><br>${window.UI.formatMoney(r.now)}<div class="pl-save">SAVE ${window.UI.formatMoney(r.discount)}</div>` : window.UI.formatMoney(r.price)}</td></tr>`).join('')}
        </tbody></table>`;
      document.body.dataset.printMode = 'list';
    } else if (ROLLS[state.media]) {
      const roll = ROLLS[state.media];
      const cells = [];
      rows.forEach((r) => { for (let i = 0; i < state.copies; i++) cells.push(r); });
      area.innerHTML = rollLabels(cells, roll, rows).html;
      document.body.dataset.printMode = 'labels';
      pageStyle = document.createElement('style');
      pageStyle.id = 'sl-page-style';
      pageStyle.textContent = `@page { size: ${roll.paper}mm auto; margin: 0; } @media print { body[data-print-mode] { margin: 0 !important; } }`;
      document.head.appendChild(pageStyle);
    } else {
      const sz = SIZES[state.size];
      const cells = [];
      rows.forEach((r) => { for (let i = 0; i < state.copies; i++) cells.push(r); });
      area.innerHTML = sheetLabels(cells, sz, rows).html;
      document.body.dataset.printMode = 'labels';
    }
    const done = () => { window.removeEventListener('afterprint', done); document.body.removeAttribute('data-print-mode'); area.innerHTML = ''; if (pageStyle) pageStyle.remove(); window.BusinessSetup?.markStepDone('labels'); };
    window.addEventListener('afterprint', done);
    setTimeout(() => window.print(), 100);
  }
})();