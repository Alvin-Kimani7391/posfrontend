/**
 * inventory-offline.js - Inventory works with NO internet (loaded before inventory.js).
 *
 * Offline the page reads this till's saved copy (Offline.catalog + Offline.stock: the products and the stock figures the
 * till last downloaded, plus everything received / adjusted / sold offline since) and Receive / Adjust stock are saved in the
 * till's ordered outbox (STOCK_RECEIVE / STOCK_ADJUST). When the internet is back they upload with the sales: stock first,
 * then the sales that needed it. Online, nothing changes.
 *
 *   InvOffline.active()          true when the till is offline (or the server cannot be reached)
 *   InvOffline.stockPage(p)      same shape as GET /inventory
 *   InvOffline.lowStock()        same shape as GET /inventory/low-stock
 *   InvOffline.product(id)       product from the device copy
 *   InvOffline.current(p, v)     { quantity, reserved } now (includes pending offline changes)
 *   InvOffline.pickProduct(o)    product picker that searches the device copy
 *   InvOffline.receive(o) / .adjust(o)   queue a stock change
 *   InvOffline.isNetworkError(e)
 */
(function (window) {
  'use strict';
  const O = () => window.Offline;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const DEFAULT_MIN = 5;
  let forced = false; // set when a request failed because the server could not be reached

  const available = () => !!O() && !!O().catalog;
  const online = () => !window.Connectivity || window.Connectivity.isOnline();
  const active = () => available() && (forced || !online());

  async function ready() {
    if (!available()) return false;
    try { await O().init(); } catch { /* ignore */ }
    return O().catalog.count() > 0 || true;
  }

  const all = () => O().catalog.search('', 1000000);
  const byId = () => { const m = new Map(); all().forEach((p) => m.set(String(p._id), p)); return m; };
  const tracked = (p) => p.trackInventory !== false && p.status !== 'archived';
  const onHand = (p) => { const a = O().stock.available(p._id, null); return a == null ? 0 : a; };

  function rowFor(p) {
    const q = onHand(p);
    return { _id: `off-${p._id}`, productId: { _id: p._id, name: p.name, sku: p.sku }, variantId: null, quantity: q, reservedQuantity: 0, availableQuantity: q, lowStockThreshold: DEFAULT_MIN, _offline: true };
  }
  function filtered(search) {
    const t = String(search || '').trim();
    const list = (t ? O().catalog.search(t, 1000000) : all()).filter(tracked);
    return list.sort((a, b) => String(a.name).localeCompare(String(b.name)));
  }
  function paged(rows, page, limit) {
    page = Math.max(1, Number(page) || 1); limit = Math.max(1, Number(limit) || 20);
    const total = rows.length; const pages = Math.max(1, Math.ceil(total / limit));
    page = Math.min(page, pages);
    return { items: rows.slice((page - 1) * limit, page * limit), total, page, limit, pages };
  }

  async function stockPage({ search, page, limit }) {
    await ready();
    return paged(filtered(search).map(rowFor), page, limit);
  }
  async function lowStock() {
    await ready();
    const rows = all().filter(tracked).map(rowFor);
    return {
      outOfStock: rows.filter((r) => r.quantity <= 0),
      lowStock: rows.filter((r) => r.quantity > 0 && r.quantity <= r.lowStockThreshold),
    };
  }
  const product = (id) => byId().get(String(id)) || null;
  const current = (p) => ({ quantity: onHand(p), reserved: 0 });

  const isNetworkError = (e) => !!e && (e.code === 'NETWORK_ERROR' || e.code === 'OFFLINE' || e.status === 0 || /offline|could not reach|network|failed to fetch/i.test(String(e.message || '')));
  const noteFailure = (e) => { if (isNetworkError(e) && available()) forced = true; return forced; };
  window.addEventListener('online', () => { forced = false; });
  if (window.Connectivity && window.Connectivity.onChange) window.Connectivity.onChange((on) => { if (on) forced = false; });

  function guard(p) {
    if (!available() || !O().stock) throw new Error('Offline mode is not available on this device.');
    if (p && p.trackSerialNumber) throw new Error(`${p.name} is serial / IMEI tracked. Receive it when the till is online.`);
  }
  async function receive(o) { await ready(); guard(o.product); return O().stock.receive(o.payload); }
  async function adjust(o) { await ready(); guard(o.product); return O().stock.adjust(o.payload); }

  /** Small product picker that searches the device copy (the normal picker needs the server). */
  function pickProduct({ title = 'Select a product', onSelect }) {
    const modal = window.UI.openModal({
      title,
      bodyHtml: `<div class="field"><input class="input" id="io-q" type="search" placeholder="Search name, SKU or barcode" autocomplete="off"></div>
        <div id="io-list" style="max-height:50vh;overflow:auto;border:1px solid var(--color-border,#e5e7eb);border-radius:10px"></div>`,
      footerHtml: '<button class="btn btn-secondary" data-c>Close</button>',
    });
    modal.querySelector('[data-c]').addEventListener('click', window.UI.closeModal);
    const list = modal.querySelector('#io-list'); const q = modal.querySelector('#io-q');
    const paint = async () => {
      await ready();
      const rows = filtered(q.value).slice(0, 40);
      list.innerHTML = rows.length ? rows.map((p) => `<button type="button" data-id="${esc(p._id)}" class="btn btn-ghost btn-block" style="justify-content:space-between;text-align:left;border-radius:0;border-bottom:1px solid var(--color-border,#eee);padding:10px 12px">
          <span><strong>${esc(p.name)}</strong><br><span class="text-xs text-muted">${esc(p.sku || '')}</span></span><span class="text-sm">${onHand(p)} in stock</span></button>`).join('')
        : '<p class="text-muted" style="padding:16px;text-align:center">No product found on this device.</p>';
    };
    q.addEventListener('input', paint);
    list.addEventListener('click', (e) => {
      const b = e.target.closest('[data-id]'); if (!b) return;
      const p = product(b.dataset.id); if (!p) return;
      window.UI.closeModal(); onSelect({ product: p, variant: null });
    });
    paint(); setTimeout(() => q.focus(), 50);
  }

  /** Strip shown above the stock list while offline. */
  function bannerHtml() {
    const pend = O() && O().outbox && O().outbox.cached ? O().outbox.cached() : { count: 0 };
    return `<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:10px var(--space-6,16px);background:#fffbeb;border-bottom:1px solid #fde68a;color:#92400e;font-size:13.5px">
      <strong>Offline</strong><span>Showing the stock saved on this till. Receive and Adjust are saved here and upload automatically when the internet returns${pend.count ? ` (${pend.count} waiting)` : ''}.</span></div>`;
  }

  window.InvOffline = { active, available, ready, stockPage, lowStock, product, current, pickProduct, receive, adjust, bannerHtml, isNetworkError, noteFailure };
})(window);
