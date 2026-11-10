#!/usr/bin/env node
const fs = require('fs');
const { spawnSync } = require('child_process');
const file = process.argv[2];
if (!file) { console.error('Usage: node add-stock-guard.js path/to/js/pages/sales.js'); process.exit(1); }
let s = fs.readFileSync(file, 'utf8');
const orig = s;
if (s.includes('async function checkCartStock')) { console.log('Stock guard already present - nothing to do.'); process.exit(0); }

const GUARD = `  /**
   * STOCK GUARD at add-to-cart: tells the cashier at once when an item is out of stock or only N are left.
   * Decimal-safe: a kg line is cut by the exact excess (2.5 asked, 1.2 in stock -> 1.2); whole-unit lines stay whole.
   * Skipped offline, for untracked items, for variants, and when the business allows negative stock. The server still checks at Complete sale.
   */
  const lineFactorOf = (line) => { const u = lineUnitOf(line); return u ? Number(u.factor) || 1 : 1; };
  async function checkCartStock(product, variant, key) {
    try {
      if (!product || variant || product.trackInventory === false || isOfflineNow()) return;
      const { data } = await window.Api.get('/products/stock-levels', { ids: product._id, branchId: window.AppShell.getActiveBranchId() || undefined });
      if (data.allowNegativeStock) return;
      const st = data.stock && data.stock[product._id];
      if (!st || !st.tracked) return;
      const avail = Math.max(0, Number(st.quantity) || 0);
      const lines = state.cart.filter((l) => !l.ws && !l.variant && String(l.product._id) === String(product._id));
      const inCart = lines.reduce((t, l) => t + l.quantity * lineFactorOf(l), 0);
      if (inCart <= avail + 1e-6) return;
      let excess = inCart - avail;
      const ordered = [...lines.filter((l) => keyOf(l) === key), ...lines.filter((l) => keyOf(l) !== key)];
      for (const l of ordered) {
        if (excess <= 1e-6) break;
        const f = lineFactorOf(l);
        const cut = allowsFraction(l)
          ? Math.min(l.quantity, Math.ceil((excess / f) * 1000 - 1e-6) / 1000)
          : Math.min(l.quantity, Math.ceil(excess / f - 1e-9));
        l.quantity = qty3(l.quantity - cut); excess -= cut * f;
        if (l.quantity <= 0) state.cart.splice(state.cart.indexOf(l), 1); else syncAutoDiscount(l);
      }
      renderCart();
      window.UI.toast.error(avail <= 0
        ? \`\${product.name} is OUT OF STOCK. It was not added to the cart.\`
        : \`Only \${qty3(avail)} \${product.name} in stock. The quantity was set to \${qty3(avail)}.\`);
      setTimeout(() => { if (!document.activeElement || document.activeElement === document.body) $('pos-search')?.focus(); }, 0);
    } catch { /* never block selling because the stock check could not run */ }
  }

`;

const edits = [
  { name: 'add checkCartStock function',
    old: 'function addToCart(product, variant, qty, unitId) {',
    neu: GUARD.replace(/^  /, '  ') + '  function addToCart(product, variant, qty, unitId) {' , fix: true },
  { name: 'check after add-to-cart',
    old: 'renderCart(key); // scrolls the new / updated row into view',
    neu: 'renderCart(key); // scrolls the new / updated row into view\n    checkCartStock(product, variant, key); // out of stock? tell the cashier now' },
  { name: 'check after + button',
    old: 'item.quantity = qty3(item.quantity + 1);',
    neu: 'item.quantity = qty3(item.quantity + 1);\n          if (!item.ws) checkCartStock(item.product, item.variant, keyOf(item));' },
  { name: 'check after typed quantity',
    old: 'state.cart[idx].quantity = n;',
    neu: 'state.cart[idx].quantity = n;\n        { const ln = state.cart[idx]; if (ln && !ln.ws) checkCartStock(ln.product, ln.variant, keyOf(ln)); }' },
];

// the function must be inserted at the line start of "function addToCart": keep the original 2-space indent once
edits[0].neu = GUARD + '  function addToCart(product, variant, qty, unitId) {';
edits[0].old = '  function addToCart(product, variant, qty, unitId) {';

for (const e of edits) {
  const count = s.split(e.old).length - 1;
  if (count !== 1) { console.error(`STOPPED - anchor for "${e.name}" found ${count} times (expected 1). File not changed.`); process.exit(2); }
}
fs.writeFileSync(`${file}.bak2`, orig);
for (const e of edits) { s = s.replace(e.old, () => e.neu); console.log(`applied ${e.name}`); }
fs.writeFileSync(file, s);
const chk = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
if (chk.status !== 0) { fs.writeFileSync(file, orig); console.error('Syntax check FAILED - original restored.\n' + chk.stderr); process.exit(3); }
console.log(`Done. Syntax OK. Backup: ${file}.bak2`);