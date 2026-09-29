/**
 * sidebar-rail.js
 * Desktop-only sidebar toggle: full width <-> compact icon rail.
 * - Adds a "Collapse / Expand" button at the bottom of the sidebar.
 * - Remembers the choice (localStorage).
 * - On the Sales page the first visit starts compact so the POS gets the
 *   room; afterwards it follows whatever the user last chose.
 * - Mobile is untouched (the slide-in drawer keeps working as before).
 * It does not modify app-shell.js: it waits for the shell to render the
 * sidebar, then decorates it.
 */
(function () {
  const KEY = 'pos.sidebar.rail';

  function readPref() {
    try {
      const v = localStorage.getItem(KEY);
      if (v === '1') return true;
      if (v === '0') return false;
    } catch { /* storage blocked */ }
    return document.body.dataset.page === 'sales'; // default
  }
  function savePref(rail) {
    try { localStorage.setItem(KEY, rail ? '1' : '0'); } catch { /* ignore */ }
  }

  function apply(rail) {
    document.body.classList.toggle('sidebar-rail', rail);
    const btn = document.querySelector('.sidebar-rail-toggle');
    if (btn) {
      btn.setAttribute('aria-expanded', String(!rail));
      btn.title = rail ? 'Expand sidebar' : 'Collapse sidebar';
      const label = btn.querySelector('.sidebar-rail-label');
      if (label) label.textContent = rail ? 'Expand' : 'Collapse';
    }
  }

  // Tooltips for icon-only mode
  function decorateLinks(sidebar) {
    sidebar.querySelectorAll('.sidebar-link').forEach((a) => {
      if (!a.title) a.title = a.textContent.replace(/\s+/g, ' ').trim();
    });
  }

  function setup() {
    const sidebar = document.querySelector('.sidebar');
    if (!sidebar) return false;

    if (!sidebar.querySelector('.sidebar-rail-toggle')) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'sidebar-rail-toggle';
      btn.innerHTML =
        '<svg class="sidebar-rail-chevron" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"></polyline></svg>' +
        '<span class="sidebar-rail-label">Collapse</span>';
      btn.addEventListener('click', () => {
        const next = !document.body.classList.contains('sidebar-rail');
        savePref(next);
        apply(next);
      });
      const footer = sidebar.querySelector('.sidebar-footer');
      if (footer) footer.insertBefore(btn, footer.firstChild);
      else sidebar.appendChild(btn);
      apply(readPref());
    }
    decorateLinks(sidebar);
    return true;
  }

  function start() {
    if (setup()) {
      // nav can re-render (permission gating) - keep tooltips fresh
      const nav = document.querySelector('.sidebar-nav') || document.querySelector('.sidebar');
      new MutationObserver(() => setup()).observe(nav, { childList: true, subtree: true });
      return;
    }
    const wait = new MutationObserver(() => {
      if (setup()) {
        wait.disconnect();
        const nav = document.querySelector('.sidebar-nav') || document.querySelector('.sidebar');
        new MutationObserver(() => setup()).observe(nav, { childList: true, subtree: true });
      }
    });
    wait.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();