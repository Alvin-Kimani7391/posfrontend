#!/usr/bin/env node
/**
 * patch-products.js
 * Applies BOTH changes to your ORIGINAL products.js:
 *   1. Unit conversion  ("Sold or received in different sizes?" section on the product form, Sizes / Break down
 *                        buttons and row-menu entries, opening stock in any size)
 *   2. Barcode fix      (camera scan icon in the search bar, server-checked duplicate barcode alert through
 *                        BarcodeGuard, free-barcode generation, retry when a deleted product's barcode is freed)
 *
 * Usage:   node patch-products.js js/pages/products.js
 * Dry run: node patch-products.js js/pages/products.js --dry
 *
 * Safe: all-or-nothing (nothing is written if any step cannot be matched), idempotent (running it twice
 * does nothing the second time), writes products.js.bak first, and syntax-checks the result.
 */
const fs = require('fs');
const vm = require('vm');

const target = process.argv[2];
const dry = process.argv.includes('--dry');
if (!target || !fs.existsSync(target)) {
  console.error('Usage: node patch-products.js <path-to-products.js> [--dry]');
  process.exit(1);
}

const ops = [
 {
  "name": "unit conversion: header comment",
  "find": " * COPY NAME -> SKU: a small copy icon sits inside the Product name box; one click puts the name into the SKU box.\n *\n * DISCOUNT PER UNIT: each product can carry a standing per-unit discount\n * (field \"defaultDiscount\", KES). The sales screen pre-fills it on the",
  "repl": " * COPY NAME -> SKU: a small copy icon sits inside the Product name box; one click puts the name into the SKU box.\n *\n * UNIT CONVERSION (js/core/unit-conversion-kit.js): the \"Sold or received in different sizes?\" section lets one product be\n * bought as a bag and sold by the kg, 500 g, 1/4 bag... Stock stays ONE pool in the base unit; every size shows its\n * cost, price, profit and margin. Row menu: \"Sizes, prices & profit\" and \"Break down stock\".\n *\n * DISCOUNT PER UNIT: each product can carry a standing per-unit discount\n * (field \"defaultDiscount\", KES). The sales screen pre-fills it on the"
 },
 {
  "name": "unit conversion: row menu: Sizes, prices & profit / Break down stock",
  "find": "      ['edit', 'Edit product', E('edit')],\n      ['view-stock', 'View stock & adjust', E('inventory')],\n      ['variants', 'Manage variants', E('box')],\n      ['sticker', 'Print barcode sticker', E('printer')],",
  "repl": "      ['edit', 'Edit product', E('edit')],\n      ['view-stock', 'View stock & adjust', E('inventory')],\n      ['unit-prices', 'Sizes, prices & profit', E('box')],\n      ['break-stock', 'Break down stock', E('inventory')],\n      ['variants', 'Manage variants', E('box')],\n      ['sticker', 'Print barcode sticker', E('printer')],"
 },
 {
  "name": "unit conversion: hasSizes helper",
  "find": "  }\n\n  function renderRows(items) {\n    const tbody = document.getElementById('products-tbody');",
  "repl": "  }\n\n  /** A product with extra sizes (bag / 1/4 / 500g ...): not the pieces-only packet / deal units. */\n  const hasSizes = (p) => !!(window.UnitKit && (p.units || []).some((u) => u.status !== 'inactive' && u.code !== 'PKT' && u.code !== 'DEAL'));\n\n  function renderRows(items) {\n    const tbody = document.getElementById('products-tbody');"
 },
 {
  "name": "unit conversion: row buttons: Sizes / Break down",
  "find": "          ${p.status === 'archived' ? `<button class=\"btn btn-ghost btn-sm\" data-action=\"restore\" data-requires-permission=\"products.delete\">Restore</button>` : ''}\n          ${p.hasVariants ? `<button class=\"btn btn-ghost btn-sm btn-icon\" data-action=\"variants\" data-requires-permission=\"products.update\" title=\"Manage variants\">${window.Icons.get('box')}</button>` : ''}\n          <button class=\"btn btn-ghost btn-sm\" data-action=\"view-stock\" data-requires-permission=\"inventory.view\" title=\"See this product's stock in Inventory (then adjust or receive)\">View stock</button>\n          <button class=\"btn btn-ghost btn-sm btn-icon\" data-action=\"sticker\" data-requires-permission=\"products.view\" title=\"Print barcode sticker\">${window.Icons.get('printer')}</button>",
  "repl": "          ${p.status === 'archived' ? `<button class=\"btn btn-ghost btn-sm\" data-action=\"restore\" data-requires-permission=\"products.delete\">Restore</button>` : ''}\n          ${p.hasVariants ? `<button class=\"btn btn-ghost btn-sm btn-icon\" data-action=\"variants\" data-requires-permission=\"products.update\" title=\"Manage variants\">${window.Icons.get('box')}</button>` : ''}\n          ${hasSizes(p) ? `<button class=\"btn btn-ghost btn-sm\" data-action=\"unit-prices\" data-requires-permission=\"inventory.view\" title=\"Cost, price and profit of every size\">Sizes</button>\n          <button class=\"btn btn-ghost btn-sm\" data-action=\"break-stock\" data-requires-permission=\"inventory.adjust\" title=\"Break a bag into sellable sizes\">Break down</button>` : ''}\n          <button class=\"btn btn-ghost btn-sm\" data-action=\"view-stock\" data-requires-permission=\"inventory.view\" title=\"See this product's stock in Inventory (then adjust or receive)\">View stock</button>\n          <button class=\"btn btn-ghost btn-sm btn-icon\" data-action=\"sticker\" data-requires-permission=\"products.view\" title=\"Print barcode sticker\">${window.Icons.get('printer')}</button>"
 },
 {
  "name": "unit conversion: click handlers for Sizes / Break down",
  "find": "      });\n    });\n    tbody.querySelectorAll('[data-action=\"sticker\"]').forEach((btn) => {\n      btn.addEventListener('click', () => openPrintChooser('sticker', [btn.closest('tr').dataset.id]));",
  "repl": "      });\n    });\n    tbody.querySelectorAll('[data-action=\"unit-prices\"], [data-action=\"break-stock\"]').forEach((btn) => {\n      btn.addEventListener('click', async () => {\n        if (!window.UnitKit) return;\n        const id = btn.closest('tr').dataset.id;\n        const prod = items.find((x) => x._id === id);\n        if (btn.dataset.action === 'break-stock') window.UnitKit.openBreakModal({ product: prod, onDone: () => { stockCache.delete(String(id)); fetchAndRender(); } });\n        else window.UnitKit.openBreakdown(prod, { onDone: () => { stockCache.delete(String(id)); fetchAndRender(); } });\n      });\n    });\n    tbody.querySelectorAll('[data-action=\"sticker\"]').forEach((btn) => {\n      btn.addEventListener('click', () => openPrintChooser('sticker', [btn.closest('tr').dataset.id]));"
 },
 {
  "name": "unit conversion: form: unit-conversion switch (ukOn)",
  "find": "    // Wholesale businesses enter products wholesale-first (retail + unit conversion are optional extras).\n    const wf = !!(window.WholesaleProductForm && window.WholesaleProductForm.applies(isEdit ? product : null));\n\n    const bodyHtml = `",
  "repl": "    // Wholesale businesses enter products wholesale-first (retail + unit conversion are optional extras).\n    const wf = !!(window.WholesaleProductForm && window.WholesaleProductForm.applies(isEdit ? product : null));\n    // Unit conversion (bag -> kg / 500g / 1/4 bag ...): shown on the normal product form (the wholesale form has its own pack fields).\n    const ukOn = !wf && !!(window.UnitKit && window.UnitKit.applies(isEdit ? product : null));\n\n    const bodyHtml = `"
 },
 {
  "name": "unit conversion: form: \"Sold or received in different sizes?\" section",
  "find": "          <input class=\"input\" id=\"p-unitvalue\" name=\"unitValue\" type=\"number\" min=\"0\" step=\"any\" inputmode=\"decimal\" value=\"${isEdit && product.unitValue > 0 ? product.unitValue : ''}\" placeholder=\"e.g. 200\" style=\"max-width: 200px\" />\n        </div>`}\n\n        <div class=\"field\">",
  "repl": "          <input class=\"input\" id=\"p-unitvalue\" name=\"unitValue\" type=\"number\" min=\"0\" step=\"any\" inputmode=\"decimal\" value=\"${isEdit && product.unitValue > 0 ? product.unitValue : ''}\" placeholder=\"e.g. 200\" style=\"max-width: 200px\" />\n        </div>`}\n        ${ukOn ? window.UnitKit.sectionHtml(isEdit ? product : null) : ''}\n\n        <div class=\"field\">"
 },
 {
  "name": "unit conversion: form: bind the sizes editor",
  "find": "    }\n\n    if (wf) window.WholesaleProductForm.bind(modal, { product: isEdit ? product : null });\n",
  "repl": "    }\n\n    // Sizes editor: cost per base unit, price / profit of every size, stock in any size.\n    const unitKit = ukOn ? window.UnitKit.bind(modal, {\n      product: isEdit ? product : null,\n      baseUnit: () => (modal.querySelector('#p-unit') || {}).value || 'piece',\n      generateBarcode: async () => { const used = await getUsedBarcodes(); const code = window.BarcodeLabels.generateCode(used); used.add(code); return code; },\n    }) : null;\n\n    if (wf) window.WholesaleProductForm.bind(modal, { product: isEdit ? product : null });\n"
 },
 {
  "name": "unit conversion: save: validate sizes and cost per base unit",
  "find": "      }\n\n      // Optional opening stock (simple products only; variants are received from the Inventory page).\n      let stockReq = null;",
  "repl": "      }\n\n      // Sizes (unit conversion): validate, work out the cost per base unit, warn when a size sells below cost.\n      let ukRes = null;\n      if (unitKit) {\n        ukRes = unitKit.collect();\n        if (ukRes.error) { window.UI.toast.error(ukRes.error); if (ukRes.focus) ukRes.focus.focus(); return; }\n        if (ukRes.costPrice !== undefined) raw.costPrice = String(ukRes.costPrice);\n        if (unitKit.active() && ukRes.touched && !(await unitKit.confirmBelowCost())) return;\n      }\n\n      // Optional opening stock (simple products only; variants are received from the Inventory page).\n      let stockReq = null;"
 },
 {
  "name": "unit conversion: save: opening stock converted to the base unit",
  "find": "        // Received as packets: stock is kept in pieces, so packets x pieces-per-packet\n        const asPackets = !!(packetCtl && packetCtl.isOn() && modal.querySelector('#p-stock-unit') && modal.querySelector('#p-stock-unit').value === 'packets');\n        stockReq = { branchId, quantity: asPackets ? Math.round(qty * packetCtl.factor() * 1000) / 1000 : qty, batchNumber: batchNo || undefined, expiryDate: expiry || undefined, reason: asPackets ? `Initial stock (${qty} packets)` : 'Initial stock' };\n      }\n",
  "repl": "        // Received as packets: stock is kept in pieces, so packets x pieces-per-packet\n        const asPackets = !!(packetCtl && packetCtl.isOn() && modal.querySelector('#p-stock-unit') && modal.querySelector('#p-stock-unit').value === 'packets');\n        // Received as a bag / 1/4 bag / any size: stock is kept in the base unit, so convert here (the product has no unit ids yet).\n        const ukBase = unitKit && unitKit.active() ? unitKit.stockBase(qty) : null;\n        const ukLabel = ukBase != null && ukBase !== qty ? unitKit.stockLabel() : '';\n        stockReq = { branchId, quantity: ukBase != null ? ukBase : (asPackets ? Math.round(qty * packetCtl.factor() * 1000) / 1000 : qty), batchNumber: batchNo || undefined, expiryDate: expiry || undefined, reason: ukLabel ? `Initial stock (${qty} ${ukLabel})` : (asPackets ? `Initial stock (${qty} packets)` : 'Initial stock') };\n      }\n"
 },
 {
  "name": "unit conversion: save: send the sizes as product units",
  "find": "        }\n      }\n      if (pkRes && pkRes.touched) {\n        // Packet + deal units (other units, e.g. a wholesale carton, are kept as they are)\n        payload.units = (payload.units || []).concat(pkRes.units);\n        payload.costPrice = raw.costPrice;\n      }",
  "repl": "        }\n      }\n      if (ukRes && ukRes.touched) {\n        payload.units = (payload.units || []).concat(ukRes.units);\n        if (ukRes.costPrice !== undefined) payload.costPrice = raw.costPrice;\n      }\n      if (pkRes && pkRes.touched) {\n        // Packet + deal units (other units, e.g. a wholesale carton, are kept as they are). When the sizes editor\n        // changed the other units it already carries them, so only the packet / deal units are taken from here.\n        const pu = ukRes && ukRes.touched ? pkRes.units.filter((u) => u.code === PKT || u.code === DEAL) : pkRes.units;\n        payload.units = (payload.units || []).concat(pu);\n        payload.costPrice = raw.costPrice;\n      }"
 },
 {
  "name": "barcode fix: scanner run() accepts a camera scan",
  "find": "  function bindAlwaysOnScanner() {\n    const input = document.getElementById('search-input');\n    const run = (code) => {\n      if (document.querySelector('.modal-backdrop')) return; // a form is open: its own barcode field gets the scan\n      input.value = code; state.search = code; state.page = 1;\n      fetchAndRender({ local: true }).then(() => {",
  "repl": "  function bindAlwaysOnScanner() {\n    const input = document.getElementById('search-input');\n    const run = (code, fromCamera) => {\n      if (!fromCamera && document.querySelector('.modal-backdrop')) return; // a form is open: its own barcode field gets the scan\n      input.value = code; state.search = code; state.page = 1;\n      fetchAndRender({ local: true }).then(() => {"
 },
 {
  "name": "barcode fix: camera scan icon in the search bar",
  "find": "    };\n    if (window.BarcodeScanner) window.BarcodeScanner.listenHardwareScanner(run, { minLength: 4 });\n    input.addEventListener('keydown', (e) => {\n      if (e.key !== 'Enter') return;",
  "repl": "    };\n    if (window.BarcodeScanner) window.BarcodeScanner.listenHardwareScanner(run, { minLength: 4 });\n    // Camera icon INSIDE the search bar: scan with the phone / webcam, the list filters to that product;\n    // if no product has the barcode, the Quick add window opens with the barcode already filled in.\n    if (window.BarcodeGuard) window.BarcodeGuard.attachSearchScan(input, { title: 'Scan product barcode', onCode: (code) => run(code, true) });\n    input.addEventListener('keydown', (e) => {\n      if (e.key !== 'Enter') return;"
 },
 {
  "name": "barcode fix: live duplicate check through BarcodeGuard.bind",
  "find": "  function bindBarcodeLiveCheck(input, scope, ownCodes) {\n    if (!input || input._bcLive) return;\n    input._bcLive = true;\n    getUsedBarcodes().catch(() => {}); // warm the in-memory barcode list so the alert is instant\n    const ownList = () => (typeof ownCodes === 'function' ? ownCodes() : ownCodes) || [];\n    const ownHas = (c) => ownList().some((x) => String(x || '').trim() === c);\n    const field = input.closest('.field') || input.parentElement;\n    const msg = document.createElement('div');\n    msg.className = 'bc-dup-msg';\n    msg.setAttribute('role', 'alert');\n    msg.style.cssText = 'display:none;margin-top:6px;padding:8px 10px;border-radius:6px;background:#fdecea;border:1px solid #d93025;color:#b3140a;font-weight:600;font-size:13px';\n    field.appendChild(msg);\n    let timer = null, seq = 0, lastToasted = '';\n\n    const setState = (dup, text) => {\n      input._bcDup = dup;\n      input.classList.toggle('bc-dup', dup);\n      input.style.borderColor = dup ? '#d93025' : '';\n      input.style.boxShadow = dup ? '0 0 0 3px rgba(217,48,37,.25)' : '';\n      input.style.background = dup ? '#fff5f4' : '';\n      msg.style.display = dup ? '' : 'none';\n      msg.textContent = dup ? text : '';\n    };\n    const dupText = (name) => `⚠ BARCODE ALREADY EXISTS in the system${name ? ` — product: \"${name}\"` : ''}. Use a different barcode.`;\n    // final = the scan/typing has finished (pause, Enter, leaving the box): only then toast + select the text\n    const alertDup = (code, name, final) => {\n      setState(true, dupText(name));\n      if (final && lastToasted !== code) { lastToasted = code; window.UI.toast.error(`Barcode ${code} already exists${name ? ` (${name})` : ''}`); }\n      if (final) { try { input.focus(); input.select(); } catch { /* ignore */ } }\n    };\n\n    const check = async (final) => {\n      const code = input.value.trim();\n      const my = ++seq;\n      if (!code || ownHas(code)) { setState(false); return; }\n      const sameForm = Array.from(scope.querySelectorAll('input[name=\"barcode\"], input[name^=\"v-barcode-\"]'))\n        .some((el) => el !== input && el.value.trim() === code);\n      if (sameForm) { alertDup(code, '', final); msg.textContent = `⚠ Barcode ${code} is already used in another field of this form.`; return; }\n      // 1) INSTANT: in-memory list, no network\n      if (usedBarcodes && usedBarcodes.has(code)) {\n        alertDup(code, '', final);\n        if (final) lookupBarcodeOnServer(code).then((hit) => { if (hit && hit.name && my === seq) msg.textContent = dupText(hit.name); });\n        return;\n      }\n      if (!usedBarcodes) { getUsedBarcodes().then(() => { if (my === seq && usedBarcodes) check(final); }).catch(() => {}); }\n      if (!final) { setState(false); return; }\n      // 2) confirm with the server (catches products added on another till a moment ago)\n      const hit = await lookupBarcodeOnServer(code);\n      if (my !== seq) return;\n      if (hit && !ownHas(input.value.trim())) { if (usedBarcodes) usedBarcodes.add(code); alertDup(code, hit.name, true); }\n      else setState(false);\n    };\n\n    input.addEventListener('input', () => { check(false); clearTimeout(timer); timer = setTimeout(() => check(true), 80); });\n    input.addEventListener('change', () => { clearTimeout(timer); check(true); });\n    input.addEventListener('blur', () => { clearTimeout(timer); check(true); });\n    input._bcCheck = () => check(true);\n    if (input.value.trim()) check(true);\n  }\n",
  "repl": "  function bindBarcodeLiveCheck(input, scope, ownCodes) {\n    if (!input || input._bcLive) return;\n    // The browser's own list of \"used\" barcodes is NOT consulted any more (it went stale and said \"exists\" for deleted\n    // products). BarcodeGuard asks the server, which only counts live (non-archived) products.\n    window.BarcodeGuard.bind(input, { scope, ownCodes });\n  }\n"
 },
 {
  "name": "barcode fix: Generate button asks the server for a free barcode",
  "find": "  }\n\n  /** Puts a freshly generated barcode into a form field. */\n  async function fillGeneratedBarcode(input) {\n    const used = await getUsedBarcodes();\n    // anything typed in the other barcode boxes of the open form counts as used too\n    document.querySelectorAll('#product-form input[name^=\"v-barcode-\"], #product-form input[name=\"barcode\"], #add-variant-form input[name=\"barcode\"]')\n      .forEach((el) => { if (el !== input && el.value.trim()) used.add(el.value.trim()); });\n    input.value = window.BarcodeLabels.generateCode(used);\n    input.dispatchEvent(new Event('input', { bubbles: true }));\n  }\n",
  "repl": "  }\n\n  /** Puts a freshly generated barcode into a form field. The code is confirmed FREE by the server and is never added to the shared list. */\n  async function fillGeneratedBarcode(input) {\n    const others = Array.from(document.querySelectorAll('#product-form input[name^=\"v-barcode-\"], #product-form input[name=\"barcode\"], #add-variant-form input[name=\"barcode\"], #p-pk-barcode'))\n      .filter((el) => el !== input).map((el) => el.value.trim()).filter(Boolean);\n    try {\n      input.value = await window.BarcodeGuard.generate(others);\n    } catch (err) {\n      window.UI.toast.error('Could not create a free barcode right now. Check the connection and try again.');\n      return;\n    }\n    input.dispatchEvent(new Event('input', { bubbles: true }));\n    input.dispatchEvent(new Event('change', { bubbles: true }));\n  }\n"
 },
 {
  "name": "barcode fix: generated codes no longer leak into the shared list",
  "find": "        const generated = { main: false, variants: new Set() };\n        if (!isEdit) {\n          const used = await getUsedBarcodes();\n          (payload.variants || []).forEach((v) => { if (v.barcode) used.add(String(v.barcode).trim()); });\n          if (payload.barcode) used.add(String(payload.barcode).trim());",
  "repl": "        const generated = { main: false, variants: new Set() };\n        if (!isEdit) {\n          const used = new Set(await getUsedBarcodes()); // a COPY: codes made here must not leak into the shared list\n          (payload.variants || []).forEach((v) => { if (v.barcode) used.add(String(v.barcode).trim()); });\n          if (payload.barcode) used.add(String(payload.barcode).trim());"
 },
 {
  "name": "barcode fix: retry when the server frees a deleted product's barcode",
  "find": "      try { return await window.Api.post('/products', payload); }\n      catch (err) {\n        const taken = /barcode/i.test(err.message || '') && /(exist|duplicate|already|taken|unique)/i.test(err.message || '');\n        const anyGenerated = generated && (generated.main || generated.variants.size);\n        if (!taken || attempt >= 2 || !anyGenerated) throw err;\n        const used = await getUsedBarcodes(true);\n        if (payload.variants) payload.variants.forEach((v, i) => { if (generated.variants.has(i)) v.barcode = window.BarcodeLabels.generateCode(used); });\n        else if (generated.main) payload.barcode = window.BarcodeLabels.generateCode(used);",
  "repl": "      try { return await window.Api.post('/products', payload); }\n      catch (err) {\n        if (err && err.code === 'BARCODE_RETRY' && attempt < 2) continue; // the server just freed a deleted product's barcode: save again\n        const taken = /barcode/i.test(err.message || '') && /(exist|duplicate|already|taken|unique)/i.test(err.message || '');\n        const anyGenerated = generated && (generated.main || generated.variants.size);\n        if (!taken || attempt >= 2 || !anyGenerated) throw err;\n        const used = new Set(await getUsedBarcodes(true));\n        if (payload.variants) payload.variants.forEach((v, i) => { if (generated.variants.has(i)) v.barcode = window.BarcodeLabels.generateCode(used); });\n        else if (generated.main) payload.barcode = window.BarcodeLabels.generateCode(used);"
 },
 {
  "name": "barcode fix: new variant barcode is generated by BarcodeGuard",
  "find": "      const raw = window.UI.serializeForm(form);\n      try {\n        if (!raw.barcode) raw.barcode = window.BarcodeLabels.generateCode(await getUsedBarcodes()); // no barcode typed: create one\n        await window.Api.post(`/products/${product._id}/variants`, {\n          sku: raw.sku,",
  "repl": "      const raw = window.UI.serializeForm(form);\n      try {\n        if (!raw.barcode) raw.barcode = await window.BarcodeGuard.generate(); // no barcode typed: create one (confirmed free)\n        await window.Api.post(`/products/${product._id}/variants`, {\n          sku: raw.sku,"
 }
];

