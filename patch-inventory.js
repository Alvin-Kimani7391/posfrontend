#!/usr/bin/env node
/**
 * patch-inventory.js
 * Applies ALL THREE changes to your ORIGINAL inventory.js:
 *   1. Unit conversion  (Break down button, unit picker + decimals on Receive / Adjust)
 *   2. Stock fix        (Movements: search / category / type / date filters, summary strip,
 *                        "Details" column, stale-response guard)
 *   3. Barcode fix      (stock search accepts barcodes, camera scan icon in the search bar)
 *
 * Usage:   node patch-inventory.js js/pages/inventory.js
 * Dry run: node patch-inventory.js js/pages/inventory.js --dry
 *
 * Safe: all-or-nothing (nothing is written if any step cannot be matched), idempotent (running it twice
 * does nothing the second time), writes inventory.js.bak first, and syntax-checks the result.
 */
const fs = require('fs');
const vm = require('vm');

const target = process.argv[2];
const dry = process.argv.includes('--dry');
if (!target || !fs.existsSync(target)) {
  console.error('Usage: node patch-inventory.js <path-to-inventory.js> [--dry]');
  process.exit(1);
}

// Blocks below use § for a backtick and ¤ for a dollar sign (so the template code can be pasted as-is).
const T = (s) => s.replace(/§/g, '`').replace(/¤/g, '$');

/* ===================================================================== *
 * Simple replacements: { name, find, repl }
 * ===================================================================== */
const ops = [];
const add = (name, find, repl) => ops.push({ name, find: T(find), repl: T(repl) });

// ---------- Barcode fix: stock search accepts barcodes + camera scan icon (BarcodeGuard) ----------
add('barcode: search placeholder',
  String.raw`placeholder="Search by product name or SKU"`,
  String.raw`placeholder="Search by product name, SKU or barcode"`);

add('barcode: scan icon in stock search',
  String.raw`      document.getElementById('search-input').addEventListener('input', window.UI.debounce((e) => {
        state.search = e.target.value.trim();
        state.page = 1;
        if (state.view === 'stock') renderStockLevels();
        else if (state.view === 'warehouse') renderWarehouseStock();
        else renderOverview();
      }));
`,
  String.raw`      const runSearch = () => {
        if (state.view === 'stock') renderStockLevels();
        else if (state.view === 'warehouse') renderWarehouseStock();
        else renderOverview();
      };
      const searchInput = document.getElementById('search-input');
      searchInput.addEventListener('input', window.UI.debounce((e) => {
        state.search = e.target.value.trim();
        state.page = 1;
        runSearch();
      }));
      // Camera icon INSIDE the search bar (same scanner as the Add product window): scan a barcode, the stock list filters to it.
      if (window.BarcodeGuard) {
        window.BarcodeGuard.attachSearchScan(searchInput, {
          title: 'Scan product barcode',
          onCode: (code) => {
            searchInput.value = code; state.search = code; state.page = 1;
            runSearch();
            window.BarcodeGuard.check(code).then((r) => {
              if (r.unknown) return;
              if (r.exists) window.UI.toast.success(§Barcode ¤{code}: ¤{r.name || 'product found'}§);
              else window.UI.toast.info(§No product has barcode ¤{code}. Add it on the Products or Sales page.§);
            }).catch(() => {});
          },
        });
      }
`);

// ---------- Stock fix: state ----------
add('state: movement filters',
  String.raw`location: '', productId: '', productName: '' };`,
  String.raw`location: '', productId: '', productName: '', mv: { search: '', categoryId: '', type: '', from: '', to: '' } };`);

// ---------- Unit conversion: header / tools / bindings ----------
add('header: Break down button',
  String.raw`id="receive-stock-btn" data-requires-permission="inventory.receive">¤{window.Icons.get('plus')} Receive stock</button>`,
  String.raw`id="receive-stock-btn" data-requires-permission="inventory.receive">¤{window.Icons.get('plus')} Receive stock</button>
          ¤{window.UnitKit ? §<button class="btn btn-secondary" id="break-stock-btn" data-requires-permission="inventory.adjust" title="Break a bag into sellable sizes">¤{window.Icons.get('inventory')} Break down</button>§ : ''}`);

