/**
 * add-product-guard.js  -  loaded on products.html and sales.html (after the page scripts).
 *
 *  1. DRAFT SAVING : everything typed into an "Add product" window (Products page "Add product", Sales page
 *                    "Add product" / "Quick add product") is saved on this device as you type. Close the window,
 *                    refresh the page, lose the connection, switch user tabs - when you open Add product again the
 *                    draft comes back. The draft is deleted ONLY when the product is successfully submitted
 *                    (or when you press "Discard draft").
 *  2. LIVE BARCODE ALERT (Quick add window) : a scanned / typed barcode that already exists shows a RED alert at once.
 *                    (The Products-page form and the Sales built-in form have the same alert built into products.js / sales.js.)
 *
 * It does not change saving or validation: it only watches the forms.
 */
(function () {
  'use strict';

  const FORM_IDS = ['product-form', 'qa-form', 'pb-qa-form'];
  const PREFIX = 'pos.draft.addproduct.';
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const toast = (t, m) => { try { window.UI.toast[t](m); } catch { /* ignore */ } };
  const userId = () => { try { const u = window.AppShell && window.AppShell.getUser && window.AppShell.getUser(); return (u && (u._id || u.id)) || 'u'; } catch { return 'u'; } };

  const store = {
    get(k) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage full / blocked */ } },
    del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
  };

  let active = null; // the add-product window that is open right now: { key, root, form, submitted, flush, cancel }

  /* ---------------- clear the draft when the product is really submitted ---------------- */
  function wrapApi() {
    const Api = window.Api;
    if (!Api || Api.__draftWrapped) return;
    Api.__draftWrapped = true;
    const post = Api.post.bind(Api);
    Api.post = async function (path, body, opts) {
      const res = await post(path, body, opts);
      if (path === '/products' && active) { active.submitted = true; active.cancel(); store.del(active.key); }
      return res;
    };
  }
  (function waitApi() { if (window.Api) wrapApi(); else setTimeout(waitApi, 30); })();

  /* ---------------- snapshot / restore ---------------- */
  const fieldKey = (el) => {
    const k = el.name || el.id;
    if (!k) return null;
    return el.type === 'radio' ? `${k}::${el.value}` : k;
  };
  const skip = (el) => el.type === 'file' || el.type === 'password' || el.type === 'button' || el.type === 'submit' || el.closest('.bc-draft-banner');

  function snapshot(root) {
    const data = {};
    $$('input, select, textarea', root).forEach((el) => {
      if (skip(el)) return;
      const k = fieldKey(el); if (!k) return;
      data[k] = (el.type === 'checkbox' || el.type === 'radio') ? !!el.checked : el.value;
    });
    return data;
  }

  const fire = (el) => {
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };

  function applyValues(root, data) {
    let pending = false;
    // text-like fields first, check boxes last (their change handlers show/hide sections)
    const els = $$('input, select, textarea', root).filter((el) => !skip(el) && fieldKey(el) in data);
    els.sort((a, b) => (a.type === 'checkbox' ? 1 : 0) - (b.type === 'checkbox' ? 1 : 0));
    els.forEach((el) => {
      const v = data[fieldKey(el)];
      if (el.type === 'checkbox' || el.type === 'radio') {
        if (el.checked !== !!v) { el.checked = !!v; fire(el); }
      } else if (el.value !== v) {
        el.value = v;
        if (el.tagName === 'SELECT' && el.value !== v) pending = true; // options not loaded yet (categories)
        else fire(el);
      }
    });
    return pending;
  }

  function restoreVariantRows(root, data) {
    const addBtn = $('#add-variant-row-btn', root);
    if (!addBtn) return;
    const idxs = new Set();
    Object.keys(data).forEach((k) => { const m = /^v-[a-z]+-(\d+)$/i.exec(k); if (m) idxs.add(Number(m[1])); });
    if (!idxs.size) return;
    const max = Math.max(...idxs);
    for (let i = 0; i <= max; i++) addBtn.click();
    // rows that were removed before the draft was saved
    $$('.variant-row', root).forEach((row) => { if (!idxs.has(Number(row.dataset.idx))) row.remove(); });
  }

  function isMeaningful(root) {
    const g = (n) => { const el = $(`[name="${n}"]`, root); return el ? String(el.value || '').trim() : ''; };
    return !!(g('name') || g('barcode') || g('sellingPrice') || g('wholesalePrice') || g('brand') || $$('.variant-row', root).length);
  }

  /* ---------------- live duplicate-barcode alert (Quick add window) ---------------- */
  function bindDupAlert(form, root) {
    const input = $('[name="barcode"]', form);
    if (!input || input._bcLive) return;
    input._bcLive = true;
    const field = input.closest('.field') || input.parentElement;
    const msg = document.createElement('div');
    msg.setAttribute('role', 'alert');
    msg.style.cssText = 'display:none;margin-top:6px;padding:8px 10px;border-radius:6px;background:#fdecea;border:1px solid #d93025;color:#b3140a;font-weight:600;font-size:13px';
    field.appendChild(msg);
    let timer = null, seq = 0, lastToasted = '';
    const setState = (dup, text) => {
      input._bcDup = dup;
      input.style.borderColor = dup ? '#d93025' : '';
      input.style.boxShadow = dup ? '0 0 0 3px rgba(217,48,37,.25)' : '';
      input.style.background = dup ? '#fff5f4' : '';
      msg.style.display = dup ? '' : 'none';
      msg.textContent = dup ? text : '';
    };
    const find = async (code) => {
      try {
        const { data } = await window.Api.get(`/products/barcode/${encodeURIComponent(code)}`);
        const p = data && (data.product || data);
        if (p && (p._id || p.name)) return { name: p.name || '' };
      } catch { /* not found */ }
      try {
        if (window.BarcodeLabels) { const used = (await window.BarcodeLabels.loadCatalog()).used; if (used.has(code)) return { name: '' }; }
      } catch { /* ignore */ }
      return null;
    };
    const check = async () => {
      const code = input.value.trim(); const my = ++seq;
      if (!code) { setState(false); return; }
      const hit = await find(code);
      if (my !== seq) return;
      if (hit) {
        setState(true, `⚠ BARCODE ALREADY EXISTS in the system${hit.name ? ` — product: "${hit.name}"` : ''}. Use a different barcode.`);
        if (lastToasted !== code) { lastToasted = code; toast('error', `Barcode ${code} already exists${hit.name ? ` (${hit.name})` : ''}`); }
        try { input.focus(); input.select(); } catch { /* ignore */ }
      } else setState(false);
    };
    input._bcCheck = check;
    input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(check, 250); });
    input.addEventListener('change', () => { clearTimeout(timer); check(); });
    input.addEventListener('blur', () => { clearTimeout(timer); check(); });
    // a scanner ends with Enter: check first, never submit before the alert had a chance to show
    input.addEventListener('keydown', async (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault(); e.stopImmediatePropagation();
      clearTimeout(timer); await check();
      if (!input._bcDup) { const next = $('[name="sellingPrice"]', form); if (next) next.focus(); }
    }, true);
    // the Add button re-checks before it is allowed to save
    const saveBtn = $('[data-action="save"]', root);
    if (saveBtn) {
      saveBtn.addEventListener('click', async (e) => {
        if (saveBtn._pass) { saveBtn._pass = false; return; }
        if (!input.value.trim()) return;
        e.preventDefault(); e.stopImmediatePropagation();
        clearTimeout(timer); await check();
        if (input._bcDup) { toast('error', 'This barcode already exists in the system - change it first'); input.focus(); return; }
        saveBtn._pass = true; saveBtn.click();
      }, true);
    }
    if (input.value.trim()) check();
  }

  /* ---------------- wire one add-product window ---------------- */
  function init(form) {
    if (!form || form.dataset.draftGuard) return;
    if (form.id === 'product-form') {
      const btn = document.getElementById('product-save-btn');
      if (!btn || !/^add product/i.test(btn.textContent.trim())) return; // edit window: no draft
    }
    form.dataset.draftGuard = '1';
    const root = form.closest('.modal-backdrop') || form.closest('.modal') || form;
    // quick-add windows can be opened with a scanned barcode / typed name: one draft per such start value
    const seed = form.id === 'product-form' ? '' : (($('[name="barcode"]', form) || {}).value || ($('[name="name"]', form) || {}).value || '').trim();
    const key = `${PREFIX}${userId()}.${form.id}.${seed}`;

    const state = { key, root, form, submitted: false, timer: null };
    state.flush = () => {
      if (state.submitted) return;
      if (!document.body.contains(form)) return;
      if (!isMeaningful(root)) { store.del(key); return; }
      store.set(key, { at: Date.now(), data: snapshot(root) });
    };
    state.cancel = () => { clearTimeout(state.timer); };
    active = state;

    // restore
    const draft = store.get(key);
    if (draft && draft.data) {
      restoreVariantRows(root, draft.data);
      let pending = applyValues(root, draft.data);
      let tries = 0;
      const retry = setInterval(() => {            // categories load after the window opens
        tries += 1;
        if (pending) pending = applyValues(root, draft.data);
        if (!pending || tries > 15 || !document.body.contains(form)) clearInterval(retry);
      }, 300);
      const banner = document.createElement('div');
      banner.className = 'bc-draft-banner';
      banner.style.cssText = 'display:flex;gap:10px;align-items:center;justify-content:space-between;margin:0 0 12px;padding:8px 10px;border-radius:8px;background:#e8f1ff;border:1px solid #9ec1ff;color:#0b3d91;font-size:13px';
      const when = new Date(draft.at || Date.now()).toLocaleString();
      banner.innerHTML = `<span>📝 Your unsaved product (${when}) was restored.</span><button type="button" class="btn btn-secondary btn-sm">Discard draft</button>`;
      banner.querySelector('button').addEventListener('click', () => {
        store.del(key);
        $$('.variant-row', root).forEach((r) => r.remove());
        form.reset();
        $$('input, select, textarea', form).forEach((el) => { if (!skip(el)) fire(el); });
        banner.remove();
      });
      form.insertBefore(banner, form.firstChild);
    }

    // save as you type
    const schedule = () => { clearTimeout(state.timer); state.timer = setTimeout(state.flush, 200); };
    root.addEventListener('input', schedule, true);
    root.addEventListener('change', schedule, true);
    root.addEventListener('click', (e) => { if (e.target.closest('#add-variant-row-btn, [data-action="remove-variant-row"]')) setTimeout(schedule, 0); }, true);

    if (form.id === 'pb-qa-form') bindDupAlert(form, root);
  }

  function scan() {
    if (active && !document.body.contains(active.form)) { active.cancel(); active = null; }
    FORM_IDS.forEach((id) => { const f = document.getElementById(id); if (f) init(f); });
  }
  new MutationObserver(scan).observe(document.body, { childList: true, subtree: true });
  scan();

  // never lose the last keystrokes when the tab is closed / refreshed / hidden
  const flushNow = () => { if (active && !active.submitted) active.flush(); };
  window.addEventListener('pagehide', flushNow);
  window.addEventListener('beforeunload', flushNow);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushNow(); });
})();