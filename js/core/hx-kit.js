/**
 * hx-kit.js - shared helpers for every restaurant / accommodation screen (hx-*.html).
 * Keeps each page small: data access that never throws, a form-in-a-modal builder, page header, status pills.
 */
(function (window) {
  const E = (s) => window.UI.escapeHtml(String(s == null ? '' : s));
  const M = (n) => window.UI.formatMoney(n);
  const shell = () => window.AppShell;
  const user = () => shell().getUser();
  const can = (p) => window.Permissions.can(user(), p);
  const canAny = (...p) => p.some(can);
  const branchId = () => shell().getActiveBranchId();
  const feature = (...k) => shell().hasFeature(...k);

  /** Pull an array out of whatever envelope the API used. */
  function list(data, ...keys) {
    if (Array.isArray(data)) return data;
    for (const k of keys) if (data && Array.isArray(data[k])) return data[k];
    if (data && Array.isArray(data.data)) return data.data;
    for (const v of Object.values(data || {})) if (Array.isArray(v)) return v;
    return [];
  }

  /** GET that returns null instead of throwing (permission / feature off / offline). */
  const errs = new Map();
  function banner() {
    let b = document.getElementById('hx-banner'); const rows = Array.from(errs.values());
    if (!rows.length) { if (b) b.remove(); return; }
    if (!b) { b = document.createElement('div'); b.id = 'hx-banner'; b.className = 'hx-banner'; b.setAttribute('role', 'alert'); document.body.appendChild(b); }
    const f = rows[0];
    const hint = f.code === 'FEATURE_DISABLED' ? 'This service is switched off. Turn it on in <a href="hx-services.html">Services &amp; system check</a>.'
      : f.code === 'NETWORK_ERROR' ? 'Cannot reach the backend. Check the address in <a href="hx-services.html">Services &amp; system check</a>.'
      : f.code === 'ROUTE_NOT_FOUND' ? 'The backend you are connected to does not have this route (old deployment). Redeploy the updated backend, then run the <a href="hx-services.html">system check</a>.'
      : 'Open the <a href="hx-services.html">system check</a> for details.';
    b.innerHTML = `<b>Some information could not load.</b> ${E(f.message)} <small>(${E(f.path)})</small><br><span>${hint}</span><button type="button" aria-label="Dismiss">×</button>`;
    b.querySelector('button').onclick = () => { errs.clear(); banner(); };
  }
  /** GET that returns null instead of throwing, but REMEMBERS why it failed and shows a banner (never a silent empty page). */
  async function get(path, query) {
    try { const { data } = await window.Api.get(path, query); errs.delete(path); if (!errs.size) banner(); return data; }
    catch (e) {
      const code = (e && e.code) || '';
      if (!(e && e.status === 403 && code === 'PERMISSION_DENIED')) { errs.set(path, { path, code, status: e && e.status, message: (e && e.message) || 'Request failed' }); banner(); }
      return null;
    }
  }
  /** Write that shows the server's message as a toast and returns null on failure. */
  async function send(method, path, body) {
    try { const { data } = await window.Api[method](path, body); return data || {}; }
    catch (e) { window.UI.toast.error((e && e.message) || 'That did not work. Please try again.'); return null; }
  }

  const PILL = { ok: 'hx-st-ok', busy: 'hx-st-busy', warn: 'hx-st-warn', bad: 'hx-st-bad', plan: 'hx-st-plan', mute: 'hx-st-mute' };
  function pill(text, tone = 'mute') { return `<span class="hx-pill ${PILL[tone] || PILL.mute}">${E(String(text).replace(/_/g, ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase()))}</span>`; }

  function head(title, sub, actionsHtml = '') {
    return `<div class="hx-head"><div><h1>${E(title)}</h1>${sub ? `<p>${E(sub)}</p>` : ''}</div><div class="hx-actions">${actionsHtml}</div></div>`;
  }
  const icon = (n) => (window.Icons && window.Icons.get ? window.Icons.get(n) : '');

  function fieldHtml(f) {
    const id = 'f_' + f.name, v = f.value == null ? '' : f.value;
    if (f.type === 'checkbox') return `<label class="hx-check"><input type="checkbox" id="${id}" name="${f.name}" ${f.value ? 'checked' : ''}> <span>${E(f.label)}${f.hint ? `<br><small class="hx-sub">${E(f.hint)}</small>` : ''}</span></label>`;
    let ctl;
    if (f.type === 'select') {
      ctl = `<select class="select" id="${id}" name="${f.name}">${(f.options || []).map((o) => { const [val, lab] = Array.isArray(o) ? o : [o, o]; return `<option value="${E(val)}" ${String(v) === String(val) ? 'selected' : ''}>${E(lab)}</option>`; }).join('')}</select>`;
    } else if (f.type === 'textarea') {
      ctl = `<textarea class="input" id="${id}" name="${f.name}" rows="3" placeholder="${E(f.placeholder || '')}">${E(v)}</textarea>`;
    } else {
      ctl = `<input class="input" id="${id}" name="${f.name}" type="${f.type || 'text'}" value="${E(v)}" placeholder="${E(f.placeholder || '')}" ${f.step ? `step="${f.step}"` : ''} ${f.min != null ? `min="${f.min}"` : ''} ${f.max != null ? `max="${f.max}"` : ''}>`;
    }
    return `<div class="field"><label for="${id}">${E(f.label)}${f.required ? ' *' : ''}</label>${ctl}${f.hint ? `<small class="hx-sub">${E(f.hint)}</small>` : ''}</div>`;
  }

  /** Reads a form built by fieldHtml. Numbers become numbers, checkboxes booleans, blanks are dropped unless keepBlank. */
  function readForm(root, fields) {
    const out = {};
    fields.forEach((f) => {
      const el = root.querySelector('#f_' + f.name); if (!el) return;
      if (f.type === 'checkbox') { out[f.name] = el.checked; return; }
      let val = el.value.trim();
      if (val === '' && !f.keepBlank) return;
      if (f.type === 'number') val = Number(val);
      out[f.name] = val;
    });
    return out;
  }

  /**
   * formModal({ title, fields, intro, submitText, onSubmit(values) -> truthy to close })
   * fields: [{ name, label, type, value, options, required, hint, placeholder }] or { row: [fieldA, fieldB] } for side by side.
   */
  function formModal({ title, fields, intro = '', submitText = 'Save', onSubmit, maxWidth = '520px' }) {
    const flat = fields.flatMap((f) => (f.row ? f.row : [f]));
    const body = fields.map((f) => (f.row ? `<div class="${f.row.length === 3 ? 'three' : 'two'}">${f.row.map(fieldHtml).join('')}</div>` : (f.heading ? `<h4>${E(f.heading)}</h4>` : fieldHtml(f)))).join('');
    return window.UI.openModal({
      title, maxWidth,
      bodyHtml: `${intro ? `<p class="hx-sub" style="margin-bottom:var(--space-3)">${E(intro)}</p>` : ''}<form class="hx-form" novalidate>${body}</form>`,
      footerHtml: `<button class="btn btn-secondary" data-act="cancel">Cancel</button><button class="btn btn-primary" data-act="save">${E(submitText)}</button>`,
      onMount(root) {
        const save = root.querySelector('[data-act=save]');
        root.querySelector('[data-act=cancel]').addEventListener('click', () => window.UI.closeModal());
        const go = async () => {
          const values = readForm(root, flat.filter((f) => f.name));
          const missing = flat.find((f) => f.required && (values[f.name] === undefined || values[f.name] === ''));
          if (missing) { window.UI.toast.warning(`${missing.label} is required`); return; }
          window.UI.setButtonLoading(save, true, 'Saving…');
          const ok = await onSubmit(values);
          window.UI.setButtonLoading(save, false);
          if (ok) window.UI.closeModal();
        };
        save.addEventListener('click', go);
        root.querySelector('form').addEventListener('submit', (e) => { e.preventDefault(); go(); });
        const first = root.querySelector('input,select,textarea'); if (first) first.focus();
      },
    });
  }

  /** Mounts the app shell and returns the content element, or null when the user is being redirected. */
  function mount(title) { return shell().mount({ title }); }

  /** Re-run fn every `ms` while the tab is visible; also reruns on branch change. Returns a stop function. */
  function live(fn, ms = 30000) {
    const tick = () => { if (!document.hidden) fn(); };
    const t = setInterval(tick, ms);
    window.addEventListener('branchchange', fn);
    document.addEventListener('visibilitychange', tick);
    return () => { clearInterval(t); window.removeEventListener('branchchange', fn); document.removeEventListener('visibilitychange', tick); };
  }

  window.HX = { errors: errs, E, M, user, can, canAny, branchId, feature, list, get, send, pill, head, icon, fieldHtml, formModal, readForm, mount, live };
})(window);
/* ---- extra helpers shared by the order, bill and stay screens ---- */
(function (window) {
  const HX = window.HX;
  HX.ymd = (d = new Date()) => { const x = new Date(d); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
  HX.addDays = (ymd, n) => { const d = new Date(ymd + 'T12:00:00'); d.setDate(d.getDate() + n); return HX.ymd(d); };
  HX.mins = (t) => (t ? Math.max(0, Math.floor((Date.now() - new Date(t).getTime()) / 60000)) : 0);
  HX.dt = (t) => (t ? new Date(t).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');
  HX.hm = (t) => (t ? new Date(t).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : '');
  HX.unwrap = (data, key) => (data && (data[key] || (data.data && data.data[key]))) || data || {};
  HX.PAY = ['CASH', 'MPESA', 'MOBILE_MONEY', 'CARD', 'BANK', 'CREDIT', 'OTHER'];
  HX.payLabel = (m) => ({ MPESA: 'M-PESA', MOBILE_MONEY: 'Mobile money', CREDIT: 'On account' }[m] || m.charAt(0) + m.slice(1).toLowerCase());
  HX.empty = (title, message) => window.UI.emptyStateHtml({ icon: 'store', title, message });
  HX.tabs = (items, cur) => `<div class="hx-cats hx-tabs">${items.map(([k, l]) => `<button class="hx-chip ${k === cur ? 'on' : ''}" data-tab="${k}">${HX.E(l)}</button>`).join('')}</div>`;
  HX.ask = (title, label, opts = {}) => new Promise((res) => {
    let done = false;
    const m = HX.formModal({ title, maxWidth: '420px', submitText: opts.cta || 'Confirm', fields: [{ name: 'v', label, type: opts.type || 'textarea', required: opts.required !== false, value: opts.value }], onSubmit: async (v) => { done = true; res(v.v); return true; } });
    const t = setInterval(() => { if (!m || !m.isConnected) { clearInterval(t); if (!done) res(null); } }, 250);
  });
})(window);

/* ---- absolute URLs (QR codes must hold a full link) and expandable rows ---- */
(function (window) {
  const HX = window.HX;
  HX.abs = (u) => {
    if (!u) return '';
    if (/^https?:\/\//i.test(u)) return u;
    const base = ((window.APP_CONFIG && window.APP_CONFIG.PUBLIC_APP_URL) || window.location.origin).replace(/\/+$/, '');
    return base + (u.startsWith('/') ? u : '/' + u);
  };
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-xtoggle]'); if (!t) return;
    if (e.target.closest('a,button,input,select,textarea')) return;
    const body = t.nextElementSibling; if (!body || !body.classList.contains('hx-xbody')) return;
    const open = body.classList.toggle('open'); t.classList.toggle('open', open); t.setAttribute('aria-expanded', open);
  });
  /** Expandable row: click the head to show/hide the details underneath. */
  HX.xrow = (headHtml, bodyHtml, open) => `<div class="hx-xrow ${open ? 'open' : ''}" data-xtoggle aria-expanded="${!!open}"><span class="hx-caret"></span>${headHtml}</div><div class="hx-xbody ${open ? 'open' : ''}">${bodyHtml}</div>`;
})(window);

/* ---- modal wrapper shared by every hx screen (returns { el, close }) ---- */
(function (window) {
  const HX = window.HX;
  HX.modal = function modal({ title, body = '', footer = '', maxWidth, cls = '', onMount }) {
    let ref = null;
    const close = () => { if (ref && ref.isConnected) ref.querySelector('.modal-close').click(); };
    window.UI.openModal({ title, maxWidth, bodyHtml: body, footerHtml: footer, onMount(m) { ref = m; if (cls) m.classList.add(...cls.split(' ').filter(Boolean)); if (onMount) onMount(m, close); } });
    return { el: ref, close };
  };
})(window);