add('InventoryTools: breakDown',
  String.raw`returnPurchase: openReturnPurchase,`,
  String.raw`returnPurchase: openReturnPurchase,
        breakDown: openBreakDown,`);

add('bindHeaderActions: break button',
  String.raw`document.getElementById('new-transfer-btn').addEventListener('click', openTransferModal);`,
  String.raw`document.getElementById('new-transfer-btn').addEventListener('click', openTransferModal);
    document.getElementById('break-stock-btn')?.addEventListener('click', openBreakDown);`);

add('function openBreakDown',
  String.raw`  function openReceiveModal(arg) {`,
  String.raw`  /** Break a bag into sellable sizes (js/core/unit-conversion-kit.js). */
  function openBreakDown() {
    if (!window.UnitKit) return window.UI.toast.error('Unit conversion is not available on this page');
    window.UnitKit.openBreakModal({ onDone: afterChange });
  }

  function openReceiveModal(arg) {`);

// ---------- Unit conversion: Receive modal ----------
add('receive: decimal quantity input',
  String.raw`name="quantity" type="number" min="1" required`,
  String.raw`name="quantity" type="number" min="1" step="any" inputmode="decimal" required`);

add('receive: attach unit picker',
  String.raw`const applySel = ({ product, variant }) => {`,
  String.raw`// Receive in any size (a 25 kg bag, a 1/4 bag, kg...): the unit picker converts to the base unit and updates the average cost.
    const uk = window.UnitKit ? window.UnitKit.attachQtyUnit({ modal, qtyInput: modal.querySelector('[name="quantity"]'), costInput: modal.querySelector('[name="costPrice"]'), mode: 'receive' }) : null;
    const applySel = ({ product, variant }) => {`);

add('receive: setProduct',
  String.raw`selected = { product, variant };`,
  String.raw`selected = { product, variant };
          if (uk) uk.setProduct(product);`);

add('receive: unitId / updateCost in request',
  String.raw`costPrice: raw.costPrice || undefined,`,
  String.raw`unitId: uk ? uk.unitId() : undefined,
          updateCost: uk && raw.costPrice ? uk.updateCost() : undefined,
          costPrice: raw.costPrice || undefined,`);

add('receive: success toast',
  String.raw`'Stock received into the warehouse' : 'Stock received'`,
  String.raw`'Stock received into the warehouse' : (uk && uk.factor() !== 1 ? §Stock received: ¤{uk.base(raw.quantity)} ¤{selected.product.unit || ''}§ : 'Stock received')`);

// ---------- Unit conversion: Adjust modal ----------
add('adjust: attach unit picker',
  String.raw`const pool = () => (wh() && locEl ? locEl.value : 'RETAIL');`,
  String.raw`const pool = () => (wh() && locEl ? locEl.value : 'RETAIL');
    // Adjust in any size / with decimals (12.5 kg, 1/4 bag): the picker converts to the base unit.
    const uk = window.UnitKit ? window.UnitKit.attachQtyUnit({ modal, qtyInput: qtyEl, mode: 'adjust', onChange: () => recalc() }) : null;
    const fracOk = () => !!(uk && uk.fractional());`);

add('adjust: convert entered quantity',
  String.raw`const qty = Number(raw);`,
  String.raw`const entered = Number(raw);
      const qty = uk ? uk.base(entered) : entered;`);

add('adjust: fraction validation',
  String.raw`if (!Number.isInteger(qty)) return bad('Enter a whole number (no decimals).');`,
  String.raw`if (uk ? !uk.validBase(qty) : !Number.isInteger(qty)) return bad(fracOk() ? 'That makes a part of a single item. Enter a whole number of items.' : 'Enter a whole number (no decimals).');`);

add('adjust: rounded new stock',
  String.raw`newEl.value = §¤{newStock}  (`,
  String.raw`newEl.value = §¤{Math.round(newStock * 1000) / 1000}  (`);

add('adjust: setProduct',
  String.raw`selected = { product, variant: variant || null };`,
  String.raw`selected = { product, variant: variant || null };
      if (uk) uk.setProduct(product);`);

add('adjust: allow decimal keys when fractional',
  String.raw`if (['e', 'E', '+', '-', '.', ','].includes(e.key))`,
  String.raw`if ((fracOk() ? ['e', 'E', '+', '-'] : ['e', 'E', '+', '-', '.', ',']).includes(e.key))`);

