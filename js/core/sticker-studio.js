/**
 * sticker-studio.js - ONE dialog for barcode stickers and shelf labels.
 *   Paper: A4 sticker sheet (many layouts)  OR  barcode / label printer (every common sticker size, 1-4 across).
 *   Filters: barcode (all / system-generated 200... and 254... / own / none), stock (in / low / out / not tracked), category, search.
 *   Layout: every block of a label (shop, name, barcode, digits, price) has its own explicit height worked out from the real
 *   text width, so the product name can NEVER be covered by the barcode; the barcode gives way before the name does.
 *   Speed: opens at once, product list is virtual (only visible rows exist), data is prefetched by products.js.
 *
 * StickerStudio.open({ mode:'sticker'|'shelf', selectedIds, fill, fillPid, loadEntries, categories, getUsed, onSaved })
 *   entries = [{ name, barcode, price, sku, pid, vid, cat, low }]
 */
(function (window) {
  'use strict';
  const esc = (v) => window.UI.escapeHtml(v == null ? '' : v);
  const LH = 1.15;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const money = (n) => `KES ${(Math.round((Number(n) || 0) * 100) / 100).toLocaleString('en-KE', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

  const A4 = [
    { id: '3x8', label: '24 labels - 63.5 × 33.9 mm (3 × 8)', cols: 3, rows: 8, w: 63.5, h: 33.9 },
    { id: '4x10', label: '40 labels - 48.5 × 25.4 mm (4 × 10)', cols: 4, rows: 10, w: 48.5, h: 25.4 },
    { id: '5x13', label: '65 labels - 38.1 × 21.2 mm (5 × 13)', cols: 5, rows: 13, w: 38.1, h: 21.2 },
    { id: '3x7', label: '21 labels - 63.5 × 38.1 mm (3 × 7)', cols: 3, rows: 7, w: 63.5, h: 38.1 },
    { id: '3x10', label: '30 labels - 70 × 29.7 mm (3 × 10)', cols: 3, rows: 10, w: 70, h: 29.7 },
    { id: '2x8', label: '16 labels - 99.1 × 33.9 mm (2 × 8)', cols: 2, rows: 8, w: 99.1, h: 33.9 },
    { id: '2x7', label: '14 labels - 99.1 × 38.1 mm (2 × 7)', cols: 2, rows: 7, w: 99.1, h: 38.1 },
    { id: '2x4', label: '8 labels - 99.1 × 67.7 mm (2 × 4)', cols: 2, rows: 4, w: 99.1, h: 67.7 },
  ];
  const SIZES = [[20, 10], [25, 15], [30, 20], [38, 25], [40, 30], [50, 25], [50, 30], [50, 40], [58, 40], [60, 40], [70, 50], [100, 50], [100, 70], [100, 150]]
    .map(([w, h]) => ({ id: `${w}x${h}`, w, h, label: `${w} × ${h} mm` }));
  const MAX_PAGES = 200; const MAX_STICKERS = 3000;

  /* ---------- text measuring (names must fit their box) ---------- */
  let ctx2d = null; const emMem = new Map();
  function em(word) {
    let v = emMem.get(word);
    if (v === undefined) {
      try { if (!ctx2d) { ctx2d = document.createElement('canvas').getContext('2d'); ctx2d.font = 'bold 100px Arial, Helvetica, sans-serif'; } v = ctx2d.measureText(word).width / 100; }
      catch { v = word.length * 0.6; }
      v *= 1.06; if (emMem.size > 30000) emMem.clear(); emMem.set(word, v);
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
  function fitName(text, boxW, boxH, fMax, fMin) {
    const key = `${text}|${boxW.toFixed(1)}|${boxH.toFixed(1)}|${fMax.toFixed(2)}|${fMin.toFixed(2)}`;
    let r = fitMem.get(key); if (r) return r;
    r = { f: fMin, ok: false };
    for (let f = fMax; f >= fMin - 1e-6; f -= 0.05) { if (wrapLines(text, f, boxW) * f * LH <= boxH + 1e-6) { r = { f, ok: true }; break; } }
    if (fitMem.size > 20000) fitMem.clear();
    fitMem.set(key, r); return r;
  }

  /* ---------- label plan: explicit heights for every block ---------- */
  function makePlan(w, h, o, names, shop) {
    const px = clamp(w * 0.04, 1, 2.5); const py = clamp(h * 0.05, 0.8, 2); const g = clamp(h * 0.015, 0.25, 0.6);
    const iw = w - 2 * px - 0.4; const ih = h - 2 * py - 0.4;
    const k = o.shelf ? 1.5 : 1;
    const maxPrice = o.price ? 12 : 0;
    const tryScale = (sc, last) => {
      let fs = shop ? Math.min(clamp(h * 0.06 * sc, 1.4, 2.6), iw / (em(shop.toUpperCase()) * 1.04)) : 0; fs = fs && Math.max(fs, 1.3); const shopH = fs ? fs * 1.25 : 0;
      let fp = o.price ? Math.min(clamp(h * 0.13 * k * sc, 2.4, 9), iw / (maxPrice * 0.62)) : 0; const pH = fp ? fp * 1.15 : 0;
      let fc = o.digits ? Math.min(clamp(h * 0.06 * sc, 1.3, 2.4), iw / (13 * 0.64)) : 0; const cH = fc ? fc * 1.2 : 0;
      const blocks = [shopH, pH, cH].filter(Boolean).length + 2;
      const avail = ih - shopH - pH - cH - blocks * g + g;
      const bcMin = Math.min(Math.max(h * 0.2 * sc, 3.5), avail * 0.55);
      const prefFn = clamp(h * 0.085 * (o.shelf ? 1.3 : 1) * sc, 2.0, o.shelf ? 7 : 4.6); const minFn = 1.5;
      let nameMax = avail - bcMin;
      if (nameMax < minFn * LH && !last) return null;
      nameMax = Math.max(minFn * LH, nameMax);
      let nameH = nameMax;
      for (let n = 1; n <= 4; n++) {
        const box = Math.min(nameMax, n * prefFn * LH);
        if (names.every((t) => fitName(t, iw, box, prefFn, minFn).f >= prefFn * 0.8)) { nameH = box; break; }
        if (box >= nameMax - 1e-6) break;
      }
      if (!last && !names.every((t) => fitName(t, iw, nameH, prefFn, minFn).ok)) return null;
      const bcH = Math.max(2, avail - nameH);
      return { px, py, g, iw, fs, shopH, fp, pH, fc, cH, nameH, bcH, prefFn, minFn };
    };
    const scales = [1, 0.88, 0.78, 0.68, 0.58];
    for (let i = 0; i < scales.length; i++) { const r = tryScale(scales[i], i === scales.length - 1); if (r) return r; }
    return null;
  }
  function planCss(w, h, p, guides) {
    return `.sx-lb{width:${w}mm;height:${h}mm;box-sizing:border-box;padding:${p.py}mm ${p.px}mm;display:flex;flex-direction:column;align-items:stretch;justify-content:center;gap:${p.g}mm;overflow:hidden;text-align:center;font-family:Arial,Helvetica,sans-serif;color:#000;line-height:1;background:#fff}
.sx-lb>*{flex:none;min-width:0;box-sizing:border-box}${guides ? '.sx-lb{outline:.2mm dashed #888;outline-offset:-.2mm}' : ''}
.sx-shop{height:${p.shopH.toFixed(2)}mm;line-height:${p.shopH.toFixed(2)}mm;font-size:${p.fs.toFixed(2)}mm;font-weight:700;text-transform:uppercase;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sx-nm{height:${p.nameH.toFixed(2)}mm;display:flex;align-items:center;justify-content:center;overflow:hidden}
.sx-nm span{display:block;width:100%;font-weight:700;line-height:${LH};overflow-wrap:anywhere;word-break:break-word}
.sx-bc{height:${p.bcH.toFixed(2)}mm}.sx-bc svg{width:100%;height:100%;display:block}
.sx-dg{height:${p.cH.toFixed(2)}mm;line-height:${p.cH.toFixed(2)}mm;font-size:${p.fc.toFixed(2)}mm;font-family:"Courier New",monospace;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sx-pr{height:${p.pH.toFixed(2)}mm;line-height:${p.pH.toFixed(2)}mm;font-size:${p.fp.toFixed(2)}mm;font-weight:800;white-space:nowrap;overflow:hidden}
.sx-sheet{position:relative;background:#fff;overflow:hidden}.sx-grid{display:grid}.sx-row{display:flex}`;
  }

  /* ---------- the dialog ---------- */
  async function open(cfg) {
    const shelf = cfg.mode === 'shelf';
    const preSel = new Set((cfg.selectedIds || []).map(String));
    const prefs = (() => { try { return window.Storage.getPref('stickerStudio', {}) || {}; } catch { return {}; } })();
    const savePrefs = () => { try { window.Storage.setPref('stickerStudio', { paper: st.paper, layout: st.layout, size: st.size, across: st.across, gap: st.gap, price: st.price, shop: st.shop, digits: st.digits, guides: st.guides }); } catch { /* optional */ } };
    const st = {
      paper: prefs.paper === 'printer' ? 'printer' : 'a4', layout: A4.some((l) => l.id === prefs.layout) ? prefs.layout : (shelf ? '2x4' : '3x8'),
      size: prefs.size || '40x30', across: prefs.across || 2, gap: prefs.gap != null ? prefs.gap : 2, cw: 40, ch: 30,
      price: prefs.price !== false, shop: !!prefs.shop, digits: prefs.digits !== false, guides: !!prefs.guides,
      start: 1, mode: cfg.fill ? 'fill' : 'list', pages: 1, fillEntry: null, fillQuery: '', page: 0,
      cmode: 'manual', extra: 0, loaded: false, stockReady: false, rows: [], entries: [], view: [],
      f: { bc: 'all', sys: 'both', prefix: '', stock: 'any', cat: '', q: '', onlySel: preSel.size > 0 },
    };
    const shopName = () => String(window.AppShell?.getBusinessProfile?.()?.name || window.AppShell?.getUser?.()?.businessName || '').trim();

    const modal = window.UI.openModal({
      title: shelf ? 'Print shelf labels' : 'Print barcode stickers',
      maxWidth: '1060px',
      bodyHtml: `
      <div class="ss-wrap">
        <div class="ss-left">
          <div class="ss-sec"><div class="ss-lbl">Print on</div>
            <div class="ss-seg" id="ss-paper">
              <button type="button" data-paper="a4"><span>A4 sticker sheet</span><small>Sheets of many labels</small></button>
              <button type="button" data-paper="printer"><span>Barcode / label printer</span><small>Label rolls &amp; receipt rolls</small></button>
            </div></div>
          <div class="ss-sec" id="ss-a4opts">
            <div class="ss-grid2">
              <div class="ss-field"><label for="ss-layout">Sticker sheet layout</label><select class="select" id="ss-layout">${A4.map((l) => `<option value="${l.id}">${l.label}</option>`).join('')}</select></div>
              <div class="ss-field"><label for="ss-start">Start at label no.</label><input class="input" id="ss-start" type="number" min="1" value="1" /></div>
            </div>
            <span class="ss-hint">Pick the layout that matches the labels on your sticker paper. Re-using a part-used sheet? Skip the labels already used.</span>
          </div>
          <div class="ss-sec" id="ss-propts" hidden>
            <div class="ss-grid2">
              <div class="ss-field"><label for="ss-size">Sticker size</label><select class="select" id="ss-size">${SIZES.map((s) => `<option value="${s.id}">${s.label}</option>`).join('')}<option value="custom">Custom size…</option></select></div>
              <div class="ss-field"><label for="ss-across">Stickers across</label><select class="select" id="ss-across">${[1, 2, 3, 4].map((n) => `<option value="${n}">${n}</option>`).join('')}</select></div>
            </div>
            <div class="ss-grid2" id="ss-custom" hidden>
              <div class="ss-field"><label for="ss-cw">Width mm</label><input class="input" id="ss-cw" type="number" min="15" max="150" value="40" /></div>
              <div class="ss-field"><label for="ss-chh">Height mm</label><input class="input" id="ss-chh" type="number" min="8" max="200" value="30" /></div>
            </div>
            <div class="ss-field"><label for="ss-gap">Gap between mm</label><input class="input" id="ss-gap" type="number" min="0" max="10" step="0.5" value="2" /></div>
            <span class="ss-hint" id="ss-prhint"></span>
          </div>
          <div class="ss-sec"><div class="ss-lbl">Show on the sticker</div>
            <div class="ss-chips">
              <label class="ss-tog"><input type="checkbox" id="ss-price" /> Price</label>
              <label class="ss-tog"><input type="checkbox" id="ss-shop" /> Shop name</label>
              <label class="ss-tog"><input type="checkbox" id="ss-digits" /> Barcode number</label>
              <label class="ss-tog" id="ss-guides-wrap"><input type="checkbox" id="ss-guides" /> Cut guides</label>
            </div></div>
          <div class="ss-sec"><div class="ss-lbl">What do you want to print?</div>
            <div class="ss-seg ss-seg-s" id="ss-modes"><button type="button" data-mode="list">Chosen products</button><button type="button" data-mode="fill">Fill with ONE product</button></div></div>
          <div id="ss-fill" hidden>
            <div class="ss-field"><label for="ss-fq">Product</label><input class="input" id="ss-fq" autocomplete="off" placeholder="Search by name, SKU or barcode" /><div class="ss-pick" id="ss-pick"></div><div class="ss-hint" id="ss-fsel">No product chosen yet</div></div>
            <div class="ss-grid2" style="margin-top:10px">
              <div class="ss-field"><label for="ss-pages" id="ss-pages-l">Number of A4 pages</label><input class="input" id="ss-pages" type="number" min="1" value="1" /><div class="ss-pills" id="ss-pills"></div></div>
              <div class="ss-field"><label>Result</label><div class="ss-total" id="ss-ftotal"></div></div>
            </div>
          </div>
          <div id="ss-list-wrap">
            <div class="ss-card" style="margin-bottom:12px">
              <div class="ss-lbl">Filter the products</div>
              ${shelf ? '' : `<div class="ss-grid1"><div class="ss-field"><label for="ss-f-bc">Barcode</label><select class="select" id="ss-f-bc"></select></div></div>
              <div class="ss-grid2" id="ss-sysrow" hidden>
                <div class="ss-field"><label for="ss-f-sys">System barcodes starting with</label><select class="select" id="ss-f-sys"><option value="both">200… and 254… (both)</option><option value="200">200… only</option><option value="254">254… only</option><option value="custom">Other digits…</option></select></div>
                <div class="ss-field" id="ss-prefix-wrap" hidden><label for="ss-f-prefix">Starts with</label><input class="input" id="ss-f-prefix" inputmode="numeric" maxlength="8" /></div>
              </div>
              <span class="ss-hint" id="ss-fhint"></span>`}
              <div class="ss-grid2">
                <div class="ss-field"><label for="ss-f-stock">Stock</label><select class="select" id="ss-f-stock"><option value="any">Any stock</option><option value="in">In stock</option><option value="low">Low stock</option><option value="out">Out of stock (0)</option><option value="untracked">Stock not tracked / variants</option></select></div>
                <div class="ss-field"><label for="ss-f-cat">Category</label><select class="select" id="ss-f-cat"><option value="">All categories</option>${(cfg.categories || []).map((c) => `<option value="${esc(c._id)}">${esc(c.name)}</option>`).join('')}</select></div>
              </div>
              <div class="ss-field"><label for="ss-f-q">Search</label><input class="input" id="ss-f-q" placeholder="Name, SKU or barcode" autocomplete="off" /></div>
              ${preSel.size ? `<label class="ss-tog" style="align-self:flex-start"><input type="checkbox" id="ss-f-sel" checked /> Only the ${preSel.size} product${preSel.size === 1 ? '' : 's'} I selected</label>` : ''}
            </div>
            ${shelf ? '' : `<div class="ss-grid2" style="margin-bottom:12px">
              <div class="ss-field"><label for="ss-cmode">Stickers per product</label><select class="select" id="ss-cmode"><option value="manual">As typed in the list (default 1)</option><option value="stock">Same as current stock</option></select></div>
              <div class="ss-field"><label for="ss-extra">Extra stickers for EVERY product</label><input class="input" id="ss-extra" type="number" min="0" max="20" value="0" /></div>
            </div><span class="ss-hint" id="ss-chint" style="display:block;margin-bottom:10px"></span>`}
            <div class="ss-head"><label class="ss-tog" style="min-height:32px"><input type="checkbox" id="ss-all" /> <span id="ss-ptitle">Products</span></label></div>
            <div class="ss-list" id="ss-list" style="margin-top:8px"><div class="ss-empty">Loading products…</div></div>
          </div>
        </div>
        <div class="ss-right"><div class="ss-pvbox">
          <div class="ss-nav"><button type="button" class="btn btn-secondary btn-sm" id="ss-prev">&lsaquo;</button><span id="ss-pginfo"></span><button type="button" class="btn btn-secondary btn-sm" id="ss-next">&rsaquo;</button></div>
          <div id="ss-preview"></div>
          <div class="ss-warn" id="ss-warn" hidden></div>
          <div class="ss-hint" style="text-align:center">Exactly how it will print. Choose <b>Scale 100%</b> / “Actual size” and margins <b>None</b> in the print window.</div>
        </div></div>
      </div>`,
      footerHtml: `<span class="ss-foot" id="ss-sum"></span><button class="btn btn-secondary" data-action="cancel">Cancel</button><button class="btn btn-primary" id="ss-print" disabled>Print</button>`,
    });
    modal.classList.add('ss-modal');
    const $ = (q) => modal.querySelector(q);
    const $$ = (q) => Array.from(modal.querySelectorAll(q));
    $('[data-action="cancel"]').addEventListener('click', window.UI.closeModal);

    // initial control state
    $('#ss-layout').value = st.layout; $('#ss-size').value = SIZES.some((s) => s.id === st.size) ? st.size : 'custom'; $('#ss-across').value = String(st.across); $('#ss-gap').value = st.gap;
    $('#ss-price').checked = st.price; $('#ss-shop').checked = st.shop; $('#ss-digits').checked = st.digits; $('#ss-guides').checked = st.guides;

    /* ----- geometry ----- */
    const dims = () => {
      if (st.paper === 'a4') { const L = A4.find((l) => l.id === st.layout) || A4[0]; return { w: L.w, h: L.h, cols: L.cols, rows: L.rows, per: L.cols * L.rows, L }; }
      const s = SIZES.find((x) => x.id === st.size); const w = s ? s.w : st.cw; const h = s ? s.h : st.ch;
      return { w, h, cols: st.across, rows: 1, per: st.across, paperW: st.across * w + (st.across - 1) * st.gap };
    };
    const skipCount = () => (st.paper === 'a4' ? Math.min(Math.max(1, st.start), dims().per) - 1 : 0);
    const opts = () => ({ shelf, price: st.price, digits: st.digits, guides: st.guides && st.paper === 'a4' });
    const modeIsFill = () => st.mode === 'fill';

    /* ----- barcode svg cache ----- */
    const svgMem = new Map();
    const svgOf = (code) => { if (!code) return ''; let s = svgMem.get(code); if (s === undefined) { try { s = window.Barcode.smartSvg(code, { fluid: true, height: 40, module: 2, quietLeft: 6, quietRight: 4 }); } catch { s = ''; } svgMem.set(code, s); } return s; };

    /* ----- rows / filters ----- */
    const isDigits = (c) => /^\d{13}$/.test(c);
    const isSys = (c) => {
      c = String(c || '').trim(); if (!isDigits(c)) return false;
      const k = st.f.sys;
      if (k === '200') return c.startsWith('200'); if (k === '254') return c.startsWith('254');
      if (k === 'custom') return !!st.f.prefix && c.startsWith(st.f.prefix);
      return c.startsWith('200') || c.startsWith('254');
    };
    const isSysAny = (c) => { c = String(c || '').trim(); return isDigits(c) && (c.startsWith('200') || c.startsWith('254')); };
    const stockOf = (r) => {
      if (r.stock == null) { r.state = 'untracked'; return; }
      r.state = r.stock <= 0 ? 'out' : ((r.lowFlag || (r.e.low != null && r.stock <= r.e.low)) ? 'low' : 'in');
    };
    const matchBarcode = (r) => {
      if (shelf) return true; const f = st.f.bc; const has = !!r.e.barcode;
      if (f === 'none') return !has; if (!has) return false;
      if (f === 'sys') return isSys(r.e.barcode); if (f === 'own') return !isSysAny(r.e.barcode); return true;
    };
    const matchStock = (r) => st.f.stock === 'any' || (st.stockReady && r.state === st.f.stock);
    const baseMatch = (r, q) => {
      const f = st.f;
      if (f.onlySel && preSel.size && !preSel.has(String(r.e.pid))) return false;
      if (f.cat && r.e.cat !== f.cat) return false;
      if (q && !r.hay.includes(q)) return false;
      return matchBarcode(r);
    };
    const baseCopies = (r) => (st.cmode === 'stock' && r.stock != null ? Math.max(0, Math.ceil(r.stock - 1e-9)) : r.copies);
    const effCopies = (r) => Math.min(1000, baseCopies(r) + st.extra);

    function updateBcOptions() {
      const sel = $('#ss-f-bc'); if (!sel) return;
      const n = { all: 0, sys: 0, own: 0, none: 0 };
      st.rows.forEach((r) => { if (!r.e.barcode) n.none++; else { n.all++; if (isSys(r.e.barcode)) n.sys++; if (!isSysAny(r.e.barcode)) n.own++; } });
      const cur = sel.value || st.f.bc;
      sel.innerHTML = `<option value="all">All products that have a barcode (${n.all})</option><option value="sys">System-generated barcodes (${n.sys})</option><option value="own">Own / manufacturer barcodes (${n.own})</option><option value="none">No barcode yet - create one (${n.none})</option>`;
      sel.value = cur;
    }
    function updateStockCounts() {
      const q = st.f.q.trim().toLowerCase(); const c = { in: 0, low: 0, out: 0, untracked: 0 };
      st.rows.forEach((r) => { if (baseMatch(r, q)) c[r.state]++; });
      const lab = { in: 'In stock (1 or more)', low: 'Low stock', out: 'Out of stock (0)', untracked: 'Stock not tracked / variants' };
      Object.keys(lab).forEach((k) => { const o = $(`#ss-f-stock option[value="${k}"]`); if (o) o.textContent = `${lab[k]} (${c[k]})`; });
    }
    function computeView() {
      const q = st.f.q.trim().toLowerCase();
      if (st.stockReady) st.rows.forEach(stockOf);
      st.view = st.rows.filter((r) => baseMatch(r, q) && matchStock(r));
      const inView = new Set(st.view); st.rows.forEach((r) => { r.vis = inView.has(r); });
    }
    function resetTicks() { st.rows.forEach((r) => { r.on = r.vis; }); }

    /** Products with no barcode get a new store barcode (shown on the label, saved to the product when you print). */
    async function ensurePending(rowsList) {
      const need = rowsList.filter((r) => !r.e.barcode && !r.e.pending); if (!need.length) return true;
      let known = null; try { known = await cfg.getUsed(true); } catch { known = null; }
      if (!known) { window.UI.toast.error('Could not load the existing barcodes, so new ones cannot be created safely. Check the connection and try again.'); return false; }
      const used = new Set(known); st.rows.forEach((r) => { if (r.e.barcode) used.add(String(r.e.barcode).trim()); if (r.e.pending) used.add(r.e.pending); });
      need.forEach((r) => { r.e.pending = String(window.BarcodeLabels.generateCode(used)); used.add(r.e.pending); });
      return true;
    }

    let viewTok = 0;
    async function applyFilters(opt = {}) {
      const tok = ++viewTok;
      computeView();
      if (!shelf && st.f.bc === 'none') {
        const ok = await ensurePending(st.view);
        if (tok !== viewTok) return;
        if (!ok) { st.f.bc = 'all'; $('#ss-f-bc').value = 'all'; return applyFilters(opt); }
      }
      if (st.stockReady) updateStockCounts();
      if (opt.resetTicks !== false) resetTicks();
      syncFilterUi(); renderList(); updateSummary(); st.page = 0; schedulePreview();
    }
    function syncFilterUi() {
      const n = st.view.length;
      $('#ss-ptitle').textContent = `Products (${n})`;
      const all = $('#ss-all'); all.disabled = !st.loaded; all.checked = n > 0 && st.view.every((r) => r.on);
      if (shelf) return;
      $('#ss-sysrow').hidden = st.f.bc !== 'sys'; $('#ss-prefix-wrap').hidden = st.f.sys !== 'custom';
      const h = $('#ss-fhint');
      if (st.f.bc === 'none') h.textContent = n ? `${n} product${n === 1 ? ' has' : 's have'} no barcode. A new barcode is shown on each label and saved to the product when you print.` : 'Every product already has a barcode.';
      else if (st.f.bc === 'sys') h.textContent = n ? `${n} product${n === 1 ? ' has' : 's have'} a system-generated barcode.` : 'No products have a system-generated barcode for this choice.';
      else h.textContent = '';
    }

    /* ----- virtual list ----- */
    const ROWH = 56;
    function renderList() {
      const box = $('#ss-list'); if (!box) return;
      if (!st.loaded) { box.innerHTML = '<div class="ss-empty">Loading products…</div>'; return; }
      const n = st.view.length;
      if (!n) { box.innerHTML = `<div class="ss-empty">${st.f.stock !== 'any' && !st.stockReady ? 'Loading stock…' : 'No matching products.'}</div>`; return; }
      const first = Math.max(0, Math.floor(box.scrollTop / ROWH) - 4); const last = Math.min(n, first + Math.ceil((box.clientHeight || 320) / ROWH) + 9);
      let html = `<div style="height:${n * ROWH}px;width:1px"></div>`;
      for (let i = first; i < last; i++) {
        const r = st.view[i]; const e = r.e; const code = e.barcode || e.pending || '';
        const pills = (isSysAny(e.barcode) ? '<span class="ss-pill ss-sys">system</span> ' : '') + (!e.barcode && !shelf ? '<span class="ss-pill ss-new">new barcode</span> ' : '')
          + (st.stockReady && r.state === 'low' ? '<span class="ss-pill ss-low">low</span> ' : '') + (st.stockReady && r.state === 'out' ? '<span class="ss-pill ss-out">out</span>' : '');
        const stockTxt = st.cmode === 'stock' ? (r.stock != null ? ` · Stock: ${r.stock}` : ' · stock not tracked') : (st.stockReady && r.stock != null ? ` · Stock: ${r.stock}` : '');
        const eff = (st.cmode === 'stock' || st.extra) ? `= ${effCopies(r)}` : '';
        html += `<div class="ss-row" style="top:${i * ROWH}px"><input type="checkbox" data-on="${r.i}" ${r.on ? 'checked' : ''} />
          <div class="ss-nm"><span class="ss-nmt">${esc(e.name)}</span><small>${esc(code || 'No barcode')} · ${esc(money(e.price))}${esc(stockTxt)} ${pills}</small></div>
          <span class="ss-eff">${eff}</span>
          <label class="ss-cp">Copies <input class="input" type="number" min="0" max="500" value="${baseCopies(r)}" data-c="${r.i}" ${st.cmode === 'stock' && r.stock != null ? 'disabled' : ''} /></label></div>`;
      }
      box.innerHTML = html;
    }
    let listRaf = 0;
    $('#ss-list').addEventListener('scroll', () => { if (listRaf) return; listRaf = requestAnimationFrame(() => { listRaf = 0; renderList(); }); }, { passive: true });
    $('#ss-list').addEventListener('change', (e) => {
      const cb = e.target.closest('[data-on]'); if (!cb) return;
      st.rows[Number(cb.dataset.on)].on = cb.checked; syncFilterUi(); updateSummary(); st.page = 0; schedulePreview();
    });
    $('#ss-list').addEventListener('input', (e) => {
      const c = e.target.closest('[data-c]'); if (!c) return;
      const v = parseInt(c.value, 10); st.rows[Number(c.dataset.c)].copies = Number.isFinite(v) ? clamp(v, 0, 500) : 1; updateSummary(); st.page = 0; schedulePreview();
    });
    $('#ss-all').addEventListener('change', (e) => { st.view.forEach((r) => { r.on = e.target.checked; }); renderList(); updateSummary(); st.page = 0; schedulePreview(); });

    /* ----- label list ----- */
    function parts() {
      const out = []; const skip = skipCount();
      for (let i = 0; i < skip; i++) out.push(null);
      if (modeIsFill()) {
        if (st.fillEntry) { const total = st.paper === 'a4' ? Math.max(0, st.pages * dims().per - skip) : st.pages; for (let c = 0; c < total; c++) out.push(st.fillEntry); }
        return out;
      }
      st.view.forEach((r) => { if (r.on) for (let c = 0, n = effCopies(r); c < n; c++) out.push(r.e); });
      return out;
    }
    const count = (list) => { let n = 0; for (const x of list) if (x) n++; return n; };

    function updateSummary() {
      const list = parts(); const real = count(list); const D = dims();
      let txt;
      if (modeIsFill()) txt = st.fillEntry ? `1 product · ${real} stickers` : 'Choose a product';
      else { const prods = st.view.filter((r) => r.on).length; txt = `${prods} product${prods === 1 ? '' : 's'} · ${real} sticker${real === 1 ? '' : 's'}${st.paper === 'a4' && real ? ` on ${Math.ceil(list.length / D.per)} sheet${Math.ceil(list.length / D.per) === 1 ? '' : 's'}` : ''}`; }
      $('#ss-sum').textContent = txt;
      if (!shelf) {
        const h = $('#ss-chint');
        if (h) { const on = st.view.filter((r) => r.on); const base = on.reduce((t, r) => t + baseCopies(r), 0); const all = on.reduce((t, r) => t + effCopies(r), 0);
          h.textContent = (st.cmode === 'stock' ? 'One sticker per unit in stock (shop + warehouse). ' : '') + `${on.length} product${on.length === 1 ? '' : 's'}: ${base}${all - base ? ` + ${all - base} extra` : ''} = ${all} sticker${all === 1 ? '' : 's'}.`; }
      }
      const b = $('#ss-print'); if (b && !b.dataset.loading) { b.disabled = !st.loaded; b.textContent = st.paper === 'a4' ? 'Print A4 sheet' : 'Print stickers'; }
    }

    /* ----- rendering labels ----- */
    function namesOf(list) {
      const seen = new Set(); const arr = [];
      for (const e of list) { if (e && !seen.has(e.name)) { seen.add(e.name); arr.push(String(e.name || '')); } }
      arr.sort((a, b) => b.length - a.length); return arr.slice(0, 40);
    }
    function planFor(D, list) { return makePlan(D.w, D.h, opts(), namesOf(list), st.shop && D.h >= 16 ? shopName() : ''); }
    function labelHtml(e, p, map) {
      if (!e) return '<div class="sx-lb"></div>';
      const code = e.barcode || e.pending || ''; const o = opts(); const shop = p.shopH ? shopName() : '';
      const fit = fitName(String(e.name || ''), p.iw, p.nameH, p.prefFn, p.minFn); const clampN = fit.ok ? 0 : Math.max(1, Math.floor((p.nameH + 0.01) / (fit.f * LH)));
      return `<div class="sx-lb">${p.shopH && shop ? `<div class="sx-shop">${esc(shop)}</div>` : ''}<div class="sx-nm"><span style="font-size:${fit.f.toFixed(2)}mm${clampN ? `;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:${clampN};overflow:hidden` : ''}">${esc(e.name)}</span></div><div class="sx-bc">${code ? (map.get(code) || '') : ''}</div>${p.cH ? `<div class="sx-dg">${esc(code)}</div>` : ''}${o.price && p.pH ? `<div class="sx-pr">${esc(money(e.price))}</div>` : ''}</div>`;
    }
    function makeMap(list, compact) {
      const map = new Map(); let defs = ''; let i = 0;
      list.forEach((e) => { if (!e) return; const c = e.barcode || e.pending || ''; if (c && !map.has(c)) map.set(c, svgOf(c)); });
      if (!compact) return { map, defs };
      const out = new Map();
      map.forEach((svg, code) => {
        const vb = /viewBox="([^"]+)"/.exec(svg || ''); if (!vb) { out.set(code, svg); return; }
        const id = `bcs${i++}`; const inner = svg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
        defs += `<symbol id="${id}" viewBox="${vb[1]}" preserveAspectRatio="none">${inner}</symbol>`;
        out.set(code, `<svg width="100%" height="100%" preserveAspectRatio="none"><use href="#${id}" width="100%" height="100%"></use></svg>`);
      });
      return { map: out, defs: defs ? `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>${defs}</defs></svg>` : '' };
    }
    function pageHtml(pg, D, p, map, trim) {
      if (st.paper === 'a4') {
        const ml = (210 - D.cols * D.w) / 2; const mt = (297 - D.rows * D.h) / 2;
        return `<div class="sx-sheet" style="width:210mm;height:${(297 - (trim || 0)).toFixed(2)}mm"><div class="sx-grid" style="position:absolute;left:${ml.toFixed(2)}mm;top:${mt.toFixed(2)}mm;grid-template-columns:repeat(${D.cols},${D.w}mm);grid-auto-rows:${D.h}mm">${pg.map((e) => labelHtml(e, p, map)).join('')}</div></div>`;
      }
      return `<div class="sx-sheet" style="width:${D.paperW}mm;height:${(D.h - (trim || 0)).toFixed(2)}mm"><div class="sx-row" style="gap:${st.gap}mm">${pg.map((e) => labelHtml(e, p, map)).join('')}</div></div>`;
    }
    const chunk = (list, n) => { const out = []; for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n)); return out; };

    let seq = 0; let pvTimer = 0;
    const schedulePreview = () => { clearTimeout(pvTimer); pvTimer = setTimeout(renderPreview, 60); };
    function renderPreview() {
      const my = ++seq; const box = $('#ss-preview'); const info = $('#ss-pginfo'); const warn = $('#ss-warn');
      const prev = $('#ss-prev'); const next = $('#ss-next');
      if (!st.loaded) { box.innerHTML = '<div class="ss-empty">Loading products…</div>'; info.textContent = ''; prev.disabled = next.disabled = true; return; }
      const list = parts(); const D = dims();
      if (!count(list)) { box.innerHTML = `<div class="ss-empty">${modeIsFill() ? 'Choose the product to print' : 'Tick at least one product'}</div>`; info.textContent = ''; warn.hidden = true; prev.disabled = next.disabled = true; return; }
      const pages = chunk(list, D.per); st.page = clamp(st.page, 0, pages.length - 1);
      info.textContent = st.paper === 'a4' ? `Sheet ${st.page + 1} of ${pages.length}` : `Row ${st.page + 1} of ${pages.length}`;
      prev.disabled = st.page === 0; next.disabled = st.page >= pages.length - 1;
      const p = planFor(D, list);
      const longN = namesOf(list).filter((t) => !fitName(t, p.iw, p.nameH, p.prefFn, p.minFn).ok).length;
      warn.hidden = !longN; warn.textContent = longN ? `Some product names are too long for this small sticker and will end with “…”. Choose a bigger sticker to show the full name.` : '';
      const pg = pages[st.page]; const { map } = makeMap(pg, false);
      const pw = st.paper === 'a4' ? 210 : D.paperW; const ph = st.paper === 'a4' ? 297 : D.h;
      const avail = Math.max(200, Math.min(350, (($('.ss-pvbox') && $('.ss-pvbox').clientWidth) || 380) - 26));
      const scale = avail / (pw * 3.7795);
      box.innerHTML = `<div class="ss-pv" style="width:${Math.round(avail)}px;height:${Math.round(ph * 3.7795 * scale)}px"><style>${planCss(D.w, D.h, p, opts().guides)}</style><div style="transform:scale(${scale.toFixed(4)});transform-origin:0 0;width:${pw}mm;height:${ph}mm">${pageHtml(pg, D, p, map, 0)}</div></div>`;
      if (my !== seq) return;
    }
    $('#ss-prev').addEventListener('click', () => { st.page = Math.max(0, st.page - 1); renderPreview(); });
    $('#ss-next').addEventListener('click', () => { st.page += 1; renderPreview(); });

    /* ----- controls ----- */
    function applyPaper() {
      $$('#ss-paper [data-paper]').forEach((b) => b.classList.toggle('on', b.dataset.paper === st.paper));
      $('#ss-a4opts').hidden = st.paper !== 'a4'; $('#ss-propts').hidden = st.paper === 'a4'; $('#ss-guides-wrap').hidden = st.paper !== 'a4';
      $('#ss-custom').hidden = $('#ss-size').value !== 'custom';
      const D = dims();
      if (st.paper !== 'a4') $('#ss-prhint').textContent = `Each row is one label of ${D.paperW} × ${D.h} mm. In the print window choose your label printer, set the paper size to ${D.paperW} × ${D.h} mm (it is pre-selected in most drivers), margins None, scale 100%.`;
      $('#ss-pages-l').textContent = st.paper === 'a4' ? 'Number of A4 pages' : 'Number of stickers';
      const chips = st.paper === 'a4' ? [1, 2, 3, 5, 10, 20] : [10, 50, 100, 200, 500];
      $('#ss-pills').innerHTML = chips.map((n) => `<button type="button" class="ss-pillbtn" data-pg="${n}">${n}</button>`).join('');
      updateFillTotal();
    }
    function updateFillTotal() {
      const D = dims(); const skip = skipCount();
      const total = st.paper === 'a4' ? Math.max(0, st.pages * D.per - skip) : st.pages;
      $('#ss-ftotal').innerHTML = st.paper === 'a4' ? `${total} labels · ${D.per} per sheet × ${st.pages} sheet${st.pages === 1 ? '' : 's'}${skip ? ` − ${skip} skipped` : ''}` : `${total} stickers · ${Math.ceil(total / D.per)} rows`;
      $$('#ss-pills [data-pg]').forEach((c) => c.classList.toggle('on', Number(c.dataset.pg) === st.pages));
    }
    const refreshAll = () => { applyPaper(); updateSummary(); st.page = 0; schedulePreview(); };
    $('#ss-paper').addEventListener('click', (e) => { const b = e.target.closest('[data-paper]'); if (!b || b.dataset.paper === st.paper) return; st.paper = b.dataset.paper; st.pages = 1; $('#ss-pages').value = 1; savePrefs(); refreshAll(); });
    $('#ss-layout').addEventListener('change', (e) => { st.layout = e.target.value; savePrefs(); refreshAll(); });
    $('#ss-start').addEventListener('input', (e) => { st.start = Math.max(1, parseInt(e.target.value, 10) || 1); refreshAll(); });
    $('#ss-size').addEventListener('change', (e) => { st.size = e.target.value; savePrefs(); refreshAll(); });
    $('#ss-across').addEventListener('change', (e) => { st.across = Number(e.target.value) || 1; savePrefs(); refreshAll(); });
    $('#ss-gap').addEventListener('input', (e) => { st.gap = clamp(parseFloat(e.target.value) || 0, 0, 10); savePrefs(); refreshAll(); });
    $('#ss-cw').addEventListener('input', (e) => { st.cw = clamp(parseFloat(e.target.value) || 40, 15, 150); if ($('#ss-size').value === 'custom') refreshAll(); });
    $('#ss-chh').addEventListener('input', (e) => { st.ch = clamp(parseFloat(e.target.value) || 30, 8, 200); if ($('#ss-size').value === 'custom') refreshAll(); });
    [['#ss-price', 'price'], ['#ss-shop', 'shop'], ['#ss-digits', 'digits'], ['#ss-guides', 'guides']].forEach(([sel, key]) => $(sel).addEventListener('change', (e) => {
      st[key] = e.target.checked; savePrefs();
      if (key === 'shop' && st.shop && !shopName()) window.UI.toast.info('No shop name is set yet. Add it in Settings → Business profile.');
      updateSummary(); schedulePreview();
    }));
    const onFilter = (fn, reset = true) => (e) => { fn(e); applyFilters({ resetTicks: reset }); };
    if ($('#ss-f-bc')) {
      $('#ss-f-bc').addEventListener('change', onFilter((e) => { st.f.bc = e.target.value; }));
      $('#ss-f-sys').addEventListener('change', onFilter((e) => { st.f.sys = e.target.value; }));
      $('#ss-f-prefix').addEventListener('input', onFilter((e) => { st.f.prefix = e.target.value.replace(/\D/g, ''); }));
    }
    $('#ss-f-stock').addEventListener('change', async (e) => {
      st.f.stock = e.target.value;
      if (st.f.stock !== 'any' && !st.stockReady) { renderList(); try { await loadStock(); } catch { window.UI.toast.error('Could not load the stock. Check the connection.'); st.f.stock = 'any'; e.target.value = 'any'; } }
      applyFilters();
    });
    $('#ss-f-cat').addEventListener('change', onFilter((e) => { st.f.cat = e.target.value; }));
    $('#ss-f-q').addEventListener('input', (() => { let t = 0; return (e) => { clearTimeout(t); const v = e.target.value; t = setTimeout(() => { st.f.q = v; applyFilters(); }, 120); }; })());
    if ($('#ss-f-sel')) $('#ss-f-sel').addEventListener('change', onFilter((e) => { st.f.onlySel = e.target.checked; }));
    if ($('#ss-cmode')) {
      $('#ss-cmode').addEventListener('change', async (e) => {
        const sel = e.target;
        if (sel.value === 'stock') { sel.disabled = true; try { await loadStock(); st.cmode = 'stock'; } catch { window.UI.toast.error('Could not load the stock. Stickers stay as typed.'); sel.value = 'manual'; st.cmode = 'manual'; } sel.disabled = false; } else st.cmode = 'manual';
        applyFilters({ resetTicks: false });
      });
      $('#ss-extra').addEventListener('input', (e) => { st.extra = clamp(parseInt(e.target.value, 10) || 0, 0, 20); renderList(); updateSummary(); st.page = 0; schedulePreview(); });
    }

    /* ----- stock (read in parallel batches, cached for a minute) ----- */
    let stockP = null; let stockAt = 0;
    function loadStock(force) {
      if (!force && stockP && Date.now() - stockAt < 60000) return stockP;
      stockAt = Date.now();
      stockP = (async () => {
        const ids = Array.from(new Set(st.rows.filter((r) => !r.e.vid && r.e.pid && !String(r.e.pid).startsWith('tmp_')).map((r) => String(r.e.pid))));
        const branchId = window.AppShell?.getActiveBranchId?.() || undefined; const fresh = new Map();
        const chunks = chunk(ids, 150); let ci = 0;
        await Promise.all(Array.from({ length: Math.min(4, chunks.length) }, async () => {
          while (ci < chunks.length) { const ch = chunks[ci++]; const { data } = await window.Api.get('/products/stock-levels', { ids: ch.join(','), branchId }); Object.entries((data && data.stock) || {}).forEach(([id, v]) => fresh.set(id, v)); }
        }));
        st.rows.forEach((r) => {
          const v = (!r.e.vid && r.e.pid) ? fresh.get(String(r.e.pid)) : null;
          r.stock = v && v.tracked ? Math.round(((Number(v.quantity) || 0) + (Number(v.warehouse) || 0)) * 1000) / 1000 : null; r.lowFlag = !!(v && v.low);
        });
        st.stockReady = true;
        st.rows.forEach(stockOf);
      })();
      stockP.catch(() => { stockP = null; });
      return stockP;
    }

    /* ----- fill mode ----- */
    function renderPick() {
      const el = $('#ss-pick'); if (!st.loaded) { el.innerHTML = '<div class="ss-empty" style="padding:20px">Loading products…</div>'; return; }
      const q = st.fillQuery.trim().toLowerCase();
      const src = q ? st.entries.filter((e) => `${e.name} ${e.sku} ${e.barcode}`.toLowerCase().includes(q)) : st.entries; const list = src.slice(0, 30);
      el.innerHTML = list.length ? list.map((e) => `<button type="button" class="ss-pk${st.fillEntry === e ? ' on' : ''}" data-pk="${e._i}"><span style="min-width:0"><span class="ss-pkn">${esc(e.name)}</span><small>${esc(e.barcode || 'No barcode')}${e.sku ? ' · ' + esc(e.sku) : ''}</small></span><b style="white-space:nowrap">${esc(money(e.price))}</b></button>`).join('') + (src.length > list.length ? `<div class="ss-hint" style="padding:8px 12px">${src.length - list.length} more - type to narrow the search</div>` : '') : '<div class="ss-empty" style="padding:20px">No product matches</div>';
    }
    async function selectFill(e) {
      st.fillEntry = e;
      if (e && !e.barcode && !e.pending && !shelf) { const row = st.rows.find((r) => r.e === e); if (row) await ensurePending([row]); }
      $('#ss-fsel').innerHTML = e ? `Selected: <b>${esc(e.name)}</b> · ${esc(e.barcode || e.pending || 'no barcode')}${!e.barcode && e.pending ? ' (new barcode)' : ''} · ${esc(money(e.price))}` : 'No product chosen yet';
      renderPick(); updateFillTotal(); updateSummary(); st.page = 0; schedulePreview();
    }
    $('#ss-modes').addEventListener('click', (e) => { const b = e.target.closest('[data-mode]'); if (!b || b.dataset.mode === st.mode) return; st.mode = b.dataset.mode; applyMode(); });
    function applyMode() {
      $$('#ss-modes [data-mode]').forEach((b) => b.classList.toggle('on', b.dataset.mode === st.mode));
      $('#ss-fill').hidden = !modeIsFill(); $('#ss-list-wrap').hidden = modeIsFill();
      if (modeIsFill()) { renderPick(); updateFillTotal(); }
      updateSummary(); st.page = 0; schedulePreview();
    }
    $('#ss-fq').addEventListener('input', (e) => { st.fillQuery = e.target.value; renderPick(); });
    $('#ss-fq').addEventListener('keydown', (e) => { if (e.key !== 'Enter') return; e.preventDefault(); const q = st.fillQuery.trim().toLowerCase(); const f = (q ? st.entries.filter((x) => `${x.name} ${x.sku} ${x.barcode}`.toLowerCase().includes(q)) : st.entries)[0]; if (f) selectFill(f); });
    $('#ss-pick').addEventListener('click', (e) => { const b = e.target.closest('[data-pk]'); if (!b) return; const en = st.entries[Number(b.dataset.pk)]; if (en) selectFill(en); });
    const setPages = (n) => { st.pages = clamp(parseInt(n, 10) || 1, 1, st.paper === 'a4' ? MAX_PAGES : MAX_STICKERS); updateFillTotal(); updateSummary(); st.page = 0; schedulePreview(); };
    $('#ss-pages').addEventListener('input', (e) => { const v = parseInt(e.target.value, 10); if (Number.isFinite(v)) setPages(v); });
    $('#ss-pages').addEventListener('blur', (e) => { e.target.value = st.pages; });
    $('#ss-pills').addEventListener('click', (e) => { const c = e.target.closest('[data-pg]'); if (!c) return; setPages(c.dataset.pg); $('#ss-pages').value = st.pages; });

    /* ----- print ----- */
    async function savePending(e) {
      for (let attempt = 0; ; attempt++) {
        try {
          if (e.vid) await window.Api.put(`/products/${e.pid}/variants/${e.vid}`, { barcode: e.pending }); else await window.Api.put(`/products/${e.pid}`, { barcode: e.pending });
          e.barcode = e.pending; e.pending = ''; return;
        } catch (err) {
          const taken = /barcode/i.test(err.message || '') && /(exist|duplicate|already|taken|unique)/i.test(err.message || '');
          if (!taken || attempt >= 2) throw err;
          const used = await cfg.getUsed(true); if (!used) throw err; e.pending = String(window.BarcodeLabels.generateCode(used));
        }
      }
    }
    function printHtml(html) {
      const iframe = document.createElement('iframe'); iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
      document.body.appendChild(iframe); const doc = iframe.contentDocument; doc.open(); doc.write(html); doc.close();
      setTimeout(() => { try { iframe.contentWindow.focus(); iframe.contentWindow.print(); } catch { window.UI.toast.error('Could not open the print window'); } setTimeout(() => iframe.remove(), 60000); }, 350);
    }
    $('#ss-print').addEventListener('click', async () => {
      if (!st.loaded) return; const btn = $('#ss-print');
      if (st.cmode === 'stock' && Date.now() - stockAt > 60000) { try { await loadStock(true); } catch { /* keep last figures */ } }
      let list = parts(); if (!count(list)) { window.UI.toast.error(modeIsFill() ? 'Choose the product to print' : 'Tick at least one product'); return; }
      const pend = Array.from(new Set(list.filter((e) => e && !e.barcode && e.pending)));
      btn.dataset.loading = '1';
      try {
        if (pend.length) {
          const ok = await window.UI.confirmDialog({ title: 'Save new barcodes?', message: `${pend.length} product${pend.length === 1 ? ' has' : 's have'} no barcode. The new barcode${pend.length === 1 ? '' : 's'} on the labels will be saved to the product${pend.length === 1 ? '' : 's'} so the stickers scan at the till.`, confirmText: 'Save and print' });
          if (!ok) return;
          let failed = 0; let n = 0;
          for (const e of pend) { btn.textContent = `Saving barcodes ${++n}/${pend.length}…`; try { await savePending(e); } catch { failed++; e.failed = true; } }
          if (cfg.onSaved) cfg.onSaved();
          if (failed) { window.UI.toast.error(`${failed} product${failed === 1 ? '' : 's'} could not be saved and ${failed === 1 ? 'was' : 'were'} skipped`); list = list.filter((e) => !(e && e.failed)); if (!count(list)) { renderList(); schedulePreview(); return; } }
        }
        btn.textContent = 'Preparing…';
        const D = dims(); const p = planFor(D, list); const real = count(list);
        const { map, defs } = makeMap(list, real > 300);
        const body = chunk(list, D.per).map((pg) => pageHtml(pg, D, p, map, 0.4)).join('');
        const pageCss = st.paper === 'a4' ? '@page{size:A4;margin:0}' : `@page{size:${D.paperW}mm ${D.h}mm;margin:0}`;
        printHtml(`<!doctype html><html><head><meta charset="utf-8"><title>${shelf ? 'Shelf labels' : 'Barcode stickers'}</title><style>${pageCss}html,body{margin:0;padding:0;-webkit-print-color-adjust:exact;print-color-adjust:exact}.sx-sheet{page-break-after:always;break-after:page}.sx-sheet:last-child{page-break-after:auto;break-after:auto}${planCss(D.w, D.h, p, opts().guides)}</style></head><body>${defs}${body}</body></html>`);
      } finally { delete btn.dataset.loading; updateSummary(); }
    });

    /* ----- start: dialog is already on screen; data fills in ----- */
    applyPaper(); applyMode(); updateSummary();
    let entries = [];
    try { entries = await cfg.loadEntries(); } catch { entries = []; }
    if (!modal.isConnected) return;
    if (!entries.length) { window.UI.toast.info('No products to print'); window.UI.closeModal(); return; }
    entries.forEach((e, i) => { e._i = i; });
    st.entries = entries;
    st.rows = entries.map((e, i) => ({ e, i, on: true, vis: true, copies: 1, stock: null, lowFlag: false, state: 'untracked', hay: `${e.name} ${e.sku} ${e.barcode}`.toLowerCase() }));
    st.loaded = true;
    updateBcOptions();
    const pre = cfg.fillPid ? entries.find((e) => String(e.pid) === String(cfg.fillPid)) : null;
    await applyFilters();
    if (pre) await selectFill(pre); else renderPick();
    updateSummary();
    setTimeout(() => { if (modal.isConnected) loadStock().then(() => { if (modal.isConnected) { applyFilters({ resetTicks: false }); } }).catch(() => {}); }, 500);
  }

  window.StickerStudio = { open };
})(window);
