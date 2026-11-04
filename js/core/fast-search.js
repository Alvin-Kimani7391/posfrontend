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
 *
 * No backend change: it only uses GET /products, exactly like the screens did before.
 */
(function (window) {
  const PAGE = 100;
  const MAX_PAGES = 30; // 3000 products on the device; bigger catalogs keep using the server

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
    const o = Object.assign({ params: () => ({}), ttl: 30000 }, opts || {});
    const st = { rows: [], full: false, key: '', at: 0, dirty: true, loading: null };
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
      const get = (page) => window.Api.get('/products', Object.assign({}, params, { page, limit: PAGE }), { background: true, timeoutMs: 30000 });
      const first = (await get(1)).data;
      const pages = first.pages || 1;
      let rows = (first.items || []).slice();
      if (pages > 1 && pages <= MAX_PAGES) {
        const rest = await Promise.all(Array.from({ length: pages - 1 }, (_, i) => get(i + 2).then((r) => (r.data.items || []))));
        rest.forEach((r) => { rows = rows.concat(r); });
      }
      st.rows = rows; st.full = pages <= MAX_PAGES; st.key = key; st.at = Date.now(); st.dirty = false;
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

    function load(force) {
      if (st.loading) return st.loading;
      if (!force && !st.dirty && st.key === keyOf() && Date.now() - st.at < o.ttl) return Promise.resolve(st.rows);
      st.loading = download().catch(() => restore()).then(() => { st.loading = null; return st.rows; });
      return st.loading;
    }

    /** Local rows are usable only if they are complete, were loaded for the current params and are not known to be outdated. */
    function usable() {
      if (st.key !== keyOf()) { st.full = false; st.dirty = true; load(); return false; }
      if (st.dirty) { load(); return false; }
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

    return {
      load,
      isReady: () => usable(),
      invalidate() { st.dirty = true; st.loading = null; },
      search(term, limit) { return usable() ? match(term).slice(0, limit || 15) : null; },
      query({ search, categoryId, page, limit } = {}) {
        if (!usable()) return null;
        let rows = match(search);
        if (categoryId) rows = rows.filter((p) => String(p.categoryId && p.categoryId._id ? p.categoryId._id : p.categoryId) === String(categoryId));
        const lim = limit || 10; const pg = Math.max(1, page || 1);
        const total = rows.length; const pages = Math.max(1, Math.ceil(total / lim));
        return { items: rows.slice((pg - 1) * lim, pg * lim), page: Math.min(pg, pages), limit: lim, total, pages };
      },
    };
  }

  window.FastSearch = { create };
})(window);