add('adjust: unitId in request',
  String.raw`type: values.type, quantity: r.qty, reason: values.reason,`,
  String.raw`type: values.type, quantity: uk ? uk.entered() : r.qty, unitId: uk ? uk.unitId() : undefined, reason: values.reason,`);

/* ===================================================================== *
 * Range replacements: replace everything from `start` up to `end`
 * ===================================================================== */
const ranges = [];

ranges.push({
  name: 'stock fix: Movements toolbar (filters)',
  done: 'id="mv-search"',
  start: "    } else if (state.view === 'movements' && wh()) {",
  end: /    \} else \{\n      toolbar\.innerHTML = '';/,
  repl: T(String.raw`    } else if (state.view === 'movements') {
      const mv = state.mv;
      const types = ['SALE', 'PURCHASE', 'RETURN', 'REFUND', 'PURCHASE_RETURN', 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT', 'TRANSFER_IN', 'TRANSFER_OUT', 'DAMAGE', 'EXPIRED', 'LOST', 'OPENING_STOCK'];
      toolbar.innerHTML = §
        <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end;width:100%">
          <div class="toolbar-search input-group" style="min-width:210px;flex:1 1 210px">
            <span class="input-group-icon">¤{window.Icons.get('search')}</span>
            <input class="input" id="mv-search" type="text" placeholder="Product name, SKU or barcode" value="¤{esc(mv.search)}" />
          </div>
          <select class="select" id="mv-category" style="max-width:190px"><option value="">All categories</option></select>
          <select class="select" id="mv-type" style="max-width:170px">
            <option value="">All movement types</option>
            ¤{types.map((t) => §<option value="¤{t}" ¤{mv.type === t ? 'selected' : ''}>¤{t.replace(/_/g, ' ')}</option>§).join('')}
          </select>
          ¤{wh() ? §<select class="select" id="loc-filter" style="max-width:170px">
            <option value="">Retail + warehouse</option>
            <option value="RETAIL" ¤{state.location === 'RETAIL' ? 'selected' : ''}>Retail only</option>
            <option value="WAREHOUSE" ¤{state.location === 'WAREHOUSE' ? 'selected' : ''}>Warehouse only</option>
          </select>§ : ''}
          <label class="text-sm text-secondary" style="display:flex;flex-direction:column;gap:2px">From<input class="input" type="date" id="mv-from" value="¤{esc(mv.from)}" /></label>
          <label class="text-sm text-secondary" style="display:flex;flex-direction:column;gap:2px">To<input class="input" type="date" id="mv-to" value="¤{esc(mv.to)}" /></label>
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            <button type="button" class="btn btn-secondary btn-sm" data-mv-range="0">Today</button>
            <button type="button" class="btn btn-secondary btn-sm" data-mv-range="7">7 days</button>
            <button type="button" class="btn btn-secondary btn-sm" data-mv-range="30">30 days</button>
            <button type="button" class="btn btn-secondary btn-sm" id="mv-clear">Clear filters</button>
          </div>
        </div>
        ¤{state.productId ? §<div style="margin-top:8px;display:inline-flex;gap:8px;align-items:center;padding:4px 10px;background:#e8f1ff;border:1px solid #9ec1ff;border-radius:999px;color:#0b3d91;font-size:13px">Product: <strong>¤{esc(state.productName || 'selected product')}</strong><button type="button" id="mv-clear-product" class="btn btn-secondary btn-sm" style="padding:0 8px">×</button></div>§ : ''}§;

      // categories (loaded once, then cached)
      loadMovementCategories().then((cats) => {
        const sel = document.getElementById('mv-category');
        if (!sel) return;
        sel.innerHTML = '<option value="">All categories</option>' + cats.map((c) => §<option value="¤{esc(c._id)}" ¤{mv.categoryId === c._id ? 'selected' : ''}>¤{esc(c.name)}</option>§).join('');
      });

      const reload = () => { state.page = 1; renderMovements(); };
      document.getElementById('mv-search').addEventListener('input', window.UI.debounce((e) => { mv.search = e.target.value.trim(); reload(); }));
      document.getElementById('mv-category').addEventListener('change', (e) => { mv.categoryId = e.target.value; reload(); });
      document.getElementById('mv-type').addEventListener('change', (e) => { mv.type = e.target.value; reload(); });
      document.getElementById('loc-filter')?.addEventListener('change', (e) => { state.location = e.target.value; reload(); });
      document.getElementById('mv-from').addEventListener('change', (e) => { mv.from = e.target.value; reload(); });
      document.getElementById('mv-to').addEventListener('change', (e) => { mv.to = e.target.value; reload(); });
      const ymd = (d) => §¤{d.getFullYear()}-¤{String(d.getMonth() + 1).padStart(2, '0')}-¤{String(d.getDate()).padStart(2, '0')}§;
      toolbar.querySelectorAll('[data-mv-range]').forEach((btn) => btn.addEventListener('click', () => {
        const days = Number(btn.dataset.mvRange);
        const start = new Date(); start.setDate(start.getDate() - days);
        mv.from = ymd(start); mv.to = ymd(new Date());
        document.getElementById('mv-from').value = mv.from; document.getElementById('mv-to').value = mv.to;
        reload();
      }));
      document.getElementById('mv-clear').addEventListener('click', () => {
        state.mv = { search: '', categoryId: '', type: '', from: '', to: '' }; state.location = ''; state.productId = ''; state.productName = '';
        try { window.history.replaceState({}, '', window.location.pathname); } catch { /* ignore */ }
        renderToolbar(); state.page = 1; renderMovements();
      });
      document.getElementById('mv-clear-product')?.addEventListener('click', () => {
        state.productId = ''; state.productName = '';
        try { window.history.replaceState({}, '', window.location.pathname); } catch { /* ignore */ }
        renderToolbar(); state.page = 1; renderMovements();
      });
`),
});

