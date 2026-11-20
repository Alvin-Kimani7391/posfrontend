/**
 * sales-stockfix.js  -  "Fix stock" window on the Sales screen.  Loaded before sales.js.
 *
 * When the cashier picks a product that is out of stock (or short), sales.js opens this window instead of silently
 * dropping the product from the cart. The cashier can:
 *   - Receive stock  (quantity, cost, batch number, expiry date)        -> same data as Inventory > Receive stock
 *   - Adjust stock   (count the shelf / add / remove / damaged ...)      -> same data as Inventory > Adjust stock
 *   - Cancel         (the product is taken out of the cart, as before)
 * ONLINE  : calls /inventory/receive and /inventory/adjust straight away.
 * OFFLINE : writes STOCK_RECEIVE / STOCK_ADJUST into the till's ordered outbox (Offline.stock); they upload with the
 *           sales when the internet is back, stock first, then the sale that needed it.
 *
 *   StockFix.open({ product, needed, available, offline }) -> Promise<{ action: 'received'|'adjusted'|'cancel', quantity? }>
 *   quantities are in the product's base unit (stock is always kept in the base unit).
 */
(function (window) {
  'use strict';

  const CSS = `
  .sf-ov{position:fixed;inset:0;z-index:2600;background:rgba(15,23,42,.55);backdrop-filter:blur(3px);display:flex;align-items:center;justify-content:center;padding:16px;animation:sfFade .15s ease-out}
  @keyframes sfFade{from{opacity:0}to{opacity:1}}
  @keyframes sfRise{from{opacity:0;transform:translateY(14px) scale(.985)}to{opacity:1;transform:none}}
  .sf-card{width:100%;max-width:540px;max-height:calc(100vh - 32px);display:flex;flex-direction:column;background:var(--color-surface,#fff);color:var(--color-text,#0f172a);border-radius:18px;box-shadow:0 24px 70px rgba(2,6,23,.35),0 0 0 1px rgba(148,163,184,.25);overflow:hidden;animation:sfRise .2s ease-out;font-family:inherit}
  .sf-head{display:flex;gap:14px;align-items:flex-start;padding:18px 20px 14px;background:linear-gradient(135deg,#fff7ed 0%,#fff 70%);border-bottom:1px solid var(--color-border,#e5e7eb)}
  .sf-ico{flex:0 0 44px;height:44px;border-radius:12px;display:grid;place-items:center;font-size:20px;background:#fee2e2;color:#b91c1c}
  .sf-ico.warn{background:#fef3c7;color:#b45309}
  .sf-ttl{min-width:0;flex:1}
  .sf-ttl h3{margin:0;font-size:17px;font-weight:700;line-height:1.25;overflow-wrap:anywhere}
  .sf-ttl p{margin:3px 0 0;font-size:12.5px;color:var(--color-text-secondary,#64748b)}
  .sf-x{flex:0 0 auto;border:0;background:transparent;color:var(--color-text-secondary,#64748b);width:32px;height:32px;border-radius:8px;font-size:18px;cursor:pointer}
  .sf-x:hover{background:rgba(100,116,139,.12)}
  .sf-body{padding:16px 20px;overflow:auto;-webkit-overflow-scrolling:touch}
  .sf-net{display:inline-flex;align-items:center;gap:6px;font-size:11.5px;font-weight:600;padding:3px 9px;border-radius:999px;margin-bottom:12px}
  .sf-net.on{background:#dcfce7;color:#166534}.sf-net.off{background:#fef3c7;color:#92400e}
  .sf-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:14px}
  .sf-stat{border:1px solid var(--color-border,#e5e7eb);border-radius:12px;padding:10px 12px;background:var(--color-bg,#f8fafc)}
  .sf-stat small{display:block;font-size:11px;letter-spacing:.03em;text-transform:uppercase;color:var(--color-text-secondary,#64748b);font-weight:600}
  .sf-stat b{display:block;font-size:21px;line-height:1.2;margin-top:2px;font-variant-numeric:tabular-nums}
  .sf-stat.bad b{color:#b91c1c}.sf-stat.ok b{color:#15803d}
  .sf-tabs{display:grid;grid-template-columns:1fr 1fr;gap:4px;padding:4px;border-radius:12px;background:var(--color-bg,#f1f5f9);margin-bottom:14px}
  .sf-tab{border:0;background:transparent;padding:10px 8px;border-radius:9px;font-weight:600;font-size:14px;color:var(--color-text-secondary,#475569);cursor:pointer;display:flex;align-items:center;justify-content:center;gap:7px}
  .sf-tab.on{background:var(--color-surface,#fff);color:var(--color-primary,#2563eb);box-shadow:0 1px 4px rgba(15,23,42,.14)}
  .sf-tab[disabled]{opacity:.45;cursor:not-allowed}
  .sf-row{display:grid;grid-template-columns:1fr 1fr;gap:12px}
  .sf-f{margin-bottom:12px;min-width:0}
  .sf-f label{display:block;font-size:12.5px;font-weight:600;margin-bottom:5px;color:var(--color-text,#1e293b)}
  .sf-f label i{font-style:normal;font-weight:500;color:var(--color-text-secondary,#64748b)}
  .sf-f label em{font-style:normal;color:#dc2626;margin-left:2px}
  .sf-in{width:100%;box-sizing:border-box;height:42px;padding:0 12px;border:1.5px solid var(--color-border,#d1d5db);border-radius:10px;font-size:15px;background:var(--color-surface,#fff);color:inherit;font-family:inherit;transition:border-color .12s,box-shadow .12s}
  .sf-in:focus{outline:0;border-color:var(--color-primary,#2563eb);box-shadow:0 0 0 3px rgba(37,99,235,.18)}
  .sf-in.bad{border-color:#dc2626;box-shadow:0 0 0 3px rgba(220,38,38,.14)}
  .sf-in.big{height:50px;font-size:22px;font-weight:700;font-variant-numeric:tabular-nums}
  .sf-pre{position:relative}.sf-pre span{position:absolute;left:12px;top:50%;transform:translateY(-50%);font-size:13px;color:var(--color-text-secondary,#64748b);pointer-events:none}.sf-pre .sf-in{padding-left:46px}
  .sf-seg{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px}
  .sf-chip{border:1.5px solid var(--color-border,#d1d5db);background:var(--color-surface,#fff);color:inherit;padding:7px 12px;border-radius:999px;font-size:13px;font-weight:600;cursor:pointer}
  .sf-chip.on{border-color:var(--color-primary,#2563eb);background:rgba(37,99,235,.09);color:var(--color-primary,#2563eb)}
  .sf-chip.sm{padding:4px 10px;font-size:12px;font-weight:500}
  .sf-chips{display:flex;gap:6px;flex-wrap:wrap;margin-top:7px}
  .sf-after{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:11px 14px;border-radius:12px;background:#ecfdf5;border:1px solid #a7f3d0;color:#065f46;font-size:13.5px;margin-bottom:12px}
  .sf-after b{font-size:18px;font-variant-numeric:tabular-nums}
  .sf-after.bad{background:#fef2f2;border-color:#fecaca;color:#991b1b}
  .sf-after.warn{background:#fffbeb;border-color:#fde68a;color:#92400e}
  .sf-note{font-size:12.5px;line-height:1.45;color:var(--color-text-secondary,#64748b);margin:-4px 0 12px}
  .sf-lock{padding:14px;border-radius:12px;background:#fef2f2;border:1px solid #fecaca;color:#991b1b;font-size:14px;line-height:1.5}
  .sf-foot{display:flex;gap:10px;padding:14px 20px;border-top:1px solid var(--color-border,#e5e7eb);background:var(--color-bg,#f8fafc)}
  .sf-btn{flex:1;height:46px;border-radius:11px;border:1.5px solid transparent;font-weight:700;font-size:14.5px;cursor:pointer;font-family:inherit;display:flex;align-items:center;justify-content:center;gap:8px}
  .sf-btn.go{flex:1.6;background:var(--color-primary,#2563eb);color:#fff}
  .sf-btn.go:hover{filter:brightness(1.07)}
  .sf-btn.no{background:var(--color-surface,#fff);border-color:var(--color-border,#d1d5db);color:#b91c1c}
  .sf-btn.no:hover{background:#fef2f2;border-color:#fca5a5}
  .sf-btn[disabled]{opacity:.6;cursor:wait}
  @media(max-width:560px){
    .sf-ov{align-items:flex-end;padding:0}
    .sf-card{max-width:none;max-height:94vh;border-radius:20px 20px 0 0}
    .sf-row{grid-template-columns:1fr}
    .sf-row.keep{grid-template-columns:1fr 1fr}
    .sf-stat b{font-size:18px}
    .sf-foot{flex-direction:column-reverse}
  }
  @media(prefers-color-scheme:dark){
    :root:not([data-theme="light"]) .sf-head{background:linear-gradient(135deg,rgba(251,146,60,.12),transparent 70%)}
  }`;

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (n) => { const x = Math.round((Number(n) || 0) * 1000) / 1000; return x.toLocaleString(undefined, { maximumFractionDigits: 3 }); };
  const r3 = (n) => Math.round((Number(n) || 0) * 1000) / 1000;

  function injectStyle() {
    if (document.getElementById('sf-style')) return;
    const st = document.createElement('style'); st.id = 'sf-style'; st.textContent = CSS; document.head.appendChild(st);
  }

  /** What the signed-in cashier may do. Offline the till's stored permission is used; online the normal permission map. */
  function abilities(offline) {
    const user = window.AppShell && window.AppShell.getUser && window.AppShell.getUser();
    const can = (perm) => { try { return !!window.Permissions.can(user, perm); } catch { return true; } };
    if (offline && window.Offline && window.Offline.stock) {
      const c = window.Offline.stock.caps();
      return { receive: c.canReceiveStock !== undefined ? !!c.canReceiveStock : can('inventory.receive'), adjust: c.canAdjustStock !== undefined ? !!c.canAdjustStock : can('inventory.adjust') };
    }
    return { receive: can('inventory.receive'), adjust: can('inventory.adjust') };
  }

  const open = ({ product, needed, available, offline }) => new Promise((resolve) => {
    injectStyle();
    const ab = abilities(offline);
    const unit = product.unit && product.unit !== 'piece' ? product.unit : '';
    const avail = Math.max(0, Number(available) || 0);
    const need = Number(needed) || 0;
    const short = Math.max(0, r3(need - avail));
    const serial = !!product.trackSerialNumber;
    const trackExp = !!product.trackExpiry;
    const trackBatch = !!product.trackBatch || trackExp;
    const businessBatch = !!(window.AppShell && window.AppShell.hasFeature && window.AppShell.hasFeature('batchTracking'));
    let tab = ab.receive ? 'receive' : (ab.adjust ? 'adjust' : 'none');
    let mode = 'count'; // adjust: count | add | remove
    let removeType = 'ADJUSTMENT_OUT';
    let busy = false;

    const ov = document.createElement('div');
    ov.className = 'sf-ov';
    ov.innerHTML = `
      <div class="sf-card" role="dialog" aria-modal="true" aria-labelledby="sf-title">
        <div class="sf-head">
          <div class="sf-ico ${avail > 0 ? 'warn' : ''}"><i class="fa-solid ${avail > 0 ? 'fa-triangle-exclamation' : 'fa-box-open'}" aria-hidden="true"></i></div>
          <div class="sf-ttl">
            <h3 id="sf-title">${esc(product.name)} ${avail > 0 ? 'is running low' : 'is out of stock'}</h3>
            <p>${esc(product.sku ? `SKU ${product.sku} · ` : '')}Fix the stock here and carry on with the sale.</p>
          </div>
          <button type="button" class="sf-x" data-x aria-label="Cancel and remove from cart">&times;</button>
        </div>
        <div class="sf-body">
          <span class="sf-net ${offline ? 'off' : 'on'}"><i class="fa-solid ${offline ? 'fa-cloud-slash' : 'fa-cloud-check'}" aria-hidden="true"></i>${offline ? 'Offline: saved on this till, uploads when internet returns' : 'Online: stock updates immediately'}</span>
          <div class="sf-stats">
            <div class="sf-stat ${avail > 0 ? '' : 'bad'}"><small>In stock</small><b>${num(avail)}</b></div>
            <div class="sf-stat"><small>In cart</small><b>${num(need)}</b></div>
            <div class="sf-stat bad"><small>Short by</small><b>${num(short)}</b></div>
          </div>
          <div id="sf-main"></div>
        </div>
        <div class="sf-foot">
          <button type="button" class="sf-btn no" data-cancel><i class="fa-solid fa-trash-can" aria-hidden="true"></i><span>${avail > 0 ? `Keep ${num(avail)} only` : 'Remove from cart'}</span></button>
          <button type="button" class="sf-btn go" data-go><i class="fa-solid fa-check" aria-hidden="true"></i><span></span></button>
        </div>
      </div>`;
    document.body.appendChild(ov);
    const $ = (s) => ov.querySelector(s);
    const main = $('#sf-main'); const goBtn = $('[data-go]');

    const finish = (res) => { document.removeEventListener('keydown', onKey, true); ov.remove(); resolve(res); };
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); if (!busy) finish({ action: 'cancel' }); } };
    document.addEventListener('keydown', onKey, true);
    ov.addEventListener('mousedown', (e) => { if (e.target === ov && !busy) finish({ action: 'cancel' }); });
    $('[data-x]').addEventListener('click', () => { if (!busy) finish({ action: 'cancel' }); });
    $('[data-cancel]').addEventListener('click', () => { if (!busy) finish({ action: 'cancel' }); });

    const tabsHtml = () => `<div class="sf-tabs" role="tablist">
      <button type="button" class="sf-tab ${tab === 'receive' ? 'on' : ''}" data-tab="receive" ${ab.receive ? '' : 'disabled'}><i class="fa-solid fa-truck-ramp-box" aria-hidden="true"></i>Receive stock</button>
      <button type="button" class="sf-tab ${tab === 'adjust' ? 'on' : ''}" data-tab="adjust" ${ab.adjust ? '' : 'disabled'}><i class="fa-solid fa-sliders" aria-hidden="true"></i>Adjust stock</button></div>`;

    const receiveHtml = () => `
      <div class="sf-row">
        <div class="sf-f"><label for="sf-qty">Quantity received${unit ? ` <i>(${esc(unit)})</i>` : ''}<em>*</em></label><input id="sf-qty" class="sf-in big" type="number" min="0" step="any" inputmode="decimal" value="${short || ''}" autocomplete="off"></div>
        <div class="sf-f"><label for="sf-cost">Cost price <i>per ${esc(unit || 'unit')}, optional</i></label><div class="sf-pre"><span>${esc((window.UI && window.UI.currencySymbol && window.UI.currencySymbol()) || 'KES')}</span><input id="sf-cost" class="sf-in" type="number" min="0" step="0.01" inputmode="decimal" autocomplete="off"></div></div>
      </div>
      <div class="sf-row">
        <div class="sf-f"><label for="sf-batch">Batch number ${trackBatch && businessBatch ? '<em>*</em>' : '<i>(optional)</i>'}</label><input id="sf-batch" class="sf-in" maxlength="60" autocomplete="off" placeholder="e.g. LOT-2411"></div>
        <div class="sf-f"><label for="sf-exp">Expiry date ${trackExp ? '<em>*</em>' : '<i>(optional)</i>'}</label><input id="sf-exp" class="sf-in" type="date"></div>
      </div>
      ${trackExp ? '<p class="sf-note">This product tracks expiry. Leave the batch number empty to use one based on the expiry date.</p>' : ''}
      <div class="sf-f"><label for="sf-reason">Reason <i>(optional)</i></label><input id="sf-reason" class="sf-in" maxlength="200" value="Received at till" autocomplete="off"></div>
      <div class="sf-after" id="sf-after"></div>`;

    const adjustHtml = () => `
      <div class="sf-seg" role="tablist">
        <button type="button" class="sf-chip ${mode === 'count' ? 'on' : ''}" data-mode="count">Set counted stock</button>
        <button type="button" class="sf-chip ${mode === 'add' ? 'on' : ''}" data-mode="add">Add units</button>
        <button type="button" class="sf-chip ${mode === 'remove' ? 'on' : ''}" data-mode="remove">Remove units</button>
      </div>
      ${mode === 'remove' ? `<div class="sf-f"><label for="sf-type">What happened?</label><select id="sf-type" class="sf-in">
        <option value="ADJUSTMENT_OUT" ${removeType === 'ADJUSTMENT_OUT' ? 'selected' : ''}>Correction (counted less)</option><option value="DAMAGE" ${removeType === 'DAMAGE' ? 'selected' : ''}>Damaged</option>
        <option value="EXPIRED" ${removeType === 'EXPIRED' ? 'selected' : ''}>Expired</option><option value="LOST" ${removeType === 'LOST' ? 'selected' : ''}>Lost / stolen</option></select></div>` : ''}
      <div class="sf-f"><label for="sf-qty">${mode === 'count' ? 'Counted on the shelf now' : (mode === 'add' ? 'Quantity to add' : 'Quantity to remove')}${unit ? ` <i>(${esc(unit)})</i>` : ''}<em>*</em></label>
        <input id="sf-qty" class="sf-in big" type="number" min="0" step="any" inputmode="decimal" value="${mode === 'count' ? Math.max(need, 1) : (mode === 'add' ? (short || '') : '')}" autocomplete="off"></div>
      <div class="sf-f"><label for="sf-reason">Reason <em>*</em></label><input id="sf-reason" class="sf-in" maxlength="200" autocomplete="off" placeholder="e.g. Stock count correction">
        <div class="sf-chips">${['Stock count correction', 'Found stock on shelf', 'Not recorded earlier', 'Damaged', 'Expired'].map((t) => `<button type="button" class="sf-chip sm" data-reason="${esc(t)}">${esc(t)}</button>`).join('')}</div></div>
      <div class="sf-after" id="sf-after"></div>`;

    const lockedHtml = () => `<div class="sf-lock"><b>You do not have permission to change stock.</b><br>Ask a manager to receive or adjust it, or remove the product from the cart.</div>`;
    const serialHtml = () => `<div class="sf-lock" style="background:#fffbeb;border-color:#fde68a;color:#92400e"><b>This product is serial / IMEI tracked.</b><br>Its stock needs the serial numbers, so receive it from Inventory. You can remove it from the cart for now.</div>`;

    function qtyEl() { return $('#sf-qty'); }
    function delta() { // signed change to stock from what is typed
      const q = Number(qtyEl() && qtyEl().value);
      if (!(q >= 0) || qtyEl().value === '') return NaN;
      if (tab === 'receive') return q;
      if (mode === 'count') return r3(q - avail);
      return mode === 'add' ? q : -q;
    }
    function refreshAfter() {
      const box = $('#sf-after'); if (!box) return;
      const d = delta();
      if (Number.isNaN(d)) { box.className = 'sf-after warn'; box.innerHTML = '<span>Enter the quantity</span><b>—</b>'; goBtn.disabled = false; return; }
      const after = r3(avail + d);
      let cls = ''; let msg = `Stock after saving`;
      if (tab === 'adjust' && mode === 'count' && d === 0) { cls = 'warn'; msg = 'Same as the system figure, nothing to change'; }
      else if (after < 0) { cls = 'bad'; msg = 'Stock cannot go below zero'; }
      else if (after < need) { cls = 'warn'; msg = `Still ${num(need - after)} short for this cart`; }
      box.className = `sf-after ${cls}`; box.innerHTML = `<span>${esc(msg)}</span><b>${num(after)}</b>`;
    }
    function label() { goBtn.querySelector('span').textContent = tab === 'receive' ? 'Receive & continue sale' : tab === 'adjust' ? 'Save adjustment & continue' : 'Close'; }

    function paint() {
      if (serial || tab === 'none') { main.innerHTML = serial ? serialHtml() : lockedHtml(); goBtn.style.display = 'none'; return; }
      main.innerHTML = tabsHtml() + (tab === 'receive' ? receiveHtml() : adjustHtml());
      label(); refreshAfter();
      main.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => { if (b.disabled || tab === b.dataset.tab) return; tab = b.dataset.tab; paint(); }));
      main.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => { mode = b.dataset.mode; paint(); }));
      main.querySelectorAll('[data-reason]').forEach((b) => b.addEventListener('click', () => { const r = $('#sf-reason'); r.value = b.dataset.reason; r.classList.remove('bad'); }));
      const t = $('#sf-type'); if (t) t.addEventListener('change', () => { removeType = t.value; });
      setTimeout(() => { const q = qtyEl(); if (q) { q.focus(); q.select(); } }, 40);
    }
    main.addEventListener('input', refreshAfter);

    const bad = (el, msg) => { if (el) { el.classList.add('bad'); el.focus(); } window.UI.toast.error(msg); return false; };

    async function save() {
      if (busy) return;
      ov.querySelectorAll('.bad').forEach((e) => e.classList.remove('bad'));
      const qEl = qtyEl(); const d = delta();
      if (Number.isNaN(d)) return bad(qEl, 'Enter the quantity');
      const branchId = window.AppShell && window.AppShell.getActiveBranchId && window.AppShell.getActiveBranchId();
      busy = true; goBtn.disabled = true; goBtn.querySelector('span').textContent = 'Saving…';
      try {
        let action;
        if (tab === 'receive') {
          if (!(d > 0)) { busy = false; goBtn.disabled = false; label(); return bad(qEl, 'Quantity received must be more than zero'); }
          const exp = $('#sf-exp').value; const batch = $('#sf-batch').value.trim(); const cost = Number($('#sf-cost').value); const reason = $('#sf-reason').value.trim();
          if (trackExp && !exp) { busy = false; goBtn.disabled = false; label(); return bad($('#sf-exp'), 'Enter the expiry date for this stock'); }
          if (trackBatch && businessBatch && !batch && !exp) { busy = false; goBtn.disabled = false; label(); return bad($('#sf-batch'), 'Enter the batch number'); }
          if (offline) {
            await window.Offline.stock.receive({ productId: product._id, quantity: d, costPriceCents: cost > 0 ? Math.round(cost * 100) : undefined, batchNumber: batch || undefined, expiryDate: exp || undefined, reason: reason || undefined });
          } else {
            await window.Api.post('/inventory/receive', { branchId, productId: product._id, quantity: d, costPrice: cost > 0 ? cost : undefined, batchNumber: batch || undefined, expiryDate: exp || undefined, reason: reason || 'Received at till' });
          }
          action = 'received';
        } else {
          const reasonEl = $('#sf-reason'); const reason = reasonEl.value.trim();
          if (d === 0) { busy = false; goBtn.disabled = false; label(); return bad(qEl, 'That is the same as the current stock. Enter a different count.'); }
          if (avail + d < 0) { busy = false; goBtn.disabled = false; label(); return bad(qEl, 'You cannot remove more than the stock on hand'); }
          if (!reason) { busy = false; goBtn.disabled = false; label(); return bad(reasonEl, 'Give a reason for the adjustment'); }
          const adjustType = d > 0 ? 'ADJUSTMENT_IN' : (mode === 'remove' ? removeType : 'ADJUSTMENT_OUT');
          if (offline) await window.Offline.stock.adjust({ productId: product._id, quantity: Math.abs(d), adjustType, reason });
          else await window.Api.post('/inventory/adjust', { branchId, productId: product._id, type: adjustType, quantity: Math.abs(d), reason });
          action = 'adjusted';
        }
        window.UI.toast.success(offline ? 'Saved on this till. It uploads when the internet is back.' : (action === 'received' ? 'Stock received' : 'Stock adjusted'));
        finish({ action, quantity: d });
      } catch (err) {
        busy = false; goBtn.disabled = false; label();
        window.UI.toast.error(err && err.message ? err.message : 'Could not save the stock change');
      }
    }
    goBtn.addEventListener('click', save);
    ov.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.tagName === 'INPUT' && !busy) { e.preventDefault(); save(); } });

    paint();
  });

  window.StockFix = { open };
})(window);
