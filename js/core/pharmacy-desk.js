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

  /* ------------------------------------------------------------------ the panel
   * Wide till (the root has .ph-rx-side): the prescription lives in its own column to the LEFT of the cart, so the cart and the
   * payment summary keep their full height. Narrower till: a one-line strip above the cart, with "Details" opening the same
   * panel in a window. Nothing here ever grows the area above the cart by more than that one line. */
  function allergyHit(patient, item) {
    const med = PT().medicineOf(item.productId) || {};
    const hay = `${item.nameSnapshot || ''} ${med.genericName || ''} ${med.brandName || ''}`.toLowerCase();
    return ((patient && patient.allergies) || []).filter((a) => a && a.length > 2 && hay.includes(String(a).toLowerCase()));
  }

  let detailBody = null;              // the open "Details" window body (narrow tills)

  function emptyHtml() {
    return `<div class="ph-rx-empty">
      <div class="ph-desk-step"><span class="ph-step-n">1</span><div><strong>Choose the prescription to dispense</strong><div class="text-xs text-muted">Only prescriptions a pharmacist has validated can be dispensed. Its medicines load into the cart for you.</div></div></div>
      ${desk.error ? `<div class="ph-danger-box" style="margin:var(--space-3) 0 0">${esc(desk.error)}</div>` : ''}
      <div class="ph-rx-btns">
        <button type="button" class="btn btn-primary" data-d="find">${window.Icons.get('search')} Find prescription</button>
        <button type="button" class="btn btn-secondary" data-d="patient" data-requires-permission="patients.view">${window.Icons.get('patient')} Find by patient</button>
        <a class="btn btn-secondary" href="prescriptions.html?new=1" data-requires-permission="prescriptions.intake">${window.Icons.get('plus')} Record a new prescription</a>
      </div></div>`;
  }

  /** Header + who + medicines. Used by the side column and by the Details window. */
  function detailHtml(r) {
    const pt = desk.patient; const pres = r.prescriber || {};
    const allergies = (pt && pt.allergies) || [];
    const items = (r.items || []).map((i) => {
      const l = left(i); const c = inCart(i.productId); const hits = allergyHit(pt, i);
      const act = l <= 0 ? '<span class="badge badge-success">Done</span>'
        : c > 0 ? `<span class="badge ${c > l ? 'badge-danger' : 'badge-info'}">${c > l ? `Cart ${esc(P().qty(c))} is more than left` : `In cart ${esc(P().qty(c))}`}</span>`
          : `<button type="button" class="btn btn-secondary btn-sm" data-add="${esc(i.productId)}">Add ${esc(P().qty(l))}</button>`;
      return `<li class="ph-rx-item ${l <= 0 ? 'ph-done' : ''}">
        <div class="ph-rx-item-top"><strong>${esc(i.nameSnapshot)}</strong><span class="ph-rx-act">${act}</span></div>
        <div class="text-xs text-muted">${esc(i.strength || '')} ${esc(i.dosageForm || '')}</div>
        <div class="ph-rx-dir">${esc(i.directions || 'No directions on the prescription')}</div>
        <div class="text-xs text-secondary">Dispensed ${esc(P().qty(i.dispensedQty || 0))} of ${esc(P().qty(i.prescribedQty))} · <strong>${esc(P().qty(l))} left</strong></div>
        ${hits.length ? `<div class="ph-allergy-hit">⚠ Patient is allergic to ${esc(hits.join(', '))}</div>` : ''}</li>`;
    }).join('');
    return `
      <div class="ph-rx-who">
        <div><span class="ph-k">Patient</span>${pt ? `<strong>${esc(pt.name)}</strong><div class="text-xs text-muted">${esc(pt.number || '')}${age(pt.dateOfBirth) ? ` · ${esc(age(pt.dateOfBirth))}` : ''}${pt.sex ? ` · ${esc(pt.sex)}` : ''}${pt.phone ? ` · ${esc(pt.phone)}` : ''}</div>` : '<span class="text-muted">Not visible to your role</span>'}</div>
        <div><span class="ph-k">Prescriber</span><strong>${esc(pres.name || '-')}</strong><div class="text-xs text-muted">${esc(pres.registrationNumber || '')}${pres.facility ? ` · ${esc(pres.facility)}` : ''}</div></div>
        <div><span class="ph-k">Dates</span><div class="text-xs">Written ${esc(P().date(r.prescriptionDate))}<br>Valid until ${esc(P().date(r.validUntil))}${r.maxDispensings ? `<br>Repeats: ${esc(r.maxDispensings)}×` : ''}</div></div>
      </div>
      ${allergies.length ? `<div class="ph-warn-box" style="margin:0 0 var(--space-3)"><strong>Allergies:</strong> ${allergies.map(esc).join(', ')}. Check each medicine before dispensing.</div>` : (pt ? '<div class="ph-note" style="margin:0 0 var(--space-3)">No allergies recorded for this patient.</div>' : '')}
      <h4 class="ph-rx-h">Medicines <button type="button" class="btn btn-ghost btn-sm" data-d="reload" title="Put any missing medicines back in the cart">Reload all</button></h4>
      <ul class="ph-rx-items">${items}</ul>
      <div class="ph-note">Other items the patient wants can be added with the search above. Only medicines on the prescription count against it.</div>`;
  }

  function bindPanel(root, closeFn) {
    const r = rx();
    root.querySelector('[data-d="find"]')?.addEventListener('click', () => choose());
    root.querySelector('[data-d="patient"]')?.addEventListener('click', byPatient);
    root.querySelector('[data-d="change"]')?.addEventListener('click', () => { if (closeFn) closeFn(); choose(); });
    root.querySelector('[data-d="clear"]')?.addEventListener('click', async () => {
      if (host.state.cart.length && !(await window.UI.confirmDialog({ title: 'Remove this prescription?', message: 'The cart is cleared too.', confirmText: 'Remove', danger: true }))) return;
      if (closeFn) closeFn();
      clearRx();
    });
    root.querySelector('[data-d="reload"]')?.addEventListener('click', () => loadItems());
    root.querySelector('[data-d="details"]')?.addEventListener('click', openDetails);
    root.querySelectorAll('[data-add]').forEach((b) => b.addEventListener('click', async () => {
      const item = ((r && r.items) || []).find((x) => String(x.productId) === b.dataset.add); if (!item) return;
      b.disabled = true; await addItem(item, left(item));
    }));
    window.Permissions.applyPermissionGates(root, window.AppShell.getUser());
  }

  function openDetails() {
    const r = rx(); if (!r) return;
    const modal = window.UI.openModal({ title: `${r.number} · prescription`, maxWidth: '620px', bodyHtml: '<div id="ph-rx-detail"></div>', footerHtml: '<button class="btn btn-ghost" data-act="clear" style="color:var(--color-danger)">Remove prescription</button><button class="btn btn-secondary" data-act="change">Change prescription</button><button class="btn btn-primary" data-act="close">Done</button>' });
    modal.querySelector('[data-act="close"]').addEventListener('click', () => window.UI.closeModal());
    modal.querySelector('[data-act="change"]').addEventListener('click', () => { window.UI.closeModal(); choose(); });
    modal.querySelector('[data-act="clear"]').addEventListener('click', async () => {
      if (host.state.cart.length && !(await window.UI.confirmDialog({ title: 'Remove this prescription?', message: 'The cart is cleared too.', confirmText: 'Remove', danger: true }))) return;
      window.UI.closeModal(); clearRx();
    });
    detailBody = modal.querySelector('#ph-rx-detail');
    paintDetails();
  }
  function paintDetails() {
    if (!detailBody) return;
    if (!document.body.contains(detailBody)) { detailBody = null; return; }
    const r = rx();
    if (!r) { detailBody = null; window.UI.closeModal(); return; }
    detailBody.innerHTML = detailHtml(r);
    bindPanel(detailBody);
  }

  function paint() {
    const strip = document.getElementById('ph-desk');          // one line inside the search card
    const side = document.getElementById('ph-rxside');         // the column beside the cart (wide tills)
    const root = document.getElementById('pz-root');
    if (!host || !strip) return;
    if (!active()) { strip.innerHTML = ''; strip.style.display = 'none'; if (side) side.hidden = true; return; }
    const m = mode();
    const wasRx = !!(root && root.classList.contains('ph-rx'));
    if (root) root.classList.toggle('ph-rx', m === 'rx');
    if (root && wasRx !== (m === 'rx') && host.fit) host.fit();   // the cart needs re-measuring when its column appears / goes
    strip.style.display = '';

    if (m === 'otc') {
      if (side) { side.hidden = true; side.innerHTML = ''; }
      strip.innerHTML = `<div class="ph-desk ph-desk-otc"><span>${window.Icons.get('bag')} <strong>Over-the-counter sale.</strong> Medicines that need a prescription, and controlled drugs, are not sold here.</span><button type="button" class="btn btn-secondary btn-sm" data-d="to-rx">Dispense a prescription</button></div>`;
      strip.querySelector('[data-d="to-rx"]').addEventListener('click', () => switchTo('rx'));
      return;
    }

    const r = rx();
    // ---- the side column (visible only when the till is wide enough; see css/pharmacy.css)
    if (side) {
      side.hidden = false;
      if (desk.loading) side.innerHTML = '<div class="ph-rx-pad text-muted">Loading the prescription…</div>';
      else if (!r) { side.innerHTML = `<div class="ph-rx-head"><strong>${window.Icons.get('pill')} Prescription</strong></div><div class="ph-rx-scroll">${emptyHtml()}</div>`; bindPanel(side); }
      else {
        side.innerHTML = `<div class="ph-rx-head"><div class="ph-rx-title"><span class="ph-step-n ok">✓</span><strong>${esc(r.number)}</strong> ${P().badge(r.status)}</div>
          <div class="ph-rx-btns"><button type="button" class="btn btn-secondary btn-sm" data-d="change">Change</button><button type="button" class="btn btn-ghost btn-sm" data-d="clear" style="color:var(--color-danger)">Remove</button></div></div>
          <div class="ph-rx-scroll">${detailHtml(r)}</div>`;
        bindPanel(side);
      }
    }
    // ---- the one-line strip (visible only on narrower tills)
    if (desk.loading) strip.innerHTML = '<div class="ph-desk ph-desk-rxstrip"><span class="text-muted">Loading the prescription…</span></div>';
    else if (!r) {
      strip.innerHTML = `<div class="ph-desk ph-desk-rxstrip ph-desk-rxstrip-empty"><span class="ph-step-n">1</span><strong>Choose the prescription to dispense</strong>
        ${desk.error ? `<span class="ph-allergy-hit ph-opt" style="margin:0">${esc(desk.error)}</span>` : ''}<span class="ph-spacer"></span>
        <button type="button" class="btn btn-primary btn-sm" data-d="find">${window.Icons.get('search')} Find prescription</button>
        <button type="button" class="btn btn-secondary btn-sm ph-opt" data-d="patient" data-requires-permission="patients.view">By patient</button>
        <a class="btn btn-secondary btn-sm ph-opt" href="prescriptions.html?new=1" data-requires-permission="prescriptions.intake">New prescription</a></div>`;
      bindPanel(strip);
    } else {
      const pt = desk.patient; const al = (pt && pt.allergies) || [];
      const open = (r.items || []).filter((i) => left(i) > 0).length;
      strip.innerHTML = `<div class="ph-desk ph-desk-rxstrip"><span class="ph-step-n ok">✓</span><strong>${esc(r.number)}</strong> ${P().badge(r.status)}
        <span class="ph-strip-who">${pt ? esc(pt.name) : ''}${open ? ` · ${open} medicine${open === 1 ? '' : 's'}` : ''}</span>
        ${al.length ? `<span class="ph-chip-allergy" title="${esc(al.join(', '))}">⚠ Allergies: ${esc(al.slice(0, 2).join(', '))}${al.length > 2 ? '…' : ''}</span>` : ''}<span class="ph-spacer"></span>
        <button type="button" class="btn btn-secondary btn-sm" data-d="details">Details</button>
        <button type="button" class="btn btn-secondary btn-sm ph-opt" data-d="change">Change</button>
        <button type="button" class="btn btn-ghost btn-sm ph-opt" data-d="clear" style="color:var(--color-danger)">Remove</button></div>`;
      bindPanel(strip);
    }
    paintDetails();
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
