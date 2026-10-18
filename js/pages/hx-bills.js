/**
 * hx-bills.js - Bills & payments.
 *   List  GET /restaurant/bills (Open / Paid / Void)    Detail  GET /restaurant/bills/:id  (#bill=ID)
 *   Pay   POST /bills/:id/pay (cash, M-PESA code or STK push, card, bank, on account, charge to room)
 *   Also: tip, discount, waive service charge, split equally, void, refund.
 * A refused cash payment (no open cash shift) is explained with a link to the cash register.
 */
(function () {
  const { E, M, can, get, send, list, head, pill, formModal, unwrap, dt, PAY, payLabel } = window.HX;
  let el, tab = 'OPEN', bill = null;
  const TONE = { OPEN: 'warn', PARTIAL: 'busy', PAID: 'ok', VOID: 'mute', WRITTEN_OFF: 'mute' };
  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    el = window.HX.mount('Bills & payments');
    if (!el) return;
    await window.AppShell.whenProfileReady?.();
    window.addEventListener('hashchange', route); route();
  }
  function route() { const m = location.hash.match(/bill=([a-f0-9]+)/i); if (m) openBill(m[1]); else showList(); }

  async function showList() {
    bill = null;
    el.innerHTML = head('Bills & payments', 'Collect payment, split a bill or add a tip.') + window.HX.tabs([['OPEN', 'Open'], ['PARTIAL', 'Part paid'], ['PAID', 'Paid'], ['VOID', 'Void']], tab) + '<div id="bl" class="hx-card flush"><p class="hx-sub" style="padding:var(--space-4)">Loading…</p></div>';
    el.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => { tab = b.dataset.tab; showList(); }));
    const d = await get('/restaurant/bills', { branchId: window.HX.branchId(), status: tab, limit: 50 });
    const rows = list(d, 'bills');
    el.querySelector('#bl').innerHTML = rows.length ? rows.map((b) => `<a class="hx-row" href="#bill=${b._id}" style="text-decoration:none;color:inherit"><div class="grow"><b>${E(b.billNumber)} · ${E(b.tableName ? 'Table ' + b.tableName : (b.orderType || '').replace('_', ' ').toLowerCase())}</b><small class="hx-sub">${E(b.waiterName || '')} ${b.createdAt ? '· ' + dt(b.createdAt) : ''}</small></div>${pill(b.status, TONE[b.status])}<span class="hx-money">${M(b.total)}</span></a>`).join('') : window.HX.empty('No bills here', 'Bills appear once an order is sent to be billed.');
  }

  async function openBill(id) {
    el.innerHTML = '<div class="hx-card"><p class="hx-sub">Loading bill…</p></div>';
    const d = await get('/restaurant/bills/' + id); if (!d) { window.UI.toast.error('Bill not found'); location.hash = ''; return; }
    bill = unwrap(d, 'bill'); paintBill();
  }

  function paintBill() {
    const b = bill, open = b.status === 'OPEN' || b.status === 'PARTIAL', due = b.balance != null ? b.balance : Math.max(0, (b.total || 0) - (b.paid || 0));
    const act = (id, label, show, cls = 'btn-secondary') => (show ? `<button class="btn ${cls}" id="${id}">${label}</button>` : '');
    el.innerHTML = head(`Bill ${b.billNumber}`, `${b.tableName ? 'Table ' + b.tableName + ' · ' : ''}Order ${b.orderNumber || ''}${b.waiterName ? ' · ' + b.waiterName : ''}`, `<a class="btn btn-secondary" href="#">All bills</a>${act('print', 'Print', true)}`) + `
      <div class="hx-cols" style="grid-template-columns:minmax(0,1.4fr) minmax(280px,1fr)">
        <div class="hx-card flush">${(b.lines || []).map((l) => `<div class="hx-row"><div class="grow"><b>${l.quantity}× ${E(l.name)}${l.variantName ? ' · ' + E(l.variantName) : ''}</b>${l.modifiersText ? `<small class="hx-sub">${E(l.modifiersText)}</small>` : ''}${l.isComp ? '<small class="hx-sub">Complimentary</small>' : ''}</div><span class="hx-money">${M(l.total)}</span></div>`).join('')}
          <div class="hx-card" style="border:0;border-top:1px solid var(--color-border);border-radius:0"><div class="hx-totals">
            <div><span>Items</span><span>${M(b.itemsTotal)}</span></div>${b.discount ? `<div><span>Discount</span><span>−${M(b.discount)}</span></div>` : ''}
            ${b.serviceCharge ? `<div><span>Service charge${b.scWaived ? ' (waived)' : ''}</span><span>${M(b.serviceCharge)}</span></div>` : ''}${b.tax ? `<div><span>Tax</span><span>${M(b.tax)}</span></div>` : ''}
            <div class="grand"><span>Total</span><span>${M(b.total)}</span></div>${b.paid ? `<div><span>Paid</span><span>${M(b.paid)}</span></div><div><span>Balance</span><span>${M(due)}</span></div>` : ''}</div></div></div>
        <div style="display:grid;gap:var(--space-3);align-content:start">
          <div class="hx-card"><div class="hx-due"><small>${open ? 'Amount due' : pill(b.status, TONE[b.status])}</small><b>${M(open ? due : b.total)}</b></div>
            <div style="display:grid;gap:var(--space-2)">${act('pay', 'Take payment', open && can('restaurant.bills.pay') && due > 0, 'btn-primary')}${act('split', 'Split bill', open && can('restaurant.bills.split'))}${act('disc', 'Discount', open && can('restaurant.orders.discount'))}${act('sc', b.scWaived ? 'Restore service charge' : 'Waive service charge', open && b.serviceCharge > 0 && can('restaurant.bills.waive_service_charge'))}${act('tip', 'Add tip', ['PAID', 'PARTIAL', 'OPEN'].includes(b.status) && can('restaurant.bills.pay'))}${act('refund', 'Refund', b.status === 'PAID' && can('restaurant.bills.refund'))}${act('void', 'Void bill', open && can('restaurant.bills.generate'))}</div></div>
          ${(b.payments || []).length ? `<div class="hx-card"><h3>Payments</h3>${b.payments.map((p) => `<div class="hx-row"><div class="grow"><b>${payLabel(p.method)}${p.kind === 'REFUND' ? ' (refund)' : ''}</b><small class="hx-sub">${dt(p.at)}${p.reference ? ' · ' + E(p.reference) : ''}</small></div><span class="hx-money">${M(p.amount)}</span></div>`).join('')}</div>` : ''}
        </div></div>`;
    const on = (id, fn) => el.querySelector('#' + id)?.addEventListener('click', fn);
    on('print', () => window.print()); on('pay', payModal); on('split', splitModal); on('disc', discModal); on('tip', tipModal); on('refund', refundModal);
    on('sc', async () => { if (await send('post', `/restaurant/bills/${b._id}/service-charge`, { waive: !b.scWaived })) reload(); });
    on('void', async () => { const r = await window.HX.ask('Void this bill', 'Reason'); if (r && await send('post', `/restaurant/bills/${b._id}/void`, { reason: r })) reload(); });
  }
  async function reload() { const d = await get('/restaurant/bills/' + bill._id); if (d) { bill = unwrap(d, 'bill'); paintBill(); } }

  const dueNow = () => (bill.balance != null ? bill.balance : Math.max(0, (bill.total || 0) - (bill.paid || 0)));

  function payModal() {
    const due = dueNow(); let method = 'CASH';
    const methods = ['CASH', 'MPESA', 'CARD', 'BANK', 'MOBILE_MONEY', 'CREDIT'].filter((m) => m !== 'CREDIT' || can('restaurant.bills.pay'));
    const m = window.UI.openModal({ title: `Pay ${bill.billNumber}`, maxWidth: '460px', bodyHtml: `<div class="hx-due"><small>Amount due</small><b>${M(due)}</b></div>
      <div class="hx-methods">${methods.map((x) => `<button class="hx-method ${x === method ? 'on' : ''}" data-m="${x}">${payLabel(x)}</button>`).join('')}</div>
      <div class="hx-form" style="margin-top:var(--space-3)"><div class="field"><label>Amount</label><input class="input" id="amt" type="number" step="0.01" value="${due}"></div>
        <div class="field" id="tend"><label>Cash received</label><input class="input" id="tn" type="number" step="0.01" value="${due}"></div>
        <div class="field hidden" id="refw"><label id="refl">Reference</label><input class="input" id="ref" placeholder="e.g. QGH7K2L9PX"></div>
        <div class="hx-quick" id="quick"></div><div id="chg" class="hx-sub"></div></div>`,
      footerHtml: '<button class="btn btn-secondary" data-c>Cancel</button><button class="btn btn-primary" id="go">Confirm payment</button>' });
    const $ = (s) => m.querySelector(s);
    const sync = () => {
      m.querySelectorAll('[data-m]').forEach((x) => x.classList.toggle('on', x.dataset.m === method));
      $('#tend').classList.toggle('hidden', method !== 'CASH'); $('#refw').classList.toggle('hidden', method === 'CASH');
      $('#refl').textContent = method === 'MPESA' ? 'M-PESA code' : 'Reference (optional)';
      $('#quick').innerHTML = method === 'CASH' ? [due, Math.ceil(due / 100) * 100, Math.ceil(due / 500) * 500, Math.ceil(due / 1000) * 1000].filter((v, i, a) => v >= due && a.indexOf(v) === i).map((v) => `<button type="button" class="btn btn-sm btn-secondary" data-q="${v}">${M(v)}</button>`).join('') : '';
      $('#quick').querySelectorAll('[data-q]').forEach((x) => x.addEventListener('click', () => { $('#tn').value = x.dataset.q; chg(); }));
    };
    const chg = () => { const ch = Number($('#tn').value || 0) - Number($('#amt').value || 0); $('#chg').textContent = method === 'CASH' && ch > 0 ? `Change: ${M(ch)}` : ''; };
    m.querySelectorAll('[data-m]').forEach((x) => x.addEventListener('click', () => { method = x.dataset.m; sync(); }));
    ['#amt', '#tn'].forEach((s) => $(s).addEventListener('input', chg));
    m.querySelector('[data-c]').addEventListener('click', () => window.UI.closeModal()); sync();
    $('#go').addEventListener('click', async () => {
      const amount = Number($('#amt').value), p = { method, amount };
      if (!(amount > 0)) return window.UI.toast.warning('Enter an amount');
      if (method === 'CASH') p.tendered = Math.max(amount, Number($('#tn').value || amount));
      else if ($('#ref').value.trim()) p.reference = $('#ref').value.trim();
      if (method === 'MPESA' && !p.reference) return window.UI.toast.warning('Enter the M-PESA code');
      window.UI.setButtonLoading($('#go'), true, 'Processing…');
      try {
        await window.Api.post(`/restaurant/bills/${bill._id}/pay`, { payments: [p] });
        window.UI.closeModal(); window.UI.toast.success('Payment received'); reload();
      } catch (e) {
        window.UI.setButtonLoading($('#go'), false);
        const msg = (e && e.message) || 'Payment failed';
        window.UI.toast.error(/shift|drawer/i.test(msg) ? 'Open a cash shift first (Cash register), then take the payment.' : msg);
      }
    });
  }

  function splitModal() {
    formModal({ title: 'Split bill equally', maxWidth: '380px', submitText: 'Split', fields: [{ name: 'ways', label: 'Split between how many people?', type: 'number', value: 2, min: 2, max: 20, required: true }], onSubmit: async (v) => { const r = await send('post', `/restaurant/bills/${bill._id}/split`, { mode: 'EQUAL', ways: v.ways }); if (r) { window.UI.toast.success('Bill split'); location.hash = ''; return true; } return false; } });
  }
  function discModal() {
    formModal({ title: 'Discount', maxWidth: '400px', fields: [{ name: 'type', label: 'Type', type: 'select', options: [['PERCENT', 'Percent'], ['AMOUNT', 'Amount']] }, { name: 'value', label: 'Value', type: 'number', min: 0, step: '0.01', required: true }, { name: 'reason', label: 'Reason', required: true }], onSubmit: async (v) => { if (await send('post', `/restaurant/bills/${bill._id}/discount`, v)) { reload(); return true; } return false; } });
  }
  function tipModal() {
    formModal({ title: 'Add a tip', maxWidth: '400px', fields: [{ name: 'amount', label: 'Tip amount', type: 'number', min: 0, step: '0.01', required: true }, { name: 'method', label: 'Paid by', type: 'select', options: ['CASH', 'MPESA', 'CARD', 'MOBILE_MONEY', 'BANK'].map((x) => [x, payLabel(x)]) }, { name: 'reference', label: 'Reference (optional)' }], onSubmit: async (v) => { if (await send('post', `/restaurant/bills/${bill._id}/tips`, v)) { window.UI.toast.success('Tip recorded'); reload(); return true; } return false; } });
  }
  function refundModal() {
    formModal({ title: 'Refund', maxWidth: '400px', fields: [{ name: 'amount', label: 'Amount', type: 'number', value: bill.paid, step: '0.01', required: true }, { name: 'method', label: 'Refund by', type: 'select', options: ['CASH', 'MPESA', 'CARD', 'BANK'].map((x) => [x, payLabel(x)]) }, { name: 'reason', label: 'Reason', required: true }], onSubmit: async (v) => { if (await send('post', `/restaurant/bills/${bill._id}/refund`, v)) { reload(); return true; } return false; } });
  }
})();
