/**
 * hx-offline.js - OFFLINE ENGINE for the restaurant + accommodation screens (floor, cashier, kitchen, bills, stock, menu, room service).
 *
 * It sits UNDER window.Api so no page has to change:
 *   ONLINE : reads pass straight through (and are remembered); writes go straight through - unless steps are still waiting to sync,
 *            then they queue behind them so the server always sees them in order.
 *   OFFLINE: reads come from the last snapshot + everything done on this till since; writes are applied to that local copy at once
 *            (so the waiter, kitchen and cashier all keep working) and queued in an outbox.
 *   BACK ONLINE: the outbox is replayed IN ORDER to POST /restaurant/offline/replay (idempotent: every step has its own id), the
 *            snapshot is refreshed, and anything the server could not accept is listed in "Needs attention" for a manager.
 * Needs the internet (refused with a clear message): M-PESA STK push, online card gateways, uploads, reports, settings changes.
 * An M-PESA payment can still be taken offline with the customer's M-PESA CODE (stored unverified, checked after sync).
 * All money is major units on screen/local state and integer cents in queued steps.
 */
(function (window) {
  'use strict';
  const Api = window.Api; if (!Api || Api.__hxOffline) return;
  const NATIVE = { get: Api.get, post: Api.post, put: Api.put, patch: Api.patch, delete: Api.delete };
  const R = /^\/restaurant\//;
  const uid = () => (window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`).replace(/[^A-Za-z0-9-]/g, '');
  const cents = (n) => Math.round(Number(n || 0) * 100);
  const major = (c) => Math.round(Number(c || 0)) / 100;
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const online = () => (window.Connectivity ? window.Connectivity.isOnline() : window.navigator.onLine !== false);
  const toast = (t, m) => { try { window.UI?.toast?.[t]?.(m); } catch (e) { /* no toast */ } };
  const ok = (data, message) => ({ success: true, message: message || 'Saved offline', data, offline: true });
  const fail = (msg, code, status) => new Api.ApiError(msg, { code: code || 'OFFLINE_UNAVAILABLE', status: status || 503 });
  const needsNet = (what) => fail(`${what} needs the internet. Use cash, card or the customer's M-PESA code instead, or try again when the connection is back.`, 'NEEDS_INTERNET');

  // ------------------------------------------------------------ IndexedDB (kv, cache, outbox, issues)
  let dbp = null;
  const db = () => dbp || (dbp = new Promise((res, rej) => {
    if (!window.indexedDB) return rej(new Error('IndexedDB missing'));
    const q = indexedDB.open('pos-hx-offline', 1);
    q.onupgradeneeded = () => { const d = q.result; d.createObjectStore('kv', { keyPath: 'k' }); d.createObjectStore('cache', { keyPath: 'k' }); d.createObjectStore('outbox', { keyPath: 'seq', autoIncrement: true }); d.createObjectStore('issues', { keyPath: 'clientOpId' }); };
    q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error);
  }));
  const tx = async (store, mode, fn) => { const d = await db(); return new Promise((res, rej) => { const t = d.transaction(store, mode); const s = t.objectStore(store); let out; Promise.resolve(fn(s)).then((v) => { out = v; }); t.oncomplete = () => res(out); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error); }); };
  const rq = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const kvGet = async (k) => { try { const r = await tx('kv', 'readonly', (s) => rq(s.get(k))); return r ? r.v : undefined; } catch (e) { return undefined; } };
  const kvSet = (k, v) => tx('kv', 'readwrite', (s) => s.put({ k, v })).catch(() => {});
  const cacheGet = async (k) => { try { return (await tx('cache', 'readonly', (s) => rq(s.get(k))))?.v; } catch (e) { return undefined; } };
  const cacheSet = (k, v) => tx('cache', 'readwrite', (s) => s.put({ k, v, at: Date.now() })).catch(() => {});
  const outAll = async () => { try { return await tx('outbox', 'readonly', (s) => rq(s.getAll())); } catch (e) { return []; } };
  const outAdd = (op) => tx('outbox', 'readwrite', (s) => rq(s.add(op)));
  const outDel = (seq) => tx('outbox', 'readwrite', (s) => s.delete(seq));
  const issuesAll = async () => { try { return await tx('issues', 'readonly', (s) => rq(s.getAll())); } catch (e) { return []; } };
  const issueAdd = (i) => tx('issues', 'readwrite', (s) => s.put(i));
  const issueDel = (id) => tx('issues', 'readwrite', (s) => s.delete(id));

  // ------------------------------------------------------------ local state = snapshot + local changes
  let S = null; let pending = 0; let syncing = false; let deviceId = null;
  const L = (id) => String(id || '').startsWith('L-');
  const branch = () => { try { return window.HX?.branchId?.() || window.Storage?.getActiveBranchId?.() || window.Storage?.getUser?.()?.branchIds?.[0] || null; } catch (e) { return null; } };
  const persist = () => kvSet('state', S);
  async function loadState() { if (S) return S; S = (await kvGet('state')) || null; deviceId = (await kvGet('deviceId')) || null; if (!deviceId) { deviceId = `hx-${uid()}`.slice(0, 60); await kvSet('deviceId', deviceId); } pending = (await outAll()).length; return S; }

  /** Rebuild local order/bill/table/ticket views from a fresh server snapshot. Only legal when the outbox is empty. */
  function fromSnapshot(snap) {
    S = { snap, orders: Object.fromEntries((snap.openOrders || []).map((o) => [o._id, o])), bills: Object.fromEntries((snap.openBills || []).map((b) => [b._id, b])),
      tables: clone(snap.floor || []), tickets: clone(snap.kitchenQueue || []), stock: clone((snap.stock && snap.stock.items) || snap.stock || []), seq: 0, takenAt: Date.now() };
    persist();
  }
  async function refreshSnapshot(force) {
    const b = branch(); if (!b || !online()) return;
    if (!force && pending) return;                                     // never wipe local work that has not synced
    try { const { data } = await NATIVE.get('/restaurant/offline/snapshot', { branchId: b }, { background: true }); fromSnapshot(data); cacheImages(data); warm(); emit('snapshot'); } catch (e) { /* keep the old one */ }
  }

  // Re-fetch the screens used recently (cashier desk, manager dashboard...) so their saved copy is fresh before an outage.
  let warming = false;
  async function warm() {
    if (warming || !online()) return; warming = true;
    try { const rows = await tx('cache', 'readonly', (st) => rq(st.getAll()));       for (const r of rows.filter((x) => Date.now() - x.at < 7 * 864e5 && Date.now() - x.at > 120000).sort((a, b) => b.at - a.at).slice(0, 25)) {
        if (!online()) break; const [path, qs] = r.k.split('?'); const q = {}; (qs || '').split('&').filter(Boolean).forEach((kv) => { const i = kv.indexOf('='); q[kv.slice(0, i)] = decodeURIComponent(kv.slice(i + 1)); });
        try { const res = await NATIVE.get.call(Api, path, q, { background: true }); cacheSet(r.k, res.data); } catch (e) { /* keep old copy */ }
      }
    } catch (e) { /* ignore */ } finally { warming = false; }
  }
  const emit = (t, d) => { try { window.dispatchEvent(new CustomEvent('hxoffline:' + t, { detail: d })); } catch (e) { /* ignore */ } paint(); };
  const menuItem = (id) => { for (const m of Object.values(S?.snap?.menus || {})) for (const c of m.categories || []) for (const i of c.items || []) if (String(i._id) === String(id)) return i; return null; };
  const svcPct = (type) => { const sc = S.snap.settings?.serviceCharge || {}; return sc.enabled && (sc.orderTypes || []).includes(type) ? Number(sc.percent || 0) : 0; };
  function recalc(o) {
    const live = o.items.filter((i) => i.status !== 'CANCELLED');
    const sub = live.reduce((s, i) => s + i.unitPrice * i.quantity, 0);
    const sc = Math.round(sub * svcPct(o.orderType)) / 100; const rate = Number(S.snap.defaultTaxRate || 0);
    const tax = S.snap.taxInclusive ? Math.round((sub + sc) * rate / (100 + rate) * 100) / 100 : Math.round((sub + sc) * rate) / 100;
    o.totals = { itemsTotal: sub, serviceCharge: sc, tax, discount: 0, total: S.snap.taxInclusive ? sub + sc : sub + sc + tax };
  }
  function billOf(o, lines, extra) {
    const sub = lines.reduce((s, l) => s + l.unitPrice * l.quantity, 0); const sc = Math.round(sub * svcPct(o.orderType)) / 100;
    const rate = Number(S.snap.defaultTaxRate || 0); const tax = S.snap.taxInclusive ? Math.round((sub + sc) * rate / (100 + rate) * 100) / 100 : Math.round((sub + sc) * rate) / 100;
    const total = S.snap.taxInclusive ? sub + sc : sub + sc + tax;
    return { _id: `L-${uid()}`, orderId: o._id, orderNumber: o.orderNumber, billNumber: `OFFLINE-${String(++S.seq).padStart(3, '0')}`, status: 'OPEN', tableName: o.tableName, waiterName: o.waiterName, orderType: o.orderType, lines, subtotal: sub, serviceCharge: sc, tax, total, paid: 0, balance: total, payments: [], branchId: o.branchId, createdAt: new Date().toISOString(), ...extra };
  }
  const tableOf = (id) => S.tables.find((t) => String(t._id) === String(id));
  const orderIdOf = (id) => id;

  // ------------------------------------------------------------ queue
  async function enqueue(type, extra, optimistic) {
    const op = { clientOpId: `${deviceId.slice(-8)}-${uid()}`.slice(0, 80), type, occurredAt: new Date().toISOString(), ...extra };
    const out = optimistic ? optimistic(op) : {};
    await outAdd(op); pending += 1; await persist(); emit('queued', { type, pending });
    syncSoon();
    return out;
  }
  const oref = (id) => (L(id) ? { opId: S.orders[id] && S.orders[id].clientOpId } : { orderId: id });   // persisted on the order itself, so it survives page changes
  const opOfLocal = {};                                             // local id -> clientOpId that created it

  // ------------------------------------------------------------ offline writes
  const W = [
    ['POST', /^\/restaurant\/shift\/open$/, (m, b) => enqueue('openShift', { payload: { branchId: b.branchId || branch(), registerId: b.registerId, openingCashCents: cents(b.openingCash) } }, () => ok({ shift: { status: 'OPEN', openedAt: new Date().toISOString(), offline: true } }))],
    ['POST', /^\/restaurant\/orders$/, (m, b) => {
      const type = b.orderType || (S.snap.serviceMode === 'ACCOMMODATION' ? 'ROOM_SERVICE' : 'DINE_IN');
      const tbl = b.tableId ? tableOf(b.tableId) : null;
      if (tbl && tbl.currentOrderId) throw fail(`Table ${tbl.name} already has an open order`, 'TABLE_OCCUPIED', 409);
      const u = window.Storage?.getUser?.() || {}; const id = `L-${uid()}`;
      const o = { _id: id, orderNumber: `OFF-${String(++S.seq).padStart(3, '0')}`, orderType: type, status: 'OPEN', branchId: b.branchId || branch(), tableId: b.tableId, tableName: tbl?.name, guestCount: b.guestCount ?? 1, customerName: b.customerName, customerPhone: b.customerPhone, roomId: b.roomId, stayId: b.stayId, notes: b.notes, waiterId: u._id || u.id, waiterName: u.name, items: [], totals: { itemsTotal: 0, serviceCharge: 0, tax: 0, discount: 0, total: 0 }, billStatus: 'NONE', version: 1, createdAt: new Date().toISOString(), offline: true };
      S.orders[id] = o; if (tbl) Object.assign(tbl, { status: 'OCCUPIED', currentOrderId: id, order: { _id: id, orderNumber: o.orderNumber, waiterName: o.waiterName, guestCount: o.guestCount, total: 0, billStatus: 'NONE', readyItems: 0, pendingItems: 0 } });
      const { deviceId: _d, clientRef: _c, ...payload } = b;
      return enqueue('createOrder', { payload: { ...payload, branchId: o.branchId, orderType: type } }, (op) => { opOfLocal[id] = op.clientOpId; o.clientOpId = op.clientOpId; return ok({ order: o, replayed: false }, 'Order opened (offline)'); });
    }],
    ['POST', /^\/restaurant\/orders\/([^/]+)\/items$/, (m, b) => {
      const o = S.orders[m[1]]; if (!o) throw fail('This order is not on this till. Sync once online to load it.', 'ORDER_NOT_FOUND', 404);
      const items = (b.items || []).map((raw) => {
        const mi = menuItem(raw.menuItemId); if (!mi) throw fail('That menu item is not in the offline menu. Refresh the menu when online.', 'MENU_ITEM_UNAVAILABLE', 409);
        if (!mi.available) throw fail(`${mi.name} is not available (${(mi.unavailableReason || 'unavailable').toLowerCase().replace(/_/g, ' ')})`, 'MENU_ITEM_UNAVAILABLE', 409);
        const variant = raw.variantId ? (mi.variants || []).find((v) => String(v._id) === String(raw.variantId)) : null;
        const mods = (raw.modifiers || []).reduce((s, x) => s + Number(x.priceDelta || x.price || 0), 0);
        return { raw: { ...raw, clientItemId: raw.clientItemId || `ci-${uid()}`.slice(0, 40) }, line: { _id: `L-${uid()}`, clientItemId: null, menuItemId: mi._id, name: mi.name + (variant ? ` (${variant.name})` : ''), quantity: raw.quantity, unitPrice: (variant?.price ?? mi.effectivePrice ?? 0) + mods, notes: raw.notes, course: raw.course, seatNumber: raw.seatNumber, status: b.sendNow ? 'PENDING' : 'DRAFT', stationCode: mi.stationCode, addedAt: new Date().toISOString() } };
      });
      items.forEach((x) => { x.line.clientItemId = x.raw.clientItemId; o.items.push(x.line); });
      if (b.sendNow) sendLocal(o, items.map((x) => x.line));
      recalc(o); o.version += 1; syncTable(o);
      return enqueue('addItems', { orderRef: oref(o._id, opOfLocal2()), payload: { items: items.map((x) => x.raw), sendNow: !!b.sendNow } }, () => ok({ order: o, tickets: [], added: items.length }, 'Items added (offline)'));
    }],
    ['POST', /^\/restaurant\/orders\/([^/]+)\/send$/, (m) => {
      const o = S.orders[m[1]]; if (!o) throw fail('Order not found on this till', 'ORDER_NOT_FOUND', 404);
      const drafts = o.items.filter((i) => ['DRAFT', 'HELD'].includes(i.status)); sendLocal(o, drafts); o.version += 1; syncTable(o);
      return enqueue('sendOrder', { orderRef: oref(o._id, opOfLocal2()) }, () => ok({ order: o, tickets: [] }, 'Sent to the kitchen (offline)'));
    }],
    ['PUT', /^\/restaurant\/kitchen\/orders\/([^/]+)\/items\/([^/]+)$/, (m, b) => setStatus(m[1], [m[2]], b.status)],
    ['POST', /^\/restaurant\/kitchen\/tickets\/([^/]+)\/bump$/, (m, b) => { const t = S.tickets.find((x) => String(x._id) === m[1]); if (!t) throw fail('Ticket not found', 'TICKET_NOT_FOUND', 404); const st = b.status || 'READY'; const ids = (t.items || []).filter((i) => !i.cancelled).map((i) => i.orderItemId); const r = setStatus(t.orderId, ids, st, true); return r.then(() => ok({ ticket: t })); }],
    ['POST', /^\/restaurant\/kitchen\/tickets\/([^/]+)\/expo$/, (m) => {
      const t = S.tickets.find((x) => String(x._id) === m[1]); if (!t) throw fail('Ticket not found on this till', 'TICKET_NOT_FOUND', 404);
      const o = S.orders[t.orderId]; const live = (t.items || []).filter((i) => !i.cancelled);
      if (live.some((i) => !['READY', 'SERVED'].includes(i.status))) throw fail(`${live.filter((i) => !['READY', 'SERVED'].includes(i.status)).length} item(s) are not ready yet`, 'ITEMS_NOT_READY', 409);
      t.expoConfirmedAt = new Date().toISOString();
      return enqueue('handoff', { orderRef: oref(t.orderId), itemRefs: o ? refsOf(o, live.map((i) => i.orderItemId)) : live.map((i) => ({ itemId: i.orderItemId })) }, () => ok({ ticket: t }, 'Handed to the waiter'));
    }],
    ['POST', /^\/restaurant\/orders\/([^/]+)\/ready$/, (m, b) => { const o = S.orders[m[1]]; const ids = (b.itemIds && b.itemIds.length ? b.itemIds : (o?.items || []).filter((i) => ['PENDING', 'ACCEPTED', 'PREPARING'].includes(i.status)).map((i) => i._id)); return setStatus(m[1], ids, 'READY').then(() => ok({ order: S.orders[m[1]] })); }],
    ['POST', /^\/restaurant\/orders\/([^/]+)\/serve$/, (m, b) => {
      const o = S.orders[m[1]]; if (!o) throw fail('Order not found on this till', 'ORDER_NOT_FOUND', 404);
      const ids = b.allReady ? o.items.filter((i) => i.status === 'READY').map((i) => i._id) : (b.itemIds || []);
      ids.forEach((id) => { const i = o.items.find((x) => String(x._id) === String(id)); if (i) { i.status = 'SERVED'; i.servedAt = new Date().toISOString(); } }); o.version += 1; syncTable(o);
      return enqueue('serve', { orderRef: oref(o._id, opOfLocal2()), payload: { itemRefs: b.allReady ? undefined : refsOf(o, ids), allReady: b.allReady || undefined } }, () => ok({ order: o }, 'Served'));
    }],
    ['POST', /^\/restaurant\/orders\/([^/]+)\/items\/([^/]+)\/cancel$/, (m, b) => {
      const o = S.orders[m[1]]; const i = o?.items.find((x) => String(x._id) === m[2]); if (!i) throw fail('Item not found on this till', 'ITEM_NOT_FOUND', 404);
      i.status = 'CANCELLED'; recalc(o); o.version += 1; syncTable(o);
      return enqueue('cancelItem', { orderRef: oref(o._id, opOfLocal2()), itemRef: refsOf(o, [m[2]])[0], payload: { reason: b.reason, quantity: b.quantity } }, () => ok({ order: o }, 'Item cancelled'));
    }],
    ['POST', /^\/restaurant\/orders\/([^/]+)\/cancel$/, (m, b) => {
      const o = S.orders[m[1]]; if (!o) throw fail('Order not found on this till', 'ORDER_NOT_FOUND', 404);
      o.status = 'CANCELLED'; const t = o.tableId && tableOf(o.tableId); if (t) Object.assign(t, { status: 'AVAILABLE', currentOrderId: null, order: null });
      return enqueue('cancelOrder', { orderRef: oref(o._id, opOfLocal2()), payload: { reason: b.reason || 'Cancelled offline' } }, () => ok({ order: o }, 'Order cancelled'));
    }],
    ['POST', /^\/restaurant\/orders\/([^/]+)\/bills$/, (m, b) => {
      const o = S.orders[m[1]]; if (!o) throw fail('Order not found on this till', 'ORDER_NOT_FOUND', 404);
      const existing = Object.values(S.bills).find((x) => x.orderId === o._id && !['VOID', 'PAID'].includes(x.status)); if (existing) return ok({ bill: existing });
      const lines = o.items.filter((i) => i.status !== 'CANCELLED').map((i) => ({ orderItemId: i._id, name: i.name, quantity: i.quantity, unitPrice: i.unitPrice, total: i.unitPrice * i.quantity }));
      const bill = billOf(o, lines, { label: b.label }); S.bills[bill._id] = bill; o.billStatus = 'OPEN'; syncTable(o); const t = o.tableId && tableOf(o.tableId); if (t) t.status = 'AWAITING_BILL';
      return enqueue('generateBill', { orderRef: oref(o._id, opOfLocal2()), payload: { label: b.label, customerId: b.customerId } }, (op) => { bill.clientOpId = op.clientOpId; return ok({ bill }, 'Bill ready (offline)'); });
    }],
    ['POST', /^\/restaurant\/bills\/([^/]+)\/pay$/, (m, b) => {
      const bill = S.bills[m[1]]; if (!bill) throw fail('Bill not found on this till', 'BILL_NOT_FOUND', 404);
      const pays = (b.payments || []).map((p) => { if (p.method === 'CREDIT' || p.method === 'DEPOSIT') throw needsNet(`${p.method === 'CREDIT' ? 'Customer credit' : 'Using a deposit'}`); if (p.method === 'MPESA' && !/^[A-Za-z0-9]{8,12}$/.test(String(p.reference || ''))) throw fail("Enter the customer's M-PESA code (e.g. SJK2L9XYZ1) to take M-PESA offline.", 'MPESA_REFERENCE_REQUIRED', 400); if (p.method === 'MOBILE_MONEY' && !p.reference) throw fail('A transaction reference is required', 'MOBILE_MONEY_REFERENCE_REQUIRED', 400); if (cents(p.amount) > cents(bill.balance)) throw fail('Payment is more than the balance owing', 'OVERPAYMENT', 400); return p; });
      let change = 0;
      pays.forEach((p) => { bill.payments.push({ kind: 'PAYMENT', method: p.method, amount: p.amount, reference: p.reference, at: new Date().toISOString(), verifyStatus: ['MPESA', 'MOBILE_MONEY'].includes(p.method) ? 'PENDING' : undefined }); bill.paid = Math.round((bill.paid + Number(p.amount)) * 100) / 100; bill.balance = Math.round((bill.total - bill.paid) * 100) / 100; if (p.method === 'CASH' && p.tendered) change += Math.max(0, p.tendered - p.amount); });
      bill.status = bill.balance <= 0 ? 'PAID' : 'PARTIAL';
      const o = S.orders[bill.orderId]; let receipt = null;
      if (bill.status === 'PAID') { receipt = { receiptNumber: bill.billNumber, offline: true }; bill.receiptNumber = receipt.receiptNumber; if (o) { o.billStatus = 'PAID'; if (!Object.values(S.bills).some((x) => x.orderId === o._id && !['PAID', 'VOID'].includes(x.status)) && o.items.every((i) => ['SERVED', 'CANCELLED'].includes(i.status))) { o.status = 'CLOSED'; const t = o.tableId && tableOf(o.tableId); if (t) Object.assign(t, { status: 'CLEANING', currentOrderId: null, order: null }); } } }
      return enqueue('pay', { billRef: L(bill._id) ? { opId: bill.clientOpId } : { billId: bill._id }, payload: { customerId: b.customerId, payments: pays.map((p) => ({ method: p.method, amountCents: cents(p.amount), tenderedCents: p.tendered != null ? cents(p.tendered) : undefined, reference: p.reference, network: p.network, payerPhone: p.payerPhone, stayId: p.stayId })) } },
        () => { emit('receipt', { bill: clone(bill), order: o ? clone(o) : null, provisional: true }); return ok({ bill, sale: { receiptNumber: bill.receiptNumber, offline: true }, receipt, change }, 'Payment saved offline. A provisional receipt can be printed; the official one is issued when sync completes.'); });
    }],
    ['POST', /^\/restaurant\/bills\/([^/]+)\/tips$/, (m, b) => enqueue('addTip', { billRef: L(m[1]) ? { opId: S.bills[m[1]] && S.bills[m[1]].clientOpId } : { billId: m[1] }, payload: { amountCents: cents(b.amount), method: b.method, reference: b.reference, waiterId: b.waiterId } }, () => ok({ tip: { amount: b.amount } }))],
    ['POST', /^\/restaurant\/ingredients\/receive$/, (m, b) => {
      (b.lines || []).forEach((l) => bump(b.branchId || branch(), l.ingredientId, Number(l.quantity)));
      return enqueue('receiveStock', { payload: { branchId: b.branchId || branch(), supplierId: b.supplierId, invoiceNumber: b.invoiceNumber, amountPaidCents: b.amountPaid != null ? cents(b.amountPaid) : undefined, notes: b.notes, lines: (b.lines || []).map((l) => ({ ingredientId: l.ingredientId, quantity: l.quantity, unit: l.unit, unitCostCents: cents(l.unitCostCents ?? l.unitCost), batchNumber: l.batchNumber, expiryDate: l.expiryDate, location: l.location })) } }, () => ok({ purchase: { invoiceNumber: b.invoiceNumber, offline: true } }, 'Stock received (offline)'));
    }],
    ['POST', /^\/restaurant\/ingredients\/waste$/, (m, b) => { bump(b.branchId || branch(), b.ingredientId, -Number(b.quantity)); return enqueue('waste', { payload: { branchId: b.branchId || branch(), ingredientId: b.ingredientId, quantity: b.quantity, unit: b.unit, kind: b.kind, reason: b.reason, location: b.location } }, () => ok({ waste: { offline: true } }, 'Waste recorded (offline)')); }],
    ['POST', /^\/restaurant\/ingredients\/adjust$/, (m, b) => { bump(b.branchId || branch(), b.ingredientId, b.direction === 'IN' ? Number(b.quantity) : -Number(b.quantity)); return enqueue('adjustStock', { payload: { branchId: b.branchId || branch(), ingredientId: b.ingredientId, quantity: b.quantity, unit: b.unit, direction: b.direction, reason: b.reason, location: b.location } }, () => ok({ result: { offline: true } }, 'Stock adjusted (offline)')); }],
    ['POST', /^\/restaurant\/(bills\/[^/]+\/mpesa\/(stk|manual)|mpesa\/)/, () => { throw needsNet('The M-PESA payment prompt'); }],
  ];
  const opOfLocal2 = () => { const mp = new Map(Object.entries(opOfLocal)); return { get: (id) => mp.get(id) }; };
  const refsOf = (o, ids) => ids.map((id) => { const i = o.items.find((x) => String(x._id) === String(id)); return L(id) || (i && i.clientItemId && L(i._id)) ? { clientItemId: i.clientItemId } : { itemId: id }; });
  function sendLocal(o, items) {
    const now = new Date().toISOString(); if (!items.length) return; o.firstSentAt = o.firstSentAt || now;
    items.forEach((i) => { i.status = 'PENDING'; i.sentAt = now; });
    const by = new Map(); items.forEach((i) => { const k = i.stationCode || 'KITCHEN'; (by.get(k) || by.set(k, []).get(k)).push(i); });
    by.forEach((list, code) => { const st = (S.snap.stations || []).find((x) => x.code === code) || (S.snap.stations || [])[0] || {}; S.tickets.push({ _id: `L-${uid()}`, orderId: o._id, orderNumber: o.orderNumber, tableName: o.tableName, orderType: o.orderType, stationId: st._id, stationName: st.name || code, status: 'NEW', type: 'NEW', priority: o.priority || 'NORMAL', receivedAt: now, ageMinutes: 0, overdue: false, offline: true, items: list.map((i) => ({ orderItemId: i._id, name: i.name, quantity: i.quantity, notes: i.notes, status: 'PENDING', cancelled: false })) }); });
  }
  function setStatus(orderId, ids, status, viaTicket) {
    const o = S.orders[orderId]; if (!o) return Promise.reject(fail('Order not found on this till', 'ORDER_NOT_FOUND', 404));
    const refs = refsOf(o, ids); const now = new Date().toISOString();
    ids.forEach((id) => { const i = o.items.find((x) => String(x._id) === String(id)); if (i) { i.status = status; i[{ ACCEPTED: 'acceptedAt', PREPARING: 'preparingAt', READY: 'readyAt', SERVED: 'servedAt' }[status]] = now; } });
    S.tickets.forEach((t) => { if (t.orderId !== orderId) return; t.items.forEach((r) => { if (ids.some((x) => String(x) === String(r.orderItemId))) r.status = status; }); const live = t.items.filter((r) => !r.cancelled); t.status = live.every((r) => ['READY', 'SERVED'].includes(r.status)) ? 'READY' : live.some((r) => r.status === 'PREPARING') ? 'PREPARING' : live.some((r) => r.status === 'ACCEPTED') ? 'ACCEPTED' : t.status; });
    o.version += 1; syncTable(o);
    return enqueue('itemStatus', { orderRef: oref(orderId, opOfLocal2()), itemRefs: refs, payload: { status } }, () => viaTicket ? ok({}) : ok({ order: o, item: o.items.find((x) => String(x._id) === String(ids[0])), tickets: [], changed: true }, 'Updated (offline)'));
  }
  function syncTable(o) { const t = o.tableId && tableOf(o.tableId); if (!t || !t.order) return; const live = o.items.filter((i) => i.status !== 'CANCELLED'); Object.assign(t.order, { total: o.totals.total, billStatus: o.billStatus, readyItems: live.filter((i) => i.status === 'READY').length, pendingItems: live.filter((i) => ['PENDING', 'ACCEPTED', 'PREPARING'].includes(i.status)).length }); }
  function bump(bid, ingId, q) { const row = (S.stock || []).find((r) => String(r.ingredientId || r._id) === String(ingId)); if (row) { row.quantity = Math.round(((row.quantity || 0) + q) * 10000) / 10000; if (row.onHand != null) row.onHand = row.quantity; } }

  // ------------------------------------------------------------ offline reads
  const paged = (items, q) => { const limit = Number(q?.limit) || 20; const page = Number(q?.page) || 1; return { items: items.slice((page - 1) * limit, page * limit), total: items.length, page, limit, pages: Math.ceil(items.length / limit) || 1 }; };
  const GETS = [
    [/^\/restaurant\/menu$/, (m, q) => S.snap.menus?.[q.orderType || 'DINE_IN'] || Object.values(S.snap.menus || {})[0]],
    [/^\/restaurant\/menu\/groups$/, () => ({ groups: S.snap.modifierGroups || [] })],
    [/^\/restaurant\/tables$/, () => ({ tables: S.tables })],
    [/^\/restaurant\/areas$/, () => ({ areas: S.snap.areas || [] })],
    [/^\/restaurant\/stations$/, () => ({ stations: S.snap.stations || [] })],
    [/^\/restaurant\/settings$/, () => ({ settings: S.snap.settings })],
    [/^\/restaurant\/operations\/plan$/, () => ({ plan: S.snap.plan })],
    [/^\/restaurant\/pay-context$/, () => S.snap.payContext],
    [/^\/restaurant\/kitchen\/queue$/, (m, q) => ({ tickets: S.tickets.filter((t) => (!q.stationId || String(t.stationId) === String(q.stationId)) && (q.includeCompleted === 'true' || !(t.status === 'READY' && t.expoConfirmedAt))).map((t) => ({ ...t, ageMinutes: Math.floor((Date.now() - new Date(t.receivedAt)) / 60000) })) })],
    [/^\/restaurant\/orders$/, (m, q) => paged(Object.values(S.orders).filter((o) => (!q.status || o.status === q.status) && (!q.orderType || o.orderType === q.orderType) && (!q.tableId || String(o.tableId) === String(q.tableId))).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)), q)],
    [/^\/restaurant\/orders\/([^/]+)$/, (m) => { const o = S.orders[m[1]]; return o ? { order: o, bills: Object.values(S.bills).filter((b) => b.orderId === o._id), tickets: S.tickets.filter((t) => t.orderId === o._id) } : null; }],
    [/^\/restaurant\/bills$/, (m, q) => paged(Object.values(S.bills).filter((b) => (q.status ? b.status === q.status : ['OPEN', 'PARTIAL'].includes(b.status)) && (!q.orderId || b.orderId === q.orderId)), q)],
    [/^\/restaurant\/bills\/([^/]+)$/, (m) => { const b = S.bills[m[1]]; return b ? { bill: b, sale: null, receipt: b.receiptNumber ? { receiptNumber: b.receiptNumber, offline: true } : null, tips: [] } : null; }],
    [/^\/restaurant\/ingredients$/, (m, q) => paged((S.snap.ingredients || []).filter((i) => !q.search || i.name.toLowerCase().includes(String(q.search).toLowerCase())), { ...q, limit: q.limit || 200 })],
    [/^\/restaurant\/ingredients\/stock$/, (m, q) => ({ ...(S.snap.stock && !Array.isArray(S.snap.stock) ? S.snap.stock : {}), items: S.stock })],
    [/^\/restaurant\/reservations$/, () => paged(S.snap.reservations || [], {})],
    [/^\/restaurant\/staff$/, () => ({ staff: S.snap.staff || [] })],
  ];
  const key = (path, q) => path + '?' + Object.keys(q || {}).sort().filter((k) => q[k] != null && q[k] !== '').map((k) => `${k}=${q[k]}`).join('&');
  async function offlineGet(path, q) {
    await loadState();
    if (S) { for (const [re, fn] of GETS) { const m = path.match(re); if (m) { const d = fn(m, q || {}); if (d) return ok(d, 'From this till'); } } }
    const c = await cacheGet(key(path, q)); if (c !== undefined) return { success: true, data: c, offline: true, cached: true };
    throw fail('This screen has not been loaded on this till yet, so it is not available offline.', 'NOT_CACHED');
  }

  // ------------------------------------------------------------ Api wrapper
  // Other screens (cashier desk, manager dashboard, shifts, reports...): remember the last answer and show it when the connection is gone.
  const SKIP = /^\/(auth|sync|health|devices|delivery-live|public)\b|\/stream|\/offline\//;
  const IMG = /https?:\/\/[^"\s\\]+?\.(?:png|jpe?g|webp|gif|avif|svg)(?:\?[^"\s\\]*)?/gi;
  async function cacheImages(data) {
    if (!window.caches) return; try {
      const urls = [...new Set((JSON.stringify(data) || '').match(IMG) || [])].slice(0, 300); if (!urls.length) return;
      const cache = await caches.open('tv-media-v1'); const have = new Set((await cache.keys()).map((r) => r.url));
      for (const u of urls) { if (have.has(u)) continue; try { const res = await fetch(new Request(u, { mode: 'no-cors' })); if (res && (res.ok || res.type === 'opaque')) await cache.put(u, res); } catch (e) { /* later */ } }
      const keys = await cache.keys(); if (keys.length > 800) for (const k of keys.slice(0, keys.length - 800)) await cache.delete(k);
    } catch (e) { /* storage full */ }
  }
  const staleNote = (at) => { try { let b = document.getElementById('hxo-stale'); if (!b) { b = document.createElement('div'); b.id = 'hxo-stale'; b.style.cssText = 'position:fixed;left:50%;transform:translateX(-50%);top:8px;z-index:1400;background:#7c2d12;color:#fff;padding:6px 14px;border-radius:99px;font:600 13px system-ui;box-shadow:0 2px 8px rgba(0,0,0,.3)'; document.body.appendChild(b); } b.textContent = `Offline: showing data saved at ${new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`; clearTimeout(b._t); b._t = setTimeout(() => b.remove(), 6000); } catch (e) { /* no DOM */ } };
  async function staleGet(path, query) {
    try { const row = await tx('cache', 'readonly', (st) => rq(st.get(key(path, query)))); if (row) { staleNote(row.at); return { success: true, data: row.v, offline: true, stale: true }; } } catch (e) { /* none */ }
    throw fail('This screen has not been opened on this device while online, so there is nothing saved to show yet.', 'NOT_CACHED');
  }
  Api.get = async function (path, query, opts) {
    if (!R.test(path)) {
      if (SKIP.test(path) || (opts && opts.background)) return NATIVE.get.call(Api, path, query, opts);
      if (!online()) return staleGet(path, query);
      try { const r = await NATIVE.get.call(Api, path, query, opts); cacheSet(key(path, query), r.data); cacheImages(r.data); return r; }
      catch (e) { if (e && e.code === 'NETWORK_ERROR') return staleGet(path, query); throw e; }
    }
    if (/\/offline\//.test(path)) return NATIVE.get.call(Api, path, query, opts);
    await loadState();
    if (!online() || (pending && S && GETS.some(([re]) => re.test(path)))) return offlineGet(path, query);   // unsynced work exists only on this till: show it
    try { const r = await NATIVE.get.call(Api, path, query, opts); cacheSet(key(path, query), r.data); cacheImages(r.data); return r; }
    catch (e) { if (e && e.code === 'NETWORK_ERROR') return offlineGet(path, query); throw e; }
  };
  const mutate = (method) => async function (path, body, opts) {
    const native = () => NATIVE[method.toLowerCase()].call(Api, path, body, opts);
    if (!R.test(path) || /\/offline\//.test(path)) return native();
    await loadState();
    const queued = pending > 0 || L((path.match(/\/(?:orders|bills)\/([^/]+)/) || [])[1]);
    if (online() && !queued) { try { return await native(); } catch (e) { if (!(e && e.code === 'NETWORK_ERROR')) throw e; } }
    if (!S) throw fail('This till has not been prepared for offline use yet. Open it once while online.', 'NOT_PREPARED');
    for (const [mm, re, fn] of W) { if (mm === method) { const m = path.match(re); if (m) { try { return await fn(m, body || {}); } catch (e) { if (e instanceof Api.ApiError) throw e; throw fail(e.message || 'Could not save offline'); } } } }
    throw needsNet('This action');
  };
  Api.post = mutate('POST'); Api.put = mutate('PUT'); Api.patch = mutate('PATCH'); Api.delete = mutate('DELETE');

  // ------------------------------------------------------------ sync
  let timer = null; const syncSoon = () => { clearTimeout(timer); timer = setTimeout(sync, 800); };
  async function sync() {
    if (syncing || !online()) return; await loadState(); syncing = true; paint();
    try {
      for (;;) {
        const all = await outAll(); pending = all.length; if (!all.length) break;
        const batch = all.slice(0, 100);
        let res;
        try { ({ data: res } = await NATIVE.post('/restaurant/offline/replay', { deviceId, deviceTime: new Date().toISOString(), ops: batch.map(({ seq, ...op }) => op) }, { background: true, timeoutMs: 60000 })); }
        catch (e) { if (e && e.code === 'SESSION_EXPIRED') toast('warning', 'Sign in again to finish syncing offline work.'); break; }
        if (res.clockWarning) toast('warning', "This device's clock is off by more than 5 minutes. Please correct it.");
        let retry = 0;
        for (const r of res.results) {
          const row = batch.find((x) => x.clientOpId === r.clientOpId); if (!row) continue;
          if (r.status === 'APPLIED') await outDel(row.seq);
          else if (r.status === 'CONFLICT' || r.status === 'REJECTED') { await issueAdd({ clientOpId: row.clientOpId, type: row.type, code: r.code, message: r.message, at: row.occurredAt }); await outDel(row.seq); toast('warning', `An offline step could not be applied: ${r.message}`); }
          else retry += 1;
        }
        if (retry) break;
      }
    } finally { syncing = false; pending = (await outAll()).length; if (!pending) { await refreshSnapshot(true); toast('success', 'Offline work synced'); } emit('synced', { pending }); }
  }

  // ------------------------------------------------------------ status chip + provisional print
  function paint() { try { paintBtn(); } catch (e) { /* DOM not ready */ } }
  async function panel() {
    const iss = await issuesAll(); const box = document.createElement('div');
    box.style.cssText = 'position:fixed;inset:0;z-index:2600;background:rgba(15,23,42,.6);display:flex;align-items:center;justify-content:center;padding:16px';
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    box.innerHTML = `<div style="background:#fff;color:#0f172a;border-radius:14px;padding:20px;max-width:460px;width:100%;max-height:80vh;overflow:auto;font:14px system-ui"><h3 style="margin:0 0 8px">Offline status</h3><p>${online() ? 'Connected.' : 'No connection: work is saved on this device.'} ${pending} step(s) waiting to sync.</p>${iss.length ? '<h4>Needs attention</h4>' + iss.map((i) => `<div style="padding:8px 0;border-top:1px solid #e2e8f0"><b>${esc(i.type)}</b>: ${esc(i.message)} <button data-d="${esc(i.clientOpId)}" style="float:right">Dismiss</button></div>`).join('') + '<p style="color:#64748b">A manager can also review these in Offline review.</p>' : ''}<div style="display:flex;gap:8px;margin-top:12px"><button id="hxo-sync">Sync now</button><button id="hxo-x">Close</button></div></div>`;
    document.body.appendChild(box);
    box.querySelector('#hxo-x').onclick = () => box.remove(); box.querySelector('#hxo-sync').onclick = () => { sync(); box.remove(); };
    box.querySelectorAll('[data-d]').forEach((b) => { b.onclick = async () => { await issueDel(b.dataset.d); window.__hxoIssues = (await issuesAll()).length; b.parentElement.remove(); paint(); }; });
  }
  window.addEventListener('hxoffline:receipt', (e) => {                // provisional bill/receipt print works with no server
    const { bill, order } = e.detail || {}; if (!bill) return;
    const biz = window.__hxoBiz || {}; const m = (n) => Number(n || 0).toFixed(2);
    const html = `<html><body style="font:13px monospace;width:280px;margin:0 auto"><h3 style="text-align:center;margin:4px">${(biz.name || 'Receipt')}</h3><p style="text-align:center;margin:0">PROVISIONAL RECEIPT (offline)</p><hr>${bill.billNumber} ${order?.tableName ? '· ' + order.tableName : ''}<br>${new Date().toLocaleString()}<hr>${bill.lines.map((l) => `${l.quantity} x ${l.name}<span style="float:right">${m(l.total)}</span><br>`).join('')}<hr>Service<span style="float:right">${m(bill.serviceCharge)}</span><br>Tax<span style="float:right">${m(bill.tax)}</span><br><b>Total<span style="float:right">${m(bill.total)}</span></b><br>${bill.payments.map((p) => `${p.method}<span style="float:right">${m(p.amount)}</span><br>`).join('')}Balance<span style="float:right">${m(bill.balance)}</span><hr><p style="text-align:center">Thank you</p></body></html>`;
    const f = document.createElement('iframe'); f.style.cssText = 'position:fixed;width:0;height:0;border:0'; document.body.appendChild(f); f.contentDocument.write(html); f.contentDocument.close(); setTimeout(() => { try { f.contentWindow.print(); } catch (x) { /* blocked */ } setTimeout(() => f.remove(), 2000); }, 300);
  });

  // ------------------------------------------------------------ start
  (async function start() {
    await loadState(); window.__hxoIssues = (await issuesAll()).length; if (S?.snap?.business) window.__hxoBiz = S.snap.business;
    window.addEventListener('connectivitychange', (e) => { if (e.detail?.online) sync(); paint(); });
    window.addEventListener('online', () => setTimeout(sync, 1500)); window.addEventListener('offline', paint);
    const tick = async () => { if (online()) { if (pending) await sync(); else await refreshSnapshot(false); } paint(); };
    setInterval(tick, 5 * 60 * 1000); setTimeout(() => { if (online() && !pending) refreshSnapshot(true); else if (online()) sync(); paint(); }, 2500);
  })();


  // ------------------------------------------------------------ SETUP GUIDE (top-bar button + checklist wizard)
  const PAGES = ['hx-floor.html', 'hx-cashier.html', 'hx-kitchen.html', 'hx-bills.html', 'hx-menu.html', 'hx-stock.html', 'hx-reservations.html', 'hx-delivery.html', 'hx-desk.html', 'hx-rooms.html', 'hx-stays.html', 'hx-housekeeping.html', 'hx-dashboard.html', 'hx-tv.html', 'login.html'];
  const esc2 = (x) => String(x == null ? '' : x).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  async function pagesCached() { if (!window.caches) return { have: 0, total: PAGES.length }; let have = 0; for (const p of PAGES) { try { if (await caches.match(new URL(p, location.href).toString(), { ignoreSearch: true })) have += 1; } catch (e) { /* skip */ } } return { have, total: PAGES.length }; }
  async function downloadPages(onProgress) { let n = 0; for (const p of PAGES) { try { await fetch(new URL(p, location.href).toString(), { cache: 'reload' }); } catch (e) { /* offline */ } n += 1; onProgress && onProgress(n, PAGES.length); } }
  async function checks() {
    const sw = !!(navigator.serviceWorker && navigator.serviceWorker.controller);
    const pg = await pagesCached(); const snap = S && S.snap; const age = snap ? Math.round((Date.now() - S.takenAt) / 60000) : null;
    let persisted = false; try { persisted = !!(await navigator.storage?.persisted?.()); } catch (e) { /* unsupported */ }
    let pin = null; try { if (window.Offline && Offline.isReady && Offline.isReady()) { const st = Offline.status(); pin = !!st.enrolled; } } catch (e) { pin = null; }
    return [
      { id: 'sw', ok: sw, title: 'This device can open the app with no internet', ok_t: 'Installed. The app opens even when the internet is off.', bad_t: 'Not active yet. Reload this page once while online (and use Chrome/Edge/Safari, not a private window).', action: sw ? null : ['Reload now', () => location.reload()] },
      { id: 'pages', ok: pg.have >= pg.total - 1, title: 'All restaurant screens are saved on this device', ok_t: `${pg.have} of ${pg.total} screens saved.`, bad_t: `${pg.have} of ${pg.total} saved. Tap download and wait until it finishes.`, action: ['Download screens', async (btn) => { btn.disabled = true; await downloadPages((n, t) => { btn.textContent = `Downloading ${n}/${t}…`; }); }] },
      { id: 'data', ok: !!snap && age < 24 * 60, title: 'Menu, prices, tables, stock and staff are saved', ok_t: `Saved ${age < 1 ? 'just now' : age + ' min ago'}: ${Object.values(snap?.menus || {})[0]?.categories?.reduce((a, c) => a + c.items.length, 0) || 0} menu items, ${(snap?.floor || []).length} tables, ${(snap?.ingredients || []).length} ingredients, ${(snap?.staff || []).length} staff.`, bad_t: snap ? 'The saved copy is more than a day old. Refresh it.' : 'Nothing saved yet. Tap download (needs internet, takes a few seconds).', action: ['Download now', async (btn) => { btn.disabled = true; btn.textContent = 'Downloading…'; await refreshSnapshot(true); if (!S?.snap) toast('error', 'Could not download. Check the connection and try again.'); }] },
      { id: 'store', ok: persisted, title: 'Browser will not delete the saved data', ok_t: 'Protected storage is on.', bad_t: 'Ask the browser to keep the data (recommended).', action: ['Protect storage', async () => { try { const g = await navigator.storage.persist(); toast(g ? 'success' : 'warning', g ? 'Storage protected' : 'The browser did not allow it. Installing the app to the home screen usually fixes this.'); } catch (e) { /* unsupported */ } }] },
      { id: 'pin', ok: pin === true, soft: pin === null, title: 'Staff can sign in with no internet (offline PIN)', ok_t: 'This till is enrolled for offline sign-in.', bad_t: pin === null ? 'Open the Offline button next to this one to set up the offline PIN for this till.' : 'Not enrolled. Open the till offline centre, set up this till and create the offline PIN.', action: ['Set up offline PIN', () => { document.getElementById('hxo-guide')?.remove(); document.getElementById('ofl-top-btn')?.click(); }] },
    ];
  }
  const TIPS = [
    ['Every device is prepared separately', 'Waiter phones, the kitchen tablet, the cashier and the manager each need this checklist done once while online. Offline, devices cannot see each other: an order taken on a waiter phone shows on the kitchen screen only after that phone reconnects. For a busy kitchen with no internet, take orders on the same tablet the kitchen uses, or on the cashier till.'],
    ['What keeps working offline', 'Taking orders, sending to the kitchen, kitchen status and bumping, serving, bills, cash / card / M-PESA-code payments, tips, receiving stock, waste, stock adjustments, room-service orders for guests already checked in, and provisional receipts printed from the browser.'],
    ['What needs internet', 'M-PESA STK prompts, customer credit, deposits, reports, settings, uploading photos, and checking in new guests. The screen tells you when something needs internet.'],
    ['M-PESA offline', 'Ask the customer for the M-PESA message code and type it as the reference. It is saved as unverified and checked automatically after sync.'],
    ['Printing', 'The kitchen/receipt server printer needs internet. Offline, the app prints a PROVISIONAL receipt through the browser (set the receipt printer as the default printer). The official receipt is created when sync completes.'],
    ['Live TV menu', 'Pair each TV once while online. It then keeps showing the menu (pictures included) and switches breakfast/lunch/happy hour by its own clock. Price changes made during an outage reach the TV when the internet returns.'],
    ['When the internet comes back', 'Do nothing. The orange count turns into "Syncing…", then the green dot. If something could not be applied (for example an item that ran out of stock), it appears under "Needs attention" for a manager to review.'],
    ['Test before you rely on it', 'When all checks are green: switch the device to airplane mode, open Floor, take a test order, send it, pay it. Then turn the internet back on and watch it sync. Do this once per device.'],
  ];
  let allOk = false;
  async function openGuide() {
    document.getElementById('hxo-guide')?.remove();
    const box = document.createElement('div'); box.id = 'hxo-guide';
    box.style.cssText = 'position:fixed;inset:0;z-index:2700;background:rgba(15,23,42,.6);display:flex;align-items:center;justify-content:center;padding:12px';
    document.body.appendChild(box);
    const draw = async () => {
      const cs = await checks(); const done = cs.filter((c) => c.ok || c.soft).length; allOk = cs.every((c) => c.ok || c.soft); if (allOk) kvSet('guideDone', Date.now());
      box.innerHTML = `<div style="background:#fff;color:#0f172a;border-radius:16px;max-width:640px;width:100%;max-height:92vh;overflow:auto;font:14px/1.45 system-ui;padding:20px">
        <div style="display:flex;justify-content:space-between;align-items:start;gap:10px"><div><h2 style="margin:0 0 4px;font-size:19px">Set up offline mode</h2><p style="margin:0;color:#475569">${online() ? 'You are online: this is the right time to prepare this device.' : 'You are offline now. Steps that need internet are disabled until it returns.'}</p></div><button id="hxo-close" style="border:0;background:#e2e8f0;border-radius:8px;padding:6px 10px;cursor:pointer">Close</button></div>
        <div style="margin:14px 0;background:#e2e8f0;border-radius:99px;height:8px"><div style="width:${Math.round(done / cs.length * 100)}%;height:8px;border-radius:99px;background:${allOk ? '#0d7a4f' : '#1d4ed8'}"></div></div>
        <p style="margin:0 0 10px"><b>${allOk ? 'This device is ready to work offline.' : `${done} of ${cs.length} steps done`}</b>${pending ? ` · ${pending} step(s) waiting to sync` : ''}</p>
        ${cs.map((c, i) => `<div style="display:flex;gap:10px;padding:10px 0;border-top:1px solid #e2e8f0"><div style="flex:none;width:24px;height:24px;border-radius:50%;background:${c.ok ? '#0d7a4f' : c.soft ? '#94a3b8' : '#1d4ed8'};color:#fff;text-align:center;line-height:24px;font-weight:700">${c.ok ? '✓' : i + 1}</div><div style="flex:1"><b>${esc2(c.title)}</b><div style="color:#475569">${esc2(c.ok ? c.ok_t : c.bad_t)}</div>${c.action && (!c.ok || c.id === 'pages' || c.id === 'data') ? `<button data-a="${c.id}" style="margin-top:6px;border:0;border-radius:8px;padding:7px 12px;background:#1d4ed8;color:#fff;cursor:pointer">${esc2(c.ok ? 'Refresh' : c.action[0])}</button>` : ''}</div></div>`).join('')}
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin:12px 0"><button id="hxo-print" style="border:1px solid #cbd5e1;background:#fff;border-radius:8px;padding:7px 12px;cursor:pointer">Print test slip</button><button id="hxo-sync" style="border:1px solid #cbd5e1;background:#fff;border-radius:8px;padding:7px 12px;cursor:pointer">Sync now</button></div>
        <h3 style="margin:14px 0 6px;font-size:15px">How offline mode works</h3>
        ${TIPS.map(([h, t]) => `<details style="border-top:1px solid #e2e8f0;padding:8px 0"><summary style="cursor:pointer;font-weight:600">${esc2(h)}</summary><div style="color:#475569;margin-top:4px">${esc2(t)}</div></details>`).join('')}</div>`;
      box.querySelector('#hxo-close').onclick = () => { box.remove(); paintBtn(); };
      box.querySelector('#hxo-sync').onclick = () => { sync(); toast('info', 'Syncing…'); };
      box.querySelector('#hxo-print').onclick = () => { const f = document.createElement('iframe'); f.style.cssText = 'position:fixed;width:0;height:0;border:0'; document.body.appendChild(f); f.contentDocument.write('<html><body style="font:13px monospace;width:280px"><h3 style="text-align:center">PRINTER TEST</h3><p style="text-align:center">Provisional receipts will print here when offline.</p><hr>Item x1 <span style="float:right">0.00</span></body></html>'); f.contentDocument.close(); setTimeout(() => { try { f.contentWindow.print(); } catch (e) { /* blocked */ } setTimeout(() => f.remove(), 2000); }, 300); };
      cs.forEach((c) => { const b = box.querySelector(`[data-a="${c.id}"]`); if (b && c.action) b.onclick = async () => { await c.action[1](b); await draw(); paintBtn(); }; });
    };
    box.addEventListener('click', (e) => { if (e.target === box) box.remove(); });
    await draw();
  }

  // ------------------------------------------------------------ ONE offline button -> hub with everything
  function hubCss() {
    if (document.getElementById('hxo-css')) return; const st = document.createElement('style'); st.id = 'hxo-css';
    st.textContent = '#ofl-top-btn,.ofl-chip,#hxo-chip{display:none!important}#hxo-hub{position:fixed;inset:0;z-index:2750;background:rgba(15,23,42,.6);display:flex;align-items:center;justify-content:center;padding:10px;font:14px/1.45 system-ui,sans-serif}#hxo-hub .hc{background:#fff;color:#0f172a;border-radius:16px;max-width:560px;width:100%;max-height:92vh;overflow:auto;padding:18px 20px}#hxo-hub h3{margin:14px 0 6px;font-size:15px}#hxo-hub .g{display:grid;grid-template-columns:1fr 1fr;gap:8px}#hxo-hub button.hb{border:1px solid #cbd5e1;background:#f8fafc;border-radius:10px;padding:10px;text-align:left;cursor:pointer;font:inherit;display:flex;gap:8px;align-items:center}#hxo-hub button.hb:hover{background:#eef2ff}#hxo-hub .ok{color:#0d7a4f}#hxo-hub .no{color:#b45309}@media(max-width:520px){#hxo-hub .g{grid-template-columns:1fr}}';
    document.head.appendChild(st);
  }
  const SV = (d) => `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="flex:none">${d}</svg>`;
  const HI = { tour: SV('<path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z"/><path d="M9 4v14M15 6v14"/>'), sync: SV('<path d="M20 11a8 8 0 0 0-14-4M4 4v4h4M4 13a8 8 0 0 0 14 4M20 20v-4h-4"/>'), dl: SV('<path d="M12 3v12M7 11l5 5 5-5M4 20h16"/>'), key: SV('<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M16 7l3 3"/>'), print: SV('<path d="M7 9V3h10v6M7 17H4v-7h16v7h-3M7 14h10v7H7z"/>'), review: SV('<path d="M9 11l3 3 8-8M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9"/>'), ok: SV('<path d="M5 12l5 5 9-10"/>'), x: SV('<path d="M6 6l12 12M18 6L6 18"/>') };
  async function openHub() {
    hubCss(); document.getElementById('hxo-hub')?.remove(); const box = document.createElement('div'); box.id = 'hxo-hub'; document.body.appendChild(box);
    const draw = async () => {
      const cs = await checks(); const iss = await issuesAll(); window.__hxoIssues = iss.length; const snap = S && S.snap;
      const age = snap ? Math.round((Date.now() - S.takenAt) / 60000) : null; const ready = cs.every((c) => c.ok || c.soft);
      const state = iss.length ? ['#b91c1c', `${iss.length} step(s) need attention`] : !online() ? ['#ea580c', 'No internet: working offline'] : pending || syncing ? ['#ea580c', syncing ? 'Syncing…' : `${pending} step(s) waiting to sync`] : ready ? ['#0d7a4f', 'Ready to work offline'] : ['#1d4ed8', 'This device still needs setting up'];
      box.innerHTML = `<div class="hc"><div style="display:flex;justify-content:space-between;gap:8px;align-items:center"><h2 style="margin:0;font-size:19px">Offline mode</h2><button id="hx-x" class="hb" style="padding:6px 12px">Close</button></div>
        <div style="display:flex;align-items:center;gap:10px;margin:10px 0;padding:12px;border-radius:12px;background:${state[0]}14"><span style="width:12px;height:12px;border-radius:50%;background:${state[0]};box-shadow:0 0 0 4px ${state[0]}33"></span><div><b>${esc2(state[1])}</b><div style="color:#475569">${online() ? 'Connected to the server.' : 'Everything you do is saved on this device and sent when the internet returns.'}${snap ? ` Menu and data saved ${age < 1 ? 'just now' : age + ' min ago'}.` : ' No data saved yet.'}</div></div></div>
        <div class="g"><button class="hb" data-h="tour">${HI.tour}<span><b>Setup tour</b><br><small>Step-by-step guide</small></span></button><button class="hb" data-h="sync">${HI.sync}<span><b>Sync now</b><br><small>${pending} waiting</small></span></button><button class="hb" data-h="data">${HI.dl}<span><b>Download latest data</b><br><small>Menu, prices, stock, staff</small></span></button><button class="hb" data-h="pin">${HI.key}<span><b>Offline sign-in PIN</b><br><small>Till offline centre</small></span></button><button class="hb" data-h="print">${HI.print}<span><b>Test print</b><br><small>Provisional receipt</small></span></button><button class="hb" data-h="review">${HI.review}<span><b>Offline review</b><br><small>For managers</small></span></button></div>
        <h3>Setup checklist</h3>${cs.map((c) => `<div style="display:flex;gap:8px;padding:4px 0"><span class="${c.ok ? 'ok' : 'no'}">${c.ok ? HI.ok : HI.x}</span><span><b>${esc2(c.title)}</b><br><small style="color:#64748b">${esc2(c.ok ? c.ok_t : c.bad_t)}</small></span></div>`).join('')}
        ${iss.length ? `<h3>Needs attention</h3><p style="color:#475569;margin:0 0 6px">These steps could not be applied by the server. Nothing was deleted. A manager can check them under Offline review.</p>${iss.map((i) => `<div style="padding:8px 0;border-top:1px solid #e2e8f0"><b>${esc2(i.type)}</b>: ${esc2(i.message)} <button class="hb" data-d="${esc2(i.clientOpId)}" style="float:right;padding:4px 10px">Dismiss</button></div>`).join('')}` : ''}
        <h3>What works offline</h3><div class="g" style="gap:2px 12px"><div><span class="ok">${HI.ok}</span> Orders and kitchen<br><span class="ok">${HI.ok}</span> Bills, cash, card, M-PESA code<br><span class="ok">${HI.ok}</span> Receive stock, waste, adjust<br><span class="ok">${HI.ok}</span> Room-service orders<br><span class="ok">${HI.ok}</span> Live TV menu</div><div><span class="no">${HI.x}</span> M-PESA STK prompt<br><span class="no">${HI.x}</span> Customer credit, deposits<br><span class="no">${HI.x}</span> Menu, price and setup changes<br><span class="no">${HI.x}</span> Check-in / check-out<br><span class="no">${HI.x}</span> Refunds, uploads</div></div></div>`;
      const on = (sel, fn) => box.querySelectorAll(sel).forEach((b) => { b.onclick = () => fn(b); });
      box.querySelector('#hx-x').onclick = () => { box.remove(); paintBtn(); };
      on('[data-h="tour"]', () => { box.remove(); window.HXOfflineGuide.open(); });
      on('[data-h="sync"]', () => { if (!online()) return toast('warning', 'No internet yet. It will sync by itself when it returns.'); sync(); toast('info', 'Syncing…'); setTimeout(draw, 1500); });
      on('[data-h="data"]', async (b) => { if (!online()) return toast('warning', 'You need internet to download.'); b.disabled = true; await refreshSnapshot(true); toast('success', 'Saved the latest data'); draw(); });
      on('[data-h="pin"]', () => { box.remove(); const t = document.getElementById('ofl-top-btn'); if (t) t.click(); else toast('info', 'The offline PIN screen is not available on this page. Open the Dashboard and try again.'); });
      on('[data-h="print"]', () => { const f = document.createElement('iframe'); f.style.cssText = 'position:fixed;width:0;height:0;border:0'; document.body.appendChild(f); f.contentDocument.write('<html><body style="font:13px monospace;width:280px"><h3 style="text-align:center">PRINTER TEST</h3><p style="text-align:center">Provisional receipts print here when offline.</p></body></html>'); f.contentDocument.close(); setTimeout(() => { try { f.contentWindow.print(); } catch (e) { /* blocked */ } setTimeout(() => f.remove(), 2000); }, 300); });
      on('[data-h="review"]', () => { location.href = 'offline-review.html'; });
      on('[data-d]', async (b) => { await issueDel(b.dataset.d); draw(); paintBtn(); });
    };
    box.addEventListener('click', (e) => { if (e.target === box) box.remove(); });
    await draw();
  }
  // Top-bar button with a status dot: BLUE = set up needed, GREEN = ready, ORANGE = offline / waiting, RED = needs attention.
  function paintBtn() {
    hubCss();
    const bar = document.querySelector('.topbar-right'); if (!bar || !/^(hx-|tv)/.test((location.pathname.split('/').pop() || ''))) { if (!bar) return; }
    let b = document.getElementById('hxo-top-btn');
    if (!b) { b = document.createElement('button'); b.id = 'hxo-top-btn'; b.type = 'button'; b.className = 'btn btn-ghost btn-sm'; b.title = 'Restaurant offline mode: setup guide and status'; b.style.cssText = 'display:inline-flex;align-items:center;gap:6px'; b.onclick = openHub; const first = document.getElementById('ofl-top-btn'); bar.insertBefore(b, first || bar.firstChild); }
    const issues = window.__hxoIssues || 0; const ready = !!(S && S.snap) && (S.takenAt && Date.now() - S.takenAt < 864e5);
    const [col, txt] = issues ? ['#b91c1c', 'Needs attention'] : !online() ? ['#ea580c', pending ? `Offline · ${pending}` : 'Offline'] : pending || syncing ? ['#ea580c', syncing ? 'Syncing…' : `${pending} to sync`] : ready && guideDone ? ['#0d7a4f', 'Offline ready'] : ['#1d4ed8', 'Set up offline'];
    b.innerHTML = `<span style="width:9px;height:9px;border-radius:50%;background:${col};display:inline-block;box-shadow:0 0 0 3px ${col}33"></span><span>${esc2(txt)}</span>`;
  }
  let guideDone = false;
  (async function guideInit() {
    guideDone = !!(await kvGet('guideDone'));
    const t = setInterval(paintBtn, 3000); paintBtn();
    window.addEventListener('hxoffline:snapshot', async () => { guideDone = guideDone || !!(await kvGet('guideDone')); paintBtn(); });
    ['hxoffline:queued', 'hxoffline:synced', 'connectivitychange'].forEach((ev) => window.addEventListener(ev, paintBtn));
    // First visit: point the person to the guide once (never nags again).
    setTimeout(async () => { if (!(await kvGet('guideSeen')) && online() && !guideDone && /(^|\/)hx-(floor|cashier|kitchen|dashboard)/.test(location.pathname)) { await kvSet('guideSeen', 1); try { window.HXOfflineGuide.open(); } catch (e) { toast('info', 'Tip: tap "Set up offline" at the top to prepare this device.'); } } }, 6000);
    void t;
  })();
  window.HXOfflineGuide = window.HXOfflineGuide || { open: openGuide }; window.HXOfflineGuide.fallback = openGuide;

  Api.__hxOffline = true;
  window.HXOfflineHub = { open: openHub };
  window.HXOffline = { sync, refresh: () => refreshSnapshot(true), pending: () => pending, isOnline: online, issues: issuesAll, checks, downloadPages, state: () => S, kvGet, kvSet, toast };
})(window);
