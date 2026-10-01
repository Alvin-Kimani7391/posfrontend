/**
 * admin-tickets.js - platform support inbox (SUPER_ADMIN only).
 * Lists tickets from every business, opens one to read the description,
 * pasted error and screenshots, reply, change status/priority, and write the
 * resolution. Resolving or closing notifies the shop user via their bell.
 */
(function () {
  const esc = window.UI.escapeHtml;
  const TU = window.TicketUI;
  let el;
  let listApi;

  document.addEventListener('DOMContentLoaded', () => {
    el = window.AdminShell.mount({ title: 'Support tickets' });
    if (!el) return;
    el.innerHTML = `
      <div class="page-header"><div><h1>Support tickets</h1><p>Problems raised by shop owners, managers, cashiers and storekeepers.</p></div></div>
      <div class="tk-stats" id="tk-stats"></div>
      <div id="tk-list"></div>`;
    loadStats();
    listApi = window.AdminList.create(document.getElementById('tk-list'), {
      endpoint: '/admin/tickets',
      search: 'Search ticket #, subject or person...',
      filters: [
        { key: 'awaiting', type: 'select', label: 'Waiting on', options: [['', 'Everything'], ['true', 'Waiting on me']] },
        { key: 'status', type: 'select', label: 'Status', options: [['', 'All'], ['OPEN', 'Open'], ['IN_PROGRESS', 'In progress'], ['RESOLVED', 'Resolved'], ['CLOSED', 'Closed']] },
        { key: 'priority', type: 'select', label: 'Priority', options: [['', 'All'], ['URGENT', 'Urgent'], ['HIGH', 'High'], ['MEDIUM', 'Medium'], ['LOW', 'Low']] },
        { key: 'businessId', type: 'business' },
        { key: 'from', type: 'date', label: 'From' },
        { key: 'to', type: 'date', label: 'To' },
      ],
      columns: [
        { label: 'Ticket', render: (t) => `${t.awaitingAdmin && ['OPEN', 'IN_PROGRESS'].includes(t.status) ? '<span class="tk-dot" title="Waiting on you"></span>' : ''}<span class="cell-primary">${esc(t.ticketNumber)}</span>` },
        { label: 'Business', render: (t) => esc(t.businessName || '-') },
        { label: 'Raised by', render: (t) => `${esc(t.raisedByName || '-')} <span class="text-xs text-muted">${esc(String(t.raisedByRole || '').toLowerCase())}</span>` },
        { label: 'Subject', render: (t) => `<span class="font-semibold">${esc(t.subject)}</span><div class="text-xs text-muted">${esc(TU.categoryLabel(t.category))} · ${(t.attachments || []).length} screenshot(s)</div>` },
        { label: 'Priority', render: (t) => TU.priorityBadge(t.priority) },
        { label: 'Status', render: (t) => TU.statusBadge(t.status) },
        { label: 'Updated', render: (t) => window.UI.timeAgo(t.lastActivityAt) },
      ],
      onRow: (t) => openDetail(t._id),
      empty: { title: 'No tickets', message: 'Nothing here - or try changing the filters.' },
    });
    setInterval(() => { if (!document.hidden) { loadStats(); } }, 60000);
  });

  async function loadStats() {
    try {
      const { data: s } = await window.Api.get('/admin/tickets/stats');
      document.getElementById('tk-stats').innerHTML = [
        ['Waiting on you', s.awaitingAdmin, s.awaitingAdmin ? 'alert' : ''], ['Open', s.open, ''], ['In progress', s.inProgress, ''],
        ['Resolved', s.resolved, ''], ['Closed', s.closed, ''],
      ].map(([l, n, c]) => `<div class="tk-stat ${c}"><b>${n}</b><span>${l}</span></div>`).join('');
    } catch { /* non-fatal */ }
  }

  async function openDetail(id) {
    let t;
    try { ({ data: { ticket: t } } = await window.Api.get(`/admin/tickets/${id}`)); }
    catch (err) { return window.UI.toast.error(err.message); }

    const modal = window.UI.openModal({
      title: `${t.ticketNumber} · ${t.subject}`,
      maxWidth: '760px',
      bodyHtml: `
        <div class="tk-meta">
          <div><span>Business</span><b>${esc(t.businessName || '-')}</b></div>
          <div><span>Raised by</span><b>${esc(t.raisedByName || '-')} (${esc(String(t.raisedByRole || '').toLowerCase())})</b></div>
          <div><span>Phone</span><b>${esc(t.raisedByPhone || t.businessPhone || '-')}</b></div>
          <div><span>Category</span><b>${esc(TU.categoryLabel(t.category))}</b></div>
          <div><span>Screen</span><b>${esc(t.pageUrl || '-')}</b></div>
          <div><span>Raised</span><b>${window.UI.formatDateTime(t.createdAt)}</b></div>
        </div>
        ${t.userAgent ? `<div class="text-xs text-muted" style="word-break:break-word">Device: ${esc(t.userAgent)}</div>` : ''}
        ${TU.errorBlockHtml(t)}
        ${TU.threadHtml(t)}
        ${t.resolution ? `<div class="tk-resolution"><b>Resolution on file:</b> ${esc(t.resolution)}</div>` : ''}

        <div class="tk-section-title">Reply to ${esc(t.raisedByName || 'user')}</div>
        <div class="field"><textarea class="textarea" id="ad-reply" maxlength="3000" placeholder="Explain what you found or ask for more detail"></textarea></div>
        <div id="ad-picker"></div>

        <div class="tk-section-title">Status &amp; resolution</div>
        <div class="form-row">
          <div class="field"><label for="ad-status">Status</label><select class="select" id="ad-status">${TU.options(Object.entries(TU.STATUS).map(([k, v]) => [k, v.label]), t.status)}</select></div>
          <div class="field"><label for="ad-priority">Priority</label><select class="select" id="ad-priority">${TU.options([['LOW', 'Low'], ['MEDIUM', 'Medium'], ['HIGH', 'High'], ['URGENT', 'Urgent']], t.priority)}</select></div>
        </div>
        <div class="field"><label for="ad-resolution">Resolution note <span class="text-muted">(required to resolve/close - the user sees this)</span></label><textarea class="textarea" id="ad-resolution" maxlength="3000" placeholder="What was wrong and how it was fixed">${esc(t.resolution || '')}</textarea></div>`,
      footerHtml: `<button class="btn btn-secondary" data-action="close">Close window</button><button class="btn btn-secondary" data-action="status">Save status</button><button class="btn btn-primary" data-action="reply">Send reply</button>`,
    });
    TU.bindCopyError(modal, t);
    const picker = TU.createPicker(modal.querySelector('#ad-picker'));
    const done = () => { picker.destroy(); window.UI.closeModal(); };
    const refresh = () => { loadStats(); listApi?.reload(); };
    modal.querySelector('[data-action="close"]').addEventListener('click', done);

    modal.querySelector('[data-action="reply"]').addEventListener('click', async (e) => {
      const message = modal.querySelector('#ad-reply').value.trim();
      if (!message) return window.UI.toast.error('Write a reply first');
      const btn = e.currentTarget;
      window.UI.setButtonLoading(btn, true, 'Sending…');
      try {
        await window.Api.upload(`/admin/tickets/${id}/reply`, TU.buildForm({ message }, picker.getFiles()));
        done(); window.UI.toast.success('Reply sent - user notified'); refresh(); openDetail(id);
      } catch (err) { window.UI.toast.error(err.message); }
      finally { window.UI.setButtonLoading(btn, false); }
    });

    modal.querySelector('[data-action="status"]').addEventListener('click', async (e) => {
      const status = modal.querySelector('#ad-status').value;
      const priority = modal.querySelector('#ad-priority').value;
      const resolution = modal.querySelector('#ad-resolution').value.trim();
      if (['RESOLVED', 'CLOSED'].includes(status) && !resolution) return window.UI.toast.error('Add a resolution note first');
      const btn = e.currentTarget;
      window.UI.setButtonLoading(btn, true, 'Saving…');
      try {
        await window.Api.patch(`/admin/tickets/${id}/status`, { status, priority, resolution });
        done();
        window.UI.toast.success(status === 'CLOSED' ? 'Ticket closed - user notified' : status === 'RESOLVED' ? 'Marked resolved - user notified' : 'Ticket updated');
        refresh();
      } catch (err) { window.UI.toast.error(err.message); }
      finally { window.UI.setButtonLoading(btn, false); }
    });
  }
})();
