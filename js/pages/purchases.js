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

    return {
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
      window.ProductPicker.open({
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