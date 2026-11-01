/* Hardware workspace — core: helpers, forms, pickers, modal, shell, router. Pages register on HW.V. */
(function () {
  const { Api, UI, Storage } = window, E = UI.escapeHtml;
  const HW = window.HW = { V: {}, S: { user: Storage.getUser(), branch: null, branches: [], profile: null, settings: null, timer: null } };
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  HW.$ = $; HW.$$ = $$; HW.E = E;

  /* ---------- permissions (UI only; the backend re-checks everything) ---------- */
  const GRANTS = {
    CASHIER: ['hardware.quotes', 'hardware.deposits', 'sales.create', 'shifts.open', 'shifts.close', 'sales.view'],
    SALES_REP: ['hardware.quotes', 'sales.create', 'sales.view', 'hardware.boq', 'hardware.deposits'],
    STOREKEEPER: ['hardware.profile', 'hardware.locations', 'hardware.remnants', 'hardware.deliveries', 'hardware.repack', 'hardware.supplier'],
    DISPATCHER: ['hardware.deliveries', 'hardware.transport', 'hardware.transport.costs', 'hardware.locations'],
    DRIVER: ['hardware.deliver', 'hardware.transport.costs'],
    ACCOUNTANT: ['hardware.reports', 'hardware.finance', 'hardware.transport', 'hardware.deposits', 'hardware.supplier'],
  };
  HW.can = (p) => {
    const u = HW.S.user || {}, r = u.role;
    if (['OWNER', 'ADMIN', 'MANAGER'].includes(r)) return true;
    if (Array.isArray(u.permissions) && u.permissions.length) return u.permissions.includes(p);
    if ((GRANTS[r] || []).includes(p)) return true;
    try { return !!(window.Permissions && window.Permissions.can(u, p)); } catch (e) { return false; }
  };
  HW.canAny = (ps) => !ps || !ps.length || ps.some(HW.can);

  /* ---------- small utils ---------- */
  HW.list = (d) => Array.isArray(d) ? d : (d && (d.items || d.rows || Object.values(d).find(Array.isArray))) || [];
  HW.all = async (path, query = {}, max = 10) => { let out = [], page = 1, pages = 1; do { const { data } = await Api.get(path, { ...query, limit: 100, page }); out = out.concat(HW.list(data)); pages = data.pages || (data.total ? Math.ceil(data.total / 100) : 1); page++; } while (page <= pages && page <= max); return out; };
  HW.money = (n) => UI.formatMoney(n || 0);
  HW.num = (n, d = 3) => (n === undefined || n === null || n === '') ? '' : String(Math.round(Number(n) * 10 ** d) / 10 ** d);
  HW.date = (d) => d ? UI.formatDate(d) : '—';
  HW.dt = (d) => d ? UI.formatDateTime(d) : '—';
  HW.iso = (d) => d ? new Date(d).toISOString().slice(0, 10) : '';
  HW.local = (d) => { const x = d ? new Date(d) : new Date(); x.setMinutes(x.getMinutes() - x.getTimezoneOffset()); return x.toISOString().slice(0, 16); };
  HW.name = (x) => x ? (typeof x === 'object' ? (x.name || x.number || x.plate || '') : String(x)) : '';
  HW.id = (x) => x && (x._id || x.id || x);
  HW.human = (s) => String(s || '').replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
  const T = (m, t) => { try { UI.toast[m](t); } catch (e) { /* toast missing */ } };
  HW.ok = (t) => T('success', t); HW.err = (t) => T('error', t);
  const TONE = { DRAFT: '', SENT: 'bl', APPROVED: 'or', PARTIALLY_FULFILLED: 'wa', FULFILLED: 'ok', REJECTED: 'er', EXPIRED: 'er', CANCELLED: 'er', PENDING: 'wa', LOADED: 'bl', IN_TRANSIT: 'or', DELIVERED: 'ok', FAILED: 'er', AVAILABLE: 'ok', MAINTENANCE: 'wa', INACTIVE: '', OPEN: 'ok', USED: '', REFUNDED: 'wa', ACTIVE: 'ok', CLOSED: '', ACCEPTED: 'ok', PAID: 'ok', UNPAID: 'wa', CONTRACT: 'or', RETAIL: '' };
  HW.badge = (s, label) => `<span class="hw-badge ${TONE[s] !== undefined ? TONE[s] : (['OK', 'WA', 'ER', 'BL', 'OR'].includes(s) ? s.toLowerCase() : '')}">${E(label || HW.human(s))}</span>`;
  HW.empty = (title, msg) => `<div class="hw-empty"><b>${E(title)}</b>${E(msg || '')}</div>`;
  HW.kpi = (items) => `<div class="hw-kpi">${items.map(([l, v, sub, tone]) => `<div class="hw-card ${tone || ''}"><span>${l}</span><b>${v}</b>${sub ? `<small>${sub}</small>` : ''}</div>`).join('')}</div>`;
  HW.tabs = (items, cur) => `<div class="hw-tabs">${items.map(([id, l, n]) => `<a data-tab="${id}" class="${id === cur ? 'on' : ''}">${l}${n ? `<b>${n}</b>` : ''}</a>`).join('')}</div>`;
  HW.bindTabs = (root, fn) => $$('[data-tab]', root).forEach((a) => a.onclick = () => fn(a.dataset.tab));
  HW.tbl = (cols, rows, o = {}) => !rows.length ? HW.empty(o.empty || 'Nothing here yet', o.hint) : `<div class="hw-tw"><table class="hw-t"><thead><tr>${cols.map((c) => `<th ${c.c === 'n' ? 'class="n"' : ''}>${c.h}</th>`).join('')}</tr></thead><tbody>${rows.map((r, i) => `<tr class="${o.click ? 'click' : ''}" data-i="${i}">${cols.map((c) => `<td class="${c.c || ''}">${c.f(r, i)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  HW.bindRows = (root, rows, fn) => $$('tr[data-i]', root).forEach((tr) => tr.onclick = (e) => { if (e.target.closest('button,a,input,select')) return; fn(rows[+tr.dataset.i]); });
  HW.dl = (pairs) => `<dl class="hw-dl">${pairs.filter((p) => p && p[1] !== undefined && p[1] !== null && p[1] !== '').map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>`;
  HW.run = async (fn, okMsg) => { try { const r = await fn(); if (okMsg) HW.ok(okMsg); return r === undefined ? true : r; } catch (e) { HW.err(e.message || 'Something went wrong'); if (e.errors) console.warn(e.errors); return false; } };
  HW.csvDownload = (name, text) => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); };

  /* ---------- modal ---------- */
  HW.modal = ({ title, body, actions = [], size = '', onMount }) => {
    const el = document.createElement('div'); el.className = 'hw-modal';
    el.innerHTML = `<div class="hw-mb ${size}"><div class="hw-mh"><h3>${E(title)}</h3><button class="x" type="button" aria-label="Close">&times;</button></div><div class="hw-mbd">${body}</div>${actions.length ? `<div class="hw-mf">${actions.map((a, i) => `<button type="button" class="hw-btn ${a.cls || ''}" data-a="${i}">${a.label}</button>`).join('')}</div>` : ''}</div>`;
    const close = () => { el.remove(); if (!document.querySelector('.hw-modal')) document.body.classList.remove('hw-lock'); }; el.querySelector('.x').onclick = close; document.body.classList.add('hw-lock');
    el.addEventListener('mousedown', (e) => { if (e.target === el) el._down = true; }); el.addEventListener('mouseup', (e) => { if (e.target === el && el._down) close(); el._down = false; });
    ($('#app') || document.body).appendChild(el);
    actions.forEach((a, i) => { const b = el.querySelector(`[data-a="${i}"]`); b.onclick = async () => { if (!a.fn) return close(); b.disabled = true; b.classList.add('is-busy'); try { const r = await a.fn(el, close); if (r !== false) close(); } finally { b.disabled = false; b.classList.remove('is-busy'); } }; });
    if (onMount) onMount(el, close); return { el, close };
  };
  HW.confirm = (msg, fn, label = 'Confirm') => HW.modal({ title: 'Please confirm', body: `<p>${msg}</p>`, actions: [{ label: 'Cancel' }, { label: label, cls: 'p', fn }] });
  /** Ask for a short reason, then call fn(reason). */
  HW.reason = (title, fn, label = 'Submit') => HW.modal({ title, body: `<div class="hw-f"><label class="w">Reason<textarea name="reason" placeholder="At least 3 characters"></textarea></label></div>`, actions: [{ label: 'Cancel' }, { label, cls: 'p', fn: async (el) => { const r = $('[name=reason]', el).value.trim(); if (r.length < 3) { HW.err('Please give a reason'); return false; } return (await fn(r)) === false ? false : true; } }] });

  /* ---------- forms ---------- */
  HW.field = (f, v = {}) => {
    const val = v[f.n] !== undefined ? v[f.n] : f.v; const n = E(f.n), cls = f.w ? 'w' : '', req = f.req ? 'required' : '', ph = f.ph ? `placeholder="${E(f.ph)}"` : '';
    const hint = f.hint ? `<small>${f.hint}</small>` : '';
    if (f.t === 'h') return `<div class="fs w">${f.l}</div>`;
    if (f.t === 'check') return `<label class="chk ${cls}"><input type="checkbox" name="${n}" ${val ? 'checked' : ''}> ${f.l}</label>`;
    if (f.t === 'select') return `<label class="${cls}">${f.l}<select name="${n}" ${req}>${f.blank !== false ? '<option value="">' + E(f.blank || '— choose —') + '</option>' : ''}${(f.opts || []).map((o) => { const [ov, ol] = Array.isArray(o) ? o : [o, HW.human(o)]; return `<option value="${E(ov)}" ${String(ov) === String(val ?? '') ? 'selected' : ''}>${E(ol)}</option>`; }).join('')}</select>${hint}</label>`;
    if (f.t === 'textarea') return `<label class="${cls}">${f.l}<textarea name="${n}" ${req} ${ph}>${E(val ?? '')}</textarea>${hint}</label>`;
    if (f.t === 'html') return `<label class="${cls}">${f.l}${f.html}${hint}</label>`;
    const type = { number: 'number', date: 'date', datetime: 'datetime-local', time: 'time' }[f.t] || 'text';
    const cur = f.t === 'date' ? HW.iso(val) : f.t === 'datetime' ? (val ? HW.local(val) : '') : (val ?? '');
    return `<label class="${cls}">${f.l}<input name="${n}" type="${type}" value="${E(cur)}" ${req} ${ph} ${f.t === 'number' ? `step="${f.step || 'any'}" min="${f.min ?? 0}"` : ''}>${hint}</label>`;
  };
  HW.form = (fields, v = {}) => `<div class="hw-f">${fields.map((f) => HW.field(f, v)).join('')}</div>`;
  HW.vals = (root, fields) => {
    const o = {};
    for (const f of fields) {
      const el = root.querySelector(`[name="${f.n}"]`); if (!el) continue;
      if (f.t === 'check') { o[f.n] = el.checked; continue; }
      let x = el.value; if (x === '' || x === undefined) { if (f.req) throw new Error(`${f.l.replace(/<[^>]+>/g, '')} is required`); continue; }
      if (f.t === 'number') x = Number(x); else if (f.t === 'datetime') x = new Date(x).toISOString();
      o[f.n] = x;
    }
    return o;
  };
  /** Open a form modal; onSave(values, el) must perform the API call. */
  HW.formModal = ({ title, fields, values, onSave, label = 'Save', size = '', extra = '', onMount }) => HW.modal({ title, size, body: HW.form(fields, values || {}) + extra, onMount, actions: [{ label: 'Cancel' }, { label, cls: 'p', fn: async (el) => { let v; try { v = HW.vals(el, fields); } catch (e) { HW.err(e.message); return false; } const r = await HW.run(() => onSave(v, el)); return r === false ? false : true; } }] });

  /* ---------- autocomplete picker ---------- */
  HW.pickHtml = (name, ph, label = '', id = '') => `<div class="hw-pick" data-pick="${name}"><input type="text" autocomplete="off" placeholder="${E(ph)}" value="${E(label)}"><input type="hidden" name="${name}" value="${E(id)}"></div>`;
  HW.bindPick = (root, name, { fetch, label, sub, onPick }) => {
    const box = root.querySelector(`[data-pick="${name}"]`); if (!box) return; const inp = box.querySelector('input[type=text]'), hid = box.querySelector('input[type=hidden]');
    let dd; const close = () => { if (dd) { dd.remove(); dd = null; } };
    const run = UI.debounce(async () => { const term = inp.value.trim(); if (term.length < 1) { close(); return; } let rows = []; try { rows = await fetch(term); } catch (e) { rows = []; } close(); dd = document.createElement('div'); dd.className = 'dd'; dd.innerHTML = rows.length ? rows.slice(0, 20).map((r, i) => `<div data-i="${i}"><span>${E(label(r))}</span><small>${E(sub ? sub(r) : '')}</small></div>`).join('') : '<div><small>No match</small></div>'; box.appendChild(dd); dd.onclick = (e) => { const d = e.target.closest('[data-i]'); if (!d) return; const r = rows[+d.dataset.i]; hid.value = HW.id(r); inp.value = label(r); close(); if (onPick) onPick(r); }; }, 250);
    inp.addEventListener('input', () => { hid.value = ''; run(); }); document.addEventListener('click', (e) => { if (!box.contains(e.target)) close(); });
  };
  HW.pickers = {
    product: { fetch: async (t) => HW.list((await Api.get('/products', { search: t, limit: 20, status: 'active' })).data), label: (p) => p.name, sub: (p) => [p.sku, HW.money(p.sellingPrice)].filter(Boolean).join(' · ') },
    customer: { fetch: async (t) => HW.list((await Api.get('/customers', { search: t, limit: 20 })).data), label: (c) => c.name, sub: (c) => c.phone || '' },
  };
  HW.bindProduct = (root, name = 'productId', onPick) => HW.bindPick(root, name, { ...HW.pickers.product, onPick });
  HW.bindCustomer = (root, name = 'customerId', onPick) => HW.bindPick(root, name, { ...HW.pickers.customer, onPick });

  /* ---------- option loaders (cached per page load) ---------- */
  const cache = {}; const once = (k, fn) => cache[k] || (cache[k] = fn().catch((e) => { delete cache[k]; return []; }));
  HW.opt = {
    branches: () => once('b', async () => (await HW.all('/branches', {}, 2)).map((b) => [b._id, b.name])),
    drivers: () => once('d', async () => { const e = await HW.all('/employees', {}, 3); const dr = e.filter((u) => u.role === 'DRIVER'); return (dr.length ? dr : e).map((u) => [u._id, `${u.name}${u.role === 'DRIVER' ? '' : ' (' + HW.human(u.role) + ')'}`]); }),
    suppliers: () => once('s', async () => (await HW.all('/suppliers', {}, 3)).map((s) => [s._id || s.supplierId, s.name])),
    vehicles: async () => { try { const { data } = await Api.get('/hardware/transport/vehicles'); return data.vehicles || []; } catch (e) { return []; } },
    projects: async (customerId) => { const { data } = await Api.get('/hardware/projects', customerId ? { customerId } : {}); return data.projects || []; },
    locations: async () => { const { data } = await Api.get('/hardware/locations', { branchId: HW.S.branch }); return data.locations || []; },
    categories: () => once('c', async () => { const { data } = await Api.get('/categories'); return HW.list(data).map((c) => [c._id, c.name]); }),
  };
  HW.flush = () => Object.keys(cache).forEach((k) => delete cache[k]);

  /* ---------- navigation ---------- */
  // [id, label, icon, permissions(any), group]
  const NAV = [
    ['home', 'Overview', '', null, 'Work'],
    ['counter', 'Counter till', '', ['sales.create'], 'Work'],
    ['quotes', 'Quotes & orders', '', ['hardware.quotes'], 'Work'],
    ['projects', 'Projects & BOQ', '', ['hardware.quotes', 'hardware.boq'], 'Work'],
    ['deposits', 'Deposits', '', ['hardware.deposits'], 'Work'],
    ['dispatch', 'Dispatch & deliveries', '', ['hardware.deliveries', 'hardware.deliver'], 'Yard & delivery'],
    ['fleet', 'Fleet & transport', '', ['hardware.transport'], 'Yard & delivery'],
    ['shelves', 'Shelves & picking', '', ['hardware.locations', 'hardware.remnants', 'hardware.repack'], 'Yard & delivery'],
    ['stock', 'Products & specs', '', ['hardware.profile', 'hardware.quotes'], 'Stock & prices'],
    ['pricing', 'Contractor pricing', '％', ['hardware.pricing', 'hardware.quotes'], 'Stock & prices'],
    ['suppliers', 'Suppliers & landed cost', '', ['hardware.supplier'], 'Stock & prices'],
    ['finance', 'Finance', '₭', ['hardware.finance'], 'Money'],
    ['reports', 'Reports', '', ['hardware.reports', 'hardware.transport'], 'Money'],
    ['settings', 'Settings', '', ['hardware.settings', 'hardware.templates'], 'Setup'],
  ];
  const SHOP = [['Inventory', '../inventory.html'], ['Purchases', '../purchases.html'], ['Customers', '../customers.html'], ['Expenses', '../expenses.html'], ['Cash register', '../cash-register.html'], ['Sales history', '../sales.html'], ['Returns', '../refunds.html'], ['Staff', '../employees.html']];
  const LANDING = { DRIVER: 'dispatch', DISPATCHER: 'dispatch', SALES_REP: 'quotes', STOREKEEPER: 'shelves', ACCOUNTANT: 'finance', CASHIER: 'counter' };
  HW.NAV = NAV;

  HW.go = (id, arg) => { location.hash = `#/${id}${arg ? '/' + arg : ''}`; };

  async function boot() {
    if (!Storage.isAuthenticated()) { location.href = '../login.html'; return; }
    try { const { data } = await Api.get('/business/profile'); HW.S.profile = data.profile; } catch (e) { /* keep going */ }
    try { const { data } = await Api.get('/hardware/settings'); HW.S.settings = data.settings; } catch (e) { HW.S.settings = {}; }
    HW.S.branches = await HW.opt.branches();
    HW.S.branch = Storage.getActiveBranchId() || (HW.S.user && (HW.S.user.branchId || (HW.S.user.branchIds || [])[0])) || (HW.S.branches[0] && HW.S.branches[0][0]);
    if (HW.S.branch) Storage.setActiveBranchId(HW.S.branch);
    shell(); if (HW.afterShell) { try { HW.afterShell(); } catch (e) { console.warn(e); } }
    if (!location.hash || location.hash === '#/' || location.hash === '#') location.hash = '#/' + (LANDING[HW.S.user && HW.S.user.role] && HW.canAny(NAV.find((n) => n[0] === LANDING[HW.S.user.role])[3]) ? LANDING[HW.S.user.role] : 'home');
    window.addEventListener('hashchange', route); route();
  }
  function shell() {
    const groups = []; NAV.filter((n) => HW.canAny(n[3])).forEach((n) => { let g = groups.find((x) => x[0] === n[4]); if (!g) groups.push(g = [n[4], []]); g[1].push(n); });
    const name = (HW.S.profile && HW.S.profile.name) || 'Hardware'; const ic = (k, z, w) => (HW.icon ? HW.icon(k, z, w) : '');
    $('#app').innerHTML = `<aside class="hw-rail" id="rail"><div class="hw-brand"><span class="hw-logo">${ic('stock', 22, 2)}</span><span class="nm">${E(name)}<small>HARDWARE &amp; BUILDING MATERIALS</small></span><button class="hw-collapse" id="collapse" type="button" title="Collapse menu" aria-label="Collapse menu">‹</button></div>
      <nav class="hw-nav">${groups.map(([g, items]) => `<div class="sep"><span>${g}</span></div>${items.map((n) => `<a href="#/${n[0]}" data-id="${n[0]}" title="${E(n[1])}"><i>${n[2] || HW.ic('package', 18)}</i><span class="t">${n[1]}</span></a>`).join('')}`).join('')}<div class="sep"><span>Shop tools</span></div>${SHOP.map(([l, h]) => `<a href="${h}" title="${E(l)}"><i>${HW.ic('external', 16)}</i><span class="t">${l}</span></a>`).join('')}<div class="hw-promo"><span class="ic">${HW.ic('rocket', 34)}</span><p>Customer at the counter?<br>Start a sale in one tap.</p><a href="#/counter">New sale!</a></div></nav>
      <div class="hw-foot"><div class="fu"><b>${E(HW.S.user && HW.S.user.name || '')}</b><small>${E(HW.human(HW.S.user && HW.S.user.role))}</small></div><a id="out" title="Sign out"><i>${HW.ic('logout', 17)}</i><span class="t">Sign out</span></a></div></aside>
      <main class="hw-main"><div class="hw-top"><button class="hw-btn hw-burger s" id="burger">${HW.ic('menu', 20)}</button><h1 id="ttl"></h1><div class="hw-search" id="gwrap">${ic('search', 18, 2)}<input id="gsearch" placeholder="Search products, pages, customers…" autocomplete="off" aria-label="Search" role="combobox" aria-expanded="false"><kbd>/</kbd></div>${HW.S.branches.length > 1 ? `<select id="brSel" title="Branch">${HW.S.branches.map(([id, n]) => `<option value="${id}" ${id === HW.S.branch ? 'selected' : ''}>${E(n)}</option>`).join('')}</select>` : ''}<span class="u" id="upd"></span><span class="hw-bellwrap" id="bellwrap"><button class="hw-ico" id="bell" type="button" title="Notifications" aria-label="Notifications" aria-haspopup="true">${ic('bell', 20, 1.8) || HW.ic('bell', 20)}<b class="dot" hidden></b></button></span><span class="hw-ico av" title="${E(HW.S.user && HW.S.user.name || '')}">${E(UI.initials ? UI.initials(HW.S.user && HW.S.user.name || 'U') : 'U')}</span></div><div class="hw-pg" id="pg"></div></main>`;
    $('#out').onclick = () => { Storage.clearSession(); location.href = '../login.html'; };
    $('#burger').onclick = () => $('#rail').classList.toggle('open');
    $('#gsearch').addEventListener('keydown', (e) => { if (e.key !== 'Enter' || HW.searchPro) return; const t = e.target.value.trim(); if (!t) return; HW.S.pending = t; e.target.value = ''; if (location.hash.startsWith('#/counter')) HW.refresh(); else HW.go('counter'); });
    const sel = $('#brSel'); if (sel) sel.onchange = () => { HW.S.branch = sel.value; Storage.setActiveBranchId(sel.value); route(); };
  }
  function route() {
    clearInterval(HW.S.timer); $('#rail').classList.remove('open');
    const [, id = 'home', arg] = (location.hash || '#/home').split('/'); const nav = NAV.find((n) => n[0] === id) || NAV[0]; const fn = HW.V[nav[0]];
    $$('.hw-nav a').forEach((a) => a.classList.toggle('on', a.dataset.id === nav[0])); { const t = $('#ttl'); if (nav[0] === 'home') { const h = new Date().getHours(); t.innerHTML = `${h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'}, <b>${E(((HW.S.user && HW.S.user.name) || '').split(' ')[0] || 'there')}</b>!`; } else t.textContent = nav[1]; }
    const pg = $('#pg');
    if (!HW.canAny(nav[3])) { pg.innerHTML = HW.empty('No access', 'Ask the owner to give you this permission.'); return; }
    pg.innerHTML = HW.skeleton ? HW.skeleton() : '<p style="color:#667080">Loading…</p>';
    const go = async (quiet) => { const y = window.scrollY; try { await fn(pg, arg); if (quiet) window.scrollTo(0, y); $('#upd').textContent = 'Updated ' + new Date().toLocaleTimeString(); } catch (e) { pg.innerHTML = HW.empty('Could not load', e.message || 'Try again'); } };
    go(); if (fn && fn.live) HW.S.timer = setInterval(() => { if (!document.querySelector('.hw-modal') && !document.hidden) go(true); }, fn.live);
  }
  HW.refresh = route;
  window.addEventListener('DOMContentLoaded', () => setTimeout(boot, 0));
})();
