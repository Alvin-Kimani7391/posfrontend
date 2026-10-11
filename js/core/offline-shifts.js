/**
 * offline-shifts.js - open / close shifts with no internet.
 * Events travel in the SAME ordered outbox as sales (SHIFT_OPEN, SHIFT_CLOSE), so the server replays them in order.
 * One record on this till: { origin:'server'|'offline', clientShiftId, shiftId, registerId, registerName,
 *                            openingCashCents, openedAt, closed }
 */
(function (window) {
  'use strict';
  const Offline = (window.Offline = window.Offline || {});
  const DB = window.OfflineDB;
  const uid = () => (window.crypto?.randomUUID ? crypto.randomUUID().replace(/-/g, '') : `${Date.now().toString(16)}${Math.random().toString(16).slice(2, 14)}`.padEnd(32, '0'));
  const nowIso = () => new Date(Offline.time.now()).toISOString();
  const fail = (m) => { throw new Error(m); };
  let cur = null;

  const persist = () => (cur ? DB.kvSet('shift', cur) : DB.kvDel('shift'));
  function grant() {
    const g = Offline.auth.activeGrant();
    if (!g) fail('This cashier has no offline permission stored on this till. Sign in online once on this till.');
    if (!Offline.grants.valid(g)) fail('The offline window has ended. Connect to the internet to continue.');
    return g;
  }

  const S = (Offline.shifts = {
    async load() { cur = (await DB.kvGet('shift')) || null; Offline.on('pending', () => S.cleanup()); },

    /** Same shape the sales screen already expects from GET /shifts/current. */
    current() {
      if (!cur || cur.closed) return null;
      return {
        _id: cur.shiftId || cur.clientShiftId, clientShiftId: cur.clientShiftId, shiftId: cur.shiftId, status: 'OPEN',
        openedAt: cur.openedAt, openingCash: cur.openingCashCents / 100, offline: cur.origin === 'offline',
        registerId: { _id: cur.registerId, name: cur.registerName, code: cur.registerCode },
      };
    },

    /** Online: remember the server's current shift so it is still known when the internet drops. */
    async syncServer(serverShift) {
      if (cur && cur.origin === 'offline' && (!cur.closed || S._closePending)) return;
      if (serverShift) {
        const reg = serverShift.registerId || {};
        cur = { origin: 'server', shiftId: serverShift._id, registerId: reg._id || reg, registerName: reg.name, registerCode: reg.code,
          openingCashCents: Math.round((serverShift.openingCash || 0) * 100), openedAt: serverShift.openedAt, closed: false };
      } else if (cur && cur.origin === 'server') cur = null;
      await persist();
    },

    async open({ registerId, registerName, registerCode, openingCash }) {
      const g = grant();
      if (g.caps && g.caps.canOpenShift === false) fail('You are not allowed to open shifts.');
      if (cur && !cur.closed) fail('A shift is already open on this till.');
      const id = uid(); const at = nowIso();
      await Offline.outbox.enqueue('SHIFT_OPEN', {
        type: 'SHIFT_OPEN', clientEventId: id, occurredAt: at, grant: g.grant, clientShiftId: id,
        registerId, openingCashCents: Math.round((Number(openingCash) || 0) * 100),
      }, { ref: id, soldAt: at, totalCents: 0 });
      cur = { origin: 'offline', clientShiftId: id, registerId, registerName, registerCode, openingCashCents: Math.round((Number(openingCash) || 0) * 100), openedAt: at, closed: false };
      await persist();
      Offline.emit('shift');
      Offline.sync.kick();
      return S.current();
    },

    /** denominations: [{denomination, count}] from CashCount. Expected cash / difference are worked out by the server at sync. */
    async close({ denominations, notes }) {
      const g = grant();
      if (!cur || cur.closed) fail('There is no open shift on this till.');
      if (g.caps && g.caps.canCloseShift === false) fail('You are not allowed to close shifts.');
      const lim = g.limits || {};
      let pend = await Offline.outbox.pending();
      if (pend.sales > 0 && lim.allowShiftCloseWithPending === false) {
        if (window.Connectivity.isOnline()) { await Offline.sync.now(); pend = await Offline.outbox.pending(); }
        if (pend.sales > 0) fail('Sales on this till have not reached the server yet. Connect to the internet and let them sync before closing the shift (your manager can change this rule in Offline settings).');
      }
      const id = uid(); const at = nowIso();
      await Offline.outbox.enqueue('SHIFT_CLOSE', {
        type: 'SHIFT_CLOSE', clientEventId: id, occurredAt: at, grant: g.grant, notes: notes || undefined,
        denominations: denominations.map((d) => ({ denomination: d.denomination, count: d.count })),
        ...(cur.origin === 'offline' ? { clientShiftId: cur.clientShiftId } : { shiftId: cur.shiftId }),
      }, { ref: id, soldAt: at, totalCents: 0 });
      cur.closed = true; cur.closedAt = at;
      await persist();
      Offline.emit('shift');
      Offline.sync.kick();
      return { totalCents: Math.round(denominations.reduce((a, d) => a + d.denomination * d.count, 0) * 100), closedAt: at };
    },

    /** Called by the sync engine when the server accepted a SHIFT_OPEN. */
    async onOpenSynced(ref, shiftId) {
      if (cur && cur.clientShiftId === ref) { cur.shiftId = shiftId; await persist(); }
    },

    /** Forget a closed shift once its close event has reached the server. */
    async cleanup() {
      if (!cur || !cur.closed) return;
      const rows = await Offline.outbox.list();
      S._closePending = rows.some((r) => r.type === 'SHIFT_CLOSE');
      if (!S._closePending) { cur = null; await persist(); Offline.emit('shift'); }
    },
  });
})(window);
