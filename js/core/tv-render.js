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
    root.innerHTML = '<div class="tvr-stage"><header class="tvr-top"></header><div class="tvr-body"><main class="tvr-main"></main><aside class="tvr-ordpanel" hidden></aside></div><footer class="tvr-foot"></footer><div class="tvr-ann" hidden></div></div><div class="tvr-black" hidden></div>';
    const stage = root.querySelector('.tvr-stage'); const top = root.querySelector('.tvr-top'); const main = root.querySelector('.tvr-main'); const foot = root.querySelector('.tvr-foot');
    const shell = root.querySelector('.tvr-body'); const opanel = root.querySelector('.tvr-ordpanel'); const ann = root.querySelector('.tvr-ann'); const black = root.querySelector('.tvr-black');
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
    // ---------------- live order status ----------------
    const STAGE = { RECEIVED: 'Received', PREPARING: 'Preparing', READY: 'Ready', ON_THE_WAY: 'On the way' };
    const TYPE = { DINE_IN: 'Dine-in', TAKEAWAY: 'Takeaway', DELIVERY: 'Delivery', COUNTER: 'Counter', BAR_TAB: 'Bar', ROOM_SERVICE: 'Room service', PICKUP: 'Pickup' };
    const RANK = { READY: 0, ON_THE_WAY: 0, PREPARING: 1, RECEIVED: 2 };
    let orders = []; let stale = false; let oSig = ''; const prevStage = new Map(); const readyStamp = new Map();
    const lbl = (o) => `order-${o.number}`;   // customers see "order-40", not just "40"
    const isReady = (o) => o.stage === 'READY' || o.stage === 'ON_THE_WAY';
    const readyText = (o) => (o.stage === 'ON_THE_WAY' ? 'On the way' : o.orderType === 'DINE_IN' ? 'Being served' : 'Ready for pickup');
    const stateText = (o, cfg) => (isReady(o) ? readyText(o) : o.stage === 'PREPARING' ? `Preparing${cfg.showTime !== false && o.etaMin ? ` · ~${o.etaMin} min` : ''}` : 'Received');
    const isNew = (o) => isReady(o) && Date.now() - (readyStamp.get(o.id) || 0) < 15000;
    const subText = (o, cfg) => [cfg.showTable !== false && o.table ? o.table : (o.table ? '' : TYPE[o.orderType] || ''), cfg.showCustomer && o.customer].filter(Boolean).join(' · ');
    const pickOrders = (cfg) => { const t = cfg.orderTypes || []; return orders.filter((o) => !t.length || t.includes(o.orderType)); };
    const byTime = (a, b) => new Date(a.sentAt) - new Date(b.sentAt);
    const byReady = (a, b) => new Date(b.readyAt || b.sentAt) - new Date(a.readyAt || a.sentAt);
    const itemsLine = (o, cfg) => (cfg.showItems && o.items && o.items.length ? `<em class="ord-items">${o.items.slice(0, 4).map((i) => `${i.qty > 1 ? E(i.qty) + '× ' : ''}${E(i.name)}`).join(' · ')}${o.items.length > 4 || o.more ? ' …' : ''}</em>` : '');
    const chip = (o, cfg) => `<div class="ord-chip st-${o.stage} ${isNew(o) ? 'is-new' : ''}"><b>${E(lbl(o))}</b><span>${E(subText(o, cfg))}</span><small>${E(stateText(o, cfg))}</small>${itemsLine(o, cfg)}</div>`;
    function boardHtml(list, cfg) {
      const cap = cfg.maxOrders || 12; const rdy = list.filter(isReady).sort(byReady); const prep = list.filter((o) => !isReady(o)).sort(byTime);
      const col = (cls, title, arr, color) => { const shown = arr.slice(0, cap); const cols = shown.length > 5 && !cfg.showItems ? 2 : 1;
        return `<section class="ord-col ${cls}" style="--c:${color}"><h3><i></i>${title}<span class="ord-count">${arr.length}</span></h3><div class="ord-chips" style="--oc:${cols}">${shown.map((o) => chip(o, cfg)).join('') || `<p class="ord-none">${cls === 'ready' ? 'Nothing ready yet' : 'Kitchen is clear'}</p>`}</div>${arr.length > shown.length ? `<div class="ord-more">+${arr.length - shown.length} more</div>` : ''}</section>`; };
      return `<div class="ord-board">${col('prep', 'Preparing', prep, 'var(--tv-accent)')}${col('ready', 'Ready', rdy, '#22C55E')}</div>`;
    }
    function cardsHtml(list, cfg) {
      const cap = cfg.maxOrders || 12; const arr = list.slice().sort((a, b) => (RANK[a.stage] - RANK[b.stage]) || byTime(a, b)); const shown = arr.slice(0, cap); const n = shown.length; const cols = n <= 1 ? 1 : n <= 2 ? 2 : n <= 6 ? 3 : 4;
      const card = (o) => `<article class="ord-card st-${o.stage} ${isNew(o) ? 'is-new' : ''}"><div class="ord-top"><b>${E(lbl(o))}</b><span class="ord-tag">${E(STAGE[o.stage])}</span></div>${subText(o, cfg) ? `<p class="ord-sub">${E(subText(o, cfg))}</p>` : ''}${cfg.showItems && o.items.length ? `<ul>${o.items.slice(0, 3).map((i) => `<li>${i.qty > 1 ? E(i.qty) + '× ' : ''}${E(i.name)}</li>`).join('')}${o.items.length > 3 || o.more ? '<li>…</li>' : ''}</ul>` : ''}
        <div class="ord-bar" style="--p:${Math.max(6, o.progress)}%"><i></i></div><div class="ord-steps"><span class="on">Received</span><span class="${o.stage !== 'RECEIVED' ? 'on' : ''}">Preparing</span><span class="${isReady(o) ? 'on' : ''}">Ready</span></div>${cfg.showTime !== false && !isReady(o) && o.etaMin ? `<div class="ord-time">About ${E(o.etaMin)} min</div>` : ''}</article>`;
      return `<div class="ord-cards" style="--oc:${cols}">${shown.map(card).join('')}</div>${arr.length > n ? `<div class="ord-more">+${arr.length - n} more orders</div>` : ''}`;
    }
    function nowHtml(list, cfg) {
      const cap = cfg.maxOrders || 12; const rdy = list.filter(isReady).sort(byReady).slice(0, cap); const prep = list.filter((o) => !isReady(o)).sort(byTime); const n = rdy.length; const fs = n <= 2 ? 150 : n <= 4 ? 110 : n <= 8 ? 80 : 60;
      return `<div class="ord-now"><section class="ord-nowl"><h3>Now serving</h3><div class="ord-big" style="--fs:${fs}px">${rdy.map((o) => `<div class="ord-bn st-READY ${isNew(o) ? 'is-new' : ''}"><b>${E(lbl(o))}</b><span>${E(subText(o, cfg) || readyText(o))}</span></div>`).join('') || '<p class="ord-none">Your number appears here when your order is ready</p>'}</div></section>
        <section class="ord-nowr"><h3>In the kitchen<span class="ord-count">${prep.length}</span></h3><div class="ord-rows">${prep.slice(0, Math.min(cap, 9)).map((o) => `<div class="ord-row st-${o.stage}"><b>${E(lbl(o))}</b><div class="ord-mini"><i style="width:${Math.max(6, o.progress)}%"></i></div><small>${E(STAGE[o.stage])}</small></div>`).join('') || '<p class="ord-none">Kitchen is clear</p>'}</div></section></div>`;
    }
    function minimalHtml(list, cfg) {
      const arr = list.slice().sort((a, b) => (RANK[a.stage] - RANK[b.stage]) || byTime(a, b)).slice(0, Math.min(cfg.maxOrders || 12, 14));
      return `<div class="ord-min">${arr.map((o) => `<div class="ord-mrow st-${o.stage}"><b>${E(lbl(o))}</b><span>${E(isReady(o) ? readyText(o) : STAGE[o.stage])}</span></div>`).join('')}</div>`;
    }
    function ordersInner(s) {
      const cfg = s.orders || {}; const list = pickOrders(cfg);
      const head = `<div class="tvr-head ord-head"><div><h2>${E(s.title || 'Order status')}</h2><p>${E(s.subtitle || 'Follow your order here')}</p></div><div class="ord-live"><i></i>LIVE${stale ? ' · reconnecting…' : ''}</div></div>`;
      if (!list.length) return `${head}<div class="ord-empty"><div class="ord-ring"></div><h3>No orders in progress</h3><p>Your order will appear here as soon as it is placed.</p></div>`;
      return head + ({ CARDS: cardsHtml, NOW_SERVING: nowHtml, MINIMAL: minimalHtml }[cfg.style] || boardHtml)(list, cfg);
    }
    const ordersSlideHtml = (s) => `<section class="tvr-slide ord-slide" data-ord="${E(s.id)}">${ordersInner(s)}</section>`;
    function panelInner(p) {
      const cap = p.maxOrders || 8; const rdy = orders.filter(isReady).sort(byReady); const prep = orders.filter((o) => !isReady(o)).sort(byTime);
      const grp = (cls, label, arr) => `<div class="ord-pg ${cls}"><h4>${label}<span>${arr.length}</span></h4><div class="ord-pc">${arr.slice(0, cap).map((o) => `<span class="ord-pn st-${o.stage} ${isNew(o) ? 'is-new' : ''}">${E(lbl(o))}</span>`).join('') || '<em>-</em>'}</div></div>`;
      return `<h3 class="ord-ph"><i></i>Orders${stale ? ' <small>reconnecting…</small>' : ''}</h3>${grp('ready', 'Ready', rdy)}${grp('prep', 'Preparing', prep)}`;
    }
    function applyOrdersPanel() {
      const p = c && c.ordersPanel;
      if (!p || !p.enabled || !c.ordersFeed) { opanel.hidden = true; shell.className = 'tvr-body'; opanel.innerHTML = ''; return; }
      opanel.hidden = false; shell.className = `tvr-body pos-${p.position || 'RIGHT'}`; opanel.innerHTML = panelInner(p);
    }
    function paintOrders(force) {
      const sg = JSON.stringify([stale, orders.map((o) => [o.id, o.stage, o.progress, o.elapsedMin, o.etaMin])]);
      if (!force && sg === oSig) return; oSig = sg; if (!c) return;
      main.querySelectorAll('[data-ord]').forEach((el) => { const s = (c.slides || []).find((x) => x.id === el.dataset.ord); if (s) el.innerHTML = ordersInner(s); });
      applyOrdersPanel();
    }
    function setOrders(list) {
      const next = Array.isArray(list) ? list : [];
      next.forEach((o) => { const was = prevStage.get(o.id); if (isReady(o) && was && was !== 'READY' && was !== 'ON_THE_WAY') readyStamp.set(o.id, Date.now()); });
      prevStage.clear(); next.forEach((o) => prevStage.set(o.id, o.stage)); orders = next; paintOrders();
    }
    function setStale(v) { if (stale === !!v) return; stale = !!v; paintOrders(); }

    function slideHtml(s) {
      if (s.type === 'ORDERS') return ordersSlideHtml(s);
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
      if (c.ordersFeed) setOrders(c.orders); else { orders = []; oSig = ''; } applyOrdersPanel();
      const ns = JSON.stringify(c.slides || []);
      if (!c.slides || !c.slides.length) { clearTimeout(rotTimer); sig = ''; idx = -1; empty(c.empty === 'NOT_PUBLISHED' ? 'Menu coming soon' : 'Nothing to show right now'); return; }
      if (ns === sig) return;               // same slides: keep the current slide and timing, no flicker
      const keepId = idx >= 0 && c.slides[idx] ? c.slides[idx].id : null; sig = ns;
      const at = keepId ? c.slides.findIndex((s) => s.id === keepId) : -1; main.innerHTML = ''; show(at >= 0 ? at : 0);
    }
    clockTimer = setInterval(paintTop, 20000);
    function destroy() { destroyed = true; clearTimeout(rotTimer); clearTimeout(annTimer); clearInterval(clockTimer); if (ro) ro.disconnect(); else window.removeEventListener('resize', fit); root.innerHTML = ''; }
    return { setContent, setOrders, setStale, destroy, fit };
  }
  window.TVRender = { create };
})(window);
