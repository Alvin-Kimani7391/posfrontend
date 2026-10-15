/**
 * notifications.js
 * The bell in the topbar: unread badge, a quick-glance dropdown of the
 * most recent notifications, mark-as-read, and a link through to the full
 * Notifications page. Mounted once by app-shell.js (mirrors how the branch
 * switcher is mounted) so the badge is visible everywhere.
 *
 * Clicking an item marks it read and OPENS THAT NOTIFICATION on
 * notifications.html (?open=<id>). If you're already on that page it opens
 * the detail window directly via a 'notification:open' event.
 *
 * LIVE UPDATES
 *   - NotificationCenter.refresh() (or the 'notifications:refresh' window event) reloads
 *     the badge immediately - used right after the POS raises a cash-drawer alert.
 *   - Coming back to the tab refreshes straight away instead of waiting for the next poll.
 *   - A critical notification that arrives while the app is open pops up once as a toast.
 *
 * SOUND (like WhatsApp Web): a short two-note "pop" plays when a NEW unread notification arrives while the app is open
 * (never for the first load, once per check however many arrive). It is synthesised with the Web Audio API, so there is
 * no audio file to load and it also works offline. Browsers only allow sound after the user has touched the page once,
 * so the audio engine is unlocked by the first tap / key press. The bell menu has a Sound on/off switch (remembered
 * on this device).
 */
(function (window) {
  const POLL_MS = 15000;
  const SOUND_KEY = 'pos.notifSound';
  let wrapEl = null;
  let pollTimer = null;
  let unreadCount = 0;
  let recent = [];
  let user = null;
  let enabled = false;
  let inflight = null;
  let firstLoadDone = false;
  const seenIds = new Set();

  /* ---------------------------- notification sound ---------------------------- */
  let audioCtx = null;
  function soundOn() {
    try { return localStorage.getItem(SOUND_KEY) !== 'off'; } catch { return true; }
  }
  function setSound(on) {
    try { localStorage.setItem(SOUND_KEY, on ? 'on' : 'off'); } catch { /* storage blocked */ }
  }
  function getCtx() {
    if (audioCtx) return audioCtx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try { audioCtx = new AC(); } catch { audioCtx = null; }
    return audioCtx;
  }
  /** Browsers keep audio locked until a user gesture: unlock on the first tap / key press anywhere in the app. */
  function unlockAudio() {
    const ctx = getCtx();
    if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
    if (ctx && ctx.state === 'running') {
      ['pointerdown', 'keydown', 'touchstart'].forEach((ev) => document.removeEventListener(ev, unlockAudio, true));
    }
  }
  ['pointerdown', 'keydown', 'touchstart'].forEach((ev) => document.addEventListener(ev, unlockAudio, true));

  /** Two soft rising notes (~0.4 s). Silent (and harmless) if audio is still locked or unsupported. */
  function playNotificationSound() {
    if (!soundOn()) return;
    const ctx = getCtx();
    if (!ctx || ctx.state !== 'running') return;
    const t0 = ctx.currentTime;
    [[880, 0], [1318.5, 0.14]].forEach(([freq, delay]) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t0 + delay);
      gain.gain.exponentialRampToValueAtTime(0.35, t0 + delay + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + delay + 0.26);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t0 + delay);
      osc.stop(t0 + delay + 0.3);
    });
  }

  async function fetchUnread() {
    if (!enabled) return;
    if (inflight) return inflight; // never run two requests at once
    inflight = (async () => {
      try {
        const { data } = await window.Api.get('/notifications', { limit: 8, page: 1 });
        unreadCount = data.unreadCount || 0;
        recent = data.items || [];
        announceNew();
        renderBell();
      } catch {
        // Background poll - just leave the badge at its last known state.
      } finally {
        inflight = null;
      }
    })();
    return inflight;
  }

  /** Toast critical notifications that appeared since the last poll (never on the first load). */
  function announceNew() {
    const fresh = recent.filter((n) => !seenIds.has(n._id));
    recent.forEach((n) => seenIds.add(n._id));
    if (!firstLoadDone) { firstLoadDone = true; return; }
    if (fresh.some((n) => !n.readAt)) playNotificationSound(); // any NEW unread notification, once per check
    fresh
      .filter((n) => !n.readAt && (n.severity || window.NotificationTypes.meta(n.type).severity) === 'critical')
      .slice(0, 2)
      .forEach((n) => window.UI.toast.warning(n.title));
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

  /** Open one notification's detail on the Notifications page. */
  function openNotification(n) {
    if (document.body.dataset.page === 'notifications') {
      window.dispatchEvent(new CustomEvent('notification:open', { detail: n }));
      return;
    }
    try { sessionStorage.setItem('notif:open', JSON.stringify(n)); } catch { /* ignore */ }
    window.location.href = `notifications.html?open=${encodeURIComponent(n._id)}`;
  }

  function toggleDropdown() {
    const existing = wrapEl.querySelector('.dropdown-menu');
    if (existing) { existing.remove(); return; }

    const menu = document.createElement('div');
    menu.className = 'dropdown-menu notif-dropdown';
    menu.innerHTML = `
      <div class="notif-dropdown-head">
        <span>Notifications</span>
        <span>
          <button class="btn-link" id="notif-sound-toggle" type="button" title="Play a sound when a new notification arrives">Sound: ${soundOn() ? 'on' : 'off'}</button>
          ${unreadCount > 0 ? '<button class="btn-link" id="notif-mark-all">Mark all read</button>' : ''}
        </span>
      </div>
      <div class="notif-dropdown-list">
        ${recent.length ? recent.map(itemHtml).join('') : `<div class="notif-empty">You're all caught up.</div>`}
      </div>
      <a class="notif-dropdown-foot" href="notifications.html">View all notifications</a>
    `;
    wrapEl.appendChild(menu);

    menu.querySelectorAll('.notif-item').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const n = recent.find((x) => x._id === btn.dataset.id);
        if (!n) return;
        const wasUnread = !n.readAt;
        n.readAt = n.readAt || new Date().toISOString(); // so the detail page doesn't re-mark it
        menu.remove();
        if (wasUnread) {
          try { await window.Api.post(`/notifications/${n._id}/read`); } catch { /* non-fatal */ }
        }
        openNotification(n);
        fetchUnread();
      });
    });

    menu.querySelector('#notif-sound-toggle')?.addEventListener('click', (e) => {
      e.stopPropagation();
      const next = !soundOn();
      setSound(next);
      e.currentTarget.textContent = `Sound: ${next ? 'on' : 'off'}`;
      if (next) { unlockAudio(); playNotificationSound(); } // preview
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
    enabled = !!(wrapEl && window.Permissions.can(user, 'notifications.view'));
    if (!enabled) {
      if (wrapEl) wrapEl.innerHTML = '';
      return;
    }
    renderBell();
    fetchUnread();
    clearInterval(pollTimer);
    pollTimer = setInterval(() => { if (!document.hidden) fetchUnread(); }, POLL_MS);
  }

  /** Reload the badge + list right now (e.g. after raising an alert). */
  function refresh() { return fetchUnread(); }

  document.addEventListener('visibilitychange', () => { if (!document.hidden) fetchUnread(); });
  window.addEventListener('notifications:refresh', () => fetchUnread());

  window.NotificationCenter = { mount, refresh };
})(window);