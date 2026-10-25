/**
 * hx-operations.js - "Restaurant devices & printing": the owner says which devices the restaurant has (waiter tablet, kitchen screen,
 * kitchen / bar / till printer, cashier station, self-service kiosk) and how paper is used. Everything else adapts to it.
 *   GET /restaurant/operations   PUT /restaurant/operations   (devices, printing, ready, useTables, guestQr)
 * Safe to change at any time: nothing is deleted and open orders keep working.
 */
(function () {
  const { E, can, get, send, head } = window.HX;
  let el, data, draft;
  document.addEventListener('DOMContentLoaded', init);

  const DEVICES = [
    ['waiterTablet', 'Waiter tablet / phone', 'Waiters take orders at the table.'],
    ['cashierStation', 'Cashier station (tablet or PC)', 'Takes payments. With no waiters it also takes the orders.'],
    ['kitchenScreen', 'Kitchen screen', 'Cooks tap Accept / Preparing / Ready. No screen? The kitchen works from paper.'],
    ['kitchenPrinter', 'Kitchen printer', 'Prints kitchen tickets.'],
    ['barPrinter', 'Bar printer', 'Separate printer for drinks. Without it, bar tickets print in the kitchen.'],
    ['cashierPrinter', 'Till / waiter-station printer', 'Prints customer bills and receipts.'],
    ['selfServiceKiosk', 'Self-service kiosk', 'Customers order and pay on a tablet.'],
  ];
  const PAPER = [
    ['kotOnSend', 'Print a kitchen ticket whenever an order is sent'],
    ['waiterSlip', 'Also print a waiter copy (second slip) with every order'],
    ['slipPrices', 'Show prices on the waiter copy'],
    ['billOnRequest', 'Print the customer bill when it is generated'],
    ['receiptOnPayment', 'Print the receipt automatically after payment'],
    ['cancelSlips', 'Print a CANCELLED slip when a sent item is cancelled'],
  ];
  const TYPES = [['DELIVERY', 'Delivery'], ['PICKUP', 'Pickup'], ['TAKEAWAY', 'Take away'], ['COUNTER', 'Counter'], ['DINE_IN', 'Dine-in'], ['BAR_TAB', 'Bar tab']];

  async function init() {
    el = window.HX.mount('Restaurant devices');
    if (!el) return;
    await window.AppShell.whenProfileReady?.();
    await load();
  }

  async function load() {
    data = await get('/restaurant/operations', { branchId: window.HX.branchId() });
    if (!data || !data.operations) { el.innerHTML = head('Restaurant devices') + window.HX.empty('Could not load', 'Try again in a moment.'); return; }
    const o = data.operations;
    draft = { preset: o.preset, devices: { ...o.devices }, printing: { ...o.printing }, manual: (data.plan.markReadyByHand || []).slice(), useTables: undefined, guestQr: undefined };
    if (!o.configured) { draft.devices = { ...draft.devices }; }
    paint();
  }

  const chk = (id, label, on, hint, dis) => `<label class="hx-check" style="display:flex;gap:10px;align-items:flex-start;padding:6px 0"><input type="checkbox" id="${id}" ${on ? 'checked' : ''} ${dis ? 'disabled' : ''}> <span><b style="font-weight:600">${E(label)}</b>${hint ? `<small class="hx-sub" style="display:block">${E(hint)}</small>` : ''}</span></label>`;

  function paint() {
    const editable = can('restaurant.settings.manage');
    const o = data.operations;
    const warn = (data.warnings || []).map((w) => `<div class="hx-card" style="border-left:4px solid ${w.level === 'warning' ? '#d97706' : '#2563eb'};margin-bottom:var(--space-2)"><small>${E(w.message)}</small></div>`).join('');
    const presets = data.presets.map((p) => `<button type="button" class="hx-card ${draft.preset === p.id ? 'on' : ''}" data-preset="${p.id}" style="text-align:left;cursor:pointer;${draft.preset === p.id ? 'outline:2px solid var(--primary,#0f766e)' : ''}" ${editable ? '' : 'disabled'}><b>${E(p.label)}</b><small class="hx-sub" style="display:block;margin-top:4px">${E(p.summary)}</small></button>`).join('');
    const anyPrinter = draft.devices.kitchenPrinter || draft.devices.barPrinter || draft.devices.cashierPrinter;
    el.innerHTML = head('Restaurant devices & printing', 'Tell the system what you have. It adapts: kitchen on paper or screen, one printer or many, with or without waiters. Change it any day.') +
      (warn ? `<div style="max-width:820px">${warn}</div>` : '') +
      `<div class="hx-card" style="max-width:820px;margin-bottom:var(--space-4)"><h4>1. Pick the set-up closest to yours</h4><div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:var(--space-3);margin-top:var(--space-3)">${presets}</div></div>
      <form id="of" class="hx-card hx-form" style="max-width:820px;margin-bottom:var(--space-4)" novalidate><fieldset ${editable ? '' : 'disabled'} style="border:0;padding:0;display:grid;gap:var(--space-2)">
        <h4>2. Your devices</h4>${DEVICES.map(([k, l, h]) => chk('d-' + k, l, draft.devices[k], h)).join('')}
        <h4 style="margin-top:var(--space-3)">3. Paper</h4>
        ${anyPrinter ? PAPER.map(([k, l]) => chk('p-' + k, l, draft.printing[k])).join('') : '<p class="hx-sub">No printer ticked: everything works on screens. Tick a printer above to use paper.</p>'}
        ${anyPrinter ? `<div class="two"><label>Kitchen ticket copies<select class="select" id="p-kotCopies">${[1, 2, 3].map((n) => `<option ${+draft.printing.kotCopies === n ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
        <label>Receipt copies<select class="select" id="p-receiptCopies">${[1, 2, 3].map((n) => `<option ${+draft.printing.receiptCopies === n ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
        <label>Paper width<select class="select" id="p-paperWidthMm">${[58, 80].map((n) => `<option value="${n}" ${+draft.printing.paperWidthMm === n ? 'selected' : ''}>${n} mm</option>`).join('')}</select></label></div>` : ''}
        ${draft.devices.kitchenScreen ? '' : `<h4 style="margin-top:var(--space-3)">4. No kitchen screen: which orders are marked READY by hand?</h4><p class="hx-sub">Dine-in food counts as ready when sent (the waiter collects it). These types wait until staff tap <b>Mark ready</b>:</p><div style="display:flex;flex-wrap:wrap;gap:var(--space-3)">${TYPES.map(([k, l]) => `<label class="hx-check" style="display:flex;gap:6px"><input type="checkbox" data-mr="${k}" ${draft.manual.includes(k) ? 'checked' : ''}> ${l}</label>`).join('')}</div>`}
        <h4 style="margin-top:var(--space-3)">Also</h4>
        ${chk('o-useTables', 'Use table management (choose a table for dine-in orders)', undefined, 'Leave as is unless you want to change it.')}
        ${editable ? '<div style="margin-top:var(--space-3)"><button class="btn btn-primary" type="submit">Save set-up</button></div>' : '<p class="hx-sub">Only the owner or a manager can change this.</p>'}</fieldset></form>
      ${stations()}${channels()}${advice()}${queue()}`;
    wire(editable);
  }

  function stations() {
    const s = data.printStations || [];
    if (!s.length) return '';
    return `<div class="hx-card" style="max-width:820px;margin-bottom:var(--space-4)"><h4>Printer devices: what to switch on</h4><p class="hx-sub">On each printer's PC or tablet tap the <b>Auto-print</b> chip (bottom-left), choose the printer below and keep the page open. Use Chrome with <b>--kiosk-printing</b>.</p>${s.map((x) => `<div class="hx-row"><div class="grow"><b>${E(x.printer)}</b> → choose <b>${E(x.choose)}</b><small class="hx-sub" style="display:block">${E(x.where)}</small><small>${x.prints.map(E).join(' · ')}</small></div></div>`).join('')}<div style="margin-top:var(--space-3)"><button class="btn btn-secondary" id="ap">Set up auto-print on THIS device</button></div></div>`;
  }
  function channels() {
    return `<div class="hx-card" style="max-width:820px;margin-bottom:var(--space-4)"><h4>How each kind of order reaches your kitchen</h4>${(data.channels || []).map((c) => `<div class="hx-row"><div class="grow"><b>${E(c.label)}</b>${c.available === false ? ' <small class="hx-sub">(not switched on)</small>' : ''}<small class="hx-sub" style="display:block">Kitchen sees it ${E(c.kitchenSees)}${c.readyBy === 'MANUAL' ? ' · staff tap Mark ready' : c.readyBy === 'AUTO' ? ' · ready when sent' : ''}${c.note ? ' · ' + E(c.note) : ''}</small></div></div>`).join('')}</div>`;
  }
  function advice() {
    return `<div class="hx-card" style="max-width:820px;margin-bottom:var(--space-4)"><h4>How to run your restaurant with what you have</h4>${(data.advice || []).map((a) => `<h5 style="margin:var(--space-3) 0 4px">${E(a.title)}</h5><ul style="margin:0;padding-left:20px">${a.steps.map((t) => `<li>${E(t)}</li>`).join('')}</ul>`).join('')}</div>`;
  }
  function queue() {
    const q = data.queue || {}; const k = Object.keys(q);
    if (!k.length) return '';
    return `<div class="hx-card" style="max-width:820px"><h4>Paper waiting</h4>${k.map((t) => `<div class="hx-row"><div class="grow">${E(t)}</div><span>${q[t].pending} waiting · oldest ${q[t].oldestMinutes} min</span></div>`).join('')}</div>`;
  }

  function readForm() {
    const q = (id) => el.querySelector('#' + id);
    for (const [k] of DEVICES) { const i = q('d-' + k); if (i) draft.devices[k] = i.checked; }
    for (const [k] of PAPER) { const i = q('p-' + k); if (i) draft.printing[k] = i.checked; }
    ['kotCopies', 'receiptCopies', 'paperWidthMm'].forEach((k) => { const i = q('p-' + k); if (i) draft.printing[k] = Number(i.value); });
    const mr = [...el.querySelectorAll('[data-mr]')]; if (mr.length) draft.manual = mr.filter((x) => x.checked).map((x) => x.dataset.mr);
    const t = q('o-useTables'); draft.useTables = t && t.indeterminate === false && t.dataset.touched ? t.checked : undefined;
  }

  function wire(editable) {
    el.querySelectorAll('[data-preset]').forEach((b) => b.addEventListener('click', () => {
      const p = data.presets.find((x) => x.id === b.dataset.preset); if (!p) return;
      readForm(); draft.preset = p.id; draft.devices = { ...p.devices }; draft.printing = { ...draft.printing, ...p.printing };
      draft.manual = p.devices.kitchenScreen ? [] : (draft.manual.length ? draft.manual : ['DELIVERY', 'PICKUP', 'TAKEAWAY', 'COUNTER']); paint();
    }));
    el.querySelectorAll('[id^="d-"]').forEach((i) => i.addEventListener('change', () => { readForm(); draft.preset = 'CUSTOM'; paint(); }));
    const t = el.querySelector('#o-useTables'); if (t) { t.indeterminate = true; t.addEventListener('change', () => { t.dataset.touched = '1'; }); }
    el.querySelector('#ap')?.addEventListener('click', () => window.HXAutoPrint && window.HXAutoPrint.dialog());
    el.querySelector('#of')?.addEventListener('submit', async (e) => {
      e.preventDefault(); if (!editable) return; readForm();
      const body = { devices: draft.devices, printing: draft.printing };
      if (draft.preset && draft.preset !== 'CUSTOM') body.preset = draft.preset;
      if (!draft.devices.kitchenScreen) body.ready = { manualOrderTypes: draft.manual };
      if (draft.useTables !== undefined) body.useTables = draft.useTables;
      if (body.preset) { body.devices = draft.devices; }
      const btn = e.currentTarget.querySelector('[type=submit]'); window.UI.setButtonLoading(btn, true, 'Saving…');
      const r = await send('put', '/restaurant/operations', body); window.UI.setButtonLoading(btn, false);
      if (r) { (r.notes || []).forEach((n) => window.UI.toast.info(n)); window.UI.toast.success('Set-up saved'); setTimeout(() => location.reload(), 900); }
    });
  }
})();
