/* Hardware workspace — speed layer.
   Forms and pickers felt slow because every open waited on the server for lists that almost never change
   (categories, suppliers, drivers, templates, shelf locations) and every product search was a round trip.
   This file: (1) caches those lookups in memory + sessionStorage (stale-while-revalidate, so a form opens at once
   and refreshes quietly), (2) shares one request between callers, (3) loads the product list once and searches it
   locally, (4) warms everything up right after sign-in. Any save/delete clears the caches so nothing goes stale. */
(function () {
  const { Api, Storage } = window, HW = window.HW;
  if (!Api || !HW || Api.__fast) return;
  Api.__fast = true;

  const TTL = { '/categories': 300e3, '/branches': 300e3, '/suppliers': 180e3, '/employees': 300e3, '/hardware/settings': 300e3, '/hardware/templates': 300e3, '/hardware/locations': 120e3, '/hardware/transport/vehicles': 60e3, '/business/profile': 300e3, '/units': 600e3 };
  const mem = new Map(), inflight = new Map(), SS = 'hw.cache.v1:';
  const uid = () => { try { const u = Storage.getUser(); return (u && (u._id || u.id)) || ''; } catch (e) { return ''; } };
  const keyOf = (path, q) => `${uid()}|${path}|${q ? JSON.stringify(q) : ''}`;
  const clone = (v) => { try { return structuredClone(v); } catch (e) { return JSON.parse(JSON.stringify(v)); } };
  const ssGet = (k) => { try { const r = sessionStorage.getItem(SS + k); return r ? JSON.parse(r) : null; } catch (e) { return null; } };
  const ssSet = (k, v) => { try { sessionStorage.setItem(SS + k, JSON.stringify(v)); } catch (e) { /* full or blocked */ } };
  const ssClear = () => { try { Object.keys(sessionStorage).filter((k) => k.startsWith(SS)).forEach((k) => sessionStorage.removeItem(k)); } catch (e) { /* ignore */ } };

  const rawGet = Api.get.bind(Api);
  function fetchFresh(path, q, opts, key) {
    if (inflight.has(key)) return inflight.get(key);
    const p = rawGet(path, q, opts).then((v) => { const rec = { t: Date.now(), v }; mem.set(key, rec); ssSet(key, rec); return v; }).finally(() => inflight.delete(key));
    inflight.set(key, p); return p;
  }
  Api.get = (path, q, opts) => {
    const ttl = TTL[path];
    if (!ttl || (q && q.nocache)) return rawGet(path, q, opts);
    const key = keyOf(path, q); let rec = mem.get(key);
    if (!rec) { rec = ssGet(key); if (rec) mem.set(key, rec); }
    if (rec) {
      const age = Date.now() - rec.t;
      if (age < ttl) return Promise.resolve(clone(rec.v));
      if (age < 3600e3) { fetchFresh(path, q, opts, key).catch(() => {}); return Promise.resolve(clone(rec.v)); } // stale: show now, refresh quietly
    }
    return fetchFresh(path, q, opts, key).then(clone);
  };
  /** Anything that changes data throws the lookup caches away (cheap, and they refill on next use). */
  const clearAll = () => { mem.clear(); ssClear(); HW.flush && HW.flush(); if (HW.productIndex) HW.productIndex.dirty = true; };
  ['post', 'put', 'patch', 'delete'].forEach((m) => { const o = Api[m].bind(Api); Api[m] = (...a) => o(...a).then((r) => { clearAll(); return r; }); });
  HW.clearCache = clearAll;

  /* ---------- product index: load once, search on the device ---------- */
  const PI = HW.productIndex = { rows: [], full: false, loading: null, dirty: false };
  const list = (d) => (HW.list ? HW.list(d) : (d && d.items) || []);
  HW.loadProducts = (force) => {
    if (PI.loading && !force) return PI.loading;
    if (!force && PI.rows.length && !PI.dirty) return Promise.resolve(PI.rows);
    PI.dirty = false;
    PI.loading = (async () => {
      let rows = [], page = 1, pages = 1;
      try {
        do { const { data } = await rawGet('/products', { page, limit: 100, status: 'active' }); rows = rows.concat(list(data)); pages = data.pages || 1; page++; } while (page <= pages && page <= 15);
        PI.rows = rows; PI.full = pages <= 15;
      } catch (e) { /* offline: keep what we had */ }
      PI.loading = null; return PI.rows;
    })();
    return PI.loading;
  };
  const norm = (s) => String(s || '').toLowerCase();
  HW.searchProducts = async (term) => {
    const t = norm(term).trim(); if (!t) return [];
    if (PI.dirty) HW.loadProducts(true);
    if (PI.loading && !PI.rows.length) await PI.loading;
    if (PI.full && PI.rows.length) {
      const hit = PI.rows.filter((p) => norm(p.name).includes(t) || norm(p.sku).includes(t) || norm(p.barcode).includes(t) || norm(p.brand).includes(t));
      hit.sort((a, b) => (norm(a.name).startsWith(t) ? 0 : 1) - (norm(b.name).startsWith(t) ? 0 : 1)); return hit.slice(0, 20);
    }
    return list((await rawGet('/products', { search: term, limit: 20, status: 'active' })).data);
  };
  if (HW.pickers && HW.pickers.product) HW.pickers.product.fetch = HW.searchProducts;

  /* ---------- warm everything up once the app is open ---------- */
  HW.prefetch = () => {
    if (!Storage.isAuthenticated()) return;
    const go = () => {
      [() => HW.opt.drivers(), () => HW.opt.suppliers(), () => HW.opt.categories(), () => Api.get('/hardware/templates'), () => HW.opt.locations(), () => HW.loadProducts()].forEach((f, i) => setTimeout(() => { try { Promise.resolve(f()).catch(() => {}); } catch (e) { /* ignore */ } }, i * 150));
    };
    (window.requestIdleCallback || ((f) => setTimeout(f, 600)))(go);
  };
  window.addEventListener('DOMContentLoaded', () => setTimeout(HW.prefetch, 1200));
})();
