/**
 * admin-businesses.js - every business, with headline stats.
 * GET /admin/businesses            (list)
 * GET /admin/businesses/:id        (detail + stats + owner)
 * PATCH /admin/businesses/:id/status { status: 'active' | 'suspended' }
 */
(function () {
  const esc = window.UI.escapeHtml, fm = (n) => window.UI.formatMoney(n);
  const S = () => window.AdminShell;
  let list;

  document.addEventListener('DOMContentLoaded', () => {
    const el = S().mount({ title: 'Businesses' });
    if (!el) return;
    el.innerHTML = `<div class="page-header"><div><h1>Businesses</h1><p>Every shop on the platform. Click a row for details, sales and controls.</p></div></div><div id="list"></div>`;
    list = window.AdminList.create(document.getElementById('list'), {
      endpoint: '/admin/businesses',
      search: 'Search name, phone, KRA PIN',
      filters: [{ key: 'status', type: 'select', label: 'Status', options: [['', 'All'], ['active', 'Active'], ['suspended', 'Suspended'], ['closed', 'Closed']] }],
      empty: { title: 'No businesses found' },
      columns: [
        { label: 'Business', render: (b) => `<div class="cell-primary">${esc(b.name)}</div><div class="text-xs text-muted">${esc(b.phone || '')}</div>` },
        { label: 'Owner', render: (b) => `<span class="text-sm">${esc(b.ownerName || '-')}</span>` },
        { label: 'Branches', num: true, render: (b) => b.branchCount ?? 0 },
        { label: 'Staff', num: true, render: (b) => b.employeeCount ?? 0 },
        { label: 'Products', num: true, render: (b) => b.productCount ?? 0 },
        { label: 'Net sales', num: true, render: (b) => `<span class="font-semibold">${fm(b.netSales || 0)}</span>` },
        { label: 'Plan', render: (b) => `<span class="admin-tag">${esc(b.subscriptionPlan || 'trial')}</span>` },
        { label: 'Status', render: (b) => S().statusBadge(b.status) },
      ],
      onRow: (b) => openDetail(b._id),
    });
    const open = new URLSearchParams(location.search).get('open');
    if (open) openDetail(open);
  });

  async function openDetail(id) {
    let d;
    try { ({ data: d } = await window.Api.get(`/admin/businesses/${id}`)); }
    catch (err) { return window.UI.toast.error(err.message); }

    const b = d.business, st = d.stats || {}, o = d.owner;
    const suspended = b.status === 'suspended';
    const modal = window.UI.openModal({
      title: b.name, maxWidth: '680px',
      bodyHtml: `
        <div style="display:flex;gap:var(--space-2);flex-wrap:wrap;margin-bottom:var(--space-3)">
          ${S().statusBadge(b.status)} ${S().statusBadge(b.subscriptionStatus)} <span class="admin-tag">${esc(b.subscriptionPlan || 'trial')}</span>
        </div>
        <div class="admin-detail-grid">
          <div class="admin-stat"><b>${fm(st.netSales || 0)}</b><span>Net sales (all time)</span></div>
          <div class="admin-stat"><b>${st.transactions || 0}</b><span>Transactions</span></div>
          <div class="admin-stat"><b>${fm(st.salesToday || 0)}</b><span>Sales today</span></div>
          <div class="admin-stat"><b>${st.employees || 0}</b><span>Employees</span></div>
          <div class="admin-stat"><b>${st.branches || 0}</b><span>Branches</span></div>
          <div class="admin-stat"><b>${st.products || 0}</b><span>Products</span></div>
        </div>
        <dl class="admin-kv">
          <dt>Owner</dt><dd>${o ? `${esc(o.name)} · ${esc(o.phone)}${o.email ? ' · ' + esc(o.email) : ''}` : '-'}</dd>
          <dt>Owner last login</dt><dd>${o?.lastLoginAt ? window.UI.formatDateTime(o.lastLoginAt) : 'Never'}</dd>
          <dt>Business phone</dt><dd>${esc(b.phone || '-')}</dd>
          <dt>Email</dt><dd>${esc(b.email || '-')}</dd>
          <dt>Location</dt><dd>${esc([b.address, b.town, b.county].filter(Boolean).join(', ') || '-')}</dd>
          <dt>KRA PIN</dt><dd>${esc(b.kraPin || '-')}</dd>
          <dt>Last sale</dt><dd>${st.lastSaleAt ? window.UI.formatDateTime(st.lastSaleAt) : 'No sales yet'}</dd>
          <dt>Registered</dt><dd>${window.UI.formatDateTime(b.createdAt)}</dd>
          <dt>Business ID</dt><dd style="font-family:monospace">${esc(b._id)}</dd>
        </dl>`,
      footerHtml: `
        <button class="btn btn-secondary" data-action="close">Close</button>
        <a class="btn btn-secondary" href="admin-sales.html?businessId=${esc(b._id)}">Sales</a>
        <a class="btn btn-secondary" href="admin-employees.html?businessId=${esc(b._id)}">Staff</a>
        <a class="btn btn-secondary" href="admin-products.html?businessId=${esc(b._id)}">Products</a>
        <a class="btn btn-secondary" href="admin-audit.html?businessId=${esc(b._id)}">Audit</a>
        <button class="btn ${suspended ? 'btn-success' : 'btn-danger'}" data-action="toggle">${suspended ? 'Reactivate' : 'Suspend'}</button>`,
    });
    modal.querySelector('[data-action="close"]').addEventListener('click', window.UI.closeModal);
    modal.querySelector('[data-action="toggle"]').addEventListener('click', async () => {
      const next = suspended ? 'active' : 'suspended';
      const ok = await window.UI.confirmDialog({
        title: `${suspended ? 'Reactivate' : 'Suspend'} ${b.name}?`,
        message: suspended ? 'Their staff will be able to log in again.' : 'Nobody in this business will be able to log in or sell until you reactivate it.',
        confirmText: suspended ? 'Reactivate' : 'Suspend', danger: !suspended,
      });
      if (!ok) return;
      try {
        await window.Api.patch(`/admin/businesses/${b._id}/status`, { status: next });
        window.UI.toast.success(`Business ${suspended ? 'reactivated' : 'suspended'}`);
        window.UI.closeModal();
        list.reload();
      } catch (err) { window.UI.toast.error(err.message); }
    });
  }
})();