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
 * Invoices: picked files are previewed locally before upload; saved files
 * are previewed from Cloudinary in the purchase detail. Both open in the
 * same full-screen viewer.
 */
(function () {
  const state = { page: 1, limit: 10 };
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
    document.getElementById('add-purchase-btn').addEventListener('click', openCreateModal);
    await fetchAndRender();
  }

  function pageSkeleton() {
    return `
      <div class="page-header">
        <div><h1>Purchases</h1><p>Purchase orders from suppliers and stock receiving.</p></div>
        <button class="btn btn-primary" id="add-purchase-btn" data-requires-permission="purchases.create">${window.Icons.get('plus')} New purchase</button>
      </div>
      <div class="card">
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>PO #</th><th>Supplier</th><th>Date</th><th>Total</th><th>Payment</th><th>Received</th><th></th></tr></thead>
            <tbody id="purchases-tbody">${window.UI.skeletonRows(7, 5)}</tbody>
          </table>
        </div>
        <div class="pagination" id="pagination"></div>
      </div>
    `;
  }

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
            <td><span class="badge ${RECV_BADGE[p.receivedStatus]}">${p.receivedStatus}</span></td>
            <td class="actions"><button class="btn btn-secondary btn-sm" data-action="view">View</button></td>
          </tr>
        `).join('');
      }
      window.UI.renderPagination(document.getElementById('pagination'), data, (p) => { state.page = p; fetchAndRender(); });
      window.Permissions.applyPermissionGates(contentEl, window.AppShell.getUser());
      document.querySelectorAll('[data-action="view"]').forEach((btn) => {
        btn.addEventListener('click', () => openDetailModal(btn.closest('tr').dataset.id));
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

    const modal = window.UI.openModal({
      title: `Purchase ${purchase.purchaseNumber}`,
      maxWidth: '680px',
      bodyHtml: `
        <div class="text-sm text-secondary" style="margin-bottom: var(--space-3)">Supplier: ${esc(purchase.supplierId?.name || '')} &middot; ${window.UI.formatDate(purchase.purchaseDate)}${purchase.invoiceNumber ? ` &middot; Invoice # ${esc(purchase.invoiceNumber)}` : ''}</div>
        ${purchase.vatMode && purchase.vatMode !== 'NONE' ? `<div class="text-sm text-secondary" style="margin-bottom: var(--space-3)">${VAT_LABEL[purchase.vatMode]} @ ${purchase.vatRate}%</div>` : ''}
        ${attachmentsHtml(purchase.attachments)}
        <div class="table-wrap" style="margin-bottom: var(--space-4)">
          <table class="table">
            <thead><tr><th>Item</th><th>Qty</th><th>Unit cost</th><th>Real unit cost</th><th>Total</th></tr></thead>
            <tbody>${purchase.items.map((i) => `<tr><td class="text-sm">${esc(i.nameSnapshot)}</td><td>${i.quantity}</td><td>${window.UI.formatMoney(i.unitCost)}</td><td>${window.UI.formatMoney(i.total / i.quantity)}</td><td>${window.UI.formatMoney(i.total)}</td></tr>`).join('')}</tbody>
          </table>
        </div>
        <div class="pos-totals-row"><span>Subtotal</span><span>${window.UI.formatMoney(purchase.subtotal)}</span></div>
        <div class="pos-totals-row"><span>Tax</span><span>${window.UI.formatMoney(purchase.tax)}</span></div>
        <div class="pos-totals-row grand"><span>Total</span><span>${window.UI.formatMoney(purchase.total)}</span></div>
        <div class="pos-totals-row"><span>Paid</span><span>${window.UI.formatMoney(purchase.amountPaid)}</span></div>
        <div class="pos-totals-row" style="color:${purchase.balance > 0 ? 'var(--color-warning)' : ''}"><span>Balance</span><span>${window.UI.formatMoney(purchase.balance)}</span></div>
      `,
      footerHtml: `
        <button class="btn btn-secondary" data-action="close">Close</button>
        ${canPay ? `<button class="btn btn-secondary" data-action="pay">Record payment</button>` : ''}
        ${canReceive ? `<button class="btn btn-primary" data-action="receive">Mark received</button>` : ''}
      `,
    });

    const gallery = modal.querySelector('#inv-gallery');
    if (gallery) bindCards(gallery, (purchase.attachments || []).map(remoteItem));

    modal.querySelector('[data-action="close"]').addEventListener('click', window.UI.closeModal);
    modal.querySelector('[data-action="receive"]')?.addEventListener('click', async () => {
      try {
        await window.Api.post(`/purchases/${purchase._id}/receive`);
        window.UI.toast.success('Purchase received - inventory updated');
        window.UI.closeModal();
        fetchAndRender();
      } catch (err) {
        window.UI.toast.error(err.message);
      }
    });
    modal.querySelector('[data-action="pay"]')?.addEventListener('click', () => {
      window.UI.closeModal();
      openPaymentModal(purchase);
    });
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

  async function openCreateModal() {
    const branchId = window.AppShell.getActiveBranchId();
    const suppliers = await getSuppliers();
    if (!suppliers.length) {
      window.UI.toast.error('Add a supplier first');
      return;
    }

    const money = window.UI.formatMoney;
    // { product, variant, quantity, price, priceUpdate, promptedFor }
    //   price       = what the owner typed
    //   priceUpdate = null | { sellingPrice, discount }  (set by the price pop-up)
    const items = [];
    const vat = { mode: '', rate: 16 };

    const modal = window.UI.openModal({
      title: 'New purchase',
      maxWidth: '640px',
      bodyHtml: `
        <form id="purchase-form">
          <div class="form-row">
            <div class="field">
              <label>Supplier</label>
              <select class="select" name="supplierId" required>${suppliers.map((s) => `<option value="${s._id}">${esc(s.name)}</option>`).join('')}</select>
            </div>
            <div class="field"><label>Supplier invoice # <span class="text-muted">(optional)</span></label><input class="input" name="invoiceNumber" /></div>
          </div>

          <div class="form-row">
            <div class="field">
              <label>VAT on this purchase</label>
              <select class="select" id="vat-mode">
                <option value="">Choose…</option>
                <option value="INCLUSIVE">Prices include VAT</option>
                <option value="EXCLUSIVE">Prices exclude VAT</option>
                <option value="NONE">No VAT</option>
              </select>
            </div>
            <div class="field" id="vat-rate-field" style="display:none">
              <label>VAT rate (%)</label>
              <input class="input" id="vat-rate" type="number" min="0" max="100" step="0.01" value="16" />
            </div>
          </div>

          <div class="field">
            <label>Items</label>
            <div id="purchase-items"></div>
            <button type="button" class="btn btn-secondary btn-sm" id="add-item-btn">${window.Icons.get('plus')} Add item</button>
          </div>
          <div id="purchase-summary" class="text-sm" style="margin-bottom: var(--space-3)"></div>

          <div class="field"><label>Supplier invoice <span class="text-muted">(optional)</span></label><div id="invoice-picker"></div></div>
          <div class="field"><label>Notes <span class="text-muted">(optional)</span></label><textarea class="textarea" name="notes"></textarea></div>
        </form>
      `,
      footerHtml: `<button class="btn btn-secondary" data-action="cancel">Cancel</button><button class="btn btn-primary" data-action="save" id="purchase-save-btn">Create purchase</button>`,
    });

    const picker = createInvoicePicker(modal.querySelector('#invoice-picker'));

    /** Real cost per unit (incl. VAT) - the same number the backend stores as the product cost. */
    const realCost = (it) => splitPrice(it.price, vat.mode, vat.rate).inclVat;

    /** Summary / button under an item for the optional price update. */
    function priceBoxHtml(it, i) {
      const pu = it.priceUpdate;
      if (!pu) {
        return `<button type="button" class="btn btn-ghost btn-sm" data-edit-prices="${i}">Update selling price &amp; discount</button>`;
      }
      return `
        <div class="pu-box">
          <div class="pu-box-text">
            <b>Prices will update when saved</b><br>
            Cost ${money(realCost(it))} &middot; Selling ${money(pu.sellingPrice)}${pu.discount > 0 ? ` &middot; Discount ${money(pu.discount)}/unit` : ''}
          </div>
          <button type="button" class="btn btn-secondary btn-sm" data-edit-prices="${i}">Edit</button>
          <button type="button" class="btn btn-ghost btn-sm" data-clear-prices="${i}">Remove</button>
        </div>`;
    }

    /**
     * Pop-up shown after the owner enters a product's cost.
     * Own lightweight overlay (does not use UI.openModal / closeModal), so the
     * "New purchase" window underneath is never closed or reset.
     */
    function openPriceDialog(it, onDone) {
      const src = it.variant ? it.variant : it.product;
      const cost = realCost(it);
      const startSell = it.priceUpdate ? it.priceUpdate.sellingPrice : (Number(src.sellingPrice) || 0);
      const startDisc = it.priceUpdate ? it.priceUpdate.discount : (Number(it.product.defaultDiscount) || 0);

      const wrap = document.createElement('div');
      wrap.className = 'modal-backdrop';
      wrap.style.zIndex = 1250;
      wrap.innerHTML = `
        <div class="modal" style="max-width:440px" role="dialog" aria-modal="true">
          <div class="modal-header"><strong>Update prices?</strong></div>
          <div class="modal-body">
            <p class="text-sm text-secondary" style="margin-bottom:var(--space-3)">
              <b>${esc(it.product.name)}</b><br>
              New cost price: <b>${money(cost)}</b> <span class="text-muted">(was ${money(Number(src.costPrice) || 0)})</span>
            </p>
            <div class="form-row">
              <div class="field"><label>Selling price (KES)</label><input class="input" id="pd-sell" type="number" min="0" step="0.01" value="${startSell}" /></div>
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

      const sellEl = wrap.querySelector('#pd-sell');
      const discEl = wrap.querySelector('#pd-disc');
      const hint = wrap.querySelector('#pd-hint');

      function check() {
        const sell = Number(sellEl.value) || 0;
        const disc = Number(discEl.value) || 0;
        let msg = '';
        let bad = false;
        if (disc > sell) { msg = 'Discount cannot be more than the selling price.'; bad = true; }
        else if (sell < cost) { msg = `Selling price is below cost - loss of ${money(cost - sell)} per unit.`; }
        else if (cost > 0 && sell > 0) { msg = `Margin: ${money(sell - cost)} per unit (${(((sell - cost) / sell) * 100).toFixed(1)}%)`; }
        hint.style.color = bad ? 'var(--color-danger)' : sell < cost ? 'var(--color-warning)' : 'var(--color-text-secondary)';
        hint.textContent = msg;
        return !bad;
      }
      sellEl.addEventListener('input', check);
      discEl.addEventListener('input', check);
      check();

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
        onDone({ sellingPrice: Number(sellEl.value) || 0, discount: Number(discEl.value) || 0 });
        close();
      });
      sellEl.focus(); sellEl.select();
    }

    function priceLabel() {
      if (vat.mode === 'INCLUSIVE') return 'Unit cost incl. VAT (KES)';
      if (vat.mode === 'EXCLUSIVE') return 'Unit cost excl. VAT (KES)';
      return 'Unit cost (KES)';
    }

    function calcHtml(it) {
      const { exVat, inclVat } = splitPrice(it.price, vat.mode, vat.rate);
      if (vat.mode === 'NONE') return `Line total: <b>${money(inclVat * it.quantity)}</b>`;
      return `Excl. VAT: ${money(exVat)} &middot; <b>Real cost per unit (incl. VAT): ${money(inclVat)}</b> &middot; Line total: <b>${money(inclVat * it.quantity)}</b>`;
    }

    function refreshCalc() {
      modal.querySelectorAll('[data-calc]').forEach((el) => { el.innerHTML = calcHtml(items[Number(el.dataset.calc)]); });
      modal.querySelectorAll('[data-pricebox]').forEach((el) => { const i = Number(el.dataset.pricebox); el.innerHTML = priceBoxHtml(items[i], i); });
      let ex = 0; let incl = 0;
      items.forEach((it) => {
        const p = splitPrice(it.price, vat.mode, vat.rate);
        ex += p.exVat * it.quantity; incl += p.inclVat * it.quantity;
      });
      modal.querySelector('#purchase-summary').innerHTML = items.length && vat.mode
        ? (vat.mode === 'NONE'
          ? `<b>Total: ${money(incl)}</b>`
          : `Subtotal excl. VAT: ${money(ex)} &middot; VAT: ${money(incl - ex)} &middot; <b>Total (real cost): ${money(incl)}</b>`)
        : '';
    }

    function renderItems() {
      const el = modal.querySelector('#purchase-items');
      if (!items.length) { el.innerHTML = '<p class="text-sm text-muted">No items added yet.</p>'; refreshCalc(); return; }
      el.innerHTML = items.map((it, i) => `
        <div style="border:1px solid var(--color-border); border-radius:var(--radius-md); padding: var(--space-3); margin-bottom: var(--space-2)">
          <div class="flex items-center justify-between" style="margin-bottom: var(--space-2)">
            <span class="text-sm font-semibold">${esc(it.product.name)}</span>
            <button type="button" class="btn btn-ghost btn-sm btn-icon" data-remove="${i}">${window.Icons.get('trash')}</button>
          </div>
          <div class="form-row">
            <div class="field" style="margin-bottom:0"><label class="text-xs">Quantity</label><input class="input" type="number" min="0.01" step="0.01" value="${it.quantity}" data-field="quantity" data-idx="${i}" /></div>
            <div class="field" style="margin-bottom:0"><label class="text-xs">${priceLabel()}</label><input class="input" type="number" min="0" step="0.01" value="${it.price}" data-field="price" data-idx="${i}" /></div>
          </div>
          <div class="text-xs text-secondary" style="margin-top: var(--space-2)" data-calc="${i}"></div>
          <div data-pricebox="${i}" style="margin-top: var(--space-2)"></div>
        </div>
      `).join('');
      el.querySelectorAll('input[data-field]').forEach((input) => {
        input.addEventListener('input', () => { items[Number(input.dataset.idx)][input.dataset.field] = Number(input.value) || 0; refreshCalc(); });
        // Fires when the owner finishes typing the cost (blur / Enter) -> offer the price pop-up.
        if (input.dataset.field === 'price') {
          input.addEventListener('change', () => {
            const it = items[Number(input.dataset.idx)];
            if (!(it.price > 0) || it.promptedFor === it.price) return;
            it.promptedFor = it.price;
            openPriceDialog(it, (pu) => { it.priceUpdate = pu; refreshCalc(); });
          });
        }
      });
      el.querySelectorAll('[data-remove]').forEach((btn) => {
        btn.addEventListener('click', () => { items.splice(Number(btn.dataset.remove), 1); renderItems(); });
      });
      // Edit / Remove buttons of the price box (delegated: the box is re-rendered often)
      el.onclick = (e) => {
        const edit = e.target.closest('[data-edit-prices]');
        const clr = e.target.closest('[data-clear-prices]');
        if (edit) { const it = items[Number(edit.dataset.editPrices)]; openPriceDialog(it, (pu) => { it.priceUpdate = pu; refreshCalc(); }); }
        if (clr) { items[Number(clr.dataset.clearPrices)].priceUpdate = null; refreshCalc(); }
      };
      refreshCalc();
    }
    renderItems();

    modal.querySelector('#vat-mode').addEventListener('change', (e) => {
      vat.mode = e.target.value;
      modal.querySelector('#vat-rate-field').style.display = vat.mode === 'INCLUSIVE' || vat.mode === 'EXCLUSIVE' ? '' : 'none';
      renderItems(); // labels change with the mode
    });
    modal.querySelector('#vat-rate').addEventListener('input', (e) => { vat.rate = Number(e.target.value) || 0; refreshCalc(); });

    modal.querySelector('#add-item-btn').addEventListener('click', () => {
      if (!vat.mode) return window.UI.toast.error('Choose the VAT option before adding products');
      window.ProductPicker.open({
        onSelect: ({ product, variant }) => {
          items.push({ product, variant, quantity: 1, price: variant ? variant.costPrice : product.costPrice, priceUpdate: null, promptedFor: null });
          renderItems();
        },
      });
    });

    modal.querySelector('[data-action="cancel"]').addEventListener('click', () => { picker.destroy(); window.UI.closeModal(); });
    modal.querySelector('[data-action="save"]').addEventListener('click', async () => {
      if (!vat.mode) return window.UI.toast.error('Choose the VAT option first');
      if (!items.length) return window.UI.toast.error('Add at least one item');
      const form = modal.querySelector('#purchase-form');
      if (!form.reportValidity()) return;
      const raw = window.UI.serializeForm(form);
      const rate = vat.mode === 'NONE' ? 0 : vat.rate;

      // multipart: files + plain fields; items travel as a JSON string
      const fd = new FormData();
      fd.append('branchId', branchId);
      fd.append('supplierId', raw.supplierId);
      if (raw.invoiceNumber) fd.append('invoiceNumber', raw.invoiceNumber);
      if (raw.notes) fd.append('notes', raw.notes);
      fd.append('vatMode', vat.mode);
      fd.append('vatRate', rate);
      fd.append('items', JSON.stringify(items.map((it) => {
        const line = {
          productId: it.product._id,
          variantId: it.variant?._id,
          quantity: it.quantity,
          unitCost: splitPrice(it.price, vat.mode, rate).exVat, // backend adds the VAT back via taxRate
          taxRate: rate,
        };
        if (it.priceUpdate) {               // owner chose "Update prices"
          line.updatePrices = true;         // backend sets cost = real unit cost
          line.sellingPrice = it.priceUpdate.sellingPrice;
          line.defaultDiscount = it.priceUpdate.discount;
        }
        return line;
      })));
      picker.getFiles().forEach((f) => fd.append('invoices', f, f.name));

      const updatedCount = items.filter((it) => it.priceUpdate).length;
      const btn = document.getElementById('purchase-save-btn');
      window.UI.setButtonLoading(btn, true, 'Creating…');
      try {
        await window.Api.upload('/purchases', fd);
        window.UI.toast.success(updatedCount ? `Purchase created - ${updatedCount} product price${updatedCount > 1 ? 's' : ''} updated` : 'Purchase created');
        picker.destroy();
        window.UI.closeModal();
        fetchAndRender();
      } catch (err) {
        window.UI.toast.error(err.message);
      } finally {
        window.UI.setButtonLoading(btn, false);
      }
    });
  }
})();