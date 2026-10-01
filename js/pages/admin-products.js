/** admin-products.js - every product (read-only oversight). GET /admin/products */
(function () {
  const esc = window.UI.escapeHtml, fm = (n) => window.UI.formatMoney(n);
  document.addEventListener('DOMContentLoaded', () => {
    const el = window.AdminShell.mount({ title: 'Products' });
    if (!el) return;
    el.innerHTML = `<div class="page-header"><div><h1>Products</h1><p>Every catalog item across all businesses.</p></div></div><div id="list"></div>`;
    window.AdminList.create(document.getElementById('list'), {
      endpoint: '/admin/products',
      search: 'Name, SKU or barcode',
      filters: [
        { key: 'businessId', type: 'business' },
        { key: 'status', type: 'select', label: 'Status', options: [['', 'All'], ['active', 'Active'], ['archived', 'Archived']] },
      ],
      empty: { title: 'No products found' },
      columns: [
        { label: 'Product', render: (p) => `<div class="cell-primary">${esc(p.name)}</div>${p.hasVariants ? `<div class="text-xs text-muted">${(p.variants || []).length} variants</div>` : ''}` },
        { label: 'Business', render: (p) => esc(p.businessName || '-') },
        { label: 'SKU / Barcode', render: (p) => `<div class="text-sm">${esc(p.sku)}</div>${p.barcode ? `<div class="text-xs text-muted">${esc(p.barcode)}</div>` : ''}` },
        { label: 'Category', render: (p) => (p.categoryName ? esc(p.categoryName) : '<span class="text-muted">Uncategorized</span>') },
        { label: 'Cost', num: true, render: (p) => fm(p.costPrice || 0) },
        { label: 'Price', num: true, render: (p) => (p.hasVariants ? 'Varies' : `<span class="font-semibold">${fm(p.sellingPrice)}</span>`) },
        { label: 'Status', render: (p) => window.AdminShell.statusBadge(p.status) },
      ],
    });
  });
})();