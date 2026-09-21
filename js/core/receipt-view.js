/**
 * receipt-view.js
 * Renders a Receipt document (from GET /sales/:id/receipt, already decimal
 * KES thanks to the backend's transform) as an on-screen + printable
 * receipt. One shared renderer so the immediate post-checkout view and a
 * later reprint from Sales History look identical.
 */
(function (window) {
  function money(n) {
    return window.UI.formatMoney(n);
  }

  function renderReceiptHtml(receipt) {
    const d = receipt.receiptData;
    return `
      <div id="receipt-print-area" style="font-family: 'Courier New', monospace; font-size: 13px; max-width: 320px; margin: 0 auto;">
        <div style="text-align:center; margin-bottom: var(--space-3)">
          <div style="font-weight:700; font-size: 15px">${window.UI.escapeHtml(d.business?.name || '')}</div>
          ${d.business?.address ? `<div>${window.UI.escapeHtml(d.business.address)}</div>` : ''}
          ${d.business?.phone ? `<div>${window.UI.escapeHtml(d.business.phone)}</div>` : ''}
          ${d.business?.kraPin ? `<div>PIN: ${window.UI.escapeHtml(d.business.kraPin)}</div>` : ''}
        </div>
        <div style="border-top: 1px dashed #999; border-bottom: 1px dashed #999; padding: var(--space-2) 0; margin-bottom: var(--space-2)">
          <div>Receipt: ${window.UI.escapeHtml(receipt.receiptNumber)}</div>
          ${receipt.invoiceNumber ? `<div>Invoice: ${window.UI.escapeHtml(receipt.invoiceNumber)}</div>` : ''}
          <div>Date: ${window.UI.formatDateTime(receipt.createdAt)}</div>
          <div>Cashier: ${window.UI.escapeHtml(d.cashier?.name || '')}</div>
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
          ${d.payments.map((p) => `<div style="display:flex; justify-content:space-between"><span>${window.UI.escapeHtml(p.method)}${p.reference ? ` (${window.UI.escapeHtml(p.reference)})` : ''}</span><span>${money(p.amount)}</span></div>`).join('')}
          ${d.changeGiven ? `<div style="display:flex; justify-content:space-between"><span>Change</span><span>${money(d.changeGiven)}</span></div>` : ''}
          ${d.balance > 0 ? `<div style="display:flex; justify-content:space-between; color: var(--color-danger); font-weight:600"><span>Balance owed</span><span>${money(d.balance)}</span></div>` : ''}
        </div>
        ${d.business?.footerMessage ? `<div style="text-align:center; margin-top: var(--space-3); color:#666">${window.UI.escapeHtml(d.business.footerMessage)}</div>` : ''}
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
