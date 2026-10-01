/** admin-audit.js - platform-wide audit trail. GET /admin/audit-logs */
(function () {
  const esc = window.UI.escapeHtml;
  function badge(action) {
    const verb = String(action || '').split('.').pop().toLowerCase();
    let cls = 'badge-neutral';
    if (/(create|add|open|login|receive|complete|approve|register)/.test(verb)) cls = 'badge-success';
    else if (/(update|edit|adjust|transfer|close|change|reset)/.test(verb)) cls = 'badge-info';
    else if (/(delete|cancel|void|remove|reject|suspend|fail)/.test(verb)) cls = 'badge-danger';
    return `<span class="badge ${cls}">${esc(action || 'unknown')}</span>`;
  }
  document.addEventListener('DOMContentLoaded', () => {
    const el = window.AdminShell.mount({ title: 'Audit log' });
    if (!el) return;
    el.innerHTML = `<div class="page-header"><div><h1>Audit log</h1><p>Who did what, in which business. Entries cannot be edited or deleted.</p></div></div><div id="list"></div>`;
    window.AdminList.create(document.getElementById('list'), {
      endpoint: '/admin/audit-logs',
      search: 'Action starts with e.g. sale.cancel',
      filters: [{ key: 'businessId', type: 'business' }, { key: 'from', type: 'date', label: 'From' }, { key: 'to', type: 'date', label: 'To' }],
      empty: { title: 'No activity matches these filters' },
      columns: [
        { label: 'When', render: (l) => `<span class="text-sm">${window.UI.formatDateTime(l.timestamp || l.createdAt)}</span><div class="text-xs text-muted">${window.UI.timeAgo(l.timestamp || l.createdAt)}</div>` },
        { label: 'Business', render: (l) => esc(l.businessName || '-') },
        { label: 'Who', render: (l) => (l.userName ? `${esc(l.userName)}<div class="text-xs text-muted">${esc(l.userRole || '')}</div>` : 'System') },
        { label: 'Action', render: (l) => badge(l.action) },
        { label: 'What', render: (l) => `${l.entityType ? esc(l.entityType) : '<span class="text-muted">-</span>'}${l.entityId ? ` <span class="text-xs text-muted" style="font-family:monospace">#${esc(String(l.entityId).slice(-6))}</span>` : ''}` },
        { label: 'IP', render: (l) => `<span class="text-xs text-muted">${esc(l.ipAddress || '')}</span>` },
      ],
    });
  });
})();