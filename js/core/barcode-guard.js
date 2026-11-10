/**
 * barcode-guard.js - ONE shared barcode brain for Products, Sales (built-in + Quick add) and Inventory.
 *
 *   BarcodeGuard.normalize(code)                  trims and removes scanner control characters
 *   BarcodeGuard.check(code, opts)                -> { exists, name?, kind?, unknown? }   ASKS THE SERVER (the only source of truth)
 *   BarcodeGuard.bind(input, opts)                live red / green message under a barcode box (+ input._bcCheck / input._bcDup)
 *   BarcodeGuard.generate(extraUsed?)             -> a new EAN-13 that the server confirmed is free
 *   BarcodeGuard.attachSearchScan(input, {onCode})   puts a camera icon INSIDE a search box
 *
 * WHY: the old checks trusted copies kept in the browser (a list of "used" barcodes, the device catalog). Those
 * copies were never cleaned when a product was deleted, and "Generate" even added its new code to the list, so the
 * very next check said "already exists". Now the browser never decides "exists" from a copy: only the server does
 * (GET /products/barcode-check/:code, which ignores archived/deleted products). A copy is used ONLY when the
 * server cannot be reached at all (offline), and then only through opts.local.
 */
(function (window) {
  'use strict';

  const normalize = (v) => String(v == null ? '' : v).replace(/[\u0000-\u001F\u007F]/g, '').trim();

  /* ------------------------------------------------------------------ server check */
  async function serverCheck(code, opts) {
    const q = {};
    if (opts.excludeProductId) q.excludeProductId = opts.excludeProductId;
    if (opts.excludeVariantId) q.excludeVariantId = opts.excludeVariantId;
    const get = (path, query) => window.Api.get(path, query, { fresh: true, background: true });
    try {
      const { data } = await get(`/products/barcode-check/${encodeURIComponent(code)}`, q);
      return { exists: !!(data && data.exists), name: (data && data.name) || '', kind: (data && data.kind) || '', productId: data && data.productId };
    } catch (err) {
      if (err && err.code === 'BARCODE_NOT_FOUND') return { exists: false };
      // Older server without the new endpoint (404): use the old lookup (404 there = free). Any other failure = unknown.
      if (err && err.status === 404) {
        try {
          const { data } = await get(`/products/barcode/${encodeURIComponent(code)}`);
          const p = data && (data.product || data);
          if (p && (p._id || p.name)) return { exists: true, name: p.name || '', kind: 'product' };
          return { exists: false };
        } catch (e2) {
          if (e2 && (e2.code === 'BARCODE_NOT_FOUND' || e2.status === 404)) return { exists: false };
          throw e2;
        }
      }
      throw err;
    }
  }

  /** opts: { excludeProductId, excludeVariantId, local(code) -> {name}|null  (used ONLY when the server is unreachable) } */
  async function check(rawCode, opts = {}) {
    const code = normalize(rawCode);
    if (!code) return { exists: false, empty: true };
    try {
      return await serverCheck(code, opts);
    } catch (err) {
      const unreachable = !err || !err.status || err.status >= 500 || err.status === 0;
      if (!unreachable) return { exists: false, unknown: true, error: err.message };
      let hit = null;
      try { hit = typeof opts.local === 'function' ? opts.local(code) : null; } catch { /* ignore */ }
      return hit ? { exists: true, name: hit.name || '', offline: true } : { exists: false, unknown: true, offline: true };
    }
  }

  /* ------------------------------------------------------------------ live message under a barcode box */
  function bind(input, opts = {}) {
    if (!input || input._bcLive) return input && input._bcCheck;
    input._bcLive = true;
    const field = input.closest('.field') || input.parentElement;
    const msg = document.createElement('div');
    msg.className = 'bc-dup-msg';
    msg.setAttribute('role', 'alert');
    msg.style.cssText = 'display:none;margin-top:6px;padding:8px 10px;border-radius:6px;font-weight:600;font-size:13px';
    field.appendChild(msg);
    let timer = null, seq = 0, lastToasted = '';

    const setState = (kind, text) => {           // kind: 'dup' | 'free' | ''
      const dup = kind === 'dup';
      input._bcDup = dup;
      input.classList.toggle('bc-dup', dup);
      input.style.borderColor = dup ? '#d93025' : '';
      input.style.boxShadow = dup ? '0 0 0 3px rgba(217,48,37,.25)' : '';
      input.style.background = dup ? '#fff5f4' : '';
      msg.style.display = kind ? '' : 'none';
      msg.style.background = dup ? '#fdecea' : '#e7f8ef';
      msg.style.border = `1px solid ${dup ? '#d93025' : '#12b76a'}`;
      msg.style.color = dup ? '#b3140a' : '#067647';
      msg.textContent = kind ? text : '';
      if (typeof opts.onState === 'function') { try { opts.onState(kind, input); } catch { /* ignore */ } }
    };
    const dupText = (name) => `⚠ BARCODE ALREADY EXISTS in the system${name ? ` — product: "${name}"` : ''}. Use a different barcode.`;
    const own = () => { const o = typeof opts.ownCodes === 'function' ? opts.ownCodes() : opts.ownCodes; return (o || []).map(normalize).filter(Boolean); };

    const run = async (final) => {
      const code = normalize(input.value); const my = ++seq;
      if (!code) { setState(''); return false; }
      if (own().includes(code)) { setState(''); return false; }                      // the record's own barcode is never a duplicate
      if (typeof opts.scope === 'object' && opts.scope) {                               // same code typed twice in one form
        const twin = Array.from(opts.scope.querySelectorAll('input[name="barcode"], input[name^="v-barcode-"], #p-pk-barcode'))
          .some((el) => el !== input && normalize(el.value) === code);
        if (twin) { setState('dup', `⚠ Barcode ${code} is already used in another field of this form.`); return true; }
      }
      if (!final) { setState(''); return false; }                                       // while typing: wait for the pause
      const r = await check(code, { excludeProductId: opts.excludeProductId, excludeVariantId: opts.excludeVariantId, local: opts.local });
      if (my !== seq) return input._bcDup === true;                                     // a newer check superseded this one
      if (r.exists) {
        setState('dup', dupText(r.name));
        if (lastToasted !== code) { lastToasted = code; try { window.UI.toast.error(`Barcode ${code} already exists${r.name ? ` (${r.name})` : ''}`); } catch { /* ignore */ } }
        try { input.focus(); input.select(); } catch { /* ignore */ }
        return true;
      }
      setState(r.unknown ? '' : 'free', r.unknown ? '' : '✓ Barcode is free - you can add this product.');
      return false;
    };

    input._bcCheck = () => { clearTimeout(timer); return run(true); };
    input.addEventListener('input', () => { setState(''); clearTimeout(timer); timer = setTimeout(() => run(true), 350); });
    input.addEventListener('change', () => { clearTimeout(timer); run(true); });
    input.addEventListener('blur', () => { clearTimeout(timer); run(true); });
    if (normalize(input.value)) run(true);
    return input._bcCheck;
  }

  /* ------------------------------------------------------------------ generation */
  const handedOut = new Set(); // codes given out on THIS page that are not saved yet (never treated as "existing")
  let catalogPromise = null, catalogAt = 0;
  async function knownCodes(force) {
    if (!window.BarcodeLabels) return new Set();
    if (!force && catalogPromise && Date.now() - catalogAt < 60000) return catalogPromise.then((s) => new Set(s));
    catalogAt = Date.now();
    catalogPromise = window.BarcodeLabels.loadCatalog().then((c) => c.used).catch(() => new Set());
    return catalogPromise.then((s) => new Set(s));            // always a COPY: generating must never change the shared list
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const sc = document.createElement('script'); sc.src = src; sc.onload = resolve; sc.onerror = () => reject(new Error(`load ${src}`));
      document.head.appendChild(sc);
    });
  }
  async function ensureLabels() {
    if (window.BarcodeLabels && window.Barcode) return;
    if (!window.Barcode) await loadScript('js/core/barcode.js');
    if (!window.BarcodeLabels) await loadScript('js/core/barcode-labels.js');
  }

  /** New in-store EAN-13, confirmed free by the server. extraUsed = codes typed in other boxes of the open form. */
  async function generate(extraUsed) {
    await ensureLabels();
    if (!window.BarcodeLabels) throw new Error('Barcode generator did not load - refresh the page');
    const used = await knownCodes(false);
    handedOut.forEach((c) => used.add(c));
    (extraUsed || []).forEach((c) => { const n = normalize(c); if (n) used.add(n); });
    let lastErr = null;
    for (let i = 0; i < 8; i++) {
      const code = window.BarcodeLabels.generateCode(used);   // adds to OUR copy only
      const r = await check(code);
      if (!r.exists) { handedOut.add(code); return code; }
      used.add(code); lastErr = new Error('exists');
      if (i === 3) { const fresh = await knownCodes(true); fresh.forEach((c) => used.add(c)); }
    }
    throw lastErr || new Error('Could not generate a free barcode');
  }
  /** Call after the product is saved (or the box is cleared) so the code is not kept in the "handed out" list. */
  function forget(code) { handedOut.delete(normalize(code)); catalogPromise = null; }

  /* ------------------------------------------------------------------ camera icon inside a search box */
  const STYLE_ID = 'bg-search-scan-style';
  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const st = document.createElement('style'); st.id = STYLE_ID;
    st.textContent = `
      .bg-search-wrap{position:relative;display:flex;align-items:center;flex:1 1 auto;min-width:0}
      .bg-search-wrap>.input{width:100%;padding-right:46px}
      .bg-search-scan{position:absolute;right:5px;top:50%;transform:translateY(-50%);width:36px;height:36px;padding:0;border:0;border-radius:8px;background:transparent;color:var(--color-primary,#ff6600);display:inline-flex;align-items:center;justify-content:center;cursor:pointer;transition:background .15s}
      .bg-search-scan:hover{background:var(--color-primary-50,#fff4ec)}
      .bg-search-scan:active{transform:translateY(-50%) scale(.94)}
      .bg-search-scan svg{width:20px;height:20px}`;
    document.head.appendChild(st);
  }

  /** opts: { onCode(code), title, hint }.  The icon sits inside the input on the right and opens the phone / webcam scanner. */
  function attachSearchScan(input, opts = {}) {
    if (!input || input._bgScan) return null;
    input._bgScan = true;
    ensureStyle();
    const host = input.parentNode;
    const wrap = document.createElement('span');
    wrap.className = 'bg-search-wrap';
    host.insertBefore(wrap, input);
    wrap.appendChild(input);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'bg-search-scan';
    btn.title = 'Scan barcode with the camera';
    btn.setAttribute('aria-label', 'Scan barcode with the camera');
    btn.innerHTML = (window.BarcodeScanner && window.BarcodeScanner.cameraIconSvg) || '<i class="fa-solid fa-camera"></i>';
    btn.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      if (!window.BarcodeScanner) { try { window.UI.toast.error('Scanner did not load - refresh the page'); } catch { /* ignore */ } return; }
      try { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); } catch { /* ignore */ }
      window.BarcodeScanner.openCameraModal({
        title: opts.title || 'Scan barcode',
        hint: opts.hint || 'Point the camera at the product barcode',
        onDetect: (code) => { const v = normalize(code); if (v && typeof opts.onCode === 'function') opts.onCode(v); },
      });
    });
    wrap.appendChild(btn);
    return btn;
  }

  window.BarcodeGuard = { normalize, check, bind, generate, forget, attachSearchScan };
})(window);
