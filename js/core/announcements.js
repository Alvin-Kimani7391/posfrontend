/**
 * announcements.js
 * Shows platform announcements to shop users.
 *  - display MODAL  -> pop-up (dashboard, etc.), acknowledged with "Got it"
 *  - display TICKER -> slim scrolling bar. On the Sales screen it is inserted
 *                      right under the POS top bar (so it also shows in "full
 *                      view"); on every other page it sits under the app bar.
 *
 * Loaded automatically by app-shell.js (same pattern as the guided tour), so no
 * page HTML needs editing. Also exposes helpers used by the admin page preview.
 * Targeting (role, page, schedule) is decided by the server; this file only renders.
 */
(function (window) {
  'use strict';

  const esc = (s) => window.UI.escapeHtml(s == null ? '' : String(s));
  const SPEED = 60; // ticker speed, px per second
  const POLL_MS = 3 * 60 * 1000;
  const SEEN_PREFIX = 'sixstar.ann.seen.';
  const HIDDEN_KEY = 'sixstar.ann.tickerHidden';
  const SEVERITY = { CRITICAL: 4, WARNING: 3, SUCCESS: 2, INFO: 1 };

  const svg = (inner) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
  const CLOSE_ICON = svg('<path d="M18 6 6 18M6 6l12 12"/>');
  const TYPE_META = {
    INFO: { label: 'Announcement', icon: svg('<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>') },
    SUCCESS: { label: "What's new", icon: svg('<circle cx="12" cy="12" r="10"/><path d="m8.5 12.5 2.5 2.5 4.5-5"/>') },
    WARNING: { label: 'Heads up', icon: svg('<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>') },
    CRITICAL: { label: 'Important', icon: svg('<path d="M7.9 2h8.2L22 7.9v8.2L16.1 22H7.9L2 16.1V7.9z"/><path d="M12 8v5M12 16h.01"/>') },
  };
  const meta = (t) => TYPE_META[t] || TYPE_META.INFO;

  const bySeverity = (a, b) =>
    (SEVERITY[b.type] || 0) - (SEVERITY[a.type] || 0) || new Date(b.startsAt || 0) - new Date(a.startsAt || 0);
  const oneLine = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const multiline = (s) => esc(s).replace(/\n/g, '<br>');
  const itemKey = (i) => `${i._id}:${i.version}`;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /* ------------------------------ styles ------------------------------ */
  let stylesReady = null;
  function ensureStyles() {
    if (stylesReady) return stylesReady;
    if (document.querySelector('link[href$="announcements.css"]')) return (stylesReady = Promise.resolve());
    stylesReady = new Promise((resolve) => {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = 'css/announcements.css';
      link.onload = resolve;
      link.onerror = resolve;
      document.head.appendChild(link);
      setTimeout(resolve, 1500);
    });
    return stylesReady;
  }

  /* --------------------------- "already seen" -------------------------- */
  function userId() {
    const u = window.AppShell?.getUser?.();
    return (u && (u._id || u.id)) || 'anon';
  }
  function readSeen() {
    try { return JSON.parse(localStorage.getItem(SEEN_PREFIX + userId()) || '{}'); } catch { return {}; }
  }
  function isSeen(item) { return (readSeen()[item._id] || 0) >= item.version; }
  function markSeen(item) {
    try {
      const seen = readSeen();
      seen[item._id] = item.version;
      const ids = Object.keys(seen);
      if (ids.length > 300) ids.slice(0, ids.length - 300).forEach((k) => delete seen[k]);
      localStorage.setItem(SEEN_PREFIX + userId(), JSON.stringify(seen));
    } catch { /* private mode - fine */ }
  }

  function readHidden() {
    try { return new Set(JSON.parse(sessionStorage.getItem(HIDDEN_KEY) || '[]')); } catch { return new Set(); }
  }
  function hideForSession(items) {
    try {
      const hidden = readHidden();
      items.forEach((i) => hidden.add(itemKey(i)));
      sessionStorage.setItem(HIDDEN_KEY, JSON.stringify([...hidden]));
    } catch { /* ignore */ }
  }

  /* ------------------------------- ticker ------------------------------ */
  function buildTickerEl(items, { closable = true, onClose } = {}) {
    const sorted = [...items].sort(bySeverity);
    const top = sorted[0];
    const m = meta(top.type);
    const bar = document.createElement('div');
    bar.className = `ann-ticker ann-t-${top.type}`;
    bar.setAttribute('role', 'region');
    bar.setAttribute('aria-label', 'Announcements');

    const itemsHtml = sorted.map((i) =>
      `<span class="ann-item ann-t-${esc(i.type)}"><i class="ann-item-dot"></i><b>${esc(i.title)}</b><span class="ann-msg">${esc(oneLine(i.message))}</span></span>`).join('');

    bar.innerHTML = `
      <div class="ann-ticker-badge">${m.icon}<span>${esc(sorted.length > 1 ? `${m.label} (${sorted.length})` : m.label)}</span></div>
      <div class="ann-ticker-viewport" tabindex="0"><div class="ann-ticker-track"><div class="ann-ticker-group">${itemsHtml}</div></div></div>
      ${closable ? `<button type="button" class="ann-ticker-close" aria-label="Hide announcements" title="Hide for now">${CLOSE_ICON}</button>` : ''}`;

    bar.querySelector('.ann-ticker-close')?.addEventListener('click', () => {
      bar.remove();
      if (onClose) onClose();
    });
    return bar;
  }

  /** Must be called AFTER the bar is in the DOM (it measures widths). Safe to call again on resize. */
  function startMarquee(bar) {
    const viewport = bar.querySelector('.ann-ticker-viewport');
    const track = bar.querySelector('.ann-ticker-track');
    const group = track && track.querySelector('.ann-ticker-group:not([aria-hidden])');
    if (!viewport || !group) return;

    if (!group.dataset.base) group.dataset.base = group.innerHTML;
    const base = group.dataset.base;
    track.querySelectorAll('.ann-ticker-group[aria-hidden]').forEach((g) => g.remove());
    group.innerHTML = base;

    const vw = viewport.clientWidth;
    let gw = group.offsetWidth;
    if (!vw || !gw) return;

    // Repeat the content until one group is wider than the bar, so there is never a visible gap.
    const reps = Math.max(1, Math.ceil(vw / gw));
    if (reps > 1) { group.innerHTML = base.repeat(reps); gw = group.offsetWidth; }

    const clone = group.cloneNode(true);
    clone.setAttribute('aria-hidden', 'true');
    track.appendChild(clone);
    track.style.setProperty('--ann-dur', `${Math.max(gw / SPEED, 8)}s`);
  }

  async function findAnchor() {
    const onSales = currentPage() === 'sales';
    for (let n = 0; n < 50; n += 1) {
      const pos = document.querySelector('.pz-topbar');
      if (pos) return pos;
      if (!onSales) {
        const bar = document.querySelector('.main-area > .topbar');
        if (bar) return bar;
      }
      await sleep(100);
    }
    return document.querySelector('.main-area > .topbar') || document.getElementById('page-content');
  }

  let tickerEl = null;
  let tickerSig = '';

  async function applyTicker(all) {
    const hidden = readHidden();
    const items = all.filter((i) => !hidden.has(itemKey(i)));
    const sig = items.map(itemKey).sort().join('|');

    if (!items.length) {
      tickerEl?.remove();
      tickerEl = null;
      tickerSig = '';
      return;
    }
    if (sig === tickerSig && tickerEl && document.body.contains(tickerEl)) return;

    const anchor = await findAnchor();
    if (!anchor) return;
    tickerEl?.remove();
    const bar = buildTickerEl(items, {
      onClose: () => { hideForSession(items); tickerEl = null; tickerSig = ''; },
    });
    anchor.insertAdjacentElement(anchor.id === 'page-content' ? 'beforebegin' : 'afterend', bar);
    tickerEl = bar;
    tickerSig = sig;
    startMarquee(bar);
    // fonts can change the measured width after first paint
    if (document.fonts?.ready) document.fonts.ready.then(() => { if (document.body.contains(bar)) startMarquee(bar); });
  }

  /* ------------------------------- modal ------------------------------- */
  /**
   * Shows announcements one after another in a pop-up. Resolves when the last is closed.
   * opts.onSeen(item) fires as each one is acknowledged; opts.preview skips that (admin preview).
   */
  function showModalQueue(items, { onSeen, preview = false } = {}) {
    const queue = [...items].sort(bySeverity);
    if (!queue.length) return Promise.resolve();

    return new Promise((resolve) => {
      let i = 0;
      const backdrop = document.createElement('div');
      backdrop.className = 'modal-backdrop ann-backdrop';
      document.body.appendChild(backdrop);
      const prevOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      const prevFocus = document.activeElement;

      const dismissible = () => queue[i].type !== 'CRITICAL'; // critical ones need an explicit click

      function finish() {
        document.removeEventListener('keydown', onKey, true);
        backdrop.classList.add('leaving');
        setTimeout(() => backdrop.remove(), 180);
        document.body.style.overflow = prevOverflow;
        if (prevFocus && prevFocus.focus) prevFocus.focus();
        resolve();
      }
      function next() {
        if (!preview && onSeen) onSeen(queue[i]);
        if (i < queue.length - 1) { i += 1; render(); } else finish();
      }
      function onKey(e) {
        if (e.key === 'Escape' && dismissible()) { e.stopPropagation(); next(); }
        else if (e.key === 'Tab') { e.preventDefault(); backdrop.querySelector('.ann-ok')?.focus(); }
      }
      function render() {
        const it = queue[i];
        const m = meta(it.type);
        const last = i === queue.length - 1;
        backdrop.innerHTML = `
          <div class="ann-modal ann-t-${esc(it.type)}" role="dialog" aria-modal="true" aria-labelledby="ann-modal-title">
            <div class="ann-modal-hero">
              <div class="ann-modal-icon">${m.icon}</div>
              <div class="ann-modal-kicker">${esc(m.label)}</div>
              <h2 class="ann-modal-title" id="ann-modal-title">${esc(it.title)}</h2>
            </div>
            <div class="ann-modal-body">${multiline(it.message)}</div>
            <div class="ann-modal-foot">
              <span class="ann-modal-count">${queue.length > 1 ? `${i + 1} of ${queue.length}` : ''}</span>
              <button type="button" class="btn btn-primary ann-ok">${last ? 'Got it' : 'Next'}</button>
            </div>
          </div>`;
        const ok = backdrop.querySelector('.ann-ok');
        ok.addEventListener('click', next);
        ok.focus();
      }

      backdrop.addEventListener('click', (e) => { if (e.target === backdrop && dismissible()) next(); });
      document.addEventListener('keydown', onKey, true);
      render();
    });
  }

  let modalOpen = false;
  const shownThisLoad = new Set();

  function applyModals(items) {
    if (modalOpen) return;
    const pending = items.filter((i) => (i.frequency === 'EVERY_VISIT' ? !shownThisLoad.has(itemKey(i)) : !isSeen(i)));
    if (!pending.length) return;
    modalOpen = true;
    pending.forEach((i) => shownThisLoad.add(itemKey(i)));
    // small pause so the page paints first and the pop-up feels intentional
    setTimeout(() => {
      showModalQueue(pending, { onSeen: markSeen }).finally(() => { modalOpen = false; });
    }, 450);
  }

  /* ------------------------------ lifecycle ----------------------------- */
  let started = false;
  let expiryTimer = null;
  let lastRun = 0;

  function currentPage() { return (document.body.dataset.page || '').trim(); }

  async function refresh() {
    const page = currentPage();
    if (!page) return;
    lastRun = Date.now();
    let items;
    try {
      const { data } = await window.Api.get('/announcements/active', { page });
      items = data.items || [];
    } catch { return; } // never let announcements break a page
    await ensureStyles();
    applyTicker(items.filter((i) => i.display === 'TICKER'));
    applyModals(items.filter((i) => i.display === 'MODAL'));
    scheduleExpiry(items);
  }

  /** Re-check right when the soonest announcement ends so the bar disappears on time. */
  function scheduleExpiry(items) {
    clearTimeout(expiryTimer);
    const ends = items.map((i) => (i.endsAt ? new Date(i.endsAt).getTime() : 0)).filter((t) => t > Date.now());
    if (!ends.length) return;
    expiryTimer = setTimeout(refresh, Math.min(Math.min(...ends) - Date.now() + 1500, 6 * 3600 * 1000));
  }

  function start() {
    if (started) return;
    const user = window.AppShell?.getUser?.();
    if (!user || user.role === 'SUPER_ADMIN') return;
    if (!window.Api || !window.Storage?.isAuthenticated?.()) return;
    started = true;

    refresh();
    setInterval(() => { if (!document.hidden) refresh(); }, POLL_MS);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && Date.now() - lastRun > 60000) refresh();
    });
    window.addEventListener('resize', window.UI.debounce(() => {
      document.querySelectorAll('.ann-ticker').forEach(startMarquee);
    }, 250));
  }

  window.Announcements = { start, refresh, buildTickerEl, startMarquee, showModalQueue, TYPE_META };

  // Tenant pages have AppShell (admin pages do not, so they never auto-start).
  if (window.AppShell) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
  }
})(window);