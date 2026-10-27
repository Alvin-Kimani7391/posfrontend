/**
 * liquor-till.js - wines & spirits at the till, online AND offline.
 *
 * ONLINE: the server guards every alcohol sale (age check, trading hours / dry day / licence, per-sale limit, empties deposit).
 *   The till posts the sale; if the server asks for something, this asks the cashier and retries the same sale.
 * OFFLINE: the server cannot answer, so the till asks the age check itself BEFORE the sale is saved to the outbox, using a copy of
 *   the rules (minimum age, ID mode, which products are alcohol, returnable containers) cached from GET /liquor/till/context.
 *   The check travels with the sale and is logged when it syncs. A buyer who looks under age is refused and nothing is saved.
 *
 *   LiquorTill.active()                  -> true for wines & spirits businesses
 *   LiquorTill.post(path, payload, opts) -> like Api.post, with the prompts above (online)
 *   LiquorTill.offlinePrepare(cart)      -> Promise<{ ageCheck? } | null>   null = cashier cancelled / refused; use before Offline.sales.create
 *   LiquorTill.refresh()                 -> re-download the rules (called on load and whenever the till comes back online)
 *   LiquorTill.isAlcohol(productId)      -> true / false / null (null = rules never downloaded on this device)
 */
(function (window) {
  const esc = (v) => window.UI.escapeHtml(v == null ? '' : v);
  const active = () => !!(window.AppShell && window.AppShell.hasFeature && window.AppShell.hasFeature('liquorCompliance', 'ageVerification', 'emptiesTracking'));
  const AGE = ['AGE_CHECK_REQUIRED', 'ID_REQUIRED', 'INVALID_DOB'];
  const OVERRIDE = ['OUTSIDE_HOURS', 'DRY_DAY', 'LICENCE_EXPIRED', 'LIMIT_PER_SALE'];
  const KEY = 'pos.liquorTill.v1';
  const isOffline = () => !!(window.Connectivity && window.Connectivity.isOnline && !window.Connectivity.isOnline());
  let ctx = null; let alcoholSet = null; let lastAge = null;

  /* ------------------------------ cached rules ------------------------------ */
  function uid() { try { const u = window.AppShell.getUser(); return String((u && (u._id || u.id)) || ''); } catch { return ''; } }
  function load() {
    if (ctx) return ctx;
    try { const raw = JSON.parse(localStorage.getItem(KEY) || 'null'); if (raw && raw.uid === uid()) { ctx = raw.data; } } catch { /* ignore */ }
    if (ctx) alcoholSet = new Set((ctx.alcoholProducts || []).map((p) => String(p.productId)));
    return ctx;
  }
  async function refresh() {
    if (!active() || isOffline()) return load();
    try {
      const { data } = await window.Api.get('/liquor/till/context');
      ctx = data; alcoholSet = new Set((data.alcoholProducts || []).map((p) => String(p.productId)));
      try { localStorage.setItem(KEY, JSON.stringify({ uid: uid(), data })); } catch { /* storage full or blocked */ }
    } catch { /* keep the cached copy */ }
    return ctx;
  }
  const isAlcohol = (id) => { load(); return alcoholSet ? alcoholSet.has(String(id)) : null; };
  const cartHasAlcohol = (cart) => { load(); if (!alcoholSet) return true; /* never downloaded: ask, to be safe */ return cart.some((i) => alcoholSet.has(String(i.product && i.product._id))); };
  /** { category, abv, volumeMl } for an alcohol product (cached; works for cashiers and offline), or null. */
  const info = (id) => { load(); return ctx ? ((ctx.alcoholProducts || []).find((p) => String(p.productId) === String(id)) || null) : null; };
  const cartSig = (cart) => cart.map((i) => `${i.product && i.product._id}:${i.quantity}`).sort().join('|');

  /* ------------------------------ prompts ------------------------------ */
  function modal({ title, bodyHtml, okLabel, extraButtons = '', maxWidth = '460px' }, collect) {
    return new Promise((resolve) => {
      let settled = false;
      const done = (v) => { if (!settled) { settled = true; try { window.UI.closeModal(); } catch { /* closed */ } resolve(v); } };
      const m = window.UI.openModal({ title, maxWidth, bodyHtml: `<form id="lt-f">${bodyHtml}</form>`, footerHtml: `<button class="btn btn-secondary" data-x="cancel">Cancel</button>${extraButtons}<button class="btn btn-primary" data-x="ok">${esc(okLabel)}</button>` });
      const f = m.querySelector('#lt-f');
      m.querySelector('[data-x="cancel"]').addEventListener('click', () => done(null));
      m.querySelector('[data-x="ok"]').addEventListener('click', () => { if (!f.reportValidity()) return; const v = collect(f, m); if (v !== undefined) done(v); });
      m.querySelector('[data-x="refuse"]')?.addEventListener('click', () => done({ refuse: true }));
      f.addEventListener('submit', (e) => { e.preventDefault(); m.querySelector('[data-x="ok"]').click(); });
      const obs = new MutationObserver(() => { if (!document.body.contains(m)) { obs.disconnect(); done(null); } }); obs.observe(document.body, { childList: true, subtree: true });
    });
  }

  const ageOf = (dob) => { const d = new Date(dob); if (Number.isNaN(d.getTime())) return null; const n = new Date(); let a = n.getFullYear() - d.getFullYear(); const m = n.getMonth() - d.getMonth(); if (m < 0 || (m === 0 && n.getDate() < d.getDate())) a -= 1; return a; };

  /** The age-check dialog. `offline` only changes the wording and what is returned (no date of birth ever leaves the till offline). */
  async function askAge(code, { offline = false } = {}) {
    let mode = (load() && ctx.ageMode) || null;
    const minAge = (ctx && ctx.minAge) || 18;
    if (!offline && (code === 'ID_REQUIRED' || code === 'INVALID_DOB')) mode = 'ID_REQUIRED';
    if (mode === null && !offline) { try { mode = (await window.Api.get('/liquor/status')).data.ageMode || 'CONFIRM'; } catch { mode = 'CONFIRM'; } }
    mode = mode || 'CONFIRM';
    const needId = mode === 'ID_REQUIRED';
    return modal({ title: 'Age check', okLabel: 'Buyer is of legal age', extraButtons: '<button type="button" class="btn btn-danger" data-x="refuse">Under age: refuse sale</button>',
      bodyHtml: `<div class="lq-gate"><div class="lq-badge18">${esc(minAge)}+</div><h3>Check the buyer</h3>
        <p class="text-sm text-secondary">Alcohol is in this cart. ${needId ? 'Check the buyer\'s ID and enter the details.' : 'Confirm you have checked the buyer is old enough.'} The date of birth and full ID number are never stored.</p></div>
        ${offline ? '<div class="lq-offline-note"><span>⚠</span><span>No internet. This check is saved with the sale and logged when the till reconnects.</span></div>' : ''}
        <div class="field"><label>ID type</label><select class="select" name="idType"><option value="">Not entered</option><option value="NATIONAL_ID">National ID</option><option value="PASSPORT">Passport</option><option value="DRIVING_LICENCE">Driving licence</option><option value="MILITARY_ID">Military ID</option><option value="OTHER">Other</option></select></div>
        <div class="field"><label>Last 4 characters of the ID</label><input class="input" name="idLast4" maxlength="12" /></div>
        <div class="field"><label>or date of birth</label><input class="input" type="date" name="dob" max="${new Date().toISOString().slice(0, 10)}" /></div>
        <label class="checkbox-row"><input type="checkbox" name="ok" /> <span class="text-sm">I have checked and the buyer is of legal age (${esc(minAge)}+)</span></label>` },
    (f) => {
      const idType = f.idType.value; const last4 = f.idLast4.value.trim(); const dob = f.dob.value;
      if (needId && !dob && !(idType && last4.length >= 2)) { window.UI.toast.error('Enter the ID type and its last digits, or the date of birth'); return undefined; }
      if (!f.ok.checked && !dob) { window.UI.toast.error('Tick the box to confirm the check'); return undefined; }
      if (offline) {
        const years = dob ? ageOf(dob) : null;
        if (dob && (years === null || years < 0)) { window.UI.toast.error('That date of birth is not valid'); return undefined; }
        if (years !== null && years < minAge) { window.UI.toast.error(`The buyer is under ${minAge}. Alcohol cannot be sold.`); return { refuse: true }; }
        return { ageCheck: { confirmedOfAge: true, method: dob ? 'DOB' : (idType && last4 ? 'ID' : 'CONFIRMED'), ...(years !== null ? { ageYears: years } : {}), ...(idType ? { idType } : {}), ...(last4 ? { idLast4: last4.slice(-4) } : {}) } };
      }
      return { ageCheck: { confirmedOfAge: true, ...(idType ? { idType } : {}), ...(last4 ? { idLast4: last4 } : {}), ...(dob ? { dob: new Date(dob).toISOString() } : {}) } };
    });
  }

  const askReason = (message) => modal({ title: 'Manager approval', okLabel: 'Sell anyway', bodyHtml: `<p class="text-sm">${esc(message)}</p><div class="field"><label>Reason (logged) *</label><input class="input" name="reason" minlength="5" maxlength="200" required /></div>` }, (f) => ({ overrideReason: f.reason.value.trim() }));

  /** Cashiers do not hold liquor.empties, so the list comes from the till endpoint (any cashier) and is cached for offline. */
  async function containers() {
    if (!isOffline()) await refresh(); else load();
    return ((ctx && ctx.containers) || []);
  }
  async function askEmpties(message) {
    const types = await containers();
    if (!types.length) return null;
    return modal({ title: 'Empties returned', okLabel: 'Continue', bodyHtml: `<p class="text-sm">${esc(message)}</p><p class="text-sm text-secondary">How many empties is the customer handing back with this sale?</p>${types.map((c) => `<div class="field"><label>${esc(c.name)}</label><input class="input" type="number" min="0" value="0" data-c="${esc(c._id)}" /></div>`).join('')}` },
      (f, m) => ({ emptiesReturned: [...m.querySelectorAll('[data-c]')].map((i) => ({ containerTypeId: i.dataset.c, quantity: Math.floor(Number(i.value) || 0) })).filter((x) => x.quantity > 0) }));
  }

  /* ------------------------------ online ------------------------------ */
  async function post(path, payload, opts) {
    let body = { ...payload };
    for (let i = 0; i < 4; i += 1) {
      try { return await window.Api.post(path, body, opts); } catch (err) {
        const code = err && err.code; let extra = null;
        if (AGE.includes(code)) extra = await askAge(code);
        else if (OVERRIDE.includes(code) && window.Permissions.can(window.AppShell.getUser(), 'liquor.override')) extra = await askReason(err.message);
        else if (code === 'EMPTIES_DEPOSIT_MISMATCH') extra = await askEmpties(err.message);
        else throw err;
        if (!extra) throw err;
        if (extra.refuse) { body = { ...body, ageCheck: { looksUnderAge: true } }; continue; }
        body = { ...body, ...extra };
        if (extra.ageCheck && extra.ageCheck.confirmedOfAge) lastAge = { at: Date.now(), ageCheck: { confirmedOfAge: true, ...(extra.ageCheck.idType ? { idType: extra.ageCheck.idType } : {}), ...(extra.ageCheck.idLast4 ? { idLast4: String(extra.ageCheck.idLast4).slice(-4) } : {}), method: extra.ageCheck.dob ? 'DOB' : extra.ageCheck.idType ? 'ID' : 'CONFIRMED' } };
      }
    }
    return window.Api.post(path, body, opts);
  }

  /* ------------------------------ offline ------------------------------ */
  /**
   * Call before Offline.sales.create. Resolves to { ageCheck } when alcohol is in the cart and the buyer was checked,
   * {} when there is no alcohol, or null when the cashier cancelled or refused (nothing must be saved then).
   */
  async function offlinePrepare(cart) {
    if (!active() || !cartHasAlcohol(cart)) return {};
    if (lastAge && Date.now() - lastAge.at < 120000) { const a = lastAge.ageCheck; lastAge = null; return { ageCheck: a }; } // check already done a moment ago, before the connection dropped
    const r = await askAge(null, { offline: true });
    if (!r) return null;
    if (r.refuse) { window.UI.toast.error('Sale refused: the buyer is under age or looks under age.'); return null; }
    return { ageCheck: r.ageCheck };
  }

  document.addEventListener('DOMContentLoaded', () => { setTimeout(() => { if (active()) refresh(); }, 1500); });
  window.addEventListener('online', () => { if (active()) refresh(); });
  window.addEventListener('connectivitychange', (e) => { if (e.detail && e.detail.online && active()) refresh(); });
  window.addEventListener('businessprofilechange', () => { if (active()) refresh(); });

  window.LiquorTill = { active, post, offlinePrepare, refresh, isAlcohol, cartHasAlcohol, containers, cartSig, info, context: () => load() };
})(window);
