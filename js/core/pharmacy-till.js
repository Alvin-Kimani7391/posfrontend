/**
 * pharmacy-till.js - the pharmacy part of the Sales till. Loaded on sales.html; does nothing unless the business has the
 * Dispensing feature switched on, so ordinary shops are unaffected.
 *
 * The SERVER is the authority (backend pharmacy-guard.service.js checks every sale). This file only (1) shows the cashier what
 * a medicine needs, (2) collects the extra details the server will ask for (prescription, controlled-drug countersignature,
 * Poisons Book entry) BEFORE payment, so a sale is never taken and then refused, and (3) keeps medicines offline-safe.
 *
 *   PharmacyTill.active()               pharmacy mode on?
 *   PharmacyTill.ensure(products)       load medicine details for these products (cached, offline copy as fallback)
 *   PharmacyTill.tag(productId, ph)     small label for a cart line (Rx / Controlled / Poison / Recalled ...)
 *   PharmacyTill.paintBar(el, ph, cart) the strip above the cart
 *   PharmacyTill.prepare(cart, cb)      collect what the cart needs, then cb(result) (never called if the cashier cancels)
 *   PharmacyTill.payload(ph)            extra fields for POST /sales
 *   PharmacyTill.sig(cart)              changes whenever the cart's products / quantities change
 *   PharmacyTill.offlineIssue(cart)     text when this cart may not be sold offline, else ''
 *   PharmacyTill.afterSale(data)        offers the medicine label after a dispensing
 */
