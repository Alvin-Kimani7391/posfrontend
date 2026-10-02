/**
 * notifications.js
 * Full notification centre: server-filtered list (type + unread-only),
 * pagination, mark-as-read / mark-all-read, and the "raise an alert" flow
 * for any employee with notifications.send.
 *
 * The detail modal formats everything properly:
 *   - money fields in `data` are integer cents -> shown as KES with .00
 *   - shift close: cash summary box, denominations table, cash-sales table
 *   - everything else: friendly labels instead of raw keys / JSON
 *
 * Deep link: notifications.html?open=<id> (and the 'notification:open' event
 * fired by the topbar bell) opens that specific notification's detail.
 */
(function () {
  const esc = window.UI.escapeHtml;
  const NT = window.NotificationTypes;

  const state = { page: 1, limit: 20, type: '', unreadOnly: false, items: [], total: 0, pages: 1 };
  let contentEl;
  let user;
  let branches = null;

  /** `data` amounts are integer cents. */
  const moneyC = (cents) => window.UI.formatMoney((Number(cents) || 0) / 100);

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

    // The bell dropdown (js/core/notifications.js) fires this when you click an
    // item while you're already on this page.
    window.addEventListener('notification:open', (e) => { if (e.detail) openDetail(e.detail); });

    await fetchNotifications();
    handleDeepLink();
  }

  /** ?open=<id> -> open that notification (from the list, else the copy the bell cached). */
  function handleDeepLink() {
    const id = new URLSearchParams(window.location.search).get('open');
    if (!id) return;

    let target = state.items.find((n) => n._id === id);
    if (!target) {
      try {
        const cached = JSON.parse(sessionStorage.getItem('notif:open') || 'null');
        if (cached && cached._id === id) target = cached;
      } catch { /* ignore */ }
    }
    try { sessionStorage.removeItem('notif:open'); } catch { /* ignore */ }
    window.history.replaceState(null, '', window.location.pathname);

    if (target) openDetail(target);
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
   * Detail modal - formatted sections
   * ------------------------------------------------------------------ */

  // Keys in notification `data` that hold integer cents.
  const MONEY_KEYS = new Set([
    'openingCash', 'expectedCash', 'actualCash', 'cashDifference', 'denominationTotal',
    'amount', 'total', 'subtotal', 'newBalance', 'creditLimit', 'availableCredit', 'outstandingBalance',
    'shortageAmount', 'paymentAmount', 'totalPaid', 'balance',
  ]);

  const LABELS = {
    openingCash: 'Opening float', expectedCash: 'Expected cash', actualCash: 'Counted cash',
    cashDifference: 'Difference', denominationTotal: 'Total counted', cashSaleCount: 'Cash sales',
    shortageAmount: 'Shortage', paymentAmount: 'Payment', totalPaid: 'Repaid so far', balance: 'Still owing',
    newBalance: 'New balance', creditLimit: 'Credit limit', availableCredit: 'Available credit',
    outstandingBalance: 'Outstanding balance', receiptNumber: 'Receipt', customerName: 'Customer',
    cashierName: 'Cashier', recordedBy: 'Recorded by', paymentStatus: 'Payment status',
    transferNumber: 'Transfer', refundNumber: 'Refund', itemCount: 'Items',
  };

  // Internal ids / noise - never worth showing to a human.
  const HIDDEN_KEYS = new Set([
    'sales', 'denominations', 'notes',
    'shortageId', 'shiftId', 'cashierId', 'customerId', 'saleId', 'registerId', 'productId', 'variantId',
    'fromBranchId', 'toBranchId', 'externalTransactionId',
  ]);

  const humanize = (k) => LABELS[k] || k.replace(/([A-Z])/g, ' $1').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

  function row(label, value, cls = '') {
    return `<div class="pos-totals-row ${cls}"><span>${esc(label)}</span><span>${value}</span></div>`;
  }

  function cashSummaryHtml(d, used) {
    ['openingCash', 'expectedCash', 'actualCash', 'cashDifference'].forEach((k) => used.add(k));
    if (d.expectedCash === undefined && d.actualCash === undefined) return '';
    const diff = Number(d.cashDifference) || 0;
    const tone = diff === 0 ? 'ok' : diff > 0 ? 'over' : 'short';
    const label = diff === 0 ? 'Balanced' : diff > 0 ? 'Over' : 'Short';
    return `
      <div class="notif-detail-box">
        ${d.openingCash !== undefined ? row('Opening float', moneyC(d.openingCash)) : ''}
        ${d.expectedCash !== undefined ? row('Expected cash', moneyC(d.expectedCash)) : ''}
        ${d.actualCash !== undefined ? row('Counted cash', moneyC(d.actualCash)) : ''}
        ${row(label, moneyC(Math.abs(diff)), `grand notif-val-${tone}`)}
      </div>`;
  }

  function denominationsHtml(list, totalCents) {
    const lines = (list || []).filter((l) => l.count > 0).sort((a, b) => b.denomination - a.denomination);
    if (!lines.length) return '';
    const units = lines.reduce((s, l) => s + l.count, 0);
    const total = totalCents != null ? totalCents : lines.reduce((s, l) => s + (l.subtotal || 0), 0);
    return `
      <div class="notif-detail-title">Cash counted by denomination</div>
      <div class="cc-breakdown" style="margin-top:0">
        <table>
          <thead><tr><th>Note / coin</th><th class="num">Count</th><th class="num">Amount</th></tr></thead>
          <tbody>
            ${lines.map((l) => `
              <tr>
                <td>${window.UI.formatMoney(l.denomination)}</td>
                <td class="num">${l.count}</td>
                <td class="num">${moneyC(l.subtotal != null ? l.subtotal : l.denomination * l.count * 100)}</td>
              </tr>`).join('')}
          </tbody>
          <tfoot><tr><td>Total</td><td class="num">${units}</td><td class="num">${moneyC(total)}</td></tr></tfoot>
        </table>
      </div>`;
  }

  function saleBreakdownHtml(sales) {
    if (!sales || !sales.length) return '<p class="text-sm text-muted">No cash sales recorded for this shift.</p>';
    return `
      <div class="table-wrap">
        <table class="diff-table" style="width:100%">
          <thead><tr><th>Receipt</th><th>When</th><th class="num">Amount</th><th class="num">Tendered</th><th class="num">Change</th></tr></thead>
          <tbody>${sales.map((s) => `
            <tr>
              <td class="mono">${esc(s.receiptNumber || '—')}</td>
              <td class="text-sm">${window.UI.formatDateTime(s.at)}</td>
              <td class="num">${moneyC(s.amount)}</td>
              <td class="num">${moneyC(s.amountTendered)}</td>
              <td class="num">${moneyC(s.changeGiven)}</td>
            </tr>`).join('')}</tbody>
        </table>
      </div>`;
  }

  function formatValue(key, v) {
    if (MONEY_KEYS.has(key) && typeof v === 'number') return moneyC(v);
    if (/At$/.test(key) && v) return window.UI.formatDateTime(v);
    if (key === 'method') return esc(String(v).replace(/_/g, ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase()));
    return esc(String(v));
  }

  function genericDataHtml(data, used) {
    const entries = Object.entries(data || {}).filter(([k, v]) =>
      !used.has(k) && !HIDDEN_KEYS.has(k) && v !== null && v !== undefined && v !== '' && typeof v !== 'object');
    if (!entries.length) return '';
    return `<div class="notif-detail-box">${entries.map(([k, v]) => row(humanize(k), formatValue(k, v))).join('')}</div>`;
  }

  function detailBodyHtml(n) {
    const d = n.data || {};
    const used = new Set();
    let html = '';

    html += cashSummaryHtml(d, used);
    if (Array.isArray(d.denominations)) { used.add('denominationTotal'); html += denominationsHtml(d.denominations, d.denominationTotal); }
    if (Array.isArray(d.sales)) {
      used.add('cashSaleCount');
      html += `<div class="notif-detail-title">Cash sales in this shift (${d.sales.length})</div>${saleBreakdownHtml(d.sales)}`;
    }
    if (d.notes) html += `<div class="notif-detail-title">Cashier notes</div><p class="text-sm">${esc(d.notes)}</p>`;
    html += genericDataHtml(d, used);
    return html;
  }

  function openDetail(n) {
    const meta = NT.meta(n.type);
    const when = new Intl.DateTimeFormat('en-KE', { dateStyle: 'full', timeStyle: 'medium' }).format(new Date(n.createdAt));

    const modal = window.UI.openModal({
      title: n.title,
      maxWidth: '640px',
      bodyHtml: `
        <div style="display:flex; align-items:center; gap:var(--space-2); margin-bottom:var(--space-3); flex-wrap:wrap">
          <span class="notif-dot notif-dot-${n.severity || meta.severity}"></span>
          <span class="badge badge-neutral">${esc(meta.label)}</span>
          <span class="text-xs text-muted">${esc(when)}</span>
        </div>
        <p>${esc(n.message)}</p>
        ${n.branchId?.name ? `<p class="text-sm text-muted">Branch: ${esc(n.branchId.name)}</p>` : ''}
        ${detailBodyHtml(n)}
      `,
      footerHtml: `<button class="btn btn-primary" data-action="close">Close</button>`,
    });
    modal.querySelector('[data-action="close"]').addEventListener('click', window.UI.closeModal);

    if (!n.readAt) {
      n.readAt = new Date().toISOString();
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