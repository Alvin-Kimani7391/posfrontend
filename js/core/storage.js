/**
 * storage.js
 * Every read/write of localStorage in the app goes through here, so the
 * storage keys and shape only need to change in one place.
 */
(function (window) {
  const KEYS = {
    ACCESS_TOKEN: 'pos.accessToken',
    REFRESH_TOKEN: 'pos.refreshToken',
    USER: 'pos.user',
    ACTIVE_BRANCH_ID: 'pos.activeBranchId',
  };

  const Storage = {
    getAccessToken: () => localStorage.getItem(KEYS.ACCESS_TOKEN),
    getRefreshToken: () => localStorage.getItem(KEYS.REFRESH_TOKEN),

    setTokens({ accessToken, refreshToken }) {
      if (accessToken) localStorage.setItem(KEYS.ACCESS_TOKEN, accessToken);
      if (refreshToken) localStorage.setItem(KEYS.REFRESH_TOKEN, refreshToken);
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

    clearSession() {
      localStorage.removeItem(KEYS.ACCESS_TOKEN);
      localStorage.removeItem(KEYS.REFRESH_TOKEN);
      localStorage.removeItem(KEYS.USER);
      localStorage.removeItem(KEYS.ACTIVE_BRANCH_ID);
    },

    isAuthenticated() {
      return !!Storage.getAccessToken();
    },
  };

  window.Storage = Storage;
})(window);
