/**
 * tv-render.js - draws the Live TV menu board. Used by the real TV page (tv.html) AND by the manager's preview, so what you
 * preview is exactly what the screen shows. Fixed 1920x1080 stage scaled to any screen. All timers are cleaned up by destroy().
 *   const ctrl = TVRender.create(rootEl); ctrl.setContent(content); ctrl.destroy();
 */
(function (window) {
  const E = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const BADGE = { NEW: 'NEW', BESTSELLER: 'BESTSELLER', HOT: 'HOT', SPICY: 'SPICY', VEGAN: 'VEGAN', CHEFS_PICK: "CHEF'S PICK", LIMITED: 'LIMITED TIME' };

  function create(root) {
    root.classList.add('tvr');
    root.innerHTML = '<div class="tvr-stage"><header class="tvr-top"></header><main class="tvr-main"></main><footer class="tvr-foot"></footer><div class="tvr-ann" hidden></div></div><div class="tvr-black" hidden></div>';
    const stage = root.querySelector('.tvr-stage'); const top = root.querySelector('.tvr-top'); const main = root.querySelector('.tvr-main'); const foot = root.querySelector('.tvr-foot');
    const ann = root.querySelector('.tvr-ann'); const black = root.querySelector('.tvr-black');
    let c = null; let idx = -1; let rotTimer = null; let clockTimer = null; let annTimer = null; let sig = ''; let destroyed = false; let ro = null;

    const fit = () => { const s = Math.min(root.clientWidth / 1920, root.clientHeight / 1080) || 1; stage.style.transform = `translate(-50%,-50%) scale(${s})`; };
    if (window.ResizeObserver) { ro = new ResizeObserver(fit); ro.observe(root); } else window.addEventListener('resize', fit);
    fit();

    function money(n) {
      if (n == null || isNaN(n)) return '';
      const cur = (c && c.business && c.business.currency) || 'KES'; const mode = (c && c.currencyDisplay) || 'CODE';
      const whole = Math.abs(n - Math.round(n)) < 0.005 || ['TZS', 'UGX', 'RWF'].includes(cur);
      const num = Number(n).toLocaleString('en-US', { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2 });
      return mode === 'NONE' ? num : `<small>${E(cur)}</small> ${num}`;
    }
    const price = (it) => {
      if (it.price == null) return '';
      return `<div class="tvr-price">${it.originalPrice ? `<s>${money(it.originalPrice)}</s>` : ''}<b>${it.priceFrom ? '<em>from</em> ' : ''}${money(it.price)}</b></div>`;
    };
    const img = (it) => (it.image ? `<img src="${E(it.image)}" alt="" loading="eager" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'tvr-ph',textContent:'${E((it.name || '?').charAt(0).toUpperCase())}'}))">` : `<div class="tvr-ph">${E((it.name || '?').charAt(0).toUpperCase())}</div>`);
    const tags = (it) => `${it.badge ? `<span class="tvr-badge">${E(BADGE[it.badge] || it.badge)}</span>` : ''}${it.discountPercent ? `<span class="tvr-off">-${it.discountPercent}%</span>` : ''}${it.soldOut ? '<span class="tvr-sold">SOLD OUT</span>' : ''}`;
    const card = (it, cls = '') => `<article class="tvr-card ${cls} ${it.soldOut ? 'is-sold' : ''}"><div class="tvr-pic">${img(it)}${tags(it)}</div><div class="tvr-info"><h3>${E(it.name)}</h3>${it.description ? `<p>${E(it.description)}</p>` : ''}${it.promoLabel && !it.discountPercent ? `<span class="tvr-promo">${E(it.promoLabel)}</span>` : ''}${price(it)}</div></article>`;
    const row = (it) => `<div class="tvr-row ${it.soldOut ? 'is-sold' : ''}"><div class="tvr-rn"><h3>${E(it.name)}${it.badge ? ` <span class="tvr-badge sm">${E(BADGE[it.badge] || it.badge)}</span>` : ''}${it.soldOut ? ' <span class="tvr-badge sm dark">SOLD OUT</span>' : ''}</h3>${it.description ? `<p>${E(it.description)}</p>` : ''}</div><i class="tvr-dots"></i>${price(it)}</div>`;

    function itemsHtml(s) {
      const items = s.items || []; const n = items.length;
      const head = (s.title || s.subtitle || s.promo) ? `<div class="tvr-head ${s.promo ? 'promo' : ''}"><div><h2>${E(s.title || '')}</h2>${s.subtitle ? `<p>${E(s.subtitle)}</p>` : ''}</div>${s.promo && s.promo.percentOff ? `<div class="tvr-big">-${s.promo.percentOff}%</div>` : ''}</div>` : '';
      let body;
      const L = s.layout;
      if (L === 'HERO' && n > 1) body = `<div class="tvr-hero"><div class="tvr-herocard">${card(items[0], 'big')}</div><div class="tvr-herolist">${items.slice(1, 7).map(row).join('')}</div></div>`;
      else if (L === 'SPLIT' && n > 1) body = `<div class="tvr-split"><div class="tvr-splitpic">${img(items[0])}${tags(items[0])}<div class="tvr-splitcap"><h3>${E(items[0].name)}</h3>${price(items[0])}</div></div><div class="tvr-herolist">${items.slice(1, 8).map(row).join('')}</div></div>`;
      else if (L === 'LIST') body = `<div class="tvr-list">${items.map(row).join('')}</div>`;
      else if (L === 'COMBO') body = `<div class="tvr-combo" style="--n:${Math.min(n, 4)}">${items.slice(0, 4).map((it) => card(it, 'combo')).join('')}</div>`;
      else { const cols = n <= 1 ? 1 : n <= 2 ? 2 : n <= 4 ? 2 : n <= 6 ? 3 : 4; body = `<div class="tvr-grid" style="--cols:${cols}">${items.map((it) => card(it)).join('')}</div>`; }
      return `<section class="tvr-slide tvr-items ${s.promo ? 'is-promo' : ''}">${head}${body}</section>`;
    }
    function slideHtml(s) {
      if (s.type === 'MEDIA') return `<section class="tvr-slide tvr-media"><img src="${E(s.media.url)}" alt="">${s.title || s.subtitle ? `<div class="tvr-mcap"><h2>${E(s.title || '')}</h2>${s.subtitle ? `<p>${E(s.subtitle)}</p>` : ''}</div>` : ''}</section>`;
      if (s.type === 'TEXT') return `<section class="tvr-slide tvr-text"><h2>${E(s.title || '')}</h2><p>${E(s.text)}</p></section>`;
      if (s.type === 'ROOMS') return `<section class="tvr-slide tvr-items"><div class="tvr-head"><div><h2>${E(s.title || 'Rooms & suites')}</h2>${s.subtitle ? `<p>${E(s.subtitle)}</p>` : ''}</div></div><div class="tvr-grid" style="--cols:${Math.min((s.rooms || []).length, 3) || 1}">${(s.rooms || []).map((r) => `<article class="tvr-card"><div class="tvr-pic">${img(r)}${r.discountPercent ? `<span class="tvr-off">-${r.discountPercent}%</span>` : ''}</div><div class="tvr-info"><h3>${E(r.name)}</h3>${r.description ? `<p>${E(r.description)}</p>` : ''}<div class="tvr-price">${r.originalPerNight ? `<s>${money(r.originalPerNight)}</s>` : ''}<b>${money(r.perNight)} <small>/ night</small></b></div></div></article>`).join('')}</div></section>`;
      return itemsHtml(s);
    }

    function paintTop() {
      if (!c) return; const t = c.theme || {}; const b = c.business || {};
      const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      top.innerHTML = `<div class="tvr-brand">${t.showLogo !== false && b.logo ? `<img src="${E(b.logo)}" alt="">` : ''}<div><b>${E(b.name || '')}</b>${b.tagline ? `<span>${E(b.tagline)}</span>` : ''}</div></div>${t.showClock !== false ? `<div class="tvr-clock">${time}</div>` : ''}`;
    }
    function paintFoot() {
      const t = (c && c.theme) || {};
      if (!c || !c.ticker || t.showTicker === false) { foot.innerHTML = ''; foot.classList.add('off'); return; }
      foot.classList.remove('off'); const txt = E(c.ticker);
      foot.innerHTML = `<div class="tvr-tick"><span>${txt}</span><span>${txt}</span><span>${txt}</span></div>`;
    }
    function applyTheme() {
      const t = (c && c.theme) || {};
      ['primary', 'secondary', 'accent', 'text', 'background'].forEach((k) => { if (t[k]) root.style.setProperty('--tv-' + k, t[k]); });
    }
    function show(i) {
      if (destroyed || !c || !c.slides.length) return;
      idx = ((i % c.slides.length) + c.slides.length) % c.slides.length; const s = c.slides[idx];
      const el = document.createElement('div'); el.className = `tvr-layer in-${(s.transition || 'FADE').toLowerCase()}`; el.innerHTML = slideHtml(s);
      const old = main.querySelector('.tvr-layer:not(.out)');
      main.appendChild(el);
      if (old) { old.classList.add('out'); setTimeout(() => old.remove(), 700); }
      requestAnimationFrame(() => el.classList.add('on'));
      clearTimeout(rotTimer);
      if (c.slides.length > 1) rotTimer = setTimeout(() => show(idx + 1), Math.max(4, s.durationSec || 12) * 1000);
    }
    function paintAnn() {
      clearTimeout(annTimer); const a = c && c.screen && c.screen.announcement;
      if (a && a.text && new Date(a.until) > new Date()) { ann.hidden = false; ann.textContent = a.text; annTimer = setTimeout(paintAnn, 5000); } else ann.hidden = true;
    }
    function empty(msg) { main.innerHTML = `<div class="tvr-layer on"><section class="tvr-slide tvr-text"><h2>${E(msg)}</h2></section></div>`; }

    function setContent(next) {
      c = next; applyTheme(); paintTop(); paintFoot(); paintAnn(); black.hidden = !(c.screen && c.screen.blackout);
      const ns = JSON.stringify(c.slides || []);
      if (!c.slides || !c.slides.length) { clearTimeout(rotTimer); sig = ''; idx = -1; empty(c.empty === 'NOT_PUBLISHED' ? 'Menu coming soon' : 'Nothing to show right now'); return; }
      if (ns === sig) return;               // same slides: keep the current slide and timing, no flicker
      const keepId = idx >= 0 && c.slides[idx] ? c.slides[idx].id : null; sig = ns;
      const at = keepId ? c.slides.findIndex((s) => s.id === keepId) : -1; main.innerHTML = ''; show(at >= 0 ? at : 0);
    }
    clockTimer = setInterval(paintTop, 20000);
    function destroy() { destroyed = true; clearTimeout(rotTimer); clearTimeout(annTimer); clearInterval(clockTimer); if (ro) ro.disconnect(); else window.removeEventListener('resize', fit); root.innerHTML = ''; }
    return { setContent, destroy, fit };
  }
  window.TVRender = { create };
})(window);
