/**
 * ui.js
 * Every page-specific script (branches.js, employees.js, ...) calls into
 * this file for anything visual: toasts, modals, confirm dialogs, loading
 * states, formatting, and generic table/pagination rendering. Keeping this
 * here means every page looks and behaves consistently, and a visual
 * change (e.g. new toast style) only needs to happen once.
 *
 * NEW: UI.showDrawerLock() - the blocking "give change / close the cash drawer"
 * screen used by the POS (see cash-drawer.js). It is NOT a modal: Escape and
 * clicking outside do nothing, and the rest of the app is made inert behind it.
 */
(function (window) {
  /* ------------------------------------------------------------------ *
   * Toasts
   * ------------------------------------------------------------------ */
  function ensureToastContainer() {
    let el = document.getElementById('toast-container');
    if (!el) {
      el = document.createElement('div');
      el.id = 'toast-container';
      el.className = 'toast-container';
      document.body.appendChild(el);
    }
    return el;
  }

  function toast(message, { type = 'default', duration = 4000 } = {}) {
    const container = ensureToastContainer();
    const el = document.createElement('div');
    const typeClass = type === 'default' ? '' : `toast-${type}`;
    el.className = `toast ${typeClass}`.trim();

    const iconName = { success: 'check', error: 'alert', warning: 'alert' }[type];
    el.innerHTML = `
      ${iconName ? `<span class="toast-icon">${window.Icons.get(iconName)}</span>` : ''}
      <span>${escapeHtml(message)}</span>
      <button class="toast-close" aria-label="Dismiss">${window.Icons.get('close')}</button>
    `;
    container.appendChild(el);

    const remove = () => el.remove();
    el.querySelector('.toast-close').addEventListener('click', remove);
    if (duration) setTimeout(remove, duration);
  }

  const UI_TOAST = {
    success: (msg) => toast(msg, { type: 'success' }),
    error: (msg) => toast(msg, { type: 'error', duration: 6000 }),
    warning: (msg) => toast(msg, { type: 'warning' }),
    info: (msg) => toast(msg),
  };

  /* ------------------------------------------------------------------ *
   * Modal
   * ------------------------------------------------------------------ */
  // A STACK, not a single reference: openModal() can be called again while
  // a modal is already open (e.g. ProductPicker opened from inside the
  // Receive Stock modal) and must layer on top rather than replace it.
  // closeModal() always closes only the topmost modal.
  const modalStack = [];

  function closeModal() {
    const backdrop = modalStack.pop();
    if (backdrop) {
      backdrop.remove();
      if (!modalStack.length) document.body.style.overflow = '';
    }
  }

  /**
   * openModal({ title, bodyHtml, footerHtml, onMount, size })
   * Returns the modal root element so callers can query/bind inside it.
   * Stacks on top of any modal already open instead of replacing it.
   */
  function openModal({ title, bodyHtml = '', footerHtml = '', onMount, maxWidth }) {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true" ${maxWidth ? `style="max-width:${maxWidth}"` : ''}>
        <div class="modal-header">
          <h3>${escapeHtml(title)}</h3>
          <button class="modal-close" aria-label="Close">${window.Icons.get('close')}</button>
        </div>
        <div class="modal-body">${bodyHtml}</div>
        ${footerHtml ? `<div class="modal-footer">${footerHtml}</div>` : ''}
      </div>
    `;

    // Closing THIS modal must never close a different one that got stacked
    // on top of it in the meantime, so these handlers close by identity
    // (remove this exact backdrop from wherever it sits in the stack)
    // rather than always popping the top.
    const closeThisModal = () => {
      const idx = modalStack.indexOf(backdrop);
      if (idx === -1) return;
      modalStack.splice(idx, 1);
      backdrop.remove();
      if (!modalStack.length) document.body.style.overflow = '';
    };

    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) closeThisModal();
    });
    backdrop.querySelector('.modal-close').addEventListener('click', closeThisModal);

    document.body.appendChild(backdrop);
    document.body.style.overflow = 'hidden';
    modalStack.push(backdrop);

    const modalEl = backdrop.querySelector('.modal');
    if (onMount) onMount(modalEl);
    return modalEl;
  }

  /** confirmDialog({ title, message, confirmText, danger }) -> Promise<boolean> */
  function confirmDialog({ title = 'Are you sure?', message = '', confirmText = 'Confirm', cancelText = 'Cancel', danger = false } = {}) {
    return new Promise((resolve) => {
      const modal = openModal({
        title,
        bodyHtml: `<p class="text-secondary">${escapeHtml(message)}</p>`,
        footerHtml: `
          <button class="btn btn-secondary" data-action="cancel">${escapeHtml(cancelText)}</button>
          <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-action="confirm">${escapeHtml(confirmText)}</button>
        `,
      });
      modal.querySelector('[data-action="cancel"]').addEventListener('click', () => { closeModal(); resolve(false); });
      modal.querySelector('[data-action="confirm"]').addEventListener('click', () => { closeModal(); resolve(true); });
    });
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModal();
  });

  /* ------------------------------------------------------------------ *
   * Cash drawer lock screen
   * showDrawerLock({ onReopen, onConfirm, onSetup }) -> controller
   *   controller.update({ change, tendered, due, receiptNumber, tone, message,
   *                       seconds, overdue, confirmVisible, confirmLabel, canReopen })
   *   controller.close()
   * Only one can exist at a time. The "Drawer is closed" button only reacts to a real
   * pointer / touch click - a barcode scanner's Enter key can never press it.
   * ------------------------------------------------------------------ */
  let drawerLockCtl = null;

  function formatTimer(totalSeconds) {
    const s = Math.max(0, Math.floor(Number(totalSeconds) || 0));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  function showDrawerLock({ onReopen, onConfirm, onSetup } = {}) {
    if (drawerLockCtl) return drawerLockCtl;

    const el = document.createElement('div');
    el.className = 'drawer-lock';
    el.setAttribute('role', 'alertdialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-labelledby', 'drawer-lock-title');
    el.innerHTML = `
      <div class="drawer-lock-card">
        <div class="drawer-lock-ico">${window.Icons.get('cash')}</div>
        <h2 id="drawer-lock-title">Give the change to the customer</h2>
        <div class="drawer-lock-change"><span>Change to give back</span><strong data-f="change">-</strong></div>
        <div class="drawer-lock-meta" data-f="meta"></div>
        <div class="drawer-lock-status" data-f="status" data-tone="info">
          <span data-f="msg">Opening the cash drawer…</span>
          <b data-f="timer"></b>
        </div>
        <div class="drawer-lock-actions">
          <button type="button" class="btn btn-secondary" data-f="reopen"><span>Open drawer again</span> <kbd class="kbd">F7</kbd></button>
          <button type="button" class="btn btn-success btn-lg" data-f="confirm"><span data-f="confirm-label">Drawer is closed</span> <kbd class="kbd">F8</kbd></button>
        </div>
        <button type="button" class="btn-link" data-f="setup">Drawer settings</button>
      </div>
    `;
    document.body.appendChild(el);

    // Everything behind the lock screen becomes unreachable (mouse AND keyboard).
    const appRoot = document.getElementById('app-shell');
    if (appRoot) appRoot.inert = true;
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();

    const f = (name) => el.querySelector(`[data-f="${name}"]`);

    // Enter / Space must never press a button here (a scanner burst ends with Enter).
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') e.preventDefault(); });

    f('reopen').addEventListener('click', (e) => { if (e.detail === 0) return; onReopen?.(); });
    f('confirm').addEventListener('click', (e) => { if (e.detail === 0) return; onConfirm?.(); });
    f('setup').addEventListener('click', () => onSetup?.());

    function update(p = {}) {
      if (p.change !== undefined) f('change').textContent = formatMoney(p.change);
      if (p.receiptNumber !== undefined || p.tendered !== undefined || p.due !== undefined) {
        const parts = [];
        if (p.receiptNumber) parts.push(`Receipt ${escapeHtml(p.receiptNumber)}`);
        if (p.tendered) parts.push(`Received ${formatMoney(p.tendered)}`);
        if (p.due) parts.push(`Total ${formatMoney(p.due)}`);
        f('meta').innerHTML = parts.join(' &middot; ');
      }
      if (p.tone) f('status').dataset.tone = p.tone;
      if (p.message !== undefined) f('msg').textContent = p.message;
      if (p.seconds !== undefined) f('timer').textContent = formatTimer(p.seconds);
      if (p.overdue !== undefined) el.classList.toggle('overdue', !!p.overdue);
      if (p.confirmVisible !== undefined) f('confirm').style.display = p.confirmVisible ? '' : 'none';
      if (p.confirmLabel !== undefined) f('confirm-label').textContent = p.confirmLabel;
      if (p.canReopen !== undefined) f('reopen').style.display = p.canReopen ? '' : 'none';
    }

    function close() {
      el.remove();
      if (appRoot) appRoot.inert = false;
      drawerLockCtl = null;
    }

    drawerLockCtl = { update, close, el };
    return drawerLockCtl;
  }

  /* ------------------------------------------------------------------ *
   * Button loading state
   * ------------------------------------------------------------------ */
  function setButtonLoading(button, isLoading, loadingText = 'Please wait…') {
    if (!button) return;
    if (isLoading) {
      button.dataset.originalHtml = button.innerHTML;
      button.disabled = true;
      button.innerHTML = `<span class="spinner"></span> ${escapeHtml(loadingText)}`;
    } else {
      button.disabled = false;
      if (button.dataset.originalHtml) button.innerHTML = button.dataset.originalHtml;
    }
  }

  /* ------------------------------------------------------------------ *
   * Formatters
   * ------------------------------------------------------------------ */
  function formatMoney(amount, currency = window.APP_CONFIG?.CURRENCY || 'KES') {
    const value = Number(amount || 0);
    return new Intl.NumberFormat('en-KE', { style: 'currency', currency, maximumFractionDigits: 2 }).format(value);
  }

  function formatDate(dateLike, opts = { day: '2-digit', month: 'short', year: 'numeric' }) {
    if (!dateLike) return '—';
    return new Intl.DateTimeFormat('en-KE', opts).format(new Date(dateLike));
  }

  function formatDateTime(dateLike) {
    if (!dateLike) return '—';
    return new Intl.DateTimeFormat('en-KE', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(dateLike));
  }

  /** 75 -> "1m 15s", 8 -> "8s" */
  function formatDuration(totalSeconds) {
    const s = Math.max(0, Math.round(Number(totalSeconds) || 0));
    if (s < 60) return `${s}s`;
    return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
  }

  function timeAgo(dateLike) {
    if (!dateLike) return '—';
    const seconds = Math.floor((Date.now() - new Date(dateLike).getTime()) / 1000);
    const steps = [['year', 31536000], ['month', 2592000], ['day', 86400], ['hour', 3600], ['minute', 60]];
    for (const [unit, secs] of steps) {
      const value = Math.floor(seconds / secs);
      if (value >= 1) return `${value} ${unit}${value > 1 ? 's' : ''} ago`;
    }
    return 'just now';
  }

  function initials(name = '') {
    return name.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() || '').join('');
  }

  function escapeHtml(str = '') {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function debounce(fn, wait = 350) {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), wait);
    };
  }

  /* ------------------------------------------------------------------ *
   * Generic empty state / skeleton rows
   * ------------------------------------------------------------------ */
  function emptyStateHtml({ icon = 'box', title = 'Nothing here yet', message = '', actionHtml = '' } = {}) {
    return `
      <div class="empty-state">
        <div class="empty-icon">${window.Icons.get(icon)}</div>
        <h3>${escapeHtml(title)}</h3>
        ${message ? `<p>${escapeHtml(message)}</p>` : ''}
        ${actionHtml}
      </div>
    `;
  }

  function skeletonRows(colCount, rowCount = 5) {
    return Array.from({ length: rowCount }).map(() => `
      <tr>${Array.from({ length: colCount }).map(() => `<td><div class="skeleton" style="height:14px;width:${60 + Math.random() * 30}%"></div></td>`).join('')}</tr>
    `).join('');
  }

  /* ------------------------------------------------------------------ *
   * Pagination control
   * renderPagination(container, { page, pages, total }, onPageChange)
   * ------------------------------------------------------------------ */
  function renderPagination(container, { page, pages, total, limit }, onPageChange) {
    if (!container) return;
    if (!pages || pages <= 1) {
      container.innerHTML = total
        ? `<div class="text-sm text-muted">${total} result${total === 1 ? '' : 's'}</div>`
        : '';
      return;
    }

    const windowSize = 5;
    let start = Math.max(1, page - Math.floor(windowSize / 2));
    let end = Math.min(pages, start + windowSize - 1);
    start = Math.max(1, end - windowSize + 1);

    let buttons = '';
    for (let p = start; p <= end; p++) {
      buttons += `<button class="${p === page ? 'active' : ''}" data-page="${p}">${p}</button>`;
    }

    container.innerHTML = `
      <div class="text-sm text-muted">Showing ${(page - 1) * limit + 1}-${Math.min(page * limit, total)} of ${total}</div>
      <div class="pagination-pages">
        <button data-page="${page - 1}" ${page <= 1 ? 'disabled' : ''}>&lsaquo;</button>
        ${buttons}
        <button data-page="${page + 1}" ${page >= pages ? 'disabled' : ''}>&rsaquo;</button>
      </div>
    `;

    container.querySelectorAll('button[data-page]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const p = Number(btn.dataset.page);
        if (p >= 1 && p <= pages) onPageChange(p);
      });
    });
  }

  /** Reads/serializes a <form> into a plain object, dropping empty strings. */
  function serializeForm(form) {
    const data = new FormData(form);
    const result = {};
    for (const [key, value] of data.entries()) {
      if (value === '') continue;
      if (result[key] !== undefined) {
        result[key] = Array.isArray(result[key]) ? [...result[key], value] : [result[key], value];
      } else {
        result[key] = value;
      }
    }
    // Single checkboxes (on/off toggles like "agree" or "vatRegistered") are
    // absent from FormData entirely when unchecked, so we need to read their
    // .checked boolean directly. Checkbox GROUPS (multiple inputs sharing a
    // name, e.g. branchIds) must opt out via data-checkbox-group="true" -
    // otherwise a group that happens to render with only one checkbox (e.g.
    // a business with a single branch) would be wrongly collapsed to a
    // boolean instead of staying an array of the checked value(s).
    form.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
      if (cb.name && cb.dataset.checkboxGroup !== 'true') {
        result[cb.name] = cb.checked;
      }
    });
    return result;
  }

  /** Renders field-level errors from an ApiError onto a form (adds .has-error + .field-error). */
  function applyFormErrors(form, errors = []) {
    form.querySelectorAll('.field-error').forEach((el) => el.remove());
    form.querySelectorAll('.has-error').forEach((el) => el.classList.remove('has-error'));
    errors.forEach(({ field, message }) => {
      const input = form.querySelector(`[name="${field}"]`);
      if (!input) return;
      input.classList.add('has-error');
      const err = document.createElement('div');
      err.className = 'field-error';
      err.textContent = message;
      input.closest('.field')?.appendChild(err);
    });
  }

  window.UI = {
    toast: UI_TOAST,
    openModal,
    closeModal,
    confirmDialog,
    showDrawerLock,
    setButtonLoading,
    formatMoney,
    formatDate,
    formatDateTime,
    formatDuration,
    timeAgo,
    initials,
    escapeHtml,
    debounce,
    emptyStateHtml,
    skeletonRows,
    renderPagination,
    serializeForm,
    applyFormErrors,
  };
})(window);