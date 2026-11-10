#!/usr/bin/env node
const fs = require('fs');
const { spawnSync } = require('child_process');
const file = process.argv[2];
if (!file) { console.error('Usage: node apply-sales-patch.js path/to/js/pages/sales.js'); process.exit(1); }
let s = fs.readFileSync(file, 'utf8');
const orig = s;

const NEW_HELPER = `  /** Measured products (kg, litre, metre...) can be sold in parts: 1.5 kg, 0.25 of a bag. Other products stay whole numbers. */
  const MEASURED_UNITS = ['kg', 'kgs', 'kilogram', 'kilograms', 'g', 'gram', 'grams', 'litre', 'litres', 'liter', 'liters', 'l', 'ltr', 'ml', 'metre', 'metres', 'meter', 'meters', 'm', 'm2', 'm3', 'tonne', 'tonnes'];
  const qty3 = (n) => Math.round(Number(n) * 1000) / 1000; // removes floating-point noise (2.1000000000000004 -> 2.1)
  // Case-insensitive unit match; packet / deal lines stay whole numbers; wholesale lines always allow decimals.
  const allowsFraction = (item) => !!(item && item.product && (item.ws || (!item.unitId && (MEASURED_UNITS.includes(String(item.product.unit || '').trim().toLowerCase()) || String(item.product.productType || '').toLowerCase() === 'weighted'))));
`;
const OLD_HELPER = `  /** Measured products (kg, litre, metre...) can be sold in parts: 1.5 kg, 0.25 of a bag. Other products stay whole numbers. */
  const MEASURED_UNITS = ['kg', 'g', 'litre', 'ml', 'metre', 'm2', 'm3', 'tonne'];
  const allowsFraction = (item) => !!(item && item.product && (item.ws || MEASURED_UNITS.includes(item.product.unit) || item.product.productType === 'weighted'));
`;
const ANCHOR = "  const unitKeyOf = (product, variant, unitId) =>";

const edits = [
  s.includes(OLD_HELPER)
    ? { name: 'upgrade helper', old: OLD_HELPER, neu: NEW_HELPER, done: () => s.includes(NEW_HELPER) }
    : { name: 'add helper', old: ANCHOR, neu: NEW_HELPER + ANCHOR, done: () => s.includes(NEW_HELPER) },
  { name: 'quantity box accepts decimals',
    old: `<input type="number" inputmode="\${item.ws ? 'decimal' : 'numeric'}" min="0" step="\${item.ws ? 'any' : '1'}" value="\${item.quantity}" data-action="qty"`,
    neu: `<input type="number" inputmode="\${allowsFraction(item) ? 'decimal' : 'numeric'}" min="0" step="\${allowsFraction(item) ? 'any' : '1'}" value="\${item.quantity}" data-action="qty"` },
  { name: 'typed quantity not rounded down',
    old: "const n = state.cart[idx] && state.cart[idx].ws ? Math.round(Number(inp.value) * 1000) / 1000 : Math.floor(Number(inp.value));",
    neu: "const n = allowsFraction(state.cart[idx]) ? Math.round(Number(inp.value) * 1000) / 1000 : Math.floor(Number(inp.value));" },
  { name: '+ button rounding', old: 'item.quantity += 1;', neu: 'item.quantity = qty3(item.quantity + 1);' },
  { name: '- button rounding', old: 'item.quantity -= 1;', neu: 'item.quantity = qty3(item.quantity - 1);' },
  { name: 'scan/add rounding', old: 'existing.quantity += add;', neu: 'existing.quantity = qty3(existing.quantity + add);' },
  { name: 'unit counter rounding', old: 'itemCount += item.quantity;', neu: 'itemCount = qty3(itemCount + item.quantity);' },
  // Stock guard: cut a decimal line down by the exact excess (e.g. 2.5 kg asked, 1.2 kg in stock -> 1.2), whole units stay whole.
  { name: 'stock guard: decimal-safe cut',
    old: 'const cut = Math.min(l.quantity, Math.ceil(excess / f - 1e-9));',
    neu: 'const cut = allowsFraction(l) ? Math.min(l.quantity, Math.ceil((excess / f) * 1000 - 1e-6) / 1000) : Math.min(l.quantity, Math.ceil(excess / f - 1e-9));' },
  { name: 'stock guard: rounding after cut',
    old: 'l.quantity -= cut; excess -= cut * f;',
    neu: 'l.quantity = qty3(l.quantity - cut); excess -= cut * f;' },
];

// 1) check every anchor first (skip edits that are already applied)
const todo = [];
for (const e of edits) {
  const applied = e.done ? e.done() : s.includes(e.neu);
  if (applied) { console.log(`skip (already there) ${e.name}`); continue; }
  const count = s.split(e.old).length - 1;
  if (count !== 1) { console.error(`STOPPED - anchor for "${e.name}" found ${count} times (expected 1). File not changed.`); process.exit(2); }
  todo.push(e);
}
if (!todo.length) { console.log('Already fully patched - nothing to do.'); process.exit(0); }
// 2) apply
fs.writeFileSync(`${file}.bak`, orig);
for (const e of todo) { s = s.replace(e.old, () => e.neu); console.log(`applied ${e.name}`); }
fs.writeFileSync(file, s);
// 3) syntax check; restore on failure
const chk = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
if (chk.status !== 0) { fs.writeFileSync(file, orig); console.error('Syntax check FAILED - original restored.\n' + chk.stderr); process.exit(3); }
console.log(`Done. Syntax OK. Backup: ${file}.bak`);