/**
 * receipt-view.js
 * Renders a Receipt document (from GET /sales/:id/receipt, already decimal
 * KES thanks to the backend's transform) as an on-screen + printable
 * receipt. One shared renderer so the immediate post-checkout view and a
 * later reprint from Sales History look identical.
 *
 * Every visual toggle here (header/footer messages, custom lines, paper
 * width, which fields show) comes from receipt.receiptData.business, which
 * is a SNAPSHOT of Business.receiptSettings as they were at sale time - this
 * file never fetches live business settings, so a reprint always matches
 * exactly what was originally printed even if the owner changes settings later.
 *
 * ITEMS TABLE: three columns, like a supermarket till slip.
 *
 *   Item                    QTY      Amount
 *   Sugar 2kg                  2   KES 500.00
 *   @ KES 250.00
 *
 *   - Item   : product name, and under it the price of ONE unit
 *              (plus a discount line when the item was discounted)
 *   - QTY    : units of that product
 *   - Amount : the total for that product (unit price x qty - discount)
 *
 *   Under the table a small line gives the number of different products and
 *   the total units sold ("Items: 3   Units: 7").
 *
 *   Each line is normalised by lineNumbers() so the table still reads
 *   correctly if a receipt was saved with slightly different field names
 *   (price / sellingPrice / nameSnapshot) or without a stored unit price:
 *   the unit price is then worked out as (amount + discount) / quantity.
 *
 * STYLES: every rule for the receipt lives in RECEIPT_CSS below and is emitted
 * with the receipt itself. The print job runs in its own blank document that
 * has none of the app's stylesheets (and no CSS variables), so the receipt must
 * carry everything it needs - that also guarantees the on-screen receipt and
 * the printed one match. No app CSS file needs to change for the receipt.
 *
 * PRINTING: printReceipt() prints through a hidden iframe (no pop-up window, so
 * pop-up blockers can't stop it and it can run automatically after a sale).
 * showReceiptModal(receipt, { autoPrint: true }) opens the receipt and prints it
 * straight away; the Print button prints it again (reprint). Thermal printers
 * print grey text faintly, so the print document forces all receipt text to
 * solid black.
 */
