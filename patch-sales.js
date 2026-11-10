#!/usr/bin/env node
/**
 * patch-sales.js
 * Applies to your CURRENT sales.js:
 *   1. Barcode fix   (live duplicate check through BarcodeGuard.bind; Quick add product generates a unique
 *                     barcode with BarcodeGuard.generate, retries when the barcode is taken, then forgets it)
 *   2. Stock guard   (same edits as add-stock-guard.js; skipped automatically if already in the file)
 *
 * Usage:   node patch-sales.js js/pages/sales.js
 * Dry run: node patch-sales.js js/pages/sales.js --dry
 *
 * Safe: all-or-nothing (nothing is written if any step cannot be matched), idempotent (running it twice
 * does nothing the second time), writes sales.js.bak first, and syntax-checks the result.
 * It only touches the lines listed above, so the decimal-quantity (kg) code and everything else stays as it is.
 */
const fs = require('fs');
const vm = require('vm');

const target = process.argv[2];
const dry = process.argv.includes('--dry');
if (!target || !fs.existsSync(target)) {
  console.error('Usage: node patch-sales.js <path-to-sales.js> [--dry]');
  process.exit(1);
}

const ops = [
  {
    "name": "barcode: live duplicate check uses BarcodeGuard.bind",
    "done": "window.BarcodeGuard.bind(input",
    "find": "    input._bcLive = true;\n    warmBarcodeSet();\n    const field = input.closest('.field') || input.parentElement;\n    const msg = document.createElement('div');\n    msg.setAttribute('role', 'alert');\n    msg.style.cssText = 'display:none;margin-top:6px;padding:8px 10px;border-radius:6px;background:#fdecea;border:1px solid #d93025;color:#b3140a;font-weight:600;font-size:13px';\n    field.appendChild(msg);\n    let timer = null, seq = 0, lastToasted = '';\n    const setState = (dup, text) => {\n      input._bcDup = dup;\n      input.style.borderColor = dup ? '#d93025' : '';\n      input.style.boxShadow = dup ? '0 0 0 3px rgba(217,48,37,.25)' : '';\n      input.style.background = dup ? '#fff5f4' : '';\n      msg.style.display = dup ? '' : 'none';\n      msg.textContent = dup ? text : '';\n    };\n    const dupText = (name) => `⚠ BARCODE ALREADY EXISTS in the system${name ? ` — product: \"${name}\"` : ''}. Use a different barcode.`;\n    const alertDup = (code, name, final) => {\n      setState(true, dupText(name));\n      if (final && lastToasted !== code) { lastToasted = code; window.UI.toast.error(`Barcode ${code} already exists${name ? ` (${name})` : ''}`); }\n      if (final) { try { input.focus(); input.select(); } catch { /* ignore */ } }\n    };\n    const check = async (final) => {\n      const code = input.value.trim(); const my = ++seq;\n      if (!code) { setState(false); return; }\n      const hit = instantBarcodeHit(code);            // INSTANT: device copy, no network\n      if (hit) { alertDup(code, hit.name, final); return; }\n      if (!final) { setState(false); return; }\n      const sh = await serverBarcodeHit(code);         // confirm with the server\n      if (my !== seq) return;\n      if (sh) { if (bcUsed) bcUsed.add(code); alertDup(code, sh.name, true); } else setState(false);\n    };\n    input.addEventListener('input', () => { check(false); clearTimeout(timer); timer = setTimeout(() => check(true), 80); });\n    input.addEventListener('change', () => { clearTimeout(timer); check(true); });\n    input.addEventListener('blur', () => { clearTimeout(timer); check(true); });\n    input._bcCheck = () => check(true);\n    if (input.value.trim()) check(true);\n",
    "repl": "    // The server is the ONLY judge of \"this barcode exists\" (it ignores deleted products). The device copy / in-memory\n    // list are used only when there is no connection at all (offline).\n    window.BarcodeGuard.bind(input, { local: (code) => instantBarcodeHit(code) });\n"
  },
  {
    "name": "barcode: Quick add generates a unique barcode and retries",
    "done": "let barcodeWasGenerated = false;",
    "find": "      if (!payload.barcode) {\n        try {\n          if (window.BarcodeLabels) {\n            const used = (await window.BarcodeLabels.loadCatalog()).used;\n            payload.barcode = window.BarcodeLabels.generateCode(used);\n          }\n        } catch { /* a barcode is optional */ }\n      }\n      const btn = modal.querySelector('#qa-save');\n      window.UI.setButtonLoading(btn, true, 'Saving…');\n      try {\n        const res = await window.Api.post('/products', payload);\n",
    "repl": "      let barcodeWasGenerated = false;\n      if (!payload.barcode) {\n        try { payload.barcode = await window.BarcodeGuard.generate(); barcodeWasGenerated = true; } catch { /* a barcode is optional */ }\n      }\n      const btn = modal.querySelector('#qa-save');\n      window.UI.setButtonLoading(btn, true, 'Saving…');\n      try {\n        let res;\n        for (let attempt = 0; ; attempt++) {\n          try { res = await window.Api.post('/products', payload); break; }\n          catch (e) {\n            if (e && e.code === 'BARCODE_RETRY' && attempt < 2) continue;                                   // server just freed a deleted product's barcode\n            const taken = /barcode/i.test(e && e.message || '') && /(exist|already|taken|duplicate|unique)/i.test(e && e.message || '');\n            if (taken && barcodeWasGenerated && attempt < 3) { payload.barcode = await window.BarcodeGuard.generate(); continue; }   // someone used our generated code: make another\n            throw e;\n          }\n        }\n        if (barcodeWasGenerated && payload.barcode) window.BarcodeGuard.forget(payload.barcode);\n"
  },
  {
    "name": "stock guard: checkCartStock function",
    "done": "async function checkCartStock",
    "find": "  function addToCart(product, variant, qty, unitId) {",
    "repl": "  /**\n   * STOCK GUARD at add-to-cart: tells the cashier at once when an item is out of stock or only N are left.\n   * Decimal-safe: a kg line is cut by the exact excess (2.5 asked, 1.2 in stock -> 1.2); whole-unit lines stay whole.\n   * Skipped offline, for untracked items, for variants, and when the business allows negative stock. The server still checks at Complete sale.\n   */\n  const lineFactorOf = (line) => { const u = lineUnitOf(line); return u ? Number(u.factor) || 1 : 1; };\n  async function checkCartStock(product, variant, key) {\n    try {\n      if (!product || variant || product.trackInventory === false || isOfflineNow()) return;\n      const { data } = await window.Api.get('/products/stock-levels', { ids: product._id, branchId: window.AppShell.getActiveBranchId() || undefined });\n      if (data.allowNegativeStock) return;\n      const st = data.stock && data.stock[product._id];\n      if (!st || !st.tracked) return;\n      const avail = Math.max(0, Number(st.quantity) || 0);\n      const lines = state.cart.filter((l) => !l.ws && !l.variant && String(l.product._id) === String(product._id));\n      const inCart = lines.reduce((t, l) => t + l.quantity * lineFactorOf(l), 0);\n      if (inCart <= avail + 1e-6) return;\n      let excess = inCart - avail;\n      const ordered = [...lines.filter((l) => keyOf(l) === key), ...lines.filter((l) => keyOf(l) !== key)];\n      for (const l of ordered) {\n        if (excess <= 1e-6) break;\n        const f = lineFactorOf(l);\n        const cut = allowsFraction(l)\n          ? Math.min(l.quantity, Math.ceil((excess / f) * 1000 - 1e-6) / 1000)\n          : Math.min(l.quantity, Math.ceil(excess / f - 1e-9));\n        l.quantity = qty3(l.quantity - cut); excess -= cut * f;\n        if (l.quantity <= 0) state.cart.splice(state.cart.indexOf(l), 1); else syncAutoDiscount(l);\n      }\n      renderCart();\n      window.UI.toast.error(avail <= 0\n        ? `${product.name} is OUT OF STOCK. It was not added to the cart.`\n        : `Only ${qty3(avail)} ${product.name} in stock. The quantity was set to ${qty3(avail)}.`);\n      setTimeout(() => { if (!document.activeElement || document.activeElement === document.body) $('pos-search')?.focus(); }, 0);\n    } catch { /* never block selling because the stock check could not run */ }\n  }\n\n  function addToCart(product, variant, qty, unitId) {"
  },
  {
    "name": "stock guard: check after add-to-cart",
    "done": "checkCartStock(product, variant, key);",
    "find": "renderCart(key); // scrolls the new / updated row into view",
    "repl": "renderCart(key); // scrolls the new / updated row into view\n    checkCartStock(product, variant, key); // out of stock? tell the cashier now"
  },
  {
    "name": "stock guard: check after + button",
    "done": "checkCartStock(item.product, item.variant, keyOf(item));",
    "find": "item.quantity = qty3(item.quantity + 1);",
    "repl": "item.quantity = qty3(item.quantity + 1);\n          if (!item.ws) checkCartStock(item.product, item.variant, keyOf(item));"
  },
  {
    "name": "stock guard: check after typed quantity",
    "done": "checkCartStock(ln.product, ln.variant, keyOf(ln));",
    "find": "state.cart[idx].quantity = n;",
    "repl": "state.cart[idx].quantity = n;\n        { const ln = state.cart[idx]; if (ln && !ln.ws) checkCartStock(ln.product, ln.variant, keyOf(ln)); }"
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
  if (text.includes(op.done)) { report.push(['skip (already applied)', op.name]); continue; }
  const n = count(text, op.find);
  if (n !== 1) { failed.push(op.name + '  (anchor found ' + n + ' times, expected 1)'); continue; }
  text = text.replace(op.find, () => op.repl);
  report.push(['applied', op.name]);
}

report.forEach(([st, name]) => console.log('  ' + st.padEnd(24) + ' ' + name));

if (failed.length) {
  console.error('\nNOTHING WAS WRITTEN. These steps could not be matched (is this your current sales.js?):');
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