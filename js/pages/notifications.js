/**
 * notifications.js
 * Full notification centre: server-filtered list (type + unread-only),
 * pagination, mark-as-read / mark-all-read, and the "raise an alert" flow
 * for any employee with notifications.send. The detail modal understands
 * the shift-close cash breakdown (data.sales) specially; everything else
 * in `data` falls back to a generic key/value view, same pattern as the
 * audit log's detail modal.
 */
(function () {
  const esc = window.UI.escapeHtml;
  const NT = window.NotificationTypes;

  const state = { page: 1, limit: 20, type: '', unreadOnly: false, items: [], total: 0, pages: 1 };
  let contentEl;
  let user;
  let branches = null;

  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    contentEl = window.AppShell.mount({ title: 'Notifications' });
    if (!contentEl) return;
    user = window.AppShell.getUser();

    if (!window.Permissions.can(user, 'notifications.view')) {
      contentEl.innerHTML = `<div class="card">${window.UI.emptyStateHtml({ icon: 'alert', title: 'Notifications are not available for your role' })}</div>`;
      return;
    }

    contentEl.innerHTML = pageSkeleton();
    bindFilters();
    bindRaiseAlert();
    await fetchNotifications();
  }

  function pageSkeleton() {
    const canSend = window.Permissions.can(user, 'notifications.send');
    return `
      <div class="page-header">
        <div>
          <h1>Notifications</h1>
          <p>Everything happening across your business - shifts, sales, stock, payments and more.</p>
        </div>
        <div class="page-actions">
          ${canSend ? '<button class="btn btn-secondary btn-sm" id="raise-alert-btn">Raise an alert</button>' : ''}
          <button class="btn btn-secondary btn-sm" id="mark-all-btn">Mark all read</button>
          <button class="btn btn-secondary btn-sm" id="refresh-btn">Refresh</button>
        </div>
      </div>

      <div class="card" style="margin-bottom: var(--space-4)">
        <div class="audit-quick"><div class="chip-row" id="notif-quick-chips">
          ${NT.QUICK_FILTERS.map(([k, l]) => `<button type="button" class="chip ${k === '' ? 'active' : ''}" data-type="${k}">${esc(l)}</button>`).join('')}
        </div></div>
        <div class="audit-foot">
          <label class="checkbox-row text-sm"><input type="checkbox" id="unread-only" /> Unread only</label>
        </div>
      </div>

      <div class="card">
        <div class="table-wrap flat">
          <table class="table">
            <thead><tr><th></th><th>When</th><th>Notification</th><th>Branch</th><th></th></tr></thead>
            <tbody id="notif-tbody">${window.UI.skeletonRows(4, 8)}</tbody>
          </table>
        </div>
        <div class="pagination" id="notif-pagination"></div>
      </div>
    `;
  }

  function bindFilters() {
    document.getElementById('notif-quick-chips').addEventListener('click', (e) => {
      const chip = e.target.closest('[data-type]');
      if (!chip) return;
      state.type = chip.dataset.type;
      state.page = 1;
      document.querySelectorAll('#notif-quick-chips .chip').forEach((c) => c.classList.toggle('active', c === chip));
      fetchNotifications();
    });
    document.getElementById('unread-only').addEventListener('change', (e) => {
      state.unreadOnly = e.target.checked;
      state.page = 1;
      fetchNotifications();
    });
    document.getElementById('refresh-btn').addEventListener('click', () => fetchNotifications());
    document.getElementById('mark-all-btn').addEventListener('click', markAllRead);
  }

  async function markAllRead() {
    try {
      await window.Api.post('/notifications/mark-all-read');
      window.UI.toast.success('All notifications marked as read');
      await fetchNotifications();
    } catch (err) {
      window.UI.toast.error(err.message);
    }
  }

  /* ------------------------------------------------------------------ *
   * Fetch + render
   * ------------------------------------------------------------------ */
  async function fetchNotifications() {
    const tbody = document.getElementById('notif-tbody');
    tbody.innerHTML = window.UI.skeletonRows(4, 8);

    try {
      const { data } = await window.Api.get('/notifications', {
        page: state.page, limit: state.limit,
        type: state.type || undefined,
        unreadOnly: state.unreadOnly || undefined,
      });
      state.items = data.items || [];
      state.total = data.total;
      state.pages = data.pages;
      renderRows(tbody);
      window.UI.renderPagination(document.getElementById('notif-pagination'), data, (p) => {
        state.page = p; fetchNotifications(); window.scrollTo({ top: 0, behavior: 'smooth' });
      });
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="5">${window.UI.emptyStateHtml({ icon: 'alert', title: 'Could not load notifications', message: err.message })}</td></tr>`;
    }
  }

  function renderRows(tbody) {
    if (!state.items.length) {
      tbody.innerHTML = `<tr><td colspan="5">${window.UI.emptyStateHtml({
        icon: 'reports', title: state.unreadOnly ? "You're all caught up" : 'No notifications match these filters',
      })}</td></tr>`;
      return;
    }

    tbody.innerHTML = state.items.map((n, idx) => {
      const meta = NT.meta(n.type);
      const severity = n.severity || meta.severity;
      const unread = !n.readAt;
      return `
        <tr class="log-row ${unread ? 'notif-row-unread' : ''}" data-idx="${idx}" tabindex="0">
          <td><span class="notif-dot notif-dot-${severity}"></span></td>
          <td class="time-cell">${window.UI.formatDateTime(n.createdAt)}<small>${window.UI.timeAgo(n.createdAt)}</small></td>
          <td>
            <div class="font-semibold ${unread ? '' : 'text-secondary'}">${esc(n.title)}</div>
            <div class="text-sm text-muted">${esc(n.message)}</div>
          </td>
          <td class="text-sm">${n.branchId?.name ? esc(n.branchId.name) : '<span class="text-muted">All</span>'}</td>
          <td class="actions">
            ${unread ? `<button class="btn btn-secondary btn-sm" data-read="${idx}">Mark read</button>` : ''}
            <button class="btn btn-ghost btn-sm" data-view="${idx}">Details</button>
          </td>
        </tr>`;
    }).join('');

    tbody.querySelectorAll('[data-read]').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const n = state.items[Number(btn.dataset.read)];
        try {
          await window.Api.post(`/notifications/${n._id}/read`);
          await fetchNotifications();
        } catch (err) {
          window.UI.toast.error(err.message);
        }
      });
    });
    tbody.querySelectorAll('.log-row').forEach((row) => {
      const open = () => openDetail(state.items[Number(row.dataset.idx)]);
      row.addEventListener('click', open);
      row.addEventListener('keydown', (e) => { if (e.key === 'Enter') open(); });
    });
  }

  /* ------------------------------------------------------------------ *
   * Detail modal - understands the shift-close cash breakdown specially,
   * falls back to a generic key/value view for everything else.
   * ------------------------------------------------------------------ */
  function saleBreakdownHtml(sales) {
    if (!sales || !sales.length) return '<p class="text-sm text-muted">No cash sales recorded for this shift.</p>';
    return `
      <table class="diff-table">
        <thead><tr><th>Receipt</th><th>When</th><th class="num">Amount</th><th class="num">Tendered</th><th class="num">Change</th></tr></thead>
        <tbody>${sales.map((s) => `
          <tr>
            <td class="mono">${esc(s.receiptNumber || '—')}</td>
            <td class="text-sm">${window.UI.formatDateTime(s.at)}</td>
            <td class="num">${window.UI.formatMoney((s.amount || 0) / 100)}</td>
            <td class="num">${window.UI.formatMoney((s.amountTendered || 0) / 100)}</td>
            <td class="num">${window.UI.formatMoney((s.changeGiven || 0) / 100)}</td>
          </tr>`).join('')}</tbody>
      </table>`;
  }

  function genericDataHtml(data) {
    if (!data || !Object.keys(data).length) return '';
    const entries = Object.entries(data).filter(([k]) => k !== 'sales');
    if (!entries.length) return '';
    return `
      <dl class="kv-grid">
        ${entries.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(typeof v === 'object' ? JSON.stringify(v) : String(v))}</dd>`).join('')}
      </dl>`;
  }

  function openDetail(n) {
    const meta = NT.meta(n.type);
    const when = new Intl.DateTimeFormat('en-KE', { dateStyle: 'full', timeStyle: 'medium' }).format(new Date(n.createdAt));
    const hasSaleBreakdown = Array.isArray(n.data?.sales);

    const modal = window.UI.openModal({
      title: n.title,
      maxWidth: '640px',
      bodyHtml: `
        <div style="display:flex; align-items:center; gap:var(--space-2); margin-bottom:var(--space-3)">
          <span class="notif-dot notif-dot-${n.severity || meta.severity}"></span>
          <span class="badge badge-neutral">${esc(meta.label)}</span>
          <span class="text-xs text-muted">${esc(when)}</span>
        </div>
        <p>${esc(n.message)}</p>
        ${n.branchId?.name ? `<p class="text-sm text-muted">Branch: ${esc(n.branchId.name)}</p>` : ''}
        ${hasSaleBreakdown ? `<div class="detail-title">Cash sales in this shift</div>${saleBreakdownHtml(n.data.sales)}` : ''}
        ${genericDataHtml(n.data)}
      `,
      footerHtml: `<button class="btn btn-primary" data-action="close">Close</button>`,
    });
    modal.querySelector('[data-action="close"]').addEventListener('click', window.UI.closeModal);

    if (!n.readAt) {
      window.Api.post(`/notifications/${n._id}/read`).then(fetchNotifications).catch(() => {});
    }
  }

  /* ------------------------------------------------------------------ *
   * Raise an alert - the "employee chooses to notify the owner" flow
   * ------------------------------------------------------------------ */
  function bindRaiseAlert() {
    document.getElementById('raise-alert-btn')?.addEventListener('click', openRaiseAlertModal);
  }

  async function loadBranchOptions() {
    if (branches || !window.Permissions.can(user, 'branches.view')) return branches;
    try {
      const { data } = await window.Api.get('/branches', { page: 1, limit: 100, status: 'active' });
      branches = data.items || [];
    } catch {
      branches = [];
    }
    return branches;
  }

  async function openRaiseAlertModal() {
    const branchOptions = await loadBranchOptions();

    const modal = window.UI.openModal({
      title: 'Raise an alert to management',
      bodyHtml: `
        <form id="alert-form">
          <div class="field">
            <label for="alert-type">What's this about?</label>
            <select class="select" id="alert-type" name="type" required>
              ${NT.EMPLOYEE_RAISABLE_TYPES.map((t) => `<option value="${t}">${esc(NT.meta(t).label)}</option>`).join('')}
            </select>
          </div>
          ${branchOptions && branchOptions.length > 1 ? `
          <div class="field">
            <label for="alert-branch">Branch</label>
            <select class="select" id="alert-branch" name="branchId">
              ${branchOptions.map((b) => `<option value="${b._id}">${esc(b.name)}</option>`).join('')}
            </select>
          </div>` : ''}
          <div class="field">
            <label for="alert-message">Message</label>
            <textarea class="textarea" id="alert-message" name="message" placeholder="What does the owner need to know?" required minlength="3" maxlength="500"></textarea>
          </div>
        </form>
      `,
      footerHtml: `
        <button class="btn btn-secondary" data-action="cancel">Cancel</button>
        <button class="btn btn-primary" data-action="submit">Send alert</button>
      `,
    });

    modal.querySelector('[data-action="cancel"]').addEventListener('click', window.UI.closeModal);
    modal.querySelector('[data-action="submit"]').addEventListener('click', async (e) => {
      const form = modal.querySelector('#alert-form');
      if (!form.reportValidity()) return;
      const payload = window.UI.serializeForm(form);
      const submitBtn = e.currentTarget;
      window.UI.setButtonLoading(submitBtn, true, 'Sending…');
      try {
        await window.Api.post('/notifications/alert', payload);
        window.UI.closeModal();
        window.UI.toast.success('Alert sent to management');
        await fetchNotifications();
      } catch (err) {
        window.UI.applyFormErrors(form, err.errors);
        window.UI.toast.error(err.message);
      } finally {
        window.UI.setButtonLoading(submitBtn, false);
      }
    });
  }
})();