/**
 * sales-mobile.js  -  phone helpers for the Sales screen.        Loaded by sales.html AFTER sales.js.
 *
 * It does NOT change any selling logic. sales.js still builds the screen and does every sale;
 * this file only adds the few things CSS alone cannot do on a phone (<= 720px wide):
 *
 *   1. Full view on     : the workspace is pinned over the whole screen once per page load
 *                         (the button at the top left still lets the cashier leave it).
 *   2. One "Hold" button: Park + Held sales are merged.
 *                           nothing held  -> "Hold sale"   (parks the cart you are serving)
 *                           something held-> "Held sales"  (opens the manager; it has "Park current cart")
 *   3. Suggestions      : the search results are positioned under the search bar and sized to
 *                         the space left above the on-screen keyboard.
 *   4. Keyboard aware   : the workspace + pop-up sheets follow the visible screen, so the Pay bar,
 *                         the cart and the payment sheet are never hidden behind the keyboard.
 *
 * Desktop / tablets: every function returns early, nothing changes.
 */
(function () {
  'use strict';
  if (!document.body || document.body.dataset.page !== 'sales') return;

  const mq = window.matchMedia('(max-width: 720px)');
  const isPhone = () => mq.matches;
  const $ = (id) => document.getElementById(id);
  const vv = window.visualViewport || null;
  const root = document.documentElement;

  let maxH = 0;          // tallest visible height seen at the current width (= keyboard closed)
  let lastW = 0;
  let focusTries = 0;
  let focusDone = false;
  let ddEl = null;
  let heldEl = null;
  let raf = 0;

  /* ---------------------------------------------------------- viewport ---- */
  function syncViewport() {
    if (!isPhone()) {
      root.style.removeProperty('--pz-vvh');
      root.style.removeProperty('--pz-vvt');
      document.body.classList.remove('pm-kb', 'pm-kb-search');
      return;
    }
    const h = Math.round(vv ? vv.height : window.innerHeight);
    const top = Math.round(vv ? vv.offsetTop : 0);
    const w = Math.round(vv ? vv.width : window.innerWidth);
    if (w !== lastW) { lastW = w; maxH = 0; }             // rotated: forget the old "closed" height
    maxH = Math.max(maxH, h, window.innerHeight);
    root.style.setProperty('--pz-vvh', `${h}px`);
    root.style.setProperty('--pz-vvt', `${top}px`);

    const kb = maxH - h > 120;                             // keyboard (or similar) is eating the screen
    const a = document.activeElement;
    const typingSearch = kb && !!a && a.id === 'pos-search';
    document.body.classList.toggle('pm-kb', kb);
    document.body.classList.toggle('pm-kb-search', typingSearch);
    placeDropdown();
  }

  /* -------------------------------------------------- search suggestions -- */
  function placeDropdown() {
    const dd = $('pz-dd');
    if (!dd) return;
    if (!isPhone()) { dd.style.top = ''; dd.style.maxHeight = ''; return; }
    if (!dd.classList.contains('open')) return;
    const bar = document.querySelector('#pz-root .pz-searchbar');
    if (!bar) return;
    const r = bar.getBoundingClientRect();
    const visTop = vv ? vv.offsetTop : 0;
    const visH = vv ? vv.height : window.innerHeight;
    const top = Math.round(r.bottom + 6);
    const avail = Math.round(visH - (r.bottom - visTop) - 14);
    dd.style.top = `${top}px`;
    dd.style.maxHeight = `${Math.max(180, avail)}px`;
  }

  function watchDropdown() {
    const dd = $('pz-dd');
    if (!dd || dd === ddEl) return;
    ddEl = dd;
    new MutationObserver(placeDropdown).observe(dd, { attributes: true, attributeFilter: ['class'], childList: true });
  }

  /* -------------------------------------------------- Hold / Held button -- */
  function heldCount() {
    const el = document.querySelector('#recall-btn .held-count');
    if (!el || el.style.display === 'none') return 0;
    return parseInt(el.textContent, 10) || 0;
  }

  function paintHold() {
    const btn = $('recall-btn');
    if (!btn) return;
    if (!btn.querySelector('.pm-lbl')) {
      const badge = btn.querySelector('.held-count');
      if (!badge) return;
      btn.innerHTML = '<i class="fa-solid fa-rotate-left pm-ico" aria-hidden="true"></i> <span class="pm-lbl">Held sales</span> ';
      btn.appendChild(badge);   // the SAME node, so sales.js keeps updating its number
    }
    const n = heldCount();
    const hold = isPhone() && n === 0;
    const ico = btn.querySelector('.pm-ico');
    const lbl = btn.querySelector('.pm-lbl');
    const text = hold ? 'Hold sale' : 'Held sales';
    const cls = `fa-solid ${hold ? 'fa-pause' : 'fa-rotate-left'} pm-ico`;
    if (lbl.textContent !== text) lbl.textContent = text;
    if (ico.className !== cls) ico.className = cls;
    const tip = hold ? 'Put this cart on hold and serve the next customer' : 'Held sales: resume, merge or hold the current cart';
    if (btn.title !== tip) btn.title = tip;

    const badge = btn.querySelector('.held-count');
    if (badge && badge !== heldEl) {
      heldEl = badge;
      new MutationObserver(paintHold).observe(badge, { attributes: true, attributeFilter: ['style'], childList: true, characterData: true, subtree: true });
    }
  }

  // Capture phase: when nothing is held, the merged button parks the cart instead of opening the (empty) manager.
  document.addEventListener('click', (e) => {
    if (!isPhone()) return;
    const b = e.target && e.target.closest ? e.target.closest('#recall-btn') : null;
    if (!b || heldCount() > 0) return;
    const park = $('park-btn');
    if (!park) return;
    e.stopPropagation();
    e.preventDefault();
    park.click();
  }, true);

  /* ------------------------------------------------------- small tweaks -- */
  function tweakFields() {
    const q = $('pos-search');
    if (q && !q.dataset.pmPh) q.dataset.pmPh = q.placeholder;                      // remember the desktop text
    if (q && q.dataset.pmPh) {
      const wantPh = isPhone() ? (/warehouse/i.test(q.dataset.pmPh) ? 'Search warehouse stock' : 'Search or scan item') : q.dataset.pmPh;
      if (q.placeholder !== wantPh) q.placeholder = wantPh;
    }
    const d = $('cart-discount-input');
    if (d) {
      const want = isPhone() ? 'Discount' : '0';
      if (d.placeholder !== want) d.placeholder = want;
    }
  }

  function ensureFullView() {
    if (focusDone || !isPhone()) return;
    const r = $('pz-root');
    const btn = $('pz-focus-btn');
    if (!r || !btn) { if (++focusTries < 20) setTimeout(ensureFullView, 250); return; }
    if (!btn.firstElementChild) { if (++focusTries < 20) setTimeout(ensureFullView, 250); return; } // buttons not painted yet
    focusDone = true;
    if (!r.classList.contains('pz-focus')) btn.click();
  }

  /* ------------------------------------------------------------- driver -- */
  function enhance() {
    raf = 0;
    if (!$('pz-root')) return;
    watchDropdown();
    paintHold();
    tweakFields();
    ensureFullView();
    syncViewport();
  }
  function schedule() { if (!raf) raf = requestAnimationFrame(enhance); }

  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
  if (vv) { vv.addEventListener('resize', syncViewport); vv.addEventListener('scroll', syncViewport); }
  window.addEventListener('resize', schedule);
  window.addEventListener('orientationchange', () => setTimeout(schedule, 250));
  document.addEventListener('focusin', () => setTimeout(syncViewport, 60));
  document.addEventListener('focusout', () => setTimeout(syncViewport, 120));
  (mq.addEventListener ? mq.addEventListener.bind(mq, 'change') : mq.addListener.bind(mq))(() => { focusDone = false; focusTries = 0; schedule(); });

  schedule();
})();