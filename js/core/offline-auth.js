/**
 * offline-auth.js
 * Who is at the till when there is no internet.
 *
 *  - A cashier sets an OFFLINE PIN (6-8 digits) while online (needs their password). The server stores a
 *    PBKDF2 verifier; this till also keeps its own PBKDF2 verifier for that user.
 *  - SHARED tills: a manager, online, "issues the roster": one signed grant + verifier per cashier of the
 *    branch, so cashiers can switch by PIN while offline.
 *  - The signed GRANT (not the PIN) is what the server trusts: every offline sale carries the cashier's
 *    grant and is checked against the permissions they had when it was issued.
 *  - Wrong PINs lock the screen (5 tries, then growing waits; 10 tries = sign in online).
 *  - Offline login: the login page can unlock a till by PIN when there is no internet. That session has no
 *    tokens, so the till keeps selling through the outbox and syncs after someone signs in online.
 *
 * LIMITS: PIN verifiers live encrypted on the device. 6-8 digits is brute-forceable by someone who copies the
 * data, so the real protection for a stolen till is Devices > Block (the server then holds its sales for review).
 */
(function (window) {
  'use strict';
  const Offline = (window.Offline = window.Offline || {});
  const DB = window.OfflineDB;
  const te = new TextEncoder();
  const ITER = 210000;
  const IDLE_MS = 5 * 60 * 1000;
  const SS = window.sessionStorage;

  let roster = [];   // [{ userId, name, role, employeeCode, pin:{salt,iterations,hash}, profile }]
  let selfPins = {}; // userId -> { profile, pin }
  let lastActivity = Date.now();

  const idOf = (u) => String((u && (u._id || u.id)) || '');
  function tokenUserId() {
    const t = window.Storage.getAccessToken();
    if (!t) return '';
    try { return Offline.grants.decode(t).sub || ''; } catch { return ''; }
  }

  async function derive(pin, saltB64, iterations) {
    const base = await crypto.subtle.importKey('raw', te.encode(pin), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: DB.util.unb64(saltB64), iterations, hash: 'SHA-256' }, base, 256);
    return DB.util.b64(bits);
  }

  const A = (Offline.auth = {
    async load() {
      const r = await DB.kvGet('roster'); roster = r ? await DB.vault.decrypt(r) : [];
      const s = await DB.kvGet('selfPins'); selfPins = s ? await DB.vault.decrypt(s) : {};
      ['click', 'keydown', 'touchstart'].forEach((e) => document.addEventListener(e, () => { lastActivity = Date.now(); }, { passive: true, capture: true }));
      setInterval(() => { // keep the unlock fresh while online; idle-lock shared tills while offline
        if (window.Connectivity.isOnline() && !A.mismatch()) SS.setItem('pos.offline.unlockedAt', String(Date.now()));
        else if (Offline.context.get()?.device?.mode === 'SHARED' && Date.now() - lastActivity > IDLE_MS) SS.removeItem('pos.offline.unlockedAt');
      }, 15000);
      if (window.Connectivity.isOnline() && !A.mismatch()) SS.setItem('pos.offline.unlockedAt', String(Date.now()));
    },

    /** The user whose grant signs the sales on this screen right now. */
    activeUserId() {
      return SS.getItem('pos.offline.active') || tokenUserId() || (window.Storage.getOfflineSession() || {}).userId || idOf(window.Storage.getUser());
    },
    /** True when the person at the till is not the person the server session belongs to (or there is no server session). */
    mismatch() {
      const t = tokenUserId();
      const a = A.activeUserId();
      return !t || (!!a && t !== a);
    },
    activeGrant() { return Offline.grants.get(A.activeUserId()); },
    activeName() { const g = A.activeGrant(); return (g && g.name) || (window.Storage.getUser() || {}).name || ''; },

    verifierFor(userId) {
      const r = roster.find((x) => x.userId === userId);
      if (r) return r.pin;
      return selfPins[userId] ? selfPins[userId].pin : null;
    },
    profileFor(userId) {
      const r = roster.find((x) => x.userId === userId);
      if (r) return r.profile;
      return selfPins[userId] ? selfPins[userId].profile : null;
    },
    listLoginUsers() {
      const map = new Map();
      Object.entries(selfPins).forEach(([id, v]) => map.set(id, { userId: id, name: v.profile.name, role: v.profile.role }));
      roster.forEach((r) => map.set(r.userId, { userId: r.userId, name: r.name, role: r.role }));
      return [...map.values()];
    },
    canOfflineLogin: () => A.listLoginUsers().length > 0 && Offline.device.enrolled(),
    hasPin: () => !!A.verifierFor(idOf(window.Storage.getUser())),

    async setPin({ password, pin }) {
      await window.Api.put('/devices/offline-pin', { password, pin });
      const profile = window.Storage.getUser();
      const salt = DB.util.b64(crypto.getRandomValues(new Uint8Array(16)));
      selfPins[idOf(profile)] = { profile, pin: { salt, iterations: ITER, hash: await derive(pin, salt, ITER) } };
      await DB.kvSet('selfPins', await DB.vault.encrypt(selfPins));
      Offline.emit('readiness');
    },

    /** Manager, online, on this till: downloads signed grants + PIN verifiers for the branch's cashiers. */
    async refreshRoster() {
      const { data } = await window.Api.post('/devices/roster', { deviceId: Offline.device.id() }, { headers: Offline.device.headers(), background: true });
      const branch = Offline.context.get()?.branch;
      const next = [];
      for (const e of data.roster) {
        const claims = Offline.grants.decode(e.grant);
        await Offline.grants.save({ userId: e.userId, name: e.name, role: e.role, grant: e.grant, claims, offlineUntil: claims.offlineUntil, caps: e.caps, limits: claims.limits, savedAt: Date.now() });
        next.push({
          userId: e.userId, name: e.name, role: e.role, pin: e.pin,
          profile: { _id: e.userId, name: e.name, role: e.role, employeeCode: e.employeeCode, businessId: claims.businessId, branchIds: branch ? [branch.id] : [claims.branchId], grantedPermissions: [], revokedPermissions: [] },
        });
      }
      roster = next;
      await DB.kvSet('roster', await DB.vault.encrypt(roster));
      Offline.time.sync(data.serverTime);
      return next.length;
    },

    /** Drops grants, roster and PIN verifiers (used when a shared till signs out with nothing left to sync). */
    async clearUserData() {
      roster = []; selfPins = {};
      await Promise.all([DB.kvDel('roster'), DB.kvDel('selfPins')]);
      for (const g of Offline.grants.all()) await Offline.grants.forget(g.userId);
      SS.removeItem('pos.offline.active'); SS.removeItem('pos.offline.unlockedAt');
    },

    async checkPin(userId, pin) {
      const fails = (await DB.kvGet('pinfails')) || { n: 0, until: 0 };
      if (fails.n >= 10) throw new Error('Too many wrong PINs. Connect to the internet and sign in with your password.');
      if (Date.now() < fails.until) throw new Error(`Too many wrong PINs. Wait ${Math.ceil((fails.until - Date.now()) / 1000)} s.`);
      const v = A.verifierFor(userId);
      if (!v) throw new Error('No offline PIN is set for this user on this till.');
      const ok = (await derive(String(pin), v.salt, v.iterations)) === v.hash;
      if (!ok) {
        const n = fails.n + 1;
        await DB.kvSet('pinfails', { n, until: n >= 5 ? Date.now() + Math.min(1800, 30 * 2 ** (n - 5)) * 1000 : 0 });
        throw new Error(n >= 10 ? 'Too many wrong PINs. Sign in online.' : 'Wrong PIN.');
      }
      await DB.kvSet('pinfails', { n: 0, until: 0 });
    },

    /** Lock screen: verifies the PIN and makes that user the active seller. Reloads when the person changed. */
    async unlock(userId, pin) {
      await A.checkPin(userId, pin);
      const before = A.activeUserId();
      SS.setItem('pos.offline.active', userId);
      SS.setItem('pos.offline.unlockedAt', String(Date.now()));
      lastActivity = Date.now();
      if (userId !== before) {
        const profile = A.profileFor(userId);
        if (profile) window.Storage.setUser(profile);
        window.location.reload();
      }
      Offline.emit('readiness');
    },

    /** Login page, no internet: PIN unlock without tokens. */
    async offlineLogin(userId, pin) {
      await A.checkPin(userId, pin);
      const profile = A.profileFor(userId);
      if (!profile) throw new Error('This user cannot sign in offline on this till.');
      window.Storage.setOfflineSession({ userId, at: Date.now() });
      window.Storage.setUser(profile);
      const branchId = (profile.branchIds || [])[0];
      if (branchId) window.Storage.setActiveBranchId(String(branchId));
      SS.setItem('pos.offline.active', userId);
      SS.setItem('pos.offline.unlockedAt', String(Date.now()));
      return profile;
    },

    lockNow() { SS.removeItem('pos.offline.unlockedAt'); Offline.emit('mode', {}); },

    /** Should the lock screen cover the till right now? */
    requiresUnlock() {
      if (!Offline.device.enrolled()) return false;
      if (window.Connectivity.isOnline() && !A.mismatch()) return false;
      const g = A.activeGrant();
      const hours = (g && g.limits && g.limits.sessionHours) || 12;
      const at = Number(SS.getItem('pos.offline.unlockedAt') || 0);
      if (at && Date.now() - at < hours * 3600e3) return false;
      if (A.verifierFor(A.activeUserId())) return true;
      return Offline.context.get()?.device?.mode === 'SHARED'; // a dedicated till with no PIN set keeps working (and nags to set one)
    },
  });
})(window);