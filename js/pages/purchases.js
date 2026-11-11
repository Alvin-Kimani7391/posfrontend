/**
 * purchases.js
 * Create a purchase order (items priced with the actual cost paid to the
 * supplier - that's legitimate direct input, unlike a sale price), then
 * separately mark it received (which is what actually moves inventory)
 * and record payments against it.
 *
 * VAT: the owner picks VAT mode BEFORE adding products. The real cost
 * (incl. VAT) is calculated on the frontend; the backend receives the
 * ex-VAT unitCost plus taxRate and derives its own totals.
 *
 * PRICE UPDATE: after the owner enters a product's cost, a pop-up offers to
 * update that product's selling price and per-unit discount. If accepted, the
 * item is sent with updatePrices=true and the backend saves cost price (the
 * real unit cost), selling price and discount together with the purchase.
 *
 * DRAFT: the purchase being typed is saved on this device as you type (survives refresh / closing), and offered again
 * via an "Unfinished purchase" banner until it is created or discarded.
 * SUPPLIER PRODUCTS: every product added under a supplier is remembered (unit, pieces per unit, last price) and
 * auto-filled the next time that supplier is chosen; products can be removed from the supplier's list.
 * UNIT CONVERSION: buy in Carton / Bale / Dozen... - enter pieces per unit, quantity and the price per unit (or per
 * piece); the system works out pieces received and cost per piece. Stock is always sent to the backend in pieces.
 *
 * ADD PRODUCT: a fast picker (openFastPicker) searches the device copy of the catalog (FastSearch) while you type - instant,
 *   keyboard / barcode-scanner friendly, recent products, optional "keep open" to add several.
 * SCAN INVOICE: "Scan with camera" (openDocScanner) - phone camera, auto-detect + straighten the paper, clean scanner look,
 *   several pages -> one PDF that joins the supplier invoices like an uploaded file.
 *
 * Invoices: picked files are previewed locally before upload; saved files
 * are previewed from Cloudinary in the purchase detail. Both open in the
 * same full-screen viewer.
 */
