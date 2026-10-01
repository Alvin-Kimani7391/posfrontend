/** admin-employees.js - every staff account. GET /admin/employees ; PATCH /admin/employees/:id/status */
(function () {
  const esc = window.UI.escapeHtml;
  let list;
  document.addEventListener('DOMContentLoaded', () => {
    const el = window.AdminShell.mount({ title: 'Employees' });
    if (!el) return;
    el.innerHTML = `<div class="page-header"><div><h1>Employees</h1><p>Staff accounts across all businesses. Click a row to change access.</p></div></div><div id="list"></div>`;
    list = window.AdminList.create(document.getElementById('list'), {
      endpoint: '/admin/employees',
      search: 'Name, phone, email or code',
      filters: [
        { key: 'businessId', type: 'business' },
        { key: 'role', type: 'select', label: 'Role', options: [['', 'All'], ['OWNER', 'Owner'], ['ADMIN', 'Admin'], ['MANAGER', 'Manager'], ['CASHIER', 'Cashier'], ['STOREKEEPER', 'Storekeeper'], ['ACCOUNTANT', 'Accountant']] },
        { key: 'status', type: 'select', label: 'Status', options: [['', 'All'], ['active', 'Active'], ['inactive', 'Inactive'], ['suspended', 'Suspended']] },
      ],
      empty: { title: 'No employees found' },
      columns: [
        { label: 'Employee', render: (u) => `<div style="display:flex;align-items:center;gap:var(--space-3)"><div class="avatar" style="width:32px;height:32px;font-size:var(--text-xs)">${esc(window.UI.initials(u.name))}</div><div><div class="cell-primary">${esc(u.name)}</div>${u.employeeCode ? `<div class="text-xs text-muted">Code: ${esc(u.employeeCode)}</div>` : ''}</div></div>` },
        { label: 'Business', render: (u) => esc(u.businessName || '-') },
        { label: 'Role', render: (u) => `<span class="badge role-badge role-${esc(u.role)}">${esc(u.role)}</span>` },
        { label: 'Contact', render: (u) => `<div class="text-sm">${esc(u.phone)}</div>${u.email ? `<div class="text-xs text-muted">${esc(u.email)}</div>` : ''}` },
        { label: 'Last login', render: (u) => `<span class="text-sm">${u.lastLoginAt ? window.UI.timeAgo(u.lastLoginAt) : '<span class="text-muted">Never</span>'}</span>` },
        { label: 'Status', render: (u) => window.AdminShell.statusBadge(u.status) },
      ],
      onRow: (u) => {
        if (u.role === 'OWNER') return window.UI.toast.error('Suspend the whole business from the Businesses page instead.');
        const next = u.status === 'active' ? 'suspended' : 'active';
        window.UI.confirmDialog({
          title: `${next === 'active' ? 'Reactivate' : 'Suspend'} ${u.name}?`,
          message: `${u.businessName || 'Their business'} · ${u.role}. ${next === 'active' ? 'They regain access.' : 'They lose access immediately.'}`,
          confirmText: next === 'active' ? 'Reactivate' : 'Suspend', danger: next !== 'active',
        }).then(async (ok) => {
          if (!ok) return;
          try {
            await window.Api.patch(`/admin/employees/${u._id}/status`, { status: next });
            window.UI.toast.success('Employee updated');
            list.reload();
          } catch (err) { window.UI.toast.error(err.message); }
        });
      },
    });
  });
})();