(function (window) {
  function money(n) {
    return window.UI.formatMoney(n);
  }

  function esc(s) {
    return window.UI.escapeHtml(s == null ? '' : String(s));
  }

  /** 2 -> "2", 1.5 -> "1.5", 0.30000000000000004 -> "0.3" */
  function qty(n) {
    const v = Number(n);
    if (!Number.isFinite(v)) return esc(n);
    return String(Number.isInteger(v) ? v : Number(v.toFixed(3)));
  }

  /* ------------------------------------------------------------------ *
   * Receipt styles (self-contained - see header note)
   * ------------------------------------------------------------------ */
  const RECEIPT_CSS = `
    #receipt-print-area { font-family: 'Courier New', Courier, monospace; font-size: 13px; line-height: 1.35; color: #111; margin: 0 auto; box-sizing: border-box; }
    #receipt-print-area.rcpt-58 { font-size: 12px; }
    #receipt-print-area * { box-sizing: border-box; }
    #receipt-print-area .rcpt-header-msg { text-align: center; margin-bottom: 6px; font-weight: 600; }
    #receipt-print-area .rcpt-biz { text-align: center; margin-bottom: 10px; }
    #receipt-print-area .rcpt-biz img { max-height: 48px; margin-bottom: 6px; }
    #receipt-print-area .rcpt-biz-name { font-weight: 700; font-size: 15px; }
    #receipt-print-area .rcpt-meta { border-top: 1px dashed #999; border-bottom: 1px dashed #999; padding: 6px 0; margin-bottom: 6px; }

    #receipt-print-area .rcpt-items { width: 100%; border-collapse: collapse; margin-bottom: 4px; }
    #receipt-print-area .rcpt-items th { padding: 2px 0 4px; font-weight: 700; border-bottom: 1px solid #999; text-align: left; }
    #receipt-print-area .rcpt-items td { padding: 5px 0 4px; vertical-align: top; }
    #receipt-print-area .rcpt-items tbody tr + tr td { border-top: 1px dotted #ccc; }
    #receipt-print-area .rcpt-c-item { width: 100%; padding-right: 8px; text-align: left; word-break: break-word; overflow-wrap: anywhere; }
    #receipt-print-area .rcpt-c-qty { text-align: center; white-space: nowrap; padding-right: 8px; }
    #receipt-print-area th.rcpt-c-qty { text-align: center; }
    #receipt-print-area .rcpt-c-amt { text-align: right; white-space: nowrap; }
    #receipt-print-area th.rcpt-c-amt { text-align: right; }
    #receipt-print-area .rcpt-name { font-weight: 600; }
    #receipt-print-area .rcpt-unit { color: #555; }
    #receipt-print-area .rcpt-disc { color: #555; }
    #receipt-print-area .rcpt-count { display: flex; justify-content: space-between; gap: 8px; margin-bottom: 6px; padding-top: 4px; border-top: 1px dotted #ccc; color: #555; font-size: 12px; }

    #receipt-print-area .rcpt-row { display: flex; justify-content: space-between; gap: 8px; }
    #receipt-print-area .rcpt-totals { border-top: 1px dashed #999; padding-top: 6px; }
    #receipt-print-area .rcpt-grand { font-weight: 700; font-size: 14px; margin-top: 4px; }
    #receipt-print-area .rcpt-pay { border-top: 1px dashed #999; margin-top: 6px; padding-top: 6px; }
    #receipt-print-area .rcpt-muted { color: #666; }
    #receipt-print-area .rcpt-owed { color: #b91c1c; font-weight: 600; }
    #receipt-print-area .rcpt-custom { text-align: center; margin-top: 4px; color: #666; font-size: 12px; }
    #receipt-print-area .rcpt-footer-msg { text-align: center; margin-top: 10px; color: #666; }
  `;

  /* ------------------------------------------------------------------ *
   * Item lines
   * ------------------------------------------------------------------ */

  /**
   * Normalises one receipt line into { name, quantity, discount, unit, total }.
   *   total : what the customer pays for this product (after its discount)
   *   unit  : price of ONE unit before the discount
   */
  function lineNumbers(item) {
    const quantity = Number(item.quantity) || 0;
    const discount = Number(item.discount) || 0;
    const storedUnit = item.unitPrice ?? item.price ?? item.sellingPrice;

    let total;
    if (item.total != null) total = Number(item.total);
    else if (storedUnit != null) total = Number(storedUnit) * quantity - discount;
    else total = 0;

    const unit = storedUnit != null
      ? Number(storedUnit)
      : (quantity ? (total + discount) / quantity : 0);

    return {
      name: item.name || item.nameSnapshot || '',
      quantity: item.quantity,
      units: quantity,
      discount,
      unit,
      total,
    };
  }

  function renderItemsTable(items) {
    const lines = (items || []).map(lineNumbers);
    const units = lines.reduce((sum, l) => sum + l.units, 0);

    return `
      <table class="rcpt-items">
        <thead>
          <tr>
            <th class="rcpt-c-item">Item</th>
            <th class="rcpt-c-qty">QTY</th>
            <th class="rcpt-c-amt">Amount</th>
          </tr>
        </thead>
        <tbody>
          ${lines.map((l) => `
            <tr>
              <td class="rcpt-c-item">
                <div class="rcpt-name">${esc(l.name)}</div>
                <div class="rcpt-unit">@ ${money(l.unit)}</div>
                ${l.discount ? `<div class="rcpt-disc">Discount -${money(l.discount)}</div>` : ''}
              </td>
              <td class="rcpt-c-qty">${qty(l.quantity)}</td>
              <td class="rcpt-c-amt">${money(l.total)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
      ${lines.length ? `<div class="rcpt-count"><span>Items: ${lines.length}</span><span>Units: ${qty(units)}</span></div>` : ''}
    `;
  }

  function renderReceiptHtml(receipt) {
    const d = receipt.receiptData;
    const b = d.business || {};
    const is58 = b.paperWidth === '58mm';
    const width = is58 ? 240 : 320;

    return `
      <style>${RECEIPT_CSS}</style>
      <div id="receipt-print-area" class="${is58 ? 'rcpt-58' : 'rcpt-80'}" style="max-width: ${width}px">
        ${b.headerMessage ? `<div class="rcpt-header-msg">${esc(b.headerMessage)}</div>` : ''}
        <div class="rcpt-biz">
          ${b.logo ? `<img src="${b.logo}" alt="" />` : ''}
          <div class="rcpt-biz-name">${esc(b.name || '')}</div>
          ${b.address ? `<div>${esc(b.address)}</div>` : ''}
          ${b.phone ? `<div>${esc(b.phone)}</div>` : ''}
          ${b.showKraPin !== false && b.kraPin ? `<div>PIN: ${esc(b.kraPin)}</div>` : ''}
        </div>
        <div class="rcpt-meta">
          <div>Receipt: ${esc(receipt.receiptNumber)}</div>
          ${receipt.invoiceNumber ? `<div>Invoice: ${esc(receipt.invoiceNumber)}</div>` : ''}
          <div>Date: ${window.UI.formatDateTime(receipt.createdAt)}</div>
          ${b.showCashierName !== false ? `<div>Cashier: ${esc(d.cashier?.name || '')}</div>` : ''}
          ${d.customer ? `<div>Customer: ${esc(d.customer.name)}</div>` : ''}
          ${d.branch?.name ? `<div>Branch: ${esc(d.branch.name)}</div>` : ''}
        </div>

        ${renderItemsTable(d.items)}

        <div class="rcpt-totals">
          <div class="rcpt-row"><span>Subtotal</span><span>${money(d.subtotal)}</span></div>
          ${d.itemDiscount ? `<div class="rcpt-row"><span>Item discounts</span><span>-${money(d.itemDiscount)}</span></div>` : ''}
          ${d.cartDiscount ? `<div class="rcpt-row"><span>Cart discount</span><span>-${money(d.cartDiscount)}</span></div>` : ''}
          <div class="rcpt-row"><span>Tax</span><span>${money(d.tax)}</span></div>
          <div class="rcpt-row rcpt-grand"><span>TOTAL</span><span>${money(d.total)}</span></div>
        </div>
        <div class="rcpt-pay">
          ${(d.payments || []).map((p) => `
            <div class="rcpt-row">
              <span>${esc(p.method)}${p.method === 'MPESA' && b.showMpesaReceiptCode !== false && p.externalTransactionId ? ` <span class="rcpt-muted">(M-PESA: ${esc(p.externalTransactionId)})</span>` : p.reference ? ` (${esc(p.reference)})` : ''}</span>
              <span>${money(p.amount)}</span>
            </div>
            ${p.method === 'CASH' && Number(p.amountTendered) > Number(p.amount) ? `<div class="rcpt-row rcpt-muted"><span>Cash received</span><span>${money(p.amountTendered)}</span></div>` : ''}
          `).join('')}
          ${d.changeGiven ? `<div class="rcpt-row"><span>Change</span><span>${money(d.changeGiven)}</span></div>` : ''}
          ${d.balance > 0 ? `<div class="rcpt-row rcpt-owed"><span>Balance owed</span><span>${money(d.balance)}</span></div>` : ''}
        </div>
        ${(b.customLines || []).map((line) => `<div class="rcpt-custom">${esc(line)}</div>`).join('')}
        ${b.footerMessage ? `<div class="rcpt-footer-msg">${esc(b.footerMessage)}</div>` : ''}
      </div>
    `;
  }

  /* ------------------------------------------------------------------ *
   * Printing (hidden iframe - no pop-up, works for auto-print too)
   * ------------------------------------------------------------------ */
  function renderPrintDocument(receipt) {
    const paper = receipt.receiptData?.business?.paperWidth === '58mm' ? '58mm' : '80mm';
    return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${esc(receipt.receiptNumber)}</title>
  <style>
    @page { size: ${paper} auto; margin: 3mm; }
    html, body { margin: 0; padding: 0; background: #fff; color: #000; }
    #receipt-print-area { max-width: 100% !important; }
    /* Thermal printers wash out grey text - print everything solid black. */
    #receipt-print-area, #receipt-print-area * { color: #000 !important; }
  </style>
</head>
<body>${renderReceiptHtml(receipt)}</body>
</html>`;
  }

  /** Counts the print server-side (non-fatal), then prints the receipt through a hidden iframe. */
  async function printReceipt(receipt) {
    try {
      await window.Api.post(`/sales/${receipt.saleId}/receipt/print`);
    } catch {
      // non-fatal - printing locally still works even if the print-count update fails
    }

    return new Promise((resolve) => {
      const iframe = document.createElement('iframe');
      iframe.setAttribute('aria-hidden', 'true');
      iframe.tabIndex = -1;
      iframe.style.cssText = 'position:fixed;left:-9999px;top:0;width:400px;height:800px;border:0;';

      iframe.onload = () => {
        try {
          iframe.contentWindow.focus();
          iframe.contentWindow.print();
        } catch {
          window.UI.toast.error('Could not open the print dialog. Use your browser\u2019s print option.');
        }
        // Give the print dialog time to read the document before the frame is removed.
        setTimeout(() => iframe.remove(), 60000);
        resolve();
      };

      iframe.srcdoc = renderPrintDocument(receipt);
      document.body.appendChild(iframe);
    });
  }

  /**
   * Opens the receipt in a modal with Print + Close actions.
   * Options: onClose - called when the modal is closed with the Close button
   *          autoPrint - print straight away (used right after a sale)
   */
  function showReceiptModal(receipt, { onClose, autoPrint = false } = {}) {
    const modal = window.UI.openModal({
      title: 'Receipt',
      maxWidth: '400px',
      bodyHtml: renderReceiptHtml(receipt),
      footerHtml: `
        <button class="btn btn-secondary" data-action="close">Close</button>
        <button class="btn btn-primary" data-action="print">${window.Icons.get('box')} Print</button>
      `,
    });

    modal.querySelector('[data-action="close"]').addEventListener('click', () => { window.UI.closeModal(); onClose?.(); });

    const printBtn = modal.querySelector('[data-action="print"]');
    printBtn.addEventListener('click', async () => {
      printBtn.disabled = true;
      try {
        await printReceipt(receipt);
      } finally {
        printBtn.disabled = false;
      }
    });

    if (autoPrint) {
      // Let the modal paint first so the cashier sees the receipt behind the print dialog.
      setTimeout(() => printBtn.click(), 250);
    }
  }

  window.ReceiptView = { renderReceiptHtml, showReceiptModal, printReceipt };
})(window);