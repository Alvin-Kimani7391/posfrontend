/**
 * product-export.js - "Export products" wizard (Excel .xlsx / CSV) with full control:
 *   - choose WHICH columns go into the sheet (opening stock, prices, brand ... each one can be left out)
 *   - choose WHICH products: all / by category / hand-picked / the ones ticked in the table
 *   - extra filters: status, search text, stock level
 * Also exposes a small styled-.xlsx writer (ProductExport.xlsxBlob) that the import wizard reuses.
 *
 *   ProductExport.open({ selectedIds: [..] })
 */
(function (window) {
  const esc = (s) => window.UI.escapeHtml(s == null ? '' : String(s));
  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

  /* ---------- field catalogue (key, label, group, getter). "imp" = column the Import wizard understands ---------- */
  const FIELDS = [
    { k: 'name', l: 'Name', g: 'Basic details', imp: 1, get: (r) => r.name },
    { k: 'sku', l: 'SKU', g: 'Basic details', imp: 1, get: (r) => r.sku },
    { k: 'barcode', l: 'Barcode', g: 'Basic details', imp: 1, get: (r) => r.barcode },
    { k: 'category', l: 'Category', g: 'Basic details', imp: 1, get: (r) => r.category },
    { k: 'brand', l: 'Brand', g: 'Basic details', imp: 1, get: (r) => r.brand },
    { k: 'unit', l: 'Unit', g: 'Basic details', imp: 1, get: (r) => r.unit },
    { k: 'description', l: 'Description', g: 'Basic details', imp: 1, get: (r) => r.description },
    { k: 'image', l: 'Image URL', g: 'Basic details', imp: 1, get: (r) => r.image },
    { k: 'cost', l: 'Cost price', g: 'Pricing', imp: 1, get: (r) => r.cost },
    { k: 'price', l: 'Selling price', g: 'Pricing', imp: 1, get: (r) => r.price },
    { k: 'tax', l: 'Tax rate %', g: 'Pricing', imp: 1, get: (r) => r.tax },
    { k: 'discount', l: 'Default discount', g: 'Pricing', get: (r) => r.discount },
    { k: 'wprice', l: 'Wholesale price', g: 'Pricing', get: (r) => r.wprice },
    { k: 'moq', l: 'Wholesale min qty', g: 'Pricing', get: (r) => r.moq },
    { k: 'reorder', l: 'Reorder level', g: 'Stock', imp: 1, get: (r) => r.reorder },
    { k: 'stock', l: 'Opening stock', g: 'Stock', imp: 1, stock: 1, get: (r) => r.stock },
    { k: 'wh', l: 'Warehouse stock', g: 'Stock', stock: 1, get: (r) => r.wh },
    { k: 'costval', l: 'Stock value (cost)', g: 'Stock', stock: 1, get: (r) => (r.stock === '' ? '' : Math.round(num(r.stock) * num(r.cost) * 100) / 100) },
    { k: 'retailval', l: 'Stock value (retail)', g: 'Stock', stock: 1, get: (r) => (r.stock === '' ? '' : Math.round(num(r.stock) * num(r.price) * 100) / 100) },
    { k: 'trackBatch', l: 'Track batch', g: 'Batch & expiry', imp: 1, get: (r) => (r.trackBatch ? 'Yes' : 'No') },
    { k: 'trackExpiry', l: 'Track expiry', g: 'Batch & expiry', imp: 1, get: (r) => (r.trackExpiry ? 'Yes' : 'No') },
    { k: 'batchNo', l: 'Batch number', g: 'Batch & expiry', imp: 1, batch: 1, get: (r) => r.batchNo },
    { k: 'expiry', l: 'Expiry date', g: 'Batch & expiry', imp: 1, batch: 1, get: (r) => r.expiry },
    { k: 'serial', l: 'Track serial numbers', g: 'Batch & expiry', get: (r) => (r.serial ? 'Yes' : 'No') },
    { k: 'status', l: 'Status', g: 'Other', get: (r) => r.status },
    { k: 'variants', l: 'Variants', g: 'Other', get: (r) => r.variants },
    { k: 'created', l: 'Date added', g: 'Other', get: (r) => r.created },
  ];
  const PRESETS = {
    all: { label: 'Everything', keys: () => FIELDS.map((f) => f.k) },
    import: { label: 'Import-ready (re-importable)', keys: () => FIELDS.filter((f) => f.imp).map((f) => f.k) },
    nostock: { label: 'Import-ready, no stock', keys: () => FIELDS.filter((f) => f.imp && !f.stock && !f.batch).map((f) => f.k) },
    tracked: { label: 'Batch / expiry list', keys: () => ['name', 'sku', 'barcode', 'category', 'unit', 'cost', 'price', 'stock', 'trackBatch', 'trackExpiry', 'batchNo', 'expiry'] },
    price: { label: 'Price list', keys: () => ['name', 'sku', 'barcode', 'category', 'unit', 'price'] },
    none: { label: 'Clear all', keys: () => [] },
  };

  /* ---------- styled .xlsx writer (stored zip, inline strings, header style, freeze row, autofilter) ---------- */
  const CRC = (() => { const t = []; for (let n = 0; n < 256; n += 1) { let c = n; for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = (b) => { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i += 1) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  function zip(files) {
    const enc = new TextEncoder(), parts = [], central = []; let off = 0;
    for (const [name, text] of files) {
      const nb = enc.encode(name), d = enc.encode(text), crc = crc32(d);
      const lh = new DataView(new ArrayBuffer(30)); lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint32(14, crc, true); lh.setUint32(18, d.length, true); lh.setUint32(22, d.length, true); lh.setUint16(26, nb.length, true);
      const ch = new DataView(new ArrayBuffer(46)); ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint32(16, crc, true); ch.setUint32(20, d.length, true); ch.setUint32(24, d.length, true); ch.setUint16(28, nb.length, true); ch.setUint32(42, off, true);
      parts.push(new Uint8Array(lh.buffer), nb, d); central.push(new Uint8Array(ch.buffer), nb); off += 30 + nb.length + d.length;
    }
    const csz = central.reduce((s, x) => s + x.length, 0);
    const end = new DataView(new ArrayBuffer(22)); end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true); end.setUint32(12, csz, true); end.setUint32(16, off, true);
    return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }
  const colName = (i) => { let s = ''; i += 1; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
  const xe = (s) => String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  /** rows: array of arrays (first = header). Returns an .xlsx Blob. */
  function xlsxBlob(rows, { sheetName = 'Products' } = {}) {
    const cols = rows[0] ? rows[0].length : 1;
    const widths = Array.from({ length: cols }, (_, c) => Math.min(48, Math.max(11, ...rows.slice(0, 200).map((r) => String(r[c] == null ? '' : r[c]).length + 2))));
    const body = rows.map((r, ri) => `<row r="${ri + 1}">${r.map((v, ci) => {
      const ref = `${colName(ci)}${ri + 1}`;
      if (v === '' || v == null) return '';
      if (ri > 0 && typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}"><v>${v}</v></c>`;
      return `<c r="${ref}" t="inlineStr"${ri === 0 ? ' s="1"' : ''}><is><t xml:space="preserve">${xe(v)}</t></is></c>`;
    }).join('')}</row>`).join('');
    const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols><sheetData>${body}</sheetData><autoFilter ref="A1:${colName(cols - 1)}${Math.max(1, rows.length)}"/></worksheet>`;
    const styles = '<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1F2937"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs></styleSheet>';
    return zip([
      ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>'],
      ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
      ['xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${xe(sheetName).slice(0, 31)}" sheetId="1" r:id="rId1"/></sheets></workbook>`],
      ['xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'],
      ['xl/styles.xml', styles],
      ['xl/worksheets/sheet1.xml', sheet],
    ]);
  }
  function csvBlob(rows) {
    const q = (v) => { const s = v == null ? '' : String(v); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    return new Blob(['﻿' + rows.map((r) => r.map(q).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
  }
  function download(blob, name) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  }

  /* ---------- data loading ---------- */
  async function fetchAll(status) {
    const out = []; let page = 1, pages = 1;
    do {
      const { data } = await window.Api.get('/products', { page, limit: 100, status: status || undefined });
      out.push(...(data.items || [])); pages = data.pages || 1; page += 1;
    } while (page <= pages && page <= 300);
    return out;
  }
  async function fetchStock(ids, branchId, onProgress) {
    const map = new Map(); const chunks = []; for (let i = 0; i < ids.length; i += 150) chunks.push(ids.slice(i, i + 150));
    let ci = 0, done = 0;
    await Promise.all(Array.from({ length: Math.min(4, chunks.length) }, async () => {
      while (ci < chunks.length) {
        const ch = chunks[ci++];
        const { data } = await window.Api.get('/products/stock-levels', { ids: ch.join(','), branchId });
        Object.entries((data && data.stock) || {}).forEach(([id, v]) => map.set(id, v));
        done += 1; if (onProgress) onProgress(done, chunks.length);
      }
    }));
    return map;
  }
  /** every active batch of the branch, grouped by product id: Map(productId -> [{no, expiry, qty, vid}]) */
  async function fetchBatches(branchId) {
    const map = new Map(); let page = 1, pages = 1;
    do {
      const { data } = await window.Api.get('/batches', { branchId, status: 'active', page, limit: 100 });
      (data.items || data.batches || []).forEach((b) => {
        const pid = String((b.productId && b.productId._id) || b.productId || ''); if (!pid || !(Number(b.quantity) > 0)) return;
        const a = map.get(pid) || []; a.push({ no: b.batchNumber || '', expiry: b.expiryDate ? String(b.expiryDate).slice(0, 10) : '', qty: Number(b.quantity) || 0, vid: b.variantId ? String(b.variantId._id || b.variantId) : '' }); map.set(pid, a);
      });
      pages = data.pages || 1; page += 1;
    } while (page <= pages && page <= 300);
    map.forEach((a) => a.sort((x, y) => (x.expiry || '9999').localeCompare(y.expiry || '9999')));
    return map;
  }
  /** one flat record per product (variants optionally as their own rows) */
  function flatten(p, expandVariants) {
    const base = {
      id: p._id, name: p.name || '', sku: p.sku || '', barcode: p.barcode || '', category: p.categoryId ? (p.categoryId.name || '') : '', categoryId: p.categoryId ? (p.categoryId._id || p.categoryId) : '',
      brand: p.brand || '', unit: p.unit || '', description: p.description || '', image: p.image || p.imageUrl || '',
      cost: p.costPrice == null ? '' : num(p.costPrice), price: p.sellingPrice == null ? '' : num(p.sellingPrice), tax: p.taxRate == null ? '' : num(p.taxRate),
      discount: num(p.defaultDiscount) || '', wprice: num(p.wholesalePrice) || '', moq: num(p.moq) || '', reorder: p.lowStockThreshold == null ? '' : num(p.lowStockThreshold),
      trackBatch: !!(p.trackBatch || p.trackExpiry), trackExpiry: !!p.trackExpiry, serial: !!p.trackSerialNumber, batchNo: '', expiry: '', status: p.status || '', created: p.createdAt ? String(p.createdAt).slice(0, 10) : '', variants: p.hasVariants ? (p.variants || []).length : '', stock: '', wh: '', hasVariants: !!p.hasVariants,
    };
    if (p.hasVariants && expandVariants && (p.variants || []).length) {
      return p.variants.map((v) => ({
        ...base, name: `${base.name}${(v.name || v.label) ? ` - ${v.name || v.label}` : ''}`, sku: v.sku || base.sku, barcode: v.barcode || '',
        price: v.sellingPrice == null ? base.price : num(v.sellingPrice), cost: v.costPrice == null ? base.cost : num(v.costPrice), variants: '', _variant: true, _vid: v._id,
      }));
    }
    return [base];
  }

  /* ---------- UI ---------- */
  function open({ selectedIds = [] } = {}) {
    const branchId = (window.AppShell && window.AppShell.getActiveBranchId && window.AppShell.getActiveBranchId()) || undefined;
    const S = {
      products: [], archived: null, stock: null, loaded: false,
      scope: selectedIds.length ? 'selected' : 'all', cats: new Set(), picked: new Set(selectedIds), pickSearch: '',
      status: 'active', search: '', stockFilter: '', trackFilter: '', batches: null, perBatch: true, variants: true, cols: new Set(PRESETS.import.keys()), busy: false,
    };
    const modal = window.UI.openModal({
      title: 'Export products', maxWidth: '1100px',
      bodyHtml: '<div class="pio" data-x="root"><div class="pio-note">Loading your products…</div></div>',
      footerHtml: '<span class="pio-foot-l" data-x="sum"></span><button type="button" class="btn btn-secondary" data-x="close">Close</button><button type="button" class="btn btn-secondary" data-x="csv" disabled>Download CSV</button><button type="button" class="btn btn-primary" data-x="xlsx" disabled>Download Excel</button>',
    });
    const $ = (k) => modal.querySelector(`[data-x="${k}"]`);
    $('close').addEventListener('click', () => modal.closest('.modal-backdrop')?.querySelector('.modal-close')?.click());

    const pool = () => (S.status === 'archived' ? (S.archived || []) : S.status === 'all' ? [...S.products, ...(S.archived || [])] : S.products);
    const stockOf = (p) => (S.stock ? S.stock.get(String(p._id)) : null);
    function matching() {
      const q = S.search.trim().toLowerCase();
      return pool().filter((p) => {
        if (S.scope === 'category' && S.cats.size && !S.cats.has(p.categoryId ? (p.categoryId._id || p.categoryId) : '__none')) return false;
        if (S.scope === 'category' && !S.cats.size) return false;
        if (S.scope === 'pick' && !S.picked.has(p._id)) return false;
        if (S.scope === 'selected' && !S.picked.has(p._id)) return false;
        if (q && !`${p.name} ${p.sku} ${p.barcode}`.toLowerCase().includes(q)) return false;
        if (S.trackFilter) {
          const b = !!(p.trackBatch || p.trackExpiry), x = !!p.trackExpiry;
          if (S.trackFilter === 'batch' && !b) return false;
          if (S.trackFilter === 'expiry' && !x) return false;
          if (S.trackFilter === 'either' && !(b || x)) return false;
          if (S.trackFilter === 'both' && !(b && x)) return false;
          if (S.trackFilter === 'none' && (b || x)) return false;
        }
        if (S.stockFilter && S.stock) {
          const st = stockOf(p); const qty = st && st.tracked ? num(st.quantity) : null;
          if (S.stockFilter === 'out' && !(qty !== null && qty <= 0)) return false;
          if (S.stockFilter === 'in' && !(qty !== null && qty > 0)) return false;
          if (S.stockFilter === 'low' && !(qty !== null && qty > 0 && p.lowStockThreshold != null && qty <= num(p.lowStockThreshold))) return false;
          if (S.stockFilter === 'untracked' && qty !== null) return false;
        }
        return true;
      });
    }
    const colsOrdered = () => FIELDS.filter((f) => S.cols.has(f.k));
    const needBatches = () => colsOrdered().some((f) => f.batch);
    const needStock = () => colsOrdered().some((f) => f.stock) || !!S.stockFilter;

    const catList = () => {
      const m = new Map();
      pool().forEach((p) => { const id = p.categoryId ? (p.categoryId._id || p.categoryId) : '__none'; const nm = p.categoryId ? p.categoryId.name : 'Uncategorized'; const e = m.get(id) || { id, name: nm, n: 0 }; e.n += 1; m.set(id, e); });
      return [...m.values()].sort((a, b) => a.name.localeCompare(b.name));
    };

    function render() {
      const root = $('root'); if (!root) return;
      const list = matching();
      const focus = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.x : null;
      const chip = (on, attrs, text, extra = '') => `<label class="pio-chip ${on ? 'on' : ''}"><input type="checkbox" ${on ? 'checked' : ''} ${attrs}/> ${text}${extra}</label>`;
      const groups = [...new Set(FIELDS.map((f) => f.g))];
      const pickPool = pool().filter((p) => { const q = S.pickSearch.trim().toLowerCase(); return !q || `${p.name} ${p.sku} ${p.barcode}`.toLowerCase().includes(q); });
      root.innerHTML = `
      <div class="pio-grid">
        <div class="pio-card"><h4>1 · Which products?<span class="pio-sub">${list.length} match</span></h4>
          <div class="pio-row" style="margin-bottom:10px">
            ${[['all', 'All products'], ['category', 'By category'], ['pick', 'Pick products'], ...(selectedIds.length ? [['selected', `Ticked in table (${selectedIds.length})`]] : [])]
              .map(([v, t]) => `<label class="pio-chip ${S.scope === v ? 'on' : ''}"><input type="radio" name="pio-scope" value="${v}" ${S.scope === v ? 'checked' : ''} data-x="scope"/> ${t}</label>`).join('')}
          </div>
          ${S.scope === 'category' ? `<div class="pio-row" style="margin-bottom:6px"><button type="button" class="btn btn-ghost btn-sm" data-x="cat-all">Select all</button><button type="button" class="btn btn-ghost btn-sm" data-x="cat-none">Clear</button></div>
            <div class="pio-list">${catList().map((c) => `<label><input type="checkbox" data-x="cat" value="${esc(c.id)}" ${S.cats.has(c.id) ? 'checked' : ''}/> <span class="pio-grow">${esc(c.name)}</span><span class="pio-sub">${c.n}</span></label>`).join('') || '<div class="pio-note">No categories</div>'}</div>` : ''}
          ${S.scope === 'pick' ? `<input class="input" data-x="pick-q" placeholder="Search name, SKU or barcode" value="${esc(S.pickSearch)}" style="margin-bottom:6px"/>
            <div class="pio-row" style="margin-bottom:6px"><button type="button" class="btn btn-ghost btn-sm" data-x="pick-all">Tick all shown (${pickPool.length})</button><button type="button" class="btn btn-ghost btn-sm" data-x="pick-none">Clear (${S.picked.size} ticked)</button></div>
            <div class="pio-list">${pickPool.slice(0, 300).map((p) => `<label><input type="checkbox" data-x="pick" value="${esc(p._id)}" ${S.picked.has(p._id) ? 'checked' : ''}/> <span class="pio-grow">${esc(p.name)}</span><span class="pio-sub">${esc(p.sku || '')}</span></label>`).join('') || '<div class="pio-note">No products</div>'}${pickPool.length > 300 ? '<div class="pio-note">Showing first 300 - refine the search</div>' : ''}</div>` : ''}
          ${S.scope === 'selected' ? '<div class="pio-note">Exporting the products you ticked in the table.</div>' : ''}
          <div class="pio-row" style="margin-top:10px">
            <select class="select" data-x="status" style="max-width:170px"><option value="active" ${S.status === 'active' ? 'selected' : ''}>Active products</option><option value="archived" ${S.status === 'archived' ? 'selected' : ''}>Archived products</option><option value="all" ${S.status === 'all' ? 'selected' : ''}>Active + archived</option></select>
            <select class="select" data-x="stockf" style="max-width:190px"><option value="">Any stock level</option><option value="in" ${S.stockFilter === 'in' ? 'selected' : ''}>In stock</option><option value="low" ${S.stockFilter === 'low' ? 'selected' : ''}>Low stock</option><option value="out" ${S.stockFilter === 'out' ? 'selected' : ''}>Out of stock</option><option value="untracked" ${S.stockFilter === 'untracked' ? 'selected' : ''}>Stock not tracked</option></select>
            <input class="input" data-x="search" placeholder="Name / SKU contains…" value="${esc(S.search)}" style="flex:1;min-width:140px"/>
          </div>
          <div class="pio-row" style="margin-top:10px"><select class="select" data-x="trackf" style="max-width:260px" aria-label="Batch and expiry tracking"><option value="">Any batch / expiry tracking</option><option value="either" ${S.trackFilter === 'either' ? 'selected' : ''}>Batch OR expiry tracked</option><option value="both" ${S.trackFilter === 'both' ? 'selected' : ''}>Batch AND expiry tracked</option><option value="batch" ${S.trackFilter === 'batch' ? 'selected' : ''}>Batch tracked (incl. expiry)</option><option value="expiry" ${S.trackFilter === 'expiry' ? 'selected' : ''}>Expiry tracked</option><option value="none" ${S.trackFilter === 'none' ? 'selected' : ''}>Not tracked</option></select></div>
          <label class="pio-sw" style="margin-top:10px"><input type="checkbox" data-x="variants" ${S.variants ? 'checked' : ''}/> Put each variant on its own row</label><br>
          <label class="pio-sw" style="margin-top:6px"><input type="checkbox" data-x="perbatch" ${S.perBatch ? 'checked' : ''}/> One row per batch (batch number, expiry and quantity of each batch)</label>
        </div>
        <div class="pio-card"><h4>2 · Which columns?<span class="pio-sub">${S.cols.size} of ${FIELDS.length}</span></h4>
          <div class="pio-row" style="margin-bottom:10px">${Object.entries(PRESETS).map(([k, p]) => `<button type="button" class="btn btn-ghost btn-sm" data-x="preset" data-k="${k}">${p.label}</button>`).join('')}</div>
          ${groups.map((g) => `<div class="pio-group"><div class="pio-group-t">${g}</div><div class="pio-row">${FIELDS.filter((f) => f.g === g).map((f) => chip(S.cols.has(f.k), `data-x="col" value="${f.k}"`, esc(f.l), f.imp ? '' : ' <small>(extra)</small>')).join('')}</div></div>`).join('')}
          <div class="pio-sub">Untick <b>Opening stock</b> (and the other stock columns) to leave the whole stock section out. "Extra" columns are for your reports - the Import wizard ignores them.</div>
        </div>
      </div>
      <div class="pio-card"><h4>Preview<span class="pio-sub">first ${Math.min(6, list.length)} of ${list.length}</span></h4>
        ${S.cols.size && list.length ? `<div class="pio-tablewrap" style="max-height:200px"><table class="pio-table"><thead><tr>${colsOrdered().map((f) => `<th>${esc(f.l)}</th>`).join('')}</tr></thead><tbody>${list.slice(0, 6).flatMap((p) => flatten(p, S.variants)).slice(0, 6).map((r) => `<tr>${colsOrdered().map((f) => `<td>${(f.stock && !S.stock) || (f.batch && !S.batches) ? '<span class="pio-sub">loaded on export</span>' : esc(f.get(r))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>` : '<div class="pio-note warn">Choose at least one column and one product to see a preview.</div>'}
      </div>`;
      const ok = S.cols.size > 0 && list.length > 0 && !S.busy;
      $('xlsx').disabled = !ok; $('csv').disabled = !ok;
      $('sum').textContent = `${list.length} product${list.length === 1 ? '' : 's'} · ${S.cols.size} column${S.cols.size === 1 ? '' : 's'}`;
      if (focus) { const el = root.querySelector(`[data-x="${focus}"]`); if (el && (el.tagName === 'INPUT' && el.type === 'text' || el.classList.contains('input'))) { el.focus(); try { el.setSelectionRange(el.value.length, el.value.length); } catch { /* ignore */ } } }
    }

    async function ensure() {
      if (S.status !== 'active' && !S.archived) { try { S.archived = await fetchAll('archived'); } catch { S.archived = []; window.UI.toast.error('Could not load archived products'); } }
      if (needBatches() && !S.batches) {
        if (!branchId) { S.batches = new Map(); window.UI.toast.warning('Select a branch at the top of the page to include batch numbers and expiry dates.'); }
        else { S.busy = true; $('sum').textContent = 'Loading batches…'; try { S.batches = await fetchBatches(branchId); } catch { S.batches = new Map(); window.UI.toast.error('Could not load batches'); } S.busy = false; }
      }
      if (needStock() && !S.stock) {
        S.busy = true; $('sum').textContent = 'Loading stock levels…';
        try { S.stock = await fetchStock([...pool()].map((p) => String(p._id)), branchId); } catch { window.UI.toast.error('Could not load stock levels'); S.stock = new Map(); }
        S.busy = false;
      }
    }

    const root = $('root');
    root.addEventListener('change', async (e) => {
      const t = e.target, k = t.dataset.x;
      if (k === 'scope') S.scope = t.value;
      else if (k === 'cat') { t.checked ? S.cats.add(t.value) : S.cats.delete(t.value); }
      else if (k === 'pick') { t.checked ? S.picked.add(t.value) : S.picked.delete(t.value); }
      else if (k === 'status') { S.status = t.value; S.stock = null; S.cats.clear(); }
      else if (k === 'stockf') S.stockFilter = t.value;
      else if (k === 'variants') S.variants = t.checked;
      else if (k === 'trackf') S.trackFilter = t.value;
      else if (k === 'perbatch') S.perBatch = t.checked;
      else if (k === 'col') { t.checked ? S.cols.add(t.value) : S.cols.delete(t.value); }
      else return;
      await ensure(); render();
    });
    root.addEventListener('input', (e) => {
      const k = e.target.dataset.x;
      if (k === 'search') { S.search = e.target.value; render(); } else if (k === 'pick-q') { S.pickSearch = e.target.value; render(); }
    });
    root.addEventListener('click', async (e) => {
      const b = e.target.closest('button[data-x]'); if (!b) return; const k = b.dataset.x;
      if (k === 'preset') { S.cols = new Set(PRESETS[b.dataset.k].keys()); await ensure(); }
      else if (k === 'cat-all') catList().forEach((c) => S.cats.add(c.id));
      else if (k === 'cat-none') S.cats.clear();
      else if (k === 'pick-all') { const q = S.pickSearch.trim().toLowerCase(); pool().filter((p) => !q || `${p.name} ${p.sku} ${p.barcode}`.toLowerCase().includes(q)).forEach((p) => S.picked.add(p._id)); }
      else if (k === 'pick-none') S.picked.clear();
      render();
    });

    async function doExport(kind) {
      S.busy = true; render();
      try {
        await ensure();
        const list = matching(); const cols = colsOrdered();
        const rows = [cols.map((c) => c.l)];
        list.forEach((p) => {
          const st = stockOf(p);
          flatten(p, S.variants).forEach((r) => {
            if (!r._variant && st && st.tracked) { r.stock = num(st.quantity); r.wh = num(st.warehouse); }
            const bs = needBatches() && S.batches ? (S.batches.get(String(p._id)) || []).filter((b) => (r._variant ? b.vid === String(r._vid) : !b.vid)) : [];
            const out = S.perBatch && bs.length ? bs.map((b) => ({ ...r, batchNo: b.no, expiry: b.expiry, stock: b.qty })) : [{ ...r, batchNo: bs[0] ? bs[0].no : '', expiry: bs[0] ? bs[0].expiry : '' }];
            out.forEach((o) => rows.push(cols.map((c) => { const v = c.get(o); return v == null ? '' : v; })));
          });
        });
        const stamp = new Date().toISOString().slice(0, 10);
        download(kind === 'csv' ? csvBlob(rows) : xlsxBlob(rows), `products-${stamp}.${kind === 'csv' ? 'csv' : 'xlsx'}`);
        window.UI.toast.success(`Exported ${rows.length - 1} row(s) with ${cols.length} column(s)`);
      } catch (err) { window.UI.toast.error(err.message || 'Export failed'); }
      S.busy = false; render();
    }
    $('xlsx').addEventListener('click', () => doExport('xlsx'));
    $('csv').addEventListener('click', () => doExport('csv'));

    (async () => {
      try { S.products = await fetchAll(); } catch (err) { $('root').innerHTML = `<div class="pio-note bad">${esc(err.message || 'Could not load products')}</div>`; return; }
      S.loaded = true; await ensure(); render();
    })();
  }

  window.ProductExport = { open, xlsxBlob, csvBlob, download, FIELDS };
})(window);




