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

  /* Extra product sources for a till whose offline catalog has not downloaded yet:
     (1) the stock list last seen online (saved by remember()), (2) the product search copy kept by FastSearch. */
  const SNAP_KEY = 'pos.inv.snapshot.v1';
  let fsRows = [];
  const readSnap = () => { try { return JSON.parse(localStorage.getItem(SNAP_KEY) || '{}') || {}; } catch { return {}; } };
  const writeSnap = (m) => { try { localStorage.setItem(SNAP_KEY, JSON.stringify(m)); } catch { /* storage full: skip */ } };
  /** Called with the rows of every successful online stock list. */
  function remember(items) {
    try {
      const m = readSnap();
      (items || []).forEach((r) => {
        const pr = r.productId && typeof r.productId === 'object' ? r.productId : null;
        if (!pr || r.variantId || !pr._id) return;
        m[pr._id] = { n: pr.name, s: pr.sku || '', q: Number(r.quantity) || 0, m: Number(r.lowStockThreshold) || DEFAULT_MIN };
      });
      writeSnap(m);
    } catch { /* ignore */ }
  }
  const bump = (id, d) => { const m = readSnap(); if (m[id]) { m[id].q = Math.round(((m[id].q || 0) + d) * 1000) / 1000; writeSnap(m); } };
  function loadFastSearch() {
    return new Promise((res) => {
      try {
        if (!window.indexedDB) return res();
        const r = indexedDB.open('pos-fastsearch', 1);
        r.onupgradeneeded = () => { try { r.result.createObjectStore('rows'); } catch { /* exists */ } };
        r.onerror = () => res();
        r.onsuccess = () => {
          try {
            const db = r.result;
            if (!db.objectStoreNames.contains('rows')) return res();
            const q = db.transaction('rows').objectStore('rows').openCursor(); const out = [];
            q.onsuccess = () => { const c = q.result; if (c) { const v = c.value; if (v && Array.isArray(v.rows) && v.rows.length > out.length) { out.length = 0; v.rows.forEach((x) => out.push(x)); } c.continue(); } else { fsRows = out; res(); } };
            q.onerror = () => res();
          } catch { res(); }
        };
      } catch { res(); }
    });
  }
  async function ready() {
    if (!available()) return false;
    try { await O().init(); } catch { /* ignore */ }
    if (!O().catalog.count()) await loadFastSearch();
    return true;
  }

  function fallbackProducts() {
    const have = new Set(O().catalog.search('', 1000000).map((p) => String(p._id)));
    const out = [];
    fsRows.forEach((x) => { if (x && x._id && !have.has(String(x._id)) && x.name) { have.add(String(x._id)); out.push({ _id: x._id, name: x.name, sku: x.sku || '', trackInventory: x.trackInventory, status: x.status, trackSerialNumber: x.trackSerialNumber }); } });
    const m = readSnap();
    Object.keys(m).forEach((id) => { if (!have.has(id)) { have.add(id); out.push({ _id: id, name: m[id].n, sku: m[id].s }); } });
    return out;
  }
  const textHit = (p, t) => { t = String(t || '').toLowerCase(); return !t || String(p.name || '').toLowerCase().includes(t) || String(p.sku || '').toLowerCase().includes(t); };
  const all = () => O().catalog.search('', 1000000).concat(fallbackProducts());
  const byId = () => { const m = new Map(); all().forEach((p) => m.set(String(p._id), p)); return m; };
  const tracked = (p) => p.trackInventory !== false && p.status !== 'archived';
  const onHand = (p) => {
    const a = O().stock.available(p._id, null);
    if (a != null) return a;
    const sn = readSnap()[p._id];
    return sn ? sn.q : 0;
  };

  function rowFor(p) {
    const q = onHand(p);
    return { _id: `off-${p._id}`, productId: { _id: p._id, name: p.name, sku: p.sku }, variantId: null, quantity: q, reservedQuantity: 0, availableQuantity: q, lowStockThreshold: (readSnap()[p._id] || {}).m || DEFAULT_MIN, _offline: true };
  }
  function filtered(search) {
    const t = String(search || '').trim();
    const list = (t ? O().catalog.search(t, 1000000).concat(fallbackProducts().filter((p) => textHit(p, t))) : all()).filter(tracked);
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
  /** The saved product; if this till never downloaded it, a minimal one built from the id + name in the link. */
  const product = (id, name) => byId().get(String(id)) || (id ? { _id: String(id), name: name || 'Product', sku: '', trackInventory: true } : null);
  const current = (p) => ({ quantity: onHand(p), reserved: 0 });

  const isNetworkError = (e) => !!e && (e.code === 'NETWORK_ERROR' || e.code === 'OFFLINE' || e.status === 0 || /offline|could not reach|network|failed to fetch/i.test(String(e.message || '')));
  const noteFailure = (e) => { if (isNetworkError(e) && available()) forced = true; return forced; };
  window.addEventListener('online', () => { forced = false; });
  if (window.Connectivity && window.Connectivity.onChange) window.Connectivity.onChange((on) => { if (on) forced = false; });

  function guard(p) {
    if (!available() || !O().stock) throw new Error('Offline mode is not available on this device.');
    if (p && p.trackSerialNumber) throw new Error(`${p.name} is serial / IMEI tracked. Receive it when the till is online.`);
  }
  const NEG = /(decrease|remove|reduce|loss|lost|damage|expire|theft|stolen|minus|negative|out|write)/i;
  async function receive(o) {
    await ready(); guard(o.product);
    const had = O().stock.available(o.payload.productId, null);
    const r = await O().stock.receive(o.payload);
    if (had == null) bump(o.payload.productId, Number(o.payload.quantity) || 0);
    return r;
  }
  async function adjust(o) {
    await ready(); guard(o.product);
    const had = O().stock.available(o.payload.productId, null);
    const r = await O().stock.adjust(o.payload);
    if (had == null) bump(o.payload.productId, (NEG.test(o.payload.adjustType) ? -1 : 1) * (Number(o.payload.quantity) || 0));
    return r;
  }

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

  window.InvOffline = { remember, active, available, ready, stockPage, lowStock, product, current, pickProduct, receive, adjust, bannerHtml, isNetworkError, noteFailure };
})(window);
