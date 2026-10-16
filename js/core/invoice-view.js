/**
 * invoice-view.js - professional printable invoice (A4 / A5) for any sale, rendered by the BACKEND
 * (GET /sales/:id/invoice) so reprints never change. Shows it in a modal with simple controls:
 *   Paper size (A4/A5) · Copy label (Original / Customer copy / Office copy / Duplicate) · Print / Save as PDF · Receipt.
 *
 *   InvoiceView.open(saleId, { receipt, copy, paper, autoPrint, title })
 *   InvoiceView.print(saleId, { copy, paper })      // straight to the print dialog, no modal
 */
(function (window) {
  const esc = (s) => window.UI.escapeHtml(String(s ?? ''));
  const PREF = 'pos.invoicePaper';
  const COPIES = ['ORIGINAL', 'CUSTOMER COPY', 'OFFICE COPY', 'DUPLICATE'];
  const cache = new Map(); // `${id}|${copy}|${paper}` -> html (one re-render per option, never refetched while open)

  const pref = () => { try { return localStorage.getItem(PREF) === 'A5' ? 'A5' : 'A4'; } catch { return 'A4'; } };
  const savePref = (v) => { try { localStorage.setItem(PREF, v); } catch { /* private mode */ } };

  async function fetchHtml(saleId, copy, paper) {
    const k = `${saleId}|${copy}|${paper}`;
    if (cache.has(k)) return cache.get(k);
    const html = await window.Api.getText(`/sales/${saleId}/invoice`, { format: 'html', copy, paper });
    if (cache.size > 12) cache.delete(cache.keys().next().value);
    cache.set(k, html);
    return html;
  }

  function printFrame(frame) {
    try { frame.contentWindow.focus(); frame.contentWindow.print(); }
    catch { window.UI.toast.error('Could not open the print dialog. Use your browser menu: Print.'); }
  }

  async function print(saleId, { copy = 'ORIGINAL', paper = pref() } = {}) {
    const html = await fetchHtml(saleId, copy, paper);
    const f = document.createElement('iframe');
    f.setAttribute('aria-hidden', 'true');
    f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
    document.body.appendChild(f);
    f.srcdoc = html.replace(/<div class="actions">[\s\S]*?<\/div>/, '');
    f.onload = () => { printFrame(f); setTimeout(() => f.remove(), 60000); };
  }

  function open(saleId, opts = {}) {
    if (!saleId) return window.UI.toast.error('This sale has no invoice yet (it is still saved on this till).');
    const st = { copy: opts.copy || 'ORIGINAL', paper: opts.paper || pref() };
    const modal = window.UI.openModal({
      title: opts.title || 'Invoice', maxWidth: '980px',
      bodyHtml: `
        <div class="inv-bar">
          <div class="inv-seg" role="group" aria-label="Paper size">
            <button type="button" data-paper="A4">A4</button><button type="button" data-paper="A5">A5 (half page)</button>
          </div>
          <select class="select inv-copy" id="inv-copy" aria-label="Copy label">
            ${COPIES.map((c) => `<option value="${c}">${c === 'ORIGINAL' ? 'Original' : c.charAt(0) + c.slice(1).toLowerCase()}</option>`).join('')}
          </select>
        </div>
        <div class="inv-stage" id="inv-stage"><div class="inv-loading"><span class="spinner"></span> Preparing invoice…</div></div>`,
      footerHtml: `<button class="btn btn-secondary" data-action="close">Close</button>
        ${opts.receipt ? '<button class="btn btn-secondary" id="inv-receipt">Receipt</button>' : ''}
        <button class="btn btn-primary" id="inv-print">${window.Icons?.get('print') || ''} Print / Save as PDF</button>`,
    });
    modal.querySelector('[data-action="close"]').addEventListener('click', window.UI.closeModal);
    const stage = modal.querySelector('#inv-stage');
    const copySel = modal.querySelector('#inv-copy');
    copySel.value = st.copy;
    let frame = null;
    let seq = 0;

    function markPaper() { modal.querySelectorAll('[data-paper]').forEach((b) => b.classList.toggle('on', b.dataset.paper === st.paper)); }
    async function load() {
      const my = ++seq;
      markPaper();
      stage.innerHTML = '<div class="inv-loading"><span class="spinner"></span> Preparing invoice…</div>';
      try {
        const html = await fetchHtml(saleId, st.copy, st.paper);
        if (my !== seq) return;
        stage.innerHTML = '';
        frame = document.createElement('iframe');
        frame.className = `inv-frame ${st.paper === 'A5' ? 'a5' : 'a4'}`;
        frame.title = 'Invoice preview';
        frame.setAttribute('sandbox', 'allow-same-origin allow-modals');
        // our own print button sits in the modal footer, so hide the page's built-in one
        frame.srcdoc = html.replace('</head>', '<style>.actions{display:none!important}body{background:#fff!important}.page{margin:0 auto!important}</style></head>');
        stage.appendChild(frame);
        if (opts.autoPrint) { opts.autoPrint = false; frame.onload = () => printFrame(frame); }
      } catch (e) {
        if (my !== seq) return;
        stage.innerHTML = `<div class="inv-loading">${esc(e.message || 'Could not load the invoice')}<br><button class="btn btn-secondary btn-sm" id="inv-retry" style="margin-top:12px">Try again</button></div>`;
        stage.querySelector('#inv-retry')?.addEventListener('click', load);
      }
    }
    modal.querySelectorAll('[data-paper]').forEach((b) => b.addEventListener('click', () => { st.paper = b.dataset.paper; savePref(st.paper); load(); }));
    copySel.addEventListener('change', () => { st.copy = copySel.value; load(); });
    modal.querySelector('#inv-print').addEventListener('click', () => { if (frame) printFrame(frame); });
    modal.querySelector('#inv-receipt')?.addEventListener('click', () => { window.UI.closeModal(); window.ReceiptView.showReceiptModal(opts.receipt); });
    load();
  }

  window.InvoiceView = { open, print };
})(window);
