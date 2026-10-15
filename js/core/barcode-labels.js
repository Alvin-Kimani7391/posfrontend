/**
 * barcode-labels.js - generate store barcodes for products that have none, and print barcode STICKERS
 * on the same thermal receipt printer used for receipts (80 mm or 58 mm roll).
 *
 * Public API (window.BarcodeLabels):
 *   generateCode(usedSet)            -> new unique EAN-13 string (prefix 2 = "in-store use", valid check digit)
 *   loadCatalog()                    -> { items, used:Set }   every active product / variant + every barcode already in use
 *   printItems(items, opts?)         -> prints stickers. items = [{ name, barcode, price, copies }]
 *   openPrintDialog({ selectedIds }) -> modal: tick products (all or some), set copies, auto-generate missing, print
 *
 * HOW PRINTING WORKS: same technique as shelf-labels.js - the stickers are written into a hidden #bl-print-area,
 * the page is sized to the roll (@page size 80mm auto, no margins) and window.print() is called. In the print window
 * choose the receipt printer, margins "None", scale 100%. Several stickers can sit side by side across the roll
 * (default 2 across on 80 mm); tear or cut them apart.
 */
(function (window) {
  const esc = (v) => window.UI.escapeHtml(v == null ? '' : v);
  const PREF_KEY = 'barcodeSticker';

  // printable width = paper minus the printer's unprintable edges
  const PAPERS = {
    80: { label: '80 mm receipt roll', paper: 80, printable: 72, perRow: 2 },
    58: { label: '58 mm receipt roll', paper: 58, printable: 48, perRow: 1 },
  };
  const DEFAULT_OPTS = { paper: 80, perRow: 2, height: 26, showPrice: true, showShop: false, guides: true };

  function getOpts() {
    const saved = window.Storage?.getPref?.(PREF_KEY, null) || {};
    const o = { ...DEFAULT_OPTS, ...saved };
    if (!PAPERS[o.paper]) o.paper = 80;
    return o;
  }
  function saveOpts(o) { window.Storage?.setPref?.(PREF_KEY, o); }

  /* ------------------------------------------------------------------ *
   * Code generation
   * ------------------------------------------------------------------ */
  /** Next free in-store EAN-13: "2" + 11-digit running number + check digit. */
  function generateCode(used) {
    let max = 0;
    used.forEach((c) => {
      if (/^2\d{12}$/.test(c) && window.Barcode.isEan13(c)) max = Math.max(max, parseInt(c.slice(1, 12), 10));
    });
    let n = max + 1, code;
    do {
      const body = '2' + String(n).padStart(11, '0');
      code = body + window.Barcode.ean13CheckDigit(body);
      n += 1;
    } while (used.has(code));
    used.add(code);
    return code;
  }

  /* ------------------------------------------------------------------ *
   * Catalog loading (all active products, variants expanded)
   * ------------------------------------------------------------------ */
  async function loadCatalog() {
    const items = []; const used = new Set();
    let page = 1, pages = 1;
    do {
      const { data } = await window.Api.get('/products', { page, limit: 100, status: 'active' });
      (data.items || []).forEach((p) => {
        if (p.barcode) used.add(String(p.barcode).trim());
        (p.variants || []).forEach((v) => { if (v.barcode) used.add(String(v.barcode).trim()); });
        const variants = (p.variants || []).filter((v) => v.status !== 'archived');
        if (p.hasVariants && variants.length) {
          variants.forEach((v) => {
            const attrs = v.attributes && typeof v.attributes === 'object' ? Object.values(v.attributes).join(' / ') : '';
            items.push({
              key: `${p._id}:${v._id}`, productId: p._id, variantId: v._id, product: p,
              name: attrs ? `${p.name} (${attrs})` : p.name, sku: v.sku || p.sku || '',
              barcode: (v.barcode || '').trim(), price: Number(v.sellingPrice) || 0,
            });
          });
        } else {
          items.push({
            key: String(p._id), productId: p._id, variantId: null, product: p,
            name: p.name, sku: p.sku || '', barcode: (p.barcode || '').trim(), price: Number(p.sellingPrice) || 0,
          });
        }
      });
      pages = data.pages || 1; page += 1;
    } while (page <= pages);
    return { items, used };
  }

  /** Save a generated barcode on the product / variant. Retries with a fresh code if the server says it is taken. */
  async function saveGeneratedBarcode(item, used) {
    for (let attempt = 0; attempt < 4; attempt++) {
      const code = generateCode(used);
      try {
        if (item.variantId) {
          await window.Api.put(`/products/${item.productId}/variants/${item.variantId}`, { barcode: code });
        } else {
          try {
            await window.Api.put(`/products/${item.productId}`, { barcode: code });
          } catch (err) {
            if (err.code !== 'VALIDATION_ERROR') throw err;
            // Server wants the full record: resend the essentials with the new barcode.
            const p = item.product;
            const body = { name: p.name, sku: p.sku, barcode: code, costPrice: p.costPrice };
            if (!p.hasVariants) body.sellingPrice = p.sellingPrice;
            await window.Api.put(`/products/${item.productId}`, body);
          }
        }
        item.barcode = code;
        return code;
      } catch (err) {
        const taken = /barcode|duplicate|already|exist|unique/i.test(err.message || '');
        if (!taken || attempt === 3) throw err;
        // code was taken by someone else meanwhile: loop generates the next one
      }
    }
    return null;
  }

  /* ------------------------------------------------------------------ *
   * Printing
   * ------------------------------------------------------------------ */
  function businessName() {
    return window.AppShell?.getBusinessProfile?.()?.name || window.AppShell?.getUser?.()?.businessName || '';
  }

  /** items: [{ name, barcode, price, copies }] -> prints stickers on the receipt roll. */
  function printItems(items, optsIn) {
    const o = { ...getOpts(), ...(optsIn || {}) };
    const paper = PAPERS[o.paper] || PAPERS[80];
    const perRow = Math.min(3, Math.max(1, Number(o.perRow) || paper.perRow));
    const cellW = +(paper.printable / perRow).toFixed(2);
    const height = Math.min(40, Math.max(16, Number(o.height) || 26));

    const cells = [];
    (items || []).forEach((it) => {
      if (!it.barcode) return;
      const n = Math.min(500, Math.max(1, Number(it.copies) || 1));
      for (let i = 0; i < n; i++) cells.push(it);
    });
    if (!cells.length) { window.UI.toast.error('Nothing to print - no products with barcodes selected'); return false; }

    const shop = o.showShop ? businessName() : '';
    let area = document.getElementById('bl-print-area');
    if (!area) { area = document.createElement('div'); area.id = 'bl-print-area'; document.body.appendChild(area); }

    area.innerHTML = `<div class="bl-sheet bl-c${perRow}${o.guides ? ' bl-guides' : ''}" style="--bl-w:${cellW}mm;--bl-h:${height}mm;--bl-cols:${perRow};width:${paper.printable}mm">
      ${cells.map((it) => `<div class="bl-sticker">
        ${shop ? `<div class="bl-shop">${esc(shop)}</div>` : ''}
        <div class="bl-name">${esc(it.name)}</div>
        <div class="bl-bc">${window.Barcode.smartSvg(it.barcode, { fluid: true, height: 40, module: 2, quietLeft: 6, quietRight: 4 })}</div>
        <div class="bl-code">${esc(it.barcode)}</div>
        ${o.showPrice && it.price ? `<div class="bl-price">${window.UI.formatMoney(it.price)}</div>` : ''}
      </div>`).join('')}</div>`;

    document.body.dataset.printMode = 'barcode-stickers';
    const pageStyle = document.createElement('style');
    pageStyle.id = 'bl-page-style';
    pageStyle.textContent = `@page { size: ${paper.paper}mm auto; margin: 0; } @media print { body[data-print-mode] { margin: 0 !important; } }`;
    document.head.appendChild(pageStyle);

    const done = () => {
      window.removeEventListener('afterprint', done);
      document.body.removeAttribute('data-print-mode');
      area.innerHTML = '';
      pageStyle.remove();
    };
    window.addEventListener('afterprint', done);
    setTimeout(() => window.print(), 150);
    return true;
  }

  /* ------------------------------------------------------------------ *
   * Print dialog: pick all / some products, copies each, generate missing codes, print
   * ------------------------------------------------------------------ */
  async function openPrintDialog({ selectedIds = [], onDone } = {}) {
    const modal = window.UI.openModal({
      title: 'Print barcode stickers',
      maxWidth: '760px',
      bodyHtml: '<div class="text-muted" style="padding:var(--space-4)">Loading products…</div>',
      footerHtml: '<span></span>',
    });

    let catalog;
    try { catalog = await loadCatalog(); }
    catch (err) {
      modal.querySelector('.modal-body').innerHTML = `<p>${esc(err.message || 'Could not load products')}</p>`;
      return;
    }
    const { items, used } = catalog;
    if (!items.length) {
      modal.querySelector('.modal-body').innerHTML = '<p>No products yet. Add products first.</p>';
      return;
    }

    const opts = getOpts();
    const pre = new Set((selectedIds || []).map(String));
    const st = {
      search: '',
      sel: new Set(items.filter((i) => !pre.size || pre.has(String(i.productId))).map((i) => i.key)),
      copies: new Map(items.map((i) => [i.key, 1])),
    };
    const missingCount = items.filter((i) => !i.barcode).length;

    const body = modal.querySelector('.modal-body') || modal;
    body.innerHTML = `
      <div class="bl-dlg-top">
        <input class="input" id="bl-search" placeholder="Search product, SKU or barcode" />
        <button class="btn btn-secondary btn-sm" data-act="all">Select all</button>
        <button class="btn btn-secondary btn-sm" data-act="none">Clear</button>
        <button class="btn btn-secondary btn-sm" data-act="missing" ${missingCount ? '' : 'disabled'}>No barcode yet (${missingCount})</button>
        <label class="bl-dlg-inline">All copies <input class="input" id="bl-copies-all" type="number" min="1" max="500" value="1" style="width:70px" />
          <button class="btn btn-secondary btn-sm" data-act="apply-copies">Apply</button></label>
      </div>
      <div class="table-wrap" style="max-height:300px;overflow:auto;margin:var(--space-3) 0">
        <table class="table"><thead><tr><th style="width:36px"><input type="checkbox" id="bl-chk-all" /></th><th>Product</th><th>Barcode</th><th style="width:90px">Copies</th></tr></thead>
        <tbody id="bl-body"></tbody></table>
      </div>
      <div class="bl-dlg-opts">
        <label>Paper <select class="select" id="bl-paper">${Object.entries(PAPERS).map(([k, v]) => `<option value="${k}" ${+k === +opts.paper ? 'selected' : ''}>${v.label}</option>`).join('')}</select></label>
        <label>Stickers across <select class="select" id="bl-perrow">${[1, 2, 3].map((n) => `<option value="${n}" ${n === +opts.perRow ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
        <label>Sticker height <select class="select" id="bl-height">${[[20, 'Small 20 mm'], [26, 'Normal 26 mm'], [32, 'Tall 32 mm']].map(([v, l]) => `<option value="${v}" ${+opts.height === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      </div>
      <div class="bl-dlg-checks">
        <label class="checkbox-row"><input type="checkbox" id="bl-price" ${opts.showPrice ? 'checked' : ''} /> <span class="text-sm">Show price</span></label>
        <label class="checkbox-row"><input type="checkbox" id="bl-shop" ${opts.showShop ? 'checked' : ''} /> <span class="text-sm">Show shop name</span></label>
        <label class="checkbox-row"><input type="checkbox" id="bl-guides" ${opts.guides ? 'checked' : ''} /> <span class="text-sm">Cut guides</span></label>
        <label class="checkbox-row"><input type="checkbox" id="bl-auto" checked /> <span class="text-sm">Generate a barcode for products that have none (saved to the product)</span></label>
      </div>
      <div class="text-xs text-muted" style="margin-top:var(--space-2)">In the print window choose your receipt printer, margins <b>None</b>, scale <b>100%</b>. Generated codes are standard EAN-13 and scan at the till.</div>`;

    const foot = modal.querySelector('.modal-footer');
    foot.innerHTML = `<span class="text-sm text-secondary" id="bl-summary" style="margin-right:auto"></span>
      <button class="btn btn-secondary" data-act="cancel">Cancel</button>
      <button class="btn btn-primary" id="bl-print-btn">${window.Icons.get('printer')} Print stickers</button>`;

    const $ = (sel) => modal.querySelector(sel);
    const visible = () => items.filter((i) => !st.search ||
      i.name.toLowerCase().includes(st.search) || i.sku.toLowerCase().includes(st.search) || i.barcode.includes(st.search));

    function renderBody() {
      const rows = visible();
      $('#bl-body').innerHTML = rows.map((i) => `<tr>
        <td><input type="checkbox" data-k="${esc(i.key)}" ${st.sel.has(i.key) ? 'checked' : ''} /></td>
        <td>${esc(i.name)}<div class="text-xs text-muted">${esc(i.sku)}</div></td>
        <td class="text-sm">${i.barcode ? esc(i.barcode) : '<span class="badge badge-warning">will be generated</span>'}</td>
        <td><input class="input" type="number" min="1" max="500" data-c="${esc(i.key)}" value="${st.copies.get(i.key)}" style="width:76px;height:34px" /></td>
      </tr>`).join('') || '<tr><td colspan="4" class="text-muted" style="padding:var(--space-4)">No matching products.</td></tr>';
      $('#bl-chk-all').checked = rows.length > 0 && rows.every((i) => st.sel.has(i.key));
      updateSummary();
    }
    function updateSummary() {
      const chosen = items.filter((i) => st.sel.has(i.key));
      const stickers = chosen.reduce((n, i) => n + (Number(st.copies.get(i.key)) || 1), 0);
      const newCodes = chosen.filter((i) => !i.barcode).length;
      $('#bl-summary').textContent = `${chosen.length} products · ${stickers} stickers${newCodes ? ` · ${newCodes} new barcodes` : ''}`;
    }

    modal.addEventListener('change', (e) => {
      const t = e.target;
      if (t.dataset.k) { t.checked ? st.sel.add(t.dataset.k) : st.sel.delete(t.dataset.k); $('#bl-chk-all').checked = visible().every((i) => st.sel.has(i.key)); updateSummary(); }
      else if (t.dataset.c) { const v = Math.min(500, Math.max(1, parseInt(t.value, 10) || 1)); st.copies.set(t.dataset.c, v); t.value = v; updateSummary(); }
      else if (t.id === 'bl-chk-all') { visible().forEach((i) => (t.checked ? st.sel.add(i.key) : st.sel.delete(i.key))); renderBody(); }
      else if (t.id === 'bl-paper') { const p = PAPERS[t.value]; $('#bl-perrow').value = String(p.perRow); }
    });
    $('#bl-search').addEventListener('input', window.UI.debounce((e) => { st.search = e.target.value.trim().toLowerCase(); renderBody(); }));
    modal.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (!act) return;
      if (act === 'all') { visible().forEach((i) => st.sel.add(i.key)); renderBody(); }
      else if (act === 'none') { st.sel.clear(); renderBody(); }
      else if (act === 'missing') { st.sel.clear(); items.filter((i) => !i.barcode).forEach((i) => st.sel.add(i.key)); renderBody(); }
      else if (act === 'apply-copies') {
        const v = Math.min(500, Math.max(1, parseInt($('#bl-copies-all').value, 10) || 1));
        items.forEach((i) => st.copies.set(i.key, v)); renderBody();
      } else if (act === 'cancel') window.UI.closeModal();
    });

    $('#bl-print-btn').addEventListener('click', async () => {
      const chosen = items.filter((i) => st.sel.has(i.key));
      if (!chosen.length) { window.UI.toast.error('Select at least one product'); return; }
      const o = {
        paper: +$('#bl-paper').value, perRow: +$('#bl-perrow').value, height: +$('#bl-height').value,
        showPrice: $('#bl-price').checked, showShop: $('#bl-shop').checked, guides: $('#bl-guides').checked,
      };
      saveOpts(o);
      const btn = $('#bl-print-btn');
      const missing = chosen.filter((i) => !i.barcode);
      let failed = 0;
      if (missing.length && $('#bl-auto').checked) {
        window.UI.setButtonLoading(btn, true, `Creating barcodes 0/${missing.length}…`);
        for (let n = 0; n < missing.length; n++) {
          try { await saveGeneratedBarcode(missing[n], used); } catch { failed += 1; }
          btn.innerHTML = `<span class="spinner"></span> Creating barcodes ${n + 1}/${missing.length}…`;
        }
        window.UI.setButtonLoading(btn, false);
        renderBody();
      }
      const printable = chosen.filter((i) => i.barcode).map((i) => ({ name: i.name, barcode: i.barcode, price: i.price, copies: st.copies.get(i.key) }));
      const skipped = chosen.length - printable.length;
      if (failed) window.UI.toast.warning(`${failed} product${failed === 1 ? '' : 's'} could not get a barcode and were skipped`);
      else if (skipped) window.UI.toast.warning(`${skipped} product${skipped === 1 ? ' has' : 's have'} no barcode and ${skipped === 1 ? 'was' : 'were'} skipped`);
      if (printNow(printable, o)) { window.UI.closeModal(); if (onDone) onDone(); }
    });

    function printNow(list, o) { return printItems(list, o); }
    renderBody();
  }

  window.BarcodeLabels = { generateCode, loadCatalog, printItems, openPrintDialog, getOpts, saveOpts, PAPERS };
})(window);