(function () {
  const state = { page: 1, limit: 10, view: 'list' };
  let returnsList = null;
  let contentEl;
  let suppliersCache = null;

  const esc = window.UI.escapeHtml;
  const VAT_LABEL = { NONE: 'No VAT', INCLUSIVE: 'Prices include VAT', EXCLUSIVE: 'Prices exclude VAT' };
  const INVOICE_MAX = 5;
  const INVOICE_MB = 10;
  const INVOICE_EXT = /\.(pdf|jpe?g|png|webp|docx?|xlsx?|csv|txt)$/i;

  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    contentEl = window.AppShell.mount({ title: 'Purchases' });
    if (!contentEl) return;
    contentEl.innerHTML = pageSkeleton();
    renderDraftBanner();
    document.getElementById('add-purchase-btn').addEventListener('click', openCreateModal);
    document.getElementById('return-purchase-btn')?.addEventListener('click', () => openReturnWizard());
    bindTabs();
    window.Permissions.applyPermissionGates(contentEl, window.AppShell.getUser());
    // Warm up in the background so "New purchase" and "Add product" open instantly: suppliers + the device copy of the catalog.
    getSuppliers().catch(() => {});
    fpWarm();
    await fetchAndRender();
  }

  /* ---------------- returns (goods sent back to the supplier) ---------------- */

  function openReturnWizard(purchaseId) {
    if (!window.PurchaseReturns) return window.UI.toast.error('Purchase returns did not load. Refresh the page.');
    window.PurchaseReturns.openWizard({
      purchaseId: purchaseId || null,
      onDone: () => { fetchAndRender(); if (state.view === 'returns' && returnsList) returnsList.reload(); },
    });
  }

  function bindTabs() {
    contentEl.querySelectorAll('.tab-btn').forEach((btn) => btn.addEventListener('click', () => {
      contentEl.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b === btn));
      state.view = btn.dataset.view;
      document.getElementById('view-list').style.display = state.view === 'list' ? '' : 'none';
      const rv = document.getElementById('view-returns');
      rv.style.display = state.view === 'returns' ? '' : 'none';
      if (state.view === 'returns') {
        if (!window.PurchaseReturns) { rv.innerHTML = window.UI.emptyStateHtml({ icon: 'alert', title: 'Purchase returns did not load', message: 'Refresh the page and try again.' }); return; }
        returnsList = window.PurchaseReturns.renderList(rv);
      }
    }));
  }

  function pageSkeleton() {
    return `
      <div class="page-header">
        <div><h1>Purchases</h1><p>Purchase orders from suppliers and stock receiving.</p></div>
        <div class="flex gap-2" style="flex-wrap:wrap">
          <button class="btn btn-primary" id="add-purchase-btn" data-requires-permission="purchases.create">${window.Icons.get('plus')} New purchase</button>
          <button class="btn btn-secondary" id="return-purchase-btn" data-requires-permission="purchases.return">${window.Icons.get('bag')} Return purchase</button>
        </div>
      </div>
      <div id="draft-banner"></div>
      <div class="card">
        <div class="tabs" style="padding: 0 var(--space-6)">
          <button class="tab-btn active" data-view="list">Purchases</button>
          <button class="tab-btn" data-view="returns" data-requires-permission="purchases.view">Purchase returns</button>
        </div>
        <div id="view-list">
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>PO #</th><th>Supplier</th><th>Date</th><th>Total</th><th>Payment</th><th>Received</th><th></th></tr></thead>
            <tbody id="purchases-tbody">${window.UI.skeletonRows(7, 5)}</tbody>
          </table>
        </div>
        <div class="pagination" id="pagination"></div>
        </div>
        <div id="view-returns" style="display:none"></div>
      </div>
    `;
  }

  const RET_BADGE = { PARTIAL: ['badge-info', 'Part returned'], FULL: ['badge-neutral', 'Returned'] };

  async function getSuppliers() {
    if (suppliersCache) return suppliersCache;
    const { data } = await window.Api.get('/suppliers', { page: 1, limit: 100 });
    suppliersCache = data.items;
    return suppliersCache;
  }

  const PAY_BADGE = { UNPAID: 'badge-danger', PARTIAL: 'badge-warning', PAID: 'badge-success' };
  const RECV_BADGE = { PENDING: 'badge-neutral', PARTIAL: 'badge-warning', RECEIVED: 'badge-success' };

  /* ---------------- VAT helpers ---------------- */

  /** entered price -> { exVat, inclVat } depending on how the owner is entering prices */
  function splitPrice(entered, mode, rate) {
    const m = 1 + (Number(rate) || 0) / 100;
    if (mode === 'EXCLUSIVE') return { exVat: entered, inclVat: entered * m };
    if (mode === 'INCLUSIVE') return { exVat: entered / m, inclVat: entered };
    return { exVat: entered, inclVat: entered };
  }

  /* ---------------- invoice file helpers ---------------- */

  const KIND_LABEL = { pdf: 'PDF', image: 'IMG', word: 'DOC', excel: 'XLS', csv: 'CSV', text: 'TXT' };

  const ICON = {
    upload: '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>',
    eye: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>',
    external: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>',
    download: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
    close: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
    clip: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>',
  };

  function kindOf(nameOrUrl, mime) {
    const clean = String(nameOrUrl || '').split('?')[0].toLowerCase();
    const ext = (clean.match(/\.([a-z0-9]+)$/) || [])[1] || '';
    if (ext === 'pdf') return 'pdf';
    if (['jpg', 'jpeg', 'png', 'webp'].includes(ext)) return 'image';
    if (['doc', 'docx'].includes(ext)) return 'word';
    if (['xls', 'xlsx'].includes(ext)) return 'excel';
    if (ext === 'csv') return 'csv';
    if (ext === 'txt') return 'text';
    if (mime && String(mime).startsWith('image/')) return 'image';
    if (mime === 'application/pdf') return 'pdf';
    return 'text';
  }

  function formatSize(bytes) {
    if (!bytes) return '';
    return bytes > 1048576 ? `${(bytes / 1048576).toFixed(1)}MB` : `${Math.max(1, Math.round(bytes / 1024))}KB`;
  }

  const extBadge = (kind, small) => `<span class="inv-ext inv-ext-${kind}${small ? ' sm' : ''}">${KIND_LABEL[kind] || 'FILE'}</span>`;

  /** Cloudinary: small cropped thumbnail for images (raw files have none). */
  const thumbUrl = (url) => (String(url).includes('/upload/') ? url.replace('/upload/', '/upload/c_fill,w_320,h_240,q_auto/') : url);
  /** Cloudinary: force a download instead of opening inline. */
  const downloadUrl = (url) => (String(url).includes('/upload/') ? url.replace('/upload/', '/upload/fl_attachment/') : url);

  /** Saved attachment (from the API) -> viewer item */
  function remoteItem(a) {
    const name = a.originalName || 'Invoice';
    return { name, size: a.size, kind: kindOf(name || a.url, a.mimeType), src: a.url, download: downloadUrl(a.url), local: false };
  }

  /** One card; used by the picker (removable) and the detail gallery. */
  function cardHtml(item, idx, removable) {
    const thumb = item.kind === 'image'
      ? `<img src="${esc(item.local ? item.src : thumbUrl(item.src))}" alt="" loading="lazy" />`
      : extBadge(item.kind);
    return `
      <div class="inv-card" data-inv="${idx}" tabindex="0" role="button" aria-label="Preview ${esc(item.name)}">
        ${removable ? `<button type="button" class="inv-rm" data-rm="${idx}" aria-label="Remove ${esc(item.name)}">&times;</button>` : ''}
        <div class="inv-thumb">${thumb}<div class="inv-thumb-hover">${ICON.eye} Preview</div></div>
        <div class="inv-meta"><div class="inv-name" title="${esc(item.name)}">${esc(item.name)}</div><div class="inv-size">${esc(KIND_LABEL[item.kind] || '')}${item.size ? ` &middot; ${formatSize(item.size)}` : ''}</div></div>
      </div>`;
  }

  function bindCards(root, items) {
    root.querySelectorAll('.inv-card').forEach((card) => {
      const open = () => openViewer(items, Number(card.dataset.inv));
      card.addEventListener('click', (e) => { if (!e.target.closest('[data-rm]')) open(); });
      card.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
    });
  }

  /** Read-only gallery shown in the purchase detail. */
  function attachmentsHtml(list) {
    if (!list || !list.length) return '';
    const items = list.map(remoteItem);
    return `
      <div class="inv-section">
        <div class="inv-section-title"><span class="text-sm font-semibold">Supplier invoices (${items.length})</span></div>
        <div class="inv-grid" id="inv-gallery">${items.map((it, i) => cardHtml(it, i, false)).join('')}</div>
      </div>`;
  }

  /* ---------------- full-screen viewer ---------------- */

  function openViewer(items, start = 0) {
    if (!items.length) return;
    let idx = Math.min(Math.max(start, 0), items.length - 1);
    let token = 0;

    const el = document.createElement('div');
    el.className = 'inv-viewer';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.innerHTML = `
      <div class="inv-viewer-bar">
        <div class="inv-viewer-title"><span id="inv-v-badge"></span><div><strong id="inv-v-name"></strong><small id="inv-v-sub"></small></div></div>
        <div class="inv-viewer-actions">
          <a class="inv-vbtn" id="inv-v-open" target="_blank" rel="noopener">${ICON.external}<span>Open</span></a>
          <a class="inv-vbtn" id="inv-v-dl">${ICON.download}<span>Download</span></a>
          <button type="button" class="inv-vbtn" id="inv-v-close" aria-label="Close">${ICON.close}</button>
        </div>
      </div>
      <div class="inv-viewer-stage" id="inv-v-stage"></div>
      ${items.length > 1 ? `<button type="button" class="inv-nav prev" aria-label="Previous">&#8249;</button><button type="button" class="inv-nav next" aria-label="Next">&#8250;</button>` : ''}
      ${items.length > 1 ? `<div class="inv-strip" id="inv-v-strip"></div>` : ''}`;
    document.body.appendChild(el);

    const stage = el.querySelector('#inv-v-stage');

    const unavailable = (item, msg) => `
      <div class="inv-unavail">${extBadge(item.kind)}<strong>${esc(item.name)}</strong><p>${msg}</p>
      ${item.local ? '' : `<a class="inv-vbtn" href="${esc(item.src)}" target="_blank" rel="noopener">${ICON.external} Open file</a>`}</div>`;

    async function renderStage() {
      const item = items[idx];
      const my = ++token;
      stage.classList.remove('zoomed');
      stage.innerHTML = '';

      if (item.kind === 'image') {
        stage.innerHTML = `<img src="${esc(item.src)}" alt="${esc(item.name)}" />`;
        stage.querySelector('img').addEventListener('click', () => stage.classList.toggle('zoomed'));
      } else if (item.kind === 'pdf') {
        stage.innerHTML = `<iframe class="inv-frame" src="${esc(item.src)}" title="${esc(item.name)}"></iframe><div class="inv-hint">PDF not showing? Use “Open” above.</div>`;
      } else if (item.kind === 'text' || item.kind === 'csv') {
        stage.innerHTML = '<div class="inv-unavail"><p>Loading preview…</p></div>';
        try {
          const text = item.local ? await item.file.text() : await (await fetch(item.src)).text();
          if (my !== token) return;
          stage.innerHTML = `<pre class="inv-text"></pre>`;
          stage.querySelector('pre').textContent = text.slice(0, 200000);
        } catch {
          if (my !== token) return;
          stage.innerHTML = unavailable(item, 'This file can’t be previewed here. Use Open or Download.');
        }
      } else if (item.local) {
        stage.innerHTML = unavailable(item, 'Word and Excel files can’t be previewed before saving. After you create the purchase you can preview it from the purchase details.');
      } else {
        // Word / Excel: Google's viewer (the Cloudinary link is public)
        const gview = `https://docs.google.com/gview?embedded=true&url=${encodeURIComponent(item.src)}`;
        stage.innerHTML = `<iframe class="inv-frame" src="${esc(gview)}" title="${esc(item.name)}"></iframe><div class="inv-hint">Preview not loading? Use “Download” above.</div>`;
      }
    }

    function render() {
      const item = items[idx];
      el.querySelector('#inv-v-badge').innerHTML = extBadge(item.kind, true);
      el.querySelector('#inv-v-name').textContent = item.name;
      el.querySelector('#inv-v-sub').textContent = [item.size ? formatSize(item.size) : '', items.length > 1 ? `${idx + 1} of ${items.length}` : ''].filter(Boolean).join(' · ');
      const open = el.querySelector('#inv-v-open');
      const dl = el.querySelector('#inv-v-dl');
      open.href = item.src;
      dl.href = item.local ? item.src : item.download;
      if (item.local) dl.setAttribute('download', item.name); else dl.removeAttribute('download');

      const strip = el.querySelector('#inv-v-strip');
      if (strip) {
        strip.innerHTML = items.map((it, i) => `<button type="button" class="${i === idx ? 'active' : ''}" data-go="${i}" aria-label="${esc(it.name)}">${it.kind === 'image' ? `<img src="${esc(it.local ? it.src : thumbUrl(it.src))}" alt="" />` : extBadge(it.kind, true)}</button>`).join('');
        strip.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => { idx = Number(b.dataset.go); render(); }));
      }
      renderStage();
    }

    const go = (d) => { idx = (idx + d + items.length) % items.length; render(); };
    const close = () => { document.removeEventListener('keydown', onKey, true); el.remove(); };
    function onKey(e) {
      if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); close(); }
      else if (e.key === 'ArrowLeft' && items.length > 1) go(-1);
      else if (e.key === 'ArrowRight' && items.length > 1) go(1);
    }

    el.querySelector('#inv-v-close').addEventListener('click', close);
    el.querySelector('.prev')?.addEventListener('click', () => go(-1));
    el.querySelector('.next')?.addEventListener('click', () => go(1));
    document.addEventListener('keydown', onKey, true);
    render();
  }

  /* PU-BLOCK-BEGIN ------------------------------------------------------------------------------------------
   * 1) FAST PRODUCT PICKER   - opens instantly, searches the device copy of the catalog while you type (no waiting on the
   *                            server), keyboard / barcode-scanner friendly, recent products, optional "keep open" mode.
   * 2) DOCUMENT SCANNER      - phone camera -> auto-crop + straighten -> clean "scanner" look -> multi-page PDF that is added
   *                            to the supplier invoices (same as an uploaded file).
   * ------------------------------------------------------------------------------------------------------------ */

  /* ============================ FAST PRODUCT PICKER ============================ */
  const FP_RECENT_KEY = () => `pos.purchasePicker.recent.v1:${userKey()}`;
  const FP_KEEP_KEY = () => `pos.purchasePicker.keep.v1:${userKey()}`;
  let fpIndex = null;

  /** The device copy of the catalog (js/core/fast-search.js). `false` when that helper is not loaded: the server answers instead. */
  function fpGetIndex() {
    if (fpIndex !== null) return fpIndex;
    try {
      fpIndex = window.FastSearch && typeof window.FastSearch.create === 'function'
        ? window.FastSearch.create({
          params: () => ({ status: 'active', branchId: (window.AppShell.getActiveBranchId && window.AppShell.getActiveBranchId()) || undefined }),
          ttl: 60000, hydrate: true, serveStale: true,
        })
        : false;
    } catch (e) { fpIndex = false; }
    return fpIndex;
  }
  /** Download / refresh the catalog quietly in the background (called when the page opens and when New purchase opens). */
  function fpWarm() {
    try { const ix = fpGetIndex(); if (ix && typeof ix.load === 'function') Promise.resolve(ix.load()).catch(() => {}); } catch (e) { /* ignore */ }
  }
  const fpServerSearch = (term) => window.Api.get('/products', {
    search: term, limit: 30, status: 'active', branchId: (window.AppShell.getActiveBranchId && window.AppShell.getActiveBranchId()) || undefined,
  }).then((r) => (r.data && (r.data.items || r.data.products)) || []);

  const fpVarLabel = (v) => (v ? Object.values(v.attributes || {}).filter(Boolean).join(', ') : '');
  const fpEntryKey = (e) => `${e.product._id}|${e.variant ? e.variant._id : ''}`;

  /** products -> one row per sellable thing (a product, or each of its variants). Exact barcode / SKU matches come first. */
  function fpEntries(products, term) {
    const t = String(term || '').trim().toLowerCase();
    const out = []; const seen = new Set();
    for (const p of products || []) {
      if (!p || !p._id || p.unit === 'service' || p._pending) continue;
      const vs = Array.isArray(p.variants) ? p.variants.filter((v) => v && v.status !== 'inactive') : [];
      const rows = vs.length ? vs.map((v) => ({ product: p, variant: v })) : [{ product: p, variant: null }];
      rows.forEach((e) => { const k = fpEntryKey(e); if (!seen.has(k)) { seen.add(k); out.push(e); } });
    }
    if (t) {
      const exact = (e) => [e.variant && e.variant.barcode, e.variant && e.variant.sku, e.product.barcode, e.product.sku].some((x) => x && String(x).trim().toLowerCase() === t);
      out.sort((a, b) => (exact(b) ? 1 : 0) - (exact(a) ? 1 : 0));
    }
    return out.slice(0, 40);
  }

  const PICKER_CSS = `
    .fp-ov{position:fixed;inset:0;z-index:10000;background:rgba(15,23,42,.55);display:flex;align-items:flex-start;justify-content:center;padding:6vh 12px 12px;backdrop-filter:blur(2px)}
    .fp-box{width:100%;max-width:640px;max-height:86vh;display:flex;flex-direction:column;background:var(--color-surface,#fff);color:var(--color-text,#0f172a);border-radius:16px;box-shadow:0 24px 60px rgba(0,0,0,.35);overflow:hidden;animation:fp-in .12s ease-out}
    @keyframes fp-in{from{transform:translateY(8px);opacity:0}to{transform:none;opacity:1}}
    .fp-head{display:flex;align-items:center;gap:10px;padding:12px 14px 0}
    .fp-title{font-weight:800;font-size:16px;flex:1}
    .fp-count{display:inline-block;margin-left:6px;padding:1px 8px;border-radius:999px;background:var(--color-primary,#4f46e5);color:#fff;font-size:12px}
    .fp-x{border:0;background:transparent;font-size:24px;line-height:1;cursor:pointer;color:inherit;padding:4px 8px;border-radius:8px}
    .fp-x:hover{background:var(--color-surface-2,rgba(127,127,127,.12))}
    .fp-search{padding:10px 14px 6px}
    .fp-search input{width:100%;height:46px;font-size:16px}
    .fp-multi{display:flex;align-items:center;gap:8px;padding:0 14px 8px;font-size:12.5px;color:var(--color-text-secondary,#64748b);cursor:pointer}
    .fp-list{overflow:auto;padding:4px 8px 8px;min-height:140px;flex:1;overscroll-behavior:contain}
    .fp-row{display:flex;align-items:center;gap:12px;width:100%;text-align:left;border:1px solid transparent;background:transparent;color:inherit;font:inherit;padding:10px 12px;border-radius:12px;cursor:pointer}
    .fp-row:hover,.fp-row.on{background:var(--color-primary-50,#eef2ff);border-color:var(--color-primary,#4f46e5)}
    .fp-main{flex:1;min-width:0;display:flex;flex-direction:column}
    .fp-main b{font-size:14.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .fp-main small,.fp-side small{font-size:12px;color:var(--color-text-secondary,#64748b);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .fp-side{display:flex;flex-direction:column;align-items:flex-end;flex:none}
    .fp-side b{font-size:14px}
    .fp-tag{display:inline-block;margin-left:6px;padding:0 7px;border-radius:999px;background:#dcfce7;color:#166534;font-size:11px;font-weight:700;vertical-align:1px}
    .fp-note{padding:26px 14px;text-align:center;color:var(--color-text-secondary,#64748b);font-size:13.5px}
    .fp-sec{padding:8px 12px 2px;font-size:11px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--color-text-secondary,#64748b)}
    .fp-ov [hidden]{display:none!important}
    .fp-skel{height:54px;margin:6px 4px;border-radius:12px;background:linear-gradient(90deg,rgba(127,127,127,.1),rgba(127,127,127,.2),rgba(127,127,127,.1));background-size:200% 100%;animation:fp-sh 1s linear infinite}
    @keyframes fp-sh{to{background-position:-200% 0}}
    .fp-foot{display:flex;gap:8px;align-items:center;justify-content:space-between;padding:10px 14px;border-top:1px solid var(--color-border,#e2e8f0);font-size:12px;color:var(--color-text-secondary,#64748b)}
    @media (max-width:640px){.fp-ov{padding:0;align-items:stretch}.fp-box{max-width:none;max-height:none;border-radius:0}}
  `;
  function fpStyle() {
    if (document.getElementById('fp-style')) return;
    const st = document.createElement('style'); st.id = 'fp-style'; st.textContent = PICKER_CSS; document.head.appendChild(st);
  }

  /**
   * opts: { onSelect({product, variant}), has(entry) -> quantity already on the purchase (0 when none) }
   * Returns { close() }.
   */
  function openFastPicker(opts) {
    fpStyle(); fpWarm();
    const money = window.UI.formatMoney;
    const ix = fpGetIndex();
    let seq = 0; let entries = []; let active = 0; let added = 0; let term = ''; let closed = false; let failed = false;
    let keepOpen = !!lsGet(FP_KEEP_KEY(), false);

    const el = document.createElement('div');
    el.className = 'fp-ov'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Add product');
    el.innerHTML = `
      <div class="fp-box">
        <div class="fp-head"><div class="fp-title">Add product<span class="fp-count" hidden></span></div><button type="button" class="fp-x" aria-label="Close">&times;</button></div>
        <div class="fp-search"><input class="input" type="search" placeholder="Search name, SKU or scan a barcode…" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="search" aria-label="Search products" /></div>
        <label class="fp-multi"><input type="checkbox" /> Keep this window open to add several products</label>
        <div class="fp-list" role="listbox" aria-label="Products"></div>
        <div class="fp-foot"><span>↑ ↓ to move, Enter to add, Esc to close</span><button type="button" class="btn btn-ghost btn-sm" data-browse hidden>Browse full list</button></div>
      </div>`;
    document.body.appendChild(el);
    const input = el.querySelector('input[type="search"]');
    const keepBox = el.querySelector('.fp-multi input');
    const list = el.querySelector('.fp-list');
    const countEl = el.querySelector('.fp-count');
    const browseBtn = el.querySelector('[data-browse]');
    keepBox.checked = keepOpen;
    if (window.ProductPicker && typeof window.ProductPicker.open === 'function') browseBtn.hidden = false;

    const recents = () => (lsGet(FP_RECENT_KEY(), []) || []).filter((r) => r && r.product && r.product._id);
    const remember = (e) => {
      const lean = { product: { ...leanProduct(e.product), barcode: e.product.barcode }, variant: leanVariant(e.variant) };
      const k = fpEntryKey(lean);
      lsSet(FP_RECENT_KEY(), [lean].concat(recents().filter((r) => fpEntryKey(r) !== k)).slice(0, 12));
    };

    function rowHtml(e, i) {
      const p = e.product; const v = e.variant;
      const sub = [fpVarLabel(v), (v && v.sku) || p.sku, (v && v.barcode) || p.barcode].filter(Boolean).join(' · ');
      const cost = v && v.costPrice != null ? v.costPrice : p.costPrice;
      const qty = opts.has ? Number(opts.has(e)) || 0 : 0;
      return `<button type="button" class="fp-row${i === active ? ' on' : ''}" role="option" data-i="${i}" aria-selected="${i === active}">
        <span class="fp-main"><b>${esc(p.name)}${v && fpVarLabel(v) ? ` <span style="font-weight:600;opacity:.7">– ${esc(fpVarLabel(v))}</span>` : ''}${qty ? `<span class="fp-tag">in purchase ×${fmtN(qty)}</span>` : ''}</b><small>${esc(sub) || '&nbsp;'}</small></span>
        <span class="fp-side"><b>${money(Number(cost) || 0)}</b><small>last cost</small></span></button>`;
    }

    function paint(state) {
      if (closed) return;
      if (!entries.length) {
        if (state === 'loading') list.innerHTML = '<div class="fp-skel"></div><div class="fp-skel"></div><div class="fp-skel"></div>';
        else if (state === 'error') list.innerHTML = '<div class="fp-note">Could not search right now. Check your connection and try again.</div>';
        else if (!term) list.innerHTML = '<div class="fp-note">Type a product name or SKU, or scan its barcode.</div>';
        else list.innerHTML = `<div class="fp-note">No product matches “${esc(term)}”.<br/>Check the spelling, or add the product in Products first.</div>`;
        return;
      }
      list.innerHTML = (term ? '' : '<div class="fp-sec">Recently added</div>') + entries.map(rowHtml).join('');
      const on = list.querySelector('.fp-row.on'); if (on && on.scrollIntoView) on.scrollIntoView({ block: 'nearest' });
    }

    function setActive(n) {
      if (!entries.length) return;
      active = (n + entries.length) % entries.length;
      list.querySelectorAll('.fp-row').forEach((r, i) => { r.classList.toggle('on', i === active); r.setAttribute('aria-selected', String(i === active)); });
      const on = list.querySelector('.fp-row.on'); if (on && on.scrollIntoView) on.scrollIntoView({ block: 'nearest' });
    }

    function serverFill(t, my, replace) {
      fpServerSearch(t).then((items) => {
        if (my !== seq || closed) return;
        failed = false;
        const fresh = fpEntries(items, t);
        if (replace || !entries.length) { entries = fresh; active = 0; }
        else { const have = new Set(entries.map(fpEntryKey)); fresh.forEach((e) => { if (!have.has(fpEntryKey(e))) entries.push(e); }); }
        paint();
      }).catch(() => { if (my === seq && !closed && !entries.length) { failed = true; paint('error'); } });
    }

    function search(raw) {
      term = String(raw || '').trim(); const my = ++seq;
      if (!term) { entries = recents().map((r) => ({ product: r.product, variant: r.variant })); active = 0; paint(); return; }
      let local = null;
      if (ix) { try { local = ix.search(term, 40); } catch (e) { local = null; } }
      if (Array.isArray(local)) { // answered from the device copy: instant
        entries = fpEntries(local, term); active = 0; paint();
        if (term.length >= 2 && entries.length < 3) serverFill(term, my, false); // quietly catch products newer than the device copy
        return;
      }
      entries = []; paint('loading'); serverFill(term, my, true);
    }

    function updateCount() { countEl.hidden = !added; countEl.textContent = added ? `${added} added` : ''; }

    function close() {
      if (closed) return; closed = true;
      document.removeEventListener('keydown', onKey, true);
      el.remove();
    }

    function select(i) {
      const e = entries[i]; if (!e) return;
      remember(e); added += 1;
      try { opts.onSelect({ product: e.product, variant: e.variant }); }
      catch (err) { added -= 1; window.UI.toast.error('Could not add that product'); return; }
      if (keepOpen) {
        updateCount(); paint(); input.focus(); input.select();
        setTimeout(() => { if (!closed) input.focus(); }, 0); // the purchase list grabs focus for the new line; take it back
      } else close();
    }

    function onKey(ev) {
      if (closed) return;
      if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); close(); return; }
      if (!el.contains(ev.target)) return;
      if (ev.key === 'ArrowDown') { ev.preventDefault(); setActive(active + 1); }
      else if (ev.key === 'ArrowUp') { ev.preventDefault(); setActive(active - 1); }
      else if (ev.key === 'Enter' && ev.target === input) { ev.preventDefault(); if (entries.length) select(active); else if (term && !failed) { search(term); } }
    }
    document.addEventListener('keydown', onKey, true);

    input.addEventListener('input', () => search(input.value));
    list.addEventListener('click', (ev) => { const r = ev.target.closest('.fp-row'); if (r) select(Number(r.dataset.i)); });
    list.addEventListener('mousemove', (ev) => { const r = ev.target.closest('.fp-row'); if (r && Number(r.dataset.i) !== active) setActive(Number(r.dataset.i)); });
    keepBox.addEventListener('change', () => { keepOpen = keepBox.checked; lsSet(FP_KEEP_KEY(), keepOpen); input.focus(); });
    el.querySelector('.fp-x').addEventListener('click', close);
    el.addEventListener('mousedown', (ev) => { if (ev.target === el) close(); });
    browseBtn.addEventListener('click', () => { close(); try { window.ProductPicker.open({ onSelect: opts.onSelect }); } catch (e) { window.UI.toast.error('Could not open the full list'); } });

    search('');
    requestAnimationFrame(() => { if (!closed) input.focus(); });
    return { close };
  }

  /* ============================ DOCUMENT SCANNER ============================ */
  const DS_MAX_SIDE = 1800;   // longest side of a saved page (sharp enough to read, small enough to upload fast)
  const DS_SRC_SIDE = 2600;   // longest side kept while editing

  const dsDist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

  /** Fit a canvas into maxSide. */
  function dsFit(src, maxSide) {
    const s = Math.min(1, maxSide / Math.max(src.width, src.height));
    if (s >= 1) return src;
    const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(src.width * s)); c.height = Math.max(1, Math.round(src.height * s));
    const x = c.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(src, 0, 0, c.width, c.height);
    return c;
  }

  /** Guess where the paper is: the biggest bright area against a darker background; its 4 outermost points are the corners. */
  function dsAutoCorners(canvas) {
    const w = canvas.width; const h = canvas.height;
    const inset = (f) => [[w * f, h * f], [w * (1 - f), h * f], [w * (1 - f), h * (1 - f)], [w * f, h * (1 - f)]];
    try {
      const sc = 200 / Math.max(w, h); const sw = Math.max(8, Math.round(w * sc)); const sh = Math.max(8, Math.round(h * sc));
      const t = document.createElement('canvas'); t.width = sw; t.height = sh;
      const tx = t.getContext('2d', { willReadFrequently: true }); tx.drawImage(canvas, 0, 0, sw, sh);
      const d = tx.getImageData(0, 0, sw, sh).data; const n = sw * sh; const lum = new Uint8Array(n); const hist = new Array(256).fill(0);
      for (let i = 0; i < n; i++) { const v = (d[i * 4] * 77 + d[i * 4 + 1] * 150 + d[i * 4 + 2] * 29) >> 8; lum[i] = v; hist[v]++; }
      let sum = 0; for (let i = 0; i < 256; i++) sum += i * hist[i];
      let wB = 0; let sB = 0; let best = 0; let thr = 128;
      for (let i = 0; i < 256; i++) { wB += hist[i]; if (!wB) continue; const wF = n - wB; if (!wF) break; sB += i * hist[i]; const mB = sB / wB; const mF = (sum - sB) / wF; const bt = wB * wF * (mB - mF) * (mB - mF); if (bt > best) { best = bt; thr = i; } }
      const mask = new Uint8Array(n); for (let i = 0; i < n; i++) mask[i] = lum[i] > thr ? 1 : 0;
      // fill small holes (printed text) so the paper is one solid blob: close = dilate then erode (3x3)
      const dil = (m) => { const o = new Uint8Array(n); for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) { let v = 0; for (let dy = -2; dy <= 2 && !v; dy++) for (let dx = -2; dx <= 2; dx++) { const yy = y + dy; const xx = x + dx; if (yy >= 0 && yy < sh && xx >= 0 && xx < sw && m[yy * sw + xx]) { v = 1; break; } } o[y * sw + x] = v; } return o; };
      const ero = (m) => { const o = new Uint8Array(n); for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) { let v = 1; for (let dy = -2; dy <= 2 && v; dy++) for (let dx = -2; dx <= 2; dx++) { const yy = y + dy; const xx = x + dx; if (yy < 0 || yy >= sh || xx < 0 || xx >= sw || !m[yy * sw + xx]) { v = 0; break; } } o[y * sw + x] = v; } return o; };
      const closed = ero(dil(mask));
      // biggest connected blob
      const lab = new Int32Array(n); let bestLab = 0; let bestSize = 0; let cur = 0; const stack = [];
      for (let i = 0; i < n; i++) {
        if (!closed[i] || lab[i]) continue;
        cur++; let size = 0; stack.push(i); lab[i] = cur;
        while (stack.length) {
          const k = stack.pop(); size++; const x = k % sw; const y = (k / sw) | 0;
          if (x > 0 && closed[k - 1] && !lab[k - 1]) { lab[k - 1] = cur; stack.push(k - 1); }
          if (x < sw - 1 && closed[k + 1] && !lab[k + 1]) { lab[k + 1] = cur; stack.push(k + 1); }
          if (y > 0 && closed[k - sw] && !lab[k - sw]) { lab[k - sw] = cur; stack.push(k - sw); }
          if (y < sh - 1 && closed[k + sw] && !lab[k + sw]) { lab[k + sw] = cur; stack.push(k + sw); }
        }
        if (size > bestSize) { bestSize = size; bestLab = cur; }
      }
      if (!bestLab || bestSize / n < 0.18 || bestSize / n > 0.96) return inset(0.06);
      // 4 outermost points of the blob = corners of the paper
      let tl = null; let tr = null; let br = null; let bl = null; let sTL = Infinity; let sBR = -Infinity; let dTR = -Infinity; let dBL = Infinity;
      for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
        if (lab[y * sw + x] !== bestLab) continue;
        const a2 = x + y; const b2 = x - y;
        if (a2 < sTL) { sTL = a2; tl = [x, y]; } if (a2 > sBR) { sBR = a2; br = [x + 1, y + 1]; }
        if (b2 > dTR) { dTR = b2; tr = [x + 1, y]; } if (b2 < dBL) { dBL = b2; bl = [x, y + 1]; }
      }
      if (!tl || !tr || !br || !bl) return inset(0.06);
      const cx = (tl[0] + tr[0] + br[0] + bl[0]) / 4; const cy = (tl[1] + tr[1] + br[1] + bl[1]) / 4;
      const out = [tl, tr, br, bl].map(([x, y]) => { const k = 1.006; return [Math.min(sw, Math.max(0, cx + (x - cx) * k)) / sw * w, Math.min(sh, Math.max(0, cy + (y - cy) * k)) / sh * h]; });
      const area = Math.abs((out[0][0] * out[1][1] - out[1][0] * out[0][1]) + (out[1][0] * out[2][1] - out[2][0] * out[1][1]) + (out[2][0] * out[3][1] - out[3][0] * out[2][1]) + (out[3][0] * out[0][1] - out[0][0] * out[3][1])) / 2;
      if (area / (w * h) < 0.18) return inset(0.06);
      return out;
    } catch (e) { return inset(0.06); }
  }

  /** Straighten: map the 4 corners (TL, TR, BR, BL) onto a flat rectangle (perspective transform, bilinear sampling). */
  function dsWarp(src, q) {
    const W0 = Math.max(dsDist(q[0], q[1]), dsDist(q[3], q[2])); const H0 = Math.max(dsDist(q[0], q[3]), dsDist(q[1], q[2]));
    const s = Math.min(1, DS_MAX_SIDE / Math.max(W0, H0, 1));
    const W = Math.max(8, Math.round(W0 * s)); const H = Math.max(8, Math.round(H0 * s));
    const sw = src.width; const sh = src.height;
    const sd = src.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, sw, sh).data;
    const out = document.createElement('canvas'); out.width = W; out.height = H;
    const octx = out.getContext('2d'); const od = octx.createImageData(W, H); const o = od.data;
    const [x0, y0] = q[0]; const [x1, y1] = q[1]; const [x2, y2] = q[2]; const [x3, y3] = q[3];
    const dx1 = x1 - x2; const dx2 = x3 - x2; const dx3 = x0 - x1 + x2 - x3;
    const dy1 = y1 - y2; const dy2 = y3 - y2; const dy3 = y0 - y1 + y2 - y3;
    let g = 0; let h = 0; let a; let b; let c; let d; let e; let f;
    if (Math.abs(dx3) < 1e-9 && Math.abs(dy3) < 1e-9) { a = x1 - x0; b = x3 - x0; c = x0; d = y1 - y0; e = y3 - y0; f = y0; }
    else {
      const den = dx1 * dy2 - dy1 * dx2 || 1e-9;
      g = (dx3 * dy2 - dy3 * dx2) / den; h = (dx1 * dy3 - dy1 * dx3) / den;
      a = x1 - x0 + g * x1; b = x3 - x0 + h * x3; c = x0; d = y1 - y0 + g * y1; e = y3 - y0 + h * y3; f = y0;
    }
    let p = 0;
    for (let y = 0; y < H; y++) {
      const v = (y + 0.5) / H;
      for (let x = 0; x < W; x++) {
        const u = (x + 0.5) / W; const den = g * u + h * v + 1;
        let sx = (a * u + b * v + c) / den - 0.5; let sy = (d * u + e * v + f) / den - 0.5;
        if (sx < 0) sx = 0; else if (sx > sw - 1) sx = sw - 1; if (sy < 0) sy = 0; else if (sy > sh - 1) sy = sh - 1;
        const ix = sx | 0; const iy = sy | 0; const fx = sx - ix; const fy = sy - iy; const ix2 = ix + 1 < sw ? ix + 1 : ix; const iy2 = iy + 1 < sh ? iy + 1 : iy;
        const i00 = (iy * sw + ix) * 4; const i10 = (iy * sw + ix2) * 4; const i01 = (iy2 * sw + ix) * 4; const i11 = (iy2 * sw + ix2) * 4;
        const w00 = (1 - fx) * (1 - fy); const w10 = fx * (1 - fy); const w01 = (1 - fx) * fy; const w11 = fx * fy;
        o[p] = sd[i00] * w00 + sd[i10] * w10 + sd[i01] * w01 + sd[i11] * w11;
        o[p + 1] = sd[i00 + 1] * w00 + sd[i10 + 1] * w10 + sd[i01 + 1] * w01 + sd[i11 + 1] * w11;
        o[p + 2] = sd[i00 + 2] * w00 + sd[i10 + 2] * w10 + sd[i01 + 2] * w01 + sd[i11 + 2] * w11;
        o[p + 3] = 255; p += 4;
      }
    }
    octx.putImageData(od, 0, 0);
    return out;
  }

  /** 'original' | 'enhance' (even lighting, whiter paper, colour kept) | 'bw' (grayscale, high contrast). */
  function dsFilter(src, mode) {
    if (mode === 'original') return src;
    const w = src.width; const h = src.height;
    // Paper colour map: shrink the page, push the brightest paper colour over the ink (max filter), blow it back up.
    const sw = Math.max(3, Math.ceil(w / 16)); const sh = Math.max(3, Math.ceil(h / 16));
    const small = document.createElement('canvas'); small.width = sw; small.height = sh;
    const sx = small.getContext('2d', { willReadFrequently: true }); sx.imageSmoothingQuality = 'high'; sx.drawImage(src, 0, 0, sw, sh);
    const sImg = sx.getImageData(0, 0, sw, sh); let cur2 = sImg.data;
    for (let pass = 0; pass < 2; pass++) {
      const nx = new Uint8ClampedArray(cur2.length);
      for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
        let r = 0; let g2 = 0; let b2 = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const yy = Math.min(sh - 1, Math.max(0, y + dy)); const xx = Math.min(sw - 1, Math.max(0, x + dx)); const k2 = (yy * sw + xx) * 4; if (cur2[k2] > r) r = cur2[k2]; if (cur2[k2 + 1] > g2) g2 = cur2[k2 + 1]; if (cur2[k2 + 2] > b2) b2 = cur2[k2 + 2]; }
        const o2 = (y * sw + x) * 4; nx[o2] = r; nx[o2 + 1] = g2; nx[o2 + 2] = b2; nx[o2 + 3] = 255;
      }
      cur2 = nx;
    }
    sImg.data.set(cur2); sx.putImageData(sImg, 0, 0);
    const bgc = document.createElement('canvas'); bgc.width = w; bgc.height = h;
    const bx = bgc.getContext('2d', { willReadFrequently: true }); bx.imageSmoothingEnabled = true; bx.imageSmoothingQuality = 'high'; bx.drawImage(small, 0, 0, w, h);
    const bg = bx.getImageData(0, 0, w, h).data;
    const out = document.createElement('canvas'); out.width = w; out.height = h;
    const ox = out.getContext('2d'); const img = src.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h); const d = img.data;
    const lo = mode === 'bw' ? 105 : 55; const hi = mode === 'bw' ? 195 : 238; const k = 255 / (hi - lo);
    for (let i = 0; i < d.length; i += 4) {
      const bl = Math.max(70, (bg[i] * 77 + bg[i + 1] * 150 + bg[i + 2] * 29) >> 8); const gain = 255 / bl;
      let r = d[i] * gain; let gg = d[i + 1] * gain; let b = d[i + 2] * gain;
      if (mode === 'bw') { const l = (r * 77 + gg * 150 + b * 29) / 256; r = gg = b = l; }
      r = (r - lo) * k; gg = (gg - lo) * k; b = (b - lo) * k;
      d[i] = r < 0 ? 0 : r > 255 ? 255 : r; d[i + 1] = gg < 0 ? 0 : gg > 255 ? 255 : gg; d[i + 2] = b < 0 ? 0 : b > 255 ? 255 : b;
    }
    ox.putImageData(img, 0, 0);
    return out;
  }

  function dsRotate(src) {
    const c = document.createElement('canvas'); c.width = src.height; c.height = src.width;
    const x = c.getContext('2d'); x.translate(c.width, 0); x.rotate(Math.PI / 2); x.drawImage(src, 0, 0);
    return c;
  }

  const dsToJpeg = (canvas, q) => new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('Could not encode the page'))), 'image/jpeg', q));

  /** Pages (canvases) -> one PDF (each page is a JPEG). Smaller JPEG quality is tried if the file would be too large. */
  async function dsBuildPdf(canvases, limitBytes) {
    let jpgs = null;
    for (const q of [0.82, 0.7, 0.58, 0.45]) {
      const parts = [];
      for (const c of canvases) { const b = await dsToJpeg(c, q); parts.push(new Uint8Array(await b.arrayBuffer())); }
      jpgs = parts;
      if (parts.reduce((n, p) => n + p.length, 0) < limitBytes * 0.95) break;
    }
    const enc = new TextEncoder(); const chunks = []; const offsets = []; let pos = 0;
    const push = (u8) => { chunks.push(u8); pos += u8.length; };
    const str = (s) => push(enc.encode(s));
    push(new Uint8Array([37, 80, 68, 70, 45, 49, 46, 52, 10, 37, 226, 227, 207, 211, 10])); // %PDF-1.4 + binary marker
    const n = canvases.length;
    offsets[1] = pos; str('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
    offsets[2] = pos; str(`2 0 obj\n<< /Type /Pages /Count ${n} /Kids [${canvases.map((_, i) => `${5 + 3 * i} 0 R`).join(' ')}] >>\nendobj\n`);
    canvases.forEach((c, i) => {
      const imgN = 3 + 3 * i; const conN = 4 + 3 * i; const pageN = 5 + 3 * i;
      const s = 842 / Math.max(c.width, c.height); const pw = (c.width * s).toFixed(2); const ph = (c.height * s).toFixed(2);
      offsets[imgN] = pos;
      str(`${imgN} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${c.width} /Height ${c.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpgs[i].length} >>\nstream\n`);
      push(jpgs[i]); str('\nendstream\nendobj\n');
      const content = `q ${pw} 0 0 ${ph} 0 0 cm /Im0 Do Q`;
      offsets[conN] = pos; str(`${conN} 0 obj\n<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n`);
      offsets[pageN] = pos; str(`${pageN} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pw} ${ph}] /Resources << /XObject << /Im0 ${imgN} 0 R >> >> /Contents ${conN} 0 R >>\nendobj\n`);
    });
    const count = 2 + 3 * n; const xref = pos;
    str(`xref\n0 ${count + 1}\n0000000000 65535 f \n`);
    for (let i = 1; i <= count; i++) str(`${String(offsets[i]).padStart(10, '0')} 00000 n \n`);
    str(`trailer\n<< /Size ${count + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
    return new Blob(chunks, { type: 'application/pdf' });
  }

  const DS_CSS = `
    .ds-ov{position:fixed;inset:0;z-index:10050;background:#0b0f19;color:#fff;display:flex;flex-direction:column;font-family:inherit;touch-action:manipulation}
    .ds-top,.ds-strip,.ds-hint,.ds-bar{flex:none}
    .ds-top{display:flex;align-items:center;gap:10px;padding:10px 12px;padding-top:max(10px,env(safe-area-inset-top))}
    .ds-top .ds-title{flex:1;font-weight:700;font-size:15px}
    .ds-btn{border:0;border-radius:999px;min-height:40px;padding:0 16px;font:inherit;font-weight:700;font-size:14px;cursor:pointer;background:rgba(255,255,255,.14);color:#fff}
    .ds-btn:hover{background:rgba(255,255,255,.22)}
    .ds-btn.pri{background:var(--color-primary,#4f46e5)}
    .ds-btn:disabled{opacity:.4;cursor:not-allowed}
    .ds-btn.on{background:#fff;color:#0b0f19}
    .ds-stage{position:relative;flex:1;min-height:0;display:flex;align-items:center;justify-content:center;overflow:hidden;background:#000}
    .ds-stage video{width:100%;height:100%;object-fit:contain;background:#000}
    .ds-stage canvas.ds-view{max-width:100%;max-height:100%;touch-action:none;display:block}
    .ds-guide{position:absolute;inset:7% 7%;border:2px dashed rgba(255,255,255,.55);border-radius:10px;pointer-events:none}
    .ds-msg{position:absolute;inset:0;display:flex;flex-direction:column;gap:12px;align-items:center;justify-content:center;text-align:center;padding:24px;background:#0b0f19}
    .ds-msg p{max-width:340px;margin:0;font-size:14px;line-height:1.5;color:#cbd5e1}
    .ds-flash{position:absolute;inset:0;background:#fff;opacity:0;pointer-events:none;transition:opacity .25s}
    .ds-flash.on{opacity:.85;transition:none}
    .ds-strip{display:flex;gap:8px;overflow-x:auto;padding:8px 12px 0}
    .ds-th{position:relative;flex:none;width:54px;height:72px;border-radius:8px;overflow:hidden;border:2px solid rgba(255,255,255,.3);background:#111}
    .ds-th canvas{width:100%;height:100%;object-fit:cover;display:block}
    .ds-th button{position:absolute;top:1px;right:1px;width:20px;height:20px;border:0;border-radius:50%;background:rgba(0,0,0,.7);color:#fff;font-size:14px;line-height:1;cursor:pointer;padding:0}
    .ds-bar{display:flex;align-items:center;justify-content:center;gap:10px;flex-wrap:wrap;padding:12px;padding-bottom:max(14px,env(safe-area-inset-bottom))}
    .ds-shutter{width:72px;height:72px;border-radius:50%;border:4px solid #fff;background:rgba(255,255,255,.2);padding:0;cursor:pointer;position:relative}
    .ds-shutter::after{content:"";position:absolute;inset:6px;border-radius:50%;background:#fff}
    .ds-shutter:active::after{inset:9px}
    .ds-ov [hidden]{display:none!important}
    .ds-hint{font-size:12.5px;color:#cbd5e1;text-align:center;padding:0 12px 2px}
  `;
  function dsStyle() {
    if (document.getElementById('ds-style')) return;
    const st = document.createElement('style'); st.id = 'ds-style'; st.textContent = DS_CSS; document.head.appendChild(st);
  }

  async function dsFileToCanvas(file) {
    let bmp = null;
    try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch (e) { bmp = null; }
    if (!bmp) {
      bmp = await new Promise((res, rej) => { const im = new Image(); const u = URL.createObjectURL(file); im.onload = () => { URL.revokeObjectURL(u); res(im); }; im.onerror = () => { URL.revokeObjectURL(u); rej(new Error('That image could not be opened')); }; im.src = u; });
    }
    const w = bmp.width || bmp.naturalWidth; const h = bmp.height || bmp.naturalHeight;
    const s = Math.min(1, DS_SRC_SIDE / Math.max(w, h));
    const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w * s)); c.height = Math.max(1, Math.round(h * s));
    const x = c.getContext('2d', { willReadFrequently: true }); x.imageSmoothingQuality = 'high'; x.drawImage(bmp, 0, 0, c.width, c.height);
    if (bmp.close) bmp.close();
    return c;
  }

  /**
   * opts: { maxPages, maxBytes, onDone(File) }. Camera -> crop -> filter -> pages -> PDF.
   * Without a camera (or without permission) the phone's own camera app / gallery is used through a file input.
   */
  function openDocScanner(opts) {
    dsStyle();
    const maxPages = opts.maxPages || 10; const maxBytes = opts.maxBytes || 10 * 1024 * 1024;
    let stream = null; let closed = false; let mode = 'live'; let torchOn = false; let busy = false;
    let pages = []; let srcCanvas = null; let corners = null; let warped = null; let filterMode = 'enhance'; let fit = 1; let drag = -1; let raf = 0;
    const ov = document.createElement('div');
    ov.className = 'ds-ov'; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-label', 'Scan invoice');
    ov.innerHTML = `
      <div class="ds-top"><button type="button" class="ds-btn" data-x aria-label="Close scanner">✕</button><div class="ds-title">Scan invoice</div><button type="button" class="ds-btn pri" data-finish disabled>Finish</button></div>
      <div class="ds-stage"><video playsinline muted autoplay></video><div class="ds-guide"></div><canvas class="ds-view" hidden></canvas><div class="ds-msg" hidden></div><div class="ds-flash"></div></div>
      <div class="ds-strip" hidden></div>
      <div class="ds-hint"></div>
      <div class="ds-bar"></div>
      <input type="file" accept="image/*" capture="environment" hidden data-cam />
      <input type="file" accept="image/*" hidden data-gal />`;
    document.body.appendChild(ov);
    const $ = (s) => ov.querySelector(s);
    const video = $('video'); const view = $('canvas.ds-view'); const msg = $('.ds-msg'); const bar = $('.ds-bar'); const hint = $('.ds-hint');
    const strip = $('.ds-strip'); const finishBtn = $('[data-finish]'); const stage = $('.ds-stage'); const guide = $('.ds-guide');

    function stopCamera() { if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; } video.srcObject = null; }
    function close() { if (closed) return; closed = true; stopCamera(); cancelAnimationFrame(raf); document.removeEventListener('keydown', onKey, true); ov.remove(); }
    async function askClose() {
      if (busy) return;
      if (pages.length) { const ok = await window.UI.confirmDialog({ title: 'Discard scanned pages?', message: `${pages.length} scanned page${pages.length > 1 ? 's' : ''} will be lost.`, confirmText: 'Discard', danger: true }); if (!ok) return; }
      close();
    }
    function onKey(e) { if (closed) return; if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); askClose(); } }
    document.addEventListener('keydown', onKey, true);

    function drawStrip() {
      strip.hidden = !pages.length;
      strip.innerHTML = '';
      pages.forEach((p, i) => {
        const d = document.createElement('div'); d.className = 'ds-th';
        const c = document.createElement('canvas'); c.width = 54; c.height = 72; const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, 54, 72);
        const s = Math.min(54 / p.width, 72 / p.height); const w = p.width * s; const h = p.height * s; x.drawImage(p, (54 - w) / 2, (72 - h) / 2, w, h);
        const b = document.createElement('button'); b.type = 'button'; b.textContent = '×'; b.setAttribute('aria-label', `Remove page ${i + 1}`);
        b.addEventListener('click', () => { pages.splice(i, 1); drawStrip(); setMode(mode); });
        d.appendChild(c); d.appendChild(b); strip.appendChild(d);
      });
      finishBtn.disabled = !pages.length;
      finishBtn.textContent = pages.length ? `Finish (${pages.length})` : 'Finish';
    }

    function showMsg(html) { msg.hidden = !html; msg.innerHTML = html || ''; }

    function setMode(m) {
      mode = m;
      const live = m === 'live'; const crop = m === 'crop'; const filt = m === 'filter';
      video.style.display = live ? '' : 'none'; guide.style.display = live && stream ? '' : 'none'; view.hidden = live;
      if (live) {
        hint.textContent = pages.length ? 'Scan the next page, or tap Finish.' : 'Lay the invoice flat, fill the frame, and tap the button.';
        const canTorch = !!(stream && stream.getVideoTracks()[0] && stream.getVideoTracks()[0].getCapabilities && (stream.getVideoTracks()[0].getCapabilities() || {}).torch);
        bar.innerHTML = `<button type="button" class="ds-btn" data-gal-btn>Photo library</button><button type="button" class="ds-shutter" data-shoot aria-label="Take photo"${pages.length >= maxPages ? ' disabled' : ''}></button>${canTorch ? `<button type="button" class="ds-btn${torchOn ? ' on' : ''}" data-torch>Light</button>` : '<span style="width:96px"></span>'}`;
      } else if (crop) {
        hint.textContent = 'Drag the four corners onto the corners of the paper.';
        bar.innerHTML = '<button type="button" class="ds-btn" data-retake>Retake</button><button type="button" class="ds-btn" data-auto>Auto-detect</button><button type="button" class="ds-btn pri" data-next>Next</button>';
      } else if (filt) {
        hint.textContent = 'Choose how the page looks.';
        bar.innerHTML = `<button type="button" class="ds-btn" data-back>Back</button>
          <button type="button" class="ds-btn${filterMode === 'original' ? ' on' : ''}" data-f="original">Original</button>
          <button type="button" class="ds-btn${filterMode === 'enhance' ? ' on' : ''}" data-f="enhance">Enhanced</button>
          <button type="button" class="ds-btn${filterMode === 'bw' ? ' on' : ''}" data-f="bw">Black &amp; white</button>
          <button type="button" class="ds-btn" data-rot>Rotate</button>
          <button type="button" class="ds-btn pri" data-add>Add page</button>`;
      }
    }

    /* ----- crop editor ----- */
    function layoutView(canvas) {
      const r = stage.getBoundingClientRect(); const dpr = Math.min(2, window.devicePixelRatio || 1);
      fit = Math.min((r.width - 24) / canvas.width, (r.height - 24) / canvas.height, 1.5); if (!(fit > 0)) fit = 0.3;
      const cw = Math.max(40, Math.round(canvas.width * fit)); const ch = Math.max(40, Math.round(canvas.height * fit));
      view.width = Math.round(cw * dpr); view.height = Math.round(ch * dpr); view.style.width = `${cw}px`; view.style.height = `${ch}px`;
      view._dpr = dpr; view._cw = cw; view._ch = ch;
    }
    function drawCrop() {
      raf = 0; if (!srcCanvas || mode !== 'crop') return;
      const x = view.getContext('2d'); const dpr = view._dpr; const cw = view._cw; const ch = view._ch;
      x.setTransform(dpr, 0, 0, dpr, 0, 0); x.clearRect(0, 0, cw, ch); x.drawImage(srcCanvas, 0, 0, cw, ch);
      const pts = corners.map((p) => [p[0] * fit, p[1] * fit]);
      x.save(); x.fillStyle = 'rgba(0,0,0,.5)'; x.beginPath(); x.rect(0, 0, cw, ch);
      x.moveTo(pts[0][0], pts[0][1]); pts.slice(1).forEach((p) => x.lineTo(p[0], p[1])); x.closePath(); x.fill('evenodd'); x.restore();
      x.lineWidth = 2; x.strokeStyle = '#38bdf8'; x.beginPath(); x.moveTo(pts[0][0], pts[0][1]); pts.slice(1).forEach((p) => x.lineTo(p[0], p[1])); x.closePath(); x.stroke();
      pts.forEach((p) => { x.beginPath(); x.arc(p[0], p[1], 13, 0, Math.PI * 2); x.fillStyle = 'rgba(56,189,248,.35)'; x.fill(); x.lineWidth = 2.5; x.strokeStyle = '#fff'; x.stroke(); });
    }
    const redraw = () => { if (!raf) raf = requestAnimationFrame(drawCrop); };
    const evPt = (e) => { const r = view.getBoundingClientRect(); return [(e.clientX - r.left) / fit, (e.clientY - r.top) / fit]; };
    view.addEventListener('pointerdown', (e) => {
      if (mode !== 'crop') return; const p = evPt(e); let best = -1; let bd = 44 / fit;
      corners.forEach((c, i) => { const d = Math.hypot(c[0] - p[0], c[1] - p[1]); if (d < bd) { bd = d; best = i; } });
      if (best >= 0) { drag = best; try { view.setPointerCapture(e.pointerId); } catch (er) { /* ignore */ } e.preventDefault(); }
    });
    view.addEventListener('pointermove', (e) => {
      if (drag < 0 || mode !== 'crop') return; const p = evPt(e);
      corners[drag] = [Math.min(srcCanvas.width, Math.max(0, p[0])), Math.min(srcCanvas.height, Math.max(0, p[1]))]; redraw(); e.preventDefault();
    });
    const endDrag = () => { drag = -1; };
    view.addEventListener('pointerup', endDrag); view.addEventListener('pointercancel', endDrag);

    function startCrop(canvas) {
      srcCanvas = canvas; corners = dsAutoCorners(canvas); setMode('crop'); showMsg(''); layoutView(canvas); drawCrop();
    }
    function showFilter() {
      busy = true;
      requestAnimationFrame(() => {
        try {
          const filtered = dsFilter(warped, filterMode);
          layoutView(filtered); const x = view.getContext('2d'); x.setTransform(view._dpr, 0, 0, view._dpr, 0, 0); x.clearRect(0, 0, view._cw, view._ch); x.drawImage(filtered, 0, 0, view._cw, view._ch);
          view._result = filtered;
        } catch (e) { window.UI.toast.error('Could not process the page'); }
        busy = false;
      });
    }

    /* ----- camera ----- */
    async function startCamera() {
      showMsg('');
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return noCamera('This browser cannot open the camera here (it needs a secure https page).');
      let s = null; let lastErr = null;
      const tries = [{ video: { facingMode: { ideal: 'environment' }, width: { ideal: 2560 }, height: { ideal: 1440 } }, audio: false }, { video: true, audio: false }];
      for (const c of tries) {
        try { s = await navigator.mediaDevices.getUserMedia(c); break; } catch (e) { lastErr = e; if (e && (e.name === 'NotAllowedError' || e.name === 'SecurityError')) break; }
      }
      if (closed) { if (s) s.getTracks().forEach((t) => t.stop()); return; }
      if (!s) {
        const denied = lastErr && (lastErr.name === 'NotAllowedError' || lastErr.name === 'SecurityError');
        return noCamera(denied ? 'Camera access is blocked. Allow the camera for this site in your browser settings, or use your phone’s camera app below.' : 'No camera was found.');
      }
      stream = s; video.srcObject = s;
      try { await video.play(); } catch (e) { /* autoplay is on anyway */ }
      if (mode === 'live') setMode('live');
    }
    function noCamera(text) {
      setMode('live');
      showMsg(`<p>${esc(text)}</p><button type="button" class="ds-btn pri" data-cam-btn>Take a photo</button><button type="button" class="ds-btn" data-gal-btn>Choose from photo library</button>`);
    }
    async function shoot() {
      if (busy || !stream || !video.videoWidth) return;
      const vw = video.videoWidth; const vh = video.videoHeight; const s = Math.min(1, DS_SRC_SIDE / Math.max(vw, vh));
      const c = document.createElement('canvas'); c.width = Math.round(vw * s); c.height = Math.round(vh * s);
      c.getContext('2d', { willReadFrequently: true }).drawImage(video, 0, 0, c.width, c.height);
      const fl = $('.ds-flash'); fl.classList.add('on'); setTimeout(() => fl.classList.remove('on'), 60);
      startCrop(c);
    }
    async function fromFile(file) {
      if (!file) return;
      busy = true;
      try { startCrop(await dsFileToCanvas(file)); } catch (e) { window.UI.toast.error(e.message || 'That image could not be opened'); }
      busy = false;
    }
    async function toggleTorch() {
      try { const t = stream.getVideoTracks()[0]; torchOn = !torchOn; await t.applyConstraints({ advanced: [{ torch: torchOn }] }); setMode('live'); } catch (e) { torchOn = false; window.UI.toast.info('The light is not available on this camera'); }
    }

    async function finish() {
      if (!pages.length || busy) return;
      busy = true; finishBtn.disabled = true; finishBtn.textContent = 'Saving…';
      try {
        const blob = await dsBuildPdf(pages, maxBytes);
        if (blob.size > maxBytes) throw new Error(`The scan is larger than ${Math.round(maxBytes / 1048576)}MB. Remove a page and try again.`);
        const d = new Date(); const p2 = (n) => String(n).padStart(2, '0');
        const file = new File([blob], `Invoice-scan-${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}.pdf`, { type: 'application/pdf' });
        const n = pages.length; close(); opts.onDone(file, n);
      } catch (e) { busy = false; window.UI.toast.error(e.message || 'Could not create the scan'); drawStrip(); }
    }

    ov.addEventListener('click', (e) => {
      const t = e.target.closest('button, .ds-shutter'); if (!t || !ov.contains(t)) return;
      if (t.hasAttribute('data-x')) askClose();
      else if (t.hasAttribute('data-finish')) finish();
      else if (t.hasAttribute('data-shoot')) shoot();
      else if (t.hasAttribute('data-torch')) toggleTorch();
      else if (t.hasAttribute('data-gal-btn')) $('[data-gal]').click();
      else if (t.hasAttribute('data-cam-btn')) $('[data-cam]').click();
      else if (t.hasAttribute('data-retake')) { srcCanvas = null; setMode('live'); }
      else if (t.hasAttribute('data-auto')) { corners = dsAutoCorners(srcCanvas); redraw(); }
      else if (t.hasAttribute('data-next')) {
        if (busy) return; busy = true;
        requestAnimationFrame(() => { try { warped = dsWarp(srcCanvas, corners); filterMode = filterMode || 'enhance'; setMode('filter'); showFilter(); } catch (er) { window.UI.toast.error('Could not straighten the page'); } busy = false; });
      } else if (t.hasAttribute('data-back')) { setMode('crop'); layoutView(srcCanvas); drawCrop(); }
      else if (t.hasAttribute('data-f')) { filterMode = t.getAttribute('data-f'); setMode('filter'); showFilter(); }
      else if (t.hasAttribute('data-rot')) { warped = dsRotate(warped); showFilter(); }
      else if (t.hasAttribute('data-add')) {
        if (busy || !view._result) return;
        if (pages.length >= maxPages) { window.UI.toast.warning(`Maximum ${maxPages} pages`); return; }
        pages.push(view._result); view._result = null; srcCanvas = null; warped = null; drawStrip(); setMode('live');
      }
    });
    $('[data-cam]').addEventListener('change', (e) => { const f = e.target.files && e.target.files[0]; e.target.value = ''; fromFile(f); });
    $('[data-gal]').addEventListener('change', (e) => { const f = e.target.files && e.target.files[0]; e.target.value = ''; fromFile(f); });
    window.addEventListener('resize', () => { if (closed) return; if (mode === 'crop' && srcCanvas) { layoutView(srcCanvas); drawCrop(); } });

    setMode('live'); drawStrip(); startCamera();
    return { close };
  }
  /* PU-BLOCK-END */

  /* ---------------- invoice picker (create modal) ---------------- */

  let pickerSeq = 0;
  function createInvoicePicker(root) {
    const entries = []; // { file, url }
    const inputId = `inv-file-${++pickerSeq}`;
    root.innerHTML = `
      <label class="inv-drop" for="${inputId}">
        <span class="inv-drop-icon">${ICON.upload}</span>
        <strong>Add supplier invoice</strong>
        <span>Tap to choose, or drag files here</span>
        <small>Up to ${INVOICE_MAX} files, ${INVOICE_MB}MB each &middot; PDF, images, Word, Excel, CSV, TXT</small>
      </label>
      <input id="${inputId}" type="file" multiple hidden accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx,.csv,.txt" />
      <div class="inv-actions"><button type="button" class="btn btn-secondary" data-scan>📷 Scan with camera</button><span class="text-xs text-muted">Photograph the invoice with your phone: it is straightened, cleaned and saved as a PDF.</span></div>
      <div class="inv-grid"></div>`;
    const input = root.querySelector('input');
    const drop = root.querySelector('.inv-drop');
    const grid = root.querySelector('.inv-grid');

    const viewerItems = () => entries.map((e) => ({
      name: e.file.name, size: e.file.size, kind: kindOf(e.file.name, e.file.type), src: e.url, local: true, file: e.file,
    }));

    function render() {
      const vi = viewerItems();
      grid.innerHTML = vi.map((it, i) => cardHtml(it, i, true)).join('');
      bindCards(grid, vi);
      grid.querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', (e) => {
        e.stopPropagation();
        const [gone] = entries.splice(Number(b.dataset.rm), 1);
        URL.revokeObjectURL(gone.url);
        render();
      }));
    }

    function add(list) {
      for (const f of Array.from(list || [])) {
        if (!INVOICE_EXT.test(f.name)) { window.UI.toast.warning(`${f.name} skipped - unsupported type`); continue; }
        if (f.size > INVOICE_MB * 1024 * 1024) { window.UI.toast.warning(`${f.name} is over ${INVOICE_MB}MB`); continue; }
        if (entries.length >= INVOICE_MAX) { window.UI.toast.warning(`Maximum ${INVOICE_MAX} files`); break; }
        entries.push({ file: f, url: URL.createObjectURL(f) });
      }
      render();
    }

    input.addEventListener('change', () => { add(input.files); input.value = ''; });
    ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('drag'); }));
    ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('drag'); }));
    drop.addEventListener('drop', (e) => add(e.dataTransfer.files));
    root.querySelector('[data-scan]').addEventListener('click', () => {
      if (entries.length >= INVOICE_MAX) { window.UI.toast.warning(`Maximum ${INVOICE_MAX} files`); return; }
      openDocScanner({
        maxPages: 10, maxBytes: INVOICE_MB * 1024 * 1024,
        onDone: (file, n) => { add([file]); window.UI.toast.success(`Scanned ${n} page${n > 1 ? 's' : ''} and added to the invoice`); },
      });
    });

    return {
      addFiles: add,
      getFiles: () => entries.map((e) => e.file),
      destroy: () => { entries.forEach((e) => URL.revokeObjectURL(e.url)); entries.length = 0; },
    };
  }

  /* ---------------- list ---------------- */

  async function fetchAndRender() {
    const tbody = document.getElementById('purchases-tbody');
    tbody.innerHTML = window.UI.skeletonRows(7, 5);
    try {
      const { data } = await window.Api.get('/purchases', { page: state.page, limit: state.limit });
      if (!data.items.length) {
        tbody.innerHTML = `<tr><td colspan="7">${window.UI.emptyStateHtml({ icon: 'box', title: 'No purchases yet' })}</td></tr>`;
      } else {
        tbody.innerHTML = data.items.map((p) => `
          <tr data-id="${p._id}">
            <td class="cell-primary">${p.purchaseNumber}${p.attachments && p.attachments.length ? `<span class="inv-clip" title="${p.attachments.length} invoice file(s)">${ICON.clip}${p.attachments.length}</span>` : ''}</td>
            <td class="text-sm">${esc(p.supplierId?.name || '')}</td>
            <td class="text-sm">${window.UI.formatDate(p.purchaseDate)}</td>
            <td class="font-semibold">${window.UI.formatMoney(p.total)}</td>
            <td><span class="badge ${PAY_BADGE[p.paymentStatus]}">${p.paymentStatus}</span></td>
            <td><span class="badge ${RECV_BADGE[p.receivedStatus]}">${p.receivedStatus}</span>${RET_BADGE[p.returnStatus] ? ` <span class="badge ${RET_BADGE[p.returnStatus][0]}">${RET_BADGE[p.returnStatus][1]}</span>` : ''}</td>
            <td class="actions"><button class="btn btn-secondary btn-sm" data-action="view">View</button>${p.receivedStatus === 'RECEIVED' && p.returnStatus !== 'FULL' ? '<button class="btn btn-secondary btn-sm" data-action="return" data-requires-permission="purchases.return">Return</button>' : ''}</td>
          </tr>
        `).join('');
      }
      window.UI.renderPagination(document.getElementById('pagination'), data, (p) => { state.page = p; fetchAndRender(); });
      window.Permissions.applyPermissionGates(contentEl, window.AppShell.getUser());
      document.querySelectorAll('#purchases-tbody [data-action="view"]').forEach((btn) => {
        btn.addEventListener('click', () => openDetailModal(btn.closest('tr').dataset.id));
      });
      document.querySelectorAll('#purchases-tbody [data-action="return"]').forEach((btn) => {
        btn.addEventListener('click', () => openReturnWizard(btn.closest('tr').dataset.id));
      });
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="7">${window.UI.emptyStateHtml({ icon: 'alert', title: 'Could not load purchases', message: err.message })}</td></tr>`;
    }
  }

  /* ---------------- detail ---------------- */

  async function openDetailModal(id) {
    let purchase;
    try {
      ({ data: { purchase } } = await window.Api.get(`/purchases/${id}`));
    } catch (err) {
      return window.UI.toast.error(err.message);
    }

    const canReceive = purchase.receivedStatus !== 'RECEIVED' && window.Permissions.can(window.AppShell.getUser(), 'purchases.receive');
    const canPay = purchase.balance > 0 && window.Permissions.can(window.AppShell.getUser(), 'purchases.pay');
    const canReturn = purchase.receivedStatus === 'RECEIVED' && purchase.returnStatus !== 'FULL' && window.Permissions.can(window.AppShell.getUser(), 'purchases.return');

    const modal = window.UI.openModal({
      title: `Purchase ${purchase.purchaseNumber}`,
      maxWidth: '680px',
      bodyHtml: `
        <div class="text-sm text-secondary" style="margin-bottom: var(--space-3)">Supplier: ${esc(purchase.supplierId?.name || '')} &middot; ${window.UI.formatDate(purchase.purchaseDate)}${purchase.invoiceNumber ? ` &middot; Invoice # ${esc(purchase.invoiceNumber)}` : ''}</div>
        ${purchase.vatMode && purchase.vatMode !== 'NONE' ? `<div class="text-sm text-secondary" style="margin-bottom: var(--space-3)">${VAT_LABEL[purchase.vatMode]} @ ${purchase.vatRate}%</div>` : ''}
        ${attachmentsHtml(purchase.attachments)}
        <div class="table-wrap" style="margin-bottom: var(--space-4)">
          <table class="table">
            <thead><tr><th>Item</th><th>Qty</th><th>Unit cost</th><th>Real unit cost</th><th>Total</th>${purchase.items.some((i) => i.receivedLocation) ? '<th>Received into</th>' : ''}</tr></thead>
            <tbody>${purchase.items.map((i) => `<tr><td class="text-sm">${esc(i.nameSnapshot)}</td><td>${i.quantity}</td><td>${window.UI.formatMoney(i.unitCost)}</td><td>${window.UI.formatMoney(i.total / i.quantity)}</td><td>${window.UI.formatMoney(i.total)}</td>${purchase.items.some((x) => x.receivedLocation) ? `<td>${i.receivedLocation === 'WAREHOUSE' ? '<span class="badge badge-info">Warehouse</span>' : i.receivedLocation ? '<span class="badge badge-neutral">Retail</span>' : '—'}</td>` : ''}</tr>`).join('')}</tbody>
          </table>
        </div>
        <div class="pos-totals-row"><span>Subtotal</span><span>${window.UI.formatMoney(purchase.subtotal)}</span></div>
        <div class="pos-totals-row"><span>Tax</span><span>${window.UI.formatMoney(purchase.tax)}</span></div>
        <div class="pos-totals-row grand"><span>Total</span><span>${window.UI.formatMoney(purchase.total)}</span></div>
        ${purchase.returnedAmount > 0 ? `<div class="pos-totals-row" style="color:var(--color-info)"><span>Returned to supplier ${purchase.returnStatus === 'FULL' ? '(all goods)' : '(part)'}</span><span>− ${window.UI.formatMoney(purchase.returnedAmount)}</span></div>` : ''}
        <div class="pos-totals-row"><span>Paid</span><span>${window.UI.formatMoney(purchase.amountPaid)}</span></div>
        <div class="pos-totals-row" style="color:${purchase.balance > 0 ? 'var(--color-warning)' : ''}"><span>Balance</span><span>${window.UI.formatMoney(purchase.balance)}</span></div>
      `,
      footerHtml: `
        <button class="btn btn-secondary" data-action="close">Close</button>
        ${canReturn ? `<button class="btn btn-secondary" data-action="return-goods">Return goods</button>` : ''}
        ${canPay ? `<button class="btn btn-secondary" data-action="pay">Record payment</button>` : ''}
        ${canReceive ? `<button class="btn btn-primary" data-action="receive">Mark received</button>` : ''}
      `,
    });

    const gallery = modal.querySelector('#inv-gallery');
    if (gallery) bindCards(gallery, (purchase.attachments || []).map(remoteItem));

    modal.querySelector('[data-action="close"]').addEventListener('click', window.UI.closeModal);
    modal.querySelector('[data-action="return-goods"]')?.addEventListener('click', () => { window.UI.closeModal(); openReturnWizard(purchase._id); });
    modal.querySelector('[data-action="receive"]')?.addEventListener('click', () => { window.UI.closeModal(); openReceiveDialog(purchase); });
    modal.querySelector('[data-action="pay"]')?.addEventListener('click', () => {
      window.UI.closeModal();
      openPaymentModal(purchase);
    });
  }


  /* ---------------- receive (where the goods go + batch / serial details) ---------------- */

  const whOn = () => !!(window.AppShell.hasFeature && window.AppShell.hasFeature('multiWarehouse'));
  const strictBatches = () => !!(window.AppShell.hasFeature && window.AppShell.hasFeature('batchTracking'));
  const splitList = (txt) => String(txt || '').split(/[\n,;]+/).map((x) => x.trim()).filter(Boolean);
  const lineKey = (i) => `${i.productId}|${i.variantId || ''}`;

  async function openReceiveDialog(purchase) {
    const lines = purchase.items.filter((i) => i.quantity - (i.receivedQuantity || 0) > 0);

    // which lines need batch / serial details? (the purchase lines only carry product ids)
    const flags = {};
    await Promise.all([...new Set(lines.map((i) => String(i.productId)))].map(async (pid) => {
      try { const { data } = await window.Api.get(`/products/${pid}`); flags[pid] = data.product; } catch { flags[pid] = {}; }
    }));
    const needsBatch = (i) => !!(flags[String(i.productId)]?.trackBatch || flags[String(i.productId)]?.trackExpiry);
    const needsExpiry = (i) => !!flags[String(i.productId)]?.trackExpiry;
    const needsSerial = (i) => !!flags[String(i.productId)]?.trackSerialNumber;
    const wantsBatchRows = (i) => needsBatch(i) && (strictBatches() || needsExpiry(i));
    const anyDetail = lines.some((i) => wantsBatchRows(i) || needsSerial(i));

    // nothing to ask: keep the one-click behaviour
    if (!whOn() && !anyDetail) return submitReceive(purchase, {});

    const qtyOf = (i) => i.quantity - (i.receivedQuantity || 0);
    const lineHtml = (i, idx) => `
      <div class="rcv-line" data-idx="${idx}" style="padding:var(--space-3) 0; border-bottom:1px solid var(--color-border)">
        <div class="flex items-center gap-2" style="flex-wrap:wrap">
          <span class="text-sm" style="flex:1; min-width:160px"><strong>${esc(i.nameSnapshot)}</strong> <span class="text-muted">× ${qtyOf(i)}</span></span>
          ${whOn() ? `<select class="select" data-line-loc="${idx}" style="width:auto; height:36px"><option value="">Same as above</option><option value="RETAIL">Retail</option><option value="WAREHOUSE">Warehouse</option></select>` : ''}
        </div>
        ${wantsBatchRows(i) ? `
          <div class="text-xs text-muted" style="margin-top:var(--space-2)">Supplier batch details (quantities must add up to ${qtyOf(i)})</div>
          <div data-batches="${idx}"></div>
          <button type="button" class="btn btn-ghost btn-sm" data-add-batch="${idx}">${window.Icons.get('plus')} Add batch</button>` : ''}
        ${needsSerial(i) ? `
          <div class="text-xs text-muted" style="margin-top:var(--space-2)">Serial numbers / IMEIs, one per line (${qtyOf(i)} needed)</div>
          <textarea class="textarea" rows="3" data-serials="${idx}"></textarea>` : ''}
      </div>`;

    const modal = window.UI.openModal({
      title: `Receive ${purchase.purchaseNumber}`,
      maxWidth: '720px',
      bodyHtml: `
        ${whOn() ? `<div class="field"><label>Receive goods into</label>
          <select class="select" id="rcv-location"><option value="RETAIL">Retail (shop floor, ready to sell)</option><option value="WAREHOUSE">Warehouse (wholesale store)</option></select>
          <span class="field-hint">Warehouse stock cannot be sold at the till until it is moved to retail. You can override this per item below.</span></div>` : ''}
        <div id="rcv-lines">${lines.map(lineHtml).join('')}</div>`,
      footerHtml: `<button class="btn btn-secondary" data-action="cancel">Cancel</button><button class="btn btn-primary" data-action="confirm" id="rcv-confirm">Receive goods</button>`,
    });

    // batch rows state: idx -> [{ batchNumber, quantity, expiryDate, manufacturingDate }]
    const batches = {};
    function renderBatches(idx) {
      const i = lines[idx];
      const host = modal.querySelector(`[data-batches="${idx}"]`);
      if (!host) return;
      host.innerHTML = batches[idx].map((b, k) => `
        <div class="flex items-center gap-2" style="margin-top:var(--space-2); flex-wrap:wrap">
          <input class="input" placeholder="Batch no." value="${esc(b.batchNumber)}" data-b="${idx}:${k}:batchNumber" style="flex:1; min-width:110px; height:36px" />
          <input class="input" type="number" min="0" step="any" placeholder="Qty" value="${esc(b.quantity)}" data-b="${idx}:${k}:quantity" style="width:80px; height:36px" />
          ${needsExpiry(i) ? `<input class="input" type="date" title="Expiry date" value="${esc(b.expiryDate)}" data-b="${idx}:${k}:expiryDate" style="width:150px; height:36px" />` : ''}
          ${batches[idx].length > 1 ? `<button type="button" class="btn btn-ghost btn-sm btn-icon" data-rm-batch="${idx}:${k}">${window.Icons.get('trash')}</button>` : ''}
        </div>`).join('');
      host.querySelectorAll('[data-b]').forEach((el) => el.addEventListener('input', () => {
        const [a, k, f] = el.dataset.b.split(':'); batches[a][Number(k)][f] = el.value;
      }));
      host.querySelectorAll('[data-rm-batch]').forEach((el) => el.addEventListener('click', () => {
        const [a, k] = el.dataset.rmBatch.split(':'); batches[a].splice(Number(k), 1); renderBatches(Number(a));
      }));
    }
    lines.forEach((i, idx) => {
      if (!wantsBatchRows(i)) return;
      batches[idx] = [{ batchNumber: '', quantity: qtyOf(i), expiryDate: '', manufacturingDate: '' }];
      renderBatches(idx);
    });
    modal.querySelectorAll('[data-add-batch]').forEach((b) => b.addEventListener('click', () => {
      const idx = Number(b.dataset.addBatch);
      batches[idx].push({ batchNumber: '', quantity: '', expiryDate: '', manufacturingDate: '' });
      renderBatches(idx);
    }));

    modal.querySelector('[data-action="cancel"]').addEventListener('click', window.UI.closeModal);
    modal.querySelector('[data-action="confirm"]').addEventListener('click', async () => {
      const body = { batches: [], serials: [], lineLocations: [] };
      if (whOn()) body.location = modal.querySelector('#rcv-location').value;

      for (let idx = 0; idx < lines.length; idx += 1) {
        const i = lines[idx];
        const out = qtyOf(i);

        const ov = modal.querySelector(`[data-line-loc="${idx}"]`)?.value;
        if (ov) body.lineLocations.push({ productId: i.productId, variantId: i.variantId || undefined, location: ov });

        if (batches[idx]) {
          const rows = batches[idx].filter((b) => String(b.batchNumber).trim() || String(b.expiryDate).trim());
          if (!rows.length) {
            if (strictBatches()) return window.UI.toast.error(`${i.nameSnapshot}: enter the supplier batch number${needsExpiry(i) ? ' and expiry date' : ''}`);
          } else {
            let sum = 0;
            for (const b of rows) {
              if (!String(b.batchNumber).trim()) return window.UI.toast.error(`${i.nameSnapshot}: every batch needs a batch number`);
              if (needsExpiry(i) && !b.expiryDate) return window.UI.toast.error(`${i.nameSnapshot}: batch ${b.batchNumber} needs an expiry date`);
              const q = Number(b.quantity);
              if (!(q > 0)) return window.UI.toast.error(`${i.nameSnapshot}: enter a quantity for batch ${b.batchNumber}`);
              sum += q;
              body.batches.push({ productId: i.productId, variantId: i.variantId || undefined, batchNumber: String(b.batchNumber).trim(), quantity: q, expiryDate: b.expiryDate || undefined });
            }
            if (Math.round(sum * 1000) !== Math.round(out * 1000)) return window.UI.toast.error(`${i.nameSnapshot}: batch quantities (${sum}) must add up to ${out}`);
          }
        }

        if (needsSerial(i)) {
          const list = splitList(modal.querySelector(`[data-serials="${idx}"]`)?.value);
          if (list.length !== out) return window.UI.toast.error(`${i.nameSnapshot}: enter ${out} serial number(s) - you entered ${list.length}`);
          body.serials.push({ productId: i.productId, variantId: i.variantId || undefined, serialNumbers: list });
        }
      }
      if (!body.batches.length) delete body.batches;
      if (!body.serials.length) delete body.serials;
      if (!body.lineLocations.length) delete body.lineLocations;

      const btn = modal.querySelector('#rcv-confirm');
      window.UI.setButtonLoading(btn, true, 'Receiving…');
      const ok = await submitReceive(purchase, body);
      if (!ok) window.UI.setButtonLoading(btn, false);
    });
  }

  async function submitReceive(purchase, body) {
    try {
      await window.Api.post(`/purchases/${purchase._id}/receive`, body);
      const toWh = body.location === 'WAREHOUSE' || (body.lineLocations || []).some((l) => l.location === 'WAREHOUSE');
      window.UI.toast.success(toWh ? 'Purchase received - inventory updated (warehouse stock included)' : 'Purchase received - inventory updated');
      window.UI.closeModal();
      fetchAndRender();
      return true;
    } catch (err) {
      window.UI.toast.error(err.message);
      return false;
    }
  }

  function openPaymentModal(purchase) {
    const modal = window.UI.openModal({
      title: 'Record payment',
      bodyHtml: `
        <form id="pay-form">
          <p class="text-sm text-secondary" style="margin-bottom: var(--space-3)">Balance owed: ${window.UI.formatMoney(purchase.balance)}</p>
          <div class="field"><label>Amount (KES)</label><input class="input" name="amount" type="number" step="0.01" min="0.01" max="${purchase.balance}" required value="${purchase.balance}" /></div>
        </form>
      `,
      footerHtml: `<button class="btn btn-secondary" data-action="cancel">Cancel</button><button class="btn btn-primary" data-action="save">Record</button>`,
    });
    modal.querySelector('[data-action="cancel"]').addEventListener('click', window.UI.closeModal);
    modal.querySelector('[data-action="save"]').addEventListener('click', async () => {
      const form = modal.querySelector('#pay-form');
      if (!form.reportValidity()) return;
      const raw = window.UI.serializeForm(form);
      try {
        await window.Api.post(`/purchases/${purchase._id}/payments`, { amount: raw.amount });
        window.UI.toast.success('Payment recorded');
        window.UI.closeModal();
        fetchAndRender();
      } catch (err) {
        window.UI.toast.error(err.message);
      }
    });
  }

  /* ---------------- create ---------------- */

  /* ===== Remembered on THIS device =====
   *  1. DRAFT   - the purchase being typed (saved on every keystroke, survives refresh / closing / phone killing the tab)
   *  2. SUPPLIER PRODUCTS - every product added under a supplier is remembered with its unit, pieces-per-unit and last price,
   *     and auto-fills the next time that supplier is chosen (the owner only types quantities).
   */
  const UNITS = ['Piece', 'Carton', 'Bale', 'Dozen', 'Pack', 'Packet', 'Box', 'Crate', 'Case', 'Sack', 'Tray', 'Bundle'];
  const PACK_CHIPS = [6, 10, 12, 20, 24, 30, 48];
  const userKey = () => { const u = (window.AppShell.getUser && window.AppShell.getUser()) || {}; return String(u._id || u.id || u.email || 'u'); };
  const branchKey = () => { try { return String(window.AppShell.getActiveBranchId() || 'b'); } catch (e) { return 'b'; } };
  const DRAFT_KEY = () => `pos.purchaseDraft.v2:${userKey()}:${branchKey()}`;
  const MEM_KEY = () => `pos.supplierItems.v2:${userKey()}`;
  function lsGet(k, fb) { try { const r = localStorage.getItem(k); return r ? JSON.parse(r) : fb; } catch (e) { return fb; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } }

  const leanProduct = (p) => ({ _id: p._id, name: p.name, sku: p.sku, costPrice: p.costPrice, sellingPrice: p.sellingPrice, defaultDiscount: p.defaultDiscount });
  const leanVariant = (v) => (v ? { _id: v._id, sku: v.sku, attributes: v.attributes, costPrice: v.costPrice, sellingPrice: v.sellingPrice } : null);
  const itemKey = (it) => `${it.product._id}|${it.variant ? it.variant._id : ''}`;
  const packOf = (it) => Math.max(1, Math.floor(Number(it.pack) || 1)); // pieces in ONE buying unit (carton, bale...)
  const round4 = (n) => Math.round(n * 10000) / 10000;
  const fmtN = (n) => String(Math.round((Number(n) || 0) * 100) / 100);
  const unitLabel = (it) => (it.unitName || 'unit');
  const isBulk = (it) => !!it.customUnit || (it.unitName && it.unitName !== 'Piece') || packOf(it) > 1;
  /** price of ONE buying unit (carton) as entered, whichever way the owner typed it */
  function packPrice(it) {
    if (it.canon != null) return it.canon;
    const p = Number(it.price) || 0;
    return it.priceMode === 'unit' ? p * packOf(it) : p;
  }

  function newItem(product, variant, quantity) {
    return {
      product: leanProduct(product), variant: leanVariant(variant), quantity,
      price: (variant ? variant.costPrice : product.costPrice) || 0, priceMode: 'pack', canon: null,
      pack: 1, unitName: 'Piece', customUnit: false, priceUpdate: null, promptedFor: null,
    };
  }
  const serializeItem = (it) => ({
    product: it.product, variant: it.variant || null, quantity: it.quantity, price: it.price, priceMode: it.priceMode, canon: it.canon,
    pack: it.pack, unitName: it.unitName, customUnit: !!it.customUnit, priceUpdate: it.priceUpdate || null, promptedFor: it.promptedFor || null,
  });
  const reviveItem = (o) => ({
    product: o.product, variant: o.variant || null, quantity: Number(o.quantity) || 0, price: Number(o.price) || 0, priceMode: o.priceMode || 'pack',
    canon: o.canon != null ? o.canon : null, pack: o.pack || 1, unitName: o.unitName || 'Piece', customUnit: !!o.customUnit,
    priceUpdate: o.priceUpdate || null, promptedFor: o.promptedFor || null,
  });

  /* supplier memory */
  function memGet(supId) { const m = (lsGet(MEM_KEY(), {}) || {})[supId]; return m && m.items ? m : { items: {} }; }
  function memEntry(it) {
    return { product: it.product, variant: it.variant || null, price: it.price, priceMode: it.priceMode, canon: it.canon, pack: it.pack, unitName: it.unitName, customUnit: !!it.customUnit, ts: Date.now() };
  }
  function memUpsert(supId, items, vat) {
    if (!supId) return;
    const all = lsGet(MEM_KEY(), {}) || {};
    const m = all[supId] && all[supId].items ? all[supId] : { items: {} };
    items.forEach((it) => { m.items[itemKey(it)] = memEntry(it); });
    if (vat && vat.mode) m.vat = { mode: vat.mode, rate: vat.rate };
    all[supId] = m; lsSet(MEM_KEY(), all);
  }
  function memForget(supId, key) {
    const all = lsGet(MEM_KEY(), {}) || {};
    if (all[supId] && all[supId].items) { delete all[supId].items[key]; lsSet(MEM_KEY(), all); }
  }
  const fromEntry = (e) => reviveItem({ ...e, quantity: 0, priceUpdate: null, promptedFor: e.price || null });

  /* draft */
  const getDraft = () => { const d = lsGet(DRAFT_KEY(), null); return d && d.v === 2 && Array.isArray(d.items) ? d : null; };
  const clearDraft = () => lsDel(DRAFT_KEY());
  function timeAgo(ts) {
    const m = Math.round((Date.now() - ts) / 60000);
    if (m < 1) return 'just now'; if (m < 60) return `${m} min ago`;
    const h = Math.round(m / 60); if (h < 24) return `${h} hr ago`;
    return `${Math.round(h / 24)} day(s) ago`;
  }
  function renderDraftBanner() {
    const el = document.getElementById('draft-banner');
    if (!el) return;
    const d = getDraft();
    if (!d || !d.items.length) { el.innerHTML = ''; return; }
    el.innerHTML = `
      <div class="card" style="margin-bottom:var(--space-4);border-left:4px solid var(--color-warning,#d97706);padding:var(--space-3) var(--space-4);display:flex;gap:12px;align-items:center;justify-content:space-between;flex-wrap:wrap">
        <span class="text-sm"><b>Unfinished purchase</b>${d.supplierName ? ` &middot; ${esc(d.supplierName)}` : ''} &middot; ${d.items.length} product${d.items.length === 1 ? '' : 's'} &middot; saved ${timeAgo(d.savedAt || Date.now())}</span>
        <span class="flex gap-2"><button class="btn btn-primary btn-sm" id="draft-continue">Continue</button><button class="btn btn-secondary btn-sm" id="draft-discard">Discard</button></span>
      </div>`;
    el.querySelector('#draft-continue').addEventListener('click', () => openCreateModal());
    el.querySelector('#draft-discard').addEventListener('click', async () => {
      const ok = await window.UI.confirmDialog({ title: 'Discard this draft?', message: 'The unfinished purchase will be deleted. Supplier product lists are kept.', confirmText: 'Discard', danger: true });
      if (ok) { clearDraft(); renderDraftBanner(); }
    });
  }

  /** 3-way choice when removing a product that is saved under the supplier. -> 'cancel' | 'once' | 'forget' */
  function askRemove(name, supplier) {
    return new Promise((resolve) => {
      const wrap = document.createElement('div');
      wrap.className = 'modal-backdrop'; wrap.style.zIndex = 1250;
      wrap.innerHTML = `
        <div class="modal" style="max-width:440px" role="dialog" aria-modal="true">
          <div class="modal-header"><strong>Remove product</strong></div>
          <div class="modal-body"><p class="text-sm"><b>${esc(name)}</b> is saved under <b>${esc(supplier || 'this supplier')}</b>.</p>
          <p class="text-sm text-secondary" style="margin-top:8px">Remove it only from this purchase, or from the supplier's saved list so it stops appearing next time?</p></div>
          <div class="modal-footer" style="flex-wrap:wrap;gap:8px">
            <button type="button" class="btn btn-secondary" data-r="cancel">Cancel</button>
            <button type="button" class="btn btn-secondary" data-r="once">This purchase only</button>
            <button type="button" class="btn btn-primary" data-r="forget">Remove from supplier list</button>
          </div>
        </div>`;
      document.body.appendChild(wrap);
      const fin = (v) => { wrap.remove(); resolve(v); };
      wrap.querySelectorAll('[data-r]').forEach((b) => b.addEventListener('click', () => fin(b.dataset.r)));
      wrap.addEventListener('click', (e) => { if (e.target === wrap) fin('cancel'); });
    });
  }

  const PC_CSS = `
    .pc-top{display:grid;grid-template-columns:2fr 1.2fr 1.2fr .8fr;gap:12px;align-items:end}
    .pc-top .field{margin-bottom:0}
    .pc-sup-row{display:flex;gap:8px}.pc-sup-row select{flex:1;min-width:0}
    .pc-bar{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin:16px 0 8px;padding:10px 12px;border:1px dashed var(--color-border,#cbd5e1);border-radius:10px;background:var(--color-surface-2,#f8fafc)}
    .pc-bar .pc-hint{font-size:12px;color:var(--color-text-secondary,#64748b);flex:1;min-width:200px}
    .pc-note{margin:0 0 8px;padding:8px 12px;border-radius:8px;background:#e0f2fe;color:#075985;font-size:13px}
    .pc-list{max-height:50vh;overflow:auto;padding:2px}
    .pc-card{border:1px solid var(--color-border,#e2e8f0);border-radius:12px;padding:12px;margin-bottom:10px;background:var(--color-surface,#fff)}
    .pc-card.pc-skip{opacity:.7;border-style:dashed}
    .pc-card.pc-row-bad{border-color:#d93025;background:#fff5f4}
    .pc-head{display:flex;gap:8px;align-items:flex-start;justify-content:space-between}
    .pc-name{font-weight:700}.pc-sku{font-size:12px;color:var(--color-text-secondary,#64748b)}
    .pc-tag{display:inline-block;font-size:11px;padding:1px 8px;border-radius:999px;background:#e0f2fe;color:#075985;margin-left:6px;font-weight:600}
    .pc-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-top:10px}
    .pc-grid .field{margin:0}.pc-grid label{font-size:12px;display:block;margin-bottom:3px}
    .pc-grid .input,.pc-grid .select{width:100%}
    .pc-seg{display:flex;border:1px solid var(--color-border,#cbd5e1);border-radius:8px;overflow:hidden;margin-top:6px}
    .pc-seg button{flex:1;padding:8px 6px;border:0;background:transparent;font-size:13px;cursor:pointer;color:inherit}
    .pc-seg button.on{background:var(--color-primary,#2563eb);color:#fff;font-weight:700}
    .pc-chips{display:flex;gap:6px;flex-wrap:wrap;margin-top:6px}
    .pc-chips button{padding:5px 11px;border:1px solid var(--color-border,#cbd5e1);border-radius:999px;background:transparent;font-size:12px;cursor:pointer;color:inherit}
    .pc-chips button.on{background:var(--color-primary,#2563eb);color:#fff;border-color:transparent}
    .pc-result{margin-top:10px;padding:10px 12px;border-radius:10px;background:var(--color-surface-2,#f1f5f9);font-size:13px;line-height:1.65}
    .pc-result .big{font-size:15px}.pc-warn{color:var(--color-warning,#b45309);font-weight:600}
    .pc-empty{padding:28px;text-align:center;color:var(--color-text-secondary,#64748b)}
    .pc-foot{display:grid;grid-template-columns:1.4fr 1fr;gap:16px;margin-top:16px}
    .pc-totals{border:1px solid var(--color-border,#e2e8f0);border-radius:10px;padding:12px 14px;background:var(--color-surface-2,#f8fafc);font-size:14px}
    .pc-totals div{display:flex;justify-content:space-between;padding:3px 0}
    .pc-totals .pc-grand{border-top:1px solid var(--color-border,#cbd5e1);margin-top:6px;padding-top:8px;font-size:18px;font-weight:800}
    .pc-vat-need select{border-color:#f0b429;box-shadow:0 0 0 3px rgba(240,180,41,.25)}
    .inv-actions{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:8px}
    .inv-actions .text-xs{flex:1;min-width:180px}
    @media (max-width:760px){.pc-top{grid-template-columns:1fr 1fr}.pc-foot{grid-template-columns:1fr}.pc-list{max-height:none}}
  `;
  function ensurePcStyle() {
    if (document.getElementById('pc-style')) return;
    const st = document.createElement('style'); st.id = 'pc-style'; st.textContent = PC_CSS; document.head.appendChild(st);
  }

  /** "Add supplier" window that opens ON TOP of the New purchase window (which stays untouched). onSaved(supplier) */
  function openQuickSupplier(onSaved) {
    const wrap = document.createElement('div');
    wrap.className = 'modal-backdrop';
    wrap.style.zIndex = 1300;
    wrap.innerHTML = `
      <div class="modal" style="max-width:480px" role="dialog" aria-modal="true">
        <div class="modal-header"><strong>New supplier</strong></div>
        <div class="modal-body">
          <form id="qs-form" novalidate>
            <div class="field"><label>Supplier name</label><input class="input" name="name" required maxlength="120" /></div>
            <div class="form-row">
              <div class="field"><label>Phone</label><input class="input" name="phone" inputmode="tel" /></div>
              <div class="field"><label>Email</label><input class="input" name="email" type="email" /></div>
            </div>
            <div class="form-row">
              <div class="field"><label>Contact person</label><input class="input" name="contactPerson" /></div>
              <div class="field"><label>Payment terms</label><input class="input" name="paymentTerms" placeholder="e.g. Net 30" /></div>
            </div>
            <div class="form-row">
              <div class="field"><label>Address</label><input class="input" name="address" /></div>
              <div class="field"><label>Tax PIN</label><input class="input" name="taxPin" /></div>
            </div>
            <div id="qs-err" role="alert" style="display:none;padding:8px 10px;border-radius:6px;background:#fdecea;border:1px solid #d93025;color:#b3140a;font-weight:600;font-size:13px"></div>
          </form>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" id="qs-cancel">Cancel</button>
          <button type="button" class="btn btn-primary" id="qs-save">Save supplier</button>
        </div>
      </div>`;
    document.body.appendChild(wrap);
    const form = wrap.querySelector('#qs-form');
    const err = wrap.querySelector('#qs-err');
    const close = () => { document.removeEventListener('keydown', onKey, true); wrap.remove(); };
    function onKey(e) {
      if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); close(); }
      else if (e.key === 'Enter' && e.target.tagName !== 'BUTTON') { e.stopPropagation(); e.preventDefault(); wrap.querySelector('#qs-save').click(); }
    }
    document.addEventListener('keydown', onKey, true);
    const showErr = (t) => { err.style.display = t ? '' : 'none'; err.textContent = t || ''; };
    wrap.querySelector('#qs-cancel').addEventListener('click', close);
    wrap.addEventListener('mousedown', (e) => { if (e.target === wrap) e.preventDefault(); });
    wrap.querySelector('#qs-save').addEventListener('click', async () => {
      const payload = window.UI.serializeForm(form);
      payload.name = String(payload.name || '').trim();
      if (!payload.name) { showErr('Enter the supplier name.'); form.name.focus(); return; }
      if (payload.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(payload.email)) { showErr('That email address does not look right.'); form.email.focus(); return; }
      const dup = (suppliersCache || []).find((x) => String(x.name || '').trim().toLowerCase() === payload.name.toLowerCase());
      if (dup) { showErr(`A supplier named "${dup.name}" already exists. Pick it from the list instead.`); form.name.focus(); return; }
      showErr('');
      const btn = wrap.querySelector('#qs-save');
      window.UI.setButtonLoading(btn, true, 'Saving…');
      try {
        const res = await window.Api.post('/suppliers', payload);
        let sup = res && res.data && (res.data.supplier || (res.data._id ? res.data : null));
        suppliersCache = null;
        const list = await getSuppliers();
        if (!sup || !sup._id) sup = list.find((x) => String(x.name).toLowerCase() === payload.name.toLowerCase());
        window.UI.toast.success('Supplier added');
        close();
        if (sup) onSaved(sup, list);
      } catch (e) {
        showErr(e.message || 'Could not save the supplier');
        window.UI.setButtonLoading(btn, false);
      }
    });
    setTimeout(() => form.name.focus(), 30);
  }


  async function openCreateModal() {
    ensurePcStyle();
    fpWarm(); // refresh the device copy of the catalog while the window opens
    const branchId = window.AppShell.getActiveBranchId();
    let suppliers = [];
    try { suppliers = await getSuppliers(); } catch (err) { window.UI.toast.error(err.message || 'Could not load suppliers'); }

    const money = window.UI.formatMoney;
    const items = [];
    const vat = { mode: '', rate: 16 };
    let supId = '';
    let done = false;
    let timer = null;
    const draft = getDraft();
    const supName = () => { const s = (suppliersCache || suppliers).find((x) => x._id === supId); return s ? s.name : ''; };

    const modal = window.UI.openModal({
      title: 'New purchase',
      maxWidth: '1040px',
      bodyHtml: `
        <form id="purchase-form" novalidate>
          <div class="pc-top">
            <div class="field">
              <label>Supplier</label>
              <div class="pc-sup-row">
                <select class="select" name="supplierId" id="pc-supplier" required><option value="">${suppliers.length ? 'Choose supplier…' : 'No suppliers yet - add one →'}</option>${suppliers.map((s) => `<option value="${s._id}">${esc(s.name)}</option>`).join('')}</select>
                <button type="button" class="btn btn-secondary" id="new-supplier-btn" data-requires-permission="suppliers.create">${window.Icons.get('plus')} New supplier</button>
              </div>
            </div>
            <div class="field"><label>Supplier invoice # <span class="text-muted">(optional)</span></label><input class="input" name="invoiceNumber" /></div>
            <div class="field pc-vat-need" id="vat-field">
              <label>VAT on this purchase</label>
              <select class="select" id="vat-mode">
                <option value="">Choose…</option>
                <option value="INCLUSIVE">Prices include VAT</option>
                <option value="EXCLUSIVE">Prices exclude VAT</option>
                <option value="NONE">No VAT</option>
              </select>
            </div>
            <div class="field" id="vat-rate-field" style="visibility:hidden">
              <label>VAT rate (%)</label>
              <input class="input" id="vat-rate" type="number" min="0" max="100" step="0.01" value="16" />
            </div>
          </div>

          <div class="pc-bar">
            <button type="button" class="btn btn-primary" id="add-item-btn">${window.Icons.get('plus')} Add product</button>
            <span class="pc-hint">Choose the supplier first. Products you add are saved to that supplier and appear automatically next time - you only type quantities. Progress is saved as you type.</span>
          </div>
          <div id="pc-fill-note"></div>

          <div class="pc-list" id="purchase-items"></div>

          <div class="pc-foot">
            <div>
              <div class="field"><label>Supplier invoice <span class="text-muted">(optional)</span></label><div id="invoice-picker"></div></div>
              <div class="field"><label>Notes <span class="text-muted">(optional)</span></label><textarea class="textarea" name="notes" rows="2"></textarea></div>
            </div>
            <div class="pc-totals" id="purchase-summary"></div>
          </div>
        </form>
      `,
      footerHtml: `<button class="btn btn-ghost" data-action="discard" style="margin-right:auto">Discard draft</button><button class="btn btn-secondary" data-action="cancel">Close (draft saved)</button><button class="btn btn-primary" data-action="save" id="purchase-save-btn">Create purchase</button>`,
    });

    const picker = createInvoicePicker(modal.querySelector('#invoice-picker'));
    const liquor = !!(window.LiquorTill && window.LiquorTill.active());
    const form = modal.querySelector('#purchase-form');
    const supSel = modal.querySelector('#pc-supplier');
    const list = modal.querySelector('#purchase-items');

    /** Real cost of ONE piece incl. VAT - the number the backend stores as the product cost. */
    const realCost = (it) => splitPrice(packPrice(it), vat.mode, vat.rate).inclVat / packOf(it);
    const isActive = (it) => Number(it.quantity) > 0;

    /* ---------- save progress ---------- */
    function persist() {
      clearTimeout(timer);
      if (done || !modal.isConnected) return;
      if (supId) memUpsert(supId, items, vat);
      const inv = form.invoiceNumber ? form.invoiceNumber.value : '';
      const notes = form.notes ? form.notes.value : '';
      if (!items.length && !supId && !inv && !notes) clearDraft();
      else lsSet(DRAFT_KEY(), { v: 2, savedAt: Date.now(), supplierId: supId, supplierName: supName(), invoiceNumber: inv, notes, vatMode: vat.mode, vatRate: vat.rate, items: items.map(serializeItem) });
      renderDraftBanner();
    }
    const persistSoon = () => { clearTimeout(timer); timer = setTimeout(persist, 250); };
    const onHide = () => { if (!modal.isConnected) { window.removeEventListener('pagehide', onHide); document.removeEventListener('visibilitychange', onHide); return; } persist(); };
    window.addEventListener('pagehide', onHide);
    document.addEventListener('visibilitychange', onHide);
    form.addEventListener('input', persistSoon);

    function applyVat(mode, rate) {
      vat.mode = mode || ''; if (rate != null) vat.rate = Number(rate) || 0;
      modal.querySelector('#vat-mode').value = vat.mode;
      modal.querySelector('#vat-rate').value = vat.rate;
      modal.querySelector('#vat-rate-field').style.visibility = vat.mode === 'INCLUSIVE' || vat.mode === 'EXCLUSIVE' ? 'visible' : 'hidden';
      modal.querySelector('#vat-field').classList.toggle('pc-vat-need', !vat.mode);
    }

    /* ---------- labels & maths ---------- */
    const vatSuffix = () => (vat.mode === 'INCLUSIVE' ? ' incl. VAT' : vat.mode === 'EXCLUSIVE' ? ' excl. VAT' : '');
    const qtyLabel = (it) => (isBulk(it) ? `How many ${unitLabel(it)}s? (quantity)` : 'Quantity (pieces)');
    const packLabel = (it) => `Pieces in 1 ${unitLabel(it)}`;
    const priceFieldLabel = (it) => `${isBulk(it) ? (it.priceMode === 'unit' ? 'Price per piece' : `Price per ${unitLabel(it)}`) : 'Cost per piece'}${vatSuffix()} (KES)`;

    function calcHtml(it) {
      const n = packOf(it); const q = Number(it.quantity) || 0; const pp = packPrice(it); const u = unitLabel(it);
      if (!(pp > 0) && !(q > 0)) return '<span class="text-muted">Enter the quantity and price - the system does all the maths.</span>';
      const { exVat, inclVat } = splitPrice(pp, vat.mode, vat.rate);
      const out = [];
      if (isBulk(it) && n === 1 && it.unitName !== 'Piece') out.push(`<div class="pc-warn">Enter how many pieces are in 1 ${esc(u)} (tap a number above).</div>`);
      if (n > 1) {
        out.push(`<div>${fmtN(q)} ${esc(u)} &times; ${n} = <b class="big">${fmtN(q * n)} pieces</b> go into stock</div>`);
        out.push(`<div>1 ${esc(u)} costs <b>${money(inclVat)}</b> &rarr; <b class="big">${money(inclVat / n)} per piece</b></div>`);
      } else out.push(`<div>Cost per piece: <b class="big">${money(inclVat)}</b></div>`);
      if (vat.mode && vat.mode !== 'NONE') out.push(`<div class="text-muted">Excl. VAT: ${money(exVat)} per ${n > 1 ? esc(u) : 'piece'} &middot; VAT ${vat.rate}%</div>`);
      out.push(`<div>Line total: <b class="big">${money(inclVat * q)}</b></div>`);
      return out.join('');
    }

    function priceBoxHtml(it, i) {
      const pu = it.priceUpdate;
      if (!pu) return `<button type="button" class="btn btn-ghost btn-sm" data-edit-prices="${i}">Update selling price &amp; discount</button>`;
      return `
        <div class="pu-box">
          <div class="pu-box-text"><b>Prices will update when saved</b><br>Cost ${money(realCost(it))}/piece &middot; Selling ${money(pu.sellingPrice)}${pu.discount > 0 ? ` &middot; Discount ${money(pu.discount)}/unit` : ''}</div>
          <button type="button" class="btn btn-secondary btn-sm" data-edit-prices="${i}">Edit</button>
          <button type="button" class="btn btn-ghost btn-sm" data-clear-prices="${i}">Remove</button>
        </div>`;
    }

    /** Pop-up after the owner enters a cost: offer to update selling price / discount (own overlay, never closes the purchase window). */
    function openPriceDialog(it, onDone) {
      const src = it.variant ? it.variant : it.product;
      const cost = realCost(it);
      const startSell = it.priceUpdate ? it.priceUpdate.sellingPrice : (Number(src.sellingPrice) || 0);
      const startDisc = it.priceUpdate ? it.priceUpdate.discount : (Number(it.product.defaultDiscount) || 0);
      const wrap = document.createElement('div');
      wrap.className = 'modal-backdrop'; wrap.style.zIndex = 1250;
      wrap.innerHTML = `
        <div class="modal" style="max-width:440px" role="dialog" aria-modal="true">
          <div class="modal-header"><strong>Update prices?</strong></div>
          <div class="modal-body">
            <p class="text-sm text-secondary" style="margin-bottom:var(--space-3)">
              <b>${esc(it.product.name)}</b><br>
              New cost price: <b>${money(cost)}</b> per piece <span class="text-muted">(was ${money(Number(src.costPrice) || 0)})</span>
            </p>
            <div class="form-row">
              <div class="field"><label>Selling price per piece (KES)</label><input class="input" id="pd-sell" type="number" min="0" step="0.01" value="${startSell}" /></div>
              <div class="field"><label>Discount per unit <span class="text-muted">(optional)</span></label><input class="input" id="pd-disc" type="number" min="0" step="0.01" value="${startDisc || ''}" placeholder="0" /></div>
            </div>
            <div class="text-xs" id="pd-hint" style="min-height:18px"></div>
            <p class="text-xs text-muted" style="margin-top:var(--space-2)">Choosing “Update prices” saves the new cost, selling price and discount when you create the purchase.</p>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" id="pd-skip">Skip</button>
            <button type="button" class="btn btn-primary" id="pd-ok">Update prices</button>
          </div>
        </div>`;
      document.body.appendChild(wrap);
      const sellEl = wrap.querySelector('#pd-sell'); const discEl = wrap.querySelector('#pd-disc'); const hint = wrap.querySelector('#pd-hint');
      function check() {
        const sell = Number(sellEl.value) || 0; const disc = Number(discEl.value) || 0;
        let msg = ''; let bad = false;
        if (disc > sell) { msg = 'Discount cannot be more than the selling price.'; bad = true; }
        else if (sell < cost) msg = `Selling price is below cost - loss of ${money(cost - sell)} per unit.`;
        else if (cost > 0 && sell > 0) msg = `Margin: ${money(sell - cost)} per unit (${(((sell - cost) / sell) * 100).toFixed(1)}%)`;
        hint.style.color = bad ? 'var(--color-danger)' : sell < cost ? 'var(--color-warning)' : 'var(--color-text-secondary)';
        hint.textContent = msg; return !bad;
      }
      sellEl.addEventListener('input', check); discEl.addEventListener('input', check); check();
      const close = () => { document.removeEventListener('keydown', onKey, true); wrap.remove(); };
      function onKey(e) {
        if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); close(); }
        else if (e.key === 'Enter') { e.stopPropagation(); e.preventDefault(); wrap.querySelector('#pd-ok').click(); }
      }
      document.addEventListener('keydown', onKey, true);
      wrap.querySelector('#pd-skip').addEventListener('click', close);
      wrap.addEventListener('click', (e) => { if (e.target === wrap) close(); });
      wrap.querySelector('#pd-ok').addEventListener('click', () => {
        if (!check()) return;
        onDone({ sellingPrice: Number(sellEl.value) || 0, discount: Number(discEl.value) || 0 }); close();
      });
      sellEl.focus(); sellEl.select();
    }

    function liquorChip(it) {
      const d = window.LiquorTill.info(it.product._id);
      return d ? ` <span class="lq-chip lq-c-${esc(d.category)}" style="margin-left:6px">${esc(String(d.category).replace(/_/g, ' ').toLowerCase())}</span>${d.abv != null ? ` <span class="lq-abv">${esc(d.abv)}%</span>` : ''}${d.volumeMl ? ` <span class="text-xs text-muted">${esc(d.volumeMl)} ml</span>` : ''}` : '';
    }

    /** Update everything that depends on numbers WITHOUT re-drawing inputs (keeps the keyboard open on phones). */
    function refreshCalc() {
      list.querySelectorAll('[data-calc]').forEach((el) => { el.innerHTML = calcHtml(items[Number(el.dataset.calc)]); });
      list.querySelectorAll('[data-pricebox]').forEach((el) => { const i = Number(el.dataset.pricebox); el.innerHTML = priceBoxHtml(items[i], i); });
      list.querySelectorAll('[data-lab]').forEach((el) => {
        const it = items[Number(el.dataset.idx)]; if (!it) return;
        const k = el.dataset.lab;
        el.textContent = k === 'qty' ? qtyLabel(it) : k === 'pack' ? packLabel(it) : k === 'price' ? priceFieldLabel(it) : k === 'segpack' ? `Per ${unitLabel(it)}` : '';
      });
      let ex = 0; let incl = 0; let units = 0; let active = 0; let skipped = 0;
      items.forEach((it) => {
        if (!isActive(it)) { skipped += 1; return; }
        const p = splitPrice(packPrice(it), vat.mode, vat.rate);
        ex += p.exVat * it.quantity; incl += p.inclVat * it.quantity; units += it.quantity * packOf(it); active += 1;
      });
      modal.querySelector('#purchase-summary').innerHTML = `
        <div><span>Products in this purchase</span><b>${active}</b></div>
        <div><span>Total pieces received</span><b>${fmtN(units)}</b></div>
        ${skipped ? `<div class="text-muted"><span>Saved lines with no quantity (skipped)</span><span>${skipped}</span></div>` : ''}
        ${vat.mode && vat.mode !== 'NONE' ? `<div><span>Subtotal excl. VAT</span><span>${money(ex)}</span></div><div><span>VAT (${vat.rate}%)</span><span>${money(incl - ex)}</span></div>` : ''}
        <div class="pc-grand"><span>Total</span><span>${money(incl)}</span></div>`;
      const sb = modal.querySelector('#purchase-save-btn');
      if (sb && !sb.dataset.loading) sb.textContent = active ? `Create purchase · ${money(incl)}` : 'Create purchase';
    }

    function cardHtml(it, i) {
      const vlabel = it.variant ? Object.values(it.variant.attributes || {}).join(', ') : '';
      const sku = (it.variant ? it.variant.sku : it.product.sku) || '';
      const bulk = isBulk(it); const n = packOf(it);
      const saved = supId && memGet(supId).items[itemKey(it)];
      const unitOpts = UNITS.map((u) => `<option value="${u}"${!it.customUnit && it.unitName === u ? ' selected' : ''}>${u === 'Piece' ? 'Piece (single)' : u}</option>`).join('') + `<option value="__other"${it.customUnit ? ' selected' : ''}>Other…</option>`;
      return `
      <div class="pc-card${isActive(it) ? '' : ' pc-skip'}" data-row="${i}">
        <div class="pc-head">
          <div>
            <div class="pc-name">${esc(it.product.name)}${vlabel ? ` <span class="text-muted">(${esc(vlabel)})</span>` : ''}${liquor ? liquorChip(it) : ''}${saved ? '<span class="pc-tag">saved for supplier</span>' : ''}</div>
            ${sku ? `<div class="pc-sku">SKU: ${esc(sku)}</div>` : ''}
          </div>
          <button type="button" class="btn btn-ghost btn-sm btn-icon" data-remove="${i}" title="Remove" aria-label="Remove">${window.Icons.get('trash')}</button>
        </div>
        <div class="pc-grid">
          <div class="field"><label>Bought in</label>
            <select class="select" data-unit="${i}">${unitOpts}</select>
            ${it.customUnit ? `<input class="input" style="margin-top:6px" data-field="unitName" data-idx="${i}" value="${esc(it.unitName)}" placeholder="e.g. Bale, Sack 50kg" maxlength="24" />` : ''}
          </div>
          ${bulk ? `<div class="field"><label data-lab="pack" data-idx="${i}">${esc(packLabel(it))}</label>
            <input class="input" type="number" min="1" step="1" inputmode="numeric" value="${n > 1 ? n : ''}" placeholder="e.g. 24" data-field="pack" data-idx="${i}" />
            <div class="pc-chips">${PACK_CHIPS.map((x) => `<button type="button" data-packset="${x}" data-idx="${i}" class="${n === x ? 'on' : ''}">${x}</button>`).join('')}</div></div>` : ''}
          <div class="field"><label data-lab="qty" data-idx="${i}">${esc(qtyLabel(it))}</label>
            <input class="input" type="number" min="0" step="0.01" inputmode="decimal" value="${it.quantity > 0 ? it.quantity : ''}" placeholder="0" data-field="quantity" data-idx="${i}" /></div>
          <div class="field"><label data-lab="price" data-idx="${i}">${esc(priceFieldLabel(it))}</label>
            <input class="input" type="number" min="0" step="0.01" inputmode="decimal" value="${it.price || ''}" placeholder="0" data-field="price" data-idx="${i}" />
            ${bulk ? `<div class="pc-seg"><button type="button" data-pmode="pack" data-idx="${i}" class="${it.priceMode !== 'unit' ? 'on' : ''}"><span data-lab="segpack" data-idx="${i}">Per ${esc(unitLabel(it))}</span></button><button type="button" data-pmode="unit" data-idx="${i}" class="${it.priceMode === 'unit' ? 'on' : ''}">Per piece</button></div>` : ''}</div>
        </div>
        <div class="pc-result" data-calc="${i}"></div>
        <div data-pricebox="${i}" style="margin-top:8px"></div>
      </div>`;
    }

    function renderItems(focusIdx, focusField) {
      if (!items.length) {
        list.innerHTML = `<div class="pc-empty"><b>No products added yet</b><br>Pick the supplier, then click <b>Add product</b>. Products you add are remembered for that supplier.</div>`;
        refreshCalc(); return;
      }
      list.innerHTML = items.map(cardHtml).join('');
      refreshCalc();
      if (focusIdx != null) {
        const q = list.querySelector(`input[data-field="${focusField || 'quantity'}"][data-idx="${focusIdx}"]`);
        const card = list.querySelector(`[data-row="${focusIdx}"]`);
        if (card) card.scrollIntoView({ block: 'nearest' });
        if (q) { q.focus(); q.select(); }
      }
    }

    /* ---------- one set of delegated listeners (cards are re-drawn often) ---------- */
    list.addEventListener('keydown', (e) => { if (e.target.type === 'number' && ['e', 'E', '+', '-'].includes(e.key)) e.preventDefault(); });
    list.addEventListener('focusin', (e) => { if (e.target.tagName === 'INPUT' && e.target.type === 'number') e.target.select(); });
    list.addEventListener('input', (e) => {
      const t = e.target; const f = t.dataset.field; if (!f) return;
      const it = items[Number(t.dataset.idx)]; if (!it) return;
      const card = t.closest('.pc-card');
      if (f === 'unitName') it.unitName = t.value;
      else it[f] = Number(t.value) || 0;
      if (f === 'price' || f === 'pack') it.canon = null;
      if (f === 'pack') card.querySelectorAll('[data-packset]').forEach((b) => b.classList.toggle('on', Number(b.dataset.packset) === packOf(it)));
      if (f === 'quantity') card.classList.toggle('pc-skip', !isActive(it));
      card.classList.remove('pc-row-bad');
      refreshCalc(); persistSoon();
    });
    list.addEventListener('change', (e) => {
      const t = e.target;
      if (t.dataset.unit != null) {
        const i = Number(t.dataset.unit); const it = items[i]; const v = t.value;
        if (v === '__other') { it.customUnit = true; it.unitName = ''; }
        else {
          it.customUnit = false; it.unitName = v;
          if (v === 'Piece') { it.pack = 1; it.priceMode = 'pack'; }
          if (v === 'Dozen') it.pack = 12;
        }
        it.canon = null; persistSoon();
        renderItems(i, v === 'Piece' ? 'quantity' : it.customUnit ? 'unitName' : (packOf(it) > 1 ? 'quantity' : 'pack'));
        return;
      }
      if (t.dataset.field === 'price') {
        const it = items[Number(t.dataset.idx)];
        if (!it || !(it.price > 0) || it.promptedFor === it.price) return;
        it.promptedFor = it.price;
        openPriceDialog(it, (pu) => { it.priceUpdate = pu; refreshCalc(); persistSoon(); });
      }
    });
    list.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.remove != null) { removeRow(items[Number(b.dataset.remove)]); return; }
      if (b.dataset.packset != null) {
        const i = Number(b.dataset.idx); const it = items[i];
        it.pack = Number(b.dataset.packset); it.canon = null;
        const card = b.closest('.pc-card');
        card.querySelector('input[data-field="pack"]').value = it.pack;
        card.querySelectorAll('[data-packset]').forEach((x) => x.classList.toggle('on', x === b));
        refreshCalc(); persistSoon();
        const q = card.querySelector('input[data-field="quantity"]'); if (q) q.focus();
        return;
      }
      if (b.dataset.pmode != null) {
        const i = Number(b.dataset.idx); const it = items[i]; const m = b.dataset.pmode;
        if (it.priceMode === m) return;
        const canon = packPrice(it); it.canon = canon; it.priceMode = m;
        it.price = round4(m === 'unit' ? canon / packOf(it) : canon);
        const card = b.closest('.pc-card');
        card.querySelector('input[data-field="price"]').value = it.price || '';
        card.querySelectorAll('[data-pmode]').forEach((x) => x.classList.toggle('on', x === b));
        refreshCalc(); persistSoon(); return;
      }
      if (b.dataset.editPrices != null) { const it = items[Number(b.dataset.editPrices)]; openPriceDialog(it, (pu) => { it.priceUpdate = pu; refreshCalc(); persistSoon(); }); return; }
      if (b.dataset.clearPrices != null) { items[Number(b.dataset.clearPrices)].priceUpdate = null; refreshCalc(); persistSoon(); }
    });

    async function removeRow(it) {
      if (!it) return;
      persist();
      const remembered = supId && memGet(supId).items[itemKey(it)];
      let choice = 'once';
      if (remembered) choice = await askRemove(it.product.name, supName());
      if (choice === 'cancel') return;
      if (choice === 'forget') memForget(supId, itemKey(it));
      const idx = items.indexOf(it); if (idx >= 0) items.splice(idx, 1);
      renderItems(); persist();
      if (choice === 'forget') window.UI.toast.info(`${it.product.name} removed from ${supName() || 'the supplier'}'s saved list`);
    }

    /* ---------- supplier: auto-fill remembered products ---------- */
    async function switchSupplier(newId) {
      if (newId === supId) return;
      const entries = newId ? Object.values(memGet(newId).items || {}).sort((a, b) => String(a.product.name).localeCompare(String(b.product.name))) : [];
      const prev = supId;
      const hasQty = items.some(isActive);
      if (prev && entries.length && hasQty) {
        const ok = await window.UI.confirmDialog({ title: 'Change supplier?', message: `The products you entered stay saved under ${supName()}. ${suppliersName(newId)}'s saved products will be loaded instead.`, confirmText: 'Change supplier' });
        if (!ok) { supSel.value = prev; return; }
      }
      persist(); // keep what was typed under the previous supplier
      supId = newId;
      if (entries.length) {
        if (prev) items.length = 0; // moving between suppliers: start from the new supplier's list
        const have = new Set(items.map(itemKey));
        let added = 0;
        entries.forEach((e) => { const x = fromEntry(e); if (!have.has(itemKey(x))) { items.push(x); added += 1; } });
        const m = memGet(newId);
        if (!vat.mode && m.vat && m.vat.mode) applyVat(m.vat.mode, m.vat.rate);
        modal.querySelector('#pc-fill-note').innerHTML = `<div class="pc-note"><b>${added} product${added === 1 ? '' : 's'}</b> loaded from ${esc(suppliersName(newId))}. Just type the quantities - lines left empty are skipped. Use the bin to remove a product.</div>`;
      } else {
        modal.querySelector('#pc-fill-note').innerHTML = newId ? `<div class="pc-note">No saved products for ${esc(suppliersName(newId))} yet - add them once and they will appear every time.</div>` : '';
      }
      renderItems(); persist();
    }
    const suppliersName = (id) => { const s = (suppliersCache || suppliers).find((x) => x._id === id); return s ? s.name : 'this supplier'; };
    supSel.addEventListener('change', () => switchSupplier(supSel.value));

    /* ---------- VAT ---------- */
    modal.querySelector('#vat-mode').addEventListener('change', (e) => { applyVat(e.target.value); refreshCalc(); persist(); });
    modal.querySelector('#vat-rate').addEventListener('input', (e) => { vat.rate = Number(e.target.value) || 0; refreshCalc(); persistSoon(); });

    /* ---------- add product ---------- */
    modal.querySelector('#add-item-btn').addEventListener('click', () => {
      if (!supId) { window.UI.toast.error('Choose the supplier first'); supSel.focus(); return; }
      if (!vat.mode) { window.UI.toast.error('Choose the VAT option before adding products'); modal.querySelector('#vat-mode').focus(); return; }
      openFastPicker({
        has: (e) => { const k = `${e.product._id}|${e.variant ? e.variant._id : ''}`; const hit = items.find((x) => itemKey(x) === k); return hit ? hit.quantity : 0; },
        onSelect: ({ product, variant }) => {
          const probe = newItem(product, variant, 1);
          const same = items.findIndex((x) => itemKey(x) === itemKey(probe));
          if (same >= 0) {
            items[same].quantity = (Number(items[same].quantity) || 0) + 1;
            window.UI.toast.info(`${product.name}: quantity is now ${fmtN(items[same].quantity)}`);
            renderItems(same); persist(); return;
          }
          const mem = memGet(supId).items[itemKey(probe)];
          const it = mem ? { ...fromEntry(mem), quantity: 1 } : probe;
          items.push(it);
          renderItems(items.length - 1, isBulk(it) ? 'quantity' : 'quantity');
          persist();
          if (!mem) window.UI.toast.info(`${product.name} saved under ${supName()} - it will appear next time`);
        },
      });
    });

    const openNewSupplier = () => openQuickSupplier((sup, l) => {
      supSel.innerHTML = `<option value="">Choose supplier…</option>${l.map((x) => `<option value="${x._id}">${esc(x.name)}</option>`).join('')}`;
      supSel.value = sup._id; switchSupplier(sup._id);
    });
    modal.querySelector('#new-supplier-btn').addEventListener('click', openNewSupplier);
    window.Permissions.applyPermissionGates(modal, window.AppShell.getUser());
    if (!suppliers.length && !draft) setTimeout(openNewSupplier, 150);

    /* ---------- restore an unfinished purchase ---------- */
    if (draft && (draft.items.length || draft.supplierId || draft.invoiceNumber || draft.notes)) {
      if (draft.supplierId && (suppliers.some((s) => s._id === draft.supplierId))) { supId = draft.supplierId; supSel.value = supId; }
      if (draft.invoiceNumber) form.invoiceNumber.value = draft.invoiceNumber;
      if (draft.notes) form.notes.value = draft.notes;
      if (draft.vatMode) applyVat(draft.vatMode, draft.vatRate);
      draft.items.forEach((o) => { try { items.push(reviveItem(o)); } catch (e) { /* skip bad line */ } });
      if (items.length) window.UI.toast.info(`Unfinished purchase restored (${items.length} product${items.length === 1 ? '' : 's'})`);
    }
    renderItems();

    /* ---------- close / discard ---------- */
    modal.querySelector('[data-action="cancel"]').addEventListener('click', () => { persist(); picker.destroy(); window.UI.closeModal(); });
    modal.querySelector('[data-action="discard"]').addEventListener('click', async () => {
      const ok = await window.UI.confirmDialog({ title: 'Discard this draft?', message: 'Everything typed in this purchase will be deleted. Supplier product lists are kept.', confirmText: 'Discard', danger: true });
      if (!ok) return;
      done = true; clearTimeout(timer); clearDraft(); renderDraftBanner(); picker.destroy(); window.UI.closeModal();
    });

    /* ---------- create ---------- */
    modal.querySelector('[data-action="save"]').addEventListener('click', async () => {
      if (!supSel.value) { window.UI.toast.error('Choose a supplier, or add a new one'); supSel.focus(); return; }
      if (!vat.mode) return window.UI.toast.error('Choose the VAT option first');
      const active = items.filter(isActive);
      if (!active.length) return window.UI.toast.error(items.length ? 'Enter a quantity for at least one product' : 'Add at least one item');
      const cards = list.querySelectorAll('.pc-card');
      cards.forEach((r) => r.classList.remove('pc-row-bad'));
      const flag = (it) => { const c = cards[items.indexOf(it)]; if (c) { c.classList.add('pc-row-bad'); c.scrollIntoView({ block: 'center' }); } };
      const odd = active.find((it) => it.unitName !== 'Piece' && packOf(it) === 1);
      if (odd) {
        flag(odd);
        const okOdd = await window.UI.confirmDialog({ title: 'Check the pieces', message: `${odd.product.name}: 1 ${unitLabel(odd) || 'unit'} = 1 piece. Is that right? Choose Cancel to enter how many pieces are inside.`, confirmText: 'Yes, 1 piece' });
        if (!okOdd) return;
        cards.forEach((r) => r.classList.remove('pc-row-bad'));
      }
      const zero = active.find((it) => !(packPrice(it) > 0));
      if (zero) {
        flag(zero);
        const okZero = await window.UI.confirmDialog({ title: 'Cost is 0', message: `${zero.product.name} has a cost of 0. Is this free stock? Choose Cancel to enter the cost.`, confirmText: 'Yes, cost is 0' });
        if (!okZero) return;
      }
      const raw = window.UI.serializeForm(form);
      const rate = vat.mode === 'NONE' ? 0 : vat.rate;

      const fd = new FormData();
      fd.append('branchId', branchId);
      fd.append('supplierId', raw.supplierId);
      if (raw.invoiceNumber) fd.append('invoiceNumber', raw.invoiceNumber);
      if (raw.notes) fd.append('notes', raw.notes);
      fd.append('vatMode', vat.mode);
      fd.append('vatRate', rate);
      fd.append('items', JSON.stringify(active.map((it) => {
        const line = {
          productId: it.product._id,
          variantId: it.variant ? it.variant._id : undefined,
          quantity: it.quantity * packOf(it), // stock is always kept in single pieces
          unitCost: splitPrice(packPrice(it), vat.mode, rate).exVat / packOf(it), // ex-VAT cost of ONE piece; backend adds VAT via taxRate
          taxRate: rate,
        };
        if (it.priceUpdate) { line.updatePrices = true; line.sellingPrice = it.priceUpdate.sellingPrice; line.defaultDiscount = it.priceUpdate.discount; }
        return line;
      })));
      picker.getFiles().forEach((f) => fd.append('invoices', f, f.name));

      const updatedCount = active.filter((it) => it.priceUpdate).length;
      const skipped = items.length - active.length;
      const btn = document.getElementById('purchase-save-btn');
      window.UI.setButtonLoading(btn, true, 'Creating…');
      try {
        await window.Api.upload('/purchases', fd);
        memUpsert(supId, items, vat); // remember latest units & prices for next time
        done = true; clearTimeout(timer); clearDraft(); renderDraftBanner();
        window.UI.toast.success(`Purchase created${updatedCount ? ` - ${updatedCount} product price${updatedCount > 1 ? 's' : ''} updated` : ''}${skipped ? ` (${skipped} saved line${skipped > 1 ? 's' : ''} without quantity skipped)` : ''}`);
        picker.destroy();
        window.UI.closeModal();
        fetchAndRender();
      } catch (err) {
        window.UI.toast.error(err.message); // draft is kept - nothing is lost
      } finally {
        window.UI.setButtonLoading(btn, false);
      }
    });
  }
})();