/**
 * pharmacy-desk.js - the two ways a pharmacy sells, on the one Sales till (sales.html):
 *
 *   ?desk=otc   OVER THE COUNTER  a normal sale. Anything that needs a prescription is refused here and the cashier is
 *                                 offered a switch to Dispense prescription.
 *   ?desk=rx    DISPENSE A PRESCRIPTION  the same till with the prescription workflow on top: choose the prescription, see
 *                                 the patient + allergies + prescriber, the prescribed medicines with directions and what is
 *                                 left, load them into the cart in one tap, and take payment only when a prescription is
 *                                 attached. The server still re-checks everything (backend pharmacy-guard.service.js).
 *
 * sales.js owns the cart; this file owns the pharmacy panel and the mode switch. sales.js hands it a small `host`:
 *   PharmacyDesk.bind({ state, addLine(product, qty), removeProducts(ids), clear(), render() })
 *
 *   PharmacyDesk.active()          pharmacy till on?
 *   PharmacyDesk.mode()            'rx' | 'otc' | null (null when the business is not a pharmacy)
 *   PharmacyDesk.segHtml()         the "Over the counter | Dispense prescription" switch for the till's top bar
 *   PharmacyDesk.paint()           repaint the panel (called by sales.js whenever the cart changes)
 *   PharmacyDesk.selectRx(id)      attach a prescription and load its remaining items
 *   PharmacyDesk.guardOtc()        after an item is added in OTC mode: refuse prescription-only medicines
 *   PharmacyDesk.beforePayment()   false (with a message) when a prescription sale has no prescription / no Rx item yet
 */