ranges.push({
  name: 'stock fix: Movements list (filters, summary, details, race guard)',
  done: 'function movementParams',
  start: '  async function renderMovements() {',
  end: /  \/\* -+ \*\n   \* Transfers\n/,
  repl: T(String.raw`  let movementCategories = null;
  async function loadMovementCategories() {
    if (movementCategories) return movementCategories;
    try { const { data } = await window.Api.get('/categories'); movementCategories = data.categories || []; } catch { movementCategories = []; }
    return movementCategories;
  }

  /** Filters of the Movements tab as API parameters. The date range covers whole days in the user's own time zone. */
  function movementParams(branchId) {
    const mv = state.mv;
    const p = { branchId, page: state.page, limit: state.limit };
    if (wh() && state.location) p.location = state.location;
    if (state.productId) p.productId = state.productId;
    if (mv.search) p.search = mv.search;
    if (mv.categoryId) p.categoryId = mv.categoryId;
    if (mv.type) p.type = mv.type;
    if (mv.from) p.from = new Date(§¤{mv.from}T00:00:00§).toISOString();
    if (mv.to) p.to = new Date(§¤{mv.to}T23:59:59.999§).toISOString();
    return p;
  }

  async function renderMovements() {
    const body = document.getElementById('view-body');
    const showLoc = wh();
    const cols = showLoc ? 8 : 7;
    body.innerHTML = tableShell(showLoc ? ['Date', 'Product', 'Where', 'Type', 'Qty', 'Balance', 'Details', 'By'] : ['Date', 'Product', 'Type', 'Qty', 'Balance', 'Details', 'By'], cols, 6);

    const branchId = window.AppShell.getActiveBranchId();
    const ticket = (renderMovements.ticket = (renderMovements.ticket || 0) + 1); // a slower, older answer must never overwrite a newer filter
    try {
      const { data } = await window.Api.get('/inventory/movements', movementParams(branchId));
      if (ticket !== renderMovements.ticket) return;
      const tbody = body.querySelector('tbody');
      const sm = data.summary || { count: data.total, unitsIn: 0, unitsOut: 0, net: 0 };
      const fmt = (n) => (Math.round((Number(n) || 0) * 1000) / 1000).toLocaleString();
      body.insertAdjacentHTML('afterbegin', §
        <div class="mk-kv" style="padding: var(--space-4) var(--space-6) 0">
          <div><dt>Movements found</dt><dd>¤{fmt(sm.count)}</dd></div>
          <div><dt>Units in</dt><dd style="color:var(--color-success)">+¤{fmt(sm.unitsIn)}</dd></div>
          <div><dt>Units out</dt><dd style="color:var(--color-danger)">−¤{fmt(sm.unitsOut)}</dd></div>
          <div><dt>Net change</dt><dd>¤{sm.net > 0 ? '+' : ''}¤{fmt(sm.net)}</dd></div>
        </div>§);
      if (!data.items.length) {
        tbody.innerHTML = §<tr><td colspan="¤{cols}">¤{window.UI.emptyStateHtml({ icon: 'inventory', title: 'No movements found', message: 'Try a different product, category or date range.' })}</td></tr>§;
      } else {
        tbody.innerHTML = data.items.map((m) => §
          <tr>
            <td class="text-sm">¤{window.UI.formatDateTime(m.createdAt)}</td>
            <td class="text-sm">¤{window.UI.escapeHtml(m.productId?.name || '—')}</td>
            ¤{showLoc ? §<td>¤{locBadge(m.location)}¤{m.location === 'WAREHOUSE' && m.warehouseId?.name ? §<div class="text-sm text-muted">¤{esc(m.warehouseId.name)}</div>§ : ''}</td>§ : ''}
            <td><span class="badge badge-neutral">¤{esc(String(m.type).replace(/_/g, ' '))}</span></td>
            <td class="text-sm" style="color: ¤{m.quantity > 0 ? 'var(--color-success)' : 'var(--color-danger)'}">¤{m.quantity > 0 ? '+' : ''}¤{m.quantity}</td>
            <td class="text-sm">¤{m.newStock}</td>
            <td class="text-sm text-muted" style="max-width:260px">¤{esc(m.reason || '—')}</td>
            <td class="text-sm text-muted">¤{window.UI.escapeHtml(m.performedBy?.name || 'System')}</td>
          </tr>
        §).join('');
      }
      window.UI.renderPagination(document.getElementById('pagination'), data, (p) => { state.page = p; renderMovements(); });
    } catch (err) {
      if (ticket !== renderMovements.ticket) return;
      body.innerHTML = window.UI.emptyStateHtml({ icon: 'alert', title: 'Could not load movements', message: err.message });
    }
  }

`),
});

