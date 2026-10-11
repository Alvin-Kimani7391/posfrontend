/**
 * storage.js
 * Every read/write of localStorage in the app goes through here.
 *
 * OFFLINE: an "offline session" lets a cashier unlock a till with an offline PIN when there is no
 * internet (see offline-auth.js). It has NO tokens, so the server cannot be called until the person
 * signs in online; sales made meanwhile wait safely in the IndexedDB outbox.
 */
(function (window) {
  const KEYS = {
    ACCESS_TOKEN: 'pos.accessToken',
    REFRESH_TOKEN: 'pos.refreshToken',
    USER: 'pos.user',
    ACTIVE_BRANCH_ID: 'pos.activeBranchId',
    OFFLINE_SESSION: 'pos.offlineSession',
  };

  const Storage = {
    getAccessToken: () => localStorage.getItem(KEYS.ACCESS_TOKEN),
    getRefreshToken: () => localStorage.getItem(KEYS.REFRESH_TOKEN),

    setTokens({ accessToken, refreshToken }) {
      if (accessToken) localStorage.setItem(KEYS.ACCESS_TOKEN, accessToken);
      if (refreshToken) localStorage.setItem(KEYS.REFRESH_TOKEN, refreshToken);
      if (accessToken || refreshToken) localStorage.removeItem(KEYS.OFFLINE_SESSION); // a real sign-in replaces any offline session
    },

    getUser() {
      const raw = localStorage.getItem(KEYS.USER);
      return raw ? JSON.parse(raw) : null;
    },
    setUser(user) {
      localStorage.setItem(KEYS.USER, JSON.stringify(user));
    },

    getActiveBranchId: () => localStorage.getItem(KEYS.ACTIVE_BRANCH_ID),
    setActiveBranchId(branchId) {
      if (branchId) localStorage.setItem(KEYS.ACTIVE_BRANCH_ID, branchId);
    },

    getOfflineSession() {
      try { return JSON.parse(localStorage.getItem(KEYS.OFFLINE_SESSION) || 'null'); } catch { return null; }
    },
    setOfflineSession(session) {
      localStorage.setItem(KEYS.OFFLINE_SESSION, JSON.stringify(session));
    },

    clearSession() {
      Object.values(KEYS).forEach((k) => localStorage.removeItem(k));
    },

    isAuthenticated() {
      return !!Storage.getAccessToken() || !!Storage.getOfflineSession();
    },
  };

  window.Storage = Storage;
})(window);