const original = fs.readFileSync(target, 'utf8');
const crlf = original.includes('\r\n');
const base = crlf ? original.replace(/\r\n/g, '\n') : original;
let text = base;
const count = (hay, needle) => (needle ? hay.split(needle).length - 1 : 0);
const report = [];
const failed = [];

for (const op of ops) {
  if (text.includes(op.repl)) { report.push(['skip (already applied)', op.name]); continue; }
  const n = count(text, op.find);
  if (n !== 1) { failed.push(op.name + '  (anchor found ' + n + ' times, expected 1)'); continue; }
  text = text.replace(op.find, () => op.repl);
  report.push(['applied', op.name]);
}

report.forEach(([st, name]) => console.log('  ' + st.padEnd(24) + ' ' + name));

if (failed.length) {
  console.error('\nNOTHING WAS WRITTEN. These steps could not be matched (is this your original products.js?):');
  failed.forEach((f) => console.error('  - ' + f));
  process.exit(2);
}

try { new vm.Script(text, { filename: target }); }
catch (e) { console.error('\nNOTHING WAS WRITTEN. The patched file failed a syntax check: ' + e.message); process.exit(3); }

if (dry) { console.log('\nDry run OK. No file written.'); process.exit(0); }
if (text === base) { console.log('\nAlready fully patched. Nothing to do.'); process.exit(0); }

fs.writeFileSync(target + '.bak', original);
fs.writeFileSync(target, crlf ? text.replace(/\n/g, '\r\n') : text);
console.log('\nDone. Patched ' + target + '  (backup: ' + target + '.bak)');