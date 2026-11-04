/**
 * pos-boost.js - shared helpers loaded on every page.
 *
 *  1. Font size      : A- / A+ buttons (bottom-left), saved on this device, scales the whole POS (all sizes are rem).
 *  2. Offline queue  : adding a product or changing a product / price with NO internet is saved on this device,
 *                      shown immediately in search + product lists, and sent to the server automatically when the
 *                      connection returns. Works by wrapping Api.post('/products') and Api.put('/products/:id').
 *  3. Quick add      : PosBoost.quickAdd({ name, barcode, onAdded }) - a small modal to add a product from anywhere.
 *  4. Auto print     : PosBoost.autoPrint.get() / set(bool) - whether the receipt prints after a sale (Sales page switch).
 *  5. Scanner focus  : PosBoost.keepScannerReady(inputEl) - barcode scanners type into the search box even when
 *                      the cashier has clicked elsewhere (focus returns to the box when nothing else is being edited).
 */
(function (window) {
  'use strict';

  const FONT_KEY = 'pos.fontPct';
  const QUEUE_KEY = 'pos.pendingProducts';
  const AUTOPRINT_KEY = 'pos.autoPrintReceipt';
  const $doc = document;
  const listeners = new Set();
  const emit = () => listeners.forEach((fn) => { try { fn(); } catch { /* ignore */ } });

  /* ------------------------------ 1. Font size ------------------------------ */
  const FONT_MIN = 80; const FONT_MAX = 170; const FONT_STEP = 10;
  const readFont = () => { try { const n = Number(localStorage.getItem(FONT_KEY)); return n >= FONT_MIN && n <= FONT_MAX ? n : 100; } catch { return 100; } };
  function applyFont(pct) {
    $doc.documentElement.style.fontSize = `${pct}%`;
    try { localStorage.setItem(FONT_KEY, String(pct)); } catch { /* ignore */ }
    const lbl = $doc.getElementById('pb-font-pct'); if (lbl) lbl.textContent = `${pct}%`;
  }
  applyFont(readFont()); // as early as possible

  function mountFontControl() {
    if ($doc.getElementById('pb-font')) return;
    const st = $doc.createElement('style');
    st.textContent = `
      #pb-font{position:fixed;left:10px;bottom:calc(10px + env(safe-area-inset-bottom,0px));z-index:900;display:flex;align-items:center;gap:2px;
        background:var(--color-surface,#fff);border:1px solid var(--color-border,#d0d5dd);border-radius:999px;box-shadow:0 2px 10px rgba(0,0,0,.18);padding:2px;font-size:14px}
      #pb-font button{border:0;background:transparent;color:inherit;font:inherit;font-weight:700;min-width:34px;height:34px;border-radius:999px;cursor:pointer}
      #pb-font button:hover{background:rgba(127,127,127,.18)}
      #pb-font span{min-width:42px;text-align:center;font-size:12px;opacity:.75}
      @media print{#pb-font{display:none}}
      .pb-switch{display:inline-flex;align-items:center;gap:8px;cursor:pointer;user-select:none;font-size:var(--text-sm,.8125rem);white-space:nowrap}
      .pb-switch input{width:38px;height:22px;appearance:none;-webkit-appearance:none;background:#9aa4b2;border-radius:999px;position:relative;cursor:pointer;outline:0;transition:background .15s;margin:0}
      .pb-switch input::after{content:"";position:absolute;top:2px;left:2px;width:18px;height:18px;border-radius:50%;background:#fff;transition:left .15s}
      .pb-switch input:checked{background:var(--color-success,#16a34a)}
      .pb-switch input:checked::after{left:18px}
      .pb-pending{display:inline-block;margin-left:6px;padding:1px 6px;border-radius:999px;background:#f59e0b;color:#fff;font-size:11px;font-weight:600}
      .pb-priceinp{width:5.4em;text-align:right;font:inherit;font-weight:600;padding:2px 4px;border:1px solid var(--color-border,#cbd5e1);border-radius:6px;background:var(--color-surface,#fff);color:inherit}
      .pb-priceinp.changed{border-color:var(--color-warning,#f59e0b);background:rgba(245,158,11,.12)}
      .pz-dd-add{display:flex;align-items:center;gap:8px;width:100%;padding:12px 14px;border:0;border-top:1px dashed var(--color-border,#cbd5e1);background:rgba(22,163,74,.08);color:inherit;font:inherit;font-weight:600;cursor:pointer;text-align:left}
      .pz-dd-add:hover,.pz-dd-add:focus{background:rgba(22,163,74,.18);outline:0}`;
    $doc.head.appendChild(st);
    const box = $doc.createElement('div');
    box.id = 'pb-font';
    box.setAttribute('role', 'group'); box.setAttribute('aria-label', 'Text size');
    box.innerHTML = `<button type="button" data-d="-1" aria-label="Smaller text" title="Smaller text">A−</button><span id="pb-font-pct">${readFont()}%</span><button type="button" data-d="1" aria-label="Bigger text" title="Bigger text" style="font-size:1.15em">A+</button>`;
    box.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-d]'); if (!b) return;
      applyFont(Math.min(FONT_MAX, Math.max(FONT_MIN, readFont() + Number(b.dataset.d) * FONT_STEP)));
    });
    box.querySelector('#pb-font-pct').addEventListener('dblclick', () => applyFont(100));
    $doc.body.appendChild(box);
  }
  if ($doc.readyState === 'loading') $doc.addEventListener('DOMContentLoaded', mountFontControl); else mountFontControl();

  /* ------------------------------ 2. Offline queue ------------------------------ */
  const loadQ = () => { try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]'); } catch { return []; } };
  const saveQ = (q) => { try { localStorage.setItem(QUEUE_KEY, JSON.stringify(q)); } catch { /* storage full */ } ver += 1; emit(); };
  let ver = 0;
  let queue = loadQ();
  const persist = () => saveQ(queue);
  const isNet = (err) => !!err && (err.code === 'NETWORK_ERROR' || err.code === 'TIMEOUT');
  const offlineNow = () => !!(window.Connectivity && !window.Connectivity.isOnline()) || navigator.onLine === false;
  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  const tmpId = () => `tmp_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

  function pendingProduct(job) {
    const p = job.payload || {};
    return {
      _id: job.tmpId, name: p.name || 'New product', sku: p.sku || '', barcode: p.barcode || '', brand: p.brand || '',
      costPrice: num(p.costPrice), sellingPrice: num(p.sellingPrice), defaultDiscount: num(p.defaultDiscount),
      taxRate: num(p.taxRate), status: 'active', variants: [], hasVariants: false, trackInventory: p.trackInventory !== false && !!p.trackInventory,
      _pending: true,
    };
  }

  let cachedVer = -1; let cachedIn = null; let cachedOut = null;
  /** Called by FastSearch: product list + waiting edits (new products first, edited prices applied). */
  function overlay(rows) {
    if (!queue.length) return rows;
    if (cachedVer === ver && cachedIn === rows) return cachedOut;
    const edits = new Map();
    const created = [];
    queue.forEach((j) => {
      if (j.op === 'create') created.push(pendingProduct(j));
      else if (j.op === 'update' && j.productId) edits.set(j.productId, Object.assign(edits.get(j.productId) || {}, j.payload));
    });
    // a pending create can itself be edited again while still waiting
    created.forEach((c) => { const e = edits.get(c._id); if (e) Object.assign(c, e); });
    const patched = rows.map((p) => {
      const e = edits.get(p._id);
      return e ? Object.assign({}, p, e.name !== undefined ? { name: e.name } : {}, e.sellingPrice !== undefined ? { sellingPrice: num(e.sellingPrice) } : {}, e.costPrice !== undefined ? { costPrice: num(e.costPrice) } : {}, e.barcode !== undefined ? { barcode: e.barcode } : {}, { _pending: true }) : p;
    });
    const have = new Set(patched.map((p) => p.barcode).filter(Boolean));
    cachedIn = rows; cachedVer = ver;
    cachedOut = created.filter((c) => !c.barcode || !have.has(c.barcode)).concat(patched);
    return cachedOut;
  }

  let flushing = false;
  async function flush() {
    if (flushing || !queue.length || offlineNow() || !window.Api) return;
    flushing = true;
    try {
      const idMap = {};
      while (queue.length) {
        const job = queue[0];
        try {
          if (job.op === 'create') {
            const { data } = await window.Api.post('/products', job.payload, { background: true, __pbSkip: true });
            const real = (data && (data.product || data)) || {};
            if (real._id) idMap[job.tmpId] = real._id;
          } else if (job.op === 'update') {
            const id = idMap[job.productId] || job.productId;
            if (String(id).startsWith('tmp_')) { queue.shift(); continue; } // its create failed earlier: nothing to update
            await window.Api.put(`/products/${id}`, job.payload, { background: true, __pbSkip: true });
          }
          queue.shift(); persist();
        } catch (err) {
          if (isNet(err) || err.code === 'SESSION_EXPIRED') break; // try again later
          // The server refused it (e.g. barcode already exists): keep a note, drop it so the rest can go.
          failed.push({ job, message: err.message }); queue.shift(); persist();
          window.UI?.toast?.error?.(`Saved-offline product "${(job.payload && job.payload.name) || ''}" was refused: ${err.message}`);
        }
      }
    } finally {
      flushing = false;
      if (!queue.length) { window.UI?.toast?.success?.('Offline changes sent to the server'); }
      emit(); listeners.forEach((fn) => { try { fn('synced'); } catch { /* ignore */ } });
    }
  }
  const failed = [];

  // Wrap Api.post/put for /products so the product screens work offline without changing them.
  function wrapApi() {
    const Api = window.Api; if (!Api || Api.__pbWrapped) return;
    Api.__pbWrapped = true;
    const post = Api.post.bind(Api); const put = Api.put.bind(Api);

    Api.post = async function (path, body, opts) {
      if (path !== '/products' || (opts && opts.__pbSkip)) return post(path, body, opts);
      if (!offlineNow()) {
        try { return await post(path, body, opts); } catch (err) { if (!isNet(err)) throw err; }
      }
      const job = { op: 'create', tmpId: tmpId(), payload: body, at: Date.now() };
      queue.push(job); persist();
      window.UI?.toast?.info?.('No internet: product saved on this device and will upload automatically');
      return { data: { product: pendingProduct(job), queued: true }, queued: true };
    };

    Api.put = async function (path, body, opts) {
      const m = /^\/products\/([^/]+)$/.exec(path);
      if (!m || (opts && opts.__pbSkip)) return put(path, body, opts);
      const id = m[1];
      if (!offlineNow() && !id.startsWith('tmp_')) {
        try { return await put(path, body, opts); } catch (err) { if (!isNet(err)) throw err; }
      }
      // merge into a waiting create, or a waiting update of the same product, instead of piling up jobs
      const waiting = queue.find((j) => (j.op === 'create' && j.tmpId === id) || (j.op === 'update' && j.productId === id));
      if (waiting) Object.assign(waiting.payload, body);
      else queue.push({ op: 'update', productId: id, payload: Object.assign({}, body), at: Date.now() });
      persist();
      window.UI?.toast?.info?.('No internet: change saved on this device and will upload automatically');
      return { data: { product: Object.assign({ _id: id }, body), queued: true }, queued: true };
    };
  }
  (function waitApi() { if (window.Api) wrapApi(); else setTimeout(waitApi, 30); })();

  window.addEventListener('online', () => setTimeout(flush, 800));
  if (window.Connectivity && window.Connectivity.onChange) window.Connectivity.onChange((on) => { if (on) setTimeout(flush, 800); });
  setInterval(flush, 20000);
  setTimeout(flush, 2500);

  /* ------------------------------ 3. Quick add ------------------------------ */
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /**
   * Small "add product" window usable from anywhere.
   * opts: { name, barcode, onAdded(product) }
   */
  function quickAdd(opts = {}) {
    if (!window.UI || !window.UI.openModal) return;
    const canCreate = !window.Permissions || !window.AppShell || window.Permissions.can(window.AppShell.getUser(), 'products.create');
    if (!canCreate) { window.UI.toast.error('You do not have permission to add products. Ask the owner or a manager.'); return; }
    const looksCode = /^\d{6,}$/.test(String(opts.name || '').trim());
    const name0 = looksCode ? '' : (opts.name || '');
    const bc0 = opts.barcode || (looksCode ? String(opts.name).trim() : '');
    const modal = window.UI.openModal({
      title: 'Quick add product',
      maxWidth: '440px',
      bodyHtml: `
        <form id="pb-qa-form" autocomplete="off">
          <div class="field"><label>Product name</label><input class="input" name="name" required value="${esc(name0)}" placeholder="e.g. Blue Band 500g" /></div>
          <div class="field"><label>Barcode <span class="text-muted">(optional)</span></label><input class="input" name="barcode" value="${esc(bc0)}" placeholder="Scan or type" inputmode="numeric" /></div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
            <div class="field"><label>Selling price (KES)</label><input class="input" name="sellingPrice" type="number" step="0.01" min="0" inputmode="decimal" required /></div>
            <div class="field"><label>Cost price (KES)</label><input class="input" name="costPrice" type="number" step="0.01" min="0" inputmode="decimal" placeholder="0" /></div>
          </div>
          <label class="checkbox-row"><input type="checkbox" name="trackInventory" /> <span class="text-sm">Track stock for this product (leave off to sell without stock counts)</span></label>
        </form>
        <p class="text-xs text-muted" style="margin-top:8px">Add more details (category, units, variants) later on the Products page.</p>`,
      footerHtml: '<button class="btn btn-secondary" data-action="cancel">Cancel</button><button class="btn btn-primary" data-action="save">Add &amp; use</button>',
    });
    const form = modal.querySelector('#pb-qa-form');
    const first = name0 ? form.sellingPrice : form.name;
    setTimeout(() => first && first.focus(), 30);
    const close = () => window.UI.closeModal();
    modal.querySelector('[data-action="cancel"]').addEventListener('click', close);
    let busy = false;
    async function save() {
      if (busy) return;
      const name = form.name.value.trim(); const price = Number(form.sellingPrice.value);
      if (!name) { window.UI.toast.error('Enter the product name'); form.name.focus(); return; }
      if (!(price >= 0) || form.sellingPrice.value === '') { window.UI.toast.error('Enter the selling price'); form.sellingPrice.focus(); return; }
      busy = true;
      const payload = { name, sellingPrice: price, costPrice: Number(form.costPrice.value) || 0, trackInventory: !!form.trackInventory.checked };
      const bc = form.barcode.value.trim();
      if (bc) payload.barcode = bc;
      else if (window.BarcodeLabels && window.BarcodeLabels.generateCode) { try { payload.barcode = window.BarcodeLabels.generateCode(new Set()); } catch { /* no barcode */ } }
      try {
        const res = await window.Api.post('/products', payload);
        const product = (res.data && (res.data.product || res.data)) || null;
        close(); emit();
        window.UI.toast.success(res.queued ? `${name} added (will upload when online)` : `${name} added`);
        if (opts.onAdded && product) opts.onAdded(product);
      } catch (err) { busy = false; window.UI.toast.error(err.message); }
    }
    modal.querySelector('[data-action="save"]').addEventListener('click', save);
    form.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } });
  }

  /* ------------------------------ 4. Auto print preference ------------------------------ */
  const autoPrint = {
    get() { try { const v = localStorage.getItem(AUTOPRINT_KEY); return v === null ? true : v === '1'; } catch { return true; } },
    set(on) { try { localStorage.setItem(AUTOPRINT_KEY, on ? '1' : '0'); } catch { /* ignore */ } },
  };

  /* ------------------------------ 5. Scanner always ready ------------------------------ */
  /**
   * A keyboard-wedge scanner types wherever focus is. If the cashier tapped a button or empty space, the first
   * characters would be lost. This sends focus back to the search box whenever nothing else is being edited,
   * and when a printable key arrives while no field has focus.
   */
  function keepScannerReady(getInput) {
    const input = () => (typeof getInput === 'function' ? getInput() : getInput);
    const editing = () => {
      const a = $doc.activeElement;
      return a && a !== $doc.body && (/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) || a.isContentEditable);
    };
    const modalOpen = () => !!$doc.querySelector('.modal-backdrop, .scanner-overlay');
    const refocus = () => { const el = input(); if (el && !editing() && !modalOpen()) el.focus({ preventScroll: true }); };
    $doc.addEventListener('keydown', (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1 || editing() || modalOpen()) return;
      const el = input(); if (el) el.focus({ preventScroll: true }); // the key itself is typed into it
    }, true);
    $doc.addEventListener('click', () => setTimeout(refocus, 60));
    $doc.addEventListener('focusout', () => setTimeout(refocus, 120));
    window.addEventListener('focus', () => setTimeout(refocus, 50));
    $doc.addEventListener('visibilitychange', () => { if (!$doc.hidden) setTimeout(refocus, 50); });
    setTimeout(refocus, 200);
  }

  window.PosBoost = {
    overlay, flush, quickAdd, autoPrint, keepScannerReady, applyFont,
    pendingCount: () => queue.length,
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    notifyChanged: emit,
    esc,
  };
})(window);
