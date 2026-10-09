/**
 * billing-banner.js - slim banner under the app bar on every tenant page except Billing itself:
 * locked / overdue (not dismissible) and trial countdown (dismissible per session).
 * Loaded automatically by app-shell.js. Never throws: billing problems must not break a page.
 */
(function (window) {
  'use strict';
  const esc = (s) => window.UI.escapeHtml(s == null ? '' : String(s));
  const kes = (c) => window.UI.formatMoney((Number(c) || 0) / 100);
  const POLL_MS = 5 * 60 * 1000;
  const DISMISS_KEY = 'sixstar.billing.trialDismissed';
  let el = null;
  let started = false;

  const dismissed = (v) => { try { return sessionStorage.getItem(DISMISS_KEY) === v; } catch { return false; } };

  function model(s) {
    if (!s || !s.enabled || !s.hasSubscription) return null;
    const canPay = s.arrearsCents !== undefined; // amounts are only sent to owners / billing users
    if (s.locked) {
      return {
        tone: 'danger', sticky: true,
        text: canPay ? 'Your account is locked because of an unpaid balance. Pay now to restore access.'
          : 'This account is locked because of an unpaid balance. Please contact the business owner.',
        link: canPay ? { href: 'billing.html', label: 'Pay now' } : null,
      };
    }
    if (canPay && s.arrearsCents > 0) {
      const when = s.lockAt ? ` Your account will be locked on ${window.UI.formatDate(s.lockAt)} if unpaid.` : '';
      return { tone: 'danger', sticky: true, text: `${kes(s.arrearsCents)} is overdue.${when}`, link: { href: 'billing.html', label: 'Pay now' } };
    }
    if (s.status === 'TRIALING' && s.daysLeftInTrial != null) {
      const d = s.daysLeftInTrial;
      return {
        tone: d <= 2 ? 'warning' : 'info', dismissKey: String(d),
        text: `Free trial: ${d} day${d === 1 ? '' : 's'} left.`,
        link: canPay ? { href: 'billing.html', label: 'View billing' } : null,
      };
    }
    return null;
  }

  function render(s) {
    el?.remove();
    el = null;
    const m = model(s);
    if (!m || (m.dismissKey && dismissed(m.dismissKey))) return;
    const bar = document.querySelector('.main-area > .topbar');
    if (!bar) return;
    const div = document.createElement('div');
    div.className = `bl-banner bl-banner-${m.tone}`;
    div.setAttribute('role', 'status');
    div.innerHTML = `<span class="grow">${esc(m.text)}</span>${m.link ? `<a href="${m.link.href}">${esc(m.link.label)}</a>` : ''}${m.sticky ? '' : '<button type="button" aria-label="Dismiss">&times;</button>'}`;
    div.querySelector('button')?.addEventListener('click', () => {
      try { sessionStorage.setItem(DISMISS_KEY, m.dismissKey); } catch { /* ignore */ }
      div.remove();
    });
    bar.insertAdjacentElement('afterend', div);
    el = div;
  }

  async function refresh() {
    if ((document.body.dataset.page || '') === 'billing') return; // the page shows its own alerts
    try {
      const { data } = await window.Api.get('/billing/status');
      render(data);
    } catch { /* never block the page */ }
  }

  function start() {
    if (started) return;
    const user = window.AppShell?.getUser?.();
    if (!user || user.role === 'SUPER_ADMIN' || !window.Api || !window.Storage?.isAuthenticated?.()) return;
    started = true;
    refresh();
    setInterval(() => { if (!document.hidden) refresh(); }, POLL_MS);
  }

  window.BillingBanner = { start, refresh };
  if (window.AppShell) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
  }
})(window);