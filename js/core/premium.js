/**
 * premium.js - premium add-on lock screens for every tenant page.
 *  - crown icon on menu links of features the business has not paid for
 *  - locked page: a designed "Upgrade" panel shown INSIDE the page area (menu, top bar stay usable); the broken page behind is hidden
 *  - a 402 PREMIUM_REQUIRED from an action on another page shows a small dismissible notice inside that page (never a full-screen pop-up)
 * Driven by GET /billing/addons, cached (stale-while-revalidate) so the panel appears instantly on repeat visits.
 * A feature added / removed / re-priced in the admin shows up here with NO code change. Never throws.
 */
(function (window) {
  'use strict';
  if (window.Premium) return;
  const TTL = 60 * 1000;
  const CROWN = '<svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor" aria-hidden="true"><path d="M3 7l4.6 4.1L12 4l4.4 7.1L21 7l-1.8 11H4.8L3 7zm2 13h14v2H5v-2z"/></svg>';
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fileOf = (h) => String(h || '').split('#')[0].split('?')[0].split('/').pop().toLowerCase();
  let data = null; let started = false; let raf = 0; let noticeAt = 0; let fetching = null;

  const user = () => { try { return window.Storage.getUser(); } catch { return null; } };
  const isTenant = () => { try { const u = user(); return !!(u && u.role !== 'SUPER_ADMIN' && window.Storage.getAccessToken()); } catch { return false; } };
  const cacheKey = () => { const u = user(); return `sixstar.premium.v2.${(u && (u.businessId || u._id || u.id)) || 'x'}`; };
  const readCache = () => { try { return JSON.parse(localStorage.getItem(cacheKey()) || 'null'); } catch { return null; } };
  const writeCache = (d) => { try { localStorage.setItem(cacheKey(), JSON.stringify({ at: Date.now(), data: d })); } catch { /* ignore */ } };
  const addons = () => (data && Array.isArray(data.addons) ? data.addons : []);
  const lockedByFile = () => { const m = new Map(); addons().filter((a) => a.enforced && !a.entitled).forEach((a) => (a.pages || []).forEach((p) => m.set(String(p).toLowerCase(), a))); return m; };
  const money = (c, cur) => (window.UI && window.UI.formatMoney ? window.UI.formatMoney((Number(c) || 0) / 100, cur || 'KES') : `${cur || 'KES'} ${((Number(c) || 0) / 100).toLocaleString()}`);
  const perText = (a) => (a.billingType === 'ONE_TIME' ? 'one-time payment' : `per ${a.intervalMonths === 1 ? 'month' : `${a.intervalMonths} months`}`);

  /** Fetch from the server (single-flight). Cache-first callers use hydrate(). */
  function fetchFresh() {
    if (fetching) return fetching;
    fetching = window.Api.get('/billing/addons').then((res) => { data = res.data; writeCache(data); return data; }).catch(() => data).finally(() => { fetching = null; });
    return fetching;
  }
  function hydrate() {
    const c = readCache();
    if (c && c.data) { data = c.data; if (Date.now() - c.at > TTL) fetchFresh().then(paint); } else fetchFresh().then(paint);
  }
  const bust = () => { try { localStorage.removeItem(cacheKey()); } catch { /* ignore */ } };

  function injectStyles() {
    if (document.getElementById('pm-style')) return;
    const s = document.createElement('style'); s.id = 'pm-style';
    s.textContent = `
.pm-crown{display:inline-flex;align-items:center;margin-left:auto;padding-left:6px;color:#d9a406;font-size:14px;flex:none}
.dr-nav .pm-crown{margin-left:6px;padding-left:0}
.bottom-nav .pm-crown{position:absolute;top:2px;right:6px;margin:0;padding:0;font-size:12px}
.bottom-nav-item,.bottom-nav a{position:relative}
#page-content.pm-locked>*:not(.pm-panel){display:none!important}
body.pm-page-locked #toast-container .toast-error{display:none}
.pm-panel{max-width:860px;margin:var(--space-6,24px) auto;background:var(--color-surface,#fff);border:1px solid var(--color-border,#e5e7eb);border-radius:20px;overflow:hidden;box-shadow:0 12px 32px rgba(16,24,40,.08);animation:pm-in .25s ease-out}
@keyframes pm-in{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
.pm-hero{display:flex;gap:18px;align-items:center;padding:26px 28px;background:linear-gradient(135deg,#fff4cc 0%,#fde29a 55%,#f7c85a 100%);color:#5c3b00}
.pm-badge{flex:none;display:flex;align-items:center;justify-content:center;width:64px;height:64px;border-radius:18px;background:#fff;color:#c98a00;font-size:32px;box-shadow:0 6px 16px rgba(160,100,0,.25)}
.pm-hero .pm-pill{display:inline-flex;align-items:center;gap:5px;font-size:.68rem;font-weight:800;letter-spacing:.08em;text-transform:uppercase;background:rgba(255,255,255,.7);border-radius:999px;padding:3px 10px;margin-bottom:6px}
.pm-hero h2{margin:0 0 4px;font-size:1.4rem;line-height:1.2;color:#3f2800}
.pm-hero p{margin:0;font-size:.95rem;color:#6b4700}
.pm-body{display:grid;grid-template-columns:1.25fr 1fr;gap:24px;padding:26px 28px}
.pm-body h3{margin:0 0 10px;font-size:.8rem;text-transform:uppercase;letter-spacing:.06em;color:var(--color-text-secondary,#667085)}
.pm-benefits{list-style:none;margin:0;padding:0}
.pm-benefits li{position:relative;padding:7px 0 7px 30px;font-size:.95rem;color:var(--color-text,#101828)}
.pm-benefits li:before{content:"\\2713";position:absolute;left:0;top:7px;width:20px;height:20px;border-radius:50%;background:#d1fadf;color:#067647;font-weight:800;font-size:12px;display:flex;align-items:center;justify-content:center}
.pm-buy{background:var(--color-bg,#f9fafb);border:1px solid var(--color-border,#e5e7eb);border-radius:16px;padding:20px;text-align:center;align-self:start}
.pm-amt{font-size:1.9rem;font-weight:800;line-height:1.1;color:var(--color-text,#101828)}
.pm-per{display:block;font-size:.82rem;color:var(--color-text-secondary,#667085);margin-top:2px}
.pm-trial{display:inline-flex;align-items:center;gap:4px;margin-top:10px;font-size:.75rem;font-weight:700;color:#7a4b00;background:#fef3c7;border:1px solid #f1d27a;border-radius:999px;padding:3px 10px}
.pm-buy .btn{width:100%;margin-top:14px;justify-content:center}
.pm-buy .pm-link{display:block;margin-top:10px;font-size:.85rem}
.pm-note{font-size:.8rem;color:var(--color-text-secondary,#667085);margin-top:12px}
.pm-foot{padding:12px 28px;border-top:1px solid var(--color-border,#e5e7eb);font-size:.8rem;color:var(--color-text-secondary,#667085);background:var(--color-bg,#f9fafb)}
@media(max-width:700px){.pm-hero{padding:20px;flex-direction:column;text-align:center}.pm-body{grid-template-columns:1fr;padding:20px}.pm-foot{padding:12px 20px}.pm-panel{margin:var(--space-3,12px) 0;border-radius:16px}}
.pm-notice{display:flex;gap:12px;align-items:center;margin:0 0 var(--space-4,16px);padding:12px 14px;border:1px solid #f1d27a;background:#fffbeb;border-radius:12px;color:#5c3b00;font-size:.9rem}
.pm-notice .pm-ni{flex:none;color:#c98a00;font-size:20px;display:flex}
.pm-notice .grow{flex:1}
.pm-notice button.pm-x{border:0;background:none;font-size:20px;line-height:1;color:#7a4b00;cursor:pointer}`;
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

  function buyBlock(a, manage) {
    const price = a.priceCents == null ? '<span class="pm-per">Contact support for pricing</span>' : `<span class="pm-amt">${esc(money(a.priceCents, a.currency))}</span><span class="pm-per">${esc(perText(a))}</span>`;
    const trial = a.trialDays && a.trialAvailable !== false ? `<span class="pm-trial">${CROWN} ${a.trialDays}-day free trial</span>` : '';
    if (!manage) return `<div class="pm-buy">${price}${trial}<p class="pm-note">Ask the business owner to upgrade to use this feature.</p></div>`;
    const label = a.state === 'PENDING_PAYMENT' ? 'Complete payment' : a.trialAvailable ? 'Start free trial' : 'Upgrade now';
    return `<div class="pm-buy">${price}${trial}<button type="button" class="btn btn-primary" data-pm-upgrade="${esc(a.key)}">${label}</button><a class="pm-link" href="billing.html#addons">See all premium features</a></div>`;
  }
  function panelHtml(a) {
    const manage = !!(data && data.canManage);
    const ben = (a.benefits || []).length ? `<h3>What you get</h3><ul class="pm-benefits">${a.benefits.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>` : '';
    return `<div class="pm-hero"><div class="pm-badge">${CROWN}</div><div><span class="pm-pill">${CROWN} Premium</span><h2>${esc(a.name)}</h2><p>${esc(a.tagline || 'Upgrade to unlock this feature.')}</p></div></div>
      <div class="pm-body"><div>${ben || `<h3>About</h3><p>${esc(a.description || 'This feature is available on a paid upgrade.')}</p>`}</div>${buyBlock(a, manage)}</div>
      <div class="pm-foot">Cancel any time. Your data stays safe while the feature is locked and comes straight back when you upgrade.</div>`;
  }
  const bindUpgrade = (root) => root.querySelectorAll('[data-pm-upgrade]').forEach((b) => { if (!b.dataset.bound) { b.dataset.bound = '1'; b.addEventListener('click', () => upgrade(b.dataset.pmUpgrade, b)); } });

  function lockPage() {
    try {
      const host = document.getElementById('page-content'); if (!host) return;
      const a = lockedByFile().get(fileOf(window.location.pathname));
      const panel = host.querySelector(':scope > .pm-panel');
      if (!a) { host.classList.remove('pm-locked'); document.body.classList.remove('pm-page-locked'); if (panel) panel.remove(); return; }
      host.classList.add('pm-locked'); document.body.classList.add('pm-page-locked');
      if (panel && panel.dataset.key === a.key && panel.dataset.state === a.state) return;
      panel?.remove();
      const el = document.createElement('section'); el.className = 'pm-panel'; el.dataset.key = a.key; el.dataset.state = a.state; el.setAttribute('aria-label', 'Premium feature');
      el.innerHTML = panelHtml(a); host.prepend(el); bindUpgrade(el);
    } catch { /* never break the page */ }
  }

  async function upgrade(key, btn) {
    if (btn && window.UI.setButtonLoading) window.UI.setButtonLoading(btn, true, 'Please wait…');
    try {
      const { data: r } = await window.Api.post(`/billing/addons/${encodeURIComponent(key)}/subscribe`, {});
      bust();
      if (r.activated || r.trial || r.free) { window.UI.toast.success(r.trial ? 'Free trial started - enjoy!' : 'Feature unlocked'); setTimeout(() => window.location.reload(), 600); return; }
      window.location.href = `billing.html${r.invoice ? `?pay=${encodeURIComponent(r.invoice.id)}` : ''}#addons`;
    } catch (err) {
      if (btn && window.UI.setButtonLoading) window.UI.setButtonLoading(btn, false);
      window.UI.toast.error(err.message || 'Could not start the upgrade');
    }
  }

  /** 402 from an action inside a page that is not itself locked: small notice at the top of that page. */
  function onPremiumRequired(err) {
    try {
      if (document.body.classList.contains('pm-page-locked') || Date.now() - noticeAt < 4000) return;
      noticeAt = Date.now();
      const host = document.getElementById('page-content'); if (!host) return;
      const e0 = err.errors && err.errors[0]; const a = addons().find((x) => x.key === (e0 && e0.addonKey));
      const name = (a && a.name) || (e0 && e0.name) || 'This feature';
      host.querySelector(':scope > .pm-notice')?.remove();
      const el = document.createElement('div'); el.className = 'pm-notice'; el.setAttribute('role', 'status');
      const manage = !!(data && data.canManage);
      el.innerHTML = `<span class="pm-ni">${CROWN}</span><div class="grow"><b>${esc(name)}</b> is a premium feature.${manage ? '' : ' Ask the business owner to upgrade.'}</div>${manage ? `<button type="button" class="btn btn-primary btn-sm" data-pm-upgrade="${esc((a && a.key) || (e0 && e0.addonKey) || '')}">Upgrade</button>` : ''}<button type="button" class="pm-x" aria-label="Dismiss">&times;</button>`;
      host.prepend(el); bindUpgrade(el);
      el.querySelector('.pm-x').addEventListener('click', () => el.remove());
      el.scrollIntoView({ block: 'nearest' });
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
  const schedule = () => { if (raf) return; raf = requestAnimationFrame(() => { raf = 0; paint(); }); };

  function start() {
    if (started) return; started = true;
    wrapApi();
    if (!isTenant()) return;
    injectStyles(); hydrate(); paint();
    const shell = document.getElementById('app-shell');
    if (shell && window.MutationObserver) new MutationObserver(schedule).observe(shell, { childList: true, subtree: true });
    setInterval(() => { if (!document.hidden) fetchFresh().then(paint); }, 5 * 60 * 1000);
  }
  window.Premium = { start, refresh: async () => { bust(); await fetchFresh(); paint(); }, upgrade, crown: CROWN, state: (key) => addons().find((a) => a.key === key) || null };
  wrapApi();
  start();
})(window);
