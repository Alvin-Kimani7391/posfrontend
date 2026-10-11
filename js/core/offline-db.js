/**
 * offline-db.js
 * Local database for offline selling. Plain IndexedDB, no libraries.
 *
 *   kv         small settings (device id, counters, cursors, grants...)
 *   products / variants / categories / registers   the catalog copy (money in integer cents, NO cost prices)
 *   outbox     events waiting to be sent: SALE, SHIFT_OPEN, SHIFT_CLOSE (encrypted bodies)
 *   issues     events the server held/rejected (the server keeps a copy; this is the cashier's notice)
 *   receipts   every offline sale's receipt data (encrypted) for reprints
 *
 * VAULT: sensitive values (device secret, grants, PIN verifiers, sale bodies with customer phones) are
 * encrypted with AES-GCM using a NON-EXTRACTABLE key kept in IndexedDB. Be honest about what this buys:
 * it stops casual copying of the stored data and the secret leaking in backups/exports, but anyone who
 * can run code inside this browser profile can still use the key. A stolen till must be BLOCKED from
 * the Devices screen; that is the real control.
 *
 * Also defines window.Offline (shared namespace) with a tiny event emitter: Offline.on(evt, fn).
 */
(function (window) {
  'use strict';

  const Offline = (window.Offline = window.Offline || {});
  const listeners = {};
  Offline.on = (evt, fn) => { (listeners[evt] = listeners[evt] || new Set()).add(fn); return () => listeners[evt].delete(fn); };
  Offline.emit = (evt, detail) => { (listeners[evt] || []).forEach((fn) => { try { fn(detail); } catch (e) { console.error('[offline] listener failed', e); } }); };

  const DB_NAME = 'pos-offline';
  const DB_VERSION = 1;
  const SCHEMA = {
    kv: { keyPath: 'k' },
    products: { keyPath: 'id', indexes: { barcode: 'barcode', sku: 'sku' } },
    variants: { keyPath: 'id', indexes: { barcode: 'barcode', productId: 'productId' } },
    categories: { keyPath: 'id' },
    registers: { keyPath: 'id' },
    outbox: { keyPath: 'outboxSeq' },
    issues: { keyPath: 'ref' },
    receipts: { keyPath: 'receiptNumber', indexes: { soldAt: 'soldAt' } },
  };

  let dbPromise = null;
  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      if (!window.indexedDB) { reject(new Error('This browser cannot store data offline (IndexedDB missing).')); return; }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        Object.entries(SCHEMA).forEach(([name, cfg]) => {
          if (db.objectStoreNames.contains(name)) return;
          const os = db.createObjectStore(name, { keyPath: cfg.keyPath });
          Object.entries(cfg.indexes || {}).forEach(([idx, path]) => os.createIndex(idx, path));
        });
      };
      req.onsuccess = () => { const db = req.result; db.onversionchange = () => db.close(); resolve(db); };
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  const wrapReq = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const wrapStore = (os) => ({
    get: (k) => wrapReq(os.get(k)),
    put: (v) => wrapReq(os.put(v)),
    delete: (k) => wrapReq(os.delete(k)),
    getAll: () => wrapReq(os.getAll()),
    count: () => wrapReq(os.count()),
    clear: () => wrapReq(os.clear()),
    byIndex: (idx, key) => wrapReq(os.index(idx).getAll(key)),
  });

  /**
   * run(storeNames, mode, async (stores) => result)
   * Everything inside fn must only await IndexedDB calls (never fetch / crypto), or the browser
   * commits the transaction early. That is why sale bodies are encrypted BEFORE run() is called.
   */
  async function run(names, mode, fn) {
    const db = await open();
    const list = Array.isArray(names) ? names : [names];
    const tx = db.transaction(list, mode);
    const stores = {};
    list.forEach((n) => { stores[n] = wrapStore(tx.objectStore(n)); });
    const done = new Promise((res, rej) => {
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
      tx.onabort = () => rej(tx.error || new Error('Local database transaction aborted'));
    });
    let out;
    try {
      out = await fn(stores);
    } catch (e) {
      done.catch(() => {});
      try { tx.abort(); } catch { /* already finished */ }
      throw e;
    }
    await done;
    return out;
  }

  const kvGet = async (k) => { const r = await run('kv', 'readonly', (s) => s.kv.get(k)); return r ? r.v : undefined; };
  const kvSet = (k, v) => run('kv', 'readwrite', (s) => s.kv.put({ k, v }));
  const kvDel = (k) => run('kv', 'readwrite', (s) => s.kv.delete(k));
  /** Atomic "get or create": two tabs starting at once end up with the SAME value. */
  const kvInit = (k, value) => run('kv', 'readwrite', async (s) => {
    const cur = await s.kv.get(k);
    if (cur) return cur.v;
    await s.kv.put({ k, v: value });
    return value;
  });
  const getAll = (store) => run(store, 'readonly', (s) => s[store].getAll());
  const count = (store) => run(store, 'readonly', (s) => s[store].count());
  const bulkPut = (store, rows) => (rows.length ? run(store, 'readwrite', (s) => Promise.all(rows.map((r) => s[store].put(r)))) : Promise.resolve());
  const bulkDelete = (store, keys) => (keys.length ? run(store, 'readwrite', (s) => Promise.all(keys.map((k) => s[store].delete(k)))) : Promise.resolve());
  const clearStore = (store) => run(store, 'readwrite', (s) => s[store].clear());

  /* ------------------------------ vault ------------------------------ */
  const te = new TextEncoder();
  const td = new TextDecoder();
  function b64(buf) {
    const bytes = new Uint8Array(buf);
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }
  const unb64 = (str) => Uint8Array.from(atob(str), (c) => c.charCodeAt(0));

  let keyPromise = null;
  function vaultKey() {
    if (keyPromise) return keyPromise;
    keyPromise = (async () => {
      if (!window.crypto || !window.crypto.subtle) return null;
      const existing = await kvGet('vaultKey');
      if (existing) return existing;
      const fresh = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
      return kvInit('vaultKey', fresh); // if another tab won the race, we use ITS key
    })();
    return keyPromise;
  }

  async function encrypt(obj) {
    const json = JSON.stringify(obj);
    const key = await vaultKey();
    if (!key) return `p0.${b64(te.encode(json))}`; // no WebCrypto (insecure context): stored unencrypted, flagged by prefix
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, te.encode(json));
    return `v1.${b64(iv)}.${b64(ct)}`;
  }

  async function decrypt(str) {
    if (typeof str !== 'string') return str;
    const parts = str.split('.');
    if (parts[0] === 'p0') return JSON.parse(td.decode(unb64(parts[1])));
    if (parts[0] !== 'v1') throw new Error('Unknown local data format');
    const key = await vaultKey();
    if (!key) throw new Error('This browser cannot decrypt the stored data');
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(parts[1]) }, key, unb64(parts[2]));
    return JSON.parse(td.decode(pt));
  }

  window.OfflineDB = {
    open, run, kvGet, kvSet, kvDel, kvInit, getAll, count, bulkPut, bulkDelete, clearStore,
    vault: { encrypt, decrypt },
    util: { b64, unb64 },
  };
})(window);