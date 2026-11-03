/**
 * product-import.js - "Import products from Excel" wizard for EVERY business type.
 * Reads .xlsx / .csv in the browser (no library needed; .xls loads SheetJS from a CDN as a fallback), checks the
 * rows with the EXISTING backend endpoint POST /api/v1/shop/import (dryRun first), then saves them in chunks.
 * No backend change: that endpoint is available to all business types (permission shop.import).
 *
 *   ProductImport.open({ onDone: () => reloadList() })
 */
(function (window) {
  const MAX_ROWS = 2000;            // backend limit per import (IMPORT_MAX_ROWS)
  const CHUNK_ROWS = 300;           // rows per request
  const CHUNK_BYTES = 600 * 1024;   // backend JSON body limit is 1 MB
  const HEADERS = ['Name', 'SKU', 'Barcode', 'Category', 'Brand', 'Unit', 'Cost price', 'Selling price', 'Tax rate %', 'Reorder level', 'Opening stock', 'Description', 'Image URL'];
  const SAMPLE = [
    ['Fresh Milk 500ml', 'MILK-500', '6161101234567', 'Dairy', 'Brookside', 'piece', 48, 65, 0, 10, 24, 'Long life milk', ''],
    ['Cement 50kg', '', '', 'Building', 'Bamburi', 'bag', 700, 820, 16, 20, 100, '', ''],
    ['Sugar 1kg', '', '', 'Groceries', '', 'kg', 150, 190, 0, 20, 50, '', ''],
  ];
  const KNOWN = ['name', 'product', 'productname', 'item', 'itemname', 'sku', 'code', 'itemcode', 'productcode', 'barcode', 'ean', 'upc', 'category', 'group', 'department', 'brand', 'make', 'manufacturer', 'unit', 'uom', 'cost', 'costprice', 'buyingprice', 'purchaseprice', 'bp', 'sellingprice', 'price', 'retailprice', 'sp', 'sellprice', 'taxrate', 'tax', 'vat', 'vatrate', 'reorderlevel', 'minstock', 'lowstock', 'openingstock', 'stock', 'quantity', 'qty', 'onhand', 'description', 'details', 'notes', 'imageurl', 'image', 'photo'];
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const esc = (s) => window.UI.escapeHtml(s == null ? '' : s);

  /* ---------------- CSV ---------------- */
  function parseCsv(text) {
    text = String(text || '').replace(/^\uFEFF/, '');
    const first = text.split(/\r?\n/, 1)[0] || '';
    const delim = [',', ';', '\t'].map((d) => [d, first.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
    const rows = []; let row = [], cell = '', q = false;
    for (let i = 0; i < text.length; i += 1) {
      const c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i += 1; } else q = false; } else cell += c; }
      else if (c === '"') q = true;
      else if (c === delim) { row.push(cell); cell = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i += 1; row.push(cell); rows.push(row); row = []; cell = ''; }
      else cell += c;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows;
  }

  /* ---------------- ZIP (read) + XLSX ---------------- */
  async function inflateRaw(bytes) {
    if (typeof DecompressionStream === 'undefined') throw new Error('This browser cannot read Excel files. Update your browser or save the sheet as CSV.');
    const ds = new DecompressionStream('deflate-raw');
    const out = new Response(new Blob([bytes]).stream().pipeThrough(ds));
    return new Uint8Array(await out.arrayBuffer());
  }
  async function unzip(buf) {
    const dv = new DataView(buf), u8 = new Uint8Array(buf);
    let eocd = -1;
    for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i -= 1) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error('This is not a valid .xlsx file');
    const count = dv.getUint16(eocd + 10, true); let p = dv.getUint32(eocd + 16, true);
    const files = {}; const dec = new TextDecoder();
    for (let n = 0; n < count; n += 1) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
      const nl = dv.getUint16(p + 28, true), el = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), off = dv.getUint32(p + 42, true);
      const name = dec.decode(u8.subarray(p + 46, p + 46 + nl));
      files[name] = { method, csize, off };
      p += 46 + nl + el + cl;
    }
    return {
      names: Object.keys(files),
      async text(name) {
        const f = files[name]; if (!f) return null;
        const lh = f.off, start = lh + 30 + dv.getUint16(lh + 26, true) + dv.getUint16(lh + 28, true);
        const data = u8.subarray(start, start + f.csize);
        return dec.decode(f.method === 0 ? data : await inflateRaw(data));
      },
    };
  }
  const colIndex = (ref) => { let n = 0; const m = /^[A-Z]+/i.exec(ref || ''); if (!m) return 0; for (const ch of m[0].toUpperCase()) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };
  const xml = (s) => new DOMParser().parseFromString(s, 'application/xml');
  const kids = (el, tag) => Array.from(el.getElementsByTagName(tag));
  function numText(v) {
    if (/e/i.test(v) && Number.isFinite(Number(v))) { const n = Number(v); return Number.isInteger(n) ? n.toLocaleString('fullwide', { useGrouping: false }) : String(n); }
    return v;
  }
  async function readXlsx(buf) {
    const z = await unzip(buf);
    const wb = xml(await z.text('xl/workbook.xml')); const rels = xml((await z.text('xl/_rels/workbook.xml.rels')) || '<r/>');
    const relMap = {}; kids(rels, 'Relationship').forEach((r) => { relMap[r.getAttribute('Id')] = r.getAttribute('Target'); });
    const sstXml = await z.text('xl/sharedStrings.xml'); const sst = [];
    if (sstXml) kids(xml(sstXml), 'si').forEach((si) => sst.push(kids(si, 't').map((t) => t.textContent).join('')));
    const sheets = kids(wb, 'sheet').map((s) => {
      const rid = s.getAttribute('r:id') || s.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
      let t = relMap[rid] || ''; t = t.replace(/^\/?(xl\/)?/, 'xl/');
      return { name: s.getAttribute('name'), path: t, hidden: s.getAttribute('state') === 'hidden' };
    });
    if (!sheets.length) throw new Error('No sheets found in the file');
    let best = null;
    for (const sh of sheets) {
      if (sh.hidden) continue;
      const sx = await z.text(sh.path); if (!sx) continue;
      const table = [];
      kids(xml(sx), 'row').forEach((r) => {
        const rn = Number(r.getAttribute('r')) || table.length + 1; const arr = [];
        Array.from(r.children).filter((c) => c.tagName === 'c').forEach((c) => {
          const t = c.getAttribute('t'); const v = c.getElementsByTagName('v')[0]; let val = '';
          if (t === 's') val = sst[Number(v?.textContent)] ?? '';
          else if (t === 'inlineStr') val = kids(c, 't').map((x) => x.textContent).join('');
          else if (t === 'b') val = v?.textContent === '1' ? 'TRUE' : 'FALSE';
          else if (v) val = t === 'str' || t === 'e' ? v.textContent : numText(v.textContent);
          arr[colIndex(c.getAttribute('r'))] = String(val).trim();
        });
        table[rn - 1] = arr;
      });
      const dense = []; table.forEach((r, i) => { dense.push({ n: i + 1, cells: Array.from(r || [], (x) => x ?? '') }); });
      const score = dense.slice(0, 15).reduce((m, r) => Math.max(m, r.cells.filter((c) => KNOWN.includes(norm(c))).length), 0);
      if (!best || score > best.score || (score === best.score && dense.length > best.rows.length && best.score === 0)) best = { score, rows: dense, name: sh.name };
    }
    if (!best) throw new Error('The workbook is empty');
    return best.rows;
  }
  async function readXls(buf) {
    if (!window.XLSX) await new Promise((ok, no) => { const s = document.createElement('script'); s.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js'; s.onload = ok; s.onerror = () => no(new Error('Old .xls files need internet to open. Save the sheet as .xlsx and try again.')); document.head.appendChild(s); });
    const wb = window.XLSX.read(buf, { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    return window.XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' }).map((cells, i) => ({ n: i + 1, cells: cells.map((c) => String(c).trim()) }));
  }

  /** file -> { header: [..], rows: [[..]], rowNumbers: [excel row no.] } */
  async function readFile(file) {
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    let all;
    if (ext === 'xlsx' || ext === 'xlsm') all = await readXlsx(await file.arrayBuffer());
    else if (ext === 'xls') all = await readXls(await file.arrayBuffer());
    else if (ext === 'csv' || ext === 'txt' || ext === 'tsv') all = parseCsv(await file.text()).map((cells, i) => ({ n: i + 1, cells: cells.map((c) => String(c).trim()) }));
    else throw new Error('Please choose an Excel (.xlsx) or CSV file');
    all = all.filter((r) => r.cells.some((c) => c !== ''));
    if (!all.length) throw new Error('The file is empty');
    let hi = all.findIndex((r) => r.cells.filter((c) => KNOWN.includes(norm(c))).length >= 2);
    if (hi < 0) hi = 0;
    const header = all[hi].cells.map((c) => c || '');
    const data = all.slice(hi + 1);
    return { header, rows: data.map((r) => header.map((_, i) => r.cells[i] ?? '')), rowNumbers: data.map((r) => r.n) };
  }

  /* ---------------- template (.xlsx writer, stored zip) ---------------- */
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
  const colName = (i) => String.fromCharCode(65 + i);
  const xe = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  function downloadTemplate() {
    const rows = [HEADERS, ...SAMPLE];
    const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cols><col min="1" max="13" width="18" customWidth="1"/></cols><sheetData>${rows.map((r, ri) => `<row r="${ri + 1}">${r.map((v, ci) => (typeof v === 'number' ? `<c r="${colName(ci)}${ri + 1}"><v>${v}</v></c>` : `<c r="${colName(ci)}${ri + 1}" t="inlineStr"><is><t>${xe(v)}</t></is></c>`)).join('')}</row>`).join('')}</sheetData></worksheet>`;
    const blob = zip([
      ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>'],
      ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
      ['xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Products" sheetId="1" r:id="rId1"/></sheets></workbook>'],
      ['xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'],
      ['xl/worksheets/sheet1.xml', sheet],
    ]);
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'products-template.xlsx'; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  /* ---------------- API calls (chunked) ---------------- */
  function chunks(rows) {
    const out = []; let cur = [], size = 0, start = 0;
    rows.forEach((r, i) => {
      const s = JSON.stringify(r).length;
      if (cur.length && (cur.length >= CHUNK_ROWS || size + s > CHUNK_BYTES)) { out.push({ start, rows: cur }); cur = []; size = 0; start = i; }
      cur.push(r); size += s;
    });
    if (cur.length) out.push({ start, rows: cur });
    return out;
  }
  async function send(parsed, opts, dryRun, onProgress) {
    const total = { total: 0, created: 0, updated: 0, skipped: 0, failed: 0, categoriesCreated: 0, stockLines: 0 };
    const results = []; const unknown = new Set(); const parts = chunks(parsed.rows);
    for (let i = 0; i < parts.length; i += 1) {
      onProgress(i, parts.length);
      const p = parts[i];
      const body = { rows: [parsed.header, ...p.rows], dryRun, mode: opts.mode, createCategories: opts.createCategories, defaultTaxRate: opts.defaultTaxRate };
      if (opts.branchId) body.branchId = opts.branchId;
      const { data } = await window.Api.post('/shop/import', body);
      Object.keys(total).forEach((k) => { total[k] += (data.summary && data.summary[k]) || 0; });
      (data.unknownColumns || []).forEach((u) => unknown.add(u));
      (data.results || []).forEach((r) => results.push({ ...r, row: parsed.rowNumbers[p.start + (r.row - 2)] || r.row }));
    }
    return { summary: total, results, unknownColumns: [...unknown] };
  }

  /* ---------------- UI ---------------- */
  const STATUS = {
    WILL_CREATE: ['New', 'badge-success'], CREATED: ['Added', 'badge-success'], UPDATED: ['Updated', 'badge-info'],
    SKIPPED: ['Skipped', 'badge-neutral'], ERROR: ['Problem', 'badge-danger'],
  };

  function open({ onDone } = {}) {
    const branchId = (window.AppShell && window.AppShell.getActiveBranchId && window.AppShell.getActiveBranchId()) || undefined;
    let parsed = null, checked = false, imported = false, busy = false, modalEl = null;
    const modal = window.UI.openModal({
      title: 'Import products from Excel', maxWidth: '860px',
      bodyHtml: `
        <p class="text-sm text-secondary" style="margin-top:0">Add many products at once from an Excel (.xlsx) or CSV sheet. We check everything first - nothing is saved until you press <b>Import</b>.
        Required columns: <b>Name</b> and <b>Selling price</b>. Optional: SKU, Barcode, Category, Brand, Unit, Cost price, Tax rate %, Reorder level, Opening stock, Description, Image URL.</p>
        <div style="display:flex;gap:var(--space-2);flex-wrap:wrap;margin-bottom:var(--space-3)"><button type="button" class="btn btn-secondary btn-sm" data-pi="tpl">Download Excel template</button></div>
        <div class="field"><label>Excel or CSV file (up to ${MAX_ROWS} products)</label><input type="file" class="input" data-pi="file" accept=".xlsx,.xlsm,.xls,.csv,.tsv,.txt" /></div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:var(--space-3)">
          <div class="field"><label>If a SKU / barcode already exists</label><select class="select" data-pi="mode"><option value="CREATE_ONLY">Skip it (add new only)</option><option value="UPSERT">Update it (name, prices, category...)</option></select></div>
          <div class="field"><label>Default VAT % (when a row has none)</label><input class="input" type="number" min="0" max="100" value="0" data-pi="tax" /></div>
          <div class="field"><label class="checkbox-row" style="margin-top:28px"><input type="checkbox" checked data-pi="cats" /> <span class="text-sm">Create missing categories</span></label></div>
        </div>
        <div class="text-xs text-muted" data-pi="branchNote" style="margin-bottom:var(--space-3)">${branchId ? 'Opening stock goes onto NEW products in the branch selected at the top.' : '<b style="color:var(--color-warning)">No branch selected:</b> choose a branch at the top first if your sheet has an Opening stock column.'}</div>
        <div data-pi="msg" class="text-sm"></div><div data-pi="out"></div>`,
      footerHtml: '<button type="button" class="btn btn-secondary" data-pi="close">Close</button><button type="button" class="btn btn-secondary" data-pi="check" disabled>Check file</button><button type="button" class="btn btn-success" data-pi="go" disabled>Import now</button>',
      onMount: (m) => { modalEl = m; },
    });
    const $ = (k) => modal.querySelector(`[data-pi="${k}"]`);
    const msg = (html) => { $('msg').innerHTML = html; };
    const opts = () => ({ mode: $('mode').value, createCategories: $('cats').checked, defaultTaxRate: Number($('tax').value) || 0, branchId });
    const setBusy = (b) => { busy = b; $('check').disabled = b || !parsed; $('go').disabled = b || !checked; $('file').disabled = b; };
    const closeModal = () => { modal.closest('.modal-backdrop')?.querySelector('.modal-close')?.click(); if (imported && onDone) onDone(); };
    $('close').addEventListener('click', closeModal);
    $('tpl').addEventListener('click', downloadTemplate);
    ['mode', 'tax', 'cats'].forEach((k) => $(k).addEventListener('change', () => { checked = false; $('go').disabled = true; }));

    $('file').addEventListener('change', async (e) => {
      const f = e.target.files[0]; parsed = null; checked = false; $('out').innerHTML = ''; $('check').disabled = true; $('go').disabled = true; if (!f) return;
      msg('Reading file…');
      try {
        if (f.size > 8e6) throw new Error('File is too large. Split it into smaller files.');
        parsed = await readFile(f);
        if (!parsed.rows.length) throw new Error('No product rows found under the header row');
        if (parsed.rows.length > MAX_ROWS) throw new Error(`The file has ${parsed.rows.length} rows. Please import at most ${MAX_ROWS} at a time.`);
        msg(`<span style="color:var(--color-success)">Read ${parsed.rows.length} row(s)</span> with columns: ${esc(parsed.header.filter(Boolean).join(', '))}. Press <b>Check file</b>.`);
        $('check').disabled = false;
      } catch (err) { parsed = null; msg(`<span style="color:var(--color-danger)">${esc(err.message)}</span>`); }
    });

    function render(res, done) {
      const s = res.summary;
      const stat = (label, v) => `<div class="stat-card"><div class="stat-label">${label}</div><div class="stat-value">${v}</div></div>`;
      const rows = res.results.slice().sort((a, b) => (a.status === 'ERROR' ? -1 : 0) - (b.status === 'ERROR' ? -1 : 0));
      $('out').innerHTML = `<h4 style="margin:var(--space-3) 0">${done ? 'Import finished' : 'Check result (nothing saved yet)'}</h4>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:var(--space-2);margin-bottom:var(--space-3)">
          ${stat('Rows', s.total)}${stat(done ? 'Added' : 'Will add', s.created)}${stat('Updated', s.updated)}${stat('Skipped', s.skipped)}${stat('Problems', s.failed)}${stat('Stock lines', s.stockLines)}</div>
        ${res.unknownColumns.length ? `<div class="text-xs text-muted" style="margin-bottom:var(--space-2)">Ignored columns: ${esc(res.unknownColumns.join(', '))}</div>` : ''}
        <div class="table-wrap" style="max-height:320px;overflow:auto"><table class="table"><thead><tr><th>Row</th><th>Product</th><th>SKU</th><th>Status</th><th>Notes</th></tr></thead><tbody>
        ${rows.map((r) => { const st = STATUS[r.status] || [r.status, 'badge-neutral']; const notes = [...(r.errors || []), r.reason, ...(r.warnings || [])].filter(Boolean);
          return `<tr><td>${r.row}</td><td>${esc(r.name || '')}</td><td>${esc(r.sku || '')}</td><td><span class="badge ${st[1]}">${st[0]}</span></td><td class="text-xs ${r.status === 'ERROR' ? '' : 'text-muted'}" ${r.status === 'ERROR' ? 'style="color:var(--color-danger)"' : ''}>${esc(notes.join(' · '))}</td></tr>`; }).join('')}
        </tbody></table></div>`;
    }

    async function run(dryRun) {
      if (busy || !parsed) return;
      const o = opts();
      if (!dryRun && !o.branchId && parsed.header.some((h) => ['openingstock', 'stock', 'quantity', 'qty', 'onhand', 'openingquantity'].includes(norm(h)))) {
        window.UI.toast.error('Select a branch at the top of the page first - opening stock needs a branch.'); return;
      }
      setBusy(true);
      try {
        const res = await send(parsed, o, dryRun, (i, n) => msg(`${dryRun ? 'Checking' : 'Importing'}… part ${i + 1} of ${n}`));
        msg('');
        render(res, !dryRun);
        if (dryRun) { checked = res.summary.created + res.summary.updated > 0; if (!checked) msg('<span style="color:var(--color-warning)">Nothing to import. Fix the problems above or change the options, then check again.</span>'); else if (res.summary.failed) msg(`<span style="color:var(--color-warning)">${res.summary.failed} row(s) have problems and will be left out. The others can still be imported.</span>`); }
        else { imported = true; checked = false; window.UI.toast.success(`Import complete: ${res.summary.created} added, ${res.summary.updated} updated`); $('check').disabled = true; $('close').textContent = 'Done'; }
      } catch (err) { msg(`<span style="color:var(--color-danger)">${esc(err.message || 'Import failed')}</span>`); if (!dryRun) imported = true; }
      setBusy(false); if (imported) { $('check').disabled = true; $('go').disabled = true; }
    }
    $('check').addEventListener('click', () => run(true));
    $('go').addEventListener('click', async () => {
      if (await window.UI.confirmDialog({ title: 'Import these products?', message: 'All valid rows will be saved. Rows with problems are left out.', confirmText: 'Import' })) run(false);
    });
  }

  window.ProductImport = { open, readFile, downloadTemplate };
})(window);