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
    try { const { data } = await NATIVE.get('/restaurant/offline/snapshot', { branchId: b }, { background: true }); fromSnapshot(data); emit('snapshot'); } catch (e) { /* keep the old one */ }
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
  const oref = (id, ops) => (L(id) ? { opId: ops.get(id) } : { orderId: id });
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
      return enqueue('generateBill', { orderRef: oref(o._id, opOfLocal2()), payload: { label: b.label, customerId: b.customerId } }, (op) => { opOfLocal[bill._id] = op.clientOpId; return ok({ bill }, 'Bill ready (offline)'); });
    }],
    ['POST', /^\/restaurant\/bills\/([^/]+)\/pay$/, (m, b) => {
      const bill = S.bills[m[1]]; if (!bill) throw fail('Bill not found on this till', 'BILL_NOT_FOUND', 404);
      const pays = (b.payments || []).map((p) => { if (p.method === 'CREDIT' || p.method === 'DEPOSIT') throw needsNet(`${p.method === 'CREDIT' ? 'Customer credit' : 'Using a deposit'}`); if (p.method === 'MPESA' && !/^[A-Za-z0-9]{8,12}$/.test(String(p.reference || ''))) throw fail("Enter the customer's M-PESA code (e.g. SJK2L9XYZ1) to take M-PESA offline.", 'MPESA_REFERENCE_REQUIRED', 400); if (p.method === 'MOBILE_MONEY' && !p.reference) throw fail('A transaction reference is required', 'MOBILE_MONEY_REFERENCE_REQUIRED', 400); if (cents(p.amount) > cents(bill.balance)) throw fail('Payment is more than the balance owing', 'OVERPAYMENT', 400); return p; });
      let change = 0;
      pays.forEach((p) => { bill.payments.push({ kind: 'PAYMENT', method: p.method, amount: p.amount, reference: p.reference, at: new Date().toISOString(), verifyStatus: ['MPESA', 'MOBILE_MONEY'].includes(p.method) ? 'PENDING' : undefined }); bill.paid = Math.round((bill.paid + Number(p.amount)) * 100) / 100; bill.balance = Math.round((bill.total - bill.paid) * 100) / 100; if (p.method === 'CASH' && p.tendered) change += Math.max(0, p.tendered - p.amount); });
      bill.status = bill.balance <= 0 ? 'PAID' : 'PARTIAL';
      const o = S.orders[bill.orderId]; let receipt = null;
      if (bill.status === 'PAID') { receipt = { receiptNumber: bill.billNumber, offline: true }; bill.receiptNumber = receipt.receiptNumber; if (o) { o.billStatus = 'PAID'; if (!Object.values(S.bills).some((x) => x.orderId === o._id && !['PAID', 'VOID'].includes(x.status)) && o.items.every((i) => ['SERVED', 'CANCELLED'].includes(i.status))) { o.status = 'CLOSED'; const t = o.tableId && tableOf(o.tableId); if (t) Object.assign(t, { status: 'CLEANING', currentOrderId: null, order: null }); } } }
      return enqueue('pay', { billRef: L(bill._id) ? { opId: opOfLocal[bill._id] } : { billId: bill._id }, payload: { customerId: b.customerId, payments: pays.map((p) => ({ method: p.method, amountCents: cents(p.amount), tenderedCents: p.tendered != null ? cents(p.tendered) : undefined, reference: p.reference, network: p.network, payerPhone: p.payerPhone, stayId: p.stayId })) } },
        () => { emit('receipt', { bill: clone(bill), order: o ? clone(o) : null, provisional: true }); return ok({ bill, sale: { receiptNumber: bill.receiptNumber, offline: true }, receipt, change }, 'Payment saved offline. A provisional receipt can be printed; the official one is issued when sync completes.'); });
    }],
    ['POST', /^\/restaurant\/bills\/([^/]+)\/tips$/, (m, b) => enqueue('addTip', { billRef: L(m[1]) ? { opId: opOfLocal[m[1]] } : { billId: m[1] }, payload: { amountCents: cents(b.amount), method: b.method, reference: b.reference, waiterId: b.waiterId } }, () => ok({ tip: { amount: b.amount } }))],
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
  Api.get = async function (path, query, opts) {
    if (!R.test(path) || /\/offline\//.test(path)) return NATIVE.get.call(Api, path, query, opts);
    await loadState();
    if (!online() || (pending && S && GETS.some(([re]) => re.test(path)))) return offlineGet(path, query);   // unsynced work exists only on this till: show it
    try { const r = await NATIVE.get.call(Api, path, query, opts); cacheSet(key(path, query), r.data); return r; }
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
  function paint() {
    let el = document.getElementById('hxo-chip');
    const issues = window.__hxoIssues || 0;
    const show = !online() || pending || syncing || issues; if (!el && !show) return;
    if (!el) { el = document.createElement('button'); el.id = 'hxo-chip'; el.type = 'button'; el.style.cssText = 'position:fixed;right:12px;bottom:12px;z-index:1300;border:0;border-radius:999px;padding:8px 14px;font:600 13px system-ui;color:#fff;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.25)'; el.onclick = panel; document.body.appendChild(el); }
    el.hidden = !show; el.style.background = !online() ? '#7c2d12' : issues ? '#b91c1c' : '#1d4ed8';
    el.textContent = !online() ? `Offline${pending ? ` · ${pending} waiting` : ''}` : syncing ? 'Syncing…' : issues ? `${issues} need attention` : `${pending} waiting to sync`;
  }
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

  Api.__hxOffline = true;
  window.HXOffline = { sync, refresh: () => refreshSnapshot(true), pending: () => pending, isOnline: online, issues: issuesAll };
})(window);