(function (window) {
  'use strict';
  const esc = (v) => window.UI.escapeHtml(v == null ? '' : String(v));
  const P = () => window.Pharmacy;
  const can = (p) => window.Permissions.can(window.AppShell.getUser(), p);
  const active = () => !!(window.AppShell && window.AppShell.hasFeature && window.AppShell.hasFeature('pharmacyDispensing'));

  const cache = new Map(); // productId -> { med: object|null }   (null = not a medicine)
  const pending = new Map();
  const STRICTEST = { code: 'UNKNOWN', requiresPrescription: true, dispenserOnly: true, restricted: true };

  const idOf = (p) => String(p._id || p.id);
  const sig = (cart) => (cart || []).map((i) => `${idOf(i.product)}:${i.quantity}`).sort().join('|');

  async function fetchOne(id) {
    try {
      const { data } = await window.Api.get(`/pharmacy/medicines/${id}`);
      cache.set(id, { med: data.medicine });
    } catch (err) {
      if (err.status === 404) { cache.set(id, { med: null }); return; }
      // offline / no access: fall back to the till's own downloaded copy
      const local = window.Offline && window.Offline.catalog && window.Offline.catalog.medicine ? window.Offline.catalog.medicine(id) : null;
      if (local) cache.set(id, { med: { productId: id, classification: local.classification, status: local.status, _local: local } });
    }
  }

  function ensure(products) {
    if (!active()) return Promise.resolve();
    const jobs = [];
    (products || []).forEach((p) => {
      const id = idOf(p);
      if (cache.has(id)) return;
      if (!pending.has(id)) pending.set(id, fetchOne(id).finally(() => pending.delete(id)));
      jobs.push(pending.get(id));
    });
    // the class rules (who needs a prescription / is controlled) come from the pharmacy settings: load them with the medicines,
    // otherwise every non-OTC medicine would be shown with the strictest label until payment.
    return Promise.all([P().classes(), ...jobs]);
  }
  const ensureCart = (cart) => ensure((cart || []).map((i) => i.product));

  /** Rules of a medicine's class (from the pharmacy settings the kit loaded), or the strictest when the class is unknown. */
  function flagsOf(med) {
    if (!med) return { none: true };
    if (med._local) { const l = med._local; return { code: med.classification, requiresPrescription: !!l.requiresPrescription, dispenserOnly: !!l.dispenserOnly, restricted: !!l.restricted, poisonsBook: !!l.poisonsBook }; }
    const c = P().classOf(med.classification);
    return c || (String(med.classification).toUpperCase() === 'OTC' ? { code: 'OTC' } : STRICTEST);
  }

  function needs(cart) {
    const out = { rx: [], restricted: [], poison: [], blocked: [], dispenser: false, any: false };
    (cart || []).forEach((i) => {
      const e = cache.get(idOf(i.product));
      if (!e || !e.med) return;
      const m = e.med; const f = flagsOf(m);
      if (['recalled', 'quarantined'].includes(m.status)) out.blocked.push({ item: i, reason: m.status });
      if (f.requiresPrescription) out.rx.push(i);
      if (f.restricted) out.restricted.push(i);
      if (f.poisonsBook) out.poison.push(i);
      if (f.requiresPrescription || f.dispenserOnly || f.restricted) out.dispenser = true;
    });
    out.any = !!(out.rx.length || out.restricted.length || out.poison.length || out.dispenser);
    return out;
  }

  function tag(productId, ph) {
    const e = cache.get(String(productId));
    if (!e || !e.med) return '';
    const m = e.med; const f = flagsOf(m);
    if (['recalled', 'quarantined'].includes(m.status)) return `<span class="ph-line-tag rx">${esc(m.status)} · cannot sell</span>`;
    const onRx = ph && ph.rx && (ph.rx.items || []).some((x) => String(x.productId) === String(productId));
    if (f.restricted) return `<span class="ph-line-tag rx">Controlled</span>${onRx ? '<span class="ph-line-tag ok">on Rx</span>' : ''}`;
    if (f.requiresPrescription) return `<span class="ph-line-tag rx">Rx</span>${onRx ? '<span class="ph-line-tag ok">on Rx</span>' : ''}`;
    if (f.poisonsBook) return '<span class="ph-line-tag">Poison</span>';
    if (f.dispenserOnly) return '<span class="ph-line-tag">Pharmacist</span>';
    return '';
  }

  function paintBar(el, ph, cart) {
    if (!el) return;
    if (!active()) { el.innerHTML = ''; el.style.display = 'none'; return; }
    el.style.display = '';
    // With the pharmacy desk (Over the counter | Dispense prescription) on screen, the desk panel already shows the attached
    // prescription and the attach button; this bar then only carries warnings.
    const deskOn = !!(window.PharmacyDesk && window.PharmacyDesk.mode && window.PharmacyDesk.mode());
    const n = needs(cart);
    const chips = [];
    n.blocked.forEach((b) => chips.push(`<span class="ph-chip bad">${esc(b.item.product.name)} is ${esc(b.reason)}</span>`));
    if (ph && ph.rx) { if (!deskOn) chips.push(`<span class="ph-chip ok">${esc(ph.rx.number)} attached</span>`); }
    else if (n.rx.length) chips.push('<span class="ph-chip warn">Prescription needed</span>');
    if (n.restricted.length) chips.push('<span class="ph-chip bad">Controlled drug: pharmacist + countersignature</span>');
    if (n.poison.length && !(ph && ph.rx)) chips.push('<span class="ph-chip warn">Poisons Book entry</span>');
    if (!chips.length && n.dispenser) chips.push('<span class="ph-chip">Dispenser only</span>');
    if (deskOn && !chips.length) { el.innerHTML = ''; el.style.display = 'none'; return; }
    el.innerHTML = `<span class="ph-till-title">${window.Icons.get('pill')} Pharmacy</span>${chips.join('') || '<span class="text-muted">Ordinary items. Medicines that need a prescription are flagged here.</span>'}<span class="ph-spacer"></span>${!deskOn && n.rx.length && P().can('prescriptions.view') ? '<button type="button" class="btn btn-secondary btn-sm" id="ph-attach">Attach prescription</button>' : ''}`;
    el.querySelector('#ph-attach')?.addEventListener('click', () => el.dispatchEvent(new CustomEvent('ph-attach', { bubbles: true })));
  }

  /* ------------------------------ the prompts ------------------------------ */
  function modal({ title, intro, fields, submitLabel, onSubmit, maxWidth = '520px' }) {
    window.ModuleKit.formModal({ title, intro, fields, submitLabel, maxWidth, onSubmit });
  }

  /** Quick local check so the cashier finds out now, not after payment. The server re-checks everything. '' = fine. */
  function rxProblem(rx, cart) {
    const want = new Map();
    cart.forEach((i) => want.set(idOf(i.product), (want.get(idOf(i.product)) || 0) + Number(i.quantity)));
    for (const i of needs(cart).rx) {
      const pi = (rx.items || []).find((x) => String(x.productId) === idOf(i.product));
      if (!pi) return `${i.product.name} is not on ${rx.number}`;
      const left = Math.round((pi.prescribedQty - (pi.dispensedQty || 0)) * 1000) / 1000;
      if (want.get(idOf(i.product)) > left) return `${i.product.name}: only ${P().qty(left)} left on ${rx.number}`;
    }
    return '';
  }

  function chooseRx(cart, done) {
    P().prescriptionPicker({
      onSelect: (rx) => {
        const problem = rxProblem(rx, cart);
        if (problem) { window.UI.toast.error(problem); return; }
        done(rx);
      },
    });
  }

  function askCountersign(done) {
    modal({
      title: 'Controlled drug: countersignature',
      intro: 'The patient or their representative must countersign when a controlled drug is dispensed. Record their name, then have them sign.',
      submitLabel: 'Countersigned',
      fields: [
        { name: 'name', label: 'Name of the person signing', required: true },
        { name: 'relationship', label: 'Relationship to the patient', placeholder: 'Self, parent, caregiver' },
        { name: 'signed', type: 'checkbox', label: 'They have signed' },
      ],
      onSubmit: async (d) => {
        if (!d.signed) throw new Error('The countersignature is required');
        if (String(d.name).trim().length < 2) throw new Error('Enter their name');
        done({ name: d.name, relationship: d.relationship, signed: true });
      },
    });
  }

  function askPoisons(done) {
    modal({
      title: 'Poisons Book entry',
      intro: 'This is a Part I poison sold without a prescription. The law requires the purchaser’s details to be written in the Poisons Book before it is sold.',
      submitLabel: 'Record & continue', maxWidth: '560px',
      fields: [
        { name: 'purchaserName', label: 'Purchaser’s full name', required: true },
        { name: 'purchaserAddress', label: 'Purchaser’s address', required: true },
        { name: 'idNumber', label: 'ID number' },
        { name: 'purpose', label: 'What it will be used for', required: true },
        { name: 'signed', type: 'checkbox', label: 'The purchaser has signed the Poisons Book' },
      ],
      onSubmit: async (d) => {
        if (!d.signed) throw new Error('The purchaser must sign');
        done({ purchaserName: d.purchaserName, purchaserAddress: d.purchaserAddress, idNumber: d.idNumber, purpose: d.purpose, signed: true });
      },
    });
  }

  /** Collect everything this cart needs. cb(result) runs only when it is all in hand. */
  async function prepare(cart, cb, existing) {
    await ensureCart(cart);
    const settings = await P().classes();
    const n = needs(cart);
    const result = { sig: sig(cart), rx: existing && existing.rx && !rxProblem(existing.rx, cart) ? existing.rx : null };
    if (n.blocked.length) { window.UI.toast.error(`${n.blocked[0].item.product.name} is ${n.blocked[0].reason} and cannot be sold`); return; }
    if (!n.any) { cb(result); return; }
    if (n.dispenser && !can('pharmacy.dispense')) { window.UI.toast.error('Only an authorised dispenser can sell these medicines. Ask the pharmacist.'); return; }
    if (n.restricted.length && !can('pharmacy.restricted')) { window.UI.toast.error('You are not authorised to sell controlled medicines.'); return; }

    const stepPoisons = () => {
      if (n.poison.length && !result.rx) askPoisons((pb) => { result.poisonsBook = pb; cb(result); });
      else cb(result);
    };
    const stepCounter = () => {
      if (n.restricted.length && (settings.rules || {}).requireCountersign !== false) askCountersign((cs) => { result.countersign = cs; stepPoisons(); });
      else stepPoisons();
    };
    if (n.rx.length && !result.rx) chooseRx(cart, (rx) => { result.rx = rx; stepCounter(); });
    else stepCounter();
  }

  const payload = (ph) => {
    if (!ph) return {};
    const o = {};
    if (ph.rx) o.prescriptionId = ph.rx._id;
    if (ph.countersign) o.countersign = ph.countersign;
    if (ph.poisonsBook) o.poisonsBook = ph.poisonsBook;
    return o;
  };

  function offlineIssue(cart) {
    if (!active()) return '';
    const cat = window.Offline && window.Offline.catalog;
    const pharmacyOn = !!(((window.Offline && window.Offline.context && window.Offline.context.get && window.Offline.context.get()) || {}).business || {}).pharmacy;
    if (!pharmacyOn) return '';
    if (!cat || !cat.medicinesReady || !cat.medicinesReady()) return 'This till has not downloaded the medicine list yet, so it cannot tell which items are medicines. Sell when the till is online.';
    for (const i of cart) {
      const m = cat.medicine(idOf(i.product));
      if (!m) continue;
      if (!m.sellOffline) return `${i.product.name} is a medicine that cannot be sold offline (prescription, pharmacist-only, controlled, recalled, or offline medicine sales are switched off).`;
    }
    return '';
  }

  async function afterSale(data) {
    const id = data && data.sale && data.sale.dispensingId;
    if (!id || !can('pharmacy.dispense')) return;
    const ok = await window.UI.confirmDialog({ title: 'Print the medicine label?', message: 'The dispensing is recorded. Labels carry the directions, batch and expiry.', confirmText: 'Print label', cancelText: 'Skip' });
    if (!ok) return;
    try { const { data: res } = await window.Api.post(`/pharmacy/dispensings/${id}/label`, {}); P().printLabels(res); }
    catch (e) { window.UI.toast.error(`Label not printed: ${e.message}. You can print it from Prescriptions → Dispensing register.`); }
  }

  window.PharmacyTill = { active, medicineOf: (id) => { const e = cache.get(String(id)); return e && e.med ? e.med : null; }, ensure, ensureCart, needs, tag, paintBar, prepare, payload, sig, offlineIssue, afterSale, forget: () => cache.clear() };
})(window);
