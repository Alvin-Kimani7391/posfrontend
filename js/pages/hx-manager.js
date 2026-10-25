/**
 * hx-manager.js - owner / manager command centre. ONE call: GET /manager/overview?date=&branchId=
 * Coloured like the restaurant home screen (HX.kpi tiles, hx-tiles). Every section is expandable, every alert opens a list of
 * what is wrong plus a button to the page where it is fixed (or says you have no access). New items show "+N" and play the
 * app's notification sound (respects the Sound setting in the notification bell).
 */
(function () {
  const { E, M, get, can, canAny, feature, icon } = window.HX;
  let el, data = null, tab = 'overview', date = '', ch = '', st = '', q = '', prev = null, fresh = {}, stop;
  const userOpen = new Set(), userClosed = new Set(), rowOpen = new Set();
  const SOUND_KEY = 'pos.notifSound';
  const today = () => new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 10);
  const isToday = () => date === today();
  document.addEventListener('DOMContentLoaded', init);

  /* ---------- where each category lives ---------- */
  const PAGES = {
    orders: { href: 'hx-floor.html', label: 'Tables & orders', ok: () => can('restaurant.orders.view') },
    kitchen: { href: 'hx-kitchen.html', label: 'Kitchen & bar', ok: () => can('restaurant.kitchen.view') },
    reservations: { href: 'hx-reservations.html', label: 'Reservations', ok: () => feature('reservations') && can('restaurant.reservations.view') },
    staff: { href: 'hx-staff.html', label: 'Shifts & tips', ok: () => canAny('restaurant.shifts.view', 'restaurant.shifts.self', 'restaurant.tips.view') },
    payments: { href: 'hx-bills.html', label: 'Bills & payments', ok: () => can('restaurant.bills.view') },
    delivery: { href: 'hx-delivery.html', label: 'Delivery & pickup', ok: () => canAny('restaurant.delivery.view', 'restaurant.delivery.self') },
    qr: { href: 'hx-floor.html', label: 'Tables & orders', ok: () => can('restaurant.orders.view') },
    menu: { href: 'hx-menu.html', label: 'Menu', ok: () => can('restaurant.menu.manage') },
    stock: { href: 'hx-stock.html', label: 'Ingredients & recipes', ok: () => feature('recipeManagement') && can('restaurant.ingredients.view') },
    money: { href: 'hx-cashier.html', label: 'Cashier desk', ok: () => can('cashier.view') },
    loss: { href: 'hx-reports.html', label: 'Reports', ok: () => canAny('restaurant.reports.view', 'accommodation.reports.view') },
  };
  const AREA = { cash: 'money', shifts: 'staff' };
  const TABS = [['overview', 'Overview', 'dashboard'], ['orders', 'Orders', 'receipt'], ['kitchen', 'Kitchen', 'flame'], ['reservations', 'Reservations', 'calendar'], ['staff', 'Staff & shifts', 'clock'], ['payments', 'Payments', 'cash'], ['delivery', 'Delivery & online', 'bike'], ['qr', 'Guest QR', 'table'], ['menu', 'Menu today', 'utensils'], ['stock', 'Stock & expiry', 'box'], ['money', 'Tips & cash box', 'cash'], ['loss', 'Losses', 'pulse']];

  const CSS = `<style>
  .mg-tabs{display:flex;gap:8px;overflow-x:auto;padding:8px 2px 12px;position:sticky;top:0;z-index:5;background:var(--color-bg);scrollbar-width:thin}
  .mg-tabs button{position:relative;border:1px solid var(--color-border);background:var(--color-surface);color:var(--color-text);padding:9px 14px;border-radius:999px;font-weight:700;white-space:nowrap;cursor:pointer;font-family:inherit;font-size:.85rem;display:flex;align-items:center;gap:6px}
  .mg-tabs button.on{background:linear-gradient(145deg,#2f86ff,#1264dc);color:#fff;border-color:transparent;box-shadow:0 6px 14px rgba(21,112,239,.3)}
  .mg-n{font-style:normal;background:#d93636;color:#fff;border-radius:999px;font-size:.7rem;font-weight:800;padding:1px 7px;min-width:18px;text-align:center}
  .mg-new{font-style:normal;background:#179a3c;color:#fff;border-radius:999px;font-size:.7rem;font-weight:800;padding:1px 7px;animation:mgpulse 1.4s infinite}
  @keyframes mgpulse{0%,100%{transform:scale(1)}50%{transform:scale(1.18)}}
  .mg-kw{cursor:pointer}.mg-kw .hx-kpi{height:100%;transition:transform .15s}.mg-kw:hover .hx-kpi{transform:translateY(-2px)}
  .mg-kw .kb{background:#fff;color:#d93636}
  .hx-tile{position:relative;cursor:pointer}
  .mg-tb{position:absolute;right:12px;top:12px;display:flex;gap:4px}
  .mg-box{margin:0 0 12px;padding:0;overflow:hidden}
  .mg-box>summary{list-style:none;cursor:pointer;display:flex;align-items:center;gap:10px;padding:14px 18px;font-weight:800}
  .mg-box>summary::-webkit-details-marker{display:none}
  .mg-box>summary small{font-weight:600;color:var(--color-text-muted)}
  .mg-chev{margin-left:auto;width:9px;height:9px;border-right:2px solid var(--color-text-muted);border-bottom:2px solid var(--color-text-muted);transform:rotate(45deg);transition:transform .15s}
  details[open]>summary .mg-chev{transform:rotate(-135deg)}
  .mg-body{padding:0 12px 14px}
  .mg-wrap{overflow-x:auto}
  .mg-tbl{width:100%;border-collapse:collapse;font-size:.88rem}
  .mg-tbl th{text-align:left;font-size:.7rem;text-transform:uppercase;letter-spacing:.05em;color:var(--color-text-muted);padding:8px 10px;white-space:nowrap}
  .mg-tbl td{padding:10px;border-top:1px solid var(--color-border);vertical-align:top}
  .mg-tbl tr.mg-r{cursor:pointer}.mg-tbl tr.mg-r:hover td{background:var(--color-primary-light,#eef4ff)}
  .mg-tbl tr.mg-hot td{background:var(--st-bg)}
  .mg-tbl tr.mg-more td{background:var(--color-bg);padding:12px 16px}
  .mg-al{border-radius:14px;margin:8px 0;background:var(--st-bg);border-left:5px solid var(--st);overflow:hidden}
  .mg-al>summary{list-style:none;cursor:pointer;display:flex;align-items:center;gap:10px;padding:12px 14px;font-weight:700;color:var(--st)}
  .mg-al>summary::-webkit-details-marker{display:none}
  .mg-al .mg-body{padding:0 14px 12px;color:var(--color-text)}
  .mg-al ul{margin:4px 0 10px;padding-left:18px;font-size:.88rem}
  .mg-acts{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
  .mg-bar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:6px 0 12px}
  .mg-bar input,.mg-bar select{padding:9px 12px;border:1px solid var(--color-border);border-radius:12px;font-family:inherit;background:var(--color-surface);color:var(--color-text)}
  .mg-sec{margin:22px 0 10px;font-weight:800;font-size:1.05rem}
  .mg-sub{color:var(--color-text-muted);font-size:.78rem}
  .mg-noacc{font-size:.8rem;color:var(--color-text-muted);background:var(--color-bg);border:1px dashed var(--color-border);padding:6px 10px;border-radius:10px}
  .mg-stat{display:flex;gap:6px;flex-wrap:wrap}
  @media print{.mg-tabs,.mg-bar,.mg-acts{display:none}details.mg-box>.mg-body{display:block}}
  </style>`;

  async function init() {
    el = window.HX.mount('Manager dashboard');
    if (!el) return;
    el.innerHTML = '<div class="hx-card"><p class="hx-sub">Loading the day…</p></div>';
    await window.AppShell.whenProfileReady?.();
    date = today();
    ['pointerdown', 'keydown', 'touchstart'].forEach((ev) => document.addEventListener(ev, unlock, true));
    stop = window.HX.live(() => { if (isToday()) load(); }, 30000);
    load();
  }

  /* ---------- sound (same setting as the notification bell) ---------- */
  let actx = null;
  const soundOn = () => { try { return localStorage.getItem(SOUND_KEY) !== 'off'; } catch { return true; } };
  const ctx = () => { if (actx) return actx; const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null; try { actx = new AC(); } catch { actx = null; } return actx; };
  function unlock() { const c = ctx(); if (c && c.state === 'suspended') c.resume().catch(() => {}); }
  function beep() {
    if (!soundOn()) return; const c = ctx(); if (!c || c.state !== 'running') return; const t0 = c.currentTime;
    [[880, 0], [1318.5, 0.14], [1046.5, 0.3]].forEach(([f, d]) => { const o = c.createOscillator(), g = c.createGain(); o.type = 'sine'; o.frequency.value = f; g.gain.setValueAtTime(0.0001, t0 + d); g.gain.exponentialRampToValueAtTime(0.35, t0 + d + 0.015); g.gain.exponentialRampToValueAtTime(0.0001, t0 + d + 0.26); o.connect(g); g.connect(c.destination); o.start(t0 + d); o.stop(t0 + d + 0.3); });
  }

  /* ---------- "seen" bookkeeping: badges behave like real notifications ----------
   * A section's badge = items that need attention that you have NOT looked at yet. Opening the section reads 0 and keeps reading 0
   * while you are in it. If the count drops (things were fixed) the baseline drops with it, so anything new counts again.
   * Remembered per branch and day, so a reload does not bring read items back. */
  const seenKey = () => `mg.seen.${window.HX.branchId()}.${date}`;
  const readSeen = () => { try { return JSON.parse(localStorage.getItem(seenKey()) || '{}'); } catch { return {}; } };
  const writeSeen = (o) => { try { localStorage.setItem(seenKey(), JSON.stringify(o)); } catch { /* storage blocked */ } };
  const attnOf = (k) => { const c = prev && prev[k]; return c ? c.attn : 0; };
  const unseen = (k) => Math.max(0, attnOf(k) - (readSeen()[k] || 0));
  function markSeen(k) { fresh[k] = 0; const s = readSeen(); s[k] = attnOf(k); writeSeen(s); }
  function syncSeen() {
    const s = readSeen(); let ch2 = false;
    Object.keys(prev || {}).forEach((k) => { const a = attnOf(k); if (tab === k) { fresh[k] = 0; if (s[k] !== a) { s[k] = a; ch2 = true; } } else if ((s[k] || 0) > a) { s[k] = a; ch2 = true; } });
    if (ch2) writeSeen(s);
  }

  /* ---------- data + "+N" bookkeeping ---------- */
  function cats(d) {
    const g = (o, f) => (o && !o.error && o[f] != null ? o[f] : 0);
    const ks = d.kitchen && d.kitchen.stats || {}, rs = d.reservations && d.reservations.summary || {}, ds = d.delivery && d.delivery.summary || {}, qs = d.qr && d.qr.summary || {}, ss = d.stock && d.stock.summary || {}, ct = d.cashBox && d.cashBox.totals || {};
    const nci = (d.shifts.staff || []).filter((s) => s.notClockedIn).length; const os = d.orders.summary;
    const pu = d.payments && d.payments.unverified ? d.payments.unverified.count : 0;
    const stockN = (ss.expired || 0) + (ss.critical || 0) + (ss.low || 0) + (ss.out || 0) + (ss.negative || 0);
    const cashN = (ct.short < 0 ? 1 : 0) + (ct.shortagesOutstandingCount || 0);
    return {
      orders: { n: os.total, attn: os.carriedOver }, kitchen: { n: (ks.delayedNow || 0) + (ks.readyWaiting || 0), attn: (ks.delayedNow || 0) + (ks.readyWaiting || 0) },
      reservations: { n: (rs.total || 0) + (rs.late || 0), attn: (rs.late || 0) + (rs.needFoodPrep || 0) }, staff: { n: nci, attn: nci }, payments: { n: pu, attn: pu },
      delivery: { n: (ds.total || 0) + (ds.late || 0) + (ds.unpaid || 0), attn: (ds.late || 0) + (ds.unpaid || 0) }, qr: { n: qs.requests || 0, attn: qs.pending || 0 },
      menu: { n: g(d.menu && d.menu.summary, 'soldOut'), attn: 0 }, stock: { n: stockN, attn: stockN }, money: { n: cashN, attn: cashN }, loss: { n: 0, attn: 0 },
    };
  }
  async function load(keepFresh) {
    const d = await get('/manager/overview', { branchId: window.HX.branchId(), date });
    if (d) {
      data = d.overview || d;
      const c = cats(data);
      if (prev && isToday() && keepFresh !== false) {
        let up = false;
        Object.keys(c).forEach((k) => { const delta = c[k].n - (prev[k] ? prev[k].n : 0); if (delta > 0 && !(tab === k)) { fresh[k] = (fresh[k] || 0) + delta; up = true; } });
        if (up) beep();
      }
      prev = c; syncSeen();
      const total = Object.values(fresh).reduce((a, b) => a + b, 0);
      document.title = (total ? `(+${total}) ` : '') + 'Manager dashboard · Kenya POS';
    }
    render();
  }

  /* ---------- small helpers ---------- */
  const t = (d) => (d ? new Date(d).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' }) : '-');
  const dt = (d) => (d ? new Date(d).toLocaleString('en-KE', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '-');
  const mn = (v) => (v == null ? '-' : v + ' min');
  const num = (v) => (v == null ? '-' : Number(v).toLocaleString('en-KE'));
  const m = (v) => (v == null ? '-' : M(v));
  const nice = (s) => String(s || '').replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
  const pill = (text, tone) => window.HX.pill(text, tone || 'mute');
  const TONE = { PAID: 'ok', VERIFIED: 'ok', OK: 'ok', SERVED: 'ok', READY: 'ok', DELIVERED: 'ok', ACCEPTED: 'ok', AVAILABLE: 'ok', CLOSED: 'mute', OPEN: 'busy', COOKING: 'warn', WAITING: 'warn', UNPAID: 'bad', NOT_BILLED: 'mute', PART_PAID: 'warn', AWAITING_CASH: 'warn', PENDING: 'warn', REJECTED: 'bad', CANCELLED: 'mute', FAILED: 'bad', SOLD_OUT: 'bad', EXPIRED: 'bad', CRITICAL: 'warn', WARNING: 'warn', LOW: 'warn', OUT: 'bad', NEGATIVE: 'bad', NO_SHOW: 'bad', CASH_WITH_RIDER: 'warn', OUT_FOR_DELIVERY: 'warn', BOOKED: 'plan', CONFIRMED: 'plan', ARRIVED: 'busy', SEATED: 'busy', COMPLETED: 'ok', ON_DUTY: 'ok', SCHEDULED: 'plan', BREAK: 'warn', ABSENT: 'bad', NEW: 'plan', PREPARING: 'warn', REORDER: 'warn' };
  const P = (s) => pill(s, TONE[s] || 'mute');
  const sec = (s) => (s && s.error ? s.error : null);
  const link = (cat, text) => { const p = PAGES[cat]; if (!p) return ''; return p.ok() ? `<a class="btn btn-secondary" href="${p.href}">${E(text || 'Open ' + p.label)} ›</a>` : `<span class="mg-noacc">You can't open ${E(p.label)} with your current access</span>`; };
  const KP = (label, value, sub, tone, ic, cat) => `<div class="mg-kw" ${cat ? `data-go="${cat}"` : ''}>${window.HX.kpi(label, value, sub, tone, ic, cat && fresh[cat] ? '+' + fresh[cat] : '')}</div>`;
  const kpis = (arr) => `<div class="hx-kpis">${arr.join('')}</div>`;
  function box(id, title, body, o = {}) {
    const open = userOpen.has(id) || (o.open !== false && !userClosed.has(id));
    return `<details class="hx-card mg-box" data-box="${E(id)}" ${open ? 'open' : ''}><summary>${E(title)} ${o.sub ? `<small>${o.sub}</small>` : ''}${o.right || ''}<span class="mg-chev"></span></summary><div class="mg-body">${body}</div></details>`;
  }
  function table(cols, rows, empty, o = {}) {
    if (!rows || !rows.length) return `<p class="hx-sub" style="padding:6px 8px">${E(empty || 'Nothing to show.')}</p>`;
    const body = rows.map((r, i) => {
      const key = o.key ? o.key(r, i) : null; const hot = o.hot ? o.hot(r) : ''; const isOpen = key && rowOpen.has(key);
      return `<tr class="${key ? 'mg-r' : ''} ${hot ? 'mg-hot hx-st-' + hot : ''}" ${key ? `data-row="${E(key)}"` : ''}>${cols.map((c) => `<td>${c[1](r)}</td>`).join('')}</tr>${isOpen && o.detail ? `<tr class="mg-more"><td colspan="${cols.length}">${o.detail(r)}</td></tr>` : ''}`;
    }).join('');
    return `<div class="mg-wrap"><table class="mg-tbl"><thead><tr>${cols.map((c) => `<th>${E(c[0])}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table></div>${o.detail ? '<p class="mg-sub" style="padding:6px 8px">Tap a row for details.</p>' : ''}`;
  }
  const tabBtn = ([k, l, ic]) => { const c = prev && prev[k]; const a = unseen(k); return `<button type="button" data-tab="${k}" class="${tab === k ? 'on' : ''}">${E(l)}${a ? `<i class="mg-n">${a}</i>` : ''}${fresh[k] ? `<i class="mg-new">+${fresh[k]}</i>` : ''}</button>`; };

  /* ---------- render ---------- */
  function render() {
    if (!el) return;
    let h = window.HX.head('Manager dashboard', new Date(date + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' }) + ' · everything in one place',
      `${isToday() ? '<span class="hx-live">Live</span>' : '<span class="hx-live" style="background:#eef0f4;color:#556">Past day</span>'}<button class="btn btn-secondary" id="mg-snd" type="button">Sound: ${soundOn() ? 'on' : 'off'}</button>`);
    h += CSS + `<div class="mg-bar"><label>Date <input type="date" id="mg-date" value="${E(date)}" max="${today()}"></label><button class="btn btn-secondary" id="mg-today" type="button">Today</button><button class="btn btn-secondary" id="mg-refresh" type="button">Refresh</button><button class="btn btn-secondary" id="mg-print" type="button">Print</button>${data ? `<span class="mg-sub">Updated ${t(data.meta.generatedAt)}${isToday() ? ' · refreshes every 30 s' : ''}</span>` : ''}</div>`;
    if (!data) { el.innerHTML = h + '<div class="hx-card"><p class="hx-sub">No data yet. This page needs the new /manager route on the backend, and you must be signed in as owner, admin or manager.</p></div>'; bind(); return; }
    h += `<div class="mg-tabs">${TABS.map(tabBtn).join('')}</div>`;
    h += ({ overview, orders, kitchen, reservations, staff, payments, delivery, qr, menu, stock, money, loss }[tab] || overview)();
    el.innerHTML = h; bind();
  }
  function go(cat) { tab = cat; markSeen(cat); ch = ''; st = ''; q = ''; render(); window.scrollTo(0, 0); }
  function bind() {
    const $ = (s) => el.querySelector(s);
    el.querySelectorAll('[data-tab]').forEach((b) => (b.onclick = (e) => { e.preventDefault(); go(b.dataset.tab); }));
    el.querySelectorAll('[data-go]').forEach((b) => (b.onclick = () => go(b.dataset.go)));
    el.querySelectorAll('[data-goch]').forEach((b) => (b.onclick = () => { tab = 'orders'; markSeen('orders'); ch = b.dataset.goch; st = ''; q = ''; render(); window.scrollTo(0, 0); }));
    el.querySelectorAll('details[data-box]').forEach((d) => d.addEventListener('toggle', () => { const k = d.dataset.box; if (d.open) { userOpen.add(k); userClosed.delete(k); } else { userOpen.delete(k); userClosed.add(k); } }));
    el.querySelectorAll('tr[data-row]').forEach((r) => (r.onclick = (e) => { if (e.target.closest('a,button')) return; const k = r.dataset.row; rowOpen.has(k) ? rowOpen.delete(k) : rowOpen.add(k); const y = window.scrollY; render(); window.scrollTo(0, y); }));
    $('#mg-date').onchange = (e) => { date = e.target.value || date; prev = null; fresh = {}; load(false); };
    $('#mg-today').onclick = () => { date = today(); prev = null; fresh = {}; load(false); };
    $('#mg-refresh').onclick = () => load(); $('#mg-print').onclick = () => window.print();
    $('#mg-snd').onclick = () => { try { localStorage.setItem(SOUND_KEY, soundOn() ? 'off' : 'on'); } catch (e) { /* blocked */ } unlock(); if (soundOn()) beep(); render(); };
    const c = $('#mg-ch'), s = $('#mg-st'), qq = $('#mg-q');
    if (c) c.onchange = () => { ch = c.value; render(); };
    if (s) s.onchange = () => { st = s.value; render(); };
    if (qq) qq.oninput = () => { q = qq.value; const pos = qq.selectionStart; render(); const n = el.querySelector('#mg-q'); n.focus(); n.setSelectionRange(pos, pos); };
  }

  /* ---------- alerts: expandable, with the actual items and a way to fix them ---------- */
  function detailsFor(area) {
    const d = data; const L = [];
    const add = (arr, f, n = 8) => arr.slice(0, n).forEach((x) => L.push(f(x))); const rows = (o, k) => (o && !o.error && o[k]) || [];
    if (area === 'kitchen') add(rows(d.kitchen, 'rows').filter((r) => r.delayed || r.readyWaitMinutes >= 10), (r) => `${r.ticketNumber} · order ${r.orderNumber || '-'} · ${r.station}${r.table ? ' · table ' + r.table : ''} — ${r.delayed ? r.minutes + ' min (limit ' + r.limitMinutes + ')' : 'ready, waiting ' + r.readyWaitMinutes + ' min'}`);
    if (area === 'cash') { add(rows(d.cashBox, 'rows').filter((r) => r.difference < 0), (r) => `${r.cashier}: short ${m(Math.abs(r.difference))} (expected ${m(r.expectedCash)}, counted ${m(r.actualCash)})`); const c = d.cashBox && d.cashBox.totals; if (c && c.shortagesOutstandingCount) L.push(`${c.shortagesOutstandingCount} unpaid cashier shortage(s), ${m(c.shortagesOutstanding)} outstanding`); }
    if (area === 'delivery') add(rows(d.delivery, 'rows').filter((r) => !r.cancelled && (r.late || r.pay === 'UNPAID')), (r) => `${r.orderNumber} · ${r.customer || 'Customer'} · ${nice(r.status)}${r.late ? ' · LATE ' + mn(r.totalMinutes) : ''}${r.pay === 'UNPAID' ? ' · not paid ' + m(r.total) : ''}${r.rider ? ' · rider ' + r.rider : ''}`);
    if (area === 'reservations') add(rows(d.reservations, 'rows').filter((r) => r.late || r.needsFoodPrep), (r) => `${t(r.startsAt)} · ${r.guest} (${r.partySize}) — ${r.late ? 'late ' + r.lateMinutes + ' min' : 'food to start: ' + r.preOrder.join(', ')}`);
    if (area === 'payments') add(rows(d.payments, 'rows').filter((r) => r.verifyStatus === 'PENDING'), (r) => `${t(r.at)} · ${r.bill} · ${nice(r.method)} ${m(r.amount)} · ref ${r.reference || '-'} · received by ${r.receivedBy || '-'}`);
    if (area === 'qr') add(rows(d.qr, 'rows').filter((r) => r.status === 'PENDING'), (r) => `${t(r.at)} · ${r.place} · ${r.items.join(', ')} (${m(r.estimated)})`);
    if (area === 'stock') { add(rows(d.stock, 'expiry').filter((r) => r.bucket !== 'WARNING'), (r) => `${r.name} (batch ${r.batch}) — ${r.bucket === 'EXPIRED' ? 'EXPIRED ' + Math.abs(r.daysLeft) + ' day(s) ago' : 'expires in ' + r.daysLeft + ' day(s)'} · ${r.quantityText}`, 5); add(rows(d.stock, 'ingredients').filter((r) => r.state !== 'OK'), (r) => `${r.name} — ${nice(r.state)} (${r.quantityText})`, 6); }
    if (area === 'shifts') add((d.shifts.staff || []).filter((s) => s.notClockedIn), (s) => `${s.name} (${nice(s.role)}) was due at ${t(s.scheduledStart)}`);
    if (area === 'orders') add(d.orders.rows.filter((r) => r.carriedOver), (r) => `${r.orderNumber} · ${r.channelLabel} · opened ${dt(r.createdAt)} · ${m(r.total)}`);
    if (area === 'menu') add(rows(d.menu, 'rows').filter((r) => r.state === 'SOLD_OUT'), (r) => `${r.name}${r.soldOutReason ? ' — ' + r.soldOutReason : ''}`);
    return L;
  }
  function alertsHtml() {
    if (!data.alerts.length) return '<div class="hx-card"><b>All clear.</b> <span class="hx-sub">Nothing needs your attention right now.</span></div>';
    return data.alerts.map((a, i) => {
      const cat = AREA[a.area] || a.area; const items = detailsFor(a.area); const tone = a.level === 'high' ? 'bad' : a.level === 'warn' ? 'warn' : 'plan';
      const id = 'al:' + a.area + ':' + a.text.replace(/\d+/g, '#');
      const open = userOpen.has(id) || (a.level === 'high' && !userClosed.has(id));
      return `<details class="mg-al hx-st-${tone}" data-box="${E(id)}" ${open ? 'open' : ''}><summary>${E(a.text)}<span class="mg-chev"></span></summary><div class="mg-body">${items.length ? `<ul>${items.map((x) => `<li>${E(x)}</li>`).join('')}</ul>` : '<p class="mg-sub">Open the section to see the details.</p>'}<div class="mg-acts"><button class="btn btn-primary" type="button" data-go="${cat}">See details here</button>${link(cat)}</div></div></details>`;
    }).join('');
  }

  /* ---------- OVERVIEW ---------- */
  function overview() {
    const k = data.kpis; const a = data.accommodation && !data.accommodation.error ? data.accommodation : null; const c = prev || {};
    let h = '<div class="hx-section"><h2>Today at a glance</h2>' + kpis([
      KP('Total sales', m(k.revenue), `${num(k.orders)} orders · avg ${m(k.averageOrderValue)}`, 'blue', 'cash', 'orders'),
      KP('Money collected', m(k.collected), `net of refunds ${m(k.netCollected)}`, 'green', 'receipt', 'payments'),
      KP('Open orders', num(k.openOrders), `${num(k.unpaidOpenOrders)} not yet paid`, 'purple', 'table', 'orders'),
      KP('In the kitchen', num(k.inKitchen), `${num(k.delayedNow)} running late · avg ${k.averagePrepMinutes == null ? '-' : k.averagePrepMinutes + ' min'}`, k.delayedNow ? 'red' : 'amber', 'flame', 'kitchen'),
      KP('Reservations', num(k.reservationsToday), 'bookings today', 'purple', 'calendar', 'reservations'),
      KP('Deliveries on the way', num(k.deliveriesActive), `${num(k.onlineOrders)} online orders`, 'ember', 'bike', 'delivery'),
      KP('Guest QR orders waiting', num(k.qrPending), 'need a waiter to accept', k.qrPending ? 'red' : 'slate', 'table', 'qr'),
      KP('Staff on duty', num(k.staffOnDuty), 'clocked in now', 'slate', 'clock', 'staff'),
      KP('Cash in drawers', m(k.cashInDrawers), `${num(k.openDrawers)} open drawer(s)`, 'green', 'cash', 'money'),
      KP('Tips today', m(k.tips), 'all waiters', 'amber', 'tag', 'money'),
      KP('Losses', m(k.loss), 'waste, voids, shortages', 'red', 'pulse', 'loss'),
      a ? KP('Room occupancy', k.occupancyPercent + '%', `${a.occupied}/${a.rooms} rooms · ${a.reserved} reserved`, 'blue', 'bed', '') : '',
    ]) + '</div>';
    h += `<div class="hx-section"><h2>Needs your attention</h2>${alertsHtml()}</div>`;
    h += `<div class="hx-section"><h2>Jump to a section</h2><div class="hx-tiles">${TABS.filter((x) => x[0] !== 'overview').map(([key, label, ic]) => {
      const cc = c[key] || { attn: 0 }; const sub = tileSub(key);
      return `<a class="hx-tile" data-tab="${key}" href="#"><span class="ic">${icon(ic)}</span><b>${E(label)}</b><small>${sub}</small><span class="mg-tb">${unseen(key) ? `<i class="mg-n">${unseen(key)}</i>` : ''}${fresh[key] ? `<i class="mg-new">+${fresh[key]}</i>` : ''}</span></a>`;
    }).join('')}</div></div>`;
    h += `<div class="hx-section"><h2>Orders by channel <span class="mg-sub">tap one to open its orders</span></h2><div class="hx-kpis">${data.orders.byChannel.filter((r) => r.orders || r.cancelled).map((r) => {
      const T = { DINE_IN: ['blue', 'table'], TAKEAWAY: ['ember', 'receipt'], SELF_SERVICE: ['purple', 'receipt'], ONLINE: ['green', 'bike'], DELIVERY: ['amber', 'bike'], QR_ORDER: ['slate', 'table'], ROOM_SERVICE: ['blue', 'key'], COUNTER: ['red', 'cash'] }[r.key] || ['blue', 'receipt'];
      return `<div class="mg-kw" data-goch="${r.key}">${window.HX.kpi(r.label, num(r.orders), `${m(r.revenue)} · ${num(r.open)} open${r.cancelled ? ' · ' + r.cancelled + ' cancelled' : ''}`, T[0], T[1])}</div>`;
    }).join('') || '<div class="hx-card"><p class="hx-sub">No orders yet.</p></div>'}</div></div>`;
    h += box('ov-staff', 'Who handled the orders', table([['Staff', (r) => `<b>${E(r.name)}</b>`], ['Orders', (r) => num(r.total)], ['Sales', (r) => m(r.revenue)], ['Channels', (r) => Object.entries(r.byChannel).map(([c2, n]) => `${E(nice(c2))} <b>${n}</b>`).join(' · ')]], data.orders.byStaff), { sub: num(data.orders.byStaff.length) + ' people', right: '' });
    return h;
  }
  function tileSub(key) {
    const d = data; const o = d[{ staff: 'shifts' }[key] || key];
    try {
      if (key === 'orders') return `${d.orders.summary.total} orders · ${m(d.orders.summary.revenue)}`;
      if (key === 'kitchen') return o.error ? 'unavailable' : `${o.stats.inKitchen} cooking · ${o.stats.delayedNow} late`;
      if (key === 'reservations') return o.error ? 'unavailable' : `${o.summary.total} bookings · ${o.summary.late} late`;
      if (key === 'staff') return `${d.shifts.staff.length} on the roster`;
      if (key === 'payments') return o.error ? 'unavailable' : `${m(o.totals.collected)} collected`;
      if (key === 'delivery') return o.error ? 'unavailable' : `${o.summary.total} orders · ${o.summary.online} online`;
      if (key === 'qr') return o.error ? 'unavailable' : `${o.summary.requests} requests · ${o.summary.pending} waiting`;
      if (key === 'menu') return o.error ? 'unavailable' : `${o.summary.available} on sale · ${o.summary.soldOut} sold out`;
      if (key === 'stock') return o.error ? 'tracking off' : `${o.summary.expired} expired · ${o.summary.low + o.summary.out} low`;
      if (key === 'money') return `Tips ${m(d.tips.total)}`;
      if (key === 'loss') return o.error ? 'unavailable' : `${m(o.total)} lost`;
    } catch (e) { /* section missing */ }
    return '';
  }
  const head2 = (cat, k) => `<div class="mg-bar"><span class="mg-sub">${E(k || '')}</span><span style="margin-left:auto">${link(cat)}</span></div>`;

  /* ---------- ORDERS ---------- */
  function orders() {
    const rows = data.orders.rows.filter((r) => (!ch || r.channel === ch) && (!st || (st === 'LATE' ? r.kitchen.delayedNow : st === 'UNPAID' ? r.status === 'OPEN' && r.payment.state !== 'PAID' : r.status === st)) && (!q || [r.orderNumber, r.table, r.waiter, r.handledBy, r.customer, r.phone].join(' ').toLowerCase().includes(q.toLowerCase())));
    const s = data.orders.summary;
    let h = head2('orders', 'Every order today, whoever took it') + kpis([KP('Orders', num(s.total), m(s.revenue) + ' sales', 'blue', 'receipt'), KP('Open', num(s.open), 'still being served', 'purple', 'table'), KP('Closed', num(s.closed), 'finished', 'green', 'receipt'), KP('Unpaid open', num(s.unpaidOpen), 'waiting for payment', s.unpaidOpen ? 'ember' : 'slate', 'cash'), KP('From earlier days', num(s.carriedOver), 'still open', s.carriedOver ? 'red' : 'slate', 'clock'), KP('Cancelled', num(s.cancelled), 'today', 'slate', 'wrench')]);
    h += `<div class="mg-bar"><select id="mg-ch"><option value="">All channels</option>${data.orders.byChannel.map((c) => `<option value="${c.key}" ${ch === c.key ? 'selected' : ''}>${E(c.label)}</option>`).join('')}</select><select id="mg-st">${[['', 'Any status'], ['OPEN', 'Open'], ['CLOSED', 'Closed'], ['CANCELLED', 'Cancelled'], ['LATE', 'Late in kitchen'], ['UNPAID', 'Open & unpaid']].map(([v, l]) => `<option value="${v}" ${st === v ? 'selected' : ''}>${l}</option>`).join('')}</select><input id="mg-q" placeholder="Search order, table, staff, customer" value="${E(q)}"></div>`;
    h += box('ord-list', 'Orders', table([
      ['Order', (r) => `<b>${E(r.orderNumber)}</b>${r.carriedOver ? '<br>' + pill('earlier day', 'warn') : ''}<br><span class="mg-sub">${t(r.createdAt)}</span>`],
      ['Channel', (r) => E(r.channelLabel) + (r.table ? `<br><span class="mg-sub">Table ${E(r.table)}</span>` : r.room ? `<br><span class="mg-sub">Room ${E(r.room)}</span>` : r.customer ? `<br><span class="mg-sub">${E(r.customer)}</span>` : '')],
      ['Handled by', (r) => E(r.handledLabel)],
      ['Kitchen', (r) => P(r.kitchen.state) + (r.kitchen.delayedNow ? ' ' + pill('late ' + r.kitchen.elapsedMinutes + 'm', 'bad') : r.kitchen.prepMinutes != null ? `<br><span class="mg-sub">${r.kitchen.prepMinutes} min${r.kitchen.wasLate ? ' (was late)' : ''}</span>` : '')],
      ['Payment', (r) => P(r.payment.state) + (r.payment.methods.length ? `<br><span class="mg-sub">${E(r.payment.methods.map(nice).join(', '))}</span>` : '') + (r.payment.verify === 'PENDING' ? '<br>' + pill('unverified', 'warn') : '')],
      ['Total', (r) => `<b>${m(r.total)}</b><br><span class="mg-sub">paid ${m(r.paid)}</span>`],
      ['Status', (r) => P(r.status)],
    ], rows, 'No orders match.', {
      key: (r) => 'o:' + r.id, hot: (r) => (r.kitchen.delayedNow ? 'bad' : r.carriedOver ? 'warn' : ''),
      detail: (r) => `<div class="mg-stat"><div><b>Items</b><br>${r.items.length ? r.items.map((i) => E(i)).join('<br>') : '-'}</div><div style="margin-left:24px"><b>People</b><br>Waiter: ${E(r.waiter || '-')}<br>Opened by: ${E(r.openedBy || '-')}<br>Guests: ${r.guests}${r.customer ? '<br>Customer: ' + E(r.customer) + ' ' + E(r.phone || '') : ''}</div><div style="margin-left:24px"><b>Money</b><br>Received by: ${E(r.payment.receivedBy || '-')}<br>Approved by: ${E(r.payment.approvedBy || '-')}${r.payment.references.length ? '<br>Ref: ' + E(r.payment.references.join(', ')) : ''}<br>Open for ${mn(r.ageMinutes)}</div>${r.delivery ? `<div style="margin-left:24px"><b>Delivery</b><br>${P(r.delivery.status)}<br>Rider: ${E(r.delivery.rider || '-')}<br>${E(r.delivery.address || '')}</div>` : ''}</div><div class="mg-acts" style="margin-top:10px">${link('orders', 'Open in Tables & orders')}${link('payments', 'Open in Bills & payments')}</div>`,
    }), { sub: num(rows.length) + ' shown' });
    return h;
  }

  /* ---------- KITCHEN ---------- */
  function kitchen() {
    const k = data.kitchen; if (sec(k)) return head2('kitchen') + box('k-err', 'Kitchen', `<p class="hx-sub">Could not load: ${E(sec(k))}</p>`); const s = k.stats;
    let h = head2('kitchen', `A ticket is late after ${k.limitMinutes} min (or the dish's own prep time if longer)`) + kpis([KP('In kitchen', num(s.inKitchen), 'being prepared', 'amber', 'flame'), KP('Running late', num(s.delayedNow), 'over the limit', s.delayedNow ? 'red' : 'slate', 'clock'), KP('Ready, not served', num(s.readyWaiting), 'waiting 10+ min', s.readyWaiting ? 'ember' : 'slate', 'bell'), KP('Finished today', num(s.finishedToday), `${num(s.lateFinished)} were late`, 'green', 'receipt'), KP('Average prep', s.averagePrepMinutes == null ? '-' : s.averagePrepMinutes + ' min', 'order to ready', 'blue', 'pulse')]);
    h += box('k-st', 'Average time per station', table([['Station', (r) => `<b>${E(r.station)}</b>`], ['Tickets', (r) => num(r.tickets)], ['Average', (r) => mn(r.averageMinutes)]], s.byStation));
    h += box('k-tk', 'Tickets (late first)', table([['Ticket', (r) => `<b>${E(r.ticketNumber)}</b><br><span class="mg-sub">Order ${E(r.orderNumber || '')}</span>`], ['Station', (r) => E(r.station)], ['Table / waiter', (r) => E([r.table, r.waiter].filter(Boolean).join(' · ') || '-')], ['Items', (r) => E(r.items.join(', '))], ['Received', (r) => t(r.receivedAt)], ['Time', (r) => `${mn(r.minutes)} <span class="mg-sub">/ ${r.limitMinutes}</span>`], ['State', (r) => P(r.status) + (r.delayed ? ' ' + pill('LATE', 'bad') : r.wasLate ? ' ' + pill('was late', 'warn') : '') + (r.readyWaitMinutes >= 10 ? ' ' + pill('waiting ' + r.readyWaitMinutes + 'm', 'warn') : '')]], k.rows, 'No tickets.', { hot: (r) => (r.delayed ? 'bad' : r.readyWaitMinutes >= 10 ? 'warn' : '') }), { sub: num(k.rows.length) + ' tickets' });
    return h;
  }

  /* ---------- RESERVATIONS ---------- */
  function reservations() {
    const r = data.reservations; if (sec(r)) return head2('reservations') + box('r-err', 'Reservations', `<p class="hx-sub">Could not load: ${E(sec(r))}</p>`); const s = r.summary;
    return head2('reservations', 'Bookings for this day, and whether their food is ready') + kpis([KP('Bookings', num(s.total), num(s.covers) + ' guests expected', 'purple', 'calendar'), KP('Upcoming', num(s.upcoming), 'not arrived yet', 'blue', 'clock'), KP('Arrived / seated', num(s.arrived), 'at the restaurant', 'green', 'table'), KP('Late', num(s.late), 'past booking time', s.late ? 'red' : 'slate', 'bell'), KP('Food to start', num(s.needFoodPrep), 'pre-orders within 45 min', s.needFoodPrep ? 'ember' : 'slate', 'flame'), KP('No-shows', num(s.noShow), 'today', 'slate', 'wrench')]) +
      box('r-list', 'Reservations', table([['Time', (x) => `<b>${t(x.startsAt)}</b>`], ['Guest', (x) => `${E(x.guest)}<br><span class="mg-sub">${E(x.phone)} · ${x.partySize} guests</span>`], ['Status', (x) => P(x.status) + (x.late ? ' ' + pill('late ' + x.lateMinutes + 'm', 'bad') : '')], ['Food', (x) => `${E(x.foodLabel)}${x.needsFoodPrep ? '<br>' + pill('start prep', 'warn') : ''}`], ['Order', (x) => E(x.orderNumber || '-')], ['Deposit', (x) => (x.deposit ? `${m(x.deposit.amount)} ${x.deposit.paid ? pill('paid', 'ok') : pill('unpaid', 'bad')}` : '-')]], r.rows, 'No reservations for this day.', { key: (x) => 'r:' + x.reservationNumber, hot: (x) => (x.late ? 'bad' : x.needsFoodPrep ? 'warn' : ''), detail: (x) => `<b>${E(x.reservationNumber)}</b> · ${E(nice(x.source))}${x.occasion ? ' · ' + E(x.occasion) : ''}<br>Tables: ${x.tableCount || 'not assigned'}<br>${x.preOrder.length ? 'Pre-ordered: ' + E(x.preOrder.join(', ')) : 'No pre-ordered dishes'}` }), { sub: num(r.rows.length) });
  }

  /* ---------- STAFF ---------- */
  function cashTable(rows) {
    return table([['Cashier', (x) => `<b>${E(x.cashier)}</b>`], ['Status', (x) => P(x.status)], ['Opened / closed', (x) => `${t(x.openedAt)} - ${t(x.closedAt)}`], ['Opening', (x) => m(x.openingCash)], ['Cash sales', (x) => m(x.cashSales)], ['Refunds', (x) => m(x.refunds)], ['Expected', (x) => `<b>${m(x.expectedCash)}</b>`], ['Counted', (x) => m(x.actualCash)], ['Difference', (x) => (x.difference == null ? '-' : x.difference < 0 ? pill('short ' + m(Math.abs(x.difference)), 'bad') : x.difference > 0 ? pill('over ' + m(x.difference), 'warn') : pill('balanced', 'ok'))]], rows, 'No cash shifts.', { hot: (x) => (x.difference < 0 ? 'bad' : '') });
  }
  function staff() {
    const s = data.shifts; const on = s.staff.filter((x) => ['ON_DUTY', 'BREAK'].includes(x.status)).length; const late = s.staff.filter((x) => x.notClockedIn).length;
    return head2('staff', 'Who is working, who handled how many orders') + kpis([KP('On duty', num(on), 'clocked in', 'green', 'clock'), KP('Not clocked in', num(late), 'scheduled, late', late ? 'red' : 'slate', 'bell'), KP('Rostered today', num(s.staff.length), 'staff', 'blue', 'calendar'), KP('Open cash drawers', num(s.cash.filter((x) => x.status === 'OPEN').length), 'cashier shifts', 'purple', 'cash')]) +
      box('s-staff', 'Staff shifts', table([['Staff', (x) => `<b>${E(x.name)}</b><br><span class="mg-sub">${E(nice(x.role))}</span>`], ['Status', (x) => P(x.status) + (x.notClockedIn ? ' ' + pill('not clocked in', 'bad') : '')], ['Scheduled', (x) => `${t(x.scheduledStart)} - ${t(x.scheduledEnd)}`], ['Clock in / out', (x) => `${t(x.clockIn)} - ${t(x.clockOut)}`], ['Hours', (x) => (x.hoursOnDuty == null ? '-' : x.hoursOnDuty + ' h')], ['Orders handled', (x) => num(x.ordersHandled)], ['Tips', (x) => m(x.tips)]], s.staff, 'No shifts recorded for this day.', { hot: (x) => (x.notClockedIn ? 'bad' : '') })) +
      box('s-cash', 'Cashier shifts', cashTable(s.cash));
  }

  /* ---------- PAYMENTS ---------- */
  function payments() {
    const p = data.payments; if (sec(p)) return head2('payments') + box('p-err', 'Payments', `<p class="hx-sub">Could not load: ${E(sec(p))}</p>`); const T = p.totals;
    return head2('payments', 'Every payment, who took it and who approved it') + kpis([KP('Collected', m(T.collected), 'cash, mobile money, card, bank', 'green', 'cash'), KP('Refunds', m(T.refunds), 'paid back', T.refunds ? 'red' : 'slate', 'receipt'), KP('Unverified mobile money', num(p.unverified.count), m(p.unverified.amount), p.unverified.count ? 'ember' : 'slate', 'shield'), KP('Charged to rooms', m(T.toRoom), 'on guest folios', 'blue', 'key'), KP('On credit', m(T.onCredit), 'to be paid later', 'amber', 'tag'), KP('Deposits applied', m(T.depositsApplied), 'prepaid', 'purple', 'calendar')]) +
      box('p-m', 'By payment method', table([['Method', (r) => `<b>${E(nice(r[0]))}</b>`], ['Payments', (r) => num(r[1].count)], ['Amount', (r) => m(r[1].amount)]], Object.entries(T.byMethod).filter(([, v]) => v.count))) +
      box('p-r', 'Who received the money', table([['Staff', (r) => `<b>${E(r.name)}</b>`], ['Payments', (r) => num(r.count)], ['Total', (r) => m(r.amount)], ['Cash', (r) => m(r.cash)]], p.byReceiver)) +
      box('p-l', 'Every payment', table([['Time', (r) => t(r.at)], ['Bill / order', (r) => `${E(r.bill)}<br><span class="mg-sub">${E(r.order || '')}${r.table ? ' · T' + E(r.table) : ''}</span>`], ['Method', (r) => E(nice(r.method)) + (r.kind === 'REFUND' ? ' ' + pill('refund', 'bad') : '')], ['Amount', (r) => `<b>${m(r.amount)}</b>`], ['Received by', (r) => E(r.receivedBy || '-')], ['Approved by', (r) => E(r.approvedBy || '-')], ['Check', (r) => (r.verifyStatus ? P(r.verifyStatus) : '-')]], p.rows, 'No payments.', { key: (r, i) => 'p:' + i + r.bill, hot: (r) => (r.verifyStatus === 'PENDING' ? 'warn' : r.verifyStatus === 'REJECTED' ? 'bad' : ''), detail: (r) => `Reference: <b>${E(r.reference || '-')}</b><br>Waiter: ${E(r.waiter || '-')}<br><div class="mg-acts" style="margin-top:8px">${link('payments', 'Open in Bills & payments')}</div>` }), { sub: num(p.rows.length) });
  }

  /* ---------- DELIVERY ---------- */
  function delivery() {
    const d = data.delivery; if (sec(d)) return head2('delivery') + box('d-err', 'Delivery', `<p class="hx-sub">Could not load: ${E(sec(d))}</p>`); const s = d.summary;
    return head2('delivery', 'Online (store page) and phone deliveries: kitchen, rider and payment times') + kpis([KP('Delivery orders', num(s.total), `${num(s.online)} online · ${num(s.byStaff)} by staff`, 'ember', 'bike'), KP('On the way', num(s.active), 'not delivered yet', 'amber', 'truck'), KP('Delivered', num(s.delivered), 'today', 'green', 'receipt'), KP('Late', num(s.late), 'over the promised time', s.late ? 'red' : 'slate', 'clock'), KP('Not paid', num(s.unpaid), m(s.unpaidAmount), s.unpaid ? 'red' : 'slate', 'cash'), KP('Cash with riders', m(s.cashWithRiders), 'to be handed over', 'purple', 'cash'), KP('Avg kitchen time', s.averagePrepMinutes == null ? '-' : s.averagePrepMinutes + ' min', 'to prepare', 'blue', 'flame'), KP('Avg on road', s.averageOnRoadMinutes == null ? '-' : s.averageOnRoadMinutes + ' min', 'rider to door', 'slate', 'bike'), KP('Avg door to door', s.averageTotalMinutes == null ? '-' : s.averageTotalMinutes + ' min', 'order to delivered', 'green', 'clock')]) +
      box('d-r', 'Riders', table([['Rider', (r) => `<b>${E(r.name)}</b>`], ['Orders', (r) => num(r.orders)], ['Delivered', (r) => num(r.delivered)], ['Active', (r) => num(r.active)], ['Avg on road', (r) => mn(r.averageOnRoadMinutes)], ['Cash held', (r) => m(r.cashHeld)]], d.riders)) +
      box('d-l', 'All delivery and online orders', table([['Order', (r) => `<b>${E(r.orderNumber)}</b><br><span class="mg-sub">${t(r.placedAt)}</span>`], ['Source', (r) => (r.online ? pill('online', 'ok') : pill('staff', 'plan'))], ['Customer', (r) => `${E(r.customer || '-')}<br><span class="mg-sub">${E(r.phone || '')}</span>`], ['Rider', (r) => E(r.rider || '-')], ['Status', (r) => P(r.cancelled ? 'CANCELLED' : r.status) + (r.late ? ' ' + pill('late', 'bad') : '')], ['Kitchen', (r) => mn(r.prepMinutes)], ['Total time', (r) => mn(r.totalMinutes)], ['Payment', (r) => P(r.pay) + `<br><span class="mg-sub">${E(nice(r.payMethod))} · ${m(r.total)}</span>`]], d.rows, 'No delivery orders.', { key: (r) => 'd:' + r.orderNumber, hot: (r) => (r.late ? 'bad' : r.pay === 'UNPAID' && !r.cancelled ? 'warn' : ''), detail: (r) => `Address: ${E(r.address || '-')}<br>Kitchen ${mn(r.prepMinutes)} → waited for rider ${mn(r.waitForRiderMinutes)} → on road ${mn(r.onRoadMinutes)} → total ${mn(r.totalMinutes)}<div class="mg-acts" style="margin-top:8px">${link('delivery')}</div>` }), { sub: num(d.rows.length) });
  }

  /* ---------- QR ---------- */
  function qr() {
    const d = data.qr; if (sec(d)) return head2('qr') + box('q-err', 'Guest QR orders', `<p class="hx-sub">Could not load: ${E(sec(d))}</p>`); const s = d.summary;
    return head2('qr', 'Orders guests place themselves after scanning a table or room QR') + kpis([KP('Requests', num(s.requests), `${num(s.table)} table · ${num(s.room)} room`, 'purple', 'table'), KP('Waiting', num(s.pending), 'not accepted yet', s.pending ? 'red' : 'slate', 'bell'), KP('Accepted', num(s.accepted), 'became orders', 'green', 'receipt'), KP('Rejected / expired', num(s.rejected + s.expired), 'not served', 'slate', 'wrench'), KP('Avg response', s.averageResponseMinutes == null ? '-' : s.averageResponseMinutes + ' min', 'to accept', 'blue', 'clock'), KP('QR sales', m(s.revenue), 'today', 'amber', 'cash')]) +
      box('q-l', 'Guest QR orders', table([['Time', (r) => t(r.at)], ['Place', (r) => `<b>${E(r.place)}</b><br><span class="mg-sub">${E(r.guest || '')}</span>`], ['Items', (r) => E(r.items.join(', '))], ['Estimate', (r) => m(r.estimated)], ['Request', (r) => P(r.status) + `<br><span class="mg-sub">${E(r.decidedBy || '')} ${r.respondedInMinutes != null ? r.respondedInMinutes + ' min' : ''}</span>`], ['Order', (r) => E(r.orderNumber || '-') + (r.waiter ? `<br><span class="mg-sub">${E(r.waiter)}</span>` : '')], ['Kitchen', (r) => (r.kitchenState ? P(r.kitchenState) : '-')], ['Payment', (r) => (r.paymentState ? P(r.paymentState) : '-')]], d.rows, 'No guest QR orders today.', { hot: (r) => (r.status === 'PENDING' ? 'warn' : '') }), { sub: num(d.rows.length) });
  }

  /* ---------- MENU ---------- */
  function menu() {
    const d = data.menu; if (sec(d)) return head2('menu') + box('m-err', 'Menu', `<p class="hx-sub">Could not load: ${E(sec(d))}</p>`); const s = d.summary;
    return head2('menu', 'What can be ordered right now') + kpis([KP('Menu items', num(s.total), 'active', 'blue', 'utensils'), KP('On sale now', num(s.available), 'orderable', 'green', 'receipt'), KP('Sold out', num(s.soldOut), 'marked by staff', s.soldOut ? 'red' : 'slate', 'bell'), KP('Outside serving time', num(s.outOfPeriod), 'breakfast / lunch / dinner', 'amber', 'clock'), KP('Promotions on', num(s.promos), 'right now', 'purple', 'tag'), KP('Not sold today', num(s.neverSold), 'no orders yet', 'slate', 'pulse')]) +
      box('m-l', 'Menu for the day', table([['Dish', (r) => `<b>${E(r.name)}</b>${r.promo ? ' ' + pill('promo', 'ok') : ''}`], ['Now', (r) => P(r.state) + (r.soldOutReason ? `<br><span class="mg-sub">${E(r.soldOutReason)}</span>` : '')], ['Price', (r) => m(r.price)], ['Sold today', (r) => num(r.soldToday)], ['Prep', (r) => mn(r.prepMinutes)], ['Station', (r) => E(r.station || '')], ['Served', (r) => E(r.periods.join(' · ') || 'All day')]], d.rows, 'No menu items.', { hot: (r) => (r.state === 'SOLD_OUT' ? 'bad' : '') }), { sub: num(d.rows.length) });
  }

  /* ---------- STOCK ---------- */
  function stock() {
    const d = data.stock; if (sec(d)) return head2('stock') + box('st-err', 'Stock', `<p class="hx-sub">Could not load: ${E(sec(d))}. Ingredient tracking may be switched off in Service settings.</p>`); const s = d.summary;
    return head2('stock', 'Ingredients running low and batches about to expire') + kpis([KP('Out of stock', num(s.out), 'ingredients', s.out ? 'red' : 'slate', 'box'), KP('Running low', num(s.low), 'below alert level', s.low ? 'ember' : 'slate', 'bell'), KP('Below zero', num(s.negative), 'usage not explained', s.negative ? 'red' : 'slate', 'wrench'), KP('Expired', num(s.expired), m(s.expiredValue) + ' value', s.expired ? 'red' : 'slate', 'clock'), KP('Expiring soon', num(s.critical + s.warning), 'batches', 'amber', 'calendar'), KP('Stock value', m(s.stockValue), 'in the store', 'green', 'cash')]) +
      box('st-e', 'Expiry', table([['Ingredient', (r) => `<b>${E(r.name)}</b><br><span class="mg-sub">Batch ${E(r.batch)} · ${E(nice(r.location))}</span>`], ['Expires', (r) => dt(r.expiryDate)], ['Days left', (r) => P(r.bucket) + ' ' + r.daysLeft], ['Quantity', (r) => E(r.quantityText)], ['Value', (r) => m(r.value)]], d.expiry, 'Nothing expiring soon.', { hot: (r) => (r.bucket === 'EXPIRED' ? 'bad' : r.bucket === 'CRITICAL' ? 'warn' : '') }), { sub: num(d.expiry.length) }) +
      box('st-i', 'Ingredients needing attention', table([['Ingredient', (r) => `<b>${E(r.name)}</b>`], ['In stock', (r) => E(r.quantityText)], ['State', (r) => P(r.state)], ['Alert level', (r) => num(r.low)], ['Value', (r) => m(r.value)]], d.ingredients, 'No ingredients.'), { sub: num(d.ingredients.length) });
  }

  /* ---------- TIPS + CASH BOX ---------- */
  function money() {
    const tp = data.tips; const c = data.cashBox; const T = c && c.totals;
    return head2('money', 'Tips, and the cash box of every cashier') + kpis([KP('Tips today', m(tp.total), num(tp.count) + ' tips', 'amber', 'tag'), KP('Tips not paid out', m(tp.unpaidTotal), 'still owed to staff', 'ember', 'cash'), T ? KP('Cash in open drawers', m(T.cashInDrawers), 'expected', 'green', 'cash') : '', T ? KP('Short', m(T.short), 'at shift close', T.short < 0 ? 'red' : 'slate', 'wrench') : '', T ? KP('Over', m(T.over), 'at shift close', 'blue', 'cash') : '', T ? KP('Unpaid cashier shortages', m(T.shortagesOutstanding), num(T.shortagesOutstandingCount) + ' open', T.shortagesOutstandingCount ? 'red' : 'slate', 'shield') : '']) +
      box('t-w', 'Tips by waiter', table([['Waiter', (r) => `<b>${E(r.name)}</b>`], ['Tips', (r) => num(r.count)], ['Amount', (r) => m(r.amount)]], tp.byWaiter, 'No tips.')) +
      box('t-c', 'Cashier cash box', c && c.error ? `<p class="hx-sub">Could not load: ${E(c.error)}</p>` : cashTable(c && c.rows ? c.rows : []));
  }

  /* ---------- LOSSES ---------- */
  function loss() {
    const l = data.loss; if (sec(l)) return head2('loss') + box('l-err', 'Losses', `<p class="hx-sub">Could not load: ${E(sec(l))}</p>`);
    return head2('loss', 'Where money was lost today') + kpis([KP('Total losses', m(l.total), 'all causes', 'red', 'pulse')]) + box('l-l', 'Loss breakdown', table([['Where the money was lost', (r) => `<b>${E(r.kind)}</b>`], ['Count', (r) => num(r.count)], ['Amount', (r) => `<b>${m(r.amount)}</b>`]], l.lines, 'No losses recorded for this day.'), { sub: num(l.lines.length) + ' causes' });
  }
})();