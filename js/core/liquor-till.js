/**
 * liquor-till.js - wines & spirits at the till.
 * The server guards every alcohol sale (age check, trading hours / dry day / licence, per-sale limit, empties deposit).
 * Instead of guessing which cart lines are alcohol, the till posts the sale; if the server asks for something,
 * this asks the cashier (age check / manager reason / empties returned) and retries the same sale.
 *   LiquorTill.active()                      -> true for wines & spirits businesses
 *   LiquorTill.post(path, payload, opts)     -> like Api.post, with the prompts above
 */
(function (window) {
  const esc = (v) => window.UI.escapeHtml(v == null ? '' : v);
  const active = () => !!(window.AppShell && window.AppShell.hasFeature && window.AppShell.hasFeature('liquorCompliance', 'ageVerification', 'emptiesTracking'));
  const AGE = ['AGE_CHECK_REQUIRED', 'ID_REQUIRED', 'INVALID_DOB'];
  const OVERRIDE = ['OUTSIDE_HOURS', 'DRY_DAY', 'LICENCE_EXPIRED', 'LIMIT_PER_SALE'];
  let ageMode = null;

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

  async function askAge(code) {
    if (ageMode === null) { try { ageMode = (await window.Api.get('/liquor/status')).data.ageMode || 'CONFIRM'; } catch { ageMode = 'CONFIRM'; } }
    const needId = ageMode === 'ID_REQUIRED' || code === 'ID_REQUIRED' || code === 'INVALID_DOB';
    return modal({ title: 'Age check', okLabel: 'Buyer is of legal age', extraButtons: '<button type="button" class="btn btn-danger" data-x="refuse">Looks under age: refuse</button>',
      bodyHtml: `<p class="text-sm text-secondary">Alcohol is in this cart. ${needId ? 'Check the buyer\'s ID and enter the details.' : 'Confirm you have checked the buyer is old enough.'} The date of birth and full ID number are never stored.</p>
        <div class="field"><label>ID type</label><select class="select" name="idType" ${needId ? '' : ''}><option value="">Not entered</option><option value="NATIONAL_ID">National ID</option><option value="PASSPORT">Passport</option><option value="DRIVING_LICENCE">Driving licence</option><option value="MILITARY_ID">Military ID</option><option value="OTHER">Other</option></select></div>
        <div class="field"><label>Last 4 characters of the ID</label><input class="input" name="idLast4" maxlength="12" /></div>
        <div class="field"><label>or date of birth</label><input class="input" type="date" name="dob" /></div>
        <label class="checkbox-row"><input type="checkbox" name="ok" ${needId ? '' : 'required'} /> <span class="text-sm">I have checked and the buyer is of legal age</span></label>` },
    (f) => {
      const idType = f.idType.value, last4 = f.idLast4.value.trim(), dob = f.dob.value;
      if (needId && !dob && !(idType && last4.length >= 2)) { window.UI.toast.error('Enter the ID type and its last digits, or the date of birth'); return undefined; }
      if (!f.ok.checked && !dob) { window.UI.toast.error('Tick the box to confirm the check'); return undefined; }
      return { ageCheck: { confirmedOfAge: true, ...(idType ? { idType } : {}), ...(last4 ? { idLast4: last4 } : {}), ...(dob ? { dob: new Date(dob).toISOString() } : {}) } };
    });
  }

  const askReason = (message) => modal({ title: 'Manager approval', okLabel: 'Sell anyway', bodyHtml: `<p class="text-sm">${esc(message)}</p><div class="field"><label>Reason (logged) *</label><input class="input" name="reason" minlength="5" maxlength="200" required /></div>` }, (f) => ({ overrideReason: f.reason.value.trim() }));

  async function askEmpties(message) {
    let types = []; try { types = (await window.Api.get('/liquor/containers')).data.containers.filter((c) => c.active !== false); } catch { /* no access */ }
    if (!types.length) return null;
    return modal({ title: 'Empties returned', okLabel: 'Continue', bodyHtml: `<p class="text-sm">${esc(message)}</p><p class="text-sm text-secondary">How many empties is the customer handing back with this sale?</p>${types.map((c) => `<div class="field"><label>${esc(c.name)}</label><input class="input" type="number" min="0" value="0" data-c="${esc(c._id)}" /></div>`).join('')}` },
      (f, m) => ({ emptiesReturned: [...m.querySelectorAll('[data-c]')].map((i) => ({ containerTypeId: i.dataset.c, quantity: Math.floor(Number(i.value) || 0) })).filter((x) => x.quantity > 0) }));
  }

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
      }
    }
    return window.Api.post(path, body, opts);
  }

  window.LiquorTill = { active, post };
})(window);