/**
 * billing-banner.js - slim banner under the app bar on every tenant page except Billing itself:
 * locked / overdue (not dismissible) and trial countdown (dismissible per session).
 * Loaded automatically by app-shell.js, and by hardware/index.html (the hardware workspace has its own shell:
 * there the banner sits under .hw-top and a LOCKED account also gets a full-page "Pay now" lock over the work area).
 * Never throws: billing problems must not break a page.
 */
(function (window) {
  'use strict';
  const esc = (s) => window.UI.escapeHtml(s == null ? '' : String(s));
  // Amounts are in the business's own billing currency (KES or TZS); /billing/status returns it as s.currency.
  const money = (c, currency) => window.UI.formatMoney((Number(c) || 0) / 100, currency || 'KES');
  const POLL_MS = 5 * 60 * 1000;
  const DISMISS_KEY = 'sixstar.billing.trialDismissed';
  let el = null;
  let started = false;
  // Hardware workspace lives in /hardware/ and has no AppShell: links must point at the root and the bar is .hw-top.
  const IN_HW = /\/hardware(\/|$)/.test(window.location.pathname);
  const ROOT = IN_HW ? '../' : '';
  const HW_CSS = `.hw-bl-banner{display:flex;align-items:center;gap:12px;padding:10px 22px;margin:0;border-radius:18px;font:600 14px 'Plus Jakarta Sans',system-ui,sans-serif}
.hw-bl-banner .grow{flex:1;min-width:0}.hw-bl-banner a{font-weight:800;text-decoration:underline;color:inherit;white-space:nowrap}
.hw-bl-banner button{background:none;border:0;cursor:pointer;color:inherit;font-size:20px;line-height:1;opacity:.7}.hw-bl-banner button:hover{opacity:1}
.hw-bl-banner.bl-banner-danger{background:#e5484d;color:#fff}.hw-bl-banner.bl-banner-warning{background:#fff4de;color:#92400e}
.hw-bl-banner.bl-banner-info{background:#d4ee5a;color:#1d1c35}
.hw-bl-lock{position:fixed;inset:0;z-index:90;background:rgba(29,28,53,.82);display:flex;align-items:center;justify-content:center;padding:20px;font-family:'Plus Jakarta Sans',system-ui,sans-serif}
.hw-bl-lock>div{background:#fff;border-radius:24px;border-top:8px solid #d4ee5a;max-width:460px;width:100%;padding:28px;text-align:center;color:#16162a;box-shadow:0 24px 70px rgba(0,0,0,.4)}
.hw-bl-lock h2{margin:0 0 8px;font-size:24px;font-weight:800}.hw-bl-lock p{margin:0 0 18px;color:#5b6070;line-height:1.5}
.hw-bl-lock .b{display:inline-block;background:#d4ee5a;color:#1d1c35;font-weight:800;border-radius:12px;padding:13px 26px;text-decoration:none;border:1px solid #c3e03a}
.hw-bl-lock .o{display:block;margin-top:14px;color:#757a88;cursor:pointer;font-weight:600;background:none;border:0;width:100%}`;

  const dismissed = (v) => { try { return sessionStorage.getItem(DISMISS_KEY) === v; } catch { return false; } };

  function model(s) {
    if (!s || !s.enabled || !s.hasSubscription) return null;
    const canPay = s.arrearsCents !== undefined; // amounts are only sent to owners / billing users
    if (s.locked) {
      return {
        tone: 'danger', sticky: true,
        text: canPay ? 'Your account is locked because of an unpaid balance. Pay now to restore access.'
          : 'This account is locked because of an unpaid balance. Please contact the business owner.',
        link: canPay ? { href: ROOT + 'billing.html', label: 'Pay now' } : null,
      };
    }
    if (canPay && s.arrearsCents > 0) {
      const when = s.lockAt ? ` Your account will be locked on ${window.UI.formatDate(s.lockAt)} if unpaid.` : '';
      return { tone: 'danger', sticky: true, text: `${money(s.arrearsCents, s.currency)} is overdue.${when}`, link: { href: ROOT + 'billing.html', label: 'Pay now' } };
    }
    if (s.status === 'TRIALING' && s.daysLeftInTrial != null) {
      const d = s.daysLeftInTrial;
      return {
        tone: d <= 2 ? 'warning' : 'info', dismissKey: String(d),
        text: `Free trial: ${d} day${d === 1 ? '' : 's'} left.`,
        link: canPay ? { href: ROOT + 'billing.html', label: 'View billing' } : null,
      };
    }
    return null;
  }

  /** Hardware workspace: a locked account cannot work - cover the work area with a Pay now panel (menu + sign out stay usable). */
  function hwLock(s, on) {
    document.getElementById('hw-bl-lock')?.remove();
    if (!on) return;
    const canPay = s.arrearsCents !== undefined;
    const d = document.createElement('div');
    d.id = 'hw-bl-lock'; d.className = 'hw-bl-lock';
    d.innerHTML = `<div><h2>Account locked</h2><p>${canPay ? 'Your subscription has an unpaid balance, so the hardware workspace is locked. Pay now and everything comes straight back - your data is safe.' : 'This account is locked because of an unpaid balance. Please contact the business owner to pay.'}</p>${canPay ? `<a class="b" href="${ROOT}billing.html?locked=1">Pay now</a>` : ''}<button type="button" class="o" id="hw-bl-out">Sign out</button></div>`;
    document.body.appendChild(d);
    d.querySelector('#hw-bl-out').onclick = () => { try { window.Storage.clearSession(); } catch { /* ignore */ } window.location.href = ROOT + 'login.html'; };
  }

  function render(s) {
    el?.remove();
    el = null;
    if (IN_HW) hwLock(s, !!(s && s.enabled && s.hasSubscription && s.locked));
    const m = model(s);
    if (!m || (m.dismissKey && dismissed(m.dismissKey))) return;
    const bar = IN_HW ? document.querySelector('.hw-main > .hw-top') : document.querySelector('.main-area > .topbar');
    if (!bar) return;
    if (IN_HW && !document.getElementById('hw-bl-css')) { const st = document.createElement('style'); st.id = 'hw-bl-css'; st.textContent = HW_CSS; document.head.appendChild(st); }
    const div = document.createElement('div');
    div.className = `${IN_HW ? 'hw-bl-banner ' : ''}bl-banner bl-banner-${m.tone}`;
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

  function currentUser() {
    try { return window.AppShell?.getUser?.() || window.Storage?.getUser?.() || null; } catch { return null; }
  }

  function start() {
    if (started) return;
    const user = currentUser();
    if (!user || user.role === 'SUPER_ADMIN' || !window.Api || !window.Storage?.isAuthenticated?.()) return;
    started = true;
    // The hardware shell is drawn a moment after boot: retry until its top bar exists, then keep polling.
    if (IN_HW) {
      let tries = 0;
      const wait = setInterval(() => { tries++; if (document.querySelector('.hw-main > .hw-top') || tries > 40) { clearInterval(wait); refresh(); } }, 250);
    } else refresh();
    setInterval(() => { if (!document.hidden) refresh(); }, POLL_MS);
    // a locked account must be caught again right after any 402 the workspace receives
    if (IN_HW) window.addEventListener('focus', () => refresh());
  }

  // premium add-on crowns / lock panels (js/core/premium.js) load on every tenant page, even where the banner stays quiet
  try { if (!IN_HW && !window.Premium && !document.getElementById('premium-script')) { const p = document.createElement('script'); p.id = 'premium-script'; p.src = 'js/core/premium.js'; p.async = true; document.head.appendChild(p); } } catch { /* never block the page */ }

  window.BillingBanner = { start, refresh };
  if (window.AppShell || IN_HW) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(start, IN_HW ? 300 : 0));
    else setTimeout(start, IN_HW ? 300 : 0);
  }
})(window);