/* ===================================================================== *
 * Apply
 * ===================================================================== */
const original = fs.readFileSync(target, 'utf8');
const crlf = original.includes('\r\n');
let text = crlf ? original.replace(/\r\n/g, '\n') : original;

const count = (hay, needle) => (needle ? hay.split(needle).length - 1 : 0);
const report = [];
const failed = [];

for (const op of ops) {
  if (text.includes(op.repl)) { report.push(['skip (already applied)', op.name]); continue; }
  const n = count(text, op.find);
  if (n !== 1) { failed.push(`${op.name}  (anchor found ${n} times, expected 1)`); continue; }
  text = text.replace(op.find, () => op.repl);
  report.push(['applied', op.name]);
}

for (const r of ranges) {
  if (text.includes(r.done)) { report.push(['skip (already applied)', r.name]); continue; }
  const s = text.indexOf(r.start);
  if (s < 0 || count(text, r.start) !== 1) { failed.push(`${r.name}  (start anchor not found or not unique)`); continue; }
  const rest = text.slice(s);
  const m = r.end.exec(rest);
  if (!m) { failed.push(`${r.name}  (end anchor not found)`); continue; }
  text = text.slice(0, s) + r.repl + rest.slice(m.index);
  report.push(['applied', r.name]);
}

report.forEach(([st, name]) => console.log(`  ${st.padEnd(24)} ${name}`));

if (failed.length) {
  console.error('\nNOTHING WAS WRITTEN. These steps could not be matched (is this the original inventory.js?):');
  failed.forEach((f) => console.error('  - ' + f));
  process.exit(2);
}

try { new vm.Script(text, { filename: target }); }
catch (e) { console.error('\nNOTHING WAS WRITTEN. The patched file failed a syntax check: ' + e.message); process.exit(3); }

if (dry) { console.log('\nDry run OK. No file written.'); process.exit(0); }
if (text === (crlf ? original.replace(/\r\n/g, '\n') : original)) { console.log('\nAlready fully patched. Nothing to do.'); process.exit(0); }

fs.writeFileSync(target + '.bak', original);
fs.writeFileSync(target, crlf ? text.replace(/\n/g, '\r\n') : text);
console.log(`\nDone. Patched ${target}  (backup: ${target}.bak)`);