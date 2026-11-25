/**
 * product-import.js - "Import products" wizard for EVERY business type.
 * 4 steps: Upload (.xlsx / .csv, drag & drop) -> Match columns (choose which fields to import) -> Review (every row, per-field
 * errors, filters by status / category / search, tick the products to import, fix cells inline) -> Import (live progress,
 * pause / resume / stop, problem report). Uses the EXISTING backend endpoint POST /api/v1/shop/import (dryRun first).
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


  /* =====================================================================================================
   *  Import wizard:  1 Upload -> 2 Columns -> 3 Review -> 4 Import (progress, pause / resume / stop)
   * ===================================================================================================== */
  const CHUNK = 40; // rows per request while importing - small, so progress is smooth and pausing is quick
  const FIELDS = [
    { k: 'name', l: 'Name', req: 1, al: ['name', 'product', 'productname', 'item', 'itemname'] },
    { k: 'sku', l: 'SKU', al: ['sku', 'code', 'itemcode', 'productcode'] },
    { k: 'barcode', l: 'Barcode', al: ['barcode', 'ean', 'upc'] },
    { k: 'category', l: 'Category', al: ['category', 'group', 'department'] },
    { k: 'brand', l: 'Brand', al: ['brand', 'make', 'manufacturer'] },
    { k: 'unit', l: 'Unit', al: ['unit', 'uom'] },
    { k: 'cost', l: 'Cost price', t: 'num', al: ['cost', 'costprice', 'buyingprice', 'purchaseprice', 'bp'] },
    { k: 'price', l: 'Selling price', req: 1, t: 'num', al: ['sellingprice', 'price', 'retailprice', 'sp', 'sellprice'] },
    { k: 'tax', l: 'Tax rate %', t: 'pct', al: ['taxrate', 'tax', 'vat', 'vatrate'] },
    { k: 'reorder', l: 'Reorder level', t: 'num', al: ['reorderlevel', 'minstock', 'lowstock'] },
    { k: 'stock', l: 'Opening stock', t: 'num', al: ['openingstock', 'stock', 'quantity', 'qty', 'onhand', 'openingquantity'] },
    { k: 'description', l: 'Description', al: ['description', 'details', 'notes'] },
    { k: 'image', l: 'Image URL', al: ['imageurl', 'image', 'photo'] },
  ];
  const FBY = Object.fromEntries(FIELDS.map((f) => [f.k, f]));
  // which column does a server message talk about? (order matters: "cost price" before "price")
  const ATTR = [['cost', /cost|buying|purchase/i], ['tax', /\btax|vat/i], ['price', /selling|price/i], ['reorder', /reorder|min(imum)? stock/i], ['stock', /stock|quantity|branch|opening/i],
    ['barcode', /barcode/i], ['sku', /\bsku\b/i], ['category', /categor/i], ['brand', /brand/i], ['unit', /\bunit/i], ['image', /image|photo|url/i], ['description', /descri/i], ['name', /name/i]];
  const attr = (msg, include) => { const hit = ATTR.find(([k, re]) => include.has(k) && re.test(msg)); return hit ? hit[0] : null; };
  const parseNum = (v) => { const s = String(v == null ? '' : v).replace(/kes|ksh|\$|,|\s/gi, ''); if (s === '') return null; const n = Number(s); return Number.isFinite(n) ? n : NaN; };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function downloadTemplate() {
    const blob = window.ProductExport.xlsxBlob([HEADERS, ...SAMPLE], { sheetName: 'Products' });
    window.ProductExport.download(blob, 'products-template.xlsx');
  }

  function openWizard({ onDone } = {}) {
    const branchId = (window.AppShell && window.AppShell.getActiveBranchId && window.AppShell.getActiveBranchId()) || undefined;
    const S = {
      step: 1, fileName: '', parsed: null, map: [], include: new Set(), recs: [], opts: { mode: 'CREATE_ONLY', createCategories: true, defaultTaxRate: 0 },
      tab: 'all', q: '', cats: new Set(), page: 1, checking: false, checked: false, stale: false, checkProg: 0, checkMsg: '',
      run: { state: 'idle', done: 0, total: 0, created: 0, updated: 0, skipped: 0, failed: 0, start: 0, note: '', cursor: 0, queue: [] }, savedAny: false,
    };
    const modal = window.UI.openModal({ title: 'Import products', maxWidth: '1100px', bodyHtml: '<div class="pio" data-i="root"></div>', footerHtml: '<div data-i="foot" style="display:contents"></div>' });
    const backdrop = modal.closest('.modal-backdrop');
    const $ = (k) => modal.querySelector(`[data-i="${k}"]`);
    const closeNow = () => { backdrop.querySelector('.modal-close').click(); };
    const busyRun = () => S.run.state === 'running' || S.run.state === 'pausing';
    const guardClose = async (e) => {
      if (busyRun()) {
        e.stopImmediatePropagation(); e.preventDefault();
        if (await window.UI.confirmDialog({ title: 'Import in progress', message: 'Stop the import and close? Products already imported stay saved.', confirmText: 'Stop & close', danger: true })) { S.run.state = 'stopped'; closeNow(); }
      }
    };
    backdrop.querySelector('.modal-close').addEventListener('click', (e) => { if (busyRun()) guardClose(e); else if (S.savedAny && onDone) setTimeout(onDone, 0); }, true);
    backdrop.addEventListener('click', (e) => { if (e.target !== backdrop) return; if (busyRun()) guardClose(e); else if (S.savedAny && onDone) setTimeout(onDone, 0); }, true);
    window.addEventListener('keydown', function esc(e) {
      if (!document.body.contains(backdrop)) { window.removeEventListener('keydown', esc, true); return; }
      if (e.key === 'Escape') { if (busyRun()) guardClose(e); else if (S.savedAny && onDone) setTimeout(onDone, 0); }
    }, true);

    /* ---- step bar ---- */
    const stepBar = () => `<div class="pio-steps">${['Upload file', 'Match columns', 'Review products', 'Import'].map((t, i) => `<div class="pio-step ${S.step === i + 1 ? 'on' : S.step > i + 1 ? 'done' : ''}"><b>${S.step > i + 1 ? '✓' : i + 1}</b>${t}</div>`).join('')}</div>`;
    const incFields = () => FIELDS.filter((f) => S.include.has(f.k) && S.map.includes(f.k));
    const stockNoBranch = () => S.include.has('stock') && S.map.includes('stock') && !branchId;

    /* ---- build / validate ---- */
    function autoMap() {
      const used = new Set();
      S.map = S.parsed.header.map((h) => {
        const n = norm(h); const f = FIELDS.find((x) => !used.has(x.k) && (norm(x.l) === n || x.al.includes(n)));
        if (f) { used.add(f.k); return f.k; } return '';
      });
      S.include = new Set(S.map.filter(Boolean));
    }
    function buildRecs() {
      S.recs = S.parsed.rows.map((r, i) => {
        const cells = {}; S.map.forEach((k, ci) => { if (k) cells[k] = r[ci] == null ? '' : String(r[ci]); });
        return { id: i, n: S.parsed.rowNumbers[i], cells, lErr: [], lWarn: [], sErr: [], sWarn: [], srv: null, reason: '', sel: true, fin: '' };
      });
      validateAll(); S.checked = false;
    }
    function validateRec(rec) {
      const inc = new Set(incFields().map((f) => f.k)); const e = [], w = [], c = rec.cells;
      if (inc.has('name') && !c.name) e.push({ f: 'name', m: 'Name is required' });
      if (inc.has('name') && c.name && c.name.length > 200) e.push({ f: 'name', m: 'Name is longer than 200 characters' });
      if (!inc.has('price')) e.push({ f: 'price', m: 'Selling price column is not included' });
      FIELDS.filter((f) => f.t && inc.has(f.k)).forEach((f) => {
        const raw = c[f.k]; const n = parseNum(raw);
        if (raw === '' || raw == null) { if (f.req) e.push({ f: f.k, m: `${f.l} is required` }); return; }
        if (Number.isNaN(n)) e.push({ f: f.k, m: `${f.l} "${raw}" is not a number` });
        else if (n < 0) e.push({ f: f.k, m: `${f.l} cannot be negative` });
        else if (f.t === 'pct' && n > 100) e.push({ f: f.k, m: 'Tax rate must be between 0 and 100' });
      });
      if (inc.has('image') && c.image && !/^https?:\/\//i.test(c.image)) w.push({ f: 'image', m: 'Image URL should start with http(s)://' });
      rec.lErr = e; rec.lWarn = w;
    }
    function validateAll() {
      S.recs.forEach(validateRec);
      ['sku', 'barcode'].forEach((k) => {
        if (!S.map.includes(k) || !S.include.has(k)) return;
        const seen = new Map();
        S.recs.forEach((r) => { const v = (r.cells[k] || '').trim().toLowerCase(); if (!v) return; if (seen.has(v)) { r.lWarn.push({ f: k, m: `Duplicate ${FBY[k].l} in file (also row ${seen.get(v)})` }); } else seen.set(v, r.n); });
      });
    }
    const errs = (r) => [...r.lErr, ...r.sErr];
    const warns = (r) => [...r.lWarn, ...r.sWarn];
    const status = (r) => (errs(r).length ? 'error' : r.srv === 'skip' ? 'skip' : r.srv === 'update' ? 'update' : r.srv === 'new' ? 'new' : 'pending');
    const importable = (r) => ['new', 'update', 'pending'].includes(status(r));

    /* ---- API ---- */
    const sendRows = (recs) => {
      const fl = incFields();
      return [fl.map((f) => f.l), ...recs.map((r) => fl.map((f) => { const v = r.cells[f.k] || ''; if (f.t) { const n = parseNum(v); return n === null || Number.isNaN(n) ? v : String(n); } return v; }))];
    };
    async function post(recs, dryRun) {
      const body = { rows: sendRows(recs), dryRun, mode: S.opts.mode, createCategories: S.opts.createCategories, defaultTaxRate: S.opts.defaultTaxRate };
      if (branchId) body.branchId = branchId;
      const { data } = await window.Api.post('/shop/import', body);
      return data;
    }
    const srvStatus = (st) => { st = String(st || '').toUpperCase(); return st === 'ERROR' ? 'error' : st.includes('SKIP') ? 'skip' : st.includes('UPDATE') ? 'update' : 'new'; };
    function applyCheck(recs, data) {
      const inc = new Set(incFields().map((f) => f.k));
      (data.results || []).forEach((x, i) => {
        const r = recs[(x.row ? x.row - 2 : i)]; if (!r) return;
        r.srv = srvStatus(x.status); r.reason = x.reason || '';
        r.sErr = (x.errors || []).map((m) => ({ f: attr(m, inc), m })); r.sWarn = (x.warnings || []).map((m) => ({ f: attr(m, inc), m }));
        if (r.srv === 'error' && !r.sErr.length) r.sErr = [{ f: null, m: x.reason || 'Rejected by the server' }];
      });
    }
    async function checkRecs(recs) {
      const todo = recs.filter((r) => !r.lErr.length);
      recs.forEach((r) => { r.srv = null; r.sErr = []; r.sWarn = []; r.reason = ''; });
      for (let i = 0; i < todo.length; i += 100) {
        const part = todo.slice(i, i + 100);
        applyCheck(part, await post(part, true));
        S.checkProg = Math.min(1, (i + part.length) / Math.max(1, todo.length));
        if (S.step === 3) paintCheckBar();
      }
    }
    async function runCheck() {
      if (S.checking) return; S.checking = true; S.stale = false; S.checkProg = 0; S.checkMsg = '';
      validateAll(); paintReview();
      try { await checkRecs(S.recs); S.checked = true; S.recs.forEach((r) => { r.sel = importable(r) && r.srv !== 'skip' ? r.sel !== false : false; }); }
      catch (e) { S.checkMsg = e.message || 'Could not check the file with the server'; }
      S.checking = false; if (S.step === 3) paintReview();
    }
    let recheckTimer = null; const scheduleRecheck = () => { S.stale = true; S.checked = false; clearTimeout(recheckTimer); recheckTimer = setTimeout(() => { if (S.step === 3) runCheck(); }, 800); if (S.step === 3) paintReview(); };

    /* ======================= STEP 1 : upload ======================= */
    function viewUpload() {
      $('root').innerHTML = `${stepBar()}
        <div class="pio-drop" data-i="drop"><b>Drop your Excel / CSV file here, or click to choose</b><span class="pio-sub">.xlsx · .xls · .csv - up to ${MAX_ROWS} products per file</span>
          <input type="file" data-i="file" accept=".xlsx,.xlsm,.xls,.csv,.tsv,.txt" hidden /></div>
        <div data-i="msg"></div>
        <div class="pio-card"><h4>Columns we understand</h4><div class="pio-row">${FIELDS.map((f) => `<span class="pio-chip ${f.req ? 'on' : ''}">${f.l}${f.req ? ' <small>required</small>' : ''}</span>`).join('')}</div>
        <div class="pio-sub" style="margin-top:8px">Your column names don't have to match exactly - you'll match them in the next step. A file made by <b>Export products</b> can be imported straight back.</div></div>`;
      $('foot').innerHTML = '<button type="button" class="btn btn-secondary" data-i="tpl">Download Excel template</button><button type="button" class="btn btn-secondary" data-i="close">Close</button>';
      const drop = $('drop'), fi = $('file');
      drop.addEventListener('click', () => fi.click());
      ['dragover', 'dragenter'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
      ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
      drop.addEventListener('drop', (e) => { if (e.dataTransfer.files[0]) load(e.dataTransfer.files[0]); });
      fi.addEventListener('change', () => { if (fi.files[0]) load(fi.files[0]); });
      $('tpl').addEventListener('click', downloadTemplate); $('close').addEventListener('click', closeNow);
    }
    async function load(f) {
      const m = $('msg'); m.innerHTML = '<div class="pio-note">Reading file…</div>';
      try {
        if (f.size > 8e6) throw new Error('File is too large. Split it into smaller files.');
        const p = await readFile(f);
        if (!p.rows.length) throw new Error('No product rows found under the header row');
        if (p.rows.length > MAX_ROWS) throw new Error(`The file has ${p.rows.length} rows. Please import at most ${MAX_ROWS} at a time.`);
        S.parsed = p; S.fileName = f.name; autoMap(); S.step = 2; view();
      } catch (e) { m.innerHTML = `<div class="pio-note bad">${esc(e.message)}</div>`; }
    }

    /* ======================= STEP 2 : columns ======================= */
    function viewColumns() {
      const p = S.parsed; const missing = FIELDS.filter((f) => !S.map.includes(f.k));
      const reqMissing = FIELDS.filter((f) => f.req && !(S.map.includes(f.k) && S.include.has(f.k)));
      const sample = (ci) => p.rows.slice(0, 3).map((r) => r[ci]).filter((x) => x !== '' && x != null).join(' · ');
      $('root').innerHTML = `${stepBar()}
        <div class="pio-note ok"><b>${esc(S.fileName)}</b> · ${p.rows.length} product row(s) · ${p.header.filter(Boolean).length} column(s) found. Check how each column is matched, and untick any column you do <b>not</b> want to import.</div>
        <div class="pio-grid" style="grid-template-columns:minmax(0,1.9fr) minmax(0,1fr)">
          <div class="pio-card"><h4>Columns in your file</h4>
            <div class="pio-map"><div class="h">Your column</div><div class="h">Example values</div><div class="h">Import it as</div><div class="h">Import?</div>
            ${p.header.map((h, ci) => { const on = !!S.map[ci] && S.include.has(S.map[ci]); return `
              <div class="pio-map-c" style="display:contents"><div><b>${esc(h || `(column ${ci + 1})`)}</b></div><div class="smp ${on || !S.map[ci] ? '' : 'off'}" title="${esc(sample(ci))}">${esc(sample(ci)) || '<i>empty</i>'}</div>
              <select class="select" data-i="map" data-ci="${ci}"><option value="">Ignore this column</option>${FIELDS.map((f) => `<option value="${f.k}" ${S.map[ci] === f.k ? 'selected' : ''}>${f.l}</option>`).join('')}</select>
              <label class="pio-sw"><input type="checkbox" data-i="inc" data-ci="${ci}" ${on ? 'checked' : ''} ${S.map[ci] ? '' : 'disabled'}/> ${S.map[ci] ? '' : '-'}</label></div>`; }).join('')}
            </div>
            ${missing.length ? `<div class="pio-sub" style="margin-top:10px">Not in your file: ${missing.map((f) => `${f.l}${f.req ? ' (required)' : ''}`).join(', ')}</div>` : ''}
          </div>
          <div class="pio-card"><h4>Import options</h4>
            <div class="field"><label>If a SKU / barcode already exists</label><select class="select" data-i="mode"><option value="CREATE_ONLY" ${S.opts.mode === 'CREATE_ONLY' ? 'selected' : ''}>Skip it (add new products only)</option><option value="UPSERT" ${S.opts.mode === 'UPSERT' ? 'selected' : ''}>Update it with the file's values</option></select></div>
            <div class="field"><label>Default VAT % (rows with none)</label><input class="input" type="number" min="0" max="100" value="${S.opts.defaultTaxRate}" data-i="tax"/></div>
            <label class="pio-sw"><input type="checkbox" data-i="cats" ${S.opts.createCategories ? 'checked' : ''}/> Create categories that don't exist yet</label>
            <div class="pio-sub" style="margin-top:10px">${stockNoBranch() ? '<b style="color:var(--color-warning)">No branch selected.</b> Opening stock needs a branch - choose one at the top of the page, or untick Opening stock.' : branchId ? 'Opening stock is put onto NEW products in the branch selected at the top.' : ''}</div>
          </div>
        </div>
        ${reqMissing.length ? `<div class="pio-note bad">Required column not matched: ${reqMissing.map((f) => f.l).join(', ')}. Pick it in the "Import it as" list.</div>` : ''}`;
      $('foot').innerHTML = `<button type="button" class="btn btn-secondary" data-i="back">Back</button><span class="pio-foot-l">${incFields().length} field(s) will be imported</span><button type="button" class="btn btn-primary" data-i="next" ${reqMissing.length ? 'disabled' : ''}>Review products →</button>`;
      $('back').addEventListener('click', () => { S.step = 1; view(); });
      $('next').addEventListener('click', () => { buildRecs(); S.step = 3; S.tab = 'all'; S.q = ''; S.cats.clear(); S.page = 1; view(); runCheck(); });
    }

    /* ======================= STEP 3 : review ======================= */
    const counts = () => {
      const c = { all: S.recs.length, ready: 0, error: 0, warn: 0, skip: 0, sel: 0 };
      S.recs.forEach((r) => { const s = status(r); if (s === 'error') c.error += 1; else if (s === 'skip') c.skip += 1; else c.ready += 1; if (warns(r).length) c.warn += 1; if (r.sel && importable(r)) c.sel += 1; });
      return c;
    };
    const filtered = () => {
      const q = S.q.trim().toLowerCase();
      return S.recs.filter((r) => {
        const s = status(r);
        if (S.tab === 'ready' && !(s === 'new' || s === 'update' || s === 'pending')) return false;
        if (S.tab === 'error' && s !== 'error') return false;
        if (S.tab === 'warn' && !warns(r).length) return false;
        if (S.tab === 'skip' && s !== 'skip') return false;
        if (S.tab === 'sel' && !(r.sel && importable(r))) return false;
        if (S.cats.size && !S.cats.has((r.cells.category || '').trim() || '__none')) return false;
        if (q && !`${r.cells.name || ''} ${r.cells.sku || ''} ${r.cells.barcode || ''}`.toLowerCase().includes(q)) return false;
        return true;
      });
    };
    function viewReview() {
      const hasCat = S.map.includes('category') && S.include.has('category');
      $('root').innerHTML = `${stepBar()}
        <div class="pio-card"><h4>Fields being imported <span class="pio-sub">untick a field to leave it out</span></h4>
          <div class="pio-row">${FIELDS.filter((f) => S.map.includes(f.k)).map((f) => `<label class="pio-chip ${S.include.has(f.k) ? 'on' : ''}"><input type="checkbox" data-i="fld" value="${f.k}" ${S.include.has(f.k) ? 'checked' : ''}/> ${f.l}${f.req ? ' *' : ''}</label>`).join('')}</div></div>
        <div data-i="banner"></div><div data-i="stats" class="pio-stats"></div>
        <div class="pio-row"><input class="input" data-i="q" placeholder="Search name, SKU, barcode…" value="${esc(S.q)}" style="flex:1;min-width:180px"/>
          <button type="button" class="btn btn-secondary btn-sm" data-i="selshown">Tick shown</button><button type="button" class="btn btn-secondary btn-sm" data-i="clrshown">Untick shown</button><button type="button" class="btn btn-ghost btn-sm" data-i="recheck">Re-check</button></div>
        ${hasCat ? `<div class="pio-row" data-i="catrow"></div>` : ''}
        <div data-i="table"></div>`;
      $('foot').innerHTML = '<button type="button" class="btn btn-secondary" data-i="back">Back</button><span class="pio-foot-l" data-i="sum"></span><button type="button" class="btn btn-success" data-i="go">Import selected →</button>';
      $('back').addEventListener('click', () => { S.step = 2; view(); });
      $('go').addEventListener('click', startImport);
      $('recheck').addEventListener('click', runCheck);
      $('selshown').addEventListener('click', () => { filtered().forEach((r) => { if (importable(r)) r.sel = true; }); paintReview(); });
      $('clrshown').addEventListener('click', () => { filtered().forEach((r) => { r.sel = false; }); paintReview(); });
      paintReview();
    }
    function paintCheckBar() { const b = modal.querySelector('[data-i="cbar"]'); if (b) b.style.width = `${Math.round(S.checkProg * 100)}%`; }
    function paintReview() {
      if (S.step !== 3 || !$('table')) return;
      const c = counts(); const list = filtered(); const pages = Math.max(1, Math.ceil(list.length / 100)); S.page = Math.min(S.page, pages);
      $('banner').innerHTML = S.checking ? `<div class="pio-note">Checking ${S.recs.length} product(s) against your catalogue…<div class="pio-bar" style="margin-top:8px"><i data-i="cbar" style="width:${Math.round(S.checkProg * 100)}%"></i></div></div>`
        : S.checkMsg ? `<div class="pio-note bad">${esc(S.checkMsg)} <button type="button" class="btn btn-secondary btn-sm" data-i="retry">Try again</button></div>`
        : stockNoBranch() ? '<div class="pio-note warn"><b>No branch selected.</b> Opening stock needs a branch: choose one at the top of the page, or untick <b>Opening stock</b> above.</div>'
        : c.error ? `<div class="pio-note warn">${c.error} product(s) have problems and are left out. Click a red cell to fix it here, or fix the file and re-import them later.</div>` : '<div class="pio-note ok">Everything checked out. Choose what to import below.</div>';
      const rt = modal.querySelector('[data-i="retry"]'); if (rt) rt.addEventListener('click', runCheck);
      const stat = (k, label, v, cls) => `<button type="button" class="pio-stat ${cls} ${S.tab === k ? 'on' : ''}" data-i="tab" data-k="${k}"><span>${label}</span><strong>${v}</strong></button>`;
      $('stats').innerHTML = stat('all', 'All rows', c.all, '') + stat('ready', 'Ready', c.ready, 'good') + stat('error', 'Problems', c.error, c.error ? 'bad' : '') + stat('warn', 'Warnings', c.warn, c.warn ? 'warn' : '') + stat('skip', 'Already exist', c.skip, '') + stat('sel', 'Selected', c.sel, 'good');
      const cr = modal.querySelector('[data-i="catrow"]');
      if (cr) {
        const m = new Map(); S.recs.forEach((r) => { const v = (r.cells.category || '').trim() || '__none'; m.set(v, (m.get(v) || 0) + 1); });
        cr.innerHTML = `<span class="pio-sub">Category:</span>${[...m.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([v, n]) => `<label class="pio-chip ${S.cats.has(v) ? 'on' : ''}"><input type="checkbox" data-i="catf" value="${esc(v)}" ${S.cats.has(v) ? 'checked' : ''}/> ${v === '__none' ? 'No category' : esc(v)} <small>${n}</small></label>`).join('')}${S.cats.size ? '<button type="button" class="btn btn-ghost btn-sm" data-i="catclr">Clear</button>' : ''}`;
      }
      const fl = incFields(); const slice = list.slice((S.page - 1) * 100, S.page * 100);
      const cell = (r, f) => { const e = r.lErr.concat(r.sErr).filter((x) => x.f === f.k), w = warns(r).filter((x) => x.f === f.k); const v = r.cells[f.k] || '';
        return `<td class="${e.length ? 'bad' : w.length ? 'warn' : ''}" data-rid="${r.id}" data-f="${f.k}" title="${esc([...e, ...w].map((x) => x.m).join('\n') || 'Click to edit')}">${esc(v) || (e.length ? '<i>missing</i>' : '')}</td>`; };
      const badge = { new: ['New', 'badge-success'], update: ['Will update', 'badge-info'], skip: ['Exists', 'badge-neutral'], error: ['Problem', 'badge-danger'], pending: ['Unchecked', 'badge-neutral'] };
      $('table').innerHTML = `<div class="pio-tablewrap"><table class="pio-table"><thead><tr><th class="pio-stick"><input type="checkbox" data-i="all" ${slice.length && slice.filter(importable).every((r) => r.sel) && slice.some(importable) ? 'checked' : ''}/></th><th>Row</th><th>Status</th>${fl.map((f) => `<th>${f.l}</th>`).join('')}<th>What's wrong</th></tr></thead><tbody>
        ${slice.map((r) => { const s = status(r); const b = badge[s]; const rowIssues = [...errs(r), ...warns(r).map((x) => ({ ...x, m: `⚠ ${x.m}` }))].map((x) => `${x.f && FBY[x.f] ? `<b>${FBY[x.f].l}:</b> ` : ''}${esc(x.m)}`);
          return `<tr class="${s === 'error' ? 'err' : ''} ${r.sel && importable(r) ? '' : 'off'}"><td class="pio-stick"><input type="checkbox" data-i="rowsel" data-rid="${r.id}" ${r.sel && importable(r) ? 'checked' : ''} ${importable(r) ? '' : 'disabled'}/></td><td>${r.n}</td><td><span class="badge ${b[1]}">${b[0]}</span></td>${fl.map((f) => cell(r, f)).join('')}<td class="pio-errs">${rowIssues.join('<br>') || (r.reason ? `<span class="pio-sub">${esc(r.reason)}</span>` : '')}</td></tr>`; }).join('') || `<tr><td colspan="${fl.length + 4}" style="text-align:center;padding:24px" class="pio-sub">No rows match this filter</td></tr>`}</tbody></table></div>
        <div class="pio-row" style="justify-content:space-between;margin-top:6px"><span class="pio-sub">${list.length ? `${(S.page - 1) * 100 + 1}-${Math.min(S.page * 100, list.length)} of ${list.length}` : ''}</span><span class="pio-row"><button type="button" class="btn btn-ghost btn-sm" data-i="pg" data-d="-1" ${S.page <= 1 ? 'disabled' : ''}>‹ Prev</button><span class="pio-sub">Page ${S.page}/${pages}</span><button type="button" class="btn btn-ghost btn-sm" data-i="pg" data-d="1" ${S.page >= pages ? 'disabled' : ''}>Next ›</button></span></div>`;
      $('sum').textContent = `${c.sel} of ${c.all} selected`;
      $('go').disabled = S.checking || S.stale || !c.sel || stockNoBranch();
      $('go').textContent = `Import ${c.sel} product${c.sel === 1 ? '' : 's'} →`;
    }

    /* ======================= STEP 4 : import with progress ======================= */
    const fmtT = (s) => (s < 60 ? `${Math.max(1, Math.round(s))}s` : `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`);
    function startImport() {
      const queue = S.recs.filter((r) => r.sel && importable(r)); if (!queue.length) return;
      Object.assign(S.run, { state: 'running', done: 0, total: queue.length, created: 0, updated: 0, skipped: 0, failed: 0, start: Date.now(), note: '', cursor: 0, queue });
      S.recs.forEach((r) => { r.fin = ''; r.finMsg = ''; });
      S.step = 4; view(); loop();
    }
    async function loop() {
      const R = S.run; R.state = 'running'; paintRun();
      while (R.cursor < R.queue.length) {
        if (R.state === 'pausing') { R.state = 'paused'; paintRun(); return; }
        if (R.state === 'stopped') { paintRun(); return; }
        const part = R.queue.slice(R.cursor, R.cursor + CHUNK);
        try {
          const data = await post(part, false);
          (data.results || []).forEach((x, i) => {
            const r = part[x.row ? x.row - 2 : i]; if (!r) return; const st = String(x.status || '').toUpperCase();
            if (st === 'ERROR') { r.fin = 'failed'; r.finMsg = (x.errors || [x.reason]).filter(Boolean).join(' · '); R.failed += 1; }
            else if (st.includes('SKIP')) { r.fin = 'skipped'; r.finMsg = x.reason || 'Already exists'; R.skipped += 1; }
            else if (st.includes('UPDATE')) { r.fin = 'updated'; R.updated += 1; S.savedAny = true; }
            else { r.fin = 'created'; R.created += 1; S.savedAny = true; }
          });
          R.cursor += part.length; R.done = R.cursor; R.note = '';
        } catch (e) {
          R.state = 'paused'; R.note = `${e.message || 'Connection problem'} - the import is paused. Press Resume to retry from where it stopped.`; paintRun(); return;
        }
        paintRun(); await sleep(0);
      }
      R.state = 'done'; paintRun();
      if (S.savedAny) window.UI.toast.success(`Import complete: ${R.created} added, ${R.updated} updated`);
    }
    function viewRun() { $('root').innerHTML = `${stepBar()}<div data-i="run"></div>`; paintRun(); }
    function paintRun() {
      if (S.step !== 4 || !$('run')) return; const R = S.run; const pct = R.total ? Math.round((R.done / R.total) * 100) : 0;
      const el = (Date.now() - R.start) / 1000; const eta = R.done && R.state === 'running' ? ` · about ${fmtT((el / R.done) * (R.total - R.done))} left` : '';
      const title = { running: 'Importing…', pausing: 'Pausing after this batch…', paused: 'Paused', done: 'Import finished', stopped: 'Import stopped' }[R.state];
      const bad = S.recs.filter((r) => r.fin === 'failed' || r.fin === 'skipped');
      $('run').innerHTML = `<div class="pio-card"><h4>${title}<span class="pio-sub">${R.done} / ${R.total} · ${pct}%${eta}</span></h4>
        <div class="pio-bar ${R.state === 'paused' ? 'paused' : R.state === 'done' ? 'done' : ''}"><i style="width:${pct}%"></i></div>
        ${R.note ? `<div class="pio-note bad" style="margin-top:10px">${esc(R.note)}</div>` : ''}</div>
        <div class="pio-stats">${[['Added', R.created, 'good'], ['Updated', R.updated, ''], ['Skipped', R.skipped, ''], ['Failed', R.failed, R.failed ? 'bad' : ''], ['Remaining', R.total - R.done, '']].map(([l, v, c]) => `<div class="pio-stat ${c}" style="cursor:default"><span>${l}</span><strong>${v}</strong></div>`).join('')}</div>
        ${bad.length ? `<div class="pio-card"><h4>Not imported <span class="pio-sub">${bad.length}</span></h4><div class="pio-tablewrap" style="max-height:220px"><table class="pio-table"><thead><tr><th>Row</th><th>Product</th><th>SKU</th><th>Reason</th></tr></thead><tbody>${bad.map((r) => `<tr><td>${r.n}</td><td>${esc(r.cells.name)}</td><td>${esc(r.cells.sku)}</td><td class="pio-errs">${esc(r.finMsg)}</td></tr>`).join('')}</tbody></table></div></div>` : ''}`;
      const st = R.state; const f = $('foot');
      if (st === 'running' || st === 'pausing') f.innerHTML = `<span class="pio-foot-l">Keep this window open until it finishes</span><button type="button" class="btn btn-secondary" data-i="pause" ${st === 'pausing' ? 'disabled' : ''}>⏸ Pause</button><button type="button" class="btn btn-danger" data-i="stop">Stop</button>`;
      else if (st === 'paused') f.innerHTML = '<button type="button" class="btn btn-danger" data-i="stop">Stop import</button><button type="button" class="btn btn-primary" data-i="resume">▶ Resume</button>';
      else f.innerHTML = `${S.recs.some((r) => r.fin === 'failed' || r.lErr.length || r.sErr.length) ? '<button type="button" class="btn btn-secondary" data-i="report">Download problem report</button>' : ''}<button type="button" class="btn btn-secondary" data-i="again">Import another file</button><button type="button" class="btn btn-primary" data-i="close">Done</button>`;
      const on = (k, fn) => { const b = $(k); if (b) b.addEventListener('click', fn); };
      on('pause', () => { R.state = 'pausing'; paintRun(); }); on('resume', () => loop());
      on('stop', () => { R.state = 'stopped'; paintRun(); }); on('close', closeNow);
      on('again', () => { S.step = 1; S.parsed = null; S.recs = []; S.run.state = 'idle'; view(); }); on('report', downloadReport);
    }
    function downloadReport() {
      const fl = incFields(); const rows = [['Row', ...fl.map((f) => f.l), 'Problem']];
      S.recs.filter((r) => r.fin === 'failed' || r.lErr.length || r.sErr.length).forEach((r) => rows.push([r.n, ...fl.map((f) => r.cells[f.k] || ''), r.fin === 'failed' ? r.finMsg : errs(r).map((x) => `${x.f && FBY[x.f] ? `${FBY[x.f].l}: ` : ''}${x.m}`).join(' | ')]));
      window.ProductExport.download(window.ProductExport.xlsxBlob(rows, { sheetName: 'Problems' }), 'import-problems.xlsx');
    }

    /* ---- shared delegated events ---- */
    const root = $('root');
    root.addEventListener('change', (e) => {
      const t = e.target, k = t.dataset.i;
      if (k === 'map') { const ci = Number(t.dataset.ci); const v = t.value; if (v) S.map.forEach((x, i) => { if (x === v && i !== ci) { S.map[i] = ''; } }); S.map[ci] = v; if (v) S.include.add(v); viewColumns(); }
      else if (k === 'inc') { const key = S.map[Number(t.dataset.ci)]; t.checked ? S.include.add(key) : S.include.delete(key); viewColumns(); }
      else if (k === 'mode') S.opts.mode = t.value; else if (k === 'tax') S.opts.defaultTaxRate = Number(t.value) || 0; else if (k === 'cats') S.opts.createCategories = t.checked;
      else if (k === 'fld') { t.checked ? S.include.add(t.value) : S.include.delete(t.value); S.recs.forEach((r) => { r.sErr = []; r.sWarn = []; r.srv = null; }); validateAll(); viewReview(); scheduleRecheck(); }
      else if (k === 'rowsel') { const r = S.recs[Number(t.dataset.rid)]; r.sel = t.checked; paintReview(); }
      else if (k === 'all') { const list = filtered().slice((S.page - 1) * 100, S.page * 100); list.forEach((r) => { if (importable(r)) r.sel = t.checked; }); paintReview(); }
      else if (k === 'catf') { t.checked ? S.cats.add(t.value) : S.cats.delete(t.value); S.page = 1; paintReview(); }
    });
    root.addEventListener('input', (e) => { if (e.target.dataset.i === 'q') { S.q = e.target.value; S.page = 1; paintReview(); const q = $('q'); if (q) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); } } });
    root.addEventListener('click', (e) => {
      const b = e.target.closest('[data-i]'); const k = b && b.dataset.i;
      if (k === 'tab') { S.tab = b.dataset.k; S.page = 1; paintReview(); }
      else if (k === 'pg') { S.page += Number(b.dataset.d); paintReview(); }
      else if (k === 'catclr') { S.cats.clear(); paintReview(); }
      else if (e.target.closest('td[data-rid]') && !e.target.closest('input')) editCell(e.target.closest('td[data-rid]'));
    });
    function editCell(td) {
      if (td.querySelector('input')) return; const r = S.recs[Number(td.dataset.rid)], f = td.dataset.f; const old = r.cells[f] || '';
      td.innerHTML = `<input class="input" style="min-width:120px;padding:2px 6px" value="${esc(old)}"/>`; const inp = td.firstChild; inp.focus(); inp.select();
      let done = false;
      const commit = async (save) => {
        if (done) return; done = true;
        if (save && inp.value.trim() !== old) {
          r.cells[f] = inp.value.trim(); r.sel = true; validateAll(); paintReview();
          if (!r.lErr.length) { try { await checkRecs([r]); } catch { /* checked again at import */ } }
        }
        paintReview();
      };
      inp.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') commit(true); else if (ev.key === 'Escape') { ev.stopPropagation(); commit(false); } });
      inp.addEventListener('blur', () => commit(true));
    }

    function view() {
      if (S.step === 1) viewUpload(); else if (S.step === 2) viewColumns(); else if (S.step === 3) viewReview(); else viewRun();
    }
    view();
  }

  /** other pages (shop.html, hardware) only load this file: pull in the shared export helpers + styles on demand */
  const base = (() => { const s = document.currentScript; return s && s.src ? s.src.replace(/product-import\.js.*$/, '') : 'js/core/'; })();
  async function open(o) {
    if (!document.querySelector('link[href*="product-io.css"]')) { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = `${base}../../css/product-io.css`; document.head.appendChild(l); }
    if (!window.ProductExport) await new Promise((ok) => { const s = document.createElement('script'); s.src = `${base}product-export.js`; s.onload = ok; s.onerror = ok; document.head.appendChild(s); });
    openWizard(o);
  }
  window.ProductImport = { open, readFile, downloadTemplate };
})(window);
