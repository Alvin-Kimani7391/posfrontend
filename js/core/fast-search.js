/**
 * fast-search.js - instant product search for the Products page and the Sales till.
 *
 * Why: every keystroke used to wait (debounce + a server round trip + a "Searching..." flash).
 * Now the product list is downloaded ONCE in the background (pages of 100, fetched in parallel), kept in memory,
 * and searched on the device in under a millisecond. The server is still the fallback:
 *   - while the list is still downloading, or when the shop has more than MAX_PAGES x 100 products
 *   - right after a product was edited (the index is marked "dirty" until it has reloaded)
 *
 *   const idx = FastSearch.create({ params: () => ({ status: 'active' }), ttl: 30000 });
 *   idx.load();                       // warm up (safe to call many times)
 *   idx.search('milk', 15)            // -> array, or null when the server has to answer
 *   idx.query({ search, categoryId, page, limit })   // -> { items, page, limit, total, pages } or null
 *   idx.invalidate();                 // after a product changed
 *   idx.lookupCode('6001234567890')   // -> { product, variant, unitId } by exact barcode / SKU / packet barcode, or null (O(1), instant)
 *   idx.refreshSoon(45000)            // quiet background reload, at most once per 45 s (used after every sale)
 *
 * SPEED (v2):
 *   - ONE request: GET /products/catalog returns the whole list at once (falls back to the old paged download when the
 *     server does not have that route yet, so old and new backends both work).
 *   - opts.hydrate    : the copy saved on this device (IndexedDB) is loaded at once when the page opens, so the very first
 *                       scan / search is instant; the fresh list replaces it a moment later.
 *   - opts.serveStale : after invalidate() the till keeps answering from the old copy while the fresh one downloads.
 *                       A search that finds NOTHING in a stale copy is handed to the server (a product added a second ago is still found).
 */
