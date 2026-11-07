/**
 * purchase-returns.js
 * Return goods from a RECEIVED purchase to the supplier, and look back at every return.
 *
 *   window.PurchaseReturns.openWizard({ purchaseId?, onDone? })  3-step guided return:
 *        1 Find the purchase  ->  2 Choose items + reason  ->  3 Review the stock and money impact  ->  confirm
 *   window.PurchaseReturns.renderList(host)                      summary cards + filters + table of all returns
 *   window.PurchaseReturns.openDetail(id)                        full return note, refund tracking, print
 *
 * What a return does (all decided and applied by the backend in one transaction):
 *   - the stock leaves the pool it was received into (retail / warehouse), with its batches and serial numbers;
 *   - the value of the goods reduces what the shop owes the supplier. If the purchase was already (partly) paid, the
 *     part that cannot be offset is a refund the SUPPLIER owes the shop - tracked until it is received or kept as credit.
 * API money fields arrive in KES, except /purchase-returns/purchase/:id/eligibility which uses integer cents (*Cents).
 */
(function (window) {
  'use strict';

  const REASONS = {
    DAMAGED:       { label: 'Damaged goods',        hint: 'Broken or damaged on arrival or in storage' },
    EXPIRED:       { label: 'Expired / short dated', hint: 'Past or too close to its expiry date' },
    WRONG_ITEM:    { label: 'Wrong item sent',       hint: 'Not what was ordered' },
    QUALITY:       { label: 'Poor quality',          hint: 'Faulty, fake or below the agreed standard' },
    OVERSUPPLY:    { label: 'Over-supplied',         hint: 'More than ordered or more than needed' },
    PRICE_DISPUTE: { label: 'Price dispute',         hint: 'Billed at a different price than agreed' },
    RECALL:        { label: 'Supplier recall',       hint: 'The product was recalled' },
    OTHER:         { label: 'Other reason',          hint: 'Explain in the note' },
  };
  const REFUND = {
    NONE:        ['badge-neutral', 'No refund due'],
    PENDING:     ['badge-warning', 'Refund pending'],
    PARTIAL:     ['badge-info', 'Part refunded'],
    SETTLED:     ['badge-success', 'Refund received'],
    CREDIT_HELD: ['badge-info', 'Kept as credit'],
  };

  const esc = (v) => window.UI.escapeHtml(v == null ? '' : String(v));
  const kes = (n) => window.UI.formatMoney(Number(n) || 0);
  const cents = (c) => window.UI.formatMoney((Number(c) || 0) / 100);
  const day = (d) => (d ? window.UI.formatDate(d) : '—');
  const num = (n) => (Number(n) || 0).toLocaleString(undefined, { maximumFractionDigits: 3 });
  const today = () => new Date().toISOString().slice(0, 10);
  const can = (perm) => { try { return window.Permissions.can(window.AppShell.getUser(), perm); } catch { return false; } };
  const gate = (root) => window.Permissions.applyPermissionGates(root, window.AppShell.getUser());
  const debounce = (fn, ms = 300) => (window.UI.debounce ? window.UI.debounce(fn, ms) : fn);
  const round3 = (n) => Math.round(n * 1000) / 1000;
  const locName = (l) => (l === 'WAREHOUSE' ? 'Warehouse' : 'Shop floor');
  const refundBadge = (s) => { const [c, t] = REFUND[s] || REFUND.NONE; return `<span class="badge ${c}">${t}</span>`; };

  /* ------------------------------------------------------------------ styles */
  function injectStyles() {
    if (document.getElementById('pr-styles')) return;
    const css = `
.pr-steps{display:flex;gap:6px;margin:0 0 var(--space-5);flex-wrap:wrap}
.pr-step{flex:1;min-width:150px;display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid var(--color-border);border-radius:var(--radius-md);background:var(--color-surface);color:var(--color-text-muted);font-size:13px}
.pr-step b{width:26px;height:26px;border-radius:50%;display:grid;place-items:center;background:var(--color-bg);color:var(--color-text-secondary);font-size:13px;flex:none}
.pr-step strong{display:block;color:var(--color-text);font-size:13px}
.pr-step.on{border-color:var(--color-primary);background:var(--color-primary-50)}
.pr-step.on b{background:var(--color-primary);color:#fff}
.pr-step.done b{background:var(--color-success);color:#fff}
.pr-find{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:var(--space-4)}
.pr-find .input,.pr-find .select{flex:1;min-width:180px}
.pr-pick{display:grid;gap:10px;max-height:46vh;overflow:auto;padding:2px}
.pr-po{display:grid;grid-template-columns:1.3fr 1fr 1fr auto;gap:12px;align-items:center;text-align:left;width:100%;padding:12px 14px;border:1px solid var(--color-border);border-radius:var(--radius-md);background:var(--color-surface);cursor:pointer;font:inherit;color:inherit}
.pr-po:hover:not(:disabled){border-color:var(--color-primary);box-shadow:var(--shadow-sm)}
.pr-po:disabled{opacity:.55;cursor:not-allowed}
.pr-po small{display:block;color:var(--color-text-muted);font-size:12px}
.pr-po strong{font-size:14px}
.pr-ctx{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;padding:12px 14px;margin-bottom:var(--space-4);background:var(--color-bg);border-radius:var(--radius-md);border:1px solid var(--color-border)}
.pr-ctx small{display:block;color:var(--color-text-muted);font-size:11px;text-transform:uppercase;letter-spacing:.03em}
.pr-ctx b{font-size:14px}
.pr-lines{width:100%;border-collapse:collapse}
.pr-lines th{font-size:11px;text-transform:uppercase;letter-spacing:.03em;color:var(--color-text-muted);text-align:left;padding:8px 8px;border-bottom:1px solid var(--color-border);white-space:nowrap}
.pr-lines td{padding:10px 8px;border-bottom:1px solid var(--color-border);vertical-align:top;font-size:13px}
.pr-lines .r{text-align:right;font-variant-numeric:tabular-nums}
.pr-lines tr.pr-off td{opacity:.5}
.pr-lines tr.pr-on td{background:var(--color-primary-50)}
.pr-qty{display:flex;align-items:center;gap:6px;justify-content:flex-end}
.pr-qty .input{width:86px;text-align:right}
.pr-chip{display:inline-block;font-size:11px;padding:1px 7px;border-radius:99px;background:var(--color-bg);color:var(--color-text-secondary);margin-left:4px;border:1px solid var(--color-border)}
.pr-err{color:var(--color-danger);font-size:12px;margin-top:4px}
.pr-note{color:var(--color-text-muted);font-size:12px;margin-top:3px}
.pr-serials{display:flex;flex-wrap:wrap;gap:6px;padding:8px 0 2px}
.pr-serials label{display:inline-flex;align-items:center;gap:6px;padding:4px 9px;border:1px solid var(--color-border);border-radius:99px;font-size:12px;cursor:pointer;background:var(--color-surface)}
.pr-serials label.sel{border-color:var(--color-primary);background:var(--color-primary-50)}
.pr-reasons{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:8px;margin:6px 0 var(--space-4)}
.pr-reason{padding:10px 12px;border:1px solid var(--color-border);border-radius:var(--radius-md);cursor:pointer;background:var(--color-surface);text-align:left;font:inherit;color:inherit}
.pr-reason strong{display:block;font-size:13px}.pr-reason small{color:var(--color-text-muted);font-size:12px}
.pr-reason.on{border-color:var(--color-primary);background:var(--color-primary-50);box-shadow:0 0 0 1px var(--color-primary) inset}
.pr-grid2{display:grid;grid-template-columns:1fr 1fr;gap:var(--space-4)}
@media(max-width:760px){.pr-grid2{grid-template-columns:1fr}.pr-po{grid-template-columns:1fr 1fr}}
.pr-card{border:1px solid var(--color-border);border-radius:var(--radius-md);background:var(--color-surface);overflow:hidden}
.pr-card h4{margin:0;padding:10px 14px;font-size:13px;background:var(--color-bg);border-bottom:1px solid var(--color-border)}
.pr-card .pr-body{padding:12px 14px}
.pr-kv{display:flex;justify-content:space-between;gap:12px;padding:6px 0;font-size:13px;border-bottom:1px dashed var(--color-border)}
.pr-kv:last-child{border-bottom:none}
.pr-kv.big{font-size:15px;font-weight:700;border-bottom:none;padding-top:10px}
.pr-kv .pos{color:var(--color-success)}.pr-kv .neg{color:var(--color-danger)}
.pr-callout{padding:10px 12px;border-radius:var(--radius-md);font-size:13px;margin-top:10px}
.pr-callout.info{background:var(--color-info-bg);color:var(--color-info)}
.pr-callout.warn{background:var(--color-warning-bg);color:var(--color-warning)}
.pr-callout.ok{background:var(--color-success-bg);color:var(--color-success)}
.pr-total{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-top:var(--space-4);padding:12px 14px;border-radius:var(--radius-md);background:var(--color-primary-50);border:1px solid var(--color-primary)}
.pr-total b{font-size:18px}
.pr-done{text-align:center;padding:var(--space-4) 0}
.pr-done .tick{width:56px;height:56px;border-radius:50%;background:var(--color-success-bg);color:var(--color-success);display:grid;place-items:center;margin:0 auto 12px;font-size:28px}
.pr-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;padding:var(--space-4) var(--space-6)}
.pr-stat{padding:12px 14px;border:1px solid var(--color-border);border-radius:var(--radius-md);background:var(--color-surface)}
.pr-stat small{display:block;color:var(--color-text-muted);font-size:12px}
.pr-stat b{display:block;font-size:20px;margin-top:2px}
.pr-stat span{font-size:12px;color:var(--color-text-secondary)}
.pr-filters{display:flex;gap:8px;flex-wrap:wrap;padding:0 var(--space-6) var(--space-4);align-items:center}
.pr-filters .input,.pr-filters .select{max-width:190px}
.pr-filters .grow{flex:1;min-width:200px;max-width:none}
.pr-lbl{font-size:12px;color:var(--color-text-muted)}
.pr-refunds{margin:0;padding:0;list-style:none}
.pr-refunds li{display:flex;justify-content:space-between;gap:8px;padding:6px 0;border-bottom:1px dashed var(--color-border);font-size:13px}
`;
    const el = document.createElement('style'); el.id = 'pr-styles'; el.textContent = css; document.head.appendChild(el);
  }

  const post = (path, body) => window.Api.post(path, body);
  const get = (path, q) => window.Api.get(path, q);

  /* ================================================================== WIZARD */
  function openWizard({ purchaseId = null, onDone = null } = {}) {
    injectStyles();
    const S = {
      step: 1, purchase: null, supplier: null, lines: [], q: '', supplierId: '', list: null, loadingList: false,
      reason: '', reasonNote: '', returnDate: today(), creditNote: '', notes: '', confirmed: false, result: null, busy: false, suppliers: null,
    };
    let modalEl;
    const body = () => modalEl.querySelector('.modal-body');
    const foot = () => modalEl.querySelector('.modal-footer');

    modalEl = window.UI.openModal({ title: 'Return purchase to supplier', maxWidth: '1000px', bodyHtml: '<div></div>', footerHtml: '<span></span>', onMount: () => {} });

    const stepper = () => {
      const names = [['Find purchase', 'Pick the received purchase'], ['Items & reason', 'What goes back and why'], ['Review & confirm', 'Stock and money impact']];
      return `<div class="pr-steps">${names.map((n, i) => `<div class="pr-step ${S.step === i + 1 ? 'on' : S.step > i + 1 || S.result ? 'done' : ''}"><b>${S.step > i + 1 || S.result ? '✓' : i + 1}</b><span><strong>${n[0]}</strong>${n[1]}</span></div>`).join('')}</div>`;
    };
    const setFoot = (html) => { foot().innerHTML = html; };
    const close = () => { const b = modalEl.closest('.modal-backdrop'); if (b) b.querySelector('.modal-close').click(); };

    /* ---------- step 1: find the purchase */
    async function loadSuppliers() {
      if (S.suppliers) return;
      try { const { data } = await get('/suppliers', { page: 1, limit: 100 }); S.suppliers = data.items || []; } catch { S.suppliers = []; }
    }
    async function runSearch() {
      const box = body().querySelector('#pr-list'); if (!box) return;
      box.innerHTML = window.UI.skeletonRows ? `<div class="text-muted" style="padding:16px">Loading purchases…</div>` : 'Loading…';
      try {
        const q = { page: 1, limit: 10, receivedStatus: 'RECEIVED' };
        if (S.q) q.search = S.q;
        if (S.supplierId) q.supplierId = S.supplierId;
        const branchId = window.AppShell.getActiveBranchId && window.AppShell.getActiveBranchId();
        if (branchId) q.branchId = branchId;
        const { data } = await get('/purchases', q);
        S.list = data.items || [];
      } catch (err) { box.innerHTML = window.UI.emptyStateHtml({ icon: 'alert', title: 'Could not load purchases', message: err.message }); return; }
      if (!S.list.length) { box.innerHTML = window.UI.emptyStateHtml({ icon: 'bag', title: 'No received purchases found', message: 'Only purchases that have been received into stock can be returned. Try another number or supplier.' }); return; }
      box.innerHTML = S.list.map((p) => {
        const full = p.returnStatus === 'FULL';
        const pay = p.paymentStatus === 'PAID' ? ['badge-success', 'Paid'] : p.paymentStatus === 'PARTIAL' ? ['badge-warning', 'Part paid'] : ['badge-danger', 'Unpaid'];
        return `<button type="button" class="pr-po" data-id="${esc(p._id)}" ${full ? 'disabled' : ''}>
          <span><strong>${esc(p.purchaseNumber)}</strong><small>${esc(p.supplierId?.name || 'Supplier')}${p.invoiceNumber ? ` · Inv ${esc(p.invoiceNumber)}` : ''}</small></span>
          <span><strong>${kes(p.total)}</strong><small>${day(p.purchaseDate || p.createdAt)}</small></span>
          <span><strong>${kes(p.balance)}</strong><small>Still owed</small></span>
          <span style="text-align:right"><span class="badge ${pay[0]}">${pay[1]}</span>${p.returnStatus && p.returnStatus !== 'NONE' ? `<br><span class="badge ${full ? 'badge-neutral' : 'badge-info'}" style="margin-top:4px">${full ? 'Fully returned' : 'Part returned'}</span>` : ''}</span>
        </button>`;
      }).join('');
      box.querySelectorAll('.pr-po').forEach((b) => b.addEventListener('click', () => choose(b.dataset.id)));
    }
    async function drawFind() {
      S.step = 1; await loadSuppliers();
      body().innerHTML = stepper() + `
        <p class="text-secondary" style="margin-top:0">Choose the purchase the goods came in on. Only <strong>received</strong> purchases appear, because only those have stock to take back.</p>
        <div class="pr-find">
          <input class="input" id="pr-q" placeholder="Search by purchase number, e.g. PO-000012" value="${esc(S.q)}" />
          <select class="select" id="pr-sup"><option value="">All suppliers</option>${(S.suppliers || []).map((s) => `<option value="${esc(s._id)}" ${S.supplierId === s._id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select>
        </div>
        <div class="pr-pick" id="pr-list"></div>`;
      setFoot('<button class="btn btn-secondary" data-action="close" id="pr-cancel">Cancel</button>');
      foot().querySelector('#pr-cancel').addEventListener('click', close);
      body().querySelector('#pr-q').addEventListener('input', debounce((e) => { S.q = e.target.value.trim(); runSearch(); }));
      body().querySelector('#pr-sup').addEventListener('change', (e) => { S.supplierId = e.target.value; runSearch(); });
      runSearch();
    }
    async function choose(id) {
      body().innerHTML = `<div class="text-muted" style="padding:40px;text-align:center">Checking what can go back…</div>`;
      try {
        const { data } = await get(`/purchase-returns/purchase/${id}/eligibility`);
        if (!data.canReturn) {
          body().innerHTML = stepper() + window.UI.emptyStateHtml({ icon: 'alert', title: `${data.purchase.purchaseNumber} can't be returned`, message: data.blockedReason || 'Nothing on this purchase can be returned right now.' });
          setFoot('<button class="btn btn-secondary" id="pr-back1">← Pick another purchase</button>');
          foot().querySelector('#pr-back1').addEventListener('click', drawFind); return;
        }
        S.purchase = data.purchase; S.supplier = data.supplier;
        S.lines = data.lines.map((l) => ({ ...l, qty: 0, picked: [] }));
        drawItems();
      } catch (err) { window.UI.toast.error(err.message); drawFind(); }
    }

    /* ---------- step 2: items + reason */
    const lineCredit = (l) => {
      if (!l.qty) return 0;
      const left = round3(l.quantity - l.returnedQuantity);
      const remaining = l.lineTotalCents - l.returnedValueCents;
      return l.qty >= left ? remaining : Math.min(remaining, Math.round((l.lineTotalCents * l.qty) / l.quantity));
    };
    const totalCredit = () => S.lines.reduce((s, l) => s + lineCredit(l), 0);
    const chosen = () => S.lines.filter((l) => l.qty > 0);
    const lineProblem = (l) => {
      if (!l.qty) return '';
      if (l.qty > l.maxQuantity) return `Only ${num(l.maxQuantity)} can go back`;
      if (l.trackSerial && l.picked.length !== Math.round(l.qty * l.unitFactor)) return `Tick exactly ${Math.round(l.qty * l.unitFactor)} serial number(s)`;
      return '';
    };
    const canContinue = () => chosen().length > 0 && chosen().every((l) => !lineProblem(l)) && !!S.reason;

    function drawItems() {
      S.step = 2; const p = S.purchase;
      body().innerHTML = stepper() + `
        <div class="pr-ctx">
          <div><small>Purchase</small><b>${esc(p.purchaseNumber)}</b></div>
          <div><small>Supplier</small><b>${esc(S.supplier.name || '—')}</b></div>
          <div><small>Purchase total</small><b>${cents(p.totalCents)}</b></div>
          <div><small>Paid so far</small><b>${cents(p.amountPaidCents)}</b></div>
          <div><small>Still owed</small><b>${cents(p.balanceCents)}</b></div>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;gap:8px;flex-wrap:wrap">
          <h4 style="margin:0">1. Which items are going back?</h4>
          <button type="button" class="btn btn-secondary btn-sm" id="pr-all">Select everything returnable</button>
        </div>
        <div class="table-wrap" style="overflow:auto"><table class="pr-lines"><thead><tr>
          <th>Item</th><th class="r">Bought</th><th class="r">Already returned</th><th class="r">In stock now</th><th class="r">Return qty</th><th class="r">Credit</th></tr></thead>
          <tbody id="pr-rows"></tbody></table></div>
        <div class="pr-total"><span>Value being returned<br><small class="text-muted">Same price you were invoiced, VAT included</small></span><b id="pr-sum">${cents(0)}</b></div>
        <h4 style="margin:var(--space-5) 0 0">2. Why are they going back?</h4>
        <div class="pr-reasons" id="pr-reasons">${Object.entries(REASONS).map(([k, v]) => `<button type="button" class="pr-reason ${S.reason === k ? 'on' : ''}" data-r="${k}"><strong>${v.label}</strong><small>${v.hint}</small></button>`).join('')}</div>
        <div class="pr-grid2">
          <div class="field"><label>Reason details ${S.reason === 'OTHER' ? '(required)' : '(optional)'}</label><textarea class="input" id="pr-rnote" rows="2" maxlength="500" placeholder="e.g. 3 cartons crushed in transit">${esc(S.reasonNote)}</textarea></div>
          <div>
            <div class="form-row" style="grid-template-columns:1fr 1fr">
              <div class="field"><label>Return date</label><input class="input" type="date" id="pr-date" max="${today()}" value="${esc(S.returnDate)}" /></div>
              <div class="field"><label>Supplier credit note no.</label><input class="input" id="pr-cn" maxlength="60" placeholder="Optional" value="${esc(S.creditNote)}" /></div>
            </div>
          </div>
        </div>`;
      drawRows(); bindItems(); updateItemsFoot();
    }
    function drawRows() {
      const tb = body().querySelector('#pr-rows'); if (!tb) return;
      tb.innerHTML = S.lines.map((l, i) => {
        const off = l.maxQuantity <= 0;
        const prob = lineProblem(l);
        const tags = `${l.trackBatch ? '<span class="pr-chip">Batch</span>' : ''}${l.trackSerial ? '<span class="pr-chip">Serial / IMEI</span>' : ''}<span class="pr-chip">${locName(l.location)}</span>`;
        const why = off ? (l.returnableQuantity <= 0 ? 'Already fully returned' : 'None left in stock — already sold') : (l.maxQuantity < l.returnableQuantity ? `Only ${num(l.maxQuantity)} still in stock; the rest was sold` : '');
        const stockTxt = l.onHandBase == null ? '—' : `${num(l.onHandBase)}${l.unitFactor > 1 ? ' base' : ''}`;
        return `<tr class="${off ? 'pr-off' : l.qty > 0 ? 'pr-on' : ''}" data-i="${i}">
          <td><strong>${esc(l.name)}</strong>${l.sku ? `<span class="text-muted"> · ${esc(l.sku)}</span>` : ''}<div>${tags}</div>${why ? `<div class="pr-note">${why}</div>` : ''}
            ${l.trackSerial && !off ? `<div class="pr-serials" data-ser="${i}">${l.serials.map((s) => `<label class="${l.picked.includes(s) ? 'sel' : ''}"><input type="checkbox" value="${esc(s)}" ${l.picked.includes(s) ? 'checked' : ''}/> ${esc(s)}</label>`).join('') || '<span class="pr-note">No serial numbers in stock from this purchase.</span>'}</div><div class="pr-note">Tick the exact units going back.</div>` : ''}
            ${l.trackBatch && !off && l.batches.length ? `<div class="pr-note">Taken from batch${l.batches.length > 1 ? 'es' : ''}: ${l.batches.map((b) => `${esc(b.batchNumber)} (${num(b.quantity)} left)`).join(', ')} — earliest expiry first.</div>` : ''}
            ${prob ? `<div class="pr-err">${prob}</div>` : ''}</td>
          <td class="r">${num(l.quantity)} ${esc(l.unitName)}</td>
          <td class="r">${num(l.returnedQuantity)}</td>
          <td class="r">${stockTxt}</td>
          <td class="r">${off ? '—' : `<div class="pr-qty">${l.trackSerial ? `<b>${num(l.qty)}</b>` : `<input class="input" type="number" min="0" max="${l.maxQuantity}" step="any" data-q="${i}" value="${l.qty || ''}" placeholder="0" /><button type="button" class="btn btn-secondary btn-sm" data-max="${i}">Max</button>`}</div>`}</td>
          <td class="r"><strong>${l.qty ? cents(lineCredit(l)) : '—'}</strong></td></tr>`;
      }).join('');
      tb.querySelectorAll('[data-q]').forEach((inp) => inp.addEventListener('input', () => { const l = S.lines[inp.dataset.q]; l.qty = Math.max(0, round3(Number(inp.value) || 0)); refreshSoft(inp.closest('tr'), l); }));
      tb.querySelectorAll('[data-max]').forEach((b) => b.addEventListener('click', () => { const l = S.lines[b.dataset.max]; l.qty = l.maxQuantity; drawRows(); updateItemsFoot(); }));
      tb.querySelectorAll('[data-ser]').forEach((box) => box.querySelectorAll('input').forEach((cb) => cb.addEventListener('change', () => {
        const l = S.lines[box.dataset.ser];
        l.picked = [...box.querySelectorAll('input:checked')].map((x) => x.value);
        l.qty = round3(l.picked.length / l.unitFactor); drawRows(); updateItemsFoot();
      })));
    }
    // typing in a quantity box must not rebuild the table (the cursor would jump), so only the numbers around it update
    function refreshSoft(tr, l) {
      tr.className = l.qty > 0 ? 'pr-on' : '';
      tr.lastElementChild.innerHTML = `<strong>${l.qty ? cents(lineCredit(l)) : '—'}</strong>`;
      const cell = tr.firstElementChild; let e = cell.querySelector('.pr-err'); const prob = lineProblem(l);
      if (prob) { if (!e) { e = document.createElement('div'); e.className = 'pr-err'; cell.appendChild(e); } e.textContent = prob; } else if (e) e.remove();
      updateItemsFoot();
    }
    function bindItems() {
      const b = body();
      b.querySelector('#pr-all').addEventListener('click', () => {
        S.lines.forEach((l) => { l.qty = l.maxQuantity; if (l.trackSerial) { l.picked = l.serials.slice(0, Math.round(l.qty * l.unitFactor)); l.qty = round3(l.picked.length / l.unitFactor); } });
        drawRows(); updateItemsFoot();
      });
      b.querySelectorAll('.pr-reason').forEach((r) => r.addEventListener('click', () => { S.reason = r.dataset.r; b.querySelectorAll('.pr-reason').forEach((x) => x.classList.toggle('on', x === r)); updateItemsFoot(); }));
      b.querySelector('#pr-rnote').addEventListener('input', (e) => { S.reasonNote = e.target.value; updateItemsFoot(); });
      b.querySelector('#pr-date').addEventListener('change', (e) => { S.returnDate = e.target.value || today(); });
      b.querySelector('#pr-cn').addEventListener('input', (e) => { S.creditNote = e.target.value; });
    }
    function updateItemsFoot() {
      const sum = body().querySelector('#pr-sum'); if (sum) sum.textContent = cents(totalCredit());
      const needNote = S.reason === 'OTHER' && !S.reasonNote.trim();
      const ok = canContinue() && !needNote;
      const hint = !chosen().length ? 'Enter a quantity for at least one item.' : !S.reason ? 'Choose a reason.' : needNote ? 'Describe the reason.' : chosen().some((l) => lineProblem(l)) ? 'Fix the highlighted item.' : `${chosen().length} item${chosen().length > 1 ? 's' : ''} · ${cents(totalCredit())}`;
      setFoot(`<span class="text-muted text-sm" style="margin-right:auto">${hint}</span><button class="btn btn-secondary" id="pr-b2">← Back</button><button class="btn btn-primary" id="pr-n2" ${ok ? '' : 'disabled'}>Review return →</button>`);
      foot().querySelector('#pr-b2').addEventListener('click', drawFind);
      foot().querySelector('#pr-n2').addEventListener('click', drawReview);
    }

    /* ---------- step 3: review */
    function drawReview() {
      S.step = 3; S.confirmed = false;
      const p = S.purchase; const credit = totalCredit();
      const applied = Math.min(credit, p.balanceCents); const refund = credit - applied;
      const supBefore = S.supplier.balanceCents; const supAfter = supBefore - credit;
      const owe = (c) => (c > 0 ? `You owe ${cents(c)}` : c < 0 ? `Supplier owes you ${cents(-c)}` : 'Nothing owed');
      body().innerHTML = stepper() + `
        <div class="pr-grid2">
          <div class="pr-card"><h4>Stock that will leave your inventory</h4><div class="pr-body">
            ${chosen().map((l) => { const base = round3(l.qty * l.unitFactor); const after = l.onHandBase == null ? null : round3(l.onHandBase - base); return `
              <div class="pr-kv"><span><strong>${esc(l.name)}</strong><br><small class="text-muted">${locName(l.location)}${after != null ? ` · ${num(l.onHandBase)} → ${num(after)} on hand` : ''}</small>${l.trackSerial ? `<br><small class="text-muted">${l.picked.map(esc).join(', ')}</small>` : ''}</span><span><strong class="neg">−${num(l.qty)} ${esc(l.unitName)}</strong>${l.unitFactor > 1 ? `<br><small class="text-muted">${num(base)} base units</small>` : ''}</span></div>`; }).join('')}
            <div class="pr-callout info">Stock goes back to exactly where it was before the purchase was received. It is recorded in the stock history as a purchase return.</div>
          </div></div>
          <div class="pr-card"><h4>What it does to the money</h4><div class="pr-body">
            <div class="pr-kv"><span>Value of goods returned</span><strong>${cents(credit)}</strong></div>
            <div class="pr-kv"><span>Reduces what you still owe on ${esc(p.purchaseNumber)}</span><strong class="pos">−${cents(applied)}</strong></div>
            ${refund > 0 ? `<div class="pr-kv"><span>Already paid — supplier owes you back</span><strong class="pos">${cents(refund)}</strong></div>` : ''}
            <div class="pr-kv"><span>${esc(p.purchaseNumber)} balance</span><span>${cents(p.balanceCents)} → <strong>${cents(p.balanceCents - applied)}</strong></span></div>
            <div class="pr-kv big"><span>${esc(S.supplier.name)}</span><span style="text-align:right">${owe(supBefore)}<br><small class="text-muted" style="font-weight:400">now →</small> ${owe(supAfter)}</span></div>
            ${refund > 0 ? `<div class="pr-callout warn">Part of this purchase was already paid. The supplier now owes you <strong>${cents(refund)}</strong>. You can record the refund when it arrives, or keep it as credit against your next invoice.</div>` : `<div class="pr-callout ok">The whole value comes off what you owe ${esc(S.supplier.name)} — nothing to collect back.</div>`}
          </div></div>
        </div>
        <div class="pr-card" style="margin-top:var(--space-4)"><div class="pr-body">
          <div class="pr-kv"><span>Reason</span><strong>${REASONS[S.reason].label}${S.reasonNote ? ` — ${esc(S.reasonNote)}` : ''}</strong></div>
          <div class="pr-kv"><span>Return date</span><strong>${day(S.returnDate)}</strong></div>
          ${S.creditNote ? `<div class="pr-kv"><span>Supplier credit note</span><strong>${esc(S.creditNote)}</strong></div>` : ''}
        </div></div>
        <label style="display:flex;gap:8px;align-items:flex-start;margin-top:var(--space-4);font-size:13px;cursor:pointer"><input type="checkbox" id="pr-ok" style="margin-top:3px" /> <span>I confirm these goods are being sent back to ${esc(S.supplier.name)}. This updates stock and the supplier's balance straight away and cannot be undone.</span></label>`;
      setFoot(`<button class="btn btn-secondary" id="pr-b3">← Edit items</button><button class="btn btn-primary" id="pr-go" disabled>Confirm return</button>`);
      foot().querySelector('#pr-b3').addEventListener('click', drawItems);
      body().querySelector('#pr-ok').addEventListener('change', (e) => { foot().querySelector('#pr-go').disabled = !e.target.checked; });
      foot().querySelector('#pr-go').addEventListener('click', submit);
    }
    async function submit() {
      const btn = foot().querySelector('#pr-go'); if (S.busy) return; S.busy = true; btn.disabled = true; btn.textContent = 'Returning…';
      try {
        const payload = {
          reason: S.reason, reasonNote: S.reasonNote.trim() || undefined, returnDate: S.returnDate || undefined, creditNoteNumber: S.creditNote.trim() || undefined,
          lines: chosen().map((l) => ({ itemIndex: l.itemIndex, quantity: l.qty, ...(l.trackSerial ? { serialNumbers: l.picked } : {}) })),
        };
        const { data } = await post(`/purchase-returns/purchase/${S.purchase._id}`, payload);
        S.result = data.purchaseReturn; drawDone(); if (onDone) onDone(S.result);
      } catch (err) {
        S.busy = false; btn.disabled = false; btn.textContent = 'Confirm return';
        window.UI.toast.error(err.message || 'Could not complete the return');
      }
    }
    function drawDone() {
      const r = S.result;
      body().innerHTML = stepper() + `<div class="pr-done"><div class="tick">✓</div><h3 style="margin:0 0 4px">Return ${esc(r.number)} completed</h3>
        <p class="text-secondary" style="margin:0 0 16px">${esc(S.supplier.name)} · ${esc(S.purchase.purchaseNumber)}</p>
        <div class="pr-grid2" style="text-align:left;max-width:640px;margin:0 auto">
          <div class="pr-card"><div class="pr-body"><div class="pr-kv"><span>Value returned</span><strong>${kes(r.totalCredit)}</strong></div><div class="pr-kv"><span>Reduced what you owe</span><strong>${kes(r.appliedToBalance)}</strong></div></div></div>
          <div class="pr-card"><div class="pr-body"><div class="pr-kv"><span>Supplier owes you</span><strong>${kes(r.refundDue)}</strong></div><div class="pr-kv"><span>Refund status</span>${refundBadge(r.refundStatus)}</div></div></div>
        </div></div>`;
      setFoot(`<button class="btn btn-secondary" id="pr-again">Return another</button>${r.refundDue > 0 ? '<button class="btn btn-secondary" id="pr-refund">Record refund</button>' : ''}<button class="btn btn-secondary" id="pr-print">Print note</button><button class="btn btn-primary" id="pr-view">View return</button>`);
      foot().querySelector('#pr-again').addEventListener('click', () => { S.result = null; S.busy = false; drawFind(); });
      foot().querySelector('#pr-print')?.addEventListener('click', () => printReturn(r._id));
      foot().querySelector('#pr-refund')?.addEventListener('click', () => { close(); openRefundForm(r._id, () => openDetail(r._id)); });
      foot().querySelector('#pr-view').addEventListener('click', () => { close(); openDetail(r._id); });
    }

    if (purchaseId) choose(purchaseId); else drawFind();
  }

  /* ================================================================== DETAIL */
  async function fetchReturn(id) { const { data } = await get(`/purchase-returns/${id}`); return data.purchaseReturn; }

  async function openDetail(id, { onChanged } = {}) {
    injectStyles();
    const modal = window.UI.openModal({ title: 'Purchase return', maxWidth: '900px', bodyHtml: '<div class="text-muted" style="padding:30px;text-align:center">Loading…</div>', footerHtml: '<span></span>' });
    const draw = async () => {
      let r;
      try { r = await fetchReturn(id); } catch (err) { modal.querySelector('.modal-body').innerHTML = window.UI.emptyStateHtml({ icon: 'alert', title: 'Could not load this return', message: err.message }); return; }
      const open = Math.max(0, (r.refundDue || 0) - (r.refundReceived || 0));
      modal.querySelector('.modal-header h3').textContent = `Return ${r.number}`;
      modal.querySelector('.modal-body').innerHTML = `
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:var(--space-4)">
          <span class="badge badge-info">${esc(REASONS[r.reason]?.label || r.reason)}</span>${refundBadge(r.refundStatus)}
          <span class="text-muted text-sm">${day(r.returnDate)} · by ${esc(r.createdBy?.name || '—')}</span></div>
        <div class="pr-ctx">
          <div><small>Supplier</small><b>${esc(r.supplierId?.name || '—')}</b></div>
          <div><small>Purchase</small><b>${esc(r.purchaseNumber || '—')}</b></div>
          <div><small>Supplier credit note</small><b>${esc(r.creditNoteNumber || '—')}</b></div>
          <div><small>Value returned</small><b>${kes(r.totalCredit)}</b></div>
        </div>
        ${r.reasonNote ? `<p class="text-secondary" style="margin-top:0"><strong>Details:</strong> ${esc(r.reasonNote)}</p>` : ''}
        <div class="table-wrap" style="overflow:auto"><table class="pr-lines"><thead><tr><th>Item</th><th class="r">Qty returned</th><th>Taken from</th><th class="r">Unit cost</th><th class="r">Credit</th></tr></thead><tbody>
          ${r.lines.map((l) => `<tr><td><strong>${esc(l.nameSnapshot)}</strong>${l.serialNumbers?.length ? `<div class="pr-note">${l.serialNumbers.map(esc).join(', ')}</div>` : ''}${l.batches?.length ? `<div class="pr-note">Batch: ${l.batches.map((b) => `${esc(b.batchNumber)} ×${num(b.quantity)}`).join(', ')}</div>` : ''}</td>
            <td class="r">${num(l.quantity)} ${esc(l.unitName || '')}${l.unitFactor > 1 ? `<div class="pr-note">${num(l.baseQuantity)} base units</div>` : ''}</td><td>${locName(l.location)}</td><td class="r">${kes(l.unitCost)}</td><td class="r"><strong>${kes(l.total)}</strong></td></tr>`).join('')}
        </tbody></table></div>
        <div class="pr-grid2" style="margin-top:var(--space-4)">
          <div class="pr-card"><h4>Money</h4><div class="pr-body">
            <div class="pr-kv"><span>Value returned</span><strong>${kes(r.totalCredit)}</strong></div>
            <div class="pr-kv"><span>Reduced what you owe</span><strong>${kes(r.appliedToBalance)}</strong></div>
            <div class="pr-kv"><span>Purchase balance</span><span>${kes(r.balanceBefore)} → <strong>${kes(r.balanceAfter)}</strong></span></div>
            <div class="pr-kv"><span>Supplier balance (you owe)</span><span>${kes(r.supplierBalanceBefore)} → <strong>${kes(r.supplierBalanceAfter)}</strong></span></div>
          </div></div>
          <div class="pr-card"><h4>Refund from supplier</h4><div class="pr-body">
            ${r.refundDue > 0 ? `<div class="pr-kv"><span>Supplier owes you</span><strong>${kes(r.refundDue)}</strong></div><div class="pr-kv"><span>Received so far</span><strong class="pos">${kes(r.refundReceived)}</strong></div><div class="pr-kv big"><span>Still to receive</span><span>${r.refundStatus === 'CREDIT_HELD' ? `${kes(open)} <small class="text-muted">(kept as credit)</small>` : kes(open)}</span></div>
              ${(r.refunds || []).length ? `<ul class="pr-refunds">${r.refunds.map((x) => `<li><span>${day(x.at)} · ${esc(x.method)}${x.reference ? ` · ${esc(x.reference)}` : ''}</span><strong>${kes(x.amount)}</strong></li>`).join('')}</ul>` : ''}`
              : `<div class="pr-callout ok" style="margin-top:0">The goods were still unpaid, so the return simply reduced what you owe. No refund is expected.</div>`}
          </div></div>
        </div>
        ${r.notes ? `<p class="text-muted text-sm" style="margin-top:12px">Notes: ${esc(r.notes)}</p>` : ''}`;
      const canAct = open > 0 && ['PENDING', 'PARTIAL', 'CREDIT_HELD'].includes(r.refundStatus);
      modal.querySelector('.modal-footer').innerHTML = `<button class="btn btn-secondary" id="pd-print">Print note</button>
        ${canAct && r.refundStatus !== 'CREDIT_HELD' ? '<button class="btn btn-secondary" id="pd-hold" data-requires-permission="purchases.return">Keep as credit</button>' : ''}
        ${canAct ? '<button class="btn btn-primary" id="pd-refund" data-requires-permission="purchases.return">Record refund received</button>' : ''}`;
      gate(modal);
      modal.querySelector('#pd-print').addEventListener('click', () => printReturn(id));
      modal.querySelector('#pd-refund')?.addEventListener('click', () => openRefundForm(id, () => { draw(); if (onChanged) onChanged(); }, open));
      modal.querySelector('#pd-hold')?.addEventListener('click', async () => {
        const ok = await window.UI.confirmDialog({ title: 'Keep refund as credit?', message: `${esc(r.supplierId?.name || 'The supplier')} keeps ${kes(open)} and deducts it from your next invoice. No cash changes hands.`, confirmText: 'Keep as credit' });
        if (!ok) return;
        try { await post(`/purchase-returns/${id}/hold-credit`, {}); window.UI.toast.success('Kept as credit with the supplier'); draw(); if (onChanged) onChanged(); } catch (err) { window.UI.toast.error(err.message); }
      });
    };
    draw();
  }

  function openRefundForm(id, done, openAmount) {
    injectStyles();
    const modal = window.UI.openModal({
      title: 'Record refund from supplier', maxWidth: '460px',
      bodyHtml: `<div class="field"><label>Amount received</label><input class="input" id="rf-amt" type="number" min="0" step="0.01" value="${openAmount || ''}" /><div class="field-hint">${openAmount ? `Up to ${kes(openAmount)} is still owed to you.` : 'Enter what the supplier paid back.'}</div></div>
        <div class="form-row"><div class="field"><label>How was it paid?</label><select class="select" id="rf-m"><option value="CASH">Cash</option><option value="MPESA">M-Pesa</option><option value="BANK">Bank transfer</option><option value="CHEQUE">Cheque</option><option value="OTHER">Other</option></select></div>
        <div class="field"><label>Reference</label><input class="input" id="rf-ref" maxlength="80" placeholder="Receipt / transaction no." /></div></div>
        <div class="field"><label>Note</label><input class="input" id="rf-note" maxlength="300" /></div>`,
      footerHtml: '<button class="btn btn-secondary" data-action="close" id="rf-c">Cancel</button><button class="btn btn-primary" id="rf-s">Save refund</button>',
    });
    modal.querySelector('#rf-c').addEventListener('click', () => modal.querySelector('.modal-close')?.click());
    modal.querySelector('#rf-s').addEventListener('click', async (e) => {
      const amount = Number(modal.querySelector('#rf-amt').value);
      if (!(amount > 0)) return window.UI.toast.error('Enter the amount received');
      e.currentTarget.disabled = true;
      try {
        await post(`/purchase-returns/${id}/refund`, { amount, method: modal.querySelector('#rf-m').value, reference: modal.querySelector('#rf-ref').value.trim() || undefined, note: modal.querySelector('#rf-note').value.trim() || undefined });
        window.UI.toast.success('Refund recorded'); modal.querySelector('.modal-close').click(); if (done) done();
      } catch (err) { e.currentTarget.disabled = false; window.UI.toast.error(err.message); }
    });
  }

  /* ------------------------------------------------------------------ printable return note */
  async function printReturn(id) {
    let r; try { r = await fetchReturn(id); } catch (err) { return window.UI.toast.error(err.message); }
    const w = window.open('', '_blank', 'width=820,height=900'); if (!w) return window.UI.toast.error('Allow pop-ups to print');
    const biz = (window.AppShell.getBusiness && window.AppShell.getBusiness()) || {};
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(r.number)}</title><style>
      body{font:14px/1.45 system-ui,Arial,sans-serif;color:#111;margin:32px}h1{margin:0;font-size:22px}table{width:100%;border-collapse:collapse;margin-top:16px}
      th,td{border-bottom:1px solid #ddd;padding:8px;text-align:left}th{font-size:12px;text-transform:uppercase;color:#555}td.r,th.r{text-align:right}
      .meta{display:grid;grid-template-columns:1fr 1fr;gap:6px 24px;margin-top:16px}.sig{display:flex;gap:40px;margin-top:64px}.sig div{flex:1;border-top:1px solid #333;padding-top:6px;font-size:12px}</style></head><body>
      <h1>Purchase Return Note</h1><div>${esc(biz.name || '')}</div>
      <div class="meta"><div><b>Return no:</b> ${esc(r.number)}</div><div><b>Date:</b> ${day(r.returnDate)}</div>
      <div><b>Supplier:</b> ${esc(r.supplierId?.name || '')}</div><div><b>Purchase:</b> ${esc(r.purchaseNumber || '')}</div>
      <div><b>Reason:</b> ${esc(REASONS[r.reason]?.label || r.reason)}</div><div><b>Credit note:</b> ${esc(r.creditNoteNumber || '—')}</div></div>
      ${r.reasonNote ? `<p><b>Details:</b> ${esc(r.reasonNote)}</p>` : ''}
      <table><thead><tr><th>Item</th><th class="r">Qty</th><th class="r">Unit cost</th><th class="r">Credit value</th></tr></thead><tbody>
      ${r.lines.map((l) => `<tr><td>${esc(l.nameSnapshot)}${l.serialNumbers?.length ? `<br><small>${l.serialNumbers.map(esc).join(', ')}</small>` : ''}${l.batches?.length ? `<br><small>Batch ${l.batches.map((b) => esc(b.batchNumber)).join(', ')}</small>` : ''}</td><td class="r">${num(l.quantity)} ${esc(l.unitName || '')}</td><td class="r">${kes(l.unitCost)}</td><td class="r">${kes(l.total)}</td></tr>`).join('')}
      </tbody><tfoot><tr><th colspan="3" class="r">Total credit value</th><th class="r">${kes(r.totalCredit)}</th></tr></tfoot></table>
      <div class="sig"><div>Returned by (shop)</div><div>Received by (supplier)</div></div></body></html>`);
    w.document.close(); w.focus(); setTimeout(() => w.print(), 250);
  }

  /* ================================================================== LIST */
  function renderList(host, opts = {}) {
    injectStyles();
    const F = { page: 1, limit: 10, search: '', supplierId: '', reason: '', refundStatus: '', from: '', to: '', scope: 'all' };
    let suppliers = [];
    host.innerHTML = `
      <div class="pr-stats" id="pr-stats"></div>
      <div class="pr-filters" id="pr-filters"></div>
      <div id="pr-table"></div><div class="pagination" id="pr-pager"></div>`;
    const statsEl = host.querySelector('#pr-stats'); const filtersEl = host.querySelector('#pr-filters');
    const tableEl = host.querySelector('#pr-table'); const pagerEl = host.querySelector('#pr-pager');

    const query = () => {
      const q = {};
      ['search', 'supplierId', 'reason', 'refundStatus', 'from', 'to'].forEach((k) => { if (F[k]) q[k] = F[k]; });
      if (F.scope === 'branch') { const b = window.AppShell.getActiveBranchId && window.AppShell.getActiveBranchId(); if (b) q.branchId = b; }
      return q;
    };
    function drawFilters() {
      filtersEl.innerHTML = `
        <input class="input grow" id="f-q" placeholder="Search return, purchase or credit note no." value="${esc(F.search)}" />
        <select class="select" id="f-sup"><option value="">All suppliers</option>${suppliers.map((s) => `<option value="${esc(s._id)}" ${F.supplierId === s._id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select>
        <select class="select" id="f-reason"><option value="">All reasons</option>${Object.entries(REASONS).map(([k, v]) => `<option value="${k}" ${F.reason === k ? 'selected' : ''}>${v.label}</option>`).join('')}</select>
        <select class="select" id="f-ref"><option value="">Any refund status</option>${Object.entries(REFUND).map(([k, v]) => `<option value="${k}" ${F.refundStatus === k ? 'selected' : ''}>${v[1]}</option>`).join('')}</select>
        <select class="select" id="f-scope"><option value="all" ${F.scope === 'all' ? 'selected' : ''}>All branches</option><option value="branch" ${F.scope === 'branch' ? 'selected' : ''}>This branch</option></select>
        <span class="pr-lbl">From</span><input class="input" type="date" id="f-from" value="${esc(F.from)}" /><span class="pr-lbl">To</span><input class="input" type="date" id="f-to" value="${esc(F.to)}" />
        <button type="button" class="btn btn-secondary btn-sm" id="f-clear">Clear</button>`;
      const on = (id, ev, fn) => filtersEl.querySelector(id).addEventListener(ev, fn);
      on('#f-q', 'input', debounce((e) => { F.search = e.target.value.trim(); F.page = 1; load(); }));
      on('#f-sup', 'change', (e) => { F.supplierId = e.target.value; F.page = 1; load(); });
      on('#f-reason', 'change', (e) => { F.reason = e.target.value; F.page = 1; load(); });
      on('#f-ref', 'change', (e) => { F.refundStatus = e.target.value; F.page = 1; load(); });
      on('#f-scope', 'change', (e) => { F.scope = e.target.value; F.page = 1; load(); });
      on('#f-from', 'change', (e) => { F.from = e.target.value; F.page = 1; load(); });
      on('#f-to', 'change', (e) => { F.to = e.target.value; F.page = 1; load(); });
      on('#f-clear', 'click', () => { Object.assign(F, { page: 1, search: '', supplierId: '', reason: '', refundStatus: '', from: '', to: '', scope: 'all' }); drawFilters(); load(); });
    }
    async function loadStats() {
      try {
        const { data: s } = await get('/purchase-returns/summary', query());
        statsEl.innerHTML = `
          <div class="pr-stat"><small>Returns made</small><b>${num(s.count)}</b><span>${num(s.thisMonthCount)} this month</span></div>
          <div class="pr-stat"><small>Value returned</small><b>${kes(s.totalCredit)}</b><span>${kes(s.thisMonthCredit)} this month</span></div>
          <div class="pr-stat"><small>Cut from what you owe</small><b>${kes(s.reducedWhatYouOwe)}</b><span>Offset against unpaid invoices</span></div>
          <div class="pr-stat"><small>Suppliers owe you</small><b style="color:${s.pendingRefund > 0 ? 'var(--color-warning)' : 'inherit'}">${kes(s.pendingRefund)}</b><span>Refunds still to collect</span></div>
          <div class="pr-stat"><small>Kept as credit</small><b>${kes(s.heldCredit)}</b><span>Deducted from next invoices</span></div>`;
      } catch { statsEl.innerHTML = ''; }
    }
    async function load() {
      tableEl.innerHTML = `<div class="text-muted" style="padding:24px var(--space-6)">Loading returns…</div>`; pagerEl.innerHTML = '';
      loadStats();
      try {
        const { data } = await get('/purchase-returns', { ...query(), page: F.page, limit: F.limit });
        if (!data.items.length) {
          tableEl.innerHTML = window.UI.emptyStateHtml({ icon: 'bag', title: 'No purchase returns', message: Object.keys(query()).length ? 'No returns match these filters.' : 'When goods from a received purchase are sent back to a supplier, they are listed here.', actionHtml: can('purchases.return') && !Object.keys(query()).length ? '<button class="btn btn-primary" id="pr-empty-new">Return a purchase</button>' : '' });
          tableEl.querySelector('#pr-empty-new')?.addEventListener('click', () => openWizard({ onDone: load }));
          return;
        }
        tableEl.innerHTML = `<div class="table-wrap" style="border:none;border-radius:0"><table class="table"><thead><tr><th>Return</th><th>Date</th><th>Supplier</th><th>Purchase</th><th>Items</th><th>Reason</th><th class="num">Value</th><th>Refund</th><th></th></tr></thead><tbody>
          ${data.items.map((r) => `<tr>
            <td class="cell-primary">${esc(r.number)}</td><td>${day(r.returnDate)}</td><td>${esc(r.supplierId?.name || '—')}</td><td>${esc(r.purchaseNumber || '—')}</td>
            <td>${r.lines.length} <span class="text-muted text-sm">(${num(r.lines.reduce((s, l) => s + l.quantity, 0))} qty)</span></td>
            <td><span class="badge badge-neutral">${esc(REASONS[r.reason]?.label || r.reason)}</span></td>
            <td class="num"><strong>${kes(r.totalCredit)}</strong></td>
            <td>${refundBadge(r.refundStatus)}${r.refundStatus === 'PENDING' || r.refundStatus === 'PARTIAL' ? `<div class="text-muted text-sm">${kes(r.refundDue - r.refundReceived)} due</div>` : ''}</td>
            <td class="actions"><button type="button" class="btn btn-secondary btn-sm" data-view="${esc(r._id)}">View</button></td></tr>`).join('')}
          </tbody></table></div>`;
        tableEl.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => openDetail(b.dataset.view, { onChanged: load })));
        window.UI.renderPagination(pagerEl, data, (p) => { F.page = p; load(); });
      } catch (err) { tableEl.innerHTML = window.UI.emptyStateHtml({ icon: 'alert', title: 'Could not load purchase returns', message: err.message }); }
    }
    (async () => { try { const { data } = await get('/suppliers', { page: 1, limit: 100 }); suppliers = data.items || []; } catch { suppliers = []; } drawFilters(); })();
    drawFilters(); load();
    return { reload: load };
  }

  window.PurchaseReturns = { openWizard, openDetail, renderList, printReturn };
})(window);