(function (window) {
  'use strict';
  const esc = (v) => window.UI.escapeHtml(v == null ? '' : String(v));
  const P = () => window.Pharmacy;
  const PT = () => window.PharmacyTill;
  const can = (p) => window.Permissions.can(window.AppShell.getUser(), p);
  const active = () => !!(PT() && PT().active());
  const KEY = 'pos.pharmacyDesk';

  let host = null;
  let current = null;                 // 'rx' | 'otc'
  const desk = { patient: null, loading: false, error: '', collapsed: false };
  let guarding = false;

  function initialMode() {
    let m = null;
    try { m = new URLSearchParams(location.search).get('desk'); } catch { /* ignore */ }
    if (m !== 'rx' && m !== 'otc') { try { m = sessionStorage.getItem(KEY); } catch { m = null; } }
    return m === 'rx' ? 'rx' : 'otc';
  }
  function mode() { if (!active()) return null; if (!current) current = initialMode(); return current; }

  const left = (i) => Math.max(0, Math.round(((i.prescribedQty || 0) - (i.dispensedQty || 0)) * 1000) / 1000);
  const inCart = (productId) => ((host && host.state.cart) || []).filter((l) => String(l.product._id) === String(productId)).reduce((a, l) => a + Number(l.quantity || 0), 0);
  const rx = () => (host && host.state.pharmacy && host.state.pharmacy.rx) || null;
  const age = (d) => { if (!d) return ''; const y = Math.floor((Date.now() - new Date(d).getTime()) / 31557600000); return y >= 0 && y < 150 ? `${y} y` : ''; };

  /* ------------------------------------------------------------------ switch */
  function segHtml() {
    if (!active()) return '';
    const m = mode();
    return `<div class="ph-seg" id="ph-seg" data-mode="${m}" role="tablist" aria-label="Pharmacy sale type">
      <button type="button" data-desk="otc" role="tab" class="${m === 'otc' ? 'active' : ''}">${window.Icons.get('bag')} Over the counter</button>
      <button type="button" data-desk="rx" role="tab" class="${m === 'rx' ? 'active' : ''}">${window.Icons.get('pill')} Dispense prescription</button></div>`;
  }

  async function switchTo(next, { silent } = {}) {
    if (!active() || next === current) return;
    if (current === 'rx' && next === 'otc' && host.state.cart.length && !silent) {
      const ok = await window.UI.confirmDialog({ title: 'Leave the prescription?', message: 'The cart and the attached prescription are cleared. Nothing has been dispensed yet.', confirmText: 'Clear and switch', danger: true });
      if (!ok) return;
    }
    if (current === 'rx' && next === 'otc') { host.clear(); desk.patient = null; }
    current = next;
    try { sessionStorage.setItem(KEY, next); } catch { /* ignore */ }
    try { const u = new URL(location.href); u.searchParams.set('desk', next); u.searchParams.delete('rx'); history.replaceState(null, '', u); } catch { /* ignore */ }
    const seg = document.getElementById('ph-seg');
    if (seg) { seg.dataset.mode = next; seg.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.desk === next)); }
    paintTab();
    host.render();
    markNav();
    if (next === 'rx' && !rx()) choose();
  }

  function bindSeg(root) {
    (root || document).querySelectorAll('#ph-seg button').forEach((b) => b.addEventListener('click', () => switchTo(b.dataset.desk)));
  }
  function paintTab() { /* the till's own tabs stay "New sale | Sales history"; the switch next to them says which kind of sale */ }
  /** keep the sidebar highlight in step with the mode (the two pharmacy till links share one page). */
  function markNav() {
    document.querySelectorAll('.sidebar-link[data-nav-key="dispense-rx"], .sidebar-link[data-nav-key="dispense-otc"]').forEach((a) => {
      a.classList.toggle('active', a.dataset.navKey === (mode() === 'rx' ? 'dispense-rx' : 'dispense-otc'));
    });
  }

  /* --------------------------------------------------------- prescription flow */
  function choose({ patient } = {}) {
    if (document.querySelector('.ph-picker-list')) return; // a picker is already open
    if (!P().can('prescriptions.view')) { window.UI.toast.error('You do not have access to prescriptions.'); return; }
    P().prescriptionPicker({ patientId: patient && patient._id, onSelect: (r) => selectRx(r._id) });
  }
  function byPatient() {
    if (!P().can('patients.view')) { window.UI.toast.error('You do not have access to patient records.'); return; }
    P().patientPicker({ allowNew: false, onSelect: (p) => choose({ patient: p }) });
  }

  async function selectRx(id) {
    if (!active() || !id) return;
    if (mode() !== 'rx') { current = 'rx'; try { sessionStorage.setItem(KEY, 'rx'); } catch { /* ignore */ } const seg = document.getElementById('ph-seg'); if (seg) { seg.dataset.mode = 'rx'; seg.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.desk === 'rx')); } paintTab(); markNav(); }
    desk.loading = true; desk.error = ''; paint();
    try {
      const { data } = await window.Api.get(`/pharmacy/prescriptions/${id}`);
      const r = data.prescription;
      if (!['VALIDATED', 'PARTIALLY_DISPENSED'].includes(r.status)) throw new Error(r.status === 'RECEIVED' ? `${r.number} has not been reviewed yet. A pharmacist must validate it first (Prescriptions → Awaiting review).` : `${r.number} is ${P().label(r.status).toLowerCase()} and cannot be dispensed.`);
      if (new Date(r.validUntil) < new Date()) throw new Error(`${r.number} expired on ${P().date(r.validUntil)}.`);
      if (!(r.items || []).some((i) => left(i) > 0)) throw new Error(`Everything on ${r.number} has already been dispensed.`);
      desk.patient = null; desk.collapsed = false;
      if (P().can('patients.view')) { try { const { data: pd } = await window.Api.get(`/pharmacy/patients/${r.patientId}`); desk.patient = pd.patient; } catch { /* no access */ } }
      host.state.pharmacy = { rx: r };               // same shape PharmacyTill.prepare() / payload() already use
      desk.loading = false;
      paint();
      await loadItems();                              // put the remaining medicines in the cart
    } catch (e) {
      desk.loading = false; desk.error = e.message; paint();
      window.UI.toast.error(e.message);
    }
  }

  async function addItem(item, qty) {
    try {
      const { data } = await window.Api.get(`/products/${item.productId}`);
      const product = data.product;
      if (!product || product.status === 'archived') throw new Error(`${item.nameSnapshot} is no longer in your product list.`);
      if ((product.variants || []).length) throw new Error(`${item.nameSnapshot} has variants. Sell it from the normal search so you can pick one.`);
      host.addLine(product, qty);
      return true;
    } catch (e) { window.UI.toast.error(e.message); return false; }
  }

  /** Put every medicine that still has quantity left on the prescription into the cart (skips ones already there). */
  async function loadItems() {
    const r = rx(); if (!r) return;
    const todo = (r.items || []).filter((i) => left(i) > 0 && inCart(i.productId) === 0);
    for (const i of todo) { // sequential so the cart order matches the prescription
      // eslint-disable-next-line no-await-in-loop
      await addItem(i, left(i));
    }
    if (todo.length) window.UI.toast.success(`${todo.length} medicine${todo.length === 1 ? '' : 's'} loaded from ${r.number}. Check the quantities, then take payment.`);
  }

  function clearRx() {
    desk.patient = null; desk.error = '';
    host.clear();                                     // empties the cart and the attached prescription
  }

  /* ---------------------------------------------------------------- the guards */
  async function guardOtc() {
    if (!active() || mode() !== 'otc' || guarding || !host) return;
    const n = PT().needs(host.state.cart);
    const bad = [...new Set([...n.rx, ...n.restricted])];
    if (!bad.length) return;
    guarding = true;
    const names = bad.map((i) => i.product.name).join(', ');
    const ok = await window.UI.confirmDialog({ title: 'Prescription needed', message: `${names} can only be dispensed against a validated prescription, so it cannot be sold over the counter. Switch to "Dispense prescription"?`, confirmText: 'Dispense prescription', cancelText: 'Remove from sale' });
    guarding = false;
    if (ok) switchTo('rx', { silent: true }); else host.removeProducts(bad.map((i) => String(i.product._id)));
  }

  function beforePayment() {
    if (!active() || mode() !== 'rx') return true;
    const r = rx();
    if (!r) { window.UI.toast.error('Choose the prescription you are dispensing first.'); choose(); return false; }
    const onRx = host.state.cart.some((l) => (r.items || []).some((i) => String(i.productId) === String(l.product._id)));
    if (!onRx) { window.UI.toast.error(`Add at least one medicine from ${r.number} before taking payment.`); return false; }
    return true;
  }

  /* ------------------------------------------------------------------ the panel */
  function allergyHit(patient, item) {
    const med = PT().medicineOf(item.productId) || {};
    const hay = `${item.nameSnapshot || ''} ${med.genericName || ''} ${med.brandName || ''}`.toLowerCase();
    return ((patient && patient.allergies) || []).filter((a) => a && a.length > 2 && hay.includes(String(a).toLowerCase()));
  }

  function paint() {
    const el = document.getElementById('ph-desk');
    if (!el || !host) return;
    if (!active()) { el.innerHTML = ''; el.style.display = 'none'; return; }
    el.style.display = '';
    const m = mode();
    if (m === 'otc') {
      el.innerHTML = `<div class="ph-desk ph-desk-otc"><span>${window.Icons.get('bag')} <strong>Over-the-counter sale.</strong> Medicines that need a prescription, and controlled drugs, are not sold here.</span><button type="button" class="btn btn-secondary btn-sm" data-d="to-rx">Dispense a prescription</button></div>`;
      el.querySelector('[data-d="to-rx"]').addEventListener('click', () => switchTo('rx'));
      return;
    }
    const r = rx();
    if (desk.loading) { el.innerHTML = '<div class="ph-desk"><span class="text-muted">Loading the prescription…</span></div>'; return; }
    if (!r) {
      el.innerHTML = `<div class="ph-desk ph-desk-empty">
        <div class="ph-desk-step"><span class="ph-step-n">1</span><div><strong>Choose the prescription to dispense</strong><div class="text-xs text-muted">Only prescriptions a pharmacist has validated can be dispensed. The medicines load into the cart for you.</div></div></div>
        ${desk.error ? `<div class="ph-danger-box" style="margin:var(--space-2) 0 0">${esc(desk.error)}</div>` : ''}
        <div class="ph-desk-btns">
          <button type="button" class="btn btn-primary" data-d="find">${window.Icons.get('search')} Find prescription</button>
          <button type="button" class="btn btn-secondary" data-d="patient" data-requires-permission="patients.view">${window.Icons.get('patient')} Find by patient</button>
          <a class="btn btn-secondary" href="prescriptions.html?new=1" data-requires-permission="prescriptions.intake">${window.Icons.get('plus')} Record a new prescription</a>
        </div></div>`;
      el.querySelector('[data-d="find"]').addEventListener('click', () => choose());
      el.querySelector('[data-d="patient"]').addEventListener('click', byPatient);
      window.Permissions.applyPermissionGates(el, window.AppShell.getUser());
      return;
    }
    const pt = desk.patient; const pres = r.prescriber || {};
    const allergies = (pt && pt.allergies) || [];
    const rows = (r.items || []).map((i) => {
      const l = left(i); const c = inCart(i.productId); const hits = allergyHit(pt, i);
      const state = l <= 0 ? '<span class="badge badge-success">Done</span>' : c > 0 ? `<span class="badge ${c > l ? 'badge-danger' : 'badge-info'}">${c > l ? `Cart ${P().qty(c)} > left` : `In cart ${P().qty(c)}`}</span>` : `<button type="button" class="btn btn-secondary btn-sm" data-add="${esc(i.productId)}">Add ${esc(P().qty(l))}</button>`;
      return `<tr class="${l <= 0 ? 'ph-done' : ''}">
        <td><strong>${esc(i.nameSnapshot)}</strong> <span class="text-muted text-xs">${esc(i.strength || '')} ${esc(i.dosageForm || '')}</span>${hits.length ? `<div class="ph-allergy-hit">⚠ Patient is allergic to ${esc(hits.join(', '))}</div>` : ''}</td>
        <td class="text-sm">${esc(i.directions || '— no directions on the prescription —')}</td>
        <td class="ph-num-cell">${esc(P().qty(i.dispensedQty || 0))} / ${esc(P().qty(i.prescribedQty))}<div class="text-xs text-muted">${esc(P().qty(l))} left</div></td>
        <td style="text-align:right">${state}</td></tr>`;
    }).join('');
    el.innerHTML = `<div class="ph-desk ph-desk-rx">
      <div class="ph-desk-head">
        <div class="ph-desk-title"><span class="ph-step-n ok">✓</span> <strong>${esc(r.number)}</strong> ${P().badge(r.status)}
          <span class="text-xs text-muted">written ${esc(P().date(r.prescriptionDate))} · valid until ${esc(P().date(r.validUntil))}${r.maxDispensings ? ` · repeat ${esc(r.maxDispensings)}×` : ''}</span></div>
        <div class="ph-desk-btns"><button type="button" class="btn btn-ghost btn-sm" data-d="fold">${desk.collapsed ? 'Show medicines' : 'Hide medicines'}</button><button type="button" class="btn btn-secondary btn-sm" data-d="reload" title="Put any medicines that are missing back in the cart">Reload medicines</button><button type="button" class="btn btn-secondary btn-sm" data-d="change">Change</button><button type="button" class="btn btn-ghost btn-sm" data-d="clear" style="color:var(--color-danger)">Remove</button></div>
      </div>
      <div class="ph-desk-meta">
        <div><span class="ph-k">Patient</span>${pt ? `<strong>${esc(pt.name)}</strong> <span class="text-muted text-xs">${esc(pt.number || '')}${age(pt.dateOfBirth) ? ` · ${esc(age(pt.dateOfBirth))}` : ''}${pt.sex ? ` · ${esc(pt.sex)}` : ''}${pt.phone ? ` · ${esc(pt.phone)}` : ''}</span>` : '<span class="text-muted">Not visible to your role</span>'}</div>
        <div><span class="ph-k">Prescriber</span><strong>${esc(pres.name || '-')}</strong> <span class="text-muted text-xs">${esc(pres.registrationNumber || '')}${pres.facility ? ` · ${esc(pres.facility)}` : ''}</span></div>
      </div>
      ${allergies.length ? `<div class="ph-warn-box" style="margin:var(--space-2) 0"><strong>Allergies:</strong> ${allergies.map(esc).join(', ')}. Check each medicine below before dispensing.</div>` : (pt ? '<div class="ph-note" style="margin:var(--space-1) 0">No allergies recorded for this patient.</div>' : '')}
      <div class="ph-desk-tablewrap" ${desk.collapsed ? 'hidden' : ''}><table class="table ph-desk-table"><thead><tr><th>Medicine</th><th>Directions</th><th>Dispensed</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
      <div class="ph-note">Anything else the patient wants (over-the-counter items) can be added with the search above. Only medicines on the prescription count against it.</div>
    </div>`;
    el.querySelector('[data-d="change"]').addEventListener('click', () => choose());
    el.querySelector('[data-d="clear"]').addEventListener('click', async () => {
      if (host.state.cart.length && !(await window.UI.confirmDialog({ title: 'Remove this prescription?', message: 'The cart is cleared too.', confirmText: 'Remove', danger: true }))) return;
      clearRx();
    });
    el.querySelector('[data-d="fold"]').addEventListener('click', () => { desk.collapsed = !desk.collapsed; paint(); });
    el.querySelector('[data-d="reload"]').addEventListener('click', () => loadItems());
    el.querySelectorAll('[data-add]').forEach((b) => b.addEventListener('click', async () => {
      const item = (r.items || []).find((x) => String(x.productId) === b.dataset.add); if (!item) return;
      b.disabled = true; await addItem(item, left(item));
    }));
  }

  /** sales.js calls this once the till is on screen. */
  function bind(h) {
    host = h;
    if (!active()) return;
    paintTab(); markNav(); paint();
    const params = new URLSearchParams(location.search);
    const id = params.get('rx');
    if (id) { try { const u = new URL(location.href); u.searchParams.delete('rx'); history.replaceState(null, '', u); } catch { /* ignore */ } }
    if (id && !rx()) { current = 'rx'; selectRx(id); }
    else if (mode() === 'rx' && !rx() && !host.state.cart.length && !desk.asked) { desk.asked = true; setTimeout(() => { if (!rx() && !document.querySelector('.modal-backdrop')) choose(); }, 350); }
  }

  window.PharmacyDesk = { active, mode, segHtml, bindSeg, bind, paint, selectRx, guardOtc, beforePayment, switchTo, choose };
})(window);
