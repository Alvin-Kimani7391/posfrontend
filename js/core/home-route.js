/**
 * home-route.js
 * ONE place that decides which screen a signed-in person lands on.
 *
 * Why this exists: the login API only returns the user + tokens, it does NOT say what kind of business it is.
 * The old login code looked for the business type in that response, never found it, and so every
 * owner of a restaurant / accommodation business was sent to the retail dashboard.
 * Here we read GET /business/profile (every role may read it), cache it, and route from that.
 *
 *   HomeRoute.resolve()        -> Promise<string>  page to open now (e.g. 'hx-dashboard.html')
 *   HomeRoute.isHospitality(p) -> true for restaurant / accommodation businesses
 *   HomeRoute.landingFor(user, profile)
 */
(function (window) {
  const PROFILE_KEY = 'pos.businessProfile';
  const RETAIL_HOME = 'dashboard.html';
  const HX_HOME = 'hx-dashboard.html';
  const HX_ROLES = ['WAITER', 'HEAD_WAITER', 'SUPERVISOR', 'CHEF', 'KITCHEN_STAFF', 'BARTENDER', 'EXPEDITOR', 'DELIVERY_RIDER', 'RECEPTIONIST', 'HOUSEKEEPER'];

  const uid = (u) => (u && (u._id || u.id)) || '';

  function cachedProfile() {
    try {
      const p = JSON.parse(localStorage.getItem(PROFILE_KEY) || 'null');
      const u = window.Storage.getUser();
      return p && u && String(p.userId) === String(uid(u)) ? p : null;
    } catch { return null; }
  }

  async function fetchProfile() {
    const { data } = await window.Api.get('/business/profile');
    const p = { ...data.profile, userId: uid(window.Storage.getUser()) };
    try { localStorage.setItem(PROFILE_KEY, JSON.stringify(p)); } catch { /* storage blocked */ }
    return p;
  }

  /** Restaurant business type, or the restaurant / accommodation modules switched on. */
  function isHospitality(profile) {
    if (!profile) return false;
    const f = profile.featureSettings || {};
    return profile.businessType === 'restaurant' || f.restaurantOrdering === true || f.accommodation === true;
  }

  function hasRooms(profile) { return !!(profile && profile.featureSettings && profile.featureSettings.accommodation === true); }
  function hasRestaurant(profile) { return !!(profile && profile.featureSettings && profile.featureSettings.restaurantOrdering === true); }

  /** Each role opens the screen it works in all day. Owners and managers get the overview. */
  function landingFor(user, profile) {
    const role = user && user.role;
    const hx = isHospitality(profile) || HX_ROLES.includes(role);
    if (!hx) return RETAIL_HOME;
    const rooms = hasRooms(profile), food = hasRestaurant(profile) || !rooms;
    switch (role) {
      case 'CHEF': case 'KITCHEN_STAFF': case 'EXPEDITOR': case 'BARTENDER': return 'hx-kitchen.html';
      case 'WAITER': case 'HEAD_WAITER': return 'hx-floor.html';
      case 'RECEPTIONIST': return rooms ? 'hx-desk.html' : HX_HOME;
      case 'HOUSEKEEPER': return 'hx-housekeeping.html';
      case 'DELIVERY_RIDER': return 'hx-delivery.html';
      case 'CASHIER': return food ? 'hx-floor.html' : (rooms ? 'hx-desk.html' : HX_HOME);
      default: return HX_HOME;
    }
  }

  /** Works out the landing page; a failed request falls back to the cached profile, then to the retail dashboard. */
  async function resolve() {
    const user = window.Storage.getUser();
    let profile = null;
    try { profile = await fetchProfile(); } catch { profile = cachedProfile(); }
    return landingFor(user, profile);
  }

  /** Used by retail pages: if this is a hospitality business, go to its own home instead. */
  async function redirectIfHospitality() {
    const user = window.Storage.getUser();
    let profile = cachedProfile();
    if (!profile) { try { profile = await fetchProfile(); } catch { /* offline */ } }
    if (isHospitality(profile) || HX_ROLES.includes(user && user.role)) {
      window.location.replace(landingFor(user, profile));
      return true;
    }
    return false;
  }

  window.HomeRoute = { resolve, landingFor, isHospitality, hasRooms, hasRestaurant, cachedProfile, fetchProfile, redirectIfHospitality, HX_ROLES, HX_HOME, RETAIL_HOME };
})(window);