(function (window) {
  const PAGE = 100;
  const MAX_PAGES = 30; // 3000 products on the device (paged download); bigger catalogs keep using the server
  const CATALOG_MAX = 5000; // the one-request download (GET /products/catalog) serves up to this many

  /* Device copy of the product list (IndexedDB), so search still works right after a reload with no internet. */
  const idb = {
    open() {
      if (this._p) return this._p;
      this._p = new Promise((res, rej) => {
        if (!window.indexedDB) return rej(new Error('no idb'));
        const r = indexedDB.open('pos-fastsearch', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('rows');
        r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
      });
      return this._p;
    },
    async get(k) { const db = await this.open(); return new Promise((res) => { const q = db.transaction('rows').objectStore('rows').get(k); q.onsuccess = () => res(q.result || null); q.onerror = () => res(null); }); },
    async set(k, v) { try { const db = await this.open(); db.transaction('rows', 'readwrite').objectStore('rows').put(v, k); } catch { /* ignore */ } },
  };
  const overlay = (rows) => (window.PosBoost && window.PosBoost.overlay ? window.PosBoost.overlay(rows) : rows);

  function create(opts) {
    const o = Object.assign({ params: () => ({}), ttl: 30000, hydrate: false, serveStale: false }, opts || {});
    const st = { rows: [], full: false, key: '', at: 0, dirty: true, loading: null, codes: null, codesFor: null, hydrated: false };
    let hydrating = null;
    const keyOf = () => JSON.stringify(o.params() || {});
    const low = (s) => String(s == null ? '' : s).toLowerCase();

    function hay(p) {
      if (p._fh) return p._fh;
      let h = `${low(p.name)} ${low(p.sku)} ${low(p.barcode)} ${low(p.brand)} ${low(p.code)}`;
      (p.variants || []).forEach((v) => { h += ` ${low(v.sku)} ${low(v.barcode)}`; });
      (p.units || []).forEach((u) => { h += ` ${low(u.barcode)}`; });
      try { Object.defineProperty(p, '_fh', { value: h, enumerable: false }); } catch { p._fh = h; }
      return h;
    }

    async function download() {
      const params = o.params() || {};
      const key = keyOf();
      let rows = null; let full = false;
      const plain = Object.keys(params).every((k) => k === 'status' || k === 'channel' || k === 'branchId' || params[k] === undefined || params[k] === '');
      if (plain) try { // ONE request for the whole list (only for the filters /products/catalog understands)
        const r = await window.Api.get('/products/catalog', params, { background: true, timeoutMs: 45000 });
        const d = r.data || {};
        if (Array.isArray(d.items)) { rows = d.items; full = (d.total || rows.length) <= rows.length && rows.length <= CATALOG_MAX; }
      } catch (e) { if (e && e.code === 'NETWORK_ERROR') throw e; /* old backend without /catalog: use the paged download below */ }
      if (!rows) {
        const get = (page) => window.Api.get('/products', Object.assign({}, params, { page, limit: PAGE }), { background: true, timeoutMs: 30000 });
        const first = (await get(1)).data;
        const pages = first.pages || 1;
        rows = (first.items || []).slice();
        if (pages > 1 && pages <= MAX_PAGES) {
          const rest = await Promise.all(Array.from({ length: pages - 1 }, (_, i) => get(i + 2).then((r) => (r.data.items || []))));
          rest.forEach((r) => { rows = rows.concat(r); });
        }
        full = pages <= MAX_PAGES;
      }
      st.rows = rows; st.full = full; st.key = key; st.at = Date.now(); st.dirty = false; st.codes = null;
      if (st.full) idb.set(key, { rows, at: st.at });
    }

    /** No internet / server error: fall back to the copy saved on this device so search never goes dead. */
    async function restore() {
      const key = keyOf();
      if (!st.rows.length) {
        const saved = await idb.get(key).catch(() => null);
        if (saved && saved.rows && saved.rows.length) { st.rows = saved.rows; st.full = true; }
      }
      if (st.rows.length) { st.key = key; st.dirty = false; st.at = Date.now() - o.ttl + 8000; } // serve it, retry the server in ~8 s
    }

    /** Load the copy saved on this device into memory (instant), so the first search / scan never waits for the network. */
    function hydrate() {
      if (!o.hydrate || st.hydrated || hydrating || st.rows.length) return hydrating;
      const key = keyOf();
      hydrating = idb.get(key).catch(() => null).then((saved) => {
        st.hydrated = true; hydrating = null;
        if (saved && saved.rows && saved.rows.length && !st.rows.length) {
          st.rows = saved.rows; st.full = true; st.key = key; st.dirty = false; st.codes = null;
          st.at = 0; // old: answer from it now, refresh straight away
        }
      });
      return hydrating;
    }

    function load(force) {
      if (st.loading) return st.loading;
      if (!force && !st.dirty && st.key === keyOf() && Date.now() - st.at < o.ttl) return Promise.resolve(st.rows);
      st.loading = Promise.resolve(hydrate()).then(() => download()).catch(() => restore()).then(() => { st.loading = null; return st.rows; });
      return st.loading;
    }

    /** Local rows are usable only if they are complete, were loaded for the current params and are not known to be outdated. */
    function usable() {
      if (st.key !== keyOf()) { st.full = false; st.dirty = true; load(); return false; } // other branch / filter: never answer from the wrong list
      if (st.dirty) {
        load();
        // serveStale: keep answering from the old copy while the fresh one downloads (misses go to the server, see search())
        return !!(o.serveStale && st.rows.length && st.full);
      }
      if (!st.full || !st.rows.length) return false;
      if (Date.now() - st.at > o.ttl) load(); // stale-while-revalidate: answer now, refresh quietly
      return true;
    }

    function match(term) {
      const t = low(term).trim();
      const all = overlay(st.rows);
      if (!t) return all;
      const words = t.split(/\s+/);
      const out = [];
      for (const p of all) {
        if (!words.every((w) => hay(p).includes(w))) continue;
        const name = low(p.name);
        const rank = (low(p.sku) === t || low(p.barcode) === t) ? 0 : name.startsWith(t) ? 1 : name.split(/[\s\-_/]+/).some((w) => w.startsWith(words[0])) ? 2 : 3;
        out.push({ p, rank });
      }
      return out.sort((a, b) => a.rank - b.rank).map((x) => x.p);
    }

    /** Exact barcode / SKU / variant / packet-barcode lookup in a Map: instant however big the catalog is. */
    function codeMap() {
      const rows = overlay(st.rows);
      if (st.codes && st.codesFor === rows) return st.codes;
      const m = new Map();
      const put = (k, v) => { const t = low(k).trim(); if (t && !m.has(t)) m.set(t, v); };
      for (const p of rows) {
        if (p._pending) continue;
        put(p.barcode, { product: p, variant: null }); put(p.sku, { product: p, variant: null });
        (p.variants || []).forEach((v) => { put(v.barcode, { product: p, variant: v }); put(v.sku, { product: p, variant: v }); });
        (p.units || []).forEach((u) => { if (u.status !== 'inactive' && u.barcode) put(u.barcode, { product: p, variant: null, unitId: String(u._id) }); });
      }
      st.codes = m; st.codesFor = rows;
      return m;
    }

    let lastSoon = 0;
    return {
      load,
      isReady: () => usable(),
      invalidate() { st.dirty = true; st.loading = null; st.codes = null; },
      /** Quiet reload, at most once per minAge ms. The list keeps answering searches while it downloads. */
      refreshSoon(minAge) {
        const age = Date.now() - Math.max(st.at, lastSoon);
        if (st.loading || age < (minAge || 45000)) return st.loading || Promise.resolve(st.rows);
        lastSoon = Date.now();
        return load(true);
      },
      /** Exact code match from the device copy -> { product, variant, unitId? } | null (null also when the server has to answer). */
      lookupCode(code) {
        if (!usable()) return null;
        return codeMap().get(low(code).trim()) || null;
      },
      search(term, limit) {
        if (!usable()) return null;
        const r = match(term).slice(0, limit || 15);
        return !r.length && st.dirty ? null : r; // nothing found in an out-of-date copy: ask the server
      },
      query({ search, categoryId, page, limit } = {}) {
        if (!usable()) return null;
        let rows = match(search);
        if (categoryId) rows = rows.filter((p) => String(p.categoryId && p.categoryId._id ? p.categoryId._id : p.categoryId) === String(categoryId));
        if (!rows.length && st.dirty) return null;
        const lim = limit || 10; const pg = Math.max(1, page || 1);
        const total = rows.length; const pages = Math.max(1, Math.ceil(total / lim));
        return { items: rows.slice((pg - 1) * lim, pg * lim), page: Math.min(pg, pages), limit: lim, total, pages };
      },
    };
  }

  window.FastSearch = { create };
})(window);