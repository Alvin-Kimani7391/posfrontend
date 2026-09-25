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
 */
(function (window) {
  function money(n) {
    return window.UI.formatMoney(n);
  }

  function renderReceiptHtml(receipt) {
    const d = receipt.receiptData;
    const b = d.business || {};
    const width = b.paperWidth === '58mm' ? 240 : 320;

    return `
      <div id="receipt-print-area" style="font-family: 'Courier New', monospace; font-size: 13px; max-width: ${width}px; margin: 0 auto;">
        ${b.headerMessage ? `<div style="text-align:center; margin-bottom: var(--space-2); font-weight:600">${window.UI.escapeHtml(b.headerMessage)}</div>` : ''}
        <div style="text-align:center; margin-bottom: var(--space-3)">
          ${b.logo ? `<img src="${b.logo}" alt="" style="max-height:48px; margin-bottom:6px" />` : ''}
          <div style="font-weight:700; font-size: 15px">${window.UI.escapeHtml(b.name || '')}</div>
          ${b.address ? `<div>${window.UI.escapeHtml(b.address)}</div>` : ''}
          ${b.phone ? `<div>${window.UI.escapeHtml(b.phone)}</div>` : ''}
          ${b.showKraPin !== false && b.kraPin ? `<div>PIN: ${window.UI.escapeHtml(b.kraPin)}</div>` : ''}
        </div>
        <div style="border-top: 1px dashed #999; border-bottom: 1px dashed #999; padding: var(--space-2) 0; margin-bottom: var(--space-2)">
          <div>Receipt: ${window.UI.escapeHtml(receipt.receiptNumber)}</div>
          ${receipt.invoiceNumber ? `<div>Invoice: ${window.UI.escapeHtml(receipt.invoiceNumber)}</div>` : ''}
          <div>Date: ${window.UI.formatDateTime(receipt.createdAt)}</div>
          ${b.showCashierName !== false ? `<div>Cashier: ${window.UI.escapeHtml(d.cashier?.name || '')}</div>` : ''}
          ${d.customer ? `<div>Customer: ${window.UI.escapeHtml(d.customer.name)}</div>` : ''}
          ${d.branch?.name ? `<div>Branch: ${window.UI.escapeHtml(d.branch.name)}</div>` : ''}
        </div>
        <table style="width:100%; border-collapse: collapse; margin-bottom: var(--space-2)">
          <tbody>
            ${d.items.map((i) => `
              <tr>
                <td colspan="2" style="padding-top:4px">${window.UI.escapeHtml(i.name)}</td>
              </tr>
              <tr>
                <td style="color:#666">${i.quantity} x ${money(i.unitPrice)}${i.discount ? ` (- ${money(i.discount)})` : ''}</td>
                <td style="text-align:right">${money(i.total)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
        <div style="border-top: 1px dashed #999; padding-top: var(--space-2)">
          <div style="display:flex; justify-content:space-between"><span>Subtotal</span><span>${money(d.subtotal)}</span></div>
          ${d.itemDiscount ? `<div style="display:flex; justify-content:space-between"><span>Item discounts</span><span>-${money(d.itemDiscount)}</span></div>` : ''}
          ${d.cartDiscount ? `<div style="display:flex; justify-content:space-between"><span>Cart discount</span><span>-${money(d.cartDiscount)}</span></div>` : ''}
          <div style="display:flex; justify-content:space-between"><span>Tax</span><span>${money(d.tax)}</span></div>
          <div style="display:flex; justify-content:space-between; font-weight:700; font-size:14px; margin-top:4px"><span>TOTAL</span><span>${money(d.total)}</span></div>
        </div>
        <div style="border-top: 1px dashed #999; margin-top: var(--space-2); padding-top: var(--space-2)">
          ${d.payments.map((p) => `
            <div style="display:flex; justify-content:space-between">
              <span>${window.UI.escapeHtml(p.method)}${p.method === 'MPESA' && b.showMpesaReceiptCode !== false && p.externalTransactionId ? ` <span style="color:#666">(M-PESA: ${window.UI.escapeHtml(p.externalTransactionId)})</span>` : p.reference ? ` (${window.UI.escapeHtml(p.reference)})` : ''}</span>
              <span>${money(p.amount)}</span>
            </div>
          `).join('')}
          ${d.changeGiven ? `<div style="display:flex; justify-content:space-between"><span>Change</span><span>${money(d.changeGiven)}</span></div>` : ''}
          ${d.balance > 0 ? `<div style="display:flex; justify-content:space-between; color: var(--color-danger); font-weight:600"><span>Balance owed</span><span>${money(d.balance)}</span></div>` : ''}
        </div>
        ${(b.customLines || []).map((line) => `<div style="text-align:center; margin-top:4px; color:#666; font-size:12px">${window.UI.escapeHtml(line)}</div>`).join('')}
        ${b.footerMessage ? `<div style="text-align:center; margin-top: var(--space-3); color:#666">${window.UI.escapeHtml(b.footerMessage)}</div>` : ''}
      </div>
    `;
  }

  /** Opens the receipt in a modal with Print + Close actions. Calling Print marks it printed server-side. */
  function showReceiptModal(receipt, { onClose } = {}) {
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
    modal.querySelector('[data-action="print"]').addEventListener('click', async () => {
      try {
        await window.Api.post(`/sales/${receipt.saleId}/receipt/print`);
      } catch {
        // non-fatal - printing locally still works even if the print-count update fails
      }
      const printWindow = window.open('', '_blank', 'width=380,height=600');
      printWindow.document.write(`<html><head><title>${receipt.receiptNumber}</title></head><body>${renderReceiptHtml(receipt)}</body></html>`);
      printWindow.document.close();
      printWindow.focus();
      printWindow.print();
    });
  }

  window.ReceiptView = { renderReceiptHtml, showReceiptModal };
})(window);