/**
 * offline-sync.js
 * The engine of offline mode:
 *   Offline.time      tamper-resistant clock (never runs backwards)
 *   Offline.device    this till's identity (deviceId + secret) and enrollment
 *   Offline.context   business / branch / receipt settings / policy / registers cached for offline use
 *   Offline.grants    signed "offline grants" issued by the server (who may sell, until when, with what limits)
 *   Offline.catalog   product catalog copy (cents, no cost prices) + fast search + barcode lookup
 *   Offline.outbox    events waiting to reach the server, written ATOMICALLY with their counters
 *   Offline.sync      the push engine (ordered, resumable, multi-tab safe)
 *   Offline.backup    passphrase-encrypted export of unsynced data (last resort)
 *   Offline.status()  one snapshot for the UI
 *
 * RULES THIS FILE ENFORCES
 *  - A sale is "saved" only once it is committed to IndexedDB (receipt number + sequence numbers in the same transaction).
 *  - Nothing is ever dropped silently: server-held / rejected events move to the Issues list.
 *  - The server decides; the till never marks a sale "accepted" unless the server said so.
 */
(function (window) {
  'use strict';
  const Offline = (window.Offline = window.Offline || {});
  const DB = window.OfflineDB;
  const APP_VERSION = 'web-offline-1';
  const uid = () => (window.crypto?.randomUUID ? crypto.randomUUID().replace(/-/g, '') : `${Date.now().toString(16)}${Math.random().toString(16).slice(2, 14)}`.padEnd(32, '0'));
  const userOf = () => window.Storage.getUser();
  const userIdOf = (u) => (u ? String(u._id || u.id || '') : '');

  /* ------------------------------ time ------------------------------ */
  const T = (Offline.time = {
    last: 0,
    now() { const w = Date.now(); if (w > T.last) T.last = w; return T.last; },
    sync(serverIso) { const t = new Date(serverIso).getTime(); if (Number.isFinite(t)) { T.last = t; T.persist(); } },
    persist() { DB.kvSet('lastSeen', T.last).catch(() => {}); },
  });

  /* ------------------------------ device ------------------------------ */
  let secret = null;
  const D = (Offline.device = {
    _id: null,
    async load() {
      D._id = await DB.kvInit('deviceId', uid());
      const s = await DB.kvGet('deviceSecret');
      secret = s ? await DB.vault.decrypt(s) : null;
    },
    id: () => D._id,
    enrolled: () => !!secret,
    headers: () => ({ 'X-Device-Secret': secret }),
    /** A manager, online, on THIS till, registers it. The secret is shown by the server once and stored encrypted here. */
    async enroll({ branchId, deviceName, mode, offlineEnabled }) {
      const { data } = await window.Api.post('/devices/enroll', { branchId, deviceId: D._id, deviceName, deviceType: 'POS', mode, offlineEnabled: !!offlineEnabled });
      secret = data.deviceSecret;
      await DB.kvSet('deviceSecret', await DB.vault.encrypt(secret));
      await C.refresh();
      Offline.emit('readiness');
      return data.device;
    },
    /** Only when nothing is waiting to sync: forget this identity so the till can be enrolled again as a new device. */
    async resetIdentity() {
      if ((await Offline.outbox.pending()).count > 0) throw new Error('This till still has unsynced sales. Sync them first.');
      await Promise.all(['deviceSecret', 'context', 'outboxSeq', 'localSeq', 'localShift', 'serverShift'].map((k) => DB.kvDel(k)));
      await DB.kvSet('deviceId', uid());
      secret = null;
      await D.load();
      Offline.emit('readiness');
    },
  });

  /* ------------------------------ context ------------------------------ */
  let ctx = null;
  const C = (Offline.context = {
    async load() { ctx = (await DB.kvGet('context')) || null; },
    get: () => ctx,
    policyOn: () => !!(ctx && ctx.policy && ctx.policy.enabled && ctx.device && ctx.device.offlineEnabled),
    async refresh() {
      if (!D.enrolled()) return null;
      const { data } = await window.Api.get('/sync/context', { deviceId: D.id() }, { headers: D.headers(), background: true });
      ctx = data;
      T.sync(data.serverTime);
      await DB.kvSet('context', data);
      Offline.emit('readiness');
      return data;
    },
  });

  /* ------------------------------ grants ------------------------------ */
  const grantMem = {};
  const G = (Offline.grants = {
    decode(token) {
      const part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      const bin = atob(part.padEnd(part.length + ((4 - (part.length % 4)) % 4), '='));
      return JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
    },
    async loadAll() {
      const rows = await DB.getAll('kv');
      for (const r of rows) {
        if (r.k.startsWith('grant:')) { try { grantMem[r.k.slice(6)] = await DB.vault.decrypt(r.v); } catch { /* unreadable: ignore */ } }
      }
    },
    /** Online only: ask the server for a fresh offline window for the signed-in user. */
    async refresh() {
      if (!D.enrolled() || !window.Connectivity.isOnline() || !window.Storage.getAccessToken()) return null;
      const { data } = await window.Api.post('/devices/grant', { deviceId: D.id() }, { headers: D.headers(), background: true });
      const claims = G.decode(data.grant);
      const rec = { userId: claims.sub, name: claims.userName, role: claims.role, grant: data.grant, claims, offlineUntil: claims.offlineUntil, caps: data.caps, limits: data.limits, savedAt: Date.now() };
      await G.save(rec);
      T.sync(data.serverTime);
      return rec;
    },
    async save(rec) {
      grantMem[rec.userId] = rec;
      await DB.kvSet(`grant:${rec.userId}`, await DB.vault.encrypt(rec));
      Offline.emit('readiness');
    },
    get: (userId) => grantMem[userId] || null,
    valid: (rec) => !!rec && T.now() < rec.offlineUntil,
    all: () => Object.values(grantMem),
    async forget(userId) { delete grantMem[userId]; await DB.kvDel(`grant:${userId}`); },
  });

  /* ------------------------------ catalog ------------------------------ */
  const mem = { ready: false, products: [], byId: new Map(), variants: new Map(), barcodes: new Map() };
  const toVariant = (v) => ({ _id: v.id, productId: v.productId, sku: v.sku, barcode: v.barcode, attributes: v.attributes || {}, sellingPrice: v.sellingPriceCents / 100 });
  const toProduct = (p) => ({
    _id: p.id, name: p.name, sku: p.sku, barcode: p.barcode, categoryId: p.categoryId,
    sellingPrice: p.sellingPriceCents / 100, defaultDiscount: (p.defaultDiscountCents || 0) / 100, taxRate: p.taxRate || 0, taxCategory: p.taxCategory,
    unit: p.unit, productType: p.productType, trackInventory: !!p.trackInventory, trackSerialNumber: !!p.trackSerialNumber, trackBatch: !!p.trackBatch,
    hasVariants: !!p.hasVariants, status: 'active', variants: [], _offline: true,
  });
  const FEEDS = ['categories', 'products', 'variants'];
  const DROP_WHEN_INACTIVE = new Set(['products', 'variants', 'registers']);

  const Cat = (Offline.catalog = {
    progress: null,
    async load() {
      const [ps, vs] = await Promise.all([DB.getAll('products'), DB.getAll('variants')]);
      mem.products = []; mem.byId = new Map(); mem.variants = new Map(); mem.barcodes = new Map();
      ps.forEach((r) => {
        const p = toProduct(r);
        p._hay = `${(p.name || '').toLowerCase()} ${(p.sku || '').toLowerCase()} ${(p.barcode || '').toLowerCase()}`;
        mem.products.push(p); mem.byId.set(p._id, p);
        if (p.barcode) mem.barcodes.set(String(p.barcode), { p });
      });
      vs.forEach((r) => {
        const p = mem.byId.get(r.productId); if (!p) return;
        const v = toVariant(r);
        p.variants.push(v);
        p._hay += ` ${(v.sku || '').toLowerCase()} ${(v.barcode || '').toLowerCase()}`;
        if (v.barcode) mem.barcodes.set(String(v.barcode), { p, v });
      });
      mem.ready = true;
    },
    count: () => mem.products.length,
    isReady: () => mem.ready && mem.products.length > 0,
    async syncedAt() { return (await DB.kvGet('catalogSyncedAt')) || null; },
    /** Matches every word typed against name / SKU / barcode (also variants). Best matches first. */
    search(term, limit = 15) {
      const t = String(term || '').trim().toLowerCase();
      if (!t) return mem.products.slice(0, limit);
      const words = t.split(/\s+/);
      const out = [];
      for (const p of mem.products) {
        if (!words.every((w) => p._hay.includes(w))) continue;
        const exact = p.sku && p.sku.toLowerCase() === t || p.barcode === t;
        out.push({ p, rank: exact ? 0 : (p.name || '').toLowerCase().startsWith(t) ? 1 : 2 });
        if (out.length > 400) break;
      }
      return out.sort((a, b) => a.rank - b.rank).slice(0, limit).map((x) => x.p);
    },
    async byBarcode(code) {
      const hit = mem.barcodes.get(String(code).trim());
      return hit ? { product: hit.p, variant: hit.v || null } : null;
    },
    async pullFeed(type) {
      let cursor = await DB.kvGet(`cursor:${type}`);
      let total = 0;
      for (;;) {
        const q = { deviceId: D.id(), type, limit: 500 };
        if (cursor) q.cursor = cursor;
        const { data } = await window.Api.get('/sync/catalog', q, { headers: D.headers(), background: true, timeoutMs: 60000 });
        const put = []; const del = [];
        (data.items || []).forEach((r) => ((DROP_WHEN_INACTIVE.has(type) && r.status && r.status !== 'active') ? del.push(r.id) : put.push(r)));
        await DB.bulkPut(type, put);
        await DB.bulkDelete(type, del);
        total += (data.items || []).length;
        if (data.nextCursor) { cursor = data.nextCursor; await DB.kvSet(`cursor:${type}`, cursor); }
        Cat.progress = { type, total };
        Offline.emit('catalog', Cat.progress);
        if (!data.hasMore) break;
      }
      return total;
    },
    /** Downloads everything new since the last time. First run = full download. */
    async sync() {
      if (!D.enrolled() || !window.Connectivity.isOnline() || !C.policyOn()) return false;
      const work = async () => {
        let changed = 0;
        for (const type of FEEDS) changed += await Cat.pullFeed(type);
        await DB.kvSet('catalogSyncedAt', new Date().toISOString());
        await DB.kvSet('catalogVersion', new Date().toISOString());
        if (changed || !mem.ready) await Cat.load();
        await Cat.pruneIfDue();
        Cat.progress = null;
        Offline.emit('catalog', null);
        Offline.emit('readiness');
        return true;
      };
      if (navigator.locks) return navigator.locks.request('pos-catalog', { ifAvailable: true }, (lock) => (lock ? work() : false));
      return work();
    },
    /** A delta feed cannot show hard deletes, so once a day compare ids and drop what the server no longer has. */
    async pruneIfDue() {
      const last = (await DB.kvGet('lastPrune')) || 0;
      if (Date.now() - last < 24 * 3600 * 1000) return;
      const { data } = await window.Api.get('/sync/catalog/ids', { deviceId: D.id() }, { headers: D.headers(), background: true, timeoutMs: 60000 });
      const map = { products: data.productIds, variants: data.variantIds, categories: data.categoryIds, registers: data.registerIds };
      for (const [store, ids] of Object.entries(map)) {
        if (!ids) continue;
        const keep = new Set(ids);
        const gone = (await DB.getAll(store)).filter((r) => !keep.has(r.id)).map((r) => r.id);
        await DB.bulkDelete(store, gone);
      }
      await DB.kvSet('lastPrune', Date.now());
      await Cat.load();
    },
    version: async () => (await DB.kvGet('catalogVersion')) || 'none',
    registers: async () => ((C.get() || {}).registers || []).map((r) => ({ _id: r.id, name: r.name, code: r.code })),
  });

  /* ------------------------------ outbox ------------------------------ */
  const pendingCache = { count: 0, valueCents: 0, issues: 0 };
  const Out = (Offline.outbox = {
    /**
     * Writes one event + its counters + (for sales) its receipt in ONE transaction.
     * meta: { ref, soldAt, totalCents, prefix, branchCode, deviceCode }
     * The body is encrypted first (crypto must not run inside the transaction).
     */
    async enqueue(type, body, meta) {
      T.persist();
      const blob = await DB.vault.encrypt(body);
      const res = await DB.run(['kv', 'outbox', 'receipts'], 'readwrite', async (s) => {
        const outboxSeq = (((await s.kv.get('outboxSeq')) || {}).v || 0) + 1;
        await s.kv.put({ k: 'outboxSeq', v: outboxSeq });
        let localSeq = null; let receiptNumber = null;
        if (type === 'SALE') {
          localSeq = (((await s.kv.get('localSeq')) || {}).v || 0) + 1;
          await s.kv.put({ k: 'localSeq', v: localSeq });
          receiptNumber = `${meta.prefix}-${meta.branchCode}-${meta.deviceCode}-${String(localSeq).padStart(6, '0')}`;
          await s.receipts.put({ receiptNumber, localSeq, soldAt: meta.soldAt, totalCents: meta.totalCents, status: 'pending', blob });
        }
        await s.outbox.put({ outboxSeq, type, ref: meta.ref, localSeq, receiptNumber, soldAt: meta.soldAt, totalCents: meta.totalCents || 0, blob, status: 'pending', attempts: 0, createdAt: Date.now() });
        return { outboxSeq, localSeq, receiptNumber };
      });
      await Out.refresh();
      return res;
    },
    async list() { return (await DB.getAll('outbox')).filter((r) => r.status === 'pending').sort((a, b) => a.outboxSeq - b.outboxSeq); },
    async pending() {
      const rows = await Out.list();
      const sales = rows.filter((r) => r.type === 'SALE');
      return { count: rows.length, sales: sales.length, valueCents: sales.reduce((a, r) => a + (r.totalCents || 0), 0) };
    },
    async refresh() {
      const p = await Out.pending();
      pendingCache.count = p.count; pendingCache.sales = p.sales; pendingCache.valueCents = p.valueCents;
      pendingCache.issues = await DB.count('issues');
      Offline.emit('pending', pendingCache);
      return p;
    },
    cached: () => pendingCache,
    issues: () => DB.getAll('issues'),
    async receipt(receiptNumber) {
      const rec = await DB.run('receipts', 'readonly', (s) => s.receipts.get(receiptNumber));
      return rec ? { rec, body: await DB.vault.decrypt(rec.blob) } : null;
    },
    recentReceipts: async () => (await DB.getAll('receipts')).sort((a, b) => b.localSeq - a.localSeq).slice(0, 200),
  });

  /* ------------------------------ sync engine ------------------------------ */
  const S = (Offline.sync = { state: 'idle', error: null, lastSyncAt: null, backoffUntil: 0, _fails: 0 });
  const DONE = new Set(['created', 'needs_review', 'duplicate']);
  const HELD = new Set(['held', 'rejected']);

  async function applyResults(batch, results) {
    const byRef = new Map((results || []).map((r) => [r.ref || r.clientTransactionId, r]));
    for (const row of batch) {
      const r = byRef.get(row.ref);
      if (!r) continue;
      if (DONE.has(r.status)) {
        await DB.run(['outbox', 'receipts'], 'readwrite', async (s) => {
          await s.outbox.delete(row.outboxSeq);
          if (row.receiptNumber) {
            const rec = await s.receipts.get(row.receiptNumber);
            if (rec) await s.receipts.put({ ...rec, status: 'synced', invoiceNumber: r.invoiceNumber, review: r.status === 'needs_review', flags: r.flags || [] });
          }
        });
        if (row.type === 'SHIFT_OPEN') await Offline.shifts?.onOpenSynced(row.ref, r.shiftId);
        if (row.type === 'SHIFT_CLOSE' && Number.isFinite(r.cashDifference) && r.cashDifference !== 0 && window.UI) {
          const amt = window.UI.formatMoney(Math.abs(r.cashDifference) / 100);
          window.UI.toast.warning(`Shift closed offline: drawer is ${r.cashDifference < 0 ? 'short' : 'over'} by ${amt}`);
        }
      } else if (HELD.has(r.status)) {
        await DB.run(['outbox', 'receipts', 'issues'], 'readwrite', async (s) => {
          await s.issues.put({ ref: row.ref, type: row.type, status: r.status, code: r.code, message: r.message, receiptNumber: row.receiptNumber, totalCents: row.totalCents, at: Date.now() });
          await s.outbox.delete(row.outboxSeq);
          if (row.receiptNumber) { const rec = await s.receipts.get(row.receiptNumber); if (rec) await s.receipts.put({ ...rec, status: 'issue', code: r.code }); }
        });
        window.UI?.toast.error(`${row.receiptNumber || 'An event'} was not accepted (${r.code}). A manager must review it.`);
      } else if (r.status === 'retry') {
        await DB.run('outbox', 'readwrite', async (s) => { const cur = await s.outbox.get(row.outboxSeq); if (cur) await s.outbox.put({ ...cur, attempts: (cur.attempts || 0) + 1 }); });
      }
    }
  }

  async function pushAll() {
    const rows = await Out.list();
    let i = 0; let size = 25;
    while (i < rows.length) {
      const batch = rows.slice(i, i + size);
      const events = [];
      for (const r of batch) {
        const body = await DB.vault.decrypt(r.blob);
        events.push({ ...body, type: r.type, outboxSeq: r.outboxSeq, ...(r.type === 'SALE' ? { localSeq: r.localSeq } : {}) });
      }
      let data;
      try {
        ({ data } = await window.Api.post('/sync/push', {
          deviceId: D.id(), deviceTime: new Date().toISOString(), pendingCount: rows.length - i, appVersion: APP_VERSION, items: events,
        }, { headers: D.headers(), background: true, timeoutMs: 60000 }));
      } catch (err) {
        if (err.status === 413 && size > 1) { size = Math.max(1, Math.floor(size / 2)); continue; }
        throw err;
      }
      T.sync(data.serverTime);
      await applyResults(batch, data.results);
      i += batch.length;
      if ((data.results || []).some((r) => r.status === 'retry')) break; // order matters: stop, try again later
    }
  }

  async function runOnce() {
    if (!D.enrolled() || !window.Connectivity.isOnline() || Date.now() < S.backoffUntil) return;
    if (!window.Storage.getAccessToken()) { S.state = 'auth'; S.error = 'Sign in to send the sales saved on this till.'; Offline.emit('sync', S); return; }
    const before = (await Out.list()).length;
    if (!before) { S.state = 'idle'; await Out.refresh(); return; }
    S.state = 'syncing'; S.error = null; Offline.emit('sync', S);
    try {
      await pushAll();
      S._fails = 0; S.lastSyncAt = Date.now(); S.state = 'idle'; S.error = null;
      await DB.kvSet('lastSyncAt', S.lastSyncAt);
    } catch (err) {
      S._fails += 1;
      const wait = Math.min(300000, 5000 * 2 ** Math.min(S._fails, 6));
      S.backoffUntil = Date.now() + (err.status === 429 ? Math.max(wait, 60000) : wait);
      if (err.code === 'SESSION_EXPIRED' || err.status === 401) { S.state = 'auth'; S.error = 'Sign in again to send the sales saved on this till.'; }
      else if (err.code === 'BRANCH_ACCESS_DENIED') { S.state = 'auth'; S.error = 'The signed-in user cannot sync this till. Sign in as someone assigned to this branch.'; }
      else if (['DEVICE_UNKNOWN', 'DEVICE_SECRET_INVALID'].includes(err.code)) { S.state = 'device'; S.error = 'This till is not recognised by the server. Ask a manager.'; S.backoffUntil = Date.now() + 600000; }
      else if (err.code === 'NETWORK_ERROR') { S.state = 'idle'; S.error = null; }
      else { S.state = 'error'; S.error = err.message; }
    }
    await Out.refresh();
    Offline.emit('sync', S);
  }

  S.kick = () => {
    const go = () => runOnce().catch((e) => console.error('[sync]', e));
    if (navigator.locks) return navigator.locks.request('pos-sync', { ifAvailable: true }, (lock) => (lock ? runOnce().catch((e) => console.error('[sync]', e)) : null));
    return go();
  };
  S.now = () => { S.backoffUntil = 0; return S.kick(); };

  /* ------------------------------ maintenance ------------------------------ */
  const last = { ctx: 0, grant: 0, cat: 0, hb: 0 };
  async function maintenance() {
    T.persist();
    if (!window.Connectivity.isOnline() || !D.enrolled()) return;
    const now = Date.now();
    if (window.Storage.getAccessToken()) {
      if (now - last.ctx > 30 * 60e3) { last.ctx = now; await C.refresh().catch(() => {}); }
      if (C.policyOn()) {
        if (now - last.grant > 30 * 60e3) { last.grant = now; await G.refresh().catch(() => {}); }
        if (now - last.cat > 10 * 60e3) { last.cat = now; await Cat.sync().catch((e) => console.warn('[catalog]', e.message)); }
      }
      if (now - last.hb > 5 * 60e3) {
        last.hb = now;
        window.Api.post('/devices/heartbeat', { deviceId: D.id(), appVersion: APP_VERSION, pendingCount: pendingCache.count }, { headers: D.headers(), background: true }).catch(() => {});
      }
    }
    if (pendingCache.count > 0) S.kick();
  }

  /* ------------------------------ backup ------------------------------ */
  Offline.backup = {
    /** Passphrase-encrypted JSON of everything unsynced. Last resort: it contains customer phone numbers, so keep it private. */
    async export(passphrase) {
      if (!passphrase || passphrase.length < 8) throw new Error('Use a passphrase of at least 8 characters.');
      const rows = await Out.list();
      const events = [];
      for (const r of rows) events.push({ type: r.type, outboxSeq: r.outboxSeq, localSeq: r.localSeq, receiptNumber: r.receiptNumber, body: await DB.vault.decrypt(r.blob) });
      const payload = JSON.stringify({ format: 'pos-backup-v1', deviceId: D.id(), createdAt: new Date().toISOString(), events, issues: await Out.issues() });
      const salt = crypto.getRandomValues(new Uint8Array(16));
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']);
      const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 250000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
      const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(payload));
      const file = JSON.stringify({ format: 'pos-backup-v1-enc', kdf: 'PBKDF2-SHA256-250000', salt: DB.util.b64(salt), iv: DB.util.b64(iv), data: DB.util.b64(ct) });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([file], { type: 'application/json' }));
      a.download = `till-backup-${(C.get()?.device?.deviceCode || 'till')}-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a); a.click(); a.remove();
      return events.length;
    },
  };

  /* ------------------------------ status / init ------------------------------ */
  Offline.status = () => {
    const u = userIdOf(userOf());
    const active = Offline.auth?.activeUserId?.() || u;
    const g = G.get(active);
    return {
      online: window.Connectivity.isOnline(),
      enrolled: D.enrolled(), policyOn: C.policyOn(),
      catalogCount: Cat.count(), catalogReady: Cat.isReady(), catalogProgress: Cat.progress,
      grantUntil: g ? g.offlineUntil : null, grantValid: G.valid(g),
      pending: pendingCache.count, pendingSales: pendingCache.sales || 0, pendingValueCents: pendingCache.valueCents || 0, issues: pendingCache.issues,
      syncState: S.state, syncError: S.error, lastSyncAt: S.lastSyncAt,
      deviceCode: C.get()?.device?.deviceCode, mode: C.get()?.device?.mode,
    };
  };

  Offline.isReady = () => Offline._initDone === true;

  Offline.init = async function init() {
    if (Offline._initPromise) return Offline._initPromise;
    Offline._initPromise = (async () => {
      try {
        T.last = (await DB.kvGet('lastSeen')) || 0;
        await D.load();
        await Promise.all([C.load(), G.loadAll()]);
        await Offline.auth?.load?.();
        await Offline.shifts?.load?.();
        await Cat.load();
        // A sale that was reserved but never fully written (crash mid-save) leaves no outbox row; nothing to recover.
        await Out.refresh();
        try { await navigator.storage?.persist?.(); } catch { /* best effort */ }
        Offline._initDone = true;
        Offline.emit('readiness');
        window.Connectivity.onChange((on) => { Offline.emit('mode', { online: on }); if (on) { last.ctx = 0; maintenance(); } });
        setInterval(maintenance, 30000);
        setTimeout(maintenance, 1500);
        window.addEventListener('beforeunload', () => T.persist());
      } catch (err) {
        console.error('[offline] init failed', err);
        Offline.initError = err;
      }
      return Offline;
    })();
    return Offline._initPromise;
  };
})(window);