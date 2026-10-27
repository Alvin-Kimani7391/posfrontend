/**
 * premium.js - premium add-on lock screens for every tenant page.
 *  - crown icon on menu links of features the business has not paid for
 *  - locked page: "Upgrade" panel over the blurred page (page stays visible)
 *  - a 402 PREMIUM_REQUIRED from the server opens the same upgrade pop-up
 * Driven by GET /billing/addons: add / remove / re-price a feature in the admin and this updates with no code change.
 * Loaded by billing-banner.js (which app-shell.js loads on every page). Never throws.
 */
(function (window) {
  'use strict';
  if (window.Premium) return;
  const CACHE_KEY = 'sixstar.premium.v1'; const TTL = 45 * 1000;
  const CROWN = '<svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor" aria-hidden="true"><path d="M3 7l4.6 4.1L12 4l4.4 7.1L21 7l-1.8 11H4.8L3 7zm2 13h14v2H5v-2z"/></svg>';
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fileOf = (h) => String(h || '').split('#')[0].split('?')[0].split('/').pop().toLowerCase();
  let data = null; let started = false; let timer = null; let lastModalAt = 0;

  const isTenant = () => { try { const u = window.Storage.getUser(); return !!(u && u.role !== 'SUPER_ADMIN' && window.Storage.getAccessToken()); } catch { return false; } };
  const addons = () => (data && Array.isArray(data.addons) ? data.addons : []);
  const lockedList = () => addons().filter((a) => a.enforced && !a.entitled);
  const lockedByFile = () => { const m = new Map(); lockedList().forEach((a) => (a.pages || []).forEach((p) => m.set(String(p).toLowerCase(), a))); return m; };
  const money = (c, cur) => (window.UI && window.UI.formatMoney ? window.UI.formatMoney((Number(c) || 0) / 100, cur || 'KES') : `${cur || 'KES'} ${((Number(c) || 0) / 100).toLocaleString()}`);
  const per = (a) => (a.billingType === 'ONE_TIME' ? 'one-time' : `/ ${a.intervalMonths === 1 ? 'month' : `${a.intervalMonths} months`}`);

  async function load(force) {
    if (!isTenant()) return null;
    try { if (!force) { const c = JSON.parse(sessionStorage.getItem(CACHE_KEY) || 'null'); if (c && Date.now() - c.at < TTL) { data = c.data; return data; } } } catch { /* ignore */ }
    try { const res = await window.Api.get('/billing/addons'); data = res.data; try { sessionStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), data })); } catch { /* ignore */ } } catch { /* offline: keep what we had */ }
    return data;
  }
  const bust = () => { try { sessionStorage.removeItem(CACHE_KEY); } catch { /* ignore */ } };

  function injectStyles() {
    if (document.getElementById('pm-style')) return;
    const s = document.createElement('style'); s.id = 'pm-style';
    s.textContent = `
      .pm-crown{display:inline-flex;align-items:center;margin-left:auto;padding-left:6px;color:#d9a406;font-size:14px;flex:none}
      .dr-nav .pm-crown{margin-left:6px;padding-left:0}
      .bottom-nav .pm-crown{position:absolute;top:2px;right:6px;margin:0;padding:0;font-size:12px}
      .bottom-nav-item,.bottom-nav a{position:relative}
      #page-content.pm-locked{position:relative}
      #page-content.pm-locked>*:not(.pm-panel){filter:blur(3px);opacity:.5;pointer-events:none;user-select:none}
      body.pm-page-locked #toast-container .toast-error{display:none}
      .pm-panel{position:sticky;top:12px;z-index:30;max-width:560px;margin:8vh auto 16px;background:var(--color-surface,#fff);border:1px solid #f1d27a;border-radius:16px;box-shadow:0 20px 50px rgba(16,24,40,.22);padding:28px 24px;text-align:center}
      .pm-badge{display:inline-flex;align-items:center;justify-content:center;width:56px;height:56px;border-radius:50%;background:linear-gradient(135deg,#fde68a,#f59e0b);color:#7a4b00;font-size:28px;margin-bottom:10px}
      .pm-panel h2,.pm-modal h2{margin:0 0 6px;font-size:1.25rem}
      .pm-panel p,.pm-modal p{margin:0 0 12px;color:var(--color-text-secondary,#667085)}
      .pm-benefits{list-style:none;margin:0 0 14px;padding:0;text-align:left;display:inline-block}
      .pm-benefits li{padding:3px 0 3px 22px;position:relative;font-size:.92rem}
      .pm-benefits li:before{content:"\\2713";position:absolute;left:0;color:#12b76a;font-weight:700}
      .pm-price{font-size:1.5rem;font-weight:800;margin:4px 0 2px}
      .pm-price small{font-size:.8rem;font-weight:500;color:var(--color-text-secondary,#667085)}
      .pm-note{font-size:.82rem;color:var(--color-text-secondary,#667085);margin-top:10px}
      .pm-actions{display:flex;gap:8px;justify-content:center;flex-wrap:wrap;margin-top:10px}
      .pm-pill{display:inline-flex;align-items:center;gap:4px;font-size:.72rem;font-weight:700;color:#7a4b00;background:#fef3c7;border:1px solid #f1d27a;border-radius:999px;padding:2px 8px}`;
    document.head.appendChild(s);
  }

  function decorate() {
    try {
      const map = lockedByFile();
      document.querySelectorAll('#sidebar a[href], .bottom-nav a[href], .bottom-nav [data-href], .dr-nav a[href]').forEach((el) => {
        const a = map.get(fileOf(el.getAttribute('href') || el.dataset.href));
        const has = el.querySelector(':scope > .pm-crown');
        if (!a) { if (has) has.remove(); return; }
        if (has) return;
        el.insertAdjacentHTML('beforeend', `<span class="pm-crown" title="Premium feature - upgrade to unlock" aria-label="Premium">${CROWN}</span>`);
      });
    } catch { /* cosmetic */ }
  }

  const priceBlock = (a) => (a.priceCents == null ? '' : `<div class="pm-price">${esc(money(a.priceCents, a.currency))} <small>${esc(per(a))}</small></div>${a.trialDays ? `<span class="pm-pill">${CROWN} ${a.trialDays}-day free trial</span>` : ''}`);
  function actionsFor(a, manage) {
    if (!manage) return '<p class="pm-note">Ask the business owner to upgrade to use this feature.</p>';
    const label = a.state === 'PENDING_PAYMENT' ? 'Complete payment' : a.trialAvailable ? 'Start free trial' : 'Upgrade now';
    return `<div class="pm-actions"><button type="button" class="btn btn-primary" data-pm-upgrade="${esc(a.key)}">${label}</button><a class="btn btn-secondary" href="billing.html#addons">All premium features</a></div>`;
  }
  const panelHtml = (a) => `<div class="pm-badge">${CROWN}</div><h2>${esc(a.name)} is a premium feature</h2><p>${esc(a.tagline || 'Upgrade to unlock this feature.')}</p>
    ${(a.benefits || []).length ? `<ul class="pm-benefits">${a.benefits.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>` : ''}
    ${priceBlock(a)}${actionsFor(a, !!(data && data.canManage))}<div class="pm-note">Cancel any time. Your data stays safe while the feature is locked.</div>`;
  const bindUpgrade = (root) => root.querySelectorAll('[data-pm-upgrade]').forEach((b) => { if (!b.dataset.bound) { b.dataset.bound = '1'; b.addEventListener('click', () => upgrade(b.dataset.pmUpgrade, b)); } });

  function lockPage() {
    try {
      const host = document.getElementById('page-content'); if (!host) return;
      const a = lockedByFile().get(fileOf(window.location.pathname));
      const panel = host.querySelector(':scope > .pm-panel');
      if (!a) { host.classList.remove('pm-locked'); document.body.classList.remove('pm-page-locked'); if (panel) panel.remove(); return; }
      host.classList.add('pm-locked'); document.body.classList.add('pm-page-locked');
      if (!panel) { const el = document.createElement('div'); el.className = 'pm-panel'; el.setAttribute('role', 'dialog'); el.innerHTML = panelHtml(a); host.prepend(el); bindUpgrade(el); }
    } catch { /* never break the page */ }
  }

  async function upgrade(key, btn) {
    if (btn && window.UI.setButtonLoading) window.UI.setButtonLoading(btn, true, 'Please wait…');
    try {
      const { data: r } = await window.Api.post(`/billing/addons/${encodeURIComponent(key)}/subscribe`, {});
      bust();
      if (r.activated || r.trial || r.free) { window.UI.toast.success(r.trial ? 'Free trial started - enjoy!' : 'Feature unlocked'); setTimeout(() => window.location.reload(), 700); return; }
      window.location.href = `billing.html${r.invoice ? `?pay=${encodeURIComponent(r.invoice.id)}` : ''}#addons`;
    } catch (err) {
      if (btn && window.UI.setButtonLoading) window.UI.setButtonLoading(btn, false);
      window.UI.toast.error(err.message || 'Could not start the upgrade');
    }
  }

  function onPremiumRequired(err) {
    try {
      if (document.body.classList.contains('pm-page-locked') || Date.now() - lastModalAt < 8000) return;
      lastModalAt = Date.now();
      const e0 = err.errors && err.errors[0]; const key = e0 && e0.addonKey;
      load(true).then(() => {
        const a = addons().find((x) => x.key === key) || { key, name: (e0 && e0.name) || 'This feature', tagline: '', benefits: [], priceCents: null };
        const m = window.UI.openModal({ title: 'Premium feature', bodyHtml: `<div class="pm-modal" style="text-align:center">${panelHtml(a)}</div>`, footerHtml: '<button class="btn btn-secondary" data-action="close">Not now</button>' });
        bindUpgrade(m); m.querySelector('[data-action="close"]')?.addEventListener('click', () => window.UI.closeModal());
        paint();
      });
    } catch { /* ignore */ }
  }
  function wrapApi() {
    if (!window.Api || window.Api.__pm) return;
    ['get', 'post', 'put', 'patch', 'delete', 'upload'].forEach((m) => {
      const orig = window.Api[m]; if (typeof orig !== 'function') return;
      window.Api[m] = function wrapped(...args) {
        return orig.apply(window.Api, args).catch((e) => { if (e && e.code === 'PREMIUM_REQUIRED' && !/\/billing\/addons/.test(String(args[0]))) onPremiumRequired(e); throw e; });
      };
    });
    window.Api.__pm = true;
  }

  function paint() { decorate(); lockPage(); }
  const schedule = () => { clearTimeout(timer); timer = setTimeout(paint, 120); };
  async function start() {
    if (started) return; started = true;
    wrapApi();
    if (!isTenant()) return;
    injectStyles(); await load(false); paint();
    const shell = document.getElementById('app-shell');
    if (shell && window.MutationObserver) new MutationObserver(schedule).observe(shell, { childList: true, subtree: true });
    setInterval(() => { load(true).then(paint); }, 5 * 60 * 1000);
  }
  window.Premium = { start, load, refresh: async () => { bust(); await load(true); paint(); }, upgrade, crown: CROWN, state: (key) => addons().find((a) => a.key === key) || null };
  wrapApi();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(start, 250)); else setTimeout(start, 250);
})(window);
