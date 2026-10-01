/**
 * tickets.js - shop-side Help & Support.
 * Cashier / storekeeper / manager / owner raise a ticket (description, pasted
 * error text, screenshots), follow the conversation, and confirm when fixed.
 * Owners/managers also see tickets raised by their staff.
 */
(function () {
  const esc = window.UI.escapeHtml;
  const TU = window.TicketUI;
  const state = { page: 1, limit: 15, status: '', search: '' };
  let contentEl;
  let user;

  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    contentEl = window.AppShell.mount({ title: 'Help & Support' });
    if (!contentEl) return;
    user = window.AppShell.getUser();

    if (!window.Permissions.can(user, 'tickets.view')) {
      contentEl.innerHTML = `<div class="card">${window.UI.emptyStateHtml({ icon: 'alert', title: 'Support is not available for your role' })}</div>`;
      return;
    }
    contentEl.innerHTML = skeleton();
    bind();
    await load();

    // Deep link: tickets.html?open=<ticketId> or ?new=1
    const params = new URLSearchParams(window.location.search);
    if (params.get('open')) openDetail(params.get('open'));
    else if (params.get('new')) openRaiseModal();
  }

  function skeleton() {
    const chips = [['', 'All'], ['OPEN', 'Open'], ['IN_PROGRESS', 'In progress'], ['RESOLVED', 'Resolved'], ['CLOSED', 'Closed']];
    return `
      <div class="page-header">
        <div><h1>Help &amp; Support</h1><p>Something not working? Raise a ticket and we'll fix it - you'll be notified when it's solved.</p></div>
        <div class="page-actions">
          <button class="btn btn-primary btn-sm" id="new-ticket-btn" data-requires-permission="tickets.create">Raise a ticket</button>
          <button class="btn btn-secondary btn-sm" id="refresh-btn">Refresh</button>
        </div>
      </div>
      <div class="card" style="margin-bottom: var(--space-4)">
        <div class="toolbar">
          <div class="chip-row" id="tk-chips">${chips.map(([k, l]) => `<button type="button" class="chip ${k === '' ? 'active' : ''}" data-status="${k}">${esc(l)}</button>`).join('')}</div>
          <div class="toolbar-search input-group"><span class="input-group-icon">${window.Icons.get('search')}</span><input class="input" id="tk-search" type="text" placeholder="Search ticket # or subject" /></div>
        </div>
      </div>
      <div class="card">
        <div class="table-wrap flat">
          <table class="table">
            <thead><tr><th>Ticket</th><th>Subject</th><th>Status</th><th>Priority</th><th>Updated</th></tr></thead>
            <tbody id="tk-tbody">${window.UI.skeletonRows(5, 6)}</tbody>
          </table>
        </div>
        <div class="pagination" id="tk-pagination"></div>
      </div>`;
  }

  function bind() {
    window.Permissions.applyPermissionGates(contentEl, user);
    document.getElementById('new-ticket-btn')?.addEventListener('click', openRaiseModal);
    document.getElementById('refresh-btn').addEventListener('click', load);
    document.getElementById('tk-chips').addEventListener('click', (e) => {
      const chip = e.target.closest('[data-status]');
      if (!chip) return;
      state.status = chip.dataset.status; state.page = 1;
      document.querySelectorAll('#tk-chips .chip').forEach((c) => c.classList.toggle('active', c === chip));
      load();
    });
    document.getElementById('tk-search').addEventListener('input', window.UI.debounce((e) => { state.search = e.target.value.trim(); state.page = 1; load(); }, 350));
  }

  async function load() {
    const tbody = document.getElementById('tk-tbody');
    tbody.innerHTML = window.UI.skeletonRows(5, 6);
    try {
      const { data } = await window.Api.get('/tickets', { page: state.page, limit: state.limit, status: state.status || undefined, search: state.search || undefined });
      if (!data.items.length) {
        tbody.innerHTML = `<tr><td colspan="5">${window.UI.emptyStateHtml({ icon: 'check', title: state.status || state.search ? 'No tickets match' : 'No tickets yet', message: 'Use "Raise a ticket" if something is not working.' })}</td></tr>`;
      } else {
        tbody.innerHTML = data.items.map((t) => `
          <tr class="log-row" data-id="${t._id}" tabindex="0">
            <td class="cell-primary">${esc(t.ticketNumber)}</td>
            <td><div class="font-semibold">${esc(t.subject)}</div><div class="text-xs text-muted">${esc(TU.categoryLabel(t.category))}${t.raisedBy !== user._id && t.raisedByName ? ` · ${esc(t.raisedByName)}` : ''}</div></td>
            <td>${TU.statusBadge(t.status)}</td>
            <td>${TU.priorityBadge(t.priority)}</td>
            <td class="text-sm">${window.UI.timeAgo(t.lastActivityAt)}</td>
          </tr>`).join('');
        tbody.querySelectorAll('.log-row').forEach((row) => {
          const open = () => openDetail(row.dataset.id);
          row.addEventListener('click', open);
          row.addEventListener('keydown', (e) => { if (e.key === 'Enter') open(); });
        });
      }
      window.UI.renderPagination(document.getElementById('tk-pagination'), data, (p) => { state.page = p; load(); });
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="5">${window.UI.emptyStateHtml({ icon: 'alert', title: 'Could not load tickets', message: err.message })}</td></tr>`;
    }
  }

  /* ---------------------------- raise a ticket ---------------------------- */
  function openRaiseModal() {
    let referrerPath = '';
    try { referrerPath = document.referrer ? new URL(document.referrer).pathname.split('/').pop() : ''; } catch { /* ignore */ }

    const modal = window.UI.openModal({
      title: 'Raise a support ticket',
      maxWidth: '640px',
      bodyHtml: `
        <form id="tk-form" novalidate>
          <div class="form-row">
            <div class="field"><label for="tk-category">What is it about?</label><select class="select" id="tk-category" name="category">${TU.options(TU.CATEGORIES, 'OTHER')}</select></div>
            <div class="field"><label for="tk-priority">How urgent?</label><select class="select" id="tk-priority" name="priority">${TU.options(TU.PRIORITIES, 'MEDIUM')}</select></div>
          </div>
          <div class="field"><label for="tk-subject">Short title</label><input class="input" id="tk-subject" name="subject" maxlength="150" placeholder="e.g. M-PESA payment stuck on 'waiting'" required /></div>
          <div class="field"><label for="tk-desc">Describe the problem</label><textarea class="textarea" id="tk-desc" name="description" maxlength="3000" placeholder="What were you doing? What did you expect? What happened instead?" required></textarea></div>
          <div class="field">
            <label for="tk-error">Error message <span class="text-muted">(optional)</span></label>
            <textarea class="textarea" id="tk-error" name="errorMessage" maxlength="5000" placeholder="Copy the red error message and paste it here"></textarea>
            <div><button type="button" class="btn-link" id="tk-paste">Paste from clipboard</button></div>
          </div>
          <div class="field"><label for="tk-page">Which screen were you on? <span class="text-muted">(optional)</span></label><input class="input" id="tk-page" name="pageUrl" maxlength="500" value="${esc(referrerPath)}" placeholder="e.g. sales.html" /></div>
          <div class="field"><label>Screenshots <span class="text-muted">(optional)</span></label><div id="tk-picker"></div></div>
        </form>`,
      footerHtml: `<button class="btn btn-secondary" data-action="cancel">Cancel</button><button class="btn btn-primary" data-action="submit">Submit ticket</button>`,
    });

    const picker = TU.createPicker(modal.querySelector('#tk-picker'));
    const cleanup = () => { picker.destroy(); window.UI.closeModal(); };
    modal.querySelector('[data-action="cancel"]').addEventListener('click', cleanup);

    modal.querySelector('#tk-paste').addEventListener('click', async () => {
      try {
        const text = await navigator.clipboard.readText();
        if (text) modal.querySelector('#tk-error').value = text.slice(0, 5000);
        else window.UI.toast.warning('Clipboard is empty');
      } catch { window.UI.toast.warning('Allow clipboard access, or press Ctrl+V in the box'); }
    });

    modal.querySelector('[data-action="submit"]').addEventListener('click', async (e) => {
      const form = modal.querySelector('#tk-form');
      const subject = form.subject.value.trim();
      const description = form.description.value.trim();
      if (subject.length < 3) return window.UI.toast.error('Please add a short title');
      if (description.length < 10) return window.UI.toast.error('Please describe the problem (at least 10 characters)');

      const btn = e.currentTarget;
      window.UI.setButtonLoading(btn, true, 'Uploading…');
      try {
        const fd = TU.buildForm({
          subject, description,
          category: form.category.value, priority: form.priority.value,
          errorMessage: form.errorMessage.value, pageUrl: form.pageUrl.value,
          branchId: window.AppShell.getActiveBranchId(),
        }, picker.getFiles());
        const { data } = await window.Api.upload('/tickets', fd);
        cleanup();
        window.UI.toast.success(`Ticket ${data.ticket.ticketNumber} raised - we'll get back to you`);
        state.page = 1;
        load();
      } catch (err) {
        window.UI.toast.error(err.message);
      } finally {
        window.UI.setButtonLoading(btn, false);
      }
    });
  }

  /* ----------------------------- ticket detail ----------------------------- */
  async function openDetail(id) {
    let t;
    try { ({ data: { ticket: t } } = await window.Api.get(`/tickets/${id}`)); }
    catch (err) { return window.UI.toast.error(err.message); }

    const closed = t.status === 'CLOSED';
    const modal = window.UI.openModal({
      title: `${t.ticketNumber} · ${t.subject}`,
      maxWidth: '680px',
      bodyHtml: `
        <div style="display:flex;gap:var(--space-2);flex-wrap:wrap;margin-bottom:var(--space-2)">${TU.statusBadge(t.status)} ${TU.priorityBadge(t.priority)} <span class="badge badge-neutral">${esc(TU.categoryLabel(t.category))}</span></div>
        ${t.resolution && (t.status === 'RESOLVED' || t.status === 'CLOSED') ? `<div class="tk-resolution"><b>Solution:</b> ${esc(t.resolution)}</div>` : ''}
        ${TU.errorBlockHtml(t)}
        ${TU.threadHtml(t)}
        ${closed ? '<p class="text-sm text-muted">This ticket is closed. Raise a new ticket if the problem comes back.</p>' : `
          <div class="field"><label for="tk-reply">Add a reply</label><textarea class="textarea" id="tk-reply" maxlength="3000" placeholder="Add more details or tell us if it's still not working"></textarea></div>
          <div id="tk-reply-picker"></div>`}`,
      footerHtml: `
        <button class="btn btn-secondary" data-action="close">Close window</button>
        ${closed ? '' : `<button class="btn btn-secondary" data-action="resolve">It's fixed - close ticket</button><button class="btn btn-primary" data-action="reply">Send reply</button>`}`,
    });
    TU.bindCopyError(modal, t);
    const picker = closed ? null : TU.createPicker(modal.querySelector('#tk-reply-picker'));
    const done = () => { picker?.destroy(); window.UI.closeModal(); };
    modal.querySelector('[data-action="close"]').addEventListener('click', done);
    if (closed) return;

    modal.querySelector('[data-action="reply"]').addEventListener('click', async (e) => {
      const message = modal.querySelector('#tk-reply').value.trim();
      if (!message) return window.UI.toast.error('Write a reply first');
      const btn = e.currentTarget;
      window.UI.setButtonLoading(btn, true, 'Sending…');
      try {
        await window.Api.upload(`/tickets/${id}/reply`, TU.buildForm({ message }, picker.getFiles()));
        done(); window.UI.toast.success('Reply sent'); load(); openDetail(id);
      } catch (err) { window.UI.toast.error(err.message); }
      finally { window.UI.setButtonLoading(btn, false); }
    });

    modal.querySelector('[data-action="resolve"]').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      window.UI.setButtonLoading(btn, true, 'Closing…');
      try {
        await window.Api.post(`/tickets/${id}/close`);
        done(); window.UI.toast.success('Ticket closed'); load();
      } catch (err) { window.UI.toast.error(err.message); }
      finally { window.UI.setButtonLoading(btn, false); }
    });
  }
})();
