/**
 * notifications.js
 * The bell in the topbar: unread badge, a quick-glance dropdown of the
 * most recent notifications, mark-as-read, and a link through to the full
 * Notifications page. Mounted once by app-shell.js (mirrors how the branch
 * switcher is mounted) so the badge is visible everywhere.
 */
(function (window) {
  const POLL_MS = 30000;
  let wrapEl = null;
  let pollTimer = null;
  let unreadCount = 0;
  let recent = [];
  let user = null;

  async function fetchUnread() {
    try {
      const { data } = await window.Api.get('/notifications', { limit: 8, page: 1 });
      unreadCount = data.unreadCount || 0;
      recent = data.items || [];
      renderBell();
    } catch {
      // Background poll - just leave the badge at its last known state.
    }
  }

  function renderBell() {
    if (!wrapEl) return;
    const badge = unreadCount > 0 ? `<span class="notif-badge">${unreadCount > 9 ? '9+' : unreadCount}</span>` : '';
    wrapEl.innerHTML = `
      <button class="btn btn-ghost btn-icon notif-bell-btn" id="notif-bell-btn" title="Notifications" aria-label="Notifications">
        ${window.Icons.get('bell') || window.Icons.get('alert')}
        ${badge}
      </button>
    `;
    wrapEl.querySelector('#notif-bell-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      toggleDropdown();
    });
  }

  function itemHtml(n) {
    const meta = window.NotificationTypes.meta(n.type);
    const unread = !n.readAt;
    return `
      <button class="notif-item ${unread ? 'unread' : ''}" data-id="${n._id}">
        <span class="notif-dot notif-dot-${n.severity || meta.severity}"></span>
        <span class="notif-item-body">
          <span class="notif-item-title">${window.UI.escapeHtml(n.title)}</span>
          <span class="notif-item-message">${window.UI.escapeHtml(n.message)}</span>
          <span class="notif-item-time">${window.UI.timeAgo(n.createdAt)}</span>
        </span>
      </button>
    `;
  }

  function toggleDropdown() {
    const existing = wrapEl.querySelector('.dropdown-menu');
    if (existing) { existing.remove(); return; }

    const menu = document.createElement('div');
    menu.className = 'dropdown-menu notif-dropdown';
    menu.innerHTML = `
      <div class="notif-dropdown-head">
        <span>Notifications</span>
        ${unreadCount > 0 ? '<button class="btn-link" id="notif-mark-all">Mark all read</button>' : ''}
      </div>
      <div class="notif-dropdown-list">
        ${recent.length ? recent.map(itemHtml).join('') : `<div class="notif-empty">You're all caught up.</div>`}
      </div>
      <a class="notif-dropdown-foot" href="notifications.html">View all notifications</a>
    `;
    wrapEl.appendChild(menu);

    menu.querySelectorAll('.notif-item').forEach((btn) => {
      btn.addEventListener('click', async () => {
        try {
          await window.Api.post(`/notifications/${btn.dataset.id}/read`);
          btn.classList.remove('unread');
          await fetchUnread();
        } catch {
          // non-fatal - stays marked unread until the next poll
        }
      });
    });

    menu.querySelector('#notif-mark-all')?.addEventListener('click', async () => {
      try {
        await window.Api.post('/notifications/mark-all-read');
        await fetchUnread();
        menu.remove();
        window.UI.toast.success('All notifications marked as read');
      } catch (err) {
        window.UI.toast.error(err.message);
      }
    });

    const closeOnOutsideClick = (evt) => {
      if (!menu.contains(evt.target)) {
        menu.remove();
        document.removeEventListener('click', closeOnOutsideClick);
      }
    };
    setTimeout(() => document.addEventListener('click', closeOnOutsideClick), 0);
  }

  /** Called once by app-shell.js when it renders the topbar. */
  function mount(wrap, currentUser) {
    wrapEl = wrap;
    user = currentUser;
    if (!wrapEl || !window.Permissions.can(user, 'notifications.view')) {
      if (wrapEl) wrapEl.innerHTML = '';
      return;
    }
    renderBell();
    fetchUnread();
    clearInterval(pollTimer);
    pollTimer = setInterval(() => { if (!document.hidden) fetchUnread(); }, POLL_MS);
  }

  window.NotificationCenter = { mount };
})(window);