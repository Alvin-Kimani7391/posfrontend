/** admin-sales.js - every sale on the platform. GET /admin/sales (+ GET /admin/sales/:id for detail) */
(function () {
  const esc = window.UI.escapeHtml, fm = (n) => window.UI.formatMoney(n);
  const PAY = { PAID: 'badge-success', PARTIAL: 'badge-warning', CREDIT: 'badge-danger', UNPAID: 'badge-neutral' };

  document.addEventListener('DOMContentLoaded', () => {
    const el = window.AdminShell.mount({ title: 'Sales' });
    if (!el) return;
    el.innerHTML = `<div class="page-header"><div><h1>Sales</h1><p>Every sale rung up through the POS, across all businesses.</p></div></div><div id="list"></div>`;
    window.AdminList.create(document.getElementById('list'), {
      endpoint: '/admin/sales',
      search: 'Receipt number',
      filters: [
        { key: 'businessId', type: 'business' },
        { key: 'paymentStatus', type: 'select', label: 'Payment', options: [['', 'All'], ['PAID', 'Paid'], ['PARTIAL', 'Partial'], ['CREDIT', 'Credit']] },
        { key: 'saleStatus', type: 'select', label: 'Sale', options: [['', 'All'], ['COMPLETED', 'Completed'], ['CANCELLED', 'Cancelled']] },
        { key: 'from', type: 'date', label: 'From' },
        { key: 'to', type: 'date', label: 'To' },
      ],
      empty: { title: 'No sales found' },
      columns: [
        { label: 'Receipt', render: (s) => `<span class="cell-primary">${esc(s.receiptNumber)}</span>` },
        { label: 'Business', render: (s) => esc(s.businessName || '-') },
        { label: 'Branch', render: (s) => esc(s.branchName || '-') },
        { label: 'Date & time', render: (s) => `<span class="text-sm">${window.UI.formatDateTime(s.createdAt)}</span>` },
        { label: 'Cashier', render: (s) => esc(s.cashierName || '-') },
        { label: 'Customer', render: (s) => (s.customerName ? esc(s.customerName) : '<span class="text-muted">Walk-in</span>') },
        { label: 'Total', num: true, render: (s) => `<span class="font-semibold">${fm(s.total)}</span>` },
        { label: 'Status', render: (s) => `<span class="badge ${PAY[s.paymentStatus] || 'badge-neutral'}">${esc(s.paymentStatus)}</span>${s.saleStatus === 'CANCELLED' ? ' <span class="badge badge-neutral">Cancelled</span>' : ''}` },
      ],
      onRow: openSale,
    });
  });

  async function openSale(row) {
    let sale;
    try { ({ data: { sale } } = await window.Api.get(`/admin/sales/${row._id}`)); }
    catch (err) { return window.UI.toast.error(err.message); }
    const modal = window.UI.openModal({
      title: `Sale ${sale.receiptNumber}`, maxWidth: '560px',
      bodyHtml: `
        <p class="text-sm text-secondary" style="margin-bottom:var(--space-3)">${esc(sale.businessName || '')} · ${esc(sale.branchName || '')} · ${window.UI.formatDateTime(sale.createdAt)}<br/>Cashier: ${esc(sale.cashierName || '-')}${sale.customerName ? ' · Customer: ' + esc(sale.customerName) : ''}</p>
        <div class="table-wrap" style="margin-bottom:var(--space-4)"><table class="table"><thead><tr><th>Item</th><th class="num">Qty</th><th class="num">Total</th></tr></thead><tbody>
          ${(sale.items || []).map((i) => `<tr><td class="text-sm">${esc(i.nameSnapshot)}</td><td class="num">${i.quantity}</td><td class="num">${fm(i.total)}</td></tr>`).join('')}
        </tbody></table></div>
        <div class="pos-totals-row"><span>Subtotal</span><span>${fm(sale.subtotal)}</span></div>
        <div class="pos-totals-row"><span>Discount</span><span>${fm(sale.totalDiscount || 0)}</span></div>
        <div class="pos-totals-row"><span>Tax</span><span>${fm(sale.tax)}</span></div>
        <div class="pos-totals-row grand"><span>Total</span><span>${fm(sale.total)}</span></div>
        ${(sale.payments || []).map((p) => `<div class="pos-totals-row"><span>${esc(p.method)}${p.reference ? ' · ' + esc(p.reference) : ''}</span><span>${fm(p.amount)}</span></div>`).join('')}
        ${sale.balance > 0 ? `<div class="pos-totals-row" style="color:var(--color-warning)"><span>Balance owed</span><span>${fm(sale.balance)}</span></div>` : ''}
        ${sale.saleStatus === 'CANCELLED' ? `<div class="form-alert form-alert-error" style="margin-top:var(--space-3)">Cancelled: ${esc(sale.cancelReason || '')}</div>` : ''}`,
      footerHtml: '<button class="btn btn-primary" data-action="close">Close</button>',
    });
    modal.querySelector('[data-action="close"]').addEventListener('click', window.UI.closeModal);
  }
})();