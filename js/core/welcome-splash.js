/**
 * welcome-splash.js
 * The "Welcome, <name>" screen shown right after a successful sign-in.
 *
 *   const page = await WelcomeSplash.play(user, () => HomeRoute.resolve());
 *   window.location.href = page;
 *
 * It does NOT add a fixed delay on top of the login. The animation plays while the app works out
 * where to send the person (the business-profile request). The page opens as soon as BOTH are done:
 * the animation has had its short minimum (MIN_MS) and the destination is known. If the network is
 * slow, the progress line simply waits near the end instead of freezing.
 *
 * Self-contained: injects its own CSS, no extra files. Respects "reduce motion".
 */
(function (window) {
  'use strict';

  const MIN_MS = 1300;     // shortest time the animation stays up (letters finish hopping at ~1.1s)
  const FINISH_MS = 140;   // bar snaps to 100% then we go
  const BRAND = 'Six Star POS';

  const CSS = `
.ws{position:fixed;inset:0;z-index:2147483000;display:grid;grid-template-columns:minmax(0,1fr);place-items:center;overflow:hidden;
  background:#fafafb;color:#14171a;font-family:var(--font-sans,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif);
  -webkit-font-smoothing:antialiased;opacity:0;animation:ws-in .16s ease-out forwards;--ws-o:var(--color-primary,#ff6600)}
.ws::before{content:"";position:absolute;inset:0;
  background:radial-gradient(60% 45% at 50% 50%,color-mix(in srgb,var(--ws-o) 11%,transparent),transparent 70%);opacity:0;animation:ws-fade .7s .05s ease-out forwards}
.ws-box{position:relative;z-index:1;display:flex;flex-direction:column;align-items:center;text-align:center;box-sizing:border-box;width:100%;max-width:640px;padding:0 max(20px,env(safe-area-inset-left)) 0 max(20px,env(safe-area-inset-right))}

.ws-hi{font-size:clamp(15px,4vw,20px);font-weight:500;color:#6b7280;opacity:0;transform:translateY(8px);animation:ws-up .4s .1s cubic-bezier(.2,.8,.2,1) forwards}
.ws-name{margin-top:2px;font-size:clamp(36px,11vw,58px);line-height:1.12;font-weight:750;letter-spacing:-.03em;padding:.04em .02em .12em;overflow:hidden;width:100%;white-space:nowrap}
.ws-name b{display:inline-block;font-weight:inherit}
.ws-name span{display:inline-block;transform:translateY(112%);animation:ws-char .5s cubic-bezier(.2,.85,.25,1) forwards;animation-delay:calc(.18s + var(--i)*26ms)}

/* the brand name: every letter hops up and drops back into place, one after another, then keeps a soft wave going */
.ws-brand{width:100%;margin-top:clamp(18px,4vh,30px);font-size:clamp(22px,7.2vw,42px);font-weight:800;letter-spacing:.16em;text-transform:uppercase;line-height:1.2;white-space:nowrap;padding:.5em 0 .1em}
.ws-brand b{display:inline-block;font-weight:inherit;padding-left:.16em}
.ws-brand span{display:inline-block;opacity:0;animation:ws-hop .62s cubic-bezier(.3,.7,.35,1) both,ws-wave 1.15s ease-in-out infinite;
  animation-delay:calc(.4s + var(--i)*42ms),calc(1.3s + var(--i)*75ms)}
.ws-brand .sp{width:.45em}
.ws-brand .pos{color:var(--ws-o)}
.ws-bar{position:relative;width:132px;height:2px;border-radius:2px;margin-top:clamp(14px,3.5vh,24px);background:rgba(20,23,26,.1);overflow:hidden;opacity:0;animation:ws-fade .3s .5s ease-out forwards}
.ws-bar i{position:absolute;inset:0;background:var(--ws-o);transform-origin:left;transform:scaleX(0);transition:transform 1000ms cubic-bezier(.25,.7,.3,1)}
.ws-bar.go i{transform:scaleX(.88)}
.ws-bar.done i{transform:scaleX(1);transition-duration:${FINISH_MS}ms;transition-timing-function:ease-out}

@keyframes ws-in{to{opacity:1}}
@keyframes ws-fade{to{opacity:1}}
@keyframes ws-up{to{opacity:1;transform:none}}
@keyframes ws-char{to{transform:none}}
@keyframes ws-hop{0%{opacity:0;transform:translateY(.1em)}30%{opacity:1;transform:translateY(-.42em)}62%{opacity:1;transform:translateY(.07em)}82%{transform:translateY(-.06em)}100%{opacity:1;transform:none}}
@keyframes ws-wave{0%,50%,100%{transform:none}25%{transform:translateY(-.16em)}}

@media (max-height:430px){
  .ws-name{font-size:clamp(28px,13vh,42px)}
  .ws-brand{font-size:clamp(18px,9vh,30px);margin-top:10px}
  .ws-bar{margin-top:10px}
}
@media (prefers-reduced-motion:reduce){
  .ws,.ws::before,.ws-hi,.ws-name span,.ws-brand span,.ws-bar{animation:none!important;opacity:1!important;transform:none!important}
  .ws-bar i{transition-duration:.01s!important}
}
`;

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function firstName(user) {
    const n = String((user && (user.firstName || user.name)) || '').trim().split(/\s+/)[0] || '';
    return n.length > 16 ? n.slice(0, 15) + '…' : n;
  }

  function injectCss() {
    if (document.getElementById('ws-css')) return;
    const st = document.createElement('style');
    st.id = 'ws-css';
    st.textContent = CSS;
    document.head.appendChild(st);
  }

  /** Shrink the name / brand line so it always fits the screen width (small phones, long names, rotated screens). */
  function fitName(root) {
    root.querySelectorAll('.ws-fit').forEach((el) => {
      el.style.fontSize = '';
      const inner = el.firstElementChild;
      const avail = el.clientWidth;
      const need = inner ? inner.getBoundingClientRect().width : 0;
      if (avail && need > avail) {
        const cur = parseFloat(getComputedStyle(el).fontSize);
        el.style.fontSize = Math.max(16, Math.floor(cur * (avail / need) * 0.98)) + 'px';
      }
    });
  }

  let playing = null;
  let current = null;

  /** Remove the screen and reset, so a page restored from the back button is never stuck on it. */
  function dismiss() {
    if (current && current.parentNode) current.parentNode.removeChild(current);
    current = null; playing = null;
    try { document.documentElement.style.overflow = ''; } catch (e) { /* ignore */ }
  }
  window.addEventListener('pageshow', (e) => { if (e.persisted) dismiss(); });
  window.addEventListener('pagehide', () => { if (current) current.style.display = 'none'; });

  /**
   * @param {object} user         signed-in user (uses first name)
   * @param {Function|Promise|string} dest  where to go: a function returning a Promise<string>, a Promise, or a page name
   * @returns {Promise<string>}   the page to open (resolves when the intro and the lookup are both finished)
   */
  function play(user, dest) {
    if (playing) return playing;
    const start = Date.now();
    const lookup = Promise.resolve(typeof dest === 'function' ? dest() : dest)
      .then((p) => p || 'dashboard.html')
      .catch(() => 'dashboard.html');

    let root;
    try {
      injectCss();
      const name = firstName(user);
      const chars = '<b>' + Array.from(name).map((ch, i) =>
        `<span style="--i:${i}">${ch === ' ' ? '&nbsp;' : esc(ch)}</span>`).join('') + '</b>';
      root = document.createElement('div');
      root.className = 'ws';
      root.setAttribute('role', 'status');
      root.setAttribute('aria-live', 'polite');
      root.setAttribute('aria-label', name ? `Welcome, ${name}` : 'Welcome back');
      const words = BRAND.split(' ');
      let li = 0;
      const brand = '<b>' + words.map((w, wi) => {
        const cls = wi === words.length - 1 ? ' class="pos"' : '';
        return Array.from(w).map((ch) => `<span${cls} style="--i:${li++}">${esc(ch)}</span>`).join('') +
          (wi < words.length - 1 ? `<span class="sp" style="--i:${li++}">&nbsp;</span>` : '');
      }).join('') + '</b>';
      root.innerHTML = `<div class="ws-box">
        <div class="ws-hi">${name ? 'Welcome,' : 'Welcome back'}</div>
        ${name ? `<div class="ws-name ws-fit" aria-hidden="true">${chars}</div>` : ''}
        <div class="ws-brand ws-fit" aria-hidden="true">${brand}</div>
        <div class="ws-bar"><i></i></div></div>`;
      document.body.appendChild(root);
      current = root;
      document.documentElement.style.overflow = 'hidden';
      fitName(root);
      window.addEventListener('resize', () => fitName(root));
      // kick the progress line on the next frame so the transition runs
      const bar = root.querySelector('.ws-bar');
      requestAnimationFrame(() => requestAnimationFrame(() => bar.classList.add('go')));

      // Warm the destination while the animation plays so the dashboard opens faster.
      lookup.then((page) => {
        try {
          const l = document.createElement('link');
          l.rel = 'prefetch'; l.href = page; l.as = 'document';
          document.head.appendChild(l);
        } catch { /* ignore */ }
      });
    } catch (e) {
      // Never let a cosmetic screen block signing in.
      return lookup;
    }

    playing = lookup.then((page) => {
      const wait = Math.max(0, MIN_MS - (Date.now() - start));
      return new Promise((res) => setTimeout(res, wait)).then(() => {
        const bar = root.querySelector('.ws-bar');
        if (bar) bar.classList.add('done');
        return new Promise((res) => setTimeout(() => res(page), FINISH_MS));
      });
    });
    return playing;
  }

  window.WelcomeSplash = { play, dismiss };
})(window);